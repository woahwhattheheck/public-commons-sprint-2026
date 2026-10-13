// Selected original cases, one native delivery agenda and original source navigation.
import {calendarMonthDays,calendarMonthShift,selectCalendarEntries} from './operations_calendar.mjs';

const SCHEMA='stellar-forge.sf47-delivery-agenda.v1';
const VIEW_SCHEMA='stellar-forge.sf47-delivery-agenda-view.v1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=value=>String(value??'').toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const today=()=>new Date().toISOString().slice(0,10);
const civil=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number(value.slice(0,4))<1)return false;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===value;
};
const button=(text,action,attrs='',disabled=false)=>'<button type="button" data-agenda-action="'+action+'" '+attrs+
  (disabled?' disabled data-agenda-fixed="true"':'')+'>'+esc(text)+'</button>';
const options=(values,current)=>values.map(([value,text])=>'<option value="'+esc(value)+'"'+
  (String(value)===String(current)?' selected':'')+'>'+esc(text)+'</option>').join('');
const range=entry=>!entry.startDate&&!entry.endDate?'Dates to assign':!entry.startDate?
  'Due '+entry.endDate+' (start unassigned)':!entry.endDate?'Starts '+entry.startDate+' (due date unassigned)':
  entry.startDate===entry.endDate?entry.startDate:entry.startDate+' – '+entry.endDate;
