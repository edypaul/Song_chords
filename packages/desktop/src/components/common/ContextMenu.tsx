import React, { useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface ContextMenuItem {
  icon?: LucideIcon;
  label: string;
  onClick: () => void;
  danger?: boolean;
  separator?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * Floating menu pinned to the (x, y) viewport coordinate. Closes on outside
 * click, Escape, or window scroll/resize. Clamps to the viewport edges so it
 * never renders off-screen.
 */
export default function ContextMenu({ x, y, items, onClose }: Props): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      // Capture + stopImmediatePropagation so page-level Escape handlers
      // don't also fire (otherwise closing the menu would also navigate).
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    const handleScrollOrResize = () => onClose();
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey, { capture: true });
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey, { capture: true });
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [onClose]);

  // Clamp so the menu never overflows the viewport.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) el.style.left = `${Math.max(0, vw - rect.width - 4)}px`;
    if (rect.bottom > vh) el.style.top = `${Math.max(0, vh - rect.height - 4)}px`;
  }, []);

  return (
    <div
      ref={ref}
      className="fixed z-[300] rounded-lg py-1 shadow-lg min-w-[180px]"
      style={{ left: x, top: y, background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
      onClick={(e) => e.stopPropagation()}
      role="menu"
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="my-1 h-px" style={{ background: 'var(--border)' }} />
        ) : (
          <button
            key={i}
            // Items are responsible for closing the menu themselves. The
            // auto-close used to unmount the host component before a modal-
            // opening item's state update could commit — so "Song info",
            // "Add to play list", and "Delete" never rendered their dialogs.
            onClick={() => item.onClick()}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-[var(--surface-elevated)] transition-colors"
            style={{ color: item.danger ? 'var(--danger)' : 'var(--text-primary)' }}
            role="menuitem"
          >
            {item.icon && <item.icon size={14} style={{ opacity: 0.8 }} />}
            <span>{item.label}</span>
          </button>
        ),
      )}
    </div>
  );
}
