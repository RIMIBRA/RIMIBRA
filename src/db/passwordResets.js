const crypto = require('crypto');
const pool = require('./pool');

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1h : assez pour un email consulté avec un peu de retard,
// assez court pour limiter la fenêtre d'exploitation d'un lien intercepté (boîte mail partagée...)

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// Un seul lien valide à la fois par utilisateur : toute nouvelle demande invalide les
// précédentes -> un ancien lien oublié dans une boîte mail ne reste pas exploitable
// indéfiniment après qu'un nouveau a été demandé.
async function createResetToken(userId) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await pool.query(
    'UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
    [userId]
  );
  await pool.query(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, hashToken(rawToken), expiresAt]
  );
  return rawToken;
}

// Renvoie l'user_id si le token est valide (existe, non utilisé, non expiré) sans le marquer
// consommé -> permet de valider le lien côté page de réinitialisation avant que l'utilisateur
// n'ait saisi son nouveau mot de passe, sans le griller pour rien s'il recharge la page.
async function peekResetToken(rawToken) {
  const { rows } = await pool.query(
    `SELECT user_id FROM password_reset_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [hashToken(rawToken)]
  );
  return rows[0]?.user_id || null;
}

// Marque le token consommé -> un lien de réinitialisation ne peut servir qu'une seule fois,
// même en cas de double-soumission du formulaire.
async function consumeResetToken(rawToken) {
  const { rows } = await pool.query(
    `UPDATE password_reset_tokens SET used_at = now()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING user_id`,
    [hashToken(rawToken)]
  );
  return rows[0]?.user_id || null;
}

module.exports = { createResetToken, peekResetToken, consumeResetToken };
