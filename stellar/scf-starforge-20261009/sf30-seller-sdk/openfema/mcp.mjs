// MIT. Merchant access to the original OpenFEMA workspace and retained native files.
import { constants } from 'node:fs';
import { open, lstat, mkdir, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { RetainedFileReads } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import { openFemaActionNames, openFemaToolDefinitions, validateOpenFemaToolField } from './mcp-protocol.mjs';
export { openFemaWorkspaceTools } from './mcp-protocol.mjs';

export const OPENFEMA_CONNECTION_SCHEMA='stellar-forge.openfema-workspace-connection.v1';
const SCHEMA='stellar-forge.openfema-workspace-schema.v1';
const VIEW='stellar-forge.openfema-workspace-view.v1';
const EDITION='stellar-forge.openfema-source-edition.v1';
const STARTUP='stellar-forge.openfema-workspace-startup.v1';
const BUNDLE='stellar-forge.openfema-source-bundle.v1';
const ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/, SHA=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const FILE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/;
const EXPORT_ID=/^export-[a-f0-9]{24}$/, RECEIPT_ID=/^buyer-[a-f0-9]{24}$/;
const RECEIPT_FILES=['dataset.csv','dataset.jsonl','review.html','delivery.json','manifest.json'];
const KINDS=['declarations','applicants','projects'];
const MAX_IMPORT=64*1024*1024, MAX_JSON=16*1024*1024, MAX_FILE=1024*1024*1024;
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(code,message)=>Object.assign(new Error(message),{code});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function exact(value,fields,required=[]){
  if(!plain(value)||Object.keys(value).some(k=>!fields.includes(k))||required.some(k=>!Object.hasOwn(value,k)))
    throw fail('INVALID_PARAMS','Supply only the declared fields, including all required fields.');
}
function checked(value,pattern,label){
  if(typeof value!=='string'||!pattern.test(value))throw fail('INVALID_PARAMS','Supply a valid '+label+'.');
  return value;
}
function hostPath(value,base){
  if(typeof value!=='string'||!value||value.includes('\0'))throw fail('CONFIGURATION_ERROR','Declare an original host path.');
  return resolve(base,value);
}
function label(value){
  if(typeof value!=='string'||!value.trim()||value.length>200||/[\x00-\x1f\x7f]/.test(value))
    throw fail('CONFIGURATION_ERROR','Use a nonempty printable workspace label of at most 200 characters.');
  return value;
}
async function privateBytes(path,maximum){
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await handle.stat({bigint:true});
    if(!before.isFile()||before.size>BigInt(maximum)||process.platform!=='win32'&&
      ((Number(before.mode)&0o077)||Number(before.uid)!==process.getuid()))
      throw fail('OPENFEMA_MCP_PRIVATE_FILE','Use the original owned private regular file within its byte limit.');
    const bytes=await handle.readFile(),after=await handle.stat({bigint:true});
    if(bytes.length>maximum||BigInt(bytes.length)!==before.size||before.size!==after.size||
      before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)
      throw fail('OPENFEMA_MCP_PRIVATE_FILE_CHANGED','The selected original private file changed while it was read.');
    return bytes;
  }finally{await handle.close();}
}
async function jsonFile(path,maximum=1024*1024){
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await privateBytes(path,maximum)));
}
async function privateDirectory(path,create=false){
  if(create)await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  const stat=await lstat(path);
  if(!stat.isDirectory()||stat.isSymbolicLink()||process.platform!=='win32'&&((stat.mode&0o077)||stat.uid!==process.getuid()))
    throw fail('OPENFEMA_MCP_STORAGE','Use the original owned private customer-export directory.');
  return path;
}

