// SPDX-License-Identifier: MIT
// Read-only source admission around original MCP/SF88 custody. No buyer command runs here.
import {createHash} from 'node:crypto';
import {isAbsolute,resolve,join} from 'node:path';
import {readdir} from 'node:fs/promises';
import {openQueue} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue.mjs';
import {initializationBytes as bytes,initializationDirectory as directory,retainInitializationRecord as retainRecord} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {need} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';
import {nativeSourceOperations} from './native-analysis-sources-schema.mjs';
export {nativeSourceOperations};

export const NATIVE_SOURCE='stellar-forge.mcp-native-saved-source.v1';
const HASH=/^[a-f0-9]{64}$/,IDENTIFIER=/^[A-Za-z0-9._:-]{1,128}$/;
const NAME=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const sha=value=>createHash('sha256').update(value).digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function path(value){
  need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&value!=='/'&&!value.includes('\0'),
    'MCP_ANALYSIS_PRIVATE_PATH_REQUIRED');return value;
}

/** Capture the actual original private metadata bytes; paths never come from model arguments. */
export async function nativeSourceFiles(specifications){
  need(Array.isArray(specifications)&&specifications.length>0&&specifications.length<=24,
    'MCP_NATIVE_SOURCE_INPUTS_INVALID');
  const result=[],roles=new Set();
  for(const {role,path:location,maxBytes=2097152} of specifications){
    need(typeof role==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(role)&&!roles.has(role)&&
      Number.isSafeInteger(maxBytes)&&maxBytes>0&&maxBytes<=8388608,'MCP_NATIVE_SOURCE_INPUTS_INVALID');
    roles.add(role);
    const raw=await bytes(path(location),maxBytes);
    result.push({role,path:location,bytes:raw.length,sha256:sha(raw)});
  }
  return result;
}
export async function checkNativeSourceFiles(inputs){
  for(const input of inputs){
    const raw=await bytes(input.path,Math.max(1,input.bytes));
    need(raw.length===input.bytes&&sha(raw)===input.sha256,'MCP_NATIVE_SAVED_SOURCE_CHANGED');
  }
}
/** Separate host file authority from the portable original-record identity. */
export function sealNativeSource(record,inputs){
  need(record?.schema===NATIVE_SOURCE&&['object','response'].includes(record.kind)&&IDENTIFIER.test(record.id??'')&&
    object(record.original)&&object(record.file)&&HASH.test(record.file.sha256??'')&&
    Number.isSafeInteger(record.file.bytes)&&record.file.bytes>=0,'MCP_NATIVE_SAVED_SOURCE_INVALID');
  path(record.nativeWorkspace);path(record.file.destination);
  const sourceBinding={schema:NATIVE_SOURCE,kind:record.kind,id:record.id,
    original:record.original,retainedFile:{bytes:record.file.bytes,sha256:record.file.sha256,
      contentType:record.file.contentType??null},
    inputFiles:inputs.map(({role,bytes,sha256})=>({role,bytes,sha256}))};
  return {...record,inputs,sourceBinding,sourceBindingSha256:sha(Buffer.from(canonical(sourceBinding)))};
}

