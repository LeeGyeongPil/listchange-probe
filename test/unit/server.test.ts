import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  McpError,
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { judge } from '../../src/judge.js';
import { createRecorder } from '../../src/recorder.js';
import { createProbeServer } from '../../src/server.js';
import { SCENARIOS, TRIGGER_TOOL } from '../../src/scenarios.js';
import type { LogEvent, Scenario } from '../../src/types.js';

// The real probe server, tested without any timer: the client moves on only when the first
// list_changed notification has actually arrived. Everything stays in memory (no file, no port).

/**
 * Far above any real delay, so how fast this machine is never changes a verdict. The re-list here
 * happens within the same few event-loop turns, so only the ORDER of events decides PASS or FAIL.
 */
const THRESHOLD_MS = 60_000;

const NOTIFICATION_SCHEMA = {
  tools: ToolListChangedNotificationSchema,
  prompts: PromptListChangedNotificationSchema,
  resources: ResourceListChangedNotificationSchema,
} as const;

/**
 * Connects one hand-written client to a real probe server and returns the recorded events.
 * - 'refresh': after the first notification arrives, it asks for the list once (as the spec expects).
 * - 'ignore': it never asks again and calls the new item, then the removed one, from its old knowledge.
 */
async function connectClient(scenario: Scenario, mode: 'refresh' | 'ignore'): Promise<LogEvent[]> {
  const spec = SCENARIOS[scenario];
  const recorder = createRecorder(null); // in memory: no file is written
  const probe = createProbeServer({ scenarios: [scenario], recorder });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await probe.connect(serverTransport, 'in-memory');

  // No listChanged option: the SDK's automatic re-list (and its debounce) stays off; this test drives it.
  const client = new Client({ name: `unit-${mode}`, version: '0.0.0' });
  // 첫 알림이 "도착했다"는 신호 — 시간 대신 이 신호로만 다음 단계로 넘어간다.
  let markNotified: () => void = () => undefined;
  const notified = new Promise<void>((resolve) => {
    markNotified = resolve;
  });
  client.setNotificationHandler(NOTIFICATION_SCHEMA[scenario], async () => markNotified());
  await client.connect(clientTransport);

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

  await list(); // the initial list every client does
  await client.callTool({ name: TRIGGER_TOOL, arguments: {} }); // the server changes its lists
  await notified; // the notification reached the client

  if (mode === 'refresh') {
    await list(); // the re-list the judge looks for
  } else {
    await use(spec.newItem); // works without a re-list, so it proves nothing
    await use(spec.oldItem).catch(() => undefined); // the removed item: the server answers with an error
  }
  await client.close();
  return recorder.events;
}

for (const scenario of ['tools', 'prompts', 'resources'] as Scenario[]) {
  test(`AC-3: ${scenario} - a client that re-lists after the notification is PASS`, async () => {
    const verdicts = judge(await connectClient(scenario, 'refresh'), { thresholdMs: THRESHOLD_MS });
    assert.equal(verdicts.length, 1);
    const [v] = verdicts;
    assert.ok(v);
    assert.equal(v.scenario, scenario);
    assert.equal(v.verdict, 'PASS');
    assert.deepEqual(v.reasons, []);
    assert.deepEqual(v.stale_calls, []);
    assert.ok(v.relist_seq !== null && v.notification_seq !== null && v.relist_seq > v.notification_seq, 'the re-list comes after the notification (seq order)');
  });

  test(`AC-3: ${scenario} - a client that ignores the notification is FAIL with stale_call evidence`, async () => {
    const events = await connectClient(scenario, 'ignore');
    const [v] = judge(events, { thresholdMs: THRESHOLD_MS });
    assert.ok(v);
    assert.equal(v.verdict, 'FAIL');
    assert.deepEqual(v.reasons, ['no_relist', 'stale_call']);
    assert.equal(v.relist_seq, null);
    assert.equal(v.new_item_used, true, 'calling the new item worked, yet the client is still FAIL');
    // The evidence seq points at the call of the removed item, and the server answered -32602.
    const staleEvent = events.find((e) => e.seq === v.stale_calls[0]);
    assert.equal(staleEvent?.name, SCENARIOS[scenario].oldItem);
    const response = events.find((e) => e.dir === 'out' && e.kind === 'response' && e.id === staleEvent?.id);
    assert.equal(response?.error_code, -32602);
  });
}

test('AC-3: the removed item is really gone, the new one is there, and a second probe_add changes nothing', async () => {
  const recorder = createRecorder(null);
  const probe = createProbeServer({ scenarios: ['tools', 'prompts', 'resources'], recorder });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await probe.connect(st);
  const client = new Client({ name: 'c', version: '0' });
  await client.connect(ct);
  assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), ['probe_add', 'probe_old']);
  await client.callTool({ name: 'probe_add', arguments: {} });
  assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), ['probe_add', 'probe_new']);
  assert.deepEqual((await client.listPrompts()).prompts.map((p) => p.name), ['probe_prompt_new']);
  assert.deepEqual((await client.listResources()).resources.map((r) => r.uri), ['probe://new']);
  await assert.rejects(client.getPrompt({ name: SCENARIOS.prompts.oldItem }), (e: unknown) => e instanceof McpError && e.code === -32602);
  await assert.rejects(client.readResource({ uri: SCENARIOS.resources.oldItem }), (e: unknown) => e instanceof McpError && e.code === -32602);
  // A second probe_add must not change anything again.
  const again = await client.callTool({ name: 'probe_add', arguments: {} });
  assert.match(JSON.stringify(again), /Already changed/);
  assert.equal(probe.trigger(), false);
  await client.close();
  // One mutation event per scenario, written before the notifications.
  const mutations = recorder.events.filter((e) => e.event === 'mutation');
  assert.equal(mutations.length, 3);
  const firstNotification = recorder.events.find((e) => e.method?.endsWith('list_changed'));
  assert.ok(mutations[0] && firstNotification && mutations[0].seq < firstNotification.seq);
});

test('AC-3: the recorder writes monotonic seq, one session, start and close events', async () => {
  const events = await connectClient('tools', 'refresh');
  assert.equal(events[0]?.event, 'start');
  assert.equal(events.at(-1)?.event, 'close');
  events.forEach((e, i) => assert.equal(e.seq, i));
  assert.equal(new Set(events.map((e) => e.session)).size, 1);
  const init = events.find((e) => e.method === 'initialize');
  assert.equal(init?.client?.name, 'unit-refresh');
});

test('AC-3: rejects an empty scenario list with a clear message', () => {
  assert.throws(() => createProbeServer({ scenarios: [], recorder: createRecorder(null) }), /At least one scenario/);
});
