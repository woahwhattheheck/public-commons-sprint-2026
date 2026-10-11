/** MIT. Operator-owned loopback MCP workspace; credentials never arrive over MCP. */
import { createServer } from 'node:http';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpPaidToolBroker, createMcpHttpHandler } from './agent-server.mjs';

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
  let quoteStore, broker, server, operator;
  try {
    if (directory) {
      const { SqliteQuoteStore } = await import('./quote-store.mjs');
      quoteStore = new SqliteQuoteStore({ directory });
    }
    if (modulePath) {
      // Executable trusted host configuration, never a path from MCP or discovery.
      operator = await import(pathToFileURL(modulePath).href);
      if (typeof operator.approve !== 'function' || typeof operator.signPayment !== 'function' ||
          (operator.close !== undefined && typeof operator.close !== 'function'))
        throw new TypeError('The trusted operator module must export approve and signPayment functions.');
    }
    broker = new McpPaidToolBroker({ discoveryUrl, allowedResourceOrigins, quoteStore,
      ...(operator ? { approve: operator.approve, signPayment: operator.signPayment,
        agentCommerce: operator.agentCommerce ?? null } : {}) });
    server = createServer(createMcpHttpHandler(broker, { bearerToken, allowedClientOrigins }));
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); done(); });
    });
  } catch (failure) {
    server?.close();
    try { if (broker) await broker.close({ graceMs: 0 }); else quoteStore?.close(); }
    catch { /* report the original startup failure after closing operator resources */ }
    finally { try { await operator?.close?.(); } catch { /* preserve original failure */ } }
    throw failure;
  }
  let closing;
  return {
    broker, server, address: `http://127.0.0.1:${server.address().port}`,
    durable: Boolean(quoteStore), paymentAdapterConnected: Boolean(operator),
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
    const workspace = await startMcpWorkspace();
    process.stderr.write(`Stellar MCP workspace at ${workspace.address}; history ${workspace.durable ? 'durable' : 'in memory'}; payment adapter ${workspace.paymentAdapterConnected ? 'connected, independent approval required' : 'not connected'}.\n`);
    let stopping = false;
    const stop = async () => {
      if (stopping) return; stopping = true;
      try { await workspace.close(); }
      catch (failure) { process.stderr.write(`Workspace close failed (${failure.code ?? 'OPERATOR_ERROR'}). Preserve its state directory.\n`); process.exitCode = 2; }
    };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch (failure) {
    process.stderr.write(`Workspace startup failed: ${failure.code ?? 'CONFIGURATION_ERROR'}: ${failure.message}\n`);
    process.exitCode = 2;
  }
}
