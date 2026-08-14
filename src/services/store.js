'use strict';

const { db } = require('../db');
const NotificationService = require('./notifications');
const { encrypt, decrypt } = require('../utils/encryption');

const StoreService = {
  // Catalog
  getCatalog() {
    const categories = db.prepare('SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY sort_order, id').all();
    const products = db
      .prepare('SELECT * FROM products WHERE active = 1 AND deleted_at IS NULL ORDER BY sort_order, id')
      .all();
    return categories
      .map((c) => ({ ...c, products: products.filter((p) => p.category_id === c.id) }))
      .filter((c) => c.products.length > 0);
  },

  getEnabledManualMethods() {
    return db
      .prepare('SELECT * FROM manual_payment_methods WHERE enabled = 1 ORDER BY sort_order, id')
      .all();
  },

  // Products
  getProductsAdmin() {
    return db
      .prepare(`SELECT p.*, c.name AS category_name FROM products p
                LEFT JOIN categories c ON c.id = p.category_id
                WHERE p.deleted_at IS NULL
                ORDER BY c.sort_order, p.sort_order, p.id`)
      .all();
  },

  getProduct(id, onlyActive = true) {
    let sql = 'SELECT * FROM products WHERE id = ?';
    if (onlyActive) sql += ' AND active = 1';
    return db.prepare(sql).get(id);
  },

  createProduct(data) {
    return db.prepare(
      'INSERT INTO products (category_id, name, description, price, stock, active, sort_order, auto_deliver, min_quantity, is_rentable, rental_1day_price, rental_7day_price, rental_30day_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      data.category_id || null,
      data.name || 'Untitled',
      data.description || '',
      data.price || 0,
      0,
      data.active ? 1 : 0,
      data.sort_order || 0,
      data.auto_deliver ? 1 : 0,
      data.min_quantity || 1,
      data.is_rentable ? 1 : 0,
      data.rental_1day_price || 0,
      data.rental_7day_price || 0,
      data.rental_30day_price || 0
    );
  },

  updateProduct(id, data) {
    const result = db.prepare(
      'UPDATE products SET category_id = ?, name = ?, description = ?, price = ?, active = ?, sort_order = ?, auto_deliver = ?, min_quantity = ?, is_rentable = ?, rental_1day_price = ?, rental_7day_price = ?, rental_30day_price = ? WHERE id = ?'
    ).run(
      data.category_id || null,
      data.name || '',
      data.description || '',
      data.price || 0,
      data.active ? 1 : 0,
      data.sort_order || 0,
      data.auto_deliver ? 1 : 0,
      data.min_quantity || 1,
      data.is_rentable ? 1 : 0,
      data.rental_1day_price || 0,
      data.rental_7day_price || 0,
      data.rental_30day_price || 0,
      id
    );

    // Only overwrite stock count from pool if auto-deliver is ENABLED
    if (data.auto_deliver) {
      this.syncProductStockCount(id);
    } else if (data.stock !== undefined) {
      // Allow manual stock override if auto-deliver is DISABLED
      db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(parseInt(data.stock, 10) || 0, id);
    }

    return result;
  },

  deleteProduct(id) {
    return db.prepare("UPDATE products SET deleted_at = datetime('now') WHERE id = ?").run(id);
  },

  updateProductStock(id, delta) {
    // We don't manually update stock anymore if using the pool,
    // but we'll keep this for manual products.
    db.prepare('UPDATE products SET stock = MAX(0, stock + ?) WHERE id = ?').run(delta, id);
  },

  // Categories
  getCategories() {
    return db.prepare('SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY sort_order, id').all();
  },

  createCategory(name, sortOrder) {
    return db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)').run(name, sortOrder);
  },

  updateCategory(id, name, sortOrder) {
    return db.prepare('UPDATE categories SET name = ?, sort_order = ? WHERE id = ?').run(name, sortOrder, id);
  },

  deleteCategory(id) {
    return db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  },

  // Stock Pool Management
  addStockToPool(productId, lines) {
    const checkStmt = db.prepare('SELECT id FROM product_stock_pool WHERE product_id = ? AND content = ? AND is_sold = 0');
    const insertStmt = db.prepare('INSERT INTO product_stock_pool (product_id, content) VALUES (?, ?)');

    let added = 0;
    const tx = db.transaction(() => {
      for (let line of lines) {
        const content = line.trim();
        if (!content) continue;

        // Simple duplicate prevention within same product
        const exists = checkStmt.get(productId, content);
        if (!exists) {
          insertStmt.run(productId, content);
          added++;
        }
      }
      this.syncProductStockCount(productId);
    });
    tx();
    return added;
  },

  // Add structured account data to stock pool (SIM/eSIM with credentials)
  addStructuredStockItem(productId, data) {
    const insertStmt = db.prepare(`
      INSERT INTO product_stock_pool (product_id, content, account_email_number, account_password, sim_type, esim_qrcode)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      // Encrypt password before storing
      const encryptedPassword = encrypt(data.account_password);
      const contentText = String(data.account_email_number || '').trim() || `Account ${Date.now()}`;

      insertStmt.run(
        productId,
        contentText,
        data.account_email_number,
        encryptedPassword,
        data.sim_type || 'SIM',
        data.esim_qrcode || null
      );

      this.syncProductStockCount(productId);
      return true;
    });

    return tx();
  },

  syncProductStockCount(productId) {
    const count = db.prepare('SELECT COUNT(*) c FROM product_stock_pool WHERE product_id = ? AND is_sold = 0').get(productId).c;
    db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(count, productId);
  },

  syncAllProductStock() {
    const products = db.prepare('SELECT id FROM products').all();
    const tx = db.transaction(() => {
      for (const p of products) {
        this.syncProductStockCount(p.id);
      }
    });
    tx();
  },

  // Public transactional method
  autoDeliver(orderId) {
    const tx = db.transaction(() => {
      return this._performAutoDeliver(orderId);
    });
    return tx();
  },

  // Check if product is a payment channel
  isPaymentChannelProduct(product) {
    if (!product) return false;
    const category = db.prepare('SELECT name FROM categories WHERE id = ?').get(product.category_id);
    return category && (category.name.includes('Payment Code') || category.name.includes('payment channel'));
  },

  // Get payment channel credentials for a product
  getPaymentChannelCredentials(productId) {
    return db.prepare('SELECT * FROM payment_channel_credentials WHERE product_id = ? AND enabled = 1')
      .get(productId);
  },

  // Create or update payment channel credentials
  setPaymentChannelCredentials(productId, data) {
    const existing = db.prepare('SELECT id FROM payment_channel_credentials WHERE product_id = ?').get(productId);
    
    if (existing) {
      db.prepare(`
        UPDATE payment_channel_credentials 
        SET channel_name = ?, connection_url = ?, api_key = ?, api_secret = ?, 
            account_number = ?, merchant_id = ?, webhook_url = ?, instructions = ?, 
            enabled = ?, updated_at = datetime('now')
        WHERE product_id = ?
      `).run(
        data.channel_name || '',
        data.connection_url || '',
        data.api_key || '',
        data.api_secret || '',
        data.account_number || '',
        data.merchant_id || '',
        data.webhook_url || '',
        data.instructions || '',
        data.enabled ? 1 : 0,
        productId
      );
    } else {
      db.prepare(`
        INSERT INTO payment_channel_credentials 
        (product_id, channel_name, connection_url, api_key, api_secret, account_number, merchant_id, webhook_url, instructions, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        productId,
        data.channel_name || '',
        data.connection_url || '',
        data.api_key || '',
        data.api_secret || '',
        data.account_number || '',
        data.merchant_id || '',
        data.webhook_url || '',
        data.instructions || '',
        data.enabled ? 1 : 0
      );
    }
    return this.getPaymentChannelCredentials(productId);
  },

  // Generate payment channel connection details
  generatePaymentChannelConnection(orderId, productId) {
    const credentials = this.getPaymentChannelCredentials(productId);
    if (!credentials) return null;

    return {
      channel_name: credentials.channel_name,
      connection_url: credentials.connection_url,
      api_key: credentials.api_key,
      merchant_id: credentials.merchant_id,
      account_number: credentials.account_number,
      instructions: credentials.instructions,
      connected_at: new Date().toISOString()
    };
  },

  // Internal logic method (no transaction)
  _performAutoDeliver(orderId) {
    const order = this.getOrder(orderId);
    if (!order || order.status !== 'paid' || order.delivered_content) return false;

    const product = this.getProduct(order.product_id, false);
    if (!product || !product.auto_deliver) return false;

    // Check if this is a payment channel product
    if (this.isPaymentChannelProduct(product)) {
      const connectionData = this.generatePaymentChannelConnection(orderId, product.id);
      if (!connectionData) {
        db.prepare("UPDATE orders SET admin_notes = 'AUTO-DELIVERY FAILED: Payment channel not configured.' WHERE id = ?")
          .run(orderId);
        return false;
      }

      let deliveredContent = `🔗 Payment Channel Connection Details\n`;
      deliveredContent += `═════════════════════════════════════\n\n`;
      deliveredContent += `Channel: ${connectionData.channel_name}\n`;
      deliveredContent += `Connected: ${new Date(connectionData.connected_at).toLocaleString()}\n\n`;
      
      if (connectionData.connection_url) {
        deliveredContent += `📍 Connection URL:\n${connectionData.connection_url}\n\n`;
      }
      if (connectionData.api_key) {
        deliveredContent += `🔑 API Key:\n${connectionData.api_key}\n\n`;
      }
      if (connectionData.merchant_id) {
        deliveredContent += `🏢 Merchant ID:\n${connectionData.merchant_id}\n\n`;
      }
      if (connectionData.account_number) {
        deliveredContent += `💳 Account Number:\n${connectionData.account_number}\n\n`;
      }
      if (connectionData.instructions) {
        deliveredContent += `📖 Setup Instructions:\n${connectionData.instructions}\n`;
      }

      db.prepare("UPDATE orders SET delivered_content = ?, status = 'delivered', delivered_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
        .run(deliveredContent, orderId);

      // Record connection in history (Enhancement 3)
      this.recordPaymentChannelConnection(orderId, product.id, order.telegram_username);

      return true;
    }

    // Original auto-delivery for account/stock pool products
    const items = db.prepare('SELECT * FROM product_stock_pool WHERE product_id = ? AND is_sold = 0 LIMIT ?')
      .all(order.product_id, order.quantity);

    if (items.length < order.quantity) {
      // Not enough stock in pool! Log for admin.
      db.prepare("UPDATE orders SET admin_notes = 'AUTO-DELIVERY FAILED: Insufficient stock in pool.' WHERE id = ?")
        .run(orderId);
      return false;
    }

    const itemIds = items.map(i => i.id);

    // Build structured delivery content based on account type
    let deliveredContent = '';
    if (items[0].account_email_number) {
      // Structured account data with credentials and SIM type
      const contentLines = items.map(item => {
        // Decrypt password before displaying
        const decryptedPassword = decrypt(item.account_password) || item.account_password;
        let line = `Email/Number: ${item.account_email_number}\nPassword: ${decryptedPassword}\nSIM Type: ${item.sim_type || 'SIM'}`;
        
        if (item.sim_type === 'eSIM' && item.esim_qrcode) {
          line += `\neSIM QR Code: ${item.esim_qrcode}`;
        }
        
        return line;
      }).join('\n---\n');
      
      deliveredContent = contentLines;
    } else {
      // Legacy plain text content
      deliveredContent = items.map(i => i.content).join('\n');
    }

    // Mark items as sold
    const markSold = db.prepare("UPDATE product_stock_pool SET is_sold = 1, order_id = ?, sold_at = datetime('now') WHERE id = ?");
    for (const id of itemIds) markSold.run(orderId, id);

    // Update order with structured delivery info
    db.prepare("UPDATE orders SET delivered_content = ?, status = 'delivered', delivered_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .run(deliveredContent, orderId);

    this.syncProductStockCount(order.product_id);
    return true;
  },

  // Orders
  getOrder(idOrNumber) {
    const field = typeof idOrNumber === 'number' || /^\d+$/.test(idOrNumber) ? 'id' : 'order_number';
    return db.prepare(`SELECT * FROM orders WHERE ${field} = ?`).get(idOrNumber);
  },

  getOrderByTGAndRef(tg, ref) {
    return db.prepare('SELECT * FROM orders WHERE lower(telegram_username) = ? AND order_number = ?').get(tg.toLowerCase(), ref);
  },

  getOrdersByTelegramUsername(tgUsername) {
    return db.prepare('SELECT * FROM orders WHERE lower(telegram_username) = ? ORDER BY id DESC').all(tgUsername.toLowerCase());
  },

  createOrder(data) {
    const info = db.prepare(`
      INSERT INTO orders
      (order_number, email, telegram_username, telegram_id, product_id, product_name, quantity, unit_price, total, currency, payment_type, manual_method_id, sim_type_selected, delivery_address, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      data.orderNumber,
      data.email,
      data.telegramUsername,
      data.telegramId,
      data.productId,
      data.productName,
      data.quantity,
      data.unitPrice,
      data.total,
      data.currency,
      data.paymentType,
      data.manualMethodId,
      data.simTypeSelected || null,
      data.deliveryAddress || null
    );
    return this.getOrder(info.lastInsertRowid);
  },

  updateOrderStatus(orderId, status, paidAt = null) {
    const order = this.getOrder(orderId);
    if (!order) return;

    const tx = db.transaction(() => {
      let updateSql, params;
      if (paidAt === "datetime('now')") {
        updateSql = "UPDATE orders SET status = ?, paid_at = datetime('now'), updated_at = datetime('now') WHERE id = ?";
        params = [status, orderId];
      } else if (paidAt) {
        updateSql = "UPDATE orders SET status = ?, paid_at = ?, updated_at = datetime('now') WHERE id = ?";
        params = [status, paidAt, orderId];
      } else {
        updateSql = "UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?";
        params = [status, orderId];
      }

      db.prepare(updateSql).run(...params);

      // Log status change to audit log
      if (order.status !== status) {
        db.prepare(`
          INSERT INTO order_audit_log (order_id, old_status, new_status, change_type, notes)
          VALUES (?, ?, ?, 'auto', null)
        `).run(orderId, order.status, status);
      }

      // If transition to paid, decrease stock
      if (status === 'paid' && order.status !== 'paid' && order.status !== 'delivered' && order.product_id) {
        const product = this.getProduct(order.product_id, false);
        if (product && product.auto_deliver) {
          this._performAutoDeliver(orderId);
        } else {
          this.updateProductStock(order.product_id, -order.quantity);
        }
      }
    });
    tx();

    // Post-transaction notifications (outside transaction)
    const updatedOrder = this.getOrder(orderId);
    if (status === 'paid' && order.status !== 'paid') {
      NotificationService.onOrderPaid(updatedOrder).catch(console.error);
      // If auto-delivery ran during this transition, also fire the delivered notification
      if (updatedOrder && updatedOrder.status === 'delivered') {
        NotificationService.onOrderDelivered(updatedOrder).catch(console.error);
      }
    } else if (status === 'delivered' && order.status !== 'delivered') {
      NotificationService.onOrderDelivered(updatedOrder).catch(console.error);
    }
  },

  deliverOrder(orderId, content) {
    const order = this.getOrder(orderId);
    db.prepare("UPDATE orders SET delivered_content = ?, status = 'delivered', delivered_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .run(content, orderId);

    // Decrement stock for non-auto-deliver products only if stock hasn't already
    // been decremented (i.e. the order was never transitioned through 'paid')
    if (order && order.product_id) {
      const product = this.getProduct(order.product_id, false);
      if (product && !product.auto_deliver && order.status !== 'paid' && order.status !== 'delivered') {
        this.updateProductStock(order.product_id, -order.quantity);
      }
    }

    const updatedOrder = this.getOrder(orderId);
    NotificationService.onOrderDelivered(updatedOrder).catch(console.error);
  },

  // Admin Stats
  getStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthStartIso = monthStart.toISOString();

    return {
      orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
      orders24h: db.prepare("SELECT COUNT(*) c FROM orders WHERE created_at >= ?").get(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).c,
      pending: db.prepare("SELECT COUNT(*) c FROM orders WHERE status = 'pending'").get().c,
      paid: db.prepare("SELECT COUNT(*) c FROM orders WHERE status = 'paid'").get().c,
      delivered: db.prepare("SELECT COUNT(*) c FROM orders WHERE status = 'delivered'").get().c,
      revenue: db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status IN ('paid','delivered')").get().s,
      revenueToday: db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status IN ('paid','delivered') AND created_at >= ?").get(todayIso).s,
      revenueMonth: db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status IN ('paid','delivered') AND created_at >= ?").get(monthStartIso).s,
      products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
      lowStock: db.prepare('SELECT COUNT(*) c FROM products WHERE stock <= 5 AND active = 1').get().c,
      topProducts: db.prepare(`
        SELECT product_name, SUM(quantity) as total_sold
        FROM orders
        WHERE status IN ('paid', 'delivered')
        GROUP BY product_name
        ORDER BY total_sold DESC
        LIMIT 5
      `).all(),
      paymentBreakdown: db.prepare(`
        SELECT payment_type, COUNT(*) as count, COALESCE(SUM(total), 0) as sum
        FROM orders
        WHERE status IN ('paid', 'delivered')
        GROUP BY payment_type
        ORDER BY sum DESC
      `).all(),
      recentOrders: (() => {
        const raw = db.prepare(`
          SELECT date(created_at) AS day, COUNT(*) AS count, COALESCE(SUM(total), 0) AS revenue
          FROM orders
          WHERE created_at >= datetime('now','-6 days')
          GROUP BY day
          ORDER BY day ASC
        `).all();

        const list = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date(Date.now() - i * 86400000);
          const dayKey = d.toISOString().slice(0, 10);
          const row = raw.find((r) => r.day === dayKey);
          list.push({
            day: dayKey,
            label: d.toLocaleDateString('en-PH', { month: 'short', day: '2-digit' }),
            count: row ? row.count : 0,
            revenue: row ? row.revenue : 0
          });
        }
        return list;
      })()
    };
  },

  // ============================================
  // ENHANCEMENT 1: Payment Channel Analytics
  // ============================================
  getPaymentChannelAnalytics() {
    return db.prepare(`
      SELECT 
        pc.product_id,
        pc.channel_name,
        p.name AS product_name,
        COUNT(DISTINCT pcc.order_id) AS total_connections,
        COUNT(CASE WHEN pcc.connection_status = 'connected' THEN 1 END) AS successful_connections,
        COUNT(CASE WHEN pcc.connection_status = 'failed' THEN 1 END) AS failed_connections,
        COALESCE(SUM(o.total), 0) AS total_revenue,
        MAX(pcc.connected_at) AS last_connection,
        pc.enabled,
        pc.created_at
      FROM payment_channel_credentials pc
      LEFT JOIN products p ON p.id = pc.product_id
      LEFT JOIN payment_channel_connections pcc ON pcc.product_id = pc.product_id
      LEFT JOIN orders o ON o.id = pcc.order_id
      GROUP BY pc.product_id, pc.channel_name
      ORDER BY total_revenue DESC, total_connections DESC
    `).all();
  },

  getPaymentChannelAnalyticsForProduct(productId) {
    return db.prepare(`
      SELECT 
        pc.product_id,
        pc.channel_name,
        p.name AS product_name,
        COUNT(DISTINCT pcc.order_id) AS total_connections,
        COUNT(CASE WHEN pcc.connection_status = 'connected' THEN 1 END) AS successful_connections,
        COUNT(CASE WHEN pcc.connection_status = 'failed' THEN 1 END) AS failed_connections,
        COALESCE(SUM(o.total), 0) AS total_revenue,
        MAX(pcc.connected_at) AS last_connection,
        pc.enabled
      FROM payment_channel_credentials pc
      LEFT JOIN products p ON p.id = pc.product_id
      LEFT JOIN payment_channel_connections pcc ON pcc.product_id = pc.product_id
      LEFT JOIN orders o ON o.id = pcc.order_id
      WHERE pc.product_id = ?
      GROUP BY pc.product_id
    `).get(productId);
  },

  // ============================================
  // ENHANCEMENT 2: API Credentials Verification
  // ============================================
  async verifyPaymentChannelCredentials(productId) {
    const credentials = this.getPaymentChannelCredentials(productId);
    if (!credentials) {
      throw new Error('Credentials not found');
    }

    const product = this.getProduct(productId);
    const channelName = credentials.channel_name;

    try {
      // Log verification attempt
      const verificationId = db.prepare(`
        INSERT INTO payment_channel_api_verifications 
        (product_id, channel_name, verification_type, status)
        VALUES (?, ?, 'connection_test', 'pending')
      `).run(productId, channelName).lastInsertRowid;

      let verificationResult = {
        verified: true,
        message: `Verification test for ${channelName}`,
        details: {}
      };

      // Test connection to the URL if provided
      if (credentials.connection_url) {
        try {
          const response = await fetch(credentials.connection_url, {
            method: 'HEAD',
            timeout: 5000
          }).catch(() => ({ status: -1 }));
          
          verificationResult.details.url_status = response.status;
          verificationResult.details.url_accessible = response.status !== -1;
        } catch (e) {
          verificationResult.details.url_error = e.message;
          verificationResult.details.url_accessible = false;
        }
      }

      // Check for required fields
      const requiredFields = ['api_key', 'merchant_id', 'account_number'].filter(f => credentials[f]);
      verificationResult.details.configured_fields = requiredFields;
      verificationResult.details.all_required_fields = requiredFields.length > 0;

      // Update verification record
      db.prepare(`
        UPDATE payment_channel_api_verifications 
        SET status = 'verified', response_data = ?, verified_at = datetime('now')
        WHERE id = ?
      `).run(JSON.stringify(verificationResult), verificationId);

      return { success: true, verification: verificationResult };
    } catch (error) {
      // Log verification failure
      db.prepare(`
        UPDATE payment_channel_api_verifications 
        SET status = 'failed', error_message = ?, verified_at = datetime('now')
        WHERE product_id = ?
      `).run(error.message, productId);

      return { success: false, error: error.message };
    }
  },

  getCredentialVerificationHistory(productId, limit = 10) {
    return db.prepare(`
      SELECT * FROM payment_channel_api_verifications 
      WHERE product_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(productId, limit);
  },

  // ============================================
  // ENHANCEMENT 3: Connection History Tracking
  // ============================================
  recordPaymentChannelConnection(orderId, productId, customerTelegram) {
    const order = this.getOrder(orderId);
    const product = this.getProduct(productId);
    const credentials = this.getPaymentChannelCredentials(productId);

    if (!credentials) return false;

    try {
      db.prepare(`
        INSERT INTO payment_channel_connections 
        (order_id, product_id, telegram_username, channel_name, connection_status, connected_at)
        VALUES (?, ?, ?, ?, 'connected', datetime('now'))
      `).run(orderId, productId, customerTelegram, credentials.channel_name);
      return true;
    } catch (e) {
      return false;
    }
  },

  getCustomerConnectionHistory(telegramUsername, limit = 50) {
    return db.prepare(`
      SELECT pcc.*, p.name AS product_name, p.price
      FROM payment_channel_connections pcc
      LEFT JOIN products p ON p.id = pcc.product_id
      WHERE lower(pcc.telegram_username) = lower(?)
      ORDER BY pcc.connected_at DESC
      LIMIT ?
    `).all(telegramUsername, limit);
  },

  getConnectionsByOrderId(orderId) {
    return db.prepare(`
      SELECT pcc.*, p.name AS product_name
      FROM payment_channel_connections pcc
      LEFT JOIN products p ON p.id = pcc.product_id
      WHERE pcc.order_id = ?
      ORDER BY pcc.connected_at DESC
    `).all(orderId);
  },

  // ============================================
  // ENHANCEMENT 4: Webhook Logging System
  // ============================================
  logWebhookEvent(productId, eventType, payload, responseStatus = null, responseMessage = null) {
    const credentials = this.getPaymentChannelCredentials(productId);
    const channelName = credentials ? credentials.channel_name : 'Unknown';

    try {
      db.prepare(`
        INSERT INTO payment_channel_webhook_logs 
        (product_id, channel_name, event_type, payload, response_status, response_message, received_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        productId,
        channelName,
        eventType,
        typeof payload === 'string' ? payload : JSON.stringify(payload),
        responseStatus,
        responseMessage
      );
      return true;
    } catch (e) {
      console.error('Error logging webhook:', e);
      return false;
    }
  },

  getWebhookLogs(productId = null, limit = 100, offset = 0) {
    let sql = `SELECT * FROM payment_channel_webhook_logs`;
    let params = [];

    if (productId) {
      sql += ` WHERE product_id = ?`;
      params.push(productId);
    }

    sql += ` ORDER BY received_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    return db.prepare(sql).all(...params);
  },

  getWebhookLogStats(productId = null) {
    let sql = `
      SELECT 
        channel_name,
        COUNT(*) AS total_webhooks,
        COUNT(DISTINCT DATE(received_at)) AS days_active,
        MAX(received_at) AS last_webhook,
        COUNT(CASE WHEN response_status = 200 THEN 1 END) AS successful,
        COUNT(CASE WHEN response_status != 200 THEN 1 END) AS failed
      FROM payment_channel_webhook_logs
    `;
    let params = [];

    if (productId) {
      sql += ` WHERE product_id = ?`;
      params.push(productId);
    }

    sql += ` GROUP BY channel_name ORDER BY total_webhooks DESC`;

    return db.prepare(sql).all(...params);
  },

  // ============================================
  // ENHANCEMENT 5: Connection Resend Feature
  // ============================================
  resendConnectionToCustomer(orderId, telegramBotService = null) {
    const order = this.getOrder(orderId);
    if (!order || order.status !== 'paid') return false;

    const product = this.getProduct(order.product_id, false);
    if (!product || !this.isPaymentChannelProduct(product)) return false;

    const connectionData = this.generatePaymentChannelConnection(orderId, product.id);
    if (!connectionData) return false;

    // Format the message
    let message = `🔗 Payment Channel Connection (RESENT)\n`;
    message += `═════════════════════════════════════\n\n`;
    message += `Channel: ${connectionData.channel_name}\n\n`;
    
    if (connectionData.connection_url) {
      message += `📍 Connection URL:\n${connectionData.connection_url}\n\n`;
    }
    if (connectionData.api_key) {
      message += `🔑 API Key:\n${connectionData.api_key}\n\n`;
    }
    if (connectionData.merchant_id) {
      message += `🏪 Merchant ID:\n${connectionData.merchant_id}\n\n`;
    }
    if (connectionData.account_number) {
      message += `💳 Account Number:\n${connectionData.account_number}\n\n`;
    }
    if (connectionData.instructions) {
      message += `📝 Setup Instructions:\n${connectionData.instructions}\n\n`;
    }
    message += `⏰ Sent: ${new Date().toLocaleString()}\n`;
    message += `📦 Order: #${order.order_number}`;

    // Update connection record
    try {
      db.prepare(`
        UPDATE payment_channel_connections 
        SET resent_count = resent_count + 1, last_resent_at = datetime('now')
        WHERE order_id = ? AND product_id = ?
      `).run(orderId, product.id);
    } catch (e) {
      // Connection record might not exist, that's ok
    }

    // Add audit log
    db.prepare(`
      INSERT INTO order_audit_log (order_id, changed_by, change_type, old_value, new_value, notes)
      VALUES (?, 'admin_resend', 'connection_resent', null, ?, ?)
    `).run(orderId, connectionData.channel_name, `Resent to ${order.telegram_username}`);

    // Send via Telegram if service is available
    if (telegramBotService) {
      telegramBotService.sendMessage(order.telegram_id || order.telegram_username, message).catch(err => {
        console.error('Failed to send resend message:', err);
      });
    }

    return { success: true, message, order_id: orderId, product_id: product.id };
  },

  getConnectionResendHistory(orderId) {
    return db.prepare(`
      SELECT * FROM payment_channel_connections
      WHERE order_id = ?
      ORDER BY connected_at ASC
    `).all(orderId);
  }
};

module.exports = StoreService;
