import type {Currency,DateOnly,InvoiceSummary,MutationContext,MutationResult} from './client.d.ts';
export interface CashPlanOverride {invoiceId:string;mode:'DATE'|'EXCLUDE';expectedDate:DateOnly|null;reason:string}
export interface CashPlanInput {
  title:string;owner:string;note?:string;asOf:DateOnly;through:DateOnly;bucket?:'DAY'|'WEEK'|'MONTH';
  customerId?:string|null;pastDueDelayDays?:number;futureDelayDays?:number;
  usePromises?:boolean;disputes?:'SEPARATE'|'INCLUDE';overrides?:CashPlanOverride[];
}
export interface CashPlanTerms extends Required<CashPlanInput> {}
export interface CashPlanSourceIssue {code:string;message:string;sourceId:string|null}
export interface CashPlanLine {
  invoiceId:string;invoiceNumber:string;customerId:string;customerName:string;currency:Currency;
  source:'INVOICE'|'INSTALLMENT'|'PROMISE'|'DISPUTED'|'REVIEW_REQUIRED'|'OPERATOR_DATE'|'OPERATOR_SEPARATED';
  sourceId:string;planId?:string;editionId?:string;caseId?:string;originalDate:DateOnly;expectedDate:DateOnly|null;
  position:'WITHIN_HORIZON'|'AFTER_HORIZON'|'SEPARATED';amount:string;reason:string;sourceIssues:string[];
}
export interface CashPlanCurrency {
  currency:Currency;invoices:number;amountDue:string;withinHorizon:string;afterHorizon:string;separated:string;reviewRequired:string;
  periods:Array<{from:DateOnly;through:DateOnly;amount:string;cumulative:string}>;
}
export interface CashPlanInvoice extends InvoiceSummary {
  invoiceDocumentSha256:string;
  plan:{id:string;editionId:string;scheduleSha256:string;baselineChanged:boolean}|null;
  applicablePlanIds:string[];
  case:{id:string;version:number;status:string;promiseId:string|null;disputeId:string|null}|null;
  promiseBasis:{asOf:DateOnly;retained:InvoiceSummary;recomputed:InvoiceSummary;changed:boolean;
    laterAllocated:string;remainingBeforeCap:string}|null;
  issues:CashPlanSourceIssue[];override:CashPlanOverride|null;withinHorizon:string;afterHorizon:string;separated:string;reviewRequired:string;
}
export interface CashPlanProjection {
  schema:'stellar-forge.merchant-cash-forecast.v1';plan:CashPlanTerms;invoices:CashPlanInvoice[];
  lines:CashPlanLine[];currencies:CashPlanCurrency[];
  customerFunds:Array<{customerId:string;customerName:string;currency:Currency;availableReceipts:string;invoiceCredits:string;
    receipts:Array<{id:string;reference?:string;receivedDate:DateOnly;available:string}>;
    creditInvoices:Array<{id:string;number:string;creditBalance:string}>}>;
  inactiveOverrides:Array<CashPlanOverride & {reasonInView:string}>;
  sourceIssues:Array<CashPlanSourceIssue & {invoiceId:string;invoiceNumber:string;amountDue:string;currency:Currency;operatorOverride:boolean}>;
}
export interface CashPlanPreviewInput {workspaceId:string;plan:CashPlanInput}
export interface CashPlanPreview {workspaceId:string;revision:number;plan:CashPlanTerms;projection:CashPlanProjection;reviewSha256:string}
export interface CashPlanEdition {
  id:string;planId:string;number:number;createdAt:string;actor:string;workspaceId:string;sourceRevision:number;
  reviewSha256:string;plan:CashPlanTerms;projection:CashPlanProjection;
}
export interface CashPlanSummary {
  id:string;version:number;status:'ACTIVE'|'ARCHIVED';createdAt:string;updatedAt:string;title:string;owner:string;
  asOf:DateOnly;through:DateOnly;customerId:string|null;editionId:string;editionNumber:number;sourceRevision:number;
  currencies:CashPlanCurrency[];editionCount:number;
}
export interface CashPlanListQuery {status?:'ACTIVE'|'ARCHIVED'|'ALL';search?:string}
export interface CashPlanList {plans:CashPlanSummary[];workspaceId:string;revision:number}
export interface CashPlanDetail {
  cashPlan:CashPlanSummary;edition:CashPlanEdition;
  editions:Array<{id:string;number:number;createdAt:string;actor:string;asOf:DateOnly;through:DateOnly;sourceRevision:number;reviewSha256:string}>;
  history:Array<{kind:'EDITION_SAVED'|'ARCHIVED'|'REOPENED';at:string;actor:string;note:string;editionId?:string;editionNumber?:number}>;
  workspaceId:string;revision:number;
}
export interface SaveCashPlanInput extends MutationContext,CashPlanPreviewInput {id?:string;expectedVersion?:number;reviewSha256:string}
export interface CashPlanStatusInput extends MutationContext {workspaceId:string;expectedVersion:number;note:string}
export interface CashPlanMutationResult extends MutationResult {cashPlan:CashPlanSummary;cashPlanEdition:CashPlanEdition;workspaceId:string}
export interface CashPlanCompareQuery {leftId:string;rightId:string;leftEditionId?:string;rightEditionId?:string}
export interface CashPlanDifference {left:string;right:string;change:string}
export interface CashPlanComparison {
  schema:'stellar-forge.merchant-cash-plan-comparison.v1';workspaceId:string;revision:number;
  left:{id:string;planId:string;number:number;sourceRevision:number;plan:CashPlanTerms};
  right:{id:string;planId:string;number:number;sourceRevision:number;plan:CashPlanTerms};
  currencies:Array<{currency:Currency;amountDue:CashPlanDifference;withinHorizon:CashPlanDifference;afterHorizon:CashPlanDifference;
    separated:CashPlanDifference;reviewRequired:CashPlanDifference}>;
  dates:Array<{date:DateOnly;currency:Currency;left:string;right:string;change:string}>;
}
export type CashPlanFileName='plan.json'|'plan.csv'|'plan.html'|'manifest.json';
export interface CashPlanOperationResult {
  workspaceId:string;revision:number;operation:MutationResult['operation']|null;cashPlan?:CashPlanSummary;cashPlanEdition?:CashPlanEdition;
}
