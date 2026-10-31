import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Store } from './db.ts';

export const COOKIE = 'av_session';
const SESSION_DAYS = 30;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function isLoopback(ip: string) {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/** Private / local ranges only. Keeps the hub off the public internet even if a port gets forwarded. */
export function isPrivate(ip: string) {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split('.').map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
  }
  const l = ip.toLowerCase();
  return l === '::1' || l.startsWith('fe80:') || l.startsWith('fc') || l.startsWith('fd');
}

interface PasswordRecord {
  salt: string;
  hash: string;
}

export class Auth {
  private store: Store;
  private attempts = new Map<string, number[]>();

  constructor(store: Store) {
    this.store = store;
  }

  get configured() {
    return !!this.store.getKv<PasswordRecord | null>('auth.password', null);
  }

  setPassword(pw: string) {
    if (pw.length < 8) throw new Error('Use at least 8 characters.');
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(pw, salt, 64).toString('hex');
    this.store.setKv('auth.password', { salt, hash });
    this.store.deleteAllAuthSessions();
  }

  verify(pw: string) {
    const rec = this.store.getKv<PasswordRecord | null>('auth.password', null);
    if (!rec) return false;
    const got = scryptSync(pw, rec.salt, 64);
    return timingSafeEqual(got, Buffer.from(rec.hash, 'hex'));
  }

  /** Simple per-IP rate limit: 6 attempts per 5 minutes. */
  allowAttempt(ip: string) {
    const now = Date.now();
    const list = (this.attempts.get(ip) ?? []).filter((t) => now - t < 5 * 60_000);
    if (list.length >= 6) return false;
    list.push(now);
    this.attempts.set(ip, list);
    return true;
  }

  createSession(ua: string | null) {
    const token = newToken();
    this.store.addAuthSession(sha256(token), Date.now() + SESSION_DAYS * 86_400_000, ua);
    return { token, maxAge: SESSION_DAYS * 86_400 };
  }

  check(req: FastifyRequest) {
    const token = req.cookies?.[COOKIE];
    return !!token && this.store.validAuthSession(sha256(token));
  }

  destroy(req: FastifyRequest) {
    const token = req.cookies?.[COOKIE];
    if (token) this.store.deleteAuthSession(sha256(token));
  }
}
