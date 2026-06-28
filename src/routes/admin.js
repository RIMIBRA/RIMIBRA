const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../auth/middleware');
const { listUsersWithPlan } = require('../db/users');

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

router.get('/users', async (req, res) => {
  try {
    const users = await listUsersWithPlan();
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
