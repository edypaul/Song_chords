import type Anthropic from '@anthropic-ai/sdk';
import type { AgentDefinition, ToolRegistry, AgentResult } from '../shared/types.js';
import { MODELS, MAX_TOKENS } from '../shared/config.js';
import { getBaseTools, createBaseToolRegistry } from '../shared/tools.js';
import { runAgent } from '../shared/agent-runner.js';
import { buildOrchestratorContext } from '../shared/context.js';
import { runComposeUi } from '../compose-ui/agent.js';
import { runDataLayer } from '../data-layer/agent.js';
import { runAndroidQuality } from '../android-quality/agent.js';

// ---------------------------------------------------------------------------
// Delegation tools
// ---------------------------------------------------------------------------

const TOOL_DELEGATE_COMPOSE: Anthropic.Tool = {
  name: 'delegate_to_compose_ui',
  description: `Delegate tasks related to Jetpack Compose UI: screens, layouts, navigation, theme, Material 3 components, Canvas drawing, animations, gestures. Works on packages/android/app/src/main/java/com/songchords/app/ui/`,
  input_schema: {
    type: 'object' as const,
    properties: {
      task: { type: 'string', description: 'Clear description of the UI task' },
      context: { type: 'string', description: 'Additional context or constraints' },
    },
    required: ['task'],
  },
};

const TOOL_DELEGATE_DATA: Anthropic.Tool = {
  name: 'delegate_to_data_layer',
  description: `Delegate tasks related to data, business logic, and state: Room database (entities, DAOs, migrations), repositories, ViewModels (StateFlow), DataStore settings, ChordPro parser, transposer, coroutines/flows.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      task: { type: 'string', description: 'Clear description of the data/logic task' },
      context: { type: 'string', description: 'Additional context or constraints' },
    },
    required: ['task'],
  },
};

const TOOL_DELEGATE_QUALITY: Anthropic.Tool = {
  name: 'delegate_to_quality',
  description: `Delegate tasks related to testing, code review, builds, performance audits, and feature parity checks between Android and Desktop.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      task: { type: 'string', description: 'What to test, review, or audit' },
      context: { type: 'string', description: 'Files changed, specific concerns' },
    },
    required: ['task'],
  },
};

// ---------------------------------------------------------------------------
// Orchestrator system prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the Orchestrator Agent for Song Chords — a cross-platform chord chart application.

## Project Architecture
- **Desktop**: Electron + React + TypeScript at packages/desktop/ (shared TS layer at packages/shared/)
- **Android**: Native Kotlin + Jetpack Compose + Room at packages/android/
- Desktop and Android do NOT share code — each has its own implementation of the core logic

## Your Role
1. Analyze each user request
2. Determine which specialist agent(s) to delegate to
3. Decompose complex tasks into sub-tasks
4. Integrate results and present a coherent response
5. Manage project memory (save learnings, decisions, feedback)

## Specialist Agents
- **Compose UI**: Jetpack Compose screens, Material 3, navigation, Canvas, animations
- **Data Layer**: Room DB, ViewModels, StateFlow, parser, transposer, repositories
- **Quality**: Testing (JUnit/Compose), code review, builds, performance, feature parity

## Routing Logic
- UI changes (screens, layouts, theme, gestures) → Compose UI Agent
- Data changes (DB schema, ViewModel, parser, transposer, repositories) → Data Layer Agent
- Tests, reviews, builds, audits → Quality Agent
- New features → Data Layer (model/logic first) → Compose UI (screen) → Quality (test)
- Desktop changes → use your direct file tools (no specialist needed)

## Response Style
- Respond in Spanish (the user's preferred language) unless they write in English
- Be concise and action-oriented
- Report what was done with file paths
- When comparing platforms, note specific gaps

You also have direct access to file and memory tools for quick lookups.`;

// ---------------------------------------------------------------------------
// Agent definition + runner
// ---------------------------------------------------------------------------

export const orchestratorAgent: AgentDefinition = {
  name: 'orchestrator',
  model: MODELS.orchestrator,
  systemPrompt: SYSTEM_PROMPT,
  tools: [
    ...getBaseTools(),
    TOOL_DELEGATE_COMPOSE,
    TOOL_DELEGATE_DATA,
    TOOL_DELEGATE_QUALITY,
  ],
  maxTokens: MAX_TOKENS.orchestrator,
};

function createOrchestratorToolRegistry(): ToolRegistry {
  const base = createBaseToolRegistry();

  return {
    ...base,

    delegate_to_compose_ui: async (input) => {
      const task = input.task as string;
      const context = (input.context as string) ?? '';
      const prompt = context ? `${task}\n\nContext: ${context}` : task;
      console.log(`\n  [Orchestrator → Compose UI] ${task.slice(0, 80)}...`);
      const result = await runComposeUi(prompt);
      console.log(`  [Compose UI → Orchestrator] ${result.success ? 'Done' : 'Failed'}`);
      return formatResult('Compose UI', result);
    },

    delegate_to_data_layer: async (input) => {
      const task = input.task as string;
      const context = (input.context as string) ?? '';
      const prompt = context ? `${task}\n\nContext: ${context}` : task;
      console.log(`\n  [Orchestrator → Data Layer] ${task.slice(0, 80)}...`);
      const result = await runDataLayer(prompt);
      console.log(`  [Data Layer → Orchestrator] ${result.success ? 'Done' : 'Failed'}`);
      return formatResult('Data Layer', result);
    },

    delegate_to_quality: async (input) => {
      const task = input.task as string;
      const context = (input.context as string) ?? '';
      const prompt = context ? `${task}\n\nContext: ${context}` : task;
      console.log(`\n  [Orchestrator → Quality] ${task.slice(0, 80)}...`);
      const result = await runAndroidQuality(prompt);
      console.log(`  [Quality → Orchestrator] ${result.success ? 'Done' : 'Failed'}`);
      return formatResult('Quality', result);
    },
  };
}

function formatResult(agent: string, result: AgentResult): string {
  if (result.success) return `[${agent} completed successfully]\n\n${result.output}`;
  return `[${agent} error]\n\nError: ${result.error ?? 'Unknown'}\nOutput: ${result.output}`;
}

export async function runOrchestrator(userMessage: string): Promise<AgentResult> {
  const projectContext = buildOrchestratorContext();
  const enrichedMessage = `[Project Context]\n${projectContext}\n\n[User Request]\n${userMessage}`;
  const registry = createOrchestratorToolRegistry();
  return runAgent(orchestratorAgent, enrichedMessage, registry);
}
