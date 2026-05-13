import React from 'react';

type Tone =
  | 'good'
  | 'bad'
  | 'warn'
  | 'info'
  | 'neutral'
  | 'mtp'
  | 'ar'
  | 'cold'
  | 'warm'
  | 'hit'
  | 'miss'
  | 'lease';

type Props = {
  children: React.ReactNode;
  tone?: Tone;
  variant?: 'tag' | 'badge';
  title?: string;
  style?: React.CSSProperties;
};

export default function Pill({ children, tone = 'neutral', variant = 'tag', title, style }: Props) {
  return (
    <span className={`pill-x pill-x-${tone} pill-x-${variant}`} title={title} style={style}>
      {children}
    </span>
  );
}

export function modeTone(mode: string | null | undefined): Tone {
  const m = (mode || '').toLowerCase();
  if (m === 'mtp') return 'mtp';
  if (m === 'ar') return 'ar';
  return 'neutral';
}

export function cacheTone(label: string | null | undefined): Tone {
  const v = (label || '').toLowerCase();
  if (v === 'cold' || v === 'miss' || v.includes('miss') || v.includes('divergence') || v.includes('new_session')) return 'miss';
  if (v === 'warm' || v === 'hit' || v.includes('reused')) return 'hit';
  if (v.includes('lease')) return 'lease';
  return 'neutral';
}

export function statusTone(label: string | null | undefined): Tone {
  const v = (label || '').toLowerCase();
  if (v === 'running') return 'good';
  if (v === 'done' || v === 'stop' || v === 'idle') return 'neutral';
  if (v === 'pending') return 'warn';
  if (v === 'error' || v === 'errored' || v === 'failed') return 'bad';
  return 'neutral';
}
