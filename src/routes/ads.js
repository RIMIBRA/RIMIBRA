const express = require('express');
const router = express.Router();
const adUnlocks = require('../db/adUnlocks');

const VALID_SPORTS = new Set(['football', 'nfl', 'nba', 'hockey', 'baseball', 'handball', 'tennis']);

// ⚠️ Pas de compte Google AdSense/Ad Manager branché pour l'instant (voir public/js/ads.js) —
// donc pas de vérification serveur réelle du visionnage (Server-Side Verification). Cette
// route fait confiance au client, ce qui est contournable (n'importe qui peut appeler cet
// endpoint directement sans avoir vu de pub). À remplacer par le callback SSV signé de Google
// dès qu'un vrai compte pub existe — ne pas laisser cette route telle quelle en production.
router.post('/unlock', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Connexion requise pour débloquer via publicité.' });
  }

  const { sport, fixtureId, level } = req.body || {};
  if (!VALID_SPORTS.has(sport) || !fixtureId || !adUnlocks.LEVELS.includes(level)) {
    return res.status(400).json({ error: 'Paramètres "sport", "fixtureId" et "level" requis.' });
  }

  try {
    const plan = req.user.plan || 'free';
    const requiredViews = adUnlocks.requiredViewsFor(plan, level);
    if (requiredViews == null) {
      return res.status(400).json({ error: 'Ce niveau est déjà inclus dans votre abonnement, ou non disponible par pub pour votre plan.' });
    }

    const progress = await adUnlocks.recordView(req.user.id, sport, fixtureId, level, requiredViews);
    res.json({
      viewsCount: progress.views_count,
      viewsRequired: requiredViews,
      unlocked: !!progress.unlocked_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
