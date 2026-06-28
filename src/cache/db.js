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

// namespace vide = football (fichier d'origine, pour ne pas casser l'historique existant) ;
// chaque sport a son propre quota API (100/jour chacun), donc un fichier de log séparé
function logFileFor(namespace) {
  return namespace ? path.join(__dirname, `../../cache-requests-${namespace}.json`) : LOG_FILE;
}

function logRequest(endpoint, namespace = '') {
  const file = logFileFor(namespace);
  const log = readJson(file, []);
  log.push({ endpoint, created_at: Date.now() });
  writeJson(file, log);
}

function getDailyRequestCount(namespace = '') {
  const log = readJson(logFileFor(namespace), []);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return log.filter((entry) => entry.created_at >= startOfDay.getTime()).length;
}

module.exports = { get, set, logRequest, getDailyRequestCount };
