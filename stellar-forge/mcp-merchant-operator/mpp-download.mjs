// MIT. Native MPP bytes through the existing locked, resumable MCP receiver.
import { createRetainedDownload } from './retained-download.mjs';
import { MPP_EXPORT_MANIFEST, MAX_MPP_EXPORT_BYTES, parseMppExportManifest } from './mpp-files.mjs';
const transfer=createRetainedDownload({manifestName:MPP_EXPORT_MANIFEST,parseManifest:parseMppExportManifest,
  maximumBytes:MAX_MPP_EXPORT_BYTES,stateSchema:'stellar-forge.mpp-file-download.v1',
  resultSchema:'stellar-forge.mpp-file-download-result.v1',toolPrefix:'merchant_mpp_export',
  errorPrefix:'MPP',clientName:'starforge-mpp-download',describe:({source})=>({source})});
export const inspectMppDownload=transfer.inspect;
export const downloadMppExport=transfer.download;
