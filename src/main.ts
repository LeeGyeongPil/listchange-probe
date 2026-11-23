import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRecorder } from './recorder.js';
import { createProbeServer } from './server.js';
import { parseScenarios } from './scenarios.js';
import { buildRows, exitCodeFor, LogParseError, LogReadError, readLog, type ReportRow } from './report.js';
import { renderJson, renderTable } from './format.js';
import { runDemo } from './demo.js';
import { createTranslator, resolveLang, type Lang, type Translator } from './i18n/index.js';

const USAGE_ERROR = 64;
const INPUT_ERROR = 3;

const require = createRequire(import.meta.url);
const VERSION: string = (require('../../package.json') as { version: string }).version;

/** Where human-readable text goes. The real CLI writes to the process; tests collect it in memory. */
export interface CliIO {
  stdout(text: string): void;
  stderr(text: string): void;
}

/** The real process streams (serve's protocol channel is written by StdioServerTransport, not through this). */
export const processIO: CliIO = {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
};

/** Error that carries a ready, localized message. */
class UsageError extends Error {}

function envLang(env: NodeJS.ProcessEnv): Lang {
  try {
    return resolveLang(undefined, env);
  } catch {
    return 'en';
  }
}

function parseNumber(value: string | undefined, option: string, fallback: number, t: Translator): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (value.trim() === '' || !Number.isFinite(n) || n < 0) throw new UsageError(t('err.bad_number', { value, option }));
  return n;
}

/**
 * Runs the CLI and returns its exit code. It never calls process.exit, so tests can call it in-process
 * with their own environment and output collector.
 */
export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env, io: CliIO = processIO): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      // Join "--after -1" into "--after=-1" so parseArgs does not reject negative numbers itself.
      args: argv.map((a, i) => (i > 0 && /^-\d/.test(a) && (argv[i - 1] === '--after' || argv[i - 1] === '--threshold-ms') ? `=${a}` : a)).reduce<string[]>((acc, a) => {
        if (a.startsWith('=-')) acc[acc.length - 1] += a;
        else acc.push(a);
        return acc;
      }, []),
      allowPositionals: true,
      options: {
        log: { type: 'string' },
        scenario: { type: 'string' },
        after: { type: 'string' },
        format: { type: 'string' },
        'threshold-ms': { type: 'string' },
        lang: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (err) {
    const t = createTranslator(envLang(env));
    io.stderr(t('err.bad_option', { message: err instanceof Error ? err.message : String(err) }) + '\n');
    return USAGE_ERROR;
  }

  let lang: Lang;
  try {
    lang = resolveLang(values.lang as string | undefined, env);
  } catch {
    const t = createTranslator(envLang(env));
    io.stderr(t('err.bad_lang', { value: String(values.lang) }) + '\n');
    return USAGE_ERROR;
  }
  const t = createTranslator(lang);

  try {
    if (values.version) {
      io.stdout(VERSION + '\n');
      return 0;
    }
    const command = positionals[0];
    if (values.help || command === undefined || command === 'help') {
      io.stdout(t('help.text'));
      return values.help || command === 'help' ? 0 : USAGE_ERROR;
    }
    switch (command) {
      case 'serve':
        return await runServe(values, t, io);
      case 'report':
        return runReport(positionals.slice(1), values, t, io);
      case 'demo': {
        const result = await runDemo(t);
        io.stdout(result.text);
        return result.exitCode;
      }
      default:
        throw new UsageError(t('err.unknown_command', { name: command }));
    }
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr(err.message + '\n');
      return USAGE_ERROR;
    }
    throw err;
  }
}

async function runServe(values: Record<string, string | boolean | undefined>, t: Translator, io: CliIO): Promise<number> {
  const log = values.log;
  if (typeof log !== 'string' || log === '') throw new UsageError(t('err.missing_log'));
  let scenarios;
  try {
    scenarios = parseScenarios(typeof values.scenario === 'string' ? values.scenario : 'tools');
  } catch {
    throw new UsageError(t('err.bad_scenario', { value: String(values.scenario) }));
  }
  const afterSeconds = typeof values.after === 'string' ? parseNumber(values.after, '--after', 0, t) : undefined;

  let recorder;
  try {
    recorder = createRecorder(log);
  } catch (err) {
    const reason = (err as NodeJS.ErrnoException).code ?? (err instanceof Error ? err.message : String(err));
    io.stderr(t('err.log_unwritable', { file: log, reason }) + '\n');
    return INPUT_ERROR;
  }
  const probe = createProbeServer({
    scenarios,
    recorder,
    version: VERSION,
    ...(afterSeconds !== undefined ? { afterMs: afterSeconds * 1000 } : {}),
  });
  const transport = new StdioServerTransport();
  const closed = new Promise<void>((resolve) => {
    const onClose = (): void => resolve();
    process.stdin.once('end', onClose);
    process.stdin.once('close', onClose);
  });
  await probe.connect(transport, 'stdio');
  // stdout is the protocol channel, so all human messages go to stderr.
  io.stderr(t('serve.started', { log, scenarios: scenarios.join(', ') }) + '\n');
  io.stderr(
    (afterSeconds !== undefined ? t('serve.hint_after', { seconds: afterSeconds }) : t('serve.hint_call', { log })) + '\n',
  );
  await closed;
  await probe.server.close().catch(() => undefined);
  return 0;
}

function runReport(files: string[], values: Record<string, string | boolean | undefined>, t: Translator, io: CliIO): number {
  if (files.length === 0) throw new UsageError(t('err.missing_report_input'));
  const format = typeof values.format === 'string' ? values.format : 'table';
  if (format !== 'table' && format !== 'json') throw new UsageError(t('err.bad_format', { value: format }));
  const thresholdMs = parseNumber(values['threshold-ms'] as string | undefined, '--threshold-ms', 2000, t);

  const rows: ReportRow[] = [];
  for (const file of files) {
    try {
      rows.push(...buildRows(file, readLog(file), thresholdMs));
    } catch (err) {
      if (err instanceof LogReadError) {
        io.stderr(t('err.log_missing', { file, reason: err.reason }) + '\n');
        return INPUT_ERROR;
      }
      if (err instanceof LogParseError) {
        const reason = t(err.reasonKey, { field: err.field ?? '' });
        io.stderr(t('err.log_parse', { file, line: err.line, reason }) + '\n');
        return INPUT_ERROR;
      }
      throw err;
    }
  }
  io.stdout(format === 'json' ? renderJson(rows) : renderTable(rows, t, thresholdMs));
  return exitCodeFor(rows);
}
