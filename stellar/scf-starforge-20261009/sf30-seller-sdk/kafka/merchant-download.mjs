// MIT. Receive the original Kafka merchant export through its maintained MCP downloader.
import { createHash, randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRetainedDownload, openMerchantFileClient } from '../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import { exact, plain, failure, identifier, operationName, KAFKA_LIMITS } from './client-protocol.mjs';

export const KAFKA_MERCHANT_MANIFEST_NAME = 'manifest.json';
export const KAFKA_MERCHANT_EXPORT_SCHEMA = 'stellar-forge.kafka-merchant-export.v1';
export const KAFKA_MERCHANT_DOWNLOAD_SCHEMA = 'stellar-forge.kafka-merchant-download.v1';
export const KAFKA_MERCHANT_DOWNLOAD_STATE_SCHEMA = 'stellar-forge.kafka-merchant-download-state.v1';
const REVIEW_SCHEMA = 'stellar-forge.kafka-merchant-download-review.v1';
const ADAPTER_PREFIX = 'merchant_kafka_download';
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const READ_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_MANIFEST_BYTES = 65000;
const MAX_CHUNK_BYTES = 196608;
const NATIVE_FIELDS = ['schema','artifact','workspace','operation','workspaceId',
  'bindingSha256','kind','selectionSha256','createdAt','file'];
const HASH = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_key, item) => plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const FAIL = (code, message) => failure('KAFKA_DOWNLOAD_' + code, message);
const own = (value, key) => Object.hasOwn(value, key);

