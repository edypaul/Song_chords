import React, { useEffect } from 'react';
import { useT } from '../../i18n';

interface Props {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title, message, confirmLabel, cancelLabel,
  danger = false, onConfirm, onCancel,
}: Props): React.ReactElement {
  const t = useT();
  const resolvedConfirm = confirmLabel ?? t('common.confirm');
  const resolvedCancel = cancelLabel ?? t('common.cancel');
  useEffect(() => {
    // Capture phase + stopImmediatePropagation so page-level handlers
    // (e.g. "navigate back" on Escape) don't also fire.
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onConfirm();
      }
    };
    window.addEventListener('keydown', handleKey, { capture: true });
    return () => window.removeEventListener('keydown', handleKey, { capture: true });
  }, [onConfirm, onCancel]);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)', zIndex: 300 }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl p-5 flex flex-col gap-4"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h3 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>{title}</h3>
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>{message}</div>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-sm"
            style={{ background: 'var(--surface-elevated)', color: 'var(--text-secondary)' }}
          >
            {resolvedCancel}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 rounded text-sm font-medium"
            style={{ background: danger ? 'var(--danger)' : 'var(--accent)', color: 'white' }}
            autoFocus
          >
            {resolvedConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}
