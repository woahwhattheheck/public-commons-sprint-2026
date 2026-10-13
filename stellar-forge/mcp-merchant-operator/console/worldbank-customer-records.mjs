// MIT. Complete original World Bank customer records and portable validation.
import { WORLDBANK_ALIAS, WORLDBANK_SHA, WORLDBANK_MANIFEST_NAME, parseWorldBankDelivery,
  encodeWorldBank, digest, canonical, worldBankNeed as need } from '../worldbank-programme-contracts.mjs';
export const WORLDBANK_CUSTOMER_FAMILY = 'worldbank-programme';
const prefix = 'merchant_worldbank_programme';
export function normalizeWorldBankCustomer(value) {
  need(value?.family===WORLDBANK_CUSTOMER_FAMILY&&WORLDBANK_ALIAS.test(value.workspace)&&
    WORLDBANK_SHA.test(value.exportId)&&WORLDBANK_SHA.test(value.expectedManifestSha256)&&
    WORLDBANK_SHA.test(value.expectedHostFingerprint??value.hostFingerprint),
    'Select the original World Bank workspace, export and manifest identities.');
  return {profileId:value.profileId,family:WORLDBANK_CUSTOMER_FAMILY,workspace:value.workspace,
    exportId:value.exportId,expectedManifestSha256:value.expectedManifestSha256,
    hostFingerprint:value.expectedHostFingerprint??value.hostFingerprint};
}
export function worldBankCustomerAccess(value) {
  return {name:prefix+'_manifest',args:{workspace:value.workspace,exportId:value.exportId}};
}
export function validateWorldBankCustomerRecord(record) {
  const selection=normalizeWorldBankCustomer(record.identity);
  need(canonical(selection)===canonical(record.identity),'The original customer selection changed.','CONSOLE_ARCHIVE_CHANGED');
  if(record.state!=='COMPLETE')return;
  const bytes=encodeWorldBank(record.manifest),manifest=parseWorldBankDelivery(bytes,selection.exportId);
  need(manifest.workspace===selection.workspace&&digest(bytes)===selection.expectedManifestSha256,
    'Retain the complete original World Bank manifest.','CONSOLE_ARCHIVE_CHANGED');
  const expected=[...manifest.files,{name:WORLDBANK_MANIFEST_NAME,bytes:bytes.length,sha256:digest(bytes)}];
  need(Array.isArray(record.files)&&record.files.length===expected.length&&new Set(record.files.map(f=>f.name)).size===expected.length&&
    expected.every(want=>record.files.some(file=>file.name===want.name&&file.bytes===want.bytes&&file.sha256===want.sha256)),
    'Retain every original World Bank customer member.','CONSOLE_ARCHIVE_CHANGED');
}
