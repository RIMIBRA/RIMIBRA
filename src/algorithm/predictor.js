const api = require('../api/client');
const { analyzeForm } = require('./form');
const { analyzeH2H } = require('./h2h');
const { analyzeStandings } = require('./standings');
const { analyzeInjuries } = require('./injuries');
const { calcGoalPrediction } = require('./goals');
const scraper = require('../scraper/index');
const footballpred = require('../scraper/footballpred');
const { analyzeWebDay, analyzeWebDayWithFixtures } = require('./webPredictor');
const forebet = require('../scraper/forebet');
const oddsapi = require('../scraper/oddsapi');
const soccerway = require('../scraper/soccerway');
const { normalize, expandSearchTerms } = require('./teamAliases');
const { mapWithConcurrency } = require('../utils/concurrency');
const cache = require('../cache/db');
const predictionResults = require('../db/predictionResults');

// L'analyse complète d'une journée (jusqu'à 200s) est mise en cache 2 minutes : le premier
// visiteur paie le coût une fois, tous les suivants dans cette fenêtre ont une réponse quasi
// instantanée — plus efficace que les caches par sous-requête (forme/H2H...) déjà en place.
const FULL_ANALYSIS_TTL = 12 * 60; // 12 min : bon compromis vitesse/fraîcheur des statuts en direct

const HOME_ADVANTAGE = 6;
// Nombre de matchs analysés (et donc affichés) pour un visiteur -> garde le chargement rapide.
const MAX_FIXTURES_PER_DAY = 30;
// Les matchs s'analysent en parallèle (pas un par un) — limité pour ne pas saturer le
// navigateur Puppeteer partagé ni déclencher de blocage anti-bot sur les sites scrapés
const ANALYSIS_CONCURRENCY = 10;
// Volume supplémentaire suivi en tâche de fond (voir trackExtraFixturesForData) uniquement pour
// nourrir plus vite prediction_results — jamais exposé à un visiteur, donc sans impact sur le
// temps de chargement. Concurrence volontairement basse : tourne pendant que de vrais visiteurs
// utilisent peut-être le même navigateur Puppeteer partagé, ne doit jamais leur faire concurrence.
const BACKGROUND_TRACKING_LIMIT = 150;
const BACKGROUND_CONCURRENCY = 3;
const MAX_SEARCH_RESULTS = 5;
const UPCOMING_STATUSES = ['NS', 'TBD', '1H', 'HT', '2H'];
const LIVE_STATUSES = ['1H', 'HT', '2H'];
const FINISHED_STATUSES = ['FT', 'AET', 'PEN', 'AWD', 'WO'];

// Trois états pour permettre un filtre Terminés / En cours / À venir côté interface.
// Heuristique anti-données-périmées : certaines compétitions amateurs/amicales ne sont
// jamais mises à jour par le fournisseur (statut "NS" qui reste figé). Si le coup d'envoi
// est passé depuis plus de STALE_HOURS, on considère le match terminé plutôt que de le
// laisser polluer la liste "à venir" avec une heure manifestement dépassée.
const STALE_HOURS = 3;

function matchStateFor(statusShort, kickoffIso) {
  if (FINISHED_STATUSES.includes(statusShort)) return 'finished';
  if (LIVE_STATUSES.includes(statusShort)) return 'live';
  if (kickoffIso) {
    const hoursSinceKickoff = (Date.now() - new Date(kickoffIso).getTime()) / 3600000;
    if (hoursSinceKickoff > STALE_HOURS) return 'finished';
  }
  return 'upcoming';
}

