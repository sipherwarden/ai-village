#!/usr/bin/env node
// Installs / removes AI Village reporting hooks in Claude Code and Gemini CLI user settings.
// Every write is preceded by a timestamped backup next to the original file.
//
//   node scripts/install-hooks.mjs [--uninstall] [--status] [--claude-agent claude] [--gemini-agent gemini]

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const EMITTER = join(ROOT, 'hooks', 'emit.mjs').replace(/\\/g, '/');
const MARK = 'hooks/emit.mjs';

const TARGETS = {
  claude: {
    file: join(homedir(), '.claude', 'settings.json'),
    events: ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SubagentStop', 'PreCompact'],
    entry: (agentId) => ({ type: 'command', command: `node "${EMITTER}" ${agentId} --format claude`, timeout: 5 }),
  },
  gemini: {
    file: join(homedir(), '.gemini', 'settings.json'),
    events: ['SessionStart', 'SessionEnd', 'BeforeAgent', 'AfterAgent', 'BeforeTool', 'AfterTool', 'Notification', 'PreCompress'],
    entry: (agentId) => ({ type: 'command', name: 'ai-village', command: `node "${EMITTER}" ${agentId} --format gemini`, timeout: 5000 }),
  },
};

function read(file) {
  if (!existsSync(file)) return {};
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  return text.trim() ? JSON.parse(text) : {};
}

function backup(file) {
  if (!existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${file}.bak-ai-village-${stamp}`;
  copyFileSync(file, dest);
  return dest;
}

/** Removes our entries from a settings object, keeping everything else intact. */
function strip(settings) {
  if (!settings.hooks || typeof settings.hooks !== 'object') return settings;
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = groups
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !String(h.command ?? '').includes(MARK)) }))
      .filter((g) => g.hooks.length > 0);
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  return settings;
}

export function status() {
  const out = {};
  for (const [name, t] of Object.entries(TARGETS)) {
    try {
      const s = read(t.file);
      const installed = t.events.filter((e) => (s.hooks?.[e] ?? []).some((g) => (g.hooks ?? []).some((h) => String(h.command ?? '').includes(MARK))));
      out[name] = { file: t.file, exists: existsSync(t.file), installed, complete: installed.length === t.events.length };
    } catch (e) {
      out[name] = { file: t.file, exists: true, installed: [], complete: false, error: `Could not parse settings: ${e.message}` };
    }
  }
  return out;
}

export function install({ claudeAgent = 'claude', geminiAgent = 'gemini', only } = {}) {
  const results = {};
  for (const [name, t] of Object.entries(TARGETS)) {
    if (only && !only.includes(name)) continue;
    const agentId = name === 'claude' ? claudeAgent : geminiAgent;
    const settings = strip(read(t.file));
    settings.hooks ??= {};
    for (const event of t.events) {
      settings.hooks[event] ??= [];
      settings.hooks[event].push({ hooks: [t.entry(agentId)] });
    }
    const bak = backup(t.file);
    mkdirSync(dirname(t.file), { recursive: true });
    writeFileSync(t.file, JSON.stringify(settings, null, 2) + '\n');
    results[name] = { file: t.file, backup: bak, events: t.events.length };
  }
  return results;
}

export function uninstall({ only } = {}) {
  const results = {};
  for (const [name, t] of Object.entries(TARGETS)) {
    if (only && !only.includes(name)) continue;
    if (!existsSync(t.file)) continue;
    const bak = backup(t.file);
    writeFileSync(t.file, JSON.stringify(strip(read(t.file)), null, 2) + '\n');
    results[name] = { file: t.file, backup: bak };
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  if (argv.includes('--status')) console.log(JSON.stringify(status(), null, 2));
  else if (argv.includes('--uninstall')) console.log(JSON.stringify(uninstall(), null, 2));
  else console.log(JSON.stringify(install({ claudeAgent: opt('--claude-agent', 'claude'), geminiAgent: opt('--gemini-agent', 'gemini') }), null, 2));
}
