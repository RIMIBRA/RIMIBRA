require('dotenv').config();
const axios = require('axios');
const cache = require('../cache/db');

const BASE_URL = 'https://api.api-tennis.com/tennis/';
const NAMESPACE = 'tennis';
// Plan Entreprise : 200 000 appels/jour — actif via l'essai gratuit de 14 jours.
// ⚠️ Repasse cette valeur à un plan inférieur (ou vérifie le nouveau quota) une fois
// l'essai terminé, sinon l'app pensera avoir encore beaucoup de marge alors que ce
// ne sera plus le cas.
const DAILY_LIMIT = 200000;

const GAMES_TODAY_TTL = 5 * 60; // court : statut sensible au temps (NS/live/Finished)
const DEFAULT_TTL = 6 * 3600;

async function apiGet(method, params = {}, ttlOverride = null) {
  const cacheKey = `tennis_${method}${JSON.stringify(params)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const used = cache.getDailyRequestCount(NAMESPACE);
  if (used >= DAILY_LIMIT) return [];

  const response = await axios.get(BASE_URL, {
    params: { method, APIkey: process.env.API_TENNIS_KEY, ...params },
  });

  cache.logRequest(method, NAMESPACE);
  const data = response.data?.result ?? [];
  cache.set(cacheKey, data, ttlOverride ?? DEFAULT_TTL);
  return data;
}

function statusShortFor(eventStatus) {
  if (eventStatus === 'Finished') return 'FT';
  if (!eventStatus) return 'NS';
  return 'LIVE'; // "Set 1", "Set 2"... peu importe lequel, juste "en cours"
}

// Sets gagnés par chaque joueur, extraits de "event_final_result" (ex: "2 - 0")
function parseSets(finalResult) {
  const m = /(\d+)\s*-\s*(\d+)/.exec(finalResult || '');
  return m ? { p1: parseInt(m[1]), p2: parseInt(m[2]) } : { p1: null, p2: null };
}

// Normalise vers le même format {fixture, league, teams, goals} que les autres sports —
// "joueur 1" = home, "joueur 2" = away, sets gagnés = goals — pour réutiliser tout
// l'algorithme existant (forme, H2H, validation) sans rien dupliquer.
function normalizeFixture(f) {
  const sets = parseSets(f.event_final_result);
  return {
    fixture: {
      id: f.event_key,
      date: f.event_date && f.event_time ? `${f.event_date}T${f.event_time}:00Z` : f.event_date,
      status: { short: statusShortFor(f.event_status) },
    },
    league: {
      name: f.tournament_name,
      country: '',
      season: f.tournament_season,
      // "Itf Men Singles" (mineur) vs "Atp Singles" / "Wta Singles" (circuit principal) —
      // pas d'id de ligue ici, on garde le type brut pour prioriser par niveau de tournoi
      type: f.event_type_type,
    },
    teams: {
      home: { id: f.first_player_key, name: f.event_first_player, logo: f.event_first_player_logo || null },
      away: { id: f.second_player_key, name: f.event_second_player, logo: f.event_second_player_logo || null },
    },
    goals: { home: sets.p1, away: sets.p2 },
  };
}

function sortByDateDesc(games) {
  return games.sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date));
}

async function getGamesByDate(date) {
  const fixtures = await apiGet('get_fixtures', { date_start: date, date_stop: date, timezone: 'UTC' }, GAMES_TODAY_TTL);
  return Array.isArray(fixtures) ? fixtures.map(normalizeFixture) : [];
}

// Pas de paramètre "last" sur cette API -> fenêtre large par player_key, triée et tronquée nous-mêmes
async function getTeamLastGames(playerKey, count = 5, referenceDate = new Date().toISOString()) {
  const stop = new Date(referenceDate);
  const start = new Date(stop.getTime() - 180 * 24 * 3600 * 1000); // ~6 mois en arrière
  const fmt = (d) => d.toISOString().split('T')[0];

  const fixtures = await apiGet('get_fixtures', {
    player_key: playerKey,
    date_start: fmt(start),
    date_stop: fmt(stop),
    timezone: 'UTC',
  });

  const finished = (Array.isArray(fixtures) ? fixtures : [])
    .map(normalizeFixture)
    .filter((f) => f.fixture.status.short === 'FT');
  return sortByDateDesc(finished).slice(0, count);
}

async function getH2H(player1Key, player2Key, count = 10) {
  const data = await apiGet('get_H2H', { first_player_key: player1Key, second_player_key: player2Key });
  // get_H2H renvoie généralement { H2H: [...], firstPlayerResults: [...], secondPlayerResults: [...] }
  const matches = Array.isArray(data) ? data : data?.H2H || [];
  const all = matches.map(normalizeFixture);
  return sortByDateDesc(all).slice(0, count);
}

async function getRawGames(date) {
  return apiGet('get_fixtures', { date_start: date, date_stop: date, timezone: 'UTC' }, GAMES_TODAY_TTL);
}

async function getGameById(id) {
  const fixtures = await apiGet('get_fixtures', { match_key: id });
  const normalized = Array.isArray(fixtures) ? fixtures.map(normalizeFixture) : [];
  return normalized[0] || null;
}

// Cotes réelles multi-marchés (Home/Away, Over/Under jeux, score exact...) pour un match —
// utilisé pour proposer une alternative au pari sec quand celui-ci est trop évident (cote ~1.0)
async function getOdds(matchId) {
  const data = await apiGet('get_odds', { match_key: matchId });
  if (!data) return null;
  return data[String(matchId)] || null;
}

module.exports = {
  getGamesByDate,
  getTeamLastGames,
  getH2H,
  getRawGames,
  getGameById,
  getOdds,
  getDailyRequestCount: () => cache.getDailyRequestCount(NAMESPACE),
  DAILY_LIMIT,
};
