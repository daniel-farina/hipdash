import { useMemo } from 'react';
import { fmtBytes, fmtTime, shortenSessionId } from '../lib/format';
import { useSort, SortTh } from '../lib/useSort';
import Pill, { cacheTone } from './Pill';
import SessionBankChart from './SessionBankChart';

type Props = {
  sessions: any;     // /admin/sessions response
};

export default function SessionBankHistory({ sessions }: Props) {
  const bank = sessions?.session_bank || {};
  const prefixes: any[] = bank.prefixes || [];
  const evictions: any[] = bank.eviction_log || [];

  // Per-session aggregate from current prefix list
  const perSession = useMemo(() => {
    const map = new Map<string, { sid: string; bytes: number; prefix_max: number; entries: number; last_access: number }>();
    for (const p of prefixes) {
      const sid = p.session_id || '-';
      const cur = map.get(sid) || { sid, bytes: 0, prefix_max: 0, entries: 0, last_access: 0 };
      cur.bytes += p.nbytes || 0;
      cur.entries += 1;
      if ((p.prefix_len || 0) > cur.prefix_max) cur.prefix_max = p.prefix_len;
      if ((p.last_access_s || 0) > cur.last_access) cur.last_access = p.last_access_s;
      map.set(sid, cur);
    }
    return [...map.values()].sort((a, b) => b.bytes - a.bytes);
  }, [prefixes]);

  const evictionRows = useMemo(() => evictions.slice().reverse(), [evictions]);

  const { sorted: sortedEvic, sort: evicSort, onSort: evicOnSort } = useSort<any>(
    evictionRows,
    { key: 'last_access_s', dir: 'desc' },
    {
      reason:        (e) => e.reason || '',
      session_id:    (e) => e.session_id || '',
      prefix_len:    (e) => e.prefix_len ?? 0,
      nbytes:        (e) => e.nbytes ?? 0,
      last_access_s: (e) => e.last_access_s ?? 0,
    },
  );

  const { sorted: sortedPerSess, sort: psSort, onSort: psOnSort } = useSort<any>(
    perSession,
    { key: 'bytes', dir: 'desc' },
    {
      sid:        (s) => s.sid,
      bytes:      (s) => s.bytes,
      entries:    (s) => s.entries,
      prefix_max: (s) => s.prefix_max,
      last_access: (s) => s.last_access,
    },
  );

  return (
    <>
      {/* Bigger range-togglable history chart */}
      <SessionBankChart defaultKey="24h" height={200} showAxes={true} />

      <div className="row two" style={{ marginTop: 12 }}>
        <div className="card">
          <div className="label">Per-session footprint</div>
          <div className="big" style={{ fontSize: 16 }}>{perSession.length} session(s)</div>
          <div className="meta">{bank.entries ?? 0} prefixes / {bank.max_entries ?? 0} max</div>
          <div className="scroll-x" style={{ marginTop: 8 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <SortTh label="session"     sortKey="sid"         state={psSort} onSort={psOnSort} />
                  <SortTh label="bytes"       sortKey="bytes"       state={psSort} onSort={psOnSort} align="right" />
                  <SortTh label="prefixes"    sortKey="entries"     state={psSort} onSort={psOnSort} align="right" />
                  <SortTh label="max prefix"  sortKey="prefix_max"  state={psSort} onSort={psOnSort} align="right" />
                  <SortTh label="last access" sortKey="last_access" state={psSort} onSort={psOnSort} align="right" />
                </tr>
              </thead>
              <tbody>
                {sortedPerSess.length === 0 ? (
                  <tr><td colSpan={5} className="dim">no live prefixes</td></tr>
                ) : sortedPerSess.map((s) => (
                  <tr key={s.sid}>
                    <td title={s.sid}>{shortenSessionId(s.sid)}</td>
                    <td className="num">{fmtBytes(s.bytes)}</td>
                    <td className="num">{s.entries}</td>
                    <td className="num">{s.prefix_max ?? '-'}</td>
                    <td className="num">{s.last_access ? fmtTime(s.last_access * 1000) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="label">Eviction log</div>
          <div className="big" style={{ fontSize: 16 }}>{evictions.length} eviction(s)</div>
          <div className="meta">most recent first</div>
          <div className="scroll-x" style={{ marginTop: 8 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <SortTh label="reason"      sortKey="reason"        state={evicSort} onSort={evicOnSort} />
                  <SortTh label="session"     sortKey="session_id"    state={evicSort} onSort={evicOnSort} />
                  <SortTh label="prefix"      sortKey="prefix_len"    state={evicSort} onSort={evicOnSort} align="right" />
                  <SortTh label="bytes"       sortKey="nbytes"        state={evicSort} onSort={evicOnSort} align="right" />
                  <SortTh label="last access" sortKey="last_access_s" state={evicSort} onSort={evicOnSort} align="right" />
                </tr>
              </thead>
              <tbody>
                {sortedEvic.length === 0 ? (
                  <tr><td colSpan={5} className="dim">no evictions yet</td></tr>
                ) : sortedEvic.map((e: any, i: number) => (
                  <tr key={i}>
                    <td><Pill tone={cacheTone(e.reason)}>{e.reason || '-'}</Pill></td>
                    <td title={e.session_id || ''}>{shortenSessionId(e.session_id)}</td>
                    <td className="num">{e.prefix_len ?? '-'}</td>
                    <td className="num">{fmtBytes(e.nbytes)}</td>
                    <td className="num">{e.last_access_s ? fmtTime(e.last_access_s * 1000) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
