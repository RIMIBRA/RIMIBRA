const title = document.getElementById('payment-title');
const message = document.getElementById('payment-message');
const continueLink = document.getElementById('payment-continue');

// Le plan n'est activé que par le webhook GeniusPay (voir routes/payments.js) — cette page
// se contente d'attendre/afficher ce résultat, elle ne l'active jamais elle-même : sinon
// n'importe qui pourrait naviguer directement ici sans avoir payé.
async function pollStatus() {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  if (!ref) {
    title.textContent = '⚠️ Référence de paiement manquante';
    return;
  }

  const token = getToken();
  const maxAttempts = 20; // ~40s d'attente max (webhook généralement quasi instantané)
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`/api/payments/status/${ref}`, { headers: authHeaders() });
      const data = await res.json();
      if (data.status === 'completed') {
        title.textContent = '✅ Paiement confirmé !';
        message.textContent = 'Ton abonnement est actif. Bon match !';
        continueLink.classList.remove('hidden');
        return;
      }
      if (['failed', 'cancelled', 'expired'].includes(data.status)) {
        title.textContent = '❌ Paiement non confirmé';
        message.textContent = "Le paiement n'a pas abouti. Tu peux réessayer depuis la page des abonnements.";
        return;
      }
    } catch {
      // tant pis pour cette tentative, on retente
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  title.textContent = '⏳ Toujours en attente';
  message.textContent = "La confirmation prend plus de temps que prévu — recharge cette page dans une minute, ou vérifie ton compte.";
  continueLink.classList.remove('hidden');
}

pollStatus();
