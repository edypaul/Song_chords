import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { formatShortcut, shortcutFromEvent } from '../../utils/shortcut';

interface Props {
  value: string;
  onChange: (next: string) => void;
}

/**
 * Click-to-record shortcut input. First click puts the input in "listening"
 * mode; the next non-modifier keypress is stored as the new binding. Escape
 * cancels, and the × button clears the current binding (disables the action).
 */
export default function ShortcutRecorder({ value, onChange }: Props): React.ReactElement {
  const [listening, setListening] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!listening) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setListening(false); return; }
      const next = shortcutFromEvent(e);
      if (next) {
        onChange(next);
        setListening(false);
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [listening, onChange]);

  // Clicking outside the recorder while listening cancels the capture.
  useEffect(() => {
    if (!listening) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setListening(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [listening]);

  return (
    <div ref={wrapRef} className="flex items-center gap-2 min-w-[10rem]">
      <button
        type="button"
        onClick={() => setListening((v) => !v)}
        className="px-3 py-1.5 rounded-lg text-xs font-mono min-w-[8rem] text-left"
        style={{
          background: listening ? 'var(--accent)' : 'var(--surface-elevated)',
          color: listening ? 'white' : (value ? 'var(--text-primary)' : 'var(--text-muted)'),
          border: `1px solid ${listening ? 'var(--accent)' : 'var(--border)'}`,
        }}
        title={listening ? 'Press any key combination…' : 'Click to rebind'}
      >
        {listening ? 'Press keys…' : (value ? formatShortcut(value) : '(unbound)')}
      </button>
      {value && !listening && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="p-1.5 rounded hover:bg-[var(--surface-elevated)]"
          title="Clear binding"
        >
          <X size={12} style={{ color: 'var(--text-muted)' }} />
        </button>
      )}
    </div>
  );
}
