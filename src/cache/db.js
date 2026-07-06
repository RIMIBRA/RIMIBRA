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

// Retire les entrées expirées avant chaque écriture pour empêcher le fichier de grossir
// indéfiniment (sans ça, des entrées jamais relues après expiration restent sur disque pour
// toujours -> a fini par dépasser la limite de taille de chaîne de V8 et planter le serveur).
function sweepExpired() {
  const now = Date.now();
  for (const key in store) {
    if (now > store[key].expires_at) delete store[key];
  }
}

function schedulePersist() {
  if (writeScheduled) return;
  writeScheduled = true;
  setImmediate(() => {
    writeScheduled = false;
    try {
      sweepExpired();
      fs.writeFileSync(CACHE_FILE, JSON.stringify(store), 'utf8');
    } catch (err) {
      // Une erreur ici se produit hors du cycle requête/réponse -> si on ne l'attrape pas,
      // elle remonte comme exception non gérée et tue tout le process Node.
      console.error('Échec de persistance du cache (ignoré pour ne pas faire planter le serveur):', err.message);
    }
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
    try {
      fs.writeFileSync(logFileFor(namespace), JSON.stringify(getLogStore(namespace)), 'utf8');
    } catch (err) {
      console.error('Échec de persistance du log de requêtes (ignoré pour ne pas faire planter le serveur):', err.message);
    }
  });
}

// Ne sert qu'à compter les requêtes du jour -> tout ce qui a plus de 48h (marge pour les
// décalages de fuseau horaire) est mort et n'a aucune raison de rester sur disque.
// Sans ça, ces fichiers grossissent pour toujours (le foot en avait 4400+ entrées après un mois).
const LOG_RETENTION_MS = 48 * 3600 * 1000;

function pruneLogStore(namespace) {
  const key = namespace || '';
  const cutoff = Date.now() - LOG_RETENTION_MS;
  logStores[key] = getLogStore(namespace).filter((entry) => entry.created_at >= cutoff);
  return logStores[key];
}

function logRequest(endpoint, namespace = '') {
  const log = pruneLogStore(namespace);
  log.push({ endpoint, created_at: Date.now() });
  scheduleLogPersist(namespace);
}

function getDailyRequestCount(namespace = '') {
  const log = getLogStore(namespace);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return log.filter((entry) => entry.created_at >= startOfDay.getTime()).length;
}

// Avertit une seule fois par jour/namespace quand le quota est atteint (au lieu de renvoyer
// [] en silence) -> visible dans les logs serveur pour savoir qu'il faut upgrader le plan
// ou attendre le reset, plutôt que de se demander pourquoi les prédictions sont incomplètes.
const quotaWarned = {};

function warnOnceIfQuotaReached(namespace, used, limit) {
  const key = namespace || 'football';
  const today = new Date().toDateString();
  if (used < limit || quotaWarned[key] === today) return;
  quotaWarned[key] = today;
  console.warn(`[quota] ${key}: limite quotidienne atteinte (${used}/${limit}) — réponses vides jusqu'au reset.`);
}

module.exports = { get, set, logRequest, getDailyRequestCount, warnOnceIfQuotaReached };
