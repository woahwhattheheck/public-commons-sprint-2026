// MIT. Arguments generated from the ORIGINAL source-owned Matomo tool catalog.
// Integer ranges, string patterns and source constraints remain enforced by that
// catalog and native owner. Native values are returned unchanged, not coerced.
export type JsonValue = null | boolean | number | string | JsonValue[] | {[key:string]:JsonValue};
export type JsonObject = {[key:string]:JsonValue};
export type MatomoOriginalTable = 'actions'|'history'|'merchants'|'merchant_packages'|'deliveries'|'handovers'|'receivings'|'catalogs'|'captures'|'editions'|'comparisons'|'edition_reviews'|'comparison_reviews';
export interface MatomoToolArguments {
  "merchant_matomo_original_records": { "workspace": string; "table"?: MatomoOriginalTable; "offset"?: number; "limit"?: number; };
  "merchant_matomo_original_files": { "workspace": string; "offset"?: number; "limit"?: number; };
  "merchant_matomo_original_merchant": { "workspace": string; "originalMerchantId": string; };
  "merchant_matomo_merchant_adopt_original": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "originalMerchantId": string; };
  "merchant_matomo_workspaces": Record<string, never>;
  "merchant_matomo_open": { "workspace": string; };
  "merchant_matomo_close": { "workspace": string; "instanceId": string; };
  "merchant_matomo_status": { "workspace": string; };
  "merchant_matomo_operation": { "workspace": string; "operationId": string; };
  "merchant_matomo_cancel": { "workspace": string; "workspaceInstanceId": string; "operationId": string; };
  "merchant_matomo_catalog": { "workspace": string; "catalogId": string; "part"?: "summary" | "reports" | "segments"; "offset"?: number; "limit"?: number; };
  "merchant_matomo_capture": { "workspace": string; "captureId": string; };
  "merchant_matomo_rows": { "workspace": string; "captureId": string; "tableId"?: string; "offset"?: number; "limit"?: number; };
  "merchant_matomo_edition": { "workspace": string; "editionId": string; };
  "merchant_matomo_edition_rows": { "workspace": string; "editionId": string; "tableId"?: string; "offset"?: number; "limit"?: number; };
  "merchant_matomo_comparison": { "workspace": string; "comparisonId": string; "kind"?: string; "offset"?: number; "limit"?: number; };
  "merchant_matomo_merchant": { "workspace": string; "merchantId": string; };
  "merchant_matomo_preview": { "workspace": string; "merchantId": string; "draftRevision": string; "query": string; "input"?: { [key: string]: JsonValue; }; };
  "merchant_matomo_releases": { "workspace": string; };
  "merchant_matomo_release_diff": { "workspace": string; "before"?: string | null; "after": string; };
  "merchant_matomo_delivery": { "workspace": string; "deliveryId": string; "query"?: string; };
  "merchant_matomo_handover": { "workspace": string; "handoverId": string; };
  "merchant_matomo_receiving": { "workspace": string; "receivingId": string; };
  "merchant_matomo_receiving_rows": { "workspace": string; "receivingId": string; "offset"?: number; "limit"?: number; };
  "merchant_matomo_source_read": { "workspace": string; "sourceRequestId": string; };
  "merchant_matomo_artifact_read": { "workspace": string; "artifact": "capture" | "edition" | "database" | "comparison" | "delivery" | "handover" | "source" | "workspace-origin" | "workspace-archive" | "workspace-original"; "id": string; "kind"?: "csv" | "config" | "manifest" | "archive" | "scan"; "readId"?: string; "expectedSha256"?: string; "offset"?: number; "limit"?: number; };
  "merchant_matomo_artifact_release": { "workspace": string; "readId": string; };
  "merchant_matomo_discover": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "scope": { "period": "day" | "week" | "month" | "year" | "range"; "date": string; "segment"?: string; "language"?: string; }; };
  "merchant_matomo_discover_resume": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "catalogId": string; };
  "merchant_matomo_capture_start": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "selection": { "schema": "stellar-forge.matomo-report-selection.v1"; "catalogId": string; "reportId": string; "scope": { "period": "day" | "week" | "month" | "year" | "range"; "date": string; "segment"?: string; "language"?: string; }; "pageSize"?: number; "maxRows"?: number; "maxRequests"?: number; "maxBytes"?: number; "maxDepth"?: number; "subtables"?: boolean; "subtableRules"?: { [key: string]: string; }; "note"?: string; }; };
  "merchant_matomo_capture_resume": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "captureId": string; "limits"?: { "maxRows"?: number; "maxRequests"?: number; "maxBytes"?: number; "maxDepth"?: number; }; "subtableRules"?: { [key: string]: string; }; "note"?: string; };
  "merchant_matomo_edition_build": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "captureId": string; "label": string; "note": string; };
  "merchant_matomo_edition_resume": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "editionId": string; };
  "merchant_matomo_edition_review": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "editionId": string; "editionSha256": string; "reviewer": string; "decision": "approved" | "changes_requested"; "note": string; };
  "merchant_matomo_comparison_start": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "leftEditionId": string; "rightEditionId": string; "mapping": { "keys": Array<{ "name": string; "left": { "source": "data" | "metadata" | "path" | "report"; "name"?: string; }; "right": { "source": "data" | "metadata" | "path" | "report"; "name"?: string; }; "mode"?: "native" | "decimal"; }>; "fields": Array<{ "name": string; "left": { "source": "data" | "metadata" | "path" | "report"; "name"?: string; }; "right": { "source": "data" | "metadata" | "path" | "report"; "name"?: string; }; "mode"?: "native" | "decimal"; }>; "note": string; }; };
  "merchant_matomo_comparison_resume": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "comparisonId": string; };
  "merchant_matomo_comparison_review": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "comparisonId": string; "manifestSha256": string; "findingId"?: string; "reviewer": string; "decision": "accepted" | "follow_up" | "changes_requested"; "note": string; };
  "merchant_matomo_merchant_configure": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "editionId": string; "configuration": { "merchant": { "name": string; "origin": string; "network": string; "asset": string; "payTo": string; "maxTimeoutSeconds"?: number; }; "amount": string; "fields"?: Array<string>; "path"?: string; }; };
  "merchant_matomo_merchant_resume": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "merchantId": string; };
  "merchant_matomo_merchant_save": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "merchantId": string; "draftRevision": string; "draft": { [key: string]: JsonValue; }; };
  "merchant_matomo_package_export": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "merchantId": string; "draftRevision": string; "name": string; };
  "merchant_matomo_package_recover": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "packageId": string; };
  "merchant_matomo_release_stage": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "packageId": string; "releaseId": string; "label": string; "runtime"?: { "port"?: number; "facilitator"?: string; "allowLocalFacilitator"?: boolean; }; };
  "merchant_matomo_release_select": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "releaseId": string; "expectedGeneration": number; "reason": string; "rollback"?: boolean; };
  "merchant_matomo_release_start": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "expectedGeneration": number; };
  "merchant_matomo_release_stop": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "instanceId": string; };
  "merchant_matomo_release_console_open": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; };
  "merchant_matomo_delivery_prepare": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "editionId": string; "projection": "report-rows" | "source-files"; "label": string; "note": string; };
  "merchant_matomo_delivery_recover": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "deliveryId": string; };
  "merchant_matomo_delivery_review": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "deliveryId": string; "reviewer": string; "note": string; "initialize"?: boolean; "expectedSnapshot"?: string; "expectedTargetRevision"?: number; };
  "merchant_matomo_delivery_publish": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "deliveryId": string; "reviewId": string; };
  "merchant_matomo_handover_prepare": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "deliveryId": string; "reviewer": string; "note": string; "limit"?: number; };
  "merchant_matomo_handover_resume": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "handoverId": string; };
  "merchant_matomo_receiving_receive": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "handoverId": string; "label": string; };
  "merchant_matomo_receiving_resume": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "receivingId": string; };
  "merchant_matomo_receiving_reopen": { "workspace": string; "workspaceInstanceId": string; "operationId": string; "expectedRevision": number; "receivingId": string; };
}
export type MatomoToolName = keyof MatomoToolArguments;
export type MatomoMutationName = "merchant_matomo_merchant_adopt_original" | "merchant_matomo_discover" | "merchant_matomo_discover_resume" | "merchant_matomo_capture_start" | "merchant_matomo_capture_resume" | "merchant_matomo_edition_build" | "merchant_matomo_edition_resume" | "merchant_matomo_edition_review" | "merchant_matomo_comparison_start" | "merchant_matomo_comparison_resume" | "merchant_matomo_comparison_review" | "merchant_matomo_merchant_configure" | "merchant_matomo_merchant_resume" | "merchant_matomo_merchant_save" | "merchant_matomo_package_export" | "merchant_matomo_package_recover" | "merchant_matomo_release_stage" | "merchant_matomo_release_select" | "merchant_matomo_release_start" | "merchant_matomo_release_stop" | "merchant_matomo_release_console_open" | "merchant_matomo_delivery_prepare" | "merchant_matomo_delivery_recover" | "merchant_matomo_delivery_review" | "merchant_matomo_delivery_publish" | "merchant_matomo_handover_prepare" | "merchant_matomo_handover_resume" | "merchant_matomo_receiving_receive" | "merchant_matomo_receiving_resume" | "merchant_matomo_receiving_reopen";
export interface MatomoToolMetadata {
 name:MatomoToolName; description:string; inputSchema:JsonObject;
 annotations?:Readonly<{readOnly?:boolean;idempotent?:boolean;destructive?:boolean;openWorld?:boolean}>;
}
export const MATOMO_CLIENT_TOOLS: readonly Readonly<MatomoToolMetadata>[];
export interface MatomoCallOptions {signal?:AbortSignal;timeoutMs?:number;}
export interface MatomoConnection extends MatomoCallOptions {
 url:string|URL; tokenEnv?:string; environment?:Record<string,string|undefined>;
}
export interface MatomoWorkspaceEntry {
 workspace:string;label:string;workspaceId:string;workspaceIdentity:string;
 open:boolean;opening:boolean;closing:boolean;instanceId:string|null;browserUrl:string|null;
}
export interface MatomoWorkspaceInventory {
 configured:boolean;closing:boolean;workspaces:MatomoWorkspaceEntry[];
 [key:string]:unknown;
}
export interface MatomoWorkspaceState {
 workspace:string;instanceId:string;workspaceIdentity:string;browserUrl:string;
 native:JsonObject & {workspaceId:string;revision:number};
 artifactReads:JsonValue;
}
export interface MatomoOperationInspection {
 workspace:string;instanceId:string;action:JsonObject|null;active:JsonValue;revision:number;
}
export interface MatomoMutationResult {
 workspace:string;instanceId:string;result:JsonValue;revision:number;
}
export interface MatomoArtifactFile {name:string;contentType:string;bytes:number;sha256:string;}
export interface MatomoArtifactChunk {
 readId:string;file:MatomoArtifactFile;offset:number;bytesRead:number;
 nextOffset:number|null;encoding:'base64';data:string;
}
export interface MatomoOriginalSource {
 schema:"stellar-forge.matomo-received-source.v1";operationId:string;workspaceId:string;
 originalWorkspaceId:string;sourceSha256:string;archive:{bytes:string;sha256:string};
 originalRevision:number;receivedAt:string;mode:"independent-editable-source";
 counts:Record<string,number>;manifestSha256:string;receivingBudget:JsonObject|null;
}
export interface MatomoOriginalRecords {
 workspace:string;origin:MatomoOriginalSource;
 page:{table:MatomoOriginalTable;offset:number;limit:number;total:number;rows:JsonObject[]};
}
export interface MatomoOriginalFiles {
 workspace:string;files:{offset:number;limit:number;total:number;
 rows:Array<{path:string;bytes:string;sha256:string;mode:number;id:string}>};
}
export interface MatomoOriginalMerchant {
 merchant:JsonObject;draft:JsonObject;configuration:JsonObject;editionId:string;provenance:JsonObject;
}
export type MatomoToolResult<N extends MatomoToolName> =
 N extends 'merchant_matomo_original_records' ? MatomoOriginalRecords :
 N extends 'merchant_matomo_original_files' ? MatomoOriginalFiles :
 N extends 'merchant_matomo_original_merchant' ? MatomoOriginalMerchant :
 N extends 'merchant_matomo_workspaces' ? MatomoWorkspaceInventory :
 N extends 'merchant_matomo_open'|'merchant_matomo_status' ? MatomoWorkspaceState :
 N extends 'merchant_matomo_operation' ? MatomoOperationInspection :
 N extends 'merchant_matomo_artifact_read' ? MatomoArtifactChunk :
 N extends 'merchant_matomo_artifact_release' ? {workspace:string;released:string} :
 N extends MatomoMutationName ? MatomoMutationResult : JsonObject;
