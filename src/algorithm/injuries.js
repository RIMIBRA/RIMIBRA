const POSITION_WEIGHTS = {
  Goalkeeper: 2.0,
  Defender: 1.2,
  Midfielder: 1.5,
  Attacker: 1.8,
};

function analyzeInjuries(injuriesData, team1Id, team2Id) {
  function calcImpact(teamId) {
    if (!injuriesData || injuriesData.length === 0) return { score: 75, count: 0 };

    const teamInjuries = injuriesData.filter((i) => i.team.id === teamId);
    if (teamInjuries.length === 0) return { score: 100, count: 0 };

    let totalImpact = 0;
    teamInjuries.forEach((injury) => {
      const posWeight = POSITION_WEIGHTS[injury.player.type] || 1.2;
      const severity = injury.player.reason?.toLowerCase().includes('suspen') ? 1.5 : 1.0;
      totalImpact += posWeight * severity;
    });

    const penalty = Math.min(totalImpact * 8, 60);
    return { score: Math.round(100 - penalty), count: teamInjuries.length };
  }

  return {
    team1: calcImpact(team1Id),
    team2: calcImpact(team2Id),
  };
}

module.exports = { analyzeInjuries };