// Compare chaque type de prédiction au résultat réel — uniquement calculable une fois le
// match terminé. Couvre l'issue (1X2) et, si une prédiction de buts a été faite, BTTS et +/-2,5.
function computeValidation(predictedPick, homeScore, awayScore, goalPrediction) {
  if (homeScore == null || awayScore == null) return null;
  let actualPick;
  if (homeScore > awayScore) actualPick = '1 (Domicile)';
  else if (awayScore > homeScore) actualPick = '2 (Extérieur)';
  else actualPick = 'X (Nul)';

  const result = {
    actualScore: { home: homeScore, away: awayScore },
    actualPick,
    correct: actualPick === predictedPick,
  };

  if (goalPrediction) {
    const actualBtts = homeScore > 0 && awayScore > 0;
    const actualOver25 = homeScore + awayScore > 2.5;

    // btts/over25 entre 41 et 54% = pas de pronostic tranché, rien à valider (correct: null)
    result.btts = goalPrediction.btts >= 55 || goalPrediction.btts <= 40
      ? {
          predicted: goalPrediction.btts >= 55 ? 'Oui' : 'Non',
          actual: actualBtts ? 'Oui' : 'Non',
          correct: (goalPrediction.btts >= 55) === actualBtts,
        }
      : null;

    result.over25 = {
      predicted: goalPrediction.over25 >= 55 ? 'Plus de 2,5' : 'Moins de 2,5',
      actual: actualOver25 ? 'Plus de 2,5' : 'Moins de 2,5',
      correct: (goalPrediction.over25 >= 55) === actualOver25,
    };
  }

  return result;
}

function buildFinishedEntry(f) {
  return {
    fixture: {
      id: f.fixture.id,
      date: f.fixture.date,
      league: `${f.league.name} — ${f.league.country}`,
      home: f.teams.home.name,
      away: f.teams.away.name,
      homeLogo: f.teams.home.logo,
      awayLogo: f.teams.away.logo,
    },
    finished: true,
    matchState: 'finished',
    finalScore: { home: f.goals.home, away: f.goals.away },
  };
}

// Compétitions jeunes / réserves : peu suivies (pas de cotes, pas d'historique exploitable),
// on les laisse passer en dernier pour privilégier les rencontres avec de vraies données
const MINOR_PATTERN = /\bU1[5-9]\b|\bU2[0-3]\b|\bYouth\b|\bJunior(?:s)?\b|\bReserves?\b|\bPrimavera\b|\bII\b/i;

function isLikelyMinor(fixture) {
  const text = `${fixture.league.name} ${fixture.teams.home.name} ${fixture.teams.away.name}`;
  return MINOR_PATTERN.test(text);
}

// Compétitions majeures : historique riche, cotes disponibles, suivi médiatique fort —
// les pronostics y sont nettement plus fiables que sur une ligue amateur obscure.
// Identifiants vérifiés directement via l'API (ne pas se fier aux noms, trop fragiles).
const PRIORITY_LEAGUE_IDS = new Set([
  1,   // Coupe du Monde
  4,   // Euro (Championnat d'Europe des nations)
  9,   // Copa America
  2,   // UEFA Champions League
  3,   // UEFA Europa League
  848, // UEFA Europa Conference League
  39,  // Premier League (Angleterre)
  140, // La Liga (Espagne)
  135, // Serie A (Italie)
  78,  // Bundesliga (Allemagne)
  61,  // Ligue 1 (France)
  88,  // Eredivisie (Pays-Bas)
  94,  // Primeira Liga (Portugal)
  203, // Süper Lig (Turquie)
  71,  // Brasileirão Série A (Brésil)
  128, // Liga Profesional (Argentine)
  253, // MLS (USA)
  262, // Liga MX (Mexique)
  98,  // J1 League (Japon)
]);

function isPriorityLeague(fixture) {
  return PRIORITY_LEAGUE_IDS.has(fixture.league.id);
}

// Trie les matchs à analyser en priorité : les rencontres "suivies" (cotes bookmaker,
// footballpredictions) passent devant, et les compétitions jeunes/réserves/obscures
// (qui n'ont ni historique ni cotes exploitables → analyse "données insuffisantes")
// sont reléguées en fin de liste, pour laisser la place aux matchs vraiment intéressants
// (ex : amicaux de sélections nationales avant une Coupe du Monde)
function fixtureRank(f, oddsapiList, fpredList) {
  let score = 0;
  // Coupe du Monde et grands championnats : priorité forte, ce sont les pronostics les plus fiables
  if (isPriorityLeague(f)) score += 10;
  if (oddsapi.findMatch(oddsapiList, f.teams.home.name, f.teams.away.name)) score += 2;
  if (footballpred.isInFpred(fpredList, f.teams.home.name, f.teams.away.name)) score += 1;
  if (isLikelyMinor(f)) score -= 3;
  return score;
}

function calcWeights(standingsAvailable) {
  if (standingsAvailable) {
    return { form: 0.35, standings: 0.25, h2h: 0.25, injuries: 0.15 };
  }
  return { form: 0.50, standings: 0, h2h: 0.35, injuries: 0.15 };
}

