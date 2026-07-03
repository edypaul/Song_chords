import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useSettingsStore, DEFAULT_SETTINGS, type SongListColumn } from '@song-chords/shared';
import { db } from '../../ipc/ipc-client';
import SongListColumnsEditor from './SongListColumnsEditor';

interface Props {
  /** Ref to the button that opened the popover — used to anchor it and to
   *  ignore outside-clicks on the trigger itself (which would immediately
   *  close what we just opened). */
  anchorRef: React.RefObject<HTMLButtonElement>;
  onClose: () => void;
}

/**
 * Portaled popover version of the shared columns editor. Reads and writes
 * the same two settings (`songListColumns`, `songListColumnOrder`) that
 * the Settings > Display panel edits, so changes made here are reflected
 * there instantly and vice-versa.
 */
export default function SongListColumnsPopover({ anchorRef, onClose }: Props): React.ReactElement | null {
  const settings = useSettingsStore((s) => s.settings);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const visible = settings.songListColumns ?? DEFAULT_SETTINGS.songListColumns;
  const order = settings.songListColumnOrder ?? DEFAULT_SETTINGS.songListColumnOrder;

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    const place = () => {
      const btn = anchorRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, anchorRef]);

  const onToggle = (col: SongListColumn, on: boolean) => {
    const next = { ...visible, [col]: on };
    void updateSetting(db, 'songListColumns', next);
  };
  const onReorder = (nextOrder: SongListColumn[]) => {
    void updateSetting(db, 'songListColumnOrder', nextOrder);
  };
  const onReset = () => {
    void updateSetting(db, 'songListColumns', { ...DEFAULT_SETTINGS.songListColumns });
    void updateSetting(db, 'songListColumnOrder', [...DEFAULT_SETTINGS.songListColumnOrder]);
  };

  if (!pos) return null;
  return createPortal(
    <div
      ref={ref}
      className="fixed rounded-lg shadow-2xl"
      style={{
        top: pos.top,
        right: pos.right,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        width: 280,
        maxHeight: '70vh',
        overflowY: 'auto',
        zIndex: 1000,
      }}
      role="dialog"
      aria-label="Song list columns"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Columns</span>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-[var(--surface-elevated)]"
          style={{ color: 'var(--text-muted)' }}
          title="Close (Esc)"
        >
          <X size={14} />
        </button>
      </div>
      <SongListColumnsEditor
        visible={visible}
        order={order}
        onToggle={onToggle}
        onReorder={onReorder}
        onReset={onReset}
      />
    </div>,
    document.body,
  );
}
