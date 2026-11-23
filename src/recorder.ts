import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { LOG_VERSION, type LogEvent } from './types.js';

/** Body of an event: everything except the fields the recorder fills in. */
export type EventBody = Omit<LogEvent, 'v' | 'seq' | 'ts' | 't_ms' | 'session'>;

export interface Recorder {
  /** Log file path, or null for an in-memory recorder. */
  readonly path: string | null;
  /** Events kept in memory (only for in-memory recorders; file recorders stay empty). */
  readonly events: LogEvent[];
  /** Begins a new session (one per connection) and returns its id. */
  startSession(): string;
  write(body: EventBody): LogEvent;
}

/** Highest seq already in an existing log, so a second run appends monotonically. */
function nextSeqFor(path: string): number {
  if (!existsSync(path)) return 0;
  const lines = readFileSync(path, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line) continue;
    try {
      const seq = (JSON.parse(line) as { seq?: unknown }).seq;
      if (typeof seq === 'number') return seq + 1;
    } catch {
      // A damaged last line is reported by `report`; continue after the file's line count.
    }
    return lines.filter((l) => l.trim()).length;
  }
  return 0;
}

/**
 * Creates a recorder. With a path it appends one JSON line per event synchronously
 * (never touches stdout, which is the protocol channel). With null it keeps events in memory.
 */
export function createRecorder(path: string | null): Recorder {
  let seq = 0;
  let session = 'none';
  const events: LogEvent[] = [];
  if (path !== null) {
    mkdirSync(dirname(path), { recursive: true });
    seq = nextSeqFor(path);
  }
  return {
    path,
    events,
    startSession() {
      session = `s-${randomBytes(4).toString('hex')}`;
      return session;
    },
    write(body) {
      const event: LogEvent = {
        v: LOG_VERSION,
        seq: seq++,
        ts: new Date().toISOString(),
        t_ms: Math.round(performance.now() * 1000) / 1000,
        session,
        ...body,
      };
      if (path === null) events.push(event);
      else appendFileSync(path, JSON.stringify(event) + '\n');
      return event;
    },
  };
}

function paramsOf(msg: JSONRPCMessage): Record<string, unknown> {
  const p = (msg as { params?: unknown }).params;
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
}

function recordIncoming(rec: Recorder, msg: JSONRPCMessage): void {
  if (!('method' in msg)) return; // responses to server-initiated requests are not interesting
  const params = paramsOf(msg);
  const body: EventBody = {
    dir: 'in',
    kind: 'id' in msg ? 'request' : 'notification',
    method: msg.method,
  };
  if ('id' in msg) body.id = msg.id;
  if (typeof params.name === 'string') body.name = params.name;
  else if (typeof params.uri === 'string') body.name = params.uri;
  if (msg.method === 'initialize') {
    const info = params.clientInfo as { name?: unknown; version?: unknown } | undefined;
    if (info && typeof info.name === 'string') {
      body.client = { name: info.name };
      if (typeof info.version === 'string') body.client.version = info.version;
    }
  }
  rec.write(body);
}

function recordOutgoing(rec: Recorder, msg: JSONRPCMessage): void {
  if ('method' in msg) {
    const body: EventBody = { dir: 'out', kind: 'id' in msg ? 'request' : 'notification', method: msg.method };
    if ('id' in msg) body.id = msg.id;
    rec.write(body);
    return;
  }
  const body: EventBody = { dir: 'out', kind: 'response', id: msg.id };
  if ('error' in msg) body.error_code = msg.error.code;
  const result = (msg as { result?: { protocolVersion?: unknown; isError?: unknown; content?: unknown } }).result;
  if (result && typeof result.protocolVersion === 'string') body.protocol_version = result.protocolVersion;
  if (result?.isError === true) {
    // The SDK reports an unknown tool as an isError result whose text is "MCP error -32602: ...".
    body.is_error = true;
    const first = Array.isArray(result.content) ? (result.content[0] as { text?: unknown } | undefined) : undefined;
    const match = typeof first?.text === 'string' ? first.text.match(/^MCP error (-?\d+):/) : null;
    if (match) body.error_code = Number(match[1]);
  }
  rec.write(body);
}

/**
 * Wraps a server-side transport so every message in both directions is recorded.
 * Must be wrapped before `server.connect()`, which installs the message handler.
 */
export function wrapTransport(inner: Transport, rec: Recorder): Transport {
  let userOnMessage: Transport['onmessage'];
  let closed = false;
  const markClosed = (): void => {
    if (closed) return;
    closed = true;
    rec.write({ event: 'close' });
  };
  inner.onmessage = (msg, extra) => {
    recordIncoming(rec, msg);
    userOnMessage?.(msg, extra);
  };
  const innerOnClose = (): void => {
    markClosed();
  };
  let userOnClose: Transport['onclose'];
  inner.onclose = () => {
    innerOnClose();
    userOnClose?.();
  };
  const wrapped: Transport = {
    start: () => inner.start(),
    send: async (msg, options) => {
      recordOutgoing(rec, msg);
      await inner.send(msg, options);
    },
    close: async () => {
      await inner.close();
      markClosed();
    },
    get sessionId() {
      return inner.sessionId;
    },
    set onmessage(handler) {
      userOnMessage = handler;
    },
    get onmessage() {
      return userOnMessage;
    },
    set onclose(handler) {
      userOnClose = handler;
    },
    get onclose() {
      return userOnClose;
    },
    set onerror(handler) {
      inner.onerror = handler;
    },
    get onerror() {
      return inner.onerror;
    },
  };
  if (inner.setProtocolVersion) {
    wrapped.setProtocolVersion = (v) => inner.setProtocolVersion?.(v);
  }
  return wrapped;
}
