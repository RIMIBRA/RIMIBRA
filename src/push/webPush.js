const webpush = require('web-push');
const { getAllSubscriptionsGroupedByUser, removeSubscription } = require('../db/pushSubscriptions');
const { createNotification } = require('../db/notifications');
const { listUsersWithPlan } = require('../db/users');

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

// Notifie TOUS les utilisateurs, gratuit compris (créer l'envie plutôt que de notifier
// seulement ceux qui peuvent déjà tout voir) — buildPayload(user) reçoit
// { id, email, is_admin, plan } par utilisateur pour adapter le contenu (typiquement l'url :
// vers le combiné si déjà accessible, vers la page tarifs sinon). Chaque utilisateur reçoit une
// entrée dans sa boîte de notifications in-app (voir db/notifications.js), qu'il ait ou non un
// abonnement push actif — celui-ci ne sert qu'à le pousser en plus, immédiatement, si possible.
// Jamais bloquant pour l'appelant (création/résolution de combiné) : à appeler avec .catch(),
// pas await, depuis le code métier.
async function notifyAllUsers(buildPayload) {
  const [users, subsByUser] = await Promise.all([listUsersWithPlan(), getAllSubscriptionsGroupedByUser()]);

  await Promise.all(users.map(async (user) => {
    const payload = buildPayload(user);
    await createNotification(user.id, payload).catch((err) => console.error('Notification in-app (ignorée):', err.message));
    if (!configured) return;
    const subs = subsByUser.get(user.id) || [];
    await Promise.all(subs.map((sub) => sendToSubscription(sub, payload)));
  }));
}

module.exports = { notifyAllUsers, configured };
