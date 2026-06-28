require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function migrate() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('Migration appliquée avec succès.');
  } finally {
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Erreur de migration:', err.message);
  process.exit(1);
});
