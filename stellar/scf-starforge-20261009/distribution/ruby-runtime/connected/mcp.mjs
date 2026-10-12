#!/usr/bin/env node
// MIT. Installed stdio and authenticated loopback MCP for the original Ruby workspace.
import { createServer } from 'node:http';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { openRubyConnectedClient, rubyMcpProvider } from './client.mjs';
import { need, errorView } from './protocol.mjs';
import { absolute, once, json } from '../files.mjs';
import { createMcpToolHandler } from '../../../../../stellar-forge/mcp-paid-agent/http-tools.mjs';

const SERVER_NAME = 'starforge-ruby-runtime';
const VERSION = '0.1.0';
const INSTRUCTIONS = 'Operate the saved Ruby workspace with its original customer, environment, application and operation IDs. Inspect first; retain a UUID before a modifying call and reuse it after a lost response. Customer source preview supplies the digest for selection; customer advance continues the same native lifecycle and application registration. Long native operations return their saved status. Read their exact original operation/log to follow progress. Stop a Rails listener before verifying or exporting its full current application. file_open/file_read obtain every original byte; archive_prepare/archive_write/archive_finish receive a whole TAR with the original receiving UUID. Large tool results are complete retained JSON files described by stellar-forge.ruby-tool-result.v1.';
const outputError = error => { process.stderr.write(JSON.stringify(errorView(error)) + '\n'); };

async function privateToken(filename) {
  absolute(filename);
  need(await realpath(dirname(filename)) === dirname(filename), 'RUBY_MCP_TOKEN_PARENT', 'Use an original absolute token-file parent.');
  async function read() {
    const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await file.stat({ bigint: true });
      need(before.isFile() && before.uid === BigInt(process.getuid()) && (before.mode & 0o077n) === 0n &&
        before.size > 0n && before.size <= 4096n, 'RUBY_MCP_TOKEN_FILE', 'Use a private regular MCP token file.');
      const bytes = await file.readFile(), after = await file.stat({ bigint: true });
      need(['dev','ino','size','mtimeNs','ctimeNs'].every(key => before[key] === after[key]) &&
        BigInt(bytes.length) === before.size, 'RUBY_MCP_TOKEN_CHANGED', 'The original MCP token file changed.', 409);
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      need(value.schema === 'stellar-forge.ruby-mcp-token.v1' && /^[a-f0-9]{64}$/.test(value.token),
        'RUBY_MCP_TOKEN_FILE', 'Use the original saved MCP token record.');
      return value.token;
    } finally { await file.close(); }
  }
  try { return await read(); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { await once(filename, json({ schema: 'stellar-forge.ruby-mcp-token.v1', token: randomBytes(32).toString('hex') })); }
    catch (issue) { if (issue.code !== 'RUBY_RETAINED_FILE_CHANGED') throw issue; }
    return read();
  }
}
function lifecycle(client) {
  const pending = new Set();
  let closing = false;
  return {
    get closing() { return closing; },
    track(fn) {
      need(!closing, 'RUBY_MCP_CLOSING', 'Reconnect to this original Ruby workspace after the server closes.', 409);
      const work = Promise.resolve().then(fn);
      pending.add(work); work.finally(() => pending.delete(work)).catch(() => {});
      return work;
    },
    async drain() {
      closing = true;
      while (pending.size) await Promise.allSettled([...pending]);
      await client.close();
    },
    beginClose() { closing = true; },
  };
}

export async function serveRubyStdio({ directory, create = false, input = process.stdin, output = process.stdout } = {}) {
  const [{ Server }, { StdioServerTransport }, schemas] = await Promise.all([
    import('@modelcontextprotocol/sdk/server/index.js'),
    import('@modelcontextprotocol/sdk/server/stdio.js'),
    import('@modelcontextprotocol/sdk/types.js'),
  ]);
  const client = await openRubyConnectedClient({ directory, create });
  const provider = rubyMcpProvider(client), owner = lifecycle(client);
  const server = new Server({ name: SERVER_NAME, version: VERSION },
    { capabilities: { tools: { listChanged: false } }, instructions: INSTRUCTIONS });
  const transport = new StdioServerTransport(input, output, { maxBufferSize: 4 * 1024 * 1024 });
  let closePromise = null, resolveDone, rejectDone;
  const done = new Promise((accept, reject) => { resolveDone = accept; rejectDone = reject; });
  done.catch(() => {});
  server.setRequestHandler(schemas.ListToolsRequestSchema, async () => ({ tools: provider.tools }));
  server.setRequestHandler(schemas.CallToolRequestSchema, async request => {
    try {
      const value = await owner.track(() => provider.call(request.params.name, request.params.arguments ?? {}));
      return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: false };
    } catch (error) {
      const value = errorView(error);
      return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: true };
    }
  });
  server.onerror = outputError;
  function close() {
    if (closePromise) return closePromise;
    owner.beginClose(); input.pause();
    closePromise = (async () => {
      const failures = [];
      try { await owner.drain(); } catch (error) { failures.push(error); }
      try { await server.close(); } catch (error) { failures.push(error); }
      input.off('end', ended); input.off('error', failed);
      if (failures.length) throw new AggregateError(failures, 'The original Ruby MCP connection could not close completely.');
    })();
    closePromise.then(resolveDone, rejectDone);
    return closePromise;
  }
  const ended = () => { close().catch(outputError); };
  const failed = error => { outputError(error); close().catch(outputError); };
  input.once('end', ended); input.once('error', failed);
  server.onclose = ended;
  try {
    await server.connect(transport);
    if (input.readableEnded || input.destroyed) ended();
    return { server, transport, client, directory: client.directory, done, close };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}

