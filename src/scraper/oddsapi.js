const axios = require('axios');
const cache = require('../cache/db');

const BASE = 'https://api.the-odds-api.com/v4';
const TTL = 24 * 3600; // 1 appel par jour par ligue = ~450 req/mois (sous la limite free 500)
const MAX_LEAGUES = 20;

// Ligues toujours incluses en priorité (même si absentes du top MAX_LEAGUES)
const PRIORITY_LEAGUES = [
  'soccer_international',
  'soccer_fifa_world_cup',
  'soccer_uefa_euro_qualification',
  'soccer_conmebol_copa_america',
];

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function convertOdds(homeOdd, drawOdd, awayOdd) {
  const h = 1 / homeOdd;
  const d = 1 / drawOdd;
  const a = 1 / awayOdd;
  const total = h + d + a;
  return {
    home: Math.round((h / total) * 100),
    draw: Math.round((d / total) * 100),
    away: Math.round((a / total) * 100),
  };
}

// Récupère les ligues soccer actuellement actives (matchs en cours ou à venir)
async function getActiveSoccerLeagues() {
  const cacheKey = 'oddsapi_sports';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const { data } = await axios.get(`${BASE}/sports`, {
    params: { apiKey: process.env.THE_ODDS_API_KEY, all: false },
    timeout: 10000,
  });

  const leagues = data
    .filter((s) => s.group === 'Soccer' && s.active)
    .map((s) => s.key)
    .slice(0, MAX_LEAGUES);

  cache.set(cacheKey, leagues, 3600); // re-checker les ligues actives toutes les heures
  return leagues;
}

async function fetchLeagueOdds(leagueKey) {
  const { data } = await axios.get(`${BASE}/sports/${leagueKey}/odds/`, {
    params: {
      apiKey: process.env.THE_ODDS_API_KEY,
      regions: 'eu',
      markets: 'h2h',
      dateFormat: 'iso',
      oddsFormat: 'decimal',
    },
    timeout: 10000,
  });
  return data;
}

async function getTodayOdds() {
  if (!process.env.THE_ODDS_API_KEY) return [];

  const key = `oddsapi_${new Date().toISOString().split('T')[0]}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000);
  const results = [];

  let leagues;
  try {
    const dynamic = await getActiveSoccerLeagues();
    // Ajouter les ligues prioritaires en tête si elles ne sont pas déjà dans la liste
    const extra = PRIORITY_LEAGUES.filter((l) => !dynamic.includes(l));
    leagues = [...extra, ...dynamic].slice(0, MAX_LEAGUES);
  } catch {
    leagues = PRIORITY_LEAGUES; // fallback minimal si la requête sports échoue
  }

  for (const league of leagues) {
    try {
      const matches = await fetchLeagueOdds(league);
      for (const match of matches) {
        const matchDate = new Date(match.commence_time);
        if (matchDate < today || matchDate > tomorrow) continue;

        const bookmaker = match.bookmakers.find((b) =>
          ['unibet', 'pinnacle', 'bet365', 'williamhill', 'bwin'].includes(b.key)
        ) || match.bookmakers[0];

        if (!bookmaker) continue;
        const market = bookmaker.markets.find((m) => m.key === 'h2h');
        if (!market || market.outcomes.length < 3) continue;

        const homeOut = market.outcomes.find((o) => o.name === match.home_team);
        const awayOut = market.outcomes.find((o) => o.name === match.away_team);
        const drawOut = market.outcomes.find((o) => o.name === 'Draw');
        if (!homeOut || !awayOut || !drawOut) continue;

        results.push({
          id: match.id,
          leagueKey: league, // ex: 'soccer_epl' — nécessaire pour récupérer le marché "totals" à la demande
          home: match.home_team,
          away: match.away_team,
          league: match.sport_title,
          commenceTime: match.commence_time,
          probabilities: convertOdds(homeOut.price, drawOut.price, awayOut.price),
          rawOdds: { home: homeOut.price, draw: drawOut.price, away: awayOut.price },
          bookmaker: bookmaker.title,
          source: 'odds-api',
        });
      }
    } catch {
      continue;
    }
  }

  if (results.length > 0) cache.set(key, results, TTL);
  return results;
}

// Coûte 1 requête (en plus du quota déjà utilisé pour h2h) — appelé uniquement à la demande
// (détail d'un match précis) et caché longtemps, jamais pour la liste complète du jour, car
// the-odds-api facture chaque marché séparément (vérifié : h2h+totals = 2 requêtes, pas 1)
async function getMatchTotals(eventId, leagueKey) {
  if (!process.env.THE_ODDS_API_KEY || !eventId || !leagueKey) return null;

  // Note : le cache ne distingue pas "jamais demandé" de "demandé mais resté vide" (les deux
  // renvoient null) — un échec répété refera donc l'appel plutôt que d'économiser du quota,
  // mais ça reste rare (1 appel par match consulté, pas par la liste du jour entière).
  const cacheKey = `oddsapi_totals_${eventId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await axios.get(`${BASE}/sports/${leagueKey}/events/${eventId}/odds`, {
      params: {
        apiKey: process.env.THE_ODDS_API_KEY,
        regions: 'eu',
        markets: 'totals',
        dateFormat: 'iso',
        oddsFormat: 'decimal',
      },
      timeout: 10000,
    });

    const bookmaker = data.bookmakers?.find((b) =>
      ['unibet', 'pinnacle', 'bet365', 'williamhill', 'bwin'].includes(b.key)
    ) || data.bookmakers?.[0];
    const market = bookmaker?.markets?.find((m) => m.key === 'totals');
    const result = market?.outcomes?.length > 0 ? market.outcomes : null;

    if (result) cache.set(cacheKey, result, 6 * 3600);
    return result;
  } catch {
    return null;
  }
}

function findMatch(list, homeTeam, awayTeam) {
  if (!list || list.length === 0) return null;
  const h = norm(homeTeam);
  const a = norm(awayTeam);
  return list.find((m) => {
    const mh = norm(m.home);
    const ma = norm(m.away);
    return (mh.includes(h.slice(0, 5)) || h.includes(mh.slice(0, 5))) &&
           (ma.includes(a.slice(0, 5)) || a.includes(ma.slice(0, 5)));
  }) || null;
}

module.exports = { getTodayOdds, findMatch, getMatchTotals };
