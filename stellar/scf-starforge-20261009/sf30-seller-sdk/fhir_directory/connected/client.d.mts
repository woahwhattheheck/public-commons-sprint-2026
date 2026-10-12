// MIT. Native directory input types follow its installed source-owned JSON catalogues.
import type * as Gravity from '../../fhir_referral/connected/client.mjs';
export type Json=Gravity.Json;export type JsonObject=Gravity.JsonObject;
export type UUID=Gravity.UUID;export type SHA256=Gravity.SHA256;
export type WorkspaceAlias=Gravity.WorkspaceAlias;export type OperationId=string;
export type ClientOptions=Gravity.ClientOptions;export type LocalClientOptions=Gravity.LocalClientOptions;
export type RequestOptions=Gravity.RequestOptions;export type FileIdentity=Gravity.FileIdentity;
export type DirectoryRecordRef={sourceId:SHA256;recordId:SHA256};
export interface HumanServicesDirectoryConfiguration{
 schema:'stellar-forge.human-services-directory-merchant-connection.v1';
 workspaces:Record<WorkspaceAlias,{directory:string;label?:string;allowStart?:boolean;credentialsFile?:string;
 inputs?:Record<string,{file:string;sha256?:SHA256;label?:string}>}>;
}
export type ExportKind=Gravity.ExportKind|'directory-source-file'|'directory-guidance-file'|
 'directory-export-file'|'directory-handoff-packet';
