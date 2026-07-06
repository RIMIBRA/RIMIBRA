const { createTeamSportPredictor } = require('./teamSportPredictorFactory');
const api = require('../api/tennisClient');

module.exports = createTeamSportPredictor({
  api,
  sport: 'tennis',
  leagueLabel: 'Tennis',
  homeAdvantage: 0, // pas d'avantage "domicile" entre deux joueurs
  allowDraw: false, // un match de tennis a toujours un vainqueur
  upcomingStatuses: ['NS', 'LIVE'],
  liveStatuses: ['LIVE'],
  // Plan Entreprise (200k appels/jour) : on peut analyser beaucoup plus de matchs qu'avec un quota gratuit
  maxPerDay: 100,
  staleHours: 4, // un match peut durer longtemps (best of 5), marge avant de le considérer terminé sans confirmation
  // Circuit principal (Atp/Wta) bien plus fiable que les tournois ITF mineurs
  isPriorityLeague: (g) => /\b(atp|wta)\b/i.test(g.league.type || ''),
});
