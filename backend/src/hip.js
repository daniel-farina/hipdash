// Read hip's ~/.hip/sessions.jsonl (or $HIP_HOME/sessions.jsonl).
// Each line is a SessionRecord; we parse, cache, and re-read only when
// the file's mtime changes. We also key by session_id with a "latest wins"
// merge so duplicates from different rounds collapse into one entry.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HIP_HOME = process.env.HIP_HOME || path.join(os.homedir(), '.hip');
const SESSIONS_PATH = path.join(HIP_HOME, 'sessions.jsonl');

let cache = {
  mtime: 0,
  size: 0,
  sessions: [], // newest first, deduped by session_id (latest occurrence wins)
};

function readAll() {
  let stat;
  try {
    stat = fs.statSync(SESSIONS_PATH);
  } catch (e) {
    return { error: 'sessions.jsonl not found', path: SESSIONS_PATH };
  }
  // Fast path: file unchanged
  if (stat.mtimeMs === cache.mtime && stat.size === cache.size) {
    return { stat, sessions: cache.sessions };
  }
  let raw;
  try {
    raw = fs.readFileSync(SESSIONS_PATH, 'utf8');
  } catch (e) {
    return { error: e.message, path: SESSIONS_PATH };
  }
  const lines = raw.split('\n');
  // Walk in order so later lines override earlier records with the same id.
  const map = new Map();
  for (const line of lines) {
    if (!line) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (!r?.session_id) continue;
    map.set(r.session_id, r);
  }
  const sessions = [...map.values()].sort((a, b) => (b.ts_unix || 0) - (a.ts_unix || 0));
  cache = { mtime: stat.mtimeMs, size: stat.size, sessions };
  return { stat, sessions };
}

// Pull tool calls out of the conv, one entry per assistant message. Each
// assistant message corresponds to one MTPLX inference turn — the tool_calls
// it emits are the tools the agent decided to use in that turn.
function extractToolsFromConv(conv) {
  if (!Array.isArray(conv)) return [];
  const turns = [];
  for (const msg of conv) {
    if (msg?.role !== 'assistant') continue;
    const tcs = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    const names = tcs
      .map((tc) => tc?.function?.name || tc?.name || '')
      .filter(Boolean);
    turns.push(names);
  }
  return turns;
}

// Heuristic tool extraction from a sidecar summary line. The summaries are
// short natural-language sentences from gemma4 like "Read the file ..." or
// "Edited the audio config to ..." — we map common verbs/nouns back to the
// underlying tool family. Used as a fallback when conv has been compacted
// and the precise tool_calls list is gone.
function extractToolsFromSummary(text) {
  if (typeof text !== 'string') return [];
  const s = text.toLowerCase();
  const tools = new Set();

  // Task management — match first so we can suppress generic 'edit' below.
  const isTask = /\b(creat(ed|ing) tasks?|task id|updat(ed|ing) (id|task)|todo list|spawned a task)\b/.test(s);
  if (isTask) tools.add('task');

  // Reads — verbs of looking, plus telltale phrases agents emit.
  if (/\b(read|reading|opened|viewed|inspected|examined|snippet|requested bytes|looked at|peeked|peek|tree)\b/.test(s)
      || /\bat line \d/.test(s)
      || /\bcalled at line\b/.test(s)) tools.add('read');

  // Search
  if (/\b(grep|searched|searching|pattern|regex|matched the pattern)\b/.test(s)) tools.add('grep');

  // Glob / list
  if (/\b(glob|listed|listing|directory tree|file tree)\b/.test(s)) tools.add('glob');

  // Edits — most common verbs in code-agent summaries. Skipped if the
  // summary is task-management-flavoured (avoids "updated id" double-tagging).
  if (!isTask && (
      /\b(edit|edited|editing|edits)\b/.test(s) ||
      /\b(modif(y|ied|ying))\b/.test(s) ||
      /\b(patch|patched|patching)\b/.test(s) ||
      /\b(chang(e|ed|ing))\b/.test(s) ||
      /\b(add(ed|ing)?)\b/.test(s) ||
      /\b(updat(e|ed|ing))\b/.test(s) ||
      /\b(fix(ed|ing)?)\b/.test(s) ||
      /\b(implement(ed|ing|s)?)\b/.test(s) ||
      /\b(set up|inserted|replac(e|ed|ing)|remov(e|ed|ing))\b/.test(s) ||
      /\b(refactor(ed|ing)?)\b/.test(s) ||
      /\b(append(ed|ing)?)\b/.test(s)
  )) tools.add('edit');

  // Write — new file
  if (/\b(wrote|writ(ing|ten)|creat(ed|ing) (a |the )?(new )?file)\b/.test(s)) tools.add('write');

  // Shell — only clear shell verbs (avoid generic "compile" since that's
  // typically a result not a tool call).
  if (/\b(ran (a |the )?command|executed|invoked|bash|shell command|in the terminal)\b/.test(s)) tools.add('bash');

  // Web
  if (/\b(web ?fetch|http|url|website|page|fetched? (a |the )?url)\b/.test(s)) tools.add('webfetch');

  // Plan
  if (/\b(plan(ned|ning)?|exit ?plan|enter ?plan)\b/.test(s)) tools.add('plan');

  return [...tools];
}

