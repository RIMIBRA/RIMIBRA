const main = document.getElementById('admin-main');
const PLAN_LABEL = { free: 'Gratuit', premium: 'Premium', vip: 'VIP' };

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
    <tr>
      <td>${escapeHtml(p.league || '')}</td>
      <td>${escapeHtml(p.home_team)} — ${escapeHtml(p.away_team)}</td>
      <td>${escapeHtml(p.predicted_pick)}</td>
      <td title="${diverges ? 'Diffère du pronostic final (blend) affiché à côté' : ''}">${escapeHtml(p.algo_pick || '—')}${diverges ? ' ⚠️' : ''}</td>
      <td>${escapeHtml(p.confidence || '')}</td>
      <td>${escapeHtml(sourceBadges(p.sources))}</td>
      <td>${predictionStatus(p)}</td>
    </tr>`;
}

async function loadTrackedPredictions(extraOnly) {
  const params = new URLSearchParams({ date: new Date().toISOString().split('T')[0] });
  if (extraOnly) params.set('featured', 'false');
  const res = await fetch(`/api/admin/tracked-predictions?${params}`, { headers: authHeaders() });
  if (!res.ok) return { count: 0, predictions: [] };
  return res.json();
}

async function renderTrackedSection(extraOnly) {
  const { count, predictions } = await loadTrackedPredictions(extraOnly);
  const rows = predictions.length
    ? predictions.map(trackedRow).join('')
    : '<tr><td colspan="7">Aucun pronostic pour ce filtre aujourd\'hui.</td></tr>';

  return `
    <section>
      <h2>Pronostics suivis aujourd'hui (${count})</h2>
      <label style="display:block;margin-bottom:0.75rem;font-size:0.85rem;color:var(--muted)">
        <input type="checkbox" id="extra-only-toggle" ${extraOnly ? 'checked' : ''}>
        Afficher uniquement les matchs supplémentaires (suivi arrière-plan, jamais montrés aux visiteurs)
      </label>
      <table class="admin-table">
        <thead><tr><th>Ligue</th><th>Match</th><th>Pronostic</th><th>Algo seul</th><th>Confiance</th><th>Sources</th><th>Statut</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

async function loadDashboard(extraOnly = true) {
  const user = await fetchCurrentUser();
  if (!user) {
    main.innerHTML = '<p>Tu dois être connecté. <a href="/login.html">Se connecter</a></p>';
    return;
  }
  if (!user.isAdmin) {
    main.innerHTML = '<p>Accès réservé aux administrateurs.</p>';
    return;
  }

  const [statsRes, usersRes, trackedSection] = await Promise.all([
    fetch('/api/admin/stats', { headers: authHeaders() }),
    fetch('/api/admin/users', { headers: authHeaders() }),
    renderTrackedSection(extraOnly),
  ]);

  if (!statsRes.ok || !usersRes.ok) {
    main.innerHTML = '<p>Erreur de chargement du dashboard.</p>';
    return;
  }

  const stats = await statsRes.json();
  const { users: usersList } = await usersRes.json();

  const planCards = ['free', 'premium', 'vip'].map((p) => `
    <div class="stat-card">
      <div class="stat-card-label">${PLAN_LABEL[p]}</div>
      <div class="stat-card-value">${stats.users.byPlan[p] || 0}</div>
    </div>`).join('');

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
    </tr>`).join('');

  main.innerHTML = `
    <section>
      <h2>Utilisateurs (${stats.users.total})</h2>
      <div class="stat-cards">${planCards}</div>
    </section>

    <section>
      <h2>Quotas API du jour</h2>
      ${quotaRows}
    </section>

    ${trackedSection}

    <section>
      <h2>Liste des comptes</h2>
      <table class="admin-table">
        <thead><tr><th>Email</th><th>Plan</th><th>Admin</th><th>Inscrit le</th></tr></thead>
        <tbody>${userRows}</tbody>
      </table>
    </section>
  `;

  document.getElementById('extra-only-toggle')?.addEventListener('change', (e) => {
    loadDashboard(e.target.checked);
  });
}

loadDashboard();
