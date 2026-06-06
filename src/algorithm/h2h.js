function analyzeH2H(fixtures, team1Id, team2Id) {
  if (!fixtures || fixtures.length === 0) {
    return { score1: 50, score2: 50, summary: 'Aucun historique H2H disponible' };
  }

  let team1Wins = 0, team2Wins = 0, draws = 0;
  let team1Goals = 0, team2Goals = 0;

  fixtures.forEach((fixture) => {
    const homeId = fixture.teams.home.id;
    const awayId = fixture.teams.away.id;
    const homeGoals = fixture.goals.home ?? 0;
    const awayGoals = fixture.goals.away ?? 0;

    let t1Goals, t2Goals;
    if (homeId === team1Id) {
      t1Goals = homeGoals; t2Goals = awayGoals;
    } else {
      t1Goals = awayGoals; t2Goals = homeGoals;
    }

    team1Goals += t1Goals;
    team2Goals += t2Goals;

    if (t1Goals > t2Goals) team1Wins++;
    else if (t2Goals > t1Goals) team2Wins++;
    else draws++;
  });

  const total = fixtures.length;
  const team1WinRate = team1Wins / total;
  const team2WinRate = team2Wins / total;
  const avgGoalDiff1 = (team1Goals - team2Goals) / total;

  const score1 = Math.round(
    team1WinRate * 70 +
    Math.min(Math.max(avgGoalDiff1 * 10 + 50, 0), 100) * 0.3
  );
  const score2 = Math.round(
    team2WinRate * 70 +
    Math.min(Math.max(-avgGoalDiff1 * 10 + 50, 0), 100) * 0.3
  );

  const summary = `${team1Wins}V - ${draws}N - ${team2Wins}D sur ${total} matchs`;
  return { score1, score2, summary, team1Wins, team2Wins, draws, total };
}

module.exports = { analyzeH2H };
