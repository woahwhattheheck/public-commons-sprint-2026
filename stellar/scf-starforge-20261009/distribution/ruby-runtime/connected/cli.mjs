#!/usr/bin/env node
// MIT. Full connected Ruby operations and complete private receiving from the installed CLI.
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openRubyConnectedClient, connectRubyRuntime } from './client.mjs';
import { RUBY_TOOLS, need, errorView } from './protocol.mjs';
import { absolute, readJSON, saveJSON } from '../files.mjs';

const MCP = fileURLToPath(new URL('./mcp.mjs', import.meta.url));
const HELP = 'Ruby runtime agent client\n\n' +
  '  ruby-runtime-agent tools\n' +
  '  ruby-runtime-agent config --directory PRIVATE_RUNTIME [--create] [--output JSON_FILE]\n' +
  '  ruby-runtime-agent call METHOD --input ORIGINAL_JSON --directory PRIVATE_RUNTIME [--create]\n' +
  '  ruby-runtime-agent call METHOD --input ORIGINAL_JSON --connection PRIVATE_CONNECTION_JSON\n' +
  '  ruby-runtime-agent download --transfer-id UUID --out NEW_PRIVATE_DIRECTORY\n' +
  '       [--source ORIGINAL_FILE_SELECTOR_JSON] [--sha256 SHA] --directory PRIVATE_RUNTIME\n' +
  '  ruby-runtime-agent upload --archive ORIGINAL_TAR --input ORIGINAL_RECEIVING_JSON --directory PRIVATE_RUNTIME\n' +
  '  ruby-runtime-agent wait --operation-id UUID --directory PRIVATE_RUNTIME\n' +
  '  ruby-runtime-agent commission --id CUSTOMER_ID --selection-sha SHA --directory PRIVATE_RUNTIME\n\n' +
  'Every operating command accepts --connection instead of --directory and --output for its complete JSON result.\n' +
  'The same request/operation/transfer IDs continue original native work and complete saved file receiving.\n';

export function rubyMcpConfiguration({ directory, create = false, command = process.execPath, serverFile = MCP } = {}) {
  absolute(directory); absolute(command); absolute(serverFile);
  return { mcpServers: { 'starforge-ruby': { command,
    args: [serverFile, 'stdio', '--directory', directory, ...(create ? ['--create'] : [])] } } };
}
function options(argv) {
  const result = {};
  const flags = {
    '--directory': 'directory', '--connection': 'connection', '--input': 'input',
    '--output': 'output', '--out': 'out', '--archive': 'archive',
    '--transfer-id': 'transferId', '--source': 'source', '--sha256': 'sha256',
    '--operation-id': 'operationId', '--id': 'id', '--selection-sha': 'selectionSha256',
    '--timeout-ms': 'timeoutMs', '--interval-ms': 'intervalMs',
  };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--create') {
      need(result.create === undefined, 'RUBY_AGENT_ARGUMENT', 'Duplicate --create.');
      result.create = true; continue;
    }
    const key = flags[flag], value = argv[++index];
    need(key && value !== undefined && result[key] === undefined,
      'RUBY_AGENT_ARGUMENT', 'Use each original command flag exactly once.\n' + HELP);
    if (key === 'timeoutMs' || key === 'intervalMs') {
      need(/^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value)),
        'RUBY_AGENT_ARGUMENT', 'Use an integer interval or timeout.');
      result[key] = Number(value);
    } else result[key] = value;
  }
  for (const key of ['directory','connection','input','output','out','archive','source'])
    if (result[key] !== undefined) absolute(result[key]);
  return result;
}
function only(value, allowed) {
  for (const key of Object.keys(value)) need(allowed.includes(key),
    'RUBY_AGENT_ARGUMENT', 'The selected command does not accept --' + key + '.');
}
async function writeResult(value, output) {
  if (output) {
    await saveJSON(absolute(output), value, true);
    process.stdout.write(JSON.stringify({ path: output }) + '\n');
  } else process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}
async function connection(input) {
  need(Boolean(input.directory) !== Boolean(input.connection),
    'RUBY_AGENT_CONNECTION', 'Select one original private runtime directory or saved MCP connection file.');
  if (input.directory) return openRubyConnectedClient({ directory: input.directory, create: input.create ?? false });
  need(!input.create, 'RUBY_AGENT_CONNECTION', 'The original saved remote command owns its directory creation setting.');
  const saved = await readJSON(input.connection);
  need(saved.schema === 'stellar-forge.ruby-connected-configuration.v1' && saved.connection &&
    typeof saved.connection === 'object' && !Array.isArray(saved.connection),
    'RUBY_AGENT_CONNECTION', 'Use a complete saved Ruby connected configuration.');
  return connectRubyRuntime({ ...saved.connection,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }) });
}
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) { process.stdout.write(HELP); return; }
  const [command, ...tail] = argv;
  if (command === 'tools') {
    need(!tail.length, 'RUBY_AGENT_ARGUMENT', 'tools takes no arguments.');
    return writeResult(RUBY_TOOLS.map(({ method, ...tool }) => ({ method, ...tool })));
  }
  const method = command === 'call' ? tail.shift() : null;
  const input = options(tail);
  if (command === 'config') {
    only(input, ['directory','create','output']);
    return writeResult(rubyMcpConfiguration(input), input.output);
  }
  need(['call','download','upload','wait','commission'].includes(command), 'RUBY_AGENT_COMMAND', HELP);
  const common = ['directory','connection','create','output','timeoutMs'];
  const extra = { call: ['input'], download: ['transferId','out','source','sha256'],
    upload: ['archive','input'], wait: ['operationId','intervalMs'], commission: ['id','selectionSha256','intervalMs'] };
  only(input, [...common, ...extra[command]]);
  const abort = new AbortController();
  const stop = () => abort.abort(Object.assign(new Error('The client wait stopped. The original saved operation remains available.'), { code: 'RUBY_AGENT_STOPPED' }));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  let client;
  try {
    client = await connection(input);
    abort.signal.throwIfAborted();
    let result;
    if (command === 'call') {
      need(typeof method === 'string' && input.input, 'RUBY_AGENT_INPUT', 'Select the original method and complete JSON input file.');
      result = await client.call(method, await readJSON(input.input),
        { signal: abort.signal, ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }) });
    } else if (command === 'download') {
      need(input.transferId && input.out, 'RUBY_AGENT_INPUT', 'Select the retained transfer ID and original private receiving directory.');
      result = await client.downloadFile({ transferId: input.transferId, directory: input.out,
        ...(input.source ? { source: await readJSON(input.source) } : {}),
        ...(input.sha256 ? { expectedSha256: input.sha256 } : {}), signal: abort.signal });
    } else if (command === 'upload') {
      need(input.archive && input.input, 'RUBY_AGENT_INPUT', 'Select the complete original TAR and retained receiving JSON.');
      result = await client.uploadFile({ ...(await readJSON(input.input)), archive: input.archive, signal: abort.signal });
    } else {
      const timing = { ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        ...(input.intervalMs === undefined ? {} : { intervalMs: input.intervalMs }), signal: abort.signal };
      result = command === 'wait'
        ? await client.waitOperation({ operationId: input.operationId, ...timing })
        : await client.waitCustomer({ id: input.id, expectedSelectionSha256: input.selectionSha256, ...timing });
    }
    await writeResult(result, input.output);
  } finally {
    try { if (client) await client.close(); }
    finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => { process.stderr.write(JSON.stringify(errorView(error)) + '\n'); process.exitCode = 1; });
