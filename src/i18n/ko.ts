import type { en } from './en.js';

/** 한국어 메시지 표. 키는 en.ts 와 같아야 한다(테스트가 검사). */
export const ko: Record<keyof typeof en, string> = {
  'help.text': `listchange-probe - MCP 클라이언트가 list_changed 알림 뒤에 목록을 다시 받아 가는지 확인합니다

사용법:
  listchange-probe serve --log <파일> [--scenario tools|prompts|resources|all] [--after <초>] [--lang en|ko]
      stdio 로 프로브 MCP 서버를 띄우고 모든 통신을 <파일>(JSONL)에 기록합니다.
      확인할 클라이언트에 붙인 뒤 에이전트에게 probe_add 를 호출해 달라고 하세요.
  listchange-probe report <파일...> [--format table|json] [--threshold-ms <ms>] [--lang en|ko]
      기록을 판정합니다. 종료 코드: 0 모두 PASS 또는 PASS_SLOW, 1 FAIL 있음,
      2 FAIL 은 없고 UNKNOWN 이 하나 이상, 3 입력 오류, 64 사용법 오류.
  listchange-probe demo [--lang en|ko]
      모의 클라이언트 3개(갱신·무시·늦은 갱신)로 오프라인 연습 실행.

옵션:
  --lang en|ko    출력 언어 (기본: LISTCHANGE_PROBE_LANG, 다음 LC_ALL/LC_MESSAGES/LANG)
  --help, -h      도움말
  --version, -v   버전
`,
  'col.source': '출처',
  'col.session': '세션',
  'col.scenario': '시나리오',
  'col.verdict': '판정',
  'col.delay': '재요청',
  'col.details': '상세',
  'verdict.PASS': '클라이언트가 제때 목록을 다시 받았습니다',
  'verdict.PASS_SLOW': '다시 받긴 했지만 임계값보다 늦었습니다',
  'verdict.FAIL': '알림 뒤에 목록을 다시 받지 않았습니다',
  'verdict.UNKNOWN': '판정할 근거가 부족합니다',
  'reason.no_notification': 'list_changed 알림이 나가지 않았습니다(트리거가 없었거나 세션이 먼저 끝남)',
  'reason.session_ended_early': '임계값이 지나기 전에 세션이 끝나 늦은 재요청을 배제할 수 없습니다',
  'reason.no_relist': '알림 뒤에 목록 요청이 오지 않았습니다',
  'reason.slow_relist': '재요청이 임계값보다 늦게 왔습니다',
  'reason.stale_call': '이미 지운 항목을 클라이언트가 호출했습니다 (seq {seqs})',
  'reason.stale_call_before_relist': '재요청 전에 지운 항목을 호출했습니다 (seq {seqs})',
  'detail.refreshed_on_new_session': 'refreshed_on_new_session=yes (뒤 세션에서는 목록을 다시 받음: 재시작해야만 갱신되는 클라이언트로 보입니다)',
  'detail.new_item_used': 'new_item_used=yes (재요청 없이도 새 항목 호출은 됩니다. 갱신의 증거가 아닙니다)',
  'summary': '{total}건: PASS {pass}, PASS_SLOW {slow}, FAIL {fail}, UNKNOWN {unknown}',
  'summary.empty': '기록에서 프로브 세션을 찾지 못했습니다(판정할 것이 없음).',
  'report.header': 'listchange-probe 보고서 (임계값 {ms} ms)',
  'demo.banner': '모의 참조 클라이언트(연습용 목) - 실제 IDE·에이전트가 아닙니다',
  'demo.client.refresh': '갱신함 (SDK 자동 갱신)',
  'demo.client.ignore': '알림을 무시함',
  'demo.client.delayed': '늦게 갱신함 (1500 ms)',
  'demo.lesson':
    '교훈: 알림을 무시한 클라이언트도 probe_new 호출은 성공했지만 판정은 FAIL 입니다. 판정 기준은 새 항목이 동작하는지가 아니라 목록 재요청입니다.',
  'serve.started': 'listchange-probe 가 stdio 로 실행 중입니다. 기록 파일: {log}. 시나리오: {scenarios}.',
  'serve.hint_call': '에이전트에게 probe_add 도구를 호출해 달라고 한 뒤 실행하세요: listchange-probe report {log}',
  'serve.hint_after': '클라이언트가 연결되고 {seconds}초 뒤에 자동으로 목록이 바뀝니다.',
  'err.unknown_command': '알 수 없는 명령 "{name}". listchange-probe --help 를 실행해 보세요.',
  'err.bad_lang': '--lang 값 "{value}" 이(가) 올바르지 않습니다. en 또는 ko 를 쓰세요.',
  'err.bad_option': '{message}. listchange-probe --help 를 실행해 보세요.',
  'err.missing_log': 'serve 에는 --log <파일> 이 필요합니다. 예: listchange-probe serve --log probe.jsonl',
  'err.missing_report_input': 'report 에는 로그 파일이 하나 이상 필요합니다. 예: listchange-probe report probe.jsonl',
  'err.bad_format': '--format "{value}" 이(가) 올바르지 않습니다. table 또는 json 을 쓰세요.',
  'err.bad_number': '{option} 값 "{value}" 이(가) 올바르지 않습니다. 0 이상의 숫자를 쓰세요.',
  'err.log_unwritable': '로그 파일 {file} 에 쓸 수 없습니다: {reason}. 쓰기 가능한 경로를 지정하세요.',
  'err.bad_scenario': '--scenario "{value}" 이(가) 올바르지 않습니다. tools, prompts, resources, all 중 하나를 쓰세요.',
  'err.log_missing': '로그 파일 {file} 을(를) 읽을 수 없습니다: {reason}. 경로를 확인하거나 serve 를 먼저 실행해 파일을 만드세요.',
  'err.log_parse': '{file}: {line}번째 줄: {reason}. 기록이 잘렸거나 listchange-probe 가 쓴 파일이 아닐 수 있습니다.',
  'parse.not_json': '올바른 JSON 이 아닙니다',
  'parse.not_object': 'JSON 객체가 아닙니다',
  'parse.bad_version': '지원하지 않는 로그 버전입니다 (v=1 이어야 함)',
  'parse.bad_field': '"{field}" 필드가 없거나 올바르지 않습니다',
};
