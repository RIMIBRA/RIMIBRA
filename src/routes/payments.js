const express = require('express');
const router = express.Router();
const { attachUser } = require('../auth/middleware');
const subscriptionPlans = require('../db/subscriptionPlans');
const paymentTransactions = require('../db/paymentTransactions');
const { setPlan } = require('../db/users');
const geniuspay = require('../payments/geniuspay');
const { sendServerError } = require('../utils/httpErrors');

// URL publique du site — sert à construire les liens success_url/error_url que GeniusPay
// utilise pour rediriger le navigateur du client après paiement (pas le webhook, qui est
// appelé serveur à serveur séparément, voir plus bas).
const SITE_URL = process.env.SITE_URL || 'http://localhost:' + (process.env.PORT || 3001);

// Crée une transaction en attente + une session de paiement GeniusPay, renvoie l'URL de
// checkout vers laquelle le frontend doit rediriger le navigateur. Le plan n'est PAS activé
// ici — seulement après confirmation du webhook (voir /webhook plus bas) : on ne fait jamais
// confiance à la simple redirection success_url, qu'un visiteur pourrait atteindre sans avoir
// réellement payé.
router.post('/checkout', attachUser, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Connexion requise' });

  try {
    const { planId } = req.body || {};
    if (!planId) return res.status(400).json({ error: 'planId requis (voir GET /api/auth/plans)' });

    const plan = await subscriptionPlans.getPlanById(planId);
    if (!plan) return res.status(400).json({ error: 'Offre invalide' });

    const transaction = await paymentTransactions.createPending(req.user.id, plan.id, plan.price_fcfa);

    const payment = await geniuspay.createCheckout({
      amount: plan.price_fcfa,
      description: `footpredictongoal — ${plan.label}`,
      customer: { email: req.user.email },
      metadata: { transaction_id: transaction.id, user_id: req.user.id, plan_id: plan.id },
      successUrl: `${SITE_URL}/paiement-succes.html?ref=${transaction.id}`,
      errorUrl: `${SITE_URL}/paiement-echec.html`,
    });

    await paymentTransactions.attachReference(transaction.id, payment.reference);

    res.json({ checkoutUrl: payment.checkout_url, reference: payment.reference });
  } catch (err) {
    sendServerError(res, err);
  }
});

// Permet à la page de succès d'afficher "en cours de confirmation" puis de savoir quand le
// webhook a fini de traiter le paiement, sans jamais activer le plan elle-même.
router.get('/status/:transactionId', attachUser, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Connexion requise' });
  const transaction = await paymentTransactions.findById(req.params.transactionId);
  if (!transaction || transaction.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Transaction introuvable' });
  }
  res.json({ status: transaction.status });
});

// Appelé par les serveurs GeniusPay (pas par le navigateur du client) — jamais de session/JWT
// ici, uniquement la signature HMAC. req.rawBody est le Buffer exact du corps de la requête,
// capturé par le "verify" du express.json() global (voir server.js) : indispensable, un objet
// re-sérialisé pourrait différer octet à octet de ce que GeniusPay a réellement signé.
router.post('/geniuspay/webhook', async (req, res) => {
  const signature = req.header('X-Webhook-Signature');
  const timestamp = req.header('X-Webhook-Timestamp');
  const event = req.header('X-Webhook-Event');
  const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);

  const valid = geniuspay.verifyWebhookSignature({ rawBody, signature, timestamp });
  if (!valid) return res.status(401).json({ error: 'Signature invalide' });

  try {
    const payload = req.body?.data;
    const reference = payload?.reference;
    if (!reference) return res.status(400).json({ error: 'Référence manquante dans le webhook' });

    if (event === 'payment.success') {
      const transaction = await paymentTransactions.findByReference(reference);
      // Transaction déjà traitée (webhook potentiellement renvoyé par GeniusPay en cas de
      // non-réponse) -> ne pas réactiver un plan une seconde fois pour le même paiement.
      if (!transaction || transaction.status === 'completed') return res.json({ received: true });

      const plan = await subscriptionPlans.getPlanById(transaction.plan_id);
      const expiresAt = new Date(Date.now() + plan.duration_days * 24 * 3600 * 1000);
      await setPlan(transaction.user_id, plan.plan, expiresAt, plan.id);
      await paymentTransactions.markStatus(reference, 'completed');
    } else if (['payment.failed', 'payment.cancelled', 'payment.expired'].includes(event)) {
      await paymentTransactions.markStatus(reference, event.replace('payment.', ''));
    }

    res.json({ received: true });
  } catch (err) {
    sendServerError(res, err);
  }
});

module.exports = router;
