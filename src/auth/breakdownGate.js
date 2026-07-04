const { canUseFeature } = require('./tiers');
const adUnlocks = require('../db/adUnlocks');

// Le détail complet (forme, H2H, blessures, classement, cotes) est réservé au plan VIP —
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

  // Vue tronquée : pronostic/probabilités/prédiction de buts restent visibles, le détail
  // (breakdown) et les cotes bookmaker (odds) — explicitement VIP, voir tiers.js — sont retirés
  const { breakdown, odds, ...rest } = analysis;
  return { ...rest, sport, breakdownLocked: true };
}

module.exports = { applyBreakdownGate };
