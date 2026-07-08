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
const stateFilters = document.getElementById('state-filters');
const searchInput = document.getElementById('search-input');
const btnSearch = document.getElementById('btn-search');
const searchResults = document.getElementById('search-results');
const btnDayPrev = document.getElementById('btn-day-prev');
const btnDayNext = document.getElementById('btn-day-next');

const sportTabs = document.getElementById('sport-tabs');
const appTitle = document.getElementById('app-title');
const accountStatus = document.getElementById('account-status');

// Identifie l'utilisateur courant dans les clés de cache local — sans ça, une réponse mise
// en cache pour un visiteur anonyme (ou un autre plan) resterait servie après connexion/changement de plan
let currentUserKey = 'anon';

// Infos de plan côté client, pour masquer aux visiteurs tout ce qui est purement interne
// (quotas API, "X analysés sur Y") — ça ne les aide pas, ça ne fait que soulever des questions.
// Seul le fondateur (admin) a besoin de voir ces détails ; il a de toute façon le dashboard pour ça.
let currentUserIsAdmin = false;
let canSearch = false; // premium/vip/admin uniquement — voir auth/tiers.js FEATURE_MIN_TIER.search

// L'email vient de l'inscription utilisateur — jamais de confiance avant affichage HTML
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function renderAccountStatus() {
  const user = await fetchCurrentUser();
  if (!user) {
    currentUserKey = 'anon';
    currentUserIsAdmin = false;
    canSearch = false;
    accountStatus.innerHTML = '<a href="/login.html">Se connecter</a>';
    return;
  }
  currentUserKey = `u${user.id}_${user.isAdmin ? 'admin' : user.plan}`;
  currentUserIsAdmin = !!user.isAdmin;
  canSearch = user.isAdmin || user.plan === 'premium' || user.plan === 'vip';
  document.getElementById('api-badge').classList.toggle('hidden', !currentUserIsAdmin);
  const planLabel = user.isAdmin ? 'Admin' : ({ free: 'Gratuit', premium: 'Premium', vip: 'VIP' }[user.plan] || user.plan);
  const dashboardLink = user.isAdmin ? '<a href="/admin.html" id="dashboard-link">🛠️ Dashboard</a>' : '';
  // Pas de proposition d'upgrade pour un admin ou un VIP (déjà au niveau maximum d'accès)
  const upgradeLink = !user.isAdmin && user.plan !== 'vip' ? '<a href="/pricing.html">⭐ Passer Premium/VIP</a>' : '';
  accountStatus.innerHTML = `<span class="plan-${user.isAdmin ? 'admin' : user.plan}">${escapeHtml(user.email)} · ${planLabel}</span> ${upgradeLink} ${dashboardLink} <a href="#" id="logout-link">Déconnexion</a>`;
  document.getElementById('logout-link').addEventListener('click', (e) => {
    e.preventDefault();
    clearToken();
    window.location.reload();
  });
}

const SPORTS = {
  football: { base: '/api/predictions', title: '⚽ footpredictongoal' },
  nfl: { base: '/api/nfl/predictions', title: '🏈 NFL Predictor' },
  nba: { base: '/api/nba/predictions', title: '🏀 Basketball Predictor' },
  hockey: { base: '/api/hockey/predictions', title: '🏒 Hockey Predictor' },
  baseball: { base: '/api/baseball/predictions', title: '⚾ Baseball Predictor' },
  handball: { base: '/api/handball/predictions', title: '🤾 Handball Predictor' },
  tennis: { base: '/api/tennis/predictions', title: '🎾 Tennis Predictor' },
};
let currentSport = 'football';
function apiBase() { return SPORTS[currentSport].base; }

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

