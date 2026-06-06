const axios = require('axios');
const cheerio = require('cheerio');
const cache = require('../cache/db');

const TTL = 6 * 3600;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Cache-Control': 'max-age=0',
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

// Convertit "1", "X", "2" en probabilités approximatives
function tipToProbs(tip) {
  if (!tip) return null;
  const t = tip.trim().toUpperCase();
  if (t === '1')  return { home: 60, draw: 22, away: 18 };
  if (t === 'X')  return { home: 25, draw: 45, away: 30 };
  if (t === '2')  return { home: 18, draw: 22, away: 60 };
  if (t === '1X') return { home: 48, draw: 35, away: 17 };
  if (t === 'X2') return { home: 17, draw: 35, away: 48 };
  if (t === '12') return { home: 50, draw: 10, away: 40 };
  return null;
}

async function getTodayPredictions(date) {
  const key = `predictz_${date}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const urls = [
    'https://www.predictz.com/predictions/today/',
    'https://www.predictz.com/predictions/',
    'https://predictz.com/predictions/today/',
  ];

  for (const url of urls) {
    try {
      const { data } = await axios.get(url, { headers: HEADERS, timeout: 12000 });
      const $ = cheerio.load(data);
      const predictions = [];

      // Predictz structure: table rows with team names and tip columns
      $('tr, [class*="match"], [class*="fixture"], [class*="predict"]').each((_, el) => {
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        if (text.length < 5) return;

        // Look for team names separated by vs / - / –
        const vsMatch = text.match(/([A-Z][a-zA-Z0-9\s\-\.]{1,28})\s+(?:vs?\.?|–|-)\s+([A-Z][a-zA-Z0-9\s\-\.]{1,28})/);
        if (!vsMatch) return;

        const home = vsMatch[1].trim();
        const away = vsMatch[2].trim();
        if (norm(home).length < 2 || norm(away).length < 2) return;

        // Try %  triplet first
        const triplet = extractTriplet(text);

        // Fallback: look for 1/X/2/1X/X2/12 prediction tip
        const tipMatch = text.match(/\b(1X|X2|12|1|X|2)\b/);
        const probs = triplet || (tipMatch ? tipToProbs(tipMatch[1]) : null);

        predictions.push({ home, away, probabilities: probs, source: 'predictz' });
      });

      // Fallback: scan full text
      if (predictions.length === 0) {
        const rawText = $('body').text();
        const lines = rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 5);
        for (let i = 0; i < lines.length; i++) {
          const block = lines.slice(i, i + 6).join(' ');
          const vsMatch = block.match(/([A-Z][a-zA-Z\s]{2,22})\s+(?:vs?\.?|–|-)\s+([A-Z][a-zA-Z\s]{2,22})/);
          if (!vsMatch) continue;
          const triplet = extractTriplet(block);
          const tipMatch = block.match(/\b(1X|X2|12|1|X|2)\b/);
          const probs = triplet || (tipMatch ? tipToProbs(tipMatch[1]) : null);
          predictions.push({
            home: vsMatch[1].trim(),
            away: vsMatch[2].trim(),
            probabilities: probs,
            source: 'predictz',
          });
          i += 3;
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
