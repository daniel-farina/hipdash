import http from 'node:http';
import { publish, markFinished } from './progress.js';

export const MTPLX = {
  host: process.env.MTPLX_HOST || '127.0.0.1',
  port: Number(process.env.MTPLX_PORT || 8088),
};

export const SIDECAR = {
  host: process.env.SIDECAR_HOST || '127.0.0.1',
  port: Number(process.env.SIDECAR_PORT || 8002),
};

export const MTPLX_PREFIXES = ['/admin', '/metrics', '/health', '/v1', '/cancel-all', '/tap'];
export const SIDECAR_PATHS = [
  '/system-stats.json',
  '/opencode-config.json',
  '/opencode-tool-usage.json',
];

export function routeFor(path) {
  const p = path.split('?', 1)[0];
  if (SIDECAR_PATHS.includes(p)) return SIDECAR;
  for (const pref of MTPLX_PREFIXES) {
    if (p === pref || p.startsWith(pref + '/') || p.startsWith(pref + '?')) {
      return MTPLX;
    }
  }
  return null;
}

export function fetchJson(target, path, { timeoutMs = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: target.host,
        port: target.port,
        path,
        method: 'GET',
        headers: { Accept: 'application/json' },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) {
            return reject(new Error(`upstream ${path} ${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`bad json from ${path}: ${e.message}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`timeout ${path}`));
    });
    req.end();
  });
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

function shouldTap(req) {
  if (req.method !== 'POST') return false;
  const p = (req.url || '').split('?', 1)[0];
  return p === '/v1/chat/completions';
}

function makeSseTap(sessionId) {
  let buf = '';
  return (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') {
        if (payload === '[DONE]') markFinished(sessionId);
        continue;
      }
      let obj;
      try { obj = JSON.parse(payload); } catch { continue; }
      const prog = obj?.mtplx_progress;
      const choice0 = Array.isArray(obj?.choices) ? obj.choices[0] : null;
      const finishReason = choice0?.finish_reason;
      if (prog) {
        publish(sessionId, {
          completion_tokens: prog.completion_tokens ?? prog.tokens ?? null,
          decode_tok_s: prog.decode_tok_s ?? prog.tok_s ?? null,
          prefill_tok_s: prog.prefill_tok_s ?? null,
          ttft_s: prog.ttft_s ?? null,
          mode: prog.generation_mode ?? prog.mode ?? null,
          mtp_depth: prog.mtp_depth ?? null,
        });
      }
      if (finishReason) markFinished(sessionId);
    }
  };
}

export function proxyRequest(req, res) {
  const target = routeFor(req.url);
  if (!target) return false;

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!k) continue;
    const kl = k.toLowerCase();
    if (HOP_BY_HOP.has(kl) || kl === 'host' || kl === 'content-length') continue;
    headers[k] = v;
  }

  const tapping = shouldTap(req);
  const sessionId = tapping
    ? req.headers['x-mtplx-session-id'] || req.headers['X-MTPLX-Session-Id']
    : null;

  const upstream = http.request(
    {
      host: target.host,
      port: target.port,
      path: req.url,
      method: req.method,
      headers,
    },
    (uRes) => {
      const respHeaders = {};
      for (const [k, v] of Object.entries(uRes.headers)) {
        if (HOP_BY_HOP.has(k.toLowerCase()) || k.toLowerCase() === 'content-length') continue;
        respHeaders[k] = v;
      }
      respHeaders['Access-Control-Allow-Origin'] = '*';
      respHeaders['Connection'] = 'close';
      res.writeHead(uRes.statusCode || 502, uRes.statusMessage, respHeaders);

      const isStream = (uRes.headers['content-type'] || '').includes('text/event-stream');
      if (tapping && isStream && sessionId) {
        const tap = makeSseTap(sessionId);
        uRes.on('data', (chunk) => {
          try { tap(chunk); } catch (e) { /* ignore parse errors */ }
          res.write(chunk);
        });
        uRes.on('end', () => {
          markFinished(sessionId);
          res.end();
        });
        uRes.on('error', () => res.end());
      } else {
        uRes.pipe(res);
      }
    },
  );

  upstream.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
    }
    res.end(`upstream ${target.host}:${target.port} error: ${err.message}`);
  });

  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
  return true;
}
