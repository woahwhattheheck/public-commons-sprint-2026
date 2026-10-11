// MIT. Own the existing accounting runtime while its original recovery engine operates.
import {constants} from 'node:fs';
import {lstat,mkdir,open,readdir,realpath,rename,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,isAbsolute,join,resolve,sep} from 'node:path';
import {acquireStateLease} from '../../merchant-fleet-gateway/state-lease.mjs';
import {accountingRecoveryStatus,inspectAccountingBackup,reviewAccountingWorkspace,
  snapshotAccountingWorkspace,verifyAccountingBackup,restoreAccountingWorkspace} from './recovery.mjs';

const SCHEMA='stellar-forge.accounting-maintenance.v1';
const JOB='stellar-forge.accounting-maintenance-job.v1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const CHILD=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const ACTIVE=new Set(['QUEUED','RUNNING']);
const CANCELLABLE=new Set(['review','backup','verify','restore']);
const now=()=>new Date().toISOString();
const json=value=>JSON.stringify(value,null,2)+'\n';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const inside=(parent,path)=>path===parent||path.startsWith(parent+sep);
const need=(value,code,message,status=400)=>{if(!value)throw Object.assign(new Error(message),{code,status});};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const detail=error=>({code:error.code??'ACCOUNTING_MAINTENANCE_FAILED',message:String(error.message??error).slice(0,2000)});
function absolute(path){need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&path!=='/'&&!path.includes('\0'),
  'ACCOUNTING_MAINTENANCE_PATH','Declare an absolute normalized private path on the merchant host.');return path;}
async function stat(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function privateDirectory(path,{create=false}={}){
  absolute(path);if(create)try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const info=await stat(path);need(info?.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&
    (process.getuid===undefined||info.uid===process.getuid())&&await realpath(path)===path,
  'ACCOUNTING_MAINTENANCE_PRIVATE_ROOT','Declare a real owner-private directory with mode 0700.');
}
async function readJSON(path,{optional=false,max=4_000_000}={}){
  let file;try{file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));}
  catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
  try{const info=await file.stat();need(info.isFile()&&info.nlink===1&&info.size<=max&&!(info.mode&0o077),
      'ACCOUNTING_MAINTENANCE_FILE','A retained maintenance record must be a bounded private regular file.');
    const bytes=await file.readFile();need(bytes.length<=max,'ACCOUNTING_MAINTENANCE_FILE','The retained maintenance record exceeds its size limit.');
    try{return JSON.parse(bytes.toString('utf8'));}catch{need(false,'ACCOUNTING_MAINTENANCE_JSON','A retained maintenance record is invalid JSON.');}
  }finally{await file.close();}
}
async function writeJSON(path,value){
  const temporary=path+'.'+randomUUID()+'.pending';let created=false;
  try{const file=await open(temporary,'wx',0o600);created=true;try{await file.writeFile(json(value));await file.sync();}finally{await file.close();}
    await rename(temporary,path);const directory=await open(dirname(path),constants.O_RDONLY|(constants.O_DIRECTORY??0));
    try{await directory.sync();}finally{await directory.close();}
  }finally{if(created)await rm(temporary,{force:true});}
}

export async function openAccountingMaintenance(options){
  const controller=new AccountingMaintenance(options);
  try{await controller.init();return controller;}
  catch(error){await controller.close().catch(()=>{});throw error;}
}

