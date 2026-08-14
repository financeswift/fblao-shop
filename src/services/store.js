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
      INSERT INTO product_stock_pool (product_id, account_email_number, account_password, sim_type, esim_qrcode)
      VALUES (?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      // Encrypt password before storing
      const encryptedPassword = encrypt(data.account_password);

      insertStmt.run(
        productId,
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

  // Internal logic method (no transaction)
  _performAutoDeliver(orderId) {
    const order = this.getOrder(orderId);
    if (!order || order.status !== 'paid' || order.delivered_content) return false;

    const product = this.getProduct(order.product_id, false);
    if (!product || !product.auto_deliver) return false;

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
  }
};

module.exports = StoreService;
