'use strict';

const crypto = require('crypto');
const { getSetting } = require('./db');

const HOSTS = {
  sandbox: 'https://api-sandbox.swiftpay.ph',
  live: 'https://api.swiftpay.ph',
};

function credentials() {
  return {
    apiKey:
      getSetting('swiftpay_api_key') ||
      process.env.SWIFTPAY_API_KEY ||
      process.env.SWIFTPAY_ACCESS_KEY ||
      '',
    apiSecret:
      getSetting('swiftpay_api_secret') ||
      process.env.SWIFTPAY_API_SECRET ||
      process.env.SWIFTPAY_SECRET_KEY ||
      '',
  };
}

function apiBase() {
  const custom = (getSetting('swiftpay_api_base_url') || process.env.SWIFTPAY_API_BASE_URL || '').trim();
  if (custom) return custom.replace(/\/$/, '');
  const mode = (getSetting('swiftpay_mode', 'sandbox') || 'sandbox').toLowerCase();
  return HOSTS[mode] || HOSTS.sandbox;
}

function isConfigured() {
  const enabled = getSetting('swiftpay_enabled') === '1' || process.env.SWIFTPAY_ENABLED === '1';
  const { apiKey } = credentials();
  return enabled && !!apiKey;
}

function authHeaders() {
  const { apiKey, apiSecret } = credentials();
  if (!apiKey) throw new Error('Swiftpay API key is not configured');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (apiSecret) headers['X-SWIFTPAY-SECRET'] = apiSecret;
  return headers;
}

async function createCheckout(order, baseUrl) {
  const payload = {
    reference_number: order.order_number,
    amount: Number(order.total).toFixed(2),
    currency: order.currency || 'PHP',
    description: `Order ${order.order_number} - ${order.product_name}`,
    customer: {
      telegram_username: order.telegram_username || '',
      email: order.email || `${order.telegram_username}@t.me`,
    },
    redirect_urls: {
      success: `${baseUrl}/order/result?ref=${encodeURIComponent(order.order_number)}&status=success`,
      failure: `${baseUrl}/order/result?ref=${encodeURIComponent(order.order_number)}&status=failure`,
      cancel: `${baseUrl}/order/result?ref=${encodeURIComponent(order.order_number)}&status=cancel`,
    },
    webhook_url: `${baseUrl}/webhooks/swiftpay`,
    metadata: {
      product_name: order.product_name,
      quantity: order.quantity,
    },
  };

  const res = await fetch(`${apiBase()}/v1/checkouts`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch (_) { /* keep raw body */ }

  if (!res.ok) {
    const message = data.message || data.error || text || 'Swiftpay API error';
    throw new Error(`Swiftpay checkout failed (${res.status}): ${message}`);
  }

  const d = data.data || data;
  const checkoutId = d.id || d.checkout_id || d.reference || null;
  const checkoutUrl = d.checkout_url || d.redirect_url || d.url || null;
  if (!checkoutUrl) throw new Error('Swiftpay response missing checkout URL');

  return {
    checkoutId,
    checkoutUrl,
  };
}

function normalizeStatus(raw) {
  if (!raw) return 'pending';
  const s = String(raw).trim().toUpperCase();
  if (['PAID', 'SUCCESS', 'COMPLETED', 'SETTLED', 'CAPTURED'].includes(s)) return 'paid';
  if (['FAILED', 'EXPIRED', 'CANCELLED', 'VOIDED', 'DECLINED', 'ERROR'].includes(s)) return 'failed';
  return 'pending';
}

function verifyWebhookSignature(rawBody, signature) {
  const secret = getSetting('swiftpay_webhook_secret') || process.env.SWIFTPAY_WEBHOOK_SECRET;
  if (!secret) return { verified: false, skipped: true };
  if (!signature) return { verified: false, skipped: false };

  const incoming = String(signature).includes('=') ? String(signature).split('=').pop() : String(signature);
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  let ok = false;
  try {
    ok = crypto.timingSafeEqual(Buffer.from(incoming, 'hex'), Buffer.from(expected, 'hex'));
  } catch (_) {
    ok = false;
  }
  return { verified: ok, skipped: false };
}

module.exports = {
  isConfigured,
  createCheckout,
  normalizeStatus,
  verifyWebhookSignature,
};