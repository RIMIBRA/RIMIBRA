require('dotenv').config();
const { Pool } = require('pg');

// Les connexions locales (dev) n'ont pas de certificat SSL configuré ; les hébergeurs comme
// Render l'exigent en revanche pour toute connexion venant de l'extérieur de leur réseau
// (sinon: ECONNRESET). rejectUnauthorized: false car ces hébergeurs utilisent des certificats
// auto-signés en interne — la connexion reste chiffrée, seule la chaîne de confiance du
// certificat n'est pas vérifiée.
const isLocalDb = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
});

// Sans ce listener, une erreur sur un client "idle" (connexion coupée par la DB, blip réseau,
// redémarrage Postgres...) remonte comme exception non gérée et tue tout le process Node —
// exactement le genre d'incident qui finit forcément par arriver sur plusieurs semaines
// d'exécution continue, sans qu'aucune requête ne soit pourtant en cause.
pool.on('error', (err) => {
  console.error('Erreur inattendue sur un client Postgres inactif (ignorée) :', err.message);
});

module.exports = pool;
