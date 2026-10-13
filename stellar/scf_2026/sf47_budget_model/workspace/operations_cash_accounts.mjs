// Original cash account, allocations, reviewed corrections and complete case handover.
import {currentStaffContext,staffDeskStorageKey} from './staff-session.mjs';
const DESK_SCHEMA='stellar-forge.sf47-cash-desk.v1';
const REPORT_SCHEMA='stellar-forge.sf47-cash-account.v1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>JSON.parse(JSON.stringify(value)),pretty=value=>JSON.stringify(value,null,2);
const title=value=>String(value??'').replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase());
const today=()=>new Date().toISOString().slice(0,10);
const money=value=>value===null||value===undefined?'Unvalued':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value));
const date=value=>{if(!value)return '—';const day=/^\d{4}-\d{2}-\d{2}$/.test(value),parsed=new Date(day?value+'T00:00:00Z':value);return Number.isNaN(parsed.getTime())?String(value):new Intl.DateTimeFormat(undefined,{dateStyle:'medium',...(day?{timeZone:'UTC'}:{timeStyle:'short'})}).format(parsed);};
const b64=buffer=>{let value='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);};
const button=(text,action,{id='',disabled=false,always=false}={})=>'<button type="button" data-ca-action="'+action+'"'+(id?' data-id="'+esc(id)+'"':'')+(disabled?' disabled data-ca-fixed="true"':'')+(always?' data-ca-always="true"':'')+'>'+esc(text)+'</button>';
const table=(headers,rows)=>'<div class="cash-account-table"><table><thead><tr>'+headers.map(value=>'<th scope="col">'+esc(value)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+value+'</td>').join('')+'</tr>').join('')+(!rows.length?'<tr><td colspan="'+headers.length+'">No records in this view.</td></tr>':'')+'</tbody></table></div>';
const pairs=(entries)=>'<dl class="cash-account-details">'+entries.map(([key,value])=>'<div><dt>'+esc(key)+'</dt><dd>'+esc(value??'—')+'</dd></div>').join('')+'</dl>';
function download(value,name,type='application/json'){
  const blob=value instanceof Blob?value:new Blob([typeof value==='string'?value:pretty(value)+'\n'],{type});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function field(text,key,value='',{options,multiple=false,area=false,type='text',required=false,wide=false,help=''}={}){
  const attrs=' data-ca-field="'+esc(key)+'"'+(required?' required':'');
  const control=options?'<select'+attrs+(multiple?' multiple size="4"':'')+'>'+options.map(([id,name])=>'<option value="'+esc(id)+'"'+((multiple?(value||[]).includes(id):String(value??'')===String(id))?' selected':'')+'>'+esc(name)+'</option>').join('')+'</select>':area?'<textarea'+attrs+' rows="3">'+esc(value)+'</textarea>':'<input'+attrs+' type="'+type+'" value="'+esc(value??'')+'">';
  return '<label'+(wide?' class="cash-account-wide"':'')+'>'+esc(text)+control+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
}
const options=values=>values.map(value=>[value,title(value)]);
const CASH_DATABASE='sf47-cash-accounts',databases=new Map();
function db(name=CASH_DATABASE){
  if(!databases.has(name)){
    const opening=new Promise((resolve,reject)=>{
      if(!globalThis.indexedDB){reject(new Error('Browser draft storage is unavailable.'));return;}
      const request=indexedDB.open(name,1);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('desks'))request.result.createObjectStore('desks');};
      request.onerror=()=>reject(request.error||new Error('Browser draft storage could not open.'));
      request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();databases.delete(name);};resolve(request.result);};
    }).catch(problem=>{databases.delete(name);throw problem;});
    databases.set(name,opening);
  }
  return databases.get(name);
}
async function stored(key,value,expectedRevision,name=CASH_DATABASE){
  const database=await db(name);
  return new Promise((resolve,reject)=>{
    const tx=database.transaction('desks',value===undefined?'readonly':'readwrite'),store=tx.objectStore('desks'),request=store.get(key);
    let result,conflict;
    request.onsuccess=()=>{
      const previous=request.result;
      if(value===undefined){result=previous;return;}
      const revision=Number.isSafeInteger(previous?._storedRevision)?previous._storedRevision:0;
      if(revision!==expectedRevision){conflict=Object.assign(new Error('Another tab saved a newer cash desk.'),{code:'CASH_DRAFT_CONFLICT'});tx.abort();return;}
      store.put({...value,_storedRevision:revision+1},key);result=revision+1;
    };
    tx.oncomplete=()=>resolve(result);
    tx.onerror=tx.onabort=()=>reject(conflict||tx.error||request.error||new Error('Browser draft could not be saved.'));
  });
}
const CASH_FIELDS=['date','direction','category','currency','network','asset','amount','usdValue','externalRef','tranche','allocations','sourceIds','sourceNote','valuationSourceIds','valuationNote'];
const nativeCash=row=>Object.fromEntries(CASH_FIELDS.filter(key=>Object.hasOwn(row,key)).map(key=>[key,clone(row[key])]));
export function mountCashAccounts({container,current,api,saveApi=api,session,mutationId,recordingActor,onCase,onOpen,staffContext=currentStaffContext()}){
  const root=document.createElement('section');root.className='cash-account-desk';root.setAttribute('aria-label','Cash movements');container.replaceChildren(root);
  if(!document.querySelector('link[data-cash-account-style]')){
    const style=document.createElement('link');style.rel='stylesheet';style.href='/operations_cash_accounts.css';style.dataset.cashAccountStyle='true';document.head.append(style);
  }
  const caseId=current.program.id,prefix='/api/operations/'+caseId;
  const deskContext=staffContext?clone(staffContext):null,databaseName=staffDeskStorageKey(CASH_DATABASE,deskContext),boundStaff=databaseName!==CASH_DATABASE;
  const ownStored=(key,value,expectedRevision)=>stored(key,value,expectedRevision,databaseName);
  let legacyCopy=null,legacySearched=false;
  function pendingActorProblem(body) {
    if(!boundStaff||deskContext.role==='owner'||!body)return null;
    if(typeof body.actor==='string'&&body.actor.trim()===deskContext.actor)return null;
    const original=typeof body.actor==='string'&&body.actor.trim()?body.actor.trim():'an unrecorded operator';
    return Object.assign(new Error('This original request belongs to '+original+'. Sign in as that operator to resume it. The complete original copy remains available to download.'),{code:'STAFF_REQUEST_ACTOR_CHANGED',status:403});
  }

  let active=true,busy=false,hostBusy=false,report=null,error='',notice='',storageNote='',saveTimer,loadSequence=0;
  session.storageWrites||=Promise.resolve();session.panel||='transactions';session.page||=0;session.selection||={startDate:'',endDate:today(),network:null,currency:null,asset:null};
  const available=()=>active&&root.isConnected,$=selector=>root.querySelector(selector);
  const editable=()=>current.program.state==='OPEN';
  const sourceName=id=>current.sources.find(row=>row.id===id)?.filename||id;
  const supplierName=id=>current.records.contributors.find(row=>row.id===id)?.name||id||'Unassigned';
  const invoiceName=id=>{const row=current.records.invoices.find(row=>row.id===id);return row?supplierName(row.contributorId)+' · '+row.number:id;};
  const record=id=>current.records.cash.find(row=>row.id===id);
  const cleanSelection=value=>({startDate:value?.startDate||null,endDate:value?.endDate||null,network:value?.network??null,currency:value?.currency??null,asset:value?.asset??null});
  function state(){
    return {schema:DESK_SCHEMA,caseId,selection:clone(session.selection),panel:session.panel,selectedId:session.selectedId||null,
      filters:clone(session.filters||{query:'',state:'',direction:'',category:'',periodOnly:true}),
      draft:session.draft?clone(session.draft):null,pending:session.pending?clone(session.pending):null,
      previousRequest:session.previousRequest?clone(session.previousRequest):null,result:session.result?clone(session.result):null};
  }
  async function persist(){
    const value=state(),write=session.storageWrites.catch(()=>{}).then(async()=>{
      const revision=await ownStored(caseId,value,session.storageRevision??0);session.storageRevision=revision;session.storageConflict=false;
    });
    session.storageWrites=write;
    try{await write;storageNote='';if(available())status();return true;}
    catch(problem){
      session.storageConflict=problem.code==='CASH_DRAFT_CONFLICT'||session.storageConflict;
      storageNote=session.storageConflict?'Another tab saved a newer cash desk. This tab retains its full input and original pending request. Download this desk or open the saved version.':'Browser storage could not save this desk. Download the complete desk to retain your input and original pending request.';
      if(available())status();return false;
    }
  }
  function restore(value){
    for(const key of ['selection','panel','selectedId','filters','draft','pending','previousRequest','result'])session[key]=clone(value[key]??null);
    session.selection||={startDate:'',endDate:today(),network:null,currency:null,asset:null};session.panel||='transactions';session.page=0;session.reviewed=null;
    session.storageRevision=Number.isSafeInteger(value._storedRevision)?value._storedRevision:0;session.storageConflict=false;
  }
  function schedule(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{persist();},180);}
  function controls(){
    if(!available())return;root.setAttribute('aria-busy',String(busy||hostBusy));
    for(const node of root.querySelectorAll('button,input,select,textarea'))node.disabled=node.dataset.caFixed==='true'||(node.dataset.caAlways!=='true'&&(busy||hostBusy||!!session.pending));
    for(const node of root.querySelectorAll('[data-ca-action="retry"],[data-ca-action="reopen-rejected"]'))node.disabled=busy||hostBusy||!!pendingActorProblem(session.pending?.body);
  }
  function status(){
    const target=$('[data-ca-status]');if(target){target.textContent=error||storageNote||notice;target.setAttribute('role',error||session.storageConflict?'alert':'status');}
    const conflict=$('[data-ca-conflict]');if(conflict)conflict.hidden=!session.storageConflict;
  }
  async function inspectLegacy(){
    const value=await stored(caseId);if(!available())return;
    if(value)validateDesk(value);
    legacyCopy=value?clone(value):null;legacySearched=true;render();
  }
  async function openLegacy(){
    if(!legacyCopy)throw new Error('Choose an earlier browser copy first.');
    if(session.pending)throw new Error('Keep the current original request until its result is available.');
    const problem=pendingActorProblem(legacyCopy.pending?.body);if(problem)throw problem;
    clearTimeout(saveTimer);await session.storageWrites.catch(()=>{});if(!available())return;
    const revision=session.storageRevision??0;
    download(state(),caseId+'-cash-desk-before-earlier-copy-'+Date.now()+'.json');
    restore(legacyCopy);session.storageRevision=revision;legacyCopy=null;legacySearched=false;report=null;render();
    await persist();if(!available())return;await loadReport();
    notice='Opened the selected earlier copy in this sign-in. Its original browser copy remains available.';render();
  }
  function legacyView(){
    if(!legacySearched)return '';
    if(!legacyCopy)return '<section class="cash-account-reconciliation"><h4>Earlier browser copies</h4><p>No earlier cash desk is saved for this case.</p>'+button('Close','legacy-close')+'</section>';
    const pending=legacyCopy.pending,problem=pendingActorProblem(pending?.body);
    return '<section class="cash-account-reconciliation"><h4>Earlier browser copy</h4>'+
      pairs([['Original case',legacyCopy.caseId],['Original request',pending?.body?.requestId||'No pending request'],['Original operator',pending?.body?.actor||'No pending request']])+
      '<p>'+esc(problem?.message||'Open this selected copy in the current sign-in. This desk is retained as a complete download first.')+'</p><div class="cash-account-actions">'+
      button('Open selected earlier copy','legacy-open',{disabled:!!problem||!!session.pending})+button('Download earlier copy','legacy-download',{always:true})+button('Close','legacy-close')+'</div></section>';
  }
  function sourceButtons(row){return (row.sourceIds||[]).map(id=>button(sourceName(id),'source',{id})).join(' ');}
  function dimensions(key){
    return [['null','All '+({network:'networks',currency:'currencies',asset:'assets'})[key]],...Array.from(new Set([...current.records.cash.map(row=>row[key]),...(session.selection[key]!==null&&session.selection[key]!==undefined?[session.selection[key]]:[])])).sort().map(value=>[JSON.stringify(value),value||'Unspecified '+key])];
  }
  function totals(finances,heading){
    if(!finances)return '';
    const rows=[['Net recorded cash','netUsd'],['Cash received','inUsd'],['Cash paid','outUsd'],['Grant receipts','grantReceiptsUsd'],['Customer receipts','customerReceiptsUsd'],['Net invoice payments','paidUsd']];
    return '<h4>'+esc(heading)+'</h4>'+table(['Measure','Opening','Period change','Closing'],rows.map(([name,key])=>[esc(name),money(finances.opening?.[key]),money(finances.period?.[key]),money(finances.closing?.[key])]));
  }
  function summary(){
    if(!report)return '';
    const f=report.finances;
    return '<div class="cash-account-summary">'+[['Opening net cash',f.opening.netUsd],['Period cash received',f.period.inUsd],['Period cash paid',f.period.outUsd],['Closing net cash',f.closing.netUsd]].map(([name,value])=>'<div><span>'+esc(name)+'</span><strong>'+money(value)+'</strong></div>').join('')+'</div><p class="cash-account-basis">'+esc(report.case.name)+' · case version '+report.case.version+' · '+(report.selection.startDate?date(report.selection.startDate):'All earlier activity')+' to '+date(report.selection.endDate)+'</p>';
  }
  function visible(rows){
    const filter=session.filters||{},query=(filter.query||'').trim().toLocaleLowerCase();
    return rows.filter(row=>(!filter.periodOnly||row.inPeriod)&&(!filter.state||row.state===filter.state)&&(!filter.direction||row.direction===filter.direction)&&(!filter.category||row.category===filter.category)&&(!query||[row.externalRef,row.currency,row.network,row.asset,row.sourceNote,...(row.allocations||[]).map(item=>invoiceName(item.invoiceId))].join(' ').toLocaleLowerCase().includes(query)));
  }
  function pager(count,pages){return '<div class="cash-account-actions"><span>'+count+' records · page '+(session.page+1)+' of '+pages+'</span>'+button('Previous','previous',{disabled:session.page<=0})+button('Next','next',{disabled:session.page>=pages-1})+'</div>';}
  function transactionDetails(row){
    if(!row)return '';
    const original=record(row.id)||row;
    const originRows=(row.origins||[]).map(origin=>typeof origin==='string'?origin:(origin.label||origin.kind||origin.schema||'Original source')+(origin.sourceId?' · '+sourceName(origin.sourceId):''));
    return '<section class="cash-account-record"><div class="cash-account-heading"><div><h4>'+esc(row.externalRef)+'</h4><p>'+date(row.date)+' · '+esc(title(row.state))+' · '+esc(title(row.usdBasis||row.sourceBasis))+'</p></div>'+button('Close detail','close-detail')+'</div>'+
      pairs([['Original quantity',row.amount+' '+row.currency],['Network',row.network||'Not specified'],['Asset',row.asset||row.currency],['Direction',title(row.direction)],['Category',title(row.category)],['Recorded USD valuation',money(row.usdValue)],['Grant tranche',row.tranche===null?'Unassigned':row.tranche],['Allocated USD',money(row.allocatedUsd)],['Unallocated USD',money(row.unallocatedUsd)],['Valuation basis',row.valuationNote||'Original cash amount/source']])+
      '<h5>Original invoice allocations</h5>'+table(['Supplier / invoice','Allocated USD','Original invoice documents'],(row.allocations||[]).map(item=>[esc(item.contributorName||supplierName(item.contributorId))+'<small>'+esc(item.invoiceNumber||invoiceName(item.invoiceId))+'</small>',money(item.amountUsd),sourceButtons({sourceIds:item.sourceIds||[]})]))+
      '<h5>Original source documents</h5><div class="cash-account-actions">'+sourceButtons(original)+(original.valuationSourceIds||[]).filter(id=>!(original.sourceIds||[]).includes(id)).map(id=>button(sourceName(id),'source',{id})).join(' ')+'</div><p>'+esc(row.sourceNote||'Direct operator entry')+'</p>'+
      (originRows.length?'<h5>Source workflow</h5><ul>'+originRows.map(value=>'<li>'+esc(value)+'</li>').join('')+'</ul>':'')+
      '<div class="cash-account-actions">'+button(row.currentSuccessorId?'Open current correction':'Correct observation',row.currentSuccessorId?'detail':'correct',{id:row.currentSuccessorId||row.id,disabled:!row.currentSuccessorId&&(!editable()||!!session.draft)})+button('Void observation','void',{id:row.id,disabled:row.state!=='OBSERVED'||!editable()||!!session.draft})+button('Download original record','download-record',{id:row.id})+'</div>'+
      '<details><summary>Complete original observation</summary><pre>'+esc(pretty(original))+'</pre></details></section>';
  }
  function transactions(){
    const filters=session.filters||={query:'',state:'',direction:'',category:'',periodOnly:true};
    const rows=visible(report.transactions),pages=Math.max(1,Math.ceil(rows.length/40));session.page=Math.min(Math.max(0,session.page),pages-1);
    const page=rows.slice(session.page*40,(session.page+1)*40),selected=report.transactions.find(row=>row.id===session.selectedId);
    return '<div class="cash-account-fields cash-account-filter">'+field('Search references, suppliers or sources','filter.query',filters.query||'')+
      field('Record state','filter.state',filters.state,{options:[['','All states'],['OBSERVED','Observed'],['VOID','Voided']]})+
      field('Direction','filter.direction',filters.direction,{options:[['','Both directions'],['IN','Received'],['OUT','Paid']]})+
      field('Category','filter.category',filters.category,{options:[['','All categories'],...options(['GRANT','INVOICE','CUSTOMER','CAPITAL','REFUND','OTHER'])]})+
      '<label class="cash-account-check"><input type="checkbox" data-ca-period-only'+(filters.periodOnly?' checked':'')+'> Only activity within the selected period</label></div>'+
      table(['Date / original reference','Cash movement','Original quantity','USD / allocation','State / source',''],page.map(row=>[date(row.date)+'<small>'+esc(row.externalRef)+'</small>',esc(title(row.direction))+' · '+esc(title(row.category)),esc(row.amount)+' '+esc(row.currency)+'<small>'+esc([row.network,row.asset].filter(Boolean).join(' · '))+'</small>',money(row.usdValue)+'<small>Allocated '+money(row.allocatedUsd)+'</small>',esc(title(row.state))+'<small>'+esc(title(row.usdBasis))+'</small>',button('Open','detail',{id:row.id})]))+pager(rows.length,pages)+transactionDetails(selected);
  }
  function accounts(){
    return '<h4>Recorded cash accounts</h4><p>Select an exact original network, currency and asset to open its cash movements and documents for these dates.</p>'+
      table(['Account','Recorded observations','Opening net cash','Period net cash','Closing net cash',''],report.accounts.map(row=>[
        esc(row.label),esc(row.transactionCount)+'<small>'+row.voidCount+' voided · '+row.unvaluedCount+' unvalued · '+row.testnetCount+' testnet</small>',
        money(row.opening.netUsd),money(row.period.netUsd),money(row.closing.netUsd),button('Open this account','account',{id:row.key})]))+
      button('Open all cash accounts','all-accounts');
  }
  function balances(){
    return totals(report.finances,'Selected cash account')+
      '<h4>Original asset quantities</h4>'+table(['Currency / network / asset','Opening net','Period received','Period paid','Closing net'],report.assets.map(row=>[esc([row.currency,row.network,row.asset].filter(Boolean).join(' · ')),esc(row.openingNet),esc(row.periodIn),esc(row.periodOut),esc(row.closingNet)]))+
      '<h4>Original invoice positions</h4><p>Invoice positions use all recorded case payments and refunds, including other cash accounts.</p>'+table(['Supplier / invoice','Original liability','Opening net paid','Period net paid','Closing net paid','Open / credit'],report.invoices.map(row=>[esc(supplierName(row.contributorId))+'<small>'+esc(row.number)+'</small>',money(row.positions.closing.invoicedUsd),money(row.positions.opening.paidUsd),money(row.positions.period.paidUsd),money(row.positions.closing.paidUsd),money(row.positions.closing.openUsd)+' / '+money(row.positions.closing.creditUsd)]))+
      '<details><summary>Complete case cash positions</summary>'+totals(report.caseFinances,'All recorded cash accounts')+'</details>'+
      '<div class="cash-account-actions">'+button('Open supplier accounts','supplier-account')+button('Open budget performance','performance')+button('Open operating forecast','forecast')+'</div>';
  }
  function dependencyView(dependencies,heading='Related original work'){
    if(!dependencies)return '';
    const completion=dependencies.completion||{},clocks=completion.clocks||[],extensions=completion.extensions||[],outcomes=completion.outcomes||[],reviews=completion.reviews||[],forecasts=dependencies.forecasts||[];
    const retained=clocks.length||extensions.length||outcomes.length||reviews.length;
    return '<h5>'+esc(heading)+'</h5>'+
      (retained?'<p>Tranche completion retains the original selected payment, dates, extensions and saved reviews. Open completion to continue from the current original receipt.</p>'+
        table(['Tranche / original payment','Current completion details'],clocks.map(row=>[
          'Tranche '+esc(row.tranche??row.trancheNumber??'')+'<small>'+esc(row.receiptId||row.cashId||'No selected payment')+'</small>',
          pairs(Object.entries(row).filter(([key,value])=>!['receiptId','cashId','tranche','trancheNumber','paymentSourceIds'].includes(key)&&value!==null&&typeof value!=='object').map(([key,value])=>[title(key),/(date|at|on)$/i.test(key)&&typeof value==='string'?date(value):typeof value==='boolean'?(value?'Yes':'No'):value]))+
            '<details><summary>Complete original clock</summary><pre>'+esc(pretty(row))+'</pre></details>']))+
        '<p>'+extensions.length+' retained extensions · '+outcomes.length+' original delivery outcomes · '+reviews.length+' saved completion reviews.</p>'+
        button('Open tranche completion','completion'):'<p>No original completion receipt is selected for these observations.</p>')+
      (forecasts.length?'<h5>Saved operating forecasts</h5><p>Each saved edition retains its original source. A current continuation is available below after a correction.</p>'+
        table(['Saved forecast','Saved date / version','Referenced cash observations'],forecasts.map(row=>[esc(row.name)+'<small>'+esc(row.id)+'</small>',date(row.createdAt)+'<small>Case version '+esc(row.version)+'</small>',(row.references||[]).map(item=>esc(item.cashId)).join('<br>')]))+button('Open operating forecast','forecast'):'')+
      (dependencies.replacementCompletion?.length?'<h5>Completion after this correction</h5>'+table(['Tranche','Projected original receipt clock'],dependencies.replacementCompletion.map(row=>['Tranche '+esc(row.tranche??''),'<pre>'+esc(pretty(row))+'</pre>'])):'');
  }
  function forecastContinuations(){
    const rows=report.forecastContinuations||[];
    if(!rows.length)return '';
    return '<h5>Continue a forecast from current cash</h5><p>These complete inputs follow the recorded correction chain to the current original payment. Open one in the existing forecast editor to review its current dates, remaining work and cash before saving a new edition.</p>'+
      table(['Original forecast','Current continuation',''],rows.map((row,index)=>[
        esc(row.name)+'<small>'+esc(row.forecastId)+'</small>',
        esc(title(row.status))+' · case version '+esc(row.expectedVersion)+(row.message?'<p>'+esc(row.message)+'</p>':''),
        button('Open current inputs','forecast-continuation',{id:String(index),disabled:!row.inputs})+button('Download complete inputs','download-forecast-continuation',{id:String(index),disabled:!row.inputs})]));
  }
  function corrections(){
    const rows=report.corrections||[];
    return '<h4>Recorded corrections</h4><p>Each correction carries its original and replacement observation, reason, operator and native case history.</p>'+
      rows.map(item=>{
        const row=item.record,original=row.original,replacement=row.replacement,source=item.source;
        return '<section class="cash-account-record"><h5>'+esc(original.externalRef||row.originalCashId||'Original cash observation')+'</h5>'+
          pairs([['Recorded',date(row.recordedAt||row.at||row.createdAt||source.observedAt)],['Operator',row.actor||row.operator],['Reason',row.reason],['Original observation',row.originalCashId||original.id],['Replacement observation',row.replacementCashId||replacement.id]])+
          '<div class="cash-account-actions">'+button('Open original','detail',{id:row.originalCashId||original.id})+button('Open replacement','detail',{id:row.replacementCashId||replacement.id})+(source.id?button('Download correction source','source',{id:source.id}):'')+'</div>'+
          '<details><summary>Complete original correction</summary><pre>'+esc(pretty(row))+'</pre></details></section>';
      }).join('')+(!rows.length?'<p>No corrections have been recorded for this selection.</p>':'')+dependencyView(report.dependencies)+forecastContinuations();
  }
  function sources(){
    return '<h4>Original documents and recorded changes</h4>'+table(['Document','Kind / original observation','Size',''],report.sources.map(row=>[esc(row.filename),esc(title(row.kind))+'<small>'+date(row.observedAt)+'</small>',esc(row.bytes)+' bytes',button('Download original','source',{id:row.id})]))+
      '<h4>Original case history</h4>'+table(['Recorded / version','Operator','Change / reason'],(report.history||[]).map(row=>[date(row.at)+'<small>Case version '+row.version+'</small>',esc(row.actor),esc(title(row.action))+'<p>'+esc(row.note)+'</p><details><summary>Original record values</summary><pre>'+esc(pretty({before:row.before,after:row.after,sourceChange:row.sourceChange}))+'</pre></details>']))+
      '<details><summary>Account calculation basis</summary><ul>'+(report.basis||[]).map(value=>'<li>'+esc(value)+'</li>').join('')+'</ul></details>';
  }
  function sourceFields(data){
    return '<fieldset class="cash-account-wide"><legend>Original sources</legend><div class="cash-account-fields">'+
      field('Retained documents','sourceIds',data.sourceIds||[],{options:current.sources.map(row=>[row.id,row.filename]),multiple:true,wide:true})+
      field('Original source reference','sourceNote',data.sourceNote||'',{area:true,wide:true})+'</div><div class="cash-account-actions">'+button('Attach original document','attach-source')+
      (session.previousRequest?.body?.action==='source.add'&&!session.previousRequest.recovered&&session.previousRequest.after?.draftId===session.draft?.draftId?button('Record retained source document','retained-source'):'')+'</div></fieldset>';
  }
  function previewView(){
    const reviewed=session.reviewed;if(!reviewed)return '';
    if(reviewed.kind!=='correction')return '<section class="cash-account-review"><h5>Reviewed original cash change</h5>'+pairs([['Action',title(reviewed.body.action)],['Case version',reviewed.body.expectedVersion],['Recording note',reviewed.body.note]])+'<details><summary>Complete original input</summary><pre>'+esc(pretty(reviewed.body.data))+'</pre></details>'+button('Save reviewed change','save',{disabled:!editable()})+'</section>';
    const value=reviewed.preview,impact=value.impact||{},before=impact.before||{},after=impact.after||{};
    const first=before.finances?.closing||before.closing||before,last=after.finances?.closing||after.closing||after;
    const cashRows=[['Net recorded cash','netUsd'],['Cash received','inUsd'],['Cash paid','outUsd'],['Grant receipts','grantReceiptsUsd'],['Customer receipts','customerReceiptsUsd'],['Net invoice payments','paidUsd'],['Open invoices','openUsd'],['Supplier credits','creditUsd']];
    const findings=value.findings||[];
    return '<section class="cash-account-review"><h5>Reviewed correction impact</h5><p>Case version '+value.case.version+' · '+(value.selection.startDate?date(value.selection.startDate):'All earlier activity')+' to '+date(value.selection.endDate)+'</p>'+
      table(['Changed field','Original','Replacement'],(value.changes||[]).map(row=>[esc(title(row.field||row.key)),esc(typeof row.before==='object'?pretty(row.before):row.before),esc(typeof row.after==='object'?pretty(row.after):row.after)]))+
      table(['Closing position','Before','After','Change'],cashRows.filter(([,key])=>Object.hasOwn(first,key)||Object.hasOwn(last,key)).map(([name,key])=>[esc(name),money(first[key]),money(last[key]),money(impact.deltas.finances.closing[key])]))+
      (impact.invoices?.length?'<h5>Affected invoices</h5>'+table(['Supplier / invoice','Net paid before / after','Open before / after','Credit before / after'],impact.invoices.map(row=>[esc(row.contributorName)+'<small>'+esc(row.number)+'</small>',money(row.before.closing.paidUsd)+' / '+money(row.after.closing.paidUsd),money(row.before.closing.openUsd)+' / '+money(row.after.closing.openUsd),money(row.before.closing.creditUsd)+' / '+money(row.after.closing.creditUsd)])):'')+
      (impact.packages?.length?'<h5>Affected work packages</h5>'+table(['Work package','Net paid before','Net paid after','Change'],impact.packages.map(row=>[esc(row.description||row.id||'Unassigned'),money(row.before.closingPaidUsd),money(row.after.closingPaidUsd),money(row.deltas.closingPaidUsd)])):'')+
      (impact.assets?.length?'<h5>Original asset effects</h5>'+table(['Currency / network / asset','Closing quantity before','Closing quantity after','Quantity change'],impact.assets.map(row=>[esc([row.currency,row.network,row.asset].filter(Boolean).join(' · ')),esc(row.before?.closingNet??'0'),esc(row.after?.closingNet??'0'),esc(row.deltas.closingNet)])):'')+
      dependencyView(value.dependencies,'Completion and forecast references')+
      (findings.length?'<h5>Review findings</h5><ul>'+findings.map(row=>'<li>'+esc(typeof row==='string'?row:row.message||row.description||row.code)+'</li>').join('')+'</ul>':'')+
      '<details><summary>Complete original impact and source selection</summary><pre>'+esc(pretty(value))+'</pre></details>'+
      '<div class="cash-account-actions">'+button('Download reviewed correction','download-preview')+button('Save reviewed correction','save',{disabled:!editable()||value.canApply===false})+'</div></section>';
  }
  function editor(){
    const draft=session.draft;if(!draft)return '';
    const data=draft.data,isVoid=draft.kind==='void',correcting=draft.kind==='correction';
    let fields=isVoid?'<p class="cash-account-wide">Review this original observation and retain the reason for voiding it.</p>':
      field('Observed date','date',data.date,{type:'date',required:true})+field('Direction','direction',data.direction,{options:options(['IN','OUT'])})+
      field('Category','category',data.category,{options:options(['GRANT','INVOICE','CUSTOMER','CAPITAL','REFUND','OTHER'])})+
      field('Original payment reference','externalRef',data.externalRef,{required:true,wide:true})+
      field('Exact observed quantity','amount',data.amount,{required:true})+field('Currency or asset symbol','currency',data.currency,{required:true})+
      field('Original network','network',data.network)+field('Original asset identity','asset',data.asset)+
      field('Recorded USD valuation','usdValue',data.usdValue,{help:'USD uses its original amount. Leave another currency unvalued when no USD source is available.'})+
      field('Grant tranche','tranche',data.tranche,{options:[['','Unassigned'],['0','0 · advance'],['1','1'],['2','2'],['3','3']]})+
      field('Valuation basis','valuationNote',data.valuationNote||'',{area:true,wide:true})+
      field('Valuation source documents','valuationSourceIds',data.valuationSourceIds||[],{options:current.sources.map(row=>[row.id,row.filename]),multiple:true,wide:true})+
      '<fieldset class="cash-account-wide"><legend>Original invoice allocations</legend><p>Retain every invoice allocation in this payment or refund, including other suppliers.</p>'+
      (data.allocations||[]).map((item,index)=>'<div class="cash-account-allocation"><div class="cash-account-fields">'+
        field('Original invoice','allocations.'+index+'.invoiceId',item.invoiceId,{options:[['','Choose invoice'],...current.records.invoices.map(row=>[row.id,invoiceName(row.id)+' · '+title(row.state)])],required:true})+
        field('Allocated USD','allocations.'+index+'.amountUsd',item.amountUsd,{required:true})+'</div>'+button('Remove allocation','remove-allocation',{id:String(index)})+'</div>').join('')+button('Add invoice allocation','add-allocation',{disabled:(data.allocations||[]).length>=200})+'</fieldset>'+sourceFields(data);
    return '<section class="cash-account-editor"><h4>'+esc(isVoid?'Void original observation':correcting?'Correct original observation':'Record cash movement')+'</h4><p>'+esc(draft.before?.externalRef||'New observation')+' · original case version '+draft.expectedVersion+'</p>'+
      (draft.reconciledRecord?'<section class="cash-account-reconciliation"><h5>Current original observation</h5><p>Compare the current record with the retained input before reviewing this change again.</p><pre>'+esc(pretty(draft.reconciledRecord))+'</pre></section>':'')+
      (draft.before?'<details><summary>Original observation before this change</summary><pre>'+esc(pretty(draft.before))+'</pre></details>':'')+
      '<form data-ca-editor><div class="cash-account-fields">'+fields+field(correcting||isVoid?'Reason for this correction':'Recording note','draftReason',draft.reason||'',{area:true,wide:true,required:correcting||isVoid})+'</div><div class="cash-account-actions">'+button(correcting?'Review correction and financial impact':'Review original change','review')+button('Download complete desk','download-desk',{always:true})+button('Download and close draft','close-draft')+'</div></form>'+previewView()+'</section>';
  }
  function pendingView(){
    const pending=session.pending;if(!pending)return '';
    return '<section class="cash-account-pending"><h4>'+esc(pending.rejected?'Original change needs review':'Continue original cash change')+'</h4><p>'+esc(pendingActorProblem(pending.body)?.message||pending.problem?.message||'The complete original request is retained until its result is available.')+'</p>'+
      pairs([['Prepared',date(pending.preparedAt)],['Action',pending.kind==='correction'?'Cash correction':title(pending.body.action)],['Request',pending.body.requestId]])+
      '<div class="cash-account-actions">'+button('Resume original request','retry')+(pending.rejected?button('Review against current case','reopen-rejected'):'')+button('Download complete desk','download-desk',{always:true})+'</div><details><summary>Retained original request</summary><pre>'+esc(pretty(pending.body))+'</pre></details></section>';
  }
  function render(){
    if(!available())return;
    const selection=session.selection;
    root.innerHTML='<div class="cash-account-heading"><div><h3>Cash movements</h3><p>Original cash, invoice allocations, corrections and source documents in one retained account.</p></div><div class="cash-account-actions">'+button('Record cash movement','new',{disabled:!editable()||!!session.draft})+button('Refresh case','refresh')+'</div></div>'+
      '<div class="cash-account-fields cash-account-selection">'+field('From date','select.startDate',selection.startDate,{type:'date'})+field('Through date','select.endDate',selection.endDate,{type:'date',required:true})+
      field('Network','select.network',JSON.stringify(selection.network??null),{options:dimensions('network')})+field('Currency','select.currency',JSON.stringify(selection.currency??null),{options:dimensions('currency')})+field('Asset','select.asset',JSON.stringify(selection.asset??null),{options:dimensions('asset')})+'</div>'+
      '<div class="cash-account-actions">'+button('Open account','load')+button('Download complete account','export',{disabled:!report})+button('Download account data','download-report',{disabled:!report,always:true})+button('Download desk input','download-desk',{always:true})+button('Open desk input','open-desk')+(boundStaff?button('Find earlier browser copy','legacy-inspect'):'')+'</div>'+
      '<p data-ca-status role="status" aria-live="polite"></p><div data-ca-conflict hidden class="cash-account-reconciliation">'+button('Open saved desk and retain this input','open-saved',{always:true})+'</div>'+
      legacyView()+pendingView()+editor()+
      (report?summary()+'<nav class="cash-account-tabs" aria-label="Cash account sections">'+[['transactions','Transactions'],['accounts','Accounts'],['balances','Balances and allocations'],['corrections','Corrections'],['sources','Sources and history']].map(([id,name])=>'<button type="button" data-ca-action="panel" data-id="'+id+'" aria-pressed="'+(session.panel===id)+'">'+name+'</button>').join('')+'</nav>'+
        ({transactions,accounts,balances,corrections,sources}[session.panel]||transactions)():'<p>Open the selected account to review its original activity and balances.</p>')+
      '<input type="file" data-ca-desk-file hidden accept=".json,application/json"><input type="file" data-ca-source-file hidden>';
    controls();status();
  }
  async function loadReport(){
    const sequence=++loadSequence,selection=cleanSelection(session.selection),selectedId=session.selectedId||null,target=selectedId?record(selectedId):null;
    if(target){
      if(['network','currency','asset'].some(key=>selection[key]!==null&&selection[key]!==target[key]))
        for(const key of ['network','currency','asset'])selection[key]=target[key];
      if(selection.startDate&&target.date<selection.startDate)selection.startDate=target.date;
      if(!selection.endDate||target.date>selection.endDate)selection.endDate=target.date;
    }
    report=null;session.page=0;render();
    const query=new URLSearchParams({expectedVersion:String(current.program.version)});
    for(const [key,value] of Object.entries(selection))if(value!==null)query.set(key,value);
    const value=await api(prefix+'/cash-account?'+query);
    if(!available()||sequence!==loadSequence)return;
    if(value.schema!==REPORT_SCHEMA||value.case.id!==caseId||value.case.version!==current.program.version)throw new Error('The account differs from the selected original case.');
    report=value;session.selection={...value.selection,startDate:value.selection.startDate||''};
    session.selectedId=value.transactions.some(row=>row.id===selectedId)?selectedId:null;
    notice='Opened the original account through '+date(value.selection.endDate)+'.';schedule();render();
  }
  async function run(action){
    if(busy||hostBusy||!available())return;busy=true;error='';controls();status();
    try{await action();}catch(problem){if(available())error=problem.message||String(problem);}
    finally{if(available()){busy=false;render();}}
  }
  function startDraft(kind,id){
    if(session.draft||session.pending)throw new Error('Finish or download and close the retained draft first.');
    const before=id?record(id):null;
    if(id&&(!before||!['OBSERVED','VOID'].includes(before.state)||(kind==='void'&&before.state!=='OBSERVED')))throw new Error('Select the original cash observation; an active observation is required for voiding.');
    const data=before?nativeCash(before):{date:today(),direction:'IN',category:'OTHER',currency:'USD',network:'',asset:'',amount:'',usdValue:null,externalRef:'',tranche:null,allocations:[],sourceIds:[],sourceNote:'',valuationSourceIds:[],valuationNote:''};
    session.draft={draftId:crypto.randomUUID(),kind,originalCashId:before?.id||null,before:before?clone(before):null,data,reason:'',expectedVersion:current.program.version,selection:cleanSelection(report?.selection||session.selection)};
    session.reviewed=null;session.result=null;schedule();render();
  }
  function setField(path,value){
    if(path==='draftReason'){session.draft.reason=value;return;}
    const bits=path.split('.');let target=session.draft.data;
    for(const bit of bits.slice(0,-1))target=target[bit];
    const key=bits.at(-1);target[key]=key==='tranche'?(value===''?null:Number(value)):key==='usdValue'&&value===''?null:value;
  }
  function previewBody(){
    const draft=session.draft;
    return {expectedVersion:draft.expectedVersion,selection:clone(draft.selection),originalCashId:draft.originalCashId,replacement:clone(draft.data),reason:draft.reason||''};
  }
  async function review(){
    if(!$('[data-ca-editor]')?.reportValidity())return;
    const draft=session.draft;if(draft.kind==='correction'){
      const body=previewBody(),preview=await api(prefix+'/cash-correction-preview',body);
      if(!available())return;
      session.reviewed={kind:'correction',body,preview};render();
    }else{
      session.reviewed={kind:'command',body:{expectedVersion:draft.expectedVersion,action:draft.kind==='void'?'cash.void':'cash.record',data:draft.kind==='void'?{id:draft.originalCashId}:clone(draft.data),note:draft.reason||''}};render();
    }
  }
  async function prepareRequest(kind,body,after={}){
    body={...clone(body),actor:recordingActor()};
    body.requestId=await mutationId('operations:'+caseId+':'+(kind==='correction'?'cash-correction':'command'),body);
    session.pending={kind,body,after,preparedAt:new Date().toISOString()};if(!await persist())download(state(),caseId+'-cash-original-request.json');render();await dispatch();
  }
  async function dispatch(){
    const pending=session.pending;if(!pending)return;busy=true;error='';render();
    try{
      const problem=pendingActorProblem(pending.body);if(problem)throw problem;
      const result=await saveApi(prefix+(pending.kind==='correction'?'/cash-correction':'/command'),clone(pending.body));
      const expectedAction=pending.kind==='correction'?'cash.correction':pending.body.action;
      if(result.id!==caseId||result.action!==expectedAction)throw new Error('The result differs from the retained original cash request.');
      session.result=clone(result);session.pending=null;session.reviewed=null;
      if(pending.body.action==='source.add'&&session.previousRequest?.body?.action==='source.add'&&!session.previousRequest.recovered&&session.previousRequest.after?.draftId===pending.after?.draftId&&pretty(session.previousRequest.body.data)===pretty(pending.body.data))
        session.previousRequest.recovered={requestId:pending.body.requestId,result:clone(result),recordedAt:new Date().toISOString()};
      if(pending.after?.kind==='source'&&session.draft?.draftId===pending.after?.draftId){
        session.draft.data.sourceIds||=[];if(!session.draft.data.sourceIds.includes(result.recordId))session.draft.data.sourceIds.push(result.recordId);session.draft.expectedVersion=result.version;
      }else if(pending.after?.kind==='draft'&&session.draft?.draftId===pending.after?.draftId)session.draft=null;
      if(result.replacementCashId||result.recordId)session.selectedId=result.replacementCashId||result.recordId;
      await persist();
      if(available()){const next=await api(prefix);await onCase(next,result);}
    }catch(problem){
      pending.problem={message:problem.message||String(problem),status:problem.status||null,code:problem.code||null};pending.rejected=[400,409,413,415,422].includes(problem.status)&&typeof problem.code==='string';
      if(session.pending===pending)await persist();if(available())error=pending.problem.message;
    }finally{if(available()){busy=false;render();}}
  }
  function validateDesk(value){
    if(value?.schema!==DESK_SCHEMA||value.caseId!==caseId||!value.selection||typeof value.selection!=='object')throw new Error('Open this case’s complete cash desk. Import an account ZIP before receiving a different case.');
    const pending=value.pending;
    if(pending&&(!['command','correction'].includes(pending.kind)||!pending.body||typeof pending.body.requestId!=='string'||
      (pending.kind==='command'&&!['cash.record','cash.void','source.add'].includes(pending.body.action))||
      (pending.kind==='correction'&&typeof pending.body.originalCashId!=='string')))throw new Error('The desk must retain its complete original cash request.');
    if(value.draft&&(!['new','void','correction'].includes(value.draft.kind)||!value.draft.data||typeof value.draft.draftId!=='string'))throw new Error('The complete editable cash draft is missing.');
  }
  async function openDesk(file){
    if(file.size>64*1024*1024)throw new Error('Open a complete cash desk up to 64 MiB.');
    const value=JSON.parse(await file.text());validateDesk(value);if(!available())return;
    const problem=pendingActorProblem(value.pending?.body);if(problem)throw problem;
    download(state(),caseId+'-cash-desk-before-open-'+Date.now()+'.json');
    const revision=session.storageRevision;restore(value);session.storageRevision=revision;report=null;render();await persist();if(!available())return;await loadReport();notice='Opened the complete cash input and its retained request.';
  }
  root.addEventListener('input',event=>{
    if(session.pending)return;const node=event.target,key=node.dataset.caField;if(!key||node.tagName==='SELECT')return;
    if(key==='filter.query'){
      const cursor=node.selectionStart;session.filters||={};session.filters.query=node.value;session.page=0;render();const input=$('[data-ca-field="filter.query"]');input?.focus();try{input?.setSelectionRange(cursor,cursor);}catch{}schedule();return;
    }
    if(key.startsWith('select.')||key.startsWith('filter.')||!session.draft)return;
    setField(key,node.value);session.reviewed=null;schedule();const review=$('.cash-account-review');if(review)review.remove();
  });
  root.addEventListener('change',event=>{
    const node=event.target;if(session.pending)return;
    if(node.matches('[data-ca-desk-file]')){const file=node.files?.[0];node.value='';if(file)run(()=>openDesk(file));return;}
    if(node.matches('[data-ca-source-file]')){
      const file=node.files?.[0];node.value='';if(!file)return;
      run(async()=>{
        if(!file.size||file.size>8*1024*1024)throw new Error('Attach a nonempty original source up to 8 MiB.');
        const data={filename:file.name,mediaType:file.type.split(';')[0]||'application/octet-stream',kind:'payment',contentBase64:b64(await file.arrayBuffer()),observedAt:new Date().toISOString()};
        await prepareRequest('command',{expectedVersion:session.draft?.expectedVersion??current.program.version,action:'source.add',data,note:'Retain original cash source document.'},{kind:'source',draftId:session.draft?.draftId});
      });return;
    }
    if(node.matches('[data-ca-period-only]')){session.filters||={};session.filters.periodOnly=node.checked;session.page=0;schedule();render();return;}
    const key=node.dataset.caField;if(!key)return;
    if(key.startsWith('select.')){const selectedKey=key.slice(7);session.selection[selectedKey]=['network','currency','asset'].includes(selectedKey)?JSON.parse(node.value):node.value;report=null;loadSequence++;session.selectedId=null;session.page=0;schedule();render();return;}
    if(key.startsWith('filter.')){session.filters||={};session.filters[key.slice(7)]=node.value;session.page=0;schedule();render();return;}
    if(!session.draft)return;setField(key,node.multiple?Array.from(node.selectedOptions).map(option=>option.value):node.value);session.reviewed=null;root.querySelector('.cash-account-review')?.remove();schedule();
  });
  root.addEventListener('submit',event=>event.preventDefault());
  root.addEventListener('click',event=>{
    const node=event.target.closest('[data-ca-action]');if(!node||node.disabled)return;const action=node.dataset.caAction,id=node.dataset.id;
    if(action==='download-desk'){download(state(),caseId+'-cash-desk.json');return;}
    if(action==='download-report'&&report){download(report,caseId+'-cash-account.json');return;}
    if(action==='legacy-download'&&legacyCopy){download(legacyCopy,caseId+'-earlier-cash-desk.json');return;}
    if(busy||hostBusy)return;
    if(action==='retry'){dispatch();return;}
    if(action==='legacy-inspect'){run(inspectLegacy);return;}
    if(action==='legacy-open'){run(openLegacy);return;}
    if(action==='legacy-close'){legacyCopy=null;legacySearched=false;render();return;}
    if(action==='open-saved'){run(async()=>{
      clearTimeout(saveTimer);await session.storageWrites.catch(()=>{});const saved=await ownStored(caseId);if(!available())return;validateDesk(saved);
      download(state(),caseId+'-cash-desk-local-'+Date.now()+'.json');restore(saved);await loadReport();notice='Retained this tab’s complete input as a download and opened the saved desk.';
    });return;}
    if(action==='reopen-rejected'&&session.pending?.rejected){run(async()=>{
      const next=await api(prefix),pending=session.pending;session.previousRequest=clone(pending);session.pending=null;session.reviewed=null;
      if(session.draft){session.draft.expectedVersion=next.program.version;session.draft.reconciledRecord=session.draft.originalCashId?clone(next.records.cash.find(row=>row.id===session.draft.originalCashId)||null):null;}
      await persist();await onCase(next,{version:next.program.version,action:'reconcile'});
    });return;}
    if(session.pending)return;
    if(action==='forecast-continuation'||action==='download-forecast-continuation'){
      const row=report?.forecastContinuations?.[Number(id)];
      if(!row?.inputs)return;
      if(action==='download-forecast-continuation')download(row.inputs,caseId+'-'+row.forecastId+'-current-inputs.json');
      else onOpen('forecast',{inputs:clone(row.inputs),source:clone(row)});
      return;
    }
    if(['supplier-account','performance','forecast','completion','statements'].includes(action)){onOpen(action);return;}
    if(action==='account'||action==='all-accounts'){
      const selected=action==='account'?report?.accounts.find(row=>row.key===id):{network:null,currency:null,asset:null};
      if(!selected)return;
      for(const key of ['network','currency','asset'])session.selection[key]=selected[key];
      session.selectedId=null;session.panel='transactions';run(loadReport);return;
    }
    if(action==='panel'){session.panel=id;session.page=0;schedule();render();return;}
    if(action==='previous'||action==='next'){session.page+=action==='next'?1:-1;render();return;}
    if(action==='load'){run(loadReport);return;}
    if(action==='refresh'){run(async()=>{const next=await api(prefix);await onCase(next,{version:next.program.version,action:'refresh'});});return;}
    if(action==='detail'){run(async()=>{if(!record(id))throw new Error('The original cash observation is unavailable in this case.');session.panel='transactions';session.selectedId=id;session.filters={query:'',state:'',direction:'',category:'',periodOnly:false};await loadReport();});return;}
    if(action==='close-detail'){session.selectedId=null;schedule();render();return;}
    if(action==='download-record'){const original=record(id);if(original)download(original,id+'.json');return;}
    if(action==='source'){run(async()=>{const response=await api(prefix+'/sources/'+id,undefined,{download:true});download(await response.blob(),sourceName(id));});return;}
    if(action==='new'||action==='correct'||action==='void'){run(()=>startDraft(action==='correct'?'correction':action,id));return;}
    if(action==='open-desk'){$('[data-ca-desk-file]').click();return;}
    if(action==='attach-source'){$('[data-ca-source-file]').click();return;}
    if(action==='retained-source'&&session.previousRequest?.body?.action==='source.add'&&!session.previousRequest.recovered&&session.previousRequest.after?.draftId===session.draft?.draftId){run(()=>prepareRequest('command',{expectedVersion:session.draft.expectedVersion,action:'source.add',data:clone(session.previousRequest.body.data),note:'Retain original cash source document.'},{kind:'source',draftId:session.draft.draftId}));return;}
    if(action==='export'&&report){run(async()=>{
      const query=new URLSearchParams({expectedVersion:String(report.case.version),expectedReportSha256:report.reportSha256});
      for(const [key,value] of Object.entries(cleanSelection(report.selection)))if(value!==null)query.set(key,value);
      const response=await api(prefix+'/cash-account/export.zip?'+query,undefined,{download:true});download(await response.blob(),caseId+'-cash-account.zip');
    });return;}
    if(!session.draft)return;
    if(action==='close-draft'){download(state(),caseId+'-cash-desk-closed-'+Date.now()+'.json');session.draft=null;session.reviewed=null;schedule();render();return;}
    if(action==='add-allocation'){session.draft.data.allocations.push({invoiceId:'',amountUsd:''});session.reviewed=null;schedule();render();return;}
    if(action==='remove-allocation'){session.draft.data.allocations.splice(Number(id),1);session.reviewed=null;schedule();render();return;}
    if(action==='review'){if($('[data-ca-editor]')?.reportValidity())run(review);return;}
    if(action==='download-preview'&&session.reviewed?.kind==='correction'){download(session.reviewed.preview,caseId+'-cash-correction-preview.json');return;}
    if(action==='save'&&session.reviewed){run(async()=>{
      const reviewed=session.reviewed,draft=session.draft;
      if(reviewed.kind==='correction'){
        if(pretty(reviewed.body)!==pretty(previewBody()))throw new Error('Review the current correction before saving.');
        if(reviewed.preview.canApply===false)throw new Error('Resolve the original correction findings before saving.');
        await prepareRequest('correction',{...reviewed.body,expectedPreviewSha256:reviewed.preview.previewSha256},{kind:'draft',draftId:draft.draftId});
      }else{
        const expected={expectedVersion:draft.expectedVersion,action:draft.kind==='void'?'cash.void':'cash.record',data:draft.kind==='void'?{id:draft.originalCashId}:clone(draft.data),note:draft.reason||''};
        if(pretty(reviewed.body)!==pretty(expected))throw new Error('Review the current original cash input before saving.');
        await prepareRequest('command',reviewed.body,{kind:'draft',draftId:draft.draftId});
      }
    });}
  });
  async function initialize(){
    if(!session.initialized){
      session.initializing||=(async()=>{
        try{const previous=await ownStored(caseId);session.storageRevision=Number.isSafeInteger(previous?._storedRevision)?previous._storedRevision:0;if(previous?.schema===DESK_SCHEMA&&previous.caseId===caseId){validateDesk(previous);restore(previous);}}
        catch{storageNote='Browser draft storage is unavailable. Download the complete desk to retain original input.';}
        session.initialized=true;
      })();
      await session.initializing;
    }
    await session.storageWrites.catch(()=>{});
    if(!available())return;
    if(session.incomingAccount){
      const incoming=session.incomingAccount;
      if(incoming.selection){session.selection=cleanSelection(incoming.selection);session.selectedId=null;}
      if(incoming.cashId)session.selectedId=incoming.cashId;
      session.panel='transactions';session.page=0;delete session.incomingAccount;
    }
    render();await loadReport();render();
  }
  const ready=initialize().catch(problem=>{if(available())throw problem;});
  return {ready,setHostBusy(value){hostBusy=!!value;controls();},dispose(){active=false;loadSequence++;clearTimeout(saveTimer);if(session.initialized)persist();}};
}
