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

const HOME_ADVANTAGE = 6;
const MAX_FIXTURES_PER_DAY = 15;

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

  // API + tous les scrapers web en parallèle (fpredList déjà récupéré, pas de re-fetch)
  const [apiResults, webSources] = await Promise.allSettled([
    Promise.allSettled([
      api.getTeamLastMatches(homeTeam.id, 5),
      api.getTeamLastMatches(awayTeam.id, 5),
      api.getH2H(homeTeam.id, awayTeam.id, 10),
      api.getStandings(leagueId, season),
      api.getInjuries(fixtureId),
    ]).then((results) => results.map((r) => (r.status === 'fulfilled' ? r.value : null))),
    scraper.enrichFixture(homeTeam.name, awayTeam.name, date, fpredList, forebetList, oddsapiList),
  ]).then((r) => r.map((x) => (x.status === 'fulfilled' ? x.value : null)));

  const [homeForm, awayForm, h2hFixtures, standingsData, injuriesData] = apiResults || [null, null, null, null, null];
  const web = webSources || {};

  const formHome = analyzeForm(homeForm, homeTeam.id);
  const formAway = analyzeForm(awayForm, awayTeam.id);
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

  // Fusionner avec les données web si disponibles
  const finalProbs = scraper.blendProbabilities(algoProbs, web);
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
  const recommendation = getRecommendation(finalProbs, homeScore, awayScore, web, insufficientData);
  const goalPrediction = calcGoalPrediction(formHome, formAway);

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
    webSources: {
      footballpred: !!web.footballpred,
      forebet: !!web.forebet,
      besoccer: !!web.besoccer,
      oddsapi: !!web.oddsapi,
    },
    odds: web.oddsapi?.rawOdds || null,
    breakdown: {
      form: { home: formHome, away: formAway },
      h2h,
      standings,
      injuries,
    },
  };
}

async function analyzeDayFixtures(date) {
  // Charger fixtures API + sources web en parallèle (oddsapi = gratuit, pas de quota)
  const [fixtures, fpredList, forebetList, oddsapiList] = await Promise.all([
    api.getFixturesByDate(date),
    footballpred.getTodayPredictions(date),
    forebet.getTodayPredictions(date),
    oddsapi.getTodayOdds(),
  ]);

  const upcoming = fixtures.filter(
    (f) => ['NS', 'TBD', '1H', 'HT', '2H'].includes(f.fixture.status.short)
  );

  const apiLimited = api.getDailyRequestCount() >= api.DAILY_LIMIT;

  // Quota épuisé + fixtures en cache → mode web avec métadonnées API (logos, heures)
  if (apiLimited && upcoming.length > 0) {
    return analyzeWebDayWithFixtures(upcoming, fpredList, forebetList, oddsapiList);
  }

  // Quota épuisé + pas de fixtures en cache → mode web pur (matchs depuis fpred/forebet)
  if (apiLimited && upcoming.length === 0) {
    return analyzeWebDay(fpredList, oddsapiList);
  }

  // Trier : matchs couverts par un bookmaker (oddsapi) ou footballpredictions.com en premier —
  // ce sont les matchs "suivis" (donc avec de vraies données exploitables), pas seulement
  // les compétitions obscures qui produiraient une analyse "données insuffisantes"
  upcoming.sort((a, b) => {
    const aHasOdds = !!oddsapi.findMatch(oddsapiList, a.teams.home.name, a.teams.away.name);
    const bHasOdds = !!oddsapi.findMatch(oddsapiList, b.teams.home.name, b.teams.away.name);
    if (aHasOdds && !bHasOdds) return -1;
    if (!aHasOdds && bHasOdds) return 1;

    const aInFpred = footballpred.isInFpred(fpredList, a.teams.home.name, a.teams.away.name);
    const bInFpred = footballpred.isInFpred(fpredList, b.teams.home.name, b.teams.away.name);
    if (aInFpred && !bInFpred) return -1;
    if (!aInFpred && bInFpred) return 1;
    return 0;
  });

  const toAnalyze = upcoming.slice(0, MAX_FIXTURES_PER_DAY);

  const results = [];
  for (const fixture of toAnalyze) {
    try {
      const analysis = await analyzeFixture(fixture, fpredList, forebetList, oddsapiList);
      results.push(analysis);
    } catch (err) {
      results.push({
        fixture: {
          id: fixture.fixture.id,
          date: fixture.fixture.date,
          league: `${fixture.league.name} — ${fixture.league.country}`,
          home: fixture.teams.home.name,
          away: fixture.teams.away.name,
        },
        error: err.message,
      });
    }
  }

  results.sort((a, b) => {
    if (a.error) return 1;
    if (b.error) return -1;
    if (a.insufficientData && !b.insufficientData) return 1;
    if (!a.insufficientData && b.insufficientData) return -1;
    const maxA = Math.max(a.probabilities?.home ?? 0, a.probabilities?.away ?? 0);
    const maxB = Math.max(b.probabilities?.home ?? 0, b.probabilities?.away ?? 0);
    return maxB - maxA;
  });

  return { results, total: upcoming.length, analyzed: toAnalyze.length };
}

module.exports = { analyzeFixture, analyzeDayFixtures };