function signalValue(value) {
  if (value !== undefined && value !== null && !(value instanceof AbortSignal))
    throw FAIL('CONFIGURATION', 'Select an AbortSignal for this original download.');
  return value;
}
function selection(options) {
  if (typeof options.workspace !== 'string' || !ALIAS.test(options.workspace))
    throw FAIL('CONFIGURATION', 'Select the host-declared original Kafka workspace alias.');
  identifier(options.artifact, 'Original Kafka export artifact');
  if (options.expectedWorkspaceId !== undefined &&
      (typeof options.expectedWorkspaceId !== 'string' || !UUID.test(options.expectedWorkspaceId)))
    throw FAIL('CONFIGURATION', 'Use the original workspace UUID.');
  if (options.expectedBindingSha256 !== undefined)
    identifier(options.expectedBindingSha256, 'Original Kafka source binding');
  return Object.freeze({ workspace: options.workspace, artifact: options.artifact,
    ...(options.expectedWorkspaceId === undefined ? {} : { expectedWorkspaceId: options.expectedWorkspaceId }),
    ...(options.expectedBindingSha256 === undefined ? {} : { expectedBindingSha256: options.expectedBindingSha256 }) });
}
function expectedFile(kind) {
  if (['kafka-project','ndjson-project','dataset','merchant'].includes(kind))
    return { name: 'original.zip', contentType: 'application/zip' };
  if (kind === 'changes') return { name: 'changes.ndjson', contentType: 'application/x-ndjson' };
  if (['message','state','projection','record','query','response'].includes(kind))
    return { name: 'original.json', contentType: 'application/json' };
  throw FAIL('MANIFEST_INVALID', 'Use an original complete Kafka merchant export kind.');
}
function freezeManifest(value) {
  return Object.freeze({ ...value, file: Object.freeze({ ...value.file }) });
}
/** Parse the exact received native manifest. This function never regenerates its bytes. */
export function parseKafkaMerchantExportManifest(bytes, options) {
  exact(options, ['workspace','artifact'], ['expectedWorkspaceId','expectedBindingSha256']);
  const selected = selection(options);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_MANIFEST_BYTES)
    throw FAIL('MANIFEST_INVALID', 'Use the complete original manifest file within 65000 bytes.');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw FAIL('MANIFEST_INVALID', 'The original manifest must contain complete UTF-8 JSON.'); }
  exact(value, NATIVE_FIELDS);
  if (value.schema !== KAFKA_MERCHANT_EXPORT_SCHEMA || value.workspace !== selected.workspace ||
      value.artifact !== selected.artifact || typeof value.workspaceId !== 'string' ||
      !UUID.test(value.workspaceId) || typeof value.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(value.createdAt)))
    throw FAIL('MANIFEST_INVALID', 'The native manifest belongs to another workspace or export selection.');
  operationName(value.operation);
  identifier(value.bindingSha256, 'Original source binding');
  identifier(value.selectionSha256, 'Original retained selection SHA-256');
  const artifact = HASH(canonical({ schema: 'stellar-forge.kafka-merchant-export-selection.v1',
    workspace: value.workspace, operation: value.operation }));
  if (artifact !== value.artifact || selected.expectedWorkspaceId !== undefined &&
      value.workspaceId !== selected.expectedWorkspaceId || selected.expectedBindingSha256 !== undefined &&
      value.bindingSha256 !== selected.expectedBindingSha256)
    throw FAIL('BINDING_CHANGED', 'The manifest differs from the selected original workspace, operation or source binding.');
  exact(value.file, ['name','contentType','bytes','sha256']);
  const expected = expectedFile(value.kind);
  if (value.file.name !== expected.name || value.file.contentType !== expected.contentType ||
      !Number.isSafeInteger(value.file.bytes) || value.file.bytes < 0 ||
      value.file.bytes > KAFKA_LIMITS.downloadBytes)
    throw FAIL('MANIFEST_INVALID', 'Use the original export filename, media type and complete byte count up to 2 GiB.');
  identifier(value.file.sha256, 'Original complete export SHA-256');
  return freezeManifest(value);
}
function factory(selected) {
  return createRetainedDownload({
    manifestName: KAFKA_MERCHANT_MANIFEST_NAME,
    maximumBytes: KAFKA_LIMITS.downloadBytes,
    stateSchema: KAFKA_MERCHANT_DOWNLOAD_STATE_SCHEMA,
    resultSchema: KAFKA_MERCHANT_DOWNLOAD_SCHEMA,
    toolPrefix: ADAPTER_PREFIX, errorPrefix: 'KAFKA', clientName: 'starforge-kafka-merchant-download',
    validateExportId: value => {
      if (value !== selected.artifact) throw FAIL('BINDING_CHANGED', 'Keep this original export artifact.');
      identifier(value, 'Original export artifact');
    },
    parseManifest: (bytes, artifact) => {
      if (artifact !== selected.artifact) throw FAIL('BINDING_CHANGED', 'Keep this original export artifact.');
      const manifest = parseKafkaMerchantExportManifest(bytes, selected);
      // This view adapts the native single-file schema; the retained bytes stay native.
      return { ...manifest, files: [manifest.file] };
    },
    describe: manifest => ({ workspace: manifest.workspace, artifact: manifest.artifact,
      operation: manifest.operation, workspaceId: manifest.workspaceId,
      bindingSha256: manifest.bindingSha256, kind: manifest.kind, file: manifest.file })
  });
}
function pin(value) {
  if (value !== undefined) identifier(value, 'Reviewed original manifest SHA-256');
  return value;
}
function originalBytes(response, selected) {
  if (!plain(response)) throw FAIL('MANIFEST_INVALID', 'The original manifest tool returned no complete manifest.');
  exact(response, [...NATIVE_FIELDS,'manifestFile']);
  const envelope = response.manifestFile;
  exact(envelope, ['name','bytes','sha256','encoding','data']);
  if (envelope.name !== KAFKA_MERCHANT_MANIFEST_NAME || !Number.isSafeInteger(envelope.bytes) ||
      envelope.bytes < 1 || envelope.bytes > MAX_MANIFEST_BYTES || envelope.encoding !== 'base64' ||
      typeof envelope.data !== 'string' || envelope.data.length > 4 * Math.ceil(MAX_MANIFEST_BYTES / 3))
    throw FAIL('MANIFEST_INVALID', 'Receive the original manifest file from merchant_kafka_manifest with includeFile.');
  identifier(envelope.sha256, 'Original manifest SHA-256');
  const bytes = Buffer.from(envelope.data, 'base64');
  if (bytes.length !== envelope.bytes || bytes.toString('base64') !== envelope.data || HASH(bytes) !== envelope.sha256)
    throw FAIL('MANIFEST_INVALID', 'The received manifest bytes differ from their original length or SHA-256.');
  const manifest = parseKafkaMerchantExportManifest(bytes, selected);
  const { manifestFile: _envelope, ...metadata } = response;
  if (canonical(metadata) !== canonical(manifest))
    throw FAIL('MANIFEST_INVALID', 'The manifest tool metadata differs from the exact retained file.');
  return Object.freeze({ bytes, manifest, sha256: envelope.sha256,
    file: Object.freeze({ name: envelope.name, bytes: envelope.bytes, sha256: envelope.sha256 }) });
}
function providedClient(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.call !== 'function' || typeof value.endpoint !== 'string' ||
      !value.endpoint.trim() || value.endpoint.length > 4096 || /[\0\r\n]/.test(value.endpoint))
    throw FAIL('CONFIGURATION', 'Supply the original connected merchant file client and its stable endpoint.');
  return { endpoint: value.endpoint, call: value.call.bind(value) };
}
/**
 * A session borrows one original MCP connection and owns only its accepted reads.
 * The manifest response carries native bytes; the file adapter retains the actual
 * server readId, artifact, SHA, offsets and original descriptor-release operation.
 */
