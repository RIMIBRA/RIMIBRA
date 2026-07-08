// Rendu du détail d'un match (modale) — partagé entre l'app principale (app.js) et le
// dashboard admin (admin.js), pour éviter de dupliquer cette logique entre les deux pages.
// Chargé en <script> classique (pas de modules) : ces fonctions deviennent globales, à charger
// avant app.js / admin.js.

// Recommande l'issue la plus probable quand un résultat domine nettement, sinon une issue
// combinée (deux résultats regroupés) quand le match est incertain.
// Vocabulaire volontairement neutre/statistique (pas de "pari", "bookmaker", etc.) — conditions
// Google AdSense/AdMob sur le contenu lié aux jeux d'argent, voir la revue de conformité.
// Si le marché juge l'issue la plus probable trop évidente (cote très basse, voir
// alternativeBet côté backend), l'alternative devient directement la recommandation
// principale affichée — plus la peine de l'annoncer pour la reléguer aussitôt en dessous.
function buildBetAdvice(p) {
  const { home, draw, away } = p.probabilities;
  const max = Math.max(home, draw, away);

  if (p.alternativeBet) {
    const obvious = home === max ? p.fixture.home : away === max ? p.fixture.away : 'Match nul';
    return {
      short: p.alternativeBet.alternative.market,
      detail: `"${obvious}" jugé trop évident par le marché (cote ~${p.alternativeBet.mainPickOdd}) — alternative plus équilibrée, cote moyenne ${p.alternativeBet.alternative.odd}.`,
    };
  }

  if (max >= 50) {
    const label = home === max ? p.fixture.home
      : away === max ? p.fixture.away
      : 'Match nul';
    return { short: label, detail: `Issue dominante (${max}%) — un pronostic simple semble justifié.` };
  }

  const combinedOutcomes = [
    { code: '1X', val: home + draw, label: `${p.fixture.home} ou match nul` },
    { code: 'X2', val: draw + away, label: `Match nul ou ${p.fixture.away}` },
    { code: '12', val: home + away, label: `${p.fixture.home} ou ${p.fixture.away} (sans nul)` },
  ].sort((a, b) => b.val - a.val);
  const best = combinedOutcomes[0];

  return { short: best.label, detail: `Match incertain (issue la plus probable à ${max}%) — une issue combinée (${best.val}%) est statistiquement plus sûre qu'un pronostic tranché.` };
}

function bttsVerdict(gp) {
  if (!gp) return null;
  if (gp.btts >= 55) return { text: 'Oui, probable', cls: 'goal-yes' };
  if (gp.btts <= 40) return { text: 'Non, peu probable', cls: 'goal-no' };
  return { text: 'Incertain', cls: 'goal-item' };
}

function goalsVerdict(gp) {
  if (!gp) return null;
  if (gp.over25 >= 55) return `Match probablement riche en buts — environ 3 buts ou plus (Plus de 2,5 : ${gp.over25}%)`;
  if (gp.over15 >= 55) return `Total modéré attendu — environ 2 à 3 buts (Plus de 1,5 : ${gp.over15}%, Plus de 2,5 : ${gp.over25}%)`;
  return `Match probablement pauvre en buts — environ 0 à 2 buts (Moins de 2,5 : ${100 - gp.over25}%)`;
}

function renderFormBadges(details) {
  return details.map((d) => `<span class="form-badge ${d.result}" title="${d.opponent}: ${d.scored}-${d.conceded}">${d.result}</span>`).join('');
}

// Encart d'incitation à l'abonnement — deux instances possibles par match : prédiction de
// buts (plan premium) et détail complet (plan VIP). Voir auth/breakdownGate.js côté serveur.
function subscribeLockBox(title, description) {
  return `
    <div class="detail-section ad-lock-section">
      <h3>🔒 ${title}</h3>
      <p style="font-size:0.85rem;color:var(--muted);margin-bottom:0.75rem">${description}</p>
      <a class="ad-unlock-btn" href="/pricing.html">⭐ Voir les abonnements</a>
    </div>`;
}