// buildBetAdvice, bttsVerdict, goalsVerdict, renderFormBadges, buildModalContent,
// validationCard, buildValidationContent : voir js/matchModal.js (chargé avant ce fichier),
// partagées avec le dashboard admin.

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
    p.webSources?.flashscore   ? '<span class="web-badge odds-badge">Flashscore</span>' : '',
    p.webSources?.soccerway    ? '<span class="web-badge" style="background:rgba(16,185,129,0.15);color:#10b981">Soccerway</span>' : '',
  ].filter(Boolean).join('');
  const modeBadge = p.webMode ? '<span class="no-data-badge">Mode Web</span>' : '';

  if (p.insufficientData) {
    return `
      <div class="card has-error" data-id="${p.fixture.id}">
        <div class="card-league">${p.fixture.league} · ${time} ${webBadges}${modeBadge}</div>
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
        <div style="font-size:0.78rem;color:var(--muted);text-align:center;padding:0.4rem 0">
          Données insuffisantes (forme, historique, cotes) pour une analyse fiable de ce match
        </div>
      </div>`;
  }

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
        <span class="goal-item ${bttsVerdict(p.goalPrediction).cls}">BTTS: ${bttsVerdict(p.goalPrediction).text} (${p.goalPrediction.btts}%)</span>
      </div>` : ''}
      <div class="card-recommendation">
        <span class="pick">✓ ${buildBetAdvice(p).short}</span>
        <span class="confidence ${rec.confidence}">${rec.confidence}</span>
      </div>
    </div>`;
}

let allPredictions = [];
let lastMeta = { total: 0, analyzed: 0 };

// Cache local (navigateur) : évite de re-consommer le quota API quand l'utilisateur revient
// sur une date/sport déjà chargée pendant la même session — pas un cache partagé entre
// utilisateurs (ça, c'est déjà géré côté serveur), juste un confort individuel.
const LOCAL_CACHE_TTL_MS = 15 * 60 * 1000;

function localCacheGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, expiresAt } = JSON.parse(raw);
    if (Date.now() > expiresAt) { localStorage.removeItem(key); return null; }
    return data;
  } catch {
    return null;
  }
}

// Si le quota localStorage (~5-10 Mo) est dépassé par l'accumulation des réponses mises en
// cache (chaque sport/date garde son entrée jusqu'à expiration), localStorage.setItem lève une
// erreur — on purge alors les entrées déjà expirées avant de retenter, plutôt que d'abandonner
// silencieusement (ce qui désactiverait le cache en boucle sans qu'on s'en rende compte).
function localCachePurgeExpired() {
  const now = Date.now();
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('rimibra_')) continue;
    try {
      const { expiresAt } = JSON.parse(localStorage.getItem(key));
      if (now > expiresAt) toRemove.push(key);
    } catch {
      toRemove.push(key); // entrée corrompue -> on la jette aussi
    }
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
}

function localCacheSet(key, data) {
  const serialized = JSON.stringify({ data, expiresAt: Date.now() + LOCAL_CACHE_TTL_MS });
  try {
    localStorage.setItem(key, serialized);
  } catch {
    localCachePurgeExpired();
    try {
      localStorage.setItem(key, serialized);
    } catch {
      console.warn('Cache local indisponible (quota localStorage dépassé) — cette réponse ne sera pas mise en cache, chaque visite refera une requête.');
    }
  }
}

