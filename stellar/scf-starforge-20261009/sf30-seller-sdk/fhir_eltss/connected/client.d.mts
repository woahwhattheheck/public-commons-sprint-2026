// MIT. Complete native eLTSS operation and retained-file client contracts.
export type Json=null|boolean|number|string|Json[]|{[key:string]:Json};
export interface JsonObject{[key:string]:Json}
export type UUID=string;export type SHA256=string;
export type WorkspaceAlias=string;export type OperationId=string;
/** An exact complete JSON value encoded as text; preserves numeric lexical tokens. */
export type JsonText=string;
export interface RequestOptions{requestSignal?:AbortSignal|null;timeoutMs?:number}
export interface ClientOptions{url:string;tokenEnv?:string;environment?:Record<string,string|undefined>;signal?:AbortSignal}
export interface LocalClientOptions{connection:string;exportsDirectory:string}
export interface FileIdentity{name:string;bytes:number;sha256:SHA256;contentType:string}
export interface ExportManifest{
  schema:'stellar-forge.eltss-merchant-export.v1';exportId:SHA256;workspace:string;workspaceId:UUID;instanceId:UUID;
  kind:'native-response'|'source-file'|'source-packet'|'dataset'|'dataset-packet'|'comparison-file'|'workspace-packet'|'assessment-file'|'edition-changes-file'|'handoff-packet'|'artifact-file';
  source:JsonObject;files:FileIdentity[];
}
export interface RetainedResult<T=Json>{
  schema:'stellar-forge.eltss-merchant-result.v1';state:'COMPLETED'|'REJECTED';workspace:string;workspaceId:UUID;instanceId:UUID;
  kind:ExportManifest['kind'];source:JsonObject;exportId:SHA256|null;manifestSha256:SHA256;
  manifestFile:{name:'eltss-manifest.json';bytes:number;sha256:SHA256};files:FileIdentity[];
  native:{ok:boolean;status:number;headers:Record<string,string>};
  retention:{state:'COMPLETE'}|{state:'FAILED';code:string;recovery:string};completeValue?:boolean;value?:T;preview?:Json;
}
export interface WorkspaceList{
  configured:boolean;workspaces:Array<{workspace:string;label:string;workspaceId:UUID;allowStart:boolean;selectionSha256:SHA256;
  inputs:Array<{input:string;label:string;sha256:SHA256;bytes:number}>}>;
  clients:Array<{workspace:string;workspaceId:UUID;allowStart:boolean;owned:boolean;closed:boolean}>;
  activeFileReads:number;pendingFileCloses:number;snapshotBytes:number;immutableFileBytes:number;
}
export interface OperatorOpen{state:'OPEN';workspace:string;workspaceId:UUID;instanceId:UUID;ownership:'OWNED'|'BORROWED';selectionSha256:SHA256}
export interface OperatorRelease{state:'RELEASED';workspace:string;workspaceId:UUID;ownership:'OWNED'|'BORROWED';originalOperatorClosed:boolean}
export interface FileManifest{
  state:'MANIFEST_RETAINED';workspace:string;exportId:SHA256;manifest:ExportManifest;
  manifestFile:{name:'eltss-manifest.json';bytes:number;sha256:SHA256};
}
export interface FileRangeResult{
  workspace:string;exportId:SHA256;manifestSha256:SHA256;
  file:{name:string;bytes:number;sha256:SHA256;type?:string};readId:UUID;offset:number;bytesRead:number;
  encoding:'base64';data:string;nextOffset:number|null;
}
export interface JsonPageResult{
  workspace:string;exportId:SHA256;manifestSha256:SHA256;file:string;pointer:string;type:string;offset:number;total:number;
  value?:Json;nextOffset:number|null;valueAvailableInOriginalFile?:boolean;message?:string;
}

export interface NativeSourceReference{sourceId:SHA256;recordId:SHA256;pointer?:string}
/** Native pages are bounded by bytes as well as count. Always follow nextOffset. */
export interface NativeCursorPage<T=Json>{rows:T[];offset:number;nextOffset:number|null}
export interface NativePage<T=Json>{rows:T[];total:number;offset:number;nextOffset:number|null;pageBytes:number;pageByteBudget:number;
 sourceId?:SHA256;graphId?:SHA256;assessmentId?:SHA256;comparisonId?:SHA256;file?:NativeFileDescriptor}
