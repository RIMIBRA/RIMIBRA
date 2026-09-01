require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { pgPoolConfig } = require('./ssl');

async function migrate() {
  const pool = new Pool(pgPoolConfig(process.env.DATABASE_URL));
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('Migration appliquée avec succès.');
  } finally {
    await pool.end();
  }
}

// Appelé directement (npm run migrate) : exécute et quitte avec le bon code de sortie.
// Importé depuis server.js : ce bloc ne s'exécute pas (require.main !== module), seule la
// fonction migrate() est utilisée, sans jamais appeler process.exit depuis le process serveur.
if (require.main === module) {
  migrate().catch((err) => {
    // err.message est parfois vide selon le type d'erreur réseau/pg — logguer l'objet complet
    // pour ne pas se retrouver sans aucune piste dans les logs de déploiement.
    console.error('Erreur de migration:', err);
    process.exit(1);
  });
}

module.exports = { migrate };
