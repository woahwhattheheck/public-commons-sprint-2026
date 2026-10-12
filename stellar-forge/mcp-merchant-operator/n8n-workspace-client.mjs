// MIT. Complete original n8n job receiving over the maintained file transport.
import { join } from 'node:path';
import { createRetainedDownload, openMerchantFileClient } from './retained-download.mjs';
import { identifier, failure } from './host-files.mjs';
import { N8N_EXPORT_MANIFEST, N8N_EXPORT_MAX_BYTES, N8N_EXPORT_MAX_FILE_BYTES,
  N8N_SHA, checked, hash, parseN8nJobExport, validateN8nExportRecords } from
  '../../stellar/scf-starforge-20261009/sf30-seller-sdk/n8n/transfer-format.mjs';

export const N8N_DOWNLOAD_SCHEMA = 'stellar-forge.n8n-job-download.v1';
const transfer = createRetainedDownload({
  manifestName: N8N_EXPORT_MANIFEST, parseManifest: parseN8nJobExport,
  maximumBytes: N8N_EXPORT_MAX_BYTES, stateSchema: 'stellar-forge.n8n-job-download-state.v1',
  resultSchema: N8N_DOWNLOAD_SCHEMA, toolPrefix: 'merchant_n8n', errorPrefix: 'N8N',
  clientName: 'starforge-n8n-job-download',
  describe: manifest => ({ job: manifest.job, configurationSha256: manifest.configurationSha256 }),
  validateExportId: value => checked(value, N8N_SHA, 'export SHA256'),
});

/** Both HTTP and an existing native MCP client receive the same alias binding. */
async function scopedClient({ workspace, client, url, tokenEnv, environment, signal } = {}) {
  identifier(workspace, 'n8n workspace alias');
  if (client !== undefined && url !== undefined)
    throw failure('N8N_DOWNLOAD_CONFIGURATION', 'Select one existing MCP client or its HTTP endpoint.');
  const original = client ?? await openMerchantFileClient({ url, tokenEnv, environment, signal,
    errorPrefix: 'N8N', clientName: 'starforge-n8n-job-download' });
  if (!original || typeof original.call !== 'function' || typeof original.endpoint !== 'string' ||
      !original.endpoint.trim() || original.endpoint.length > 3900 || /[\0\r\n]/.test(original.endpoint))
    throw failure('N8N_DOWNLOAD_CONFIGURATION', 'Select an original MCP client with its stable endpoint identity.');
  return Object.freeze({
    endpoint: original.endpoint + '#n8n-workspace=' + encodeURIComponent(workspace),
    call(name, args, options) {
      if (!name.startsWith('merchant_n8n_') || Object.hasOwn(args, 'workspace'))
        throw failure('N8N_DOWNLOAD_CONFIGURATION', 'Use the selected original n8n retained-file operation.');
      return original.call(name, { ...args, workspace }, options);
    },
  });
}

/** Inspect the exact immutable manifest before choosing a private destination. */
export async function inspectN8nJobDownload({ workspace, ...options } = {}) {
  const client = await scopedClient({ workspace, ...options });
  const result = await transfer.inspect({ ...options, url: undefined, client });
  if (options.expectedManifestSha256 !== undefined &&
      result.manifestSha256 !== checked(options.expectedManifestSha256, N8N_SHA, 'manifest SHA256'))
    throw failure('N8N_DOWNLOAD_EXPORT_CHANGED', 'The retained manifest differs from the reviewed original SHA256.');
  return result;
}

/** Save every original file, then validate the complete job and dispatch identities. */
export async function downloadN8nJobExport({ workspace, ...options } = {}) {
  const client = await scopedClient({ workspace, ...options });
  const saved = await transfer.download({ ...options, url: undefined, client });
  const reopened = await reopenN8nJobDownload({ directory: saved.directory,
    expectedManifestSha256: saved.manifestSha256 });
  return { ...saved, recordsValidated: true, dispatchRevision: reopened.dispatchRevision };
}

/** Reopen locally without a merchant, network connection or workflow execution. */
export async function reopenN8nJobDownload({ directory, expectedManifestSha256 } = {}) {
  return transfer.lockedDownload(directory, async context => {
    const bytes = await transfer.bytesAt(join(context.root, N8N_EXPORT_MANIFEST), 65000);
    const manifest = parseN8nJobExport(bytes);
    const manifestSha256 = hash(bytes);
    if (expectedManifestSha256 !== undefined &&
        manifestSha256 !== checked(expectedManifestSha256, N8N_SHA, 'manifest SHA256'))
      throw failure('N8N_DOWNLOAD_EXPORT_CHANGED', 'The complete receiving manifest differs from its reviewed original SHA256.');
    await transfer.loadContext(context, bytes, manifest.exportId);
    for (const file of manifest.files) await transfer.verifiedFile(join(context.root, file.name), file);
    const { dispatch } = validateN8nExportRecords(manifest,
      await transfer.bytesAt(join(context.root, 'job.json'), N8N_EXPORT_MAX_FILE_BYTES),
      await transfer.bytesAt(join(context.root, 'dispatch.json'), N8N_EXPORT_MAX_FILE_BYTES));
    return { schema: N8N_DOWNLOAD_SCHEMA, state: 'REOPENED', directory: context.root,
      exportId: manifest.exportId, configurationSha256: manifest.configurationSha256, job: manifest.job,
      manifestSha256, files: manifest.files.length, bytes: manifest.totalBytes,
      recordsValidated: true, dispatchRevision: dispatch?.revision ?? null };
  });
}
