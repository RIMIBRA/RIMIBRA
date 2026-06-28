const { verify } = require('./jwt');
const { getAuthInfo } = require('../db/users');
const { canAccessSport, canUseFeature } = require('./tiers');

// Authentification optionnelle : si un token valide est présent, req.user est rempli ;
// sinon req.user reste null (traité comme visiteur 'free' par les middlewares suivants)
async function attachUser(req, res, next) {
  req.user = null;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = verify(header.slice(7));
      const { plan, isAdmin } = await getAuthInfo(payload.userId);
      req.user = { id: payload.userId, email: payload.email, plan, isAdmin };
    } catch {
      // token invalide/expiré -> traité comme visiteur
    }
  }
  next();
}

function requireSportAccess(sport) {
  return (req, res, next) => {
    if (req.user?.isAdmin) return next(); // accès total pour le fondateur
    const plan = req.user?.plan || 'free';
    if (!canAccessSport(plan, sport)) {
      return res.status(403).json({
        error: `Ce sport nécessite un abonnement premium ou supérieur (plan actuel : ${plan}).`,
        upgradeRequired: true,
      });
    }
    next();
  };
}

function requireFeature(feature) {
  return (req, res, next) => {
    if (req.user?.isAdmin) return next();
    const plan = req.user?.plan || 'free';
    if (!canUseFeature(plan, feature)) {
      return res.status(403).json({
        error: `Cette fonctionnalité nécessite un abonnement supérieur (plan actuel : ${plan}).`,
        upgradeRequired: true,
      });
    }
    next();
  };
}

function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  next();
}

module.exports = { attachUser, requireSportAccess, requireFeature, requireAdmin };
