'use strict';

const crypto = require('crypto');
const { getSetting } = require('./db');

// Maya Checkout API hosts.
// Create-checkout is authenticated with the PUBLIC key; payment lookups use the SECRET key.
const HOSTS = {
  sandbox: 'https://pg-sandbox.paymaya.com',
  live: 'https://pg.paymaya.com',
};

function host() {
  const mode = (getSetting('maya_mode', 'sandbox') || 'sandbox').toLowerCase();
  return HOSTS[mode] || HOSTS.sandbox;
}

function basicAuth(key) {
  // Maya uses HTTP Basic auth with the key as username and an empty password.
  return 'Basic ' + Buffer.from(`${key}:`).toString('base64');
}

function isConfigured() {
  return getSetting('maya_enabled') === '1' && !!getSetting('maya_public_key') && !!getSetting('maya_secret_key');
}

/**
 * Create a Maya hosted checkout for an order.
 * @returns {Promise<{checkoutId:string, redirectUrl:string}>}
 */
async function createCheckout(order, baseUrl) {
  const publicKey = getSetting('maya_public_key');
  if (!publicKey) throw new Error('Maya public key is not configured');

  const currency = order.currency || 'PHP';
  const amount = Number(order.total).toFixed(2);

  const payload = {
    totalAmount: { value: Number(amount), currency },
    buyer: {
      contact: {
        email: order.email || `${order.telegram_username}@t.me`
      }
    },
    items: [
      {
        name: `Order #${order.order_number}`,
        quantity: 1,
        totalAmount: { value: Number(amount), currency },
      },
    ],
    requestReferenceNumber: order.order_number,
    redirectUrl: {
      success: `${baseUrl}/order/result?ref=${encodeURIComponent(order.order_number)}&status=success`,
      failure: `${baseUrl}/order/result?ref=${encodeURIComponent(order.order_number)}&status=failure`,
      cancel: `${baseUrl}/order/result?ref=${encodeURIComponent(order.order_number)}&status=cancel`,
    },
    metadata: {},
  };

  const res = await fetch(`${host()}/checkout/v1/checkouts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: basicAuth(publicKey),
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch (_) { /* keep raw */ }

  if (!res.ok) {
    const msg = data && (data.message || data.error) ? (data.message || data.error) : text;
    throw new Error(`Maya checkout failed (${res.status}): ${msg}`);
  }
  if (!data.redirectUrl || !data.checkoutId) {
    throw new Error('Maya checkout response missing redirectUrl/checkoutId');
  }
  return { checkoutId: data.checkoutId, redirectUrl: data.redirectUrl };
}

/**
 * Retrieve a checkout's payment status from Maya (source of truth for webhooks).
 * Returns the normalized status string or null on failure.
 */
async function getCheckoutStatus(checkoutId) {
  const secretKey = getSetting('maya_secret_key');
  if (!secretKey || !checkoutId) return null;

  const res = await fetch(`${host()}/checkout/v1/checkouts/${encodeURIComponent(checkoutId)}`, {
    method: 'GET',
    headers: { Authorization: basicAuth(secretKey) },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return normalizeStatus(data.paymentStatus || data.status);
}

function normalizeStatus(raw) {
  if (!raw) return 'pending';
  const s = String(raw).toUpperCase();
  if (['PAYMENT_SUCCESS', 'COMPLETED', 'SUCCESS', 'AUTHORIZED', 'PAID'].includes(s)) return 'paid';
  if (['FAILED', 'PAYMENT_FAILED', 'EXPIRED', 'CANCELLED', 'VOIDED'].includes(s)) return 'failed';
  return 'pending';
}

/**
 * Optional HMAC-SHA256 verification of a webhook body using the configured secret.
 * If no webhook secret is configured we skip (and rely on the API lookup instead).
 */
function verifyWebhookSignature(rawBody, signature) {
  const secret = getSetting('maya_webhook_secret');
  if (!secret) return { verified: false, skipped: true };
  if (!signature) return { verified: false, skipped: false };
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  let ok = false;
  try {
    ok = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch (_) {
    ok = false;
  }
  return { verified: ok, skipped: false };
}

module.exports = {
  isConfigured,
  createCheckout,
  getCheckoutStatus,
  normalizeStatus,
  verifyWebhookSignature,
};
