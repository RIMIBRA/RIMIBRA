const axios = require('axios');
const cheerio = require('cheerio');
const cache = require('../cache/db');

const TTL = 6 * 3600;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
};

async function fetchHtml(url) {
  const { data } = await axios.get(url, { headers: HEADERS, timeout: 10000 });
  return cheerio.load(data);
}

async function getMatchData(homeTeam, awayTeam) {
  const key = `bsc_${homeTeam}_${awayTeam}`;
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const query = encodeURIComponent(`${homeTeam} ${awayTeam}`);
    const $ = await fetchHtml(`https://www.besoccer.com/search?q=${query}&section=match`);

    const matchHref = $('a[href*="/match/"]').first().attr('href');
    if (!matchHref) return null;

    const matchUrl = matchHref.startsWith('http')
      ? matchHref
      : `https://www.besoccer.com${matchHref}`;

    const $m = await fetchHtml(matchUrl);

    // Percentages (1 X 2)
    const percents = [];
    $m('[class*="percent"], [class*="percentage"], .pa-percent').each((_, el) => {
      const v = parseInt($m(el).text().replace('%', '').trim());
      if (!isNaN(v)) percents.push(v);
    });

    // Recent form badges (W/D/L or V/N/P)
    const homeForm = [], awayForm = [];
    $m('.team-state .state, .team1 .result-badge, .r1 span').slice(0, 5).each((_, el) => {
      const t = $m(el).text().trim().toUpperCase();
      if (t === 'W' || t === 'V') homeForm.push('W');
      else if (t === 'D' || t === 'N') homeForm.push('D');
      else if (t === 'L' || t === 'P') homeForm.push('L');
    });
    $m('.team-state .state, .team2 .result-badge, .r2 span').slice(0, 5).each((_, el) => {
      const t = $m(el).text().trim().toUpperCase();
      if (t === 'W' || t === 'V') awayForm.push('W');
      else if (t === 'D' || t === 'N') awayForm.push('D');
      else if (t === 'L' || t === 'P') awayForm.push('L');
    });

    const result = {
      source: 'besoccer',
      probabilities: percents.length >= 3
        ? { home: percents[0], draw: percents[1], away: percents[2] }
        : null,
      homeForm: homeForm.length > 0 ? homeForm : null,
      awayForm: awayForm.length > 0 ? awayForm : null,
    };

    cache.set(key, result, TTL);
    return result;
  } catch {
    return null;
  }
}

module.exports = { getMatchData };
