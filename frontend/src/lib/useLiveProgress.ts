import { useEffect, useState } from 'react';

export type ProgressEvent = {
  session_id: string;
  ts: number;
  completion_tokens?: number | null;
  decode_tok_s?: number | null;
  prefill_tok_s?: number | null;
  ttft_s?: number | null;
  mode?: string | null;
  mtp_depth?: number | null;
  finished?: boolean;
};

// Subscribes to /api/live-progress and returns a map of session_id -> latest
// event. Empty map until the first event arrives. The map is replaced on each
// event so React picks up changes; values for finished sessions are cleared
// after a short grace period.
export function useLiveProgress(): Record<string, ProgressEvent> {
  const [byId, setById] = useState<Record<string, ProgressEvent>>({});

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimer: any = null;
    let stopped = false;

    const open = () => {
      if (stopped) return;
      es = new EventSource('/api/live-progress');
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as ProgressEvent;
          if (!data.session_id) return;
          setById((prev) => {
            if (data.finished) {
              const { [data.session_id]: _, ...rest } = prev;
              return rest;
            }
            return { ...prev, [data.session_id]: data };
          });
        } catch { /* skip malformed */ }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        if (!stopped) retryTimer = setTimeout(open, 2000);
      };
    };
    open();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, []);

  return byId;
}
