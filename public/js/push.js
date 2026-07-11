// Notifications push (combinés spéciaux créés/résolus) — partagé entre login.html (activation
// automatique à l'inscription) et index.html (bouton dans la barre de compte). Dépend de
// auth.js (authHeaders), chargé avant ce fichier sur les deux pages.

// applicationServerKey attend un Uint8Array, pas la chaîne base64url brute renvoyée par le
// serveur -> conversion standard pour l'API Push.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

async function getExistingPushSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js').catch(() => null);
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

// silent=true (déclenchement automatique, ex. à l'inscription) : aucune alerte en cas d'échec
// ou de refus -- ça n'est censé perturber ni bloquer le flux (inscription, navigation), juste
// tenter l'activation. silent=false (bouton manuel) : l'utilisateur voit l'erreur puisqu'il a
// explicitement demandé l'action.
async function enablePushNotifications(silent = false) {
  try {
    if (!pushSupported()) {
      if (!silent) alert('Les notifications push ne sont pas supportées par ce navigateur.');
      return false;
    }
    const reg = await navigator.serviceWorker.register('/sw.js');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;

    const keyRes = await fetch('/api/push/vapid-public-key');
    const keyData = await keyRes.json();
    if (!keyRes.ok) throw new Error(keyData.error || 'Notifications indisponibles pour le moment');

    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
    });

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Échec de l'enregistrement de l'abonnement");
    return true;
  } catch (err) {
    if (!silent) alert("Impossible d'activer les notifications : " + err.message);
    return false;
  }
}

async function disablePushNotifications() {
  const sub = await getExistingPushSubscription();
  if (sub) {
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}
