#!/usr/bin/env node
/** MIT. Subprocess access to the original merchant release operator. */
import { Console } from 'node:console';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startMcpStdio } from '../mcp-paid-agent/stdio.mjs';
import { startMerchantStdioHost } from './merchant-host.mjs';
import { merchantConfigurationPath } from './client-config.mjs';

/** The same merchant factory owns its source aliases, release store and seller. */
export async function startMerchantMcpStdio({
  configPath, environment = process.env, input = process.stdin,
  output = process.stdout, maxConcurrent = 32,
  diagnostic = code => process.stderr.write(`Merchant MCP stdio: ${code}\n`),
} = {}) {
  const configuration = merchantConfigurationPath(configPath ?? environment.MCP_MERCHANT_CONFIG);
  let ownedHost;
  const connection = await startMcpStdio({
    environment, input, output, maxConcurrent, diagnostic,
    startWorkspace: async ({ environment: transportEnvironment }) => {
      ownedHost = await startMerchantStdioHost({
        configPath: configuration, environment: transportEnvironment,
      });
      return ownedHost;
    },
    // The original merchant has no cancellation primitive for an admitted
    // release change. The transport cancels only the wait for its reply;
    // merchant_status/inspect retain the original release and instance state.
    cancelRequest: async () => {},
  });
  ownedHost.closed.then(() => connection.close('MERCHANT_HOST_CLOSED'));
  return connection;
}

const HELP = `Starforge merchant MCP stdio

  node stdio.mjs --config /absolute/merchant/merchant-mcp.json
  MCP_MERCHANT_CONFIG=/absolute/merchant/merchant-mcp.json node stdio.mjs

Prepare the merchant with the original serve.mjs init command. Use
client-config.mjs to register this subprocess with an MCP host. The transport
creates its private loopback bearer internally. Supply the merchant's existing
backend credential variables through the host environment. Runtime diagnostics
use stderr; stdout carries newline-delimited MCP messages.
`;

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stderr.write(HELP); return;
  }
  if (args.length && (args.length !== 2 || args[0] !== '--config' || !args[1] || args[1].startsWith('--')))
    throw new TypeError('Use --config with an absolute merchant configuration path, or MCP_MERCHANT_CONFIG.');
  const previousConsole = globalThis.console;
  globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
  let connection, stopRequested = false;
  const stop = () => { stopRequested = true; void connection?.close('HOST_SIGNAL'); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    connection = await startMerchantMcpStdio({ configPath: args[1] });
    if (stopRequested) await connection.close('HOST_SIGNAL');
    const result = await connection.closed;
    if (result.errorCode) process.exitCode = 2;
    return result;
  } finally {
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    globalThis.console = previousConsole;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    process.stderr.write(`Merchant MCP stdio startup failed (${error.code ?? 'CONFIGURATION_ERROR'}). Check MCP_MERCHANT_CONFIG and the original merchant workspace.\n`);
    process.exitCode = 2;
  });
