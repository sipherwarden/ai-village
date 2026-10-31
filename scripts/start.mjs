#!/usr/bin/env node
// Cross-platform launcher: opens the hub if it is already running, builds the web app on first run,
// then starts the hub. Used by start-village.cmd, start-village.sh and `npm start`.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.AI_VILLAGE_PORT ?? 7777);
const url = `http://localhost:${port}`;

const [major] = process.versions.node.split('.').map(Number);
if (major < 24) {
  console.error(`AI Village needs Node.js 24 or newer (you have ${process.versions.node}). Get it from https://nodejs.org`);
  process.exit(1);
}

function openBrowser(target) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]] : process.platform === 'darwin' ? ['open', [target]] : ['xdg-open', [target]];
  try {
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* no browser available (headless server); the address is printed instead */
  }
}

const running = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) })
  .then((r) => r.ok)
  .catch(() => false);
if (running) {
  console.log(`AI Village is already running: ${url}`);
  if (!process.argv.includes('--no-open')) openBrowser(url);
  process.exit(0);
}

if (!existsSync(join(root, 'node_modules'))) {
  console.log('Installing dependencies (first run)…');
  if (spawnSync('npm install', { cwd: root, stdio: 'inherit', shell: true }).status !== 0) process.exit(1);
}
if (!existsSync(join(root, 'web', 'dist', 'index.html'))) {
  console.log('Building the web app (first run)…');
  if (spawnSync('npm run build', { cwd: root, stdio: 'inherit', shell: true }).status !== 0) process.exit(1);
}

const hub = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(root, 'server', 'index.ts')], { cwd: root, stdio: 'inherit' });
const stop = () => hub.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
hub.on('exit', (code) => process.exit(code ?? 0));
