const main = document.getElementById('admin-main');
const PLAN_LABEL = { free: 'Gratuit', premium: 'Premium', vip: 'VIP' };
const TRACKED_SPORTS = ['football', 'nba', 'nfl', 'hockey', 'baseball', 'handball', 'tennis'];
const SPORT_LABEL = { football: 'Football', nba: 'NBA', nfl: 'NFL', hockey: 'Hockey', baseball: 'Baseball', handball: 'Handball', tennis: 'Tennis' };
const SPORT_BASE = {
  football: '/api/predictions',
  nba: '/api/nba/predictions',
  nfl: '/api/nfl/predictions',
  hockey: '/api/hockey/predictions',
  baseball: '/api/baseball/predictions',
  handball: '/api/handball/predictions',
  tennis: '/api/tennis/predictions',
};

// Détail d'un match au clic sur une ligne — même modale que la section foot de l'app
// principale (buildModalContent/buildValidationContent viennent de js/matchModal.js).
const modal = document.getElementById('modal');
const modalContent = document.getElementById('modal-content');
const modalClose = document.getElementById('modal-close');
const modalBackdrop = document.getElementById('modal-backdrop');
modalClose?.addEventListener('click', () => modal.classList.add('hidden'));
modalBackdrop?.addEventListener('click', () => modal.classList.add('hidden'));

function singleMatchEndpoint(sport, id) {
  const base = SPORT_BASE[sport] || SPORT_BASE.football;
  return sport === 'football' ? `${base}/fixture/${id}` : `${base}/game/${id}`;
}

async function openTrackedMatchModal(sport, fixtureId) {
  modalContent.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--muted)">Chargement…</p>';
  modal.classList.remove('hidden');
  try {
    const res = await fetch(singleMatchEndpoint(sport, fixtureId), { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Analyse impossible');
    modalContent.innerHTML = data.matchState === 'finished' ? buildValidationContent(data) : buildModalContent(data);
  } catch (err) {
    modalContent.innerHTML = `<p style="color:var(--red)">Erreur : ${err.message}</p>`;
  }
}

// L'email est fourni par l'utilisateur à l'inscription — jamais de confiance avant
// affichage, sinon un email du type "><script>...</script>@x.com" s'exécute ici.
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function quotaBar(used, limit) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const cls = pct > 90 ? 'danger' : pct > 70 ? 'warn' : 'ok';
  return `
    <div class="quota-row">
      <span class="quota-label">${used} / ${limit}</span>
      <div class="quota-track"><div class="quota-fill ${cls}" style="width:${pct}%"></div></div>
    </div>`;
}

function sourceBadges(sources) {
  const labels = { footballpred: 'FP', forebet: 'FB', besoccer: 'BS', oddsapi: 'Cotes', flashscore: 'FS', soccerway: 'SW' };
  const active = Object.entries(sources || {}).filter(([, on]) => on).map(([key]) => labels[key] || key);
  return active.length ? active.join(', ') : '—';
}

function predictionStatus(p) {
  if (!p.resolved_at) return '⏳ À venir';
  return p.correct ? '✅ Correct' : '❌ Incorrect';
}

function trackedRow(p) {
  const diverges = p.algo_pick && p.algo_pick !== p.predicted_pick;
  return `
    <tr class="tracked-row" style="cursor:pointer" data-sport="${p.sport}" data-fixture-id="${p.fixture_id}" title="Cliquer pour voir le détail du match">
      <td>${escapeHtml(p.league || '')}</td>
      <td>${escapeHtml(p.home_team)} — ${escapeHtml(p.away_team)}</td>
      <td>${escapeHtml(p.predicted_pick)}</td>
      <td title="${diverges ? 'Diffère du pronostic final (blend) affiché à côté' : ''}">${escapeHtml(p.algo_pick || '—')}${diverges ? ' ⚠️' : ''}</td>
      <td>${escapeHtml(p.confidence || '')}</td>
      <td>${escapeHtml(sourceBadges(p.sources))}</td>
      <td>${predictionStatus(p)}</td>
    </tr>`;
}

async function loadTrackedPredictions(extraOnly, sport) {
  const params = new URLSearchParams({ date: new Date().toISOString().split('T')[0], sport });
  if (extraOnly) params.set('featured', 'false');
  const res = await fetch(`/api/admin/tracked-predictions?${params}`, { headers: authHeaders() });
  if (!res.ok) return { count: 0, predictions: [] };
  return res.json();
}