async function loadPredictions(date, { force = false } = {}) {
  // Si l'utilisateur change d'onglet avant la fin de cette requête, on ignore la réponse
  // tardive plutôt que d'écraser l'affichage du sport qu'il regarde maintenant.
  const requestSport = currentSport;

  btnLoad.disabled = true;
  loading.classList.remove('hidden');
  errorBox.classList.add('hidden');
  grid.innerHTML = '';

  const cacheKey = `rimibra_today_${currentSport}_${date}_${currentUserKey}`;

  try {
    let data;
    const cached = !force && localCacheGet(cacheKey);
    if (cached) {
      data = cached;
    } else {
      const res = await fetch(`${apiBase()}/today?date=${date}`, { headers: authHeaders() });
      data = await res.json();
      if (res.status === 403 && data.upgradeRequired) {
        throw new Error(`${data.error} → connecte-toi ou mets à niveau ton abonnement.`);
      }
      if (!res.ok) throw new Error(data.error);
      localCacheSet(cacheKey, data);
    }

    if (currentSport !== requestSport) return; // l'utilisateur a changé d'onglet pendant le chargement

    allPredictions = data.predictions;
    lastMeta = { total: data.total ?? allPredictions.length, analyzed: data.analyzed ?? allPredictions.length };
    topFilters.classList.toggle('hidden', allPredictions.length === 0);
    stateFilters.classList.toggle('hidden', allPredictions.length === 0);
    updateApiStatus(data.requestsUsed, data.requestsLeft);
    if (data.freePreview) {
      errorBox.style.background = 'rgba(88,166,255,0.1)';
      errorBox.style.borderColor = 'var(--blue)';
      errorBox.style.color = 'var(--blue)';
      errorBox.textContent = '🔒 Aperçu gratuit : 5 matchs à venir visibles (tous les résultats terminés restent accessibles). Passe Premium pour tout voir.';
      errorBox.classList.remove('hidden');
    } else if (data.limitReached && currentUserIsAdmin) {
      // Detail interne (quota API) -> reserve au fondateur, un visiteur normal n'en a pas besoin
      errorBox.style.background = 'rgba(210,153,34,0.1)';
      errorBox.style.borderColor = 'var(--yellow)';
      errorBox.style.color = 'var(--yellow)';
      errorBox.textContent = '⚠️ Limite API atteinte — affichage depuis le cache. Se réinitialise à minuit.';
      errorBox.classList.remove('hidden');
    }
    renderGrid(allPredictions);
  } catch (err) {
    if (currentSport !== requestSport) return;
    errorBox.style = '';
    errorBox.textContent = 'Erreur: ' + err.message;
    errorBox.classList.remove('hidden');
  } finally {
    if (currentSport === requestSport) {
      loading.classList.add('hidden');
      btnLoad.disabled = false;
    }
  }
}

function attachCardClickHandlers(container, predictions) {
  container.querySelectorAll('.card:not(.has-error)').forEach((card) => {
    card.addEventListener('click', async () => {
      const id = card.dataset.id;
      const p = predictions.find((x) => String(x.fixture.id) === id);
      if (!p) return;

      // Foot/Tennis : on recharge le match en direct pour récupérer l'alternative de pari
      // (cotes réelles), pas dans la liste du jour pour ne pas alourdir son chargement
      if (currentSport === 'tennis' || currentSport === 'football') {
        modalContent.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--muted)">Chargement…</p>';
        modal.classList.remove('hidden');
        try {
          const res = await fetch(singleMatchEndpoint(id), { headers: authHeaders() });
          const fresh = await res.json();
          modalContent.innerHTML = buildModalContent(res.ok ? fresh : p);
        } catch {
          modalContent.innerHTML = buildModalContent(p);
        }
        return;
      }

      modalContent.innerHTML = buildModalContent(p);
      modal.classList.remove('hidden');
    });
  });
}

function singleMatchEndpoint(id) {
  return currentSport === 'football' ? `${apiBase()}/fixture/${id}` : `${apiBase()}/game/${id}`;
}

// validationCard, buildValidationContent : voir js/matchModal.js

