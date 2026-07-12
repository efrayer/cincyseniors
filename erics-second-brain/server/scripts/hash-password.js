#!/usr/bin/env node
// Usage: npm run hash-password -- 'your-password'
// Prints an AUTH_PASSWORD_HASH value for your .env file.
import crypto from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error("Usage: npm run hash-password -- 'your-password'");
  process.exit(1);
}
const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, 64);
console.log(`AUTH_PASSWORD_HASH=scrypt$${salt.toString('hex')}$${hash.toString('hex')}`);
