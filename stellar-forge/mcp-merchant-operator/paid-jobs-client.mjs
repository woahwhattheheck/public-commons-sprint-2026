// MIT. Receive complete original paid-job exports through the maintained file transport.
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { realpath } from 'node:fs/promises';
import { RESULT_PACKAGE_TYPE } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/outputs/contract.mjs';
import { readResultPackage } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/outputs/archive.mjs';
import { receiveResultPackage } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/outputs/receive.mjs';
import { createHash } from 'node:crypto';
import { openMerchantFileClient, createRetainedDownload } from './retained-download.mjs';
import { MAX_RETAINED_CHUNK_BYTES } from './retained-file-contracts.mjs';
import { identifier, failure } from './host-files.mjs';
import {
  JOB_EXPORT_MANIFEST, JOB_EXPORT_MAX_BYTES, JOB_EXPORT_DOCUMENT_BYTES, SHA,
  parsePaidJobExport, validatePaidJobExportRecords
} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/agent/format.mjs';

export const PAID_JOB_RECEIVING_SCHEMA = 'stellar-forge.paid-job-agent-receiving.v1';
const STATE_SCHEMA = 'stellar-forge.paid-job-agent-download-state.v1';
const PREFIX = 'merchant_jobs';
const SCOPE = '#paid-job-workspace=';
const READ_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const DOCUMENTS = Object.freeze({
  'job.json': 'jobBytes',
  'resolution.json': 'resolutionBytes',
  'customer-receipt.json': 'receiptBytes',
  'accounting.json': 'accountingBytes',
  'input-policy.json': 'policyBytes'
});
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function need(condition, code, message) {
  if (!condition) throw failure(code, message);
}
function digest(value, label) {
  need(typeof value === 'string' && SHA.test(value), 'JOB_AGENT_CLIENT_CONFIGURATION',
    'Supply the original ' + label + ' as a lowercase SHA256.');
  return value;
}
function expectedDigest(value) {
  return value === undefined ? undefined : digest(value, 'manifest digest');
}
function pinned(actual, expected) {
  if (expected !== undefined) need(actual === expected, 'JOB_AGENT_DOWNLOAD_EXPORT_CHANGED',
    'This manifest differs from the selected original export digest.');
}
function selection(manifest) {
  return {
    sourceSha256: manifest.sourceSha256,
    job: manifest.job,
    resolution: manifest.resolution,
    accounting: manifest.accounting,
    inputPolicy: manifest.inputPolicy,
    inputs: manifest.inputs
  };
}
function transport() {
  return createRetainedDownload({
    manifestName: JOB_EXPORT_MANIFEST,
    parseManifest: parsePaidJobExport,
    maximumBytes: JOB_EXPORT_MAX_BYTES,
    stateSchema: STATE_SCHEMA,
    resultSchema: PAID_JOB_RECEIVING_SCHEMA,
    toolPrefix: PREFIX,
    errorPrefix: 'JOB_AGENT',
    clientName: 'starforge-paid-job-receiving',
    validateExportId: value => digest(value, 'export ID'),
    describe: selection
  });
}
async function scopedClient({ workspace, url, client, tokenEnv, environment, signal } = {}) {
  identifier(workspace, 'Workspace alias');
  signal?.throwIfAborted();
  need(client === undefined || url === undefined, 'JOB_AGENT_CLIENT_CONFIGURATION',
    'Use one original structured MCP client or one configured MCP URL.');
  const original = client ?? await openMerchantFileClient({
    url, tokenEnv, environment, signal, errorPrefix: 'JOB_AGENT',
    clientName: 'starforge-paid-job-receiving'
  });
  need(plain(original) && typeof original.call === 'function' &&
    typeof original.endpoint === 'string' && original.endpoint.trim() &&
    original.endpoint.length + SCOPE.length + workspace.length <= 4096 &&
    !/[\0\r\n]/.test(original.endpoint),
    'JOB_AGENT_CLIENT_CONFIGURATION', 'Retain the original MCP client and its stable endpoint identity.');
  const endpoint = original.endpoint + SCOPE + encodeURIComponent(workspace);
  return Object.freeze({
    endpoint,
    async call(name, args, options = {}) {
      need([PREFIX + '_manifest', PREFIX + '_file', PREFIX + '_file_release'].includes(name) &&
        plain(args) && !Object.hasOwn(args, 'workspace'), 'JOB_AGENT_CLIENT_CONFIGURATION',
        'Use the original retained-file operations within this selected workspace.');
      const request = { requestSignal: signal, ...options };
      request.requestSignal?.throwIfAborted();
      const result = await original.call(name, { ...args, workspace }, request);
      need(plain(result) && result.workspace === workspace, 'JOB_AGENT_CLIENT_WORKSPACE_CHANGED',
        'The retained-file response belongs to a different workspace alias.');
      const { workspace: returnedWorkspace, ...native } = result;
      return native;
    }
  });
}
function savedScope(endpoint, expectedWorkspace) {
  need(typeof endpoint === 'string' && endpoint.length <= 4096 && !/[\0\r\n]/.test(endpoint),
    'JOB_AGENT_DOWNLOAD_BINDING', 'Retain the original download checkpoint and endpoint identity.');
  const index = endpoint.lastIndexOf(SCOPE);
  need(index > 0, 'JOB_AGENT_DOWNLOAD_BINDING',
    'This download does not retain its original paid-job workspace alias.');
  let workspace;
  try { workspace = decodeURIComponent(endpoint.slice(index + SCOPE.length)); }
  catch { throw failure('JOB_AGENT_DOWNLOAD_BINDING', 'The saved workspace alias is invalid.'); }
  identifier(workspace, 'Saved workspace alias');
  need(encodeURIComponent(workspace) === endpoint.slice(index + SCOPE.length) &&
    (expectedWorkspace === undefined || workspace === expectedWorkspace),
    'JOB_AGENT_DOWNLOAD_BINDING', 'The saved download belongs to a different workspace alias.');
  return { workspace, endpoint: endpoint.slice(0, index) };
}
function records(manifest, bytes) {
  try { return validatePaidJobExportRecords(manifest, bytes); }
  catch (error) {
    if (error?.code) throw error;
    throw failure('JOB_AGENT_RECORD_INVALID', 'An original export document is not valid complete UTF-8 JSON.');
  }
}
async function localRecords(transfer, context, { signal, verifyFiles }) {
  const bytes = {};
  for (const file of context.manifest.files) {
    signal?.throwIfAborted(); context.lease.assertHeld();
    if (verifyFiles) await transfer.verifiedFile(join(context.root, file.name), file);
    if (DOCUMENTS[file.name]) bytes[DOCUMENTS[file.name]] =
      await transfer.bytesAt(join(context.root, file.name), JOB_EXPORT_DOCUMENT_BYTES);
  }
  signal?.throwIfAborted(); context.lease.assertHeld();
  return records(context.manifest, bytes);
}
async function completedDirectory({ directory, workspace, exportId, expectedManifestSha256,
  signal, verifyFiles = true, endpoint, outputDirectory } = {}) {
  if (workspace !== undefined) identifier(workspace, 'Workspace alias');
  if (exportId !== undefined) digest(exportId, 'export ID');
  expectedDigest(expectedManifestSha256);
  signal?.throwIfAborted();
  const transfer = transport();
  return transfer.lockedDownload(directory, async context => {
    const manifestBytes = await transfer.bytesAt(join(context.root, JOB_EXPORT_MANIFEST), 65000);
    const manifest = parsePaidJobExport(manifestBytes, exportId), manifestSha256 = hash(manifestBytes);
    pinned(manifestSha256, expectedManifestSha256);
    // A full receiving folder includes this original checkpoint. Reopening
    // verifies that identity before the generic writer can create a new one.
    let checkpoint;
    try {
      checkpoint = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
        await transfer.bytesAt(join(context.stateDirectory, 'checkpoint.json'), 65000)));
    } catch (error) {
      if (error?.code === 'ENOENT') throw failure('JOB_AGENT_DOWNLOAD_BINDING',
        'Keep the complete receiving directory, including its original download-state checkpoint.');
      throw error;
    }
    const source = savedScope(checkpoint?.endpoint, workspace);
    need(endpoint === undefined || checkpoint.endpoint === endpoint, 'JOB_AGENT_DOWNLOAD_BINDING',
      'This directory belongs to another original MCP endpoint.');
    await transfer.loadContext(context, manifestBytes, manifest.exportId, checkpoint.endpoint);
    const original = await localRecords(transfer, context, { signal, verifyFiles });
    let outputs = null;
    if (manifest.job.result?.contentType === RESULT_PACKAGE_TYPE) {
      const job = original.job, attempt = job.attempts?.at(-1);
      need(attempt?.state === 'COMPLETED' && attempt.resultSha256 === job.result.sha256 && job.settlement,
        'JOB_AGENT_OUTPUT_BINDING', 'Retain the original completed attempt and native settlement for this package.');
      const selected = { expected: manifest.job.result, signal, job: {
        id: job.id, functionId: job.functionId, inputSha256: job.inputSha256,
        configSha256: job.source.configSha256, applicationSha256: job.source.applicationSha256,
        publicOrigin: job.source.publicOrigin, attemptId: attempt.id,
        nativeSettlement: { id: job.settlement.id, at: job.settlement.at }
      } };
      const source = join(context.root, 'result.bin');
      if (outputDirectory !== undefined) {
        const destination = await outputDestination(outputDirectory, context.root);
        context.lease.assertHeld();
        outputs = await receiveResultPackage({ source, directory: destination, ...selected });
      } else outputs = (await readResultPackage(source, selected)).describe();
    } else need(outputDirectory === undefined, 'JOB_AGENT_OUTPUT_PACKAGE_REQUIRED',
      'This original job has a single JSON or byte result rather than declared output files.');
    return {
      schema: PAID_JOB_RECEIVING_SCHEMA, state: 'REOPENED', directory: context.root,
      workspace: source.workspace, endpoint: source.endpoint, exportId: manifest.exportId,
      manifestSha256, manifestPath: join(context.root, JOB_EXPORT_MANIFEST),
      ...selection(manifest), files: manifest.files.length, bytes: manifest.totalBytes,
      documentsVerified: true, outputs,
      artifacts: manifest.files.map(file => ({ ...file, path: join(context.root, file.name) }))
    };
  });
}

