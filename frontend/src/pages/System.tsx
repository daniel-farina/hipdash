import { usePoll } from '../lib/usePoll';
import { getJson, MetricPoint } from '../lib/api';
import { fmtBytes, fmtNumber, fmtPct, shorten } from '../lib/format';
import LineChart from '../components/LineChart';
import { useSort, SortTh } from '../lib/useSort';

type MetricsResp = { since: number; series: Record<string, MetricPoint[]> };

export default function SystemPage() {
  const { data: stats } = usePoll<any>(() => getJson('/system-stats.json'), 2000);
  const { data: hist } = usePoll<MetricsResp>(
    () =>
      getJson(
        '/api/history/metrics?range_ms=900000&series=cpu_used_pct,mem_used_bytes,swap_used_bytes,load_1m',
      ),
    5000,
  );

  const cpu = stats?.cpu || {};
  const mem = stats?.memory || {};
  const swap = stats?.swap || {};
  const load = stats?.load || {};
  const disk = stats?.disk || {};
  const procs = stats?.processes || {};

  const memPct = mem.total_bytes ? (mem.used_bytes / mem.total_bytes) * 100 : 0;
  const swapPct = swap.total_bytes ? (swap.used_bytes / swap.total_bytes) * 100 : 0;

  const series = [
    {
      label: 'cpu %',
      color: '#7ed957',
      width: 1.6,
      data: (hist?.series['cpu_used_pct'] || []).map((p) => ({ ts: p.ts, value: p.value })),
    },
    {
      label: 'mem',
      color: '#84a9ff',
      width: 1.6,
      axis: 'right' as const,
      data: (hist?.series['mem_used_bytes'] || []).map((p) => ({ ts: p.ts, value: p.value / 1024 / 1024 / 1024 })),
    },
    {
      label: 'load 1m',
      color: '#f4c95d',
      width: 1.2,
      data: (hist?.series['load_1m'] || []).map((p) => ({ ts: p.ts, value: p.value * 10 })),
    },
  ];

  return (
    <>
      <div className="row six">
        <div className="card">
          <div className="label">CPU</div>
          <div className="big">{fmtPct(cpu.used)}</div>
          <div className="bar"><i style={{ width: `${Math.min(100, cpu.used || 0)}%` }} /></div>
          <div className="meta">user {fmtPct(cpu.user)} · sys {fmtPct(cpu.sys)}</div>
        </div>
        <div className="card">
          <div className="label">Memory</div>
          <div className="big">{fmtPct(memPct)}</div>
          <div className="bar"><i style={{ width: `${Math.min(100, memPct)}%` }} /></div>
          <div className="meta">{fmtBytes(mem.used_bytes)} / {fmtBytes(mem.total_bytes)}</div>
        </div>
        <div className="card">
          <div className="label">Swap</div>
          <div className="big">{fmtPct(swapPct)}</div>
          <div className="bar warn"><i style={{ width: `${Math.min(100, swapPct)}%` }} /></div>
          <div className="meta">{fmtBytes(swap.used_bytes)} / {fmtBytes(swap.total_bytes)}</div>
        </div>
        <div className="card">
          <div className="label">Load</div>
          <div className="big">{fmtNumber(load['1m'], 2)}</div>
          <div className="meta">5m {fmtNumber(load['5m'], 2)} · 15m {fmtNumber(load['15m'], 2)}</div>
        </div>
        <div className="card">
          <div className="label">Disk /</div>
          <div className="big">{fmtPct(disk.total_bytes ? (disk.used_bytes / disk.total_bytes) * 100 : 0)}</div>
          <div className="bar"><i style={{ width: `${disk.total_bytes ? (disk.used_bytes / disk.total_bytes) * 100 : 0}%` }} /></div>
          <div className="meta">{fmtBytes(disk.used_bytes)} / {fmtBytes(disk.total_bytes)}</div>
        </div>
        <div className="card">
          <div className="label">Thermal</div>
          <div className="big" style={{ fontSize: 14 }}>
            {stats?.thermal?.cpu_speed_limit_pct != null && stats.thermal.cpu_speed_limit_pct < 100
              ? `${stats.thermal.cpu_speed_limit_pct}%`
              : 'nominal'}
          </div>
          <div className="meta">{stats?.cpu_cores ?? '-'} cores · uptime {stats?.uptime || '-'}</div>
        </div>
      </div>

      <div className="section">
        <div className="head"><h2>System · 15 min</h2></div>
        <div className="chart-card">
          <LineChart series={series} height={150} />
          <div className="legend">
            <span><i style={{ background: '#7ed957' }} />cpu %</span>
            <span><i style={{ background: '#84a9ff' }} />mem GB</span>
            <span><i style={{ background: '#f4c95d' }} />load×10</span>
          </div>
        </div>
      </div>

      <div className="row three">
        <div className="card">
          <div className="label">Memory detail</div>
          <div className="kpi" style={{ marginTop: 0 }}>
            <span>used <b>{fmtBytes(mem.used_bytes)}</b></span>
            <span>wired <b>{fmtBytes(mem.wired_bytes)}</b></span>
            <span>active <b>{fmtBytes(mem.active_bytes)}</b></span>
            <span>compressed <b>{fmtBytes(mem.compressed_bytes)}</b></span>
            <span>free <b>{fmtBytes(mem.free_bytes)}</b></span>
          </div>
        </div>
        <div className="card">
          <div className="label">CPU breakdown</div>
          <div className="kpi" style={{ marginTop: 0 }}>
            <span>user <b>{fmtPct(cpu.user)}</b></span>
            <span>sys <b>{fmtPct(cpu.sys)}</b></span>
            <span>idle <b>{fmtPct(cpu.idle)}</b></span>
            <span>cores <b>{stats?.cpu_cores ?? '-'}</b></span>
          </div>
        </div>
        <div className="card">
          <div className="label">Thermal raw</div>
          <div className="meta" style={{ marginTop: 0, textTransform: 'none', letterSpacing: 0 }}>
            {shorten(stats?.thermal?.raw || '-', 100)}
          </div>
        </div>
      </div>

      {(['mtplx', 'claude'] as const).map((kind) => {
        const list: any[] = procs[kind] || [];
        if (!list.length) return null;
        return <ProcessTable key={kind} kind={kind} list={list} />;
      })}
    </>
  );
}

