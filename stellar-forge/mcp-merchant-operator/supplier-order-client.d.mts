// MIT. Complete public types for the original supplier-order MCP client.
/** Original XML numbers remain strings, including leading/trailing zeroes. */
export type DecimalString=string;
/** Reconciled exact arithmetic may also be represented by an exact fraction. */
export type ExactQuantity=string;
export type Sha256=string;
export type WorkspaceAlias=string;
export type RecordId=string;
/** Exact original business identifier. The retained profile declares its limit (Unite: 21; customer: at most 250). */
export type OrderId=string;
export type DocumentKind='ORDER'|'ORDERRESPONSE'|'DISPATCHNOTIFICATION'|'INVOICE';
export type DraftKind=Exclude<DocumentKind,'ORDER'>;
export type Json=string|number|boolean|null|Json[]|{[key:string]:Json};
export interface CallOptions { requestSignal?:AbortSignal|null;timeoutMs?:number }
export interface NativeSupplierOrderClient {
  /** The exact original endpoint is retained in download checkpoints. */
  endpoint:string;
  call(name:string,args:Record<string,unknown>,options?:CallOptions):Promise<Record<string,unknown>>;
}

/** Complete reviewed declaration for the existing openTRANS 1.0 adapter. */
export interface SupplierOrderProfile {
  schema:'stellar-forge.supplier-order-profile.v1';
  id:string;revision:number;title:string;format:'openTRANS';version:'1.0';
  declaration:{reference:string;url:string|null;sourceSha256:Sha256|null;notes:string};
  orderIdMaximum:number;
  supplierIdentity:{partyIdTypes:string[];allowUniqueFallback:boolean;inheritOrderResponse:boolean};
  confirmation:{negativeQuantity:'cancel'|'reject';omittedLines:'retain'|'require-complete'};
  serials:{remarks:'unite-number'|'opaque'};
  validation:{
    currencies:string[];units:string[];invoiceTaxRate:boolean;invoiceDeliveryReference:boolean;
    invoiceParties:Array<'buyer'|'supplier'|'invoice'>;confirmationDeliveryWarning:boolean;dispatchTrackingWarning:boolean;
    requiredFields:Array<{kinds:DocumentKind[];path:string;when:'always'|'output';severity:'error'|'warning';message:string;reference:string}>;
  };
}
export interface RetainedProfileSelection {
  schema:'stellar-forge.supplier-order-profile-selection.v1';profile:SupplierOrderProfile;
  profileSha256:Sha256;revision:number;implicit:boolean;selectedAt:string|null;
  requestId:RecordId|null;reason:string;sha256?:Sha256;previousProfileSha256?:Sha256;
  sourceWorkspaceId?:string;sourceSelection?:RetainedProfileSelection|null;
}
export interface ProfileSelection extends RetainedProfileSelection {
  workspaceId:string;canSelect:boolean;
}
export interface SelectProfileArguments {
  requestId:RecordId;expectedProfileSha256:Sha256;expectedSelectionRevision:number;
  profile:SupplierOrderProfile;reason:string;
}
export interface SelectProfileResult extends OperationResult {profileSelection:RetainedProfileSelection}
export interface ProfileHistoryPage extends Page<OperationReply> {revision:number;profileSha256:Sha256}
export interface PackageProfileInspection {
  incoming:SupplierOrderProfile;incomingSha256:Sha256;current:SupplierOrderProfile;currentSha256:Sha256;
  currentSelectionRevision:number;matches:boolean;adoptionRequired:boolean;canAdopt:boolean;
  sourceSelection:RetainedProfileSelection|null;
}
export interface ReceiveWorkspaceArguments {
  requestId:RecordId;inputId:string;mode:'inspect'|'merge';adoptProfile?:boolean;
  /** Supply both current profile pins for an explicit different-profile adoption into an empty workspace. */
  expectedProfileSha256?:Sha256;expectedSelectionRevision?:number;
}
export interface ReceiveWorkspaceResult extends OperationResult {
  schema:'stellar-forge.supplier-orders-receiving.v1';mode:'inspect'|'merge';
  sourceWorkspaceId:string;workspaceId:string;packageSha256:Sha256;profile:PackageProfileInspection;
  supplierMatches:boolean;canMerge:boolean;rows:number;files:number;
  tableCounts:Record<string,number>;added:Record<string,number>;preserved:Record<string,number>;foreign:Record<string,number>;
  foreignRecordIds?:RecordId[];id?:RecordId;receivedAt?:string;currentState?:string;
}

