import { useEffect, useMemo, useRef, useState } from 'react';
import { usePoll } from '../lib/usePoll';
import { getJson } from '../lib/api';
import { MODELS, findModel, costFor, fmtMoney, fmtMoneyPrecise, DEFAULT_MODEL_ID } from '../lib/pricing';
import { fmtTokens, fmtInt } from '../lib/format';

type TokenStats = {
  request_count: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  oldest_ts: number | null;
  newest_ts: number | null;
};

type Bucket = { ts: number; in_tok: number; out_tok: number; turns: number };
type Resp = { since: number; until: number; bucket_ms: number; buckets: Bucket[] };

const STORAGE_KEY = 'hipdash:savings-model';

type RangeKey = '24h' | '7d' | '30d' | 'all';
type RangeDef = { key: RangeKey; ms: number | null; label: string; poll: number };

const RANGES: RangeDef[] = [
  { key: '24h', ms: 24 * 60 * 60 * 1000,         label: '24h', poll: 8000  },
  { key: '7d',  ms: 7 * 24 * 60 * 60 * 1000,     label: '7d',  poll: 15000 },
  { key: '30d', ms: 30 * 24 * 60 * 60 * 1000,    label: '30d', poll: 30000 },
  { key: 'all', ms: null,                         label: 'all', poll: 60000 },
];

