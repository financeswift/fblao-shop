#!/usr/bin/env node
/**
 * Magpie Alipay/WeChat Diagnostic Tool
 * 
 * This script tests your Magpie configuration and identifies why
 * Alipay and WeChat payments are failing with 401 errors.
 */

'use strict';

require('dotenv').config();
const path = require('path');
const fs = require('fs');

// Load database
const { openDatabase } = require('../src/sqlite');
const DATA_DIR = process.env.DATA_DIR 
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

const DB_PATH = path.join(DATA_DIR, 'shop.db');
if (!fs.existsSync(DB_PATH)) {
  console.error('❌ Database not found at:', DB_PATH);
  console.error('   Run: npm start  (to initialize the database first)');
  process.exit(1);
}

const db = openDatabase(DB_PATH);

function getSetting(key, fallback = '') {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  } catch (e) {
    return fallback;
  }
}

function settingOrEnv(settingKey, envKey, fallback = '') {
  const value = getSetting(settingKey) || process.env[envKey] || fallback;
  return String(value || '').trim();
}

async function testMagpieConnection() {
  console.log('\n🔍 MAGPIE ALIPAY/WECHAT DIAGNOSTIC\n');
  console.log('=' .repeat(60));

  // Step 1: Check if Magpie is enabled
  console.log('\n1️⃣  Configuration Status');
  console.log('-'.repeat(60));

  const enabled = getSetting('magpie_enabled') === '1';
  console.log(`   Magpie Enabled:        ${enabled ? '✅ YES' : '❌ NO'}`);
  
  if (!enabled) {
    console.log('\n   ⚠️  Magpie is DISABLED in Admin > Settings > Magpie');
    console.log('   Fix: Go to Admin panel and enable Magpie');
    return;
  }

  // Step 2: Check API Key
  const apiKey = settingOrEnv('magpie_api_key', 'MAGPIE_API_KEY');
  const hasApiKey = !!apiKey && apiKey.length > 0;
  console.log(`   API Key Configured:    ${hasApiKey ? '✅ YES' : '❌ NO'}`);
  if (hasApiKey) {
    const keyPreview = apiKey.substring(0, 10) + '...' + apiKey.substring(Math.max(0, apiKey.length - 5));
    console.log(`   API Key Preview:       ${keyPreview}`);
  } else {
    console.log('\n   ❌ API Key is MISSING!');
    console.log('   Fix: Add API key in Admin > Settings > Magpie');
  }

  // Step 3: Check API Secret
  const apiSecret = settingOrEnv('magpie_api_secret', 'MAGPIE_API_SECRET');
  const hasApiSecret = !!apiSecret && apiSecret.length > 0;
  console.log(`   API Secret Configured: ${hasApiSecret ? '✅ YES' : '❌ NO'}`);
  if (hasApiSecret) {
    const secretPreview = apiSecret.substring(0, 10) + '...' + apiSecret.substring(Math.max(0, apiSecret.length - 5));
    console.log(`   API Secret Preview:    ${secretPreview}`);
  } else {
    console.log('\n   ❌ API Secret is MISSING!');
    console.log('   Fix: Add API secret in Admin > Settings > Magpie');
  }

  // Step 4: Check Mode
  const mode = settingOrEnv('magpie_mode', 'MAGPIE_MODE', 'sandbox').toLowerCase();
  console.log(`   Mode:                  ${mode} (sandbox/live)`);

  // Step 5: Test API Authentication
  console.log('\n2️⃣  API Authentication Test');
  console.log('-'.repeat(60));

  if (!hasApiKey || !hasApiSecret) {
    console.log('\n   ❌ Cannot test authentication - credentials missing');
    console.log('   Add API key and secret first, then re-run this script');
    return;
  }

  try {
    const apiBase = 'https://api.magpie.im';
    const basicAuth = 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
    
    console.log(`\n   Testing: GET ${apiBase}/v2/sources`);
    console.log(`   Auth: Basic Auth (${apiKey.substring(0, 10)}...)`);

    const response = await fetch(`${apiBase}/v2/sources?limit=1`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': basicAuth,
      },
    });

    if (response.ok) {
      console.log(`\n   ✅ Authentication SUCCESS!`);
      console.log(`   Status: ${response.status} ${response.statusText}`);
      const data = await response.json();
      console.log(`   Response: ${JSON.stringify(data).substring(0, 100)}...`);
    } else {
      console.log(`\n   ❌ Authentication FAILED!`);
      console.log(`   Status: ${response.status} ${response.statusText}`);
      
      const errorText = await response.text();
      console.log(`   Error: ${errorText.substring(0, 200)}`);
      
      if (response.status === 401) {
        console.log('\n   🔴 401 UNAUTHORIZED - Your credentials are INVALID');
        console.log('   Possible causes:');
        console.log('   • API key is incorrect or expired');
        console.log('   • API secret is incorrect or expired');
        console.log('   • API key/secret do not match');
        console.log('   • Keys are for wrong environment (sandbox vs live mismatch)');
      } else if (response.status === 403) {
        console.log('\n   🔴 403 FORBIDDEN - Access denied');
        console.log('   • Your Magpie account may have restrictions');
        console.log('   • Contact Magpie support');
      }
    }
  } catch (e) {
    console.log(`\n   ❌ Connection Error: ${e.message}`);
    console.log('   • Check internet connection');
    console.log('   • Verify API base URL is accessible');
  }

  // Step 6: Test Alipay Source Creation
  console.log('\n3️⃣  Alipay Payment Test');
  console.log('-'.repeat(60));

  try {
    const apiBase = 'https://api.magpie.im';
    const basicAuth = 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

    const sourcePayload = {
      type: 'alipay',
      currency: 'cny',
      amount: 1000, // 10 CNY
      redirect: {
        success: 'https://example.com/success',
        fail: 'https://example.com/fail',
      },
    };

    console.log(`\n   Testing: POST ${apiBase}/v2/sources`);
    console.log(`   Payload: ${JSON.stringify(sourcePayload, null, 2)}`);

    const response = await fetch(`${apiBase}/v2/sources`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': basicAuth,
      },
      body: JSON.stringify(sourcePayload),
    });

    if (response.ok) {
      console.log(`\n   ✅ Alipay Source Creation SUCCESS!`);
      console.log(`   Status: ${response.status} ${response.statusText}`);
      const data = await response.json();
      console.log(`   Response: ${JSON.stringify(data).substring(0, 150)}...`);
    } else {
      console.log(`\n   ❌ Alipay Source Creation FAILED!`);
      console.log(`   Status: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.log(`   Error: ${errorText.substring(0, 200)}`);
    }
  } catch (e) {
    console.log(`\n   ❌ Error: ${e.message}`);
  }

  // Step 7: Test WeChat Source Creation
  console.log('\n4️⃣  WeChat Payment Test');
  console.log('-'.repeat(60));

  try {
    const apiBase = 'https://api.magpie.im';
    const basicAuth = 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

    const sourcePayload = {
      type: 'wechat',
      currency: 'cny',
      amount: 1000, // 10 CNY
      redirect: {
        success: 'https://example.com/success',
        fail: 'https://example.com/fail',
      },
    };

    console.log(`\n   Testing: POST ${apiBase}/v2/sources`);
    console.log(`   Payload: ${JSON.stringify(sourcePayload, null, 2)}`);

    const response = await fetch(`${apiBase}/v2/sources`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': basicAuth,
      },
      body: JSON.stringify(sourcePayload),
    });

    if (response.ok) {
      console.log(`\n   ✅ WeChat Source Creation SUCCESS!`);
      console.log(`   Status: ${response.status} ${response.statusText}`);
      const data = await response.json();
      console.log(`   Response: ${JSON.stringify(data).substring(0, 150)}...`);
    } else {
      console.log(`\n   ❌ WeChat Source Creation FAILED!`);
      console.log(`   Status: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.log(`   Error: ${errorText.substring(0, 200)}`);
    }
  } catch (e) {
    console.log(`\n   ❌ Error: ${e.message}`);
  }

  // Step 8: Summary
  console.log('\n5️⃣  Summary & Fix Instructions');
  console.log('-'.repeat(60));
  console.log(`
   ✅ If all tests passed:
   • Alipay and WeChat payments should work
   • Clear browser cache and test again
   
   ❌ If authentication failed (401):
   1. Log into Magpie dashboard: https://dashboard.magpie.im/
   2. Generate new API credentials
   3. Make sure they're for the correct environment (sandbox/live)
   4. Update in Admin > Settings > Magpie
   5. Re-run this diagnostic
   
   ❌ If connection failed:
   1. Check internet connection
   2. Verify VPN/firewall allows api.magpie.im
   3. Check .env for correct API base URL
   4. Contact Magpie support
  `);

  console.log('=' .repeat(60) + '\n');
}

// Run diagnostic
testMagpieConnection().catch(e => {
  console.error('Diagnostic error:', e);
  process.exit(1);
});
