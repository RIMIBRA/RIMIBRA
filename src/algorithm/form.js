const DECAY = [1.0, 0.9, 0.8, 0.7, 0.6];

function analyzeForm(fixtures, teamId) {
  if (!fixtures || fixtures.length === 0) return { score: 50, details: [] };

  const details = [];
  let weightedPoints = 0;
  let maxWeightedPoints = 0;
  let goalsScored = 0;
  let goalsConceded = 0;

  const recent = fixtures.slice(0, 5);

  recent.forEach((fixture, index) => {
    const weight = DECAY[index] || 0.5;
    const isHome = fixture.teams.home.id === teamId;
    const homeGoals = fixture.goals.home ?? 0;
    const awayGoals = fixture.goals.away ?? 0;

    const scored = isHome ? homeGoals : awayGoals;
    const conceded = isHome ? awayGoals : homeGoals;
    goalsScored += scored;
    goalsConceded += conceded;

    let result, points;
    if (scored > conceded) { result = 'W'; points = 3; }
    else if (scored === conceded) { result = 'D'; points = 1; }
    else { result = 'L'; points = 0; }

    weightedPoints += points * weight;
    maxWeightedPoints += 3 * weight;

    const opponent = isHome ? fixture.teams.away.name : fixture.teams.home.name;
    details.push({ result, scored, conceded, opponent });
  });

  const formScore = maxWeightedPoints > 0
    ? (weightedPoints / maxWeightedPoints) * 80
    : 40;

  const avgGoals = goalsScored / recent.length;
  const goalBonus = Math.min(avgGoals * 5, 20);
  const goalPenalty = Math.min((goalsConceded / recent.length) * 3, 15);

  const score = Math.max(0, Math.min(100, formScore + goalBonus - goalPenalty));
  return { score: Math.round(score), details, goalsScored, goalsConceded };
}

module.exports = { analyzeForm };