/** Inspect the complete pinned manifest without creating an export or a payment. */
export async function inspectPaidJobExport(options = {}) {
  const { exportId, expectedManifestSha256 } = options;
  digest(exportId, 'export ID'); expectedDigest(expectedManifestSha256);
  const client = await scopedClient(options);
  const result = await transport().inspect({ client, exportId, signal: options.signal });
  pinned(result.manifestSha256, expectedManifestSha256);
  return {
    schema: PAID_JOB_RECEIVING_SCHEMA, state: 'INSPECTED', workspace: options.workspace,
    ...result
  };
}

/** Resume the original complete export, then join all original structured records. */
export async function downloadPaidJobExport(options = {}) {
  const { exportId, directory, expectedManifestSha256, signal, chunkSize, onProgress } = options;
  digest(exportId, 'export ID'); expectedDigest(expectedManifestSha256);
  const client = await scopedClient(options);
  const downloaded = await transport().download({
    client, exportId, directory, expectedManifestSha256, signal, chunkSize, onProgress
  });
  // The original writer has already hashed every complete file. Reacquire its
  // own lease for the document join; an offline reopen rehashes every file.
  const verified = await completedDirectory({
    directory: downloaded.directory, workspace: options.workspace, exportId,
    expectedManifestSha256: downloaded.manifestSha256, endpoint: client.endpoint,
    signal, verifyFiles: false
  });
  return { ...verified, state: 'COMPLETE', resumed: downloaded.resumed, resumedBytes: downloaded.resumedBytes };
}

