import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, Music, ListMusic, CornerDownLeft, X } from 'lucide-react';
import { useSongStore, useSetListStore, useSettingsStore, formatChord } from '@song-chords/shared';
import { matchShortcut } from '../../utils/shortcut';
import { searchLibrary, matchFieldLabel, type SearchResult } from '../../utils/global-search';
import { toTitleCase } from '../../utils/text';
import { useT } from '../../i18n';

/**
 * App-wide search overlay. Opens from anywhere via the configurable
 * `openSearch` shortcut (default Ctrl+K) and searches the whole library —
 * songs (title, artist, album, genre, key, tags, language, year, lyrics,
 * notes) and set lists — then navigates to the chosen result.
 *
 * Mounted once inside the router shell (it needs `useNavigate`). It owns
 * its own open state and a global keydown listener that fires even while
 * the user is typing in a field, so Ctrl+K always works.
 */
export default function GlobalSearch(): React.ReactElement | null {
  const t = useT();
  const navigate = useNavigate();
  const songs = useSongStore((s) => s.songs);
  const setlists = useSetListStore((s) => s.setlists);
  const openBinding = useSettingsStore((s) => s.settings.shortcuts?.openSearch);
  const notation = useSettingsStore((s) => s.settings.chordNotation ?? 'letter');

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Global open shortcut. Listens in the capture phase and ignores the
  // "editable target" guard the page-level shortcut hook applies, so the
  // overlay opens even while the user is typing somewhere.
  useEffect(() => {
    const binding = openBinding || 'Ctrl+Space';
    const onKey = (e: KeyboardEvent) => {
      if (matchShortcut(e, binding)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [openBinding]);

  // Reset transient state each time the overlay opens, and focus the input.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // Focus after paint so the autoFocus + portal mount have settled.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(
    () => searchLibrary(query, songs, setlists),
    [query, songs, setlists],
  );
  const hasTyped = query.trim() !== '';
  const hasResults = results.length > 0;

  // Clamp the active index whenever the result set changes.
  useEffect(() => { setActive(0); }, [query]);

  const close = () => setOpen(false);

  const choose = (r: SearchResult | undefined) => {
    if (!r) return;
    setOpen(false);
    navigate(r.to);
  };

  // Keep the active row scrolled into view as the user arrows through.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex justify-center items-start"
      style={{ background: 'rgba(0,0,0,0.45)', paddingTop: '12vh' }}
      onMouseDown={close}
    >
      <div
        className="flex flex-col rounded-xl shadow-2xl overflow-hidden"
        style={{
          width: 'min(680px, 92vw)',
          // Height hugs the content: just the input bar when empty, and
          // the results panel only appears once there are matches.
          maxHeight: '70vh',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Search input row */}
        <div
          className="flex items-center gap-3 px-4 shrink-0"
          style={{ height: 56, borderBottom: hasResults ? '1px solid var(--border)' : undefined }}
        >
          <Search size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder={t('search.placeholder')}
            className="flex-1 bg-transparent outline-none text-base"
            style={{ color: 'var(--text-primary)' }}
            spellCheck={false}
          />
          <button
            onClick={close}
            className="p-1 rounded hover:bg-[var(--surface-elevated)]"
            title={t('search.closeTitle')}
          >
            <X size={16} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* "No results" feedback — only after the user has typed. Kept as a
            single compact line so the overlay doesn't balloon to full height
            when nothing matches. */}
        {hasTyped && !hasResults && (
          <div
            className="px-4 py-3 text-sm shrink-0"
            style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}
          >
            {t('search.noResults', { query: query.trim() })}
          </div>
        )}

        {/* Results panel — rendered ONLY when there are matches, so the
            overlay stays as a slim bar until the user types something that
            matches. */}
        {hasResults && (
          <div ref={listRef} className="overflow-y-auto py-1" style={{ minHeight: 0 }}>
            {results.map((r, i) => (
              <button
                key={r.id}
                data-idx={i}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r)}
                className="w-full flex items-center gap-3 px-4 py-2 text-left"
                style={{
                  background: i === active ? 'var(--surface-elevated)' : 'transparent',
                }}
              >
                <span
                  className="flex items-center justify-center rounded-md shrink-0"
                  style={{ width: 30, height: 30, background: 'var(--surface)', color: 'var(--accent)' }}
                >
                  {r.kind === 'song' ? <Music size={15} /> : <ListMusic size={15} />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {r.kind === 'song' ? toTitleCase(r.title) : r.title}
                  </span>
                  <span className="block truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                    {/* "why it matched" + the secondary line */}
                    <span style={{ color: 'var(--accent)' }}>{matchFieldLabel(r.matchField)}</span>
                    {r.matchSnippet ? <> · {renderSnippet(r, notation)}</> : null}
                    {r.subtitle ? <> · {r.kind === 'song' ? toTitleCase(r.subtitle) : r.subtitle}</> : null}
                  </span>
                </span>
                {i === active && (
                  <CornerDownLeft size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Footer hint — only when results are showing. */}
        {hasResults && (
        <div
          className="flex items-center gap-4 px-4 py-2 text-[11px] shrink-0"
          style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}
        >
          <span><Kbd>↑</Kbd><Kbd>↓</Kbd> {t('search.hint.navigate')}</span>
          <span><Kbd>↵</Kbd> {t('search.hint.open')}</span>
          <span><Kbd>Esc</Kbd> {t('search.hint.close')}</span>
          <span className="ml-auto">{t(results.length === 1 ? 'search.resultsOne' : 'search.resultsMany', { count: results.length })}</span>
        </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Format the match snippet — for a key match, render it in the user's
 *  chosen notation so a search for "C#m" reads consistently. */
function renderSnippet(r: SearchResult, notation: 'letter' | 'latin'): string {
  if (r.matchField === 'key' && r.matchSnippet) {
    return formatChord(r.matchSnippet, notation);
  }
  return r.matchSnippet ?? '';
}

function Kbd({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <kbd
      className="inline-flex items-center justify-center rounded px-1 mx-0.5 font-mono"
      style={{
        minWidth: 16, height: 16, fontSize: 10,
        background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
      }}
    >
      {children}
    </kbd>
  );
}
