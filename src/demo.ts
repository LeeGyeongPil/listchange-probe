import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createRecorder } from './recorder.js';
import { createProbeServer } from './server.js';
import { SCENARIOS, TRIGGER_TOOL } from './scenarios.js';
import { buildRows, type ReportRow } from './report.js';
import { renderTable } from './format.js';
import type { Translator } from './i18n/index.js';
import type { LogEvent, Scenario } from './types.js';

/** The three simulated clients (practice mocks built on the SDK client). */
export type MockMode = 'refresh' | 'ignore' | 'delayed';

export interface MockOptions {
  scenario?: Scenario;
  /** How long the "delayed" client waits before re-listing. */
  delayMs?: number;
  /** How long to wait after the trigger before using the items (must exceed delayMs). */
  settleMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs one mock client against a real probe server (in memory) and returns the recorded events.
 * The server, recorder and judge are the real ones; only the client is simulated.
 */
export async function runMockClient(mode: MockMode, opts: MockOptions = {}): Promise<LogEvent[]> {
  const scenario = opts.scenario ?? 'tools';
  const delayMs = opts.delayMs ?? 1500;
  const settleMs = opts.settleMs ?? delayMs + 300;
  const spec = SCENARIOS[scenario];

  const recorder = createRecorder(null);
  const probe = createProbeServer({ scenarios: [scenario], recorder });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await probe.connect(serverTransport, 'in-memory');

  // "refresh" asks the SDK to re-list automatically (debounce 0); the other two do not.
  const clientOptions = mode === 'refresh' ? { listChanged: { [scenario]: { debounceMs: 0, onChanged: () => undefined } } } : {};
  const client = new Client({ name: `mock-${mode}`, version: '0.0.0' }, clientOptions);

  const list = async (): Promise<void> => {
    if (scenario === 'tools') await client.listTools();
    else if (scenario === 'prompts') await client.listPrompts();
    else await client.listResources();
  };
  const use = async (name: string): Promise<void> => {
    if (scenario === 'tools') await client.callTool({ name, arguments: {} });
    else if (scenario === 'prompts') await client.getPrompt({ name });
    else await client.readResource({ uri: name });
  };

  await client.connect(clientTransport);
  if (mode === 'delayed') {
    // Re-lists only after a pause, as a slow client would.
    const schema =
      scenario === 'tools' ? ToolListChangedNotificationSchema : scenario === 'prompts' ? PromptListChangedNotificationSchema : ResourceListChangedNotificationSchema;
    client.setNotificationHandler(schema, async () => {
      setTimeout(() => {
        list().catch(() => undefined);
      }, delayMs);
    });
  }

  await list(); // the initial list every client does
  await client.callTool({ name: TRIGGER_TOOL, arguments: {} }); // trigger: the server changes its lists
  await sleep(settleMs);
  await use(spec.newItem); // works for every client that knows the name, so it proves nothing
  if (mode === 'ignore') {
    // A client with an outdated list still calls the removed item: the server answers with an error.
    await use(spec.oldItem).catch(() => undefined);
  }
  await client.close();
  return recorder.events;
}

export interface DemoResult {
  rows: ReportRow[];
  text: string;
  exitCode: 0;
}

/** Runs the three mock clients in parallel and renders the table. Exit code is always 0 (it is a demo). */
export async function runDemo(t: Translator, thresholdMs = 1000): Promise<DemoResult> {
  const modes: MockMode[] = ['refresh', 'ignore', 'delayed'];
  const runs = await Promise.all(modes.map((mode) => runMockClient(mode)));
  const rows = modes.flatMap((mode, i) => buildRows(`mock:${mode}`, runs[i] as LogEvent[], thresholdMs));
  let text = renderTable(rows, t, thresholdMs, t('demo.banner'));
  text += '\n' + modes.map((m) => `mock:${m} = ${t(`demo.client.${m}` as const)}`).join('\n') + '\n';
  text += '\n' + t('demo.lesson') + '\n';
  return { rows, text, exitCode: 0 };
}
