// MIT. Complete resource calendar desk inside the original Portfolio editor.
import {AVAILABILITY_SCHEMA,availabilityHours,availabilitySignature,availabilitySelection,availabilityView,prepareAvailability,reviewAvailability,applyAvailability,availabilityCsv,availabilityDeskKey,emptyAvailabilityDesk,validateAvailabilityDesk} from './portfolio-availability.mjs';
const copy=v=>JSON.parse(JSON.stringify(v));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const DAY=86400000;
function day(n){return new Date(n).toISOString().slice(0,10);}
function end(c){return day(Date.parse(c.startDate+'T00:00:00Z')+(c.horizonDays-1)*DAY);}
function shown(v){return v===null||v===undefined?'Unentered':String(v);}
function field(label,value,name,wide=false){return '<label'+(wide?' class="availability-wide"':'')+'>'+esc(label)+'<input type="text" data-av-field="'+name+'" value="'+esc(value)+'"></label>';}
function option(label,value,name,rows){return '<label>'+esc(label)+'<select data-av-field="'+name+'">'+rows.map(([id,title])=>'<option value="'+esc(id)+'"'+(id===value?' selected':'')+'>'+esc(title)+'</option>').join('')+'</select></label>';}
function button(label,action,disabled=false,extra=''){return '<button type="button" data-av-action="'+action+'"'+(disabled?' disabled data-portfolio-disabled="true"':'')+' '+extra+'>'+esc(label)+'</button>';}
function table(headers,rows){return '<div class="availability-table"><table><thead><tr>'+headers.map(v=>'<th>'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function download(content,name,mime){const blob=new Blob([content],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export function createPortfolioAvailability({root,getInputs,getProfile,setProfile,getState,onState,onApply,isBusy=()=>false,canEdit=()=>true}){
 let state=validateAvailabilityDesk(getState()||emptyAvailabilityDesk()),active=true,message='',error=false;
 const originalHandler=new AbortController(),signal=originalHandler.signal;
 const inputs=()=>getInputs(),current=()=>state.selected?state.drafts[state.selected]:null;
 function retained(){if(!active)return;onState(copy(state));}
 function status(text,bad=false){message=text;error=bad;const node=root.querySelector('[data-av-status]');if(node){node.textContent=text;node.setAttribute('role',bad?'alert':'status');}}
 function draft(profile,id){
  const selected=availabilitySelection(inputs(),profile),r=selected.resources.find(x=>x.id===id);if(!r)throw Error('Select an existing resource.');
  const key=availabilityDeskKey(profile,id,selected.forecastId);
  if(!state.drafts[key]){state.drafts[key]={forecastId:selected.forecastId,profile,resourceId:id,month:selected.calendar.startDate.slice(0,7),from:selected.calendar.startDate,to:end(selected.calendar),kind:'RANGE',operation:'SET',hours:'',values:r.hoursByWeekday.map(x=>x===null||x===''?'':availabilityHours(x)),weekdays:[0,1,2,3,4,5,6],includeClosed:false,sourceProfile:profile,sourceResourceId:id,note:'',proposal:null,choices:{},page:0};}
  state.selected=key;retained();return state.drafts[key];
 }
 function selected(){
  if(!inputs())return null;const profile=getProfile(),sel=availabilitySelection(inputs(),profile),d=current();
  if(!d||d.forecastId!==sel.forecastId||d.profile!==profile||!sel.resources.some(r=>r.id===d.resourceId))return sel.resources.length?draft(profile,sel.resources[0].id):null;
  return d;
 }
 function monthView(d){
  const sel=availabilitySelection(inputs(),d.profile),m=d.month;
  const n=Date.parse(m+'-01T00:00:00Z');if(!/^\d{4}-\d{2}$/.test(m)||!Number.isFinite(n)||day(n).slice(0,7)!==m)return {sel,view:null,issue:'Complete the displayed month as YYYY-MM. Its unfinished text remains retained.'};
  const last=new Date(n);last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
  const from=day(n)<sel.calendar.startDate?sel.calendar.startDate:day(n),to=day(last)>end(sel.calendar)?end(sel.calendar):day(last);
  if(from>to)return {sel,view:null};
  return {sel,view:availabilityView(inputs(),{profile:d.profile,resourceId:d.resourceId,from,to})};
 }
 function renderReview(d){
  if(!d.proposal)return '<p class="availability-empty">Prepare a complete change review to compare every original and proposed date before applying.</p>';
  let r;try{r=reviewAvailability(inputs(),d.proposal,{choices:d.choices});}catch(e){return '<p role="alert">'+esc(e.message)+'</p>'+button('Clear retained conflict choices','clear-choices')+button('Prepare fresh review from these fields','prepare',!canEdit());}
  const first=d.page*31,rows=r.rows.slice(first,first+31),conflicts=r.decisions.filter(x=>x.conflict);
  return '<section class="availability-block"><h4>Complete change review</h4><p>'+r.rows.length+' original dates retained; '+r.proposal.patches.length+' changed fields. '+(r.proposal.command.kind==='RANGE'?'Only selected dates are changed.':'Repeating weekday changes are reviewed across the whole program horizon.')+'</p>'+
   (r.calendarChanged?'<p role="alert">The program calendar changed. Prepare a fresh review before applying.</p>':'')+
   (r.sourceChanged?'<p role="alert">The copied source pattern changed. Prepare a fresh review before applying.</p>':'')+
   (conflicts.length?'<h5>Concurrent original-field decisions</h5>'+table(['Field','Retained original','Current draft','Proposed','Decision'],conflicts.map(c=>[esc(c.key),esc(c.before.present?shown(c.before.value):'No override'),esc(c.current.present?shown(c.current.value):'No override'),esc(c.after.present?shown(c.after.value):'Restore weekday pattern'),'<select aria-label="Decision for '+esc(c.key)+'" data-av-choice="'+esc(c.key)+'"><option value="">Choose explicitly</option><option value="current"'+(c.take==='current'?' selected':'')+'>Keep current</option><option value="proposed"'+(c.take==='proposed'?' selected':'')+'>Use proposed</option></select>'])):'')+
   table(['Date','Program','Original hours','Current hours','Proposed hours','Reviewed result','Current basis'],rows.map(row=>[esc(row.date),row.current.calendarOpen?'Open':'Closed',esc(shown(row.original.hours)),esc(shown(row.current.hours)),esc(shown(row.proposed.hours)),esc(shown(row.result.hours)),esc(row.current.source==='DATE_OVERRIDE'?'Dated override':'Weekday pattern')]))+
   '<div class="availability-actions">'+button('Previous 31 dates','previous',d.page===0)+button('Next 31 dates','next',first+31>=r.rows.length)+'<span>Dates '+(rows.length?first+1:0)+'–'+(first+rows.length)+' of '+r.rows.length+'</span></div>'+
   '<p>Unentered availability remains unknown. Closed program dates schedule 0 hours even when a resource has recorded availability; changing capacity does not open the program calendar.</p>'+
   '<div class="availability-actions">'+button('Apply reviewed capacity to original draft','apply',!canEdit()||!r.canApply)+button('Download complete review JSON','review-json')+button('Clear current review','clear-review')+'</div></section>';
 }
 function render(){
  if(!active)return;
  try{
   const d=selected();if(!d){root.innerHTML='<section class="portfolio-availability"><h4>Resource availability</h4><p>Create or open an allocation with an original resource to work on its complete staffing calendar.</p></section>';return;}
   const {sel,view,issue}=monthView(d),r=sel.resources.find(x=>x.id===d.resourceId),editable=canEdit()&&!sel.inherited;
   const profiles=[['base',inputs().name||'Base plan'],...inputs().alternatives.map(a=>[a.id,a.name||a.id])],sources=[];
   for(const[p,name]of profiles){const s=availabilitySelection(inputs(),p);for(const row of s.resources)sources.push([JSON.stringify([p,row.id]),name+' · '+(row.name||row.id)]);}
   const calendarRows=view?.rows||[],startBlank=calendarRows.length?(new Date(calendarRows[0].date+'T00:00:00Z').getUTCDay()+6)%7:0;
   const grid='<div class="availability-calendar" role="group" aria-label="Original daily capacity">'+DAYS.map(n=>'<div class="availability-day-heading">'+n.slice(0,3)+'</div>').join('')+Array(startBlank).fill('<span aria-hidden="true"></span>').join('')+calendarRows.map(row=>'<button type="button" data-av-date="'+row.date+'" class="availability-day'+(!row.calendarOpen?' availability-closed':'')+'"><strong>'+Number(row.date.slice(-2))+'</strong><span>'+esc(shown(row.hours))+(row.hours===null?'':' h')+'</span><small>'+(!row.calendarOpen?'Program closed':row.source==='DATE_OVERRIDE'?'Dated override':'Weekly pattern')+'</small></button>').join('')+'</div>';
   root.innerHTML='<section class="portfolio-availability"><div class="availability-heading"><div><h4>Resource availability</h4><p>Prepare complete staffing calendars by original resource and alternative. Review all changed dates before applying to the original allocation.</p></div></div><p data-av-status role="'+(error?'alert':'status')+'" aria-live="polite">'+esc(message)+'</p>'+
    '<div class="availability-fields">'+option('Allocation alternative',d.profile,'profile',profiles)+option('Original resource',d.resourceId,'resource',sel.resources.map(x=>[x.id,x.name||x.id]))+field('Displayed month',d.month,'month')+button('Show month','show-month')+'</div>'+
    (sel.inherited?'<p class="availability-note">This alternative inherits its whole resource field. Use Inputs and alternatives → Resource availability → Override this whole resources field to create an independent replacement before editing.</p>':'')+
    (!canEdit()?'<p class="availability-note">The current original allocation is retained for reading. Open an editable allocation and resolve its original pending request before applying capacity changes.</p>':'')+
    '<p><strong>'+esc(r.name||r.id)+'</strong> · '+esc(sel.calendar.startDate)+' through '+esc(end(sel.calendar))+'. '+esc(r.note||'No availability basis entered.')+'</p>'+
    (view?'<div class="availability-summary"><span>'+view.summary.openDates+' open dates</span><span>'+esc(view.summary.knownSchedulableHours)+' known schedulable hours</span><span>'+view.summary.unenteredOpenDates+' open dates unentered</span></div>'+grid:'<p'+(issue?' role="alert"':'')+'>'+esc(issue||'No program dates fall in this displayed month.')+'</p>')+
    '<section class="availability-block"><h4>Prepare capacity changes</h4><div class="availability-fields">'+
    option('Change type',d.kind,'kind',[['RANGE','Dated range'],['WEEKLY','Repeating weekday pattern'],['COPY_PATTERN','Copy a selected resource pattern']])+
    (d.kind==='RANGE'?field('First date',d.from,'from')+field('Last date',d.to,'to')+option('Dated operation',d.operation,'operation',[['SET','Set explicit dated hours'],['CLEAR_OVERRIDE','Remove overrides; restore weekday pattern']])+(d.operation==='SET'?field('Hours on selected dates',d.hours,'hours'):''):'<p class="availability-wide">This repeating pattern affects every matching date across the entire original program horizon. Existing dated overrides remain.</p>')+
    (d.kind==='COPY_PATTERN'?option('Exact authored source pattern',JSON.stringify([d.sourceProfile,d.sourceResourceId]),'source',sources):'')+
    '</div><fieldset class="availability-weekdays"><legend>Selected weekdays</legend>'+DAYS.map((name,i)=>'<label><input type="checkbox" data-av-weekday="'+i+'"'+(d.weekdays.includes(i)?' checked':'')+'>'+name+'</label>').join('')+'</fieldset>'+
    (d.kind==='WEEKLY'?'<div class="availability-weekly">'+DAYS.map((name,i)=>field(name+' hours',d.values[i],'value:'+i)).join('')+'</div><p>Blank means unentered availability; 0 is an explicit unavailable day. Unselected weekday values remain unchanged.</p>':'')+
    (d.kind==='RANGE'?'<label class="availability-check"><input type="checkbox" data-av-field="includeClosed"'+(d.includeClosed?' checked':'')+'>Include program-closed dates in this recorded range edit</label>':'')+
    '<label class="availability-wide">Availability source or review note<textarea data-av-field="note" rows="3">'+esc(d.note)+'</textarea></label><p>The note appends to the original resource basis only when this complete review is applied. Raw unfinished form values stay with this resource.</p>'+
    '<div class="availability-actions">'+button('Prepare complete change review','prepare',!editable)+button('Download selected resource calendar CSV','csv')+button('Download calendar and review JSON','json')+'</div></section>'+
    renderReview(d)+
    '<section class="availability-block"><h4>Retained applied reviews</h4><p>'+state.history.length+' complete original reviews remain in this working copy and its portable export.</p>'+
    (state.history.length?table(['Applied','Resource','Alternative','Change','Complete original review'],state.history.map((h,i)=>[esc(h.at),esc(h.proposal.basis.resource.name||h.proposal.resourceId),esc(h.proposal.profile),esc(h.proposal.command.kind+' · '+h.proposal.command.from+'–'+h.proposal.command.to),button('Download','history',false,'data-index="'+i+'"')])):'')+'</section></section>';
  }catch(e){root.innerHTML='<section class="portfolio-availability"><h4>Resource availability</h4><p role="alert">'+esc(e.message)+'</p><p>The original allocation and retained calendar forms remain intact. Complete its calendar or resource values in Inputs and alternatives, then reopen this view.</p></section>';}
 }
 function changeField(el){
  const d=current();if(!d)return;
  const name=el.dataset.avField;
  if(name==='profile'){setProfile(el.value);return;}
  if(name==='resource'){draft(d.profile,el.value);render();return;}
  if(name==='source'){const[p,id]=JSON.parse(el.value);d.sourceProfile=p;d.sourceResourceId=id;}
  else if(name?.startsWith('value:'))d.values[Number(name.slice(6))]=el.value;
  else if(name)d[name]=name==='includeClosed'?el.checked:el.value;
  retained();
  if(['kind','operation','source'].includes(name))render();
 }
 root.addEventListener('input',event=>{
  if(!active||isBusy())return;const el=event.target;if(el.matches('input[data-av-field],textarea[data-av-field]'))changeField(el);
 },{signal});
 root.addEventListener('change',event=>{
  if(!active||isBusy())return;const el=event.target,d=current();if(!d)return;
  try{
   if(el.matches('select[data-av-field]'))changeField(el);
   else if(el.hasAttribute('data-av-weekday')){const i=Number(el.dataset.avWeekday);d.weekdays=el.checked?[...new Set([...d.weekdays,i])].sort():d.weekdays.filter(x=>x!==i);retained();}
   else if(el.hasAttribute('data-av-choice')){const key=el.dataset.avChoice,r=reviewAvailability(inputs(),d.proposal,{choices:d.choices}),cell=r.decisions.find(x=>x.key===key&&x.conflict);if(!cell)throw Error('Refresh the original changed-field review.');if(el.value)d.choices[key]={take:el.value,basis:cell.basis};else delete d.choices[key];retained();render();}
  }catch(e){status(e.message,true);}
 },{signal});
 root.addEventListener('click',event=>{
  const el=event.target.closest('[data-av-action],[data-av-date]');if(!el||!active||isBusy()||el.disabled)return;const d=current();if(!d)return;
  try{
   if(el.dataset.avDate){d.kind='RANGE';d.from=el.dataset.avDate;d.to=el.dataset.avDate;retained();render();return;}
   const action=el.dataset.avAction;
   if(action==='show-month'){render();return;}
   if(action==='prepare'){
    if(!canEdit())throw Error('Open the original editable allocation before preparing changes.');
    const sel=availabilitySelection(inputs(),d.profile),command={kind:d.kind,from:d.kind==='RANGE'?d.from:sel.calendar.startDate,to:d.kind==='RANGE'?d.to:end(sel.calendar),weekdays:copy(d.weekdays),note:d.note};
    if(d.kind==='RANGE')Object.assign(command,{operation:d.operation,hours:d.hours,includeClosed:d.includeClosed});else if(d.kind==='WEEKLY')command.values=copy(d.values);else Object.assign(command,{sourceProfile:d.sourceProfile,sourceResourceId:d.sourceResourceId});
    d.proposal=prepareAvailability(inputs(),command,{profile:d.profile,resourceId:d.resourceId});d.choices={};d.page=0;retained();status('Complete original/current/proposed dates are ready for review.');render();return;
   }
   if(action==='clear-choices'){d.choices={};retained();render();return;}
   if(action==='clear-review'){d.proposal=null;d.choices={};d.page=0;retained();render();return;}
   if(action==='previous'||action==='next'){d.page=Math.max(0,d.page+(action==='next'?1:-1));retained();render();return;}
   if(action==='apply'){
    if(!canEdit())throw Error('Open the original editable allocation before applying changes.');
    const before=copy(inputs()),result=applyAvailability(before,d.proposal,{choices:d.choices}),entry={at:new Date().toISOString(),proposal:copy(d.proposal),choices:copy(d.choices),decisions:copy(result.review.decisions)};
    const nextState=copy(state);nextState.history.push(entry);const nextDraft=nextState.drafts[nextState.selected];nextDraft.proposal=null;nextDraft.choices={};nextDraft.page=0;nextDraft.note='';
    onApply({beforeSignature:availabilitySignature(before),inputs:result.inputs,state:nextState,resourceId:d.resourceId,profile:d.profile,review:result.review});
    return;
   }
   if(action==='csv'||action==='json'){
    const view=availabilityView(inputs(),{profile:d.profile,resourceId:d.resourceId});
    if(action==='csv')download(availabilityCsv(view),'resource-availability-'+d.resourceId+'.csv','text/csv;charset=utf-8');
    else download(JSON.stringify({schema:'stellar-forge.portfolio-availability-calendar.v1',exportedAt:new Date().toISOString(),inputs:copy(inputs()),desk:copy(state),selectedCalendar:view},null,2)+'\n','portfolio-availability-working.json','application/json');
    status('Downloaded the complete selected calendar and its original values. Use the original complete working-copy download to carry all source bytes and resume this editor.');return;
   }
   if(action==='review-json'||action==='history'){const value=action==='history'?state.history[Number(el.dataset.index)]:reviewAvailability(inputs(),d.proposal,{choices:d.choices});if(!value)throw Error('Choose a retained original review.');download(JSON.stringify(value,null,2)+'\n','resource-availability-review.json','application/json');}
  }catch(e){status(e.message,true);}
 },{signal});
 render();
 return {render,dispose(){active=false;originalHandler.abort();}};
}
