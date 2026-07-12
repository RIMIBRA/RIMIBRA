const pool = require('./pool');

async function saveSubscription(userId, sub) {
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4`,
    [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
  );
}

async function removeSubscription(endpoint) {
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

// Tous les abonnements push, regroupés par utilisateur (Map<userId, [{endpoint,p256dh,auth}]>)
// — voir push/webPush.js notifyAllUsers, qui parcourt TOUS les utilisateurs (listUsersWithPlan,
// db/users.js) pour la boîte de notifications in-app, et n'a besoin des abonnements push que
// pour ceux qui en ont un (0 à N par utilisateur).
async function getAllSubscriptionsGroupedByUser() {
  const { rows } = await pool.query('SELECT user_id, endpoint, p256dh, auth FROM push_subscriptions');
  const byUser = new Map();
  for (const row of rows) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id).push({ endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth });
  }
  return byUser;
}

module.exports = { saveSubscription, removeSubscription, getAllSubscriptionsGroupedByUser };
