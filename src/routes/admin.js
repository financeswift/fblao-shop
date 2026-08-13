'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db, getSetting, setSetting, DATA_DIR } = require('../db');
const { requireAdmin, asyncHandler, rateLimit } = require('../middleware');
const StoreService = require('../services/store');

// Setup multer for logo uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    cb(null, DATA_DIR);
  },
  filename: (req, file, cb) => {
    // For logos, we always save as logo.png
    if (file.fieldname === 'logo') {
      cb(null, 'logo.png');
    } else {
      // For others (like DB restore), use a unique name
      cb(null, Date.now() + '-' + file.originalname);
    }
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 2 }, // 2MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only PNG, JPEG, and GIF are allowed.'));
  }
});

// ---- Auth ------------------------------------------------------------------
router.get('/login', (req, res) => {
  if (req.session && req.session.adminId) return res.redirect('/admin');
  res.render('admin/login', { title: 'Admin Login', error: null, layout: false });
});

router.post('/login', rateLimit, (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).render('admin/login', { title: 'Admin Login', error: 'Invalid username or password.', layout: false });
  }
  req.session.adminId = admin.id;
  req.session.adminName = admin.username;
  res.redirect('/admin');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// Everything below requires auth.
router.use(requireAdmin);

function flash(req, msg, type = 'ok') {
  req.session.flash = { msg, type };
}
function takeFlash(req) {
  const f = req.session.flash || null;
  delete req.session.flash;
  return f;
}

