const { pickProbability, isComboCandidate, buildComboMatches, summarize, addDays, hasMediaCoverage, footballComboRank } = require('./combos');

function fakePrediction({
  id, pick, home = 60, draw = 20, away = 20, finished = false, error = false, insufficientData = false,
  leagueId, btts, h2hBttsRate, webSources,
}) {
  return {
    fixture: { id, leagueId },
    recommendation: { pick, confidence: 'Moyenne' },
    probabilities: { home, draw, away },
    matchState: finished ? 'finished' : 'upcoming',
    error,
    insufficientData,
    goalPrediction: btts != null ? { btts } : undefined,
    breakdown: h2hBttsRate != null ? { h2h: { bttsRate: h2hBttsRate } } : undefined,
    webSources,
  };
}

describe('pickProbability', () => {
  test('returns home probability when pick is "1 (Domicile)"', () => {
    expect(pickProbability(fakePrediction({ id: 1, pick: '1 (Domicile)', home: 70 }))).toBe(70);
  });

  test('returns away probability when pick is "2 (Extérieur)"', () => {
    expect(pickProbability(fakePrediction({ id: 1, pick: '2 (Extérieur)', away: 55 }))).toBe(55);
  });

  test('returns draw probability otherwise', () => {
    expect(pickProbability(fakePrediction({ id: 1, pick: 'X (Nul)', draw: 33 }))).toBe(33);
  });
});

describe('isComboCandidate', () => {
  test('rejects predictions with errors', () => {
    const p = fakePrediction({ id: 1, pick: '1 (Domicile)', error: true });
    expect(isComboCandidate(p, new Set())).toBe(false);
  });

  test('rejects predictions with insufficient data', () => {
    const p = fakePrediction({ id: 1, pick: '1 (Domicile)', insufficientData: true });
    expect(isComboCandidate(p, new Set())).toBe(false);
  });

  test('rejects already-finished matches', () => {
    const p = fakePrediction({ id: 1, pick: '1 (Domicile)', finished: true });
    expect(isComboCandidate(p, new Set())).toBe(false);
  });

  test('rejects fixtures already used in a previous combo', () => {
    const p = fakePrediction({ id: 42, pick: '1 (Domicile)' });
    expect(isComboCandidate(p, new Set(['42']))).toBe(false);
  });

  test('accepts a clean, unused, upcoming prediction', () => {
    const p = fakePrediction({ id: 1, pick: '1 (Domicile)' });
    expect(isComboCandidate(p, new Set())).toBe(true);
  });

  test('rejects a prediction outside the requested league filter', () => {
    const p = fakePrediction({ id: 1, pick: '1 (Domicile)', leagueId: 39 }); // Premier League
    expect(isComboCandidate(p, new Set(), new Set([1, 71, 667]))).toBe(false);
  });

  test('accepts a prediction matching the requested league filter', () => {
    const p = fakePrediction({ id: 1, pick: '1 (Domicile)', leagueId: 71 }); // Brasileirão
    expect(isComboCandidate(p, new Set(), new Set([1, 71, 667]))).toBe(true);
  });
});

