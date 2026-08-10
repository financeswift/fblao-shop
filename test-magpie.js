'use strict';

const assert = require('assert');
const magpie = require('./src/magpie');

(async () => {
  const variants = magpie.getSourceTypeCandidates('wechat');
  assert.deepStrictEqual(variants, ['wechatpay', 'wechat', 'wechat_pay', 'wechat-pay']);

  const checkoutUrl = magpie.extractCheckoutUrl({
    data: {
      redirect: {
        checkout_url: 'https://pay.example/checkout'
      }
    }
  });
  assert.strictEqual(checkoutUrl, 'https://pay.example/checkout');

  const id = magpie.extractIdentifier({
    data: {
      source: {
        id: 'src_123'
      }
    }
  });
  assert.strictEqual(id, 'src_123');

  console.log('magpie helper checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
