const POSITION_WEIGHTS = {
  Goalkeeper: 2.0,
  Defender: 1.2,
  Midfielder: 1.5,
  Attacker: 1.8,
};

function analyzeInjuries(injuriesData, team1Id, team2Id) {
  function calcImpact(teamId) {
    if (!injuriesData || injuriesData.length === 0) return { score: 75, count: 0, players: [] };

    const teamInjuries = injuriesData.filter((i) => i.team.id === teamId);
    if (teamInjuries.length === 0) return { score: 100, count: 0, players: [] };

    let totalImpact = 0;
    const players = [];
    teamInjuries.forEach((injury) => {
      const posWeight = POSITION_WEIGHTS[injury.player.type] || 1.2;
      const isSuspended = injury.player.reason?.toLowerCase().includes('suspen');
      const severity = isSuspended ? 1.5 : 1.0;
      totalImpact += posWeight * severity;
      players.push({
        name: injury.player.name || 'Inconnu',
        position: injury.player.type || '—',
        reason: injury.player.reason || '—',
        suspended: isSuspended,
      });
    });

    const penalty = Math.min(totalImpact * 8, 60);
    return { score: Math.round(100 - penalty), count: teamInjuries.length, players };
  }

  return {
    team1: calcImpact(team1Id),
    team2: calcImpact(team2Id),
  };
}

module.exports = { analyzeInjuries };
