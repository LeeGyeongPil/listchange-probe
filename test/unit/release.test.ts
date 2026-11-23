import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT, runMain } from '../helpers.js';

// AC-6: the version a user sees (--version), the package version and the changelog's newest release agree.

const pkg = JSON.parse(readFileSync(`${ROOT}/package.json`, 'utf8')) as { version: string; bin: Record<string, string>; files: string[] };
const changelog = readFileSync(`${ROOT}/CHANGELOG.md`, 'utf8');

/** The first "## [x.y.z] - date" section after "## [Unreleased]". */
function newestReleasedVersion(text: string): string | undefined {
  const afterUnreleased = text.split('## [Unreleased]')[1] ?? '';
  return afterUnreleased.match(/^## \[(\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}$/m)?.[1];
}

test('AC-6: --version, package.json and the newest CHANGELOG release are the same version', async () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  const printed = await runMain(['--version']);
  assert.equal(printed.status, 0);
  assert.equal(printed.stdout.trim(), pkg.version);
  assert.equal(newestReleasedVersion(changelog), pkg.version);
});

test('AC-6: the CHANGELOG links the newest release and Unreleased compares from it', () => {
  const v = pkg.version;
  assert.match(changelog, new RegExp(`^\\[Unreleased\\]: .*/compare/v${v.replace(/\./g, '\\.')}\\.\\.\\.HEAD$`, 'm'));
  assert.match(changelog, new RegExp(`^\\[${v.replace(/\./g, '\\.')}\\]: `, 'm'));
});

test('AC-6: the package ships the CLI entry point, both READMEs, the changelog and the license', () => {
  assert.equal(pkg.bin['listchange-probe'], 'dist/src/cli.js');
  for (const entry of ['dist/src', 'README.md', 'README.ko.md', 'CHANGELOG.md', 'LICENSE']) {
    assert.ok(pkg.files.includes(entry), `package.json files is missing ${entry}`);
  }
  // The entry point keeps its shebang so `npx listchange-probe` runs it with Node.
  assert.equal(readFileSync(`${ROOT}/src/cli.ts`, 'utf8').split('\n')[0], '#!/usr/bin/env node');
});
