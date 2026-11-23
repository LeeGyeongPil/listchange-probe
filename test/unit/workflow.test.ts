import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { ROOT } from '../helpers.js';

// AC-7: CI stays minimal - check out, set up Node 22, then exactly npm ci, npm run build, npm test.
// Plain line checks (no YAML parser, no new dependency): they assume the block style used in ci.yml.

const workflowsDir = `${ROOT}/.github/workflows`;
const lines = readFileSync(`${workflowsDir}/ci.yml`, 'utf8').split('\n');
const values = (key: string): string[] =>
  lines
    .map((l) => l.trim().replace(/^- /, ''))
    .filter((l) => l.startsWith(`${key}:`))
    .map((l) => l.slice(key.length + 1).trim());

test('AC-7: ci.yml is the only workflow and .github/scripts is gone', () => {
  assert.deepEqual(readdirSync(workflowsDir), ['ci.yml']);
  assert.equal(existsSync(`${ROOT}/.github/scripts`), false);
});

test('AC-7: one job on ubuntu-latest with Node 22', () => {
  assert.deepEqual(values('runs-on'), ['ubuntu-latest']);
  assert.deepEqual(values('node-version'), ['22']);
});

test('AC-7: no matrix, schedule, cache, tee or artifact upload', () => {
  const text = lines.join('\n');
  for (const word of ['matrix', 'strategy', 'schedule', 'cache:', 'tee', 'upload-artifact']) {
    assert.equal(text.includes(word), false, `ci.yml must not contain "${word}"`);
  }
});

test('AC-7: only checkout and setup-node actions, pinned to a major tag', () => {
  const uses = values('uses');
  assert.equal(uses.length, 2);
  assert.match(uses[0] ?? '', /^actions\/checkout@v\d+$/);
  assert.match(uses[1] ?? '', /^actions\/setup-node@v\d+$/);
});

test('AC-7: the only run steps are npm ci, npm run build, npm test - in that order', () => {
  assert.deepEqual(values('run'), ['npm ci', 'npm run build', 'npm test']);
});
