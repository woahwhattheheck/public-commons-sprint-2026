import { readFileSync,existsSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { Workspace as OriginalWorkspace } from '../vendor/sling/core/workspace.mjs';
import { Archives } from '../vendor/sling/core/archive.mjs';
import { acquireWorkspaceLease,privateDirectory } from '../vendor/sling/vendor/stellar-expert/store.mjs';
import { requireOperator,permissions } from '../vendor/sling/core/auth.mjs';
import { canonical,clone,identity,now,id,text,object,oneOf,requireValue,atomicJson } from '../vendor/sling/core/common.mjs';
import { compileAcceptance,comparisonPlan,compareAcceptance,exportSql,identifier,relation } from './plan.mjs';
import { prepareMerchantSource } from './merchant.mjs';
import { ClickHouseRuntime } from './runtime.mjs';
const CUSTOM=new Set(['plan.compile','runtime.select','run.prepare','comparison.create','cutover.apply','merchant.derive']);
const UNSUPPORTED=new Set(['source.load','downstream.plan','downstream.apply','downstream.restore','downstream.resume']);
const field=(rows,value,name)=>{const row=rows.find(r=>r.id===value);requireValue(row,name+'_NOT_FOUND','The retained '+name.toLowerCase()+' is unavailable.',404);return row;};
class AcceptanceArchives extends Archives {
  async inspect(path,options){
    const packet=await super.inspect(path,options);
    for(const row of packet.versions){
      const state=JSON.parse(row.state_json);
      for(const plan of state.plans)requireValue(plan.product==='altinity.acceptance.v1','HANDOFF_PRODUCT','Receive an original Altinity acceptance workspace here.',409);
      for(const job of state.jobs)requireValue(job.kind==='clickhouse_acceptance','HANDOFF_PRODUCT','This original native job belongs to another product.',409);
    }
    return packet;
  }
}
export class Workspace extends OriginalWorkspace {
  static async open({directory,sourceRoot,python='python3',sourceFiles}){
    const root=await privateDirectory(resolve(directory),{create:true}),lease=await acquireWorkspaceLease(join(root,'workspace.lock'));
    try{return new Workspace(root,{sourceRoot:resolve(sourceRoot),python,sourceFiles,lease});}catch(error){await lease.close();throw error;}
  }
  constructor(directory,options){
    super(directory,{...options,runtimeReadyFile:undefined,consumerRoot:undefined});
    this.runtime=new ClickHouseRuntime(this,options);this.archives=new AcceptanceArchives(this);
  }
  materializeConsumer(state){
    const selected=this.consumerSelection(state);if(!selected)return;
    this.store.objects.verify(selected.snapshot.sha256,selected.snapshot.bytes);
    const binding=JSON.parse(this.store.objects.read(selected.snapshot.sha256,selected.snapshot.bytes));
    requireValue(binding.schema==='altinity.consumer-binding.v1','CONSUMER_BINDING','The original consumer binding is another format.',409);
    atomicJson(join(this.directory,'consumer',state.id,'current.json'),selected);
  }
  consumer(actor,projectId,{streamId,offset=0,limit=100}={}){
    requireValue(permissions(actor).read,'READ_REQUIRED','Read permission is required.',403);
    requireValue(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=1000,'PAGE','Select a bounded retained-result page.');
    const state=this.store.get(projectId),selection=this.consumerSelection(state);
    requireValue(selection,'CONSUMER_UNBOUND','Select a reviewed native consumer binding first.',409);
    const binding=JSON.parse(this.store.objects.read(selection.snapshot.sha256,selection.snapshot.bytes));
    const stream=binding.tables.find(t=>t.streamId===(streamId??binding.tables[0]?.streamId));
    requireValue(stream,'STREAM_NOT_FOUND','Select a retained original consumer table.',404);
    const job=field(state.jobs,binding.jobId,'JOB'),file=job.files.find(f=>f.path==='artifacts/observations.json');
    requireValue(file,'OBSERVATIONS_MISSING','The selected native full export is unavailable.',409);
    const observed=JSON.parse(this.store.objects.read(file.sha256,file.bytes)),row=observed.streams.find(s=>s.streamId===stream.streamId),side=binding.side==='source'?row.left:row.right;
    return{schema:'altinity.consumer-review.v1',mode:'retained-native-export',liveQuery:false,selection,binding,table:stream,columns:side.columns,rows:side.rows.slice(offset,offset+limit),rowCount:side.rows.length,offset,limit,source:side.source};
  }
  async dispatch(actor,input){
    requireOperator(actor);object(input,'request');id(input.projectId,'projectId');id(input.requestId,'requestId');
    requireValue(!UNSUPPORTED.has(input.action),'ACTION_NOT_SELECTED','This ClickHouse application uses its native table workflow.',400);
    if(!CUSTOM.has(input.action))return super.dispatch(actor,input);
    object(input.payload??{},'payload');input={...input,payload:input.payload??{}};
    const previous=this.store.request(actor.id,input.requestId,input);
    if(previous){await this.serial(previous.view.id,()=>this.reconcile(previous.view.id));return this.result(previous);}
    return this.serial(input.projectId,async()=>{
      await this.reconcile(input.projectId);
      const replay=this.store.request(actor.id,input.requestId,input);if(replay)return this.result(replay);
      const state=this.store.get(input.projectId),p=input.payload;
      requireValue(input.expectedRevision===state.revision,'REVISION_CONFLICT','The original project advanced before this action.',409,{currentRevision:state.revision});
      let output;
      if(input.action==='plan.compile'){
        text(p.title,'title',{min:1,max:300});const source=field(state.sources,p.sourceId,'SOURCE');
        requireValue(source.bytes<=32*1024*1024,'PLAN_SIZE','Retain a complete configuration up to 32 MiB.',413);
        const doc=JSON.parse(this.store.objects.read(source.sha256,source.bytes)),plan=compileAcceptance(doc),compiled=this.store.objects.put(Buffer.from(canonical(plan)+'\n'));
        const config=this.store.objects.put(Buffer.from(canonical({schema:'altinity.native-commands.v1',planId:plan.planId,tables:plan.tables.map(t=>({id:t.id,create:t.createSql}))})+'\n'));
        output=this.store.commit(actor,input,s=>{
          const row={id:'plan_'+identity({sourceId:source.id,planId:plan.planId,requestId:input.requestId}).slice(0,32),product:'altinity.acceptance.v1',semanticPlanId:plan.planId,title:p.title,sourceId:source.id,sourceSha256:source.sha256,compiled,replication:config,status:'draft',ready:plan.ready,issues:plan.issues,review:{issues:plan.issues},createdAt:now(),tables:plan.tables,selectedStreams:plan.tables.map(t=>({id:t.id,name:t.source[1],namespace:t.source[0],sourceRelation:t.source,parallelRelation:t.target,mode:t.engine,primaryKey:t.primaryKey,businessColumns:t.columns.map(c=>c.name),ready:plan.ready}))};
          s.plans.push(row);s.currentPlanId=row.id;return{planId:row.id,semanticPlanId:plan.planId,ready:plan.ready};
        });
      }else if(input.action==='runtime.select'){
        const runtime=this.runtime.retainSelection();output=this.store.commit(actor,input,s=>{s.runtime=runtime;return{adapter:runtime.adapter,workerSha256:runtime.worker.sha256,engineObserved:false};});
      }else if(input.action==='run.prepare'){
        await this.assertIdle(state.id);const {selected,plan}=this.planObject(state,p.planId);
        requireValue(selected.status==='approved'&&selected.id===state.currentPlanId&&plan.ready,'PLAN_REVIEW_REQUIRED','Approve the current exact native plan.',409);
        oneOf(p.mode,['transfer','verify'],'mode');
        if(p.mode==='transfer')requireValue(!state.jobs.some(j=>j.semanticPlanId===plan.planId&&j.mode==='transfer'),'ORIGINAL_TRANSFER_EXISTS','Continue the original transfer job; a different target requires a new retained plan.',409);
        const runtime=this.runtime.retainSelection(),jobId='job_'+identity({actorId:actor.id,requestId:input.requestId}).slice(0,32),comparison=comparisonPlan(plan);
        const tables=plan.tables.map(spec=>{
          const leftColumns=spec.columns.map(c=>({name:c.left??c.name,type:c.type})),rightColumns=spec.columns.map(c=>({name:c.right??c.name,type:c.type}));
          return{spec,leftColumns,rightColumns,sourceExport:exportSql(spec.source,{columns:leftColumns,final:spec.sourceFinal,maxRows:spec.maxRows}),targetExport:exportSql(spec.target,{columns:rightColumns,final:spec.final,maxRows:spec.maxRows}),
            rowBinarySql:'SELECT '+leftColumns.map(c=>identifier(c.name)).join(', ')+' FROM '+relation(spec.source)+(spec.sourceFinal?' FINAL':'')+' LIMIT '+(spec.maxRows+1)+' FORMAT RowBinary',
            insertSql:'INSERT INTO '+relation(spec.target)+' ('+rightColumns.map(c=>identifier(c.name)).join(', ')+') FORMAT RowBinary'};
        });
        const selection={schema:'altinity.native-selection.v1',projectId:state.id,jobId,planId:plan.planId,planEditionId:selected.id,comparisonPlanId:comparison.planId,phase:plan.tables[0].phase,mode:p.mode,plan,tables,inputs:[],runtime};
        const descriptor=this.store.objects.put(Buffer.from(canonical(selection)+'\n'));
        output=this.store.commit(actor,input,s=>{s.runtime=runtime;s.jobs.push({id:jobId,projectId:s.id,kind:'clickhouse_acceptance',mode:p.mode,phase:selection.phase,planId:selected.id,semanticPlanId:plan.planId,runtime,selection:descriptor,replication:selected.replication,status:'prepared',controls:[],files:[],createdAt:now()});return{jobId,status:'prepared',mode:p.mode};});
      }else if(input.action==='comparison.create'){
        const job=field(state.jobs,p.jobId,'JOB');requireValue(job.status==='complete','NATIVE_RESULT_REQUIRED','Close the original native operation before full comparison.',409);
        const {selected,plan}=this.planObject(state,job.planId),observations=job.files.find(f=>f.path==='artifacts/observations.json');
        requireValue(observations,'OBSERVATIONS_MISSING','The complete native exports are required.',409);
        const value=JSON.parse(this.store.objects.read(observations.sha256,observations.bytes)),report=compareAcceptance(plan,value),descriptor=this.store.objects.put(Buffer.from(canonical(report)+'\n'));
        output=this.store.commit(actor,input,s=>{
          const row={id:'comparison_'+identity({jobId:job.id,reportSha256:descriptor.sha256}).slice(0,32),planId:selected.id,semanticPlanId:plan.planId,jobId:job.id,observations,report:descriptor,equal:report.equal,readyForCutover:report.readyForCutover,comparisonId:report.reportId,errors:report.errors,createdAt:now()};
          if(!s.comparisons.some(r=>r.id===row.id))s.comparisons.push(row);return{comparisonId:row.id,semanticComparisonId:report.reportId,equal:report.equal,readyForCutover:report.readyForCutover};
        });
      }else if(input.action==='merchant.derive'){
        text(p.title,'title',{min:1,max:300});const source=field(state.sources,p.sourceId,'SOURCE'),selection=this.consumerSelection(state);
        requireValue(selection,'CONSUMER_UNBOUND','Select the current reviewed consumer binding before deriving its original read source.',409);
        requireValue(source.bytes<=32*1024*1024,'SOURCE_SIZE','Select the retained complete merchant source up to 32 MiB.',413);
        const original=JSON.parse(this.store.objects.read(source.sha256,source.bytes)),binding=JSON.parse(this.store.objects.read(selection.snapshot.sha256,selection.snapshot.bytes));
        const change=prepareMerchantSource(original,binding,p.edits),derived=this.store.objects.put(Buffer.from(canonical(change.derivedSource)+'\n')),record=this.store.objects.put(Buffer.from(canonical(change)+'\n'));
        output=this.store.commit(actor,input,s=>{
          const add=(descriptor,role,filename,title)=>{
            const row={id:'source_'+identity({sha256:descriptor.sha256,role,url:''}).slice(0,32),...descriptor,filename,mediaType:'application/json',title,role,url:'',notes:'Original source '+source.id+'; consumer '+selection.id+'; explicit source change '+change.changeId+'. Native review and activation remain with the retained original ClickHouse read operator.',capturedAt:now(),retainedAt:now()};
            if(!s.sources.some(r=>r.id===row.id))s.sources.push(row);return row.id;
          };
          return{derivedSourceId:add(derived,'merchant-derived','clickhouse-derived-source.json',p.title),changeSourceId:add(record,'merchant-change','clickhouse-source-change.json',p.title+' — complete original and derived source'),changeId:change.changeId,nativeReviewRequired:true};
        });
      }else if(input.action==='cutover.apply'){
        await this.assertIdle(state.id);text(p.reason,'reason',{min:1,max:20000});
        const comparison=field(state.comparisons,p.comparisonId,'COMPARISON'),job=field(state.jobs,comparison.jobId,'JOB'),{selected,plan}=this.planObject(state,comparison.planId);
        const report=JSON.parse(this.store.objects.read(comparison.report.sha256,comparison.report.bytes));
        requireValue(report.readyForCutover&&report.planId===plan.planId&&selected.id===state.currentPlanId&&selected.status==='approved','CUTOVER_NOT_READY','Select a full equal comparison for the current approved plan.',409,{errors:report.errors});
        requireValue(job.mode==='verify'&&job.status==='complete'&&state.jobs.filter(j=>j.planId===selected.id).at(-1)?.id===job.id,'FRESH_VERIFICATION_REQUIRED','Complete an explicit verification of the existing table pair after transfer, then select its comparison.',409);
        const observations=JSON.parse(this.store.objects.read(comparison.observations.sha256,comparison.observations.bytes));
        const makeBinding=side=>{
          const body={schema:'altinity.consumer-binding.v1',side,jobId:job.id,planId:plan.planId,comparisonId:comparison.id,connection:clone(plan[side]),tables:observations.identities.map(t=>({streamId:t.streamId,relation:t[side].table,uuid:t[side].uuid,engine:t[side].engine,columns:t[side].columns})),sourceBoundary:plan.tables.map(t=>({streamId:t.id,boundary:t.sourceBoundary})),observedAt:job.nativeState.updatedAt,selectionScope:'This retained consumer declaration; external consumers change only through their existing authorized configuration.'};
          return{id:'selection_'+identity(body).slice(0,32),kind:side,jobId:job.id,planId:selected.id,comparisonId:comparison.id,snapshot:this.store.objects.put(Buffer.from(canonical(body)+'\n')),tables:body.tables};
        };
        const next=makeBinding('target'),previous=this.consumerSelection(state)??makeBinding('source');
        output=this.store.commit(actor,input,s=>{const row={id:'cutover_'+identity({actorId:actor.id,requestId:input.requestId}).slice(0,32),kind:'cutover',selection:next,previous:clone(previous),reason:p.reason,actorId:actor.id,createdAt:now()};s.cutovers.push(row);s.currentCutoverId=row.id;return{cutoverId:row.id,selection:next};});
        this.materializeConsumer(this.store.get(state.id));
      }
      requireValue(output,'ACTION_NOT_IMPLEMENTED','Unknown commissioning action.',400);return this.result(output);
    });
  }
}
export const openWorkspace=options=>Workspace.open(options);
