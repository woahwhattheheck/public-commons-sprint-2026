#!/usr/bin/env node
// MIT. Original workspace transfer CLI; complete files use bounded native transport.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, fail } from '../common.mjs';
import { createGrpcTransferClient } from './client.mjs';
import { transferDirectory, transferRead, transferJson, transferWrite } from './files.mjs';
import { inspectGrpcWorkspaceArchive, receiveGrpcWorkspaceArchive } from './receiving.mjs';
import { GRPC_TRANSFER_MANIFEST_BYTES } from './manifest.mjs';

const HELP = 'grpc-transfer <capture|list|read|files|download|upload|upload-status|inspect|receive|receipt|open|close|cancel|archive-inspect|archive-receive> [options]\n' +
  '  --connection FILE     Original private loopback connection file; never a capability in argv.\n' +
  '  --workspace DIR       Capture/read/list/files through the original closed native workspace instead.\n' +
  '  --input FILE          Exact retained JSON request; repeated operations keep the same id and bytes.\n' +
  '  --id UUID             Stable capture, upload or receiving operation id.\n' +
  '  --binding FILE        Exact expected workspace binding JSON, optionally {binding: ...}.\n' +
  '  --max-bytes N         Capture byte budget (default 8 GiB; maximum 64 GiB).\n' +
  '  --kind VALUE          List captures/receipts, or select workspace/health-prefix/observation files.\n' +
  '  --offset N --limit N --snapshot SHA --search TEXT\n' +
  '  --archive-kind capture|upload --archive-id UUID\n' +
  '  --archive FILE        Local archive for upload, archive-inspect or archive-receive.\n' +
  '  --directory DIR       Private download folder or explicit new receiving workspace.\n' +
  '  --sha256 SHA --bytes N --manifest-sha256 SHA\n' +
  '  --output FILE         Save complete private result. Required for open; contains its new capability.\n' +
  'Archive receiving validates the complete original state and closes its native writer. Open explicitly starts the received editor.\n';
const COMMANDS = new Set(['capture', 'list', 'read', 'files', 'download', 'upload', 'upload-status', 'inspect',
  'receive', 'receipt', 'open', 'close', 'cancel', 'archive-inspect', 'archive-receive']);
const FLAGS = new Set(['connection', 'workspace', 'input', 'id', 'binding', 'max-bytes', 'kind', 'offset', 'limit',
  'snapshot', 'search', 'archive-kind', 'archive-id', 'archive', 'directory', 'sha256', 'bytes',
  'manifest-sha256', 'output']);
