'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db, getSetting } = require('../db');
const maya = require('../maya');
const coins = require('../coins');
const paymongo = require('../paymongo');
const xendit = require('../xendit');
const swiftpay = require('../swiftpay');
const magpie = require('../magpie');
const { generateOrderNumber } = require('../helpers');
const { asyncHandler, rateLimit } = require('../middleware');
const StoreService = require('../services/store');

// Supported SwiftPay payment types (verified working with SwiftPay API)
// Each of these channels works the same way: direct redirect to specific payment method
const SWIFTPAY_TYPES = [
  'swiftpay',             // Generic: show institution selection screen
  'swiftpay_maya',        // Maya e-wallet (direct payment)
  'swiftpay_gcash',       // GCash e-wallet (direct payment)
  'swiftpay_qrph',        // QR Ph (InstaPay/PESONet — special flow with inline QR)
  // Major Philippine banks (online banking redirects)
  'swiftpay_bpi',         // Bank of the Philippine Islands
  'swiftpay_unionbank',   // Union Bank of the Philippines
  'swiftpay_pnb',         // Philippine National Bank
  'swiftpay_rcbc',        // RCBC (Rizal Commercial Banking Corporation)
];

async function syncSwiftpayOrderStatus(order) {
  if (
    !order ||
    !SWIFTPAY_TYPES.includes(order.payment_type) ||
    !['pending', 'failed'].includes(order.status) ||
    !order.swiftpay_checkout_id
  ) {
    return order;
  }

  try {
    // For QR Ph, swiftpay_checkout_id holds the paymentId (not the reference number).
    // The status query always uses the order_number as the referenceNo.
    const refNo = order.payment_type === 'swiftpay_qrph'
      ? order.order_number
      : order.swiftpay_checkout_id;
    const status = await swiftpay.getCheckoutStatus(refNo);
    if (status === 'paid') {
      StoreService.updateOrderStatus(order.id, 'paid', "datetime('now')");
      return StoreService.getOrder(order.id);
    }
    if (status === 'failed' && order.status !== 'failed') {
      StoreService.updateOrderStatus(order.id, 'failed');
      return StoreService.getOrder(order.id);
    }
  } catch (_) { /* show current state */ }

  return order;
}

// Homepage -------------------------------------------------------------------
router.get('/', (req, res) => {
  const banners = db.prepare('SELECT * FROM banners WHERE enabled = 1 ORDER BY sort_order, id').all();
  res.render('index', {
    title: res.locals.shopName,
    banners,
    catalog: StoreService.getCatalog(),
    manualMethods: StoreService.getEnabledManualMethods(),
    coinsEnabled: coins.isConfigured(),
  });
});

