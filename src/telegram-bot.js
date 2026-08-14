'use strict';

// Use global fetch (available in Node 18+) or require node-fetch for older versions
const fetch = global.fetch || require('node-fetch');
const { db, getSetting } = require('./db');
const StoreService = require('./services/store');
const { generateOrderNumber } = require('./helpers');
const NotificationService = require('./services/notifications');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  backoffMultiplier: 2
};

const API_TIMEOUT_MS = 10000; // 10 second timeout for API calls

/**
 * Telegram Bot Integration
 * Allows users to browse products and purchase directly via Telegram
 * Uses the same payment flow as the web app
 */

/**
 * Execute API call with retry logic and exponential backoff
 * @param {Function} apiCall - Async function that makes the API call
 * @param {string} operationName - Name of operation for logging
 * @param {number} retryCount - Current retry attempt (internal)
 */
async function executeWithRetry(apiCall, operationName, retryCount = 0) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    
    try {
      const result = await apiCall(controller.signal);
      clearTimeout(timeoutId);
      
      if (!result.ok) {
        const errorData = await result.json().catch(() => ({}));
        
        // Handle rate limiting
        if (result.status === 429) {
          const retryAfter = parseInt(result.headers.get('retry-after') || '1', 10);
          console.warn(`[TelegramBot] ${operationName} rate limited. Retry after ${retryAfter}s`);
          
          if (retryCount < RETRY_CONFIG.maxRetries) {
            const delayMs = Math.min(retryAfter * 1000, RETRY_CONFIG.maxDelayMs);
            await new Promise(r => setTimeout(r, delayMs));
            return executeWithRetry(apiCall, operationName, retryCount + 1);
          }
          throw new Error(`Rate limited after ${RETRY_CONFIG.maxRetries} retries`);
        }
        
        // Don't retry on client errors (except 429)
        if (result.status >= 400 && result.status < 500) {
          throw new Error(`API Error ${result.status}: ${errorData.description || 'Unknown error'}`);
        }
        
        // Retry on server errors
        if (result.status >= 500 && retryCount < RETRY_CONFIG.maxRetries) {
          const delayMs = Math.min(
            RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, retryCount),
            RETRY_CONFIG.maxDelayMs
          );
          console.warn(`[TelegramBot] ${operationName} failed (${result.status}). Retry ${retryCount + 1}/${RETRY_CONFIG.maxRetries} after ${delayMs}ms`);
          await new Promise(r => setTimeout(r, delayMs));
          return executeWithRetry(apiCall, operationName, retryCount + 1);
        }
        
        throw new Error(`API Error ${result.status}: ${errorData.description || 'Unknown error'}`);
      }
      
      return await result.json();
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      console.error(`[TelegramBot] ${operationName} timeout after ${API_TIMEOUT_MS}ms`);
      throw new Error(`Operation timeout (${API_TIMEOUT_MS}ms)`);
    }
    
    if (retryCount < RETRY_CONFIG.maxRetries) {
      const delayMs = Math.min(
        RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, retryCount),
        RETRY_CONFIG.maxDelayMs
      );
      console.warn(`[TelegramBot] ${operationName} error: ${e.message}. Retry ${retryCount + 1}/${RETRY_CONFIG.maxRetries} after ${delayMs}ms`);
      await new Promise(r => setTimeout(r, delayMs));
      return executeWithRetry(apiCall, operationName, retryCount + 1);
    }
    
    console.error(`[TelegramBot] ${operationName} failed after ${RETRY_CONFIG.maxRetries} retries: ${e.message}`);
    throw e;
  }
}

async function sendMessage(chatId, text, options = {}) {
  if (!BOT_TOKEN) return;
  
  return executeWithRetry(
    (signal) => fetch(`${BOT_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...options
      }),
      signal
    }),
    `sendMessage(chat=${chatId})`
  );
}

async function editMessage(chatId, messageId, text, options = {}) {
  if (!BOT_TOKEN) return;
  
  return executeWithRetry(
    (signal) => fetch(`${BOT_API}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        ...options
      }),
      signal
    }),
    `editMessage(chat=${chatId}, msg=${messageId})`
  );
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
  await safeSendMessage(chatId, msg);
}

async function handleMenu(chatId, messageId = null) {
  try {
    const catalog = StoreService.getCatalog();
    
    if (!catalog || catalog.length === 0) {
      const msg = '❌ No products available right now.';
      if (messageId) {
        await safeEditMessage(chatId, messageId, msg);
      } else {
        await safeSendMessage(chatId, msg);
      }
      return;
    }

    const allProducts = catalog.flatMap(c => c.products);
    const msg = `<b>📦 Our Products</b>\n\n` +
                allProducts.map((p, i) => `${i + 1}. <b>${p.name}</b> - ${getSetting('currency', 'PHP')} ${p.price}`).join('\n') +
                `\n\nSelect a product to continue:`;

    const buttons = buildProductButtons(allProducts);

    if (messageId) {
      await safeEditMessage(chatId, messageId, msg, { reply_markup: { inline_keyboard: buttons } });
    } else {
      await safeSendMessage(chatId, msg, { reply_markup: { inline_keyboard: buttons } });
    }
  } catch (e) {
    console.error(`[TelegramBot] Menu handler error for chat ${chatId}:`, e.message);
    await safeSendMessage(chatId, '❌ Could not load products. Please try again.');
  }
}

