// MIT. Gravity native input declarations generated from its complete source-owned schemas.
// The original eLTSS77 client types remain imported and available without another model.
import type * as Native from '../../fhir_eltss/connected/client.mjs';
export type {NativeMapping,NativeMappingColumn,NativeGraphPolicy,NativeGraph,NativeResourceRecord,
  NativeReferenceEdge,NativeConnectionInput,NativeRequestInput,NativeReviewSetInput,
  NativeFieldReview,NativeSelector,NativeFieldCell,NativeAssessment,NativeFileDescriptor} from '../../fhir_eltss/connected/client.mjs';
export type Json=Native.Json;export type JsonObject=Native.JsonObject;
export type UUID=Native.UUID;export type SHA256=Native.SHA256;export type OperationId=Native.OperationId;
export type WorkspaceAlias=Native.WorkspaceAlias;export type JsonText=Native.JsonText;
export type RequestOptions=Native.RequestOptions;export type ClientOptions=Native.ClientOptions;
export type LocalClientOptions=Native.LocalClientOptions;export type FileIdentity=Native.FileIdentity;
export type WorkspaceList=Native.WorkspaceList;export type OperatorOpen=Native.OperatorOpen;export type OperatorRelease=Native.OperatorRelease;
export interface GravityReferralConfiguration{
 schema:'stellar-forge.gravity-referral-merchant-connection.v1';
 workspaces:Record<WorkspaceAlias,{directory:string;label?:string;allowStart?:boolean;credentialsFile?:string;
 inputs?:Record<string,{file:string;sha256?:SHA256;label?:string}>}>;
}
export type ExportKind=Native.ExportManifest['kind']|'referral-guidance-packet'|'referral-guidance-file'|
 'referral-assessment-file'|'referral-edition-changes-file'|'referral-exchange-operation-file'|
 'referral-exchange-operation-packet'|'referral-handoff-packet';
