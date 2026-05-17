import React, { createContext, useCallback, useContext, useState } from 'react';
import AudioPlayerPanel from '../components/song/AudioPlayerPanel';
import YouTubePlayerPanel from '../components/song/YouTubePlayerPanel';
import { parseYouTubeId } from '../utils/audio-source';

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
  // Separate state for the in-app YouTube player so it can float
  // independently of the local-file audio panel.
  const [youtube, setYoutube] = useState<{ title: string; videoId: string; watchUrl: string } | null>(null);

  const open = useCallback((title: string, source: AudioPlayerSourceInput) => {
    const file = source.audioFile?.trim();
    const url = source.link?.trim();
    if (!file && !url) return;
    // URL-only sources:
    //   - YouTube  → custom in-app draggable player panel (the
    //                youtube-nocookie embed IS iframe-embeddable, so
    //                no separate OS window is needed).
    //   - anything else (SoundCloud / Spotify / direct mp3 / other
    //                sites) → child BrowserWindow popup, as before:
    //                building a custom player for arbitrary sites
    //                isn't feasible and many block iframe embedding.
    if (!file && url) {
      const videoId = parseYouTubeId(url);
      if (videoId) {
        setYoutube({ title, videoId, watchUrl: url });
      } else {
        void window.electronAPI.youtube.openPopup(url);
      }
      return;
    }
    // Otherwise (local file present, with or without link) the panel
    // mounts. The chooser inside the panel routes "Online source"
    // back through `openPopup` so the URL still skips the iframe.
    setCurrent({ title, audioFile: file || undefined, link: url || undefined });
  }, []);

  const close = useCallback(() => {
    setCurrent(null);
    setYoutube(null);
  }, []);

  return (
    <Ctx.Provider value={{ open, close, current }}>
      {children}
      {current && (
        <AudioPlayerPanel
          title={current.title}
          audioFile={current.audioFile}
          link={current.link}
          onPlayUrl={(t, url) => {
            // Close the local-file panel, then route the URL through
            // the same `open()` logic a URL-only song uses — so a
            // YouTube link from the chooser gets the custom in-app
            // player, not the forced browser popup. Passing only the
            // link (no audioFile) makes `open` take the URL branch.
            setCurrent(null);
            open(t, { link: url });
          }}
          onClose={() => setCurrent(null)}
        />
      )}
      {youtube && (
        <YouTubePlayerPanel
          title={youtube.title}
          videoId={youtube.videoId}
          watchUrl={youtube.watchUrl}
          onClose={() => setYoutube(null)}
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