export async function serveRubyHttp({ directory, create = false, port = 8476, tokenFile } = {}) {
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'RUBY_MCP_PORT', 'Select a valid loopback port.');
  const client = await openRubyConnectedClient({ directory, create });
  let server, owner, closePromise = null;
  try {
    tokenFile ??= join(client.directory, 'ruby-mcp-token.json');
    const bearerToken = await privateToken(tokenFile), provider = rubyMcpProvider(client);
    owner = lifecycle(client);
    const handler = createMcpToolHandler({ tools: provider.tools,
      call: (name, input) => owner.track(() => provider.call(name, input)) },
    { bearerToken, serverName: SERVER_NAME, serverVersion: VERSION, maxRequestBytes: 4 * 1024 * 1024,
      instructions: INSTRUCTIONS, toolErrorView: errorView });
    let origin;
    const requests = new Set();
    server = createServer((req, res) => {
      const work = (async () => {
        if (owner.closing || req.headers.host !== new URL(origin).host || req.url !== '/mcp') {
          res.writeHead(owner.closing ? 503 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          res.end(JSON.stringify({ error: owner.closing ? 'RUBY_MCP_CLOSING' : 'RUBY_MCP_ADDRESS' })); return;
        }
        await handler(req, res);
      })().catch(error => {
        if (!res.headersSent && !res.destroyed) {
          res.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          res.end(JSON.stringify(errorView(error)));
        } else if (!res.writableEnded) res.destroy(error);
      }).finally(() => requests.delete(work));
      requests.add(work);
    });
    server.requestTimeout = 0; server.headersTimeout = 15000; server.keepAliveTimeout = 1000;
    await new Promise((accept, reject) => {
      const failed = error => { server.off('listening', ready); reject(error); };
      const ready = () => { server.off('error', failed); accept(); };
      server.once('error', failed); server.once('listening', ready); server.listen(port, '127.0.0.1');
    });
    origin = new URL('http://127.0.0.1:' + server.address().port).origin;
    const service = { server, client, directory: client.directory, url: origin + '/mcp', tokenFile, bearerToken,
      close() {
        if (closePromise) return closePromise;
        owner.beginClose();
        closePromise = (async () => {
          const stopped = new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
          server.closeIdleConnections?.(); server.closeAllConnections?.();
          const failures = [];
          await stopped.catch(error => failures.push(error));
          while (requests.size) await Promise.allSettled([...requests]);
          try { await owner.drain(); } catch (error) { failures.push(error); }
          if (failures.length) throw new AggregateError(failures, 'The original Ruby HTTP service could not close completely.');
        })();
        return closePromise;
      },
    };
    return service;
  } catch (error) {
    if (server?.listening) await new Promise(resolve => server.close(() => resolve()));
    await client.close().catch(() => {});
    throw error;
  }
}

const HELP = 'Ruby runtime MCP\n\n' +
  '  ruby-runtime-mcp stdio --directory PRIVATE_RUNTIME [--create]\n' +
  '  ruby-runtime-mcp serve --directory PRIVATE_RUNTIME [--create] [--port 8476]\n' +
  '       [--token-file PRIVATE_JSON] [--startup-json]\n\n' +
  'stdio uses the existing installed mcp runtime profile. HTTP uses the maintained authenticated single-response transport.\n' +
  'The same directory keeps the original environments, customer selections, native jobs and received applications.\n';
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) { process.stdout.write(HELP); return; }
  const [command, ...args] = argv;
  need(['stdio','serve'].includes(command), 'RUBY_MCP_COMMAND', HELP);
  const options = {}; let startup = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--create') { need(options.create === undefined, 'RUBY_MCP_ARGUMENT', 'Duplicate --create.'); options.create = true; }
    else if (flag === '--startup-json') { need(!startup && command === 'serve', 'RUBY_MCP_ARGUMENT', 'Startup JSON is for the HTTP server.'); startup = true; }
    else {
      const names = { '--directory': 'directory', '--port': 'port', '--token-file': 'tokenFile' }, key = names[flag];
      need(key && typeof args[index + 1] === 'string' && options[key] === undefined,
        'RUBY_MCP_ARGUMENT', 'Use the original command flags exactly once.\n' + HELP);
      const value = args[++index];
      if (key === 'port') {
        need(command === 'serve' && /^(?:0|[1-9][0-9]*)$/.test(value), 'RUBY_MCP_PORT', 'Select an integer HTTP port.');
        options.port = Number(value);
      } else {
        need(key !== 'tokenFile' || command === 'serve', 'RUBY_MCP_ARGUMENT', 'A token file belongs to the HTTP listener.');
        options[key] = absolute(value);
      }
    }
  }
  need(options.directory, 'RUBY_MCP_DIRECTORY', 'Select the original absolute private runtime directory.');
  let service, stopping = false, done, resolveSignal;
  const signalled = new Promise(resolve => { resolveSignal = resolve; });
  const stop = () => { stopping = true; resolveSignal(); if (service) service.close().catch(outputError); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    service = command === 'stdio' ? await serveRubyStdio(options) : await serveRubyHttp(options);
    if (stopping) await service.close();
    if (command === 'serve') {
      const report = { schema: 'stellar-forge.ruby-mcp-startup.v1', status: 'RUBY_MCP_READY',
        directory: service.directory, url: service.url, tokenFile: service.tokenFile };
      if (startup) process.stdout.write(JSON.stringify(report) + '\n');
      else process.stderr.write('Ruby MCP: ' + service.url + '\nToken file: ' + service.tokenFile + '\n');
      const broken = new Promise((_, reject) => { service.server.once('error', reject); });
      done = Promise.race([signalled, broken]);
    } else done = Promise.race([service.done, signalled]);
    await done;
  } finally {
    try { if (service) await service.close(); }
    finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => { outputError(error); process.exitCode = 1; });
