import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture, ROOT, runMain } from '../helpers.js';

// CLI checks run main() in this process (no child process, no real files written): the same code the
// binary runs, so the exit codes and messages below are exactly what a user sees.

const version = (JSON.parse(readFileSync(`${ROOT}/package.json`, 'utf8')) as { version: string }).version;

/** Exit code only (most checks need nothing else). */
const statusOf = async (args: string[]): Promise<number | null> => (await runMain(args)).status;

test('AC-2: report exit codes follow the verdicts: PASS 0, PASS_SLOW 0, FAIL 1, UNKNOWN 2', async () => {
  assert.equal(await statusOf(['report', fixture('pass.jsonl')]), 0);
  assert.equal(await statusOf(['report', fixture('slow.jsonl')]), 0, 'PASS_SLOW is not a failure');
  assert.equal(await statusOf(['report', fixture('fail.jsonl')]), 1);
  assert.equal(await statusOf(['report', fixture('unknown.jsonl')]), 2);
  assert.equal(await statusOf(['report', fixture('early.jsonl')]), 2);
  assert.equal(await statusOf(['report', fixture('pass.jsonl'), fixture('fail.jsonl')]), 1, 'FAIL wins over PASS');
  assert.equal(await statusOf(['report', fixture('pass.jsonl'), fixture('unknown.jsonl')]), 2, 'no FAIL but one UNKNOWN');
});

test('AC-2: report --format json gives machine-readable rows', async () => {
  const result = await runMain(['report', fixture('fail.jsonl'), '--format', 'json']);
  assert.equal(result.status, 1);
  const rows = JSON.parse(result.stdout) as { verdict: string; source: string; reasons: string[]; stale_calls: number[] }[];
  assert.equal(rows[0]?.verdict, 'FAIL');
  assert.equal(rows[0]?.source, fixture('fail.jsonl'));
  assert.deepEqual(rows[0]?.reasons, ['no_relist', 'stale_call']);
  assert.equal(rows[0]?.stale_calls.length, 1);
});

test('AC-2: --threshold-ms changes PASS_SLOW into PASS', async () => {
  const slow = JSON.parse((await runMain(['report', fixture('slow.jsonl'), '--format', 'json'])).stdout) as { verdict: string }[];
  assert.equal(slow[0]?.verdict, 'PASS_SLOW');
  const relaxed = JSON.parse((await runMain(['report', fixture('slow.jsonl'), '--format', 'json', '--threshold-ms', '3000'])).stdout) as { verdict: string }[];
  assert.equal(relaxed[0]?.verdict, 'PASS');
});

test('AC-2: missing file, broken line and wrong version exit 3 with the line number on stderr', async () => {
  // 레포 안의 "없는 픽스처" 이름을 쓴다 — OS 경로(/nonexistent 등)에 기대지 않는다. 이 파일은 만들지 않는다.
  const missing = await runMain(['report', fixture('missing.jsonl')]);
  assert.equal(missing.status, 3);
  assert.match(missing.stderr, /Cannot read log file/);
  assert.equal(missing.stdout, '');

  const broken = await runMain(['report', fixture('broken.jsonl')]);
  assert.equal(broken.status, 3);
  assert.match(broken.stderr, /line 2/);
  assert.equal(broken.stdout, '');

  const version2 = await runMain(['report', fixture('badversion.jsonl')]);
  assert.equal(version2.status, 3);
  assert.match(version2.stderr, /line 1/);
});

test('AC-2: usage errors exit 64 with a fix-it message', async () => {
  const noInput = await runMain(['report']);
  assert.equal(noInput.status, 64);
  assert.match(noInput.stderr, /at least one log file/);

  const noLog = await runMain(['serve']);
  assert.equal(noLog.status, 64);
  assert.match(noLog.stderr, /--log/);

  // 아래 serve 사용법 오류는 기록 파일을 열기 전에 걸러진다(파일을 만들지 않는다).
  const neverWritten = fixture('never-written.jsonl');
  const scenario = await runMain(['serve', '--log', neverWritten, '--scenario', 'nope']);
  assert.equal(scenario.status, 64);
  assert.match(scenario.stderr, /--scenario/);

  const after = await runMain(['serve', '--log', neverWritten, '--after', '-1']);
  assert.equal(after.status, 64);
  assert.match(after.stderr, /non-negative/);

  const threshold = await runMain(['report', fixture('pass.jsonl'), '--threshold-ms', 'abc']);
  assert.equal(threshold.status, 64);
  assert.match(threshold.stderr, /--threshold-ms/);

  const format = await runMain(['report', fixture('pass.jsonl'), '--format', 'xml']);
  assert.equal(format.status, 64);
  assert.match(format.stderr, /--format/);

  const unknown = await runMain(['frobnicate']);
  assert.equal(unknown.status, 64);
  assert.match(unknown.stderr, /Unknown command/);

  const badOption = await runMain(['report', '--nope']);
  assert.equal(badOption.status, 64);
  assert.match(badOption.stderr, /--help/);

  const noCommand = await runMain([]);
  assert.equal(noCommand.status, 64, 'no command prints the help but is a usage error');
  assert.match(noCommand.stdout, /serve --log/);
});

test('AC-2: negative numbers give a localized usage error', async () => {
  const neg = await runMain(['report', fixture('pass.jsonl'), '--threshold-ms', '-5', '--lang', 'ko']);
  assert.equal(neg.status, 64);
  assert.match(neg.stderr, /0 이상의 숫자/);
});

test('AC-2: --version and --help succeed', async () => {
  const v = await runMain(['--version']);
  assert.equal(v.status, 0);
  assert.equal(v.stdout.trim(), version);
  const help = await runMain(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /serve --log/);
  assert.match(help.stdout, /2 no FAIL but at least one UNKNOWN/);
});

test('AC-2: --help lists the same exit codes the CLI really returns (PASS_SLOW is 0, usage error is 64)', async () => {
  // 도움말만 읽는 스크립트 작성자가 PASS_SLOW 를 실패로 오해하지 않도록, 도움말 문구를 실제 종료 코드와 맞춰 둔다.
  assert.equal(await statusOf(['report', fixture('slow.jsonl')]), 0);
  assert.equal(await statusOf(['report']), 64);
  const en = (await runMain(['--help', '--lang', 'en'])).stdout;
  assert.match(en, /0 all PASS or PASS_SLOW/);
  assert.match(en, /64 usage error/);
  const ko = (await runMain(['--help', '--lang', 'ko'])).stdout;
  assert.match(ko, /0 모두 PASS 또는 PASS_SLOW/);
  assert.match(ko, /64 사용법 오류/);
});
