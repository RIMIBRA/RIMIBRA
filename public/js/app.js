const datePicker = document.getElementById('date-picker');
const btnLoad = document.getElementById('btn-load');
const loading = document.getElementById('loading');
const errorBox = document.getElementById('error-box');
const grid = document.getElementById('predictions-grid');
const modal = document.getElementById('modal');
const modalContent = document.getElementById('modal-content');
const modalClose = document.getElementById('modal-close');
const modalBackdrop = document.getElementById('modal-backdrop');
const topFilters = document.getElementById('top-filters');

const today = new Date().toISOString().split('T')[0];
datePicker.value = today;

let activeTopN = 0; // 0 = tous

function rankScore(p) {
  if (p.error) return -1;
  const confScore = p.recommendation?.confidence === 'Élevée' ? 200
    : p.recommendation?.confidence === 'Moyenne' ? 100 : 0;
  const maxProb = Math.max(p.probabilities?.home ?? 0, p.probabilities?.draw ?? 0, p.probabilities?.away ?? 0);
  return confScore + maxProb;
}

function getTopPredictions(predictions, n) {
  const sorted = [...predictions].sort((a, b) => rankScore(b) - rankScore(a));
  return n > 0 ? sorted.slice(0, n) : sorted;
}

function probClass(v) {
  if (v >= 50) return 'high';
  if (v >= 35) return 'medium';
  return 'low';
}

function renderFormBadges(details) {
  return details.map((d) => `<span class="form-badge ${d.result}" title="${d.opponent}: ${d.scored}-${d.conceded}">${d.result}</span>`).join('');
}

function buildCard(p) {
  if (p.error) {
    return `
      <div class="card has-error">
        <div class="card-league">${p.fixture.league}</div>
        <div class="card-teams">
          <div class="team"><div class="team-name">${p.fixture.home}</div></div>
          <div class="vs">vs</div>
          <div class="team"><div class="team-name">${p.fixture.away}</div></div>
        </div>
        <div style="font-size:0.78rem;color:var(--red)">Erreur: ${p.error}</div>
      </div>`;
  }

  const prob = p.probabilities;
  const rec = p.recommendation;
  const confClass = rec.confidence === 'Élevée' ? 'confidence-high' : rec.confidence === 'Moyenne' ? 'confidence-medium' : 'confidence-low';
  const time = new Date(p.fixture.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const webBadges = [
    p.webSources?.footballpred ? '<span class="web-badge">FPred</span>' : '',
    p.webSources?.forebet      ? '<span class="web-badge">Forebet</span>' : '',
    p.webSources?.besoccer     ? '<span class="web-badge">BeSoccer</span>' : '',
    p.webSources?.oddsapi      ? '<span class="web-badge odds-badge">OddsAPI</span>' : '',
  ].filter(Boolean).join('');
  const modeBadge = p.webMode ? '<span class="no-data-badge">Mode Web</span>' : '';
  const noDataBadge = !p.webMode && p.noApiData ? '<span class="no-data-badge">Données API limitées</span>' : '';

  return `
    <div class="card ${confClass}" data-id="${p.fixture.id}">
      <div class="card-league">${p.fixture.league} · ${time} ${webBadges}${modeBadge}${noDataBadge}</div>
      <div class="card-teams">
        <div class="team">
          ${p.fixture.homeLogo ? `<img src="${p.fixture.homeLogo}" alt="${p.fixture.home}" onerror="this.style.display='none'">` : ''}
          <div class="team-name">${p.fixture.home}</div>
        </div>
        <div class="vs">vs</div>
        <div class="team">
          ${p.fixture.awayLogo ? `<img src="${p.fixture.awayLogo}" alt="${p.fixture.away}" onerror="this.style.display='none'">` : ''}
          <div class="team-name">${p.fixture.away}</div>
        </div>
      </div>
      <div class="card-probs">
        <div class="prob-item">
          <div class="prob-label">1 Dom</div>
          <div class="prob-value ${probClass(prob.home)}">${prob.home}%</div>
        </div>
        <div class="prob-item">
          <div class="prob-label">X Nul</div>
          <div class="prob-value ${probClass(prob.draw)}">${prob.draw}%</div>
        </div>
        <div class="prob-item">
          <div class="prob-label">2 Ext</div>
          <div class="prob-value ${probClass(prob.away)}">${prob.away}%</div>
        </div>
      </div>
      ${p.goalPrediction ? `
      <div class="card-goals">
        <span class="goal-item ${p.goalPrediction.over25 >= 55 ? 'goal-yes' : 'goal-no'}">+2.5 buts: ${p.goalPrediction.over25}%</span>
        <span class="goal-sep">·</span>
        <span class="goal-item ${p.goalPrediction.btts >= 50 ? 'goal-yes' : 'goal-no'}">BTTS: ${p.goalPrediction.btts}%</span>
      </div>` : ''}
      <div class="card-recommendation">
        <span class="pick">✓ ${rec.pick}</span>
        <span class="confidence ${rec.confidence}">${rec.confidence}</span>
      </div>
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
      <h3>Cotes bookmaker</h3>
      <div class="grid-2" style="grid-template-columns:1fr 1fr 1fr">
        <div class="stat-box"><div class="label">1 (Dom)</div><div class="value" style="color:var(--green)">${p.odds.home}</div></div>
        <div class="stat-box"><div class="label">X (Nul)</div><div class="value" style="color:var(--yellow)">${p.odds.draw}</div></div>
        <div class="stat-box"><div class="label">2 (Ext)</div><div class="value" style="color:var(--purple)">${p.odds.away}</div></div>
      </div>
    </div>` : ''}

    <div class="detail-section">
      <h3>Score algorithmique</h3>
      ${barRow(p.fixture.home.substring(0, 8), p.scores.home)}
      ${barRow(p.fixture.away.substring(0, 8), p.scores.away)}
    </div>

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
      <h3>Joueurs absents / suspendus</h3>
      <div class="grid-2">
        <div class="stat-box">
          <div class="label">${p.fixture.home} — ${b.injuries.team1.count} absent(s)</div>
          ${b.injuries.team1.players?.length > 0
            ? b.injuries.team1.players.map(pl => `
              <div class="injury-row">
                <span class="injury-name">${pl.name}</span>
                <span class="injury-pos">${pl.position}</span>
                <span class="injury-reason ${pl.suspended ? 'suspended' : 'injured'}">${pl.suspended ? '🟥 Suspendu' : '🤕 ' + pl.reason}</span>
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
                <span class="injury-reason ${pl.suspended ? 'suspended' : 'injured'}">${pl.suspended ? '🟥 Suspendu' : '🤕 ' + pl.reason}</span>
              </div>`).join('')
            : '<div style="color:var(--muted);font-size:0.8rem">Aucun absent connu</div>'}
        </div>
      </div>
    </div>
  `;
}

let allPredictions = [];

async function loadPredictions(date) {
  btnLoad.disabled = true;
  loading.classList.remove('hidden');
  errorBox.classList.add('hidden');
  grid.innerHTML = '';

  try {
    const res = await fetch(`/api/predictions/today?date=${date}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    allPredictions = data.predictions;
    topFilters.classList.toggle('hidden', allPredictions.length === 0);
    updateApiStatus(data.requestsUsed, data.requestsLeft);
    if (data.limitReached) {
      errorBox.style.background = 'rgba(210,153,34,0.1)';
      errorBox.style.borderColor = 'var(--yellow)';
      errorBox.style.color = 'var(--yellow)';
      errorBox.textContent = '⚠️ Limite API atteinte (100 req/jour) — affichage depuis le cache. Se réinitialise à minuit.';
      errorBox.classList.remove('hidden');
    }
    renderGrid(allPredictions);
  } catch (err) {
    errorBox.style = '';
    errorBox.textContent = 'Erreur: ' + err.message;
    errorBox.classList.remove('hidden');
  } finally {
    loading.classList.add('hidden');
    btnLoad.disabled = false;
  }
}

