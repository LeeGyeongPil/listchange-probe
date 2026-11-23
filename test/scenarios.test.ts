import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { runMockClient } from '../src/demo.js';
import { judge } from '../src/judge.js';
import { createRecorder } from '../src/recorder.js';
import { createProbeServer } from '../src/server.js';
import { SCENARIOS } from '../src/scenarios.js';
import type { Scenario } from '../src/types.js';

test('AC-3: a removed probe_old gets protocol error -32602 and the verdict carries stale_call with evidence seq', async () => {
  const events = await runMockClient('ignore', { settleMs: 100 });
  const [v] = judge(events, { thresholdMs: 1000 });
  assert.ok(v);
  assert.equal(v.verdict, 'FAIL');
  assert.ok(v.reasons.includes('stale_call'));
  assert.ok(v.stale_calls.length > 0);
  const staleEvent = events.find((e) => e.seq === v.stale_calls[0]);
  assert.equal(staleEvent?.name, 'probe_old');
  const response = events.find((e) => e.dir === 'out' && e.kind === 'response' && e.id === staleEvent?.id);
  assert.equal(response?.error_code, -32602);
});

for (const scenario of ['tools', 'prompts', 'resources'] as Scenario[]) {
  test(`AC-3: ${scenario} scenario - refreshing client PASS, ignoring client FAIL with stale call`, async () => {
    const refresh = judge(await runMockClient('refresh', { scenario, settleMs: 100 }), { thresholdMs: 1000 });
    assert.equal(refresh.length, 1);
    assert.equal(refresh[0]?.scenario, scenario);
    assert.equal(refresh[0]?.verdict, 'PASS');
    assert.deepEqual(refresh[0]?.stale_calls, []);

    const ignore = judge(await runMockClient('ignore', { scenario, settleMs: 100 }), { thresholdMs: 1000 });
    assert.equal(ignore[0]?.verdict, 'FAIL');
    assert.ok(ignore[0]?.reasons.includes('stale_call'));
    assert.equal(ignore[0]?.new_item_used, true);
  });
}

test('server: the removed item is really gone and the new one is there (all scenarios)', async () => {
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

test('server: --after style timer triggers the change without any tool call', async () => {
  const recorder = createRecorder(null);
  const probe = createProbeServer({ scenarios: ['tools'], recorder, afterMs: 50 });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await probe.connect(st);
  // 고정 대기 대신 재목록이 실제로 끝났다는 신호를 기다린다(느린 러너에서 타이머가 늦어도 결과가 같다).
  let markRelisted: () => void = () => undefined;
  const relisted = new Promise<void>((resolve) => {
    markRelisted = resolve;
  });
  const client = new Client({ name: 'c', version: '0' }, { listChanged: { tools: { debounceMs: 0, onChanged: () => markRelisted() } } });
  await client.connect(ct);
  await client.listTools();
  let cap: NodeJS.Timeout | undefined;
  try {
    // At most 30 s: only a broken server or client would get that far; the cap timer is always cleared.
    await Promise.race([relisted, new Promise<void>((r) => (cap = setTimeout(r, 30_000)))]);
  } finally {
    clearTimeout(cap);
  }
  await client.close();
  const [v] = judge(recorder.events, { thresholdMs: 1000 });
  assert.equal(v?.verdict, 'PASS');
  assert.equal(recorder.events.some((e) => e.method === 'tools/call'), false);
});

test('server: rejects an empty scenario list with a clear message', () => {
  assert.throws(() => createProbeServer({ scenarios: [], recorder: createRecorder(null) }), /At least one scenario/);
});
