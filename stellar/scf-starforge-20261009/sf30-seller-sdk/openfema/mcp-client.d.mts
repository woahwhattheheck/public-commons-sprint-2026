/** MIT. Exact source-owned OpenFEMA client and retained-file receiving types. */
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export type PortfolioTable = 'projects'|'applicants'|'disasters'|'declarations'|'categories'|'issues';
export type FileKind = 'source'|'portfolio'|'export'|'receipt'|'mapping'|'delivery'|'reconciliation'|'delivery-comparison'|'workspace';
/** Exact original USD decimal text; preserve signs and precision. */
export type DecimalUsd = string;
export interface SourceScope {
  disasterNumbers?: Array<number|string>; states?: string[];
  declarationDateFrom?: string; declarationDateTo?: string; pageSize?: number;
}
export interface PortfolioCriteria {
  name?: string; states?: string[]; disasters?: string[]; applicants?: string[];
  categories?: string[]; counties?: string[]; declarationFrom?: string; declarationTo?: string;
  minimumFederal?: DecimalUsd; maximumFederal?: DecimalUsd; includeUnjoined?: boolean; note?: string;
}
export interface AnalystAnnotation {
  subject: string; note?: string; status?: 'open'|'reviewed'|'follow_up'|'resolved';
  disposition?: 'include'|'exclude'; priority?: 'low'|'normal'|'high'; owner?: string; dueDate?: string;
  /** Exact retained applicant choice; maximum 200 characters. A choice requires an explanatory note. */
  applicantSourceId?: string;
}
export interface NativePayment {
  scheme: 'exact'; network: 'stellar:testnet'|'stellar:pubnet';
  asset: string; amount: string; payTo: string; maxTimeoutSeconds: number;
}
export type DeliveryInputKind = 'mapping'|'customer_csv';
export interface DeliveryInputEntry {path:string;sha256:string;kind:DeliveryInputKind;name?:string;label?:string}
export interface DeliveryInputInspection {
  entry:DeliveryInputEntry;bytes:number;encoding:'utf-8';originalBom?:boolean;
  mapping?:{name:string;targetName:string;columns:number;schemaBytes:number};receiving:string;
}
export interface MappingRecord {
  id:string;name:string;targetName:string;targetKind:'staging'|'customer_supplied';
  mappingSha256:string;schemaSha256:string;objectSha256:string;bytes:number;
  previousMappingId:string|null;columns:number;createdAt:string;
}
export interface MappingReview {id:string;mappingId:string;mappingSha256:string;reviewer:string;note:string;createdAt:string}
export interface NativeExport {id:string;kind:string;versionId:string|null;table:string|null;format:string;name:string;type:string;createdAt:string;sha256:string;bytes:number;downloadUrl:string}
export interface ProjectDeliveryRecord {
  id:string;mappingId:string;mappingSha256:string;mappingReviewId:string;portfolioId:string;versionId:string;editionId:string;
  documentSha256:string;documentBytes:number;summary:Record<string,number|string|null>;
  customerReconciliationId:string|null;export:NativeExport;createdAt:string;
}
export interface CustomerReconciliationRecord {
  id:string;deliveryId:string;portfolioId:string;versionId:string;mappingId:string;mappingSha256:string;editionId:string;
  documentSha256:string;documentBytes:number;customerFileObjectSha256:string;
  file:{name:string;bytes:number;sha256:string;columns:string[]};summary:{customerRows:number;sourceRows:number;reviewProposals:number;counts:Record<string,number>};
  export:NativeExport;createdAt:string;
}
export interface AppliedDeliveryReview {
  id:string;reconciliationId:string;portfolioId:string;beforeVersionId:string;versionId:string;
  rowNumbers:number[];applied:number;reviewer:string;note:string;customerFileSha256:string;createdAt:string;
}
export interface DeliveryComparisonRecord {
  id:string;beforeDeliveryId:string;afterDeliveryId:string;sameScope:boolean;sameMapping:boolean;
  summary:Record<string,unknown>;documentSha256:string;documentBytes:number;export:NativeExport;createdAt:string;
}
export interface NativeActionResult<T=Record<string,unknown>> {
  operationId:string;reused:boolean;result:T;view:Record<string,unknown> & {workspaceId:string;revision:number};
}
export interface RetainedWorkspaceArchive {
  schema:'stellar-forge.openfema-retained-workspace-archive.v1';state:'COMPLETE';id:string;
  workspaceId:string;operationId:string;revision:number;preparedAt:string;receivedAt:string;
  file:{name:'OpenFEMA_Complete_Workspace.zip';type:'application/zip';bytes:number;sha256:string};
  selection:{kind:'workspace';id:string;file:'OpenFEMA_Complete_Workspace.zip'};receiving:string;
}
export interface OpenFemaActions {
  'source.capture': {scope:SourceScope;label?:string};
  'source.resume': {captureId:string};
  'source.pause': {captureId:string};
  /** The alias binds a host-selected full bundle and exact SHA256. */
  'source.import': {sourcePackage:string};
  'portfolio.create': {name?:string;editionId:string;criteria:PortfolioCriteria};
  'portfolio.revise': {portfolioId:string;editionId:string;criteria:PortfolioCriteria & {name:string};expectedVersion:string};
  'portfolio.select': {portfolioId:string;versionId?:string};
  'portfolio.compare': {beforeVersionId:string;afterVersionId:string};
  'review.save': {portfolioId:string;versionId:string;annotation:AnalystAnnotation};
  'review.accept': {portfolioId:string;versionId:string;note:string};
  'dataset.prepare': {versionId:string;table?:PortfolioTable;name?:string};
  'dataset.query': {datasetId:string;query?:string};
  'release.prepare': {datasetId:string;origin:string;path?:string;payment:NativePayment};
  'release.inspect': {releaseId:string};
  'release.activate': {releaseId:string;expectedGeneration:number};
  'release.start': {releaseId:string;expectedGeneration:number};
  'release.stop': {releaseId:string};
  'release.rollback': {releaseId:string;expectedGeneration:number};
  'buyer.inspect': {intentIds:string[]};
  'buyer.receive': {intentIds:string[]};
  /** Complete host-declared mapping JSON, with its original schema evidence and SHA. */
  'delivery.mapping.save': {mappingPackage:string;previousMappingId?:string};
  'delivery.mapping.review': {mappingId:string;expectedMappingSha256:string;reviewer:string;note:string};
  'delivery.export': {mappingId:string;versionId:string;customerReconciliationId?:string};
  /** Alias of the complete original UTF-8 file in connection.deliveryInputs. */
  'delivery.reconcile': {deliveryId:string;customerFilePackage:string};
  'delivery.review.apply': {reconciliationId:string;versionId:string;rowNumbers:number[];reviewer:string;note:string};
  'delivery.compare': {beforeDeliveryId:string;afterDeliveryId:string};
  'export.create': {versionId:string;table?:PortfolioTable;format?:'json'|'csv'|'html'};
  'source.export': {editionId:string};
  'workspace.export': Record<string,never>;
}
export interface FileSelection {kind:FileKind;id:string;file?:string}
export interface FileDescriptor {
  selection: FileSelection; name:string; type:string; bytes:number; sha256:string;
  source?: Record<string,unknown>;
}
export interface FileChunk {
  readId:string; file:{name:string;type?:string;contentType?:string;bytes:number;sha256:string};
  offset:number;bytesRead:number;nextOffset:number|null;encoding:'base64';data:string;
}
export interface FileRelease {workspace:string;workspaceId:string;released:true;readId:string}
export interface Page<T=Record<string,unknown>> {
  versionId:string;table:PortfolioTable;columns:string[];total:number;
  offset:number;limit:number;rows:T[];nextOffset:number|null;
}
export type ArchiveCollection = 'editions'|'portfolios'|'versions'|'reviews'|'acceptances'|'comparisons'|'datasets'|'releases'|'receipts'|'exports'|'captures'|'deliveryMappings'|'deliveryMappingReviews'|'projectDeliveries'|'deliveryReconciliations'|'deliveryReviewImports'|'deliveryComparisons';
export interface ArchivePage {
  collection:ArchiveCollection;revision:number;expectedRevision:number;portfolioId?:string;
  total:number;offset:number;limit:number;rows:Record<string,unknown>[];nextOffset:number|null;
}
export interface ReplyIdentity {
  workspace:string;workspaceId:string;httpStatus?:number;state?:'OUTCOME_UNCERTAIN';
  request?:{action:string;payload:Record<string,unknown>;operationId:string;expectedRevision:number};
  sourcePackage?:{alias:string;label:string;sha256:string;bytes:number};
  deliveryInput?:{alias:string;label:string;kind:DeliveryInputKind;name:string;sha256:string;bytes:number};
  workspaceArchive?:RetainedWorkspaceArchive | {state:'RECEIVING';id:string;operationId:string;error:string;message:string;recovery:string};
  recovery?:string;
}
export type NativeReply<T=Record<string,unknown>> = ReplyIdentity &
  ({ok:true;native:T}|{ok:false;native:Record<string,unknown>});
