import React from 'react';
import { Star, GripVertical } from 'lucide-react';
import type { Song, SongListColumn } from '@song-chords/shared';
import { useSettingsStore, DEFAULT_SETTINGS } from '@song-chords/shared';
import { db } from '../../ipc/ipc-client';
import { toTitleCase } from '../../utils/text';
import PlayLinkButton from './PlayLinkButton';
import NotesLinkButton from './NotesLinkButton';
import AnnotationsLinkButton from './AnnotationsLinkButton';
import { useT } from '../../i18n';
import type { TKey } from '../../i18n';
import {
  DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, horizontalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/** Dictionary key for each optional column header label. Kept local so the
 *  header re-renders in the active language via `useT`. */
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

/** Dictionary keys for each difficulty level (index matches value 0..5). */
const DIFFICULTY_KEYS: TKey[] = [
  'songList.difficulty.unset',
  'songList.difficulty.basic',
  'songList.difficulty.easy',
  'songList.difficulty.intermediate',
  'songList.difficulty.advanced',
  'songList.difficulty.professional',
];

/** Every field the user can sort by — the union of Title + every optional
 *  column. Callers only sort by the ones their store supports; the type
 *  covers all of them so a single header can pass them through. */
export type SortableField = 'title' | SongListColumn;

/** Alignment + width metadata for each column, so both the header cell and
 *  the row cell agree on layout without duplicating classes at every call
 *  site. `right` right-aligns numeric columns; the widths keep long
 *  languages / dates from stealing space from the title column. */
const COLUMN_META: Record<SongListColumn, { align: 'left' | 'right'; width?: string; extra?: string }> = {
  artist:      { align: 'left'  },
  genre:       { align: 'left',  width: 'w-28' },
  key:         { align: 'left',  width: 'w-16' },
  difficulty:  { align: 'left',  width: 'w-32' },
  tempo:       { align: 'right', width: 'w-24', extra: 'whitespace-nowrap' },
  duration:    { align: 'right', width: 'w-20', extra: 'whitespace-nowrap' },
  year:        { align: 'left',  width: 'w-20' },
  language:    { align: 'left',  width: 'w-28' },
  chordsCount: { align: 'right', width: 'w-20' },
  createdAt:   { align: 'left',  width: 'w-28' },
};

export interface SongListTableProps {
  songs: Song[];
  selectedIds: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: () => void;
  /** Optional per-song context menu handler (right-click). */
  onContextMenu?: (song: Song, e: React.MouseEvent) => void;
  /** Row click handler — pages route to different URLs (e.g. `?favorite=1`),
   *  so this is a callback rather than a hardcoded destination. */
  onRowClick: (song: Song) => void;
  /** Columns to hide for the current context regardless of settings. Used
   *  by the Categories page to hide the column matching the active
   *  category (e.g. hide the Key column while browsing "By Key → G"). */
  forceHidden?: ReadonlySet<SongListColumn>;
  /** Whether the row's title should show a favourite star (`Library` uses
   *  `song.favorite`; `Favorites` hides it because every row IS favourite). */
  showFavoriteStar?: boolean;
  /** Current sort field + direction, and how to change them. */
  sortField: string;
  sortDirection: 'asc' | 'desc';
  onSort: (field: SortableField) => void;
}

/**
 * Shared song-list table used by the Library, Favorites and Categories
 * pages. Owns the header + rows and the drag-and-drop column reordering.
 *
 * The header is a horizontal DnD list backed by the persisted
 * `songListColumnOrder` setting: drag a header cell to reorder, drop
 * writes the new order via `updateSetting`. Optional columns can be
 * shown/hidden via the checkboxes in the Columns popover (or Settings >
 * Display > Song list columns). Title and the audio-source icon column
 * are fixed and never move / hide.
 */
export default function SongListTable(props: SongListTableProps): React.ReactElement {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const visible = settings.songListColumns ?? DEFAULT_SETTINGS.songListColumns;
  const order = settings.songListColumnOrder ?? DEFAULT_SETTINGS.songListColumnOrder;

  // Which optional columns actually render, in order.
  const visibleOrdered: SongListColumn[] = order.filter((c) => {
    if (props.forceHidden?.has(c)) return false;
    return visible?.[c] ?? true;
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    // Reorder against the FULL persisted order (not the filtered visible
    // list) so hidden columns keep their position. The DnD items we render
    // are the visible-only ones — but arrayMove on the full order using
    // the indices of the two keys handles that transparently.
    const from = order.indexOf(active.id as SongListColumn);
    const to = order.indexOf(over.id as SongListColumn);
    if (from === -1 || to === -1) return;
    void updateSetting(db, 'songListColumnOrder', arrayMove(order, from, to));
  };

  const allChecked = props.songs.length > 0 && props.selectedIds.size === props.songs.length;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="sticky top-0" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
          <th className="w-10 px-3 py-2">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={props.onToggleAll}
              aria-label={t('songList.selectAll')}
            />
          </th>
          <SortTh
            field="title"
            label={t('songList.columns.title')}
            align="left"
            extra="px-6"
            active={props.sortField}
            dir={props.sortDirection}
            onClick={props.onSort}
          />
          <th className="w-10 px-2 py-2" aria-label={t('songList.playAudioSource')} />
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={visibleOrdered} strategy={horizontalListSortingStrategy}>
              {visibleOrdered.map((col) => (
                <SortableHeaderCell
                  key={col}
                  column={col}
                  active={props.sortField}
                  dir={props.sortDirection}
                  onClick={props.onSort}
                />
              ))}
            </SortableContext>
          </DndContext>
        </tr>
      </thead>
      <tbody>
        {props.songs.map((song) => (
          <SongRow
            key={song.id}
            song={song}
            columns={visibleOrdered}
            selected={props.selectedIds.has(song.id)}
            showFavoriteStar={props.showFavoriteStar ?? false}
            onToggle={() => props.onToggleRow(song.id)}
            onClick={() => props.onRowClick(song)}
            onContextMenu={(e) => props.onContextMenu?.(song, e)}
          />
        ))}
      </tbody>
    </table>
  );
}

/**
 * One sortable, draggable header cell. The whole `<th>` is the drag
 * source AND the sort trigger — a short pointer drag reorders; a click
 * with no movement sorts. `PointerSensor.activationConstraint.distance`
 * separates the two gestures so the sort click still fires.
 */
function SortableHeaderCell({ column, active, dir, onClick }: {
  column: SongListColumn;
  active: string;
  dir: 'asc' | 'desc';
  onClick: (field: SortableField) => void;
}): React.ReactElement {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column });
  const meta = COLUMN_META[column];
  const isActive = active === column;
  const arrow = isActive ? (dir === 'asc' ? '▲' : '▼') : '';
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
    background: isDragging ? 'var(--surface-elevated)' : undefined,
    cursor: isDragging ? 'grabbing' : 'pointer',
    color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
    touchAction: 'none',
  };
  return (
    <th
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick(column)}
      className={`group px-4 py-2 font-medium select-none ${meta.align === 'right' ? 'text-right' : 'text-left'} ${meta.width ?? ''} ${meta.extra ?? ''}`}
      title={t('songList.headerTitle')}
    >
      {/* Inline row so the grip sits BEFORE the label on left-aligned
          columns and AFTER it on right-aligned ones, keeping the label
          anchored to its expected edge. The grip fades in on hover so
          it's an unobtrusive discovery cue at rest but obvious once
          the user's over the header. Always visible (dim) while dragging
          so the affordance persists through the interaction. */}
      <span
        className={`inline-flex items-center gap-1 ${meta.align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        <GripVertical
          size={12}
          className="opacity-0 group-hover:opacity-60 transition-opacity"
          style={{
            color: 'var(--text-muted)',
            opacity: isDragging ? 0.6 : undefined,
            flexShrink: 0,
          }}
          aria-hidden="true"
        />
        <span>{t(COLUMN_LABEL_KEY[column])}</span>
        {arrow && <span className="text-[10px]" style={{ color: 'var(--accent)' }}>{arrow}</span>}
      </span>
    </th>
  );
}

/** Non-sortable header for Title (kept out of the DnD list). */
function SortTh({
  field, label, align, width, extra, active, dir, onClick,
}: {
  field: SortableField;
  label: string;
  align: 'left' | 'right';
  width?: string;
  extra?: string;
  active: string;
  dir: 'asc' | 'desc';
  onClick: (field: SortableField) => void;
}): React.ReactElement {
  const isActive = active === field;
  const arrow = isActive ? (dir === 'asc' ? '▲' : '▼') : '';
  return (
    <th
      onClick={() => onClick(field)}
      className={`px-4 py-2 font-medium cursor-pointer select-none ${align === 'right' ? 'text-right' : 'text-left'} ${width ?? ''} ${extra ?? ''}`}
      style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-muted)' }}
    >
      <span>{label}</span>
      {arrow && <span className="ml-1 text-[10px]" style={{ color: 'var(--accent)' }}>{arrow}</span>}
    </th>
  );
}

/**
 * One song row. The cells for optional columns are rendered in the same
 * order the header uses (`columns`), so drag-and-drop reordering in the
 * header automatically reorders the body — no per-cell reshuffling
 * needed at the call sites.
 */
function SongRow({
  song, columns, selected, showFavoriteStar, onToggle, onClick, onContextMenu,
}: {
  song: Song;
  columns: SongListColumn[];
  selected: boolean;
  showFavoriteStar: boolean;
  onToggle: () => void;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}): React.ReactElement {
  const t = useT();
  return (
    <tr
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="cursor-pointer border-b transition-colors hover:bg-[var(--surface-elevated)]"
      style={{ borderColor: 'var(--border)', background: selected ? 'var(--surface-elevated)' : undefined }}
    >
      <td className="w-10 px-3 py-3" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={t('songList.selectRow', { title: song.title })} />
      </td>
      <td className="px-6 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>
        <span className="inline-flex items-center gap-2">
          {showFavoriteStar && song.favorite && <Star size={12} style={{ color: 'var(--accent)' }} fill="currentColor" />}
          {toTitleCase(song.title)}
        </span>
      </td>
      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
        <span className="inline-flex items-center">
          <PlayLinkButton title={song.title} link={song.link} audioFile={song.audioFile} />
          <NotesLinkButton title={song.title} notes={song.notes} />
          <AnnotationsLinkButton title={song.title} annotationsJson={song.annotations} />
        </span>
      </td>
      {columns.map((col) => (
        <Cell key={col} column={col} song={song} />
      ))}
    </tr>
  );
}

function Cell({ column, song }: { column: SongListColumn; song: Song }): React.ReactElement {
  switch (column) {
    case 'artist':
      return <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{song.artist ? toTitleCase(song.artist) : '—'}</td>;
    case 'genre':
      return <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{song.genre ? toTitleCase(song.genre) : '—'}</td>;
    case 'key':
      return <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--chord-color)' }}>{song.key ?? '—'}</td>;
    case 'difficulty':
      return <td className="px-4 py-3"><DifficultyCell value={song.difficulty} /></td>;
    case 'tempo':
      return <td className="px-4 py-3 text-xs whitespace-nowrap text-right font-mono" style={{ color: 'var(--text-muted)' }}>{song.tempo ? `${song.tempo} BPM` : '—'}</td>;
    case 'duration':
      return <td className="px-4 py-3 text-xs whitespace-nowrap text-right font-mono" style={{ color: 'var(--text-muted)' }}>{song.duration ?? '—'}</td>;
    case 'year':
      return <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{song.year ?? '—'}</td>;
    case 'language':
      return <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{song.language ? toTitleCase(song.language) : '—'}</td>;
    case 'chordsCount':
      return <td className="px-4 py-3 text-xs font-mono text-right" style={{ color: 'var(--text-muted)' }}>{song.chordsCount ?? 0}</td>;
    case 'createdAt':
      return <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(song.createdAt).toLocaleDateString()}</td>;
  }
}

function DifficultyCell({ value }: { value?: number }): React.ReactElement {
  const t = useT();
  const level = value ?? 0;
  if (level <= 0) return <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>;
  const dKey = DIFFICULTY_KEYS[level];
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-mono"
      title={dKey ? t(dKey) : ''}
      style={{ color: 'var(--accent)' }}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} style={{ opacity: n <= level ? 1 : 0.25 }}>
          {n <= level ? '★' : '☆'}
        </span>
      ))}
    </span>
  );
}
