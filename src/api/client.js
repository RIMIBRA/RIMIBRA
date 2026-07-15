require('dotenv').config();
const axios = require('axios');
const cache = require('../cache/db');

const BASE_URL = 'https://v3.football.api-sports.io';
// Plan Pro actif : 7500 req/jour (mets à jour si tu changes de formule)
const DAILY_LIMIT = 7500;

const TTL = {
  // Court délibérément : cette liste contient le statut (NS/live/FT) de chaque match.
  // Un TTL long ferait afficher des matchs déjà terminés comme "à venir" pendant des heures.
  fixturesToday: 5 * 60,
  fixtures: 6 * 3600,
  standings: 24 * 3600,
  h2h: 7 * 24 * 3600,
  form: 12 * 3600,
  injuries: 12 * 3600,
  leagues: 24 * 3600,
  // Le fournisseur republie la composition environ toutes les 15 min une fois disponible
  // (~20-75 min avant le coup d'envoi, jamais avant) -> TTL court pour rester à jour dans
  // cette fenêtre, sans non plus retaper l'API à chaque appel.
  lineups: 10 * 60,
  // Cotes bookmaker : endpoint paginé (~10 matchs/page), donc plusieurs requêtes à chaque
  // rafraîchissement -> TTL plus long que fixturesToday pour ne pas repayer ce coût trop souvent.
  odds: 30 * 60,
};

async function apiGet(endpoint, params = {}, ttlOverride = null) {
  // Vérifier le cache EN PREMIER — si les données sont là, pas besoin de compter la limite
  const cacheKey = endpoint + JSON.stringify(params);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const used = cache.getDailyRequestCount();
  if (used >= DAILY_LIMIT) {
    cache.warnOnceIfQuotaReached('football', used, DAILY_LIMIT);
    return []; // Retourner tableau vide plutôt que bloquer toute l'app
  }

  const response = await axios.get(`${BASE_URL}${endpoint}`, {
    headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY },
    params,
  });

  cache.logRequest(endpoint);
  const data = response.data.response;
  const ttlKey = Object.keys(TTL).find((k) => endpoint.includes(k)) || 'fixtures';
  cache.set(cacheKey, data, ttlOverride ?? TTL[ttlKey]);

  return data;
}

async function getFixturesByDate(date) {
  return apiGet('/fixtures', { date }, TTL.fixturesToday);
}

async function getTeamLastMatches(teamId, count = 5) {
  const results = await apiGet('/fixtures', { team: teamId, last: count });
  // Keep only finished matches
  return results.filter((f) =>
    ['FT', 'AET', 'PEN', 'AWD', 'WO'].includes(f.fixture.status.short)
  );
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

// Composition officielle — le fournisseur ne la publie que ~20-75 min avant le coup
// d'envoi (jamais avant) ; ttlOverride explicite car "/fixtures/lineups" contient "fixtures"
// et matcherait sinon à tort la TTL de 6h prévue pour les fixtures normales.
async function getLineups(fixtureId) {
  return apiGet('/fixtures/lineups', { fixture: fixtureId }, TTL.lineups);
}

async function getActiveLeagues() {
  return apiGet('/leagues', { current: true });
}

async function getFixtureById(fixtureId) {
  const results = await apiGet('/fixtures', { id: fixtureId });
  return results[0] || null;
}

// Cotes de plusieurs bookmakers par match (id 1 = "Match Winner"/1X2), liées au même id de
// fixture que le reste de l'API — voir algorithm/bookmakerOdds.js pour le calcul du consensus.
// Endpoint paginé côté fournisseur ; on boucle jusqu'à une page vide ou incomplète plutôt que de
// dépendre d'un champ "paging" qu'apiGet ne renvoie pas (il ne garde que response.data.response).
async function getOddsByDate(date) {
  const all = [];
  for (let page = 1; page <= 15; page++) {
    const pageData = await apiGet('/odds', { date, page }, TTL.odds);
    if (!pageData || pageData.length === 0) break;
    all.push(...pageData);
    if (pageData.length < 10) break;
  }
  return all;
}

module.exports = {
  getFixturesByDate,
  getTeamLastMatches,
  getH2H,
  getStandings,
  getInjuries,
  getLineups,
  getActiveLeagues,
  getFixtureById,
  getOddsByDate,
  getDailyRequestCount: cache.getDailyRequestCount,
  DAILY_LIMIT,
};
