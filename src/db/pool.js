require('dotenv').config();
const { Pool } = require('pg');

// SSL seulement pour les URLs Postgres EXTERNES de Render (ex: depuis un PC local, hostname
// en "xxx.render.com") — elles l'exigent, sinon ECONNRESET. Sur l'URL interne (utilisée par
// l'app une fois déployée SUR Render, hostname court sans domaine), la clé "ssl" ne doit même
// pas être présente dans la config : passer explicitement ssl:false s'est avéré faire
// bloquer indéfiniment toute requête (comportement différent de ne pas préciser ssl du tout,
// qui est ce que faisait le code avant ces changements et qui fonctionnait).
const needsSsl = /\.render\.com/.test(process.env.DATABASE_URL || '');
const poolConfig = { connectionString: process.env.DATABASE_URL };
if (needsSsl) poolConfig.ssl = { rejectUnauthorized: false };
const pool = new Pool(poolConfig);

// Sans ce listener, une erreur sur un client "idle" (connexion coupée par la DB, blip réseau,
// redémarrage Postgres...) remonte comme exception non gérée et tue tout le process Node —
// exactement le genre d'incident qui finit forcément par arriver sur plusieurs semaines
// d'exécution continue, sans qu'aucune requête ne soit pourtant en cause.
pool.on('error', (err) => {
  console.error('Erreur inattendue sur un client Postgres inactif (ignorée) :', err.message);
});

module.exports = pool;
