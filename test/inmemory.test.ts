import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMockClient } from '../src/demo.js';
import { judge } from '../src/judge.js';

test('AC-2: refresh=PASS, ignore=FAIL (yet probe_new works), delayed(1500ms, threshold 1000)=PASS_SLOW', async () => {
  const [refresh, ignore, delayed] = await Promise.all([runMockClient('refresh'), runMockClient('ignore'), runMockClient('delayed')]);
  const [vr] = judge(refresh, { thresholdMs: 1000 });
  const [vi] = judge(ignore, { thresholdMs: 1000 });
  const [vd] = judge(delayed, { thresholdMs: 1000 });
  assert.ok(vr && vi && vd);

  assert.equal(vr.verdict, 'PASS');
  assert.ok((vr.relist_delay_ms ?? Infinity) < 1000);

  assert.equal(vi.verdict, 'FAIL');
  assert.equal(vi.new_item_used, true, 'the ignoring client can still call probe_new successfully');
  assert.equal(vi.relist_seq, null);

  assert.equal(vd.verdict, 'PASS_SLOW');
  assert.ok((vd.relist_delay_ms ?? 0) >= 1400 && (vd.relist_delay_ms ?? 0) < 2500, `delay was ${vd.relist_delay_ms}`);
});

test('AC-2: the recorder writes monotonic seq, one session, start and close events', async () => {
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
