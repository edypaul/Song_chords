import React from 'react';
import { ChevronUp, ChevronDown, RotateCcw } from 'lucide-react';
import { usePlayerStore } from '@song-chords/shared';
import { useShortcutHint, useCapoHint } from '../../hooks/useShortcutHint';
import { useT } from '../../i18n';

export default function TransposeControl(): React.ReactElement {
  const { transposeSteps, transposeUp, transposeDown, resetTranspose, capo, setCapo } = usePlayerStore();
  const hint = useShortcutHint();
  const capoHint = useCapoHint();
  const t = useT();

  return (
    <div className="flex items-center gap-3 text-sm">
      <span style={{ color: 'var(--text-muted)' }}>{t('transpose.label')}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={transposeDown}
          className="p-1 rounded hover:bg-[var(--surface-elevated)] transition-colors"
          title={`${t('transpose.down')}${hint('transposeDown')}`}
        >
          <ChevronDown size={16} />
        </button>
        <span
          className="w-8 text-center font-mono font-semibold"
          style={{ color: transposeSteps !== 0 ? 'var(--accent)' : 'var(--text-primary)' }}
        >
          {transposeSteps > 0 ? `+${transposeSteps}` : transposeSteps}
        </span>
        <button
          onClick={transposeUp}
          className="p-1 rounded hover:bg-[var(--surface-elevated)] transition-colors"
          title={`${t('transpose.up')}${hint('transposeUp')}`}
        >
          <ChevronUp size={16} />
        </button>
        {transposeSteps !== 0 && (
          <button
            onClick={resetTranspose}
            className="p-1 rounded hover:bg-[var(--surface-elevated)] transition-colors"
            title={`${t('transpose.reset')}${hint('resetTranspose')}`}
          >
            <RotateCcw size={14} style={{ color: 'var(--text-muted)' }} />
          </button>
        )}
      </div>

      <span style={{ color: 'var(--text-muted)' }}>{t('transpose.capo')}</span>
      <select
        value={capo}
        onChange={(e) => setCapo(Number(e.target.value))}
        className="text-xs rounded px-2 py-1"
        style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        title={`${t('transpose.capo')}${capoHint}`}
      >
        {Array.from({ length: 12 }, (_, i) => (
          <option key={i} value={i}>{i === 0 ? t('transpose.capoNone') : t('transpose.capoFret', { fret: i })}</option>
        ))}
      </select>
    </div>
  );
}