// ---- Dashboard / Orders ----------------------------------------------------
router.get('/', (req, res) => {
  const stats = StoreService.getStats();
  const filter = String(req.query.status || 'all');
  const search = String(req.query.search || '').trim().toLowerCase();

  let orders;
  let sql = 'SELECT * FROM orders';
  let params = [];
  let conditions = [];

  if (filter !== 'all') {
    conditions.push('status = ?');
    params.push(filter);
  }

  if (search) {
    conditions.push('(order_number LIKE ? OR email LIKE ? OR telegram_username LIKE ? OR CAST(id AS TEXT) = ?)');
    const p = `%${search}%`;
    params.push(p, p, p, search);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY id DESC LIMIT 200';
  orders = db.prepare(sql).all(...params);

  res.render('admin/orders', { title: 'Orders', active: 'orders', orders, stats, filter, search, flash: takeFlash(req) });
});

router.get('/orders/:id', (req, res) => {
  const order = StoreService.getOrder(req.params.id);
  if (!order) return res.redirect('/admin');

  const manualMethod = order.manual_method_id
    ? db.prepare('SELECT * FROM manual_payment_methods WHERE id = ?').get(order.manual_method_id)
    : null;

  const poolItems = db.prepare('SELECT * FROM product_stock_pool WHERE order_id = ?').all(order.id);

  const customerHistory = (order.telegram_username || order.email)
    ? db.prepare(`
        SELECT * FROM orders
        WHERE (
          (telegram_username IS NOT NULL AND telegram_username = ?)
          OR (email IS NOT NULL AND email = ?)
        )
        AND id != ?
        ORDER BY created_at DESC LIMIT 5
      `).all(order.telegram_username, order.email, order.id)
    : [];

  res.render('admin/order', {
    title: 'Order ' + order.order_number,
    active: 'orders',
    order,
    manualMethod,
    poolItems,
    customerHistory,
    flash: takeFlash(req)
  });
});

// Mark a manual (or pending) order as paid.
router.post('/orders/:id/mark-paid', (req, res) => {
  const order = StoreService.getOrder(req.params.id);
  if (order && (order.status === 'pending')) {
    StoreService.updateOrderStatus(order.id, 'paid', "datetime('now')");
    flash(req, 'Order marked as paid.');
  }
  res.redirect('/admin/orders/' + req.params.id);
});

// Deliver digital goods (account credentials) to the customer.
router.post('/orders/:id/deliver', (req, res) => {
  const order = StoreService.getOrder(req.params.id);
  if (!order) return res.redirect('/admin');
  const content = String(req.body.delivered_content || '').trim();
  if (!content) {
    flash(req, 'Delivery content cannot be empty.', 'error');
    return res.redirect('/admin/orders/' + req.params.id);
  }
  StoreService.deliverOrder(order.id, content);
  flash(req, 'Goods delivered. Customer can now see the content on their order page.');
  res.redirect('/admin/orders/' + req.params.id);
});

router.post('/orders/:id/notes', (req, res) => {
  db.prepare('UPDATE orders SET admin_notes = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(String(req.body.admin_notes || ''), req.params.id);
  flash(req, 'Notes saved.');
  res.redirect('/admin/orders/' + req.params.id);
});

router.post('/orders/:id/update-details', (req, res) => {
  const oldOrder = StoreService.getOrder(req.params.id);
  const newStatus = req.body.status;

  db.prepare(`
    UPDATE orders
    SET status = ?,
        acc_ordered = ?,
        acc_number = ?,
        acc_name = ?,
        acc_username = ?,
        acc_password = ?,
        warranty_period = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    newStatus,
    req.body.acc_ordered,
    req.body.acc_number,
    req.body.acc_name,
    req.body.acc_username,
    req.body.acc_password,
    req.body.warranty_period,
    req.params.id
  );

  // Log status change to audit log if status changed
  if (oldOrder.status !== newStatus) {
    db.prepare(`
      INSERT INTO order_audit_log (order_id, old_status, new_status, change_type, admin_username, notes)
      VALUES (?, ?, ?, 'admin', ?, 'Admin updated order status')
    `).run(req.params.id, oldOrder.status, newStatus, req.session.adminName || 'admin');
  }

  const updatedOrder = StoreService.getOrder(req.params.id);
  const NotificationService = require('../services/notifications');

  if (newStatus === 'paid' && oldOrder.status !== 'paid') {
     NotificationService.onOrderPaid(updatedOrder).catch(console.error);
  } else if (newStatus === 'delivered' && oldOrder.status !== 'delivered') {
     NotificationService.onOrderDelivered(updatedOrder).catch(console.error);
  }

  flash(req, 'Order details updated.');
  res.redirect('/admin/orders/' + req.params.id);
});

router.post('/orders/:id/cancel', (req, res) => {
  const order = StoreService.getOrder(req.params.id);
  db.prepare("UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status = 'pending'").run(req.params.id);

  // Log cancellation to audit log if it was actually cancelled
  const updatedOrder = StoreService.getOrder(req.params.id);
  if (order && order.status === 'pending' && updatedOrder.status === 'cancelled') {
    db.prepare(`
      INSERT INTO order_audit_log (order_id, old_status, new_status, change_type, admin_username, notes)
      VALUES (?, ?, 'cancelled', 'admin', ?, 'Admin cancelled order')
    `).run(req.params.id, order.status, req.session.adminName || 'admin');
  }

  flash(req, 'Order cancelled.');
  res.redirect('/admin/orders/' + req.params.id);
});

router.post('/sync-stock', (req, res) => {
  StoreService.syncAllProductStock();
  flash(req, 'Inventory sync completed from stock pool.');
  res.redirect('/admin');
});

// ---- Categories ------------------------------------------------------------
router.get('/categories', (req, res) => {
  const categories = StoreService.getCategories();
  res.render('admin/categories', { title: 'Categories', active: 'categories', categories, flash: takeFlash(req) });
});
router.post('/categories', (req, res) => {
  StoreService.createCategory(
    String(req.body.name || 'Untitled').trim(),
    parseInt(req.body.sort_order, 10) || 0
  );
  flash(req, 'Category added.');
  res.redirect('/admin/categories');
});
router.post('/categories/:id/update', (req, res) => {
  StoreService.updateCategory(
    req.params.id,
    String(req.body.name || '').trim(),
    parseInt(req.body.sort_order, 10) || 0
  );
  flash(req, 'Category updated.');
  res.redirect('/admin/categories');
});

// ---- Products --------------------------------------------------------------
router.get('/products', (req, res) => {
  const categories = StoreService.getCategories();
  const search = String(req.query.search || '').trim().toLowerCase();
  const catFilter = parseInt(req.query.category_id, 10) || null;

  let products;
  if (search || catFilter) {
    let sql = `SELECT p.*, c.name AS category_name FROM products p
               LEFT JOIN categories c ON c.id = p.category_id
               WHERE 1=1`;
    let params = [];
    if (search) {
      sql += ' AND (p.name LIKE ? OR p.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (catFilter) {
      sql += ' AND p.category_id = ?';
      params.push(catFilter);
    }
    sql += ' ORDER BY c.sort_order, p.sort_order, p.id';
    products = db.prepare(sql).all(...params);
  } else {
    products = StoreService.getProductsAdmin();
  }

  res.render('admin/products', {
    title: 'Products',
    active: 'products',
    products,
    categories,
    search,
    catFilter,
    flash: takeFlash(req)
  });
});

router.post('/products/sync-all', (req, res) => {
  StoreService.syncAllProductStock();
  flash(req, 'All product stock counts synchronized.');
  res.redirect('/admin/products');
});

router.post('/products', (req, res) => {
  StoreService.createProduct({
    category_id: parseInt(req.body.category_id, 10),
    name: String(req.body.name || 'Untitled').trim(),
    description: String(req.body.description || ''),
    price: parseFloat(req.body.price),
    active: !!req.body.active,
    sort_order: parseInt(req.body.sort_order, 10),
    auto_deliver: !!req.body.auto_deliver,
    min_quantity: parseInt(req.body.min_quantity, 10) || 1
  });
  flash(req, 'Product added.');
  res.redirect('/admin/products');
});
router.post('/products/:id/update', (req, res) => {
  StoreService.updateProduct(req.params.id, {
    category_id: parseInt(req.body.category_id, 10),
    name: String(req.body.name || '').trim(),
    description: String(req.body.description || ''),
    price: parseFloat(req.body.price),
    active: !!req.body.active,
    sort_order: parseInt(req.body.sort_order, 10),
    auto_deliver: !!req.body.auto_deliver,
    min_quantity: parseInt(req.body.min_quantity, 10) || 1,
    stock: req.body.stock // Pass stock for manual updates
  });

  if (req.body.action === 'quick_add' && req.body.quick_lines) {
    const lines = String(req.body.quick_lines).split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length > 0) {
      const added = StoreService.addStockToPool(req.params.id, lines);
      flash(req, `Product updated and ${added} stock items added.`);
    } else {
      flash(req, 'Product updated.');
    }
  } else {
    flash(req, 'Product updated.');
  }

  res.redirect('/admin/products');
});

router.post('/products/:id/duplicate', (req, res) => {
  const p = StoreService.getProduct(req.params.id, false);
  if (p) {
    StoreService.createProduct({
      category_id: p.category_id,
      name: p.name + ' (Copy)',
      description: p.description,
      price: p.price,
      active: 0,
      sort_order: p.sort_order + 1,
      auto_deliver: p.auto_deliver
    });
    flash(req, 'Product duplicated as draft.');
  }
  res.redirect('/admin/products');
});

// Stock Pool Routes
router.get('/products/:id/stock', (req, res) => {
  const product = StoreService.getProduct(req.params.id, false);
  if (!product) return res.redirect('/admin/products');

  const pool = db.prepare('SELECT * FROM product_stock_pool WHERE product_id = ? AND is_sold = 0 ORDER BY id DESC').all(product.id);
  const sold = db.prepare(`
    SELECT p.*, o.order_number
    FROM product_stock_pool p
    LEFT JOIN orders o ON o.id = p.order_id
    WHERE p.product_id = ? AND p.is_sold = 1
    ORDER BY p.id DESC LIMIT 100
  `).all(product.id);

  res.render('admin/product-stock', { title: 'Manage Stock: ' + product.name, active: 'products', product, pool, sold, flash: takeFlash(req) });
});

router.get('/products/:id/stock/download-template', (req, res) => {
  const product = StoreService.getProduct(req.params.id);
  if (!product) return res.redirect('/admin/products');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="stock_template_${product.id}.csv"`);
  res.send('content\n' +
           'example_item_1\n' +
           'example_item_2\n' +
           'email:password:2fa_token');
});
router.post('/products/:id/stock/add', multer().single('csv_file'), (req, res) => {
  let lines = [];

  // Handle file upload
  if (req.file) {
    const content = req.file.buffer.toString('utf8');
    lines = content.split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && l.toLowerCase() !== 'content'); // skip header
  }
  // Handle textarea (keep existing)
  else if (req.body.lines) {
    lines = String(req.body.lines || '').split('\n').map(l => l.trim()).filter(l => l);
  }

  if (lines.length > 0) {
    const added = StoreService.addStockToPool(req.params.id, lines);
    flash(req, `Processed ${lines.length} lines. ${added} new items added to stock.`);
  } else {
    flash(req, 'No valid stock lines found.', 'error');
  }
  res.redirect(`/admin/products/${req.params.id}/stock`);
});

router.post('/products/:id/stock/clear', (req, res) => {
  db.prepare('DELETE FROM product_stock_pool WHERE product_id = ? AND is_sold = 0').run(req.params.id);
  StoreService.syncProductStockCount(req.params.id);
  flash(req, 'Unsold stock cleared.');
  res.redirect(`/admin/products/${req.params.id}/stock`);
});
router.post('/products/:id/delete', (req, res) => {
  StoreService.deleteProduct(req.params.id);
  flash(req, 'Product deleted.');
  res.redirect('/admin/products');
});

// ---- Manual payment methods ------------------------------------------------
router.get('/payments', (req, res) => {
  const methods = db.prepare('SELECT * FROM manual_payment_methods ORDER BY sort_order, id').all();
  res.render('admin/payments', { title: 'Manual Payments', active: 'payments', methods, flash: takeFlash(req) });
});
router.post('/payments', (req, res) => {
  db.prepare('INSERT INTO manual_payment_methods (name, instructions, enabled, sort_order) VALUES (?, ?, ?, ?)').run(
    String(req.body.name || 'Method').trim(),
    String(req.body.instructions || ''),
    req.body.enabled ? 1 : 0,
    parseInt(req.body.sort_order, 10) || 0
  );
  flash(req, 'Payment method added.');
  res.redirect('/admin/payments');
});
router.post('/payments/:id/update', (req, res) => {
  db.prepare('UPDATE manual_payment_methods SET name = ?, instructions = ?, enabled = ?, sort_order = ? WHERE id = ?').run(
    String(req.body.name || '').trim(),
    String(req.body.instructions || ''),
    req.body.enabled ? 1 : 0,
    parseInt(req.body.sort_order, 10) || 0,
    req.params.id
  );
  flash(req, 'Payment method updated.');
  res.redirect('/admin/payments');
});
router.post('/payments/:id/delete', (req, res) => {
  db.prepare('DELETE FROM manual_payment_methods WHERE id = ?').run(req.params.id);
  flash(req, 'Payment method deleted.');
  res.redirect('/admin/payments');
});

// ---- Banners ---------------------------------------------------------------
router.get('/banners', (req, res) => {
  const banners = db.prepare('SELECT * FROM banners ORDER BY sort_order, id').all();
  res.render('admin/banners', { title: 'Banners', active: 'banners', banners, flash: takeFlash(req) });
});
router.post('/banners', (req, res) => {
  db.prepare('INSERT INTO banners (text, enabled, sort_order) VALUES (?, ?, ?)').run(
    String(req.body.text || '').trim(),
    req.body.enabled ? 1 : 0,
    parseInt(req.body.sort_order, 10) || 0
  );
  flash(req, 'Banner added.');
  res.redirect('/admin/banners');
});
router.post('/banners/:id/update', (req, res) => {
  db.prepare('UPDATE banners SET text = ?, enabled = ?, sort_order = ? WHERE id = ?').run(
    String(req.body.text || '').trim(),
    req.body.enabled ? 1 : 0,
    parseInt(req.body.sort_order, 10) || 0,
    req.params.id
  );
  flash(req, 'Banner updated.');
  res.redirect('/admin/banners');
});
router.post('/banners/:id/delete', (req, res) => {
  db.prepare('DELETE FROM banners WHERE id = ?').run(req.params.id);
  flash(req, 'Banner deleted.');
  res.redirect('/admin/banners');
});

// ---- Settings (shop + Maya) ------------------------------------------------
router.get('/settings', (req, res) => {
  const dbPath = path.join(DATA_DIR, 'shop.db');
  let dbSize = '0 KB';
  try {
    const stats = fs.statSync(dbPath);
    dbSize = (stats.size / 1024).toFixed(2) + ' KB';
  } catch (e) {}

  res.render('admin/settings', {
    title: 'Settings',
    active: 'settings',
    dbInfo: { path: dbPath, size: dbSize, isPersistent: DATA_DIR === '/data' || !!process.env.DATA_DIR },
    s: {
      shop_name: getSetting('shop_name', ''),
      shop_tagline: getSetting('shop_tagline', ''),
      currency: getSetting('currency', 'PHP'),
      maya_enabled: getSetting('maya_enabled', '0'),
      maya_mode: getSetting('maya_mode', 'sandbox'),
      maya_public_key: getSetting('maya_public_key', ''),
      maya_secret_key: getSetting('maya_secret_key', ''),
      maya_webhook_secret: getSetting('maya_webhook_secret', ''),
      coins_enabled: getSetting('coins_enabled', '0'),
      coins_mode: getSetting('coins_mode', 'sandbox'),
      coins_api_key: getSetting('coins_api_key', ''),
      coins_api_secret: getSetting('coins_api_secret', ''),
      coins_webhook_secret: getSetting('coins_webhook_secret', ''),
      paymongo_enabled: getSetting('paymongo_enabled', '0'),
      paymongo_secret_key: getSetting('paymongo_secret_key', ''),
      paymongo_webhook_secret: getSetting('paymongo_webhook_secret', ''),
      xendit_enabled: getSetting('xendit_enabled', '0'),
      xendit_secret_key: getSetting('xendit_secret_key', ''),
      xendit_callback_token: getSetting('xendit_callback_token', ''),
      swiftpay_enabled: getSetting('swiftpay_enabled', '0'),
      swiftpay_mode: getSetting('swiftpay_mode', 'sandbox'),
      swiftpay_api_base_url: getSetting('swiftpay_api_base_url', ''),
      swiftpay_api_key: getSetting('swiftpay_api_key', ''),
      swiftpay_api_secret: getSetting('swiftpay_api_secret', ''),
      swiftpay_webhook_secret: getSetting('swiftpay_webhook_secret', ''),
      swiftpay_success_url: getSetting('swiftpay_success_url', ''),
      swiftpay_failure_url: getSetting('swiftpay_failure_url', ''),
      swiftpay_cancel_url: getSetting('swiftpay_cancel_url', ''),
      magpie_enabled: getSetting('magpie_enabled', '0'),
      magpie_api_base_url: getSetting('magpie_api_base_url', ''),
      magpie_api_key: getSetting('magpie_api_key', ''),
      magpie_api_secret: getSetting('magpie_api_secret', ''),
      magpie_webhook_secret: getSetting('magpie_webhook_secret', ''),
      magpie_target_currency: getSetting('magpie_target_currency', 'CNY'),
      cf_turnstile_site_key: getSetting('cf_turnstile_site_key', ''),
      cf_turnstile_secret_key: getSetting('cf_turnstile_secret_key', ''),
      cf_site_verification: getSetting('cf_site_verification', ''),
    },
    flash: takeFlash(req),
  });
});

router.get('/settings/db-download', (req, res) => {
  const dbPath = path.join(DATA_DIR, 'shop.db');
  res.download(dbPath, `shop-backup-${new Date().toISOString().split('T')[0]}.db`);
});

router.post('/settings/db-restore', upload.single('db_file'), (req, res) => {
  if (!req.file) {
    flash(req, 'No file uploaded.', 'error');
    return res.redirect('/admin/settings');
  }

  const dbPath = path.join(DATA_DIR, 'shop.db');
  const backupPath = dbPath + '.bak';

  try {
    // 1. Rename current DB as a temporary backup
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, backupPath);
    }

    // 2. Copy uploaded file to the main DB path
    // We use copyFileSync to overwrite it.
    // Node-sqlite's DatabaseSync usually handles this if no active transactions are locked.
    fs.copyFileSync(req.file.path, dbPath);

    // 3. Delete the multer temporary file
    fs.unlinkSync(req.file.path);

    flash(req, 'Database restored successfully. The application may need a moment to sync.');

    // On Railway, overwriting the DB might not trigger a restart, but the next request
    // to the DB will use the new file.
    res.redirect('/admin/settings');
  } catch (e) {
    console.error('Restore failed:', e);
    // Try to restore the backup if it exists
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, dbPath);
    }
    flash(req, 'Restore failed: ' + e.message, 'error');
    res.redirect('/admin/settings');
  }
});
router.post('/settings', (req, res) => {
  setSetting('shop_name', String(req.body.shop_name || '').trim());
  setSetting('shop_tagline', String(req.body.shop_tagline || '').trim());
  setSetting('currency', String(req.body.currency || 'PHP').trim().toUpperCase());
  flash(req, 'Shop settings saved.');
  res.redirect('/admin/settings');
});

