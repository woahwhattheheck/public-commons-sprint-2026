// MIT. Pure NWS tool contracts; importing the catalog does not load a provider runtime.
import { MAX_RETAINED_CHUNK_BYTES } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';

const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SHA = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPERATION = /^[A-Za-z0-9_-]{8,100}$/;
const SHORT_ID = /^[0-9a-f]{24}$/;
const SITE_ID = /^site-[0-9a-f]{24}$/;
const TABLES = ['forecast','hourly','grid','observations','latest','active-alerts','alerts','stations'];
const PRODUCTS = ['forecast','hourly','grid','observations','alerts'];
const DATASET_ID = /^dataset-[0-9a-f]{24}$/;
const RELEASE_ID = /^nws-[0-9a-f]{24}$/;
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
const table = choice(TABLES);
const products = {type:'array',items:choice(PRODUCTS),minItems:1,maxItems:PRODUCTS.length,uniqueItems:true};
const payment = object({
  scheme: choice(['exact']), network: choice(['stellar:testnet','stellar:pubnet']), asset: string(100),
  amount: matching(/^[1-9][0-9]*$/), payTo: string(100), maxTimeoutSeconds: number(1,86400)
}, ['scheme','network','asset','amount','payTo','maxTimeoutSeconds']);
const nativeQuery = string(8192);
const id = matching(SHORT_ID), edition = matching(SHA), dataset = matching(DATASET_ID), release = matching(RELEASE_ID);
const actions = [
  ['site.save','Create or revise a named operating site, explicit coordinates, selected station and responsible operator; retain prior site editions.', {siteId:matching(SITE_ID),label:string(200),latitude:decimal(-90,90),longitude:decimal(-180,180),stationId:string(16),owner:string(240),note:string(12000),active:boolean}, ['label','latitude','longitude']],
  ['site.archive','Archive this site while retaining every original capture, edition, note and delivery.', {siteId:matching(SITE_ID)}, ['siteId'], {destructive:true}],
  ['capture.start','Capture the current original point mapping and selected forecast, grid, station, observation and alert products. Preserve distinct provider times, source nulls, units and coverage.', {siteId:matching(SITE_ID),label:string(200),products,observationStart:string(100),observationEnd:string(100),units:choice(['us','si'])}, ['siteId'], {openWorld:true}],
  ['capture.resume','Continue the original capture and provider continuations after their saved retry time; keep completed source responses.', {captureId:id}, ['captureId'], {openWorld:true}],
  ['capture.pause','Pause the original active capture and retain its completed source responses and partial edition.', {captureId:id}, ['captureId']],
  ['capture.station','Select an actual station from this capture’s retained provider catalog and continue its observation history.', {captureId:id,stationId:string(12)}, ['captureId','stationId'], {openWorld:true}],
  ['capture.import','Import a host-selected original NWS source package into this site. The pinned package alias supplies its exact file; the original importer verifies source response bytes and coordinates.', {siteId:matching(SITE_ID),label:string(200),sourcePackage:matching(ALIAS)}, ['siteId','sourcePackage']],
  ['edition.select','Select an existing immutable site edition in the same operator workspace.', {editionId:edition}, ['editionId']],
  ['edition.compare','Retain a complete keyed comparison of the selected source table from two site editions, with its downloadable original change file.', {leftId:edition,rightId:edition,table}, ['leftId','rightId','table']],
  ['annotation.save','Save source-linked review notes and retain the earlier review history.', {editionId:edition,subject:string(300),note:string(12000),status:choice(['open','reviewed','follow_up'])}, ['editionId','subject','note','status']],
  ['dataset.prepare','Prepare the chosen weather table through the original SF30 dataset engine, preserving original source files, unit codes and nulls.', {editionId:edition,table,name:string(200)}, ['editionId','table']],
  ['dataset.query','Query the original retained dataset using its URL-encoded fields/filter/sort/cursor query string. The original workspace journals this query.', {datasetId:dataset,query:nativeQuery}, ['datasetId']],
  ['release.prepare','Prepare an original SF82 merchant release with explicit origin, resource path and reviewed Stellar payment terms.', {datasetId:dataset,origin:string(2048),path:string(1024),payment}, ['datasetId','origin','payment']],
  ['release.inspect','Inspect the original selected publisher, generation and merchant runtime readiness; retain the original journal entry.', {releaseId:release}, ['releaseId'], {openWorld:true}],
  ['release.activate','Activate the original prepared weather release using its current publisher generation.', {releaseId:release,expectedGeneration:number(0)}, ['releaseId','expectedGeneration'], {destructive:true}],
  ['release.start','Start the original selected merchant using its configured payment runtime and expected generation.', {releaseId:release,expectedGeneration:number(0)}, ['releaseId','expectedGeneration'], {openWorld:true}],
  ['release.stop','Stop the original workspace-owned merchant while preserving its published source and customer history.', {releaseId:release}, ['releaseId'], {destructive:true}],
  ['release.rollback','Restore the original previous publisher selection using its current generation.', {releaseId:release,expectedGeneration:number(0)}, ['releaseId','expectedGeneration'], {destructive:true}],
  ['buyer.inspect','Inspect the ordered original SF88 page intents from this host-selected inbox. Retain the original inspection.', {intentIds:strings(1000)}, ['intentIds']],
  ['buyer.receive','Receive ordered original completed SF88 pages through SF100 and retain all five original customer files.', {intentIds:strings(1000)}, ['intentIds']],
  ['export.create','Retain complete original edition JSON, selected-table CSV, operator report or portable source package. Review notes and original capture coverage travel with the export.', {editionId:edition,table,format:choice(['json','csv','report','source-package'])}, ['editionId','format']]
];
const actionNames = new Map(actions.map(value => ['merchant_nws_' + value[0].replaceAll('.','_'), value]));
const scope = {workspace:matching(ALIAS)};
const readOnly = {readOnly:true,idempotent:true};
const selectFile = {
  kind:choice(['source','export','receipt']), id:string(100), page:number(0), wire:boolean, file:choice(RECEIPT_FILES)
};
const chunks = {
  readId:matching(UUID), expectedSha256:matching(SHA), offset:number(0),
  limit:number(1,MAX_RETAINED_CHUNK_BYTES)
};
export function nwsWorkspaceTools(tool) {
  return [
    tool('merchant_nws_workspaces','List host-declared NWS aliases and their original workspace UUIDs; report only this adapter’s retained download sessions.',{},[],readOnly),
    tool('merchant_nws_schema','Read the running original workspace schema, actual source contract, site/product/table declarations, payment fields and capabilities.',scope,['workspace'],readOnly),
    tool('merchant_nws_view','Read the same browser workspace and its current revision, captures, latest editions, all releases/receipts/exports and recent operation outcomes.',scope,['workspace'],readOnly),
    tool('merchant_nws_editions','Page the complete original edition archive. Retain the returned revision for every following page; a concurrent change returns REVISION_CHANGED.',{...scope,offset:number(0),limit:number(1,500),siteId:matching(SITE_ID),expectedRevision:number(0)},['workspace'],readOnly),
    tool('merchant_nws_edition','Read one complete immutable original edition, including every response receipt and exact source SHA256.',{...scope,editionId:edition},['workspace','editionId'],readOnly),
    tool('merchant_nws_rows','Page normalized original rows from one immutable edition. Original nulls, unit codes, geometry and source times are retained; nextOffset continues the same edition and table.',{...scope,editionId:edition,table,offset:number(0),limit:number(1,500)},['workspace','editionId','table'],readOnly),
    tool('merchant_nws_files','Read exact file metadata and selectors for an original edition’s source responses, one retained export, or one complete five-file customer receipt.',{...scope,kind:selectFile.kind,id:selectFile.id,wire:boolean},['workspace','kind','id'],readOnly),
    tool('merchant_nws_file_read','Read an original source/export/customer file as verified base64 byte chunks. Continue the same selector, readId, expectedSha256 and nextOffset. A retained read can finish after the console closes.',{...scope,...selectFile,...chunks},['workspace','kind','id'],readOnly),
    tool('merchant_nws_file_release','Release only the named temporary download snapshot; preserve original workspace source and customer files.',{...scope,readId:matching(UUID)},['workspace','readId'],{idempotent:true}),
    ...actions.map(([action, description, properties, required, annotations = {}]) =>
      tool('merchant_nws_' + action.replaceAll('.','_'),
        description + ' Supply the current revision and a stable operationId. Repeat the exact same request after an interrupted reply; the native journal reconciles it before checking the revision. Check ok and native state before continuing.',
        {...scope,operationId:matching(OPERATION),expectedRevision:number(0),...properties},
        ['workspace','operationId','expectedRevision',...required],{idempotent:true,...annotations}))
  ];
}
const definitions = new Map(nwsWorkspaceTools((name,description,properties,required) => ({name,properties,required})).map(item=>[item.name,item]));
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

export { actionNames as nwsActionNames, definitions as nwsToolDefinitions, validate as validateNwsToolField };
