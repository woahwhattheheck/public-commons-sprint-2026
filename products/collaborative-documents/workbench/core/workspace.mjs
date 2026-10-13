import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { Uploads, DOCUMENT_LIMIT } from './uploads.mjs';
import { permissions, documentAccess, requireOperator } from './auth.mjs';
import { prepareMigration } from './migration.mjs';
import { DomainError, text, id, integer, oneOf, object, array, clone, identity, requireValue, uuid, now } from './common.mjs';
export {DomainError};

const CLOSED=new Set(['complete','failed','interrupted']);
const CONFIG_DEFAULT={debounceMs:500,maxDebounceMs:2000,maxDocumentBytes:DOCUMENT_LIMIT,allowedOrigins:[]};
function selected(rows,value,label){id(value,label);const row=rows.find(r=>r.id===value);requireValue(row,label.toUpperCase()+'_NOT_FOUND','The selected '+label+' was not found.',404);return row;}
function checkedConfig(value){
  object(value,'config');for(const key of Object.keys(value))requireValue(Object.keys(CONFIG_DEFAULT).includes(key),'INVALID_CONFIG','This original native configuration key is not supported.',400,{key});
  const c={...CONFIG_DEFAULT,...value};
  integer(c.debounceMs,'debounceMs',{min:0,max:60000});integer(c.maxDebounceMs,'maxDebounceMs',{min:c.debounceMs,max:300000});integer(c.maxDocumentBytes,'maxDocumentBytes',{min:1024,max:DOCUMENT_LIMIT});
  array(c.allowedOrigins,'allowedOrigins',{max:100});for(const origin of c.allowedOrigins){let u;try{u=new URL(origin);}catch{}requireValue(u&&['http:','https:'].includes(u.protocol)&&u.origin===origin,'INVALID_ORIGIN','Use exact HTTP(S) origins without paths or credentials.');}
  return c;
}
export class Workspace {
  constructor({store,runtime,sourceRoot,sourceFiles}){
    this.store=store;this.runtime=runtime;this.uploads=new Uploads(store);this.sourceRoot=sourceRoot??dirname(dirname(fileURLToPath(import.meta.url)));this.sourceFiles=sourceFiles;this.queues=new Map();this.receiving=new Set();this.jobs=null;this.archives=null;
  }
  async serial(projectId,fn){
    const previous=this.queues.get(projectId)??Promise.resolve(),next=previous.catch(()=>{}).then(fn);this.queues.set(projectId,next);
    try{return await next;}finally{if(this.queues.get(projectId)===next)this.queues.delete(projectId);}
  }
  view(actor,value,{historical=false,currentRevision,refreshNative=true}={}){
    const state=clone(value),p=permissions(actor);
    if(!historical&&refreshNative)this.store.refreshNative(state);
    state.documents=state.documents.map(d=>({...d,access:documentAccess(value,d,actor)}));
    if(!p.operate){
      state.documents=state.documents.filter(d=>d.access!=='none');const tenants=new Set(state.documents.map(d=>d.tenantId));
      state.tenants=state.tenants.filter(t=>tenants.has(t.id));
      state.sources=[];state.migrations=[];state.jobs=[];state.checkpoints=[];state.handoffs=[];state.history=[];state.reviews=[];
      state.grants=state.grants.filter(g=>g.actorId===actor.id);
      state.editions=state.editions.map(e=>({id:e.id,title:e.title,schemaId:e.schemaId,field:e.field,status:e.status}));
      state.deployments=state.deployments.map(d=>({id:d.id,title:d.title,editionId:d.editionId,status:d.status}));
    }
    state.permissions=p;state.historical=historical;state.currentRevision=currentRevision??this.store.head(state.id);
    state.runtime=this.runtime?.status(state.id)??{configured:false,ready:false,selection:null,observedAt:null,error:null};
    if(!historical)for(const deployment of state.deployments)deployment.connections=this.runtime?.connections(state.id,deployment.id)??[];
    return state;
  }
  result(actor,result){return {...result,view:this.view(actor,result.view,{historical:result.replayed&&result.view.revision!==result.currentRevision,currentRevision:result.currentRevision,refreshNative:false})};}
  requestReceipt(actor,requestId){
    requireOperator(actor);
    const receipt=this.store.requestReceipt(actor.id,requestId);
    return {...receipt,response:this.result(actor,receipt.response)};
  }
  async read(actor,projectId,revision){
    requireValue(permissions(actor).read,'FORBIDDEN','The current host actor has no application read permission.',403);
    if(revision===undefined)await this.reconcile(projectId);
    const value=this.store.get(projectId,revision),view=this.view(actor,value,{historical:revision!==undefined,currentRevision:this.store.head(projectId)});
    if(!permissions(actor).operate)requireValue(view.documents.length||actor.tenantIds.some(t=>value.tenants.some(v=>v.id===t)),'PROJECT_FORBIDDEN','The current actor has no tenant scope in this project.',403);
    return view;
  }
  async list(actor){
    requireValue(permissions(actor).read,'FORBIDDEN','The current host actor has no application read permission.',403);
    const projects=[];for(const state of this.store.list()){if(!permissions(actor).operate&&!state.tenants.some(t=>actor.tenantIds.includes(t.id)))continue;const view=this.view(actor,state);projects.push({id:view.id,title:view.title,revision:view.revision,updatedAt:view.updatedAt,documentCount:view.documents.length,sourceCount:view.sources.length,deploymentState:this.runtime?.has(view.id)?'running':'stopped'});}
    return {instanceId:this.store.instanceId,projects};
  }
  create(actor,input){requireOperator(actor);text(input.title,'title',{min:1,max:300});text(input.notes??'','notes',{max:10000});return this.result(actor,this.store.create(actor,input));}
  async reconcile(projectId){
    if(this.receiving.has(projectId))return;
    await this.jobs?.reconcile(projectId);
    if(this.receiving.has(projectId))return;
    const state=this.store.get(projectId),local=this.store.local(projectId);
    if(local?.instanceId===this.store.instanceId&&['running','stopping'].includes(local.status)&&!this.runtime?.has(projectId)){
      this.store.internal(projectId,'deployment-interrupted:'+local.deploymentId+':'+local.launchId,'deployment.interrupted',s=>{
        const d=s.deployments.find(v=>v.id===local.deploymentId);if(d&&['running','stopping'].includes(d.status)){d.status='interrupted';d.lastError={code:'HOST_LIFETIME_ENDED',message:'The original collaboration host ended. Its last persisted binary state remains retained.'};}
        if(s.activeDeploymentId===local.deploymentId)s.activeDeploymentId=null;return {deploymentId:local.deploymentId};
      });
      this.store.setLocal(projectId,{...local,status:'interrupted',observedAt:now()});
    }
  }
  noActiveJob(state){requireValue(!state.jobs.some(j=>!CLOSED.has(j.status)&&j.localOriginInstanceId===this.store.instanceId),'JOB_BUSY','Finish or explicitly recover the original local job before another native change.',423);}
  queueJob(state,kind,payload){
    this.noActiveJob(state);
    const at=now(),attemptId=uuid('attempt'),job={id:uuid('job'),kind,status:'queued',attemptId,attempts:[{id:attemptId,status:'queued',createdAt:at,startedAt:null,completedAt:null,result:null,error:null}],progress:{completed:0,total:0},result:null,error:null,createdAt:at,updatedAt:at,files:[],payload:clone(payload),localOriginInstanceId:this.store.instanceId};
    state.jobs.push(job);return job;
  }
  async dispatch(actor,input){
    requireOperator(actor);object(input,'action input');id(input.projectId,'projectId');id(input.requestId,'requestId');text(input.action,'action',{min:1,max:80});object(input.payload,'payload');integer(input.expectedRevision,'expectedRevision');
    // Receiving locks the imported project, not an unrelated placeholder; this avoids cross-project lock inversion.
    if(input.action==='handoff.receive')return this.result(actor,await this.archives.receive(actor,input));
    return this.serial(input.projectId,async()=>{
      const replay=this.store.request(actor.id,input.requestId,input);if(replay)return this.result(actor,replay);
      requireValue(!this.receiving.has(input.projectId),'RECEIVING_BUSY','This project is receiving its original portable history.',423);
      const current=this.store.get(input.projectId);requireValue(current.revision===input.expectedRevision,'REVISION_CONFLICT','The project changed; reconcile the original request.',409,{currentRevision:current.revision});
      const p=input.payload;
      if(input.action==='handoff.prepare')return this.result(actor,await this.archives.prepare(actor,input));
      let prepared=null;
      if(input.action==='migration.plan')prepared=await prepareMigration(this.store,current,p);
      const result=this.store.commit(actor,input,state=>{
        switch(input.action){
          case 'project.update':{
            if(p.title!==undefined)state.title=text(p.title,'title',{min:1,max:300});
            if(p.notes!==undefined)state.notes=text(p.notes,'notes',{max:10000});
            if(p.settings){object(p.settings,'settings');for(const k of Object.keys(p.settings))requireValue(['namespace','defaultField','sessionTtlSeconds'].includes(k),'INVALID_SETTINGS','Unknown project setting.');
              if(p.settings.namespace!==undefined){id(p.settings.namespace,'namespace');requireValue(!state.documents.length||p.settings.namespace===state.settings.namespace,'NAMESPACE_IN_USE','A native document namespace is immutable after import.',409);state.settings.namespace=p.settings.namespace;}
              if(p.settings.defaultField!==undefined){requireValue(p.settings.defaultField==='default','SCHEMA_SELECTION','The installed reference field is default.',409);state.settings.defaultField=p.settings.defaultField;}
              if(p.settings.sessionTtlSeconds!==undefined)state.settings.sessionTtlSeconds=integer(p.settings.sessionTtlSeconds,'sessionTtlSeconds',{min:30,max:3600});
            }return {projectId:state.id};
          }
          case 'source.retain':{
            const upload=this.uploads.completed(actor,p.uploadId),role=oneOf(p.role,['documents','schema','application','auth_contract','other'],'role');
            const source={id:uuid('source'),title:text(p.title,'title',{min:1,max:300}),role,filename:upload.filename,mediaType:upload.mediaType,bytes:upload.bytes,sha256:upload.sha256,url:text(p.url??'','url',{max:4000}),capturedAt:now(),metadata:clone(p.metadata??{})};
            object(source.metadata,'metadata');if(source.url){let url;try{url=new URL(source.url);}catch{}requireValue(url&&['https:','http:'].includes(url.protocol)&&!url.username&&!url.password,'INVALID_SOURCE_URL','Use the original public HTTP(S) source URL without embedded credentials.');}
            state.sources.push(source);return {sourceId:source.id};
          }
          case 'tenant.save':{
            const tenantId=p.tenantId?id(p.tenantId,'tenantId'):uuid('tenant'),old=state.tenants.find(t=>t.id===tenantId),tenant={id:tenantId,name:text(p.name,'name',{min:1,max:300}),notes:text(p.notes??'','notes',{max:10000})};
            if(old)Object.assign(old,tenant);else state.tenants.push(tenant);return {tenantId};
          }
          case 'grant.save':{
            const tenant=selected(state.tenants,p.tenantId,'tenant'),actorId=id(p.actorId,'actorId'),documentIds=array(p.documentIds??[],'documentIds',{max:10000}).map(v=>id(v,'documentId'));
            for(const documentId of documentIds)requireValue(state.documents.some(d=>d.id===documentId&&d.tenantId===tenant.id),'GRANT_SCOPE','Every selected document must belong to this exact tenant.',409);
            requireValue(typeof p.enabled==='boolean','INVALID_INPUT','enabled must be boolean.');
            const grantId=p.grantId?id(p.grantId,'grantId'):uuid('grant'),old=state.grants.find(g=>g.id===grantId),grant={id:grantId,actorId,tenantId:tenant.id,documentIds:[...new Set(documentIds)],access:oneOf(p.access,['read','write'],'access'),enabled:p.enabled,reason:text(p.reason,'reason',{min:1,max:5000}),updatedAt:now()};
            if(old)Object.assign(old,grant);else state.grants.push(grant);return {grantId,actorId};
          }
          case 'edition.save':{
            const editionId=p.editionId?id(p.editionId,'editionId'):uuid('edition'),old=state.editions.find(e=>e.id===editionId);requireValue(!old||old.status==='draft','EDITION_FROZEN','Create a new edition to change a frozen source/configuration.',409);
            const sourceIds=array(p.sourceIds,'sourceIds',{max:10000}).map(v=>selected(state.sources,v,'source').id);
            requireValue(p.schemaId==='reference-v1'&&p.field==='default','SCHEMA_SELECTION','This installed source exposes reference-v1 and field default.',409);
            const edition={id:editionId,title:text(p.title,'title',{min:1,max:300}),notes:text(p.notes??'','notes',{max:10000}),sourceIds:[...new Set(sourceIds)],schemaId:p.schemaId,field:p.field,config:checkedConfig(p.config),sourceSha256:null,createdAt:old?.createdAt??now(),status:'draft'};
            if(old)Object.assign(old,edition);else state.editions.push(edition);return {editionId};
          }
          case 'edition.freeze':{
            const edition=selected(state.editions,p.editionId,'edition');requireValue(edition.status==='draft','EDITION_FROZEN','This source edition is already frozen.',409);
            edition.runtimeSelection=clone(this.runtime.selection);
            edition.sourceSha256=identity({schemaId:edition.schemaId,field:edition.field,config:edition.config,runtimeSelection:edition.runtimeSelection,sources:edition.sourceIds.map(sourceId=>{const source=selected(state.sources,sourceId,'source');return {sourceId,sha256:source.sha256,bytes:source.bytes};})});edition.status='frozen';edition.frozenAt=now();state.currentEditionId=edition.id;return {editionId:edition.id,sourceSha256:edition.sourceSha256};
          }
          case 'migration.plan':state.migrations.push(prepared);return {migrationId:prepared.id,rows:prepared.rows.length};
          case 'migration.review':{
            const migration=selected(state.migrations,p.migrationId,'migration');requireValue(!migration.jobId,'MIGRATION_ALREADY_STARTED','An applied migration retains its original review. Create another reviewed source plan.',409);
            const changes=array(p.rows,'rows',{max:10000}),seen=new Set();for(const change of changes){
              const row=selected(migration.rows,change.rowId,'row');requireValue(!seen.has(row.id),'DUPLICATE_REVIEW','A row appears twice in this review.');seen.add(row.id);
              const decision=oneOf(change.decision,['import','skip'],'decision');requireValue(decision!=='import'||row.status==='ready','ROW_NOT_READY','A row with native schema errors cannot be imported.',409);
              if(change.tenantId!==undefined)row.tenantId=selected(state.tenants,change.tenantId,'tenant').id;
              if(change.documentName!==undefined)row.documentName=id(change.documentName,'documentName');
              if(change.title!==undefined)row.title=text(change.title,'title',{min:1,max:500});
              row.decision=decision;row.reason=text(change.reason??'','reason',{min:decision==='skip'?1:0,max:5000});if(decision==='skip')row.status='skipped';else row.status='ready';
            }
            migration.status=migration.rows.every(r=>r.decision!=='unreviewed')?'reviewed':'planned';return {migrationId:migration.id,reviewed:changes.length};
          }
          case 'migration.apply':{
            const migration=selected(state.migrations,p.migrationId,'migration');requireValue(!migration.jobId&&migration.status==='reviewed','MIGRATION_REVIEW_REQUIRED','Review every original source row before the one import.',409);
            requireValue(migration.rows.some(r=>r.decision==='import'),'NO_IMPORT_ROWS','Select at least one ready source row for import.',409);
            const keys=new Set();for(const row of migration.rows.filter(r=>r.decision==='import')){requireValue(row.prepared&&row.status==='ready','ROW_NOT_READY','Every imported row needs original prepared native bytes.',409);const key=row.tenantId+'\0'+row.documentName;requireValue(!keys.has(key)&&!state.documents.some(d=>d.tenantId===row.tenantId&&d.logicalKey===row.documentName),'DOCUMENT_EXISTS','Import requires a new logical document; use explicit content restore for an existing target.',409);keys.add(key);}
            const job=this.queueJob(state,'migration',{migrationId:migration.id});migration.jobId=job.id;migration.status='queued';job.progress.total=migration.rows.filter(r=>r.decision==='import').length;return {jobId:job.id,migrationId:migration.id};
          }
          case 'deployment.prepare':{
            const edition=selected(state.editions,p.editionId,'edition');requireValue(edition.status==='frozen','EDITION_NOT_FROZEN','Freeze the selected source/configuration edition first.',409);
            const deployment={id:uuid('deployment'),title:text(p.title,'title',{min:1,max:300}),editionId:edition.id,status:'prepared',createdAt:now(),startedAt:null,stoppedAt:null,jobId:null,connections:[],lastError:null};state.deployments.push(deployment);return {deploymentId:deployment.id};
          }
          case 'deployment.start':{
            const deployment=selected(state.deployments,p.deploymentId,'deployment');requireValue(['prepared','stopped','failed','interrupted'].includes(deployment.status),'DEPLOYMENT_ACTIVE','The original selected deployment is already active.',409);
            requireValue(!this.runtime.has(state.id),'DEPLOYMENT_ACTIVE','Stop the current native deployment before selecting another.',423);
            const job=this.queueJob(state,'deployment.start',{deploymentId:deployment.id});deployment.jobId=job.id;return {jobId:job.id,deploymentId:deployment.id};
          }
          case 'deployment.stop':{
            const deployment=selected(state.deployments,p.deploymentId,'deployment');text(p.reason,'reason',{min:1,max:5000});const job=this.queueJob(state,'deployment.stop',{deploymentId:deployment.id,reason:p.reason});deployment.status='stopping';deployment.jobId=job.id;return {jobId:job.id,deploymentId:deployment.id};
          }
          case 'deployment.rollback':{
            requireValue(p.documentPolicy==='preserve_current','ROLLBACK_POLICY','Runtime/configuration rollback must preserve current native document state.',409);
            const deployment=selected(state.deployments,p.deploymentId,'deployment'),edition=selected(state.editions,p.targetEditionId,'edition');requireValue(edition.status==='frozen','EDITION_NOT_FROZEN','Rollback selects a retained frozen edition.',409);text(p.reason,'reason',{min:1,max:5000});
            const job=this.queueJob(state,'deployment.rollback',{deploymentId:deployment.id,targetEditionId:edition.id,reason:p.reason,documentPolicy:p.documentPolicy});deployment.jobId=job.id;return {jobId:job.id,deploymentId:deployment.id};
          }
          case 'checkpoint.create':{
            oneOf(p.mode,['drain','persisted'],'mode');text(p.title,'title',{min:1,max:300});if(p.deploymentId)selected(state.deployments,p.deploymentId,'deployment');
            const checkpointId=uuid('checkpoint'),job=this.queueJob(state,'checkpoint',{checkpointId,title:p.title,deploymentId:p.deploymentId??state.activeDeploymentId,mode:p.mode});return {jobId:job.id,checkpointId};
          }
          case 'document.restore':{
            requireValue(p.mode==='new_epoch','RESTORE_POLICY','Content restore creates an explicit new document epoch.',409);text(p.reason,'reason',{min:1,max:5000});
            const checkpoint=selected(state.checkpoints,p.checkpointId,'checkpoint'),documentIds=array(p.documentIds,'documentIds',{max:10000});requireValue(documentIds.length,'NO_DOCUMENTS','Select the original documents to restore.');
            const plan=[...new Set(documentIds)].map(documentId=>{selected(state.documents,documentId,'document');requireValue(checkpoint.documents.some(d=>d.documentId===documentId),'CHECKPOINT_DOCUMENT','The selected checkpoint does not contain this document.',409);return {documentId,expectedEpochId:state.documents.find(d=>d.id===documentId).epochId,newEpochId:uuid('epoch')};});
            const job=this.queueJob(state,'document.restore',{checkpointId:checkpoint.id,plan,reason:p.reason,mode:p.mode});job.progress.total=plan.length;return {jobId:job.id,documentIds};
          }
          case 'job.cancel':{
            const job=selected(state.jobs,p.jobId,'job');requireValue(job.localOriginInstanceId===this.store.instanceId,'RECEIVED_JOB','A received source-host job cannot be controlled by this installation.',409);requireValue(!CLOSED.has(job.status),'JOB_CLOSED','This original job is already closed.',409);
            job.status='cancelling';job.cancelReason=text(p.reason,'reason',{min:1,max:5000});job.updatedAt=now();const attempt=job.attempts.find(a=>a.id===job.attemptId);if(attempt)attempt.status='cancelling';return {jobId:job.id};
          }
          case 'job.resume':{
            const job=selected(state.jobs,p.jobId,'job');requireValue(job.localOriginInstanceId===this.store.instanceId,'RECEIVED_JOB','A received source-host job cannot be resumed here.',409);requireValue(['failed','interrupted'].includes(job.status),'JOB_NOT_RESUMABLE','Only the original closed failed/interrupted job can resume.',409);this.noActiveJob(state);text(p.reason,'reason',{min:1,max:5000});
            job.attemptId=uuid('attempt');job.status='queued';job.error=null;job.result=null;job.cancelReason=null;job.updatedAt=now();job.attempts.push({id:job.attemptId,status:'queued',createdAt:job.updatedAt,startedAt:null,completedAt:null,result:null,error:null,reason:p.reason});return {jobId:job.id,attemptId:job.attemptId};
          }
          case 'review.save':{
            const key={migration:'migrations',checkpoint:'checkpoints',deployment:'deployments',handoff:'handoffs'}[p.subjectType];requireValue(key,'INVALID_REVIEW','Choose a supported review subject.');selected(state[key],p.subjectId,p.subjectType);
            const review={id:uuid('review'),subjectType:p.subjectType,subjectId:p.subjectId,decision:oneOf(p.decision,['accepted','changes_requested','rejected'],'decision'),note:text(p.note,'note',{min:1,max:10000}),evidenceSourceIds:array(p.evidenceSourceIds??[],'evidenceSourceIds').map(v=>selected(state.sources,v,'source').id),actorId:actor.id,createdAt:now()};state.reviews.push(review);return {reviewId:review.id};
          }
          default:requireValue(false,'ACTION_NOT_FOUND','The selected action is not implemented.',404);
        }
      });
      if(input.action==='grant.save')await this.runtime.recheck(input.projectId);
      if(result.result?.jobId)this.jobs.launch(input.projectId,result.result.jobId);
      return this.result(actor,result);
    });
  }
  document(actor,projectId,documentId,revision){
    const project=this.store.get(projectId,revision),document=selected(project.documents,documentId,'document');
    const current=this.store.get(projectId),currentDocument=selected(current.documents,documentId,'document');
    requireValue(documentAccess(current,currentDocument,actor)!=='none','DOCUMENT_FORBIDDEN','The current actor has no grant for this document.',403);return {project,document};
  }
  async close(){
    // Every admitted request/job retains the same native store until its real
    // completion. A rejected close retries these original owners.
    await this.uploads.drain();await this.jobs?.drain();
    while(this.queues.size)await Promise.allSettled([...this.queues.values()]);
    await this.runtime?.close();
    this.store.close();
  }
}
