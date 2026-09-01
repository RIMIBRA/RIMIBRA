const express = require('express');
const router = express.Router();
const analytics = require('../db/analytics');
const { sendServerError } = require('../utils/httpErrors');

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
    sendServerError(res, err);
  }
});

// Un clic sur un bouton partenaire (voir public/partenaires.html) — même principe que
// /pageview : fire-and-forget, ne bloque jamais l'ouverture du lien d'affiliation.
router.post('/click', async (req, res) => {
  try {
    const { partner, path } = req.body || {};
    if (!partner || typeof partner !== 'string') {
      return res.status(400).json({ error: 'Paramètre "partner" requis.' });
    }
    await analytics.recordClick(partner, path, req.ip, req.headers['user-agent']);
    res.status(204).end();
  } catch (err) {
    sendServerError(res, err);
  }
});

module.exports = router;
