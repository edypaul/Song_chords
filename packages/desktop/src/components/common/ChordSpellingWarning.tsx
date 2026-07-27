import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useT } from '../../i18n';

/**
 * Reusable notice shown on every surface where the user is bringing
 * outside chord content into the app: the Settings page library
 * import dialog, the Import page, and the new-song / song-edit page.
 *
 * The app's chord-diagram engine recognises a fixed set of canonical
 * spellings (plus a small alias table for `aug`/`dim`/`sus`/`ø`/
 * parenthesised `(add9)`/`(sus2)`/`(sus4)`). Anything outside that
 * vocabulary — e.g. `Cm7-5` instead of `Cm7b5`, `Cma7` for `Cmaj7`,
 * `C△` for `Cmaj7` — will not match a diagram and the chord chart
 * will render BLANK. This message warns the user up front so a blank
 * chart on an imported song reads as a notation issue, not a bug.
 *
 * `variant`:
 *   - 'banner' (default) is the full-width inline notice used on the
 *     Import / Song-edit pages.
 *   - 'inline' is a compact version that fits inside the Settings
 *     "Replace / Combine" library-import dialog.
 */
export default function ChordSpellingWarning({
  variant = 'banner',
  onClose,
  onDontShowAgain,
}: {
  variant?: 'banner' | 'inline';
  /** When set, a small × button appears in the corner that calls
   *  this. The component itself does NOT manage dismissed state —
   *  the caller chooses how (and whether) to hide the banner. Use
   *  this for an EPHEMERAL dismiss (the banner returns next visit).
   *  When omitted (e.g. inside the Settings library-import
   *  confirmation dialog where the warning IS the message) the
   *  close button is suppressed. */
  onClose?: () => void;
  /** When set, a "Don't show again" link appears under the body
   *  text. Use this for a PERSISTENT dismiss the caller writes to
   *  app settings, so the banner stays hidden across app restarts.
   *  Independent of `onClose`: callers may provide either, both, or
   *  neither (e.g. the confirmation dialog provides neither). */
  onDontShowAgain?: () => void;
}): React.ReactElement {
  const t = useT();
  const isBanner = variant === 'banner';
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-lg relative"
      style={{
        padding: isBanner ? '10px 12px' : '8px 10px',
        // Reserve room on the right for the dismiss button so the
        // text never sits underneath it. Harmless when `onClose` is
        // unset — extra empty padding on the right.
        paddingRight: onClose ? (isBanner ? 36 : 32) : undefined,
        background: 'color-mix(in srgb, #f59e0b 14%, transparent)',
        border: '1px solid color-mix(in srgb, #f59e0b 45%, transparent)',
        color: 'var(--text-primary)',
        fontSize: isBanner ? 12 : 11,
        lineHeight: 1.5,
      }}
    >
      <AlertTriangle
        size={isBanner ? 16 : 14}
        style={{ color: '#f59e0b', flexShrink: 0, marginTop: 1 }}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p style={{ fontWeight: 600, marginBottom: 2 }}>
          {t('chordSpelling.title')}
        </p>
        <p style={{ color: 'var(--text-secondary)' }}>
          {t('chordSpelling.body.prefix')}
          <strong>{t('chordSpelling.body.emphasis')}</strong>
          {t('chordSpelling.body.middle')}
          <code>Cmaj7</code>, <code>Cm7b5</code>, <code>C°</code>,{' '}
          <code>C+</code>, <code>Csus4</code>
          {t('chordSpelling.body.aliases')}
          <code>aug</code>, <code>dim</code>, <code>sus</code>,{' '}
          <code>ø</code>
          {t('chordSpelling.body.and')}
          <code>(add9)</code>/<code>(sus2)</code>/<code>(sus4)</code>
          {t('chordSpelling.body.differentPrefix')}
          <code>Cma7</code>, <code>Cm7-5</code>, <code>C△</code>
          {t('chordSpelling.body.differentSuffix')}
        </p>
        {onDontShowAgain && (
          <button
            type="button"
            onClick={onDontShowAgain}
            className="hover:underline"
            style={{
              marginTop: 6,
              padding: 0,
              background: 'transparent',
              border: 0,
              color: 'var(--text-muted)',
              fontSize: isBanner ? 11 : 10,
              cursor: 'pointer',
              textAlign: 'left',
            }}
            title={t('chordSpelling.dontShowAgainTitle')}
          >
            {t('chordSpelling.dontShowAgain')}
          </button>
        )}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={t('chordSpelling.dismissAria')}
          title={t('chordSpelling.dismissTitle')}
          className="rounded transition-colors hover:bg-[var(--surface-elevated)]"
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 22,
            height: 22,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            background: 'transparent',
            border: 0,
            cursor: 'pointer',
          }}
        >
          <X size={isBanner ? 14 : 12} />
        </button>
      )}
    </div>
  );
}
