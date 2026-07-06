require('dotenv').config();
const { Pool } = require('pg');

// SSL seulement pour les URLs Postgres EXTERNES de Render (ex: depuis un PC local, hostname
// en "xxx.render.com") — elles l'exigent, sinon ECONNRESET. L'URL interne qu'utilise l'app une
// fois déployée SUR Render (hostname court, sans domaine) n'en a ni besoin ni le même support :
// forcer ssl dessus casse la connexion. rejectUnauthorized: false car ces hébergeurs utilisent
// des certificats auto-signés en interne — la connexion externe reste chiffrée, seule la
// chaîne de confiance du certificat n'est pas vérifiée.
const needsSsl = /\.render\.com/.test(process.env.DATABASE_URL || '');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
});

// Sans ce listener, une erreur sur un client "idle" (connexion coupée par la DB, blip réseau,
// redémarrage Postgres...) remonte comme exception non gérée et tue tout le process Node —
// exactement le genre d'incident qui finit forcément par arriver sur plusieurs semaines
// d'exécution continue, sans qu'aucune requête ne soit pourtant en cause.
pool.on('error', (err) => {
  console.error('Erreur inattendue sur un client Postgres inactif (ignorée) :', err.message);
});

module.exports = pool;
