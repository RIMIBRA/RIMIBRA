const { canAccessSport, canUseFeature, comboLimitFor } = require('./tiers');

describe('canAccessSport', () => {
  test('free plan can access football', () => {
    expect(canAccessSport('free', 'football')).toBe(true);
  });

  test('free plan cannot access premium sports', () => {
    expect(canAccessSport('free', 'tennis')).toBe(false);
    expect(canAccessSport('free', 'nba')).toBe(false);
  });

  test('premium plan can access all listed sports', () => {
    ['football', 'nfl', 'nba', 'hockey', 'baseball', 'handball', 'tennis'].forEach((sport) => {
      expect(canAccessSport('premium', sport)).toBe(true);
    });
  });

  test('vip plan can access everything premium can', () => {
    expect(canAccessSport('vip', 'tennis')).toBe(true);
  });

  test('unknown sport defaults to premium-required', () => {
    expect(canAccessSport('free', 'curling')).toBe(false);
    expect(canAccessSport('premium', 'curling')).toBe(true);
  });
});

describe('canUseFeature', () => {
  test('search requires premium', () => {
    expect(canUseFeature('free', 'search')).toBe(false);
    expect(canUseFeature('premium', 'search')).toBe(true);
  });

  test('fullBreakdown requires premium (free must unlock via ad, see breakdownGate.js)', () => {
    expect(canUseFeature('free', 'fullBreakdown')).toBe(false);
    expect(canUseFeature('premium', 'fullBreakdown')).toBe(true);
    expect(canUseFeature('vip', 'fullBreakdown')).toBe(true);
  });
});

describe('comboLimitFor', () => {
  test('free plan gets zero combos', () => {
    expect(comboLimitFor('free', false)).toBe(0);
  });

  test('premium plan capped at 3', () => {
    expect(comboLimitFor('premium', false)).toBe(3);
  });

  test('vip plan is unlimited', () => {
    expect(comboLimitFor('vip', false)).toBe(Infinity);
  });

  test('admin always unlimited regardless of plan', () => {
    expect(comboLimitFor('free', true)).toBe(Infinity);
  });
});