function attachFinishedCardClickHandlers(container, predictions) {
  container.querySelectorAll('.finished-card[data-id]').forEach((card) => {
    card.addEventListener('click', async () => {
      const id = card.dataset.id;
      modalContent.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--muted)">Analyse en cours…</p>';
      modal.classList.remove('hidden');
      try {
        const res = await fetch(singleMatchEndpoint(id), { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Analyse impossible');
        modalContent.innerHTML = buildValidationContent(data);
      } catch (err) {
        modalContent.innerHTML = `<p style="color:var(--red)">Erreur : ${err.message}</p>`;
      }
    });
  });
}

function buildFinishedCard(p) {
  // Certains matchs sont reclassés "terminé" par heuristique (coup d'envoi très dépassé
  // mais statut jamais mis à jour par le fournisseur) — pas de score confirmé dans ce cas
  const hasScore = p.finalScore && p.finalScore.home != null && p.finalScore.away != null;
  const homeWon = hasScore && p.finalScore.home > p.finalScore.away;
  const awayWon = hasScore && p.finalScore.away > p.finalScore.home;
  return `
    <div class="finished-card" data-id="${p.fixture.id}">
      <div class="card-league">${p.fixture.league}</div>
      <div class="card-teams">
        <div class="team">
          ${p.fixture.homeLogo ? `<img src="${p.fixture.homeLogo}" alt="${p.fixture.home}" onerror="this.style.display='none'">` : ''}
          <div class="team-name" style="${homeWon ? 'font-weight:700' : ''}">${p.fixture.home}</div>
        </div>
        <div class="vs">${hasScore ? `${p.finalScore.home} : ${p.finalScore.away}` : '—'}</div>
        <div class="team">
          ${p.fixture.awayLogo ? `<img src="${p.fixture.awayLogo}" alt="${p.fixture.away}" onerror="this.style.display='none'">` : ''}
          <div class="team-name" style="${awayWon ? 'font-weight:700' : ''}">${p.fixture.away}</div>
        </div>
      </div>
      <div style="font-size:0.75rem;color:var(--muted);text-align:center">${hasScore ? 'Match terminé · cliquer pour voir la validation' : '⚠️ Match probablement terminé — score non confirmé par le fournisseur'}</div>
    </div>`;
}

let activeStateFilter = 'all';

function renderGrid(predictions) {
  const buckets = {
    upcoming: predictions.filter((p) => (p.matchState || (p.finished ? 'finished' : 'upcoming')) === 'upcoming'),
    live: predictions.filter((p) => p.matchState === 'live'),
    finished: predictions.filter((p) => p.finished || p.matchState === 'finished'),
  };

  const total = buckets.upcoming.length + buckets.live.length + buckets.finished.length;
  if (total === 0) {
    grid.innerHTML = '<p style="color:var(--muted);text-align:center;padding:3rem">Aucun match trouvé pour cette date.</p>';
    return;
  }

  const upcomingDisplayed = getTopPredictions(buckets.upcoming, activeTopN);
  const liveDisplayed = getTopPredictions(buckets.live, activeTopN);

  const banner = activeTopN > 0 ? `
    <div class="top-banner">
      <span class="top-banner-title">🏆 Top ${activeTopN} — Meilleurs pronostics du jour</span>
      <span class="top-banner-sub">Classés par confiance puis probabilité maximale · ${buckets.upcoming.length + buckets.live.length} matchs analysés au total</span>
    </div>` : '';

  // Le detail (quota API, nombre de matchs traites) est purement interne -> sans interet pour
  // un visiteur. Seul ce qui l'aide concrètement (où trouver un match manquant) est montré,
  // et seulement à ceux qui peuvent effectivement s'en servir (recherche = premium/vip/admin).
  const coverageNote = (lastMeta.total > lastMeta.analyzed && canSearch) ? `
    <p style="grid-column:1/-1;font-size:0.78rem;color:var(--muted);margin-bottom:0.75rem">
      🔍 Vous ne trouvez pas un match ? Cherchez l'équipe que vous voulez dans la barre de recherche.
    </p>` : '';

  const sections = [];
  if ((activeStateFilter === 'all' || activeStateFilter === 'upcoming') && upcomingDisplayed.length > 0) {
    sections.push(`<h2 class="section-title">⏳ À venir (${upcomingDisplayed.length})</h2><div class="grid-section">${upcomingDisplayed.map(buildCard).join('')}</div>`);
  }
  if ((activeStateFilter === 'all' || activeStateFilter === 'live') && liveDisplayed.length > 0) {
    sections.push(`<h2 class="section-title">🔴 En cours (${liveDisplayed.length})</h2><div class="grid-section">${liveDisplayed.map(buildCard).join('')}</div>`);
  }
  if ((activeStateFilter === 'all' || activeStateFilter === 'finished') && buckets.finished.length > 0) {
    sections.push(`<h2 class="section-title">✅ Terminés (${buckets.finished.length})</h2><div class="grid-section">${buckets.finished.map(buildFinishedCard).join('')}</div>`);
  }

  if (sections.length === 0) {
    grid.innerHTML = banner + coverageNote + '<p style="color:var(--muted);text-align:center;padding:3rem">Aucun match dans cette catégorie.</p>';
    return;
  }

  grid.innerHTML = banner + coverageNote + sections.join('');
  attachCardClickHandlers(grid, allPredictions);
  attachFinishedCardClickHandlers(grid, allPredictions);
}

function updateApiStatus(used, remaining) {
  if (!currentUserIsAdmin) return; // détail interne, sans intérêt pour un visiteur normal
  const badge = document.getElementById('api-badge');
  const total = used + remaining;
  badge.textContent = `API: ${used}/${total} requêtes`;
  const ratio = total > 0 ? remaining / total : 1;
  badge.className = ratio > 0.3 ? 'ok' : ratio > 0.1 ? 'warn' : 'danger';
}

let searchPredictions = [];

async function searchTeam() {
  const q = searchInput.value.trim();
  if (!q) return;

  btnSearch.disabled = true;
  loading.classList.remove('hidden');
  errorBox.classList.add('hidden');
  searchResults.classList.add('hidden');
  searchResults.innerHTML = '';

  const cacheKey = `rimibra_search_${currentSport}_${datePicker.value}_${q.toLowerCase()}_${currentUserKey}`;

  try {
    let data = localCacheGet(cacheKey);
    if (!data) {
      const res = await fetch(`${apiBase()}/search?date=${datePicker.value}&q=${encodeURIComponent(q)}`, {
        headers: authHeaders(),
      });
      data = await res.json();
      if (res.status === 403 && data.upgradeRequired) {
        throw new Error('La recherche est réservée aux abonnés Premium et plus. Passe à un plan supérieur pour y accéder.');
      }
      if (!res.ok) throw new Error(data.error);
      localCacheSet(cacheKey, data);
    }

    searchPredictions = data.predictions;
    updateApiStatus(data.requestsUsed, data.requestsLeft);

    if (searchPredictions.length === 0) {
      searchResults.innerHTML = `<p style="grid-column:1/-1;color:var(--muted);text-align:center;padding:1.5rem">Aucun match avec « ${escapeHtml(q)} » trouvé pour cette date (${data.total} matchs au total ce jour-là). Essayez avec le nom anglais de l'équipe (ex. « Netherlands » au lieu de « Pays-Bas »).</p>`;
    } else {
      const note = `<p style="grid-column:1/-1;font-size:0.8rem;color:var(--muted)">🔍 ${searchPredictions.length} match(s) trouvé(s) pour « ${escapeHtml(q)} » — analyse à la demande (en dehors de la sélection automatique)</p>`;
      searchResults.innerHTML = note + searchPredictions.map(buildCard).join('');
      attachCardClickHandlers(searchResults, searchPredictions);
    }
    searchResults.classList.remove('hidden');
  } catch (err) {
    errorBox.style = '';
    errorBox.textContent = 'Erreur recherche: ' + err.message;
    errorBox.classList.remove('hidden');
  } finally {
    loading.classList.add('hidden');
    btnSearch.disabled = false;
  }
}

btnSearch.addEventListener('click', searchTeam);
searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchTeam(); });

