import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Cast, Globe, Copy, Check, Monitor, Tv, Info, Power } from 'lucide-react';

type Tab = 'browser' | 'miracast' | 'chromecast';

const TABS: Array<{ key: Tab; label: string; icon: typeof Globe }> = [
  { key: 'browser',    label: 'Browser',    icon: Globe },
  { key: 'miracast',   label: 'Miracast',   icon: Monitor },
  { key: 'chromecast', label: 'Chromecast', icon: Tv },
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
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Cast — Full App</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Mirror the whole app to any device on your network. For per-song lyrics or chord casts, use the Cast icon in the song toolbar.
          </p>
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={{
              background: 'var(--accent)',
              color: 'white',
              opacity: busy ? 0.5 : 1,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            <Power size={13} />
            {busy ? '...' : 'Start Casting'}
          </button>
        )}
        {serverRunning && mode === 'html' && (
          <button
            onClick={() => void startMirror()}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={{
              background: 'var(--accent)',
              color: 'white',
              opacity: busy ? 0.5 : 1,
              cursor: busy ? 'wait' : 'pointer',
            }}
            title="A per-song cast is currently active. Click to switch the receiver to the full-app mirror."
          >
            <Cast size={13} />
            {busy ? '...' : 'Switch to full app'}
          </button>
        )}
        {serverRunning && (
          <button
            onClick={() => void stopServer()}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={{
              background: 'var(--surface-elevated)',
              color: 'var(--text-secondary)',
              opacity: busy ? 0.5 : 1,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            <Power size={13} />
            {busy ? '...' : 'Stop Casting'}
          </button>
        )}
      </div>
      {error && (
        <div className="px-6 py-2 text-xs" style={{ background: 'color-mix(in srgb, #ef4444 14%, transparent)', color: '#fecaca' }}>
          Cast error: {error}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-6 pt-4 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        {TABS.map(({ key, label, icon: Icon }) => {
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
              {label}
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
  const viewers = clients > 0 ? ` · ${clients} viewer${clients === 1 ? '' : 's'}` : '';
  const label = running
    ? mode === 'html'
      ? `Casting song${viewers}`
      : `Casting full app${viewers}`
    : 'Stopped';
  return (
    <span
      className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono"
      style={{
        background: 'var(--surface-elevated)',
        color: running ? 'var(--accent)' : 'var(--text-muted)',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: running ? 'var(--accent)' : 'var(--text-muted)',
          boxShadow: running ? '0 0 6px var(--accent)' : 'none',
        }}
      />
      {label}
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
  if (!url) {
    return (
      <Empty
        title="Press Start Casting to begin"
        body="The app will host a local read-only mirror you can open from any phone, tablet, or browser on the same Wi-Fi network."
      />
    );
  }
  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {mode === 'html' ? (
        <Hint>
          A per-song cast is currently active — the receiver is showing
          the song HTML pushed from the song toolbar. Click
          <strong> Switch to full app</strong> above to flip the receiver
          back to the live mirror of the entire app.
        </Hint>
      ) : (
        <Hint>
          Mirrors <strong>everything</strong> you see on the desktop — sidebar, library, every page. Read-only on the receiving device.
        </Hint>
      )}
      <div className="flex items-start gap-6">
        {qrDataUrl && (
          <div
            className="rounded-lg p-3 shrink-0"
            style={{ background: '#fff', border: '1px solid var(--border)' }}
          >
            <img src={qrDataUrl} alt="QR code" width={220} height={220} />
          </div>
        )}
        <div className="flex flex-col gap-3 min-w-0 flex-1">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
              Open this URL on the receiving device
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
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Scan the QR code with your phone's camera, or type the URL into any browser on a device sharing this computer's Wi-Fi network. Updates live.
          </span>
        </div>
      </div>
    </div>
  );
}

function MiracastTab(): React.ReactElement {
  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <Hint>
        Miracast streams the entire Windows desktop to a wireless display
        (smart TV, dedicated Miracast adapter, some Android TV / Roku
        devices). It's an OS-level feature — apps can't start it
        directly, but once you connect a Miracast display you can move
        the Song Chords window to it.
      </Hint>

      <Section title="Before you start">
        <ol className="flex flex-col gap-2 text-sm pl-5 list-decimal" style={{ color: 'var(--text-secondary)' }}>
          <li>The receiving device must support Miracast. Most smart TVs from 2018+, Roku, Fire TV, and dedicated dongles do.</li>
          <li>On Windows: the receiver must be powered on and discoverable (usually labelled <em>Screen mirroring</em>, <em>Cast</em>, or <em>Miracast</em> in its input menu).</li>
          <li>Both devices need to be on the same Wi-Fi network (some receivers use Wi-Fi Direct and don't actually need a router — check your TV's manual).</li>
        </ol>
      </Section>

      <Section title="Connect">
        <ol className="flex flex-col gap-2 text-sm pl-5 list-decimal" style={{ color: 'var(--text-secondary)' }}>
          <li>
            Press <Kbd>Win</Kbd> + <Kbd>K</Kbd>. Windows opens the <strong>Cast</strong> panel.
          </li>
          <li>
            Pick your Miracast display from the list. If nothing appears, click <strong>Find other types of devices</strong> at the bottom of the panel — Miracast is sometimes there.
          </li>
          <li>
            Confirm the PIN if your TV prompts for one. The Windows desktop now mirrors to the TV.
          </li>
          <li>
            Drag the Song Chords window so it shows on the Miracast display, or use <Kbd>Win</Kbd> + <Kbd>Shift</Kbd> + <Kbd>→/←</Kbd> to move it.
          </li>
          <li>
            Open <strong>Settings → Display</strong> and pick <em>Duplicate</em> if you want both screens to show the same thing, or <em>Extend</em> if you want a separate cast window.
          </li>
        </ol>
      </Section>

      <Section title="Troubleshooting">
        <ul className="flex flex-col gap-2 text-sm pl-5 list-disc" style={{ color: 'var(--text-secondary)' }}>
          <li><strong>"Couldn't connect"</strong> — turn the TV's Miracast / screen-mirroring mode off and on, then retry.</li>
          <li><strong>No devices appear</strong> — confirm both devices are on 5 GHz Wi-Fi (some Miracast receivers won't show up over 2.4 GHz).</li>
          <li><strong>Stuttering</strong> — close other Wi-Fi-heavy apps (video calls, large downloads) on the laptop.</li>
        </ul>
      </Section>
    </div>
  );
}

function ChromecastTab({ url }: { url: string | null }): React.ReactElement {
  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <Hint>
        Chromecast doesn't expose a public "open URL" API to apps that
        haven't registered a custom receiver with Google, so the
        recommended workflow is Chrome's built-in <em>Cast tab</em>
        feature. It works for any URL you can load in Chrome.
      </Hint>

      <Section title="Before you start">
        <ol className="flex flex-col gap-2 text-sm pl-5 list-decimal" style={{ color: 'var(--text-secondary)' }}>
          <li>The Chromecast (or Chromecast-built-in TV) is plugged in and on the same Wi-Fi network as this computer.</li>
          <li>You have Google Chrome installed somewhere on the network — it can be on this laptop, on your phone (Chrome on Android), or on another laptop.</li>
          <li>Click <strong>Start Casting</strong> at the top of this page so the URL below is live.</li>
        </ol>
      </Section>

      <Section title="Cast">
        <ol className="flex flex-col gap-2 text-sm pl-5 list-decimal" style={{ color: 'var(--text-secondary)' }}>
          <li>
            Open Google Chrome on a controller device and navigate to:
            <div
              className="mt-1 px-2 py-1 rounded font-mono text-xs"
              style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)' }}
            >
              {url ?? 'Start casting first to see the URL'}
            </div>
          </li>
          <li>Click the three-dot Chrome menu → <strong>Cast…</strong> (or <strong>Cast, save and share → Cast</strong> on newer Chrome versions).</li>
          <li>Pick your Chromecast device from the list.</li>
          <li>At the top of the Cast dialog, click <strong>Sources</strong> and choose <strong>Cast tab</strong>.</li>
          <li>The page on the Chromecast now mirrors the live cast — and updates every time you change songs in the desktop app.</li>
        </ol>
      </Section>

      <Section title="Troubleshooting">
        <ul className="flex flex-col gap-2 text-sm pl-5 list-disc" style={{ color: 'var(--text-secondary)' }}>
          <li><strong>Chromecast not in the list</strong> — make sure both devices share the same Wi-Fi (and that your guest network isn't isolating clients).</li>
          <li><strong>Page won't load</strong> — confirm the URL starts with <code>http://</code> (not <code>https://</code>) and that <strong>Start Casting</strong> is on.</li>
          <li><strong>Frame rate is choppy</strong> — Cast tab is software-encoded; lower the Chrome window's resolution or close other heavy tabs.</li>
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

function Kbd({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <kbd
      className="px-1.5 py-0.5 rounded font-mono text-xs"
      style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)' }}
    >
      {children}
    </kbd>
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
