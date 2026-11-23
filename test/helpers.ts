import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** Repository root (tests run from dist/test). */
export const ROOT = resolve(here, '../..');
export const CLI = resolve(ROOT, 'dist/src/cli.js');

export function fixture(name: string): string {
  return resolve(ROOT, 'test/fixtures', name);
}

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the built CLI with a clean environment (no inherited locale variables). */
export function runCli(args: string[], env: Record<string, string> = {}): CliResult {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...env },
    timeout: 30_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
