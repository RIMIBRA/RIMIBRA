// Règles d'accès par plan d'abonnement.
// 'free'    : foot uniquement, vue très limitée (probabilités + recommandation seulement).
// 'premium' : foot + tous les sports d'équipe, ET prédiction de buts (goalPrediction) incluse.
// 'vip'     : tout premium + détail complet (breakdown + probabilités du marché) + recherche
//             + combinés illimités.
// Les deux niveaux verrouillés (goalPrediction, fullBreakdown) ne se débloquent que par
// abonnement — voir auth/breakdownGate.js. (Le déblocage par pub récompensée a été retiré :
// sans compte Google Ad Manager branché, rien ne vérifiait côté serveur qu'une pub avait
// vraiment été vue, ce qui permettait de débloquer le contenu premium/VIP gratuitement.)
const TIER_RANK = { free: 0, premium: 1, vip: 2 };

const SPORT_MIN_TIER = {
  football: 'free',
  nfl: 'premium',
  nba: 'premium',
  hockey: 'premium',
  baseball: 'premium',
  handball: 'premium',
  tennis: 'premium',
};

const FEATURE_MIN_TIER = {
  search: 'premium',
  goalPrediction: 'premium',
  fullBreakdown: 'vip',
};

function hasAccess(userPlan, requiredTier) {
  return TIER_RANK[userPlan] >= TIER_RANK[requiredTier];
}

function canAccessSport(userPlan, sport) {
  const required = SPORT_MIN_TIER[sport] ?? 'premium';
  return hasAccess(userPlan, required);
}

function canUseFeature(userPlan, feature) {
  const required = FEATURE_MIN_TIER[feature] ?? 'free';
  return hasAccess(userPlan, required);
}

// Free : pas de combinés (fonctionnalité premium) ; Premium : 3 max ; VIP : illimité
const COMBO_LIMIT_BY_PLAN = { free: 0, premium: 3, vip: Infinity };

function comboLimitFor(userPlan, isAdmin) {
  if (isAdmin) return Infinity;
  return COMBO_LIMIT_BY_PLAN[userPlan] ?? 0;
}

// Le plan gratuit ne voit qu'un nombre limité de matchs à venir/en cours (les mieux notés,
// l'ordre de tri par confiance est déjà fait en amont) — simple à comprendre, contrairement à
// une sélection par nom d'équipe qui pouvait laisser voir 0 ou 20 matchs selon les jours.
const FREE_PREVIEW_LIMIT = 5;

module.exports = {
  TIER_RANK,
  SPORT_MIN_TIER,
  FEATURE_MIN_TIER,
  hasAccess,
  canAccessSport,
  canUseFeature,
  FREE_PREVIEW_LIMIT,
  comboLimitFor,
};