// Create order ---------------------------------------------------------------
router.post('/order', rateLimit, asyncHandler(async (req, res) => {
  const telegramUsername = String(req.body.telegram_username || '').trim().replace(/^@/, '');
  const productId = parseInt(req.body.product_id, 10);
  const quantity = Math.max(1, parseInt(req.body.quantity, 10) || 1);
  const paymentType = req.body.payment_type; // 'manual', 'maya', 'coins', 'paymongo', 'xendit', 'magpie_alipay', 'magpie_wechat', 'swiftpay', 'swiftpay_maya', 'swiftpay_qrph', 'swiftpay_gcash'
  const manualMethodId = req.body.manual_method_id ? parseInt(req.body.manual_method_id, 10) : null;

  if (!telegramUsername) {
    return res.status(400).render('error', { title: 'Missing info', message: 'Please enter your Telegram username.' });
  }

  const product = StoreService.getProduct(productId);
  if (!product) {
    return res.status(404).render('error', { title: 'Unavailable', message: 'This product is no longer available.' });
  }
  if (product.stock < quantity) {
    return res.status(400).render('error', {
      title: 'Out of stock',
      message: `Only ${product.stock} unit(s) of "${product.name}" are available.`,
    });
  }
  if (quantity < (product.min_quantity || 1)) {
    return res.status(400).render('error', {
      title: 'Minimum order not met',
      message: `The minimum order for "${product.name}" is ${product.min_quantity} unit(s).`,
    });
  }

  if (paymentType === 'manual') {
    const method = db.prepare('SELECT * FROM manual_payment_methods WHERE id = ? AND enabled = 1').get(manualMethodId);
    if (!method) {
      return res.status(400).render('error', { title: 'Invalid payment', message: 'Please choose a valid payment method.' });
    }
  } else if (paymentType === 'maya' && !maya.isConfigured()) {
    return res.status(400).render('error', { title: 'Unavailable', message: 'Online card/Maya payment is not available right now. Please choose another method.' });
  } else if (paymentType === 'coins' && !coins.isConfigured()) {
    return res.status(400).render('error', { title: 'Unavailable', message: 'Coins.ph payment is not available right now. Please choose another method.' });
  } else if (paymentType === 'paymongo' && !paymongo.isConfigured()) {
    return res.status(400).render('error', { title: 'Unavailable', message: 'PayMongo payment is not available right now. Please choose another method.' });
  } else if (paymentType === 'xendit' && !xendit.isConfigured()) {
    return res.status(400).render('error', { title: 'Unavailable', message: 'Xendit payment is not available right now. Please choose another method.' });
  } else if (SWIFTPAY_TYPES.some(t => t === paymentType) && !swiftpay.isConfigured()) {
    return res.status(400).render('error', { title: 'Unavailable', message: 'Swiftpay PH payment is not available right now. Please choose another method.' });
  } else if ((paymentType === 'magpie_alipay' || paymentType === 'magpie_wechat') && !magpie.isConfigured()) {
    return res.status(400).render('error', { title: 'Unavailable', message: 'Magpie payment is not available right now. Please choose another method.' });
  }

  const orderNumber = generateOrderNumber();
  const order = StoreService.createOrder({
    orderNumber,
    email: '', // Email is no longer used
    telegramUsername,
    telegramId: req.session.user ? req.session.user.telegram_id : null,
    productId: product.id,
    productName: product.name,
    quantity,
    unitPrice: product.price,
    total: +(product.price * quantity).toFixed(2),
    currency: getSetting('currency', 'PHP'),
    paymentType,
    manualMethodId: paymentType === 'manual' ? manualMethodId : null,
    simTypeSelected: req.body.sim_type_selected || null,
    deliveryAddress: req.body.delivery_address || null
  });

  // Notify admin
  const NotificationService = require('../services/notifications');
  NotificationService.onNewOrder(order).catch(console.error);

  if (paymentType === 'maya') {
    try {
      const { checkoutId, redirectUrl } = await maya.createCheckout(order, res.locals.baseUrl);
      db.prepare('UPDATE orders SET maya_checkout_id = ? WHERE id = ?').run(checkoutId, order.id);
      return res.redirect(redirectUrl);
    } catch (e) {
      db.prepare("UPDATE orders SET status = 'failed', admin_notes = ? WHERE id = ?").run(
        'Maya checkout error: ' + e.message,
        order.id
      );
      return res.status(502).render('error', {
        title: 'Payment error',
        message: 'Could not start the Maya payment. ' + e.message + ` Your reference is ${orderNumber}.`,
      });
    }
  }

  if (paymentType === 'coins') {
    try {
      const { paymentRequestId, redirectUrl } = await coins.createPaymentRequest(order, res.locals.baseUrl);
      db.prepare('UPDATE orders SET coins_request_id = ? WHERE id = ?').run(paymentRequestId, order.id);
      return res.redirect(redirectUrl);
    } catch (e) {
      db.prepare("UPDATE orders SET status = 'failed', admin_notes = ? WHERE id = ?").run(
        'Coins.ph checkout error: ' + e.message,
        order.id
      );
      return res.status(502).render('error', {
        title: 'Payment error',
        message: 'Could not start the Coins.ph payment. ' + e.message + ` Your reference is ${orderNumber}.`,
      });
    }
  }

  if (paymentType === 'paymongo') {
    try {
      const { sessionId, checkoutUrl } = await paymongo.createCheckoutSession(order, res.locals.baseUrl);
      db.prepare('UPDATE orders SET paymongo_session_id = ? WHERE id = ?').run(sessionId, order.id);
      return res.redirect(checkoutUrl);
    } catch (e) {
      db.prepare("UPDATE orders SET status = 'failed', admin_notes = ? WHERE id = ?").run(
        'PayMongo checkout error: ' + e.message,
        order.id
      );
      return res.status(502).render('error', {
        title: 'Payment error',
        message: 'Could not start PayMongo checkout. ' + e.message + ` Your reference is ${orderNumber}.`,
      });
    }
  }

  if (paymentType === 'xendit') {
    try {
      const { invoiceId, invoiceUrl } = await xendit.createInvoice(order, res.locals.baseUrl);
      db.prepare('UPDATE orders SET xendit_invoice_id = ? WHERE id = ?').run(invoiceId, order.id);
      return res.redirect(invoiceUrl);
    } catch (e) {
      db.prepare("UPDATE orders SET status = 'failed', admin_notes = ? WHERE id = ?").run(
        'Xendit checkout error: ' + e.message,
        order.id
      );
      return res.status(502).render('error', {
        title: 'Payment error',
        message: 'Could not start Xendit checkout. ' + e.message + ` Your reference is ${orderNumber}.`,
      });
    }
  }

  if (SWIFTPAY_TYPES.includes(paymentType)) {
    // QR Ph has a completely different API flow: bootstrap/qrph returns a QR code
    // that is displayed inline on our page — there is no customer redirect to SwiftPay.
    if (paymentType === 'swiftpay_qrph') {
      try {
        const { paymentId, qrCode } = await swiftpay.createQrph(order);
        // Store paymentId as the checkout ID (for status queries) and qrCode as the checkout URL field.
        db.prepare('UPDATE orders SET swiftpay_checkout_id = ?, swiftpay_checkout_url = ? WHERE id = ?').run(paymentId, qrCode, order.id);
        return res.redirect(`/swiftpay/qrph?ref=${encodeURIComponent(orderNumber)}`);
      } catch (e) {
        db.prepare("UPDATE orders SET status = 'failed', admin_notes = ? WHERE id = ?").run(
          'SwiftPay QR Ph error: ' + e.message,
          order.id
        );
        return res.status(502).render('error', {
          title: 'Payment error',
          message: 'Could not generate QR Ph code. ' + e.message + ` Your reference is ${orderNumber}.`,
        });
      }
    }

    // All other SwiftPay methods use the standard redirect checkout flow.
    // Map customer-facing type to SwiftPay institution_code (verified from /api/institutions endpoint)
    // Note: Only institutions that are confirmed to work via the SwiftPay API are included.
    const institutionMap = {
      // E-wallets (direct payment, instant redirect)
      swiftpay_gcash: 'GCASH',
      swiftpay_maya: 'MAYA_WALLET',
      // Banks (online banking login, then transfer)
      swiftpay_bpi: 'BPI',
      swiftpay_unionbank: 'UNIONBANK',
      swiftpay_pnb: 'PNB',
      swiftpay_rcbc: 'RCBC',
      // swiftpay_qrph and plain 'swiftpay': use special handling (no institution_code → show selection screen)
    };
    let institutionCode = institutionMap[paymentType] || null;
    if (!institutionCode) {
      try {
        const insts = await swiftpay.listInstitutions();
        const key = String(paymentType || '').replace(/^swiftpay_/, '').toLowerCase();
        const match = insts.find(i => {
          const code = String(i.code || '').toLowerCase();
          const name = String(i.name || '').toLowerCase();
          return code.includes(key) || name.includes(key);
        });
        institutionCode = match ? match.code : null;
      } catch (e) {
        institutionCode = null;
      }
    }
    try {
      const { checkoutId, checkoutUrl } = await swiftpay.createCheckout(order, res.locals.baseUrl, institutionCode);
      db.prepare('UPDATE orders SET swiftpay_checkout_id = ?, swiftpay_checkout_url = ? WHERE id = ?').run(checkoutId, checkoutUrl, order.id);
      // ✅ FIXED: Redirect immediately to SwiftPay checkout URL (like Maya does)
      return res.redirect(checkoutUrl);
    } catch (e) {
      db.prepare("UPDATE orders SET status = 'failed', admin_notes = ? WHERE id = ?").run(
        'Swiftpay checkout error: ' + e.message,
        order.id
      );
      return res.status(502).render('error', {
        title: 'Payment error',
        message: 'Could not start Swiftpay PH checkout. ' + e.message + ` Your reference is ${orderNumber}.`,
      });
    }
  }

  if (paymentType === 'magpie_alipay' || paymentType === 'magpie_wechat') {
    try {
      const method = paymentType === 'magpie_wechat' ? 'wechat' : 'alipay';
      const { checkoutId, checkoutUrl } = await magpie.createCheckout(order, res.locals.baseUrl, method);
      db.prepare('UPDATE orders SET magpie_checkout_id = ? WHERE id = ?').run(checkoutId, order.id);
      // ✅ FIXED: Redirect immediately to Magpie checkout URL (matching SwiftPay pattern)
      return res.redirect(checkoutUrl);
    } catch (e) {
      db.prepare("UPDATE orders SET status = 'failed', admin_notes = ? WHERE id = ?").run(
        'Magpie checkout error: ' + e.message,
        order.id
      );
      return res.status(502).render('error', {
        title: 'Payment error',
        message: 'Could not start Magpie payment. ' + e.message + ` Your reference is ${orderNumber}.`,
      });
    }
  }

  // Manual payment -> show instructions
  return res.redirect(`/order/result?ref=${encodeURIComponent(orderNumber)}`);
}));