// Per-turn tool list combining precise conv tool_calls (when present) with
// heuristic summary-derived hints. Both align to the END of the session
// because hip compacts older conv messages but keeps running_summary lines.
function extractTurnTools(s) {
  const convTools = extractToolsFromConv(s?.conv);
  const summaries = Array.isArray(s?.running_summary) ? s.running_summary : [];
  const summaryTools = summaries.map(extractToolsFromSummary);
  const total = Math.max(convTools.length, summaryTools.length);
  // Build suffix-aligned merged array. The last entry is the most recent.
  const out = [];
  for (let i = 0; i < total; i++) {
    const fromEnd = total - 1 - i;
    const convIdx = convTools.length - 1 - fromEnd;
    const sumIdx = summaryTools.length - 1 - fromEnd;
    const precise = convIdx >= 0 ? convTools[convIdx] : [];
    const hint    = sumIdx  >= 0 ? summaryTools[sumIdx] : [];
    // Prefer precise; if empty, fall back to hints
    out.push(precise.length ? precise : hint);
  }
  return out;
}

// Compact summary for list views — drop the heavy conv array.
function trimSession(s) {
  const turn_tools = extractTurnTools(s);
  return {
    session_id: s.session_id,
    ts_unix: s.ts_unix,
    cwd: s.cwd,
    first_user: typeof s.first_user === 'string' ? s.first_user.slice(0, 400) : '',
    conv_count: Array.isArray(s.conv) ? s.conv.length : 0,
    summary_count: Array.isArray(s.running_summary) ? s.running_summary.length : 0,
    running_summary: Array.isArray(s.running_summary) ? s.running_summary : [],
    turn_tools, // array of arrays: one entry per assistant turn → tool names used
  };
}

export function getSessions() {
  const res = readAll();
  if (res.error) return { error: res.error, path: res.path, sessions: [] };
  return {
    path: SESSIONS_PATH,
    mtime: res.stat.mtimeMs,
    count: res.sessions.length,
    sessions: res.sessions.map(trimSession),
  };
}

export function getSessionDetail(id) {
  const res = readAll();
  if (res.error) return { error: res.error };
  const s = res.sessions.find((x) => x.session_id === id);
  if (!s) return { error: 'not_found' };
  return {
    session_id: s.session_id,
    ts_unix: s.ts_unix,
    cwd: s.cwd,
    first_user: s.first_user,
    running_summary: s.running_summary || [],
    conv: s.conv || [],
  };
}

// Map session_id -> trimmed session, used to overlay sidecar data onto
// MTPLX session entries in benchmark/session views.
export function getSessionsById() {
  const res = readAll();
  if (res.error) return {};
  const out = {};
  for (const s of res.sessions) out[s.session_id] = trimSession(s);
  return out;
}
