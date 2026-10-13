#!/usr/bin/env node
// MIT. Host-declared recovery workspace over the original SF101 commands.
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HELP = 'SF101 recovery workspace\n\n' +
  'starforge merchant-recovery-remote workspace serve --config ABS_HOST_CONFIG --directory ABS_PRIVATE_STATE [--port 8481]\n' +
  'starforge merchant-recovery-remote workspace show --config ABS_HOST_CONFIG --directory ABS_PRIVATE_STATE\n' +
  'starforge merchant-recovery-remote workspace COMMAND --config ABS_HOST_CONFIG --directory ABS_PRIVATE_STATE [OPTIONS]\n\n' +
  'handoff     Export, review and cold-adopt original source/state; handoff --help.\n' +
  'comparison-artifact Read full saved comparison/report: --profile ID --id ID --kind result|html|markdown --sha256 HASH.\n' +
  'bundle-inspection Inspect a declared encrypted archive: --profile ID --archive ID.\n' +
  'bundle-report Read full retained verification/report: --profile ID --id ID [--kind report|verification|publication].\n' +
  'bundle-artifact Read completed ciphertext artifact path/hash: --profile ID --id ID.\n' +
  'bundle-pair Read exact completed comparison exports: --profile ID --before-id ID --after-id ID.\n' +
  'bundle-pair-attach Attach both archives: --profile ID --before-id ID --after-id ID --expected-pair-sha256 HASH --transfer-id ID --expected-support-review HASH --case-revision HASH --actor NAME.\n' +
  'bundle-attach Attach complete archive to saved commissioned case: --profile ID --id ID --transfer-id ID --expected-support-review HASH --case-revision HASH --actor NAME.\n' +
  'bundle-attachment Read original attachment before continuing: --profile ID --transfer-id ID --archive-sha256 HASH or --pair-sha256 HASH.\n' +
  'bundle-case-export Export actual attached case/history/source: --profile ID --transfer-id ID --archive-sha256 HASH or --pair-sha256 HASH.\n' +
  'support-cases List existing cases: --profile ID [--limit N].\n' +
  'support-transfers List saved/prepared transfers: --profile ID.\n' +
  'support-transfer Read the original transfer: --profile ID --transfer-id ID.\n' +
  'support-review Freeze complete recovery/comparison request, artifacts and case selection: --selection ABS_JSON.\n' +
  'support-save Commit that exact review: --profile ID --transfer-id ID --expected-support-review HASH.\n' +
  'support-handoff Read the complete saved Support handoff: --profile ID --transfer-id ID.\n' +
  'support-export Export full case/history/source: --profile ID --transfer-id ID --expected-support-review HASH.\n' +
  'support-package Inspect the existing whole package: --profile ID --transfer-id ID.\n' +
  'serve       Open the retained operator workspace on 127.0.0.1. Its printed URL\n' +
  '            grants this session access to the host-selected recovery profiles.\n' +
  'show        Read saved workspace and operation status without its writer lease.\n' +
  'status      Attach to the original running listener and read current state.\n' +
  'object-session Inspect the original Object source: --profile ID --object-session ID.\n' +
  'object-evidence Read retained full native evidence: --sha256 HASH.\n' +
  'bundles     List the selected profile: --profile ID.\n' +
  'inventory   Page remote snapshots: --profile ID [--cursor ORIGINAL_CURSOR] [--limit 20].\n' +
  'requests    Page retained workspace requests: [--cursor ORIGINAL_CURSOR] [--limit 20].\n' +
  'request     Read one retained request: --profile ID --id ORIGINAL_ID.\n' +
  'operations  Page original transfer journals: --profile ID [--cursor ORIGINAL_CURSOR] [--limit 20].\n' +
  'operation   Read one original transfer journal: --profile ID --id ORIGINAL_ID.\n' +
  'review      Review the complete private selection: --selection ABS_SELECTION_JSON.\n' +
  'start       Start that same selection: --selection ABS_SELECTION_JSON --expected-review-hash HASH.\n' +
  'resume      Continue the same saved request: --profile ID --id ORIGINAL_ID.\n' +
  '            Object requests also require --expected-review-hash HASH --after-attempt N;\n' +
  '            object-snapshot requires a fresh --quiesced acknowledgement.\n' +
  'cancel      Request a stop and retain the request: --profile ID --id ORIGINAL_ID.\n\n' +
  'Commands other than serve/show borrow the existing listener through its native\n' +
  'private launch and verify the original workspace/configuration/source identity.\n' +
  'The host selects S3 configuration, passphrase environment names, source roots,\n' +
  'capture plans, restored publishers/fleets and receiving target declarations.\n' +
  'Review/start support fleet-prepare with fleetRestoreId XOR restoreId,\n' +
  'fleetTargetId and quiesced:true; use the returned outer reviewHash for start.\n' +
  'After a lost response, read the same request before continuing. A local stage,\n' +
  'including fleet preparation, can finish after stop is requested. See MCP.md\n' +
  'for the full command workflow and GUIDE.md for the original host configuration.\n';

