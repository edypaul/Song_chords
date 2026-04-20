import Anthropic from '@anthropic-ai/sdk';
import type {
  AgentDefinition,
  ConversationMessage,
  ToolRegistry,
  ToolResult,
  AgentResult,
} from './types.js';

const client = new Anthropic();

/**
 * Core agentic loop: sends messages to Claude, handles tool calls,
 * and loops until the model produces a final text response.
 */
export async function runAgent(
  agent: AgentDefinition,
  userMessage: string,
  toolRegistry: ToolRegistry,
  conversationHistory?: ConversationMessage[],
): Promise<AgentResult> {
  const messages: Anthropic.MessageParam[] = conversationHistory
    ? [...conversationHistory.map(toParam)]
    : [];

  messages.push({ role: 'user', content: userMessage });

  let iterations = 0;
  const MAX_ITERATIONS = 25;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await client.messages.create({
      model: agent.model,
      max_tokens: agent.maxTokens ?? 8096,
      system: agent.systemPrompt,
      tools: agent.tools,
      messages,
    });

    // Collect text output and tool calls from the response
    const textBlocks = response.content.filter((b) => b.type === 'text');
    const toolBlocks = response.content.filter((b) => b.type === 'tool_use');

    // If no tool calls, we're done
    if (toolBlocks.length === 0 || response.stop_reason === 'end_turn') {
      const output = textBlocks.map((b) => (b as Anthropic.TextBlock).text).join('\n');
      return { success: true, output };
    }

    // Process tool calls
    messages.push({ role: 'assistant', content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of toolBlocks) {
      const toolUse = block as Anthropic.ToolUseBlock;
      const executor = toolRegistry[toolUse.name];

      let result: string;
      let isError = false;

      if (!executor) {
        result = `Error: Unknown tool "${toolUse.name}"`;
        isError = true;
      } else {
        try {
          result = await executor(toolUse.input as Record<string, unknown>);
        } catch (err) {
          result = `Error executing tool "${toolUse.name}": ${String(err)}`;
          isError = true;
        }
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result,
        is_error: isError,
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return {
    success: false,
    output: 'Agent exceeded maximum iterations',
    error: 'MAX_ITERATIONS_REACHED',
  };
}

/**
 * Run an agent with a simple question (no tools needed).
 */
export async function queryAgent(
  agent: AgentDefinition,
  question: string,
): Promise<string> {
  const response = await client.messages.create({
    model: agent.model,
    max_tokens: agent.maxTokens ?? 4096,
    system: agent.systemPrompt,
    messages: [{ role: 'user', content: question }],
  });

  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as Anthropic.TextBlock).text)
    .join('\n');
}

function toParam(msg: ConversationMessage): Anthropic.MessageParam {
  return {
    role: msg.role,
    content: typeof msg.content === 'string' ? msg.content : msg.content as Anthropic.ContentBlockParam[],
  };
}
