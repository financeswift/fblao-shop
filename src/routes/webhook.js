'use strict';

const express = require('express');
const router = express.Router();
const maya = require('../maya');
const coins = require('../coins');
const paymongo = require('../paymongo');
const xendit = require('../xendit');
const swiftpay = require('../swiftpay');
const magpie = require('../magpie');
const StoreService = require('../services/store');

// PayMongo webhook
router.post('/paymongo', async (req, res) => {
  try {
    const signature = req.get('Paymongo-Signature') || '';
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
    const sig = paymongo.verifyWebhookSignature(rawBody, signature);

    if (!sig.skipped && !sig.verified) {
      return res.status(401).json({ error: 'invalid signature' });
    }

    const body = req.body || {};
    const eventType = body.data?.attributes?.type;

    if (eventType === 'checkout_session.payment.paid') {
      const session = body.data.attributes.data;
      const orderNumber = session.attributes.reference_number;
      const order = StoreService.getOrder(orderNumber);
      if (order) {
        StoreService.updateOrderStatus(order.id, 'paid', "datetime('now')");
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('paymongo webhook error', e);
    return res.status(200).json({ ok: false, error: e.message });
  }
});

// Xendit webhook
router.post('/xendit', async (req, res) => {
  try {
    const token = req.get('x-callback-token');
    if (!xendit.verifyWebhookToken(token)) {
      return res.status(401).json({ error: 'invalid token' });
    }

    const body = req.body || {};
    // Xendit Invoices send 'status' in the body
    const orderNumber = body.external_id;
    const status = body.status;

    if (orderNumber) {
      const order = StoreService.getOrder(orderNumber);
      if (order) {
        if (status === 'PAID' || status === 'SETTLED') {
          StoreService.updateOrderStatus(order.id, 'paid', "datetime('now')");
        } else if (status === 'EXPIRED') {
          if (order.status === 'pending') {
            StoreService.updateOrderStatus(order.id, 'failed');
          }
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('xendit webhook error', e);
    return res.status(200).json({ ok: false, error: e.message });
  }
});

// Swiftpay PH webhook / callback
// SwiftPay sends callbacks as POST with x_* params in the body (form or JSON).
// The signature covers all x_* params sorted alphabetically, concatenated key+value.
router.post('/swiftpay', async (req, res) => {
  try {
    const body = req.body || {};
    // The incoming signature is sent as the 'signature' field (not a header).
    const incomingSignature = body.signature || req.get('x-swiftpay-signature') || '';
    const sig = swiftpay.verifyWebhookSignature(body, incomingSignature);
    if (!sig.skipped && !sig.verified) {
      return res.status(401).json({ error: 'invalid signature' });
    }

    const orderNumber = body.x_reference_no || body.reference_number || body.order_number;
    const rawStatus = body.x_payment_status || body.payment_status || body.status;
    const status = swiftpay.normalizeStatus(rawStatus);

    if (!orderNumber) return res.status(200).json({ ok: true, note: 'reference missing' });

    const order = StoreService.getOrder(orderNumber);
    if (!order) return res.status(200).json({ ok: true, note: 'order not found' });

    if (status === 'paid') {
      StoreService.updateOrderStatus(order.id, 'paid', "datetime('now')");
    } else if (status === 'failed' && order.status === 'pending') {
      StoreService.updateOrderStatus(order.id, 'failed');
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('swiftpay webhook error', e);
    return res.status(200).json({ ok: false, error: e.message });
  }
});

// Magpie webhook
// Configure webhook URL in Magpie dashboard to: {BASE_URL}/webhooks/magpie
// Webhook signature verification is optional — if MAGPIE_WEBHOOK_SECRET is not configured,
// all webhooks from Magpie are accepted (they're internal to your order flow anyway).
router.post('/magpie', async (req, res) => {
  try {
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const signature = req.get('X-MAGPIE-SIGNATURE') || req.get('x-magpie-signature') || '';
    const sig = magpie.verifyWebhookSignature(rawBody, signature);
    
    // If signature verification is skipped (no secret configured), log it once
    if (sig.skipped) {
      console.warn('[Webhook] Magpie webhook signature verification skipped (MAGPIE_WEBHOOK_SECRET not configured). Webhooks will be accepted without verification.');
    }
    
    // Reject only if verification was attempted and failed
    if (!sig.skipped && !sig.verified) {
      console.warn('[Webhook] Magpie webhook signature verification FAILED — rejecting webhook');
      return res.status(401).json({ error: 'invalid signature' });
    }

    const body = req.body || {};
    // Magpie v1.1 webhook payload for charges:
    //   { id, status, referenceNumber, source: { ... }, ... }
    // Also handle wrapped { data: { ... } } or legacy field names.
    const data = body.data || body;
    const orderNumber =
      data.referenceNumber || data.reference_number ||
      data.reference || data.order_number || null;
    const rawStatus = data.status || data.payment_status || null;
    const status = magpie.normalizeStatus(rawStatus);

    if (!orderNumber) return res.status(200).json({ ok: true, note: 'reference missing' });

    const order = StoreService.getOrder(orderNumber);
    if (!order) return res.status(200).json({ ok: true, note: 'order not found' });

    if (status === 'paid') {
      StoreService.updateOrderStatus(order.id, 'paid', "datetime('now')");
      console.info(`[Webhook] Magpie payment confirmed for order ${orderNumber}`);
    } else if (status === 'failed' && order.status === 'pending') {
      StoreService.updateOrderStatus(order.id, 'failed');
      console.info(`[Webhook] Magpie payment failed for order ${orderNumber}`);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('magpie webhook error', e);
    return res.status(200).json({ ok: false, error: e.message });
  }
});

// Maya payment-status webhook.
// Configure this URL in your Maya dashboard:
//   {BASE_URL}/webhooks/maya/payment-status
router.post('/maya/payment-status', async (req, res) => {
  try {
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const signature = req.get('X-Maya-Signature') || req.get('x-signature') || '';
    const sig = maya.verifyWebhookSignature(rawBody, signature);
    if (!sig.skipped && !sig.verified) {
      return res.status(401).json({ error: 'invalid signature' });
    }

    const body = req.body || {};
    const ref = body.requestReferenceNumber || body.reference || (body.data && body.data.requestReferenceNumber);
    const checkoutId = body.id || body.checkoutId || (body.data && body.data.id);

    let order = null;
    if (ref) order = StoreService.getOrder(ref);
    if (!order && checkoutId) {
      const { db } = require('../db');
      order = db.prepare('SELECT * FROM orders WHERE maya_checkout_id = ?').get(checkoutId);
    }

    if (!order) return res.status(200).json({ ok: true, note: 'order not found' });

    // Trust the API as source of truth when we can look it up; otherwise use payload status.
    let status = null;
    if (order.maya_checkout_id) status = await maya.getCheckoutStatus(order.maya_checkout_id);
    if (!status) status = maya.normalizeStatus(body.paymentStatus || body.status || (body.data && body.data.status));

    if (status === 'paid') {
      StoreService.updateOrderStatus(order.id, 'paid', "datetime('now')");
    } else if (status === 'failed') {
      if (order.status === 'pending') {
        StoreService.updateOrderStatus(order.id, 'failed');
      }
    }
    return res.status(200).json({ ok: true, status });
  } catch (e) {
    console.error('webhook error', e);
    // Always 200 so Maya does not retry forever; we log for investigation.
    return res.status(200).json({ ok: false, error: e.message });
  }
});

// Coins.ph payment-status webhook.
// Configure this URL in your Coins.ph dashboard:
//   {BASE_URL}/webhooks/coins/payment-status
router.post('/coins/payment-status', async (req, res) => {
  try {
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const signature = req.get('X-COINS-SIGNATURE') || '';
    const sig = coins.verifyWebhookSignature(rawBody, signature);
    if (!sig.skipped && !sig.verified) {
      return res.status(401).json({ error: 'invalid signature' });
    }

    const body = req.body || {};
    const orderNumber = body.order_id;
    const paymentStatus = body.status; // 'success', 'failed', etc.

    if (!orderNumber) return res.status(200).json({ ok: true, note: 'order_id missing' });

    const order = StoreService.getOrder(orderNumber);
    if (!order) return res.status(200).json({ ok: true, note: 'order not found' });

    if (paymentStatus === 'success') {
      StoreService.updateOrderStatus(order.id, 'paid', "datetime('now')");
    } else if (paymentStatus === 'failed') {
      if (order.status === 'pending') {
        StoreService.updateOrderStatus(order.id, 'failed');
      }
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('coins webhook error', e);
    return res.status(200).json({ ok: false, error: e.message });
  }
});

// Telegram bot webhook
router.post('/telegram', async (req, res) => {
  try {
    const TelegramBot = require('../telegram-bot');
    if (!TelegramBot.isConfigured()) {
      return res.status(400).json({ error: 'Telegram bot not configured' });
    }

    const update = req.body;
    if (!update) {
      return res.status(200).json({ ok: true });
    }

    // Process update asynchronously (don't wait for response)
    TelegramBot.handleUpdate(update).catch(console.error);

    // Always respond with 200 OK to Telegram immediately
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Telegram webhook error:', e);
    return res.status(200).json({ ok: true }); // Always return 200 to Telegram
  }
});

module.exports = router;