btnLoad.addEventListener('click', () => {
  if (currentSport === 'combos') return loadCombos(datePicker.value);
  loadPredictions(datePicker.value, { force: true });
});
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

stateFilters.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    stateFilters.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeStateFilter = btn.dataset.state;
    renderGrid(allPredictions);
  });
});

async function initStatus() {
  try {
    const res = await fetch(`${apiBase()}/status`, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) return;
    updateApiStatus(data.used, data.remaining);
  } catch {}
}

function comboDateLabel(date) {
  const target = new Date(`${date}T00:00:00`);
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target - today0) / 86400000);
  const formatted = target.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  if (diffDays === 0) return `Aujourd'hui (${formatted})`;
  if (diffDays === 1) return `Demain (${formatted})`;
  if (diffDays === -1) return `Hier (${formatted})`;
  return formatted;
}

async function loadCombos(date) {
  // Même garde que loadPredictions : si l'utilisateur quitte l'onglet Combinés avant la
  // fin du chargement, on ignore la réponse tardive au lieu d'écraser l'onglet courant.
  const requestSport = currentSport;

  loading.classList.remove('hidden');
  errorBox.classList.add('hidden');
  grid.innerHTML = '';
  appTitle.textContent = `🎯 Combinés — ${comboDateLabel(date)}`;

  try {
    const res = await fetch(`/api/combos/today?date=${date}`, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (currentSport !== requestSport) return;

    if (data.groups.length === 0) {
      grid.innerHTML = '<p style="color:var(--muted);text-align:center;padding:3rem">Pas assez de matchs fiables ce jour-là pour construire un combiné.</p>';
      return;
    }

    const limitNote = data.limit != null && data.totalAvailable > data.groups.length ? `
      <p style="grid-column:1/-1;font-size:0.8rem;color:var(--muted);margin-bottom:0.75rem">
        🔒 ${data.groups.length}/${data.totalAvailable} sports affichés (plan Premium limité à ${data.limit}) — passe VIP pour tous les voir.
      </p>` : '';

    grid.innerHTML = limitNote + data.groups.map(buildComboGroup).join('');
    attachComboMatchClickHandlers(grid);
  } catch (err) {
    if (currentSport !== requestSport) return;
    errorBox.textContent = 'Erreur : ' + err.message;
    errorBox.classList.remove('hidden');
  } finally {
    if (currentSport === requestSport) loading.classList.add('hidden');
  }
}

function comboMatchStatusBadge(m) {
  if (!m.finished) return '<span class="combo-match-status pending">⏳ En attente</span>';
  if (m.validated === true) return '<span class="combo-match-status validated">✅ Validé</span>';
  if (m.validated === false) return '<span class="combo-match-status failed">❌ Non validé</span>';
  return '<span class="combo-match-status pending">⚠️ Score non confirmé</span>';
}

function buildComboMatch(m, sportKey) {
  const time = new Date(m.fixture.date).toLocaleString('fr-FR');
  return `
    <div class="combo-match ${m.finished ? (m.validated ? 'is-validated' : 'is-failed') : ''}" data-id="${m.fixture.id}" data-sport="${sportKey}">
      <div class="combo-match-league">${m.fixture.league} · ${time}</div>
      <div class="combo-match-teams">${m.fixture.home} vs ${m.fixture.away}</div>
      <div class="combo-match-pick">✓ ${m.pick} <span class="combo-match-prob">${m.probability}%</span></div>
      ${comboMatchStatusBadge(m)}
    </div>`;
}

const RISK_EMOJI = { Faible: '🟢', Moyenne: '🟡', Élevée: '🔴' };
const STATUS_CLASS = { won: 'combo-won', lost: 'combo-lost', active: '' };

function buildComboCard(combo, sequence, sportKey) {
  const progressLabel = combo.status === 'lost'
    ? '❌ Combiné perdu'
    : combo.status === 'won'
      ? '🏆 Combiné gagné !'
      : `${combo.validatedCount}/${combo.totalCount} matchs validés`;

  return `
    <div class="combo-card ${STATUS_CLASS[combo.status] || ''}">
      <div class="combo-sport-label">Combiné n°${sequence}${combo.status !== 'active' ? ' · terminé' : ' · en cours'}</div>
      ${combo.matches.map((m) => buildComboMatch(m, sportKey)).join('<div class="combo-plus">+</div>')}
      <div class="combo-summary">
        <span class="combo-combined-prob">Probabilité combinée : ${combo.combinedProbability}%</span>
        <span class="combo-risk">${RISK_EMOJI[combo.risk] || ''} Risque ${combo.risk}</span>
      </div>
      <div class="combo-progress">${progressLabel}</div>
    </div>`;
}

function buildComboGroup(group) {
  const cards = group.combos.map((c, i) => buildComboCard(c, i + 1, group.sportKey)).reverse().join(''); // le plus récent en premier
  return `
    <div class="combo-sport-group">
      <h2 class="section-title">${group.sport} (${group.combos.length} combiné${group.combos.length > 1 ? 's' : ''} aujourd'hui)</h2>
      <div class="grid-section combo-grid">${cards}</div>
    </div>`;
}

function comboMatchEndpoint(sportKey, id) {
  return sportKey === 'football' ? `${SPORTS[sportKey].base}/fixture/${id}` : `${SPORTS[sportKey].base}/game/${id}`;
}

function attachComboMatchClickHandlers(container) {
  container.querySelectorAll('.combo-match').forEach((el) => {
    el.addEventListener('click', async () => {
      const id = el.dataset.id;
      const sportKey = el.dataset.sport;
      const finished = el.classList.contains('is-validated') || el.classList.contains('is-failed');
      modalContent.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--muted)">Chargement…</p>';
      modal.classList.remove('hidden');
      try {
        const res = await fetch(comboMatchEndpoint(sportKey, id), { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Analyse impossible');
        modalContent.innerHTML = finished ? buildValidationContent(data) : buildModalContent(data);
      } catch (err) {
        modalContent.innerHTML = `<p style="color:var(--red)">Erreur : ${err.message}</p>`;
      }
    });
  });
}

sportTabs.querySelectorAll('.sport-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.sport === currentSport) return;
    sportTabs.querySelectorAll('.sport-tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentSport = btn.dataset.sport;
    searchResults.classList.add('hidden');
    searchResults.innerHTML = '';
    errorBox.classList.add('hidden');

    if (currentSport === 'combos') {
      appTitle.textContent = '🎯 Combinés';
      topFilters.classList.add('hidden');
      stateFilters.classList.add('hidden');
      searchInput.classList.add('hidden');
      btnSearch.classList.add('hidden');
      btnDayPrev.classList.remove('hidden');
      btnDayNext.classList.remove('hidden');
      loadCombos(datePicker.value);
      return;
    }

    searchInput.classList.remove('hidden');
    btnSearch.classList.remove('hidden');
    btnDayPrev.classList.add('hidden');
    btnDayNext.classList.add('hidden');
    appTitle.textContent = SPORTS[currentSport].title;
    activeStateFilter = 'all';
    stateFilters.querySelectorAll('.filter-btn').forEach((b) => b.classList.toggle('active', b.dataset.state === 'all'));
    initStatus();
    loadPredictions(datePicker.value);
  });
});

function shiftDate(days) {
  const d = new Date(`${datePicker.value}T00:00:00`);
  d.setDate(d.getDate() + days);
  datePicker.value = d.toISOString().split('T')[0];
  loadCombos(datePicker.value);
}

btnDayPrev.addEventListener('click', () => shiftDate(-1));
btnDayNext.addEventListener('click', () => shiftDate(1));

renderAccountStatus().then(() => {
  initStatus();
  loadPredictions(today);
});
