// Grant delivery agenda over the original Completion records.
const SCHEMA='stellar-forge.sf47-delivery-calendar.v1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=value=>String(value??'').toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const utcToday=()=>new Date().toISOString().slice(0,10);
const iso=value=>value.toISOString().slice(0,10);
const civil=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number(value.slice(0,4))<1)return null;
  const result=new Date(value+'T00:00:00.000Z');
  return Number.isFinite(result.valueOf())&&iso(result)===value?result:null;
};
const kinds=[['','All event types'],['DEADLINE','Completion deadlines'],['WORK','Deliverables and planned submission'],['PAYMENT','Grant payments'],['SUBMISSION','Submitted forms']];
const kindGroup=value=>{
  const kind=String(value||'').toUpperCase();
  if(kind.includes('DEADLINE')||kind==='EXTENSION_CONFIRMATION')return 'DEADLINE';
  if(kind.includes('WORK')||kind.includes('ASSIGN')||kind.startsWith('DELIVERABLE')||kind==='PLANNED_SUBMISSION')return 'WORK';
  if(kind.includes('PAYMENT')||kind.includes('RECEIPT'))return 'PAYMENT';
  if(kind.includes('SUBMI')||kind.includes('FORM'))return 'SUBMISSION';
  return kind;
};
const owners=entry=>(entry.ownerNames||[]).join(', ');
const inactive=entry=>entry.active===false||['VOID','CANCELLED','INACTIVE'].includes(entry.status);
const startDate=entry=>entry.startDate||entry.endDate;
const endDate=entry=>entry.endDate||entry.startDate;
const originTab=entry=>kindGroup(entry.kind)==='PAYMENT'?'cash':'completion';
const button=(text,action,attrs='',disabled=false)=>'<button type="button" data-calendar-action="'+action+'" '+attrs+(disabled?' disabled data-calendar-fixed="true"':'')+'>'+esc(text)+'</button>';