router.get('/swiftpay/checkout', asyncHandler(async (req, res) => {
  const ref = String(req.query.ref || '').trim();
  let order = StoreService.getOrder(ref);
  if (!order) {
    return res.status(404).render('error', { title: 'Not found', message: 'Order not found.' });
  }
  if (!SWIFTPAY_TYPES.includes(order.payment_type)) {
    return res.redirect(`/order/result?ref=${encodeURIComponent(order.order_number)}`);
  }

  order = await syncSwiftpayOrderStatus(order);
  if (order.status !== 'pending') {
    return res.redirect(`/swiftpay/status?ref=${encodeURIComponent(order.order_number)}`);
  }

  res.render('swiftpay-checkout', {
    title: `Swiftpay Checkout · ${order.order_number}`,
    order,
    checkoutUrl: order.swiftpay_checkout_url || '',
  });
}));

// QR Ph payment page — shows the InstaPay QR code inline ----------------------
router.get('/swiftpay/qrph', asyncHandler(async (req, res) => {
  const ref = String(req.query.ref || '').trim();
  let order = StoreService.getOrder(ref);
  if (!order) {
    return res.status(404).render('error', { title: 'Not found', message: 'Order not found.' });
  }
  if (order.payment_type !== 'swiftpay_qrph') {
    return res.redirect(`/order/result?ref=${encodeURIComponent(order.order_number)}`);
  }

  // swiftpay_checkout_id holds the paymentId; swiftpay_checkout_url holds the raw qrCode string.
  order = await syncSwiftpayOrderStatus(order);

  res.render('swiftpay-qrph', {
    title: `QR Ph Payment · ${order.order_number}`,
    order,
    paymentId: order.swiftpay_checkout_id || '',
    qrCode: order.swiftpay_checkout_url || '',
  });
}));

