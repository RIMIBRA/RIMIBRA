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

async function loadDashboard() {
  const user = await fetchCurrentUser();
  if (!user) {
    main.innerHTML = '<p>Tu dois être connecté. <a href="/login.html">Se connecter</a></p>';
    return;
  }
  if (!user.isAdmin) {
    main.innerHTML = '<p>Accès réservé aux administrateurs.</p>';
    return;
  }

  const [statsRes, usersRes] = await Promise.all([
    fetch('/api/admin/stats', { headers: authHeaders() }),
    fetch('/api/admin/users', { headers: authHeaders() }),
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

    <section>
      <h2>Liste des comptes</h2>
      <table class="admin-table">
        <thead><tr><th>Email</th><th>Plan</th><th>Admin</th><th>Inscrit le</th></tr></thead>
        <tbody>${userRows}</tbody>
      </table>
    </section>
  `;
}

loadDashboard();
