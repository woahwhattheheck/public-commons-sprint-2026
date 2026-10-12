// MIT. Original merchant transport and durable retained-file receiver.
import { createRetainedDownload, openMerchantFileClient } from './retained-download.mjs';
import { identifier } from './config.mjs';
import { WORLDBANK_DOWNLOAD_MANIFEST, WORLDBANK_MAX_FILE_BYTES,
  parseWorldBankDownloadManifest, worldbankId } from './worldbank-download-manifest.mjs';

function receiver(workspace) {
  identifier(workspace, 'World Bank workspace alias');
  return createRetainedDownload({
    manifestName: WORLDBANK_DOWNLOAD_MANIFEST,
    parseManifest: (bytes, exportId) => parseWorldBankDownloadManifest(bytes, exportId, workspace),
    validateExportId: worldbankId,
    maximumBytes: WORLDBANK_MAX_FILE_BYTES,
    stateSchema: 'stellar-forge.worldbank-mcp-download-state.v1',
    resultSchema: 'stellar-forge.worldbank-mcp-download-result.v1',
    toolPrefix: 'merchant_worldbank_download', errorPrefix: 'WORLDBANK',
    clientName: 'starforge-worldbank-receiver',
    describe: manifest => ({ workspace, captureSha256: manifest.captureSha256,
      sourceManifestSha256: manifest.sourceManifestSha256, reviewId: manifest.reviewId,
      reviewRevision: manifest.reviewRevision, observations: manifest.observations,
      handoverFile: 'handover.zip' }),
    connect: async options => {
      const client = await openMerchantFileClient(options);
      return { ...client, call: (name, args, callOptions) => client.call(name, { workspace, ...args }, callOptions) };
    }
  });
}
export function inspectWorldBankDownload({ workspace, ...options } = {}) {
  return receiver(workspace).inspect(options);
}
export function downloadWorldBankWorkspace({ workspace, ...options } = {}) {
  return receiver(workspace).download(options);
}
