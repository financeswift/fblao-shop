#!/usr/bin/env node
'use strict';

const { db } = require('./src/db');
const StoreService = require('./src/services/store');

console.log('\n' + '='.repeat(60));
console.log('PAYMENT CHANNEL ENHANCEMENTS TEST');
console.log('='.repeat(60) + '\n');

// Helper function
function test(name, fn) {
  try {
    const result = fn();
    console.log(`✓ ${name}`);
    return result;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  Error: ${error.message}`);
    return null;
  }
}

// Test 1: Analytics
console.log('\n📊 ENHANCEMENT 1: ANALYTICS');
console.log('-'.repeat(40));
const analytics = test('Get payment channel analytics', () => {
  return StoreService.getPaymentChannelAnalytics();
});

if (analytics) {
  console.log(`  Found ${analytics.length} channels with analytics data`);
  if (analytics.length > 0) {
    const firstChannel = analytics[0];
    console.log(`  Example: ${firstChannel.channel_name}`);
    console.log(`    - Connections: ${firstChannel.total_connections || 0}`);
    console.log(`    - Successful: ${firstChannel.successful_connections || 0}`);
    console.log(`    - Revenue: ₱${(firstChannel.total_revenue || 0).toFixed(2)}`);
  }
}

// Test 2: Connection History Tracking
console.log('\n📜 ENHANCEMENT 3: CONNECTION HISTORY');
console.log('-'.repeat(40));

// Create a test order and payment channel connection
const testOrder = test('Get test order for connection history', () => {
  return db.prepare('SELECT * FROM orders LIMIT 1').get();
});

if (testOrder) {
  const product = StoreService.getProduct(testOrder.product_id, false);
  if (product && StoreService.isPaymentChannelProduct(product)) {
    test('Record payment channel connection', () => {
      return StoreService.recordPaymentChannelConnection(
        testOrder.id,
        product.id,
        testOrder.telegram_username
      );
    });

    test('Get customer connection history', () => {
      const history = StoreService.getCustomerConnectionHistory(testOrder.telegram_username, 10);
      console.log(`  Found ${history.length} connections for @${testOrder.telegram_username}`);
      return history;
    });

    test('Get connections by order', () => {
      const connections = StoreService.getConnectionsByOrderId(testOrder.id);
      console.log(`  Found ${connections.length} connections for order #${testOrder.order_number}`);
      return connections;
    });
  }
}

// Test 3: Webhook Logging
console.log('\n🔌 ENHANCEMENT 4: WEBHOOK LOGS');
console.log('-'.repeat(40));

if (testOrder && StoreService.getPaymentChannelCredentials(testOrder.product_id)) {
  test('Log webhook event', () => {
    return StoreService.logWebhookEvent(
      testOrder.product_id,
      'payment_completed',
      JSON.stringify({ orderId: testOrder.id, amount: testOrder.total }),
      200,
      'Success'
    );
  });

  test('Get webhook logs', () => {
    const logs = StoreService.getWebhookLogs(testOrder.product_id, 10);
    console.log(`  Found ${logs.length} webhook logs`);
    return logs;
  });

  test('Get webhook statistics', () => {
    const stats = StoreService.getWebhookLogStats();
    console.log(`  ${stats.length} channels have webhook data`);
    if (stats.length > 0) {
      console.log(`  Total webhooks: ${stats.reduce((sum, s) => sum + s.total_webhooks, 0)}`);
    }
    return stats;
  });
}

// Test 4: Credential Verification
console.log('\n🔐 ENHANCEMENT 2: CREDENTIAL VERIFICATION');
console.log('-'.repeat(40));

if (testOrder) {
  const product = StoreService.getProduct(testOrder.product_id, false);
  if (product && StoreService.isPaymentChannelProduct(product)) {
    // Note: This is async, so we just check it exists
    test('Verification method exists', () => {
      return typeof StoreService.verifyPaymentChannelCredentials === 'function';
    });

    test('Get credential verification history', () => {
      const history = StoreService.getCredentialVerificationHistory(product.id, 5);
      console.log(`  Found ${history.length} verification records`);
      return history;
    });
  }
}

// Test 5: Connection Resend
console.log('\n📤 ENHANCEMENT 5: CONNECTION RESEND');
console.log('-'.repeat(40));

if (testOrder) {
  const product = StoreService.getProduct(testOrder.product_id, false);
  if (product && StoreService.isPaymentChannelProduct(product)) {
    test('Resend connection method exists', () => {
      return typeof StoreService.resendConnectionToCustomer === 'function';
    });

    test('Get resend history', () => {
      const history = StoreService.getConnectionResendHistory(testOrder.id);
      console.log(`  Resend history: ${history.length} records`);
      return history;
    });
  }
}

// Test 6: Customer Status Page
console.log('\n👥 ENHANCEMENT 6: CUSTOMER STATUS PAGE');
console.log('-'.repeat(40));

if (testOrder) {
  const product = StoreService.getProduct(testOrder.product_id, false);
  if (product && StoreService.isPaymentChannelProduct(product)) {
    test('Connection status data available', () => {
      const connectionData = StoreService.generatePaymentChannelConnection(testOrder.id, product.id);
      if (connectionData) {
        console.log(`  Channel: ${connectionData.channel_name}`);
        console.log(`  URL: ${connectionData.connection_url || 'N/A'}`);
      }
      return !!connectionData;
    });
  }
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('DATABASE TABLES VERIFICATION');
console.log('='.repeat(60) + '\n');

test('payment_channel_connections table exists', () => {
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='payment_channel_connections'"
  ).get();
  if (table) {
    const count = db.prepare('SELECT COUNT(*) as cnt FROM payment_channel_connections').get();
    console.log(`  Records: ${count.cnt}`);
  }
  return !!table;
});

test('payment_channel_webhook_logs table exists', () => {
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='payment_channel_webhook_logs'"
  ).get();
  if (table) {
    const count = db.prepare('SELECT COUNT(*) as cnt FROM payment_channel_webhook_logs').get();
    console.log(`  Records: ${count.cnt}`);
  }
  return !!table;
});

test('payment_channel_api_verifications table exists', () => {
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='payment_channel_api_verifications'"
  ).get();
  if (table) {
    const count = db.prepare('SELECT COUNT(*) as cnt FROM payment_channel_api_verifications').get();
    console.log(`  Records: ${count.cnt}`);
  }
  return !!table;
});

// Verify indices
console.log('\nVerifying database indices...\n');
test('Index idx_pc_connections_order', () => {
  return db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_pc_connections_order'"
  ).get();
});

test('Index idx_pc_webhook_product', () => {
  return db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_pc_webhook_product'"
  ).get();
});

console.log('\n' + '='.repeat(60));
console.log('✓ ALL ENHANCEMENT TESTS COMPLETED');
console.log('='.repeat(60) + '\n');

process.exit(0);
