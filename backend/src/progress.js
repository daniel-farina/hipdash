// Tiny pubsub + SSE broker for live request progress.
//
// The proxy taps streaming responses on POST /v1/chat/completions, parses
// `data: {...}` chunks, and publishes any `mtplx_progress` blocks here.
// Clients subscribe via GET /api/live-progress (text/event-stream) and
// receive every event keyed by session_id (taken from the `x-mtplx-session-id`
// request header).

const subscribers = new Set();
// Last-seen progress per session, so a fresh subscriber gets the current
// state immediately on connect.
const latestBySession = new Map();

export function subscribe(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // Prime the new subscriber with whatever's currently in flight.
  for (const [sid, ev] of latestBySession.entries()) {
    res.write(`data: ${JSON.stringify({ session_id: sid, ...ev })}\n\n`);
  }

  subscribers.add(res);

  // 15s keep-alive to keep proxies / browsers from giving up.
  const ka = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch {}
  }, 15000);

  res.on('close', () => {
    clearInterval(ka);
    subscribers.delete(res);
  });
}

export function publish(sessionId, payload) {
  const ev = { ts: Date.now(), ...payload };
  if (sessionId) latestBySession.set(sessionId, ev);
  const line = `data: ${JSON.stringify({ session_id: sessionId, ...ev })}\n\n`;
  for (const r of subscribers) {
    try { r.write(line); } catch { /* will be cleaned up on close */ }
  }
}

export function markFinished(sessionId) {
  if (sessionId && latestBySession.has(sessionId)) {
    const last = latestBySession.get(sessionId);
    publish(sessionId, { ...last, finished: true });
    // Drop after a short grace window so reconnecting clients don't see it
    // forever; the request's row will be replaced by the persisted version
    // once /metrics emits.
    setTimeout(() => latestBySession.delete(sessionId), 30_000);
  }
}
