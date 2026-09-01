require('dotenv').config();
const axios = require('axios');
const cache = require('../cache/db');

// Usine générique pour les sports d'équipe de la famille api-sports (NHL, MLB, Handball, etc.)
// — même convention d'endpoints (/games, h2h, team+season) que NFL/Basketball déjà en place.
// Une seule clé API_FOOTBALL_KEY couvre tous les sports du compte api-sports.io.
const GAMES_TODAY_TTL = 5 * 60; // court : contient le statut (NS/live/FT), doit rester frais
const DEFAULT_TTL = 6 * 3600;

function createSportClient({ baseUrl, namespace, dailyLimit = 100, seasonFromDate }) {
  async function apiGet(endpoint, params = {}, ttlOverride = null) {
    const cacheKey = `${namespace}_${endpoint}${JSON.stringify(params)}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const used = cache.getDailyRequestCount(namespace);
    if (used >= dailyLimit) {
      cache.warnOnceIfQuotaReached(namespace, used, dailyLimit);
      return [];
    }

    const response = await axios.get(`${baseUrl}${endpoint}`, {
      headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY },
      params,
    });

    cache.logRequest(endpoint, namespace);
    // api-sports.io répond en 200 même en cas de clé invalide ou de quota épuisé côté
    // fournisseur (response: [] silencieux) — sans ce log, ce genre de panne est indiscernable
    // d'une vraie absence de matchs ce jour-là.
    if (response.data.errors && Object.keys(response.data.errors).length > 0) {
      console.error(`Erreur API ${namespace} (${endpoint}) :`, response.data.errors);
    }
    const data = response.data.response;
    cache.set(cacheKey, data, ttlOverride ?? DEFAULT_TTL);
    return data;
  }

  // ⚠️ Champs exacts (scores, statuts) à vérifier via /debug une fois la clé du sport activée
  function normalizeGame(g) {
    const homeTotal = typeof g.scores?.home === 'object' ? g.scores.home.total : g.scores?.home;
    const awayTotal = typeof g.scores?.away === 'object' ? g.scores.away.total : g.scores?.away;
    return {
      fixture: {
        id: g.id ?? g.game?.id,
        date: g.date?.date ?? g.date ?? g.game?.date?.date ?? g.game?.date,
        status: { short: g.status?.short ?? g.game?.status?.short },
      },
      league: {
        id: g.league?.id,
        name: g.league?.name,
        country: g.country?.name ?? g.league?.country?.name ?? '',
        season: g.league?.season ?? g.season,
      },
      teams: g.teams,
      goals: { home: homeTotal ?? null, away: awayTotal ?? null },
    };
  }

  function sortByDateDesc(games) {
    return games.sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date));
  }

  async function getGamesByDate(date) {
    const games = await apiGet('/games', { date }, GAMES_TODAY_TTL);
    return Array.isArray(games) ? games.map(normalizeGame) : [];
  }

  // Pas de paramètre "last" sur le plan gratuit (confirmé pour NFL) -> saison complète + tri manuel
  async function getTeamLastGames(teamId, count = 5, referenceDate = new Date().toISOString()) {
    const season = seasonFromDate(referenceDate);
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

  async function getRawGames(date) {
    return apiGet('/games', { date }, GAMES_TODAY_TTL);
  }

  // Récupère un match précis par son id — utilisé pour l'analyse à la demande
  // (ex : valider une prédiction sur un match déjà terminé, sans tout réanalyser chaque jour)
  async function getGameById(id) {
    const games = await apiGet('/games', { id });
    const normalized = Array.isArray(games) ? games.map(normalizeGame) : [];
    return normalized[0] || null;
  }

  return {
    getGamesByDate,
    getTeamLastGames,
    getH2H,
    getRawGames,
    getGameById,
    getDailyRequestCount: () => cache.getDailyRequestCount(namespace),
    DAILY_LIMIT: dailyLimit,
  };
}

module.exports = { createSportClient };
