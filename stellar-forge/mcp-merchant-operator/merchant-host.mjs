// MIT. Isolate original compiler/application diagnostics from the MCP stream.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const failure = code => Object.assign(new Error(code), { code });

/** Original merchant HTTP factory, owned by one MCP subprocess connection. */
export async function startMerchantStdioHost({ configPath, environment = process.env,
  diagnostics = process.stderr } = {}) {
  if (typeof configPath !== 'string' || !configPath || !environment.MCP_ACCESS_TOKEN)
    throw failure('MCP_MERCHANT_HOST_CONFIGURATION');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--host', resolve(configPath)], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
    env: { ...environment, MCP_CLIENT_ORIGINS: '' },
  });
  let closing, startupTimer;
  const closed = new Promise(done => {
    child.once('exit', (code, signal) => done({ code, signal }));
    child.once('error', () => done({ code: 2, signal: null }));
  });
  const ready = new Promise((done, reject) => {
    startupTimer = setTimeout(() => reject(failure('MCP_MERCHANT_HOST_START_TIMEOUT')), 30000);
    child.once('error', () => reject(failure('MCP_MERCHANT_HOST_START_FAILED')));
    child.once('exit', () => reject(failure('MCP_MERCHANT_HOST_EXITED')));
    child.on('message', message => {
      if (message?.type === 'merchant-mcp-ready' && /^http:\/\/127\.0\.0\.1:\d+$/.test(message.url))
        done(message.url);
      else if (message?.type === 'merchant-mcp-error') reject(failure('MCP_MERCHANT_HOST_CONFIGURATION'));
    });
  });
  // SF82 invokes SF61's original CLI compiler, which writes directly to stdout.
  // Capturing both child streams also covers trusted application diagnostics;
  // no console replacement or process-global stdout hook is needed.
  const ignoreDiagnosticFailure = () => {};
  diagnostics.on('error', ignoreDiagnosticFailure);
  child.stdout.pipe(diagnostics, { end: false }); child.stderr.pipe(diagnostics, { end: false });
  closed.then(() => { clearTimeout(startupTimer); diagnostics.off('error', ignoreDiagnosticFailure); });
  const close = () => {
    if (closing) return closing;
    clearTimeout(startupTimer);
    closing = (async () => {
      if (child.connected) child.send({ type: 'merchant-mcp-stop' }, () => {});
      else if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      // Original close drains an accepted change and its owned seller. Killing
      // the manager here could strand its seller before the outcome is saved.
      const result = await closed;
      if (result.code !== 0) throw failure('MCP_MERCHANT_HOST_CLOSE_FAILED');
    })();
    return closing;
  };
  try {
    const address = await ready; clearTimeout(startupTimer);
    return { address, close, closed, durable: true, paymentAdapterConnected: false };
  } catch (error) {
    await close().catch(() => {}); throw error;
  }
}

async function host(configPath) {
  if (!process.send || !process.connected || !process.env.MCP_ACCESS_TOKEN)
    throw failure('MCP_MERCHANT_HOST_REQUIRES_PARENT');
  const { startMerchantMcp } = await import('./serve.mjs');
  let session, closing, stopped = false;
  const close = () => {
    stopped = true;
    if (!session) return Promise.resolve();
    if (closing) return closing;
    closing = session.close().finally(() => { if (process.connected) process.disconnect(); });
    return closing;
  };
  const stop = () => { void close().catch(() => { process.exitCode = 2; }); };
  process.on('message', message => { if (message?.type === 'merchant-mcp-stop') stop(); });
  process.once('disconnect', stop); process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    session = await startMerchantMcp({ configPath, port: 0, tokenEnv: 'MCP_ACCESS_TOKEN',
      environment: { ...process.env, MCP_CLIENT_ORIGINS: '' } });
    if (stopped || !process.connected) { await close(); return; }
    process.send({ type: 'merchant-mcp-ready', url: session.url });
  } catch (error) {
    if (process.connected) process.send({ type: 'merchant-mcp-error' });
    process.stderr.write('Merchant MCP host: ' + (error.code ?? 'CONFIGURATION_ERROR') + '\n');
    await close();
    if (process.connected) process.disconnect();
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--host' && process.argv.length === 4)
    host(process.argv[3]).catch(() => { process.stderr.write('Merchant MCP host could not start.\n'); process.exitCode = 2; });
  else { process.stderr.write('Launch the merchant through its MCP stdio entry.\n'); process.exitCode = 2; }
}
