import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentConfig, EventType, TaskSummary, VillageEvent } from '../shared/types.ts';

export class Store {
  db: DatabaseSync;

  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        ingest_token_hash TEXT,
        sort INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT,
        source TEXT NOT NULL,
        demo INTEGER NOT NULL DEFAULT 0,
        data TEXT
      );
      CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
      CREATE INDEX IF NOT EXISTS events_agent_ts ON events(agent_id, ts);
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        session_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        tokens_in INTEGER,
        tokens_out INTEGER,
        tokens_cached INTEGER,
        demo INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS tasks_agent ON tasks(agent_id, started_at);
      CREATE TABLE IF NOT EXISTS sessions_log (
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        demo INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (agent_id, session_id)
      );
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        user_agent TEXT
      );
    `);
    this.migrate();
  }

  /** Adds tokens_cached to databases created before it existed. Old token totals mixed cache reads into "in", so they are cleared rather than shown wrong. */
  private migrate() {
    const cols = this.db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
    if (!cols.some((c) => c.name === 'tokens_cached')) {
      this.db.exec('ALTER TABLE tasks ADD COLUMN tokens_cached INTEGER; UPDATE tasks SET tokens_in = NULL, tokens_out = NULL;');
    }
  }

  // ---- key/value ----
  getKv<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }
  setKv(key: string, value: unknown) {
    this.db
      .prepare('INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  // ---- agents ----
  listAgents(): AgentConfig[] {
    const rows = this.db.prepare('SELECT json, ingest_token_hash FROM agents ORDER BY sort, rowid').all() as {
      json: string;
      ingest_token_hash: string | null;
    }[];
    return rows.map((r) => ({ ...(JSON.parse(r.json) as AgentConfig), hasIngestToken: !!r.ingest_token_hash }));
  }
  saveAgent(a: AgentConfig) {
    const { hasIngestToken: _ignored, ...rest } = a;
    this.db
      .prepare(
        `INSERT INTO agents(id, json, sort) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET json = excluded.json, sort = excluded.sort`,
      )
      .run(a.id, JSON.stringify(rest), a.sort);
  }
  deleteAgent(id: string) {
    this.db.prepare('DELETE FROM agents WHERE id = ?').run(id);
  }
  setIngestTokenHash(id: string, hash: string | null) {
    this.db.prepare('UPDATE agents SET ingest_token_hash = ? WHERE id = ?').run(hash, id);
  }
  findAgentByTokenHash(hash: string): string | null {
    const row = this.db.prepare('SELECT id FROM agents WHERE ingest_token_hash = ?').get(hash) as { id: string } | undefined;
    return row?.id ?? null;
  }

  // ---- events ----
  insertEvent(e: Omit<VillageEvent, 'id'>): VillageEvent {
    const res = this.db
      .prepare(
        'INSERT INTO events(ts, agent_id, session_id, type, title, detail, source, demo, data) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .run(e.ts, e.agentId, e.sessionId, e.type, e.title, e.detail, e.source, e.demo ? 1 : 0, e.data ? JSON.stringify(e.data) : null);
    return { ...e, id: Number(res.lastInsertRowid) };
  }

  queryEvents(q: {
    demo: boolean;
    agentId?: string;
    types?: EventType[];
    since?: number;
    before?: number;
    limit?: number;
  }): VillageEvent[] {
    const where = ['demo = ?'];
    const args: (string | number)[] = [q.demo ? 1 : 0];
    if (q.agentId) {
      where.push('agent_id = ?');
      args.push(q.agentId);
    }
    if (q.types?.length) {
      where.push(`type IN (${q.types.map(() => '?').join(',')})`);
      args.push(...q.types);
    }
    if (q.since) {
      where.push('ts >= ?');
      args.push(q.since);
    }
    if (q.before) {
      where.push('id < ?');
      args.push(q.before);
    }
    const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${limit}`)
      .all(...args) as Record<string, unknown>[];
    return rows.map(rowToEvent);
  }

  countEvents(demo: boolean, types: EventType[], since: number): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM events WHERE demo = ? AND ts >= ? AND type IN (${types.map(() => '?').join(',')})`)
      .get(demo ? 1 : 0, since, ...types) as { n: number };
    return Number(row.n);
  }

  lastEventTs(agentId: string): number | null {
    const row = this.db.prepare("SELECT MAX(ts) AS ts FROM events WHERE agent_id = ? AND demo = 0 AND source <> 'hub'").get(agentId) as { ts: number | null };
    return row.ts == null ? null : Number(row.ts);
  }

  purgeDemo() {
    this.db.exec('DELETE FROM events WHERE demo = 1; DELETE FROM tasks WHERE demo = 1; DELETE FROM sessions_log WHERE demo = 1;');
  }

  pruneOlderThan(ts: number) {
    this.db.prepare('DELETE FROM events WHERE ts < ?').run(ts);
    this.db.prepare('DELETE FROM tasks WHERE started_at < ?').run(ts);
    this.db.prepare('DELETE FROM sessions_log WHERE started_at < ?').run(ts);
  }

  // ---- tasks ----
  startTask(agentId: string, sessionId: string | null, title: string, ts: number, demo: boolean): number {
    const res = this.db
      .prepare("INSERT INTO tasks(agent_id, session_id, title, status, started_at, demo) VALUES (?,?,?,'running',?,?)")
      .run(agentId, sessionId, title, ts, demo ? 1 : 0);
    return Number(res.lastInsertRowid);
  }
  endTask(id: number, status: TaskSummary['status'], ts: number, tokensIn?: number | null, tokensOut?: number | null, tokensCached?: number | null) {
    this.db
      .prepare('UPDATE tasks SET status = ?, ended_at = ?, tokens_in = ?, tokens_out = ?, tokens_cached = ? WHERE id = ?')
      .run(status, ts, tokensIn ?? null, tokensOut ?? null, tokensCached ?? null, id);
  }
  /** Marks tasks left running by a previous hub process as abandoned (we can't know how they ended). */
  abandonRunningTasks(ts: number) {
    this.db.prepare("UPDATE tasks SET status = 'abandoned', ended_at = ? WHERE status = 'running'").run(ts);
  }
  /** Most recent tasks for one agent, or across all agents when agentId is null. */
  listTasks(agentId: string | null, demo: boolean, limit = 20): TaskSummary[] {
    const rows = (
      agentId
        ? this.db.prepare('SELECT * FROM tasks WHERE agent_id = ? AND demo = ? ORDER BY started_at DESC LIMIT ?').all(agentId, demo ? 1 : 0, limit)
        : this.db.prepare('SELECT * FROM tasks WHERE demo = ? ORDER BY started_at DESC LIMIT ?').all(demo ? 1 : 0, limit)
    ) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: Number(r.id),
      agentId: String(r.agent_id),
      sessionId: (r.session_id as string) ?? null,
      title: String(r.title),
      status: r.status as TaskSummary['status'],
      startedAt: Number(r.started_at),
      endedAt: r.ended_at == null ? null : Number(r.ended_at),
      tokensIn: r.tokens_in == null ? null : Number(r.tokens_in),
      tokensOut: r.tokens_out == null ? null : Number(r.tokens_out),
      tokensCached: r.tokens_cached == null ? null : Number(r.tokens_cached),
    }));
  }
  taskStats(agentId: string | null, demo: boolean, since: number) {
    const agentClause = agentId ? 'AND agent_id = ?' : '';
    const args: (string | number)[] = [demo ? 1 : 0, since];
    if (agentId) args.push(agentId);
    const row = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
           AVG(CASE WHEN status = 'completed' THEN ended_at - started_at END) AS avg_ms,
           MAX(CASE WHEN status = 'completed' THEN ended_at - started_at END) AS max_ms,
           SUM(tokens_in) AS tokens_in,
           SUM(tokens_out) AS tokens_out,
           SUM(tokens_cached) AS tokens_cached,
           COUNT(tokens_cached) AS cached_tasks,
           COUNT(tokens_in) AS token_tasks
         FROM tasks WHERE demo = ? AND started_at >= ? ${agentClause}`,
      )
      .get(...args) as Record<string, number | null>;
    return {
      completed: Number(row.completed ?? 0),
      failed: Number(row.failed ?? 0),
      running: Number(row.running ?? 0),
      avgMs: row.avg_ms == null ? null : Math.round(Number(row.avg_ms)),
      maxMs: row.max_ms == null ? null : Number(row.max_ms),
      tokensIn: Number(row.token_tasks ?? 0) > 0 ? Number(row.tokens_in ?? 0) : null,
      tokensOut: Number(row.token_tasks ?? 0) > 0 ? Number(row.tokens_out ?? 0) : null,
      tokensCached: Number(row.cached_tasks ?? 0) > 0 ? Number(row.tokens_cached ?? 0) : null,
    };
  }

  // ---- sessions (for uptime) ----
  logSessionStart(agentId: string, sessionId: string, ts: number, demo: boolean) {
    this.db
      .prepare('INSERT OR IGNORE INTO sessions_log(agent_id, session_id, started_at, demo) VALUES (?,?,?,?)')
      .run(agentId, sessionId, ts, demo ? 1 : 0);
  }
  logSessionEnd(agentId: string, sessionId: string, ts: number) {
    this.db.prepare('UPDATE sessions_log SET ended_at = ? WHERE agent_id = ? AND session_id = ? AND ended_at IS NULL').run(ts, agentId, sessionId);
  }
  /** Milliseconds during [since, now] covered by at least one session of this agent. */
  activeMs(agentId: string, demo: boolean, since: number, now: number): number {
    const rows = this.db
      .prepare('SELECT started_at, ended_at FROM sessions_log WHERE agent_id = ? AND demo = ? AND (ended_at IS NULL OR ended_at >= ?) ORDER BY started_at')
      .all(agentId, demo ? 1 : 0, since) as { started_at: number; ended_at: number | null }[];
    let total = 0;
    let curStart = -1;
    let curEnd = -1;
    for (const r of rows) {
      const s = Math.max(Number(r.started_at), since);
      const e = Math.min(r.ended_at == null ? now : Number(r.ended_at), now);
      if (e <= s) continue;
      if (s > curEnd) {
        if (curEnd > curStart) total += curEnd - curStart;
        curStart = s;
        curEnd = e;
      } else curEnd = Math.max(curEnd, e);
    }
    if (curEnd > curStart) total += curEnd - curStart;
    return total;
  }

  // ---- auth sessions ----
  addAuthSession(hash: string, expiresAt: number, ua: string | null) {
    this.db.prepare('INSERT INTO auth_sessions(token_hash, created_at, expires_at, user_agent) VALUES (?,?,?,?)').run(hash, Date.now(), expiresAt, ua);
  }
  validAuthSession(hash: string): boolean {
    const row = this.db.prepare('SELECT expires_at FROM auth_sessions WHERE token_hash = ?').get(hash) as { expires_at: number } | undefined;
    return !!row && Number(row.expires_at) > Date.now();
  }
  deleteAuthSession(hash: string) {
    this.db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hash);
  }
  deleteAllAuthSessions() {
    this.db.exec('DELETE FROM auth_sessions');
  }
}

function rowToEvent(r: Record<string, unknown>): VillageEvent {
  return {
    id: Number(r.id),
    ts: Number(r.ts),
    agentId: String(r.agent_id),
    sessionId: (r.session_id as string) ?? null,
    type: r.type as EventType,
    title: String(r.title),
    detail: (r.detail as string) ?? null,
    source: String(r.source),
    demo: Number(r.demo) === 1,
    data: r.data ? (JSON.parse(String(r.data)) as Record<string, unknown>) : null,
  };
}
