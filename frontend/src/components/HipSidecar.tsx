import { useMemo, useState } from 'react';
import { usePoll } from '../lib/usePoll';
import { getJson } from '../lib/api';
import { fmtAge, fmtTime, shorten, shortenSessionId } from '../lib/format';
import { useSort, SortTh } from '../lib/useSort';
import Pill from './Pill';
import { agentColor } from '../lib/agentColor';

type HipSession = {
  session_id: string;
  ts_unix: number;
  cwd: string;
  first_user: string;
  conv_count: number;
  summary_count: number;
  running_summary: string[];
};

type Resp = { path?: string; mtime?: number; count?: number; sessions?: HipSession[]; error?: string };

export default function HipSidecar() {
  const { data, error } = usePoll<Resp>(() => getJson('/api/hip/sessions'), 4000);
  const [expanded, setExpanded] = useState<string | null>(null);
  const sessions = data?.sessions || [];

  const totalSummaries = useMemo(
    () => sessions.reduce((a, s) => a + (s.summary_count || 0), 0),
    [sessions],
  );

  const { sorted, sort, onSort } = useSort<HipSession>(
    sessions,
    { key: 'ts_unix', dir: 'desc' },
    {
      session_id:    (s) => s.session_id,
      cwd:           (s) => s.cwd || '',
      conv_count:    (s) => s.conv_count ?? 0,
      summary_count: (s) => s.summary_count ?? 0,
      ts_unix:       (s) => s.ts_unix ?? 0,
    },
  );

  if (error) {
    return <div className="banner">/api/hip/sessions failed: {error.message}</div>;
  }
  if (data?.error) {
    return (
      <div className="banner warn">
        {data.error} — sidecar visibility requires <code>~/.hip/sessions.jsonl</code> (override with <code>$HIP_HOME</code>).
      </div>
    );
  }

  return (
    <div className="hip-sidecar">
      <div className="hip-meta">
        <div><span className="lab">SESSIONS</span><b>{sessions.length}</b></div>
        <div><span className="lab">TOTAL SUMMARIES</span><b>{totalSummaries}</b></div>
        <div><span className="lab">FILE</span><span className="dim">{shorten(data?.path, 60)}</span></div>
        <div><span className="lab">UPDATED</span><span className="dim">{data?.mtime ? fmtAge(data.mtime) : '-'}</span></div>
      </div>

      <div className="scroll-x" style={{ marginTop: 8 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th></th>
              <SortTh label="session"      sortKey="session_id"    state={sort} onSort={onSort} />
              <SortTh label="project"      sortKey="cwd"           state={sort} onSort={onSort} />
              <th>first user</th>
              <SortTh label="conv"         sortKey="conv_count"    state={sort} onSort={onSort} align="right" />
              <SortTh label="summaries"    sortKey="summary_count" state={sort} onSort={onSort} align="right" />
              <SortTh label="updated"      sortKey="ts_unix"       state={sort} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={7} className="dim">no hip sessions yet</td></tr>
            ) : null}
            {sorted.map((s) => {
              const isOpen = expanded === s.session_id;
              const c = agentColor(s.session_id);
              const proj = s.cwd ? s.cwd.split('/').slice(-2).join('/') : '-';
              return (
                <RowFragment
                  key={s.session_id}
                  s={s}
                  isOpen={isOpen}
                  onToggle={() => setExpanded(isOpen ? null : s.session_id)}
                  color={c}
                  proj={proj}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowFragment({
  s,
  isOpen,
  onToggle,
  color,
  proj,
}: {
  s: HipSession;
  isOpen: boolean;
  onToggle: () => void;
  color: { background: string; borderColor: string; color: string };
  proj: string;
}) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer' }} className={isOpen ? 'bench-group' : undefined}>
        <td style={{ width: 14, color: 'var(--ink-faint)' }}>{isOpen ? '▾' : '▸'}</td>
        <td title={s.session_id}>
          <span className="pill-x pill-x-tag" style={color}>{shortenSessionId(s.session_id, 26)}</span>
        </td>
        <td className="dim" title={s.cwd}>{proj}</td>
        <td><span className="preview">{shorten(s.first_user || '-', 70)}</span></td>
        <td className="num">{s.conv_count}</td>
        <td className="num">
          {s.summary_count > 0 ? (
            <Pill tone="good">{s.summary_count}</Pill>
          ) : (
            <span className="dim">0</span>
          )}
        </td>
        <td>{fmtTime(s.ts_unix * 1000)} <span className="dim">· {fmtAge(s.ts_unix * 1000)}</span></td>
      </tr>
      {isOpen ? (
        <tr className="bench-group">
          <td></td>
          <td colSpan={6} style={{ borderLeft: `3px solid ${color.borderColor}`, padding: 12 }}>
            <div className="hip-summary-list">
              {s.running_summary.length === 0 ? (
                <span className="dim">no sidecar summaries for this session</span>
              ) : s.running_summary.map((line, i) => (
                <div key={i} className="hip-summary-line">
                  <span className="hip-summary-num">{i + 1}.</span>
                  <span className="hip-summary-text">{line}</span>
                </div>
              ))}
            </div>
            {s.cwd ? (
              <div className="dim" style={{ marginTop: 8, fontFamily: 'var(--mono)', fontSize: 10.5 }}>
                cwd: <code>{s.cwd}</code> · {s.conv_count} conv msgs · {s.summary_count} sidecar lines (capped at 20)
              </div>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}
