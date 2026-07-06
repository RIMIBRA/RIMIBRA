const { canUseFeature } = require('./tiers');
const adUnlocks = require('../db/adUnlocks');

// Deux niveaux de contenu verrouillé, chacun débloquable soit par le plan d'abonnement, soit
// match par match contre un nombre de pubs vues qui dépend du plan actuel (voir tiers.js et
// db/adUnlocks.js) :
//   - 'premium_details' (prédiction de buts)          -> inclus dès le plan premium
//   - 'vip_details' (breakdown complet + cotes marché) -> inclus uniquement au plan vip
// Utilisé par chaque route de détail de match (une par sport) juste avant de renvoyer
// l'analyse au client.
async function applyBreakdownGate(analysis, req, sport) {
  if (!analysis || analysis.error) return analysis;
  if (req.user?.isAdmin) return { ...analysis, sport };

  const plan = req.user?.plan || 'free';
  const fixtureId = analysis.fixture?.id;
  const result = { ...analysis, sport };

  if (!canUseFeature(plan, 'goalPrediction')) {
    const unlocked = !!(req.user && fixtureId && await adUnlocks.isUnlocked(req.user.id, sport, fixtureId, 'premium_details'));
    if (!unlocked) {
      delete result.goalPrediction;
      result.goalPredictionLocked = true;
      result.goalPredictionViewsRequired = adUnlocks.requiredViewsFor(plan, 'premium_details');
    }
  }

  if (!canUseFeature(plan, 'fullBreakdown')) {
    const unlocked = !!(req.user && fixtureId && await adUnlocks.isUnlocked(req.user.id, sport, fixtureId, 'vip_details'));
    if (!unlocked) {
      delete result.breakdown;
      delete result.odds;
      result.breakdownLocked = true;
      result.breakdownViewsRequired = adUnlocks.requiredViewsFor(plan, 'vip_details');
    }
  }

  return result;
}

module.exports = { applyBreakdownGate };
