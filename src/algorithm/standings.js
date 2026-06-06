function analyzeStandings(standingsData, team1Id, team2Id) {
  const empty = { score1: 50, score2: 50, available: false };
  if (!standingsData || standingsData.length === 0) return empty;

  const standings = standingsData[0]?.league?.standings?.[0];
  if (!standings) return empty;

  const team1Standing = standings.find((s) => s.team.id === team1Id);
  const team2Standing = standings.find((s) => s.team.id === team2Id);
  if (!team1Standing || !team2Standing) return empty;

  const total = standings.length;

  function calcScore(standing) {
    const posScore = ((total - standing.rank + 1) / total) * 50;
    const maxPts = standing.all.played * 3 || 1;
    const ptsScore = (standing.points / maxPts) * 30;
    const maxGd = 30;
    const gdScore = (Math.min(Math.max(standing.goalsDiff + maxGd, 0), maxGd * 2) / (maxGd * 2)) * 20;
    return Math.round(posScore + ptsScore + gdScore);
  }

  return {
    score1: calcScore(team1Standing),
    score2: calcScore(team2Standing),
    available: true,
    team1: {
      rank: team1Standing.rank,
      points: team1Standing.points,
      goalsDiff: team1Standing.goalsDiff,
    },
    team2: {
      rank: team2Standing.rank,
      points: team2Standing.points,
      goalsDiff: team2Standing.goalsDiff,
    },
  };
}

module.exports = { analyzeStandings };
