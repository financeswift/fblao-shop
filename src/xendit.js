'use strict';

const crypto = require('crypto');
const { getSetting } = require('./db');

const API_BASE = 'https://api.xendit.co';

function basicAuth() {
  const secretKey = getSetting('xendit_secret_key') || process.env.XENDIT_SECRET_KEY;
  return 'Basic ' + Buffer.from(`${secretKey}:`).toString('base64');
}

function isConfigured() {
  const enabled = getSetting('xendit_enabled') === '1' || process.env.XENDIT_ENABLED === '1';
  const secretKey = getSetting('xendit_secret_key') || process.env.XENDIT_SECRET_KEY;
  return enabled && !!secretKey;
}

/**
 * Create a Xendit Invoice
 */
async function createInvoice(order, baseUrl) {
  const payload = {
    external_id: order.order_number,
    amount: order.total,
    description: `Order #${order.order_number}`,
    invoice_duration: 86400, // 24 hours
    currency: order.currency || 'PHP',
    customer: {
      given_names: order.telegram_username || 'Customer',
      email: order.email || `${order.telegram_username}@t.me`
    },
    items: [
      {
        name: `Order #${order.order_number}`,
        quantity: 1,
        price: order.total
      }
    ],
    success_redirect_url: `${baseUrl}/order/result?ref=${encodeURIComponent(order.order_number)}&status=success`,
    failure_redirect_url: `${baseUrl}/order/result?ref=${encodeURIComponent(order.order_number)}&status=failure`
  };

  const res = await fetch(`${API_BASE}/v2/invoices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: basicAuth()
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Xendit error');
  }

  return {
    invoiceId: data.id,
    invoiceUrl: data.invoice_url
  };
}

function verifyWebhookToken(token) {
  const callbackToken = getSetting('xendit_callback_token') || process.env.XENDIT_CALLBACK_TOKEN;
  if (!callbackToken) return true; // If not set, we can't verify but we'll accept (or skip)
  return token === callbackToken;
}

module.exports = {
  isConfigured,
  createInvoice,
  verifyWebhookToken
};
