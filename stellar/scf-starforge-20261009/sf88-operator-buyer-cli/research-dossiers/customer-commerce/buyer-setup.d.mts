/// <reference types="node" />
/** Configuration contains existing host selections and environment names, never credential values. */
export interface ResearchBuyerSetupInput {
 schema:'sf88-research-buyer-setup/v1';
 buyer:string; label?:string;
 /** Supply exactly one of operatorSettings or operator. */
 operatorSettings?:string;
 /** Alias in operators; derive the preset using the original read-only SF88 reader. */
 operator?:string;
 operators:Record<string,string>;
 /** Original full commerce host to copy while preserving every other declared alias. */
 commerceConfigurationFile?:string;
 /** Explicitly replace this buyer alias only in this setup's generated copy. */
 replaceBuyer?:boolean;
 maximumFileBytes?:number; maximumExportBytes?:number; maximumExports?:number;
}
export interface ResearchBuyerServeInput extends ResearchBuyerSetupInput {
 paidFileClaimEnvs:string[];
 approvalMode?:'BROWSER'|'TERMINAL';
 port?:number;
 launchFile?:never;
}
export interface ResearchBuyerAttachInput extends ResearchBuyerSetupInput {
 /** Actual complete startup JSON retained by the original Applications owner. */
 launchFile:string;
 paidFileClaimEnvs?:never; approvalMode?:never; port?:never;
}
export interface ResearchBuyerSetupOptions {
 directory:string;
 /** Required once; later calls reopen this exact setup and its retained preset. */
 inputFile?:string;
 signal?:AbortSignal;
}
export interface ResearchBuyerSetupAnnouncement {
 schema:'sf88-research-buyer-setup-record/v1';
 directory:string; mode:'serve'|'attach'; requestSha256:string; state:'READY';
 buyer:string; agentFile:string; commerceHostFile:string; launchFile:string;
 directoryBuyer:string; selectionSha256:string; instanceId:string; pid:number;
 url:string; approvalMode:'BROWSER'|'TERMINAL'; approvalAvailable:boolean;
 operator:{revision:string|null;settingsSha256:string;availability:Record<string,unknown>|null};
 configuration:{schema:'sf88-research-customer-commerce-host/v1';configurationFile:string;
  merchants:unknown[];buyers:unknown[];errors:Array<{kind:string;id:string;code:string}>};
 completedAt:string;
}
export interface ResearchBuyerWorkspace extends ResearchBuyerSetupAnnouncement {
 announcement:ResearchBuyerSetupAnnouncement;
 /** Drain the same original Buyer, then publish stopped state before its original lease retires. */
 close():Promise<void>;
}
export interface ResearchBuyerSetupStatus {
 schema:'sf88-research-buyer-setup-record/v1';directory:string;requestSha256:string;
 mode:'serve'|'attach';buyer:string;state:string;
 service:Record<string,unknown>;selection:Record<string,unknown>|null;adoption:Record<string,unknown>|null;
 agentFile:string;commerceHostFile:string;
 live?:{launch:Record<string,unknown>;operator:Record<string,unknown>};
}
export const RESEARCH_BUYER_SETUP_SCHEMA:'sf88-research-buyer-setup/v1';
export const RESEARCH_BUYER_SETUP_COMMANDS:readonly string[];
export const RESEARCH_BUYER_SETUP_USAGE:string;
export function serveResearchBuyerWorkspace(options:ResearchBuyerSetupOptions):Promise<ResearchBuyerWorkspace>;
export function attachResearchBuyerWorkspace(options:ResearchBuyerSetupOptions):Promise<ResearchBuyerSetupAnnouncement>;
export function readResearchBuyerSetup(options:{directory:string;live?:boolean;signal?:AbortSignal}):Promise<ResearchBuyerSetupStatus>;
export function mainResearchBuyerSetup(argv:string[],streams?:{stdout?:NodeJS.WritableStream;stderr?:NodeJS.WritableStream}):Promise<number>;

export function deriveResearchBuyerOperator(operatorDirectory:string):Promise<{
 value:Record<string,unknown>;source:{mode:'ORIGINAL_SF88_READ_ONLY_WORKSPACE';directory:string;
 files:Array<{name:string;sha256:string;bytes:number}>;network:string;asset:string;payer:string;
 policyLimits:{maxTotalAtomic:string;maxDailyAtomic:string}};
}>;
