// MIT. Original named programme, review, delivery and complete-file controls.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';
import { WORLDBANK_ALIAS, WORLDBANK_NAME, WORLDBANK_ID, WORLDBANK_SHA, plain, worldBankNeed as need } from '../worldbank-programme-contracts.mjs';
export const WORLDBANK_PROGRAMME_PREFIX = 'merchant_worldbank_programme_';
export const WORLDBANK_PROGRAMME_HTTP_BYTES = 2 * 1024 * 1024;
const text = maxLength => ({ type: 'string', minLength: 1, maxLength });
const pattern = regex => ({ type: 'string', pattern: regex.source });
const workspace = { workspace: pattern(WORLDBANK_ALIAS) }, programme = { ...workspace, programme: pattern(WORLDBANK_NAME) };
const id = pattern(WORLDBANK_ID), sha = pattern(WORLDBANK_SHA);
const request = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const source = request({ name: pattern(WORLDBANK_NAME), revision: { type: 'integer', minimum: 1 } });
const revision = { type: 'integer', minimum: 0 }, resume = { type: 'boolean' };
const operation = { ...programme, operationId: id };
const page = { before: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100 } };
const wait = { timeoutMs: { type: 'integer', minimum: 1, maximum: 120000 }, pollMs: { type: 'integer', minimum: 100, maximum: 10000 } };
const definition = request({ title: text(200), view: pattern(WORLDBANK_NAME), report: pattern(WORLDBANK_NAME),
  workbook: pattern(WORLDBANK_NAME), keys: { type: 'array', minItems: 1, maxItems: 16, uniqueItems: true, items: text(200) },
  prefix: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]{0,20}$' } });
const columns = { anyOf: [{ type: 'null' }, { type: 'object', maxProperties: 256,
  propertyNames: { pattern: '^(0|[1-9][0-9]*)$' }, additionalProperties: {
    type: 'array', minItems: 1, maxItems: 4096, items: { type: 'object', additionalProperties: true } } }] };
const selected = { ...workspace, exportId: sha };
const intake={...workspace,intakeId:id};
const intakeRequest=request({id,bytes:{type:'integer',minimum:1,maximum:32*1024*1024},sha256:sha,filename:text(240)});
const descriptors = [
 ['intake_list','Read one original source-intake history page; follow next_before. Read intake_status for available local upload bytes.',{...workspace,...page},['workspace'],true],
 ['intake_begin','Retain one exact approved ZIP identity before chunk upload. Replay the same ID, byte count, SHA256 and filename.',{...workspace,request:intakeRequest},['workspace','request'],false],
 ['intake_status','Read original intake, locally available_bytes, registration state, exact source revision and original ZIP identity.',intake,['workspace','intakeId'],true],
 ['intake_chunk','Upload or restore one exact original aligned 256 KiB chunk. Resume from status.available_bytes; read status after each replayed chunk.',{...intake,request:request({offset:{type:'integer',minimum:0},sha256:sha,content:text(349528)})},['workspace','intakeId','request'],false],
 ['intake_register','Register the complete approved source through the same original Analysis owner. Explicit resume is required for a failed/interrupted attempt. This preserves existing view/report/workbook selections.',{...intake,resume},['workspace','intakeId'],false],
 ['intake_wait','Read this original registration until it leaves REGISTERING or the selected interval expires.',{...intake,...wait},['workspace','intakeId'],true],
 ['intake_export','Retain the complete registered original ZIP, registration and original intent for portable receiving after the Analysis owner closes.',{...intake,expectedSha256:sha},['workspace','intakeId','expectedSha256'],false],
 ['intake_manifest','Read the full retained source-intake export manifest.',selected,['workspace','exportId'],true],
 ['intake_file','Read the complete original registered source file by exact manifest, hash and byte offset.',{...selected,file:text(200),expectedManifestSha256:sha,expectedSha256:sha,readId:text(128),offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},['workspace','exportId','file','expectedManifestSha256','expectedSha256'],true],
 ['intake_file_release','Release this exact retained original source read.',{...selected,readId:text(128)},['workspace','exportId','readId'],false],
 ['connections','Read host-declared original Analysis workspaces and allowed programme names.',{},[],true],
 ['state','Read the original Analysis workspace and its exact saved identity.',workspace,['workspace'],true],
 ['list','Read one complete programme page. Follow next_before to retain all pages; only declared programme names are shown.',{...workspace,before:pattern(WORLDBANK_NAME),limit:page.limit},['workspace'],true],
 ['sources','Read complete approved retained World Bank document revisions with original handover/source/review metadata. Follow next_before.',{...workspace,...page},['workspace'],true],
 ['definition','Read the complete saved original programme, all definition revisions and its first operation-history page.',programme,['workspace','programme'],true],
 ['history','Read a complete original operation-history page and follow next_before.',{...programme,...page},['workspace','programme'],true],
 ['save','Save a complete original customer binding using stable request id and current expected_revision. Preserves existing customer view/report/workbook.',{...programme,request:request({id,expected_revision:revision,definition})},['workspace','programme','request'],false],
 ['prepare','Review the retained candidate source against the current original programme. Reuse its exact id and source revision after an uncertain reply.',{...programme,request:{type:'object',properties:{id,expected_revision:revision,source,resume},required:['id','expected_revision','source'],additionalProperties:false}},['workspace','programme','request'],false],
 ['status','Read the original operation, complete retained source review, worksheet choices, result and honest file availability.',operation,['workspace','programme','operationId'],true],
 ['review','Read the complete original review and review_sha256; inspect the whole comparison and baseline/candidate metadata before publication.',operation,['workspace','programme','operationId'],true],
 ['comparison','Read each complete page of the original comparison. Preserve returned counts, cursor and source metadata.',{...workspace,comparisonId:id,kind:text(40),after:{type:'integer',minimum:0}},['workspace','comparisonId'],true],
 ['publish','Continue the exact reviewed source/report/workbook with its operation id, review_sha256, note and explicit full worksheet columns when required. awaitCompletion reads that same operation for the bounded interval; unfinished and column-choice states remain explicit.',{...programme,awaitCompletion:{type:'boolean'},...wait,request:{type:'object',properties:{id,review_sha256:sha,note:text(8000),columns,resume},required:['id','review_sha256','note'],additionalProperties:false}},['workspace','programme','request'],false],
 ['reopen','When native status reports can_reopen=true and accepted_edition, create a linked portable delivery with a new explicit id. Preserves accepted source/report/workbook and snapshots current customer edits; a restored INTERRUPTED parent remains unchanged.',{...programme,request:{type:'object',properties:{id,operation_id:id,resume},required:['id','operation_id'],additionalProperties:false}},['workspace','programme','request'],false],
 ['wait','Read the same original operation until its state changes from RUNNING or the selected interval expires. Timeout never means completion.',{...operation,...wait},['workspace','programme','operationId'],true],
 ['recipe','Create a complete original Console workflow recipe for this programme and actual source, with an operator review pause before publication. Install it through the existing workflow-series recipe preparation.',{...programme,operationId:id,programmeRevision:{type:'integer',minimum:1},source,reviewNote:text(8000),columns:{type:'object',additionalProperties:true},name:text(160)},['workspace','programme','operationId','programmeRevision','source','reviewNote'],true],
 ['export','Retain every complete original programme delivery file and operation record for customer receiving. The expectedResultSha256 is from the completed status/wait response.',{...operation,expectedResultSha256:sha},['workspace','programme','operationId','expectedResultSha256'],false],
 ['manifest','Read the original complete retained delivery manifest; available after the Analysis owner closes.',selected,['workspace','exportId'],true],
 ['file','Read the complete selected original file by hash and offset through EOF. Preserve readId while active; after restart reopen at the same offset and SHA256.',{...selected,file:text(200),expectedManifestSha256:sha,expectedSha256:sha,readId:text(128),offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},['workspace','exportId','file','expectedManifestSha256','expectedSha256'],true],
 ['file_release','Release this original retained file read after completion or interruption.',{...selected,readId:text(128)},['workspace','exportId','readId'],false]
];
export const worldBankProgrammeDefinitions = Object.freeze(descriptors.map(([action,description,properties,required,readOnly]) =>
  Object.freeze({name:WORLDBANK_PROGRAMME_PREFIX+action,action,description,properties,required,readOnly})));
function accepted(schema,value){
  if(schema.anyOf)return schema.anyOf.some(s=>accepted(s,value));
  if(schema.type==='null')return value===null;
  if(schema.type==='boolean')return typeof value==='boolean';
  if(schema.type==='string')return typeof value==='string'&&value.length>=(schema.minLength??0)&&value.length<=(schema.maxLength??Infinity)&&(!schema.pattern||new RegExp(schema.pattern).test(value));
  if(schema.type==='integer')return Number.isSafeInteger(value)&&value>=(schema.minimum??0)&&value<=(schema.maximum??Number.MAX_SAFE_INTEGER);
  if(schema.type==='array')return Array.isArray(value)&&value.length>=(schema.minItems??0)&&value.length<=(schema.maxItems??Infinity)&&(!schema.uniqueItems||new Set(value).size===value.length)&&value.every(v=>accepted(schema.items,v));
  if(schema.type==='object')return plain(value)&&Object.keys(value).length<=(schema.maxProperties??Infinity)&&(schema.required??[]).every(k=>Object.hasOwn(value,k))&&Object.entries(value).every(([k,v])=>
    (!schema.propertyNames||accepted({type:'string',...schema.propertyNames},k))&&(schema.properties?.[k]?accepted(schema.properties[k],v):schema.additionalProperties===false?false:plain(schema.additionalProperties)?accepted(schema.additionalProperties,v):true));
  return false;
}
export function validateWorldBankProgrammeArguments(name,args){
  const entry=worldBankProgrammeDefinitions.find(v=>v.name===name);
  need(entry&&accepted({type:'object',properties:entry.properties,required:entry.required,additionalProperties:false},args),
    'Use the declared original programme operation with complete original arguments.');
  need(Buffer.byteLength(JSON.stringify(args))<=1024*1024,'The complete programme request exceeds the original one MiB body capacity.');
  return entry.action;
}
export function worldBankProgrammeTools(tool){return worldBankProgrammeDefinitions.map(v=>tool(v.name,v.description,v.properties,v.required,
  {readOnly:v.readOnly,idempotent:true,openWorld:false}));}
