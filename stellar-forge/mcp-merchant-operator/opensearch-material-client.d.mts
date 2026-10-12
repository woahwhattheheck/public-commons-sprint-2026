// MIT. TypeScript declarations for the original material/supplier client runtime.
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key:string]: JsonValue };
export type JsonObject = { [key:string]: JsonValue };
export type RecordId = string;
export type Sha256 = string;
/** Original part/customer values remain text, including punctuation and leading zeroes. */
export type MaterialIdentifier = string;
/** Plain nonnegative decimal text; up to40 whole and18 fractional digits. */
export type ExactDecimal = string;
export type MaterialExportFormat = 'catalog.csv'|'catalog.jsonl'|'approved-matches.csv'|'index.json'|'bulk.ndjson'|'delta.ndjson'|'facets.json'|'search-client.ts'|'source.json'|'catalog-bundle.jsonl';
export type SupplierExportFormat = 'review.json'|'issues.csv'|'products.jsonl'|'bmecat.xml'|'xchange.json'|'recipient.jsonl'|'impact.csv';
export interface CallOptions { requestSignal?: AbortSignal|null; timeoutMs?: number }
export interface NativeMerchantClient {
  endpoint:string;
  call(name:string,args:Record<string,unknown>,options?:CallOptions):Promise<Record<string,unknown>>;
}
export interface ClientOptions {
  workspace:string; client?:NativeMerchantClient; url?:string; tokenEnv?:string;
  environment?:Record<string,string|undefined>; signal?:AbortSignal; callOptions?:CallOptions;
}
export interface PageArgs { offset?:number; limit?:number }
export interface CursorArgs { cursor?:string; limit?:number }
export interface HistoryArgs { id:RecordId; beforeRevision?:number; limit?:number }
export interface CursorPage<T> {
  items:T[]; total:number; nextCursor:string|null;
  ordering?:string; consistency?:string; [key:string]:unknown;
}
export interface HistoryPage<T> { items:T[]; total:number; nextRevision:number|null; [key:string]:unknown }
export interface RowsPage<T> { rows:T[]; total:number; nextOffset:number|null; offset?:number; limit?:number; [key:string]:unknown }
export interface ProjectedOperationResult {
  resultSummary:Record<string,unknown>; fullResultRetained:true; fullResultHint:string; [key:string]:unknown;
}
export type NativeOperationResult<T>=(T&{fullResultRetained?:false})|ProjectedOperationResult;
export interface NativeOperation<T=Record<string,unknown>> {
  id:RecordId; kind:string; state:'RUNNING'|'COMPLETE'|'FAILED'|'INTERRUPTED';
  requestSha256:Sha256; createdAt:string; updatedAt:string; request?:JsonObject;
  result?:NativeOperationResult<T>; error?:{code?:string;message?:string;[key:string]:unknown}; [key:string]:unknown;
}
export interface InputFormat {
  kind?:'csv'|'tsv'|'jsonl'|'json'|'xchange-json'; delimiter?:string; hasHeader?:boolean; columns?:string[]; rowsPath?:string;
}
export interface Provenance { url?:string; revision?:string; publisher?:string; kind?:string; note?:string }
export interface HostMaterialInput { inputId:string; name:string; bytes:number; sha256:Sha256; [key:string]:unknown }
export type MappingExpression = string | null |
  {constant:string;reason:string} |
  {join:MappingExpression[];separator?:string} |
  {lookup:{sourceId:RecordId;key:string|string[];from:string|string[];value:string;where?:Record<string,string>}};
