const { matchStateFor, computeValidation, isLikelyMinor } = require('./predictor');

describe('matchStateFor', () => {
  test('finished status codes are always "finished"', () => {
    expect(matchStateFor('FT', new Date().toISOString())).toBe('finished');
    expect(matchStateFor('AET', new Date().toISOString())).toBe('finished');
  });

  test('live status codes are "live"', () => {
    expect(matchStateFor('1H', new Date().toISOString())).toBe('live');
    expect(matchStateFor('HT', new Date().toISOString())).toBe('live');
  });

  test('an "NS" match well in the future is "upcoming"', () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    expect(matchStateFor('NS', future)).toBe('upcoming');
  });

  test('a stale "NS" match (kickoff hours ago, provider never updated) is treated as finished', () => {
    const fourHoursAgo = new Date(Date.now() - 4 * 3600000).toISOString();
    expect(matchStateFor('NS', fourHoursAgo)).toBe('finished');
  });

  test('an "NS" match just past kickoff (under the stale threshold) is still upcoming', () => {
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    expect(matchStateFor('NS', oneHourAgo)).toBe('upcoming');
  });

  test('without a kickoff date, defaults to upcoming', () => {
    expect(matchStateFor('NS', null)).toBe('upcoming');
  });
});

describe('computeValidation', () => {
  test('returns null when scores are missing', () => {
    expect(computeValidation('1 (Domicile)', null, null, null)).toBeNull();
  });

  test('detects a correct home-win pick', () => {
    const result = computeValidation('1 (Domicile)', 2, 0, null);
    expect(result.actualPick).toBe('1 (Domicile)');
    expect(result.correct).toBe(true);
  });

  test('detects an incorrect pick', () => {
    const result = computeValidation('1 (Domicile)', 0, 2, null);
    expect(result.actualPick).toBe('2 (Extérieur)');
    expect(result.correct).toBe(false);
  });

  test('detects a draw', () => {
    const result = computeValidation('X (Nul)', 1, 1, null);
    expect(result.actualPick).toBe('X (Nul)');
    expect(result.correct).toBe(true);
  });

  test('validates BTTS and over 2.5 when a goal prediction was made', () => {
    const result = computeValidation('1 (Domicile)', 2, 1, { btts: 70, over25: 70 });
    expect(result.btts).toEqual({ predicted: 'Oui', actual: 'Oui', correct: true });
    expect(result.over25).toEqual({ predicted: 'Plus de 2,5', actual: 'Plus de 2,5', correct: true });
  });

  test('BTTS is left unvalidated ("correct: null" via null object) when the prediction was not decisive', () => {
    const result = computeValidation('1 (Domicile)', 2, 0, { btts: 48, over25: 70 });
    expect(result.btts).toBeNull();
  });

  test('flags a wrong over/under call', () => {
    const result = computeValidation('1 (Domicile)', 1, 0, { btts: 70, over25: 70 });
    expect(result.over25.correct).toBe(false); // 1 but de moins de 2,5 alors que +2,5 était prédit
  });
});

describe('isLikelyMinor', () => {
  const fixture = (league, home, away) => ({
    league: { name: league },
    teams: { home: { name: home }, away: { name: away } },
  });

  test('flags U19/U21-style youth leagues', () => {
    expect(isLikelyMinor(fixture('Premier League U19', 'Team A', 'Team B'))).toBe(true);
  });

  test('flags reserve teams', () => {
    expect(isLikelyMinor(fixture('League', 'Team A Reserves', 'Team B'))).toBe(true);
  });

  test('flags "II" reserve-squad naming', () => {
    expect(isLikelyMinor(fixture('League', 'Bayern Munich II', 'Team B'))).toBe(true);
  });

  test('does not flag a normal top-flight match', () => {
    expect(isLikelyMinor(fixture('Premier League', 'Arsenal', 'Chelsea'))).toBe(false);
  });
});
