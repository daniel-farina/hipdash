import { usePoll } from '../lib/usePoll';
import { getJson } from '../lib/api';
import { fmtAge, fmtTime, shorten } from '../lib/format';
import { useSort, SortTh } from '../lib/useSort';
import Pill from '../components/Pill';
import { agentColor } from '../lib/agentColor';

type Cfg = {
  path: string;
  default: string;
  agents: Record<string, any>;
  providers: Record<string, any>;
  agent_count: number;
  mtime?: number;
};
type Usage = {
  ts: number;
  sessions: any[];
  session_count: number;
};

export default function OpencodePage() {
  const { data: cfg, error: cfgErr } = usePoll<Cfg>(() => getJson('/opencode-config.json'), 30000);
  const { data: usage } = usePoll<Usage>(() => getJson('/opencode-tool-usage.json?limit=30'), 8000);

  if (cfgErr) {
    return <div className="banner">opencode-config unreadable: {cfgErr.message}</div>;
  }

  return (
    <>
      <div className="row two">
        <div className="card">
          <div className="label">Agents</div>
          <div className="big">{cfg?.agent_count ?? 0}</div>
          <div className="meta">
            default: <code>{cfg?.default || '-'}</code> · last edit {fmtAge(cfg?.mtime ? cfg.mtime * 1000 : null)}
          </div>
        </div>
        <div className="card">
          <div className="label">Providers</div>
          <div className="big">{Object.keys(cfg?.providers || {}).length}</div>
          <div className="meta">{Object.keys(cfg?.providers || {}).join(' · ') || '-'}</div>
        </div>
      </div>

      <div className="section">
        <div className="head"><h2>Agents</h2><span className="right">{cfg?.path || ''}</span></div>
        <div className="agent-grid">
          {Object.entries(cfg?.agents || {}).map(([name, a]) => {
            const tools = a.tools || {};
            const c = agentColor(name);
            return (
              <div key={name} className="agent-card">
                <h3>
                  <span className="pill-x pill-x-tag" style={c}>{name}</span>
                  <span className={`tag ${a.mode === 'primary' ? 'mtp' : ''}`}>{a.mode || 'subagent'}</span>
                </h3>
                <div className="desc">{a.description || ''}</div>
                <div className="model">{a.model}</div>
                <div className="kpi" style={{ marginTop: 8 }}>
                  {Object.entries(tools).map(([t, on]) => (
                    <span key={t} className="tag" style={{ opacity: on ? 1 : 0.35 }}>{t}{on ? '' : ' off'}</span>
                  ))}
                </div>
                {a.prompt ? (
                  <details>
                    <summary>system prompt</summary>
                    <pre>{a.prompt}</pre>
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <InvestigationsTable sessions={usage?.sessions || []} />
    </>
  );
}

function InvestigationsTable({ sessions }: { sessions: any[] }) {
  const { sorted, sort, onSort } = useSort<any>(
    sessions,
    { key: 'updated', dir: 'desc' },
    {
      updated: (s) => s.time_updated ?? 0,
      agent:   (s) => s.agent || '',
      title:   (s) => s.title || '',
      tools:   (s) => s.tool_count ?? 0,
      files:   (s) => s.distinct_files_read?.length ?? 0,
    },
  );
  return (
    <div className="section">
      <div className="head">
        <h2>Recent investigations</h2>
        <span className="right">{sessions.length} sessions</span>
      </div>
      <div className="scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <SortTh label="updated" sortKey="updated" state={sort} onSort={onSort} />
              <SortTh label="agent"   sortKey="agent"   state={sort} onSort={onSort} />
              <SortTh label="title"   sortKey="title"   state={sort} onSort={onSort} />
              <SortTh label="tools"   sortKey="tools"   state={sort} onSort={onSort} align="right" />
              <SortTh label="files"   sortKey="files"   state={sort} onSort={onSort} align="right" />
              <th>top tools</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s: any) => (
              <tr key={s.id}>
                <td>{fmtTime(s.time_updated * 1000)}</td>
                <td><span className="pill-x pill-x-tag" style={agentColor(s.agent)}>{s.agent}</span></td>
                <td><span className="preview">{shorten(s.title || '(untitled)', 80)}</span></td>
                <td className="num">{s.tool_count}</td>
                <td className="num">{s.distinct_files_read?.length ?? 0}</td>
                <td>
                  {Object.entries(s.tool_histogram || {})
                    .sort((a: any, b: any) => b[1] - a[1])
                    .slice(0, 4)
                    .map(([k, v]) => (
                      <Pill key={k} tone="neutral" style={{ marginRight: 6 }}>{k}·{v as number}</Pill>
                    ))}
                </td>
              </tr>
            ))}
            {!sessions.length ? (
              <tr><td colSpan={6} className="dim">no sessions yet</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
