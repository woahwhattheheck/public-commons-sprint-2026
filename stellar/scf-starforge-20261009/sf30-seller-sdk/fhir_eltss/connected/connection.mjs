// MIT. Borrow the original private eLTSS operator, or own its normal native serve process.
import {join,dirname,resolve,isAbsolute,basename} from 'node:path';
import {realpath,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {privateSupportDirectory} from '../../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import {readSourceFile,fileIdentity,responseBytes,responseFile,inputSnapshot,streamFile} from './files.mjs';
import {CONNECTION_SCHEMA,OPERATOR_SCHEMA,WORKSPACE_SCHEMA,MAX_RESPONSE_BYTES,MAX_PACKET_BYTES,MAX_JSON_INPUT,
  UUID,ALIAS,SHA,plain,need,checked,text,exact,decode,encode,digest,canonical,failure} from './contracts.mjs';
const CLI=fileURLToPath(new URL('../cli.py',import.meta.url));
const pathAt=(value,base)=>{
  text(value,'Original host path',4096);return isAbsolute(value)?resolve(value):resolve(base,value);
};
async function optional(path){
  try{return decode(await readSourceFile(path,{privateFile:true,maxBytes:65536}));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function identity(directory){
  await privateSupportDirectory(directory);await privateSupportDirectory(join(directory,'eltss'));
  need(await realpath(directory)===directory,'ELTSS_DIRECTORY_ALIAS');
  const marker=await optional(join(directory,'workspace.json')),id=await optional(join(directory,'eltss','identity.json'));
  need(marker?.schema===WORKSPACE_SCHEMA && id?.schema===WORKSPACE_SCHEMA,'ELTSS_WORKSPACE_INVALID',
    'Initialize the original eLTSS workspace or receive its complete archive before connecting it.');
  return checked(id.workspaceId,UUID,'native workspace ID');
}
/** All filesystem paths and launch permissions are private host configuration. */
export async function readEltssConfiguration(filename){
  filename=resolve(filename);
  const raw=decode(await readSourceFile(filename,{privateFile:true,maxBytes:1024*1024})),base=dirname(filename);
  exact(raw,['schema','workspaces'],['schema','workspaces']);
  need(raw.schema===CONNECTION_SCHEMA && plain(raw.workspaces) &&
    Object.keys(raw.workspaces).length>=1 && Object.keys(raw.workspaces).length<=32,'ELTSS_CONFIGURATION_INVALID');
  const workspaces=Object.create(null),seen=new Set();
  for(const [alias,item] of Object.entries(raw.workspaces)){
    checked(alias,ALIAS,'workspace alias');
    exact(item,['directory','label','allowStart','credentialsFile','inputs'],['directory']);
    const directory=pathAt(item.directory,base),workspaceId=await identity(directory),allowStart=item.allowStart??false;
    need(typeof allowStart==='boolean' && !seen.has(directory),'ELTSS_CONFIGURATION_INVALID');
    seen.add(directory);
    let credentialsFile;
    if(item.credentialsFile!==undefined){
      credentialsFile=pathAt(item.credentialsFile,base);
      await readSourceFile(credentialsFile,{privateFile:true,maxBytes:1024*1024});
    }
    const inputs=Object.create(null),declared=item.inputs??{};
    need(plain(declared) && Object.keys(declared).length<=64,'ELTSS_CONFIGURATION_INVALID');
    for(const [name,input] of Object.entries(declared)){
      checked(name,ALIAS,'host input alias');exact(input,['file','sha256','label'],['file']);
      const file=pathAt(input.file,base),selected=await fileIdentity(file,{maxBytes:MAX_PACKET_BYTES});
      if(input.sha256!==undefined)need(checked(input.sha256,SHA,'input SHA256')===selected.sha256,'ELTSS_INPUT_CHANGED');
      inputs[name]={file,...selected,label:text(input.label??name,'Input label')};
    }
    const selected={directory,workspaceId,allowStart,label:text(item.label??alias,'Workspace label'),inputs,
      ...(credentialsFile?{credentialsFile}:{})};
    workspaces[alias]={...selected,selectionSha256:digest(Buffer.from(JSON.stringify(canonical(selected))))};
  }
  return {schema:CONNECTION_SCHEMA,workspaces};
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class EltssConnection {
  #binding;#knownId;#owned=null;#opening=null;#closing=false;#closed=false;#pendingImport=null;
  constructor(binding){this.#binding=binding;this.#knownId=binding.workspaceId;}
  get summary(){return {workspaceId:this.#knownId,allowStart:this.#binding.allowStart,owned:Boolean(this.#owned),closed:this.#closed};}
  async #live({adoptIdentity=false}={}){
    let saved=await optional(join(this.#binding.directory,'eltss','operator-connection.json'));
    if(!saved || saved.active!==true)return null;
    need(saved.schema===OPERATOR_SCHEMA && saved.workspace===this.#binding.directory &&
      typeof saved.accessToken==='string' && /^[A-Za-z0-9_-]{43}$/.test(saved.accessToken),
      'ELTSS_CONNECTION_CHANGED','Use the original private eLTSS operator connection file.');
    checked(saved.instanceId,UUID,'operator instance');checked(saved.workspaceId,UUID,'workspace ID');
    const url=new URL(saved.url);
    need(url.protocol==='http:' && url.hostname==='127.0.0.1' && url.port &&
      Number(url.port)>=1 && Number(url.port)<=65535 && url.pathname==='/' &&
      !url.username && !url.password && !url.hash && !url.search,'ELTSS_CONNECTION_CHANGED');
    if(this.#pendingImport){
      const pending=this.#pendingImport;
      need(saved.instanceId===pending.instanceId,'ELTSS_IMPORT_OWNER_CHANGED',
        'Reopen the private configuration to select this restarted native workspace.');
      // The native state read waits for the original import mutex. A lost POST
      // reply therefore reconciles the selected complete archive before an ID
      // change can be adopted, even when the descriptor was refreshed meanwhile.
      const observed=await fetch(new URL('/api/state',url),{redirect:'error',signal:AbortSignal.timeout(600000),
        headers:{authorization:'Bearer '+saved.accessToken,accept:'application/json'}});
      const state=decode(await responseBytes(observed,MAX_RESPONSE_BYTES));
      need(observed.ok && Array.isArray(state.receives),'ELTSS_IMPORT_RECONCILIATION_REQUIRED');
      const receiving=state.receives.find(item=>item.archiveSha256===pending.archiveSha256 || item.id===pending.archiveSha256);
      need(receiving?(receiving.workspaceId===state.workspaceId || receiving.state!=='complete' && state.workspaceId===pending.workspaceId):state.workspaceId===pending.workspaceId,
        'ELTSS_IMPORT_SELECTION_CHANGED','The native receiving record belongs to another complete archive or workspace.');
      saved=await optional(join(this.#binding.directory,'eltss','operator-connection.json'));
      need(saved?.active===true && saved.schema===OPERATOR_SCHEMA && saved.workspace===this.#binding.directory &&
        saved.instanceId===pending.instanceId && saved.workspaceId===state.workspaceId && saved.url===url.href &&
        typeof saved.accessToken==='string' && /^[A-Za-z0-9_-]{43}$/.test(saved.accessToken),
        'ELTSS_IMPORT_RECONCILIATION_REQUIRED');
      this.#knownId=state.workspaceId;this.#pendingImport=null;
    }
    const current=await identity(this.#binding.directory);
    need(current===saved.workspaceId && (adoptIdentity || current===this.#knownId),'ELTSS_WORKSPACE_CHANGED',
      'The connected directory now contains another workspace. Reopen its private host configuration.');
    let response;
    try{response=await fetch(new URL('/api/operator',url),{redirect:'error',signal:AbortSignal.timeout(5000),
      headers:{authorization:'Bearer '+saved.accessToken,accept:'application/json'}});}
    catch{return null;}
    const actual=decode(await responseBytes(response,65536));
    need(response.ok && actual.schema===OPERATOR_SCHEMA && actual.active===true &&
      actual.workspace===saved.workspace && actual.workspaceId===saved.workspaceId &&
      actual.instanceId===saved.instanceId && actual.processId===saved.processId &&
      actual.url===saved.url,'ELTSS_CONNECTION_CHANGED','The live native owner differs from its private descriptor.');
    this.#knownId=current;return saved;
  }
  async #ensure(start=false){
    need(!this.#closing && !this.#closed,'ELTSS_CLOSING');
    if(this.#opening)return this.#opening;
    this.#opening=(async()=>{
      const existing=await this.#live();if(existing)return existing;
      need(start && this.#binding.allowStart,'ELTSS_NOT_RUNNING',
        'Open this workspace in Applications or use operator_open with allowStart in its private host configuration.');
      if(this.#owned)await this.#stopOwned();
      const python=process.env.SF30_ELTSS_PYTHON??process.env.SF30_XML_PYTHON??process.env.CODEX_PRIMARY_RUNTIME_PYTHON??'python3',
        args=['-B',CLI,'serve','--workspace',this.#binding.directory,'--expected-workspace-id',this.#knownId,'--port','0',
          ...(this.#binding.credentialsFile?['--credentials-file',this.#binding.credentialsFile]:[])];
      const child=spawn(python,args,{stdio:['ignore','pipe','pipe'],env:{...process.env,
        SF30_ELTSS_NODE:process.execPath,SF30_XML_NODE:process.execPath}});
      const owned={child,exited:false,exit:null,stderr:'',stdout:''};this.#owned=owned;
      owned.done=new Promise(resolve=>{
        child.once('error',error=>{owned.exited=true;owned.exit={error:error.code??error.name};resolve();});
        child.once('exit',(code,signal)=>{owned.exited=true;owned.exit={code,signal};resolve();});
      });
      child.stdout.on('data',chunk=>{owned.stdout=(owned.stdout+chunk.toString('utf8')).slice(-16384);});
      child.stderr.on('data',chunk=>{owned.stderr=(owned.stderr+chunk.toString('utf8')).slice(-8192);});
      // Workspace.flock arbitrates ownership. A startup failure never deletes
      // another owner's lease or starts another acquisition controller.
      try{
        const until=Date.now()+30000;
        while(Date.now()<until){
          need(!owned.exited,'ELTSS_START_FAILED','The original native serve process exited.',
            {exit:owned.exit,diagnostic:owned.stderr});
          const current=await this.#live();
          if(current){
            need(current.processId===child.pid,'ELTSS_START_CONFLICT',
              'Another original operator owns this workspace; read and borrow it after releasing this child.');
            owned.instanceId=current.instanceId;return current;
          }
          await pause(100);
        }
        throw failure('ELTSS_START_PENDING','The original native serve process has not announced its connection.');
      }catch(error){await this.#stopOwned();throw error;}
    })();
    try{return await this.#opening;}finally{this.#opening=null;}
  }
  async #stopOwned(){
    const owned=this.#owned;if(!owned)return;
    if(!owned.exited)owned.child.kill('SIGINT');
    let timer;
    try{
      await Promise.race([owned.done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure(
        'ELTSS_CLOSE_PENDING','The original native server is draining; retry release on this same connection.')),600000);})]);
    }finally{clearTimeout(timer);}
    if(this.#owned===owned)this.#owned=null;
  }
  async open(){
    const value=await this.#ensure(true);
    return {state:'OPEN',ownership:this.#owned?'OWNED':'BORROWED',workspaceId:value.workspaceId,
      instanceId:value.instanceId,selectionSha256:this.#binding.selectionSha256};
  }
  async release(){
    if(this.#opening)await this.#opening;
    const owned=Boolean(this.#owned);await this.#stopOwned();
    return {state:'RELEASED',ownership:owned?'OWNED':'BORROWED',originalOperatorClosed:owned,workspaceId:this.#knownId};
  }
  async hostInput(name,root,expectedSha256){
    checked(name,ALIAS,'host input alias');const selected=this.#binding.inputs[name];
    need(selected,'ELTSS_INPUT_NOT_CONFIGURED','Select a complete original input declared by the host.');
    if(expectedSha256!==undefined)need(checked(expectedSha256,SHA,'input SHA256')===selected.sha256,'ELTSS_INPUT_CHANGED');
    return {...await inputSnapshot(selected,root),name:basename(selected.file),label:selected.label};
  }
  async request(method,path,{input,upload,outputDirectory,headers={},adoptWorkspace=false,jsonUpload=false,operationId}={}){
    const original=await this.#ensure(),mutates=method!=='GET';
    need(path.startsWith('/api/') && !path.startsWith('//') && !/[\r\n\0]/.test(path),'ELTSS_ROUTE_INVALID');
    let stream,body;
    if(upload){
      if(jsonUpload)need(upload.bytes<=MAX_JSON_INPUT,'ELTSS_INPUT_LIMIT','The original complete JSON input exceeds 4 MiB.');
      stream=await streamFile(upload);body=stream.body;
    }
    else if(input!==undefined){
      body=JSON.stringify(input);
      need(Buffer.byteLength(body)<=MAX_JSON_INPUT,'ELTSS_INPUT_LIMIT','Use the original native JSON request limit.');
    }
    if(adoptWorkspace){
      need(upload && typeof upload.sha256==='string','ELTSS_IMPORT_SOURCE_REQUIRED');
      this.#pendingImport={instanceId:original.instanceId,workspaceId:original.workspaceId,archiveSha256:upload.sha256};
    }
    let response;
    try{
      response=await fetch(new URL(path,original.url),{method,redirect:'error',signal:AbortSignal.timeout(600000),
        headers:{authorization:'Bearer '+original.accessToken,accept:'application/json',...headers,
          ...(body===undefined?{}:{'content-type':upload&&!jsonUpload?'application/octet-stream':'application/json',
            ...(upload?{'content-length':String(upload.bytes)}:{})})},
        ...(body===undefined?{}:{body,...(upload?{duplex:'half'}:{})})});
    }catch(error){
      throw failure(mutates?'ELTSS_REQUEST_UNCERTAIN':'ELTSS_CONNECTION_UNAVAILABLE',
        mutates?'Read the original saved operation or content identity before continuing this request.':
          'Reopen the original operator before reading.',
        {workspaceId:original.workspaceId,instanceId:original.instanceId,method,path,
          ...(operationId?{operationId}:{}),cause:error.code??error.name});
    }finally{if(stream){stream.body.destroy();await stream.close();}}
    const contentType=response.headers.get('content-type')??'application/octet-stream',
      json=/^application\/json(?:;|$)/i.test(contentType),meta={ok:response.ok,status:response.status,
        contentType,workspaceId:original.workspaceId,instanceId:original.instanceId,headers:Object.fromEntries(
          ['content-type','content-length','retry-after','date'].filter(name=>response.headers.has(name)).map(name=>[name,response.headers.get(name)]))};
    try{
      let result;
      if(outputDirectory && response.ok)result={...meta,file:await responseFile(response,outputDirectory,MAX_PACKET_BYTES)};
      else{
        const bytes=await responseBytes(response,MAX_RESPONSE_BYTES);result={...meta,bytes};
        if(json)result.value=decode(bytes);
      }
      if(adoptWorkspace){
        const current=await this.#live({adoptIdentity:true});
        need(current && current.instanceId===original.instanceId,'ELTSS_CONNECTION_CHANGED');
        result.previousWorkspaceId=original.workspaceId;result.workspaceId=current.workspaceId;
      }
      return result;
    }catch(error){
      throw failure(mutates?'ELTSS_REQUEST_UNCERTAIN':error.code??'ELTSS_READ_INTERRUPTED',
        mutates?'The original mutation returned or is retained. Read its saved operation before a new action.':error.message,
        {workspaceId:original.workspaceId,instanceId:original.instanceId,method,path,
          ...(operationId?{operationId}:{}),cause:error.code??error.name});
    }
  }
  async close(){
    if(this.#closed)return;
    this.#closing=true;
    try{await this.release();this.#closed=true;}finally{this.#closing=false;}
  }
}
