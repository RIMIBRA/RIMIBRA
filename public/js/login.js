const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const authError = document.getElementById('auth-error');
const tabs = document.querySelectorAll('.auth-tab');

// Si déjà connecté, retour direct à l'app
fetchCurrentUser().then((user) => { if (user) window.location.href = '/'; });

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const isLogin = tab.dataset.tab === 'login';
    loginForm.classList.toggle('hidden', !isLogin);
    registerForm.classList.toggle('hidden', isLogin);
    authError.classList.add('hidden');
  });
});

function showError(message) {
  authError.textContent = message;
  authError.classList.remove('hidden');
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.classList.add('hidden');
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Connexion impossible');
    setToken(data.token);
    window.location.href = '/';
  } catch (err) {
    showError(err.message);
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.classList.add('hidden');
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Inscription impossible');
    setToken(data.token);
    // Tenté ICI (dans le gestionnaire du clic "Créer mon compte"), pas après la redirection :
    // rester dans le geste utilisateur augmente les chances que le navigateur affiche vraiment
    // sa popup d'autorisation au lieu de la bloquer silencieusement (heuristique anti-spam de
    // Chrome notamment sur les demandes de permission hors interaction directe). silent=true :
    // un refus ou une erreur ne doit jamais bloquer l'inscription elle-même.
    if (typeof enablePushNotifications === 'function' && pushSupported()) {
      await enablePushNotifications(true).catch(() => {});
    }
    window.location.href = '/';
  } catch (err) {
    showError(err.message);
  }
});
