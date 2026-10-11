/** One focused original-broker/HTTP/SQLite restart journey. No real payments. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BazaarCatalog, createDiscoveryServer } from '../../scf46-stellar-bazaar/src/catalog.mjs';
import { McpPaidToolBroker, MCP_VERSION } from './agent-server.mjs';
import { SqliteQuoteStore } from './quote-store.mjs';
import { inspectWorkspace, renderHistory } from './history.mjs';
import { startMcpWorkspace } from './serve.mjs';

const terms = { scheme: 'exact', network: 'stellar:testnet', asset: 'TEST_ONLY_ASSET', amount: '1000', payTo: 'TEST_ONLY_RECIPIENT' };
const signer = async ({ resource, accepted }) => ({ x402Version: 2, resource, accepted, payload: { fixture: 'EXPLICIT_LOOPBACK_SIGNER_NOT_STELLAR' } });
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64');
const open = async handler => {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}` };
};
const stop = ({ server }) => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
const quote = async broker => {
  const found = await broker.search({ query: 'durable weather' });
  return broker.preview({ handle: found.resources[0].handle });
};

if (process.argv[2] === '--crash-child') {
  const [, , , directory, discoveryUrl, origin] = process.argv;
  const broker = new McpPaidToolBroker({ discoveryUrl, allowedResourceOrigins: [origin],
    quoteStore: new SqliteQuoteStore({ directory }), approve: () => true, signPayment: signer });
  const found = await broker.search({ query: 'durable weather' });
  const preview = broker.preview({ handle: found.resources[0].handle, input: { query: { crash: 'yes' } } });
  await new Promise(resolve => process.send({ quoteId: preview.quoteId }, resolve));
  await broker.execute({ quoteId: preview.quoteId });
  throw new Error('Child was expected to be interrupted after the merchant received the signed request');
} else {
  const root = mkdtempSync(join(tmpdir(), 'mcp-durable-'));
  let merchant, discovery, currentBroker, child, launched;
  let signed = 0, probes = 0, crashReceived;
  const childSent = new Promise(resolve => { crashReceived = resolve; });
  try {
    merchant = await open((req, res) => {
      const url = merchant.url + req.url;
      if (!req.headers['payment-signature']) {
        probes++;
        res.writeHead(402, { 'PAYMENT-REQUIRED': b64({ x402Version: 2, resource: { url }, accepts: [terms] }) });
        res.end('{}'); return;
      }
      signed++;
      if (new URL(url).searchParams.get('crash') === 'yes') { crashReceived(); return; }
      res.writeHead(200, { 'content-type': 'application/json', 'PAYMENT-RESPONSE': b64({
        success: true, network: terms.network, transaction: 'a'.repeat(64),
      }) });
      res.end('{"forecast":"rain","fixture":"RESPONSE_BODY_NOT_STORED"}');
    });
    const catalog = new BazaarCatalog();
    catalog.insertValidated({ resource: { url: merchant.url + '/weather', description: 'Durable weather' },
      accepts: [terms], extensions: { bazaar: { info: { input: { type: 'http', method: 'GET', queryParams: { crash: '' } } },
        schema: { type: 'object', properties: { input: { type: 'object' } }, required: ['input'] } } } });
    discovery = await open(createDiscoveryServer(catalog));
    const settings = { discoveryUrl: discovery.url, allowedResourceOrigins: [merchant.url], approve: () => true, signPayment: signer };
    const directory = join(root, 'quotes');
    currentBroker = new McpPaidToolBroker({ ...settings, quoteStore: new SqliteQuoteStore({ directory }) });
    const purchased = await quote(currentBroker);
    const completed = await currentBroker.execute({ quoteId: purchased.quoteId });
    assert.equal(completed.status, 'CONFIRMED_BY_SERVER'); assert.equal(signed, 1);
    assert.match(completed.result.content.body, /RESPONSE_BODY_NOT_STORED/);
    completed.result.paymentResponse.transaction = 'modified caller copy';
    assert.equal(currentBroker.status({ quoteId: purchased.quoteId }).result.paymentResponse.transaction, 'a'.repeat(64));
    const pending = await quote(currentBroker);
    assert.throws(() => new SqliteQuoteStore({ directory }), { code: 'QUOTE_WORKSPACE_IN_USE' });
    const liveHistory = inspectWorkspace({ directory });
    assert.equal(liveHistory.total, 2);
    assert.ok(!JSON.stringify(liveHistory).includes('RESPONSE_BODY_NOT_STORED'));
    assert.ok(!JSON.stringify(liveHistory).includes('EXPLICIT_LOOPBACK_SIGNER_NOT_STELLAR'));
    const firstPage = currentBroker.history({ limit: 1 });
    assert.equal(currentBroker.history({ limit: 1, cursor: firstPage.nextCursor }).quotes.length, 1);
    await currentBroker.close();

    currentBroker = new McpPaidToolBroker({ ...settings, quoteStore: new SqliteQuoteStore({ directory }) });
    assert.equal(currentBroker.status({ quoteId: purchased.quoteId }).result.content.omitted, true);
    assert.equal((await currentBroker.execute({ quoteId: purchased.quoteId })).status, 'CONFIRMED_BY_SERVER');
    assert.equal(signed, 1);
    assert.equal(currentBroker.status({ quoteId: pending.quoteId }).status, 'PREVIEWED');
    await currentBroker.close();
    currentBroker = new McpPaidToolBroker({ ...settings, allowedResourceOrigins: [], quoteStore: new SqliteQuoteStore({ directory }) });
    assert.equal(currentBroker.status({ quoteId: pending.quoteId }).status, 'CONFIG_CHANGED');
    await currentBroker.close(); currentBroker = null;

    const crashDirectory = join(root, 'crash');
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--crash-child', crashDirectory, discovery.url, merchant.url],
      { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let childError = ''; child.stderr.on('data', chunk => { childError += chunk; });
    const childExit = once(child, 'exit');
    const childQuote = new Promise((resolve, reject) => {
      child.once('message', message => resolve(message.quoteId));
      child.once('error', reject);
      child.once('exit', (code, signal) => { if (signal !== 'SIGKILL') reject(new Error(`Unexpected child exit ${code}: ${childError}`)); });
    });
    let timer;
    const crashId = await Promise.race([
      Promise.all([childQuote, childSent]).then(([id]) => id),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Child dispatch timeout')), 12000); }),
    ]).finally(() => clearTimeout(timer));
    assert.equal(signed, 2); child.kill('SIGKILL'); await childExit; child = null;
    currentBroker = new McpPaidToolBroker({ ...settings, quoteStore: new SqliteQuoteStore({ directory: crashDirectory }) });
    assert.equal(currentBroker.status({ quoteId: crashId }).status, 'INDETERMINATE');
    await currentBroker.execute({ quoteId: crashId }); assert.equal(signed, 2);
    assert.ok(inspectWorkspace({ directory: crashDirectory, quoteId: crashId }).transitions.some(row => row.phase === 'SIGNED_DISPATCH'));
    await currentBroker.close(); currentBroker = null;

    // A failed cancellation must not be undone by a delayed positive approval.
    const raceDirectory = join(root, 'race');
    const actualStore = new SqliteQuoteStore({ directory: raceDirectory });
    let failCancellation = false, storeClosed = false;
    const approvals = [];
    const flaky = { load: () => actualStore.load(), save: record => {
      if (failCancellation && record.status === 'CANCELLED') {
        failCancellation = false; throw Object.assign(new Error('controlled disk failure'), { code: 'SIMULATED_STORAGE_FAILURE' });
      }
      actualStore.save(record);
    }, close: () => { storeClosed = true; actualStore.close(); } };
    currentBroker = new McpPaidToolBroker({ ...settings, quoteStore: flaky, approve: () => new Promise(resolve => approvals.push(resolve)) });
    const cancelled = await quote(currentBroker), beforeProbes = probes;
    const lateApproval = currentBroker.execute({ quoteId: cancelled.quoteId });
    failCancellation = true;
    assert.throws(() => currentBroker.cancel({ quoteId: cancelled.quoteId }), { code: 'SIMULATED_STORAGE_FAILURE' });
    approvals.shift()(true);
    assert.equal((await lateApproval).status, 'INTERRUPTED'); assert.equal(probes, beforeProbes);
    const shutdownQuote = await quote(currentBroker);
    const duringClose = currentBroker.execute({ quoteId: shutdownQuote.quoteId });
    failCancellation = true;
    const close = currentBroker.close({ graceMs: 0 });
    assert.equal(currentBroker.close(), close);
    await assert.rejects(close, { code: 'SIMULATED_STORAGE_FAILURE' }); assert.equal(storeClosed, true);
    approvals.shift()(true); await duringClose;
    await assert.rejects(currentBroker.call('sf43_discover_review_and_pay', {}), { code: 'BROKER_CLOSING' });
    const reopen = new SqliteQuoteStore({ directory: raceDirectory }); reopen.close(); currentBroker = null;
    assert.equal(probes, beforeProbes); assert.equal(signed, 2);

    // Existing launcher, trusted module, actual MCP HTTP and cleanup on error.
    const adapter = join(root, 'operator.mjs'), marker = join(root, 'operator-closed');
    writeFileSync(adapter, `import {writeFileSync} from 'node:fs';\nexport const approve=()=>false;\nexport const signPayment=()=>{throw Error('Not expected');};\nexport const close=()=>writeFileSync(${JSON.stringify(marker)},'closed',{mode:0o600});\n`, { mode: 0o600 });
    launched = await startMcpWorkspace({ environment: { BAZAAR_DISCOVERY_URL: discovery.url,
      PAID_RESOURCE_ORIGINS: merchant.url, MCP_ACCESS_TOKEN: 'durable-acceptance-local-operator-token',
      MCP_OPERATOR_MODULE: adapter, MCP_STATE_DIR: join(root, 'launcher'), MCP_PORT: '0' } });
    const response = await fetch(launched.address, { method: 'POST', headers: {
      authorization: 'Bearer durable-acceptance-local-operator-token', 'content-type': 'application/json',
      accept: 'application/json, text/event-stream', 'mcp-protocol-version': MCP_VERSION,
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.ok((await response.json()).result.tools.some(tool => tool.name === 'bazaar_history'));
    const actualClose = launched.broker.close.bind(launched.broker);
    launched.broker.close = async () => { await actualClose(); throw Error('controlled close failure'); };
    await assert.rejects(launched.close(), /controlled close failure/); launched = null;
    assert.equal(readFileSync(marker, 'utf8'), 'closed');
    const report = inspectWorkspace({ directory });
    assert.match(renderHistory(report, 'html'), /Stellar MCP \/ Quote workspace/);
    assert.match(renderHistory(report, 'csv'), /amount_atomic/);
    assert.ok(!renderHistory(report, 'html').includes('RESPONSE_BODY_NOT_STORED'));
    process.stdout.write(JSON.stringify({ result: 'PASS', originalBroker: true, originalCatalog: true,
      sqlite: true, signedLoopbackRequests: signed, realStellarPayments: 0,
      restartPreserved: true, crashNoResend: true, failedCancelNoDispatch: true,
      writerReleased: true, mcpHistory: true, privateExport: true }) + '\n');
  } finally {
    if (child) child.kill('SIGKILL');
    await launched?.close().catch(() => {});
    await currentBroker?.close({ graceMs: 0 }).catch(() => {});
    if (discovery) await stop(discovery);
    if (merchant) await stop(merchant);
    rmSync(root, { recursive: true, force: true });
  }
}
