import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../src/store.mjs';
import { HearthlineOrchestrator } from '../src/orchestrator.mjs';
import { createMcpHttpServer, PROTOCOL_VERSION } from '../src/mcp-server.mjs';

test('unsupported initialize negotiates to the server-supported protocol version', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hearthline-init-'));
  const store = new JsonStore(join(dir, 'state.json'));
  await store.load();
  const orchestrator = new HearthlineOrchestrator({ store, alertProvider: async () => [] });
  const server = createMcpHttpServer({ orchestrator, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '1900-01-01', capabilities: {}, clientInfo: { name: 'old-client', version: '1' } },
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('mcp-session-id'));
  assert.equal(body.result.protocolVersion, PROTOCOL_VERSION);
  assert.equal(body.error, undefined);

  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.sessions, 1);
});
