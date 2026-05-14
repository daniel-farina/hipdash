import { useEffect, useMemo, useState } from 'react';
import { fmtNumber, fmtTime, fmtDateTime, fmtDuration, shorten, shortenSessionId } from '../lib/format';
import { useSort, SortTh } from '../lib/useSort';
import Pill from './Pill';
import { agentColor } from '../lib/agentColor';
import { toolColor } from '../lib/toolColor';
import { Run, postJson, getJson } from '../lib/api';
import { useLiveProgress } from '../lib/useLiveProgress';
import { usePoll } from '../lib/usePoll';
import SessionChart from './SessionChart';

type RawRequest = {
  id: number;
  ts: number;
  session_id: string | null;
  mode: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  decode_tok_s: number | null;
  prefill_tok_s: number | null;
  ttft_s: number | null;
  wall_s: number | null;
  raw: any;
};

type Props = {
  requests: RawRequest[];
  health: any;
  runs?: Run[];
  selectedRunId?: number | 'current' | 'all';
  onSelectRun?: (id: number | 'current' | 'all') => void;
  onArchive?: () => void;
  liveSessions?: any[];
  showAll?: boolean;
  onToggleShowAll?: () => void;
};

function acceptPctParts(r: RawRequest): { d: string[]; avg: number | null } {
  const arr: number[] = r.raw?.accepted_by_depth || [];
  const verify = r.raw?.verify_calls || 0;
  if (!arr.length || !verify) return { d: [], avg: null };
  const pcts = arr.map((n) => Math.round((n / verify) * 100));
  const avg = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
  return { d: pcts.map((p) => `${p}%`), avg };
}

function shortBytes(n: number | null | undefined): string {
  if (!n) return '-';
  if (n >= 1024) return `${(n / 1024).toFixed(1)}K`;
  return String(n);
}

// Nearest-timestamp sample lookup. Samples must be sorted by ts asc.
function sampleAt(samples: { ts: number; value: number }[] | undefined, ts: number): number | null {
  if (!samples || !samples.length) return null;
  let lo = 0, hi = samples.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (samples[m].ts < ts) lo = m + 1; else hi = m - 1;
  }
  const a = samples[hi], b = samples[lo];
  if (!a) return b ? b.value : null;
  if (!b) return a.value;
  return Math.abs(a.ts - ts) < Math.abs(b.ts - ts) ? a.value : b.value;
}

