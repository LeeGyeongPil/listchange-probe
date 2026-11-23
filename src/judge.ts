import { SCENARIOS } from './scenarios.js';
import type { LogEvent, Scenario, Verdict } from './types.js';

export interface JudgeOptions {
  /** Re-list delays up to this value are PASS; longer ones are PASS_SLOW. */
  thresholdMs: number;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Judges every (session, scenario) pair in a log. Pure function.
 * Ordering uses `seq`, never timestamps: events in the same millisecond keep their true order.
 */
export function judge(events: LogEvent[], opts: JudgeOptions): Verdict[] {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const sessionOrder: string[] = [];
  const bySession = new Map<string, LogEvent[]>();
  for (const ev of ordered) {
    let list = bySession.get(ev.session);
    if (!list) {
      list = [];
      bySession.set(ev.session, list);
      sessionOrder.push(ev.session);
    }
    list.push(ev);
  }

  const verdicts: Verdict[] = [];
  sessionOrder.forEach((sessionId, index) => {
    const evs = bySession.get(sessionId) ?? [];
    const start = evs.find((e) => e.event === 'start');
    if (!start?.scenarios) return; // rule 1: only scenarios announced by the start event
    const laterSessions = sessionOrder.slice(index + 1).map((s) => bySession.get(s) ?? []);
    for (const scenario of start.scenarios) {
      verdicts.push(judgeScenario(sessionId, evs, scenario, laterSessions, opts));
    }
  });
  return verdicts;
}

function judgeScenario(
  session: string,
  evs: LogEvent[],
  scenario: Scenario,
  laterSessions: LogEvent[][],
  opts: JudgeOptions,
): Verdict {
  const spec = SCENARIOS[scenario];
  const isList = (e: LogEvent): boolean => e.dir === 'in' && e.method === spec.listMethod;
  const isUse = (e: LogEvent): boolean => e.dir === 'in' && e.method === spec.useMethod;

  const refreshedOnNewSession = laterSessions.some((later) => later.some(isList));
  const removed = new Set<string>();
  const added = new Set<string>();
  for (const e of evs) {
    if (e.event === 'mutation' && e.scenario === scenario) {
      e.removed?.forEach((n) => removed.add(n));
      e.added?.forEach((n) => added.add(n));
    }
  }
  // Responses by request id, to know whether a call succeeded.
  const responses = new Map<string | number, LogEvent>();
  for (const e of evs) if (e.dir === 'out' && e.kind === 'response' && e.id !== undefined) responses.set(e.id, e);

  const base = {
    session,
    scenario,
    notification_seq: null,
    relist_seq: null,
    relist_delay_ms: null,
    relist_after_last: null,
    notification_count: 0,
    stale_calls: [] as number[],
    new_item_used: false,
    refreshed_on_new_session: refreshedOnNewSession,
  };

  const notifications = evs.filter((e) => e.dir === 'out' && e.method === spec.notificationMethod);
  const first = notifications[0];
  if (!first) {
    return { ...base, verdict: 'UNKNOWN', reasons: ['no_notification'] };
  }
  const last = notifications[notifications.length - 1] as LogEvent;
  const afterFirst = evs.filter((e) => e.seq > first.seq);
  const relist = afterFirst.find(isList);

  const staleEnd = relist ? relist.seq : Number.POSITIVE_INFINITY;
  const stale = afterFirst.filter((e) => isUse(e) && e.seq < staleEnd && e.name !== undefined && removed.has(e.name)).map((e) => e.seq);
  const newItemUsed = afterFirst.some((e) => {
    if (!isUse(e) || e.name === undefined || !added.has(e.name)) return false;
    const res = e.id !== undefined ? responses.get(e.id) : undefined;
    return res !== undefined && res.error_code === undefined && res.is_error !== true;
  });

  const common = {
    ...base,
    notification_seq: first.seq,
    notification_count: notifications.length,
    stale_calls: stale,
    new_item_used: newItemUsed,
  };

  if (relist) {
    const delay = round3(relist.t_ms - first.t_ms);
    const reasons: string[] = [];
    const slow = delay > opts.thresholdMs;
    if (slow) reasons.push('slow_relist');
    if (stale.length > 0) reasons.push('stale_call_before_relist');
    return {
      ...common,
      verdict: slow ? 'PASS_SLOW' : 'PASS',
      reasons,
      relist_seq: relist.seq,
      relist_delay_ms: delay,
      relist_after_last: afterFirst.some((e) => isList(e) && e.seq > last.seq),
    };
  }

  const lastEvent = evs[evs.length - 1] as LogEvent;
  const observedMs = lastEvent.t_ms - first.t_ms;
  if (observedMs <= opts.thresholdMs && stale.length === 0) {
    return { ...common, verdict: 'UNKNOWN', reasons: ['session_ended_early'], relist_after_last: false };
  }
  const reasons = ['no_relist'];
  if (stale.length > 0) reasons.push('stale_call');
  return { ...common, verdict: 'FAIL', reasons, relist_after_last: false };
}
