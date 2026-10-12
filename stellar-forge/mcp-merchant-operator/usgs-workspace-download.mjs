#!/usr/bin/env node
// MIT. Maintained merchant transport and original Water customer receiving.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRetainedDownload, openMerchantFileClient } from './retained-download.mjs';
import { USGS_DELIVERY_MANIFEST, USGS_MAX_HANDOVER_BYTES, parseUSGSDeliveryManifest } from './usgs-delivery.mjs';
import { openUSGSHandoverStream } from './usgs-handover-stream.mjs';

const fail = (code, message) => Object.assign(new Error(message), { code: 'USGS_' + code });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const validSha = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const MAX_REQUEST = 2 * 1024 * 1024;

/** Hashing an original multi-GiB handover may take longer than an ordinary chunk. */
async function connect(options) {
  const client = await openMerchantFileClient(options);
  return { ...client, call(name, args, requestOptions = {}) {
    const firstFile = name === 'merchant_usgs_delivery_file' && !args.readId;
    return client.call(name, args, { ...(firstFile ? { timeoutMs: 30 * 60 * 1000 } : {}), ...requestOptions });
  } };
}
const receiver = createRetainedDownload({
  manifestName: USGS_DELIVERY_MANIFEST,
  parseManifest: parseUSGSDeliveryManifest,
  maximumBytes: USGS_MAX_HANDOVER_BYTES,
  stateSchema: 'stellar-forge.usgs-customer-download-state.v1',
  resultSchema: 'stellar-forge.usgs-customer-download.v1',
  toolPrefix: 'merchant_usgs_delivery',
  errorPrefix: 'USGS',
  clientName: 'starforge-usgs-customer',
  describe: manifest => ({ workspace: manifest.workspace, dssId: manifest.dssId,
    nativeExportSha256: manifest.nativeExportSha256, source: manifest.source }),
  connect,
});
export const inspectUSGSCustomer = receiver.inspect;
export const downloadUSGSCustomer = receiver.download;

async function projectDirectory(value, download) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw fail('RECEIVE_CONFIGURATION', 'Choose a private original Water project directory.');
  const root = resolve(value);
  if (root === '/' || root === download || root.startsWith(download + sep))
    throw fail('RECEIVE_CONFIGURATION', 'Place the original Water project outside this retained download directory.');
  await mkdir(root, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32' && (info.mode & 0o077) || await realpath(root) !== root)
    throw fail('RECEIVE_PRIVATE_DIRECTORY_REQUIRED', 'Use a canonical private original project directory (0700).');
  return root;
}