const COMMAND_OPTIONS = {
  'comparison-artifact':['profileId','id','kind','sha256'],
  'bundle-inspection':['profileId','archiveId'],'bundle-report':['profileId','id','kind'],
  'bundle-pair':['profileId','beforeId','afterId'],'bundle-pair-attach':['profileId','beforeId','afterId','transferId','expectedPairSha256','expectedReviewSha256','expectedRevision','actor'],
  'bundle-artifact':['profileId','id'],'bundle-attach':['profileId','id','transferId','expectedReviewSha256','expectedRevision','actor'],
  'bundle-case-export':['profileId','transferId','archiveSha256','pairSha256'],'bundle-attachment':['profileId','transferId','archiveSha256','pairSha256'],
  serve: ['port'], show: [], status: [],
  'support-cases':['profileId','limit'],'support-transfers':['profileId'],
  'support-transfer':['profileId','transferId'],'support-review':['selectionFile'],
  'support-save':['profileId','transferId','expectedReviewSha256'],'support-handoff':['profileId','transferId'],
  'support-export':['profileId','transferId','expectedReviewSha256'],'support-package':['profileId','transferId'],
  'object-session': ['profileId', 'objectSessionId'], 'object-evidence': ['sha256'],
  bundles: ['profileId'], inventory: ['profileId', 'cursor', 'limit'],
  requests: ['cursor', 'limit'], request: ['profileId', 'id'],
  operations: ['profileId', 'cursor', 'limit'], operation: ['profileId', 'id'],
  review: ['selectionFile'], start: ['selectionFile', 'expectedReviewHash'],
  resume: ['profileId', 'id', 'expectedReviewHash', 'afterAttempt', 'quiesced'], cancel: ['profileId', 'id']
};
const REQUIRED_OPTIONS = {
  'comparison-artifact':['profileId','id','kind','sha256'],
  'bundle-inspection':['profileId','archiveId'],'bundle-report':['profileId','id'],
  'bundle-pair':['profileId','beforeId','afterId'],'bundle-pair-attach':['profileId','beforeId','afterId','transferId','expectedPairSha256','expectedReviewSha256','expectedRevision','actor'],
  'bundle-artifact':['profileId','id'],'bundle-attach':['profileId','id','transferId','expectedReviewSha256','expectedRevision','actor'],
  'bundle-case-export':['profileId','transferId'],'bundle-attachment':['profileId','transferId'],
  'support-cases':['profileId'],'support-transfers':['profileId'],
  'support-transfer':['profileId','transferId'],'support-review':['selectionFile'],
  'support-save':['profileId','transferId','expectedReviewSha256'],'support-handoff':['profileId','transferId'],
  'support-export':['profileId','transferId','expectedReviewSha256'],'support-package':['profileId','transferId'],
  'object-session': ['profileId', 'objectSessionId'], 'object-evidence': ['sha256'],
  bundles: ['profileId'], inventory: ['profileId'],
  request: ['profileId', 'id'], operations: ['profileId'], operation: ['profileId', 'id'],
  review: ['selectionFile'], start: ['selectionFile', 'expectedReviewHash'],
  resume: ['profileId', 'id'], cancel: ['profileId', 'id']
};
const MAX_SELECTION_BYTES = 65536;
const argumentError = (message, code = 'WORKSPACE_ARGUMENTS_INVALID') => Object.assign(new Error(message), { code });

