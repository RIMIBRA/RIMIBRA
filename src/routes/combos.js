const express = require('express');
const router = express.Router();
const { canAccessSport, comboLimitFor, hasAccess } = require('../auth/tiers');
const { getCombosForSport, saveCombo } = require('../db/combos');
const { mapWithConcurrency } = require('../utils/concurrency');

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
  { key: 'football', label: '⚽ Football', analyzeDay: football.analyzeDayFixtures, search: football.searchFixtures, byId: (id) => footballApi.getFixtureById(id) },
  { key: 'nfl', label: '🏈 NFL', analyzeDay: nfl.analyzeDayGames, search: nfl.searchGames, byId: (id) => nflApi.getGameById(id) },
  { key: 'nba', label: '🏀 Basketball', analyzeDay: nba.analyzeDayGames, search: nba.searchGames, byId: (id) => nbaApi.getGameById(id) },
  { key: 'hockey', label: '🏒 Hockey', analyzeDay: hockey.analyzeDayGames, search: hockey.searchGames, byId: (id) => hockeyApi.getGameById(id) },
  { key: 'baseball', label: '⚾ Baseball', analyzeDay: baseball.analyzeDayGames, search: baseball.searchGames, byId: (id) => baseballApi.getGameById(id) },
  { key: 'handball', label: '🤾 Handball', analyzeDay: handball.analyzeDayGames, search: handball.searchGames, byId: (id) => handballApi.getGameById(id) },
  { key: 'tennis', label: '🎾 Tennis', analyzeDay: tennis.analyzeDayGames, search: tennis.searchGames, byId: (id) => tennisApi.getGameById(id) },
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

// Marchés qu'un combiné manuel peut cibler par match (voir createManualCombo) — BTTS et total
// de buts viennent de la prédiction Poisson (goalPrediction, voir algorithm/goals.js), calculée
// uniquement pour le foot avec données de forme suffisantes. Absente -> erreur explicite plutôt
// qu'une probabilité inventée pour les sports/matchs qui n'ont pas cette donnée.
const GOAL_MARKETS = {
  btts_yes: (g) => ({ pick: 'BTTS Oui', probability: g.btts }),
  btts_no: (g) => ({ pick: 'BTTS Non', probability: 100 - g.btts }),
  over25: (g) => ({ pick: '+2,5 buts', probability: g.over25 }),
  under25: (g) => ({ pick: '-2,5 buts', probability: 100 - g.over25 }),
};

// Marché "nombre de sets" (tennis uniquement) — betType encode la ligne choisie, ex.
// "sets_over_2.5" / "sets_under_3.5" (voir api/tennisClient.js getSetsMarkets : cotes réelles
// du marché "Over/Under" de l'API, qui est un total de SETS pour le tennis, pas de jeux). Pas
// de modèle maison pour ce marché (contrairement aux buts au foot) -> probabilité implicite de
// la cote bookmaker, seule donnée réelle disponible.
async function resolveSetsMarket(fixtureId, betType) {
  const m = /^sets_(over|under)_([\d.]+)$/.exec(betType);
  if (!m) return null;
  const [, side, line] = m;
  const markets = await tennisApi.getSetsMarkets(fixtureId).catch(() => null);
  const entry = markets?.find((mk) => mk.side === side && mk.line === line);
  if (!entry) {
    throw new Error(`Marché "${betType}" indisponible (pas de cote à cette ligne pour ce match)`);
  }
  return { pick: `${side === 'over' ? '+' : '-'}${line} sets`, probability: entry.probability };
}

// Résout le pick + la probabilité affichée pour un match d'un combiné manuel, selon le marché
// choisi par le fondateur (betType) — 'algo'/absent conserve l'ancien comportement (le pick
// recommandé par l'algo). '1'/'X'/'2' piochent directement dans les probabilités 1X2 déjà
// calculées pour ce match, quel que soit le sport.
async function resolveBetSelection(p, betType) {
  if (!betType || betType === 'algo') {
    return { pick: p.recommendation.pick, probability: pickProbability(p) };
  }
  if (betType === '1') return { pick: '1 (Domicile)', probability: p.probabilities.home };
  if (betType === 'X') return { pick: 'X (Nul)', probability: p.probabilities.draw ?? 0 };
  if (betType === '2') return { pick: '2 (Extérieur)', probability: p.probabilities.away };
  if (betType.startsWith('sets_')) {
    const result = await resolveSetsMarket(p.fixture.id, betType);
    if (!result) throw new Error(`Marché "${betType}" inconnu`);
    return result;
  }
  const goalMarket = GOAL_MARKETS[betType];
  if (!goalMarket) throw new Error(`Marché "${betType}" inconnu`);
  if (!p.goalPrediction) {
    throw new Error(`Marché "${betType}" indisponible pour ${p.fixture.home} - ${p.fixture.away} (pas de prédiction de buts pour ce match)`);
  }
  return goalMarket(p.goalPrediction);
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

  // Barre de qualité pour Premium/VIP : un combiné sous 50% de probabilité combinée n'est
  // tout simplement pas généré ce jour-là (pas de repli sur une paire moins bonne) — mieux
  // vaut aucun combiné qu'un combiné médiocre pour des abonnés payants.
  if (combinedProbability < 50) return null;

  const risk = combinedProbability >= 70 ? 'Faible' : 'Moyenne';

  const matches = [first, second].map(({ p, prob }) => ({
    fixtureId: p.fixture.id,
    fixture: p.fixture,
    pick: p.recommendation.pick,
    confidence: p.recommendation.confidence,
    probability: prob,
  }));

  return { matches, combinedProbability, risk };
}

