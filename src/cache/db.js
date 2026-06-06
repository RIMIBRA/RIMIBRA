const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../cache.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS request_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        endpoint TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }
  return db;
}

function get(key) {
  const db = getDb();
  const row = db.prepare('SELECT data, expires_at FROM cache WHERE key = ?').get(key);
  if (!row) return null;
  if (Date.now() > row.expires_at) {
    db.prepare('DELETE FROM cache WHERE key = ?').run(key);
    return null;
  }
  return JSON.parse(row.data);
}

function set(key, data, ttlSeconds) {
  const db = getDb();
  db.prepare(
    'INSERT OR REPLACE INTO cache (key, data, expires_at) VALUES (?, ?, ?)'
  ).run(key, JSON.stringify(data), Date.now() + ttlSeconds * 1000);
}

function logRequest(endpoint) {
  const db = getDb();
  db.prepare('INSERT INTO request_log (endpoint, created_at) VALUES (?, ?)').run(
    endpoint,
    Date.now()
  );
}

function getDailyRequestCount() {
  const db = getDb();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const row = db.prepare(
    'SELECT COUNT(*) as count FROM request_log WHERE created_at >= ?'
  ).get(startOfDay.getTime());
  return row.count;
}

module.exports = { get, set, logRequest, getDailyRequestCount };