export function parseWorkspaceArguments(argv) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== 'string'))
    throw argumentError('Workspace arguments must be strings');
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') return { help: true };
  const [command, ...rest] = argv;
  if (!Object.hasOwn(COMMAND_OPTIONS, command))
    throw argumentError('Choose a documented recovery workspace command', 'WORKSPACE_COMMAND_INVALID');
  const result = { command };
  const flags = { '--config': 'configFile', '--directory': 'directory', '--port': 'port',
    '--before-id':'beforeId','--after-id':'afterId','--pair-sha256':'pairSha256','--expected-pair-sha256':'expectedPairSha256',
    '--archive':'archiveId','--kind':'kind','--case-revision':'expectedRevision','--actor':'actor','--archive-sha256':'archiveSha256',
    '--profile': 'profileId', '--id': 'id', '--cursor': 'cursor', '--limit': 'limit',
    '--selection': 'selectionFile', '--expected-review-hash': 'expectedReviewHash',
    '--transfer-id':'transferId','--expected-support-review':'expectedReviewSha256',
    '--object-session': 'objectSessionId', '--sha256': 'sha256', '--after-attempt': 'afterAttempt', '--quiesced': 'quiesced' };
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (flag === '--help' || flag === '-h') {
      if (rest.length !== 1) throw argumentError('Use COMMAND --help on its own');
      return { help: true };
    }
    const key = flags[flag];
    if (!key || !['configFile', 'directory', ...COMMAND_OPTIONS[command]].includes(key) || result[key] !== undefined)
      throw argumentError('Unknown, repeated or unsupported workspace option: ' + flag);
    if (key === 'quiesced') { result[key] = true; continue; }
    const value = rest[++index];
    if (value === undefined || value.startsWith('--'))
      throw argumentError('A value is required for ' + flag);
    result[key] = value;
  }
  for (const key of ['configFile', 'directory', ...(REQUIRED_OPTIONS[command] ?? [])])
    if (result[key] === undefined) throw argumentError('A value is required for ' + key);
  for (const key of ['configFile', 'directory', ...(result.selectionFile === undefined ? [] : ['selectionFile'])]) {
    const path = result[key];
    if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || /[\0\r\n]/.test(path))
      throw argumentError(key + ' must be a normalized absolute path', 'WORKSPACE_PATH_INVALID');
  }
  if (result.port !== undefined) {
    if (!/^\d{1,5}$/.test(result.port) || Number(result.port) > 65535)
      throw argumentError('Port must be from 0 through 65535', 'WORKSPACE_PORT_INVALID');
    result.port = Number(result.port);
  }
  for (const key of ['profileId', 'id', 'objectSessionId'])
    if (result[key] !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(result[key]))
      throw argumentError('Select the exact original ' + key);
  if(result.archiveId!==undefined&&!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(result.archiveId))
    throw argumentError('Use the host-declared archive ID.');
  for(const key of ['expectedRevision','archiveSha256','pairSha256','expectedPairSha256'])if(result[key]!==undefined&&!/^[a-f0-9]{64}$/.test(result[key]))
    throw argumentError('Use the complete original '+key);
  if(result.kind!==undefined&&!(command==='comparison-artifact'?['result','html','markdown']:['report','verification','publication']).includes(result.kind))throw argumentError('Choose report or verification.');
  if(result.actor!==undefined&&(!result.actor.trim()||Buffer.byteLength(result.actor)>200))throw argumentError('Use the actual operator name within200 bytes.');
  if(result.transferId!==undefined&&!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(result.transferId))
    throw argumentError('Use the original lowercase Support transfer ID.');
  if(result.expectedReviewSha256!==undefined&&!/^[a-f0-9]{64}$/.test(result.expectedReviewSha256))
    throw argumentError('Use the complete confirmed Support review SHA-256.');
  if (result.expectedReviewHash !== undefined && !/^[a-f0-9]{64}$/.test(result.expectedReviewHash))
    throw argumentError('Use the complete original 64-hex workspace reviewHash');
  if (result.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(result.sha256))
    throw argumentError('Use the complete retained native evidence SHA-256');
  if (result.afterAttempt !== undefined) {
    if (!/^(0|[1-9][0-9]*)$/.test(result.afterAttempt) || !Number.isSafeInteger(Number(result.afterAttempt)))
      throw argumentError('Use the original observed nonnegative attempt number');
    result.afterAttempt = Number(result.afterAttempt);
  }
  if (command === 'resume' &&
      (result.expectedReviewHash !== undefined || result.afterAttempt !== undefined || result.quiesced !== undefined) &&
      (result.expectedReviewHash === undefined || result.afterAttempt === undefined))
    throw argumentError('Object continuation requires both --expected-review-hash and --after-attempt');
  if (result.limit !== undefined) {
    if (!/^[1-9]\d{0,2}$/.test(result.limit) || Number(result.limit) > 100)
      throw argumentError('Page limit must be from 1 through 100');
    result.limit = Number(result.limit);
  }
  if (result.cursor !== undefined && (!result.cursor || result.cursor.length > 8192 || /[\0\r\n]/.test(result.cursor)))
    throw argumentError('Keep the complete original nextCursor unchanged');
  return result;
}

