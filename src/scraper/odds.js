const axios = require('axios');
const cheerio = require('cheerio');
const cache = require('../cache/db');

const TTL = 2 * 3600;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.google.com/',
};

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Convertir les cotes décimales en probabilités normalisées (enlève la marge du bookmaker)
function oddsToProbs(home, draw, away) {
  if (!home || !draw || !away) return null;
  const h = 1 / home;
  const d = 1 / draw;
  const a = 1 / away;
  const total = h + d + a;
  return {
    home: Math.round((h / total) * 100),
    draw: Math.round((d / total) * 100),
    away: 100 - Math.round((h / total) * 100) - Math.round((d / total) * 100),
    rawOdds: { home, draw, away },
    source: '1xbet',
  };
}

function extractOdds($, el) {
  const odds = [];
  $(el).find('[class*="odd"], [class*="coef"], [class*="price"], [class*="factor"]').each((_, o) => {
    const v = parseFloat($(o).text().trim().replace(',', '.'));
    if (!isNaN(v) && v > 1.01 && v < 50) odds.push(v);
  });
  return odds;
}

async function get1xbetOdds(homeTeam, awayTeam) {
  const key = `odds_1x_${homeTeam}_${awayTeam}`;
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const { data } = await axios.get('https://1xbet.com/en/line/football', {
      headers: HEADERS,
      timeout: 12000,
    });

    const $ = cheerio.load(data);
    const h = norm(homeTeam);
    const a = norm(awayTeam);

    let result = null;

    $('[class*="game-"], [class*="match-"], [class*="event-"], .c-events__item').each((_, el) => {
      if (result) return false;
      const elText = norm($(el).text());
      if (!elText.includes(h.slice(0, 5)) && !elText.includes(a.slice(0, 5))) return;

      const odds = extractOdds($, el);
      if (odds.length >= 3) {
        result = oddsToProbs(odds[0], odds[1], odds[2]);
      }
    });

    if (result) cache.set(key, result, TTL);
    return result;
  } catch {
    return null;
  }
}

module.exports = { get1xbetOdds, oddsToProbs };