export interface XmlComment { comment:string }
export interface XmlInstruction { pi:string;value?:string }
export interface XmlElement {
  name:string;attributes:Array<[string,string]>;
  content:Array<string|XmlElement|XmlComment|XmlInstruction>;
  [originalField:string]:unknown;
}
export interface Parties {
  buyer?:XmlElement|null;supplier?:XmlElement|null;invoice?:XmlElement|null;
  delivery?:XmlElement|null;finalDelivery?:XmlElement|null;
  /** Repeated original transport parties, in their source order. */
  transport?:XmlElement[]|XmlElement|null;
  [originalRole:string]:unknown;
}
export interface SourceProvenance {[key:string]:Json}
export interface SourceIdentity {
  name?:string;bytes?:number;sha256?:Sha256;encoding?:string;
  fileId?:RecordId;kind?:string;provenance?:SourceProvenance;
  [originalField:string]:unknown;
}
export interface SupplierIdentity {type?:string;value?:string;path?:string;[originalField:string]:unknown}
export interface DeliveryPeriod {
  type?:string|null;start?:string|null;end?:string|null;extensions?:Json[];
  [originalField:string]:unknown;
}
export interface Remark {type?:string|null;text:string;sourcePath?:string|null;[originalField:string]:unknown}
export interface Article {
  supplierId:string|null;buyerIds?:Array<{type?:string|null;value:string}>;
  descriptionShort?:string|null;descriptionLong?:string|null;extensions?:Json[];
  [originalField:string]:unknown;
}
export interface ArticlePrice {
  type:string|null;amount:DecimalString|null;quantity:DecimalString|null;
  lineAmount:DecimalString|null;tax:DecimalString|null;taxAmount?:DecimalString|null;
  currency?:string|null;flags?:Array<{type:string;value:string}>;extensions?:Json[];
  [originalField:string]:unknown;
}
export interface OrderReference {
  orderId:OrderId;lineId:string;date?:string|null;extensions?:Json[];
  [originalField:string]:unknown;
}
export interface DeliveryReference {
  documentId:string;lineId?:string|null;date?:DeliveryPeriod|null;extensions?:Json[];
  [originalField:string]:unknown;
}
export interface NativePackage {[originalField:string]:unknown}
export interface DocumentHeader {
  date:string|null;orderDate?:string|null;currency?:string|null;supplierOrderId?:string|null;
  deliveryDate?:DeliveryPeriod|null;parties:Parties;supplierId?:string|null;
  supplierIdentity?:SupplierIdentity|null;packages?:NativePackage[];remarks?:Remark[];extensions?:Json[];
  [originalField:string]:unknown;
}
export interface DocumentLine {
  lineId:string;article:Article;quantity:DecimalString;unit:string;
  price:ArticlePrice|null;deliveryDate?:DeliveryPeriod|null;
  orderReference?:OrderReference|null;deliveryReferences?:DeliveryReference[];
  parties?:Parties;supplierId?:string|null;supplierIdentity?:SupplierIdentity|null;
  packages?:NativePackage[];remarks?:Remark[];
  /** Derived from complete original typed remarks; edit remarks to change serials. */
  serials?:string[];extensions?:Json[];sourcePath?:string|null;sourceOrderDocumentId?:RecordId;
  [originalField:string]:unknown;
}
export interface NativeDocument {
  schema:'stellar-forge.supplier-order-document.v1';
  profileId:string;kind:DocumentKind;version:'1.0';
  /** Required with the exact SHA for every customer profile; legacy Unite source records retain their original shape. */
  profile?:SupplierOrderProfile;profileSha256?:Sha256;
  documentId:string;orderId:OrderId|null;header:DocumentHeader;items:DocumentLine[];
  summary:{totalItems?:DecimalString|null;totalAmount?:DecimalString|null;totalTaxAmount?:DecimalString|null;[key:string]:unknown};
  raw:Json|null;source:SourceIdentity;validation?:Json;[originalField:string]:unknown;
}
export interface Finding {
  code:string;path:string;message:string;severity:'error'|'warning';
  kind?:DocumentKind;[originalField:string]:unknown;
}
export interface Review {
  schema?:string;profileId?:string;profileSha256?:Sha256;errors:number;warnings:number;findings:Finding[];
  net?:ExactQuantity|null;tax?:ExactQuantity|null;gross?:ExactQuantity|null;[originalField:string]:unknown;
}
export interface ReviewSummary {
  schema?:string;profileId?:string;profileSha256?:Sha256;errors?:number;warnings?:number;valid?:boolean;
  net?:ExactQuantity|null;tax?:ExactQuantity|null;gross?:ExactQuantity|null;
  findingsCount:number;fullFindingsRetained?:true;
}
export interface DocumentRecord {
  id:RecordId;revision:number;businessKey:string;kind:DocumentKind;
  documentId:string;orderIds:OrderId[];referencedOrderIds?:OrderId[];
  source:SourceIdentity;document:NativeDocument;review:Review;createdAt:string;
  direction?:string;draftId?:RecordId|null;draftRevision?:number|null;sha256:Sha256;
  [originalField:string]:unknown;
}
export interface DocumentSummary extends Pick<DocumentRecord,'id'|'revision'|'businessKey'|'kind'|'documentId'|'orderIds'|'referencedOrderIds'|'source'|'createdAt'|'direction'|'draftId'|'draftRevision'|'sha256'> {review:ReviewSummary}
export interface SelectedDocument {
  id:RecordId;kind:DocumentKind;documentId:string;revision:number;source:SourceIdentity|null;
}
export interface DocumentLineReference {
  id?:RecordId;recordId?:RecordId;documentId:string;lineId:string;revision?:number;
  kind?:DocumentKind;source?:SourceIdentity;[originalField:string]:unknown;
}
export interface QuantityContribution extends DocumentLineReference {
  quantity:DecimalString;unit:string;deliveryDate:DeliveryPeriod|null;
  deliveryReferences:DeliveryReference[];date:string|null;
}
export interface ReconciledLine {
  lineId:string;article:Article;unit:string;ordered:DecimalString;
  reportedConfirmation:DecimalString|null;confirmed:ExactQuantity|null;
  cancelled:ExactQuantity;dispatched:ExactQuantity;invoiced:ExactQuantity;
  remainingToConfirm:ExactQuantity;remainingToDispatch:ExactQuantity;remainingToInvoice:ExactQuantity;
  price:ArticlePrice|null;confirmedPrice:ArticlePrice|null;deliveryDate:DeliveryPeriod|null;
  documents:{confirmation:DocumentLineReference|null;dispatches:QuantityContribution[];invoices:QuantityContribution[]};
  packages:NativePackage[];serials:Array<{value:string;documentId:RecordId;lineId:string}>;
  status:'AWAITING_CONFIRMATION'|'CANCELLED'|'DOCUMENTS_COMPLETE'|'PARTIALLY_DISPATCHED'|'CONFIRMED'|'PARTIALLY_CANCELLED'|'REVIEW';
  findings:Finding[];
}
export interface OrderHistory {[originalField:string]:unknown}
export type OrderStatus='AWAITING_CONFIRMATION'|'IN_PROGRESS'|'REVIEW'|'COMPLETE';
export interface SupplierOrder {
  schema:string;orderId:OrderId;revision:number;stateSha256:Sha256;
  document:DocumentRecord;header:DocumentHeader;items:ReconciledLine[];
  status:OrderStatus;findings:Finding[];totals:{currency:string|null;net:ExactQuantity|null};
  history:OrderHistory[];selectedDocuments:SelectedDocument[];
}
export interface OrderSummary {
  orderId:OrderId;revision:number;stateSha256?:Sha256;status:OrderStatus;
  itemCount?:number;totals?:SupplierOrder['totals'];
  header:Pick<DocumentHeader,'date'|'currency'|'supplierOrderId'|'supplierId'|'deliveryDate'>;
  findingsCount:number;fullOrderRetained:true;
}
export interface RoundingPolicy {
  scale:number;mode:'half-up'|'half-even'|'toward-zero';taxBasis?:'line'|'document';
}
export interface SourceOrderDocument {orderId:OrderId;id:RecordId;sha256:Sha256}
export interface WorkingDraft {
  schema:string;kind:DraftKind;orderIds:OrderId[];
  orderRevisions:Record<OrderId,number>;orderStateSha256:Record<OrderId,Sha256>;
  sourceOrderDocuments:SourceOrderDocument[];
  document:NativeDocument;roundingPolicy:RoundingPolicy|null;review:Review;
}
export interface SavedDraft extends WorkingDraft {
  id:RecordId;revision:number;title:string;reason:string;createdAt:string;updatedAt:string;sha256:Sha256;
}
export interface DraftSummary extends Omit<SavedDraft,'document'|'review'|'roundingPolicy'|'schema'> {review:ReviewSummary}
export interface NativeFile {
  id:RecordId;name:string;bytes:number;sha256:Sha256;mimeType:string;kind:string;createdAt:string;
}
export interface OperationError {code:string;message:string;details?:Json;detailsRetained?:true}
export interface OperationResult {
  orderIds?:OrderId[];orderCount?:number;revisions?:Record<OrderId,number>;
  documentId?:RecordId;document?:DocumentRecord;draftId?:RecordId;revision?:number;draft?:SavedDraft;
  file?:NativeFile;package?:Record<string,unknown>;[originalField:string]:unknown;
}
export interface Operation<T=OperationResult> {
  id:RecordId;kind:string;state:string;requestSha256:Sha256;requestContentSha256?:Sha256;
  request?:Record<string,unknown>;result?:T|null;error?:OperationError|null;
  createdAt:string;updatedAt?:string;resultSummary?:false;
  [originalField:string]:unknown;
}
export interface RetainedOperationSummary extends Pick<Operation,'id'|'kind'|'state'|'requestSha256'|'requestContentSha256'|'createdAt'|'updatedAt'|'error'> {
  resultSummary:true;fullResultRetained:true;requestRetained?:true;
  result:{
    documentId?:RecordId;draftId?:RecordId;transmissionId?:RecordId;revision?:number;orderIds?:OrderId[];orderCount?:number;
    file?:NativeFile;document?:Pick<DocumentRecord,'id'|'kind'|'documentId'|'revision'|'sha256'>;
    draft?:Pick<SavedDraft,'id'|'kind'|'title'|'revision'|'sha256'>;
    transmission?:Pick<Transmission,'id'|'revision'|'workspaceId'|'direction'|'state'|'documentId'|'recipientProcessing'|'historyCount'>;
  };
  receiving:{tool:'merchant_supplier_order_export_workspace';originalRequestId:RecordId;note:string};
}
export type OperationReply<T=OperationResult>=Operation<T>|RetainedOperationSummary;
export interface WorkspaceState {
  schema?:string;workspaceId:string;profileId?:string;profile?:ProfileSelection;supplierIdentity?:SupplierIdentity|null;
  counts?:Record<string,number>;orderRevisions?:Record<OrderId,number>;orderStateSha256?:Record<OrderId,Sha256>;
  drafts?:DraftSummary[];operations?:OperationReply[];summary?:boolean;
  originalCollectionsRetained?:true;collections?:Record<string,string>;[originalField:string]:unknown;
}
export interface WorkspaceStatus {
  workspace?:WorkspaceAlias;label?:string;state?:'OPEN'|'CLOSED'|'CLOSING';workspaceId?:string;
  activeOperations?:number;reads?:unknown;configured?:boolean;count?:number;opened?:WorkspaceAlias[];
  pending?:number;closing?:boolean;workspaces?:Array<{workspace:WorkspaceAlias;label:string;state:'OPEN'|'CLOSED'|'CLOSING'}>;
  [originalField:string]:unknown;
}
export interface HostInput {
  inputId:string;kind:'xml'|'workspace'|'draft';name:string;bytes:number;sha256:Sha256;provenance?:SourceProvenance;
}
export interface PageArguments {offset?:number;limit?:number}
export interface OrdersArguments extends PageArguments {query?:string;status?:OrderStatus}
export interface DocumentsArguments extends PageArguments {orderId?:OrderId;kind?:DocumentKind}
export interface DraftsArguments extends PageArguments {orderId?:OrderId}
export interface Page<T> {items:T[];total:number;offset:number;limit:number;nextOffset:number|null}
export interface OrderPage<T> extends Page<T> {orderId:OrderId;revision:number;stateSha256:Sha256}
export interface DocumentLinePage extends Page<DocumentLine> {id:RecordId;revision:number;sha256:Sha256;source:SourceIdentity}
export interface DraftLinePage extends Page<DocumentLine> {draftId:RecordId;revision:number;sha256:Sha256}
export interface NewDraftArguments {kind:DraftKind;orderIds:OrderId[]}
export interface SaveDraftArguments {
  requestId:RecordId;draftId?:RecordId;expectedRevision?:number;
  kind:DraftKind;orderIds:OrderId[];expectedOrderRevisions:Record<OrderId,number>;
  /** Pins selected original content even when imported histories share revision numbers. */
  expectedOrderStateSha256:Record<OrderId,Sha256>;sourceOrderDocuments:SourceOrderDocument[];
  document:NativeDocument;reason:string;title?:string;roundingPolicy?:RoundingPolicy|null;
}
export interface ReceiveArguments {
  requestId:RecordId;inputId:string;selection:'current'|'history';expectedProfileSha256?:Sha256;
  expectedOrderRevisions?:Record<OrderId,number>;expectedOrderRevision?:number;
}
export interface PrepareArguments {requestId:RecordId;draftId:RecordId;expectedRevision:number}
export interface SelectArguments {requestId:RecordId;id:RecordId;orderId:OrderId;expectedOrderRevision:number;reason:string}