router.post('/settings/logo', upload.single('logo'), (req, res) => {
  flash(req, 'Shop logo uploaded successfully.');
  res.redirect('/admin/settings');
}, (error, req, res, next) => {
  // Error handler for multer errors
  flash(req, error.message, 'error');
  res.redirect('/admin/settings');
});

router.post('/settings/maya', (req, res) => {
  setSetting('maya_enabled', req.body.maya_enabled ? '1' : '0');
  setSetting('maya_mode', req.body.maya_mode === 'live' ? 'live' : 'sandbox');
  setSetting('maya_public_key', String(req.body.maya_public_key || '').trim());
  setSetting('maya_secret_key', String(req.body.maya_secret_key || '').trim());
  setSetting('maya_webhook_secret', String(req.body.maya_webhook_secret || '').trim());
  flash(req, 'Maya configuration saved.');
  res.redirect('/admin/settings');
});

router.post('/settings/coins', (req, res) => {
  setSetting('coins_enabled', req.body.coins_enabled ? '1' : '0');
  setSetting('coins_mode', req.body.coins_mode === 'live' ? 'live' : 'sandbox');
  setSetting('coins_api_key', String(req.body.coins_api_key || '').trim());
  setSetting('coins_api_secret', String(req.body.coins_api_secret || '').trim());
  setSetting('coins_webhook_secret', String(req.body.coins_webhook_secret || '').trim());
  flash(req, 'Coins.ph configuration saved.');
  res.redirect('/admin/settings');
});

