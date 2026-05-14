import { useState } from 'react';
import { usePoll } from '../lib/usePoll';
import { getJson, postJson, MetricPoint, Status, Run } from '../lib/api';
import { fmtBytes, fmtNumber, shorten, shortenSessionId } from '../lib/format';
import { useSort, SortTh } from '../lib/useSort';
import LineChart from '../components/LineChart';
import LiveGeneration from '../components/LiveGeneration';
import BenchmarkReport from '../components/BenchmarkReport';
import Pill, { modeTone, cacheTone } from '../components/Pill';
import SessionBankChart from '../components/SessionBankChart';
import SessionBankHistory from '../components/SessionBankHistory';
import MetricChart from '../components/MetricChart';
import HipSidecar from '../components/HipSidecar';
import TokensSavingsChart from '../components/TokensSavingsChart';
import DraggableGrid from '../components/DraggableGrid';
import { useLayoutOrder } from '../lib/useLayoutOrder';

type MetricsResp = { since: number; series: Record<string, MetricPoint[]> };
type BenchRequest = {
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

export default function MtplxPage() {
  const { data: metrics } = usePoll<any>(() => getJson('/metrics'), 1500);
  const { data: sessionsResp } = usePoll<any>(() => getJson('/admin/sessions'), 2000);
  const { data: status } = usePoll<Status>(() => getJson('/api/status'), 3000);
  const { data: hist } = usePoll<MetricsResp>(
    () =>
      getJson(
        '/api/history/metrics?range_ms=900000&series=decode_tok_s,prefill_tok_s',
      ),
    5000,
  );
  const { data: runsResp, refresh: refreshRuns } = usePoll<{ runs: Run[] }>(() => getJson('/api/runs?target=mtplx'), 8000);
  const [selectedRunId, setSelectedRunId] = useState<number | 'current' | 'all'>('current');
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<'bench' | 'live' | 'bank' | 'sessions' | 'hip'>('bench');
  const [showAll, setShowAll] = useState(false);

  const runs = runsResp?.runs || [];
  const currentRun = runs.find((r) => r.is_current) || null;

  const activeRun = (() => {
    if (selectedRunId === 'all') return null;
    if (selectedRunId === 'current') return currentRun;
    return runs.find((r) => r.run_id === selectedRunId) || currentRun;
  })();

  // Default to the last 1000 turns (ts DESC) for snappy rendering. User can
  // toggle "show all" to load everything within the scope.
  const limit = showAll ? 100000 : 1000;
  const requestsQuery = activeRun
    ? `/api/history/requests?since_ts=${activeRun.start_ts}${activeRun.end_ts ? `&until_ts=${activeRun.end_ts}` : ''}&limit=${limit}`
    : `/api/history/requests?range_ms=${14 * 24 * 60 * 60 * 1000}&limit=${limit}`;

  const { data: requestsResp } = usePoll<{ requests: BenchRequest[] }>(
    () => getJson(requestsQuery),
    6000,
    [requestsQuery],
  );

  const latest = metrics?.latest || {};
  const recent: any[] = metrics?.recent || [];
  const sessions: any[] = sessionsResp?.sessions || [];
  const bank = sessionsResp?.session_bank || {};

  const throughput = [
    {
      label: 'decode',
      color: '#7ed957',
      width: 1.8,
      data: (hist?.series['decode_tok_s'] || []).map((p) => ({ ts: p.ts, value: p.value })),
    },
    {
      label: 'prefill',
      color: '#84a9ff',
      width: 1.2,
      data: (hist?.series['prefill_tok_s'] || []).map((p) => ({ ts: p.ts, value: p.value })),
    },
  ];


  return (
    <>
      <div className="section">
        <LiveGeneration metrics={metrics} sessions={sessionsResp} health={status?.last_health} />
      </div>

      <div className="row mtplx-quad">
        <div className="card">
          <div className="label">Latest request</div>
          <div className="big">
            {fmtNumber(latest.decode_tok_s)}<small>tok/s decode</small>
          </div>
          <div className="kpi">
            <span>prefill <b>{fmtNumber(latest.prefill_tok_s)}</b> tok/s</span>
            <span>TTFT <b>{fmtNumber(latest.ttft_s, 2)}</b>s</span>
            <span>wall <b>{fmtNumber(latest.wall_s, 2)}</b>s</span>
            <span>mode <b>{(latest.mode || latest.runtime_mode || '-').toString().toUpperCase()}</b></span>
          </div>
        </div>
        <div className="card">
          <div className="label">Session bank</div>
          <div className="big">
            {fmtBytes(bank.total_nbytes)}<small>/ {fmtBytes(bank.max_bytes)}</small>
          </div>
          <div className="bar">
            <i style={{ width: `${Math.min(100, ((bank.total_nbytes || 0) / (bank.max_bytes || 1)) * 100)}%` }} />
          </div>
          <div className="kpi">
            <span>entries <b>{bank.entries ?? '-'}</b> / {bank.max_entries ?? '-'}</span>
            <span>evict <b>{(bank.eviction_log?.length) ?? 0}</b></span>
            <span>ttl <b>{bank.idle_ttl_s ?? '-'}</b>s</span>
          </div>
          {bank.last_miss_reason ? (
            <div className="kpi" style={{ marginTop: 4 }}>
              <Pill tone={cacheTone(bank.last_miss_reason)}>{bank.last_miss_reason}</Pill>
            </div>
          ) : null}
          <div style={{ marginTop: 6 }}>
            <button
              className="btn danger"
              disabled={busy}
              onClick={async () => {
                if (!confirm('Clear MTPLX cache?')) return;
                setBusy(true);
                try { await postJson('/admin/cache/clear'); } finally { setBusy(false); }
              }}
            >
              {busy ? 'clearing…' : 'clear cache'}
            </button>
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-head">
            <h3>Throughput · 15m</h3>
          </div>
          <LineChart series={throughput} height={90} showAxes={false} />
          <div className="legend">
            <span><i style={{ background: '#7ed957' }} />decode</span>
            <span><i style={{ background: '#84a9ff' }} />prefill</span>
          </div>
        </div>
        <SessionBankChart defaultKey="24h" height={110} showAxes={true} />
      </div>

      <div className="section">
        <div className="head">
          <h2>Tokens &amp; savings</h2>
          <span className="right">actual cost on MTPLX vs cloud list price</span>
        </div>
        <TokensSavingsChart />
      </div>

      <MetricsHistorySection />

      {Array.isArray(latest.accepted_by_depth) && latest.accepted_by_depth.length ? (
        <div className="section">
          <div className="head">
            <h2>Acceptance</h2>
            <span className="right">latest request · {latest.verify_calls ?? 0} verify calls</span>
          </div>
          <AcceptanceCard latest={latest} />
        </div>
      ) : null}

      <div className="section">
        <div className="head">
          <div className="tabs">
            <button
              className={`tab ${activeTab === 'bench' ? 'on' : ''}`}
              onClick={() => setActiveTab('bench')}
            >
              Benchmark report
            </button>
            <button
              className={`tab ${activeTab === 'bank' ? 'on' : ''}`}
              onClick={() => setActiveTab('bank')}
            >
              Session bank · history
              <span className="tab-badge">{sessionsResp?.session_bank?.entries ?? 0}</span>
            </button>
            <button
              className={`tab ${activeTab === 'live' ? 'on' : ''}`}
              onClick={() => setActiveTab('live')}
            >
              Live recent buffer
              <span className="tab-badge">{recent?.length ?? 0}</span>
            </button>
            <button
              className={`tab ${activeTab === 'sessions' ? 'on' : ''}`}
              onClick={() => setActiveTab('sessions')}
            >
              Active sessions
              <span className="tab-badge">{sessions.length}</span>
            </button>
            <button
              className={`tab ${activeTab === 'hip' ? 'on' : ''}`}
              onClick={() => setActiveTab('hip')}
            >
              Hip sidecar
            </button>
          </div>
          <span className="right">
            {activeTab === 'bench' ? (
              <>
                {requestsResp?.requests?.length ?? 0} turns
                {!showAll && (requestsResp?.requests?.length ?? 0) >= 1000 ? ' (latest 1k)' : ''} ·{' '}
                {selectedRunId === 'all'
                  ? 'all (14d)'
                  : activeRun
                  ? activeRun.is_current ? 'current run' : `run #${activeRun.run_id}`
                  : 'no runs'}
              </>
            ) : activeTab === 'bank' ? (
              <>{sessionsResp?.session_bank?.eviction_log?.length ?? 0} evictions · {fmtBytes(sessionsResp?.session_bank?.total_nbytes)} live</>
            ) : activeTab === 'sessions' ? (
              <>{sessions.length} session{sessions.length === 1 ? '' : 's'} · {sessions.filter((s: any) => s.in_flight).length} in flight</>
            ) : activeTab === 'hip' ? (
              <>per-round summaries from ~/.hip/sessions.jsonl</>
            ) : (
              <>/metrics buffer · {recent?.length ?? 0}</>
            )}
          </span>
        </div>
        {activeTab === 'bench' ? (
          <BenchmarkReport
            requests={requestsResp?.requests || []}
            health={status?.last_health}
            runs={runs}
            selectedRunId={selectedRunId}
            onSelectRun={setSelectedRunId}
            onArchive={refreshRuns}
            liveSessions={(sessionsResp?.sessions || []).filter((s: any) => s.in_flight)}
            showAll={showAll}
            onToggleShowAll={() => setShowAll((v) => !v)}
          />
        ) : activeTab === 'bank' ? (
          <SessionBankHistory sessions={sessionsResp} />
        ) : activeTab === 'sessions' ? (
          <SessionsTable sessions={sessions} />
        ) : activeTab === 'hip' ? (
          <HipSidecar />
        ) : (
          <RecentBufferTable recent={recent} />
        )}
      </div>

    </>
  );
}

/* ---------- Sortable Active sessions table ---------- */

function SessionsTable({ sessions }: { sessions: any[] }) {
  const { sorted, sort, onSort } = useSort<any>(
    sessions,
    { key: 'last_access_s', dir: 'desc' },
    {
      session_id: (s) => s.session_id || '',
      prefix_len: (s) => s.prefix_len ?? 0,
      boundaries: (s) => (Array.isArray(s.boundaries) ? s.boundaries.length : 0),
      last_access_s: (s) => s.last_access_s ?? 0,
      in_flight: (s) => (s.in_flight ? 1 : 0),
    },
  );
  return (
    <div className="scroll-x">
      <table className="tbl">
        <thead>
          <tr>
            <SortTh label="session id"   sortKey="session_id"     state={sort} onSort={onSort} />
            <SortTh label="prefix tok"   sortKey="prefix_len"     state={sort} onSort={onSort} align="right" />
            <SortTh label="boundaries"   sortKey="boundaries"     state={sort} onSort={onSort} align="right" />
            <SortTh label="last access"  sortKey="last_access_s"  state={sort} onSort={onSort} align="right" />
            <SortTh label="in flight"    sortKey="in_flight"      state={sort} onSort={onSort} />
            <th></th>
          </tr>
        </thead>
          <tbody>
            {sessions.length === 0 ? (
              <tr><td colSpan={6} className="dim">no sessions</td></tr>
            ) : sorted.map((s: any) => (
              <tr key={s.session_id + (s.in_flight_started_s || '')}>
                <td title={s.session_id}>{shortenSessionId(s.session_id, 26)}</td>
                <td className="num">{s.prefix_len ?? '-'}</td>
                <td className="num">{Array.isArray(s.boundaries) ? s.boundaries.length : '-'}</td>
                <td className="num">{s.last_access_s ? new Date(s.last_access_s * 1000).toLocaleTimeString() : '-'}</td>
                <td>{s.in_flight ? <Pill tone="good">in flight</Pill> : <Pill tone="neutral">idle</Pill>}</td>
                <td>
                  <button
                    className="btn"
                    onClick={async () => {
                      if (!confirm(`clear session ${s.session_id}?`)) return;
                      await postJson(`/admin/sessions/${encodeURIComponent(s.session_id)}/clear`);
                    }}
                  >clear</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
  );
}

/* ---------- Sortable Live recent buffer ---------- */

function RecentBufferTable({ recent }: { recent: any[] }) {
  const rows = (recent || []).slice(0, 30);
  const { sorted, sort, onSort } = useSort<any>(
    rows,
    { key: null, dir: 'desc' },
    {
      session: (r) => r.session_id || '',
      mode: (r) => r.generation_mode || r.mode || '',
      depth: (r) => r.mtp_depth ?? 0,
      decode: (r) => r.decode_tok_s ?? 0,
      prefill: (r) => r.prefill_tok_s ?? 0,
      ttft: (r) => r.ttft_s ?? 0,
      wall: (r) => r.request_elapsed_s ?? 0,
      prompt: (r) => r.prompt_tokens ?? 0,
      out: (r) => r.completion_tokens ?? 0,
      cache: (r) => (r.session_cache_hit ? 1 : 0),
    },
  );
  if (!rows.length) return null;
  return (
    <div className="scroll-x">
      <table className="tbl">
          <thead>
            <tr>
              <SortTh label="session" sortKey="session" state={sort} onSort={onSort} />
              <SortTh label="mode"    sortKey="mode"    state={sort} onSort={onSort} />
              <SortTh label="depth"   sortKey="depth"   state={sort} onSort={onSort} align="right" />
              <SortTh label="decode"  sortKey="decode"  state={sort} onSort={onSort} align="right" />
              <SortTh label="prefill" sortKey="prefill" state={sort} onSort={onSort} align="right" />
              <SortTh label="ttft"    sortKey="ttft"    state={sort} onSort={onSort} align="right" />
              <SortTh label="wall"    sortKey="wall"    state={sort} onSort={onSort} align="right" />
              <SortTh label="prompt"  sortKey="prompt"  state={sort} onSort={onSort} align="right" />
              <SortTh label="out"     sortKey="out"     state={sort} onSort={onSort} align="right" />
              <SortTh label="cache"   sortKey="cache"   state={sort} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r: any, i: number) => {
              const mode = (r.generation_mode || r.mode || '').toString();
              const cacheLabel = r.session_cache_hit ? 'hit' : (r.cache_miss_reason || 'miss');
              return (
                <tr key={i}>
                  <td title={r.session_id || ''}>{shortenSessionId(r.session_id)}</td>
                  <td><Pill tone={modeTone(mode)} variant="badge">{(mode || '-').toUpperCase()}</Pill></td>
                  <td className="num">{r.mtp_depth ?? '-'}</td>
                  <td className="num">{fmtNumber(r.decode_tok_s)}</td>
                  <td className="num">{fmtNumber(r.prefill_tok_s)}</td>
                  <td className="num">{fmtNumber(r.ttft_s, 2)}</td>
                  <td className="num">{fmtNumber(r.request_elapsed_s, 2)}</td>
                  <td className="num">{r.prompt_tokens ?? '-'}</td>
                  <td className="num">{r.completion_tokens ?? '-'}</td>
                  <td><Pill tone={cacheTone(cacheLabel)}>{cacheLabel}</Pill></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
  );
}

/* ---------- Acceptance card (D1/D2/D3 bars) ---------- */

function AcceptanceCard({ latest }: { latest: any }) {
  const arr: number[] = latest.accepted_by_depth || [];
  const verify = latest.verify_calls || 0;
  const totalAccepted = arr.reduce((a, b) => a + b, 0);
  const bonus = latest.bonus_tokens ?? 0;
  const corrections = latest.correction_tokens ?? 0;
  const completion = latest.completion_tokens ?? 0;
  const avgPct = verify ? Math.round((totalAccepted / (arr.length * verify)) * 100) : 0;

  return (
    <div className="card">
      <div className="accept-row">
        {arr.map((n, i) => {
          const pct = verify ? (n / verify) * 100 : 0;
          return (
            <div key={i} className="accept-stage">
              <div className="accept-head">
                <span className="accept-label">D{i + 1}</span>
                <span className="accept-count">{n}<small>/{verify}</small></span>
              </div>
              <div className="bar"><i style={{ width: `${Math.min(100, pct)}%` }} /></div>
              <div className="accept-pct">{Math.round(pct)}%</div>
            </div>
          );
        })}
      </div>
      <div className="kpi" style={{ marginTop: 12 }}>
        <span>avg accept <b>{avgPct}%</b></span>
        <span>total accepted <b>{totalAccepted}</b></span>
        <span>bonus tokens <b>{bonus}</b></span>
        <span>corrections <b>{corrections}</b></span>
        <span>completion <b>{completion}</b></span>
        <span>depth <b>{latest.mtp_depth ?? '-'}</b></span>
      </div>
    </div>
  );
}

/* ---------- Reorderable Metrics history grid ---------- */

const METRIC_DEFS: Record<string, { title: string; series: string; color: string; unit?: string; integer?: boolean; valueTransform?: (v: number) => number }> = {
  decode:      { title: 'Decode tok/s',       series: 'decode_tok_s',       color: '#7ed957', unit: 'tok/s', integer: true },
  prefill:     { title: 'Prefill tok/s',      series: 'prefill_tok_s',      color: '#84a9ff', unit: 'tok/s', integer: true },
  ttft:        { title: 'TTFT',               series: 'ttft_s',             color: '#f4c95d', unit: 's' },
  context:     { title: 'Context size',       series: 'context_len',        color: '#c986ff', unit: 'K',     integer: true, valueTransform: (v) => v / 1000 },
  prompt:      { title: 'Prompt tokens',      series: 'prompt_tokens',      color: '#6fd6e0', unit: 'K',     integer: true, valueTransform: (v) => v / 1000 },
  completion:  { title: 'Completion tokens',  series: 'completion_tokens',  color: '#ff9bd2', unit: '',      integer: true },
  tokenize:    { title: 'Tokenize + prefill', series: 'prompt_eval_time_s', color: '#66e0a3', unit: 's' },
  accept:      { title: 'Avg accept',         series: 'avg_accept_pct',     color: '#ffb16c', unit: '%',     integer: true },
  cached:      { title: 'Cached tokens',      series: 'cached_tokens',      color: '#a9a9ff', unit: 'K',     integer: true, valueTransform: (v) => v / 1000 },
  verify:      { title: 'Verify calls',       series: 'verify_calls',       color: '#84a9ff', integer: true },
  bonus:       { title: 'Bonus tokens',       series: 'bonus_tokens',       color: '#7ed957', integer: true },
  correction:  { title: 'Correction tokens',  series: 'correction_tokens',  color: '#f47272', integer: true },
};

const DEFAULT_METRIC_ORDER = ['decode', 'prefill', 'ttft', 'context', 'prompt', 'completion', 'tokenize', 'accept', 'cached', 'verify', 'bonus', 'correction'];

function MetricsHistorySection() {
  const { order, setOrder, reset } = useLayoutOrder('mtplx.metrics-grid', DEFAULT_METRIC_ORDER);
  const items: Record<string, React.ReactNode> = {};
  for (const id of Object.keys(METRIC_DEFS)) {
    const d = METRIC_DEFS[id];
    items[id] = (
      <MetricChart
        title={d.title}
        series={d.series}
        color={d.color}
        unit={d.unit}
        integer={d.integer}
        valueTransform={d.valueTransform}
      />
    );
  }
  return (
    <div className="section">
      <div className="head">
        <h2>Metrics history</h2>
        <span className="right" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          drag <span className="dnd-handle-static">⠿</span> to reorder · saved server-side
          <button className="btn" onClick={reset} title="Reset to default order">reset</button>
        </span>
      </div>
      <DraggableGrid
        className="row metrics-grid"
        order={order}
        items={items}
        onReorder={setOrder}
      />
    </div>
  );
}
