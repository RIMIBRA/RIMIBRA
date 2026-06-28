const { analyzeForm } = require('./form');
const { analyzeH2H } = require('./h2h');
const { normalize, expandSearchTerms } = require('./teamAliases');
const { mapWithConcurrency } = require('../utils/concurrency');

const ANALYSIS_CONCURRENCY = 10;

// Usine générique pour les sports d'équipe sans classement/blessures exploitables encore
// (forme + H2H uniquement) — réutilisée par Hockey, Baseball, Handball, Tennis.
function createTeamSportPredictor({
  api,
  leagueLabel,
  homeAdvantage = 5,
  allowDraw = false,
  upcomingStatuses,
  liveStatuses = upcomingStatuses.filter((s) => s !== 'NS'),
  maxPerDay = 40,
  staleHours = 4, // au-delà, un match encore "NS" est considéré terminé (fournisseur jamais mis à jour)
  isPriorityLeague = () => false, // ligues majeures (plus fiables) à faire remonter en premier
}) {
  function matchStateFor(statusShort, kickoffIso) {
    if (statusShort === 'FT') return 'finished';
    if (liveStatuses.includes(statusShort)) return 'live';
    if (kickoffIso) {
      const hoursSinceKickoff = (Date.now() - new Date(kickoffIso).getTime()) / 3600000;
      if (hoursSinceKickoff > staleHours) return 'finished';
    }
    return 'upcoming';
  }

  function calcProbabilities(homeScore, awayScore) {
    const adjustedHome = homeScore + homeAdvantage;
    const total = adjustedHome + awayScore;
    const rawHome = adjustedHome / total;
    const rawAway = awayScore / total;

    if (!allowDraw) {
      return { home: Math.round(rawHome * 100), draw: 0, away: Math.round(rawAway * 100) };
    }

    const closeness = 1 - Math.abs(rawHome - rawAway);
    const drawFactor = 0.22 * closeness;
    const homeProb = rawHome * (1 - drawFactor);
    const awayProb = rawAway * (1 - drawFactor);
    return {
      home: Math.round(homeProb * 100),
      draw: Math.round(drawFactor * 100),
      away: Math.round(awayProb * 100),
    };
  }

  function getRecommendation(probs, homeScore, awayScore, insufficientData) {
    if (insufficientData) return { pick: 'Analyse non disponible', confidence: 'Faible' };
    const diff = Math.abs(homeScore - awayScore);
    const confidence = diff > 20 ? 'Élevée' : diff > 10 ? 'Moyenne' : 'Faible';
    let pick;
    if (probs.home >= probs.away && probs.home >= probs.draw) pick = '1 (Domicile)';
    else if (probs.away >= probs.home && probs.away >= probs.draw) pick = '2 (Extérieur)';
    else pick = 'X (Nul)';
    return { pick, confidence };
  }

  function hasNoData(formHome, formAway, h2h) {
    return formHome.score === 50 && formAway.score === 50 && h2h.score1 === 50 && h2h.score2 === 50;
  }

  function computeValidation(predictedPick, homeScore, awayScore) {
    if (homeScore == null || awayScore == null) return null;
    let actualPick;
    if (homeScore > awayScore) actualPick = '1 (Domicile)';
    else if (awayScore > homeScore) actualPick = '2 (Extérieur)';
    else actualPick = 'X (Nul)';
    return {
      actualScore: { home: homeScore, away: awayScore },
      actualPick,
      correct: actualPick === predictedPick,
    };
  }

  async function analyzeGame(game) {
    const homeTeam = game.teams.home;
    const awayTeam = game.teams.away;

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

    return {
      fixture: {
        id: game.fixture.id,
        date: game.fixture.date,
        league: `${game.league.name || leagueLabel}${game.league.country ? ' — ' + game.league.country : ''}`,
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
      noApiData: insufficientData,
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

  function errorEntry(game, err) {
    return {
      fixture: {
        id: game.fixture.id,
        date: game.fixture.date,
        league: `${game.league.name || leagueLabel}`,
        home: game.teams.home.name,
        away: game.teams.away.name,
      },
      matchState: matchStateFor(game.fixture.status.short, game.fixture.date),
      error: err.message,
    };
  }

  function finishedEntry(g) {
    return {
      fixture: {
        id: g.fixture.id,
        date: g.fixture.date,
        league: `${g.league.name || leagueLabel}${g.league.country ? ' — ' + g.league.country : ''}`,
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

  async function analyzeDayGames(date) {
    const games = await api.getGamesByDate(date);
    const upcoming = games.filter((f) => upcomingStatuses.includes(f.fixture.status.short));
    const finished = games.filter((f) => f.fixture.status.short === 'FT').map(finishedEntry);

    // Ligues majeures en premier — les pronostics y sont nettement plus fiables (historique
    // riche, vraies données de forme) que sur une compétition obscure peu suivie
    upcoming.sort((a, b) => (isPriorityLeague(b) ? 1 : 0) - (isPriorityLeague(a) ? 1 : 0));
    const toAnalyze = upcoming.slice(0, maxPerDay);

    const results = await mapWithConcurrency(toAnalyze, ANALYSIS_CONCURRENCY, async (game) => {
      try {
        return await analyzeGame(game);
      } catch (err) {
        return errorEntry(game, err);
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
    const upcoming = games.filter((f) => upcomingStatuses.includes(f.fixture.status.short));
    const matched = upcoming.filter((f) => fixtureMatchesQuery(f, terms)).slice(0, 5);

    const results = await mapWithConcurrency(matched, ANALYSIS_CONCURRENCY, async (game) => {
      try {
        return await analyzeGame(game);
      } catch (err) {
        return errorEntry(game, err);
      }
    });

    return { results, total: upcoming.length };
  }

  return { analyzeGame, analyzeDayGames, searchGames };
}

module.exports = { createTeamSportPredictor };
