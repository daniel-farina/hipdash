import { useEffect, useRef, useState } from 'react';

export function usePoll<T>(
  fn: () => Promise<T>,
  intervalMs: number,
  deps: any[] = [],
): { data: T | null; error: Error | null; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const tickRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: any = null;

    const run = async () => {
      const id = ++tickRef.current;
      try {
        const result = await fnRef.current();
        if (cancelled || id !== tickRef.current) return;
        setData(result);
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const tick = async () => {
      await run();
      if (!cancelled) timer = setTimeout(tick, intervalMs);
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);

  const refresh = () => {
    fnRef.current().then(setData).catch((e) => setError(e));
  };

  return { data, error, loading, refresh };
}
