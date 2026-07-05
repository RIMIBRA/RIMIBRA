const pool = require('./pool');

async function listActivePlans() {
  const { rows } = await pool.query(
    `SELECT id, plan, duration_days, price_fcfa, label
     FROM subscription_plans WHERE active = true
     ORDER BY plan, duration_days`
  );
  return rows;
}

async function getPlanById(planId) {
  const { rows } = await pool.query(
    `SELECT id, plan, duration_days, price_fcfa, label
     FROM subscription_plans WHERE id = $1 AND active = true`,
    [planId]
  );
  return rows[0] || null;
}

module.exports = { listActivePlans, getPlanById };
