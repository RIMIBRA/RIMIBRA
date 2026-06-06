// Poisson-based goal prediction from team form data

function poissonProb(lambda, k) {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return Math.exp(-lambda) * Math.pow(lambda, k) / fact;
}

function calcGoalPrediction(homeForm, awayForm) {
  const n = 5; // derniers matchs analysés

  // Si pas de données de forme → retourner null (affiché différemment côté client)
  if (!homeForm || !awayForm || homeForm.score === 50 && awayForm.score === 50) return null;

  const homeAvgScored    = (homeForm.goalsScored    ?? 0) / n;
  const homeAvgConceded  = (homeForm.goalsConceded  ?? 0) / n;
  const awayAvgScored    = (awayForm.goalsScored    ?? 0) / n;
  const awayAvgConceded  = (awayForm.goalsConceded  ?? 0) / n;

  // xG = moyenne entre attaque de l'équipe et défense adverse
  const xGHome = (homeAvgScored + awayAvgConceded) / 2;
  const xGAway = (awayAvgScored + homeAvgConceded) / 2;
  const xGTotal = xGHome + xGAway;

  // Distribution de Poisson sur le total de buts
  const p0 = poissonProb(xGTotal, 0);
  const p1 = poissonProb(xGTotal, 1);
  const p2 = poissonProb(xGTotal, 2);

  const over15 = Math.round((1 - p0 - p1) * 100);
  const over25 = Math.round((1 - p0 - p1 - p2) * 100);

  // BTTS : P(home ≥ 1) × P(away ≥ 1)
  const btts = Math.round(
    (1 - Math.exp(-xGHome)) * (1 - Math.exp(-xGAway)) * 100
  );

  return {
    xGHome: Math.round(xGHome * 10) / 10,
    xGAway: Math.round(xGAway * 10) / 10,
    xGTotal: Math.round(xGTotal * 10) / 10,
    over15: Math.max(0, Math.min(99, over15)),
    over25: Math.max(0, Math.min(99, over25)),
    btts:   Math.max(0, Math.min(99, btts)),
  };
}

// Heuristique pour mode web (pas de données de forme)
// Basée sur les probabilités 1X2 : match ouvert → plus de buts
function goalHeuristic(probs) {
  const maxP = Math.max(probs.home, probs.away);
  const dominance = maxP - 33; // 0 = équilibré, 40 = très dominant

  // Match équilibré → plus de buts, BTTS plus probable
  const over25 = Math.max(20, Math.min(75, 55 - dominance * 0.4));
  const btts    = Math.max(20, Math.min(70, 50 - dominance * 0.5));

  return {
    xGHome: null,
    xGAway: null,
    xGTotal: null,
    over15: Math.round(Math.min(85, over25 + 22)),
    over25: Math.round(over25),
    btts:   Math.round(btts),
  };
}

module.exports = { calcGoalPrediction, goalHeuristic };
