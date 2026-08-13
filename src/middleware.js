'use strict';

const { getSettings, db } = require('./db');
const { formatMoney, nl2br, escapeHtml, formatDate, timeAgo, getPaymentIcon } = require('./helpers');
const maya = require('./maya');
const coins = require('./coins');
const paymongo = require('./paymongo');
const xendit = require('./xendit');
const swiftpay = require('./swiftpay');
const magpie = require('./magpie');

function shopContext(req, res, next) {
  const settings = getSettings();
  res.locals.settings = settings;
  res.locals.shopName = settings.shop_name || 'Shop';
  res.locals.shopTagline = settings.shop_tagline || '';
  res.locals.currency = settings.currency || 'PHP';
  res.locals.money = (amt) => formatMoney(amt, settings.currency || 'PHP');
  res.locals.date = formatDate;
  res.locals.timeAgo = timeAgo;
  res.locals.nl2br = nl2br;
  res.locals.escapeHtml = escapeHtml;
  res.locals.getIcon = getPaymentIcon;

  // Fetch enabled manual methods for footer
  res.locals.footerMethods = db.prepare('SELECT name, icon_url FROM manual_payment_methods WHERE enabled = 1 ORDER BY sort_order').all();
  res.locals.mayaEnabled = maya.isConfigured();
  res.locals.coinsEnabled = coins.isConfigured();
  res.locals.paymongoEnabled = paymongo.isConfigured();
  res.locals.xenditEnabled = xendit.isConfigured();
  res.locals.swiftpayEnabled = swiftpay.isConfigured();
  res.locals.magpieEnabled = magpie.isConfigured();

  res.locals.isAdmin = !!(req.session && req.session.adminId);
  res.locals.user = req.session.user || null;
  res.locals.currentPath = req.path;
  res.locals.baseUrl = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  
  // CSRF token for forms
  res.locals.csrfToken = req.csrfToken();
  
  next();
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) return next();
  if (req.xhr || (req.headers.accept || '').indexOf('json') > -1) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect('/admin/login');
}

// Wrapper for async routes to catch errors
const asyncHandler = (fn) => (req, res, next) => {
  return Promise.resolve(fn(req, res, next)).catch(next);
};

// Simple in-memory rate limiter for sensitive routes
const requestAttempts = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  const limit = 10; // max 10 attempts
  const windowMs = 15 * 60 * 1000; // 15 minutes

  const attempts = requestAttempts.get(ip) || [];
  const recentAttempts = attempts.filter(t => now - t < windowMs);

  if (recentAttempts.length >= limit) {
    return res.status(429).render('error', {
      title: 'Too Many Requests',
      message: 'Too many requests. Please try again in 15 minutes.'
    });
  }

  recentAttempts.push(now);
  requestAttempts.set(ip, recentAttempts);
  next();
}

module.exports = { shopContext, requireAdmin, asyncHandler, rateLimit };
