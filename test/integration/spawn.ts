import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ROOT } from '../helpers.js';
import type { CliResult } from '../helpers.js';

/** The built binary, run as a real child process (integration tests only). */
export const CLI = resolve(ROOT, 'dist/src/cli.js');

/**
 * Upper bound for one CLI run. It only stops a hung process; it is not a speed check.
 * A CPU-starved machine was measured at 2-17 s for one `report` run (normally ~0.1 s), and an
 * earlier 30 s bound killed runs there (status null), so the bound is far above any real run.
 */
const CLI_RUN_CAP_MS = 120_000;

/** Runs the built CLI with a clean environment (no inherited locale variables). */
export function runCli(args: string[], env: Record<string, string> = {}): CliResult {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...env },
    timeout: CLI_RUN_CAP_MS,
  });
  // 상한에 닿아 죽었거나 띄우지 못했으면 원인을 남긴다 — 그냥 두면 "null !== 0" 만 보여 원인을 알 수 없다.
  if (result.error || result.signal) {
    const why = result.error ? result.error.message : `killed by ${result.signal}`;
    process.stderr.write(`runCli(${args.join(' ')}): ${why}\n`);
  }
  // CLI 가 예기치 않은 오류로 죽었으면 그 스택도 남긴다(단언 메시지에는 종료 코드만 보인다).
  if (result.stderr?.includes('unexpected error')) process.stderr.write(`runCli(${args.join(' ')}): ${result.stderr}\n`);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
