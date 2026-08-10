'use strict';

const crypto = require('crypto');
const { getSetting } = require('./db');

const HOSTS = {
  sandbox: 'https://api-sandbox.magpie.im',
  live: 'https://api.magpie.im',
};

function settingOrEnv(settingKey, envKey, fallback = '') {
  const value = getSetting(settingKey, '') || process.env[envKey] || fallback;
  return String(value || '').trim();
}

function apiBase() {
  const custom = settingOrEnv('magpie_api_base_url', 'MAGPIE_API_BASE_URL');
  if (custom) return custom.replace(/\/$/, '');
  const mode = settingOrEnv('magpie_mode', 'MAGPIE_MODE', 'sandbox').toLowerCase();
  return HOSTS[mode] || HOSTS.sandbox;
}

function isConfigured() {
  const enabled = getSetting('magpie_enabled') === '1' || process.env.MAGPIE_ENABLED === '1';
  const publicKey = settingOrEnv('magpie_api_key', 'MAGPIE_API_KEY');
  const secretKey = settingOrEnv('magpie_api_secret', 'MAGPIE_API_SECRET');
  return enabled && !!publicKey && !!secretKey;
}

/**
 * Create a payment source and charge via the Magpie v1.1 API.
 *
 * Magpie Alipay/WeChat flow:
 *   Step 1 — POST /v1.1/sources (auth: public key)
 *             Body: { type, currency, amount, redirect: { success, fail } }
 *             Response: { id, redirect: { checkout_url } }
 *   Step 2 — POST /v1.1/charges (auth: secret key)
 *             Body: { amount, currency, source, description, referenceNumber }
 *             Response: { id, status, source: { redirect: { checkout_url } } }
 *
 * The app now supports a configurable target currency (magpie_target_currency).
 * If the target currency differs from the store currency, the amount is converted
 * using a public exchange API before creating the checkout. On conversion failures
 * we fall back to the legacy behavior (PHP).
 *
 * Amounts are sent in the smallest unit of the target currency (e.g. cents).
 *
 * @param {object} order
 * @param {string} baseUrl
 * @param {'alipay'|'wechat'} method
 * @returns {{ checkoutId: string, checkoutUrl: string }}
 */