router.post('/settings/paymongo', (req, res) => {
  setSetting('paymongo_enabled', req.body.paymongo_enabled ? '1' : '0');
  setSetting('paymongo_secret_key', String(req.body.paymongo_secret_key || '').trim());
  setSetting('paymongo_webhook_secret', String(req.body.paymongo_webhook_secret || '').trim());
  flash(req, 'PayMongo configuration saved.');
  res.redirect('/admin/settings');
});

router.post('/settings/xendit', (req, res) => {
  setSetting('xendit_enabled', req.body.xendit_enabled ? '1' : '0');
  setSetting('xendit_secret_key', String(req.body.xendit_secret_key || '').trim());
  setSetting('xendit_callback_token', String(req.body.xendit_callback_token || '').trim());
  flash(req, 'Xendit configuration saved.');
  res.redirect('/admin/settings');
});

router.post('/settings/swiftpay', (req, res) => {
  setSetting('swiftpay_enabled', req.body.swiftpay_enabled ? '1' : '0');
  setSetting('swiftpay_mode', req.body.swiftpay_mode === 'live' ? 'live' : 'sandbox');
  setSetting('swiftpay_api_base_url', String(req.body.swiftpay_api_base_url || '').trim());
  setSetting('swiftpay_api_key', String(req.body.swiftpay_api_key || '').trim());
  setSetting('swiftpay_api_secret', String(req.body.swiftpay_api_secret || '').trim());
  setSetting('swiftpay_webhook_secret', String(req.body.swiftpay_webhook_secret || '').trim());
  setSetting('swiftpay_success_url', String(req.body.swiftpay_success_url || '').trim());
  setSetting('swiftpay_failure_url', String(req.body.swiftpay_failure_url || '').trim());
  setSetting('swiftpay_cancel_url', String(req.body.swiftpay_cancel_url || '').trim());
  flash(req, 'Swiftpay PH configuration saved.');
  res.redirect('/admin/settings');
});

