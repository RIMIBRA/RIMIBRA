const express = require('express');
const router = express.Router();
const { canAccessSport, comboLimitFor } = require('../auth/tiers');
const { getCombosForSport, saveCombo } = require('../db/combos');

const football = require('../algorithm/predictor');
const nfl = require('../algorithm/nflPredictor');
const nba = require('../algorithm/nbaPredictor');
const hockey = require('../algorithm/hockeyPredictor');
const baseball = require('../algorithm/baseballPredictor');
const handball = require('../algorithm/handballPredictor');
const tennis = require('../algorithm/tennisPredictor');

const footballApi = require('../api/client');
const nflApi = require('../api/nflClient');
const nbaApi = require('../api/nbaClient');
const hockeyApi = require('../api/hockeyClient');
const baseballApi = require('../api/baseballClient');
const handballApi = require('../api/handballClient');
const tennisApi = require('../api/tennisClient');

const SPORTS = [
  { key: 'football', label: '⚽ Football', analyzeDay: football.analyzeDayFixtures, byId: (id) => footballApi.getFixtureById(id) },
  { key: 'nfl', label: '🏈 NFL', analyzeDay: nfl.analyzeDayGames, byId: (id) => nflApi.getGameById(id) },
  { key: 'nba', label: '🏀 Basketball', analyzeDay: nba.analyzeDayGames, byId: (id) => nbaApi.getGameById(id) },
  { key: 'hockey', label: '🏒 Hockey', analyzeDay: hockey.analyzeDayGames, byId: (id) => hockeyApi.getGameById(id) },
  { key: 'baseball', label: '⚾ Baseball', analyzeDay: baseball.analyzeDayGames, byId: (id) => baseballApi.getGameById(id) },
  { key: 'handball', label: '🤾 Handball', analyzeDay: handball.analyzeDayGames, byId: (id) => handballApi.getGameById(id) },
  { key: 'tennis', label: '🎾 Tennis', analyzeDay: tennis.analyzeDayGames, byId: (id) => tennisApi.getGameById(id) },
];

const FINISHED_STATUSES = ['FT', 'AET', 'PEN', 'AWD', 'WO'];

// Coupe du Monde, championnat brésilien et amicaux de clubs — ids vérifiés via l'API plutôt
// que sur le nom affiché (trop fragile, voir commentaire dans algorithm/predictor.js).
// Les combinés foot doivent piocher exclusivement dans ces compétitions, sans repli sur les
// autres ligues même hors période de Coupe du Monde (voir getOrCreateComboSeries).
const FOOTBALL_COMBO_LEAGUE_IDS = new Set([
  1,   // Coupe du Monde
  71,  // Brasileirão Série A (Brésil)
  667, // Amicaux de clubs
]);

function pickProbability(p) {
  const { home, draw = 0, away } = p.probabilities;
  if (p.recommendation.pick.startsWith('1')) return home;
  if (p.recommendation.pick.startsWith('2')) return away;
  return draw;
}

function isComboCandidate(p, usedIds, leagueIds) {
  if (leagueIds && !leagueIds.has(p.fixture.leagueId)) return false;
  return !p.error && !p.insufficientData && p.matchState !== 'finished' && p.probabilities && !usedIds.has(String(p.fixture.id));
}

// Un match a de la "couverture média" s'il est suivi par au moins une source de cotes/pronostics
// externe — sert de proxy pour repérer les grosses équipes dans les amicaux de clubs (league
// 667), où l'écrasante majorité des affiches n'ont ni historique ni cotes exploitables : pas de
// liste de noms d'équipes à maintenir (fragile, voir PRIORITY_LEAGUE_IDS dans predictor.js),
// juste le signal déjà calculé pour chaque match.
function hasMediaCoverage(p) {
  const s = p.webSources;
  return !!(s && (s.oddsapi || s.footballpred || s.forebet || s.besoccer || s.flashscore));
}

