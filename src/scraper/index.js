const besoccer = require('./besoccer');
const footballpred = require('./footballpred');

async function enrichFixture(homeTeam, awayTeam, date) {
  const [bscData, fpredPredictions] = await Promise.allSettled([
    besoccer.getMatchData(homeTeam, awayTeam),
    footballpred.getTodayPredictions(date),
  ]).then((r) => r.map((x) => (x.status === 'fulfilled' ? x.value : null)));

  const fpredMatch = footballpred.findPrediction(fpredPredictions, homeTeam, awayTeam);

  return {
    besoccer: bscData,
    footballpred: fpredMatch || null,
  };
}

// Merge web prediction with our algorithm score
// Returns a blended probability if web sources have data
function blendProbabilities(algoProbabilities, webSources) {
  const externals = [];

  if (webSources.besoccer?.probabilities) {
    externals.push(webSources.besoccer.probabilities);
  }
  if (webSources.footballpred?.probabilities) {
    externals.push(webSources.footballpred.probabilities);
  }

  if (externals.length === 0) return algoProbabilities;

  // Average all sources (algo + web)
  const all = [algoProbabilities, ...externals];
  const blended = {
    home: Math.round(all.reduce((s, p) => s + p.home, 0) / all.length),
    draw: Math.round(all.reduce((s, p) => s + p.draw, 0) / all.length),
    away: Math.round(all.reduce((s, p) => s + p.away, 0) / all.length),
  };

  // Normalize to 100%
  const total = blended.home + blended.draw + blended.away;
  if (total !== 100) {
    blended.home = Math.round((blended.home / total) * 100);
    blended.draw = Math.round((blended.draw / total) * 100);
    blended.away = 100 - blended.home - blended.draw;
  }

  return blended;
}

module.exports = { enrichFixture, blendProbabilities };
