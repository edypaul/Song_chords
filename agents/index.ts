import 'dotenv/config';
import { createInterface } from 'readline';
import { runOrchestrator } from './orchestrator/agent.js';
import { runComposeUi } from './compose-ui/agent.js';
import { runDataLayer } from './data-layer/agent.js';
import { runAndroidQuality } from './android-quality/agent.js';
import type { AgentResult } from './shared/types.js';

// ---------------------------------------------------------------------------
// CLI Interface
// ---------------------------------------------------------------------------

const BANNER = `
 ╔══════════════════════════════════════════════════╗
 ║       Song Chords — Android Agent System          ║
 ║                                                    ║
 ║  Orchestrator + 3 Specialists (Kotlin/Compose)    ║
 ║  Type your request or use a command:               ║
 ║                                                    ║
 ║  /compose <task>   — Direct to Compose UI Agent   ║
 ║  /data    <task>   — Direct to Data Layer Agent   ║
 ║  /quality <task>   — Direct to Quality Agent      ║
 ║  /help             — Show this help                ║
 ║  /quit             — Exit                          ║
 ╚══════════════════════════════════════════════════╝
`;

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(): void {
  rl.question('\n🎸 > ', async (input) => {
    const trimmed = input.trim();
    if (!trimmed) { prompt(); return; }

    if (trimmed === '/quit' || trimmed === '/exit') {
      console.log('\nHasta luego! 👋\n');
      rl.close();
      process.exit(0);
    }

    if (trimmed === '/help') {
      console.log(BANNER);
      prompt();
      return;
    }

    try {
      let result: AgentResult;

      if (trimmed.startsWith('/compose ')) {
        console.log('\n[→ Compose UI Agent]');
        result = await runComposeUi(trimmed.slice(9));
      } else if (trimmed.startsWith('/data ')) {
        console.log('\n[→ Data Layer Agent]');
        result = await runDataLayer(trimmed.slice(6));
      } else if (trimmed.startsWith('/quality ')) {
        console.log('\n[→ Quality Agent]');
        result = await runAndroidQuality(trimmed.slice(9));
      } else {
        console.log('\n[→ Orchestrator]');
        result = await runOrchestrator(trimmed);
      }

      console.log('\n' + '─'.repeat(60));
      console.log(result.output);
      console.log('─'.repeat(60));

      if (!result.success) {
        console.log(`\n⚠ Agent issue: ${result.error ?? 'unknown'}`);
      }
    } catch (err) {
      console.error('\nError:', err instanceof Error ? err.message : String(err));
    }

    prompt();
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY not set.');
    console.error('Create agents/.env with your key (see .env.example)');
    process.exit(1);
  }

  console.log(BANNER);

  // Single-command mode
  const inlineTask = process.argv.slice(2).join(' ').trim();
  if (inlineTask) {
    console.log(`[Single-command] "${inlineTask}"\n`);
    try {
      const result = await runOrchestrator(inlineTask);
      console.log(result.output);
      process.exit(result.success ? 0 : 1);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  // Interactive mode
  prompt();
}

main();
