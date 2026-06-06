const axios = require('axios');
const cheerio = require('cheerio');
const cache = require('../cache/db');

const TTL = 6 * 3600;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function extractTriplet(text) {
  const nums = [];
  for (const m of text.matchAll(/\b(\d{1,3})%/g)) {
    const v = parseInt(m[1]);
    if (v > 0 && v < 100) nums.push(v);
  }
  for (let i = 0; i <= nums.length - 3; i++) {
    const sum = nums[i] + nums[i + 1] + nums[i + 2];
    if (sum >= 95 && sum <= 105) {
      return { home: nums[i], draw: nums[i + 1], away: nums[i + 2] };
    }
  }
  return null;
}

function extractFormBadges(text) {
  const badges = [];
  for (const m of text.matchAll(/\b([WDL])\b/g)) {
    badges.push(m[1]);
    if (badges.length >= 5) break;
  }
  return badges.length >= 3 ? badges : null;
}

async function getMatchData(homeTeam, awayTeam) {
  const key = `bsc_${homeTeam}_${awayTeam}`;
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const query = encodeURIComponent(`${homeTeam} ${awayTeam} prediction`);
    const searchUrl = `https://www.besoccer.com/search?q=${encodeURIComponent(homeTeam + ' ' + awayTeam)}&section=match`;

    const { data: searchHtml } = await axios.get(searchUrl, { headers: HEADERS, timeout: 10000 });
    const $ = cheerio.load(searchHtml);

    // Trouver le lien du match
    let matchHref = null;
    $('a[href*="/match/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = norm($(el).text() + href);
      if (text.includes(norm(homeTeam).slice(0, 5)) || text.includes(norm(awayTeam).slice(0, 5))) {
        matchHref = href;
        return false;
      }
    });

    if (!matchHref) {
      // Fallback: chercher dans le texte de la page
      const triplet = extractTriplet($('body').text());
      if (triplet) {
        const result = { probabilities: triplet, homeForm: null, awayForm: null };
        cache.set(key, result, TTL);
        return result;
      }
      return null;
    }

    const matchUrl = matchHref.startsWith('http') ? matchHref : `https://www.besoccer.com${matchHref}`;
    const { data: matchHtml } = await axios.get(matchUrl, { headers: HEADERS, timeout: 10000 });
    const $m = cheerio.load(matchHtml);

    const pageText = $m('body').text();
    const triplet = extractTriplet(pageText);

    // Chercher la forme dans le texte : séquences de W/D/L
    const formSection = pageText.match(/form[^]*?([WDL]{3,10})[^]*?([WDL]{3,10})/i);
    const homeForm = formSection ? extractFormBadges(formSection[1]) : null;
    const awayForm = formSection ? extractFormBadges(formSection[2]) : null;

    const result = { probabilities: triplet, homeForm, awayForm };
    if (triplet || homeForm) cache.set(key, result, TTL);
    return result;
  } catch {
    return null;
  }
}

module.exports = { getMatchData };
