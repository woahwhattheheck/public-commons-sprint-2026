// MIT. Complete source-owned Soroban event workspace and retained-file tools.
import {TOOL_PREFIX,ALIAS,SHA,MAX_REQUEST_BYTES,need,plain,exact} from '../soroban-events/contracts.mjs';
export {TOOL_PREFIX as SOROBAN_EVENTS_PREFIX} from '../soroban-events/contracts.mjs';
const alias={type:'string',pattern:ALIAS},id={type:'string',minLength:1,maxLength:160};
const hash={type:'string',pattern:SHA},revision={type:'integer',minimum:0};
const workspace={workspace:alias},capture={...workspace,captureId:id},edition={...workspace,editionId:id};
const mutation={requestId:id,expectedRevision:revision};
const exp={...workspace,exportId:hash},range={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:196608}};
const definitions=[
  ['workspaces','List configured Soroban source and receiving workspaces.',{},[],true],
  ['open','Open the original configured Soroban workspace and its retained state.',workspace,['workspace'],false],
  ['close','Drain and close the original workspace before another native interface opens it.',workspace,['workspace'],false],
  ['state','Read saved plans, captures, editions and original source exports.',workspace,['workspace'],true],
  ['plan_save','Save a complete native getEvents plan with the original request ID and revision.',
    {...workspace,...mutation,planId:id,name:{type:'string',minLength:1,maxLength:240},
      startLedger:{type:'integer',minimum:1},endLedger:{type:'integer',minimum:1},
      filters:{type:'array',items:{type:'object',additionalProperties:true}},
      pageSize:{type:'integer',minimum:1}},['workspace','requestId','expectedRevision','name'],false],
  ['capture_start','Start the saved native RPC capture; retain its original capture ID and source pages.',
    {...workspace,...mutation,planId:id},['workspace','requestId','expectedRevision','planId'],false,true],
  ['capture_resume','Resume this same retained capture and its original cursor.',
    {...capture,...mutation},['workspace','requestId','expectedRevision','captureId'],false,true],
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
  ['manifest','Read the complete original export manifest and exact native file identities.',
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
  if(schema.type==='string')return typeof value==='string'&&(schema.minLength===undefined||value.length>=schema.minLength)&&
    (schema.maxLength===undefined||value.length<=schema.maxLength)&&(!schema.pattern||new RegExp(schema.pattern).test(value));
  if(schema.type==='integer')return Number.isSafeInteger(value)&&(schema.minimum===undefined||value>=schema.minimum)&&
    (schema.maximum===undefined||value<=schema.maximum);
  if(schema.type==='array')return Array.isArray(value)&&value.every(item=>check(schema.items,item));
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
    {readOnly:item.readOnly,idempotent:true,openWorld:item.openWorld}));
}
