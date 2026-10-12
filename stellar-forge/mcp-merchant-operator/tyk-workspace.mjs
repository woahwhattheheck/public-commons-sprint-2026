// MIT. Complete Tyk customer operation and delivery through the original private workspace.
import { constants } from 'node:fs';
import { open,mkdir,link,rm } from 'node:fs/promises';
import { dirname,join,resolve } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { tykWorkspaceTools,TYK_AGENT_METHODS,TYK_ALIAS,TYK_SHA,TYK_UUID } from './catalog/tyk-workspace.mjs';
import { RetainedFileReads } from './retained-file-reads.mjs';
import { TykWorkspaceHttpClient,readTykPrivateFile,retainTykResponse } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/tyk/workspace/http-client.mjs';
import { TYK_MAX_JSON_BYTES,validateTykAction } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/tyk/workspace/actions.mjs';
import { privateDirectory,canonical,need } from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
export { tykWorkspaceTools } from './catalog/tyk-workspace.mjs';
export const TYK_WORKSPACE_CONNECTION_SCHEMA='stellar-forge.tyk-workspace-connection.v1';
export const TYK_AGENT_EXPORT_SCHEMA='stellar-forge.tyk-agent-export.v1';
const MANIFEST='tyk-export.json',INLINE=65536;
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonicalText=value=>JSON.stringify(canonical(value));
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const definitions=new Map(tykWorkspaceTools((name,description,properties,required,options)=>({name,description,properties,required,options})).map(value=>[value.name,value]));
function exact(value,allowed,required=[]){
  need(plain(value)&&Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key)),
    'TYK_AGENT_INPUT_INVALID','Use the fields declared for this original workspace operation.');
}
function checked(value,pattern,label){need(typeof value==='string'&&pattern.test(value),'TYK_AGENT_INPUT_INVALID','Invalid '+label+'.');return value;}
async function jsonFile(path,maximum=65536){
  const bytes=await readTykPrivateFile(path,maximum);
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{need(false,'TYK_PRIVATE_JSON_INVALID','Use the complete original private JSON file.');}
}
async function ensureDirectory(path){
  try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  return privateDirectory(path);
}
async function syncDirectory(path){
  const handle=await open(path,constants.O_RDONLY|constants.O_DIRECTORY);try{await handle.sync();}finally{await handle.close();}
}
async function verifyFile(path,reference){
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW),hash=createHash('sha256');
  try{
    const first=await handle.stat();need(first.isFile()&&first.size===reference.bytes&&!(first.mode&0o077)&&
      (typeof process.getuid!=='function'||first.uid===process.getuid()),'TYK_AGENT_EXPORT_CHANGED');
    const buffer=Buffer.alloc(65536);let offset=0;
    while(offset<first.size){const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,first.size-offset),offset);
      need(bytesRead>0,'TYK_AGENT_EXPORT_TRUNCATED');hash.update(buffer.subarray(0,bytesRead));offset+=bytesRead;}
    const last=await handle.stat();
    need(first.dev===last.dev&&first.ino===last.ino&&first.size===last.size&&first.mtimeMs===last.mtimeMs&&
      first.ctimeMs===last.ctimeMs&&hash.digest('hex')===reference.sha256,'TYK_AGENT_EXPORT_CHANGED');
  }finally{await handle.close();}
}
export async function readTykWorkspaceConfiguration(path){
  path=resolve(path);const input=await jsonFile(path,1024*1024);
  exact(input,['schema','workspaces'],['schema','workspaces']);
  need(input.schema===TYK_WORKSPACE_CONNECTION_SCHEMA&&plain(input.workspaces)&&Object.keys(input.workspaces).length>0,'TYK_WORKSPACE_CONFIGURATION_INVALID');
  const workspaces=Object.create(null),base=dirname(path);
  for(const [alias,value]of Object.entries(input.workspaces)){
    checked(alias,TYK_ALIAS,'workspace alias');
    exact(value,['label','workspaceId','consoleUrlFile','consoleUrlEnv','files'],['label','workspaceId']);
    need(typeof value.label==='string'&&value.label.trim()&&value.label.length<=300,'TYK_WORKSPACE_CONFIGURATION_INVALID');
    checked(value.workspaceId,TYK_UUID,'original workspace ID');
    need(Boolean(value.consoleUrlFile)!==Boolean(value.consoleUrlEnv),'TYK_WORKSPACE_CONFIGURATION_INVALID',
      'Declare exactly one original workspace URL file or environment name.');
    const definition={label:value.label,workspaceId:value.workspaceId,files:Object.create(null)};
    if(value.consoleUrlFile){need(typeof value.consoleUrlFile==='string'&&value.consoleUrlFile.length<=4000,'TYK_WORKSPACE_CONFIGURATION_INVALID');
      definition.consoleUrlFile=resolve(base,value.consoleUrlFile);}
    else definition.consoleUrlEnv=checked(value.consoleUrlEnv,/^[A-Za-z_][A-Za-z0-9_]*$/,'workspace URL environment name');
    need(value.files===undefined||plain(value.files),'TYK_WORKSPACE_CONFIGURATION_INVALID');
    for(const [name,entry]of Object.entries(value.files??{})){
      checked(name,TYK_ALIAS,'handover file handle');exact(entry,['label','path','sha256'],['label','path','sha256']);
      need(typeof entry.label==='string'&&entry.label.trim()&&entry.label.length<=300&&typeof entry.path==='string'&&entry.path.length<=4000,
        'TYK_WORKSPACE_CONFIGURATION_INVALID');
      definition.files[name]={label:entry.label,path:resolve(base,entry.path),sha256:checked(entry.sha256,TYK_SHA,'original handover SHA256')};
    }
    workspaces[alias]=definition;
  }
  return {schema:TYK_WORKSPACE_CONNECTION_SCHEMA,workspaces};
}
export class MerchantTykWorkspaces{
  #config;#environment;#fetch;#pending=new Set();#clients=new Set();#requests=new Map();
  #controller=new AbortController();#closing=false;#closed=false;#close;
  #reads=new RetainedFileReads({errorPrefix:'TYK_AGENT_EXPORT'});
  constructor(config,{environment=process.env,fetch=globalThis.fetch}={}){
    this.#config=config;this.#environment=environment;this.#fetch=fetch;
  }
  get summary(){
    return {configured:Boolean(this.#config.tykWorkspaces),...this.#reads.summary,
      workspaces:Object.entries(this.#config.tykWorkspaces?.workspaces??{}).map(([workspace,value])=>({
        workspace,label:value.label,workspaceId:value.workspaceId,
        files:Object.entries(value.files).map(([file,item])=>({file,label:item.label,sha256:item.sha256})),
      }))};
  }
  #definition(workspace){
    checked(workspace,TYK_ALIAS,'workspace alias');const value=this.#config.tykWorkspaces?.workspaces[workspace];
    need(value,'TYK_WORKSPACE_NOT_CONFIGURED','Choose an original host-declared Tyk workspace.');return value;
  }
  async #using(workspace,requestId,fn){
    const definition=this.#definition(workspace);
    const raw=definition.consoleUrlFile?new TextDecoder('utf-8',{fatal:true}).decode(await readTykPrivateFile(definition.consoleUrlFile,4096)).trim():
      this.#environment[definition.consoleUrlEnv];
    need(!this.#closing,'TYK_AGENT_CLOSING');
    const key=requestId?workspace+'\0'+checked(requestId,TYK_UUID,'original request ID'):null;
    need(!key||!this.#requests.has(key),'TYK_REQUEST_ALREADY_ACTIVE','Read the original saved request or wait for this connection to finish.');
    const client=new TykWorkspaceHttpClient({url:raw,workspaceId:definition.workspaceId,environment:this.#environment,
      fetch:this.#fetch,signal:this.#controller.signal});
    this.#clients.add(client);if(key)this.#requests.set(key,client);
    try{await client.ready();return await fn(client,definition);}
    finally{if(key&&this.#requests.get(key)===client)this.#requests.delete(key);await client.close();this.#clients.delete(client);}
  }
  async #root(){await privateDirectory(this.#config.exportsDirectory);return ensureDirectory(join(this.#config.exportsDirectory,'tyk-workspace-exports'));}
  async #manifest(exportId){
    checked(exportId,TYK_SHA,'original export ID');const directory=await privateDirectory(join(await this.#root(),exportId));
    const bytes=await readTykPrivateFile(join(directory,MANIFEST),65536),manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    const {exportId:original,...identity}=manifest;
    need(manifest.schema===TYK_AGENT_EXPORT_SCHEMA&&original===exportId&&sha(canonicalText(identity))===exportId&&
      Array.isArray(manifest.files)&&manifest.files.length===1,'TYK_AGENT_MANIFEST_CHANGED');
    checked(manifest.workspaceId,TYK_UUID,'original workspace ID');this.#definition(manifest.workspace);
    const file=manifest.files[0];need(['workspace.ndjson','source.json','result.json'].includes(file.name)&&
      Number.isSafeInteger(file.bytes)&&file.bytes>=0&&TYK_SHA.test(file.sha256),'TYK_AGENT_MANIFEST_CHANGED');
    return {directory,bytes,manifest,manifestSha256:sha(bytes)};
  }
  #delivery(retained){
    const {manifest,manifestSha256}=retained;
    return {state:'COMPLETE_RESULT_RETAINED',exportId:manifest.exportId,manifestSha256,
      workspace:manifest.workspace,workspaceId:manifest.workspaceId,kind:manifest.kind,
      original:manifest.original,files:manifest.files,
      manifestFile:{name:MANIFEST,bytes:retained.bytes.length,sha256:manifestSha256,mediaType:'application/json'}};
  }
  async #retain(workspace,workspaceId,kind,original,receive){
    const root=await this.#root(),temporary=await ensureDirectory(join(root,'.collect-'+randomUUID()));
    const name=kind==='delivery'?'workspace.ndjson':kind==='source'?'source.json':'result.json';
    try{
      const file=await receive(join(temporary,name));
      const identity={schema:TYK_AGENT_EXPORT_SCHEMA,workspace,workspaceId,kind,original,
        files:[{name,bytes:file.bytes,sha256:file.sha256,mediaType:file.mediaType}]};
      const exportId=sha(canonicalText(identity)),manifest={...identity,exportId};
      const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
      const manifestHandle=await open(join(temporary,MANIFEST),'wx',0o600);
      try{await manifestHandle.writeFile(bytes);await manifestHandle.sync();}finally{await manifestHandle.close();}
      const directory=await ensureDirectory(join(root,exportId));
      for(const member of [...identity.files,{name:MANIFEST,bytes:bytes.length,sha256:sha(bytes)}]){
        try{await link(join(temporary,member.name),join(directory,member.name));}
        catch(error){if(error.code!=='EEXIST')throw error;await verifyFile(join(directory,member.name),member);}
      }
      await syncDirectory(directory);await syncDirectory(root);
      return this.#delivery(await this.#manifest(exportId));
    }finally{await rm(temporary,{recursive:true,force:true});}
  }
  async #result(workspace,client,method,args,response,signal){
    const original={method,requestId:args.requestId??null,requestSha256:sha(canonicalText({method,args}))};
    const iterator=response.body?.[Symbol.asyncIterator]();
    need(iterator,'TYK_ORIGINAL_REPLY_EMPTY');
    const prefix=[];let count=0;
    try{
      for(;;){
        const next=await iterator.next();if(next.done)break;prefix.push(next.value);count+=next.value.length;
        if(count>INLINE){
          async function* originalBody(){for(const chunk of prefix)yield chunk;for(;;){const next=await iterator.next();if(next.done)return;yield next.value;}}
          const complete=new Response(Readable.from(originalBody()),{headers:response.headers});
          return await this.#retain(workspace,client.workspaceId,'result',original,
            output=>retainTykResponse(complete,output,{signal}));
        }
      }
      try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(prefix)));}
      catch{need(false,'TYK_ORIGINAL_REPLY_INVALID','The complete original reply is not UTF-8 JSON.');}
    }finally{await iterator.return?.();}
  }
  async #execute(name,args){
    if(name==='merchant_tyk_workspaces')return this.summary;
    if(name==='merchant_tyk_cancel_request'){
      this.#definition(args.workspace);checked(args.requestId,TYK_UUID,'original request ID');
      const active=this.#requests.get(args.workspace+'\0'+args.requestId);
      if(!active)return {workspace:args.workspace,requestId:args.requestId,state:'NO_ACTIVE_LOCAL_REQUEST'};
      await active.close();return {workspace:args.workspace,requestId:args.requestId,state:'LOCAL_REPLY_STOPPED'};
    }
    if(name.startsWith('merchant_tyk_export_')){
      const retained=await this.#manifest(args.exportId);
      if(name==='merchant_tyk_export_manifest')return {...retained.manifest,manifestSha256:retained.manifestSha256};
      if(name==='merchant_tyk_export_file_release')return this.#reads.release(args.exportId,checked(args.readId,TYK_UUID,'original read ID'));
      need(name==='merchant_tyk_export_file','TYK_AGENT_METHOD_UNKNOWN');
      need(checked(args.expectedManifestSha256,TYK_SHA,'manifest SHA256')===retained.manifestSha256,'TYK_AGENT_MANIFEST_CHANGED');
      const file=args.file==='manifest'?{name:MANIFEST,bytes:retained.bytes.length,sha256:retained.manifestSha256,mediaType:'application/json'}:retained.manifest.files[0];
      need(args.file===undefined||args.file==='original'||args.file==='manifest','TYK_AGENT_INPUT_INVALID');
      need(checked(args.expectedSha256,TYK_SHA,'file SHA256')===file.sha256,'TYK_AGENT_EXPORT_CHANGED');
      need(args.readId===undefined||TYK_UUID.test(args.readId),'TYK_AGENT_INPUT_INVALID');
      need(Number.isSafeInteger(args.offset??0)&&(args.offset??0)>=0&&Number.isSafeInteger(args.limit??65536)&&
        (args.limit??65536)>0&&(args.limit??65536)<=65536,'TYK_AGENT_INPUT_INVALID');
      const result=await this.#reads.read({scope:args.exportId,key:file.name,kind:'tyk-export',directory:retained.directory,
        expectedSha256:file.sha256,readId:args.readId,offset:args.offset??0,limit:args.limit??65536,load:async()=>{
          if(file.name===MANIFEST)return {bytes:retained.bytes,name:MANIFEST,type:'application/json'};
          const handle=await open(join(retained.directory,file.name),constants.O_RDONLY|constants.O_NOFOLLOW);
          try{const stat=await handle.stat();need(stat.isFile()&&stat.size===file.bytes&&!(stat.mode&0o077)&&
            (typeof process.getuid!=='function'||stat.uid===process.getuid()),'TYK_AGENT_EXPORT_CHANGED');
            return {readonlyFileHandle:handle,bytes:file.bytes,sha256:file.sha256,name:file.name,type:file.mediaType};
          }catch(error){await handle.close();throw error;}
        }});
      return {exportId:args.exportId,manifestSha256:retained.manifestSha256,...result};
    }
    if(name==='merchant_tyk_inspect_delivery'){
      checked(args.file,TYK_ALIAS,'host-declared file');checked(args.requestId,TYK_UUID,'original request ID');
      return this.#using(args.workspace,args.requestId,async(client,definition)=>{
        const file=definition.files[args.file];need(file,'TYK_HOST_FILE_NOT_CONFIGURED');
        return client.inspectFile(file.path,{requestId:args.requestId,label:args.label??file.label,
          expectedSha256:file.sha256,signal:this.#controller.signal});
      });
    }
    if(name==='merchant_tyk_download'){
      need(args.kind==='delivery'||args.kind==='source','TYK_AGENT_INPUT_INVALID');
      need(args.kind==='delivery'?args.id!==undefined&&args.reference===undefined:args.reference!==undefined&&args.id===undefined,'TYK_AGENT_INPUT_INVALID');
      if(args.kind==='delivery')checked(args.id,/^[a-f0-9]{24}$/,'delivery ID');
      else validateTykAction('readSource',{reference:args.reference});
      return this.#using(args.workspace,null,client=>this.#retain(args.workspace,client.workspaceId,args.kind,
        args.kind==='delivery'?{deliveryId:args.id}:{reference:args.reference},output=>args.kind==='delivery'?
          client.downloadDelivery(args.id,output,{signal:this.#controller.signal}):
          client.downloadSource(args.reference,output,{signal:this.#controller.signal})));
    }
    const method=TYK_AGENT_METHODS[name];need(method,'TYK_AGENT_METHOD_UNKNOWN');
    const {workspace,...input}=args;validateTykAction(method,input);
    return this.#using(workspace,input.requestId,client=>client.action(method,input,{
      consume:(response,signal)=>this.#result(workspace,client,method,input,response,signal),signal:this.#controller.signal}));
  }
  call(name,args={}){
    if(this.#closing)return Promise.reject(Object.assign(new Error('The original Tyk agent connection is closing.'),{code:'TYK_AGENT_CLOSING'}));
    const definition=definitions.get(name);need(definition,'TYK_AGENT_METHOD_UNKNOWN');
    exact(args,Object.keys(definition.properties),definition.required);
    need(Buffer.byteLength(JSON.stringify(args))<=TYK_MAX_JSON_BYTES,'TYK_AGENT_INPUT_TOO_LARGE');
    const pending=Promise.resolve().then(()=>this.#execute(name,args));this.#pending.add(pending);
    pending.then(()=>this.#pending.delete(pending),()=>this.#pending.delete(pending));return pending;
  }
  close(){
    if(this.#closed)return Promise.resolve();if(this.#close)return this.#close;
    this.#closing=true;this.#controller.abort();
    this.#close=(async()=>{await Promise.allSettled([...this.#clients].map(client=>client.close()));
      await Promise.allSettled([...this.#pending]);await this.#reads.close();this.#closed=true;})()
      .catch(error=>{this.#close=undefined;throw error;});
    return this.#close;
  }
}
