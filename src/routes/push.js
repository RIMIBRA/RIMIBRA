const express = require('express');
const router = express.Router();
const { saveSubscription, removeSubscription } = require('../db/pushSubscriptions');
const { configured } = require('../push/webPush');
const { sendServerError } = require('../utils/httpErrors');

router.get('/vapid-public-key', (req, res) => {
  if (!configured) return res.status(503).json({ error: 'Notifications push non configurées côté serveur' });
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

router.post('/subscribe', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Connexion requise' });
  const { subscription } = req.body || {};
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: 'Abonnement push invalide' });
  }
  try {
    await saveSubscription(req.user.id, subscription);
    res.status(201).json({ ok: true });
  } catch (err) {
    sendServerError(res, err);
  }
});

// Pas de vérification de propriétaire ici volontairement : un endpoint push est un secret
// propre au navigateur (aléatoire, non devinable) — le connaître suffit à prouver qu'on est
// bien l'appareil concerné, comme le fait déjà le navigateur lui-même côté client.
router.post('/unsubscribe', async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint requis' });
  await removeSubscription(endpoint).catch(() => {});
  res.json({ ok: true });
});

module.exports = router;
