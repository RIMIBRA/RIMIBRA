const express = require('express');
const { requireAdmin } = require('../auth/middleware');
const { applyBreakdownGate } = require('../auth/breakdownGate');

function createSportRoutes({ api, predictor, sport }) {
  const router = express.Router();

  router.get('/today', async (req, res) => {
    try {
      const date = req.query.date || new Date().toISOString().split('T')[0];
      const { results, total, analyzed } = await predictor.analyzeDayGames(date);
      const used = api.getDailyRequestCount();
      const limitReached = used >= api.DAILY_LIMIT;
      res.json({ date, predictions: results, total, analyzed, requestsUsed: used, requestsLeft: Math.max(0, api.DAILY_LIMIT - used), limitReached });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/search', async (req, res) => {
    try {
      const date = req.query.date || new Date().toISOString().split('T')[0];
      const q = (req.query.q || '').trim();
      if (!q) return res.status(400).json({ error: 'Paramètre "q" requis' });

      const { results, total } = await predictor.searchGames(date, q);
      const used = api.getDailyRequestCount();
      res.json({ date, query: q, predictions: results, total, requestsUsed: used, requestsLeft: Math.max(0, api.DAILY_LIMIT - used) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/status', (req, res) => {
    const used = api.getDailyRequestCount();
    res.json({ used, remaining: api.DAILY_LIMIT - used, limit: api.DAILY_LIMIT });
  });

  // Analyse à la demande d'un match précis (ex: valider une prédiction sur un match terminé)
  router.get('/game/:id', async (req, res) => {
    try {
      const game = await api.getGameById(req.params.id);
      if (!game) return res.status(404).json({ error: 'Match introuvable' });
      const analysis = await predictor.analyzeGame(game);
      res.json(await applyBreakdownGate(analysis, req, sport));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Réservé aux admins (consomme du quota)
  router.get('/debug', requireAdmin, async (req, res) => {
    try {
      const date = req.query.date || new Date().toISOString().split('T')[0];
      const raw = await api.getRawGames(date);
      res.json({ date, count: Array.isArray(raw) ? raw.length : raw, first3: Array.isArray(raw) ? raw.slice(0, 3) : raw });
    } catch (err) {
      res.json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createSportRoutes };
