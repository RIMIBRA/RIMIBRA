const resetForm = document.getElementById('reset-form');
const resetInvalid = document.getElementById('reset-invalid');
const resetError = document.getElementById('reset-error');

const token = new URLSearchParams(window.location.search).get('token');

async function checkToken() {
  if (!token) {
    resetInvalid.classList.remove('hidden');
    return;
  }
  try {
    const res = await fetch(`/api/auth/reset-password/${encodeURIComponent(token)}`);
    const data = await res.json();
    if (res.ok && data.valid) {
      resetForm.classList.remove('hidden');
    } else {
      resetInvalid.classList.remove('hidden');
    }
  } catch {
    resetInvalid.classList.remove('hidden');
  }
}

checkToken();

resetForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  resetError.classList.add('hidden');
  const password = document.getElementById('reset-password').value;
  const confirm = document.getElementById('reset-password-confirm').value;
  const submitBtn = resetForm.querySelector('button');

  if (password !== confirm) {
    resetError.textContent = 'Les deux mots de passe ne correspondent pas';
    resetError.classList.remove('hidden');
    return;
  }

  try {
    submitBtn.disabled = true;
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Réinitialisation impossible');
    setToken(data.token);
    window.location.href = '/';
  } catch (err) {
    resetError.textContent = err.message;
    resetError.classList.remove('hidden');
    submitBtn.disabled = false;
  }
});