async function createCheckout(order, baseUrl, method = 'alipay') {
  const publicKey = settingOrEnv('magpie_api_key', 'MAGPIE_API_KEY');
  const secretKey = settingOrEnv('magpie_api_secret', 'MAGPIE_API_SECRET');
  if (!publicKey) throw new Error('Magpie public key is not configured');
  if (!secretKey) throw new Error('Magpie secret key is not configured');

  const base = apiBase();
  const sourceType = method === 'wechat' ? 'wechat' : 'alipay';

  // Determine target currency from config (default CNY) and source/store currency
  const targetCurrency = (settingOrEnv('magpie_target_currency', 'MAGPIE_TARGET_CURRENCY', 'CNY') || 'CNY').toUpperCase();
  const storeCurrency = (order.currency || 'PHP').toUpperCase();

  // Amount (numeric) as shown in the store
  const storeAmount = Number(order.total);
  if (Number.isNaN(storeAmount)) throw new Error('Invalid order total');

  // Convert amount to target currency if needed.
  // We use exchangerate.host's public convert endpoint as a simple fallback.
  // If conversion fails, we'll fallback to sending PHP (legacy behaviour).
  let amountInTarget = storeAmount;
  let usedCurrency = storeCurrency;

  if (targetCurrency !== storeCurrency) {
    try {
      const convUrl = `https://api.exchangerate.host/convert?from=${encodeURIComponent(storeCurrency)}&to=${encodeURIComponent(targetCurrency)}&amount=${encodeURIComponent(storeAmount)}`;
      const convRes = await fetch(convUrl, { method: 'GET' });
      if (convRes.ok) {
        const convData = await convRes.json().catch(() => null);
        if (convData && typeof convData.result === 'number') {
          amountInTarget = Number(convData.result);
          usedCurrency = targetCurrency;
        } else {
          console.warn('[Magpie] exchange conversion returned unexpected data, falling back to store currency');
        }
      } else {
        console.warn('[Magpie] exchange conversion failed with status', convRes.status, 'falling back to store currency');
      }
    } catch (e) {
      console.warn('[Magpie] exchange conversion error, falling back to store currency:', e && e.message);
    }
  }

  // Magpie amount is in the smallest currency unit (assume 2 decimal places).
  // For most target currencies (CNY, PHP, USD) this is cents; adjust if you need JPY, etc.
  const amountSmallestUnit = Math.round(Number(amountInTarget) * 100);

  const successUrl = `${baseUrl}/order/result?ref=${encodeURIComponent(order.order_number)}&status=success`;
  const failUrl = `${baseUrl}/order/result?ref=${encodeURIComponent(order.order_number)}&status=cancel`;

  // ── Step 1: Create source ────────────────────────────────────────────────
  const sourcePayload = {
    type: sourceType,
    currency: usedCurrency.toLowerCase(),
    amount: amountSmallestUnit,
    redirect: {
      success: successUrl,
      fail: failUrl,
    },
  };

  const sourceRes = await fetch(`${base}/v1.1/sources`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${publicKey}`,
    },
    body: JSON.stringify(sourcePayload),
  });

  const sourceText = await sourceRes.text();
  let sourceData = {};
  try { sourceData = JSON.parse(sourceText); } catch (_) { /* keep raw */ }

  if (!sourceRes.ok) {
    const msg = sourceData.message || sourceData.error || sourceText || 'Magpie API error';
    throw new Error(`Magpie source creation failed (${sourceRes.status}): ${msg}`);
  }

  const sourceId = sourceData.id;
  if (!sourceId) throw new Error('Magpie source response missing id');

  // ── Step 2: Create charge ─────────────────────────────────────────────────
  const chargePayload = {
    amount: amountSmallestUnit,
    currency: usedCurrency.toLowerCase(),
    source: sourceId,
    description: `Order ${order.order_number} - ${order.product_name}`,
    referenceNumber: String(order.order_number),
  };

  const chargeRes = await fetch(`${base}/v1.1/charges`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secretKey}`,
    },
    body: JSON.stringify(chargePayload),
  });

  const chargeText = await chargeRes.text();
  let chargeData = {};
  try { chargeData = JSON.parse(chargeText); } catch (_) { /* keep raw */ }

  if (!chargeRes.ok) {
    const msg = chargeData.message || chargeData.error || chargeText || 'Magpie API error';
    throw new Error(`Magpie charge creation failed (${chargeRes.status}): ${msg}`);
  }

  const chargeId = chargeData.id;
  if (!chargeId) throw new Error('Magpie charge response missing id');

  // The checkout URL lives in the source's redirect object on the charge response,
  // or may be on the source itself from step 1.
  const checkoutUrl =
    chargeData?.source?.redirect?.checkout_url ||
    chargeData?.redirect?.checkout_url ||
    sourceData?.redirect?.checkout_url ||
    null;

  if (!checkoutUrl) throw new Error('Magpie response missing checkout URL');

  return {
    checkoutId: chargeId,
    checkoutUrl,
  };
}

/**
 * Verify the HMAC-SHA256 signature on an incoming Magpie webhook.
 * Magpie signs the raw JSON body with the webhook secret.
 */
function verifyWebhookSignature(rawBody, signature) {
  const secret = settingOrEnv('magpie_webhook_secret', 'MAGPIE_WEBHOOK_SECRET');
  if (!secret) return { verified: false, skipped: true };
  if (!signature) return { verified: false, skipped: false };

  const incoming = String(signature).split('=').pop().toLowerCase().trim();
  const expected = crypto.createHmac('sha256', secret)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody))
    .digest('hex');

  let ok = false;
  try {
    ok = crypto.timingSafeEqual(Buffer.from(incoming, 'hex'), Buffer.from(expected, 'hex'));
  } catch (_) {
    ok = false;
  }
  return { verified: ok, skipped: false };
}

/**
 * Normalise Magpie status strings to our internal values.
 * Magpie charge statuses: pending | paid | failed | cancelled | refunded
 * Magpie source statuses: pending | chargeable | expired | consumed
 */
function normalizeStatus(raw) {
  if (!raw) return 'pending';
  const s = String(raw).trim().toLowerCase();
  if (['paid', 'success', 'completed', 'settled', 'captured'].includes(s)) return 'paid';
  if (['failed', 'expired', 'cancelled', 'canceled', 'voided', 'declined', 'error', 'refunded'].includes(s)) return 'failed';
  return 'pending';
}

module.exports = {
  isConfigured,
  createCheckout,
  normalizeStatus,
  verifyWebhookSignature,
};
