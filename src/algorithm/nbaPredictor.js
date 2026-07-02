const api = require('../api/nbaClient');
const { analyzeForm } = require('./form');
const { analyzeH2H } = require('./h2h');
const { normalize, expandSearchTerms } = require('./teamAliases');
const { mapWithConcurrency } = require('../utils/concurrency');
const cache = require('../cache/db');
const predictionResults = require('../db/predictionResults');
const FULL_ANALYSIS_TTL = 12 * 60; // 12 min : bon compromis vitesse/fraîcheur des statuts en direct

const HOME_ADVANTAGE = 5;
const MAX_GAMES_PER_DAY = 16;
const MAX_SEARCH_RESULTS = 5;
const ANALYSIS_CONCURRENCY = 10;
const UPCOMING_STATUSES = ['NS', 'Q1', 'Q2', 'Q3', 'Q4', 'OT', 'HT'];
const LIVE_STATUSES = ['Q1', 'Q2', 'Q3', 'Q4', 'OT', 'HT'];
const FINISHED_STATUSES = ['FT'];
// NBA (id=12) et Euroleague (id=120) — bien plus fiables que les ligues mineures de basket
const PRIORITY_LEAGUE_IDS = new Set([12, 120]);
const isPriorityLeague = (g) => PRIORITY_LEAGUE_IDS.has(g.league.id);

const STALE_HOURS = 4; // un match NBA dure ~2h30, marge pour prolongations/retards

function matchStateFor(statusShort, kickoffIso) {
  if (FINISHED_STATUSES.includes(statusShort)) return 'finished';
  if (LIVE_STATUSES.includes(statusShort)) return 'live';
  if (kickoffIso) {
    const hoursSinceKickoff = (Date.now() - new Date(kickoffIso).getTime()) / 3600000;
    if (hoursSinceKickoff > STALE_HOURS) return 'finished';
  }
  return 'upcoming';
}

function computeValidation(predictedPick, homeScore, awayScore) {
  if (homeScore == null || awayScore == null) return null;
  const actualPick = homeScore > awayScore ? '1 (Domicile)' : '2 (Extérieur)';
  return {
    actualScore: { home: homeScore, away: awayScore },
    actualPick,
    correct: actualPick === predictedPick,
  };
}

function buildFinishedEntry(g) {
  return {
    fixture: {
      id: g.fixture.id,
      date: g.fixture.date,
      league: `${g.league.name || 'NBA'} — ${g.league.country || 'USA'}`,
      home: g.teams.home.name,
      away: g.teams.away.name,
      homeLogo: g.teams.home.logo,
      awayLogo: g.teams.away.logo,
    },
    finished: true,
    matchState: 'finished',
    finalScore: { home: g.goals.home, away: g.goals.away },
  };
}

function calcProbabilities(homeScore, awayScore) {
  const adjustedHome = homeScore + HOME_ADVANTAGE;
  const total = adjustedHome + awayScore;
  const rawHome = adjustedHome / total;
  const rawAway = awayScore / total;
  // Pas de match nul en NBA
  return {
    home: Math.round(rawHome * 100),
    draw: 0,
    away: Math.round(rawAway * 100),
  };
}

function getRecommendation(probs, homeScore, awayScore, insufficientData) {
  if (insufficientData) return { pick: 'Analyse non disponible', confidence: 'Faible' };
  const diff = Math.abs(homeScore - awayScore);
  const confidence = diff > 20 ? 'Élevée' : diff > 10 ? 'Moyenne' : 'Faible';
  const pick = probs.home >= probs.away ? '1 (Domicile)' : '2 (Extérieur)';
  return { pick, confidence };
}

function hasNoData(formHome, formAway, h2h) {
  return formHome.score === 50 && formAway.score === 50 && h2h.score1 === 50 && h2h.score2 === 50;
}

