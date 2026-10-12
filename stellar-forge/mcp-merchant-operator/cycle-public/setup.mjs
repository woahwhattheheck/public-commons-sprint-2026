// MIT. Complete customer setup and statement lifecycle in the existing closing workbench.
export function createCustomerSetup({getState,api,notice,showError,clearError,refreshInventory,addCorrection}){
  const $=id=>document.getElementById(id),escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const pretty=value=>JSON.stringify(value,null,2);
  const date=value=>{const parsed=value?new Date(value):null;return parsed&&Number.isFinite(parsed.getTime())?new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(parsed)+' UTC':'Not recorded';};
  const names={save:'Customer profile',assign:'Order assignments',usage_import:'Service capture import',withdraw:'Statement withdrawal'};
  const statuses={RETAINED:'Issued',SUPERSEDED:'Corrected',WITHDRAWN:'Withdrawn',PREPARED:'Ready to apply',PREPARING:'Finish saving changes',SENDING:'Applying changes',UNOBSERVED_REPLY:'Check saved result',NOT_OBSERVED:'Change not observed',OBSERVED:'Recorded',UNREADABLE:'Needs attention',RUNNING:'Working',QUEUED:'Waiting for active changes',FINISHED:'Recorded',ERROR:'Needs attention'};
  const state={tab:'customers',configuration:null,source:null,profile:null,profileRevision:null,operation:null,operations:[],poll:null,refreshed:null,pending:{},tablePages:new Map(),tables:new Map(),restored:false,loaded:false};
  const shared=()=>getState(),inventory=()=>shared().inventory??{customers:[],bindings:[],usage:[],statements:[],runs:[]};
  const active=row=>['QUEUED','RUNNING'].includes(row?.job?.phase);
  const storedKey=()=> 'customer-setup-draft:'+shared().context.draftScope;
  const customer=id=>inventory().customers.find(row=>row.id===id);
  const label=id=>{const row=customer(id);return row?row.name+' · '+row.reference:'Customer record unavailable';};
  const empty=value=>value===null||value===undefined||value===''?'Not recorded':String(value);
  const button=(name,value,text)=>'<button type="button" data-'+name+'="'+escape(value)+'">'+escape(text)+'</button>';
  function optionList(items,selected,first,text){
    return '<option value="">'+escape(first)+'</option>'+(!selected||items.some(row=>row.id===selected)?'':'<option value="'+escape(selected)+'" selected>Saved choice unavailable — select a current record</option>')+
      items.map(row=>'<option value="'+escape(row.id)+'"'+(row.id===selected?' selected':'')+'>'+escape(text(row))+'</option>').join('');
  }
  function options(id,items,first,text){const control=$(id),selected=control.value;control.innerHTML=optionList(items,selected,first,text);}
  function table(id,rows,render,columns,message){
    state.tables.set(id,{rows,render,columns,message});const page=Math.min(state.tablePages.get(id)??0,Math.max(0,Math.ceil(rows.length/75)-1));state.tablePages.set(id,page);
    $(id).innerHTML=rows.length?rows.slice(page*75,page*75+75).map(render).join(''):'<tr><td colspan="'+columns+'"><div class="empty">'+escape(message)+'</div></td></tr>';
    let pager=$(id+'-pages');if(!pager){pager=document.createElement('div');pager.id=id+'-pages';pager.className='pagination';$(id).closest('.table-wrap').after(pager);}
    pager.hidden=rows.length<=75;pager.innerHTML='<button type="button" data-setup-page="'+id+'" data-delta="-1"'+(page===0?' disabled':'')+'>Previous</button><span>'+escape(rows.length?(page*75+1)+'–'+Math.min((page+1)*75,rows.length)+' of '+rows.length:'No records')+'</span><button type="button" data-setup-page="'+id+'" data-delta="1"'+((page+1)*75>=rows.length?' disabled':'')+'>Next</button>';
  }
  function draft(){
    return {profile:state.profile,profileRevision:state.profileRevision,pending:state.pending,
      fields:Object.fromEntries(['setup-profile-reference','setup-profile-name','setup-profile-email','setup-profile-address','setup-profile-note-input','setup-assign-customer','setup-assign-run','setup-assign-orders','setup-assign-reason','setup-import-name'].map(id=>[id,$(id).value])),
      reassign:$('setup-assign-reassign').checked};
  }
  function saveDraft(){if(!shared().context)return;try{localStorage.setItem(storedKey(),JSON.stringify(draft()));}catch{}}
  function restore(){
    if(state.restored||!shared().context)return;state.restored=true;
    try{const saved=JSON.parse(localStorage.getItem(storedKey())??'null');if(!saved)return;
      state.profile=saved.profile??null;state.profileRevision=saved.profileRevision??null;state.pending=saved.pending??{};
      for(const [id,value] of Object.entries(saved.fields??{}))if($(id)&&typeof value==='string')$(id).value=value;
      $('setup-assign-reassign').checked=saved.reassign===true;profileHeading();
    }catch{}
  }
  function tab(name){
    state.tab=name;
    for(const value of ['customers','usage','statements','operations'])$('setup-'+value+'-panel').hidden=value!==name;
    document.querySelectorAll('[data-setup-tab]').forEach(control=>control.setAttribute('aria-pressed',String(control.dataset.setupTab===name)));
    if(name==='operations')refreshOperations().catch(showError);
  }
  function profileHeading(){
    $('setup-profile-title').textContent=state.profile?'Edit customer':'New customer';
    $('setup-profile-note').textContent=state.profile?'Editing '+state.profile.name+' · '+state.profile.reference+'. Current issued statements retain their original customer details.':'Enter the customer details used on their statements.';
  }
  function editProfile(id){
    const row=id?customer(id):null;if(id&&!row)throw new Error('Refresh the workspace to edit this customer.');
    state.profile=row?{id:row.id,version:row.version,name:row.name,reference:row.reference}:null;
    state.profileRevision=inventory().revision??null;
    for(const [field,name] of [['reference','reference'],['name','name'],['email','email'],['address','address'],['note-input','note']])$('setup-profile-'+field).value=row?.[name]??'';
    delete state.pending.save;profileHeading();saveDraft();tab('customers');$('setup-profile-form').scrollIntoView({block:'start'});$('setup-profile-name').focus();
  }
  function renderCustomers(){
    const inv=inventory(),query=$('setup-customer-search').value.trim().toLowerCase();
    const rows=inv.customers.filter(row=>!query||(row.name+' '+row.reference+' '+row.email).toLowerCase().includes(query));
    table('setup-customer-rows',rows,row=>'<tr><td>'+escape(row.name)+'</td><td>'+escape(row.reference)+'</td><td>'+escape(empty(row.email))+'</td><td>'+escape(row.orders??inv.bindings.filter(binding=>binding.customerId===row.id).length)+'</td><td class="row-actions">'+button('setup-edit-customer',row.id,'Edit')+button('setup-customer-orders',row.id,'Assign orders')+'</td></tr>',5,'Add the first customer using the form below.');
    const selected=$('setup-assign-customer').value;
    const bindings=selected?inv.bindings.filter(row=>row.customerId===selected):inv.bindings;
    table('setup-binding-rows',bindings,row=>'<tr><td>'+escape(row.orderRef)+'</td><td>'+escape(empty(row.label))+'</td><td>'+escape(label(row.customerId))+'</td><td>'+escape(date(row.updatedAt))+'</td></tr>',4,'No orders are assigned to the selected customer.');
  }
  function renderUsage(){
    table('setup-usage-rows',inventory().usage,row=>'<tr><td>'+escape(row.name)+'</td><td>'+escape(date(row.sourceCreatedAt))+'</td><td>'+escape(row.orderCount)+'</td><td>'+escape(date(row.createdAt))+'</td><td><details><summary>Original source</summary><pre class="json-record">'+escape(pretty(row))+'</pre></details></td></tr>',5,'Imported service captures will appear here.');
  }
  function renderStatements(){
    const selected=$('setup-statement-customer').value,status=$('setup-statement-status').value;
    const rows=inventory().statements.filter(row=>(!selected||row.customerId===selected)&&(!status||row.status===status));
    table('setup-statement-rows',rows,row=>'<tr><td>'+escape(row.number)+'</td><td>'+escape(row.customerName)+'<small>'+escape(row.customerReference)+'</small></td><td>'+escape(row.servicePeriod?date(row.servicePeriod.from)+' – '+date(row.servicePeriod.until):row.from?date(row.from)+' – '+date(row.until):'Cumulative statement')+'</td><td><span class="status">'+escape(statuses[row.status]??row.status)+'</span></td><td>'+escape(date(row.createdAt))+'</td><td>'+button('setup-open-statement',row.id,'Open statement')+'</td></tr>',6,'No issued statements match these choices.');
  }
  function target(row){
    const args=row.arguments??{};
    return row.kind==='save'?(args.name||args.reference):row.kind==='assign'?label(args.customerId):row.kind==='usage_import'?(args.name||args.source):
      inventory().statements.find(item=>item.id===args.statementId)?.number??'Original statement';
  }
  function phase(row){return row.error?'Needs attention':statuses[active(row)||row.job?.phase==='ERROR'?row.job.phase:row.phase]??row.phase??'Needs attention';}
  function renderOperations(){
    table('setup-operation-rows',state.operations,row=>'<tr><td>'+escape(date(row.preparedAt))+'</td><td>'+escape(names[row.kind]??'Saved operation')+'</td><td>'+escape(target(row))+'</td><td>'+escape(phase(row))+'</td><td>'+button('setup-open-operation',row.id,'Open changes')+'</td></tr>',5,'Reviewed customer changes will be saved here.');
  }
  async function refreshOperations(){const result=await api('/api/setup/operations');state.operations=result.items;renderOperations();}
  async function refreshSources(){
    state.configuration=await api('/api/setup/configuration');
    const values=state.configuration.usageSources.map(source=>({id:source}));options('setup-usage-source',values,'Choose a configured capture',row=>row.id.replace(/[_-]+/g,' '));
    $('setup-preview-source').disabled=!values.length;
    if(!values.length)$('setup-source-preview').innerHTML='<p>No service capture sources are configured for this workspace. Configure the original capture files on the merchant host, then refresh sources.</p>';
  }
  function inventoryChanged(){
    if(!shared().inventory)return;
    options('setup-assign-customer',inventory().customers,'Choose a customer',row=>row.name+' · '+row.reference);
    options('setup-assign-run',inventory().runs,'No run comparison',row=>(row.name||'Accounting run')+' · '+date(row.completedAt||row.createdAt));
    options('setup-statement-customer',inventory().customers,'All customers',row=>row.name+' · '+row.reference);
    restore();renderCustomers();renderUsage();renderStatements();renderOperations();
  }
  async function show(){
    inventoryChanged();
    if(!state.loaded){state.loaded=true;await Promise.allSettled([refreshSources().catch(showError),refreshOperations().catch(showError)]);}
  }
  function reviewFields(args){
    return '<dl class="setup-definition">'+[['Customer reference',args.reference],['Customer name',args.name],['Email',args.email],['Postal address',args.address],['Internal note',args.note]].map(([name,value])=>'<div><dt>'+name+'</dt><dd>'+escape(empty(value))+'</dd></div>').join('')+'</dl>';
  }
  function renderOperation(row,review){
    const args=row.arguments??{},busy=active(row),observed=row.phase==='OBSERVED';state.operation=row;
    $('setup-operation-title').textContent=(observed?'Saved: ':'Review: ')+(names[row.kind]??'customer changes');
    let body='<div class="setup-operation-status"><span class="status">'+escape(phase(row))+'</span><span class="hint">Prepared '+escape(date(row.preparedAt))+'</span></div>';
    if(row.kind==='save')body+=reviewFields(args);
    if(row.kind==='assign'){
      body+='<h3>Assign '+args.orders.length+' orders to '+escape(label(args.customerId))+'</h3><p class="hint">'+escape(args.reassign?'Existing customer assignments may be moved with the recorded reason.':'Orders assigned to another customer keep the native reassignment requirement.')+'</p>';
      const items=review?.orders??args.orders;
      body+='<div class="table-wrap"><table><thead><tr><th>Original order</th><th>Description</th><th>Current customer at review</th><th>Run comparison</th></tr></thead><tbody>'+items.map(item=>'<tr><td>'+escape(item.orderRef)+'</td><td>'+escape(empty(item.label))+'</td><td>'+escape(item.currentCustomer?item.currentCustomer.name+' · '+item.currentCustomer.reference:item.binding?'Customer record unavailable':review?'Unassigned':'See current order directory')+'</td><td>'+escape(item.runReviewed?(item.purchaseEvents.length+' purchase event'+(item.purchaseEvents.length===1?'':'s')):'No run comparison')+'</td></tr>').join('')+'</tbody></table></div><p class="setup-field">Reason: '+escape(empty(args.reason))+'</p>';
      if(review?.run)body+='<p class="hint">Compared with '+escape(review.run.name||'Accounting run')+' · '+escape(date(review.run.completedAt))+'. Assignments preserve the original references; statement review determines which native purchases belong in the selected period.</p>';
    }
    if(row.kind==='usage_import')body+='<dl class="setup-definition"><div><dt>Capture name</dt><dd>'+escape(args.name||args.source)+'</dd></div><div><dt>Configured source</dt><dd>'+escape(args.source)+'</dd></div></dl><p>The merchant imports the exact capture inspected for this saved request. A changed source must be inspected and reviewed again.</p>';
    if(row.kind==='withdraw')body+='<h3>'+escape(target(row))+'</h3><p>This records a withdrawal of the issued statement. Its original statement files and history remain available.</p><div class="problem">'+escape(args.reason)+'</div>';
    const error=row.job?.error??row.error??row.state?.lookupError??row.state?.sendError;
    if(error&&!observed)body+='<div class="problem">'+escape(error.message)+'</div><p class="hint">Check the saved result after a lost response. If the original workspace or source has changed, use Edit these changes to review a new request.</p>';
    if(observed)body+='<p class="setup-field"><strong>The original merchant records show these saved changes.</strong></p>';
    body+='<details class="source-details"><summary>Original request and saved result</summary><pre>'+escape(pretty(row))+'</pre></details>';
    $('setup-operation-content').innerHTML=body;
    $('setup-apply-operation').disabled=busy||observed||Boolean(row.error);
    $('setup-apply-operation').textContent=row.state?.submissionAttempted?'Continue saved changes':'Apply changes';
    $('setup-reconcile-operation').disabled=busy||Boolean(row.error);
    $('setup-edit-operation').disabled=busy||!row.arguments;
    if(!$('setup-operation-dialog').open)$('setup-operation-dialog').showModal();
  }
  async function loadOperation(id,{poll=false,review}={}){
    if(!poll){clearTimeout(state.poll);state.operation={id};}
    const row=await api('/api/setup/operations/'+encodeURIComponent(id));
    if(state.operation?.id!==id||poll&&!$('setup-operation-dialog').open)return;renderOperation(row,review);
    const index=state.operations.findIndex(item=>item.id===id);if(index<0)state.operations.unshift(row);else state.operations[index]=row;renderOperations();
    if(active(row)&&$('setup-operation-dialog').open){clearTimeout(state.poll);state.poll=setTimeout(()=>loadOperation(id,{poll:true}).catch(showError),1500);}
    if(row.phase==='OBSERVED'&&state.refreshed!==id&&await refreshInventory()!==false){
      state.refreshed=id;
      if(row.kind==='save'&&state.pending.save?.operationId===id){
        const fresh=customer(row.state?.observation?.customer?.id??row.arguments.id)??inventory().customers.find(item=>item.reference===row.arguments.reference);
        if(fresh&&(state.profile?.id===fresh.id||!state.profile&&$('setup-profile-reference').value.trim()===row.arguments.reference)){
          state.profile={id:fresh.id,version:fresh.version,name:fresh.name,reference:fresh.reference};
          state.profileRevision=inventory().revision;profileHeading();
        }
        delete state.pending.save;saveDraft();
      }
    }
    return row;
  }
  async function review(kind,args,context){
    clearError();const signature=pretty({kind,arguments:Object.fromEntries(Object.entries(args).filter(([name])=>name!=='revision'&&name!=='actor'))});
    let pending=state.pending[kind];
    if(!pending||pending.signature!==signature){pending={operationId:crypto.randomUUID(),kind,arguments:args,signature};state.pending[kind]=pending;saveDraft();}
    const result=await api('/api/setup/operations',{operationId:pending.operationId,kind,arguments:pending.arguments});
    state.operation=result;await loadOperation(result.id,{review:context});
  }
  async function inspectSource(){
    clearError();const source=$('setup-usage-source').value;if(!source)throw new Error('Choose a configured service capture.');
    const result=await api('/api/setup/usage-preview',{source});state.source=result;
    const data=result.source;$('setup-source-preview').className='';
    $('setup-source-preview').innerHTML='<dl class="setup-definition"><div><dt>Captured</dt><dd>'+escape(date(data.sourceCreatedAt))+'</dd></div><div><dt>Original orders</dt><dd>'+escape(data.orderCount)+'</dd></div><div><dt>Source format</dt><dd>'+escape(data.sourceSchema)+'</dd></div></dl><details class="source-details"><summary>Capture identity</summary><pre>'+escape(pretty(data))+'</pre></details>';
    $('setup-import-form').hidden=false;if(!$('setup-import-name').value)$('setup-import-name').value=source.replace(/[_-]+/g,' ');
  }
  async function inspectStatement(id){
    clearError();const result=await api('/api/setup/statements/'+encodeURIComponent(id)),row=result.statement,doc=result.document;
    $('setup-statement-title').textContent=row.number+' · '+row.customerName;
    let content='<div class="setup-operation-status"><span class="status">'+escape(statuses[row.status])+'</span><span class="hint">Issued '+escape(date(row.createdAt))+'</span></div>'+
      '<dl class="setup-definition"><div><dt>Customer</dt><dd>'+escape(doc.customer.name)+'<br>'+escape(doc.customer.reference)+'</dd></div><div><dt>Purchase orders</dt><dd>'+escape(row.orderCount)+'</dd></div><div><dt>Statement basis</dt><dd>'+escape(doc.servicePeriod?date(doc.servicePeriod.from)+' – '+date(doc.servicePeriod.until):'Cumulative original customer statement')+'</dd></div></dl>';
    if(row.status==='RETAINED')content+='<div class="toolbar">'+button('setup-correct-statement',row.id,'Prepare correction')+'</div><details class="setup-withdraw"><summary>Withdraw this statement</summary><form id="setup-withdraw-form" data-statement="'+escape(row.id)+'"><label>Withdrawal reason<textarea id="setup-withdraw-reason" required maxlength="2000" rows="3"></textarea></label><button type="submit">Review withdrawal</button></form></details>';
    content+='<section class="detail-section"><h3>Original statement files</h3><div class="file-list">'+Object.keys(row.files).map(file=>'<div><a href="/api/setup/statements/'+encodeURIComponent(row.id)+'/file/'+encodeURIComponent(file)+'">'+escape(file)+'</a><small>'+escape(row.files[file].bytes.toLocaleString())+' bytes</small></div>').join('')+'</div></section>';
    content+='<section class="detail-section"><h3>Statement history</h3><div class="table-wrap"><table><thead><tr><th>When</th><th>Action</th><th>Operator</th><th>Reason</th></tr></thead><tbody>'+result.history.map(item=>'<tr><td>'+escape(date(item.at))+'</td><td>'+escape({retained:'Issued',superseded:'Corrected',withdrawn:'Withdrawn'}[item.action]??item.action)+'</td><td>'+escape(item.actor)+'</td><td>'+escape(empty(item.reason))+'</td></tr>').join('')+'</tbody></table></div></section>';
    content+='<details class="source-details"><summary>Complete original statement and current record</summary><pre>'+escape(pretty(result))+'</pre></details>';
    $('setup-statement-content').innerHTML=content;$('setup-statement-dialog').showModal();
    const form=$('setup-withdraw-form');if(form)form.addEventListener('submit',async event=>{
      event.preventDefault();const control=form.querySelector('button');control.disabled=true;
      try{$('setup-statement-dialog').close();await review('withdraw',{revision:result.revision,statementId:row.id,reason:$('setup-withdraw-reason').value.trim()});}
      catch(error){showError(error);}finally{control.disabled=false;}
    });
  }
  async function editOperation(){
    const row=state.operation;if(!row?.arguments)return;
    $('setup-operation-dialog').close();clearTimeout(state.poll);if(await refreshInventory()===false)throw new Error('Refresh the workspace before reviewing these changes again.');const args=row.arguments;delete state.pending[row.kind];
    if(row.kind==='save'){
      editProfile(args.id??null);
      for(const [id,key] of [['setup-profile-reference','reference'],['setup-profile-name','name'],['setup-profile-email','email'],['setup-profile-address','address'],['setup-profile-note-input','note']])$(id).value=args[key]??'';
      saveDraft();
    }else if(row.kind==='assign'){
      tab('customers');$('setup-assign-customer').value=args.customerId;$('setup-assign-orders').value=args.orders.map(item=>item.orderRef+(item.label?'\t'+item.label:'')).join('\n');
      $('setup-assign-reassign').checked=args.reassign===true;$('setup-assign-reason').value=args.reason??'';saveDraft();renderCustomers();$('setup-assign-form').scrollIntoView({block:'start'});
    }else if(row.kind==='usage_import'){
      tab('usage');await refreshSources();$('setup-usage-source').value=args.source;$('setup-import-name').value=args.name??args.source;await inspectSource();saveDraft();
    }else if(row.kind==='withdraw'){tab('statements');await inspectStatement(args.statementId);if($('setup-withdraw-reason'))$('setup-withdraw-reason').value=args.reason;}
    notice('The current records are ready for a new review. The previous saved request remains in Saved changes.');
  }
  function on(id,event,work){$(id).addEventListener(event,async value=>{try{await work(value);}catch(error){showError(error);}});}
  on('setup-profile-form','submit',async event=>{
    event.preventDefault();const form=event.currentTarget,control=form.querySelector('button[type=submit]');control.disabled=true;
    try{
      const args={revision:state.profile?state.profileRevision:inventory().revision,reference:$('setup-profile-reference').value.trim(),name:$('setup-profile-name').value.trim(),email:$('setup-profile-email').value.trim(),address:$('setup-profile-address').value.trim(),note:$('setup-profile-note-input').value.trim()};
      if(state.profile)Object.assign(args,{id:state.profile.id,expectedVersion:state.profile.version});
      await review('save',args);
    }finally{control.disabled=false;}
  });
  on('setup-assign-form','submit',async event=>{
    event.preventDefault();const control=event.currentTarget.querySelector('button[type=submit]');control.disabled=true;
    try{
      const orders=$('setup-assign-orders').value.split(/\r?\n/).filter(line=>line.trim()).map(line=>{const [orderRef,...parts]=line.split('\t');return {orderRef:orderRef.trim(),label:parts.join(' ').trim()};});
      const args={revision:inventory().revision,customerId:$('setup-assign-customer').value,orders,reassign:$('setup-assign-reassign').checked,reason:$('setup-assign-reason').value.trim()};
      if(args.reassign&&!args.reason)throw new Error('Enter the reason for moving existing customer orders.');
      const compared=await api('/api/setup/order-review',{arguments:args,runId:$('setup-assign-run').value||undefined});
      args.revision=compared.revision;await review('assign',args,compared);
    }finally{control.disabled=false;}
  });
  on('setup-import-form','submit',async event=>{
    event.preventDefault();if(!state.source)throw new Error('Inspect the original service capture before importing.');
    const control=event.currentTarget.querySelector('button[type=submit]');control.disabled=true;
    try{await review('usage_import',{revision:state.source.revision,source:state.source.source.source,expectedSha256:state.source.source.sha256,name:$('setup-import-name').value.trim()});}
    finally{control.disabled=false;}
  });
  for(const id of ['setup-profile-form','setup-assign-form','setup-import-form'])on(id,'input',()=>saveDraft());
  on('setup-new-customer','click',()=>editProfile(null));on('setup-clear-profile','click',()=>editProfile(null));
  on('setup-customer-search','input',()=>{state.tablePages.set('setup-customer-rows',0);renderCustomers();});
  on('setup-assign-customer','change',()=>{state.tablePages.set('setup-binding-rows',0);renderCustomers();saveDraft();});
  on('setup-statement-customer','change',()=>{state.tablePages.set('setup-statement-rows',0);renderStatements();});
  on('setup-statement-status','change',()=>{state.tablePages.set('setup-statement-rows',0);renderStatements();});
  on('setup-usage-source','change',()=>{state.source=null;$('setup-import-form').hidden=true;$('setup-source-preview').className='empty';$('setup-source-preview').textContent='Inspect this capture before importing.';});
  on('setup-preview-source','click',async event=>{const control=event.currentTarget;control.disabled=true;try{await inspectSource();}finally{control.disabled=false;}});
  on('setup-refresh-sources','click',refreshSources);on('setup-refresh-operations','click',refreshOperations);
  on('setup-close-statement','click',()=>$('setup-statement-dialog').close());
  on('setup-close-operation','click',()=>{$('setup-operation-dialog').close();clearTimeout(state.poll);});
  $('setup-operation-dialog').addEventListener('close',()=>clearTimeout(state.poll));
  on('setup-edit-operation','click',editOperation);
  for(const [id,action] of [['setup-apply-operation','execute'],['setup-reconcile-operation','reconcile']])on(id,'click',async event=>{
    const operationId=state.operation?.id;if(!operationId)return;event.currentTarget.disabled=true;clearError();
    try{await api('/api/setup/operations/'+encodeURIComponent(operationId)+'/'+action,action==='execute'?{execute:true}:{});await loadOperation(operationId);}
    catch(error){await loadOperation(operationId).catch(()=>{});throw error;}
  });
  document.addEventListener('click',async event=>{
    const control=event.target.closest('button');if(!control)return;
    try{
      if(control.dataset.setupTab){tab(control.dataset.setupTab);return;}
      if(control.dataset.setupPage){const id=control.dataset.setupPage,entry=state.tables.get(id);state.tablePages.set(id,(state.tablePages.get(id)??0)+Number(control.dataset.delta));table(id,entry.rows,entry.render,entry.columns,entry.message);return;}
      if(control.dataset.setupEditCustomer){editProfile(control.dataset.setupEditCustomer);return;}
      if(control.dataset.setupCustomerOrders){tab('customers');$('setup-assign-customer').value=control.dataset.setupCustomerOrders;renderCustomers();saveDraft();$('setup-assign-form').scrollIntoView({block:'start'});$('setup-assign-orders').focus();return;}
      if(control.dataset.setupOpenOperation){await loadOperation(control.dataset.setupOpenOperation);return;}
      if(control.dataset.setupOpenStatement){control.disabled=true;try{await inspectStatement(control.dataset.setupOpenStatement);}finally{control.disabled=false;}return;}
      if(control.dataset.setupCorrectStatement){const original=inventory().statements.find(row=>row.id===control.dataset.setupCorrectStatement);if(!original)throw new Error('Refresh the workspace to open this statement.');$('setup-statement-dialog').close();await addCorrection(original);return;}
    }catch(error){showError(error);}
  });
  window.addEventListener('pagehide',()=>clearTimeout(state.poll));
  return {show,inventoryChanged,destroy(){clearTimeout(state.poll);}};
}
