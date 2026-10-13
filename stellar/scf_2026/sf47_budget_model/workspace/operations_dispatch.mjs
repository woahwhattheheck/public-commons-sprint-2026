// Delivery coordination over the original Grant Operations Installation editions.
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const title=value=>String(value??'').toLowerCase().replaceAll('_',' ').replace(/^./,char=>char.toUpperCase());
const displayDate=value=>{if(!value)return 'Undated';const d=new Date(value+'T00:00:00Z');return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(d);};
const displayTime=value=>{if(!value)return '';const d=new Date(value);return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short'}).format(d);};
const localDate=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
const nextWeek=value=>{const d=new Date(value+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+7);return d.toISOString().slice(0,10);};
const button=(label,action,attrs='',disabled=false)=>'<button type="button" data-dispatch-action="'+action+'" '+attrs+(disabled?' disabled data-dispatch-fixed="true"':'')+'>'+esc(label)+'</button>';
function download(blob,name){
  const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}

export function mountDispatch({container,current,api,session,onOpen}){
  const root=document.createElement('section');root.className='delivery-queue';
  root.setAttribute('aria-label','Installation delivery queue');container.replaceChildren(root);
  if(!document.querySelector('link[data-dispatch-style]')){
    const style=document.createElement('link');style.rel='stylesheet';style.href='/operations_dispatch.css';
    style.dataset.dispatchStyle='true';document.head.append(style);
  }
  const caseId=current.program.id,prefix='/api/operations/'+caseId,storageKey='sf47.delivery-queue.'+caseId;
  if(!session.initialized){
    try{const stored=JSON.parse(sessionStorage.getItem(storageKey)||'null');
      if(stored?.schema==='sf47.delivery-queue-view.v1'&&stored.caseId===caseId)
        for(const key of ['asOfDate','query','owner','due','priority','kind','view'])if(Object.hasOwn(stored,key))session[key]=stored[key];
    }catch{}
    session.initialized=true;
  }
  for(const [key,value] of Object.entries({asOfDate:localDate(),query:'',owner:'',due:'',priority:'',kind:'',view:'open',page:0}))
    if(!Object.hasOwn(session,key))session[key]=value;
  for(const key of ['query','owner','due','priority','kind','view'])if(typeof session[key]!=='string')session[key]='';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(session.asOfDate)||Number.isNaN(Date.parse(session.asOfDate+'T00:00:00Z')))session.asOfDate=localDate();
  if(!['open','ready','waiting','completed','changed','all'].includes(session.view))session.view='open';
  if(!Number.isSafeInteger(session.page)||session.page<0)session.page=0;
  let active=true,busy=false,hostBusy=false,queue=null,error='',notice='',epoch=0;
  const available=()=>active&&root.isConnected,$=query=>root.querySelector(query);
  function persist(){
    const value={schema:'sf47.delivery-queue-view.v1',caseId};
    for(const key of ['asOfDate','query','owner','due','priority','kind','view'])value[key]=session[key];
    try{sessionStorage.setItem(storageKey,JSON.stringify(value));}catch{}
  }
  function controls(){
    if(!available())return;
    root.setAttribute('aria-busy',String(busy||hostBusy));
    for(const control of root.querySelectorAll('button,input,select'))
      control.disabled=control.dataset.dispatchFixed==='true'||busy||hostBusy;
  }
  function select(label,key,options){
    return '<label><span>'+esc(label)+'</span><select data-dispatch-filter="'+key+'">'+options.map(([value,name])=>
      '<option value="'+esc(value)+'"'+(session[key]===value?' selected':'')+'>'+esc(name)+'</option>').join('')+'</select></label>';
  }
  function visibleRows(){
    if(!queue)return [];
    const q=session.query.trim().toLowerCase(),week=nextWeek(queue.asOfDate);
    return queue.rows.filter(row=>{
      if(session.view==='open'&&(row.done||row.retired||row.caseClosed))return false;
      if(session.view==='ready'&&!row.ready)return false;
      if(session.view==='waiting'&&(!row.waitingOn.length||row.done||row.retired||row.caseClosed))return false;
      if(session.view==='completed'&&!row.done)return false;
      if(session.view==='changed'&&!row.sourceRecordsChanged)return false;
      if(session.owner==='__unassigned'&&row.owner)return false;
      if(session.owner&&session.owner!=='__unassigned'&&row.owner!==session.owner)return false;
      if(session.priority&&row.priority!==session.priority)return false;
      if(session.kind&&row.kind!==session.kind)return false;
      if(session.due==='overdue'&&row.dueStatus!=='OVERDUE')return false;
      if(session.due==='today'&&row.dueStatus!=='TODAY')return false;
      if(session.due==='week'&&(!row.dueDate||row.dueDate<queue.asOfDate||row.dueDate>week||row.done||row.retired||row.caseClosed))return false;
      if(session.due==='undated'&&row.dueDate)return false;
      return !q||[row.installationName,row.title,row.criterion,row.owner,row.note,row.installationId].join(' ').toLowerCase().includes(q);
    });
  }
  function render(){
    if(!available())return;
    const rows=visibleRows(),pages=Math.max(1,Math.ceil(rows.length/50));
    session.page=Math.max(0,Math.min(session.page,pages-1));
    const owners=queue?[...new Set(queue.rows.map(row=>row.owner).filter(Boolean))].sort((a,b)=>a.localeCompare(b)):[];
    root.innerHTML='<header><div><h3>Installation delivery queue</h3><p>Assign and sequence the remaining work across saved customer installations.</p></div><div class="dispatch-actions">'+
      button('Refresh queue','refresh')+button('Export complete handover','export','',!queue)+
      button('Download queue JSON','json','',!queue)+'</div></header>'+
      '<p class="dispatch-message" role="'+(error?'alert':'status')+'" aria-live="polite">'+esc(error||notice)+'</p>'+
      (error&&queue?'<p class="dispatch-basis">Showing the last retrieved queue for '+esc(displayDate(queue.asOfDate))+'. Refresh to retrieve the latest saved work.</p>':'')+
      '<div class="dispatch-filters"><label><span>Review calendar date</span><input type="date" data-dispatch-date value="'+esc(session.asOfDate)+'"></label>'+
      '<label class="dispatch-search"><span>Find installation or work</span><input type="search" data-dispatch-filter="query" value="'+esc(session.query)+'" placeholder="Name, task, owner or note"></label>'+
      select('Show','view',[['open','Open work'],['ready','Ready for work'],['waiting','Waiting for prerequisites'],['completed','Completed work'],['changed','Changed source records'],['all','Every saved task']])+
      select('Delivery assignee','owner',[['','All assignees'],['__unassigned','Unassigned'],...owners.map(value=>[value,value])])+
      select('Due date','due',[['','Every date'],['overdue','Overdue'],['today','Due today'],['week','Due within seven days'],['undated','No due date']])+
      select('Priority','priority',[['','Every priority'],...['URGENT','HIGH','NORMAL','LOW'].map(value=>[value,title(value)])])+
      select('Work type','kind',[['','Setup and acceptance'],['CONFIGURATION','Installation setup'],['ACCEPTANCE','Acceptance steps']])+'</div>'+
      (queue?'<div class="dispatch-stats">'+[['Open',queue.summary.open],['Overdue',queue.summary.overdue],['Due today',queue.summary.dueToday],
        ['Unassigned',queue.summary.unassigned],['Waiting',queue.summary.waiting],['Ready',queue.summary.ready]].map(([label,value])=>'<div><span>'+label+'</span><strong>'+value+'</strong></div>').join('')+'</div>'+
        '<p class="dispatch-basis">Case version '+queue.source.caseVersion+' · '+queue.summary.installations+' saved installations · reviewed '+esc(displayDate(queue.asOfDate))+
        '. Delivery assignments are saved with each installation edition.</p>'+
        (queue.installations.length?'<div class="dispatch-table"><table><thead><tr><th scope="col">Installation / work</th><th scope="col">Delivery assignee</th><th scope="col">Due date / priority</th><th scope="col">Current state</th><th scope="col">Action</th></tr></thead><tbody>'+
        rows.slice(session.page*50,(session.page+1)*50).map(row=>'<tr><td><strong>'+esc(row.installationName)+'</strong><span>'+esc(row.title)+'</span><small>Edition '+row.revision+' · '+esc(title(row.kind))+'</small>'+
          '<details><summary>Task and source detail</summary><p>'+esc(row.criterion||'Installation setup is complete.')+'</p>'+
          (row.note?'<p><strong>Coordination:</strong> '+esc(row.note)+'</p>':'')+
          (row.acceptanceOperator?'<p><strong>Observed by:</strong> '+esc(row.acceptanceOperator)+(row.acceptedAt?' · '+esc(displayTime(row.acceptedAt)):'')+'</p>':'')+
          '<p>Edition <code>'+esc(row.editionSha256)+'</code></p></details></td><td>'+esc(row.owner||'Unassigned')+'</td><td>'+esc(displayDate(row.dueDate))+
          '<small>'+esc(title(row.priority))+' · '+esc(title(row.dueStatus))+'</small></td><td>'+esc(title(row.state))+
          (row.waitingOn.length?'<small>Waiting for '+row.waitingOn.map(value=>esc(value.title)).join(', ')+'</small>':'')+
          (row.sourceRecordsChanged?'<small>Selected operating records changed since this edition.</small>':'')+
          (row.retired?'<small>Installation retired</small>':'')+(row.caseClosed?'<small>Operating case closed</small>':'')+
          '</td><td>'+button('Assign / review','edit','data-id="'+esc(row.installationId)+'" data-revision="'+row.revision+'" data-task="'+esc(row.taskId)+'"',queue.source.caseState!=='OPEN')+
          button('Open edition','open','data-id="'+esc(row.installationId)+'" data-revision="'+row.revision+'"')+'</td></tr>').join('')+
        (rows.length?'':'<tr><td colspan="5">No work matches these filters.</td></tr>')+'</tbody></table></div>'+
        '<div class="dispatch-pagination"><span>'+rows.length+' matching tasks · page '+(session.page+1)+' of '+pages+'</span>'+
          button('Previous','previous','',session.page===0)+button('Next','next','',session.page>=pages-1)+'</div>':
        '<div class="dispatch-empty"><h4>Save the first customer installation</h4><p>Open Customer installations, prepare its complete task and receiving assignment, and save an edition. Its setup decisions and acceptance work appear here.</p>'+
          button('Open customer installations','installations')+'</div>') :
        '<p class="dispatch-empty">'+(error?'The delivery queue could not be loaded. Use Refresh queue to try again.':'Reading current saved installation work…')+'</p>');
    controls();
  }
  async function refresh(){
    const token=++epoch;busy=true;error='';notice='';render();
    const selected=session.asOfDate;
    try{
      const next=await api(prefix+'/delivery-queue?asOfDate='+encodeURIComponent(selected));
      if(!available()||token!==epoch)return;
      if(next.schema!=='stellar-forge.sf47-delivery-queue.v1'||next.source?.caseId!==caseId||next.asOfDate!==selected||!Array.isArray(next.rows)||!Array.isArray(next.installations))
        throw new Error('Reopen the original delivery queue for this case and calendar date.');
      queue=next;session.page=0;persist();
    }catch(problem){if(available()&&token===epoch)error=problem.message||String(problem);}
    finally{if(available()&&token===epoch){busy=false;render();}}
  }
  root.addEventListener('input',event=>{
    if(event.target.dataset.dispatchFilter!=='query')return;
    session.query=event.target.value;session.page=0;const start=event.target.selectionStart;persist();render();
    const input=$('[data-dispatch-filter="query"]');input?.focus();try{input?.setSelectionRange(start,start);}catch{}
  });
  root.addEventListener('change',event=>{
    if(event.target.matches('[data-dispatch-date]')){
      if(!event.target.value||!event.target.validity.valid){event.target.value=session.asOfDate;return;}
      session.asOfDate=event.target.value;persist();refresh();return;
    }
    const key=event.target.dataset.dispatchFilter;
    if(key){session[key]=event.target.value;session.page=0;persist();render();}
  });
  root.addEventListener('click',async event=>{
    const target=event.target.closest('[data-dispatch-action]');if(!target||target.disabled||busy||hostBusy)return;
    const action=target.dataset.dispatchAction;
    if(action==='refresh'){await refresh();return;}
    if(action==='previous'||action==='next'){session.page+=action==='next'?1:-1;render();return;}
    if(action==='installations'){onOpen(null,null,false);return;}
    if(action==='open'||action==='edit'){onOpen(target.dataset.id,Number(target.dataset.revision),action==='edit',target.dataset.task);return;}
    if(action==='json'&&queue){download(new Blob([JSON.stringify(queue,null,2)+'\n'],{type:'application/json'}),caseId+'-delivery-queue.json');return;}
    if(action==='export'&&queue){
      busy=true;error='';controls();const selected=queue,token=epoch;
      try{
        const response=await api(prefix+'/delivery-queue/export.zip?asOfDate='+encodeURIComponent(selected.asOfDate),undefined,{download:true});
        const blob=await response.blob();
        if(available()&&token===epoch){download(blob,caseId+'-delivery-queue.zip');notice='Downloaded the complete current case and its dated delivery queue.';}
      }catch(problem){if(available())error=problem.message||String(problem);}
      finally{if(available()){busy=false;render();}}
    }
  });
  render();
  const ready=refresh();
  return {ready,setHostBusy(value){hostBusy=!!value;controls();},dispose(){persist();active=false;++epoch;}};
}
