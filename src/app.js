'use strict';

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const csrf = require('csurf');

const { shopContext } = require('./middleware');
const { db, DB_PATH } = require('./db');
console.log('SQLite database connected at:', DB_PATH);
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const webhookRoutes = require('./routes/webhook');

const app = express();
const PORT = process.env.PORT || 3000;

// Security: Hide Express version
app.disable('x-powered-by');

// Security: Basic headers (poor man's helmet)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Railway (and most PaaS) terminate TLS at a proxy; trust it so req.protocol is https.
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// Capture the raw body for webhook signature verification.
app.use(
  express.json({
    limit: '10kb', // Security: limit payload size
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use('/static', express.static(path.join(__dirname, '..', 'public')));

// Session storage path (persistent on Railway if DATA_DIR is set)
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

// Serve uploaded logo from persistent data dir, falling back to the real PNG asset.
app.get('/logo.png', (req, res) => {
  const logoPath = path.join(DATA_DIR, 'logo.png');
  if (fs.existsSync(logoPath)) {
    res.sendFile(logoPath);
  } else {
    res.sendFile(path.join(__dirname, '..', 'public', 'img', 'logo.png'));
  }
});

const isProd = process.env.NODE_ENV === 'production';

// Security: Ensure SESSION_SECRET is set in production
if (isProd && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'dev-secret')) {
  console.warn('WARNING: SESSION_SECRET is not set or using default value in production!');
}

app.use(
  session({
    store: new FileStore({
      path: path.join(DATA_DIR, 'sessions'),
      retries: 0,
      ttl: 60 * 60 * 8, // 8 hours
    }),
    name: '__shop_sid', // Security: hide session cookie name
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 8,
      secure: isProd, // Only send over HTTPS in production
      sameSite: isProd ? 'lax' : 'none',
    },
  })
);

// CSRF protection middleware
// Store token in session, validate on form submissions
const csrfProtection = csrf({ cookie: false });
app.use(csrfProtection);

// Expose shop settings + helpers to all templates.
app.use(shopContext);

// Health check (used by Railway).
app.get('/health', (req, res) => res.status(200).json({ ok: true }));

app.use('/', publicRoutes);
app.use('/admin', adminRoutes);
app.use('/webhooks', webhookRoutes);

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: 'Not Found', message: 'Page not found.' });
});

// Error handler
app.use((err, req, res, _next) => {
  console.error(err);
  // Ensure basic locals exist for error page
  const locals = {
    title: 'Error',
    message: err.message || 'Something went wrong.',
    shopName: res.locals.shopName || 'Shop',
    settings: res.locals.settings || {},
    currency: res.locals.currency || 'PHP',
    currentPath: req.path,
    isAdmin: !!(req.session && req.session.adminId),
    user: req.session ? req.session.user : null,
    mayaEnabled: res.locals.mayaEnabled || false,
    coinsEnabled: res.locals.coinsEnabled || false,
    paymongoEnabled: res.locals.paymongoEnabled || false,
    xenditEnabled: res.locals.xenditEnabled || false,
    swiftpayEnabled: res.locals.swiftpayEnabled || false,
    magpieEnabled: res.locals.magpieEnabled || false,
    footerMethods: res.locals.footerMethods || [],
    date: res.locals.date || ((d) => d),
    escapeHtml: res.locals.escapeHtml || ((value) => String(value || '')),
    getIcon: res.locals.getIcon || (() => null)
  };
  res.status(500).render('error', locals);
});

app.listen(PORT, () => {
  console.log(`\n  BlackHorse shop running:  http://localhost:${PORT}`);
  console.log(`  Admin panel:             http://localhost:${PORT}/admin\n`);
});
