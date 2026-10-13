import {currentStaffContext,staffDeskStorageKey,assertStaffRequestActor} from './staff-session.mjs';
import {mountEarlierStaffDesk} from './staff-desk-recovery.mjs';
// Original supplier work, invoice review, observed cash and dated account handover.
const DESK_SCHEMA='stellar-forge.sf47-supplier-desk.v1';
const REPORT_SCHEMA='stellar-forge.sf47-supplier-account.v1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>JSON.parse(JSON.stringify(value)),pretty=value=>JSON.stringify(value,null,2);
const label=value=>String(value??'').toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const today=()=>new Date().toISOString().slice(0,10);
const money=value=>value===null||value===undefined?'Unvalued':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value));
const date=value=>{if(!value)return '—';const parsed=new Date(/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T00:00:00Z':value);return Number.isNaN(parsed.getTime())?String(value):new Intl.DateTimeFormat(undefined,{dateStyle:'medium',...(/^\d{4}-\d{2}-\d{2}$/.test(value)?{timeZone:'UTC'}:{timeStyle:'short'})}).format(parsed);};
const b64=buffer=>{let value='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);};
const choices=values=>values.map(value=>[value,label(value)]);
const button=(text,action,{id='',disabled=false,always=false}={})=>'<button type="button" data-pa-action="'+action+'"'+
  (id?' data-id="'+esc(id)+'"':'')+(disabled?' disabled data-pa-fixed="true"':'')+(always?' data-pa-always="true"':'')+'>'+esc(text)+'</button>';
const table=(headers,rows)=>'<div class="supplier-table"><table><thead><tr>'+headers.map(value=>'<th scope="col">'+esc(value)+'</th>').join('')+
  '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+value+'</td>').join('')+'</tr>').join('')+
  (!rows.length?'<tr><td colspan="'+headers.length+'">No records in this view.</td></tr>':'')+'</tbody></table></div>';
function download(value,name,type='application/json'){
  const blob=value instanceof Blob?value:new Blob([typeof value==='string'?value:pretty(value)+'\n'],{type});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function field(text,key,value='',{options,multiple=false,area=false,type='text',required=false,wide=false,help=''}={}){
  const attrs=' data-pa-field="'+esc(key)+'"'+(required?' required':'');
  const control=options?'<select'+attrs+(multiple?' multiple size="4"':'')+'>'+options.map(([id,name])=>'<option value="'+esc(id)+'"'+
    ((multiple?(value||[]).includes(id):String(value??'')===String(id))?' selected':'')+'>'+esc(name)+'</option>').join('')+'</select>':
    area?'<textarea'+attrs+' rows="3">'+esc(value)+'</textarea>':'<input'+attrs+' type="'+type+'" value="'+esc(value)+'">';
  return '<label'+(wide?' class="supplier-wide"':'')+'>'+esc(text)+control+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
}
const payablesStores=new Map();
function payablesStore(name){
  if(payablesStores.has(name))return payablesStores.get(name);
let database;
function db(){
  if(!database)database=new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB){reject(new Error('Browser draft storage is unavailable.'));return;}
    const request=indexedDB.open(name,1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('desks'))request.result.createObjectStore('desks');};
    request.onerror=()=>{database=null;reject(request.error||new Error('Browser draft storage could not open.'));};
    request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();database=null;};resolve(request.result);};
  });
  return database;
}
async function stored(key,value,expectedRevision){
  const database=await db();
  return new Promise((resolve,reject)=>{
    const tx=database.transaction('desks',value===undefined?'readonly':'readwrite'),store=tx.objectStore('desks'),request=store.get(key);
    let result,conflict;
    request.onsuccess=()=>{
      const previous=request.result;
      if(value===undefined){result=previous;return;}
      const revision=Number.isSafeInteger(previous?._storedRevision)?previous._storedRevision:0;
      if(revision!==expectedRevision){conflict=Object.assign(new Error('Another tab saved a newer supplier desk.'),{code:'SUPPLIER_DRAFT_CONFLICT'});tx.abort();return;}
      store.put({...value,_storedRevision:revision+1},key);result=revision+1;
    };
    tx.oncomplete=()=>resolve(result);
    tx.onerror=tx.onabort=()=>reject(conflict||tx.error||request.error||new Error('Browser draft could not be saved.'));
  });
}
  const access={stored};payablesStores.set(name,access);return access;
}

