// MIT. Attach the original source-owned merchant MCP to a running native workspace.
import {dirname,resolve} from 'node:path';
import {readOwned} from '../stellar-expert/store.mjs';
import {CONNECTION_SCHEMA,STARTUP_SCHEMA,ACTIONS} from './schema.mjs';
import {sensorThingsToolDefinitions,validateSensorThingsField,ALIAS,SHA,UUID} from './mcp-protocol.mjs';
import {identity,plain,fields,fault} from './contract.mjs';
export {sensorThingsWorkspaceTools} from './mcp-protocol.mjs';
const LIMIT=24*1024*1024,MAX_FILES=500;
function checked(value,pattern,label){if(typeof value!=='string'||!pattern.test(value))throw fault('MCP_CONFIGURATION','Use the original '+label+'.');return value;}
async function privateJSON(path,maximum=1024*1024){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readOwned(path,maximum)));}
function hostPath(value,base){if(typeof value!=='string'||!value||value.includes('\0'))throw fault('MCP_PATH','Select an original host file.');return resolve(base,value);}
export async function readSensorThingsWorkspaceConfiguration(path){
  path=resolve(path);const raw=await privateJSON(path);fields(raw,['schema','workspaces'],['schema','workspaces']);
  if(raw.schema!==CONNECTION_SCHEMA||!plain(raw.workspaces)||Object.keys(raw.workspaces).length<1||Object.keys(raw.workspaces).length>32)
    throw fault('MCP_CONFIGURATION','Declare one to32 original SensorThings workspace connections.');
  const workspaces=Object.create(null);
  for(const [alias,value] of Object.entries(raw.workspaces)){
    checked(alias,ALIAS,'workspace alias');fields(value,['label','workspaceId','consoleUrlFile','consoleUrlEnv','applicationUrlFile'],['workspaceId']);
    const references=['consoleUrlFile','consoleUrlEnv','applicationUrlFile'].filter(k=>Object.hasOwn(value,k));
    if(references.length!==1)throw fault('MCP_CONFIGURATION','Select exactly one original private session file/environment or managed Applications URL record.');
    const key=references[0];
    if(value.label!==undefined&&(typeof value.label!=='string'||!value.label.trim()||value.label.length>200))throw fault('MCP_CONFIGURATION','Use a short original workspace label.');
    workspaces[alias]={label:value.label??alias,workspaceId:checked(value.workspaceId,UUID,'workspace UUID'),
      [key]:key==='consoleUrlEnv'?checked(value[key],/^[A-Za-z_][A-Za-z0-9_]{0,127}$/,'session environment name'):hostPath(value[key],dirname(path))};
  }
  return {schema:CONNECTION_SCHEMA,workspaces};
}
function connectionUrl(raw){
  let u;try{u=new URL(raw);}catch{}
  if(!u||u.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||
      u.pathname!=='/'||u.search||!/^#[A-Za-z0-9_-]{32,200}$/.test(u.hash))
    throw fault('MCP_SESSION','Use the original loopback session URL with its private fragment token.');
  return {origin:u.origin,token:u.hash.slice(1)};
}
async function responseBytes(response){
  const length=response.headers.get('content-length');
  if(length!==null&&/^\d+$/.test(length)&&Number(length)>LIMIT){await response.body?.cancel().catch(()=>{});throw fault('MCP_RESPONSE_LIMIT','Use the original paged view or held-file read for this response.',413);}
  const parts=[];let bytes=0;
  try{for await(const part of response.body??[]){bytes+=part.length;if(bytes>LIMIT)throw fault('MCP_RESPONSE_LIMIT','The native response exceeds this endpoint capacity.',413);parts.push(part);}}
  catch(e){await response.body?.cancel().catch(()=>{});throw e;}
  return Buffer.concat(parts,bytes);
}
function validFile(file){
  if(!plain(file)||typeof file.name!=='string'||!file.name||file.name.length>255||/[\\/\u0000-\u001f\u007f]/.test(file.name)||!plain(file.selection))
    throw fault('MCP_FILE_IDENTITY','The original file owner returned incomplete metadata.',409);
  const generated=file.selection.kind==='publisher'&&file.selection.file==='draft-review'&&
    file.retention==='ORIGINAL_GENERATED_READ_SESSION'&&file.verification==='SNAPSHOT_SHA_RETURNED_BY_FIRST_READ';
  if(generated&&file.bytes===null&&file.sha256===null)return {...file,materialized:false};
  if(!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>8*1024*1024*1024||!SHA.test(file.sha256??''))
    throw fault('MCP_FILE_IDENTITY','The retained original file owner returned incomplete byte/hash metadata.',409);
  return {...file,materialized:true};
}
export class MerchantSensorThingsWorkspaces{
  #config;#environment;#fetch;#pending=new Set();#reads=new Map();#closing=false;#closePromise=null;
  constructor(config,{environment=process.env,fetchImpl=fetch}={}){
    this.#config=config?.schema===CONNECTION_SCHEMA?{sensorthingsWorkspaces:config}:config;
    this.#environment=environment;this.#fetch=fetchImpl;
  }
  get summary(){
    return {configured:Boolean(this.#config?.sensorthingsWorkspaces),workspaces:Object.entries(this.#config?.sensorthingsWorkspaces?.workspaces??{}).map(([workspace,v])=>({
      workspace,label:v.label,workspaceId:v.workspaceId,
      connection:v.applicationUrlFile?'ORIGINAL_APPLICATIONS_RECORD':v.consoleUrlFile?'ORIGINAL_PRIVATE_URL_FILE':'ORIGINAL_PRIVATE_URL_ENV',
      activeFileReads:[...this.#reads.values()].filter(r=>r.workspace===workspace).map(({readId,sha256,selection})=>({readId,sha256,selection})),
      ownership:'EXISTING_SENSORTHINGS_WORKSPACE'
    }))};
  }
  #definition(alias){
    checked(alias,ALIAS,'workspace alias');const value=this.#config?.sensorthingsWorkspaces?.workspaces?.[alias];
    if(!value)throw fault('MCP_NOT_CONFIGURED','Choose an original configured workspace alias.',404);return value;
  }
  async #connection(definition){
    let raw;
    try{
      if(definition.applicationUrlFile){
        const saved=await privateJSON(definition.applicationUrlFile,65536);
        if(saved.original?.schema!==STARTUP_SCHEMA||saved.original.workspaceId!==definition.workspaceId||typeof saved.url!=='string')
          throw fault('MCP_APPLICATION_CHANGED','The original managed Applications record belongs to another workspace.',409);
        raw=saved.url;
      }else if(definition.consoleUrlFile)raw=new TextDecoder('utf-8',{fatal:true}).decode(await readOwned(definition.consoleUrlFile,4096)).trim();
      else raw=this.#environment[definition.consoleUrlEnv];
    }catch(e){if(e.code?.startsWith('SENSORTHINGS_'))throw e;throw fault('MCP_SESSION_UNAVAILABLE','Reopen the original session and its host-selected private reference.',503);}
    return {...connectionUrl(raw),workspaceId:definition.workspaceId};
  }
  async #request(connection,path,{body,operationId}={}){
    try{
      const response=await this.#fetch(connection.origin+path,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(120000),
        headers:{Authorization:'Bearer '+connection.token,'X-SensorThings-Workspace':connection.workspaceId,
          ...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      const received=await responseBytes(response);let native;
      try{native=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(received));}catch{throw fault('MCP_RESPONSE','The original native endpoint did not return complete JSON.',502);}
      const uuid=response.headers.get('x-sensorthings-workspace');
      if(uuid!==connection.workspaceId)throw fault('MCP_IDENTITY_CHANGED','The endpoint responded as a different original workspace.',409);
      return {ok:response.ok,httpStatus:response.status,native};
    }catch(error){
      if(error.code?.startsWith('SENSORTHINGS_')&&!operationId)throw error;
      throw fault(operationId?'MCP_OUTCOME_UNCERTAIN':'MCP_CONNECTION_UNAVAILABLE',
        operationId?'The original operation reply was not received. Read this same operationId before repeating its exact request.':'The running original workspace did not return a complete response.',
        503,{...(operationId?{operationId}:{}),cause:error.code??'TRANSPORT'});
    }
  }
  async #session(definition){
    const connection=await this.#connection(definition),result=await this.#request(connection,'/api/schema');
    if(!result.ok||result.native?.schema!=='stellar-forge.sensorthings-schema.v1'||result.native.workspaceId!==definition.workspaceId)
      throw fault('MCP_IDENTITY_CHANGED','Select the same original SensorThings workspace and its current private session.',409);
    return {...connection,schema:result.native};
  }
  async #fileRead(workspace,session,input){
    const key=identity(input.selection);
    if(input.readId){
      const owned=this.#reads.get(workspace+':'+input.readId);
      if(!owned)throw fault('MCP_READ_NOT_FOUND','This client no longer owns the selected original readId. Resume the same selector, SHA256 and offset without it.',404);
      if(owned.key!==key||owned.sha256!==input.expectedSha256)throw fault('MCP_FILE_READ','Continue only this client’s original readId, selector and SHA256.',409);
    }else if((input.offset??0)>0&&!input.expectedSha256)throw fault('MCP_FILE_IDENTITY','Repeat the original SHA256 when resuming after a process/read restart.');
    const response=await this.#request(session,'/api/files/read',{body:input});
    if(response.ok){
      const r=response.native,f=r.file;
      if(!UUID.test(r.readId??'')||!f||!SHA.test(f.sha256??'')||!Number.isSafeInteger(f.bytes)||f.bytes<0||
          input.expectedSha256&&f.sha256!==input.expectedSha256||r.offset!==(input.offset??0)||!Number.isSafeInteger(r.bytesRead)||r.bytesRead<0||
          r.bytesRead>(input.limit??65536)||r.encoding!=='base64'||typeof r.data!=='string')
        throw fault('MCP_FILE_CHANGED','The native original chunk metadata is inconsistent.',409);
      const decoded=Buffer.from(r.data,'base64');
      if(decoded.length!==r.bytesRead||decoded.toString('base64')!==r.data||r.offset+r.bytesRead>f.bytes||
          r.nextOffset!==(r.offset+r.bytesRead<f.bytes?r.offset+r.bytesRead:null))
        throw fault('MCP_FILE_CHANGED','The original chunk length or continuation differs.',409);
      const readKey=workspace+':'+r.readId;
      if(r.nextOffset===null)this.#reads.delete(readKey);
      else this.#reads.set(readKey,{workspace,readId:r.readId,key,sha256:f.sha256,selection:input.selection,connection:session});
    }else if(input.readId&&response.httpStatus===404)this.#reads.delete(workspace+':'+input.readId);
    return response;
  }
  async #execute(name,args){
    if(name==='merchant_sensorthings_workspaces')return this.summary;
    const {workspace,...input}=args,definition=this.#definition(workspace),session=await this.#session(definition);
    const wrap=response=>({workspace,workspaceId:definition.workspaceId,...response});
    if(name==='merchant_sensorthings_schema')return wrap({ok:true,httpStatus:200,native:session.schema});
    if(name==='merchant_sensorthings_file_release'){
      const key=workspace+':'+input.readId,owned=this.#reads.get(key);
      if(!owned)return wrap({ok:true,httpStatus:200,native:{readId:input.readId,released:true,alreadyAbsent:true}});
      const r=await this.#request(session,'/api/files/release',{body:{readId:input.readId}});
      if(r.ok)this.#reads.delete(key);return wrap(r);
    }
    if(name==='merchant_sensorthings_file_read')return wrap(await this.#fileRead(workspace,session,input));
    if(name==='merchant_sensorthings_files'){
      const r=await this.#request(session,'/api/files?selection='+encodeURIComponent(JSON.stringify(input.selection)));
      if(r.ok){
        if(!Array.isArray(r.native?.files))throw fault('MCP_FILE_MANIFEST','The original file owner did not return a complete file list.',409);
        const files=r.native.files.map(validFile),manifestSha256=identity(files.map(({selection,name,type,bytes,sha256})=>({selection,name,type,bytes,sha256})));
        const offset=input.offset??0,limit=input.limit??100;
        if(offset>0&&input.manifestSha256!==manifestSha256||input.manifestSha256&&input.manifestSha256!==manifestSha256)
          throw fault('MCP_FILE_MANIFEST_CHANGED','Continue the same original file metadata edition or restart its first page.',409);
        const page=files.slice(offset,offset+limit);r.native={...r.native,files:page,total:files.length,offset,
          nextOffset:offset+page.length<files.length?offset+page.length:null,manifestSha256};
      }return wrap(r);
    }
    if(name==='merchant_sensorthings_action'){
      fields(input.payload,ACTIONS[input.action]??[]);
      return wrap(await this.#request(session,'/api/action',{body:input,operationId:input.operationId}));
    }
    let route;
    if(name==='merchant_sensorthings_view')route='/api/view';
    if(name==='merchant_sensorthings_catalog')route='/api/catalogs/'+input.catalogId+'/rows?offset='+(input.offset??0)+'&limit='+(input.limit??100);
    if(name==='merchant_sensorthings_edition')route='/api/editions/'+input.editionId+'/'+(input.mode??'metadata');
    if(name==='merchant_sensorthings_rows')route='/api/editions/'+input.editionId+'/rows?table='+input.table+'&offset='+(input.offset??0)+'&limit='+(input.limit??100);
    if(name==='merchant_sensorthings_capture'){
      const keys=['offset','limit','taskId','expectedRevision'];
      if(input.part===undefined&&keys.some(key=>input[key]!==undefined))throw fault('MCP_CAPTURE_PART','Select a capture part before requesting journal pages.');
      const query=new URLSearchParams();
      for(const key of ['part',...keys])if(input[key]!==undefined)query.set(key,String(input[key]));
      route='/api/captures/'+input.captureId+(query.size?'?'+query:'');
    }
    if(name==='merchant_sensorthings_release')route='/api/releases/'+encodeURIComponent(input.releaseId);
    if(name==='merchant_sensorthings_publisher')route='/api/publishers/'+input.datasetId;
    if(name==='merchant_sensorthings_operation')route='/api/operations/'+input.operationId;
    if(!route)throw fault('MCP_TOOL','Choose an original SensorThings tool.');
    const r=await this.#request(session,route);
    if(r.ok&&name==='merchant_sensorthings_view'&&(r.native?.workspaceId!==definition.workspaceId||r.native.schema!=='stellar-forge.sensorthings-view.v1'))
      throw fault('MCP_IDENTITY_CHANGED','The original workspace view identity differs.',409);
    if(r.ok&&name==='merchant_sensorthings_capture'&&input.part!==undefined){
      const page=r.native;
      if(page?.schema!=='stellar-forge.sensorthings-capture-page.v1'||page.workspaceId!==definition.workspaceId||
          page.captureId!==input.captureId||page.part!==input.part||!Number.isSafeInteger(page.revision)||page.revision<0||
          input.expectedRevision!==undefined&&page.revision!==input.expectedRevision)
        throw fault('MCP_CAPTURE_PAGE','The original capture page identity or revision differs.',409);
      if(input.part!=='summary'){
        const offset=input.offset??0;
        if(!Array.isArray(page.rows)||!Number.isSafeInteger(page.total)||page.total<0||page.offset!==offset||
            page.rows.length>(input.limit??100)||page.rows.some((row,index)=>row?.index!==offset+index||!plain(row.record))||
            page.nextOffset!==(offset+page.rows.length<page.total?offset+page.rows.length:null))
          throw fault('MCP_CAPTURE_PAGE','The original capture journal page is incomplete.',409);
      }
    }
    if(r.ok&&name==='merchant_sensorthings_rows'){
      if(!Array.isArray(r.native?.rows)||!Number.isSafeInteger(r.native.total))throw fault('MCP_ROWS','The original row page is incomplete.',409);
      const next=(input.offset??0)+r.native.rows.length;r.native={...r.native,nextOffset:next<r.native.total?next:null};
    }
    return wrap(r);
  }
  call(name,args={}){
    if(this.#closing)throw fault('MCP_CLOSING','The original provider is closing.',503);
    const definition=sensorThingsToolDefinitions.get(name);
    if(!definition)throw fault('MCP_TOOL','Choose an advertised original SensorThings tool.');
    validateSensorThingsField(args,{type:'object',properties:definition.properties,required:definition.required,additionalProperties:false});
    const pending=this.#execute(name,args);this.#pending.add(pending);void pending.finally(()=>this.#pending.delete(pending)).catch(()=>{});return pending;
  }
  close(){
    if(this.#closePromise)return this.#closePromise;this.#closing=true;
    this.#closePromise=(async()=>{
      await Promise.allSettled([...this.#pending]);
      const outcomes=await Promise.allSettled([...this.#reads].map(async([key,read])=>{
        const r=await this.#request(read.connection,'/api/files/release',{body:{readId:read.readId}});
        if(!r.ok)throw fault('MCP_CLOSE_INCOMPLETE','An original native file read still needs closing.',503);
        this.#reads.delete(key);
      }));
      if(outcomes.some(r=>r.status==='rejected'))throw fault('MCP_CLOSE_INCOMPLETE','Retry closing this same provider to release its remaining original file reads.',503);
    })();void this.#closePromise.catch(()=>{this.#closePromise=null;});return this.#closePromise;
  }
}
