import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../db.ts';
import { Auth } from '../auth.ts';

const newAuth = () => new Auth(new Store(join(mkdtempSync(join(tmpdir(), 'av-auth-')), 't.db')));

test('sign-in is never limited while passwords are right', () => {
  const auth = newAuth();
  for (let i = 0; i < 50; i++) {
    assert.equal(auth.allowAttempt('10.0.0.2'), true);
    auth.recordSuccess('10.0.0.2');
  }
});

test('ten wrong passwords lock that address for five minutes', () => {
  const auth = newAuth();
  const t0 = 1_000_000;
  for (let i = 0; i < 9; i++) {
    assert.equal(auth.allowAttempt('10.0.0.3', t0), true, `attempt ${i + 1}`);
    auth.recordFailure('10.0.0.3', t0);
  }
  assert.equal(auth.allowAttempt('10.0.0.3', t0), true, 'tenth try is still allowed');
  auth.recordFailure('10.0.0.3', t0);
  assert.equal(auth.allowAttempt('10.0.0.3', t0), false, 'locked after ten wrong passwords');
  assert.equal(auth.allowAttempt('10.0.0.4', t0), true, 'other devices are not affected');
  assert.equal(auth.allowAttempt('10.0.0.3', t0 + 5 * 60_000), true, 'unlocked after five minutes');
});

test('a correct password clears earlier mistakes', () => {
  const auth = newAuth();
  for (let i = 0; i < 9; i++) auth.recordFailure('10.0.0.5');
  auth.recordSuccess('10.0.0.5');
  for (let i = 0; i < 9; i++) auth.recordFailure('10.0.0.5');
  assert.equal(auth.allowAttempt('10.0.0.5'), true);
});