async function analyzeGame(game) {
  const homeTeam = game.teams.home;
  const awayTeam = game.teams.away;
  const fixtureId = game.fixture.id;

  const [homeGames, awayGames, h2hGames] = await Promise.all([
    api.getTeamLastGames(homeTeam.id, 5, game.fixture.date),
    api.getTeamLastGames(awayTeam.id, 5, game.fixture.date),
    api.getH2H(homeTeam.id, awayTeam.id, 10),
  ]);

  const formHome = analyzeForm(homeGames, homeTeam.id);
  const formAway = analyzeForm(awayGames, awayTeam.id);
  const h2h = analyzeH2H(h2hGames, homeTeam.id, awayTeam.id);

  const weights = { form: 0.65, h2h: 0.35 };
  const homeScore = formHome.score * weights.form + h2h.score1 * weights.h2h;
  const awayScore = formAway.score * weights.form + h2h.score2 * weights.h2h;

  const probs = calcProbabilities(homeScore, awayScore);
  const insufficientData = hasNoData(formHome, formAway, h2h);
  const recommendation = getRecommendation(probs, homeScore, awayScore, insufficientData);
  const matchState = matchStateFor(game.fixture.status.short, game.fixture.date);
  const validation = matchState === 'finished'
    ? computeValidation(recommendation.pick, game.goals?.home, game.goals?.away)
    : null;

  // Pas de blend pour la NBA (aucune source web) -> le pronostic final EST le pronostic de
  // l'algo, algoPick/algoProbabilities sont donc identiques à predictedPick/probabilities.
  if (matchState === 'upcoming' && !insufficientData) {
    predictionResults
      .recordPrediction({
        sport: 'nba',
        fixtureId,
        league: `${game.league.name || 'NBA'} — ${game.league.country || 'USA'}`,
        homeTeam: homeTeam.name,
        awayTeam: awayTeam.name,
        predictedPick: recommendation.pick,
        confidence: recommendation.confidence,
        probabilities: probs,
        algoPick: recommendation.pick,
        algoProbabilities: probs,
        goalPrediction: null,
        sources: {},
        noApiData: insufficientData,
        featured: true,
      })
      .catch((err) => console.error('Échec enregistrement pronostic nba (ignoré):', err.message));
  }

  return {
    fixture: {
      id: fixtureId,
      date: game.fixture.date,
      league: `${game.league.name || 'NBA'} — ${game.league.country || 'USA'}`,
      home: homeTeam.name,
      away: awayTeam.name,
      homeLogo: homeTeam.logo,
      awayLogo: awayTeam.logo,
    },
    matchState,
    validation,
    scores: { home: Math.round(homeScore), away: Math.round(awayScore) },
    probabilities: probs,
    goalPrediction: null,
    recommendation,
    noApiData: hasNoData(formHome, formAway, h2h),
    insufficientData,
    webMode: false,
    webSources: {},
    odds: null,
    breakdown: {
      form: { home: formHome, away: formAway },
      h2h,
      standings: { available: false },
      injuries: { team1: { count: 0, players: [] }, team2: { count: 0, players: [] } },
    },
  };
}

async function analyzeDayGames(date) {
  const cacheKey = `fullDayAnalysis_nba_${date}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const result = await analyzeDayGamesUncached(date);
  cache.set(cacheKey, result, FULL_ANALYSIS_TTL);
  return result;
}

async function analyzeDayGamesUncached(date) {
  const games = await api.getGamesByDate(date);
  const upcoming = games.filter((f) => UPCOMING_STATUSES.includes(f.fixture.status.short));
  const finishedGames = games.filter((f) => FINISHED_STATUSES.includes(f.fixture.status.short));
  const finished = finishedGames.map(buildFinishedEntry);

  for (const g of finishedGames) {
    if (g.goals?.home != null && g.goals?.away != null) {
      predictionResults
        .resolvePrediction('nba', g.fixture.id, g.goals.home, g.goals.away)
        .catch((err) => console.error('Échec résolution pronostic nba (ignoré):', err.message));
    }
  }

  upcoming.sort((a, b) => (isPriorityLeague(b) ? 1 : 0) - (isPriorityLeague(a) ? 1 : 0));
  const toAnalyze = upcoming.slice(0, MAX_GAMES_PER_DAY);

  const results = await mapWithConcurrency(toAnalyze, ANALYSIS_CONCURRENCY, async (game) => {
    try {
      return await analyzeGame(game);
    } catch (err) {
      return {
        fixture: {
          id: game.fixture.id,
          date: game.fixture.date,
          league: `${game.league.name || 'NBA'} — ${game.league.country || 'USA'}`,
          home: game.teams.home.name,
          away: game.teams.away.name,
        },
        matchState: matchStateFor(game.fixture.status.short, game.fixture.date),
        error: err.message,
      };
    }
  });

  results.sort((a, b) => {
    if (a.error) return 1;
    if (b.error) return -1;
    const maxA = Math.max(a.probabilities?.home ?? 0, a.probabilities?.away ?? 0);
    const maxB = Math.max(b.probabilities?.home ?? 0, b.probabilities?.away ?? 0);
    return maxB - maxA;
  });

  return { results: [...results, ...finished], total: upcoming.length, analyzed: toAnalyze.length };
}

function fixtureMatchesQuery(game, terms) {
  const home = normalize(game.teams.home.name);
  const away = normalize(game.teams.away.name);
  return terms.some((t) => home.includes(t) || away.includes(t));
}

async function searchGames(date, query) {
  const terms = expandSearchTerms(query);
  const games = await api.getGamesByDate(date);
  const upcoming = games.filter((f) => UPCOMING_STATUSES.includes(f.fixture.status.short));
  const matched = upcoming.filter((f) => fixtureMatchesQuery(f, terms)).slice(0, MAX_SEARCH_RESULTS);

  const results = await mapWithConcurrency(matched, ANALYSIS_CONCURRENCY, async (game) => {
    try {
      return await analyzeGame(game);
    } catch (err) {
      return {
        fixture: {
          id: game.fixture.id,
          date: game.fixture.date,
          league: `${game.league.name || 'NBA'} — ${game.league.country || 'USA'}`,
          home: game.teams.home.name,
          away: game.teams.away.name,
        },
        matchState: matchStateFor(game.fixture.status.short, game.fixture.date),
        error: err.message,
      };
    }
  });

  return { results, total: upcoming.length };
}

module.exports = { analyzeGame, analyzeDayGames, searchGames };
