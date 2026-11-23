// Explains a failed CI run so nobody has to download the raw log to see what broke.
//
// ci.yml pipes every step's output into ci-logs/<n>-<step>.log. When the job fails this script
//   1. finds the step that broke (the last log written: steps run in order and stop at the first failure),
//   2. pulls out the failing tests from Node's TAP output, or the error lines of any other step,
//   3. prints them as ::error annotations (shown on the run page and by `gh run view`),
//   4. appends a Markdown report with the log tail to $GITHUB_STEP_SUMMARY (when set) and to stdout.
// No dependencies, so it also works when `npm ci` or the build is what failed.
// It always exits 0: the job is already red when this runs.
//
// Usage: node .github/scripts/explain-failure.mjs [ci-logs]
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'ci-logs';
const TAIL_LINES = 60;
const MAX_ANNOTATIONS = 10;
const MAX_ERROR_LINES = 12;

// GitHub workflow commands: the message must escape %, CR and LF; property values also : and ,
const escapeData = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
const indentOf = (line) => line.length - line.trimStart().length;

/** Value of a one-line YAML field such as `  location: '/x/y.js:3:1'`, without quotes. */
function yamlField(block, name) {
  const line = block.find((l) => l.trimStart().startsWith(`${name}: `));
  return line ? line.trimStart().slice(name.length + 2).replace(/^'(.*)'$/, '$1') : '';
}

/** The `error:` field of a TAP YAML block: either `error: 'text'` or a `error: |-` block below it. */
function yamlError(block) {
  const at = block.findIndex((l) => l.trimStart().startsWith('error: '));
  if (at < 0) return '';
  const value = block[at].trimStart().slice('error: '.length);
  if (!value.startsWith('|')) return value.replace(/^'(.*)'$/, '$1');
  const fieldIndent = indentOf(block[at]);
  const text = [];
  for (const line of block.slice(at + 1)) {
    if (line.trim() !== '' && indentOf(line) <= fieldIndent) break; // the next field starts
    text.push(line.trim());
  }
  return text.filter((l) => l !== '').join('\n');
}

/**
 * Failing tests in Node's TAP output: "not ok N - name" followed by an indented YAML block
 * ("---" ... "..."). Comment lines ("# ...") right above a test are what its file printed,
 * e.g. the stack of a test file that crashed while loading.
 */
function failingTestsFromTap(lines) {
  const failures = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\s*)not ok \d+ - (.*)$/);
    if (!match) continue;
    const indent = match[1].length;
    const block = [];
    for (const line of lines.slice(i + 1)) {
      if (line.trim() === '...' && indentOf(line) === indent + 2) break; // end of this test's YAML block
      block.push(line);
    }
    // 부모 테스트의 "1 subtest failed" 는 자식이 따로 보고되므로 건너뛴다.
    if (yamlField(block, 'failureType') === 'subtestsFailed') continue;
    const printed = [];
    for (let j = i - 1; j >= 0 && /^\s*#/.test(lines[j]); j--) {
      if (!/^\s*# Subtest:/.test(lines[j])) printed.unshift(lines[j].trim().replace(/^# ?/, ''));
    }
    failures.push({
      name: match[2].trim(),
      location: yamlField(block, 'location'),
      error: [yamlError(block), ...printed.slice(-MAX_ERROR_LINES)].filter(Boolean).join('\n'),
    });
  }
  return failures;
}

/** Fallback for the "spec" reporter (newer Node versions, or a terminal): "✖ name (12ms)" plus the indented error below it. */
function failingTestsFromSpec(lines) {
  const byName = new Map();
  lines.forEach((line, i) => {
    const match = line.match(/^(\s*)✖ (.+?)(?: \([\d.]+m?s\))?$/);
    if (!match || match[2] === 'failing tests:') return;
    const error = [];
    for (const next of lines.slice(i + 1)) {
      if (next.trim() !== '' && indentOf(next) <= match[1].length) break;
      if (next.trim() !== '') error.push(next.trim());
    }
    // 같은 테스트가 진행 중 출력과 끝의 "failing tests:" 목록에 두 번 나온다 — 오류 문구가 있는 쪽을 남긴다.
    if (!byName.get(match[2])?.error) byName.set(match[2], { name: match[2], location: '', error: error.join('\n') });
  });
  return [...byName.values()];
}

/** Lines that usually carry the reason in npm, tsc and node output. */
function errorLines(lines) {
  return lines
    .filter((l) => !/^npm (error|ERR!)\s*$/.test(l)) // npm 이 줄 사이에 넣는 빈 "npm error" 줄은 뺀다
    .filter((l) => /\bnpm (error|ERR!)|error TS\d+|\bError\b|ERR_|not ok|✖|Cannot |failed/i.test(l))
    .slice(0, MAX_ERROR_LINES);
}

function annotate(title, message) {
  console.log(`::error title=${escapeProperty(title)}::${escapeData(message)}`);
}

// ---- main ----
const logs = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.log')).sort() : []; // readdir order is not sorted on Linux
const report = ['## Why this CI run failed', ''];

if (logs.length === 0) {
  // 로그가 하나도 없으면 프로젝트 단계 전에(checkout·Node 설치) 멈춘 것이다.
  annotate('CI failed before any project step', 'No step logs were written: check out or Node setup failed. See the step list of this run.');
  report.push('No step logs were written, so the job stopped in check out or Node setup. See the step list of this run.');
} else {
  const failedLog = logs[logs.length - 1];
  const step = failedLog.replace(/^\d+-/, '').replace(/\.log$/, '');
  const lines = readFileSync(join(dir, failedLog), 'utf8').split('\n');
  report.push(`Failed step: **${step}** (log \`${failedLog}\`, ${lines.length} lines).`, '');

  const environment = logs.find((f) => f.includes('environment'));
  if (environment && environment !== failedLog) {
    report.push('Environment:', '', '```', readFileSync(join(dir, environment), 'utf8').trim(), '```', '');
  }

  let tests = failingTestsFromTap(lines);
  if (tests.length === 0) tests = failingTestsFromSpec(lines);
  if (tests.length > 0) {
    report.push(`Failing tests (${tests.length}):`, '');
    for (const t of tests) {
      report.push(`- **${t.name}**${t.location ? ` at \`${t.location}\`` : ''}`);
      if (t.error) report.push('', '  ```', ...t.error.split('\n').slice(0, MAX_ERROR_LINES).map((l) => `  ${l}`), '  ```');
    }
    tests.slice(0, MAX_ANNOTATIONS).forEach((t) => {
      const where = t.location ? `\n(${t.location})` : '';
      annotate(`Test failed: ${t.name}`, `${t.error.split('\n').slice(0, MAX_ERROR_LINES).join('\n') || 'see the test log'}${where}`);
    });
  } else {
    const reasons = errorLines(lines);
    annotate(`Step failed: ${step}`, reasons.length > 0 ? reasons.join('\n') : lines.filter(Boolean).slice(-MAX_ERROR_LINES).join('\n'));
  }
  report.push('', `Last ${TAIL_LINES} lines of \`${failedLog}\`:`, '', '```', ...lines.slice(-TAIL_LINES), '```');
}

const markdown = report.join('\n') + '\n';
console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