/** Receive the completed original package; optional verification reads the native DSS. */
export async function receiveUSGSCustomer({ directory, projectDirectory: destination, exportId,
  expectedManifestSha256, verify = false, signal } = {}) {
  if (!validSha(expectedManifestSha256) || typeof verify !== 'boolean')
    throw fail('RECEIVE_CONFIGURATION', 'Select the reviewed completion manifest SHA256 and an explicit verification choice.');
  signal?.throwIfAborted();
  return receiver.lockedDownload(directory, async context => {
    const manifestBytes = await receiver.bytesAt(join(context.root, USGS_DELIVERY_MANIFEST), 65000);
    if (hash(manifestBytes) !== expectedManifestSha256)
      throw fail('RECEIVE_MANIFEST_CHANGED', 'The downloaded completion manifest differs from the selected original handover.');
    await receiver.loadContext(context, manifestBytes, exportId);
    const manifest = context.manifest, file = manifest.files[0], saved = context.state.files[file.name];
    if (!saved?.complete || saved.bytes !== file.bytes || saved.sha256 !== file.sha256)
      throw fail('RECEIVE_DOWNLOAD_INCOMPLETE', 'Resume the same original download directory until its complete file is retained.');
    const root = await projectDirectory(destination, context.root);
    const { openWaterProject } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/project.mjs');
    const project = await openWaterProject(root);
    const close = () => { project.close().catch(() => {}); };
    signal?.addEventListener('abort', close, { once: true });
    let selected;
    try {
      signal?.throwIfAborted(); context.lease.assertHeld();
      selected = await openUSGSHandoverStream(join(context.root, file.name), {
        sha256: file.sha256, bytes: file.bytes, signal });
      const received = await project.receiveDssUpload(selected.stream, { expectedIdentity: {
        exportId: manifest.dssId, exportSha256: manifest.nativeExportSha256,
        editionId: manifest.source.editionId, captureSha256: manifest.source.captureSha256,
        planSha256: manifest.planSha256 } });
      if (received.exportId !== manifest.dssId || received.exportSha256 !== manifest.nativeExportSha256 ||
          received.source?.editionId !== manifest.source.editionId || received.source?.captureSha256 !== manifest.source.captureSha256)
        throw fail('RECEIVE_IDENTITY_CHANGED', 'The original receiver returned a different native export or source identity.');
      signal?.throwIfAborted();
      const nativeVerification = verify ? await project.verifyDssExport(manifest.dssId) : null;
      return { schema: 'stellar-forge.usgs-customer-receiving.v1', state: 'COMPLETE',
        projectDirectory: root, exportId, dssId: manifest.dssId, manifestSha256: expectedManifestSha256,
        handoverSha256: file.sha256, native: received, nativeVerification,
        reopen: { command: 'usgs-water', arguments: ['serve', '--project', root, '--port', '0'] } };
    } finally {
      signal?.removeEventListener('abort', close);
      const closed = await Promise.allSettled([selected?.close(), project.close()]);
      const failed = closed.find(value => value.status === 'rejected');
      if (failed) throw failed.reason;
    }
  });
}

const HELP = [
  'Stellar Forge / USGS agent operations and complete customer receiving', '',
  'merchant-mcp init-usgs-workspaces --dir NEW_MCP_DIR --connection PRIVATE_CONNECTION.json',
  'merchant-mcp serve --config NEW_MCP_DIR/merchant-mcp.json --port 3211',
  '',
  'merchant-usgs tools',
  'merchant-usgs call --url MCP_URL --tool merchant_usgs_TOOL --arguments PRIVATE.json',
  'merchant-usgs inspect --url MCP_URL --export-id DELIVERY_ID',
  'merchant-usgs download --url MCP_URL --export-id DELIVERY_ID --out PRIVATE_DIRECTORY',
  '  [--manifest-sha SHA256 --chunk-bytes 196608 --token-env MCP_ACCESS_TOKEN]',
  'merchant-usgs receive --dir COMPLETE_DOWNLOAD --project PRIVATE_WATER_PROJECT',
  '  --export-id DELIVERY_ID --manifest-sha SHA256 [--verify]',
  'merchant-usgs serve --project PRIVATE_WATER_PROJECT [--port 0]',
  '',
  'The same commands are available through merchant-mcp usgs ...',
  'inspect and call accept --token-env; tools, call, inspect and receive accept --out FILE.',
  'Every saved output file is created privately and existing files are preserved.',
  'call selects exactly one declared merchant_usgs tool; arguments come from a private JSON file.',
  'Download repeats resume the same manifest, bytes and directory after a lost response or host restart.',
  'Receive uses the original Water project receiver, source edition and DSS export IDs.',
  'An unchanged received package reopens its original export. Native verification requires the',
  'configured official interpreter, selected by USGS_HECDSS_PYTHON on the local receiving host.',
  'serve opens the original Water console; Ctrl-C closes its original jobs and native resources.',
  '',
].join('\n');

