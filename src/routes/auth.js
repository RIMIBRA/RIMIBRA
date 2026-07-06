const express = require('express');
// bcryptjs (implémentation pure JS, même API que bcrypt) plutôt que bcrypt : ce dernier est un
// module natif compilé en C++, et s'est révélé se bloquer silencieusement (timeout, sans même
// une erreur) sur l'environnement Linux de Render en production, un problème invisible en dev
// sur Windows. bcryptjs élimine toute compilation native, donc ce risque de comportement
// différent selon la plateforme/version de Node.
const bcrypt = require('bcryptjs');
const router = express.Router();
const { createUser, findUserByEmail, getAuthInfo, setPlan } = require('../db/users');
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

// Catalogue des offres payantes (durée + prix) — sert à construire l'écran de choix d'abonnement
router.get('/plans', async (req, res) => {
  try {
    const plans = await subscriptionPlans.listActivePlans();
    res.json({ plans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ⚠️ Pas de paiement réel branché (FedaPay) pour l'instant — accepte directement planId sans
// vérifier qu'un paiement a eu lieu, comme routes/ads.js pour les pubs. À gater derrière la
// confirmation FedaPay (webhook signé) dès qu'elle existe ; ne pas laisser tel quel en prod.
router.post('/subscribe', attachUser, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
  const { plan, planId } = req.body || {};

  // Repasser gratuit ne correspond à aucune offre du catalogue (pas de durée/prix à choisir)
  if (plan === 'free') {
    const sub = await setPlan(req.user.id, 'free', null);
    return res.json({ plan: sub.plan, expiresAt: sub.expires_at });
  }

  if (!planId) return res.status(400).json({ error: 'planId requis (voir GET /api/auth/plans)' });
  const catalogPlan = await subscriptionPlans.getPlanById(planId);
  if (!catalogPlan) return res.status(400).json({ error: 'Offre invalide' });

  const expiresAt = new Date(Date.now() + catalogPlan.duration_days * 24 * 3600 * 1000);
  const sub = await setPlan(req.user.id, catalogPlan.plan, expiresAt, catalogPlan.id);
  res.json({ plan: sub.plan, expiresAt: sub.expires_at, planId: catalogPlan.id, priceFcfa: catalogPlan.price_fcfa });
});

module.exports = router;
