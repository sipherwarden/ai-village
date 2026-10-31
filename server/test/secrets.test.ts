import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AI_VILLAGE_SECRET_BACKEND = 'file';
const { Secrets } = await import('../secrets.ts');

test('portable backend round-trips values and never stores them in plain text', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'av-secrets-'));
  const s = new Secrets(dir);
  await s.set('gemini-key', 'top-secret-value');
  assert.equal(await s.get('gemini-key'), 'top-secret-value');
  assert.deepEqual(s.list(), [{ name: 'gemini-key' }]);
  const blob = readFileSync(join(dir, 'gemini-key.enc'), 'utf8');
  assert.ok(!blob.includes('top-secret-value'));
  // a fresh instance (new process) reads it back with the stored key
  assert.equal(await new Secrets(dir).get('gemini-key'), 'top-secret-value');
  if (platform() !== 'win32') assert.equal(statSync(join(dir, 'master.key')).mode & 0o077, 0);
  s.remove('gemini-key');
  assert.equal(s.has('gemini-key'), false);
  assert.ok(!readdirSync(dir).some((f) => f.endsWith('.enc')));
});

test('tampered ciphertext is rejected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'av-secrets-'));
  const s = new Secrets(dir);
  await s.set('k', 'value');
  const { writeFileSync } = await import('node:fs');
  const raw = Buffer.from(readFileSync(join(dir, 'k.enc'), 'utf8'), 'base64');
  raw[raw.length - 1] ^= 1;
  writeFileSync(join(dir, 'k.enc'), raw.toString('base64'));
  await assert.rejects(new Secrets(dir).get('k'));
});

test('secret names are validated', async () => {
  const s = new Secrets(mkdtempSync(join(tmpdir(), 'av-secrets-')));
  await assert.rejects(s.set('../escape', 'x'));
  assert.equal(s.has('../escape'), false);
});
