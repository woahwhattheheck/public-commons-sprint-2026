// MIT. Wire types preserve original source cells and separate native revisions.
export declare const CLOUD_TYPES_SCHEMA:'stellar-forge.cloud-delivery-types.v1';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface JsonObject { [key: string]: Json }
export type Sha256 = string;
export type Uuid = string;
export type OperationId = string;
export type EditionId = string;
export type ByteCount = string;
export type Family = 'market_trades' | 'market_candles' | 'market_quotes' | 'market_orderbooks_snapshots' |
 'market_orderbooks_updates' | 'reference_rates' | 'reference_data_markets' | 'reference_data_assets' |
 'reference_data_exchanges' | 'reference_data_pairs';
export type Transport = 'retained-s3' | 'retained-snowflake' | 'api-export' | 'local-export';
export interface NativeColumn { name:string; type:string; nullable:boolean }
export interface SourceColumn { name:string; type:string; nullable?:boolean }
/** Numbers/timestamps remain native strings; exact nested JSON is never coerced. Missing columns are absent keys. */
export interface NativeCell { type:string; value:string | boolean | null; jsonEncoding?:'exact-json';truncated?:boolean;originalBytes?:ByteCount;originalSha256?:Sha256 }
export interface NativeSample { fileId:string; row:number; values:Record<string,NativeCell> }
export interface Scope {
 [key:string]:Json|undefined;
 start?:string; end?:string; startInclusive?:boolean; endInclusive?:boolean;
 market?:string; asset?:string; metric?:string; frequency?:string; marketType?:string; partitionExchange?:string; timezone?:string;
}
export interface SourceFile {
 id:string; path:string; bytes:ByteCount; sha256:Sha256; format:'parquet'|'json'|'ndjson'|'csv'|'snowflake-json';
 role:'data'|'catalog'|'receipt'; family:Family; rowsPath?:string; origin?:JsonObject;
 columns?:SourceColumn[]; nullToken?:string; timezone?:'UTC';
}
export interface CoverageGroup { [key:string]:Json|undefined; family:Family; pages:string[]; prefix?:string }
export interface CoverageInput {
 [key:string]:Json|CoverageGroup[]|undefined;
 kind:'selected-files'|'s3-listing'|'snowflake-query'|'api-pages'; groups?:CoverageGroup[];
}
export interface InputManifest {
 schema:'stellar-forge.coinmetrics-cloud-input.v1'; label:string; transport:Transport; capturedAt:string;
 provenance:JsonObject & {description:string;entitlement:string}; scope:Scope; coverage:CoverageInput; files:SourceFile[];
}
export interface CoverageResult extends JsonObject { state:string; complete:boolean }
export interface Relation {
 id:Sha256; family:Family; name:string;role:string;format:string;columns:NativeColumn[]; files:string[]; rows:string;sample:NativeSample[];
 [key:string]:unknown;
}
export interface NativeInspection {
 schema?:string; engineVersion:string; files:JsonObject[]; relations:Relation[]; coverage:CoverageResult;
 [key:string]:unknown;
}
export interface Page<T> { items:T[]; offset:number; limit:number; total:number; nextOffset:number|null }
export interface UploadFile {
 id:string; name:string; bytes:ByteCount; sha256?:Sha256; present:boolean; url:string;
}
export interface ArchiveDescription { name:string; bytes:ByteCount; sha256?:Sha256 }
export interface EditionSummary {
 id:EditionId; label:string; transport:Transport; capturedAt:string; createdAt:string; state:string;
 manifestSha256:Sha256; files:number; bytes:ByteCount; families:Family[]; coverage:CoverageResult;
 inspection:NativeInspection|null; error:string|null; receivedFrom:JsonObject|null;
}
export interface EditionDetail extends Omit<EditionSummary,'files'> {
 files?:number; manifest:InputManifest; uploads:UploadFile[];
}
export interface PagedEdition extends Omit<EditionDetail,'manifest'|'inspection'|'uploads'> {
 manifest:Omit<InputManifest,'files'> & {files:Page<SourceFile>};
 inspection:(Omit<NativeInspection,'relations'> & {relations:Page<Relation>})|null;
 uploads:Page<UploadFile>;
}
export interface ArchiveIntake {
 id:OperationId; archive:ArchiveDescription & {id:'archive';path:'handover.zip'}; state:string;
 uploads:UploadFile[]; [key:string]:unknown;
}
export interface UploadStatus {
 editionId:string; fileId:string; state:'UPLOADING'|'COMPLETE'; bytes:ByteCount; sha256:Sha256|null;
 offset:ByteCount; prefixSha256:Sha256; requestSha256:Sha256; revision:number; reused?:boolean; maximumChunkBytes?:number;
}
export interface MappingBase { left:string; right:string }
export type RowKey = MappingBase & ({kind:'text'|'integer'|'decimal'|'boolean'|'json'} |
 {kind:'timestamp-ns';leftTimeUnit?:'iso'|'ns'|'us'|'ms'|'s';rightTimeUnit?:'iso'|'ns'|'us'|'ms'|'s'});
