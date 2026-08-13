'use strict';

const crypto = require('crypto');
const { getSetting } = require('./db');

const HOSTS = {
  sandbox: 'https://api.pay.sandbox.live.swiftpay.ph',
  live: 'https://api.pay.live.swiftpay.ph',
};

function settingOrEnv(settingKey, envKey, fallback = '') {
  const value = getSetting(settingKey, '') || process.env[envKey] || fallback;
  return String(value || '').trim();
}

function apiBase() {
  const custom = settingOrEnv('swiftpay_api_base_url', 'SWIFTPAY_API_BASE_URL');
  if (custom) return custom.replace(/\/$/, '');
  const mode = settingOrEnv('swiftpay_mode', 'SWIFTPAY_MODE', 'sandbox').toLowerCase();
  return HOSTS[mode] || HOSTS.sandbox;
}

function isConfigured() {
  const enabled = getSetting('swiftpay_enabled') === '1' || process.env.SWIFTPAY_ENABLED === '1';
  const accessKey = settingOrEnv('swiftpay_api_key', 'SWIFTPAY_API_KEY');
  const secretKey = settingOrEnv('swiftpay_api_secret', 'SWIFTPAY_API_SECRET');
  return enabled && !!accessKey && !!secretKey;
}

/**
 * Compute the HMAC-SHA256 signature required by SwiftPay.
 * All request fields whose key starts with "x_" are sorted alphabetically,
 * concatenated as key+value (no separators), then signed with the secret key.
 */
function computeSignature(params, secretKey) {
  const xParams = Object.keys(params)
    .filter(k => k.startsWith('x_'))
    .sort();
  const message = xParams.map(k => `${k}${params[k]}`).join('');
  return crypto.createHmac('sha256', secretKey).update(message).digest('hex');
}

/**
 * Create an order (initialize payment) via SwiftPay's /api/orders endpoint.
 * Returns { checkoutId, checkoutUrl } where checkoutUrl is the customerRedirectUrl
 * the customer should be sent to.
 *
 * @param {object} order
 * @param {string} baseUrl  - the store base URL (for callback/redirect)
 * @param {string|null} institutionCode - optional SwiftPay institution code
 *   (e.g. 'GCASH', 'MAYA', 'GRABPAY', 'SHOPEEPAY', 'CARD') to skip the
 *   institution selection screen and send the customer directly to the
 *   chosen payment method.
 */
