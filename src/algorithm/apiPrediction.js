// Pronostic propre au fournisseur (api-sports.io /predictions) — un modèle statistique
// indépendant du nôtre, avec sa propre répartition home/draw/away en %. Contrairement aux
// scrapers (voir scraper/*.js), aucun matching approximatif par nom nécessaire : l'endpoint
// est directement scopé par id de fixture.

function parsePercent(value) {
  if (typeof value !== 'string') return null;
  const n = parseInt(value.replace('%', ''), 10);
  return Number.isFinite(n) ? n : null;
}

// prediction = la réponse brute de api.getPredictions(fixtureId) (un seul objet, pas une liste).
function extractProbabilities(prediction) {
  const percent = prediction?.predictions?.percent;
  if (!percent) return null;

  const home = parsePercent(percent.home);
  const draw = parsePercent(percent.draw);
  const away = parsePercent(percent.away);
  if (home == null || draw == null || away == null) return null;

  return {
    probabilities: { home, draw, away },
    advice: prediction.predictions.advice || null,
    source: 'api-prediction',
  };
}

module.exports = { extractProbabilities };
