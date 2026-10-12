/** Original DBnomics analyst/publication/merchant/customer receiving. */
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export type ObjectValue = {[key:string]:Json};
export interface CustomerSelection {
 id:string;configFile:string;operatorWorkspace:string;pageSize:number;maxPages:number;
 maxTotalAtomic:string;maxPageBytes?:number;acceptIndex?:number;
}
export interface NativeReleaseSelection {
 paymentFile:string;origin:string;path?:string;outputDirectory:string;releaseDirectory?:string;
 id?:string;label?:string;runtime?:ObjectValue;
 activationOptions?:{expectedGeneration:number;reason?:string;receivingReview?:ObjectValue};
 runOptions?:ObjectValue;
}
export interface ReceivingNote {
 id:string;seriesId?:string|null;period?:string|null;author:string;tag?:string;text:string;
}
export interface ReceivingConfig {
 schema:'stellar-forge.dbnomics-receiving.v1';id:string;
 source:{kind:'example'}|{kind:'import';file:string;expectedSha256?:string}|
  {kind:'live';selection:{title:string;seriesIds:string[]};rights?:ObjectValue;timeoutMs?:number};
 reviewer:string;reviewNote:string;notes?:ReceivingNote[];
 reports?:{name:string;spec:ObjectValue}[];
 query:{name:string;seriesIds?:string[];start?:string|null;end?:string|null;includeMissing?:boolean;analysis?:ObjectValue|null};
 receivingDirectory?:string;release?:NativeReleaseSelection;customer?:CustomerSelection;
 waitMs?:number;expectedRows?:number;
}
export interface ReceivingFile {path:string;filename?:string;bytes:number;sha256:string}
export interface ReceivingResult {
 schema:'stellar-forge.dbnomics-receiving-result.v1';operationId:string;projectId:string;directory:string;
 capture:ObjectValue;notes:ObjectValue;reports:ObjectValue[];query:string;planId:number;runId:string;
 snapshot:string;publishedRows:number;publication:ObjectValue;release:ObjectValue|null;customer:ObjectValue|null;
 sourceHandover:{path:string;bundleSha256:string};receiving:ObjectValue;reopened:ObjectValue;
 files:ReceivingFile[];completedAt:string;replayed:boolean;
}
export function receiveDbnomics(options:{directory:string;config:ReceivingConfig;print?:(value:ObjectValue)=>void}):Promise<ReceivingResult>;
