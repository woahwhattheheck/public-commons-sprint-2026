import {COHORT_WORKING_SESSION_MAX_BYTES,COHORT_WORKING_STATE_FIELDS,captureCohortPlanningState,cohortWorkingSessionSha256,createCohortWorkingSession,reopenCohortWorkingSession,describeCohortWorkingState,storeCohortWorkingSnapshots,loadCohortWorkingSnapshots} from './cohort_planning_session.mjs';
import {COHORT_PLAN_SCHEMA, COHORT_PLAN_REPORT_SCHEMA, COHORT_PLAN_COMPARISON_SCHEMA, seedCohortPlan, evaluateCohortPlan, exportCohortPlanCsv, compareCohortPlans, reopenCohortPlanComparison, exportCohortPlanComparisonCsv} from './cohort_planning.mjs';

import {seedCohortPlanFromCalendar} from './cohort_planning_calendar.mjs';
import {COHORT_DELIVERY_SCHEDULE_SCHEMA, seedCohortDeliveryScheduling, scheduleCohortDelivery, reopenCohortDeliverySchedule, exportCohortDeliveryScheduleCsv} from './cohort_planning_scheduling.mjs';

import {COHORT_RECORDED_COST_PLAN_SCHEMA,seedCohortRecordedCostPlan,planCohortFromRecordedCosts,reopenCohortRecordedCostPlan,exportCohortRecordedCostPlanCsv,reopenCohortDeliveryComparison,inspectCohortTaskMeasurements,bindCohortRecordedCostMeasurement} from './cohort_delivery_comparison.mjs';