export type TransmissionState='READY'|'SENDING'|'ACKNOWLEDGED'|'UNKNOWN'|'REJECTED'|'NOT_ACCEPTED'|'CANCELLED'|'RECEIVING'|'RECEIVED';
export type TransmissionDirection='incoming'|'outgoing';
export interface TransportAuthentication {
  type:'basic'|'bearer';
  /** Environment variable names only; credential values stay in the configured host. */
  credentialRefs:string[];
}
export interface TransportChannel {
  id:RecordId;title:string;mode:'test'|'live';supplierId:string;sha256:Sha256;
  /** Host-declared pin required for a customer-profile channel. */
  profileSha256?:Sha256;
  agreement:{reference:string};
  incoming?:{
    url:string;authentication:TransportAuthentication;messageIdHeader?:string;
    acknowledgment:{statusCode:number;contentType:string;body:string};
  };
  outgoing?:{
    endpoints:Partial<Record<DraftKind,string>>;authentication:TransportAuthentication;contentType?:'application/xml'|'text/xml';
    acknowledgment:{acceptedStatusCodes:number[];rejectedStatusCodes:number[];receiptHeader?:string;exactBodySha256?:Sha256};
    timeoutMs:number;maxResponseBytes:number;
  };
}
export interface TransportChannels {schema:string;configured:boolean;profileId:string;profileSha256:Sha256;channels:TransportChannel[]}
export interface TransmissionSource {fileId:RecordId;name:string;bytes:number;sha256:Sha256}
export interface TransmissionHttp {
  statusCode:number|null;complete:boolean;headers:Record<string,string|string[]>;observedBytes?:number;
  response?:TransmissionSource&{mimeType:string};
}
export interface Transmission {
  schema:'stellar-forge.supplier-order-transmission.v1';id:RecordId;revision:number;
  direction:TransmissionDirection;workspaceId:string;foreign:boolean;
  channel:Pick<TransportChannel,'id'|'title'|'mode'|'supplierId'|'sha256'|'agreement'|'profileSha256'>;
  profileId?:string;profileSha256?:Sha256;
  kind:DocumentKind;documentId:RecordId|null;orderIds:OrderId[];source:TransmissionSource;
  state:TransmissionState;requestId:RecordId;createdAt:string;updatedAt:string;attemptCount:number;
  lastAttempt?:Record<string,unknown>;http?:TransmissionHttp;providerReceipt?:string|null;
  /** HTTPS delivery does not declare commercial acceptance or payment. */
  recipientProcessing:'NOT_REPORTED'|'REVIEW'|'RETAINED';
  resolution?:Record<string,unknown>|null;error?:OperationError|null;historyCount:number;
  [originalField:string]:unknown;
}
export interface TransmissionHistoryEntry {
  revision:number;at:string;state:TransmissionState;action?:string;requestId?:RecordId;reason?:string;
  http?:TransmissionHttp;providerReference?:string;evidence?:TransmissionSource;
  [originalField:string]:unknown;
}
export interface TransmissionsArguments extends PageArguments {
  direction?:TransmissionDirection;state?:TransmissionState;orderId?:OrderId;
}
export interface TransmissionHistoryPage extends Page<TransmissionHistoryEntry> {
  transmissionId:RecordId;revision:number;
}
export interface PrepareTransmissionArguments {
  requestId:RecordId;documentId:RecordId;expectedDocumentSha256:Sha256;
  channelId:RecordId;expectedChannelSha256:Sha256;reason:string;
}
export interface TransmissionMutationArguments {
  requestId:RecordId;transmissionId:RecordId;expectedRevision:number;
}
export interface ReasonedTransmissionArguments extends TransmissionMutationArguments {reason:string}
export interface ResolveTransmissionArguments extends ReasonedTransmissionArguments {
  outcome:'ACKNOWLEDGED'|'NOT_ACCEPTED';providerReference:string;
  /** Supply the original file identity and its SHA together when attaching retained evidence. */
  evidenceFileId?:RecordId;expectedEvidenceSha256?:Sha256;
}
export interface TransmissionMutationResult extends OperationResult {
  transmissionId:RecordId;transmission:Transmission;
}

