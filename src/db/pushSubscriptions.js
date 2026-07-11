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

// Abonnements push des utilisateurs Premium/VIP actifs (+ admins, pour tester) — même filtre
// de plan que le reste de l'app (voir auth/tiers.js), en un seul aller-retour.
async function getPremiumSubscriptions() {
  const { rows } = await pool.query(`
    SELECT ps.endpoint, ps.p256dh, ps.auth
    FROM push_subscriptions ps
    JOIN users u ON u.id = ps.user_id
    WHERE u.is_admin = true OR EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.user_id = u.id AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > now())
        AND s.plan IN ('premium', 'vip')
    )
  `);
  return rows;
}

module.exports = { saveSubscription, removeSubscription, getPremiumSubscriptions };
