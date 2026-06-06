const besoccer = require('../scraper/besoccer');
const { get1xbetOdds } = require('../scraper/odds');

const MAX_WEB = 15;

function hashId(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return Math.abs(h);
}

function blendSources(sources) {
  const valid = sources.filter(Boolean);
  if (valid.length === 0) return { home: 40, draw: 27, away: 33 };

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
    : maxP >= 47 ? 'Moyenne'
    : 'Faible';

  return { pick, confidence };
}

async function analyzeWebMatch(homeTeam, awayTeam, fpredProbs) {
  const [bscData, oddsData] = await Promise.allSettled([
    besoccer.getMatchData(homeTeam, awayTeam),
    get1xbetOdds(homeTeam, awayTeam),
  ]).then((r) => r.map((x) => (x.status === 'fulfilled' ? x.value : null)));

  const sources = [];
  const webSources = { footballpred: false, besoccer: false, '1xbet': false };

  // footballpred en premier — source de référence
  if (fpredProbs) { sources.push(fpredProbs); webSources.footballpred = true; }
  if (bscData?.probabilities) { sources.push(bscData.probabilities); webSources.besoccer = true; }
  if (oddsData) { sources.push(oddsData); webSources['1xbet'] = true; }

  const probs = blendSources(sources);
  const rec = getRecommendation(probs, sources.length);

  return {
    fixture: {
      id: hashId(homeTeam + awayTeam),
      date: new Date().toISOString(),
      league: 'Source: Web (sans API)',
      home: homeTeam,
      away: awayTeam,
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
        home: { score: 50, details: bscData?.homeForm?.map((r) => ({ result: r })) || [] },
        away: { score: 50, details: bscData?.awayForm?.map((r) => ({ result: r })) || [] },
      },
      h2h: { score1: 50, score2: 50, summary: 'Données via scraping uniquement', total: 0 },
      standings: { available: false, score1: 50, score2: 50 },
      injuries: { team1: { score: 75, count: 0 }, team2: { score: 75, count: 0 } },
    },
  };
}

async function analyzeWebDay(fpredList) {
  if (!fpredList || fpredList.length === 0) {
    return { results: [], total: 0, analyzed: 0, webMode: true };
  }

  const results = [];
  for (const match of fpredList.slice(0, MAX_WEB)) {
    try {
      const analysis = await analyzeWebMatch(match.home, match.away, match.probabilities);
      results.push(analysis);
    } catch {
      // ignorer les matchs en échec
    }
  }

  results.sort((a, b) => {
    const maxA = Math.max(a.probabilities.home, a.probabilities.away);
    const maxB = Math.max(b.probabilities.home, b.probabilities.away);
    return maxB - maxA;
  });

  return { results, total: fpredList.length, analyzed: results.length, webMode: true };
}

module.exports = { analyzeWebDay };
