// Compte de vues de page minimal et respectueux de la vie privée : pas de cookie, pas de
// service tiers, une seule requête par chargement (voir src/db/analytics.js côté serveur).
// keepalive garantit l'envoi même si le visiteur quitte la page juste après.
fetch('/api/analytics/pageview', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ path: location.pathname }),
  keepalive: true,
}).catch(() => {});
