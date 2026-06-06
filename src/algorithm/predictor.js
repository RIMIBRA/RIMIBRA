const api = require('../api/client');
const { analyzeForm } = require('./form');
const { analyzeH2H } = require('./h2h');
const { analyzeStandings } = require('./standings');
const { analyzeInjuries } = require('./injuries');

const HOME_ADVANTAGE = 6;

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

function getRecommendation(probs, homeScore, awayScore) {
  const diff = Math.abs(homeScore - awayScore);
  const confidence = diff > 20 ? 'Élevée' : diff > 10 ? 'Moyenne' : 'Faible';

  let pick;
  if (probs.home >= probs.away && probs.home >= probs.draw) pick = '1 (Domicile)';
  else if (probs.away >= probs.home && probs.away >= probs.draw) pick = '2 (Extérieur)';
  else pick = 'X (Nul)';

  if (probs.draw > 28) {
    const margin = Math.abs(homeScore - awayScore);
    if (margin < 8) pick = 'X (Nul)';
  }

  return { pick, confidence };
}

async function analyzeFixture(fixture) {
  const homeTeam = fixture.teams.home;
  const awayTeam = fixture.teams.away;
  const leagueId = fixture.league.id;
  const season = fixture.league.season;
  const fixtureId = fixture.fixture.id;

  const [homeForm, awayForm, h2hFixtures, standingsData, injuriesData] =
    await Promise.allSettled([
      api.getTeamLastMatches(homeTeam.id, 5),
      api.getTeamLastMatches(awayTeam.id, 5),
      api.getH2H(homeTeam.id, awayTeam.id, 10),
      api.getStandings(leagueId, season),
      api.getInjuries(fixtureId),
    ]).then((results) => results.map((r) => (r.status === 'fulfilled' ? r.value : null)));

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

  const probs = calcProbabilities(homeScore, awayScore);
  const recommendation = getRecommendation(probs, homeScore, awayScore);

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
    probabilities: probs,
    recommendation,
    breakdown: {
      form: { home: formHome, away: formAway },
      h2h,
      standings,
      injuries,
    },
  };
}

async function analyzeDayFixtures(date) {
  const fixtures = await api.getFixturesByDate(date);
  const upcoming = fixtures.filter(
    (f) => ['NS', 'TBD', '1H', 'HT', '2H'].includes(f.fixture.status.short)
  );

  const results = [];
  for (const fixture of upcoming) {
    try {
      const analysis = await analyzeFixture(fixture);
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
    const maxA = Math.max(a.probabilities.home, a.probabilities.away);
    const maxB = Math.max(b.probabilities.home, b.probabilities.away);
    return maxB - maxA;
  });

  return results;
}

module.exports = { analyzeFixture, analyzeDayFixtures };