async function renderTrackedSection(extraOnly, sport) {
  const { count, predictions } = await loadTrackedPredictions(extraOnly, sport);
  const rows = predictions.length
    ? predictions.map(trackedRow).join('')
    : '<tr><td colspan="7">Aucun pronostic pour ce filtre aujourd\'hui.</td></tr>';

  const sportOptions = TRACKED_SPORTS.map((s) =>
    `<option value="${s}" ${s === sport ? 'selected' : ''}>${SPORT_LABEL[s]}</option>`
  ).join('');

  // Seul le foot a un blend (sources web) et un suivi supplémentaire en arrière-plan -> pour
  // les autres sports, "Algo seul" == pronostic final et le filtre "matchs supplémentaires"
  // ne renverra jamais rien (featured est toujours true).
  return `
    <section>
      <h2>Pronostics suivis aujourd'hui (${count})</h2>
      <div style="display:flex;align-items:center;gap:1rem;margin-bottom:0.75rem;flex-wrap:wrap">
        <select id="sport-select" style="background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:0.35rem 0.6rem">
          ${sportOptions}
        </select>
        <label style="font-size:0.85rem;color:var(--muted)">
          <input type="checkbox" id="extra-only-toggle" ${extraOnly ? 'checked' : ''}>
          Afficher uniquement les matchs supplémentaires (foot uniquement — suivi arrière-plan, jamais montrés aux visiteurs)
        </label>
      </div>
      <table class="admin-table">
        <thead><tr><th>Ligue</th><th>Match</th><th>Pronostic</th><th>Algo seul</th><th>Confiance</th><th>Sources</th><th>Statut</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

// Trafic minimal (pas de cookie/tiers, voir src/db/analytics.js) : vues de page et visiteurs
// uniques approximés par jour, sur les 14 derniers jours, pour avoir un vrai chiffre à donner
// aux régies publicitaires (elles demandent toujours le volume avant d'ouvrir certains accès).
function renderTrafficSection({ daily, topPages, clicksByPartner }) {
  const totalViews = daily.reduce((sum, d) => sum + d.pageviews, 0);
  const totalVisitors = daily.reduce((sum, d) => sum + d.visitors, 0);
  const avgPerDay = daily.length ? Math.round(totalViews / daily.length) : 0;

  const dailyRows = daily.slice().reverse().map((d) => `
    <tr>
      <td>${new Date(d.day).toLocaleDateString('fr-FR')}</td>
      <td>${d.pageviews}</td>
      <td>${d.visitors}</td>
    </tr>`).join('');

  const topPagesRows = topPages.map((p) => `
    <tr><td>${escapeHtml(p.path)}</td><td>${p.pageviews}</td></tr>`).join('');

  const partnerClicksRows = (clicksByPartner || []).map((c) => `
    <tr><td>${escapeHtml(c.partner)}</td><td>${c.clicks}</td></tr>`).join('');

  return `
    <section>
      <h2>Trafic (14 derniers jours)</h2>
      <div class="stat-cards">
        <div class="stat-card"><div class="stat-card-label">Vues totales</div><div class="stat-card-value">${totalViews}</div></div>
        <div class="stat-card"><div class="stat-card-label">Visiteurs uniques (approx.)</div><div class="stat-card-value">${totalVisitors}</div></div>
        <div class="stat-card"><div class="stat-card-label">Moyenne / jour</div><div class="stat-card-value">${avgPerDay}</div></div>
      </div>
      <div class="grid-2" style="margin-top:1rem">
        <div>
          <h3 style="font-size:0.85rem;color:var(--muted);margin-bottom:0.5rem">Par jour</h3>
          <table class="admin-table">
            <thead><tr><th>Jour</th><th>Vues</th><th>Visiteurs</th></tr></thead>
            <tbody>${dailyRows || '<tr><td colspan="3">Pas encore de données</td></tr>'}</tbody>
          </table>
        </div>
        <div>
          <h3 style="font-size:0.85rem;color:var(--muted);margin-bottom:0.5rem">Pages les plus vues</h3>
          <table class="admin-table">
            <thead><tr><th>Page</th><th>Vues</th></tr></thead>
            <tbody>${topPagesRows || '<tr><td colspan="2">Pas encore de données</td></tr>'}</tbody>
          </table>
        </div>
        <div>
          <h3 style="font-size:0.85rem;color:var(--muted);margin-bottom:0.5rem">Clics par partenaire</h3>
          <table class="admin-table">
            <thead><tr><th>Partenaire</th><th>Clics</th></tr></thead>
            <tbody>${partnerClicksRows || '<tr><td colspan="2">Pas encore de données</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </section>`;
}

// --- Combiné manuel : le fondateur choisit lui-même les matchs du combiné du jour ---
// La sélection persiste quand on change de sport (combinés multi-sports possibles, 2 à 5
// matchs). Les candidats sont chargés à la demande (bouton) et non au chargement du
// dashboard : l'analyse complète d'une journée peut prendre plus d'une minute à froid.
const COMBO_MAX_MATCHES = 5;
let comboSelection = []; // [{ sport, fixtureId, betType, prob, label, pickLabel }]
let currentComboCandidates = []; // candidats du dernier chargement (sport + date affichés), pour résoudre les marchés côté client

function renderManualComboSection() {
  const sportOptions = TRACKED_SPORTS.map((s) => `<option value="${s}">${SPORT_LABEL[s]}</option>`).join('');
  const today = new Date().toISOString().split('T')[0];
  return `
    <section>
      <h2>🎯 Créer un combiné manuel</h2>
      <p style="font-size:0.85rem;color:var(--muted);margin-bottom:0.75rem">
        Choisis toi-même les matchs du combiné (2 à ${COMBO_MAX_MATCHES}) — la sélection est conservée quand tu
        changes de sport, donc tu peux mélanger plusieurs disciplines dans un même combiné.
        Pour chaque match, choisis aussi le marché ciblé (1/X/2, BTTS et total de buts pour le foot,
        nombre de sets pour le tennis — via cotes réelles). Sans le filtre de compétitions ni la
        barre des 50% des combinés automatiques.
      </p>
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem;flex-wrap:wrap">
        <select id="combo-sport" style="background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:0.35rem 0.6rem">
          ${sportOptions}
        </select>
        <input type="date" id="combo-date" value="${today}" style="background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:0.35rem 0.6rem">
        <button id="combo-load-btn" class="filter-btn">Charger les matchs</button>
      </div>
      <div id="combo-candidates"></div>
      <label style="display:flex;align-items:center;gap:0.4rem;margin-top:0.75rem;font-size:0.85rem;cursor:pointer">
        <input type="checkbox" id="combo-special-cb">
        🌟 Marquer comme combiné spécial (section dédiée « Spécial », réservée aux abonnés Premium/VIP)
      </label>
      <div id="combo-summary" style="margin-top:0.75rem"></div>
    </section>`;
}

// Mêmes marchés que resolveBetSelection côté serveur (routes/combos.js) — juste pour prévisualiser
// le pick et la probabilité dans le dashboard ; la valeur qui compte reste recalculée côté serveur
// à la création du combiné.
function resolveBetPreview(candidate, betType) {
  const probs = candidate.probabilities || {};
  const g = candidate.goalPrediction;
  if (betType === '1') return { pick: '1 (Domicile)', prob: probs.home };
  if (betType === 'X') return { pick: 'X (Nul)', prob: probs.draw ?? 0 };
  if (betType === '2') return { pick: '2 (Extérieur)', prob: probs.away };
  if (betType === 'btts_yes') return g ? { pick: 'BTTS Oui', prob: g.btts } : null;
  if (betType === 'btts_no') return g ? { pick: 'BTTS Non', prob: 100 - g.btts } : null;
  if (betType === 'over25') return g ? { pick: '+2,5 buts', prob: g.over25 } : null;
  if (betType === 'under25') return g ? { pick: '-2,5 buts', prob: 100 - g.over25 } : null;
  if (betType.startsWith('sets_')) {
    const m = /^sets_(over|under)_([\d.]+)$/.exec(betType);
    const entry = m && candidate.setsMarkets?.find((s) => s.side === m[1] && s.line === m[2]);
    return entry ? { pick: `${m[1] === 'over' ? '+' : '-'}${m[2]} sets`, prob: entry.probability } : null;
  }
  return { pick: candidate.pick, prob: candidate.probability };
}

function buildBetTypeOptions(c, selected) {
  const opts = [
    { v: 'algo', label: `Pronostic algo — ${c.pick} (${c.probability}%)` },
    { v: '1', label: `1 · Victoire ${c.home} (${c.probabilities?.home ?? '?'}%)` },
    { v: 'X', label: `X · Match nul (${c.probabilities?.draw ?? 0}%)` },
    { v: '2', label: `2 · Victoire ${c.away} (${c.probabilities?.away ?? '?'}%)` },
  ];
  if (c.goalPrediction) {
    opts.push(
      { v: 'btts_yes', label: `BTTS · Oui (${c.goalPrediction.btts}%)` },
      { v: 'btts_no', label: `BTTS · Non (${100 - c.goalPrediction.btts}%)` },
      { v: 'over25', label: `Total buts · +2,5 (${c.goalPrediction.over25}%)` },
      { v: 'under25', label: `Total buts · -2,5 (${100 - c.goalPrediction.over25}%)` },
    );
  }
  // Nombre de sets (tennis) : cotes réelles, une option par ligne dispo pour ce match (2.5,
  // 3.5, 4.5 selon best-of-3/5) — voir api/tennisClient.js getSetsMarkets.
  if (c.setsMarkets?.length) {
    c.setsMarkets
      .slice()
      .sort((a, b) => Number(a.line) - Number(b.line) || (a.side === 'over' ? -1 : 1))
      .forEach((s) => {
        opts.push({ v: `sets_${s.side}_${s.line}`, label: `Total sets · ${s.side === 'over' ? '+' : '-'}${s.line} (~${s.probability}%)` });
      });
  }
  return opts.map((o) => `<option value="${o.v}" ${o.v === selected ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
}

function updateComboSummary() {
  const summary = document.getElementById('combo-summary');
  if (!summary) return;
  if (comboSelection.length === 0) {
    summary.innerHTML = `<span style="color:var(--muted);font-size:0.85rem">Sélectionne 2 à ${COMBO_MAX_MATCHES} matchs (tous sports confondus)</span>`;
    return;
  }
  const combined = Math.round(comboSelection.reduce((acc, s) => acc * (s.prob / 100), 1) * 100);
  const chips = comboSelection.map((s) =>
    `<span style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:0.2rem 0.5rem;font-size:0.8rem">${SPORT_LABEL[s.sport] || s.sport} · ${escapeHtml(s.label)} — ${escapeHtml(s.pickLabel)} (${s.prob}%)</span>`
  ).join(' ');
  const createBtn = comboSelection.length >= 2
    ? `<button id="combo-create-btn" class="filter-btn active">Créer le combiné (${comboSelection.length} matchs)</button>`
    : `<span style="color:var(--muted);font-size:0.85rem">Encore ${2 - comboSelection.length} match(s) à choisir</span>`;
  summary.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:0.5rem">
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap">${chips}</div>
      <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
        <span>Probabilité combinée : <strong>${combined}%</strong> (${comboSelection.length}/${COMBO_MAX_MATCHES} matchs)</span>
        ${createBtn}
        <span id="combo-create-result" style="font-size:0.85rem"></span>
      </div>
    </div>`;
  document.getElementById('combo-create-btn')?.addEventListener('click', createManualComboFromSelection);
}

function toggleComboCandidate(cb, sport) {
  const key = `${sport}:${cb.dataset.fixtureId}`;
  if (cb.checked) {
    if (comboSelection.length >= COMBO_MAX_MATCHES) {
      cb.checked = false;
      alert(`Maximum ${COMBO_MAX_MATCHES} matchs par combiné`);
      return;
    }
    if (!comboSelection.some((s) => `${s.sport}:${s.fixtureId}` === key)) {
      const candidate = currentComboCandidates.find((c) => String(c.fixtureId) === cb.dataset.fixtureId);
      const select = document.querySelector(`.combo-bettype-select[data-fixture-id="${cb.dataset.fixtureId}"]`);
      const betType = select ? select.value : 'algo';
      const preview = resolveBetPreview(candidate, betType) || { pick: candidate.pick, prob: candidate.probability };
      comboSelection.push({
        sport, fixtureId: cb.dataset.fixtureId, betType,
        prob: preview.prob, pickLabel: preview.pick, label: `${candidate.home} — ${candidate.away}`,
      });
    }
  } else {
    comboSelection = comboSelection.filter((s) => `${s.sport}:${s.fixtureId}` !== key);
  }
  updateComboSummary();
}

function updateComboSelectionBetType(sport, fixtureId, betType) {
  const idx = comboSelection.findIndex((s) => s.sport === sport && s.fixtureId === fixtureId);
  if (idx === -1) return; // pas encore coché, rien à mettre à jour tout de suite
  const candidate = currentComboCandidates.find((c) => String(c.fixtureId) === fixtureId);
  const preview = resolveBetPreview(candidate, betType) || { pick: candidate.pick, prob: candidate.probability };
  comboSelection[idx] = { ...comboSelection[idx], betType, prob: preview.prob, pickLabel: preview.pick };
  updateComboSummary();
}

async function loadComboCandidates() {
  const sport = document.getElementById('combo-sport').value;
  const date = document.getElementById('combo-date').value;
  const container = document.getElementById('combo-candidates');
  container.innerHTML = '<p style="color:var(--muted)">Analyse des matchs en cours… (peut prendre une minute sur un cache froid)</p>';
  try {
    const res = await fetch(`/api/admin/combo-candidates?sport=${sport}&date=${date}`, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Chargement impossible');
    if (!data.candidates.length) {
      container.innerHTML = '<p style="color:var(--muted)">Aucun match exploitable ce jour-là.</p>';
      updateComboSummary();
      return;
    }
    currentComboCandidates = data.candidates;
    container.innerHTML = `
      <table class="admin-table">
        <thead><tr><th></th><th>Ligue</th><th>Match</th><th>Marché (pronostic)</th></tr></thead>
        <tbody>
          ${data.candidates.map((c) => {
            const existing = comboSelection.find((s) => s.sport === sport && String(s.fixtureId) === String(c.fixtureId));
            const betType = existing?.betType || 'algo';
            return `
            <tr class="combo-candidate-row" style="cursor:pointer" data-fixture-id="${c.fixtureId}" title="Cliquer pour voir le détail du match">
              <td><input type="checkbox" class="combo-candidate-cb" ${existing ? 'checked' : ''} data-fixture-id="${c.fixtureId}"></td>
              <td>${escapeHtml(c.league || '')}</td>
              <td>${escapeHtml(c.home)} — ${escapeHtml(c.away)}</td>
              <td><select class="combo-bettype-select" data-fixture-id="${c.fixtureId}" style="background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:0.25rem 0.4rem">${buildBetTypeOptions(c, betType)}</select></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
    document.querySelectorAll('.combo-candidate-cb').forEach((cb) => {
      cb.addEventListener('click', (e) => e.stopPropagation()); // ne pas ouvrir la modale en cochant
      cb.addEventListener('change', () => toggleComboCandidate(cb, sport));
    });
    document.querySelectorAll('.combo-bettype-select').forEach((sel) => {
      sel.addEventListener('click', (e) => e.stopPropagation());
      sel.addEventListener('change', () => updateComboSelectionBetType(sport, sel.dataset.fixtureId, sel.value));
    });
    document.querySelectorAll('.combo-candidate-row').forEach((row) => {
      row.addEventListener('click', () => openTrackedMatchModal(sport, row.dataset.fixtureId));
    });
    updateComboSummary();
  } catch (err) {
    container.innerHTML = `<p style="color:var(--red)">Erreur : ${escapeHtml(err.message)}</p>`;
  }
}

async function createManualComboFromSelection() {
  const date = document.getElementById('combo-date').value;
  const special = document.getElementById('combo-special-cb')?.checked || false;
  const resultEl = document.getElementById('combo-create-result');
  const btn = document.getElementById('combo-create-btn');
  btn.disabled = true;
  resultEl.textContent = 'Création…';
  try {
    const res = await fetch('/api/admin/combos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        date,
        special,
        fixtures: comboSelection.map(({ sport, fixtureId, betType }) => ({ sport, fixtureId, betType })),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Création impossible');
    comboSelection = [];
    document.querySelectorAll('.combo-candidate-cb').forEach((cb) => { cb.checked = false; });
    const specialCb = document.getElementById('combo-special-cb');
    if (specialCb) specialCb.checked = false;
    const kind = data.sport === 'special' ? 'spécial ' : data.sport === 'multi' ? 'multi-sports ' : '';
    // Pas via updateComboSummary() : la sélection vidée effacerait le message de succès
    document.getElementById('combo-summary').innerHTML =
      `<span style="color:var(--green)">✅ Combiné ${kind}créé (${data.combinedProbability}%, risque ${data.risk}) — visible dans l'onglet Combinés${data.sport === 'special' ? ' (section Spécial)' : ''}</span>`;
  } catch (err) {
    btn.disabled = false;
    resultEl.innerHTML = `<span style="color:var(--red)">Erreur : ${escapeHtml(err.message)}</span>`;
  }
}

async function loadDashboard(extraOnly = true, sport = 'football') {
  const user = await fetchCurrentUser();
  if (!user) {
    main.innerHTML = '<p>Tu dois être connecté. <a href="/login.html">Se connecter</a></p>';
    return;
  }
  if (!user.isAdmin) {
    main.innerHTML = '<p>Accès réservé aux administrateurs.</p>';
    return;
  }

  const [statsRes, usersRes, analyticsRes, trackedSection] = await Promise.all([
    fetch('/api/admin/stats', { headers: authHeaders() }),
    fetch('/api/admin/users', { headers: authHeaders() }),
    fetch('/api/admin/analytics?days=14', { headers: authHeaders() }),
    renderTrackedSection(extraOnly, sport),
  ]);

  if (!statsRes.ok || !usersRes.ok) {
    main.innerHTML = '<p>Erreur de chargement du dashboard.</p>';
    return;
  }

  const stats = await statsRes.json();
  const { users: usersList } = await usersRes.json();
  const trafficSection = analyticsRes.ok ? renderTrafficSection(await analyticsRes.json()) : '';

  const planCards = ['free', 'premium', 'vip'].map((p) => `
    <div class="stat-card">
      <div class="stat-card-label">${PLAN_LABEL[p]}</div>
      <div class="stat-card-value">${stats.users.byPlan[p] || 0}</div>
    </div>`).join('');

  // "Actif" = connecté au moins une fois dans les 7 derniers jours (last_login_at, voir
  // db/users.js touchLastLogin) — distingue les comptes créés puis jamais revenus des
  // utilisateurs qui utilisent vraiment le site, ce que la seule date de création ne montre pas.
  const ACTIVE_WINDOW_MS = 7 * 24 * 3600 * 1000;
  const activeCount = usersList.filter((u) => u.last_login_at && (Date.now() - new Date(u.last_login_at).getTime()) < ACTIVE_WINDOW_MS).length;
  const activeCard = `
    <div class="stat-card">
      <div class="stat-card-label">Actifs (7j)</div>
      <div class="stat-card-value">${activeCount}</div>
    </div>`;

  const quotaRows = Object.entries(stats.quotas).map(([sport, q]) => `
    <div class="sport-quota">
      <div class="sport-quota-name">${sport}</div>
      ${quotaBar(q.used, q.limit)}
    </div>`).join('');

  const userRows = usersList.map((u) => `
    <tr>
      <td>${escapeHtml(u.email)}</td>
      <td><span class="plan-tag plan-${u.plan}">${PLAN_LABEL[u.plan] || u.plan}</span></td>
      <td>${u.is_admin ? '✅' : ''}</td>
      <td>${new Date(u.created_at).toLocaleDateString('fr-FR')}</td>
      <td>${u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('fr-FR') : '<span style="color:var(--muted)">Jamais</span>'}</td>
    </tr>`).join('');

  main.innerHTML = `
    <section>
      <h2>Utilisateurs (${stats.users.total})</h2>
      <div class="stat-cards">${planCards}${activeCard}</div>
    </section>

    <section>
      <h2>Quotas API du jour</h2>
      ${quotaRows}
    </section>

    ${trafficSection}

    ${renderManualComboSection()}

    ${trackedSection}

    <section>
      <h2>Liste des comptes</h2>
      <table class="admin-table">
        <thead><tr><th>Email</th><th>Plan</th><th>Admin</th><th>Inscrit le</th><th>Dernière connexion</th></tr></thead>
        <tbody>${userRows}</tbody>
      </table>
    </section>
  `;

  document.getElementById('extra-only-toggle')?.addEventListener('change', (e) => {
    loadDashboard(e.target.checked, sport);
  });
  document.getElementById('sport-select')?.addEventListener('change', (e) => {
    // Le filtre "matchs supplémentaires" ne s'applique qu'au foot -> le désactiver en changeant
    // de sport évite un tableau vide silencieux qui laisserait croire à un bug
    const newSport = e.target.value;
    loadDashboard(newSport === 'football' && extraOnly, newSport);
  });
  document.querySelectorAll('.tracked-row').forEach((row) => {
    row.addEventListener('click', () => openTrackedMatchModal(row.dataset.sport, row.dataset.fixtureId));
  });
  document.getElementById('combo-load-btn')?.addEventListener('click', loadComboCandidates);
}

loadDashboard();