export type FieldMapping = (MappingBase & ({kind:'text'|'integer'|'boolean'|'json'} | {kind:'timestamp-ns';leftTimeUnit?:'iso'|'ns'|'us'|'ms'|'s';rightTimeUnit?:'iso'|'ns'|'us'|'ms'|'s'})) | (MappingBase & {
 kind:'decimal';absoluteTolerance?:string;relativeTolerance?:string;
});
export interface Omission { side:'left'|'right'; field:string; reason:string }
export interface CompareInput {
 operationId:OperationId; expectedRevision:number; leftEditionId:EditionId;rightEditionId:EditionId;
 leftRelationId:Sha256;rightRelationId:Sha256;family:Family;keys:RowKey[];fields:FieldMapping[];omissions?:Omission[];note?:string;
}
export interface ComparisonCounts {
 leftRows:number;rightRows:number;matched:number;leftOnly:number;rightOnly:number;different:number;
 duplicateLeft:number;duplicateRight:number;ambiguousLeft:number;ambiguousRight:number;invalidKeys:number;
}
export interface ReviewEntry {
 revision:number; decision:'accepted'|'changes-requested'|'reopened'; note:string; reviewedAt:string;operationId:OperationId;
}
export interface ComparisonReview {
 revision:number;decision:'unreviewed'|ReviewEntry['decision'];note:string|null;reviewedAt:string|null;history:ReviewEntry[];
}
export interface ComparisonRecord {
 id:string;state:string;createdAt:string;request:CompareInput;requestSha256:Sha256;counts:ComparisonCounts|null;
 schemaChanges:{leftOnly:Json[];rightOnly:Json[];changed:Json[]}|null;coverage:{left:CoverageResult;right:CoverageResult}|null;
 scope:JsonObject|null;findingsCount:number;reportSha256:Sha256|null;reportUrl:string;summaryUrl:string;review:ComparisonReview;error:string|null;
}
export interface ComparisonPage extends ComparisonRecord {
 findings:JsonObject[];offset:number;limit:number;total:number;nextOffset:number|null;
}
export interface AuthoringEntry { plan:JsonObject; cursor?:string|null }
export interface MerchantDraft {
 revision:number;operationId:OperationId;sourceSha256:Sha256;planSha256:Sha256;savedAt:string;
 plan:JsonObject;authoring:AuthoringEntry[];origin:JsonObject|null;
}
export interface ReceivedDraft {
 receivingId:OperationId;delivery:JsonObject;editionIds:EditionId[];originalDraft:MerchantDraft;
 originalDraftSha256:Sha256;sourceSelectionRequired:true;
}
export interface PackageRecord {
 id:OperationId;revision:number;state:string;sourceSha256:Sha256;reviewId:Sha256;createdAt:string;
 completedAt:string|null;error:string|null;summary:JsonObject|null;
}
export interface RuntimeState {
 [key:string]:Json|undefined;
 instanceId?:string;state:string;packageId?:string;packageSha256?:Sha256;url?:string;docs?:string;operations?:string;
}
export interface Selection extends JsonObject {
 editionId:EditionId;relationIds:Sha256[];sourceSha256:Sha256;sourceFile:string;materializationSha256:Sha256;selectedAt:string;tables:Json[];
}
export interface WorkspaceStatus {
 workspace:string;workspaceId:Uuid;instanceId:Uuid;browserUrl:string;
 native:{
  schema:'stellar-forge.duckdb-workspace.v1';workspaceId:Uuid;source:JsonObject;sourceError:string|null;authoringError:string|null;
  sourceChanged:boolean;draft:MerchantDraft|null;initialPlan:JsonObject|null;drafts:JsonObject[];packages:PackageRecord[];
  runtime:RuntimeState;cloud:{schema:'stellar-forge.coinmetrics-cloud-workspace.v1';revision:number;
   selection:Selection|null;contracts:JsonObject;counts:Record<'editions'|'comparisons'|'deliveries'|'receivings'|'archiveIntakes'|'events',number>};
 };artifactReads:JsonObject[];
}
export interface WorkspaceAlias {workspace:string;label:string;workspaceId:Uuid;open:boolean;opening:boolean;closing:boolean;instanceId:Uuid|null;browserUrl:string|null}
export interface WorkspaceInventory {configured:boolean;closing:boolean;workspaces:WorkspaceAlias[];[key:string]:unknown}
export interface NativeResult<T> {workspace:string;workspaceId?:Uuid;instanceId?:Uuid;result:T}
export interface NativeOperation {
 kind:string;id:string;state:string;request:JsonObject;requestSha256:Sha256;createdAt:string;updatedAt:string;error:string|null;revision:number;
}
export interface ArtifactFile {name:string;contentType:string;bytes:number;sha256:Sha256}
export interface ArtifactChunk {
 readId:Uuid;file:ArtifactFile;offset:number;bytesRead:number;nextOffset:number|null;encoding:'base64';data:string;
}
export type Artifact='source'|'comparison'|'delivery'|'package';
export interface ArtifactRequest {
 workspace:string;artifact:Artifact;id:string;file?:string;kind?:'summary'|'full';expectedSha256?:Sha256;readId?:Uuid;offset:number;limit:number;
}
export interface WorkspaceInput {workspace:string}
export interface OwnerInput extends WorkspaceInput {workspaceInstanceId:Uuid}
export interface VersionedInput extends OwnerInput {operationId:OperationId;expectedRevision:number}
export type IntakeInput=VersionedInput & ({manifest:InputManifest;archive?:never}|{archive:ArchiveDescription;manifest?:never});
export interface DraftInput extends VersionedInput {sourceSha256:Sha256;plan:JsonObject;authoring?:AuthoringEntry[]}
export interface DraftAdoptInput extends DraftInput {receivingId:OperationId;originalDraftSha256:Sha256}
export interface CloudToolArguments {
 merchant_cloud_workspaces:Record<string,never>;
 merchant_cloud_open:WorkspaceInput;
 merchant_cloud_close:OwnerInput;
 merchant_cloud_status:WorkspaceInput;
 merchant_cloud_operation:WorkspaceInput & {operationId:OperationId;kind?:'cloud'|'draft'|'package'};
 merchant_cloud_records:WorkspaceInput & {kind:'editions'|'comparisons'|'deliveries'|'receivings'|'archiveIntakes'|'events';offset?:number;limit?:number};
 merchant_cloud_edition:WorkspaceInput & {id:EditionId;offset?:number;limit?:number};
 merchant_cloud_comparison:WorkspaceInput & {id:string;offset?:number;limit?:number};
 merchant_cloud_received_draft:WorkspaceInput & {receivingId:OperationId};
 merchant_cloud_upload_status:OwnerInput & {editionId:EditionId;fileId:string};
 merchant_cloud_upload_chunk:OwnerInput & {editionId:EditionId;fileId:string;offset:ByteCount;data:string;sha256:Sha256};
 merchant_cloud_catalog:WorkspaceInput & {sourceSha256:Sha256;cursor?:string};
 merchant_cloud_author_review:WorkspaceInput & {entry:AuthoringEntry;sourceSha256:Sha256};
 merchant_cloud_author_reopen:WorkspaceInput & {entry:AuthoringEntry;sourceSha256:Sha256};
 merchant_cloud_draft:WorkspaceInput & {revision:number};
 merchant_cloud_plan_review:WorkspaceInput & {revision:number};
 merchant_cloud_preview:WorkspaceInput & {sourceSha256:Sha256;authoring?:AuthoringEntry[];query:string;input?:JsonObject};
 merchant_cloud_inspect:WorkspaceInput & {packageId:OperationId};
 merchant_cloud_runtime:WorkspaceInput;
 merchant_cloud_artifact_read:ArtifactRequest;
 merchant_cloud_artifact_release:WorkspaceInput & {readId:Uuid};
 merchant_cloud_intake:IntakeInput;
 merchant_cloud_commit:OwnerInput & {editionId:EditionId};
 merchant_cloud_compare:OwnerInput & CompareInput;
 merchant_cloud_review:VersionedInput & {comparisonId:string;expectedReviewRevision:number;decision:ReviewEntry['decision'];note:string};
 merchant_cloud_select:VersionedInput & {editionId:EditionId;relationIds:Sha256[];comparisonId?:string;note?:string};
 merchant_cloud_export:VersionedInput & {editionIds:EditionId[];comparisonIds?:string[];packageId?:OperationId;note?:string};
 merchant_cloud_receive:VersionedInput & {intakeId:string};
 merchant_cloud_draft_save:DraftInput;
 merchant_cloud_draft_adopt:DraftAdoptInput;
 merchant_cloud_prepare:OwnerInput & {operationId:OperationId;revision:number;reviewId:Sha256};
 merchant_cloud_start:OwnerInput & {packageId:OperationId;packageSha256:Sha256};
 merchant_cloud_stop:OwnerInput & {instanceId:string};
}
export interface CloudToolResults {
 merchant_cloud_workspaces:WorkspaceInventory;
 merchant_cloud_open:WorkspaceStatus;
 merchant_cloud_close:{workspace:string;workspaceId:Uuid;instanceId:Uuid;state:'CLOSED'};
 merchant_cloud_status:WorkspaceStatus;
 merchant_cloud_operation:NativeResult<NativeOperation | {kind:'draft'|'package';operationId:OperationId;state:string;record:MerchantDraft|PackageRecord}>;
 merchant_cloud_records:Page<JsonObject> & {workspace:string;revision:number;kind:string};
 merchant_cloud_edition:{workspace:string;edition:PagedEdition|ArchiveIntake};
 merchant_cloud_comparison:NativeResult<ComparisonPage>;
 merchant_cloud_received_draft:NativeResult<ReceivedDraft>;
 merchant_cloud_upload_status:NativeResult<UploadStatus>;
 merchant_cloud_upload_chunk:NativeResult<UploadStatus>;
 merchant_cloud_catalog:NativeResult<JsonObject>;
 merchant_cloud_author_review:NativeResult<JsonObject>;
 merchant_cloud_author_reopen:NativeResult<JsonObject>;
 merchant_cloud_draft:NativeResult<MerchantDraft|JsonObject>;
 merchant_cloud_plan_review:NativeResult<JsonObject>;
 merchant_cloud_preview:NativeResult<{operatorPreview:true;sourceSha256:Sha256;result:JsonObject}>;
 merchant_cloud_inspect:NativeResult<PackageRecord>;
 merchant_cloud_runtime:NativeResult<RuntimeState>;
 merchant_cloud_artifact_read:ArtifactChunk;
 merchant_cloud_artifact_release:{workspace:string;readId:Uuid;state:'RELEASED'};
 merchant_cloud_intake:NativeResult<{edition:EditionDetail|ArchiveIntake;uploads:UploadFile[];revision:number}>;
 merchant_cloud_commit:NativeResult<{edition:EditionDetail;revision:number}>;
 merchant_cloud_compare:NativeResult<{comparison:ComparisonRecord;revision:number}>;
 merchant_cloud_review:NativeResult<{comparison:ComparisonRecord;revision:number}>;
 merchant_cloud_select:NativeResult<{selection:Selection;revision:number}>;
 merchant_cloud_export:NativeResult<{delivery:JsonObject;revision:number}>;
 merchant_cloud_receive:NativeResult<{delivery:JsonObject;received:JsonObject;revision:number}>;
 merchant_cloud_draft_save:NativeResult<MerchantDraft>;
 merchant_cloud_draft_adopt:NativeResult<MerchantDraft>;
 merchant_cloud_prepare:NativeResult<PackageRecord>;
 merchant_cloud_start:NativeResult<RuntimeState>;
 merchant_cloud_stop:NativeResult<RuntimeState>;
}
export type CloudToolName=keyof CloudToolArguments;
export interface ToolOptions {signal?:AbortSignal;timeoutMs?:number}
export interface CloudClientOptions extends ToolOptions {url:string;tokenEnv?:string;environment?:Record<string,string|undefined>}
export interface ToolDeclaration {name:CloudToolName;description:string;inputSchema:JsonObject;annotations:JsonObject}
export interface TransferSelection {
 schema:'stellar-forge.cloud-artifact-transfer.v1';transferId:Sha256;provenance:'CLIENT_SELECTION_OF_ORIGINAL_CLOUD_ARTIFACT';
 source:{workspace:string;workspaceId:Uuid;artifact:Artifact;id:string;member:string|null;kind:'summary'|'full'|null;file:ArtifactFile};
 files:[{name:'payload';bytes:number;sha256:Sha256}];
}
export interface TransferResult {
 schema:'stellar-forge.cloud-artifact-download.v1';state:string;directory:string;exportId:Sha256;
 source:TransferSelection['source'];payload:'payload';manifestSha256:Sha256;files:number;bytes:number;reopened?:boolean;
}