export interface ExportManifest extends Omit<Native.ExportManifest,'schema'|'kind'>{
 schema:'stellar-forge.gravity-referral-merchant-export.v1';kind:ExportKind;
}
export interface RetainedResult<T=Json> extends Omit<Native.RetainedResult<T>,'schema'|'kind'|'manifestFile'>{
 schema:'stellar-forge.gravity-referral-merchant-result.v1';kind:ExportKind;
 manifestFile:{name:'gravity-referral-manifest.json';bytes:number;sha256:SHA256};
}
export interface FileManifest extends Omit<Native.FileManifest,'manifest'|'manifestFile'>{
 manifest:ExportManifest;manifestFile:{name:'gravity-referral-manifest.json';bytes:number;sha256:SHA256};
}
export type FileRangeResult=Native.FileRangeResult;export type JsonPageResult=Native.JsonPageResult;
export interface ReferralPage<T=unknown>{rows:T[];total:number;offset:number;nextOffset:number|null;pageBytes:number}
export type ReferralSourceCitation={"sourceId"?:string;"recordId"?:string;"pointer"?:string;"member"?:string;"sourceSha256"?:string;"resourceSha256"?:string;"url"?:string;"locator"?:string;"note"?:string};
export type ReferralConfigurationInput={"label":string;"actor":string;"note"?:string;"topology":"direct"|"direct-light"|"intermediary"|"intermediary-light";"roles":Array<{"role":"source"|"intermediary"|"target";"organization":string;"connectionId"?:string|null;"owner":string;"note"?:string}>;"recipientHostRole":"source"|"intermediary"|"target";"sourceVersion"?:"3.0.0"|"2.3.0";"legacyProfileArtifactId"?:string|null;"monitoring"?:{"mode"?:"manual"|"poll"|"subscription";"intervalMinutes"?:number|null;"timezone"?:string;"businessDays"?:Array<number>;"businessStart"?:string;"businessEnd"?:string;"urgent"?:boolean;"reason"?:string;"owner"?:string};"predecessorId"?:string|null;"classification"?:"published_example"|"client_supplied"|"operator_transformation"};
export type ReferralEditionInput={"label":string;"actor":string;"note"?:string;"sourceId":string;"configurationId":string;"taskIds":Array<string>;"predecessorId"?:string|null;"referencePolicy"?:"bundle"|"selected-base";"baseUrl"?:string;"decisionIds"?:Array<string>};
export type ReferralProfileAdoptionInput={"label":string;"actor":string;"note"?:string};
export type ReferralReviewInput={"label":string;"actor":string;"note"?:string;"profileId"?:"gravity-referral-3.0.0";"predecessorId"?:string|null;"requirements":Array<{"key":"assess-1"|"assess-2"|"cap-1"|"char-1"|"char-2"|"cond-1"|"cond-2"|"cond-3"|"cond-4"|"cond-5"|"conf-1"|"conf-2"|"conf-3"|"conf-4"|"conf-5"|"conf-6"|"conf-7"|"conf-8"|"conf-9"|"conn-1"|"goal-1"|"goal-2"|"obsscreen-1"|"obsscreen-2"|"obsscreen-3"|"priv-1"|"priv-2"|"priv-3"|"priv-4"|"priv-5"|"priv-6"|"priv-7"|"priv-8"|"priv-10"|"proc-1"|"proc-2"|"refer-1"|"refer-3"|"refer-4"|"refer-5"|"refer-6"|"refer-9"|"serv-1"|"serv-2"|"serv-3"|"task-1"|"task-2"|"task-3"|"task-4"|"task-5"|"task-6"|"task-7"|"task-8"|"task-9"|"task-10"|"task-11"|"task-12";"status":"unreviewed"|"applicable"|"met"|"gap"|"not-applicable";"reason"?:string;"owner"?:string;"reviewer"?:string;"reviewedAt"?:string|null;"sourceRefs"?:Array<{"sourceId"?:string;"recordId"?:string;"pointer"?:string;"member"?:string;"sourceSha256"?:string;"resourceSha256"?:string;"url"?:string;"locator"?:string;"note"?:string}>;"targetPath"?:string;"mapping"?:string;"receivingId"?:string|null}>;"fields":Array<{"key":"parent-task"|"task-status"|"task-reason"|"task-intent"|"task-code"|"task-focus"|"task-for"|"task-authored"|"task-requester"|"task-owner"|"performed-reference"|"performed-code"|"output-context"|"request-parent"|"request-status"|"service-code"|"contact-instruction"|"request-subject"|"request-requester"|"consent-status"|"consent-patient"|"consent-time"|"consent-organisation"|"consent-original";"status":"unreviewed"|"applicable"|"met"|"gap"|"not-applicable";"reason"?:string;"owner"?:string;"reviewer"?:string;"reviewedAt"?:string|null;"sourceRefs"?:Array<{"sourceId"?:string;"recordId"?:string;"pointer"?:string;"member"?:string;"sourceSha256"?:string;"resourceSha256"?:string;"url"?:string;"locator"?:string;"note"?:string}>;"targetPath"?:string;"mapping"?:string;"receivingId"?:string|null}>};
export type ReferralAssessmentInput={"label":string;"actor":string;"note"?:string;"editionId":string;"reviewId":string;"asOf"?:string|null};
export type ReferralDecisionInput={"label":string;"actor":string;"note"?:string;"editionId":string;"kind":"consent"|"ownership"|"workflow"|"finding"|"resource-link"|"receiving"|"contact";"outcome":"permit"|"deny"|"review-required"|"accepted"|"resolved"|"deferred"|"rejected";"reason":string;"taskIds"?:Array<string>;"resourceIds"?:Array<string>;"sourceRefs"?:Array<{"sourceId"?:string;"recordId"?:string;"pointer"?:string;"member"?:string;"sourceSha256"?:string;"resourceSha256"?:string;"url"?:string;"locator"?:string;"note"?:string}>;"relatedRecords"?:Array<{"fromRecordId":string;"toRecordId":string;"toEditionId":string;"relationship":"same"|"successor"|"related"|"split"|"copy"|"proxy";"reason":string}>;"purpose"?:string;"expiresAt"?:string|null;"recordedAt":string;"supersedesId"?:string|null;"owner"?:string;"assessmentId"?:string|null;"findingIds"?:Array<string>};
export type ReferralComparisonInput={"label":string;"actor":string;"note"?:string;"beforeId":string;"afterId":string;"decisionIds"?:Array<string>};
export type ReferralCorrectionPreviewInput={"label":string;"actor":string;"note"?:string;"editionId":string;"reason":string;"patches":Array<{"recordId":string;"path":string|Array<string>;"action":"add"|"replace"|"remove";"valueJson"?:string|null}>};
export type ReferralCorrectionApplyInput={"previewId":string;"expectedRequestSha256":string};
export type ReferralExchangeRequestInput={"label":string;"actor":string;"note"?:string;"editionId":string;"connectionId":string;"discoveryId":string;"recordId"?:string|null;"resourceType":"Task"|"ServiceRequest"|"Consent"|"Procedure"|"CarePlan"|"Condition"|"Observation"|"QuestionnaireResponse";"logicalId":string;"method":"GET"|"PUT";"bodyJson"?:string|null;"expectedETag"?:string|null;"createIfAbsent"?:boolean;"consentDecisionId"?:string|null;"purpose"?:string;"role":"source"|"intermediary"|"target"};
export type ReferralAdvanceInput={"operationId":string};
export type ReferralMonitoringInput={"label":string;"actor":string;"note"?:string;"configurationId":string;"connectionId":string;"discoveryId":string;"since"?:string|null;"until"?:string|null;"owner"?:string;"requester"?:string;"statuses"?:Array<"draft"|"requested"|"accepted"|"rejected"|"in-progress"|"on-hold"|"failed"|"completed"|"cancelled"|"entered-in-error">;"taskId"?:string|null;"history"?:boolean};
export type ReferralHandoffInput={"label":string;"actor":string;"note"?:string;"editionId":string;"assessmentId":string;"receiver":string;"scope":"complete-workspace";"purpose"?:string;"sourceRefs"?:Array<{"sourceId"?:string;"recordId"?:string;"pointer"?:string;"member"?:string;"sourceSha256"?:string;"resourceSha256"?:string;"url"?:string;"locator"?:string;"note"?:string}>};
export type ReferralReceivingInput={"label":string;"actor":string;"note"?:string;"handoffId":string;"receiver":string;"state":"received"|"accepted"|"needs-correction"|"rejected";"artifactId"?:string|null;"destinationObjectId"?:string;"operationId":string;"receivedAt"?:string;"correctionOf"?:string|null;"sourceRefs"?:Array<{"sourceId"?:string;"recordId"?:string;"pointer"?:string;"member"?:string;"sourceSha256"?:string;"resourceSha256"?:string;"url"?:string;"locator"?:string;"note"?:string}>};
export type ReferralExportInput={"kind":"workspace"|"handoff"|"assessment"|"comparison"|"exchange-operation";"id"?:string;"label"?:string};
export type ReferralPublishedExamplesInput={"label":string;"actor":string;"note"?:string;"publicationUrl":string;"referenceBase":string};

