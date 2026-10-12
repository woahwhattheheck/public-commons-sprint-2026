import type {
  Currency,Money,DateOnly,Customer,InvoiceSummary,InvoiceDocument,Receipt,
  MutationContext,MutationResult,Operation,FileMetadata
} from './client.mjs';

export interface CreditTerms {
  enabled:boolean;
  creditLimit:Money|null;
  overdueDays:number|null;
  reviewDisputes:boolean;
  reviewEveryOrder:boolean;
}
export interface CreditPolicy {
  id:string;version:number;customerId:string;customerName:string;currency:Currency;
  owner:string;terms:CreditTerms;createdAt:string;updatedAt:string;editionCount:number;
}
export interface CreditPolicyEdition {
  version:number;createdAt:string;actor:string;reason:string;customerId:string;customerName:string;
  currency:Currency;owner:string;terms:CreditTerms;
}
export interface CreditHistory {
  kind:string;at:string;actor:string;reason:string;
  version?:number;enabled?:boolean;supersededById?:string;
  invoiceId?:string;invoiceNumber?:string;documentSha256?:string;
}
export interface CreditPolicyDetail {
  workspaceId:string;revision:number;policy:CreditPolicy;
  editions:CreditPolicyEdition[];history:CreditHistory[];
}
export interface SaveCreditPolicyInput extends MutationContext {
  workspaceId:string;id?:string;expectedVersion?:number;
  customerId:string;currency:Currency;owner:string;terms:CreditTerms;reason:string;
}
export interface CreditExposure {
  currentDue:Money;futureIssued:Money;issuedExposure:Money;overdue:Money;disputed:Money;
  availableReceipts:Money;invoiceCredits:Money;draftTotal:Money;projectedExposure:Money;
  creditLimit:Money|null;headroom:Money|null;
}
export interface CreditDispute {
  caseId:string;caseVersion:number;caseStatus:'OPEN'|'CLOSED';disputeId:string;
  amount:Money;recordedAmount:Money;effectiveDate:DateOnly;note:string;reference:string;
  invoiceId:string;invoiceNumber:string;
}
export interface CreditDraftSummary extends InvoiceSummary {purchaseOrder:string}
export interface CreditExposureInvoice extends InvoiceSummary {
  exposureAmount:Money;futureExposure:Money;openDispute:CreditDispute|null;
}
export interface CreditTrigger {
  code:'CREDIT_LIMIT_EXCEEDED'|'OVERDUE_BALANCE'|'OPEN_DISPUTE'|'EVERY_ORDER_REVIEW'|'OPERATOR_DECLINED';
  message:string;amount?:Money;invoiceIds?:string[];
}
export interface CreditSource {
  draftVersion:number;draftSha256:string;previewSha256:string;customerVersion:number|null;customerSha256:string;
  policyId:string|null;policyVersion:number|null;issuedInvoicesSha256:string;receiptsSha256:string;
  allocationsSha256:string;creditsSha256:string;collectionCasesSha256:string;refundsSha256:string;
  otherDraftsInformational:true;
}
export interface CreditAssessment {
  schema:'stellar-forge.merchant-credit-assessment.v1';asOf:DateOnly;invoiceId:string;
  invoice:CreditDraftSummary;document:InvoiceDocument;customer:Customer;policy:CreditPolicy|null;
  exposure:CreditExposure;invoices:CreditExposureInvoice[];receipts:Receipt[];
  creditInvoices:InvoiceSummary[];otherDrafts:CreditDraftSummary[];disputes:CreditDispute[];
  triggers:CreditTrigger[];reviewRequired:boolean;source:CreditSource;
}
export interface CreditInvoicePreview {previewSha256:string;expectedVersion:number}
export interface CreditPreviewMetadata {
  creditReviewRequired:boolean;creditTriggers:CreditTrigger[];creditAssessmentSha256:string|null;
  creditDecisionId:string|null;creditDecisionStale:boolean;
}
export interface CreditAssessmentPreview {
  workspaceId:string;revision:number;assessmentSha256:string;assessment:CreditAssessment;
  invoicePreview:CreditInvoicePreview;
}
export type CreditDecisionOutcome='APPROVE'|'DECLINE';
export type CreditDecisionStatus='APPROVED'|'DECLINED'|'WITHDRAWN'|'SUPERSEDED'|'CONSUMED';
export interface CreditDecision {
  schema:'stellar-forge.merchant-credit-decision.v1';id:string;invoiceId:string;workspaceId:string;version:number;
  outcome:CreditDecisionOutcome;status:CreditDecisionStatus;createdAt:string;updatedAt:string;actor:string;
  reason:string;sourceRevision:number;assessmentSha256:string;assessment:CreditAssessment;history:CreditHistory[];
  supersededById?:string;consumedAt?:string;issuedInvoiceId?:string;issuedNumber?:string;issuedDocumentSha256?:string;
}
export interface CreditDecisionSummary {
  id:string;invoiceId:string;version:number;outcome:CreditDecisionOutcome;status:CreditDecisionStatus;
  createdAt:string;updatedAt:string;actor:string;reason:string;assessmentSha256:string;
  customerId:string;customerName:string;currency:Currency;total:Money;purchaseOrder:string;asOf:DateOnly;reviewRequired:boolean;
  policyId:string|null;policyVersion:number|null;triggerCodes:CreditTrigger['code'][];
  supersededById:string|null;consumedAt:string|null;issuedInvoiceId:string|null;issuedNumber:string|null;
}
export interface CreditControlQuery {customerId?:string;search?:string}
export interface CreditControlReport {
  workspaceId:string;revision:number;asOf:DateOnly;customers:Customer[];
  policies:CreditPolicy[];drafts:CreditDraftSummary[];decisions:CreditDecisionSummary[];
}
export interface SaveCreditDecisionInput extends MutationContext {
  workspaceId:string;assessmentSha256:string;outcome:CreditDecisionOutcome;reason:string;
}
export interface WithdrawCreditDecisionInput extends MutationContext {
  workspaceId:string;expectedVersion:number;reason:string;
}
export interface CreditDecisionDetail {
  workspaceId:string;revision:number;decision:CreditDecision;assessment:CreditAssessment;
  currentAssessment:CreditAssessment|null;currentAssessmentSha256:string|null;canRelease:boolean;releaseReason:string;
  invoicePreview:(CreditInvoicePreview&CreditPreviewMetadata)|null;
}
export interface CreditRelease {
  schema:'stellar-forge.merchant-credit-release.v1';asOf:DateOnly;assessedAt:string;
  policyId:string;policyVersion:number;assessmentSha256:string;exposure:CreditExposure;
  triggerCodes:CreditTrigger['code'][];creditDecisionId:string|null;
}
export interface CreditPolicyMutationResult extends MutationResult {
  workspaceId:string;creditPolicy:CreditPolicy;creditPolicyEdition?:CreditPolicyEdition;
}
export interface CreditDecisionMutationResult extends MutationResult {
  workspaceId:string;creditDecision:CreditDecision;
}
export interface CreditIssueResult extends MutationResult {
  invoice:InvoiceSummary;workspaceId?:string;creditRelease?:CreditRelease;creditDecision?:CreditDecision;
}
export type CreditDecisionFileName='decision.json'|'decision.html'|'manifest.json';
export interface CreditDecisionDownload {name:CreditDecisionFileName;type:string;bytes:Uint8Array}
export interface CreditDecisionManifest {
  schema:'stellar-forge.merchant-credit-decision-files.v1';decisionId:string;decisionVersion:number;
  assessmentSha256:string;files:Record<string,FileMetadata>;
}
export interface CreditControlOperationResult {
  workspaceId:string;revision:number;operation:Operation|null;
  creditPolicy?:CreditPolicy;creditPolicyEdition?:CreditPolicyEdition;creditDecision?:CreditDecision;
  creditRelease?:CreditRelease;invoice?:InvoiceSummary;
}
