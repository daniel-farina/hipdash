// Reads real Apple Silicon temperature + power from `macmon pipe`.
// macmon (https://github.com/vladkens/macmon) is a sudoless Rust tool that
// taps the IOReport framework — the same source iStat Menus / mactop use.
//
// We spawn it once with `-i 3000` (3s interval), parse each JSON line from
// stdout, and keep the latest reading in memory. The poller looks it up on
// every sidecar poll.

import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CANDIDATE_PATHS = [
  process.env.MACMON_PATH,
  '/Users/dan/.cargo/bin/macmon',
  `${process.env.HOME || ''}/.cargo/bin/macmon`,
  '/opt/homebrew/bin/macmon',
  '/usr/local/bin/macmon',
].filter(Boolean);

let latest = null;
let lastTs = 0;
let proc = null;
let resolvedPath = null;

function findBinary() {
  for (const p of CANDIDATE_PATHS) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

function start() {
  if (proc) return;
  resolvedPath = findBinary();
  if (!resolvedPath) {
    console.log('[macmon] binary not found — temperature/power readings disabled');
    return;
  }
  console.log(`[macmon] spawning ${resolvedPath} pipe -i 3000`);
  proc = spawn(resolvedPath, ['pipe', '-i', '3000'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        latest = JSON.parse(line);
        lastTs = Date.now();
      } catch {
        // ignore malformed lines
      }
    }
  });
  proc.stderr.on('data', (b) => {
    const s = b.toString('utf8').trim();
    if (s) console.error('[macmon stderr]', s.slice(0, 200));
  });
  proc.on('error', (err) => {
    console.error('[macmon] spawn error:', err.message);
    proc = null;
    latest = null;
  });
  proc.on('exit', (code) => {
    console.warn(`[macmon] exited (code=${code}); restarting in 5s`);
    proc = null;
    latest = null;
    setTimeout(start, 5000);
  });
}

export function startMacmon() {
  start();
}

export function getLatestMacmon() {
  // Stale-guard: if no fresh data in 30s, treat as unavailable.
  if (!latest || Date.now() - lastTs > 30_000) return null;
  return latest;
}

export function macmonStatus() {
  return {
    available: !!resolvedPath,
    path: resolvedPath,
    has_data: !!latest,
    last_sample_ms: latest ? Date.now() - lastTs : null,
  };
}
