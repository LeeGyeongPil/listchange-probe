import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { runMockClient } from '../../src/demo.js';
import { judge } from '../../src/judge.js';
import { createRecorder } from '../../src/recorder.js';
import { createProbeServer } from '../../src/server.js';
import type { Scenario } from '../../src/types.js';

// Local-only (npm run test:integration): these tests use the real mock clients, which wait on real timers
// (the delayed client re-lists after 1500 ms), and the --after timer trigger.
test('AC-10: refresh=PASS, ignore=FAIL (yet probe_new works), delayed(1500ms, threshold 1000)=PASS_SLOW', async () => {
  const [refresh, ignore, delayed] = await Promise.all([runMockClient('refresh'), runMockClient('ignore'), runMockClient('delayed')]);
  const [vr] = judge(refresh, { thresholdMs: 1000 });
  const [vi] = judge(ignore, { thresholdMs: 1000 });
  const [vd] = judge(delayed, { thresholdMs: 1000 });
  assert.ok(vr && vi && vd);

  assert.equal(vr.verdict, 'PASS');

  assert.equal(vi.verdict, 'FAIL');
  assert.equal(vi.new_item_used, true, 'the ignoring client can still call probe_new successfully');
  assert.equal(vi.relist_seq, null);

  assert.equal(vd.verdict, 'PASS_SLOW');
  // The lower bound proves the client waited; the upper bound only catches a runaway (timers fire late on a busy runner).
  assert.ok((vd.relist_delay_ms ?? 0) >= 1400 && (vd.relist_delay_ms ?? 0) < 30_000, `delay was ${vd.relist_delay_ms}`);
});

test('AC-10: the recorder writes monotonic seq, one session, start and close events', async () => {
  const events = await runMockClient('refresh', { settleMs: 50 });
  assert.equal(events[0]?.event, 'start');
  assert.equal(events.at(-1)?.event, 'close');
  events.forEach((e, i) => assert.equal(e.seq, i));
  assert.equal(new Set(events.map((e) => e.session)).size, 1);
  const init = events.find((e) => e.method === 'initialize');
  assert.equal(init?.client?.name, 'mock-refresh');
  const initResponse = events.find((e) => e.dir === 'out' && e.id === init?.id);
  assert.equal(initResponse?.protocol_version !== undefined, true);
});

test('AC-10: a removed probe_old gets protocol error -32602 and the verdict carries stale_call with evidence seq', async () => {
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
  test(`AC-10: ${scenario} scenario - refreshing client PASS, ignoring client FAIL with stale call`, async () => {
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

test('AC-10: --after style timer triggers the change without any tool call', async () => {
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