export interface NativeFileDescriptor{sha256:SHA256;bytes:number;role?:string;[key:string]:unknown}
export interface NativeRecord{id:SHA256;[key:string]:unknown}
export interface NativeResourceRecord{
 recordId:SHA256;sourceId:SHA256;resourceType:string;id:string|null;resourceSha256:SHA256;entryPointer:string;
 memberId?:SHA256;fileId?:SHA256;fullUrl?:string|null;versionId?:string|null;jsonText?:JsonText;contentOmitted?:string;[key:string]:unknown
}
export interface NativeGraph extends NativeRecord{
 sourceId:SHA256;policy:NativeGraphPolicy;carePlans:NativeResourceRecord[];summary:{resources:number;edges:number;carePlans:number;[status:string]:number}
}
export interface NativeGraphPolicy{referencePolicy?:'bundle'|'selected-base';baseUrl?:string;decisionIds?:SHA256[]}
export interface NativeReferenceEdge{
 id:SHA256;fromRecordId:SHA256;targetRecordIds:SHA256[];kind:string;status:string;[key:string]:unknown
}
export interface NativeFieldCell{
 carePlanId:SHA256;fieldKey:string;label:string;group:string;
 status:'present'|'absent'|'unresolved'|'not_applicable'|'review_pending';
 values?:Array<{jsonText:JsonText;originalJsonText?:JsonText;[key:string]:unknown}>;
 unresolved?:Json[];findings?:Json[];contentOmitted?:string;valuesCount?:number;[key:string]:unknown
}
export interface NativeAssessment extends NativeRecord{
 editionId:SHA256;reviewSetId:SHA256;profileId:string;carePlanIds:SHA256[];cellsFile:NativeFileDescriptor;
 summary:JsonObject;requestSha256:SHA256;
}
export interface NativeState{
 schema:'stellar-forge.eltss-workspace.v1';workspaceId:UUID;sources:NativeRecord[];plans:NativeRecord[];builds:NativeRecord[];
 connections:NativeRecord[];discoveries:NativeRecord[];requests:NativeRecord[];
 operations:Array<{operationId:OperationId;requestId:SHA256;state:string;[key:string]:unknown}>;
 graphs?:NativeRecord[];editions:NativeRecord[];reviewSets:NativeRecord[];assessments:NativeRecord[];decisions:NativeRecord[];
 editionComparisons:NativeRecord[];corrections:NativeRecord[];handoffs:NativeRecord[];artifacts:NativeRecord[];receivings:NativeRecord[];
 receives:Array<{id:SHA256;archiveSha256:SHA256;workspaceId:UUID;state:string;[key:string]:unknown}>;[key:string]:unknown
}
export interface NativeMappingColumn{
 name:string;source?:'resource'|'record';path?:string[];mode?:'single'|'first'|'last'|'array'|'join';
 encoding?:'plain'|'json';type?:'string'|'integer'|'number'|'boolean';nullable?:boolean;
 missing?:'error'|'empty'|'default';default?:string;separator?:string;
}
export interface NativeMapping{
 schema:'stellar-forge.eltss-mapping.v1';name:string;resourceType:string;columns:NativeMappingColumn[];
 filters?:string[];ranges?:string[];sorts?:string[];keys?:string[];defaultLimit?:number;maxLimit?:number;
 maxBytes?:number;maxRows?:number;maxCellChars?:number;allowEmpty?:boolean
}
export type NativeConnectionInput={"label":string;"baseUrl":string;"authProfile"?:string|null;"origin":"published_sample"|"operator_source";"publisher"?:string;"sourceUrl"?:string;"note"?:string};
export type NativeRequestInput={"connectionId":SHA256;"discoveryId"?:SHA256|null;"label":string;"route":"bundle-url"|"all-eltss-careplan"|"rest-graph";"url"?:string|null;"carePlanIds"?:string[];"searches"?:Array<{"resourceType"?:string;"parameters"?:Array<{"name"?:string;"value"?:string}>}>;"followReferences"?:boolean;"resourceTypes"?:string[];"limits"?:{"maxBytes"?:number;"maxResources"?:number;"maxCarePlans"?:number;"maxPages"?:number;"maxDepth"?:number};"note"?:string};
export type NativeEditionInput={"label":string;"sourceId":SHA256;"predecessorId"?:SHA256|null;"carePlanIds":SHA256[];"referencePolicy"?:"bundle"|"selected-base";"baseUrl"?:string;"decisionIds"?:SHA256[];"owner"?:string;"actor":string;"note"?:string};
export type NativeReviewSetInput={"label":string;"profileId":string;"predecessorId"?:SHA256|null;"fields":NativeFieldReview[];"actor":string;"note"?:string};
export type NativeFieldReview={"fieldKey":string;"status":"draft"|"reviewed"|"needs_input";"applicability":"applicable"|"not_applicable"|"undetermined";"absencePolicy":"retain_absence"|"needs_input"|"required";"selectors":NativeSelector[];"targetProfile"?:string;"targetPath"?:string;"terminologyVersion"?:string;"multiplicity"?:"retain_all"|"single";"conversion"?:{"kind"?:"identity"|"string"|"value-map";"entries"?:Array<{"fromJson"?:JsonText;"toJson"?:JsonText}>};"owner"?:string;"reviewer"?:string;"reviewedAt"?:string|null;"note"?:string};
export type NativeSelector={"label":string;"steps":Array<{"direction"?:"value"|"out"|"in";"path"?:string[];"resourceType"?:string|null;"where"?:Array<{"path"?:string[];"operator"?:"equals"|"one-of"|"exists";"valueJson"?:JsonText}>}>};
export type NativeAssessmentInput={"editionId":SHA256;"reviewSetId":SHA256;"label":string;"carePlanIds"?:SHA256[]};
export type NativeDecisionInput={"kind":"identity"|"reference"|"field"|"source"|"receiving"|"careplan";"outcome":"accepted"|"needs_input"|"rejected"|"related"|"replacement"|"resolved";"editionIds"?:SHA256[];"sourceRefs"?:NativeSourceReference[];"fieldKeys"?:string[];"edgeId"?:string|null;"selectedRecordId"?:SHA256|null;"assessmentId"?:SHA256|null;"supersedesId"?:SHA256|null;"owner"?:string;"actor":string;"reason":string};
export type NativeCorrectionInput={"editionId":SHA256;"label":string;"patches":Array<{"recordId"?:SHA256;"path"?:string[];"action"?:"add"|"replace"|"remove";"valueJson"?:JsonText|null}>;"actor":string;"reason":string};
export type NativeHandoffInput={"editionId":SHA256;"reviewSetId":SHA256;"assessmentId":SHA256;"label":string;"scope":"forward"|"connected"|"edition";"receiver"?:string;"decisionIds"?:SHA256[];"actor":string;"reason":string};
export type NativeReceivingInput={"handoffId":SHA256;"operationId":OperationId;"receiver":string;"destinationObjectId"?:string;"state":"received"|"partial"|"rejected"|"waiting"|"corrected"|"review_needed";"receivedAt"?:string|null;"artifactId"?:SHA256|null;"correctionOf"?:SHA256|null;"sourceRefs"?:NativeSourceReference[];"owner"?:string;"actor":string;"note"?:string};