// Liste les matchs du jour utilisables dans un combiné manuel (voir createManualCombo) —
// TOUS les matchs analysés avec des probabilités, sans le filtre de ligues automatique :
// le fondateur choisit librement depuis le dashboard admin. query (optionnel) bascule sur la
// recherche à la demande de chaque sport (searchFixtures/searchGames) au lieu de la sélection
// automatique du jour (plafonnée à MAX_FIXTURES_PER_DAY, ex. 30 pour le foot) — retrouve un
// match précis même hors de cette sélection, comme la recherche publique de l'app.
async function listComboCandidates(sportKey, date, query) {
  const sport = SPORTS.find((s) => s.key === sportKey);
  if (!sport) throw new Error(`Sport inconnu : ${sportKey}`);
  const { results } = query ? await sport.search(date, query) : await sport.analyzeDay(date);
  const candidates = results.filter((p) => !p.error && !p.insufficientData && p.matchState !== 'finished' && p.probabilities);

  // Cotes réelles "nombre de sets" (tennis uniquement, voir resolveSetsMarket) — un appel par
  // match, concurrence limitée comme pour l'analyse elle-même (mapWithConcurrency) plutôt que
  // tout lancer d'un coup ; quota tennis large donc pas un souci de coût, juste de politesse
  // envers l'API externe.
  const withMarkets = await mapWithConcurrency(candidates, 10, async (p) => ({
    fixtureId: p.fixture.id,
    home: p.fixture.home,
    away: p.fixture.away,
    league: p.fixture.league,
    pick: p.recommendation.pick,
    confidence: p.recommendation.confidence,
    probability: pickProbability(p),
    // Exposés pour que le dashboard admin propose un marché par match (1/X/2, BTTS, total de
    // buts, nombre de sets) au lieu de figer le pick recommandé par l'algo — voir resolveBetSelection.
    probabilities: p.probabilities,
    goalPrediction: p.goalPrediction ? { btts: p.goalPrediction.btts, over25: p.goalPrediction.over25 } : null,
    setsMarkets: sportKey === 'tennis' ? await tennisApi.getSetsMarkets(p.fixture.id).catch(() => null) : null,
  }));

  return withMarkets.sort((a, b) => b.probability - a.probability);
}

// Combinés inter-sports : stockés en base sous sport='multi', chaque match du combiné porte
// alors son propre champ `sport` (voir enrichMatchStatus pour la résolution des résultats).
const MULTI_LABEL = '🌍 Multi-sports';
const SPECIAL_LABEL = '🌟 Spécial';
const COMBO_MAX_MATCHES = 5;

