import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { judge } from '../src/judge.js';
import { readLog } from '../src/report.js';
import { CLI } from './helpers.js';

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
    await Promise.race([gotRefresh.then(() => (didRefresh = true)), new Promise((r) => setTimeout(r, 5000))]);
  }
  await client.close();
  return { stderr, refreshed: didRefresh };
}

test('AC-4: serve over stdio keeps the protocol clean, records a JSONL log and report says PASS (delay >= 250 ms)', async () => {
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
    const [v] = judge(events, { thresholdMs: 2000 });
    assert.ok(v);
    assert.equal(v.verdict, 'PASS');
    assert.ok((v.relist_delay_ms ?? 0) >= 250, `delay was ${v.relist_delay_ms}`);
    assert.equal(events.at(-1)?.event, 'close');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AC-4: a second run appends to the same log with increasing seq and a new session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lcp-'));
  try {
    const log = join(dir, 'probe.jsonl');
    await runSession(log, true);
    await runSession(log, false); // a "restart": connects and lists, no trigger
    const events = readLog(log);
    events.forEach((e, i) => assert.equal(e.seq, i));
    assert.equal(new Set(events.map((e) => e.session)).size, 2);
    const verdicts = judge(events, { thresholdMs: 2000 });
    assert.equal(verdicts[0]?.verdict, 'PASS');
    assert.equal(verdicts[0]?.refreshed_on_new_session, true);
    assert.equal(verdicts[1]?.verdict, 'UNKNOWN');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
