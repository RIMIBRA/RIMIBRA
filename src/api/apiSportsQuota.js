require('dotenv').config();

// Football, NFL, NBA, Hockey, Baseball et Handball partagent TOUS le même compte et la même
// clé api-sports.io (API_FOOTBALL_KEY, voir .env.example) — un seul quota quotidien pour
// l'ensemble de ces sports, pas un par sport. Chaque client suivait jusqu'ici son propre
// compteur local (football à 7500/jour hérité de l'ancien plan Pro, les autres à 100/jour
// chacun) : cumulés, ça dépassait largement le vrai quota du compte et l'a fait suspendre par
// le fournisseur. Tennis n'est pas concerné (api-tennis.com, clé et quota séparés).
const QUOTA_NAMESPACE = 'apisports';
const DAILY_LIMIT = process.env.API_SPORTS_DAILY_LIMIT
  ? parseInt(process.env.API_SPORTS_DAILY_LIMIT, 10)
  : 100; // plan gratuit actuel — remonter (ou fixer via la variable d'env) si un abonnement payant est réactivé

module.exports = { QUOTA_NAMESPACE, DAILY_LIMIT };
