// MIT. Original Fiscal saved refresh plans, native review navigation and complete delivery.
export function createRefreshPanel({getState,action,task,fail,notice,el,table,readout,originalDetails,
 fileLink,files,badge,empty,stamp,short,count,select,busy}){
 const $=id=>document.getElementById('refresh-'+id),root=$('root');
 let selectedPlanId=null,selectedRunId=null,plan=null,run=null,editorRevision=null;
 let dirty=false,formGeneration=0,planGeneration=0,runGeneration=0,previewGeneration=0;
 let planRead=null,runRead=null,previewRead=null,preview=null,planListKey='',runListKey='',detailKey='';
 const values=value=>Array.isArray(value)?value:[];
 const split=value=>String(value??'').split(',').map(item=>item.trim()).filter(Boolean);
 const utc=()=>new Date().toISOString().slice(0,10);
 const input=(id,attrs={})=>el('input',{id:'refresh-'+id,...attrs});
 const field=(label,node,help,wide=false)=>el('label',{class:wide?'span-2':undefined},label,node,
  help?el('span',{class:'help'},help):null);
 const button=(label,perform,{disabled=false,kind='secondary'}={})=>{
  const node=el('button',{type:'button',class:kind,disabled:disabled||busy(),dataset:{refreshDisabled:String(disabled)}},label);
  node.addEventListener('click',event=>Promise.resolve(perform(event)).catch(fail));return node;
 };
 const navigate=(planId,runId)=>{location.hash='refresh'+(planId?'/'+planId:'')+(runId?'/'+runId:'');};
 const form=el('form',{id:'refresh-plan-form',class:'form-grid'},
  field('Plan name',input('name',{required:true,maxlength:160,placeholder:'Daily federal debt review'}),null,true),
  field('Reviewed baseline',el('select',{id:'refresh-baseline',required:true}),
   'The selected READY edition supplies its exact source, field names, units, scales, null markers and query rules.',true),
  field('Capture policy',el('select',{id:'refresh-mode'},
   el('option',{value:'source'},'Repeat the saved source query'),el('option',{value:'window'},'Rolling date window')),null,true),
  el('div',{id:'refresh-window',class:'form-grid span-2',hidden:true},
   field('Original date field',el('select',{id:'refresh-date-field'}),'Uses the original Treasury field name.'),
   field('Window length · calendar days',input('days',{type:'number',min:1,max:3660,step:1,value:7})),
   field('Publication lag · calendar days',input('lag',{type:'number',min:0,max:3660,step:1,value:1})),
   field('Other source filters',input('base-filter',{maxlength:8192,spellcheck:false}),
    'Enter only the filters you want in addition to the chosen date window. An empty value is an explicit unfiltered base.',true)),
  field('Comparison row keys',input('keys',{required:true,spellcheck:false}),
   'Comma-separated published field names; retain the complete row identity.'),
  field('Exact measures',input('measures',{spellcheck:false}),
   'Comma-separated reviewed measure names. Original decimal strings and source units remain unchanged.'),
  field('Briefing title',input('title',{required:true,maxlength:240}),null,true),
  field('Audience',input('audience',{maxlength:400}),null,true),
  field('Briefing notes',el('textarea',{id:'refresh-briefing-notes',rows:4,maxlength:64000}),
   'Authored context is retained with every report; the original renderer supplies the data and source details.',true),
  field('Rows per report page',input('rows',{type:'number',required:true,min:1,max:500,step:1,value:200})),
  field('Plan notes',el('textarea',{id:'refresh-notes',rows:3,maxlength:16000}),null,true),
  el('div',{class:'form-actions span-2'},
   el('button',{id:'refresh-save',type:'submit'},'Save plan'),
   button('Save as new plan',()=>savePlan(true))),
  el('p',{id:'refresh-editor-state',class:'help span-2','aria-live':'polite'})
 );
 root.replaceChildren(
  el('div',{class:'refresh-layout'},
   el('section',{class:'panel refresh-picker','aria-labelledby':'refresh-plans-heading'},
    el('div',{class:'panel-heading'},el('h3',{id:'refresh-plans-heading'},'Saved plans'),button('New',()=>newPlan(),{kind:'quiet'})),
    el('div',{id:'refresh-plan-list',class:'select-list'})),
   el('section',{class:'panel','aria-labelledby':'refresh-editor-heading'},
    el('div',{class:'panel-heading'},el('h3',{id:'refresh-editor-heading'},'Plan definition'),
     button('Reload saved',()=>loadPlan(selectedPlanId,true),{kind:'quiet'})),form,
    el('div',{id:'refresh-rules',class:'inset'}))),
  el('section',{class:'panel section-gap','aria-labelledby':'refresh-run-heading'},
   el('div',{class:'panel-heading'},el('h3',{id:'refresh-run-heading'},'Capture the next period')),
   el('div',{class:'inset'},
    el('div',{class:'form-grid'},
     field('As-of date · UTC',input('as-of',{type:'date',required:true,value:utc()}),
      'The saved window is calculated from this explicit date and publication lag.'),
     el('div',{class:'form-actions'},button('Preview saved query',()=>loadPreview(true)),
      el('button',{id:'refresh-start',type:'button'},'Run saved plan'))),
    el('div',{id:'refresh-preview',class:'section-gap'}),
    el('div',{id:'refresh-run-list',class:'table-wrap section-gap'}))),
  el('section',{id:'refresh-run-panel',class:'panel section-gap',hidden:true,'aria-labelledby':'refresh-detail-heading'},
   el('div',{class:'panel-heading'},el('h3',{id:'refresh-detail-heading'},'Saved run')),
   el('div',{id:'refresh-run-detail',class:'inset'})),
  el('section',{class:'panel section-gap','aria-labelledby':'refresh-history-heading'},
   el('div',{class:'panel-heading'},el('h3',{id:'refresh-history-heading'},'Baseline and plan history')),
   el('div',{id:'refresh-history',class:'inset'}))
 );
 function set(id,value){$(id).value=value??'';}
 function baselineSelected(){return values(getState()?.editions).find(item=>item.id===$('baseline').value&&item.status==='READY');}
 function modeVisibility(){
  const windowed=$('mode').value==='window';$('window').hidden=!windowed;
  for(const node of $('window').querySelectorAll('input,select'))node.disabled=!windowed;
  $('date-field').required=windowed;
 }
 function defaultReviewFields(edition){
  set('keys',values(edition?.keyFields).join(', '));
  set('measures',values(edition?.fields).filter(field=>field.role==='measure').map(field=>field.name).join(', '));
 }
 function changed(){
  dirty=true;formGeneration++;renderEditorState();availability();
 }
 form.addEventListener('input',changed);form.addEventListener('change',changed);
 $('mode').addEventListener('change',()=>{modeVisibility();renderRules();});
 $('baseline').addEventListener('change',()=>{defaultReviewFields(baselineSelected());renderRules();});
 $('name').addEventListener('input',()=>{if(!plan&&$('title').dataset.edited!=='true')set('title',$('name').value);});
 $('title').addEventListener('input',()=>{$('title').dataset.edited='true';});
 $('as-of').addEventListener('change',()=>{preview=null;previewGeneration++;renderPreview();void loadPreview().catch(fail);});
 form.addEventListener('submit',event=>{event.preventDefault();void savePlan(false,event.submitter).catch(fail);});
 $('start').addEventListener('click',()=>void startRun().catch(fail));
 function fill(definition){
  set('name',definition?.name??'');set('baseline',definition?.baseline?.id??$('baseline').value);
  set('mode',definition?.capture?.mode??'source');set('days',definition?.capture?.days??7);
  set('lag',definition?.capture?.lagDays??1);set('base-filter',definition?.capture?.baseFilter??'');
  set('keys',values(definition?.comparison?.keyFields??baselineSelected()?.keyFields).join(', '));
  set('measures',values(definition?.comparison?.measureFields??baselineSelected()?.fields?.filter(field=>field.role==='measure').map(field=>field.name)).join(', '));
  set('title',definition?.briefing?.title??definition?.name??'');$('title').dataset.edited=definition?'true':'false';set('audience',definition?.briefing?.audience??'');
  set('briefing-notes',definition?.briefing?.notes??'');set('rows',definition?.briefing?.rowsPerPage??200);
  set('notes',definition?.notes??'');renderRules();set('date-field',definition?.capture?.dateField??$('date-field').value);
  modeVisibility();dirty=false;formGeneration++;editorRevision=plan?.revision??null;renderEditorState();
 }
 function newPlan(){
  if(busy())return;
  selectedPlanId=null;selectedRunId=null;plan=null;run=null;preview=null;
  planGeneration++;runGeneration++;previewGeneration++;planRead=null;runRead=null;previewRead=null;
  editorRevision=null;detailKey='';fill(null);navigate();render();
 }
 async function loadPlan(id,force=false){
  if(!id){if(force)newPlan();return;}
  const current=values(getState()?.refreshPlans).find(item=>item.id===id);
  const key=id+':'+(current?.revision??'');
  if(!force&&planRead?.key===key)return planRead.promise;
  const generation=++planGeneration;selectedPlanId=id;
  const active={key,promise:null};planRead=active;
  active.promise=(async()=>{
   const result=await action('refresh.plans.get',{id});
   if(generation!==planGeneration||selectedPlanId!==id)return;
   const same=plan?.id===id;plan=result;preview=null;
   if(force||!same||!dirty)fill(result.definition);
   render();await loadPreview();
  })().finally(()=>{if(planRead===active)planRead=null;});
  return active.promise;
 }
 async function loadRun(id){
  if(!id){run=null;selectedRunId=null;detailKey='';renderDetail();return;}
  const current=values(getState()?.refreshRuns).find(item=>item.id===id),key=id+':'+(current?.revision??'');
  if(runRead?.key===key)return runRead.promise;
  const generation=++runGeneration;selectedRunId=id;
  const active={key,promise:null};runRead=active;
  active.promise=(async()=>{
   const result=await action('refresh.runs.get',{id});
   if(generation!==runGeneration||selectedRunId!==id)return;
   if(result.planId!==selectedPlanId)throw new Error('Choose a run belonging to the selected saved plan.');
   run=result;detailKey='';renderDetail();
  })().finally(()=>{if(runRead===active)runRead=null;});
  return active.promise;
 }
 async function savePlan(asNew,submitter){
  if(!form.reportValidity())return;
  const edition=baselineSelected();if(!edition)throw new Error('Choose a READY baseline edition.');
  const selection={name:$('name').value,baselineEditionId:edition.id,expectedBaselineSha256:edition.sha256,
   capture:$('mode').value==='source'?{mode:'source'}:{mode:'window',dateField:$('date-field').value,
    days:Number($('days').value),lagDays:Number($('lag').value),baseFilter:$('base-filter').value},
   comparison:{keyFields:split($('keys').value),measureFields:split($('measures').value)},
   briefing:{title:$('title').value,audience:$('audience').value,notes:$('briefing-notes').value,rowsPerPage:Number($('rows').value)},
   notes:$('notes').value};
  if(!asNew&&selectedPlanId){selection.id=selectedPlanId;selection.expectedRevision=editorRevision;}
  const generation=formGeneration;
  await task(asNew?'Saving a new refresh plan':'Saving refresh plan',async()=>{
   const result=await action('refresh.plans.save',selection,true);
   if(selectedPlanId!==result.id){selectedRunId=null;run=null;detailKey='';}
   selectedPlanId=result.id;plan=result;editorRevision=result.revision;preview=null;
   if(formGeneration===generation)fill(result.definition);
   else{dirty=true;renderEditorState();}
   navigate(result.id,selectedRunId);render();await loadPreview();
  },submitter);
 }
 async function loadPreview(force=false){
  if(!plan){preview=null;renderPreview();return;}
  const asOf=$('as-of').value;if(!asOf)return;
  const key=plan.id+':'+plan.revision+':'+asOf;
  if(!force&&preview?.key===key)return;
  if(previewRead?.key===key)return previewRead.promise;
  const generation=++previewGeneration;
  const input={planId:plan.id,expectedRevision:plan.revision,expectedPlanSha256:plan.sha256,asOf};
  const active={key,promise:null};previewRead=active;
  active.promise=(async()=>{
   const result=await action('refresh.runs.preview',input);
   if(generation!==previewGeneration||selectedPlanId!==input.planId||$('as-of').value!==asOf)return;
   preview={...result,key};renderPreview();availability();
  })().finally(()=>{if(previewRead===active)previewRead=null;});
  return active.promise;
 }
 async function startRun(){
  if(!plan||!preview||dirty||preview.planRevision!==plan.revision||preview.asOf!==$('as-of').value)return;
  const input={planId:plan.id,expectedRevision:plan.revision,expectedPlanSha256:plan.sha256,asOf:preview.asOf};
  await task('Starting the saved refresh',async()=>{
   const result=await action('refresh.runs.start',input,true);run=result;selectedRunId=result.id;detailKey='';
   navigate(plan.id,result.id);render();
  },$('start'));
 }
 async function control(verb){
  if(!run)return;const input={id:run.id,expectedRevision:run.revision};
  await task((verb==='resume'?'Continuing':verb==='pause'?'Pausing':'Cancelling')+' the original refresh',async()=>{
   run=await action('refresh.runs.'+verb,input);detailKey='';renderDetail();
  });
 }
 async function acceptReview(editionId){
  const edition=values(getState()?.editions).find(item=>item.id===editionId&&item.status==='READY');
  if(!run||!edition)return;
  await task('Continuing with the reviewed edition',async()=>{
   run=await action('refresh.runs.review',{id:run.id,expectedRevision:run.revision,editionId:edition.id,expectedEditionSha256:edition.sha256},true);
   detailKey='';renderDetail();
  });
 }
 async function promote(){
  if(!run||!plan)return;
  const input={planId:plan.id,expectedRevision:plan.revision,runId:run.id,expectedRunRevision:run.revision};
  await task('Saving the next baseline',async()=>{
   const result=await action('refresh.baseline.promote',input,true);plan=result;preview=null;
   if(!dirty)fill(result.definition);render();await loadPreview();
  });
 }
 function renderEditorState(){
  $('editor-state').textContent=selectedPlanId?
   'Editing plan revision '+editorRevision+(dirty?' · unsaved changes':' · exact saved rules')+
    (plan&&editorRevision!==plan.revision?' · a newer saved revision is available; reload or save as a new plan.':''):
   'New plan · start from a reviewed READY edition.';
 }
 function renderRules(){
  const edition=baselineSelected(),dates=values(edition?.fields).filter(field=>field.role==='date');
  select('refresh-date-field',dates.length?dates.map(field=>({value:field.source,label:field.label+' · '+field.source})):
   [{value:'',label:'Review a source field as a date first'}],plan?.definition.capture.dateField);
  const rows=values(edition?.fields).map(field=>[field.source,field.name,field.role,field.unit||'—',field.scale,
   field.nullToken===null?'Native null':field.nullToken]);
  $('rules').replaceChildren(edition?el('details',{class:'details'},
   el('summary',{},'Exact baseline field and query rules'),
   readout([['Edition',edition.id],['SHA-256',edition.sha256],['Rows',count(edition.rowCount)]]),
   el('div',{class:'table-wrap'},table(['Original field','Published name','Role','Source unit','Scale','Null marker'],rows)),
   originalDetails('Complete selected fields and query rules',{fields:edition.fields,keyFields:edition.keyFields,
    filters:edition.filters,ranges:edition.ranges,sorts:edition.sorts,defaultLimit:edition.defaultLimit,maxLimit:edition.maxLimit})):
   empty('Build an edition in Review editions, then save its repeatable source and interpretation here.'));
 }
 function renderPreview(){
  const active=values(getState()?.refreshRuns).find(item=>item.planId===selectedPlanId&&!['COMPLETE','CANCELLED'].includes(item.status));
  $('preview').replaceChildren(...(!plan?[empty('Select or save a plan to preview its exact next query.')]:preview?[
   readout([['Saved plan',plan.definition.name+' · revision '+preview.planRevision],
    ['As-of date',preview.asOf],['Captured date window',preview.period.from?preview.period.from+' through '+preview.period.through:'Unchanged saved source query'],
    ['Baseline',preview.baseline.id],['Original source query',preview.sourceUrl]]),
   dirty?el('p',{class:'notice'},'Save or reload the plan edits before starting this saved query.'):null,
   active?el('div',{class:'notice'},'This plan already has a retained '+active.status.toLowerCase().replaceAll('_',' ')+' run. ',
    el('a',{href:'#refresh/'+selectedPlanId+'/'+active.id},'Open and continue that run.')):null
  ].filter(Boolean):[empty('Previewing the saved query…')]));
 }
 function renderHistory(){
  $('history').replaceChildren(plan?el('div',{class:'table-wrap'},table(['Revision','Saved','Change','Baseline edition','Definition SHA-256'],
   plan.versions.slice().reverse().map(version=>[version.revision,stamp(version.at),version.action.replaceAll('_',' '),
    el('a',{href:'#editions/'+version.definition.baseline.id},short(version.definition.baseline.id)),short(version.sha256)]))):
   empty('Plan revisions and explicit baseline promotions appear here.'));
 }
 function refreshButton(label,perform,disabled=false){return button(label,perform,{disabled});}
 function renderDetail(){
  $('run-panel').hidden=!run;
  if(!run)return;
  const state=getState(),key=JSON.stringify([run.id,run.revision,plan?.id,plan?.revision,
   values(state?.editions).filter(item=>item.captureId===run.capture?.id).map(item=>[item.id,item.revision,item.status]),
   values(state?.exports).filter(item=>[run.briefing?.id,run.delivery?.id].includes(item.id))]);
  if(detailKey===key){availability();return;}detailKey=key;
  const terminal=['COMPLETE','CANCELLED'].includes(run.status),reviewPhase=['EDITION','REVIEW'].includes(run.phase);
  const selectedReady=values(state?.editions).filter(item=>item.captureId===run.capture?.id&&item.captureSha256===run.capture?.sha256&&item.status==='READY');
  const nativeEdition=values(state?.editions).find(item=>item.id===run.edition?.id);
  const reviewSelect=el('select',{'aria-label':'Reviewed READY edition for this exact capture'},
   selectedReady.map(item=>el('option',{value:item.id},item.name+' · '+short(item.sha256))));
  if(selectedReady.some(item=>item.id===run.edition?.id))reviewSelect.value=run.edition.id;
  const sourceLinks=[
   run.capture?el('a',{href:'#capture/'+run.capture.id},'Original capture'):null,
   run.edition?el('a',{href:'#editions/'+run.edition.id},'Edition review'):null,
   run.comparison?el('a',{href:'#compare/'+run.comparison.id},'Exact comparison'):null
  ].filter(Boolean);
  const briefing=values(state?.exports).find(item=>item.id===run.briefing?.id&&item.status==='READY'),
   delivery=values(state?.exports).find(item=>item.id===run.delivery?.id&&item.status==='READY');
  const canPromote=run.status==='COMPLETE'&&plan?.id===run.planId&&plan?.revision===run.planRevision&&plan?.sha256===run.planSha256;
  const promoted=plan?.versions.some(version=>version.action==='BASELINE_PROMOTED'&&version.runId===run.id);
  $('detail-heading').textContent=run.name;
  $('run-detail').replaceChildren(...[
   el('div',{class:'refresh-run-status'},badge(run.status),el('span',{class:'muted'},'Phase: '+run.phase.toLowerCase().replaceAll('_',' '))),
   readout([['Plan revision',run.planRevision],['As-of date',run.asOf],['Started',stamp(run.createdAt)],
    ['Completed',stamp(run.completedAt)],['Captured query',run.period.filter||'Complete saved endpoint'],
    ['Baseline edition',run.definition.baseline.id],['Candidate edition',run.edition?.id??'Pending']]),
   run.error?el('div',{class:'notice',role:'status'},run.error.code+': '+run.error.message):null,
   el('div',{class:'button-row'},
    refreshButton('Pause',()=>control('pause'),terminal||run.status==='PAUSED'||run.status==='REVIEW_REQUIRED'),
    refreshButton('Resume original run',()=>control('resume'),terminal||run.phase==='REVIEW'||!['PAUSED','FAILED'].includes(run.status)),
    refreshButton('Cancel run',()=>control('cancel'),terminal)),
   sourceLinks.length?el('div',{class:'downloads section-gap'},sourceLinks):null,
   run.schemaChanges.length?el('section',{class:'section-gap'},
    el('h4',{class:'minor-heading'},'Source schema changes'),
    el('p',{class:'muted'},'Review the actual changed source fields. The saved unit and key rules remain visible beside the original edition.'),
    el('div',{class:'table-wrap'},table(['Source field','Change','Before','Current'],run.schemaChanges.map(item=>[
     item.source,item.change,JSON.stringify(item.before),JSON.stringify(item.after)])))):null,
   !terminal&&reviewPhase&&run.status==='REVIEW_REQUIRED'?el('section',{class:'refresh-review section-gap'},
    el('h4',{class:'minor-heading'},'Review this captured edition'),
    el('p',{},nativeEdition?.status==='READY'?
     'Choose the exact READY edition of this capture after checking its schema, units and row identity.':
     'Open Edition review, save the selected fields and source-unit interpretation, then build the edition. Return here to continue the same run.'),
    selectedReady.length?el('div',{class:'button-row'},reviewSelect,
     refreshButton('Use reviewed edition and continue',()=>acceptReview(reviewSelect.value))):
     empty('No READY edition of this capture is available yet.')):null,
   briefing?el('section',{class:'section-gap'},el('h4',{class:'minor-heading'},'Complete offline briefing'),
    el('p',{class:'muted'},'Extract briefing.tar.gz and open index.html for the full report.'),
    files('export',briefing.id,values(briefing.files).filter(file=>['briefing.tar.gz','briefing.json','briefing.md','dated-measures.csv'].includes(file.name)))):null,
   delivery?el('section',{class:'section-gap'},el('h4',{class:'minor-heading'},'Plan, run and full source handover'),
    files('export',delivery.id,values(delivery.files).filter(file=>['delivery.tar.gz','refresh-plan.json','refresh-run.json','manifest.json'].includes(file.name)))):null,
   run.status==='COMPLETE'?el('section',{class:'refresh-baseline section-gap'},
    el('h4',{class:'minor-heading'},'Choose the next baseline'),
    el('p',{},promoted?'This exact candidate was explicitly promoted; the earlier plan revision is retained.':
     canPromote?'The previous baseline is still selected. Promote this candidate when it should become the next comparison reference.':
     'This run remains bound to its original plan revision. The current plan has changed; its selected baseline is preserved.'),
    refreshButton('Use this edition as next baseline',promote,!canPromote)):null,
   originalDetails('Original saved run and source identities',{id:run.id,planSha256:run.planSha256,period:run.period,source:run.source,
    capture:run.capture,edition:run.edition,review:run.review,comparison:run.comparison,sourceExport:run.sourceExport,
    briefing:run.briefing,delivery:run.delivery,sha256:run.sha256}),
   originalDetails('Retained workflow history',run.events)
  ].filter(Boolean));
  availability();
 }
 function availability(){
  const state=getState(),active=values(state?.refreshRuns).some(item=>item.planId===selectedPlanId&&!['COMPLETE','CANCELLED'].includes(item.status));
  for(const node of root.querySelectorAll('button[data-refresh-disabled]'))node.disabled=busy()||node.dataset.refreshDisabled==='true';
  $('save').disabled=busy()||!baselineSelected();
  $('start').disabled=busy()||dirty||active||!plan||!preview||preview.planRevision!==plan.revision||preview.asOf!==$('as-of').value;
 }
 function render(){
  const state=getState();if(!state)return;
  const ready=values(state.editions).filter(item=>item.status==='READY');
  select('refresh-baseline',ready.length?ready.map(item=>({value:item.id,label:item.name+' · '+short(item.sha256)})):
   [{value:'',label:'Build a reviewed edition first'}],plan?.definition.baseline.id);
  const plans=values(state.refreshPlans),listKey=JSON.stringify([plans,selectedPlanId]);
  if(planListKey!==listKey){planListKey=listKey;
   $('plan-list').replaceChildren(...(plans.length?plans.map(item=>{
    const node=el('button',{type:'button',class:'source-choice','aria-pressed':item.id===selectedPlanId,
     dataset:{refreshDisabled:'false'}},
     el('strong',{},item.name),el('span',{class:'muted'},'Revision '+item.revision+' · '+(item.capture.mode==='window'?item.capture.days+'-day window':'Saved source query')),
     el('span',{class:'muted mono'},'Baseline '+short(item.baseline.id)));
    node.addEventListener('click',()=>navigate(item.id));return node;}):[empty('Save a plan from a READY edition to repeat its source and review workflow.')]));
  }
  const rows=values(state.refreshRuns).filter(item=>item.planId===selectedPlanId),runKey=JSON.stringify([rows,selectedRunId]);
  if(runListKey!==runKey){runListKey=runKey;
   $('run-list').replaceChildren(rows.length?table(['As of','State','Phase','Candidate','Open'],
    rows.map(item=>[item.asOf,badge(item.status),item.phase.toLowerCase(),short(item.edition?.sha256),
     el('a',{href:'#refresh/'+item.planId+'/'+item.id},'Open run')])):empty('This plan has no retained runs yet.'));
  }
  renderEditorState();renderRules();renderHistory();renderPreview();renderDetail();availability();
  const currentPlan=plans.find(item=>item.id===selectedPlanId);
  if(currentPlan&&plan?.revision!==currentPlan.revision&&!planRead)void loadPlan(selectedPlanId).catch(fail);
  const currentRun=rows.find(item=>item.id===selectedRunId);
  if(currentRun&&run?.revision!==currentRun.revision&&!runRead)void loadRun(selectedRunId).catch(fail);
 }
 async function route(planId,runId){
  if(planId!==selectedPlanId){dirty=false;plan=null;run=null;selectedRunId=null;detailKey='';formGeneration++;planGeneration++;runGeneration++;}
  if(!planId){if(selectedPlanId)newPlan();render();return;}
  selectedPlanId=planId;
  if(!plan||plan.id!==planId)await loadPlan(planId);
  if(runId){if(run?.id!==runId)await loadRun(runId);}
  else if(selectedRunId){selectedRunId=null;run=null;runGeneration++;detailKey='';renderDetail();}
  render();
 }
 fill(null);
 return{render,route,availability};
}
