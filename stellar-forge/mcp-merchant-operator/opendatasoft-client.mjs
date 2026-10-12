// MIT. Huwise customer operations and complete receiving over the original MCP transport.
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { exact, failure, identifier } from './host-files.mjs';
import { opendatasoftWorkspaceTools } from './catalog/opendatasoft-workspace.mjs';
import { OPENDATASOFT_MANIFEST, OPENDATASOFT_MAX_FILE_BYTES, parseOpendatasoftExport, sha256 } from './opendatasoft-files.mjs';
import { openMerchantFileClient, createRetainedDownload } from './retained-download.mjs';

const PREFIX = 'merchant_opendatasoft_';
export const opendatasoftActions = Object.freeze(Object.fromEntries(opendatasoftWorkspaceTools(
  (name, description, properties, required, annotations = {}) =>
    ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations }))
  .map(definition => [definition.name.slice(PREFIX.length), definition])));

export async function openOpendatasoftClient(options = {}) {
  const original = await openMerchantFileClient({ ...options, errorPrefix: 'OPENDATASOFT', clientName: 'starforge-opendatasoft-operator' });
  const call = async (action, args = {}, requestOptions) => {
    if (typeof action !== 'string') throw failure('INVALID_PARAMS', 'Choose an action from opendatasoft tools.');
    const short = action.startsWith(PREFIX) ? action.slice(PREFIX.length) : action, definition = opendatasoftActions[short];
    if (!definition) throw failure('TOOL_NOT_FOUND', 'Choose an advertised original Huwise action.');
    exact(args, Object.keys(definition.inputSchema.properties), definition.inputSchema.required);
    return original.call(definition.name, args, requestOptions);
  };
  const named = Object.fromEntries(Object.keys(opendatasoftActions).map(action =>
    [action.replace(/_([a-z])/g, (_,letter) => letter.toUpperCase()), (args = {}, requestOptions) => call(action, args, requestOptions)]));
  const awaitOperation = async ({ workspace, operationId }, { intervalMs = 250, timeoutMs = 300000, signal } = {}) => {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 25 || intervalMs > 60000 ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000)
      throw failure('INVALID_PARAMS', 'Use a 25–60000 ms observation interval and a positive timeout of at most one hour.');
    const deadline = AbortSignal.timeout(timeoutMs), combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    while (true) {
      combined.throwIfAborted();
      const result = await call('operation', { workspace, operationId }, { requestSignal: combined });
      if (result.operation?.state !== 'RUNNING') return result;
      await delay(intervalMs, undefined, { signal: combined });
    }
  };
  return Object.freeze({ endpoint: original.endpoint, call, ...named, awaitOperation });
}
const downloads = createRetainedDownload({
  manifestName: OPENDATASOFT_MANIFEST, parseManifest: parseOpendatasoftExport, maximumBytes: OPENDATASOFT_MAX_FILE_BYTES,
  stateSchema: 'stellar-forge.opendatasoft-download.v1', resultSchema: 'stellar-forge.opendatasoft-download-result.v1',
  toolPrefix: PREFIX.slice(0, -1), errorPrefix: 'OPENDATASOFT', clientName: 'starforge-opendatasoft-download',
  describe: manifest => ({ workspace: manifest.workspace, original: manifest.source })
});
export const downloadOpendatasoftExport = downloads.download;
export const inspectOpendatasoftExport = downloads.inspect;
export async function reopenOpendatasoftExport({ directory, exportId, expectedManifestSha256 } = {}) {
  identifier(exportId, 'Export ID');
  if (typeof directory !== 'string' || !directory || directory.includes('\0') ||
      expectedManifestSha256 !== undefined && !/^[a-f0-9]{64}$/.test(expectedManifestSha256))
    throw failure('OPENDATASOFT_DOWNLOAD_CONFIGURATION', 'Select the original receiving directory and reviewed manifest SHA256.');
  const root = resolve(directory), manifestBytes = await downloads.bytesAt(join(root, OPENDATASOFT_MANIFEST), 65000);
  const manifestSha256 = sha256(manifestBytes), manifest = parseOpendatasoftExport(manifestBytes, exportId);
  if (expectedManifestSha256 !== undefined && expectedManifestSha256 !== manifestSha256)
    throw failure('OPENDATASOFT_DOWNLOAD_EXPORT_CHANGED', 'The original saved manifest differs from its selected identity.');
  return downloads.lockedDownload(root, async context => {
    await downloads.loadContext(context, manifestBytes, exportId);
    for (const file of manifest.files) { context.lease.assertHeld(); await downloads.verifiedFile(join(root, file.name), file); }
    return { schema: 'stellar-forge.opendatasoft-download-result.v1', state: 'REOPENED', directory: root,
      exportId, workspace: manifest.workspace, original: manifest.source, manifestSha256,
      files: manifest.files.length, bytes: manifest.files.reduce((total,file) => total + file.bytes, 0), verifiedFiles: manifest.files };
  });
}
