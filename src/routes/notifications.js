const express = require('express');
const router = express.Router();
const { listForUser, unreadCount, markRead, markAllRead } = require('../db/notifications');
const { sendServerError } = require('../utils/httpErrors');

router.get('/', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Connexion requise' });
  try {
    const [notifications, unread] = await Promise.all([
      listForUser(req.user.id),
      unreadCount(req.user.id),
    ]);
    res.json({ notifications, unreadCount: unread });
  } catch (err) {
    sendServerError(res, err);
  }
});

router.post('/:id/read', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Connexion requise' });
  try {
    await markRead(req.user.id, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, err);
  }
});

router.post('/read-all', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Connexion requise' });
  try {
    await markAllRead(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    sendServerError(res, err);
  }
});

module.exports = router;
