import {inspectRequestPackage,inspectResponse,reviewDigest} from './week-review.mjs';
import {createExactInputs} from './exact-inputs.js';
const $=id=>document.getElementById(id);
const clone=value=>structuredClone(value);
const make=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const money=value=>'$'+value.toFixed(4);
const hour=value=>String(value).padStart(2,'0')+':00';
const localDate=()=>{const date=new Date();return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');};
function dateAt(start,offset){
  const date=new Date(start+'T00:00:00Z');if(!Number.isFinite(date.valueOf()))return '';
  date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);
}
function displayDate(value,options={weekday:'long',month:'short',day:'numeric'}){
  const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.valueOf())?date.toLocaleDateString(undefined,{...options,timeZone:'UTC'}):'Choose a date';
}
let state=null,draft=null,draftHome=null,selected=0,busy=false,dirty=false,record=null,recordHome=null,page=null,readVersion=0;
const editor=createExactInputs({onChange:changed,isBusy:()=>busy||!draft||!draft.days[selected].enabled});
const draftKey=()=> 'gridkind.week-draft.v1:'+draftHome;
function context(){const w=state.workspace;return {generation:w.generation,householdId:w.selectedId,revision:w.revision};}
function problem(error){$('error').textContent=error.message||String(error);}
function status(text){$('draft-status').textContent=text;}
function blocked(){return state&&draftHome!==state.workspace.selectedId;}
function persist(){
  try{sessionStorage.setItem(draftKey(),JSON.stringify({draft,selected,dirty}));}
  catch{status('The edited week is open here. Plan and save it to retain it in household history.');}
}
function capture(){
  if(!draft)return;
  draft.name=$('week-name').value;draft.startDate=$('week-start').value;
  draft.days[selected]={enabled:$('day-enabled').checked,scenario:editor.read()};
}
function changed(){
  if(busy||!draft)return;
  dirty=true;
  try{capture();persist();$('error').textContent='';}
  catch(error){problem(error);}
  renderPicker();refresh();
  status('Edited draft. Plan and save the week to update its retained schedule.');
}
function refresh(){
  const disabled=busy||!draft;
  $('week-fields').disabled=disabled;
  editor.refresh(disabled||!draft?.days[selected].enabled);
  for(const id of ['plan-week'])$(id).disabled=disabled||blocked();
  $('new-week').disabled=busy||!state;
  $('refresh-history').disabled=busy||!state;
  $('edit-saved').disabled=busy||!record||recordHome!==draftHome;
  $('history-newer').disabled=busy||!page||page.offset===0;
  $('history-older').disabled=busy||!page?.hasMore;
  for(const button of document.querySelectorAll('[data-continue-day]'))button.disabled=busy||recordHome!==state?.workspace?.selectedId;
  for(const button of document.querySelectorAll('[data-saved-week]'))button.disabled=busy;
  if(state)$('household-name').textContent=state.workspace.households.find(home=>home.id===draftHome)?.name||state.workspace.selectedName;
  if(blocked())status('The active household changed in another tab. Your draft remains here. Use “Start from saved household inputs” to open the now-active household.');
  refreshReview();
}
function renderPicker(){
  const out=$('day-picker');out.replaceChildren();
  if(!draft)return;
  for(let index=0;index<7;index++){
    const day=draft.days[index],date=dateAt(draft.startDate,index),button=make('button');
    button.type='button';button.setAttribute('aria-pressed',String(index===selected));
    button.append(make('strong',displayDate(date,{weekday:'short'})),make('span',date?date.slice(5):'—'),make('small',day.enabled?day.scenario.tasks.length+' loads':'Rest day'));
    button.onclick=()=>{
      try{capture();selected=index;fillDay();persist();$('error').textContent='';}
      catch(error){problem(error);}
    };out.append(button);
  }
}
function fillDay(){
  const day=draft.days[selected];
  $('day-enabled').checked=day.enabled;$('day-title').textContent=displayDate(dateAt(draft.startDate,selected));
  $('day-rest').classList.toggle('only-hidden',day.enabled);
  editor.fill(day.scenario);renderPicker();refresh();
}
function fillDraft(){
  $('week-name').value=draft.name;$('week-start').value=draft.startDate;fillDay();
}
async function read(path){
  const response=await fetch(path),body=await response.json();
  if(!response.ok)throw Error(body.error||'Could not read the household.');
  return body;
}
function receiveState(next){
  state=next;
  if(blocked())problem(Error('Another tab selected a different household. This draft still belongs to its original household.'));
  refresh();
}
async function mutate(action,details={}){
  if(busy||!state)return null;
  busy=true;$('error').textContent='';refresh();
  try{
    const response=await fetch('/api/week',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...details,context:context()})});
    const body=await response.json();
    if(!response.ok){
      if(body.state)receiveState(body.state);
      throw Error(body.error||'Could not save the weekly plan.');
    }
    if(body.state)receiveState(body.state);
    return body;
  }catch(error){problem(error);return null;}
  finally{busy=false;refresh();}
}
function scheduleTable(items){
  const wrap=make('div',undefined,'saved-table-scroll'),table=make('table',undefined,'saved-table'),head=make('thead'),row=make('tr');
  wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Optimized flexible-load schedule');
  for(const title of ['Load','Start','Finish','Energy','Cost']){const th=make('th',title);th.scope='col';row.append(th);}
  head.append(row);table.append(head);const body=make('tbody');
  for(const item of items){
    const tr=make('tr');for(const value of [item.label,hour(item.start),hour(item.end),item.kwh.toFixed(2)+' kWh',money(item.cost)])tr.append(make('td',value));body.append(tr);
  }
  table.append(body);wrap.append(table);return wrap;
}
function renderRecord(){
  $('week-results').classList.toggle('only-hidden',!record);
  if(!record){refresh();return;}
  const report=record.detail.report,t=report.totals;
  $('results-title').textContent=report.input.name;
  $('saved-time').textContent='Saved '+new Date(record.createdAt).toLocaleString();
  $('result-scope').textContent=displayDate(report.input.startDate)+' – '+displayDate(report.days[6].date)+'. Totals cover '+t.plannedDays+' planned day'+(t.plannedDays===1?'':'s')+', '+t.restDays+' rest day'+(t.restDays===1?'':'s')+', and exclude '+t.infeasibleDays+' day'+(t.infeasibleDays===1?'':'s')+' needing attention.';
  $('weekly-baseline').textContent=money(t.baselineCostUsd);$('weekly-optimized').textContent=money(t.optimizedCostUsd);
  $('weekly-difference').textContent=money(t.differenceUsd);$('weekly-energy').textContent=t.energyKwh.toFixed(2)+' kWh';
  const out=$('week-days');out.replaceChildren();
  for(const [index,day]of report.days.entries()){
    const card=make('article'),heading=make('div',undefined,'section-heading');
    heading.append(make('h3',displayDate(day.date)),make('span',day.status==='planned'?'Planned':day.status==='rest'?'Rest day':'Needs attention','status-chip'));card.append(heading);
    if(day.status==='planned'){
      card.append(make('p','Earliest feasible '+money(day.plan.baseline.cost)+' · Optimized '+money(day.plan.optimized.cost)+' · '+report.input.days[index].scenario.maxKw+' kW circuit cap','dim'),scheduleTable(day.plan.optimized.items));
      const controls=make('div',undefined,'controls'),button=make('button','Continue '+displayDate(day.date,{weekday:'short',month:'short',day:'numeric'})+' in daily workspace');
      button.type='button';button.dataset.continueDay=String(index);button.onclick=async()=>{
        const result=await mutate('adopt-day',{recordId:record.id,dayIndex:index});
        if(result){try{capture();persist();}catch{}dirty=false;window.location.assign('/');}
      };controls.append(button);card.append(controls);
    }else{
      card.append(make('p',day.status==='rest'?'No flexible loads scheduled.':day.reason,'dim'));
      if(day.status==='infeasible'){
        const button=make('button','Edit this saved day','secondary');button.type='button';button.dataset.continueDay=String(index);
        button.onclick=()=>editRecord(index);card.append(button);
      }
    }
    out.append(card);
  }
  const query='?householdId='+encodeURIComponent(recordHome)+'&recordId='+encodeURIComponent(record.id);
  $('export-csv').href='/api/week/export'+query+'&format=csv';
  $('export-calendar').href='/api/week/export'+query+'&format=ics';
  refresh();
}
function editRecord(index=selected){
  if(!record||recordHome!==draftHome||busy)return;
  draft=clone(record.detail.report.input);selected=index;dirty=false;fillDraft();persist();
  status('Saved week reopened as the draft. Edit any day, then plan and save a new weekly revision.');
  $('week-title').scrollIntoView({behavior:'smooth',block:'start'});
}
function renderHistory(){
  const out=$('saved-weeks');out.replaceChildren();
  const weeks=page?.records.filter(row=>row.kind==='week')||[];
  for(const row of weeks){
    const button=make('button',undefined,'history-item');button.type='button';button.dataset.savedWeek=row.id;
    button.setAttribute('aria-pressed',String(record?.id===row.id));
    button.append(make('span','#'+row.sequence+' / Week','tag'),make('strong',row.label),make('span',new Date(row.createdAt).toLocaleString(),'field-hint'));
    button.onclick=()=>openRecord(row.id);out.append(button);
  }
  if(!weeks.length)out.append(make('p',page?.hasMore?'No weekly plans on this history page. Use Older to continue.':'No weekly plans on this history page. Plan and save a week to retain it here.','dim'));
  $('history-scope').textContent=page?'Showing household records '+(page.total?page.offset+1:0)+'–'+Math.min(page.offset+page.limit,page.total)+' of '+page.total+'.':'';
  refresh();
}
async function loadHistory(offset=0){
  const version=++readVersion,home=draftHome;
  try{
    const result=await read('/api/workspace/history?householdId='+encodeURIComponent(home)+'&offset='+offset);
    if(version!==readVersion||home!==draftHome)return;
    page=result;renderHistory();
  }catch(error){if(version===readVersion)problem(error);}
}
async function openRecord(id){
  const version=++readVersion,home=draftHome;
  try{
    const value=await read('/api/workspace/record?householdId='+encodeURIComponent(home)+'&id='+encodeURIComponent(id));
    if(version!==readVersion||home!==draftHome)return;
    if(value.kind!=='week'||value.detail?.report?.schema!=='gridkind-week/v1')throw Error('Choose a saved weekly plan.');
    record=value;recordHome=home;renderRecord();renderHistory();
    const url=new URL(location.href);url.searchParams.set('record',id);history.replaceState(null,'',url);
    $('results-title').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(error){if(version===readVersion)problem(error);}
}
async function freshDraft(){
  draftHome=state.workspace.selectedId;selected=0;dirty=false;
  draft={name:state.workspace.selectedName+' · Week',startDate:localDate(),days:Array.from({length:7},()=>({enabled:true,scenario:clone(state.scenario)}))};
  draft.name=draft.name.slice(0,100);record=null;recordHome=null;page=null;readVersion++;
  fillDraft();persist();renderRecord();await loadHistory();
  const url=new URL(location.href);url.searchParams.delete('record');history.replaceState(null,'',url);
  status('Seven days start from this household’s saved inputs. Adjust the daily pattern, then plan and save.');
}
function copyDays(kind){
  try{
    capture();
    if(!draft.startDate||!dateAt(draft.startDate,0))throw Error('Choose the first date before copying a weekday or weekend pattern.');
    const source=clone(draft.days[selected]);let count=0;
    for(let index=0;index<7;index++){
      const weekday=new Date(dateAt(draft.startDate,index)+'T00:00:00Z').getUTCDay();
      if(index!==selected&&(kind==='all'||(kind==='weekdays'&&weekday>=1&&weekday<=5)||(kind==='weekend'&&(weekday===0||weekday===6)))){
        draft.days[index]=clone(source);count++;
      }
    }
    dirty=true;persist();renderPicker();status('Copied this day to '+count+' other day'+(count===1?'':'s')+'. Plan and save to update the schedule.');$('error').textContent='';
  }catch(error){problem(error);}
}

let reviewRequest=null,reviewBundle=null,returnResponse=null,returnPreview=null,previewContext=null,reviewVersion=0,reviewPending=null,reviewStorageHome=null,reviewFailure=null,pendingOutcome=null;
const reviewKnown=new Map(),weekKnown=new Map();
const reviewContextKey=()=>state?JSON.stringify(context()):'';
const reviewStorageKey=()=> 'gridkind.week-review-apply.v1:'+state.workspace.selectedId;
function reviewStatus(text){$('review-status').textContent=text;}
function discardPreview(){returnPreview=null;previewContext=null;$('review-preview').classList.add('only-hidden');$('review-conflicts').replaceChildren();refreshReview();}
function rememberReviewRows(){
  for(const row of page?.records||[]){
    if(row.kind==='week-request')reviewKnown.set(row.id,row);
    if(row.kind==='week')weekKnown.set(row.id,row);
  }
  if(record&&recordHome===draftHome)weekKnown.set(record.id,record);
  if(reviewRequest)reviewKnown.set(reviewRequest.id,reviewRequest);
}
function selectOptions(id,rows,placeholder,preferred){
  const node=$(id),held=preferred??node.value;node.replaceChildren();
  const empty=make('option',placeholder);empty.value='';node.append(empty);
  for(const row of rows){const o=make('option','#'+row.sequence+' · '+row.label);o.value=row.id;node.append(o);}
  if([...node.options].some(o=>o.value===held))node.value=held;
}
function refreshReview(){
  if(!state)return;
  const homeKey=state.workspace.generation+':'+draftHome;
  if(reviewStorageHome!==homeKey){
    reviewStorageHome=homeKey;reviewRequest=null;reviewBundle=null;returnResponse=null;returnPreview=null;previewContext=null;
    reviewVersion++;reviewKnown.clear();weekKnown.clear();reviewPending=null;pendingOutcome=null;
    try{const held=JSON.parse(sessionStorage.getItem(reviewStorageKey())||'null');if(held?.action==='apply-return'&&held.context?.householdId===draftHome&&typeof held.requestId==='string'&&typeof held.targetRecordId==='string'&&typeof held.response?.responseId==='string'&&held.choices&&typeof held.choices==='object')reviewPending=held;else if(held)reviewStatus('A saved apply entry is incomplete. It remains untouched in this tab; reopen the original response file to inspect it.');}catch{reviewStatus('A saved apply entry could not be read. It remains untouched in this tab.');}
    $('review-return-file').value='';$('review-preview').classList.add('only-hidden');
  }
  rememberReviewRows();
  const no=busy||blocked(),hasRecord=record&&recordHome===state.workspace.selectedId;
  $('review-base-summary').textContent=hasRecord?'Selected saved week: #'+record.sequence+' · '+record.detail.report.input.name+' · '+record.detail.report.input.startDate:'Open a saved week above to create a request.';
  $('request-week-review').disabled=no||!hasRecord;
  for(const id of ['review-recipient','review-message','review-request-select'])$(id).disabled=no||!!reviewPending;
  if(reviewPending)$('request-week-review').disabled=true;
  const heldRequest=reviewRequest?.id||$('review-request-select').value;
  selectOptions('review-request-select',[...reviewKnown.values()].sort((a,b)=>b.sequence-a.sequence),'Choose a saved review request',heldRequest);
  selectOptions('review-target',[...weekKnown.values()].sort((a,b)=>b.sequence-a.sequence),'Choose a saved week with the same dates');
  $('review-target').disabled=no||!reviewRequest||!!reviewPending;
  $('review-return-file').disabled=no||!reviewRequest||!!reviewPending;
  $('preview-week-return').disabled=no||!reviewRequest||!returnResponse||!$('review-target').value||!!reviewPending;
  $('review-retry-apply').disabled=no||!reviewPending;
  $('review-repreview-pending').classList.toggle('only-hidden',!reviewPending||!pendingOutcome);
  $('review-repreview-pending').disabled=no||!reviewPending||!pendingOutcome;
  $('review-pending').classList.toggle('only-hidden',!reviewPending);
  if(reviewPending)$('review-pending-description').textContent='An original apply request is retained for response '+reviewPending.response.responseId+'. Resume it to reconcile a lost reply; it keeps its original household, target, choices and request identity.';
  if(returnPreview&&previewContext!==reviewContextKey()){
    returnPreview=null;$('review-preview').classList.add('only-hidden');reviewStatus('Household state changed. Preview the original return again against a deliberately selected saved week.');
  }
  const unresolved=returnPreview?.conflicts.some(key=>!document.querySelector('[data-review-choice="'+key+'"]')?.value);
  $('apply-week-return').disabled=no||!returnPreview||unresolved||!!reviewPending;
  if(reviewRequest){
    const query='?householdId='+encodeURIComponent(draftHome)+'&recordId='+encodeURIComponent(reviewRequest.id);
    $('review-export-json').href='/api/week-review/export'+query+'&format=json';$('review-export-html').href='/api/week-review/export'+query+'&format=html';
  }
  for(const id of ['review-export-json','review-export-html'])$(id).classList.toggle('only-hidden',!reviewRequest||blocked());
}
async function reviewCall(payload){
  if(busy||!state)return null;
  busy=true;reviewFailure=null;$('error').textContent='';refresh();
  try{
    const response=await fetch('/api/week-review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    const body=await response.json();if(body.state)receiveState(body.state);
    if(!response.ok){reviewFailure={status:response.status,body};throw Error(body.error||'Could not continue the household review.');}
    return body;
  }catch(e){problem(e);return null;}finally{busy=false;refresh();}
}
async function openReview(id){
  if(busy||blocked())return;
  if(reviewPending&&reviewPending.requestId!==id){reviewStatus('Resume the retained apply for its original request before opening another review.');return;}
  const version=++reviewVersion,home=draftHome,ctx=reviewContextKey();
  try{
    const value=await read('/api/week-review/export?householdId='+encodeURIComponent(home)+'&recordId='+encodeURIComponent(id)+'&format=json');
    if(version!==reviewVersion||home!==draftHome||ctx!==reviewContextKey())return;
    reviewBundle=inspectRequestPackage(value);reviewRequest=reviewBundle.request;returnResponse=null;returnPreview=null;previewContext=null;
    $('review-return-file').value='';$('review-return-summary').textContent='';$('review-preview').classList.add('only-hidden');
    $('review-request-summary').textContent='Original request #'+reviewRequest.sequence+' · '+(reviewRequest.detail.recipient||'Household reviewer')+' · '+reviewRequest.detail.baseRecord.detail.report.input.startDate+'. '+(reviewRequest.detail.message||'No extra instructions.');
    if(record?.detail?.report?.input.startDate===reviewRequest.detail.baseRecord.detail.report.input.startDate)$('review-target').value=record.id;
    reviewKnown.set(reviewRequest.id,reviewRequest);refreshReview();
    const url=new URL(location.href);url.searchParams.set('review',id);history.replaceState(null,'',url);reviewStatus('Original request opened. Download the self-contained HTML for the reviewer, or import their response below.');
  }catch(e){if(version===reviewVersion)problem(e);}
}
function reviewValueSummary(value){
  if(typeof value==='string')return value;
  return (value.enabled?'Planned day':'Rest day')+' · '+value.scenario.maxKw+' kW cap · '+value.scenario.tasks.length+' loads · '+value.scenario.tasks.map(t=>t.label+' '+hour(t.earliest)+'–'+hour(t.deadline)).join('; ');
}
function renderReviewPreview(){
  const p=returnPreview,out=$('review-conflicts');out.replaceChildren();
  $('review-preview').classList.remove('only-hidden');
  $('review-preview-summary').textContent=p.reviewer+' returned this week. '+p.conflicts.length+' conflicting field'+(p.conflicts.length===1?' needs':'s need')+' an explicit choice. Dates remain '+p.startDate+'. '+(p.sourceChanged?'Original and current saved source versions differ.':'');
  $('review-notes').replaceChildren(make('p',p.attribution,'field-hint'),make('p',p.notes||'No overall reviewer note.','dim'));
  for(const field of p.fields){
    const card=make('article',undefined,field.status==='conflict'?'conflict':'');
    card.append(make('h4',field.label+' · '+({unchanged:'Unchanged',same:'Both made the same change',current:'Owner change only',returned:'Reviewer change only',conflict:'Different owner and reviewer changes'}[field.status]||field.status)));
    const versions=make('div',undefined,'review-versions');
    for(const [key,label]of [['base','Original request'],['current','Current saved week'],['returned','Returned suggestion']]){
      const col=make('div');col.append(make('h4',label),make('p',reviewValueSummary(field[key])));
      if(typeof field[key]!=='string'){const detail=make('details');detail.append(make('summary','Exact hourly prices and load inputs'),make('pre',JSON.stringify(field[key],null,2)));col.append(detail);}versions.append(col);
    }
    card.append(versions);
    const index=field.key.startsWith('day-')?Number(field.key.slice(4)):null;
    if(index!==null&&p.dayNotes[index])card.append(make('p','Reviewer note: '+p.dayNotes[index],'dim'));
    const label=make('label','Carry forward','review-choice'),select=make('select');select.dataset.reviewChoice=field.key;
    if(field.status==='conflict'){const o=make('option','Choose explicitly…');o.value='';select.append(o);}
    for(const [value,title]of [['current','Current saved week'],['returned','Returned suggestion']]){const option=make('option',title);option.value=value;select.append(option);}
    select.value=field.defaultChoice||'';select.onchange=refreshReview;label.append(select);card.append(label);out.append(card);
  }
  const wrap=make('div',undefined,'saved-table-scroll'),table=make('table',undefined,'saved-table'),head=make('thead'),tr=make('tr');
  for(const h of ['Date','Original planned cost','Current planned cost','Returned planned cost'])tr.append(make('th',h));head.append(tr);table.append(head);const body=make('tbody');
  for(let i=0;i<7;i++){const row=make('tr');row.append(make('td',p.baseReport.days[i].date));for(const report of [p.baseReport,p.currentReport,p.returnedReport]){const day=report.days[i];row.append(make('td',day.status==='planned'?money(day.plan.optimized.cost):day.status));}body.append(row);}
  table.append(body);wrap.append(table);$('review-plan-comparison').replaceChildren(make('p','Costs above describe three separate versions, not the final selected combination. Applying choices calculates the resulting new week; infeasible days stay explicit.','field-hint'),wrap);
  refreshReview();
}
async function applyReview(payload,isResume=false){
  if(busy||blocked())return;
  const key=reviewStorageKey();
  if(!isResume){sessionStorage.setItem(key,JSON.stringify(payload));reviewPending=clone(payload);}
  pendingOutcome=null;
  const result=await reviewCall(payload);
  if(!result){
    const o=reviewFailure?.body?.reviewOutcome;
    if(o?.status==='not_committed'&&o.householdId===payload.context.householdId&&o.requestId===payload.requestId&&o.responseId===payload.response.responseId&&o.targetRecordId===payload.targetRecordId&&o.responseSha256===reviewDigest(payload.response)&&o.choicesSha256===reviewDigest(payload.choices))pendingOutcome=clone(o);
    reviewStatus(pendingOutcome?'The server confirmed this exact apply was not committed. Keep the original attempt and deliberately preview the same return with current household state.':'The original apply request is retained. Resume it to reconcile the server outcome without changing its response ID or choices.');refreshReview();return;}
  try{sessionStorage.removeItem(key);}catch{}
  reviewPending=null;pendingOutcome=null;returnPreview=null;previewContext=null;$('review-preview').classList.add('only-hidden');
  if(result.householdId!==state.workspace.selectedId){reviewStatus('The original application was reconciled in its original household. Reopen that household to view the saved week.');refreshReview();return;}
  record=result.record;recordHome=result.householdId;draftHome=result.householdId;renderRecord();await loadHistory();
  reviewStatus((result.replayed?'Reopened the already committed':'Saved the new')+' week #'+record.sequence+'. The original request, reviewer response and explicit choices remain in household history. Daily approval and execution are unchanged.');
  $('results-title').scrollIntoView({behavior:'smooth',block:'start'});refreshReview();
}
$('request-week-review').onclick=async()=>{
  if(!record||busy||blocked())return;
  const baseId=record.id,home=draftHome;
  const result=await reviewCall({action:'request',baseRecordId:baseId,recipient:$('review-recipient').value,message:$('review-message').value,context:context()});
  if(!result||home!==draftHome)return;
  await loadHistory();await openReview(result.record.id);
};
$('review-request-select').onchange=()=>{const id=$('review-request-select').value;reviewVersion++;discardPreview();if(id)openReview(id);else{reviewRequest=null;reviewBundle=null;returnResponse=null;$('review-request-select').value='';refreshReview();}};
$('review-target').onchange=()=>{reviewVersion++;discardPreview();};
$('review-return-file').onchange=async()=>{
  const version=++reviewVersion,file=$('review-return-file').files?.[0],request=reviewRequest,ctx=reviewContextKey();returnResponse=null;discardPreview();if(!file||!request)return;
  try{if(file.size>256*1024)throw Error('Choose a returned GridKind review JSON no larger than 256 KiB.');const value=JSON.parse(await file.text());
    if(version!==reviewVersion||file!==$('review-return-file').files?.[0]||request!==reviewRequest||ctx!==reviewContextKey())return;
    returnResponse=inspectResponse(value,request);
    $('review-return-summary').textContent=file.name+' · '+returnResponse.reviewer+' · Response '+returnResponse.responseId+'. Original JSON retained for this comparison.';
    $('error').textContent='';refreshReview();
  }catch(e){if(version===reviewVersion){problem(e);$('review-return-summary').textContent='The selected file was not admitted: '+e.message;}}
};
$('preview-week-return').onclick=async()=>{
  if(!reviewRequest||!returnResponse||busy||blocked())return;
  const version=++reviewVersion,request=reviewRequest,response=clone(returnResponse),target=$('review-target').value;
  discardPreview();const result=await reviewCall({action:'preview-return',requestId:request.id,targetRecordId:target,response,context:context()});
  if(!result||version!==reviewVersion||request!==reviewRequest||target!==$('review-target').value)return;
  returnPreview=result.preview;previewContext=reviewContextKey();renderReviewPreview();reviewStatus('Compare each complete day and choose explicitly wherever both versions changed.');
};
$('apply-week-return').onclick=async()=>{
  if(!returnPreview||previewContext!==reviewContextKey()||busy||blocked())return;
  try{
    const choices=Object.fromEntries([...document.querySelectorAll('[data-review-choice]')].filter(n=>n.value).map(n=>[n.dataset.reviewChoice,n.value]));
    for(const key of returnPreview.conflicts)if(!choices[key])throw Error('Choose current or returned for every conflicting day or name.');
    await applyReview({action:'apply-return',requestId:reviewRequest.id,targetRecordId:returnPreview.targetRecordId,response:clone(returnResponse),choices,context:context()});
  }catch(e){problem(e);}
};
$('review-retry-apply').onclick=async()=>{if(reviewPending&&!busy){try{await applyReview(clone(reviewPending),true);}catch(e){problem(e);}}};


$('review-repreview-pending').onclick=async()=>{
  if(!reviewPending||!pendingOutcome||busy||blocked())return;
  const original=clone(reviewPending),outcome=clone(pendingOutcome),ctx=reviewContextKey(),version=++reviewVersion,home=draftHome;
  busy=true;refresh();
  try{
    const query='?householdId='+encodeURIComponent(home);
    const [raw,target]=await Promise.all([
      read('/api/week-review/export'+query+'&recordId='+encodeURIComponent(original.requestId)+'&format=json'),
      read('/api/workspace/record'+query+'&id='+encodeURIComponent(original.targetRecordId))
    ]);
    if(ctx!==reviewContextKey()||version!==reviewVersion||home!==draftHome)throw Error('Household state changed while reopening the original attempt. Its pending payload remains retained.');
    const bundle=inspectRequestPackage(raw),response=inspectResponse(original.response,bundle.request);
    if(target.kind!=='week')throw Error('The original target is no longer an owned saved week.');
    const archiveKey=reviewStorageKey()+':attempt:'+reviewDigest(original);
    sessionStorage.setItem(archiveKey,JSON.stringify({payload:original,outcome,archivedAt:new Date().toISOString()}));
    sessionStorage.removeItem(reviewStorageKey());
    reviewPending=null;pendingOutcome=null;reviewBundle=bundle;reviewRequest=bundle.request;returnResponse=response;returnPreview=null;previewContext=null;
    reviewKnown.set(reviewRequest.id,reviewRequest);weekKnown.set(target.id,target);
    $('review-request-summary').textContent='Reopened original request #'+reviewRequest.sequence+' after a confirmed uncommitted attempt.';
    $('review-return-summary').textContent='Original response '+response.responseId+' is preserved. Choose a current saved week and review the changes again.';
    refreshReview();$('review-target').value=target.id;$('review-preview').classList.add('only-hidden');$('error').textContent='';
    reviewStatus('The earlier exact attempt is archived in this tab. Preview the same returned response against the deliberately selected saved week; fresh apply will use current household state.');
  }catch(e){problem(e);}
  finally{busy=false;refresh();}
};

$('week-form').addEventListener('input',changed);
$('week-form').onsubmit=async event=>{
  event.preventDefault();if(busy||blocked())return;
  try{capture();persist();}catch(error){problem(error);return;}
  const result=await mutate('plan',{input:draft});
  if(result){
    record=result.record;recordHome=draftHome;dirty=false;persist();renderRecord();await loadHistory();
    const url=new URL(location.href);url.searchParams.set('record',record.id);history.replaceState(null,'',url);
    status('Week saved in household history. '+record.detail.report.totals.plannedDays+' days planned; '+record.detail.report.totals.infeasibleDays+' need attention.');
    $('results-title').scrollIntoView({behavior:'smooth',block:'start'});
  }
};
$('day-enabled').addEventListener('change',()=>{if(draft){draft.days[selected].enabled=$('day-enabled').checked;$('day-rest').classList.toggle('only-hidden',draft.days[selected].enabled);refresh();}});
$('week-start').addEventListener('change',()=>{$('day-title').textContent=displayDate(dateAt(draft.startDate,selected));});
$('copy-weekdays').onclick=()=>copyDays('weekdays');$('copy-weekend').onclick=()=>copyDays('weekend');$('copy-all').onclick=()=>copyDays('all');
$('edit-saved').onclick=()=>editRecord();
$('history-newer').onclick=()=>loadHistory(Math.max(0,page.offset-page.limit));$('history-older').onclick=()=>loadHistory(page.offset+page.limit);
$('refresh-history').onclick=async()=>{try{receiveState(await read('/api/state'));await loadHistory();}catch(error){problem(error);}};
$('new-week').onclick=async()=>{if(busy)return;try{receiveState(await read('/api/state'));await freshDraft();$('error').textContent='';}catch(error){problem(error);}};
addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
try{
  const requestedRecord=new URL(location.href).searchParams.get('record');
  state=await read('/api/state');draftHome=state.workspace.selectedId;
  let saved;
  try{saved=JSON.parse(sessionStorage.getItem(draftKey())||'null');}catch{}
  if(saved?.draft?.days?.length===7&&saved.draft.days.every(day=>typeof day.enabled==='boolean'&&Array.isArray(day.scenario?.tasks))){
    draft=saved.draft;selected=Number.isInteger(saved.selected)&&saved.selected>=0&&saved.selected<7?saved.selected:0;dirty=saved.dirty===true;
    fillDraft();status('Reopened this tab’s weekly draft. Saved results remain in household history.');await loadHistory();
  }else await freshDraft();
  if(requestedRecord)await openRecord(requestedRecord);
  const requestedReview=new URL(location.href).searchParams.get('review');if(requestedReview)await openReview(requestedReview);
}catch(error){problem(error);}

