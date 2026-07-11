// Poisson-based goal prediction from team form data

function poissonProb(lambda, k) {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return Math.exp(-lambda) * Math.pow(lambda, k) / fact;
}

// P(total de buts > line), line étant une demi-ligne (0.5, 1.5, 2.5...) comme au foot ->
// P(X > k+0.5) = 1 - P(X <= k). Généralise le calcul déjà fait pour over15/over25 afin
// d'exposer d'autres lignes (0.5, 3.5, 4.5, 5.5) sans dupliquer la somme des p_k à chaque fois.
function overProbability(lambda, line) {
  const k = Math.floor(line);
  let cumulative = 0;
  for (let i = 0; i <= k; i++) cumulative += poissonProb(lambda, i);
  return Math.round((1 - cumulative) * 100);
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

  // Distribution de Poisson sur le total de buts — une ligne par seuil demandé par les
  // marchés "Total buts" du combiné manuel (0.5 à 5.5, les lignes bookmaker les plus courantes).
  const clamp = (v) => Math.max(0, Math.min(99, v));
  const over05 = clamp(overProbability(xGTotal, 0.5));
  const over15 = clamp(overProbability(xGTotal, 1.5));
  const over25 = clamp(overProbability(xGTotal, 2.5));
  const over35 = clamp(overProbability(xGTotal, 3.5));
  const over45 = clamp(overProbability(xGTotal, 4.5));
  const over55 = clamp(overProbability(xGTotal, 5.5));

  // BTTS : P(home ≥ 1) × P(away ≥ 1)
  const btts = Math.round(
    (1 - Math.exp(-xGHome)) * (1 - Math.exp(-xGAway)) * 100
  );

  return {
    xGHome: Math.round(xGHome * 10) / 10,
    xGAway: Math.round(xGAway * 10) / 10,
    xGTotal: Math.round(xGTotal * 10) / 10,
    over05, over15, over25, over35, over45, over55,
    btts: clamp(btts),
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
    over05: Math.round(Math.min(97, over25 + 40)),
    over15: Math.round(Math.min(85, over25 + 22)),
    over25: Math.round(over25),
    over35: Math.round(Math.max(5, over25 - 20)),
    over45: Math.round(Math.max(3, over25 - 32)),
    over55: Math.round(Math.max(1, over25 - 40)),
    btts:   Math.round(btts),
  };
}

module.exports = { calcGoalPrediction, goalHeuristic };
