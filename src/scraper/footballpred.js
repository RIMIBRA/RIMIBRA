const axios = require('axios');
const cheerio = require('cheerio');
const cache = require('../cache/db');

const TTL = 6 * 3600;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
};

async function getTodayPredictions(date) {
  const key = `fpred_${date}`;
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const { data } = await axios.get('https://www.footballpredictions.com/predictions', {
      headers: HEADERS,
      timeout: 10000,
    });
    const $ = cheerio.load(data);

    const predictions = [];
    $('[class*="match"], [class*="fixture"], [class*="prediction"]').each((_, el) => {
      const home = $(el).find('[class*="home"] [class*="team"], .home-team').first().text().trim();
      const away = $(el).find('[class*="away"] [class*="team"], .away-team').first().text().trim();

      const percents = [];
      $(el).find('[class*="percent"], [class*="probability"]').each((_, p) => {
        const v = parseInt($(p).text().replace('%', '').trim());
        if (!isNaN(v)) percents.push(v);
      });

      if (home && away && percents.length >= 3) {
        predictions.push({
          home, away,
          probabilities: { home: percents[0], draw: percents[1], away: percents[2] },
        });
      }
    });

    if (predictions.length > 0) cache.set(key, predictions, TTL);
    return predictions;
  } catch {
    return [];
  }
}

function findPrediction(predictions, homeTeam, awayTeam) {
  if (!predictions || predictions.length === 0) return null;
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const h = normalize(homeTeam);
  const a = normalize(awayTeam);
  return predictions.find((p) => normalize(p.home).includes(h.slice(0, 5)) || normalize(p.away).includes(a.slice(0, 5))) || null;
}

module.exports = { getTodayPredictions, findPrediction };
