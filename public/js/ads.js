// Pub récompensée — VERSION PLACEHOLDER tant qu'aucun compte Google (AdSense/Ad Manager
// pour le web, AdMob plus tard si l'app est empaquetée) n'est branché. Simule le visionnage
// avec un décompte visuel, pour que tout le reste du système (déblocage, persistance,
// affichage) soit déjà fonctionnel et testable.
//
// À REMPLACER dès qu'un vrai compte existe : charger le SDK Google, écouter son événement de
// complétion réel (ex: onAdViewed d'un rewarded web ad Ad Manager), et n'appeler onComplete()
// qu'à cet événement — jamais sur un simple minuteur côté client (trivialement contournable).
const AD_SIMULATION_SECONDS = 5;

function showRewardedAd(onComplete, onCancel) {
  const overlay = document.createElement('div');
  overlay.className = 'ad-overlay';
  overlay.innerHTML = `
    <div class="ad-box">
      <div class="ad-label">📺 Publicité (simulation — aucun compte pub branché)</div>
      <div class="ad-countdown" id="ad-countdown">${AD_SIMULATION_SECONDS}</div>
      <button class="ad-cancel" id="ad-cancel-btn">Annuler</button>
    </div>`;
  document.body.appendChild(overlay);

  let remaining = AD_SIMULATION_SECONDS;
  const countdownEl = overlay.querySelector('#ad-countdown');
  const timer = setInterval(() => {
    remaining -= 1;
    countdownEl.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(timer);
      overlay.remove();
      onComplete();
    }
  }, 1000);

  overlay.querySelector('#ad-cancel-btn').addEventListener('click', () => {
    clearInterval(timer);
    overlay.remove();
    if (onCancel) onCancel();
  });
}

// Appelle le serveur pour enregistrer le déblocage une fois la pub "vue" — voir
// routes/ads.js pour l'avertissement sur l'absence de vérification serveur réelle (SSV).
async function unlockBreakdown(sport, fixtureId) {
  const res = await fetch('/api/ads/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ sport, fixtureId }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Déblocage impossible');
  return res.json();
}