export interface ExportManifest {
  schema:'stellar-forge.supplier-order-export.v1';exportId:RecordId;workspaceId:string;
  kind:string;createdAt:string;
  files:Array<{id:RecordId;name:string;originalName:string;bytes:number;sha256:Sha256;type:string}>;
}
export interface ManifestReceipt {
  state:'MANIFEST_RETAINED';exportId:RecordId;
  manifestFile:{name:'supplier-order-manifest.json';bytes:number;sha256:Sha256};
  manifestSha256:Sha256;manifest:ExportManifest;
}
export interface FileReadArguments {
  exportId:RecordId;file:string;expectedManifestSha256:Sha256;expectedSha256:Sha256;
  readId?:string;offset?:number;limit?:number;
}
export interface FileChunk {
  exportId:RecordId;manifestSha256:Sha256;readId:string;
  file:{name:string;contentType:string;bytes:number;sha256:Sha256};
  offset:number;bytesRead:number;nextOffset:number|null;encoding:'base64';data:string;
}
export interface DownloadProgress {exportId:RecordId;file:string;bytes:number;total:number;state:'DOWNLOADING'}
export interface DownloadArguments {
  exportId:RecordId;directory:string;chunkSize?:number;
  onProgress?:(progress:DownloadProgress)=>void|Promise<void>;
  expectedManifestSha256?:Sha256;signal?:AbortSignal;
}
export interface DownloadResult {
  schema:'stellar-forge.supplier-order-download.v1';state:'COMPLETE';directory:string;exportId:RecordId;
  workspaceId:string;kind:string;manifestSha256:Sha256;resumed:boolean;resumedBytes:number;files:number;bytes:number;
}
export interface SupplierOrderClientMethods {
  status(args?:Record<string,never>,options?:CallOptions):Promise<WorkspaceStatus>;
  open(args?:Record<string,never>,options?:CallOptions):Promise<WorkspaceStatus>;
  close(args?:Record<string,never>,options?:CallOptions):Promise<{workspace:WorkspaceAlias;state:'CLOSED'}>;
  inputs(args?:Record<string,never>,options?:CallOptions):Promise<{workspace:WorkspaceAlias;inputs:HostInput[]}>;
  state(args?:Record<string,never>,options?:CallOptions):Promise<WorkspaceState>;
  profile(args?:Record<string,never>,options?:CallOptions):Promise<ProfileSelection>;
  profileTemplate(args?:{base?:'standard'|'unite'},options?:CallOptions):Promise<SupplierOrderProfile>;
  profileHistory(args?:PageArguments,options?:CallOptions):Promise<ProfileHistoryPage>;
  selectProfile(args:SelectProfileArguments,options?:CallOptions):Promise<OperationReply<SelectProfileResult>>;
  orders(args?:OrdersArguments,options?:CallOptions):Promise<Page<OrderSummary>>;
  order(args:{orderId:OrderId},options?:CallOptions):Promise<SupplierOrder>;
  orderItems(args:{orderId:OrderId}&PageArguments,options?:CallOptions):Promise<OrderPage<ReconciledLine>>;
  orderHistory(args:{orderId:OrderId}&PageArguments,options?:CallOptions):Promise<OrderPage<OrderHistory>>;
  documents(args?:DocumentsArguments,options?:CallOptions):Promise<Page<DocumentSummary>>;
  document(args:{id:RecordId},options?:CallOptions):Promise<DocumentRecord>;
  documentLines(args:{id:RecordId}&PageArguments,options?:CallOptions):Promise<DocumentLinePage>;
  drafts(args?:DraftsArguments,options?:CallOptions):Promise<Page<DraftSummary>>;
  draft(args:{draftId:RecordId},options?:CallOptions):Promise<SavedDraft>;
  draftLines(args:{draftId:RecordId}&PageArguments,options?:CallOptions):Promise<DraftLinePage>;
  newDraft(args:NewDraftArguments,options?:CallOptions):Promise<WorkingDraft>;
  saveDraft(args:SaveDraftArguments,options?:CallOptions):Promise<OperationReply>;
  saveDraftInput(args:{requestId:RecordId;inputId:string},options?:CallOptions):Promise<OperationReply>;
  prepare(args:PrepareArguments,options?:CallOptions):Promise<OperationReply>;
  select(args:SelectArguments,options?:CallOptions):Promise<OperationReply>;
  receive(args:ReceiveArguments,options?:CallOptions):Promise<OperationReply>;
  receiveWorkspace(args:ReceiveWorkspaceArguments,options?:CallOptions):Promise<OperationReply<ReceiveWorkspaceResult>>;
  exportWorkspace(args:{requestId:RecordId},options?:CallOptions):Promise<OperationReply>;
  transportChannels(args?:Record<string,never>,options?:CallOptions):Promise<TransportChannels>;
  transmissions(args?:TransmissionsArguments,options?:CallOptions):Promise<Page<Transmission>>;
  transmission(args:{transmissionId:RecordId},options?:CallOptions):Promise<Transmission>;
  transmissionHistory(args:{transmissionId:RecordId}&PageArguments,options?:CallOptions):Promise<TransmissionHistoryPage>;
  prepareTransmission(args:PrepareTransmissionArguments,options?:CallOptions):Promise<OperationReply<TransmissionMutationResult>>;
  sendTransmission(args:TransmissionMutationArguments,options?:CallOptions):Promise<OperationReply<TransmissionMutationResult>>;
  retryTransmission(args:ReasonedTransmissionArguments,options?:CallOptions):Promise<OperationReply<TransmissionMutationResult>>;
  resolveTransmission(args:ResolveTransmissionArguments,options?:CallOptions):Promise<OperationReply<TransmissionMutationResult>>;
  cancelTransmission(args:ReasonedTransmissionArguments,options?:CallOptions):Promise<OperationReply<TransmissionMutationResult>>;
  operation(args:{requestId:RecordId;includeRequest?:boolean},options?:CallOptions):Promise<OperationReply>;
  exportManifest(args:{exportId:RecordId},options?:CallOptions):Promise<ManifestReceipt>;
  exportFile(args:FileReadArguments,options?:CallOptions):Promise<FileChunk>;
  exportFileRelease(args:{exportId:RecordId;readId:string},options?:CallOptions):Promise<{exportId:RecordId;readId:string;released:true}>;
}
/** Construction does not open the native workspace. Methods return original failed operations intact. */
export declare class SupplierOrderClient {
  readonly workspace:WorkspaceAlias;readonly endpoint:string;
  constructor(client:NativeSupplierOrderClient,workspace:WorkspaceAlias,callOptions?:CallOptions);
  call(name:string,args?:Record<string,unknown>,options?:CallOptions):Promise<Record<string,unknown>>;
  pages(method:'profileHistory',args?:PageArguments,options?:CallOptions):AsyncGenerator<ProfileHistoryPage>;
  pages(method:'orders',args?:OrdersArguments,options?:CallOptions):AsyncGenerator<Page<OrderSummary>>;
  pages(method:'orderItems',args:{orderId:OrderId}&PageArguments,options?:CallOptions):AsyncGenerator<OrderPage<ReconciledLine>>;
  pages(method:'orderHistory',args:{orderId:OrderId}&PageArguments,options?:CallOptions):AsyncGenerator<OrderPage<OrderHistory>>;
  pages(method:'documents',args?:DocumentsArguments,options?:CallOptions):AsyncGenerator<Page<DocumentSummary>>;
  pages(method:'documentLines',args:{id:RecordId}&PageArguments,options?:CallOptions):AsyncGenerator<DocumentLinePage>;
  pages(method:'drafts',args?:DraftsArguments,options?:CallOptions):AsyncGenerator<Page<DraftSummary>>;
  pages(method:'draftLines',args:{draftId:RecordId}&PageArguments,options?:CallOptions):AsyncGenerator<DraftLinePage>;
  pages(method:'transmissions',args?:TransmissionsArguments,options?:CallOptions):AsyncGenerator<Page<Transmission>>;
  pages(method:'transmissionHistory',args:{transmissionId:RecordId}&PageArguments,options?:CallOptions):AsyncGenerator<TransmissionHistoryPage>;
  inspectExport(exportId:RecordId):Promise<{manifest:ExportManifest;manifestSha256:Sha256}>;
  downloadExport(args:DownloadArguments):Promise<DownloadResult>;
}
export interface SupplierOrderClient extends SupplierOrderClientMethods {}
export declare function createSupplierOrderClient(options:{
  workspace:WorkspaceAlias;client?:NativeSupplierOrderClient;url?:string;tokenEnv?:string;
  environment?:Record<string,string|undefined>;signal?:AbortSignal;callOptions?:CallOptions;
}):Promise<SupplierOrderClient>;
export declare const SUPPLIER_ORDER_CLIENT_METHODS:Readonly<Record<keyof SupplierOrderClientMethods,string>>;
