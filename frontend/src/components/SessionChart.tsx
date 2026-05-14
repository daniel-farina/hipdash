import { useEffect, useRef } from 'react';
import { fmtTokens } from '../lib/format';

type Turn = {
  ts: number;
  prompt: number | null;
  out: number | null;
  ctx: number | null;
  ttft: number | null;
  decode: number | null;
  wall: number | null;
  running?: boolean;
};

type Props = {
  rows: Turn[];
  turnTools?: string[][];
  cpuPerTurn?: (number | null)[];
  memPerTurn?: (number | null)[];
  cachePerTurn?: (number | null)[];
  thermalPerTurn?: (number | null)[]; // °C (preferred) OR throttle % fallback
  thermalUnit?: '°C' | '%';
  gpuTempPerTurn?: (number | null)[]; // °C
  powerPerTurn?: (number | null)[];    // total system watts
  // Live "right now" values from macmon. When present, the `now <value>`
  // readout in the corresponding sub-panel header reflects these — they tick
  // continuously regardless of which (potentially historical) session the
  // user is looking at.
  liveNow?: {
    cpu_temp_c?: number;
    gpu_temp_c?: number;
    sys_power_w?: number;
    all_power_w?: number;
  } | null;
  // height of the main chart panel only; sub-panels add fixed height below
  height?: number;
};

const SUBPANEL_H = 36;     // 14px header + 22px sparkline
const SUBPANEL_GAP = 4;
const SUBPANEL_HEADER_H = 14;

function fmtPct(v: number): string {
  return `${v.toFixed(0)}%`;
}

