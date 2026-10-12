// MIT. The native GridFabric operator contract, with original request semantics.
export const GRIDFABRIC_CONNECTION_SCHEMA='stellar-forge.gridfabric-workspace-connection.v1';
export const GRIDFABRIC_SDK_SCHEMA='stellar-forge.gridfabric-sdk.v1';
export const GRIDFABRIC_TABLES=Object.freeze(['instances','instance_editions','sources','source_rows','source_issues','mappings',
  'callbacks','callback_deliveries','events','event_revisions','distributions','opt_decisions','device_actions',
  'reports','report_rows','management_operations','management_receipts','operations']);
export const GRIDFABRIC_HOST_TABLES=Object.freeze(['host_files','host_dispatches']);
export const GRIDFABRIC_ACTIONS=Object.freeze(['configure_instance','import_source','save_mapping','activate_mapping','record_opt_decision',
  'build_report','reconcile_distribution','prepare_management','begin_management','finish_management','reconcile_management',
  'begin_device_action','finish_device_action','reconcile_device_action','recover_dispatches','project_event_history','resume_event_callback']);
export const SHA256=/^[a-f0-9]{64}$/;
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export class GridFabricClientError extends Error {
  constructor(code,message,details={}){super(message);this.name='GridFabricClientError';this.code=code;this.details=details;Object.assign(this,details);}
}
export function need(value,code,message,details={}){if(!value)throw new GridFabricClientError(code,message,details);}
export function exact(value,allowed,required=[]) {
  need(plain(value),'GRIDFABRIC_SDK_INPUT','Supply the original named input object.');
  need(Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key)),
    'GRIDFABRIC_SDK_INPUT','Supply exactly the declared original fields.',{allowed,required});
  return value;
}
export function jsonPayload(value) {
  const seen=new Set();
  const visit=(item,path)=>{
    if(item===null||typeof item==='string'||typeof item==='boolean')return;
    if(typeof item==='number'&&Number.isFinite(item))return;
    need(Array.isArray(item)||plain(item),'GRIDFABRIC_SDK_INPUT','Use original JSON values at '+path+'.');
    need(!seen.has(item),'GRIDFABRIC_SDK_INPUT','Circular input at '+path+'.');
    if(!Array.isArray(item))need([Object.prototype,null].includes(Object.getPrototypeOf(item)),
      'GRIDFABRIC_SDK_INPUT','Use a plain original JSON object at '+path+'.');
    seen.add(item);
    if(Array.isArray(item))for(let i=0;i<item.length;i++)visit(item[i],path+'['+i+']');
    else for(const [key,entry]of Object.entries(item))visit(entry,path+'.'+key);
    seen.delete(item);
  };
  visit(value,'input');return value;
}
export function gridFabricFileId(value) {
  need(typeof value==='string','GRIDFABRIC_FILE_ID','Select a complete original file or export identity.');
  if(SHA256.test(value))value='file_'+value;
  const match=/^(file|export)_(.+)$/.exec(value);
  need(match&&(match[1]==='file'?SHA256:UUID).test(match[2]),'GRIDFABRIC_FILE_ID','Use file_SHA256 or export_UUID.');
  return {fileId:value,kind:match[1],id:match[2]};
}
const string={type:'string',minLength:1},integer={type:'integer',minimum:0},uuid={...string,pattern:UUID.source};
const object={type:'object'},read={readOnlyHint:true,destructiveHint:false,openWorldHint:false};
const write={readOnlyHint:false,destructiveHint:false,openWorldHint:false};
const schema=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const pageProperties={collection:{enum:GRIDFABRIC_TABLES},offset:integer,limit:{type:'integer',minimum:1,maximum:1000},
  scope:string,tag:string,gte:string,lt:string,order:{enum:['asc','desc']}};
