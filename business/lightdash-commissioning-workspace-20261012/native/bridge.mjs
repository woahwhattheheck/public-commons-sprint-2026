// Observe the original installed CLI exports; all compilation, requests and writes remain native.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {check,digest,objectDigest,readJson,saveJson,scrub,fileIdentity,inside} from './files.mjs';
import {validatePlan,UPSTREAM} from './contract.mjs';
import {inheritReceiving} from './lease.mjs';
import {restorePreviewOwner,selectedOperation} from './evidence.mjs';
const spec=JSON.parse(await readFile(process.argv[2])),op=validatePlan(JSON.parse(await readFile(spec.planFile)));
check(spec.operationDigest===op.digest,'LIGHTDASH_BRIDGE_BINDING','Native child request changed.');
const root=spec.nativeDirectory,attempt=spec.attemptDirectory,protocol=path.join(attempt,'protocol',spec.phase);
await mkdir(protocol,{recursive:true,mode:0o700});
const secrets=[process.env.LIGHTDASH_API_KEY,process.env.LIGHTDASH_PROXY_AUTHORIZATION,...Object.keys(op.connection.environment).map(k=>process.env[k])].filter(Boolean);
const req=createRequire(op.connection.runtime.cliEntry.path),context=new AsyncLocalStorage();
let api,configModule,common,originalApi,originalRaw;
let sequence=0,owned=null;
const sourceProject=op.connection.projectUuid,target=op.input.projectUuid??op.input.previewProjectUuid??sourceProject;
const allowedProjects=new Set([sourceProject,target]);
function syncSave(file,value){
 const data=Buffer.from(JSON.stringify(value,null,2)+'\n'),tmp=file+'.'+randomUUID()+'.partial';
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const fd=fs.openSync(tmp,'wx',0o600);
 try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(tmp,file);const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
function publicError(e){return scrub({name:e?.name??'Error',code:e?.code??null,message:String(e?.message??e),statusCode:e?.statusCode??e?.status??null},secrets);}
const exitFile=path.join(attempt,spec.phase+'.native-exit.json');
process.on('exit',code=>{try{syncSave(exitFile,{schema:'lightdash-commissioning.native-exit.v1',operationId:op.operationId,digest:op.digest,phase:spec.phase,mode:spec.mode,exitCode:code,completedAt:new Date().toISOString()});}catch{}});
const leaseFds=(process.env.LDW_LEASE_FDS??'').split(',').map(Number);
check(leaseFds.length===2&&leaseFds.every(fd=>Number.isInteger(fd)&&fd>=3&&fs.fstatSync(fd).isFile()),'LIGHTDASH_CHILD_LEASE','Original command must inherit both retained native leases.');
// Preserve the same leases through original CLI -> dbt children. No argv or provider behavior is changed.
const cp=req('node:child_process');
for(const name of ['spawn','spawnSync']){
 const original=cp[name];
 cp[name]=function(command,args,options){
  if(!Array.isArray(args)){options=args??{};args=[];}options={...(options??{})};
  let stdio=options.stdio;
  if(!Array.isArray(stdio)){const mode=stdio??'pipe';stdio=[mode,mode,mode];}else stdio=[...stdio];
  while(stdio.length<3)stdio.push('pipe');
  const passed=[];for(const fd of leaseFds){passed.push(stdio.length);stdio.push(fd);}
  const inherited=inheritReceiving(stdio,{...(options.env??process.env),LDW_LEASE_FDS:passed.join(',')});options.stdio=inherited.stdio;options.env=inherited.env;
  return original.call(this,command,args,options);
 };
}
function guard(props){
 const u=new URL(props.url,op.connection.origin);check(u.origin===op.connection.origin,'LIGHTDASH_TARGET','Original CLI requested a different origin.');
 const method=props.method??'GET',write=!['GET','HEAD'].includes(method);
 if(spec.mode!=='command'||spec.readOnlyCommand)check(!write,'LIGHTDASH_READBACK_WRITE','Native inspection cannot dispatch a mutation.');
 const project=u.pathname.match(/^\/api\/v[12]\/(?:ee\/)?projects\/([a-f0-9-]{36})(?:\/|$)/i)?.[1];
 if(write&&project)check(allowedProjects.has(project),'LIGHTDASH_TARGET','Original CLI attempted to mutate a different project.');
 if(write&&!project)check(/^\/api\/v1\/org\/projects\/?$/.test(u.pathname)||(/^\/api\/v1\/org\/projects\/[a-f0-9-]{36}$/.test(u.pathname)&&method==='DELETE'),'LIGHTDASH_MUTATION_SCOPE','This commissioning action does not mutate organization or account resources.');
 if(method==='DELETE'&&/^\/api\/v1\/org\/projects\//.test(u.pathname))check(op.action==='stop-preview'&&u.pathname.endsWith('/'+op.input.previewProjectUuid),'LIGHTDASH_PREVIEW_OWNER','Deletion does not target this operation’s owned preview.');
 if(method==='POST'&&u.pathname.replace(/\/$/,'')==='/api/v1/org/projects'){
  check(op.action==='start-preview','LIGHTDASH_PROJECT_CREATE','Only the reviewed preview action creates a project.');
  const body=JSON.parse(props.body);check(body.type===common.ProjectType.PREVIEW&&body.name===op.input.name&&body.upstreamProjectUuid===sourceProject,'LIGHTDASH_PREVIEW_OWNER','Original preview creation changed its selected source or name.');
 }
 return {method,path:u.pathname+u.search,write};
}
async function record(props,invoke,raw=false){
 const g=guard(props),n=String(++sequence).padStart(6,'0'),dir=path.join(protocol,n);await mkdir(dir,{recursive:true,mode:0o700});
 const body=props.body===undefined?null:typeof props.body==='string'?Buffer.from(props.body):Buffer.isBuffer(props.body)?props.body:null;
 check(props.body===undefined||body!==null,'LIGHTDASH_REQUEST_BODY','This retained CLI operation requires an observable native request body.');
 const request={schema:'lightdash-commissioning.native-request.v1',operationId:op.operationId,digest:op.digest,sequence:n,...g,body:body?{bytes:body.length,sha256:digest(body)}:null,preparedAt:new Date().toISOString()};
 const requestBytes=Buffer.from(JSON.stringify(request,null,2)+'\n');await saveJson(path.join(dir,'request.json'),request,{createOnly:true});
 try{
  const result=await invoke();let observed=result;
  if(raw){const clone=result.clone();const b=await clone.buffer();check(b.length<=64*1024*1024,'LIGHTDASH_OBSERVATION_LIMIT','Native response exceeds the retained observation limit.');try{observed=JSON.parse(b);}catch{observed={httpStatus:result.status,bytes:b.length,sha256:digest(b)};}}
  const nativeBytes=Buffer.from(JSON.stringify(observed));check(nativeBytes.length<=64*1024*1024,'LIGHTDASH_OBSERVATION_LIMIT','Native result exceeds the retained observation limit.');
  const response={schema:'lightdash-commissioning.native-response.v1',operationId:op.operationId,digest:op.digest,requestSha256:digest(requestBytes),nativeSerialization:'JSON.stringify(original result); credential fields redacted in retained results',nativeBytes:nativeBytes.length,nativeSha256:digest(nativeBytes),nativeCompleted:!!(g.method==='POST'&&/\/deploy\/[^/]+\/finalize$/.test(new URL(g.path,op.connection.origin).pathname)&&observed?.status===common.DeploySessionStatus.COMPLETED),results:scrub(observed,secrets),receivedAt:new Date().toISOString()};
  await saveJson(path.join(dir,'response.json'),response,{createOnly:true});const ident=await fileIdentity(path.join(dir,'response.json'));
  await saveJson(path.join(dir,'receipt.json'),{state:'COMPLETE',requestSha256:response.requestSha256,response:{path:path.join(dir,'response.json'),...ident}},{createOnly:true});
  if(g.method==='POST'&&g.path.replace(/\/$/,'')==='/api/v1/org/projects'&&observed?.project){
   const p=observed.project;check(p.type===common.ProjectType.PREVIEW&&p.name===op.input.name&&p.upstreamProjectUuid===sourceProject,'LIGHTDASH_PREVIEW_OWNER','Created native project does not match the reviewed preview.');
   owned={schema:'lightdash-commissioning.preview-owner.v1',operationId:op.operationId,digest:op.digest,projectUuid:p.projectUuid,name:p.name,organizationUuid:p.organizationUuid,upstreamProjectUuid:p.upstreamProjectUuid,createdByUserUuid:p.createdByUserUuid??null,createResponse:{path:path.join(dir,'response.json'),...ident}};
   allowedProjects.add(p.projectUuid);await saveJson(path.join(root,'owned-preview.json'),owned,{createOnly:true});
  }
  return result;
 }catch(e){await saveJson(path.join(dir,'failure.json'),{state:'UNRESOLVED',requestSha256:digest(requestBytes),error:publicError(e),failedAt:new Date().toISOString()});throw e;}
}
api=req('./handlers/dbt/apiClient.js');configModule=req('./config.js');common=req('@lightdash/common');
check(typeof api.lightdashApi==='function'&&typeof api.lightdashRawApi==='function','LIGHTDASH_CLI_LAYOUT','Selected original CLI API module is unavailable.');
originalApi=api.lightdashApi;originalRaw=api.lightdashRawApi;
api.lightdashApi=props=>context.run(true,()=>record(props,()=>originalApi(props)));
api.lightdashRawApi=props=>context.getStore()?originalRaw(props):record(props,()=>originalRaw(props),true);
const asyncQuery=req('./handlers/asyncQuery.js');
const originalPoll=asyncQuery.pollForResults;
check(typeof originalPoll==='function'&&typeof asyncQuery.resultsToCsv==='function','LIGHTDASH_CLI_LAYOUT','Original chart query exports are unavailable.');
asyncQuery.pollForResults=async(projectUuid,queryUuid,options={})=>{
 check(allowedProjects.has(projectUuid),'LIGHTDASH_QUERY_PROJECT','Query readback selects another project.');
 const result=await originalPoll(projectUuid,queryUuid,options);
 const ready=result.status===common.QueryHistoryStatus.READY,failed=[common.QueryHistoryStatus.ERROR,common.QueryHistoryStatus.CANCELLED].includes(result.status);
 const resultFile=path.join(attempt,spec.phase+'.query-result.json'),csvFile=path.join(attempt,spec.phase+'.query-results.csv');
 const body={schema:'lightdash-commissioning.native-chart-result.v1',operationId:op.operationId,digest:op.digest,projectUuid,queryUuid,ready,failed,pageSize:options.pageSize??null,result:scrub(result,secrets)};
 await saveJson(resultFile,body);
 let csv=null;if(ready){check(Array.isArray(result.rows)&&result.columns&&typeof result.columns==='object','LIGHTDASH_QUERY_RESULT','Original ready query did not return its columns and rows.');const bytes=Buffer.from(asyncQuery.resultsToCsv(Object.keys(result.columns),result.rows),'utf8');await import('./files.mjs').then(m=>m.durable(csvFile,bytes));csv={path:csvFile,...await fileIdentity(csvFile)};}
 await saveJson(path.join(attempt,spec.phase+'.query-output.json'),{projectUuid,queryUuid,ready,failed,rows:result.rows?.length??null,resultFile:{path:resultFile,...await fileIdentity(resultFile)},csv});
 return result;
};
const cliCompile=req('./handlers/compile.js');
for(const name of ['compile','compileProject']){
 const original=cliCompile[name];check(typeof original==='function','LIGHTDASH_CLI_LAYOUT','Original compile export is missing.');
 cliCompile[name]=async (...args)=>{const result=await original(...args);const value={schema:'lightdash-commissioning.native-compile.v1',operationId:op.operationId,digest:op.digest,export:name,sourceManifestSha256:op.edition.manifestSha256,result:scrub(result,secrets),completedAt:new Date().toISOString()};await saveJson(path.join(attempt,spec.phase+'.'+name+'.json'),value);return result;};
}
async function readOwner(id){
 const prior=await selectedOperation(spec.workspaceDir,id);validatePlan(prior.operation);
 check(prior.operation.action==='start-preview'&&prior.operation.connection.origin===op.connection.origin&&prior.operation.connection.projectUuid===sourceProject&&prior.operation.connection.tokenEnv===op.connection.tokenEnv,'LIGHTDASH_PREVIEW_OWNER','Preview ownership belongs to another native source operation.');
 const owner=await restorePreviewOwner(prior.nativeDirectory,prior.operation);
 check(owner,'LIGHTDASH_PREVIEW_OWNER','The original operation has no retained native creation response.');return owner;
}
const config=await configModule.getConfig({readOnly:true});
check((config.context?.proxyAuthorization??null)===(process.env.LIGHTDASH_PROXY_AUTHORIZATION??null),'LIGHTDASH_PROXY_BINDING','The original CLI has a different saved proxy authorization. Select that host reference explicitly with the original configuration.');
check(config.context?.serverUrl?.replace(/\/$/,'')===op.connection.origin&&config.context?.apiKey===process.env.LIGHTDASH_API_KEY,'LIGHTDASH_AUTH_BINDING','The original CLI resolved a different host or token.');
if(['deploy','start-preview'].includes(op.action)&&!op.connection.source)check(!config.context?.source,'LIGHTDASH_DBT_SOURCE','The original CLI has a saved dbt source. Select it explicitly or clear that source with the original config command.');
owned=await restorePreviewOwner(root,op);
if(owned)allowedProjects.add(owned.projectUuid);
if(op.input.startOperationId){
 const priorOwner=await readOwner(op.input.startOperationId);check(!owned||owned.projectUuid===priorOwner.projectUuid,'LIGHTDASH_PREVIEW_OWNER','Two preview ownership records disagree.');owned=priorOwner;allowedProjects.add(owned.projectUuid);
 check((!op.input.previewProjectUuid||owned.projectUuid===op.input.previewProjectUuid)&&(!op.input.projectUuid||op.input.projectUuid===sourceProject||owned.projectUuid===op.input.projectUuid)&&(!op.input.name||owned.name===op.input.name),'LIGHTDASH_PREVIEW_OWNER','Requested preview differs from its native creation receipt.');
}
const nativeSetPreview=configModule.setPreviewProject,nativeUnsetPreview=configModule.unsetPreviewProject;
configModule.setPreviewProject=async (projectUuid,name)=>{
 check(op.action==='start-preview'&&owned?.projectUuid===projectUuid&&owned.name===name,'LIGHTDASH_PREVIEW_OWNER','The original CLI cannot select an unowned preview.');return nativeSetPreview(projectUuid,name);
};
configModule.unsetPreviewProject=async ()=>{
 check(op.action==='stop-preview'&&owned?.projectUuid===op.input.previewProjectUuid,'LIGHTDASH_PREVIEW_OWNER','Only an owned stop action may clear a preview selection.');
 const current=await configModule.getConfig({readOnly:true});
 if(current.context?.previewProject&&current.context.previewProject!==owned.projectUuid)return;
 return nativeUnsetPreview();
};
const authority={schema:'lightdash-commissioning.authority.v1',operationId:op.operationId,digest:op.digest,origin:op.connection.origin,projectUuid:sourceProject,tokenDigest:digest(op.digest+'\0'+process.env.LIGHTDASH_API_KEY),environmentDigest:objectDigest(Object.fromEntries(Object.keys(op.connection.environment).sort().map(k=>[k,process.env[k]??null]))),proxyDigest:digest(op.digest+'\0'+(process.env.LIGHTDASH_PROXY_AUTHORIZATION??''))};
await saveJson(path.join(root,'authority.json'),authority,{createOnly:true});
async function snapshot(){
 const health=await api.lightdashApi({method:'GET',url:'/api/v1/health?skipMigrationCheck=true',body:undefined});
 check(typeof health.version==='string','LIGHTDASH_HEALTH','Native health did not report its server version.');
 const user=await api.lightdashApi({method:'GET',url:'/api/v1/user',body:undefined});
 const projects=await api.lightdashApi({method:'GET',url:'/api/v1/org/projects/',body:undefined});
 check(Array.isArray(projects),'LIGHTDASH_PROJECTS','Native project catalog is not an array.');
 const selected=projects.find(p=>p.projectUuid===sourceProject);check(selected,'LIGHTDASH_PROJECT','The selected account cannot observe the exact source project.');
 const previewName=op.input.name??owned?.name;
 const named=previewName?projects.filter(p=>p.type===common.ProjectType.PREVIEW&&p.name===previewName):[];
 if(previewName)check(named.length<=1,'LIGHTDASH_PREVIEW_NAME','More than one native preview has this exact name.');
 if(op.action==='start-preview'&&['preflight','command'].includes(spec.mode)&&named.length){
  check(owned&&named[0].projectUuid===owned.projectUuid,'LIGHTDASH_PREVIEW_OWNER','A preview with this name already exists without this workspace’s creation receipt.');
 }
 if(owned&&named.length)check(named[0].projectUuid===owned.projectUuid&&named[0].upstreamProjectUuid===sourceProject,'LIGHTDASH_PREVIEW_OWNER','The named native preview changed identity or upstream project.');
 const pUuid=op.action==='start-preview'?(owned?.projectUuid??named[0]?.projectUuid):target;
 const current=pUuid?projects.find(p=>p.projectUuid===pUuid):null;
 if(!['start-preview','stop-preview'].includes(op.action))check(current,'LIGHTDASH_PROJECT','The exact target project is no longer visible.');
 if(op.connection.source){
  const sources=await api.lightdashApi({method:'GET',url:'/api/v1/projects/'+sourceProject+'/dbt-sources',body:undefined});
  check(Array.isArray(sources)&&sources.filter(s=>s.name===op.connection.source.name&&s.projectDbtSourceUuid===op.connection.source.uuid).length===1,'LIGHTDASH_DBT_SOURCE','Selected native dbt source identity changed.');
 }
 const result={schema:'lightdash-commissioning.native-observation.v1',operationId:op.operationId,digest:op.digest,observedAt:new Date().toISOString(),cliVersion:UPSTREAM.version,serverVersion:health.version,origin:op.connection.origin,user:scrub(user,secrets),sourceProject:scrub(selected,secrets),targetProject:scrub(current??null,secrets),preview:owned??null,previewAbsent:!!owned&&!projects.some(p=>p.projectUuid===owned.projectUuid),scope:'API-visible account/project observation; no database-wide backup claim'};
 await saveJson(path.join(attempt,spec.phase+'.observation.json'),result);return result;
}
try{
 if(spec.mode==='command'){
  if(['start-preview','stop-preview'].includes(op.action))await snapshot();
  process.argv=[op.connection.runtime.node.path,op.connection.runtime.cliEntry.path,...spec.argv];
  req(op.connection.runtime.cliEntry.path);
 }else{
  const observed=await snapshot();
  if(spec.mode==='reconcile'){
   const references=spec.nativeReferences??[],observations=[];
   for(const ref of references){
    if(ref.kind==='chart-query'){
     const result=await asyncQuery.pollForResults(ref.projectUuid,ref.queryUuid,{pageSize:op.input.pageSize});
     observations.push({...ref,ready:result.status===common.QueryHistoryStatus.READY,failed:[common.QueryHistoryStatus.ERROR,common.QueryHistoryStatus.CANCELLED].includes(result.status),output:await readJson(path.join(attempt,spec.phase+'.query-output.json'))});
    }else if(ref.kind==='validation-job'){
     const state=await api.lightdashApi({method:'GET',url:'/api/v1/schedulers/job/'+ref.jobId+'/status',body:undefined});
     let validation=null;if(state.status===common.SchedulerJobStatus.COMPLETED)validation=await api.lightdashApi({method:'GET',url:'/api/v1/projects/'+ref.projectUuid+'/validate?jobId='+encodeURIComponent(ref.jobId),body:undefined});
     const blocking=validation?.filter(v=>op.input.severity==='warning'||!common.isValidationWarning(v))??null;
     observations.push({...ref,state,validation,completed:state.status===common.SchedulerJobStatus.COMPLETED,failed:state.status===common.SchedulerJobStatus.ERROR,blockingIssues:blocking?.length??null});
    }else if(ref.kind==='content-copy-job'){
     const job=await api.lightdashApi({method:'GET',url:'/api/v1/jobs/'+ref.jobId,body:undefined});
     observations.push({...ref,job});
    }
   }
   // The original deployment service deletes completed sessions and has no GET receipt route.
   await saveJson(path.join(attempt,spec.phase+'.reconciliation.json'),{...observed,observations,deploySessionReadbackAvailable:false});
  }
  process.exitCode=0;
 }
}catch(e){await saveJson(path.join(attempt,spec.phase+'.error.json'),publicError(e));console.error(JSON.stringify(publicError(e)));process.exitCode=1;}
