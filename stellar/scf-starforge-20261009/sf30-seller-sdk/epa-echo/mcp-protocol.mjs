// MIT. Pure EPA ECHO operator contracts; catalog reads do not load a provider runtime.
import { MAX_RETAINED_CHUNK_BYTES } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';

const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SHA = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPERATION = /^[A-Za-z0-9_-]{8,100}$/;
const SHORT_ID = /^[0-9a-f]{24}$/;
const RECORD_ID = /^[a-z0-9][a-z0-9_-]{7,127}$/;
const FACILITY_ID = /^[0-9]{1,24}$/;
const RECEIPT_FILES = ['dataset.csv','dataset.jsonl','review.html','delivery.json','manifest.json'];
const fail = (code, message) => Object.assign(new Error(message), { code });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function exact(value, fields, required = []) {
  if (!plain(value) || Object.keys(value).some(key => !fields.includes(key)) || required.some(key => !Object.hasOwn(value, key)))
    throw fail('INVALID_PARAMS', 'Supply only the declared fields, including every required field.');
}
function checked(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw fail('INVALID_PARAMS', 'Supply a valid ' + label + '.');
  return value;
}
function integer(value, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw fail('INVALID_PARAMS', 'Integer is outside the declared range.');
  return value;
}

const string = (maximum = 200) => ({ type: 'string', maxLength: maximum });
const matching = pattern => ({ type: 'string', pattern: pattern.source });
const number = (minimum, maximum = Number.MAX_SAFE_INTEGER) => ({ type: 'integer', minimum, maximum });
const choice = values => ({ type: 'string', enum: values });
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const strings = maximum => ({ type: 'array', items: string(500), minItems: 1, maxItems: maximum });
const decimal = (minimum,maximum) => ({type:'number',minimum,maximum});
const boolean = {type:'boolean'};
// Table IDs and exact DFR columns are supplied by the selected running schema.
const table = string(100);
const payment = object({
  scheme: choice(['exact']), network: choice(['stellar:testnet','stellar:pubnet']), asset: string(100),
  amount: matching(/^[1-9][0-9]*$/), payTo: string(100), maxTimeoutSeconds: number(1,86400)
}, ['scheme','network','asset','amount','payTo','maxTimeoutSeconds']);
const id=matching(RECORD_ID), edition=matching(SHA), facility=matching(FACILITY_ID);
const facilityIds={type:'array',items:facility,minItems:1,maxItems:1000,uniqueItems:true};
const actions = [
  ['portfolio.save','Create or revise the named original facility portfolio and its ordered FRS identifiers, customer, owner and instructions. Preserve earlier portfolio editions.', {portfolioId:id,label:string(200),facilityIds,customer:string(240),owner:string(240),note:string(12000),active:boolean}, ['label','facilityIds']],
  ['portfolio.archive','Archive the selected portfolio while retaining its original facilities, captures, reviews and deliveries.', {portfolioId:id}, ['portfolioId'], {destructive:true}],
  ['facility.search','Search the original EPA ECHO facility service with explicit provider query fields and retain the actual request and response.', {label:string(200),query:{type:'object',additionalProperties:true}}, ['query'], {openWorld:true}],
  ['capture.start','Capture original EPA ECHO detailed reports for the selected portfolio. Preserve every facility response, source contract and explicit capture coverage.', {portfolioId:id,label:string(200)}, ['portfolioId'], {openWorld:true}],
  ['capture.resume','Continue the same retained capture and its remaining source work after any saved provider retry time.', {captureId:id}, ['captureId'], {openWorld:true}],
  ['capture.pause','Pause this capture and retain its completed original responses and edition.', {captureId:id}, ['captureId']],
  ['capture.import','Import the host-selected original EPA ECHO source package into the selected portfolio; verify its pinned file hash before the original native importer.', {portfolioId:id,label:string(200),sourcePackage:matching(ALIAS)}, ['portfolioId','sourcePackage']],
  ['edition.select','Select one existing immutable facility-report edition in this original workspace.', {editionId:edition}, ['editionId']],
  ['edition.compare','Create the complete keyed comparison of one original table across two selected source editions, retaining the downloadable change file.', {leftId:edition,rightId:edition,table}, ['leftId','rightId','table']],
  ['review.save','Record a source-linked staff decision with original facility, edition, responsible owner, due date and review history.', {reviewId:id,portfolioId:id,editionId:edition,facilityId:facility,subject:string(300),note:string(12000),status:choice(['open','reviewed','follow_up','resolved']),owner:string(240),dueDate:string(40)}, ['portfolioId','editionId','subject','note','status']],
  ['dataset.prepare','Prepare the selected original report table through the maintained SF30 dataset engine with complete source lineage.', {editionId:edition,table,name:string(200)}, ['editionId','table']],
  ['dataset.query','Query the original retained dataset with its encoded fields, filters, sort and cursor contract.', {datasetId:id,query:string(8192)}, ['datasetId']],
  ['release.prepare','Prepare the original SF82 publisher with the selected dataset, explicit origin/resource and reviewed Stellar payment terms.', {datasetId:id,origin:string(2048),path:string(1024),payment}, ['datasetId','origin','payment']],
  ['release.inspect','Read the original publisher, release generation and runtime state for this retained release.', {releaseId:id}, ['releaseId'], {openWorld:true}],
  ['release.activate','Activate the original prepared release at its current publisher generation.', {releaseId:id,expectedGeneration:number(0)}, ['releaseId','expectedGeneration'], {destructive:true}],
  ['release.start','Start the selected original merchant with its configured payment runtime and current generation.', {releaseId:id,expectedGeneration:number(0)}, ['releaseId','expectedGeneration'], {openWorld:true}],
  ['release.stop','Stop the original workspace-owned publisher and retain the complete selected source and history.', {releaseId:id}, ['releaseId'], {destructive:true}],
  ['release.rollback','Restore the retained previous selection in the original publisher at its current generation.', {releaseId:id,expectedGeneration:number(0)}, ['releaseId','expectedGeneration'], {destructive:true}],
  ['buyer.inspect','Inspect ordered original SF88 page intents from the host-selected customer inbox.', {intentIds:strings(1000)}, ['intentIds']],
  ['buyer.receive','Receive the ordered original completed SF88 page outcomes through SF100, preserving its five original customer files.', {intentIds:strings(1000)}, ['intentIds']],
  ['export.create','Create complete edition JSON, selected-table CSV, a printable report or original source package, with its source coverage and reviews.', {editionId:edition,table,format:choice(['json','csv','report','source-package'])}, ['editionId','format']],
  ['workspace.export','Retain a complete portable original workspace package with source files, editions, portfolio and review history and retained working records.', {}, []],
  ['workspace.receive','Receive the host-selected complete original workspace package, preserving original source identity, state, editions, reviews and validated readonly files.', {workspacePackage:matching(ALIAS)}, ['workspacePackage']]
];
const actionNames = new Map(actions.map(value => ['merchant_echo_' + value[0].replaceAll('.','_'), value]));
const scope={workspace:matching(ALIAS)},readOnly={readOnly:true,idempotent:true};
const selectFile={
  kind:choice(['source','export','receipt','workspace']),id:string(128),
  page:number(0),wire:boolean,file:choice(RECEIPT_FILES),path:string(2048)
};
const chunks={readId:matching(UUID),expectedSha256:matching(SHA),offset:number(0),limit:number(1,MAX_RETAINED_CHUNK_BYTES)};
export function echoWorkspaceTools(tool){
  return [
    tool('merchant_echo_workspaces','List original host-declared EPA ECHO workspace aliases, UUIDs, selected package aliases and retained file sessions.',{},[],readOnly),
    tool('merchant_echo_schema','Read the current original source contract, actual tables/columns, actions, payment fields and capabilities.',scope,['workspace'],readOnly),
    tool('merchant_echo_view','Read this original browser workspace revision, portfolio/search/capture records, reviews, releases, customer files and received workspaces.',scope,['workspace'],readOnly),
    tool('merchant_echo_editions','Page the complete original edition archive with a retained revision. A changed archive requires reviewing the current revision before paging again.',{...scope,offset:number(0),limit:number(1,500),portfolioId:id,expectedRevision:number(0)},['workspace'],readOnly),
    tool('merchant_echo_edition','Read an immutable original edition and every facility source receipt.',{...scope,editionId:edition},['workspace','editionId'],readOnly),
    tool('merchant_echo_rows','Page original schema-declared rows in one immutable edition, optionally selecting an original facility and report section.',{...scope,editionId:edition,table,facilityId:facility,section:string(240),offset:number(0),limit:number(1,500)},['workspace','editionId','table'],readOnly),
    tool('merchant_echo_facility','Read the complete original selected facility view within an immutable report edition.',{...scope,editionId:edition,facilityId:facility},['workspace','editionId','facilityId'],readOnly),
    tool('merchant_echo_search','Page one retained original facility-search result; preserve its source query and response identity.',{...scope,searchId:id,offset:number(0),limit:number(1,500)},['workspace','searchId'],readOnly),
    tool('merchant_echo_received_workspace','Open a complete received original workspace with its source state, editions and original file manifest.',{...scope,receiptId:id},['workspace','receiptId'],readOnly),
    tool('merchant_echo_files','Read exact metadata/selectors for original source pages, one export, five customer files, or a received workspace file manifest. A path can select one original received file.',{...scope,kind:selectFile.kind,id:selectFile.id,wire:boolean,path:string(2048)},['workspace','kind','id'],readOnly),
    tool('merchant_echo_file_read','Receive original file bytes in SHA256-bound base64 chunks. Resume the same selector/readId/hash/offset; an already retained read remains usable after the source console closes.',{...scope,...selectFile,...chunks},['workspace','kind','id'],readOnly),
    tool('merchant_echo_file_release','Release one temporary download snapshot while retaining the original workspace and customer files.',{...scope,readId:matching(UUID)},['workspace','readId'],{idempotent:true}),
    ...actions.map(([action,description,properties,required,annotations={}])=>tool('merchant_echo_'+action.replaceAll('.','_'),
      description+' Supply the current revision and a stable operationId. Repeat the exact request after an interrupted reply; the original journal reconciles identity before revision.',
      {...scope,operationId:matching(OPERATION),expectedRevision:number(0),...properties},
      ['workspace','operationId','expectedRevision',...required],{idempotent:true,...annotations}))
  ];
}
const definitions = new Map(echoWorkspaceTools((name,description,properties,required) => ({name,properties,required})).map(item=>[item.name,item]));
function validate(value, schema, path) {
  if (schema.type === 'object') {
    if (!plain(value)) throw fail('INVALID_PARAMS', path + ' must be an object.');
    if (schema.additionalProperties === false) exact(value,Object.keys(schema.properties ?? {}),schema.required ?? []);
    for (const required of schema.required ?? []) if (!Object.hasOwn(value,required)) throw fail('INVALID_PARAMS',path+' requires '+required+'.');
    for (const [key, item] of Object.entries(value)) {
      const field = schema.properties?.[key] ?? (plain(schema.additionalProperties) ? schema.additionalProperties : null);
      if (field) validate(item,field,path+'.'+key);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity))
      throw fail('INVALID_PARAMS',path+' has an invalid item count.');
    if (schema.uniqueItems && new Set(value.map(item=>JSON.stringify(item))).size !== value.length)
      throw fail('INVALID_PARAMS',path+' requires distinct values.');
    for (const item of value) validate(item,schema.items,path+'[]');
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') throw fail('INVALID_PARAMS',path+' must be a boolean.');
  } else if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < schema.minimum || value > schema.maximum)
      throw fail('INVALID_PARAMS',path+' must be a number in the declared range.');
  } else if (schema.type === 'integer') integer(value,schema.minimum ?? 0,schema.maximum);
  else if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length > (schema.maxLength ?? Infinity) || value.length < (schema.minLength ?? 0) ||
        schema.enum && !schema.enum.includes(value) || schema.pattern && !new RegExp(schema.pattern).test(value))
      throw fail('INVALID_PARAMS',path+' does not match the declared text field.');
  }
}

export { actionNames as echoActionNames, definitions as echoToolDefinitions, validate as validateEchoToolField };
