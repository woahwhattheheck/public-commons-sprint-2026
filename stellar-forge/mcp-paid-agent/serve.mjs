/** MIT. Operator-owned loopback MCP workspace; credentials never arrive over MCP. */
import { createServer } from 'node:http';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpPaidToolBroker, createMcpHttpHandler } from './agent-server.mjs';
import { createOperatorConsoleHandler } from './operator-console.mjs';

export async function startMcpWorkspace({ environment = process.env } = {}) {
  const discoveryUrl = environment.BAZAAR_DISCOVERY_URL;
  const bearerToken = environment.MCP_ACCESS_TOKEN;
  if (!discoveryUrl || !bearerToken)
    throw new TypeError('Configure BAZAAR_DISCOVERY_URL and MCP_ACCESS_TOKEN.');
  const modulePath = environment.MCP_OPERATOR_MODULE;
  const directory = environment.MCP_STATE_DIR;
  if (modulePath && (!isAbsolute(modulePath) || !directory))
    throw new TypeError('An operator module requires an absolute MCP_OPERATOR_MODULE and durable MCP_STATE_DIR.');
  const allowedResourceOrigins = (environment.PAID_RESOURCE_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  const allowedClientOrigins = (environment.MCP_CLIENT_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  const port = Number(environment.MCP_PORT ?? 3210);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new RangeError('Invalid MCP_PORT');
  const timeoutMs = Number(environment.MCP_PROVIDER_TIMEOUT_MS ?? 8000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000)
    throw new RangeError('MCP_PROVIDER_TIMEOUT_MS must be 1..300000');
  let quoteStore, resultStore, broker, server, operator, address;
  try {
    if (directory) {
      const { SqliteQuoteStore } = await import('./quote-store.mjs');
      quoteStore = new SqliteQuoteStore({ directory });
      const {McpResultStore} = await import('./result-store.mjs');
      resultStore = new McpResultStore({directory:join(quoteStore.directory,'results')});
    }
    if (modulePath) {
      // Executable trusted host configuration, never a path from MCP or discovery.
      operator = await import(pathToFileURL(modulePath).href);
      const pays = typeof operator.approve === 'function' && typeof operator.signPayment === 'function';
      const readsOnly = operator.approve === undefined && operator.signPayment === undefined &&
        typeof operator.reconcilePayment === 'function';
      if ((!pays && !readsOnly) ||
          (operator.reconcilePayment !== undefined && typeof operator.reconcilePayment !== 'function') ||
          (operator.close !== undefined && typeof operator.close !== 'function'))
        throw new TypeError('Export paired approve/signPayment functions, a read-only reconcilePayment function, or both.');
    }
    broker = new McpPaidToolBroker({ discoveryUrl, allowedResourceOrigins, quoteStore, resultStore, timeoutMs,
      ...(operator ? { ...(operator.signPayment ? {approve:operator.approve,signPayment:operator.signPayment} : {}),
        reconcilePayment:operator.reconcilePayment ?? null,
        agentCommerce: operator.agentCommerce ?? null,
        ...(operator.fetchImpl === undefined ? {} : {fetchImpl:operator.fetchImpl}),
        remoteMcpPolicies: operator.remoteMcpPolicies ?? [] } : {}) });
    let handler;
    server = createServer((request, response) => {
      if (handler) return handler(request, response);
      response.writeHead(503); response.end();
    });
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); done(); });
    });
    address = `http://127.0.0.1:${server.address().port}`;
    handler = createOperatorConsoleHandler(createMcpHttpHandler(broker, {
      bearerToken, allowedClientOrigins: [...new Set([...allowedClientOrigins, address])],
    }), {origin: address});
  } catch (failure) {
    server?.close();
    try {
      if (broker) await broker.close({ graceMs: 0 });
      else { try { await resultStore?.close(); } finally { quoteStore?.close(); } }
    }
    catch { /* report the original startup failure after closing operator resources */ }
    finally { try { await operator?.close?.(); } catch { /* preserve original failure */ } }
    throw failure;
  }
  let closing;
  return {
    broker, server, address, consoleUrl: `${address}/console/`,
    durable: Boolean(quoteStore), paymentAdapterConnected: typeof operator?.signPayment === 'function',
    paymentReconciliationConnected: typeof operator?.reconcilePayment === 'function',
    close() {
      if (closing) return closing;
      closing = (async () => {
        const stopped = new Promise(done => server.close(done));
        let failure;
        try { await broker.close(); } catch (error) { failure = error; }
        finally {
          server.closeAllConnections(); await stopped;
          try { await operator?.close?.(); } catch (error) { failure ??= error; }
        }
        if (failure) throw failure;
      })();
      return closing;
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
      process.stdout.write(`Usage: node serve.mjs\n\nStart the original loopback MCP buyer and browser console.\nRequired: BAZAAR_DISCOVERY_URL, MCP_ACCESS_TOKEN (at least 24 characters).\nMCP_STATE_DIR retains original quotes and complete native results.\nMCP_PORT defaults to 3210; 0 selects an available port.\nOpen the printed http://127.0.0.1:PORT/console/ URL and enter the same access token.\nPAID_RESOURCE_ORIGINS selects the merchant origins permitted for quotes.\nMCP_CLIENT_ORIGINS allows additional original MCP client origins.\nPaid execution requires an absolute trusted MCP_OPERATOR_MODULE and MCP_STATE_DIR.\nThat host module owns independent approval and signing; the browser cannot approve for it.\nMCP_PROVIDER_TIMEOUT_MS: 1..300000, default 8000.\nGuides: README.md, CONSOLE.md, REMOTE_MCP.md, RESULTS.md.\n`);
    } else {
      if (args.length) throw new TypeError('This launcher uses environment configuration. Use --help for its settings.');
      const workspace = await startMcpWorkspace();
      process.stderr.write(`Stellar MCP workspace at ${workspace.address}; history ${workspace.durable ? 'durable' : 'in memory'}; payment adapter ${workspace.paymentAdapterConnected ? 'connected, independent approval required' : 'not connected'}.\n`);
      process.stderr.write(`Buyer console: ${workspace.consoleUrl}\n`);
      let stopping = false;
      const stop = async () => {
        if (stopping) return; stopping = true;
        try { await workspace.close(); }
        catch (failure) { process.stderr.write(`Workspace close failed (${failure.code ?? 'OPERATOR_ERROR'}). Preserve its state directory.\n`); process.exitCode = 2; }
      };
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
    }
  } catch (failure) {
    process.stderr.write(`Workspace startup failed: ${failure.code ?? 'CONFIGURATION_ERROR'}: ${failure.message}\n`);
    process.exitCode = 2;
  }
}
