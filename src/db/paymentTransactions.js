const pool = require('./pool');

async function createPending(userId, planId, amountFcfa, provider = 'geniuspay') {
  const { rows } = await pool.query(
    `INSERT INTO payment_transactions (user_id, plan_id, provider, amount_fcfa)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, planId, provider, amountFcfa]
  );
  return rows[0];
}

// La référence n'est connue qu'après l'appel à l'API du fournisseur (createPending existe
// avant, pour avoir un id interne à passer en metadata lors de la création du paiement).
async function attachReference(id, reference) {
  const { rows } = await pool.query(
    'UPDATE payment_transactions SET reference = $1 WHERE id = $2 RETURNING *',
    [reference, id]
  );
  return rows[0];
}

async function findByReference(reference) {
  const { rows } = await pool.query('SELECT * FROM payment_transactions WHERE reference = $1', [reference]);
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM payment_transactions WHERE id = $1', [id]);
  return rows[0] || null;
}

async function markStatus(reference, status) {
  const completedAt = status === 'completed' ? 'now()' : 'NULL';
  const { rows } = await pool.query(
    `UPDATE payment_transactions SET status = $1, completed_at = ${completedAt} WHERE reference = $2 RETURNING *`,
    [status, reference]
  );
  return rows[0] || null;
}

module.exports = { createPending, attachReference, findByReference, findById, markStatus };
