import { useCallback, useEffect, useRef, useState } from 'react';

// Fetches the saved order for `key` from /api/layout/:key, merges with the
// caller's defaultIds (so newly added charts appear at the end without losing
// the user's tweaks), and saves on every change.
export function useLayoutOrder(key: string, defaultIds: string[]) {
  const [order, setOrder] = useState<string[]>(defaultIds);
  const loadedRef = useRef(false);
  const defaultRef = useRef(defaultIds);
  defaultRef.current = defaultIds;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/layout/${encodeURIComponent(key)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const saved: string[] | null = Array.isArray(data?.order) ? data.order : null;
        if (saved) {
          const defaults = defaultRef.current;
          const allowed = new Set(defaults);
          const seen = new Set<string>();
          const merged: string[] = [];
          for (const id of saved) {
            if (allowed.has(id) && !seen.has(id)) {
              merged.push(id);
              seen.add(id);
            }
          }
          for (const id of defaults) {
            if (!seen.has(id)) merged.push(id);
          }
          setOrder(merged);
        }
        loadedRef.current = true;
      })
      .catch(() => {
        loadedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const persist = useCallback(
    (next: string[]) => {
      setOrder(next);
      // Don't write back before the initial load completes — that would race
      // and could overwrite the saved order with the unmerged defaults.
      if (!loadedRef.current) return;
      fetch(`/api/layout/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: next }),
      }).catch(() => {});
    },
    [key],
  );

  const reset = useCallback(() => {
    persist(defaultRef.current);
  }, [persist]);

  return { order, setOrder: persist, reset, ready: loadedRef.current };
}
