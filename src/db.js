'use strict';

const path = require('path');
const fs = require('fs');
const { openDatabase } = require('./sqlite');
const bcrypt = require('bcryptjs');

// DATA_DIR can be overridden (e.g. a mounted Railway volume at /data) so the
// SQLite file survives redeploys. Defaults to the local ./data folder.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = (() => {
  const envPath = process.env.DATABASE_URL || process.env.SQLITE_PATH;
  if (envPath) {
    return envPath.replace(/^sqlite:\/\//i, '');
  }
  return path.join(DATA_DIR, 'shop.db');
})();

const db = (() => {
  try {
    return openDatabase(DB_PATH);
  } catch (err) {
    console.error('Failed to open SQLite database:', DB_PATH);
    throw err;
  }
})();
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       REAL NOT NULL DEFAULT 0,
  stock       INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  auto_deliver INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS product_stock_pool (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  is_sold    INTEGER NOT NULL DEFAULT 0,
  order_id   INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  added_at   TEXT NOT NULL DEFAULT (datetime('now')),
  sold_at    TEXT
);

CREATE TABLE IF NOT EXISTS manual_payment_methods (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  enabled      INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  icon_url     TEXT
);

CREATE TABLE IF NOT EXISTS banners (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  text       TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number     TEXT UNIQUE NOT NULL,
  email            TEXT,
  product_id       INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name     TEXT NOT NULL,
  quantity         INTEGER NOT NULL DEFAULT 1,
  unit_price       REAL NOT NULL DEFAULT 0,
  total            REAL NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'PHP',
  payment_type     TEXT NOT NULL DEFAULT 'maya',
  manual_method_id INTEGER REFERENCES manual_payment_methods(id) ON DELETE SET NULL,
  telegram_username TEXT,
  telegram_id      TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  maya_checkout_id TEXT,
  coins_request_id TEXT,
  paymongo_session_id TEXT,
  xendit_invoice_id TEXT,
  swiftpay_checkout_id TEXT,
  swiftpay_checkout_url TEXT,
  magpie_checkout_id TEXT,
  maya_reference   TEXT,
  delivered_content TEXT,
  admin_notes      TEXT,
  acc_ordered      TEXT,
  acc_number       TEXT,
  acc_name         TEXT,
  acc_username     TEXT,
  acc_password     TEXT,
  warranty_period  TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at          TEXT,
  delivered_at     TEXT
);

CREATE TABLE IF NOT EXISTS order_audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  old_status   TEXT,
  new_status   TEXT NOT NULL,
  change_type  TEXT NOT NULL,
  admin_username TEXT,
  notes        TEXT,
  changed_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_payment_type ON orders(payment_type);
