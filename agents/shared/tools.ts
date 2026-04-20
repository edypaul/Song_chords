import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { PROJECT } from './config.js';
import {
  loadAllMemories,
  loadMemoriesByType,
  searchMemories,
  saveMemory,
  updateMemory,
} from './memory.js';
import type Anthropic from '@anthropic-ai/sdk';
import type { ToolExecutor, MemoryType } from './types.js';

// ---------------------------------------------------------------------------
// Tool definitions (schemas for Claude)
// ---------------------------------------------------------------------------

export const TOOL_READ_FILE: Anthropic.Tool = {
  name: 'read_file',
  description: 'Read the contents of a file in the project. Use relative paths from project root.',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'Relative path from project root (e.g. packages/shared/src/parser/chordpro-parser.ts)' },
    },
    required: ['path'],
  },
};

export const TOOL_WRITE_FILE: Anthropic.Tool = {
  name: 'write_file',
  description: 'Write content to a file (creates or overwrites). Use for creating new files.',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'Relative path from project root' },
      content: { type: 'string', description: 'Full file content to write' },
    },
    required: ['path', 'content'],
  },
};

export const TOOL_EDIT_FILE: Anthropic.Tool = {
  name: 'edit_file',
  description: 'Replace a specific string in a file. The old_string must match exactly.',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'Relative path from project root' },
      old_string: { type: 'string', description: 'Exact string to find and replace' },
      new_string: { type: 'string', description: 'Replacement string' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
};

export const TOOL_GLOB_SEARCH: Anthropic.Tool = {
  name: 'glob_search',
  description: 'Find files matching a glob pattern (e.g. "**/*.test.ts", "packages/shared/src/**/*.ts").',
  input_schema: {
    type: 'object' as const,
    properties: {
      pattern: { type: 'string', description: 'Glob pattern to match files' },
    },
    required: ['pattern'],
  },
};

export const TOOL_GREP_SEARCH: Anthropic.Tool = {
  name: 'grep_search',
  description: 'Search for a regex pattern in project files. Returns matching lines with file paths.',
  input_schema: {
    type: 'object' as const,
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: { type: 'string', description: 'Directory to search in (relative to project root). Defaults to "."' },
      file_type: { type: 'string', description: 'File extension filter (e.g. "ts", "tsx")' },
    },
    required: ['pattern'],
  },
};

export const TOOL_RUN_COMMAND: Anthropic.Tool = {
  name: 'run_command',
  description: 'Execute a shell command in the project root. Use for running tests, builds, linting.',
  input_schema: {
    type: 'object' as const,
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      cwd: { type: 'string', description: 'Working directory relative to project root. Defaults to "."' },
    },
    required: ['command'],
  },
};

export const TOOL_QUERY_MEMORY: Anthropic.Tool = {
  name: 'query_memory',
  description: 'Query the project memory system. Can load all memories, filter by type, or search by keyword.',
  input_schema: {
    type: 'object' as const,
    properties: {
      action: { type: 'string', enum: ['load_all', 'by_type', 'search'], description: 'Type of memory query' },
      memory_type: { type: 'string', enum: ['project', 'feedback', 'user', 'reference'], description: 'Memory type filter (for by_type action)' },
      query: { type: 'string', description: 'Search query (for search action)' },
    },
    required: ['action'],
  },
};

export const TOOL_SAVE_MEMORY: Anthropic.Tool = {
  name: 'save_memory',
  description: 'Save a new memory entry or update an existing one in the project memory system.',
  input_schema: {
    type: 'object' as const,
    properties: {
      action: { type: 'string', enum: ['save', 'update'], description: 'Save new or update existing' },
      name: { type: 'string', description: 'Memory entry name/title' },
      description: { type: 'string', description: 'One-line description' },
      memory_type: { type: 'string', enum: ['project', 'feedback', 'user', 'reference'] },
      content: { type: 'string', description: 'Memory content' },
      file_name: { type: 'string', description: 'Filename (e.g. project_feature_x.md). Required for save, optional for update.' },
    },
    required: ['action', 'content'],
  },
};

// ---------------------------------------------------------------------------
// Tool executors
// ---------------------------------------------------------------------------

