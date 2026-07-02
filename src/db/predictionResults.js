const pool = require('./pool');

// Une prédiction reste modifiable tant que le match n'est pas résolu (ré-analyses successives
// avant le coup d'envoi affinent le pronostic) ; plus aucune écriture une fois resolved_at posé.
async function recordPrediction({
  sport = 'football',
  fixtureId,
  league,
  homeTeam,
  awayTeam,
  predictedPick,
  confidence,
  probabilities,
  goalPrediction,
  sources,
  noApiData,
}) {
  await pool.query(
    `INSERT INTO prediction_results
       (sport, fixture_id, league, home_team, away_team, predicted_pick, confidence,
        probabilities, goal_prediction, sources, no_api_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (sport, fixture_id) DO UPDATE SET
       predicted_pick = EXCLUDED.predicted_pick,
       confidence = EXCLUDED.confidence,
       probabilities = EXCLUDED.probabilities,
       goal_prediction = EXCLUDED.goal_prediction,
       sources = EXCLUDED.sources,
       no_api_data = EXCLUDED.no_api_data,
       predicted_at = now()
     WHERE prediction_results.resolved_at IS NULL`,
    [
      sport,
      String(fixtureId),
      league || null,
      homeTeam || null,
      awayTeam || null,
      predictedPick,
      confidence || null,
      JSON.stringify(probabilities || {}),
      JSON.stringify(goalPrediction || null),
      JSON.stringify(sources || {}),
      !!noApiData,
    ]
  );
}

// Calcule le résultat (1X2 + BTTS/+2,5 si applicable) à partir du pronostic déjà enregistré,
// sans ré-analyser le match. Ne fait rien si aucun pronostic n'avait été pris pour ce fixture
// (hors sélection auto, quota épuisé ce jour-là...) ou s'il est déjà résolu.
async function resolvePrediction(sport, fixtureId, homeScore, awayScore) {
  if (homeScore == null || awayScore == null) return;

  const { rows } = await pool.query(
    `SELECT predicted_pick, goal_prediction FROM prediction_results
     WHERE sport = $1 AND fixture_id = $2 AND resolved_at IS NULL`,
    [sport, String(fixtureId)]
  );
  const row = rows[0];
  if (!row) return;

  let actualPick;
  if (homeScore > awayScore) actualPick = '1 (Domicile)';
  else if (awayScore > homeScore) actualPick = '2 (Extérieur)';
  else actualPick = 'X (Nul)';
  const correct = actualPick === row.predicted_pick;

  // btts/over25 entre 41 et 54% = pas de pronostic tranché au moment de l'analyse -> rien à
  // valider pour btts (même règle que computeValidation dans algorithm/predictor.js)
  const gp = row.goal_prediction;
  let bttsCorrect = null;
  let over25Correct = null;
  if (gp) {
    const actualBtts = homeScore > 0 && awayScore > 0;
    const actualOver25 = homeScore + awayScore > 2.5;
    if (gp.btts >= 55 || gp.btts <= 40) bttsCorrect = (gp.btts >= 55) === actualBtts;
    over25Correct = (gp.over25 >= 55) === actualOver25;
  }

  await pool.query(
    `UPDATE prediction_results
     SET actual_home_score = $3, actual_away_score = $4, correct = $5,
         btts_correct = $6, over25_correct = $7, resolved_at = now()
     WHERE sport = $1 AND fixture_id = $2`,
    [sport, String(fixtureId), homeScore, awayScore, correct, bttsCorrect, over25Correct]
  );
}

// Sources externes mêlées à l'algo (voir scraper/index.js blendProbabilities) — mesurer leur
// taux de réussite individuel permet de savoir lesquelles méritent vraiment leur poids.
const SOURCE_KEYS = ['footballpred', 'forebet', 'besoccer', 'oddsapi', 'flashscore', 'soccerway'];

async function getAccuracyStats(sport = 'football', sinceDays = 30) {
  const sourceColumns = SOURCE_KEYS.map(
    (key) => `
       COUNT(*) FILTER (WHERE resolved_at IS NOT NULL AND (sources->>'${key}')::boolean) AS "${key}_resolved",
       COUNT(*) FILTER (WHERE correct = true AND (sources->>'${key}')::boolean) AS "${key}_correct"`
  ).join(',');

  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) AS resolved,
       COUNT(*) FILTER (WHERE correct = true) AS correct,
       COUNT(*) FILTER (WHERE resolved_at IS NOT NULL AND confidence = 'Élevée') AS high_conf_resolved,
       COUNT(*) FILTER (WHERE correct = true AND confidence = 'Élevée') AS high_conf_correct,
       COUNT(*) FILTER (WHERE resolved_at IS NOT NULL AND no_api_data) AS algo_only_resolved,
       COUNT(*) FILTER (WHERE correct = true AND no_api_data) AS algo_only_correct
       ${sourceColumns ? ',' + sourceColumns : ''}
     FROM prediction_results
     WHERE sport = $1 AND predicted_at >= now() - make_interval(days => $2::int)`,
    [sport, sinceDays]
  );

  const r = rows[0];
  const num = (v) => Number(v || 0);
  const pct = (correct, total) => (total > 0 ? Math.round((correct / total) * 1000) / 10 : null);
  const bucket = (resolvedKey, correctKey) => {
    const resolved = num(r[resolvedKey]);
    const correct = num(r[correctKey]);
    return { resolved, correct, accuracy: pct(correct, resolved) };
  };

  return {
    sport,
    sinceDays,
    overall: bucket('resolved', 'correct'),
    highConfidence: bucket('high_conf_resolved', 'high_conf_correct'),
    algoOnly: bucket('algo_only_resolved', 'algo_only_correct'),
    bySource: Object.fromEntries(
      SOURCE_KEYS.map((key) => [key, bucket(`${key}_resolved`, `${key}_correct`)])
    ),
  };
}

module.exports = { recordPrediction, resolvePrediction, getAccuracyStats };
