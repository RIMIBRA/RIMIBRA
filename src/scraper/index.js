const besoccer = require('./besoccer');
const footballpred = require('./footballpred');
const forebet = require('./forebet');
const oddsapi = require('./oddsapi');
const flashscore = require('./flashscore');

// Lists are passed from analyzeDayFixtures to avoid re-fetching per fixture
// skipFlashscore : pour les ligues clairement mineures, ce fallback Puppeteer (~5-8s) trouve
// très rarement quelque chose d'exploitable — pas la peine de payer le coût en temps
async function enrichFixture(homeTeam, awayTeam, date, fpredList = null, forebetList = null, oddsapiList = null, skipFlashscore = false) {
  const fpredSource = fpredList || await footballpred.getTodayPredictions(date);
  const forebetSource = forebetList || await forebet.getTodayPredictions(date);
  const oddsSource = oddsapiList || await oddsapi.getTodayOdds();

  const forebetMatch = forebet.findPrediction(forebetSource, homeTeam, awayTeam);
  const oddsMatch = oddsapi.findMatch(oddsSource, homeTeam, awayTeam);

  // Scraping en parallèle — tous peuvent échouer sans bloquer l'analyse. footballpred nécessite
  // désormais une requête par match (voir scraper/footballpred.js#fetchMatchPrediction) donc
  // rejoint le lot parallèle plutôt que d'être attendu séparément. Pour une ligue mineure :
  // besoccer trouve presque toujours un faux négatif (~2-4s perdues), et flashscore (Puppeteer,
  // ~5-8s) seulement si oddsapi n'a pas déjà les cotes.
  const [fpredMatch, bscData, fsData] = await Promise.allSettled([
    footballpred.findPrediction(fpredSource, homeTeam, awayTeam),
    skipFlashscore ? Promise.resolve(null) : besoccer.getMatchData(homeTeam, awayTeam),
    (oddsMatch || skipFlashscore) ? Promise.resolve(null) : flashscore.getMatchOdds(homeTeam, awayTeam),
  ]).then((r) => r.map((x) => (x.status === 'fulfilled' ? x.value : null)));

  return {
    besoccer: bscData,
    footballpred: fpredMatch || null,
    forebet: forebetMatch || null,
    oddsapi: oddsMatch || null,
    flashscore: fsData || null,
  };
}

// weights : poids par source calculés par algorithm/calibration.js à partir du taux de
// réussite réel accumulé dans prediction_results (voir schema.sql) — {algo:1, footballpred:1,
// ...} par défaut tant qu'il n'y a pas assez de données résolues pour calibrer.
function blendProbabilities(algoProbabilities, webSources, anchorAlgo = true, weights = {}) {
  const externals = [];

  if (webSources.footballpred?.probabilities)  externals.push(['footballpred', webSources.footballpred.probabilities]);
  if (webSources.forebet?.probabilities)       externals.push(['forebet', webSources.forebet.probabilities]);
  if (webSources.besoccer?.probabilities)      externals.push(['besoccer', webSources.besoccer.probabilities]);
  if (webSources.oddsapi?.probabilities)       externals.push(['oddsapi', webSources.oddsapi.probabilities]);
  if (webSources.flashscore?.probabilities)    externals.push(['flashscore', webSources.flashscore.probabilities]);
  // Consensus de plusieurs bookmakers (voir algorithm/bookmakerOdds.js) — poids par défaut plus
  // élevé que les autres sources externes (calibration.js) : un vrai consensus de marché sur
  // jusqu'à une douzaine de bookmakers, pas l'avis d'un seul site.
  if (webSources.apiOdds?.probabilities)       externals.push(['apiOdds', webSources.apiOdds.probabilities]);

  if (externals.length === 0) return algoProbabilities;

  const weightOf = (source, fallback) => weights[source] ?? fallback;

  // anchorAlgo=true (données algo réelles) : l'algo pèse "weights.algo" (2 par défaut) — il
  //   reste l'ancre principale, davantage encore s'il s'est montré plus fiable que le blend
  // anchorAlgo=false (algo sans données, valeurs 50/50 par défaut) : les cotes bookmaker
  //   dominent seules, sans être polluées par le bruit des valeurs par défaut de l'algo
  const weighted = anchorAlgo
    ? [[algoProbabilities, weightOf('algo', 2)], ...externals.map(([src, p]) => [p, weightOf(src, 1)])]
    : externals.map(([src, p]) => [p, weightOf(src, 1)]);

  const totalWeight = weighted.reduce((s, [, w]) => s + w, 0);
  const blended = {
    home: Math.round(weighted.reduce((s, [p, w]) => s + p.home * w, 0) / totalWeight),
    draw: Math.round(weighted.reduce((s, [p, w]) => s + p.draw * w, 0) / totalWeight),
    away: Math.round(weighted.reduce((s, [p, w]) => s + p.away * w, 0) / totalWeight),
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