describe('buildComboMatches', () => {
  test('returns null when fewer than 2 valid candidates exist', () => {
    const predictions = [fakePrediction({ id: 1, pick: '1 (Domicile)', home: 80 })];
    expect(buildComboMatches(predictions, new Set())).toBeNull();
  });

  test('picks the two highest-probability candidates', () => {
    const predictions = [
      fakePrediction({ id: 1, pick: '1 (Domicile)', home: 50 }),
      fakePrediction({ id: 2, pick: '1 (Domicile)', home: 90 }),
      fakePrediction({ id: 3, pick: '1 (Domicile)', home: 80 }),
    ];
    const result = buildComboMatches(predictions, new Set());
    expect(result.matches.map((m) => m.fixtureId)).toEqual([2, 3]);
  });

  test('combined probability is the product of the two picks', () => {
    const predictions = [
      fakePrediction({ id: 1, pick: '1 (Domicile)', home: 80 }),
      fakePrediction({ id: 2, pick: '2 (Extérieur)', away: 80 }),
    ];
    const result = buildComboMatches(predictions, new Set());
    expect(result.combinedProbability).toBe(64); // 0.8 * 0.8 = 0.64 -> 64%
  });

  test('classifies risk from the combined probability', () => {
    const low = buildComboMatches([
      fakePrediction({ id: 1, pick: '1 (Domicile)', home: 90 }),
      fakePrediction({ id: 2, pick: '1 (Domicile)', home: 90 }),
    ], new Set());
    expect(low.risk).toBe('Faible'); // 81% -> >= 70

    const mid = buildComboMatches([
      fakePrediction({ id: 1, pick: '1 (Domicile)', home: 75 }),
      fakePrediction({ id: 2, pick: '1 (Domicile)', home: 75 }),
    ], new Set());
    expect(mid.risk).toBe('Moyenne'); // 56% -> entre 50 et 70
  });

  test('eliminates the combo entirely when combined probability is below 50% (quality bar for paying tiers)', () => {
    const result = buildComboMatches([
      fakePrediction({ id: 1, pick: '1 (Domicile)', home: 30 }),
      fakePrediction({ id: 2, pick: '1 (Domicile)', home: 30 }),
    ], new Set());
    expect(result).toBeNull(); // 9% -> bien en dessous de 50%, aucun repli sur une paire moins bonne
  });

  test('excludes fixtures already used in a previous combo', () => {
    const predictions = [
      fakePrediction({ id: 1, pick: '1 (Domicile)', home: 95 }),
      fakePrediction({ id: 2, pick: '1 (Domicile)', home: 80 }),
      fakePrediction({ id: 3, pick: '1 (Domicile)', home: 75 }),
    ];
    const result = buildComboMatches(predictions, new Set(['1']));
    expect(result.matches.map((m) => m.fixtureId)).toEqual([2, 3]);
  });

  test('with a league filter, ignores higher-probability matches outside that league', () => {
    const predictions = [
      fakePrediction({ id: 1, pick: '1 (Domicile)', home: 95, leagueId: 39 }), // Premier League, meilleure cote mais hors filtre
      fakePrediction({ id: 2, pick: '1 (Domicile)', home: 80, leagueId: 1 }),   // Coupe du Monde
      fakePrediction({ id: 3, pick: '1 (Domicile)', home: 70, leagueId: 71 }), // Brasileirão
    ];
    const result = buildComboMatches(predictions, new Set(), new Set([1, 71, 667]));
    expect(result.matches.map((m) => m.fixtureId)).toEqual([2, 3]);
  });

  test('with a league filter, mixes matches from several allowed leagues', () => {
    const predictions = [
      fakePrediction({ id: 1, pick: '1 (Domicile)', home: 85, leagueId: 667 }), // Amicaux de clubs
      fakePrediction({ id: 2, pick: '1 (Domicile)', home: 80, leagueId: 71 }),  // Brasileirão
    ];
    const result = buildComboMatches(predictions, new Set(), new Set([1, 71, 667]));
    expect(result.matches.map((m) => m.fixtureId)).toEqual([1, 2]);
  });

  test('with a league filter, returns null instead of falling back to other leagues', () => {
    const predictions = [
      fakePrediction({ id: 1, pick: '1 (Domicile)', home: 95, leagueId: 39 }),
      fakePrediction({ id: 2, pick: '1 (Domicile)', home: 80, leagueId: 1 }), // un seul match dans les ligues autorisées -> pas assez
    ];
    expect(buildComboMatches(predictions, new Set(), new Set([1, 71, 667]))).toBeNull();
  });

  test('with a custom rankFn, orders candidates by that score instead of pick probability', () => {
    const predictions = [
      fakePrediction({ id: 1, pick: '1 (Domicile)', home: 95 }), // meilleure proba 1X2 mais rank basse
      fakePrediction({ id: 2, pick: '1 (Domicile)', home: 70 }),
      fakePrediction({ id: 3, pick: '1 (Domicile)', home: 75 }),
    ];
    const rankFn = (p) => (p.fixture.id === 1 ? 0 : p.fixture.id === 2 ? 100 : 90);
    const result = buildComboMatches(predictions, new Set(), undefined, rankFn);
    expect(result.matches.map((m) => m.fixtureId)).toEqual([2, 3]);
    // la probabilité affichée reste bien celle du pick 1X2, pas la valeur du rankFn
    expect(result.matches.map((m) => m.probability)).toEqual([70, 75]);
  });
});

