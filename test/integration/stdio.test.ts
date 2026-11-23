import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { judge } from '../../src/judge.js';
import { readLog } from '../../src/report.js';
import { CLI } from './spawn.js';

// Time bounds here only catch a hang; none of them is a speed check, so a slow CI runner cannot fail the test.
/** Longest wait for the client's re-list after probe_add (the wait ends as soon as it happens). */
const REFRESH_WAIT_CAP_MS = 30_000;
/** Per-test bound (two child processes, each closed within 2 s by the SDK). */
const TEST_TIMEOUT_MS = 120_000;
/**
 * Threshold for judging these logs. The test checks that the re-list happened and was debounced,
 * not how fast this machine is, so it is far above the ~300 ms an SDK client needs.
 */
const JUDGE_THRESHOLD_MS = 10_000;

/** Connects an SDK client (default 300 ms debounce) to a real `serve` child process. */
async function runSession(logPath: string, callTrigger: boolean): Promise<{ stderr: string; refreshed: boolean }> {
  let refreshed: (() => void) | undefined;
  const gotRefresh = new Promise<void>((resolve) => {
    refreshed = resolve;
  });
  const client = new Client({ name: 'stdio-test-client', version: '0.0.0' }, { listChanged: { tools: { onChanged: () => refreshed?.() } } });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI, 'serve', '--log', logPath],
    env: { LISTCHANGE_PROBE_LANG: 'en' },
    stderr: 'pipe',
  });
  let stderr = '';
  await client.connect(transport); // fails if anything but JSON-RPC was written to stdout
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  await client.listTools();
  let didRefresh = false;
  if (callTrigger) {
    await client.callTool({ name: 'probe_add', arguments: {} });
    // Wait for the refresh, but at most REFRESH_WAIT_CAP_MS; the cap timer is cleared so it never keeps the test process alive.
    let cap: NodeJS.Timeout | undefined;
    try {
      await Promise.race([gotRefresh.then(() => (didRefresh = true)), new Promise((r) => (cap = setTimeout(r, REFRESH_WAIT_CAP_MS)))]);
    } finally {
      clearTimeout(cap);
    }
  }
  await client.close();
  return { stderr, refreshed: didRefresh };
}

test('AC-10: serve over stdio keeps the protocol clean, records a JSONL log and report says PASS (delay >= 250 ms)', { timeout: TEST_TIMEOUT_MS }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lcp-'));
  try {
    const log = join(dir, 'nested', 'probe.jsonl'); // the missing folder is created
    const result = await runSession(log, true);
    assert.equal(result.refreshed, true, 'client should have been told to refresh');
    assert.match(result.stderr, /listchange-probe is serving on stdio/);

    const events = readLog(log);
    assert.equal(events[0]?.event, 'start');
    assert.equal(events[0]?.transport, 'stdio');
    assert.ok(events.some((e) => e.method === 'notifications/tools/list_changed' && e.dir === 'out'));
    const [v] = judge(events, { thresholdMs: JUDGE_THRESHOLD_MS });
    assert.ok(v);
    assert.equal(v.verdict, 'PASS');
    // The SDK client starts its 300 ms debounce only after receiving the (second) notification, so the
    // delay can never be below ~300 ms; 250 leaves margin and still proves the debounce is in effect.
    assert.ok((v.relist_delay_ms ?? 0) >= 250, `delay was ${v.relist_delay_ms}`);
    assert.equal(events.at(-1)?.event, 'close');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AC-10: a second run appends to the same log with increasing seq and a new session', { timeout: TEST_TIMEOUT_MS }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lcp-'));
  try {
    const log = join(dir, 'probe.jsonl');
    await runSession(log, true);
    await runSession(log, false); // a "restart": connects and lists, no trigger
    const events = readLog(log);
    events.forEach((e, i) => assert.equal(e.seq, i));
    assert.equal(new Set(events.map((e) => e.session)).size, 2);
    const verdicts = judge(events, { thresholdMs: JUDGE_THRESHOLD_MS });
    assert.equal(verdicts[0]?.verdict, 'PASS');
    assert.equal(verdicts[0]?.refreshed_on_new_session, true);
    assert.equal(verdicts[1]?.verdict, 'UNKNOWN');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
