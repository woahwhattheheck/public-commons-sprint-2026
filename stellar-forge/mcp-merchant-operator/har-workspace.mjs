// MIT. Original retained HAR source and merchant work through the existing SF61 console.
import { constants as C } from 'node:fs';
import { open, lstat, mkdir, readdir, realpath, link, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { openWorkspace, readRevision, readRegular } from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/har/store.mjs';
import { openRefresh } from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/har/refresh.mjs';
import { canonical } from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/har/model.mjs';
import { mergeHarMerchantPlan } from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/har/browser.mjs';
import { readPackage, packageName } from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/model.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { HAR_EXPORT_SCHEMA, HAR_EXPORT_MANIFEST, HAR_EXPORT_MAX_BYTES, HAR_EXPORT_FILES,
  harExportIdentity, parseHarExport } from './har-export.mjs';

export const HAR_WORKSPACE_CONNECTION_SCHEMA='stellar-forge.har-workspace-connection.v1';
const SHA=/^[a-f0-9]{64}$/, ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/, UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_CAPTURE=128*1024*1024, MAX_DECISIONS=4*1024*1024, MAX_REPLY=16*1024*1024, PAGE_BYTES=256*1024;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const json=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''));
const fail=(code,message)=>Object.assign(new Error(message),{code});
function exact(value,keys,required=[]) {
  if(!plain(value)||Object.keys(value).some(k=>!keys.includes(k))||required.some(k=>!Object.hasOwn(value,k)))
    throw fail('INVALID_PARAMS','Supply the declared fields and every required field.');
}
function checked(value,pattern,label) {
  if(typeof value!=='string'||!pattern.test(value))throw fail('INVALID_PARAMS','Use a valid '+label+'.');
  return value;
}
function integer(value,min,max) {
  if(!Number.isSafeInteger(value)||value<min||value>max)throw fail('INVALID_PARAMS','Integer is outside its declared range.');
  return value;
}
function label(value) {
  if(typeof value!=='string'||!value.trim()||value.length>160||/[\x00-\x1f\x7f]/.test(value))
    throw fail('INVALID_PARAMS','Use a nonempty printable label of up to 160 characters.');
  return value.trim();
}
function selected(value,required=false) {
  exact(value,['kind','id','revision'],['kind','id']);
  if(!['capture','refresh'].includes(value.kind))throw fail('INVALID_PARAMS','Choose a capture or refresh selection.');
  checked(value.id,SHA,'retained source identity');
  if(value.revision!==undefined||required)checked(value.revision,SHA,'saved review revision');
  return {kind:value.kind,id:value.id,...(value.revision?{revision:value.revision}:{})};
}
function hostPath(value,base) {
  if(typeof value!=='string'||!value||value.includes('\0'))throw fail('CONFIGURATION_ERROR','Declare the original host path.');
  return resolve(base,value);
}
async function privateDirectory(path,create=false) {
  if(create)await mkdir(path,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const info=await lstat(path);
  if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)||await realpath(path)!==path)
    throw fail('HAR_PRIVATE_DIRECTORY_REQUIRED','Use an existing canonical private directory.');
  return path;
}
async function syncDirectory(path) {const fd=await open(path,C.O_RDONLY);try{await fd.sync();}finally{await fd.close();}}
async function publish(path,bytes) {
  const temporary=path+'.'+randomUUID()+'.partial',fd=await open(temporary,C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW,0o600);
  try {
    await fd.writeFile(bytes);await fd.sync();
    try{await link(temporary,path);}
    catch(e){if(e.code!=='EEXIST'||!(await readRegular(path,HAR_EXPORT_MAX_BYTES,true)).equals(bytes))throw e;}
    await syncDirectory(dirname(path));
  } finally {await fd.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
function paged(items,input={},identity) {
  const offset=integer(input.offset??0,0,Number.MAX_SAFE_INTEGER),limit=integer(input.limit??25,1,100);
  const snapshot=hash(canonical({identity,items}));
  if(input.expectedSnapshot!==undefined&&checked(input.expectedSnapshot,SHA,'page snapshot')!==snapshot)
    throw fail('HAR_INVENTORY_CHANGED','The original inventory changed. Continue from a new first page.');
  if(offset&&!input.expectedSnapshot)throw fail('HAR_SNAPSHOT_REQUIRED','Repeat the original page snapshot.');
  if(offset>items.length)throw fail('INVALID_PARAMS','Offset exceeds this native inventory.');
  const rows=[];let size=0;
  for(const item of items.slice(offset,offset+limit)){
    const n=Buffer.byteLength(JSON.stringify(item));
    if(size+n>PAGE_BYTES) {
      if(!rows.length)throw fail('HAR_LARGE_NATIVE_ROW','Retain this complete native inventory or decision file with merchant_har_export and read its verified byte chunks.');
      break;
    }
    rows.push(item);size+=n;
  }
  return {total:items.length,snapshot,offset,items:rows,nextOffset:offset+rows.length<items.length?offset+rows.length:null};
}

/** File and directory choices belong to the host; callers select only declared aliases. */
export async function readHarWorkspaceConfiguration(path) {
  path=resolve(path);const raw=json(await readRegular(path,1024*1024,true)),base=dirname(path);
  exact(raw,['schema','workspaces'],['schema','workspaces']);
  if(raw.schema!==HAR_WORKSPACE_CONNECTION_SCHEMA||!plain(raw.workspaces)||Object.keys(raw.workspaces).length<1||Object.keys(raw.workspaces).length>32)
    throw fail('CONFIGURATION_ERROR','Declare 1–32 original HAR merchant workspaces.');
  const workspaces=Object.create(null);
  for(const [alias,input]of Object.entries(raw.workspaces)){
    checked(alias,ALIAS,'workspace alias');
    exact(input,['label','projectsDirectory','consoleUrlEnv','consoleUrlFile','files','imports','destinations'],['projectsDirectory']);
    if((input.consoleUrlEnv===undefined)===(input.consoleUrlFile===undefined))
      throw fail('CONFIGURATION_ERROR','Select one original private console URL environment or file reference.');
    const definition={label:label(input.label??alias),projectsDirectory:hostPath(input.projectsDirectory,base),
      ...(input.consoleUrlEnv===undefined?{consoleUrlFile:hostPath(input.consoleUrlFile,base)}
        :{consoleUrlEnv:checked(input.consoleUrlEnv,/^[A-Za-z_][A-Za-z0-9_]*$/,'console URL environment name')}),
      files:Object.create(null),imports:Object.create(null),destinations:Object.create(null)};
    await privateDirectory(definition.projectsDirectory);
    for(const key of ['files','imports','destinations'])
      if(input[key]!==undefined&&(!plain(input[key])||Object.keys(input[key]).length>128))
        throw fail('CONFIGURATION_ERROR','Declare up to 128 '+key+' aliases.');
    for(const [id,file]of Object.entries(input.files??{})){
      checked(id,ALIAS,'file alias');exact(file,['path','kind','label','sha256'],['path','kind']);
      if(!['capture','decisions','merchant-plan'].includes(file.kind))throw fail('CONFIGURATION_ERROR','Choose capture, decisions or merchant-plan file kind.');
      definition.files[id]={path:hostPath(file.path,base),kind:file.kind,label:label(file.label??id),
        ...(file.sha256!==undefined?{sha256:checked(file.sha256,SHA,'declared file SHA256')}:{})};
    }
    for(const [id,entry]of Object.entries(input.imports??{})){
      checked(id,ALIAS,'source directory alias');exact(entry,['directory','kind','label'],['directory','kind']);
      if(!['capture','refresh'].includes(entry.kind))throw fail('CONFIGURATION_ERROR','Import a native capture or refresh directory.');
      definition.imports[id]={directory:hostPath(entry.directory,base),kind:entry.kind,label:label(entry.label??id)};
    }
    for(const [id,entry]of Object.entries(input.destinations??{})){
      checked(id,ALIAS,'receiving directory alias');exact(entry,['directory'],['directory']);
      definition.destinations[id]={directory:hostPath(entry.directory,base)};
    }
    workspaces[alias]=definition;
  }
  return {schema:HAR_WORKSPACE_CONNECTION_SCHEMA,workspaces};
}

const alias={type:'string',pattern:ALIAS.source},digest={type:'string',pattern:SHA.source};
const selection={type:'object',properties:{kind:{type:'string',enum:['capture','refresh']},id:digest,revision:digest},required:['kind','id'],additionalProperties:false};
const scope={workspace:alias},pick={...scope,selection};
const page={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100},expectedSnapshot:digest};
const read={readOnly:true,idempotent:true};
const requestPlan={plan:{type:'object'},file:alias,expectedSha256:digest};
export function harWorkspaceTools(tool) {
  return [
    tool('merchant_har_workspaces','List declared original HAR consoles, private file/import/receiving aliases and retained read sessions.',{},[],read),
    tool('merchant_har_status','Read the authenticated original merchant console and source-library counts; reconnect a console against its declared projects directory.',scope,['workspace'],read),
    tool('merchant_har_files','List declared capture, decision and merchant-plan files, or inspect one stable file and its exact SHA256 before intake.',{...scope,file:alias},['workspace'],read),
    tool('merchant_har_library','Page the original retained captures and refresh packets; pass the returned next cursor as after.',{...scope,after:{type:'string'},limit:page.limit},['workspace'],read),
    tool('merchant_har_inspect','Read original source identity and page immutable reviews. Use changes, groups and review for their complete paged native records.',{...pick,after:digest,limit:page.limit},['workspace','selection'],read),
    tool('merchant_har_groups','Page original decoder observations from an exact retained capture. Large original rows remain available through inventory export.',{...pick,...page},['workspace','selection'],read),
    tool('merchant_har_changes','Page the complete native refresh comparison, including dormant and ambiguous source records.',{...pick,kind:{type:'string',enum:['operations','ambiguous']},...page},['workspace','selection'],read),
    tool('merchant_har_review','Read complete review metadata and page its original operations. Without revision, returns the original new draft or refresh draft.',{...pick,...page},['workspace','selection'],read),
    tool('merchant_har_ingest','Send the exact declared HAR file to the original console. Select a previous saved review to prepare a subsequent source edition.',{...scope,file:alias,expectedSha256:digest,label:{type:'string',minLength:1,maxLength:160},previous:selection},['workspace','file','expectedSha256'],{idempotent:true}),
    tool('merchant_har_adopt','Adopt an existing host-declared native capture or whole refresh directory, preserving original source and immutable reviews.',{...scope,source:alias,label:{type:'string',minLength:1,maxLength:160}},['workspace','source'],{idempotent:true}),
    tool('merchant_har_decisions_save','Save the complete native decision document as its original immutable review. Choose one inline review or declared complete decision file and its SHA256.',{...pick,review:{type:'object'},file:alias,expectedSha256:digest},['workspace','selection'],{idempotent:true}),
    tool('merchant_har_source','Read approved source binding, lineage and paged merchant operation seeds. Retain exact complete OpenAPI through export.',{...pick,...page},['workspace','selection'],read),
    tool('merchant_har_plan','Apply the browser’s original unchanged-route carry to an existing saved merchant plan. The exact prior source/review controls which prices and transport settings carry.',{...pick,packageName:{type:'string'}},['workspace','selection','packageName'],read),
    tool('merchant_har_preview','Validate exact approved source/routes and the complete reviewed merchant plan through the original authenticated preview.',{...pick,...requestPlan},['workspace','selection'],read),
    tool('merchant_har_save','Save the reviewed source and complete merchant plan through the original HAR merchant compiler. Repeated completed identical package names reopen their original output.',{...pick,...requestPlan,name:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'}},['workspace','selection','name'],{idempotent:true}),
    tool('merchant_har_packages','Page saved original merchant packages, including results recovered after an interrupted save reply.',{...scope,...page},['workspace'],read),
    tool('merchant_har_load','Reopen a saved original merchant package and reconnect its exact retained capture/review binding.',{...scope,name:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'}},['workspace','name'],read),
    tool('merchant_har_copy','Copy the complete original source and every saved review to one declared receiving directory. A completed equal copy can be reopened after an interrupted reply.',{...pick,destination:alias},['workspace','selection','destination'],{idempotent:true}),
    tool('merchant_har_receive','Adopt the complete original source selected in another declared workspace into this receiving console. Native copy includes both refresh editions and all immutable reviews.',{...scope,fromWorkspace:alias,selection,label:{type:'string',minLength:1,maxLength:160}},['workspace','fromWorkspace','selection'],{idempotent:true}),
    tool('merchant_har_export','Retain an original reviewer, inventory, decisions, draft, comparison or approved OpenAPI file once for resumable verified delivery.',{...pick,kind:{type:'string',enum:Object.keys(HAR_EXPORT_FILES)}},['workspace','selection','kind'],{idempotent:true}),
    tool('merchant_har_exports','Page complete retained HAR exports after console or MCP restart.',{...scope,...page},['workspace'],read),
    tool('merchant_har_export_manifest','Read the immutable completion manifest for one retained native HAR file.',{exportId:digest},['exportId'],read),
    tool('merchant_har_export_file','Read exact retained native bytes with the original snapshot reader. Repeat manifest SHA, file SHA, readId and nextOffset; reopen expired reads at the saved byte offset.',{exportId:digest,file:{type:'string'},expectedManifestSha256:digest,expectedSha256:digest,readId:{type:'string',pattern:UUID.source},offset:page.offset,limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},['exportId','file','expectedManifestSha256'],read),
    tool('merchant_har_export_file_release','Release one temporary native read while preserving its complete original export.',{exportId:digest,readId:{type:'string',pattern:UUID.source}},['exportId','readId'],{idempotent:true}),
  ];
}
const definitions=new Map(harWorkspaceTools((name,description,properties,required)=>({name,properties,required})).map(v=>[v.name,v]));

async function responseBytes(response,maximum) {
  const chunks=[];let size=0;
  for await(const chunk of response.body??[]){
    size+=chunk.length;if(size>maximum)throw fail('HAR_RESPONSE_TOO_LARGE','Retain the complete original file and read its byte chunks.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks,size);
}
async function inspectHandle(file,expected,maximum) {
  const fd=await open(file.path,C.O_RDONLY|C.O_NOFOLLOW|C.O_NONBLOCK);
  try {
    const before=await fd.stat();
    if(!before.isFile()||before.size<1||before.size>maximum||(before.mode&0o077))
      throw fail('HAR_PRIVATE_FILE_REQUIRED','Use a stable private regular source file within its native limit.');
    const h=createHash('sha256');let size=0;
    for await(const chunk of fd.createReadStream({autoClose:false,start:0})){size+=chunk.length;if(size>maximum)throw fail('HAR_FILE_CHANGED','The file changed while it was inspected.');h.update(chunk);}
    const sha256=h.digest('hex'),after=await fd.stat();
    if(size!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||
        expected&&sha256!==expected||file.sha256&&sha256!==file.sha256)
      throw fail('HAR_FILE_CHANGED','The original file differs from its selected SHA256 or changed during inspection.');
    return {fd,before,sha256};
  }catch(error){await fd.close();throw error;}
}
async function stableBytes(file,expected,maximum) {
  const {fd,before,sha256}=await inspectHandle(file,expected,maximum);
  try {
    const chunks=[];let size=0;
    for await(const chunk of fd.createReadStream({autoClose:false,start:0})){size+=chunk.length;if(size>maximum)throw fail('HAR_FILE_CHANGED','The selected file grew.');chunks.push(chunk);}
    const bytes=Buffer.concat(chunks,size),after=await fd.stat();
    if(size!==before.size||hash(bytes)!==sha256||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)
      throw fail('HAR_FILE_CHANGED','The selected file changed while it was read.');
    return bytes;
  }finally{await fd.close();}
}

export class MerchantHarWorkspaces {
  #config;#pending=new Set();#closing=false;#close;
  #reads=new RetainedFileReads({errorPrefix:'HAR'});
  constructor(config){this.#config=config;}
  get summary(){
    return {configured:Boolean(this.#config.harWorkspaces),...this.#reads.summary,
      workspaces:Object.entries(this.#config.harWorkspaces?.workspaces??{}).map(([workspace,def])=>({
        workspace,label:def.label,ownership:'EXISTING_SF61_MERCHANT_CONSOLE',
        files:Object.entries(def.files).map(([file,v])=>({file,kind:v.kind,label:v.label,sha256:v.sha256??null})),
        imports:Object.entries(def.imports).map(([source,v])=>({source,kind:v.kind,label:v.label})),
        destinations:Object.keys(def.destinations),fileReads:this.#reads.status(workspace)}))};
  }
  #definition(workspace){
    checked(workspace,ALIAS,'workspace alias');
    const def=this.#config.harWorkspaces?.workspaces[workspace];
    if(!def)throw fail('HAR_WORKSPACE_NOT_CONFIGURED','Choose an original workspace from merchant_har_workspaces.');
    return def;
  }
  #file(def,alias,kind){
    const value=def.files[checked(alias,ALIAS,'file alias')];
    if(!value||kind&&value.kind!==kind)throw fail('INVALID_PARAMS','Choose a declared '+(kind??'source')+' file alias.');
    return value;
  }
  async #connection(def){
    let raw;
    try{raw=def.consoleUrlFile?new TextDecoder('utf-8',{fatal:true}).decode(await readRegular(def.consoleUrlFile,4096,true)).trim():process.env[def.consoleUrlEnv];}
    catch{throw fail('HAR_CONSOLE_UNAVAILABLE','Reconnect the original SF61 console through its declared private URL reference.');}
    let url;try{url=new URL(raw);}catch{}
    const port=url?.port?Number(url.port):80;
    if(!url||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!Number.isInteger(port)||port<1||port>65535||
        url.username||url.password||url.pathname!=='/'||url.search||!/^#[A-Za-z0-9_-]{32,256}$/.test(url.hash))
      throw fail('HAR_CONSOLE_CONNECTION_INVALID','Use the exact private URL printed by the original SF61 workspace.');
    const connection={origin:url.origin,token:url.hash.slice(1)};
    // Identity uses the native one-entry library page. Reopening and compiling
    // every saved merchant package belongs only to actual package operations.
    const library=await this.#json(connection,'/api/har/library?limit=1');
    if(library.root!==join(def.projectsDirectory,'.har-captures'))throw fail('HAR_CONSOLE_IDENTITY_CHANGED','The running console belongs to another projects directory. Reconnect the declared original workspace.');
    return {connection,library};
  }
  async #request(connection,route,{body,raw,maximum=MAX_REPLY}={}){
    try{
      const response=await fetch(connection.origin+route,{method:body===undefined&&raw===undefined?'GET':'POST',redirect:'error',
        signal:AbortSignal.timeout(240000),headers:{'x-workspace-token':connection.token,origin:connection.origin,
          ...(raw!==undefined?{'content-type':'application/octet-stream'}:body!==undefined?{'content-type':'application/json'}:{})},
        ...(raw!==undefined?{body:raw,...(Buffer.isBuffer(raw)?{}:{duplex:'half'})}:body!==undefined?{body:JSON.stringify(body)}:{})});
      if(!response.ok){
        let detail={};try{detail=json(await responseBytes(response,65536));}catch{}
        const error=fail('HAR_CONSOLE_REJECTED',typeof detail.error==='string'?detail.error.slice(0,2000):'Original console returned HTTP '+response.status+'.');
        error.status=response.status;throw error;
      }
      return await responseBytes(response,maximum);
    }catch(error){
      if(error.code?.startsWith('HAR_')||error.code==='INVALID_PARAMS')throw error;
      throw fail('HAR_CONSOLE_OPERATION_INTERRUPTED','The original console operation was interrupted. Read its retained library, reviews or saved packages before continuing.');
    }
  }
  async #json(connection,route,body){
    if(body!==undefined&&Buffer.byteLength(JSON.stringify(body))>10*1024*1024)
      throw fail('INVALID_PARAMS','The request exceeds the original merchant console JSON limit.');
    return json(await this.#request(connection,route,{body}));
  }
  async #nativeDirectory(kind,directory){
    await privateDirectory(directory);
    if(kind==='refresh'){const packet=await openRefresh(directory);return {packet,native:packet.candidate,directory};}
    return {packet:null,native:await openWorkspace(directory),directory};
  }
  async #native(def,value,revisionRequired=false){
    const selection=selected(value,revisionRequired);
    await privateDirectory(def.projectsDirectory);
    await privateDirectory(join(def.projectsDirectory,'.har-captures'));
    await privateDirectory(join(def.projectsDirectory,'.har-captures',selection.kind));
    const current=await this.#nativeDirectory(selection.kind,join(def.projectsDirectory,'.har-captures',selection.kind,selection.id));
    const identity=current.packet?.manifest.operationId??current.native.manifest.sourceSha256;
    if(identity!==selection.id)throw fail('HAR_SOURCE_CHANGED','The native source identity differs from the selected capture.');
    const saved=selection.revision?await readRevision(current.native,selection.revision):null;
    if(saved&&current.packet&&canonical(saved.review['x-har-refresh'])!==canonical(current.packet.manifest.lineage))
      throw fail('HAR_REVIEW_LINEAGE_CHANGED','Select a saved review from this original refresh lineage.');
    return {...current,selection,saved};
  }
  async #approved(connection,value){
    const selection=selected(value,true);
    const result=await this.#json(connection,'/api/har/source?'+new URLSearchParams(selection));
    if(result.capturedSource?.kind!==selection.kind||result.capturedSource?.id!==selection.id||
        result.capturedSource?.revision!==selection.revision||!SHA.test(result.capturedSource?.sourceSha256??'')||
        typeof result.specText!=='string'||hash(Buffer.from(result.specText))!==result.capturedSource.openApiSha256||
        !Array.isArray(result.operations)||result.operations.length<1||result.operations.length>100)
      throw fail('HAR_APPROVED_SOURCE_INVALID','Select the complete saved review with 1–100 approved source operations.');
    return result;
  }
  async #plan(def,input){
    if((input.plan===undefined)===(input.file===undefined))throw fail('INVALID_PARAMS','Supply one complete plan or declared merchant-plan file.');
    if(input.file!==undefined){
      checked(input.expectedSha256,SHA,'merchant-plan file SHA256');
      return json(await stableBytes(this.#file(def,input.file,'merchant-plan'),input.expectedSha256,MAX_DECISIONS));
    }
    if(input.expectedSha256!==undefined||!plain(input.plan)||Buffer.byteLength(JSON.stringify(input.plan))>131072)
      throw fail('INVALID_PARAMS','Use a complete plan within 128 KiB, or its declared file and exact SHA256.');
    return input.plan;
  }
  async #directory(){return privateDirectory(join(this.#config.exportsDirectory,'har-files'),true);}
  async #metadata(exportId){
    checked(exportId,SHA,'export identity');
    const directory=await this.#directory(),bytes=await readRegular(join(directory,exportId+'.json'),65000,true);
    const manifest=parseHarExport(bytes,exportId);this.#definition(manifest.workspace);
    return {directory,bytes,manifest,manifestSha256:hash(bytes)};
  }
  async #exports(workspace){
    const directory=await this.#directory(),items=[];
    for(const file of(await readdir(directory)).filter(x=>SHA.test(x.slice(0,-5))&&x.endsWith('.json')).sort()){
      const raw=await readRegular(join(directory,file),65000,true),manifest=parseHarExport(raw,file.slice(0,-5));
      if(manifest.workspace===workspace)items.push({...manifest,manifestSha256:hash(raw)});
    }
    return items.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.exportId.localeCompare(b.exportId));
  }
  async #retain(workspace,current,kind,bytes){
    if(!Object.hasOwn(HAR_EXPORT_FILES,kind)||!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>HAR_EXPORT_MAX_BYTES)
      throw fail('HAR_EXPORT_TOO_LARGE','Retain an original supported file within its native delivery limit.');
    const [name,contentType]=HAR_EXPORT_FILES[kind],files=[{name,bytes:bytes.length,sha256:hash(bytes),contentType}];
    const identity={workspace,kind,selection:current.selection,sourceSha256:current.native.manifest.sourceSha256,files};
    const exportId=harExportIdentity(identity),directory=await this.#directory();
    await publish(join(directory,exportId+'.data'),bytes);
    let metadata;
    try{metadata=await this.#metadata(exportId);}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(!metadata){
      const manifest={schema:HAR_EXPORT_SCHEMA,exportId,...identity,createdAt:new Date().toISOString()};
      parseHarExport(encode(manifest),exportId);
      const path=join(directory,exportId+'.json');
      try{await publish(path,encode(manifest));}
      catch(error){if(error.code!=='EEXIST')throw error;}
      metadata=await this.#metadata(exportId);
    }
    return {state:'MANIFEST_RETAINED',exportId,manifest:metadata.manifest,manifestSha256:metadata.manifestSha256,
      manifestFile:{name:HAR_EXPORT_MANIFEST,bytes:metadata.bytes.length,sha256:metadata.manifestSha256}};
  }
  async #copyMatches(current,directory){
    const target=await this.#nativeDirectory(current.selection.kind,directory);
    if(current.packet?canonical(current.packet.manifest)!==canonical(target.packet.manifest)
      :canonical(current.native.manifest)!==canonical(target.native.manifest))
      throw fail('HAR_RECEIVING_CONFLICT','The selected receiving directory contains another original source.');
    for(const [before,after]of current.packet?[[current.packet.previous,target.packet.previous],[current.packet.candidate,target.packet.candidate]]:[[current.native,target.native]]){
      for(const file of(await readdir(join(before.root,'reviews'))).filter(x=>/^[a-f0-9]{64}\.json$/.test(x))){
        const revision=file.slice(0,-5);await readRevision(before,revision);await readRevision(after,revision);
      }
    }
    return target;
  }
  async #upload(connection,def,input){
    const file=this.#file(def,input.file,'capture'),expected=checked(input.expectedSha256,SHA,'capture SHA256');
    const {fd,before,sha256}=await inspectHandle(file,expected,MAX_CAPTURE);
    let stream;
    try{
      const query=new URLSearchParams({label:label(input.label??file.label)});
      if(input.previous){const previous=selected(input.previous,true);
        await this.#native(def,previous,true);
        query.set('previousKind',previous.kind);query.set('previousId',previous.id);query.set('previousRevision',previous.revision);}
      stream=fd.createReadStream({autoClose:false,start:0});
      const result=json(await this.#request(connection,'/api/har/upload?'+query,{raw:stream}));
      const after=await fd.stat();
      if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||result.sourceSha256!==sha256)
        throw fail('HAR_FILE_CHANGED','The capture changed during intake. Inspect the original retained selection before proceeding.');
      return result;
    }finally{stream?.destroy();await fd.close();}
  }

  async #execute(name,args){
    if(name==='merchant_har_workspaces')return this.summary;
    if(name.startsWith('merchant_har_export_')){
      const meta=await this.#metadata(args.exportId),file=meta.manifest.files[0];
      if(name==='merchant_har_export_manifest')return {state:'MANIFEST_RETAINED',exportId:args.exportId,
        workspace:meta.manifest.workspace,manifest:meta.manifest,manifestSha256:meta.manifestSha256,
        manifestFile:{name:HAR_EXPORT_MANIFEST,bytes:meta.bytes.length,sha256:meta.manifestSha256}};
      if(name==='merchant_har_export_file_release'){
        checked(args.readId,UUID,'original read identity');
        await this.#reads.release(meta.manifest.workspace,args.readId);
        return {exportId:args.exportId,readId:args.readId,state:'RELEASED'};
      }
      if(name!=='merchant_har_export_file')throw fail('TOOL_NOT_FOUND','Unknown retained HAR file operation.');
      if(checked(args.expectedManifestSha256,SHA,'original manifest SHA256')!==meta.manifestSha256)
        throw fail('HAR_EXPORT_CHANGED','The selected completion manifest differs from the retained original.');
      const descriptor=args.file===HAR_EXPORT_MANIFEST?{name:HAR_EXPORT_MANIFEST,bytes:meta.bytes.length,sha256:meta.manifestSha256,contentType:'application/json'}
        :args.file===file.name?file:null;
      if(!descriptor)throw fail('INVALID_PARAMS','Choose a filename from the retained original manifest.');
      if(args.expectedSha256!==undefined&&checked(args.expectedSha256,SHA,'file SHA256')!==descriptor.sha256)
        throw fail('HAR_EXPORT_CHANGED','The requested file SHA256 differs from the retained original.');
      if(args.readId!==undefined)checked(args.readId,UUID,'original read identity');
      const result=await this.#reads.read({scope:meta.manifest.workspace,key:args.exportId+':'+descriptor.name,kind:'har-'+meta.manifest.kind,
        directory:meta.directory,readId:args.readId,expectedSha256:descriptor.sha256,offset:args.offset,limit:args.limit,
        load:async()=>({bytes:descriptor.name===HAR_EXPORT_MANIFEST?meta.bytes:
          await readRegular(join(meta.directory,args.exportId+'.data'),HAR_EXPORT_MAX_BYTES,true),name:descriptor.name,type:descriptor.contentType})});
      return {workspace:meta.manifest.workspace,exportId:args.exportId,manifestSha256:meta.manifestSha256,...result};
    }
    const {workspace,...input}=args,def=this.#definition(workspace),result=native=>({workspace,native});
    if(name==='merchant_har_exports')return result(paged(await this.#exports(workspace),input,workspace));
    if(name==='merchant_har_files'){
      if(input.file===undefined)return {workspace,files:this.summary.workspaces.find(v=>v.workspace===workspace).files};
      const file=this.#file(def,input.file),maximum=file.kind==='capture'?MAX_CAPTURE:MAX_DECISIONS;
      const opened=await inspectHandle(file,undefined,maximum);
      try{return {workspace,file:input.file,kind:file.kind,label:file.label,bytes:opened.before.size,sha256:opened.sha256};}
      finally{await opened.fd.close();}
    }
    if(['merchant_har_groups','merchant_har_changes','merchant_har_review'].includes(name)){
      const current=await this.#native(def,input.selection);
      if(name==='merchant_har_groups')return {workspace,selection:current.selection,sourceSha256:current.native.manifest.sourceSha256,
        totalEntries:current.native.inventory.totalEntries,rejectedEntries:current.native.inventory.rejected.length,
        ...paged(current.native.inventory.groups,input,current.native.manifest.inventorySha256)};
      if(name==='merchant_har_changes'){
        if(!current.packet)throw fail('INVALID_PARAMS','Select a native refresh packet.');
        const kind=input.kind??'operations';
        if(!['operations','ambiguous'].includes(kind))throw fail('INVALID_PARAMS','Choose comparison operations or ambiguous groups.');
        return {workspace,selection:current.selection,lineage:current.packet.manifest.lineage,summary:current.packet.report.summary,kind,
          ...paged(current.packet.report[kind],input,current.packet.manifest.operationId)};
      }
      const review=current.saved?.review??current.packet?.draft??current.native.newReview(),{operations,...metadata}=review;
      return {workspace,selection:current.selection,state:current.saved?'IMMUTABLE_REVIEW':'ORIGINAL_DRAFT',
        review:metadata,...paged(operations,input,current.saved?.revision??hash(canonical(review)))};
    }
    if(name==='merchant_har_export'){
      if(!Object.hasOwn(HAR_EXPORT_FILES,input.kind))throw fail('INVALID_PARAMS','Select an original HAR export kind.');
      const current=await this.#native(def,input.selection,['decisions','openapi'].includes(input.kind));
      let bytes;
      if(input.kind==='inventory')bytes=await readRegular(join(current.native.root,'inventory.json'),MAX_CAPTURE,true);
      else if(input.kind==='decisions')bytes=current.saved.bytes;
      else if(input.kind==='draft')bytes=current.packet?current.packet.bytes['draft.json']:encode(current.native.newReview());
      else if(input.kind==='comparison'){
        if(!current.packet)throw fail('INVALID_PARAMS','Choose an original refresh comparison.');
        bytes=current.packet.bytes['change-report.json'];
      }else{
        const {connection}=await this.#connection(def);
        bytes=await this.#request(connection,input.kind==='reviewer'?'/api/har/reviewer':'/api/har/export',
          {body:{selection:current.selection},maximum:input.kind==='reviewer'?32*1024*1024:MAX_DECISIONS});
        if(input.kind==='openapi'){
          const approved=await this.#approved(connection,current.selection);
          if(!bytes.equals(Buffer.from(approved.specText)))throw fail('HAR_EXPORT_CHANGED','The returned source bytes differ from the original approved OpenAPI.');
        }
      }
      return this.#retain(workspace,current,input.kind,bytes);
    }
    const {connection,library}=await this.#connection(def);
    switch(name){
      case 'merchant_har_status':{
        const status=await this.#json(connection,'/api/packages');
        return {workspace,ownership:'EXISTING_SF61_MERCHANT_CONSOLE',captures:library.total,
          packages:status.packages.length,runtime:status.runtime,retainedExports:(await this.#exports(workspace)).length,
          fileReads:this.#reads.status(workspace)};
      }
      case 'merchant_har_library':{
        const after=input.after??'';
        if(after&&!/^(capture|refresh):[a-f0-9]{64}$/.test(after))throw fail('INVALID_PARAMS','Continue the returned original capture cursor.');
        return result(await this.#json(connection,'/api/har/library?'+new URLSearchParams({after,limit:integer(input.limit??25,1,100)})));
      }
      case 'merchant_har_inspect':{
        const selection=selected(input.selection),query=new URLSearchParams(selection);
        if(input.after!==undefined)query.set('after',checked(input.after,SHA,'review cursor'));
        query.set('limit',integer(input.limit??25,1,100));
        const native=await this.#json(connection,'/api/har/inspect?'+query),{changes,...summary}=native;
        return result({...summary,...(changes?{changes:changes.length,changesTool:'merchant_har_changes'}:{})});
      }
      case 'merchant_har_ingest':return result(await this.#upload(connection,def,input));
      case 'merchant_har_adopt':{
        const entry=def.imports[checked(input.source,ALIAS,'source directory alias')];
        if(!entry)throw fail('INVALID_PARAMS','Choose a host-declared original source directory.');
        await this.#nativeDirectory(entry.kind,entry.directory);
        return result(await this.#json(connection,'/api/har/adopt',{kind:entry.kind,directory:entry.directory,label:label(input.label??entry.label)}));
      }
      case 'merchant_har_decisions_save':{
        const selection=selected(input.selection);await this.#native(def,selection);
        if((input.review===undefined)===(input.file===undefined))throw fail('INVALID_PARAMS','Supply one complete review or declared decision file.');
        let bytes;
        if(input.file!==undefined){
          checked(input.expectedSha256,SHA,'decision file SHA256');
          bytes=await stableBytes(this.#file(def,input.file,'decisions'),input.expectedSha256,MAX_DECISIONS);
        }else{
          if(input.expectedSha256!==undefined||!plain(input.review))throw fail('INVALID_PARAMS','Supply the complete original review document.');
          bytes=encode(input.review);
          if(bytes.length>131072)throw fail('INVALID_PARAMS','Use a declared decision file for reviews larger than 128 KiB.');
        }
        return result(json(await this.#request(connection,'/api/har/decisions?'+new URLSearchParams(selection),{raw:bytes})));
      }
      case 'merchant_har_source':{
        const approved=await this.#approved(connection,input.selection),{specText,operations,...metadata}=approved;
        return {workspace,...metadata,...paged(operations,input,approved.capturedSource.openApiSha256)};
      }
      case 'merchant_har_plan':{
        const prepared=await this.#approved(connection,input.selection);
        const current=await readPackage(def.projectsDirectory,packageName(input.packageName));
        const carried=mergeHarMerchantPlan({currentSource:current.specText,currentPlan:current.plan,prepared});
        return {workspace,selection:prepared.capturedSource,fromPackage:current.name,...carried};
      }
      case 'merchant_har_preview':
      case 'merchant_har_save':{
        const approved=await this.#approved(connection,input.selection),plan=await this.#plan(def,input);
        const body={specText:approved.specText,capturedSource:approved.capturedSource,plan};
        if(name==='merchant_har_preview')return result(await this.#json(connection,'/api/preview',body));
        const packageId=packageName(input.name);
        try{
          await lstat(join(def.projectsDirectory,packageId));
          const existing=await readPackage(def.projectsDirectory,packageId);
          if(existing.specText!==body.specText||canonical(existing.plan)!==canonical(plan))
            throw fail('HAR_PACKAGE_CONFLICT','This package name contains another source or merchant plan. Select the intended original or a new name.');
          return result({name:existing.name,folder:existing.folder,preview:existing.manifest.preview,reused:true});
        }catch(error){if(error.code!=='ENOENT')throw error;}
        const saved=await this.#json(connection,'/api/save',{...body,name:packageId});
        const reopened=await readPackage(def.projectsDirectory,packageId);
        if(reopened.specText!==body.specText||canonical(reopened.plan)!==canonical(plan))
          throw fail('HAR_PACKAGE_CHANGED','The completed package differs from the exact reviewed source or merchant plan.');
        return result({...saved,reused:false});
      }
      case 'merchant_har_packages':{
        const status=await this.#json(connection,'/api/packages');
        return result(paged(status.packages,input,workspace));
      }
      case 'merchant_har_load':{
        const loaded=await this.#json(connection,'/api/load?'+new URLSearchParams({name:packageName(input.name)}));
        const source=await this.#json(connection,'/api/har/locate',{specText:loaded.specText});
        return result({...loaded,...source});
      }
      case 'merchant_har_copy':{
        const current=await this.#native(def,input.selection),target=def.destinations[checked(input.destination,ALIAS,'receiving directory alias')];
        if(!target)throw fail('INVALID_PARAMS','Choose a declared receiving directory.');
        await privateDirectory(dirname(target.directory));
        let exists=false;try{await lstat(target.directory);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
        if(exists){await this.#copyMatches(current,target.directory);return {workspace,selection:current.selection,destination:input.destination,state:'COMPLETE',reused:true};}
        await this.#json(connection,'/api/har/copy',{selection:current.selection,destination:target.directory});
        await this.#copyMatches(current,target.directory);
        return {workspace,selection:current.selection,destination:input.destination,state:'COMPLETE',reused:false};
      }
      case 'merchant_har_receive':{
        const owner=this.#definition(input.fromWorkspace),current=await this.#native(owner,input.selection);
        const adopted=await this.#json(connection,'/api/har/adopt',{kind:current.selection.kind,directory:current.directory,
          label:label(input.label??owner.label+' received')});
        const receiving={...adopted.selection,...(current.selection.revision?{revision:current.selection.revision}:{})};
        const target=await this.#native(def,receiving);
        await this.#copyMatches(current,target.directory);
        return {workspace,fromWorkspace:input.fromWorkspace,native:{...adopted,selection:receiving}};
      }
      default:throw fail('TOOL_NOT_FOUND','Unknown original HAR workspace operation.');
    }
  }
  async call(name,args={}){
    if(this.#closing)throw fail('HAR_WORKSPACE_CLOSING','HAR workspace access is closing.');
    const definition=definitions.get(name);if(!definition)throw fail('TOOL_NOT_FOUND','Unknown original HAR workspace operation.');
    exact(args,Object.keys(definition.properties),definition.required);
    const pending=Promise.resolve().then(()=>this.#execute(name,args));this.#pending.add(pending);
    try{return await pending;}finally{this.#pending.delete(pending);}
  }
  close(){
    if(!this.#close){this.#closing=true;this.#close=(async()=>{await Promise.allSettled([...this.#pending]);await this.#reads.close();})();}
    return this.#close;
  }
}