async function createCheckout(order, baseUrl, institutionCode = null) {
  const accessKey = settingOrEnv('swiftpay_api_key', 'SWIFTPAY_API_KEY');
  const secretKey = settingOrEnv('swiftpay_api_secret', 'SWIFTPAY_API_SECRET');
  if (!accessKey) throw new Error('SwiftPay access key is not configured');
  if (!secretKey) throw new Error('SwiftPay secret key is not configured');

  // Amount must be a positive decimal with exactly 2 decimal places.
  const amount = Number(order.total).toFixed(2);

  const params = {
    x_access_key: accessKey,
    x_reference_no: String(order.order_number),
    x_amount: amount,
    // Details object is required (can be empty object — sent as JSON array/object).
    details: [
      {
        customerName: order.telegram_username || '',
        customerAddress: {},
        items: [{ name: `Order #${order.order_number}`, quantity: 1, amount }],
      },
    ],
    // Ask SwiftPay to return the customer redirect URL.
    generate_customer_redirect_url: true,
  };

  // If an institution code is provided, embed it so SwiftPay skips the selection screen.
  if (institutionCode) {
    params.institution_code = institutionCode;
  }

  // Sign the request.
  params.signature = computeSignature(params, secretKey);

  const res = await fetch(`${apiBase()}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch (_) { /* keep raw */ }

  if (!res.ok) {
    const message = data.message || data.error || text || 'SwiftPay API error';
    throw new Error(`SwiftPay order creation failed (${res.status}): ${message}`);
  }

  // The response contains { customerRedirectUrl: "https://pay.swiftpay.ph/api/bootstrap?..." }
  const checkoutUrl = data.customerRedirectUrl || data.redirect_url || null;
  if (!checkoutUrl) throw new Error('SwiftPay response missing customerRedirectUrl');

  // Use the reference number as the checkout ID for status lookups.
  const checkoutId = String(order.order_number);

  return { checkoutId, checkoutUrl };
}

/**
 * Bootstrap a QR Ph payment.
 * Endpoint: POST /api/bootstrap/qrph
 * Returns { paymentId, qrCode } — the qrCode is a raw QR string (not a URL).
 * The QR image can then be fetched from GET /api/payments/qrph/image
 * with header X-Swiftpay-Payment-Token: {paymentId}
 *
 * @param {object} order
 * @param {'P2P'|'P2M'} type - P2P = sender covers transfer cost (default), P2M = receiver covers it
 */
async function createQrph(order, type = 'P2P') {
  const accessKey = settingOrEnv('swiftpay_api_key', 'SWIFTPAY_API_KEY');
  const secretKey = settingOrEnv('swiftpay_api_secret', 'SWIFTPAY_API_SECRET');
  if (!accessKey) throw new Error('SwiftPay access key is not configured');
  if (!secretKey) throw new Error('SwiftPay secret key is not configured');

  const amount = Number(order.total).toFixed(2);

  const params = {
    x_access_key: accessKey,
    x_reference_no: String(order.order_number),
    x_amount: amount,
    x_currency: 'PHP',
  };

  params.signature = computeSignature(params, secretKey);

  // type is a URL query param, not part of the request body
  const url = `${apiBase()}/api/bootstrap/qrph?type=${encodeURIComponent(type)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch (_) { /* keep raw */ }

  if (!res.ok) {
    const message = data.message || data.error || text || 'SwiftPay API error';
    throw new Error(`SwiftPay QR Ph bootstrap failed (${res.status}): ${message}`);
  }

  // Response: { paymentId, paymentStatus, referenceNo, amount, bankAccountNumber, instapayBankCode, qrCode }
  const paymentId = data.paymentId;
  const qrCode = data.qrCode;
  if (!paymentId) throw new Error('SwiftPay QR Ph response missing paymentId');
  if (!qrCode) throw new Error('SwiftPay QR Ph response missing qrCode');

  return { paymentId, qrCode };
}

/**
 * Get the QR image URL for a QR Ph payment.
 * The caller should proxy this from their server (it requires the X-Swiftpay-Payment-Token header).
 */
function qrphImageUrl(paymentId) {
  return `${apiBase()}/api/payments/qrph/image`;
}

/**
 * Query payment status by reference number.
 * Endpoint: GET /api/payments/status/query?accessKey=...&referenceNo=...
 * Returns a normalised status string: 'paid' | 'failed' | 'pending'
 */
async function getCheckoutStatus(checkoutId) {
  if (!checkoutId) return null;

  const accessKey = settingOrEnv('swiftpay_api_key', 'SWIFTPAY_API_KEY');
  if (!accessKey) throw new Error('SwiftPay access key is not configured');

  const url = new URL(`${apiBase()}/api/payments/status/query`);
  url.searchParams.set('accessKey', accessKey);
  url.searchParams.set('referenceNo', String(checkoutId));

  const res = await fetch(url.toString(), { method: 'GET' });

  const text = await res.text();
  let data = [];
  try { data = JSON.parse(text); } catch (_) { /* keep raw */ }

  if (!res.ok) {
    const msg = (Array.isArray(data) ? '' : data.message) || text || 'SwiftPay API error';
    throw new Error(`SwiftPay status lookup failed (${res.status}): ${msg}`);
  }

  // Response is an array of payment objects. Take the most recent one.
  if (!Array.isArray(data) || data.length === 0) return 'pending';

  // Sort by createdOn descending (most recent first) if there are multiple entries.
  const sorted = data.slice().sort((a, b) => {
    return new Date(b.createdOn || 0) - new Date(a.createdOn || 0);
  });

  return normalizeStatus(sorted[0].paymentStatus);
}

/**
 * List available institutions from SwiftPay (returns array of institution objects)
 */
async function listInstitutions() {
  const url = `${apiBase()}/api/institutions`;
  const res = await fetch(url, { method: 'GET' });
  const text = await res.text();
  let data = [];
  try { data = JSON.parse(text); } catch (_) { /* keep raw */ }
  if (!res.ok) throw new Error(`SwiftPay institutions fetch failed (${res.status}): ${text}`);
  return Array.isArray(data) ? data : [];
}

/**
 * Normalise SwiftPay status strings to our internal values.
 * SwiftPay statuses: PENDING | EXECUTED | CANCELED | REJECTED | EXPIRED
 */
function normalizeStatus(raw) {
  if (!raw) return 'pending';
  const s = String(raw).trim().toUpperCase();
  if (s === 'EXECUTED') return 'paid';
  if (['CANCELED', 'REJECTED', 'EXPIRED'].includes(s)) return 'failed';
  return 'pending'; // PENDING and anything unknown
}

/**
 * Verify the HMAC-SHA256 signature on an incoming webhook/callback from SwiftPay.
 * The callback parameters starting with x_ are sorted, concatenated, and verified
 * against the provided signature using our secret key.
 */
function verifyWebhookSignature(params, incomingSignature) {
  const secretKey = settingOrEnv('swiftpay_api_secret', 'SWIFTPAY_API_SECRET');
  if (!secretKey) return { verified: false, skipped: true };
  if (!incomingSignature) return { verified: false, skipped: false };

  const expected = computeSignature(params, secretKey);
  const incoming = String(incomingSignature).toLowerCase().trim();

  let ok = false;
  try {
    ok = crypto.timingSafeEqual(
      Buffer.from(incoming, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch (_) {
    ok = false;
  }
  return { verified: ok, skipped: false };
}

module.exports = {
  isConfigured,
  createCheckout,
  createQrph,
  qrphImageUrl,
  getCheckoutStatus,
  normalizeStatus,
  verifyWebhookSignature,
  listInstitutions,
};
