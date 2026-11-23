import type { Translator, MessageKey } from './i18n/index.js';
import type { ReportRow } from './report.js';

/** Terminal width: Hangul syllables and CJK characters take two columns. */
function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    width += (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xff00 && code <= 0xff60) ? 2 : 1;
  }
  return width;
}

function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}

function detailsOf(row: ReportRow): string[] {
  const parts: string[] = [];
  for (const reason of row.reasons) {
    parts.push(reason === 'stale_call' || reason === 'stale_call_before_relist' ? `${reason}(seq ${row.stale_calls.join(',')})` : reason);
  }
  if (row.new_item_used) parts.push('new_item_used=yes');
  if (row.refreshed_on_new_session) parts.push('refreshed_on_new_session=yes');
  return parts;
}

/** Renders the human-readable table plus a short explanation of each code that appears. */
export function renderTable(rows: ReportRow[], t: Translator, thresholdMs: number, banner?: string): string {
  const out: string[] = [];
  if (banner) out.push(banner);
  out.push(t('report.header', { ms: thresholdMs }));
  if (rows.length === 0) {
    out.push(t('summary.empty'));
    return out.join('\n') + '\n';
  }
  const header = [t('col.source'), t('col.session'), t('col.scenario'), t('col.verdict'), t('col.delay'), t('col.details')];
  const body = rows.map((r) => [
    r.source,
    r.session,
    r.scenario,
    r.verdict,
    r.relist_delay_ms === null ? '-' : `${Math.round(r.relist_delay_ms)} ms`,
    detailsOf(r).join('; ') || '-',
  ]);
  const widths = header.map((h, i) => Math.max(displayWidth(h), ...body.map((b) => displayWidth(b[i] as string))));
  const line = (cells: string[]): string => cells.map((c, i) => (i === cells.length - 1 ? c : pad(c, widths[i] as number))).join('  ');
  out.push('');
  out.push(line(header));
  for (const b of body) out.push(line(b));

  // Explanations: verdict meanings, then reason codes, in the chosen language.
  out.push('');
  const verdicts = [...new Set(rows.map((r) => r.verdict))];
  for (const v of verdicts) out.push(`${v}: ${t(`verdict.${v}` as MessageKey)}`);
  const reasons = new Set<string>();
  for (const r of rows) r.reasons.forEach((x) => reasons.add(x));
  for (const code of reasons) {
    const row = rows.find((r) => r.reasons.includes(code)) as ReportRow;
    out.push(`${code}: ${t(`reason.${code}` as MessageKey, { seqs: row.stale_calls.join(', ') })}`);
  }
  if (rows.some((r) => r.new_item_used)) out.push(t('detail.new_item_used'));
  if (rows.some((r) => r.refreshed_on_new_session)) out.push(t('detail.refreshed_on_new_session'));
  const count = (code: string): number => rows.filter((r) => r.verdict === code).length;
  out.push('');
  out.push(
    t('summary', {
      total: rows.length,
      pass: count('PASS'),
      slow: count('PASS_SLOW'),
      fail: count('FAIL'),
      unknown: count('UNKNOWN'),
    }),
  );
  return out.join('\n') + '\n';
}

/** Language-independent JSON output. */
export function renderJson(rows: ReportRow[]): string {
  return JSON.stringify(rows, null, 2) + '\n';
}
