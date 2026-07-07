const pricingGrid = document.getElementById('pricing-grid');
const pricingError = document.getElementById('pricing-error');

function showError(message) {
  pricingError.textContent = message;
  pricingError.classList.remove('hidden');
}

async function loadPlans() {
  const token = getToken();
  if (!token) {
    window.location.href = '/login.html';
    return;
  }

  const res = await fetch('/api/auth/plans');
  const { plans } = await res.json();

  pricingGrid.innerHTML = plans.map((plan) => `
    <div class="pricing-card plan-${plan.plan}">
      <div class="pricing-plan-name">${plan.plan === 'vip' ? '👑 VIP' : '⭐ Premium'}</div>
      <div class="pricing-price">${plan.price_fcfa} FCFA</div>
      <div class="pricing-duration">${plan.duration_days} jours</div>
      <button class="pricing-buy-btn" data-plan-id="${plan.id}">Payer avec GeniusPay</button>
    </div>
  `).join('');

  pricingGrid.querySelectorAll('.pricing-buy-btn').forEach((btn) => {
    btn.addEventListener('click', () => startCheckout(btn));
  });
}

async function startCheckout(btn) {
  btn.disabled = true;
  btn.textContent = 'Redirection…';
  try {
    const res = await fetch('/api/payments/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ planId: Number(btn.dataset.planId) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur lors de la création du paiement');
    window.location.href = data.checkoutUrl;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Payer avec GeniusPay';
    showError(err.message);
  }
}

loadPlans().catch((err) => showError(err.message));
