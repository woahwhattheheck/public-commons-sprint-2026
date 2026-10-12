// MIT. Metadata for the original Study source, review, property and delivery APIs.
export const STUDY_AGENT_SCHEMA = 'stellar-forge.study-agent.v1';
export const STUDY_CONNECTION_SCHEMA = 'stellar-forge.study-workspace-connection.v1';
export const STUDY_CHUNK_BYTES = 65536;
export const STUDY_MAX_PACKET_BYTES = 512 * 1024 * 1024;
const S = (maxLength = 2000) => ({type:'string', maxLength});
const text = (maxLength = 2000) => ({...S(maxLength), minLength:1});
const object = {type:'object', additionalProperties:true};
const alias = {type:'string', pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const id = {type:'string', pattern:'^[a-f0-9]{64}$'};
const n = (maximum = 1000000, minimum = 0) => ({type:'integer', minimum, maximum});
const ids = {type:'array', items:id, minItems:1, maxItems:10000};
const keys = {type:'array', items:text(2000), minItems:1, maxItems:100000};
const ws = {workspace:alias};
const page = {offset:n(), limit:n(500,1)};
const nativePage = {offset:n(), limit:n(200,1)};
const input = {type:'object', additionalProperties:false,
  properties:{hostInput:alias, snapshotId:text(64), transferId:text(80), sourceWorkspace:alias},
  oneOf:[{required:['hostInput']},{required:['snapshotId']},{required:['transferId']}]};
const selected = {input, expectedSha256:id};
const inputValue = {value:object, input, expectedSha256:id};
const actor = {operator:text(200), note:S(16000)};
const review = {expected_version:n(), keys, action:{enum:['accept','exclude']}, ...actor};
const docs = {type:'object', additionalProperties:id, maxProperties:1000};
const jsonInputs = {packet:object, input, expectedSha256:id};

const definitions = {};
function native(operation, fields, required, readOnly = false) {
  definitions[operation] = Object.freeze({fields:Object.freeze(fields), required:Object.freeze(required), readOnly});
}
native('status', [], [], true);
native('catalog', ['source_ids','search','offset','limit'], [], true);
native('source.rows', ['source_id','geography','measure','offset','limit'], ['source_id'], true);
native('source.import', ['provider','source','node'], ['provider','source']);
native('source.receive_files', ['provider','checkout','session','node','timeout','expected_capture_id'], ['provider','checkout','session']);
native('source.receive_rows', ['source_id','projection','checkout','session','node','timeout'], ['source_id','projection','checkout','session']);
native('source.receive_scan', ['scan_file','provider','source_id','projection','node','expected_capture_id'], ['scan_file']);
native('mapping.template', ['name'], [], true);
native('mapping.fields', [], [], true);
native('portfolio.freeze', ['value'], ['value']);
native('mapping.freeze', ['value'], ['value']);
native('edition.freeze', ['source_ids','portfolio_id','mapping_id','label'], ['source_ids','portfolio_id','mapping_id','label']);
native('comparison.create', ['candidate_id','baseline_id','mode','note','unchanged'], ['candidate_id']);
native('comparison.read', ['comparison_id','kind','offset','limit'], ['comparison_id'], true);
native('review.keys', ['comparison_id','kind'], ['comparison_id'], true);
native('review.apply', ['comparison_id','keys','action','operator','note','expected_version'],
  ['comparison_id','keys','action','operator','note','expected_version']);
native('observation.read', ['edition_id','row_id'], ['edition_id','row_id'], true);
native('export.create', ['comparison_id','expected_version','operator','label'], ['comparison_id','expected_version','operator','label']);
native('export.verify', ['directory'], ['directory'], true);
native('export.archive', ['export_id'], ['export_id']);
native('property.status', [], [], true);
native('property.document.import', ['path','metadata'], ['path','metadata']);
native('property.document.read', ['document_id'], ['document_id'], true);
native('property.intake', ['document_ids','operator','label','packet','path','previous_id','note'], ['document_ids','operator','label']);
native('property.study.freeze', ['value','document_ids'], ['value','document_ids']);
native('property.edition.read', ['edition_id','search','offset','limit'], ['edition_id'], true);
native('property.edition.packet', ['edition_id'], ['edition_id'], true);
native('property.edition.revise', ['edition_id','packet','operator','label','note','document_ids'], ['edition_id','packet','operator','label','note']);
native('property.comparison.create', ['candidate_id','operator','label','baseline_id','note','unchanged'], ['candidate_id','operator','label']);
native('property.comparison.read', ['review_id','offset','limit'], ['review_id'], true);
native('property.review.apply', ['review_id','expected_version','keys','action','operator','note'], ['review_id','expected_version','keys','action','operator','note']);
native('property.selection.freeze', ['review_id','expected_version','operator','purpose','label','items','criteria','note'],
  ['review_id','expected_version','operator','purpose','label','items']);
native('property.selection.read', ['selection_id'], ['selection_id'], true);
native('property.selection.report', ['selection_id'], ['selection_id'], true);
native('property.selection.export', ['selection_id','operator','label'], ['selection_id','operator','label']);
export const STUDY_NATIVE_OPERATIONS = Object.freeze(definitions);

const tools = [];
function tool(suffix, description, properties = {}, required = [], readOnly = false, idempotent = readOnly) {
  tools.push(Object.freeze({name:'merchant_study_' + suffix, description,
    annotations:{readOnlyHint:readOnly, destructiveHint:false, idempotentHint:idempotent, openWorldHint:false},
    inputSchema:{type:'object', properties, required, additionalProperties:false}}));
}
tool('workspaces','List configured original Study workspaces, application source selections and named file/acquisition inputs.',{},[],true);
tool('inspect','Read the private original connection and authenticate its exact workspace, source and running instance.',ws,['workspace'],true);
tool('open','Borrow the original Study HTTP operator, or explicitly start the same Python service when this host alias permits it.',
  {...ws,expectedSelectionSha256:id},['workspace']);
tool('close','Drain this alias and stop only its own original Python child; release a borrowed connection to its existing owner.',
  {...ws,expectedInstanceId:text(64)},['workspace','expectedInstanceId']);
tool('browser','Return the verified original operator browser URL for this same private workspace.',ws,['workspace'],true);
tool('inputs','Inspect configured input aliases and hash the selected original file; acquisition aliases retain original checkout/session bindings.',
  {...ws,input:alias},['workspace'],true);
tool('status','Read the full original source editions, frozen mappings, comparisons, packages and events.',ws,['workspace'],true);
tool('catalog','Page original source geographies and measures before freezing an explicit portfolio.',
  {...ws,source_ids:ids,search:S(),...page},['workspace'],true);
tool('source_rows','Page original raw values, source locators, units and observation periods from a retained provider edition.',
  {...ws,source_id:id,geography:S(),measure:S(),...nativePage},['workspace','source_id'],true);
tool('source_import','Import a host-declared ACS Summary File, ACS API, BLS or HUD source pointer through its original provider and complete manifest.',
  {...ws,hostInput:alias,expectedSha256:id},['workspace','hostInput','expectedSha256']);
tool('source_receive_files','Receive the original finalized SF88 source-files acquisition through the existing SF100 delivery and provider consumer.',
  {...ws,acquisition:alias,expected_capture_id:id},['workspace','acquisition']);
tool('source_receive_rows','Join an original acquired observation projection to its identical retained provider rows.',
  {...ws,acquisition:alias,source_id:id,projection:text(200)},['workspace','acquisition','source_id','projection']);
tool('source_receive_scan','Receive an existing finalized SF100 scan from its pinned host file, preserving its original pages and source binding.',
  {...ws,hostInput:alias,expectedSha256:id,provider:{enum:['acs','bls']},source_id:id,projection:text(200),expected_capture_id:id},
  ['workspace','hostInput','expectedSha256']);
tool('mapping_fields','Read all original mapping field names and value types.',ws,['workspace'],true);
tool('mapping_template','Read the original canonical export-mapping template.',{...ws,name:text(200)},['workspace'],true);
tool('portfolio_freeze','Freeze the complete explicit geography/measure portfolio, including observation vintage and any supplied crosswalk.',
  {...ws,...inputValue},['workspace']);
tool('mapping_freeze','Freeze original export columns, keys and explicit unit conversions using native decimal semantics.',
  {...ws,...inputValue},['workspace']);
tool('edition_freeze','Freeze a complete selected source universe against exact portfolio and mapping editions.',
  {...ws,source_ids:ids,portfolio_id:id,mapping_id:id,label:text(1000)},
  ['workspace','source_ids','portfolio_id','mapping_id','label']);
tool('comparison_create','Compare retained editions by the same observation period or successive release; preserve incomparable rows and unchanged review policy.',
  {...ws,candidate_id:id,baseline_id:id,mode:{enum:['same_period','successive_release']},note:S(16000),unchanged:{enum:['accept','review']}},
  ['workspace','candidate_id']);
tool('comparison_read','Page exact added, removed, changed, unchanged, incomparable or ambiguous original comparison rows.',
  {...ws,comparison_id:id,kind:S(100),...nativePage},['workspace','comparison_id'],true);
tool('review_keys','Read complete original comparison keys for an explicit review selection.',
  {...ws,comparison_id:id,kind:S(100)},['workspace','comparison_id'],true);
tool('review_apply','Apply the selected original review decisions at the exact current version; a changed version requires rereading the comparison.',
  {...ws,comparison_id:id,...review},['workspace','comparison_id','expected_version','keys','action','operator','note']);
tool('observation_read','Read an exact frozen observation and its original provider row, source file, cell and capture identity.',
  {...ws,edition_id:id,row_id:id},['workspace','edition_id','row_id'],true);
tool('export_create','Produce the original complete mapped package from a reviewed comparison at its exact current version.',
  {...ws,comparison_id:id,expected_version:n(),operator:text(200),label:text(1000)},
  ['workspace','comparison_id','expected_version','operator','label']);
tool('export_verify','Verify the entire original package selected from this workspace retained export record.',
  {...ws,export_id:id},['workspace','export_id'],true);
tool('export_archive','Create or recover the original complete ZIP for an existing native export.',
  {...ws,export_id:id},['workspace','export_id'],false,true);
tool('download','Stream a complete native archive, mapped export member, source member or property document into retained agent custody.',
  {...ws,kind:{enum:['archive','export','source','property_document']},id,path:S(1000)},['workspace','kind','id'],true);
tool('package_import','Import a complete SHA-pinned original source or property ZIP into this same operator, retaining its inventory, reviews, files and incoming package.',
  {...ws,...selected},['workspace','input','expectedSha256']);
tool('property_status','Read complete native property studies, survey editions, reviews and purpose-specific comparable selections.',ws,['workspace'],true);
tool('property_document_import','Retain a complete original survey document, PDF, workbook or file with its published source metadata.',
  {...ws,...selected,metadata:object},['workspace','input','expectedSha256','metadata']);
tool('property_document_read','Read a retained source document and its complete original file identity.',
  {...ws,document_id:id},['workspace','document_id'],true);
tool('property_intake','Import the complete original property-survey intake against exact retained source-document bindings.',
  {...ws,document_ids:docs,operator:text(200),label:text(1000),previous_id:id,note:S(16000),...jsonInputs},
  ['workspace','document_ids','operator','label']);
tool('property_study_freeze','Freeze an explicit study and market area against its original retained source documents.',
  {...ws,document_ids:docs,...inputValue},['workspace','document_ids']);
tool('property_edition_read','Page original property identities, published unit/rent schedules, dates and source citations.',
  {...ws,edition_id:id,search:S(),...nativePage},['workspace','edition_id'],true);
tool('property_edition_packet','Read the complete retained original property intake packet for a selected edition.',
  {...ws,edition_id:id},['workspace','edition_id'],true);
tool('property_edition_revise','Save a corrected complete survey edition with its original prior edition, operator and reason.',
  {...ws,edition_id:id,document_ids:docs,operator:text(200),label:text(1000),note:S(16000),...jsonInputs},
  ['workspace','edition_id','operator','label','note']);
tool('property_comparison_create','Create an original survey-source correction review, retaining changed properties and the explicit unchanged policy.',
  {...ws,candidate_id:id,baseline_id:id,operator:text(200),label:text(1000),note:S(16000),unchanged:{enum:['accept','review']}},
  ['workspace','candidate_id','operator','label']);
tool('property_comparison_read','Read original property-source review rows and their current decision version.',
  {...ws,review_id:id,...nativePage},['workspace','review_id'],true);
tool('property_review_apply','Record exact current-version source corrections and exclusions in the original property review.',
  {...ws,review_id:id,...review},['workspace','review_id','expected_version','keys','action','operator','note']);
tool('property_selection_freeze','Freeze purpose-specific staff-selected comparables, selected unit cohorts, reasons and source-review snapshot.',
  {...ws,review_id:id,expected_version:n(),operator:text(200),purpose:text(1000),label:text(1000),
    items:{type:'array',items:object,maxItems:10000},criteria:{type:'array',items:object,minItems:1,maxItems:100},note:S(16000)},
  ['workspace','review_id','expected_version','operator','purpose','label','items']);
tool('property_selection_read','Read the exact saved comparable selection and frozen source-review decisions.',
  {...ws,selection_id:id},['workspace','selection_id'],true);
tool('property_selection_report','Read native analyst/report tables for the selected comparable cohort.',
  {...ws,selection_id:id},['workspace','selection_id'],true);
tool('property_selection_export','Produce the complete original comparable-supply report, analyst CSVs, selected survey source and receiving package.',
  {...ws,selection_id:id,operator:text(200),label:text(1000)},['workspace','selection_id','operator','label']);
tool('snapshot','Read selected values and array pointers from a retained complete native JSON response.',
  {...ws,snapshotId:text(64),expectedSha256:id,pointer:S(4000)},['workspace','snapshotId','expectedSha256'],true);
tool('rows','Page an exact original array from a complete retained native response.',
  {...ws,snapshotId:text(64),expectedSha256:id,pointer:S(4000),offset:n(),limit:n(200,1)},
  ['workspace','snapshotId','expectedSha256','pointer'],true);
tool('file_read','Read exact original bytes through the shared native retained-file reader, with offset and whole-file hash.',
  {...ws,snapshotId:text(64),expectedSha256:id,readId:text(80),offset:n(STUDY_MAX_PACKET_BYTES),limit:n(STUDY_CHUNK_BYTES,1)},
  ['workspace','snapshotId','expectedSha256'],true);
tool('file_release','Release this alias original retained-file descriptor after receiving its bytes.',
  {...ws,snapshotId:text(64),readId:text(80)},['workspace','snapshotId','readId'],false,true);
tool('receive_begin','Begin or recover a SHA-pinned input-file transfer; the original file is imported only by the subsequent explicit native operation.',
  {...ws,transferKey:text(180),filename:text(240),bytes:n(STUDY_MAX_PACKET_BYTES),sha256:id,mediaType:text(200)},
  ['workspace','transferKey','filename','bytes','sha256'],false,true);
tool('receive_chunk','Retain one exact fixed-offset base64 part; identical retries preserve its original bytes.',
  {...ws,transferId:text(80),offset:n(STUDY_MAX_PACKET_BYTES),data:S(Math.ceil(STUDY_CHUNK_BYTES/3)*4)},
  ['workspace','transferId','offset','data'],false,true);
tool('receive_status','Read original received and missing input-file offsets after a transport interruption.',
  {...ws,transferId:text(80),offset:n(STUDY_MAX_PACKET_BYTES),limit:n(200,1)},['workspace','transferId'],true);
tool('receive_commit','Verify every part and the original complete file hash before exposing the input to native import.',
  {...ws,transferId:text(80)},['workspace','transferId'],false,true);
export const studyWorkspaceTools = Object.freeze(tools);
