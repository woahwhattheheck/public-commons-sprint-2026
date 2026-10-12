// MIT. Typed local and connected clients for the same original Ruby workspace.
import { openRubyCustomerWorkspace } from '../customer/model.mjs';
import { openRubyTransfers } from './transfers.mjs';
import { downloadRubyFile, uploadRubyArchive, waitForRubyOperation, waitForRubyCustomer } from './receiving.mjs';
import { RUBY_TOOLS, CLIENT_SCHEMA, RESULT_SCHEMA, MAX_INLINE_BYTES, MAX_RESULT_BYTES,
  connectedError, need, validateCall, toolForName, errorView } from './protocol.mjs';
import { createHash } from 'node:crypto';

function body(input) {
  try { return JSON.parse(JSON.stringify(input ?? {})); }
  catch { throw connectedError('RUBY_CONNECTED_JSON', 'Use a complete JSON input for the original selected operation.'); }
}
function facade({ directory, dispatch, shutdown, retainResult }) {
  const pending = new Set();
  let closing = false, closePromise = null;
  function owned(fn) {
    need(!closing, 'RUBY_CONNECTED_CLOSED', 'This Ruby client is closing. Reopen the same workspace to continue.', 409);
    const work = Promise.resolve().then(fn);
    pending.add(work);
    work.finally(() => pending.delete(work)).catch(() => {});
    return work;
  }
  async function call(method, input, options) {
    input = body(input); validateCall(method, input);
    return dispatch(method, input, options);
  }
  // An admitted multi-call receiving operation finishes through this private
  // facade even if its owner requests close while it is in progress.
  const admitted = { call };
  for (const tool of RUBY_TOOLS) admitted[tool.method] = (input, options) => call(tool.method, input, options);
  const client = {
    schema: CLIENT_SCHEMA, directory,
    tools: () => RUBY_TOOLS.map(({ method, ...tool }) => body(tool)),
    call(method, input, options) {
      const selected = body(input); validateCall(method, selected);
      return owned(() => dispatch(method, selected, options));
    },
    downloadFile(input) {
      const { signal, ...selected } = input ?? {};
      return owned(() => downloadRubyFile(admitted, { ...body(selected), signal }));
    },
    uploadFile(input) {
      const { signal, ...selected } = input ?? {};
      return owned(() => uploadRubyArchive(admitted, { ...body(selected), signal }));
    },
    waitOperation(input) {
      const { signal, ...selected } = input ?? {};
      return owned(() => waitForRubyOperation(admitted, { ...body(selected), signal }));
    },
    waitCustomer(input) {
      const { signal, ...selected } = input ?? {};
      return owned(() => waitForRubyCustomer(admitted, { ...body(selected), signal }));
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        await Promise.allSettled([...pending]);
        await shutdown();
      })();
      return closePromise;
    },
  };
  for (const tool of RUBY_TOOLS) client[tool.method] = (input, options) => client.call(tool.method, input, options);
  if (retainResult) client.retainResult = value => owned(() => retainResult(value));
  return Object.freeze(client);
}

export async function openRubyConnectedClient({ directory, create = false } = {}) {
  const runtime = await openRubyCustomerWorkspace({ directory, create });
  let transfers;
  try {
    transfers = await openRubyTransfers({ runtime });
    return facade({
      directory: runtime.directory,
      async dispatch(method, input) {
        const owner = typeof transfers[method] === 'function' ? transfers : runtime;
        need(typeof owner[method] === 'function', 'RUBY_CONNECTED_SOURCE_INCOMPLETE',
          'Install the complete customer and connected Ruby source from the same release.', 409);
        return owner[method](input);
      },
      retainResult: value => transfers.retainResult(value),
      async shutdown() {
        const failures = [];
        try { await transfers.close(); } catch (error) { failures.push(error); }
        try { await runtime.close(); } catch (error) { failures.push(error); }
        if (failures.length) throw new AggregateError(failures, 'The Ruby client could not close all of its owned handles.');
      },
    });
  } catch (error) {
    if (transfers) await transfers.close().catch(() => {});
    await runtime.close().catch(() => {});
    throw error;
  }
}