// Priorise les matchs foot à BTTS élevé (les deux équipes marquent), en tenant aussi compte du
// BTTS historique de leurs confrontations passées — règle n°1 pour les combinés foot, demandée
// explicitement pour privilégier des matchs plus "ouverts"/prévisibles plutôt que la seule
// probabilité de l'issue 1X2. Pour les amicaux de clubs, bonus aux affiches couvertes par une
// source externe (proxy "grande équipe", voir hasMediaCoverage) — le tête-à-tête reste dans le
// score via h2hBttsRate, donc toujours pris en compte même pour ces matchs-là.
function footballComboRank(p) {
  const bttsProb = p.goalPrediction?.btts ?? 0;
  const h2hBttsRate = p.breakdown?.h2h?.bttsRate;
  const baseProb = pickProbability(p);

  const score = h2hBttsRate != null
    ? bttsProb * 0.5 + h2hBttsRate * 0.3 + baseProb * 0.2
    : bttsProb * 0.7 + baseProb * 0.3;

  const isFriendly = p.fixture.leagueId === 667;
  return isFriendly && hasMediaCoverage(p) ? score + 10 : score;
}

// Choisit les 2 meilleurs matchs PAS DÉJÀ UTILISÉS dans un combiné précédent du même
// sport/jour — pour ne jamais répéter exactement la même paire dans la même journée.
// leagueIds (optionnel, un Set) restreint les candidats à un ensemble de compétitions précis
// (foot -> Coupe du Monde + championnat brésilien + amicaux de clubs, voir
// FOOTBALL_COMBO_LEAGUE_IDS) : moins de 2 candidats dans ces ligues -> pas de combiné du tout
// ce jour-là, volontairement pas de repli sur d'autres compétitions. rankFn (optionnel) change
// le critère de tri des candidats sans changer ce qui est combiné (pick + probabilité 1X2
// restent affichés tels quels) — voir footballComboRank pour le foot.
function buildComboMatches(predictions, usedIds, leagueIds, rankFn = pickProbability) {
  const candidates = predictions
    .filter((p) => isComboCandidate(p, usedIds, leagueIds))
    .map((p) => ({ p, prob: pickProbability(p), rank: rankFn(p) }))
    .sort((a, b) => b.rank - a.rank);

  if (candidates.length < 2) return null;

  const [first, second] = candidates;
  const combinedProbability = Math.round((first.prob / 100) * (second.prob / 100) * 100);
  const risk = combinedProbability >= 40 ? 'Faible' : combinedProbability >= 20 ? 'Moyenne' : 'Élevée';

  const matches = [first, second].map(({ p, prob }) => ({
    fixtureId: p.fixture.id,
    fixture: p.fixture,
    pick: p.recommendation.pick,
    confidence: p.recommendation.confidence,
    probability: prob,
  }));

  return { matches, combinedProbability, risk };
}

async function enrichMatchStatus(sport, match) {
  try {
    const raw = await sport.byId(match.fixtureId);
    if (!raw) return { ...match, finished: false, validated: null };

    const finished = FINISHED_STATUSES.includes(raw.fixture.status.short);
    if (!finished) return { ...match, finished: false, validated: null };

    const home = raw.goals?.home;
    const away = raw.goals?.away;
    if (home == null || away == null) return { ...match, finished: true, validated: null };

    const actualPick = home > away ? '1' : away > home ? '2' : 'X';
    const validated = match.pick.startsWith(actualPick);
    return { ...match, finished: true, validated, actualScore: { home, away } };
  } catch {
    return { ...match, finished: false, validated: null };
  }
}

function summarize(matches) {
  const validatedCount = matches.filter((m) => m.validated === true).length;
  const allFinished = matches.every((m) => m.finished);
  const anyFailed = matches.some((m) => m.finished && m.validated === false);
  const status = !allFinished ? 'active' : anyFailed ? 'lost' : 'won';
  return { validatedCount, finishedCount: matches.filter((m) => m.finished).length, totalCount: matches.length, status };
}

// Renvoie tous les combinés du jour pour ce sport (historique + actif), en générant un
// nouveau combiné seulement si le précédent est résolu (gagné ou perdu) — jamais pendant
// qu'un combiné est encore en cours.
async function getOrCreateComboSeries(sport, date) {
  const stored = await getCombosForSport(date, sport.key);

  const enriched = [];
  for (const row of stored) {
    const matches = await Promise.all(row.matches.map((m) => enrichMatchStatus(sport, m)));
    enriched.push({
      matches,
      combinedProbability: row.combined_probability,
      risk: row.risk,
      ...summarize(matches),
    });
  }

  const last = enriched[enriched.length - 1];
  const needsNewCombo = !last || last.status !== 'active';

  if (needsNewCombo) {
    const usedIds = new Set(stored.flatMap((row) => row.matches.map((m) => String(m.fixtureId))));
    const { results } = await sport.analyzeDay(date);
    const leagueFilter = sport.key === 'football' ? FOOTBALL_COMBO_LEAGUE_IDS : undefined;
    const rankFn = sport.key === 'football' ? footballComboRank : undefined;
    const built = buildComboMatches(results, usedIds, leagueFilter, rankFn);
    if (built) {
      await saveCombo(date, sport.key, sport.label, built.matches, built.combinedProbability, built.risk);
      const matches = built.matches.map((m) => ({ ...m, finished: false, validated: null }));
      enriched.push({ matches, combinedProbability: built.combinedProbability, risk: built.risk, ...summarize(matches) });
    }
  }

  return enriched;
}

