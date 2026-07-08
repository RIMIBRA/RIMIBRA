const { canUseFeature } = require('./tiers');

// Deux niveaux de contenu verrouillé, débloqués uniquement par le plan d'abonnement (voir
// tiers.js) :
//   - 'premium_details' (prédiction de buts)          -> inclus dès le plan premium
//   - 'vip_details' (breakdown complet + cotes marché) -> inclus uniquement au plan vip
// Utilisé par chaque route de détail de match (une par sport) juste avant de renvoyer
// l'analyse au client.
async function applyBreakdownGate(analysis, req, sport) {
  if (!analysis || analysis.error) return analysis;
  if (req.user?.isAdmin) return { ...analysis, sport };

  const plan = req.user?.plan || 'free';
  const result = { ...analysis, sport };

  if (!canUseFeature(plan, 'goalPrediction')) {
    delete result.goalPrediction;
    result.goalPredictionLocked = true;
  }

  if (!canUseFeature(plan, 'fullBreakdown')) {
    delete result.breakdown;
    delete result.odds;
    result.breakdownLocked = true;
  }

  return result;
}

module.exports = { applyBreakdownGate };