/** Reuse the existing installed mcp dependency profile (@modelcontextprotocol/sdk 1.32.1). */
export async function connectRubyRuntime(options = {}) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const timeout = options.timeoutMs ?? 15 * 60 * 1000;
  need(Number.isSafeInteger(timeout) && timeout >= 1000 && timeout <= 24 * 60 * 60 * 1000,
    'RUBY_CONNECTED_TIMEOUT', 'Use a connection timeout between one second and one day.');
  let transport;
  if (options.url !== undefined) {
    need(options.command === undefined && options.args === undefined && options.env === undefined,
      'RUBY_CONNECTED_TRANSPORT', 'Select one original stdio command or HTTP endpoint.');
    const url = new URL(options.url);
    need(!url.username && !url.password && !url.hash &&
      (url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)),
      'RUBY_CONNECTED_URL', 'Use the original HTTPS endpoint or loopback HTTP endpoint.');
    need(typeof options.bearerToken === 'string' && options.bearerToken.length >= 24 &&
      !/[\r\n]/.test(options.bearerToken), 'RUBY_CONNECTED_TOKEN', 'Load the original private MCP bearer token.');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: 'Bearer ' + options.bearerToken }, redirect: 'error' },
    });
  } else {
    need(typeof options.command === 'string' && options.command.length > 0 && !options.command.includes('\0') &&
      (options.args === undefined || Array.isArray(options.args) && options.args.every(value => typeof value === 'string' && !value.includes('\0'))),
      'RUBY_CONNECTED_COMMAND', 'Select the installed original command and literal argument list.');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    transport = new StdioClientTransport({
      command: options.command, args: options.args ?? [],
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      stderr: options.stderr ?? 'inherit',
    });
  }
  const remote = new Client({ name: 'starforge-ruby-connected-client', version: '0.1.0' });
  try {
    await remote.connect(transport, { timeout });
    const info = remote.getServerVersion();
    need(info?.name === 'starforge-ruby-runtime', 'RUBY_CONNECTED_SERVER',
      'Connect this client to the installed Starforge Ruby runtime server.', 409);
    const catalog = await remote.listTools({}, { timeout });
    const names = new Set(catalog.tools.map(tool => tool.name));
    const missing = RUBY_TOOLS.filter(tool => !names.has(tool.name)).map(tool => tool.name);
    need(!missing.length, 'RUBY_CONNECTED_SOURCE_INCOMPLETE',
      'Install the full connected customer release on this original server.', 409, { missingTools: missing });
    async function rawCall(method, input, callOptions = {}) {
      const definition = validateCall(method, input);
      const response = await remote.callTool({ name: definition.name, arguments: input }, undefined, {
        timeout: callOptions.timeoutMs ?? timeout,
        ...(callOptions.signal ? { signal: callOptions.signal } : {}),
      });
      let result = response.structuredContent;
      if (result === undefined) {
        const blocks = response.content.filter(value => value.type === 'text');
        need(blocks.length === 1, 'RUBY_CONNECTED_RESPONSE', 'The original server returned an incomplete tool response.', 502);
        try { result = JSON.parse(blocks[0].text); }
        catch { throw connectedError('RUBY_CONNECTED_RESPONSE', 'The original tool response is not complete JSON.', 502); }
      }
      if (response.isError) throw connectedError(result.code ?? 'RUBY_CONNECTED_REMOTE',
        result.message ?? result.reason ?? 'The original Ruby operation failed.', result.status ?? 500, result.details);
      return result;
    }
    async function dispatch(method, input, callOptions) {
      const result = await rawCall(method, input, callOptions);
      if (result?.schema !== RESULT_SCHEMA) return result;
      const file = result.file;
      need(file && file.bytes <= MAX_RESULT_BYTES && file.type === 'application/json' &&
        /^[a-f0-9]{64}$/.test(file.sha256), 'RUBY_CONNECTED_RESULT', 'The original retained result descriptor is invalid.', 502);
      const parts = [], hash = createHash('sha256'); let offset = 0;
      try {
        while (offset < file.bytes) {
          const part = await rawCall('readTransfer', { transferId: file.transferId, offset, limit: 1024 * 1024 }, callOptions);
          const bytes = Buffer.from(part.data, 'base64');
          need(part.offset === offset && part.bytes === bytes.length && bytes.length > 0 &&
            part.nextOffset === offset + bytes.length && part.totalBytes === file.bytes &&
            part.fileSha256 === file.sha256 && part.encoding === 'base64' && bytes.toString('base64') === part.data &&
            createHash('sha256').update(bytes).digest('hex') === part.sha256,
            'RUBY_CONNECTED_RESULT_CHANGED', 'The retained complete result differs from its original selected bytes.', 502);
          offset = part.nextOffset; parts.push(bytes); hash.update(bytes);
        }
        need(offset === file.bytes && hash.digest('hex') === file.sha256,
          'RUBY_CONNECTED_RESULT_CHANGED', 'The complete original result SHA does not match.', 502);
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts, offset)));
      } finally { await rawCall('closeTransfer', { transferId: file.transferId }, callOptions).catch(() => {}); }
    }
    return facade({ dispatch, shutdown: () => remote.close() });
  } catch (error) {
    await remote.close().catch(() => {});
    await transport.close().catch(() => {});
    throw error;
  }
}

export function rubyMcpProvider(client) {
  need(client?.schema === CLIENT_SCHEMA && typeof client.retainResult === 'function',
    'RUBY_CONNECTED_PROVIDER', 'Open the local connected Ruby client for this MCP provider.');
  return {
    tools: client.tools(),
    async call(name, input) {
      const tool = toolForName(name);
      validateCall(tool.method, input);
      const result = await client.call(tool.method, input);
      // File chunks remain direct. Wrapping a download chunk would recurse
      // into another download and unnecessarily duplicate original bytes.
      if (tool.method === 'readTransfer' || Buffer.byteLength(JSON.stringify(result)) <= MAX_INLINE_BYTES) return result;
      return { schema: RESULT_SCHEMA, method: tool.method, file: await client.retainResult(result) };
    },
  };
}
export { errorView };
