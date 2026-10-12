// MIT. Gravity formats over the maintained eLTSS source/file contracts.
import {parseEltssExport} from '../../fhir_eltss/connected/contracts.mjs';
export * from '../../fhir_eltss/connected/contracts.mjs';
export const CONNECTION_SCHEMA='stellar-forge.gravity-referral-merchant-connection.v1';
export const OPERATOR_SCHEMA='stellar-forge.gravity-referral-operator-connection.v1';
export const EXPORT_SCHEMA='stellar-forge.gravity-referral-merchant-export.v1';
export const RESULT_SCHEMA='stellar-forge.gravity-referral-merchant-result.v1';
export const TOOL_PREFIX='merchant_gravity_referral_';
export const MANIFEST_NAME='gravity-referral-manifest.json';
export const EXPORT_KINDS=[
  'native-response','source-file','source-packet','dataset','dataset-packet','comparison-file',
  'workspace-packet','assessment-file','edition-changes-file','handoff-packet','artifact-file',
  'referral-guidance-packet','referral-guidance-file','referral-assessment-file',
  'referral-edition-changes-file','referral-exchange-operation-file',
  'referral-exchange-operation-packet','referral-handoff-packet'
];
export function parseGravityReferralExport(bytes,expectedId){
  return parseEltssExport(bytes,expectedId,{schema:EXPORT_SCHEMA,manifestName:MANIFEST_NAME,kinds:EXPORT_KINDS});
}
