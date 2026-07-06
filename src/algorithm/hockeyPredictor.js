const { createTeamSportPredictor } = require('./teamSportPredictorFactory');
const api = require('../api/hockeyClient');

// Identifiants vérifiés directement via l'API (api-sports.io) — NHL, KHL, SHL
const PRIORITY_LEAGUE_IDS = new Set([57, 35, 47]);

module.exports = createTeamSportPredictor({
  api,
  sport: 'hockey',
  leagueLabel: 'Hockey',
  homeAdvantage: 5,
  allowDraw: false, // prolongation/tirs au but en NHL, pas de match nul
  upcomingStatuses: ['NS', 'P1', 'P2', 'P3', 'OT', 'SO'],
  maxPerDay: 40,
  isPriorityLeague: (g) => PRIORITY_LEAGUE_IDS.has(g.league.id),
});
