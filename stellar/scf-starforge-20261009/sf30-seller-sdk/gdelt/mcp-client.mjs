// MIT. Host-selected aliases borrow the one existing original application owner.
import { dirname,resolve } from 'node:path';
import { readPrivateJson } from '../routescan/quota.mjs';
import { readBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { need,plain,hash,digest,clone,LIMITS } from './model.mjs';
import { gdeltLoopbackUrl,gdeltLoopbackJson,gdeltLoopbackRequest } from './loopback.mjs';

export const GDELT_HOST_SCHEMA='stellar-forge.gdelt-workspace-host.v1';
const alias=/^[a-z0-9][a-z0-9_-]{0,63}$/,sha=/^[a-f0-9]{64}$/;
function fields(value,allowed,label){need(plain(value)&&Object.keys(value).every(key=>allowed.includes(key)),'Use declared '+label+' fields.');}
function text(value,label,max=8192){need(typeof value==='string'&&value.length>=1&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value),'Select the original '+label+'.');return value;}
export async function readGdeltWorkspaceConfiguration(path) {
  path=resolve(text(path,'host connection file'));
  const raw=await readPrivateJson(path,1024*1024);fields(raw,['schema','workspaces'],'host connection');
  need(raw.schema===GDELT_HOST_SCHEMA&&plain(raw.workspaces)&&Object.keys(raw.workspaces).length>=1&&Object.keys(raw.workspaces).length<=32,'Declare one to32 original workspace aliases.');
  const workspaces=Object.create(null),base=dirname(path);
  for(const [key,value]of Object.entries(raw.workspaces)){
    need(alias.test(key),'Use a lowercase workspace alias.');
    fields(value,['label','connectionFile','projectId','expectedBindingSha256','timeoutMs','inputs','merchantProfiles'],'workspace');
    need(/^[a-f0-9-]{36}$/.test(value.projectId??'')&&sha.test(value.expectedBindingSha256??''),'Pin the original project ID and launch binding.');
    const entry={label:text(value.label??key,'workspace label',240),connectionFile:resolve(base,text(value.connectionFile,'private startup record')),
      projectId:value.projectId,expectedBindingSha256:value.expectedBindingSha256,timeoutMs:value.timeoutMs??1800000,inputs:Object.create(null),merchantProfiles:Object.create(null)};
    need(Number.isSafeInteger(entry.timeoutMs)&&entry.timeoutMs>=1000&&entry.timeoutMs<=3600000,'Select a local request timeout between one second and one hour.');
    need(plain(value.inputs??{})&&plain(value.merchantProfiles??{}),'Declare original input/profile objects.');
    for(const [name,item]of Object.entries(value.inputs??{})){
      need(alias.test(name)&&Object.keys(value.inputs).length<=128,'Declare at most128 original input aliases.');
      fields(item,['label','path','kind','sha256'],'host input');need(['capture','project'].includes(item.kind)&&sha.test(item.sha256??''),'Pin a complete capture or project file and its SHA256.');
      entry.inputs[name]={label:text(item.label??name,'input label',240),path:resolve(base,text(item.path,'input file')),kind:item.kind,sha256:item.sha256};
    }
    for(const [name,item]of Object.entries(value.merchantProfiles??{})){
      need(alias.test(name)&&Object.keys(value.merchantProfiles).length<=32,'Declare at most32 merchant profiles.');
      fields(item,['label','origin','path','payment'],'merchant profile');const url=new URL(item.origin);
      need(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/'&&plain(item.payment),'Select the configured public HTTPS origin and original payment terms.');
      const path=item.path??'/gdelt';need(/^\/[A-Za-z0-9/_-]{0,128}$/.test(path)&&!path.includes('//'),'Choose the configured plain route prefix.');
      entry.merchantProfiles[name]={label:text(item.label??name,'merchant label',240),origin:url.origin,path,payment:clone(item.payment)};
    }
    workspaces[key]=entry;
  }
  return {schema:GDELT_HOST_SCHEMA,path,workspaces};
}
export async function readGdeltHostInput(entry,name,expectedSha256) {
  const input=entry.inputs[name];need(input,'Select an original host input alias.','GDELT_INPUT_UNKNOWN',404);
  if(expectedSha256!==undefined)need(expectedSha256===input.sha256,'The requested input differs from its host selection.');
  const bytes=await readBytes(input.path,LIMITS.projectBytes);
  need(hash(bytes)===input.sha256,'The original input changed.','GDELT_INPUT_CHANGED',409);
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  need(value?.schema===(input.kind==='capture'?'stellar-forge.gdelt-capture.v1':'stellar-forge.gdelt-project-bundle.v1'),'The original input format differs from its declaration.');
  return {input,bytes,value,sha256:input.sha256};
}
export class GdeltWorkspaceClient {
  #entry;#lifetime=new AbortController();#tasks=new Set();#closed=false;#close;#metadata=null;
  constructor(entry){this.#entry=entry;}
  get metadata(){return this.#metadata?clone(this.#metadata):{state:'UNATTACHED',projectId:this.#entry.projectId};}
  async #connection(signal) {
    const record=await readPrivateJson(this.#entry.connectionFile,131072),startup=record?.startup;
    need(record?.schema==='stellar-forge.gdelt-workspace-connection.v1'&&startup?.schema==='stellar-forge.gdelt-workspace-startup.v1'&&
      startup.state==='LISTENING'&&startup.binding?.projectId===this.#entry.projectId&&
      startup.binding?.sha256===this.#entry.expectedBindingSha256&&/^[a-f0-9-]{36}$/.test(startup.instanceId??''),
      'The original private startup selection changed.','GDELT_WORKSPACE_CHANGED',409);
    const {sha256,...binding}=startup.binding;need(digest(binding)===sha256,'The complete launch binding changed.');
    gdeltLoopbackUrl(startup.url);
    const live=await gdeltLoopbackJson({url:startup.url,path:'/api/launch',signal,maxBytes:16384,timeout:5000});
    need(live.schema===startup.schema&&live.state==='LISTENING'&&live.instanceId===startup.instanceId&&
      live.binding?.sha256===startup.binding.sha256&&live.binding?.projectId===startup.binding.projectId,
      'Attach the current original application owner.','GDELT_WORKSPACE_CHANGED',409);
    this.#metadata={state:'ATTACHED',projectId:live.binding.projectId,bindingSha256:live.binding.sha256,
      instanceId:live.instanceId,startedAt:live.startedAt,buyerConfigured:live.buyerConfigured};
    return startup.url;
  }
  #track(work) {
    need(!this.#closed,'This borrowed client is closed.','GDELT_CLIENT_CLOSED',409);
    const task=Promise.resolve().then(()=>work(this.#lifetime.signal));this.#tasks.add(task);
    task.finally(()=>this.#tasks.delete(task)).catch(()=>{});return task;
  }
  query(kind,input={}){return this.#track(async signal=>gdeltLoopbackJson({url:await this.#connection(signal),
    path:'/api/query',body:{kind,input},signal,maxBytes:8*1024*1024,timeout:this.#entry.timeoutMs}));}
  action(body){return this.#track(async signal=>gdeltLoopbackJson({url:await this.#connection(signal),
    path:'/api/action',body,signal,maxBytes:8*1024*1024,timeout:this.#entry.timeoutMs}));}
  cancel(id){return this.#track(async signal=>gdeltLoopbackJson({url:await this.#connection(signal),
    path:'/api/cancel',body:{id},signal,maxBytes:16384,timeout:5000}));}
  download(kind,input={}){return this.#track(async signal=>{
    const response=await gdeltLoopbackRequest({url:await this.#connection(signal),path:'/api/download',
      body:{kind,input},signal,maxBytes:LIMITS.projectBytes,timeout:this.#entry.timeoutMs});
    need(sha.test(response.headers['x-content-sha256']??'')&&hash(response.bytes)===response.headers['x-content-sha256'],
      'The complete original downloaded file changed.','GDELT_DOWNLOAD_CHANGED');
    const name=/^attachment; filename="([A-Za-z0-9_.-]+)"$/.exec(response.headers['content-disposition']??'')?.[1];
    need(name,'The original file name changed.');
    return {name,type:response.headers['content-type']??'application/octet-stream',bytes:response.bytes};
  });}
  close(){if(!this.#close){this.#closed=true;this.#lifetime.abort();this.#close=Promise.allSettled([...this.#tasks]).then(()=>{});}return this.#close;}
}