async function readSelection(path) {
  if (await realpath(path) !== path)
    throw argumentError('Use the canonical private selection file', 'WORKSPACE_SELECTION_INVALID');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(MAX_SELECTION_BYTES) ||
        process.platform !== 'win32' && ((before.mode & 0o077n) !== 0n ||
          typeof process.getuid === 'function' && before.uid !== BigInt(process.getuid())))
      throw argumentError('Read an owned private single-link selection JSON file within 64 KiB', 'WORKSPACE_SELECTION_INVALID');
    const bytes = Buffer.alloc(MAX_SELECTION_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (length > MAX_SELECTION_BYTES || BigInt(length) !== before.size ||
        ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => before[key] !== after[key]))
      throw argumentError('Keep the complete selected request unchanged during its read', 'WORKSPACE_SELECTION_CHANGED');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))); }
    catch { throw argumentError('Read the complete UTF-8 selection JSON', 'WORKSPACE_SELECTION_INVALID'); }
  } finally { await handle.close(); }
}

async function callRunningWorkspace(options) {
  const [{ MerchantRecoveryWorkspaces }, { readRecoveryWorkspaceSelection, RECOVERY_SOURCE_DIRECTORY }] =
    await Promise.all([import('./merchant-client.mjs'), import('./connection.mjs')]);
  const identity = await readRecoveryWorkspaceSelection({ directory: options.directory, configFile: options.configFile });
  const client = new MerchantRecoveryWorkspaces({ recoveryWorkspaces: { workspaces: {
    local: { label: 'Original recovery workspace', directory: options.directory, configFile: options.configFile,
      sourceDirectory: RECOVERY_SOURCE_DIRECTORY, identity }
  } } });
  try {
    const input = { workspace: 'local' };
    for (const key of ['profileId', 'id', 'cursor', 'limit', 'expectedReviewHash', 'objectSessionId', 'sha256', 'afterAttempt', 'quiesced', 'transferId', 'expectedReviewSha256','archiveId','kind','expectedRevision','actor','archiveSha256','beforeId','afterId','pairSha256','expectedPairSha256'])
      if (options[key] !== undefined) input[key] = options[key];
    if (options.selectionFile !== undefined) input.selection = await readSelection(options.selectionFile);
    return await client.call('merchant_recovery_' + options.command.replaceAll('-', '_'), input);
  } finally { await client.close(); }
}

export async function main(argv = process.argv.slice(2), { output = process.stdout } = {}) {
  if (argv[0] === 'handoff') {
    const { main: handoff } = await import('./host-handoff-cli.mjs');
    return handoff(argv.slice(1), { output });
  }
  const options = parseWorkspaceArguments(argv);
  if (options.help) { output.write(HELP); return { help: true }; }
  if (options.command === 'show') {
    const { openRecoveryWorkspace } = await import('./model.mjs');
    const workspace = await openRecoveryWorkspace({ ...options, readOnly: true });
    try { const result = await workspace.state(); output.write(JSON.stringify(result, null, 2) + '\n'); return result; }
    finally { await workspace.close(); }
  }
  if (options.command !== 'serve') {
    const result = await callRunningWorkspace(options);
    output.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  }
  const { serveRecoveryWorkspace } = await import('./server.mjs');
  const service = await serveRecoveryWorkspace(options);
  output.write('Merchant recovery workspace\n' + service.url + '\n');
  output.write('Host configuration: ' + options.configFile + '\nWorkspace: ' + options.directory + '\n');
  output.write(JSON.stringify({ status: 'MERCHANT_RECOVERY_WORKSPACE_READY', configFile: options.configFile,
    directory: options.directory, url: service.url, connectionFile: service.connectionFile,
    instanceId: service.connection.instanceId, workspaceId: service.connection.identity.workspaceId,
    configurationSha256: service.connection.identity.configurationSha256 }) + '\n');
  let shutdown;
  const stop = () => {
    if (!shutdown) shutdown = service.close({ cancelActive: true }).catch(error => {
      process.exitCode = 1; output.write(JSON.stringify({ error: { code: error.code ?? 'WORKSPACE_SHUTDOWN_FAILED', message: error.message } }) + '\n');
    });
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try { await service.closed; return { status: 'CLOSED', directory: options.directory }; }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: { code: error.code ?? 'RECOVERY_WORKSPACE_FAILED', message: error.message,
      ...(error.details ? { details: error.details } : {}) } }) + '\n');
    process.exitCode = 1;
  });
}
