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

// Tous les abonnements push, gratuit compris (voir push/webPush.js broadcastPush — tout le
// monde est notifié pour créer l'envie, seul le contenu accessible au clic diffère selon le
// plan) — plan + isAdmin renvoyés pour que l'appelant adapte l'URL de la notif par abonné,
// même requête que listUsersWithPlan() (db/users.js).
async function getAllSubscriptions() {
  const { rows } = await pool.query(`
    SELECT ps.endpoint, ps.p256dh, ps.auth, u.is_admin AS "isAdmin",
      COALESCE((
        SELECT plan FROM subscriptions s
        WHERE s.user_id = u.id AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > now())
        ORDER BY s.started_at DESC LIMIT 1
      ), 'free') AS plan
    FROM push_subscriptions ps
    JOIN users u ON u.id = ps.user_id
  `);
  return rows;
}

module.exports = { saveSubscription, removeSubscription, getAllSubscriptions };
