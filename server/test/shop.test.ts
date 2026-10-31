import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../db.ts';
import { Shop, verifyReceipt } from '../shop.ts';
import { CATALOG, dailyDeals, isFree, priceToday } from '../../shared/cosmetics.ts';

const keys = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(), privateKey };
};
const make = (privateKey: ReturnType<typeof keys>['privateKey'], payload: object) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(null, Buffer.from(body), privateKey).toString('base64url')}`;
};
const newShop = (pub: string) => new Shop(new Store(join(mkdtempSync(join(tmpdir(), 'av-shop-')), 't.db')), { serverUrl: 'https://shop.test', publicKey: pub });

test('a valid receipt for this install unlocks the item', () => {
  const k = keys();
  const shop = newShop(k.pub);
  assert.equal(shop.owns('island:sakura'), false);
  const r = shop.redeem(make(k.privateKey, { v: 1, item: 'island:sakura', install: shop.installId(), session: 'cs_test_1', ts: 1 }));
  assert.deepEqual(r, { item: 'island:sakura' });
  assert.equal(shop.owns('island:sakura'), true);
  // redeeming twice is harmless
  shop.redeem(make(k.privateKey, { v: 1, item: 'island:sakura', install: shop.installId(), session: 'cs_test_1', ts: 1 }));
  assert.deepEqual(shop.owned(), ['island:sakura']);
});

test('forged, tampered, foreign and wrong-install receipts are refused', () => {
  const k = keys();
  const other = keys();
  const shop = newShop(k.pub);
  const good = { v: 1, item: 'character:wisp', install: shop.installId(), session: 'cs_test_2', ts: 1 };
  assert.equal(typeof shop.redeem(make(other.privateKey, good)), 'string', 'signed with another key');
  const valid = make(k.privateKey, good);
  const [, sig] = valid.split('.');
  const swapped = `${Buffer.from(JSON.stringify({ ...good, item: 'island:ember' })).toString('base64url')}.${sig}`;
  assert.equal(typeof shop.redeem(swapped), 'string', 'payload changed after signing');
  assert.equal(typeof shop.redeem(make(k.privateKey, { ...good, install: 'someone-else-123' })), 'string', 'other install');
  assert.equal(typeof shop.redeem('garbage'), 'string');
  assert.equal(typeof verifyReceipt(valid, ''), 'string', 'no key configured');
  assert.equal(shop.owns('character:wisp'), false);
});

test('daily deals are stable for a day, discounted, and only on paid items', () => {
  const a = dailyDeals('2026-10-31');
  assert.deepEqual(a, dailyDeals('2026-10-31'));
  assert.equal(a.length, 3);
  assert.equal(new Set(a.map((d) => d.id)).size, 3);
  for (const d of a) {
    const item = CATALOG.find((i) => i.id === d.id)!;
    assert.ok(item.price > 0);
    assert.ok(d.price < item.price && d.price >= 49);
    assert.equal(priceToday(d.id, '2026-10-31'), d.price);
  }
  assert.ok(isFree('character:explorer') && isFree('island:nocturne') && !isFree('island:glacier'));
});
