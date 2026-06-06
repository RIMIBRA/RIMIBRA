const besoccer = require('./besoccer');
const footballpred = require('./footballpred');
const { get1xbetOdds } = require('./odds');

async function enrichFixture(homeTeam, awayTeam, date) {
  const [bscData, fpredPredictions, oddsData] = await Promise.allSettled([
    besoccer.getMatchData(homeTeam, awayTeam),
    footballpred.getTodayPredictions(date),
    get1xbetOdds(homeTeam, awayTeam),
  ]).then((r) => r.map((x) => (x.status === 'fulfilled' ? x.value : null)));

  const fpredMatch = footballpred.findPrediction(fpredPredictions, homeTeam, awayTeam);

  return {
    besoccer: bscData,
    footballpred: fpredMatch || null,
    odds: oddsData || null,
  };
}

function blendProbabilities(algoProbabilities, webSources) {
  const externals = [];

  if (webSources.besoccer?.probabilities) externals.push(webSources.besoccer.probabilities);
  if (webSources.footballpred?.probabilities) externals.push(webSources.footballpred.probabilities);
  if (webSources.odds) externals.push(webSources.odds); // cotes 1xbet converties

  if (externals.length === 0) return algoProbabilities;

  // Algo a un poids légèrement plus élevé, sources web à poids égal
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
