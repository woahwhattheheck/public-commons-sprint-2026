// MIT. Complete OpenAPI package receiving over the original retained-file transport.
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRetainedDownload, openMerchantFileClient } from './retained-download.mjs';
import { PACKAGE_EXPORT_MANIFEST, PACKAGE_EXPORT_MAX_BYTES, parseMerchantPackageExport } from
  '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/package-export-format.mjs';
import { sf61Checked, SF61_ALIAS, SF61_SHA, sf61Failure } from './sf61-connection.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function transport(workspace) {
  return createRetainedDownload({
    manifestName: PACKAGE_EXPORT_MANIFEST, parseManifest: parseMerchantPackageExport,
    maximumBytes: PACKAGE_EXPORT_MAX_BYTES, stateSchema: 'stellar-forge.openapi-package-download-state.v1',
    resultSchema: 'stellar-forge.openapi-package-download.v1', toolPrefix: 'merchant_openapi',
    errorPrefix: 'OPENAPI', clientName: 'starforge-openapi-package-download', nestedFiles: true,
    describe: manifest => ({ package: manifest.package }),
    connect: async options => {
      sf61Checked(workspace, SF61_ALIAS, 'original workspace alias');
      const client = await openMerchantFileClient(options);
      return { endpoint: client.endpoint + '#openapi-workspace=' + encodeURIComponent(workspace),
        call: (name, args, request) => client.call(name, { workspace, ...args }, request) };
    }
  });
}
/** Continue the exact original export after client or server restart. */
export async function downloadOpenApiPackage({ workspace, ...options } = {}) {
  return transport(sf61Checked(workspace, SF61_ALIAS, 'workspace alias')).download(options);
}
export async function inspectOpenApiPackageDownload({ workspace, ...options } = {}) {
  return transport(sf61Checked(workspace, SF61_ALIAS, 'workspace alias')).inspect(options);
}
/** Reopen every completed file locally through the same receiving directory guard. */
export async function reopenOpenApiPackageDownload({ directory, expectedManifestSha256 } = {}) {
  const original = transport();
  return original.lockedDownload(directory, async context => {
    const bytes = await original.bytesAt(join(context.root, PACKAGE_EXPORT_MANIFEST), 65000);
    const manifest = parseMerchantPackageExport(bytes);
    if (expectedManifestSha256 !== undefined &&
        hash(bytes) !== sf61Checked(expectedManifestSha256, SF61_SHA, 'original manifest SHA256'))
      throw sf61Failure('OPENAPI_DOWNLOAD_EXPORT_CHANGED', 'The complete receiving manifest differs from its reviewed SHA256.');
    await original.loadContext(context, bytes, manifest.exportId);
    for (const file of manifest.files) await original.verifiedFile(join(context.root, file.name), file);
    return { schema: 'stellar-forge.openapi-package-download.v1', state: 'REOPENED', exportId: manifest.exportId,
      package: manifest.package, manifestSha256: hash(bytes), files: manifest.files.length,
      bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0), directory: context.root };
  });
}