const result={};
function entry(name,description,method,path,properties={},required=Object.keys(properties),other={}) {
  result[name]=Object.freeze({operation:name,description,method,path,inputSchema:schema(properties,required),
    mutating:method==='POST',annotations:method==='POST'?write:read,...other});
}
entry('launch','Inspect the authenticated original operator, workspace and exact native source.','GET','/api/launch');
entry('state','Read the original workspace revision and all native collection counts.','GET','/api/state');
entry('source','Read the complete original native module identities.','GET','/api/source');
entry('contracts','Read the complete retained first-party Plaid contract and original examples.','GET','/api/contracts');
entry('page','Read one original domain page; follow next_offset until null.','GET','/api/page',pageProperties,['collection']);
entry('host_page','Read one original host file or dispatch page.','GET','/api/host/page',
  {...pageProperties,collection:{enum:GRIDFABRIC_HOST_TABLES}},['collection']);
entry('detail','Read a complete original domain record.','GET','/api/detail',
  {collection:{enum:GRIDFABRIC_TABLES},id:string});
entry('operation','Recover the original action and host dispatch by the caller-retained UUID.','GET','/api/operation',{request_id:uuid});
entry('exports','List the original complete and pending portable exports.','GET','/api/exports');
entry('restore_status','Read the original sibling workspace receiving result.','GET','/api/restore-status',
  {name:{...string,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$'},sha256:{...string,pattern:SHA256.source}},['name']);
for(const action of GRIDFABRIC_ACTIONS)entry(action,
  'Apply original '+action+' with the retained request UUID, reviewed workspace revision and complete native input.',
  'POST','/api/action',{request_id:uuid,expected_revision:integer,input:object},undefined,{action});
entry('dispatch_management','Dispatch or recover the exact original reviewed management operation through the existing host.',
  'POST','/api/dispatch/management',{request_id:uuid,expected_revision:integer,
    input:schema({operation_id:string})},undefined,{annotations:{...write,openWorldHint:true},dispatch:'management'});
entry('dispatch_device','Dispatch or recover the exact original reviewed device action through the existing host.',
  'POST','/api/dispatch/device',{request_id:uuid,expected_revision:integer,
    input:schema({device_action_id:string})},undefined,{annotations:{...write,openWorldHint:true},dispatch:'device'});
entry('export','Prepare or recover the original complete portable export at the selected revision.',
  'POST','/api/export',{request_id:uuid,expected_revision:integer});
export const gridFabricOperations=Object.freeze(result);
export const gridFabricToolName=operation=>'merchant_gridfabric_'+operation;
export function validateGridFabricOperation(operation,payload={}) {
  const definition=gridFabricOperations[operation];
  need(definition,'GRIDFABRIC_SDK_OPERATION','Choose an original GridFabric operation.');
  jsonPayload(payload);exact(payload,Object.keys(definition.inputSchema.properties),definition.inputSchema.required);
  for(const [name,value]of Object.entries(payload)) {
    const rule=definition.inputSchema.properties[name];
    if(rule.type==='string')need(typeof value==='string'&&value.length>0&&(!rule.pattern||new RegExp(rule.pattern).test(value)),
      'GRIDFABRIC_SDK_INPUT','Invalid original '+name+'.');
    if(rule.type==='integer')need(Number.isSafeInteger(value)&&value>=rule.minimum&&(rule.maximum===undefined||value<=rule.maximum),
      'GRIDFABRIC_SDK_INPUT','Invalid original '+name+'.');
    if(rule.type==='object')need(plain(value),'GRIDFABRIC_SDK_INPUT','Keep the complete original '+name+' object.');
    if(rule.enum)need(rule.enum.includes(value),'GRIDFABRIC_SDK_INPUT','Choose an original '+name+'.');
  }
  if(definition.dispatch) {
    const id=definition.dispatch==='management'?'operation_id':'device_action_id';
    exact(payload.input,[id],[id]);need(typeof payload.input[id]==='string'&&payload.input[id].length>0,
      'GRIDFABRIC_SDK_INPUT','Select the original dispatch identity.');
  }
  if(operation==='restore_status')need(!['.','..'].includes(payload.name),'GRIDFABRIC_SDK_INPUT','Select a sibling receiving name.');
  return {definition,payload};
}
