const besoccer = require('../scraper/besoccer');
const { get1xbetOdds } = require('../scraper/odds');
const footballpred = require('../scraper/footballpred');
const forebet = require('../scraper/forebet');

const MAX_WEB = 15;

function hashId(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return Math.abs(h);
}

function blendSources(sources) {
  const valid = sources.filter(Boolean);
  if (valid.length === 0) return null; // null = pas de données web
  const h = Math.round(valid.reduce((s, p) => s + p.home, 0) / valid.length);
  const d = Math.round(valid.reduce((s, p) => s + p.draw, 0) / valid.length);
  const a = 100 - h - d;
  return { home: h, draw: d, away: Math.max(0, a) };
}

function getRecommendation(probs, sourceCount) {
  let pick;
  if (probs.home >= probs.away && probs.home >= probs.draw) pick = '1 (Domicile)';
  else if (probs.away >= probs.home && probs.away >= probs.draw) pick = '2 (Extérieur)';
  else pick = 'X (Nul)';

  const maxP = Math.max(probs.home, probs.draw, probs.away);
  const confidence = maxP >= 58 && sourceCount >= 2 ? 'Élevée'
    : maxP >= 47 && sourceCount >= 1 ? 'Moyenne'
    : 'Faible';

  return { pick, confidence };
}

async function buildWebPrediction(homeTeam, awayTeam, fpredList, forebetList) {
  const fpredMatch = footballpred.findPrediction(fpredList, homeTeam, awayTeam);
  const forebetMatch = forebet.findPrediction(forebetList, homeTeam, awayTeam);

  const [bscData, oddsData] = await Promise.allSettled([
    besoccer.getMatchData(homeTeam, awayTeam),
    get1xbetOdds(homeTeam, awayTeam),
  ]).then((r) => r.map((x) => (x.status === 'fulfilled' ? x.value : null)));

  const sources = [];
  const webSources = { footballpred: false, forebet: false, besoccer: false, '1xbet': false };

  if (fpredMatch?.probabilities)   { sources.push(fpredMatch.probabilities);  webSources.footballpred = true; }
  if (forebetMatch?.probabilities) { sources.push(forebetMatch.probabilities); webSources.forebet = true; }
  if (bscData?.probabilities)      { sources.push(bscData.probabilities);      webSources.besoccer = true; }
  if (oddsData)                    { sources.push(oddsData);                   webSources['1xbet'] = true; }

  return { sources, webSources, bscData, oddsData };
}

// Mode web avec fixtures de l'API (logos, heures) mais prédictions web
async function analyzeWebDayWithFixtures(fixtures, fpredList, forebetList) {
  // Charger forebet si pas encore fait
  const fbList = forebetList || await forebet.getTodayPredictions(new Date().toISOString().split('T')[0]);

  const results = [];
  for (const fixture of fixtures.slice(0, MAX_WEB)) {
    const home = fixture.teams.home.name;
    const away = fixture.teams.away.name;

    try {
      const { sources, webSources, bscData, oddsData } = await buildWebPrediction(home, away, fpredList, fbList);
      const probs = blendSources(sources) || { home: 39, draw: 27, away: 34 };
      const rec = getRecommendation(probs, sources.length);

      results.push({
        fixture: {
          id: fixture.fixture.id,
          date: fixture.fixture.date,
          league: `${fixture.league.name} — ${fixture.league.country}`,
          home,
          away,
          homeLogo: fixture.teams.home.logo,
          awayLogo: fixture.teams.away.logo,
        },
        scores: { home: 50, away: 50 },
        probabilities: probs,
        recommendation: rec,
        noApiData: true,
        webMode: true,
        webSources,
        odds: oddsData?.rawOdds || null,
        breakdown: {
          form: {
            home: { score: 50, details: bscData?.homeForm?.map((r) => ({ result: r })) || [] },
            away: { score: 50, details: bscData?.awayForm?.map((r) => ({ result: r })) || [] },
          },
          h2h: { score1: 50, score2: 50, summary: 'Mode web — sans données API', total: 0 },
          standings: { available: false, score1: 50, score2: 50 },
          injuries: { team1: { score: 75, count: 0 }, team2: { score: 75, count: 0 } },
        },
      });
    } catch { /* ignorer */ }
  }

  results.sort((a, b) => {
    const aHasWeb = Object.values(a.webSources).some(Boolean);
    const bHasWeb = Object.values(b.webSources).some(Boolean);
    if (aHasWeb && !bHasWeb) return -1;
    if (!aHasWeb && bHasWeb) return 1;
    return Math.max(b.probabilities.home, b.probabilities.away) - Math.max(a.probabilities.home, a.probabilities.away);
  });

  return { results, total: fixtures.length, analyzed: results.length, webMode: true };
}

// Mode web pur : liste de matchs depuis fpred/forebet
async function analyzeWebDay(fpredList) {
  const date = new Date().toISOString().split('T')[0];
  const forebetList = await forebet.getTodayPredictions(date);

  const matchList = fpredList?.length > 0 ? fpredList : forebetList;
  if (!matchList || matchList.length === 0) {
    return { results: [], total: 0, analyzed: 0, webMode: true };
  }

  const results = [];
  for (const match of matchList.slice(0, MAX_WEB)) {
    try {
      const { sources, webSources, bscData, oddsData } = await buildWebPrediction(
        match.home, match.away, fpredList, forebetList
      );
      const probs = blendSources(sources) || { home: 39, draw: 27, away: 34 };
      const rec = getRecommendation(probs, sources.length);

      results.push({
        fixture: {
          id: hashId(match.home + match.away),
          date: new Date().toISOString(),
          league: 'Source: Web',
          home: match.home,
          away: match.away,
          homeLogo: null,
          awayLogo: null,
        },
        scores: { home: 50, away: 50 },
        probabilities: probs,
        recommendation: rec,
        noApiData: true,
        webMode: true,
        webSources,
        odds: oddsData?.rawOdds || null,
        breakdown: {
          form: {
            home: { score: 50, details: [] },
            away: { score: 50, details: [] },
          },
          h2h: { score1: 50, score2: 50, summary: 'Mode web pur', total: 0 },
          standings: { available: false, score1: 50, score2: 50 },
          injuries: { team1: { score: 75, count: 0 }, team2: { score: 75, count: 0 } },
        },
      });
    } catch { /* ignorer */ }
  }

  results.sort((a, b) =>
    Math.max(b.probabilities.home, b.probabilities.away) - Math.max(a.probabilities.home, a.probabilities.away)
  );

  return { results, total: matchList.length, analyzed: results.length, webMode: true };
}

module.exports = { analyzeWebDay, analyzeWebDayWithFixtures };
