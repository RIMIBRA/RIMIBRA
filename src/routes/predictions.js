const express = require('express');
const router = express.Router();
const { analyzeDayFixtures, analyzeFixture, searchFixtures } = require('../algorithm/predictor');
const api = require('../api/client');
const { requireFeature, requireAdmin } = require('../auth/middleware');
const { isFreePreviewMatch } = require('../auth/tiers');

router.get('/today', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const { results, total, analyzed } = await analyzeDayFixtures(date);
    const used = api.getDailyRequestCount();
    const limitReached = used >= api.DAILY_LIMIT;

    const plan = req.user?.plan || 'free';
    const isFreeTier = plan === 'free' && !req.user?.isAdmin;
    // Plan gratuit : aperçu limité à une sélection d'équipes populaires, pour donner envie de passer premium
    // (les admins voient tout, sans filtre, même si leur plan en base est "free")
    const visibleResults = isFreeTier
      ? results.filter((r) => r.finished || isFreePreviewMatch(r.fixture.home, r.fixture.away))
      : results;

    res.json({
      date,
      predictions: visibleResults,
      total,
      analyzed,
      requestsUsed: used,
      requestsLeft: Math.max(0, api.DAILY_LIMIT - used),
      limitReached,
      freePreview: isFreeTier,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recherche d'une équipe à une date donnée : analyse à la demande, même hors sélection auto
// Réservée aux abonnés premium et plus
router.get('/search', requireFeature('search'), async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Paramètre "q" requis' });

    const { results, total } = await searchFixtures(date, q);
    const used = api.getDailyRequestCount();
    res.json({ date, query: q, predictions: results, total, requestsUsed: used, requestsLeft: Math.max(0, api.DAILY_LIMIT - used) });
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

// Debug : tester chaque scraper individuellement — réservé aux admins (consomme du quota/Puppeteer)
router.get('/debug', requireAdmin, async (req, res) => {
  const footballpred = require('../scraper/footballpred');
  const forebetScraper = require('../scraper/forebet');
  const predictzScraper = require('../scraper/predictz');
  const besoccer = require('../scraper/besoccer');
  const oddsapiScraper = require('../scraper/oddsapi');
  const date = new Date().toISOString().split('T')[0];
  const home = req.query.home || 'Arsenal';
  const away = req.query.away || 'Chelsea';

  const [fpred, fb, ptz, bsc, oddsAll] = await Promise.allSettled([
    footballpred.getTodayPredictions(date),
    forebetScraper.getTodayPredictions(date),
    predictzScraper.getTodayPredictions(date),
    besoccer.getMatchData(home, away),
    oddsapiScraper.getTodayOdds(),
  ]).then((r) => r.map((x) => (x.status === 'fulfilled' ? x.value : { error: x.reason?.message })));

  const oddsMatch = Array.isArray(oddsAll) ? oddsapiScraper.findMatch(oddsAll, home, away) : null;

  res.json({
    date,
    query: { home, away },
    footballpred: { count: fpred?.length ?? 0, first3: fpred?.slice(0, 3) ?? fpred },
    forebet:      { count: fb?.length   ?? 0, first3: fb?.slice(0, 3)    ?? fb   },
    predictz:     { count: ptz?.length  ?? 0, first3: ptz?.slice(0, 3)   ?? ptz  },
    besoccer: bsc,
    oddsapi: {
      totalToday: Array.isArray(oddsAll) ? oddsAll.length : oddsAll,
      matchFound: oddsMatch,
      keyConfigured: !!process.env.THE_ODDS_API_KEY,
    },
  });
});

// Debug HTML brut : voir ce que le scraper reçoit réellement
router.get('/debug-html', requireAdmin, async (req, res) => {
  const axios = require('axios');
  const sites = {
    forebet:  'https://www.forebet.com/en/football-tips-and-predictions-for-today/',
    predictz: 'https://www.predictz.com/predictions/today/',
    fpred:    'https://www.footballpredictions.com/predictions',
    besoccer: 'https://www.besoccer.com/search?q=Arsenal+Chelsea&section=match',
  };
  const site = req.query.site || 'predictz';
  const url = sites[site];
  if (!url) return res.json({ error: 'site inconnu', sites: Object.keys(sites) });

  try {
    const { data, status } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
      },
      timeout: 12000,
    });
    // Retourner les 3000 premiers caractères du HTML
    res.json({ site, url, status, htmlLength: data.length, preview: data.substring(0, 3000) });
  } catch (err) {
    res.json({ site, url, error: err.message, code: err.code });
  }
});

module.exports = router;