function argumentsFor(argv) {
  if (!argv.length || argv.includes('--help') || argv[0] === 'help') return null;
  const command = argv[0], options = {};
  if (!COMMANDS.has(command)) fail('GRPC_TRANSFER_CLI_COMMAND_INVALID');
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i]?.startsWith('--') ? argv[i].slice(2) : '';
    if (!FLAGS.has(key) || options[key] !== undefined || argv[i + 1] === undefined)
      fail('GRPC_TRANSFER_CLI_ARGUMENT_INVALID');
    options[key] = argv[i + 1];
  }
  return { command, options };
}
function integer(text) {
  if (!/^(0|[1-9][0-9]*)$/.test(text)) fail('GRPC_TRANSFER_CLI_INTEGER_REQUIRED');
  const value = Number(text); if (!Number.isSafeInteger(value)) fail('GRPC_TRANSFER_CLI_INTEGER_REQUIRED');
  return value;
}
function put(body, name, value) {
  if (value === undefined) return;
  if (body[name] !== undefined && canonical(body[name]) !== canonical(value)) fail('GRPC_TRANSFER_CLI_INPUT_CONFLICT');
  body[name] = value;
}
async function inputFor(command, options) {
  const body = options.input ? await transferJson(resolve(options.input), 2097152) : {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('GRPC_TRANSFER_CLI_INPUT_REQUIRED');
  put(body, 'id', options.id);
  for (const [flag, name] of [['max-bytes', 'maxBytes'], ['offset', 'offset'], ['limit', 'limit'],
    ['bytes', 'expectedBytes']]) if (options[flag] !== undefined) put(body, name, integer(options[flag]));
  for (const [flag, name] of [['kind', 'kind'], ['snapshot', 'expectedSnapshot'], ['search', 'search'],
    ['sha256', 'expectedSha256'], ['manifest-sha256', 'expectedManifestSha256']])
    put(body, name, options[flag]);
  if (options.directory) put(body, 'directory', resolve(options.directory));
  if (options.binding) {
    const value = await transferJson(resolve(options.binding), 131072);
    put(body, 'expectedBinding', value?.binding ?? value);
  }
  if (options['archive-kind'] !== undefined || options['archive-id'] !== undefined)
    put(body, 'archive', { kind: options['archive-kind'], id: options['archive-id'] });
  if (options.archive) put(body, command === 'upload' ? 'path' : 'archivePath', resolve(options.archive));
  if (command === 'archive-receive') { body.operationId = body.id ?? body.operationId; delete body.id; }
  return body;
}
async function connection(file) {
  if (!file) fail('GRPC_TRANSFER_CLI_CONNECTION_REQUIRED');
  const bytes = await transferRead(resolve(file), 65536);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
  let value;
  try { value = JSON.parse(text); } catch { value = text; }
  const url = typeof value === 'string' ? value : value?.url;
  if (typeof url !== 'string') fail('GRPC_TRANSFER_CLI_CONNECTION_REQUIRED');
  return createGrpcTransferClient({ url });
}
function receiptProjection(result) {
  const value = { schema: result?.schema, id: result?.id ?? result?.operationId,
    state: result?.state, directory: result?.directory, archivePath: result?.archivePath,
    sha256: result?.sha256 ?? result?.archive?.sha256, bytes: result?.bytes ?? result?.archive?.bytes,
    manifestSha256: result?.manifestSha256 ?? result?.manifest?.sha256,
    counts: result?.counts ?? result?.manifest?.counts ?? result?.result?.counts };
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
export async function runGrpcTransferCli(argv = process.argv.slice(2), { env = process.env,
  stdout = process.stdout, stderr = process.stderr } = {}) {
  const selected = argumentsFor(argv);
  if (!selected) { stdout.write(HELP); return; }
  const { command, options } = selected, body = await inputFor(command, options);
  if (options.connection && options.workspace) fail('GRPC_TRANSFER_CLI_OWNER_CONFLICT');
  if (command === 'open' && !options.output) fail('GRPC_TRANSFER_CLI_PRIVATE_OUTPUT_REQUIRED');
  const controller = new AbortController(), interrupt = () => controller.abort();
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  let client, model, result, originalIssue;
  const progress = value => stderr.write(JSON.stringify({ phase: command, id: value.id,
    receivedBytes: value.receivedBytes, bytes: value.bytes }) + '\n');
  try {
    if (command === 'archive-inspect') result = await inspectGrpcWorkspaceArchive(body, { signal: controller.signal });
    else if (command === 'archive-receive') result = await receiveGrpcWorkspaceArchive(body, { signal: controller.signal, env });
    else if (options.workspace) {
      if (!['capture', 'read', 'list', 'files', 'receipt'].includes(command)) fail('GRPC_TRANSFER_CLI_ONLINE_ACTION_REQUIRED');
      const { createGrpcWorkspace } = await import('../workspace/model.mjs');
      model = await createGrpcWorkspace({ stateDirectory: resolve(options.workspace), env });
      const method = { capture: 'transferCapture', read: 'transferRead', list: 'transferList',
        files: 'transferFiles', receipt: 'transferReceipt' }[command];
      result = await model[method](body, { signal: controller.signal });
    } else {
      client = await connection(options.connection);
      if (command === 'upload') result = await client.uploadFile(body, { signal: controller.signal, progress });
      else if (command === 'download') result = await client.downloadTo(body, { signal: controller.signal, progress });
      else result = await client.request(command, body, { signal: controller.signal });
    }
    if (options.output) {
      const path = resolve(options.output);
      if (options.input && path === resolve(options.input) || options.connection && path === resolve(options.connection) ||
        options.archive && path === resolve(options.archive)) fail('GRPC_TRANSFER_CLI_OUTPUT_CONFLICT');
      await transferDirectory(dirname(path), true);
      await transferWrite(path, result, { cap: GRPC_TRANSFER_MANIFEST_BYTES + 262144 });
      stdout.write(JSON.stringify({ ...receiptProjection(result), output: path }) + '\n');
    } else stdout.write(JSON.stringify(result) + '\n');
  } catch (issue) { originalIssue = issue; }
  const closing = await Promise.allSettled([client?.close(), model?.close()]);
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  const issues = [originalIssue, ...closing.filter(row => row.status === 'rejected').map(row => row.reason)].filter(Boolean);
  if (issues.length) throw issues.length === 1 ? issues[0] : Object.assign(new AggregateError(issues,
    'GRPC_TRANSFER_CLI_CLOSE_FAILED'), { code: 'GRPC_TRANSFER_CLI_CLOSE_FAILED' });
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runGrpcTransferCli().catch(issue => {
    const code = /^[A-Z][A-Z0-9_]+$/.test(issue?.code ?? '') ? issue.code : 'GRPC_TRANSFER_CLI_FAILED';
    process.stderr.write(JSON.stringify({ error: code }) + '\n'); process.exitCode = 1;
  });
}