export interface NativeProfileAdoption{profileId:string;label:string;actor:string;note?:string;predecessorId?:SHA256|null}
export interface NativeEditionComparisonInput{beforeId:SHA256;afterId:SHA256;label?:string}
export interface NativeCorrectionApply{previewId:SHA256;expectedRequestSha256:SHA256}
export interface NativeProfile{schema:'stellar-forge.eltss-field-profile.v1';id:string;fields:Array<{
 key:string;label?:string;defaultReview:NativeFieldReview;[key:string]:unknown}>;[key:string]:unknown}
export interface EltssActionArguments{
  workspaces:{};
  schema:{};
  operator_open:{workspace:WorkspaceAlias};
  operator_release:{workspace:WorkspaceAlias};
  operator:{workspace:WorkspaceAlias};
  state:{workspace:WorkspaceAlias};
  catalogue:{workspace:WorkspaceAlias};
  auth_profiles:{workspace:WorkspaceAlias};
  connection:{workspace:WorkspaceAlias;connectionId:SHA256};
  connection_save:{workspace:WorkspaceAlias;connection:NativeConnectionInput};
  discover:{workspace:WorkspaceAlias;connectionId:SHA256};
  discovery:{workspace:WorkspaceAlias;discoveryId:SHA256};
  request:{workspace:WorkspaceAlias;requestId:SHA256};
  request_save:{workspace:WorkspaceAlias;request:NativeRequestInput};
  request_advance:{workspace:WorkspaceAlias;requestId:SHA256;operationId:OperationId};
  operation:{workspace:WorkspaceAlias;operationId:OperationId};
  operation_pause:{workspace:WorkspaceAlias;operationId:OperationId};
  operation_resume:{workspace:WorkspaceAlias;operationId:OperationId};
  source:{workspace:WorkspaceAlias;sourceId:SHA256};
  source_members:{workspace:WorkspaceAlias;sourceId:SHA256};
  source_rows:{workspace:WorkspaceAlias;sourceId:SHA256;resourceType?:string;offset?:number;limit?:number;query?:string};
  source_row:{workspace:WorkspaceAlias;sourceId:SHA256;recordId:SHA256};
  source_file:{workspace:WorkspaceAlias;sourceId:SHA256;member:string};
  source_packet:{workspace:WorkspaceAlias;sourceId:SHA256};
  source_import:{workspace:WorkspaceAlias;input:WorkspaceAlias;expectedSha256?:SHA256;label?:string};
  graph_create:{workspace:WorkspaceAlias;sourceId:SHA256;policy:NativeGraphPolicy};
  graph:{workspace:WorkspaceAlias;graphId:SHA256};
  graph_nodes:{workspace:WorkspaceAlias;graphId:SHA256;resourceType?:string;offset?:number;limit?:number;query?:string};
  graph_edges:{workspace:WorkspaceAlias;graphId:SHA256;status?:string;offset?:number;limit?:number;query?:string};
  graph_node:{workspace:WorkspaceAlias;graphId:SHA256;recordId:SHA256};
  profile:{workspace:WorkspaceAlias;profileId:string};
  edition:{workspace:WorkspaceAlias;editionId:SHA256};
  edition_save:{workspace:WorkspaceAlias;edition:NativeEditionInput};
  review_profile:{workspace:WorkspaceAlias;profile:NativeProfileAdoption};
  review_save:{workspace:WorkspaceAlias;review:NativeReviewSetInput};
  review_set:{workspace:WorkspaceAlias;reviewSetId:SHA256};
  assessment_create:{workspace:WorkspaceAlias;assessment:NativeAssessmentInput};
  assessment:{workspace:WorkspaceAlias;assessmentId:SHA256};
  assessment_cells:{workspace:WorkspaceAlias;assessmentId:SHA256;carePlanId?:SHA256;fieldKey?:string;status?:"present"|"absent"|"unresolved"|"not_applicable"|"review_pending";offset?:number;limit?:number};
  assessment_file:{workspace:WorkspaceAlias;assessmentId:SHA256};
  decision:{workspace:WorkspaceAlias;decisionId:SHA256};
  decision_save:{workspace:WorkspaceAlias;decision:NativeDecisionInput};
  edition_comparison_create:{workspace:WorkspaceAlias;comparison:NativeEditionComparisonInput};
  edition_comparison:{workspace:WorkspaceAlias;comparisonId:SHA256};
  edition_changes:{workspace:WorkspaceAlias;comparisonId:SHA256;offset?:number;limit?:number};
  edition_changes_file:{workspace:WorkspaceAlias;comparisonId:SHA256};
  correction_preview:{workspace:WorkspaceAlias;correction:NativeCorrectionInput};
  correction_apply:{workspace:WorkspaceAlias;apply:NativeCorrectionApply};
  handoff_prepare:{workspace:WorkspaceAlias;handoff:NativeHandoffInput};
  handoff:{workspace:WorkspaceAlias;handoffId:SHA256};
  handoff_packet:{workspace:WorkspaceAlias;handoffId:SHA256};
  handoff_import:{workspace:WorkspaceAlias;input:WorkspaceAlias;expectedSha256?:SHA256};
  artifact_import:{workspace:WorkspaceAlias;input:WorkspaceAlias;expectedSha256?:SHA256;label?:string;contentType?:string};
  artifact_file:{workspace:WorkspaceAlias;artifactId:SHA256};
  receiving:{workspace:WorkspaceAlias;receivingId:SHA256};
  receiving_save:{workspace:WorkspaceAlias;receiving:NativeReceivingInput};
  mapping_default:{workspace:WorkspaceAlias;sourceId:SHA256;resourceType:string;name?:string};
  mapping_preview:{workspace:WorkspaceAlias;sourceId:SHA256;plan:NativeMapping;limit?:number};
  plan:{workspace:WorkspaceAlias;planId:SHA256};
  plan_save:{workspace:WorkspaceAlias;plan:NativeMapping};
  build:{workspace:WorkspaceAlias;buildId:SHA256};
  build_create:{workspace:WorkspaceAlias;sourceId:SHA256;planId:SHA256};
  build_query:{workspace:WorkspaceAlias;buildId:SHA256;query?:Record<string,string>};
  build_dataset:{workspace:WorkspaceAlias;buildId:SHA256};
  build_packet:{workspace:WorkspaceAlias;buildId:SHA256};
  comparison_create:{workspace:WorkspaceAlias;beforeId:SHA256;afterId:SHA256};
  comparison_changes:{workspace:WorkspaceAlias;comparisonId:SHA256;offset?:number;limit?:number};
  comparison_file:{workspace:WorkspaceAlias;comparisonId:SHA256};
  workspace_packet:{workspace:WorkspaceAlias};
  workspace_import:{workspace:WorkspaceAlias;input:WorkspaceAlias;expectedSha256?:SHA256};
  packet_import:{workspace:WorkspaceAlias;input:WorkspaceAlias;expectedSha256?:SHA256};
  input_apply:{workspace:WorkspaceAlias;input:WorkspaceAlias;expectedSha256?:SHA256;action:"connection_save"|"request_save"|"edition_save"|"review_profile"|"review_save"|"assessment_create"|"decision_save"|"edition_comparison_create"|"correction_preview"|"correction_apply"|"handoff_prepare"|"receiving_save"|"plan_save"};
  receive_export:{workspace:WorkspaceAlias;sourceWorkspace:WorkspaceAlias;exportId:SHA256;expectedManifestSha256:SHA256;kind:"source"|"packet"|"handoff"|"artifact"|"workspace";label?:string};
  manifest:{workspace:WorkspaceAlias;exportId:SHA256};
  file:{workspace:WorkspaceAlias;exportId:SHA256;file:string;expectedManifestSha256:SHA256;expectedSha256:SHA256;offset?:number;limit?:number;readId?:string};
  file_release:{workspace:WorkspaceAlias;exportId:SHA256;readId:string};
  json:{workspace:WorkspaceAlias;exportId:SHA256;expectedManifestSha256:SHA256;file:string;pointer?:string;offset?:number;limit?:number};
}
export interface EltssActionResults{
  workspaces:WorkspaceList;
  schema:JsonObject;
  operator_open:OperatorOpen;
  operator_release:OperatorRelease;
  operator:RetainedResult;
  state:RetainedResult<NativeState>;
  catalogue:RetainedResult;
  auth_profiles:RetainedResult;
  connection:RetainedResult;
  connection_save:RetainedResult;
  discover:RetainedResult;
  discovery:RetainedResult;
  request:RetainedResult;
  request_save:RetainedResult;
  request_advance:RetainedResult;
  operation:RetainedResult;
  operation_pause:RetainedResult;
  operation_resume:RetainedResult;
  source:RetainedResult;
  source_members:RetainedResult<Array<{name:string;bytes:number;sha256?:SHA256;[key:string]:unknown}>>;
  source_rows:RetainedResult<NativePage<NativeResourceRecord>>;
  source_row:RetainedResult<NativeResourceRecord>;
  source_file:RetainedResult;
  source_packet:RetainedResult;
  source_import:RetainedResult;
  graph_create:RetainedResult<NativeGraph>;
  graph:RetainedResult<NativeGraph>;
  graph_nodes:RetainedResult<NativePage<NativeResourceRecord>>;
  graph_edges:RetainedResult<NativePage<NativeReferenceEdge>>;
  graph_node:RetainedResult<{resource:NativeResourceRecord;outgoing:NativeReferenceEdge[];incoming:NativeReferenceEdge[]}>;
  profile:RetainedResult<NativeProfile>;
  edition:RetainedResult;
  edition_save:RetainedResult;
  review_profile:RetainedResult<NativeReviewSetInput&NativeRecord>;
  review_save:RetainedResult<NativeReviewSetInput&NativeRecord>;
  review_set:RetainedResult<NativeReviewSetInput&NativeRecord>;
  assessment_create:RetainedResult<NativeAssessment>;
  assessment:RetainedResult<NativeAssessment>;
  assessment_cells:RetainedResult<NativePage<NativeFieldCell>>;
  assessment_file:RetainedResult;
  decision:RetainedResult;
  decision_save:RetainedResult;
  edition_comparison_create:RetainedResult;
  edition_comparison:RetainedResult;
  edition_changes:RetainedResult;
  edition_changes_file:RetainedResult;
  correction_preview:RetainedResult;
  correction_apply:RetainedResult;
  handoff_prepare:RetainedResult;
  handoff:RetainedResult;
  handoff_packet:RetainedResult;
  handoff_import:RetainedResult;
  artifact_import:RetainedResult;
  artifact_file:RetainedResult;
  receiving:RetainedResult;
  receiving_save:RetainedResult;
  mapping_default:RetainedResult<NativeMapping>;
  mapping_preview:RetainedResult;
  plan:RetainedResult<{id:SHA256;plan:NativeMapping}>;
  plan_save:RetainedResult;
  build:RetainedResult;
  build_create:RetainedResult;
  build_query:RetainedResult;
  build_dataset:RetainedResult;
  build_packet:RetainedResult;
  comparison_create:RetainedResult;
  comparison_changes:RetainedResult<NativeCursorPage>;
  comparison_file:RetainedResult;
  workspace_packet:RetainedResult;
  workspace_import:RetainedResult;
  packet_import:RetainedResult;
  input_apply:RetainedResult;
  receive_export:RetainedResult;
  manifest:FileManifest;
  file:FileRangeResult;
  file_release:{state:'RELEASED';workspace:string;exportId:SHA256;readId:UUID};
  json:JsonPageResult;
}
export type EltssAction=keyof EltssActionArguments;
export interface EltssClient{
  readonly endpoint:string;
  call<A extends EltssAction>(action:A|`merchant_eltss_${A}`,args:EltssActionArguments[A],options?:RequestOptions):Promise<EltssActionResults[A]>;
  close():Promise<void>;
  readValue<T=Json>(options:ReadValueOptions):Promise<T>;
  workspaces(args?:EltssActionArguments['workspaces'],options?:RequestOptions):Promise<EltssActionResults['workspaces']>;
  schema(args?:EltssActionArguments['schema'],options?:RequestOptions):Promise<EltssActionResults['schema']>;
  operatorOpen(args:EltssActionArguments['operator_open'],options?:RequestOptions):Promise<EltssActionResults['operator_open']>;
  operatorRelease(args:EltssActionArguments['operator_release'],options?:RequestOptions):Promise<EltssActionResults['operator_release']>;
  operator(args:EltssActionArguments['operator'],options?:RequestOptions):Promise<EltssActionResults['operator']>;
  state(args:EltssActionArguments['state'],options?:RequestOptions):Promise<EltssActionResults['state']>;
  catalogue(args:EltssActionArguments['catalogue'],options?:RequestOptions):Promise<EltssActionResults['catalogue']>;
  authProfiles(args:EltssActionArguments['auth_profiles'],options?:RequestOptions):Promise<EltssActionResults['auth_profiles']>;
  connection(args:EltssActionArguments['connection'],options?:RequestOptions):Promise<EltssActionResults['connection']>;
  connectionSave(args:EltssActionArguments['connection_save'],options?:RequestOptions):Promise<EltssActionResults['connection_save']>;
  discover(args:EltssActionArguments['discover'],options?:RequestOptions):Promise<EltssActionResults['discover']>;
  discovery(args:EltssActionArguments['discovery'],options?:RequestOptions):Promise<EltssActionResults['discovery']>;
  request(args:EltssActionArguments['request'],options?:RequestOptions):Promise<EltssActionResults['request']>;
  requestSave(args:EltssActionArguments['request_save'],options?:RequestOptions):Promise<EltssActionResults['request_save']>;
  requestAdvance(args:EltssActionArguments['request_advance'],options?:RequestOptions):Promise<EltssActionResults['request_advance']>;
  operation(args:EltssActionArguments['operation'],options?:RequestOptions):Promise<EltssActionResults['operation']>;
  operationPause(args:EltssActionArguments['operation_pause'],options?:RequestOptions):Promise<EltssActionResults['operation_pause']>;
  operationResume(args:EltssActionArguments['operation_resume'],options?:RequestOptions):Promise<EltssActionResults['operation_resume']>;
  source(args:EltssActionArguments['source'],options?:RequestOptions):Promise<EltssActionResults['source']>;
  sourceMembers(args:EltssActionArguments['source_members'],options?:RequestOptions):Promise<EltssActionResults['source_members']>;
  sourceRows(args:EltssActionArguments['source_rows'],options?:RequestOptions):Promise<EltssActionResults['source_rows']>;
  sourceRow(args:EltssActionArguments['source_row'],options?:RequestOptions):Promise<EltssActionResults['source_row']>;
  sourceFile(args:EltssActionArguments['source_file'],options?:RequestOptions):Promise<EltssActionResults['source_file']>;
  sourcePacket(args:EltssActionArguments['source_packet'],options?:RequestOptions):Promise<EltssActionResults['source_packet']>;
  sourceImport(args:EltssActionArguments['source_import'],options?:RequestOptions):Promise<EltssActionResults['source_import']>;
  graphCreate(args:EltssActionArguments['graph_create'],options?:RequestOptions):Promise<EltssActionResults['graph_create']>;
  graph(args:EltssActionArguments['graph'],options?:RequestOptions):Promise<EltssActionResults['graph']>;
  graphNodes(args:EltssActionArguments['graph_nodes'],options?:RequestOptions):Promise<EltssActionResults['graph_nodes']>;
  graphEdges(args:EltssActionArguments['graph_edges'],options?:RequestOptions):Promise<EltssActionResults['graph_edges']>;
  graphNode(args:EltssActionArguments['graph_node'],options?:RequestOptions):Promise<EltssActionResults['graph_node']>;
  profile(args:EltssActionArguments['profile'],options?:RequestOptions):Promise<EltssActionResults['profile']>;
  edition(args:EltssActionArguments['edition'],options?:RequestOptions):Promise<EltssActionResults['edition']>;
  editionSave(args:EltssActionArguments['edition_save'],options?:RequestOptions):Promise<EltssActionResults['edition_save']>;
  reviewProfile(args:EltssActionArguments['review_profile'],options?:RequestOptions):Promise<EltssActionResults['review_profile']>;
  reviewSave(args:EltssActionArguments['review_save'],options?:RequestOptions):Promise<EltssActionResults['review_save']>;
  reviewSet(args:EltssActionArguments['review_set'],options?:RequestOptions):Promise<EltssActionResults['review_set']>;
  assessmentCreate(args:EltssActionArguments['assessment_create'],options?:RequestOptions):Promise<EltssActionResults['assessment_create']>;
  assessment(args:EltssActionArguments['assessment'],options?:RequestOptions):Promise<EltssActionResults['assessment']>;
  assessmentCells(args:EltssActionArguments['assessment_cells'],options?:RequestOptions):Promise<EltssActionResults['assessment_cells']>;
  assessmentFile(args:EltssActionArguments['assessment_file'],options?:RequestOptions):Promise<EltssActionResults['assessment_file']>;
  decision(args:EltssActionArguments['decision'],options?:RequestOptions):Promise<EltssActionResults['decision']>;
  decisionSave(args:EltssActionArguments['decision_save'],options?:RequestOptions):Promise<EltssActionResults['decision_save']>;
  editionComparisonCreate(args:EltssActionArguments['edition_comparison_create'],options?:RequestOptions):Promise<EltssActionResults['edition_comparison_create']>;
  editionComparison(args:EltssActionArguments['edition_comparison'],options?:RequestOptions):Promise<EltssActionResults['edition_comparison']>;
  editionChanges(args:EltssActionArguments['edition_changes'],options?:RequestOptions):Promise<EltssActionResults['edition_changes']>;
  editionChangesFile(args:EltssActionArguments['edition_changes_file'],options?:RequestOptions):Promise<EltssActionResults['edition_changes_file']>;
  correctionPreview(args:EltssActionArguments['correction_preview'],options?:RequestOptions):Promise<EltssActionResults['correction_preview']>;
  correctionApply(args:EltssActionArguments['correction_apply'],options?:RequestOptions):Promise<EltssActionResults['correction_apply']>;
  handoffPrepare(args:EltssActionArguments['handoff_prepare'],options?:RequestOptions):Promise<EltssActionResults['handoff_prepare']>;
  handoff(args:EltssActionArguments['handoff'],options?:RequestOptions):Promise<EltssActionResults['handoff']>;
  handoffPacket(args:EltssActionArguments['handoff_packet'],options?:RequestOptions):Promise<EltssActionResults['handoff_packet']>;
  handoffImport(args:EltssActionArguments['handoff_import'],options?:RequestOptions):Promise<EltssActionResults['handoff_import']>;
  artifactImport(args:EltssActionArguments['artifact_import'],options?:RequestOptions):Promise<EltssActionResults['artifact_import']>;
  artifactFile(args:EltssActionArguments['artifact_file'],options?:RequestOptions):Promise<EltssActionResults['artifact_file']>;
  receiving(args:EltssActionArguments['receiving'],options?:RequestOptions):Promise<EltssActionResults['receiving']>;
  receivingSave(args:EltssActionArguments['receiving_save'],options?:RequestOptions):Promise<EltssActionResults['receiving_save']>;
  mappingDefault(args:EltssActionArguments['mapping_default'],options?:RequestOptions):Promise<EltssActionResults['mapping_default']>;
  mappingPreview(args:EltssActionArguments['mapping_preview'],options?:RequestOptions):Promise<EltssActionResults['mapping_preview']>;
  plan(args:EltssActionArguments['plan'],options?:RequestOptions):Promise<EltssActionResults['plan']>;
  planSave(args:EltssActionArguments['plan_save'],options?:RequestOptions):Promise<EltssActionResults['plan_save']>;
  build(args:EltssActionArguments['build'],options?:RequestOptions):Promise<EltssActionResults['build']>;
  buildCreate(args:EltssActionArguments['build_create'],options?:RequestOptions):Promise<EltssActionResults['build_create']>;
  buildQuery(args:EltssActionArguments['build_query'],options?:RequestOptions):Promise<EltssActionResults['build_query']>;
  buildDataset(args:EltssActionArguments['build_dataset'],options?:RequestOptions):Promise<EltssActionResults['build_dataset']>;
  buildPacket(args:EltssActionArguments['build_packet'],options?:RequestOptions):Promise<EltssActionResults['build_packet']>;
  comparisonCreate(args:EltssActionArguments['comparison_create'],options?:RequestOptions):Promise<EltssActionResults['comparison_create']>;
  comparisonChanges(args:EltssActionArguments['comparison_changes'],options?:RequestOptions):Promise<EltssActionResults['comparison_changes']>;
  comparisonFile(args:EltssActionArguments['comparison_file'],options?:RequestOptions):Promise<EltssActionResults['comparison_file']>;
  workspacePacket(args:EltssActionArguments['workspace_packet'],options?:RequestOptions):Promise<EltssActionResults['workspace_packet']>;
  workspaceImport(args:EltssActionArguments['workspace_import'],options?:RequestOptions):Promise<EltssActionResults['workspace_import']>;
  packetImport(args:EltssActionArguments['packet_import'],options?:RequestOptions):Promise<EltssActionResults['packet_import']>;
  inputApply(args:EltssActionArguments['input_apply'],options?:RequestOptions):Promise<EltssActionResults['input_apply']>;
  receiveExport(args:EltssActionArguments['receive_export'],options?:RequestOptions):Promise<EltssActionResults['receive_export']>;
  manifest(args:EltssActionArguments['manifest'],options?:RequestOptions):Promise<EltssActionResults['manifest']>;
  file(args:EltssActionArguments['file'],options?:RequestOptions):Promise<EltssActionResults['file']>;
  fileRelease(args:EltssActionArguments['file_release'],options?:RequestOptions):Promise<EltssActionResults['file_release']>;
  json(args:EltssActionArguments['json'],options?:RequestOptions):Promise<EltssActionResults['json']>;
}
export interface DownloadSelection{workspace:string;exportId:SHA256;client?:EltssClient;url?:string;tokenEnv?:string;environment?:Record<string,string|undefined>;signal?:AbortSignal}
export interface DownloadOptions extends DownloadSelection{
  directory:string;expectedManifestSha256?:SHA256;chunkSize?:number;onProgress?:(progress:JsonObject)=>void|Promise<void>;
}
export interface DownloadReceipt{
  schema:'stellar-forge.eltss-file-receipt.v1';state:'COMPLETE'|'REOPENED';workspace:string;workspaceId:UUID;
  exportId:SHA256;manifestSha256:SHA256;directory:string;files:number;bytes:number;kind:ExportManifest['kind'];source:JsonObject;
  resumed?:boolean;resumedBytes?:number;
}
export interface ReadValueOptions{
  workspace?:string;result?:RetainedResult;exportId?:SHA256;file?:string;expectedManifestSha256?:SHA256;
  client?:EltssClient;url?:string;tokenEnv?:string;environment?:Record<string,string|undefined>;signal?:AbortSignal;
}
export function openEltssMerchantClient(options:ClientOptions):Promise<EltssClient>;
export function openEltssLocalClient(options:LocalClientOptions):Promise<EltssClient>;
export function downloadEltssExport(options:DownloadOptions):Promise<DownloadReceipt>;
export function inspectEltssExport(options:DownloadSelection):Promise<{manifest:ExportManifest;manifestSha256:SHA256}>;
export function reopenEltssExport(options:{directory:string;workspace:string;exportId:SHA256;expectedManifestSha256?:SHA256}):Promise<DownloadReceipt>;
export function readEltssValue<T=Json>(options:ReadValueOptions):Promise<T>;
export const eltssActions:Readonly<Record<EltssAction,{name:string;description:string;inputSchema:JsonObject;annotations:JsonObject}>>;
