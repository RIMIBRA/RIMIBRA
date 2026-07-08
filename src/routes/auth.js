const express = require('express');
// bcryptjs (implémentation pure JS, même API que bcrypt) plutôt que bcrypt : ce dernier est un
// module natif compilé en C++, et s'est révélé se bloquer silencieusement (timeout, sans même
// une erreur) sur l'environnement Linux de Render en production, un problème invisible en dev
// sur Windows. bcryptjs élimine toute compilation native, donc ce risque de comportement
// différent selon la plateforme/version de Node.
const bcrypt = require('bcryptjs');
const router = express.Router();
const { createUser, findUserByEmail, getAuthInfo, touchLastLogin } = require('../db/users');
const subscriptionPlans = require('../db/subscriptionPlans');
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
    // Ne doit jamais faire échouer l'inscription si ça échoue (voir touchLastLogin)
    touchLastLogin(user.id).catch((err) => console.error('touchLastLogin (register) ignoré :', err.message));
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
    // Ne doit jamais faire échouer la connexion si ça échoue (voir touchLastLogin)
    touchLastLogin(user.id).catch((err) => console.error('touchLastLogin (login) ignoré :', err.message));
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

// Catalogue des offres payantes (durée + prix) — sert à construire l'écran de choix d'abonnement
router.get('/plans', async (req, res) => {
  try {
    const plans = await subscriptionPlans.listActivePlans();
    res.json({ plans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Le passage à un plan payant se fait uniquement via /api/payments/checkout (GeniusPay) puis
// le webhook signé (voir routes/payments.js), jamais via une route qui accepterait un planId
// directement du client sans preuve de paiement.

module.exports = router;
