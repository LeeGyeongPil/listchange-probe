import { readFileSync } from 'node:fs';
import { judge } from './judge.js';
import { LOG_VERSION, type LogEvent, type Verdict } from './types.js';

/** Thrown for an unreadable line in a log; `line` is 1-based. `reasonKey` maps to a parse.* message. */
export class LogParseError extends Error {
  constructor(
    public readonly line: number,
    public readonly reasonKey: 'parse.not_json' | 'parse.not_object' | 'parse.bad_version' | 'parse.bad_field',
    public readonly field?: string,
  ) {
    super(`Log line ${line}: ${reasonKey}${field ? ` (${field})` : ''}`);
    this.name = 'LogParseError';
  }
}

/** Thrown when the log file cannot be read at all. */
export class LogReadError extends Error {
  constructor(
    public readonly file: string,
    public readonly reason: string,
  ) {
    super(`Cannot read ${file}: ${reason}`);
    this.name = 'LogReadError';
  }
}

export function parseLog(text: string): LogEvent[] {
  const events: LogEvent[] = [];
  const lines = text.split('\n');
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const lineNo = i + 1;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new LogParseError(lineNo, 'parse.not_json');
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new LogParseError(lineNo, 'parse.not_object');
    const obj = value as Record<string, unknown>;
    if (obj.v !== LOG_VERSION) throw new LogParseError(lineNo, 'parse.bad_version');
    for (const field of ['seq', 't_ms'] as const) {
      if (typeof obj[field] !== 'number') throw new LogParseError(lineNo, 'parse.bad_field', field);
    }
    if (typeof obj.session !== 'string') throw new LogParseError(lineNo, 'parse.bad_field', 'session');
    events.push(obj as unknown as LogEvent);
  });
  return events;
}

export function readLog(file: string): LogEvent[] {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    throw new LogReadError(file, err instanceof Error ? err.message : String(err));
  }
  return parseLog(text);
}

/** A verdict plus where it came from (a file name, or a mock client label). */
export interface ReportRow extends Verdict {
  source: string;
}

export function buildRows(source: string, events: LogEvent[], thresholdMs: number): ReportRow[] {
  return judge(events, { thresholdMs }).map((v) => ({ source, ...v }));
}

/** 0 = all PASS/PASS_SLOW, 1 = any FAIL, 2 = no FAIL but some UNKNOWN (or nothing to judge). */
export function exitCodeFor(rows: Verdict[]): 0 | 1 | 2 {
  if (rows.some((r) => r.verdict === 'FAIL')) return 1;
  if (rows.length === 0 || rows.some((r) => r.verdict === 'UNKNOWN')) return 2;
  return 0;
}