CREATE INDEX IF NOT EXISTS idx_orders_manual_method_id ON orders(manual_method_id);
CREATE INDEX IF NOT EXISTS idx_orders_telegram ON orders(telegram_username);
CREATE INDEX IF NOT EXISTS idx_orders_telegram_id ON orders(telegram_id);
CREATE INDEX IF NOT EXISTS idx_orders_paid_at ON orders(paid_at);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active, sort_order);
CREATE INDEX IF NOT EXISTS idx_stock_product ON product_stock_pool(product_id, is_sold);
CREATE INDEX IF NOT EXISTS idx_stock_order ON product_stock_pool(order_id);
CREATE INDEX IF NOT EXISTS idx_stock_pool_added_at ON product_stock_pool(added_at);
CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name);
CREATE INDEX IF NOT EXISTS idx_audit_log_order ON order_audit_log(order_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at ON order_audit_log(changed_at);
`);

// Migrations for existing database
try { db.exec("ALTER TABLE products ADD COLUMN auto_deliver INTEGER NOT NULL DEFAULT 1"); } catch(e){}
try { db.exec("ALTER TABLE products ADD COLUMN min_quantity INTEGER NOT NULL DEFAULT 1"); } catch(e){}
try { db.exec("ALTER TABLE products ADD COLUMN deleted_at TEXT"); } catch(e){}
try { db.exec("ALTER TABLE categories ADD COLUMN deleted_at TEXT"); } catch(e){}
try { db.exec("ALTER TABLE orders ADD COLUMN telegram_username TEXT"); } catch(e){}
try { db.exec("ALTER TABLE orders ADD COLUMN telegram_id TEXT"); } catch(e){}
try { db.exec("ALTER TABLE orders ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))"); } catch(e){}
try { db.exec("ALTER TABLE orders ADD COLUMN acc_ordered TEXT"); } catch(e){}
try { db.exec("ALTER TABLE orders ADD COLUMN acc_number TEXT"); } catch(e){}
try { db.exec("ALTER TABLE orders ADD COLUMN acc_name TEXT"); } catch(e){}
try { db.exec("ALTER TABLE orders ADD COLUMN acc_username TEXT"); } catch(e){}
try { db.exec("ALTER TABLE orders ADD COLUMN acc_password TEXT"); } catch(e){}
try { db.exec("ALTER TABLE orders ADD COLUMN warranty_period TEXT"); } catch(e){}
try { db.exec("ALTER TABLE orders ADD COLUMN coins_request_id TEXT"); } catch(e){}
try { db.exec("ALTER TABLE orders ADD COLUMN paymongo_session_id TEXT"); } catch(e){}
try { db.exec("ALTER TABLE orders ADD COLUMN xendit_invoice_id TEXT"); } catch(e){}
try { db.exec("ALTER TABLE orders ADD COLUMN swiftpay_checkout_id TEXT"); } catch(e){}
try { db.exec("ALTER TABLE orders ADD COLUMN swiftpay_checkout_url TEXT"); } catch(e){}
try { db.exec("ALTER TABLE orders ADD COLUMN magpie_checkout_id TEXT"); } catch(e){}
try { db.exec("ALTER TABLE product_stock_pool ADD COLUMN sold_at TEXT"); } catch(e){}
try { db.exec("ALTER TABLE categories ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))"); } catch(e){}
try { db.exec("ALTER TABLE products ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))"); } catch(e){}
try { db.exec("ALTER TABLE manual_payment_methods ADD COLUMN icon_url TEXT"); } catch(e){}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_products_deleted ON products(deleted_at)"); } catch(e){}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_categories_deleted ON categories(deleted_at)"); } catch(e){}

// Migrations for structured account data in stock pool
try { db.exec("ALTER TABLE product_stock_pool ADD COLUMN account_email_number TEXT"); } catch(e){}
try { db.exec("ALTER TABLE product_stock_pool ADD COLUMN account_password TEXT"); } catch(e){}
try { db.exec("ALTER TABLE product_stock_pool ADD COLUMN sim_type TEXT DEFAULT 'SIM'"); } catch(e){}
try { db.exec("ALTER TABLE product_stock_pool ADD COLUMN esim_qrcode TEXT"); } catch(e){}

// Migrations for order delivery info and SIM type tracking
try { db.exec("ALTER TABLE orders ADD COLUMN delivery_address TEXT"); } catch(e){}
try { db.exec("ALTER TABLE orders ADD COLUMN sim_type_selected TEXT"); } catch(e){}

// email is already nullable in the CREATE TABLE statement above.
// SQLite doesn't support ALTER COLUMN, so we skip this migration.

// Create triggers AFTER columns are added
try { db.exec(`
  CREATE TRIGGER IF NOT EXISTS update_products_updated_at
  AFTER UPDATE ON products
  FOR EACH ROW
  BEGIN
    UPDATE products SET updated_at = datetime('now') WHERE id = NEW.id;
  END;
`); } catch(e){}

try { db.exec(`
  CREATE TRIGGER IF NOT EXISTS update_categories_updated_at
  AFTER UPDATE ON categories
  FOR EACH ROW
  BEGIN
    UPDATE categories SET updated_at = datetime('now') WHERE id = NEW.id;
  END;
`); } catch(e){}

try { db.exec(`
  CREATE TRIGGER IF NOT EXISTS update_orders_updated_at
  AFTER UPDATE ON orders
  FOR EACH ROW
  BEGIN
    UPDATE orders SET updated_at = datetime('now') WHERE id = NEW.id;
  END;
`); } catch(e){}

// Add Coins.ph Enterprise if it doesn't exist
const coinsExist = db.prepare('SELECT id FROM manual_payment_methods WHERE name = ?').get('Coins.ph Enterprise');
if (!coinsExist) {
  db.prepare('INSERT INTO manual_payment_methods (name, instructions, enabled, sort_order, icon_url) VALUES (?, ?, 1, ?, ?)').run(
    'Coins.ph Enterprise',
    'Send the exact total to Coins.ph Wallet: 0917-000-0000 (BlackHorse).\nUse your ORDER NUMBER as the reference/note.',
    4,
    'https://static.coingecko.com/s/exchanges/images/1114/large/coinsph.png'
  );
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------
const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

function getSetting(key, fallback = null) {
  const row = getSettingStmt.get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  setSettingStmt.run(key, value == null ? '' : String(value));
}
function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

// ---------------------------------------------------------------------------
// First-run seeding
// ---------------------------------------------------------------------------
function seed() {
  const seeded = getSetting('seeded');
  // Safer check: only seed if no categories exist at all
  const hasCategories = db.prepare('SELECT id FROM categories LIMIT 1').get();
  if (seeded === '1' || hasCategories) return;

  const defaults = {
    shop_name: 'BlackHorse',
    shop_tagline: 'Premium digital goods · Instant delivery · 24/7 support',
    currency: process.env.CURRENCY || 'PHP',
    maya_mode: process.env.MAYA_MODE || 'sandbox',
    maya_public_key: process.env.MAYA_PUBLIC_KEY || '',
    maya_secret_key: process.env.MAYA_SECRET_KEY || '',
    maya_webhook_secret: process.env.MAYA_WEBHOOK_SECRET || '',
    maya_enabled: process.env.MAYA_PUBLIC_KEY ? '1' : '0',
    coins_mode: process.env.COINS_MODE || 'sandbox',
    coins_api_key: process.env.COINS_API_KEY || '',
    coins_api_secret: process.env.COINS_API_SECRET || '',
    coins_webhook_secret: process.env.COINS_WEBHOOK_SECRET || '',
    coins_enabled: process.env.COINS_API_KEY ? '1' : '0',
    paymongo_enabled: process.env.PAYMONGO_ENABLED === '1' || !!process.env.PAYMONGO_SECRET_KEY ? '1' : '0',
    paymongo_secret_key: process.env.PAYMONGO_SECRET_KEY || '',
    paymongo_webhook_secret: process.env.PAYMONGO_WEBHOOK_SECRET || '',
    xendit_enabled: process.env.XENDIT_ENABLED === '1' || !!process.env.XENDIT_SECRET_KEY ? '1' : '0',
    xendit_secret_key: process.env.XENDIT_SECRET_KEY || '',
    xendit_callback_token: process.env.XENDIT_CALLBACK_TOKEN || '',
    swiftpay_enabled: process.env.SWIFTPAY_ENABLED === '1' || !!process.env.SWIFTPAY_API_KEY ? '1' : '0',
    swiftpay_mode: process.env.SWIFTPAY_MODE || 'sandbox',
    swiftpay_api_base_url: process.env.SWIFTPAY_API_BASE_URL || '',
    swiftpay_api_key: process.env.SWIFTPAY_API_KEY || '',
    swiftpay_api_secret: process.env.SWIFTPAY_API_SECRET || '',
    swiftpay_webhook_secret: process.env.SWIFTPAY_WEBHOOK_SECRET || '',
    swiftpay_success_url: process.env.SWIFTPAY_SUCCESS_URL || '',
    swiftpay_failure_url: process.env.SWIFTPAY_FAILURE_URL || '',
    swiftpay_cancel_url: process.env.SWIFTPAY_CANCEL_URL || '',
    magpie_enabled: process.env.MAGPIE_ENABLED === '1' || !!process.env.MAGPIE_API_KEY ? '1' : '0',
    magpie_mode: process.env.MAGPIE_MODE || 'sandbox',
    magpie_api_base_url: process.env.MAGPIE_API_BASE_URL || '',
    magpie_api_key: process.env.MAGPIE_API_KEY || '',
    magpie_api_secret: process.env.MAGPIE_API_SECRET || '',
    magpie_webhook_secret: process.env.MAGPIE_WEBHOOK_SECRET || '',
    magpie_target_currency: process.env.MAGPIE_TARGET_CURRENCY || 'CNY',
  };
  for (const [k, v] of Object.entries(defaults)) setSetting(k, v);

  // Seed admin from env
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const exists = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  if (!exists) {
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(
      username,
      bcrypt.hashSync(password, 10)
    );
  }

  // Banners
  const insBanner = db.prepare('INSERT INTO banners (text, enabled, sort_order) VALUES (?, 1, ?)');
  insBanner.run('🎉 Welcome! All accounts are delivered instantly after payment is confirmed.', 1);
  insBanner.run('💬 Need help? Use "Query Order" to check your order status anytime.', 2);

  // Manual payment methods
  const insManual = db.prepare(
    'INSERT INTO manual_payment_methods (name, instructions, enabled, sort_order, icon_url) VALUES (?, ?, 1, ?, ?)'
  );
  insManual.run(
    'GCash',
    'Send the exact total to GCash number 0917-000-0000 (Juan D.).\nUse your ORDER NUMBER as the reference/note.\nAfter sending, your order will be confirmed by our staff, usually within 30 minutes.',
    1,
    'https://cdn.paymongo.com/images/gcash.png'
  );
  insManual.run(
    'Bank Transfer (BPI)',
    'Transfer the exact total to:\nBank: BPI\nAccount Name: BlackHorse\nAccount No: 1234-5678-90\nUse your ORDER NUMBER as the reference.\nUpload nothing — we verify by reference number.',
    2,
    'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/BPI_Logo.svg/512px-BPI_Logo.svg.png'
  );
  insManual.run(
    'UnionBank',
    'Transfer the exact total to:\nBank: UnionBank\nAccount Name: BlackHorse\nAccount No: 9876-5432-10\nUse your ORDER NUMBER as the reference.',
    3,
    'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/UnionBank_of_the_Philippines_logo.svg/512px-UnionBank_of_the_Philippines_logo.svg.png'
  );

  // Categories + products
  const insCat = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)');
  const insProd = db.prepare(
    'INSERT INTO products (category_id, name, description, price, stock, active, sort_order, auto_deliver) VALUES (?, ?, ?, ?, ?, ?, ?, 1)'
  );

  // Add default payment categories
  const checkCat = db.prepare('SELECT id FROM categories WHERE name = ? LIMIT 1');
  
  let catBanks = checkCat.get('Banks')?.id;
  if (!catBanks) {
    catBanks = insCat.run('Banks', 1).lastInsertRowid;
  }
  
  let catEwallet = checkCat.get('E-wallet')?.id;
  if (!catEwallet) {
    catEwallet = insCat.run('E-wallet', 2).lastInsertRowid;
  }
  
  let catPhilipCardCode = checkCat.get('Philippine Payment Code')?.id;
  if (!catPhilipCardCode) {
    catPhilipCardCode = insCat.run('Philippine Payment Code', 3).lastInsertRowid;
  }
  
  let catIntlPaymentCode = checkCat.get('International Payment Code')?.id;
  if (!catIntlPaymentCode) {
    catIntlPaymentCode = insCat.run('International Payment Code', 4).lastInsertRowid;
  }
  
  let catPOSMachines = checkCat.get('Payment POS Machines')?.id;
  if (!catPOSMachines) {
    catPOSMachines = insCat.run('Payment POS Machines', 5).lastInsertRowid;
  }

  // Old category for backward compatibility
  let catBankAccounts = checkCat.get('Verified Bank Accounts')?.id;
  if (!catBankAccounts) {
    catBankAccounts = insCat.run('Verified Bank Accounts', 6).lastInsertRowid;
  }
  
  insProd.run(catBankAccounts, 'BPI', 'Verified digital account.', 1500, 34, 1, 1);
  insProd.run(catBankAccounts, 'CIMB', 'Verified digital account.', 1500, 0, 1, 2);
  insProd.run(catBankAccounts, 'COINS PH CORPORATE', 'Verified digital account.', 20000, 0, 1, 3);
  insProd.run(catBankAccounts, 'GCASH 100K', 'Verified digital account.', 1000, 0, 1, 4);
  insProd.run(catBankAccounts, 'GCASH 500K', 'Verified digital account.', 3000, 1, 1, 5);
  insProd.run(catBankAccounts, 'GOTYME', 'Verified digital account.', 1500, 5, 1, 6);
  insProd.run(catBankAccounts, 'MAYA BUSINESS NEGOSYANTE', 'Verified digital account.', 900, 65, 1, 7);
  insProd.run(catBankAccounts, 'NEW MAYA BUSINESS', 'Verified digital account.', 900, 15, 1, 8);
  insProd.run(catBankAccounts, 'PAYMAYA 5M', 'Verified digital account.', 15000, 2, 1, 9);
  insProd.run(catBankAccounts, 'PAYMAYA 500K', 'Verified digital account.', 900, 56, 1, 10);
  insProd.run(catBankAccounts, 'POS', 'Verified digital account.', 80000, 3, 1, 11);
  insProd.run(catBankAccounts, 'RCBC', 'Verified digital account.', 1500, 10, 1, 12);
  insProd.run(catBankAccounts, 'UNION BANK NEGOSYANTE', 'Verified digital account.', 20000, 5, 1, 13);

  setSetting('seeded', '1');
}

seed();

module.exports = { db, getSetting, setSetting, getSettings, DATA_DIR, DB_PATH };
