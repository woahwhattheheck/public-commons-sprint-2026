// MIT. Complete original case procedure, source selection and receiving contract.
import type {OperatingPlan,OperatingRevision,OperatingPlanSummary} from '../../../scf-starforge-20261009/distribution/discovery/operating-plan.mjs';
import type {GrantCaseView,GrantObject,GrantInstallationEdition,GrantTaskOutcomeView} from './agent-client.mjs';
export const GRANT_PROCEDURE_SCHEMA: 'stellar-forge.sf47-grant-procedure.v1';
export const GRANT_PROCEDURE_REPORT_SCHEMA: 'stellar-forge.sf47-grant-procedure.v1.inspection';
export const GRANT_PROCEDURE_MAX_BYTES: number;
export const GRANT_PROCEDURE_PREFIX: 'grant-procedure-';
export interface RetainedProcedureText {text:string;bytes:number;sha256:string}
export interface ProcedureSource {
 id:string;filename:string;mediaType:string;kind:string;sourceUrl:string;observedAt:string;
 bytes:number;sha256:string;createdAt:string;[field:string]:unknown;
}
export interface ProcedureNativePlan extends GrantObject {
 id:string;revision:number;contentSha256:string;planning:GrantObject & {sourceTables?:GrantObject};
}
export interface ProcedureCase extends GrantCaseView {
 program:GrantCaseView['program'] & {planId:string;planRevision:number;mode:'OPERATIONS'|'WALKTHROUGH';state:'OPEN'|'CLOSED';origin?:GrantObject};
 plan:ProcedureNativePlan;sources:ProcedureSource[];
}
export interface ProcedureCaseSelection {
 id:string;version:number;name:string;mode:'OPERATIONS'|'WALKTHROUGH';state:'OPEN'|'CLOSED';origin:GrantObject;
 plan:{id:string;revision:number;contentSha256:string};
}
export interface ProcedureTableBinding {
 role:string;documentId:string;resourceId:string;editionId:string;editionSha256:string|null;
 selectedReviewId:string|null;baselineReviewId:string|null;rows:number;sourceRecords:number;
 summary:GrantObject;binding:GrantObject;mapping:GrantObject;
}
export interface ProcedureTableSelection {
 id:string;name:string;baseline:GrantObject;appliedReviewId:string|null;bindings:ProcedureTableBinding[];
}
export interface ProcedureTable {
 key:string;origin:'case-plan'|'case-source'|'local-original';metadata:ProcedureSource|null;
 /** Full original pinned plan for case-plan; null for other origins. */
 nativePlan:RetainedProcedureText|null;original:RetainedProcedureText;selection:ProcedureTableSelection;
}
export type ProcedureEditionKind='installation'|'task-outcome';
export interface ProcedureEditionRef {id:string;revision:number;sha256:string}
export interface ProcedureEdition {kind:ProcedureEditionKind;ref:ProcedureEditionRef;original:RetainedProcedureText}
export interface ProcedureStepLinks {stepId:string;sourceIds:string[];tableKeys:string[];editionKeys:string[];note:string}
export interface ProcedureParent {
 sourceId:string;bytes:number;sha256:string;editionId:string;operatingPlanId:string;headRevision:number;
}
export interface GrantProcedure {
 schema:typeof GRANT_PROCEDURE_SCHEMA;editionId:string;createdAt:string;actor:string;note:string;
 case:ProcedureCaseSelection;nativePlan:RetainedProcedureText;operatingPlan:RetainedProcedureText;selectedRevision:number;
 sourceTables:ProcedureTable[];editions:ProcedureEdition[];sources:ProcedureSource[];stepLinks:ProcedureStepLinks[];
 parent:ProcedureParent|null;
}
export interface ProcedureInspection {
 document:GrantProcedure;plan:OperatingPlan;selected:OperatingRevision;nativePlan:ProcedureNativePlan;summary:OperatingPlanSummary;
}
export interface PreparedGrantProcedure extends ProcedureInspection {raw:string;bytes:number;sha256:string;filename:string}
export interface ProcedureVerification {
 schema:typeof GRANT_PROCEDURE_REPORT_SCHEMA;editionId:string;operatingPlanId:string;selectedRevision:number;headRevision:number;
 originalCase:ProcedureCaseSelection;receivingCase:ProcedureCaseSelection;sourceId:string|null;sameCase:boolean;currentPlanMatches:boolean;
 verifiedSources:{id:string;bytes:number;sha256:string}[];
 verifiedEditions:(ProcedureEditionRef & {kind:ProcedureEditionKind})[];
 verifiedParentSources:string[];sourceTables:{key:string;origin:ProcedureTable['origin'];selection:ProcedureTableSelection}[];
 stepLinks:ProcedureStepLinks[];summary:OperatingPlanSummary;interpretation:string;
}
export interface ProcedureReaders {
 current:ProcedureCase;
 readSource:(sourceId:string)=>Promise<Uint8Array>;
 readEdition?:(kind:ProcedureEditionKind,ref:ProcedureEditionRef)=>Promise<GrantInstallationEdition|GrantTaskOutcomeView>;
 sourceId?:string|null;verifyParents?:boolean;
}
export interface PrepareGrantProcedureInput {
 current:ProcedureCase;operatingPlanText:string;selectedRevision?:number;actor:string;note?:string;createdAt?:string;editionId?:string;
 sourceTables?:ProcedureTable[];editions?:ProcedureEdition[];sourceIds?:string[];stepLinks?:ProcedureStepLinks[];
 parent?:{metadata:ProcedureSource;original:RetainedProcedureText}|null;
}
export class GrantProcedureError extends Error {code:string;constructor(code:string,message:string,details?:Record<string,unknown>)}
export function procedureJSON(value:unknown):string;
export function procedureCanonical(value:unknown):string;
export function procedureSha256(value:string|Uint8Array):Promise<string>;
export function packProcedureText(value:string):Promise<RetainedProcedureText>;
export function unpackProcedureText(value:RetainedProcedureText):Promise<GrantObject>;
export function makeProcedureTable(input:{key:string;origin:ProcedureTable['origin'];originalText:string;metadata?:ProcedureSource|null;nativePlanText?:string|null}):Promise<ProcedureTable>;
export function makeProcedureEdition(kind:ProcedureEditionKind,originalText:string):Promise<ProcedureEdition>;
export function inspectGrantProcedure(input:string|GrantProcedure):Promise<ProcedureInspection>;
export function prepareGrantProcedure(input:PrepareGrantProcedureInput):Promise<PreparedGrantProcedure>;
export function verifyGrantProcedure(input:string|GrantProcedure,readers:ProcedureReaders):Promise<ProcedureVerification>;
export function procedureCandidates(current:ProcedureCase):ProcedureSource[];
/** Full selected source plus readable documents; original case.zip is added by native export. */
export function grantProcedureFiles(input:string|GrantProcedure,verification?:ProcedureVerification|null):Promise<Record<string,string>>;