export interface ReferralRecord{id:SHA256;createdAt:string;[key:string]:unknown}
export type ReferralConfiguration=ReferralConfigurationInput&ReferralRecord;
export type ReferralEdition=ReferralEditionInput&ReferralRecord&{graphId:SHA256};
export type ReferralReview=ReferralReviewInput&ReferralRecord&{
 counts:{requirements:Record<string,number>;fields:Record<string,number>};profileSha256:SHA256;profileSnapshot:JsonObject};
export type ReferralDecision=ReferralDecisionInput&ReferralRecord;
export interface ReferralAssessmentSummary{
 tasks:number;statuses:Record<string,number>;findings:Record<string,number>;
 requirements:Record<string,number>;fields:Record<string,number>;
 contactProhibited:number;completedWithOutcome:number;consentReviewRecorded:number;
}
export interface ReferralAssessment extends ReferralRecord{
 label:string;actor:string;note:string;editionId:SHA256;reviewId:SHA256;configurationId:SHA256;sourceId:SHA256;asOf:string;
 reportFile:Native.NativeFileDescriptor;summary:ReferralAssessmentSummary;
}
export interface ReferralTask{
 taskId:SHA256;logicalId:string|null;versionId?:string|null;status:string;statusReason:string;
 priority?:string|null;owner:string;requester:string;authoredOn?:string|null;subject:string;
 parentTasks:unknown[];requests:unknown[];subjectRelationships:unknown[];outcomes:unknown[];
 procedureIds:SHA256[];consents:unknown[];consentDecisionIds:SHA256[];contactProhibited:boolean;
 sourceRef:ReferralSourceCitation;resourceSha256:SHA256;
}
export interface ReferralFieldCell{
 taskId:SHA256;key:string;label:string;state:'present'|'absent';
 values:Array<ReferralSourceCitation&{jsonText:JsonText}>;sourceRefs:unknown[];
}
export interface ReferralFinding{
 id:SHA256;taskId:SHA256;rule:string;severity:string;label:string;observed:Json;sourceRefs:ReferralSourceCitation[];
 relatedRecordIds:SHA256[];owner:string;state:string;decisionId?:SHA256;
}
export interface ReferralAssessmentReport{
 schema:'stellar-forge.gravity-referral-assessment.v1';editionId:SHA256;sourceId:SHA256;graphId:SHA256;reviewId:SHA256;
 configurationId:SHA256;profileId:'gravity-referral-3.0.0';asOf:string;
 tasks:ReferralTask[];findings:ReferralFinding[];cells:ReferralFieldCell[];decisions:ReferralDecision[];
 profileSha256:SHA256;summary:ReferralAssessmentSummary;
}
export interface ReferralComparison extends ReferralRecord{
 label:string;beforeId:SHA256;afterId:SHA256;decisionIds:SHA256[];summary:Record<string,number>;
 changesFile:Native.NativeFileDescriptor;beforeSourceId:SHA256;afterSourceId:SHA256;
}
export interface ReferralCorrectionPreview extends ReferralRecord{
 label:string;editionId:SHA256;request:ReferralCorrectionPreviewInput;requestSha256:SHA256;
 changesFile:Native.NativeFileDescriptor;changeCount:number;derivedDocument:JsonObject;preview:ReferralPage;
}
export interface ReferralCorrection extends ReferralRecord{
 label:string;actor:string;sourceEditionId:SHA256;sourceId:SHA256;editionId:SHA256;previewId:SHA256;
 requestSha256:SHA256;recordMap:Record<SHA256,SHA256>;
}
export type ReferralExchangeRequest=ReferralExchangeRequestInput&ReferralRecord&{
 url:string;requestSha256:SHA256;configurationId:SHA256;originalSourceId:SHA256;
 originalResourceSha256:SHA256|null;originalResourceJson:JsonText|null;bodySha256?:SHA256;
};
export interface ReferralExchangeOperation{
 schema:'stellar-forge.gravity-referral-exchange.v1';id:OperationId;requestId:SHA256;requestSha256:SHA256;connectionId:SHA256;
 createdAt:string;updatedAt:string;state:'ready'|'running'|'waiting'|'review-required'|'complete';phase:string;
 steps:Array<{id:UUID;name:string;method:string;url:string;headers:Record<string,string>;bodySha256:SHA256|null;
 startedAt:string;completedAt?:string;receipt:JsonObject|null}>;
 history:Array<{at:string;action:string;state:string;phase:string}>;inflight:UUID|null;writeStarted:boolean;
 notBefore:string|null;preflight:JsonObject|null;result:JsonObject|null;sourceId?:SHA256;
}
export type ReferralMonitoring=ReferralMonitoringInput&ReferralRecord&{requestId:SHA256;search:JsonObject};
export type ReferralHandoff=ReferralHandoffInput&ReferralRecord&{
 reviewId:SHA256;taskCount:number;requestSha256:SHA256;frozenAt:string;files:Record<string,Native.NativeFileDescriptor>;
 nativeSnapshot:Native.NativeFileDescriptor;referralSnapshot:Native.NativeFileDescriptor;custody:Record<string,Native.NativeFileDescriptor>;
};
export type ReferralReceiving=ReferralReceivingInput&ReferralRecord&{handoffRequestSha256:SHA256};
export interface ReferralReceive{
 id:SHA256;archiveSha256:SHA256;workspaceId:UUID;state:'receiving'|'complete';kind:'workspace'|'handoff';
 completed:string[];createdAt:string;updatedAt:string;error:string|null;
}
export interface ReferralRecords{
 configurations:ReferralConfiguration;editions:ReferralEdition;reviews:ReferralReview;assessments:ReferralAssessment;
 decisions:ReferralDecision;comparisons:ReferralComparison;correctionPreviews:ReferralCorrectionPreview;corrections:ReferralCorrection;
 exchangeRequests:ReferralExchangeRequest;exchangeOperations:ReferralExchangeOperation;monitoring:ReferralMonitoring;
 handoffs:ReferralHandoff;receivings:ReferralReceiving;receives:ReferralReceive;
}
export type ReferralCollection=keyof ReferralRecords;
/** The state endpoint contains descriptors; read the selected record for its full body. */
export type ReferralState={schema:'stellar-forge.gravity-referral.v1';workspaceId:UUID}&{
 [K in ReferralCollection]:Array<Pick<ReferralRecords[K],'id'>&Partial<ReferralRecords[K]>>;
};
export type NativeState=Native.NativeState&{referral:ReferralState};
export interface ReferralExportPreparation{
 kind:'workspace'|'handoff'|'assessment'|'comparison'|'exchange-operation';selectionId:string|null;workspaceId:UUID;
 artifact:Native.NativeRecord&{name:string;label:string;bytes:number;contentType:string;file:Native.NativeFileDescriptor};
 file:{route:string;bytes:number;sha256:SHA256;name:string;contentType:string};source:JsonObject;
}
export interface Paging{offset?:number;limit?:number}
export interface ReferralAddedArguments{
 referral_catalogue:{workspace:WorkspaceAlias};referral_state:{workspace:WorkspaceAlias};
 referral_profile:{workspace:WorkspaceAlias};referral_guidance:{workspace:WorkspaceAlias};
 referral_guidance_packet:{workspace:WorkspaceAlias};referral_guidance_file:{workspace:WorkspaceAlias;member:string};
 referral_records:{workspace:WorkspaceAlias;collection:ReferralCollection;query?:string}&Paging;
 referral_record:{workspace:WorkspaceAlias;collection:ReferralCollection;recordId:SHA256|OperationId};
 referral_configuration_save:{workspace:WorkspaceAlias;configuration:ReferralConfigurationInput};
 referral_edition_save:{workspace:WorkspaceAlias;edition:ReferralEditionInput};
 referral_review_profile:{workspace:WorkspaceAlias;profile:ReferralProfileAdoptionInput};
 referral_review_save:{workspace:WorkspaceAlias;review:ReferralReviewInput};
 referral_assessment_create:{workspace:WorkspaceAlias;assessment:ReferralAssessmentInput};
 referral_decision_save:{workspace:WorkspaceAlias;decision:ReferralDecisionInput};
 referral_edition_comparison_create:{workspace:WorkspaceAlias;comparison:ReferralComparisonInput};
 referral_correction_preview:{workspace:WorkspaceAlias;correction:ReferralCorrectionPreviewInput};
 referral_correction_apply:{workspace:WorkspaceAlias;apply:ReferralCorrectionApplyInput};
 referral_exchange_request_save:{workspace:WorkspaceAlias;request:ReferralExchangeRequestInput};
 referral_monitoring_prepare:{workspace:WorkspaceAlias;monitoring:ReferralMonitoringInput};
 referral_handoff_prepare:{workspace:WorkspaceAlias;handoff:ReferralHandoffInput};
 referral_receiving_save:{workspace:WorkspaceAlias;receiving:ReferralReceivingInput};
 referral_export_prepare:{workspace:WorkspaceAlias;selection:ReferralExportInput};
 referral_assessment_tasks:{workspace:WorkspaceAlias;assessmentId:SHA256;query?:string;taskId?:SHA256}&Paging;
 referral_assessment_findings:{workspace:WorkspaceAlias;assessmentId:SHA256;query?:string;taskId?:SHA256}&Paging;
 referral_assessment_cells:{workspace:WorkspaceAlias;assessmentId:SHA256;query?:string;taskId?:SHA256}&Paging;
 referral_assessment_decisions:{workspace:WorkspaceAlias;assessmentId:SHA256;query?:string;taskId?:SHA256}&Paging;
 referral_assessment_file:{workspace:WorkspaceAlias;assessmentId:SHA256};
 referral_edition_changes:{workspace:WorkspaceAlias;comparisonId:SHA256}&Paging;
 referral_edition_changes_file:{workspace:WorkspaceAlias;comparisonId:SHA256};
 referral_exchange_advance:{workspace:WorkspaceAlias;requestId:SHA256;operationId:OperationId};
 referral_exchange_operation:{workspace:WorkspaceAlias;operationId:OperationId};
 referral_exchange_operation_file:{workspace:WorkspaceAlias;operationId:OperationId};
 referral_exchange_operation_packet:{workspace:WorkspaceAlias;operationId:OperationId};
 referral_handoff_packet:{workspace:WorkspaceAlias;handoffId:SHA256};
 referral_workspace_packet:{workspace:WorkspaceAlias};
 referral_workspace_import:{workspace:WorkspaceAlias;input:string;expectedSha256?:SHA256};
 referral_handoff_import:{workspace:WorkspaceAlias;input:string;expectedSha256?:SHA256};
 referral_published_examples_import:{workspace:WorkspaceAlias;input:string;expectedSha256?:SHA256;selection:ReferralPublishedExamplesInput};
}
export type ReferralNativeBodyAction="referral_configuration_save"|"referral_edition_save"|"referral_review_profile"|"referral_review_save"|"referral_assessment_create"|"referral_decision_save"|"referral_edition_comparison_create"|"referral_correction_preview"|"referral_correction_apply"|"referral_exchange_request_save"|"referral_monitoring_prepare"|"referral_handoff_prepare"|"referral_receiving_save"|"referral_export_prepare";
export type GravityReferralActionArguments=Omit<Native.EltssActionArguments,'input_apply'|'receive_export'>&ReferralAddedArguments&{
 input_apply:Omit<Native.EltssActionArguments['input_apply'],'action'>&{
 action:Native.EltssActionArguments['input_apply']['action']|ReferralNativeBodyAction};
 receive_export:Omit<Native.EltssActionArguments['receive_export'],'kind'>&{
 kind:Native.EltssActionArguments['receive_export']['kind']|'referral-handoff'};
};
type InheritedResult<T>=T extends Native.RetainedResult<infer V>?RetainedResult<V>:
 T extends Native.FileManifest?FileManifest:T;
