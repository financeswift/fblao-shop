'use strict';

// Use global fetch (available in Node 18+) or require node-fetch for older versions
const fetch = global.fetch || require('node-fetch');
const { db, getSetting } = require('./db');
const StoreService = require('./services/store');
const { generateOrderNumber } = require('./helpers');
const NotificationService = require('./services/notifications');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

/**
 * Telegram Bot Integration
 * Allows users to browse products and purchase directly via Telegram
 * Uses the same payment flow as the web app
 */

async function sendMessage(chatId, text, options = {}) {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`${BOT_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...options
      })
    });
  } catch (e) {
    console.error('[TelegramBot] Send message error:', e.message);
  }
}

async function editMessage(chatId, messageId, text, options = {}) {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`${BOT_API}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        ...options
      })
    });
  } catch (e) {
    console.error('[TelegramBot] Edit message error:', e.message);
  }
}

function buildProductButtons(products) {
  return products.map(p => [
    {
      text: `${p.name} - ${getSetting('currency', 'PHP')} ${p.price}`,
      callback_data: `prod_${p.id}`
    }
  ]);
}

function buildQuantityButtons(productId) {
  const quantities = [1, 2, 3, 5, 10];
  return [
    quantities.map(q => ({
      text: q.toString(),
      callback_data: `qty_${productId}_${q}`
    })),
    [{ text: '↩️ Back', callback_data: 'menu' }]
  ];
}

function buildPaymentMethodButtons(productId, quantity) {
  // Use official payment provider representations with emojis
  const methods = [
    { text: '🟦 GCash', callback_data: `pay_${productId}_${quantity}_swiftpay_gcash` },
    { text: '🟪 QRPH', callback_data: `pay_${productId}_${quantity}_swiftpay_qrph` },
    { text: '🟨 Maya', callback_data: `pay_${productId}_${quantity}_maya` },
    { text: '🟩 Coins.ph', callback_data: `pay_${productId}_${quantity}_coins` },
    { text: '🔴 Alipay', callback_data: `pay_${productId}_${quantity}_magpie_alipay` },
    { text: '🟢 WeChat', callback_data: `pay_${productId}_${quantity}_magpie_wechat` },
    { text: '🏦 Bank Transfer', callback_data: `pay_${productId}_${quantity}_manual` },
    { text: '↩️ Back', callback_data: `prod_${productId}` }
  ];
  return [methods.slice(0, 2), methods.slice(2, 4), methods.slice(4, 6), methods.slice(6, 7), methods.slice(7)];
}

async function handleStart(chatId, userId, username) {
  const shopName = getSetting('shop_name', 'BlackHorse Shop');
  const msg = `<b>👋 Welcome to ${shopName}!</b>\n\n` +
              `Browse and purchase directly from our catalog.\n\n` +
              `Use /menu to start shopping.`;
  await sendMessage(chatId, msg);
}

async function handleMenu(chatId, messageId = null) {
  const catalog = StoreService.getCatalog();
  
  if (!catalog || catalog.length === 0) {
    const msg = '❌ No products available right now.';
    if (messageId) {
      await editMessage(chatId, messageId, msg);
    } else {
      await sendMessage(chatId, msg);
    }
    return;
  }

  const allProducts = catalog.flatMap(c => c.products);
  const msg = `<b>📦 Our Products</b>\n\n` +
              allProducts.map((p, i) => `${i + 1}. <b>${p.name}</b> - ${getSetting('currency', 'PHP')} ${p.price}`).join('\n') +
              `\n\nSelect a product to continue:`;

  const buttons = buildProductButtons(allProducts);

  if (messageId) {
    await editMessage(chatId, messageId, msg, { reply_markup: { inline_keyboard: buttons } });
  } else {
    await sendMessage(chatId, msg, { reply_markup: { inline_keyboard: buttons } });
  }
}

async function handleProductSelected(chatId, messageId, productId) {
  const product = StoreService.getProduct(productId);
  if (!product) {
    await editMessage(chatId, messageId, '❌ Product not found.');
    return;
  }

  if (!product.active) {
    await editMessage(chatId, messageId, '❌ This product is no longer available.');
    return;
  }

  const stockStatus = product.stock > 0 ? `✅ In stock (${product.stock} available)` : '❌ Out of stock';
  const msg = `<b>${product.name}</b>\n\n` +
              `💰 Price: ${getSetting('currency', 'PHP')} ${product.price}\n` +
              `📊 ${stockStatus}\n` +
              (product.description ? `\n📝 ${product.description}\n` : '') +
              `\nHow many would you like?`;

  const buttons = buildQuantityButtons(productId);
  await editMessage(chatId, messageId, msg, { reply_markup: { inline_keyboard: buttons } });
}