/** Reopen all retained bytes and original identities entirely offline. */
export async function reopenPaidJobExport({ directory, workspace, exportId, expectedManifestSha256, signal } = {}) {
  return completedDirectory({ directory, workspace, exportId, expectedManifestSha256, signal, verifyFiles: true });
}

async function outputDestination(value, source) {
  need(typeof value === 'string' && isAbsolute(value) && !value.includes('\0'),
    'JOB_AGENT_OUTPUT_DIRECTORY', 'Choose an absolute private output receiving directory.');
  const destination = resolve(value);
  const nested = (parent, child) => {
    const name = relative(parent, child);
    return name === '' || !isAbsolute(name) && name !== '..' && !name.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'));
  };
  need(!nested(source, destination) && !nested(destination, source), 'JOB_AGENT_OUTPUT_DIRECTORY',
    'Keep the original export and the output receiving directory in separate nonoverlapping locations.');
  // Resolve any existing ancestor before creating a directory so a filesystem
  // alias cannot write a new member inside the original download's strict layout.
  let ancestor = destination;
  for (;;) {
    try {
      const actual = await realpath(ancestor);
      need(resolve(actual, relative(ancestor, destination)) === destination,
        'JOB_AGENT_OUTPUT_DIRECTORY', 'Choose the canonical private destination path.');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      need(parent !== ancestor, 'JOB_AGENT_OUTPUT_DIRECTORY', 'Choose an existing private parent.');
      ancestor = parent;
    }
  }
  return destination;
}

/** Receive declared named files beside a complete original export, entirely offline. */
export async function receivePaidJobOutputs(options = {}) {
  need(typeof options.outputDirectory === 'string', 'JOB_AGENT_OUTPUT_DIRECTORY',
    'Select the private outputDirectory for the original named files.');
  return completedDirectory({ ...options, verifyFiles: true });
}

