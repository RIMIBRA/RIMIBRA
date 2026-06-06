require('dotenv').config();
const axios = require('axios');
const cache = require('../cache/db');

const BASE_URL = 'https://v3.football.api-sports.io';
const DAILY_LIMIT = 100;

const TTL = {
  fixtures: 6 * 3600,
  standings: 24 * 3600,
  h2h: 7 * 24 * 3600,
  form: 12 * 3600,
  injuries: 12 * 3600,
  leagues: 24 * 3600,
};

async function apiGet(endpoint, params = {}) {
  const used = cache.getDailyRequestCount();
  if (used >= DAILY_LIMIT) {
    throw new Error(`Limite quotidienne atteinte (${DAILY_LIMIT} requêtes/jour)`);
  }

  const cacheKey = endpoint + JSON.stringify(params);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const response = await axios.get(`${BASE_URL}${endpoint}`, {
    headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY },
    params,
  });

  cache.logRequest(endpoint);
  const data = response.data.response;
  const ttlKey = Object.keys(TTL).find((k) => endpoint.includes(k)) || 'fixtures';
  cache.set(cacheKey, data, TTL[ttlKey]);

  return data;
}

async function getFixturesByDate(date) {
  return apiGet('/fixtures', { date });
}

async function getTeamLastMatches(teamId, count = 5) {
  return apiGet('/fixtures', { team: teamId, last: count, status: 'FT' });
}

async function getH2H(team1Id, team2Id, last = 10) {
  return apiGet('/fixtures/headtohead', { h2h: `${team1Id}-${team2Id}`, last });
}

async function getStandings(leagueId, season) {
  return apiGet('/standings', { league: leagueId, season });
}

async function getInjuries(fixtureId) {
  return apiGet('/injuries', { fixture: fixtureId });
}

async function getActiveLeagues() {
  return apiGet('/leagues', { current: true });
}

async function getFixtureById(fixtureId) {
  const results = await apiGet('/fixtures', { id: fixtureId });
  return results[0] || null;
}

module.exports = {
  getFixturesByDate,
  getTeamLastMatches,
  getH2H,
  getStandings,
  getInjuries,
  getActiveLeagues,
  getFixtureById,
  getDailyRequestCount: cache.getDailyRequestCount,
  DAILY_LIMIT,
};
