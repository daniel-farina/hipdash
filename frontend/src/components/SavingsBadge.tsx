import { useEffect, useRef, useState } from 'react';
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

const STORAGE_KEY = 'hipdash:savings-model';

export default function SavingsBadge() {
  const { data } = usePoll<TokenStats>(() => getJson('/api/stats/tokens'), 8000);
  const [open, setOpen] = useState(false);
  const [modelId, setModelId] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEY) || DEFAULT_MODEL_ID; }
    catch { return DEFAULT_MODEL_ID; }
  });
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, modelId); } catch {}
  }, [modelId]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const model = findModel(modelId);
  const inTok = data?.total_prompt_tokens || 0;
  const outTok = data?.total_completion_tokens || 0;
  const saved = costFor(inTok, outTok, model);

  return (
    <div className="savings-root" ref={rootRef}>
      <button
        className={`savings-pill ${open ? 'on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={`Cost if these ${data?.request_count ?? 0} turns had run on ${model.label}`}
      >
        <span className="savings-label">SAVED</span>
        <span className="savings-amount">{fmtMoney(saved)}</span>
        <span className="savings-vs">vs {model.label}</span>
        <span className="savings-caret">{open ? '▴' : '▾'}</span>
      </button>
      {open ? (
        <div className="savings-menu">
          <div className="savings-menu-head">
            <div className="lab">RUN COST ACROSS MODELS</div>
            <div className="savings-totals">
              {fmtTokens(inTok)} in · {fmtTokens(outTok)} out · {fmtInt(data?.request_count)} turns
            </div>
          </div>
          <div className="savings-row savings-row-local">
            <span className="savings-row-name">MTPLX (local)</span>
            <span className="savings-row-vendor">Apple Silicon</span>
            <span className="savings-row-cost">$0.00</span>
          </div>
          {MODELS.map((m) => {
            const c = costFor(inTok, outTok, m);
            const active = m.id === modelId;
            return (
              <button
                key={m.id}
                className={`savings-row ${active ? 'on' : ''}`}
                onClick={() => { setModelId(m.id); setOpen(false); }}
              >
                <span className="savings-row-name">{m.label}</span>
                <span className="savings-row-vendor">{m.vendor}</span>
                <span className="savings-row-cost">{fmtMoneyPrecise(c)}</span>
              </button>
            );
          })}
          <div className="savings-menu-foot">
            List prices · $ per 1M tokens · no batch/cache discount
          </div>
        </div>
      ) : null}
    </div>
  );
}
