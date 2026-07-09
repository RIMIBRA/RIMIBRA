// Compte de vues de page minimal et respectueux de la vie privée : pas de cookie, pas de
// service tiers, une seule requête par chargement (voir src/db/analytics.js côté serveur).
// keepalive garantit l'envoi même si le visiteur quitte la page juste après.
fetch('/api/analytics/pageview', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ path: location.pathname }),
  keepalive: true,
}).catch(() => {});

// Clic sur un bouton partenaire (voir public/partenaires.html) — ne bloque jamais l'ouverture
// du lien d'affiliation, juste un signal fire-and-forget avant que le nouvel onglet ne s'ouvre.
document.querySelectorAll('.partner-cta[data-partner]').forEach((link) => {
  link.addEventListener('click', () => {
    fetch('/api/analytics/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner: link.dataset.partner, path: location.pathname }),
      keepalive: true,
    }).catch(() => {});
  });
});
