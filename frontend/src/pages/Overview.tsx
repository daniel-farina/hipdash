import { usePoll } from '../lib/usePoll';
import { getJson, MetricPoint, Restart, Status } from '../lib/api';
import { fmtAge, fmtBytes, fmtNumber, fmtPct, fmtTime } from '../lib/format';
import LineChart from '../components/LineChart';
import Pill from '../components/Pill';
import TokensSavingsChart from '../components/TokensSavingsChart';
import { Link } from 'react-router-dom';

type MetricsResp = { since: number; series: Record<string, MetricPoint[]> };
type RestartResp = { restarts: Restart[] };

export default function Overview() {
  const { data: live } = usePoll<any>(() => getJson('/metrics'), 1500);
  const { data: sessionsResp } = usePoll<any>(() => getJson('/admin/sessions'), 2000);
  const { data: stats } = usePoll<any>(() => getJson('/system-stats.json'), 2500);
  const { data: status } = usePoll<Status>(() => getJson('/api/status'), 3000);
  const { data: hist } = usePoll<MetricsResp>(
    () =>
      getJson(
        '/api/history/metrics?range_ms=300000&max_points=200&series=decode_tok_s,prefill_tok_s',
      ),
    5000,
  );
  const { data: restartsResp } = usePoll<RestartResp>(
    () => getJson('/api/history/restarts?range_ms=' + 24 * 60 * 60 * 1000),
    10000,
  );

  const latest = live?.latest || {};
  const sessionBank = sessionsResp?.session_bank || {};
  const sessions = sessionsResp?.sessions || [];
  const cpu = stats?.cpu || {};
  const mem = stats?.memory || {};
  const swap = stats?.swap || {};
  const memPct = mem.total_bytes ? (mem.used_bytes / mem.total_bytes) * 100 : 0;
  const swapPct = swap.total_bytes ? (swap.used_bytes / swap.total_bytes) * 100 : 0;
  const bankPct = sessionBank.max_bytes
    ? ((sessionBank.total_nbytes || 0) / sessionBank.max_bytes) * 100
    : 0;

  const seriesThroughput = [
    {
      label: 'decode tok/s',
      color: '#7ed957',
      width: 1.8,
      data: (hist?.series['decode_tok_s'] || []).map((p) => ({ ts: p.ts, value: p.value })),
    },
    {
      label: 'prefill tok/s',
      color: '#84a9ff',
      width: 1.2,
      data: (hist?.series['prefill_tok_s'] || []).map((p) => ({ ts: p.ts, value: p.value })),
    },
  ];

  const restarts = restartsResp?.restarts || [];

  return (
    <>
      {!status?.mtplx_alive ? (
        <div className="banner">MTPLX backend offline · last seen {fmtAge(status?.last_mtplx_seen)}</div>
      ) : null}

      <div className="row six">
        <div className="card">
          <div className="label">Decode</div>
          <div className="big">{fmtNumber(latest.decode_tok_s)}<small>tok/s</small></div>
          <div className="meta">latest req</div>
        </div>
        <div className="card">
          <div className="label">TTFT</div>
          <div className="big">{fmtNumber(latest.ttft_s, 2)}<small>s</small></div>
          <div className="meta">first token</div>
        </div>
        <div className="card">
          <div className="label">Prefill</div>
          <div className="big">{fmtNumber(latest.prefill_tok_s)}<small>tok/s</small></div>
          <div className="meta">prompt eval</div>
        </div>
        <div className="card">
          <div className="label">Mode</div>
          <div className="big">{(latest.mode || latest.runtime_mode || latest.generation_mode || '-').toString().toUpperCase()}</div>
          <div className="meta">depth {latest.mtp_depth || latest.depth || '-'}</div>
        </div>
        <div className="card">
          <div className="label">CPU</div>
          <div className="big">{fmtPct(cpu.used)}</div>
          <div className="bar"><i style={{ width: `${Math.min(100, cpu.used || 0)}%` }} /></div>
          <div className="meta">{stats?.cpu_cores ?? '-'} cores</div>
        </div>
        <div className="card">
          <div className="label">Memory</div>
          <div className="big">{fmtPct(memPct)}</div>
          <div className="bar"><i style={{ width: `${Math.min(100, memPct)}%` }} /></div>
          <div className="meta">{fmtBytes(mem.used_bytes)} / {fmtBytes(mem.total_bytes)}</div>
        </div>
      </div>

      <div className="section">
        <div className="row chart-trio">
          <div className="chart-card">
            <div className="chart-head">
              <h3>Throughput · 5m</h3>
              <span className="chart-sub">decode + prefill</span>
            </div>
            <LineChart series={seriesThroughput} height={110} />
            <div className="legend">
              <span><i style={{ background: '#7ed957' }} />decode <b>{fmtNumber(latest.decode_tok_s)}</b></span>
              <span><i style={{ background: '#84a9ff' }} />prefill <b>{fmtNumber(latest.prefill_tok_s)}</b></span>
            </div>
          </div>
          <div className="card">
            <div className="label">Session bank</div>
            <div className="big">{fmtBytes(sessionBank.total_nbytes)}<small>/ {fmtBytes(sessionBank.max_bytes)}</small></div>
            <div className="bar"><i style={{ width: `${Math.min(100, bankPct)}%` }} /></div>
            <div className="kpi">
              <span>sessions <b>{sessions.length}</b></span>
              <span>entries <b>{sessionBank.entries ?? '-'}</b>/{sessionBank.max_entries ?? '-'}</span>
              <span>evict <b>{sessionBank.eviction_log?.length ?? 0}</b></span>
            </div>
            <div className="meta"><Link to="/mtplx">view bank →</Link></div>
          </div>
          <div className="card">
            <div className="label">Last restart</div>
            <div className="big" style={{ fontSize: 14 }}>
              {restarts[0] ? (
                <>
                  <Pill tone={restarts[0].target === 'mtplx' ? 'mtp' : 'info'} variant="badge">{restarts[0].target}</Pill>
                  {' '}{fmtAge(restarts[0].ts)}
                </>
              ) : 'none in 24h'}
            </div>
            <div className="kpi">
              <span>swap <b>{fmtPct(swapPct)}</b></span>
              <span>load <b>{fmtNumber(stats?.load?.['1m'], 2)}</b></span>
              <span>uptime <b>{stats?.uptime || '-'}</b></span>
            </div>
            <div className="meta">
              {restarts.length} events / 24h · <Link to="/restarts">history →</Link>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="head">
          <h2>Tokens &amp; savings</h2>
          <span className="right">vs cloud API list prices</span>
        </div>
        <TokensSavingsChart />
      </div>

      <div className="section">
        <div className="head">
          <h2>Recent activity</h2>
          <span className="right">restarts · last 24h</span>
        </div>
        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>target</th>
                <th>when</th>
                <th>how long ago</th>
                <th>detail</th>
              </tr>
            </thead>
            <tbody>
              {restarts.length === 0 ? (
                <tr><td colSpan={4} className="dim">no restart events in window</td></tr>
              ) : restarts.slice(0, 6).map((r) => (
                <tr key={r.id}>
                  <td><Pill tone={r.target === 'mtplx' ? 'mtp' : 'info'}>{r.target}</Pill></td>
                  <td>{fmtTime(r.ts)}</td>
                  <td>{fmtAge(r.ts)}</td>
                  <td className="dim">
                    {r.detail?.initial
                      ? 'first observed'
                      : r.detail?.manual_archive
                      ? 'manual archive'
                      : r.detail?.sig
                      ? `sig: ${String(r.detail.sig).slice(0, 50)}`
                      : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
