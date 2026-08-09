'use strict';

const crypto = require('crypto');
const { getSetting } = require('./db');

const HOSTS = {
  sandbox: 'https://api.sandbox.magpie.im',
  live: 'https://api.magpie.im',
};

function credentials() {
  return {
    apiKey:
      getSetting('magpie_api_key') ||
      process.env.MAGPIE_API_KEY ||
      process.env.MAGPIE_SECRET_KEY ||
      '',
    apiSecret:
      getSetting('magpie_api_secret') ||
      process.env.MAGPIE_API_SECRET ||
      process.env.MAGPIE_PUBLISHABLE_KEY ||
      '',
  };
}

function isConfigured() {
  const enabled = getSetting('magpie_enabled') === '1' || process.env.MAGPIE_ENABLED === '1';
  const { apiKey } = credentials();
  return enabled && !!apiKey;
}

function apiBase() {
  const custom = (getSetting('magpie_api_base_url') || process.env.MAGPIE_API_BASE_URL || '').trim();
  if (custom) return custom.replace(/\/$/, '');

  const { apiKey, apiSecret } = credentials();
  const key = String(apiKey || apiSecret).trim();
  const isLive = /^((sk|pk)_live_)/i.test(key);
  return isLive ? HOSTS.live : HOSTS.sandbox;
}

function authHeaders() {
  const { apiKey, apiSecret } = credentials();
  if (!apiKey) throw new Error('Magpie API key is not configured');
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (apiSecret) headers['X-MAGPIE-SECRET'] = apiSecret;
  return headers;
}

async function convertAmount(amount, fromCurrency, toCurrency) {
  const source = String(fromCurrency || 'PHP').toUpperCase();
  const target = String(toCurrency || 'CNY').toUpperCase();
  if (!source || !target || source === target) return Number(amount || 0);

  const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(source)}&to=${encodeURIComponent(target)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('FX lookup failed');
    const data = await res.json();
    const rate = data.rates?.[target];
    if (!rate) throw new Error('FX rate missing');
    return Number(amount || 0) * Number(rate);
  } catch (e) {
    console.warn('Magpie FX conversion failed:', e.message);
    return Number(amount || 0);
  }
}

async function createCheckout(order, baseUrl, method = 'alipay') {
  const { apiKey } = credentials();
  if (!apiKey) throw new Error('Magpie API key is not configured');

  const targetCurrency = (getSetting('magpie_target_currency') || process.env.MAGPIE_TARGET_CURRENCY || 'CNY').toUpperCase();
  const convertedAmount = await convertAmount(order.total, order.currency || 'PHP', targetCurrency);
  const paymentMethod = method === 'wechat' ? 'wechatpay' : 'alipay';

  const payload = {
    reference: order.order_number,
    amount: Number(convertedAmount).toFixed(2),
    currency: targetCurrency,
    payment_method: paymentMethod,
    description: `Order ${order.order_number} - ${order.product_name}`,
    customer: {
      telegram_username: order.telegram_username || '',
      email: order.email || `${order.telegram_username}@t.me`,
    },
    success_url: `${baseUrl}/order/result?ref=${encodeURIComponent(order.order_number)}&status=success`,
    cancel_url: `${baseUrl}/order/result?ref=${encodeURIComponent(order.order_number)}&status=cancel`,
    webhook_url: `${baseUrl}/webhooks/magpie`,
    metadata: {
      product_name: order.product_name,
      quantity: order.quantity,
      original_currency: order.currency || 'PHP',
      original_amount: Number(order.total).toFixed(2),
    },
  };

  const endpoint = `${apiBase()}/v1/payments/checkout`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch (_) { /* keep raw */ }

  if (!res.ok) {
    const message = data.message || data.error || text || 'Magpie API error';
    throw new Error(`Magpie checkout failed (${res.status}): ${message}`);
  }

  const d = data.data || data;
  const checkoutId = d.id || d.checkout_id || d.reference || null;
  const checkoutUrl = d.checkout_url || d.redirect_url || d.url || d.payment_url || null;
  if (!checkoutUrl) throw new Error('Magpie response missing checkout URL');

  return {
    checkoutId,
    checkoutUrl,
  };
}

function verifyWebhookSignature(rawBody, signature) {
  const secret = getSetting('magpie_webhook_secret') || process.env.MAGPIE_WEBHOOK_SECRET;
  if (!secret) return { verified: false, skipped: true };
  if (!signature) return { verified: false, skipped: false };

  const incoming = String(signature).split('=').pop();
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  let ok = false;
  try {
    ok = crypto.timingSafeEqual(Buffer.from(incoming, 'hex'), Buffer.from(expected, 'hex'));
  } catch (_) {
    ok = false;
  }
  return { verified: ok, skipped: false };
}

function normalizeStatus(raw) {
  if (!raw) return 'pending';
  const s = String(raw).trim().toUpperCase();
  if (['PAID', 'SUCCESS', 'COMPLETED', 'SETTLED', 'CAPTURED'].includes(s)) return 'paid';
  if (['FAILED', 'EXPIRED', 'CANCELLED', 'VOIDED', 'DECLINED', 'ERROR'].includes(s)) return 'failed';
  return 'pending';
}

module.exports = {
  isConfigured,
  createCheckout,
  normalizeStatus,
  verifyWebhookSignature,
};