// Proxy the QR image from SwiftPay (requires X-Swiftpay-Payment-Token header) -
router.get('/swiftpay/qrph/image', asyncHandler(async (req, res) => {
  const paymentId = String(req.query.paymentId || '').trim();
  if (!paymentId) return res.status(400).send('Missing paymentId');

  const base = swiftpay.qrphImageUrl(paymentId);
  try {
    const upstream = await fetch(base, {
      method: 'GET',
      headers: { 'X-Swiftpay-Payment-Token': paymentId },
    });
    if (!upstream.ok) return res.status(upstream.status).send('QR image unavailable');
    const contentType = upstream.headers.get('content-type') || 'image/png';
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'no-store');
    res.send(buf);
  } catch (e) {
    res.status(502).send('QR image fetch failed: ' + e.message);
  }
}));


router.get('/order/result', asyncHandler(async (req, res) => {
  const ref = String(req.query.ref || '').trim();
  let order = StoreService.getOrder(ref);
  if (!order) {
    return res.status(404).render('error', { title: 'Not found', message: 'Order not found.' });
  }

  // For Maya orders coming back from the hosted checkout, sync status live so the
  // page is accurate even if the webhook has not arrived yet.
  if (order.payment_type === 'maya' && order.status === 'pending' && order.maya_checkout_id) {
    try {
      const status = await maya.getCheckoutStatus(order.maya_checkout_id);
      if (status === 'paid') {
        StoreService.updateOrderStatus(order.id, 'paid', "datetime('now')");
      } else if (status === 'failed') {
        StoreService.updateOrderStatus(order.id, 'failed');
      }
      order = StoreService.getOrder(order.id);
    } catch (_) { /* show current state */ }
  }
  
  // For Magpie orders (Alipay/WeChat), sync status live so the page is accurate
  // even if the webhook has not arrived yet.
  if ((order.payment_type === 'magpie_alipay' || order.payment_type === 'magpie_wechat') &&
      order.status === 'pending' && order.magpie_checkout_id) {
    try {
      const status = await magpie.getChargeStatus(order.magpie_checkout_id);
      if (status === 'paid') {
        StoreService.updateOrderStatus(order.id, 'paid', "datetime('now')");
      } else if (status === 'failed') {
        StoreService.updateOrderStatus(order.id, 'failed');
      }
      order = StoreService.getOrder(order.id);
    } catch (_) { /* show current state */ }
  }
  
  order = await syncSwiftpayOrderStatus(order);

  const manualMethod = order.manual_method_id
    ? db.prepare('SELECT * FROM manual_payment_methods WHERE id = ?').get(order.manual_method_id)
    : null;
  res.render('order-result', {
    title: `Order ${order.order_number}`,
    order,
    manualMethod,
    queryStatus: String(req.query.status || ''),
  });
}));