/** The host selects the original workspace UUID and an existing private session reference. */
export async function readOpenFemaWorkspaceConfiguration(path){
  path=resolve(path);
  const raw=await jsonFile(path);
  exact(raw,['schema','workspaces'],['schema','workspaces']);
  if(raw.schema!==OPENFEMA_CONNECTION_SCHEMA||!plain(raw.workspaces)||
    Object.keys(raw.workspaces).length<1||Object.keys(raw.workspaces).length>32)
    throw fail('CONFIGURATION_ERROR','Declare one to 32 original OpenFEMA workspaces.');
  const workspaces=Object.create(null),base=dirname(path);
  for(const [alias,value]of Object.entries(raw.workspaces)){
    checked(alias,ALIAS,'workspace alias');
    exact(value,['label','workspaceId','consoleUrlEnv','consoleUrlFile','applicationUrlFile','sourcePackages'],['workspaceId']);
    const references=['consoleUrlEnv','consoleUrlFile','applicationUrlFile'].filter(k=>Object.hasOwn(value,k));
    if(references.length!==1)throw fail('CONFIGURATION_ERROR','Choose exactly one original console URL environment/file or Applications URL record.');
    const reference=references[0],sourcePackages=Object.create(null);
    if(value.sourcePackages!==undefined){
      if(!plain(value.sourcePackages)||Object.keys(value.sourcePackages).length>32)
        throw fail('CONFIGURATION_ERROR','Declare at most 32 original source-package aliases per workspace.');
      for(const [name,entry]of Object.entries(value.sourcePackages)){
        checked(name,ALIAS,'source-package alias');exact(entry,['path','sha256','label'],['path','sha256']);
        sourcePackages[name]={path:hostPath(entry.path,base),sha256:checked(entry.sha256,SHA,'source-package SHA256'),label:label(entry.label??name)};
      }
    }
    workspaces[alias]={label:label(value.label??alias),sourcePackages,
      workspaceId:checked(value.workspaceId,UUID,'original workspace UUID'),
      [reference]:reference==='consoleUrlEnv'?checked(value[reference],/^[A-Za-z_][A-Za-z0-9_]*$/,'session environment name'):hostPath(value[reference],base)};
  }
  return {schema:OPENFEMA_CONNECTION_SCHEMA,workspaces};
}
async function responseBytes(response,maximum){
  const declared=response.headers.get('content-length');
  if(declared&&/^[0-9]+$/.test(declared)&&Number(declared)>maximum){
    await response.body?.cancel().catch(()=>{});
    throw fail('OPENFEMA_MCP_RESPONSE_LIMIT','The original response exceeds this endpoint’s byte limit.');
  }
  const parts=[];let size=0;
  for await(const part of response.body??[]){
    size+=part.length;
    if(size>maximum)throw fail('OPENFEMA_MCP_RESPONSE_LIMIT','The original response exceeds this endpoint’s byte limit.');
    parts.push(part);
  }
  return Buffer.concat(parts,size);
}
function connectionUrl(raw){
  let url;try{url=new URL(raw);}catch{}
  if(!url||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||
    url.pathname!=='/'||url.search||!/^#[A-Za-z0-9_-]{43}$/.test(url.hash))
    throw fail('OPENFEMA_MCP_SESSION_INVALID','Use the exact original private OpenFEMA session URL.');
  const port=Number(url.port||80);
  if(!Number.isInteger(port)||port<1||port>65535)throw fail('OPENFEMA_MCP_SESSION_INVALID','Use the original loopback listener port.');
  return {origin:url.origin,token:url.hash.slice(1)};
}
function metadata(item,selection,extra={}){
  if(!plain(item)||typeof item.name!=='string'||!FILE.test(item.name)||typeof item.type!=='string'||
    !SHA.test(item.sha256??'')||!Number.isSafeInteger(item.bytes)||item.bytes<0||item.bytes>MAX_FILE)
    throw fail('OPENFEMA_MCP_FILE_METADATA','The original file manifest is incomplete or exceeds its byte limit.');
  return {selection,name:item.name,type:item.type,bytes:item.bytes,sha256:item.sha256,...extra};
}
function selectionKey(input){
  const {kind,id,file}=input;
  if(['source','portfolio'].includes(kind))checked(id,SHA,'original source or portfolio version SHA256');
  else if(kind==='export')checked(id,EXPORT_ID,'original export identity');
  else if(kind==='receipt')checked(id,RECEIPT_ID,'original customer receipt identity');
  else throw fail('INVALID_PARAMS','Choose source, portfolio, export or receipt.');
  if(file!==undefined)checked(file,FILE,'original manifest filename');
  return JSON.stringify([kind,id,file??null]);
}
function selectedVersion(view,id){
  checked(id,SHA,'original portfolio version');
  const item=view.versions.find(x=>x.id===id);
  if(!item)throw fail('OPENFEMA_MCP_VERSION_MISSING','Select a retained original portfolio version.');
  if(!SHA.test(item.sha256??'')||!Number.isSafeInteger(item.bytes)||item.bytes<0)
    throw fail('OPENFEMA_MCP_VERSION_CHANGED','The retained portfolio-version manifest is incomplete.');
  return item;
}
export class MerchantOpenFemaWorkspaces{
  #config;#environment;#fetch;#pending=new Set();#closing=false;#close;
  #reads=new RetainedFileReads({errorPrefix:'OPENFEMA_MCP_FILE'});
  constructor(config,{environment=process.env,fetchImpl=fetch}={}){
    this.#config=config;this.#environment=environment;this.#fetch=fetchImpl;
  }
  get summary(){
    return {configured:Boolean(this.#config.openFemaWorkspaces),...this.#reads.summary,
      workspaces:Object.entries(this.#config.openFemaWorkspaces?.workspaces??{}).map(([workspace,item])=>({
        workspace,label:item.label,workspaceId:item.workspaceId,ownership:'EXISTING_OPENFEMA_WORKSPACE',
        connection:item.applicationUrlFile?'ORIGINAL_APPLICATIONS_RECORD':item.consoleUrlFile?'ORIGINAL_CONSOLE_URL_FILE':'ORIGINAL_CONSOLE_URL_ENV',
        fileReads:this.#reads.status(workspace),
        sourcePackages:Object.entries(item.sourcePackages??{}).map(([alias,p])=>({alias,label:p.label,sha256:p.sha256}))
      }))};
  }
  #definition(workspace){
    checked(workspace,ALIAS,'workspace alias');
    const selected=this.#config.openFemaWorkspaces?.workspaces[workspace];
    if(!selected)throw fail('OPENFEMA_MCP_NOT_CONFIGURED','Choose an original alias from merchant_openfema_workspaces.');
    return selected;
  }
  async #connection(definition){
    let raw;
    try{
      if(definition.applicationUrlFile){
        const record=await jsonFile(definition.applicationUrlFile,65536),original=record.original;
        if(!plain(original)||original.schema!==STARTUP||original.workspaceId!==definition.workspaceId||typeof record.url!=='string')
          throw fail('OPENFEMA_MCP_APPLICATION_CHANGED','Use the original Applications URL record for this workspace UUID.');
        raw=record.url;
      }else if(definition.consoleUrlFile)raw=new TextDecoder('utf-8',{fatal:true}).decode(await privateBytes(definition.consoleUrlFile,4096)).trim();
      else raw=this.#environment[definition.consoleUrlEnv];
    }catch(error){
      if(error.code?.startsWith('OPENFEMA_MCP_'))throw error;
      throw fail('OPENFEMA_MCP_SESSION_UNAVAILABLE','Reopen the original workspace and refresh its host-declared private session reference.');
    }
    return connectionUrl(raw);
  }
  async #request(connection,route,{body,maximum=MAX_JSON}={}){
    try{
      const response=await this.#fetch(connection.origin+route,{method:body===undefined?'GET':'POST',redirect:'error',
        signal:AbortSignal.timeout(120000),headers:{Authorization:'Bearer '+connection.token,
          ...(body===undefined?{}:{'Content-Type':'application/json'})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      const bytes=await responseBytes(response,response.ok?maximum:65536);
      let native;try{native=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
      catch{throw fail('OPENFEMA_MCP_RESPONSE_INVALID','The original console returned invalid JSON. Keep any pending original operationId.');}
      return {ok:response.ok,httpStatus:response.status,native};
    }catch(error){
      if(error.code?.startsWith('OPENFEMA_MCP_'))throw error;
      throw fail('OPENFEMA_MCP_SESSION_INTERRUPTED','The original response was interrupted. Read its original operation, then repeat the same operationId and exact payload if needed.');
    }
  }
  async #session(definition){
    const connection=await this.#connection(definition),response=await this.#request(connection,'/api/schema');
    if(!response.ok)throw fail('OPENFEMA_MCP_SESSION_REJECTED','The original workspace rejected its session. Reopen the declared private reference.');
    if(!plain(response.native)||response.native.schema!==SCHEMA||response.native.workspaceId!==definition.workspaceId)
      throw fail('OPENFEMA_MCP_IDENTITY_CHANGED','The running console differs from the host-selected OpenFEMA workspace UUID.');
    return {...connection,schema:response.native};
  }
  #wrap(workspace,definition,response){return {workspace,workspaceId:definition.workspaceId,...response};}
  async #view(session){
    const response=await this.#request(session,'/api/view');
    if(!response.ok)return response;
    if(!plain(response.native)||response.native.schema!==VIEW||response.native.workspaceId!==session.schema.workspaceId||
      !Number.isSafeInteger(response.native.revision)||response.native.revision<0||
      ['captures','editions','portfolios','versions','reviews','acceptances','comparisons','datasets','releases','receipts','exports','operations'].some(k=>!Array.isArray(response.native[k])))
      throw fail('OPENFEMA_MCP_IDENTITY_CHANGED','The original workspace view identity or revision changed unexpectedly.');
    return response;
  }
  async #edition(session,id){
    checked(id,SHA,'original source-edition SHA256');
    const response=await this.#request(session,'/api/edition?editionId='+id);
    if(response.ok&&(!plain(response.native)||response.native.schema!==EDITION||response.native.id!==id||
      !plain(response.native.datasets)||KINDS.some(k=>!plain(response.native.datasets[k])||!Array.isArray(response.native.datasets[k].pages))))
      throw fail('OPENFEMA_MCP_EDITION_CHANGED','The source-edition manifest differs from the selected original identity.');
    return response;
  }
  async #directory(workspace){
    await privateDirectory(this.#config.exportsDirectory);
    const root=await privateDirectory(join(this.#config.exportsDirectory,'openfema-workspaces'),true);
    return privateDirectory(join(root,workspace),true);
  }
  async #files(session,{kind,id}){
    selectionKey({kind,id});
    if(kind==='source'){
      const response=await this.#edition(session,id);if(!response.ok)return response;
      const edition=response.native,files=[];
      for(const dataset of KINDS){
        const d=edition.datasets[dataset];
        const entries=[...['metadataReceipt','fieldsReceipt','metadataEndReceipt'].map(member=>({member,receipt:d[member]})),
          ...d.pages.map((receipt,page)=>({member:'page-'+String(page).padStart(6,'0'),receipt,page}))];
        for(const {member,receipt,page}of entries){
          if(!plain(receipt)||!SHA.test(receipt.sha256??''))
            throw fail('OPENFEMA_MCP_SOURCE_MANIFEST','The original edition is missing a retained source response.');
          const name=dataset+'-'+member+'-'+receipt.sha256.slice(0,12)+'.json';
          files.push(metadata({name,type:'application/json; charset=utf-8',bytes:receipt.bytes,sha256:receipt.sha256},
            {kind,id,file:name},{source:{dataset,member,...(page===undefined?{}:{page}),url:receipt.url,
              status:receipt.status,observedAt:receipt.observedAt,headers:receipt.headers,
              bodyRepresentation:'Original retained HTTP response body bytes'}}));
        }
      }
      return {ok:true,httpStatus:200,native:{kind,id,edition,files}};
    }
    const response=await this.#view(session);if(!response.ok)return response;
    if(kind==='portfolio'){
      const item=selectedVersion(response.native,id),name='OpenFEMA_Portfolio_'+id+'.json';
      return {ok:true,httpStatus:200,native:{kind,id,version:item,files:[metadata({...item,name,type:'application/json; charset=utf-8'},{kind,id,file:name})]}};
    }
    const item=(kind==='export'?response.native.exports:response.native.receipts).find(x=>x.id===id);
    if(!item)return {ok:false,httpStatus:404,native:{error:'OPENFEMA_SELECTION',message:'Select an existing original '+kind+'.'}};
    if(kind==='export')return {ok:true,httpStatus:200,native:{kind,id,export:item,files:[metadata(item,{kind,id,file:item.name})]}};
    if(!Array.isArray(item.downloads)||item.downloads.length!==RECEIPT_FILES.length||
      new Set(item.downloads.map(x=>x.name)).size!==RECEIPT_FILES.length||item.downloads.some(x=>!RECEIPT_FILES.includes(x.name)))
      throw fail('OPENFEMA_MCP_RECEIPT_CHANGED','The native customer receipt must declare all five complete original files.');
    return {ok:true,httpStatus:200,native:{kind,id,intentIds:item.intentIds,dataset:item.dataset,mode:item.mode,
      manifestSha256:item.manifestSha256,files:item.downloads.map(x=>metadata(x,{kind,id,file:x.name}))}};
  }
  async #file(workspace,definition,input){
    const key=selectionKey(input),scope=workspace;
    if((input.offset??0)>0&&input.expectedSha256===undefined)
      throw fail('INVALID_PARAMS','Repeat the original file SHA256 when resuming at a later byte offset.');
    if(input.readId)return this.#reads.read({scope,key,kind:'openfema-'+input.kind,readId:input.readId,
      expectedSha256:input.expectedSha256,offset:input.offset??0,limit:input.limit??65536});
    const session=await this.#session(definition),response=await this.#files(session,input);
    if(!response.ok)return response;
    const files=response.native.files,selected=input.file===undefined&&files.length===1?files[0]:files.find(x=>x.name===input.file);
    if(!selected)throw fail('INVALID_PARAMS','Select one exact filename from merchant_openfema_files.');
    if(input.expectedSha256!==undefined&&input.expectedSha256!==selected.sha256)
      throw fail('OPENFEMA_MCP_FILE_CHANGED','The selected original file differs from the requested SHA256.');
    if((input.offset??0)>selected.bytes)throw fail('INVALID_PARAMS','The requested byte offset exceeds the original file.');
    const route=['source','portfolio'].includes(input.kind)?'/api/objects/'+selected.sha256:
      input.kind==='export'?'/api/exports/'+input.id:'/api/receipts/'+input.id+'/'+encodeURIComponent(selected.name);
    const directory=await this.#directory(workspace);
    return this.#reads.read({scope,key,kind:'openfema-'+input.kind,directory,expectedSha256:selected.sha256,
      offset:input.offset??0,limit:input.limit??65536,load:async()=>{
        const response=await this.#fetch(session.origin+route,{redirect:'error',signal:AbortSignal.timeout(120000),
          headers:{Authorization:'Bearer '+session.token}});
        if(!response.ok){await response.body?.cancel().catch(()=>{});throw fail('OPENFEMA_MCP_FILE_UNAVAILABLE','The original workspace could not return this retained file.');}
        const declared=response.headers.get('content-length');
        if(declared&&(!/^[0-9]+$/.test(declared)||Number(declared)!==selected.bytes)){
          await response.body?.cancel().catch(()=>{});throw fail('OPENFEMA_MCP_FILE_CHANGED','The original response length differs from the selected manifest.');
        }
        const path=join(directory,'.openfema-source-'+randomUUID()+'.partial');
        let writer,reader,transferred=false,complete=false;
        try{
          writer=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
          const digest=createHash('sha256');let size=0;
          for await(const part of response.body??[]){
            const chunk=Buffer.from(part);size+=chunk.length;
            if(size>selected.bytes)throw fail('OPENFEMA_MCP_FILE_CHANGED','The original file exceeds its retained byte count.');
            digest.update(chunk);let offset=0;
            while(offset<chunk.length){
              const result=await writer.write(chunk,offset,chunk.length-offset);
              if(!result.bytesWritten)throw fail('OPENFEMA_MCP_FILE_WRITE','The retained file writer did not advance.');
              offset+=result.bytesWritten;
            }
          }
          if(size!==selected.bytes||digest.digest('hex')!==selected.sha256)
            throw fail('OPENFEMA_MCP_FILE_CHANGED','The original file differs from its retained complete digest.');
          await writer.sync();await writer.close();writer=null;
          reader=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
          // Only the byte-matched complete transport copy is retired. An interrupted
          // prefix remains an owned partial; it is never advertised as a source file.
          await unlink(path);complete=true;transferred=true;
          return {readonlyFileHandle:reader,bytes:selected.bytes,sha256:selected.sha256,name:selected.name,type:selected.type};
        }finally{
          await writer?.close().catch(()=>{});
          if(!transferred)await reader?.close().catch(()=>{});
          if(complete)await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});
        }
      }});
  }
  async #execute(name,args){
    if(name==='merchant_openfema_workspaces')return this.summary;
    const {workspace,...input}=args,definition=this.#definition(workspace);
    if(name==='merchant_openfema_file_release'){
      await this.#reads.release(workspace,input.readId);
      return {workspace,workspaceId:definition.workspaceId,released:true,readId:input.readId};
    }
    if(name==='merchant_openfema_file_read'){
      const result=await this.#file(workspace,definition,input);
      return result.ok===false?this.#wrap(workspace,definition,result):
        {workspace,workspaceId:definition.workspaceId,ok:true,native:result};
    }
    const session=await this.#session(definition);
    if(name==='merchant_openfema_schema')return this.#wrap(workspace,definition,{ok:true,httpStatus:200,native:session.schema});
    if(name==='merchant_openfema_view')return this.#wrap(workspace,definition,await this.#view(session));
    if(name==='merchant_openfema_operation'){
      const result=await this.#request(session,'/api/operation?operationId='+encodeURIComponent(input.operationId));
      if(result.ok&&plain(result.native)&&Object.hasOwn(result.native,'context')){
        const {context,...original}=result.native;result.native={...original,omittedFields:['context']};
      }
      return this.#wrap(workspace,definition,result);
    }
    if(name==='merchant_openfema_edition')return this.#wrap(workspace,definition,await this.#edition(session,input.editionId));
    if(name==='merchant_openfema_files')return this.#wrap(workspace,definition,await this.#files(session,input));
    if(name==='merchant_openfema_archive'||name==='merchant_openfema_version'){
      const response=await this.#view(session);if(!response.ok)return this.#wrap(workspace,definition,response);
      const view=response.native;
      if(name==='merchant_openfema_version')return this.#wrap(workspace,definition,{ok:true,httpStatus:200,native:selectedVersion(view,input.versionId)});
      const offset=input.offset??0,limit=input.limit??100;
      if(offset>0&&input.expectedRevision===undefined)throw fail('INVALID_PARAMS','Continue the archive with its returned expectedRevision.');
      if(input.expectedRevision!==undefined&&input.expectedRevision!==view.revision)
        return this.#wrap(workspace,definition,{ok:false,httpStatus:409,native:{error:'OPENFEMA_REVISION_CHANGED',
          message:'The original collection changed. Restart this archive page at the current revision.',currentRevision:view.revision}});
      let rows=view[input.collection];
      if(!Array.isArray(rows))throw fail('OPENFEMA_MCP_ARCHIVE_CHANGED','The original workspace no longer declares this archive.');
      if(input.portfolioId)rows=rows.filter(row=>row.portfolioId===input.portfolioId||input.collection==='portfolios'&&row.id===input.portfolioId);
      if(offset>rows.length)throw fail('INVALID_PARAMS','The requested archive offset exceeds this original collection.');
      const selected=rows.slice(offset,offset+limit);
      return this.#wrap(workspace,definition,{ok:true,httpStatus:200,native:{collection:input.collection,
        ...(input.portfolioId?{portfolioId:input.portfolioId}:{}),revision:view.revision,expectedRevision:view.revision,
        total:rows.length,offset,limit,rows:selected,nextOffset:offset+selected.length<rows.length?offset+selected.length:null}});
    }
    if(name==='merchant_openfema_rows'){
      const params=new URLSearchParams({versionId:input.versionId,table:input.table,
        offset:String(input.offset??0),limit:String(input.limit??100),search:input.search??'',sort:input.sort??'',direction:input.direction??'asc'});
      if(input.sort&&!session.schema.tableColumns?.[input.table]?.includes(input.sort))
        throw fail('INVALID_PARAMS','Choose an actual source-declared column for this portfolio table.');
      const response=await this.#request(session,'/api/rows?'+params);
      if(response.ok){
        const page=response.native,offset=input.offset??0,limit=input.limit??100;
        if(!plain(page)||page.table!==input.table||page.offset!==offset||page.limit!==limit||
          !Array.isArray(page.rows)||page.rows.length>limit||!Number.isSafeInteger(page.total)||page.total<0||
          offset<page.total&&page.rows.length===0||
          page.nextOffset!==(offset+limit<page.total?offset+limit:null))
          throw fail('OPENFEMA_MCP_ROWS_INVALID','The original portfolio table returned an incomplete or inconsistent page.');
        response.native={...page,versionId:input.versionId};
      }
      return this.#wrap(workspace,definition,response);
    }
    if(name==='merchant_openfema_detail')
      return this.#wrap(workspace,definition,await this.#request(session,'/api/detail?'+new URLSearchParams({versionId:input.versionId,table:input.table,id:input.id})));
    const action=openFemaActionNames.get(name);
    if(!action)throw fail('TOOL_NOT_FOUND','Choose a declared original OpenFEMA operation.');
    const [actionId,,properties]=action,declared=session.schema.actions?.[actionId];
    const nativeFields=actionId==='source.import'?['bundle']:Object.keys(properties);
    if(!Array.isArray(declared)||nativeFields.some(key=>!declared.includes(key)))
      throw fail('OPENFEMA_MCP_ACTION_CHANGED','The installed original action contract differs from this adapter. Reconcile the selected source version.');
    const {operationId,expectedRevision,...payload}=input;
    const request={action:actionId,payload,operationId,expectedRevision};
    let body=request,selectedSource=null;
    if(actionId==='source.import'){
      const selected=definition.sourcePackages?.[payload.sourcePackage];
      if(!selected)throw fail('OPENFEMA_MCP_SOURCE_PACKAGE','Choose an original source-package alias declared by this host.');
      const bytes=await privateBytes(selected.path,MAX_IMPORT);
      if(hash(bytes)!==selected.sha256)throw fail('OPENFEMA_MCP_SOURCE_PACKAGE_CHANGED','The selected original source bundle differs from its declared digest.');
      let bundle;try{bundle=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
      catch{throw fail('OPENFEMA_MCP_SOURCE_PACKAGE_INVALID','Choose a complete original UTF-8 JSON source bundle.');}
      if(!plain(bundle)||bundle.schema!==BUNDLE)throw fail('OPENFEMA_MCP_SOURCE_PACKAGE_INVALID','Choose an original OpenFEMA source bundle.');
      body={...request,payload:{bundle}};
      selectedSource={alias:payload.sourcePackage,label:selected.label,sha256:selected.sha256,bytes:bytes.length};
    }
    if(Buffer.byteLength(JSON.stringify(body))>(actionId==='source.import'?MAX_IMPORT:128*1024))
      throw fail('INVALID_PARAMS','The original action exceeds its declared request byte limit.');
    try{
      const response=await this.#request(session,'/api/action',{body});
      return this.#wrap(workspace,definition,{...response,request,...(selectedSource?{sourcePackage:selectedSource}:{})});
    }catch(error){
      if(!['OPENFEMA_MCP_SESSION_INTERRUPTED','OPENFEMA_MCP_RESPONSE_LIMIT','OPENFEMA_MCP_RESPONSE_INVALID'].includes(error.code))throw error;
      return this.#wrap(workspace,definition,{ok:false,state:'OUTCOME_UNCERTAIN',request,...(selectedSource?{sourcePackage:selectedSource}:{}),
        native:{error:error.code,message:error.message,operationId},
        recovery:'Read the original operation and repeat this exact request with the same operationId. Its native journal reconciles identity before revision.'});
    }
  }
  async call(name,args={}){
    if(this.#closing)throw fail('OPENFEMA_MCP_CLOSING','The OpenFEMA attachment is closing its pending calls and retained reads.');
    const definition=openFemaToolDefinitions.get(name);
    if(!definition)throw fail('TOOL_NOT_FOUND','Choose a declared original OpenFEMA tool.');
    exact(args,Object.keys(definition.properties),definition.required);
    for(const [key,value]of Object.entries(args))validateOpenFemaToolField(value,definition.properties[key],key);
    const task=Promise.resolve().then(()=>this.#execute(name,args));this.#pending.add(task);
    try{return await task;}finally{this.#pending.delete(task);}
  }
  close(){
    if(!this.#close){
      this.#closing=true;this.#close=(async()=>{await Promise.allSettled([...this.#pending]);await this.#reads.close();})()
        .catch(error=>{this.#close=undefined;throw error;});
    }
    return this.#close;
  }
}
