// MIT. Directory manifests use the original retained-file identity and download format.
import {parseEltssExport} from '../../fhir_eltss/connected/contracts.mjs';
import {EXPORT_KINDS as inheritedKinds} from '../../fhir_referral/connected/contracts.mjs';
export * from '../../fhir_referral/connected/contracts.mjs';
export const CONNECTION_SCHEMA='stellar-forge.human-services-directory-merchant-connection.v1';
export const OPERATOR_SCHEMA='stellar-forge.human-services-directory-operator-connection.v1';
export const EXPORT_SCHEMA='stellar-forge.human-services-directory-merchant-export.v1';
export const RESULT_SCHEMA='stellar-forge.human-services-directory-merchant-result.v1';
export const TOOL_PREFIX='merchant_human_services_directory_';
export const MANIFEST_NAME='human-services-directory-manifest.json';
export const EXPORT_KINDS=Object.freeze([...inheritedKinds,
  'directory-source-file','directory-guidance-file','directory-export-file','directory-handoff-packet'
]);
export function parseHumanServicesDirectoryExport(bytes,expectedId){
  return parseEltssExport(bytes,expectedId,{
    schema:EXPORT_SCHEMA,manifestName:MANIFEST_NAME,kinds:EXPORT_KINDS
  });
}