async function handleProductSelected(chatId, messageId, productId) {
  try {
    const product = StoreService.getProduct(productId);
    if (!product) {
      await safeEditMessage(chatId, messageId, '❌ Product not found.');
      return;
    }

    if (!product.active) {
      await safeEditMessage(chatId, messageId, '❌ This product is no longer available.');
      return;
    }

    const stockStatus = product.stock > 0 ? `✅ In stock (${product.stock} available)` : '❌ Out of stock';
    const msg = `<b>${product.name}</b>\n\n` +
                `💰 Price: ${getSetting('currency', 'PHP')} ${product.price}\n` +
                `📊 ${stockStatus}\n` +
                (product.description ? `\n📝 ${product.description}\n` : '') +
                `\nHow many would you like?`;

    const buttons = buildQuantityButtons(productId);
    await safeEditMessage(chatId, messageId, msg, { reply_markup: { inline_keyboard: buttons } });
  } catch (e) {
    console.error(`[TelegramBot] Product selection error for product ${productId}:`, e.message);
    await safeEditMessage(chatId, messageId, '❌ Error loading product details. Please try again.');
  }
}

async function handleQuantitySelected(chatId, messageId, productId, quantity) {
  try {
    const product = StoreService.getProduct(productId);
    if (!product) {
      await safeEditMessage(chatId, messageId, '❌ Product not found.');
      return;
    }

    if (quantity < (product.min_quantity || 1)) {
      await safeEditMessage(chatId, messageId, 
        `❌ Minimum order is ${product.min_quantity || 1} unit(s).`,
        { reply_markup: { inline_keyboard: buildQuantityButtons(productId) } }
      );
      return;
    }

    if (quantity > product.stock) {
      await safeEditMessage(chatId, messageId,
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
    await safeEditMessage(chatId, messageId, msg, { reply_markup: { inline_keyboard: buttons } });
  } catch (e) {
    console.error(`[TelegramBot] Quantity selection error for product ${productId}, qty ${quantity}:`, e.message);
    await safeEditMessage(chatId, messageId, '❌ Error processing quantity. Please try again.');
  }
}

async function handlePaymentMethod(chatId, messageId, userId, username, productId, quantity, paymentType) {
  const product = StoreService.getProduct(productId);
  if (!product || quantity < (product.min_quantity || 1) || quantity > product.stock) {
    await safeEditMessage(chatId, messageId, '❌ Order validation failed. Please try again.');
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
  let order = null;
  
  try {
    order = StoreService.createOrder({
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
  } catch (orderErr) {
    console.error(`[TelegramBot] Failed to create order for user ${userId}:`, orderErr.message);
    await safeEditMessage(chatId, messageId, '❌ Failed to create order. Please try again.');
    return;
  }

  try {
    const dbModule = require('./db');
    const baseUrl = process.env.BASE_URL || 'https://fblao-shop.up.railway.app';
    let paymentUrl;

    try {
      // Handle different payment methods
      if (paymentType === 'swiftpay_gcash' || paymentType === 'swiftpay_qrph') {
        try {
          const swiftpay = require('./swiftpay');
          const { paymentId, qrCode } = await swiftpay.createQrph(order);
          dbModule.prepare('UPDATE orders SET swiftpay_checkout_id = ?, swiftpay_checkout_url = ? WHERE id = ?')
            .run(paymentId, qrCode, order.id);
          
          paymentType === 'swiftpay_gcash' 
            ? (paymentUrl = `${baseUrl}/swiftpay/gcash?ref=${encodeURIComponent(orderNumber)}`)
            : (paymentUrl = `${baseUrl}/swiftpay/qrph?ref=${encodeURIComponent(orderNumber)}`);
        } catch (swiftpayErr) {
          console.error('[TelegramBot] Swiftpay error:', swiftpayErr.message);
          throw new Error(`Swiftpay error: ${swiftpayErr.message}`);
        }
      } 
      else if (paymentType === 'maya') {
        try {
          const maya = require('./maya');
          const { checkoutId, redirectUrl } = await maya.createCheckout(order, baseUrl);
          dbModule.prepare('UPDATE orders SET maya_checkout_id = ? WHERE id = ?').run(checkoutId, order.id);
          paymentUrl = redirectUrl;
        } catch (mayaErr) {
          console.error('[TelegramBot] Maya error:', mayaErr.message);
          throw new Error(`Maya error: ${mayaErr.message}`);
        }
      }
      else if (paymentType === 'coins') {
        try {
          const coins = require('./coins');
          const { paymentRequestId, redirectUrl } = await coins.createPaymentRequest(order, baseUrl);
          dbModule.prepare('UPDATE orders SET coins_request_id = ? WHERE id = ?').run(paymentRequestId, order.id);
          paymentUrl = redirectUrl;
        } catch (coinsErr) {
          console.error('[TelegramBot] Coins.ph error:', coinsErr.message);
          throw new Error(`Coins.ph error: ${coinsErr.message}`);
        }
      }
      else if (paymentType === 'magpie_alipay' || paymentType === 'magpie_wechat') {
        try {
          const magpie = require('./magpie');
          const method = paymentType === 'magpie_wechat' ? 'wechat' : 'alipay';
          const { sessionId, redirectUrl } = await magpie.createSession(order, method, baseUrl);
          dbModule.prepare('UPDATE orders SET magpie_session_id = ?, magpie_method = ? WHERE id = ?')
            .run(sessionId, method, order.id);
          paymentUrl = redirectUrl;
        } catch (magpieErr) {
          console.error('[TelegramBot] Magpie error:', magpieErr.message);
          throw new Error(`Magpie error: ${magpieErr.message}`);
        }
      }
      else if (paymentType === 'manual') {
        paymentUrl = `${baseUrl}/order/result?ref=${encodeURIComponent(orderNumber)}`;
      }
      else {
        paymentUrl = `${baseUrl}/order/result?ref=${encodeURIComponent(orderNumber)}`;
      }
    } catch (paymentErr) {
      // Payment provider error - still let user access the order
      console.warn(`[TelegramBot] Payment provider setup failed, using fallback URL: ${paymentErr.message}`);
      paymentUrl = `${baseUrl}/order/result?ref=${encodeURIComponent(orderNumber)}`;
    }

    // Notify admin
    try {
      NotificationService.onNewOrder(order).catch(err => {
        console.error('[TelegramBot] Notification service error:', err.message);
      });
    } catch (notifyErr) {
      console.error('[TelegramBot] Failed to notify admin:', notifyErr.message);
    }

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

    await safeEditMessage(chatId, messageId, msg, { reply_markup: { inline_keyboard: buttons } });
  } catch (e) {
    console.error(`[TelegramBot] Payment handler error for user ${userId}:`, e.message);
    // Mark order as failed
    if (order) {
      try {
        const dbModule = require('./db');
        dbModule.prepare("UPDATE orders SET status = 'failed', admin_notes = ? WHERE id = ?")
          .run('Telegram order error: ' + e.message, order.id);
      } catch (dbErr) {
        console.error('[TelegramBot] Failed to update order status:', dbErr.message);
      }
    }
    
    await safeEditMessage(chatId, messageId, 
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

/**
 * Safely send a message with error recovery
 */
async function safeSendMessage(chatId, text, options = {}) {
  try {
    await sendMessage(chatId, text, options);
  } catch (e) {
    console.error(`[TelegramBot] Failed to send message to chat ${chatId}:`, e.message);
    // Attempt to send a simple error notification
    try {
      await fetch(`${BOT_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: '⚠️ An error occurred. Please try again or contact support.'
        })
      });
    } catch (fallbackErr) {
      console.error(`[TelegramBot] Fallback message also failed for chat ${chatId}`);
    }
  }
}

/**
 * Safely edit a message with error recovery
 */
async function safeEditMessage(chatId, messageId, text, options = {}) {
  try {
    await editMessage(chatId, messageId, text, options);
  } catch (e) {
    console.error(`[TelegramBot] Failed to edit message ${messageId} in chat ${chatId}:`, e.message);
    // Fallback to sending a new message
    try {
      await safeSendMessage(chatId, text, options);
    } catch (fallbackErr) {
      console.error(`[TelegramBot] Fallback send also failed for chat ${chatId}`);
    }
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

      try {
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
          await safeSendMessage(chatId, msg);
        } else {
          const msg = `👋 Type /menu to start shopping or /help for more info.`;
          await safeSendMessage(chatId, msg);
        }
      } catch (cmdErr) {
        console.error(`[TelegramBot] Command handler error for user ${userId}:`, cmdErr.message);
        await safeSendMessage(chatId, '❌ An error occurred processing your command. Please try again.');
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

      try {
        await handleCallbackQuery(chatId, messageId, userId, username, callbackData);
      } catch (callbackErr) {
        console.error(`[TelegramBot] Callback handler error for user ${userId}:`, callbackErr.message);
        await safeEditMessage(chatId, messageId, '❌ An error occurred. Please try again or use /menu to restart.');
      }

      // Acknowledge callback query with error state if needed
      if (BOT_TOKEN) {
        try {
          await executeWithRetry(
            (signal) => fetch(`${BOT_API}/answerCallbackQuery`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ callback_query_id: callbackQuery.id }),
              signal
            }),
            `answerCallbackQuery(id=${callbackQuery.id})`
          );
        } catch (ackErr) {
          console.warn(`[TelegramBot] Failed to acknowledge callback query ${callbackQuery.id}:`, ackErr.message);
        }
      }
    }
  } catch (e) {
    console.error('[TelegramBot] Unhandled update error:', e);
  }
}

const TelegramBot = {
  isConfigured: () => !!BOT_TOKEN,
  handleUpdate
};

module.exports = TelegramBot;
