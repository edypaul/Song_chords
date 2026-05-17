import React, { createContext, useCallback, useContext, useState } from 'react';
import AudioPlayerPanel from '../components/song/AudioPlayerPanel';

export interface AudioPlayerSourceInput {
  /** Local audio file path. Wins over `link` when both set. */
  audioFile?: string;
  /** Remote URL (YouTube / SoundCloud / Spotify / direct mp3 / etc.). */
  link?: string;
}

interface AudioPlayerCtx {
  /** Open the floating player for the given song. No-op if neither
   *  source is set. Replaces whatever was playing. */
  open: (title: string, source: AudioPlayerSourceInput) => void;
  /** Close the player if it's open. */
  close: () => void;
  /** Currently-loaded source, or null when the player is closed. */
  current: { title: string; audioFile?: string; link?: string } | null;
}

const Ctx = createContext<AudioPlayerCtx | null>(null);

/**
 * Global audio-player provider — mounted once at the app root so any
 * page's "play" button can open the same floating panel without each
 * caller managing state. The panel mounts as a sibling of the routed
 * page so it survives navigation between songs.
 */
export function AudioPlayerProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [current, setCurrent] = useState<{ title: string; audioFile?: string; link?: string } | null>(null);

  const open = useCallback((title: string, source: AudioPlayerSourceInput) => {
    const file = source.audioFile?.trim();
    const url = source.link?.trim();
    if (!file && !url) return;
    // URL-only: skip the floating panel entirely and open the link
    // in a child BrowserWindow. Avoids the iframe-embedding rabbit
    // hole (Error 153, "Video unavailable", etc.) — every URL just
    // opens in a real browser window that can play anything.
    if (!file && url) {
      void window.electronAPI.youtube.openPopup(url);
      return;
    }
    // Otherwise (local file present, with or without link) the panel
    // mounts. The chooser inside the panel routes "Online source"
    // back through `openPopup` so the URL still skips the iframe.
    setCurrent({ title, audioFile: file || undefined, link: url || undefined });
  }, []);

  const close = useCallback(() => setCurrent(null), []);

  return (
    <Ctx.Provider value={{ open, close, current }}>
      {children}
      {current && (
        <AudioPlayerPanel
          title={current.title}
          audioFile={current.audioFile}
          link={current.link}
          onClose={close}
        />
      )}
    </Ctx.Provider>
  );
}

export function useAudioPlayer(): AudioPlayerCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAudioPlayer must be used within AudioPlayerProvider');
  return ctx;
}
