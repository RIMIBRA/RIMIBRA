const pool = require('./pool');

async function hasUnlocked(userId, sport, fixtureId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM ad_unlocks WHERE user_id = $1 AND sport = $2 AND fixture_id = $3',
    [userId, sport, String(fixtureId)]
  );
  return rows.length > 0;
}

async function recordUnlock(userId, sport, fixtureId) {
  await pool.query(
    `INSERT INTO ad_unlocks (user_id, sport, fixture_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, sport, fixture_id) DO NOTHING`,
    [userId, sport, String(fixtureId)]
  );
}

module.exports = { hasUnlocked, recordUnlock };
