const POSITION_WEIGHTS = {
  Goalkeeper: 2.0,
  Defender: 1.2,
  Midfielder: 1.5,
  Attacker: 1.8,
};

function analyzeInjuries(injuriesData, team1Id, team2Id) {
  function calcImpact(teamId) {
    // injuriesData totalement vide = échec/absence du rapport blessures (pas "équipe au
    // complet confirmée") -> marqué unknown pour ne pas être pris à tort pour une info sûre
    // par refineWithLineups plus bas
    if (!injuriesData || injuriesData.length === 0) return { score: 75, count: 0, players: [], unknown: true };

    const teamInjuries = injuriesData.filter((i) => i.team.id === teamId);
    if (teamInjuries.length === 0) return { score: 100, count: 0, players: [] };

    let totalImpact = 0;
    const players = [];
    teamInjuries.forEach((injury) => {
      const posWeight = POSITION_WEIGHTS[injury.player.type] || 1.2;
      const isSuspended = injury.player.reason?.toLowerCase().includes('suspen');
      const severity = isSuspended ? 1.5 : 1.0;
      const impact = posWeight * severity;
      totalImpact += impact;
      players.push({
        id: injury.player.id,
        name: injury.player.name || 'Inconnu',
        position: injury.player.type || '—',
        reason: injury.player.reason || '—',
        suspended: isSuspended,
        impact,
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

// Corrige le rapport blessures/suspensions (parfois incertain ou déjà obsolète le jour du
// match) avec la composition officiellement soumise par les clubs — seule source réellement
// fiable de qui joue vraiment. Un joueur listé "doute" qui apparaît quand même dans le groupe
// (titulaire ou remplaçant) est retiré de la pénalité ; disponible uniquement dans la fenêtre
// où le fournisseur publie les compositions (~20-75 min avant le coup d'envoi, voir
// api/client.js getLineups) — lineupsData est null en dehors de cette fenêtre.
function refineWithLineups(injuriesResult, lineupsData, team1Id, team2Id) {
  if (!lineupsData || lineupsData.length === 0) return injuriesResult;

  function refineTeam(teamResult, teamId) {
    // Pas de rapport blessures exploitable au départ -> la composition seule ne permet pas
    // de conclure "équipe au complet", on ne fait que l'exposer pour affichage
    if (teamResult.unknown) {
      const teamLineup = lineupsData.find((l) => l.team.id === teamId);
      return teamLineup
        ? { ...teamResult, lineupConfirmed: true, formation: teamLineup.formation, startXI: (teamLineup.startXI || []).map((p) => p.player.name) }
        : teamResult;
    }

    const teamLineup = lineupsData.find((l) => l.team.id === teamId);
    if (!teamLineup) return teamResult; // composition pas encore publiée pour cette équipe

    const squadIds = new Set([
      ...(teamLineup.startXI || []).map((p) => p.player.id),
      ...(teamLineup.substitutes || []).map((p) => p.player.id),
    ]);

    const players = teamResult.players.map((p) => ({ ...p, confirmedAvailable: squadIds.has(p.id) }));
    const remainingImpact = players.reduce((sum, p) => sum + (p.confirmedAvailable ? 0 : p.impact), 0);
    const penalty = Math.min(remainingImpact * 8, 60);

    return {
      score: Math.round(100 - penalty),
      count: players.filter((p) => !p.confirmedAvailable).length,
      players,
      lineupConfirmed: true,
      formation: teamLineup.formation,
      startXI: (teamLineup.startXI || []).map((p) => p.player.name),
    };
  }

  return {
    team1: refineTeam(injuriesResult.team1, team1Id),
    team2: refineTeam(injuriesResult.team2, team2Id),
  };
}

module.exports = { analyzeInjuries, refineWithLineups };
