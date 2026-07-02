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
  algoPick,
  algoProbabilities,
  goalPrediction,
  sources,
  noApiData,
  featured = true,
}) {
  await pool.query(
    `INSERT INTO prediction_results
       (sport, fixture_id, league, home_team, away_team, predicted_pick, confidence,
        probabilities, algo_pick, algo_probabilities, goal_prediction, sources, no_api_data, featured)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (sport, fixture_id) DO UPDATE SET
       predicted_pick = EXCLUDED.predicted_pick,
       confidence = EXCLUDED.confidence,
       probabilities = EXCLUDED.probabilities,
       algo_pick = EXCLUDED.algo_pick,
       algo_probabilities = EXCLUDED.algo_probabilities,
       goal_prediction = EXCLUDED.goal_prediction,
       sources = EXCLUDED.sources,
       no_api_data = EXCLUDED.no_api_data,
       featured = EXCLUDED.featured OR prediction_results.featured,
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
      algoPick || null,
      JSON.stringify(algoProbabilities || null),
      JSON.stringify(goalPrediction || null),
      JSON.stringify(sources || {}),
      !!noApiData,
      !!featured,
    ]
  );
}

// Pour le dashboard admin : les pronostics pris un jour donné, y compris ceux suivis
// uniquement en tâche de fond (featured: false) et jamais montrés à un visiteur.
// predicted_at sert de proxy pour "jour du match" (les matchs du jour sont analysés le jour
// même) — suffisant ici, pas besoin d'une colonne kickoff dédiée pour un simple dashboard.
async function listPredictions({ sport = 'football', date, featured, limit = 300 } = {}) {
  const conditions = ['sport = $1'];
  const params = [sport];

  if (date) {
    params.push(date);
    conditions.push(`predicted_at::date = $${params.length}`);
  }
  if (featured !== undefined) {
    params.push(featured);
    conditions.push(`featured = $${params.length}`);
  }
  params.push(Math.min(1000, Math.max(1, limit)));

  const { rows } = await pool.query(
    `SELECT sport, fixture_id, league, home_team, away_team, predicted_pick, confidence,
            probabilities, algo_pick, sources, no_api_data, featured, predicted_at,
            actual_home_score, actual_away_score, correct, algo_correct, resolved_at
     FROM prediction_results
     WHERE ${conditions.join(' AND ')}
     ORDER BY predicted_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

// Calcule le résultat (1X2 + BTTS/+2,5 si applicable) à partir du pronostic déjà enregistré,
// sans ré-analyser le match. Ne fait rien si aucun pronostic n'avait été pris pour ce fixture
// (hors sélection auto, quota épuisé ce jour-là...) ou s'il est déjà résolu.
async function resolvePrediction(sport, fixtureId, homeScore, awayScore) {
  if (homeScore == null || awayScore == null) return;

  const { rows } = await pool.query(
    `SELECT predicted_pick, algo_pick, goal_prediction FROM prediction_results
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
  const algoCorrect = row.algo_pick ? actualPick === row.algo_pick : null;

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
         algo_correct = $6, btts_correct = $7, over25_correct = $8, resolved_at = now()
     WHERE sport = $1 AND fixture_id = $2`,
    [sport, String(fixtureId), homeScore, awayScore, correct, algoCorrect, bttsCorrect, over25Correct]
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
       COUNT(*) FILTER (WHERE correct = true AND no_api_data) AS algo_only_correct,
       COUNT(*) FILTER (WHERE resolved_at IS NOT NULL AND algo_pick IS NOT NULL) AS algo_pick_resolved,
       COUNT(*) FILTER (WHERE algo_correct = true) AS algo_pick_correct
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
    // Pronostic final envoyé aux visiteurs (algo + blend avec les sources externes)
    overall: bucket('resolved', 'correct'),
    highConfidence: bucket('high_conf_resolved', 'high_conf_correct'),
    // Matchs où l'algo n'avait aucune donnée interne (forme/h2h vides) -> sous-ensemble de "overall"
    algoOnly: bucket('algo_only_resolved', 'algo_only_correct'),
    // Ce qu'aurait donné l'algo SEUL, avant blend, sur les MÊMES matchs que "overall" -> la
    // comparaison directe qui dit si le blend aide vraiment ou si l'algo nu suffirait.
    // Alimente calibration.js pour ajuster le poids d'ancrage de l'algo dans blendProbabilities.
    algoAlone: bucket('algo_pick_resolved', 'algo_pick_correct'),
    bySource: Object.fromEntries(
      SOURCE_KEYS.map((key) => [key, bucket(`${key}_resolved`, `${key}_correct`)])
    ),
  };
}

module.exports = { recordPrediction, resolvePrediction, getAccuracyStats, listPredictions };