const EDITION_SCHEMA='stellar-forge.sf47-cohort-plan-edition.v1';
const SESSION_SCHEMA='stellar-forge.sf47-cohort-planning-session.v1';
const sessions=new Map();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=value=>String(value??'').replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const copy=value=>structuredClone(value);
const now=()=>new Date().toISOString();
const uid=prefix=>prefix+'-'+crypto.randomUUID();
const fmt=value=>value===null||value===undefined?'Unspecified':String(value);
const decimal=value=>{if(value===null||value===undefined)return 'Unvalued';const raw=String(value),match=/^(-?)(\d+)(\.\d+)?$/.exec(raw);return match?match[1]+match[2].replace(/\B(?=(\d{3})+(?!\d))/g,',')+(match[3]||''):raw;};
const weekdays=[[1,'Monday'],[2,'Tuesday'],[3,'Wednesday'],[4,'Thursday'],[5,'Friday'],[6,'Saturday'],[7,'Sunday']];
const optional=(rows,placeholder='Unassigned')=>[['',placeholder],...rows];
const classes=[['UNKNOWN','Unassigned'],['INDEPENDENT_OPERATOR','Independent operator'],['CUSTOMER','Customer'],['TEAM_OPERATED','Team operated']];
const environments=[['UNKNOWN','Unassigned'],['LOCAL','Local'],['TESTNET','Testnet'],['MAINNET','Mainnet'],['OTHER','Other']];
const collections=['buyers','merchants','facilitators','operations','schedules','workshares','capacityPools','fundingGroups'];
const metrics=['scheduledTasks','scheduledRequests','plannedPaymentRequests','plannedPaidPurchases','plannedCompleteTasks','plannedCompletePurchases','independentPurchaseOpportunities','allowanceUnits'];
const tabNames=[['setup','Plan & calendar'],['participants','Participants'],['operations','Useful operations'],['schedules','Schedules & prepaid'],['workshares','Workshares & sensitivity'],['capacity','Capacity & pricing'],['recorded-cost','Recorded cost basis'],['scheduling','Schedule delivery'],['funding','Funding groups'],['report','Day & target report'],['compare','Compare plans'],['editions','Saved editions']];
const note=text=>'<p class="cp-note">'+esc(text)+'</p>';
const empty=text=>'<p class="cp-empty">'+esc(text)+'</p>';
const badge=text=>'<span class="cp-badge">'+esc(text)+'</span>';
const btn=(text,action,attrs='',disabled=false)=>'<button type="button" data-cp-action="'+action+'" '+attrs+(disabled?' disabled data-cp-fixed="true"':'')+'>'+esc(text)+'</button>';
const table=(headers,rows,caption='')=>'<div class="cp-table"><table>'+(caption?'<caption>'+esc(caption)+'</caption>':'')+'<thead><tr>'+headers.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const valueHtml=value=>esc(Array.isArray(value)?value.join(', '):fmt(value));
const section=(title,body,actions='')=>'<section class="cp-panel"><div class="cp-heading"><h3>'+esc(title)+'</h3>'+actions+'</div>'+body+'</section>';
const jsonDetail=(title,value)=>'<details class="cp-source-detail"><summary>'+esc(title)+'</summary><pre>'+esc(JSON.stringify(value,null,2))+'</pre></details>';
const cleanName=value=>String(value||'cohort-plan').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,100)||'cohort-plan';
// Access/route failures on a retry do not settle an earlier native write.
const definitive=error=>[400,409,413,422].includes(error?.status)&&typeof error?.code==='string';
function toBase64(raw){let result='';const bytes=new TextEncoder().encode(raw);for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(result);}
function download(raw,filename,mediaType='application/json'){const blob=raw instanceof Blob?raw:new Blob([raw],{type:mediaType+';charset=utf-8'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function field(title,key,value='',options={}){
  const attrs=' data-cp-field="'+esc(key)+'"'+(options.readonly?' readonly':'')+(options.required?' required':'')+(options.attrs?' '+options.attrs:'');
  let input;
  if(options.options)input='<select'+attrs+(options.multiple?' multiple size="'+(options.size||4)+'"':'')+'>'+options.options.map(([id,text])=>'<option value="'+esc(id)+'"'+((options.multiple?(value||[]).map(String).includes(String(id)):String(value??'')===String(id))?' selected':'')+'>'+esc(text)+'</option>').join('')+'</select>';
  else if(options.checkbox)input='<input type="checkbox"'+attrs+(value?' checked':'')+'>';
  else if(options.area)input='<textarea'+attrs+' rows="'+(options.rows||3)+'">'+esc(value??'')+'</textarea>';
  else input='<input type="'+(options.type||'text')+'"'+attrs+' value="'+esc(value??'')+'"'+(options.min!==undefined?' min="'+esc(options.min)+'"':'')+(options.max!==undefined?' max="'+esc(options.max)+'"':'')+(options.step?' step="'+esc(options.step)+'"':'')+(options.placeholder?' placeholder="'+esc(options.placeholder)+'"':'')+'>';
  return '<label class="'+(options.wide?'cp-wide ':'')+(options.checkbox?'cp-check':'')+'">'+(options.checkbox?input+esc(title):esc(title)+input)+(options.help?'<small>'+esc(options.help)+'</small>':'')+'</label>';
}
function dayChecks(key,selected){return '<div class="cp-days">'+weekdays.map(([n,text])=>'<label><input type="checkbox" data-cp-weekday="'+esc(key)+'" value="'+n+'"'+((selected||[]).includes(n)?' checked':'')+'>'+esc(text.slice(0,3))+'</label>').join('')+'</div>';}
function listedDates(value){return (value||[]).map(row=>typeof row==='string'?row:row.date+(row.label?' | '+row.label:'')).join('\n');}
function parseDates(value,withLabels=false){return value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(line=>{const split=line.indexOf('|');const date=(split<0?line:line.slice(0,split)).trim();return withLabels?{date,label:split<0?'':line.slice(split+1).trim()}:date;});}
function listedCapacityDates(rows){return (rows||[]).map(row=>row.date+' | '+(row.availableHours??'')+' | '+(row.label||'')).join('\n');}
function parseCapacityDates(raw){return raw.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{const parts=line.split('|');return {date:parts[0].trim(),availableHours:parts[1]?.trim()||null,label:parts.slice(2).join('|').trim()};});}
function humanMetrics(row){return metrics.map(key=>valueHtml(row?.[key]));}

export function mountCohortPlanning({container,current,saveApi,getActor,mutationId,inform=()=>{},onCaseUpdated=()=>{},incomingCalendar=null,onCalendarReceived=()=>{}}){
  const caseId=current.program.id,prefix='/api/operations/'+caseId,storageKey='sf47.cohort.planning.'+caseId;
  const root=document.createElement('section');root.className='cohort-planning';root.setAttribute('aria-label','Cohort planning');container.replaceChildren(root);
  if(!document.querySelector('link[data-cohort-planning-style]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/operations_cohort_planning.css';link.dataset.cohortPlanningStyle='true';document.head.append(link);}
  let active=true,busy=false,hostBusy=false,caseValue=current;
  let state=sessions.get(caseId);
  if(!state){
    state={schema:SESSION_SCHEMA,caseId,plan:null,report:null,reportInput:'',rowDrafts:{},lastEditorKey:null,selectedDate:'',caseRefreshReceipt:null,latestSeed:null,tranche:2,tab:'setup',editor:null,editorDraft:null,pending:null,accepted:null,inflight:null,priorDrafts:[],parentSourceId:null,savedSourceId:null,savedEnvelope:null,notice:'',error:'',filter:'',pages:{},reportSection:'targets',importText:'',storageWarning:''};
    try{const retained=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(retained?.schema===SESSION_SCHEMA&&retained.caseId===caseId)Object.assign(state,retained,{inflight:null});}catch(error){state.storageWarning='The browser could not reopen the saved planning draft: '+error.message;}
    sessions.set(caseId,state);
  }
  if(incomingCalendar&&!state.incomingCalendar)state.incomingCalendar=copy(incomingCalendar);
  const available=()=>active&&root.isConnected;
  const $=selector=>root.querySelector(selector);
  const plan=()=>state.plan;
  const editorScope=()=>plan()?[plan().draftId,plan().source.programId,plan().source.version,plan().source.planContentSha256].join(':')+'|':'';
  const pendingEditorKey=()=>{const keys=Object.keys(state.rowDrafts||{}).filter(key=>key.startsWith(editorScope()));return keys.includes(state.lastEditorKey)?state.lastEditorKey:keys.at(-1)||null;};
  const isPending=()=>Boolean(state.pending||state.accepted||state.inflight);
  const editable=()=>available()&&!busy&&!hostBusy&&!isPending();
  const rowOptions=kind=>(plan()?.[kind]||[]).map(row=>[row.id,row.label||row.id]);
  const sourceOptions=()=>{const values=new Map();for(const item of [...(state.latestSeed?.sources||[]),...(caseValue.sources||[])])values.set(item.id,item);return [...values.values()].map(item=>[item.id,item.filename+' · '+String(item.sha256||'').slice(0,12)]);};
  const inputMatchesReport=()=>Boolean(state.report&&plan()&&state.reportInput===JSON.stringify(plan()));
  function persist(critical=false){
    const retained={};for(const key of ['recordedCostMeasurementEditor','recordedCostSource','recordedCostBaseline','recordedCostChoices','recordedCostPreview','recordedCostPlan','recordedCostDraft','recordedCostSelectedSource','recordedCostHistory','schema','caseId','plan','report','reportInput','rowDrafts','lastEditorKey','selectedDate','caseRefreshReceipt','latestSeed','tranche','tab','editor','editorDraft','pending','accepted','priorDrafts','parentSourceId','savedSourceId','savedEnvelope','filter','pages','reportSection','importText','incomingCalendar','comparison','comparisonSelections','comparisonHistory','comparisonIncoming','comparisonSavedSourceId','comparisonMetric','schedulingResult','schedulingInput','schedulingEditorId','schedulingOptions','viewedSource','rejected','workingSnapshots','workingHistory','workingIncoming','workingSnapshotIds','workingStorage'])retained[key]=state[key];
    if(state.workingStorage==='INDEXED_DB'){delete retained.workingSnapshots;retained.workingSnapshotIds=Object.keys(state.workingSnapshots||{}).length?Object.keys(state.workingSnapshots):state.workingSnapshotIds||[];}
    try{sessionStorage.setItem(storageKey,JSON.stringify(retained));state.storageWarning='';}catch(error){state.storageWarning='This browser could not retain the latest local draft. Download its JSON before closing this tab.';if(critical)throw new Error('The browser could not retain the exact source request before dispatch. Download the draft or free this site’s session storage, then save again. '+error.message);}
  }
  function controls(){
    root.setAttribute('aria-busy',String(busy||hostBusy||!!state.inflight));
    for(const el of root.querySelectorAll('button,input,textarea,select')){
      const recovery=el.dataset.cpRecovery==='true',view=el.dataset.cpView==='true';
      el.disabled=el.dataset.cpFixed==='true'||busy||hostBusy||Boolean(state.inflight)||Boolean(isPending()&&!recovery&&!view);
      if(el.dataset.cpSave==='true'&&caseValue.program.state!=='OPEN')el.disabled=true;
    }
  }
  function changed(){
    state.error='';state.savedEnvelope=null;persist();
    const status=$('[data-cp-report-state]');if(status)status.textContent=inputMatchesReport()?'Report matches this draft.':'Draft changed. Update the report to calculate these inputs.';
  }
  async function run(fn){
    if(!available()||busy||hostBusy||state.inflight)return;
    busy=true;state.error='';controls();
    try{return await fn();}catch(error){state.error=error.message||String(error);if(available())inform(state.error,true);}
    finally{busy=false;persist();if(available())render();}
  }
  async function refreshSource(selectedTranche=null){
    const next=await saveApi(prefix);
    if(next?.program?.id!==caseId)throw new Error('The returned case differs from the original planning case.');
    const tranche=Number(selectedTranche||plan()?.rule?.target?.tranche||state.tranche);
    const seed=await saveApi(prefix+'/cohort-seed',{expectedVersion:next.program.version,tranche});
    if(seed?.source?.programId!==caseId||seed.source.version!==next.program.version)throw new Error('The cohort seed differs from its original requested case version.');
    caseValue=next;state.latestSeed=seed;state.tranche=tranche;
    return seed;
  }
  function evaluate(){
    if(!plan())throw new Error('Open or create a cohort plan first.');
    const report=evaluateCohortPlan(copy(plan()),{nativeSeed:state.latestSeed?copy(state.latestSeed):undefined});
    state.report=report;state.reportInput=JSON.stringify(plan());persist();return report;
  }
  function rememberPrior(reason){
    if(!plan())return;
    state.priorDrafts.push({id:uid('prior'),retainedAt:now(),reason,plan:copy(plan()),report:state.report?copy(state.report):null,reportInput:state.reportInput,...(state.recordedCostPlan?{recordedCostPlan:copy(state.recordedCostPlan)}:{}),parentSourceId:state.parentSourceId,savedSourceId:state.savedSourceId});
  }
  async function newPlan(tranche=state.tranche){
    const seed=await refreshSource(tranche);rememberPrior('New plan from the current source');
    state.plan=seedCohortPlan(seed,{asOfAt:now(),windowStart:caseValue.program.calendarStart||new Date().toISOString().slice(0,10),name:caseValue.program.name+' · tranche '+state.tranche+' cohort plan',planId:caseValue.program.planId,planRevision:caseValue.program.planRevision,draftId:uid('cohort-plan')});
    state.recordedCostPlan=null;state.parentSourceId=null;state.savedSourceId=null;state.savedEnvelope=null;state.editor=null;state.editorDraft=null;state.pages={};state.tab='setup';
    evaluate();state.notice='Opened a new plan from the current case. Earlier local drafts remain in Saved editions.';
  }
  function sourceFields(row){const options=sourceOptions();for(const id of row.sourceIds||[])if(!options.some(item=>item[0]===id))options.push([id,'Retained source identity · '+id]);return '<fieldset class="cp-wide"><legend>Source identity</legend><div class="cp-fields">'+field('Attached originals','sourceIds',row.sourceIds||[],{options,multiple:true,wide:true})+field('Source reference and estimate basis','sourceNote',row.sourceNote||'',{area:true,wide:true})+'</div></fieldset>';}
  function setPath(target,path,value){const keys=path.split('.');if(keys.some(x=>['__proto__','prototype','constructor'].includes(x)))throw new Error('Unsupported field.');let owner=target;for(const key of keys.slice(0,-1)){if(!owner[key]||typeof owner[key]!=='object')owner[key]={};owner=owner[key];}owner[keys.at(-1)]=value;}
  function readInput(el){
    if(el.type==='checkbox')return el.checked;
    if(el.multiple)return [...el.selectedOptions].map(option=>option.value);
    if(el.dataset.cpFormat==='labeled-dates')return parseDates(el.value,true);
    if(el.dataset.cpFormat==='dates')return parseDates(el.value);
    if(el.dataset.cpFormat==='capacity-dates')return parseCapacityDates(el.value);
    if(el.dataset.cpFormat==='date-allocations')return el.value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{const parts=line.split('|').map(item=>item.trim());return {sourceDate:parts[0],date:parts.slice(1).join('|')};});
    if(el.dataset.cpFormat==='decimal-list')return el.value.split(/[,\n]/).map(value=>value.trim()).filter(Boolean);
    if(el.dataset.cpFormat==='nullable')return el.value.trim()===''?null:el.value.trim();
    if(el.dataset.cpFormat==='nullable-id')return el.value||null;
    if(el.dataset.cpFormat==='integer')return el.value===''?null:Number(el.value);
    return el.value;
  }


  function header(){
    const p=plan(),pending=state.pending,accepted=state.accepted;
    return '<header class="cp-header"><div><p class="cp-eyebrow">Operations · cohort planning</p><h2>Plan a useful cohort</h2><p>'+esc(caseValue.program.name)+' · case version '+caseValue.program.version+'</p></div><div class="cp-actions">'+
      btn('Refresh current source','refresh','data-cp-view="true"')+btn('Update report','evaluate','',!p)+btn('Save new edition','save','data-cp-save="true"',!p||caseValue.program.state!=='OPEN')+(pendingEditorKey()?btn('Resume unfinished row','resume-editor'):'')+'</div></header>'+
      '<div class="cp-status">'+badge('Planning scenario')+(p?badge('Tranche '+p.rule.target.tranche)+badge('Original source v'+p.source.version):'')+(state.savedSourceId?badge('Retained edition'):'')+'</div>'+
      (state.notice?'<p class="cp-notice" role="status">'+esc(state.notice)+'</p>':'')+
      (state.storageWarning?'<p class="cp-alert">'+esc(state.storageWarning)+'</p>':'')+
      (state.error?'<p class="cp-alert" role="alert">'+esc(state.error)+'</p>':'')+(state.latestSeed&&state.latestSeed.source.version!==caseValue.program.version?'<p class="cp-alert">The displayed source comparison was retrieved at case version '+esc(state.latestSeed.source.version)+'. Refresh current source to compare the latest case version.</p>':'')+
      (p?'<p class="cp-report-state" data-cp-report-state>'+esc(inputMatchesReport()?'Report matches this draft.':'Draft changed. Update the report to calculate these inputs.')+'</p>':'')+
      (state.incomingCalendar?'<aside class="cp-recovery"><h3>Received customer-use calendar</h3><p>The complete selected Installation editions and native Cohort seed are retained for an editable adoption plan.</p>'+btn('Open calendar as new plan','receive-calendar')+'</aside>':'')+
      (pending?'<aside class="cp-recovery"><h3>Original save awaiting its result</h3><p>The exact source attachment request is retained for case version '+esc(pending.payload.expectedVersion)+'. Continue it to recover the original receipt.</p><code>'+esc(pending.payload.requestId)+'</code><div class="cp-actions">'+btn('Continue original save','retry','data-cp-recovery="true"')+btn('Download retained request','pending-export','data-cp-recovery="true"')+'</div></aside>':'')+
      (accepted||state.caseRefreshReceipt?'<aside class="cp-recovery"><h3>Edition accepted</h3><p>Read back the original source file to finish this save.</p>'+btn('Read back saved source','readback','data-cp-recovery="true"')+'</aside>':'')+
      (p&&p.source.programId!==caseId?'<p class="cp-alert">This imported plan belongs to '+esc(p.source.programId)+'. Its original source and report are available here. Open that original case to attach an edition.</p>':'');
  }
  function navigation(){return '<nav class="cp-tabs" aria-label="Cohort planning sections">'+tabNames.map(([key,title])=>btn(title,'tab','data-tab="'+key+'" data-cp-view="true" aria-current="'+(key===state.tab?'page':'false')+'"',!plan()&&!['setup','editions','compare'].includes(key))).join('')+'</nav>';}
  function sourceComparison(report=state.report){
    const comparison=report?.sourceComparison;
    if(!comparison)return note('Update the report to compare this retained plan with the current native cohort source.');
    const different=comparison.status==='CHANGED';
    return '<div class="'+(different?'cp-source-change':'cp-source-status')+'"><h4>'+esc(different?'The current source has changed':comparison.status==='MATCH'?'Source matches the current case':'Original source retained')+'</h4>'+
      note(different?'This plan continues to use its saved case identity and proposed rule. “Rebase on current source” creates a revised draft and retains this version in Saved editions.':comparison.status==='MATCH'?'The plan and the latest retrieved cohort seed use the same source identity and rule.':'The calculation uses the source and rule stored with the plan.')+
      (comparison.fields?.length?table(['Source field','Plan','Current'],comparison.fields.map(row=>[esc(label(row.key)),valueHtml(row.planned),valueHtml(row.current)])):'')+
      (different&&plan()?.source?.programId===caseId?btn('Rebase on current source','rebase'):'')+'</div>';
  }
  function setup(){
    if(!plan())return section('Open a cohort plan',note('Seed a plan from the original Operations case and its proposed tranche window. Named participants and estimates remain editable.')+
      '<div class="cp-fields">'+field('Proposed tranche for a new plan','newTranche',state.tranche,{options:[[2,'Tranche 2 · testnet'],[3,'Tranche 3 · mainnet']]})+'</div><div class="cp-actions">'+btn('Create plan from current source','new')+btn('Import plan or report JSON','import-json')+'</div>');
    const p=plan(),rule=p.rule,calendar=p.calendar||state.report?.input?.calendar||{weekdays:[1,2,3,4,5],excludedDates:[]};
    const detail=section('Plan and original window','<form data-cp-plan><div class="cp-fields">'+
      field('Plan name','name',p.name,{wide:true,required:true})+
      field('First UTC calendar day','windowStart',p.windowStart,{type:'date',required:true,help:'The original proposed rule supplies the full '+rule.target.proposed_window.consecutive_calendar_days+' calendar day window.'})+
      field('Planning cutoff (UTC timestamp)','asOfAt',p.asOfAt,{required:true,help:'Use an explicit timestamp with UTC or a timezone offset.'})+
      '<fieldset class="cp-wide"><legend>Working weekdays</legend>'+dayChecks('calendar.weekdays',calendar.weekdays)+note('Each schedule intersects this working calendar. The complete rule window, including weekends and exclusions, stays in the day report.')+'</fieldset>'+
      field('Calendar exclusions','calendar.excludedDates',listedDates(calendar.excludedDates),{area:true,wide:true,attrs:'data-cp-format="labeled-dates"',help:'One YYYY-MM-DD per line. Add an optional label after |, for example 2026-10-15 | Operator unavailable.'})+
      field('Plan note and assumptions','note',p.note,{area:true,wide:true,rows:4})+'</div></form>');
    const proposed=section('Original proposed targets',note(rule.target.outcome||'Original retained deployment acceptance proposal')+
      table(['Original target','Required'],Object.entries(rule.target.target_counts||{}).map(([key,value])=>[esc(label(key)),valueHtml(value)]))+
      note(rule.relationToBudget||'')+note(rule.target.required_work||'')+
      jsonDetail('Original rule, unchanged',rule));
    const source=section('Source and editions',sourceComparison()+
      '<p class="cp-identity">Case '+esc(p.source.programId)+' · plan '+esc(p.source.planId||caseValue.program.planId)+' · revision '+esc(p.source.planRevision??caseValue.program.planRevision)+'<br>Plan content '+esc(p.source.planContentSha256)+'</p>'+
      '<div class="cp-fields">'+field('Tranche for a fresh plan','newTranche',state.tranche,{options:[[2,'Tranche 2 · testnet'],[3,'Tranche 3 · mainnet']]})+'</div>'+
      '<div class="cp-actions">'+btn('New plan from current source','new')+btn('Import plan or report JSON','import-json')+'</div>'+
      note('A fresh plan or explicit rebase retains the previous local draft. Saving attaches a new immutable JSON edition to this case; the original source records remain addressable.'));
    return detail+proposed+source;
  }
  function filteredRows(kind){
    const all=plan()?.[kind]||[],needle=state.filter.toLowerCase();
    const filtered=all.filter(row=>!needle||[row.label,row.id,row.operatorId,row.scope,row.note].some(value=>String(value||'').toLowerCase().includes(needle)));
    const pages=Math.max(1,Math.ceil(filtered.length/20)),page=Math.min(state.pages[kind]||0,pages-1);state.pages[kind]=page;
    return {all,filtered,rows:filtered.slice(page*20,page*20+20),page,pages};
  }
  function pager(kind,data){return data.filtered.length>20?'<div class="cp-pager">'+btn('Previous','page','data-kind="'+kind+'" data-page="'+(data.page-1)+'"',data.page===0)+'<span>'+((data.page*20)+1)+'–'+Math.min((data.page+1)*20,data.filtered.length)+' of '+data.filtered.length+'</span>'+btn('Next','page','data-kind="'+kind+'" data-page="'+(data.page+1)+'"',data.page>=data.pages-1)+'</div>':'';}
  function rowActions(kind,row){return '<div class="cp-row-actions">'+btn('Edit','edit','data-kind="'+kind+'" data-id="'+esc(row.id)+'"')+btn('Copy','copy-row','data-kind="'+kind+'" data-id="'+esc(row.id)+'"')+'</div>';}
  function collectionPanel(kind,description){
    const data=filteredRows(kind),title=label(kind);
    let headers,rows;
    if(['buyers','merchants','facilitators'].includes(kind)){
      headers=['Name / original identity','Operator','Class','Environment / service',''];
      rows=data.rows.map(row=>['<strong>'+esc(row.label)+'</strong><small>'+esc(row.deploymentId||row.id)+'</small>',esc(row.operatorId||'Unassigned'),esc(label(row.participantClass)),esc(kind==='facilitators'?row.serviceUrl||'Unassigned':label(row.environment)),rowActions(kind,row)]);
    }else if(kind==='operations'){
      headers=['Useful operation','Merchant','Expected output','Source period',''];
      rows=data.rows.map(row=>['<strong>'+esc(row.label)+'</strong><small>'+esc(row.scope)+'</small>',esc(((plan().merchants||[]).find(x=>x.id===row.merchantId)||{}).label||row.merchantId||'Unassigned'),esc(row.expectedOutput),esc(row.sourcePeriod),rowActions(kind,row)]);
    }else if(kind==='schedules'){
      headers=['Schedule','Buyer / operation','Cadence','Useful tasks × requests','Payment',''];
      rows=data.rows.map(row=>['<strong>'+esc(row.label)+'</strong><small>'+esc(row.timeUtc)+' UTC</small>',esc(((plan().buyers||[]).find(x=>x.id===row.buyerId)||{}).label||row.buyerId)+'<small>'+esc(((plan().operations||[]).find(x=>x.id===row.operationId)||{}).label||row.operationId)+'</small>',esc(cadenceLabel(row.cadence)),esc(row.tasksPerDate)+' × '+esc(row.requestsPerTask),esc(label(row.payment.kind))+(row.payment.kind==='PREPAID'?'<small>'+esc(row.payment.passCapacity)+' units / pass · '+esc(row.payment.passGroupId||'Separate pass group')+'</small>':''),rowActions(kind,row)]);
    }else if(kind==='fundingGroups'){
      headers=['Original funding group','Buyer / operation','Settlement date / kind','Atomic terms','Currency value / fee',''];
      rows=data.rows.map(row=>['<strong>'+esc(row.label)+'</strong><small>'+esc(row.origin?row.origin.installationId+' @'+row.origin.revision+' / '+row.origin.fundingId:row.id)+'</small>',
        esc((plan().buyers||[]).find(item=>item.id===row.buyerId)?.label||row.buyerId)+'<small>'+esc((plan().operations||[]).find(item=>item.id===row.operationId)?.label||row.operationId)+'</small>',
        esc(row.date)+'<small>'+esc(row.kind)+'</small>',esc(row.atomicUnitPrice??'Unpriced')+'<small>'+esc([row.network,row.asset].filter(Boolean).join(' · ')||'Network and asset unspecified')+'</small>',
        esc(row.economics?.currency||'Unvalued')+'<small>'+esc(decimal(row.economics?.unitRevenue))+' / '+esc(decimal(row.economics?.feePerPayment))+'</small>',rowActions(kind,row)]);
    }else if(kind==='capacityPools'){
      headers=['Delivery pool','Weekday active hours','Date overrides','Source basis',''];
      rows=data.rows.map(row=>['<strong>'+esc(row.label)+'</strong><small>'+esc(row.id)+'</small>',esc(weekdays.map(([day,name])=>name.slice(0,3)+': '+fmt(row.hoursByWeekday?.[day])).join(' · ')),esc(listedCapacityDates(row.dateOverrides)),esc(row.sourceNote),rowActions(kind,row)]);
    }else{
      headers=['Workshare','Fee / currency','Hours / hourly cost','Other costs',''];
      rows=data.rows.map(row=>['<strong>'+esc(row.label)+'</strong><small>'+esc(row.id)+'</small>',esc(decimal(row.fee))+' '+esc(row.currency),esc(decimal(row.hours))+' / '+esc(decimal(row.hourlyCost)),esc(decimal(row.otherCosts)),rowActions(kind,row)]);
    }
    return section(title,note(description)+(rows.length?table(headers,rows)+pager(kind,data):empty(data.all.length?'No rows match the filter.':'Add the first '+title.toLowerCase()+' row to this plan.')),btn('Add '+({buyers:'buyer',merchants:'merchant',facilitators:'facilitator',operations:'operation',schedules:'schedule',workshares:'workshare',capacityPools:'delivery pool',fundingGroups:'funding group'}[kind]),'edit','data-kind="'+kind+'"'));
  }
  function filterBar(){return '<div class="cp-filter"><label>Find a named row<input type="search" data-cp-filter value="'+esc(state.filter)+'" placeholder="Name, operator, identity, or scope"></label>'+btn('Apply filter','filter')+(state.filter?btn('Clear','filter-clear'):'')+'</div>';}
  function participants(){return filterBar()+collectionPanel('buyers','Name the buyer and retain its operator identity. Independent operator counts use the explicit participant class and operator ID.')+collectionPanel('merchants','Keep each merchant connected to its original deployment when one exists.')+collectionPanel('facilitators','Name the actual facilitator service and operator. Multiple service identities belonging to one operator stay grouped.');}
  function operations(){return filterBar()+collectionPanel('operations','Define the buyer problem, bounded scope, expected output, and source period. Schedules reference these useful operations by their retained IDs.');}
  function schedules(){return filterBar()+collectionPanel('schedules','Schedule useful tasks for a named buyer and operation. Configure recurrence, UTC time, delivery delay, prepaid allowance, and per payment / request / task economics inside each row.')+
    section('Prepaid grouping',note('A prepaid pass pays once for a defined capacity. Underlying requests consume allowance units. Use the same pass group ID only for schedules intended to share a buyer, merchant, asset, network, and compatible pass terms. The report shows new passes, remaining active units, and unused units retained from earlier passes.'));}

  function fundingSetup(){
    const source=plan().calendarSource;
    return filterBar()+collectionPanel('fundingGroups','Each named DIRECT or PREPAID settlement funds its linked useful results once. Enter its commercial terms here and delivery effort on Schedules. An unpriced group stays visible in target planning; a group settled before the window supplies existing funding.')+
      (source?section('Received original calendar',note('Selected native window '+source.groupId+' · original case '+source.selection.source.caseId+' version '+source.selection.source.caseVersion)+
        '<div class="cp-actions">'+btn('Download original calendar','calendar-original','data-cp-view="true"')+btn('Download matching native seed','calendar-seed','data-cp-view="true"')+'</div>'+
        jsonDetail('Complete selected original calendar and received records',source.selection)+jsonDetail('Original Customer-use Cohort seed',source.cohortSeed)):'')+
      (state.report?fundingReport(state.report):note('Update the report to inspect each funding group and its first useful result.'));
  }
  function fundingReport(report){
    const rows=report.fundingGroups||[];
    return section('Explicit funding and useful results',note('Funding counts once at its first whole useful-result date. Dated uses retain their workload separately. Currency costs include each useful result once even when several groups fund it.')+
      (rows.length?table(['Funding / original edition','Kind / settlement date','First whole result','Useful tasks / new settlements','Paid / unpriced','Original terms / currency','Status'],rows.map(row=>[
        esc(row.label)+'<small>'+esc(row.origin?row.origin.installationId+' @'+row.origin.revision+' / '+row.origin.fundingId:row.id)+'</small>',
        esc(row.kind)+'<small>'+esc(row.date)+'</small>',esc(row.firstUsefulResultAt||'No active use'),valueHtml(row.scheduledTasks)+' / '+valueHtml(row.plannedPaymentRequests),
        valueHtml(row.plannedPaidPurchases)+' / '+valueHtml(row.unpricedPaymentRequests),esc(row.atomicUnitPrice??'Unpriced')+'<small>'+esc([row.network,row.asset].filter(Boolean).join(' · '))+'</small>'+
        '<small>'+esc(row.economics?.currency||'Unvalued')+' · revenue '+esc(decimal(row.economics?.revenue))+' · fee '+esc(decimal(row.economics?.paymentFees))+'</small>',esc(label(row.status))
      ])):empty('No explicit funding groups are selected. Recurring per-request and allowance schedules remain in their original report sections.')));
  }

  function workshares(){
    return filterBar()+collectionPanel('workshares','Price an actual service package with its delivery hours, hourly cost, and other costs. Blank monetary values stay unvalued in the report.')+
      section('Sensitivity assumptions','<form data-cp-plan><div class="cp-fields">'+
        field('Effort increases (%)','sensitivity.effortIncreasesPct',(plan().sensitivity?.effortIncreasesPct||['0','20','25']).join(', '),{attrs:'data-cp-format="decimal-list"',help:'Comma separated decimal percentages, for example 0, 20, 25.'})+
        field('Completion shares (%)','sensitivity.completionSharesPct',(plan().sensitivity?.completionSharesPct||['100','90','75']).join(', '),{attrs:'data-cp-format="decimal-list"',help:'Comma separated percentages. Whole completed purchase estimates round down; required opportunities round up.'})+'</div></form>');
  }
  function capacitySetup(){
    return filterBar()+collectionPanel('capacityPools','Name shared delivery capacity once. Enter active staff hours for each weekday and exact date overrides. Assign recurring schedules to that pool; the report combines their effort on every UTC date.')+
      section('Service price planning','<form data-cp-plan><div class="cp-fields">'+
        field('Selected minimum service margin (%)','sensitivity.minimumMarginPct',plan().sensitivity?.minimumMarginPct,{attrs:'data-cp-format="nullable" inputmode="decimal"',help:'Optional percentage below 100. The report calculates a currency value per newly charged request or acquired pass using complete supplier, fee and labor costs.'})+'</div></form>'+
        note('The available hours describe the people or operating resources named by the pool source. A date override replaces that date’s weekday hours. Blank effort or availability remains unspecified; zero is an explicit zero.'))+
      (state.report?capacityReport(state.report)+servicePricingReport(state.report):note('Update the report after assigning schedules and entering their active hours per useful task.'));
  }
  function cadenceLabel(value){if(value.kind==='EVERY_N_DAYS')return 'Every '+value.intervalDays+' days from '+value.anchorDate;if(value.kind==='EXPLICIT_DATES')return value.dates.length+' explicit dates';return (value.weekdays||[]).map(day=>weekdays.find(x=>x[0]===day)?.[1].slice(0,3)||day).join(', ');}


  function blankRow(kind){
    const id=uid(kind.replace(/s$/,''));
    if(['buyers','merchants'].includes(kind))return {id,label:'New '+(kind==='buyers'?'buyer':'merchant'),operatorId:'',participantClass:'UNKNOWN',environment:'UNKNOWN',deploymentId:null,sourceIds:[],sourceNote:''};
    if(kind==='facilitators')return {id,label:'New facilitator',operatorId:'',participantClass:'UNKNOWN',serviceUrl:'',sourceIds:[],sourceNote:''};
    if(kind==='operations')return {id,label:'New useful operation',merchantId:(plan().merchants||[])[0]?.id||'',scope:'',expectedOutput:'',sourcePeriod:'',sourceIds:[],sourceNote:''};
    if(kind==='fundingGroups')return {id,label:'New funding group',kind:'DIRECT',date:plan().windowStart,buyerId:plan().buyers[0]?.id||'',operationId:plan().operations[0]?.id||'',facilitatorId:null,atomicUnitPrice:null,network:'',asset:'',economics:null,origin:null,sourceIds:[],sourceNote:''};
    if(kind==='capacityPools')return {id,label:'New delivery pool',hoursByWeekday:Object.fromEntries(weekdays.map(([day])=>[day,null])),dateOverrides:[],sourceIds:[],sourceNote:''};
    if(kind==='schedules')return {id,label:'New schedule',operationId:(plan().operations||[])[0]?.id||'',buyerId:(plan().buyers||[])[0]?.id||'',facilitatorId:null,capacityPoolId:null,cadence:{kind:'WEEKDAYS',weekdays:[1,2,3,4,5]},tasksPerDate:1,requestsPerTask:1,timeUtc:'12:00',deliveryDelayMinutes:0,excludedDates:[],payment:{kind:'PER_REQUEST',atomicUnitPrice:'0',network:plan().rule.target.tranche===2?'stellar:testnet':'stellar:pubnet',asset:'USDC'},economics:null,note:''};
    return {id,label:'New workshare',currency:'USD',fee:null,hours:null,hourlyCost:null,otherCosts:null,sourceIds:[],sourceNote:''};
  }
  function openEditor(kind,id=null,duplicate=false){
    if(!collections.includes(kind))throw new Error('Select a supported planning row.');
    const found=id?(plan()[kind]||[]).find(row=>row.id===id):null;
    if(id&&!found)throw new Error('The selected original row is no longer in this draft.');
    const row=found?copy(found):blankRow(kind);
    if(duplicate){row.id=uid(kind.replace(/s$/,''));row.label+=' · copy';if(row.origin)row.origin=null;}
    const key=editorScope()+kind+':'+row.id,retained=!duplicate&&id?state.rowDrafts[key]:null;
    state.editor=retained?copy(retained.editor):{kind,id:duplicate?null:id,key,variants:{cadence:{},payment:{},economics:null}};
    state.editorDraft=retained?copy(retained.data):row;state.editorError='';state.lastEditorKey=key;state.rowDrafts[key]={editor:copy(state.editor),data:copy(state.editorDraft)};persist();
  }
  function namedOptions(kind,selected,blank='Unassigned'){const options=rowOptions(kind);if(selected&&!options.some(row=>row[0]===selected))options.push([selected,'Retained identity · '+selected]);return optional(options,blank);}
  function participantFields(kind,row){
    const native=state.latestSeed?.inventory?.deployments||[];
    const deploymentRows=native.filter(item=>kind==='buyers'?['BUYER','BOTH'].includes(item.role):['MERCHANT','BOTH'].includes(item.role)).map(item=>[item.id,item.name+' · '+item.operator+' · '+label(item.participantClass)]);
    if(row.deploymentId&&!deploymentRows.some(item=>item[0]===row.deploymentId))deploymentRows.push([row.deploymentId,'Retained identity · '+row.deploymentId]);
    return field('Name','label',row.label,{required:true,wide:true})+
      field('Operator identity','operatorId',row.operatorId,{help:'Use one stable ID for the same person or organization across all its deployments and services.'})+
      field('Participant class','participantClass',row.participantClass,{options:classes})+
      (kind==='facilitators'?field('Facilitator service URL','serviceUrl',row.serviceUrl,{wide:true}):
        field('Environment','environment',row.environment,{options:environments})+
        field('Original native deployment','deploymentId',row.deploymentId,{options:optional(deploymentRows,'Planned identity — no deployment selected'),attrs:'data-cp-format="nullable-id"'}))+
      sourceFields(row);
  }
  function operationFields(row){return field('Useful operation name','label',row.label,{wide:true,required:true})+
    field('Merchant','merchantId',row.merchantId,{options:namedOptions('merchants',row.merchantId),wide:true})+
    field('Buyer problem and scope','scope',row.scope,{area:true,wide:true,help:'Describe the useful work the buyer needs completed.'})+
    field('Expected delivered output','expectedOutput',row.expectedOutput,{area:true,wide:true,help:'Describe the complete output of one useful task; the schedule supplies the required underlying request count.'})+
    field('Source period','sourcePeriod',row.sourcePeriod,{wide:true,help:'Retain the exact period the source material covers, when relevant.'})+sourceFields(row);}
  function scheduleFields(row){
    const c=row.cadence,p=row.payment;
    const recurrence=field('Recurrence','cadence.kind',c.kind,{options:[['WEEKDAYS','Selected weekdays'],['EVERY_N_DAYS','Every N calendar days'],['EXPLICIT_DATES','Explicit dates']],attrs:'data-cp-control="cadence"'})+
      (c.kind==='WEEKDAYS'?'<fieldset><legend>Schedule weekdays</legend>'+dayChecks('cadence.weekdays',c.weekdays)+'</fieldset>':c.kind==='EVERY_N_DAYS'?
        field('Interval in calendar days','cadence.intervalDays',c.intervalDays,{type:'number',min:1,step:'1',attrs:'data-cp-format="integer"'})+field('Anchor date','cadence.anchorDate',c.anchorDate,{type:'date'}):
        field('Scheduled dates','cadence.dates',listedDates(c.dates),{area:true,wide:true,attrs:'data-cp-format="dates"',help:'One YYYY-MM-DD per line; dates intersect the retained rule window and working calendar.'}));
    const payment=field('Payment mode','payment.kind',p.kind,{options:[['PER_REQUEST','Per underlying request'],['PREPAID','Prepaid pass'],['UNPAID','Unpaid task'],['FUNDED','Named funding groups']],attrs:'data-cp-control="payment"'})+
      (p.kind==='FUNDED'?field('Original funding groups','fundingGroupIds',row.fundingGroupIds||[],{options:rowOptions('fundingGroups'),multiple:true,wide:true,help:'Select the same buyer and merchant. Commercial terms belong to the selected groups.'}):field(p.kind==='PREPAID'?'Atomic price per new pass':'Atomic price per payment','payment.atomicUnitPrice',p.atomicUnitPrice,{attrs:'inputmode="numeric"',help:'Integer base units in the native asset. USD estimates are entered separately below.'})+
      field('Network','payment.network',p.network,{help:'Retain the exact network identifier used by the planned deployment.'})+
      field('Asset','payment.asset',p.asset))+
      (p.kind==='FUNDED'?note('Each named group supplies one settlement across all its linked useful results. Enter per-task effort and supplier cost below.'):'')+
      (p.kind==='PREPAID'?field('Allowance capacity per pass','payment.passCapacity',p.passCapacity,{type:'number',min:1,step:'1',attrs:'data-cp-format="integer"'})+
        field('Opening allowance units','payment.openingUnits',p.openingUnits,{type:'number',min:0,step:'1',attrs:'data-cp-format="integer"'})+
        field('Allowance units per request','payment.allowanceUnitsPerRequest',p.allowanceUnitsPerRequest,{type:'number',min:1,step:'1',attrs:'data-cp-format="integer"'})+
        field('Shared pass group ID','payment.passGroupId',p.passGroupId,{attrs:'data-cp-format="nullable-id"',help:'Blank keeps a separate pass group for this schedule. Reuse a group only for compatible terms and the same buyer / merchant.'}):'');
    const e=row.economics;
    return field('Schedule name','label',row.label,{wide:true,required:true})+
      field('Useful operation','operationId',row.operationId,{options:namedOptions('operations',row.operationId)})+
      field('Buyer','buyerId',row.buyerId,{options:namedOptions('buyers',row.buyerId)})+
      field('Facilitator','facilitatorId',row.facilitatorId,{options:namedOptions('facilitators',row.facilitatorId,'No facilitator selected'),attrs:'data-cp-format="nullable-id"'})+
      field('Scheduled time (UTC)','timeUtc',row.timeUtc,{type:'time',step:'60'})+
      '<fieldset class="cp-wide"><legend>Calendar and workload</legend><div class="cp-fields">'+recurrence+
        field('Reviewed date allocations','dateAllocations',(row.dateAllocations||[]).map(item=>item.sourceDate+' | '+item.date).join('\n'),{area:true,wide:true,attrs:'data-cp-format="date-allocations"',help:'One original cadence date | allocated date per line. Blank restores the original dates. Both complete occurrences remain when dates coincide.'})+
        field('Useful tasks per scheduled date','tasksPerDate',row.tasksPerDate,{type:'number',min:0,step:'1',attrs:'data-cp-format="integer"'})+
        field('Underlying requests per useful task','requestsPerTask',row.requestsPerTask,{type:'number',min:1,step:'1',attrs:'data-cp-format="integer"'})+
        field('Shared delivery pool','capacityPoolId',row.capacityPoolId,{options:namedOptions('capacityPools',row.capacityPoolId,'Unassigned delivery capacity'),attrs:'data-cp-format="nullable-id"',help:'Assigned schedules share the same pool’s daily active hours. Set task effort in the estimates below.'})+
        field('Completion delay (minutes)','deliveryDelayMinutes',row.deliveryDelayMinutes,{type:'number',min:0,step:'1',attrs:'data-cp-format="integer"',help:'Completion after the final UTC calendar day is shown separately in the report.'})+
        field('Schedule exclusions','excludedDates',listedDates(row.excludedDates),{area:true,wide:true,attrs:'data-cp-format="labeled-dates"',help:'One date per line, optionally followed by | and a reason.'})+'</div></fieldset>'+
      '<fieldset class="cp-wide"><legend>Payments and allowance</legend><div class="cp-fields">'+payment+'</div></fieldset>'+
      '<fieldset class="cp-wide"><legend>Cost and revenue estimates</legend><label class="cp-check"><input type="checkbox" data-cp-control="economics"'+(e?' checked':'')+'>Include financial and active labor estimates</label>'+
      (e?'<div class="cp-fields">'+field('Estimate currency','economics.currency',e.currency,{help:'Keep currencies separate. The engine does not invent an exchange rate.'})+
        (p.kind==='FUNDED'?'':field('Revenue per payment / new pass','economics.unitRevenue',e.unitRevenue,{attrs:'data-cp-format="nullable" inputmode="decimal"',help:'Blank means unvalued. A prepaid pass contributes revenue only when a new pass is planned.'}))+
        field('Supplier cost per underlying request','economics.unitCost',e.unitCost,{attrs:'data-cp-format="nullable" inputmode="decimal"'})+
        (p.kind==='FUNDED'?'':field('Fee per payment / new pass','economics.feePerPayment',e.feePerPayment,{attrs:'data-cp-format="nullable" inputmode="decimal"'}))+
        field('Active hours per useful task','economics.activeHoursPerTask',e.activeHoursPerTask,{attrs:'data-cp-format="nullable" inputmode="decimal"'})+
        field('Hourly labor cost','economics.hourlyCost',e.hourlyCost,{attrs:'data-cp-format="nullable" inputmode="decimal"'})+'</div>':note('Task volume, payments, and native asset quantities remain in the report. Enable estimates to value this schedule in a named currency.'))+'</fieldset>'+
      field('Schedule note','note',row.note,{area:true,wide:true});
  }

  function fundingFields(row){
    const e=row.economics;
    return field('Funding group name','label',row.label,{wide:true,required:true})+
      field('Original settlement kind','kind',row.kind,{options:[['DIRECT','Direct settlement'],['PREPAID','Prepaid funding']]})+
      field('Settlement date','date',row.date,{type:'date'})+
      field('Buyer','buyerId',row.buyerId,{options:namedOptions('buyers',row.buyerId)})+
      field('Original purchased operation','operationId',row.operationId,{options:namedOptions('operations',row.operationId)})+
      field('Settlement facilitator','facilitatorId',row.facilitatorId,{options:namedOptions('facilitators',row.facilitatorId),attrs:'data-cp-format="nullable-id"'})+
      field('Atomic price for this funding group','atomicUnitPrice',row.atomicUnitPrice,{attrs:'data-cp-format="nullable" inputmode="numeric"',help:'Blank remains unpriced; enter 0 only for an explicit zero native price.'})+
      field('Network','network',row.network)+field('Asset','asset',row.asset)+
      '<fieldset class="cp-wide"><legend>Funding revenue and payment fee</legend><label class="cp-check"><input type="checkbox" data-cp-control="funding-economics"'+(e?' checked':'')+'>Enter currency estimates</label>'+
      (e?'<div class="cp-fields">'+field('Estimate currency','economics.currency',e.currency)+
        field('Revenue for this settlement','economics.unitRevenue',e.unitRevenue,{attrs:'data-cp-format="nullable" inputmode="decimal"'})+
        field('Fee for this settlement','economics.feePerPayment',e.feePerPayment,{attrs:'data-cp-format="nullable" inputmode="decimal"'})+'</div>':note('Enter active effort, supplier cost and labor cost on the linked useful task schedules.'))+'</fieldset>'+
      sourceFields(row)+(row.origin?jsonDetail('Original immutable Installation reference',row.origin):'');
  }

  function capacityFields(row){return field('Delivery pool name','label',row.label,{required:true,wide:true})+
    '<fieldset class="cp-wide"><legend>Available active hours by weekday</legend><div class="cp-fields">'+weekdays.map(([day,name])=>field(name+' hours','hoursByWeekday.'+day,row.hoursByWeekday?.[day],{attrs:'data-cp-format="nullable" inputmode="decimal"'})).join('')+'</div></fieldset>'+
    field('Date availability overrides','dateOverrides',listedCapacityDates(row.dateOverrides),{area:true,wide:true,attrs:'data-cp-format="capacity-dates"',help:'One date | available hours | reason per line. Use 0 for closure; a blank hour value is unspecified.'})+sourceFields(row);}
  function workshareFields(row){return field('Workshare name','label',row.label,{required:true,wide:true})+
    field('Currency','currency',row.currency)+field('Flat fee','fee',row.fee,{attrs:'data-cp-format="nullable" inputmode="decimal"'})+
    field('Planned active hours','hours',row.hours,{attrs:'data-cp-format="nullable" inputmode="decimal"'})+
    field('Hourly labor cost','hourlyCost',row.hourlyCost,{attrs:'data-cp-format="nullable" inputmode="decimal"'})+
    field('Other delivery costs','otherCosts',row.otherCosts,{attrs:'data-cp-format="nullable" inputmode="decimal"',help:'Blank means unvalued. Enter zero when an explicit zero estimate is intended.'})+sourceFields(row);}
  function editor(){
    if(!state.editor)return '';
    const {kind,id}=state.editor,row=state.editorDraft;
    const body=['buyers','merchants','facilitators'].includes(kind)?participantFields(kind,row):kind==='operations'?operationFields(row):kind==='schedules'?scheduleFields(row):kind==='capacityPools'?capacityFields(row):kind==='fundingGroups'?fundingFields(row):workshareFields(row);
    return '<dialog class="cp-dialog" aria-labelledby="cp-editor-title"><form data-cp-editor><header class="cp-heading"><div><p class="cp-eyebrow">'+esc(label(kind))+'</p><h3 id="cp-editor-title">'+esc(id?'Edit '+row.label:'Add '+row.label)+'</h3></div>'+btn('Close','editor-close')+'</header>'+
      '<p class="cp-identity">Planning row '+esc(row.id)+'</p><div class="cp-fields">'+body+'</div>'+(kind==='schedules'&&row.origin?jsonDetail('Original calendar entry',row.origin):'')+
      '<div class="cp-dialog-error" role="alert">'+esc(state.editorError||'')+'</div><footer class="cp-dialog-actions">'+(id?btn('Remove row','row-remove','class="cp-remove"'):'')+btn('Keep draft & close','editor-close')+'<button type="submit">Keep row</button></footer></form></dialog>';
  }
  function commitEditor(){
    const {kind,id,key}=state.editor,row=copy(state.editorDraft);
    if(!String(row.label||'').trim())throw new Error('Give this row a usable name.');
    if(!plan()[kind])plan()[kind]=[];
    if(id){const index=plan()[kind].findIndex(value=>value.id===id);if(index<0)throw new Error('The original row is no longer in this plan.');if(row.id!==id)throw new Error('Keep the original planning row identity.');plan()[kind][index]=row;}
    else{if(plan()[kind].some(value=>value.id===row.id))throw new Error('This planning row identity already exists.');plan()[kind].push(row);}
    delete state.rowDrafts[key];if(state.lastEditorKey===key)state.lastEditorKey=Object.keys(state.rowDrafts).at(-1)||null;
    state.editor=null;state.editorDraft=null;state.editorError='';changed();
  }
  function switchControl(el){
    const row=state.editorDraft,variant=state.editor.variants;
    if(el.dataset.cpControl==='cadence'){
      const previous=row.cadence;variant.cadence[previous.kind]=copy(previous);
      row.cadence=copy(variant.cadence[el.value]||(el.value==='WEEKDAYS'?{kind:'WEEKDAYS',weekdays:[1,2,3,4,5]}:el.value==='EVERY_N_DAYS'?{kind:'EVERY_N_DAYS',intervalDays:1,anchorDate:plan().windowStart}:{kind:'EXPLICIT_DATES',dates:[]}));
    }else if(el.dataset.cpControl==='payment'){
      const previous=row.payment;variant.payment[previous.kind]=copy(previous);
      const common=el.value==='FUNDED'?{kind:'FUNDED',atomicUnitPrice:null,network:'',asset:''}:{kind:el.value,atomicUnitPrice:el.value==='UNPAID'?'0':previous.atomicUnitPrice??'0',network:previous.network,asset:previous.asset};
      if(previous.kind==='FUNDED')variant.fundingGroupIds=copy(row.fundingGroupIds||[]);
      row.fundingGroupIds=el.value==='FUNDED'?copy(variant.fundingGroupIds||[]):[];
      row.payment=copy(variant.payment[el.value]||{...common,...(el.value==='PREPAID'?{passCapacity:100,openingUnits:0,allowanceUnitsPerRequest:1,passGroupId:null}:{})});
    }else if(el.dataset.cpControl==='funding-economics'){
      if(row.economics)variant.economics=copy(row.economics);
      row.economics=el.checked?copy(variant.economics||{currency:'USD',unitRevenue:null,feePerPayment:null}):null;
    }else{
      if(row.economics)variant.economics=copy(row.economics);
      row.economics=el.checked?copy(variant.economics||{currency:'USD',unitRevenue:null,unitCost:null,feePerPayment:null,activeHoursPerTask:null,hourlyCost:null}):null;
    }
    state.rowDrafts[state.editor.key]={editor:copy(state.editor),data:copy(state.editorDraft)};persist();render();
  }


  function summaryCards(report){const values=[...(report.summary.unpricedPaymentRequests?[['Unpriced funding groups',report.summary.unpricedPaymentRequests]]:[]),['Useful tasks',report.summary.scheduledTasks],['Underlying requests',report.summary.scheduledRequests],['Planned paid purchases',report.summary.plannedPaidPurchases],['Independent opportunities',report.summary.independentPurchaseOpportunities],['Buyer operators',report.summary.independentBuyerOperators],['Returning buyers',report.summary.returningBuyerOperators],['Same operation facilitators',report.summary.sameOperationFacilitatorOperators],['Completions after window',report.summary.completionOutsideWindow]];
    return '<div class="cp-metrics">'+values.map(([name,value])=>'<article><span>'+esc(name)+'</span><strong>'+valueHtml(value)+'</strong></article>').join('')+'</div>';}
  function targetsReport(report){return section('Proposed targets and planned capacity',
    note('Scheduled opportunities use the entered identities, useful work, calendar, payments, and completion timing. Review shared delivery capacity below when assigning staff effort. Acceptance outcomes are evaluated in the original Cohort acceptance workspace.')+
    (report.capacity?.status&&report.capacity.status!=='NOT_CONFIGURED'?note('Shared delivery capacity: '+label(report.capacity.status)+'. See Delivery capacity for date-specific hours, unassigned work and staffing gaps.'):'')+
    table(['Original target','Required','Planned capacity','Gap','Interpretation'],report.targets.map(row=>[esc(label(row.key)),valueHtml(row.expected),valueHtml(row.planned),valueHtml(row.gap),esc(row.status==='OUTSIDE_SCHEDULE_SCOPE'?'Requires its original deployed work evidence':row.status==='PLANNED_CAPACITY'?'Capacity reaches the proposed target':row.status==='PRICE_UNSPECIFIED'?'Enter terms for '+row.unpricedAdditional+' unpriced opportunities':'Additional planned capacity needed')]))+
    (report.summary.excludedScheduleDates?note(report.summary.excludedScheduleDates+' schedule dates were excluded by the rule window, calendar, or explicit exclusions.'):''));
  }
  function dayReport(report,interactive=true){
    const selected=state.selectedDate||'',calendar=interactive?'<div class="cp-calendar" aria-label="Planned daily workload">'+report.days.map(day=>'<button type="button" data-cp-action="day" data-cp-view="true" data-date="'+esc(day.date)+'" aria-pressed="'+(selected===day.date)+'" class="'+(!day.isWorkingDay?'cp-calendar-off':'')+'"><span>'+esc(day.date)+' · '+esc(weekdays.find(x=>x[0]===day.weekday)?.[1].slice(0,3)||day.weekday)+'</span><strong>'+esc(day.scheduledTasks)+' tasks</strong><small>'+esc(day.plannedPaidPurchases)+' paid purchases</small>'+(day.exclusionLabels.length?'<small>'+esc(day.exclusionLabels.join('; '))+'</small>':'')+'</button>').join('')+'</div>':'';
    return section('Every day in the original window',note(report.window.start+' through '+report.window.end+' · '+report.window.calendarDays+' calendar days · UTC. Cutoff '+report.window.asOfAt)+calendar+
      table(['UTC date','Working day','Cutoff position','Tasks','Requests','Payments','Paid purchases','Complete tasks','Complete purchases','Independent opportunities','Allowance units','Exclusions'],
        report.days.map(day=>[esc(day.date),day.isWorkingDay?'Yes':'No',esc(label(day.asOfPosition)),...humanMetrics(day),esc(day.exclusionLabels.join('; '))]))+
      (interactive?occurrencesReport(report,selected):''));
  }
  function objectTable(values,headers=null){
    if(!values?.length)return empty('No rows in this section.');
    const keys=headers||[...new Set(values.flatMap(row=>Object.keys(row)))].filter(key=>!['input','rule','source','raw'].includes(key));
    return table(keys.map(label),values.map(row=>keys.map(key=>{const value=row[key];if(value&&typeof value==='object'&&!Array.isArray(value))return esc(JSON.stringify(value));return valueHtml(value);})));
  }
  function occurrencesReport(report,selected=''){
    const rows=report.occurrences.filter(row=>!selected||row.date===selected||row.scheduledDate===selected||String(row.scheduledAt||'').slice(0,10)===selected);
    const page=Math.min(state.pages.occurrences||0,Math.max(0,Math.ceil(rows.length/30)-1)),shown=rows.slice(page*30,page*30+30);state.pages.occurrences=page;
    return section('Scheduled occurrences'+(selected?' · '+selected:''),(selected?'<div class="cp-actions">'+btn('Show all dates','day','data-date="" data-cp-view="true"')+'</div>':'')+objectTable(shown)+
      (rows.length>30?'<div class="cp-pager">'+btn('Previous','occurrence-page','data-page="'+(page-1)+'"',page===0)+'<span>'+(page*30+1)+'–'+Math.min((page+1)*30,rows.length)+' of '+rows.length+'</span>'+btn('Next','occurrence-page','data-page="'+(page+1)+'"',(page+1)*30>=rows.length)+'</div>':''));
  }
  function moneyReport(report){
    return section('Revenue, costs, and active hours by currency',note('Each currency is calculated separately. A missing estimate keeps its affected total unvalued; known portions remain visible below. Linked funding or delivery estimates with no currency also keep affected totals incomplete.')+
      (report.currencies.length?table(['Currency','Revenue','Supplier cost','Payment fees','Active hours','Labor cost','Total cost','Contribution','Margin %'],report.currencies.map(row=>[esc(row.currency),...['revenue','supplierCost','paymentFees','activeHours','laborCost','totalCost','contribution','marginPercent'].map(key=>esc(decimal(row[key])))])):empty('Enable cost and revenue estimates in a schedule to value its planned work.'))+
      (report.currencies.some(row=>!row.complete)?table(['Currency','Estimate','Known subtotal','Rows with unknown values'],report.currencies.flatMap(row=>Object.keys(row.knownSubtotals).map(key=>[esc(row.currency),esc(label(key)),esc(decimal(row.knownSubtotals[key])),valueHtml(row.unknownRecordCounts[key])]))):''))+
      section('Native payment amounts',report.assets.length?table(['Network','Asset','Atomic amount','Payment requests','Paid purchases'],report.assets.map(row=>[esc(row.network),esc(row.asset),esc(row.atomicAmount??'Unpriced')+(row.unpricedPaymentRequests?'<small>Known atomic subtotal '+esc(row.knownAtomicAmount)+' · '+row.unpricedPaymentRequests+' unpriced groups</small>':''),valueHtml(row.plannedPaymentRequests),valueHtml(row.plannedPaidPurchases)])):empty('No native payment rows have been scheduled.'));
  }
  function capacityReport(report){
    const capacity=report.capacity;if(!capacity)return section('Delivery capacity',note('Update this retained report to calculate delivery capacity.'));
    const heading=section('Shared delivery capacity',badge(label(capacity.status))+note(capacity.basis)+
      (capacity.pools.length?table(['Pool','Available hours','Required hours','Extra hours needed by date','Overloaded dates','Status'],capacity.pools.map(row=>[esc(row.label),esc(decimal(row.availableHours)),esc(decimal(row.requiredHours)),esc(decimal(row.additionalHoursKnownMinimum)),esc(row.overloadedDates.join(', ')),esc(label(row.status))])):note('Add named delivery pools and assign schedule effort to compare recurring demand with available hours.')));
    const details=capacity.pools.map(pool=>section(pool.label+' · daily availability',table(['UTC date','Available h','Required h','Known required h','Headroom h','Extra h needed','Utilization %','Status / basis'],pool.days.map(row=>[esc(row.date),...['availableHours','requiredHours','knownRequiredHours','headroomHours','additionalHoursKnownMinimum','utilizationPercent'].map(key=>esc(decimal(row[key]))),esc(label(row.status))+'<small>'+esc(row.availabilityNote||label(row.availabilityBasis))+'</small>']))+
      '<details><summary>Weekly capacity within this cohort window</summary>'+table(['Week starting','Included dates','Available h','Required h','Net headroom h','Extra h needed by date','Status'],pool.weeks.map(row=>[esc(row.weekStart),esc(row.start+'–'+row.end),...['availableHours','requiredHours','headroomHours','additionalHoursKnownMinimum'].map(key=>esc(decimal(row[key]))),esc(label(row.status))]))+'</details>')).join('');
    return heading+details+
      (capacity.unassigned.length?section('Unassigned delivery effort',table(['Schedule','UTC date','Useful tasks','Required active hours'],capacity.unassigned.map(row=>[esc(row.scheduleId),esc(row.date),valueHtml(row.scheduledTasks),esc(decimal(row.requiredHours))]))):'')+
      (capacity.sensitivity.length?section('Capacity under the selected effort changes',table(['Pool','Effort increase %','Available h','Required h','Extra h needed by date','Status'],capacity.sensitivity.map(row=>[esc(row.label),esc(row.effortIncreasePct),...['availableHours','requiredHours','additionalHoursKnownMinimum'].map(key=>esc(decimal(row[key]))),esc(label(row.status))]))):'');
  }
  function servicePricingReport(report){
    const rows=report.servicePricing||[];
    return section('Service price floors',note('Complete selected-window supplier, payment and active labor costs are divided by new charge units. Shared prepaid schedules are calculated together. Price floors are rounded upward to twelve decimal places in the named estimate currency.')+
      (rows.length?table(['Service / shared pass','Currency','New charge units','Modeled cost','New-charge revenue','Uncovered cost','Break-even per charge','Selected margin %','Price at margin','Per-charge increase','Status'],rows.map(row=>[esc(row.label)+'<small>'+esc(row.scheduleIds.join(', '))+'</small><small>'+esc(row.priceBasis)+'</small>',esc(row.currency||'Unspecified'),valueHtml(row.chargeUnits),...['totalCost','revenue','uncoveredCost','breakEvenUnitRevenue','minimumMarginPct','targetUnitRevenue','unitRevenueIncrease'].map(key=>esc(decimal(row[key]))),esc(label(row.status))])):empty('Schedule useful work with its complete costs to calculate service price floors.')));
  }
  function prepaidReport(report){
    const person=(kind,id)=>(report.input[kind]||[]).find(row=>row.id===id)?.label||id;
    return section('Prepaid passes and allowance',report.passGroups.length?table(['Pass group','Buyer / merchant','Network / asset','Capacity','Opening units','Consumed units','New passes','Active units remaining','Retained unused earlier units','Schedules'],report.passGroups.map(row=>[esc(row.id),esc(person('buyers',row.buyerId))+'<small>'+esc(person('merchants',row.merchantId))+'</small>',esc(row.network)+'<small>'+esc(row.asset)+'</small>',valueHtml(row.passCapacity),valueHtml(row.openingUnits),valueHtml(row.consumedUnits),valueHtml(row.plannedNewPasses),valueHtml(row.remainingActiveUnits),valueHtml(row.retainedUnusedPreviousUnits),esc(row.scheduleIds.join(', '))])):empty('No prepaid schedules are in this plan.'));
  }
  function peopleReport(report){
    const metricLabels=metrics.map(label);
    return section('Buyer operators',report.buyers.length?table(['Operator','Name','Completion dates','Returning potential',...metricLabels],report.buyers.map(row=>[esc(row.operatorId),esc(row.label),esc(row.completionDates.join(', ')),row.returningPotential?'Yes':'No',...humanMetrics(row)])):empty('No buyer operator workload is scheduled.'))+
      section('Merchant operators',report.merchants.length?table(['Operator','Name','Buyer operators',...metricLabels],report.merchants.map(row=>[esc(row.operatorId),esc(row.label),esc(row.buyerOperatorIds.join(', ')),...humanMetrics(row)])):empty('No merchant workload is scheduled.'))+
      section('Useful operations',report.operations.length?table(['Operation','Merchant','Independent facilitator operators','Buyer operators',...metricLabels],report.operations.map(row=>[esc(row.label),esc(row.merchantId),valueHtml(row.independentFacilitatorCount),esc(row.buyerOperatorIds.join(', ')),...humanMetrics(row)])):empty('No useful operation workload is scheduled.'))+
      section('Facilitator operators',report.facilitators.length?table(['Operator','Name','Services','Operations',...metricLabels],report.facilitators.map(row=>[esc(row.operatorId),esc(row.label),esc(row.serviceIds.join(', ')),esc(row.operationIds.join(', ')),...humanMetrics(row)])):empty('No facilitator workload is scheduled.'));
  }
  function sensitivityReport(report){
    return section('Completion sensitivity',note('The completion share applies to whole independent purchase opportunities. Additional required workload rounds up to whole opportunities.')+
      table(['Completion share %','Base opportunities','Potential completed purchases','Purchase target','Required opportunities','Opportunity shortfall'],report.sensitivity.completion.map(row=>['completionSharePct','baseOpportunities','potentialCompletedWholePurchases','purchaseTarget','requiredOpportunities','shortfall'].map(key=>valueHtml(row[key])))))+
      section('Schedule effort sensitivity',report.sensitivity.effort.length?table(['Currency','Effort increase %','Active hours','Labor cost','Total cost','Contribution'],report.sensitivity.effort.map(row=>[esc(row.currency),valueHtml(row.effortIncreasePct),...['activeHours','laborCost','totalCost','contribution'].map(key=>esc(decimal(row[key])))])):empty('Enter active hours and financial estimates in a schedule to examine effort changes.'))+
      section('Workshare pricing and effort',report.workshares.length?table(['Workshare','Currency','Flat fee','Effort increase %','Hours','Labor cost','Total cost','Contribution','Margin %','Break even hours'],report.workshares.flatMap(row=>row.cases.map(item=>[esc(row.label),esc(row.currency),esc(decimal(row.fee)),valueHtml(item.effortIncreasePct),...['hours','laborCost','totalCost','contribution','marginPercent'].map(key=>esc(decimal(item[key]))),esc(decimal(row.breakEvenHours))]))):empty('Add named workshares to price fixed fee delivery packages.'));
  }
  function findingsReport(report){return section('Planning findings',report.findings.length?table(['Finding','Scope / row','Detail'],report.findings.map(row=>[esc(label(row.code))+'<small>'+esc(row.severity)+'</small>',esc(row.scope)+(row.id?'<small>'+esc(row.id)+'</small>':''),esc(row.message)])):note('The calculation returned no planning findings.'))+
    (report.excluded.length?section('Excluded schedule dates',table(['Schedule','Date','Reasons'],report.excluded.map(row=>[esc(row.scheduleId),esc(row.date),esc(row.reasons.join('; '))]))):'');}
  function reportView(){
    const report=state.report;
    if(!report)return section('Calculate this draft',note('Update the report to expand the original rule window, schedules, payments, costs, and target comparison.'),btn('Update report','evaluate'));
    const sections=[['targets','Targets'],['days','Daily plan'],['money','Revenue & costs'],['prepaid','Prepaid'],['funding','Explicit funding'],['people','Operators & work'],['sensitivity','Sensitivity'],['capacity','Delivery capacity'],['pricing','Price floors'],['findings','Findings']];
    const selected=state.reportSection||'targets';
    let body=selected==='targets'?targetsReport(report)+sourceComparison(report):selected==='days'?dayReport(report):selected==='money'?moneyReport(report):selected==='prepaid'?prepaidReport(report):selected==='funding'?fundingReport(report):selected==='people'?peopleReport(report):selected==='sensitivity'?sensitivityReport(report):selected==='capacity'?capacityReport(report):selected==='pricing'?servicePricingReport(report):findingsReport(report);
    return (!inputMatchesReport()?'<p class="cp-alert">This report reflects the earlier calculated inputs. Update the report to include your draft changes.</p>':'')+
      '<div class="cp-heading"><div><h3>'+esc(report.input.name)+'</h3><p>'+esc(report.window.start)+'–'+esc(report.window.end)+' · '+report.window.requiredCalendarDays+' calendar days · '+esc(report.window.expectedEnvironment)+'</p></div><div class="cp-actions">'+btn('Download report CSV','report-csv','data-cp-view="true"')+btn('Download readable HTML','report-html','data-cp-view="true"')+btn('Download plan JSON','export-json','data-cp-view="true"')+'</div></div>'+
      summaryCards(report)+'<nav class="cp-subtabs" aria-label="Planning report sections">'+sections.map(([id,title])=>btn(title,'report-section','data-section="'+id+'" data-cp-view="true" aria-current="'+(selected===id?'page':'false')+'"')).join('')+'</nav>'+body;
  }
  function editableRowsTable(p){return collections.map(kind=>section(label(kind),objectTable(p[kind]||[]))).join('');}
  function readableHtml(report){
    const title=report.input.name;
    const style='body{font:14px/1.5 system-ui,sans-serif;color:#202020;margin:36px;max-width:1500px}h1{font-size:26px}h2,h3{margin-top:28px}table{border-collapse:collapse;width:100%;font-size:12px}caption{text-align:left}th,td{border:1px solid #ccc;padding:7px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#f2f2f2}small,code{display:block}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}.cp-table{overflow-x:auto}.cp-metrics{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #ccc}.cp-metrics article{padding:12px}.cp-metrics span,.cp-metrics strong{display:block}.cp-note{color:#555}.cp-actions,button{display:none}@media print{body{margin:12mm}.cp-table{overflow:visible}tr{break-inside:avoid}details{display:block}summary{font-weight:bold}}';
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><style>'+style+'</style></head><body><header><p>SF47 Operations · planning scenario</p><h1>'+esc(title)+'</h1><p>Original case '+esc(report.source.programId)+' · source version '+esc(report.source.version)+' · plan content '+esc(report.source.planContentSha256)+'</p><p>'+esc(report.window.start)+' through '+esc(report.window.end)+' · UTC · planning cutoff '+esc(report.window.asOfAt)+'</p></header>'+
      summaryCards(report)+targetsReport(report)+sourceComparison(report)+dayReport(report,false)+moneyReport(report)+capacityReport(report)+servicePricingReport(report)+prepaidReport(report)+fundingReport(report)+peopleReport(report)+sensitivityReport(report)+findingsReport(report)+
      section('Complete scheduled occurrences',objectTable(report.occurrences))+
      '<h2>Retained plan inputs</h2>'+editableRowsTable(report.input)+jsonDetail('Original proposed rule',report.rule)+
      '<p>Exported '+esc(now())+'. Planned quantities and estimates retain the source and assumptions shown above.</p></body></html>';
  }


  function editionEnvelope(report,actor,editionId=uid('cohort-edition'),createdAt=now()){
    const delivery=schedulingApplied()?reopenCohortDeliverySchedule(state.schedulingResult):null;
    return {schema:EDITION_SCHEMA,editionId,createdAt,actor,parentSourceId:state.parentSourceId||null,plan:copy(plan()),report:report?copy(report):null,
      ...(state.recordedCostPlan?{recordedCostPlan:copy(reopenCohortRecordedCostPlan(state.recordedCostPlan)),recordedCostPlanComparison:report?compareCohortPlans(state.recordedCostPlan,plan()):null}:{}),
      ...(delivery?{deliverySchedule:copy(delivery),comparison:compareCohortPlans(delivery.sourceDocument,delivery.candidate,
        {title:delivery.candidate.name+' · delivery allocation',note:delivery.constraints.note||''})}:{})};
  }
  async function readSource(meta){
    const response=await saveApi(prefix+'/sources/'+encodeURIComponent(meta.id),undefined,{download:true});
    const bytes=await response.arrayBuffer();
    if(bytes.byteLength>8*1024*1024)throw new Error('The selected source exceeds the original 8 MiB attachment size.');
    if(Number.isInteger(meta.bytes)&&bytes.byteLength!==meta.bytes)throw new Error('The source download differs from the retained byte count.');
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
    if(meta.sha256&&hash!==meta.sha256)throw new Error('The downloaded bytes differ from the original source identity.');
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }
  async function finishAccepted(){
    const accepted=state.accepted;if(!accepted)return;
    const next=await saveApi(prefix),result=accepted.result;
    if(next?.program?.id!==caseId||result.id!==caseId||next.program.version<result.version)throw new Error('The saved edition has not appeared in its original case readback.');
    const source=next.sources.find(row=>row.id===result.recordId);
    if(!source)throw new Error('The accepted source is not yet listed in its original case.');
    const raw=await readSource(source);
    if(raw!==accepted.raw||source.filename!==accepted.payload.data.filename)throw new Error('The reopened source differs from the exact retained edition request.');
    const envelope=JSON.parse(raw);
    const isComparison=accepted.documentKind==='comparison'||envelope.schema===COHORT_PLAN_COMPARISON_SCHEMA;
    caseValue=next;
    if(isComparison)state.comparisonSavedSourceId=source.id;
    else{state.savedSourceId=source.id;state.parentSourceId=source.id;state.savedEnvelope=envelope;}
    state.viewedSource={meta:copy(source),raw,envelope};state.accepted=null;state.caseRefreshReceipt=result;
    state.notice='Saved and reopened '+source.filename+' as a new source edition in this case.';
    try{persist(true);}catch(error){state.accepted=accepted;throw error;}
    if(available()){await refreshRetainedCaseReceipt({next,source,raw});if(available())inform(isComparison?'Saved the complete comparison and both original plan documents in this case.':'Saved the complete cohort plan and report as an original case source.');}
  }
  async function refreshRetainedCaseReceipt(verified=null){
    const result=state.caseRefreshReceipt,viewed=state.viewedSource;
    if(!result||!available())return;
    if(result.id!==caseId||!Number.isInteger(result.version)||result.version<1||viewed?.meta?.id!==result.recordId||typeof viewed.raw!=='string')
      throw new Error('The retained source receipt does not match its original case and opened source.');
    const next=verified?.next||await saveApi(prefix),source=verified?.source||next?.sources?.find(row=>row.id===result.recordId);
    if(next?.program?.id!==caseId||next.program.version<result.version||!source)
      throw new Error('The retained accepted source has not appeared in its original case readback.');
    const raw=verified?verified.raw:await readSource(source);
    if(source.id!==result.recordId||raw!==viewed.raw||source.filename!==viewed.meta.filename)
      throw new Error('The retained source receipt differs from the exact original reopened source.');
    if(!available()||state.caseRefreshReceipt!==result||state.viewedSource!==viewed)return;
    caseValue=next;await onCaseUpdated(next,result);
    if(state.caseRefreshReceipt===result){state.caseRefreshReceipt=null;persist();}
  }
  async function sendPending(){
    if(state.inflight){await state.inflight;if(state.accepted)await finishAccepted();return;}
    if(!state.pending){if(state.accepted)await finishAccepted();return;}
    const pending=state.pending;persist(true);
    const task=(async()=>{
      try{
        const result=await saveApi(prefix+'/command',pending.payload);
        state.accepted={...pending,result};state.pending=null;persist(true);
      }catch(error){
        if(definitive(error)){
          state.rejected={...pending,code:error.code,rejectedAt:now()};state.pending=null;
          state.notice='The original request was rejected. The full plan remains available; refresh the current case source before saving a new edition.';persist();
        }
        throw error;
      }
    })();
    state.inflight=task;controls();
    try{await task;}finally{if(state.inflight===task)state.inflight=null;}
    if(state.accepted)await finishAccepted();
  }
  async function saveEdition(){
    if(isPending())return sendPending();
    if(!plan())throw new Error('Create or open a plan before saving an edition.');
    if(plan().source.programId!==caseId)throw new Error('Attach an edition from the original case '+plan().source.programId+'.');
    if(caseValue.program.state!=='OPEN')throw new Error('Open the original Operations case before attaching a new source edition.');
    const actor=String((await getActor())??'').trim();if(!actor)throw new Error('Enter the recording operator in Operations before saving.');
    await refreshSource();
    await checkRecordedCostSource();
    const report=evaluate(),createdAt=now(),editionId=uid('cohort-edition'),envelope=editionEnvelope(report,actor,editionId,createdAt);
    const raw=JSON.stringify(envelope,null,2)+'\n';
    if(new TextEncoder().encode(raw).length>8*1024*1024)throw new Error('The complete plan and report exceed one original 8 MiB source attachment. Download the complete JSON to retain it.');
    const filename='sf47-cohort-plan-tranche-'+plan().rule.target.tranche+'-'+editionId+'.json';
    const payload={expectedVersion:caseValue.program.version,actor,action:'source.add',data:{kind:'other',filename,contentBase64:toBase64(raw),mediaType:'application/json',sourceUrl:'',observedAt:createdAt},note:'Cohort plan edition: '+plan().name};
    payload.requestId=await mutationId('operations:'+caseId,payload);
    state.pending={payload,raw,editionId};persist(true);await sendPending();
  }
  function openDocument(document,{meta=null,raw=null}={}){
    if(document?.schema===COHORT_RECORDED_COST_PLAN_SCHEMA){
      const value=reopenCohortRecordedCostPlan(document);
      openDocument(value.candidate);state.recordedCostSource=copy(value.sourceDocument);state.recordedCostBaseline=copy(value.planDocument);
      state.recordedCostChoices=copy(value.choices);state.recordedCostPreview=copy(value);state.recordedCostPlan=copy(value);
      state.tab='recorded-cost';persist();return;
    }
    if(document?.schema===COHORT_DELIVERY_SCHEDULE_SCHEMA){
      const result=reopenCohortDeliverySchedule(document);
      openDocument(copy(result.candidate),{meta:null,raw:null});
      state.schedulingResult=result;state.schedulingOptions=schedulingOptionsFor(result);state.schedulingInput=JSON.stringify(result.sourceDocument?.plan||result.sourceDocument?.input||result.sourceDocument);
      captureSchedulingComparison(result);state.tab='scheduling';persist();return;
    }
    if(document?.schema===COHORT_PLAN_COMPARISON_SCHEMA){adoptComparison(document,{meta,raw});return;}
    const envelope=document?.schema===EDITION_SCHEMA?document:null;
    const supplied=envelope?.plan||(document?.schema===COHORT_PLAN_REPORT_SCHEMA&&document.kind==='PLAN'?document.input:document);
    if(!supplied||supplied.schema!==COHORT_PLAN_SCHEMA){
      if(meta){state.viewedSource={meta:copy(meta),raw:raw||JSON.stringify(document,null,2),envelope:document};state.tab='editions';state.notice='Opened the retained source document. Its original JSON remains available below.';return;}
      throw new Error('Select a cohort plan, saved edition, or complete cohort plan report JSON.');
    }
    let report,openedDelivery=null;
    try{
      report=evaluateCohortPlan(copy(supplied),{nativeSeed:state.latestSeed?copy(state.latestSeed):undefined});
      if(envelope?.recordedCostPlan){reopenCohortRecordedCostPlan(envelope.recordedCostPlan);
        if((envelope.report||envelope.recordedCostPlanComparison)&&JSON.stringify(envelope.recordedCostPlanComparison)!==JSON.stringify(compareCohortPlans(envelope.recordedCostPlan,supplied)))throw new Error('Keep the complete recorded-cost proposal and its successor comparison.');}
      if(envelope?.deliverySchedule){
        openedDelivery=reopenCohortDeliverySchedule(envelope.deliverySchedule);
        if(JSON.stringify(report.input)!==JSON.stringify(openedDelivery.candidate))
          throw new Error('The saved allocation belongs to a different editable successor. Retain the complete original edition for review.');
      }
    }
    catch(error){
      if(meta){state.viewedSource={meta:copy(meta),raw:raw||JSON.stringify(document,null,2),envelope:document};state.tab='editions';state.notice='Opened the original source. This engine cannot recalculate that document: '+error.message;return;}
      throw error;
    }
    rememberPrior(meta?'Opened source '+meta.id:'Imported plan JSON');
    state.plan=copy(supplied);state.recordedCostPlan=envelope?.recordedCostPlan?copy(envelope.recordedCostPlan):null;
    if(state.recordedCostPlan){state.recordedCostSource=copy(state.recordedCostPlan.sourceDocument);state.recordedCostBaseline=copy(state.recordedCostPlan.planDocument);state.recordedCostChoices=copy(state.recordedCostPlan.choices);state.recordedCostPreview=copy(state.recordedCostPlan);}
    state.report=report;state.reportInput=JSON.stringify(state.plan);state.tranche=Number(supplied.rule.target.tranche);
    state.parentSourceId=meta?.id||envelope?.parentSourceId||null;state.savedSourceId=meta?.id||null;state.savedEnvelope=envelope?copy(envelope):null;
    if(openedDelivery){state.schedulingResult=openedDelivery;state.schedulingOptions=schedulingOptionsFor(openedDelivery);state.schedulingInput=JSON.stringify(openedDelivery.sourceDocument);captureSchedulingComparison(openedDelivery);}
    if(meta)state.viewedSource={meta:copy(meta),raw,envelope:document};
    state.editor=null;state.editorDraft=null;state.pages={};state.tab='report';
    state.notice=meta?'Opened the original plan from '+meta.filename+'. Current source differences are shown in the report.':'Imported the plan with its original source, rule, identities, and editable rows.';
    persist();
  }

  async function receiveCalendar(){
    if(!state.incomingCalendar)return;
    if(isPending())throw new Error('Finish the retained original edition save before opening the received calendar.');
    const received=copy(state.incomingCalendar),nativeSeed=received.nativeSeed;
    if(nativeSeed?.source?.programId!==caseId)throw new Error('The received calendar belongs to another original case.');
    const imported=seedCohortPlanFromCalendar(nativeSeed,received.calendarSelection,{draftId:uid('cohort-plan')});
    await refreshSource(imported.rule.target.tranche);
    await openDocument(imported);
    state.tab='funding';state.incomingCalendar=null;
    state.notice='Opened '+imported.schedules.length+' exact dated use rows and '+imported.fundingGroups.length+' original funding groups. Enter funding prices and task effort; the previous planning draft remains in Saved editions.';
    persist();onCalendarReceived(received.requestId);
  }

  let planningReadSequence=0;
  function planningFingerprint(){
    return JSON.stringify([state.plan,state.parentSourceId,state.savedSourceId,state.editor,state.editorDraft,state.rowDrafts,
      state.comparison,state.schedulingResult,state.schedulingOptions,state.recordedCostSource,state.recordedCostBaseline,state.recordedCostChoices,state.recordedCostPlan,state.recordedCostDraft,state.recordedCostMeasurementEditor,state.pending,state.accepted]);
  }
  function receivePlanning(document,{meta=null,raw=null,origin={}}={},expected,sequence){
    if(!available()||sequence!==planningReadSequence||planningFingerprint()!==expected){
      comparisonState();state.comparisonIncoming.push({id:uid('planning-incoming'),planning:true,document:copy(document),
        meta:meta?copy(meta):null,raw,origin:copy(origin),receivedAt:now()});
      state.notice='The complete incoming plan is retained in Compare plans for explicit adoption; current edits remain selected.';persist();return;
    }
    openDocument(document,{meta,raw});
  }
  async function openSaved(id){
    const expected=planningFingerprint(),sequence=++planningReadSequence;
    const meta=caseValue.sources.find(row=>row.id===id);if(!meta)throw new Error('Refresh the case to select its retained source.');
    const raw=await readSource(meta);
    let parsed;try{parsed=JSON.parse(raw);}catch{throw new Error('The selected source is not a JSON document.');}
    receivePlanning(parsed,{meta,raw,origin:{label:meta.filename,filename:meta.filename,sourceId:meta.id,sha256:meta.sha256}},expected,sequence);
  }
  function chooseFile(accept){return new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept=accept;input.hidden=true;root.append(input);const finish=value=>{input.remove();resolve(value);};input.addEventListener('change',()=>finish(input.files?.[0]||null),{once:true});input.addEventListener('cancel',()=>finish(null),{once:true});input.click();});}
  async function importJson(){
    const expected=planningFingerprint(),sequence=++planningReadSequence;
    const file=await chooseFile('.json,application/json');if(!file)return;
    if(file.size>8*1024*1024)throw new Error('Choose a plan, saved edition, or complete report JSON document no larger than 8 MiB.');
    const raw=await file.text();let parsed;try{parsed=JSON.parse(raw);}catch(error){throw new Error('The selected file is not valid JSON: '+error.message);}
    receivePlanning(parsed,{raw,origin:{filename:file.name,label:file.name,bytes:file.size}},expected,sequence);
  }
  function exportJson(){
    let report=null;try{report=evaluate();}catch(error){state.notice='Downloaded the editable draft; its report needs corrected inputs: '+error.message;}
    const envelope=editionEnvelope(report,state.savedEnvelope?.actor||'');
    download(JSON.stringify(envelope,null,2)+'\n',cleanName(plan().name)+'-draft.json');
  }
  const csvColumns=['dateAllocations','fundingGroupIds','fundingKind','date','origin','capacityPoolId','hoursByWeekday','dateOverrides','csvEncoding','caseId','draftId','sourceVersion','planContentSha256','kind','id','label','operatorId','participantClass','environment','deploymentId','serviceUrl','sourceIds','sourceNote','merchantId','scope','expectedOutput','sourcePeriod','operationId','buyerId','facilitatorId','cadenceKind','cadenceWeekdays','intervalDays','anchorDate','dates','tasksPerDate','requestsPerTask','timeUtc','deliveryDelayMinutes','excludedDates','paymentKind','atomicUnitPrice','network','asset','passCapacity','openingUnits','allowanceUnitsPerRequest','passGroupId','economicsEnabled','currency','unitRevenue','unitCost','feePerPayment','activeHoursPerTask','hourlyCost','note','fee','hours','otherCosts'];
  function csvCell(value){
    let text=String(value??'');if(text.startsWith("'"))text="'"+text;else if(/^[\s]*[=+@\t\r]/.test(text)||/^[\s]*-/.test(text)&&!/^-\d+(?:\.\d+)?$/.test(text))text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  }
  function editableCsv(){
    const p=plan(),rows=collections.flatMap(kind=>(p[kind]||[]).map(row=>{
      const result={csvEncoding:'sf47-editable-rows.v1',caseId:p.source.programId,draftId:p.draftId,sourceVersion:p.source.version,planContentSha256:p.source.planContentSha256,kind,...row};
      if(row.sourceIds)result.sourceIds=row.sourceIds.join('|');
      if(row.origin)result.origin=JSON.stringify(row.origin);
      if(row.dateAllocations)result.dateAllocations=JSON.stringify(row.dateAllocations);
      if(row.fundingGroupIds)result.fundingGroupIds=row.fundingGroupIds.join('|');
      if(kind==='fundingGroups')Object.assign(result,{kind,fundingKind:row.kind,economicsEnabled:row.economics?'true':'false',...(row.economics||{})});
      if(kind==='capacityPools'){result.hoursByWeekday=JSON.stringify(row.hoursByWeekday);result.dateOverrides=JSON.stringify(row.dateOverrides||[]);}
      if(kind==='schedules'){
        const c=row.cadence;Object.assign(result,{cadenceKind:c.kind,cadenceWeekdays:c.weekdays?.join('|'),intervalDays:c.intervalDays,anchorDate:c.anchorDate,dates:listedDates(c.dates),excludedDates:listedDates(row.excludedDates),paymentKind:row.payment.kind,...row.payment,economicsEnabled:row.economics?'true':'false',...(row.economics||{})});result.kind=kind;
      }
      return result;
    }));
    return csvColumns.map(csvCell).join(',')+'\r\n'+rows.map(row=>csvColumns.map(key=>csvCell(row[key])).join(',')).join('\r\n')+'\r\n';
  }
  function parseCsv(raw){
    const rows=[],row=[];let cell='',quoted=false,afterQuote=false;
    raw=raw.replace(/^\uFEFF/,'');
    for(let i=0;i<raw.length;i++){
      const char=raw[i];
      if(quoted){if(char==='"'){if(raw[i+1]==='"'){cell+='"';i++;}else{quoted=false;afterQuote=true;}}else cell+=char;continue;}
      if(char==='"'&&!cell&&!afterQuote){quoted=true;continue;}
      if(char===','){row.push(cell);cell='';afterQuote=false;continue;}
      if(char==='\n'||char==='\r'){if(char==='\r'&&raw[i+1]==='\n')i++;row.push(cell);if(row.some(value=>value!==''))rows.push([...row]);row.length=0;cell='';afterQuote=false;continue;}
      if(afterQuote&&!/\s/.test(char))throw new Error('CSV contains text after a closed quoted field.');
      if(!afterQuote)cell+=char;
    }
    if(quoted)throw new Error('CSV contains an unclosed quoted field.');
    if(cell||row.length){row.push(cell);rows.push(row);}
    if(!rows.length)throw new Error('The CSV contains no header.');
    const headers=rows.shift();if(new Set(headers).size!==headers.length)throw new Error('CSV repeats a column name.');
    if(!['kind','id','label'].every(key=>headers.includes(key)))throw new Error('CSV requires kind, id, and label columns.');
    if(headers.some(key=>!csvColumns.includes(key)))throw new Error('Use the editable rows CSV columns provided by this workspace.');
    return rows.map((cells,index)=>{if(cells.length!==headers.length)throw new Error('CSV row '+(index+2)+' has the wrong number of columns.');return Object.fromEntries(headers.map((key,i)=>[key,cells[i]]));});
  }
  async function importCsv(){
    const file=await chooseFile('.csv,text/csv');if(!file)return;
    if(file.size>8*1024*1024)throw new Error('Choose an editable rows CSV no larger than 8 MiB.');
    const values=parseCsv(await file.text()),candidate=copy(plan()),seen=new Set();for(const kind of collections)if(!candidate[kind])candidate[kind]=[];
    const nullable=value=>value===undefined||value===''?null:value;
    const integer=(value,fallback)=>value===undefined||value===''?fallback:Number(value);
    for(const entry of values){
      if(entry.csvEncoding&&entry.csvEncoding!=='sf47-editable-rows.v1')throw new Error('Use the current editable rows CSV encoding.');
      if(entry.csvEncoding==='sf47-editable-rows.v1')for(const key of Object.keys(entry)){const value=entry[key];if(value.startsWith("''")||/^'[\s]*[=+@\t\r]/.test(value)||/^'[\s]*-/.test(value)&&!/^'-\d+(?:\.\d+)?$/.test(value))entry[key]=value.slice(1);}
      const {kind,id}=entry;if(!collections.includes(kind))throw new Error('CSV kind must be buyers, merchants, facilitators, operations, schedules, workshares, capacityPools, or fundingGroups.');
      if(!id||seen.has(kind+':'+id))throw new Error('CSV row identities must be present and unique within each collection.');seen.add(kind+':'+id);
      if(entry.caseId&&entry.caseId!==candidate.source.programId||entry.draftId&&entry.draftId!==candidate.draftId||entry.planContentSha256&&entry.planContentSha256!==candidate.source.planContentSha256||entry.sourceVersion&&Number(entry.sourceVersion)!==candidate.source.version)throw new Error('CSV source identity differs from the open original plan. Open the matching plan before importing its rows.');
      const existing=candidate[kind].find(row=>row.id===id),row=existing?copy(existing):blankRow(kind);row.id=id;row.label=entry.label;
      const shared=['operatorId','participantClass','environment','serviceUrl','sourceNote','merchantId','scope','expectedOutput','sourcePeriod','operationId','buyerId','timeUtc','note','currency'];
      for(const key of shared)if(Object.hasOwn(row,key)&&entry[key]!==undefined)row[key]=entry[key];
      if(Object.hasOwn(row,'deploymentId')&&entry.deploymentId!==undefined)row.deploymentId=nullable(entry.deploymentId);
      if(Object.hasOwn(row,'sourceIds')&&entry.sourceIds!==undefined)row.sourceIds=entry.sourceIds.split('|').filter(Boolean);
      if(['schedules','fundingGroups'].includes(kind)&&entry.origin!==undefined){try{row.origin=entry.origin?JSON.parse(entry.origin):null;}catch{throw new Error('Origin must contain the complete Installation reference JSON.');}}
      if(kind==='capacityPools')for(const key of ['hoursByWeekday','dateOverrides'])if(entry[key]!==undefined&&entry[key]!==''){try{row[key]=JSON.parse(entry[key]);}catch{throw new Error('Capacity '+key+' must contain complete JSON.');}}
      if(kind==='workshares')for(const key of ['fee','hours','hourlyCost','otherCosts'])if(entry[key]!==undefined)row[key]=nullable(entry[key]);
      if(kind==='fundingGroups'){
        row.kind=entry.fundingKind||row.kind;
        for(const key of ['date','network','asset'])if(entry[key]!==undefined)row[key]=entry[key];
        if(entry.atomicUnitPrice!==undefined)row.atomicUnitPrice=nullable(entry.atomicUnitPrice);
        if(entry.facilitatorId!==undefined)row.facilitatorId=nullable(entry.facilitatorId);
        const enabled=entry.economicsEnabled===undefined?Boolean(row.economics):entry.economicsEnabled.toLowerCase()==='true';
        if(entry.economicsEnabled!==undefined&&!['true','false'].includes(entry.economicsEnabled.toLowerCase()))throw new Error('economicsEnabled must be true or false.');
        if(!enabled)row.economics=null;
        else{row.economics=row.economics||{currency:'USD',unitRevenue:null,feePerPayment:null};for(const key of ['currency','unitRevenue','feePerPayment'])if(entry[key]!==undefined)row.economics[key]=key==='currency'?entry[key]:nullable(entry[key]);}
      }
      if(kind==='schedules'){
        if(entry.dateAllocations!==undefined){try{if(entry.dateAllocations)row.dateAllocations=JSON.parse(entry.dateAllocations);else delete row.dateAllocations;}catch{throw new Error('Date allocations must contain the complete sourceDate/date array.');}}
        row.fundingGroupIds=entry.fundingGroupIds===undefined?row.fundingGroupIds||[]:entry.fundingGroupIds.split('|').filter(Boolean);
        row.capacityPoolId=entry.capacityPoolId===undefined?row.capacityPoolId||null:nullable(entry.capacityPoolId);
        row.facilitatorId=entry.facilitatorId===undefined?row.facilitatorId:nullable(entry.facilitatorId);
        for(const key of ['tasksPerDate','requestsPerTask','deliveryDelayMinutes'])if(entry[key]!==undefined)row[key]=integer(entry[key],null);
        const cadenceKind=entry.cadenceKind||row.cadence.kind;
        row.cadence=cadenceKind==='WEEKDAYS'?{kind:cadenceKind,weekdays:entry.cadenceWeekdays===undefined?row.cadence.weekdays||[]:entry.cadenceWeekdays.split('|').filter(Boolean).map(Number)}:cadenceKind==='EVERY_N_DAYS'?{kind:cadenceKind,intervalDays:integer(entry.intervalDays,row.cadence.intervalDays),anchorDate:entry.anchorDate||row.cadence.anchorDate||candidate.windowStart}:{kind:cadenceKind,dates:entry.dates===undefined?row.cadence.dates||[]:parseDates(entry.dates)};
        if(entry.excludedDates!==undefined)row.excludedDates=parseDates(entry.excludedDates,true);
        const paymentKind=entry.paymentKind||row.payment.kind,old=row.payment;
        row.payment={kind:paymentKind,atomicUnitPrice:entry.atomicUnitPrice===undefined?old.atomicUnitPrice:entry.atomicUnitPrice,network:entry.network===undefined?old.network:entry.network,asset:entry.asset===undefined?old.asset:entry.asset};
        if(paymentKind==='FUNDED')row.payment.atomicUnitPrice=nullable(row.payment.atomicUnitPrice);
        if(paymentKind==='PREPAID')Object.assign(row.payment,{passCapacity:integer(entry.passCapacity,old.passCapacity??100),openingUnits:integer(entry.openingUnits,old.openingUnits??0),allowanceUnitsPerRequest:integer(entry.allowanceUnitsPerRequest,old.allowanceUnitsPerRequest??1),passGroupId:entry.passGroupId===undefined?old.passGroupId||null:nullable(entry.passGroupId)});
        const enabled=entry.economicsEnabled===undefined?Boolean(row.economics):entry.economicsEnabled.toLowerCase()==='true';
        if(entry.economicsEnabled!==undefined&&!['true','false'].includes(entry.economicsEnabled.toLowerCase()))throw new Error('economicsEnabled must be true or false.');
        if(!enabled)row.economics=null;
        else{row.economics=row.economics||{currency:'USD',unitRevenue:null,unitCost:null,feePerPayment:null,activeHoursPerTask:null,hourlyCost:null};for(const key of ['currency','unitRevenue','unitCost','feePerPayment','activeHoursPerTask','hourlyCost'])if(entry[key]!==undefined)row.economics[key]=key==='currency'?entry[key]:nullable(entry[key]);}
      }
      const index=candidate[kind].findIndex(value=>value.id===id);if(index<0)candidate[kind].push(row);else candidate[kind][index]=row;
    }
    const report=evaluateCohortPlan(candidate,{nativeSeed:state.latestSeed?copy(state.latestSeed):undefined});
    rememberPrior('Imported editable rows CSV');state.plan=candidate;state.report=report;state.reportInput=JSON.stringify(candidate);state.savedEnvelope=null;state.pages={};
    state.notice='Imported '+values.length+' named rows. Matching row IDs were updated, additional rows were added, and the prior draft remains in Saved editions.';persist();
  }



  // Comparison snapshots stay separate from the editable plan and the one native source writer.
  let comparisonCache=null,comparisonCacheKey='',comparisonReadSequence=0;
  function comparisonState(){
    if(!state.comparison)state.comparison={before:null,after:null,title:'',note:'',section:'summary'};
    if(!state.comparisonSelections)state.comparisonSelections={before:'current',after:'current'};
    if(!state.comparisonHistory)state.comparisonHistory=[];
    if(!state.comparisonIncoming)state.comparisonIncoming=[];
    return state.comparison;
  }
  function comparisonDocumentPlan(document){
    const candidate=document?.schema===COHORT_RECORDED_COST_PLAN_SCHEMA?reopenCohortRecordedCostPlan(document).candidate:document?.schema===EDITION_SCHEMA?document.plan:document?.schema===COHORT_PLAN_REPORT_SCHEMA&&document.kind==='PLAN'?document.input:document;
    if(candidate?.schema!==COHORT_PLAN_SCHEMA)throw new Error('Choose a complete plan, saved edition, or plan report for this side.');
    return candidate;
  }
  function comparisonOptions(value){
    return {...(value.title?{title:value.title}:{}),note:value.note||'',origins:{before:value.before?.origin||null,after:value.after?.origin||null}};
  }
  function comparisonReport(){
    const value=comparisonState();if(!value.before||!value.after)return null;
    const key=JSON.stringify([value.before.document,value.after.document,comparisonOptions(value)]);
    if(key!==comparisonCacheKey){
      comparisonCache=compareCohortPlans(value.before.document,value.after.document,comparisonOptions(value));comparisonCacheKey=key;
    }
    return comparisonCache;
  }
  function retainComparison(reason){
    const value=comparisonState();if(!value.before&&!value.after&&!value.note&&!value.title)return;
    state.comparisonHistory.push({id:uid('comparison-prior'),retainedAt:now(),reason,value:copy(value)});
  }
  function replaceComparisonSide(side,document,origin){
    if(!['before','after'].includes(side))throw new Error('Select the baseline or candidate.');
    comparisonDocumentPlan(document);
    const next={...copy(comparisonState()),[side]:{document:copy(document),origin:copy(origin||{})}};
    if(next.before&&next.after)compareCohortPlans(next.before.document,next.after.document,comparisonOptions(next));
    else evaluateCohortPlan(comparisonDocumentPlan(document));
    retainComparison('Replaced the '+(side==='before'?'baseline':'candidate')+' source');
    state.comparison=next;state.comparisonSavedSourceId=null;comparisonCacheKey='';state.pages={};state.tab='compare';
    state.notice='Captured the complete '+(side==='before'?'baseline':'candidate')+' source. The working plan remains available in its existing editor.';
    persist();
  }
  function comparisonFingerprint(){return JSON.stringify(state.comparison||null);}
  function receiveComparisonSide(side,document,origin,expected,sequence){
    // A disposed or superseded file/source read is retained for explicit adoption.
    comparisonDocumentPlan(document);evaluateCohortPlan(comparisonDocumentPlan(document));
    if(!available()||sequence!==comparisonReadSequence||comparisonFingerprint()!==expected){
      comparisonState();state.comparisonIncoming.push({id:uid('comparison-incoming'),side,document:copy(document),origin:copy(origin||{}),receivedAt:now()});
      state.notice='A later source read is retained in Compare plans for explicit adoption; the current selection is preserved.';persist();return;
    }
    replaceComparisonSide(side,document,origin);
  }
  async function selectComparisonSide(side){
    comparisonState();const chosen=state.comparisonSelections[side]||'current';
    const expected=comparisonFingerprint(),sequence=++comparisonReadSequence;
    if(chosen==='current'){
      if(!plan())throw new Error('Open a working plan first.');
      replaceComparisonSide(side,copy(plan()),{label:'Current draft',caseId:plan().source.programId,capturedAt:now()});return;
    }
    if(chosen.startsWith('prior:')){
      const previous=state.priorDrafts.find(row=>row.id===chosen.slice(6));if(!previous)throw new Error('Choose a retained local draft.');
      replaceComparisonSide(side,copy(previous.plan),{label:'Prior draft: '+previous.reason,caseId:previous.plan.source.programId,capturedAt:previous.retainedAt});return;
    }
    if(!chosen.startsWith('source:'))throw new Error('Choose a source for this comparison side.');
    const meta=caseValue.sources.find(row=>row.id===chosen.slice(7));if(!meta)throw new Error('Refresh the case to choose its saved source.');
    const raw=await readSource(meta);let document;try{document=JSON.parse(raw);}catch{throw new Error('The selected source is not complete JSON.');}
    receiveComparisonSide(side,document,{label:meta.filename,caseId,sourceId:meta.id,filename:meta.filename,sha256:meta.sha256,bytes:meta.bytes,capturedAt:now()},expected,sequence);
  }
  async function importComparisonSide(side){
    const expected=comparisonFingerprint(),sequence=++comparisonReadSequence;
    const file=await chooseFile('.json,application/json');if(!file)return;
    if(file.size>64*1024*1024)throw new Error('Choose a complete JSON source no larger than 64 MiB.');
    const raw=await file.text();let document;try{document=JSON.parse(raw.replace(/^\uFEFF/,''));}catch{throw new Error('The selected file is not complete JSON.');}
    receiveComparisonSide(side,document,{label:file.name,filename:file.name,capturedAt:now()},expected,sequence);
  }
  function adoptComparison(document,{meta=null,raw=null}={}){
    const report=reopenCohortPlanComparison(document);
    const next={before:{document:copy(report.documents.before),origin:copy(report.review.origins.before||{})},
      after:{document:copy(report.documents.after),origin:copy(report.review.origins.after||{})},
      title:report.review.title,note:report.review.note,section:'summary'};
    retainComparison(meta?'Opened saved comparison '+meta.id:'Imported a complete comparison');
    state.comparison=next;state.comparisonSavedSourceId=meta?.id||null;comparisonCache=report;comparisonCacheKey='';
    if(meta)state.viewedSource={meta:copy(meta),raw,envelope:copy(document)};
    state.tab='compare';state.pages={};state.notice='Opened both complete comparison sources and recalculated their reports using each original rule. The working plan remains available.';
    persist();
  }
  async function importComparison(){
    const expected=comparisonFingerprint(),sequence=++comparisonReadSequence;
    const file=await chooseFile('.json,application/json');if(!file)return;
    if(file.size>64*1024*1024)throw new Error('Choose a complete comparison no larger than 64 MiB.');
    const raw=await file.text();let document;try{document=JSON.parse(raw.replace(/^\uFEFF/,''));}catch{throw new Error('The selected file is not complete JSON.');}
    reopenCohortPlanComparison(document);
    if(!available()||sequence!==comparisonReadSequence||comparisonFingerprint()!==expected){
      comparisonState();state.comparisonIncoming.push({id:uid('comparison-incoming'),document:copy(document),origin:{filename:file.name},receivedAt:now(),comparison:true});
      state.notice='The incoming comparison is retained for explicit adoption; newer edits remain selected.';persist();return;
    }
    adoptComparison(document,{raw});
  }
  async function saveComparison(){
    if(isPending())return sendPending();
    const report=comparisonReport();if(!report)throw new Error('Choose both comparison sources before saving.');
    const actor=String((await getActor())??'').trim();if(!actor)throw new Error('Enter the recording operator in Operations before saving.');
    const next=await saveApi(prefix);
    if(next?.program?.id!==caseId||next.program.state!=='OPEN')throw new Error('Open this original Operations case before saving the comparison.');
    caseValue=next;
    const createdAt=now(),editionId=uid('cohort-comparison'),raw=JSON.stringify(report,null,2)+'\n';
    if(new TextEncoder().encode(raw).length>8*1024*1024)throw new Error('The complete comparison exceeds one original 8 MiB source attachment. Download its complete JSON to retain both plans.');
    const filename='sf47-cohort-plan-comparison-'+editionId+'.json';
    const payload={expectedVersion:caseValue.program.version,actor,action:'source.add',data:{kind:'other',filename,contentBase64:toBase64(raw),mediaType:'application/json',sourceUrl:'',observedAt:createdAt},note:'Cohort plan comparison: '+report.review.title};
    payload.requestId=await mutationId('operations:'+caseId,payload);
    state.pending={payload,raw,editionId,documentKind:'comparison'};persist(true);await sendPending();
  }
  async function openComparisonSide(side){
    const item=comparisonState()[side];if(!item)throw new Error('Capture this comparison side first.');
    const origin=item.origin||{},meta=origin.caseId===caseId&&origin.sourceId?caseValue.sources.find(row=>row.id===origin.sourceId):null;
    if(meta){
      if(origin.sha256&&meta.sha256!==origin.sha256)throw new Error('The saved source identity differs from this comparison. Keep the retained comparison and inspect the original source.');
      await openSaved(meta.id);
    }else await openDocument(copy(item.document));
  }
  function comparisonValue(value){return value===null||value===undefined?'<span class="cp-note">Unvalued / absent</span>':typeof value==='object'?'<pre>'+esc(JSON.stringify(value,null,2))+'</pre>':esc(decimal(value));}
  function comparisonDelta(value){return value===null||value===undefined?'<span class="cp-note">—</span>':esc(typeof value==='number'&&value>0?'+'+value:typeof value==='string'&&value!=='0'&&!value.startsWith('-')?'+'+decimal(value):decimal(value));}
  function comparisonMetricTable(rows){
    return table(['Measure','Baseline','Candidate','Candidate − baseline'],rows.map(row=>[esc(label(row.key)),comparisonValue(row.before),comparisonValue(row.after),comparisonDelta(row.delta)]));
  }
  function comparisonPage(key,rows,interactive){
    if(!interactive)return {rows,controls:''};
    const page=Math.min(Math.max(0,state.pages[key]||0),Math.max(0,Math.ceil(rows.length/25)-1));
    state.pages[key]=page;
    return {rows:rows.slice(page*25,page*25+25),controls:rows.length>25?'<div class="cp-pager">'+
      btn('Previous','comparison-page','data-key="'+esc(key)+'" data-page="'+(page-1)+'" data-cp-view="true"',page===0)+
      '<span>'+((page*25)+1)+'–'+Math.min((page+1)*25,rows.length)+' of '+rows.length+'</span>'+
      btn('Next','comparison-page','data-key="'+esc(key)+'" data-page="'+(page+1)+'" data-cp-view="true"',(page+1)*25>=rows.length)+'</div>':''};
  }
  function comparisonRowsTable(title,key,rows,interactive=true){
    const selected=comparisonPage(key,rows,interactive);
    return section(title,rows.length?table(['Original row','Change','Baseline / candidate position','Changed fields'],selected.rows.map(row=>{
      const name=row.after?.label||row.before?.label||row.id;
      return [esc(name)+'<small>'+esc(row.id)+'</small>',esc(label(row.status)),esc(row.beforeIndex===null?'Absent':String(row.beforeIndex+1))+' / '+esc(row.afterIndex===null?'Absent':String(row.afterIndex+1)),
        row.changes.length?'<details><summary>'+row.changes.length+' changed fields</summary>'+table(['Field','Baseline','Candidate'],row.changes.map(change=>[esc(label(change.key)),change.beforePresent?comparisonValue(change.before):esc('Absent'),change.afterPresent?comparisonValue(change.after):esc('Absent')]))+'</details>':esc('Order changed; row content retained')];
    }))+selected.controls:note('No changes in this section.'));
  }
  function comparisonBasis(report){
    const changed=report.basis.filter(row=>!row.match);
    return section('Comparison basis',note('All changes are candidate minus baseline. Each plan keeps its own original rule, calendar window and observation time. These are planned quantities and estimates.')+
      (changed.length?'<div class="cp-source-change"><h4>The selected bases differ</h4>'+table(['Basis','Baseline','Candidate'],changed.map(row=>[esc(label(row.key)),comparisonValue(row.before),comparisonValue(row.after)]))+'</div>':note('Both alternatives use the same programme, rule, window and observation time.'))+
      table(['Plan','Case / source','UTC window','Original tranche'],[['Baseline: '+report.before.input.name,report.before.source.programId+' · v'+report.before.source.version,report.before.window.start+'–'+report.before.window.end,String(report.before.window.tranche)],['Candidate: '+report.after.input.name,report.after.source.programId+' · v'+report.after.source.version,report.after.window.start+'–'+report.after.window.end,String(report.after.window.tranche)]].map(row=>row.map(esc))));
  }
  function comparisonTargets(report){
    return section('Original targets',table(['Target','Baseline planned / required','Candidate planned / required','Planned change','Shortfall change'],report.targets.map(row=>[
      esc(label(row.key)),comparisonValue(row.before?.planned)+' / '+comparisonValue(row.before?.expected)+(row.before?'<small>'+esc(label(row.before.status))+'</small>':''),
      comparisonValue(row.after?.planned)+' / '+comparisonValue(row.after?.expected)+(row.after?'<small>'+esc(label(row.after.status))+'</small>':''),
      comparisonDelta(row.planned.delta),comparisonDelta(row.gap.delta)])));
  }
  function comparisonEconomics(report){
    const costs=(title,groups)=>section(title,groups.length?groups.map(group=>{
      const coverage={baseline:group.before?.unknownRecordCounts??null,candidate:group.after?.unknownRecordCounts??null};
      return '<h4>'+esc(group.currency)+'</h4>'+comparisonMetricTable(Object.entries(group.amounts).map(([key,value])=>({key,...value})))+
        note('Amounts use '+group.currency+'; hours remain hours and margin changes are percentage points. A currency absent from one plan has no comparative amount.')+
        jsonDetail('Cost coverage and unknown record counts',coverage);
    }).join(''):note('No amounts are entered in either plan for this section.'));
    return section('Economic coverage',table(['Coverage','Baseline','Candidate'],['occurrences','withEconomics','withoutEconomics'].map(key=>[esc(label(key)),esc(report.economicsCoverage.before[key]),esc(report.economicsCoverage.after[key])]))+
      note('Schedule-date rows without economic assumptions are excluded from currency totals. Unknown entered costs remain unvalued. One-time commissioning is separate from the selected schedule window.'))+
      costs('Recurring schedule economics',report.currencies)+costs('One-time commissioning workshares',report.workshareTotals)+
      section('Original network and asset amounts',report.assets.length?table(['Network / asset','Baseline atomic amount','Candidate atomic amount','Atomic change'],report.assets.map(row=>[esc(row.network+' / '+row.asset),comparisonValue(row.atomicAmount.before),comparisonValue(row.atomicAmount.after),comparisonDelta(row.atomicAmount.delta)])):note('No priced network/asset rows appear in these plans.'));
  }
  function comparisonTiming(report,interactive=true){
    const selectedMetric=state.comparisonMetric||'scheduledTasks',page=comparisonPage('comparison-days',report.days,interactive);
    const controls=interactive?'<label class="cp-comparison-metric">Calendar measure<select data-cp-comparison-metric>'+metrics.map(key=>'<option value="'+key+'"'+(key===selectedMetric?' selected':'')+'>'+esc(label(key))+'</option>').join('')+'</select></label>':'';
    const measures=interactive?[selectedMetric]:metrics;
    return section('UTC calendar comparison',note('Dates outside one selected window remain absent; they are not counted as zero use for that plan.')+controls+
      measures.map(key=>table(['UTC date','Baseline','Candidate','Change'],page.rows.map(row=>[esc(row.date),row.before?comparisonValue(row.metrics[key].before):esc('Outside window'),row.after?comparisonValue(row.metrics[key].after):esc('Outside window'),comparisonDelta(row.metrics[key].delta)]),label(key))).join('')+page.controls)+
      comparisonRowsTable('Schedule and completion changes','comparison-occurrences',report.occurrences,interactive);
  }
  function comparisonCapacity(report,interactive=true){
    const capacity=report.capacity;
    const pools=capacity.pools.length?capacity.pools.map(row=>'<h4>'+esc(row.after?.label||row.before?.label||row.id)+'</h4>'+
      table(['Assessment','Baseline','Candidate'],[['Capacity',esc(label(row.before?.status||'Absent')),esc(label(row.after?.status||'Absent'))],
        ['Unknown availability dates',comparisonValue(row.before?.unknownAvailabilityDates),comparisonValue(row.after?.unknownAvailabilityDates)],
        ['Unknown effort occurrences',comparisonValue(row.before?.unknownEffortOccurrences),comparisonValue(row.after?.unknownEffortOccurrences)]])+
      comparisonMetricTable(Object.entries(row.amounts).map(([key,value])=>({key,...value})))+
      jsonDetail('Dates with staffing shortfalls',{baseline:row.before?.overloadedDates??null,candidate:row.after?.overloadedDates??null})).join(''):note('Neither plan has entered a shared delivery pool.');
    const pricePage=comparisonPage('comparison-prices',report.servicePricing,interactive);
    const prices=report.servicePricing.length?pricePage.rows.map(row=>'<h4>'+esc(row.after?.label||row.before?.label||row.id)+'</h4>'+
      table(['Basis','Baseline','Candidate'],[['Currency',comparisonValue(row.before?.currency),comparisonValue(row.after?.currency)],
        ['Assessment',esc(label(row.before?.status||'Absent')),esc(label(row.after?.status||'Absent'))]])+
      comparisonMetricTable(Object.entries(row.counts).map(([key,value])=>({key,...value})))+
      comparisonMetricTable(Object.entries(row.amounts).map(([key,value])=>({key,...value})))+
      comparisonMetricTable([{key:'minimumMarginPct',...row.minimumMarginPct}])+
      jsonDetail('Complete service groups, schedules and unknown cost counts',{baseline:row.before,candidate:row.after})).join('')+pricePage.controls:note('Neither plan has a recurring service price group.');
    return section('Shared delivery capacity',table(['Assessment','Baseline','Candidate'],[['Overall',esc(label(capacity.status.before)),esc(label(capacity.status.after))]])+
      note('Capacity differences use active hours; each plan retains its exact calendar window. Known minimum extra hours sum daily shortages, so unused time on another day cannot cancel an overloaded date. Unknown availability and task effort remain unvalued.')+pools)+
      comparisonRowsTable('Delivery day changes','comparison-capacity-days',capacity.dayChanges,interactive)+
      comparisonRowsTable('Delivery week changes','comparison-capacity-weeks',capacity.weekChanges,interactive)+
      comparisonRowsTable('Unassigned effort changes','comparison-capacity-unassigned',capacity.unassigned,interactive)+
      comparisonRowsTable('Capacity sensitivity changes','comparison-capacity-sensitivity',capacity.sensitivity,interactive)+
      section('Complete service price groups',note('Monetary price differences require the same known currency on both sides. Margin changes are percentage points. New-charge units retain each selected service group, including shared prepaid allowances.')+prices);
  }
  function comparisonInputs(report,interactive=true){
    return section('Plan settings and original rule changes',report.inputChanges.settings.length?table(['Field','Baseline','Candidate'],report.inputChanges.settings.map(row=>[esc(label(row.key)),row.beforePresent?comparisonValue(row.before):esc('Absent'),row.afterPresent?comparisonValue(row.after):esc('Absent')])):note('Plan settings are unchanged.'))+
      report.inputChanges.collections.map(group=>comparisonRowsTable(label(group.kind),'comparison-input-'+group.kind,group.rows,interactive)).join('');
  }
  function comparisonOperators(report,interactive=true){
    return report.participants.map(group=>comparisonRowsTable(label(group.kind)+' results','comparison-result-'+group.kind,group.rows,interactive)).join('')+
      comparisonRowsTable('Prepaid groups','comparison-prepaid',report.passGroups,interactive)+
      comparisonRowsTable('Explicit funding groups','comparison-funding',report.fundingGroups||[],interactive)+
      comparisonRowsTable('Commissioning sensitivity','comparison-workshares',report.workshares,interactive)+
      comparisonRowsTable('Completion sensitivity','comparison-completion-sensitivity',report.sensitivity.completion,interactive)+
      comparisonRowsTable('Schedule effort sensitivity','comparison-effort-sensitivity',report.sensitivity.effort,interactive);
  }
  function comparisonFindings(report){
    return section('Changed planning findings',table(['Change','Finding','Scope','Detail'],[['Added',report.findings.added],['Resolved',report.findings.removed]].flatMap(([change,rows])=>rows.map(row=>[esc(change),esc(label(row.code)),esc(row.scope)+(row.id?'<small>'+esc(row.id)+'</small>':''),esc(row.message)]))));
  }
  function comparisonSources(report){
    return section('Complete source documents',note('The comparison JSON contains both complete original plan/report/edition documents and both freshly calculated reports. Each source keeps its original identity, notes and rule.')+
      '<div class="cp-actions">'+btn('Download baseline source JSON','comparison-source-json','data-side="before" data-cp-view="true"')+btn('Download candidate source JSON','comparison-source-json','data-side="after" data-cp-view="true"')+'</div>'+
      jsonDetail('Original source references',report.review.origins)+
      note('The native case ZIP carries saved comparisons alongside the original source editions and complete case history.'));
  }
  function comparisonSide(side){
    const value=comparisonState(),item=value[side],title=side==='before'?'Baseline':'Candidate';
    const options=[...(plan()?[['current','Current working draft']]:[]),
      ...(caseValue.sources||[]).filter(row=>row.filename?.startsWith('sf47-cohort-plan-tranche-')).map(row=>['source:'+row.id,row.filename]),
      ...state.priorDrafts.slice().reverse().map(row=>['prior:'+row.id,'Prior: '+row.plan.name+' · '+row.retainedAt])];
    const chosen=state.comparisonSelections[side];if(chosen&&!options.some(row=>row[0]===chosen))options.push([chosen,'Previously selected source · '+chosen]);
    const source=item?comparisonDocumentPlan(item.document):null;
    const changedDraft=item?.origin?.label==='Current draft'&&plan()&&JSON.stringify(source)!==JSON.stringify(plan());
    return '<section class="cp-panel"><h3>'+title+'</h3><label>Source<select data-cp-comparison-select="'+side+'">'+options.map(([id,text])=>'<option value="'+esc(id)+'"'+(id===chosen?' selected':'')+'>'+esc(text)+'</option>').join('')+'</select></label>'+
      '<div class="cp-actions">'+btn('Use selected source','comparison-select','data-side="'+side+'"',!options.length)+btn('Import source JSON','comparison-import-side','data-side="'+side+'"')+'</div>'+
      (source?'<p><strong>'+esc(source.name)+'</strong><br><small>'+esc(item.origin?.label||'Retained document')+' · '+esc(item.origin?.capturedAt||'')+'</small></p><p class="cp-identity">'+esc(source.source.programId)+' · source v'+esc(source.source.version)+'</p><p>'+esc(source.windowStart)+' · tranche '+esc(source.rule.target.tranche)+'</p>'+
        (changedDraft?note('The working draft changed after this capture. Use selected source again to compare the latest draft.'):'')+
        btn('Open '+title.toLowerCase()+' for editing','comparison-edit-side','data-side="'+side+'"'):empty('Choose a complete source for this side.'))+'</section>';
  }
  function comparisonView(){
    const value=comparisonState();let report=null,error='';
    try{report=comparisonReport();}catch(problem){error=problem.message;}
    const sections=[['summary','Summary & targets'],['timing','Calendar & completions'],['economics','Revenue & costs'],['capacity','Capacity & pricing'],['inputs','Input changes'],['operators','Operators & prepaid'],['sources','Source documents']];
    const selected=value.section||'summary';
    let body=report?(selected==='timing'?comparisonTiming(report):selected==='economics'?comparisonEconomics(report):selected==='capacity'?comparisonCapacity(report):selected==='inputs'?comparisonInputs(report):selected==='operators'?comparisonOperators(report):selected==='sources'?comparisonSources(report):comparisonBasis(report)+section('Planned workload',comparisonMetricTable(report.summary))+comparisonTargets(report)+comparisonFindings(report)):'';
    const history=state.comparisonHistory.length?'<details><summary>Prior local comparisons ('+state.comparisonHistory.length+')</summary>'+table(['Retained','Reason',''],state.comparisonHistory.slice().reverse().map(row=>[esc(row.retainedAt),esc(row.reason),btn('Restore comparison','comparison-restore','data-id="'+esc(row.id)+'"')]))+'</details>':'';
    const incoming=state.comparisonIncoming.length?section('Received sources awaiting adoption',table(['Received','Source',''],state.comparisonIncoming.map(row=>[esc(row.receivedAt),esc(row.origin?.filename||row.origin?.label||'Complete comparison'),btn('Adopt received source','comparison-adopt','data-id="'+esc(row.id)+'"')]))):'';
    return '<div class="cp-heading"><div><h3>Compare complete cohort plans</h3><p class="cp-note">Capture a baseline and candidate, review their differences, then continue the chosen plan in its original editor.</p></div><div class="cp-actions">'+btn('Import complete comparison','comparison-import')+btn('Swap baseline and candidate','comparison-swap','',!value.before||!value.after)+'</div></div>'+
      '<div class="cp-comparison-sides">'+comparisonSide('before')+comparisonSide('after')+'</div>'+
      section('Comparison notes','<div class="cp-fields"><label class="cp-wide">Comparison title<input data-cp-comparison-field="title" maxlength="1100" value="'+esc(value.title)+'" placeholder="'+esc(report?.review.title||'Name the alternatives being compared')+'"></label><label class="cp-wide">Review notes<textarea data-cp-comparison-field="note" maxlength="20000" rows="4">'+esc(value.note)+'</textarea></label></div>'+
        '<div class="cp-actions">'+btn('Save comparison in this case','comparison-save','data-cp-save="true"',!report)+btn('Download complete comparison JSON','comparison-json','data-cp-view="true"',!report)+btn('Download comparison CSV','comparison-csv','data-cp-view="true"',!report)+btn('Download readable comparison','comparison-html','data-cp-view="true"',!report)+'</div>'+
        (state.comparisonSavedSourceId?note('Saved comparison source: '+state.comparisonSavedSourceId):''))+
      (error?'<p class="cp-alert" role="alert">'+esc(error)+'</p>':'')+
      (report?'<nav class="cp-subtabs" aria-label="Plan comparison sections">'+sections.map(([id,title])=>btn(title,'comparison-section','data-section="'+id+'" data-cp-view="true" aria-current="'+(selected===id?'page':'false')+'"')).join('')+'</nav>'+body:empty('Select both complete sources to calculate their comparison.'))+incoming+history;
  }
  function readableComparisonHtml(report){
    const style='body{font:14px/1.5 system-ui,sans-serif;color:#242628;margin:32px;max-width:1500px}h1{font-size:26px}h2,h3{margin-top:24px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccd0d2;padding:7px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#f2f3f3}small{display:block;color:#555}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}.cp-table{overflow-x:auto}.cp-note{color:#555}.cp-panel{border:1px solid #ccd0d2;padding:14px;margin:16px 0}.cp-actions,button{display:none}@media(max-width:600px){body{margin:14px}.cp-panel{padding:10px}}@media print{body{margin:12mm}tr{break-inside:avoid}.cp-table{overflow:visible}}';
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(report.review.title)+'</title><style>'+style+'</style></head><body><header><p>SF47 Operations · cohort planning alternatives</p><h1>'+esc(report.review.title)+'</h1><p style="white-space:pre-wrap">'+esc(report.review.note)+'</p></header>'+
      comparisonBasis(report)+section('Planned workload',comparisonMetricTable(report.summary))+comparisonTargets(report)+comparisonEconomics(report)+comparisonCapacity(report,false)+comparisonTiming(report,false)+comparisonInputs(report,false)+comparisonOperators(report,false)+comparisonFindings(report)+
      section('Original source references',jsonDetail('Source references',report.review.origins))+
      section('Complete original baseline document',jsonDetail('Baseline JSON',report.documents.before))+
      section('Complete original candidate document',jsonDetail('Candidate JSON',report.documents.after))+
      '<p>Exported '+esc(now())+'. The complete comparison JSON preserves both source documents and full recalculated reports for reopening.</p></body></html>';
  }


  function ensureScheduling(){
    if(!plan())throw new Error('Open the complete customer-use plan first.');
    plan().deliveryScheduling=seedCohortDeliveryScheduling(plan());changed();
  }
  function schedulingOptionsFor(result){
    return result?.resolution?{method:'RESOLVE_CONFLICTS',maxSearchSteps:result.resolution.maxSearchSteps}:{method:'FIRST_FIT'};
  }
  function selectedSchedulingOptions(){
    return copy(state.schedulingOptions||schedulingOptionsFor(state.schedulingResult));
  }
  function schedulingMatches(){
    if(!state.schedulingResult||!plan())return false;
    const current=JSON.stringify(plan()),selected=selectedSchedulingOptions(),retained=schedulingOptionsFor(state.schedulingResult);
    if(selected.method!==retained.method||selected.method==='RESOLVE_CONFLICTS'&&selected.maxSearchSteps!==retained.maxSearchSteps)return false;
    return current===state.schedulingInput||current===JSON.stringify(state.schedulingResult.candidate);
  }
  function schedulingApplied(){return Boolean(state.schedulingResult&&JSON.stringify(plan())===JSON.stringify(state.schedulingResult.candidate));}
  function schedulingReview(result,interactive=true){
    const page=comparisonPage('scheduling-results',result.assignments,interactive);
    const summary=result.summary;
    return section('Delivery allocation',table(['Placement','Occurrences','Moved','Needs input','Capacity before','Capacity after'],[
      [esc(label(summary.status)),esc(summary.occurrences),esc(summary.moved),esc(summary.unresolved),esc(label(summary.capacityBefore)),esc(label(summary.capacityAfter))]
    ])+note(result.method)+
      (result.resolution?table(['Reconsidered service groups','Placed groups','Revised dates','Search effort'],[[
        esc(result.resolution.reconsideredGroups),esc(result.resolution.resolvedGroups),esc(result.resolution.revisedDates),
        esc(result.resolution.visitedSteps)+' / '+esc(result.resolution.maxSearchSteps)
      ]])+jsonDetail('Complete competing-date decisions',result.resolution):'')+
      table(['Original occurrence','Date / complete output','Effort / pool','Result','Constraint and decision'],page.rows.map(row=>[
        '<strong>'+esc(row.label)+'</strong><small>'+esc(row.occurrenceId)+'</small><small>Original cadence '+esc(row.sourceDate)+'</small>',
        esc(row.originalDate)+' → '+esc(row.date)+'<small>'+esc(row.plannedCompleteAt)+'</small>',
        esc(decimal(row.requiredHours))+' hours<small>'+esc(row.capacityPoolId||'Unassigned')+'</small>',
        esc(label(row.status))+(row.fixedReason?'<small>'+esc(label(row.fixedReason))+'</small>':''),
        (row.issues.length?row.issues.map(issue=>'<p>'+esc(issue.message)+'</p>').join(''):esc(row.moved?'Placed within the entered service window.':'Retained complete work.'))+
          '<details><summary>Complete dates and constraints</summary>'+
          jsonDetail('Service policy',result.constraints.schedules.find(policy=>policy.scheduleId===row.scheduleId))+
          jsonDetail('Exact placement findings',row.issues)+jsonDetail('Permitted dates',row.permittedDates)+
          jsonDetail('Reviewed dates with capacity or sequence constraints',row.rejectedDates)+'</details>'+
          (interactive?btn('Edit service rule','scheduling-policy','data-id="'+esc(row.scheduleId)+'"')+
            btn('Edit effort and pool','edit','data-kind="schedules" data-id="'+esc(row.scheduleId)+'"'):'')
      ]))+page.controls);
  }
  function schedulingView(){
    if(!plan()?.deliveryScheduling)return section('Schedule delivery',
      note('Open the complete plan, enter its shared delivery capacity and task effort, then set the service’s permitted movement and deadlines.'),
      btn('Set up delivery scheduling','scheduling-setup'));
    const settings=plan().deliveryScheduling, data=filteredRows('schedules');
    const policyById=new Map(settings.schedules.map((row,index)=>[row.scheduleId,{row,index}]));
    const chosen=policyById.get(state.schedulingEditorId), result=state.schedulingResult, fresh=schedulingMatches(), allocationOptions=selectedSchedulingOptions();
    const listing=section('Service flexibility',
      '<div class="cp-fields">'+
      field('Allocation method','',allocationOptions.method,{options:[['FIRST_FIT','Original service order'],['RESOLVE_CONFLICTS','Resolve competing dates']],attrs:'data-cp-scheduling-option="method"'})+
      (allocationOptions.method==='RESOLVE_CONFLICTS'?field('Search effort','',String(allocationOptions.maxSearchSteps),{
        options:[['100000','Standard'],['1000000','Extended'],...([100000,1000000].includes(allocationOptions.maxSearchSteps)?[]:[[String(allocationOptions.maxSearchSteps),'Saved effort · '+allocationOptions.maxSearchSteps]])],
        attrs:'data-cp-scheduling-option="maxSearchSteps"',help:'Revisit complete competing services; every accepted result keeps all their constraints and funding.'
      }):'')+'</div>'+
      '<section data-cp-plan><div class="cp-fields">'+
      field('Date preference','deliveryScheduling.strategy',settings.strategy,{options:[['NEAREST','Nearest original service date'],['EARLIEST','Earliest permitted date']]})+
      field('Scheduling basis','deliveryScheduling.note',settings.note,{area:true,wide:true,help:'Retain the customer’s actual flexibility, deadline and staffing assumptions.'})+'</div></section>'+
      note('Each original occurrence remains whole. Future service moves only when its row permits it. Past work, purchase dates and cancelled rows retain their original meanings.')+
      table(['Service','Movement','Release / completion deadline','Priority / spacing',''],data.rows.map(schedule=>{
        const policy=policyById.get(schedule.id)?.row;
        return ['<strong>'+esc(schedule.label)+'</strong><small>'+esc(schedule.id)+'</small>',
          policy?.flexible?esc(policy.advanceDays)+' days earlier / '+esc(policy.delayDays)+' days later':esc('Fixed dates'),
          esc(policy?.releaseDate||'Original window')+'<small>'+esc(policy?.dueDate||'Original completion window')+'</small>',
          esc(policy?.priority??0)+' / '+esc(policy?.minimumGapDays??0)+' days',
          btn('Edit service rule','scheduling-policy','data-id="'+esc(schedule.id)+'"')];
      }))+pager('schedules',data)+
      '<div class="cp-actions">'+btn('Calculate delivery dates','scheduling-calculate')+
      btn('Edit capacity and pricing','tab','data-tab="capacity"')+btn('Download scheduling choices','scheduling-choices','data-cp-view="true"')+'</div>');
    let edit='';
    if(chosen){
      const {row,index}=chosen,prefix='deliveryScheduling.schedules.'+index+'.';
      edit=section('Service rule · '+(plan().schedules.find(item=>item.id===row.scheduleId)?.label||row.scheduleId),
        '<section data-cp-plan><div class="cp-fields">'+
        field('Permit date movement',prefix+'flexible',row.flexible,{checkbox:true})+
        field('Days earlier than original occurrence',prefix+'advanceDays',row.advanceDays,{type:'number',min:0,step:'1',attrs:'data-cp-format="integer"'})+
        field('Days later than original occurrence',prefix+'delayDays',row.delayDays,{type:'number',min:0,step:'1',attrs:'data-cp-format="integer"'})+
        field('Release date',prefix+'releaseDate',row.releaseDate,{type:'date',attrs:'data-cp-format="nullable"'})+
        field('Complete output due by',prefix+'dueDate',row.dueDate,{type:'date',attrs:'data-cp-format="nullable"',help:'End of this UTC date; the original output delay still applies.'})+
        field('Priority',prefix+'priority',row.priority,{type:'number',min:0,step:'1',attrs:'data-cp-format="integer"',help:'Larger numbers receive shared capacity first.'})+
        field('Minimum days between this service’s occurrences',prefix+'minimumGapDays',row.minimumGapDays,{type:'number',min:0,step:'1',attrs:'data-cp-format="integer"'})+
        '<fieldset class="cp-wide"><legend>Permitted delivery weekdays</legend>'+dayChecks(prefix+'weekdays',row.weekdays)+'</fieldset>'+
        field('Original commitment and flexibility note',prefix+'note',row.note,{area:true,wide:true})+
        '</div></section><div class="cp-actions">'+btn('Calculate with these choices','scheduling-calculate')+
        btn('Edit effort and pool','edit','data-kind="schedules" data-id="'+esc(row.scheduleId)+'"')+'</div>');
    }
    return listing+edit+(result?
      (!fresh?'<p class="cp-alert">Inputs changed after this allocation. Calculate the current choices before adopting its dates.</p>':'')+
      schedulingReview(result)+
      section('Continue the complete plan',note('A saved successor carries the complete allocation, original source document, both comparison plans and all editable service choices in the existing case source edition.')+
        '<div class="cp-actions">'+btn('Use dated successor','scheduling-adopt','',!fresh||schedulingApplied())+
        btn('Save successor and comparison','scheduling-save','data-cp-save="true"',!fresh)+
        btn('Open full comparison','scheduling-compare','',!fresh)+
        btn('Download complete scheduling JSON','scheduling-json','data-cp-view="true"')+
        btn('Download allocation CSV','scheduling-csv','data-cp-view="true"')+
        btn('Download readable allocation','scheduling-html','data-cp-view="true"')+'</div>'):'');
  }
  function calculateScheduling(){
    ensureScheduling();
    state.schedulingResult=scheduleCohortDelivery(copy(plan()),copy(plan().deliveryScheduling),selectedSchedulingOptions());
    state.schedulingOptions=schedulingOptionsFor(state.schedulingResult);
    state.schedulingInput=JSON.stringify(plan());persist();
    state.notice=state.schedulingResult.resolution?'Reconsidered complete competing service groups and retained every original occurrence, capacity constraint and funding group.':'Calculated every original occurrence against the entered service windows and shared capacity.';
  }
  function captureSchedulingComparison(result){
    retainComparison('Opened the complete delivery scheduling comparison');
    state.comparison={before:{document:copy(result.sourceDocument),origin:{label:'Original delivery plan',caseId:plan().source.programId}},
      after:{document:copy(result.candidate),origin:{label:'Dated delivery successor',caseId:plan().source.programId}},
      title:result.candidate.name+' · delivery allocation',note:result.constraints.note||'',section:'capacity'};
    state.comparisonSavedSourceId=null;comparisonCacheKey='';persist();
  }
  function adoptScheduling(){
    if(!schedulingMatches())throw new Error('Calculate the current service choices before adopting their dates.');
    const result=reopenCohortDeliverySchedule(state.schedulingResult);
    if(!schedulingApplied()){
      rememberPrior('Applied the reviewed delivery allocation');
      state.plan=copy(result.candidate);state.savedEnvelope=null;state.savedSourceId=null;
      state.editor=null;state.editorDraft=null;state.pages={};evaluate();
    }
    captureSchedulingComparison(result);state.tab='scheduling';
    state.notice='Opened the full dated successor. Original work, funding groups, source dates and the complete comparison remain available.';
  }
  function readableSchedulingHtml(result){
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+
      esc(result.candidate.name)+' · delivery allocation</title><style>body{font:14px/1.5 system-ui,sans-serif;color:#222;margin:32px;max-width:1500px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}th{background:#f3f3f3}small{display:block}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{display:none}.cp-table{overflow:auto}@media print{body{margin:12mm}tr{break-inside:avoid}}</style></head><body><h1>'+
      esc(result.candidate.name)+'</h1><p>Original case '+esc(result.candidate.source.programId)+' · '+esc(result.report.window.start)+'–'+esc(result.report.window.end)+'</p>'+
      schedulingReview(result,false)+jsonDetail('Complete scheduling choices',result.constraints)+jsonDetail('Complete original plan document',result.sourceDocument)+
      jsonDetail('Complete editable successor',result.candidate)+'</body></html>';
  }


  function workingGraph(){
    state.workingSnapshots??={};state.workingHistory??=[];state.workingIncoming??=[];
    return {snapshots:state.workingSnapshots,history:state.workingHistory,incoming:state.workingIncoming};
  }
  function workingFingerprint(){
    return JSON.stringify([captureCohortPlanningState(state),state.workingSnapshots,state.workingHistory,state.workingIncoming]);
  }
  async function workingDocument(selected=null){
    workingGraph();
    const value=selected?{...copy(state.workingSnapshots[selected.snapshotSha256]),workingSnapshots:state.workingSnapshots,
      workingHistory:state.workingHistory,workingIncoming:state.workingIncoming}:state;
    return createCohortWorkingSession(value,{sessionId:uid('working-session'),exportedAt:now(),transportActive:Boolean(state.inflight)});
  }
  async function downloadWorkingSession(selected=null){
    const document=await workingDocument(selected),raw=JSON.stringify(document,null,2)+'\n';
    if(new TextEncoder().encode(raw).length>COHORT_WORKING_SESSION_MAX_BYTES)
      throw new Error('The complete readable working session exceeds 64 MiB. Keep the original case and its retained source exports.');
    download(raw,cleanName(document.snapshots[document.current.snapshotSha256].plan?.name||caseValue.program.name)+'-working-session.json');
  }
  async function mergeWorkingSession(document,origin){
    workingGraph();
    const durable=await storeCohortWorkingSnapshots(caseId,{...state.workingSnapshots,...document.snapshots});
    workingGraph();
    const snapshots={...state.workingSnapshots};
    for(const [id,snapshot] of Object.entries(document.snapshots)){
      if(snapshots[id]&&JSON.stringify(snapshots[id])!==JSON.stringify(snapshot))
        throw new Error('A retained snapshot identity differs from the incoming complete state.');
      snapshots[id]=copy(snapshot);
    }
    const history=copy(state.workingHistory),incoming=copy(state.workingIncoming);
    const all=new Map([...history,...incoming].map(row=>[row.id,row]));
    const items=[['incoming',document.current],...document.history.map(row=>['history',row]),...document.incoming.map(row=>['incoming',row])];
    for(let index=0;index<items.length;index++){
      const [kind,row]=items[index],id='working-import-'+origin.sha256+'-'+index;
      if(all.has(id)){if(all.get(id).snapshotSha256!==row.snapshotSha256)throw new Error('The incoming working entry differs from its prior retained source.');continue;}
      const entry={...copy(row),id,origin:{...copy(row.origin||{}),importedFrom:{...copy(origin),sessionId:document.sessionId,
        exportedAt:document.exportedAt,entryId:row.id}},reason:index===0?'Opened complete working session: '+origin.filename:row.reason};
      (kind==='history'?history:incoming).push(entry);all.set(id,entry);
    }
    state.workingSnapshots=snapshots;state.workingHistory=history;state.workingIncoming=incoming;
    state.workingStorage=durable?'INDEXED_DB':'INLINE';state.workingSnapshotIds=durable?Object.keys(snapshots):[];
    state.notice='The complete incoming working session is retained in Saved editions. Review it and choose Open as working session; current edits remain selected.';
    persist();
  }
  async function importWorkingSession(){
    const file=await chooseFile('.json,application/json');if(!file)return;
    if(file.size>COHORT_WORKING_SESSION_MAX_BYTES)throw new Error('Choose a complete working session no larger than 64 MiB.');
    const raw=await file.text();
    if(new TextEncoder().encode(raw).length>COHORT_WORKING_SESSION_MAX_BYTES)throw new Error('The complete working session exceeds 64 MiB.');
    const document=await reopenCohortWorkingSession(raw.replace(/^\uFEFF/,''),{caseId});
    const sha256=await cohortWorkingSessionSha256(raw);
    // File reads always enter this data-only inbox. Disposed mounts share the original state object.
    await mergeWorkingSession(document,{filename:file.name,bytes:new TextEncoder().encode(raw).length,sha256,receivedAt:now()});
    if(available())state.tab='editions';
    persist();
  }
  async function adoptWorkingSession(id){
    workingGraph();
    if(isPending())throw new Error('Continue the original source request before replacing its working editor.');
    const entry=[...state.workingIncoming,...state.workingHistory].find(row=>row.id===id);
    if(!entry)throw new Error('Choose a retained complete working session.');
    const expected=workingFingerprint(),original=await workingDocument();
    const next=await saveApi(prefix);
    if(next?.program?.id!==caseId)throw new Error('The current readback belongs to a different original case.');
    if(!available()||isPending()||workingFingerprint()!==expected)
      throw new Error('The working selection changed during source readback. The incoming session remains in Saved editions for explicit opening.');
    const incoming=copy(state.workingSnapshots[entry.snapshotSha256]);
    const snapshots={...copy(state.workingSnapshots),...original.snapshots};
    const history=copy(state.workingHistory),queued=state.workingIncoming.filter(row=>row.id!==id).map(copy);
    history.push({...original.current,reason:'Prior work before opening '+entry.id,origin:{caseId,selectedEntryId:entry.id}});
    if(!history.some(row=>row.id===entry.id))history.push({...copy(entry),reason:'Opened original working session: '+entry.reason});
    const durable=await storeCohortWorkingSnapshots(caseId,snapshots);
    if(!available()||isPending()||workingFingerprint()!==expected)throw new Error('The current editor changed while retaining the complete predecessor. The incoming working session remains selected for later review.');
    const candidate={...incoming,workingSnapshots:snapshots,workingHistory:history,workingIncoming:queued,
      workingStorage:durable?'INDEXED_DB':'INLINE',workingSnapshotIds:durable?Object.keys(snapshots):[],
      inflight:null,error:'',storageWarning:'',notice:'Opened the complete retained working session. Its previous editor and all source selections remain in Saved editions.'};
    // Persist the complete successor before replacing the shared state object. A storage failure retains both selections.
    const retained={};for(const key of [...COHORT_WORKING_STATE_FIELDS,'workingSnapshots','workingHistory','workingIncoming','workingStorage','workingSnapshotIds'])
      if(candidate[key]!==undefined)retained[key]=candidate[key];
    if(durable)delete retained.workingSnapshots;
    try{sessionStorage.setItem(storageKey,JSON.stringify(retained));}
    catch(error){throw new Error('The browser could not retain the complete opened session. Download the working-session JSON to keep all selections; the current editor remains open. '+error.message);}
    planningReadSequence++;comparisonReadSequence++;
    for(const key of Object.keys(state))delete state[key];
    Object.assign(state,candidate);caseValue=next;comparisonCacheKey='';comparisonCache=null;
    state.tab='editions';
  }
  function workingSessionsView(){
    const graph=workingGraph();
    if([...graph.history,...graph.incoming].some(row=>!graph.snapshots[row.snapshotSha256]))return section('Complete working session',note('Opening the complete retained working archive. The current plan remains selected.')+btn('Open working-session JSON','working-import','data-cp-view="true"'));
    const rows=values=>values.slice().reverse().map(row=>{
      const snapshot=graph.snapshots[row.snapshotSha256],summary=describeCohortWorkingState(snapshot);
      return [esc(row.retainedAt)+'<small>'+esc(row.reason)+'</small>',
        '<strong>'+esc(summary.name)+'</strong><small>Tranche '+esc(summary.tranche)+' · source v'+esc(summary.sourceVersion)+'</small>'+
        '<small>'+summary.unfinishedRows+' unfinished rows · '+summary.priorDrafts+' earlier drafts · '+summary.comparisonHistory+' comparison revisions · '+summary.incomingSources+' incoming sources</small>'+
        (summary.allocationMethod?'<small>Allocation: '+esc(summary.allocationMethod)+'</small>':'')+
        (summary.originalRequest?'<small>Original source request: '+esc(summary.originalRequest)+' · '+esc(summary.requestId)+'</small>':'')+
        (row.transportActive?'<small>The original source transport was active when this state was captured. Its same-request continuation is retained.</small>':''),
        '<span class="cp-identity">'+esc(row.snapshotSha256)+'</span><small>'+esc(row.origin?.importedFrom?.filename||row.origin?.filename||'Original working state')+'</small>',
        btn('Open as working session','working-adopt','data-id="'+esc(row.id)+'"',isPending())+' '+btn('Download complete session','working-selected-json','data-id="'+esc(row.id)+'" data-cp-view="true"')];
    });
    return section('Complete working session',
      note('Carry the entire original case editor between browsers: unfinished input text, prior drafts, both comparison sources and history, allocation choices, incoming source documents and the exact pending or accepted save request. Opening a file first retains it beside current work; opening its selected state preserves the predecessor.')+
      '<div class="cp-actions">'+btn('Download working session','working-json','data-cp-view="true"')+
      btn('Open working-session JSON','working-import','data-cp-view="true"')+'</div>'+
      (graph.incoming.length?'<h4>Incoming working sessions</h4>'+table(['Retained','Complete work','Original identity',''],rows(graph.incoming)):'')+
      (graph.history.length?'<h4>Earlier working sessions</h4>'+table(['Retained','Complete work','Original identity',''],rows(graph.history)):''));
  }


  

  function taskMeasurementEditor(){
    if(!state.recordedCostMeasurementEditor)state.recordedCostMeasurementEditor={sourceId:'',source:null,kind:'INSTALLED',observationId:'',serviceBasis:''};
    return state.recordedCostMeasurementEditor;
  }
  function taskMeasurementView(){
    const editor=taskMeasurementEditor(),catalog=editor.source?inspectCohortTaskMeasurements(editor.source):null;
    const sources=(caseValue.sources||[]).filter(row=>row.customerTaskOutcomes?.schema==='stellar-forge.sf47-customer-task-outcomes.v1');
    const current=state.recordedCostDraft?.measurement;
    return '<fieldset><legend>Use a saved task measurement</legend>'+note('Select the original saved comparison and one complete installed or recurring task. Its count and unit are retained from that source; measurement basis, operator review and customer response stay separate. Refreshing the source list does not replace the current allocation.')+
      '<label>Saved measurement edition<select data-cp-task-measurement="sourceId"><option value="">Select original comparison…</option>'+
      sources.map(row=>'<option value="'+esc(row.id)+'"'+(editor.sourceId===row.id?' selected':'')+'>'+esc(row.filename)+' · r'+esc(row.customerTaskOutcomes.revision)+'</option>').join('')+'</select></label>'+
      btn('Open selected saved measurement','recorded-task-load','',!editor.sourceId)+
      (catalog?'<p><strong>'+esc(catalog.customer)+' — '+esc(catalog.task)+'</strong><br>'+esc(catalog.comparisonId)+' · revision '+esc(catalog.revision)+' · '+esc(catalog.unit)+'<br>Original measurement case '+esc(catalog.caseId)+'<br>Selected receiving case '+esc(caseId)+'</p>'+
        '<label>Original installed / recurring task<select data-cp-task-observation>'+catalog.observations.map(row=>'<option value="'+esc(JSON.stringify([row.kind,row.observationId]))+'"'+(row.kind===editor.kind&&row.observationId===editor.observationId?' selected':'')+'>'+esc(row.label)+' · '+esc(fmt(row.quantity))+' '+esc(row.unit)+' · '+esc(row.basis)+'</option>').join('')+'</select></label>'+
        table(['Task','Count','Original basis / state','Customer response','Source and scope'],catalog.observations.map(row=>[esc(row.label),esc(fmt(row.quantity))+' '+esc(row.unit),esc(row.basis)+' / '+esc(row.status),esc(row.acceptance?.status||'Not recorded for initial method'),esc(row.method.sourceReference)+'<br>'+esc(row.method.population)+'<br>'+esc(row.method.period)+'<br>'+esc(row.method.output)+'<br>'+esc(row.method.quality)+(row.usable?'':'<br>'+esc(row.unavailable.join(' ')))]))+
        '<label>Why this task and selected costs describe the same service output<textarea data-cp-task-measurement="serviceBasis">'+esc(editor.serviceBasis)+'</textarea></label>'+
        btn('Use this complete measurement in allocation','recorded-task-bind')+
        jsonDetail('Complete original saved task comparison and selected sources',catalog.original):'')+
      (current?note('Allocation is bound to '+current.original.edition.id+' revision '+current.original.edition.revision+' / '+current.kind+(current.observationId?' / '+current.observationId:'')+'. Keep this source or explicitly select another edition.')+btn('Continue with a manual denominator; retain prior measurement','recorded-task-manual')+jsonDetail('Current allocation’s original measurement',current):'')+
      (state.recordedCostDraft?.measurementHistory?.length?jsonDetail('Earlier retained measurement choices',state.recordedCostDraft.measurementHistory):'')+'</fieldset>';
  }
  async function loadTaskMeasurement(){
    const editor=taskMeasurementEditor(),selected=editor.sourceId;
    await refreshSource();
    const meta=caseValue.sources.find(row=>row.id===selected&&row.customerTaskOutcomes?.schema==='stellar-forge.sf47-customer-task-outcomes.v1');
    if(!meta)throw new Error('Select an original saved Task Outcomes source in this case.');
    const mark=meta.customerTaskOutcomes;
    const native=await saveApi(prefix+'/task-outcomes/'+encodeURIComponent(mark.id)+'?revision='+mark.revision);
    const raw=JSON.parse(await readSource(meta));
    const equal=(a,b)=>{const order=x=>Array.isArray(x)?x.map(order):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,order(x[k])])):x;return JSON.stringify(order(a))===JSON.stringify(order(b));};
    if(!equal(native.source,meta)||!equal(native.edition,raw))throw new Error('The saved task response differs from its original retained source. Refresh the selection.');
    const catalog=inspectCohortTaskMeasurements(native);
    if(editor!==state.recordedCostMeasurementEditor||editor.sourceId!==selected)throw new Error('The measurement selection changed while its source was opening. Current work is retained.');
    editor.source=copy(catalog.original);
    if(!catalog.observations.some(row=>row.kind===editor.kind&&row.observationId===editor.observationId)){editor.kind='INSTALLED';editor.observationId='';}
    state.notice='Opened the exact saved measurement. Review its complete scope and explicitly use it in the allocation.';
  }
  function bindTaskMeasurement(){
    const editor=taskMeasurementEditor();
    if(!editor.source||editor.source.source.id!==editor.sourceId)throw new Error('Open the currently selected original measurement first.');
    state.recordedCostDraft=bindCohortRecordedCostMeasurement(state.recordedCostDraft||{},editor.source,
      {kind:editor.kind,observationId:editor.observationId,serviceBasis:editor.serviceBasis,caseId});
    state.notice='Retained the original count, unit, complete saved comparison and explicit service relationship. Keep the allocation, then calculate the whole future plan.';
  }
  function manualTaskMeasurement(){
    const draft=state.recordedCostDraft||{};
    if(draft.measurement){
      draft.measurementHistory=[...(draft.measurementHistory||[]),{measurement:copy(draft.measurement),outputQuantity:draft.outputQuantity,outputUnit:draft.outputUnit,outputSource:draft.outputSource}];
      delete draft.measurement;
    }
    state.recordedCostDraft=draft;
    state.notice='The allocation is editable manually; its earlier saved measurement remains retained.';
  }
  function recordedCostState(){
    if(!state.recordedCostChoices)state.recordedCostChoices={name:plan()?.name+' · recorded cost basis',note:'',quantityBasis:'COMPLETED_TASKS',allocations:[]};
    return state.recordedCostChoices;
  }
  function recordedCostView(){
    const source=state.recordedCostSource,commercial=source?.commercial,choices=recordedCostState(),preview=state.recordedCostPreview;
    const options=(caseValue.sources||[]).filter(row=>row.filename?.startsWith('sf47-cohort-delivery-'));
    const select=(name,rows,value)=>'<select name="'+esc(name)+'">'+rows.map(([id,title])=>'<option value="'+esc(id)+'"'+(id===value?' selected':'')+'>'+esc(title)+'</option>').join('')+'</select>';
    const input=(name,value='')=>'<input name="'+esc(name)+'" value="'+esc(value)+'"'+(state.recordedCostDraft?.measurement&&['outputQuantity','outputUnit','outputSource'].includes(name)?' readonly':'')+'>';
    const draft=state.recordedCostDraft||{},selected=choices.allocations.find(row=>row.id===draft.id);
    const parts=draft.costs||selected?.costs||[];
    return section('Recorded costs → future plan',note('Open the intended future plan first. Choose the complete saved delivery reconciliation, identify the useful output actually delivered, and select its cost portions. This changes only the future schedules you select. Existing funding groups, purchased prices, dates and source records remain attached to their original documents.')+
      '<div class="cp-actions"><label>Original delivery edition<select data-cp-recorded-source><option value="">Select saved comparison…</option>'+options.map(row=>'<option value="'+esc(row.id)+'"'+(state.recordedCostSelectedSource===row.id?' selected':'')+'>'+esc(row.filename)+'</option>').join('')+'</select></label>'+
      btn(source?'Refresh selected original and keep choices':'Open original commercial result','recorded-cost-load','',!state.recordedCostSelectedSource||!plan())+
      btn('Capture current plan as future baseline','recorded-cost-baseline','',!plan())+'</div>'+
      (state.recordedCostBaseline?note('Future baseline: '+(state.recordedCostBaseline.plan?.name||state.recordedCostBaseline.name||state.recordedCostBaseline.input?.name)+'. Its complete original document is retained.'):note('Opening the source captures the current complete plan as the baseline.')))+
      (commercial?section('Measured output and actual cost portions',
        jsonDetail('Complete original recorded result and frozen sources',source)+
        table(['Original service','Recorded cost','Source rows'],commercial.services.map(row=>[esc(row.label),esc(row.knownRecordedCost)+' '+esc(commercial.currency),esc(row.recordedCostIds.join(', '))]))+
        '<form data-cp-recorded-cost-form class="cp-form"><label>Allocation identity'+input('id',draft.id||'')+'</label>'+
        '<label>Future schedule'+select('targetScheduleId',rowOptions('schedules'),draft.targetScheduleId)+'</label>'+
        '<label>Original service'+select('sourceServiceId',commercial.services.map(row=>[row.id,row.label]),draft.sourceServiceId)+'</label>'+
        taskMeasurementView()+
        '<label>Completed useful tasks'+input('outputQuantity',draft.outputQuantity||'')+'</label>'+
        '<label>Useful-output unit'+input('outputUnit',draft.outputUnit||'')+'</label>'+
        '<label>Original measurement/source basis'+input('outputSource',draft.outputSource||'')+'</label>'+
        '<label>Supplier cost coverage'+select('supplierCoverage',[['PARTIAL','Partial / unknown remainder'],['COMPLETE','Complete for this measured output']],draft.supplierCoverage)+'</label>'+
        '<label>Labor coverage'+select('laborCoverage',[['PARTIAL','Partial / unknown remainder'],['COMPLETE','Complete for this measured output']],draft.laborCoverage)+'</label>'+
        '<label>Coverage and distinct-cost explanation'+input('coverageNote',draft.coverageNote||'')+'</label>'+
        table(['Select actual portion (0–1)','Original service / cost','Kind','Amount / hours','Source'],commercial.costs.filter(row=>['SUPPLIER','OTHER','LABOR'].includes(row.costType)).map(row=>[
          '<input name="share:'+esc(row.id)+'" value="'+esc(parts.find(item=>item.costId===row.id)?.share||'')+'" aria-label="'+esc('Portion of '+row.label)+'">',
          esc(row.serviceId)+'<br>'+esc(row.label),esc(row.costType),esc(fmt(row.calculatedAmount))+' '+esc(commercial.currency)+'<br>'+esc(fmt(row.activeHours))+' hours',
          esc(row.sourceReference)+(row.originalCost?'<small>'+esc(row.originalCost.recordId)+' / '+esc(row.originalCost.lineId)+'</small>':'')]))+
        '<button type="submit">Keep complete allocation</button>'+btn('Clear allocation form','recorded-cost-clear')+'</form>'+
        note('Count completed useful tasks. One measured result must correspond to one complete future task; explain that relationship in the source or saved measurement basis. Supplier cost per task is distributed across the selected schedule’s requests per task. Labor hours stay per task. Leave an unselected cost share empty; all shares of each cost total at most 1. Payment fees retain their original model. Partial coverage stays unknown; complete coverage needs its entered explanation.')+
        table(['Allocation','Future schedule','Measured output','Coverage',''],choices.allocations.map(row=>[esc(row.id),esc(row.targetScheduleId),esc(row.outputQuantity)+' '+esc(row.outputUnit)+(row.measurement?'<small>'+esc(row.measurement.original.edition.id)+' / r'+esc(row.measurement.original.edition.revision)+'</small>':''),esc(row.supplierCoverage)+' supplier / '+esc(row.laborCoverage)+' labor',btn('Edit','recorded-cost-edit','data-id="'+esc(row.id)+'"')+btn('Remove','recorded-cost-remove','data-id="'+esc(row.id)+'"')]))+
        '<label>Successor name<input data-cp-recorded-choice="name" value="'+esc(choices.name)+'"></label><label>Planning note<textarea data-cp-recorded-choice="note">'+esc(choices.note)+'</textarea></label>'+
        '<div class="cp-actions">'+btn('Calculate complete successor','recorded-cost-calculate','',!choices.allocations.length)+btn('Download full editable source and choices','recorded-cost-working')+'</div>'):'')+
      (preview?section('Reviewed cost basis and prospective result',
        (preview.choices.quantityBasis?note('Supplier / task is the selected useful-output cost. Supplier / request is the rate used by the original calculator. The request multiplier is taken from the retained future schedule.'):note('This historical proposal retains its original calculation. Choose Calculate complete successor to convert completed tasks into the selected schedule’s request units before applying a new cost basis.'))+
        table(['Future schedule','Measured tasks','Requests / task','Corresponding requests','Supplier / task','Supplier / request','Hours / task','Hourly cost'],preview.derivations.map(row=>[esc(row.targetScheduleId),esc(row.outputQuantity)+' '+esc(row.outputUnit),esc(fmt(row.quantityBasis?.requestsPerTask)),esc(fmt(row.quantityBasis?.correspondingRequests)),esc(fmt(row.quantityBasis?.supplierCostPerTask)),esc(fmt(row.derivedEconomics.unitCost)),esc(fmt(row.derivedEconomics.activeHoursPerTask)),esc(fmt(row.derivedEconomics.hourlyCost))]))+
        table(['Future schedule','Original measurement','Basis / review','Customer response','Service relationship'],preview.derivations.filter(row=>row.measurement).map(row=>[esc(row.targetScheduleId),esc(row.measurement.comparisonId)+' / r'+esc(row.measurement.revision)+' / '+esc(row.measurement.observationId||'Installed'),esc(row.measurement.basis)+' / '+esc(row.measurement.status),esc(row.measurement.acceptance?.status||'Not recorded for initial method'),esc(row.measurement.serviceBasis)]))+
        table(['Actual cost row','Selected share','Unselected share'],preview.costBalances.map(row=>[esc(row.costId),esc(row.selectedShare),esc(row.unselectedShare)]))+
        '<div class="cp-actions">'+btn('Apply to editable future plan','recorded-cost-adopt')+btn('Apply and save complete edition','recorded-cost-save')+
        btn('Open before / after comparison','recorded-cost-compare')+btn('Complete JSON','recorded-cost-json')+btn('Complete CSV','recorded-cost-csv')+'</div>'+
        moneyReport(preview.report)+capacityReport(preview.report)+servicePricingReport(preview.report)+jsonDetail('Complete original costs, future baseline, choices and derived plan',preview)):'')+
      (state.recordedCostPlan?section('Applied original cost basis',note('This immutable proposal remains with the editable successor. Further manual plan edits are shown separately in its complete saved comparison.')+jsonDetail('Retained applied proposal',state.recordedCostPlan)):'');
  }
  async function loadRecordedCostSource(){
    if(!plan())throw new Error('Open the intended future plan first.');
    const selected=state.recordedCostSelectedSource;
    await refreshSource();
    const meta=caseValue.sources.find(row=>row.id===selected&&row.filename?.startsWith('sf47-cohort-delivery-'));
    if(!meta)throw new Error('Select the complete original saved delivery comparison in this case.');
    const original=reopenCohortDeliveryComparison(JSON.parse(await readSource(meta)));
    if(original.source.programId!==caseId||!original.commercial)throw new Error('Choose this case’s complete commercial reconciliation.');
    if(state.recordedCostSource)state.recordedCostHistory=[...(state.recordedCostHistory||[]),{source:copy(state.recordedCostSource),baseline:copy(state.recordedCostBaseline),choices:copy(recordedCostState()),preview:copy(state.recordedCostPreview)}];
    state.recordedCostSource=original;
    if(!state.recordedCostBaseline)state.recordedCostBaseline=editionEnvelope(inputMatchesReport()?state.report:null,'');
    state.recordedCostChoices=state.recordedCostChoices||seedCohortRecordedCostPlan(original,state.recordedCostBaseline);
    state.recordedCostPreview=null;state.tab='recorded-cost';
    state.notice='Opened the complete original comparison. Existing cost shares, output measurements and rates remain explicit.';
  }
  function calculateRecordedCost(){
    const value=planCohortFromRecordedCosts(state.recordedCostSource,state.recordedCostBaseline,recordedCostState());
    state.recordedCostPreview=value;state.recordedCostChoices=copy(value.choices);persist();return value;
  }
  function adoptRecordedCost(){
    const value=reopenCohortRecordedCostPlan(state.recordedCostPreview);
    if(!value.choices.quantityBasis)throw new Error('Calculate a complete successor with the selected request units before applying this historical proposal. Its original document remains retained.');
    if(JSON.stringify(value.choices)!==JSON.stringify(recordedCostState())||JSON.stringify(value.sourceDocument)!==JSON.stringify(state.recordedCostSource)||JSON.stringify(value.planDocument)!==JSON.stringify(state.recordedCostBaseline))
      throw new Error('Recalculate the complete currently selected costs, baseline and choices before applying.');
    rememberPrior('Applied reviewed recorded-cost basis');
    state.plan=copy(value.candidate);state.recordedCostPlan=copy(value);state.savedEnvelope=null;state.savedSourceId=null;
    state.report=value.report;state.reportInput=JSON.stringify(state.plan);state.tab='recorded-cost';
    state.notice='Applied the reviewed estimates to the future plan. Funding identities and all original source documents remain retained.';
  }
  async function checkRecordedCostSource(){
    if(!state.recordedCostPlan)return;
    const result=reopenCohortRecordedCostPlan(state.recordedCostPlan),source=result.sourceDocument;
    const meta=caseValue.sources.find(row=>row.id===source.input.recording.planSourceId);
    if(!meta)throw new Error('The original cost comparison’s saved plan source is absent from this case.');
    const original=JSON.parse(await readSource(meta));
    const equal=(a,b)=>{const order=x=>Array.isArray(x)?x.map(order):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,order(x[k])])):x;return JSON.stringify(order(a))===JSON.stringify(order(b));};
    const review=await saveApi(prefix+'/reviews/'+encodeURIComponent(source.source.reviewId));
    if(!equal(original,source.input.planDocument)||!equal(review,source.input.review))
      throw new Error('The recorded-cost basis differs from its original saved plan or frozen review. Keep the retained proposal and select the complete original source again.');
    const measurements=new Map();
    for(const allocation of result.choices.allocations)for(const basis of [allocation.measurement,...(allocation.measurementHistory||[]).map(row=>row.measurement)].filter(Boolean)){
      const catalog=inspectCohortTaskMeasurements(basis.original),prior=measurements.get(catalog.sourceId);
      if(prior&&(!equal(prior.original.source,catalog.original.source)||!equal(prior.original.edition,catalog.original.edition)))throw new Error('Conflicting original measurement editions use one source identity.');
      measurements.set(catalog.sourceId,catalog);
    }
    for(const catalog of measurements.values()){
      const meta=caseValue.sources.find(row=>row.id===catalog.sourceId);
      if(!meta||!equal(meta,catalog.original.source))throw new Error('A selected original task measurement differs from the current case source.');
      const native=await saveApi(prefix+'/task-outcomes/'+encodeURIComponent(catalog.comparisonId)+'?revision='+catalog.revision);
      if(!equal(native.source,catalog.original.source)||!equal(native.edition,catalog.original.edition))
        throw new Error('Select the complete original saved task revision again before saving this cost basis.');
    }
  }

  function editions(){
    const selected=state.viewedSource,sources=(caseValue.sources||[]).filter(row=>row.filename?.startsWith('sf47-cohort-plan-'));
    const other=(caseValue.sources||[]).filter(row=>!sources.some(value=>value.id===row.id)&&(row.mediaType==='application/json'||/\.json$/i.test(row.filename||'')));
    const actions='<div class="cp-actions">'+btn('Import plan or report JSON','import-json')+btn('Download plan JSON','export-json','data-cp-view="true"',!plan())+btn('Download editable rows CSV','rows-csv','data-cp-view="true"',!plan())+btn('Import editable rows CSV','rows-import','',!plan())+btn('Download complete case ZIP','case-export','data-cp-view="true"')+'</div>';
    return workingSessionsView()+section('Saved source editions',note('Each edition contains the complete entered plan and its calculated report. Saving adds a new original source record. The complete case ZIP includes those native sources and their existing case history.')+actions+
      (sources.length?table(['Edition source','Captured','Bytes / identity',''],sources.map(row=>['<strong>'+esc(row.filename)+'</strong><small>'+esc(row.id)+'</small>',esc(row.createdAt||row.observedAt),esc(row.bytes)+'<small>'+esc(row.sha256)+'</small>',btn(row.filename.includes('-comparison-')?'Open comparison':'Open original plan','open-source','data-id="'+esc(row.id)+'" data-cp-view="true"')+' '+btn('Use as baseline','comparison-source-baseline','data-id="'+esc(row.id)+'"',row.filename.includes('-comparison-'))])):empty('No cohort planning source edition is attached to this case yet.'))+
      (other.length?'<details><summary>Open another retained JSON source</summary>'+table(['Original source',''],other.map(row=>[esc(row.filename)+'<small>'+esc(row.id)+'</small>',btn('Open JSON source','open-source','data-id="'+esc(row.id)+'" data-cp-view="true"')]))+'</details>':''))+
      (selected?section('Opened original source','<p><strong>'+esc(selected.meta.filename)+'</strong><br><span class="cp-identity">'+esc(selected.meta.id)+' · '+esc(selected.meta.sha256)+'</span></p>'+
        btn('Download original source JSON','source-json','data-cp-view="true"')+
        (selected.envelope?.plan?'<p>'+esc(selected.envelope.plan.name)+' · source version '+esc(selected.envelope.plan.source?.version)+' · prepared '+esc(selected.envelope.createdAt)+' · '+esc(selected.envelope.actor)+'</p>':'')+
        jsonDetail('Complete original source document',selected.envelope)):'')+
      section('Prior local drafts',note('Explicit reseeding, rebasing, imports, and draft restoration retain the earlier planning state in this original case’s browser session.')+
        (state.priorDrafts.length?table(['Retained','Plan','Reason',''],state.priorDrafts.slice().reverse().map(row=>[esc(row.retainedAt),esc(row.plan.name)+'<small>Original source v'+esc(row.plan.source.version)+'</small>',esc(row.reason),btn('Restore as draft','restore-prior','data-id="'+esc(row.id)+'"')+btn('Download JSON','prior-json','data-id="'+esc(row.id)+'" data-cp-view="true"')])):empty('No earlier local planning draft is retained yet.')));
  }
  function render(){
    if(!available())return;
    const dialog=$('dialog.cp-dialog'),scroll=dialog?.scrollTop||0,focus=document.activeElement?.dataset?.cpField;
    if(dialog?.open)dialog.close();
    const body=state.tab==='setup'?setup():state.tab==='editions'?editions():state.tab==='compare'?comparisonView():!plan()?setup():state.tab==='participants'?participants():state.tab==='operations'?operations():state.tab==='schedules'?schedules():state.tab==='workshares'?workshares():state.tab==='capacity'?capacitySetup():state.tab==='recorded-cost'?recordedCostView():state.tab==='scheduling'?schedulingView():state.tab==='funding'?fundingSetup():reportView();
    root.innerHTML=header()+navigation()+body+editor();
    const resumed=$('dialog.cp-dialog');if(resumed){resumed.showModal();resumed.scrollTop=scroll;if(focus){const target=[...resumed.querySelectorAll('[data-cp-field]')].find(el=>el.dataset.cpField===focus);target?.focus({preventScroll:true});}}
    controls();
  }
  function closeEditor(){if(state.editor){state.rowDrafts[state.editor.key]={editor:copy(state.editor),data:copy(state.editorDraft)};state.lastEditorKey=state.editor.key;}state.editor=null;state.editorDraft=null;state.editorError='';persist();}
  root.addEventListener('input',event=>{
    const el=event.target;if(!editable())return;
    if(el.hasAttribute('data-cp-task-measurement')){taskMeasurementEditor()[el.dataset.cpTaskMeasurement]=el.value;persist();if(el.dataset.cpTaskMeasurement==='sourceId')render();return;}
    if(el.hasAttribute('data-cp-task-observation')){const [kind,observationId]=JSON.parse(el.value);Object.assign(taskMeasurementEditor(),{kind,observationId});persist();return;}
    if(el.hasAttribute('data-cp-recorded-source')){state.recordedCostSelectedSource=el.value;persist();render();return;}
    if(el.dataset.cpRecordedChoice){recordedCostState()[el.dataset.cpRecordedChoice]=el.value;state.recordedCostPreview=null;persist();return;}
    const costForm=el.closest('[data-cp-recorded-cost-form]');if(costForm){const values=Object.fromEntries(new FormData(costForm));state.recordedCostDraft={...state.recordedCostDraft,...Object.fromEntries(Object.entries(values).filter(([key])=>!key.startsWith('share:')))};state.recordedCostDraft.costs=Object.entries(values).filter(([key,value])=>key.startsWith('share:')&&value.trim()&&!/^0(?:\.0+)?$/.test(value.trim())).map(([key,share])=>({costId:key.slice(6),share:share.trim()}));persist();return;}
    if(el.hasAttribute('data-cp-filter')){state.filter=el.value;return;}
    if(el.dataset.cpSchedulingOption)return;
    if(el.dataset.cpComparisonSelect){comparisonState();state.comparisonSelections[el.dataset.cpComparisonSelect]=el.value;persist();return;}
    if(el.dataset.cpComparisonField){
      const key=el.dataset.cpComparisonField;if(!['title','note'].includes(key))return;
      comparisonState()[key]=el.value;state.comparisonSavedSourceId=null;comparisonCacheKey='';persist();return;
    }
    if(el.dataset.cpControl)return;
    if(el.dataset.cpField==='newTranche'){state.tranche=Number(el.value);persist();return;}
    const target=el.closest('[data-cp-editor]')?state.editorDraft:el.closest('[data-cp-plan]')?plan():null;
    if(!target)return;
    if(el.dataset.cpWeekday){
      const key=el.dataset.cpWeekday,scope=el.closest('fieldset');
      setPath(target,key,[...scope.querySelectorAll('input[data-cp-weekday]:checked')].map(input=>Number(input.value)));
    }else if(el.dataset.cpField)setPath(target,el.dataset.cpField,readInput(el));else return;
    if(state.editor&&el.closest('[data-cp-editor]')){state.rowDrafts[state.editor.key]={editor:copy(state.editor),data:copy(state.editorDraft)};state.lastEditorKey=state.editor.key;persist();}else changed();
  });
  root.addEventListener('change',event=>{
    const el=event.target;if(!editable())return;
    if(el.dataset.cpSchedulingOption){
      const selected=selectedSchedulingOptions();
      if(el.dataset.cpSchedulingOption==='method'&&['FIRST_FIT','RESOLVE_CONFLICTS'].includes(el.value)){
        state.schedulingOptions=el.value==='FIRST_FIT'?{method:'FIRST_FIT'}:{method:'RESOLVE_CONFLICTS',maxSearchSteps:selected.maxSearchSteps||state.schedulingResult?.resolution?.maxSearchSteps||100000};
      }else if(el.dataset.cpSchedulingOption==='maxSearchSteps'&&/^[1-9]\d*$/.test(el.value)&&Number(el.value)<=1000000){
        state.schedulingOptions={method:'RESOLVE_CONFLICTS',maxSearchSteps:Number(el.value)};
      }else return;
      state.notice='Calculate the selected allocation method before adopting its delivery dates.';persist();render();return;
    }
    if(el.hasAttribute('data-cp-comparison-metric')){if(metrics.includes(el.value)){state.comparisonMetric=el.value;persist();render();}return;}
    if(el.dataset.cpComparisonSelect){comparisonState();state.comparisonSelections[el.dataset.cpComparisonSelect]=el.value;persist();return;}
    if(el.dataset.cpControl&&state.editor)switchControl(el);
  });
  root.addEventListener('submit',event=>{
    if(event.target.matches('[data-cp-recorded-cost-form]')){
      event.preventDefault();if(!editable())return;
      run(async()=>{const values=Object.fromEntries(new FormData(event.target)),row={...state.recordedCostDraft,...Object.fromEntries(Object.entries(values).filter(([key])=>!key.startsWith('share:')))};
        row.id=row.id.trim()||uid('cost-basis');row.costs=Object.entries(values).filter(([key,value])=>key.startsWith('share:')&&value.trim()&&!/^0(?:\.0+)?$/.test(value.trim())).map(([key,share])=>({costId:key.slice(6),share:share.trim()}));
        const choices=recordedCostState(),i=choices.allocations.findIndex(item=>item.id===row.id);
        if(i<0)choices.allocations.push(row);else choices.allocations[i]=row;
        state.recordedCostDraft=copy(row);state.recordedCostPreview=null;state.notice='Retained the complete measured output and selected actual-cost shares. Calculate to review all constraints.';});return;
    }
    if(!event.target.matches('[data-cp-plan],[data-cp-editor]'))return;
    event.preventDefault();
    if(!editable())return;
    if(event.target.matches('[data-cp-editor]')){try{commitEditor();render();}catch(error){state.editorError=error.message;const output=$('.cp-dialog-error');if(output)output.textContent=state.editorError;}}
    else run(async()=>{evaluate();state.tab='report';});
  });
  root.addEventListener('cancel',event=>{if(event.target.matches('dialog.cp-dialog')){event.preventDefault();if(editable()){closeEditor();render();}}},true);
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-cp-action]');if(!target||target.disabled)return;
    const action=target.dataset.cpAction;
    run(async()=>{
      if(action==='tab'){state.tab=target.dataset.tab;if(state.tab==='scheduling'&&plan()&&!isPending())ensureScheduling();return;}
      if(action==='recorded-task-load'){await loadTaskMeasurement();return;}
      if(action==='recorded-task-bind'){bindTaskMeasurement();return;}
      if(action==='recorded-task-manual'){manualTaskMeasurement();return;}
      if(action==='recorded-cost-load'){await loadRecordedCostSource();return;}
      if(action==='recorded-cost-baseline'){state.recordedCostBaseline=editionEnvelope(inputMatchesReport()?state.report:null,'');state.recordedCostPreview=null;return;}
      if(action==='recorded-cost-clear'){state.recordedCostDraft={};return;}
      if(action==='recorded-cost-edit'){state.recordedCostDraft=copy(recordedCostState().allocations.find(row=>row.id===target.dataset.id));return;}
      if(action==='recorded-cost-remove'){recordedCostState().allocations=recordedCostState().allocations.filter(row=>row.id!==target.dataset.id);state.recordedCostPreview=null;return;}
      if(action==='recorded-cost-calculate'){calculateRecordedCost();return;}
      if(action==='recorded-cost-adopt'){adoptRecordedCost();return;}
      if(action==='recorded-cost-save'){adoptRecordedCost();await saveEdition();return;}
      if(action==='recorded-cost-compare'){const result=reopenCohortRecordedCostPlan(state.recordedCostPreview);adoptComparison(result.comparison);return;}
      if(action==='recorded-cost-working'){await downloadWorkingSession();return;}
      if(action==='recorded-cost-json'){download(JSON.stringify(reopenCohortRecordedCostPlan(state.recordedCostPreview),null,2)+'\n','recorded-cost-plan.json');return;}
      if(action==='recorded-cost-csv'){download(exportCohortRecordedCostPlanCsv(state.recordedCostPreview),'recorded-cost-plan.csv','text/csv');return;}
      if(action==='scheduling-setup'){ensureScheduling();return;}
      if(action==='scheduling-policy'){ensureScheduling();state.schedulingEditorId=target.dataset.id;state.tab='scheduling';return;}
      if(action==='scheduling-calculate'){calculateScheduling();state.tab='scheduling';return;}
      if(action==='scheduling-adopt'){adoptScheduling();return;}
      if(action==='scheduling-save'){adoptScheduling();await saveEdition();return;}
      if(action==='scheduling-compare'){if(!schedulingMatches())throw new Error('Calculate the current scheduling choices.');captureSchedulingComparison(state.schedulingResult);state.tab='compare';return;}
      if(action==='scheduling-choices'){download(JSON.stringify(plan().deliveryScheduling,null,2)+'\n',cleanName(plan().name)+'-scheduling-choices.json');return;}
      if(['scheduling-json','scheduling-csv','scheduling-html'].includes(action)){
        const result=reopenCohortDeliverySchedule(state.schedulingResult),name=cleanName(result.candidate.name)+'-delivery-allocation';
        if(action==='scheduling-json')download(JSON.stringify(result,null,2)+'\n',name+'.json');
        else if(action==='scheduling-csv')download(exportCohortDeliveryScheduleCsv(result),name+'.csv','text/csv');
        else download(readableSchedulingHtml(result),name+'.html','text/html');return;
      }
      if(action==='comparison-section'){comparisonState().section=target.dataset.section;return;}
      if(action==='comparison-page'){state.pages[target.dataset.key]=Number(target.dataset.page);return;}
      if(action==='comparison-select'){await selectComparisonSide(target.dataset.side);return;}
      if(action==='comparison-import-side'){await importComparisonSide(target.dataset.side);return;}
      if(action==='comparison-import'){await importComparison();return;}
      if(action==='comparison-edit-side'){await openComparisonSide(target.dataset.side);return;}
      if(action==='comparison-save'){await saveComparison();return;}
      if(action==='comparison-swap'){
        const value=comparisonState();if(!value.before||!value.after)return;
        retainComparison('Swapped baseline and candidate');[value.before,value.after]=[value.after,value.before];
        [state.comparisonSelections.before,state.comparisonSelections.after]=[state.comparisonSelections.after,state.comparisonSelections.before];
        state.comparisonSavedSourceId=null;comparisonCacheKey='';state.pages={};state.notice='Swapped the two complete sources. Changes now use the new candidate minus baseline.';return;
      }
      if(action==='comparison-json'||action==='comparison-csv'||action==='comparison-html'){
        const report=comparisonReport();if(!report)throw new Error('Choose both comparison sources first.');
        const name=cleanName(report.review.title);
        if(action==='comparison-json')download(JSON.stringify(report,null,2)+'\n',name+'-comparison.json');
        if(action==='comparison-csv')download(exportCohortPlanComparisonCsv(report),name+'-comparison.csv','text/csv');
        if(action==='comparison-html')download(readableComparisonHtml(report),name+'-comparison.html','text/html');
        return;
      }
      if(action==='comparison-source-json'){
        const item=comparisonState()[target.dataset.side];if(item)download(JSON.stringify(item.document,null,2)+'\n',cleanName(comparisonDocumentPlan(item.document).name)+'-'+target.dataset.side+'.json');return;
      }
      if(action==='comparison-restore'){
        const previous=state.comparisonHistory?.find(row=>row.id===target.dataset.id);if(!previous)return;
        const next=copy(previous.value);
        if(next.before&&next.after)compareCohortPlans(next.before.document,next.after.document,comparisonOptions(next));
        else for(const side of ['before','after'])if(next[side])evaluateCohortPlan(comparisonDocumentPlan(next[side].document));
        retainComparison('Restored prior comparison '+previous.id);state.comparison=next;state.comparisonSavedSourceId=null;comparisonCacheKey='';state.pages={};state.tab='compare';return;
      }
      if(action==='comparison-adopt'){
        const entry=state.comparisonIncoming?.find(row=>row.id===target.dataset.id);if(!entry)return;
        if(entry.planning)openDocument(entry.document,{meta:entry.meta||null,raw:entry.raw||null});
        else if(entry.comparison)adoptComparison(entry.document);
        else replaceComparisonSide(entry.side,entry.document,entry.origin);
        state.comparisonIncoming=state.comparisonIncoming.filter(row=>row.id!==entry.id);return;
      }
      if(action==='report-section'){state.reportSection=target.dataset.section;return;}
      if(action==='day'){state.selectedDate=target.dataset.date;state.pages.occurrences=0;return;}
      if(action==='occurrence-page'){state.pages.occurrences=Number(target.dataset.page);return;}
      if(action==='page'){state.pages[target.dataset.kind]=Number(target.dataset.page);return;}
      if(action==='filter'){state.pages={};return;}
      if(action==='filter-clear'){state.filter='';state.pages={};return;}
      if(action==='refresh'){await refreshSource();if(plan())evaluate();state.notice='Retrieved the current native case and cohort rule. This plan retains its original source.';return;}
      if(action==='new'){await newPlan(state.tranche);return;}
      if(action==='rebase'){
        const seed=await refreshSource();
        if(plan().source.programId!==caseId)throw new Error('Rebase this plan in its original Operations case.');
        rememberPrior('Explicitly rebased on current source');
        state.plan={...copy(plan()),source:{...copy(seed.source),planId:caseValue.program.planId,planRevision:caseValue.program.planRevision},rule:copy(seed.rule)};
        state.savedEnvelope=null;evaluate();state.notice='Rebased this draft on the current source and original proposed rule. The previous draft remains in Saved editions.';return;
      }
      if(action==='evaluate'){evaluate();state.tab='report';state.notice='Calculated the named schedule, payment groups, costs, and original proposed targets.';return;}
      if(action==='save'){await saveEdition();return;}
      if(action==='retry'){await sendPending();return;}
      if(action==='readback'){if(state.accepted)await finishAccepted();else await refreshRetainedCaseReceipt();return;}
      if(action==='pending-export'){const retained=state.pending||state.accepted;if(retained)download(JSON.stringify(retained,null,2)+'\n','cohort-original-source-request.json');return;}
      if(action==='edit'||action==='copy-row'){openEditor(target.dataset.kind,target.dataset.id||null,action==='copy-row');return;}
      if(action==='editor-close'){closeEditor();return;}
      if(action==='resume-editor'){
        const saved=state.rowDrafts[pendingEditorKey()];if(saved){state.editor=copy(saved.editor);state.editorDraft=copy(saved.data);state.editorError='';}return;
      }
      if(action==='row-remove'){
        const {kind,id,key}=state.editor,index=plan()[kind].findIndex(row=>row.id===id);if(index<0)return;
        const consumers=[...(plan().schedules||[]),...(plan().fundingGroups||[])];
        const references=kind==='buyers'?consumers.filter(row=>row.buyerId===id):kind==='merchants'?(plan().operations||[]).filter(row=>row.merchantId===id):kind==='facilitators'?consumers.filter(row=>row.facilitatorId===id):kind==='operations'?consumers.filter(row=>row.operationId===id):kind==='capacityPools'?(plan().schedules||[]).filter(row=>row.capacityPoolId===id):kind==='fundingGroups'?(plan().schedules||[]).filter(row=>row.fundingGroupIds?.includes(id)):[];
        if(references.length){state.editorError='Reassign or remove the referencing rows first: '+references.map(row=>row.label).join(', ');return;}
        rememberPrior('Removed '+kind+' row '+plan()[kind][index].label);plan()[kind].splice(index,1);if(kind==='schedules'&&plan().deliveryScheduling)plan().deliveryScheduling.schedules=plan().deliveryScheduling.schedules.filter(row=>row.scheduleId!==id);delete state.rowDrafts[key];state.editor=null;state.editorDraft=null;changed();return;
      }
      if(action==='receive-calendar'){await receiveCalendar();return;}
      if(action==='calendar-original'||action==='calendar-seed'){const original=plan()?.calendarSource;if(original)download(JSON.stringify(action==='calendar-original'?original.selection:original.cohortSeed,null,2)+'\n',cleanName(plan().name)+'-'+action+'.json');return;}
      if(action==='working-json'){await downloadWorkingSession();return;}
      if(action==='working-import'){await importWorkingSession();return;}
      if(action==='working-adopt'){await adoptWorkingSession(target.dataset.id);return;}
      if(action==='working-selected-json'){workingGraph();const selected=[...state.workingIncoming,...state.workingHistory].find(row=>row.id===target.dataset.id);if(selected)await downloadWorkingSession(selected);return;}
      if(action==='import-json'){await importJson();return;}
      if(action==='export-json'){exportJson();return;}
      if(action==='rows-csv'){download(editableCsv(),cleanName(plan().name)+'-editable-rows.csv','text/csv');return;}
      if(action==='rows-import'){await importCsv();return;}
      if(action==='report-csv'){const report=evaluate();download(exportCohortPlanCsv(report),cleanName(plan().name)+'-report.csv','text/csv');return;}
      if(action==='report-html'){const report=evaluate();download(readableHtml(report),cleanName(plan().name)+'-report.html','text/html');return;}
      if(action==='open-source'){await openSaved(target.dataset.id);return;}
      if(action==='comparison-source-baseline'){comparisonState();state.comparisonSelections.before='source:'+target.dataset.id;await selectComparisonSide('before');return;}
      if(action==='source-json'){if(state.viewedSource)download(state.viewedSource.raw,state.viewedSource.meta.filename);return;}
      if(action==='case-export'){const response=await saveApi(prefix+'/export.zip',undefined,{download:true});download(await response.blob(),caseId+'.zip','application/zip');return;}
      if(action==='restore-prior'){
        const previous=state.priorDrafts.find(row=>row.id===target.dataset.id);if(!previous)return;
        const restored=copy(previous);rememberPrior('Restored prior draft '+restored.id);
        state.plan=restored.plan;state.recordedCostPlan=restored.recordedCostPlan||null;state.report=restored.report;state.reportInput=restored.reportInput||'';state.parentSourceId=restored.parentSourceId;state.savedSourceId=restored.savedSourceId;state.savedEnvelope=null;state.editor=null;state.editorDraft=null;state.pages={};
        try{evaluate();}catch(error){state.error=error.message;}state.tab='setup';state.notice='Restored the original prior planning state as this editable draft.';return;
      }
      if(action==='prior-json'){const previous=state.priorDrafts.find(row=>row.id===target.dataset.id);if(previous)download(JSON.stringify({schema:EDITION_SCHEMA,editionId:previous.id,createdAt:previous.retainedAt,actor:'',parentSourceId:previous.parentSourceId,plan:previous.plan,report:previous.report,...(previous.recordedCostPlan?{recordedCostPlan:previous.recordedCostPlan,recordedCostPlanComparison:compareCohortPlans(previous.recordedCostPlan,previous.plan)}:{})},null,2)+'\n',cleanName(previous.plan.name)+'-'+previous.id+'.json');}
    });
  });
  render();
  const ready=(async()=>{
    busy=true;controls();
    try{
      if(state.workingStorage==='INDEXED_DB'&&(state.workingSnapshotIds||[]).some(id=>!state.workingSnapshots?.[id])){
        const retained=await loadCohortWorkingSnapshots(caseId,state.workingSnapshotIds);
        state.workingSnapshots={...retained,...state.workingSnapshots};
      }
      if(state.inflight){try{await state.inflight;}catch(error){state.error=error.message;}}
      if(state.accepted){await finishAccepted();return;}
      if(state.incomingCalendar&&!state.pending){await receiveCalendar();return;}
      if(!plan()&&!state.pending)await newPlan(state.tranche);
      else{await refreshSource();if(plan()){try{evaluate();}catch(error){state.error=error.message;}}}
      if(state.caseRefreshReceipt&&available())await refreshRetainedCaseReceipt();
    }catch(error){state.error=error.message||String(error);}
    finally{busy=false;persist();if(available())render();}
  })();
  return {root,ready,setHostBusy(value){hostBusy=Boolean(value);if(available())controls();},
    updateCurrent(next){if(next?.program?.id!==caseId)throw new Error('Keep the original planning case identity.');caseValue=next;if(available())render();},
    dispose(){persist();active=false;const dialog=$('dialog.cp-dialog');if(dialog?.open)dialog.close();}};
}
