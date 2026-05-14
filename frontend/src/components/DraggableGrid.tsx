import { ReactNode, useState } from 'react';

type Props = {
  order: string[];
  items: Record<string, ReactNode>;
  onReorder: (next: string[]) => void;
  className?: string;
};

// Lightweight HTML5 drag-and-drop grid. Each item wraps a draggable
// `.dnd-cell` so the parent can keep its CSS grid layout. Drop targets
// highlight when dragged over.
export default function DraggableGrid({ order, items, onReorder, className }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const move = (from: string, to: string) => {
    if (from === to) return;
    const next = [...order];
    const fi = next.indexOf(from);
    const ti = next.indexOf(to);
    if (fi === -1 || ti === -1) return;
    next.splice(fi, 1);
    next.splice(ti, 0, from);
    onReorder(next);
  };

  return (
    <div className={className}>
      {order.map((id) => {
        const cell = items[id];
        if (!cell) return null;
        const isDragging = dragId === id;
        const isOver = overId === id && dragId && dragId !== id;
        return (
          <div
            key={id}
            className={`dnd-cell ${isDragging ? 'dragging' : ''} ${isOver ? 'over' : ''}`}
            draggable
            onDragStart={(e) => {
              setDragId(id);
              try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); } catch {}
            }}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            onDragOver={(e) => {
              if (!dragId || dragId === id) return;
              e.preventDefault();
              try { e.dataTransfer.dropEffect = 'move'; } catch {}
              if (overId !== id) setOverId(id);
            }}
            onDragLeave={(e) => {
              // Only clear if we're actually leaving (relatedTarget is outside)
              if (overId === id && !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
                setOverId(null);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragId || e.dataTransfer.getData('text/plain');
              if (from) move(from, id);
              setDragId(null);
              setOverId(null);
            }}
          >
            <span className="dnd-handle" aria-label="drag to reorder" title="drag to reorder">⠿</span>
            {cell}
          </div>
        );
      })}
    </div>
  );
}
