/** MIT. Retained analysis contracts on the original SensorThings workspace.
 * No runtime, source capture, alternate store or authentication is provided here.
 * Public numeric renderability is distinct from exact original JSON number text.
 */
import type {NativeObject,JsonValue,Sha256,WorkspaceId,WorkspaceAlias,OperationId,
  SourceReference,EditionScope,SourceIssue,SourceLicense,EditionReview} from '../mcp.mjs';

export type AnalysisProjectId = string;
export type AnalysisVersionId = Sha256;
export type AnalysisView = 'events' | 'numeric' | 'map';
export interface AnalysisPeriodInput { start: string; end: string; }
export interface AnalysisPeriod extends AnalysisPeriodInput { startUtc: string; endUtc: string; }
export interface AnalysisSelectionInput {
  /** One to twenty exact scalar Datastream keys from this retained edition. */
  streamKeys: Sha256[];
  /** Explicit offset-qualified start and exclusive end, or the retained source extent. */
  period: AnalysisPeriodInput | null;
  view: AnalysisView;
  timeBasis?: 'phenomenonTime';
  viewerId?: Sha256 | null;
}
export interface AnalysisSelection {
  streamKeys: Sha256[];
  period: AnalysisPeriod | null;
  view: AnalysisView;
  viewerId: Sha256 | null;
  timeBasis: 'phenomenonTime';
  intervalPolicy: 'source-explicit-only';
  instantPolicy: 'events-only';
  unresolvedTimePolicy: 'retain-unplaced';
}
export interface AnalysisCitation {
  editionId: Sha256;
  sha256: Sha256;
  jsonPointer: string;
  /** When supplied, verified against the original observation page and pointer. */
  occurrenceId?: Sha256;
}
export interface AnalysisAnnotationInput {
  /** Editing an annotation requires its existing ID. */
  id?: Sha256;
  kind: 'note' | 'quality' | 'interpretation';
  text: string;
  refs: AnalysisCitation[];
  status?: 'active' | 'withdrawn';
}
export interface AnalysisAnnotation extends Omit<AnalysisAnnotationInput,'id'|'status'> {
  id: Sha256;
  status: 'active' | 'withdrawn';
  actor: string;
  recordedAt: string;
}
export interface AnalysisProject {
  id: AnalysisProjectId;
  originWorkspaceId: WorkspaceId;
  createdAt: string;
  title: string;
  headVersionId: AnalysisVersionId;
}
export interface AnalysisVersion {
  schema: 'stellar-forge.sensorthings-analysis-version.v1';
  id: AnalysisVersionId;
  projectId: AnalysisProjectId;
  parentId: AnalysisVersionId | null;
  editionId: Sha256;
  title: string;
  selection: AnalysisSelection;
  annotations: AnalysisAnnotation[];
  actor: string;
  changeReason: string;
  createdAt: string;
}
export interface AnalysisVersionRecord {
  id: AnalysisVersionId;
  projectId: AnalysisProjectId;
  parentId: AnalysisVersionId | null;
  editionId: Sha256;
  sha256: Sha256;
  summarySha256: Sha256;
  createdAt: string;
  title: string;
}
export type NumericExclusionReason =
  | 'observation_type_not_declared_numeric'
  | 'not_an_original_json_number'
  | 'phenomenon_time_not_an_explicit_instant'
  | 'invalid_original_number'
  | 'count_result_not_integral'
  | 'outside_finite_browser_range'
  | 'nonzero_result_underflows_in_browser';
export type NumericEligibility =
  | {eligible:true;reason:null}
  | {eligible:false;reason:NumericExclusionReason};
export interface OriginalEntityId {
  type: 'number' | 'string';
  /** Exact source numeric lexeme or literal string ID. */
  value: string;
  /** Canonical typed identity; numeric and string IDs are different. */
  key: string;
}
export type NativeEntityCompatibility =
  | {compatible:true;clientId:string;id:OriginalEntityId}
  | {compatible:false;reason:'missing_or_invalid_original_id' |
      'numeric_id_changes_in_native_browser' | 'native_client_does_not_escape_this_string_id';
      id?:OriginalEntityId};