function originalChunk(value, { exportId, manifestSha256, file, offset, readId }) {
  const size = Math.min(MAX_RETAINED_CHUNK_BYTES, file.bytes - offset);
  need(plain(value) && value.exportId === exportId && value.manifestSha256 === manifestSha256 &&
    value.file?.name === file.name && value.file?.bytes === file.bytes && value.file?.sha256 === file.sha256 &&
    typeof value.readId === 'string' && READ_ID.test(value.readId) && (!readId || value.readId === readId) &&
    value.offset === offset && value.bytesRead === size && value.encoding === 'base64' &&
    value.nextOffset === (offset + size < file.bytes ? offset + size : null) && typeof value.data === 'string',
    'JOB_AGENT_DOWNLOAD_CHUNK_CONFLICT', 'The returned document chunk differs from its exact original file and offset.');
  const bytes = Buffer.from(value.data, 'base64');
  need(bytes.length === size && bytes.toString('base64') === value.data, 'JOB_AGENT_DOWNLOAD_CHUNK_INVALID',
    'The original document chunk has a different byte count or invalid base64.');
  return bytes;
}
async function readDocument(client, { exportId, manifestSha256, file, signal }) {
  need(Object.hasOwn(DOCUMENTS, file.name) && Number.isSafeInteger(file.bytes) &&
    file.bytes >= 0 && file.bytes <= JOB_EXPORT_DOCUMENT_BYTES,
    'JOB_AGENT_DOCUMENT_TOO_LARGE', 'Receive an original structured document within its 64 MiB limit.');
  const chunks = [], digest = createHash('sha256'); let offset = 0, readId = null;
  try {
    while (offset < file.bytes) {
      signal?.throwIfAborted();
      const args = {
        exportId, file: file.name, expectedManifestSha256: manifestSha256,
        expectedSha256: file.sha256, offset, limit: MAX_RETAINED_CHUNK_BYTES,
        ...(readId ? { readId } : {})
      };
      let value;
      try { value = await client.call(PREFIX + '_file', args); }
      catch (error) {
        if (error?.code !== 'JOB_AGENT_READ_NOT_FOUND' || !readId) throw error;
        readId = null; delete args.readId;
        value = await client.call(PREFIX + '_file', args);
      }
      const previousId = readId;
      // Retain an admitted original handle for cleanup even if later chunk
      // decoding fails. A different scope or file never acquires that handle.
      if (value?.exportId === exportId && value?.manifestSha256 === manifestSha256 &&
        value?.file?.name === file.name && value?.file?.bytes === file.bytes &&
        value?.file?.sha256 === file.sha256 && READ_ID.test(value?.readId ?? '') &&
        (!readId || value.readId === readId)) readId = value.readId;
      const bytes = originalChunk(value, { exportId, manifestSha256, file, offset, readId: previousId });
      digest.update(bytes); chunks.push(bytes); offset += bytes.length;
      readId = value.nextOffset === null ? null : value.readId;
    }
    need(digest.digest('hex') === file.sha256, 'JOB_AGENT_DOWNLOAD_FILE_CHANGED',
      'The complete original document differs from its manifest SHA256.');
    signal?.throwIfAborted();
    return Buffer.concat(chunks, offset);
  } finally {
    if (readId) await client.call(PREFIX + '_file_release', { exportId, readId },
      { requestSignal: null, timeoutMs: 2000 }).catch(() => {});
  }
}

/**
 * Source the unchanged original case through one selected merchant connection.
 * The receiving provider passes this result to its original resolution.receive.
 */
export async function readPaidJobCaseSource(options = {}) {
  const { workspace, client: provided, exportId, expectedManifestSha256, signal } = options;
  digest(exportId, 'export ID'); digest(expectedManifestSha256, 'manifest digest');
  need(provided !== undefined && options.url === undefined, 'JOB_AGENT_CLIENT_CONFIGURATION',
    'Use the provider-selected original source client for case receiving.');
  const client = await scopedClient({ workspace, client: provided, signal });
  const inspected = await transport().inspect({ client, exportId, signal });
  pinned(inspected.manifestSha256, expectedManifestSha256);
  need(inspected.manifest.resolution !== null, 'JOB_AGENT_CASE_UNAVAILABLE',
    'Select an export containing the original paid-job resolution case.');
  const bytes = {};
  for (const file of inspected.manifest.files) {
    if (!DOCUMENTS[file.name]) continue;
    bytes[DOCUMENTS[file.name]] = await readDocument(client, {
      exportId, manifestSha256: inspected.manifestSha256, file, signal
    });
  }
  return records(inspected.manifest, bytes).resolution;
}
