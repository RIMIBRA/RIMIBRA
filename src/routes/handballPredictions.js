const { createSportRoutes } = require('./routeFactory');
const api = require('../api/handballClient');
const predictor = require('../algorithm/handballPredictor');

module.exports = createSportRoutes({ api, predictor });
