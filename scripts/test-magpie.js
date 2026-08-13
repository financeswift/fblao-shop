#!/usr/bin/env node
/**
 * Magpie Payment Gateway Test Script
 * 
 * Usage: node scripts/test-magpie.js
 * 
 * This script tests Magpie API connectivity and configuration
 * without needing to go through the web interface.
 */

'use strict';

const path = require('path');
const fs = require('fs');

// Setup paths
const appDir = path.join(__dirname, '..');
const srcDir = path.join(appDir, 'src');

// Change to app directory so require paths work correctly
process.chdir(appDir);

// Now require the modules
const { getSetting } = require('./src/db');
const magpie = require('./src/magpie');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(text, color = 'reset') {
  console.log(`${colors[color]}${text}${colors.reset}`);
}

function printHeader(text) {
  console.log('');
  log(`═══════════════════════════════════════════════════════════`, 'cyan');
  log(text, 'cyan');
  log(`═══════════════════════════════════════════════════════════`, 'cyan');
}

function printSection(text) {
  console.log('');
  log(`▶ ${text}`, 'blue');
}

async function testMagpie() {
  printHeader('Magpie Payment Gateway Configuration Test');

  try {
    // Test 1: Check if Magpie is enabled
    printSection('1. Checking if Magpie is enabled...');
    if (!magpie.isConfigured()) {
      log('✗ Magpie is NOT configured/enabled', 'red');
      log('  Please check Admin > Settings > Magpie and enable it.', 'yellow');
      process.exit(1);
    }
    log('✓ Magpie is configured and enabled', 'green');

    // Test 2: Run connection test
    printSection('2. Testing API connectivity...');
    const testResult = await magpie.testConnection();

    if (testResult.error) {
      log(`✗ Configuration Error: ${testResult.error}`, 'red');
      process.exit(1);
    }

    log('✓ Configuration loaded', 'green');
    log(`  API Base: ${testResult.apiBase}`, 'cyan');
    log(`  Public Key Valid: ${testResult.keyFormatValid.public ? '✓' : '✗'}`, testResult.keyFormatValid.public ? 'green' : 'red');
    log(`  Secret Key Valid: ${testResult.keyFormatValid.secret ? '✓' : '✗'}`, testResult.keyFormatValid.secret ? 'green' : 'red');

    // Test 3: Check API connectivity
    if (testResult.tests && testResult.tests.sourceEndpoint) {
      const sourceTest = testResult.tests.sourceEndpoint;
      if (sourceTest.error) {
        log(`✗ API Connectivity Error: ${sourceTest.error}`, 'red');
      } else if (sourceTest.ok) {
        log(`✓ API Endpoint Accessible (Status: ${sourceTest.status})`, 'green');
      } else {
        log(`⚠ API returned status ${sourceTest.status}`, 'yellow');
        if (sourceTest.status === 401 || sourceTest.status === 403) {
          log('  This usually means authentication failed.', 'yellow');
          log('  Check that your API Key and Secret are correct.', 'yellow');
        }
      }
    }

    // Test 4: Display configuration summary
    printSection('3. Configuration Summary');
    const settings = {
      enabled: getSetting('magpie_enabled', '0'),
      mode: getSetting('magpie_mode', 'sandbox'),
      apiBase: getSetting('magpie_api_base_url', ''),
      apiKey: getSetting('magpie_api_key', ''),
      apiSecret: getSetting('magpie_api_secret', ''),
      webhookSecret: getSetting('magpie_webhook_secret', ''),
      targetCurrency: getSetting('magpie_target_currency', 'CNY'),
    };

    log(`Enabled: ${settings.enabled === '1' ? 'YES ✓' : 'NO ✗'}`, settings.enabled === '1' ? 'green' : 'red');
    log(`Mode: ${settings.mode} (${settings.mode === 'sandbox' ? 'TESTING' : 'PRODUCTION'})`, 'cyan');
    log(`API Base URL: ${settings.apiBase || '(default)'}`, 'cyan');
    log(`API Key: ${settings.apiKey ? settings.apiKey.substring(0, 10) + '***' : '(not set)'}`, settings.apiKey ? 'green' : 'red');
    log(`API Secret: ${settings.apiSecret ? settings.apiSecret.substring(0, 10) + '***' : '(not set)'}`, settings.apiSecret ? 'green' : 'red');
    log(`Webhook Secret: ${settings.webhookSecret ? '***' : '(not set)'}`, 'cyan');
    log(`Target Currency: ${settings.targetCurrency}`, 'cyan');

    // Final summary
    printSection('4. Next Steps');
    
    const issues = [];
    if (!settings.apiKey) issues.push('API Key is not set');
    if (!settings.apiSecret) issues.push('API Secret is not set');
    if (settings.enabled !== '1') issues.push('Magpie is not enabled');

    if (issues.length === 0) {
      log('✓ Configuration looks good!', 'green');
      log('', 'reset');
      log('You can now test payments by:', 'cyan');
      log('  1. Go to the shop homepage', 'cyan');
      log('  2. Select a product', 'cyan');
      log('  3. Choose Alipay or WeChat Pay', 'cyan');
      log('  4. Complete the payment flow', 'cyan');
      log('', 'reset');
      log('Expected behavior:', 'cyan');
      log('  - You will be redirected to Magpie checkout', 'cyan');
      log('  - A QR code or payment form will appear', 'cyan');
      log('  - After payment, you return to the results page', 'cyan');
    } else {
      log('✗ Configuration issues found:', 'red');
      issues.forEach(issue => log(`  - ${issue}`, 'red'));
      log('', 'reset');
      log('To fix:', 'yellow');
      log('  1. Go to Admin Panel', 'yellow');
      log('  2. Click Settings → Magpie (Alipay / WeChat Pay)', 'yellow');
      log('  3. Enter your API credentials from Magpie dashboard', 'yellow');
      log('  4. Select Sandbox/Live mode appropriately', 'yellow');
      log('  5. Check "Enabled" box', 'yellow');
      log('  6. Click "Save Magpie configuration"', 'yellow');
    }

    console.log('');
    log(`Test completed at ${new Date().toISOString()}`, 'cyan');

  } catch (error) {
    console.error('');
    log(`✗ Test failed with error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

// Run the test
testMagpie().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
