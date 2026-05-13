import { useEffect, useRef } from 'react';

export type Series = {
  label: string;
  color: string;
  data: { ts: number; value: number }[];
  width?: number;
  axis?: 'left' | 'right';
  fill?: string | null;
};

type Props = {
  series: Series[];
  height?: number;
  yClipPercentile?: number;
  showAxes?: boolean;
  yUnitLeft?: string;
  yUnitRight?: string;
  yIntegerLeft?: boolean;
  yIntegerRight?: boolean;
};

export default function LineChart({
  series,
  height = 220,
  yClipPercentile = 0.97,
  showAxes = true,
  yUnitLeft = '',
  yUnitRight = '',
  yIntegerLeft = false,
  yIntegerRight = false,
}: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, height);

    const padL = showAxes ? 46 : 6;
    const padR = series.some((s) => s.axis === 'right') ? (showAxes ? 36 : 6) : 6;
    const padT = 8;
    const padB = showAxes ? 18 : 4;
    const w = rect.width - padL - padR;
    const h = height - padT - padB;

    const allTs = series.flatMap((s) => s.data.map((p) => p.ts));
    if (allTs.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText('no data yet', padL, padT + 14);
      return;
    }
    const tMin = Math.min(...allTs);
    const tMax = Math.max(...allTs);
    const tSpan = Math.max(1, tMax - tMin);

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (h * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + w, y);
      ctx.stroke();
    }

    const axes: Record<'left' | 'right', { min: number; max: number }> = {
      left: { min: 0, max: 1 },
      right: { min: 0, max: 1 },
    };
    const groups: Record<'left' | 'right', number[]> = { left: [], right: [] };
    for (const s of series) {
      const ax = s.axis ?? 'left';
      for (const p of s.data) groups[ax].push(p.value);
    }
    for (const k of ['left', 'right'] as const) {
      const arr = groups[k].filter((v) => isFinite(v));
      if (arr.length === 0) continue;
      arr.sort((a, b) => a - b);
      const idx = Math.min(arr.length - 1, Math.floor(arr.length * yClipPercentile));
      const max = Math.max(0.0001, arr[idx]);
      axes[k] = { min: 0, max: max * 1.05 };
    }

    const xAt = (ts: number) => padL + ((ts - tMin) / tSpan) * w;
    const yAt = (v: number, ax: 'left' | 'right') => {
      const a = axes[ax];
      const norm = (v - a.min) / Math.max(1e-9, a.max - a.min);
      const clipped = Math.max(0, Math.min(1, norm));
      return padT + h - clipped * h;
    };

    for (const s of series) {
      const ax = s.axis ?? 'left';
      if (!s.data.length) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width ?? 1.5;
      ctx.beginPath();
      let first = true;
      for (const p of s.data) {
        const x = xAt(p.ts);
        const y = yAt(p.value, ax);
        if (first) { ctx.moveTo(x, y); first = false; }
        else { ctx.lineTo(x, y); }
      }
      ctx.stroke();
      if (s.fill) {
        ctx.lineTo(xAt(s.data[s.data.length - 1].ts), padT + h);
        ctx.lineTo(xAt(s.data[0].ts), padT + h);
        ctx.closePath();
        ctx.fillStyle = s.fill;
        ctx.fill();
      }
    }

    if (showAxes) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '10px ui-monospace, monospace';
      const fmt = (v: number, asInt: boolean, unit: string) => {
        const u = unit ? ` ${unit}` : '';
        if (asInt) return `${Math.round(v)}${u}`;
        if (v >= 100) return `${v.toFixed(0)}${u}`;
        if (v >= 10) return `${v.toFixed(1)}${u}`;
        return `${v.toFixed(2)}${u}`;
      };
      const yL = axes.left;
      const halfL = (yL.max - yL.min) * 0.5;
      ctx.textAlign = 'right';
      ctx.fillText(fmt(yL.max, yIntegerLeft, yUnitLeft), padL - 4, padT + 8);
      ctx.fillText(fmt(halfL,  yIntegerLeft, yUnitLeft), padL - 4, padT + h / 2 + 3);
      ctx.fillText(fmt(0,      yIntegerLeft, yUnitLeft), padL - 4, padT + h - 2);
      ctx.textAlign = 'left';
      if (groups.right.length) {
        const yR = axes.right;
        const halfR = (yR.max - yR.min) * 0.5;
        ctx.textAlign = 'left';
        const rx = padL + w + 4;
        ctx.fillText(fmt(yR.max, yIntegerRight, yUnitRight), rx, padT + 8);
        ctx.fillText(fmt(halfR,  yIntegerRight, yUnitRight), rx, padT + h / 2 + 3);
        ctx.fillText(fmt(0,      yIntegerRight, yUnitRight), rx, padT + h - 2);
      }
      const tLabel = (ts: number) => {
        const d = new Date(ts);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      };
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '9.5px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(tLabel(tMin), padL, height - 4);
      ctx.textAlign = 'right';
      ctx.fillText(tLabel(tMax), padL + w, height - 4);
      ctx.textAlign = 'left';
    }
  }, [series, height, yClipPercentile, showAxes]);

  return <canvas ref={ref} style={{ width: '100%', height: `${height}px`, display: 'block' }} />;
}
