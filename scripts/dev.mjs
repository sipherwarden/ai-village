// Runs the hub (with --watch) and the Vite dev server together.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const procs = ['dev:hub', 'dev:web'].map((s) => spawn(npm, ['run', s], { stdio: 'inherit', shell: process.platform === 'win32' }));
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', stop));
