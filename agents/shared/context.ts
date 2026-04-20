import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { PROJECT } from './config.js';
import { loadAllMemories } from './memory.js';

/**
 * Build full project context for the orchestrator.
 */
export function buildOrchestratorContext(): string {
  const memory = loadAllMemories();
  const structure = getProjectStructure();
  const gitStatus = getGitStatus();

  return `${memory}

---

# Current Project State

## Directory Structure (key paths)
${structure}

## Git Status
${gitStatus}

## Architecture
- **Desktop**: Electron + React + TypeScript + Tailwind. Shared TS layer at packages/shared/
- **Android**: Native Kotlin + Jetpack Compose + Room + Navigation Compose at packages/android/
- Desktop and Android do NOT share code — each has its own parser, transposer, and data layer
- Desktop tests: Jest + ts-jest in packages/shared/
- Android tests: JUnit in packages/android/app/src/test/

## Android Project Structure
- packages/android/app/src/main/java/com/songchords/app/
  - parser/ — ChordPro parser (Kotlin port)
  - transpose/ — Semitone transposition (Kotlin port)
  - data/ — Room database, entities, DAOs, repositories, DataStore settings
  - data/chords/ — Chord diagram definitions (guitar + ukulele)
  - viewmodel/ — Android ViewModels with StateFlow
  - ui/ — Jetpack Compose screens
    - navigation/ — AppScaffold, routes, bottom nav
    - library/ — Song list screen
    - song/ — Song view + renderer
    - editor/ — Song create/edit screen
    - setlist/ — Set list screens
    - settings/ — Settings screen
    - chords/ — Chord library screen
    - import/ — File import screen
    - components/ — Reusable components (ChordDiagramView)
    - theme/ — Material 3 theme (light/dark)
- Build: Gradle + KSP (Room compiler) + Compose compiler plugin
`;
}

/**
 * Build focused context for a specialist agent.
 */
export function buildSpecialistContext(domain: string): string {
  const memory = loadAllMemories();

  const domainPaths: Record<string, string[]> = {
    compose: [
      'packages/android/app/src/main/java/com/songchords/app/ui/',
      'packages/android/app/src/main/java/com/songchords/app/ui/theme/',
      'packages/android/app/src/main/java/com/songchords/app/ui/navigation/',
      'packages/android/app/src/main/java/com/songchords/app/ui/components/',
      'packages/android/app/src/main/java/com/songchords/app/MainActivity.kt',
    ],
    data: [
      'packages/android/app/src/main/java/com/songchords/app/data/',
      'packages/android/app/src/main/java/com/songchords/app/viewmodel/',
      'packages/android/app/src/main/java/com/songchords/app/parser/',
      'packages/android/app/src/main/java/com/songchords/app/transpose/',
    ],
    quality: [
      'packages/android/app/src/main/java/com/songchords/app/',
      'packages/android/app/build.gradle.kts',
      'packages/android/build.gradle.kts',
      'packages/shared/src/',
    ],
    desktop: [
      'packages/desktop/src/',
      'packages/shared/src/',
    ],
  };

  const paths = domainPaths[domain] ?? [];
  const relevantFiles = paths.map((p) => `- ${p}`).join('\n');

  return `${memory}

---

# Domain Scope
Your files of interest:
${relevantFiles}

Root: ${PROJECT.rootPath}
`;
}

/**
 * Read a project file safely.
 */
export function readProjectFile(relativePath: string): string {
  const fullPath = join(PROJECT.rootPath, relativePath);
  if (!existsSync(fullPath)) return `[File not found: ${relativePath}]`;
  try {
    return readFileSync(fullPath, 'utf-8');
  } catch {
    return `[Error reading: ${relativePath}]`;
  }
}

/**
 * Get a summary of the project structure.
 */
function getProjectStructure(): string {
  try {
    const result = execSync(
      'find . -type f \\( -name "*.kt" -o -name "*.ts" -o -name "*.tsx" \\) | grep -v node_modules | grep -v z-file | grep -v dist | grep -v build | grep -v .gradle | head -80',
      { cwd: PROJECT.rootPath, encoding: 'utf-8', timeout: 5000 },
    );
    return result || '[Could not list files]';
  } catch {
    return '[Could not list files]';
  }
}

/**
 * Get current git status.
 */
function getGitStatus(): string {
  try {
    const status = execSync('git status --short 2>/dev/null || echo "Not a git repository"', {
      cwd: PROJECT.rootPath,
      encoding: 'utf-8',
      timeout: 5000,
    });
    return status.trim() || 'Clean working directory';
  } catch {
    return 'Not a git repository';
  }
}
