import { fmtNumber, shorten } from '../lib/format';

type Props = {
  metrics: any;            // /metrics body
  sessions: any;           // /admin/sessions body
  health: any;             // /health body (or last_health from /api/status)
};

function fmtElapsed(s: number | null | undefined): string {
  if (s == null || !isFinite(s)) return '-';
  if (s < 60) return `${s.toFixed(s < 1 ? 2 : 1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m}m${String(r).padStart(2, '0')}s`;
}

export default function LiveGeneration({ metrics, sessions, health }: Props) {
  const latest = metrics?.latest || {};
  const activeSessions: any[] = (sessions?.sessions || []).filter((s: any) => s.in_flight);
  const inFlight = (health?.active_requests ?? 0) > 0 || activeSessions.length > 0;
  const liveSession = activeSessions[0] || null;
  const liveStartedMs = liveSession?.in_flight_started_s
    ? liveSession.in_flight_started_s * 1000
    : (health?.last_request_started_at ? health.last_request_started_at * 1000 : null);
  const elapsedS = inFlight && liveStartedMs ? (Date.now() - liveStartedMs) / 1000 : (latest.request_elapsed_s ?? null);

  const sessLabel = (liveSession?.session_id || latest.session_id || '-').toUpperCase();
  const cacheMiss = inFlight
    ? (liveSession?.last_cache_miss_reason && liveSession.last_cache_miss_reason !== 'hit')
    : (latest.session_cache_hit === false);
  const cacheLabel = inFlight
    ? (liveSession?.last_restore_mode === 'reference_lease' ? 'CACHE LEASE' : (liveSession?.last_cache_miss_reason ? 'CACHE MISS' : 'CACHE READY'))
    : (latest.session_cache_hit ? 'CACHE HIT' : `CACHE ${(latest.cache_miss_reason || 'MISS').toUpperCase()}`);

  const stages = [
    {
      key: 'tokenize',
      title: '1. Tokenize',
      status: 'done',
      primary: latest.prompt_tokens,
      primaryUnit: 'tok in',
      lines: [
        `${latest.context_len ?? '-'} ctx`,
      ],
    },
    {
      key: 'prefill',
      title: '2. Prefill',
      status: latest.prefill_tok_s ? 'done' : 'pending',
      primary: fmtNumber(latest.prefill_tok_s),
      primaryUnit: 'tok/s',
      lines: [
        `${latest.new_prefill_tokens ?? '-'} tok prefilled`,
        `${latest.cached_tokens ?? 0} reused`,
      ],
    },
    {
      key: 'decode',
      title: `3. Decode (${(latest.generation_mode || 'AR').toUpperCase()})`,
      status: inFlight ? 'running' : (latest.decode_tok_s ? 'done' : 'pending'),
      primary: fmtNumber(latest.decode_tok_s),
      primaryUnit: 'tok/s',
      lines: [
        `${latest.completion_tokens ?? '-'} tok generated`,
        latest.accepted_by_depth
          ? `${acceptPct(latest)} of ${(latest.verify_calls ?? 0)} D${latest.mtp_depth || '-'} accept`
          : '-',
        `${latest.bonus_tokens ?? 0} / ${latest.correction_tokens ?? 0} bonus / corrections`,
      ],
    },
    {
      key: 'emit',
      title: '4. Emit',
      status: inFlight ? 'running' : 'done',
      primary: inFlight ? 'live' : fmtElapsed(latest.request_elapsed_s),
      primaryUnit: inFlight ? 'SSE' : 'wall',
      lines: [
        `${fmtElapsed(latest.request_elapsed_s)} total wall`,
      ],
    },
  ];

  return (
    <div className="lg-card">
      <div className="lg-head">
        <span className={`lg-state ${inFlight ? 'running' : 'idle'}`}>{inFlight ? 'DECODING' : 'IDLE'}</span>
        <span className="lg-label">{shorten(sessLabel, 28)}</span>
        <span className={`lg-cache ${cacheMiss ? 'miss' : 'hit'}`}>{cacheLabel}</span>
        <span className="lg-elapsed">{fmtElapsed(elapsedS)} elapsed</span>
      </div>

      <div className="lg-pipeline">
        {stages.map((s) => (
          <div key={s.key} className={`lg-stage ${s.status}`}>
            <div className="lg-stage-head">
              <span className="lg-stage-title">{s.title}</span>
              <span className={`lg-stage-status ${s.status}`}>{s.status.toUpperCase()}</span>
            </div>
            <div className="lg-stage-primary">
              <span>{s.primary ?? '-'}</span>
              <small>{s.primaryUnit}</small>
            </div>
            <div className="lg-stage-lines">
              {s.lines.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          </div>
        ))}
      </div>

      <div className="lg-progress">
        <i style={{ width: inFlight ? '70%' : '100%' }} />
      </div>
    </div>
  );
}

function acceptPct(r: any): string {
  const arr: number[] = r.accepted_by_depth || [];
  const verify = r.verify_calls || 0;
  if (!arr.length || !verify) return '-';
  const parts = arr.map((n) => `${Math.round((n / verify) * 100)}%`);
  return parts.join('/');
}
