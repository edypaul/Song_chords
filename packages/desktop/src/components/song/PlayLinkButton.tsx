import React from 'react';
import { PlayCircle } from 'lucide-react';
import { useAudioPlayer } from '../../context/AudioPlayer';
import { useT } from '../../i18n';

interface Props {
  title: string;
  /** Optional remote URL — opened in the iframe panel. */
  link?: string;
  /** Optional absolute path to a local audio file. Takes precedence
   *  over `link` when both are set. */
  audioFile?: string;
  /** Visual size — `'sm'` for table rows, `'md'` for toolbars. */
  size?: 'sm' | 'md';
  /** Optional override for the disabled tooltip. */
  disabledTitle?: string;
}

/**
 * Reusable play-source button. Disabled-but-still-rendered when a song
 * has neither a local audio file nor a remote link, so columns line up
 * across rows. Click delegates to the global audio player provider,
 * which mounts the floating panel.
 *
 * The tooltip differentiates between "play local file" and "play
 * link" so users can see at a glance which path is configured.
 */
export default function PlayLinkButton({ title, link, audioFile, size = 'sm', disabledTitle }: Props): React.ReactElement {
  const t = useT();
  const { open } = useAudioPlayer();
  const file = audioFile?.trim();
  const url = link?.trim();
  const has = !!(file || url);
  const iconSize = size === 'md' ? 18 : 15;
  const padding = size === 'md' ? 'p-2' : 'p-1';

  const tooltip = !has
    ? (disabledTitle ?? t('songRow.play.disabled'))
    : file
      ? t('songRow.play.localFile', { title })
      : t('songRow.play.link', { title });

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!has) return;
    open(title, { audioFile: file, link: url });
  };

  return (
    <button
      onClick={handleClick}
      disabled={!has}
      className={`${padding} rounded-lg transition-colors`}
      style={{
        color: has ? 'var(--accent)' : 'var(--text-muted)',
        opacity: has ? 1 : 0.35,
        cursor: has ? 'pointer' : 'not-allowed',
        background: 'transparent',
      }}
      title={tooltip}
      aria-label={has ? t('songRow.play.aria') : t('songRow.play.ariaDisabled')}
    >
      <PlayCircle size={iconSize} fill={has ? 'currentColor' : 'none'} stroke={has ? 'var(--bg-secondary)' : 'currentColor'} strokeWidth={1.5} />
    </button>
  );
}
