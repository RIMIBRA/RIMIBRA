const pool = require('./pool');

const LEVELS = ['premium_details', 'vip_details'];

// Nombre de pubs à regarder pour débloquer CE niveau, selon le plan actuel de l'utilisateur.
// null = pas de déblocage par pub possible pour ce plan/niveau (déjà inclus dans le plan, ou
// aucune offre de déblocage prévue — voir auth/tiers.js pour les seuils de plan par niveau).
const VIEWS_REQUIRED = {
  free: { premium_details: 3, vip_details: 5 },
  premium: { vip_details: 1 }, // premium_details déjà inclus au plan premium, jamais interrogé
};

function requiredViewsFor(plan, level) {
  return VIEWS_REQUIRED[plan]?.[level] ?? null;
}

async function getProgress(userId, sport, fixtureId, level) {
  const { rows } = await pool.query(
    'SELECT views_count, unlocked_at FROM ad_unlocks WHERE user_id = $1 AND sport = $2 AND fixture_id = $3 AND level = $4',
    [userId, sport, String(fixtureId), level]
  );
  return rows[0] || { views_count: 0, unlocked_at: null };
}

// Débloquer le niveau englobant ('vip_details') débloque aussi le niveau inclus dedans
// ('premium_details') — inutile de faire revisionner des pubs pour un niveau déjà couvert
// par un déblocage plus large.
async function isUnlocked(userId, sport, fixtureId, level) {
  if (level === 'premium_details') {
    const vip = await getProgress(userId, sport, fixtureId, 'vip_details');
    if (vip.unlocked_at) return true;
  }
  const progress = await getProgress(userId, sport, fixtureId, level);
  return !!progress.unlocked_at;
}

// Enregistre une vue de pub pour ce niveau ; marque débloqué si le seuil requis est atteint.
// requiredViews doit venir de requiredViewsFor(plan, level) — pas recalculé ici, pour ne pas
// dupliquer la logique de seuil par plan dans la requête SQL.
async function recordView(userId, sport, fixtureId, level, requiredViews) {
  const { rows } = await pool.query(
    `INSERT INTO ad_unlocks (user_id, sport, fixture_id, level, views_count, unlocked_at)
     VALUES ($1, $2, $3, $4, 1, CASE WHEN $5 <= 1 THEN now() ELSE NULL END)
     ON CONFLICT (user_id, sport, fixture_id, level) DO UPDATE SET
       views_count = ad_unlocks.views_count + 1,
       updated_at = now(),
       unlocked_at = CASE
         WHEN ad_unlocks.unlocked_at IS NOT NULL THEN ad_unlocks.unlocked_at
         WHEN ad_unlocks.views_count + 1 >= $5 THEN now()
         ELSE NULL
       END
     RETURNING views_count, unlocked_at`,
    [userId, sport, String(fixtureId), level, requiredViews]
  );
  return rows[0];
}

module.exports = { LEVELS, requiredViewsFor, getProgress, isUnlocked, recordView };
