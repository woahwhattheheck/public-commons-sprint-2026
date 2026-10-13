// Declaration-only .js resolution selects the shipped client.d.ts; runtime imports client.mjs.
import { LineageClient } from "./client.js";
export interface ServicePolicyInput {
 id:string|null; title:string; jobKey:string; owner?:string; runbook?:string; enabled?:boolean; effectiveFrom:string;
 maxCompletionAgeSeconds?:number|null; maxDurationSeconds?:number|null; failureWindowSeconds?:number; monitorFailures?:boolean;
}
export interface NormalizedServicePolicy extends Required<ServicePolicyInput> {}
export interface ServicePolicy extends NormalizedServicePolicy {
 id:string; version:number; reason:string; createdAt:string; updatedAt:string;
 history:Array<Omit<ServicePolicy,"history">>;
}
export interface PolicyPlanRow {rowId:string;expectedVersion:number|null;policy:ServicePolicyInput;}
export interface PolicyPlan {schema:"commons.openlineage.service-policy-plan.v1";title:string;reason:string;rows:PolicyPlanRow[];}
export interface PolicyFieldChange {field:string;before:{present:boolean;value:unknown};after:{present:true;value:unknown};}
export type PolicyChange="CREATE"|"UPDATE"|"UNCHANGED";
export interface PolicyPreviewRow {
 rowId:string;change:PolicyChange;expectedVersion:number|null;before:ServicePolicy|null;
 after:NormalizedServicePolicy&{version:number};fields:PolicyFieldChange[];
}
export interface PolicyCounts {total:number;create:number;update:number;unchanged:number;}
export interface ObservedPolicyJob {key:string;namespace:string;name:string;eventIds:string[];runKeys:string[];[key:string]:unknown;}
export interface PolicyPreview {
 schema:"commons.openlineage.service-policy-preview.v1";workspaceId:string;sourceRevision:number;plan:PolicyPlan;
 source:{eventIds:string[];sourceIds:string[];jobs:ObservedPolicyJob[]};rows:PolicyPreviewRow[];counts:PolicyCounts;previewSha256:string;
}
export interface PolicyRolloutSummary {
 id:string;title:string;reason:string;createdAt:string;operationId:string;sourceRevision:number;committedRevision:number;
 previewSha256:string;rolloutSha256:string;counts:PolicyCounts;
}
export interface PolicyRollout {
 schema:"commons.openlineage.service-policy-rollout.v1";id:string;title:string;reason:string;createdAt:string;
 operationId:string;sourceRevision:number;committedRevision:number;previewSha256:string;preview:PolicyPreview;
 policies:Array<{rowId:string;change:PolicyChange;before:ServicePolicy|null;after:ServicePolicy}>;rolloutSha256:string;
}
export interface PolicyRolloutRequest {operationId:string;expectedRevision:number;plan:PolicyPlan;expectedPreviewSha256:string;}
export interface PolicyRolloutReceipt {
 workspaceId:string;revision:number;operationId:string;replayed?:boolean;rollout:PolicyRolloutSummary;
 policies:Array<{id:string;version:number;jobKey:string}>;
}
export type PolicyRolloutRequestObservation =
 {found:false;workspaceId:string;revision:number;requestHash:string} |
 {found:true;workspaceId:string;revision:number;requestHash:string;result:PolicyRolloutReceipt};
export class PolicyRolloutClient extends LineageClient {
 readPolicyRollouts():Promise<{workspaceId:string;revision:number;jobs:ObservedPolicyJob[];policies:ServicePolicy[];rollouts:PolicyRolloutSummary[]}>;
 previewPolicyRollout(plan:PolicyPlan):Promise<PolicyPreview>;
 applyPolicyRollout(args:PolicyRolloutRequest):Promise<PolicyRolloutReceipt>;
 getPolicyRollout(id:string):Promise<{workspaceId:string;revision:number;rollout:PolicyRollout}>;
 policyRolloutReport(id:string,format?:"json"|"csv"|"html"):Promise<{mediaType:string;text:string}>;
 findPolicyRolloutRequest(args:PolicyRolloutRequest):Promise<PolicyRolloutRequestObservation>;
}
