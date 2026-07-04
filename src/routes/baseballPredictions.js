const { createSportRoutes } = require('./routeFactory');
const api = require('../api/baseballClient');
const predictor = require('../algorithm/baseballPredictor');

module.exports = createSportRoutes({ api, predictor, sport: 'baseball' });