function options(argv, allowed, flags = []) {
  const values = new Map();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!allowed.includes(key) && !flags.includes(key) || values.has(key))
      throw fail('CLI_CONFIGURATION', 'Use each declared command option once.');
    if (flags.includes(key)) values.set(key, true);
    else {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw fail('CLI_CONFIGURATION', 'Supply a value for ' + key + '.');
      values.set(key, argv[++i]);
    }
  }
  return values;
}
function requireOptions(values, names) {
  for (const name of names) if (!values.has(name)) throw fail('CLI_CONFIGURATION', 'Supply ' + name + '.');
}
async function argumentsFile(path) {
  const file = await open(resolve(path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > MAX_REQUEST || process.platform !== 'win32' && info.mode & 0o077)
      throw fail('CLI_CONFIGURATION', 'Use a private regular arguments file within the original 2 MiB request limit.');
    const bytes = await file.readFile();
    if (bytes.length > MAX_REQUEST) throw fail('CLI_CONFIGURATION', 'The native arguments file exceeds 2 MiB.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await file.close(); }
}
async function output(value, path) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  if (!path) { process.stdout.write(bytes); return value; }
  const file = await open(resolve(path), 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  process.stdout.write(JSON.stringify({ output: resolve(path), bytes: bytes.length }) + '\n');
  return value;
}
export async function main(argv = process.argv.slice(2)) {
  const [command = 'help', ...rest] = argv;
  if (['help', '--help', '-h'].includes(command)) { process.stdout.write(HELP); return; }
  if (command === 'serve') {
    const args = options(rest, ['--project','--port']); requireOptions(args, ['--project']);
    return (await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/cli.mjs')).main([
      'serve', '--project', args.get('--project'), '--port', args.get('--port') ?? '0']);
  }
  const { usgsWorkspaceTools } = await import('./usgs-workspace.mjs');
  const tools = usgsWorkspaceTools((name, description, properties, required) => ({
    name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } }));
  if (command === 'tools') {
    const args = options(rest, ['--out']);
    return output({ tools }, args.get('--out'));
  }
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (command === 'receive') {
      const args = options(rest, ['--dir','--project','--export-id','--manifest-sha','--out'], ['--verify']);
      requireOptions(args, ['--dir','--project','--export-id','--manifest-sha']);
      return output(await receiveUSGSCustomer({ directory: args.get('--dir'), projectDirectory: args.get('--project'),
        exportId: args.get('--export-id'), expectedManifestSha256: args.get('--manifest-sha'),
        verify: args.has('--verify'), signal: controller.signal }), args.get('--out'));
    }
    if (!['call','inspect','download'].includes(command)) throw fail('CLI_CONFIGURATION', 'Choose tools, call, inspect, download, receive or serve.');
    const args = options(rest, ['--url','--token-env','--out', ...(command === 'call' ? ['--tool','--arguments']
      : ['--export-id', ...(command === 'download' ? ['--manifest-sha','--chunk-bytes'] : [])])]);
    requireOptions(args, ['--url', ...(command === 'call' ? ['--tool','--arguments'] : ['--export-id']),
      ...(command === 'download' ? ['--out'] : [])]);
    const common = { url: args.get('--url'), tokenEnv: args.get('--token-env') ?? 'MCP_ACCESS_TOKEN', signal: controller.signal };
    if (command === 'call') {
      const name = args.get('--tool');
      if (!tools.some(tool => tool.name === name)) throw fail('CLI_CONFIGURATION', 'Select one declared merchant_usgs tool from tools.');
      const client = await openMerchantFileClient({ ...common, errorPrefix: 'USGS', clientName: 'starforge-usgs-operations' });
      return output(await client.call(name, await argumentsFile(args.get('--arguments')), { timeoutMs: 30 * 60 * 1000 }), args.get('--out'));
    }
    if (command === 'inspect') return output(await inspectUSGSCustomer({ ...common, exportId: args.get('--export-id') }), args.get('--out'));
    const size = args.get('--chunk-bytes');
    if (size !== undefined && !/^[1-9][0-9]*$/.test(size)) throw fail('CLI_CONFIGURATION', 'Choose a positive decimal chunk size.');
    const result = await downloadUSGSCustomer({ ...common, exportId: args.get('--export-id'), directory: args.get('--out'),
      expectedManifestSha256: args.get('--manifest-sha'), ...(size === undefined ? {} : { chunkSize: Number(size) }),
      onProgress: progress => process.stderr.write(JSON.stringify(progress) + '\n') });
    return output(result);
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => { process.stderr.write((error.code ?? 'USGS_OPERATION_FAILED') + ': ' + error.message + '\n'); process.exitCode = 1; });
