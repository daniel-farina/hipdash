import { usePoll } from '../lib/usePoll';
import { getJson, Status } from '../lib/api';
import { fmtAge } from '../lib/format';
import SavingsBadge from './SavingsBadge';

export default function Topbar() {
  const { data } = usePoll<Status>(() => getJson('/api/status'), 2000);
  const mtplxUp = data?.mtplx_alive;
  const sidecarUp = data?.sidecar_alive;
  const health = data?.last_health || {};

  return (
    <div className="topbar">
      <div className="brand">
        MTPLX dashboard
        <span className="sub">live</span>
      </div>
      <div className="health">
        <span className="pill">
          <span className={`dot ${mtplxUp ? 'up' : 'down'}`} />
          MTPLX {mtplxUp ? 'online' : 'offline'}
        </span>
        <span className="pill">
          <span className={`dot ${sidecarUp ? 'up' : 'down'}`} />
          Sidecar {sidecarUp ? 'online' : 'offline'}
        </span>
        <span className="pill">model: {health.model || '-'}</span>
        <span className="pill">runtime: {health.runtime_mode || '-'}</span>
        {data?.last_mtplx_seen ? (
          <span className="pill muted">seen {fmtAge(data.last_mtplx_seen)}</span>
        ) : null}
        <SavingsBadge />
      </div>
    </div>
  );
}
