import { useState } from 'react';
import { usePoll } from '../lib/usePoll';
import { getJson, Restart } from '../lib/api';
import { fmtAge, fmtDateTime } from '../lib/format';

const RANGES = [
  { ms: 60 * 60 * 1000,           label: '1h' },
  { ms: 24 * 60 * 60 * 1000,      label: '24h' },
  { ms: 7 * 24 * 60 * 60 * 1000,  label: '7d' },
  { ms: 30 * 24 * 60 * 60 * 1000, label: '30d' },
];

export default function RestartsPage() {
  const [range, setRange] = useState(RANGES[1]);
  const { data } = usePoll<{ restarts: Restart[] }>(
    () => getJson(`/api/history/restarts?range_ms=${range.ms}`),
    10000,
    [range.ms],
  );
  const [open, setOpen] = useState<number | null>(null);
  const restarts = data?.restarts || [];

  return (
    <>
      <div className="section" style={{ marginTop: 4 }}>
        <div className="head">
          <h2>Restart history</h2>
          <span className="right">
            {RANGES.map((r) => (
              <button
                key={r.label}
                className="btn"
                onClick={() => setRange(r)}
                style={{
                  marginLeft: 6,
                  background: range.label === r.label ? 'rgba(255,255,255,0.07)' : undefined,
                  borderColor: range.label === r.label ? 'var(--line-3)' : undefined,
                }}
              >
                {r.label}
              </button>
            ))}
          </span>
        </div>

        <div className="card">
          {restarts.length === 0 ? (
            <div className="dim">no restart events recorded in this window.</div>
          ) : (
            restarts.map((r) => (
              <div key={r.id} style={{ borderBottom: '1px solid var(--line)', padding: '8px 0' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, fontFamily: 'var(--mono)', fontSize: 12 }}>
                  <span className={`badge ${r.target === 'mtplx' ? 'mtp' : 'ar'}`}>{r.target}</span>
                  <b style={{ color: 'var(--ink)' }}>{fmtDateTime(r.ts)}</b>
                  <span className="muted">{fmtAge(r.ts)}</span>
                  {r.detail?.initial ? <span className="tag">first observed</span> : null}
                  <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setOpen(open === r.id ? null : r.id)}>
                    {open === r.id ? 'hide' : 'detail'}
                  </button>
                </div>
                {open === r.id ? (
                  <pre style={{
                    margin: '10px 0 0',
                    padding: 10,
                    background: 'var(--bg-1)',
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    fontSize: 11,
                    color: 'var(--ink-dim)',
                    overflow: 'auto',
                    maxHeight: 280,
                  }}>{JSON.stringify(r.detail, null, 2)}</pre>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
