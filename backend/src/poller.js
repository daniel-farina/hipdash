import { MTPLX, SIDECAR, fetchJson } from './upstreams.js';
import {
  saveSnapshot,
  logRestart,
  recordMetricsBatch,
  recordRequest,
  setKv,
  getKv,
} from './db.js';

const log = (...a) => console.log('[poller]', ...a);

const state = {
  last_health: null,
  seen_request_fps: new Set(), // bounded LRU-ish
  seen_request_fps_order: [],
  last_system_ts: 0,
  last_mtplx_seen: 0,
  last_sidecar_seen: 0,
  mtplx_alive: false,
  sidecar_alive: false,
  last_mtplx_signature: null,
  last_sidecar_signature: null,
};

const MAX_SEEN_FPS = 1024;

function rememberFp(fp) {
  if (state.seen_request_fps.has(fp)) return false;
  state.seen_request_fps.add(fp);
  state.seen_request_fps_order.push(fp);
  while (state.seen_request_fps_order.length > MAX_SEEN_FPS) {
    const old = state.seen_request_fps_order.shift();
    state.seen_request_fps.delete(old);
  }
  return true;
}

function fingerprintRequest(r) {
  // /metrics has no request_id; synthesize a content fingerprint that is
  // stable across polls but distinct across requests.
  return [
    r.session_id ?? '',
    r.prompt_tokens ?? '',
    r.completion_tokens ?? '',
    r.prompt_eval_time_s ?? '',
    r.decode_elapsed_s ?? '',
    r.request_elapsed_s ?? '',
    r.ttft_s ?? '',
  ].join('|');
}

(function loadPersistedSignatures() {
  const m = getKv('mtplx_signature');
  if (m) state.last_mtplx_signature = m.value;
  const s = getKv('sidecar_signature');
  if (s) state.last_sidecar_signature = s.value;
})();

function mtplxSignature(health) {
  return [
    health?.model || '',
    health?.runtime_mode || '',
    health?.build_time || '',
    health?.boot_time || '',
    health?.process_started_at || '',
    health?.uptime_s || '',
  ].join('|');
}

function sidecarSignature(stats) {
  // stats has uptime; if uptime resets, the host (or sidecar) restarted.
  return [stats?.uptime || '', stats?.cpu_cores || ''].join('|');
}

function isMtplxRestart(prev, next, prevHealth, nextHealth) {
  if (!prev) return false;
  if (prev !== next) return true;
  // Fallback: uptime monotonic check
  const pu = Number(prevHealth?.uptime_s || 0);
  const nu = Number(nextHealth?.uptime_s || 0);
  if (pu > 0 && nu > 0 && nu + 5 < pu) return true;
  return false;
}

async function pollMtplx() {
  let health = null;
  try {
    health = await fetchJson(MTPLX, '/health', { timeoutMs: 2500 });
    state.mtplx_alive = true;
    state.last_mtplx_seen = Date.now();
  } catch (err) {
    if (state.mtplx_alive) log('mtplx down:', err.message);
    state.mtplx_alive = false;
    return;
  }

  state.last_health = health;

  const sig = mtplxSignature(health);
  if (state.last_mtplx_signature && sig !== state.last_mtplx_signature) {
    if (isMtplxRestart(state.last_mtplx_signature, sig, null, health)) {
      const snap = saveSnapshot('mtplx_restart_health', health);
      logRestart('mtplx', { prev_sig: state.last_mtplx_signature, sig, health }, snap.id);
      log('detected MTPLX restart');
    }
  } else if (!state.last_mtplx_signature) {
    saveSnapshot('mtplx_initial_health', health);
    logRestart('mtplx', { sig, initial: true, health }, null);
    log('initial MTPLX snapshot saved');
  }
  state.last_mtplx_signature = sig;
  setKv('mtplx_signature', sig);

  // Pull /metrics + /admin/sessions in parallel
  const [metricsResult, sessionsResult] = await Promise.allSettled([
    fetchJson(MTPLX, '/metrics', { timeoutMs: 3000 }),
    fetchJson(MTPLX, '/admin/sessions', { timeoutMs: 3000 }),
  ]);

  const metricsRows = [];
  if (metricsResult.status === 'fulfilled') {
    const m = metricsResult.value;
    const latest = m?.latest;

    // Persist any unseen request from BOTH `latest` and the rolling `recent`
    // buffer (32 entries). MTPLX has no request_id, so we dedupe by fingerprint.
    const candidates = [];
    if (Array.isArray(m?.recent)) candidates.push(...m.recent);
    if (latest && typeof latest === 'object') candidates.push(latest);
    for (const r of candidates) {
      if (!r || typeof r !== 'object') continue;
      const fp = fingerprintRequest(r);
      if (!fp || fp === '||||||') continue;
      if (!rememberFp(fp)) continue;
      recordRequest({
        ts: Date.now(),
        request_id: fp, // satisfies the unique index, doubles as a stable key
        session_id: r.session_id || null,
        mode: r.generation_mode || r.mode || null,
        prompt: null, // /metrics doesn't include prompt text
        prompt_tokens: r.prompt_tokens ?? null,
        completion_tokens: r.completion_tokens ?? null,
        decode_tok_s: r.decode_tok_s ?? null,
        prefill_tok_s: r.prefill_tok_s ?? null,
        ttft_s: r.ttft_s ?? null,
        wall_s: r.request_elapsed_s ?? null,
        raw: r,
      });
    }

    if (latest) {
      const ts = Date.now();
      const push = (series, value) => {
        if (typeof value === 'number' && isFinite(value)) {
          metricsRows.push({ ts, series, value });
        }
      };
      push('decode_tok_s', latest.decode_tok_s);
      push('prefill_tok_s', latest.prefill_tok_s);
      push('ttft_s', latest.ttft_s);
      push('completion_tokens', latest.completion_tokens);
      push('prompt_tokens', latest.prompt_tokens);
      push('context_len', latest.context_len);
      push('prompt_eval_time_s', latest.prompt_eval_time_s);
      push('decode_elapsed_s', latest.decode_elapsed_s);
      push('request_elapsed_s', latest.request_elapsed_s);
      push('verify_calls', latest.verify_calls);
      push('bonus_tokens', latest.bonus_tokens);
      push('correction_tokens', latest.correction_tokens);
      push('cached_tokens', latest.cached_tokens);
      push('new_prefill_tokens', latest.new_prefill_tokens);
      // Avg acceptance % across MTP depths for this request
      if (Array.isArray(latest.accepted_by_depth) && latest.verify_calls > 0) {
        const arr = latest.accepted_by_depth;
        const pcts = arr.map((n) => (n / latest.verify_calls) * 100);
        const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
        push('avg_accept_pct', avg);
      }
    }
    saveSnapshot('mtplx_metrics', m);
  }

  if (sessionsResult.status === 'fulfilled') {
    const s = sessionsResult.value;
    const bank = s?.session_bank || {};
    const ts = Date.now();
    const bytes = bank.total_nbytes ?? bank.bytes;
    const entries = bank.entries;
    if (typeof bytes === 'number') {
      metricsRows.push({ ts, series: 'cache_bytes', value: bytes });
    }
    if (typeof entries === 'number') {
      metricsRows.push({ ts, series: 'cache_entries', value: entries });
    }
    if (Array.isArray(s?.sessions)) {
      metricsRows.push({ ts, series: 'session_count', value: s.sessions.length });
    }
    saveSnapshot('mtplx_sessions', s);
  }

  if (metricsRows.length) recordMetricsBatch(metricsRows);
}