/** A failed mutation keeps the original identity; it does not authorize a retry. */
export interface MatomoOperationReference {
 tool:MatomoMutationName;workspace:string;operationId:string;
 expectedRevision:number;workspaceInstanceId:string;next?:string;
}
export interface MatomoClientError extends Error {
 code?:string;matomoOperation?:MatomoOperationReference;
 cleanup?:{code:string;readId?:string};
}
/** The client owns its requests/read handles. The host owns the workspace. */
export class MatomoClient {
 private constructor();
 readonly endpoint:string;readonly pendingRequests:number;readonly closing:boolean;
 readonly retainedReads:Array<{readId:string;workspace:string}>;
 call(name:'merchant_matomo_workspaces',args?:MatomoToolArguments['merchant_matomo_workspaces'],options?:MatomoCallOptions):Promise<MatomoWorkspaceInventory>;
 call<N extends MatomoToolName>(name:N,args:MatomoToolArguments[N],options?:MatomoCallOptions):Promise<MatomoToolResult<N>>;
 workspaces(options?:MatomoCallOptions):Promise<MatomoWorkspaceInventory>;
 openWorkspace(workspace:string,options?:MatomoCallOptions):Promise<MatomoWorkspaceState>;
 status(workspace:string,options?:MatomoCallOptions):Promise<MatomoWorkspaceState>;
 operation(workspace:string,operationId:string,options?:MatomoCallOptions):Promise<MatomoOperationInspection>;
 closeWorkspace(workspace:string,instanceId:string,options?:MatomoCallOptions):Promise<JsonObject>;
 releaseArtifact(workspace:string,readId:string):Promise<{workspace:string;released:string;ownerClosed?:boolean}>;
 close():Promise<void>;
}
export function connectMatomoClient(configuration:MatomoConnection):Promise<MatomoClient>;
