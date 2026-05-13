import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import {
  getMetrics,
  getMetricsBucketed,
  getSnapshots,
  getLatestSnapshot,
  getRestarts,
  getRequests,
  getRequestsBetween,
  getRuns,
  logRestart,
  prune,
} from './db.js';
import { proxyRequest } from './upstreams.js';
import { startPollers, getStatus } from './poller.js';
import { subscribe as subscribeProgress } from './progress.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist');

const PORT = Number(process.env.PORT || 9090);
const BIND = process.env.BIND || '0.0.0.0';

const app = express();
app.disable('x-powered-by');

// CORS for any direct API consumer
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'content-type,x-mtplx-session-id,authorization,accept',
  );
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// History / state API
app.get('/api/status', (req, res) => {
  res.json(getStatus());
});

app.get('/api/history/metrics', (req, res) => {
  const series = String(req.query.series || '').split(',').filter(Boolean);
  const rangeMs = Number(req.query.range_ms || 5 * 60 * 1000);
  const maxPoints = req.query.max_points ? Math.min(2000, Math.max(50, Number(req.query.max_points))) : null;
  const now = Date.now();
  const since = now - rangeMs;
  const out = {};
  if (maxPoints) {
    // Round bucket size up so we never overshoot maxPoints.
    const bucketMs = Math.max(1000, Math.ceil(rangeMs / maxPoints));
    for (const s of series) out[s] = getMetricsBucketed(s, since, now, bucketMs);
    res.json({ since, until: now, bucket_ms: bucketMs, series: out });
    return;
  }
  for (const s of series) out[s] = getMetrics(s, since);
  res.json({ since, until: now, series: out });
});

app.get('/api/history/restarts', (req, res) => {
  const rangeMs = Number(req.query.range_ms || 7 * 24 * 60 * 60 * 1000);
  res.json({ restarts: getRestarts(Date.now() - rangeMs) });
});

app.get('/api/history/snapshots', (req, res) => {
  const kind = String(req.query.kind || '');
  const rangeMs = Number(req.query.range_ms || 60 * 60 * 1000);
  if (!kind) return res.status(400).json({ error: 'kind required' });
  res.json({ snapshots: getSnapshots(kind, Date.now() - rangeMs) });
});

app.get('/api/history/latest', (req, res) => {
  const kind = String(req.query.kind || '');
  if (!kind) return res.status(400).json({ error: 'kind required' });
  res.json(getLatestSnapshot(kind));
});

app.get('/api/history/requests', (req, res) => {
  // Cap at 100k rows (effectively unlimited for our use case).
  const limit = Math.min(Number(req.query.limit || 200), 100000);
  const since = req.query.since_ts != null ? Number(req.query.since_ts) : null;
  const until = req.query.until_ts != null ? Number(req.query.until_ts) : null;
  if (since != null) {
    res.json({ requests: getRequestsBetween(since, until ?? Date.now(), limit) });
    return;
  }
  const rangeMs = Number(req.query.range_ms || 24 * 60 * 60 * 1000);
  res.json({ requests: getRequests(Date.now() - rangeMs, limit) });
});

app.get('/api/runs', (req, res) => {
  const target = String(req.query.target || 'mtplx');
  res.json({ runs: getRuns(target) });
});

// SSE: live request progress, tapped from streaming /v1/chat/completions
// responses that pass through the proxy.
app.get('/api/live-progress', (req, res) => {
  subscribeProgress(res);
});

// Archive the current run: write a synthetic restart event so the existing
// boundary logic closes the live run and starts a new one. MTPLX itself is
// not touched.
app.post('/api/runs/archive', express.json(), (req, res) => {
  const target = String(req.body?.target || req.query.target || 'mtplx');
  const note = (req.body?.note || '').toString().slice(0, 200);
  const event = logRestart(target, { manual_archive: true, note: note || undefined });
  res.json({ ok: true, event });
});

// Proxy: anything that matches an upstream prefix
app.use((req, res, next) => {
  if (proxyRequest(req, res)) return;
  next();
});

// Static frontend (after API + proxy so /api/* and /v1/* never get caught here)
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST, { index: 'index.html', extensions: ['html'] }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.type('text/plain').send(
      'frontend/dist not built yet. Run `npm --prefix frontend run build` then restart.',
    );
  });
}

// 404 fallback for any unmatched API routes
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

startPollers();

// Prune older than 14 days every hour
setInterval(() => {
  try {
    prune(14 * 24 * 60 * 60 * 1000);
  } catch (e) {
    console.error('[prune] failed:', e.message);
  }
}, 60 * 60 * 1000);

app.listen(PORT, BIND, () => {
  console.log(`mtplx-dashboard backend listening on http://${BIND}:${PORT}/`);
  console.log(`  proxying /admin/*, /metrics, /health, /v1/* -> MTPLX`);
  console.log(`  proxying /system-stats.json, /opencode-* -> sidecar`);
  console.log(`  history API at /api/history/* and /api/status`);
  console.log(
    fs.existsSync(FRONTEND_DIST)
      ? `  serving frontend from ${FRONTEND_DIST}`
      : `  (frontend not yet built; visit ${FRONTEND_DIST} after \`npm run build\`)`,
  );
});
