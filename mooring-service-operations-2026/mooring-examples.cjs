/* SPDX-License-Identifier: MIT */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.MooringServiceExamples=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
function* programme(C,catalogue,ctx){
 const ids={},walkthrough=[];ctx.ids=ids;ctx.walkthrough=walkthrough;
 const send=(type,body)=>({type,...body}),review=(fn,id)=>({id,expectedReviewSha256:C[fn](ctx.workspace,id).reviewSha256});
 const towns=['Duxbury, Massachusetts','Mattapoisett, Massachusetts','New Bedford, Massachusetts','Bourne, Massachusetts','Chatham, Massachusetts','Brunswick, Maine'];
 for(let index=0;index<catalogue.operators.length;index++){
  const operator=catalogue.operators[index],operatorKey=operator.key,p='demo-'+(index+1),ownerId=p+'-owner',crewId=p+'-crew',boatId=p+'-boat',mooringId=p+'-mooring',permitId=p+'-permit',jobId=p+'-job',inspectionId=p+'-inspection',componentIds=['anchor','chain','buoy'].map(x=>p+'-'+x);
  ids[operatorKey]={ownerId,crewId,boatId,mooringId,permitId,jobId,inspectionId,componentIds};
  yield send('person-save',{person:{id:ownerId,operatorKey,name:'Demonstration owner '+(index+1),role:'owner',email:'',phone:'',notes:'Invented commissioning record; no real customer contact.'}});
  yield send('person-save',{person:{id:crewId,operatorKey,name:'Demonstration crew '+(index+1),role:'crew',email:'',phone:'',notes:'Selected walkthrough crew, not a published employee.'}});
  yield send('resource-save',{resource:{id:boatId,operatorKey,name:'Demonstration workboat '+(index+1),kind:'workboat',notes:'Actual equipment must be entered by the operator.'}});
  yield send('mooring-save',{mooring:{id:mooringId,operatorKey,label:'DEMO '+(index+1)+' seasonal mooring',externalRef:'DEMO-'+(index+1),municipality:towns[index],harbor:'Demonstration service area',ownerId,vessel:{name:'Demonstration vessel '+(index+1),registration:'DEMO ONLY',kind:'Operator-selected walkthrough vessel',length:'',lengthUnit:'',notes:'No real vessel specification.'},position:{format:'unknown',latitude:'',longitude:'',datum:'',source:'No measured location supplied'},anchorDetails:'Demonstration inventory; design and condition require actual operator assessment.',season:'2026 demonstration',notes:'Source company workflow is real; this asset and every decision below are invented operating examples.',active:true}});
  for(const [i,key]of componentIds.entries())yield send('component-save',{component:{id:key,operatorKey,mooringId,label:['Anchor','Ground chain','Summer buoy'][i]+' — demonstration',kind:['anchor','chain','buoy'][i],description:'Operator-selected example component; no inferred size or capacity.',serial:'DEMO-'+key,notes:'Replace with the original actual component record.'}});
  yield send('permit-save',{permit:{id:permitId,operatorKey,mooringId,jurisdiction:towns[index],reference:'DEMO-PERMIT-'+(index+1),validFrom:'2026-01-01',validTo:'2026-12-31',requirements:'Demonstration requirement only; consult this actual municipality before operational use.',sourceUrls:index===5?catalogue.townExample.source_urls:operator.sourceUrls,notes:'Invented walkthrough permit; not an authority approval.'}});
  yield send('permit-decision',{id:permitId,result:'approved',at:'2026-10-11T14:00:00Z',reference:'DEMONSTRATION-DECISION-'+(index+1),reason:'Explicit invented approval solely to exercise the operating programme.'});
  const plannedStart='2026-10-12T13:00:00Z',plannedEnd='2026-10-12T17:00:00Z';
  yield send('job-save',{job:{id:jobId,operatorKey,mooringId,title:['Fall marker and gear storage','Hauled inspection and repair','Permit-coordinate field record','Buoy preparation and seasonal change','Dive inspection continuation','Municipal reporting preparation'][index]+' — demonstration',kind:index===1||index===4?'inspect':'seasonal',plannedStart,plannedEnd,timezone:operator.timezone,crewIds:[crewId],resourceIds:[boatId],permitRequired:true,permitId,inspectionRequired:true,checklist:[{id:p+'-check-location',label:'Record actual mooring identification and field position',required:true},{id:p+'-check-gear',label:'Record handled gear and required customer/town follow-up',required:true}],notes:'Selected historical demonstration interval; explicit source-specific service, no calculated engineering compliance.'}});
  yield send('job-confirm',review('reviewJob',jobId));
  if(index===5)continue;
  yield send('job-start',{id:jobId,at:'2026-10-12T13:15:00Z'});
  const evidenceId=p+'-field-note';yield send('evidence-add',{evidence:{id:evidenceId,operatorKey,mooringId,jobId,name:p+'-original-field-note.txt',mime:'text/plain',contentBase64:'RGVtb25zdHJhdGlvbiBmaWVsZCBub3RlLg0K',notes:'Exact original demonstration text attachment; not a field photograph.'}});
  const findingId=p+'-finding-chain';yield send('inspection-save',{inspection:{id:inspectionId,operatorKey,jobId,method:index===4?'dive':'hauled',observedAt:'2026-10-12T13:30:00Z',findings:[{id:p+'-finding-anchor',componentId:componentIds[0],label:'Anchor visual observation',condition:'serviceable',measurement:'',unit:'',notes:'Demonstration operator-selected observation; no engineering claim.',evidenceIds:[evidenceId]},{id:findingId,componentId:componentIds[1],label:'Chain observation',condition:index===1?'attention':index===2?'not-assessed':'serviceable',measurement:index===1?'12.1':'',unit:index===1?'mm':'',notes:'Original measurement retained as entered; no rejection threshold inferred.',evidenceIds:[evidenceId]}],summary:'Demonstration field record for '+operator.name,notes:'Actual source bytes and method are retained.'}});
  yield send('inspection-finalize',{id:inspectionId});
  if(index===1){const repairId=p+'-repair';ids[operatorKey].repairId=repairId;
   yield send('repair-save',{repair:{id:repairId,operatorKey,jobId,inspectionId,findingId,description:'Demonstration replacement and retorque record',parts:[{id:p+'-part',description:'Operator-selected replacement link',quantity:2,unit:'each',unitPriceCents:1250}],minutes:35,currency:'USD',notes:'Selected example costs, not published company rates.'}});
   yield send('repair-complete',{id:repairId,at:'2026-10-12T14:10:00Z',result:'Demonstration replacement recorded.'});
   yield send('repair-reopen',{id:repairId,reason:'Demonstration follow-up check was requested before the job closed.'});
   yield send('repair-save',{repair:{...ctx.workspace.repairs.find(x=>x.id===repairId),minutes:45,notes:'Additional actual demonstration recheck time recorded; original completion stays in history.'}});
   yield send('repair-complete',{id:repairId,at:'2026-10-12T14:25:00Z',result:'Demonstration recheck completed and documented.'});
  }
  if(index===2)yield send('inspection-exception',{id:inspectionId,findingId,reason:'Demonstration operator explicitly records a deferred chain assessment and follow-up; this is not a safe-to-use certification.'});
  if(index===4)continue;
  yield send('gear-move',{mooringId,componentIds:[componentIds[2]],state:'stored',location:'DEMO rack '+(index+1),at:'2026-10-12T14:30:00Z',jobId,reason:'Demonstration fall removal, cleaning and storage.'});
  for(const check of ctx.workspace.jobs.find(x=>x.id===jobId).checklist)yield send('job-check',{id:jobId,checkId:check.id,done:true,note:'Explicit demonstration check recorded.'});
  yield send('job-complete',{...review('reviewJobCompletion',jobId),at:'2026-10-12T15:00:00Z'});
  yield send('notice-save',{notice:{id:p+'-notice',operatorKey,mooringId,jobId,recipient:'Demonstration owner '+(index+1),channel:'email',destination:'',body:'Demonstration seasonal work summary. Review the complete attached field record and follow-up notes.',notes:'Prepared only; sending remains a separate actual operation.'}});
  if(index===0)yield send('notice-record-sent',{id:p+'-notice',at:'2026-10-12T15:30:00Z',reference:'DEMONSTRATION-SEPARATE-SEND-ONLY'});
  const submissionId=p+'-submission';ids[operatorKey].submissionId=submissionId;
  yield send('submission-save',{submission:{id:submissionId,operatorKey,mooringId,jobIds:[jobId],inspectionIds:[inspectionId],permitId,authority:towns[index]+' demonstration review',notes:'Prepared source handoff; no actual authority submission.'}});
  yield send('submission-submit',{...review('reviewSubmission',submissionId),at:'2026-10-12T16:00:00Z',reference:'DEMONSTRATION-HANDOFF-'+index});
  if(index===0){
   yield send('submission-response',{id:submissionId,result:'returned',at:'2026-10-12T17:00:00Z',reference:'DEMO-RETURNED-ISSUE',issues:[{id:'demo-photo-issue',text:'Demonstration request for clearer vessel identification.'}],notes:'Original returned issue preserved.'});
   const successor=p+'-submission-amended';yield send('submission-save',{submission:{...ctx.workspace.submissions.find(x=>x.id===submissionId),id:successor,previousSubmissionId:submissionId,notes:'Demonstration amendment: vessel identifier cross-reference supplied. Original field snapshot unchanged.'}});
   yield send('submission-submit',{...review('reviewSubmission',successor),at:'2026-10-12T18:00:00Z',reference:'DEMO-REVISED-HANDOFF'});
   yield send('submission-response',{id:successor,result:'approved',at:'2026-10-12T19:00:00Z',reference:'DEMO-REVIEW-APPROVAL',issues:[],notes:'Invented response to illustrate separate authority state; permit is unchanged.'});
  }
 }
 const first=ids[catalogue.operators[0].key],op=catalogue.operators[0].key;
 yield send('job-save',{job:{id:'demo-next-season-job',operatorKey:op,mooringId:first.mooringId,title:'Next-season preparation — demonstration request',kind:'install',plannedStart:'2027-04-12T13:00:00Z',plannedEnd:'2027-04-12T16:00:00Z',timezone:'America/New_York',crewIds:[first.crewId],resourceIds:[first.boatId],permitRequired:true,permitId:first.permitId,inspectionRequired:true,checklist:[],notes:'Expected review finding: the original 2026 permit does not authorize this selected 2027 programme.'}});
 const sixth=ids[catalogue.operators[5].key];
 yield send('job-save',{job:{...ctx.workspace.jobs.find(j=>j.id===sixth.jobId),id:'demo-conflicting-crew-job',title:'Overlapping requested crew assignment — demonstration',notes:'Review surfaces the existing confirmed workboat/crew overlap.'}});
 const mapping={operatorKey:{constant:op},ownerId:{constant:first.ownerId},municipality:{constant:'Duxbury, Massachusetts'},label:'Mooring',externalRef:'Reference',harbor:'Harbor',positionFormat:{constant:'unknown'},notes:'Notes'};
 const csv='\uFEFFMooring,Reference,Harbor,Notes\r\nImported demonstration mooring,DEMO-IMPORT,Demonstration bay,"Original comma, retained"\r\nExisting mooring alias,DEMO-1,Demonstration bay,Link without rewriting original owner or position\r\nArchived source row,ARCHIVE,Archive,Keep as ignored original\r\n';
 let r=C.reviewCSV(ctx.workspace,{name:'original-demo-moorings.csv',text:csv,mapping});
 yield send('csv-commit',{review:r,decisions:[{row:2,action:'create',mooringId:'demo-imported-mooring'},{row:3,action:'link',mooringId:first.mooringId},{row:4,action:'ignore',reason:'Historical source row retained but not selected for this operating workspace.'}]});
 walkthrough.push({title:'Six distinct operator workflows',detail:'Real published company work informs the catalogue. All owners, boats, moorings, permits, measurements, prices and decisions are explicitly invented demonstration data.',ids:Object.values(ids).map(v=>v.mooringId)});
 walkthrough.push({title:'Complete seasonal service',detail:'The first four jobs carry finalized findings, original evidence, required checks, gear storage and frozen completion snapshots. One linked repair is completed, visibly reopened and completed again.'});
 walkthrough.push({title:'Authority response and corrected handoff',detail:'The first original submission is returned with a specific issue. Its separate amended successor is reviewed, sent and records a demonstration approval. The permit remains a separate original decision record.'});
 walkthrough.push({title:'Continue actual unfinished work',detail:'The fifth job remains in progress; the sixth remains confirmed. A conflicting request and next-year permit mismatch show concrete review findings without changing those saved jobs.'});
 walkthrough.push({title:'Full original intake',detail:'The BOM/CRLF CSV, quoted comma, row decisions, one new asset and one preserved existing-asset link travel in the full working export.'});
}
function context(C,catalogue){return {workspace:C.create(catalogue,{id:'mooring-service-demonstration',title:'Six-operator seasonal mooring programme — demonstration records',now:'2026-10-13T09:00:00Z'})};}
function execute(C,ctx,command,index){ctx.workspace=C.mutate(ctx.workspace,command,{expectedRevision:ctx.workspace.revision,now:new Date(Date.parse('2026-10-13T09:00:00Z')+(index+1)*1000).toISOString(),actor:'Demonstration operator'});}
function result(ctx){return {workspace:ctx.workspace,ids:ctx.ids,walkthrough:ctx.walkthrough};}
function build(C,catalogue){const ctx=context(C,catalogue);let i=0;for(const c of programme(C,catalogue,ctx))execute(C,ctx,c,i++);return result(ctx);}
async function buildAsync(C,catalogue,{onProgress=()=>{},yieldEvery=6}={}){const ctx=context(C,catalogue);let i=0;for(const c of programme(C,catalogue,ctx)){execute(C,ctx,c,i++);if(i%yieldEvery===0){onProgress({message:'Building the complete seasonal mooring example',operations:i});await new Promise(r=>setTimeout(r,0));}}onProgress({message:'Complete mooring example ready',operations:i});return result(ctx);}
return Object.freeze({build,buildAsync});
});
