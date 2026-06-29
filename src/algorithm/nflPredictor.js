const api = require('../api/nflClient');
const { analyzeForm } = require('./form');
const { analyzeH2H } = require('./h2h');
const { normalize, expandSearchTerms } = require('./teamAliases');
const { mapWithConcurrency } = require('../utils/concurrency');
const cache = require('../cache/db');
const FULL_ANALYSIS_TTL = 12 * 60; // 12 min : bon compromis vitesse/fraîcheur des statuts en direct

const HOME_ADVANTAGE = 4; // avantage domicile plus faible en NFL qu'en foot
const MAX_GAMES_PER_DAY = 16;
const MAX_SEARCH_RESULTS = 5;
const ANALYSIS_CONCURRENCY = 10;
const UPCOMING_STATUSES = ['NS', 'Q1', 'Q2', 'Q3', 'Q4', 'HT', 'OT'];
const LIVE_STATUSES = ['Q1', 'Q2', 'Q3', 'Q4', 'HT', 'OT'];
const FINISHED_STATUSES = ['FT'];
// NFL (id=1) — l'API american-football renvoie aussi des matchs NCAA (id=2), moins fiables
const PRIORITY_LEAGUE_IDS = new Set([1]);
const isPriorityLeague = (g) => PRIORITY_LEAGUE_IDS.has(g.league.id);

// Anti-données-périmées : certains matchs restent en statut "NS" sans jamais être mis à
// jour par le fournisseur (ligues mineures peu suivies). Au-delà de STALE_HOURS après le
// coup d'envoi prévu, on considère le match terminé plutôt que de le laisser en "à venir".
const STALE_HOURS = 4; // un match NFL dure ~3h30 avec prolongation possible

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
      league: `${g.league.name || 'NFL'} — ${g.league.country || 'USA'}`,
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
  // Pas de match nul possible en NFL (sauf rarissime égalité après prolongation) :
  // on ne réserve pas de probabilité "nul" comme pour le foot
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

  // Pas de classement/blessures fiables pour l'instant -> tout le poids sur forme + H2H
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

  return {
    fixture: {
      id: fixtureId,
      date: game.fixture.date,
      league: `${game.league.name || 'NFL'} — ${game.league.country || 'USA'}`,
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
  const cacheKey = `fullDayAnalysis_nfl_${date}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const result = await analyzeDayGamesUncached(date);
  cache.set(cacheKey, result, FULL_ANALYSIS_TTL);
  return result;
}

async function analyzeDayGamesUncached(date) {
  const games = await api.getGamesByDate(date);
  const upcoming = games.filter((f) => UPCOMING_STATUSES.includes(f.fixture.status.short));
  const finished = games.filter((f) => FINISHED_STATUSES.includes(f.fixture.status.short)).map(buildFinishedEntry);
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
          league: `${game.league.name || 'NFL'} — ${game.league.country || 'USA'}`,
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
          league: `${game.league.name || 'NFL'} — ${game.league.country || 'USA'}`,
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
