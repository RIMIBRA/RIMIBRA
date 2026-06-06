const express = require('express');
const router = express.Router();
const { analyzeDayFixtures, analyzeFixture } = require('../algorithm/predictor');
const api = require('../api/client');

router.get('/today', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const { results, total, analyzed } = await analyzeDayFixtures(date);
    const used = api.getDailyRequestCount();
    const limitReached = used >= api.DAILY_LIMIT;
    res.json({ date, predictions: results, total, analyzed, requestsUsed: used, requestsLeft: Math.max(0, api.DAILY_LIMIT - used), limitReached });
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

// Debug : tester chaque scraper individuellement
router.get('/debug', async (req, res) => {
  const footballpred = require('../scraper/footballpred');
  const forebetScraper = require('../scraper/forebet');
  const besoccer = require('../scraper/besoccer');
  const { get1xbetOdds } = require('../scraper/odds');
  const date = new Date().toISOString().split('T')[0];
  const home = req.query.home || 'Arsenal';
  const away = req.query.away || 'Chelsea';

  const [fpred, fb, bsc, odds] = await Promise.allSettled([
    footballpred.getTodayPredictions(date),
    forebetScraper.getTodayPredictions(date),
    besoccer.getMatchData(home, away),
    get1xbetOdds(home, away),
  ]).then((r) => r.map((x) => (x.status === 'fulfilled' ? x.value : { error: x.reason?.message })));

  res.json({
    date,
    query: { home, away },
    footballpred: { count: fpred?.length ?? 0, first3: fpred?.slice(0, 3) ?? fpred },
    forebet:      { count: fb?.length   ?? 0, first3: fb?.slice(0, 3)    ?? fb   },
    besoccer: bsc,
    '1xbet': odds,
  });
});

module.exports = router;
