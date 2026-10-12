// MIT. Agent access to the original EPA ECHO console, retained operations and complete original files.
import { constants } from 'node:fs';
import { open, lstat, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { RetainedFileReads } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import { echoActionNames as actionNames, echoToolDefinitions as definitions, validateEchoToolField as validate } from './mcp-protocol.mjs';
export { echoWorkspaceTools } from './mcp-protocol.mjs';

export const ECHO_CONNECTION_SCHEMA = 'stellar-forge.epa-echo-workspace-connection.v1';
const SCHEMA = 'stellar-forge.epa-echo-workspace-schema.v1';
const VIEW = 'stellar-forge.epa-echo-workspace-view.v1';
const EDITION = 'stellar-forge.epa-echo-edition.v1';
const STARTUP = 'stellar-forge.epa-echo-workspace-startup.v1';
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SHA = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_IMPORT = 256 * 1024 * 1024;
const EXPORT_ID = /^[a-z0-9][a-z0-9_-]{7,127}$/;
const RECEIVED_ID = /^[a-z0-9][a-z0-9_-]{7,127}$/;
const RECEIPT_ID = /^buyer-[0-9a-f]{24}$/;
const RECEIPT_FILES = ['dataset.csv','dataset.jsonl','review.html','delivery.json','manifest.json'];
const MAX_JSON = 16 * 1024 * 1024;
const MAX_FILE = 256 * 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
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
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw fail('CONFIGURATION_ERROR', 'Declare an original host path.');
  return resolve(base, value);
}
function label(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\x00-\x1f\x7f]/.test(value))
    throw fail('CONFIGURATION_ERROR', 'Use a nonempty workspace label of up to 200 printable characters.');
  return value;
}
async function privateBytes(path, maximum) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum || process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid()))
      throw fail('ECHO_MCP_PRIVATE_FILE', 'Use the original owned private regular file within its size limit.');
    const bytes = await handle.readFile();
    if (bytes.length > maximum) throw fail('ECHO_MCP_PRIVATE_FILE', 'The original selected private file grew beyond its size limit.');
    return bytes;
  } finally { await handle.close(); }
}
async function jsonFile(path, maximum = 1024 * 1024) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await privateBytes(path, maximum)));
}
async function privateDirectory(path, create = false) {
  if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid()))
    throw fail('ECHO_MCP_STORAGE', 'Use the original owned private customer-export directory.');
  return path;
}

/** Hosts select the alias, immutable workspace UUID and one private session reference. */
export async function readEchoWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = await jsonFile(path);
  exact(raw, ['schema','workspaces'], ['schema','workspaces']);
  if (raw.schema !== ECHO_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      Object.keys(raw.workspaces).length < 1 || Object.keys(raw.workspaces).length > 32)
    throw fail('CONFIGURATION_ERROR', 'Declare one to 32 existing ECHO workspaces.');
  const workspaces = Object.create(null), base = dirname(path);
  for (const [alias, value] of Object.entries(raw.workspaces)) {
    checked(alias, ALIAS, 'workspace alias');
    exact(value, ['label','workspaceId','consoleUrlEnv','consoleUrlFile','applicationUrlFile','sourcePackages','workspacePackages'], ['workspaceId']);
    const references = ['consoleUrlEnv','consoleUrlFile','applicationUrlFile'].filter(key => Object.hasOwn(value, key));
    if (references.length !== 1) throw fail('CONFIGURATION_ERROR', 'Choose exactly one original console URL environment/file or Applications URL record.');
    const reference = references[0];
    const packages={};
    for(const field of ['sourcePackages','workspacePackages']){
      const values=Object.create(null);
      if(value[field]!==undefined){
        if(!plain(value[field])||Object.keys(value[field]).length>32)
          throw fail('CONFIGURATION_ERROR','Declare at most 32 pinned package aliases per workspace and kind.');
        for(const [name,entry] of Object.entries(value[field])){
          checked(name,ALIAS,'package alias');
          exact(entry,['path','sha256','label'],['path','sha256']);
          values[name]={path:hostPath(entry.path,base),sha256:checked(entry.sha256,SHA,'original package SHA256'),label:label(entry.label??name)};
        }
      }
      packages[field]=values;
    }
    workspaces[alias] = {
      label: label(value.label ?? alias), ...packages,
      workspaceId: checked(value.workspaceId, UUID, 'original workspace UUID'),
      [reference]: reference === 'consoleUrlEnv'
        ? checked(value[reference], /^[A-Za-z_][A-Za-z0-9_]*$/, 'session environment name')
        : hostPath(value[reference], base)
    };
  }
  return { schema: ECHO_CONNECTION_SCHEMA, workspaces };
}

