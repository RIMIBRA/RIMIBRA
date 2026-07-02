const { createTeamSportPredictor } = require('./teamSportPredictorFactory');
const api = require('../api/baseballClient');

// Identifiants vérifiés directement via l'API — MLB, NPB (Japon), KBO (Corée du Sud)
const PRIORITY_LEAGUE_IDS = new Set([1, 2, 5]);

module.exports = createTeamSportPredictor({
  api,
  sport: 'baseball',
  leagueLabel: 'Baseball',
  homeAdvantage: 4,
  allowDraw: false, // toujours décidé, prolongations si besoin
  upcomingStatuses: ['NS', 'IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7', 'IN8', 'IN9'],
  maxPerDay: 40,
  staleHours: 6, // matchs MLB parfois très longs (manches supplémentaires)
  isPriorityLeague: (g) => PRIORITY_LEAGUE_IDS.has(g.league.id),
});
