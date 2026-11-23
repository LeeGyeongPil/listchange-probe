/** English message table. Keep the key set identical to ko.ts (a test checks this). */
export const en = {
  'help.text': `listchange-probe - check whether an MCP client re-fetches lists after list_changed

Usage:
  listchange-probe serve --log <file> [--scenario tools|prompts|resources|all] [--after <seconds>] [--lang en|ko]
      Run the probe MCP server on stdio and record all traffic to <file> (JSONL).
      Attach it to the client you want to check, then ask the agent to call probe_add.
  listchange-probe report <file...> [--format table|json] [--threshold-ms <ms>] [--lang en|ko]
      Judge the recorded traffic. Exit code: 0 all PASS, 1 any FAIL, 2 no FAIL but at least one UNKNOWN, 3 bad input.
  listchange-probe demo [--lang en|ko]
      Offline practice run with three simulated clients (refresh, ignore, delayed).

Options:
  --lang en|ko    Output language (default: LISTCHANGE_PROBE_LANG, then LC_ALL/LC_MESSAGES/LANG)
  --help, -h      Show this help
  --version, -v   Show the version
`,
  'col.source': 'SOURCE',
  'col.session': 'SESSION',
  'col.scenario': 'SCENARIO',
  'col.verdict': 'VERDICT',
  'col.delay': 'RE-LIST',
  'col.details': 'DETAILS',
  'verdict.PASS': 'the client re-listed in time',
  'verdict.PASS_SLOW': 'the client re-listed, but later than the threshold',
  'verdict.FAIL': 'the client did not re-list after the notification',
  'verdict.UNKNOWN': 'not enough evidence to decide',
  'reason.no_notification': 'no list_changed notification was sent (the trigger did not happen or the session ended first)',
  'reason.session_ended_early': 'the session ended before the threshold passed, so a late re-list cannot be ruled out',
  'reason.no_relist': 'no list request followed the notification',
  'reason.slow_relist': 'the re-list came later than the threshold',
  'reason.stale_call': 'the client called an item that was already removed (seq {seqs})',
  'reason.stale_call_before_relist': 'a removed item was called before the re-list (seq {seqs})',
  'detail.refreshed_on_new_session': 'refreshed_on_new_session=yes (a later session did list again: the client seems to refresh only on restart)',
  'detail.new_item_used': 'new_item_used=yes (calling the new item works even without a re-list, so it is not evidence)',
  'summary': '{total} result(s): {pass} PASS, {slow} PASS_SLOW, {fail} FAIL, {unknown} UNKNOWN',
  'summary.empty': 'No probe sessions found in the log (nothing to judge).',
  'report.header': 'listchange-probe report (threshold {ms} ms)',
  'demo.banner': 'simulated reference clients (practice mock) - not a real IDE or agent',
  'demo.client.refresh': 'refreshes (SDK auto refresh)',
  'demo.client.ignore': 'ignores the notification',
  'demo.client.delayed': 'refreshes late (1500 ms)',
  'demo.lesson':
    'Lesson: the ignoring client could still call probe_new successfully, yet it is judged FAIL. Judging uses the re-list, not whether the new item works.',
  'serve.started': 'listchange-probe is serving on stdio. Logging to {log}. Scenarios: {scenarios}.',
  'serve.hint_call': 'Ask the agent to call the probe_add tool, then run: listchange-probe report {log}',
  'serve.hint_after': 'The change happens automatically {seconds} s after the client connects.',
  'err.unknown_command': 'Unknown command "{name}". Run listchange-probe --help.',
  'err.bad_lang': 'Invalid --lang value "{value}". Use en or ko.',
  'err.bad_option': '{message}. Run listchange-probe --help.',
  'err.missing_log': 'serve needs --log <file>, for example: listchange-probe serve --log probe.jsonl',
  'err.missing_report_input': 'report needs at least one log file, for example: listchange-probe report probe.jsonl',
  'err.bad_format': 'Invalid --format "{value}". Use table or json.',
  'err.bad_number': 'Invalid value "{value}" for {option}. Use a non-negative number.',
  'err.log_unwritable': 'Cannot write log file {file}: {reason}. Choose a writable path.',
  'err.bad_scenario': 'Invalid --scenario "{value}". Use tools, prompts, resources or all.',
  'err.log_missing': 'Cannot read log file {file}: {reason}. Check the path, or run serve first to create it.',
  'err.log_parse': '{file}: line {line}: {reason}. The log may be cut off or not written by listchange-probe.',
  'parse.not_json': 'not valid JSON',
  'parse.not_object': 'not a JSON object',
  'parse.bad_version': 'unsupported log version (expected v=1)',
  'parse.bad_field': 'missing or invalid field "{field}"',
} as const;
