const pool = require('./pool');

async function createNotification(userId, { title, body, url }) {
  await pool.query(
    'INSERT INTO notifications (user_id, title, body, url) VALUES ($1, $2, $3, $4)',
    [userId, title, body || null, url || null]
  );
}

async function listForUser(userId, limit = 30) {
  const { rows } = await pool.query(
    'SELECT id, title, body, url, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit]
  );
  return rows;
}

async function unreadCount(userId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL',
    [userId]
  );
  return rows[0].count;
}

async function markRead(userId, id) {
  await pool.query(
    'UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL',
    [id, userId]
  );
}

async function markAllRead(userId) {
  await pool.query(
    'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
    [userId]
  );
}

module.exports = { createNotification, listForUser, unreadCount, markRead, markAllRead };
