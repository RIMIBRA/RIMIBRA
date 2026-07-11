const webpush = require('web-push');
const { getPremiumSubscriptions, removeSubscription } = require('../db/pushSubscriptions');

// Absentes en dev local tant que le .env n'est pas rempli -> mode no-op silencieux plutôt
// qu'un crash au démarrage (web-push exige des clés valides pour setVapidDetails).
const configured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (configured) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:rimtechdigital@gmail.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

async function sendToSubscription(sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
  } catch (err) {
    // 404/410 : abonnement expiré ou révoqué côté navigateur -> on ne le garde pas, sinon on
    // retenterait indéfiniment un envoi voué à échouer à chaque notification future
    if (err.statusCode === 404 || err.statusCode === 410) {
      await removeSubscription(sub.endpoint).catch(() => {});
    } else {
      console.error('Échec envoi notification push (ignoré):', err.message);
    }
  }
}

// Diffuse une notification à tous les abonnés Premium/VIP — jamais bloquant pour l'appelant
// (création/résolution de combiné) : à appeler avec .catch(), pas await, depuis le code métier.
async function notifyPremiumUsers(payload) {
  if (!configured) return;
  const subs = await getPremiumSubscriptions();
  await Promise.all(subs.map((sub) => sendToSubscription(sub, payload)));
}

module.exports = { notifyPremiumUsers, configured };
