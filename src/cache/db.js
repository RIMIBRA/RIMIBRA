const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '../../cache-data.json');
const LOG_FILE = path.join(__dirname, '../../cache-requests.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data), 'utf8');
}

function get(key) {
  const store = readJson(CACHE_FILE, {});
  const entry = store[key];
  if (!entry) return null;
  if (Date.now() > entry.expires_at) {
    delete store[key];
    writeJson(CACHE_FILE, store);
    return null;
  }
  return entry.data;
}

function set(key, data, ttlSeconds) {
  const store = readJson(CACHE_FILE, {});
  store[key] = { data, expires_at: Date.now() + ttlSeconds * 1000 };
  writeJson(CACHE_FILE, store);
}

function logRequest(endpoint) {
  const log = readJson(LOG_FILE, []);
  log.push({ endpoint, created_at: Date.now() });
  writeJson(LOG_FILE, log);
}

function getDailyRequestCount() {
  const log = readJson(LOG_FILE, []);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return log.filter((entry) => entry.created_at >= startOfDay.getTime()).length;
}

module.exports = { get, set, logRequest, getDailyRequestCount };
