require('dotenv').config();
const axios = require('axios');
const cache = require('../cache/db');

const BASE_URL = 'https://v1.american-football.api-sports.io';
const DAILY_LIMIT = 100;
const NAMESPACE = 'nfl';
const NFL_LEAGUE_ID = 1; // NFL dans api-american-football — à confirmer via /debug

const TTL = {
  // Court délibérément : contient le statut (NS/live/FT), pas question de l'afficher périmé
  gamesToday: 5 * 60,
  games: 6 * 3600,
  standings: 24 * 3600,
  injuries: 12 * 3600,
};

async function apiGet(endpoint, params = {}, ttlOverride = null) {
  const cacheKey = `nfl_${endpoint}${JSON.stringify(params)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const used = cache.getDailyRequestCount(NAMESPACE);
  if (used >= DAILY_LIMIT) {
    cache.warnOnceIfQuotaReached(NAMESPACE, used, DAILY_LIMIT);
    return [];
  }

  const response = await axios.get(`${BASE_URL}${endpoint}`, {
    headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY },
    params,
  });

  cache.logRequest(endpoint, NAMESPACE);
  // api-sports.io répond en 200 même en cas de clé invalide ou de quota épuisé côté fournisseur
  // (response: [] silencieux) — sans ce log, ce genre de panne est indiscernable d'une vraie
  // absence de matchs ce jour-là.
  if (response.data.errors && Object.keys(response.data.errors).length > 0) {
    console.error(`Erreur API NFL (${endpoint}) :`, response.data.errors);
  }
  const data = response.data.response;
  const ttlKey = Object.keys(TTL).find((k) => endpoint.includes(k)) || 'games';
  cache.set(cacheKey, data, ttlOverride ?? TTL[ttlKey]);

  return data;
}

// Normalise une entrée /games vers le même format que les fixtures foot
// ({fixture, league, teams, goals}) pour réutiliser analyzeForm/analyzeH2H sans dupliquer la logique.
// ⚠️ Les noms de champs scores/league exacts sont à vérifier via /api/nfl/predictions/debug
function normalizeGame(g) {
  const homeTotal = typeof g.scores?.home === 'object' ? g.scores.home.total : g.scores?.home;
  const awayTotal = typeof g.scores?.away === 'object' ? g.scores.away.total : g.scores?.away;
  return {
    fixture: {
      id: g.id ?? g.game?.id,
      date: g.date?.date ?? g.date ?? g.game?.date?.date,
      status: { short: g.status?.short ?? g.game?.status?.short },
    },
    league: {
      id: g.league?.id,
      name: g.league?.name,
      country: g.league?.country?.name ?? 'USA',
      season: g.league?.season ?? g.season,
    },
    teams: g.teams,
    goals: { home: homeTotal ?? null, away: awayTotal ?? null },
  };
}

// Le paramètre "last" n'est pas disponible sur le plan gratuit -> on récupère
// la saison complète et on trie/tronque nous-mêmes.
function seasonForDate(dateStr) {
  const d = new Date(dateStr);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0 = janvier
  return month < 2 ? year - 1 : year; // saison NFL "2024" = août 2024 -> février 2025
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

// Pas de mapping fiable classement NFL -> format foot sans vérification des champs réels ;
// retourne vide pour l'instant (le predictor redistribue le poids sur forme + H2H + blessures).
async function getStandings() {
  return [];
}

// Contrairement au foot, cet endpoint n'est PAS filtrable par match (pas de paramètre
// fixture/game côté fournisseur — vérifié directement, "The Game/Fixture field do not
// exist") : c'est le rapport blessures courant de toute l'équipe, à interroger par équipe.
// Pas d'endpoint "lineups" pour ce sport chez ce fournisseur (vérifié aussi) -> pas de
// confirmation possible via la composition officielle, contrairement au foot.
async function getInjuries(teamId) {
  return apiGet('/injuries', { team: teamId });
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
  getGameById,
  getRawGames,
  getDailyRequestCount: () => cache.getDailyRequestCount(NAMESPACE),
  DAILY_LIMIT,
  NFL_LEAGUE_ID,
};