const INBOX_SOURCE='stellar-forge.mcp-native-source-inbox.v1';
function inboxName(value){need(typeof value==='string'&&NAME.test(value),'MCP_NATIVE_SOURCE_INBOX_ALIAS_REQUIRED');return value;}
const inboxesRoot=manifest=>join(path(manifest.directory),'analysis-source-inboxes');
async function registeredInbox(manifest,alias){
  const folder=inboxesRoot(manifest),selected=inboxName(alias);
  await directory(folder);
  const location=join(folder,selected+'.json'),raw=await bytes(location,65536),record=JSON.parse(raw);
  need(record?.schema===INBOX_SOURCE&&record.name===selected&&record.nativeWorkspace===manifest.directory&&
    HASH.test(record.inboxManifestSha256??''),'MCP_NATIVE_SOURCE_INBOX_CHANGED');
  path(record.inbox);
  return {location,record};
}
/** Host-only grant to an EXISTING original inbox. It never copies or enqueues its requests. */
export async function registerNativeSourceInbox(manifest,{name,inbox}={}){
  inboxName(name);path(inbox);
  const queue=await openQueue(inbox),header=await bytes(join(queue.root,'inbox.json'),65536);
  await directory(inboxesRoot(manifest),{create:true});
  const record={schema:INBOX_SOURCE,name,nativeWorkspace:manifest.directory,inbox:queue.root,
    inboxManifestSha256:sha(header)};
  await retainRecord(join(inboxesRoot(manifest),name+'.json'),record,{resume:true});
  await selectedNativeSourceInbox(manifest,name);
  return {schema:INBOX_SOURCE,status:'ORIGINAL_READ_ONLY_INBOX_REGISTERED',name,
    inboxManifestSha256:record.inboxManifestSha256};
}
export async function selectedNativeSourceInbox(manifest,alias){
  if(alias===undefined||alias===null){
    const queue=await openQueue(join(path(manifest.directory),'inbox'));
    return {queue,alias:null,inputs:[{role:'inbox-manifest',path:join(queue.root,'inbox.json'),maxBytes:65536}]};
  }
  const {location,record}=await registeredInbox(manifest,alias),queue=await openQueue(record.inbox);
  const raw=await bytes(join(queue.root,'inbox.json'),65536);
  need(sha(raw)===record.inboxManifestSha256,'MCP_NATIVE_SOURCE_INBOX_CHANGED');
  return {queue,alias:record.name,inputs:[
    {role:'inbox-registration',path:location,maxBytes:65536},
    {role:'inbox-manifest',path:join(queue.root,'inbox.json'),maxBytes:65536},
  ]};
}
async function listInboxes(manifest){
  const folder=inboxesRoot(manifest);
  try{await directory(folder);}catch(error){if(error.code==='ENOENT')return {inboxes:[]};throw error;}
  const files=(await readdir(folder)).filter(value=>value.endsWith('.json')&&NAME.test(value.slice(0,-5))).sort();
  need(files.length<=1000,'MCP_NATIVE_SOURCE_INBOX_LIST_LIMIT');
  const inboxes=[];
  for(const file of files){
    const {record}=await registeredInbox(manifest,file.slice(0,-5));
    inboxes.push({name:record.name,inboxManifestSha256:record.inboxManifestSha256});
  }
  return {inboxes};
}
async function savedResponses(manifest,body){
  const {queue,alias}=await selectedNativeSourceInbox(manifest,body.inbox_alias);
  const offset=body.offset??0,limit=body.limit??25;
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,
    'MCP_NATIVE_SOURCE_PAGE_INVALID');
  const all=await queue.list();
  need(offset<=all.length,'MCP_NATIVE_SOURCE_PAGE_INVALID');
  const records=all.slice(offset,offset+limit).map(record=>{
    const native=record.outcome,file=native?.responseFile;
    return {intentId:record.operation.intentId,state:record.state,configurationSha256:record.configSha256,
      sourceConfigurationSha256:record.sourceConfigSha256,nativeStatus:native?.status??null,
      paymentStatus:native?.paymentStatus??null,httpStatus:native?.httpStatus??null,
      file:{status:file?.status??'NOT_SAVED',bytes:file?.bytes??null,sha256:file?.sha256??null,
        contentType:file?.contentType??null},attachable:file?.status==='SAVED'};
  });
  return {inbox_alias:alias,records,total:all.length,nextOffset:offset+records.length<all.length?offset+records.length:null};
}

/** Python's independent admission uses the same read-only native host and original validators. */
export async function inspectNativeAnalysisSource({nativeWorkspace,kind,id,inboxAlias}={}){
  path(nativeWorkspace);
  need(['object','response'].includes(kind)&&IDENTIFIER.test(id??''),'MCP_NATIVE_SOURCE_SELECTION_REQUIRED');
  const {openNativeWorkspace}=await import('./native-workspace.mjs');
  const native=await openNativeWorkspace(nativeWorkspace);
  try{return kind==='object'?await native.completedObject(id):await native.completedResponse(id,{inboxAlias});}
  finally{await native.close();}
}
function publicSource(source){
  need(object(source),'MCP_ANALYSIS_SOURCE_REPLY_INVALID');
  const {paths,session,room,config,result,manifest,stream,stream_export,sourceDirectory,...record}=source;
  return record;
}
export function createNativeSourceActions({manifest,completedObject,completedResponse}={}){
  need(object(manifest),'MCP_ANALYSIS_NATIVE_WORKSPACE_REQUIRED');
  return {
    handles:operation=>Object.hasOwn(nativeSourceOperations,operation),
    async call({operation,body,post}){
      if(operation==='response-inboxes')return listInboxes(manifest);
      if(operation==='saved-responses')return savedResponses(manifest,body);
      const kind=operation==='attach-object'?'object':'response';
      need(Object.hasOwn(nativeSourceOperations,operation)&&object(body)&&NAME.test(body.name??'')&&
        Number.isSafeInteger(body.expected_revision)&&body.expected_revision>=0,
        'MCP_NATIVE_SOURCE_SELECTION_REQUIRED');
      const identifier=kind==='object'?body.acquisition_id:body.intent_id;
      const formats=kind==='object'?['json','csv']:['json','csv','ndjson','sse'];
      need(IDENTIFIER.test(identifier??'')&&formats.includes(body.format),'MCP_NATIVE_SOURCE_FORMAT_REQUIRED');
      const select=kind==='object'?completedObject:completedResponse;
      need(typeof select==='function','MCP_ANALYSIS_ORIGINAL_SOURCE_ADAPTER_REQUIRED');
      const original=await select(identifier,kind==='response'?{inboxAlias:body.inbox_alias}:undefined);
      need(original.schema===NATIVE_SOURCE&&original.kind===kind&&original.id===identifier&&
        original.nativeWorkspace===manifest.directory&&HASH.test(original.sourceBindingSha256??''),
        'MCP_NATIVE_SOURCE_SELECTION_CHANGED');
      const source=await post('/api/native-response-source',{name:body.name,format:body.format,
        expected_revision:body.expected_revision,native_workspace:manifest.directory,
        native_kind:kind,native_id:identifier,native_inbox:body.inbox_alias??null,expected_native:original.sourceBindingSha256});
      need(source.native_source?.sha256===original.sourceBindingSha256,
        'MCP_ANALYSIS_NATIVE_SOURCE_REPLY_CHANGED');
      return publicSource(source);
    },
  };
}

