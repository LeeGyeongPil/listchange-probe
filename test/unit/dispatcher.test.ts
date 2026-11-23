import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDispatcherServer } from '../../examples/dispatcher-server.js';

function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return content.map((c) => c.text).join('');
}

test('AC-8: a client that ignores list_changed still reaches a capability added at runtime', async () => {
  const dispatcher = createDispatcherServer({ echo: { description: 'echo', run: (a) => String(a.text) } });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await dispatcher.server.connect(st);
  const client = new Client({ name: 'ignoring-client', version: '0' }); // no listChanged option, no handler
  await client.connect(ct);

  const before = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(before, ['invoke', 'list_capabilities']);
  assert.match(textOf(await client.callTool({ name: 'list_capabilities', arguments: {} })), /echo/);

  dispatcher.addCapability('late', { description: 'added at runtime', run: () => 'late works' });

  // The client never re-lists tools, yet the new capability is reachable.
  assert.match(textOf(await client.callTool({ name: 'list_capabilities', arguments: {} })), /late/);
  assert.equal(textOf(await client.callTool({ name: 'invoke', arguments: { name: 'late' } })), 'late works');
  assert.equal(textOf(await client.callTool({ name: 'invoke', arguments: { name: 'echo', args: { text: 'hi' } } })), 'hi');
  // The tool list itself is still exactly the two fixed tools.
  assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), ['invoke', 'list_capabilities']);
  await client.close();
});

test('AC-8: an unknown or removed capability returns an error result that explains what to do', async () => {
  const dispatcher = createDispatcherServer();
  dispatcher.addCapability('temp', { description: 't', run: () => 'x' });
  assert.equal(dispatcher.removeCapability('temp'), true);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await dispatcher.server.connect(st);
  const client = new Client({ name: 'c', version: '0' });
  await client.connect(ct);
  const result = await client.callTool({ name: 'invoke', arguments: { name: 'temp' } });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /list_capabilities/);
  await client.close();
});