export interface ExportManifest extends Omit<Gravity.ExportManifest,'schema'|'kind'>{
 schema:'stellar-forge.human-services-directory-merchant-export.v1';kind:ExportKind;
}
export interface RetainedResult<T=Json> extends Omit<Gravity.RetainedResult<T>,'schema'|'kind'|'manifestFile'>{
 schema:'stellar-forge.human-services-directory-merchant-result.v1';kind:ExportKind;
 manifestFile:{name:'human-services-directory-manifest.json';bytes:number;sha256:SHA256};
}
export interface FileManifest extends Omit<Gravity.FileManifest,'manifest'|'manifestFile'>{
 manifest:ExportManifest;manifestFile:{name:'human-services-directory-manifest.json';bytes:number;sha256:SHA256};
}
export type DirectorySourceConnectionInput={"label":string;"protocol":"hsds"|"fhir-hsd";"baseUrl":string;"authProfile"?:string|null;"publisher"?:string;"sourceUrl"?:string;"note"?:string};
export type DirectorySourceImportInput={"label":string;"format":"hsds-json"|"hsds-csv"|"hsds-csv-zip"|"fhir-json"|"fhir-json-zip"|"directory-capture";"table"?:"organization"|"program"|"service"|"attribute"|"service_at_location"|"location"|"phone"|"contact"|"address"|"schedule"|"funding"|"service_area"|"required_document"|"language"|"accessibility"|"taxonomy_term"|"metadata"|"meta_table_description"|"cost_option"|"organization_identifier"|"taxonomy"|"service_capacity"|"unit"|"url";"layout"?:"entity"|"array"|"page"|"tables";"members"?:Array<{"name":string;"table"?:"organization"|"program"|"service"|"attribute"|"service_at_location"|"location"|"phone"|"contact"|"address"|"schedule"|"funding"|"service_area"|"required_document"|"language"|"accessibility"|"taxonomy_term"|"metadata"|"meta_table_description"|"cost_option"|"organization_identifier"|"taxonomy"|"service_capacity"|"unit"|"url";"layout"?:"entity"|"array"|"page"|"tables";"encoding"?:"utf-8"|"utf-8-sig"|"cp1252";"delimiter"?:string}>;"encoding"?:"utf-8"|"utf-8-sig"|"cp1252";"delimiter"?:string;"referenceBase"?:string|null;"sourceUrl"?:string;"publisher"?:string;"origin":"published_reference"|"operator_source"|"authored_example";"scope"?:"snapshot"|"subset"|"incremental"|"unknown";"note"?:string;"filename"?:string};
export type DirectorySourceRequestInput={"label":string;"connectionId":string;"discoveryId"?:string|null;"route":"discovery"|"hsds-list"|"hsds-read"|"fhir-search"|"fhir-read"|"document";"table"?:"organization"|"program"|"service"|"attribute"|"service_at_location"|"location"|"phone"|"contact"|"address"|"schedule"|"funding"|"service_area"|"required_document"|"language"|"accessibility"|"taxonomy_term"|"metadata"|"meta_table_description"|"cost_option"|"organization_identifier"|"taxonomy"|"service_capacity"|"unit"|"url";"resourceType"?:"Organization"|"Location"|"HealthcareService"|"Endpoint";"nativeIds"?:Array<string>;"parameters"?:Array<{"name":string;"value":string}>;"url"?:string|null;"document"?:{"format":"hsds-json"|"hsds-csv"|"fhir-json";"table"?:"organization"|"program"|"service"|"attribute"|"service_at_location"|"location"|"phone"|"contact"|"address"|"schedule"|"funding"|"service_area"|"required_document"|"language"|"accessibility"|"taxonomy_term"|"metadata"|"meta_table_description"|"cost_option"|"organization_identifier"|"taxonomy"|"service_capacity"|"unit"|"url";"layout"?:"entity"|"array"|"page"|"tables";"encoding"?:"utf-8"|"utf-8-sig"|"cp1252";"delimiter"?:string};"pagination"?:{"startPage":number;"perPage":number;"termination":"declared"|"empty-page"};"scope"?:"snapshot"|"subset"|"incremental"|"unknown";"origin":"published_reference"|"operator_source"|"authored_example";"note"?:string;"limits"?:{"maxBytes"?:number;"maxRecords"?:number;"maxPages"?:number}};
export type DirectorySourceEditionInput={"label":string;"sourceIds":Array<string>;"predecessorId"?:string|null;"tables"?:Array<string>;"scope"?:"snapshot"|"subset"|"incremental"|"unknown";"actor":string;"note"?:string};
export type DirectorySourceComparisonInput={"label":string;"beforeEditionId":string;"afterEditionId":string;"reviewedLinks"?:Array<{"before":{"sourceId":string;"recordId":string};"after":{"sourceId":string;"recordId":string};"reason":string}>;"actor":string;"note"?:string};
export type DirectorySourceAcquireInput={"requestId":string;"operationId":string};
export type DirectorySourceDiscoverInput={"connectionId":string;"operationId":string};
export type DirectorySourceOperationInput={"operationId":string};
export type DirectorySourcePageInput={"offset"?:number;"limit"?:number;"table"?:string;"query"?:string};
export type DirectorySourceChangesInput={"offset"?:number;"limit"?:number;"state"?:"unchanged"|"changed"|"only-before"|"only-after"|"ambiguous"|"unidentified"};
export type DirectoryMappingInput={"label":string;"actor":string;"note"?:string;"editionId":string;"predecessorId"?:string|null;"mode":"hsds-to-fhir"|"fhir-pass-through";"identitySystem":string;"referenceBase":string;"selectedRefs"?:Array<{"sourceId":string;"recordId":string;"rowSha256"?:string}>;"identityOverrides"?:Array<{"ref":{"sourceId":string;"recordId":string;"rowSha256"?:string};"logicalId":string;"reason":string}>;"rules":Array<{"id":string;"table":"organization"|"program"|"service"|"attribute"|"service_at_location"|"location"|"phone"|"contact"|"address"|"schedule"|"funding"|"service_area"|"required_document"|"language"|"accessibility"|"taxonomy_term"|"metadata"|"meta_table_description"|"cost_option"|"organization_identifier"|"taxonomy"|"service_capacity"|"unit"|"url";"targetType":"Organization"|"Location"|"HealthcareService"|"Endpoint";"sourcePath"?:string;"targetPath":string;"operation":"copy"|"constant"|"map"|"reference";"value"?:Json;"valueMap"?:Record<string,Json>;"join"?:{"table":"organization"|"program"|"service"|"attribute"|"service_at_location"|"location"|"phone"|"contact"|"address"|"schedule"|"funding"|"service_area"|"required_document"|"language"|"accessibility"|"taxonomy_term"|"metadata"|"meta_table_description"|"cost_option"|"organization_identifier"|"taxonomy"|"service_capacity"|"unit"|"url";"foreignPath":string;"localPath":string};"includeRefs"?:Array<{"sourceId":string;"recordId":string;"rowSha256"?:string}>;"template"?:Json;"cardinality"?:"one"|"many";"referenceType"?:"Organization"|"Location"|"HealthcareService"|"Endpoint";"missing"?:"omit"|"finding"|"error";"reason":string;"reviewIds"?:Array<string>;"valueType"?:"original"|"string"|"number"|"integer"|"boolean"}>;"reviews"?:Array<{"id":string;"disposition":"accepted"|"adapted"|"excluded"|"unresolved";"reason":string}>};
export type DirectoryMappingPreviewInput={"mappingId":string};
export type DirectoryMappingApplyInput={"label":string;"actor":string;"note"?:string;"previewId":string};
export type DirectorySelectionInput={"label":string;"actor":string;"note"?:string;"editionId":string;"conversionId"?:string|null;"predecessorId"?:string|null;"serviceRefs":Array<{"sourceId":string;"recordId":string;"rowSha256"?:string}>;"chosenRefs":Array<{"sourceId":string;"recordId":string;"rowSha256"?:string}>;"criteria":{"at"?:string;"timezone"?:string;"allowedStatuses"?:Array<string>;"locationRefs"?:Array<{"sourceId":string;"recordId":string;"rowSha256"?:string}>;"languages"?:Array<string>;"taxonomyTerms"?:Array<string>;"capacity"?:{"unit":string;"minimum":number;"asOf":string;"maximumAgeHours":number};"requireContact"?:boolean;"scope"?:string;"scheduleDecisions"?:Array<{"ref":{"sourceId":string;"recordId":string;"rowSha256"?:string};"use":"operating-hours"|"event"|"exclude";"reason":string}>};"dispositions":Array<{"ref":{"sourceId":string;"recordId":string;"rowSha256"?:string};"decision":"selected"|"reserve"|"excluded"|"needs-contact";"reason":string;"owner"?:string}>};
export type DirectoryReferralJoinInput={"label":string;"actor":string;"note"?:string;"selectionId":string;"conversionId":string;"referralEditionId":string;"configurationId"?:string|null;"taskBindings":Array<{"taskId":string;"serviceRef":{"sourceId":string;"recordId":string;"rowSha256"?:string};"destinationField":"Task.owner"|"ServiceRequest.performer"|"link-only";"serviceRequestId"?:string;"recipientType":"HealthcareService"|"Organization";"reason":string}>};
export type DirectoryHandoffInput={"label":string;"actor":string;"note"?:string;"selectionId":string;"conversionId":string;"referralJoinId"?:string|null;"owner":string;"recipient":string;"scope":string;"sourceRefs"?:Array<{"url"?:string;"sourceId"?:string;"recordId"?:string;"note"?:string}>};
export type DirectoryReceivingInput={"label":string;"actor":string;"note"?:string;"handoffId"?:string|null;"archiveSha256":string;"disposition":"received"|"adopted"|"needs-follow-up";"findings"?:string;"owner":string};
export type DirectoryExportInput={"label":string;"actor":string;"note"?:string;"kind":"workspace"|"handoff"|"source"|"mapping-preview"|"selection"|"referral-join"|"guidance";"recordId"?:string|null};
export type DirectoryPageInput={"offset"?:number;"limit"?:number;"query"?:string};
export type DirectoryCollection="connections"|"discoveries"|"requests"|"importProfiles"|"sources"|"editions"|"comparisons"|"operations"|"mappings"|"mappingPreviews"|"sourceConversions"|"selections"|"referralJoins"|"handoffs"|"exports"|"receivingReviews"|"receives";
export type DirectoryState={schema:'stellar-forge.human-services-directory.v1';workspaceId:UUID}&
 Partial<Record<DirectoryCollection,Json[]>>;
