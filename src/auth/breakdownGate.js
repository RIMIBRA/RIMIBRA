const { canUseFeature } = require('./tiers');
const adUnlocks = require('../db/adUnlocks');

// Un utilisateur gratuit ne voit QUE les probabilités et la recommandation — tout le reste
// (prédiction de buts, détail complet, probabilités du marché) est réservé au plan premium/vip,
// sauf si l'utilisateur a débloqué CE match précis contre une pub récompensée (voir
// routes/ads.js). Utilisé par chaque route de détail de match (une par sport) juste avant
// de renvoyer l'analyse au client.
async function applyBreakdownGate(analysis, req, sport) {
  if (!analysis || analysis.error) return analysis;

  const plan = req.user?.plan || 'free';
  if (req.user?.isAdmin || canUseFeature(plan, 'fullBreakdown')) {
    return { ...analysis, sport };
  }

  const fixtureId = analysis.fixture?.id;
  if (req.user && fixtureId && (await adUnlocks.hasUnlocked(req.user.id, sport, fixtureId))) {
    return { ...analysis, sport };
  }

  // Vue tronquée : seuls le pronostic et les probabilités 1X2 restent visibles. Prédiction de
  // buts, détail (breakdown) et probabilités du marché (odds) — réservés au premium/vip,
  // voir tiers.js — sont retirés.
  const { breakdown, odds, goalPrediction, ...rest } = analysis;
  return { ...rest, sport, breakdownLocked: true };
}

module.exports = { applyBreakdownGate };