function buildModalContent(p) {
  if (p.error) return `<p style="color:var(--red)">${p.error}</p>`;
  const b = p.breakdown;
  const time = new Date(p.fixture.date).toLocaleString('fr-FR');

  const barRow = (label, val) => `
    <div class="bar-row">
      <span class="bar-label">${label}</span>
      <div class="bar-track"><div class="bar-fill home" style="width:${val}%"></div></div>
      <span style="font-size:0.8rem;width:30px">${val}</span>
    </div>`;

  const formHtml = (form) => {
    if (!form || !form.details) return '<span style="color:var(--muted)">N/A</span>';
    return `<div class="form-badges">${renderFormBadges(form.details)}</div>`;
  };

  return `
    <div class="modal-title">${p.fixture.home} vs ${p.fixture.away}</div>
    <div class="modal-league">${p.fixture.league} · ${time}</div>

    <div class="detail-section">
      <h3>Probabilités</h3>
      <div class="grid-2" style="grid-template-columns:1fr 1fr 1fr">
        <div class="stat-box"><div class="label">Domicile (1)</div><div class="value" style="color:var(--green)">${p.probabilities.home}%</div></div>
        <div class="stat-box"><div class="label">Nul (X)</div><div class="value" style="color:var(--yellow)">${p.probabilities.draw}%</div></div>
        <div class="stat-box"><div class="label">Extérieur (2)</div><div class="value" style="color:var(--purple)">${p.probabilities.away}%</div></div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Recommandation statistique</h3>
      ${(() => {
        const advice = buildBetAdvice(p);
        const isAlternative = !!p.alternativeBet;
        return `
      <div class="stat-box" ${isAlternative ? 'style="border:1px solid var(--yellow)"' : ''}>
        <div class="label">${isAlternative ? '⚠️ Recommandation ajustée (issue la plus probable jugée trop évidente)' : 'Issue du match'}</div>
        <div class="value" style="color:${isAlternative ? 'var(--yellow)' : 'var(--blue)'};font-size:0.95rem">${advice.short}</div>
        <div style="font-size:0.75rem;color:var(--muted);margin-top:0.3rem">${advice.detail}</div>
      </div>`;
      })()}
      ${p.goalPrediction ? `
      <div class="grid-2" style="margin-top:0.5rem">
        <div class="stat-box">
          <div class="label">Les deux équipes marquent (BTTS) ?</div>
          <div class="value ${bttsVerdict(p.goalPrediction).cls === 'goal-yes' ? '' : ''}" style="color:${bttsVerdict(p.goalPrediction).cls === 'goal-yes' ? 'var(--green)' : bttsVerdict(p.goalPrediction).cls === 'goal-no' ? 'var(--red)' : 'var(--muted)'}">${bttsVerdict(p.goalPrediction).text}</div>
          <div style="font-size:0.75rem;color:var(--muted);margin-top:0.2rem">Probabilité estimée : ${p.goalPrediction.btts}%</div>
        </div>
        <div class="stat-box">
          <div class="label">Nombre de buts attendu</div>
          <div style="font-size:0.8rem;margin-top:0.2rem">${goalsVerdict(p.goalPrediction)}</div>
        </div>
      </div>` : ''}
    </div>

    ${p.goalPredictionLocked ? subscribeLockBox(
      'Prédiction de buts verrouillée',
      'Réservée aux abonnés Premium et VIP.'
    ) : ''}

    ${p.goalPrediction ? `
    <div class="detail-section">
      <h3>Analyse des buts</h3>
      <div class="grid-2" style="grid-template-columns:1fr 1fr 1fr 1fr">
        ${p.goalPrediction.xGHome !== null ? `
        <div class="stat-box"><div class="label">xG ${p.fixture.home.substring(0,8)}</div><div class="value" style="color:var(--blue)">${p.goalPrediction.xGHome}</div></div>
        <div class="stat-box"><div class="label">xG ${p.fixture.away.substring(0,8)}</div><div class="value" style="color:var(--blue)">${p.goalPrediction.xGAway}</div></div>
        ` : ''}
        <div class="stat-box"><div class="label">Plus de 1,5 buts</div><div class="value" style="color:${p.goalPrediction.over15 >= 60 ? 'var(--green)' : 'var(--muted)'}">${p.goalPrediction.over15}%</div></div>
        <div class="stat-box"><div class="label">Plus de 2,5 buts</div><div class="value" style="color:${p.goalPrediction.over25 >= 50 ? 'var(--green)' : 'var(--muted)'}">${p.goalPrediction.over25}%</div></div>
      </div>
      <div class="grid-2" style="margin-top:0.5rem">
        <div class="stat-box"><div class="label">Les deux marquent (BTTS)</div><div class="value" style="color:${p.goalPrediction.btts >= 50 ? 'var(--green)' : 'var(--muted)'}">${p.goalPrediction.btts}%</div></div>
        <div class="stat-box"><div class="label">Moins de 2,5 buts</div><div class="value" style="color:${(100 - p.goalPrediction.over25) >= 50 ? 'var(--green)' : 'var(--muted)'}">${100 - p.goalPrediction.over25}%</div></div>
      </div>
    </div>` : ''}

    ${p.odds ? `
    <div class="detail-section">
      <h3>Probabilités du marché</h3>
      <div class="grid-2" style="grid-template-columns:1fr 1fr 1fr">
        <div class="stat-box"><div class="label">1 (Dom)</div><div class="value" style="color:var(--green)">${p.odds.home}</div></div>
        <div class="stat-box"><div class="label">X (Nul)</div><div class="value" style="color:var(--yellow)">${p.odds.draw}</div></div>
        <div class="stat-box"><div class="label">2 (Ext)</div><div class="value" style="color:var(--purple)">${p.odds.away}</div></div>
      </div>
    </div>` : ''}

    ${p.breakdownLocked ? subscribeLockBox(
      'Analyse complète verrouillée',
      'Score algorithmique, forme récente, tête-à-tête, blessures et probabilités du marché sont réservés aux abonnés VIP.'
    ) : `
    ${!p.noApiData ? `
    <div class="detail-section">
      <h3>Score algorithmique</h3>
      ${barRow(p.fixture.home.substring(0, 8), p.scores.home)}
      ${barRow(p.fixture.away.substring(0, 8), p.scores.away)}
    </div>` : `
    <div class="detail-section">
      <h3>Score algorithmique</h3>
      <p style="font-size:0.8rem;color:var(--muted)">⚠️ Score non calculé — données API indisponibles pour ces équipes (quota épuisé ou données absentes). Seules les probabilités du marché ont été utilisées pour la prédiction.</p>
    </div>`}

    <div class="detail-section">
      <h3>Forme récente (5 derniers matchs)</h3>
      <div style="margin-bottom:0.4rem;font-size:0.8rem;color:var(--muted)">${p.fixture.home}</div>
      ${formHtml(b.form.home)}
      <div style="margin-top:0.5rem;margin-bottom:0.4rem;font-size:0.8rem;color:var(--muted)">${p.fixture.away}</div>
      ${formHtml(b.form.away)}
    </div>

    <div class="detail-section">
      <h3>Tête-à-tête</h3>
      <p style="font-size:0.85rem">${b.h2h.summary}</p>
      ${b.h2h.total > 0 ? `
        <div class="grid-2" style="margin-top:0.5rem">
          <div class="stat-box"><div class="label">Victoires ${p.fixture.home}</div><div class="value">${b.h2h.team1Wins}</div></div>
          <div class="stat-box"><div class="label">Victoires ${p.fixture.away}</div><div class="value">${b.h2h.team2Wins}</div></div>
        </div>` : ''}
    </div>

    ${b.standings.available ? `
    <div class="detail-section">
      <h3>Classement</h3>
      <div class="grid-2">
        <div class="stat-box">
          <div class="label">${p.fixture.home}</div>
          <div class="value">#${b.standings.team1.rank}</div>
          <div style="font-size:0.75rem;color:var(--muted)">${b.standings.team1.points} pts · GD ${b.standings.team1.goalsDiff > 0 ? '+' : ''}${b.standings.team1.goalsDiff}</div>
        </div>
        <div class="stat-box">
          <div class="label">${p.fixture.away}</div>
          <div class="value">#${b.standings.team2.rank}</div>
          <div style="font-size:0.75rem;color:var(--muted)">${b.standings.team2.points} pts · GD ${b.standings.team2.goalsDiff > 0 ? '+' : ''}${b.standings.team2.goalsDiff}</div>
        </div>
      </div>
    </div>` : ''}

    <div class="detail-section">
      <h3>Joueurs absents / suspendus${(b.injuries.team1.lineupConfirmed || b.injuries.team2.lineupConfirmed) ? ' <span style="font-size:0.7rem;font-weight:400;color:var(--green)">— confirmé par la composition officielle</span>' : ''}</h3>
      <div class="grid-2">
        <div class="stat-box">
          <div class="label">${p.fixture.home} — ${b.injuries.team1.count} absent(s)</div>
          ${b.injuries.team1.players?.length > 0
            ? b.injuries.team1.players.map(pl => `
              <div class="injury-row">
                <span class="injury-name">${pl.name}</span>
                <span class="injury-pos">${pl.position}</span>
                <span class="injury-reason ${pl.confirmedAvailable ? '' : (pl.suspended ? 'suspended' : 'injured')}" style="${pl.confirmedAvailable ? 'color:var(--green)' : ''}">${pl.confirmedAvailable ? '✅ Finalement disponible' : (pl.suspended ? '🟥 Suspendu' : '🤕 ' + pl.reason)}</span>
              </div>`).join('')
            : '<div style="color:var(--muted);font-size:0.8rem">Aucun absent connu</div>'}
        </div>
        <div class="stat-box">
          <div class="label">${p.fixture.away} — ${b.injuries.team2.count} absent(s)</div>
          ${b.injuries.team2.players?.length > 0
            ? b.injuries.team2.players.map(pl => `
              <div class="injury-row">
                <span class="injury-name">${pl.name}</span>
                <span class="injury-pos">${pl.position}</span>
                <span class="injury-reason ${pl.confirmedAvailable ? '' : (pl.suspended ? 'suspended' : 'injured')}" style="${pl.confirmedAvailable ? 'color:var(--green)' : ''}">${pl.confirmedAvailable ? '✅ Finalement disponible' : (pl.suspended ? '🟥 Suspendu' : '🤕 ' + pl.reason)}</span>
              </div>`).join('')
            : '<div style="color:var(--muted);font-size:0.8rem">Aucun absent connu</div>'}
        </div>
      </div>
    </div>

    ${(b.injuries.team1.lineupConfirmed || b.injuries.team2.lineupConfirmed) ? `
    <div class="detail-section">
      <h3>Composition officielle</h3>
      <div class="grid-2">
        <div class="stat-box">
          <div class="label">${p.fixture.home}${b.injuries.team1.formation ? ` (${b.injuries.team1.formation})` : ''}</div>
          ${b.injuries.team1.startXI?.length > 0
            ? `<div style="font-size:0.8rem;line-height:1.6">${b.injuries.team1.startXI.join(', ')}</div>`
            : '<div style="color:var(--muted);font-size:0.8rem">Pas encore publiée</div>'}
        </div>
        <div class="stat-box">
          <div class="label">${p.fixture.away}${b.injuries.team2.formation ? ` (${b.injuries.team2.formation})` : ''}</div>
          ${b.injuries.team2.startXI?.length > 0
            ? `<div style="font-size:0.8rem;line-height:1.6">${b.injuries.team2.startXI.join(', ')}</div>`
            : '<div style="color:var(--muted);font-size:0.8rem">Pas encore publiée</div>'}
        </div>
      </div>
    </div>` : ''}
    `}
  `;
}

