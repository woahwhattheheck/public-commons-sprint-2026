// MIT. Bind and borrow the original private reviewer HTTP/MCP controller.
import {join,dirname,resolve,isAbsolute} from 'node:path';
import {lstat,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {readSourceFile,MAX_PACKET_BYTES} from '../workspace.mjs';
import {startReviewerWorkbench,WORKBENCH_CONNECTION_SCHEMA,WORKBENCH_READY_SCHEMA} from '../workbench.mjs';
import {privateSupportDirectory} from '../../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import {openMerchantFileClient} from '../../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import {CONNECTION_SCHEMA,MAX_RESPONSE_BYTES,UUID,ALIAS,SHA,plain,need,checked,text,exact,decode,digest,canonical,failure}
  from './contracts.mjs';
const sourceRoot = fileURLToPath(new URL('../../../../../',import.meta.url));
const pathAt = (value,base) => {
  need(typeof value==='string' && value && !value.includes('\0'),'GRANT_REVIEWER_CONFIGURATION_INVALID',
    'Select an original host path.');
  return isAbsolute(value)?resolve(value):resolve(base,value);
};
async function optional(path) {
  try { return decode(await readSourceFile(path,{privateFile:true,maxBytes:65536})); }
  catch(error) { if(error.code==='ENOENT')return null; throw error; }
}
/** These paths and launch permissions are local host configuration, never tool arguments. */
export async function readReviewerConfiguration(filename) {
  filename=resolve(filename);
  const raw=decode(await readSourceFile(filename,{privateFile:true,maxBytes:1024*1024})),base=dirname(filename);
  exact(raw,['schema','workspaces'],['schema','workspaces']);
  need(raw.schema===CONNECTION_SCHEMA && plain(raw.workspaces) &&
    Object.keys(raw.workspaces).length>=1 && Object.keys(raw.workspaces).length<=32,
  'GRANT_REVIEWER_CONFIGURATION_INVALID','Declare one through32 original reviewer workspaces.');
  const workspaces=Object.create(null),directories=new Set();
  for(const [alias,item] of Object.entries(raw.workspaces)) {
    checked(alias,ALIAS,'workspace alias');
    exact(item,['directory','label','allowStart','workbenchId','inputs'],['directory']);
    const directory=pathAt(item.directory,base),allowStart=item.allowStart??false;
    need(typeof allowStart==='boolean' && !directories.has(directory),'GRANT_REVIEWER_CONFIGURATION_INVALID',
      'Give each original directory one alias and explicit boolean launch permission.');
    directories.add(directory);
    let header;
    try {
      await privateSupportDirectory(directory);
      need(await realpath(directory)===directory,'GRANT_REVIEWER_DIRECTORY_ALIAS');
      header=await optional(join(directory,'workbench.json'));
    } catch(error) {
      if(error.code!=='ENOENT' || !allowStart)throw error;
      await privateSupportDirectory(dirname(directory));
      need(await realpath(dirname(directory))===dirname(directory),'GRANT_REVIEWER_DIRECTORY_ALIAS');
    }
    if(header) {
      need(header.schema==='stellar-forge.grant-reviewer-workbench.v1','GRANT_REVIEWER_WORKBENCH_CHANGED');
      checked(header.id,UUID,'workbench ID');
    }
    if(item.workbenchId!==undefined)checked(item.workbenchId,UUID,'workbench ID');
    need(!header || item.workbenchId===undefined || header.id===item.workbenchId,
      'GRANT_REVIEWER_WORKBENCH_CHANGED','The configured original directory belongs to another workbench.');
    const declared=item.inputs??{};
    need(plain(declared) && Object.keys(declared).length<=64,'GRANT_REVIEWER_CONFIGURATION_INVALID',
      'Declare up to64 original packet-file aliases.');
    const inputs=Object.create(null);
    for(const [key,input] of Object.entries(declared)) {
      checked(key,ALIAS,'host input alias'); exact(input,['file','sha256','label'],['file']);
      const file=pathAt(input.file,base),stat=await lstat(file);
      need(stat.isFile() && !stat.isSymbolicLink() && await realpath(file)===file &&
        stat.size<=MAX_PACKET_BYTES,'GRANT_REVIEWER_CONFIGURATION_INVALID','Use a complete regular original packet.');
      const bytes=await readSourceFile(file),sha256=digest(bytes);
      if(input.sha256!==undefined)need(checked(input.sha256,SHA,'packet SHA256')===sha256,
        'GRANT_REVIEWER_INPUT_CHANGED','The declared input differs from its reviewed SHA256.');
      inputs[key]={file,sha256,bytes:bytes.length,label:text(input.label??key,'Input label')};
    }
    const selected={directory,label:text(item.label??alias,'Workspace label'),allowStart,
      workbenchId:item.workbenchId??header?.id??null,inputs};
    workspaces[alias]={...selected,selectionSha256:digest(Buffer.from(JSON.stringify(canonical(selected))))};
  }
  return {schema:CONNECTION_SCHEMA,workspaces};
}
async function responseBytes(response,maximum) {
  const chunks=[];let size=0;
  try {
    for await(const chunk of response.body??[]) {
      size+=chunk.length;
      need(size<=maximum,'GRANT_REVIEWER_RESPONSE_LIMIT','The original response exceeds its declared complete-file limit.');
      chunks.push(chunk);
    }
  } catch(error) { await response.body?.cancel().catch(()=>{}); throw error; }
  return Buffer.concat(chunks,size);
}
export class ReviewerConnection {
  #binding;#owned=null;#opening=null;#closing=false;#closed=false;#knownId;
  constructor(binding) {this.#binding=binding;this.#knownId=binding.workbenchId;}
  get summary() {return {directory:this.#binding.directory,workbenchId:this.#knownId,
    allowStart:this.#binding.allowStart,owned:Boolean(this.#owned),closed:this.#closed};}
  async #live() {
    const saved=await optional(join(this.#binding.directory,'workbench-connection.json'));
    if(!saved || saved.active!==true){
      if(this.#owned){const original=this.#owned;await original.close();if(this.#owned===original)this.#owned=null;}
      return null;
    }
    need(saved.schema===WORKBENCH_CONNECTION_SCHEMA && saved.directory===this.#binding.directory &&
      typeof saved.accessToken==='string' && /^[A-Za-z0-9_-]{43}$/.test(saved.accessToken),
    'GRANT_REVIEWER_CONNECTION_CHANGED','Use the original private workbench connection record.');
    checked(saved.workbenchId,UUID,'workbench ID');checked(saved.instanceId,UUID,'workbench instance');
    const header=await optional(join(this.#binding.directory,'workbench.json'));
    need(header?.id===saved.workbenchId && (!this.#knownId || this.#knownId===saved.workbenchId),
      'GRANT_REVIEWER_WORKBENCH_CHANGED','The original workbench identity changed.');
    const url=new URL(saved.url);
    need(url.protocol==='http:' && url.hostname==='127.0.0.1' && url.port && url.pathname==='/' &&
      !url.username && !url.password && !url.search && !url.hash,
    'GRANT_REVIEWER_CONNECTION_CHANGED','Use the original loopback controller URL.');
    let response;
    try {response=await fetch(new URL('/health',url),{redirect:'error',signal:AbortSignal.timeout(3000)});}
    catch{return null;}
    const health=decode(await responseBytes(response,65536));
    need(response.ok && health.schema===WORKBENCH_READY_SCHEMA && health.active===true &&
      health.workbenchId===saved.workbenchId && health.instanceId===saved.instanceId,
    'GRANT_REVIEWER_CONNECTION_CHANGED','The live controller does not match its original private connection.');
    if(this.#owned && this.#owned.instanceId!==saved.instanceId){
      const previous=this.#owned;await previous.close();if(this.#owned===previous)this.#owned=null;
    }
    this.#knownId=saved.workbenchId;return saved;
  }
  async #ensure(start=false) {
    need(!this.#closing && !this.#closed,'GRANT_REVIEWER_CLOSING','The merchant connection is closing.');
    if(this.#opening)return this.#opening;
    this.#opening=(async()=>{
      const current=await this.#live();if(current)return current;
      need(start && this.#binding.allowStart,'GRANT_REVIEWER_NOT_RUNNING',
        'Open the original workbench in Applications, or use workbench_open with host-authorized allowStart.');
      // The original kernel lease decides whether another controller still owns this directory.
      // It is never removed, stolen or replaced when a health request is unavailable.
      const application=await startReviewerWorkbench({directory:this.#binding.directory,sourceRoot});
      this.#owned=application;
      try {const saved=await this.#live();need(saved,'GRANT_REVIEWER_CONNECTION_UNAVAILABLE');return saved;}
      catch(error){await application.close();this.#owned=null;throw error;}
    })();
    try{return await this.#opening;}finally{this.#opening=null;}
  }
  async open() {
    const connection=await this.#ensure(true);
    return {state:'OPEN',ownership:this.#owned?'OWNED':'BORROWED',workbenchId:connection.workbenchId,
      instanceId:connection.instanceId,url:connection.url,selectionSha256:this.#binding.selectionSha256};
  }
  async release() {
    if(this.#opening)await this.#opening;
    if(!this.#owned)return {state:'RELEASED',ownership:'BORROWED',originalWorkbenchClosed:false,workbenchId:this.#knownId};
    const original=this.#owned;await original.close();if(this.#owned===original)this.#owned=null;
    return {state:'RELEASED',ownership:'OWNED',originalWorkbenchClosed:true,workbenchId:this.#knownId};
  }
  async request(method,path,input) {
    const original=await this.#ensure();
    let response;
    try {
      response=await fetch(new URL(path,original.url),{method,redirect:'error',signal:AbortSignal.timeout(120000),
        headers:{authorization:'Bearer '+original.accessToken,accept:'application/json',
          ...(input===undefined?{}:{'content-type':'application/json'})},
        ...(input===undefined?{}:{body:JSON.stringify(input)})});
    } catch {
      throw failure(input?'GRANT_REVIEWER_REQUEST_UNCERTAIN':'GRANT_REVIEWER_CONNECTION_UNAVAILABLE',
        input?'The original request may have completed. Read its action UUID or repeat exactly the same UUID and inputs.':
          'Reopen the original workbench connection before reading.',
        {workbenchId:original.workbenchId,instanceId:original.instanceId,...(input?.requestId?{requestId:input.requestId}:{})});
    }
    let bytes;
    try{bytes=await responseBytes(response,MAX_RESPONSE_BYTES);}
    catch(error){
      if(input)throw failure('GRANT_REVIEWER_REQUEST_UNCERTAIN',
        'The original response was interrupted after dispatch. Read or replay its exact saved action UUID.',
        {requestId:input.requestId,workbenchId:original.workbenchId,cause:error.code??error.name});
      throw error;
    }
    if(!response.ok) {
      let error;try{error=decode(bytes).error;}catch{}
      throw failure(typeof error?.code==='string'?error.code:'GRANT_REVIEWER_HTTP_'+response.status,
        typeof error?.message==='string'?error.message:'The original workbench rejected this request.',
        {status:response.status,...(input?.requestId?{requestId:input.requestId}:{})});
    }
    return {bytes,contentType:response.headers.get('content-type')??'application/octet-stream',
      sha256:response.headers.get('x-content-sha256'),workbenchId:original.workbenchId,
      instanceId:original.instanceId,status:response.status};
  }
  async json(method,path,input) {const result=await this.request(method,path,input);return {...result,value:decode(result.bytes)};}
  async hostInput(key) {
    checked(key,ALIAS,'host input alias');const selected=this.#binding.inputs[key];
    need(selected,'GRANT_REVIEWER_INPUT_NOT_CONFIGURED','Use a declared original packet alias.');
    const bytes=await readSourceFile(selected.file);
    need(bytes.length===selected.bytes && digest(bytes)===selected.sha256,
      'GRANT_REVIEWER_INPUT_CHANGED','The selected input changed since the host configuration was read.');
    return {bytes,sha256:selected.sha256};
  }
  async nativeClient() {
    const connection=await this.#ensure();
    // Reuse the maintained MCP transport. The code stays inside this process and is never returned.
    const native=await openMerchantFileClient({url:connection.url,tokenEnv:'ORIGINAL_REVIEWER_PRIVATE_CODE',
      environment:{ORIGINAL_REVIEWER_PRIVATE_CODE:connection.accessToken},
      clientName:'starforge-grant-purchase-reviewer',errorPrefix:'GRANT_REVIEWER_NATIVE',maximumResponseBytes:3*1024*1024});
    return {native,workbenchId:connection.workbenchId,instanceId:connection.instanceId};
  }
  async savedResult(quoteId) {
    const connected=await this.nativeClient(),chunks=[];let offset=0,identity,metadata;
    for(;;) {
      const page=await connected.native.call('bazaar_read_result',{quoteId,byteOffset:offset,maxBytes:65536});
      need(page.quoteId===quoteId && page.byteOffset===offset && page.encoding==='base64' &&
        Number.isSafeInteger(page.bytes) && page.bytes>=0 && page.bytes<=2*1024*1024 &&
        /^[a-f0-9]{64}$/.test(page.sha256??'') && page.representation==='MCP_CALL_TOOL_RESULT_JSON',
      'GRANT_REVIEWER_NATIVE_RESULT_INVALID','The original result range differs from its selected quote.');
      const current=JSON.stringify([page.bytes,page.sha256,page.representation,page.contentType]);
      need(identity===undefined || identity===current,'GRANT_REVIEWER_NATIVE_RESULT_CHANGED');
      identity=current;
      const chunk=Buffer.from(page.data??'','base64');
      need(chunk.toString('base64')===page.data && chunk.length===page.returnedBytes &&
        chunk.length<=65536 && offset+chunk.length<=page.bytes,'GRANT_REVIEWER_NATIVE_RESULT_INVALID');
      chunks.push(chunk);offset+=chunk.length;metadata=page;
      if(page.nextByteOffset===null){need(offset===page.bytes,'GRANT_REVIEWER_NATIVE_RESULT_INCOMPLETE');break;}
      need(chunk.length>0 && page.nextByteOffset===offset,'GRANT_REVIEWER_NATIVE_RESULT_INVALID');
    }
    const bytes=Buffer.concat(chunks,offset);need(digest(bytes)===metadata.sha256,'GRANT_REVIEWER_NATIVE_RESULT_CHANGED');
    const value=decode(bytes);need(plain(value),'GRANT_REVIEWER_NATIVE_RESULT_INVALID');
    return {bytes,value,metadata,workbenchId:connected.workbenchId,instanceId:connected.instanceId,contentType:metadata.contentType};
  }
  async close() {
    if(this.#closed)return;
    this.#closing=true;
    try{await this.release();this.#closed=true;}finally{this.#closing=false;}
  }
}
