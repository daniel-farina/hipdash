import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = path.join(DATA_DIR, 'history.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS snapshot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS snapshot_kind_ts ON snapshot(kind, ts);

  CREATE TABLE IF NOT EXISTS restart_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    target TEXT NOT NULL,
    detail TEXT,
    snapshot_id INTEGER,
    FOREIGN KEY(snapshot_id) REFERENCES snapshot(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS restart_event_target_ts ON restart_event(target, ts);

  CREATE TABLE IF NOT EXISTS metric_point (
    ts INTEGER NOT NULL,
    series TEXT NOT NULL,
    value REAL,
    extra TEXT
  );
  CREATE INDEX IF NOT EXISTS metric_point_series_ts ON metric_point(series, ts);

  CREATE TABLE IF NOT EXISTS request_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    request_id TEXT,
    session_id TEXT,
    mode TEXT,
    prompt TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    decode_tok_s REAL,
    prefill_tok_s REAL,
    ttft_s REAL,
    wall_s REAL,
    raw TEXT
  );
  CREATE INDEX IF NOT EXISTS request_log_ts ON request_log(ts);
  CREATE UNIQUE INDEX IF NOT EXISTS request_log_request_id ON request_log(request_id) WHERE request_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS kv_state (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
`);

const stmt = {
  insertSnapshot: db.prepare(
    'INSERT INTO snapshot (ts, kind, data) VALUES (?, ?, ?)',
  ),
  insertRestart: db.prepare(
    'INSERT INTO restart_event (ts, target, detail, snapshot_id) VALUES (?, ?, ?, ?)',
  ),
  insertMetric: db.prepare(
    'INSERT INTO metric_point (ts, series, value, extra) VALUES (?, ?, ?, ?)',
  ),
  upsertKv: db.prepare(
    'INSERT INTO kv_state (k, v, ts) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, ts=excluded.ts',
  ),
  getKv: db.prepare('SELECT v, ts FROM kv_state WHERE k = ?'),
  insertRequest: db.prepare(
    `INSERT OR IGNORE INTO request_log
     (ts, request_id, session_id, mode, prompt, prompt_tokens, completion_tokens,
      decode_tok_s, prefill_tok_s, ttft_s, wall_s, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  recentMetrics: db.prepare(
    'SELECT ts, value, extra FROM metric_point WHERE series = ? AND ts >= ? ORDER BY ts ASC',
  ),
  recentSnapshots: db.prepare(
    'SELECT id, ts, data FROM snapshot WHERE kind = ? AND ts >= ? ORDER BY ts ASC',
  ),
  latestSnapshot: db.prepare(
    'SELECT id, ts, data FROM snapshot WHERE kind = ? ORDER BY ts DESC LIMIT 1',
  ),
  recentRestarts: db.prepare(
    'SELECT id, ts, target, detail FROM restart_event WHERE ts >= ? ORDER BY ts DESC',
  ),
  restartsByTarget: db.prepare(
    'SELECT id, ts, target, detail FROM restart_event WHERE target = ? ORDER BY ts ASC',
  ),
  countRequestsBetween: db.prepare(
    'SELECT COUNT(*) AS n, MIN(ts) AS first_ts, MAX(ts) AS last_ts, AVG(decode_tok_s) AS avg_decode FROM request_log WHERE ts >= ? AND ts < ?',
  ),
  recentRequests: db.prepare(
    `SELECT id, ts, request_id, session_id, mode, prompt, prompt_tokens, completion_tokens,
            decode_tok_s, prefill_tok_s, ttft_s, wall_s, raw
       FROM request_log
       WHERE ts >= ?
       ORDER BY ts DESC
       LIMIT ?`,
  ),
  pruneSnapshots: db.prepare('DELETE FROM snapshot WHERE ts < ?'),
  pruneMetrics: db.prepare('DELETE FROM metric_point WHERE ts < ?'),
  pruneRequests: db.prepare('DELETE FROM request_log WHERE ts < ?'),
};

export function saveSnapshot(kind, data) {
  const ts = Date.now();
  const info = stmt.insertSnapshot.run(ts, kind, JSON.stringify(data));
  return { id: info.lastInsertRowid, ts };
}

export function logRestart(target, detail, snapshotId = null) {
  const ts = Date.now();
  const info = stmt.insertRestart.run(
    ts,
    target,
    detail ? JSON.stringify(detail) : null,
    snapshotId,
  );
  return { id: info.lastInsertRowid, ts };
}

export function recordMetric(series, value, extra = null) {
  stmt.insertMetric.run(
    Date.now(),
    series,
    value,
    extra ? JSON.stringify(extra) : null,
  );
}

export function recordMetricsBatch(rows) {
  const tx = db.transaction((items) => {
    for (const r of items) {
      stmt.insertMetric.run(
        r.ts ?? Date.now(),
        r.series,
        r.value,
        r.extra ? JSON.stringify(r.extra) : null,
      );
    }
  });
  tx(rows);
}

export function setKv(k, v) {
  stmt.upsertKv.run(k, JSON.stringify(v), Date.now());
}

export function getKv(k) {
  const row = stmt.getKv.get(k);
  if (!row) return null;
  try {
    return { value: JSON.parse(row.v), ts: row.ts };
  } catch {
    return { value: row.v, ts: row.ts };
  }
}

export function recordRequest(req) {
  stmt.insertRequest.run(
    req.ts ?? Date.now(),
    req.request_id ?? null,
    req.session_id ?? null,
    req.mode ?? null,
    req.prompt ?? null,
    req.prompt_tokens ?? null,
    req.completion_tokens ?? null,
    req.decode_tok_s ?? null,
    req.prefill_tok_s ?? null,
    req.ttft_s ?? null,
    req.wall_s ?? null,
    req.raw ? JSON.stringify(req.raw) : null,
  );
}

export function getMetrics(series, sinceMs) {
  const rows = stmt.recentMetrics.all(series, sinceMs);
  return rows.map((r) => ({
    ts: r.ts,
    value: r.value,
    extra: r.extra ? JSON.parse(r.extra) : null,
  }));
}

export function getMetricsBucketed(series, sinceMs, untilMs, bucketMs) {
  const rows = db
    .prepare(
      `SELECT
         CAST(ts / ? AS INTEGER) * ? AS bucket_ts,
         AVG(value)   AS value,
         MIN(value)   AS min_value,
         MAX(value)   AS max_value,
         COUNT(*)     AS samples
       FROM metric_point
       WHERE series = ? AND ts >= ? AND ts < ?
       GROUP BY bucket_ts
       ORDER BY bucket_ts ASC`,
    )
    .all(bucketMs, bucketMs, series, sinceMs, untilMs);
  return rows.map((r) => ({
    ts: r.bucket_ts,
    value: r.value,
    min: r.min_value,
    max: r.max_value,
    samples: r.samples,
  }));
}

export function getSnapshots(kind, sinceMs) {
  const rows = stmt.recentSnapshots.all(kind, sinceMs);
  return rows.map((r) => ({ id: r.id, ts: r.ts, data: JSON.parse(r.data) }));
}

export function getLatestSnapshot(kind) {
  const row = stmt.latestSnapshot.get(kind);
  if (!row) return null;
  return { id: row.id, ts: row.ts, data: JSON.parse(row.data) };
}

export function getRestarts(sinceMs) {
  const rows = stmt.recentRestarts.all(sinceMs);
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    target: r.target,
    detail: r.detail ? JSON.parse(r.detail) : null,
  }));
}