describe('hasMediaCoverage', () => {
  test('false when no web source flag is set', () => {
    expect(hasMediaCoverage(fakePrediction({ id: 1, pick: '1 (Domicile)' }))).toBe(false);
  });

  test('true when at least one web source is present', () => {
    const p = fakePrediction({ id: 1, pick: '1 (Domicile)', webSources: { oddsapi: true } });
    expect(hasMediaCoverage(p)).toBe(true);
  });
});

describe('footballComboRank', () => {
  test('favors high BTTS + high H2H BTTS over a bare pick-probability edge', () => {
    const highBtts = fakePrediction({ id: 1, pick: '1 (Domicile)', home: 55, btts: 80, h2hBttsRate: 80 });
    const lowBtts = fakePrediction({ id: 2, pick: '1 (Domicile)', home: 70, btts: 20, h2hBttsRate: 10 });
    expect(footballComboRank(highBtts)).toBeGreaterThan(footballComboRank(lowBtts));
  });

  test('falls back to weighting BTTS + pick probability when no H2H history exists', () => {
    const p = fakePrediction({ id: 1, pick: '1 (Domicile)', home: 60, btts: 70 });
    expect(footballComboRank(p)).toBeCloseTo(70 * 0.7 + 60 * 0.3, 5);
  });

  test('gives club friendlies a bonus only when media-covered (proxy for a big club)', () => {
    const covered = fakePrediction({ id: 1, pick: '1 (Domicile)', home: 60, btts: 50, leagueId: 667, webSources: { forebet: true } });
    const uncovered = fakePrediction({ id: 2, pick: '1 (Domicile)', home: 60, btts: 50, leagueId: 667 });
    expect(footballComboRank(covered)).toBe(footballComboRank(uncovered) + 10);
  });

  test('does not apply the friendly bonus outside league 667', () => {
    const p = fakePrediction({ id: 1, pick: '1 (Domicile)', home: 60, btts: 50, leagueId: 1, webSources: { forebet: true } });
    expect(footballComboRank(p)).toBeCloseTo(50 * 0.7 + 60 * 0.3, 5);
  });
});

describe('summarize', () => {
  test('status is active when not all matches are finished', () => {
    const matches = [{ finished: true, validated: true }, { finished: false, validated: null }];
    expect(summarize(matches).status).toBe('active');
  });

  test('status is won when all matches finished and validated', () => {
    const matches = [{ finished: true, validated: true }, { finished: true, validated: true }];
    expect(summarize(matches).status).toBe('won');
  });

  test('status is lost when all finished but at least one failed', () => {
    const matches = [{ finished: true, validated: true }, { finished: true, validated: false }];
    expect(summarize(matches).status).toBe('lost');
  });

  test('counts validated and finished matches correctly', () => {
    const matches = [
      { finished: true, validated: true },
      { finished: true, validated: false },
      { finished: false, validated: null },
    ];
    const result = summarize(matches);
    expect(result.validatedCount).toBe(1);
    expect(result.finishedCount).toBe(2);
    expect(result.totalCount).toBe(3);
  });
});

describe('addDays', () => {
  test('adds days within the same month', () => {
    expect(addDays('2026-06-10', 2)).toBe('2026-06-12');
  });

  test('rolls over to the next month', () => {
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01');
  });

  test('rolls over to the next year', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
