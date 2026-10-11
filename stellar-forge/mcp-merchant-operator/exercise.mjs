#!/usr/bin/env node
// MIT. One original merchant + MCP + customer delivery journey; no paid request.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { initializeMerchant } from './config.mjs';
import { startMerchantMcp } from './serve.mjs';
import { openMerchantOperator } from './operator.mjs';
import { McpPaidToolBroker, createMcpHttpHandler, MCP_VERSION } from '../mcp-paid-agent/agent-server.mjs';

const source = name => fileURLToPath(new URL('../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/' + name, import.meta.url));
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
export async function exercise() {
  const temporary = await mkdtemp(join(tmpdir(), 'starforge-merchant-mcp-'));
  const token = 'local-integration-access-'.repeat(3);
  let merchant, other, buyerServer, buyer;
  const checks = [];
  try {
    const selections = JSON.parse(await readFile(source('service-selections.example.json')));
    const selectionPath = join(temporary, 'selections.json'); await save(selectionPath, selections);
    const initialized = await initializeMerchant({ directory: join(temporary, 'merchant'), name: 'Merchant integration',
      spec: source('openapi.example.json'), selections: selectionPath,
      bindings: source('service-bindings.example.json'), runtime: { port: 0 } });
    merchant = await startMerchantMcp({ configPath: initialized.configuration, port: 0, environment: { MCP_ACCESS_TOKEN: token } });
    let sequence = 0;
    const rpc = async (method, params = {}, headers = {}) => {
      const response = await fetch(merchant.url, { method: 'POST', redirect: 'error', headers: {
        authorization: 'Bearer ' + token, accept: 'application/json, text/event-stream', 'content-type': 'application/json',
        'mcp-protocol-version': MCP_VERSION, ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }) });
      return { status: response.status, body: await response.json() };
    };
    const call = async (name, args = {}, expectedError) => {
      const result = await rpc('tools/call', { name, arguments: args });
      assert.equal(result.status, 200);
      const envelope = result.body.result;
      assert.ok(envelope, JSON.stringify(result.body));
      assert.deepEqual(JSON.parse(envelope.content[0].text), envelope.structuredContent);
      if (expectedError) { assert.equal(envelope.isError, true); assert.equal(envelope.structuredContent.code, expectedError); }
      else assert.equal(envelope.isError, false, JSON.stringify(envelope.structuredContent));
      return envelope.structuredContent;
    };
    assert.equal((await rpc('initialize')).body.result.serverInfo.name, 'starforge-merchant-operator');
    const tools = (await rpc('tools/list')).body.result.tools;
    assert.equal(new Set(tools.map(tool => tool.name)).size, tools.length);
    assert.equal((await rpc('tools/list', {}, { authorization: '' })).status, 401);
    assert.equal((await rpc('tools/list', {}, { origin: 'https://another.example' })).status, 403);
    await call('merchant_stage', { source: 'initial', id: 'first', spec: '/etc/passwd' }, 'INVALID_PARAMS');
    const described = await call('merchant_sources', { source: 'initial' });
    assert.equal(described.routes[0].accepts[0].amount, '20000');
    const first = (await call('merchant_stage', { source: 'initial', id: 'first' })).release;
    selections[0].accepts[0].amount = '30000'; await save(selectionPath, selections);
    const second = (await call('merchant_stage', { source: 'initial', id: 'second' })).release;
    const diff = await call('merchant_compare', { from: 'first', to: 'second' });
    assert.equal(diff.summary.paymentChanged, 1); assert.equal(diff.generation, 0);
    assert.equal(diff.after.routes[0].payment[0].amount, '30000');
    checks.push('authenticated original MCP transport, fixed source aliases, exact original compilation and price diff');

    await call('merchant_activate', { id: 'first', expectedDigest: first.digest, expectedGeneration: 0, reason: 'Initial merchant' });
    await call('merchant_activate', { id: 'second', expectedDigest: second.digest, expectedGeneration: 0, reason: 'Stale selection' }, 'RELEASE_CONFLICT');
    await call('merchant_start', { expectedGeneration: 1, expectedDigest: second.digest }, 'RELEASE_CONFLICT');
    const started = await call('merchant_start', { expectedGeneration: 1, expectedDigest: first.digest });
    assert.equal(started.runtime.state, 'RUNNING');
    const instance = started.operator.instanceId;
    const catalog = await call('merchant_catalog', { instanceId: instance });
    assert.equal(catalog.health.mode, 'CHALLENGE_ONLY'); assert.equal(catalog.offers[0].accepts[0].amount, '20000');
    assert.equal(catalog.releaseDigest, first.digest);
    const exported = await call('merchant_client_export', { instanceId: instance, id: 'customer-1' });
    assert.equal(exported.files.length, 5); assert.equal(exported.mode, 'CHALLENGE_ONLY');
    assert.equal(exported.sourceSha256, catalog.openapiSha256);
    const client = await import(pathToFileURL(join(exported.directory, 'seller-client.mjs')).href);
    assert.ok(Object.keys(client).length > 0);
    await call('merchant_client_export', { instanceId: instance, id: 'customer-1' }, 'EEXIST');
    checks.push('original seller child readiness, real metadata, exact customer SDK export and non-overwrite');

    other = await openMerchantOperator(initialized.configuration);
    await assert.rejects(other.call('merchant_stop', { instanceId: instance }), { code: 'INSTANCE_CONFLICT' });
    await call('merchant_activate', { id: 'second', expectedDigest: second.digest, expectedGeneration: 1, reason: 'Reviewed price change' });
    const selected = await call('merchant_status');
    assert.equal(selected.runtime.state, 'RESTART_REQUIRED');
    assert.equal((await call('merchant_catalog', { instanceId: instance })).offers[0].accepts[0].amount, '20000');
    const upgraded = (await call('merchant_restart', { instanceId: instance, expectedGeneration: 2, expectedDigest: second.digest })).status;
    assert.equal(upgraded.runtime.state, 'RUNNING');
    assert.notEqual(upgraded.operator.instanceId, instance);
    assert.equal((await call('merchant_catalog', { instanceId: upgraded.operator.instanceId })).offers[0].accepts[0].amount, '30000');
    await call('merchant_stop', { instanceId: instance }, 'INSTANCE_CONFLICT');
    await call('merchant_rollback', { to: 'first', expectedDigest: first.digest, expectedGeneration: 2, reason: 'Return to original' });
    const rolledBack = (await call('merchant_restart', { instanceId: upgraded.operator.instanceId, expectedGeneration: 3, expectedDigest: first.digest })).status;
    assert.equal(rolledBack.state.active, 'first');
    assert.equal((await call('merchant_catalog', { instanceId: rolledBack.operator.instanceId })).offers[0].accepts[0].amount, '20000');
    const stopped = (await call('merchant_stop', { instanceId: rolledBack.operator.instanceId })).status;
    assert.equal(stopped.runtime.state, 'STOPPED'); assert.equal(stopped.state.history.length, 3);
    // Closing the MCP server must drain its owned original child as well.
    await call('merchant_start', { expectedGeneration: 3, expectedDigest: first.digest });
    await merchant.close(); merchant = null;
    assert.equal((await other.status()).runtime.state, 'STOPPED');
    checks.push('generation conflict, ownership, explicit upgrade and rollback, original history, server shutdown drain');

    buyer = new McpPaidToolBroker({ discoveryUrl: 'http://127.0.0.1:9' });
    buyerServer = createServer(createMcpHttpHandler(buyer, { bearerToken: token }));
    await new Promise(done => buyerServer.listen(0, '127.0.0.1', done));
    const response = await fetch('http://127.0.0.1:' + buyerServer.address().port, { method: 'POST', headers: {
      authorization: 'Bearer ' + token, accept: 'application/json, text/event-stream', 'content-type': 'application/json',
      'mcp-protocol-version': MCP_VERSION }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    const originalTools = (await response.json()).result.tools;
    assert.ok(originalTools.some(tool => tool.name === 'bazaar_execute_approved'));
    assert.ok(originalTools.some(tool => tool.name === 'bazaar_describe'));
    checks.push('original buyer MCP entrypoint and tool registration preserved');
    return { schema: 'stellar-forge.merchant-mcp-exercise.v1', result: 'PASS', checks,
      merchantTools: tools.length, pricesAtomic: ['20000', '30000', '20000'], paidRequests: 0 };
  } finally {
    await merchant?.close(); await other?.close();
    if (buyerServer) { buyerServer.closeAllConnections(); await new Promise(done => buyerServer.close(done)); }
    await buyer?.close(); await rm(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  exercise().then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
    .catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
}
