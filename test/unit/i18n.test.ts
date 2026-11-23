import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGES, createTranslator, resolveLang } from '../../src/i18n/index.js';
import { fixture, runMain } from '../helpers.js';

test('AC-4: en and ko message tables have identical keys and no empty text', () => {
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES.ko).sort());
  for (const lang of ['en', 'ko'] as const) {
    for (const [key, text] of Object.entries(MESSAGES[lang])) assert.ok(text.length > 0, `${lang}.${key} is empty`);
  }
});

test('AC-4: placeholders match between languages', () => {
  const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
  for (const key of Object.keys(MESSAGES.en) as (keyof typeof MESSAGES.en)[]) {
    assert.deepEqual(placeholders(MESSAGES.ko[key]), placeholders(MESSAGES.en[key]), key);
  }
});

test('AC-4: resolveLang precedence is flag > LISTCHANGE_PROBE_LANG > LC_ALL > LC_MESSAGES > LANG; default English', () => {
  assert.equal(resolveLang('ko', { LISTCHANGE_PROBE_LANG: 'en' }), 'ko');
  assert.equal(resolveLang(undefined, { LISTCHANGE_PROBE_LANG: 'ko', LC_ALL: 'en_US.UTF-8' }), 'ko');
  assert.equal(resolveLang(undefined, { LISTCHANGE_PROBE_LANG: 'en', LC_ALL: 'ko_KR.UTF-8' }), 'en');
  assert.equal(resolveLang(undefined, { LC_ALL: 'ko_KR.UTF-8', LC_MESSAGES: 'en_US', LANG: 'en_US' }), 'ko');
  assert.equal(resolveLang(undefined, { LC_ALL: 'C', LANG: 'ko_KR.UTF-8' }), 'en', 'LC_ALL wins even when it is not Korean');
  assert.equal(resolveLang(undefined, { LC_MESSAGES: 'ko_KR', LANG: 'en_US' }), 'ko');
  assert.equal(resolveLang(undefined, { LANG: 'ko_KR.UTF-8' }), 'ko');
  assert.equal(resolveLang(undefined, { LANG: 'fr_FR.UTF-8' }), 'en');
  assert.equal(resolveLang(undefined, {}), 'en');
  assert.throws(() => resolveLang('fr', {}), /Use en or ko/);
});

test('AC-4: translator fills placeholders and keeps unknown ones visible', () => {
  const t = createTranslator('en');
  assert.equal(t('report.header', { ms: 2000 }), 'listchange-probe report (threshold 2000 ms)');
  assert.match(t('report.header'), /\{ms\}/);
});

test('AC-4: CLI help and report table switch language with --lang', async () => {
  const enHelp = await runMain(['--help', '--lang', 'en']);
  const koHelp = await runMain(['--help', '--lang', 'ko']);
  assert.match(enHelp.stdout, /Usage:/);
  assert.match(koHelp.stdout, /사용법:/);

  const enTable = await runMain(['report', fixture('fail.jsonl'), '--lang', 'en']);
  const koTable = await runMain(['report', fixture('fail.jsonl'), '--lang', 'ko']);
  assert.match(enTable.stdout, /VERDICT/);
  assert.match(enTable.stdout, /no list request followed the notification/);
  assert.match(koTable.stdout, /판정/);
  assert.match(koTable.stdout, /알림 뒤에 목록 요청이 오지 않았습니다/);
  assert.match(koTable.stdout, /FAIL/);
  assert.match(koTable.stdout, /no_relist/, 'reason codes stay in English');
});

test('AC-4: CLI honours the environment order and --lang overrides it', async () => {
  // main(argv, env) 에 환경을 직접 넘긴다 — 이 프로세스의 실제 로캘과 무관하다.
  const marker = /사용법:/;
  const help = async (args: string[], env: Record<string, string>): Promise<string> => (await runMain(args, env)).stdout;
  assert.match(await help(['--help'], { LISTCHANGE_PROBE_LANG: 'ko' }), marker);
  assert.match(await help(['--help'], { LANG: 'ko_KR.UTF-8' }), marker);
  assert.match(await help(['--help'], { LC_MESSAGES: 'ko_KR.UTF-8', LANG: 'en_US.UTF-8' }), marker);
  assert.match(await help(['--help'], { LC_ALL: 'ko_KR.UTF-8', LANG: 'en_US.UTF-8' }), marker);
  assert.doesNotMatch(await help(['--help'], { LC_ALL: 'en_US.UTF-8', LANG: 'ko_KR.UTF-8' }), marker);
  assert.doesNotMatch(await help(['--help'], { LISTCHANGE_PROBE_LANG: 'en', LANG: 'ko_KR.UTF-8' }), marker);
  assert.doesNotMatch(await help(['--help', '--lang', 'en'], { LISTCHANGE_PROBE_LANG: 'ko' }), marker);
  assert.match(await help(['--help', '--lang', 'ko'], { LISTCHANGE_PROBE_LANG: 'en' }), marker);
  assert.doesNotMatch(await help(['--help'], {}), marker);
});

test('AC-4: an invalid --lang is a usage error', async () => {
  const result = await runMain(['--help', '--lang', 'fr']);
  assert.equal(result.status, 64);
  assert.match(result.stderr, /en or ko/);
});

test('AC-4: JSON output is byte-identical in both languages', async () => {
  const en = await runMain(['report', fixture('new-session.jsonl'), '--format', 'json', '--lang', 'en']);
  const ko = await runMain(['report', fixture('new-session.jsonl'), '--format', 'json', '--lang', 'ko']);
  assert.equal(en.stdout, ko.stdout);
  assert.equal(en.status, ko.status);
});

test('AC-4: the demo banner says it is a simulated practice mock in both languages', () => {
  // demo 실행 자체는 실제 타이머를 쓰므로 통합 테스트(cli-process)가 확인한다. 여기서는 배너 문구만 본다.
  assert.match(createTranslator('en')('demo.banner'), /simulated/);
  assert.match(createTranslator('ko')('demo.banner'), /연습용 목/);
  assert.match(createTranslator('ko')('demo.banner'), /모의/);
});