// Combiné créé manuellement par le fondateur (dashboard admin) — contourne volontairement le
// filtre de ligues ET la barre des 50% des combinés automatiques : un choix humain explicite
// prime sur les règles. selections: [{ sport, fixtureId, betType }], 2 à 5 matchs, éventuellement
// de sports différents (combiné enregistré sous 'multi' dans ce cas). betType (optionnel, par
// match) choisit le marché ciblé — 1/X/2, BTTS/total de buts (foot), nombre de sets (tennis),
// voir resolveBetSelection ; absent -> pick recommandé par l'algo, comme avant.
// options.special marque le combiné pour la section
// "Spécial" (voir getSpecialComboSeries) au lieu de son onglet sport/multi habituel.
async function createManualCombo(date, selections, options = {}) {
  if (!Array.isArray(selections) || selections.length < 2) {
    throw new Error('Au moins 2 matchs sont requis pour un combiné');
  }
  if (selections.length > COMBO_MAX_MATCHES) {
    throw new Error(`Maximum ${COMBO_MAX_MATCHES} matchs par combiné`);
  }

  const sportKeys = [...new Set(selections.map((s) => s.sport))];
  const analyses = {};
  for (const key of sportKeys) {
    const sport = SPORTS.find((s) => s.key === key);
    if (!sport) throw new Error(`Sport inconnu : ${key}`);
    analyses[key] = (await sport.analyzeDay(date)).results;
  }

  const matches = await Promise.all(selections.map(async ({ sport: key, fixtureId, betType }) => {
    const p = analyses[key].find((r) => String(r.fixture?.id) === String(fixtureId));
    if (!p) throw new Error(`Match ${fixtureId} introuvable dans l'analyse ${key} du ${date}`);
    if (p.error || !p.probabilities || p.matchState === 'finished') {
      throw new Error(`Match ${fixtureId} inutilisable (terminé ou sans probabilités exploitables)`);
    }
    const { pick, probability } = await resolveBetSelection(p, betType);
    return {
      fixtureId: p.fixture.id,
      fixture: p.fixture,
      sport: key,
      pick,
      confidence: p.recommendation.confidence,
      probability,
      betType: betType || 'algo',
    };
  }));

  const combinedProbability = Math.round(matches.reduce((acc, m) => acc * (m.probability / 100), 1) * 100);
  const risk = combinedProbability >= 70 ? 'Faible' : combinedProbability >= 50 ? 'Moyenne' : 'Élevée';

  const special = !!options.special;
  const singleSport = !special && sportKeys.length === 1 ? SPORTS.find((s) => s.key === sportKeys[0]) : null;
  const comboSport = special ? 'special' : (singleSport ? singleSport.key : 'multi');
  const comboLabel = special ? SPECIAL_LABEL : (singleSport ? singleSport.label : MULTI_LABEL);

  await saveCombo(date, comboSport, comboLabel, matches, combinedProbability, risk);
  return { sport: comboSport, matches, combinedProbability, risk };
}

// Rassemble les candidats de TOUS les sports pour le combiné multi automatique — mêmes règles
// par sport que les combinés classiques (dont le filtre de compétitions du foot) ; un sport en
// échec (quota épuisé, réseau) est simplement ignoré plutôt que de bloquer les autres.
async function collectMultiSportCandidates(date, usedIds) {
  const perSport = await Promise.all(SPORTS.map(async (sport) => {
    try {
      const { results } = await sport.analyzeDay(date);
      const leagueFilter = sport.key === 'football' ? FOOTBALL_COMBO_LEAGUE_IDS : undefined;
      return results
        .filter((p) => isComboCandidate(p, usedIds, leagueFilter))
        .map((p) => ({ p, sportKey: sport.key, prob: pickProbability(p) }));
    } catch {
      return [];
    }
  }));
  return perSport.flat().sort((a, b) => b.prob - a.prob);
}

// Combiné multi-sports automatique : les meilleurs matchs toutes disciplines confondues, de 2
// jusqu'à 5, en ajoutant tant que la probabilité combinée reste au-dessus de la barre des 50%
// (même seuil qualité que les combinés classiques — voir buildComboMatches).
function buildMultiComboMatches(candidates) {
  if (candidates.length < 2) return null;

  const chosen = [];
  let combined = 1;
  for (const c of candidates) {
    if (chosen.length >= COMBO_MAX_MATCHES) break;
    const next = combined * (c.prob / 100);
    if (chosen.length < 2) {
      chosen.push(c);
      combined = next;
    } else if (next >= 0.5) {
      chosen.push(c);
      combined = next;
    } else {
      break; // candidats triés par probabilité décroissante -> les suivants échoueraient aussi
    }
  }

  const combinedProbability = Math.round(combined * 100);
  if (chosen.length < 2 || combinedProbability < 50) return null;

  const matches = chosen.map(({ p, sportKey, prob }) => ({
    fixtureId: p.fixture.id,
    fixture: p.fixture,
    sport: sportKey,
    pick: p.recommendation.pick,
    confidence: p.recommendation.confidence,
    probability: prob,
  }));

  const risk = combinedProbability >= 70 ? 'Faible' : 'Moyenne';
  return { matches, combinedProbability, risk };
}

