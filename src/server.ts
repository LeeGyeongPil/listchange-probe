import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import { SCENARIOS, TRIGGER_TOOL } from './scenarios.js';
import { wrapTransport, type Recorder } from './recorder.js';
import type { Scenario } from './types.js';

export interface ProbeServerOptions {
  scenarios: Scenario[];
  recorder: Recorder;
  /** Trigger the change this many milliseconds after connect (instead of waiting for probe_add). */
  afterMs?: number;
  /** Threshold written into the start event as a hint for the report. */
  thresholdHintMs?: number;
  /** Package version for the start event. */
  version?: string;
}

export interface ProbeServer {
  server: McpServer;
  /** Applies the list change once (later calls do nothing). Returns true if it applied. */
  trigger(): boolean;
  /** Starts a recorded session on the transport and connects the server. */
  connect(transport: Transport, transportName?: string): Promise<void>;
}

type Removable = { remove(): void };

/**
 * Creates the probe server: it starts with an "old" item per scenario, and on trigger
 * adds a "new" item and removes the old one, which makes the SDK send list_changed.
 */
export function createProbeServer(opts: ProbeServerOptions): ProbeServer {
  const { recorder } = opts;
  const scenarios = [...new Set(opts.scenarios)];
  if (scenarios.length === 0) throw new Error('At least one scenario is required.');

  // The SDK declares {listChanged: true} for each kind that has a registered item.
  const server = new McpServer(
    { name: 'listchange-probe', version: opts.version ?? '0.0.0' },
    { capabilities: { tools: { listChanged: true } } },
  );
  const oldHandles = new Map<Scenario, Removable>();
  let triggered = false;
  let timer: NodeJS.Timeout | undefined;

  const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

  // Always present: the tool an agent calls to start the change.
  server.registerTool(
    TRIGGER_TOOL,
    {
      description:
        'Call this once. It adds the new probe items and removes the old ones, then sends list_changed. ' +
        'Afterwards, call probe_new (or the prompt/resource named probe_prompt_new / probe://new) and then probe_old.',
      inputSchema: {},
    },
    async () => {
      const applied = trigger();
      return text(applied ? 'Probe items changed. list_changed was sent.' : 'Already changed earlier in this session.');
    },
  );

  if (scenarios.includes('tools')) {
    oldHandles.set('tools', server.registerTool(SCENARIOS.tools.oldItem, { description: 'Removed by the probe.', inputSchema: {} }, async () => text('old')));
  }
  if (scenarios.includes('prompts')) {
    oldHandles.set(
      'prompts',
      server.registerPrompt(SCENARIOS.prompts.oldItem, { description: 'Removed by the probe.' }, async () => ({
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'old' } }],
      })),
    );
  }
  if (scenarios.includes('resources')) {
    oldHandles.set(
      'resources',
      server.registerResource('probe-old', SCENARIOS.resources.oldItem, { description: 'Removed by the probe.' }, async (uri) => ({
        contents: [{ uri: uri.href, text: 'old' }],
      })),
    );
  }

  function applyScenario(scenario: Scenario): void {
    const spec = SCENARIOS[scenario];
    // Record the intended change first so the log explains the notifications that follow.
    recorder.write({ event: 'mutation', scenario, added: [spec.newItem], removed: [spec.oldItem] });
    if (scenario === 'tools') {
      server.registerTool(spec.newItem, { description: 'Added by the probe.', inputSchema: { note: z.string().optional() } }, async () => text('new'));
    } else if (scenario === 'prompts') {
      server.registerPrompt(spec.newItem, { description: 'Added by the probe.' }, async () => ({
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'new' } }],
      }));
    } else {
      server.registerResource('probe-new', spec.newItem, { description: 'Added by the probe.' }, async (uri) => ({
        contents: [{ uri: uri.href, text: 'new' }],
      }));
    }
    oldHandles.get(scenario)?.remove();
  }

  function trigger(): boolean {
    if (triggered) return false;
    triggered = true;
    if (timer) clearTimeout(timer);
    for (const scenario of scenarios) applyScenario(scenario);
    return true;
  }

  async function connect(transport: Transport, transportName = 'stdio'): Promise<void> {
    recorder.startSession();
    recorder.write({
      event: 'start',
      tool: 'listchange-probe',
      version: opts.version ?? '0.0.0',
      transport: transportName,
      scenarios,
      ...(opts.thresholdHintMs !== undefined ? { threshold_hint_ms: opts.thresholdHintMs } : {}),
    });
    const wrapped = wrapTransport(transport, recorder);
    const previousOnClose = wrapped.onclose;
    wrapped.onclose = () => {
      if (timer) clearTimeout(timer);
      previousOnClose?.();
    };
    await server.connect(wrapped);
    if (opts.afterMs !== undefined) {
      timer = setTimeout(() => {
        trigger();
      }, opts.afterMs);
    }
  }

  return { server, trigger, connect };
}
