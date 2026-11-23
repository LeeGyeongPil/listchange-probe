import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { ROOT } from '../helpers.js';

// AC-8: unit tests (what CI runs) stay deterministic. Anything that waits on real time, starts a process,
// touches OS temp paths or opens a port belongs in test/integration (npm run test:integration).

const unitDir = `${ROOT}/test/unit`;

/** Tokens that must not appear in unit tests. Kept here, so this file itself is skipped. */
const FORBIDDEN = [
  'child_process',
  'setTimeout',
  'setInterval',
  'sleep(',
  'tmpdir',
  'node:http',
  'node:net',
  '.listen(',
  'StdioClientTransport',
  'runMockClient',
  'runDemo',
  "runMain(['demo'",
  'afterMs',
  'runCli',
];

test('AC-8: unit test sources contain no timer, process, temp-path or network tokens', () => {
  const files = readdirSync(unitDir).filter((f) => f.endsWith('.ts') && f !== 'guard.test.ts');
  assert.ok(files.length >= 7, `expected the unit test files, found ${files.join(', ')}`);
  for (const file of files) {
    const text = readFileSync(`${unitDir}/${file}`, 'utf8');
    for (const token of FORBIDDEN) assert.equal(text.includes(token), false, `test/unit/${file} contains "${token}"`);
  }
});

test('AC-8: npm test loads only the unit tests; integration tests have their own script', () => {
  const scripts = (JSON.parse(readFileSync(`${ROOT}/package.json`, 'utf8')) as { scripts: Record<string, string> }).scripts;
  assert.equal(scripts.test, 'node --test dist/test/unit/*.test.js');
  assert.equal(scripts['test:integration'], 'node --test dist/test/integration/*.test.js');
  assert.equal(scripts.pretest, 'npm run build');
  assert.equal(scripts['pretest:integration'], 'npm run build');
});
