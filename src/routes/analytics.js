const express = require('express');
const router = express.Router();
const analytics = require('../db/analytics');

// Public (pas d'auth) : appelé une fois par chargement de page depuis chaque page publique
// (voir public/js/analytics.js). Aucune donnée personnelle en retour, juste un accusé 204.
router.post('/pageview', async (req, res) => {
  try {
    const { path } = req.body || {};
    if (!path || typeof path !== 'string') {
      return res.status(400).json({ error: 'Paramètre "path" requis.' });
    }
    await analytics.recordPageView(path, req.ip, req.headers['user-agent']);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
