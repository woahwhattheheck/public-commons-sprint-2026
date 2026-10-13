// SPDX-License-Identifier: MIT
import {join,resolve} from 'node:path';
import {Workspace as PipelineWorkspace} from '../vendor/dlt/pipeline/workspace.mjs';
import {Archives} from '../vendor/dlt/vendor/sling/core/archive.mjs';
import {acquireWorkspaceLease,privateDirectory} from '../vendor/dlt/vendor/sling/vendor/stellar-expert/store.mjs';
import {requireOperator,permissions} from '../vendor/dlt/vendor/sling/core/auth.mjs';
import {canonical,clone,identity,now,id,text,object,array,requireValue} from '../vendor/dlt/vendor/sling/core/common.mjs';
import {compileAcceptance,evaluateAcceptance,decideAcceptance} from '../acceptance/index.mjs';

const ACTIONS=new Set(['acceptance.compile','acceptance.select','acceptance.evaluate','acceptance.decide','cutover.apply']);
const row=(rows,value,label)=>{const selected=(rows??[]).find(item=>item.id===value);requireValue(selected,label+'_NOT_FOUND','Select a retained '+label.toLowerCase()+'.',404);return selected;};
function load(store,descriptor){return JSON.parse(store.objects.read(descriptor.sha256,descriptor.bytes));}
function retainedSource(state,descriptor,title,role){
  const source={id:'source_'+identity({sha256:descriptor.sha256,role}).slice(0,32),...descriptor,
    filename:role+'-'+descriptor.sha256.slice(0,16)+'.json',mediaType:'application/json',title,role,url:'',notes:'Complete original measured or reviewed acceptance edition.',capturedAt:now(),retainedAt:now()};
  if(!state.sources.some(item=>item.id===source.id))state.sources.push(source);return source.id;
}
function ensure(state){state.acceptancePlans??=[];state.acceptanceReports??=[];state.acceptanceDecisions??=[];state.product='definian.migration-acceptance.v1';}
function same(a,b,code,message){requireValue(canonical(a)===canonical(b),code,message,409);}
function checkSources(state,sourceId,descriptor){const selected=row(state.sources,sourceId,'SOURCE');requireValue(selected.sha256===descriptor.sha256&&selected.bytes===descriptor.bytes,'ACCEPTANCE_SOURCE_BINDING','The complete acceptance edition must be retained as its original source.',409);}
function checkState(state,store,cache=new Map()){
  const checked=(descriptor,make)=>{const key=descriptor.sha256+':'+descriptor.bytes;if(cache.has(key))return cache.get(key);const value=load(store,descriptor);make(value);cache.set(key,value);return value;};
  for(const plan of state.acceptancePlans??[]){
    const pipeline=row(state.plans,plan.planId,'PLAN'),native=load(store,pipeline.compiled);
    const compiled=checked(plan.compiled,value=>same(compileAcceptance(value.input),value,'ACCEPTANCE_PLAN_CHANGED','The received acceptance plan must reproduce from its complete input.'));
    requireValue(compiled.pipelinePlanId===native.planId&&plan.semanticPlanId===native.planId&&compiled.planId===plan.acceptancePlanId,'ACCEPTANCE_PLAN_BINDING','The acceptance plan must bind its original retained pipeline.',409);
    same(compiled.input.pipelinePlan,native,'ACCEPTANCE_PLAN_BINDING','The complete native pipeline differs from the measured selection.');checkSources(state,plan.compiledSourceId,plan.compiled);
  }
  for(const report of state.acceptanceReports??[]){
    const plan=row(state.acceptancePlans,report.acceptancePlanId,'ACCEPTANCE_PLAN'),selected=load(store,plan.compiled),comparison=row(state.comparisons,report.comparisonId,'COMPARISON');
    const measured=checked(report.report,value=>same(evaluateAcceptance(value.plan,value.observations,{parity:value.parity}),value,'ACCEPTANCE_REPORT_CHANGED','The received measured report must reproduce from its original complete inputs.'));
    requireValue(report.planId===plan.planId&&comparison.planId===plan.planId&&comparison.jobId===report.jobId&&measured.reportId===report.reportId,'ACCEPTANCE_REPORT_BINDING','The report must bind one original pipeline comparison.',409);
    same(measured.plan,selected,'ACCEPTANCE_REPORT_BINDING','The report selects another acceptance plan.');
    same(measured.parity,load(store,comparison.report),'ACCEPTANCE_REPORT_BINDING','The report must retain the original native parity.');
    same(measured.observations,load(store,comparison.observations),'ACCEPTANCE_REPORT_BINDING','The report must retain the complete native observations.');
    same(report.findings,measured.findings,'ACCEPTANCE_REPORT_BINDING','The finding summary differs from its original full report.');
    same(report.counts,measured.counts,'ACCEPTANCE_REPORT_BINDING','The finding counts differ from the measured report.');
    requireValue(report.readyForCutover===measured.readyForCutover,'ACCEPTANCE_REPORT_BINDING','The measured readiness differs.',409);checkSources(state,report.sourceId,report.report);
  }
  for(const decision of state.acceptanceDecisions??[]){
    const report=row(state.acceptanceReports,decision.reportId,'ACCEPTANCE_REPORT'),measured=load(store,report.report);
    const value=checked(decision.decision,result=>same(decideAcceptance(measured,result.decisions),result,'ACCEPTANCE_DECISION_CHANGED','The received decision must reproduce without changing measured findings.'));
    requireValue(value.reportId===report.reportId&&value.decisionId===decision.decisionId,'ACCEPTANCE_DECISION_BINDING','The decision belongs to another measured report.',409);
    same(decision.decisions,value.decisions,'ACCEPTANCE_DECISION_BINDING','The reviewed decisions differ from their complete edition.');
    same(decision.counts,value.counts,'ACCEPTANCE_DECISION_BINDING','The decision counts differ from their complete edition.');
    requireValue(decision.readyForCutover===value.readyForCutover,'ACCEPTANCE_DECISION_BINDING','The reviewed readiness differs.',409);checkSources(state,decision.sourceId,decision.decision);
  }
  for(const cutover of state.cutovers??[]){
    if(cutover.kind!=='cutover'||!cutover.acceptanceReportId)continue;
    const selected=row(state.acceptanceReports,cutover.acceptanceReportId,'ACCEPTANCE_REPORT'),report=load(store,selected.report);
    requireValue(cutover.selection.jobId===selected.jobId&&cutover.selection.comparisonId===selected.comparisonId&&cutover.selection.planId===selected.planId,'ACCEPTANCE_CUTOVER_BINDING','A claimed accepted consumer must select that exact measured native result.',409);
    const job=row(state.jobs,selected.jobId,'JOB');requireValue(job.status==='complete'&&job.stage==='verify','ACCEPTANCE_CUTOVER_BINDING','The accepted native result must be an explicit completed verification.',409);
    let outcome=report;
    if(cutover.acceptanceDecisionId){const decision=row(state.acceptanceDecisions,cutover.acceptanceDecisionId,'ACCEPTANCE_DECISION');requireValue(decision.reportId===selected.id,'ACCEPTANCE_CUTOVER_BINDING','The accepted review belongs to another report.',409);outcome=load(store,decision.decision);}
    requireValue(outcome.readyForCutover,'ACCEPTANCE_CUTOVER_BINDING','An imported accepted consumer retains unresolved measured findings.',409);
    const binding=load(store,cutover.selection.snapshot),comparison=row(state.comparisons,selected.comparisonId,'COMPARISON'),database=job.files.find(x=>x.path==='data/target.duckdb');
    requireValue(binding.jobId===job.id&&binding.comparisonId===comparison.id&&binding.side==='target','ACCEPTANCE_CUTOVER_BINDING','The full selected consumer binding differs from its accepted job.',409);
    same(binding.observations,comparison.observations,'ACCEPTANCE_CUTOVER_BINDING','Consumer observations must bind the accepted full population.');
    same(binding.database,database,'ACCEPTANCE_CUTOVER_BINDING','Consumer database must bind the accepted closed native file.');
  }
  if(state.currentAcceptancePlanId)row(state.acceptancePlans,state.currentAcceptancePlanId,'ACCEPTANCE_PLAN');
  if(state.currentAcceptanceReportId){const r=row(state.acceptanceReports,state.currentAcceptanceReportId,'ACCEPTANCE_REPORT');requireValue(r.acceptancePlanId===state.currentAcceptancePlanId,'ACCEPTANCE_CURRENT_BINDING','The current measured report must belong to the selected acceptance plan.',409);}
  if(state.currentAcceptanceDecisionId){const d=row(state.acceptanceDecisions,state.currentAcceptanceDecisionId,'ACCEPTANCE_DECISION');requireValue(d.reportId===state.currentAcceptanceReportId,'ACCEPTANCE_CURRENT_BINDING','The current decision must belong to the selected measured report.',409);}
}
class AcceptanceArchives extends Archives{
  async inspect(path,options){
    const packet=await super.inspect(path,options),cache=new Map();
    for(const version of packet.versions){
      const state=JSON.parse(version.state_json);
      for(const plan of state.plans)requireValue(plan.product==='dlthub.pipeline.v1','HANDOFF_PRODUCT','Receive the original dlt pipeline and additive acceptance workspace.',409);
      for(const job of state.jobs)requireValue(job.kind==='dlt_pipeline','HANDOFF_PRODUCT','Retain the original native pipeline jobs.',409);
      if(options?.retainObjects!==false)checkState(state,this.store,cache);
    }return{...packet,acceptanceValidation:options?.retainObjects===false?'deferred-until-retained':'complete'};
  }
}
export class Workspace extends PipelineWorkspace{
  static async open({directory,sourceRoot,runtimeReadyFile,python='python3',sourceFiles}){
    const root=await privateDirectory(resolve(directory),{create:true}),lease=await acquireWorkspaceLease(join(root,'workspace.lock'));
    try{return new Workspace(root,{sourceRoot:resolve(sourceRoot),runtimeReadyFile,python,sourceFiles,lease});}catch(error){await lease.close();throw error;}
  }
  constructor(directory,options){super(directory,options);this.archives=new AcceptanceArchives(this);}
  consumerView(state){
    const value=super.consumerView(state),selection=value.selection;
    if(!selection)return{...value,acceptance:{state:'unbound'}};
    const accepted=(state.cutovers??[]).find(item=>item.kind==='cutover'&&item.acceptanceReportId&&item.selection.snapshot.sha256===selection.snapshot.sha256);
    return{...value,acceptance:accepted?{state:'accepted-at-selection',reportId:accepted.acceptanceReportId,decisionId:accepted.acceptanceDecisionId??null}: {state:selection.kind==='expected'?'expected-reference':'legacy-unreviewed',reportId:null,decisionId:null}};
  }
  result(value){
    const result=super.result(value);
    return{...result,view:{...result.view,acceptancePlans:result.view.acceptancePlans??[],acceptanceReports:result.view.acceptanceReports??[],acceptanceDecisions:result.view.acceptanceDecisions??[],currentAcceptancePlanId:result.view.currentAcceptancePlanId??null,currentAcceptanceReportId:result.view.currentAcceptanceReportId??null,currentAcceptanceDecisionId:result.view.currentAcceptanceDecisionId??null}};
  }
  async dispatch(actor,input){
    if(!ACTIONS.has(input?.action))return super.dispatch(actor,input);
    requireOperator(actor);object(input,'request');id(input.projectId,'projectId');id(input.requestId,'requestId');object(input.payload??{},'payload');input={...input,payload:input.payload??{}};
    const prior=this.store.request(actor.id,input.requestId,input);if(prior){await this.serial(prior.view.id,()=>this.reconcile(prior.view.id));return this.result(prior);}
    return this.serial(input.projectId,async()=>{
      await this.reconcile(input.projectId);const replay=this.store.request(actor.id,input.requestId,input);if(replay)return this.result(replay);
      const state=this.store.get(input.projectId),p=input.payload;
      requireValue(state.revision===input.expectedRevision,'REVISION_CONFLICT','Reconcile the original request before changing the current acceptance edition.',409,{currentRevision:state.revision});
      let output;
      if(input.action==='acceptance.compile'){
        text(p.title,'title',{min:1,max:300});const source=row(state.sources,p.sourceId,'SOURCE'),native=this.planObject(state,p.planId);
        requireValue(source.bytes<=32*1024*1024,'ACCEPTANCE_INPUT_SIZE','Supply a complete bounded acceptance input.',413);
        const document=load(this.store,source);
        if(document.pipelinePlan!==undefined)same(document.pipelinePlan,native.plan,'ACCEPTANCE_PIPELINE_CHANGED','The intake pipeline differs from the selected original plan.');
        const compiled=compileAcceptance({...document,pipelinePlan:native.plan}),descriptor=this.store.objects.put(Buffer.from(canonical(compiled)+'\n'));
        output=this.store.commit(actor,input,s=>{
          ensure(s);const compiledSourceId=retainedSource(s,descriptor,p.title,'acceptance-plan'),plan={id:'acceptance_plan_'+identity({actorId:actor.id,requestId:input.requestId}).slice(0,32),title:p.title,planId:native.selected.id,semanticPlanId:native.plan.planId,sourceId:source.id,compiled:descriptor,compiledSourceId,acceptancePlanId:compiled.planId,objects:compiled.objects,relationships:compiled.relationships,controls:compiled.controls,createdAt:now()};
          s.acceptancePlans.push(plan);s.currentAcceptancePlanId=plan.id;s.currentAcceptanceReportId=null;s.currentAcceptanceDecisionId=null;return{acceptancePlanId:plan.id,semanticAcceptancePlanId:compiled.planId};
        });
      }else if(input.action==='acceptance.select'){
        const selected=row(state.acceptancePlans,p.acceptancePlanId,'ACCEPTANCE_PLAN');text(p.reason,'reason',{min:1,max:20000});
        requireValue(selected.planId===state.currentPlanId,'ACCEPTANCE_PIPELINE_CHANGED','Select the corresponding original pipeline edition before its acceptance plan.',409);
        output=this.store.commit(actor,input,s=>{ensure(s);s.currentAcceptancePlanId=selected.id;s.currentAcceptanceReportId=null;s.currentAcceptanceDecisionId=null;return{acceptancePlanId:selected.id,reason:p.reason};});
      }else if(input.action==='acceptance.evaluate'){
        const selected=row(state.acceptancePlans,p.acceptancePlanId,'ACCEPTANCE_PLAN'),comparison=row(state.comparisons,p.comparisonId,'COMPARISON');
        requireValue(selected.id===state.currentAcceptancePlanId&&comparison.planId===selected.planId&&selected.planId===state.currentPlanId,'ACCEPTANCE_PIPELINE_CHANGED','Measure the selected current acceptance and pipeline editions against their own comparison.',409);
        const report=evaluateAcceptance(load(this.store,selected.compiled),load(this.store,comparison.observations),{parity:load(this.store,comparison.report)}),descriptor=this.store.objects.put(Buffer.from(canonical(report)+'\n'));
        output=this.store.commit(actor,input,s=>{
          ensure(s);const sourceId=retainedSource(s,descriptor,'Complete measured acceptance','acceptance-report'),item={id:'acceptance_report_'+identity({acceptancePlanId:selected.id,comparisonId:comparison.id,sha256:descriptor.sha256}).slice(0,32),acceptancePlanId:selected.id,planId:selected.planId,comparisonId:comparison.id,jobId:comparison.jobId,report:descriptor,sourceId,reportId:report.reportId,findings:report.findings,counts:report.counts,readyForCutover:report.readyForCutover,createdAt:now()};
          if(!s.acceptanceReports.some(x=>x.id===item.id))s.acceptanceReports.push(item);s.currentAcceptanceReportId=item.id;s.currentAcceptanceDecisionId=null;return{acceptanceReportId:item.id,semanticReportId:report.reportId,counts:report.counts,readyForCutover:report.readyForCutover};
        });
      }else if(input.action==='acceptance.decide'){
        const selected=row(state.acceptanceReports,p.reportId,'ACCEPTANCE_REPORT'),report=load(this.store,selected.report);
        requireValue(selected.id===state.currentAcceptanceReportId&&selected.acceptancePlanId===state.currentAcceptancePlanId&&selected.planId===state.currentPlanId,'ACCEPTANCE_REPORT_STALE','Decide against the selected current measured report.',409);
        array(p.decisions,'decisions',{max:10000});requireValue(p.decisions.length>0,'ACCEPTANCE_DECISIONS','Supply at least one explicit reviewed disposition.');
        const previous=state.currentAcceptanceDecisionId?row(state.acceptanceDecisions,state.currentAcceptanceDecisionId,'ACCEPTANCE_DECISION'):null;
        requireValue(!previous||previous.reportId===selected.id,'ACCEPTANCE_DECISION_BINDING','The current decision belongs to another measured report.',409);
        const decisions=new Map((previous?load(this.store,previous.decision).decisions:[]).map(d=>[d.findingId,d])),seen=new Set();
        for(const proposed of p.decisions){
          object(proposed,'decision');requireValue(Object.keys(proposed).every(key=>['findingId','disposition','reason'].includes(key)),'ACCEPTANCE_DECISION_FIELDS','Actor and report identity are bound by the authenticated action.');
          requireValue(!seen.has(proposed.findingId),'ACCEPTANCE_DECISION_DUPLICATE','Review each selected finding once.');seen.add(proposed.findingId);
          decisions.set(proposed.findingId,{findingId:proposed.findingId,reportId:report.reportId,disposition:proposed.disposition,reason:proposed.reason,actorId:actor.id});
        }
        const reviewed=decideAcceptance(report,[...decisions.values()]),descriptor=this.store.objects.put(Buffer.from(canonical(reviewed)+'\n'));
        output=this.store.commit(actor,input,s=>{
          ensure(s);const sourceId=retainedSource(s,descriptor,'Reviewed acceptance decisions','acceptance-decision'),item={id:'acceptance_decision_'+identity({actorId:actor.id,requestId:input.requestId}).slice(0,32),reportId:selected.id,decision:descriptor,sourceId,decisionId:reviewed.decisionId,decisions:reviewed.decisions,resolution:reviewed.resolution,counts:reviewed.counts,readyForCutover:reviewed.readyForCutover,actorId:actor.id,createdAt:now()};
          s.acceptanceDecisions.push(item);s.currentAcceptanceDecisionId=item.id;return{acceptanceDecisionId:item.id,semanticDecisionId:reviewed.decisionId,counts:reviewed.counts,readyForCutover:reviewed.readyForCutover};
        });
      }else if(input.action==='cutover.apply'){
        await this.assertIdle(state.id);text(p.reason,'reason',{min:1,max:20000});
        const comparison=row(state.comparisons,p.comparisonId,'COMPARISON'),job=row(state.jobs,comparison.jobId,'JOB'),{selected,plan}=this.planObject(state,comparison.planId),parity=load(this.store,comparison.report);
        requireValue(parity.readyForCutover&&parity.planId===plan.planId&&selected.status==='approved'&&selected.id===state.currentPlanId,'CUTOVER_NOT_READY','Select complete equal typed parity for the approved current pipeline.',409,{errors:parity.errors});
        requireValue(job.stage==='verify'&&job.status==='complete'&&state.jobs.filter(j=>j.planId===selected.id).at(-1)?.id===job.id,'FRESH_VERIFICATION_REQUIRED','Complete the current explicit native verification and select that exact comparison.',409);
        const quality=row(state.acceptanceReports,p.acceptanceReportId,'ACCEPTANCE_REPORT'),qualityPlan=row(state.acceptancePlans,quality.acceptancePlanId,'ACCEPTANCE_PLAN');
        requireValue(quality.id===state.currentAcceptanceReportId&&qualityPlan.id===state.currentAcceptancePlanId&&quality.planId===selected.id&&quality.comparisonId===comparison.id&&quality.jobId===job.id,'ACCEPTANCE_CURRENT_REQUIRED','Select the current measured acceptance report for this exact verified comparison.',409);
        const report=load(this.store,quality.report);
        same(evaluateAcceptance(load(this.store,qualityPlan.compiled),load(this.store,comparison.observations),{parity}),report,'ACCEPTANCE_REPORT_CHANGED','Acceptance must reproduce from the complete native verification.');
        let reviewed=null;
        if(state.currentAcceptanceDecisionId){
          requireValue(p.acceptanceDecisionId===state.currentAcceptanceDecisionId,'ACCEPTANCE_DECISION_CURRENT','Select the current explicit review edition.',409);
          const decision=row(state.acceptanceDecisions,p.acceptanceDecisionId,'ACCEPTANCE_DECISION');requireValue(decision.reportId===quality.id,'ACCEPTANCE_DECISION_BINDING','Select decisions from this exact measured report.',409);
          reviewed=load(this.store,decision.decision);same(decideAcceptance(report,reviewed.decisions),reviewed,'ACCEPTANCE_DECISION_CHANGED','The complete reviewed decisions changed.');
        }else requireValue(!p.acceptanceDecisionId,'ACCEPTANCE_DECISION_CURRENT','This report has no current decision edition.',409);
        requireValue((reviewed??report).readyForCutover,'ACCEPTANCE_NOT_READY','Resolve every required finding and review each permitted exception before switching.',409,{counts:(reviewed??report).counts});
        const database=job.files.find(x=>x.path==='data/target.duckdb');requireValue(database,'DATABASE_MISSING','Retain the complete original DuckDB database.',409);
        const make=side=>{const body={schema:'dlthub.consumer-binding.v1',side,jobId:job.id,planId:plan.planId,comparisonId:comparison.id,pipelineName:plan.pipelineName,datasetName:plan.datasetName,database,observations:comparison.observations,tables:plan.acceptance.map(t=>({streamId:t.id,relation:[plan.datasetName,t.table]})),selectedAt:job.nativeState.updatedAt,scope:'This retained consumer binding; production consumers remain with their original owner.'};return{id:'selection_'+identity(body).slice(0,32),kind:side,jobId:job.id,planId:selected.id,comparisonId:comparison.id,snapshot:this.store.objects.put(Buffer.from(canonical(body)+'\n')),tables:body.tables};};
        const next=make('target'),previous=this.consumerSelection(state)??make('expected');
        output=this.store.commit(actor,input,s=>{ensure(s);const item={id:'cutover_'+identity({actorId:actor.id,requestId:input.requestId}).slice(0,32),kind:'cutover',selection:next,previous:clone(previous),reason:p.reason,actorId:actor.id,acceptanceReportId:quality.id,acceptanceDecisionId:s.currentAcceptanceDecisionId??null,createdAt:now()};s.cutovers.push(item);s.currentCutoverId=item.id;return{cutoverId:item.id,selection:next,acceptanceReportId:quality.id,acceptanceDecisionId:item.acceptanceDecisionId};});this.materializeConsumer(this.store.get(state.id));
      }
      requireValue(output,'ACTION_NOT_IMPLEMENTED','The acceptance action is unavailable.',400);return this.result(output);
    });
  }
  async close(){
    if(this.closedWorkspace)return;
    if(this.closePromise)return this.closePromise;
    this.closePromise=(async()=>{
      if(!this.closeDrained){
        await Promise.allSettled([...this.queues.values()]);
        await this.uploads.drain();
        await Promise.allSettled([...this.runtime.launches.values(),...this.runtime.reading.values(),...this.downstreamRunning.values()].map(value=>value.promise??value));
        this.closeDrained=true;
      }
      if(!this.closedArchives){await this.archives.close();this.closedArchives=true;}
      if(!this.closedStore){this.store.close();this.closedStore=true;}
      if(!this.closedWorkspaceLease){await this.lease.close();this.closedWorkspaceLease=true;}
      this.closedWorkspace=true;
    })();
    try{return await this.closePromise;}finally{this.closePromise=null;}
  }

}
export const openWorkspace=options=>Workspace.open(options);