function ProcessTable({ kind, list }: { kind: string; list: any[] }) {
  const { sorted, sort, onSort } = useSort<any>(
    list,
    { key: 'rss_bytes', dir: 'desc' },
    {
      pid: (p) => p.pid,
      cpu: (p) => p.cpu_pct ?? 0,
      mem: (p) => p.mem_pct ?? 0,
      rss_bytes: (p) => p.rss_bytes ?? 0,
      vsz: (p) => p.vsz_bytes ?? 0,
      uptime: (p) => p.uptime || '',
    },
  );
  return (
    <div className="section">
      <div className="head">
        <h2>{kind} processes</h2>
        <span className="right">{list.length} running</span>
      </div>
      <div className="scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <SortTh label="pid"     sortKey="pid"        state={sort} onSort={onSort} />
              <SortTh label="cpu %"   sortKey="cpu"        state={sort} onSort={onSort} align="right" />
              <SortTh label="mem %"   sortKey="mem"        state={sort} onSort={onSort} align="right" />
              <SortTh label="rss"     sortKey="rss_bytes"  state={sort} onSort={onSort} align="right" />
              <SortTh label="vsz"     sortKey="vsz"        state={sort} onSort={onSort} align="right" />
              <SortTh label="uptime"  sortKey="uptime"     state={sort} onSort={onSort} />
              <th>cmd</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.pid}>
                <td>{p.pid}</td>
                <td className="num">{fmtNumber(p.cpu_pct)}</td>
                <td className="num">{fmtNumber(p.mem_pct)}</td>
                <td className="num">{fmtBytes(p.rss_bytes)}</td>
                <td className="num">{fmtBytes(p.vsz_bytes)}</td>
                <td>{p.uptime}</td>
                <td><span className="preview">{shorten(p.full_cmd || '', 90)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
