'use strict';

/**
 * Payment and brand logos served from local SVG assets.
 */
const ICONS = {
  // E-Wallets & Digital Payments
  gcash: '/static/img/payments/gcash.svg',
  maya: '/static/img/payments/maya.svg',
  paymaya: '/static/img/payments/maya.svg',
  grabpay: '/static/img/payments/paymongo.svg',
  grab: '/static/img/payments/paymongo.svg',
  grabpay: '/static/img/payments/grabpay.svg',
  grab: '/static/img/payments/grabpay.svg',
  shopeepay: '/static/img/payments/shopeepay.svg',
  shopee: '/static/img/payments/shopeepay.svg',
  coins: '/static/img/payments/coins.svg',
  'coins.ph': '/static/img/payments/coins.svg',
  coinsph: '/static/img/payments/coins.svg',
  paymongo: '/static/img/payments/paymongo.svg',
  xendit: '/static/img/payments/xendit.svg',
  swiftpay: '/static/img/payments/swiftpay.svg',
  swiftpayph: '/static/img/payments/swiftpay.svg',
  'swiftpay ph': '/static/img/payments/swiftpay.svg',
  alipay: '/static/img/payments/alipay.svg',
  'alipay pay': '/static/img/payments/alipay.svg',
  wechat: '/static/img/payments/wechat.svg',
  'wechat pay': '/static/img/payments/wechat.svg',
  billease: '/static/img/payments/paymongo.svg',

  // Cards
  visa: '/static/img/payments/visa.svg',
  mastercard: '/static/img/payments/mastercard.svg',
  jcb: '/static/img/payments/jcb.svg',
  amex: '/static/img/payments/amex.svg',

  // Banks (PH & International)
  bpi: '/static/img/payments/bpi.svg',
  'bank of the philippine islands': '/static/img/payments/bpi.svg',
  unionbank: '/static/img/payments/unionbank.svg',
  'union bank': '/static/img/payments/unionbank.svg',
  'unionbank of the philippines': '/static/img/payments/unionbank.svg',
  bdo: '/static/img/payments/bdo.svg',
  'banco de oro': '/static/img/payments/bdo.svg',
  metrobank: '/static/img/payments/metrobank.svg',
  'metropolitan bank': '/static/img/payments/metrobank.svg',
  rcbc: '/static/img/payments/rcbc.svg',
  'rizal commercial': '/static/img/payments/rcbc.svg',
  landbank: '/static/img/payments/landbank.svg',
  'land bank': '/static/img/payments/landbank.svg',
  securitybank: '/static/img/payments/securitybank.svg',
  'security bank': '/static/img/payments/securitybank.svg',
  chinabank: '/static/img/payments/chinabank.svg',
  'china bank': '/static/img/payments/chinabank.svg',
  'china banking': '/static/img/payments/chinabank.svg',
  pnb: '/static/img/payments/pnb.svg',
  'philippine national bank': '/static/img/payments/pnb.svg',

  // Other
  paypal: '/static/img/payments/paypal.svg',
  // Use generic `coins` asset for crypto and miscellaneous providers where
  // a dedicated icon is not present in the repo yet.
  binance: '/static/img/payments/coins.svg',
  usdt: '/static/img/payments/coins.svg',
  bitcoin: '/static/img/payments/coins.svg',
  ethereum: '/static/img/payments/coins.svg',
  telegram: '/static/img/payments/coins.svg',
  gcash_pro: '/static/img/payments/gcash.svg',
  maya_pro: '/static/img/payments/maya.svg'
};

function getIcon(name, dbIconUrl) {
  if (dbIconUrl) return dbIconUrl;
  const search = (name || '').toLowerCase().trim();

  // Custom keyword mappings for better fuzzy matching
  const keywords = {
    'g-cash': 'gcash',
    'paymaya': 'maya',
    'coinsph': 'coins.ph',
    'union bank': 'unionbank'
  };

  const normalized = keywords[search] || search;

  // Try exact match first
  if (ICONS[normalized]) return ICONS[normalized];

  // Then try substring match
  for (const key in ICONS) {
    if (normalized.includes(key)) return ICONS[key];
  }

  return null;
}

module.exports = {
  ICONS,
  getIcon
};