// Même logique de série que getOrCreateComboSeries, mais pour le pseudo-sport 'multi' : un
// nouveau combiné multi n'est généré que lorsque le précédent est résolu, et jamais avec des
// matchs déjà utilisés dans un combiné multi du même jour.
async function getOrCreateMultiComboSeries(date) {
  const stored = await getCombosForSport(date, 'multi');

  const enriched = [];
  for (const row of stored) {
    const matches = await Promise.all(row.matches.map((m) => enrichMatchStatus(null, m)));
    enriched.push({
      matches,
      combinedProbability: row.combined_probability,
      risk: row.risk,
      ...summarize(matches),
    });
  }

  const last = enriched[enriched.length - 1];
  if (!last || last.status !== 'active') {
    const usedIds = new Set(stored.flatMap((row) => row.matches.map((m) => String(m.fixtureId))));
    const candidates = await collectMultiSportCandidates(date, usedIds);
    const built = buildMultiComboMatches(candidates);
    if (built) {
      await saveCombo(date, 'multi', MULTI_LABEL, built.matches, built.combinedProbability, built.risk);
      const matches = built.matches.map((m) => ({ ...m, finished: false, validated: null }));
      enriched.push({ matches, combinedProbability: built.combinedProbability, risk: built.risk, ...summarize(matches) });
    }
  }

  return enriched;
}

// Combinés spéciaux : mis en avant par le fondateur (createManualCombo avec options.special),
// jamais générés automatiquement — juste l'historique du jour enrichi (comme pour le multi-
// sports), sans logique "en générer un nouveau si le dernier est résolu".
async function getSpecialComboSeries(date) {
  const stored = await getCombosForSport(date, 'special');
  const enriched = [];
  for (const row of stored) {
    const matches = await Promise.all(row.matches.map((m) => enrichMatchStatus(null, m)));
    enriched.push({
      matches,
      combinedProbability: row.combined_probability,
      risk: row.risk,
      ...summarize(matches),
    });
  }
  return enriched;
}

async function enrichMatchStatus(sport, match) {
  try {
    // Un match de combiné multi-sports porte son propre champ `sport` ; les combinés
    // mono-sport existants (matchs sans ce champ) retombent sur le sport de la série.
    const resolver = match.sport ? SPORTS.find((s) => s.key === match.sport) : sport;
    if (!resolver) return { ...match, finished: false, validated: null };
    const raw = await resolver.byId(match.fixtureId);
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

    let groups = groupsRaw.filter(Boolean);
    const limit = comboLimitFor(plan, isAdmin);

    // Combiné multi-sports (jusqu'à 5 matchs toutes disciplines) en tête de liste — seulement
    // pour les plans qui voient réellement des combinés : le générer pour un visiteur gratuit
    // consommerait l'analyse de tous les sports pour un résultat de toute façon masqué (limit 0).
    if (limit > 0) {
      try {
        const multiSeries = await getOrCreateMultiComboSeries(date);
        if (multiSeries.length > 0) {
          groups = [{ sport: MULTI_LABEL, sportKey: 'multi', combos: multiSeries }, ...groups];
        }
      } catch {
        // le combiné multi ne doit jamais casser l'affichage des combinés classiques
      }
    }

    const limitedGroups = limit === Infinity ? groups : groups.slice(0, limit);

    // Combinés spéciaux (voir createManualCombo options.special) : section à part, réservée
    // Premium/VIP comme les filtres Top 3/Top 2 (voir tiers.js hasAccess) — indépendante de
    // comboLimitFor, qui ne concerne que le nombre de groupes par sport. specialLocked signale
    // au client qu'il en existe aujourd'hui sans les révéler, pour l'inciter à passer Premium/VIP.
    let special = null;
    let specialLocked = false;
    try {
      const specialSeries = await getSpecialComboSeries(date);
      if (specialSeries.length > 0) {
        if (isAdmin || hasAccess(plan, 'premium')) {
          special = { sport: SPECIAL_LABEL, sportKey: 'special', combos: specialSeries };
        } else {
          specialLocked = true;
        }
      }
    } catch {
      // une panne sur les combinés spéciaux ne doit jamais casser l'affichage du reste
    }

    // Désactivé temporairement (a surchargé le serveur en lançant trop de scraping
    // concurrent) — à réactiver une fois la file testée plus prudemment.
    // if (!requestedDate) prewarmFutureDays(date);

    res.json({
      date,
      groups: limitedGroups,
      totalAvailable: groups.length,
      limit: limit === Infinity ? null : limit,
      special,
      specialLocked,
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
// Réutilisé par routes/admin.js (forçage manuel d'un combiné) pour ne pas dupliquer le mapping
// sport -> fonction d'analyse déjà défini ici.
module.exports.SPORTS = SPORTS;
module.exports.listComboCandidates = listComboCandidates;
module.exports.createManualCombo = createManualCombo;
module.exports.buildMultiComboMatches = buildMultiComboMatches;
module.exports.COMBO_MAX_MATCHES = COMBO_MAX_MATCHES;
module.exports.MULTI_LABEL = MULTI_LABEL;
module.exports.SPECIAL_LABEL = SPECIAL_LABEL;
module.exports.resolveBetSelection = resolveBetSelection;
module.exports.getSpecialComboSeries = getSpecialComboSeries;
