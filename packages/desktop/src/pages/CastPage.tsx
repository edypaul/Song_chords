import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Cast, Globe, Copy, Check, Monitor, Tv, Info, Power } from 'lucide-react';
import { useT } from '../i18n';
import type { TKey } from '../i18n';

type Tab = 'browser' | 'miracast' | 'chromecast';

const TABS: Array<{ key: Tab; labelKey: TKey; icon: typeof Globe }> = [
  { key: 'browser',    labelKey: 'cast.page.tabs.browser',    icon: Globe },
  { key: 'miracast',   labelKey: 'cast.page.tabs.miracast',   icon: Monitor },
  { key: 'chromecast', labelKey: 'cast.page.tabs.chromecast', icon: Tv },
];

/**
 * Cast page — full-app mirror to any device on the same Wi-Fi network.
 *
 * Per-song casting (lyrics-only / chords+lyrics) is triggered from the
 * Cast icon in the song / fullscreen / perform toolbars. This page is
 * intentionally simpler now: just full-app mirror via Browser /
 * Miracast / Chromecast targets.
 */
export default function CastPage(): React.ReactElement {
  const t = useT();
  const [tab, setTab] = useState<Tab>('browser');
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverInfo, setServerInfo] = useState<{ host: string; port: number } | null>(null);
  const [clients, setClients] = useState(0);
  // Track the current broadcast mode so we can show the user whether
  // the receiver is seeing the live full-app mirror or a per-song
  // HTML payload pushed by the toolbar Cast buttons elsewhere. Lets
  // the Cast page offer a "Switch to full-app mirror" affordance
  // without requiring the user to first stop the per-song cast.
  const [mode, setMode] = useState<'mirror' | 'html' | 'idle'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pull initial server state on mount and keep the connected-clients
  // counter live with a 2s poll. Cheap (one IPC round-trip every 2s)
  // and avoids needing main->renderer push events.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const s = await window.electronAPI.cast.status();
        if (cancelled) return;
        setServerRunning(s.running);
        setClients(s.clients);
        setMode(s.mode);
        if (s.running && s.host && s.port) setServerInfo({ host: s.host, port: s.port });
        else setServerInfo(null);
      } catch { /* ignore */ }
    };
    void refresh();
    const id = setInterval(refresh, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const url = useMemo(() => {
    if (!serverInfo) return null;
    return `http://${serverInfo.host}:${serverInfo.port}/`;
  }, [serverInfo]);

  useEffect(() => {
    if (!url) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(url, { width: 220, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } })
      .then((data) => { if (!cancelled) setQrDataUrl(data); })
      .catch(() => { if (!cancelled) setQrDataUrl(null); });
    return () => { cancelled = true; };
  }, [url]);

  /** Start the server (if needed) and force it into full-app mirror
   *  mode capturing the main window. Safe to call when:
   *   - the server is stopped — starts fresh in mirror mode.
   *   - the server is already running in mirror mode — no-op.
   *   - the server is running in html mode (a per-song cast pushed
   *     content via the toolbar Cast button) — flips it to mirror
   *     and clears the cached HTML payload so receivers see the
   *     live captured frames instead of the song HTML iframe.
   */
  const startMirror = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const info = await window.electronAPI.cast.start('app');
      setServerInfo(info);
      setServerRunning(true);
      // Always force mirror mode — `start()` is idempotent so when
      // the server was already running in html mode (e.g. a song
      // cast started from a toolbar Cast button), `setMirror()` is
      // the only call that flips the broadcast mode back.
      await window.electronAPI.cast.setMirror().catch(() => { /* ignore */ });
      setMode('mirror');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stopServer = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await window.electronAPI.cast.stop();
      setServerRunning(s.running);
      setServerInfo(null);
      setClients(0);
      setMode('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = () => {
    if (!url) return;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        <Cast size={20} style={{ color: 'var(--accent)' }} />
        <div className="flex flex-col">
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{t('cast.page.title')}</h1>
        </div>
        <div className="flex-1" />
        <ServerStatusBadge running={serverRunning} clients={clients} mode={mode} />
        {/* Cast page controls. Three states:
            - stopped → primary "Start Casting" (mirror mode).
            - running in mirror → secondary "Stop Casting".
            - running in html mode → primary "Switch to full app" +
              secondary "Stop Casting". The "Switch" button calls
              cast.setMirror() which flips the broadcast mode without
              tearing down the server, so the receiver smoothly
              switches from the per-song iframe to the live mirror. */}
        {!serverRunning && (
          <button
            onClick={() => void startMirror()}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 whitespace-nowrap"
            style={{
              background: 'var(--accent)',
              color: 'white',
              opacity: busy ? 0.5 : 1,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            <Power size={13} className="shrink-0" />
            {busy ? '...' : t('cast.page.startCasting')}
          </button>
        )}
        {serverRunning && mode === 'html' && (
          <button
            onClick={() => void startMirror()}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 whitespace-nowrap"
            style={{
              background: 'var(--accent)',
              color: 'white',
              opacity: busy ? 0.5 : 1,
              cursor: busy ? 'wait' : 'pointer',
            }}
            title={t('cast.page.switchToFullAppTitle')}
          >
            <Cast size={13} className="shrink-0" />
            {busy ? '...' : t('cast.page.switchToFullApp')}
          </button>
        )}
        {serverRunning && (
          <button
            onClick={() => void stopServer()}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 whitespace-nowrap"
            style={{
              background: 'var(--surface-elevated)',
              color: 'var(--text-secondary)',
              opacity: busy ? 0.5 : 1,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            <Power size={13} className="shrink-0" />
            {busy ? '...' : t('cast.page.stopCasting')}
          </button>
        )}
      </div>
      {error && (
        <div className="px-6 py-2 text-xs" style={{ background: 'color-mix(in srgb, #ef4444 14%, transparent)', color: '#fecaca' }}>
          {t('cast.page.error', { error })}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-6 pt-4 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        {TABS.map(({ key, labelKey, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors"
              style={{
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                marginBottom: -1,
              }}
            >
              <Icon size={14} />
              {t(labelKey)}
            </button>
          );
        })}
      </div>

      {/* Body — single column, tab-specific content. */}
      <div className="flex-1 min-h-0 p-6">
        {tab === 'browser' && <BrowserTab url={url} qrDataUrl={qrDataUrl} copied={copied} onCopy={handleCopy} mode={mode} />}
        {tab === 'miracast' && <MiracastTab />}
        {tab === 'chromecast' && <ChromecastTab url={url} />}
      </div>
    </div>
  );
}

function ServerStatusBadge({ running, clients, mode }: { running: boolean; clients: number; mode: 'mirror' | 'html' | 'idle' }): React.ReactElement {
  const t = useT();
  // Single line: "Casting song (1 viewer)". The header description was
  // removed so this fits without wrapping; nowrap guarantees it.
  const title = running
    ? mode === 'html' ? t('cast.page.status.castingSong') : t('cast.page.status.castingFullApp')
    : t('cast.page.status.stopped');
  const viewers = running && clients > 0
    ? ' ' + (clients === 1 ? t('cast.page.status.viewersOne', { count: clients }) : t('cast.page.status.viewersMany', { count: clients }))
    : '';
  return (
    <span
      className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono"
      style={{
        background: 'var(--surface-elevated)',
        color: running ? 'var(--accent)' : 'var(--text-muted)',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        className="shrink-0"
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: running ? 'var(--accent)' : 'var(--text-muted)',
          boxShadow: running ? '0 0 6px var(--accent)' : 'none',
        }}
      />
      {title}{viewers}
    </span>
  );
}

function BrowserTab({
  url,
  qrDataUrl,
  copied,
  onCopy,
  mode,
}: {
  url: string | null;
  qrDataUrl: string | null;
  copied: boolean;
  onCopy: () => void;
  mode: 'mirror' | 'html' | 'idle';
}): React.ReactElement {
  const t = useT();
  if (!url) {
    return (
      <Empty
        title={t('cast.page.empty.title')}
        body={t('cast.page.empty.body')}
      />
    );
  }
  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {mode === 'html' ? (
        <Hint>
          {t('cast.page.hint.htmlPrefix')}
          <strong> {t('cast.page.hint.switchStrong')}</strong>
          {t('cast.page.hint.htmlSuffix')}
        </Hint>
      ) : (
        <Hint>
          {t('cast.page.hint.mirrorPrefix')} <strong>{t('cast.page.hint.mirrorStrong')}</strong>{t('cast.page.hint.mirrorSuffix')}
        </Hint>
      )}
      <div className="flex items-start gap-6">
        {qrDataUrl && (
          <div
            className="rounded-lg p-3 shrink-0"
            style={{ background: '#fff', border: '1px solid var(--border)' }}
          >
            <img src={qrDataUrl} alt={t('cast.qrAlt')} width={220} height={220} />
          </div>
        )}
        <div className="flex flex-col gap-3 min-w-0 flex-1">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
              {t('cast.openOnDevice')}
            </span>
            <div
              className="flex items-center gap-2 p-2 rounded-lg font-mono text-sm break-all"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            >
              <span className="flex-1 min-w-0 truncate">{url}</span>
              <button
                onClick={onCopy}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold transition-colors shrink-0"
                style={{
                  background: copied ? 'var(--accent)' : 'var(--surface-elevated)',
                  color: copied ? 'white' : 'var(--text-secondary)',
                }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? t('common.copied') : t('common.copy')}
              </button>
            </div>
          </div>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('cast.page.qrHint')}
          </span>
        </div>
      </div>
    </div>
  );
}

function MiracastTab(): React.ReactElement {
  const t = useT();
  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <Hint>
        {t('cast.page.miracast.hint')}
      </Hint>

      <Section title={t('cast.page.miracast.beforeYouStart')}>
        <ol className="flex flex-col gap-2 text-sm pl-5 list-decimal" style={{ color: 'var(--text-secondary)' }}>
          <li>{t('cast.page.miracast.before.1')}</li>
          <li>{t('cast.page.miracast.before.2')}</li>
          <li>{t('cast.page.miracast.before.3')}</li>
        </ol>
      </Section>

      <Section title={t('cast.page.miracast.connect')}>
        <ol className="flex flex-col gap-2 text-sm pl-5 list-decimal" style={{ color: 'var(--text-secondary)' }}>
          <li>{t('cast.page.miracast.connect.1')}</li>
          <li>{t('cast.page.miracast.connect.2')}</li>
          <li>{t('cast.page.miracast.connect.3')}</li>
          <li>{t('cast.page.miracast.connect.4')}</li>
          <li>{t('cast.page.miracast.connect.5')}</li>
        </ol>
      </Section>

      <Section title={t('cast.page.miracast.troubleshooting')}>
        <ul className="flex flex-col gap-2 text-sm pl-5 list-disc" style={{ color: 'var(--text-secondary)' }}>
          <li>{t('cast.page.miracast.trouble.1')}</li>
          <li>{t('cast.page.miracast.trouble.2')}</li>
          <li>{t('cast.page.miracast.trouble.3')}</li>
        </ul>
      </Section>
    </div>
  );
}

function ChromecastTab({ url }: { url: string | null }): React.ReactElement {
  const t = useT();
  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <Hint>
        {t('cast.page.chromecast.hint')}
      </Hint>

      <Section title={t('cast.page.chromecast.beforeYouStart')}>
        <ol className="flex flex-col gap-2 text-sm pl-5 list-decimal" style={{ color: 'var(--text-secondary)' }}>
          <li>{t('cast.page.chromecast.before.1')}</li>
          <li>{t('cast.page.chromecast.before.2')}</li>
          <li>{t('cast.page.chromecast.before.3')}</li>
        </ol>
      </Section>

      <Section title={t('cast.page.chromecast.cast')}>
        <ol className="flex flex-col gap-2 text-sm pl-5 list-decimal" style={{ color: 'var(--text-secondary)' }}>
          <li>
            {t('cast.page.chromecast.cast.1')}
            <div
              className="mt-1 px-2 py-1 rounded font-mono text-xs"
              style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)' }}
            >
              {url ?? t('cast.page.chromecast.startFirst')}
            </div>
          </li>
          <li>{t('cast.page.chromecast.cast.2')}</li>
          <li>{t('cast.page.chromecast.cast.3')}</li>
          <li>{t('cast.page.chromecast.cast.4')}</li>
          <li>{t('cast.page.chromecast.cast.5')}</li>
        </ol>
      </Section>

      <Section title={t('cast.page.chromecast.troubleshooting')}>
        <ul className="flex flex-col gap-2 text-sm pl-5 list-disc" style={{ color: 'var(--text-secondary)' }}>
          <li>{t('cast.page.chromecast.trouble.1')}</li>
          <li>{t('cast.page.chromecast.trouble.2')}</li>
          <li>{t('cast.page.chromecast.trouble.3')}</li>
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div
      className="flex flex-col gap-3 p-4 rounded-lg"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        {title}
      </span>
      {children}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 gap-2">
      <Cast size={32} style={{ color: 'var(--text-muted)' }} />
      <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>{title}</span>
      <span className="text-xs max-w-md" style={{ color: 'var(--text-muted)' }}>{body}</span>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      className="flex items-start gap-2 p-3 rounded-lg text-xs"
      style={{
        background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
        color: 'var(--text-secondary)',
      }}
    >
      <Info size={14} style={{ color: 'var(--accent)', marginTop: 1, flexShrink: 0 }} />
      <span className="leading-relaxed">{children}</span>
    </div>
  );
}
