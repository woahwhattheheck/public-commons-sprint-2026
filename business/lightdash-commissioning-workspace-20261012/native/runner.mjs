// Durable commissioning around the original Lightdash and dbt executables.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {readFile,mkdir,readdir,open,lstat} from 'node:fs/promises';
import {check,fail,readJson,saveJson,durable,fileIdentity,verifyManifest,copyInventory,inventory,objectDigest,digest,scrub,inside} from './files.mjs';
import {validatePlan,UPSTREAM} from './contract.mjs';
import {inheritReceiving,receivingLease} from './lease.mjs';
import {records,nativeReferences,restorePreviewOwner,selectedOperation} from './evidence.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const args=Object.fromEntries(Array.from({length:(process.argv.length-2)/2},(_,i)=>[process.argv[2+i*2],process.argv[3+i*2]]));
const root=path.resolve(args['--native']),workspace=path.resolve(args['--workspace']),mode=args['--mode'];
const op=validatePlan(await readJson(path.join(root,'plan.json'))),planFile=path.join(root,'plan.json');
check(['execute','inspect'].includes(mode)&&root.startsWith(workspace+path.sep),'LIGHTDASH_RUNNER','Invalid original native runner request.');
check(Number(process.versions.node.split('.')[0])===24,'LIGHTDASH_NODE','The selected runtime must actually run Node 24.');
const leaseFds=(process.env.LDW_LEASE_FDS??'').split(',').map(Number);
check(leaseFds.length===2&&leaseFds.every(fd=>Number.isInteger(fd)&&fd>=3&&fs.fstatSync(fd).isFile()),'LIGHTDASH_LEASE','Native execution requires both original kernel leases.');
let currentChild=null,stopping=false;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;if(currentChild&&!currentChild.killed)currentChild.kill(signal);});
const now=()=>new Date().toISOString();
const base={schema:'lightdash-commissioning.result.v1',operationId:op.operationId,digest:op.digest,action:op.action,upstream:UPSTREAM};
let attempt=null,active=await readJson(path.join(root,'active.json'),{optional:true}),nativeState=await readJson(path.join(root,'result.json'),{optional:true});
const secretValues=[];
function environment(){
 check(!process.env.LIGHTDASH_AGENT_CONNECTION,'LIGHTDASH_AUTH_SELECTION','This explicitly selected API-key operation cannot borrow an ambient agent connection.');
 const e={};
 for(const[k,v]of Object.entries(process.env))if(/^(?:HOME|USER|LOGNAME|SHELL|PATH|LANG|LANGUAGE|LC_[A-Z_]+|TZ|TMPDIR|TMP|TEMP|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE|AWS_CA_BUNDLE|SYSTEMROOT|VIRTUAL_ENV)$/.test(k)||k.startsWith('SWARM_NATIVE_'))e[k]=v;
 const token=process.env[op.connection.tokenEnv];check(typeof token==='string'&&token.length>0,'LIGHTDASH_CREDENTIAL','The selected host token environment reference is absent.');secretValues.push(token);
 e.LIGHTDASH_API_KEY=token;e.LIGHTDASH_URL=op.connection.origin;e.LIGHTDASH_PROJECT=op.action==='run-chart'?(op.input.projectUuid??op.connection.projectUuid):op.connection.projectUuid;
 if(op.connection.proxyAuthorizationEnv){const proxy=process.env[op.connection.proxyAuthorizationEnv];check(proxy,'LIGHTDASH_CREDENTIAL','The selected proxy authorization reference is absent.');e.LIGHTDASH_PROXY_AUTHORIZATION=proxy;secretValues.push(proxy);}
 for(const[key,ref]of Object.entries(op.connection.environment)){const value=process.env[ref];check(value!==undefined,'LIGHTDASH_ENV','A declared warehouse environment reference is absent.',{reference:ref});e[key]=value;secretValues.push(value);}
 e.PATH=path.dirname(op.connection.runtime.dbt.path)+path.delimiter+(e.PATH??'/usr/bin:/bin');
 e.CI='true';e.PYTHONDONTWRITEBYTECODE='1';e.LIGHTDASH_API_TIMEOUT_MS='120000';e.LDW_WORKSPACE=workspace;e.LDW_NATIVE_DIRECTORY=root;e.LDW_LEASE_FDS=leaseFds.join(',');
 return e;
}
const env=environment();
const outerLease=receivingLease();if(outerLease){env.LDW_RECEIVING_LEASE_FD=String(outerLease.fd);env.LDW_RECEIVING_LEASE_IDENTITY=JSON.stringify(outerLease.identity);}
const safeError=e=>scrub({name:e?.name??'Error',code:e?.code??null,message:String(e?.message??e),details:e?.details??null},secretValues);
function phasePath(phase,suffix){return path.join(attempt.directory,phase+suffix);}
async function saveAttempt(){await saveJson(path.join(attempt.directory,'attempt.json'),attempt);}
async function writeState(state,extra={}){
 const body={...base,state,attempt:attempt?.id??null,startedAt:nativeState?.startedAt??attempt?.startedAt??now(),observedAt:now(),dispatched:!!attempt?.phases.some(p=>p.dispatchIntent),artifacts:nativeState?.artifacts??[],artifactManifest:nativeState?.artifactManifest??null,contentExports:nativeState?.contentExports??[],nativeReferences:nativeState?.nativeReferences??[],...extra};
 await saveJson(path.join(root,'result.json'),body);nativeState=body;return body;
}
async function startAttempt(){
 const names=await readdir(path.join(root,'attempts')).catch(e=>{if(e.code==='ENOENT')return[];throw e;});
 const next=Math.max(0,...names.filter(n=>/^\d{6}$/.test(n)).map(Number))+1,id=String(next).padStart(6,'0');
 const directory=path.join(root,'attempts',id);await mkdir(directory,{recursive:true,mode:0o700});
 attempt={schema:'lightdash-commissioning.attempt.v1',operationId:op.operationId,digest:op.digest,id,directory,startedAt:now(),phases:[]};
 await saveAttempt();active={operationId:op.operationId,digest:op.digest,attempt:id,directory};await saveJson(path.join(root,'active.json'),active);
}
async function restoreAttempt(){
 check(active.operationId===op.operationId&&active.digest===op.digest&&active.directory===path.join(root,'attempts',active.attempt),'LIGHTDASH_ATTEMPT','Retained native attempt changed.');
 attempt=await readJson(path.join(active.directory,'attempt.json'));check(attempt.digest===op.digest&&attempt.operationId===op.operationId,'LIGHTDASH_ATTEMPT','Retained attempt belongs to another operation.');
}
async function runPhase(key,{kind='bridge',bridgeMode='command',argv=[],cwd,readOnly=false,references=[]}={}){
 check(!stopping,'LIGHTDASH_STOPPING','The original native command is draining.');
 let phase=attempt.phases.filter(p=>p.key===key).at(-1);
 if(phase){
  const exit=await readJson(phasePath(phase.id,'.native-exit.json'),{optional:true});
  if(exit){check(exit.operationId===op.operationId&&exit.digest===op.digest&&exit.phase===phase.id,'LIGHTDASH_NATIVE_EXIT','Native exit belongs to a different command.');phase.exit=exit;phase.state='EXITED';await saveAttempt();if(exit.exitCode===0||!readOnly)return exit;phase=undefined;}
  if(phase?.exit){if(phase.exit.exitCode===0||!readOnly)return phase.exit;phase=undefined;}
  if(phase?.spawnError&&!readOnly)fail('LIGHTDASH_SPAWN_FAILED','The original command could not be started.',phase.spawnError);
  if(phase?.dispatchIntent){
   if(!readOnly)fail('LIGHTDASH_UNCERTAIN_COMMAND','This original command was dispatched without a retained exit. Inspect its original provider result before an explicit reviewed continuation.',{phase:phase.id});
   // Native API observations and original read-only downloads may get a fresh observation.
   // Each repeated download receives a new empty output directory from nativeDownload().
   phase=undefined;
  }
 }
 if(!phase){const count=attempt.phases.filter(p=>p.key===key).length;phase={key,id:key+(count?'-'+String(count+1):''),kind,mode:bridgeMode,argv,cwd:cwd??attempt.directory,readOnly,preparedAt:now(),state:'PREPARED'};attempt.phases.push(phase);await saveAttempt();}
 const spec={schema:'lightdash-commissioning.command.v1',planFile,operationDigest:op.digest,nativeDirectory:root,attemptDirectory:attempt.directory,workspaceDir:workspace,phase:phase.id,mode:bridgeMode,argv:phase.argv,cwd:phase.cwd,nativeReferences:references,readOnlyCommand:readOnly};
 const specFile=phasePath(phase.id,'.command.json');await saveJson(specFile,spec,{createOnly:true});
 const childEnv={...env,GITHUB_OUTPUT:phasePath(phase.id,'.github-output.txt'),DBT_TARGET_PATH:path.join(attempt.directory,'dbt-target'),DBT_LOG_PATH:path.join(attempt.directory,'dbt-logs')};
 const exe=kind==='dbt'?op.connection.runtime.python.path:op.connection.runtime.node.path;
 const childArgs=kind==='dbt'?['-I','-B',path.join(HERE,'command.py'),specFile]:[path.join(HERE,'bridge.mjs'),specFile];
 const logFile=phasePath(phase.id,'.log'),log=await open(logFile,'a',0o600);
 phase.dispatchIntent={executable:exe,argv:childArgs,nativeArgv:phase.argv,commandSpec:{path:specFile,...await fileIdentity(specFile)},preparedAt:now()};
 await saveAttempt();await writeState('RUNNING',{currentPhase:phase.id});
 const stdio=['ignore',log.fd,log.fd,...leaseFds],passed=leaseFds.map((_,i)=>i+3);
 let spawned=false,closed=null;
 try{
  const child=spawn(exe,childArgs,{cwd:phase.cwd,...inheritReceiving(stdio,{...childEnv,LDW_LEASE_FDS:passed.join(',')})});currentChild=child;
  const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',()=>{spawned=true;});child.once('close',(code,signal)=>resolve({code,signal}));});
  closed=await completion;
  await log.sync();
  phase.processExit=closed;
  const exit=await readJson(phasePath(phase.id,'.native-exit.json'),{optional:true});
  if(exit){check(exit.operationId===op.operationId&&exit.digest===op.digest&&exit.phase===phase.id,'LIGHTDASH_NATIVE_EXIT','The child exit identity changed.');phase.exit=exit;phase.state='EXITED';}
  else if(closed.code!==null){phase.exit={schema:'lightdash-commissioning.native-exit.v1',operationId:op.operationId,digest:op.digest,phase:phase.id,mode:bridgeMode,exitCode:closed.code,processExit:closed,source:'Original parent wait; child did not publish its own exit receipt.'};phase.state='EXITED';}
  else phase.state='INTERRUPTED';
  await saveAttempt();return phase.exit??{exitCode:null,processExit:closed,interrupted:true};
 }catch(e){
  if(!spawned){phase.spawnError=safeError(e);phase.state='NOT_STARTED';await saveAttempt();}
  throw e;
 }finally{currentChild=null;await log.close();}
}
function succeeded(exit,label){check(exit?.exitCode===0,'LIGHTDASH_NATIVE_FAILED','The original '+label+' command did not succeed.',{exit});}
function compileArgs(action,worktree){
 const project=path.resolve(worktree,op.edition.projectDir),profiles=op.connection.profiles?.directory??path.resolve(worktree,op.edition.profilesDir);
 const out=['--project-dir',project,'--profiles-dir',profiles,'--profile',op.edition.profile,'--target',op.edition.target];
 if(action!=='validate')out.push('--target-path',path.join(attempt.directory,'dbt-target'));
 out.push('--vars',JSON.stringify(op.input.vars??{}),'--threads',String(op.input.threads??2),'--use-dbt-list','false','--validate-warehouse-columns','--no-partial-compilation');
 if(op.input.select?.length)out.push('--select',...op.input.select);if(op.input.exclude?.length)out.push('--exclude',...op.input.exclude);
 return out;
}
function dbtArgs(action,worktree){
 const project=path.resolve(worktree,op.edition.projectDir),profiles=op.connection.profiles?.directory??path.resolve(worktree,op.edition.profilesDir);
 const a=[action,'--project-dir',project,'--profiles-dir',profiles,'--profile',op.edition.profile,'--target',op.edition.target];
 if(action!=='deps'){a.push('--target-path',path.join(attempt.directory,'dbt-target'),'--threads',String(op.input.threads??2),'--vars',JSON.stringify(op.input.vars??{}));if(op.input.select?.length)a.push('--select',...op.input.select);if(op.input.exclude?.length)a.push('--exclude',...op.input.exclude);}
 return a;
}
function lightdashArgs(action,worktree,contentDirectory){
 const a=['--non-interactive',action],target=op.input.projectUuid??op.connection.projectUuid;
 if(['compile','deploy','validate','start-preview'].includes(action))a.push(...compileArgs(action,worktree));
 if(['deploy','validate','download','upload'].includes(action))a.push('--project',target);
 if(['deploy','start-preview'].includes(action)){a.push('--use-batched-deploy','--batch-size','50','--parallel-batches','1');if(op.connection.source)a.push('--source',op.connection.source.name);}
 if(action==='start-preview'){
  a.push('--name',op.input.name,'--expires-in',String(op.input.expiresInHours),'--no-combine');
  if(op.input.skipCopyContent)a.push('--skip-copy-content');
  if(op.input.warehouseCredentials==='copy-upstream')a.push('--no-warehouse-credentials');else a.push('--assume-yes');
 }
 if(action==='stop-preview')a.push('--name',op.input.name);
 if(action==='run-chart')a.push('--path',inside(worktree,op.input.chartPath),'--output',path.join(attempt.directory,'chart-results.csv'),'--limit',String(op.input.limit),'--page-size',String(op.input.pageSize));
 if(action==='validate')a.push('--severity',op.input.severity,'--only',...op.input.only);
 if(['download','upload'].includes(action))a.push('--path',contentDirectory);
 if(action==='upload'){
  a.push('--concurrency','1','--skip-agents','--skip-alerts','--skip-virtual-views','--skip-google-sheets','--skip-documents','--skip-scheduled-deliveries','--skip-external-connections','--skip-homepages');
  if(!op.input.applySpaceAccess)a.push('--skip-space-access');
 }
 return a;
}
async function verifySources(){
 await verifyManifest(op.edition);if(op.connection.profiles)await verifyManifest(op.connection.profiles);
 if(op.input.content)await verifyManifest(op.input.content);
 for(const e of [...Object.values(op.connection.runtime).filter(v=>v?.path),op.connection.runtime.package,...Object.values(op.connection.runtime.modules)]){
  const a=await fileIdentity(e.path??e.file);check(a.sha256===e.sha256&&a.bytes===e.bytes,'LIGHTDASH_RUNTIME_CHANGED','A selected original runtime file changed.');
 }
}
async function validateContinuation(){
 if(!op.input.resumeOf)return;
 const prior=await selectedOperation(workspace,op.input.resumeOf);validatePlan(prior.operation);
 const retained=await readJson(path.join(root,'continuation.json'),{optional:true});
 if(retained)check(retained.operationId===op.operationId&&retained.digest===op.digest&&retained.prior.operationId===prior.operation.operationId&&retained.prior.digest===prior.operation.digest&&retained.prior.nativeDirectory===prior.nativeDirectory&&retained.prior.result?.path===path.join(prior.nativeDirectory,'result.json'),'LIGHTDASH_CONTINUATION','Original continuation binding changed.');
 check(!nativeState?.dispatched||attempt,'LIGHTDASH_CONTINUATION','Retain the original dispatched attempt before continuing its native history.');
 const dispatched=!!attempt?.phases.some(p=>p.key==='command'&&p.dispatchIntent);
 if(dispatched){
  check(retained,'LIGHTDASH_CONTINUATION','The dispatched continuation has lost its original reviewed predecessor receipt.');
  return; // This operation now owns its own native recovery; never replay its predecessor.
 }
 check(prior.operation.action===op.action&&prior.operation.connection.origin===op.connection.origin&&prior.operation.connection.projectUuid===op.connection.projectUuid&&prior.operation.connection.id===op.connection.id,'LIGHTDASH_CONTINUATION','The reviewed continuation selects a different original workflow.');
 check(prior.result&&['FAILED','INTERRUPTED','NEEDS_RECONCILIATION'].includes(prior.result.state),'LIGHTDASH_CONTINUATION','The prior native operation is not a retained incomplete operation.');
 const status=await hostStatus(prior.nativeDirectory);
 check(status.operationId===prior.operation.operationId&&status.digest===prior.operation.digest&&status.kernelLeaseHeld!==true&&status.state!=='RUNNING','LIGHTDASH_CONTINUATION_BUSY','The prior native command or its descendants still own their lease, or its identity changed.');
 check(['FAILED','INTERRUPTED','NEEDS_RECONCILIATION'].includes(status.state),'LIGHTDASH_CONTINUATION','The prior native operation has been reconciled since this continuation was reviewed.');
 const currentResult={path:path.join(prior.nativeDirectory,'result.json'),...await fileIdentity(path.join(prior.nativeDirectory,'result.json'))};
 if(retained){
  check(retained.prior.result.bytes===currentResult.bytes&&retained.prior.result.sha256===currentResult.sha256,'LIGHTDASH_CONTINUATION_BASIS_CHANGED','The original prior result changed before this continuation dispatched. Inspect the retained prior operation and review its current result.');
  return;
 }
 await saveJson(path.join(root,'continuation.json'),{schema:'lightdash-commissioning.continuation.v1',operationId:op.operationId,digest:op.digest,prior:{operationId:prior.operation.operationId,digest:prior.operation.digest,nativeDirectory:prior.nativeDirectory,result:currentResult},basis:'Explicit newly reviewed operation; all prior command and result history retained.'},{createOnly:true});
}
async function hostStatus(nativeDirectory){
 const child=spawn(op.connection.runtime.python.path,['-I','-B',path.join(HERE,'host.py'),'status','--workspace',workspace,'--native',nativeDirectory],{stdio:['ignore','pipe','pipe'],env});let text='';child.stdout.setEncoding('utf8');child.stdout.on('data',b=>{text+=b;});child.stderr.resume();
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});check(code===0,'LIGHTDASH_PRIOR_STATE','Original prior-operation status could not be read.');return JSON.parse(text);
}
async function contentSource(){
 const c=op.input.content;if(!c)return null;
 const verified=await verifyManifest(c);
 check(verified.files.length>0,'LIGHTDASH_CONTENT','The selected content set is empty.');
 if(c.sourceOperationId){
  const source=await selectedOperation(workspace,c.sourceOperationId);validatePlan(source.operation);
  check(source.operation.connection.origin===op.connection.origin&&source.result?.state==='SUCCEEDED','LIGHTDASH_CONTENT_SOURCE','The original content source operation is not a completed native operation on this server.');
  const saved=source.result.contentExports?.find(x=>x.directory===c.directory&&x.manifestFile===c.manifestFile&&x.manifestSha256===c.manifestSha256&&x.sourceProjectUuid===c.sourceProjectUuid&&x.sourceOperationId===c.sourceOperationId);
  check(saved,'LIGHTDASH_CONTENT_SOURCE','The selected content does not match an original retained native export.');
 }else{
  check(c.sourceEditionId===op.edition.id&&c.sourceProjectUuid===op.connection.projectUuid,'LIGHTDASH_CONTENT_SOURCE','Original source content must belong to this reviewed edition and project.');
  const prefix=path.relative(op.edition.directory,c.directory).split(path.sep).join('/');
  check(!prefix.startsWith('../')&&!path.isAbsolute(prefix),'LIGHTDASH_CONTENT_SOURCE','Source content is outside its immutable edition.');
  for(const entry of verified.files){const sourcePath=prefix?prefix+'/'+entry.path:entry.path,original=op.edition.files.find(f=>f.path===sourcePath);check(original&&original.sha256===entry.sha256&&original.bytes===entry.bytes,'LIGHTDASH_CONTENT_SOURCE','Content differs from its original complete source edition.',{path:sourcePath});}
 }
 const rootNames=new Set(verified.files.map(f=>f.path.split('/')[0]));
 for(const name of rootNames)check(!['agents','alerts','virtual-views','google-sheets','scheduled-deliveries','homepages','external-connections','documents','apps','chart-types','themes','organization'].includes(name),'LIGHTDASH_CONTENT_SCOPE','The selected input contains optional or organization resources outside this action’s declared core scope.',{path:name});
 return {directory:c.directory,files:verified.files};
}
async function publishContent(directory,role){
 await mkdir(directory,{recursive:true,mode:0o700});const manifestFile=path.join(attempt.directory,path.basename(directory)+'.content-manifest.json');
 const files=await inventory(directory),body={schema:'lightdash-commissioning.native-content.v1',operationId:op.operationId,digest:op.digest,origin:op.connection.origin,sourceProjectUuid:op.input.projectUuid??op.connection.projectUuid,scope:'Original charts, dashboards and spaces visible to the selected account; optional resources excluded.',files};
 await saveJson(manifestFile,body,{createOnly:true});
 return {role,directory,manifestFile,manifestSha256:(await fileIdentity(manifestFile)).sha256,sourceProjectUuid:body.sourceProjectUuid,sourceOperationId:op.operationId,files:files.length,bytes:files.reduce((n,x)=>n+x.bytes,0)};
}
async function nativeDownload(key,role,worktree){
 const previous=attempt.phases.filter(p=>p.key===key).at(-1);
 let exit=previous?.exit??(previous?await readJson(phasePath(previous.id,'.native-exit.json'),{optional:true}):null);
 let directory=previous&&exit?.exitCode===0?previous.argv[previous.argv.indexOf('--path')+1]:path.join(attempt.directory,role+'-'+String(attempt.phases.filter(p=>p.key===key).length+1));
 check(directory.startsWith(attempt.directory+path.sep),'LIGHTDASH_CONTENT_SCOPE','Native download output is outside this operation.');
 await mkdir(directory,{recursive:true,mode:0o700});
 exit=await runPhase(key,{argv:lightdashArgs('download',worktree,directory),cwd:attempt.directory,readOnly:true});succeeded(exit,role);
 const actual=attempt.phases.filter(p=>p.key===key).at(-1);directory=actual.argv[actual.argv.indexOf('--path')+1];
 return publishContent(directory,role);
}
function rememberExport(items,entry){return [...items.filter(x=>x.directory!==entry.directory),entry];}
async function finishReadbacks(contentExports=[]){
 const worktree=path.join(attempt.directory,'source');
 if(op.action==='download'){
  const main=attempt.phases.filter(p=>p.key==='command').at(-1);check(main?.exit?.exitCode===0,'LIGHTDASH_DOWNLOAD_INCOMPLETE','Original content download has no retained successful exit.');
  const directory=main.argv[main.argv.indexOf('--path')+1];contentExports=rememberExport(contentExports,await publishContent(directory,'download'));
 }
 if(op.action==='upload'){
  const backup=attempt.phases.filter(p=>p.key==='target-backup').at(-1);check(backup?.exit?.exitCode===0,'LIGHTDASH_BACKUP_INCOMPLETE','Native target backup is not complete.');
  contentExports=rememberExport(contentExports,await publishContent(backup.argv[backup.argv.indexOf('--path')+1],'target-before-upload'));
  contentExports=rememberExport(contentExports,await nativeDownload('target-readback','target-after-upload',worktree));
 }
 return contentExports;
}
async function observation(phase){return readJson(phasePath(phase,'.observation.json'),{optional:true});}
async function findings(){
 const entries=await records(root,op),refs=nativeReferences(entries),owner=await restorePreviewOwner(root,op);
 return {entries,refs,owner,unansweredWrites:entries.filter(e=>e.request.write&&!e.response).map(e=>({phase:e.phase,request:e.request,failure:e.failure,requestFile:path.join(e.directory,'request.json')}))};
}
async function reconcile(){
 const evidence=await findings();
 const phase='reconcile-'+String(attempt.phases.filter(p=>p.key.startsWith('reconcile-')).length+1);
 const exit=await runPhase(phase,{bridgeMode:'reconcile',readOnly:true,references:evidence.refs});
 const observed=await readJson(phasePath(phase,'.reconciliation.json'),{optional:true});
 let state=attempt.phases.some(p=>p.key==='command'&&p.dispatchIntent)?'NEEDS_RECONCILIATION':(nativeState?.state==='FAILED'?'FAILED':'PLANNED'),basis='No safe native completion was inferred from a missing command or deployment session.';
 const command=attempt.phases.filter(p=>p.key==='command').at(-1);
 const retainedExit=command?await readJson(phasePath(command.id,'.native-exit.json'),{optional:true})??command.exit??null:null;
 if(retainedExit){check(retainedExit.digest===op.digest&&retainedExit.operationId===op.operationId,'LIGHTDASH_NATIVE_EXIT','Retained command exit changed.');command.exit=retainedExit;command.state='EXITED';await saveAttempt();}
 if(op.action==='run-chart'){
  const query=observed?.observations?.filter(x=>x.kind==='chart-query').at(-1);
  if(query?.ready){state='SUCCEEDED';basis='Original accepted query UUID reached READY; original pollForResults and CSV encoder reused without a new metric-query POST.';}
  else if(query?.failed){state='FAILED';basis='The original chart query returned its native terminal error or cancellation.';}
 }else if(op.action==='validate'){
  const job=observed?.observations?.filter(x=>x.kind==='validation-job').at(-1);
  if(job?.completed){state=job.blockingIssues===0?'SUCCEEDED':'FAILED';basis='Read back the original scheduler job and its exact validation result; no validation POST repeated.';}
  else if(job?.failed){state='FAILED';basis='Original scheduler job returned its native error state.';}
 }else if(op.action==='stop-preview'&&observed?.previewAbsent&&evidence.entries.some(e=>e.request.method==='DELETE'&&e.request.path==='/api/v1/org/projects/'+op.input.previewProjectUuid)){
  state='SUCCEEDED';basis='Original owned preview is absent after this operation’s retained exact DELETE request.';
 }else if(['start-preview','deploy'].includes(op.action)&&evidence.refs.some(r=>r.kind==='deploy-finalize'&&r.completed)){
  state='SUCCEEDED';basis='The exact original finalize reply reports completed; only native target readback followed, without reissuing finalize.';
 }else if(retainedExit?.exitCode===0){
  state='SUCCEEDED';basis='The original child retained exit 0; recovery only observed the original target and retained outputs.';
 }else if(retainedExit?.exitCode!==undefined&&retainedExit.exitCode!==null){
  state='FAILED';basis='The original child retained its failed exit; inspect native partial writes before a reviewed continuation.';
 }
 if(exit.exitCode!==0){state=state==='SUCCEEDED'?'NEEDS_RECONCILIATION':state;basis='Native readback failed; complete command history remains retained.';}
 let contentExports=nativeState?.contentExports??[];
 if(state==='SUCCEEDED'){await assertCompletion(evidence,observed);contentExports=await finishReadbacks(contentExports);}
 return {state,observed,evidence,contentExports,recovery:{sameOperation:true,automaticWriteReplay:false,basis,continueWithReviewedOperation:state==='NEEDS_RECONCILIATION'||state==='FAILED',resumeOf:op.operationId}};
}
async function assertCompletion(evidence,observed){
 if(op.action==='start-preview'){
  check(evidence.owner||op.input.startOperationId,'LIGHTDASH_PREVIEW_NOT_CREATED','Native preview did not retain an owned project identity.');
  check(observed?.targetProject?.type==='PREVIEW'&&!observed.previewAbsent,'LIGHTDASH_PREVIEW_NOT_RUNNING','The original owned preview is not present.');
  check(evidence.refs.some(r=>r.kind==='legacy-deploy-response'||(r.kind==='deploy-finalize'&&r.completed)),'LIGHTDASH_DEPLOY_NOT_RETAINED','Preview did not retain its original deployment result.');
 }
 if(op.action==='deploy')check(evidence.refs.some(r=>r.kind==='legacy-deploy-response'||(r.kind==='deploy-finalize'&&r.completed)),'LIGHTDASH_DEPLOY_NOT_RETAINED','Original deployment completion response is not retained.');
 if(op.action==='stop-preview')check(observed?.previewAbsent,'LIGHTDASH_PREVIEW_STILL_PRESENT','The exact owned preview remains on the native server.');
 if(op.action==='validate')check(evidence.refs.some(r=>r.kind==='validation-job'),'LIGHTDASH_VALIDATION_NOT_RETAINED','Original validation job identity was not retained.');
 if(op.action==='run-chart'){
  check(evidence.refs.some(r=>r.kind==='chart-query'),'LIGHTDASH_QUERY_NOT_RETAINED','Original chart query UUID was not retained.');
  const outputs=[];for(const p of attempt.phases){const q=await readJson(phasePath(p.id,'.query-output.json'),{optional:true});if(q)outputs.push(q);}
  check(outputs.some(q=>q.ready&&q.csv&&q.rows<=op.input.limit),'LIGHTDASH_QUERY_NOT_RETAINED','Original complete bounded chart query and CSV have not been retained.');
 }
 if(op.action==='compile')check(attempt.phases.some(p=>p.key==='command'&&p.exit?.exitCode===0),'LIGHTDASH_COMPILE_NOT_RETAINED','The original compile command did not retain its exit.');
}
async function artifactInventory(contentExports){
 const rows=[];
 const exclude=new Set(['artifacts.json','result.json','active.json','host.log','host-process.json','operation.lock']);
 async function walk(dir,relative=''){
  for(const e of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   const rel=relative+e.name,file=path.join(dir,e.name);
   if(!relative&&exclude.has(e.name))continue;
   if(e.isDirectory())await walk(file,rel+'/');
   else if(e.isFile()){
    const identity=await fileIdentity(file),content=contentExports.find(c=>file.startsWith(c.directory+path.sep)||file===c.manifestFile);
    rows.push({id:'artifact-'+digest(rel).slice(0,24),role:content?content.role:(rel.includes('/protocol/')?'native-api-evidence':rel.endsWith('.log')?'native-command-log':'native-operation-state'),path:file,relativePath:rel,...identity,executable:((await lstat(file)).mode&0o111)!==0,scope:content&&!e.name.endsWith('.partial')?'native-content':'operator-private'});
   }else if(e.isSymbolicLink())fail('LIGHTDASH_ARTIFACT_SYMLINK','Native artifact inventory cannot follow a generated symlink.',{path:rel});
  }
 }
 await walk(root);rows.sort((a,b)=>a.relativePath.localeCompare(b.relativePath));
 const manifest=path.join(root,'artifacts.json');
 await saveJson(manifest,{schema:'lightdash-commissioning.artifacts.v1',operationId:op.operationId,digest:op.digest,files:rows,excludedLiveControlFiles:[...exclude],partialFilesIncludedAsOperatorPrivate:true});
 return {artifacts:rows,artifactManifest:{schema:'lightdash-commissioning.artifacts.v1',path:manifest,relativePath:'artifacts.json',...await fileIdentity(manifest)}};
}
async function execute(){
 await verifySources();
 if(active)await restoreAttempt();
 await validateContinuation();
 if(!attempt)await startAttempt();
 if(mode==='inspect')return reconcile();
 const uncertain=attempt.phases.filter(p=>p.key==='command'&&p.dispatchIntent&&!p.exit&&!p.spawnError).at(-1);
 if(uncertain){const exit=await readJson(phasePath(uncertain.id,'.native-exit.json'),{optional:true});if(!exit)return reconcile();}
 const worktree=path.join(attempt.directory,'source');
 const copied=await readJson(path.join(attempt.directory,'source-copy.json'),{optional:true});
 if(copied)check(copied.sourceManifestSha256===op.edition.manifestSha256&&copied.sourceSha256===op.edition.sourceSha256,'LIGHTDASH_SOURCE_COPY','Retained native source copy belongs to another edition.');
 else{await copyInventory(op.edition.directory,worktree,op.edition.files);await saveJson(path.join(attempt.directory,'source-copy.json'),{sourceManifestSha256:op.edition.manifestSha256,sourceSha256:op.edition.sourceSha256,files:op.edition.files},{createOnly:true});}
 const first=await runPhase('preflight',{bridgeMode:'preflight',readOnly:true});succeeded(first,'account/project inspection');
 let contentExports=nativeState?.contentExports??[];
 const needsDbt=['dbt-deps','dbt-build','compile','validate','deploy','start-preview'].includes(op.action);
 if(needsDbt){
  const deps=await runPhase(op.action==='dbt-deps'?'command':'dbt-deps',{kind:'dbt',argv:dbtArgs('deps',worktree),cwd:path.resolve(worktree,op.edition.projectDir)});succeeded(deps,'dbt deps');
 }
 let contentDirectory=null;
 if(op.action==='upload'){
  const selected=await contentSource();contentDirectory=path.join(attempt.directory,'input-content');await copyInventory(selected.directory,contentDirectory,selected.files);
  const exported=await nativeDownload('target-backup','target-before-upload',worktree);contentExports=rememberExport(contentExports,exported);
  await writeState('RUNNING',{contentExports});
 }
 if(op.action==='download'){const downloaded=await nativeDownload('command','download',worktree);contentExports=rememberExport(contentExports,downloaded);}
 if(op.action==='start-preview'&&op.input.warehouseCredentials==='copy-upstream'){
  const compiled=await runPhase('compile-before-preview',{argv:lightdashArgs('compile',worktree),cwd:attempt.directory});succeeded(compiled,'compile before upstream-credential preview');
 }
 let exit;
 if(op.action==='inspect'){exit=first;}
 else if(['dbt-deps','download'].includes(op.action)){exit=attempt.phases.filter(p=>p.key==='command').at(-1)?.exit;}
 else if(op.action==='dbt-build'){exit=await runPhase('command',{kind:'dbt',argv:dbtArgs('build',worktree),cwd:path.resolve(worktree,op.edition.projectDir)});}
 else exit=await runPhase('command',{argv:lightdashArgs(op.action,worktree,contentDirectory),cwd:attempt.directory,readOnly:op.action==='download'});
 succeeded(exit,op.action);
 const post=await runPhase('postflight',{bridgeMode:'postflight',readOnly:true});succeeded(post,'post-operation inspection');
 const observed=await observation(attempt.phases.filter(p=>p.key==='postflight').at(-1).id);
 const evidence=await findings();await assertCompletion(evidence,observed);
 contentExports=await finishReadbacks(contentExports);
 await writeState('RUNNING',{contentExports});
 return {state:'SUCCEEDED',observed,evidence,contentExports,recovery:{sameOperation:true,automaticWriteReplay:false,basis:'Original command exit, account/project readback and complete selected native artifacts retained.'}};
}
let outcome=null,error=null;
try{
 if(nativeState?.state==='SUCCEEDED'||(mode==='execute'&&nativeState?.state==='FAILED')){outcome={state:nativeState.state,replayed:true};}
 else outcome=await execute();
}catch(e){
 error=safeError(e);
 if(!attempt&&active)try{await restoreAttempt();}catch{}
 const evidence=attempt?await findings().catch(()=>null):null;
 const uncertain=e.code==='LIGHTDASH_UNCERTAIN_COMMAND'||evidence?.unansweredWrites?.length>0;
 outcome={state:uncertain?'NEEDS_RECONCILIATION':'FAILED',error,evidence,recovery:{sameOperation:true,automaticWriteReplay:false,resumeOf:op.operationId,message:'Inspect this retained operation before selecting a reviewed continuation; no command is automatically replayed.'}};
}finally{
 if(outcome?.replayed)console.log('Retained original native completion reopened.');
 else{
  const contentExports=outcome?.contentExports??nativeState?.contentExports??[],evidence=outcome?.evidence;
  let artifacts={},artifactError=null;
  try{artifacts=await artifactInventory(contentExports);}catch(e){artifactError=safeError(e);}
  const queryOutputs=[];if(attempt)for(const p of attempt.phases){const q=await readJson(phasePath(p.id,'.query-output.json'),{optional:true});if(q)queryOutputs.push(q);}
  const final={...base,state:outcome?.state??'INTERRUPTED',startedAt:nativeState?.startedAt??attempt?.startedAt??now(),completedAt:now(),attempt:attempt?.id??null,dispatched:!!attempt?.phases.some(p=>p.dispatchIntent),kernelLeaseHeld:false,native:{cliVersion:UPSTREAM.version,nodeVersion:process.versions.node,queryOutputs,observation:outcome?.observed??null,preview:evidence?.owner??null,commands:attempt?.phases.map(p=>({phase:p.id,kind:p.kind,nativeArgv:p.argv,dispatch:p.dispatchIntent??null,exit:p.exit??null,processExit:p.processExit??null}))??[],unansweredWrites:evidence?.unansweredWrites??[]},nativeReferences:evidence?.refs??nativeState?.nativeReferences??[],contentExports,...artifacts,recovery:outcome?.recovery??null,error:outcome?.error??error,artifactError};
  if(artifactError&&final.state==='SUCCEEDED')final.state='NEEDS_RECONCILIATION';
  await saveJson(path.join(root,'result.json'),final);
  console.log(JSON.stringify({operationId:op.operationId,state:final.state,attempt:final.attempt,artifacts:final.artifacts?.length??0}));
 }
}
