import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { PROJECT } from './config.js';
import type { MemoryType, MemoryEntry } from './types.js';

const MEMORY_DIR = PROJECT.memoryPath;
const INDEX_FILE = join(MEMORY_DIR, 'MEMORY.md');

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/** Load the MEMORY.md index file. */
export function loadMemoryIndex(): string {
  if (!existsSync(INDEX_FILE)) return '';
  return readFileSync(INDEX_FILE, 'utf-8');
}

/** Load a specific memory file by filename. */
export function loadMemoryFile(fileName: string): string | null {
  const filePath = join(MEMORY_DIR, fileName);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

/** Load all memory files and return as a combined context string. */
export function loadAllMemories(): string {
  if (!existsSync(MEMORY_DIR)) return '[No memory directory found]';

  const files = readdirSync(MEMORY_DIR).filter(
    (f) => f.endsWith('.md') && f !== 'MEMORY.md',
  );

  const sections: string[] = [];
  for (const file of files) {
    const content = readFileSync(join(MEMORY_DIR, file), 'utf-8');
    sections.push(`## ${file}\n${content}`);
  }

  return sections.length > 0
    ? `# Project Memory\n\n${sections.join('\n\n---\n\n')}`
    : '[No memories stored yet]';
}

/** Load memories of a specific type. */
export function loadMemoriesByType(type: MemoryType): string[] {
  if (!existsSync(MEMORY_DIR)) return [];

  const files = readdirSync(MEMORY_DIR).filter(
    (f) => f.endsWith('.md') && f !== 'MEMORY.md' && f.startsWith(`${type}_`),
  );

  return files.map((f) => readFileSync(join(MEMORY_DIR, f), 'utf-8'));
}

/** Search memories for a keyword (case-insensitive). */
export function searchMemories(query: string): { file: string; content: string }[] {
  if (!existsSync(MEMORY_DIR)) return [];

  const q = query.toLowerCase();
  const files = readdirSync(MEMORY_DIR).filter(
    (f) => f.endsWith('.md') && f !== 'MEMORY.md',
  );

  const results: { file: string; content: string }[] = [];
  for (const file of files) {
    const content = readFileSync(join(MEMORY_DIR, file), 'utf-8');
    if (content.toLowerCase().includes(q)) {
      results.push({ file, content });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/** Save a new memory entry (creates file + updates index). */
export function saveMemory(entry: MemoryEntry): void {
  const filePath = join(MEMORY_DIR, entry.fileName);

  const fileContent = `---
name: ${entry.name}
description: ${entry.description}
type: ${entry.type}
---

${entry.content}
`;

  writeFileSync(filePath, fileContent, 'utf-8');
  updateMemoryIndex(entry);
}

/** Update an existing memory file content (preserves frontmatter type). */
export function updateMemory(fileName: string, newContent: string): boolean {
  const filePath = join(MEMORY_DIR, fileName);
  if (!existsSync(filePath)) return false;

  const existing = readFileSync(filePath, 'utf-8');
  // Preserve frontmatter
  const frontmatterEnd = existing.indexOf('---', 4);
  if (frontmatterEnd === -1) {
    writeFileSync(filePath, newContent, 'utf-8');
  } else {
    const frontmatter = existing.slice(0, frontmatterEnd + 3);
    writeFileSync(filePath, `${frontmatter}\n\n${newContent}`, 'utf-8');
  }
  return true;
}

/** Delete a memory file and remove from index. */
export function deleteMemory(fileName: string): boolean {
  const filePath = join(MEMORY_DIR, fileName);
  if (!existsSync(filePath)) return false;

  const { unlinkSync } = require('fs');
  unlinkSync(filePath);
  removeFromIndex(fileName);
  return true;
}

// ---------------------------------------------------------------------------
// Index management
// ---------------------------------------------------------------------------

function updateMemoryIndex(entry: MemoryEntry): void {
  let index = existsSync(INDEX_FILE)
    ? readFileSync(INDEX_FILE, 'utf-8')
    : '';

  const linkLine = `- [${entry.name}](${entry.fileName}) — ${entry.description}`;

  // Check if entry already exists in index
  const escapedFile = entry.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existingPattern = new RegExp(`^- \\[.*\\]\\(${escapedFile}\\).*$`, 'm');

  if (existingPattern.test(index)) {
    index = index.replace(existingPattern, linkLine);
  } else {
    index = index.trimEnd() + '\n' + linkLine + '\n';
  }

  writeFileSync(INDEX_FILE, index, 'utf-8');
}

function removeFromIndex(fileName: string): void {
  if (!existsSync(INDEX_FILE)) return;
  let index = readFileSync(INDEX_FILE, 'utf-8');
  const escapedFile = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^- \\[.*\\]\\(${escapedFile}\\).*\\n?`, 'm');
  index = index.replace(pattern, '');
  writeFileSync(INDEX_FILE, index, 'utf-8');
}
