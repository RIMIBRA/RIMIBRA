const predictionResults = require('../db/predictionResults');

// En dessous de ce nombre de pronostics résolus, une source garde son poids par défaut —
// un taux de réussite calculé sur 10 matchs est du bruit, pas un signal exploitable.
const MIN_SAMPLES = 40;
// Recalcule au plus toutes les 6h (appelé en fond, jamais dans le chemin d'une requête) :
// les taux de réussite bougent lentement, pas besoin de retaper la base à chaque prédiction.
const REFRESH_INTERVAL_MS = 6 * 3600 * 1000;
const LOOKBACK_DAYS = 30;

// Mêmes valeurs que le comportement historique de blendProbabilities (algo compté double,
// chaque source externe pour 1) -> tant qu'il n'y a pas assez de données, rien ne change.
// apiOdds pèse plus lourd par défaut : consensus de plusieurs bookmakers (voir
// algorithm/bookmakerOdds.js), pas l'avis d'une seule source.
const DEFAULT_WEIGHTS = { algo: 2, footballpred: 1, forebet: 1, besoccer: 1, oddsapi: 1, flashscore: 1, apiOdds: 2 };
const MIN_WEIGHT = 0.3;
const MAX_WEIGHT = 3;

let cachedWeights = { ...DEFAULT_WEIGHTS };
let lastRefresh = 0;
let refreshing = false;

function clamp(w) {
  return Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, w));
}

// 50% de justesse sur un 1X2 est déjà un bon repère (nettement au-dessus d'un pronostic "au
// hasard" sur 3 issues) -> on le prend comme neutre : une source à 60% pèse plus que le
// défaut, une source à 35% pèse moins, sans jamais tomber à 0 (elle peut encore rattraper).
function weightFromAccuracy(accuracy, resolved, baseWeight) {
  if (accuracy == null || resolved < MIN_SAMPLES) return null;
  return clamp((accuracy / 50) * baseWeight);
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const stats = await predictionResults.getAccuracyStats('football', LOOKBACK_DAYS);
    const weights = { ...DEFAULT_WEIGHTS };

    const algoWeight = weightFromAccuracy(stats.algoAlone.accuracy, stats.algoAlone.resolved, DEFAULT_WEIGHTS.algo);
    if (algoWeight != null) weights.algo = algoWeight;

    for (const [source, bucket] of Object.entries(stats.bySource)) {
      const w = weightFromAccuracy(bucket.accuracy, bucket.resolved, DEFAULT_WEIGHTS[source] ?? 1);
      if (w != null) weights[source] = w;
    }

    cachedWeights = weights;
    lastRefresh = Date.now();
  } catch (err) {
    console.error('Échec recalibration des poids (poids précédents conservés):', err.message);
  } finally {
    refreshing = false;
  }
}

// Toujours synchrone et immédiat : sert les poids en cache, et déclenche un rafraîchissement
// en fond (sans l'attendre) si le cache a plus de REFRESH_INTERVAL_MS -> aucune requête
// visiteur n'attend jamais sur un calcul de calibration.
function getWeights() {
  if (Date.now() - lastRefresh > REFRESH_INTERVAL_MS) refresh();
  return cachedWeights;
}

module.exports = { getWeights, refresh, DEFAULT_WEIGHTS, MIN_SAMPLES };
