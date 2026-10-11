// MIT. Persist the original five customer SDK files through the common transport.
import { createRetainedDownload } from './retained-download.mjs';
import { CLIENT_EXPORT_MANIFEST, MAX_CLIENT_EXPORT_FILE_BYTES, parseSellerClientManifest } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/developer/client-export.mjs';

const transfer = createRetainedDownload({ manifestName: CLIENT_EXPORT_MANIFEST, parseManifest: parseSellerClientManifest,
  maximumBytes: MAX_CLIENT_EXPORT_FILE_BYTES, stateSchema: 'stellar-forge.merchant-client-download.v1',
  resultSchema: 'stellar-forge.merchant-client-download-result.v1', toolPrefix: 'merchant_client_export',
  errorPrefix: 'CLIENT', clientName: 'starforge-client-download',
  describe: ({ sourceSha256, origin, mode, operations, completion, completedAt, provenance }) => ({
    sourceSha256, origin, mode, operations, completion, completedAt, ...(provenance ? { provenance } : {}) }) });

/** Inspect the original completion identity before starting or resuming delivery. */
export const inspectSellerClientDownload = transfer.inspect;
/** Retains all five payloads and the original completion receipt, never executes them. */
export const downloadSellerClientExport = transfer.download;
