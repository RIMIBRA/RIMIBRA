const pool = require('./pool');

async function createUser(email, passwordHash) {
  const { rows } = await pool.query(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at',
    [email, passwordHash]
  );
  // Tout nouvel utilisateur démarre sur le plan gratuit
  await pool.query(
    "INSERT INTO subscriptions (user_id, plan, status) VALUES ($1, 'free', 'active')",
    [rows[0].id]
  );
  return rows[0];
}

async function findUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] || null;
}

// Appelé à chaque connexion réussie et à l'inscription (voir routes/auth.js) — jamais bloquant
// pour le flux d'auth : un échec ici ne doit pas empêcher un utilisateur de se connecter.
async function touchLastLogin(userId) {
  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
}

async function findUserById(id) {
  const { rows } = await pool.query('SELECT id, email, is_admin, created_at FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

// Réinitialisation de mot de passe (voir routes/auth.js /reset-password) — remplace le hash
// existant, aucune autre condition (le token déjà consommé par l'appelant fait foi).
async function updatePassword(userId, passwordHash) {
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
}

// Abonnement le plus récent et encore valide (non expiré, non annulé) — sinon 'free' par défaut
async function getActivePlan(userId) {
  const { rows } = await pool.query(
    `SELECT plan FROM subscriptions
     WHERE user_id = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > now())
     ORDER BY started_at DESC LIMIT 1`,
    [userId]
  );
  return rows[0]?.plan || 'free';
}

// Plan + statut admin en un seul aller-retour, utilisé par le middleware sur chaque requête
async function getAuthInfo(userId) {
  const [{ rows: userRows }, plan] = await Promise.all([
    pool.query('SELECT is_admin FROM users WHERE id = $1', [userId]),
    getActivePlan(userId),
  ]);
  return { plan, isAdmin: userRows[0]?.is_admin || false };
}

async function setPlan(userId, plan, expiresAt = null, planId = null) {
  await pool.query(
    "UPDATE subscriptions SET status = 'cancelled' WHERE user_id = $1 AND status = 'active'",
    [userId]
  );
  const { rows } = await pool.query(
    'INSERT INTO subscriptions (user_id, plan, status, expires_at, plan_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [userId, plan, 'active', expiresAt, planId]
  );
  return rows[0];
}

// Pour le dashboard admin : liste des utilisateurs avec leur plan actif
async function listUsersWithPlan() {
  const { rows } = await pool.query(`
    SELECT u.id, u.email, u.is_admin, u.created_at, u.last_login_at,
      COALESCE((
        SELECT plan FROM subscriptions s
        WHERE s.user_id = u.id AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > now())
        ORDER BY s.started_at DESC LIMIT 1
      ), 'free') AS plan
    FROM users u
    ORDER BY u.created_at DESC
  `);
  return rows;
}

module.exports = {
  createUser,
  findUserByEmail,
  findUserById,
  getActivePlan,
  getAuthInfo,
  setPlan,
  listUsersWithPlan,
  touchLastLogin,
  updatePassword,
};