// Pré-génère (en tâche de fond, sans bloquer la réponse) les combinés des 2 jours suivants
// pour que l'utilisateur les trouve déjà prêts en changeant de date, plutôt que d'attendre
// l'analyse complète (70-200s pour le foot) au moment où il clique.
const prewarmedDates = new Set();

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

// File d'attente séquentielle : un seul (date, sport) à la fois. Lancer les 14 combinaisons
// (2 jours × 7 sports) toutes en même temps a fait planter le serveur (trop de Puppeteer
// concurrent) — ici on les traite une par une, sans jamais bloquer les requêtes des utilisateurs.
let prewarmQueue = [];
let prewarmRunning = false;

async function runPrewarmQueue() {
  if (prewarmRunning) return;
  prewarmRunning = true;
  while (prewarmQueue.length > 0) {
    const { sport, date } = prewarmQueue.shift();
    try {
      await getOrCreateComboSeries(sport, date);
    } catch {
      // tant pis pour ce sport/jour, on continue la file
    }
  }
  prewarmRunning = false;
}

function prewarmFutureDays(baseDate) {
  for (const offset of [1, 2]) {
    const futureDate = addDays(baseDate, offset);
    if (prewarmedDates.has(futureDate)) continue;
    prewarmedDates.add(futureDate);
    SPORTS.forEach((sport) => prewarmQueue.push({ sport, date: futureDate }));
  }
  runPrewarmQueue();
}

router.get('/today', async (req, res) => {
  try {
    const requestedDate = req.query.date;
    const date = requestedDate || new Date().toISOString().split('T')[0];
    const plan = req.user?.plan || 'free';
    const isAdmin = !!req.user?.isAdmin;

    const accessibleSports = SPORTS.filter((s) => isAdmin || canAccessSport(plan, s.key));

    const groupsRaw = await Promise.all(
      accessibleSports.map(async (sport) => {
        try {
          const series = await getOrCreateComboSeries(sport, date);
          if (series.length === 0) return null;
          return { sport: sport.label, sportKey: sport.key, combos: series };
        } catch {
          return null;
        }
      })
    );

    const groups = groupsRaw.filter(Boolean);
    const limit = comboLimitFor(plan, isAdmin);
    const limitedGroups = limit === Infinity ? groups : groups.slice(0, limit);

    // Désactivé temporairement (a surchargé le serveur en lançant trop de scraping
    // concurrent) — à réactiver une fois la file testée plus prudemment.
    // if (!requestedDate) prewarmFutureDays(date);

    res.json({
      date,
      groups: limitedGroups,
      totalAvailable: groups.length,
      limit: limit === Infinity ? null : limit,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pré-génération automatique chaque nuit à 3h (heure creuse, peu de visiteurs) — le serveur
// s'en occupe seul, pas besoin que quelqu'un (humain ou IA) soit éveillé pour la déclencher.
// File séquentielle (un sport/jour à la fois) : voir l'incident plus haut, jamais en parallèle.
function msUntilNext3am() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function scheduleDailyPrewarm() {
  setTimeout(() => {
    const today = new Date().toISOString().split('T')[0];
    prewarmFutureDays(today);
    setInterval(() => {
      const d = new Date().toISOString().split('T')[0];
      prewarmFutureDays(d);
    }, 24 * 3600 * 1000);
  }, msUntilNext3am());
}

// Jest met NODE_ENV=test automatiquement — on évite d'armer un setInterval qui ne se
// termine jamais et empêche le process de test de quitter proprement.
if (process.env.NODE_ENV !== 'test') {
  scheduleDailyPrewarm();
}

module.exports = router;
module.exports.pickProbability = pickProbability;
module.exports.isComboCandidate = isComboCandidate;
module.exports.buildComboMatches = buildComboMatches;
module.exports.summarize = summarize;
module.exports.addDays = addDays;
module.exports.hasMediaCoverage = hasMediaCoverage;
module.exports.footballComboRank = footballComboRank;
