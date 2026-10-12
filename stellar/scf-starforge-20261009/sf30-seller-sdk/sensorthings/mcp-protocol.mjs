// MIT. Pure tool catalog for the original SensorThings operating workspace.
import {ACTIONS,CAPTURE_READ_PARTS} from './schema.mjs';
import {MAX_RETAINED_CHUNK_BYTES} from '../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
const string=(maxLength=200)=>({type:'string',maxLength});
const matching=pattern=>({type:'string',pattern:pattern.source});
const integer=(minimum=0,maximum=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum,maximum});
const choice=values=>({type:'string',enum:values});
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
export const ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/,SHA=/^[a-f0-9]{64}$/,
  UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const scope={workspace:matching(ALIAS)},id=string(100),offset=integer(0),limit=integer(1,500),readOnly={readOnly:true,idempotent:true};
const selection=object({kind:choice(['source','edition','dataset','comparison','transfer','buyer','publisher']),
  id,sha256:matching(SHA),datasetId:matching(/^dataset-[a-f0-9]{24}$/),file:string(500)},['kind','id']);
const readModes=choice(['metadata','summary']);
export function sensorThingsWorkspaceTools(tool){
  return [
    tool('merchant_sensorthings_workspaces','List host-declared original SensorThings workspace aliases, UUIDs and this client’s active held-file reads. No source or workspace is created.',{},[],readOnly),
    tool('merchant_sensorthings_schema','Read the original running workspace schema, exact action fields, tables and source semantics before selecting an operation.',scope,['workspace'],readOnly),
    tool('merchant_sensorthings_view','Read original sources, plans, captures, editions, attributed reviews, native releases, customer receipts and current revision.',scope,['workspace'],readOnly),
    tool('merchant_sensorthings_catalog','Page one retained original stream catalogue. Use its exact catalogue ID and source pointer when preparing a plan; do not invent stream IDs.',{...scope,catalogId:matching(SHA),offset,limit},['workspace','catalogId'],readOnly),
    tool('merchant_sensorthings_edition','Read one immutable source edition or its original coverage/result/unit/quality summary.',{...scope,editionId:matching(SHA),mode:readModes},['workspace','editionId'],readOnly),
    tool('merchant_sensorthings_rows','Page original observation, ordered multidimensional component or entity rows, retaining null/missing/type/time distinctions and source pointers.',{...scope,editionId:matching(SHA),table:choice(['observations','components','entities']),offset,limit},['workspace','editionId','table'],readOnly),
    tool('merchant_sensorthings_capture','Inspect the same original capture and continuation state. Omit part for its complete legacy read; use summary or bounded tasks/pages/issues/attempts/parents for a large journal. Task pages retain complete original IDs; attempt/parent pages select taskId. Later offsets require the first page expectedRevision; a changed local journal requires a new first page.',{...scope,captureId:matching(/^[a-f0-9]{24}$/),part:choice(CAPTURE_READ_PARTS),offset,limit,taskId:matching(SHA),expectedRevision:integer(0)},['workspace','captureId'],readOnly),
    tool('merchant_sensorthings_release','Inspect the original selected seller release and publisher generations.',{...scope,releaseId:id},['workspace','releaseId'],readOnly),
    tool('merchant_sensorthings_publisher','Inspect the same original dataset publisher and SF88 session/recovery/accounting state.',{...scope,datasetId:matching(/^dataset-[a-f0-9]{24}$/)},['workspace','datasetId'],readOnly),
    tool('merchant_sensorthings_operation','Read a retained operation outcome after a lost reply. Keep its original ID and exact payload; a pending or failed operation is not a new success.',{...scope,operationId:matching(/^[A-Za-z0-9_-]{8,100}$/)},['workspace','operationId'],readOnly),
    tool('merchant_sensorthings_action','Execute one advertised native action using the current revision and one stable operationId. Payload fields must match the original schema. Source registration/capture/review/export, dataset/publication and customer workflows remain in the original writer. A lost reply requires reading this same operation before any repeat.',{
      ...scope,operationId:matching(/^[A-Za-z0-9_-]{8,100}$/),expectedRevision:integer(0),
      action:choice(Object.keys(ACTIONS)),payload:{type:'object',additionalProperties:true}
    },['workspace','operationId','expectedRevision','action','payload'],{idempotent:true,openWorld:true,destructive:true}),
    tool('merchant_sensorthings_files','Page exact original source, dataset, comparison, source-transfer or customer file identities. Choose a returned file selection for bounded reads. Repeat manifestSha256 for later metadata pages.',{
      ...scope,selection,offset,limit,manifestSha256:matching(SHA)
    },['workspace','selection'],readOnly),
    tool('merchant_sensorthings_file_read','Read at most one original verified byte chunk through the running native held-file owner. Continue the returned readId, same selector, expectedSha256 and nextOffset. After client/restart or expired read, resume the same SHA and offset without the old readId.',{
      ...scope,selection,readId:matching(UUID),expectedSha256:matching(SHA),offset,limit:integer(1,MAX_RETAINED_CHUNK_BYTES)
    },['workspace','selection'],readOnly),
    tool('merchant_sensorthings_file_release','Release only this client’s named native file read; preserve the immutable source and all original accounting.',{
      ...scope,readId:matching(UUID)
    },['workspace','readId'],{idempotent:true})
  ];
}
export const sensorThingsToolDefinitions=new Map(sensorThingsWorkspaceTools((name,description,properties,required)=>({name,properties,required})).map(v=>[v.name,v]));
export function validateSensorThingsField(value,schema,path='input'){
  const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const fail=()=>{throw Object.assign(new TypeError(path+' does not match the declared original tool field.'),{code:'INVALID_PARAMS'});};
  if(schema.type==='object'){
    if(!plain(value))fail();
    for(const key of schema.required??[])if(!Object.hasOwn(value,key))fail();
    for(const [key,v] of Object.entries(value)){
      const child=schema.properties?.[key];
      if(!child){if(schema.additionalProperties===false)fail();continue;}
      validateSensorThingsField(v,child,path+'.'+key);
    }
  }else if(schema.type==='integer'){
    if(!Number.isSafeInteger(value)||value<(schema.minimum??0)||value>(schema.maximum??Number.MAX_SAFE_INTEGER))fail();
  }else if(schema.type==='string'){
    if(typeof value!=='string'||value.length>(schema.maxLength??Infinity)||schema.pattern&&!new RegExp(schema.pattern).test(value)||schema.enum&&!schema.enum.includes(value))fail();
  }else if(schema.type==='boolean'){if(typeof value!=='boolean')fail();}
}
