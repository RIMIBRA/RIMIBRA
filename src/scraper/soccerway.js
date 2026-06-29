// Scraper Soccerway — forme des équipes (backup quand quota api-football épuisé)
// Retourne le même format que analyzeForm() pour s'intégrer directement dans l'algo
const { newPage } = require('./browser');
const cache = require('../cache/db');

const BASE = 'https://int.soccerway.com';
const TTL  = 6 * 3600; // 6h — données de forme peu volatiles

function cacheKey(teamName) {
  return `soccerway_form_${teamName.toLowerCase().replace(/\s+/g, '_')}`;
}

// Délai anti-ban minimal entre les requêtes Soccerway
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getTeamForm(teamName) {
  const key = cacheKey(teamName);
  const cached = cache.get(key);
  if (cached) return cached;

  let page;
  try {
    page = await newPage();

    // 1. Rechercher l'équipe
    const searchUrl = `${BASE}/search/teams/?q=${encodeURIComponent(teamName)}`;
    const resp = await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    if (!resp || resp.status() >= 400) return null;

    // 2. Extraire le premier résultat de recherche
    const teamLink = await page.evaluate(() => {
      const a = document.querySelector('ul.search-results li:first-child a, .search-results a');
      return a ? a.href : null;
    });
    if (!teamLink) return null;

    await sleep(600);

    // 3. Aller sur la page de l'équipe
    await page.goto(teamLink, { waitUntil: 'domcontentloaded' });

    // 4. Extraire les derniers matchs (tableau des résultats récents)
    const results = await page.evaluate(() => {
      const rows = [];

      // Soccerway affiche les matchs dans un tableau — on cherche les lignes de résultats
      const candidates = document.querySelectorAll(
        'table.matches tr[class*="match"], table.matches tr[data-match-id], #page_team_1_block_team_matches_5 tr'
      );

      for (const tr of candidates) {
        if (rows.length >= 5) break;

        // Score : chercher les cellules contenant un tiret (ex. "2 - 1")
        const scoreCells = tr.querySelectorAll('td');
        let score = null;
        let homeTeam = null;
        let awayTeam = null;

        for (const td of scoreCells) {
          const text = td.textContent.trim();
          // Formaat "2 - 1" ou "2-1"
          if (/^\d+\s*-\s*\d+$/.test(text)) {
            const parts = text.split(/\s*-\s*/);
            score = { home: parseInt(parts[0]), away: parseInt(parts[1]) };
          }
          // Noms d'équipes
          if (td.classList.contains('team') || td.querySelector('.team-name')) {
            const links = td.querySelectorAll('a');
            if (links.length === 1 && !homeTeam) homeTeam = links[0].textContent.trim();
            else if (links.length === 1 && homeTeam) awayTeam = links[0].textContent.trim();
          }
        }

        if (score && homeTeam && awayTeam) {
          rows.push({ homeTeam, awayTeam, homeGoals: score.home, awayGoals: score.away });
        }
      }

      return rows;
    });

    if (!results || results.length === 0) return null;

    // 5. Calculer forme (même logique que analyzeForm)
    const DECAY = [1.0, 0.9, 0.8, 0.7, 0.6];
    const normName = teamName.toLowerCase();

    let weightedPoints = 0, maxWeightedPoints = 0;
    let goalsScored = 0, goalsConceded = 0;
    const details = [];

    results.slice(0, 5).forEach((r, i) => {
      const weight = DECAY[i] || 0.5;
      // Déterminer si l'équipe cherchée joue à domicile ou extérieur
      const isHome = r.homeTeam.toLowerCase().includes(normName.split(' ')[0]) ||
                     normName.includes(r.homeTeam.toLowerCase().split(' ')[0]);
      const scored    = isHome ? r.homeGoals : r.awayGoals;
      const conceded  = isHome ? r.awayGoals : r.homeGoals;
      const opponent  = isHome ? r.awayTeam : r.homeTeam;

      goalsScored   += scored;
      goalsConceded += conceded;

      let result, points;
      if (scored > conceded)      { result = 'W'; points = 3; }
      else if (scored === conceded){ result = 'D'; points = 1; }
      else                         { result = 'L'; points = 0; }

      weightedPoints    += points * weight;
      maxWeightedPoints += 3 * weight;
      details.push({ result, scored, conceded, opponent });
    });

    const formScore = maxWeightedPoints > 0 ? (weightedPoints / maxWeightedPoints) * 80 : 40;
    const avgGoals  = goalsScored / details.length;
    const goalBonus = Math.min(avgGoals * 5, 20);
    const goalPenalty = Math.min((goalsConceded / details.length) * 3, 15);
    const score = Math.max(0, Math.min(100, Math.round(formScore + goalBonus - goalPenalty)));

    const formData = { score, details, goalsScored, goalsConceded, source: 'soccerway' };
    cache.set(key, formData, TTL);
    return formData;

  } catch (err) {
    // Soccerway bloqué ou structure changée — dégradation gracieuse
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

module.exports = { getTeamForm };
