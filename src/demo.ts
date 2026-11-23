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
  /** Minimum wait after the trigger before using the items. Re-listing clients also wait for their re-list to finish. */
  settleMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for `promise`, but at most `ms`; the timer is always cleared so nothing keeps the process alive. */
async function waitAtMost(promise: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([promise, cap]);
  } finally {
    clearTimeout(timer);
  }
}

/** Upper bound for waiting on a re-list that should happen; reached only if a client is broken. */
const RELIST_WAIT_CAP_MS = 10_000;

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

  // 재목록이 실제로 끝난 순간을 알려 주는 신호 — 고정 대기(sleep) 대신 이것을 기다려 느린 CI 에서도 결과가 같다.
  let markRelisted: () => void = () => undefined;
  const relisted = new Promise<void>((resolve) => {
    markRelisted = resolve;
  });

  // "refresh" asks the SDK to re-list automatically (debounce 0); the other two do not.
  const clientOptions =
    mode === 'refresh' ? { listChanged: { [scenario]: { debounceMs: 0, onChanged: () => markRelisted() } } } : {};
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
  let delayTimer: NodeJS.Timeout | undefined;
  if (mode === 'delayed') {
    // Re-lists only after a pause, as a slow client would.
    // One trigger sends two notifications (add + remove); only the first schedules the re-list.
    const schema =
      scenario === 'tools' ? ToolListChangedNotificationSchema : scenario === 'prompts' ? PromptListChangedNotificationSchema : ResourceListChangedNotificationSchema;
    client.setNotificationHandler(schema, async () => {
      if (delayTimer) return;
      delayTimer = setTimeout(() => {
        list().then(markRelisted, () => markRelisted());
      }, delayMs);
    });
  }

  await list(); // the initial list every client does
  await client.callTool({ name: TRIGGER_TOOL, arguments: {} }); // trigger: the server changes its lists
  // 모든 클라이언트가 같은 시간(settleMs)을 기다린다. 재목록하는 클라이언트는 그 재목록이 끝날 때까지도 기다린다
  // (타이머가 늦게 도는 바쁜 러너에서 재목록 전에 세션이 닫혀 PASS_SLOW 가 FAIL 로 바뀌는 경쟁을 없앤다).
  await Promise.all([sleep(settleMs), mode === 'ignore' ? Promise.resolve() : waitAtMost(relisted, delayMs + RELIST_WAIT_CAP_MS)]);
  await use(spec.newItem); // works for every client that knows the name, so it proves nothing
  if (mode === 'ignore') {
    // A client with an outdated list still calls the removed item: the server answers with an error.
    await use(spec.oldItem).catch(() => undefined);
  }
  clearTimeout(delayTimer);
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