export interface AnalysisSourceReference extends SourceReference { capturedAt?: string | null; }
export type NativeViewerIdentity = NativeEntityCompatibility & {
  role: string; sourceRef: AnalysisSourceReference;
};
export interface NativeViewerProfile {
  metadataCompatible: boolean;
  identities: NativeViewerIdentity[];
  issues: NativeObject[];
  firstLocationPolicy: string;
}
export interface RetainedRelatedEntity {
  /** Browser-readable metadata; sourceJson preserves exact original numeric tokens. */
  entity: JsonValue;
  sourceRef: AnalysisSourceReference;
  sourceJson: string;
  id: OriginalEntityId | null;
}
export interface AnalysisStreamSummary {
  key: Sha256;
  id: OriginalEntityId;
  name: string;
  kind: 'Datastreams';
  sourceRef: AnalysisSourceReference;
  observationType: string | null;
  nativeViewer: NativeViewerProfile;
  sourceJson: string;
  unit: JsonValue;
  observedProperties: RetainedRelatedEntity[];
  locations: RetainedRelatedEntity[];
  rows: number;
  resultTypes: Record<string,number>;
  /** Literal categories; they have no numeric encoding. */
  categories: Record<string,number>;
  timeKinds: Record<string,number>;
  qualityStates: Record<string,number>;
  numericEligibleRows: number;
  numericExcludedRows: number;
  numericExclusionReasons: Partial<Record<NumericExclusionReason,number>>;
  firstUtc: string | null;
  lastUtc: string | null;
}
export interface AnalysisSummary {
  schema: 'stellar-forge.sensorthings-analysis-summary.v1';
  editionId: Sha256;
  selection: AnalysisSelection;
  sourceScope: EditionScope;
  sourceIssues: SourceIssue[];
  license: SourceLicense;
  totalOccurrences: number;
  distinctObservationKeys: number;
  duplicateObservationKeys: number;
  changedDuplicateKeys: number;
  instantEvents: number;
  explicitIntervals: number;
  unplacedOccurrences: number;
  streams: AnalysisStreamSummary[];
  meaning: Record<string,string>;
}
export interface AnalysisStreams {
  editionId: Sha256;
  streams: AnalysisStreamSummary[];
  scope: EditionScope;
  issues: SourceIssue[];
  license?: SourceLicense;
}
export type AnalysisObservationColumn =
  | 'occurrence_id' | 'observation_id' | 'observation_id_type'
  | 'stream_id' | 'stream_id_type' | 'stream_kind' | 'stream_name' | 'observation_type'
  | 'observed_property' | 'unit' | 'thing' | 'feature_of_interest'
  | 'phenomenon_time' | 'phenomenon_time_state' | 'phenomenon_time_kind'
  | 'phenomenon_start_utc' | 'phenomenon_end_utc'
  | 'result_time' | 'result_time_state' | 'result_time_utc'
  | 'valid_time' | 'valid_time_state' | 'valid_start_utc' | 'valid_end_utc'
  | 'result' | 'result_state' | 'result_type' | 'result_quality' | 'result_quality_state'
  | 'parameters' | 'parameters_state' | 'source_page_sha256' | 'source_pointer'
  | 'source_observed_at' | 'stream_source_sha256' | 'stream_source_pointer'
  | 'observation_json' | 'issues' | 'stream_key';
/** Original CSV cells remain strings, including exact JSON number lexemes. */
export type AnalysisObservationRow = Record<AnalysisObservationColumn,string> & {
  source: AnalysisSourceReference;
  numeric: NumericEligibility;
};
export interface AnalysisRows {
  editionId: Sha256;
  selection: AnalysisSelection;
  columns: AnalysisObservationColumn[];
  rows: AnalysisObservationRow[];
  total: number;
  offset: number;
  nextOffset: number | null;
}
export interface AnalysisComparisonOccurrence {
  occurrenceId: Sha256;
  semanticHash: Sha256;
  sourceRef: AnalysisSourceReference;
  streamKey: Sha256;
  result: {state:string;type:string;value:string};
  phenomenonTime: string;
  resultTime: string;
  quality: string;
  issues: JsonValue;
}
export type AnalysisDifferenceState = 'same' | 'changed' |
  'observedOnlyLeft' | 'observedOnlyRight' | 'ambiguous';