export async function openKafkaMerchantDownloader(options) {
  exact(options, ['workspace','artifact'], ['url','client','tokenEnv','environment','signal',
    'expectedWorkspaceId','expectedBindingSha256']);
  const selected = selection(options), externalSignal = signalValue(options.signal);
  if (options.client !== undefined && ['url','tokenEnv','environment'].some(key => own(options,key)))
    throw FAIL('CONFIGURATION', 'Select either the original connected client or the endpoint and its token environment.');
  const controller = new AbortController();
  const lifetime = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
  lifetime.throwIfAborted();
  let closing = false, closePromise, retained;
  const pending = new Set();
  const raw = options.client === undefined ? await openMerchantFileClient({
    url: options.url, tokenEnv: options.tokenEnv, environment: options.environment,
    signal: lifetime, errorPrefix: 'KAFKA', clientName: 'starforge-kafka-merchant-download'
  }) : providedClient(options.client);
  const engine = factory(selected);
  function admit() {
    if (closing) throw FAIL('CLOSING', 'This original Kafka download session is closing.');
    lifetime.throwIfAborted();
  }
  function adapter(operationSignal) {
    const original = async (name, args, callOptions = {}) => {
      const requestSignal = own(callOptions,'requestSignal') ? callOptions.requestSignal : operationSignal;
      return raw.call(name, args, { ...callOptions, requestSignal });
    };
    function requireArtifact(args) {
      if (args.exportId !== selected.artifact) throw FAIL('BINDING_CHANGED', 'Keep the selected original export artifact.');
    }
    function requireManifest(args) {
      if (!retained || args.expectedManifestSha256 !== retained.sha256)
        throw FAIL('EXPORT_CHANGED', 'Pin file reads to the exact received original manifest SHA-256.');
    }
    return Object.freeze({ endpoint: raw.endpoint,
      async call(name, args, callOptions) {
        if (name === ADAPTER_PREFIX + '_manifest') {
          exact(args, ['exportId']); requireArtifact(args);
          const received = originalBytes(await original('merchant_kafka_manifest', {
            workspace: selected.workspace, artifact: selected.artifact, includeFile: true
          }, callOptions), selected);
          if (retained && !retained.bytes.equals(received.bytes))
            throw FAIL('EXPORT_CHANGED', 'The original export manifest changed on this same receiving session.');
          retained = received;
          return { state: 'MANIFEST_RETAINED', exportId: selected.artifact, manifestFile: received.file };
        }
        if (name === ADAPTER_PREFIX + '_file') {
          exact(args, ['exportId','file','expectedManifestSha256','expectedSha256','limit'], ['offset','readId']);
          requireArtifact(args); requireManifest(args);
          if (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > MAX_CHUNK_BYTES)
            throw FAIL('CONFIGURATION', 'Use the original bounded retained chunk size.');
          if (args.file === KAFKA_MERCHANT_MANIFEST_NAME) {
            if (args.expectedSha256 !== retained.sha256 || (args.offset ?? 0) !== 0 ||
                args.readId !== undefined || args.limit < retained.bytes.length)
              throw FAIL('MANIFEST_INVALID', 'Receive the complete original inline manifest exactly once.');
            // The inline manifest has already completed its native read. This
            // adapter-local completed ID never owns a remote file descriptor.
            return { exportId: selected.artifact, manifestSha256: retained.sha256,
              readId: randomUUID(), file: retained.file, offset: 0, bytesRead: retained.bytes.length,
              nextOffset: null, encoding: 'base64', data: retained.bytes.toString('base64') };
          }
          const file = retained.manifest.file;
          if (args.file !== file.name || args.expectedSha256 !== file.sha256)
            throw FAIL('BINDING_CHANGED', 'Receive the one original file named by this native manifest.');
          const result = await original('merchant_kafka_file_read', {
            workspace: selected.workspace, artifact: selected.artifact,
            expectedSha256: file.sha256, offset: args.offset ?? 0, limit: args.limit,
            ...(args.readId === undefined ? {} : { readId: args.readId })
          }, callOptions);
          if (!plain(result) || result.workspace !== selected.workspace || result.artifact !== selected.artifact ||
              result.file?.name !== file.name || result.file?.bytes !== file.bytes ||
              result.file?.sha256 !== file.sha256 || result.file?.contentType !== file.contentType)
            throw FAIL('CHUNK_CONFLICT', 'The original file reader returned another workspace, artifact or file.');
          return { ...result, exportId: selected.artifact, manifestSha256: retained.sha256 };
        }
        if (name === ADAPTER_PREFIX + '_file_release') {
          exact(args, ['exportId','readId']); requireArtifact(args);
          if (typeof args.readId !== 'string' || !READ_ID.test(args.readId))
            throw FAIL('CONFIGURATION', 'Release the original retained descriptor ID.');
          const result = await original('merchant_kafka_file_release', {
            workspace: selected.workspace, readId: args.readId
          }, callOptions);
          if (!plain(result) || result.workspace !== selected.workspace || result.readId !== args.readId ||
              result.state !== 'RELEASED')
            throw FAIL('CHUNK_CONFLICT', 'The release response belongs to another original read.');
          return result;
        }
        throw FAIL('CONFIGURATION', 'This connector receives only the original Kafka manifest and file operations.');
      }
    });
  }
  function track(operationSignal, action) {
    admit(); signalValue(operationSignal);
    const signal = operationSignal ? AbortSignal.any([lifetime, operationSignal]) : lifetime;
    const work = Promise.resolve().then(() => { admit(); signal.throwIfAborted(); return action(signal); });
    pending.add(work);
    return work.finally(() => pending.delete(work));
  }
  async function inspect(input = {}) {
    exact(input, [], ['expectedManifestSha256','signal']);
    pin(input.expectedManifestSha256);
    return track(input.signal, async signal => {
      const view = await engine.inspect({ client: adapter(signal), exportId: selected.artifact, signal });
      if (input.expectedManifestSha256 !== undefined && view.manifestSha256 !== input.expectedManifestSha256)
        throw FAIL('EXPORT_CHANGED', 'The original completion manifest differs from the reviewed SHA-256.');
      return { schema: REVIEW_SCHEMA, endpoint: raw.endpoint, ...selected,
        manifest: retained.manifest, manifestSha256: view.manifestSha256,
        manifestFile: { ...retained.file }, manifestBytes: Buffer.from(retained.bytes) };
    });
  }
  async function download(input) {
    exact(input, ['directory'], ['expectedManifestSha256','chunkSize','signal','onProgress']);
    pin(input.expectedManifestSha256);
    if (input.onProgress !== undefined && typeof input.onProgress !== 'function')
      throw FAIL('CONFIGURATION', 'Use a progress callback for completed durable chunks.');
    return track(input.signal, async signal => {
      const result = await engine.download({ client: adapter(signal), exportId: selected.artifact,
        directory: input.directory, expectedManifestSha256: input.expectedManifestSha256,
        chunkSize: input.chunkSize, signal, onProgress: input.onProgress });
      return { ...result, endpoint: raw.endpoint,
        manifestPath: join(result.directory, KAFKA_MERCHANT_MANIFEST_NAME),
        filePath: join(result.directory, retained.manifest.file.name) };
    });
  }
  function close() {
    if (closePromise) return closePromise;
    closing = true; controller.abort();
    closePromise = (async () => { while (pending.size) await Promise.allSettled([...pending]); })();
    return closePromise;
  }
  return Object.freeze({ endpoint: raw.endpoint, ...selected,
    get closed() { return closing; }, inspect, download, close,
    async [Symbol.asyncDispose]() { await close(); } });
}
const CONNECTION_KEYS = ['workspace','artifact','url','client','tokenEnv','environment','signal',
  'expectedWorkspaceId','expectedBindingSha256'];
