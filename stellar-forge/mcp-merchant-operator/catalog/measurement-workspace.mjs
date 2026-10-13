// MIT. Metadata only; the original Measurements application owns every scientific operation.
import {OPERATIONS} from '../../../products/measurement-workspace/operations.mjs';
import {MAX_RETAINED_CHUNK_BYTES} from '../retained-file-contracts.mjs';
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'},uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'},hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const bound={workspace:alias,instanceId:uuid},ro={readOnly:true,idempotent:true};
export const definitions=[
 ['workspaces','List configured original Measurements workspaces, live-instance bindings, input aliases and closed native operations.',{},[],ro],
 ['input_inspect','Read a complete host-declared original command file and return its exact SHA, operation and recovery contract.',{...bound,input:alias},['workspace','instanceId','input'],ro],
 ['read','Read one declared native GET operation. The complete original response is retained; use file_info/file_read for all bytes. Reuse requestId to retrieve the first response rather than refreshing a historical result.',{...bound,requestId:uuid,operation:{type:'string',enum:OPERATIONS.filter(x=>x.method==='GET').map(x=>x.name)},params:{type:'object',additionalProperties:true}},['workspace','instanceId','requestId','operation'],ro],
 ['execute','Dispatch the exact host-declared request file after SHA and managed-instance checks. Retains the original request before dispatch. Explicit retry is allowed only where the native operation supports exact replay; it never changes native UUIDs or scientific decisions.',{...bound,input:alias,expectedSha256:hash,requestId:uuid,retry:{type:'boolean'}},['workspace','instanceId','input','expectedSha256','requestId'],{idempotent:false}],
 ['request','Read original transport status and all attempt identities without contacting the scientific service. UNKNOWN is not failure or permission to replace a native UUID.',{...bound,requestId:uuid},['workspace','instanceId','requestId'],ro],
 ['file_info','Inspect complete retained original input, request, response or attempt metadata. Partial original response bytes remain available after interruptions.',{...bound,requestId:uuid,part:{type:'string',enum:['input','request','response','receipt','headers','error','dispatch','attempt-receipt']},attempt:uuid},['workspace','instanceId','requestId','part'],ro],
 ['file_read','Read a complete retained file in exact SHA-bound byte pages through the original descriptor reader. Continue using nextOffset; preserve raw JSON, CSV, HTML and native archive bytes.',{...bound,requestId:uuid,part:{type:'string',enum:['input','request','response','receipt','headers','error','dispatch','attempt-receipt']},attempt:uuid,expectedSha256:hash,readId:uuid,offset:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},['workspace','instanceId','requestId','part','expectedSha256'],ro],
 ['file_release','Close an existing file snapshot only. Leaves the original workspace, child process and retained files untouched.',{...bound,readId:uuid},['workspace','instanceId','readId'],{idempotent:true}]
];
export function measurementWorkspaceTools(tool){return definitions.map(([suffix,description,properties,required,annotations])=>tool('merchant_measurement_'+suffix,description,properties,required,annotations));}
export function validateArguments(name,args){
 const definition=definitions.find(x=>'merchant_measurement_'+x[0]===name);
 if(!definition)throw Object.assign(new Error('Choose an advertised Measurements tool.'),{code:'TOOL_NOT_FOUND'});
 const bad=message=>{throw Object.assign(new TypeError(message),{code:'INVALID_PARAMS'});};
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(definition[2],k))||definition[3].some(k=>!Object.hasOwn(args,k)))bad('Use all required and only declared tool fields.');
 for(const [key,value]of Object.entries(args)){
  const s=definition[2][key];
  if(s.type==='string'&&(typeof value!=='string'||s.pattern&&!new RegExp(s.pattern).test(value)||s.enum&&!s.enum.includes(value))||s.type==='integer'&&(!Number.isSafeInteger(value)||value<s.minimum||value>s.maximum)||s.type==='boolean'&&typeof value!=='boolean'||s.type==='object'&&(!value||typeof value!=='object'||Array.isArray(value)))bad('Invalid '+key+'.');
 }return definition;
}
