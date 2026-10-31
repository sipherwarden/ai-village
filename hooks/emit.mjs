#!/usr/bin/env node
// AI Village event reporter.
//
// Agent hooks (Claude Code, Gemini CLI, Codex notify) call this script. It reads the hook payload,
// strips conversation content, and forwards a small summary to the local Village Hub.
//
//   node emit.mjs <agentId> --format claude|gemini|codex [json-arg]
//
// Rules: never block the agent, never print to stdout except what the agent expects, always exit 0.

import { openSync, readSync, fstatSync, closeSync } from 'node:fs';

const HUB = (process.env.AI_VILLAGE_URL || 'http://127.0.0.1:7777').replace(/\/$/, '');
const args = process.argv.slice(2);
const agentId = args[0];
const fmtIdx = args.indexOf('--format');
const format = fmtIdx >= 0 ? args[fmtIdx + 1] : 'claude';
const trailing = args.filter((_, i) => i !== 0 && i !== fmtIdx && i !== fmtIdx + 1);

const finish = () => {
  if (format === 'gemini') process.stdout.write('{}');
  process.exit(0);
};
setTimeout(finish, 2500).unref();

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    let buf = '';
    const t = setTimeout(() => resolve(buf), 800);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => {
      clearTimeout(t);
      resolve(buf);
    });
    process.stdin.on('error', () => resolve(buf));
  });
}

const KEEP_INPUT = ['file_path', 'path', 'notebook_path', 'absolute_path', 'dir_path', 'url', 'pattern', 'description', 'subagent_type', 'query'];

function summarizeInput(input) {
  if (!input || typeof input !== 'object') return undefined;
  const out = {};
  for (const k of KEEP_INPUT) if (typeof input[k] === 'string') out[k] = input[k].slice(0, 200);
  // Only the program name of a shell command, never its arguments (they can contain secrets).
  if (typeof input.command === 'string') out.command_head = input.command.trim().split(/\s+/)[0]?.slice(0, 40);
  if (Array.isArray(input.paths)) out.path_count = input.paths.length;
  return out;
}

/** Sum token usage for the latest turn from a Claude Code transcript (JSONL). Best effort. */
function claudeTurnTokens(transcriptPath) {
  try {
    const fd = openSync(transcriptPath, 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(size, 4 * 1024 * 1024);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    closeSync(fd);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    const byMsg = new Map();
    for (let i = lines.length - 1; i >= 0; i--) {
      let row;
      try {
        row = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      if (row.type === 'user' && typeof row.message?.content === 'string') break;
      const u = row.type === 'assistant' ? row.message?.usage : null;
      if (u && !byMsg.has(row.message.id)) byMsg.set(row.message.id, u);
    }
    if (!byMsg.size) return null;
    let tin = 0;
    let tcached = 0;
    let tout = 0;
    for (const u of byMsg.values()) {
      // Fresh input (incl. writing new context to the cache) vs. re-reading context that was already cached.
      tin += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      tcached += u.cache_read_input_tokens || 0;
      tout += u.output_tokens || 0;
    }
    return { in: tin, cached: tcached, out: tout };
  } catch {
    return null;
  }
}

function sanitize(raw) {
  const p = {
    hook_event_name: raw.hook_event_name,
    session_id: raw.session_id,
    cwd: raw.cwd,
    timestamp: raw.timestamp,
    source: raw.source,
    reason: raw.reason,
    trigger: raw.trigger,
    tool_name: raw.tool_name,
    tool_input: summarizeInput(raw.tool_input),
    notification_type: raw.notification_type,
    message: typeof raw.message === 'string' ? raw.message.slice(0, 160) : undefined,
    agent_type: raw.agent_type,
    model: typeof raw.model === 'string' ? raw.model : raw.model?.id,
    // Prompt previews are dropped by the hub unless you enable them in Settings.
    prompt_preview: typeof raw.prompt === 'string' ? raw.prompt.replace(/\s+/g, ' ').trim().slice(0, 80) : undefined,
    tool_error:
      raw.hook_event_name === 'PostToolUseFailure' ||
      !!raw.tool_response?.error ||
      raw.tool_response?.is_error === true ||
      raw.tool_response?.interrupted === true ||
      undefined,
    error: typeof raw.error === 'string' ? raw.error.slice(0, 200) : raw.error?.message?.slice?.(0, 200),
  };
  if (format === 'claude' && raw.hook_event_name === 'Stop' && raw.transcript_path) p.tokens = claudeTurnTokens(raw.transcript_path);
  return p;
}

async function main() {
  if (!agentId) return finish();
  let payload;
  if (format === 'codex') {
    // Codex passes the notification JSON as the last argument.
    try {
      const raw = JSON.parse(trailing[trailing.length - 1] || '{}');
      payload = { type: raw.type, thread_id: raw['thread-id'], turn_id: raw['turn-id'], cwd: raw.cwd };
    } catch {
      return finish();
    }
  } else {
    const text = await readStdin();
    if (!text.trim()) return finish();
    try {
      payload = sanitize(JSON.parse(text));
    } catch {
      return finish();
    }
  }
  try {
    await fetch(`${HUB}/api/ingest/${encodeURIComponent(agentId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format, payload }),
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // Hub not running: stay silent so the agent is never affected.
  }
  finish();
}

main().catch(finish);