export type MaterialField = 'materialId'|'title'|'description'|'partNumber'|'manufacturer'|'category'|'unit'|'salesUnit'|'numerator'|'denominator';
export interface CatalogMapping {
  schema:'stellar-forge.material-catalog-mapping.v1';
  fields:Partial<Record<MaterialField,MappingExpression>>&{materialId:MappingExpression};
  references?:Array<{kind:string;value:MappingExpression;delimiter?:string}>;
  attributes?:Record<string,MappingExpression>; identifierPolicy?:'exact'|'casefold';
  unitAliases?:Record<string,string>;
  delta?:{operation:MappingExpression;upsertValues?:string[];deleteValues?:string[]}|null;
}
export interface Catalog {
  schema:string; id:RecordId; revision:number; title:string; tenantId:string;
  mapping:CatalogMapping; mappingSha256:Sha256; activeEditionId:RecordId|null;
  createdAt:string; updatedAt:string; [key:string]:unknown;
}
export type CatalogSummary=Pick<Catalog,'schema'|'id'|'revision'|'title'|'tenantId'|'mappingSha256'|'activeEditionId'|'createdAt'|'updatedAt'>;
export interface CatalogSource {
  schema:string; id:RecordId; name:string; format:InputFormat; bytes:number; sha256:Sha256;
  provenance:Provenance; columns:string[]; sample:JsonObject[]; createdAt:string; [key:string]:unknown;
}
export type CatalogSourceReference=Pick<CatalogSource,'id'|'name'|'bytes'|'sha256'|'provenance'>;
export type CatalogSourceSummary=Pick<CatalogSource,'schema'|'id'|'name'|'format'|'bytes'|'sha256'|'provenance'|'createdAt'>&{columnCount:number};
export interface MaterialRecord {
  schema:string; key:Sha256; tenantId:string; materialId:MaterialIdentifier;
  title:string; description:string; partNumber:string|null; manufacturer:string|null; category:string|null;
  unit:string|null; originalUnit:string|null; salesUnit:string|null; originalSalesUnit:string|null;
  salesToBase:{numerator:string;denominator:string}|null;
  references:Array<{kind:string;value:string}>; attributes:JsonObject; sha256:Sha256;
}
export interface CatalogEdition {
  schema:string; id:RecordId; catalogId:RecordId; catalogRevision:number; tenantId:string;
  mapping:CatalogMapping; mappingSha256:Sha256; source:CatalogSourceReference;
  dependencies:Array<{id:RecordId;name:string;bytes:number;sha256:Sha256}>;
  baseEditionId:RecordId|null; mode:'full'|'delta'; createdAt:string;
  counts:{added:number;removed:number;changed:number;unchanged:number;total:number;missingUnit:number};
  materialRootSha256:Sha256; reviewSha256:Sha256; [key:string]:unknown;
}
export type CatalogEditionSummary=Pick<CatalogEdition,'schema'|'id'|'catalogId'|'catalogRevision'|'tenantId'|'mappingSha256'|'source'|'dependencies'|'baseEditionId'|'mode'|'createdAt'|'counts'|'materialRootSha256'|'reviewSha256'>;
export interface MaterialChange {
  kind:'added'|'removed'|'changed'; materialId:MaterialIdentifier;
  before:MaterialRecord|null; after:MaterialRecord|null; fields:MaterialField[]|string[];
}
export interface MaterialDecision {
  schema:string; id:RecordId; revision:number; catalogId:RecordId; catalogRevision:number;
  editionId:RecordId; tenantId:string; customerId:string; description:string;
  materialKey:Sha256; materialId:MaterialIdentifier; materialSha256:Sha256;
  status:'APPROVED'|'REJECTED'; note:string; createdAt:string; updatedAt:string;
  currentStatus?:'APPROVED'|'REJECTED'|'NEEDS_REVIEW'; currentMaterial?:MaterialRecord|null;
}
export interface MaterialFacetsPage {
  catalogId:RecordId; editionId:RecordId|null; facet:'category'|'manufacturer'|'unit';
  items:Array<{value:string;count:number}>; total:number; nextOffset:number|null; offset:number; limit:number;
}
export interface MaterialSuggestPage {
  editionId:RecordId|null; candidates:Array<{material:MaterialRecord;reason:string}>;
  approved:MaterialDecision|null; total:number; nextOffset:number|null;
}
export interface MaterialQuantity {
  materialId:MaterialIdentifier; editionId:RecordId;
  quantity:{quantity:ExactDecimal;requestedUnit:string;baseUnit:string;
    baseQuantity:{numerator:string;denominator:string;decimal:string|null}};
}
export type NewOrCurrentCatalog={catalogId?:never;expectedRevision?:never}|{catalogId:RecordId;expectedRevision:number};
export type CatalogSaveRequest={
  requestId:RecordId;title:string;tenantId:string;mapping:CatalogMapping
}&NewOrCurrentCatalog;
export interface MaterialUploadRequest { requestId:RecordId; inputId:string; format:InputFormat; provenance?:Provenance }
export interface MaterialPreviewRequest {
  requestId:RecordId;catalogId:RecordId;expectedRevision:number;sourceId:RecordId;
  mode?:'full'|'delta';baseEditionId?:RecordId|null;
}
export interface MaterialSelectRequest {
  requestId:RecordId;catalogId:RecordId;expectedRevision:number;editionId:RecordId;reviewSha256:Sha256;
}
export type MaterialDecisionRequest={
  requestId:RecordId;catalogId:RecordId;expectedCatalogRevision:number;customerId:string;description:string;
  materialKey:Sha256;expectedMaterialSha256:Sha256;status:'APPROVED'|'REJECTED';note?:string
}&({decisionId?:never;expectedRevision?:never}|{decisionId:RecordId;expectedRevision:number});
export interface MaterialDraftRequest {
  requestId:RecordId;catalogId:RecordId;expectedRevision:number;index:string;
  variant?:'baseline'|'identifiers';title?:string;
}
export interface MaterialExportRequest {
  requestId:RecordId;catalogId:RecordId;expectedCatalogRevision:number;editionId?:RecordId;
  index?:string;formats:MaterialExportFormat[];
}
export type SupplierBinding=string|{constant:JsonValue;reason:string};
export type SupplierBindings=Record<string,SupplierBinding>;
export interface SupplierPatch { path:string;value:JsonValue;reason:string }
export type XChangeTarget='xchange-2.0'|'2ba-xchange-2.0';
/** Keys are JSON Pointers relative to the selected native value; values retain exact original number lexemes. */
export type XChangeNumberTokens=Record<string,string>;
export type XChangeSource={url:string;sha256:Sha256;revision:string};
export type XChangeHeaderOverride={value:JsonObject;numberTokens:XChangeNumberTokens;reason:string};
export type XChangeSupplierHeaderOverride=XChangeHeaderOverride&{supplierKey:string};
export type XChangeProfile={
  schema:'stellar-forge.supplier-xchange-profile.v1';id:string;target:XChangeTarget;
  header:XChangeHeaderOverride|null;supplierHeaders:XChangeSupplierHeaderOverride[];
  statusMapping:null|{source:XChangeSource;product:Record<string,string>;tradeItem:Record<string,string>};
  releasedModellingClasses:Array<{code:string;version:string;source:XChangeSource}>;
  attachmentPolicy:{keepMimeUrlCodes:string[]};
  source?:JsonObject;
};
/** The complete original Sonepar/BMEcat or native xChange profile is returned by supplierTemplates(). */
export type SupplierProfile=JsonObject|XChangeProfile;
export type XChangeRecipientKind='product'|'tradeItem';
export type XChangeRecipientAction='added'|'changed'|'unchanged'|'expired'|'deleted';
export interface XChangeRecipientReview {
  schema:'stellar-forge.xchange-recipient-review.v1';target:XChangeTarget;catalogueType:JsonValue;
  previousReviewId:RecordId|null;previousReviewSha256:Sha256|null;
  counts:{productsAdded:number;productsChanged:number;productsUnchanged:number;productsExpired:number;
    tradeItemsAdded:number;tradeItemsChanged:number;tradeItemsUnchanged:number;tradeItemsDeleted:number;
    productsTotal:number;tradeItemsTotal:number};
  rowsRootSha256:Sha256;supplierCount:number;sourceProductCount:number;
  header:JsonObject;headerNumberTokens:XChangeNumberTokens;headerSha256:Sha256;
  materialization:Record<string,string>;
}
export interface XChangeRecipientPage extends RowsPage<XChangeRecipientRow> {
  reviewId:RecordId;reviewSha256:Sha256;recipient:XChangeRecipientReview;
}
export interface XChangeRecipientRow {
  schema:'stellar-forge.xchange-recipient-record.v1';kind:XChangeRecipientKind;key:string;
  reviewId:RecordId;planId:RecordId;catalogId:RecordId;tenantId:string;
  supplierKey:string;productKey:string;materialKey:Sha256|null;identifier:string;action:XChangeRecipientAction;
  beforeSha256:Sha256|null;afterSha256:Sha256|null;before:JsonObject|null;after:JsonObject|null;sha256:Sha256;
  [key:string]:unknown;
}
export interface SupplierTemplate {
  schema:'stellar-forge.supplier-templates.v1';profileId:string;source:unknown;
  profile:SupplierProfile;product:JsonObject;bindings:SupplierBindings;catalogMapping?:CatalogMapping;
}
export interface SupplierPlan {
  schema:string;id:RecordId;revision:number;catalogId:RecordId;tenantId:string;title:string;
  editionId:RecordId;editionReviewSha256:Sha256;profile:SupplierProfile;bindings:SupplierBindings;
  bindingSha256:Sha256;previousReviewId:RecordId|null;createdAt:string;updatedAt:string;sha256:Sha256;
}
export type SupplierPlanSummary=Omit<SupplierPlan,'profile'|'bindings'>;
export interface SupplierCorrection {
  schema:string;id:RecordId;revision:number;planId:RecordId;planRevision:number;catalogId:RecordId;
  tenantId:string;editionId:RecordId;materialKey:Sha256;materialId:MaterialIdentifier;
  materialSha256:Sha256;baseProductSha256:Sha256;patches:SupplierPatch[];
  createdAt:string;updatedAt:string;sha256:Sha256;
}
export type SupplierCorrectionSummary=Omit<SupplierCorrection,'patches'>&{patchCount:number};
export interface SupplierFinding {
  severity:'error'|'warning'|'info';code:string;path:string;message:string;
  rule?:{section?:string;url?:string;[key:string]:unknown}; [key:string]:unknown;
}
export interface SupplierProduct {
  plan:SupplierPlan;material:MaterialRecord;base:JsonObject;baseProductSha256:Sha256;
  correction:SupplierCorrection|null;correctionApplicable:boolean;product:JsonObject;
}
export interface SupplierReview {
  schema:string;id:RecordId;planId:RecordId;planRevision:number;catalogId:RecordId;tenantId:string;
  editionId:RecordId;editionReviewSha256:Sha256;source:CatalogSourceReference;plan:SupplierPlan;
  correctionsRootSha256:Sha256;rowsRootSha256:Sha256;createdAt:string;recipient?:XChangeRecipientReview;
  globalFindings:SupplierFinding[];counts:{total:number;readyProducts:number;errorProducts:number;errors:number;warnings:number};
  findings:Array<{severity:string;code:string;count:number}>;sha256:Sha256;
}
export type SupplierReviewSummary=Omit<SupplierReview,'plan'|'globalFindings'>&{globalFindingCount:number};
export interface SupplierReviewRow {
  schema:string;reviewId:RecordId;planId:RecordId;planRevision:number;catalogId:RecordId;tenantId:string;
  editionId:RecordId;materialKey:Sha256;materialId:MaterialIdentifier;materialSha256:Sha256;
  baseProductSha256:Sha256;correctionId:RecordId|null;correctionRevision:number|null;
  correctionApplied:boolean;product:JsonObject;findings:SupplierFinding[];sha256:Sha256;[key:string]:unknown;
}
export type SupplierSaveRequest={
  requestId:RecordId;catalogId:RecordId;editionId:RecordId;title:string;
  profile:SupplierProfile;bindings:SupplierBindings;previousReviewId?:RecordId|null
}&({planId?:never;expectedRevision?:never}|{planId:RecordId;expectedRevision:number});
export interface SupplierCorrectionRequest {
  requestId:RecordId;planId:RecordId;expectedPlanRevision:number;materialKey:Sha256;
  expectedMaterialSha256:Sha256;expectedBaseProductSha256:Sha256;
  /** Zero creates the original correction; a later save requires its current revision. */
  expectedRevision:number;patches:SupplierPatch[];
}
export interface SupplierExportRequest {
  requestId:RecordId;reviewId:RecordId;expectedReviewSha256:Sha256;formats:SupplierExportFormat[];
}
export interface ExportFileIdentity { name:string;bytes:number;sha256:Sha256;[key:string]:unknown }
export interface ExportFile extends ExportFileIdentity { type:string }
export interface MaterialExportManifest {
  schema:'stellar-forge.opensearch-material-export.v1';exportId:RecordId;requestId:RecordId;
  requestSha256:Sha256;workspaceId:string;createdAt:string;kind:'material'|'supplier';sourceSnapshotSha256?:Sha256;
  selection:Record<string,unknown>;files:ExportFile[];
}
export interface RetainedExport {
  exportId:RecordId;manifest:MaterialExportManifest;manifestSha256:Sha256;manifestFile:ExportFileIdentity;
}
export interface ExportManifestInfo { state:'MANIFEST_RETAINED';exportId:RecordId;manifestFile:ExportFileIdentity }
export interface ExportFileRequest {
  exportId:RecordId;file:string;expectedManifestSha256:Sha256;expectedSha256:Sha256;
  offset:number;limit:number;readId?:string;
}
export interface ExportFileChunk {
  exportId:RecordId;manifestSha256:Sha256;file:ExportFile;readId:string;
  offset:number;bytesRead:number;encoding:'base64';nextOffset:number|null;data:string;
}
export interface DownloadProgress { exportId:RecordId;file:string;bytes:number;total:number;state:'DOWNLOADING' }
export interface DownloadOptions {
  exportId:RecordId;directory:string;chunkSize?:number;expectedManifestSha256?:Sha256;
  signal?:AbortSignal;onProgress?:(progress:DownloadProgress)=>void|Promise<void>;
}
export interface DownloadResult {
  schema:'stellar-forge.opensearch-material-download.v1';state:'COMPLETE';directory:string;
  exportId:RecordId;workspaceId:string;kind:'material'|'supplier';selection:Record<string,unknown>;
  manifestSha256:Sha256;resumed:boolean;resumedBytes:number;files:number;bytes:number;
}

