const axios = require('axios');
const cache = require('../cache/db');

const BASE = 'https://api.the-odds-api.com/v4';
const TTL = 6 * 3600;

// Ligues prioritaires par ordre d'importance
const LEAGUES = [
  'soccer_epl', 'soccer_spain_la_liga', 'soccer_germany_bundesliga',
  'soccer_italy_serie_a', 'soccer_france_ligue_one', 'soccer_uefa_champs_league',
  'soccer_uefa_europa_league', 'soccer_conmebol_copa_libertadores',
  'soccer_africa_cup_of_nations', 'soccer_fifa_world_cup',
  'soccer_usa_mls', 'soccer_brazil_campeonato',
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

  for (const league of LEAGUES) {
    try {
      const matches = await fetchLeagueOdds(league);
      for (const match of matches) {
        // Filtrer aux matchs du jour uniquement
        const matchDate = new Date(match.commence_time);
        if (matchDate < today || matchDate > tomorrow) continue;

        const bookmaker = match.bookmakers.find((b) =>
          ['unibet', 'pinnacle', 'bet365', 'williamhill', 'bwin', '1xbet'].includes(b.key)
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
      continue; // Ligue non disponible ou quota épuisé
    }
  }

  if (results.length > 0) cache.set(key, results, TTL);
  return results;
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

module.exports = { getTodayOdds, findMatch };
