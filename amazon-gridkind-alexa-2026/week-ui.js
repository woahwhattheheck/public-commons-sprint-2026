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
}catch(error){problem(error);}
