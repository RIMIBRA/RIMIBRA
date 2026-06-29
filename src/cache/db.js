const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '../../cache-data.json');
const LOG_FILE = path.join(__dirname, '../../cache-requests.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

// Chargé une seule fois en mémoire au démarrage, puis toutes les lectures/écritures passent
// par cet objet — élimine la course lecture-modification-écriture du fichier JSON qui faisait
// perdre des entrées quand plusieurs requêtes concurrentes (forme, H2H, analyse complète du
// jour...) écrivaient cache-data.json en même temps (chacune écrasant le travail de l'autre).
const store = readJson(CACHE_FILE, {});
let writeScheduled = false;

function schedulePersist() {
  if (writeScheduled) return;
  writeScheduled = true;
  setImmediate(() => {
    writeScheduled = false;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(store), 'utf8');
  });
}

function get(key) {
  const entry = store[key];
  if (!entry) return null;
  if (Date.now() > entry.expires_at) {
    delete store[key];
    schedulePersist();
    return null;
  }
  return entry.data;
}

function set(key, data, ttlSeconds) {
  store[key] = { data, expires_at: Date.now() + ttlSeconds * 1000 };
  schedulePersist();
}

// namespace vide = football (fichier d'origine, pour ne pas casser l'historique existant) ;
// chaque sport a son propre quota API (100/jour chacun), donc un journal séparé
function logFileFor(namespace) {
  return namespace ? path.join(__dirname, `../../cache-requests-${namespace}.json`) : LOG_FILE;
}

const logStores = {}; // namespace -> tableau en mémoire, même principe que le cache ci-dessus
const logWriteScheduled = {};

function getLogStore(namespace) {
  const key = namespace || '';
  if (!(key in logStores)) logStores[key] = readJson(logFileFor(namespace), []);
  return logStores[key];
}

function scheduleLogPersist(namespace) {
  const key = namespace || '';
  if (logWriteScheduled[key]) return;
  logWriteScheduled[key] = true;
  setImmediate(() => {
    logWriteScheduled[key] = false;
    fs.writeFileSync(logFileFor(namespace), JSON.stringify(getLogStore(namespace)), 'utf8');
  });
}

function logRequest(endpoint, namespace = '') {
  getLogStore(namespace).push({ endpoint, created_at: Date.now() });
  scheduleLogPersist(namespace);
}

function getDailyRequestCount(namespace = '') {
  const log = getLogStore(namespace);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return log.filter((entry) => entry.created_at >= startOfDay.getTime()).length;
}

module.exports = { get, set, logRequest, getDailyRequestCount };
