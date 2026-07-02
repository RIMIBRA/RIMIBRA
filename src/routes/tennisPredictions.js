const express = require('express');
const router = express.Router();
const api = require('../api/tennisClient');
const predictor = require('../algorithm/tennisPredictor');
const { requireAdmin } = require('../auth/middleware');
const cache = require('../cache/db');
const { mapWithConcurrency } = require('../utils/concurrency');

// Contrairement au foot (cotes via the-odds-api, quota mensuel serré), le tennis tire ses
// cotes d'api-tennis.com (quota quotidien énorme, très peu utilisé) -> calculer l'alternative
// pour CHAQUE match de la liste (pas juste à la demande sur un match ouvert) ne présente pas
// le même risque de quota.
const ALTERNATIVES_CONCURRENCY = 10;
const ALTERNATIVES_TTL = 12 * 60; // même fenêtre que analyzeDayGames — pas de recalcul à chaque requête

// "Trop évident" se juge sur la VRAIE cote bookmaker, jamais sur la confiance de notre propre
// algo : les deux peuvent diverger fortement (ex. notre modèle à 68% alors que le marché est
// à une cote de 1.02, quasi certain) — se fier au modèle ferait passer à côté de l'alternative
// dans exactement le cas où elle est la plus utile.
const OBVIOUS_ODD_MAX = 1.6;

function averageOdd(bookmakers) {
  const values = Object.values(bookmakers).map(Number).filter((n) => !Number.isNaN(n));
  if (values.length === 0) return null;
  return Math.round((values.reduce((s, o) => s + o, 0) / values.length) * 100) / 100;
}

// Marché "Over/Under" de l'API = total de SETS (confirmé : lignes fixes 3.5/4.5 sur tous
// les matchs ATP en 5 sets à Wimbledon — un total de jeux varierait fortement d'un match
// à l'autre, alors qu'un total de sets a un nombre limité de lignes possibles).
// On cherche la meilleure cote disponible dans une fourchette raisonnable (1.3 = nettement
// mieux que le pari sec à ~1.0 ; 6 = au-delà, trop incertain pour être une "alternative").
const ALTERNATIVE_ODD_MIN = 1.3;
const ALTERNATIVE_ODD_MAX = 6;

function findBalancedAlternative(oddsBySport) {
  const overUnder = oddsBySport?.['Over/Under'];
  if (!overUnder) return null;

  const candidates = [];
  for (const [sideKey, label] of [['Over/Under Over', 'Plus de'], ['Over/Under Under', 'Moins de']]) {
    const lines = overUnder[sideKey];
    if (!lines) continue;
    for (const [line, bookmakers] of Object.entries(lines)) {
      const odd = averageOdd(bookmakers);
      if (odd != null && odd >= ALTERNATIVE_ODD_MIN && odd <= ALTERNATIVE_ODD_MAX) {
        candidates.push({ market: `${label} ${line} sets`, odd });
      }
    }
  }
  if (candidates.length === 0) return null;

  // La cote la plus haute dans cette fourchette = la meilleure valeur tout en restant raisonnable
  candidates.sort((a, b) => b.odd - a.odd);
  return candidates[0];
}

async function buildAlternativeBet(matchId, analysis) {
  if (analysis.matchState === 'finished') return null;
  try {
    const odds = await api.getOdds(matchId);
    if (!odds) return null;
    const winOdd = averageOdd(odds['Home/Away']?.[analysis.recommendation.pick.startsWith('1') ? 'Home' : 'Away'] || {});
    if (winOdd == null || winOdd > OBVIOUS_ODD_MAX) return null; // le marché ne juge pas ce pick "évident" -> pas d'alternative à proposer
    const alternative = findBalancedAlternative(odds);
    if (!alternative) return null;
    return { mainPickOdd: winOdd, alternative };
  } catch {
    return null; // pas de cotes disponibles pour ce match -> pas grave, juste pas d'alternative affichée
  }
}

// Enrichit chaque pronostic "à venir" avec son alternative de pari (cotes réelles) quand le
// pari sec est jugé trop évident — mis en cache séparément pour ne pas retaper l'API à
// chaque requête dans la même fenêtre de 12 min que analyzeDayGames.
async function attachAlternativeBets(cacheKey, results) {
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const augmented = await mapWithConcurrency(results, ALTERNATIVES_CONCURRENCY, async (r) => {
    if (r.error || r.matchState === 'finished' || r.insufficientData) return r;
    const alternativeBet = await buildAlternativeBet(r.fixture.id, r).catch(() => null);
    return alternativeBet ? { ...r, alternativeBet } : r;
  });

  cache.set(cacheKey, augmented, ALTERNATIVES_TTL);
  return augmented;
}

router.get('/today', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const { results, total, analyzed } = await predictor.analyzeDayGames(date);
    const predictions = await attachAlternativeBets(`tennis_alternatives_${date}`, results);
    const used = api.getDailyRequestCount();
    const limitReached = used >= api.DAILY_LIMIT;
    res.json({ date, predictions, total, analyzed, requestsUsed: used, requestsLeft: Math.max(0, api.DAILY_LIMIT - used), limitReached });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/search', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Paramètre "q" requis' });
    const { results, total } = await predictor.searchGames(date, q);
    // Peu de résultats (recherche ciblée) -> pas besoin de cache dédié, on calcule à chaque fois
    const predictions = await mapWithConcurrency(results, ALTERNATIVES_CONCURRENCY, async (r) => {
      if (r.error || r.matchState === 'finished' || r.insufficientData) return r;
      const alternativeBet = await buildAlternativeBet(r.fixture.id, r).catch(() => null);
      return alternativeBet ? { ...r, alternativeBet } : r;
    });
    const used = api.getDailyRequestCount();
    res.json({ date, query: q, predictions, total, requestsUsed: used, requestsLeft: Math.max(0, api.DAILY_LIMIT - used) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/status', (req, res) => {
  const used = api.getDailyRequestCount();
  res.json({ used, remaining: api.DAILY_LIMIT - used, limit: api.DAILY_LIMIT });
});

// Analyse à la demande d'un match précis — enrichie d'une alternative de pari (cotes réelles)
// quand le pronostic principal est trop évident
router.get('/game/:id', async (req, res) => {
  try {
    const game = await api.getGameById(req.params.id);
    if (!game) return res.status(404).json({ error: 'Match introuvable' });
    const analysis = await predictor.analyzeGame(game);
    const alternativeBet = await buildAlternativeBet(req.params.id, analysis);
    res.json({ ...analysis, alternativeBet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/debug', requireAdmin, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const raw = await api.getRawGames(date);
    res.json({ date, count: Array.isArray(raw) ? raw.length : raw, first3: Array.isArray(raw) ? raw.slice(0, 3) : raw });
  } catch (err) {
    res.json({ error: err.message });
  }
});

module.exports = router;
