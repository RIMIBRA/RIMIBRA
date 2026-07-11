const pool = require('./pool');

// Tous les combinés du jour pour un sport, du plus ancien au plus récent —
// le dernier de la liste est celui potentiellement encore actif
async function getCombosForSport(date, sport) {
  const { rows } = await pool.query(
    'SELECT * FROM combos WHERE combo_date = $1 AND sport = $2 ORDER BY created_at ASC',
    [date, sport]
  );
  return rows;
}

async function saveCombo(date, sport, sportLabel, matches, combinedProbability, risk) {
  const { rows } = await pool.query(
    `INSERT INTO combos (combo_date, sport, sport_label, matches, combined_probability, risk)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [date, sport, sportLabel, JSON.stringify(matches), combinedProbability, risk]
  );
  return rows[0];
}

// Marque un combiné comme déjà notifié aux abonnés Premium/VIP une fois résolu (voir
// routes/combos.js checkSpecialComboResolutions) — évite de renvoyer la même notification
// push à chaque vérification périodique.
async function markComboNotified(id) {
  await pool.query('UPDATE combos SET resolution_notified = true WHERE id = $1', [id]);
}

module.exports = { getCombosForSport, saveCombo, markComboNotified };