export default function BenchmarkReport({
  requests,
  health,
  runs = [],
  selectedRunId = 'current',
  onSelectRun,
  onArchive,
  liveSessions = [],
  showAll = false,
  onToggleShowAll,
}: Props) {
  const [view, setView] = useState<'chrono' | 'session'>('session');
  const [archiving, setArchiving] = useState(false);
  // Tick once a second so the live elapsed timer keeps incrementing even if
  // the parent hasn't polled /admin/sessions in the last second.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!liveSessions.length) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [liveSessions.length]);
  const liveProgress = useLiveProgress();

  // Hip session map gives us per-turn tool usage when the session_id is
  // tracked by hip's session store. Poll slow — hip writes don't move often.
  const { data: hipById } = usePoll<Record<string, any>>(
    () => getJson('/api/hip/by-id'),
    20000,
  );

  // System samples (CPU/mem/cache) over the full benchmark window. We poll
  // bucketed history so the payload stays compact, then nearest-sample each
  // turn timestamp on the client to overlay them on the per-session chart.
  const { data: sysMetrics } = usePoll<{
    since: number;
    until: number;
    series: Record<string, { ts: number; value: number }[]>;
  }>(
    () =>
      getJson(
        `/api/history/metrics?series=cpu_used_pct,mem_used_bytes,cache_bytes,thermal_throttle_pct,cpu_temp_c,gpu_temp_c,sys_power_w,all_power_w&range_ms=${14 * 24 * 60 * 60 * 1000}&max_points=2000`,
      ),
    10000,
  );

  // Live "right now" snapshot from macmon — used for the per-panel `now`
  // readout so it ticks with reality even when the session being viewed is
  // historical.
  const { data: sysNow } = usePoll<{ macmon: any; status: any }>(
    () => getJson('/api/system/now'),
    3000,
  );
  const liveNow = useMemo(() => {
    const m = sysNow?.macmon;
    if (!m) return null;
    return {
      cpu_temp_c: m.temp?.cpu_temp_avg,
      gpu_temp_c: m.temp?.gpu_temp_avg,
      sys_power_w: m.sys_power,
      all_power_w: m.all_power,
    };
  }, [sysNow]);

  const rows = useMemo(() => {
    const sorted = [...(requests || [])].sort((a, b) => a.ts - b.ts);
    const built = sorted.map((r, i) => {
      const cacheHit = !!r.raw?.session_cache_hit;
      const cachedTokens = r.raw?.cached_tokens ?? 0;
      const cacheLabel = cacheHit || cachedTokens > 0 ? 'WARM' : 'COLD';
      const acc = acceptPctParts(r);
      return {
        n: i + 1,
        ts: r.ts,
        cache: cacheLabel,
        sessionId: r.session_id || '-',
        prompt: r.prompt_tokens,
        cached: cachedTokens,
        ctx: r.raw?.context_len ?? null,
        ttft: r.ttft_s,
        decode: r.decode_tok_s,
        out: r.completion_tokens,
        wall: r.wall_s,
        d_parts: acc.d,
        d_avg: acc.avg,
        mode: r.mode,
        depth: r.raw?.mtp_depth ?? null,
        running: false,
        tools: undefined as string[] | undefined,
      };
    });

    // Magnitude reference for the in/out bar — every row scales against the
    // largest (prompt+out) in the table so a turn's bar width tells you how
    // big it was relative to the heaviest one in scope.
    const maxTotal = Math.max(1, ...built.map((r) => (r.prompt || 0) + (r.out || 0)));
    for (const r of built) (r as any).maxTotal = maxTotal;

    // Attach hip tool_calls per row. Group rows by session, sort asc, then
    // align hip's K turns to the LAST K rows of each session (because the
    // conv is post-compact).
    if (hipById) {
      const bySession = new Map<string, typeof built>();
      for (const r of built) {
        if (!bySession.has(r.sessionId)) bySession.set(r.sessionId, []);
        bySession.get(r.sessionId)!.push(r);
      }
      for (const [sid, list] of bySession) {
        const tools: string[][] | undefined = hipById[sid]?.turn_tools;
        if (!tools?.length) continue;
        list.sort((a, b) => a.ts - b.ts);
        const offset = Math.max(0, list.length - tools.length);
        list.forEach((r, i) => {
          const idx = i - offset;
          if (idx >= 0 && idx < tools.length) {
            const t = tools[idx];
            if (t && t.length) r.tools = t;
          }
        });
      }
    }

    return built;
  }, [requests, hipById]);

  // Synthesize a "running" row per in-flight session so the user can watch it
  // tick in real time. The wall depends on Date.now() so it must recompute on
  // each render — `tick` is included as a dep so the 1Hz timer above
  // invalidates this memo. Live progress fields (decode_tok_s, completion_tokens,
  // ttft_s) come from the SSE tap on /v1/chat/completions when available.
  const liveRows = useMemo(() => {
    const now = Date.now();
    // Same magnitude reference as completed rows so live bars line up.
    const completedMax = Math.max(1, ...rows.map((r: any) => (r.prompt || 0) + (r.out || 0)));
    return (liveSessions || []).map((s, i) => {
      const startMs = s.in_flight_started_s ? s.in_flight_started_s * 1000 : now;
      const elapsedS = (now - startMs) / 1000;
      const cacheLabel =
        s.last_cache_miss_reason && s.last_cache_miss_reason !== 'hit' ? 'COLD' : 'WARM';
      const prog = liveProgress[s.session_id];
      return {
        n: `▶${i + 1}`,
        ts: startMs,
        cache: cacheLabel,
        sessionId: s.session_id || '-',
        prompt: s.prefix_len ?? null,
        cached: 0,
        ctx: s.prefix_len ?? null,
        ttft: prog?.ttft_s ?? null,
        decode: prog?.decode_tok_s ?? null,
        out: prog?.completion_tokens ?? null,
        wall: elapsedS,
        d_parts: [],
        d_avg: null,
        mode: prog?.mode ?? null,
        depth: prog?.mtp_depth ?? null,
        running: true,
        progressTs: prog?.ts ?? null,
        maxTotal: completedMax,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSessions, liveProgress, tick, rows]);

  const groupedBySession = useMemo(() => {
    if (view !== 'session') return null;
    const all = [...liveRows, ...rows];
    const map = new Map<string, typeof rows>();
    for (const r of all) {
      const k = r.sessionId || '-';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    const enriched = [...map.entries()].map(([sid, arr]) => {
      const wallSum = arr.reduce((a, b) => a + (b.wall || 0), 0);
      const decodeAvg = arr.length ? arr.reduce((a, b) => a + (b.decode || 0), 0) / arr.length : 0;
      const promptSum = arr.reduce((a, b) => a + (b.prompt || 0), 0);
      const outSum = arr.reduce((a, b) => a + (b.out || 0), 0);
      const startTs = Math.min(...arr.map((r) => r.ts));
      const endTs = Math.max(...arr.map((r) => r.ts));
      const spanS = (endTs - startTs) / 1000;
      const acceptVals = arr.map((r) => r.d_avg).filter((v): v is number => v != null);
      const acceptAvg = acceptVals.length ? acceptVals.reduce((a, b) => a + b, 0) / acceptVals.length : null;
      const hasLive = arr.some((r) => r.running);
      return { sid, rows: arr, turns: arr.length, wallSum, decodeAvg, promptSum, outSum, startTs, endTs, spanS, acceptAvg, hasLive };
    });
    // Live sessions pin to the top; otherwise sort by most-recent activity desc
    return enriched.sort((a, b) => {
      if (a.hasLive !== b.hasLive) return a.hasLive ? -1 : 1;
      return b.endTs - a.endTs;
    });
  }, [view, rows, liveRows]);

  const sortAcc = {
    n: (r: any) => r.n,
    when: (r: any) => r.ts,
    cache: (r: any) => r.cache,
    session: (r: any) => r.sessionId,
    prompt: (r: any) => r.prompt ?? 0,
    cached: (r: any) => r.cached ?? 0,
    ctx: (r: any) => r.ctx ?? 0,
    ttft: (r: any) => r.ttft ?? 0,
    decode: (r: any) => r.decode ?? 0,
    out: (r: any) => r.out ?? 0,
    wall: (r: any) => r.wall ?? 0,
    avg: (r: any) => r.d_avg ?? 0,
  };
  const { sorted, sort, onSort } = useSort<any>(rows, { key: 'when', dir: 'desc' }, sortAcc);

  const profile = health?.profile?.name || '-';
  const ctx = health?.context_window;
  const depth = health?.depth;

  return (
    <div className="bench">
      <div className="bench-meta">
        <div><span className="lab">HARDWARE</span><span>Apple Silicon · macOS</span></div>
        <div><span className="lab">MODEL</span><span>{shorten(health?.model || '-', 32)}</span></div>
        <div><span className="lab">PROFILE</span><span>{profile}</span></div>
        <div><span className="lab">CONTEXT</span><span>{ctx ? `${(ctx / 1024).toFixed(0)}K` : '-'}</span></div>
        <div><span className="lab">MTP DEPTH</span><span>{depth ? `${depth} (D${depth})` : '-'}</span></div>
      </div>

      {runs.length > 0 ? (
        <div className="bench-runs">
          <span className="lab">RUN:</span>
          <button
            className={`btn ${selectedRunId === 'current' ? 'on' : ''}`}
            onClick={() => onSelectRun?.('current')}
            title="Latest MTPLX run (since most recent restart)"
          >
            current
            {(() => {
              const cur = runs.find((r) => r.is_current);
              return cur ? <small className="run-meta"> · {cur.request_count} turns</small> : null;
            })()}
          </button>
          {runs
            .filter((r) => !r.is_current)
            .slice(0, 8)
            .map((r) => (
              <button
                key={r.run_id}
                className={`btn ${selectedRunId === r.run_id ? 'on' : ''}`}
                onClick={() => onSelectRun?.(r.run_id)}
                title={`#${r.run_id} · started ${fmtDateTime(r.start_ts)}${r.end_ts ? ` · ended ${fmtDateTime(r.end_ts)}` : ''}`}
              >
                #{r.run_id}
                <small className="run-meta"> · {fmtTime(r.start_ts)} · {r.request_count}t</small>
              </button>
            ))}
          {runs.length > 9 ? <span className="muted" style={{ marginLeft: 6, fontFamily: 'var(--mono)', fontSize: 10 }}>+ {runs.length - 9} older</span> : null}
          <button
            className={`btn ${selectedRunId === 'all' ? 'on' : ''}`}
            onClick={() => onSelectRun?.('all')}
            style={{ marginLeft: 'auto' }}
            title="All persisted turns (14d retention window), regardless of run"
          >
            all
          </button>
          <button
            className="btn danger"
            disabled={archiving}
            title="Close the current run and start a new empty one. Archived turns stay in history."
            onClick={async () => {
              const cur = runs.find((r) => r.is_current);
              const ct = cur?.request_count ?? 0;
              if (!confirm(`Archive current run with ${ct} turn(s)? The benchmark will start fresh.`)) return;
              setArchiving(true);
              try {
                await postJson('/api/runs/archive', { target: 'mtplx' });
                onSelectRun?.('current');
                onArchive?.();
              } finally {
                setArchiving(false);
              }
            }}
          >
            {archiving ? 'archiving…' : 'archive run'}
          </button>
        </div>
      ) : null}

      <div className="bench-toolbar">
        <span className="lab">VIEW:</span>
        <button className={`btn ${view === 'chrono' ? 'on' : ''}`} onClick={() => setView('chrono')}>chronological</button>
        <button className={`btn ${view === 'session' ? 'on' : ''}`} onClick={() => setView('session')}>group by session</button>
        {onToggleShowAll ? (
          <button
            className={`btn ${showAll ? 'on' : ''}`}
            onClick={onToggleShowAll}
            title={showAll ? 'Showing every persisted turn in scope' : 'Showing only the most recent 1000 turns'}
            style={{ marginLeft: 8 }}
          >
            {showAll ? 'show last 1k' : 'show all'}
          </button>
        ) : null}
        <span className="bench-count">
          {rows.length} turns{!showAll && rows.length >= 1000 ? ' (latest 1k)' : ''}
        </span>
      </div>

      <div className="scroll-x">
        <table className="tbl bench-tbl">
          {view === 'chrono' ? (
            <thead>
              <HeaderRow sort={sort} onSort={onSort} />
            </thead>
          ) : null}
          <tbody>
            {view === 'chrono' && liveRows.map((r: any) => <BenchRow key={`live-${r.sessionId}-${r.ts}`} r={r} />)}
            {view === 'chrono' && sorted.length === 0 && liveRows.length === 0 ? (
              <tr><td colSpan={12} className="dim">no turns recorded yet</td></tr>
            ) : null}
            {view === 'chrono' && sorted.map((r: any) => <BenchRow key={r.n} r={r} />)}
            {view === 'session' && groupedBySession && groupedBySession.flatMap((g) => {
              const c = agentColor(g.sid);
              return [
                <tr key={`s-${g.sid}`} className="bench-group session-group-head">
                  <td colSpan={12} style={{ borderLeft: `3px solid ${c.borderColor}` }}>
                    <span className="pill-x pill-x-tag" style={{ ...c, marginRight: 10 }} title={g.sid}>
                      {shortenSessionId(g.sid, 28)}
                    </span>
                    {g.hasLive ? <Pill tone="good" style={{ marginRight: 8 }}>live</Pill> : null}
                    <b>{fmtDuration(g.wallSum)}</b> total
                    <span className="muted"> · {g.turns} turn{g.turns === 1 ? '' : 's'}</span>
                    <span className="muted"> · {g.spanS > 1 ? `span ${fmtDuration(g.spanS)}` : ''}</span>
                    <span className="muted"> · avg decode {fmtNumber(g.decodeAvg)} tok/s</span>
                    <span className="muted"> · in {g.promptSum.toLocaleString()} tok</span>
                    <span className="muted"> · out {g.outSum.toLocaleString()} tok</span>
                    {g.acceptAvg != null ? (
                      <span className="muted"> · avg accept {Math.round(g.acceptAvg)}%</span>
                    ) : null}
                    {(() => {
                      const hip = hipById?.[g.sid];
                      if (!hip?.turn_tools) return null;
                      const total = hip.turn_tools.reduce((a: number, t: string[]) => a + (t?.length || 0), 0);
                      if (!total) return null;
                      const allNames = hip.turn_tools.flat() as string[];
                      const counts: Record<string, number> = {};
                      for (const n of allNames) counts[n] = (counts[n] || 0) + 1;
                      const top = Object.entries(counts).sort((a: any, b: any) => b[1] - a[1]).slice(0, 4);
                      return (
                        <span className="muted" style={{ marginLeft: 8 }}>
                          ·{' '}
                          <span style={{ color: '#6fd6e0' }}>{total} tool calls</span>
                          {top.length ? ` (${top.map(([k, v]) => `${k}·${v}`).join(' ')})` : ''}
                        </span>
                      );
                    })()}
                  </td>
                </tr>,
                <tr key={`s-${g.sid}-chart`} className="session-group-chart">
                  <td colSpan={12} style={{ borderLeft: `3px solid ${c.borderColor}`, padding: '4px 12px 8px' }}>
                    <SessionChart
                      rows={g.rows}
                      turnTools={hipById?.[g.sid]?.turn_tools}
                      cpuPerTurn={g.rows.map((r) => sampleAt(sysMetrics?.series?.cpu_used_pct, r.ts))}
                      memPerTurn={g.rows.map((r) => sampleAt(sysMetrics?.series?.mem_used_bytes, r.ts))}
                      cachePerTurn={g.rows.map((r) => sampleAt(sysMetrics?.series?.cache_bytes, r.ts))}
                      thermalPerTurn={g.rows.map((r) => {
                        // Prefer real CPU temperature when available; fall
                        // back to throttle %. Real temp in °C, throttle in %.
                        const t = sampleAt(sysMetrics?.series?.cpu_temp_c, r.ts);
                        if (t != null && t > 0) return t;
                        return sampleAt(sysMetrics?.series?.thermal_throttle_pct, r.ts);
                      })}
                      thermalUnit={sysMetrics?.series?.cpu_temp_c?.length ? '°C' : '%'}
                      gpuTempPerTurn={g.rows.map((r) => sampleAt(sysMetrics?.series?.gpu_temp_c, r.ts))}
                      powerPerTurn={g.rows.map((r) =>
                        sampleAt(sysMetrics?.series?.sys_power_w, r.ts)
                        ?? sampleAt(sysMetrics?.series?.all_power_w, r.ts),
                      )}
                      liveNow={liveNow}
                      height={100}
                    />
                    <div className="session-chart-legend">
                      <span><i style={{ background: 'rgba(132,169,255,0.55)' }} />in tok</span>
                      <span><i style={{ background: 'rgba(126,217,87,0.80)' }} />out tok</span>
                      <span><i style={{ background: '#c986ff' }} />context</span>
                      <span><i style={{ background: '#f4c95d' }} />decode tok/s</span>
                      {hipById?.[g.sid]?.turn_tools ? (
                        <span><i style={{ background: '#6fd6e0' }} />tool calls</span>
                      ) : null}
                      <span className="dim" style={{ marginLeft: 'auto' }}>sub-panels: cpu · mem · kv cache</span>
                    </div>
                  </td>
                </tr>,
                <tr key={`s-${g.sid}-hdr`} className="session-group-headers">
                  <HeaderRowCells sort={sort} onSort={onSort} />
                </tr>,
                ...g.rows
                  .slice()
                  .sort((a, b) => b.ts - a.ts)
                  .map((r) => <BenchRow key={`${g.sid}-${r.n}`} r={r} />),
              ];
            })}
            {view === 'session' && (!groupedBySession || groupedBySession.length === 0) ? (
              <tr><td colSpan={12} className="dim">no turns recorded yet</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BenchRow({ r }: { r: any }) {
  return (
    <tr className={r.running ? 'bench-running' : undefined}>
      <td>
        {r.running ? (
          <span className="bench-live-pill">
            <span className="bench-live-dot" />
            LIVE
          </span>
        ) : fmtTime(r.ts)}
      </td>
      <td><Pill tone={r.cache === 'WARM' ? 'warm' : 'cold'}>{r.cache}</Pill></td>
      <td title={r.sessionId}>
        <span className="pill-x pill-x-tag" style={agentColor(r.sessionId)}>
          {shortenSessionId(r.sessionId)}
        </span>
      </td>
      <td>
        {Array.isArray(r.tools) && r.tools.length ? (
          <ToolsCell tools={r.tools} />
        ) : (
          <span className="dim">-</span>
        )}
      </td>
      <td><IoBar inTok={r.prompt || 0} outTok={r.out || 0} maxTotal={r.maxTotal || 1} running={r.running} /></td>
      <td className="num">{r.cached || '-'}</td>
      <td className="num">{r.ctx ? shortBytes(r.ctx) : '-'}</td>
      <td className="num">{r.ttft != null ? `${fmtNumber(r.ttft, 2)}s` : (r.running ? '…' : '-')}</td>
      <td className="num">{r.decode != null ? fmtNumber(r.decode) : (r.running ? '…' : '-')}</td>
      <td className="num">{r.wall != null ? `${fmtNumber(r.wall, 1)}s` : '-'}</td>
      <td>{r.d_parts.length ? r.d_parts.join(' / ') : (r.running ? '…' : '-')}</td>
      <td className="num">{r.d_avg != null ? `${Math.round(r.d_avg)}%` : (r.running ? '…' : '-')}</td>
    </tr>
  );
}

type SortObj = { key: string | null; dir: 'asc' | 'desc' };

function HeaderRowCells({ sort, onSort }: { sort: SortObj; onSort: (k: string) => void }) {
  return (
    <>
      <SortTh label="when"    sortKey="when"    state={sort} onSort={onSort} />
      <SortTh label="cache"   sortKey="cache"   state={sort} onSort={onSort} />
      <SortTh label="session" sortKey="session" state={sort} onSort={onSort} />
      <th>tools</th>
      <th style={{ width: 140 }}>io</th>
      <SortTh label="cached"  sortKey="cached"  state={sort} onSort={onSort} align="right" />
      <SortTh label="ctx"     sortKey="ctx"     state={sort} onSort={onSort} align="right" />
      <SortTh label="ttft"    sortKey="ttft"    state={sort} onSort={onSort} align="right" />
      <SortTh label="decode"  sortKey="decode"  state={sort} onSort={onSort} align="right" />
      <SortTh label="wall"    sortKey="wall"    state={sort} onSort={onSort} align="right" />
      <th>D1/D2/D3</th>
      <SortTh label="avg accept" sortKey="avg"  state={sort} onSort={onSort} align="right" />
    </>
  );
}

function HeaderRow({ sort, onSort }: { sort: SortObj; onSort: (k: string) => void }) {
  return (
    <tr>
      <HeaderRowCells sort={sort} onSort={onSort} />
    </tr>
  );
}

function IoBar({ inTok, outTok, maxTotal, running }: { inTok: number; outTok: number; maxTotal: number; running?: boolean }) {
  if (inTok === 0 && outTok === 0 && !running) return <span className="dim">-</span>;
  const inPct  = Math.min(100, (inTok  / Math.max(1, maxTotal)) * 100);
  const outPct = Math.min(100, (outTok / Math.max(1, maxTotal)) * 100);
  return (
    <span
      className="io-bar"
      title={`in ${inTok.toLocaleString()} · out ${outTok.toLocaleString()}`}
    >
      <span className="io-row io-row-in">
        <span className="io-label">in</span>
        <span className="io-track">
          <span className="io-fill io-in" style={{ width: `${inPct}%` }} />
        </span>
        <span className="io-num">{inTok > 0 ? inTok.toLocaleString() : (running ? '…' : '0')}</span>
      </span>
      <span className="io-row io-row-out">
        <span className="io-label">out</span>
        <span className="io-track">
          <span className="io-fill io-out" style={{ width: `${outPct}%` }} />
        </span>
        <span className="io-num">{outTok > 0 ? outTok.toLocaleString() : (running ? '…' : '0')}</span>
      </span>
    </span>
  );
}

function ToolsCell({ tools }: { tools: string[] }) {
  // Collapse repeats: if the same tool is invoked multiple times in one turn,
  // show "read·3" rather than three identical pills.
  const counts: Record<string, number> = {};
  for (const t of tools) counts[t] = (counts[t] || 0) + 1;
  const entries = Object.entries(counts);
  const shown = entries.slice(0, 4);
  const extra = entries.length - shown.length;
  return (
    <span className="bench-tools">
      {shown.map(([name, n]) => (
        <span key={name} className="pill-x pill-x-tag bench-tool-pill" style={toolColor(name)} title={`${name} × ${n}`}>
          {name}{n > 1 ? <small>·{n}</small> : null}
        </span>
      ))}
      {extra > 0 ? <span className="bench-tools-more">+{extra}</span> : null}
    </span>
  );
}
