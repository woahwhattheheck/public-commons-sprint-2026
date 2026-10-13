/* SPDX-License-Identifier: MIT
 * Exact, explicitly fictional migration commissioning programme.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.MEPMigrationExamples=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
function* steps(C,catalogue){
 let clock=0,w=C.create(catalogue,{id:'mep_migration_demonstration',title:'Six public trade workflows — fictional migration commissioning',now:'2026-10-13T00:00:00Z'});const ids={},walkthrough=[],originalFiles=[];
 const at=()=>new Date(Date.UTC(2026,9,13,0,0,++clock)).toISOString(),apply=command=>{w=C.mutate(w,command,{expectedRevision:w.revision,actor:'Demonstration migration operator',now:at()});return w;};
 const csv=(head,rows)=>[head,...rows].map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
 const field=(key,column,type='text',required=true,referenceEntity='',values=[])=>({key,label:key,type,required,from:{column},trim:false,empty:'null',values,referenceEntity});
 function original(op,entity,edition,text,kind='source',parentId=''){
  const id='original_'+op.key+'_'+entity+'_'+edition,name=id+(text.startsWith('{')||text.startsWith('[')?'.json':'.csv'),format=name.endsWith('.json')?'json':'csv';
  apply({type:'source.add',value:{id,programmeId:ids[op.key].programmeId,entity,kind,name,format,text,jsonPath:format==='json'?['rows']:[],sourceSystem:kind==='source'?'Fictional original '+op.trade+' export':'Fictional local target result',capturedAt:'2026-10-12T12:00:00Z',parentId,notes:'Created solely to demonstrate the source-based workflow. These are not the company’s customers, jobs, prices, software exports or actual receiving results.'}});
  originalFiles.push({name,text,sourceId:id,kind});return id;
 }
 function mapping(op,entity,edition,sourceId,fields,keyField='externalKey'){
  const id='mapping_'+op.key+'_'+entity+'_'+edition;
  apply({type:'profile.save',value:{id,sourceId,name:'Demonstration '+entity+' '+edition,keyField,fields,targetFields:fields.map(f=>({field:f.key,column:f.key,relationshipMode:f.referenceEntity?'nativeId':'sourceKey'})),targetContractLabel:'Explicit DEMONSTRATION receiving schema v1; supplied fields are not a MEPflow API contract.',notes:'Every source column and reference translation is selected explicitly.'}});return id;
 }
 function batch(op,sourceId,profileId,title,choose){
  let input={sourceId,profileId,title,notes:'Fictional original commissioning operation; preserve all selected source decisions.',decisions:[]},r=C.reviewBatch(w,input);
  input.decisions=r.rows.map(row=>choose?choose(row):({rowId:row.rowId,action:'create',recordId:'',reason:'Reviewed fictional original.'}));
  r=C.reviewBatch(w,input);if(r.issues.length)throw Error(r.issues.map(x=>x.message).join('; '));apply({type:'batch.commit',input,expectedReviewSha:r.reviewSha256});return w.batches.at(-1).id;
 }
 function handover(batchId,title){const input={batchId,title,notes:'No remote call is made. This is the exact configured demonstration receiving edition.'},r=C.reviewDelivery(w,input);if(r.issues.length)throw Error(r.issues.map(x=>x.message).join('; '));apply({type:'delivery.prepare',input,expectedReviewSha:r.reviewSha256});return w.deliveries.at(-1);}
 function result(op,entity,delivery,edition,choose){
  const outcomes=delivery.rows.map((row,i)=>choose?choose(row,i):({rowId:row.rowId,status:'accepted',nativeId:'DEMO-'+op.key+'-'+entity+'-'+(i+1),reason:'Fictional response retained for this worked course.'}));
  const evidence=original(op,entity,edition,csv(['original_row','status','native_id','reason'],outcomes.map(x=>[x.rowId,x.status,x.nativeId,x.reason])),'target-result');
  const input={deliveryId:delivery.id,evidenceFileId:evidence,observedAt:'2026-10-13T00:00:00Z',reference:'DEMONSTRATION '+op.key+' '+entity+' '+edition,notes:'Explicitly authored local example outcomes, not a native company import.',outcomes},r=C.reviewReceipt(w,input);
  if(r.issues.length)throw Error(r.issues.map(x=>x.message).join('; '));apply({type:'receipt.commit',input,expectedReviewSha:r.reviewSha256});return w.receipts.at(-1).id;
 }
 yield {workspace:w,progress:{completed:0,total:6,message:'Created empty demonstration workspace.'}};
 for(const op of catalogue.operators){
  const programmeId='programme_'+op.key;ids[op.key]={programmeId};
  apply({type:'programme.save',value:{id:programmeId,operatorKey:op.key,title:op.name+' — fictional commissioning',targetSystem:'DEMONSTRATION receiver for '+op.key,targetVersion:'1',notes:op.workflow+' All customer/site/job rows, IDs, values and target outcomes in this programme are fictional operating examples. '+(op.key==='whatley'?'Current public site links Jobber; this programme does not connect to Jobber or infer its export schema.':'')}});
  const c1=op.key+'-C001',c2=op.key+'-C002';
  const cs=original(op,'customer','first','\ufeff'+csv(['Legacy ID','Display name','Customer state','Address'],[[c1,'Demonstration customer A','Live',op.key==='united'?'':'1 Demonstration Lane'],[c2,'Demonstration customer B','Live','2 Demonstration Lane'],[c1,'Demonstration duplicate A','Live','1 Demonstration Lane']]));
  const cf=[field('externalKey','Legacy ID'),field('name','Display name'),field('status','Customer state','text',true,'',[{from:'Live',to:'active'},{from:'Paused',to:'inactive'}]),field('address','Address','text',false)];
  const cp=mapping(op,'customer','first',cs,cf),cb=batch(op,cs,cp,'First customer selection',row=>({rowId:row.rowId,action:row.index===3?'exclude':'create',recordId:'',reason:row.index===3?'Duplicate original legacy key; the first complete row is selected. Original duplicate remains retained.':'Reviewed source row.'})),cd=handover(cb,'Two selected customer rows');
  result(op,'customer',cd,'first_result');ids[op.key].customerSourceId=cs;ids[op.key].customerDeliveryId=cd.id;
  yield {workspace:w,progress:{completed:Object.keys(ids).length-1,total:6,message:op.name+': original customers and returned IDs.'}};
  const ss=original(op,'site','first',csv(['Site ID','Customer ID','Site description'],[[op.key+'-S001',c1,'Demonstration workshop address supplied by operator'],[op.key+'-S002',c2,'Demonstration service address supplied by operator']]));
  const sp=mapping(op,'site','first',ss,[field('externalKey','Site ID'),field('customerKey','Customer ID','text',true,'customer'),field('description','Site description')]),sb=batch(op,ss,sp,'Separate physical site selection'),sd=handover(sb,'Sites with actual demonstration customer-ID bindings');
  result(op,'site',sd,'first_result');ids[op.key].siteDeliveryId=sd.id;
  const jobNames=op.trade==='HVAC'?['Repair diagnosis','Planned installation','Maintenance review']:op.trade==='Plumbing'?['Water heater diagnosis','Drain repair','Accepted replacement']:['Short service visit','Multi-day installation','Generator service review'];
  const jobRows=[0,1,2].map(i=>({legacy_job:op.key+'-J00'+(i+1),customer_key:i===1?c2:c1,site_key:op.key+'-S00'+(i===1?2:1),job_kind:jobNames[i],source_status:i===0?'Open':i===1?'Booked':'Done',quoted_amount:i===0?'125.00':i===1?'1800.00':'95.00',start_date:'2026-10-'+(14+i),note:i===1?'Exact original\nmultiline scope, with comma.':'Fictional operating input.'}));
  const js=original(op,'job','first',JSON.stringify({label:'Explicit fictional original job export',rows:jobRows},null,2)+'\n');
  const jf=[field('externalKey','legacy_job'),field('customerKey','customer_key','text',true,'customer'),field('siteKey','site_key','text',true,'site'),field('kind','job_kind'),field('status','source_status','text',true,'',[{from:'Open',to:'requested'},{from:'Booked',to:'scheduled'},{from:'Done',to:'completed'}]),field('quotedAmount','quoted_amount','decimal',false),field('startDate','start_date','date',false),field('notes','note','text',false)];
  const jp=mapping(op,'job','first',js,jf),jb=batch(op,js,jp,'Three distinct job types with original status meaning'),jd=handover(jb,'Configured jobs with confirmed parent native IDs');
  result(op,'job',jd,'first_result',(row,i)=>({rowId:row.rowId,status:i===0?'accepted':i===1?'rejected':'unknown',nativeId:i===0?'DEMO-'+op.key+'-job-1':'',reason:i===0?'Fictional target accepted this original row.':i===1?'Fictional target requires the revised scope code.':'Fictional response did not establish whether this row was received; inspect before repeating.'}));
  ids[op.key].jobSourceId=js;ids[op.key].jobProfileId=jp;ids[op.key].jobDeliveryId=jd.id;
  if(op.key==='action'||op.key==='united'){
   const updated=jobRows.map(x=>({...x}));updated[1].job_kind+=' — corrected scope';updated[1].quoted_amount='1750.50';
   const nextSource=original(op,'job','correction',JSON.stringify({label:'Explicit fictional corrected job export',rows:updated},null,2)+'\n','source',js),nextProfile=mapping(op,'job','correction',nextSource,jf),nextBatch=batch(op,nextSource,nextProfile,'Reviewed correction preserves the original export',row=>({rowId:row.rowId,action:row.index===2?'update':'link',recordId:row.existingRecordId,reason:row.index===2?'Corrected the rejected scope using the complete new original edition.':'Unchanged row stays linked to its original staged record.'})),nextDelivery=handover(nextBatch,'One corrected job; other two original rows remain linked');
   if(op.key==='action')result(op,'job',nextDelivery,'correction_result',(row)=>({rowId:row.rowId,status:'accepted',nativeId:'DEMO-action-job-2',reason:'Fictional correction acceptance retained separately from the original rejection.'}));
   ids[op.key].correctionDeliveryId=nextDelivery.id;
  }
  walkthrough.push({programmeId,operator:op.name,sourceMeaning:op.workflow,review:'Inspect all original customer rows including the excluded duplicate; site/customer keys; exact status translations and decimal strings; one accepted, one rejected and one unknown original job result.',continue:op.key==='united'?'Receive the prepared correction using an actual or explicitly fictional target-result original. Preserve the first rejection and the unresolved third job.':op.key==='action'?'Compare the first rejected job with its accepted correction; the third job remains unknown.':'Create a following source edition and explicit correction without overwriting original rows or repeating an unknown native operation.'});
  yield {workspace:w,progress:{completed:Object.keys(ids).length,total:6,message:op.name+': full source, handover, outcomes and correction history.'}};
 }
 const text=C.exportWorkspace(w),reopened=C.importWorkspace(text,{catalogue});if(C.exportWorkspace(reopened)!==text)throw Error('Complete worked workspace changed on reopen.');
 return {workspace:w,ids,walkthrough,originalFiles};
}
function build(C,catalogue){const g=steps(C,catalogue);let r;do{r=g.next();}while(!r.done);return r.value;}
async function buildAsync(C,catalogue,onProgress=()=>{}){const g=steps(C,catalogue);let r;do{r=g.next();if(!r.done){onProgress(r.value.progress);await new Promise(resolve=>setTimeout(resolve,0));}}while(!r.done);return r.value;}
return Object.freeze({build,buildAsync});
});
