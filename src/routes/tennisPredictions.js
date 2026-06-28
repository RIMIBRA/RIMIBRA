const { createSportRoutes } = require('./routeFactory');
const api = require('../api/tennisClient');
const predictor = require('../algorithm/tennisPredictor');

module.exports = createSportRoutes({ api, predictor });
