// MIT. MonitoringClient-compatible transport through the original customer-agent tools.
import {constants} from 'node:fs';
import {open,lstat,link,unlink} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {MonitoringError,GET_OPERATIONS,POST_OPERATIONS} from './client.mjs';
import {MerchantSourceMonitoring,readSourceMonitoringConfiguration} from './merchant.mjs';

function finishOwnedCleanup(primary, cleanup, message) {
 if(primary){if(cleanup.length)primary.cleanupErrors=[...(Array.isArray(primary.cleanupErrors)?primary.cleanupErrors:[]),...cleanup];throw primary;}
 if(cleanup.length===1)throw cleanup[0];
 if(cleanup.length>1)throw new AggregateError(cleanup,message);
}

const HASH=/^[a-f0-9]{64}$/;
const MAX_REPLY=128*1024*1024,MAX_ARCHIVE=1024*1024*1024;
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function need(ok,message){if(!ok)throw new MonitoringError('MONITORING_AGENT_CLIENT',message);}
async function fileIdentity(path,maximum=MAX_ARCHIVE){
 need(typeof path==='string'&&resolve(path)===path,'Use an absolute original file.');
 const before=await lstat(path,{bigint:true});
 need(before.isFile()&&!before.isSymbolicLink()&&before.size<=BigInt(maximum),'Use a complete regular file within its original capacity.');
 const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{
  const a=await h.stat({bigint:true});need(a.isFile()&&['dev','ino','size','mtimeNs','ctimeNs'].every(k=>before[k]===a[k]),'The original changed while opening.');
  const digest=createHash('sha256'),chunk=Buffer.alloc(1024*1024);let bytes=0;
  for(;;){const r=await h.read(chunk,0,chunk.length,bytes);if(!r.bytesRead)break;bytes+=r.bytesRead;need(bytes<=maximum,'Original file exceeds capacity.');digest.update(chunk.subarray(0,r.bytesRead));}
  const b=await h.stat({bigint:true}),n=await lstat(path,{bigint:true});
  need(!n.isSymbolicLink()&&['dev','ino','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]&&b[k]===n[k])&&bytes===Number(a.size),'Original file changed while reading.');
  return {path,bytes,sha256:digest.digest('hex')};
 }finally{await h.close();}
}
async function syncDir(path){const h=await open(path,constants.O_RDONLY|constants.O_DIRECTORY);let primary;try{await h.sync();}catch(error){primary=error;throw error;}finally{const cleanup=[];try{await h.close();}catch(error){cleanup.push(error);}finishOwnedCleanup(primary,cleanup,'Original directory sync cleanup remains unresolved.');}}
function selectedScope(config,scope){
 const s=clone(scope),v=config.workspaces?.[s.workspace];
 need(v&&s.expectedWorkspace===v.expectedWorkspace&&s.expectedBindingSha256===v.expectedBindingSha256,
  'Select the configured physical workspace and original binding.');
 return s;
}
/**
 * Owns the agent provider's clients and retained file readers, never the console.
 * authorizeFile is for an existing receiving programme's already selected output;
 * agent tools themselves still accept only host-declared aliases and exact hashes.
 */
export class AgentMonitoringClient{
 #configuration;#scope;#agent;#authorize;#pending=new Set();#closed=false;#closing;
 constructor({configuration,scope,authorizeFile=null}){
  this.#configuration=structuredClone(configuration);this.#scope=selectedScope(this.#configuration,scope);
  need(authorizeFile===null||typeof authorizeFile==='function','Use the original receiving file selector.');
  this.#authorize=authorizeFile;this.#agent=new MerchantSourceMonitoring({sourceMonitoring:this.#configuration});
 }
 #run(job){
  need(!this.#closed,'This agent transport is closed.');
  const p=Promise.resolve().then(job);this.#pending.add(p);p.then(()=>this.#pending.delete(p),()=>this.#pending.delete(p));return p;
 }
 async #call(action,body={},agent=this.#agent){return agent.call('merchant_monitoring_'+action,{scope:this.#scope,...body});}
 async #chunks(selection,consume,maximum=MAX_ARCHIVE,agent=this.#agent){
  need(selection?.kind==='retained'&&HASH.test(selection.sha256)&&Number.isSafeInteger(selection.bytes)&&selection.bytes>=0&&selection.bytes<=maximum,
   'Read a complete retained file descriptor within the original capacity.');
  let offset=0,readId=null,completed=false,primary;const digest=createHash('sha256');
  try{
   for(;;){
    const page=await this.#call('file_read',{selection,expectedSha256:selection.sha256,...(readId?{readId}:{}),offset,limit:65536},agent);
    if(page.status==='NATIVE_ERROR')await this.#reply(page,agent);
    need(page.offset===offset&&page.encoding==='base64'&&page.file?.sha256===selection.sha256&&page.file?.bytes===selection.bytes&&
     typeof page.readId==='string'&&(!readId||readId===page.readId),'Retained byte page changed its original identity.');
    readId=page.readId;const chunk=Buffer.from(page.data,'base64');
    need(chunk.toString('base64')===page.data&&chunk.length===page.bytesRead&&offset+chunk.length<=selection.bytes,
     'Retained byte page is incomplete.');
    digest.update(chunk);await consume(chunk,offset);offset+=chunk.length;
    if(page.nextOffset===null){need(offset===selection.bytes,'Retained file ended before its complete byte count.');completed=true;break;}
    need(chunk.length>0&&page.nextOffset===offset,'Retained file cursor did not advance exactly.');
   }
   need(digest.digest('hex')===selection.sha256,'Complete retained file SHA256 differs.');
  }catch(error){primary=error;throw error;}
  finally{const cleanup=[];if(readId&&!completed)try{await this.#call('file_release',{readId},agent);}catch(error){cleanup.push(error);}finishOwnedCleanup(primary,cleanup,'Original retained file reader cleanup remains unresolved.');}
 }
 async #bytes(selection,maximum=MAX_REPLY,agent=this.#agent){
  const parts=[];await this.#chunks(selection,part=>parts.push(Buffer.from(part)),maximum,agent);
  return Buffer.concat(parts,selection.bytes);
 }
 async #reply(value,agent=this.#agent){
  need(same(value.scope,this.#scope),'Agent response selected another physical workspace.');
  if(value.status==='NATIVE_ERROR'){
   const evidenceRaw=await this.#bytes(value.error.evidence,MAX_REPLY+1024*1024,agent);
   const evidence=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(evidenceRaw));
   need(evidence.code===value.error.code,'Original error evidence changed.');
   const response=value.response;
   const raw=response?await this.#bytes({kind:'retained',sha256:response.sha256,bytes:response.bytes},MAX_REPLY,agent):null;
   throw new MonitoringError(evidence.code,evidence.message,{...evidence.detail,
    ...(raw?{responseBase64:raw.toString('base64'),responseSha256:hash(raw),status:response.status}:{}),
    agentEvidence:{...value.error.evidence},agentInput:value.input,uncertain:value.error.uncertain});
  }
  need(value.status==='NATIVE_RESPONSE'&&value.response?.selection,'The original agent did not return a native response.');
  const response=value.response,raw=await this.#bytes(response.selection,MAX_REPLY,agent);
  need(raw.length===response.bytes&&hash(raw)===response.sha256,'Original native response changed.');
  if(response.rawJson!==null)need(Buffer.from(response.rawJson,'utf8').equals(raw),'Inline response differs from complete retained bytes.');
  return {json:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),raw,status:response.status,headers:{...response.headers},sha256:response.sha256};
 }
 inspect(){return this.#run(async()=>{
  const result=await this.#call('inspect');if(result.status==='NATIVE_ERROR')await this.#reply(result);need(result.status==='CONNECTED'&&same(result.scope,this.#scope),'The original service is not connected.');
  need(result.identity.workspace===this.#scope.expectedWorkspace&&result.identity.bindingSha256===this.#scope.expectedBindingSha256,
   'The original live workspace changed.');return result.identity;
 });}
 get(operation,parameters={}){
  need(GET_OPERATIONS.includes(operation),'Choose an original Monitoring read.');const input=clone({operation,parameters});
  return this.#run(async()=>this.#reply(await this.#call('read',input)));
 }
 post(operation,input){
  need(POST_OPERATIONS.includes(operation),'Choose an original Monitoring command.');
  let raw;
  if(typeof input==='string'||input instanceof Uint8Array)raw=Buffer.from(input);
  else{
   need(input!==null&&typeof input==='object'&&!Array.isArray(input),'Supply one original JSON object.');
   try{raw=Buffer.from(JSON.stringify(input,(_key,value)=>{
    if(typeof value==='number')need(Number.isFinite(value)&&(!Number.isInteger(value)||Number.isSafeInteger(value)),
     'Use original JSON text for numbers outside the safe JavaScript range.');
    need(!['bigint','function','symbol','undefined'].includes(typeof value),'Inputs must contain complete JSON values.');
    return value;
   }));}catch(error){if(error instanceof MonitoringError)throw error;throw new MonitoringError('MONITORING_INPUT','Supply a complete acyclic JSON object.');}
  }
  need(raw.length<=24*1024*1024,'Preserve complete native command capacity.');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(raw),parsed=JSON.parse(text);
  need(parsed!==null&&typeof parsed==='object'&&!Array.isArray(parsed),'Supply one complete original JSON object.');
  return this.#run(async()=>this.#reply(await this.#call('command',{operation,jsonText:text})));
 }
 async #file(path,maximum,action,options){
  const actual=await fileIdentity(path,maximum);
  let entry=Object.entries(this.#configuration.files).find(([,v])=>v.path===path&&v.bytes===actual.bytes&&v.sha256===actual.sha256);
  let owned=null,agent=this.#agent;
  if(!entry){
   need(this.#authorize,'This complete original file has no declared host alias.');
   const approved=await this.#authorize({...actual});
   need(approved&&approved.path===path&&approved.bytes===actual.bytes&&approved.sha256===actual.sha256,
    'The receiving file differs from its retained authorized selection.');
   const alias='receiving_'+actual.sha256.slice(0,48);
   const config=structuredClone(this.#configuration);config.files={[alias]:{...actual,name:approved.name??path.split('/').pop(),
    media:approved.media??'application/octet-stream',sourceUrl:approved.sourceUrl??''}};
   owned=agent=new MerchantSourceMonitoring({sourceMonitoring:config});entry=[alias,config.files[alias]];
  }
  let primary;
  try{return await this.#reply(await this.#call(action,{fileAlias:entry[0],bytes:actual.bytes,sha256:actual.sha256,...options},agent),agent);}
  catch(error){primary=error;throw error;}
  finally{const cleanup=[];if(owned)try{await owned.close();}catch(error){cleanup.push(error);}finishOwnedCleanup(primary,cleanup,'Original temporary provider cleanup remains unresolved.');}
 }
 upload(path,options={}){const selected=clone({path,options});return this.#run(()=>this.#file(selected.path,256*1024*1024,'upload',selected.options));}
 receiveArchive(path){return this.#run(()=>this.#file(path,MAX_ARCHIVE,'receive_archive',{}));}
 download(kind,input){
  const opts=clone(input);need(typeof opts.output==='string'&&resolve(opts.output)===opts.output,'Select the original complete output path.');
  return this.#run(async()=>{
   let originalSelection;
   if(kind==='review-exchange'){
    const described=await this.#reply(await this.#call('read',{operation:'review-exchange',parameters:{id:opts.id}}));
    const selected=described.json.files?.find(file=>file.role===opts.role);
    need(selected&&HASH.test(selected.sha256)&&Number.isSafeInteger(selected.bytes),'Select the exact native reviewer document descriptor.');
    if(opts.expectedSha256!==undefined)need(selected.sha256===opts.expectedSha256,'Original reviewer document differs from expected SHA.');
    originalSelection={kind,id:opts.id,role:opts.role,sha256:selected.sha256,bytes:selected.bytes};
   }else{
    need(['workspace','object','source'].includes(kind),'Select an original download kind.');
    if(kind!=='workspace'&&opts.expectedSha256!==undefined)need(opts.expectedSha256===opts.id,'The expected original content hash differs from its selected object/source ID.');
    originalSelection=kind==='workspace'?{kind}:{kind,id:opts.id};
   }
   const result=await this.#call('download',{selection:originalSelection});
   if(result.status==='NATIVE_ERROR')await this.#reply(result);
   need(result.status==='FILE_RETAINED'&&same(result.scope,this.#scope),'Original download was not retained.');
   const file=result.file;
   need(file.selection.sha256===file.sha256&&file.selection.bytes===file.bytes,'Retained download descriptor changed.');
   if(opts.expectedSha256!==undefined)need(opts.expectedSha256===file.sha256,'Downloaded original differs from its expected hash.');
   try{
    const existing=await fileIdentity(opts.output);
    need(existing.bytes===file.bytes&&existing.sha256===file.sha256,'Existing complete output differs from selected native file.');
    return {...existing,kind,reused:true,...(opts.id?{id:opts.id}:{})};
   }catch(error){if(error.code!=='ENOENT')throw error;}
   const temporary=opts.output+'.pending-'+randomUUID();let h=null,created=false,primary;
   try{
    h=await open(temporary,'wx',0o600);created=true;
    await this.#chunks(file.selection,async(chunk,position)=>{
     let at=0;while(at<chunk.length){const r=await h.write(chunk,at,chunk.length-at,position+at);need(r.bytesWritten>0,'Could not write complete original output.');at+=r.bytesWritten;}
    });
    await h.sync();await h.close();h=null;
    try{await link(temporary,opts.output);}catch(error){
     if(error.code!=='EEXIST')throw error;const other=await fileIdentity(opts.output);
     need(other.bytes===file.bytes&&other.sha256===file.sha256,'Concurrent complete output differs.');
    }
    await syncDir(dirname(opts.output));
   }catch(error){primary=error;throw error;}
   finally{
    const cleanup=[];
    if(h)try{await h.close();}catch(error){cleanup.push(error);}
    if(created){
     try{await unlink(temporary);}catch(error){if(error.code!=='ENOENT')cleanup.push(error);}
     try{await syncDir(dirname(opts.output));}catch(error){cleanup.push(error);}
    }
    finishOwnedCleanup(primary,cleanup,'Original agent download cleanup remains unresolved.');
   }
   return {path:opts.output,bytes:file.bytes,sha256:file.sha256,kind,reused:false,...(opts.id?{id:opts.id}:{})};
  });
 }
 close(){
  this.#closed=true;
  return this.#closing??=(async()=>{await Promise.allSettled([...this.#pending]);await this.#agent.close();})().catch(error=>{this.#closing=null;throw error;});
 }
}
export async function createAgentMonitoringClient({configurationFile,workspace,authorizeFile=null}){
 const configuration=await readSourceMonitoringConfiguration(configurationFile),v=configuration.workspaces[workspace];
 need(v,'Select an original configured workspace alias.');
 return new AgentMonitoringClient({configuration,scope:{workspace,expectedWorkspace:v.expectedWorkspace,
  expectedBindingSha256:v.expectedBindingSha256},authorizeFile});
}
