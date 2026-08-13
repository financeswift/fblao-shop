'use strict';

const crypto = require('crypto');

// Encryption utilities for sensitive data (e.g., account passwords)
// Uses AES-256-CBC with IV (initialization vector) for better security

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-insecure-key-change-in-production';
const ALGORITHM = 'aes-256-cbc';

// Derive a 32-byte key from the env var (pad if too short, truncate if too long)
function getEncryptionKey() {
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  return key;
}

/**
 * Encrypt sensitive plaintext
 * Returns: "iv:encryptedData" (both base64 encoded)
 */
function encrypt(plaintext) {
  if (!plaintext) return null;
  
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  
  let encrypted = cipher.update(String(plaintext), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // Store IV with ciphertext so we can decrypt later
  return iv.toString('base64') + ':' + encrypted;
}

/**
 * Decrypt ciphertext
 * Input: "iv:encryptedData" (base64 encoded)
 */
function decrypt(ciphertext) {
  if (!ciphertext) return null;
  
  try {
    const parts = ciphertext.split(':');
    if (parts.length !== 2) return null;
    
    const iv = Buffer.from(parts[0], 'base64');
    const encrypted = parts[1];
    
    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (e) {
    console.error('Decryption error:', e.message);
    return null;
  }
}

module.exports = {
  encrypt,
  decrypt
};
