import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ProjectContext } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Project root is two levels up from agents/shared/
const ROOT = resolve(__dirname, '../..');

export const PROJECT: ProjectContext = {
  rootPath: ROOT,
  sharedPath: resolve(ROOT, 'packages/shared/src'),
  desktopPath: resolve(ROOT, 'packages/desktop'),
  androidPath: resolve(ROOT, 'packages/android'),
  androidSrcPath: resolve(ROOT, 'packages/android/app/src/main/java/com/songchords/app'),
  memoryPath: resolve(
    process.env.HOME ?? process.env.USERPROFILE ?? '',
    '.claude/projects',
    'c--Users-Paul-Documents-My-Files-Programming-song-chords',
    'memory',
  ),
};

export const MODELS = {
  orchestrator: 'claude-opus-4-6' as const,
  specialist: 'claude-sonnet-4-6' as const,
};

export const MAX_TOKENS = {
  orchestrator: 8096,
  specialist: 4096,
};
