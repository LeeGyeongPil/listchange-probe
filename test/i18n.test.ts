import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGES, createTranslator, resolveLang } from '../src/i18n/index.js';
import { fixture, runCli } from './helpers.js';

test('AC-7: en and ko message tables have identical keys and no empty text', () => {
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES.ko).sort());
  for (const lang of ['en', 'ko'] as const) {
    for (const [key, text] of Object.entries(MESSAGES[lang])) assert.ok(text.length > 0, `${lang}.${key} is empty`);
  }
});

test('AC-7: placeholders match between languages', () => {
  const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
  for (const key of Object.keys(MESSAGES.en) as (keyof typeof MESSAGES.en)[]) {
    assert.deepEqual(placeholders(MESSAGES.ko[key]), placeholders(MESSAGES.en[key]), key);
  }
});

test('AC-7: resolveLang precedence is flag > LISTCHANGE_PROBE_LANG > LC_ALL > LC_MESSAGES > LANG; default English', () => {
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

test('AC-7: translator fills placeholders and keeps unknown ones visible', () => {
  const t = createTranslator('en');
  assert.equal(t('report.header', { ms: 2000 }), 'listchange-probe report (threshold 2000 ms)');
  assert.match(t('report.header'), /\{ms\}/);
});

test('AC-7: CLI help and report table switch language with --lang', () => {
  const enHelp = runCli(['--help', '--lang', 'en']);
  const koHelp = runCli(['--help', '--lang', 'ko']);
  assert.match(enHelp.stdout, /Usage:/);
  assert.match(koHelp.stdout, /사용법:/);

  const enTable = runCli(['report', fixture('fail.jsonl'), '--lang', 'en']);
  const koTable = runCli(['report', fixture('fail.jsonl'), '--lang', 'ko']);
  assert.match(enTable.stdout, /VERDICT/);
  assert.match(enTable.stdout, /no list request followed the notification/);
  assert.match(koTable.stdout, /판정/);
  assert.match(koTable.stdout, /알림 뒤에 목록 요청이 오지 않았습니다/);
  assert.match(koTable.stdout, /FAIL/);
  assert.match(koTable.stdout, /no_relist/, 'reason codes stay in English');
});

test('AC-7: CLI honours the environment order and --lang overrides it', () => {
  const marker = /사용법:/;
  assert.match(runCli(['--help'], { LISTCHANGE_PROBE_LANG: 'ko' }).stdout, marker);
  assert.match(runCli(['--help'], { LANG: 'ko_KR.UTF-8' }).stdout, marker);
  assert.match(runCli(['--help'], { LC_ALL: 'ko_KR.UTF-8', LANG: 'en_US.UTF-8' }).stdout, marker);
  assert.doesNotMatch(runCli(['--help'], { LC_ALL: 'en_US.UTF-8', LANG: 'ko_KR.UTF-8' }).stdout, marker);
  assert.doesNotMatch(runCli(['--help'], { LISTCHANGE_PROBE_LANG: 'en', LANG: 'ko_KR.UTF-8' }).stdout, marker);
  assert.doesNotMatch(runCli(['--help', '--lang', 'en'], { LISTCHANGE_PROBE_LANG: 'ko' }).stdout, marker);
  assert.match(runCli(['--help', '--lang', 'ko'], { LISTCHANGE_PROBE_LANG: 'en' }).stdout, marker);
  assert.doesNotMatch(runCli(['--help'], {}).stdout, marker);
});

test('AC-7: an invalid --lang is a usage error', () => {
  const result = runCli(['--help', '--lang', 'fr']);
  assert.equal(result.status, 64);
  assert.match(result.stderr, /en or ko/);
});

test('AC-7: JSON output is byte-identical in both languages', () => {
  const en = runCli(['report', fixture('new-session.jsonl'), '--format', 'json', '--lang', 'en']);
  const ko = runCli(['report', fixture('new-session.jsonl'), '--format', 'json', '--lang', 'ko']);
  assert.equal(en.stdout, ko.stdout);
  assert.equal(en.status, ko.status);
});

test('AC-7: demo output switches language and still shows the verdict codes', () => {
  const ko = runCli(['demo', '--lang', 'ko']);
  assert.equal(ko.status, 0);
  assert.match(ko.stdout, /연습용 목/);
  assert.match(ko.stdout, /PASS_SLOW/);
});