export default function TokensSavingsChart() {
  const [rangeKey, setRangeKey] = useState<RangeKey>('all');
  const range = RANGES.find((r) => r.key === rangeKey) || RANGES[3];

  // For "all", learn the oldest record from /api/stats/tokens so we ask the
  // server for the exact data range we have. Without this we'd have to guess
  // and over-fetch.
  const { data: stats } = usePoll<TokenStats>(() => getJson('/api/stats/tokens'), 15000);

  // Compute the effective range_ms for the query. Memoize on the stable
  // inputs only — using Date.now() at render time would re-evaluate every
  // render, invalidate the usePoll dep, and re-fetch in a tight loop.
  const effectiveRangeMs = useMemo(() => {
    if (range.ms !== null) return range.ms;
    if (stats?.oldest_ts) {
      // Round to the nearest hour so this value is stable across renders
      // until enough wall time has passed to actually change it.
      const span = Date.now() - stats.oldest_ts;
      const hour = 60 * 60 * 1000;
      return Math.ceil((span + hour) / hour) * hour;
    }
    return 30 * 24 * 60 * 60 * 1000;
  }, [range.ms, stats?.oldest_ts]);

  const url = `/api/stats/tokens-timeseries?range_ms=${effectiveRangeMs}&max_points=240`;
  const { data } = usePoll<Resp>(() => getJson(url), range.poll, [url]);

  const [modelId, setModelId] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEY) || DEFAULT_MODEL_ID; }
    catch { return DEFAULT_MODEL_ID; }
  });
  // Sync with the topbar dropdown via storage events (cross-tab updates) and
  // a slow poll fallback (same-tab updates don't fire storage events).
  useEffect(() => {
    const sync = () => {
      try {
        const v = localStorage.getItem(STORAGE_KEY) || DEFAULT_MODEL_ID;
        setModelId((cur) => (cur === v ? cur : v));
      } catch {}
    };
    window.addEventListener('storage', sync);
    const i = setInterval(sync, 5000);
    return () => { window.removeEventListener('storage', sync); clearInterval(i); };
  }, []);
  const model = findModel(modelId);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const buckets = data?.buckets || [];

  // running totals
  const totalIn = buckets.reduce((a, b) => a + b.in_tok, 0);
  const totalOut = buckets.reduce((a, b) => a + b.out_tok, 0);
  const totalSaved = costFor(totalIn, totalOut, model);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    const h = 220;
    c.width = Math.floor(rect.width * dpr);
    c.height = Math.floor(h * dpr);
    c.style.height = `${h}px`;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, h);

    const padL = 56, padR = 70, padT = 12, padB = 22;
    const w = rect.width - padL - padR;
    const innerH = h - padT - padB;

    if (!buckets.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText('no token data yet — make some requests through MTPLX', padL, padT + 16);
      return;
    }

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (innerH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + w, y);
      ctx.stroke();
    }

    // X scale
    const tMin = buckets[0].ts;
    const tMax = buckets[buckets.length - 1].ts + (data?.bucket_ms || 60_000);
    const tSpan = Math.max(1, tMax - tMin);
    const xAt = (ts: number) => padL + ((ts - tMin) / tSpan) * w;

    // Left axis: total tokens per bucket
    const totalsPerBucket = buckets.map((b) => b.in_tok + b.out_tok);
    const maxBucket = Math.max(1, ...totalsPerBucket);
    const yTok = (v: number) => padT + innerH - (v / maxBucket) * innerH;

    // Bars: stacked in + out per bucket
    const barWidth = Math.max(1, (w / buckets.length) * 0.8);
    for (const b of buckets) {
      const x = xAt(b.ts);
      // Output (top, brighter green)
      const yIn = yTok(b.in_tok);
      const yOut = yTok(b.in_tok + b.out_tok);
      // Input segment
      ctx.fillStyle = 'rgba(132,169,255,0.65)';
      ctx.fillRect(x, yIn, barWidth, padT + innerH - yIn);
      // Output segment stacked above
      ctx.fillStyle = 'rgba(126,217,87,0.85)';
      ctx.fillRect(x, yOut, barWidth, yIn - yOut);
    }

    // Right axis: cumulative $ saved
    let cum = 0;
    const cumPoints: { ts: number; val: number }[] = [];
    for (const b of buckets) {
      cum += costFor(b.in_tok, b.out_tok, model);
      cumPoints.push({ ts: b.ts, val: cum });
    }
    const maxCum = Math.max(0.01, cum);
    const yMoney = (v: number) => padT + innerH - (v / maxCum) * innerH;

    // Cumulative $ line (warm yellow)
    ctx.strokeStyle = '#f4c95d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    cumPoints.forEach((p, i) => {
      const x = xAt(p.ts);
      const y = yMoney(p.val);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    // Fill under the cumulative line
    ctx.lineTo(xAt(cumPoints[cumPoints.length - 1].ts), padT + innerH);
    ctx.lineTo(xAt(cumPoints[0].ts), padT + innerH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(244,201,93,0.08)';
    ctx.fill();

    // Axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${fmtTokens(maxBucket)} tok`, padL - 4, padT + 8);
    ctx.fillText(`${fmtTokens(maxBucket / 2)} tok`, padL - 4, padT + innerH / 2 + 3);
    ctx.fillText(`0`, padL - 4, padT + innerH - 2);
    // Right axis: $
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f4c95d';
    ctx.fillText(fmtMoney(maxCum), padL + w + 4, padT + 8);
    ctx.fillText(fmtMoney(maxCum / 2), padL + w + 4, padT + innerH / 2 + 3);
    ctx.fillText('$0', padL + w + 4, padT + innerH - 2);

    // X labels (start / mid / end)
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '9.5px ui-monospace, monospace';
    const fmtDate = (ts: number) => {
      const d = new Date(ts);
      const days = (tSpan) / (24 * 60 * 60 * 1000);
      if (days > 2) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    ctx.textAlign = 'left';
    ctx.fillText(fmtDate(tMin), padL, h - 4);
    ctx.textAlign = 'center';
    ctx.fillText(fmtDate((tMin + tMax) / 2), padL + w / 2, h - 4);
    ctx.textAlign = 'right';
    ctx.fillText(fmtDate(tMax), padL + w, h - 4);
    ctx.textAlign = 'left';
  }, [buckets, data?.bucket_ms, model]);

  // Date-range subtitle for "all" mode.
  const fmtDay = (ms: number) =>
    new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  const dateRangeLabel = (() => {
    if (rangeKey !== 'all' || !stats?.oldest_ts || !stats?.newest_ts) return null;
    const days = Math.max(1, Math.round((stats.newest_ts - stats.oldest_ts) / (24 * 60 * 60 * 1000)));
    return `${fmtDay(stats.oldest_ts)} → ${fmtDay(stats.newest_ts)} · ${days}d`;
  })();

  return (
    <div className="chart-card">
      <div className="chart-head">
        <h3>
          Tokens generated &amp; $ saved
          {dateRangeLabel ? (
            <span className="chart-daterange"> · {dateRangeLabel}</span>
          ) : null}
        </h3>
        <span className="chart-range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRangeKey(r.key as any)}
              className={`range-btn ${rangeKey === r.key ? 'on' : ''}`}
            >{r.label}</button>
          ))}
        </span>
      </div>
      <canvas ref={canvasRef} style={{ width: '100%', height: 220 }} />
      <div className="legend">
        <span><i style={{ background: 'rgba(132,169,255,0.65)' }} />input</span>
        <span><i style={{ background: 'rgba(126,217,87,0.85)' }} />output</span>
        <span><i style={{ background: '#f4c95d' }} />$ saved (cum)</span>
      </div>
      <div className="kpi" style={{ marginTop: 8, fontSize: 11 }}>
        <span>in <b>{fmtTokens(totalIn)}</b></span>
        <span>out <b>{fmtTokens(totalOut)}</b></span>
        <span>turns <b>{fmtInt(buckets.reduce((a, b) => a + b.turns, 0))}</b></span>
        <span>actual <b style={{ color: '#7ed957' }}>$0.00</b></span>
        <span style={{ marginLeft: 'auto' }}>
          vs <b>{model.label}</b> · would-have-cost <b style={{ color: '#f4c95d' }}>{fmtMoneyPrecise(totalSaved)}</b>
        </span>
      </div>
    </div>
  );
}