export function mountPayables({container,current,api,saveApi=api,session,mutationId,recordingActor,onCase,onOpen,staffContext=currentStaffContext()}){
  const pinnedContext=staffContext?{...staffContext}:null;
  const {stored}=payablesStore(staffDeskStorageKey('sf47-supplier-accounts',pinnedContext));
  const root=document.createElement('section');root.className='supplier-accounts';root.setAttribute('aria-label','Supplier accounts');container.replaceChildren(root);
  if(!document.querySelector('link[data-supplier-accounts-style]')){
    const style=document.createElement('link');style.rel='stylesheet';style.href='/operations_payables.css';style.dataset.supplierAccountsStyle='true';document.head.append(style);
  }
  const caseId=current.program.id,prefix='/api/operations/'+caseId;
  let active=true,busy=false,hostBusy=false,report=null,error='',notice='',saveTimer,storageNote='';
  session.storageWrites||=Promise.resolve();session.panel||='summary';session.page||=0;
  const available=()=>active&&root.isConnected,$=selector=>root.querySelector(selector);
  const accountName=id=>current.records.contributors.find(row=>row.id===id)?.name||'Original supplier';
  const sourceName=id=>current.sources.find(row=>row.id===id)?.filename||id;
  const costName=id=>current.plan.scenario.future_costs.find(row=>row.id===id)?.remaining_work||id||'Unassigned';
  const editable=()=>current.program.state==='OPEN';
  const original=(kind,id)=>current.records[kind]?.find(row=>row.id===id);
  function state(){
    return {schema:DESK_SCHEMA,caseId,contributorId:session.contributorId||null,startDate:session.startDate||'',endDate:session.endDate||today(),
      panel:session.panel||'summary',selectedId:session.selectedId||null,draft:session.draft?clone(session.draft):null,
      pending:session.pending?clone(session.pending):null,previousRequest:session.previousRequest?clone(session.previousRequest):null,
      result:session.result?clone(session.result):null};
  }
  async function persist(){
    const value=state(),write=session.storageWrites.catch(()=>{}).then(async()=>{
      const revision=await stored(caseId,value,session.storageRevision??0);
      session.storageRevision=revision;session.storageConflict=false;
    });
    session.storageWrites=write;
    try{await write;storageNote='';if(available())status();return true;}
    catch(problem){session.storageConflict=problem.code==='SUPPLIER_DRAFT_CONFLICT'||session.storageConflict;
      storageNote=session.storageConflict?'Another tab saved a newer supplier desk. This tab keeps its full input and original pending request. Download this desk or open the saved version.':
        'Browser storage could not save this desk. Download the complete desk to keep your input and original pending request.';
      if(available())status();return false;}
  }
  function restore(value){
    for(const key of ['contributorId','startDate','endDate','panel','selectedId','draft','pending','previousRequest','result'])session[key]=clone(value[key]??null);
    session.startDate||='';session.endDate||=today();session.panel||='summary';session.page=0;session.reviewed=null;
    session.storageRevision=Number.isSafeInteger(value._storedRevision)?value._storedRevision:0;session.storageConflict=false;
  }
  function schedule(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{persist();},180);}
  function controls(){
    if(!available())return;
    root.setAttribute('aria-busy',String(busy||hostBusy));
    for(const node of root.querySelectorAll('button,input,select,textarea')){
      const always=node.dataset.paAlways==='true',pending=!!session.pending;
      node.disabled=node.dataset.paFixed==='true'||(!always&&(busy||hostBusy||pending));
    }
    for(const node of root.querySelectorAll('[data-pa-action="retry"],[data-pa-action="reopen-rejected"]'))node.disabled=busy||hostBusy;
  }
  function status(){
    const node=$('[data-pa-status]');if(node){node.textContent=error||storageNote||notice;node.setAttribute('role',error||session.storageConflict?'alert':'status');}
    const conflict=$('[data-pa-conflict]');if(conflict)conflict.hidden=!session.storageConflict;
  }
  function sources(row){
    return (row.sourceIds||[]).map(id=>button(sourceName(id),'source',{id})).join(' ')+
      (row.sourceNote?'<p>'+esc(row.sourceNote)+'</p>':'')+(!(row.sourceIds||[]).length?'<span>Operator entry</span>':'');
  }
  function sourceFields(data){
    return '<fieldset class="supplier-wide"><legend>Original sources</legend><div class="supplier-fields">'+
      field('Retained documents','sourceIds',data.sourceIds||[],{options:current.sources.map(row=>[row.id,row.filename]),multiple:true,wide:true})+
      field('Original source reference','sourceNote',data.sourceNote||'',{area:true,wide:true})+
      '</div><div class="supplier-actions">'+button('Attach original document','attach-source')+
      (session.previousRequest?.body?.action==='source.add'&&!session.previousRequest.recovered&&session.previousRequest.after?.draftId===session.draft?.draftId?button('Record retained source document','retained-source'):'')+'</div></fieldset>';
  }
  function costs(){return [['','Unassigned'],...current.plan.scenario.future_costs.map(row=>[row.id,row.remaining_work||row.id])];}
  function workOptions(contributorId){return current.records.work.filter(row=>row.contributorId===contributorId).map(row=>[row.id,row.description+' · '+date(row.endDate)+' · '+row.hours+' h · '+label(row.state)]);}
  function invoiceOptions(){return current.records.invoices.map(row=>[row.id,accountName(row.contributorId)+' · '+row.number+' · '+label(row.state)]);}
  function nativeActions(kind,row){
    if(!editable()||session.draft||session.pending)return '';
    const transitions=kind==='invoices'?{RECEIVED:['review','dispute','void'],REVIEWED:['dispute','reopen','void'],DISPUTED:['reopen','void'],VOID:['reopen']}:
      kind==='work'?{LOGGED:['submit','void'],SUBMITTED:['accept','reopen','void'],ACCEPTED:['reopen','void']}:{OBSERVED:['void']};
    const singular=kind==='invoices'?'invoice':kind;
    return (transitions[row.state]||[]).map(action=>button(label(action),singular+'.'+action,{id:row.id})).join(' ')+
      ((kind==='invoices'&&row.state==='RECEIVED')||(kind==='work'&&row.state==='LOGGED')?button('Edit original '+singular,'edit-'+singular,{id:row.id}):'');
  }
  function summaries(){
    if(!report)return '';
    const balance=report.balances.closing;
    return '<div class="supplier-stats">'+[['Open invoices',money(balance.openUsd)],['Invoice credits',money(balance.creditUsd)],['Net balance',money(balance.balanceUsd)],
      ['Recorded work',report.workTotals.closing.recordedHours+' h'],['Work without invoice link',report.attention.workWithoutInvoiceLinkIds.length]]
      .map(([name,value])=>'<div><span>'+esc(name)+'</span><strong>'+esc(value)+'</strong></div>').join('')+
      '<p>Closing through '+esc(date(report.selection.endDate))+'. Net paid includes original supplier refunds.</p>';
  }
  function filtered(rows){
    const query=(session.query||'').trim().toLowerCase();let matching=rows.filter(row=>!query||JSON.stringify(row).toLowerCase().includes(query));
    if(session.onlyAttention&&session.panel==='invoices')matching=matching.filter(row=>report.attention.receivedInvoiceIds.includes(row.id)||report.attention.disputedInvoiceIds.includes(row.id)||report.attention.overdueInvoiceIds.includes(row.id));
    if(session.onlyAttention&&session.panel==='work')matching=matching.filter(row=>row.withoutInvoiceLink&&row.state!=='VOID'&&!row.future);
    const pages=Math.max(1,Math.ceil(matching.length/40));session.page=Math.max(0,Math.min(session.page||0,pages-1));
    return {rows:matching.slice(session.page*40,(session.page+1)*40),count:matching.length,pages};
  }
  function pager(count,pages){return '<div class="supplier-actions"><span>'+count+' records · page '+(session.page+1)+' of '+pages+'</span>'+
    button('Previous','previous',{disabled:session.page===0})+button('Next','next',{disabled:session.page>=pages-1})+'</div>';}
  function summary(){
    const {rows,count,pages}=filtered(report.accounts);
    return '<h4>'+esc(report.account?.name||'Choose or add a supplier')+'</h4>'+
      (report.account?'<p>'+esc(label(report.account.kind)+' · '+report.account.contact)+'</p>'+(report.account.note?'<p>'+esc(report.account.note)+'</p>':''):'')+
      '<div class="supplier-actions">'+button('Edit supplier details','edit-contributor',{id:report.account?.id,disabled:!report.account||!!session.draft||!editable()})+
      button('New supplier','new-contributor',{disabled:!!session.draft||!editable()})+'</div>'+
      '<h4>Account balances</h4>'+table(['Basis','Invoiced','Net paid','Open invoices','Credits','Net balance'],['opening','period','closing'].map(period=>[
        esc(period==='period'?'Period change':label(period)),...['invoicedUsd','paidUsd','openUsd','creditUsd','balanceUsd'].map(key=>esc(money(report.balances[period][key])))]))+
      '<h4>Invoice aging</h4>'+table(['Age at period end','Invoices','Open USD'],report.aging.map(row=>[esc(label(row.bucket)),esc(row.count),esc(money(row.amountUsd))]))+
      '<h4>All supplier accounts at these dates</h4>'+table(['Supplier','Open','Credits','Net paid','Work without invoice link','Disputed invoices',''],rows.map(row=>[
        esc(row.name),esc(money(row.closing.openUsd)),esc(money(row.closing.creditUsd)),esc(money(row.closing.paidUsd)),esc(row.workWithoutInvoiceLink),esc(row.disputedInvoices),button('Open account','select-account',{id:row.id})]))+pager(count,pages);
  }
  function invoiceView(){
    const {rows,count,pages}=filtered(report.invoices),selected=report.invoices.find(row=>row.id===session.selectedId);
    return '<div class="supplier-actions">'+button('Record supplier invoice','new-invoice',{disabled:!report.account||!!session.draft||!editable()})+
      button('Record observed payment','new-payment',{disabled:!report.account||!!session.draft||!editable()})+
      button('Record observed refund','new-refund',{disabled:!report.account||!!session.draft||!editable()})+'</div>'+
      table(['Invoice','State','Issued / due','Source USD','Paid through end','Open / credit',''],rows.map(row=>[
        '<strong>'+esc(row.number)+'</strong>'+(row.future?'<p>Issued after period end</p>':''),esc(label(row.state)),
        esc(date(row.issuedDate))+'<br>'+esc(date(row.dueDate)),esc(money(row.totalUsd)),esc(money(row.closingPaidUsd)),
        esc(money(row.openUsd))+' / '+esc(money(row.creditUsd)),button('Open invoice','show-invoice',{id:row.id})]))+pager(count,pages)+
      (selected?'<section class="supplier-detail"><h4>'+esc(selected.number)+'</h4><p>'+esc(label(selected.state))+' · Original total '+esc(money(selected.totalUsd))+'</p>'+
        table(['Line description','Amount USD','Work package','Original work links'],selected.lines.map(line=>[esc(line.description),esc(money(line.amountUsd)),esc(costName(line.costId)),
          line.workIds.map(id=>button(original('work',id)?.description||id,'show-work',{id})).join(' ')]))+
        '<div class="supplier-actions">'+nativeActions('invoices',selected)+button('Allocate an observed payment','invoice-payment',{id:selected.id,disabled:!!session.draft||!editable()})+
        button('Allocate an observed refund','invoice-refund',{id:selected.id,disabled:!!session.draft||!editable()})+'</div><h5>Original sources</h5>'+sources(selected)+
        '<details><summary>Complete original invoice and dated position</summary><pre>'+esc(pretty(selected))+'</pre></details></section>':'');
  }
  function workView(){
    const {rows,count,pages}=filtered(report.work),selected=report.work.find(row=>row.id===session.selectedId);
    return '<div class="supplier-actions">'+button('Record work','new-work',{disabled:!report.account||!!session.draft||!editable()})+'</div>'+
      table(['Completed work','Dates','Hours / funding','State','Invoice links',''],rows.map(row=>[
        esc(row.description),esc(date(row.startDate))+' — '+esc(date(row.endDate))+(row.future?'<p>Ends after period end</p>':''),
        esc(row.hours)+' h / '+esc(label(row.fundingBasis)),esc(label(row.state)),
        row.invoiceLinks.length?row.invoiceLinks.map(link=>button(link.number+' · '+label(link.state),'show-invoice',{id:link.invoiceId})).join(' '):'No invoice link',
        button('Open work','show-work',{id:row.id})]))+pager(count,pages)+
      (selected?'<section class="supplier-detail"><h4>'+esc(selected.description)+'</h4><p>'+esc(label(selected.state)+' · '+selected.hours+' hours · '+label(selected.fundingBasis))+'</p>'+
        '<p>Work package: '+esc(selected.costId||'Unassigned')+'</p><div class="supplier-actions">'+nativeActions('work',selected)+
        button('Start invoice with this work','invoice-work',{id:selected.id,disabled:!!session.draft||!editable()})+'</div>'+
        '<h5>Original sources</h5>'+sources(selected)+'<details><summary>Complete original work and invoice links</summary><pre>'+esc(pretty(selected))+'</pre></details></section>':'')+
      '<p>A work link associates the original record with an invoice line. Enter the actual invoice amount from its source.</p>';
  }
  function cashView(){
    const {rows,count,pages}=filtered(report.cash),selected=report.cash.find(row=>row.id===session.selectedId);
    return '<div class="supplier-actions">'+button('Record observed payment','new-payment',{disabled:!report.account||!!session.draft||!editable()})+
      button('Record observed refund','new-refund',{disabled:!report.account||!!session.draft||!editable()})+'</div>'+
      table(['Observed date / reference','Original quantity','Basis','Allocated to this supplier','Paid through end',''],rows.map(row=>[
        esc(date(row.date))+'<p>'+esc(row.externalRef)+'</p>',esc(row.amount+' '+row.currency)+'<p>'+esc(row.network+' '+row.asset)+'</p>',
        esc(label(row.usdBasis))+(row.future?'<p>After period end</p>':''),esc(money(row.accountAllocatedUsd)),esc(money(row.recognizedAccountPaidUsd)),button('Open observation','show-cash',{id:row.id})]))+pager(count,pages)+
      (selected?'<section class="supplier-detail"><h4>'+esc(selected.externalRef)+'</h4><p>'+esc(label(selected.direction)+' · '+label(selected.category)+' · '+date(selected.date)+' · '+label(selected.state))+'</p>'+
        '<p>Entire original observation: '+esc(selected.amount+' '+selected.currency)+' · Recorded value '+esc(money(selected.usdValue))+'</p>'+
        table(['Supplier','Invoice','Original allocation USD','Selected account'],selected.allocations.map(item=>[
          esc(item.contributor),item.onSelectedAccount?button(item.invoiceNumber,'show-invoice',{id:item.invoiceId}):esc(item.invoiceNumber),
          esc(money(item.amountUsd)),item.onSelectedAccount?'Yes':'Another supplier']))+
        '<p>Other supplier allocations: '+esc(money(selected.otherAllocatedUsd))+' · Unallocated original value: '+esc(money(selected.unallocatedUsd))+'</p>'+
        '<div class="supplier-actions">'+nativeActions('cash',selected)+'</div><h5>Original sources</h5>'+sources(selected)+
        (selected.valuationSourceIds.length?'<h5>Recorded valuation sources</h5>'+selected.valuationSourceIds.map(id=>button(sourceName(id),'source',{id})).join(' '):'')+
        '<details><summary>Entire original observation and allocation basis</summary><pre>'+esc(pretty(selected))+'</pre></details></section>':'')+
      '<p>The observation keeps the entire original quantity and every invoice allocation. This account includes its own original allocations.</p>';
  }
  function sourceView(){
    const {rows,count,pages}=filtered(report.sources);
    return table(['Original document','Kind','Observed','Size',''],rows.map(row=>[esc(row.filename),esc(label(row.kind)),esc(date(row.observedAt)),
      esc(Number(row.bytes).toLocaleString()+' B'),button('Download original','source',{id:row.id})]))+pager(count,pages)+
      '<p>The complete account handover includes the original operating case and every retained source document.</p>';
  }
  function activityView(){
    const {rows,count,pages}=filtered(report.activity);
    return table(['Date','Activity / reference','Invoiced USD','Net paid USD','Running balance USD'],rows.map(row=>[
      esc(date(row.date)),esc(label(row.kind))+'<p>'+esc(row.label)+'</p>',esc(money(row.invoicedUsd)),esc(money(row.paidUsd)),esc(money(row.runningBalanceUsd))]))+pager(count,pages)+
      '<p>The running balance starts with the account opening balance and applies original invoice issues, payments and refunds in this period.</p>';
  }
  function editor(){
    const draft=session.draft;if(!draft)return '';
    const data=draft.data,transition=!['contributor.save','work.save','invoice.save','cash.record'].includes(draft.action);
    const supplierId=data.contributorId||draft.contributorId||draft.before?.contributorId;
    const supplierName=draft.action==='contributor.save'?(data.name||'New supplier'):supplierId?accountName(supplierId):draft.action.startsWith('cash.')?'Original cash observation':'Original supplier';
    let fields='';
    if(draft.action==='contributor.save')fields=field('Supplier or contributor name','name',data.name,{required:true})+
      field('Kind','kind',data.kind,{options:choices(['PERSON','ORGANIZATION','TEAM','ROLE'])})+
      field('Contact','contact',data.contact)+field('Supplier notes','note',data.note,{area:true,wide:true});
    if(draft.action==='work.save')fields=field('Completed work','description',data.description,{required:true,area:true,wide:true})+
      field('Work start','startDate',data.startDate,{required:true,type:'date'})+field('Work end','endDate',data.endDate,{required:true,type:'date'})+
      field('Recorded hours','hours',data.hours,{required:true})+field('Funding basis','fundingBasis',data.fundingBasis,{options:choices(['PREAWARD','GRANT','CUSTOMER','INTERNAL'])})+
      field('Work package','costId',data.costId,{options:costs()});
    if(draft.action==='invoice.save')fields=field('Original invoice number','number',data.number,{required:true})+
      field('Issue date','issuedDate',data.issuedDate,{required:true,type:'date'})+field('Due date','dueDate',data.dueDate,{type:'date'})+
      '<div class="supplier-wide"><h5>Original invoice lines in USD</h5>'+data.lines.map((line,index)=>'<fieldset><legend>Line '+(index+1)+'</legend><div class="supplier-fields">'+
        field('Line description','lines.'+index+'.description',line.description,{required:true,area:true,wide:true})+
        field('Original amount USD','lines.'+index+'.amountUsd',line.amountUsd,{required:true})+
        field('Work package','lines.'+index+'.costId',line.costId,{options:costs()})+
        field('Original work links','lines.'+index+'.workIds',line.workIds,{options:workOptions(data.contributorId),multiple:true,wide:true})+
        '</div>'+button('Remove line','remove-line',{id:String(index),disabled:data.lines.length===1})+'</fieldset>').join('')+
        button('Add invoice line','add-line',{disabled:data.lines.length>=200})+'</div>';
    if(draft.action==='cash.record')fields=field('Observed date','date',data.date,{type:'date',required:true})+
      field('Direction','direction',data.direction,{options:choices(['OUT','IN'])})+
      field('Category','category',data.category,{options:choices(['INVOICE','REFUND','OTHER'])})+
      field('Original payment reference','externalRef',data.externalRef,{required:true,wide:true})+
      field('Original quantity','amount',data.amount,{required:true})+field('Currency or asset symbol','currency',data.currency,{required:true})+
      field('Original network','network',data.network)+field('Original asset identifier','asset',data.asset)+
      field('Recorded USD valuation','usdValue',data.usdValue,{help:'For USD, the original amount supplies the value. For another currency, retain its observed USD valuation.'})+
      field('Valuation source documents','valuationSourceIds',data.valuationSourceIds,{options:current.sources.map(row=>[row.id,row.filename]),multiple:true,wide:true})+
      '<div class="supplier-wide"><h5>Original invoice allocations</h5><p>Enter the observed USD allocation for each invoice. Mixed supplier payments keep every original allocation.</p>'+
      data.allocations.map((item,index)=>'<fieldset><legend>Allocation '+(index+1)+'</legend><div class="supplier-fields">'+
        field('Original invoice','allocations.'+index+'.invoiceId',item.invoiceId,{options:[['','Choose invoice'],...invoiceOptions()],required:true})+
        field('Allocated USD','allocations.'+index+'.amountUsd',item.amountUsd,{required:true})+'</div>'+
        button('Remove allocation','remove-allocation',{id:String(index)})+'</fieldset>').join('')+
      button('Add allocation','add-allocation',{disabled:data.allocations.length>=200})+'</div>';
    return '<section class="supplier-editor"><h4>'+esc(draft.label)+'</h4><p>Supplier: '+esc(supplierName)+
      ' · Original case version '+draft.expectedVersion+'</p>'+
      (draft.reconciledRecord?'<section class="supplier-reconciliation"><h5>Current original record at this version</h5><p>The retained form is your earlier input. Compare it with the current original record before saving.</p>'+
        '<pre>'+esc(pretty(draft.reconciledRecord))+'</pre>'+button('Use current original record in the form','use-current-record')+'</section>':'')+
      '<form data-pa-editor><div class="supplier-fields">'+fields+
      (transition?'<p class="supplier-wide">Review the original record and retain the reason for this state change.</p><details class="supplier-wide"><summary>Original record</summary><pre>'+esc(pretty(draft.before))+'</pre></details>':sourceFields(data))+
      field(transition?'Reason for this change':'Recording note','draftReason',draft.reason||'',{area:true,wide:true,required:transition})+
      '</div><div class="supplier-actions">'+button('Review original change','review-draft')+
      button('Download this complete desk','download-desk',{always:true})+button('Close draft','close-draft')+'</div></form>'+
      (session.reviewed?'<div class="supplier-review"><h5>Reviewed original command</h5><pre>'+esc(pretty(session.reviewed))+'</pre>'+
        '<div class="supplier-actions">'+button('Save reviewed change','save-draft',{disabled:!editable()})+'</div></div>':'')+'</section>';
  }
  function pendingView(){
    if(!session.pending)return '';
    const pending=session.pending;
    return '<section class="supplier-pending"><h4>Original request retained</h4><p>'+esc(label(pending.body.action.replace('.',' ')))+
      ' · case version '+pending.body.expectedVersion+' · '+esc(pending.body.actor)+'</p>'+
      (pending.problem?'<p>'+esc(pending.problem.message)+'</p>':'<p>Retry this original request to receive its result.</p>')+
      '<div class="supplier-actions">'+button('Retry original request','retry',{always:true})+
      button('Download complete input and request','download-desk',{always:true})+
      (pending.rejected?button('Reopen rejected input at current version','reopen-rejected',{always:true}):'')+'</div></section>';
  }
  function render(){
    if(!available())return;
    root.innerHTML='<header><h3>Supplier accounts</h3><p>Original work, supplier invoices, observed payments and complete dated account handovers.</p></header>'+
      '<div class="supplier-selection">'+field('Supplier','select.contributorId',session.contributorId||'',{options:[['','First supplier'],...current.records.contributors.map(row=>[row.id,row.name])]})+
      field('Period start','select.startDate',session.startDate||'',{type:'date'})+field('Period end','select.endDate',session.endDate||today(),{type:'date',required:true})+
      '<div class="supplier-actions">'+button('Open selected account','load')+button('Refresh original case','refresh')+'</div></div>'+
      '<div data-pa-status class="supplier-status" role="status"></div><div data-pa-conflict hidden class="supplier-pending">'+
      button('Download this complete desk','download-desk',{always:true})+button('Open saved desk and keep this copy','open-saved',{always:true})+'</div>'+pendingView()+
      '<div class="supplier-actions">'+button('Download complete account handover','export-account',{disabled:!report})+
      button('Download complete account JSON','download-report',{disabled:!report,always:true})+
      button('Download desk input','download-desk',{always:true})+button('Open desk input','open-desk')+
      button('Budget performance','performance')+button('Bulk ledger intake','ledger-intake')+
      button('Contributor details','contributors')+button('Account statements','statements')+button('All observed cash','cash')+'</div>'+
      '<input data-pa-desk-file type="file" accept=".json,application/json" hidden><input data-pa-source-file type="file" hidden>'+
      editor()+summaries()+
      '<nav class="supplier-tabs" aria-label="Supplier account sections">'+[['summary','Account / balances'],['invoices','Invoices'],['work','Work'],['cash','Payments / refunds'],['sources','Original sources'],['activity','Period activity']]
        .map(([key,text])=>'<button type="button" data-pa-action="panel" data-id="'+key+'"'+(session.panel===key?' aria-current="page"':'')+'>'+text+'</button>').join('')+'</nav>'+
      '<div class="supplier-filter"><label>Find original record<input type="search" data-pa-query value="'+esc(session.query||'')+'"></label>'+
      (['invoices','work'].includes(session.panel)?'<label class="supplier-check"><input type="checkbox" data-pa-attention'+(session.onlyAttention?' checked':'')+'>'+(session.panel==='work'?'Work without invoice link':'Received, disputed or overdue')+'</label>':'')+'</div>'+
      (report?({summary, invoices:invoiceView,work:workView,cash:cashView,sources:sourceView,activity:activityView}[session.panel]||summary)():
        '<p>Open a supplier account to see its original records.</p>')+
      (report?'<details><summary>Account dates and financial basis</summary><ul>'+report.basis.map(value=>'<li>'+esc(value)+'</li>').join('')+'</ul></details>':'');
    status();controls();
  }
  async function loadReport(){
    report=null;
    const query=new URLSearchParams({endDate:session.endDate||today(),expectedVersion:String(current.program.version)});
    if(session.contributorId)query.set('contributorId',session.contributorId);
    if(session.startDate)query.set('startDate',session.startDate);
    const value=await api(prefix+'/supplier-account?'+query);
    if(!available())return;
    if(value.schema!==REPORT_SCHEMA||value.case?.id!==caseId||value.case.version!==current.program.version)throw new Error('The account does not match the selected original case.');
    report=value;session.contributorId=value.selection.contributorId;session.startDate=value.selection.startDate||'';session.endDate=value.selection.endDate;
    await persist();
  }
  async function run(action){
    if(busy||hostBusy||!available())return;
    busy=true;error='';controls();status();
    try{await action();}catch(problem){if(available())error=problem.message||String(problem);}
    finally{if(available()){busy=false;render();}}
  }
  function startDraft(kind,row=null,extra={}){
    if(session.draft||session.pending)throw new Error('Finish or download and close the retained draft first.');
    const contributorId=report?.account?.id||session.contributorId,sourceIds=[],sourceNote='';
    let action,data;
    if(kind==='contributor'){action='contributor.save';data=row?clone(row):{name:'',kind:'ORGANIZATION',contact:'',note:'',sourceIds,sourceNote};}
    if(kind==='work'){action='work.save';data=row?clone(row):{contributorId,costId:null,description:'',startDate:today(),endDate:today(),hours:'',fundingBasis:'PREAWARD',sourceIds,sourceNote};}
    if(kind==='invoice'){
      action='invoice.save';data=row?clone(row):{contributorId,number:'',issuedDate:today(),dueDate:null,sourceIds,sourceNote,lines:[
        {id:'line-'+crypto.randomUUID(),costId:extra.work?.costId||null,description:extra.work?.description||'',amountUsd:'',workIds:extra.work?[extra.work.id]:[]} ]};
    }
    if(kind==='payment'||kind==='refund'){
      action='cash.record';data={date:today(),direction:kind==='refund'?'IN':'OUT',category:kind==='refund'?'REFUND':'INVOICE',
        amount:'',currency:'USD',network:'',asset:'',usdValue:null,externalRef:'',sourceIds,sourceNote,valuationSourceIds:[],
        allocations:extra.invoiceId?[{invoiceId:extra.invoiceId,amountUsd:''}]:[]};
    }
    if(!action)throw new Error('Choose an original supplier workflow.');
    session.draft={draftId:crypto.randomUUID(),contributorId,action,data,expectedVersion:current.program.version,reason:'',
      label:(row?'Edit ':'Record ')+(kind==='contributor'?'supplier details':kind==='payment'||kind==='refund'?'observed '+kind:kind)};
    session.reviewed=null;session.result=null;schedule();render();
  }
  function transition(action,id){
    if(session.draft||session.pending)throw new Error('Finish or close the current original draft first.');
    const [kind]=action.split('.'),before=original(kind==='invoice'?'invoices':kind,id);
    if(!before)throw new Error('Open the original record in this case.');
    session.draft={draftId:crypto.randomUUID(),contributorId:before.contributorId||report?.account?.id||session.contributorId||null,
      action,data:{id},before:clone(before),expectedVersion:current.program.version,reason:'',
      label:label(action.replace('.',' '))+' · '+(before.number||before.description||before.externalRef)};
    session.reviewed=null;schedule();render();
  }
  function setField(path,value){
    if(path==='draftReason'){session.draft.reason=value;return;}
    const bits=path.split('.');let target=session.draft.data;
    for(const bit of bits.slice(0,-1))target=target[bit];
    target[bits.at(-1)]=['costId','dueDate','usdValue'].includes(bits.at(-1))&&value===''?null:value;
  }
  async function prepareRequest(action,data,after={}){
    const body={expectedVersion:session.draft?.expectedVersion??current.program.version,
      actor:recordingActor(),note:action==='source.add'?'Retain original supplier account document.':session.draft.reason||'',action,data:clone(data)};
    body.requestId=await mutationId('operations:'+caseId,body);
    session.pending={body,after,preparedAt:new Date().toISOString()};await persist();render();await dispatch();
  }
  async function dispatch(){
    const pending=session.pending;if(!pending)return;
    busy=true;error='';render();
    try{
      assertStaffRequestActor(pending.body,pinnedContext);
      const result=await saveApi(prefix+'/command',clone(pending.body));
      if(result.id!==caseId||result.action!==pending.body.action)throw new Error('The result differs from the retained original request.');
      session.result=result;session.pending=null;session.reviewed=null;
      if(pending.body.action==='source.add'&&session.previousRequest?.body?.action==='source.add'&&
        session.previousRequest.after?.draftId===pending.after.draftId&&pretty(session.previousRequest.body.data)===pretty(pending.body.data)){
        session.previousRequest.recovered={requestId:pending.body.requestId,result:clone(result),recordedAt:new Date().toISOString()};
      }
      if(pending.after.kind==='source'&&session.draft?.draftId===pending.after.draftId){
        session.draft.data.sourceIds||=[];if(!session.draft.data.sourceIds.includes(result.recordId))session.draft.data.sourceIds.push(result.recordId);
        session.draft.expectedVersion=result.version;
      }else if(pending.after.kind==='draft'&&session.draft?.draftId===pending.after.draftId)session.draft=null;
      if(result.kind==='contributors')session.contributorId=result.recordId;
      await persist();
      if(available()){const next=await api(prefix);await onCase(next,result);}
    }catch(problem){
      pending.problem={message:problem.message||String(problem),status:problem.status||null,code:problem.code||null};
      pending.rejected=[400,409,413,415,422].includes(problem.status);
      if(session.pending===pending)await persist();
      if(available())error=pending.problem.message;
    }finally{if(available()){busy=false;render();}}
  }
  async function openDesk(file){
    if(file.size>32*1024*1024)throw new Error('Open a complete supplier desk up to 32 MiB.');
    const value=JSON.parse(await file.text());if(!available())return;
    if(value?.schema!==DESK_SCHEMA||value.caseId!==caseId)throw new Error('Open this case’s complete supplier desk. Import an account ZIP first when receiving a different case.');
    if(value.pending&&(!value.pending.body||typeof value.pending.body.requestId!=='string'||typeof value.pending.body.action!=='string'))
      throw new Error('The desk must retain its complete original pending request.');
    assertStaffRequestActor(value.pending?.body,pinnedContext);
    download(state(),caseId+'-supplier-desk-before-open-'+Date.now()+'.json');
    const revision=session.storageRevision;restore(value);session.storageRevision=revision;await persist();await loadReport();
    notice='Opened the original desk input and retained request.';
  }
  root.addEventListener('input',event=>{
    const node=event.target;
    if(session.pending)return;
    if(node.matches('[data-pa-query]')){
      const cursor=node.selectionStart;session.query=node.value;session.page=0;render();const input=$('[data-pa-query]');input?.focus();try{input?.setSelectionRange(cursor,cursor);}catch{}return;
    }
    const key=node.dataset.paField;if(!key||node.tagName==='SELECT'||key.startsWith('select.')||!session.draft)return;
    setField(key,node.value);session.reviewed=null;schedule();const review=$('.supplier-review');if(review)review.remove();
  });
  root.addEventListener('change',event=>{
    const node=event.target;if(session.pending)return;
    if(node.matches('[data-pa-desk-file]')){const file=node.files?.[0];node.value='';if(file)run(()=>openDesk(file));return;}
    if(node.matches('[data-pa-source-file]')){
      const file=node.files?.[0];node.value='';if(!file)return;
      run(async()=>{
        if(!file.size||file.size>8*1024*1024)throw new Error('Attach a nonempty original source up to 8 MiB.');
        const data={filename:file.name,mediaType:file.type.split(';')[0]||'application/octet-stream',
          kind:session.draft?.action==='invoice.save'?'invoice':session.draft?.action==='work.save'?'work':session.draft?.action==='cash.record'?'payment':'other',
          contentBase64:b64(await file.arrayBuffer()),observedAt:new Date().toISOString()};
        await prepareRequest('source.add',data,{kind:'source',draftId:session.draft?.draftId});
      });return;
    }
    if(node.matches('[data-pa-attention]')){session.onlyAttention=node.checked;session.page=0;render();return;}
    const key=node.dataset.paField;if(!key)return;
    if(key.startsWith('select.')){session[key.slice(7)]=node.value;report=null;session.selectedId=null;session.page=0;schedule();render();return;}
    if(!session.draft)return;
    setField(key,node.multiple?Array.from(node.selectedOptions).map(option=>option.value):node.value);
    session.reviewed=null;schedule();
  });
  root.addEventListener('submit',event=>{event.preventDefault();});
  root.addEventListener('click',event=>{
    const node=event.target.closest('[data-pa-action]');if(!node||node.disabled)return;
    const action=node.dataset.paAction,id=node.dataset.id;
    if(action==='download-desk'){download(state(),caseId+'-supplier-desk.json');return;}
    if(action==='download-report'&&report){download(report,caseId+'-supplier-account.json');return;}
    if(busy||hostBusy)return;
    if(action==='retry'){dispatch();return;}
    if(action==='open-saved'){run(async()=>{
      clearTimeout(saveTimer);await session.storageWrites.catch(()=>{});const saved=await stored(caseId);
      if(saved?.schema!==DESK_SCHEMA||saved.caseId!==caseId)throw new Error('The saved complete supplier desk is unavailable.');
      download(state(),caseId+'-supplier-desk-local-'+Date.now()+'.json');restore(saved);await loadReport();notice='Kept this tab’s complete input as a download and opened the saved desk.';
    });return;}
    if(action==='reopen-rejected'&&session.pending?.rejected){run(async()=>{
      const next=await api(prefix),pending=session.pending;session.previousRequest=clone(pending);session.pending=null;session.reviewed=null;
      if(session.draft){
        session.draft.expectedVersion=next.program.version;
        const kind={contributor:'contributors',invoice:'invoices',work:'work',cash:'cash'}[session.draft.action.split('.')[0]];
        session.draft.reconciledRecord=session.draft.data.id?clone(next.records[kind]?.find(row=>row.id===session.draft.data.id)||null):null;
      }
      await persist();await onCase(next,{version:next.program.version,action:'reconcile'});
    });return;}
    if(session.pending)return;
    if(action==='panel'){session.panel=id;session.page=0;session.query='';session.onlyAttention=false;schedule();render();return;}
    if(action==='previous'||action==='next'){session.page+=action==='next'?1:-1;render();return;}
    if(['performance','ledger-intake','contributors','statements','cash'].includes(action)){onOpen(action);return;}
    if(action==='load'){run(async()=>{session.page=0;session.selectedId=null;await loadReport();});return;}
    if(action==='refresh'){run(async()=>{const next=await api(prefix);await onCase(next,{version:next.program.version,action:'refresh'});});return;}
    if(action==='select-account'){run(async()=>{session.contributorId=id;session.selectedId=null;session.page=0;await loadReport();});return;}
    if(action==='open-desk'){$('[data-pa-desk-file]').click();return;}
    if(action==='attach-source'){$('[data-pa-source-file]').click();return;}
    if(action==='retained-source'&&session.previousRequest?.body?.action==='source.add'&&!session.previousRequest.recovered&&session.previousRequest.after?.draftId===session.draft?.draftId){run(()=>prepareRequest('source.add',session.previousRequest.body.data,{kind:'source',draftId:session.draft?.draftId}));return;}
    if(action==='source'){run(async()=>{const response=await api(prefix+'/sources/'+id,undefined,{download:true});download(await response.blob(),sourceName(id));});return;}
    if(action==='export-account'&&report){run(async()=>{
      const selected=report.selection,query=new URLSearchParams({endDate:selected.endDate,expectedVersion:String(report.case.version),expectedReportSha256:report.reportSha256});
      if(selected.contributorId)query.set('contributorId',selected.contributorId);if(selected.startDate)query.set('startDate',selected.startDate);
      const response=await api(prefix+'/supplier-account/export.zip?'+query,undefined,{download:true});download(await response.blob(),caseId+'-supplier-account.zip');
    });return;}
    if(action.startsWith('show-')){session.panel=({invoice:'invoices',work:'work',cash:'cash'})[action.slice(5)];session.selectedId=id;session.query='';session.onlyAttention=false;schedule();render();return;}
    if(action.startsWith('new-')){run(()=>{startDraft(action.slice(4));});return;}
    if(action.startsWith('edit-')){run(()=>{const kind=action.slice(5);startDraft(kind,original(({contributor:'contributors',invoice:'invoices',work:'work'})[kind],id));});return;}
    if(action==='invoice-work'){run(()=>startDraft('invoice',null,{work:original('work',id)}));return;}
    if(action==='invoice-payment'||action==='invoice-refund'){run(()=>startDraft(action.slice(8),null,{invoiceId:id}));return;}
    if(/^(invoice|work|cash)\.(review|dispute|reopen|void|submit|accept)$/.test(action)){run(()=>transition(action,id));return;}
    if(action==='close-draft'){
      download(state(),caseId+'-supplier-desk-closed-'+Date.now()+'.json');session.draft=null;session.reviewed=null;schedule();render();return;
    }
    if(!session.draft)return;
    if(action==='use-current-record'&&session.draft.reconciledRecord){
      const action=session.draft.action;
      if(['contributor.save','work.save','invoice.save'].includes(action))session.draft.data=clone(session.draft.reconciledRecord);
      else session.draft.before=clone(session.draft.reconciledRecord);
      session.draft.reconciledRecord=null;session.reviewed=null;schedule();render();return;
    }
    if(action==='add-line'){session.draft.data.lines.push({id:'line-'+crypto.randomUUID(),costId:null,description:'',amountUsd:'',workIds:[]});}
    else if(action==='remove-line'){session.draft.data.lines.splice(Number(id),1);}
    else if(action==='add-allocation'){session.draft.data.allocations.push({invoiceId:'',amountUsd:''});}
    else if(action==='remove-allocation'){session.draft.data.allocations.splice(Number(id),1);}
    else if(action==='review-draft'){
      if(!$('[data-pa-editor]')?.reportValidity())return;
      if(session.draft.action==='cash.record'&&!session.draft.data.allocations.some(item=>original('invoices',item.invoiceId)?.contributorId===session.draft.contributorId)){
        error='Allocate the observation to at least one original invoice on this supplier account. Other supplier allocations can be included in the same observation.';status();return;
      }
      session.reviewed=clone({action:session.draft.action,data:session.draft.data,expectedVersion:session.draft.expectedVersion,note:session.draft.reason||''});
      render();return;
    }else if(action==='save-draft'&&session.reviewed){run(async()=>{
      const reviewed=session.reviewed,draft=session.draft;
      if(pretty(reviewed)!==pretty({action:draft.action,data:draft.data,expectedVersion:draft.expectedVersion,note:draft.reason||''}))
        throw new Error('Review the current original input before saving.');
      await prepareRequest(draft.action,draft.data,{kind:'draft',draftId:draft.draftId});
    });return;}else return;
    session.reviewed=null;schedule();render();
  });
  async function initialize(){
    if(!session.initialized){
      try{const previous=await stored(caseId);session.storageRevision=Number.isSafeInteger(previous?._storedRevision)?previous._storedRevision:0;
        if(previous?.schema===DESK_SCHEMA&&previous.caseId===caseId)restore(previous);
      }catch{storageNote='Browser draft storage is unavailable. Download the complete desk to retain original input.';}
      session.initialized=true;
    }
    session.startDate||='';session.endDate||=today();session.panel||='summary';render();await loadReport();render();
  }
  const earlier=mountEarlierStaffDesk({root,staffContext:pinnedContext,title:'Supplier account',
    readCopy:()=>payablesStore('sf47-supplier-accounts').stored(caseId),isBusy:()=>busy||hostBusy||!session.initialized,setDeskBusy:value=>{busy=value;if(value)controls();else render();},
    describeCopy:value=>accountName(value.contributorId)+' · '+(value.pending?'original save pending':value.draft?'editable supplier draft':'saved account selection'),
    filename:caseId+'-supplier-earlier-desk.json',
    openCopy:async value=>{await openDesk(new File([JSON.stringify(value)],'supplier-earlier-desk.json',{type:'application/json'}));render();}
  });
  const ready=initialize();
  return {ready,setHostBusy(value){hostBusy=!!value;controls();},dispose(){earlier.dispose();active=false;clearTimeout(saveTimer);persist();}};
}