export interface AnalysisComparisonCounts {
  same:number; changed:number; observedOnlyLeft:number; observedOnlyRight:number; ambiguous:number;
}
export interface AnalysisSourceBracketRead {
  taskId:Sha256; phase:'stream-start'|'stream-end'; sha256:Sha256; bytes:number;
  requestId:Sha256; url:string; jsonPointer:''; sourceCapturedAt:string|null; connectorReceivedAt:string|null;
  nativeRequestStartedAt:string; nativeRequestCompletedAt:string; representation:string;
}
export interface AnalysisComparisonSourceContext {
  left:{editionId:Sha256;sourceId:string;serviceUrl:string;query:NativeObject;scope:EditionScope;issues:SourceIssue[]};
  right:{editionId:Sha256;sourceId:string;serviceUrl:string;query:NativeObject;scope:EditionScope;issues:SourceIssue[]};
  brackets:{streamKey:Sha256;phase:'stream-start'|'stream-end';
    state:'ambiguous_original_reads'|'unavailable_both'|'observed_only_right'|'observed_only_left'|
      'same_original_bytes'|'different_original_bytes';
    left:AnalysisSourceBracketRead[];right:AnalysisSourceBracketRead[]}[];
  meaning:string;
}
export interface AnalysisComparison {
  schema: 'stellar-forge.sensorthings-analysis-comparison.v1';
  id: Sha256;
  projectId: AnalysisProjectId;
  versionId: AnalysisVersionId;
  leftEditionId: Sha256;
  rightEditionId: Sha256;
  selection: AnalysisSelection;
  rightSelection: AnalysisSelection;
  missingStreamKeys: Sha256[];
  sourceQueryCompatible: boolean;
  sourceContext: AnalysisComparisonSourceContext;
  counts: AnalysisComparisonCounts;
  unkeyed: {left:AnalysisComparisonOccurrence[];right:AnalysisComparisonOccurrence[]};
  changes: {key:string;state:Exclude<AnalysisDifferenceState,'same'>;
    left:AnalysisComparisonOccurrence[];right:AnalysisComparisonOccurrence[]}[];
  meaning: string;
  actor: string;
  note: string;
  createdAt: string;
}
export interface AnalysisComparisonRecord {
  id: Sha256;
  projectId: AnalysisProjectId;
  versionId: AnalysisVersionId;
  leftEditionId: Sha256;
  rightEditionId: Sha256;
  sha256: Sha256;
  createdAt: string;
  counts: AnalysisComparisonCounts;
}
export interface AnalysisFile {
  name: string;
  type: string;
  bytes: number;
  sha256: Sha256;
  /** Native fixed-file descriptor; callers select a listed file, never a host path. */
  storage: {operationId:OperationId;filename:string};
}
export interface AnalysisEvidence {
  id: Sha256;
  projectId: AnalysisProjectId;
  versionId: AnalysisVersionId;
  file: AnalysisFile;
  title: string;
  actor: string;
  note: string;
  createdAt: string;
}
export interface AnalysisReceivingReceipt extends AnalysisEvidence {
  publicationId: string;
  /** Assertions in the original receipt are distinct from local byte verification. */
  meaning: string;
}
export interface AnalysisPublication extends NativeObject {
  id: string;
  projectId: AnalysisProjectId;
  versionId: AnalysisVersionId;
  files: AnalysisFile[];
}
export interface AnalysisExport extends NativeObject {
  id: OperationId;
  projectId: AnalysisProjectId;
  file: AnalysisFile;
  manifestSha256: Sha256;
}
export interface AnalysisImport extends NativeObject {
  id: OperationId;
  projectId: AnalysisProjectId;
  originalWorkspaceId: WorkspaceId;
  originalHeadVersionId: AnalysisVersionId;
  preservedLocalHeadVersionId: AnalysisVersionId | null;
  receipt: NativeObject;
  sourceReviewRequired: Sha256[];
}
export interface AnalysisViewerRecord extends NativeObject {
  id: Sha256;
  sha256: Sha256;
  upstream: NativeObject;
  archive: {bytes:number;sha256:Sha256};
  actor: string;
  createdAt: string;
}
export interface AnalysisProjectRead {
  project: AnalysisProject;
  versions: AnalysisVersionRecord[];
  comparisons: AnalysisComparisonRecord[];
  evidence: AnalysisEvidence[];
  publications: AnalysisPublication[];
  receipts: AnalysisReceivingReceipt[];
  exports: AnalysisExport[];
}
export interface AnalysisOverview {
  schema: 'stellar-forge.sensorthings-analysis-view.v1';
  workspaceId: WorkspaceId;
  revision: number;
  projects: AnalysisProject[];
  viewers: AnalysisViewerRecord[];
  exports: AnalysisExport[];
  imports: AnalysisImport[];
  sourceEditionIds: Sha256[];
  pythonSources: AnalysisPythonSource[];
  meaning: Record<string,string>;
}
export interface AnalysisInbox {
  bound: boolean;
  files: ({name:string;bytes:number;sha256:Sha256} |
    {name:string;available:false;code:string})[];
}
export interface AnalysisVersionResult {
  projectId: AnalysisProjectId;
  versionId: AnalysisVersionId;
  version: AnalysisVersion;
  summary: AnalysisSummary;
}
/** Complete original edition and existing source-export handover to Python Analysis. */
export interface AnalysisPythonSourceFile {
  /** Exact selector, such as source.json or files/<original-sha256>.json. */
  file: string;
  bytes: number;
  sha256: Sha256;
  contentType: string;
}
export interface AnalysisPythonSource extends NativeObject {
  schema: 'stellar-forge.sensorthings-python-source.v1';
  id: OperationId;
  createdAt: string;
  editionId: Sha256;
  exportId: OperationId;
  exportSha256: Sha256;
  originalWorkspaceId: WorkspaceId;
  relativeDirectory: string;
  documentId: Sha256;
  tables: Record<'observations'|'components'|'entities'|'observation_index'|'numeric_eligibility',
    {collection:string;rows:number;columns:string[]}>;
  sourceComplete: boolean;
  sourceArchive: {bytes:number;sha256:Sha256;parts:number};
  files: AnalysisPythonSourceFile[];
}
export interface AnalysisActionPayloads {
  'analysis.python.prepare': {editionId:Sha256;exportId:OperationId;actor:string};
  'analysis.create': {title:string;editionId:Sha256;selection:AnalysisSelectionInput;actor:string;note:string};
  'analysis.revise': {projectId:AnalysisProjectId;baseVersionId:AnalysisVersionId;
    title?:string;editionId?:Sha256;selection?:AnalysisSelectionInput;actor:string;reason:string};
  'analysis.annotate': {projectId:AnalysisProjectId;baseVersionId:AnalysisVersionId;
    annotation:AnalysisAnnotationInput;actor:string;reason:string};
  'analysis.compare': {projectId:AnalysisProjectId;baseVersionId:AnalysisVersionId;
    rightEditionId:Sha256;actor:string;note:string};
  'analysis.viewer.import': {filename:string;expectedSha256:Sha256;expectedBytes:number;actor:string};
  'analysis.evidence.import': {projectId:AnalysisProjectId;baseVersionId:AnalysisVersionId;
    filename:string;expectedSha256:Sha256;expectedBytes:number;title:string;actor:string;note:string};
  'analysis.publish': {projectId:AnalysisProjectId;baseVersionId:AnalysisVersionId;title:string;actor:string;
    note:string;comparisonIds:Sha256[];evidenceIds:Sha256[]};
  'analysis.receipt.import': {publicationId:string;filename:string;expectedSha256:Sha256;
    expectedBytes:number;actor:string;note:string};
  'analysis.export': {projectId:AnalysisProjectId;actor:string;note?:string};
  'analysis.import': {filename:string;expectedSha256:Sha256;expectedBytes:number;actor:string;note?:string};
}
export interface AnalysisActionResults {
  'analysis.python.prepare': AnalysisPythonSource;
  'analysis.create': AnalysisVersionResult;
  'analysis.revise': AnalysisVersionResult;
  'analysis.annotate': AnalysisVersionResult;
  'analysis.compare': AnalysisComparison;
  /** Complete original installed-viewer manifest, governed by the deployment owner. */
  'analysis.viewer.import': NativeObject;
  'analysis.evidence.import': AnalysisEvidence;
  'analysis.publish': AnalysisPublication;
  'analysis.receipt.import': AnalysisReceivingReceipt;
  'analysis.export': AnalysisExport;
  'analysis.import': AnalysisImport;
}
export interface AnalysisReadResults {
  overview:AnalysisOverview; project:AnalysisProjectRead; version:AnalysisVersion;
  summary:AnalysisSummary; rows:AnalysisRows; streams:AnalysisStreams;
  comparison:AnalysisComparison; publication:AnalysisPublication; inbox:AnalysisInbox;
  'python-source':AnalysisPythonSource;
}
export type AnalysisReadMode = keyof AnalysisReadResults;
export type AnalysisReadArguments<M extends AnalysisReadMode = AnalysisReadMode> =
  M extends AnalysisReadMode ? {workspace:WorkspaceAlias;mode:M} &
    (M extends 'overview' | 'inbox' ? {id?:never;offset?:never;limit?:never} :
     M extends 'rows' ? {id:AnalysisVersionId;offset?:number;limit?:number} :
     {id:M extends 'project' ? AnalysisProjectId : M extends 'publication' | 'python-source' ? string : Sha256;
       offset?:never;limit?:never}) : never;
