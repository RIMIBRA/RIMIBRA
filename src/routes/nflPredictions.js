const express = require('express');
const router = express.Router();
const { analyzeDayGames, searchGames, analyzeGame } = require('../algorithm/nflPredictor');
const api = require('../api/nflClient');
const { requireAdmin } = require('../auth/middleware');
const { applyBreakdownGate } = require('../auth/breakdownGate');
const { sendServerError } = require('../utils/httpErrors');

router.get('/today', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const { results, total, analyzed } = await analyzeDayGames(date);
    const used = api.getDailyRequestCount();
    const limitReached = used >= api.DAILY_LIMIT;
    res.json({ date, predictions: results, total, analyzed, requestsUsed: used, requestsLeft: Math.max(0, api.DAILY_LIMIT - used), limitReached });
  } catch (err) {
    sendServerError(res, err);
  }
});

router.get('/search', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Paramètre "q" requis' });

    const { results, total } = await searchGames(date, q);
    const used = api.getDailyRequestCount();
    res.json({ date, query: q, predictions: results, total, requestsUsed: used, requestsLeft: Math.max(0, api.DAILY_LIMIT - used) });
  } catch (err) {
    sendServerError(res, err);
  }
});

router.get('/status', (req, res) => {
  const used = api.getDailyRequestCount();
  res.json({ used, remaining: api.DAILY_LIMIT - used, limit: api.DAILY_LIMIT });
});

router.get('/game/:id', async (req, res) => {
  try {
    const game = await api.getGameById(req.params.id);
    if (!game) return res.status(404).json({ error: 'Match introuvable' });
    const analysis = await analyzeGame(game);
    res.json(await applyBreakdownGate(analysis, req, 'nfl'));
  } catch (err) {
    sendServerError(res, err);
  }
});

// Debug : voir la forme brute renvoyée par /games pour vérifier le mapping (scores, league, etc.)
router.get('/debug', requireAdmin, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const raw = await api.getRawGames(date);
    res.json({ date, count: Array.isArray(raw) ? raw.length : raw, first3: Array.isArray(raw) ? raw.slice(0, 3) : raw });
  } catch (err) {
    res.json({ error: err.message });
  }
});

module.exports = router;