function calcProbabilities(homeScore, awayScore) {
  const adjustedHome = homeScore + HOME_ADVANTAGE;
  const total = adjustedHome + awayScore;

  const rawHome = adjustedHome / total;
  const rawAway = awayScore / total;
  const closeness = 1 - Math.abs(rawHome - rawAway);
  const drawFactor = 0.28 * closeness;

  const homeProb = rawHome * (1 - drawFactor);
  const awayProb = rawAway * (1 - drawFactor);
  const drawProb = drawFactor;

  return {
    home: Math.round(homeProb * 100),
    draw: Math.round(drawProb * 100),
    away: Math.round(awayProb * 100),
  };
}

function getRecommendation(probs, homeScore, awayScore, webSources, insufficientData) {
  if (insufficientData) {
    return { pick: 'Analyse non disponible', confidence: 'Faible' };
  }

  const diff = Math.abs(homeScore - awayScore);
  const hasWebData = webSources?.besoccer || webSources?.footballpred || webSources?.oddsapi;

  let confidence;
  if (diff > 20) confidence = 'Élevée';
  else if (diff > 10) confidence = hasWebData ? 'Élevée' : 'Moyenne';
  else confidence = hasWebData ? 'Moyenne' : 'Faible';

  let pick;
  if (probs.home >= probs.away && probs.home >= probs.draw) pick = '1 (Domicile)';
  else if (probs.away >= probs.home && probs.away >= probs.draw) pick = '2 (Extérieur)';
  else pick = 'X (Nul)';

  if (probs.draw > 28 && Math.abs(homeScore - awayScore) < 8) pick = 'X (Nul)';

  return { pick, confidence };
}

function hasNoData(formHome, formAway, h2h) {
  return (
    formHome.score === 50 &&
    formAway.score === 50 &&
    h2h.score1 === 50 &&
    h2h.score2 === 50
  );
}

