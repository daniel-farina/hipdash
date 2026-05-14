import { useState } from 'react';
import { usePoll } from '../lib/usePoll';
import { getJson, MetricPoint } from '../lib/api';
import LineChart from './LineChart';
import { fmtNumber } from '../lib/format';

type MetricsResp = {
  since: number;
  until: number;
  bucket_ms?: number;
  series: Record<string, MetricPoint[]>;
};

type RangeKey = '15m' | '1h' | '8h' | '24h';

const RANGES: { key: RangeKey; ms: number; label: string; poll: number }[] = [
  { key: '15m', ms: 15 * 60 * 1000,          label: '15m', poll: 4000  },
  { key: '1h',  ms: 60 * 60 * 1000,          label: '1h',  poll: 8000  },
  { key: '8h',  ms: 8 * 60 * 60 * 1000,      label: '8h',  poll: 30000 },
  { key: '24h', ms: 24 * 60 * 60 * 1000,     label: '24h', poll: 60000 },
];

type Props = {
  title: string;
  series: string;
  color?: string;
  unit?: string;           // e.g. 'tok/s', 's', 'GB', '%'
  integer?: boolean;
  valueTransform?: (v: number) => number;
  defaultKey?: RangeKey;
  height?: number;
  // optional summary helpers
  showPeak?: boolean;
  fmtCurrent?: (v: number) => string;
};

export default function MetricChart({
  title,
  series,
  color = '#7ed957',
  unit = '',
  integer = false,
  valueTransform,
  defaultKey = '1h',
  height = 110,
  showPeak = true,
  fmtCurrent,
}: Props) {
  const [rangeKey, setRangeKey] = useState<RangeKey>(defaultKey);
  const range = RANGES.find((r) => r.key === rangeKey) || RANGES[1];
  const url = `/api/history/metrics?range_ms=${range.ms}&max_points=300&series=${encodeURIComponent(series)}`;

  const { data } = usePoll<MetricsResp>(() => getJson(url), range.poll, [url]);
  const raw = data?.series?.[series] || [];
  const points = raw.map((p) => ({
    ts: p.ts,
    value: valueTransform ? valueTransform(p.value) : p.value,
  }));

  const lineSeries = [
    { label: title, color, width: 1.6, data: points, fill: 'rgba(126,217,87,0.04)' },
  ];

  const last = points[points.length - 1]?.value;
  const peak = points.length ? Math.max(...points.map((p) => p.value)) : null;
  const avg = points.length ? points.reduce((a, b) => a + b.value, 0) / points.length : null;

  // `now` and `peak` are observed samples — use the configured integer/decimal
  // setting. `avg` is computed across all samples, so it's almost never a
  // whole number; pick decimals based on magnitude to avoid noise on big
  // numbers and lost precision on small ones.
  const fmtSample = fmtCurrent || ((v: number) => `${fmtNumber(v, integer ? 0 : 1)}${unit}`);
  const fmtAvg = fmtCurrent || ((v: number) => {
    const abs = Math.abs(v);
    if (abs === 0) return `0${unit}`;
    let digits: number;
    if (abs >= 100) digits = 1;       // 1234.5
    else if (abs >= 10) digits = 2;   // 42.71
    else if (abs >= 1) digits = 2;    // 1.23
    else digits = 3;                  // 0.123
    return `${v.toFixed(digits)}${unit}`;
  });

  return (
    <div className="chart-card">
      <div className="chart-head">
        <h3>{title}</h3>
        <span className="chart-range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRangeKey(r.key)}
              className={`range-btn ${rangeKey === r.key ? 'on' : ''}`}
              title={`${r.label} window`}
            >
              {r.label}
            </button>
          ))}
        </span>
      </div>
      <LineChart
        series={lineSeries}
        height={height}
        showAxes={true}
        yIntegerLeft={integer}
      />
      <div className="legend">
        <span><i style={{ background: color }} />now <b>{last != null ? fmtSample(last) : '-'}</b></span>
        {avg != null ? <span>avg <b>{fmtAvg(avg)}</b></span> : null}
        {showPeak && peak != null ? <span style={{ marginLeft: 'auto' }}>peak <b>{fmtSample(peak)}</b></span> : null}
      </div>
    </div>
  );
}
