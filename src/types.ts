/** Shared types for the JSONL v1 log and the verdicts. */

export type Scenario = 'tools' | 'prompts' | 'resources';
export type VerdictCode = 'PASS' | 'PASS_SLOW' | 'FAIL' | 'UNKNOWN';

/** One line of the JSONL v1 log. Fields that do not apply to an event are absent. */
export interface LogEvent {
  v: 1;
  seq: number;
  ts: string;
  t_ms: number;
  session: string;
  /** Present on lifecycle events: start, mutation, close. */
  event?: 'start' | 'mutation' | 'close';
  /** Present on protocol traffic. */
  dir?: 'in' | 'out';
  kind?: 'request' | 'notification' | 'response';
  method?: string;
  id?: string | number;
  /** params.name, or params.uri for resources/read. */
  name?: string;
  client?: { name: string; version?: string };
  protocol_version?: string;
  error_code?: number;
  /** True when a tools/call result carried isError. */
  is_error?: boolean;
  // start event
  tool?: string;
  version?: string;
  transport?: string;
  scenarios?: Scenario[];
  threshold_hint_ms?: number;
  // mutation event
  scenario?: Scenario;
  added?: string[];
  removed?: string[];
}

export interface Verdict {
  session: string;
  scenario: Scenario;
  verdict: VerdictCode;
  /** Machine-readable reason codes, e.g. no_relist, stale_call. */
  reasons: string[];
  notification_seq: number | null;
  relist_seq: number | null;
  relist_delay_ms: number | null;
  /** True when a re-list also followed the last notification of the burst. */
  relist_after_last: boolean | null;
  notification_count: number;
  /** seq numbers of calls to items that had already been removed. */
  stale_calls: number[];
  /** True when the added item was used successfully (supporting evidence only). */
  new_item_used: boolean;
  /** True when a later session of the same log listed the items again. */
  refreshed_on_new_session: boolean;
}

export const LOG_VERSION = 1;
