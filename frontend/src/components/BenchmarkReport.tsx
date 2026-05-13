import { useEffect, useMemo, useState } from 'react';
import { fmtNumber, fmtTime, fmtDateTime, shorten } from '../lib/format';
import { useSort, SortTh } from '../lib/useSort';
import Pill from './Pill';
import { agentColor } from '../lib/agentColor';
import { Run, postJson } from '../lib/api';
import { useLiveProgress } from '../lib/useLiveProgress';

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
  sessionToAgent: Record<string, string>;
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

export default function BenchmarkReport({
  requests,
  sessionToAgent,
  health,
  runs = [],
  selectedRunId = 'current',
  onSelectRun,
  onArchive,
  liveSessions = [],
  showAll = false,
  onToggleShowAll,
}: Props) {
  const [view, setView] = useState<'chrono' | 'agent'>('chrono');
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

  const rows = useMemo(() => {
    const sorted = [...(requests || [])].sort((a, b) => a.ts - b.ts);
    const out = sorted.map((r, i) => {
      const cacheHit = !!r.raw?.session_cache_hit;
      const cachedTokens = r.raw?.cached_tokens ?? 0;
      const cacheLabel = cacheHit || cachedTokens > 0 ? 'WARM' : 'COLD';
      const agent = (r.session_id && sessionToAgent[r.session_id]) || (r.session_id || '-');
      const acc = acceptPctParts(r);
      return {
        n: i + 1,
        ts: r.ts,
        cache: cacheLabel,
        agent,
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
      };
    });
    return out;
  }, [requests, sessionToAgent]);

  // Synthesize a "running" row per in-flight session so the user can watch it
  // tick in real time. The wall depends on Date.now() so it must recompute on
  // each render — `tick` is included as a dep so the 1Hz timer above
  // invalidates this memo. Live progress fields (decode_tok_s, completion_tokens,
  // ttft_s) come from the SSE tap on /v1/chat/completions when available.
  const liveRows = useMemo(() => {
    const now = Date.now();
    return (liveSessions || []).map((s, i) => {
      const startMs = s.in_flight_started_s ? s.in_flight_started_s * 1000 : now;
      const elapsedS = (now - startMs) / 1000;
      const cacheLabel =
        s.last_cache_miss_reason && s.last_cache_miss_reason !== 'hit' ? 'COLD' : 'WARM';
      const agent = (s.session_id && sessionToAgent[s.session_id]) || (s.session_id || '-');
      const prog = liveProgress[s.session_id];
      return {
        n: `▶${i + 1}`,
        ts: startMs,
        cache: cacheLabel,
        agent,
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
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSessions, sessionToAgent, liveProgress, tick]);

  const grouped = useMemo(() => {
    if (view !== 'agent') return null;
    const all = [...liveRows, ...rows];
    const map = new Map<string, typeof rows>();
    for (const r of all) {
      const k = r.agent || '-';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [view, rows, liveRows]);

  const sortAcc = {
    n: (r: any) => r.n,
    when: (r: any) => r.ts,
    cache: (r: any) => r.cache,
    agent: (r: any) => r.agent,
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
  const { sorted, sort, onSort } = useSort<any>(rows, { key: 'n', dir: 'desc' }, sortAcc);

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
        <button className={`btn ${view === 'agent' ? 'on' : ''}`} onClick={() => setView('agent')}>group by agent</button>
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
          <thead>
            <tr>
              <SortTh label="#"      sortKey="n"      state={sort} onSort={onSort} align="right" />
              <SortTh label="when"   sortKey="when"   state={sort} onSort={onSort} />
              <SortTh label="cache"  sortKey="cache"  state={sort} onSort={onSort} />
              <SortTh label="agent"   sortKey="agent"   state={sort} onSort={onSort} />
              <SortTh label="session" sortKey="session" state={sort} onSort={onSort} />
              <SortTh label="prompt" sortKey="prompt" state={sort} onSort={onSort} align="right" />
              <SortTh label="cached" sortKey="cached" state={sort} onSort={onSort} align="right" />
              <SortTh label="ctx"    sortKey="ctx"    state={sort} onSort={onSort} align="right" />
              <SortTh label="ttft"   sortKey="ttft"   state={sort} onSort={onSort} align="right" />
              <SortTh label="decode" sortKey="decode" state={sort} onSort={onSort} align="right" />
              <SortTh label="out"    sortKey="out"    state={sort} onSort={onSort} align="right" />
              <SortTh label="wall"   sortKey="wall"   state={sort} onSort={onSort} align="right" />
              <th>D1/D2/D3</th>
              <SortTh label="avg accept" sortKey="avg" state={sort} onSort={onSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {view === 'chrono' && liveRows.map((r: any) => <BenchRow key={`live-${r.sessionId}-${r.ts}`} r={r} />)}
            {view === 'chrono' && sorted.length === 0 && liveRows.length === 0 ? (
              <tr><td colSpan={14} className="dim">no turns recorded yet</td></tr>
            ) : null}
            {view === 'chrono' && sorted.map((r: any) => <BenchRow key={r.n} r={r} />)}
            {view === 'agent' && grouped && grouped.flatMap(([k, arr]) => {
              const c = agentColor(k);
              return [
                <tr key={`g-${k}`} className="bench-group">
                  <td colSpan={14} style={{ borderLeft: `3px solid ${c.borderColor}` }}>
                    <span className="pill-x pill-x-tag" style={{ ...c, marginRight: 10 }}>{k}</span>
                    {arr.length} turns · avg decode {fmtNumber(arr.reduce((a,b)=>a+(b.decode||0),0)/arr.length)} tok/s · avg accept {(() => {
                      const v = arr.map(x=>x.d_avg).filter((x): x is number => x != null);
                      return v.length ? `${Math.round(v.reduce((a,b)=>a+b,0)/v.length)}%` : '-';
                    })()}
                  </td>
                </tr>,
                ...arr.map((r) => <BenchRow key={`${k}-${r.n}`} r={r} />),
              ];
            })}
            {view === 'agent' && (!grouped || grouped.length === 0) ? (
              <tr><td colSpan={14} className="dim">no turns recorded yet</td></tr>
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
      <td className="num dim">{r.n}</td>
      <td>
        {r.running ? (
          <span className="bench-live-pill">
            <span className="bench-live-dot" />
            LIVE
          </span>
        ) : fmtTime(r.ts)}
      </td>
      <td><Pill tone={r.cache === 'WARM' ? 'warm' : 'cold'}>{r.cache}</Pill></td>
      <td>
        <span className="pill-x pill-x-tag" style={agentColor(r.agent)}>
          {shorten(r.agent, 20)}
        </span>
      </td>
      <td className="dim" title={r.sessionId}>{shorten(r.sessionId || '-', 18)}</td>
      <td className="num">{r.prompt ?? '-'}</td>
      <td className="num">{r.cached || '-'}</td>
      <td className="num">{r.ctx ? shortBytes(r.ctx) : '-'}</td>
      <td className="num">{r.ttft != null ? `${fmtNumber(r.ttft, 2)}s` : (r.running ? '…' : '-')}</td>
      <td className="num">{r.decode != null ? fmtNumber(r.decode) : (r.running ? '…' : '-')}</td>
      <td className="num">{r.out != null ? r.out : (r.running ? '…' : '-')}</td>
      <td className="num">{r.wall != null ? `${fmtNumber(r.wall, 1)}s` : '-'}</td>
      <td>{r.d_parts.length ? r.d_parts.join(' / ') : (r.running ? '…' : '-')}</td>
      <td className="num">{r.d_avg != null ? `${Math.round(r.d_avg)}%` : (r.running ? '…' : '-')}</td>
    </tr>
  );
}