function renderGrid(predictions) {
  const displayed = getTopPredictions(predictions, activeTopN);

  if (displayed.length === 0) {
    grid.innerHTML = '<p style="color:var(--muted);text-align:center;padding:3rem">Aucun match trouvé pour cette date.</p>';
    return;
  }

  const banner = activeTopN > 0 ? `
    <div class="top-banner">
      <span class="top-banner-title">🏆 Top ${activeTopN} — Meilleurs pronostics du jour</span>
      <span class="top-banner-sub">Classés par confiance puis probabilité maximale · ${predictions.length} matchs analysés au total</span>
    </div>` : '';

  grid.innerHTML = banner + displayed.map(buildCard).join('');

  grid.querySelectorAll('.card:not(.has-error)').forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      const p = allPredictions.find((x) => String(x.fixture.id) === id);
      if (!p) return;
      modalContent.innerHTML = buildModalContent(p);
      modal.classList.remove('hidden');
    });
  });
}

function updateApiStatus(used, remaining) {
  const badge = document.getElementById('api-badge');
  badge.textContent = `API: ${used}/100 requêtes`;
  badge.className = remaining > 30 ? 'ok' : remaining > 10 ? 'warn' : 'danger';
}

btnLoad.addEventListener('click', () => loadPredictions(datePicker.value));
modalClose.addEventListener('click', () => modal.classList.add('hidden'));
modalBackdrop.addEventListener('click', () => modal.classList.add('hidden'));

topFilters.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    topFilters.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeTopN = parseInt(btn.dataset.n);
    renderGrid(allPredictions);
  });
});

async function initStatus() {
  try {
    const res = await fetch('/api/predictions/status');
    const data = await res.json();
    updateApiStatus(data.used, data.remaining);
  } catch {}
}

initStatus();
loadPredictions(today);