export type NativeState=Gravity.NativeState&{directory:DirectoryState};
export interface DirectoryAddedArguments{
 directory_link_targets:{workspace:WorkspaceAlias;editionId:SHA256;sourceId:SHA256;linkId:SHA256}&Pick<DirectorySourcePageInput,'offset'|'limit'>;
 directory_index_file:{workspace:WorkspaceAlias;collection:'sources'|'editions'|'comparisons';recordId:SHA256};
 directory_source_record_file:{workspace:WorkspaceAlias}&DirectoryRecordRef;
 directory_comparison_changes_file:{workspace:WorkspaceAlias;comparisonId:SHA256};
 directory_capture_file:{workspace:WorkspaceAlias}&DirectorySourceOperationInput;
 directory_capture_source:{workspace:WorkspaceAlias}&DirectorySourceOperationInput;
 directory_mapping_preview_details:{workspace:WorkspaceAlias;mappingPreviewId:SHA256;group:'resources'|'fields'|'findings'}&Pick<DirectoryPageInput,'offset'|'limit'>;
 directory_selection_candidates:{workspace:WorkspaceAlias;selectionId:SHA256}&DirectoryPageInput;
 directory_state:{workspace:WorkspaceAlias};directory_catalogue:{workspace:WorkspaceAlias};
 directory_guidance:{workspace:WorkspaceAlias};directory_guidance_file:{workspace:WorkspaceAlias;member:string};
 directory_records:{workspace:WorkspaceAlias;collection:DirectoryCollection}&DirectoryPageInput;
 directory_record:{workspace:WorkspaceAlias;collection:DirectoryCollection;recordId:string};
 directory_connection_save:{workspace:WorkspaceAlias;"connection":DirectorySourceConnectionInput};
 directory_discover:{workspace:WorkspaceAlias;"discovery":DirectorySourceDiscoverInput};
 directory_import_profile_save:{workspace:WorkspaceAlias;"profile":DirectorySourceImportInput};
 directory_request_save:{workspace:WorkspaceAlias;"request":DirectorySourceRequestInput};
 directory_acquire:{workspace:WorkspaceAlias;"acquisition":DirectorySourceAcquireInput};
 directory_edition_save:{workspace:WorkspaceAlias;"edition":DirectorySourceEditionInput};
 directory_compare:{workspace:WorkspaceAlias;"comparison":DirectorySourceComparisonInput};
 directory_mapping_save:{workspace:WorkspaceAlias;"mapping":DirectoryMappingInput};
 directory_mapping_preview:{workspace:WorkspaceAlias;"mapping_preview":DirectoryMappingPreviewInput};
 directory_mapping_apply:{workspace:WorkspaceAlias;"mapping_apply":DirectoryMappingApplyInput};
 directory_selection_save:{workspace:WorkspaceAlias;"selection":DirectorySelectionInput};
 directory_referral_join:{workspace:WorkspaceAlias;"referral_join":DirectoryReferralJoinInput};
 directory_handoff_prepare:{workspace:WorkspaceAlias;"handoff":DirectoryHandoffInput};
 directory_receiving_save:{workspace:WorkspaceAlias;"receiving":DirectoryReceivingInput};
 directory_export_prepare:{workspace:WorkspaceAlias;"export":DirectoryExportInput};
 directory_advance:{workspace:WorkspaceAlias}&DirectorySourceOperationInput;
 directory_pause:{workspace:WorkspaceAlias}&DirectorySourceOperationInput;
 directory_resume:{workspace:WorkspaceAlias}&DirectorySourceOperationInput;
 directory_operation:{workspace:WorkspaceAlias}&DirectorySourceOperationInput;
 directory_source_rows:{workspace:WorkspaceAlias;sourceId:SHA256}&DirectorySourcePageInput;
 directory_source_row:{workspace:WorkspaceAlias}&DirectoryRecordRef;
 directory_source_members:{workspace:WorkspaceAlias;sourceId:SHA256};
 directory_source_file:{workspace:WorkspaceAlias;sourceId:SHA256;member?:string};
 directory_source_import:{workspace:WorkspaceAlias;input:string;importProfileId:SHA256;expectedSha256?:SHA256};
 directory_edition_rows:{workspace:WorkspaceAlias;editionId:SHA256}&DirectorySourcePageInput;
 directory_edition_row:{workspace:WorkspaceAlias;editionId:SHA256}&DirectoryRecordRef;
 directory_edition_links:{workspace:WorkspaceAlias;editionId:SHA256;recordId?:SHA256}&Pick<DirectorySourcePageInput,'offset'|'limit'>;
 directory_comparison_changes:{workspace:WorkspaceAlias;comparisonId:SHA256}&DirectorySourceChangesInput;
 directory_handoff_file:{workspace:WorkspaceAlias;handoffId:SHA256};
 directory_workspace_packet:{workspace:WorkspaceAlias};
 directory_export_file:{workspace:WorkspaceAlias;exportId:SHA256};
 directory_workspace_import:{workspace:WorkspaceAlias;input:string;expectedSha256?:SHA256};
 directory_handoff_import:{workspace:WorkspaceAlias;input:string;expectedSha256?:SHA256};
}
export type DirectoryNativeBodyAction="directory_connection_save"|"directory_discover"|"directory_import_profile_save"|"directory_request_save"|"directory_acquire"|"directory_edition_save"|"directory_compare"|"directory_mapping_save"|"directory_mapping_preview"|"directory_mapping_apply"|"directory_selection_save"|"directory_referral_join"|"directory_handoff_prepare"|"directory_receiving_save"|"directory_export_prepare";
type OriginalReceive=Gravity.GravityReferralActionArguments['receive_export'];
export type HumanServicesDirectoryActionArguments=
 Omit<Gravity.GravityReferralActionArguments,'input_apply'|'receive_export'>&DirectoryAddedArguments&{
 input_apply:Omit<Gravity.GravityReferralActionArguments['input_apply'],'action'>&{
 action:Gravity.GravityReferralActionArguments['input_apply']['action']|DirectoryNativeBodyAction};
 receive_export:(Omit<OriginalReceive,'kind'>&{kind:OriginalReceive['kind']|'directory-handoff'})|
 (Omit<OriginalReceive,'kind'>&{kind:'directory-source';importProfileId:SHA256});
};
type InheritedResult<T>=T extends Gravity.RetainedResult<infer V>?RetainedResult<V>:
 T extends Gravity.FileManifest?FileManifest:T;
