import { setImmediate as yieldTurn } from 'node:timers/promises';
import { clone, identity, uuid, now, requireValue, publicError, sha, canonical } from './common.mjs';

const TERMINAL=new Set(['complete','failed','interrupted']);
export class Jobs {
  constructor(workspace){this.workspace=workspace;this.store=workspace.store;this.runtime=workspace.runtime;this.running=new Map();this.closing=false;}
  key(projectId,jobId){return projectId+':'+jobId;}
  launch(projectId,jobId){
    const key=this.key(projectId,jobId);if(this.closing||this.running.has(key)||this.workspace.receiving.has(projectId))return;
    const task=Promise.resolve().then(()=>this.run(projectId,jobId)).catch(error=>{this.lastError=publicError(error);}).finally(()=>{if(this.running.get(key)===task)this.running.delete(key);});this.running.set(key,task);
  }
  async reconcile(projectId){
    if(this.workspace.receiving.has(projectId))return;
    const project=this.store.get(projectId);
    for(const job of project.jobs){
      if(job.localOriginInstanceId!==this.store.instanceId)continue;
      if(job.status==='queued'||job.status==='cancelling'){this.launch(projectId,job.id);continue;}
      if(job.status==='running'&&!this.running.has(this.key(projectId,job.id))){
        this.store.internal(projectId,'interrupted:'+job.id+':'+job.attemptId,'job.interrupted',s=>{
          const current=s.jobs.find(j=>j.id===job.id);if(current?.attemptId!==job.attemptId||current.status!=='running')return {jobId:job.id,unchanged:true};
          const error={code:'HOST_LIFETIME_ENDED',message:'The original job host ended. Resume this same job to reconcile its committed native steps.'};current.status='interrupted';current.error=error;current.updatedAt=now();const attempt=current.attempts.find(a=>a.id===current.attemptId);Object.assign(attempt,{status:'interrupted',error,completedAt:current.updatedAt});return {jobId:job.id,attemptId:job.attemptId};
        });
      }
    }
  }
  current(projectId,jobId,attemptId){
    const project=this.store.get(projectId),job=project.jobs.find(j=>j.id===jobId);
    requireValue(job&&job.attemptId===attemptId,'JOB_ATTEMPT_CHANGED','The original native attempt is no longer current.',409);
    requireValue(job.status!=='cancelling','JOB_CANCELLED','The original operator requested cancellation; committed native steps remain retained.',409);
    requireValue(!this.workspace.receiving.has(projectId),'RECEIVING_BUSY','Receiving owns this project while its full original history is adopted.',423);
    return {project,job};
  }
  async run(projectId,jobId){
    let first=this.store.get(projectId).jobs.find(j=>j.id===jobId);
    if(!first||TERMINAL.has(first.status)||first.localOriginInstanceId!==this.store.instanceId)return;
    const attemptId=first.attemptId;
    try{
      this.current(projectId,jobId,attemptId);
      this.store.internal(projectId,'start:'+jobId+':'+attemptId,'job.started',state=>{
        const job=state.jobs.find(j=>j.id===jobId);requireValue(job.attemptId===attemptId,'JOB_ATTEMPT_CHANGED','The job attempt changed.',409);
        if(job.status!=='cancelling')job.status='running';
        job.updatedAt=now();const attempt=job.attempts.find(a=>a.id===attemptId);if(attempt.status!=='cancelling')attempt.status='running';attempt.startedAt??=job.updatedAt;return {jobId,attemptId};
      });
      first=this.current(projectId,jobId,attemptId).job;let result;
      switch(first.kind){
        case 'migration':result=await this.migration(projectId,jobId,attemptId);break;
        case 'deployment.start':result=await this.start(projectId,jobId,attemptId);break;
        case 'deployment.stop':result=await this.stop(projectId,jobId,attemptId);break;
        case 'deployment.rollback':result=await this.rollback(projectId,jobId,attemptId);break;
        case 'checkpoint':result=await this.checkpoint(projectId,jobId,attemptId);break;
        case 'document.restore':result=await this.restore(projectId,jobId,attemptId);break;
        default:requireValue(false,'JOB_KIND','Unknown original native job kind.',409);
      }
      this.current(projectId,jobId,attemptId);
      this.finish(projectId,jobId,attemptId,'complete',result,null);
    }catch(error){
      if(error.code==='JOB_CANCELLED'&&['deployment.start','deployment.rollback'].includes(first?.kind)){
        try{await this.runtime.stop(projectId);}catch{}
      }
      this.finish(projectId,jobId,attemptId,error.code==='JOB_CANCELLED'?'interrupted':'failed',null,publicError(error));
    }
  }
  finish(projectId,jobId,attemptId,status,result,error){
    const receipt={schema:'tjlabs.tiptap-native-job-result.v1',projectId,jobId,attemptId,status,result,error};
    const body=Buffer.from(canonical(receipt)+'\n'),file=this.store.objects.put(body);
    this.store.internal(projectId,'finish:'+jobId+':'+attemptId,'job.finished',state=>{
      const job=state.jobs.find(j=>j.id===jobId);requireValue(job&&job.attemptId===attemptId,'JOB_ATTEMPT_CHANGED','The original job attempt changed before terminal adoption.',409);
      const endedAt=now();job.status=status;job.result=clone(result);job.error=clone(error);job.updatedAt=endedAt;
      const attempt=job.attempts.find(a=>a.id===attemptId);Object.assign(attempt,{status,result:clone(result),error:clone(error),completedAt:endedAt,receipt:file});
      job.files.push({id:'result-'+attemptId,filename:'native-result-'+attemptId+'.json',mediaType:'application/json',...file});
      if(job.kind==='migration'){const m=state.migrations.find(m=>m.id===job.payload.migrationId);m.status=status==='complete'?'imported':status;}
      if(status!=='complete'&&job.payload.deploymentId){
        const d=state.deployments.find(d=>d.id===job.payload.deploymentId);
        if(d){d.lastError=error;if(!this.runtime.has(projectId)){d.status=status;d.stoppedAt=endedAt;if(state.activeDeploymentId===d.id)state.activeDeploymentId=null;}}
      }
      return {jobId,attemptId,status,receipt:file};
    });
  }
  async migration(projectId,jobId,attemptId){
    const initial=this.current(projectId,jobId,attemptId),migration=initial.project.migrations.find(m=>m.id===initial.job.payload.migrationId);
    for(const row of migration.rows.filter(r=>r.decision==='import')){
      await yieldTurn();this.current(projectId,jobId,attemptId);
      this.store.internal(projectId,'import:'+jobId+':'+row.id,'migration.document-imported',state=>{
        const m=state.migrations.find(m=>m.id===migration.id),r=m.rows.find(r=>r.id===row.id),job=state.jobs.find(j=>j.id===jobId);
        requireValue(job.attemptId===attemptId&&job.status!=='cancelling','JOB_CANCELLED','The original import was cancelled.',409);
        if(r.targetDocumentId){const d=state.documents.find(d=>d.id===r.targetDocumentId);requireValue(d&&d.migrationId===m.id,'IMPORT_RECEIPT_CHANGED','The retained import target no longer matches its original row.',409);return {documentId:d.id,reconciled:true};}
        requireValue(!state.documents.some(d=>d.tenantId===r.tenantId&&d.logicalKey===r.documentName),'DOCUMENT_EXISTS','Another document now occupies this reviewed target; do not overwrite it.',409);
        const bytes=this.store.objects.read(r.prepared.sha256,r.prepared.bytes),vector=Buffer.from(r.prepared.stateVectorBase64,'base64');
        requireValue(sha(vector)===r.prepared.stateVectorSha256,'VECTOR_IDENTITY','The prepared original native state vector changed.',409);
        const documentId='document_'+identity({migrationId:m.id,rowId:r.id}).slice(0,32),epochId=uuid('epoch'),documentName=state.settings.namespace+'/'+r.tenantId+'/'+documentId+'/'+epochId,at=now();
        const persisted=this.store.writeNative({projectId,documentId,epochId,documentName,bytes,vector,allowInactive:true});
        const document={id:documentId,tenantId:r.tenantId,title:r.title,logicalKey:r.documentName,documentName,epochId,schemaId:r.schemaId,field:r.field,sourceId:m.sourceId,migrationId:m.id,createdAt:at,updatedAt:persisted.savedAt,persisted,previousEpochs:[]};
        state.documents.push(document);r.targetDocumentId=documentId;r.status='imported';job.progress.completed=m.rows.filter(v=>v.status==='imported').length;job.updatedAt=at;
        return {documentId,epochId,sourceSha256:m.sourceSha256,preparedSha256:r.prepared.sha256,persisted};
      });
    }
    const final=this.current(projectId,jobId,attemptId).project.migrations.find(m=>m.id===migration.id);
    return {migrationId:migration.id,documentIds:final.rows.filter(r=>r.targetDocumentId).map(r=>r.targetDocumentId),skipped:final.rows.filter(r=>r.decision==='skip').length};
  }
  async start(projectId,jobId,attemptId){
    const {project,job}=this.current(projectId,jobId,attemptId),deployment=project.deployments.find(d=>d.id===job.payload.deploymentId);
    const observed=await this.runtime.start(project,deployment);this.current(projectId,jobId,attemptId);
    this.store.internal(projectId,'deployment-start:'+jobId+':'+attemptId,'deployment.started',state=>{
      const d=state.deployments.find(d=>d.id===deployment.id);d.status='running';d.startedAt=observed.startedAt;d.stoppedAt=null;d.lastError=null;state.activeDeploymentId=d.id;return observed;
    });return observed;
  }
  async stop(projectId,jobId,attemptId){
    const {job}=this.current(projectId,jobId,attemptId),observed=await this.runtime.stop(projectId);
    this.current(projectId,jobId,attemptId);
    this.store.internal(projectId,'deployment-stop:'+jobId+':'+attemptId,'deployment.stopped',state=>{
      const d=state.deployments.find(d=>d.id===job.payload.deploymentId);d.status='stopped';d.stoppedAt=observed.stoppedAt;d.connections=[];if(state.activeDeploymentId===d.id)state.activeDeploymentId=null;return {deploymentId:d.id,...observed};
    });return {deploymentId:job.payload.deploymentId,...observed};
  }
  async rollback(projectId,jobId,attemptId){
    const {job}=this.current(projectId,jobId,attemptId);
    await this.runtime.stop(projectId);this.current(projectId,jobId,attemptId);
    const selected=this.store.internal(projectId,'rollback-select:'+jobId,'deployment.rollback-selected',state=>{
      const d=state.deployments.find(d=>d.id===job.payload.deploymentId);
      requireValue(d&&state.editions.some(e=>e.id===job.payload.targetEditionId),'ROLLBACK_TARGET_CHANGED','The original rollback deployment or target edition is no longer available.',409);
      const previousEditionId=d.editionId;d.previousEditions??=[];d.previousEditions.push({editionId:previousEditionId,changedAt:now(),reason:job.payload.reason});d.editionId=job.payload.targetEditionId;d.status='stopped';d.stoppedAt=now();if(state.activeDeploymentId===d.id)state.activeDeploymentId=null;
      return {deploymentId:d.id,editionId:d.editionId,previousEditionId,documentPolicy:'preserve_current'};
    }).result;
    const current=this.current(projectId,jobId,attemptId).project.deployments.find(d=>d.id===selected.deploymentId);
    requireValue(selected.deploymentId===job.payload.deploymentId&&selected.editionId===job.payload.targetEditionId&&current?.editionId===selected.editionId,'ROLLBACK_TARGET_CHANGED','The deployment advanced after the original rollback selection. Review its current edition before another native start.',409);
    return {...await this.start(projectId,jobId,attemptId),documentPolicy:selected.documentPolicy};
  }
  async checkpoint(projectId,jobId,attemptId){
    let {job}=this.current(projectId,jobId,attemptId),stop=null;
    if(job.payload.mode==='drain'){stop=await this.runtime.stop(projectId);this.current(projectId,jobId,attemptId);}
    const result=this.store.internal(projectId,'checkpoint:'+jobId,'checkpoint.retained',state=>{
      const current=state.jobs.find(j=>j.id===jobId);requireValue(current.status!=='cancelling','JOB_CANCELLED','The original checkpoint was cancelled.',409);
      const existing=state.checkpoints.find(c=>c.id===job.payload.checkpointId);if(existing)return {checkpointId:existing.id,sha256:existing.sha256};
      if(stop){for(const d of state.deployments)if(d.status==='running'||d.status==='stopping'){d.status='stopped';d.stoppedAt=stop.stoppedAt;d.connections=[];}state.activeDeploymentId=null;}
      this.store.refreshNative(state);
      const documents=state.documents.filter(d=>d.persisted).map(d=>({documentId:d.id,tenantId:d.tenantId,documentName:d.documentName,epochId:d.epochId,schemaId:d.schemaId,field:d.field,...clone(d.persisted)}));
      const files=documents.map(d=>({id:d.documentId+'-'+d.epochId,filename:d.documentId+'-'+d.epochId+'.yjs',mediaType:'application/octet-stream',sha256:d.sha256,bytes:d.bytes}));
      const checkpoint={id:job.payload.checkpointId,title:job.payload.title,editionId:state.deployments.find(d=>d.id===job.payload.deploymentId)?.editionId??state.currentEditionId,deploymentId:job.payload.deploymentId,createdAt:now(),source:job.payload.mode==='drain'?'drained':'persisted',documents,files};
      const descriptor=this.store.objects.put(Buffer.from(canonical(checkpoint)+'\n'));checkpoint.sha256=descriptor.sha256;checkpoint.descriptor=descriptor;state.checkpoints.push(checkpoint);return {checkpointId:checkpoint.id,documents:documents.length,sha256:checkpoint.sha256};
    });return result.result;
  }
  async restore(projectId,jobId,attemptId){
    const initial=this.current(projectId,jobId,attemptId),payload=initial.job.payload;
    const stopped=await this.runtime.stop(projectId);this.current(projectId,jobId,attemptId);
    for(const plan of payload.plan){
      await yieldTurn();this.current(projectId,jobId,attemptId);
      this.store.internal(projectId,'restore:'+jobId+':'+plan.documentId,'document.epoch-restored',state=>{
        const job=state.jobs.find(j=>j.id===jobId);requireValue(job.status!=='cancelling','JOB_CANCELLED','The original restore was cancelled.',409);
        const document=state.documents.find(d=>d.id===plan.documentId),checkpoint=state.checkpoints.find(c=>c.id===payload.checkpointId),saved=checkpoint.documents.find(d=>d.documentId===document.id);
        if(document.epochId===plan.newEpochId)return {documentId:document.id,epochId:document.epochId,reconciled:true};
        requireValue(document.epochId===plan.expectedEpochId,'RESTORE_TARGET_CHANGED','The original restore target advanced to another epoch; review that current document.',409);
        const bytes=this.store.objects.read(saved.sha256,saved.bytes),vector=Buffer.from(saved.stateVectorBase64,'base64');
        requireValue(sha(vector)===saved.stateVectorSha256,'VECTOR_IDENTITY','The retained checkpoint vector changed.',409);
        document.previousEpochs.push({epochId:document.epochId,documentName:document.documentName,persisted:clone(document.persisted),endedAt:now(),restoreJobId:jobId});
        const documentName=state.settings.namespace+'/'+document.tenantId+'/'+document.id+'/'+plan.newEpochId;
        const persisted=this.store.writeNative({projectId,documentId:document.id,epochId:plan.newEpochId,documentName,bytes,vector,allowInactive:true});
        Object.assign(document,{epochId:plan.newEpochId,documentName,persisted,updatedAt:persisted.savedAt});
        for(const d of state.deployments)if(d.status==='running'||d.status==='stopping'){d.status='stopped';d.stoppedAt=stopped.stoppedAt;d.connections=[];}state.activeDeploymentId=null;
        job.progress.completed=payload.plan.filter(p=>state.documents.find(d=>d.id===p.documentId)?.epochId===p.newEpochId).length;
        return {documentId:document.id,epochId:document.epochId,checkpointId:checkpoint.id,persisted};
      });
    }
    return {checkpointId:payload.checkpointId,documentIds:payload.plan.map(p=>p.documentId),epochIds:payload.plan.map(p=>p.newEpochId),deploymentState:'stopped'};
  }
  async drain(){this.closing=true;await Promise.allSettled([...this.running.values()]);}
}
