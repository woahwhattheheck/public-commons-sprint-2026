import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Workspace as OriginalWorkspace} from '../vendor/sling/core/workspace.mjs';
import {Archives} from '../vendor/sling/core/archive.mjs';
import {acquireWorkspaceLease,privateDirectory} from '../vendor/sling/vendor/stellar-expert/store.mjs';
import {requireOperator,permissions} from '../vendor/sling/core/auth.mjs';
import {canonical,clone,identity,now,id,text,object,oneOf,requireValue,atomicJson} from '../vendor/sling/core/common.mjs';
import {compilePipeline,comparisonPlan,comparePipeline,reviewAirbyte} from './plan.mjs';
import {DltRuntime} from './runtime.mjs';
const CUSTOM=new Set(['plan.compile','runtime.select','run.prepare','comparison.create','cutover.apply','airbyte.review']);
const UNSUPPORTED=new Set(['source.load','downstream.plan','downstream.apply','downstream.restore','downstream.resume']);
const field=(rows,value,name)=>{const row=rows.find(r=>r.id===value);requireValue(row,name+'_NOT_FOUND','Select a retained '+name.toLowerCase()+'.',404);return row;};
class PipelineArchives extends Archives{
  async inspect(path,options){
    const packet=await super.inspect(path,options);
    for(const version of packet.versions){const state=JSON.parse(version.state_json);
      for(const plan of state.plans)requireValue(plan.product==='dlthub.pipeline.v1','HANDOFF_PRODUCT','Receive the original dlt pipeline workspace.',409);
      for(const job of state.jobs)requireValue(job.kind==='dlt_pipeline','HANDOFF_PRODUCT','This native job belongs to another application.',409);
    }return packet;
  }
}
export class Workspace extends OriginalWorkspace{
  static async open({directory,sourceRoot,runtimeReadyFile,python='python3',sourceFiles}){
    const root=await privateDirectory(resolve(directory),{create:true}),lease=await acquireWorkspaceLease(join(root,'workspace.lock'));
    try{return new Workspace(root,{sourceRoot:resolve(sourceRoot),runtimeReadyFile,python,sourceFiles,lease});}catch(error){await lease.close();throw error;}
  }
  constructor(directory,options){
    super(directory,{...options,runtimeReadyFile:undefined,consumerRoot:undefined});
    this.runtime=new DltRuntime(this,options);this.archives=new PipelineArchives(this);
  }
  materializeConsumer(state){
    const selected=this.consumerSelection(state);if(!selected)return;
    this.store.objects.verify(selected.snapshot.sha256,selected.snapshot.bytes);
    const binding=JSON.parse(this.store.objects.read(selected.snapshot.sha256,selected.snapshot.bytes));
    requireValue(binding.schema==='dlthub.consumer-binding.v1','CONSUMER_BINDING','This selected binding belongs to another product.',409);
    atomicJson(join(this.directory,'consumer',state.id,'current.json'),selected);
  }
  consumer(actor,projectId,{streamId,offset=0,limit=100}={}){
    requireValue(permissions(actor).read,'READ_REQUIRED','Read permission is required.',403);
    requireValue(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=1000,'PAGE','Select a bounded native export page.');
    const state=this.store.get(projectId),selection=this.consumerSelection(state);requireValue(selection,'CONSUMER_UNBOUND','Select a reviewed complete native result.',409);
    const binding=JSON.parse(this.store.objects.read(selection.snapshot.sha256,selection.snapshot.bytes)),job=field(state.jobs,binding.jobId,'JOB');
    const original=job.files.find(x=>x.path==='artifacts/observations.json');requireValue(original,'OBSERVATIONS_MISSING','The selected complete native observations are absent.',409);
    const observed=JSON.parse(this.store.objects.read(original.sha256,original.bytes)),stream=observed.streams.find(x=>x.streamId===(streamId??observed.streams[0]?.streamId));requireValue(stream,'STREAM_NOT_FOUND','Select a retained table.',404);
    const side=binding.side==='expected'?stream.left:stream.right;
    return{schema:'dlthub.consumer-review.v1',mode:'retained-complete-native-export',liveQuery:false,selection,binding,streamId:stream.streamId,columns:side.columns,rows:side.rows.slice(offset,offset+limit),rowCount:side.rows.length,offset,limit,source:side.source};
  }
  async dispatch(actor,input){
    requireOperator(actor);object(input,'request');id(input.projectId,'projectId');id(input.requestId,'requestId');
    requireValue(!UNSUPPORTED.has(input.action),'ACTION_NOT_SELECTED','Use this application’s original dlt stages and retained consumer bindings.',400);
    if(!CUSTOM.has(input.action))return super.dispatch(actor,input);
    object(input.payload??{},'payload');input={...input,payload:input.payload??{}};
    const prior=this.store.request(actor.id,input.requestId,input);
    if(prior){await this.serial(prior.view.id,()=>this.reconcile(prior.view.id));return this.result(prior);}
    return this.serial(input.projectId,async()=>{
      await this.reconcile(input.projectId);const replay=this.store.request(actor.id,input.requestId,input);if(replay)return this.result(replay);
      const state=this.store.get(input.projectId),p=input.payload;
      requireValue(input.expectedRevision===state.revision,'REVISION_CONFLICT','The retained project advanced before this action.',409,{currentRevision:state.revision});
      let output;
      if(input.action==='airbyte.review'){
        const source=field(state.sources,p.sourceId,'SOURCE');requireValue(source.bytes<=32*1024*1024,'SOURCE_SIZE','Select complete configuration up to 32 MiB.',413);
        const document=JSON.parse(this.store.objects.read(source.sha256,source.bytes)),review=reviewAirbyte(document,p.options??{}),descriptor=this.store.objects.put(Buffer.from(canonical(review)+'\n'));
        output=this.store.commit(actor,input,s=>{const row={id:'source_'+identity({sha256:descriptor.sha256,role:'airbyte-review'}).slice(0,32),...descriptor,filename:'airbyte-native-review.json',mediaType:'application/json',title:p.title??'Original Airbyte configuration review',role:'airbyte-review',url:'',notes:'Original source '+source.id+'. Bind an explicit dlt input before native loading.',capturedAt:now(),retainedAt:now()};if(!s.sources.some(x=>x.id===row.id))s.sources.push(row);return{sourceId:row.id,intakeId:review.intakeId,ready:false};});
      }else if(input.action==='plan.compile'){
        text(p.title,'title',{min:1,max:300});const source=field(state.sources,p.sourceId,'SOURCE');requireValue(source.bytes<=32*1024*1024,'PLAN_SIZE','Select a complete pipeline input up to 32 MiB.',413);
        const plan=compilePipeline(JSON.parse(this.store.objects.read(source.sha256,source.bytes)));
        for(const sourceId of [...plan.resources.map(r=>r.sourceId),...plan.acceptance.map(t=>t.expectedSourceId)])field(state.sources,sourceId,'SOURCE');
        const compiled=this.store.objects.put(Buffer.from(canonical(plan)+'\n')),replication=this.store.objects.put(Buffer.from(canonical({schema:'dlthub.native-resources.v1',planId:plan.planId,pipelineName:plan.pipelineName,datasetName:plan.datasetName,resources:plan.resources})+'\n'));
        output=this.store.commit(actor,input,s=>{const row={id:'plan_'+identity({requestId:input.requestId,planId:plan.planId}).slice(0,32),product:'dlthub.pipeline.v1',semanticPlanId:plan.planId,title:p.title,sourceId:source.id,sourceSha256:source.sha256,compiled,replication,status:'draft',ready:plan.ready,issues:plan.issues,review:{issues:plan.issues},createdAt:now(),
          pipelineName:plan.pipelineName,datasetName:plan.datasetName,resources:plan.resources,acceptance:plan.acceptance,selectedStreams:plan.acceptance.map(t=>({id:t.id,name:t.table,namespace:plan.datasetName,mode:'native dlt',businessColumns:t.columns.map(c=>c.name),primaryKey:t.primaryKey,ready:plan.ready}))};
          s.plans.push(row);s.currentPlanId=row.id;return{planId:row.id,semanticPlanId:plan.planId,ready:plan.ready};});
      }else if(input.action==='runtime.select'){
        const runtime=this.runtime.retainSelection();output=this.store.commit(actor,input,s=>{s.runtime=runtime;return{runtimeId:runtime.runtimeId,version:runtime.version};});
      }else if(input.action==='run.prepare'){
        await this.assertIdle(state.id);const {selected,plan}=this.planObject(state,p.planId);
        requireValue(selected.status==='approved'&&selected.id===state.currentPlanId&&plan.ready,'PLAN_REVIEW_REQUIRED','Approve the exact current native pipeline input.',409);
        oneOf(p.stage,['extract','normalize','load','run','inspect','verify','retry_failed','abort'],'stage');
        const parent=p.parentJobId?field(state.jobs,p.parentJobId,'JOB'):null;
        if(parent){
          requireValue(['complete','failed','interrupted','cancelled','awaiting_reconciliation'].includes(parent.status)&&parent.files.length,'PARENT_OPEN','Select the original closed complete native custody before continuing its pipeline.',409);
          const oldPlan=this.planObject(state,parent.planId).plan;requireValue(oldPlan.pipelineName===plan.pipelineName&&oldPlan.datasetName===plan.datasetName,'PIPELINE_IDENTITY','Continuation must retain original pipeline/dataset identity.',409);
          const latest=state.jobs.filter(j=>this.planObject(state,j.planId).plan.pipelineName===plan.pipelineName).at(-1);
          if(latest&&latest.id!==parent.id)text(p.forkReason,'forkReason',{min:1,max:5000});
        }else requireValue(!state.jobs.some(j=>this.planObject(state,j.planId).plan.pipelineName===plan.pipelineName),'PIPELINE_PARENT_REQUIRED','Continue the original pipeline from its retained closed job; do not silently create a replacement.',409);
        if(['normalize','load','verify','retry_failed','abort'].includes(p.stage))requireValue(parent,'PARENT_REQUIRED','This native stage requires its retained original pipeline.',409);
        const options=clone(p.options??{});
        if(['retry_failed','abort'].includes(p.stage)){text(p.reason,'reason',{min:1,max:5000});if(options.loadId!==undefined)text(options.loadId,'loadId',{min:1,max:200});}
        if(p.stage==='retry_failed'){text(options.loadId,'loadId',{min:1,max:200});text(options.jobFileName,'jobFileName',{min:1,max:1000});requireValue(!/[\/\\]/.test(options.jobFileName),'JOB_FILE','Select the exact native job filename.');}
        const runtime=this.runtime.retainSelection(),jobId='job_'+identity({actorId:actor.id,requestId:input.requestId}).slice(0,32),comparison=comparisonPlan(plan);
        const sourceIds=[...new Set([...plan.resources.map(r=>r.sourceId),...plan.acceptance.map(t=>t.expectedSourceId)])];
        const inputs=sourceIds.map(sourceId=>{const source=field(state.sources,sourceId,'SOURCE');requireValue(source.bytes<=plan.limits.maxBytes,'SOURCE_LIMIT','A selected complete source exceeds the reviewed limit.',413);return{sourceId,path:'inputs/'+sourceId,sha256:source.sha256,bytes:source.bytes};});
        for(const file of parent?.files??[])if(file.path.startsWith('data/'))inputs.push({path:file.path,sha256:file.sha256,bytes:file.bytes,parentJobId:parent.id});
        const selection={schema:'dlthub.native-selection.v1',projectId:state.id,jobId,planId:plan.planId,planEditionId:selected.id,comparisonPlanId:comparison.planId,phase:plan.phase,stage:p.stage,options,reason:p.reason??null,parentJobId:parent?.id??null,parentSnapshot:parent?.nativeSnapshotSha256??null,forkReason:p.forkReason??null,plan,inputs,runtime};
        const descriptor=this.store.objects.put(Buffer.from(canonical(selection)+'\n'));
        output=this.store.commit(actor,input,s=>{s.runtime=runtime;s.jobs.push({id:jobId,projectId:s.id,kind:'dlt_pipeline',stage:p.stage,mode:p.stage,phase:plan.phase,planId:selected.id,semanticPlanId:plan.planId,parentJobId:parent?.id??null,runtime,selection:descriptor,replication:selected.replication,status:'prepared',controls:[],files:[],createdAt:now()});return{jobId,status:'prepared',stage:p.stage,parentJobId:parent?.id??null};});
      }else if(input.action==='comparison.create'){
        const job=field(state.jobs,p.jobId,'JOB');requireValue(job.status==='complete','NATIVE_RESULT_REQUIRED','Close the original native export before full comparison.',409);
        const {selected,plan}=this.planObject(state,job.planId),observations=job.files.find(x=>x.path==='artifacts/observations.json');requireValue(observations,'OBSERVATIONS_MISSING','Complete native and independent expected exports are required.',409);
        const report=comparePipeline(plan,JSON.parse(this.store.objects.read(observations.sha256,observations.bytes))),descriptor=this.store.objects.put(Buffer.from(canonical(report)+'\n'));
        output=this.store.commit(actor,input,s=>{const row={id:'comparison_'+identity({jobId:job.id,sha256:descriptor.sha256}).slice(0,32),planId:selected.id,semanticPlanId:plan.planId,jobId:job.id,observations,report:descriptor,equal:report.equal,readyForCutover:report.readyForCutover,comparisonId:report.reportId,errors:report.errors,createdAt:now()};if(!s.comparisons.some(c=>c.id===row.id))s.comparisons.push(row);return{comparisonId:row.id,semanticComparisonId:report.reportId,equal:report.equal,readyForCutover:report.readyForCutover};});
      }else if(input.action==='cutover.apply'){
        await this.assertIdle(state.id);text(p.reason,'reason',{min:1,max:20000});
        const comparison=field(state.comparisons,p.comparisonId,'COMPARISON'),job=field(state.jobs,comparison.jobId,'JOB'),{selected,plan}=this.planObject(state,comparison.planId),report=JSON.parse(this.store.objects.read(comparison.report.sha256,comparison.report.bytes));
        requireValue(report.readyForCutover&&report.planId===plan.planId&&selected.status==='approved'&&selected.id===state.currentPlanId,'CUTOVER_NOT_READY','Select complete equal typed parity for the approved current pipeline.',409,{errors:report.errors});
        requireValue(job.stage==='verify'&&job.status==='complete'&&state.jobs.filter(j=>j.planId===selected.id).at(-1)?.id===job.id,'FRESH_VERIFICATION_REQUIRED','Complete an explicit current native verification and select that exact comparison.',409);
        const database=job.files.find(x=>x.path==='data/target.duckdb');requireValue(database,'DATABASE_MISSING','The complete closed native DuckDB database is required.',409);
        const make=side=>{const body={schema:'dlthub.consumer-binding.v1',side,jobId:job.id,planId:plan.planId,comparisonId:comparison.id,pipelineName:plan.pipelineName,datasetName:plan.datasetName,database,observations:comparison.observations,tables:plan.acceptance.map(t=>({streamId:t.id,relation:[plan.datasetName,t.table]})),selectedAt:job.nativeState.updatedAt,scope:'This retained consumer binding; outside application consumers are changed by their existing owner.'};return{id:'selection_'+identity(body).slice(0,32),kind:side,jobId:job.id,planId:selected.id,comparisonId:comparison.id,snapshot:this.store.objects.put(Buffer.from(canonical(body)+'\n')),tables:body.tables};};
        const next=make('target'),previous=this.consumerSelection(state)??make('expected');
        output=this.store.commit(actor,input,s=>{const row={id:'cutover_'+identity({actorId:actor.id,requestId:input.requestId}).slice(0,32),kind:'cutover',selection:next,previous:clone(previous),reason:p.reason,actorId:actor.id,createdAt:now()};s.cutovers.push(row);s.currentCutoverId=row.id;return{cutoverId:row.id,selection:next};});this.materializeConsumer(this.store.get(state.id));
      }
      requireValue(output,'ACTION_NOT_IMPLEMENTED','Unknown original pipeline action.',400);return this.result(output);
    });
  }
}
export const openWorkspace=options=>Workspace.open(options);