router.get('/swiftpay/status', asyncHandler(async (req, res) => {
  // SwiftPay sends customers back to the redirect URL configured in the merchant portal
  // with query params: x_reference_no, x_payment_status, x_payment_id, signature
  // We accept either our own ?ref= param or SwiftPay's ?x_reference_no=
  const ref = String(req.query.ref || req.query.x_reference_no || '').trim();
  let order = StoreService.getOrder(ref);
  if (!order) {
    return res.status(404).render('error', { title: 'Not found', message: 'Order not found.' });
  }
  if (!SWIFTPAY_TYPES.includes(order.payment_type)) {
    return res.redirect(`/order/result?ref=${encodeURIComponent(order.order_number)}`);
  }

  order = await syncSwiftpayOrderStatus(order);
  res.render('swiftpay-status', {
    title: `Swiftpay Status · ${order.order_number}`,
    order,
    queryStatus: String(req.query.status || '').trim().toLowerCase(),
    checkoutUrl: order.swiftpay_checkout_url || '',
  });
}));

// Magpie payment status (Alipay/WeChat) -----------------------------------------
// Magpie redirects to success/fail URLs configured in the order creation.
// This route ensures status is synced, then redirects to the standard order result page.
router.get('/magpie/status', asyncHandler(async (req, res) => {
  const ref = String(req.query.ref || '').trim();
  let order = StoreService.getOrder(ref);
  if (!order) {
    return res.status(404).render('error', { title: 'Not found', message: 'Order not found.' });
  }
  if (order.payment_type !== 'magpie_alipay' && order.payment_type !== 'magpie_wechat') {
    return res.redirect(`/order/result?ref=${encodeURIComponent(order.order_number)}`);
  }

  // Sync status from Magpie API before showing the result page
  if (order.status === 'pending' && order.magpie_checkout_id) {
    try {
      const status = await magpie.getChargeStatus(order.magpie_checkout_id);
      if (status === 'paid') {
        StoreService.updateOrderStatus(order.id, 'paid', "datetime('now')");
      } else if (status === 'failed') {
        StoreService.updateOrderStatus(order.id, 'failed');
      }
      order = StoreService.getOrder(order.id);
    } catch (_) { /* show current state */ }
  }

  const manualMethod = order.manual_method_id
    ? db.prepare('SELECT * FROM manual_payment_methods WHERE id = ?').get(order.manual_method_id)
    : null;
  res.render('order-result', {
    title: `Order ${order.order_number}`,
    order,
    manualMethod,
    queryStatus: String(req.query.status || ''),
  });
}));

