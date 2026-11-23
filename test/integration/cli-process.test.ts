import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, ROOT } from '../helpers.js';
import { runCli } from './spawn.js';

// Local-only (npm run test:integration): the built binary as a real child process, the demo with its real
// timers, and log paths that depend on the operating system's file rules.

const version = (JSON.parse(readFileSync(`${ROOT}/package.json`, 'utf8')) as { version: string }).version;

test('AC-10: binary: the real entry point gives the same exit codes and output as main()', () => {
  const v = runCli(['--version']);
  assert.equal(v.status, 0, v.stderr);
  assert.equal(v.stdout.trim(), version);
  assert.equal(runCli(['report', fixture('fail.jsonl')]).status, 1);
  assert.equal(runCli(['report']).status, 64);
});

test('AC-9: demo prints the simulated banner and PASS / FAIL / PASS_SLOW within 10 s, exit 0', () => {
  const started = Date.now();
  const result = runCli(['demo', '--lang', 'en']);
  assert.equal(result.status, 0, result.stderr);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 10_000, `demo took ${elapsed} ms (limit 10 s)`);
  assert.match(result.stdout, /simulated/);
  assert.match(result.stdout, /mock:refresh\s+s-\w+\s+tools\s+PASS\s/);
  assert.match(result.stdout, /mock:ignore\s+s-\w+\s+tools\s+FAIL\s/);
  assert.match(result.stdout, /mock:delayed\s+s-\w+\s+tools\s+PASS_SLOW\s/);
  assert.match(result.stdout, /new_item_used=yes/);
});

test('AC-9: demo output switches language and still shows the verdict codes', () => {
  const ko = runCli(['demo', '--lang', 'ko']);
  assert.equal(ko.status, 0, ko.stderr);
  assert.match(ko.stdout, /연습용 목/);
  assert.match(ko.stdout, /모의/);
  assert.match(ko.stdout, /PASS_SLOW/);
});

test('AC-10: serve --log below a regular file exits 3 with the localized message (ENOTDIR)', () => {
  // A log path below a regular file cannot be created on any OS (ENOTDIR), even for root.
  const dir = mkdtempSync(join(tmpdir(), 'lcp-cli-'));
  try {
    const blocker = join(dir, 'file');
    writeFileSync(blocker, 'x');
    const bad = runCli(['serve', '--log', join(blocker, 'x', 'y.jsonl'), '--lang', 'ko']);
    assert.equal(bad.status, 3);
    assert.match(bad.stderr, /쓸 수 없습니다/);
    assert.doesNotMatch(bad.stderr, /unexpected error/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AC-10: serve --log into an existing read-only folder or onto a folder exits 3 with the localized message', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'lcp-ro-'));
  try {
    // A folder path is never writable as a log file (EISDIR), for any user.
    const onDir = runCli(['serve', '--log', dir]);
    assert.equal(onDir.status, 3, onDir.stderr);
    assert.match(onDir.stderr, /Cannot write log file/);
    assert.doesNotMatch(onDir.stderr, /unexpected error/);

    // root ignores permission bits, so the read-only case only runs for normal users.
    if (process.platform === 'win32' || process.getuid?.() === 0) {
      t.diagnostic('read-only folder case skipped (root or Windows)');
      return;
    }
    const ro = join(dir, 'ro');
    mkdirSync(ro);
    chmodSync(ro, 0o555);
    const bad = runCli(['serve', '--log', join(ro, 'p.jsonl')]);
    assert.equal(bad.status, 3, bad.stderr);
    assert.match(bad.stderr, /Cannot write log file/);
    assert.doesNotMatch(bad.stderr, /unexpected error/);
  } finally {
    try {
      chmodSync(join(dir, 'ro'), 0o755);
    } catch {
      // the folder was not created
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
