#!/usr/bin/env node
/**
 * Quick Magpie Setup Script
 * 
 * Sets up Magpie API credentials in the database
 * Usage: node scripts/setup-magpie.js <publicKey> <secretKey>
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
  console.error('❌ Database not found. Run: npm start');
  process.exit(1);
}

const db = openDatabase(DB_PATH);

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node scripts/setup-magpie.js <publicKey> <secretKey>');
  process.exit(1);
}

const [publicKey, secretKey] = args;

try {
  // Enable Magpie and set credentials
  db.prepare(`
    INSERT OR REPLACE INTO settings (key, value) VALUES
    (?, ?),
    (?, ?),
    (?, ?),
    (?, ?)
  `).run(
    'magpie_enabled', '1',
    'magpie_api_key', publicKey,
    'magpie_api_secret', secretKey,
    'magpie_mode', 'live'
  );

  console.log('✅ Magpie credentials configured successfully!');
  console.log('\nNext steps:');
  console.log('1. Run: npm run test-magpie');
  console.log('2. Verify all tests pass ✅');
  console.log('3. Test a payment in the UI');
  
  process.exit(0);
} catch (err) {
  console.error('❌ Error setting up Magpie:', err.message);
  process.exit(1);
}
