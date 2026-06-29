// Helpers d'authentification partagés entre login.html et l'app principale
const AUTH_TOKEN_KEY = 'rimibra_token';

function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function setToken(token) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchCurrentUser() {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch('/api/auth/me', { headers: authHeaders() });
    if (!res.ok) { clearToken(); return null; }
    return await res.json();
  } catch {
    return null;
  }
}