/** Monday-first civil-date cells, including the surrounding partial weeks. */
export function calendarMonthDays(month){
  if(typeof month!=='string'||!/^\d{4}-\d{2}$/.test(month))throw new Error('Choose a calendar month.');
  const first=civil(month+'-01');
  if(!first||Number(month.slice(0,4))<1)throw new Error('Choose a calendar month.');
  const last=new Date(first);last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
  const offset=(first.getUTCDay()+6)%7,count=Math.ceil((offset+last.getUTCDate())/7)*7;
  return Array.from({length:count},(_,index)=>{
    const day=new Date(first);day.setUTCDate(1-offset+index);
    return day.getUTCFullYear()<1||day.getUTCFullYear()>9999?null:iso(day);
  });
}
export function calendarMonthShift(month,change){
  if(!civil(month+'-01')||!Number.isInteger(change))throw new Error('Choose a calendar month.');
  const index=Number(month.slice(0,4))*12+Number(month.slice(5))-1+change;
  const year=Math.floor(index/12),part=index-year*12+1;
  return year<1||year>9999?month:String(year).padStart(4,'0')+'-'+String(part).padStart(2,'0');
}
export function selectCalendarEntries(entries,selection={}){
  const query=String(selection.query||'').trim().toLocaleLowerCase();
  return entries.filter(entry=>{
    if(!selection.showInactive&&inactive(entry))return false;
    if(selection.kind&&kindGroup(entry.kind)!==selection.kind)return false;
    if(selection.tranche&&String(entry.tranche)!==String(selection.tranche))return false;
    if(selection.owner&&!(entry.ownerIds||[]).includes(selection.owner))return false;
    if(selection.startDate&&endDate(entry)&&endDate(entry)<selection.startDate)return false;
    if(selection.endDate&&startDate(entry)&&startDate(entry)>selection.endDate)return false;
    if(query&&![entry.title,entry.detail,entry.costId,entry.sourceId,entry.status,owners(entry)]
      .join(' ').toLocaleLowerCase().includes(query))return false;
    return true;
  }).sort((a,b)=>(startDate(a)||'9999-99-99').localeCompare(startDate(b)||'9999-99-99')||
    (a.endDate||'').localeCompare(b.endDate||'')||a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
}
function saveFile(blob,name){
  const url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function table(headers,rows){
  return '<div class="calendar-table"><table><thead><tr>'+headers.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+
    (rows.length?'':'<tr><td colspan="'+headers.length+'">No dates match these filters.</td></tr>')+'</tbody></table></div>';
}
function range(entry){
  if(!entry.startDate&&!entry.endDate)return 'Dates to assign';
  if(!entry.startDate)return 'Due '+entry.endDate+' (start unassigned)';
  if(!entry.endDate)return 'Starts '+entry.startDate+' (due date unassigned)';
  return entry.endDate!==entry.startDate?entry.startDate+' – '+entry.endDate:entry.startDate;
}

export function mountDeliveryCalendar({container,current,api,session,onOpen}){
  const root=document.createElement('section');root.className='grant-delivery-calendar';
  root.setAttribute('aria-label','Grant delivery calendar');container.replaceChildren(root);
  if(!document.querySelector('link[data-grant-calendar-style]')){
    const style=document.createElement('link');style.rel='stylesheet';style.href='/operations_calendar.css';
    style.dataset.grantCalendarStyle='true';document.head.append(style);
  }
  const caseId=current.program.id,prefix='/api/operations/'+caseId,storageKey='sf47.delivery-calendar.'+caseId;
  const savedKeys=['asOfDate','month','view','query','kind','tranche','owner','showInactive','startDate','endDate','selectedId'];
  if(!session.initialized){
    try{
      const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');
      if(saved?.schema==='sf47.delivery-calendar-view.v1'&&saved.caseId===caseId)
        for(const key of savedKeys)if(Object.hasOwn(saved,key))session[key]=saved[key];
    }catch{}
    session.initialized=true;
  }
  for(const [key,value] of Object.entries({asOfDate:utcToday(),month:utcToday().slice(0,7),view:'agenda',
    query:'',kind:'',tranche:'',owner:'',showInactive:false,startDate:'',endDate:'',selectedId:'',page:0}))
    if(!Object.hasOwn(session,key))session[key]=value;
  if(!civil(session.asOfDate))session.asOfDate=utcToday();
  if(!civil(session.month+'-01'))session.month=session.asOfDate.slice(0,7);
  if(!['agenda','month'].includes(session.view))session.view='agenda';
  for(const key of ['startDate','endDate'])if(session[key]&&!civil(session[key]))session[key]='';
  for(const key of ['query','kind','tranche','owner','selectedId'])if(typeof session[key]!=='string')session[key]='';
  session.showInactive=session.showInactive===true;session.page=0;
  if(session.incomingAgenda){
    const incoming=session.incomingAgenda;
    if(civil(incoming.asOfDate)){session.asOfDate=incoming.asOfDate;session.month=incoming.asOfDate.slice(0,7);}
    if(typeof incoming.entryId==='string')session.selectedId=incoming.entryId;
    delete session.incomingAgenda;
  }
  let active=true,busy=false,hostBusy=false,epoch=0,report=null,error='',notice='';
  const available=()=>active&&root.isConnected,$=selector=>root.querySelector(selector);
  function persist(){
    const saved={schema:'sf47.delivery-calendar-view.v1',caseId};
    for(const key of savedKeys)saved[key]=session[key];
    try{sessionStorage.setItem(storageKey,JSON.stringify(saved));}catch{}
  }
  function controls(){
    if(!available())return;
    root.setAttribute('aria-busy',String(busy||hostBusy));
    for(const el of root.querySelectorAll('button,input,select'))
      el.disabled=busy||hostBusy||el.dataset.calendarFixed==='true';
  }
  function optionList(rows,value){
    return rows.map(([id,name])=>'<option value="'+esc(id)+'"'+(String(value)===String(id)?' selected':'')+'>'+esc(name)+'</option>').join('');
  }
  function status(entry){
    return '<span class="calendar-status'+(inactive(entry)?' calendar-muted':'')+'">'+esc(label(entry.status))+'</span>';
  }
  function eventButton(entry,compact=false){
    return button(entry.title,'select','data-calendar-id="'+esc(entry.id)+'" class="'+
      (compact?'calendar-event':'calendar-link')+'"'+(entry.id===session.selectedId?' aria-current="true"':''));
  }
  function sourceButton(entry){
    return button('Open '+(originTab(entry)==='cash'?'payment':'tranche'),'source',
      'data-calendar-id="'+esc(entry.id)+'" class="calendar-link"');
  }
  function agenda(entries){
    const pages=Math.max(1,Math.ceil(entries.length/40));session.page=Math.min(session.page,pages-1);
    const selected=entries.slice(session.page*40,(session.page+1)*40);
    return table(['Date / period','Work or event','Tranche','Status','Accountable owner','Original record'],
      selected.map(entry=>[esc(range(entry)),eventButton(entry),entry.tranche==null?'—':'T'+esc(entry.tranche),
        status(entry),esc(owners(entry)||'Unassigned'),sourceButton(entry)]))+
      '<div class="calendar-pagination"><span>'+entries.length+' matching dated events · page '+(session.page+1)+' of '+pages+'</span>'+
      button('Previous page','page-back','',session.page===0)+button('Next page','page-next','',session.page>=pages-1)+'</div>';
  }
  function monthGrid(entries){
    const days=calendarMonthDays(session.month),title=new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'})
      .format(civil(session.month+'-01'));
    return '<div class="calendar-month-bar">'+button('Previous month','month-back','',session.month==='0001-01')+
      '<h3>'+esc(title)+'</h3>'+button('Next month','month-next','',session.month==='9999-12')+
      button('Go to selected date','month-today')+'</div>'+
      '<div class="calendar-month-scroll"><div class="calendar-weekdays" aria-hidden="true">'+
      ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x=>'<span>'+x+'</span>').join('')+'</div>'+
      '<div class="calendar-grid">'+days.map(day=>{
        if(!day)return '<div class="calendar-day calendar-outside"></div>';
        const rows=entries.filter(entry=>startDate(entry)<=day&&endDate(entry)>=day);
        return '<section class="calendar-day'+(day.slice(0,7)!==session.month?' calendar-outside':'')+
          (day===session.asOfDate?' calendar-today':'')+'" aria-label="'+esc(day)+'"><time datetime="'+day+'">'+Number(day.slice(-2))+'</time>'+
          rows.slice(0,3).map(entry=>eventButton(entry,true)).join('')+
          (rows.length>3?button('View all '+rows.length,'day','data-calendar-day="'+day+'" class="calendar-link"'):'')+'</section>';
      }).join('')+'</div></div>';
  }
  function detail(){
    const entry=[...(report?.entries||[]),...(report?.undated||[])].find(row=>row.id===session.selectedId);
    if(!entry)return '';
    const pairs=[
      ['Record type',label(entry.kind)],['Work package',entry.costId],['Date / period',range(entry)],
      ['Status',label(entry.status)],['Accountable owners',owners(entry)||'Unassigned'],
      ['Original deadline',entry.originalDeadlineOn||entry.originalDeadlineDate],
      ['Deadline in record',entry.kind==='SUBMISSION_DEADLINE'?entry.startDate:entry.confirmedDeadlineOn||entry.submittedDeadlineOn],
      ['Date source',label(entry.dateBasis||entry.deadlineSource||entry.basis||entry.sourceKind)],['Reference',entry.reference]
    ].filter(([,value])=>value!=null&&value!=='');
    return '<aside class="calendar-detail" aria-label="Selected calendar event"><div class="calendar-detail-heading"><h3>'+esc(entry.title)+'</h3>'+
      button('Close details','clear-selection')+'</div><dl>'+pairs.map(([key,value])=>'<div><dt>'+esc(key)+'</dt><dd>'+esc(value)+'</dd></div>').join('')+
      '</dl>'+(entry.detail?'<p>'+esc(entry.detail)+'</p>':'')+sourceButton(entry)+'</aside>';
  }
  function render(){
    if(!available())return;
    const source=report?.case,all=report?.entries||[],filtered=selectCalendarEntries(all,session);
    const undated=selectCalendarEntries(report?.undated||[],{...session,startDate:'',endDate:''});
    const ownerMap=new Map();
    for(const entry of [...all,...(report?.undated||[])])
      (entry.ownerIds||[]).forEach((id,index)=>ownerMap.set(id,entry.ownerNames?.[index]||id));
    const ownerOptions=[['','All owners'],...Array.from(ownerMap).sort((a,b)=>a[1].localeCompare(b[1]))];
    const activeDeadlines=report?.summary?.activeDeadlines||0;
    const overdue=report?.summary?.overdueDeadlines||0;
    root.innerHTML='<div class="calendar-heading"><div><h2>Delivery calendar</h2><p>Payment-based deadlines, planned delivery and saved assignments from this grant case.</p></div>'+
      '<div class="calendar-actions">'+button('Refresh calendar','refresh')+button('Open tranche completion','completion')+'</div></div>'+
      '<div class="calendar-toolbar"><label>Status as of<input type="date" data-calendar-setting="asOfDate" value="'+esc(session.asOfDate)+'"></label>'+
      '<label>View<select data-calendar-setting="view">'+optionList([['agenda','Agenda'],['month','Month']],session.view)+'</select></label>'+
      '<label>Tranche<select data-calendar-setting="tranche">'+optionList([['','All tranches'],['0','T0'],['1','T1'],['2','T2'],['3','T3']],session.tranche)+'</select></label>'+
      '<label>Event type<select data-calendar-setting="kind">'+optionList(kinds,session.kind)+'</select></label>'+
      '<label>Owner<select data-calendar-setting="owner">'+optionList(ownerOptions,session.owner)+'</select></label>'+
      '<label class="calendar-search">Find event<input type="search" data-calendar-setting="query" value="'+esc(session.query)+'" placeholder="Title, work package or owner"></label></div>'+
      '<div class="calendar-toolbar calendar-secondary"><label>From<input type="date" data-calendar-setting="startDate" value="'+esc(session.startDate)+'"></label>'+
      '<label>Through<input type="date" data-calendar-setting="endDate" value="'+esc(session.endDate)+'"></label>'+
      '<label class="calendar-checkbox"><input type="checkbox" data-calendar-setting="showInactive"'+(session.showInactive?' checked':'')+'>Include inactive records</label>'+
      button('Upcoming dates','upcoming')+button('Clear filters','clear-filters')+'</div>'+
      '<p class="calendar-error" role="alert">'+esc(error)+'</p><p class="calendar-notice" role="status" aria-live="polite">'+esc(notice)+'</p>'+
      (report?'<div class="calendar-summary"><div><span>Dated events</span><strong>'+all.length+'</strong></div>'+
      '<div><span>Open completion deadlines</span><strong>'+activeDeadlines+'</strong></div>'+
      '<div><span>Overdue deadlines</span><strong>'+overdue+'</strong></div>'+
      '<div><span>Entries without dates</span><strong>'+(report.undated||[]).length+'</strong></div></div>'+
      '<p class="calendar-source">'+esc(source?.name||current.program.name)+' · version '+esc(source?.version)+
      ' · calendar date '+esc(report.asOfDate)+'</p>'+
      (session.view==='month'?monthGrid(filtered):agenda(filtered))+
      detail()+
      (undated.length?'<details class="calendar-undated"><summary>'+undated.length+' entr'+(undated.length===1?'y':'ies')+' awaiting dates</summary>'+
        table(['Work or event','Tranche','Status','Accountable owner','Original record'],undated.map(entry=>[
          eventButton(entry),entry.tranche==null?'—':'T'+esc(entry.tranche),status(entry),esc(owners(entry)||'Unassigned'),sourceButton(entry)]))+'</details>':'')+
      '<section class="calendar-export"><h3>Use this calendar</h3><p>Downloads contain the complete selected case calendar; the screen filters only change this view. Keep the original case export to continue editing assignments and payment records.</p>'+
      '<div class="calendar-actions">'+button('Download calendar (.ics)','export-ics')+button('Download all rows (.csv)','export-csv')+
      button('Download source (.json)','export-json')+'</div><p>Import the .ics file into a dedicated calendar. Import behavior and automatic replacement vary by calendar application; this file is a saved snapshot.</p></section>'+
      '<details class="calendar-basis"><summary>Calendar sources and date meaning</summary>'+
      '<ul>'+(report.basis||[]).map(value=>'<li>'+esc(value)+'</li>').join('')+'</ul>'+
      '<p>All-day dates use the recorded civil date. Assigned work is entered in Tranche completion. Payment records are maintained in Cash / issuer.</p></details>':
      '<p class="calendar-empty">'+(error?'Correct the date or refresh the case to continue.':'Opening the saved grant calendar…')+'</p>');
    controls();
  }
  function query(asOfDate,expectedVersion){
    const values=new URLSearchParams({asOfDate});
    if(expectedVersion!==undefined)values.set('expectedVersion',String(expectedVersion));
    return '?'+values;
  }
  async function refresh(){
    if(!civil(session.asOfDate)){error='Choose an actual calendar date.';render();return;}
    const token=++epoch,selectedDate=session.asOfDate;busy=true;error='';notice='';render();
    try{
      const next=await api(prefix+'/delivery-calendar'+query(selectedDate));
      if(!available()||token!==epoch)return;
      if(next.schema!==SCHEMA||next.case?.id!==caseId||next.asOfDate!==selectedDate||
        !Array.isArray(next.entries)||!Array.isArray(next.undated))
        throw new Error('The calendar response does not match this grant case and date.');
      report=next;session.page=0;persist();
    }catch(cause){if(available()&&token===epoch)error=cause.message||String(cause);}
    finally{if(available()&&token===epoch){busy=false;render();}}
  }
  root.addEventListener('input',event=>{
    if(event.target.dataset.calendarSetting!=='query'||busy||hostBusy)return;
    session.query=event.target.value;session.page=0;
    const caret=event.target.selectionStart;persist();render();
    const input=$('[data-calendar-setting="query"]');input?.focus();try{input?.setSelectionRange(caret,caret);}catch{}
  });
  root.addEventListener('change',event=>{
    const key=event.target.dataset.calendarSetting;
    if(!key||key==='query'||busy||hostBusy)return;
    session[key]=key==='showInactive'?event.target.checked:event.target.value;session.page=0;
    if(key==='asOfDate'){persist();refresh();return;}
    if(session.startDate&&session.endDate&&session.startDate>session.endDate)error='Choose a date range ending on or after its start.';
    else error='';
    persist();render();
  });
  root.addEventListener('click',async event=>{
    const target=event.target.closest('[data-calendar-action]');
    if(!target||target.disabled||busy||hostBusy)return;
    const action=target.dataset.calendarAction;
    if(action==='refresh'){await refresh();return;}
    if(action==='completion'){onOpen('completion',null,{asOfDate:report?.asOfDate||session.asOfDate});return;}
    if(action==='select'){session.selectedId=target.dataset.calendarId;persist();render();$('.calendar-detail')?.scrollIntoView({block:'nearest'});return;}
    if(action==='clear-selection'){session.selectedId='';persist();render();return;}
    if(action==='source'){
      const entry=[...(report?.entries||[]),...(report?.undated||[])].find(row=>row.id===target.dataset.calendarId);
      if(entry)onOpen(originTab(entry),entry.tranche,{
        asOfDate:report.asOfDate,
        cashId:entry.kind==='GRANT_RECEIPT'?entry.sourceId:undefined,
        receiptId:entry.kind==='SUBMISSION_DEADLINE'?entry.sourceId:entry.receiptId,
        costId:entry.costId,reviewId:entry.reviewId,
      });return;
    }
    if(action==='page-back'||action==='page-next'){session.page+=action==='page-next'?1:-1;render();return;}
    if(action==='month-back'||action==='month-next'){session.month=calendarMonthShift(session.month,action==='month-next'?1:-1);persist();render();return;}
    if(action==='month-today'){session.month=session.asOfDate.slice(0,7);persist();render();return;}
    if(action==='day'){session.startDate=target.dataset.calendarDay;session.endDate=target.dataset.calendarDay;session.view='agenda';session.page=0;persist();render();return;}
    if(action==='upcoming'){session.startDate=session.asOfDate;session.endDate='';session.page=0;persist();render();return;}
    if(action==='clear-filters'){
      Object.assign(session,{query:'',kind:'',tranche:'',owner:'',showInactive:false,startDate:'',endDate:'',page:0});
      error='';persist();render();return;
    }
    if(action.startsWith('export-')&&report){
      const format=action.slice(7),selected=report,token=epoch;
      if(!['ics','csv','json'].includes(format))return;
      busy=true;error='';notice='';controls();
      try{
        const response=await api(prefix+'/delivery-calendar/export.'+format+
          query(selected.asOfDate,selected.case.version),undefined,{download:true});
        const blob=await response.blob();
        if(available()&&token===epoch){
          saveFile(blob,caseId+'-delivery-calendar-'+selected.asOfDate+'.'+format);
          notice='Downloaded the complete '+format.toUpperCase()+' calendar for case version '+selected.case.version+'.';
        }
      }catch(cause){if(available()&&token===epoch)error=cause.message||String(cause);}
      finally{if(available()&&token===epoch){busy=false;render();}}
    }
  });
  render();const ready=refresh();
  return {ready,setHostBusy(value){hostBusy=!!value;controls();},dispose(){persist();active=false;++epoch;}};
}
