import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../src/judge.js';
import { readLog } from '../src/report.js';
import { fixture } from './helpers.js';

const judgeFixture = (name: string, thresholdMs = 2000) => judge(readLog(fixture(name)), { thresholdMs });

test('AC-1: same-millisecond initial tools/list is not mistaken for the re-list (seq order, not time)', () => {
  const [v] = judgeFixture('same-ms.jsonl');
  assert.ok(v);
  assert.equal(v.verdict, 'PASS');
  assert.equal(v.relist_delay_ms, 1500);
  assert.notEqual(v.relist_seq, 3); // seq 3 is the initial tools/list stamped with the same t_ms
});

test('AC-1: PASS when the re-list is within the threshold', () => {
  const [v] = judgeFixture('pass.jsonl');
  assert.ok(v);
  assert.equal(v.verdict, 'PASS');
  assert.deepEqual(v.reasons, []);
  assert.equal(v.relist_delay_ms, 300);
  assert.equal(v.notification_count, 2);
  assert.equal(v.relist_after_last, true);
});

test('AC-1: PASS_SLOW when the re-list is later than the threshold; threshold is configurable', () => {
  const [v] = judgeFixture('slow.jsonl');
  assert.ok(v);
  assert.equal(v.verdict, 'PASS_SLOW');
  assert.deepEqual(v.reasons, ['slow_relist']);
  assert.equal(judgeFixture('slow.jsonl', 3000)[0]?.verdict, 'PASS');
});

test('AC-1: FAIL with no_relist and stale_call evidence', () => {
  const [v] = judgeFixture('fail.jsonl');
  assert.ok(v);
  assert.equal(v.verdict, 'FAIL');
  assert.deepEqual(v.reasons, ['no_relist', 'stale_call']);
  assert.equal(v.stale_calls.length, 1);
  assert.equal(v.relist_seq, null);
  assert.equal(v.relist_delay_ms, null);
});

test('AC-1: a stale call before a late re-list is only a warning on a PASS', () => {
  const [v] = judgeFixture('stale.jsonl');
  assert.ok(v);
  assert.equal(v.verdict, 'PASS');
  assert.deepEqual(v.reasons, ['stale_call_before_relist']);
  assert.equal(v.stale_calls.length, 1);
});

test('AC-1: UNKNOWN no_notification when the trigger never happened', () => {
  const [v] = judgeFixture('unknown.jsonl');
  assert.ok(v);
  assert.equal(v.verdict, 'UNKNOWN');
  assert.deepEqual(v.reasons, ['no_notification']);
  assert.equal(v.notification_seq, null);
});

test('AC-1: UNKNOWN session_ended_early when the session ended inside the threshold without a re-list', () => {
  const [v] = judgeFixture('early.jsonl');
  assert.ok(v);
  assert.equal(v.verdict, 'UNKNOWN');
  assert.deepEqual(v.reasons, ['session_ended_early']);
  // With a threshold shorter than the observed time the same log becomes FAIL.
  assert.equal(judgeFixture('early.jsonl', 100)[0]?.verdict, 'FAIL');
});

test('AC-1: refreshed_on_new_session marks a client that only lists again after a restart', () => {
  const verdicts = judgeFixture('new-session.jsonl');
  assert.equal(verdicts.length, 2);
  assert.equal(verdicts[0]?.verdict, 'FAIL');
  assert.equal(verdicts[0]?.refreshed_on_new_session, true);
  assert.equal(verdicts[1]?.verdict, 'UNKNOWN');
  assert.equal(verdicts[1]?.refreshed_on_new_session, false);
});

test('AC-1: scenarios not announced by the start event are not reported; sessions without start are skipped', () => {
  const events = readLog(fixture('pass.jsonl'));
  assert.deepEqual(
    judge(events, { thresholdMs: 2000 }).map((v) => v.scenario),
    ['tools'],
  );
  const withoutStart = events.filter((e) => e.event !== 'start');
  assert.deepEqual(judge(withoutStart, { thresholdMs: 2000 }), []);
  assert.deepEqual(judge([], { thresholdMs: 2000 }), []);
});
