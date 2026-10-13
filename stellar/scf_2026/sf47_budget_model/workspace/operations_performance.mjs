// Budget and period management over the original Grant Operations case.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const title=value=>String(value??'').toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const localDate=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
const usd=value=>{
  if(value===null||value===undefined)return '—';
  const raw=String(value),negative=raw.startsWith('-'),[whole,fraction='00']=(negative?raw.slice(1):raw).split('.');
  return (negative?'−':'')+'$'+whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+fraction.padEnd(2,'0');
};
const amount=value=>value===null||value===undefined?'—':String(value);
const button=(label,action,disabled=false)=>'<button type="button" data-performance-action="'+action+'"'+(disabled?' disabled data-performance-fixed="true"':'')+'>'+esc(label)+'</button>';
function download(blob,filename){
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function cells(headers,rows){
  return '<div class="performance-table"><table><thead><tr>'+headers.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+
    (rows.length?'':'<tr><td colspan="'+headers.length+'">No recorded activity matches this view.</td></tr>')+'</tbody></table></div>';
}
const views=[
  ['packages','Work packages'],['categories','Budget categories'],['contributors','Contributors and suppliers'],
  ['invoices','Invoice positions'],['workRecords','Recorded work'],['cash','Cash observations'],['days','Period activity']
];

export function mountPerformance({container,current,api,session,onOpen}){
  const root=document.createElement('section');root.className='budget-performance';
  root.setAttribute('aria-label','Budget performance');container.replaceChildren(root);
  if(!document.querySelector('link[data-performance-style]')){
    const style=document.createElement('link');style.rel='stylesheet';style.href='/operations_performance.css';
    style.dataset.performanceStyle='true';document.head.append(style);
  }
  const caseId=current.program.id,prefix='/api/operations/'+caseId,storageKey='sf47.performance.'+caseId;
  if(!session.initialized){
    try{
      const stored=JSON.parse(sessionStorage.getItem(storageKey)||'null');
      if(stored?.schema==='sf47.performance-view.v1'&&stored.caseId===caseId)
        for(const key of ['startDate','endDate','view','query','scope'])if(Object.hasOwn(stored,key))session[key]=stored[key];
    }catch{}
    const received=current.program.origin?.performance;
    if(received&&session.startDate===undefined){session.startDate=received.startDate||'';session.endDate=received.endDate;}
    session.initialized=true;
  }
  const today=localDate();
  for(const [key,value] of Object.entries({startDate:today.slice(0,8)+'01',endDate:today,view:'packages',query:'',scope:'period',page:0}))
    if(!Object.hasOwn(session,key))session[key]=value;
  if(typeof session.startDate!=='string')session.startDate='';
  if(typeof session.endDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(session.endDate))session.endDate=today;
  if(!views.some(([id])=>id===session.view))session.view='packages';
  if(typeof session.query!=='string')session.query='';
  if(!['period','closing'].includes(session.scope))session.scope='period';
  if(!Number.isSafeInteger(session.page)||session.page<0)session.page=0;
  let active=true,busy=false,hostBusy=false,epoch=0,report=null,error='',notice='';
  const available=()=>active&&root.isConnected,$=q=>root.querySelector(q);
  function persist(){
    const saved={schema:'sf47.performance-view.v1',caseId};
    for(const key of ['startDate','endDate','view','query','scope'])saved[key]=session[key];
    try{sessionStorage.setItem(storageKey,JSON.stringify(saved));}catch{}
  }
  function controls(){
    if(!available())return;
    root.setAttribute('aria-busy',String(busy||hostBusy));
    for(const el of root.querySelectorAll('button,input,select'))el.disabled=busy||hostBusy||el.dataset.performanceFixed==='true';
  }
  function query(selected,version,reportHash){
    const values=new URLSearchParams();
    if(selected.startDate)values.set('startDate',selected.startDate);
    values.set('endDate',selected.endDate);
    if(version!==undefined)values.set('expectedVersion',String(version));
    if(reportHash)values.set('expectedReportSha256',reportHash);
    return '?'+values.toString();
  }
  function matched(){
    if(!report)return [];
    let rows=report[session.view]||[];
    if(session.scope==='period'&&['cash','workRecords'].includes(session.view))rows=rows.filter(row=>row.inPeriod);
    const find=session.query.trim().toLowerCase();
    return find?rows.filter(row=>JSON.stringify(row).toLowerCase().includes(find)):rows;
  }
  function source(row){
    return '<details><summary>'+esc(row.number||row.description||row.externalRef||row.id)+'</summary>'+
      '<p><code>'+esc(row.id)+'</code></p>'+
      (row.sourceIds?.length?'<p>Original sources: '+row.sourceIds.map(id=>'<code>'+esc(id)+'</code>').join(', ')+'</p>':'')+
      (row.lines?'<pre>'+esc(JSON.stringify(row.lines,null,2))+'</pre>':'')+
      '</details>';
  }
  function rowTable(rows){
    if(session.view==='packages'||session.view==='categories'){
      const category=session.view==='categories';
      return cells([category?'Category':'Package','Budget USD','Opening invoices','Period invoices','Closing invoices','Remaining budget','Period paid','Closing paid','Period accepted h','Closing accepted h'],
        rows.map(row=>[esc(category?row.category:row.id||'Unassigned'),
          usd(row.plannedUsd),usd(row.openingInvoicedUsd),usd(row.periodInvoicedUsd),usd(row.closingInvoicedUsd),
          usd(row.remainingBudgetUsd),usd(row.periodPaidUsd),usd(row.closingPaidUsd),
          esc(amount(row.periodAcceptedHours)),esc(amount(row.closingAcceptedHours))]));
    }
    if(session.view==='contributors')return cells(['Contributor / supplier','Period hours','Period accepted h','Period invoices','Period paid','Closing invoices','Closing paid','Open','Credit'],
      rows.map(row=>[esc(row.name),esc(row.periodRecordedHours),esc(row.periodAcceptedHours),usd(row.periodInvoicedUsd),
        usd(row.periodPaidUsd),usd(row.closingInvoicedUsd),usd(row.closingPaidUsd),usd(row.openUsd),usd(row.creditUsd)]));
    if(session.view==='invoices')return cells(['Original invoice','Contributor','State','Issued','Due','Period invoices','Closing liability','Closing paid','Open','Credit','Age'],
      rows.map(row=>[source(row),esc(row.contributor),esc(title(row.state)),esc(row.issuedDate),esc(row.dueDate||'Undated'),
        usd(row.periodInvoicedUsd),usd(row.closingLiabilityUsd),usd(row.closingPaidUsd),usd(row.openUsd),usd(row.creditUsd),esc(title(row.aging))]));
    if(session.view==='workRecords')return cells(['Original work','Contributor','Package','State','Start','Recognized at end','Recorded hours','Funding'],
      rows.map(row=>[source(row),esc(row.contributor),esc(row.costId||'Unassigned'),esc(title(row.state)),esc(row.startDate),
        esc(row.endDate)+(row.spansPeriodStart?'<small>Spans report start</small>':''),esc(row.hours),esc(title(row.fundingBasis))]));
    if(session.view==='cash')return cells(['Original payment','Date','Direction / category','Asset / network','Quantity','Recorded USD','USD basis'],
      rows.map(row=>[source(row),esc(row.date),esc(row.direction+' · '+title(row.category)),
        esc([row.currency,row.asset,row.network].filter(Boolean).join(' · ')),esc(row.amount),usd(row.usdValue),esc(title(row.usdBasis))]));
    return cells(['Date','Cash in','Cash out','Net change','Net recorded cash','Issued invoices','Net invoice paid','Recorded hours','Accepted hours'],
      rows.map(row=>[esc(row.date),usd(row.inUsd),usd(row.outUsd),usd(row.netUsd),usd(row.recordedNetCashUsd),
        usd(row.invoicedUsd),usd(row.invoicePaidUsd),esc(row.recordedHours),esc(row.acceptedHours)]));
  }
  function render(){
    if(!available())return;
    const rows=matched(),pages=Math.max(1,Math.ceil(rows.length/50));
    session.page=Math.min(Math.max(0,session.page),pages-1);
    const f=report?.finances,selected=report?.selection;
    const currentSelection=report&&(selected.startDate||'')===session.startDate&&selected.endDate===session.endDate;
    root.innerHTML='<header><div><h3>Budget performance</h3><p>Review the recorded period, remaining package budgets and invoice positions.</p></div>'+
      '<div class="performance-actions">'+button('Refresh report','refresh')+
      button('Export complete handover','export',!report||!currentSelection||!!error)+button('Download report JSON','json',!report)+'</div></header>'+
      '<p class="performance-message" role="'+(error?'alert':'status')+'" aria-live="polite">'+esc(error||notice)+'</p>'+
      '<div class="performance-controls"><label>Period start<input type="date" data-performance-date="startDate" value="'+esc(session.startDate)+'"></label>'+
      '<label>Period end<input type="date" data-performance-date="endDate" value="'+esc(session.endDate)+'" required></label>'+
      button('Current month','month')+button('All dates through end','all-dates')+'</div>'+
      (report?'<p class="performance-basis"><strong>'+esc(selected.startDate||'All recorded dates')+' through '+esc(selected.endDate)+
        '</strong> · case version '+report.case.version+' · pinned plan revision '+report.plan.revision+'. '+esc(report.case.mode)+
        (report.case.version!==current.program.version?' · current saved case advanced since this section opened.':'')+'</p>'+
        '<div class="performance-stats">'+[
          ['Period invoices',usd(f.period.invoicedUsd)],['Net period invoice payments',usd(f.period.paidUsd)],
          ['Closing open invoices',usd(f.closing.openUsd)],['Closing supplier credits',usd(f.closing.creditUsd)],
          ['Period accepted hours',report.work.period.acceptedHours],['Closing net recorded cash',usd(f.closing.netUsd)]
        ].map(([label,value])=>'<div><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>').join('')+'</div>'+
        '<details open><summary>Opening, period movement and closing</summary>'+
        cells(['Measure','Opening','Period change','Closing'],[
          ['Cash in',usd(f.opening.inUsd),usd(f.period.inUsd),usd(f.closing.inUsd)],
          ['Cash out',usd(f.opening.outUsd),usd(f.period.outUsd),usd(f.closing.outUsd)],
          ['Net recorded cash',usd(f.opening.netUsd),usd(f.period.netUsd),usd(f.closing.netUsd)],
          ['Invoice liability',usd(f.opening.invoicedUsd),usd(f.period.invoicedUsd),usd(f.closing.invoicedUsd)],
          ['Net invoice payments',usd(f.opening.paidUsd),usd(f.period.paidUsd),usd(f.closing.paidUsd)],
          ['Open invoice liability',usd(f.opening.openUsd),usd(f.period.openUsd),usd(f.closing.openUsd)],
          ['Supplier credits / prepayments',usd(f.opening.creditUsd),usd(f.period.creditUsd),usd(f.closing.creditUsd)]
        ])+'</details>'+
        '<div class="performance-controls"><label>Breakdown<select data-performance-filter="view">'+views.map(([id,label])=>'<option value="'+id+'"'+
          (session.view===id?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label>'+
        '<label class="performance-search">Find record, contributor or package<input type="search" data-performance-filter="query" value="'+esc(session.query)+'"></label>'+
        (['cash','workRecords'].includes(session.view)?'<label>Record dates<select data-performance-filter="scope"><option value="period"'+(session.scope==='period'?' selected':'')+
          '>Within period</option><option value="closing"'+(session.scope==='closing'?' selected':'')+'>All through closing</option></select></label>':'')+'</div>'+
        rowTable(rows.slice(session.page*50,(session.page+1)*50))+
        '<div class="performance-pagination"><span>'+rows.length+' matching rows · page '+(session.page+1)+' of '+pages+'</span>'+
        button('Previous','previous',session.page===0)+button('Next','next',session.page>=pages-1)+'</div>'+
        '<details><summary>Invoice aging and items to review</summary>'+
        cells(['Age at period end','Invoice count','Open USD'],report.aging.map(row=>[esc(title(row.bucket)),String(row.count),usd(row.amountUsd)]))+
        '<ul>'+[
          ['Disputed invoices',report.attention.disputedInvoiceIds.length],
          ['Payments before invoice issue',report.attention.paidBeforeInvoiceIds.length],
          ['Cash observations requiring USD valuation',report.attention.unvaluedCashIds.length],
          ['Unassigned work records',report.attention.unassignedWorkIds.length],
          ['Unassigned invoice lines',report.attention.unassignedInvoiceLines.length],
          ['Work records spanning period start',report.attention.workSpanningStartIds.length]
        ].map(([label,count])=>'<li>'+esc(label)+': '+count+'</li>').join('')+'</ul>'+
        '<div class="performance-actions">'+button('Open invoices','invoices')+button('Open work','work')+button('Open cash','cash')+'</div></details>'+
        '<details><summary>Pinned planning amounts and original asset quantities</summary>'+
        (report.planned.calendarStart?'<p>Operating calendar starts '+esc(report.planned.calendarStart)+'.</p>'+
          cells(['Planner measure','Opening','Period change','Closing'],[
            ['Accrued budget',usd(report.planned.opening.accruedUsd),usd(report.planned.period.accruedUsd),usd(report.planned.closing.accruedUsd)],
            ['Planned cash outflow',usd(report.planned.opening.plannedOutflowUsd),usd(report.planned.period.plannedOutflowUsd),usd(report.planned.closing.plannedOutflowUsd)],
            ['Conditional planned funding',usd(report.planned.opening.conditionalInflowUsd),usd(report.planned.period.conditionalInflowUsd),usd(report.planned.closing.conditionalInflowUsd)]
          ]):'<p>Add the operating case calendar when creating a dated plan comparison. Package budgets remain available.</p>')+
        cells(['Currency / network / asset','Opening quantity','Period in','Period out','Closing quantity'],
          report.assets.map(row=>[esc([row.currency,row.network,row.asset].filter(Boolean).join(' · ')),esc(row.openingNet),
            esc(row.periodIn),esc(row.periodOut),esc(row.closingNet)]))+'</details>'+
        '<details><summary>Report basis and retained sources</summary><ul>'+report.basis.map(value=>'<li>'+esc(value)+'</li>').join('')+'</ul>'+
        '<p>Report: <code>'+esc(report.reportSha256)+'</code></p><p>Selected source: '+report.sources.length+' retained documents.</p>'+
        '<p>The full export contains this report, every CSV row and the complete original operating case. Import that handover to reopen the case and these dates.</p></details>':
        '<p class="performance-empty">'+(error?'Refresh the report after correcting its dates.':'Reading the current budget and recorded activity…')+'</p>');
    controls();
  }
  async function refresh(){
    const token=++epoch;
    if(!session.endDate||(session.startDate&&session.startDate>session.endDate)){
      error='Choose a period start on or before its end.';busy=false;render();return;
    }
    busy=true;error='';notice='';render();
    const selected={startDate:session.startDate||null,endDate:session.endDate};
    try{
      const next=await api(prefix+'/performance'+query(selected));
      if(!available()||token!==epoch)return;
      if(next.schema!=='stellar-forge.sf47-performance.v1'||next.case?.id!==caseId||
          next.selection?.startDate!==selected.startDate||next.selection?.endDate!==selected.endDate)
        throw new Error('The report response does not match this case and reporting period.');
      report=next;session.page=0;persist();
    }catch(problem){if(available()&&token===epoch)error=problem.message||String(problem);}
    finally{if(available()&&token===epoch){busy=false;render();}}
  }
  root.addEventListener('input',event=>{
    if(event.target.dataset.performanceFilter!=='query')return;
    session.query=event.target.value;session.page=0;
    const start=event.target.selectionStart;persist();render();
    const input=$('[data-performance-filter="query"]');input?.focus();try{input?.setSelectionRange(start,start);}catch{}
  });
  root.addEventListener('change',event=>{
    const dateKey=event.target.dataset.performanceDate;
    if(dateKey){session[dateKey]=event.target.value;persist();refresh();return;}
    const key=event.target.dataset.performanceFilter;
    if(key){session[key]=event.target.value;session.page=0;persist();render();}
  });
  root.addEventListener('click',async event=>{
    const target=event.target.closest('[data-performance-action]');
    if(!target||target.disabled||busy||hostBusy)return;
    const action=target.dataset.performanceAction;
    if(action==='refresh'){await refresh();return;}
    if(action==='month'){const d=localDate();session.startDate=d.slice(0,8)+'01';session.endDate=d;persist();await refresh();return;}
    if(action==='all-dates'){session.startDate='';persist();await refresh();return;}
    if(action==='previous'||action==='next'){session.page+=action==='next'?1:-1;render();return;}
    if(['invoices','work','cash'].includes(action)){onOpen(action);return;}
    if(action==='json'&&report){
      download(new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'}),caseId+'-performance.json');return;
    }
    if(action==='export'&&report){
      busy=true;error='';controls();const selected=report,token=epoch;
      try{
        const response=await api(prefix+'/performance/export.zip'+query(selected.selection,selected.case.version,selected.reportSha256),undefined,{download:true});
        const blob=await response.blob();
        if(available()&&token===epoch){download(blob,caseId+'-performance-'+selected.selection.endDate+'.zip');notice='Downloaded the full report, CSV tables and original operating case.';}
      }catch(problem){if(available()&&token===epoch)error=problem.message||String(problem);}
      finally{if(available()&&token===epoch){busy=false;render();}}
    }
  });
  render();
  const ready=refresh();
  return {ready,setHostBusy(value){hostBusy=!!value;controls();},dispose(){persist();active=false;++epoch;}};
}