const start=entry=>entry.startDate||entry.endDate;
const finish=entry=>entry.endDate||entry.startDate;
function download(blob,name){
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
export function deliveryAgendaQuery(caseIds,asOfDate,expectedVersions){
  const query=new URLSearchParams();
  for(const id of caseIds)query.append('caseId',id);
  if(asOfDate!==undefined)query.set('asOfDate',asOfDate);
  if(expectedVersions!==undefined)query.set('expectedVersions',JSON.stringify(expectedVersions));
  return '?'+query.toString();
}
export function agendaSourceSelection(report,item){
  const source=report.cases.find(row=>row.id===item.caseId),entry=item.entry;
  if(!source)throw new Error('Open an entry from the selected original agenda.');
  return {caseId:item.caseId,caseVersion:source.calendar.case.version,asOfDate:report.asOfDate,
    tab:entry.kind==='GRANT_RECEIPT'?'cash':'completion',tranche:entry.tranche,
    calendarEntryId:entry.id,cashId:entry.kind==='GRANT_RECEIPT'?entry.sourceId:undefined,
    receiptId:entry.kind==='SUBMISSION_DEADLINE'?entry.sourceId:entry.receiptId,
    costId:entry.costId,reviewId:entry.reviewId};
}
function table(headers,rows,empty='No entries match this view.'){
  return '<div class="delivery-agenda-table"><table><thead><tr>'+headers.map(text=>'<th scope="col">'+esc(text)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map((cell,index)=>'<td data-label="'+esc(headers[index])+'">'+cell+'</td>').join('')+'</tr>').join('')+
    (rows.length?'':'<tr><td colspan="'+headers.length+'">'+esc(empty)+'</td></tr>')+'</tbody></table></div>';
}
export function mountDeliveryAgenda({container,api,principal=null,session={},onOpen}){
  const root=document.createElement('section');root.className='delivery-agenda';
  root.setAttribute('aria-label','Delivery agenda across selected cases');container.replaceChildren(root);
  if(!document.querySelector('link[data-delivery-agenda-style]')){
    const style=document.createElement('link');style.rel='stylesheet';style.href='/operations_agenda.css';
    style.dataset.deliveryAgendaStyle='true';document.head.append(style);
  }
  const storageKey='sf47.delivery-agenda.'+(principal?.id||principal?.actor||'owner');
  const savedKeys=['caseIds','asOfDate','month','view','query','kind','tranche','owner','showInactive',
    'startDate','endDate','filterCase','selectedId','caseSearch'];
  if(!session.initialized){
    try{
      const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');
      if(saved?.schema===VIEW_SCHEMA)for(const key of savedKeys)
        if(Object.hasOwn(saved,key)&&!Object.hasOwn(session,key))session[key]=saved[key];
    }catch{}
    session.initialized=true;
  }
  const defaults={caseIds:[],asOfDate:today(),month:today().slice(0,7),view:'agenda',query:'',kind:'',
    tranche:'',owner:'',showInactive:false,startDate:'',endDate:'',filterCase:'',selectedId:'',caseSearch:''};
  for(const [key,value] of Object.entries(defaults))if(!Object.hasOwn(session,key))session[key]=value;
  session.caseIds=Array.isArray(session.caseIds)?[...new Set(session.caseIds.filter(id=>typeof id==='string'&&/^operation-[a-f0-9]{32}$/.test(id)))]:[];
  for(const key of ['query','kind','tranche','owner','filterCase','selectedId','caseSearch'])
    if(typeof session[key]!=='string')session[key]='';
  if(!civil(session.asOfDate))session.asOfDate=today();
  if(!civil(session.month+'-01'))session.month=session.asOfDate.slice(0,7);
  for(const key of ['startDate','endDate'])if(session[key]&&!civil(session[key]))session[key]='';
  if(!['agenda','month'].includes(session.view))session.view='agenda';
  session.showInactive=session.showInactive===true;session.page=0;
  let active=true,hostBusy=false,busy=false,epoch=0,cases=[],report=null,error='',notice='';
  const available=()=>active&&root.isConnected,$=selector=>root.querySelector(selector);
  const metadata=()=>new Map((report?.cases||[]).map(row=>[row.id,row.calendar]));
  const record=id=>[...(report?.entries||[]),...(report?.undated||[])].find(row=>row.id===id);
  function persist(){
    const saved={schema:VIEW_SCHEMA};
    for(const key of savedKeys)saved[key]=session[key];
    try{sessionStorage.setItem(storageKey,JSON.stringify(saved));}catch{}
  }
  function controls(){
    if(!available())return;
    root.setAttribute('aria-busy',String(busy||hostBusy));
    for(const node of root.querySelectorAll('button,input,select'))
      node.disabled=busy||hostBusy||node.dataset.agendaFixed==='true';
  }
  function caseRows(){
    const query=session.caseSearch.trim().toLocaleLowerCase();
    return cases.filter(row=>!query||[row.name,row.id,row.mode,row.state].join(' ').toLocaleLowerCase().includes(query));
  }
  function selectedDraftDiffers(){
    if(!report)return false;
    return session.asOfDate!==report.asOfDate||session.caseIds.length!==report.selection.caseIds.length||
      session.caseIds.some(id=>!report.selection.caseIds.includes(id));
  }
  function flatEntries(collection){
    const byCase=metadata(),needle=session.query.trim().toLocaleLowerCase();
    let rows=(report?.[collection]||[]).map(item=>({...item.entry,id:item.id,caseId:item.caseId,
      caseName:byCase.get(item.caseId).case.name,caseMode:byCase.get(item.caseId).case.mode}));
    if(session.filterCase)rows=rows.filter(row=>row.caseId===session.filterCase);
    if(session.owner)rows=rows.filter(row=>(row.ownerIds||[]).some(id=>row.caseId+':'+id===session.owner));
    rows=selectCalendarEntries(rows,{...session,owner:'',query:''});
    if(needle)rows=rows.filter(row=>[row.caseName,row.title,row.detail,row.costId,row.sourceId,row.status,
      ...(row.ownerNames||[])].join(' ').toLocaleLowerCase().includes(needle));
    return rows;
  }
  function chooser(){
    const visible=caseRows(),selected=new Set(session.caseIds);
    return '<section class="delivery-agenda-chooser"><h3>Select original cases</h3>'+
      '<p>Select the existing cases whose dates you want to review together. Each case keeps its own plan, records and history.</p>'+
      '<label>Find a case<input type="search" data-agenda-field="caseSearch" value="'+esc(session.caseSearch)+'" placeholder="Name or original case ID"></label>'+
      '<div class="delivery-agenda-case-actions">'+button('Select shown cases','select-shown','',!visible.length)+
      button('Clear selection','clear-cases','',!selected.size)+button('Refresh available cases','refresh-cases')+'</div>'+
      (cases.length?'<div class="delivery-agenda-cases">'+visible.map(row=>'<label class="delivery-agenda-case">'+
        '<input type="checkbox" data-agenda-case="'+esc(row.id)+'"'+(selected.has(row.id)?' checked':'')+'>'+
        '<span><strong>'+esc(row.name)+'</strong><small>'+esc(label(row.mode))+' · '+esc(label(row.state))+
        ' · version '+row.version+'</small><small>'+esc(row.id)+'</small></span></label>').join('')+
        (!visible.length?'<p>No cases match this search.</p>':'')+'</div>':
        '<p>No cases are available to this staff profile. Open Delivery operations to continue an assigned case.</p>')+
      '<div class="delivery-agenda-open"><label>Review date<input type="date" data-agenda-field="asOfDate" value="'+esc(session.asOfDate)+'" required></label>'+
      '<p>'+selected.size+' selected case'+(selected.size===1?'':'s')+'</p>'+
      button('Open selected agenda','open','',!selected.size)+'</div></section>';
  }
  function filters(){
    const byCase=metadata(),owners=new Map();
    for(const item of [...report.entries,...report.undated])for(let i=0;i<(item.entry.ownerIds||[]).length;i++){
      const id=item.caseId+':'+item.entry.ownerIds[i];
      owners.set(id,byCase.get(item.caseId).case.name+' · '+(item.entry.ownerNames[i]||item.entry.ownerIds[i]));
    }
    return '<section class="delivery-agenda-filters" aria-label="Agenda display filters"><div class="delivery-agenda-fields">'+
      '<label>Search events<input type="search" data-agenda-field="query" value="'+esc(session.query)+'" placeholder="Case, event, contributor or source"></label>'+
      '<label>Case<select data-agenda-field="filterCase">'+options([['','All selected cases'],...report.cases.map(row=>[row.id,row.calendar.case.name])],session.filterCase)+'</select></label>'+
      '<label>Event type<select data-agenda-field="kind">'+options([['','All event types'],['DEADLINE','Completion deadlines'],['WORK','Deliverables and plans'],['PAYMENT','Grant payments'],['SUBMISSION','Submitted forms']],session.kind)+'</select></label>'+
      '<label>Tranche<select data-agenda-field="tranche">'+options([['','All tranches'],['1','Tranche 1'],['2','Tranche 2'],['3','Tranche 3']],session.tranche)+'</select></label>'+
      '<label>Contributor<select data-agenda-field="owner">'+options([['','All contributors'],...[...owners].sort((a,b)=>a[1].localeCompare(b[1]))],session.owner)+'</select></label>'+
      '<label>From date<input type="date" data-agenda-field="startDate" value="'+esc(session.startDate)+'"></label>'+
      '<label>Through date<input type="date" data-agenda-field="endDate" value="'+esc(session.endDate)+'"></label></div>'+
      '<div class="delivery-agenda-filter-actions"><label class="delivery-agenda-check"><input type="checkbox" data-agenda-field="showInactive"'+(session.showInactive?' checked':'')+'> Include inactive entries</label>'+
      button('From reviewed date','upcoming')+button('Clear display filters','clear-filters')+
      button('Agenda','view-agenda','aria-pressed="'+(session.view==='agenda')+'"')+
      button('Month','view-month','aria-pressed="'+(session.view==='month')+'"')+'</div></section>';
  }
  function eventButton(row,compact=false){
    return button((compact?row.caseName+' · ':'')+row.title,'select','data-agenda-id="'+esc(row.id)+'" class="'+
      (compact?'delivery-agenda-event':'delivery-agenda-link')+'"'+(session.selectedId===row.id?' aria-current="true"':''));
  }
  function rowCells(row){
    const inactive=row.active===false?' · inactive':'';
    return [esc(range(row)),esc(row.caseName)+'<small>'+esc(label(row.caseMode))+'</small>',
      eventButton(row)+'<small>'+esc((row.ownerNames||[]).join(', ')||'Contributor unassigned')+'</small>',
      esc(label(row.status)+inactive)+(row.tranche==null?'':'<small>Tranche '+esc(row.tranche)+'</small>'),
      button(row.kind==='GRANT_RECEIPT'?'Open original payment':'Open original tranche','source','data-agenda-id="'+esc(row.id)+'"')];
  }
  function agendaRows(rows){
    const pages=Math.max(1,Math.ceil(rows.length/40));session.page=Math.max(0,Math.min(session.page,pages-1));
    return table(['Date or period','Original case','Work or event','State','Source'],rows.slice(session.page*40,(session.page+1)*40).map(rowCells))+
      '<div class="delivery-agenda-pagination"><span>'+rows.length+' matching dated entries · page '+(session.page+1)+' of '+pages+'</span>'+
      button('Previous page','page-back','',session.page===0)+button('Next page','page-next','',session.page===pages-1)+'</div>';
  }
  function month(rows){
    const days=calendarMonthDays(session.month),first=new Date(session.month+'-01T00:00:00Z');
    const heading=new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'}).format(first);
    return '<div class="delivery-agenda-month-actions">'+button('Previous month','month-back','',session.month==='0001-01')+
      '<h3>'+esc(heading)+'</h3>'+button('Next month','month-next','',session.month==='9999-12')+button('Go to reviewed date','reviewed-month')+'</div>'+
      '<div class="delivery-agenda-month-scroll"><div class="delivery-agenda-weekdays" aria-hidden="true">'+
      ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=>'<span>'+day+'</span>').join('')+'</div>'+
      '<div class="delivery-agenda-grid">'+days.map(day=>{
        if(!day)return '<div class="delivery-agenda-day delivery-agenda-outside"></div>';
        const entries=rows.filter(row=>start(row)<=day&&finish(row)>=day);
        return '<section class="delivery-agenda-day'+(day.slice(0,7)!==session.month?' delivery-agenda-outside':'')+
          (day===report.asOfDate?' delivery-agenda-reviewed':'')+'" aria-label="'+esc(day)+'">'+
          '<time datetime="'+day+'">'+Number(day.slice(-2))+'</time>'+entries.slice(0,3).map(row=>eventButton(row,true)).join('')+
          (entries.length>3?button('View all '+entries.length,'day','data-agenda-day="'+day+'" class="delivery-agenda-link"'):'')+'</section>';
      }).join('')+'</div></div>';
  }
  function detail(){
    const item=record(session.selectedId);if(!item)return '';
    const meta=metadata().get(item.caseId),row=item.entry;
    const fields=[['Case',meta.case.name],['Original case ID',item.caseId],['Case mode / version',label(meta.case.mode)+' / '+meta.case.version],
      ['Event',row.title],['Type',label(row.kind)],['Date or period',range(row)],['State',label(row.status)],
      ['Date basis',label(row.dateBasis)],['Original record',row.sourceId],['Work package',row.costId],
      ['Contributors',(row.ownerNames||[]).join(', ')||'Unassigned'],['Original deadline',row.originalDeadlineOn],
      ['Confirmed deadline',row.confirmedDeadlineOn],['Submitted deadline',row.submittedDeadlineOn],
      ['Source attachments',(row.sourceIds||[]).join(', ')],['Plan',meta.source.planId+' · revision '+meta.source.planRevision]];
    return '<section class="delivery-agenda-detail" tabindex="-1"><div class="delivery-agenda-heading"><h3>Original entry</h3>'+
      button('Close entry','close-detail')+'</div><dl>'+fields.filter(([,value])=>value!==undefined&&value!==null&&value!=='').map(([name,value])=>
        '<div><dt>'+esc(name)+'</dt><dd>'+esc(value)+'</dd></div>').join('')+'</dl>'+
      (row.detail?'<p class="delivery-agenda-note">'+esc(row.detail)+'</p>':'')+
      '<div class="delivery-agenda-actions">'+button(row.kind==='GRANT_RECEIPT'?'Open original payment':'Open original tranche','source','data-agenda-id="'+esc(item.id)+'"')+
      button('Open case calendar','open-case','data-agenda-case-id="'+esc(item.caseId)+'" data-agenda-id="'+esc(item.id)+'"')+'</div></section>';
  }
  function exportPanel(){
    return '<section class="delivery-agenda-export"><h3>Use the complete selected agenda</h3>'+
      '<p>Downloads contain all dates and undated rows from the '+report.cases.length+' displayed cases at their shown versions. Display filters only change this screen.</p>'+
      '<div class="delivery-agenda-actions">'+button('Download calendar (.ics)','export-ics')+
      button('Download all rows (.csv)','export-csv')+button('Download complete source (.json)','export-json')+'</div>'+
      '<p>Each event keeps its original case identity. Import the .ics into a dedicated calendar; it is a saved snapshot. Continue editable work in the original case.</p>'+
      '<details><summary>Selected source cases and date meaning</summary>'+
      table(['Case','Native version','Saved plan','Original calendar'],report.cases.map(item=>{
        const meta=item.calendar;return [esc(meta.case.name)+'<small>'+esc(item.id)+'</small>',String(meta.case.version),
          esc(meta.source.planId)+'<small>Revision '+meta.source.planRevision+'</small>',
          button('Open case calendar','open-case','data-agenda-case-id="'+esc(item.id)+'"')];
      }))+'<ul>'+report.basis.map(text=>'<li>'+esc(text)+'</li>').join('')+'</ul></details></section>';
  }
  function render(){
    if(!available())return;
    const rows=flatEntries('entries'),undated=flatEntries('undated');
    root.innerHTML='<div class="delivery-agenda-heading"><div><h2>Delivery agenda</h2>'+
      '<p>Review retained deadlines and work across selected original cases.</p></div>'+
      button('Refresh shown agenda','refresh','',!report)+'</div>'+
      (error?'<p class="delivery-agenda-error" role="alert">'+esc(error)+'</p>':'')+
      '<p class="delivery-agenda-notice" role="status" aria-live="polite">'+esc(notice)+'</p>'+
      '<div class="delivery-agenda-layout">'+chooser()+'<div class="delivery-agenda-main">'+
      (report?'<div class="delivery-agenda-summary">'+[['Selected cases',report.summary.cases],['Open deadlines',report.summary.activeDeadlines],
        ['Overdue deadlines',report.summary.overdueDeadlines],['Undated entries',report.summary.undated]].map(([name,value])=>
          '<div><span>'+esc(name)+'</span><strong>'+value+'</strong></div>').join('')+'</div>'+
        '<p class="delivery-agenda-shown">Showing '+report.cases.length+' original cases · reviewed '+esc(report.asOfDate)+
        (selectedDraftDiffers()?'. The case or date selection has changed; choose Open selected agenda to display it.':'.')+'</p>'+
        filters()+(session.view==='month'?month(rows):agendaRows(rows))+detail()+
        (undated.length?'<details class="delivery-agenda-undated"><summary>'+undated.length+' matching entries with dates to assign</summary>'+
          table(['Date or period','Original case','Work or event','State','Source'],undated.map(rowCells))+'</details>':'')+
        exportPanel():'<section class="delivery-agenda-empty"><h3>Open the cases you want to review</h3>'+
        '<p>Choose existing cases and a review date. Their current saved calendars will open together, with links back to each original payment or tranche.</p></section>')+
      '</div></div>';
    controls();
  }
  async function availableCases(){
    const response=await api('/api/operations');
    if(!response||!Array.isArray(response.cases)||response.cases.some(row=>!/^operation-[a-f0-9]{32}$/.test(row.id)))
      throw new Error('The original case directory is unavailable.');
    return response.cases;
  }
  async function openSelected({refreshCases=false,shown=false}={}){
    if(busy||hostBusy||!available())return;
    const ids=[...(shown&&report?report.selection.caseIds:session.caseIds)];
    const asOfDate=shown&&report?report.asOfDate:session.asOfDate;
    if(!civil(asOfDate)){error='Choose an actual calendar date.';render();return;}
    if(!ids.length){error='Select at least one original case.';render();return;}
    const token=++epoch;busy=true;error='';notice='';render();
    try{
      let currentCases=cases;
      if(refreshCases)currentCases=await availableCases();
      if(!available()||token!==epoch)return;
      const directory=new Map(currentCases.map(row=>[row.id,row]));
      if(ids.some(id=>!directory.has(id)))throw new Error('A selected case is no longer available. Refresh the case selection.');
      const versions=Object.fromEntries(ids.map(id=>[id,directory.get(id).version]));
      const next=await api('/api/operations/delivery-agenda'+deliveryAgendaQuery(ids,asOfDate,versions));
      if(!available()||token!==epoch)return;
      if(next?.schema!==SCHEMA||next.asOfDate!==asOfDate||!Array.isArray(next.cases)||
        !Array.isArray(next.entries)||!Array.isArray(next.undated)||next.cases.length!==ids.length||
        next.cases.some((row,index)=>row.id!==ids[index]||row.calendar?.case?.id!==row.id||
          row.calendar.case.version!==versions[row.id])||next.selection?.caseIds?.join('\0')!==ids.join('\0'))
        throw new Error('The agenda response does not match the selected original cases and versions.');
      cases=currentCases;report=next;session.page=0;
      if(session.filterCase&&!ids.includes(session.filterCase))session.filterCase='';
      if(session.selectedId&&!record(session.selectedId))session.selectedId='';
      notice='Opened the complete native agenda for '+ids.length+' selected case'+(ids.length===1?'':'s')+'.';
      persist();
    }catch(cause){if(available()&&token===epoch)error=cause.message||String(cause);}
    finally{if(available()&&token===epoch){busy=false;render();}}
  }
  async function refreshDirectory(){
    if(busy||hostBusy||!available())return;
    const token=++epoch;busy=true;error='';render();
    try{
      const values=await availableCases();if(!available()||token!==epoch)return;
      cases=values;const allowed=new Set(cases.map(row=>row.id));
      const removed=session.caseIds.filter(id=>!allowed.has(id));session.caseIds=session.caseIds.filter(id=>allowed.has(id));
      // A revoked case also leaves the already displayed report immediately.
      if(report?.cases.some(row=>!allowed.has(row.id)))report=null;
      notice=removed.length?'Refreshed available cases; unavailable selections were removed.':'Refreshed the original case directory.';
      persist();
    }catch(cause){if(available()&&token===epoch)error=cause.message||String(cause);}
    finally{if(available()&&token===epoch){busy=false;render();}}
  }
  function updateField(node){
    const key=node.dataset.agendaField;if(!key)return;
    if(key==='showInactive')session[key]=node.checked;
    else session[key]=node.value;
    session.page=0;error='';persist();
  }
  root.addEventListener('input',event=>{
    const node=event.target.closest('[data-agenda-field]');
    if(!node||busy||hostBusy||!['query','caseSearch'].includes(node.dataset.agendaField))return;
    const key=node.dataset.agendaField,position=node.selectionStart;updateField(node);render();
    const next=$('[data-agenda-field="'+key+'"]');next?.focus();try{next?.setSelectionRange(position,position);}catch{}
  });
  root.addEventListener('change',event=>{
    if(busy||hostBusy)return;
    const choice=event.target.closest('[data-agenda-case]');
    if(choice){const ids=new Set(session.caseIds);if(choice.checked)ids.add(choice.dataset.agendaCase);else ids.delete(choice.dataset.agendaCase);
      session.caseIds=[...ids];error='';persist();render();return;}
    const node=event.target.closest('[data-agenda-field]');if(!node)return;
    updateField(node);
    if(['startDate','endDate'].includes(node.dataset.agendaField)&&node.value&&!civil(node.value))
      error='Choose complete calendar dates for the display range.';
    if(session.startDate&&session.endDate&&session.endDate<session.startDate)
      error='The display range must finish on or after its start.';
    render();
  });
  root.addEventListener('click',async event=>{
    const target=event.target.closest('[data-agenda-action]');if(!target||busy||hostBusy||!available())return;
    const action=target.dataset.agendaAction;
    if(action==='open'){await openSelected();return;}
    if(action==='refresh'){await openSelected({refreshCases:true,shown:true});return;}
    if(action==='refresh-cases'){await refreshDirectory();return;}
    if(action==='select-shown'){session.caseIds=[...new Set([...session.caseIds,...caseRows().map(row=>row.id)])];persist();render();return;}
    if(action==='clear-cases'){session.caseIds=[];persist();render();return;}
    if(action==='select'){session.selectedId=target.dataset.agendaId;persist();render();$('.delivery-agenda-detail')?.focus({preventScroll:true});$('.delivery-agenda-detail')?.scrollIntoView({block:'nearest'});return;}
    if(action==='close-detail'){session.selectedId='';persist();render();return;}
    if(action==='view-agenda'||action==='view-month'){session.view=action.slice(5);persist();render();return;}
    if(action==='page-back'||action==='page-next'){session.page+=action==='page-next'?1:-1;render();return;}
    if(action==='month-back'||action==='month-next'){session.month=calendarMonthShift(session.month,action==='month-next'?1:-1);persist();render();return;}
    if(action==='reviewed-month'){session.month=report.asOfDate.slice(0,7);persist();render();return;}
    if(action==='day'){session.startDate=target.dataset.agendaDay;session.endDate=target.dataset.agendaDay;session.view='agenda';session.page=0;persist();render();return;}
    if(action==='upcoming'){session.startDate=report.asOfDate;session.endDate='';session.page=0;persist();render();return;}
    if(action==='clear-filters'){Object.assign(session,{query:'',kind:'',tranche:'',owner:'',filterCase:'',showInactive:false,startDate:'',endDate:'',page:0});error='';persist();render();return;}
    if(action==='source'||action==='open-case'){
      if(typeof onOpen!=='function'){error='Open Delivery operations to continue the original case.';render();return;}
      let selected;
      if(action==='source'){const item=record(target.dataset.agendaId);if(!item)return;selected=agendaSourceSelection(report,item);}
      else{const item=report.cases.find(row=>row.id===target.dataset.agendaCaseId);if(!item)return;
        const source=target.dataset.agendaId?record(target.dataset.agendaId):null;
        selected={caseId:item.id,caseVersion:item.calendar.case.version,asOfDate:report.asOfDate,tab:'calendar',
          calendarEntryId:source?.caseId===item.id?source.entry.id:undefined};}
      busy=true;error='';controls();
      try{await onOpen(selected);}catch(cause){if(available())error=cause.message||String(cause);}
      finally{if(available()){busy=false;render();}}
      return;
    }
    if(action.startsWith('export-')&&report){
      const format=action.slice(7);if(!['ics','csv','json'].includes(format))return;
      const selected=report,token=epoch;busy=true;error='';notice='';controls();
      try{
        const response=await api('/api/operations/delivery-agenda/export.'+format+
          deliveryAgendaQuery(selected.selection.caseIds,selected.asOfDate,selected.selection.expectedVersions),undefined,{download:true});
        const blob=await response.blob();
        if(!available()||token!==epoch)return;
        download(blob,'sf47-delivery-agenda-'+selected.asOfDate+'.'+format);
        notice='Downloaded all '+selected.cases.length+' selected cases at their displayed versions.';
      }catch(cause){if(available()&&token===epoch)error=cause.message||String(cause);}
      finally{if(available()&&token===epoch){busy=false;render();}}
    }
  });
  async function initialize(){
    busy=true;render();
    try{
      const values=await availableCases();if(!available())return;
      cases=values;const allowed=new Set(cases.map(row=>row.id));
      session.caseIds=session.caseIds.filter(id=>allowed.has(id));persist();
    }catch(cause){if(available())error=cause.message||String(cause);}
    finally{if(available()){busy=false;render();}}
    if(available()&&session.caseIds.length&&!error)await openSelected();
  }
  const ready=initialize();
  return {root,ready,setHostBusy(value){hostBusy=Boolean(value);controls();},
    dispose(){active=false;epoch++;persist();report=null;cases=[];}};
}
