import { useState } from 'react';
import { usePoll } from '../lib/usePoll';
import { getJson, MetricPoint } from '../lib/api';
import LineChart from './LineChart';
import { fmtBytes, fmtNumber } from '../lib/format';

type MetricsResp = {
  since: number;
  until: number;
  bucket_ms?: number;
  series: Record<string, MetricPoint[]>;
};

const RANGES = [
  { key: '15m',  ms: 15 * 60 * 1000,             label: '15m', poll: 5000 },
  { key: '1h',   ms: 60 * 60 * 1000,             label: '1h',  poll: 8000 },
  { key: '8h',   ms: 8 * 60 * 60 * 1000,         label: '8h',  poll: 30000 },
  { key: '24h',  ms: 24 * 60 * 60 * 1000,        label: '24h', poll: 60000 },
];

type Props = {
  defaultKey?: '15m' | '1h' | '8h' | '24h';
  height?: number;
  showAxes?: boolean;
};

export default function SessionBankChart({ defaultKey = '24h', height = 90, showAxes = false }: Props) {
  const [rangeKey, setRangeKey] = useState(defaultKey);
  const range = RANGES.find((r) => r.key === rangeKey) || RANGES[3];
  const url =
    `/api/history/metrics?range_ms=${range.ms}&max_points=300` +
    `&series=cache_bytes,cache_entries`;

  const { data } = usePoll<MetricsResp>(() => getJson(url), range.poll, [url]);

  const GB = 1024 * 1024 * 1024;
  // chart values in GB (so the y-axis reads in GB), but keep raw bytes for the legend
  const bytesRaw = (data?.series.cache_bytes || []).map((p) => ({ ts: p.ts, value: p.value }));
  const bytesGB = bytesRaw.map((p) => ({ ts: p.ts, value: p.value / GB }));
  const entries = (data?.series.cache_entries || []).map((p) => ({ ts: p.ts, value: p.value }));

  const series = [
    { label: 'GB',      color: '#7ed957', width: 1.8, data: bytesGB,
      fill: 'rgba(126,217,87,0.05)' },
    { label: 'entries', color: '#f4c95d', width: 1.2, axis: 'right' as const, data: entries },
  ];

  const lastBytes = bytesRaw[bytesRaw.length - 1]?.value;
  const peakBytes = bytesRaw.length ? Math.max(...bytesRaw.map((p) => p.value)) : null;
  const minBytes  = bytesRaw.length ? Math.min(...bytesRaw.map((p) => p.value)) : null;
  const lastEntries = entries[entries.length - 1]?.value;

  return (
    <div className="chart-card">
      <div className="chart-head">
        <h3>Paged-KV cache · {range.label}</h3>
        <span className="chart-range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRangeKey(r.key as any)}
              className={`range-btn ${rangeKey === r.key ? 'on' : ''}`}
              title={`${r.label} window`}
            >
              {r.label}
            </button>
          ))}
        </span>
      </div>
      <LineChart
        series={series}
        height={height}
        showAxes={showAxes}
        yUnitLeft="GB"
        yIntegerRight
      />
      <div className="legend">
        <span><i style={{ background: '#7ed957' }} />KV <b>{fmtBytes(lastBytes)}</b></span>
        <span><i style={{ background: '#f4c95d' }} />entries <b>{fmtNumber(lastEntries, 0)}</b></span>
        {peakBytes != null ? (
          <span style={{ marginLeft: 'auto' }}>
            peak <b>{fmtBytes(peakBytes)}</b>
          </span>
        ) : null}
      </div>
    </div>
  );
}
