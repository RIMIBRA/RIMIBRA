const forgotForm = document.getElementById('forgot-form');
const forgotError = document.getElementById('forgot-error');
const forgotSuccess = document.getElementById('forgot-success');

// Si déjà connecté, retour direct à l'app
fetchCurrentUser().then((user) => { if (user) window.location.href = '/'; });

forgotForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  forgotError.classList.add('hidden');
  forgotSuccess.classList.add('hidden');
  const email = document.getElementById('forgot-email').value.trim();
  const submitBtn = forgotForm.querySelector('button');

  try {
    submitBtn.disabled = true;
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Envoi impossible');
    forgotSuccess.textContent = data.message;
    forgotSuccess.classList.remove('hidden');
    forgotForm.reset();
  } catch (err) {
    forgotError.textContent = err.message;
    forgotError.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
  }
});
