#!/usr/bin/env node
// MIT. Full operator commands for the original WebDAV merchant and retained receiver.
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writePrivate, privateSupportDirectory } from './host-files.mjs';
import { createWebDavWorkspaceClient, WEBDAV_TOOL_CONTRACTS } from './webdav-workspace-client.mjs';
import { prepareWebDavMerchantHost, readWebDavWorkspaceConfiguration } from './webdav-workspace-setup.mjs';
import { prepareWebDavOperation, inspectWebDavOperation, reconcileWebDavOperation, runWebDavOperation } from './webdav-workspace-receiving.mjs';
import { prepareWebDavReceiving, downloadWebDavReceiving, inspectWebDavReceiving, restoreWebDavSourcePacket } from './webdav-workspace-download.mjs';
import { webDavError, webDavJsonBytes, webDavHash, WEBDAV_MAX_MANIFEST_BYTES } from './webdav-workspace-contracts.mjs';

const HELP = String.raw`Starforge WebDAV remote operator and complete receiving

  merchant-webdav tools
  merchant-webdav check-connection --connection PRIVATE_JSON
  merchant-webdav setup --directory NEW_PRIVATE_HOST --connection PRIVATE_JSON
      [--name LABEL --host-name NAME --merge PRIVATE_HOST_JSON --output NEW_PRIVATE_JSON]

  merchant-webdav status --url MCP_URL [--workspace ALIAS]
  merchant-webdav open --url MCP_URL --workspace ALIAS
  merchant-webdav close --url MCP_URL --workspace ALIAS --instance-id ORIGINAL_UUID
  merchant-webdav call --url MCP_URL --tool merchant_webdav_NAME --input PRIVATE_JSON
  merchant-webdav history --url MCP_URL --workspace ALIAS [--offset 0 --limit 50]
  merchant-webdav listings --url MCP_URL --workspace ALIAS --source-id UUID --id UUID
      [--offset 0 --limit 100]
  merchant-webdav cancel --url MCP_URL --workspace ALIAS --operation-id UUID

  merchant-webdav prepare --url MCP_URL --tool merchant_webdav_NAME
      --input PRIVATE_JSON --directory NEW_PRIVATE_OPERATION
  merchant-webdav run --url MCP_URL --directory ORIGINAL_OPERATION
      [--resume --reviewed-revision INTEGER]
  merchant-webdav reconcile --url MCP_URL --directory ORIGINAL_OPERATION
  merchant-webdav inspect-operation --directory ORIGINAL_OPERATION

  merchant-webdav plan-export --url MCP_URL --workspace ALIAS --export-id UUID
      --output NEW_PRIVATE_PLAN [--expected-sha256 ORIGINAL_NATIVE_MANIFEST_SHA]
  merchant-webdav plan-files --url MCP_URL --workspace ALIAS --input PRIVATE_SELECTIONS
      --output NEW_PRIVATE_PLAN
  merchant-webdav download --url MCP_URL --plan PRIVATE_PLAN --directory RECEIVING
      [--chunk-bytes 196608 --expected-sha256 REVIEWED_PLAN_SHA]
  merchant-webdav inspect-download --directory RECEIVING [--expected-sha256 REVIEWED_PLAN_SHA]
  merchant-webdav restore-source --directory RECEIVING --file PACKET_MEMBER
      --destination NEW_PRIVATE_WORKSPACE [--python PYTHON --expected-sha256 REVIEWED_PLAN_SHA]

Network commands accept --token-env NAME (default MCP_ACCESS_TOKEN) and
--timeout-ms INTEGER (default120000, up to3600000). Tokens remain in environment
variables. Configure their actual HTTPS or loopback MCP endpoint.

prepare saves an original UUID, exact inputs, workspace UUID, source/merchant
profile and reviewed revision before any mutation. run/reconcile use that same
directory. --resume explicitly continues a retained inactive source operation.
Use the original publisher state and native recovery action after an interrupted
publisher operation. Complete exports include every original declared member.

history and listings print JSON lines, one original page per line. Other
commands print complete JSON. SIGINT/SIGTERM preserve the same saved intent or
download checkpoint. Use cancel to request native operation cancellation.
`;
const NETWORK = ['--url','--token-env','--timeout-ms'];
const allowed = {
  tools: [], 'check-connection': ['--connection'],
  setup: ['--directory','--connection','--name','--host-name','--merge','--output'],
  status: ['--workspace','--offset','--limit'], open: ['--workspace'],
  close: ['--workspace','--instance-id'], call: ['--tool','--input'],
  history: ['--workspace','--offset','--limit'], listings: ['--workspace','--source-id','--id','--offset','--limit'],
  cancel: ['--workspace','--operation-id'], prepare: ['--tool','--input','--directory'],
  run: ['--directory','--resume','--reviewed-revision'], reconcile: ['--directory'],
  'inspect-operation': ['--directory'],
  'plan-export': ['--workspace','--export-id','--output','--expected-sha256'],
  'plan-files': ['--workspace','--input','--output'],
  download: ['--plan','--directory','--chunk-bytes','--expected-sha256'],
  'inspect-download': ['--directory','--expected-sha256'],
  'restore-source': ['--directory','--file','--destination','--python','--expected-sha256']
};
const offline = new Set(['tools','check-connection','setup','inspect-operation','inspect-download','restore-source']);
function parse(argv) {
  const command = argv[0];
  if (!Object.hasOwn(allowed, command)) throw webDavError('WEBDAV_CLI_COMMAND', 'Choose an operator command from --help.');
  const options = Object.create(null), accepted = new Set([...allowed[command], ...(offline.has(command) ? [] : NETWORK)]);
  for (let index = 1; index < argv.length; index++) {
    const key = argv[index];
    if (!accepted.has(key) || Object.hasOwn(options, key)) throw webDavError('WEBDAV_CLI_ARGUMENT', 'Unknown or repeated option: ' + key + '.');
    if (key === '--resume') { options[key] = true; continue; }
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw webDavError('WEBDAV_CLI_ARGUMENT', 'Supply the complete value for ' + key + '.');
    options[key] = value;
  }
  return { command, options };
}
function required(options, key) {
  if (!options[key]) throw webDavError('WEBDAV_CLI_ARGUMENT', key + ' is required.');
  return options[key];
}
function integer(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw webDavError('WEBDAV_CLI_ARGUMENT', 'Use a nonnegative integer without a unit suffix.');
  return Number(value);
}
async function inputBytes(path, maximum = 1024 * 1024) {
  const selected = resolve(path);
  if (await realpath(selected) !== selected) throw webDavError('WEBDAV_CLI_PRIVATE_FILE', 'Choose the canonical private input path.');
  const file = await open(selected, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximum || process.platform !== 'win32' && (stat.mode & 0o077))
      throw webDavError('WEBDAV_CLI_PRIVATE_FILE', 'Choose a private regular input file within the declared size limit.');
    const bytes = await file.readFile();
    if (bytes.length > maximum) throw webDavError('WEBDAV_CLI_PRIVATE_FILE', 'The original input grew beyond its size limit.');
    return bytes;
  } finally { await file.close(); }
}
async function inputJson(path, maximum) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await inputBytes(path, maximum))); }
  catch (error) {
    if (error.code) throw error;
    throw webDavError('WEBDAV_CLI_JSON', 'Supply complete UTF-8 JSON in the selected private input file.');
  }
}
async function outputJson(path, value) {
  const file = resolve(path), parent = dirname(file);
  await privateSupportDirectory(parent);
  if (await realpath(parent) !== parent) throw webDavError('WEBDAV_CLI_PRIVATE_FILE', 'Choose a canonical private output parent.');
  const bytes = webDavJsonBytes(value);
  await writePrivate(file, bytes);
  return { path: file, bytes: bytes.length, sha256: webDavHash(bytes) };
}
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.length === 1 && ['--help','-h'].includes(argv[0])) { process.stdout.write(HELP); return; }
  const { command, options: o } = parse(argv);
  const controller = new AbortController();
  const interrupt = () => controller.abort(webDavError('WEBDAV_CLI_INTERRUPTED', 'The original operation or transfer can be reopened from its retained directory.'));
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  try {
    let client, result;
    const timeoutMs = integer(o['--timeout-ms']) ?? 120000;
    if (timeoutMs < 1000 || timeoutMs > 3600000) throw webDavError('WEBDAV_CLI_ARGUMENT', 'Use a request timeout from1000 through3600000 milliseconds.');
    if (!offline.has(command)) client = await createWebDavWorkspaceClient({
      url: required(o, '--url'), tokenEnv: o['--token-env'] ?? 'MCP_ACCESS_TOKEN', signal: controller.signal
    });
    const requestOptions = { requestSignal: controller.signal, timeoutMs };
    const workspace = () => required(o, '--workspace');
    const directory = () => required(o, '--directory');
    if (command === 'tools') result = Object.values(WEBDAV_TOOL_CONTRACTS);
    else if (command === 'check-connection') {
      const configured = await readWebDavWorkspaceConfiguration(required(o, '--connection'));
      result = { state: 'CONFIGURED', workspaces: Object.entries(configured.workspaces).map(([name, value]) => ({
        workspace: name, label: value.label, directory: value.directory,
        sources: Object.keys(value.sourceProfiles), merchants: Object.keys(value.merchantProfiles),
        buyers: Object.keys(value.buyerWorkspaces), packets: Object.keys(value.sourcePackets)
      })) };
    } else if (command === 'setup') {
      result = await prepareWebDavMerchantHost({
        directory: directory(), connection: required(o, '--connection'), name: o['--name'], hostName: o['--host-name'],
        existingConfiguration: o['--merge'] ? await inputJson(o['--merge']) : undefined
      });
      if (o['--output']) result.hostFile = await outputJson(o['--output'], result.hostConfiguration);
    } else if (command === 'status') result = await client.status({
      ...(o['--workspace'] ? { workspace: o['--workspace'] } : {}),
      ...(o['--offset'] ? { offset: integer(o['--offset']) } : {}),
      ...(o['--limit'] ? { limit: integer(o['--limit']) } : {})
    }, requestOptions);
    else if (command === 'open') result = await client.open({ workspace: workspace() }, requestOptions);
    else if (command === 'close') result = await client.close({ workspace: workspace(), instanceId: required(o, '--instance-id') }, requestOptions);
    else if (command === 'call') result = await client.request(required(o, '--tool'), await inputJson(required(o, '--input')), requestOptions);
    else if (command === 'cancel') result = await client.cancel({ workspace: workspace(), operationId: required(o, '--operation-id') }, { requestSignal: null, timeoutMs });
    else if (command === 'history' || command === 'listings') {
      const input = { workspace: workspace(), offset: integer(o['--offset']) ?? 0,
        limit: integer(o['--limit']) ?? (command === 'history' ? 50 : 100) };
      const pages = command === 'history' ? client.historyPages(input, requestOptions)
        : client.listingPages({ ...input, sourceId: required(o, '--source-id'), id: required(o, '--id') }, requestOptions);
      for await (const page of pages) process.stdout.write(JSON.stringify(page) + '\n');
      return;
    } else if (command === 'prepare') result = await prepareWebDavOperation({
      client, directory: directory(), tool: required(o, '--tool'), args: await inputJson(required(o, '--input'))
    }, requestOptions);
    else if (command === 'run') result = await runWebDavOperation({
      client, directory: directory(), resume: o['--resume'] === true, reviewedRevision: integer(o['--reviewed-revision'])
    }, requestOptions);
    else if (command === 'reconcile') result = await reconcileWebDavOperation({ client, directory: directory() }, requestOptions);
    else if (command === 'inspect-operation') result = await inspectWebDavOperation({ directory: directory() });
    else if (command === 'plan-export' || command === 'plan-files') {
      const prepared = await prepareWebDavReceiving({ client, workspace: workspace(),
        ...(command === 'plan-export' ? { exportId: required(o, '--export-id'), expectedManifestSha256: o['--expected-sha256'] }
          : { files: await inputJson(required(o, '--input'), WEBDAV_MAX_MANIFEST_BYTES) })
      }, requestOptions);
      const file = await outputJson(required(o, '--output'), prepared.manifest);
      result = { ...file, receivingId: prepared.manifest.exportId, workspaceId: prepared.manifest.workspaceId,
        files: prepared.manifest.files.length, source: prepared.manifest.source };
    } else if (command === 'download') result = await downloadWebDavReceiving({
      client, manifest: await inputBytes(required(o, '--plan'), WEBDAV_MAX_MANIFEST_BYTES),
      directory: directory(), signal: controller.signal, chunkSize: integer(o['--chunk-bytes']),
      expectedManifestSha256: o['--expected-sha256'],
      onProgress: progress => process.stderr.write(JSON.stringify(progress) + '\n')
    });
    else if (command === 'inspect-download') result = await inspectWebDavReceiving({
      directory: directory(), expectedManifestSha256: o['--expected-sha256'], signal: controller.signal
    });
    else if (command === 'restore-source') result = await restoreWebDavSourcePacket({
      directory: directory(), file: required(o, '--file'), destination: required(o, '--destination'),
      python: o['--python'], expectedManifestSha256: o['--expected-sha256'], signal: controller.signal
    });
    print(result);
    if (command === 'run' && ['FAILED','NATIVE_RECONCILE_REQUIRED','RESUME_AVAILABLE','INSPECT_NATIVE'].includes(result?.state))
      process.exitCode = 2;
    return result;
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: { code: error.code ?? 'WEBDAV_CLI_FAILED', message: error.message },
      ...(error.operation ? { operation: error.operation } : {}),
      ...(error.nativeResult ? { nativeResult: error.nativeResult } : {}),
      ...(error.nativeEnvelope ? { nativeEnvelope: error.nativeEnvelope } : {}),
      ...(error.localLeaseError ? { localLeaseError: error.localLeaseError } : {}),
      ...(error.localSaveError ? { localSaveError: error.localSaveError } : {}) }) + '\n');
    process.exitCode = error.code === 'WEBDAV_CLI_INTERRUPTED' ? 130 : 2;
  });
