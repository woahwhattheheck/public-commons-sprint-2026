// MIT. Complete source-owned Soroban event workspace and retained-file tools.
import {TOOL_PREFIX,ALIAS,NATIVE_ALIAS,SHA,MAX_REQUEST_BYTES,need,plain,exact} from '../soroban-events/contracts.mjs';
export {TOOL_PREFIX as SOROBAN_EVENTS_PREFIX} from '../soroban-events/contracts.mjs';
const alias={type:'string',pattern:ALIAS},id={type:'string',minLength:1,maxLength:160};
const connectionAlias={type:'string',pattern:NATIVE_ALIAS};
const hash={type:'string',pattern:SHA},revision={type:'integer',minimum:0};
const workspace={workspace:alias},capture={...workspace,captureId:id},edition={...workspace,editionId:id};
const mutation={requestId:id,expectedRevision:revision};
const watch={...workspace,watchId:id},ledger={type:['integer','null'],minimum:1,maximum:4294967295};
const watchConfig={name:{type:'string',minLength:1,maxLength:200},planVersion:{type:'integer',minimum:1},
  endLedger:{type:['integer','null'],minimum:2,maximum:4294967296},windowLedgers:{type:'integer',minimum:1,maximum:1000000},
  pollIntervalMs:{type:'integer',minimum:1000,maximum:86400000},connectionAlias,
  recoveryConnectionAlias:{...connectionAlias,type:['string','null']},publication:{...alias,type:['string','null']}};
const exp={...workspace,exportId:hash},range={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:196608}};
const definitions=[
  ['workspaces','List configured Soroban source and receiving workspaces.',{},[],true],
  ['open','Open the original configured Soroban workspace and resume its retained running watches.',workspace,['workspace'],false,true],
  ['close','Drain and close the original workspace before another native interface opens it.',workspace,['workspace'],false],
  ['state','Read saved plans, captures, editions and original source exports.',workspace,['workspace'],true],
  ['plan_save','Save a complete native getEvents plan with the original request ID and revision.',
    {...workspace,...mutation,planId:id,name:{type:'string',minLength:1,maxLength:240},
      startLedger:{type:['integer','null'],minimum:1},endLedger:{type:['integer','null'],minimum:1},
      filters:{type:'array',items:{type:'object',additionalProperties:true}},
      pageSize:{type:'integer',minimum:1}},['workspace','requestId','expectedRevision','name'],false],
  ['capture_start','Start the saved native RPC capture; retain its original capture ID and source pages.',
    {...workspace,...mutation,planId:id},['workspace','requestId','expectedRevision','planId'],false,true],
  ['capture_resume','Resume this same retained capture and its original cursor.',
    {...capture,...mutation,connectionAlias},['workspace','requestId','expectedRevision','captureId'],false,true],
  ['capture_status','Read original capture status, page counts, frontier and returned errors.',
    capture,['workspace','captureId'],true],
  ['events','Read complete original RPC event objects from the selected capture page.',
    {...capture,after:{type:'string'},limit:{type:'integer',minimum:1},
      contractId:{type:'string'},type:{type:'string'}},['workspace','captureId'],true],
  ['edition_create','Freeze a completed native capture as one reusable event-data edition.',
    {...capture,...mutation,name:{type:'string',minLength:1,maxLength:240}},
    ['workspace','requestId','expectedRevision','captureId','name'],false],
  ['edition','Read the selected edition and its original source identity.',
    edition,['workspace','editionId'],true],
  ['source_export','Retain the full original source export, including exact RPC exchange bodies and events.',
    {...edition,...mutation},['workspace','requestId','expectedRevision','editionId'],false],
  ['publisher_source','Select the existing edition file for the original dataset publisher.',
    edition,['workspace','editionId'],true],
  ['watch_state','Read recurring watches, original watch exports and trusted connection aliases; this revision belongs to watches.',
    workspace,['workspace'],true],
  ['watch_status','Read the exact recurring watch, native window progress, retained cursor and returned source error.',
    watch,['workspace','watchId'],true],
  ['watch_save','Save a recurring native event watch from a saved plan; publication selects a configured host alias.',
    {...workspace,...mutation,...watchConfig,planId:id,startLedger:ledger},
    ['workspace','requestId','expectedRevision','name','planId'],false],
  ['watch_configure','Configure the next original watch windows using the current watch revision and trusted aliases.',
    {...watch,...mutation,...watchConfig},['workspace','watchId','requestId','expectedRevision'],false],
  ['watch_start','Enable and run the original recurring watch on this maintained Merchant host.',
    {...watch,...mutation},['workspace','watchId','requestId','expectedRevision'],false,true],
  ['watch_pause','Pause the watch; its current native source window drains before the next window stops.',
    {...watch,...mutation},['workspace','watchId','requestId','expectedRevision'],false],
  ['watch_run','Catch up a finite number of native watch windows; busy reports an existing original runner.',
    {...watch,maxWindows:{type:'integer',minimum:1,maximum:1000}},['workspace','watchId'],false,true],
  ['watch_repair','Repair a retention gap using retained original editions or a trusted recovery connection alias.',
    {...watch,...mutation,editionIds:{type:'array',items:id,maxItems:10000},recoveryConnectionAlias:connectionAlias},
    ['workspace','watchId','requestId','expectedRevision'],false],
  ['watch_export','Export the complete original watch, native source windows, cursor, editions and publication source.',
    {...watch,...mutation},['workspace','watchId','requestId','expectedRevision'],false],
  ['watch_receive','Receive the exact native watch into a configured workspace in PAUSED state with local trusted aliases.',
    {...workspace,exportId:hash,...mutation,receiver:alias,expectedManifestSha256:hash,
      connectionAlias,recoveryConnectionAlias:connectionAlias,publication:alias},
    ['workspace','exportId','receiver','expectedManifestSha256','requestId','expectedRevision'],false],
  ['manifest','Read the complete original edition or watch export manifest and exact native file identities.',
    exp,['workspace','exportId'],true],
  ['file','Read an exact hash-bound range of an original export file or manifest.',
    {...exp,file:{type:'string',minLength:1,maxLength:4096},expectedManifestSha256:hash,expectedSha256:hash,
      ...range,readId:{type:'string'}},['workspace','exportId','file','expectedManifestSha256','expectedSha256'],true],
  ['file_release','Release the original retained file descriptor after a completed or interrupted read.',
    {...exp,readId:{type:'string'}},['workspace','exportId','readId'],false],
  ['json','Browse the selected original JSON file; full bytes remain available through file download.',
    {...exp,file:{type:'string',minLength:1,maxLength:4096},expectedManifestSha256:hash,
      pointer:{type:'string',maxLength:4096},offset:{type:'integer',minimum:0},
      limit:{type:'integer',minimum:1,maximum:1000}},['workspace','exportId','file','expectedManifestSha256'],true],
  ['receive','Receive the exact source export into a configured receiving workspace; keep its original IDs.',
    {...exp,...mutation,receiver:alias,expectedManifestSha256:hash},
    ['workspace','exportId','receiver','expectedManifestSha256','requestId','expectedRevision'],false]
];
export const sorobanEventsDefinitions=Object.freeze(definitions.map(([name,description,properties,required,readOnly,openWorld=false])=>
  Object.freeze({name:TOOL_PREFIX+name,action:name,description,properties,required,readOnly,openWorld})));