function resolvePath(relativePath: string): string {
  // Prevent directory traversal
  const normalized = relativePath.replace(/\.\.\//g, '');
  return join(PROJECT.rootPath, normalized);
}

export const executeReadFile: ToolExecutor = async (input) => {
  const path = resolvePath(input.path as string);
  if (!existsSync(path)) return `Error: File not found: ${input.path}`;
  try {
    const content = readFileSync(path, 'utf-8');
    if (content.length > 50000) {
      return content.slice(0, 50000) + '\n\n[... truncated, file too large]';
    }
    return content;
  } catch (err) {
    return `Error reading file: ${String(err)}`;
  }
};

export const executeWriteFile: ToolExecutor = async (input) => {
  const path = resolvePath(input.path as string);
  try {
    writeFileSync(path, input.content as string, 'utf-8');
    return `File written successfully: ${input.path}`;
  } catch (err) {
    return `Error writing file: ${String(err)}`;
  }
};

export const executeEditFile: ToolExecutor = async (input) => {
  const path = resolvePath(input.path as string);
  if (!existsSync(path)) return `Error: File not found: ${input.path}`;
  try {
    const content = readFileSync(path, 'utf-8');
    const oldStr = input.old_string as string;
    if (!content.includes(oldStr)) {
      return `Error: old_string not found in file. Make sure it matches exactly.`;
    }
    const newContent = content.replace(oldStr, input.new_string as string);
    writeFileSync(path, newContent, 'utf-8');
    return `File edited successfully: ${input.path}`;
  } catch (err) {
    return `Error editing file: ${String(err)}`;
  }
};

export const executeGlobSearch: ToolExecutor = async (input) => {
  try {
    const cmd = `find . -path "./node_modules" -prune -o -path "./z-file" -prune -o -name "${input.pattern}" -print | head -50`;
    const result = execSync(cmd, {
      cwd: PROJECT.rootPath,
      encoding: 'utf-8',
      timeout: 10000,
    });
    return result.trim() || 'No files found';
  } catch (err) {
    return `Error: ${String(err)}`;
  }
};

export const executeGrepSearch: ToolExecutor = async (input) => {
  const searchPath = input.path ? resolvePath(input.path as string) : PROJECT.rootPath;
  const typeFlag = input.file_type ? `--include="*.${input.file_type}"` : '';
  try {
    const cmd = `grep -rn ${typeFlag} --exclude-dir=node_modules --exclude-dir=z-file --exclude-dir=dist --exclude-dir=.expo "${input.pattern}" "${searchPath}" | head -40`;
    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 10000,
    });
    return result.trim() || 'No matches found';
  } catch {
    return 'No matches found';
  }
};

export const executeRunCommand: ToolExecutor = async (input) => {
  const cwd = input.cwd
    ? resolvePath(input.cwd as string)
    : PROJECT.rootPath;

  // Safety: block dangerous commands
  const cmd = input.command as string;
  const blocked = ['rm -rf /', 'format', 'del /s', 'rmdir /s'];
  if (blocked.some((b) => cmd.includes(b))) {
    return 'Error: This command is blocked for safety.';
  }

  try {
    const result = execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    });
    return result.trim() || '[Command completed with no output]';
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string };
    return `Command failed:\nstdout: ${execErr.stdout ?? ''}\nstderr: ${execErr.stderr ?? ''}\n${execErr.message ?? ''}`.trim();
  }
};

export const executeQueryMemory: ToolExecutor = async (input) => {
  const action = input.action as string;

  switch (action) {
    case 'load_all':
      return loadAllMemories();
    case 'by_type': {
      const memories = loadMemoriesByType(input.memory_type as MemoryType);
      return memories.length > 0 ? memories.join('\n\n---\n\n') : `No ${input.memory_type} memories found.`;
    }
    case 'search': {
      const results = searchMemories(input.query as string);
      if (results.length === 0) return `No memories matching "${input.query}"`;
      return results.map((r) => `### ${r.file}\n${r.content}`).join('\n\n');
    }
    default:
      return `Unknown memory action: ${action}`;
  }
};

export const executeSaveMemory: ToolExecutor = async (input) => {
  const action = input.action as string;

  if (action === 'update' && input.file_name) {
    const success = updateMemory(input.file_name as string, input.content as string);
    return success ? `Memory updated: ${input.file_name}` : `Error: File not found: ${input.file_name}`;
  }

  if (action === 'save') {
    const type = (input.memory_type as MemoryType) ?? 'project';
    const fileName = (input.file_name as string) ?? `${type}_${Date.now()}.md`;
    saveMemory({
      name: (input.name as string) ?? 'Untitled',
      description: (input.description as string) ?? '',
      type,
      content: input.content as string,
      fileName,
    });
    return `Memory saved: ${fileName}`;
  }

  return `Unknown action: ${action}`;
};

// ---------------------------------------------------------------------------
// Tool registry builder
// ---------------------------------------------------------------------------

/** Base tools available to all agents. */
export function createBaseToolRegistry(): Record<string, ToolExecutor> {
  return {
    read_file: executeReadFile,
    write_file: executeWriteFile,
    edit_file: executeEditFile,
    glob_search: executeGlobSearch,
    grep_search: executeGrepSearch,
    run_command: executeRunCommand,
    query_memory: executeQueryMemory,
    save_memory: executeSaveMemory,
  };
}

/** Base tool definitions available to all agents. */
export function getBaseTools(): Anthropic.Tool[] {
  return [
    TOOL_READ_FILE,
    TOOL_WRITE_FILE,
    TOOL_EDIT_FILE,
    TOOL_GLOB_SEARCH,
    TOOL_GREP_SEARCH,
    TOOL_RUN_COMMAND,
    TOOL_QUERY_MEMORY,
    TOOL_SAVE_MEMORY,
  ];
}
