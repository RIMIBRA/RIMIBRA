const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { createUser, findUserByEmail, getAuthInfo, setPlan } = require('../db/users');
const { sign } = require('../auth/jwt');
const { attachUser } = require('../auth/middleware');

// Interdit aussi les caractères HTML (<>"') — défense en profondeur en plus de
// l'échappement à l'affichage, au cas où un email serait rendu sans passer par escapeHtml
const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Email invalide' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Mot de passe trop court (8 caractères minimum)' });

    const existing = await findUserByEmail(email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'Un compte existe déjà avec cet email' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await createUser(email.toLowerCase(), passwordHash);
    const token = sign({ userId: user.id, email: user.email });
    res.status(201).json({ token, user: { id: user.id, email: user.email, plan: 'free', isAdmin: false } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

    const user = await findUserByEmail(email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Identifiants invalides' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Identifiants invalides' });

    const { plan, isAdmin } = await getAuthInfo(user.id);
    const token = sign({ userId: user.id, email: user.email });
    res.json({ token, user: { id: user.id, email: user.email, plan, isAdmin } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', attachUser, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
  res.json({ id: req.user.id, email: req.user.email, plan: req.user.plan, isAdmin: req.user.isAdmin });
});

// Changement de plan manuel pour l'instant (en attendant une vraie intégration Stripe/paiement)
router.post('/subscribe', attachUser, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
  const { plan } = req.body || {};
  if (!['free', 'premium', 'vip'].includes(plan)) return res.status(400).json({ error: 'Plan invalide' });

  const expiresAt = plan === 'free' ? null : new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const sub = await setPlan(req.user.id, plan, expiresAt);
  res.json({ plan: sub.plan, expiresAt: sub.expires_at });
});

module.exports = router;
