// MIT. Group the original saved statement packets into one handover per customer.
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA256=/^[a-f0-9]{64}$/;
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const human=value=>String(value??'').replace(/[_-]+/g,' ').toLowerCase().replace(/^./,char=>char.toUpperCase());
const date=value=>{
  const parsed=new Date(value??'');
  return Number.isFinite(parsed.getTime())?new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(parsed)+' UTC':'Not recorded';
};
const status=value=>({RETAINED:'Current',SUPERSEDED:'Superseded',WITHDRAWN:'Withdrawn',DELIVERED:'Packet complete',REVIEWED:'Ready to issue',NOT_RETAINED:'Ready to issue',EXPORT_PENDING:'Finish statement packet',REVIEW_REQUIRED:'Review changed sources',RECONCILE_PENDING:'Resume original statement',SENDING:'Issuing statement'}[value]??human(value));
const active=cycle=>['RUNNING','QUEUED'].includes(cycle?.job?.phase);
const period=row=>row.servicePeriod?date(row.servicePeriod.from)+' → '+date(row.servicePeriod.until):row.usageSource?'Cumulative at '+date(row.usageSource.createdAt):'Purchase statement';
const passLabels=row=>{
  if(row.plan)return [[row.plan.label,row.plan.orderLabel,row.plan.orderRef].filter((value,index,all)=>value&&all.indexOf(value)===index).join(' · ')];
  if(row.passes?.length)return row.passes.map(item=>[item.plan?.label,item.label,item.orderRef].filter((value,index,all)=>value&&all.indexOf(value)===index).join(' · '));
  const period=row.servicePeriod;
  return [[period?.planLabel,period?.orderRef].filter(Boolean).join(' · ')||'Original customer purchases'];
};
const pass=row=>passLabels(row).join('; ');
const passHtml=row=>{
  const labels=passLabels(row);
  return labels.length>1?'<details class="dossier-passes"><summary>'+labels.length+' purchased passes</summary><ul>'+labels.map(label=>'<li>'+escape(label)+'</li>').join('')+'</ul></details>':escape(labels[0]);
};
function signature(cycle){
  return JSON.stringify([cycle.cycleId,cycle.manifestSha256,cycle.phase,cycle.job?.phase,cycle.job?.finishedAt,
    (cycle.rows??[]).map(row=>[row.requestId,row.phase,row.statement?.id,row.statement?.status,row.delivery?.complete,row.delivery?.observedStatus,
      row.delivery?.statusFile?.sha256,row.delivery?.indexFile?.sha256,row.delivery?.files?.map(file=>[file.name,file.sha256])])]);
}
function validateGroups(value,cycle){
  if(value?.schema!=='stellar-forge.accounting-statement-customer-dossier-groups.v1'||value.cycle?.cycleId!==cycle.cycleId||!Array.isArray(value.customers))
    throw new Error('The saved customer groups could not be read. Reload this cycle.');
  const ids=new Set();
  for(const customer of value.customers){
    if(!UUID.test(customer.customerId??'')||ids.has(customer.customerId)||!Array.isArray(customer.rows)||!Array.isArray(customer.rowIndexes)||
      !Number.isSafeInteger(customer.counts?.total)||!Number.isSafeInteger(customer.counts?.delivered)||customer.counts.total!==customer.rows.length||
      customer.counts.delivered<0||customer.counts.delivered>customer.counts.total)
      throw new Error('The saved customer groups are incomplete. Reload this cycle.');
    ids.add(customer.customerId);
  }
  return value;
}
function packetLinks(value,key,id){
  if(value?.schema!=='stellar-forge.accounting-statement-customer-dossier.v1'||value.customer?.customerId!==id||!SHA256.test(value.snapshotSha256??''))
    throw new Error('The prepared packet does not match this customer.');
  const base='/api/cycles/'+encodeURIComponent(key)+'/customers/'+id+'/snapshots/'+value.snapshotSha256;
  if(value.indexHref!==base+'/file/index.html'||value.downloadHref!==base+'/download')
    throw new Error('The prepared packet has an unexpected download address.');
  return {indexHref:value.indexHref,downloadHref:value.downloadHref,complete:value.complete===true,counts:value.counts,snapshotSha256:value.snapshotSha256,totalBytes:value.totalBytes};
}
export function createCustomerDossierUi({api,notice,showError,clearError}){
  const container=document.getElementById('cycle-detail'),cache=new Map();let current=null,closed=false;
  const panel=()=>document.getElementById('customer-dossiers');
  function captureFocus(){
    const node=document.activeElement;
    if(!node||!panel()?.contains(node)||!node.dataset.dossierFocus)return null;
    return {key:node.dataset.dossierFocus,start:node.selectionStart,end:node.selectionEnd};
  }
  function restoreFocus(saved){
    if(!saved)return;
    const node=[...(panel()?.querySelectorAll('[data-dossier-focus]')??[])].find(item=>item.dataset.dossierFocus===saved.key);
    if(!node||node.disabled)return;node.focus({preventScroll:true});
    if(typeof saved.start==='number'&&node.setSelectionRange)node.setSelectionRange(saved.start,saved.end);
  }
  function entryFor(cycle){
    let entry=cache.get(cycle.key);
    if(!entry){entry={key:cycle.key,signature:null,groups:null,error:null,loading:null,query:'',page:0,open:new Set(),prepared:new Map(),busy:new Set(),message:''};cache.set(cycle.key,entry);}
    const next=signature(cycle);
    if(entry.signature!==next){entry.signature=next;entry.groups=null;entry.error=null;entry.loading=null;entry.prepared.clear();entry.message='';}
    return entry;
  }
  function visible(entry){
    const query=entry.query.trim().toLowerCase();
    return (entry.groups?.customers??[]).filter(customer=>!query||
      [customer.name,customer.reference,...customer.rows.flatMap(row=>[row.statement?.number,pass(row),period(row)])].join(' ').toLowerCase().includes(query));
  }
  function rowsHtml(customer){
    return '<div class="table-wrap"><table><caption class="visually-hidden">Saved statements for '+escape(customer.name)+'</caption><thead><tr><th>Pass or purchases</th><th>Service period</th><th>Statement</th><th>Packet</th></tr></thead><tbody>'+
      customer.rows.map(row=>'<tr><td>'+passHtml(row)+'</td><td>'+escape(period(row))+'</td><td>'+escape(row.statement?.number??'Awaiting issue')+
        (row.statement?'<small>'+escape(status(row.statement.status))+'</small>':'')+
        (row.statement?.replacesId?'<small>Correction of an earlier statement</small>':'')+
        '</td><td>'+escape(row.ready?'Complete':status(row.phase)||'Pending')+'</td></tr>').join('')+'</tbody></table></div>';
  }
  function customerHtml(customer,entry){
    const id=customer.customerId,counts=customer.counts,prepared=entry.prepared.get(id),busy=entry.busy.has(id),open=entry.open.has(id);
    const detail=[counts.delivered+' of '+counts.total+' statement packets complete'];
    if(counts.superseded)detail.push(counts.superseded+' superseded');
    if(counts.withdrawn)detail.push(counts.withdrawn+' withdrawn');
    const label=customer.complete?'Download customer packet':'Download available statements';
    let actions='';
    if(counts.delivered){
      if(prepared)actions='<a class="button-link" data-dossier-focus="download-'+id+'" href="'+escape(prepared.downloadHref)+'">'+escape(label)+'</a>'+
        '<a class="button-link" data-dossier-focus="prepare-'+id+'" href="'+escape(prepared.indexHref)+'" target="_blank" rel="noopener">Open customer packet</a>';
      else actions='<button type="button" data-dossier-action="download" data-customer="'+id+'" data-dossier-focus="download-'+id+'"'+(busy?' disabled':'')+'>'+escape(busy?'Preparing customer packet…':label)+'</button>'+
        '<button type="button" data-dossier-action="prepare" data-customer="'+id+'" data-dossier-focus="prepare-'+id+'"'+(busy?' disabled':'')+'>Prepare preview</button>';
    }
    return '<article class="customer-dossier"><div class="customer-dossier-heading"><div><h4>'+escape(customer.name)+'</h4><p class="hint">'+escape(customer.reference)+'</p><p class="dossier-counts">'+escape(detail.join(' · '))+'</p></div><div class="row-actions">'+actions+'</div></div>'+
      (counts.pending?'<p class="hint dossier-pending">'+escape(counts.pending)+' statement'+(counts.pending===1?' is':'s are')+' still in progress. Resume this cycle to complete '+(counts.pending===1?'it':'them')+'.</p>':'')+
      (prepared?'<p class="hint dossier-prepared">Saved customer packet · '+Number(prepared.totalBytes??0).toLocaleString()+' bytes · includes the statement register and original customer files</p>':'')+
      '<details data-dossier-customer="'+id+'"'+(open?' open':'')+'><summary data-dossier-focus="customer-'+id+'">Passes, periods and statement status ('+counts.total+')</summary><div class="dossier-rows">'+(open?rowsHtml(customer):'')+'</div></details></article>';
  }
  function render(entry,{focus=captureFocus()}={}){
    const target=panel();if(!target||!current||entry.key!==current.key||closed)return;
    let html='<div class="section-heading"><div><h3>Customer handover</h3><p class="hint">One packet for each customer, with every saved pass and statement period in this cycle.</p></div></div>';
    if(active(current)){
      target.innerHTML=html+'<p class="hint">Customer downloads update when the active closing operation finishes. Statement progress remains visible below.</p>';return;
    }
    if(!entry.groups){
      html+=entry.error?'<p class="problem" role="alert">'+escape(entry.error.message)+'</p><button type="button" data-dossier-action="reload" data-dossier-focus="reload">Retry customer list</button>':
        '<p class="hint" role="status">Reading saved customer packets…</p>';
      target.innerHTML=html;restoreFocus(focus);return;
    }
    const customers=visible(entry),pages=Math.max(1,Math.ceil(customers.length/25));entry.page=Math.min(entry.page,pages-1);
    const start=entry.page*25,part=customers.slice(start,start+25),all=entry.groups.customers;
    html+='<div class="dossier-controls"><label>Find a customer, pass or statement<input type="search" data-dossier-search data-dossier-focus="search" value="'+escape(entry.query)+'" placeholder="Customer, reference, pass or statement"></label><p class="hint">'+
      all.length+' customer'+(all.length===1?'':'s')+' · '+all.filter(customer=>customer.complete).length+' complete</p></div>'+
      '<p class="hint">Statement status comes from the saved cycle. Use Refresh delivered statements above to retrieve later corrections and withdrawals.</p>'+
      '<p class="dossier-message hint" role="status" aria-live="polite">'+escape(entry.message)+'</p>';
    html+=part.length?part.map(customer=>customerHtml(customer,entry)).join(''):'<div class="empty">'+(all.length?'No customers match this search.':'This cycle has no customer statements.')+'</div>';
    if(customers.length>25)html+='<div class="pagination"><button type="button" data-dossier-action="previous" data-dossier-focus="previous"'+(entry.page===0?' disabled':'')+'>Previous customers</button><span>'+escape((start+1)+'–'+Math.min(customers.length,start+25)+' of '+customers.length)+'</span><button type="button" data-dossier-action="next" data-dossier-focus="next"'+(entry.page===pages-1?' disabled':'')+'>Next customers</button></div>';
    target.innerHTML=html;restoreFocus(focus);
  }
  async function load(entry,cycle){
    if(entry.loading)return entry.loading;
    const expected=entry.signature;
    const promise=api('/api/cycles/'+encodeURIComponent(entry.key)+'/customers').then(value=>{
      if(entry.signature!==expected||closed)return;
      entry.groups=validateGroups(value,cycle);entry.error=null;
    }).catch(error=>{if(entry.signature===expected&&!closed)entry.error=error;}).finally(()=>{
      if(entry.loading===promise)entry.loading=null;
      if(entry.signature===expected&&current?.key===entry.key&&!closed)render(entry);
    });
    entry.loading=promise;return promise;
  }
  function mount(cycle,{focus=null}={}){
    current=cycle;if(!panel()||closed)return;
    const entry=entryFor(cycle);render(entry,{focus});
    if(!active(cycle)&&!entry.groups&&!entry.error)void load(entry,cycle);
  }
  async function prepare(entry,id,download){
    const customer=entry.groups?.customers.find(item=>item.customerId===id);
    if(!customer||entry.busy.has(id)||active(current))return;
    const expected=entry.signature,cycleId=current.cycleId,focus=captureFocus();
    entry.busy.add(id);entry.message='Preparing the original statement files for '+customer.name+'…';clearError();render(entry);
    try{
      const value=await api('/api/cycles/'+encodeURIComponent(entry.key)+'/customers/'+id+'/export',{});
      if(value.cycle?.cycleId!==cycleId)throw new Error('The prepared customer packet belongs to another cycle.');
      const links=packetLinks(value,entry.key,id);
      if(entry.signature!==expected||closed)return;
      entry.prepared.set(id,links);
      entry.message=customer.name+': '+(links.complete?'customer packet ready.':'available statements ready; the register lists unfinished rows.');
      if(current?.key===entry.key){
        render(entry,{focus});notice(entry.message);
        if(download){
          const link=document.createElement('a');link.href=links.downloadHref;link.hidden=true;link.download='';document.body.append(link);link.click();link.remove();
        }
      }
    }catch(error){
      if(entry.signature===expected){entry.message=error.message;if(current?.key===entry.key&&!closed)showError(error);}
    }finally{
      entry.busy.delete(id);if(entry.signature===expected&&current?.key===entry.key&&!closed)render(entry,{focus});
    }
  }
  const onClick=event=>{
    const button=event.target.closest('[data-dossier-action]');
    if(!button||!panel()?.contains(button)||!current)return;
    const entry=cache.get(current.key);if(!entry)return;
    const action=button.dataset.dossierAction;
    if(action==='previous'||action==='next'){entry.page+=action==='next'?1:-1;render(entry);return;}
    if(action==='reload'){entry.error=null;render(entry);void load(entry,current);return;}
    if(action==='prepare'||action==='download')void prepare(entry,button.dataset.customer,action==='download');
  };
  const onInput=event=>{
    if(!event.target.hasAttribute('data-dossier-search')||!panel()?.contains(event.target)||!current)return;
    const entry=cache.get(current.key);entry.query=event.target.value;entry.page=0;render(entry);
  };
  const onToggle=event=>{
    const details=event.target;
    if(!details.matches?.('[data-dossier-customer]')||!panel()?.contains(details)||!current)return;
    const entry=cache.get(current.key),id=details.dataset.dossierCustomer;
    if(details.open){
      entry.open.add(id);const rows=details.querySelector('.dossier-rows'),customer=entry.groups?.customers.find(item=>item.customerId===id);
      if(customer&&!rows.childElementCount)rows.innerHTML=rowsHtml(customer);
    }else entry.open.delete(id);
  };
  container.addEventListener('click',onClick);container.addEventListener('input',onInput);container.addEventListener('toggle',onToggle,true);
  return {mount,captureFocus,close(){closed=true;container.removeEventListener('click',onClick);container.removeEventListener('input',onInput);container.removeEventListener('toggle',onToggle,true);cache.clear();}};
}
