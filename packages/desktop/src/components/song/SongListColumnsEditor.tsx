import React from 'react';
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, RotateCcw } from 'lucide-react';
import { SONG_LIST_COLUMNS, type SongListColumn } from '@song-chords/shared';
import { useT } from '../../i18n';
import type { TKey } from '../../i18n';

/** Dictionary key for each column's human label. Duplicates the mapping in
 *  SongListTable, but the two files render different surfaces so keeping
 *  each local avoids a shared file the i18n keys can't live in. */
const COLUMN_LABEL_KEY: Record<SongListColumn, TKey> = {
  artist:      'songList.columns.artist',
  genre:       'songList.columns.genre',
  key:         'songList.columns.key',
  difficulty:  'songList.columns.difficulty',
  tempo:       'songList.columns.tempo',
  duration:    'songList.columns.duration',
  year:        'songList.columns.year',
  language:    'songList.columns.language',
  chordsCount: 'songList.columns.chordsCount',
  createdAt:   'songList.columns.createdAt',
};

interface Props {
  /** Current on/off state per column. */
  visible: Record<SongListColumn, boolean>;
  /** Current column order. Callers must pass a value that already includes
   *  every known column (the settings-repo sanitiser guarantees this). */
  order: SongListColumn[];
  /** Called when the user toggles a checkbox. */
  onToggle: (column: SongListColumn, on: boolean) => void;
  /** Called with the new order after a drag-and-drop. */
  onReorder: (nextOrder: SongListColumn[]) => void;
  /** Restore defaults: all columns visible in their canonical order. */
  onReset: () => void;
}

/**
 * Shared editor for the song-list columns setting: one row per column with
 * a drag handle (to reorder), a checkbox (to show/hide), and the column
 * label. Rendered inline on the Settings page AND inside the columns
 * popover that opens from the selection bar's Columns icon, so users get
 * the exact same editor from both entry points.
 *
 * Order and visibility are two separate concerns that share a single row:
 * dragging changes ONLY the position, checking changes ONLY visibility.
 */
export default function SongListColumnsEditor({ visible, order, onToggle, onReorder, onReset }: Props): React.ReactElement {
  const t = useT();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(active.id as SongListColumn);
    const to = order.indexOf(over.id as SongListColumn);
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(order, from, to));
  };

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
          {t('columns.header')}
        </span>
        <button
          onClick={onReset}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] hover:bg-[var(--surface-elevated)]"
          style={{ color: 'var(--text-muted)' }}
          title={t('columns.resetTitle')}
        >
          <RotateCcw size={11} />
          {t('columns.reset')}
        </button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ul className="py-1">
            {order.map((key) => (
              <ColumnRow
                key={key}
                columnKey={key}
                checked={visible?.[key] ?? true}
                onToggle={(on) => onToggle(key, on)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}

/**
 * A single row: `[grip] [checkbox] Label`. Only the grip participates in
 * the drag gesture — the checkbox stays a normal click target.
 */
function ColumnRow({ columnKey, checked, onToggle }: {
  columnKey: SongListColumn;
  checked: boolean;
  onToggle: (on: boolean) => void;
}): React.ReactElement {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: columnKey });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : 1,
    background: isDragging ? 'var(--surface-elevated)' : undefined,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-3 py-1.5 rounded"
    >
      <span
        {...attributes}
        {...listeners}
        className="p-1 rounded hover:bg-[var(--surface-elevated)]"
        style={{ cursor: 'grab', color: 'var(--text-muted)', touchAction: 'none' }}
        title={t('columns.dragTitle')}
        aria-label={t('columns.dragAria')}
      >
        <GripVertical size={14} />
      </span>
      <label className="flex items-center gap-2 flex-1 cursor-pointer text-xs" style={{ color: 'var(--text-primary)' }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          style={{ accentColor: 'var(--accent)' }}
        />
        <span className="truncate">{t(COLUMN_LABEL_KEY[columnKey])}</span>
      </label>
    </li>
  );
}

// Ensure the constant is referenced so tree-shakers keep the label table
// alive even if a build tool decides SONG_LIST_COLUMNS is only used for
// its type. (Cheap and side-effect-free.)
void SONG_LIST_COLUMNS;
