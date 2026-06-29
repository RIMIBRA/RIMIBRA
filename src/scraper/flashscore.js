// Scraper Flashscore — cotes bookmaker agrégées (supplément à oddsapi)
// Note : Flashscore est protégé par Cloudflare ; ce scraper fonctionne en mode stealth
// mais peut être bloqué ponctuellement. Dégradation gracieuse si indisponible.
const { newPage } = require('./browser');
const cache = require('../cache/db');

const BASE = 'https://www.flashscore.com';
const TTL  = 3 * 3600;

function cacheKey(home, away) {
  return `flashscore_odds_${home}_${away}`.toLowerCase().replace(/\s+/g, '_');
}

function normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getMatchOdds(homeTeam, awayTeam) {
  const key = cacheKey(homeTeam, awayTeam);
  const cached = cache.get(key);
  if (cached) return cached;

  let page;
  try {
    page = await newPage();

    // 1. Rechercher le match
    const query = `${homeTeam} ${awayTeam}`;
    await page.goto(`${BASE}/search/?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' });
    await sleep(1200);

    // 2. Trouver le lien vers le match dans les résultats
    const matchLink = await page.evaluate((normHome, normAway) => {
      function norm(s) {
        return s.toLowerCase().normalize('NFD').replace(/̀-ͯ/ug, '').trim();
      }
      const rows = document.querySelectorAll('.suggest__row, .searchResult__row');
      for (const row of rows) {
        const text = norm(row.textContent);
        if (text.includes(normHome.split(' ')[0]) && text.includes(normAway.split(' ')[0])) {
          const a = row.closest('a') || row.querySelector('a');
          return a ? a.href : null;
        }
      }
      return null;
    }, normalize(homeTeam), normalize(awayTeam));

    if (!matchLink) return null;

    await sleep(800);

    // 3. Aller sur la page du match
    await page.goto(matchLink, { waitUntil: 'domcontentloaded' });
    await sleep(1000);

    // 4. Aller sur l'onglet Cotes si disponible
    const oddsTab = await page.$('a[href*="/odds-comparison/"]');
    if (oddsTab) {
      await oddsTab.click();
      await sleep(1200);
    }

    // 5. Extraire les cotes moyennes 1X2
    const odds = await page.evaluate(() => {
      // Chercher les valeurs numériques dans les cellules de cotes 1X2
      const cells = document.querySelectorAll(
        '.oddsCell__odd, .ui-table__row .oddsCell, [class*="odd"]:not([class*="header"]) span'
      );

      const values = [];
      for (const cell of cells) {
        const val = parseFloat(cell.textContent.trim().replace(',', '.'));
        if (!isNaN(val) && val >= 1.01 && val <= 30) {
          values.push(val);
          if (values.length === 3) break;
        }
      }

      if (values.length !== 3) return null;
      return { home: values[0], draw: values[1], away: values[2] };
    });

    if (!odds) return null;

    // 6. Convertir cotes en probabilités implicites
    const pHome = 1 / odds.home;
    const pDraw = 1 / odds.draw;
    const pAway = 1 / odds.away;
    const total = pHome + pDraw + pAway;

    const probabilities = {
      home: Math.round((pHome / total) * 100),
      draw: Math.round((pDraw / total) * 100),
      away: Math.round((pAway / total) * 100),
    };
    // Normaliser pour que ça fasse bien 100
    probabilities.away = 100 - probabilities.home - probabilities.draw;

    const result = { rawOdds: odds, probabilities, source: 'flashscore' };
    cache.set(key, result, TTL);
    return result;

  } catch (err) {
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

module.exports = { getMatchOdds };
