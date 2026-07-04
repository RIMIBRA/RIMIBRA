const { createSportRoutes } = require('./routeFactory');
const api = require('../api/hockeyClient');
const predictor = require('../algorithm/hockeyPredictor');

module.exports = createSportRoutes({ api, predictor, sport: 'hockey' });
