require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Sans ce listener, une erreur sur un client "idle" (connexion coupée par la DB, blip réseau,
// redémarrage Postgres...) remonte comme exception non gérée et tue tout le process Node —
// exactement le genre d'incident qui finit forcément par arriver sur plusieurs semaines
// d'exécution continue, sans qu'aucune requête ne soit pourtant en cause.
pool.on('error', (err) => {
  console.error('Erreur inattendue sur un client Postgres inactif (ignorée) :', err.message);
});

module.exports = pool;
