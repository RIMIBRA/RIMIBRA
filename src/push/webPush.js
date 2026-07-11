const webpush = require('web-push');
const { getAllSubscriptions, removeSubscription } = require('../db/pushSubscriptions');

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

// Diffuse une notification à TOUS les abonnés, gratuit compris (créer l'envie plutôt que de
// notifier seulement ceux qui peuvent déjà tout voir) — buildPayload(sub) reçoit
// { plan, isAdmin } par abonné pour adapter le contenu (typiquement l'url : vers le combiné si
// déjà accessible, vers la page tarifs sinon). Jamais bloquant pour l'appelant
// (création/résolution de combiné) : à appeler avec .catch(), pas await, depuis le code métier.
async function broadcastPush(buildPayload) {
  if (!configured) return;
  const subs = await getAllSubscriptions();
  await Promise.all(subs.map((sub) => sendToSubscription(sub, buildPayload(sub))));
}

module.exports = { broadcastPush, configured };
