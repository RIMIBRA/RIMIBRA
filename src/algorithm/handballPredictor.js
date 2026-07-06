const { createTeamSportPredictor } = require('./teamSportPredictorFactory');
const api = require('../api/handballClient');

// Identifiants vérifiés directement via l'API — Bundesliga (Allemagne), Liga ASOBAL (Espagne)
const PRIORITY_LEAGUE_IDS = new Set([39, 103]);

module.exports = createTeamSportPredictor({
  api,
  sport: 'handball',
  leagueLabel: 'Handball',
  homeAdvantage: 4,
  allowDraw: true, // le nul existe en handball comme au foot
  upcomingStatuses: ['NS', 'HT', '1H', '2H'],
  maxPerDay: 40,
  isPriorityLeague: (g) => PRIORITY_LEAGUE_IDS.has(g.league.id),
});
