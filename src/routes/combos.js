const express = require('express');
const router = express.Router();
const { canAccessSport, comboLimitFor, hasAccess } = require('../auth/tiers');
const { getCombosForSport, saveCombo, markComboNotified } = require('../db/combos');
const { mapWithConcurrency } = require('../utils/concurrency');
const { notifyAllUsers } = require('../push/webPush');

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

// Analyse un match précis par id, sans passer par la sélection automatique du jour (plafonnée,
// voir MAX_FIXTURES_PER_DAY côté foot) — sert quand un match trouvé via la recherche à la
// demande (listComboCandidates/searchComboCandidatesRemote) est ensuite inclus dans un combiné
// manuel : sans ça, createManualCombo ne le retrouvait pas en rechargeant analyzeDay et
// échouait avec "Match X introuvable", alors que ce match existe bel et bien.
function byIdAnalyzer(byIdFn, analyzeFn) {
  return async (id) => {
    const raw = await byIdFn(id);
    return raw ? analyzeFn(raw) : null;
  };
}

const SPORTS = [
  { key: 'football', label: '⚽ Football', analyzeDay: football.analyzeDayFixtures, search: football.searchFixtures, byId: (id) => footballApi.getFixtureById(id), analyzeById: byIdAnalyzer((id) => footballApi.getFixtureById(id), football.analyzeFixture) },
  { key: 'nfl', label: '🏈 NFL', analyzeDay: nfl.analyzeDayGames, search: nfl.searchGames, byId: (id) => nflApi.getGameById(id), analyzeById: byIdAnalyzer((id) => nflApi.getGameById(id), nfl.analyzeGame) },
  { key: 'nba', label: '🏀 Basketball', analyzeDay: nba.analyzeDayGames, search: nba.searchGames, byId: (id) => nbaApi.getGameById(id), analyzeById: byIdAnalyzer((id) => nbaApi.getGameById(id), nba.analyzeGame) },
  { key: 'hockey', label: '🏒 Hockey', analyzeDay: hockey.analyzeDayGames, search: hockey.searchGames, byId: (id) => hockeyApi.getGameById(id), analyzeById: byIdAnalyzer((id) => hockeyApi.getGameById(id), hockey.analyzeGame) },
  { key: 'baseball', label: '⚾ Baseball', analyzeDay: baseball.analyzeDayGames, search: baseball.searchGames, byId: (id) => baseballApi.getGameById(id), analyzeById: byIdAnalyzer((id) => baseballApi.getGameById(id), baseball.analyzeGame) },
  { key: 'handball', label: '🤾 Handball', analyzeDay: handball.analyzeDayGames, search: handball.searchGames, byId: (id) => handballApi.getGameById(id), analyzeById: byIdAnalyzer((id) => handballApi.getGameById(id), handball.analyzeGame) },
  { key: 'tennis', label: '🎾 Tennis', analyzeDay: tennis.analyzeDayGames, search: tennis.searchGames, byId: (id) => tennisApi.getGameById(id), analyzeById: byIdAnalyzer((id) => tennisApi.getGameById(id), tennis.analyzeGame) },
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
// qu'une probabilité inventée pour les sports/matchs qui n'ont pas cette donnée. Lignes générées
// dynamiquement (0.5 à 5.5) depuis les champs over05..over55 déjà calculés par goals.js —
// g[field] == null (ex. mode web dégradé sans cette ligne) -> resolveBetSelection le traite
// comme "marché indisponible" plutôt que de renvoyer une probabilité manquante.
const TOTAL_LINE_KEYS = ['05', '15', '25', '35', '45', '55'];
function formatLine(key) { return `${key[0]},${key.slice(1)}`; } // '05' -> '0,5', '35' -> '3,5'...

const GOAL_MARKETS = {
  btts_yes: (g) => ({ pick: 'BTTS Oui', probability: g.btts }),
  btts_no: (g) => ({ pick: 'BTTS Non', probability: 100 - g.btts }),
};
for (const line of TOTAL_LINE_KEYS) {
  const field = `over${line}`;
  GOAL_MARKETS[`over${line}`] = (g) => (g[field] == null ? null : { pick: `+${formatLine(line)} buts`, probability: g[field] });
  GOAL_MARKETS[`under${line}`] = (g) => (g[field] == null ? null : { pick: `-${formatLine(line)} buts`, probability: 100 - g[field] });
}

// Marchés combinés (1X2/Double Chance/Total × BTTS) — PAS une vraie probabilité conjointe :
// simple produit des deux probabilités individuelles (P(A) × P(B)), en supposant l'indépendance.
// C'est une approximation (score et BTTS ne sont pas réellement indépendants) — le pick renvoyé
// porte explicitement "(estimation)" pour ne jamais laisser croire à une précision qu'on n'a
// pas, contrairement aux autres marchés qui viennent d'un vrai calcul ou de vraies cotes.
function combinedPick(baseLabel, baseProb, bttsLabel, bttsProb) {
  return {
    pick: `${baseLabel} + BTTS ${bttsLabel} (estimation)`,
    probability: Math.round((baseProb / 100) * (bttsProb / 100) * 100),
  };
}

function doubleChanceProb(p, side) {
  const home = p.probabilities.home;
  const draw = p.probabilities.draw ?? 0;
  const away = p.probabilities.away;
  if (side === '1x') return Math.min(100, home + draw);
  if (side === '12') return Math.min(100, home + away);
  return Math.min(100, draw + away); // '2x'
}

const COMBINED_MARKETS = {
  '1_btts_yes':       (p, g) => combinedPick('1', p.probabilities.home, 'Oui', g.btts),
  '1_btts_no':        (p, g) => combinedPick('1', p.probabilities.home, 'Non', 100 - g.btts),
  'x_btts_yes':        (p, g) => combinedPick('X', p.probabilities.draw ?? 0, 'Oui', g.btts),
  'x_btts_no':         (p, g) => combinedPick('X', p.probabilities.draw ?? 0, 'Non', 100 - g.btts),
  '2_btts_yes':        (p, g) => combinedPick('2', p.probabilities.away, 'Oui', g.btts),
  '2_btts_no':         (p, g) => combinedPick('2', p.probabilities.away, 'Non', 100 - g.btts),
  'dc_1x_btts_yes':    (p, g) => combinedPick('1X', doubleChanceProb(p, '1x'), 'Oui', g.btts),
  'dc_1x_btts_no':     (p, g) => combinedPick('1X', doubleChanceProb(p, '1x'), 'Non', 100 - g.btts),
  'dc_12_btts_yes':    (p, g) => combinedPick('12', doubleChanceProb(p, '12'), 'Oui', g.btts),
  'dc_12_btts_no':     (p, g) => combinedPick('12', doubleChanceProb(p, '12'), 'Non', 100 - g.btts),
  'dc_2x_btts_yes':    (p, g) => combinedPick('2X', doubleChanceProb(p, '2x'), 'Oui', g.btts),
  'dc_2x_btts_no':     (p, g) => combinedPick('2X', doubleChanceProb(p, '2x'), 'Non', 100 - g.btts),
  'over25_btts_yes':   (p, g) => combinedPick('+2,5 buts', g.over25, 'Oui', g.btts),
  'over25_btts_no':    (p, g) => combinedPick('+2,5 buts', g.over25, 'Non', 100 - g.btts),
  'under25_btts_yes':  (p, g) => combinedPick('-2,5 buts', 100 - g.over25, 'Oui', g.btts),
  'under25_btts_no':   (p, g) => combinedPick('-2,5 buts', 100 - g.over25, 'Non', 100 - g.btts),
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
  // Double chance : dérivé arithmétique réel des probabilités 1X2 déjà calculées (pas une
  // approximation, contrairement aux marchés combinés avec BTTS ci-dessous).
  if (betType === 'dc_1x') return { pick: '1X (Double Chance)', probability: doubleChanceProb(p, '1x') };
  if (betType === 'dc_12') return { pick: '12 (Double Chance)', probability: doubleChanceProb(p, '12') };
  if (betType === 'dc_2x') return { pick: '2X (Double Chance)', probability: doubleChanceProb(p, '2x') };
  if (betType.startsWith('sets_')) {
    const result = await resolveSetsMarket(p.fixture.id, betType);
    if (!result) throw new Error(`Marché "${betType}" inconnu`);
    return result;
  }
  if (COMBINED_MARKETS[betType]) {
    if (!p.goalPrediction) {
      throw new Error(`Marché "${betType}" indisponible pour ${p.fixture.home} - ${p.fixture.away} (pas de prédiction de buts pour ce match)`);
    }
    return COMBINED_MARKETS[betType](p, p.goalPrediction);
  }
  const goalMarket = GOAL_MARKETS[betType];
  if (!goalMarket) throw new Error(`Marché "${betType}" inconnu`);
  if (!p.goalPrediction) {
    throw new Error(`Marché "${betType}" indisponible pour ${p.fixture.home} - ${p.fixture.away} (pas de prédiction de buts pour ce match)`);
  }
  const result = goalMarket(p.goalPrediction);
  if (!result) throw new Error(`Marché "${betType}" indisponible (ligne non calculée pour ce match)`);
  return result;
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
    goalPrediction: p.goalPrediction
      ? {
          btts: p.goalPrediction.btts,
          over05: p.goalPrediction.over05,
          over15: p.goalPrediction.over15,
          over25: p.goalPrediction.over25,
          over35: p.goalPrediction.over35,
          over45: p.goalPrediction.over45,
          over55: p.goalPrediction.over55,
        }
      : null,
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
    let p = analyses[key].find((r) => String(r.fixture?.id) === String(fixtureId));
    if (!p) {
      // Absent de la sélection automatique du jour (plafonnée, ex. MAX_FIXTURES_PER_DAY pour le
      // foot) — a pu être trouvé via la recherche à la demande (voir listComboCandidates) :
      // on analyse ce match précis directement plutôt que d'échouer alors qu'il existe bien.
      const sport = SPORTS.find((s) => s.key === key);
      p = await sport.analyzeById(fixtureId).catch(() => null);
    }
    if (!p) throw new Error(`Match ${fixtureId} introuvable dans l'analyse ${key} du ${date}`);
    if (p.error || !p.probabilities || p.matchState === 'finished') {
      // Nom des équipes plutôt que l'id brut — sans ça, impossible de savoir lequel des
      // matchs sélectionnés retirer quand un combiné de plusieurs matchs est refusé (ex. un
      // match a eu le temps de se terminer pendant la construction du combiné).
      const label = p.fixture?.home && p.fixture?.away ? `${p.fixture.home} — ${p.fixture.away}` : `Match ${fixtureId}`;
      const reason = p.matchState === 'finished' ? 'est déjà terminé' : "n'a pas de probabilités exploitables";
      throw new Error(`${label} ${reason} — retire-le du combiné et réessaie`);
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

  // Notifie TOUS les utilisateurs dès la création d'un combiné Spécial (gratuit compris — créer
  // l'envie), à la fois dans leur boîte de notifications in-app et en push s'ils y sont abonnés
  // — jamais bloquant pour la réponse admin (pas d'await), échecs individuels gérés dans
  // webPush.js. Combiné encore actif -> pas encore visible en gratuit (voir /today plus bas),
  // donc le clic renvoie vers la page tarifs plutôt que vers un contenu verrouillé.
  if (special) {
    notifyAllUsers((user) => ({
      title: '🌟 Nouveau combiné spécial',
      body: `${matches.length} matchs · ${combinedProbability}% de probabilité combinée`,
      url: (user.is_admin || hasAccess(user.plan, 'premium')) ? '/?sport=combos' : '/pricing.html',
    })).catch((err) => console.error('Notification (combiné spécial créé) ignorée:', err.message));
  }

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

// Le score final valide-t-il match.betType ? (home/away = buts pour les sports à but, sets
// gagnés pour le tennis — voir api/tennisClient.js normalizeFixture). Remplace l'ancienne
// validation "match.pick.startsWith(actualPick)" qui ne savait comparer QUE des picks 1X2 :
// devenue fausse pour BTTS/Totaux/Double Chance/marchés combinés/sets depuis leur ajout au
// combiné manuel (elle marquait ces marchés "non validé" quasi systématiquement, quel que soit
// le résultat réel réel). betType absent (combinés automatiques, ou 'algo' explicite) -> même
// comportement qu'avant, sur le pick 1X2 recommandé par l'algo.
function base1x2Hit(baseKey, actual1x2) {
  if (baseKey === '1') return actual1x2 === '1';
  if (baseKey === 'x') return actual1x2 === 'X';
  if (baseKey === '2') return actual1x2 === '2';
  if (baseKey === 'dc_1x') return actual1x2 !== '2';
  if (baseKey === 'dc_12') return actual1x2 !== 'X';
  if (baseKey === 'dc_2x') return actual1x2 !== '1';
  return null;
}

// Un marché est "verrouillé" avant la fin du match si son issue ne peut plus changer quel que
// soit ce qui se passe ensuite dans le match — seulement les issues qui ne peuvent aller que
// dans un sens (un but déjà marqué ou un set déjà joué ne s'annule pas). BTTS Non / Under X /
// 1X2 / Double Chance / marchés combinés restent volontairement exclus : leur issue peut encore
// changer jusqu'au coup de sifflet final, mieux vaut rester "en attente" qu'annoncer trop tôt.
function isOutcomeLockedIn(betType, home, away) {
  const type = betType || 'algo';
  if (type === 'btts_yes') return home > 0 && away > 0;

  const totalMatch = /^over(05|15|25|35|45|55)$/.exec(type);
  if (totalMatch) {
    const line = Number(`${totalMatch[1][0]}.${totalMatch[1].slice(1)}`);
    return (home + away) > line;
  }

  // Tennis : home/away = sets gagnés par joueur -> total = nombre de sets déjà joués
  const setsMatch = /^sets_over_([\d.]+)$/.exec(type);
  if (setsMatch) return (home + away) > Number(setsMatch[1]);

  return false;
}

function validateBetOutcome(betType, pick, home, away) {
  const actual1x2 = home > away ? '1' : away > home ? '2' : 'X';
  const type = betType || 'algo';

  if (type === 'algo') return pick.startsWith(actual1x2);

  const simpleKey = type === '1' ? '1' : type === 'X' ? 'x' : type === '2' ? '2' : type;
  const simpleHit = base1x2Hit(simpleKey, actual1x2);
  if (simpleHit !== null) return simpleHit;

  const totalGoals = home + away;
  const bttsHit = home > 0 && away > 0;

  if (type === 'btts_yes') return bttsHit;
  if (type === 'btts_no') return !bttsHit;

  const totalMatch = /^(over|under)(05|15|25|35|45|55)$/.exec(type);
  if (totalMatch) {
    const [, side, lineKey] = totalMatch;
    const line = Number(`${lineKey[0]}.${lineKey.slice(1)}`);
    return side === 'over' ? totalGoals > line : totalGoals < line;
  }

  // Tennis : home/away = sets gagnés par joueur -> total = nombre de sets joués
  const setsMatch = /^sets_(over|under)_([\d.]+)$/.exec(type);
  if (setsMatch) {
    const [, side, lineStr] = setsMatch;
    const totalSets = home + away;
    const line = Number(lineStr);
    return side === 'over' ? totalSets > line : totalSets < line;
  }

  const combinedMatch = /^(1|x|2|dc_1x|dc_12|dc_2x|over25|under25)_btts_(yes|no)$/.exec(type);
  if (combinedMatch) {
    const [, base, bttsSide] = combinedMatch;
    const baseHit = base === 'over25' ? totalGoals > 2.5
      : base === 'under25' ? totalGoals < 2.5
      : base1x2Hit(base, actual1x2);
    const bttsSideHit = bttsSide === 'yes' ? bttsHit : !bttsHit;
    return baseHit && bttsSideHit;
  }

  // Marché non reconnu (ne devrait pas arriver) -> repli sur l'ancien comportement 1X2 plutôt
  // que de planter la résolution du combiné
  return pick.startsWith(actual1x2);
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
    const home = raw.goals?.home;
    const away = raw.goals?.away;

    if (!finished) {
      // Match encore en cours : certains marchés sont déjà mathématiquement acquis avant la
      // fin (un but ou un set déjà joué ne s'annule pas, voir isOutcomeLockedIn) — affiche ce
      // signal par match sans jamais déclarer le COMBINÉ entier gagné avant la fin réelle de
      // tous ses matchs (summarize() exige toujours finished=true partout pour ça).
      if (home != null && away != null && isOutcomeLockedIn(match.betType, home, away)) {
        return { ...match, finished: false, validated: true, actualScore: { home, away } };
      }
      return { ...match, finished: false, validated: null };
    }

    if (home == null || away == null) return { ...match, finished: true, validated: null };

    const validated = validateBetOutcome(match.betType, match.pick, home, away);
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

    // Combinés spéciaux (voir createManualCombo options.special) : section à part, indépendante
    // de comboLimitFor (qui ne concerne que le nombre de groupes par sport). Premium/VIP voit
    // tout. Gratuit : un combiné encore actif reste verrouillé (urgence de payer POUR le voir
    // avant sa résolution) mais un combiné déjà résolu (gagné/perdu) devient visible — vitrine
    // de la qualité des pronostics, incite à l'abonnement sans frustrer un clic depuis la
    // notification push (voir push/webPush.js) une fois le combiné terminé.
    let special = null;
    let specialLocked = false;
    try {
      const specialSeries = await getSpecialComboSeries(date);
      if (specialSeries.length > 0) {
        if (isAdmin || hasAccess(plan, 'premium')) {
          special = { sport: SPECIAL_LABEL, sportKey: 'special', combos: specialSeries };
        } else {
          const resolved = specialSeries.filter((c) => c.status !== 'active');
          if (resolved.length > 0) {
            special = { sport: SPECIAL_LABEL, sportKey: 'special', combos: resolved };
          }
          specialLocked = specialSeries.some((c) => c.status === 'active');
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

// Vérifie si des combinés Spéciaux non encore notifiés sont désormais résolus (gagné/perdu),
// et notifie les abonnés Premium/VIP une seule fois par combiné (colonne resolution_notified)
// — indépendant de tout visiteur, comme resolveRecentResults() pour les pronostics simples
// (voir server.js) : sinon un combiné résolu une nuit calme ne notifierait jamais personne.
async function checkSpecialComboResolutions(date) {
  const stored = await getCombosForSport(date, 'special');
  for (const row of stored) {
    if (row.resolution_notified) continue;
    const matches = await Promise.all(row.matches.map((m) => enrichMatchStatus(null, m)));
    const { status } = summarize(matches);
    if (status === 'active') continue;

    await markComboNotified(row.id);
    const outcome = status === 'won' ? '🏆 gagné' : '❌ perdu';
    // Résolu -> visible en gratuit aussi (voir /today plus haut), donc même URL pour tout le
    // monde : pas besoin de builder par utilisateur ici, contrairement à la notif de création.
    notifyAllUsers(() => ({
      title: `Combiné spécial ${outcome}`,
      body: `${row.matches.length} matchs · ${row.combined_probability}% — résultat disponible`,
      url: '/?sport=combos',
    })).catch((err) => console.error('Notification (résolution combiné spécial) ignorée:', err.message));
  }
}

// Toutes les 10 min : assez réactif pour une notification, sans surcharger les API de score.
// Vérifie aujourd'hui ET hier (un combiné lancé tard peut se résoudre après minuit).
const SPECIAL_COMBO_CHECK_INTERVAL_MS = 10 * 60 * 1000;

function scheduleSpecialComboResolutionChecks() {
  const runCheck = () => {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = addDays(today, -1);
    checkSpecialComboResolutions(today).catch((err) => console.error('Vérification résolution combinés spéciaux (ignorée):', err.message));
    checkSpecialComboResolutions(yesterday).catch((err) => console.error('Vérification résolution combinés spéciaux (ignorée):', err.message));
  };
  runCheck(); // rattrape ce qui s'est résolu pendant que le serveur était éteint
  setInterval(runCheck, SPECIAL_COMBO_CHECK_INTERVAL_MS);
}

// Jest met NODE_ENV=test automatiquement — on évite d'armer un setInterval qui ne se
// termine jamais et empêche le process de test de quitter proprement.
if (process.env.NODE_ENV !== 'test') {
  scheduleDailyPrewarm();
  scheduleSpecialComboResolutionChecks();
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
module.exports.validateBetOutcome = validateBetOutcome;
module.exports.isOutcomeLockedIn = isOutcomeLockedIn;
