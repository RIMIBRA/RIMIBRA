// Cotes de plusieurs bookmakers via l'API foot déjà utilisée pour les fixtures (endpoint
// /odds, api-sports.io) — liées au même id de match que le reste de l'app, donc sans le
// matching approximatif par nom d'équipe qu'il faut pour les scrapers (voir scraper/*.js).
// Jusqu'à une douzaine de bookmakers par match, dont des références reconnues pour leurs
// cotes serrées (Pinnacle, Betfair) -> consensus nettement plus robuste qu'une source unique.

// Moyenne les probabilités implicites de chaque bookmaker sur le marché "Match Winner" (id 1).
// Retire d'abord la marge (overround) de CHAQUE bookmaker avant de moyenner : ils n'ont pas
// tous la même marge, moyenner les cotes brutes sans ça biaiserait le consensus vers les
// bookmakers à plus grosse marge plutôt que de refléter une vraie probabilité de marché.
function consensusFromBookmakers(bookmakers) {
  const perBookmaker = [];
  let sampleOdds = null;

  for (const bm of bookmakers || []) {
    const bet = bm.bets?.find((b) => b.id === 1);
    if (!bet) continue;
    const home = bet.values?.find((v) => v.value === 'Home');
    const draw = bet.values?.find((v) => v.value === 'Draw');
    const away = bet.values?.find((v) => v.value === 'Away');
    if (!home || !draw || !away) continue;

    const oh = parseFloat(home.odd);
    const od = parseFloat(draw.odd);
    const oa = parseFloat(away.odd);
    if (!(oh > 1) || !(od > 1) || !(oa > 1)) continue;

    if (!sampleOdds) sampleOdds = { home: oh, draw: od, away: oa };

    const ph = 1 / oh;
    const pd = 1 / od;
    const pa = 1 / oa;
    const total = ph + pd + pa;
    perBookmaker.push({ home: ph / total, draw: pd / total, away: pa / total });
  }

  if (perBookmaker.length === 0) return null;

  const avg = (key) => perBookmaker.reduce((s, p) => s + p[key], 0) / perBookmaker.length;
  const home = Math.round(avg('home') * 100);
  const draw = Math.round(avg('draw') * 100);
  const away = 100 - home - draw;

  return {
    probabilities: { home, draw, away },
    rawOdds: sampleOdds, // un jeu de cotes brutes (le premier bookmaker exploitable) pour l'affichage
    bookmakerCount: perBookmaker.length,
    source: 'api-odds',
  };
}

// Un Map<fixtureId, résultat> pour un lookup direct par match — construit une fois par jour,
// évite tout matching approximatif par nom d'équipe pour cette source.
function buildOddsMap(oddsList) {
  const map = new Map();
  for (const entry of oddsList || []) {
    const consensus = consensusFromBookmakers(entry.bookmakers);
    if (consensus) map.set(entry.fixture.id, consensus);
  }
  return map;
}

module.exports = { buildOddsMap };