function splitOptions(options, operationKeys) {
  exact(options, ['workspace','artifact'], [...CONNECTION_KEYS.filter(key => !['workspace','artifact'].includes(key)), ...operationKeys]);
  const connection = {}, operation = {};
  for (const [key, value] of Object.entries(options)) {
    if (CONNECTION_KEYS.includes(key)) connection[key] = value;
    if (!CONNECTION_KEYS.includes(key) || key === 'signal') operation[key] = value;
  }
  return { connection, operation };
}
/** Review one actual remote retained export without creating a local download. */
export async function inspectKafkaMerchantExport(options) {
  const { connection, operation } = splitOptions(options, ['expectedManifestSha256']);
  const client = await openKafkaMerchantDownloader(connection);
  try { return await client.inspect(operation); } finally { await client.close(); }
}
/** Repeat this same selection/directory to resume its original durable transfer. */
export async function downloadKafkaMerchantExport(options) {
  const { connection, operation } = splitOptions(options, ['directory','expectedManifestSha256','chunkSize','onProgress']);
  const client = await openKafkaMerchantDownloader(connection);
  try { return await client.download(operation); } finally { await client.close(); }
}
/** Reopen complete local native bytes, with no MCP connection or token required. */
export async function inspectKafkaMerchantDownload(options) {
  exact(options, ['directory','workspace','artifact'], ['expectedManifestSha256','expectedWorkspaceId','expectedBindingSha256','signal']);
  const selected = selection(options), expected = pin(options.expectedManifestSha256), signal = signalValue(options.signal);
  signal?.throwIfAborted();
  if (typeof options.directory !== 'string' || !options.directory || options.directory.includes('\0'))
    throw FAIL('CONFIGURATION', 'Select the original complete download directory.');
  const root = resolve(options.directory);
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw FAIL('PRIVATE_DIRECTORY_REQUIRED', 'Select the original private download directory.');
  const engine = factory(selected);
  return engine.lockedDownload(root, async context => {
    const bytes = await engine.bytesAt(join(root, KAFKA_MERCHANT_MANIFEST_NAME), MAX_MANIFEST_BYTES);
    const manifest = parseKafkaMerchantExportManifest(bytes, selected), manifestSha256 = HASH(bytes);
    if (expected !== undefined && expected !== manifestSha256)
      throw FAIL('EXPORT_CHANGED', 'The complete local manifest differs from the reviewed SHA-256.');
    const savedManifest = await engine.bytesAt(join(context.stateDirectory, KAFKA_MERCHANT_MANIFEST_NAME), MAX_MANIFEST_BYTES);
    if (!savedManifest.equals(bytes)) throw FAIL('EXPORT_CHANGED', 'The retained receiving manifest differs from the published original bytes.');
    let checkpoint;
    try { checkpoint = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
      await engine.bytesAt(join(context.stateDirectory,'checkpoint.json'), MAX_MANIFEST_BYTES))); }
    catch (error) { if (error instanceof SyntaxError) throw FAIL('CHECKPOINT_CONFLICT', 'The original completed checkpoint is invalid.'); throw error; }
    if (!plain(checkpoint) || checkpoint.schema !== KAFKA_MERCHANT_DOWNLOAD_STATE_SCHEMA ||
        checkpoint.exportId !== selected.artifact || checkpoint.manifestSha256 !== manifestSha256 ||
        typeof checkpoint.endpoint !== 'string' || !checkpoint.endpoint || !plain(checkpoint.files) ||
        Object.keys(checkpoint.files).length !== 1 || !own(checkpoint.files,manifest.file.name))
      throw FAIL('CHECKPOINT_CONFLICT', 'Keep this original export, endpoint and completed file checkpoint.');
    const saved = checkpoint.files[manifest.file.name];
    if (!plain(saved) || saved.complete !== true || saved.bytes !== manifest.file.bytes || saved.sha256 !== manifest.file.sha256)
      throw FAIL('INCOMPLETE', 'Resume this original download to complete its retained file checkpoint.');
    signal?.throwIfAborted(); context.lease.assertHeld();
    await engine.verifiedFile(join(root,manifest.file.name), manifest.file, signal);
    signal?.throwIfAborted(); context.lease.assertHeld();
    return { schema: KAFKA_MERCHANT_DOWNLOAD_SCHEMA, state: 'COMPLETE', local: true,
      directory: root, endpoint: checkpoint.endpoint, ...selected,
      operation: manifest.operation, workspaceId: manifest.workspaceId, bindingSha256: manifest.bindingSha256,
      kind: manifest.kind, manifestSha256, files: 1, bytes: manifest.file.bytes, file: manifest.file,
      manifestPath: join(root,KAFKA_MERCHANT_MANIFEST_NAME), filePath: join(root,manifest.file.name) };
  });
}
