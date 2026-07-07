const crypto = require('crypto');

const BASE_URL = 'https://geniuspay.ci/api/v1/merchant';

// Protection anti-rejeu : un webhook signé mais rejoué (capturé puis renvoyé plus tard par un
// attaquant) est refusé au-delà de cette fenêtre, comme recommandé par la doc GeniusPay.
const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

async function createCheckout({ amount, description, customer, metadata, successUrl, errorUrl }) {
  const res = await fetch(`${BASE_URL}/payments`, {
    method: 'POST',
    headers: {
      'X-API-Key': process.env.GENIUSPAY_API_KEY,
      'X-API-Secret': process.env.GENIUSPAY_API_SECRET,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount,
      description,
      customer,
      metadata,
      success_url: successUrl,
      error_url: errorUrl,
    }),
  });

  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error?.message || `GeniusPay a refusé la création du paiement (HTTP ${res.status})`);
  }
  return json.data; // { reference, checkout_url, amount, status, ... }
}

async function getPayment(reference) {
  const res = await fetch(`${BASE_URL}/payments/${encodeURIComponent(reference)}`, {
    headers: {
      'X-API-Key': process.env.GENIUSPAY_API_KEY,
      'X-API-Secret': process.env.GENIUSPAY_API_SECRET,
    },
  });
  const json = await res.json();
  if (!res.ok || !json.success) return null;
  return json.data;
}

// signature = HMAC-SHA256(timestamp + "." + json_payload, secret) — voir doc GeniusPay.
// rawBody doit être la chaîne JSON EXACTE reçue (pas un objet re-sérialisé, qui pourrait
// différer par l'ordre des clés/espacement et faire échouer la comparaison de signature).
function verifyWebhookSignature({ rawBody, signature, timestamp }) {
  if (!signature || !timestamp) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) return false;

  const data = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', process.env.GENIUSPAY_WEBHOOK_SECRET)
    .update(data)
    .digest('hex');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

module.exports = { createCheckout, getPayment, verifyWebhookSignature };
