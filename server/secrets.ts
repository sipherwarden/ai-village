// Credentials are stored one file per secret and never reach the browser.
//   Windows:      encrypted with DPAPI (CurrentUser scope) in %APPDATA%\AIVillage\secrets (*.dpapi).
//                 Only this Windows account can decrypt them.
//   macOS, Linux: encrypted with AES-256-GCM (*.enc) using a random per-install key stored next to
//                 them with owner-only permissions (0600). Readable only by this OS account.
// AI_VILLAGE_SECRET_BACKEND=file forces the portable backend (used by tests on Windows).

import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const ENTROPY = 'ai-village-v1';
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;

interface Backend {
  ext: string;
  protect(value: string): Promise<string>;
  unprotect(blob: string): Promise<string>;
}

function runPowerShell(script: string, stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    let out = '';
    let err = '';
    ps.stdout.on('data', (d) => (out += d));
    ps.stderr.on('data', (d) => (err += d));
    ps.on('error', reject);
    ps.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `powershell exited ${code}`))));
    ps.stdin.end(stdin);
  });
}

const PROTECT = `Add-Type -AssemblyName System.Security;
$v = [Console]::In.ReadToEnd();
$b = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($v), [Text.Encoding]::UTF8.GetBytes('${ENTROPY}'), 'CurrentUser');
[Console]::Out.Write([Convert]::ToBase64String($b))`;

const UNPROTECT = `Add-Type -AssemblyName System.Security;
$v = [Console]::In.ReadToEnd().Trim();
$b = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v), [Text.Encoding]::UTF8.GetBytes('${ENTROPY}'), 'CurrentUser');
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))`;

const dpapi: Backend = {
  ext: '.dpapi',
  protect: (v) => runPowerShell(PROTECT, v),
  unprotect: (b) => runPowerShell(UNPROTECT, b),
};

/** AES-256-GCM with a random key file (0600). Blob: base64(iv | tag | ciphertext). */
function fileBackend(dir: string): Backend {
  const keyPath = join(dir, 'master.key');
  let key: Buffer | null = null;
  const getKey = () => {
    if (key) return key;
    if (existsSync(keyPath)) key = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64');
    else {
      key = randomBytes(32);
      writeFileSync(keyPath, key.toString('base64'), { encoding: 'utf8', mode: 0o600 });
    }
    if (key.length !== 32) throw new Error(`Secret key file ${keyPath} is damaged.`);
    return key;
  };
  return {
    ext: '.enc',
    async protect(value) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', getKey(), iv);
      c.setAAD(Buffer.from(ENTROPY));
      const body = Buffer.concat([c.update(value, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
    },
    async unprotect(blob) {
      const raw = Buffer.from(blob.trim(), 'base64');
      const d = createDecipheriv('aes-256-gcm', getKey(), raw.subarray(0, 12));
      d.setAAD(Buffer.from(ENTROPY));
      d.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
    },
  };
}

/** Per-OS default location for the secrets folder. */
export function defaultSecretsDir() {
  const os = platform();
  if (os === 'win32') return join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? homedir(), 'AppData', 'Roaming'), 'AIVillage', 'secrets');
  if (os === 'darwin') return join(homedir(), 'Library', 'Application Support', 'AIVillage', 'secrets');
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'ai-village', 'secrets');
}

export class Secrets {
  dir: string;
  /** Short description of how values are protected, for the settings screen and docs. */
  readonly protection: string;
  private backend: Backend;
  private cache = new Map<string, string>();

  constructor(dir = defaultSecretsDir()) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
    } catch {
      /* not supported on every filesystem */
    }
    const useDpapi = platform() === 'win32' && process.env.AI_VILLAGE_SECRET_BACKEND !== 'file';
    this.backend = useDpapi ? dpapi : fileBackend(dir);
    this.protection = useDpapi ? 'Windows DPAPI (this Windows account only)' : 'AES-256-GCM with an owner-only key file';
  }

  static validName(name: string) {
    return NAME_RE.test(name);
  }

  private path(name: string) {
    return join(this.dir, `${name}${this.backend.ext}`);
  }

  list(): { name: string }[] {
    if (!existsSync(this.dir)) return [];
    const ext = this.backend.ext;
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(ext))
      .map((f) => ({ name: f.slice(0, -ext.length) }));
  }

  has(name: string) {
    return Secrets.validName(name) && existsSync(this.path(name));
  }

  async get(name: string): Promise<string | null> {
    if (!this.has(name)) return null;
    const hit = this.cache.get(name);
    if (hit) return hit;
    const value = await this.backend.unprotect(readFileSync(this.path(name), 'utf8'));
    this.cache.set(name, value);
    return value;
  }

  async set(name: string, value: string) {
    if (!Secrets.validName(name)) throw new Error('Secret names use lowercase letters, numbers, - and _.');
    if (!value) throw new Error('Secret value is empty.');
    writeFileSync(this.path(name), await this.backend.protect(value), { encoding: 'utf8', mode: 0o600 });
    this.cache.delete(name);
  }

  remove(name: string) {
    if (!this.has(name)) return;
    unlinkSync(this.path(name));
    this.cache.delete(name);
  }
}
