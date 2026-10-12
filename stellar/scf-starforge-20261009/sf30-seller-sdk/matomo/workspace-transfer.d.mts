export declare const MATOMO_PRODUCT_SCHEMA:"stellar-forge.matomo-authoring-workspace.v1";
export declare const MATOMO_PRODUCT_LIMITS:Readonly<{fileBytes:number;workspaceBytes:number;archiveBytes:number;members:number}>;
export interface MatomoArchivePin {bytes:string;sha256:string}
export interface MatomoProductOptions {python?:string;environment?:NodeJS.ProcessEnv;signal?:AbortSignal}
export interface MatomoProductFile extends MatomoArchivePin {path:string;mode:number}
export interface MatomoProductSnapshot {
 workspaceId:string;sourceSha256:string;source:Record<string,unknown>;revision:number;
 counts:Record<string,number>;workspace:MatomoArchivePin;database:MatomoArchivePin;
}
export interface MatomoProductManifest {
 schema:typeof MATOMO_PRODUCT_SCHEMA;export:{operationId:string;createdAt:string};
 snapshot:MatomoProductSnapshot;files:MatomoProductFile[];receiving:Record<string,unknown>;
}
export interface MatomoReceivingBudget {
 status:"ALREADY_EXCEEDS_EXPORT_POLICY"|"WITHIN_POLICY_BEFORE_NEW_METADATA";
 archiveBytes:string;originalFilesBytes:string;editableSourceCopyBytes:string;originalManifestBytes:string;
 minimumReexportExpandedBytes:string;remainingBeforeNewMetadataBytes:string;minimumReexportMembers:number;
 expandedLimitBytes:string;fileLimitBytes:string;memberLimit:number;reasons:string[];
 newMetadataAndLaterEditsIncluded:false;
}
export interface MatomoProductReceived {
 schema:"stellar-forge.matomo-product-received.v1";operationId:string;requestSha256:string;
 workspaceId:string;originalWorkspaceId:string;sourceSha256:string;archive:MatomoArchivePin;
 mode:"independent-editable-source";sourceCounts:Record<string,number>;receivingBudget:MatomoReceivingBudget;revision:number;
 completedAt:string;directory:string;currentRevision:number;reused:boolean;
}
export declare function exportMatomoProduct(input:MatomoProductOptions&{
 directory:string;archive:string;operationId:string;
}):Promise<{schema:"stellar-forge.matomo-product-export.v1";operationId:string;
 archive:MatomoArchivePin&{path:string};manifestSha256:string;snapshot:MatomoProductSnapshot;members:number;reused:boolean}>;
export declare function inspectMatomoProduct(input:MatomoProductOptions&{archive:string}):
 Promise<{archive:MatomoArchivePin;manifest:MatomoProductManifest;manifestSha256:string;members:number;receivingBudget:MatomoReceivingBudget}>;
export declare function receiveMatomoProduct(input:MatomoProductOptions&{
 archive:string;directory:string;operationId:string;allowLoopback?:boolean;
}):Promise<MatomoProductReceived>;
