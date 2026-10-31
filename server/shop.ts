// Shop ownership on the hub. Purchases happen between the browser, the project's shop server and
// Stripe; the hub only verifies the signed receipt the shop server issues (Ed25519, checked against
// the public key in shop.config.json) and remembers what this install owns. The hub never talks to
// Stripe or the shop server and never sees payment details.

import { createPublicKey, randomBytes, verify } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ITEM, isFree } from '../shared/cosmetics.ts';
import type { Store } from './db.ts';

export interface ShopConfig {
  /** Base URL of the shop server, e.g. https://shop.example.com. Empty: the shop is browse-only. */
  serverUrl: string;
  /** PEM (or base64 of a PEM) Ed25519 public key that signs receipts. */
  publicKey: string;
}

export interface ReceiptPayload {
  v: 1;
  item: string;
  install: string;
  session: string;
  ts: number;
}

export function loadShopConfig(root: string): ShopConfig {
  let file: Partial<ShopConfig> = {};
  const path = join(root, 'shop.config.json');
  if (existsSync(path)) {
    try {
      file = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      /* malformed file: treat as unconfigured */
    }
  }
  return {
    serverUrl: (process.env.AI_VILLAGE_SHOP_URL ?? file.serverUrl ?? '').replace(/\/+$/, ''),
    publicKey: process.env.AI_VILLAGE_SHOP_PUBLIC_KEY ?? file.publicKey ?? '',
  };
}

const pem = (key: string) => (key.includes('BEGIN') ? key : Buffer.from(key, 'base64').toString('utf8'));

/** Checks a `payload.signature` receipt; returns the payload or a reason it was refused. */
export function verifyReceipt(receipt: string, publicKey: string): ReceiptPayload | string {
  if (!publicKey) return 'This build has no shop key configured.';
  const [body, sig] = String(receipt).split('.');
  if (!body || !sig) return 'Malformed receipt.';
  let ok = false;
  try {
    ok = verify(null, Buffer.from(body), createPublicKey(pem(publicKey)), Buffer.from(sig, 'base64url'));
  } catch {
    return 'Could not check the receipt signature.';
  }
  if (!ok) return 'Receipt signature is not valid.';
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ReceiptPayload;
    if (p.v !== 1 || !ITEM[p.item]) return 'Receipt is for an unknown item.';
    return p;
  } catch {
    return 'Malformed receipt.';
  }
}

export class Shop {
  private store: Store;
  readonly config: ShopConfig;

  constructor(store: Store, config: ShopConfig) {
    this.store = store;
    this.config = config;
  }

  /** Random id that ties purchases to this install. */
  installId(): string {
    let id = this.store.getKv<string>('shop.install', '');
    if (!id) {
      id = randomBytes(12).toString('base64url');
      this.store.setKv('shop.install', id);
    }
    return id;
  }

  owned(): string[] {
    return this.store.getKv<string[]>('shop.owned', []);
  }

  owns(id: string) {
    return isFree(id) || this.owned().includes(id);
  }

  redeem(receipt: string): { item: string } | string {
    const p = verifyReceipt(receipt, this.config.publicKey);
    if (typeof p === 'string') return p;
    if (p.install !== this.installId()) return 'This receipt belongs to a different AI Village install.';
    const owned = this.owned();
    if (!owned.includes(p.item)) this.store.setKv('shop.owned', [...owned, p.item]);
    const receipts = this.store.getKv<string[]>('shop.receipts', []);
    if (!receipts.includes(receipt)) this.store.setKv('shop.receipts', [...receipts, receipt]);
    return { item: p.item };
  }
}
