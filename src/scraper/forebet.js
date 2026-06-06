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
    const s = nums[i] + nums[i + 1] + nums[i + 2];
    if (s >= 95 && s <= 105) return { home: nums[i], draw: nums[i + 1], away: nums[i + 2] };
  }
  return null;
}

async function getTodayPredictions(date) {
  const key = `forebet_${date}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const urls = [
    'https://www.forebet.com/en/football-tips-and-predictions-for-today/',
    'https://www.forebet.com/en/football-predictions/',
  ];

  for (const url of urls) {
    try {
      const { data } = await axios.get(url, { headers: HEADERS, timeout: 12000 });
      const $ = cheerio.load(data);
      const predictions = [];

      // Forebet structure : rows avec équipes et %
      $('tr, .rcnt, [class*="match"], [class*="predict"], [class*="tip"]').each((_, el) => {
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        if (text.length < 10) return;

        const vsMatch = text.match(/([A-Z][a-zA-Z0-9 \-\.]{2,28})\s*[-–vs]+\s*([A-Z][a-zA-Z0-9 \-\.]{2,28})/);
        if (!vsMatch) return;

        const home = vsMatch[1].trim();
        const away = vsMatch[2].trim();
        if (norm(home) === norm(away)) return;

        const triplet = extractTriplet(text);
        predictions.push({ home, away, probabilities: triplet, source: 'forebet' });
      });

      // Fallback texte brut
      if (predictions.length === 0) {
        const lines = $('body').text().split('\n').map((l) => l.trim()).filter(Boolean);
        for (let i = 0; i < lines.length - 3; i++) {
          const block = lines.slice(i, i + 8).join(' ');
          const vsMatch = block.match(/([A-Z][a-zA-Z ]{2,22})\s*[-–vs]+\s*([A-Z][a-zA-Z ]{2,22})/);
          if (!vsMatch) continue;
          const triplet = extractTriplet(block);
          if (triplet) {
            predictions.push({
              home: vsMatch[1].trim(),
              away: vsMatch[2].trim(),
              probabilities: triplet,
              source: 'forebet',
            });
            i += 4;
          }
        }
      }

      if (predictions.length > 0) {
        cache.set(key, predictions, TTL);
        return predictions;
      }
    } catch {
      continue;
    }
  }
  return [];
}

function findPrediction(list, homeTeam, awayTeam) {
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

module.exports = { getTodayPredictions, findPrediction };
