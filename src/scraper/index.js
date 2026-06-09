const besoccer = require('./besoccer');
const footballpred = require('./footballpred');
const forebet = require('./forebet');
const oddsapi = require('./oddsapi');

// Lists are passed from analyzeDayFixtures to avoid re-fetching per fixture
async function enrichFixture(homeTeam, awayTeam, date, fpredList = null, forebetList = null, oddsapiList = null) {
  const fpredSource = fpredList || await footballpred.getTodayPredictions(date);
  const forebetSource = forebetList || await forebet.getTodayPredictions(date);
  const oddsSource = oddsapiList || await oddsapi.getTodayOdds();

  const fpredMatch = footballpred.findPrediction(fpredSource, homeTeam, awayTeam);
  const forebetMatch = forebet.findPrediction(forebetSource, homeTeam, awayTeam);
  const oddsMatch = oddsapi.findMatch(oddsSource, homeTeam, awayTeam);

  const [bscData] = await Promise.allSettled([
    besoccer.getMatchData(homeTeam, awayTeam),
  ]).then((r) => r.map((x) => (x.status === 'fulfilled' ? x.value : null)));

  return {
    besoccer: bscData,
    footballpred: fpredMatch || null,
    forebet: forebetMatch || null,
    oddsapi: oddsMatch || null,
  };
}

function blendProbabilities(algoProbabilities, webSources, anchorAlgo = true) {
  const externals = [];

  if (webSources.footballpred?.probabilities) externals.push(webSources.footballpred.probabilities);
  if (webSources.forebet?.probabilities)      externals.push(webSources.forebet.probabilities);
  if (webSources.besoccer?.probabilities)     externals.push(webSources.besoccer.probabilities);
  if (webSources.oddsapi?.probabilities)      externals.push(webSources.oddsapi.probabilities);

  if (externals.length === 0) return algoProbabilities;

  // anchorAlgo=true (données algo réelles) : l'algo compte double — il reste l'ancre principale
  // anchorAlgo=false (algo sans données, valeurs 50/50 par défaut) : les cotes bookmaker
  //   dominent seules, sans être polluées par le bruit des valeurs par défaut de l'algo
  const all = anchorAlgo ? [algoProbabilities, algoProbabilities, ...externals] : externals;
  const blended = {
    home: Math.round(all.reduce((s, p) => s + p.home, 0) / all.length),
    draw: Math.round(all.reduce((s, p) => s + p.draw, 0) / all.length),
    away: Math.round(all.reduce((s, p) => s + p.away, 0) / all.length),
  };

  const total = blended.home + blended.draw + blended.away;
  if (total !== 100) {
    blended.home = Math.round((blended.home / total) * 100);
    blended.draw = Math.round((blended.draw / total) * 100);
    blended.away = 100 - blended.home - blended.draw;
  }

  return blended;
}

module.exports = { enrichFixture, blendProbabilities };