export interface MaterialClientRequests {
  status:Record<string,never>;
  open:Record<string,never>;
  close:Record<string,never>;
  operation:{requestId:RecordId;includeRequest?:boolean};
  materialInputs:Record<string,never>;
  materialList:CursorArgs&{collection:'catalogs'|'sources'|'editions'|'decisions';catalogId?:RecordId};
  materialCatalog:{catalogId:RecordId;revision?:number};
  materialHistory:HistoryArgs&{kind:'catalog'|'decision'};
  materialDecisionGet:{decisionId:RecordId;revision?:number};
  materialSource:{sourceId:RecordId};
  materialEdition:{editionId:RecordId};
  materialRows:PageArgs&{editionId:RecordId;search?:string};
  materialChanges:PageArgs&{editionId:RecordId};
  materialGet:{editionId:RecordId;materialKey:Sha256};
  materialFacets:PageArgs&{catalogId:RecordId;editionId?:RecordId;facet:'category'|'manufacturer'|'unit'};
  materialSuggest:PageArgs&{catalogId:RecordId;text:string;customerId?:string;category?:string;manufacturer?:string;unit?:string};
  materialQuantity:{catalogId:RecordId;materialKey:Sha256;expectedMaterialSha256:Sha256;quantity:ExactDecimal;unit:string};
  materialSave:CatalogSaveRequest;
  materialUpload:MaterialUploadRequest;
  materialPreview:MaterialPreviewRequest;
  materialSelect:MaterialSelectRequest;
  materialDecision:MaterialDecisionRequest;
  materialDraft:MaterialDraftRequest;
  materialReceive:{requestId:RecordId;inputId:string};
  materialExport:MaterialExportRequest;
  supplierTemplates:{target?:XChangeTarget};
  supplierList:CursorArgs&{collection:'plans'|'reviews'|'corrections';catalogId?:RecordId;planId?:RecordId};
  supplierPlan:{planId:RecordId;revision?:number};
  supplierHistory:HistoryArgs&{kind:'plan'|'correction'};
  supplierProduct:{planId:RecordId;materialKey:Sha256};
  supplierCorrectionGet:{correctionId:RecordId;revision?:number};
  supplierReviewGet:{reviewId:RecordId};
  supplierRows:PageArgs&{reviewId:RecordId;status?:'all'|'errors'|'warnings'|'ready';search?:string};
  supplierRecipientRows:PageArgs&{reviewId:RecordId;kind?:'all'|XChangeRecipientKind;change?:'all'|XChangeRecipientAction;search?:string};
  supplierRow:{reviewId:RecordId;materialKey:Sha256};
  supplierSave:SupplierSaveRequest;
  supplierCorrection:SupplierCorrectionRequest;
  supplierReview:{requestId:RecordId;planId:RecordId;expectedRevision:number};
  supplierExport:SupplierExportRequest;
  exportManifest:{exportId:RecordId};
  exportFile:ExportFileRequest;
  exportFileRelease:{exportId:RecordId;readId:string};
}
export interface MaterialClientResults {
  status:Record<string,unknown>;
  open:Record<string,unknown>;
  close:Record<string,unknown>;
  operation:NativeOperation;
  materialInputs:{inputs:HostMaterialInput[];[key:string]:unknown};
  materialList:CursorPage<CatalogSummary|CatalogSourceSummary|CatalogEditionSummary|MaterialDecision>;
  materialCatalog:Catalog;
  materialHistory:HistoryPage<CatalogSummary|MaterialDecision>;
  materialDecisionGet:MaterialDecision;
  materialSource:CatalogSource;
  materialEdition:CatalogEdition;
  materialRows:RowsPage<MaterialRecord>;
  materialChanges:RowsPage<MaterialChange>;
  materialGet:MaterialRecord;
  materialFacets:MaterialFacetsPage;
  materialSuggest:MaterialSuggestPage;
  materialQuantity:MaterialQuantity;
  materialSave:NativeOperation<{catalog:Catalog}>;
  materialUpload:NativeOperation<{source:CatalogSource}>;
  materialPreview:NativeOperation<{edition:CatalogEdition}>;
  materialSelect:NativeOperation<{catalog:Catalog;edition:CatalogEdition}>;
  materialDecision:NativeOperation<{decision:MaterialDecision}>;
  materialDraft:NativeOperation<{draftId:RecordId;revision:number;draft:Record<string,unknown>}>;
  materialReceive:NativeOperation;
  materialExport:NativeOperation<RetainedExport>;
  supplierTemplates:SupplierTemplate;
  supplierList:CursorPage<SupplierPlanSummary|SupplierReviewSummary|SupplierCorrectionSummary>;
  supplierPlan:SupplierPlan;
  supplierHistory:HistoryPage<SupplierPlanSummary|SupplierCorrectionSummary>;
  supplierProduct:SupplierProduct;
  supplierCorrectionGet:SupplierCorrection;
  supplierReviewGet:SupplierReview;
  supplierRows:RowsPage<SupplierReviewRow>;
  supplierRecipientRows:XChangeRecipientPage;
  supplierRow:SupplierReviewRow;
  supplierSave:NativeOperation<{supplierPlan:SupplierPlan}>;
  supplierCorrection:NativeOperation<{supplierCorrection:SupplierCorrection}>;
  supplierReview:NativeOperation<{supplierReview:SupplierReview}>;
  supplierExport:NativeOperation<RetainedExport>;
  exportManifest:ExportManifestInfo;
  exportFile:ExportFileChunk;
  exportFileRelease:Record<string,unknown>;
}
export type PagedMaterialMethod='materialList'|'materialHistory'|'materialRows'|'materialChanges'|'materialFacets'|'materialSuggest'|'supplierList'|'supplierHistory'|'supplierRows'|'supplierRecipientRows';
export declare const OPENSEARCH_MATERIAL_CLIENT_METHODS:Readonly<{
  status:'status';
  open:'open';
  close:'close';
  operation:'operation';
  materialInputs:'material_inputs';
  materialList:'material_list';
  materialCatalog:'material_catalog';
  materialHistory:'material_history';
  materialDecisionGet:'material_decision_get';
  materialSource:'material_source';
  materialEdition:'material_edition';
  materialRows:'material_rows';
  materialChanges:'material_changes';
  materialGet:'material_get';
  materialFacets:'material_facets';
  materialSuggest:'material_suggest';
  materialQuantity:'material_quantity';
  materialSave:'material_save';
  materialUpload:'material_upload';
  materialPreview:'material_preview';
  materialSelect:'material_select';
  materialDecision:'material_decision';
  materialDraft:'material_draft';
  materialReceive:'material_receive';
  materialExport:'material_export';
  supplierTemplates:'supplier_templates';
  supplierList:'supplier_list';
  supplierPlan:'supplier_plan';
  supplierHistory:'supplier_history';
  supplierProduct:'supplier_product';
  supplierCorrectionGet:'supplier_correction_get';
  supplierReviewGet:'supplier_review_get';
  supplierRows:'supplier_rows';
  supplierRecipientRows:'supplier_recipient_rows';
  supplierRow:'supplier_row';
  supplierSave:'supplier_save';
  supplierCorrection:'supplier_correction';
  supplierReview:'supplier_review';
  supplierExport:'supplier_export';
  exportManifest:'material_export_manifest';
  exportFile:'material_export_file';
  exportFileRelease:'material_export_file_release';
}>;
export declare class OpenSearchMaterialClient {
  readonly workspace:string;
  readonly endpoint:string;
  constructor(client:NativeMerchantClient,workspace:string,callOptions?:CallOptions);
  call(name:string,args?:Record<string,unknown>,options?:CallOptions):Promise<Record<string,unknown>>;
  status(args?:MaterialClientRequests['status'],options?:CallOptions):Promise<MaterialClientResults['status']>;
  open(args?:MaterialClientRequests['open'],options?:CallOptions):Promise<MaterialClientResults['open']>;
  close(args?:MaterialClientRequests['close'],options?:CallOptions):Promise<MaterialClientResults['close']>;
  operation(args:MaterialClientRequests['operation'],options?:CallOptions):Promise<MaterialClientResults['operation']>;
  materialInputs(args?:MaterialClientRequests['materialInputs'],options?:CallOptions):Promise<MaterialClientResults['materialInputs']>;
  materialList(args:MaterialClientRequests['materialList'],options?:CallOptions):Promise<MaterialClientResults['materialList']>;
  materialCatalog(args:MaterialClientRequests['materialCatalog'],options?:CallOptions):Promise<MaterialClientResults['materialCatalog']>;
  materialHistory(args:MaterialClientRequests['materialHistory'],options?:CallOptions):Promise<MaterialClientResults['materialHistory']>;
  materialDecisionGet(args:MaterialClientRequests['materialDecisionGet'],options?:CallOptions):Promise<MaterialClientResults['materialDecisionGet']>;
  materialSource(args:MaterialClientRequests['materialSource'],options?:CallOptions):Promise<MaterialClientResults['materialSource']>;
  materialEdition(args:MaterialClientRequests['materialEdition'],options?:CallOptions):Promise<MaterialClientResults['materialEdition']>;
  materialRows(args:MaterialClientRequests['materialRows'],options?:CallOptions):Promise<MaterialClientResults['materialRows']>;
  materialChanges(args:MaterialClientRequests['materialChanges'],options?:CallOptions):Promise<MaterialClientResults['materialChanges']>;
  materialGet(args:MaterialClientRequests['materialGet'],options?:CallOptions):Promise<MaterialClientResults['materialGet']>;
  materialFacets(args:MaterialClientRequests['materialFacets'],options?:CallOptions):Promise<MaterialClientResults['materialFacets']>;
  materialSuggest(args:MaterialClientRequests['materialSuggest'],options?:CallOptions):Promise<MaterialClientResults['materialSuggest']>;
  materialQuantity(args:MaterialClientRequests['materialQuantity'],options?:CallOptions):Promise<MaterialClientResults['materialQuantity']>;
  materialSave(args:MaterialClientRequests['materialSave'],options?:CallOptions):Promise<MaterialClientResults['materialSave']>;
  materialUpload(args:MaterialClientRequests['materialUpload'],options?:CallOptions):Promise<MaterialClientResults['materialUpload']>;
  materialPreview(args:MaterialClientRequests['materialPreview'],options?:CallOptions):Promise<MaterialClientResults['materialPreview']>;
  materialSelect(args:MaterialClientRequests['materialSelect'],options?:CallOptions):Promise<MaterialClientResults['materialSelect']>;
  materialDecision(args:MaterialClientRequests['materialDecision'],options?:CallOptions):Promise<MaterialClientResults['materialDecision']>;
  materialDraft(args:MaterialClientRequests['materialDraft'],options?:CallOptions):Promise<MaterialClientResults['materialDraft']>;
  materialReceive(args:MaterialClientRequests['materialReceive'],options?:CallOptions):Promise<MaterialClientResults['materialReceive']>;
  materialExport(args:MaterialClientRequests['materialExport'],options?:CallOptions):Promise<MaterialClientResults['materialExport']>;
  supplierTemplates(args?:MaterialClientRequests['supplierTemplates'],options?:CallOptions):Promise<MaterialClientResults['supplierTemplates']>;
  supplierList(args:MaterialClientRequests['supplierList'],options?:CallOptions):Promise<MaterialClientResults['supplierList']>;
  supplierPlan(args:MaterialClientRequests['supplierPlan'],options?:CallOptions):Promise<MaterialClientResults['supplierPlan']>;
  supplierHistory(args:MaterialClientRequests['supplierHistory'],options?:CallOptions):Promise<MaterialClientResults['supplierHistory']>;
  supplierProduct(args:MaterialClientRequests['supplierProduct'],options?:CallOptions):Promise<MaterialClientResults['supplierProduct']>;
  supplierCorrectionGet(args:MaterialClientRequests['supplierCorrectionGet'],options?:CallOptions):Promise<MaterialClientResults['supplierCorrectionGet']>;
  supplierReviewGet(args:MaterialClientRequests['supplierReviewGet'],options?:CallOptions):Promise<MaterialClientResults['supplierReviewGet']>;
  supplierRows(args:MaterialClientRequests['supplierRows'],options?:CallOptions):Promise<MaterialClientResults['supplierRows']>;
  supplierRecipientRows(args:MaterialClientRequests['supplierRecipientRows'],options?:CallOptions):Promise<MaterialClientResults['supplierRecipientRows']>;
  supplierRow(args:MaterialClientRequests['supplierRow'],options?:CallOptions):Promise<MaterialClientResults['supplierRow']>;
  supplierSave(args:MaterialClientRequests['supplierSave'],options?:CallOptions):Promise<MaterialClientResults['supplierSave']>;
  supplierCorrection(args:MaterialClientRequests['supplierCorrection'],options?:CallOptions):Promise<MaterialClientResults['supplierCorrection']>;
  supplierReview(args:MaterialClientRequests['supplierReview'],options?:CallOptions):Promise<MaterialClientResults['supplierReview']>;
  supplierExport(args:MaterialClientRequests['supplierExport'],options?:CallOptions):Promise<MaterialClientResults['supplierExport']>;
  exportManifest(args:MaterialClientRequests['exportManifest'],options?:CallOptions):Promise<MaterialClientResults['exportManifest']>;
  exportFile(args:MaterialClientRequests['exportFile'],options?:CallOptions):Promise<MaterialClientResults['exportFile']>;
  exportFileRelease(args:MaterialClientRequests['exportFileRelease'],options?:CallOptions):Promise<MaterialClientResults['exportFileRelease']>;
  pages<M extends PagedMaterialMethod>(method:M,args:MaterialClientRequests[M],options?:CallOptions):AsyncGenerator<MaterialClientResults[M],void,unknown>;
  inspectExport(exportId:RecordId):Promise<{manifest:MaterialExportManifest;manifestSha256:Sha256}>;
  downloadExport(options:DownloadOptions):Promise<DownloadResult>;
}
export declare function createOpenSearchMaterialClient(options:ClientOptions):Promise<OpenSearchMaterialClient>;
