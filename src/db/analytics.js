const crypto = require('crypto');
const pool = require('./pool');

// IP + user-agent + jour + secret serveur -> jamais l'IP en clair stockée, mais un même
// visiteur produit le même hash sur une même journée, ce qui permet d'approximer les
// visiteurs uniques (compte de hashs distincts) sans cookie ni service tiers.
function visitorHash(ip, userAgent) {
  const day = new Date().toISOString().split('T')[0];
  return crypto.createHash('sha256').update(`${ip}|${userAgent}|${day}|${process.env.JWT_SECRET}`).digest('hex');
}

async function recordPageView(path, ip, userAgent) {
  await pool.query(
    'INSERT INTO page_views (path, visitor_hash) VALUES ($1, $2)',
    [String(path).slice(0, 200), visitorHash(ip || '', userAgent || '')]
  );
}

async function recordClick(partner, path, ip, userAgent) {
  await pool.query(
    'INSERT INTO partner_clicks (partner, path, visitor_hash) VALUES ($1, $2, $3)',
    [String(partner).slice(0, 50), String(path || '').slice(0, 200), visitorHash(ip || '', userAgent || '')]
  );
}

async function getClickStats(days) {
  const { rows } = await pool.query(
    `SELECT partner, count(*)::int AS clicks
     FROM partner_clicks
     WHERE created_at >= now() - ($1 || ' days')::interval
     GROUP BY partner ORDER BY clicks DESC`,
    [days]
  );
  return rows;
}

async function getStats(days) {
  const { rows: daily } = await pool.query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
            count(*)::int AS pageviews,
            count(DISTINCT visitor_hash)::int AS visitors
     FROM page_views
     WHERE created_at >= now() - ($1 || ' days')::interval
     GROUP BY 1 ORDER BY 1`,
    [days]
  );
  const { rows: topPages } = await pool.query(
    `SELECT path, count(*)::int AS pageviews
     FROM page_views
     WHERE created_at >= now() - ($1 || ' days')::interval
     GROUP BY path ORDER BY pageviews DESC LIMIT 10`,
    [days]
  );
  return { daily, topPages };
}

module.exports = { recordPageView, getStats, recordClick, getClickStats };
