'use strict';

const crypto = require('crypto');
const { getSetting } = require('./db');

const API_BASE = 'https://api.paymongo.com/v1';

function basicAuth() {
  const secretKey = getSetting('paymongo_secret_key') || process.env.PAYMONGO_SECRET_KEY;
  return 'Basic ' + Buffer.from(`${secretKey}:`).toString('base64');
}

function isConfigured() {
  const enabled = getSetting('paymongo_enabled') === '1' || process.env.PAYMONGO_ENABLED === '1';
  const secretKey = getSetting('paymongo_secret_key') || process.env.PAYMONGO_SECRET_KEY;
  return enabled && !!secretKey;
}

/**
 * Create a PayMongo Checkout Session
 */
async function createCheckoutSession(order, baseUrl) {
  const amount = Math.round(order.total * 100); // PayMongo uses centavos/sub-units

  const payload = {
    data: {
      attributes: {
        send_email_receipt: false,
        show_description: true,
        show_line_items: true,
        description: `Order #${order.order_number}`,
        line_items: [
          {
            amount: amount,
            currency: order.currency || 'PHP',
            description: 'Payment',
            name: `Order #${order.order_number}`,
            quantity: 1
          }
        ],
        payment_method_types: ['gcash', 'paymaya', 'grab_pay', 'card', 'dob', 'dob_ubp', 'billease'],
        reference_number: order.order_number,
        success_url: `${baseUrl}/order/result?ref=${encodeURIComponent(order.order_number)}&status=success`,
        cancel_url: `${baseUrl}/order/result?ref=${encodeURIComponent(order.order_number)}&status=cancel`
      }
    }
  };

  const res = await fetch(`${API_BASE}/checkout_sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: basicAuth()
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) {
    const error = data.errors ? data.errors[0].detail : 'PayMongo error';
    throw new Error(error);
  }

  return {
    sessionId: data.data.id,
    checkoutUrl: data.data.attributes.checkout_url
  };
}

function verifyWebhookSignature(rawBody, signature) {
  const webhookSecret = getSetting('paymongo_webhook_secret') || process.env.PAYMONGO_WEBHOOK_SECRET;
  if (!webhookSecret) return { verified: false, skipped: true };
  if (!signature) return { verified: false, skipped: false };

  // PayMongo signature format: t=<timestamp>,te=<signature>,li=<signature>
  const parts = signature.split(',');
  const timestamp = parts.find(p => p.startsWith('t='))?.split('=')[1];
  const testSig = parts.find(p => p.startsWith('te='))?.split('=')[1];
  const liveSig = parts.find(p => p.startsWith('li='))?.split('=')[1];

  const sigToVerify = liveSig || testSig;
  if (!timestamp || !sigToVerify) return { verified: false, skipped: false };

  const payload = timestamp + '.' + rawBody;
  const expected = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');

  let ok = false;
  try {
    ok = crypto.timingSafeEqual(Buffer.from(sigToVerify, 'hex'), Buffer.from(expected, 'hex'));
  } catch (_) {
    ok = false;
  }
  return { verified: ok, skipped: false };
}

module.exports = {
  isConfigured,
  createCheckoutSession,
  verifyWebhookSignature
};