export function getRuns(target = 'mtplx') {
  // A "run" is the window from one restart_event to the next (or now).
  // Restart events for the given target define the run boundaries.
  const restarts = stmt.restartsByTarget.all(target).map((r) => ({
    id: r.id,
    ts: r.ts,
    detail: r.detail ? JSON.parse(r.detail) : null,
  }));
  if (!restarts.length) return [];

  const now = Date.now();
  const runs = [];
  for (let i = 0; i < restarts.length; i++) {
    const start = restarts[i].ts;
    const end = i + 1 < restarts.length ? restarts[i + 1].ts : now;
    const stats = stmt.countRequestsBetween.get(start, end) || {};
    runs.push({
      run_id: restarts[i].id,
      target,
      start_ts: start,
      end_ts: i + 1 < restarts.length ? end : null,
      is_current: i + 1 === restarts.length,
      detail: restarts[i].detail,
      request_count: stats.n || 0,
      first_request_ts: stats.first_ts || null,
      last_request_ts: stats.last_ts || null,
      avg_decode_tok_s: stats.avg_decode || null,
    });
  }
  // Newest first
  return runs.reverse();
}

export function getRequestsBetween(sinceMs, untilMs, limit = 1000) {
  const rows = db
    .prepare(
      `SELECT id, ts, request_id, session_id, mode, prompt, prompt_tokens, completion_tokens,
              decode_tok_s, prefill_tok_s, ttft_s, wall_s, raw
         FROM request_log
         WHERE ts >= ? AND ts < ?
         ORDER BY ts DESC
         LIMIT ?`,
    )
    .all(sinceMs, untilMs, limit);
  return rows.map((r) => ({
    ...r,
    raw: r.raw ? safeParse(r.raw) : null,
  }));
}

export function getRequests(sinceMs, limit = 200) {
  const rows = stmt.recentRequests.all(sinceMs, limit);
  return rows.map((r) => ({
    ...r,
    raw: r.raw ? safeParse(r.raw) : null,
  }));
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

export function prune(maxAgeMs) {
  const cutoff = Date.now() - maxAgeMs;
  const tx = db.transaction(() => {
    stmt.pruneMetrics.run(cutoff);
    stmt.pruneSnapshots.run(cutoff);
    stmt.pruneRequests.run(cutoff);
  });
  tx();
}

export default db;
