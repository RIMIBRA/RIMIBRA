require('dotenv').config();
const axios = require('axios');
const cache = require('../cache/db');

const BASE_URL = 'https://api.api-tennis.com/tennis/';
const NAMESPACE = 'tennis';
// Plan Entreprise : 200 000 appels/jour — actif via l'essai gratuit de 14 jours démarré le
// 2026-06-28 (date du premier appel loggé). Passé TRIAL_ENDS, on retombe automatiquement sur
// un quota conservateur pour ne pas continuer à taper comme si la marge de 200k existait encore
// (ce qui ferait planter les appels réels une fois l'essai terminé sans que rien ne le signale).
// Ajuste POST_TRIAL_LIMIT dès que le vrai plan payant est connu, ou fixe API_TENNIS_DAILY_LIMIT
// dans .env pour forcer une valeur (prioritaire sur tout le reste).
const TRIAL_ENDS = new Date('2026-07-12T00:00:00Z').getTime();
const TRIAL_LIMIT = 200000;
const POST_TRIAL_LIMIT = 100;
const DAILY_LIMIT = process.env.API_TENNIS_DAILY_LIMIT
  ? parseInt(process.env.API_TENNIS_DAILY_LIMIT, 10)
  : (Date.now() < TRIAL_ENDS ? TRIAL_LIMIT : POST_TRIAL_LIMIT);

const GAMES_TODAY_TTL = 5 * 60; // court : statut sensible au temps (NS/live/Finished)
const DEFAULT_TTL = 6 * 3600;

async function apiGet(method, params = {}, ttlOverride = null) {
  const cacheKey = `tennis_${method}${JSON.stringify(params)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const used = cache.getDailyRequestCount(NAMESPACE);
  if (used >= DAILY_LIMIT) {
    cache.warnOnceIfQuotaReached(NAMESPACE, used, DAILY_LIMIT);
    return [];
  }

  const response = await axios.get(BASE_URL, {
    params: { method, APIkey: process.env.API_TENNIS_KEY, ...params },
  });

  cache.logRequest(method, NAMESPACE);
  const raw = response.data?.result ?? [];
  // event_key/statuts pèsent quelques centaines d'octets ; pointbypoint et statistics (jamais
  // lus par normalizeFixture) pèsent ~35Ko PAR MATCH -> avec 500+ matchs/jour ça a fait grossir
  // cache-data.json à 111Mo, réécrit en entier et en synchrone à chaque set() (voir cache/db.js),
  // ce qui bloquait l'event loop de tout le serveur, pas seulement le tennis.
  const data = Array.isArray(raw)
    ? raw.map(({ pointbypoint, statistics, ...rest }) => rest)
    : raw;
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

function averageOdd(bookmakers) {
  const values = Object.values(bookmakers || {}).map(Number).filter((n) => !Number.isNaN(n));
  if (values.length === 0) return null;
  return values.reduce((s, o) => s + o, 0) / values.length;
}

// Toutes les lignes "nombre de sets" disponibles pour un match (marché "Over/Under" de l'API =
// total de SETS, pas de jeux — voir le commentaire dans routes/tennisPredictions.js, confirmé
// par des lignes fixes 3.5/4.5 sur les matchs en 5 sets). Contrairement à l'alternative de pari
// de tennisPredictions.js (qui n'en retient qu'une seule, "équilibrée"), ici on expose TOUTES
// les lignes : sert au combiné manuel, où le fondateur choisit librement le marché par match.
// probability = probabilité implicite de la cote moyenne (100/cote) — inclut la marge du
// bookmaker (légèrement surestimée), mais c'est la seule donnée réelle disponible pour ce
// marché, contrairement au foot où l'algo calcule ses propres probabilités (buts, Poisson).
async function getSetsMarkets(matchId) {
  const odds = await getOdds(matchId);
  const overUnder = odds?.['Over/Under'];
  if (!overUnder) return null;

  const markets = [];
  for (const [sideKey, side] of [['Over/Under Over', 'over'], ['Over/Under Under', 'under']]) {
    const lines = overUnder[sideKey];
    if (!lines) continue;
    for (const [line, bookmakers] of Object.entries(lines)) {
      const odd = averageOdd(bookmakers);
      if (odd != null) markets.push({ side, line, probability: Math.round(100 / odd) });
    }
  }
  return markets.length > 0 ? markets : null;
}

module.exports = {
  getGamesByDate,
  getTeamLastGames,
  getH2H,
  getRawGames,
  getGameById,
  getOdds,
  getSetsMarkets,
  getDailyRequestCount: () => cache.getDailyRequestCount(NAMESPACE),
  DAILY_LIMIT,
};
