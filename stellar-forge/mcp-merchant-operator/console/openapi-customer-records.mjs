// MIT. Exact OpenAPI identities in the original merchant customer records.
import {
  PACKAGE_EXPORT_MANIFEST, PACKAGE_EXPORT_MAX_BYTES, parseMerchantPackageExport, exportIdentifier, encode
} from '../../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/package-export-format.mjs';
import { canonical, digest, fail } from './records.mjs';

export const OPENAPI_CUSTOMER_ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const OPENAPI_CUSTOMER_EXPORT_ID = /^[a-f0-9]{64}$/;
export const OPENAPI_CUSTOMER_DOWNLOAD = Object.freeze({
  manifestName: PACKAGE_EXPORT_MANIFEST, parseManifest: parseMerchantPackageExport,
  maximumBytes: PACKAGE_EXPORT_MAX_BYTES,
  stateSchema: 'stellar-forge.openapi-package-download-state.v1',
  resultSchema: 'stellar-forge.openapi-package-download.v1',
  toolPrefix: 'merchant_openapi', errorPrefix: 'OPENAPI', clientName: 'starforge-merchant-console',
  nestedFiles: true, validateExportId: exportIdentifier,
  describe: manifest => ({ package: manifest.package })
});
export function validateOpenApiCustomerSelection(value) {
  if (value?.family !== 'openapi' || !OPENAPI_CUSTOMER_ALIAS.test(value.workspace ?? '') ||
      !OPENAPI_CUSTOMER_EXPORT_ID.test(value.exportId ?? ''))
    throw fail('CONSOLE_CUSTOMER_SELECTION', 'Select the original OpenAPI workspace alias and 64-character export ID.', 400);
  return value;
}
/** Profile receiving validates the original export bytes, package and complete member set. */
export function validateOpenApiCustomerRecord(value) {
  validateOpenApiCustomerSelection(value.identity);
  if (value.state !== 'COMPLETE') return;
  const bytes = encode(value.manifest);
  const manifest = parseMerchantPackageExport(bytes, value.identity.exportId);
  const manifestFile = { name: PACKAGE_EXPORT_MANIFEST, bytes: bytes.length, sha256: digest(bytes) };
  if (manifestFile.sha256 !== value.identity.expectedManifestSha256 ||
      canonical(value.files) !== canonical([...manifest.files, manifestFile]))
    throw fail('CONSOLE_ARCHIVE_CHANGED', 'Retain the complete original OpenAPI export manifest and its exact customer files.', 400);
}
