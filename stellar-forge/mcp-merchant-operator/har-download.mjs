// MIT. Resume original HAR file delivery through the maintained merchant transport.
import { createRetainedDownload } from './retained-download.mjs';
import { HAR_EXPORT_MANIFEST, HAR_EXPORT_MAX_BYTES, parseHarExport } from './har-export.mjs';

const receiving=createRetainedDownload({
  manifestName:HAR_EXPORT_MANIFEST,parseManifest:parseHarExport,maximumBytes:HAR_EXPORT_MAX_BYTES,
  stateSchema:'stellar-forge.har-download-state.v1',resultSchema:'stellar-forge.har-download-result.v1',
  toolPrefix:'merchant_har_export',errorPrefix:'HAR',clientName:'starforge-har-download',
  describe:manifest=>({workspace:manifest.workspace,kind:manifest.kind,selection:manifest.selection,sourceSha256:manifest.sourceSha256}),
});
export const downloadHarExport=receiving.download;
export const inspectHarExport=receiving.inspect;