export interface ReferralAddedValues{
 referral_catalogue:JsonObject;referral_state:ReferralState;referral_profile:JsonObject;referral_guidance:JsonObject;
 referral_guidance_packet:Json;referral_guidance_file:Json;
 referral_records:ReferralPage<ReferralRecords[ReferralCollection]>;referral_record:ReferralRecords[ReferralCollection];
 referral_configuration_save:ReferralConfiguration;referral_edition_save:ReferralEdition;
 referral_review_profile:ReferralReview;referral_review_save:ReferralReview;referral_assessment_create:ReferralAssessment;
 referral_decision_save:ReferralDecision;referral_edition_comparison_create:ReferralComparison;
 referral_correction_preview:ReferralCorrectionPreview;referral_correction_apply:ReferralCorrection;
 referral_exchange_request_save:ReferralExchangeRequest;referral_monitoring_prepare:ReferralMonitoring;
 referral_handoff_prepare:ReferralHandoff;referral_receiving_save:ReferralReceiving;referral_export_prepare:ReferralExportPreparation;
 referral_assessment_tasks:ReferralPage<ReferralTask>;referral_assessment_findings:ReferralPage<ReferralFinding>;
 referral_assessment_cells:ReferralPage<ReferralFieldCell>;referral_assessment_decisions:ReferralPage<ReferralDecision>;
 referral_assessment_file:Json;referral_edition_changes:ReferralPage;referral_edition_changes_file:Json;
 referral_exchange_advance:ReferralExchangeOperation;referral_exchange_operation:ReferralExchangeOperation;
 referral_exchange_operation_file:Json;referral_exchange_operation_packet:Json;referral_handoff_packet:Json;
 referral_workspace_packet:Json;referral_workspace_import:JsonObject;referral_handoff_import:JsonObject;
 referral_published_examples_import:{source:Native.NativeRecord;archiveSha256:SHA256;resourceDocuments:number;referenceAssignments:Array<{member:string;sha256:SHA256;resourceType:string;logicalId:string;reviewedFullUrl:string}>};
}
export type GravityReferralActionResults=Omit<{
 [A in keyof Native.EltssActionResults]:InheritedResult<Native.EltssActionResults[A]>
},'state'>&{state:RetainedResult<NativeState>}&{
 [A in keyof ReferralAddedValues]:RetainedResult<ReferralAddedValues[A]>
};
export type GravityReferralAction=keyof GravityReferralActionArguments;
type Camel<S extends string>=S extends `${infer A}_${infer B}`?`${A}${Capitalize<Camel<B>>}`:S;
export type GravityReferralClient={
 readonly endpoint:string;
 call<A extends GravityReferralAction>(action:A|`merchant_gravity_referral_${A}`,args:GravityReferralActionArguments[A],options?:RequestOptions):Promise<GravityReferralActionResults[A]>;
 close():Promise<void>;readValue<T=Json>(options:ReadValueOptions):Promise<T>;
}&{[A in GravityReferralAction as Camel<A>]:(args:GravityReferralActionArguments[A],options?:RequestOptions)=>Promise<GravityReferralActionResults[A]>};
export interface DownloadSelection{workspace:WorkspaceAlias;exportId:SHA256;client?:GravityReferralClient;url?:string;tokenEnv?:string;environment?:Record<string,string|undefined>;signal?:AbortSignal}
export interface DownloadOptions extends DownloadSelection{
 directory:string;expectedManifestSha256?:SHA256;chunkSize?:number;onProgress?:(progress:JsonObject)=>void|Promise<void>;
}
export interface DownloadReceipt{
 schema:'stellar-forge.gravity-referral-file-receipt.v1';state:'COMPLETE'|'REOPENED';workspace:WorkspaceAlias;workspaceId:UUID;
 exportId:SHA256;manifestSha256:SHA256;directory:string;files:number;bytes:number;kind:ExportKind;source:JsonObject;resumed?:boolean;resumedBytes?:number;
}
export interface ReadValueOptions{
 workspace?:WorkspaceAlias;result?:RetainedResult<unknown>;exportId?:SHA256;file?:string;expectedManifestSha256?:SHA256;
 client?:GravityReferralClient;url?:string;tokenEnv?:string;environment?:Record<string,string|undefined>;signal?:AbortSignal;
}
export function openGravityReferralMerchantClient(options:ClientOptions):Promise<GravityReferralClient>;
export function openGravityReferralLocalClient(options:LocalClientOptions):Promise<GravityReferralClient>;
export function downloadGravityReferralExport(options:DownloadOptions):Promise<DownloadReceipt>;
export function inspectGravityReferralExport(options:DownloadSelection):Promise<{manifest:ExportManifest;manifestSha256:SHA256}>;
export function reopenGravityReferralExport(options:{directory:string;workspace:WorkspaceAlias;exportId:SHA256;expectedManifestSha256?:SHA256}):Promise<DownloadReceipt>;
export function readGravityReferralValue<T=Json>(options:ReadValueOptions):Promise<T>;
export const gravityReferralActions:Readonly<Record<GravityReferralAction,{name:string;description:string;inputSchema:JsonObject;annotations:JsonObject}>>;