async function handleQuantitySelected(chatId, messageId, productId, quantity) {
  const product = StoreService.getProduct(productId);
  if (!product) {
    await editMessage(chatId, messageId, '❌ Product not found.');
    return;
  }

  if (quantity < (product.min_quantity || 1)) {
    await editMessage(chatId, messageId, 
      `❌ Minimum order is ${product.min_quantity || 1} unit(s).`,
      { reply_markup: { inline_keyboard: buildQuantityButtons(productId) } }
    );
    return;
  }

  if (quantity > product.stock) {
    await editMessage(chatId, messageId,
      `❌ Only ${product.stock} unit(s) available.`,
      { reply_markup: { inline_keyboard: buildQuantityButtons(productId) } }
    );
    return;
  }

  const total = (product.price * quantity).toFixed(2);
  const msg = `<b>✅ Confirm Order</b>\n\n` +
              `Product: ${product.name}\n` +
              `Quantity: ${quantity}\n` +
              `Unit Price: ${getSetting('currency', 'PHP')} ${product.price}\n` +
              `<b>Total: ${getSetting('currency', 'PHP')} ${total}</b>\n\n` +
              `Select a payment method:`;

  const buttons = buildPaymentMethodButtons(productId, quantity);
  await editMessage(chatId, messageId, msg, { reply_markup: { inline_keyboard: buttons } });
}

async function handlePaymentMethod(chatId, messageId, userId, username, productId, quantity, paymentType) {
  const product = StoreService.getProduct(productId);
  if (!product || quantity < (product.min_quantity || 1) || quantity > product.stock) {
    await editMessage(chatId, messageId, '❌ Order validation failed. Please try again.');
    return;
  }

  // Get payment method icon
  const paymentMethodIcons = {
    'swiftpay_gcash': '🟦',
    'swiftpay_qrph': '🟪',
    'maya': '🟨',
    'coins': '🟩',
    'magpie_alipay': '🔴',
    'magpie_wechat': '🟢',
    'manual': '🏦'
  };
  const methodIcon = paymentMethodIcons[paymentType] || '💳';

  // Get payment method name
  const paymentMethodNames = {
    'swiftpay_gcash': 'GCash',
    'swiftpay_qrph': 'QRPH',
    'maya': 'Maya',
    'coins': 'Coins.ph',
    'magpie_alipay': 'Alipay',
    'magpie_wechat': 'WeChat',
    'manual': 'Bank Transfer'
  };
  const methodName = paymentMethodNames[paymentType] || 'Payment';

  // Create order
  const orderNumber = generateOrderNumber();
  const total = +(product.price * quantity).toFixed(2);
  
  const order = StoreService.createOrder({
    orderNumber,
    email: '', 
    telegramUsername: username || `user_${userId}`,
    telegramId: userId,
    productId: product.id,
    productName: product.name,
    quantity,
    unitPrice: product.price,
    total,
    currency: getSetting('currency', 'PHP'),
    paymentType,
    manualMethodId: null
  });

  try {
    const db = require('./db');
    const baseUrl = process.env.BASE_URL || 'https://fblao-shop.up.railway.app';
    let paymentUrl;

    // Handle different payment methods
    if (paymentType === 'swiftpay_gcash' || paymentType === 'swiftpay_qrph') {
      // Inline QR code payment
      const swiftpay = require('./swiftpay');
      const { paymentId, qrCode } = await swiftpay.createQrph(order);
      db.prepare('UPDATE orders SET swiftpay_checkout_id = ?, swiftpay_checkout_url = ? WHERE id = ?')
        .run(paymentId, qrCode, order.id);
      
      paymentType === 'swiftpay_gcash' 
        ? (paymentUrl = `${baseUrl}/swiftpay/gcash?ref=${encodeURIComponent(orderNumber)}`)
        : (paymentUrl = `${baseUrl}/swiftpay/qrph?ref=${encodeURIComponent(orderNumber)}`);
    } 
    else if (paymentType === 'maya') {
      // Maya checkout redirect
      const maya = require('./maya');
      const { checkoutId, redirectUrl } = await maya.createCheckout(order, baseUrl);
      db.prepare('UPDATE orders SET maya_checkout_id = ? WHERE id = ?').run(checkoutId, order.id);
      paymentUrl = redirectUrl;
    }
    else if (paymentType === 'coins') {
      // Coins.ph redirect
      const coins = require('./coins');
      const { paymentRequestId, redirectUrl } = await coins.createPaymentRequest(order, baseUrl);
      db.prepare('UPDATE orders SET coins_request_id = ? WHERE id = ?').run(paymentRequestId, order.id);
      paymentUrl = redirectUrl;
    }
    else if (paymentType === 'magpie_alipay' || paymentType === 'magpie_wechat') {
      // Magpie Alipay/WeChat
      const magpie = require('./magpie');
      const method = paymentType === 'magpie_wechat' ? 'wechat' : 'alipay';
      const { sessionId, redirectUrl } = await magpie.createSession(order, method, baseUrl);
      db.prepare('UPDATE orders SET magpie_session_id = ?, magpie_method = ? WHERE id = ?')
        .run(sessionId, method, order.id);
      paymentUrl = redirectUrl;
    }
    else if (paymentType === 'manual') {
      // Manual payment (admin transfer details)
      paymentUrl = `${baseUrl}/order/result?ref=${encodeURIComponent(orderNumber)}`;
    }
    else {
      // Default fallback
      paymentUrl = `${baseUrl}/order/result?ref=${encodeURIComponent(orderNumber)}`;
    }

    // Notify admin
    NotificationService.onNewOrder(order).catch(console.error);

    const msg = `<b>✅ Order Created!</b>\n\n` +
                `Order #: <code>${orderNumber}</code>\n` +
                `Product: ${product.name}\n` +
                `Quantity: ${quantity}\n` +
                `Total: ${getSetting('currency', 'PHP')} ${total}\n\n` +
                `Payment: ${methodIcon} <b>${methodName}</b>\n\n` +
                `Click the button below to proceed to payment:`;

    const buttons = [[
      {
        text: `${methodIcon} Pay with ${methodName}`,
        url: paymentUrl
      }
    ]];

    await editMessage(chatId, messageId, msg, { reply_markup: { inline_keyboard: buttons } });
  } catch (e) {
    console.error('[TelegramBot] Payment method error:', e);
    // Mark order as failed
    try {
      const db = require('./db');
      db.prepare("UPDATE orders SET status = 'failed', admin_notes = ? WHERE id = ?")
        .run('Telegram order error: ' + e.message, order.id);
    } catch (dbErr) {
      console.error('[TelegramBot] Failed to update order status:', dbErr);
    }
    
    await editMessage(chatId, messageId, 
      `❌ Payment error: ${e.message}\n\nPlease try again or contact support.`
    );
  }
}