router.post('/settings/magpie', (req, res) => {
  setSetting('magpie_enabled', req.body.magpie_enabled ? '1' : '0');
  setSetting('magpie_mode', req.body.magpie_mode === 'live' ? 'live' : 'sandbox');
  setSetting('magpie_api_base_url', String(req.body.magpie_api_base_url || '').trim());
  setSetting('magpie_api_key', String(req.body.magpie_api_key || '').trim());
  setSetting('magpie_api_secret', String(req.body.magpie_api_secret || '').trim());
  setSetting('magpie_webhook_secret', String(req.body.magpie_webhook_secret || '').trim());
  setSetting('magpie_target_currency', String(req.body.magpie_target_currency || 'CNY').trim().toUpperCase());
  flash(req, 'Magpie configuration saved.');
  res.redirect('/admin/settings');
});

// Test Magpie API connectivity (POST)
router.post('/test/magpie', asyncHandler(async (req, res) => {
  const magpie = require('../magpie');
  const testResult = await magpie.testConnection();
  
  res.status(200).json({
    ok: true,
    test: testResult,
    timestamp: new Date().toISOString(),
  });
}));

// Test Magpie API connectivity (GET) - convenience for mobile/browser when logged in
router.get('/test/magpie', asyncHandler(async (req, res) => {
  const magpie = require('../magpie');
  const testResult = await magpie.testConnection();
  
  // Render a simple page showing JSON result for convenience
  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(JSON.stringify({ ok: true, test: testResult, timestamp: new Date().toISOString() }, null, 2));
}));

router.post('/settings/cloudflare', (req, res) => {
  setSetting('cf_turnstile_site_key', String(req.body.cf_turnstile_site_key || '').trim());
  setSetting('cf_turnstile_secret_key', String(req.body.cf_turnstile_secret_key || '').trim());
  setSetting('cf_site_verification', String(req.body.cf_site_verification || '').trim());
  flash(req, 'Cloudflare settings saved.');
  res.redirect('/admin/settings');
});

// Change admin password
router.post('/settings/password', (req, res) => {
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.session.adminId);
  const current = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');
  if (!admin || !bcrypt.compareSync(current, admin.password_hash)) {
    flash(req, 'Current password is incorrect.', 'error');
    return res.redirect('/admin/settings');
  }
  if (next.length < 6) {
    flash(req, 'New password must be at least 6 characters.', 'error');
    return res.redirect('/admin/settings');
  }
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), admin.id);
  flash(req, 'Password updated.');
  res.redirect('/admin/settings');
});

module.exports = router;
