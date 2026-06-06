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

// Cherche dans un texte 3 % consécutifs dont la somme est ~100
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

// Cherche des blocs "équipe vs équipe + 3 %" dans tout le HTML
function findMatchBlock(text, homeTeam, awayTeam) {
  const h = norm(homeTeam).slice(0, 6);
  const a = norm(awayTeam).slice(0, 6);
  const textNorm = norm(text);

  const hIdx = textNorm.indexOf(h);
  const aIdx = textNorm.indexOf(a);
  if (hIdx === -1 || aIdx === -1) return null;

  // Prendre un bloc de 2000 chars autour des noms des équipes
  const start = Math.max(0, Math.min(hIdx, aIdx) - 100);
  const end = Math.min(text.length, Math.max(hIdx, aIdx) + 1000);
  return text.slice(start, end);
}

async function getTodayPredictions(date) {
  const key = `fpred_${date}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const urls = [
    'https://www.footballpredictions.com/predictions',
    'https://www.footballpredictions.com',
    'https://www.footballpredictions.com/today',
    'https://www.footballpredictions.com/football-predictions',
  ];

  for (const url of urls) {
    try {
      const { data } = await axios.get(url, { headers: HEADERS, timeout: 10000 });
      const $ = cheerio.load(data);
      const predictions = [];

      // Essai 1 : sélecteurs classiques
      $('[class*="match"], [class*="fixture"], [class*="prediction"], [class*="game"]').each((_, el) => {
        const text = $(el).text();
        const textNorm = norm(text);

        // Cherche deux noms d'équipes séparés par "vs" ou "-"
        const vsMatch = text.match(/(.{3,30})\s+(?:vs\.?|-)\s+(.{3,30})/i);
        if (!vsMatch) return;

        const home = vsMatch[1].trim();
        const away = vsMatch[2].trim();
        const triplet = extractTriplet(text);

        if (home && away) {
          predictions.push({ home, away, probabilities: triplet });
        }
      });

      // Essai 2 : extraction directe sur le texte entier si sélecteurs vides
      if (predictions.length === 0) {
        const allText = $('body').text();
        const blocks = allText.split(/\n{2,}/);
        for (const block of blocks) {
          const vsMatch = block.match(/([A-Z][a-zA-Z\s]{2,25})\s+(?:vs\.?|-)\s+([A-Z][a-zA-Z\s]{2,25})/);
          if (!vsMatch) continue;
          const home = vsMatch[1].trim();
          const away = vsMatch[2].trim();
          const triplet = extractTriplet(block);
          if (home && away && triplet) {
            predictions.push({ home, away, probabilities: triplet });
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

const isInFpred = (list, homeTeam, awayTeam) => {
  if (!list || list.length === 0) return false;
  const h = norm(homeTeam);
  const a = norm(awayTeam);
  return list.some((p) => {
    const ph = norm(p.home);
    const pa = norm(p.away);
    return ph.includes(h.slice(0, 5)) || h.includes(ph.slice(0, 5)) ||
           pa.includes(a.slice(0, 5)) || a.includes(pa.slice(0, 5));
  });
};

const findPrediction = (list, homeTeam, awayTeam) => {
  if (!list || list.length === 0) return null;
  const h = norm(homeTeam);
  const a = norm(awayTeam);
  return list.find((p) => {
    const ph = norm(p.home);
    const pa = norm(p.away);
    return ph.includes(h.slice(0, 5)) || h.includes(ph.slice(0, 5)) ||
           pa.includes(a.slice(0, 5)) || a.includes(pa.slice(0, 5));
  }) || null;
};

module.exports = { getTodayPredictions, isInFpred, findPrediction };