async function analyzeFixture(fixture, fpredList = null, forebetList = null, oddsapiList = null) {
  const homeTeam = fixture.teams.home;
  const awayTeam = fixture.teams.away;
  const leagueId = fixture.league.id;
  const season = fixture.league.season;
  const fixtureId = fixture.fixture.id;
  const date = fixture.fixture.date.split('T')[0];
  // Ligues U15-23/jeunes/réserves OU ligues obscures sans aucune couverture (pas de cotes,
  // pas de footballpred, pas une compétition majeure) : le fallback Puppeteer (~10s) y trouve
  // très rarement quelque chose d'exploitable — pas la peine de payer ce coût en temps
  const minor = isLikelyMinor(fixture) || (
    !isPriorityLeague(fixture) &&
    !oddsapi.findMatch(oddsapiList, homeTeam.name, awayTeam.name) &&
    !footballpred.isInFpred(fpredList, homeTeam.name, awayTeam.name)
  );

  // API + enrichissement web en parallèle (fpredList déjà récupéré, pas de re-fetch)
  const [apiResults, webSources] = await Promise.allSettled([
    Promise.allSettled([
      api.getTeamLastMatches(homeTeam.id, 5),
      api.getTeamLastMatches(awayTeam.id, 5),
      api.getH2H(homeTeam.id, awayTeam.id, 10),
      api.getStandings(leagueId, season),
      api.getInjuries(fixtureId),
    ]).then((results) => results.map((r) => (r.status === 'fulfilled' ? r.value : null))),
    scraper.enrichFixture(homeTeam.name, awayTeam.name, date, fpredList, forebetList, oddsapiList, minor),
  ]).then((r) => r.map((x) => (x.status === 'fulfilled' ? x.value : null)));

  const [homeFixtures, awayFixtures, h2hFixtures, standingsData, injuriesData] = apiResults || [null, null, null, null, null];
  const web = webSources || {};

  let formHome = analyzeForm(homeFixtures, homeTeam.id);
  let formAway = analyzeForm(awayFixtures, awayTeam.id);

  // Soccerway comme fallback : si l'API n'a pas fourni de données de forme
  // (quota épuisé ou équipe non documentée), on essaie le scraper web — en parallèle pour
  // les deux équipes plutôt qu'enchaîné, ça divise par deux ce fallback (souvent le plus lent).
  // Sauté pour les ligues mineures, où il aboutit presque toujours à rien d'exploitable.
  const needsSwHome = !minor && formHome.score === 50 && (!homeFixtures || homeFixtures.length === 0);
  const needsSwAway = !minor && formAway.score === 50 && (!awayFixtures || awayFixtures.length === 0);
  const [swHome, swAway] = await Promise.all([
    needsSwHome ? soccerway.getTeamForm(homeTeam.name).catch(() => null) : null,
    needsSwAway ? soccerway.getTeamForm(awayTeam.name).catch(() => null) : null,
  ]);
  if (swHome) formHome = swHome;
  if (swAway) formAway = swAway;
  const h2h = analyzeH2H(h2hFixtures, homeTeam.id, awayTeam.id);
  const standings = analyzeStandings(standingsData, homeTeam.id, awayTeam.id);
  const injuries = analyzeInjuries(injuriesData, homeTeam.id, awayTeam.id);

  const weights = calcWeights(standings.available);

  const homeScore =
    formHome.score * weights.form +
    standings.score1 * weights.standings +
    h2h.score1 * weights.h2h +
    injuries.team1.score * weights.injuries;

  const awayScore =
    formAway.score * weights.form +
    standings.score2 * weights.standings +
    h2h.score2 * weights.h2h +
    injuries.team2.score * weights.injuries;

  const algoProbs = calcProbabilities(homeScore, awayScore);

  // Calculer les flags AVANT le blend pour décider comment pondérer
  const noApiData = hasNoData(formHome, formAway, h2h);
  const hasWebProbs = !!(
    web.footballpred?.probabilities ||
    web.forebet?.probabilities ||
    web.besoccer?.probabilities ||
    web.oddsapi?.probabilities
  );
  // Ni l'algo (forme/h2h inconnus) ni les sources web n'ont de signal exploitable :
  // une prédiction chiffrée serait trompeuse (toujours la même valeur par défaut)
  const insufficientData = noApiData && !hasWebProbs;

  // Quand l'algo n'a pas de données réelles (forme/H2H vides), ne pas le compter double
  // dans le blend — laisser les cotes bookmaker (oddsapi) exprimer leur signal sans être
  // noyées par le bruit 50/50 des valeurs par défaut de l'algo
  const finalProbs = scraper.blendProbabilities(algoProbs, web, !noApiData);
  const recommendation = getRecommendation(finalProbs, homeScore, awayScore, web, insufficientData);
  const goalPrediction = calcGoalPrediction(formHome, formAway);
  const matchState = matchStateFor(fixture.fixture.status.short, fixture.fixture.date);
  const validation = matchState === 'finished'
    ? computeValidation(recommendation.pick, fixture.goals?.home, fixture.goals?.away, goalPrediction)
    : null;

  const webSourceFlags = {
    footballpred: !!web.footballpred,
    forebet: !!web.forebet,
    besoccer: !!web.besoccer,
    oddsapi: !!web.oddsapi,
    flashscore: !!web.flashscore,
    soccerway: formHome.source === 'soccerway' || formAway.source === 'soccerway',
  };

  // Uniquement les vrais pronostics pris avant le match (pas "Analyse non disponible", pas
  // en direct) -> sert à mesurer plus tard, via /admin/prediction-accuracy, si les poids de
  // l'algo et le blend avec les sources externes sont réellement fiables.
  if (matchState === 'upcoming' && !insufficientData) {
    predictionResults
      .recordPrediction({
        sport: 'football',
        fixtureId,
        league: `${fixture.league.name} — ${fixture.league.country}`,
        homeTeam: homeTeam.name,
        awayTeam: awayTeam.name,
        predictedPick: recommendation.pick,
        confidence: recommendation.confidence,
        probabilities: finalProbs,
        goalPrediction,
        sources: webSourceFlags,
        noApiData,
      })
      .catch((err) => console.error('Échec enregistrement pronostic (ignoré):', err.message));
  }

  return {
    fixture: {
      id: fixtureId,
      date: fixture.fixture.date,
      league: `${fixture.league.name} — ${fixture.league.country}`,
      home: homeTeam.name,
      away: awayTeam.name,
      homeLogo: homeTeam.logo,
      awayLogo: awayTeam.logo,
    },
    matchState,
    validation,
    scores: {
      home: Math.round(homeScore),
      away: Math.round(awayScore),
    },
    probabilities: finalProbs,
    goalPrediction,
    recommendation,
    noApiData,
    insufficientData,
    webMode: false,
    webSources: webSourceFlags,
    odds: web.oddsapi?.rawOdds || web.flashscore?.rawOdds || null,
    breakdown: {
      form: { home: formHome, away: formAway },
      h2h,
      standings,
      injuries,
    },
  };
}

