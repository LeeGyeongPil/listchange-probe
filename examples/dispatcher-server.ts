/**
 * Fixed-dispatcher workaround for clients that ignore list_changed.
 *
 * The tool list never changes: it is always `list_capabilities` and `invoke`.
 * New abilities are added at runtime to an internal registry. A client that cached the
 * tool list at connect time can still reach them: it calls `list_capabilities` to see what
 * exists and `invoke` to run one.
 *
 * Trade-off: the model sees one generic `invoke` tool instead of one typed tool per ability,
 * so per-ability input schemas are not enforced by the client UI. Validate inside the handler.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export interface Capability {
  description: string;
  run(args: Record<string, unknown>): Promise<string> | string;
}

export interface DispatcherServer {
  server: McpServer;
  /** Adds (or replaces) an ability. No list_changed is needed: the tool list stays fixed. */
  addCapability(name: string, capability: Capability): void;
  removeCapability(name: string): boolean;
}

export function createDispatcherServer(initial: Record<string, Capability> = {}): DispatcherServer {
  const registry = new Map<string, Capability>(Object.entries(initial));
  const server = new McpServer({ name: 'dispatcher-example', version: '0.1.0' });
  const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError ? { isError: true } : {}) });

  server.registerTool(
    'list_capabilities',
    { description: 'Lists the abilities that can be run with invoke. Call this again later: the list can grow.', inputSchema: {} },
    async () => text(JSON.stringify([...registry].map(([name, c]) => ({ name, description: c.description })), null, 2)),
  );

  server.registerTool(
    'invoke',
    {
      description: 'Runs one ability by name. Use list_capabilities to see the available names.',
      inputSchema: { name: z.string(), args: z.record(z.string(), z.unknown()).optional() },
    },
    async ({ name, args }) => {
      const capability = registry.get(name);
      if (!capability) return text(`Unknown capability "${name}". Call list_capabilities to see the current names.`, true);
      return text(await capability.run(args ?? {}));
    },
  );

  return {
    server,
    addCapability: (name, capability) => {
      registry.set(name, capability);
    },
    removeCapability: (name) => registry.delete(name),
  };
}

/** Run directly: serves on stdio and adds an `uptime` ability five seconds after start. */
async function main(): Promise<void> {
  const started = Date.now();
  const dispatcher = createDispatcherServer({
    echo: { description: 'Returns args.text unchanged.', run: (args) => String(args.text ?? '') },
  });
  const timer = setTimeout(() => {
    dispatcher.addCapability('uptime', { description: 'Seconds since the server started.', run: () => String((Date.now() - started) / 1000) });
  }, 5000);
  timer.unref();
  await dispatcher.server.connect(new StdioServerTransport());
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((err: unknown) => {
    process.stderr.write(`dispatcher-server: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
