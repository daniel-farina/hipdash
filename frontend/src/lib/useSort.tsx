import { useMemo, useState, useCallback } from 'react';

export type SortDir = 'asc' | 'desc';
export type SortState = { key: string | null; dir: SortDir };

export function useSort<T>(
  rows: T[],
  initial: SortState = { key: null, dir: 'desc' },
  accessors: Record<string, (row: T) => any> = {},
) {
  const [sort, setSort] = useState<SortState>(initial);

  const onSort = useCallback((key: string) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: 'desc' };
      if (prev.dir === 'desc') return { key, dir: 'asc' };
      return { key: null, dir: 'desc' };
    });
  }, []);

  const sorted = useMemo(() => {
    if (!sort.key) return rows;
    const key = sort.key;
    const get = accessors[key] || ((r: any) => r[key]);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, sort, accessors]);

  return { sorted, sort, onSort };
}

type Props = {
  label: string;
  sortKey: string;
  state: SortState;
  onSort: (key: string) => void;
  align?: 'left' | 'right';
  width?: number | string;
};

export function SortTh({ label, sortKey, state, onSort, align, width }: Props) {
  const active = state.key === sortKey;
  const arrow = !active ? '↕' : state.dir === 'asc' ? '↑' : '↓';
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{ cursor: 'pointer', textAlign: align ?? 'left', width, userSelect: 'none' }}
      className={align === 'right' ? 'num' : undefined}
    >
      {label}
      <span style={{ marginLeft: 6, color: active ? 'var(--ink-dim)' : 'var(--ink-faint)', opacity: active ? 1 : 0.45 }}>
        {arrow}
      </span>
    </th>
  );
}
