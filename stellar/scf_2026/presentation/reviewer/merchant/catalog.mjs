// MIT. Metadata only; original workbench and Buyer are loaded by the provider.
import {TOOL_PREFIX, UUID, SHA, ALIAS, MAX_PACKET_BYTES, MAX_RETAINED_CHUNK_BYTES, need, plain} from './contracts.mjs';
const str = (description, extra = {}) => ({type:'string', description, ...extra});
const alias = str('Original host-declared reviewer workspace alias.', {pattern:ALIAS});
const uuid = str('Exact retained UUID.', {pattern:UUID});
const sha = str('Exact original SHA256.', {pattern:SHA});
const uint = (description, maximum, minimum = 0) => ({type:'integer',description,minimum,maximum});
const ws = {workspace:alias}, action = {...ws,requestId:uuid};
const selection = {...ws,selectionId:uuid};
const change = {...selection,expectedRevision:uint('Reviewed original selection revision.',Number.MAX_SAFE_INTEGER,1),requestId:uuid};
const exp = {...ws,exportId:sha};
const definitions = [];
function tool(name, description, properties, required, mutates = false) {
  definitions.push(Object.freeze({name:TOOL_PREFIX+name,description,
    inputSchema:{type:'object',properties,required,additionalProperties:false},
    annotations:{readOnlyHint:!mutates,destructiveHint:false,idempotentHint:true,openWorldHint:false}}));
}
tool('workspaces','List configured original workbenches and current borrowing/ownership facts. Does not launch anything.',{},[]);
tool('schema','Read the complete provider and original reviewer operation contract, including private-code and close/export behavior.',{},[]);
tool('workbench_open','Explicitly connect to a running original workbench, or start its existing source only when the host configuration permits. Returns current identity without a private access code.',ws,['workspace'],true);
tool('workbench_release','Drain and close only a workbench owned by this merchant. A borrowed Applications workbench remains running.',ws,['workspace'],true);
tool('state','Retain the complete current workbench snapshot, selections and original action history as a downloadable file.',ws,['workspace']);
tool('selection','Inspect the exact original packet and its received state. A live Buyer remains under its original owner.',selection,['workspace','selectionId']);
tool('action','Read the original saved action by UUID after a lost response. Its durable outcome and current live Buyer are separate fields.',action,['workspace','requestId']);
tool('review','Review the bundled packet, a host-declared input, complete uploaded original bytes, or an original workbench export. The same request UUID and exact inputs recover the same selection.',
  {...action,source:{type:'string',enum:['bundled','host','upload','export']},title:str('Original display title.',{minLength:1,maxLength:180}),
    hostInput:str('Declared original input alias.',{pattern:ALIAS}),base64:str('Complete canonical base64 packet bytes.',{maxLength:Math.ceil(MAX_PACKET_BYTES/3)*4}),
    expectedSha256:sha,exportActionId:uuid},['workspace','requestId','source','title'],true);
tool('receive','Receive the reviewed packet through its original native Buyer stores. Retain selection revision and request UUID.',change,['workspace','selectionId','expectedRevision','requestId'],true);
tool('buyer_open','Open the selected received original Buyer. No signer, purchase, discovery or provider call is connected.',change,['workspace','selectionId','expectedRevision','requestId'],true);
tool('buyer_close','Drain and close the original Buyer through its workbench owner. The controller remains available for export and reopen.',action,['workspace','requestId'],true);
tool('buyer_read','Call only the original saved-history/result/status MCP tools. The complete original structured response is retained as a file.',
  {...ws,tool:{type:'string',enum:['bazaar_history','bazaar_results','bazaar_status','bazaar_read_result']},
    arguments:{type:'object',additionalProperties:true}},['workspace','tool']);
tool('buyer_result','Read every original result byte through the maintained Buyer range API, verify its complete SHA and retain the unchanged native result JSON.',
  {...ws,quoteId:str('Original quote ID from this packet.',{minLength:1,maxLength:180})},['workspace','quoteId']);
tool('document','Retain a complete original source document from the selected packet, with its original bytes, MIME type and SHA.',
  {...selection,index:uint('Original zero-based document index.',127)},['workspace','selectionId','index']);
tool('export','Close and drain the original Buyer before exporting its complete packet/history/results. An accepted original export is reconciled before current mutable history is read.',
  change,['workspace','selectionId','expectedRevision','requestId'],true);
tool('review_export','Review a complete retained reviewer packet from another declared workspace in the same host. The original source export and destination request UUID remain pinned.',
  {...action,sourceWorkspace:alias,exportId:sha,expectedManifestSha256:sha,title:str('Destination review title.',{minLength:1,maxLength:180})},
  ['workspace','sourceWorkspace','exportId','expectedManifestSha256','title','requestId'],true);
tool('manifest','Inspect a complete retained file export. Use its manifest identity for every resumed download.',exp,['workspace','exportId']);
tool('file','Read an exact range of an original retained file through the maintained immutable-file reader.',
  {...exp,file:str('Original manifest filename.',{minLength:1,maxLength:240}),expectedManifestSha256:sha,expectedSha256:sha,
    offset:uint('Original byte offset.',Number.MAX_SAFE_INTEGER),limit:uint('Maximum bytes in this chunk.',MAX_RETAINED_CHUNK_BYTES,1),readId:uuid},
  ['workspace','exportId','file','expectedManifestSha256','expectedSha256']);
tool('file_release','Close this export’s original retained read handle. Other exports and workbench owners are unchanged.',
  {...exp,readId:uuid},['workspace','exportId','readId']);
tool('json','Page a selected original JSON value from a complete immutable export. Full file download remains available.',
  {...exp,file:str('Original JSON filename.',{minLength:1,maxLength:240}),expectedManifestSha256:sha,
    pointer:str('RFC6901 pointer within the exact retained JSON.',{maxLength:4000}),
    offset:uint('Original array/object/string position.',Number.MAX_SAFE_INTEGER),
    limit:uint('Maximum array items, object entries or string characters.',200,1)},
  ['workspace','exportId','file','expectedManifestSha256']);
export const reviewerMerchantTools = Object.freeze(definitions);
export const reviewerActions = Object.freeze(Object.fromEntries(definitions.map(d=>[d.name.slice(TOOL_PREFIX.length),d])));
function valid(value, rule) {
  if (rule.type==='object') {
    if (!plain(value)) return false;
    if (!rule.properties) return true;
    return (rule.required??[]).every(k=>Object.hasOwn(value,k)) &&
      Object.keys(value).every(k=>rule.additionalProperties!==false || Object.hasOwn(rule.properties,k)) &&
      Object.entries(value).every(([k,v])=>!rule.properties[k] || valid(v,rule.properties[k]));
  }
  if (rule.type==='integer') return Number.isSafeInteger(value) && value>=(rule.minimum??-Infinity) && value<=(rule.maximum??Infinity);
  if (rule.type==='string') return typeof value==='string' && value.length>=(rule.minLength??0) &&
    value.length<=(rule.maxLength??Infinity) && (!rule.pattern || new RegExp(rule.pattern).test(value)) &&
    (!rule.enum || rule.enum.includes(value));
  return true;
}
export function validateReviewerArguments(name,args) {
  const action=name.startsWith(TOOL_PREFIX)?name.slice(TOOL_PREFIX.length):name;
  const definition=reviewerActions[action];
  need(definition && valid(args,definition.inputSchema),'GRANT_REVIEWER_INPUT_INVALID',
    'Use the exact '+(definition?.name??'reviewer')+' input schema.');
  return action;
}
