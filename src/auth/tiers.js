// Règles d'accès par plan d'abonnement.
// 'free'    : foot uniquement, vue limitée (pas de détail/cotes/breakdown complet)
// 'premium' : foot + tous les sports d'équipe (NFL, Basketball, Hockey, Baseball, Handball)
// 'vip'     : tout premium + détails complets (breakdown, cotes, recherche)
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

// Le plan gratuit ne voit que les matchs impliquant cette sélection d'équipes — à ajuster
// librement (popularité, marché visé...), ce n'est qu'un point de départ.
const FREE_PREVIEW_TEAMS = [
  'real madrid', 'barcelona', 'manchester united', 'manchester city',
  'liverpool', 'paris saint germain', 'bayern munich', 'juventus',
  'chelsea', 'arsenal',
];

function normalizeTeamName(name) {
  return (name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function isFreePreviewMatch(homeName, awayName) {
  const home = normalizeTeamName(homeName);
  const away = normalizeTeamName(awayName);
  return FREE_PREVIEW_TEAMS.some((t) => home.includes(t) || away.includes(t));
}

module.exports = {
  TIER_RANK,
  SPORT_MIN_TIER,
  FEATURE_MIN_TIER,
  hasAccess,
  canAccessSport,
  canUseFeature,
  FREE_PREVIEW_TEAMS,
  isFreePreviewMatch,
  comboLimitFor,
};
