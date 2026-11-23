import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, ROOT, runCli } from './helpers.js';

const version = (JSON.parse(readFileSync(`${ROOT}/package.json`, 'utf8')) as { version: string }).version;

test('AC-5: report exit codes follow the verdicts: PASS 0, FAIL 1, UNKNOWN 2', () => {
  assert.equal(runCli(['report', fixture('pass.jsonl')]).status, 0);
  assert.equal(runCli(['report', fixture('slow.jsonl')]).status, 0, 'PASS_SLOW is not a failure');
  assert.equal(runCli(['report', fixture('fail.jsonl')]).status, 1);
  assert.equal(runCli(['report', fixture('unknown.jsonl')]).status, 2);
  assert.equal(runCli(['report', fixture('early.jsonl')]).status, 2);
  assert.equal(runCli(['report', fixture('pass.jsonl'), fixture('fail.jsonl')]).status, 1, 'FAIL wins over PASS');
});

test('AC-5: report --format json gives machine-readable rows', () => {
  const result = runCli(['report', fixture('fail.jsonl'), '--format', 'json']);
  assert.equal(result.status, 1);
  const rows = JSON.parse(result.stdout) as { verdict: string; source: string; reasons: string[]; stale_calls: number[] }[];
  assert.equal(rows[0]?.verdict, 'FAIL');
  assert.equal(rows[0]?.source, fixture('fail.jsonl'));
  assert.deepEqual(rows[0]?.reasons, ['no_relist', 'stale_call']);
  assert.equal(rows[0]?.stale_calls.length, 1);
});

test('AC-5: --threshold-ms changes PASS_SLOW into PASS', () => {
  const slow = JSON.parse(runCli(['report', fixture('slow.jsonl'), '--format', 'json']).stdout) as { verdict: string }[];
  assert.equal(slow[0]?.verdict, 'PASS_SLOW');
  const relaxed = JSON.parse(runCli(['report', fixture('slow.jsonl'), '--format', 'json', '--threshold-ms', '3000']).stdout) as { verdict: string }[];
  assert.equal(relaxed[0]?.verdict, 'PASS');
});

test('AC-5: missing file, broken line and wrong version exit 3 with the line number on stderr', () => {
  const missing = runCli(['report', '/nonexistent/probe.jsonl']);
  assert.equal(missing.status, 3);
  assert.match(missing.stderr, /Cannot read log file/);

  const broken = runCli(['report', fixture('broken.jsonl')]);
  assert.equal(broken.status, 3);
  assert.match(broken.stderr, /line 2/);
  assert.equal(broken.stdout, '');

  const version2 = runCli(['report', fixture('badversion.jsonl')]);
  assert.equal(version2.status, 3);
  assert.match(version2.stderr, /line 1/);
});

test('usage errors exit 64 with a fix-it message', () => {
  const noInput = runCli(['report']);
  assert.equal(noInput.status, 64);
  assert.match(noInput.stderr, /at least one log file/);
  assert.equal(runCli(['serve']).status, 64);
  assert.match(runCli(['serve']).stderr, /--log/);
  assert.match(runCli(['serve', '--log', 'x.jsonl', '--scenario', 'nope']).stderr, /--scenario/);
  assert.match(runCli(['report', fixture('pass.jsonl'), '--threshold-ms', 'abc']).stderr, /--threshold-ms/);
  assert.match(runCli(['report', fixture('pass.jsonl'), '--format', 'xml']).stderr, /--format/);
  assert.match(runCli(['frobnicate']).stderr, /Unknown command/);
  assert.match(runCli(['report', '--nope']).stderr, /--help/);
});

test('--version and --help succeed', () => {
  assert.equal(runCli(['--version']).stdout.trim(), version);
  const help = runCli(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /serve --log/);
});

test('AC-6: demo prints the simulated banner and PASS / FAIL / PASS_SLOW within 10 s, exit 0', () => {
  const started = Date.now();
  const result = runCli(['demo']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(Date.now() - started < 10_000);
  assert.match(result.stdout, /simulated/);
  assert.match(result.stdout, /mock:refresh\s+s-\w+\s+tools\s+PASS\s/);
  assert.match(result.stdout, /mock:ignore\s+s-\w+\s+tools\s+FAIL\s/);
  assert.match(result.stdout, /mock:delayed\s+s-\w+\s+tools\s+PASS_SLOW\s/);
  assert.match(result.stdout, /new_item_used=yes/);
});

test('AC-5: mixed PASS + UNKNOWN exits 2 (no FAIL but at least one UNKNOWN)', () => {
  assert.equal(runCli(['report', fixture('pass.jsonl'), fixture('unknown.jsonl')]).status, 2);
  assert.match(runCli(['--help']).stdout, /2 no FAIL but at least one UNKNOWN/);
});

test('negative numbers and unwritable log paths give localized messages', () => {
  const neg = runCli(['report', fixture('pass.jsonl'), '--threshold-ms', '-5', '--lang', 'ko']);
  assert.equal(neg.status, 64);
  assert.match(neg.stderr, /0 이상의 숫자/);
  const after = runCli(['serve', '--log', join(tmpdir(), 'lcp-never-written.jsonl'), '--after', '-1']);
  assert.equal(after.status, 64);
  assert.match(after.stderr, /non-negative/);
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

test('serve --log into an existing read-only folder or onto a folder exits 3 with the localized message', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'lcp-ro-'));
  try {
    // A folder path is never writable as a log file (EISDIR), for any user.
    const onDir = runCli(['serve', '--log', dir]);
    assert.equal(onDir.status, 3, onDir.stderr);
    assert.match(onDir.stderr, /Cannot write log file/);
    assert.doesNotMatch(onDir.stderr, /unexpected error/);

    // root ignores permission bits, so the read-only case only runs for normal users (e.g. CI runners).
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