// Heat-map color via HSL rainbow: input 0-100 maps to hue 230° (cold blue)
// down to 0° (red). Continuous gradient — every percentage point lands on a
// distinct color, so a 76°C vs 79°C delta is clearly visible.
function heatColor(pct: number, alpha = 1): string {
  const clamped = Math.max(0, Math.min(100, pct));
  // 230 → 0 gives us blue → cyan → green → yellow → orange → red.
  const hue = 230 - (clamped / 100) * 230;
  // Boost saturation as we move from cold to hot; cold blues feel less harsh
  // a touch desaturated. Lightness stays mid so colors are punchy on dark bg.
  const sat = 70 + (clamped / 100) * 20;       // 70% → 90%
  const lit = clamped < 30 ? 60 - (30 - clamped) * 0.3 : 55; // slightly darker cold
  return `hsla(${hue.toFixed(1)}, ${sat.toFixed(0)}%, ${lit.toFixed(0)}%, ${alpha})`;
}
function fmtBytes(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}G`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return `${v.toFixed(0)}`;
}

export default function SessionChart({
  rows,
  turnTools,
  cpuPerTurn,
  memPerTurn,
  cachePerTurn,
  thermalPerTurn,
  thermalUnit = '%',
  gpuTempPerTurn,
  powerPerTurn,
  liveNow,
  height = 100,
}: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  // Total canvas height = main panel + N sub-panels (each + gap)
  // Show 1 decimal for temps so sub-degree movement is legible.
  const fmtTemp = (v: number) => `${v.toFixed(1)}${thermalUnit}`;
  const fmtTempC = (v: number) => `${v.toFixed(1)}°C`;
  const fmtWatts = (v: number) => `${v.toFixed(1)} W`;
  // Heat normalization: percentages pass through. Temperatures map
  // 50°C (cool) → 90°C (very hot) onto the 0-100 color ramp. This is the
  // typical Apple Silicon LLM-workload operating range, so the typical
  // session sweeps across most of the rainbow rather than parking at orange.
  const tempHeatNorm = (v: number) => Math.max(0, Math.min(100, ((v - 50) / (90 - 50)) * 100));
  const heatNorm =
    thermalUnit === '°C'
      ? tempHeatNorm
      : (v: number) => Math.max(0, Math.min(100, v));
  const thermalLabel = thermalUnit === '°C' ? 'CPU TEMP' : 'THERMAL';
  const subPanels: { label: string; values: (number | null)[] | undefined; color: string; format: (v: number) => string; heatmap?: boolean; heatNorm?: (v: number) => number; liveKey?: keyof NonNullable<Props['liveNow']> }[] = [
    { label: 'CPU',     values: cpuPerTurn,     color: '#ff7e7e', format: fmtPct },
    { label: 'MEM',     values: memPerTurn,     color: '#7d9aff', format: fmtBytes },
    { label: 'KV',      values: cachePerTurn,   color: '#9e9e9e', format: fmtBytes },
    { label: thermalLabel, values: thermalPerTurn, color: '#f4c95d', format: fmtTemp, heatmap: true, heatNorm, liveKey: thermalUnit === '°C' ? 'cpu_temp_c' : undefined },
    { label: 'GPU TEMP', values: gpuTempPerTurn, color: '#f4c95d', format: fmtTempC, heatmap: true, heatNorm: tempHeatNorm, liveKey: 'gpu_temp_c' },
    { label: 'POWER',   values: powerPerTurn,   color: '#ffb16c', format: fmtWatts, liveKey: 'sys_power_w' },
  ];
  const visibleSubs = subPanels.filter((s) => s.values && s.values.length);
  const totalHeight = height + visibleSubs.length * (SUBPANEL_H + SUBPANEL_GAP);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = Math.floor(rect.width * dpr);
    c.height = Math.floor(totalHeight * dpr);
    c.style.height = `${totalHeight}px`;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, totalHeight);

    const padL = 44, padR = 50;
    const w = rect.width - padL - padR;

    const ordered = [...rows].sort((a, b) => a.ts - b.ts);
    if (!ordered.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText('no turns', padL, 14);
      return;
    }

    const xStep = w / ordered.length;
    const barW = Math.max(1, xStep * 0.7);

    // ─── MAIN PANEL ─────────────────────────────────────────────────────
    const mainPadT = 6, mainPadB = 14;
    const mainInnerH = height - mainPadT - mainPadB;

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = mainPadT + (mainInnerH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + w, y);
      ctx.stroke();
    }

    const totals = ordered.map((t) => (t.prompt || 0) + (t.out || 0));
    const maxTok = Math.max(1, ...totals);
    const ctxVals = ordered.map((t) => t.ctx || 0);
    const maxCtx = Math.max(1, ...ctxVals);
    const decVals = ordered.map((t) => t.decode || 0);
    const maxDec = Math.max(1, ...decVals);

    const xAt = (i: number) => padL + xStep * (i + 0.5) - barW / 2;
    const yTok = (v: number) => mainPadT + mainInnerH - (v / maxTok) * mainInnerH;

    // Stacked bars
    ordered.forEach((t, i) => {
      const x = xAt(i);
      const inV = t.prompt || 0;
      const outV = t.out || 0;
      const yIn = yTok(inV);
      const yOut = yTok(inV + outV);
      ctx.fillStyle = 'rgba(132,169,255,0.55)';
      ctx.fillRect(x, yIn, barW, mainPadT + mainInnerH - yIn);
      ctx.fillStyle = 'rgba(126,217,87,0.80)';
      ctx.fillRect(x, yOut, barW, yIn - yOut);
      if (t.running) {
        ctx.strokeStyle = 'rgba(126,217,87,0.95)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 1, yOut - 1, barW + 2, mainPadT + mainInnerH - yOut + 2);
      }
    });

    // Context line
    const yCtx = (v: number) => mainPadT + mainInnerH - (v / maxCtx) * mainInnerH;
    ctx.strokeStyle = '#c986ff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ordered.forEach((t, i) => {
      const x = padL + xStep * (i + 0.5);
      const y = yCtx(t.ctx || 0);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Decode tok/s
    const yDec = (v: number) => mainPadT + mainInnerH - (v / maxDec) * mainInnerH;
    ctx.strokeStyle = '#f4c95d';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ordered.forEach((t, i) => {
      const x = padL + xStep * (i + 0.5);
      const y = yDec(t.decode || 0);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Tool dots
    if (turnTools && turnTools.length) {
      const offset = Math.max(0, ordered.length - turnTools.length);
      const counts = ordered.map((_, i) => {
        const idx = i - offset;
        return idx >= 0 && idx < turnTools.length ? (turnTools[idx]?.length || 0) : 0;
      });
      const maxTools = Math.max(1, ...counts);
      const yTool = (v: number) => mainPadT + mainInnerH - (v / maxTools) * mainInnerH;
      ctx.strokeStyle = '#6fd6e0';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      counts.forEach((n, i) => {
        const x = padL + xStep * (i + 0.5);
        const y = yTool(n);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      counts.forEach((n, i) => {
        if (n === 0) return;
        const x = padL + xStep * (i + 0.5);
        const y = yTool(n);
        ctx.fillStyle = '#6fd6e0';
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }

    // Main panel axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '9.5px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(fmtTokens(maxTok), padL - 4, mainPadT + 8);
    ctx.fillText('0', padL - 4, mainPadT + mainInnerH - 2);
    ctx.fillStyle = '#c986ff';
    ctx.textAlign = 'left';
    ctx.fillText(fmtTokens(maxCtx), padL + w + 4, mainPadT + 8);
    ctx.fillText('0', padL + w + 4, mainPadT + mainInnerH - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.textAlign = 'left';
    ctx.fillText('turn 1', padL, mainPadT + mainInnerH + 11);
    ctx.textAlign = 'right';
    ctx.fillText(`turn ${ordered.length}`, padL + w, mainPadT + mainInnerH + 11);
    ctx.textAlign = 'left';

    // ─── SUB-PANELS (CPU / MEM / KV / THERMAL) ──────────────────────────
    visibleSubs.forEach((s, idx) => {
      const top = height + idx * (SUBPANEL_H + SUBPANEL_GAP);
      const headerTop = top;
      const sparkTop = top + SUBPANEL_HEADER_H;
      const sparkH = SUBPANEL_H - SUBPANEL_HEADER_H - 2;

      const vals = (s.values || []).map((v) => (v == null || !isFinite(v) ? 0 : v));
      const minV = Math.min(...vals);
      const maxV = Math.max(...vals);
      // Prefer live value for "now" — keeps the readout ticking even on
      // older sessions. Falls back to the last per-turn sample.
      const liveVal = s.liveKey && liveNow && typeof liveNow[s.liveKey] === 'number'
        ? (liveNow[s.liveKey] as number)
        : undefined;
      const cur  = liveVal != null ? liveVal : vals[vals.length - 1];
      const avg  = vals.reduce((a, b) => a + b, 0) / vals.length;
      const span = Math.max(1e-6, maxV - minV);

      // For the thermal heat-map panel the visual color depends on the
      // values, not a single static `s.color`. Pick header colors from
      // the heat ramp based on now/max so the header itself signals heat.
      const heat = s.heatmap === true;
      const norm = s.heatNorm || ((v: number) => v);
      const headerColor    = heat ? heatColor(norm(cur || 0), 1) : s.color;
      const headerMaxColor = heat ? heatColor(norm(maxV || 0), 1) : 'rgba(255,255,255,0.35)';

      // Header strip — label on the left + big readout on the right
      ctx.fillStyle = heat ? heatColor(norm(maxV || 0), 1) : s.color;
      ctx.font = 'bold 10px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(s.label, padL, headerTop + 10);

      const rightX = padL + w + padR - 2;
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'right';
      // For heatmap, color the max label by its heat — gives quick read
      ctx.fillStyle = headerMaxColor;
      ctx.fillText(`max ${s.format(maxV)}`, rightX, headerTop + 10);
      const maxW = ctx.measureText(`max ${s.format(maxV)}`).width;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText(`avg ${s.format(avg)}`, rightX - maxW - 8, headerTop + 10);
      const avgW = ctx.measureText(`avg ${s.format(avg)}`).width;
      ctx.fillStyle = heat ? headerColor : '#ffffff';
      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.fillText(`now ${s.format(cur)}`, rightX - maxW - avgW - 16, headerTop + 10);
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'left';

      // Background strip for the sparkline area
      ctx.fillStyle = 'rgba(255,255,255,0.012)';
      ctx.fillRect(padL, sparkTop, w, sparkH);
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, sparkTop + sparkH);
      ctx.lineTo(padL + w, sparkTop + sparkH);
      ctx.stroke();

      const lastIdx = vals.length - 1;

      if (heat) {
        // Heatmap: per-turn vertical column colored by that turn's heat.
        // `s.heatNorm` projects whatever the raw unit is (°C, %) to a 0-100
        // heat scale used both for color choice and column height. Temp 40°C
        // is "0 heat" cool blue; 95°C is "100 heat" red. Throttle just passes
        // through (0% throttle = 0 heat, 100% throttle = 100 heat).
        const norm = s.heatNorm || ((v: number) => v);
        const MIN_H = 3;
        const colW = Math.max(1, xStep * 0.95);
        vals.forEach((v, i) => {
          const x = padL + xStep * (i + 0.5) - colW / 2;
          const h = norm(v);
          const valueH = (h / 100) * sparkH;
          const drawH = Math.max(MIN_H, valueH);
          const yi = sparkTop + sparkH - drawH;
          ctx.fillStyle = heatColor(h, 0.85);
          ctx.fillRect(x, yi, colW, drawH);
        });
        // Trace line through the temperature curve.
        if (maxV > 0) {
          const y = (v: number) => sparkTop + sparkH - (norm(v) / 100) * sparkH;
          ctx.strokeStyle = heatColor(norm(cur), 1);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          vals.forEach((v, i) => {
            const x = padL + xStep * (i + 0.5);
            const yi = y(v);
            if (i === 0) ctx.moveTo(x, yi); else ctx.lineTo(x, yi);
          });
          ctx.stroke();
        }
      } else {
        // Filled sparkline scaled to its own min/max — works for unbounded
        // values like memory bytes or KV cache. When the series is flat
        // (span ≈ 0), the sparkline would collapse to invisibility. Draw a
        // visible mid-height line so the user sees "data, just steady".
        const flatish = span < Math.max(1e-6, maxV * 0.005); // <0.5% variation
        const midY = sparkTop + sparkH / 2;
        const y = flatish
          ? () => midY
          : (v: number) => sparkTop + sparkH - ((v - minV) / span) * sparkH;
        ctx.fillStyle = s.color + '22';
        ctx.beginPath();
        vals.forEach((v, i) => {
          const x = padL + xStep * (i + 0.5);
          const yi = y(v);
          if (i === 0) {
            ctx.moveTo(padL, sparkTop + sparkH);
            ctx.lineTo(x, yi);
          } else {
            ctx.lineTo(x, yi);
          }
        });
        ctx.lineTo(padL + xStep * (lastIdx + 0.5), sparkTop + sparkH);
        ctx.lineTo(padL, sparkTop + sparkH);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        vals.forEach((v, i) => {
          const x = padL + xStep * (i + 0.5);
          const yi = y(v);
          if (i === 0) ctx.moveTo(x, yi); else ctx.lineTo(x, yi);
        });
        ctx.stroke();
      }
    });
  }, [rows, turnTools, cpuPerTurn, memPerTurn, cachePerTurn, thermalPerTurn, gpuTempPerTurn, powerPerTurn, liveNow, height, totalHeight, visibleSubs.length]);

  return <canvas ref={ref} style={{ width: '100%', height: totalHeight, display: 'block' }} />;
}