async function pollSidecar() {
  let stats = null;
  try {
    stats = await fetchJson(SIDECAR, '/system-stats.json', { timeoutMs: 3000 });
    state.sidecar_alive = true;
    state.last_sidecar_seen = Date.now();
  } catch (err) {
    if (state.sidecar_alive) log('sidecar down:', err.message);
    state.sidecar_alive = false;
    return;
  }

  const sig = sidecarSignature(stats);
  if (state.last_sidecar_signature && sig !== state.last_sidecar_signature) {
    const snap = saveSnapshot('host_restart_stats', stats);
    logRestart('host', { prev_sig: state.last_sidecar_signature, sig, uptime: stats?.uptime }, snap.id);
    log('detected host uptime change');
  } else if (!state.last_sidecar_signature) {
    saveSnapshot('host_initial_stats', stats);
    logRestart('host', { sig, initial: true }, null);
    log('initial host snapshot saved');
  }
  state.last_sidecar_signature = sig;
  setKv('sidecar_signature', sig);

  const ts = Date.now();
  const rows = [];
  if (typeof stats?.cpu?.used === 'number') {
    rows.push({ ts, series: 'cpu_used_pct', value: stats.cpu.used });
  }
  if (typeof stats?.memory?.used_bytes === 'number') {
    rows.push({ ts, series: 'mem_used_bytes', value: stats.memory.used_bytes });
  }
  if (typeof stats?.swap?.used_bytes === 'number') {
    rows.push({ ts, series: 'swap_used_bytes', value: stats.swap.used_bytes });
  }
  if (typeof stats?.load?.['1m'] === 'number') {
    rows.push({ ts, series: 'load_1m', value: stats.load['1m'] });
  }
  if (rows.length) recordMetricsBatch(rows);
  saveSnapshot('system_stats', stats);
}

export function startPollers() {
  log('starting pollers');
  // MTPLX every 1.5s
  const mInt = setInterval(() => {
    pollMtplx().catch((e) => log('pollMtplx error:', e.message));
  }, 1500);
  pollMtplx().catch((e) => log('pollMtplx error:', e.message));

  // Sidecar every 3s
  const sInt = setInterval(() => {
    pollSidecar().catch((e) => log('pollSidecar error:', e.message));
  }, 3000);
  pollSidecar().catch((e) => log('pollSidecar error:', e.message));

  return () => {
    clearInterval(mInt);
    clearInterval(sInt);
  };
}

export function getStatus() {
  return {
    mtplx_alive: state.mtplx_alive,
    sidecar_alive: state.sidecar_alive,
    last_mtplx_seen: state.last_mtplx_seen,
    last_sidecar_seen: state.last_sidecar_seen,
    last_health: state.last_health,
    mtplx_signature: state.last_mtplx_signature,
    sidecar_signature: state.last_sidecar_signature,
  };
}