function validationCard(label, predicted, actual, correct) {
  if (correct === null || correct === undefined) {
    return `<div class="stat-box"><div class="label">${label}</div><div class="value" style="color:var(--muted);font-size:0.85rem">Pas de pronostic tranché</div></div>`;
  }
  return `
    <div class="stat-box" style="border:1px solid ${correct ? 'var(--green)' : 'var(--red)'}">
      <div class="label">${label}</div>
      <div class="value" style="font-size:0.95rem">${predicted}</div>
      <div style="font-size:0.75rem;color:var(--muted);margin-top:0.2rem">Réel : ${actual}</div>
      <div style="margin-top:0.3rem;font-weight:700;color:${correct ? 'var(--green)' : 'var(--red)'}">${correct ? '✅' : '❌'}</div>
    </div>`;
}

function buildValidationContent(p) {
  const time = new Date(p.fixture.date).toLocaleString('fr-FR');
  if (!p.validation) {
    return `
      <div class="modal-title">${p.fixture.home} vs ${p.fixture.away}</div>
      <div class="modal-league">${p.fixture.league} · ${time}</div>
      <p style="margin-top:1rem;color:var(--muted)">Score final non disponible — impossible de valider la prédiction pour ce match.</p>`;
  }

  const { actualScore, actualPick, correct, btts, over25 } = p.validation;
  const correctCount = [correct, btts?.correct, over25?.correct].filter((c) => c === true).length;
  const totalCount = [correct, btts?.correct, over25?.correct].filter((c) => c !== null && c !== undefined).length;

  return `
    <div class="modal-title">${p.fixture.home} vs ${p.fixture.away}</div>
    <div class="modal-league">${p.fixture.league} · ${time}</div>

    <div class="detail-section">
      <h3>Résultat final</h3>
      <div class="stat-box"><div class="label">Score</div><div class="value">${actualScore.home} - ${actualScore.away}</div></div>
    </div>

    <div class="detail-section">
      <h3>Validation des pronostics (${correctCount}/${totalCount} validés)</h3>
      <div class="grid-2" style="grid-template-columns:1fr 1fr 1fr">
        ${validationCard('Issue (1X2)', p.recommendation.pick, actualPick, correct)}
        ${btts ? validationCard('BTTS', btts.predicted, btts.actual, btts.correct) : validationCard('BTTS', '—', '—', null)}
        ${over25 ? validationCard('+/-2,5 buts', over25.predicted, over25.actual, over25.correct) : validationCard('+/-2,5 buts', '—', '—', null)}
      </div>
    </div>

    <div class="detail-section">
      <h3>Probabilités prédites avant le match</h3>
      <div class="grid-2" style="grid-template-columns:1fr 1fr 1fr">
        <div class="stat-box"><div class="label">Dom (1)</div><div class="value">${p.probabilities.home}%</div></div>
        <div class="stat-box"><div class="label">Nul (X)</div><div class="value">${p.probabilities.draw}%</div></div>
        <div class="stat-box"><div class="label">Ext (2)</div><div class="value">${p.probabilities.away}%</div></div>
      </div>
    </div>`;
}
