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
function renderTrafficSection({ daily, topPages }) {
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
      </div>
    </section>`;
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
}

loadDashboard();