async function analyzeDayFixtures(date) {
  const cacheKey = `fullDayAnalysis_football_${date}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const result = await analyzeDayFixturesUncached(date);
  cache.set(cacheKey, result, FULL_ANALYSIS_TTL);
  return result;
}

async function analyzeDayFixturesUncached(date) {
  // Charger fixtures API + sources web en parallèle (oddsapi = gratuit, pas de quota).
  // allSettled : une panne réseau ponctuelle sur un scraper (footballpred/forebet/oddsapi)
  // ne doit pas faire échouer toute l'analyse du jour — seule l'API foot est indispensable.
  const [fixtures, fpredList, forebetList, oddsapiList] = await Promise.all([
    api.getFixturesByDate(date),
    footballpred.getTodayPredictions(date).catch(() => []),
    forebet.getTodayPredictions(date).catch(() => []),
    oddsapi.getTodayOdds().catch(() => []),
  ]);
  const upcoming = fixtures.filter((f) => UPCOMING_STATUSES.includes(f.fixture.status.short));
  const finishedFixtures = fixtures.filter((f) => FINISHED_STATUSES.includes(f.fixture.status.short));
  const finished = finishedFixtures.map(buildFinishedEntry);

  // Complète en arrière-plan les pronostics pris quand ces matchs étaient encore "upcoming" —
  // sans ré-analyser (le score final suffit). Idempotent : resolvePrediction ignore les
  // matchs déjà résolus ou jamais pronostiqués (hors sélection, quota épuisé ce jour-là...).
  for (const f of finishedFixtures) {
    if (f.goals?.home != null && f.goals?.away != null) {
      predictionResults
        .resolvePrediction('football', f.fixture.id, f.goals.home, f.goals.away)
        .catch((err) => console.error('Échec résolution pronostic (ignoré):', err.message));
    }
  }

  const apiLimited = api.getDailyRequestCount() >= api.DAILY_LIMIT;

  // Quota épuisé + fixtures en cache → mode web avec métadonnées API (logos, heures)
  if (apiLimited && upcoming.length > 0) {
    const webResult = await analyzeWebDayWithFixtures(upcoming, fpredList, forebetList, oddsapiList);
    return { ...webResult, results: [...webResult.results, ...finished] };
  }

  // Quota épuisé + pas de fixtures en cache → mode web pur (matchs depuis fpred/forebet)
  if (apiLimited && upcoming.length === 0) {
    const webResult = await analyzeWebDay(fpredList, oddsapiList);
    return { ...webResult, results: [...webResult.results, ...finished] };
  }

  upcoming.sort((a, b) => fixtureRank(b, oddsapiList, fpredList) - fixtureRank(a, oddsapiList, fpredList));

  const toAnalyze = upcoming.slice(0, MAX_FIXTURES_PER_DAY);

  // Les matchs sont indépendants entre eux -> on les analyse en parallèle (limité, pour ne
  // pas saturer le navigateur Puppeteer partagé ni les sites scrapés) au lieu d'un par un
  const results = await mapWithConcurrency(toAnalyze, ANALYSIS_CONCURRENCY, async (fixture) => {
    try {
      return await analyzeFixture(fixture, fpredList, forebetList, oddsapiList);
    } catch (err) {
      return {
        fixture: {
          id: fixture.fixture.id,
          date: fixture.fixture.date,
          league: `${fixture.league.name} — ${fixture.league.country}`,
          home: fixture.teams.home.name,
          away: fixture.teams.away.name,
        },
        matchState: matchStateFor(fixture.fixture.status.short, fixture.fixture.date),
        error: err.message,
      };
    }
  });

  results.sort((a, b) => {
    if (a.error) return 1;
    if (b.error) return -1;
    if (a.insufficientData && !b.insufficientData) return 1;
    if (!a.insufficientData && b.insufficientData) return -1;
    const maxA = Math.max(a.probabilities?.home ?? 0, a.probabilities?.away ?? 0);
    const maxB = Math.max(b.probabilities?.home ?? 0, b.probabilities?.away ?? 0);
    return maxB - maxA;
  });

  return { results: [...results, ...finished], total: upcoming.length, analyzed: toAnalyze.length };
}

let backgroundTrackingRunning = false;

// Analyse des matchs AU-DELÀ des MAX_FIXTURES_PER_DAY affichés à un visiteur, uniquement pour
// enregistrer leur pronostic dans prediction_results (voir analyzeFixture) et accélérer la
// collecte de données de calibration — jamais appelée depuis une requête HTTP, donc aucun
// visiteur n'attend sur ce travail. Concurrence volontairement réduite (BACKGROUND_CONCURRENCY)
// pour ne pas ralentir de vrais visiteurs qui utiliseraient le navigateur Puppeteer partagé
// au même moment.
async function trackExtraFixturesForData(date) {
  if (backgroundTrackingRunning) return; // déjà en cours -> ne pas empiler un second passage
  backgroundTrackingRunning = true;
  try {
    const [fixtures, fpredList, forebetList, oddsapiList] = await Promise.all([
      api.getFixturesByDate(date),
      footballpred.getTodayPredictions(date).catch(() => []),
      forebet.getTodayPredictions(date).catch(() => []),
      oddsapi.getTodayOdds().catch(() => []),
    ]);

    if (api.getDailyRequestCount() >= api.DAILY_LIMIT) return; // quota épuisé -> rien à faire de plus

    const upcoming = fixtures.filter((f) => UPCOMING_STATUSES.includes(f.fixture.status.short));
    upcoming.sort((a, b) => fixtureRank(b, oddsapiList, fpredList) - fixtureRank(a, oddsapiList, fpredList));
    // Les MAX_FIXTURES_PER_DAY premiers sont déjà couverts par le flux normal -> ne pas les refaire
    const extra = upcoming.slice(MAX_FIXTURES_PER_DAY, BACKGROUND_TRACKING_LIMIT);

    await mapWithConcurrency(extra, BACKGROUND_CONCURRENCY, async (fixture) => {
      try {
        await analyzeFixture(fixture, fpredList, forebetList, oddsapiList);
      } catch {
        // Un match en échec ici ne doit pas interrompre les autres -> simplement pas de
        // pronostic enregistré pour celui-là cette fois-ci
      }
    });
  } catch (err) {
    console.error('Suivi arrière-plan des pronostics (ignoré):', err.message);
  } finally {
    backgroundTrackingRunning = false;
  }
}

function fixtureMatchesQuery(fixture, terms) {
  const home = normalize(fixture.teams.home.name);
  const away = normalize(fixture.teams.away.name);
  return terms.some((t) => home.includes(t) || away.includes(t));
}

// Recherche à la demande : permet de retrouver et d'analyser n'importe quel match du jour,
// même s'il n'a pas été retenu dans la sélection automatique (limitée par le quota API)
async function searchFixtures(date, query) {
  const terms = expandSearchTerms(query);
  const fixtures = await api.getFixturesByDate(date);
  const upcoming = fixtures.filter((f) => UPCOMING_STATUSES.includes(f.fixture.status.short));
  const matched = upcoming.filter((f) => fixtureMatchesQuery(f, terms)).slice(0, MAX_SEARCH_RESULTS);

  if (matched.length === 0) {
    return { results: [], total: upcoming.length };
  }

  const [fpredList, forebetList, oddsapiList] = await Promise.all([
    footballpred.getTodayPredictions(date),
    forebet.getTodayPredictions(date),
    oddsapi.getTodayOdds(),
  ]);

  const results = await mapWithConcurrency(matched, ANALYSIS_CONCURRENCY, async (fixture) => {
    try {
      return await analyzeFixture(fixture, fpredList, forebetList, oddsapiList);
    } catch (err) {
      return {
        fixture: {
          id: fixture.fixture.id,
          date: fixture.fixture.date,
          league: `${fixture.league.name} — ${fixture.league.country}`,
          home: fixture.teams.home.name,
          away: fixture.teams.away.name,
        },
        matchState: matchStateFor(fixture.fixture.status.short, fixture.fixture.date),
        error: err.message,
      };
    }
  });

  return { results, total: upcoming.length };
}

module.exports = {
  analyzeFixture,
  analyzeDayFixtures,
  searchFixtures,
  matchStateFor,
  computeValidation,
  isLikelyMinor,
  trackExtraFixturesForData,
};