async function responseBytes(response, maximum) {
  const declared = response.headers.get('content-length');
  if (declared && /^[0-9]+$/.test(declared) && Number(declared) > maximum) {
    await response.body?.cancel().catch(()=>{});
    throw fail('ECHO_MCP_RESPONSE_LIMIT','The original response exceeds this endpoint’s declared byte limit.');
  }
  const parts=[];let size=0;
  for await (const part of response.body ?? []) {
    size+=part.length;
    if(size>maximum)throw fail('ECHO_MCP_RESPONSE_LIMIT','The original response exceeds this endpoint’s declared byte limit.');
    parts.push(part);
  }
  return Buffer.concat(parts,size);
}
function connectionUrl(raw) {
  let url;try{url=new URL(raw);}catch{}
  if (!url || url.protocol!=='http:' || url.hostname!=='127.0.0.1' || url.username || url.password ||
      url.pathname!=='/' || url.search || !/^#[A-Za-z0-9_-]{43}$/.test(url.hash))
    throw fail('ECHO_MCP_SESSION_INVALID','Use the exact original private ECHO session URL.');
  // URL canonicalization intentionally permits the original HTTP port 80.
  const port=Number(url.port || '80');
  if(!Number.isInteger(port)||port<1||port>65535)throw fail('ECHO_MCP_SESSION_INVALID','Use the original loopback listener port.');
  return {origin:url.origin,token:url.hash.slice(1)};
}
function metadata(item, selection) {
  if (!item || typeof item.name!=='string' || !item.name || /[/\\\x00-\x1f\x7f]/.test(item.name) ||
      typeof item.type!=='string' || !SHA.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes<0 || item.bytes>MAX_FILE)
    throw fail('ECHO_MCP_FILE_METADATA','The original file manifest is incomplete or outside its retained byte limit.');
  return {selection,name:item.name,type:item.type,bytes:item.bytes,sha256:item.sha256};
}
function selectionKey(input) {
  const {kind,id,page,file,wire,path}=input;
  if(kind!=='workspace'&&path!==undefined)throw fail('INVALID_PARAMS','Original file paths apply only to a received workspace.');
  if(kind==='source'){
    checked(id,SHA,'source edition SHA256');integer(page ?? 0,0);
    if(file!==undefined)throw fail('INVALID_PARAMS','Original source reads select a page, not a customer filename.');
    return 'source:'+id+':'+(page ?? 0)+':'+(wire ? 'wire' : 'body');
  }
  if(kind==='export'){
    checked(id,EXPORT_ID,'retained export identity');
    if(page!==undefined||file!==undefined||wire!==undefined)throw fail('INVALID_PARAMS','An export read selects its original export identity only.');
    return 'export:'+id;
  }
  if(kind==='receipt'){
    checked(id,RECEIPT_ID,'customer receipt identity');
    if(!RECEIPT_FILES.includes(file)||page!==undefined||wire!==undefined)throw fail('INVALID_PARAMS','Select one of the five original customer filenames.');
    return 'receipt:'+id+':'+file;
  }
  if(kind==='workspace'){
    checked(id,RECEIVED_ID,'received workspace identity');
    if(page!==undefined||file!==undefined||wire!==undefined)throw fail('INVALID_PARAMS','A received workspace file uses its original relative path.');
    return 'workspace:'+id+':'+originalPath(path);
  }
  throw fail('INVALID_PARAMS','Choose source, export, receipt or workspace.');
}
function originalPath(value){
  if(typeof value!=='string'||!value||value.length>2048||value.startsWith('/')||/[\\\\\x00-\x1f\x7f]/.test(value)||
      value.split('/').some(part=>!part||part==='.'||part==='..'))
    throw fail('INVALID_PARAMS','Select an original relative file path from the received workspace manifest.');
  return value;
}

export class MerchantEchoWorkspaces {
  #config;#environment;#fetch;#pending=new Set();#closing=false;#close;
  #reads=new RetainedFileReads({errorPrefix:'ECHO_MCP_FILE'});
  constructor(config,{environment=process.env,fetchImpl=fetch}={}){this.#config=config;this.#environment=environment;this.#fetch=fetchImpl;}
  get summary(){
    return {configured:Boolean(this.#config.echoWorkspaces),...this.#reads.summary,
      workspaces:Object.entries(this.#config.echoWorkspaces?.workspaces ?? {}).map(([workspace,value])=>({
        workspace,label:value.label,workspaceId:value.workspaceId,
        connection:value.applicationUrlFile?'ORIGINAL_APPLICATIONS_RECORD':value.consoleUrlFile?'ORIGINAL_CONSOLE_URL_FILE':'ORIGINAL_CONSOLE_URL_ENV',
        ownership:'EXISTING_ECHO_WORKSPACE',fileReads:this.#reads.status(workspace),
        sourcePackages:Object.entries(value.sourcePackages ?? {}).map(([alias,item])=>({alias,label:item.label,sha256:item.sha256})),
        workspacePackages:Object.entries(value.workspacePackages ?? {}).map(([alias,item])=>({alias,label:item.label,sha256:item.sha256}))
      }))};
  }
  #definition(workspace){
    checked(workspace,ALIAS,'workspace alias');
    const definition=this.#config.echoWorkspaces?.workspaces[workspace];
    if(!definition)throw fail('ECHO_MCP_NOT_CONFIGURED','Choose an original alias from merchant_echo_workspaces.');
    return definition;
  }
  async #connection(definition){
    let raw;
    try{
      if(definition.applicationUrlFile){
        const record=await jsonFile(definition.applicationUrlFile,65536),original=record.original;
        if(!plain(original)||original.schema!==STARTUP||
            original.workspaceId!==definition.workspaceId||typeof record.url!=='string')
          throw fail('ECHO_MCP_APPLICATION_CHANGED','Use the original Applications URL record for the configured workspace UUID.');
        raw=record.url;
      }else if(definition.consoleUrlFile){
        raw=new TextDecoder('utf-8',{fatal:true}).decode(await privateBytes(definition.consoleUrlFile,4096)).trim();
      }else raw=this.#environment[definition.consoleUrlEnv];
    }catch(error){
      if(error.code?.startsWith('ECHO_MCP_'))throw error;
      throw fail('ECHO_MCP_SESSION_UNAVAILABLE','Reopen the original workspace and refresh its host-declared private session reference.');
    }
    return connectionUrl(raw);
  }
  async #request(connection,route,{body,binary=false,maximum=MAX_JSON}={}){
    try{
      const response=await this.#fetch(connection.origin+route,{method:body===undefined?'GET':'POST',redirect:'error',
        signal:AbortSignal.timeout(120000),headers:{Authorization:'Bearer '+connection.token,
          ...(body===undefined?{}:{'Content-Type':'application/json'})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      const bytes=await responseBytes(response,response.ok?maximum:65536);
      if(binary&&response.ok)return {ok:true,httpStatus:response.status,bytes,type:response.headers.get('content-type')};
      let native;
      try{native=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
      catch{throw fail('ECHO_MCP_RESPONSE_INVALID','The original console returned an invalid JSON response. Retain any pending original operationId.');}
      return {ok:response.ok,httpStatus:response.status,native};
    }catch(error){
      if(error.code?.startsWith('ECHO_MCP_'))throw error;
      // The existing workspace owns completion. No implicit retry or new action identity.
      throw fail('ECHO_MCP_SESSION_INTERRUPTED','The original console response was interrupted. Read its current view, then repeat the same operationId and exact payload if needed.');
    }
  }
  async #session(definition){
    const connection=await this.#connection(definition),response=await this.#request(connection,'/api/schema');
    if(!response.ok)throw fail('ECHO_MCP_SESSION_REJECTED','The original workspace rejected its private session. Reopen its declared session reference.');
    if(!plain(response.native)||response.native.schema!==SCHEMA||response.native.workspaceId!==definition.workspaceId)
      throw fail('ECHO_MCP_IDENTITY_CHANGED','The running console differs from the host-selected ECHO workspace UUID.');
    return {...connection,schema:response.native};
  }
  #wrap(workspace,definition,response){
    return {workspace,workspaceId:definition.workspaceId,...response};
  }
  async #view(session){
    const response=await this.#request(session,'/api/view');
    if(!response.ok)return response;
    if(!plain(response.native)||response.native.schema!==VIEW||response.native.workspaceId!==session.schema.workspaceId||
        !Number.isSafeInteger(response.native.revision)||response.native.revision<0||
        ['portfolios','searches','captures','editions','reviews','releases','receipts','exports','receivedWorkspaces','operations'].some(key=>!Array.isArray(response.native[key])))
      throw fail('ECHO_MCP_IDENTITY_CHANGED','The original workspace view identity or revision changed unexpectedly.');
    return response;
  }
  async #edition(session,id){
    checked(id,SHA,'original edition SHA256');
    const response=await this.#request(session,'/api/edition?editionId='+id);
    if(response.ok&&(!plain(response.native)||response.native.schema!==EDITION||response.native.id!==id||!Array.isArray(response.native.pages)))
      throw fail('ECHO_MCP_EDITION_CHANGED','The original immutable edition identity does not match the selected source.');
    return response;
  }
  async #directory(workspace){
    await privateDirectory(this.#config.exportsDirectory);
    const root=await privateDirectory(join(this.#config.exportsDirectory,'echo-workspaces'),true);
    return privateDirectory(join(root,workspace),true);
  }
  async #files(session,{kind,id,wire=false,path}){
    if(kind!=='workspace'&&path!==undefined)throw fail('INVALID_PARAMS','Original file paths apply only to a received workspace.');
    if(kind!=='source'&&wire)throw fail('INVALID_PARAMS','The wire selector belongs to original source response pages.');
    if(kind==='source'){
      const response=await this.#edition(session,id);if(!response.ok)return response;
      const files=response.native.pages.map((item,page)=>{
        const sha256=wire?(item.responseSha256 ?? item.sha256):item.sha256;
        const bytes=wire?(item.responseBytes ?? item.bytes):item.bytes;
        return {...metadata({
          name:'echo-'+item.kind+'-'+(wire?'wire':'body')+'-'+sha256.slice(0,12)+'.json',
          type:item.type??'application/json; charset=utf-8',bytes,sha256
        },{kind,id,page,wire}),source:{kind:item.kind,facilityId:item.facilityId,url:item.url,sourceObservedAt:item.sourceObservedAt,
          statusObserved:item.statusObserved,bodyRepresentation:item.bodyRepresentation}};
      });
      return {ok:true,httpStatus:200,native:{kind,id,edition:response.native,files}};
    }
    if(kind==='workspace'){
      checked(id,RECEIVED_ID,'received workspace identity');
      if(path!==undefined)originalPath(path);
      const response=await this.#request(session,'/api/received-workspace?receiptId='+encodeURIComponent(id));
      if(!response.ok)return response;
      const item=response.native;
      if(!plain(item)||!Array.isArray(item.files))throw fail('ECHO_MCP_WORKSPACE_MANIFEST','The received original workspace file manifest is incomplete.');
      const entries=path===undefined?item.files:item.files.filter(file=>(file.path??file.name)===path);
      if(path!==undefined&&!entries.length)return {ok:false,httpStatus:404,native:{error:'ECHO_SELECTION',message:'Select an original file from this received workspace.'}};
      const names=new Set(),files=entries.map(file=>{
        const selectedPath=originalPath(file.path??file.name);
        if(names.has(selectedPath))throw fail('ECHO_MCP_WORKSPACE_MANIFEST','The original workspace manifest repeats a file path.');
        names.add(selectedPath);
        return {...metadata({...file,name:selectedPath.split('/').at(-1),type:file.type??'application/octet-stream'},
          {kind,id,path:selectedPath}),originalPath:selectedPath};
      });
      return {ok:true,httpStatus:200,native:{kind,id,sourceWorkspaceId:item.sourceWorkspaceId??item.receipt?.sourceWorkspaceId,
        sourceRevision:item.sourceRevision??item.receipt?.sourceRevision,files}};
    }
    if(kind==='export')checked(id,EXPORT_ID,'retained export identity');
    else if(kind==='receipt')checked(id,RECEIPT_ID,'customer receipt identity');
    else throw fail('INVALID_PARAMS','Choose source, export or receipt.');
    const response=await this.#view(session);if(!response.ok)return response;
    const item=(kind==='export'?response.native.exports:response.native.receipts).find(item=>item.id===id);
    if(!item)return {ok:false,httpStatus:404,native:{error:'ECHO_SELECTION',message:'Select an existing original '+kind+'.'}};
    if(kind==='export')return {ok:true,httpStatus:200,native:{kind,id,files:[metadata(item,{kind,id})]}};
    if(!Array.isArray(item.downloads)||item.downloads.length!==RECEIPT_FILES.length||
        new Set(item.downloads.map(file=>file.name)).size!==RECEIPT_FILES.length||
        item.downloads.some(file=>!RECEIPT_FILES.includes(file.name)))
      throw fail('ECHO_MCP_RECEIPT_CHANGED','The original customer receipt must declare its five complete files.');
    return {ok:true,httpStatus:200,native:{kind,id,intentIds:item.intentIds,dataset:item.dataset,mode:item.mode,
      manifestSha256:item.manifestSha256,files:item.downloads.map(file=>metadata(file,{kind,id,file:file.name}))}};
  }
  async #file(workspace,definition,input){
    const key=selectionKey(input),scope=workspace;
    if((input.offset ?? 0)>0&&input.expectedSha256===undefined)
      throw fail('INVALID_PARAMS','Repeat the original file SHA256 when resuming at a later byte offset.');
    if(input.readId)return this.#reads.read({scope,key,kind:'echo-'+input.kind,
      readId:input.readId,expectedSha256:input.expectedSha256,offset:input.offset ?? 0,limit:input.limit ?? 65536});
    const session=await this.#session(definition),response=await this.#files(session,input);
    if(!response.ok)return response;
    const selection=response.native.files.find(file=>selectionKey(file.selection)===key);
    if(!selection)throw fail('INVALID_PARAMS','Select one original file or response page from merchant_echo_files.');
    if(input.expectedSha256!==undefined&&input.expectedSha256!==selection.sha256)
      throw fail('ECHO_MCP_FILE_CHANGED','The selected original file differs from the requested SHA256.');
    const route=input.kind==='source'?'/api/raw?editionId='+input.id+'&page='+(input.page ?? 0)+(input.wire?'&wire=true':''):
      input.kind==='export'?'/api/exports/'+input.id:input.kind==='workspace'?'/api/received-workspace-file?receiptId='+encodeURIComponent(input.id)+'&path='+encodeURIComponent(input.path):'/api/receipts/'+input.id+'/'+input.file;
    const directory=await this.#directory(workspace);
    return this.#reads.read({scope,key,kind:'echo-'+input.kind,directory,
      expectedSha256:selection.sha256,offset:input.offset ?? 0,limit:input.limit ?? 65536,
      load:async()=>{
        const original=await this.#request(session,route,{binary:true,maximum:input.kind==='source'?32*1024*1024:MAX_FILE});
        if(!original.ok)throw fail('ECHO_MCP_FILE_UNAVAILABLE','The original workspace could not return its selected retained file.');
        if(original.bytes.length!==selection.bytes||hash(original.bytes)!==selection.sha256)
          throw fail('ECHO_MCP_FILE_CHANGED','The received original bytes differ from their retained manifest.');
        return {bytes:original.bytes,name:selection.name,type:selection.type};
      }});
  }
  async #execute(name,args){
    if(name==='merchant_echo_workspaces')return this.summary;
    const {workspace,...input}=args,definition=this.#definition(workspace);
    if(name==='merchant_echo_file_release'){
      await this.#reads.release(workspace,input.readId);
      return {workspace,workspaceId:definition.workspaceId,released:true,readId:input.readId};
    }
    if(name==='merchant_echo_file_read'){
      const result=await this.#file(workspace,definition,input);
      return result.ok===false?this.#wrap(workspace,definition,result):
        {workspace,workspaceId:definition.workspaceId,ok:true,native:result};
    }
    const session=await this.#session(definition);
    if(name==='merchant_echo_schema')return this.#wrap(workspace,definition,{ok:true,httpStatus:200,native:session.schema});
    if(name==='merchant_echo_view')return this.#wrap(workspace,definition,await this.#view(session));
    if(name==='merchant_echo_edition')return this.#wrap(workspace,definition,await this.#edition(session,input.editionId));
    if(name==='merchant_echo_files')return this.#wrap(workspace,definition,await this.#files(session,input));
    if(name==='merchant_echo_facility')return this.#wrap(workspace,definition,await this.#request(session,
      '/api/facility?'+new URLSearchParams({editionId:input.editionId,facilityId:input.facilityId})));
    if(name==='merchant_echo_received_workspace')return this.#wrap(workspace,definition,await this.#request(session,
      '/api/received-workspace?receiptId='+encodeURIComponent(input.receiptId)));
    if(name==='merchant_echo_search'){
      const response=await this.#request(session,'/api/search?'+new URLSearchParams({searchId:input.searchId,offset:input.offset??0,limit:input.limit??100}));
      if(response.ok){
        if(!Array.isArray(response.native.rows)||!Number.isSafeInteger(response.native.total)||response.native.total<0)
          throw fail('ECHO_MCP_SEARCH_INVALID','The original facility search page is incomplete.');
        const next=(input.offset??0)+response.native.rows.length;
        response.native={...response.native,searchId:input.searchId,nextOffset:next<response.native.total?next:null};
      }
      return this.#wrap(workspace,definition,response);
    }
    if(name==='merchant_echo_rows'){
      const response=await this.#request(session,'/api/rows?editionId='+input.editionId+'&table='+encodeURIComponent(input.table)+'&offset='+(input.offset ?? 0)+'&limit='+(input.limit ?? 100)+(input.facilityId?'&facilityId='+encodeURIComponent(input.facilityId):'')+(input.section?'&section='+encodeURIComponent(input.section):''));
      if(response.ok){
        const original=response.native;
        if(!Array.isArray(original.rows)||!Number.isSafeInteger(original.total)||original.total<0)
          throw fail('ECHO_MCP_ROWS_INVALID','The original row page is incomplete.');
        const next=(input.offset ?? 0)+original.rows.length;
        response.native={...original,editionId:input.editionId,table:input.table,nextOffset:next<original.total?next:null};
      }
      return this.#wrap(workspace,definition,response);
    }
    if(name==='merchant_echo_editions'){
      const offset=input.offset ?? 0,limit=input.limit ?? 100;
      if(offset>0&&input.expectedRevision===undefined)throw fail('INVALID_PARAMS','Continue the original edition archive with its returned expectedRevision.');
      const before=await this.#view(session);if(!before.ok)return this.#wrap(workspace,definition,before);
      const revision=before.native.revision;
      const changed=current=>this.#wrap(workspace,definition,{ok:false,httpStatus:409,
        native:{error:'ECHO_REVISION_CHANGED',message:'The original archive changed. Restart at offset zero with the current revision.',
          currentRevision:current.revision,view:current}});
      if(input.expectedRevision!==undefined&&input.expectedRevision!==revision)return changed(before.native);
      const page=await this.#request(session,'/api/editions?offset='+offset+'&limit='+limit+(input.portfolioId?'&portfolioId='+input.portfolioId:''));
      if(!page.ok)return this.#wrap(workspace,definition,page);
      const after=await this.#view(session);if(!after.ok)return this.#wrap(workspace,definition,after);
      if(after.native.revision!==revision)return changed(after.native);
      if(!Array.isArray(page.native.editions)||!Number.isSafeInteger(page.native.total)||offset>page.native.total||
          page.native.offset!==offset||page.native.limit!==limit||page.native.editions.length>limit||
          offset<page.native.total&&page.native.editions.length===0)
        throw fail('ECHO_MCP_ARCHIVE_INVALID','The original edition archive returned an invalid page.');
      return this.#wrap(workspace,definition,{...page,native:{...page.native,revision,...(input.portfolioId?{portfolioId:input.portfolioId}:{}),
        nextOffset:offset+page.native.editions.length<page.native.total?offset+page.native.editions.length:null}});
    }
    const action=actionNames.get(name);
    if(!action)throw fail('TOOL_NOT_FOUND','Choose a declared original ECHO operation.');
    const [actionId,,properties]=action;
    const declared=session.schema.actions?.[actionId];
    const nativeFields=actionId==='capture.import'?['portfolioId','label','bundle']:actionId==='workspace.receive'?['bundle']:Object.keys(properties);
    if(!Array.isArray(declared)||nativeFields.some(key=>!declared.includes(key)))
      throw fail('ECHO_MCP_ACTION_CHANGED','The installed original workspace action contract differs from this adapter. Reconcile the selected source edition.');
    const {operationId,expectedRevision,...payload}=input;
    const request={action:actionId,payload,operationId,expectedRevision};
    let body=request,selectedSource=null;
    if(['capture.import','workspace.receive'].includes(actionId)){
      const field=actionId==='capture.import'?'sourcePackage':'workspacePackage';
      const selected=definition[actionId==='capture.import'?'sourcePackages':'workspacePackages']?.[payload[field]];
      if(!selected)throw fail('ECHO_MCP_SOURCE_PACKAGE','Choose the original package alias declared by this host.');
      const bytes=await privateBytes(selected.path,MAX_IMPORT);
      if(hash(bytes)!==selected.sha256)throw fail('ECHO_MCP_SOURCE_PACKAGE_CHANGED','The selected original package changed; review its current hash before changing the host selection.');
      let bundle;try{bundle=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
      catch{throw fail('ECHO_MCP_SOURCE_PACKAGE_INVALID','Select the original UTF-8 JSON package.');}
      const expected=actionId==='capture.import'?'stellar-forge.epa-echo-source-package.v1':'stellar-forge.epa-echo-workspace-package.v1';
      if(!plain(bundle)||bundle.schema!==expected)throw fail('ECHO_MCP_SOURCE_PACKAGE_INVALID','Choose an original '+expected+' package.');
      const nativePayload={...payload};delete nativePayload[field];
      body={...request,payload:{...nativePayload,bundle}};
      selectedSource={kind:field,alias:payload[field],label:selected.label,sha256:selected.sha256,bytes:bytes.length};
    }
    if(Buffer.byteLength(JSON.stringify(body))>(['capture.import','workspace.receive'].includes(actionId)?MAX_IMPORT+1024*1024:128*1024))
      throw fail('INVALID_PARAMS','The original action exceeds its declared request size.');
    try{
      const response=await this.#request(session,'/api/action',{body});
      return this.#wrap(workspace,definition,{...response,request,...(selectedSource?{sourcePackage:selectedSource}:{})});
    }catch(error){
      if(error.code!=='ECHO_MCP_SESSION_INTERRUPTED'&&error.code!=='ECHO_MCP_RESPONSE_LIMIT'&&error.code!=='ECHO_MCP_RESPONSE_INVALID')throw error;
      return this.#wrap(workspace,definition,{ok:false,state:'OUTCOME_UNCERTAIN',...(selectedSource?{sourcePackage:selectedSource}:{}),request,
        native:{error:error.code,message:error.message,operationId},
        recovery:'Read the original view and repeat this exact tool request with the same operationId. Its native journal reconciles identity before revision.'});
    }
  }
  async call(name,args={}){
    if(this.#closing)throw fail('ECHO_MCP_CLOSING','The ECHO adapter is closing its pending calls and retained reads.');
    const definition=definitions.get(name);
    if(!definition)throw fail('TOOL_NOT_FOUND','Choose a declared original ECHO tool.');
    exact(args,Object.keys(definition.properties),definition.required);
    for(const [key,value] of Object.entries(args))validate(value,definition.properties[key],key);
    const task=Promise.resolve().then(()=>this.#execute(name,args));this.#pending.add(task);
    try{return await task;}finally{this.#pending.delete(task);}
  }
  close(){
    if(!this.#close){
      this.#closing=true;
      this.#close=(async()=>{await Promise.allSettled([...this.#pending]);await this.#reads.close();})()
        .catch(error=>{this.#close=undefined;throw error;});
    }
    return this.#close;
  }
}
