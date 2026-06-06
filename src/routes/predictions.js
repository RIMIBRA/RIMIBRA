const express = require('express');
const router = express.Router();
const { analyzeDayFixtures, analyzeFixture } = require('../algorithm/predictor');
const api = require('../api/client');

router.get('/today', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const predictions = await analyzeDayFixtures(date);
    const used = api.getDailyRequestCount();
    res.json({ date, predictions, requestsUsed: used, requestsLeft: api.DAILY_LIMIT - used });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/fixture/:id', async (req, res) => {
  try {
    const fixture = await api.getFixtureById(req.params.id);
    if (!fixture) return res.status(404).json({ error: 'Match introuvable' });
    const analysis = await analyzeFixture(fixture);
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/status', (req, res) => {
  const used = api.getDailyRequestCount();
  res.json({ used, remaining: api.DAILY_LIMIT - used, limit: api.DAILY_LIMIT });
});

module.exports = router;