export type HumanServicesDirectoryActionResults=Omit<{
 [A in keyof Gravity.GravityReferralActionResults]:InheritedResult<Gravity.GravityReferralActionResults[A]>
},'state'>&{state:RetainedResult<NativeState>}&{
 [A in keyof DirectoryAddedArguments]:RetainedResult<A extends 'directory_state'?NativeState:Json>
};
export type HumanServicesDirectoryAction=keyof HumanServicesDirectoryActionArguments;
type Camel<S extends string>=S extends `${infer A}_${infer B}`?`${A}${Capitalize<Camel<B>>}`:S;
export type HumanServicesDirectoryClient={
 readonly endpoint:string;
 call<A extends HumanServicesDirectoryAction>(action:A|`merchant_human_services_directory_${A}`,args:HumanServicesDirectoryActionArguments[A],options?:RequestOptions):Promise<HumanServicesDirectoryActionResults[A]>;
 close():Promise<void>;readValue<T=Json>(options:ReadValueOptions):Promise<T>;
}&{[A in HumanServicesDirectoryAction as Camel<A>]:(args:HumanServicesDirectoryActionArguments[A],options?:RequestOptions)=>Promise<HumanServicesDirectoryActionResults[A]>};
export interface DownloadSelection{
 workspace:WorkspaceAlias;exportId:SHA256;client?:HumanServicesDirectoryClient;
 url?:string;tokenEnv?:string;environment?:Record<string,string|undefined>;signal?:AbortSignal;
}
export interface DownloadOptions extends DownloadSelection{
 directory:string;expectedManifestSha256?:SHA256;chunkSize?:number;
 onProgress?:(progress:JsonObject)=>void|Promise<void>;
}
export interface DownloadReceipt{
 schema:'stellar-forge.human-services-directory-file-receipt.v1';state:'COMPLETE'|'REOPENED';
 workspace:WorkspaceAlias;workspaceId:UUID;exportId:SHA256;manifestSha256:SHA256;directory:string;
 files:number;bytes:number;kind:ExportKind;source:JsonObject;resumed?:boolean;resumedBytes?:number;
}
export interface ReadValueOptions{
 workspace?:WorkspaceAlias;result?:RetainedResult<unknown>;exportId?:SHA256;file?:string;expectedManifestSha256?:SHA256;
 client?:HumanServicesDirectoryClient;url?:string;tokenEnv?:string;environment?:Record<string,string|undefined>;signal?:AbortSignal;
}
export function openHumanServicesDirectoryMerchantClient(options:ClientOptions):Promise<HumanServicesDirectoryClient>;
export function openHumanServicesDirectoryLocalClient(options:LocalClientOptions):Promise<HumanServicesDirectoryClient>;
export function downloadHumanServicesDirectoryExport(options:DownloadOptions):Promise<DownloadReceipt>;
export function inspectHumanServicesDirectoryExport(options:DownloadSelection):Promise<{manifest:ExportManifest;manifestSha256:SHA256}>;
export function reopenHumanServicesDirectoryExport(options:{directory:string;workspace:WorkspaceAlias;exportId:SHA256;expectedManifestSha256?:SHA256}):Promise<DownloadReceipt>;
export function readHumanServicesDirectoryValue<T=Json>(options:ReadValueOptions):Promise<T>;
export function importHumanServicesDirectorySource(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;input:string;expectedSha256?:SHA256;
}&({profile:DirectorySourceImportInput;importProfileId?:never}|{profile?:never;importProfileId:SHA256})):
 Promise<{importProfileId:SHA256;profileResult?:RetainedResult;sourceResult:RetainedResult;source:Json}>;
export const humanServicesDirectoryActions:Readonly<Record<HumanServicesDirectoryAction,{
 name:string;description:string;inputSchema:JsonObject;annotations:JsonObject;
}>>;
