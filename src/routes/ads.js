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

  const { sport, fixtureId } = req.body || {};
  if (!VALID_SPORTS.has(sport) || !fixtureId) {
    return res.status(400).json({ error: 'Paramètres "sport" et "fixtureId" requis.' });
  }

  try {
    await adUnlocks.recordUnlock(req.user.id, sport, fixtureId);
    res.json({ unlocked: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
