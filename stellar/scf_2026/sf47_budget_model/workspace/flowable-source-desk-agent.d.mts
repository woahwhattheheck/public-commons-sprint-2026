// SPDX-License-Identifier: MIT
import type {Buffer} from 'node:buffer';
import type {GrantJsonResponse,GrantNativeResponse,GrantObject} from './agent-client.mjs';
export const FLOWABLE_SOURCE_DESK_SCHEMA:'stellar-forge.flowable-source-desk.v1';
export const FLOWABLE_SOURCE_DESK_MAX_FILE:number;
export type FlowableSourceKind='archive'|'seed'|'bindings'|'commissioning'|'attachment';
export interface FlowableSourceFile extends GrantObject {
 fileId:string;kind:string;name:string;bytes:number;sha256:string;schema:string;
 /** Download-only aliases. No host filesystem path is exposed. */
 id?:string;filename?:string;
}
export interface FlowableSourceRequest extends GrantObject {requestId:string}
export interface FlowableSourceCatalogueInput extends FlowableSourceRequest {archiveId:string}
export interface FlowableSourceInspectionInput extends FlowableSourceCatalogueInput {
 programmeId:string;programmeRevision:number;expectedProgrammeSha256:string;expectedBasisSha256:string;
}
export interface FlowableSourceTemplateInput extends FlowableSourceRequest {
 inspectionId:string;seedId:string;commissioningId:string;nativeCaseId:string;
 /** Capture once with the original request UUID; retain on uncertain replay. */
 expectedVersion:number;
}
export interface FlowableSourcePreparationInput extends FlowableSourceTemplateInput {
 bindingsId:string;attachments?:Array<{fileId:string;name:string;purpose:string}>;
}
export interface FlowableSourceResult extends GrantObject {
 schema:'stellar-forge.flowable-installation-preparation-service.v1.result';
 type:string;requestId:string;caseId?:string;files:FlowableSourceFile[];
 /** Complete original Python-facing input, including the retained case version. */
 request?:FlowableSourceRequest;
 nativeRequest?:GrantObject|null;
 status?:'COMPLETE';
}
export interface FlowableSourceCatalogue extends FlowableSourceResult {
 archiveId:string;archive:GrantObject;workspaceId:string;programmes:GrantObject[];completeArchiveSummary:GrantObject;
}
export interface FlowableSourceTemplate extends FlowableSourceResult {
 inspectionId:string;seedId:string;commissioningId:string;nativeCaseId:string;bindings:GrantObject;
 seed:GrantObject;profile:GrantObject;commercial:GrantObject;source:GrantObject;
}
export interface FlowableSourcePreparation extends FlowableSourceResult {
 inspectionId:string;nativeCaseId:string;archiveId:string;archive:GrantObject;
 source:GrantObject;workshareCaseId:string;preparationSha256:string;
 installation:{source:GrantObject;workshareCaseId:string;document:GrantObject;preview:GrantObject;selections:GrantObject};
 nativeSource?:GrantObject;nativePreview?:GrantObject|null;requiresCurrentPreview?:boolean;
 readyReceiving?:{expectedPreparationSha256:string};
}
export interface FlowableSourcePending extends GrantObject {
 schema:'stellar-forge.flowable-installation-preparation-service.v1.pending';
 requestId:string;status:'NOT_RECORDED'|'PENDING';type?:string;request:FlowableSourceRequest|null;
 files?:FlowableSourceFile[];
}
export interface FlowableSourceList extends GrantObject {
 offset:number;limit:number;total:number;nextOffset:number|null;
 rows:Array<{requestId:string;type:string;status:'PENDING'|'COMPLETE';request:FlowableSourceRequest;files:FlowableSourceFile[]}>;
}
export interface FlowableSourceInputs {
 import:{caseId:string;requestId:string;kind:FlowableSourceKind;name:string;bytes:Buffer|Uint8Array;sha256:string};
 catalogue:{caseId:string;body:FlowableSourceCatalogueInput};
 inspect:{caseId:string;body:FlowableSourceInspectionInput};
 template:{caseId:string;body:FlowableSourceTemplateInput};
 prepare:{caseId:string;body:FlowableSourcePreparationInput};
 request:{caseId:string;requestId:string};
 'archive-describe':{caseId:string;requestId:string};
 list:{caseId:string;offset?:number;limit?:number};
 file:{caseId:string;fileId:string;expectedSha256:string};
 'file-describe':{caseId:string;fileId:string};
 'source-file':{caseId:string;inspectionId:string;path:string;expectedSha256:string};
 'source-file-describe':{caseId:string;inspectionId:string;path:string};
}
export interface FlowableSourceResponses {
 import:GrantJsonResponse<FlowableSourceResult & {file:FlowableSourceFile}>;
 catalogue:GrantJsonResponse<FlowableSourceCatalogue>;
 inspect:GrantJsonResponse<FlowableSourceResult>;
 template:GrantJsonResponse<FlowableSourceTemplate>;
 prepare:GrantJsonResponse<FlowableSourcePreparation>;
 request:GrantJsonResponse<FlowableSourceResult|FlowableSourcePending>;
 'archive-describe':GrantJsonResponse<FlowableSourceFile>;
 list:GrantJsonResponse<FlowableSourceList>;
 file:GrantNativeResponse;
 'file-describe':GrantJsonResponse<FlowableSourceFile>;
 'source-file':GrantNativeResponse;
 'source-file-describe':GrantJsonResponse<FlowableSourceFile>;
}
export interface FlowableSourcePlan<K extends keyof FlowableSourceInputs=keyof FlowableSourceInputs> {
 action:K;input:FlowableSourceInputs[K];route:string;options:GrantObject;
}
export function planFlowableSourceOperation<K extends keyof FlowableSourceInputs>(action:K,input:FlowableSourceInputs[K]):FlowableSourcePlan<K>;
export function performFlowableSourceOperation<K extends keyof FlowableSourceInputs>(plan:FlowableSourcePlan<K>,
 send:(route:string,options:GrantObject)=>Promise<GrantNativeResponse>):Promise<FlowableSourceResponses[K]>;
