export function fmtBytes(n: number | null | undefined, digits = 1): string {
  if (n == null || !isFinite(n)) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(digits)} ${units[i]}`;
}

export function fmtNumber(n: number | null | undefined, digits = 1): string {
  if (n == null || !isFinite(n)) return '-';
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toFixed(digits);
}

export function fmtPct(n: number | null | undefined, digits = 0): string {
  if (n == null || !isFinite(n)) return '-';
  return `${n.toFixed(digits)}%`;
}

export function fmtAge(ts: number | null | undefined): string {
  if (!ts) return '-';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function fmtTime(ts: number | null | undefined): string {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString();
}

export function shorten(s: string | null | undefined, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

// Compress a session id like `auto-20260513-165758-abc51f` to `auto…abc51f`.
// Short human-readable ids (`opencode-researcher`, `3dworld-loop`) are kept
// as-is so the visual identity stays readable.
export function shortenSessionId(s: string | null | undefined, threshold = 22): string {
  if (!s) return '-';
  if (s.length <= threshold) return s;
  const firstSeg = s.split('-')[0] || s.slice(0, 6);
  const head = firstSeg.length > 8 ? firstSeg.slice(0, 8) : firstSeg;
  const tail = s.slice(-6);
  return `${head}…${tail}`;
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds)) return '-';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  if (m < 60) return `${m}m${String(r).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  const mm = m - h * 60;
  return `${h}h${String(mm).padStart(2, '0')}m`;
}
