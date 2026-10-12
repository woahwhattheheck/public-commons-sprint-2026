import type {Currency, DateOnly, InvoiceSummary, MutationContext, MutationResult} from './client.d.ts';
export type CollectionPriority = 'NORMAL' | 'HIGH' | 'URGENT';
export type CollectionStatus = 'OPEN' | 'CLOSED' | 'FUTURE';
export type CollectionActivityKind = 'NOTE' | 'CONTACT' | 'PROMISE' | 'PROMISE_OUTCOME' | 'DISPUTE' | 'DISPUTE_RESOLUTION';
export interface CollectionTerms {title:string; owner:string; priority:CollectionPriority; nextActionDate:DateOnly}
export interface CollectionEvent {
  id:string; kind:string; effectiveDate:DateOnly; occurredDate?:DateOnly; recordedAt:string; actor:string;
  note?:string; reference?:string; terms?:CollectionTerms; nextActionDate?:DateOnly;
  amount?:string; dueDate?:DateOnly; invoiceBasis?:InvoiceSummary;
  channel?:'EMAIL'|'PHONE'|'MEETING'|'OTHER'; direction?:'INBOUND'|'OUTBOUND'; contact?:string;
  promiseId?:string; outcome?:'KEPT'|'BROKEN'|'WITHDRAWN'; disputeId?:string;
  category?:'PRICING'|'DELIVERY'|'DUPLICATE'|'OTHER';
}
export interface CollectionRecord {
  schema:'stellar-forge.merchant-collection-case.v1'; id:string; version:number; invoiceId:string; customerId:string;
  currency:Currency; openedDate:DateOnly; createdAt:string; createdBy:string; updatedAt:string; events:CollectionEvent[];
}
export interface CollectionSummary extends CollectionTerms {
  id:string; version:number; invoiceId:string; customerId:string; currency:Currency;
  openedDate:DateOnly; createdAt:string; updatedAt:string; status:CollectionStatus;
  actionDate:DateOnly|null; queueStatus:CollectionStatus|'ACCOUNT_SETTLED'|'DISPUTED'|'PROMISE_OVERDUE'|'FOLLOW_UP_DUE'|'SCHEDULED';
  followUpDue:boolean; invoice:InvoiceSummary; eventCount:number; totalEventCount:number; asOf:DateOnly;
  promise:(Omit<CollectionEvent,'outcome'> & {status:'OPEN'|'KEPT'|'BROKEN'|'WITHDRAWN'; amount:string; dueDate:DateOnly;
    dueStatus:'OVERDUE'|'DUE_TODAY'|'UPCOMING'|null; outcome:CollectionEvent|null})|null;
  dispute:(CollectionEvent & {status:'OPEN'|'RESOLVED'; amount:string; resolution:CollectionEvent|null})|null;
  lastContact:CollectionEvent|null;
}
export interface CollectionsQuery {asOf?:DateOnly; customerId?:string; owner?:string; status?:CollectionStatus|'ALL'; search?:string}
export interface CollectionsReport {
  schema:'stellar-forge.merchant-collections.v1'; asOf:DateOnly; revision:number; workspaceId:string;
  filters:{customerId:string|null;owner:string|null;status:string;search:string};
  cases:CollectionSummary[]; unassigned:Array<InvoiceSummary & {existingCaseId:string|null}>;
  totals:Array<{currency:Currency;cases:number;followUpsDue:number;amountDue:string}>;
}
export interface CollectionDetail {collectionCase:CollectionSummary;record:CollectionRecord;revision:number;workspaceId:string}
export interface CollectionContext extends MutationContext {workspaceId:string;expectedVersion:number;effectiveDate:DateOnly}
export interface SaveCollectionCase extends MutationContext, CollectionTerms {
  workspaceId:string;effectiveDate:DateOnly;id?:string;invoiceId?:string;expectedVersion?:number;note?:string;
}
export interface CollectionActivityInput extends CollectionContext {
  kind:CollectionActivityKind;occurredDate?:DateOnly;note:string;reference?:string;nextActionDate?:DateOnly;
  channel?:'EMAIL'|'PHONE'|'MEETING'|'OTHER';direction?:'INBOUND'|'OUTBOUND';contact?:string;
  amount?:string;dueDate?:DateOnly;promiseId?:string;outcome?:'KEPT'|'BROKEN'|'WITHDRAWN';
  disputeId?:string;category?:'PRICING'|'DELIVERY'|'DUPLICATE'|'OTHER';
}
export interface CollectionTransitionInput extends CollectionContext {note:string;nextActionDate?:DateOnly}
export interface CollectionMutationResult extends MutationResult {
  collectionCase:CollectionSummary;workspaceId:string;collectionEvent?:CollectionEvent;
}
export interface CollectionReminder {
  subject:string;text:string;invoiceId:string;invoiceNumber:string;asOf:DateOnly;amountDue:string;
  currency:Currency;sourceCaseId:string;revision:number;workspaceId:string;
}
export type CollectionFileName = 'case.json'|'case.csv'|'case.html'|'reminder.txt'|'manifest.json';
export interface CollectionOperationResult {
  workspaceId:string;revision:number;operation:MutationResult['operation']|null;
  collectionCase?:CollectionSummary;collectionEvent?:CollectionEvent;
}
