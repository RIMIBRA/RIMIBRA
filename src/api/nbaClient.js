require('dotenv').config();
const axios = require('axios');
const cache = require('../cache/db');
const { QUOTA_NAMESPACE, DAILY_LIMIT } = require('./apiSportsQuota');

const BASE_URL = 'https://v1.basketball.api-sports.io';
// Toutes ligues de basket confondues (comme le foot) — pas seulement la NBA, qui est en intersaison
// une bonne partie de l'année. Garder l'id pour un filtre futur si besoin.
const NBA_LEAGUE_ID = 12;

const TTL = {
  gamesToday: 5 * 60,
  games: 6 * 3600,
  standings: 24 * 3600,
};

async function apiGet(endpoint, params = {}, ttlOverride = null) {
  const cacheKey = `nba_${endpoint}${JSON.stringify(params)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const used = cache.getDailyRequestCount(QUOTA_NAMESPACE);
  if (used >= DAILY_LIMIT) {
    cache.warnOnceIfQuotaReached(QUOTA_NAMESPACE, used, DAILY_LIMIT);
    return [];
  }

  const response = await axios.get(`${BASE_URL}${endpoint}`, {
    headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY },
    params,
  });

  cache.logRequest(endpoint, QUOTA_NAMESPACE);
  // api-sports.io répond en 200 même en cas de clé invalide ou de quota épuisé côté fournisseur
  // (response: [] silencieux) — sans ce log, ce genre de panne est indiscernable d'une vraie
  // absence de matchs ce jour-là.
  if (response.data.errors && Object.keys(response.data.errors).length > 0) {
    console.error(`Erreur API NBA (${endpoint}) :`, response.data.errors);
  }
  const data = response.data.response;
  const ttlKey = Object.keys(TTL).find((k) => endpoint.includes(k)) || 'games';
  cache.set(cacheKey, data, ttlOverride ?? TTL[ttlKey]);

  return data;
}

// Normalise une entrée /games vers le format {fixture, league, teams, goals} pour réutiliser
// analyzeForm/analyzeH2H. ⚠️ Champs exacts (scores, statuts) à vérifier via /debug avec une vraie clé.
function normalizeGame(g) {
  const homeTotal = typeof g.scores?.home === 'object' ? g.scores.home.total : g.scores?.home;
  const awayTotal = typeof g.scores?.away === 'object' ? g.scores.away.total : g.scores?.away;
  return {
    fixture: {
      id: g.id ?? g.game?.id,
      date: g.date ?? g.game?.date?.start ?? g.game?.date,
      status: { short: g.status?.short ?? g.game?.status?.short },
    },
    league: {
      id: g.league?.id,
      name: g.league?.name,
      country: g.country?.name ?? g.league?.country?.name ?? 'USA',
      season: g.league?.season ?? g.season,
    },
    teams: g.teams,
    goals: { home: homeTotal ?? null, away: awayTotal ?? null },
  };
}

function seasonForDate(dateStr) {
  const d = new Date(dateStr);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  return month < 7 ? year - 1 : year; // saison NBA "2024" = oct 2024 -> juin 2025
}

function sortByDateDesc(games) {
  return games.sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date));
}

async function getGamesByDate(date) {
  const games = await apiGet('/games', { date }, TTL.gamesToday);
  return Array.isArray(games) ? games.map(normalizeGame) : [];
}

async function getTeamLastGames(teamId, count = 5, referenceDate = new Date().toISOString()) {
  const season = seasonForDate(referenceDate);
  const games = await apiGet('/games', { team: teamId, season });
  const finished = (Array.isArray(games) ? games : [])
    .map(normalizeGame)
    .filter((f) => f.fixture.status.short === 'FT');
  return sortByDateDesc(finished).slice(0, count);
}

async function getH2H(team1Id, team2Id, count = 10) {
  const games = await apiGet('/games', { h2h: `${team1Id}-${team2Id}` });
  const all = Array.isArray(games) ? games.map(normalizeGame) : [];
  return sortByDateDesc(all).slice(0, count);
}

// Pas de mapping fiable classement/blessures NBA -> format foot sans vérification des champs réels
async function getStandings() {
  return [];
}

async function getInjuries() {
  return [];
}

async function getRawGames(date) {
  return apiGet('/games', { date });
}

async function getGameById(id) {
  const games = await apiGet('/games', { id });
  const normalized = Array.isArray(games) ? games.map(normalizeGame) : [];
  return normalized[0] || null;
}

module.exports = {
  getGamesByDate,
  getTeamLastGames,
  getH2H,
  getStandings,
  getInjuries,
  getRawGames,
  getGameById,
  getDailyRequestCount: () => cache.getDailyRequestCount(QUOTA_NAMESPACE),
  DAILY_LIMIT,
  NBA_LEAGUE_ID,
};