export interface WorkspaceList {
  configured:boolean;workspaces:Array<{workspace:string;label:string;workspaceId:string;
    ownership:'EXISTING_OPENFEMA_WORKSPACE';connection:string;sourcePackages:Array<{alias:string;label:string;sha256:string}>;deliveryInputs:Array<{alias:string;label:string;kind:DeliveryInputKind;name:string;sha256:string}>}>;
  [key:string]:unknown;
}
export interface OpenFemaReads {
  schema: Record<string,never>; view:Record<string,never>; operation:{operationId:string};
  archive:{collection:ArchiveCollection;offset?:number;limit?:number;expectedRevision?:number;portfolioId?:string};
  edition:{editionId:string};version:{versionId:string};
  rows:{versionId:string;table:PortfolioTable;search?:string;sort?:string;direction?:'asc'|'desc';offset?:number;limit?:number};
  detail:{versionId:string;table:PortfolioTable;id:string};
  files:{kind:FileKind;id:string};
  file_read:FileSelection & {readId?:string;expectedSha256?:string;offset?:number;limit?:number};
  file_release:{readId:string};
}
export interface CallOptions {signal?:AbortSignal;timeoutMs?:number}
export interface ActionOptions extends CallOptions {operationId:string;expectedRevision:number}
export interface ConnectionOptions {
  url:string;workspace:string;tokenEnv?:string;environment?:Record<string,string|undefined>;
  signal?:AbortSignal;maximumResponseBytes?:number;
}
type ToolName<K extends string> = K | `merchant_openfema_${K}`;
export interface OpenFemaClient {
  workspace:string;endpoint:string;
  call(name:'workspaces'|'merchant_openfema_workspaces',args?:Record<string,never>,options?:CallOptions):Promise<WorkspaceList>;
  call(name:'rows'|'merchant_openfema_rows',args:OpenFemaReads['rows'],options?:CallOptions):Promise<NativeReply<Page>>;
  call(name:'archive'|'merchant_openfema_archive',args:OpenFemaReads['archive'],options?:CallOptions):Promise<NativeReply<ArchivePage>>;
  call(name:'file_read'|'merchant_openfema_file_read',args:OpenFemaReads['file_read'],options?:CallOptions):Promise<NativeReply<FileChunk>>;
  call(name:'file_release'|'merchant_openfema_file_release',args:OpenFemaReads['file_release'],options?:CallOptions):Promise<FileRelease>;
  call(name:'files'|'merchant_openfema_files',args:OpenFemaReads['files'],options?:CallOptions):Promise<NativeReply<{kind:FileKind;id:string;files:FileDescriptor[];[key:string]:unknown}>>;
  call<K extends Exclude<keyof OpenFemaReads,'file_release'>>(name:ToolName<K>,args:OpenFemaReads[K],options?:CallOptions):Promise<NativeReply>;
  action(action:'delivery.mapping.save',payload:OpenFemaActions['delivery.mapping.save'],options:ActionOptions):Promise<NativeReply<NativeActionResult<MappingRecord>>>;
  action(action:'delivery.mapping.review',payload:OpenFemaActions['delivery.mapping.review'],options:ActionOptions):Promise<NativeReply<NativeActionResult<MappingReview>>>;
  action(action:'delivery.export',payload:OpenFemaActions['delivery.export'],options:ActionOptions):Promise<NativeReply<NativeActionResult<ProjectDeliveryRecord>>>;
  action(action:'delivery.reconcile',payload:OpenFemaActions['delivery.reconcile'],options:ActionOptions):Promise<NativeReply<NativeActionResult<CustomerReconciliationRecord>>>;
  action(action:'delivery.review.apply',payload:OpenFemaActions['delivery.review.apply'],options:ActionOptions):Promise<NativeReply<NativeActionResult<AppliedDeliveryReview>>>;
  action(action:'delivery.compare',payload:OpenFemaActions['delivery.compare'],options:ActionOptions):Promise<NativeReply<NativeActionResult<DeliveryComparisonRecord>>>;
  action<K extends keyof OpenFemaActions>(action:K,payload:OpenFemaActions[K],options:ActionOptions):Promise<NativeReply>;
}
export interface TransferFile extends FileDescriptor {originalName:string}
export interface TransferManifest {
  schema:'stellar-forge.openfema-file-transfer.v1';exportId:string;workspace:string;workspaceId:string;
  kind:FileKind;id:string;file?:string;files:TransferFile[];provenance:string;
  dataset?:unknown;intentIds?:string[];originalManifestSha256?:string;mode?:string;
}
export interface FileOptions extends ConnectionOptions,FileSelection {expectedWorkspaceId?:string}
export interface DownloadOptions extends FileOptions {
  directory:string;expectedManifestSha256?:string;chunkSize?:number;
  onProgress?:(event:Record<string,unknown>)=>void;
}
export interface ReopenedFiles {
  schema:'stellar-forge.openfema-reopened.v1';state:'COMPLETE';directory:string;
  workspace:string;workspaceId:string;kind:FileKind;id:string;files:number;bytes:number;manifestSha256:string;
}
export function openOpenFemaClient(options:ConnectionOptions):Promise<OpenFemaClient>;
export function inspectOpenFemaDeliveryInput(options:{path:string;kind:DeliveryInputKind;label?:string}):Promise<DeliveryInputInspection>;
export function inspectOpenFemaFiles(options:FileOptions):Promise<{manifest:TransferManifest;manifestSha256:string}>;
export function downloadOpenFemaFiles(options:DownloadOptions):Promise<Record<string,unknown>>;
export function reopenOpenFemaFiles(options:{directory:string;expectedManifestSha256?:string}):Promise<ReopenedFiles>;
export function main(args?:string[]):Promise<unknown>;
