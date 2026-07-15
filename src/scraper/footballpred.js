const axios = require('axios');
const cheerio = require('cheerio');
const cache = require('../cache/db');

const LIST_TTL = 6 * 3600;
const MATCH_TTL = 6 * 3600;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Liste des matchs du jour : le site les publie en JSON-LD (schema.org SportsEvent) sur sa page
// d'accueil des pronostics — bien plus fiable qu'un regex sur le texte affiché (l'ancienne
// approche, cassée depuis que le site a changé sa structure : /predictions, /today et
// /football-predictions renvoient tous 404 désormais, la vraie page est /footballpredictions/).
// Ne contient QUE les noms d'équipe + le lien vers la page de pronostic dédiée : les
// probabilités elles-mêmes ne sont plus affichées sur cette page de liste (voir findPrediction).
async function getTodayPredictions(date) {
  const key = `fpred_list_${date}`;
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const { data } = await axios.get('https://footballpredictions.com/footballpredictions/', {
      headers: HEADERS,
      timeout: 10000,
    });
    const $ = cheerio.load(data);
    const matches = [];

    $('script[type="application/ld+json"]').each((_, el) => {
      let json;
      try {
        json = JSON.parse($(el).html());
      } catch {
        return;
      }
      if (json['@type'] !== 'SportsEvent' || !Array.isArray(json.competitor) || json.competitor.length !== 2 || !json.url) return;
      const [home, away] = json.competitor.map((c) => c.name);
      if (home && away) matches.push({ home, away, url: json.url });
    });

    if (matches.length > 0) cache.set(key, matches, LIST_TTL);
    return matches;
  } catch {
    return [];
  }
}

function findListEntry(list, homeTeam, awayTeam) {
  if (!list || list.length === 0) return null;
  const h = norm(homeTeam);
  const a = norm(awayTeam);
  return list.find((p) => {
    const ph = norm(p.home);
    const pa = norm(p.away);
    return ph.includes(h.slice(0, 5)) || h.includes(ph.slice(0, 5)) ||
           pa.includes(a.slice(0, 5)) || a.includes(pa.slice(0, 5));
  }) || null;
}

const isInFpred = (list, homeTeam, awayTeam) => !!findListEntry(list, homeTeam, awayTeam);

// Le sondage "Our Visitors Prediction" (.prediction-votes) sur la page dédiée à chaque match est
// la seule donnée du site qui a la forme home/draw/away en % dont a besoin blendProbabilities —
// le reste de la page (score exact prédit, cotes de paris par marché, historique H2H) ne s'y
// prête pas. C'est un vote des visiteurs du site, pas un modèle statistique : signal plus faible
// qu'une vraie source de cotes (oddsapi), d'où son poids par défaut de 1 dans calibration.js.
async function fetchMatchPrediction(entry) {
  const key = `fpred_match_${entry.url}`;
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    // Petit délai aléatoire : plusieurs matchs peuvent être analysés en parallèle (voir
    // ANALYSIS_CONCURRENCY dans algorithm/predictor.js) -> évite de bombarder le site de
    // requêtes simultanées pour un simple sondage visiteurs.
    await sleep(200 + Math.random() * 400);
    const { data } = await axios.get(entry.url, { headers: HEADERS, timeout: 10000 });
    const $ = cheerio.load(data);

    let home = null;
    let draw = null;
    let away = null;
    $('.prediction-votes .mom-bar').each((_, el) => {
      const $bar = $(el);
      const team = $bar.find('[data-team]').first().attr('data-team'); // 'home' | 'away' | 'draw'
      const pct = parseInt(($bar.find('.mb-score').attr('data-pct') || '').replace('%', ''), 10);
      if (!team || Number.isNaN(pct)) return;
      if (team === 'home') home = pct;
      else if (team === 'away') away = pct;
      else if (team === 'draw') draw = pct;
    });

    if (home == null || draw == null || away == null) return null;

    const result = { probabilities: { home, draw, away }, source: 'footballpred' };
    cache.set(key, result, MATCH_TTL);
    return result;
  } catch {
    return null;
  }
}

async function findPrediction(list, homeTeam, awayTeam) {
  const entry = findListEntry(list, homeTeam, awayTeam);
  if (!entry) return null;
  return fetchMatchPrediction(entry);
}

module.exports = { getTodayPredictions, isInFpred, findPrediction };
