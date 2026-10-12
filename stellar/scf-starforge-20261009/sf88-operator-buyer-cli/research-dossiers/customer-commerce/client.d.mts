/** MIT. Complete paid Research publication and original buyer receiving API. */
export type ResearchCommerceId = string;
export type ResearchCommerceSha256 = string;
export type ResearchCommerceCollection = 'publications' | 'purchases';
export type ResearchCommerceFilePart = 'publication' | 'handoff' | 'archive' | 'received';
export type ResearchCommerceAction = 'execute' | 'retrieve' | 'recover' | 'finalize' | 'cancel';
export interface ResearchCommerceTransport { signal?: AbortSignal }
export interface ResearchCommercePageSelection { offset?: number; limit?: number; snapshot?: ResearchCommerceSha256 }
export interface ResearchSourceWorkspaceSelection {
 library: 'original' | `received-${string}`; actor: string; requestId: string;
}
export interface ResearchPublicationRequest {
 requestId: ResearchCommerceId; merchant: string; dossierId: string; deliveryId: string; revision: number;
 title: string; summary: string; usage: string; sourceWorkspace?: ResearchSourceWorkspaceSelection | null;
}
export interface ResearchCommerceArchive {
 name: 'research-customer.handover.gz'; bytes: number; sha256: ResearchCommerceSha256; contentType: 'application/gzip';
}
export interface ResearchHandoverMember {
 name: string; kind: 'report'|'work'|'dossier'|'europe-pmc';
 format?: 'json'|'csv'|'md'|'html'; bytes: number; sha256: ResearchCommerceSha256; contentType: string;
}
/** Exact original SF101 handoff, including its selected payment/recipient binding. */
export interface ResearchNativeMerchantHandoff {
 schema: string; orderReference: string; recipientBinding: 'ORIGINAL_RECIPIENT_DIGEST';
 file: {bytes: number; sha256: ResearchCommerceSha256};
 [originalField: string]: unknown;
}
export interface ResearchPaidPublication {
 schema: 'sf88-research-paid-publication/v1'; publicationId: ResearchCommerceId;
 title: string; summary: string; usage: string;
 delivery: {
  schema: 'sf88-research-customer-handover/v1'; dossierId: string; deliveryId: string; revision: number;
  manifestSha256: ResearchCommerceSha256; manifestBytes: number; files: ResearchHandoverMember[];
 };
 archive: ResearchCommerceArchive; handoff: ResearchNativeMerchantHandoff;
}
export interface ResearchMerchantSelection {
 id: string; label: string; checkoutFile: string; checkoutSha256: ResearchCommerceSha256;
 routeId: string; purchaseUrl: string; payment: Record<string, unknown>; state: string; outbox: string;
 claimEnv: string; claimAvailable: boolean;
}
export interface ResearchBuyerSelection {
 id: string; label: string; directory: string; selectionSha256: ResearchCommerceSha256;
 maximumFileBytes: number; maximumExportBytes: number;
}
export interface ResearchCommerceConfiguration {
 schema: 'sf88-research-customer-commerce-host/v1'; workspaceId: string; configurationFile: string|null;
 merchants: ResearchMerchantSelection[]; buyers: ResearchBuyerSelection[];
 errors: Array<{kind:'merchant'|'buyer'; id:string; code:string}>;
}
export interface ResearchCommerceSummary {
 id: ResearchCommerceId; kind: ResearchCommerceCollection; title: string; createdAt: string;
 dossierId: string; deliveryId: string; status: string; merchant?: string; buyer?: string;
 reviewSha256?: ResearchCommerceSha256|null;
}
export interface ResearchCommercePage {
 schema: 'sf88-research-customer-commerce/v1'; workspaceId: string; kind: ResearchCommerceCollection;
 snapshot: ResearchCommerceSha256; items: ResearchCommerceSummary[];
 errors: Array<{id:string; code:string}>; offset:number; limit:number; total:number; nextOffset:number|null;
}
export interface ResearchPublicationReview {
 schema: 'sf88-research-paid-publication-review/v1'; id:ResearchCommerceId; reviewSha256:ResearchCommerceSha256;
 title:string; summary:string; usage:string; dossierId:string; deliveryId:string; revision:number;
 archive:ResearchCommerceArchive; manifestSha256:ResearchCommerceSha256; manifestBytes:number;
 files:ResearchHandoverMember[]; merchant:ResearchMerchantSelection; orderReference:string; createdAt:string;
}
export interface ResearchPublicationResult {
 publicationId:ResearchCommerceId; orderReference:string; publication:ResearchPaidPublication;
 publicationSha256:ResearchCommerceSha256; publicationBytes:number; merchantHandoffSha256:ResearchCommerceSha256;
 nativeOrder:{state:string; createdAt:string; eventId:string|null; entitledAt:string|null}; completedAt:string;
}
export interface ResearchPublicationView {
 schema:'sf88-research-customer-commerce/v1'; kind:'publications'; id:ResearchCommerceId;
 status:'PREPARING'|'REVIEWED'|'ENROLLED'; request?:ResearchPublicationRequest;
 review:ResearchPublicationReview|null; result:ResearchPublicationResult|null; reused?:boolean;
}
export interface ResearchPublicationEnrollment { id:ResearchCommerceId; reviewSha256:ResearchCommerceSha256 }
export interface ResearchPurchaseInput { requestId:ResearchCommerceId; buyer:string; filename:string; base64:string }
export interface ResearchPurchasePreparation {
 id:ResearchCommerceId; requestId:ResearchCommerceId; expectedRevision:number;
 /** Original buyer budget limits as positive decimal strings, in atomic asset units. */
 totalAtomic:string; dailyAtomic:string;
 /** Name of the existing buyer's claim environment variable; never the secret value. */
 claimEnv:string;
}
export interface ResearchPurchasePrepared {
 schema:'sf88-research-paid-purchase-prepared/v1'; input:ResearchPurchasePreparation;
 preparedSha256:ResearchCommerceSha256; publicationSha256:ResearchCommerceSha256;
 buyerBindingSha256:ResearchCommerceSha256; paidFileId:string; runId:string; planId:string; operationId:string;
 intentId:string; sourceConfigSha256:ResearchCommerceSha256; configSha256:ResearchCommerceSha256;
 handoffSha256:ResearchCommerceSha256; orderReference:string; archive:ResearchCommerceArchive;
 nativeReview:Record<string,unknown>; nativePreparation:Record<string,unknown>;
 nativeDraft:Record<string,unknown>; nativeInitialized:Record<string,unknown>; createdAt:string;
}
export interface ResearchPurchaseActionInput {
 id:ResearchCommerceId; requestId:ResearchCommerceId; preparedSha256:ResearchCommerceSha256;
}
export interface ResearchPurchaseCancelInput extends ResearchPurchaseActionInput { executionId:ResearchCommerceId }
export interface ResearchPurchaseReconciliation {
 id:ResearchCommerceId; requestId:ResearchCommerceId; nativeRequestId:ResearchCommerceId; nativeId?:string;
}
export interface ResearchPurchaseReceivingInput extends ResearchPurchaseActionInput { sourceActor?:string }
export interface ResearchPaidCustomerReceived {
 schema:'sf88-research-paid-customer-received/v1'; workspaceId:string;
 publicationSha256:ResearchCommerceSha256; publicationId:ResearchCommerceId; orderReference:string;
 archive:ResearchCommerceArchive;
 buyer:{directory:string;selectionSha256:ResearchCommerceSha256;paidFileId:string;runId:string;
  operationId:string;intentId:string;exportId:string;manifestSha256:ResearchCommerceSha256};
 /** Complete original receiveCustomerHandover result, including source receiving when selected. */
 nativeReceiving:Record<string,unknown>; completedAt:string;
}
export interface ResearchPurchaseView {
 schema:'sf88-research-customer-commerce/v1'; kind:'purchases'; id:ResearchCommerceId;
 status:'RECEIVING'|'OFFER_RECEIVED'|'BUYER_PREPARED'|'DOSSIER_RECEIVED';
 publication:ResearchPaidPublication; buyer:ResearchBuyerSelection;
 result:{paidFileId:string;original:Record<string,unknown>;completedAt:string}|null;
 prepared:ResearchPurchasePrepared|null; received:ResearchPaidCustomerReceived|null;
 buyerConnection?:Record<string,unknown>; operator?:Record<string,unknown>; paidFile?:Record<string,unknown>|null;
 run?:Record<string,unknown>|null; operation?:Record<string,unknown>|null; approval?:Record<string,unknown>;
 reused?:boolean;
}
export interface ResearchPurchasePreparationResult {
 schema:'sf88-research-customer-commerce/v1'; kind:'purchases';id:ResearchCommerceId;
 status:'BUYER_PREPARED';prepared:ResearchPurchasePrepared;reused:boolean;
}
export interface ResearchPurchaseReceivedOffer {
 schema:'sf88-research-customer-commerce/v1';kind:'purchases';id:ResearchCommerceId;
 status:'OFFER_RECEIVED';publication:ResearchPaidPublication;buyer:ResearchBuyerSelection;
 result:{paidFileId:string;original:Record<string,unknown>;completedAt:string};reused:boolean;
}
export interface ResearchPurchaseActionResult {
 schema:'sf88-research-customer-commerce/v1';kind:'purchases';id:ResearchCommerceId;
 action:ResearchCommerceAction;requestId:ResearchCommerceId;original:Record<string,unknown>;
 run:Record<string,unknown>;operation:Record<string,unknown>;
}
export interface ResearchPurchaseReceivingResult {
 schema:'sf88-research-customer-commerce/v1';kind:'purchases';id:ResearchCommerceId;
 status:'DOSSIER_RECEIVED';received:ResearchPaidCustomerReceived;reused:boolean;
}
export interface ResearchCommerceFile {
 schema:'sf88-research-commerce-file/v1';workspaceId:string;kind:ResearchCommerceCollection;
 id:ResearchCommerceId;file:ResearchCommerceFilePart;
 descriptor:{name:string;bytes:number;sha256:ResearchCommerceSha256;contentType:string};
}
export interface ResearchCommerceDownload {
 file:string;expectedSha256:ResearchCommerceSha256;expectedBytes:number;signal?:AbortSignal;
}
export interface ResearchCommerceClient {
 configuration(options?:ResearchCommerceTransport):Promise<ResearchCommerceConfiguration>;
 list(kind:ResearchCommerceCollection,selection?:ResearchCommercePageSelection,options?:ResearchCommerceTransport):Promise<ResearchCommercePage>;
 publication(id:ResearchCommerceId,options?:ResearchCommerceTransport):Promise<ResearchPublicationView>;
 preparePublication(input:ResearchPublicationRequest,options?:ResearchCommerceTransport):Promise<ResearchPublicationView>;
 enrollPublication(input:ResearchPublicationEnrollment,options?:ResearchCommerceTransport):Promise<ResearchPublicationView>;
 receivePurchase(input:ResearchPurchaseInput,options?:ResearchCommerceTransport):Promise<ResearchPurchaseReceivedOffer>;
 purchase(id:ResearchCommerceId,selection?:{refresh?:boolean},options?:ResearchCommerceTransport):Promise<ResearchPurchaseView>;
 preparePurchase(input:ResearchPurchasePreparation,options?:ResearchCommerceTransport):Promise<ResearchPurchasePreparationResult>;
 action(kind:Exclude<ResearchCommerceAction,'cancel'>,input:ResearchPurchaseActionInput,options?:ResearchCommerceTransport):Promise<ResearchPurchaseActionResult>;
 action(kind:'cancel',input:ResearchPurchaseCancelInput,options?:ResearchCommerceTransport):Promise<ResearchPurchaseActionResult>;
 reconcile(input:ResearchPurchaseReconciliation,options?:ResearchCommerceTransport):Promise<{
  schema:'sf88-research-customer-commerce/v1';kind:'purchases';id:ResearchCommerceId;action:'reconcile';original:Record<string,unknown>
 }>;
 receiveDossier(input:ResearchPurchaseReceivingInput,options?:ResearchCommerceTransport):Promise<ResearchPurchaseReceivingResult>;
 file(kind:ResearchCommerceCollection,id:ResearchCommerceId,part:ResearchCommerceFilePart,options?:ResearchCommerceTransport):Promise<ResearchCommerceFile>;
 download(kind:ResearchCommerceCollection,id:ResearchCommerceId,part:ResearchCommerceFilePart,
  options:ResearchCommerceDownload):Promise<{path:string;bytes:number;sha256:string;[originalField:string]:unknown}>;
}
export function createResearchCommerceClient(transport:{
 request:(route:string,input?:unknown,options?:ResearchCommerceTransport)=>Promise<unknown>;
 download:(route:string,file:string,options?:{expectedSha256?:string;signal?:AbortSignal})=>Promise<{
  path:string;bytes:number;sha256:string;[originalField:string]:unknown}>;
}):ResearchCommerceClient;