// Order status page -----------------------------------------------------------
router.get('/status', (req, res) => {
  const ref = String(req.query.ref || '').trim();
  const tg = String(req.query.tg || '').trim();

  if (ref && tg) {
    const order = StoreService.getOrderByTGAndRef(tg, ref);
    if (order) {
      const manualMethod = order.manual_method_id
        ? db.prepare('SELECT * FROM manual_payment_methods WHERE id = ?').get(order.manual_method_id)
        : null;
      return res.render('status', { title: 'Order Status', order, manualMethod, searched: true, error: null });
    }
  }

  res.render('status', { title: 'Order Status', order: null, manualMethod: null, error: null, searched: false });
});

router.post('/status', (req, res) => {
  const telegramUsername = String(req.body.telegram_username || '').trim().replace(/^@/, '');
  const ref = String(req.body.order_number || '').trim();
  const order = StoreService.getOrderByTGAndRef(telegramUsername, ref);
  if (!order) {
    return res.render('status', {
      title: 'Order Status',
      order: null,
      manualMethod: null,
      searched: true,
      error: 'No order found for that Telegram username and order number.',
    });
  }
  const manualMethod = order.manual_method_id
    ? db.prepare('SELECT * FROM manual_payment_methods WHERE id = ?').get(order.manual_method_id)
    : null;
  res.render('status', { title: 'Order Status', order, manualMethod, searched: true, error: null });
});

// My Account -----------------------------------------------------------------
router.get('/account', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/');
  }
  const orders = StoreService.getOrdersByTelegramUsername(req.session.user.username);
  res.render('account', {
    title: 'My Account',
    orders
  });
});

// Telegram Auth --------------------------------------------------------------
router.get('/auth/telegram', (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.redirect('/');

  const data = { ...req.query };
  const hash = data.hash;
  delete data.hash;

  const dataCheckArr = Object.keys(data)
    .sort()
    .map(key => `${key}=${data[key]}`);
  const dataCheckString = dataCheckArr.join('\n');

  const secretKey = crypto.createHash('sha256').update(token).digest();
  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (hmac === hash) {
    // Reject auth data older than 24 hours to prevent replay attacks
    const authDate = parseInt(data.auth_date, 10);
    if (!authDate || Math.floor(Date.now() / 1000) - authDate > 86400) {
      return res.status(401).send('Telegram auth expired. Please try again.');
    }
    // Valid login
    req.session.user = {
      telegram_id: data.id,
      first_name: data.first_name,
      username: data.username,
      photo_url: data.photo_url,
    };
    return res.redirect('/');
  }

  res.status(401).send('Invalid Telegram auth');
});

router.get('/logout', (req, res) => {
  delete req.session.user;
  res.redirect('/');
});

module.exports = router;
