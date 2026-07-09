const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../auth/middleware');
const { listUsersWithPlan } = require('../db/users');
const predictionResults = require('../db/predictionResults');
const calibration = require('../algorithm/calibration');
const analytics = require('../db/analytics');

const footballApi = require('../api/client');
const nflApi = require('../api/nflClient');
const nbaApi = require('../api/nbaClient');
const hockeyApi = require('../api/hockeyClient');
const baseballApi = require('../api/baseballClient');
const handballApi = require('../api/handballClient');

const SPORT_APIS = {
  football: footballApi,
  nfl: nflApi,
  nba: nbaApi,
  hockey: hockeyApi,
  baseball: baseballApi,
  handball: handballApi,
};

router.use(requireAdmin);

router.get('/stats', async (req, res) => {
  try {
    const users = await listUsersWithPlan();
    const byPlan = users.reduce((acc, u) => {
      acc[u.plan] = (acc[u.plan] || 0) + 1;
      return acc;
    }, {});

    const quotas = Object.fromEntries(
      Object.entries(SPORT_APIS).map(([sport, api]) => {
        const used = api.getDailyRequestCount();
        return [sport, { used, limit: api.DAILY_LIMIT, remaining: Math.max(0, api.DAILY_LIMIT - used) }];
      })
    );

    res.json({
      users: { total: users.length, byPlan },
      quotas,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Justesse des pronostics vs résultats réels — globale, par confiance et par source externe
// (footballpred/forebet/besoccer/oddsapi/flashscore/soccerway) — pour calibrer les poids de
// l'algo (calcWeights) et le blend avec les sources externes sur des données plutôt qu'à l'oeil.
router.get('/prediction-accuracy', async (req, res) => {
  try {
    const sport = req.query.sport || 'football';
    const sinceDays = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const stats = await predictionResults.getAccuracyStats(sport, sinceDays);
    res.json({
      ...stats,
      // Poids actuellement appliqués dans blendProbabilities pour ce sport — dérivés de ces
      // mêmes stats par algorithm/calibration.js (voir MIN_SAMPLES : reste aux valeurs par
      // défaut tant qu'une source n'a pas assez de pronostics résolus).
      activeWeights: calibration.getWeights(),
      minSamplesForCalibration: calibration.MIN_SAMPLES,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Liste les pronostics enregistrés (visiteurs + suivi arrière-plan) pour un jour donné —
// featured=false isole les matchs suivis uniquement par trackExtraFixturesForData, jamais
// montrés à un visiteur, pour vérifier ce que la tâche de fond ajoute réellement.
router.get('/tracked-predictions', async (req, res) => {
  try {
    const sport = req.query.sport || 'football';
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const featured = req.query.featured === undefined ? undefined : req.query.featured === 'true';
    const predictions = await predictionResults.listPredictions({ sport, date, featured });
    res.json({ sport, date, count: predictions.length, predictions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/analytics', async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
    const [stats, clicksByPartner] = await Promise.all([
      analytics.getStats(days),
      analytics.getClickStats(days),
    ]);
    res.json({ ...stats, clicksByPartner });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/users', async (req, res) => {
  try {
    const users = await listUsersWithPlan();
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
