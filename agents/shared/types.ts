import type Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Agent definitions
// ---------------------------------------------------------------------------

export type AgentModel = 'claude-opus-4-6' | 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001';

export interface AgentDefinition {
  name: string;
  model: AgentModel;
  systemPrompt: string;
  tools: Anthropic.Tool[];
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// Messages & Conversation
// ---------------------------------------------------------------------------

export type Role = 'user' | 'assistant';

export interface ConversationMessage {
  role: Role;
  content: string | Anthropic.ContentBlock[];
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

// ---------------------------------------------------------------------------
// Task & Delegation
// ---------------------------------------------------------------------------

export interface AgentTask {
  description: string;
  context?: Record<string, unknown>;
  filesToRead?: string[];
  expectedOutput?: string;
}

export interface AgentResult {
  success: boolean;
  output: string;
  filesChanged?: string[];
  error?: string;
}

export interface DelegationRequest {
  targetAgent: string;
  task: AgentTask;
  priority?: 'low' | 'normal' | 'high';
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export type MemoryType = 'project' | 'feedback' | 'user' | 'reference';

export interface MemoryEntry {
  name: string;
  description: string;
  type: MemoryType;
  content: string;
  fileName: string;
}

export interface MemoryIndex {
  entries: { title: string; file: string; summary: string }[];
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

export type ToolExecutor = (input: Record<string, unknown>) => Promise<string>;

export interface ToolRegistry {
  [toolName: string]: ToolExecutor;
}

// ---------------------------------------------------------------------------
// Project context
// ---------------------------------------------------------------------------

export interface ProjectContext {
  rootPath: string;
  sharedPath: string;
  desktopPath: string;
  androidPath: string;
  androidSrcPath: string;
  memoryPath: string;
}