async function handleCallbackQuery(chatId, messageId, userId, username, callbackData) {
  if (callbackData === 'menu') {
    await handleMenu(chatId, messageId);
  } else if (callbackData.startsWith('prod_')) {
    const productId = parseInt(callbackData.substring(5), 10);
    await handleProductSelected(chatId, messageId, productId);
  } else if (callbackData.startsWith('qty_')) {
    const parts = callbackData.substring(4).split('_');
    const productId = parseInt(parts[0], 10);
    const quantity = parseInt(parts[1], 10);
    await handleQuantitySelected(chatId, messageId, productId, quantity);
  } else if (callbackData.startsWith('pay_')) {
    const parts = callbackData.substring(4).split('_');
    const productId = parseInt(parts[0], 10);
    const quantity = parseInt(parts[1], 10);
    const paymentType = parts.slice(2).join('_');
    await handlePaymentMethod(chatId, messageId, userId, username, productId, quantity, paymentType);
  }
}

async function handleUpdate(update) {
  try {
    // Handle messages (commands)
    if (update.message) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const username = update.message.from.username || update.message.from.first_name;
      const text = update.message.text || '';

      if (text === '/start') {
        await handleStart(chatId, userId, username);
        await new Promise(r => setTimeout(r, 500)); // Small delay
        await handleMenu(chatId);
      } else if (text === '/menu') {
        await handleMenu(chatId);
      } else if (text === '/help') {
        const msg = `<b>📖 Commands</b>\n\n` +
                    `/menu - Browse our products\n` +
                    `/help - Show this help message\n\n` +
                    `Simply select a product and follow the payment flow!`;
        await sendMessage(chatId, msg);
      } else {
        const msg = `👋 Type /menu to start shopping or /help for more info.`;
        await sendMessage(chatId, msg);
      }
    }

    // Handle callback queries (button presses)
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const chatId = callbackQuery.message.chat.id;
      const messageId = callbackQuery.message.message_id;
      const userId = callbackQuery.from.id;
      const username = callbackQuery.from.username || callbackQuery.from.first_name;
      const callbackData = callbackQuery.data;

      await handleCallbackQuery(chatId, messageId, userId, username, callbackData);

      // Acknowledge callback query
      if (BOT_TOKEN) {
        await fetch(`${BOT_API}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id })
        });
      }
    }
  } catch (e) {
    console.error('[TelegramBot] Handle update error:', e);
  }
}

const TelegramBot = {
  isConfigured: () => !!BOT_TOKEN,
  handleUpdate
};

module.exports = TelegramBot;
