const besoccer = require('./besoccer');
const footballpred = require('./footballpred');
const forebet = require('./forebet');
const { get1xbetOdds } = require('./odds');

// fpredList et forebetList sont passés depuis analyzeDayFixtures (pas de re-fetch)
async function enrichFixture(homeTeam, awayTeam, date, fpredList = null, forebetList = null) {
  const fpredSource = fpredList || await footballpred.getTodayPredictions(date);
  const forebetSource = forebetList || await forebet.getTodayPredictions(date);

  const fpredMatch = footballpred.findPrediction(fpredSource, homeTeam, awayTeam);
  const forebetMatch = forebet.findPrediction(forebetSource, homeTeam, awayTeam);

  const [bscData, oddsData] = await Promise.allSettled([
    besoccer.getMatchData(homeTeam, awayTeam),
    get1xbetOdds(homeTeam, awayTeam),
  ]).then((r) => r.map((x) => (x.status === 'fulfilled' ? x.value : null)));

  return {
    besoccer: bscData,
    footballpred: fpredMatch || null,
    forebet: forebetMatch || null,
    odds: oddsData || null,
  };
}

function blendProbabilities(algoProbabilities, webSources) {
  const externals = [];

  if (webSources.footballpred?.probabilities) externals.push(webSources.footballpred.probabilities);
  if (webSources.forebet?.probabilities)      externals.push(webSources.forebet.probabilities);
  if (webSources.besoccer?.probabilities)     externals.push(webSources.besoccer.probabilities);
  if (webSources.odds)                        externals.push(webSources.odds);

  if (externals.length === 0) return algoProbabilities;

  // Algo compte double pour rester l'ancre principale
  const all = [algoProbabilities, algoProbabilities, ...externals];
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