class AccountingMaintenance{
  constructor({directory,stateRoot,backupRoot,passEnv='STARFORGE_ACCOUNTING_BACKUP_PASSPHRASE',startPaused=false,openRuntime,closeRuntime}){
    this.directory=absolute(directory);this.enabled=Boolean(stateRoot||backupRoot||startPaused);
    this.config={directory:this.directory,stateRoot,backupRoot,passEnv};this.startPaused=startPaused;
    this.openRuntime=openRuntime;this.closeRuntime=closeRuntime;this.runtime=null;
    this.mode='PAUSED';this.review=null;this.recovery=null;this.active=null;this.activePromise=null;
    this.tail=Promise.resolve();this.commands=Promise.resolve();this.requests=0;this.drainWaiters=[];
    this.closing=false;this.state={schema:SCHEMA,directory:this.directory,stateRoot,backupRoot,passEnv,
      requestedMode:startPaused?'PAUSED':'RUNNING',recent:[],jobsTotal:0,backups:[]};
    this.recentJobs=new Map();
  }
  async init(){
    if(!this.enabled){this.runtime=await this.openRuntime();this.mode='RUNNING';return;}
    const {stateRoot,backupRoot,passEnv}=this.config;
    need(stateRoot&&backupRoot,'ACCOUNTING_MAINTENANCE_CONFIG','Declare both the private state root and the separate backup root.');
    await privateDirectory(stateRoot);await privateDirectory(backupRoot,{create:true});
    need(inside(stateRoot,this.directory)&&stateRoot!==this.directory,'ACCOUNTING_MAINTENANCE_SCOPE','The declared state root must contain the original workspace.');
    need(!inside(this.directory,backupRoot)&&!inside(backupRoot,this.directory),
      'ACCOUNTING_MAINTENANCE_SCOPE','Keep the backup catalog separate from the original workspace.');
    need(/^[A-Z][A-Z0-9_]{4,63}$/.test(passEnv),'ACCOUNTING_MAINTENANCE_PASSPHRASE','Declare an uppercase passphrase environment-variable name.');
    this.lease=await acquireStateLease(backupRoot);this.stateFile=join(backupRoot,'maintenance.json');
    this.operations=join(backupRoot,'operations');await privateDirectory(this.operations,{create:true});
    const retained=await readJSON(this.stateFile,{optional:true});
    if(retained){need(retained.schema===SCHEMA&&retained.directory===this.directory&&retained.stateRoot===stateRoot&&retained.backupRoot===backupRoot&&
        retained.passEnv===passEnv&&Array.isArray(retained.recent)&&retained.recent.length<=200&&retained.recent.every(id=>UUID.test(id))&&
        Array.isArray(retained.backups)&&retained.backups.length<=9990&&Number.isSafeInteger(retained.jobsTotal),
      'ACCOUNTING_MAINTENANCE_BINDING','The retained catalog belongs to a different declared accounting operation.');
      this.state=retained;
      for(const id of this.state.recent){const job=await this.readJob(id);
        if(ACTIVE.has(job.status)){job.status='INTERRUPTED';job.finishedAt=now();job.error={code:'ACCOUNTING_MAINTENANCE_INTERRUPTED',
          message:'The previous host stopped during this operation. Inspect the retained state, then explicitly continue the same backup or workspace.'};await writeJSON(this.jobPath(id),job);}
        this.recentJobs.set(id,job);
      }
    }
    await this.scanBackups();await this.refreshRecovery();
    if(!this.startPaused&&this.state.requestedMode==='RUNNING'&&this.recovery.status!=='RESTORE_IN_PROGRESS'){
      try{this.runtime=await this.openRuntime();this.mode='RUNNING';}
      catch(error){this.mode='RECOVERY_REQUIRED';this.recovery={...this.recovery,openError:detail(error)};this.state.requestedMode='PAUSED';}
    }else this.mode=this.recovery.status==='NO_RESTORE_IN_PROGRESS'?'PAUSED':'RECOVERY_REQUIRED';
    if(this.startPaused)this.state.requestedMode='PAUSED';
    await this.persist();
  }
  jobPath(id){need(UUID.test(id),'ACCOUNTING_MAINTENANCE_REQUEST','Use the retained operation ID.');return join(this.operations,id+'.json');}
  async readJob(id,{optional=false}={}){
    const job=await readJSON(this.jobPath(id),{optional:true,max:4_000_000});if(!job){need(optional,'ACCOUNTING_MAINTENANCE_JOB_NOT_FOUND','The retained operation was not found.',404);return null;}
    need(job.schema===JOB&&job.id===id&&SHA.test(job.requestDigest),'ACCOUNTING_MAINTENANCE_JOB','The retained operation record is invalid.');return job;
  }
  serialize(fn){const task=this.tail.then(fn);this.tail=task.catch(()=>{});return task;}
  persist(job){return this.serialize(async()=>{
    this.lease?.assertHeld();if(job)await writeJSON(this.jobPath(job.id),job);
    if(this.enabled)await writeJSON(this.stateFile,this.state);
  });}
  async scanBackups(){
    const {backupRoot}=this.config,prior=new Map(this.state.backups.map(item=>[item.id,item])),backups=[];
    const names=await readdir(backupRoot,{withFileTypes:true});
    need(names.length<=10_000,'ACCOUNTING_MAINTENANCE_LIMIT','The configured recovery catalog exceeds 10,000 entries.');
    for(const entry of names){if(entry.name==='operations'||!entry.isDirectory()||!CHILD.test(entry.name))continue;
      const bundle=join(backupRoot,entry.name);if(!(await stat(join(bundle,'backup.json'))))continue;
      try{const found=await inspectAccountingBackup({bundle}),saved=prior.get(entry.name);
        backups.push({id:entry.name,label:saved?.label??entry.name,createdAt:found.createdAt,manifestSha256:found.manifestSha256,files:found.files,bytes:found.bytes,
          ...(saved?.manifestSha256===found.manifestSha256&&saved.verifiedAt?{verifiedAt:saved.verifiedAt}:{})});
      }catch(error){backups.push({id:entry.name,label:prior.get(entry.name)?.label??entry.name,status:'UNREADABLE',error:detail(error)});}
    }
    this.state.backups=backups.sort((a,b)=>(b.createdAt??'').localeCompare(a.createdAt??'')||a.id.localeCompare(b.id));
  }
  async refreshRecovery(){
    if(!(await stat(this.directory))){this.recovery={status:'WORKSPACE_ABSENT',directory:this.directory};return;}
    try{this.recovery=await accountingRecoveryStatus({directory:this.directory});
      if(this.recovery.status==='NO_RESTORE_IN_PROGRESS'&&!(await stat(join(this.directory,'workspace.json'))))this.recovery.status='WORKSPACE_ABSENT';
    }catch(error){this.recovery={status:'RECOVERY_STATUS_UNAVAILABLE',directory:this.directory,error:detail(error)};}
  }
  view(){
    const value=process.env[this.config.passEnv],passphraseConfigured=typeof value==='string'&&Buffer.byteLength(value)>=16&&Buffer.byteLength(value)<=65536;
    return {schema:SCHEMA,configured:this.enabled,mode:this.closing?'CLOSING':this.mode,
      config:{...this.config,passphraseConfigured},workspace:this.runtime?{revision:this.runtime.workspace.view().revision}:null,
      review:this.review,recovery:this.recovery,backups:this.state.backups,
      jobs:[...this.state.recent].reverse().slice(0,50).map(id=>this.recentJobs.get(id)).filter(Boolean),jobsTotal:this.state.jobsTotal,
      activeJobId:this.active?.job.id??null,error:this.lastError??null};
  }
  enter(){
    need(!this.closing&&this.mode==='RUNNING'&&this.runtime,'ACCOUNTING_MAINTENANCE_PAUSED','Accounting is paused for operating recovery. Open Backup & recovery to resume the original workspace.',503);
    this.requests++;let released=false;const runtime=this.runtime;
    return {...runtime,release:()=>{if(released)return;released=true;this.requests--;if(this.requests===0)for(const done of this.drainWaiters.splice(0))done();}};
  }
  async requestsDrained(){if(this.requests)await new Promise(done=>this.drainWaiters.push(done));}
  async stopRuntime(){await this.requestsDrained();if(this.runtime){const runtime=this.runtime;try{await this.closeRuntime(runtime);}finally{this.runtime=null;}}}
  normalize(kind,value,target){
    need(object(value),'ACCOUNTING_MAINTENANCE_REQUEST','Send a maintenance request object.');
    const fields={pause:[],review:[],resume:[],backup:['expectedReviewId','externalWritersStopped','label'],verify:['backupId','expectedSha256'],
      restore:['backupId','expectedSha256','externalWritersStopped'],cancel:[]}[kind];
    need(fields,'ACCOUNTING_MAINTENANCE_OPERATION','This maintenance operation was not found.',404);
    need(Object.keys(value).every(key=>['actor','requestId',...fields].includes(key)),'ACCOUNTING_MAINTENANCE_REQUEST','Only the declared operation fields are accepted.');
    need(UUID.test(value.requestId??''),'ACCOUNTING_MAINTENANCE_REQUEST','Supply a UUID requestId and retain it until the operation is reconciled.');
    need(typeof value.actor==='string'&&value.actor.trim().length>0&&value.actor.length<=160,'ACCOUNTING_MAINTENANCE_ACTOR','Name the operator accepting this action.');
    const input={kind,actor:value.actor.trim()};
    if(kind==='backup'){
      need(SHA.test(value.expectedReviewId??''),'ACCOUNTING_MAINTENANCE_REVIEW','Review the paused source closure before capturing it.');
      need(value.externalWritersStopped===true,'ACCOUNTING_MAINTENANCE_WRITERS','Confirm the original outbox, proof, terms and recovered-source writers have stopped.');
      need(value.label===undefined||typeof value.label==='string'&&value.label.trim().length>0&&value.label.length<=160,'ACCOUNTING_MAINTENANCE_LABEL','Use a backup label of 1 to 160 characters.');
      Object.assign(input,{expectedReviewId:value.expectedReviewId,externalWritersStopped:true,label:value.label?.trim()??'Accounting backup'});
    }
    if(kind==='verify'||kind==='restore'){
      need(CHILD.test(value.backupId??'')&&value.backupId!=='operations'&&SHA.test(value.expectedSha256??''),'ACCOUNTING_MAINTENANCE_BACKUP','Select a retained backup and its exact manifest identity.');
      Object.assign(input,{backupId:value.backupId,expectedSha256:value.expectedSha256});
      if(kind==='restore'){need(value.externalWritersStopped===true,'ACCOUNTING_MAINTENANCE_WRITERS','Confirm the original input writers have stopped before restoring.');input.externalWritersStopped=true;}
    }
    if(kind==='cancel'){need(UUID.test(target),'ACCOUNTING_MAINTENANCE_REQUEST','Select a retained operation.');input.target=target;}
    return {requestId:value.requestId,input,requestDigest:digest(input)};
  }
  command(kind,value,target){
    const request=this.normalize(kind,value,target),task=this.commands.then(()=>this.admit(request));
    this.commands=task.catch(()=>{});return task;
  }
  async admit({requestId,input,requestDigest}){
    need(this.enabled,'ACCOUNTING_MAINTENANCE_NOT_CONFIGURED','The host must declare recovery state and backup roots before using operating recovery.',409);
    need(!this.closing,'ACCOUNTING_MAINTENANCE_CLOSING','The accounting host is closing.',503);
    const existing=await this.readJob(requestId,{optional:true});
    if(existing){need(existing.requestDigest===requestDigest,'ACCOUNTING_MAINTENANCE_REQUEST_CHANGED','This requestId already belongs to different operation inputs.',409);
      if(ACTIVE.has(existing.status)&&this.active?.job.id!==existing.id){existing.status='INTERRUPTED';existing.finishedAt=now();existing.error={code:'ACCOUNTING_MAINTENANCE_INTERRUPTED',message:'The host stopped before this retained operation finished. Inspect its result and explicitly continue with a new requestId.'};await this.persist(existing);this.recentJobs.set(existing.id,existing);}
      return {accepted:true,duplicate:true,job:this.active?.job.id===existing.id?this.active.job:existing,state:this.view()};
    }
    need(!this.closing,'ACCOUNTING_MAINTENANCE_CLOSING','The accounting host is closing.',503);
    if(input.kind==='cancel')return this.cancelAccepted(requestId,input,requestDigest);
    need(!this.active,'ACCOUNTING_MAINTENANCE_BUSY','Finish or cancel the currently accepted maintenance operation first.',409);
    const {kind}=input;
    if(kind==='pause')need(this.mode==='RUNNING','ACCOUNTING_MAINTENANCE_MODE','Accounting must be running before it can be paused.',409);
    if(kind==='review'||kind==='backup')need(this.mode==='PAUSED','ACCOUNTING_MAINTENANCE_MODE','Pause and drain the original accounting workspace first.',409);
    if(kind==='backup')need(this.review?.reviewId===input.expectedReviewId,'ACCOUNTING_MAINTENANCE_REVIEW_CHANGED','Select the current retained source review.',409);
    if(kind==='restore'||kind==='resume')need(this.mode==='PAUSED'||this.mode==='RECOVERY_REQUIRED','ACCOUNTING_MAINTENANCE_MODE','Pause and drain the original accounting workspace first.',409);
    if(kind==='restore'){
      await this.refreshRecovery();need(this.recovery.status!=='RESTORE_IN_PROGRESS'||this.recovery.manifestSha256===input.expectedSha256,
        'ACCOUNTING_MAINTENANCE_RESTORE_PENDING','Resume the same backup recorded by the original incomplete restore.',409);
    }
    if(kind==='resume'){
      await this.refreshRecovery();need(this.recovery.status==='NO_RESTORE_IN_PROGRESS','ACCOUNTING_MAINTENANCE_RESTORE_PENDING','Restore the original workspace completely before reopening it.',409);
    }
    if(kind==='verify'||kind==='restore'){
      const backup=this.state.backups.find(item=>item.id===input.backupId);
      need(backup&&backup.manifestSha256===input.expectedSha256,'ACCOUNTING_MAINTENANCE_BACKUP_CHANGED','Select an inspected backup from this declared catalog.',409);
    }
    const previousMode=this.mode,previousRequested=this.state.requestedMode;
    const job={schema:JOB,id:requestId,requestId,requestDigest,kind,actor:input.actor,input,status:'QUEUED',phase:'ACCEPTED',createdAt:now(),cancellable:CANCELLABLE.has(kind)};
    this.active={job,controller:new AbortController()};
    if(kind==='pause'){this.mode='PAUSING';this.state.requestedMode='PAUSED';}
    if(kind==='resume')this.mode='RESUMING';
    if(kind==='restore')this.review=null;
    this.state.recent.push(job.id);this.state.recent=this.state.recent.slice(-200);this.state.jobsTotal++;
    this.recentJobs.set(job.id,job);for(const id of this.recentJobs.keys())if(!this.state.recent.includes(id))this.recentJobs.delete(id);
    try{await this.persist(job);}catch(error){this.mode=previousMode;this.state.requestedMode=previousRequested;this.active=null;throw error;}
    this.activePromise=this.run(this.active).catch(error=>{this.lastError=detail(error);});
    return {accepted:true,job,state:this.view()};
  }
  async cancelAccepted(id,input,requestDigest){
    const target=await this.readJob(input.target);
    need(target.cancellable,'ACCOUNTING_MAINTENANCE_CANCEL','Pausing and reopening finish their owned lifecycle transition; they cannot be cancelled midway.',409);
    const active=this.active?.job.id===target.id?this.active:null;
    const record={schema:JOB,id,requestId:id,requestDigest,kind:'cancel',actor:input.actor,input,status:'COMPLETE',phase:'CANCEL_REQUESTED',createdAt:now(),finishedAt:now(),cancellable:false,
      result:{targetId:target.id,cancelRequested:Boolean(active)}};
    await this.persist(record);
    if(active){active.job.cancelRequested=true;await this.persist(active.job);active.controller.abort();}
    return {accepted:true,job:record,state:this.view()};
  }
  async run(operation){
    const {job,controller}=operation,{input}=job,signal=controller.signal;
    const phase=async value=>{job.status='RUNNING';job.phase=value;job.startedAt??=now();await this.persist(job);};
    try{
      const base={directory:this.directory,stateRoot:this.config.stateRoot,quiesced:true,signal},password={passEnv:this.config.passEnv};
      if(job.kind==='pause'){
        await phase('DRAINING_ACCOUNTING');await this.stopRuntime();await this.refreshRecovery();this.mode=this.recovery.status==='NO_RESTORE_IN_PROGRESS'?'PAUSED':'RECOVERY_REQUIRED';this.review=null;
        job.result={status:'ACCOUNTING_PAUSED',recovery:this.recovery};
      }else if(job.kind==='review'){
        await phase('REVIEWING_ORIGINAL_SOURCES');this.review=await reviewAccountingWorkspace(base);
        job.result={status:this.review.status,reviewId:this.review.reviewId,revision:this.review.revision,
          operatingFiles:this.review.operatingFiles,operatingBytes:this.review.operatingBytes};
      }else if(job.kind==='backup'){
        await phase('CAPTURING_ENCRYPTED_BACKUP');const id='backup-'+job.id,output=join(this.config.backupRoot,id);
        job.result=await snapshotAccountingWorkspace({...base,...password,output,expectedReviewId:input.expectedReviewId});
        this.state.backups.unshift({id,label:input.label,createdAt:job.result.createdAt,manifestSha256:job.result.manifestSha256,files:job.result.files,bytes:job.result.bytes});
      }else if(job.kind==='verify'){
        await phase('AUTHENTICATING_BACKUP');job.result=await verifyAccountingBackup({bundle:join(this.config.backupRoot,input.backupId),expectedSha256:input.expectedSha256,signal,...password});
        const backup=this.state.backups.find(item=>item.id===input.backupId);backup.verifiedAt=now();
      }else if(job.kind==='restore'){
        await phase('RESTORING_ORIGINAL_PATHS');job.result=await restoreAccountingWorkspace({...base,...password,bundle:join(this.config.backupRoot,input.backupId),expectedSha256:input.expectedSha256});
      }else if(job.kind==='resume'){
        await phase('REOPENING_ACCOUNTING');this.runtime=await this.openRuntime();this.mode='RUNNING';this.state.requestedMode='RUNNING';this.review=null;
        job.result={status:'ACCOUNTING_REOPENED',revision:this.runtime.workspace.view().revision};
      }
      job.status='COMPLETE';job.phase='COMPLETE';
    }catch(error){job.status=signal.aborted?'CANCELLED':'FAILED';job.error=detail(error);
      if(job.kind==='backup'&&error.code==='ACCOUNTING_RECOVERY_REVIEW_CHANGED')this.review=null;
      if(job.kind==='pause'||job.kind==='resume'){this.mode='RECOVERY_REQUIRED';this.state.requestedMode='PAUSED';}
    }finally{
      job.finishedAt=now();job.cancellable=false;
      if(job.kind==='restore'){await this.refreshRecovery();this.mode=this.recovery.status==='NO_RESTORE_IN_PROGRESS'?'PAUSED':'RECOVERY_REQUIRED';}
      try{await this.persist(job);}finally{this.active=null;}
    }
  }
  async route({method,path,value}){
    if(!path.startsWith('/api/maintenance'))return undefined;
    if(path==='/api/maintenance'&&method==='GET')return this.view();
    const parts=path.split('/').filter(Boolean);
    if(parts.length===4&&parts[2]==='jobs'&&method==='GET')return {job:await this.readJob(parts[3]),state:this.view()};
    if(parts.length===5&&parts[2]==='jobs'&&parts[4]==='cancel'&&method==='POST')return this.command('cancel',value,parts[3]);
    if(parts.length===3&&method==='POST')return this.command(parts[2],value);
    need(false,'ACCOUNTING_MAINTENANCE_NOT_FOUND','This maintenance operation was not found.',404);
  }
  close(){
    if(!this.closingPromise){this.closing=true;this.closingPromise=(async()=>{
      try{await this.commands;await this.activePromise;await this.stopRuntime();await this.tail;}
      finally{await this.lease?.close();}
    })();}return this.closingPromise;
  }
}
