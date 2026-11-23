import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/main.js';

const here = dirname(fileURLToPath(import.meta.url));
/** Repository root (tests run from dist/test). */
export const ROOT = resolve(here, '../..');

export function fixture(name: string): string {
  return resolve(ROOT, 'test/fixtures', name);
}

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the CLI in this process: same code path as the binary, but no child process and no inherited
 * locale variables (the environment is exactly `env`). stdout and stderr are collected in memory.
 */
export async function runMain(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  let stdout = '';
  let stderr = '';
  const status = await main(args, env, {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  return { status, stdout, stderr };
}