function check(schema,value){
  if(Array.isArray(schema.type))return schema.type.some(type=>check({...schema,type},value));
  if(schema.type==='null')return value===null;
  if(schema.type==='string')return typeof value==='string'&&(schema.minLength===undefined||value.length>=schema.minLength)&&
    (schema.maxLength===undefined||value.length<=schema.maxLength)&&(!schema.pattern||new RegExp(schema.pattern).test(value));
  if(schema.type==='integer')return Number.isSafeInteger(value)&&(schema.minimum===undefined||value>=schema.minimum)&&
    (schema.maximum===undefined||value<=schema.maximum);
  if(schema.type==='array')return Array.isArray(value)&&(schema.minItems===undefined||value.length>=schema.minItems)&&
    (schema.maxItems===undefined||value.length<=schema.maxItems)&&value.every(item=>check(schema.items,item));
  if(schema.type==='object')return plain(value);
  return false;
}
export function validateSorobanEventsArguments(name,args={}){
  need(typeof name==='string','SOROBAN_EVENTS_UNKNOWN_TOOL');
  const action=name.startsWith(TOOL_PREFIX)?name.slice(TOOL_PREFIX.length):name;
  const definition=sorobanEventsDefinitions.find(item=>item.action===action);
  need(definition,'SOROBAN_EVENTS_UNKNOWN_TOOL','Choose a declared Soroban event operation.');
  exact(args,Object.keys(definition.properties),definition.required);
  for(const [key,value]of Object.entries(args))need(check(definition.properties[key],value),
    'SOROBAN_EVENTS_INVALID_PARAMS','Invalid Soroban event argument: '+key+'.');
  need(Buffer.byteLength(JSON.stringify(args))<=MAX_REQUEST_BYTES,'SOROBAN_EVENTS_REQUEST_TOO_LARGE');
  return action;
}
export function sorobanEventsTools(tool){
  return sorobanEventsDefinitions.map(item=>tool(item.name,item.description,item.properties,item.required,
    {readOnly:item.readOnly,idempotent:item.action!=='watch_run',openWorld:item.openWorld}));
}
