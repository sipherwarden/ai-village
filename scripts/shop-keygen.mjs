#!/usr/bin/env node
// Creates the Ed25519 key pair for shop receipts.
//   Public key  -> shop.config.json "publicKey" (ships with the app; safe to publish)
//   Private key -> SHOP_SIGNING_KEY on the shop server only (never commit it)

import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64');
const priv = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');

console.log('Public key (put in shop.config.json as "publicKey"):\n');
console.log(pub);
console.log('\nPrivate key (set as SHOP_SIGNING_KEY on the shop server; keep it secret):\n');
console.log(priv);
