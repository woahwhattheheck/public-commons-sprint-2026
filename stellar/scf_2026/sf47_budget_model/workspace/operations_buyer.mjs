// MIT. Complete original buyer-source receiving in the existing SF47 Operations shell.
const MAX_FILE=16*1024*1024,MAX_NATIVE_FILE=8*1024*1024;
const CUSTOMER_USE_SCHEMA='stellar-forge.sf88.customer-use-return.v1';
function sourceSize(buffer){
  if(!buffer.byteLength||buffer.byteLength>MAX_FILE)throw new Error('Select an original handoff up to 8 MiB, or a customer-use return up to 16 MiB.');
  if(buffer.byteLength>MAX_NATIVE_FILE){
    let selected;try{selected=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer));}catch{}
    if(selected?.schema!==CUSTOMER_USE_SCHEMA)throw new Error('The original Inbox and Node source limit is 8 MiB. The 16 MiB allowance is only for a customer-use return.');
  }
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const human=v=>String(v??'').toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const btn=(label,action,extra='')=>'<button type="button" data-buyer-action="'+action+'" '+extra+'>'+esc(label)+'</button>';
const tag=v=>'<span class="buyer-tag">'+esc(human(v))+'</span>';
const input=(name,value='',type='text',max=4000)=>'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" maxlength="'+max+'">';
const label=(name,control,help='')=>'<label>'+esc(name)+control+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
const options=(values,value)=>values.map(v=>{const pair=Array.isArray(v)?v:[v,human(v)];return '<option value="'+esc(pair[0])+'"'+(pair[0]===value?' selected':'')+'>'+esc(pair[1])+'</option>';}).join('');
function b64(buffer){let value='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);}
async function digest(buffer){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(v=>v.toString(16).padStart(2,'0')).join('');}
function download(raw,name,type='application/json'){const url=URL.createObjectURL(raw instanceof Blob?raw:new Blob([raw],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
const definite=e=>[400,404,409,413,422].includes(e.status)&&typeof e.code==='string'&&/^[A-Z0-9_]{1,120}$/.test(e.code);
const nativeSource=row=>row.buyerHandoff?.schema==='scf.operations.buyer-receiving.v1'&&row.buyerHandoff.sourceSha256===row.sha256;
const compactRequest=request=>{
  if(!request)return null;const value=structuredClone(request);delete value.data.contentBase64;return value;
};

export function mountBuyerReceiving({container,current,api,saveApi=api,mutationId,recordingActor,onSaved,onReload,session={}}){
  const root=document.createElement('section');root.className='buyer-receiving';root.setAttribute('aria-label','Native buyer receiving');container.replaceChildren(root);
  const storageKey='sf47.buyer-receiving.'+current.program.id;
  let active=true,busy=false,hostBusy=false;
  const $=selector=>root.querySelector(selector),available=()=>active&&root.isConnected;
  const activeCheck=()=>{if(!available())throw new Error('Reopen this original operations case to continue buyer receiving.');};
  const editable=()=>current.program.state==='OPEN'&&!session.pending&&!session.accepted&&!session.sending;
  const selectField=(name,values,value)=>'<select name="'+name+'">'+options(values,value)+'</select>';
  if(!session.loaded){
    session.loaded=true;
    try{
      const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
      if(saved?.schema==='sf47.buyer-draft.v1'&&saved.caseId===current.program.id){
        session.draft=saved.draft;session.fileMeta=saved.fileMeta;session.pending=saved.pending;
        session.message=saved.pending?'An original receiving request is retained. Recover it with the exact original file.':
          saved.fileMeta?'Reselect the retained original file to reopen this draft.':'';
      }
    }catch{session.message='The saved browser draft could not be opened. Existing case records remain available.';}
  }
  function persist(){
    const data={schema:'sf47.buyer-draft.v1',caseId:current.program.id,draft:session.draft??null,
      fileMeta:session.fileMeta??null,pending:compactRequest(session.pending)};
    localStorage.setItem(storageKey,JSON.stringify(data));
  }
  function tell(message,error=false){
    session.message=message;session.error=error;
    if(available()){const node=$('[data-buyer-message]');if(node){node.textContent=message;node.setAttribute('role',error?'alert':'status');}}
  }
  function draft(){
    const form=$('[data-buyer-form]');if(!form)return;
    const value={};
    for(const el of form.elements)if(el.name)value[el.name]=el.multiple?[...el.selectedOptions].map(x=>x.value):el.value;
    value.selections=[...form.querySelectorAll('[data-buyer-job]')].filter(x=>x.checked).map(x=>({
      jobId:x.dataset.buyerJob,purchaseId:form.querySelector('[data-buyer-purchase="'+x.dataset.buyerJob+'"]')?.value||null}));
    session.draft=value;
    try{persist();}catch{tell('The browser could not retain this draft. Keep the view open and free local storage before sending.',true);}
  }
  function restore(){
    const value=session.draft;if(!value)return;
    for(const el of $('[data-buyer-form]')?.elements??[])if(el.name&&Object.hasOwn(value,el.name)){
      if(el.multiple){for(const option of el.options)option.selected=Array.isArray(value[el.name])&&value[el.name].includes(option.value);}
      else if(el.tagName==='SELECT'){
        if(![...el.options].some(x=>x.value===value[el.name])){
          const option=document.createElement('option');option.value=String(value[el.name]??'');option.textContent='Retained selection unavailable: '+option.value;el.add(option);
        }
        el.value=String(value[el.name]??'');
      }else el.value=String(value[el.name]??'');
    }
    if(Array.isArray(value.selections)){
      const selected=new Map(value.selections.map(x=>[x.jobId,x.purchaseId]));
      for(const box of root.querySelectorAll('[data-buyer-job]')){
        box.checked=selected.has(box.dataset.buyerJob)&&box.dataset.buyerFixed!=='true';
        const picker=$('[data-buyer-purchase="'+box.dataset.buyerJob+'"]');
        if(picker&&selected.has(box.dataset.buyerJob)){
          const original=selected.get(box.dataset.buyerJob)||'';
          if(![...picker.options].some(option=>option.value===original)){
            const option=document.createElement('option');option.value=original;option.textContent='Original purchase unavailable: '+original;picker.add(option);
          }
          picker.value=original;
        }
      }
    }
  }
  function configure(){
    const choice=$('[name=deploymentId]')?.value,newFields=$('[data-buyer-new]');
    if(newFields)newFields.hidden=choice!=='__new__';
    const bindings=session.review?.customerUseBinding?.deployments;
    if(bindings&&choice&&choice!=='__select__'){
      for(const box of root.querySelectorAll('[data-buyer-job]'))
        if(bindings[box.dataset.buyerJob]!==choice)box.checked=false;
    }
    const handed=$('[name=state]')?.value==='HANDED_OVER';
    for(const el of root.querySelectorAll('[name=acceptedBy],[name=acceptedAt]'))el.required=choice==='__new__'&&handed;
    const selected=[...root.querySelectorAll('[data-buyer-job]')].filter(x=>x.checked).length;
    const count=$('[data-buyer-selected]');if(count)count.textContent=selected+' of '+(session.review?.rows.length??0)+' original jobs selected';
    sync();
  }
  function sync(){
    if(!available())return;
    root.setAttribute('aria-busy',String(busy||hostBusy||Boolean(session.sending)));
    for(const el of root.querySelectorAll('button,input,select,textarea')){
      const field=el.closest('[data-buyer-draft]'),newField=el.closest('[data-buyer-new]');
      const pendingBlock=Boolean(field&&(session.pending||session.accepted));
      const selected=el.dataset.buyerPurchase?root.querySelector('[data-buyer-job="'+el.dataset.buyerPurchase+'"]')?.checked:true;
      const originalBuyer=session.review?.customerUseBinding?.deployments?.[el.dataset.buyerJob],
        selectedBuyer=$('[name=deploymentId]')?.value;
      const otherBuyer=originalBuyer&&selectedBuyer&&selectedBuyer!=='__select__'&&originalBuyer!==selectedBuyer;
      el.disabled=busy||hostBusy||Boolean(session.sending)||el.dataset.buyerFixed==='true'||pendingBlock||
        Boolean(newField?.hidden)||!selected||Boolean(otherBuyer);
      if(el.matches('[data-buyer-send]'))el.disabled=el.disabled||!editable()||!session.review||
        !$('[name=deploymentId]')?.value||$('[name=deploymentId]')?.value==='__select__'||
        ![...root.querySelectorAll('[data-buyer-job]')].some(x=>x.checked);
      if(['preview','open-source'].includes(el.dataset.buyerAction))el.disabled=el.disabled||Boolean(session.pending||session.accepted);
    }
  }
  const setHostBusy=value=>{hostBusy=Boolean(value);sync();};
  async function run(fn){
    if(busy||hostBusy||!available())return;
    busy=true;sync();try{await fn();}catch(error){if(available())tell(error.message||String(error),true);}
    finally{busy=false;if(available())sync();}
  }
  function deploymentForm(review){
    const bound=review.customerUseBinding?.deployments;
    const matched=bound?Object.values(bound):review.rows.map(x=>x.suggestedDeploymentId||x.matches?.[0]?.deploymentId).filter(Boolean),unique=[...new Set(matched)];
    const selected=unique.length===1?unique[0]:'__select__';
    const kinds=[['__select__',bound?'Choose the retained Calendar buyer':'Choose an existing deployment or create one'],
      ...(bound?[]:[['__new__','New original buyer deployment']]),
      ...review.deployments.filter(x=>['BUYER','BOTH'].includes(x.role)&&(!bound||unique.includes(x.id))).map(x=>[x.id,x.name+' · '+x.operator+' · '+human(x.participantClass)])];
    const networks=[...new Set(review.rows.filter(x=>x.purchase).map(x=>x.purchase.network))],environment=networks.length===1?
      networks[0]==='stellar:testnet'?'TESTNET':networks[0]==='stellar:pubnet'?'MAINNET':'OTHER':'OTHER';
    const costs=current.plan.scenario.future_costs.map(row=>[row.id,row.id]);
    return '<fieldset><legend>2 / Accountable deployment</legend>'+label('Existing deployment',selectField('deploymentId',kinds,selected),
      bound?'Each selected job keeps the buyer from its exact saved Calendar entry. Jobs for another buyer remain in the complete source and can be received separately.':'Later observations retain the original deployment. Unpaid Node observations have no purchase; participant attribution remains an explicit operator decision.')+
      '<div class="buyer-fields" data-buyer-new hidden>'+
      label('Deployment name',input('name','','text',500))+
      label('Accountable operator',input('operator','','text',500))+
      label('Stable operator identity',input('operatorId','','text',500),'Use the real accountable person or organization identity.')+
      label('Role',selectField('role',['BUYER','BOTH'],'BUYER'))+
      label('Participant class',selectField('participantClass',['TEAM_OPERATED','INDEPENDENT_OPERATOR','CUSTOMER'],'TEAM_OPERATED'),
        'A native purchase does not determine whether the operator is an independent customer.')+
      label('Environment',selectField('environment',['LOCAL','TESTNET','MAINNET','OTHER'],environment))+
      label('Deployment state',selectField('state',['PLANNED','INSTALLED','OPERATING','HANDED_OVER','RETIRED'],'OPERATING'))+
      label('Tranche',selectField('tranche',[['','Not assigned'],['1','T1'],['2','T2'],['3','T3']],''))+
      label('Original work packages','<select name="costIds" multiple size="4">'+options(costs,'')+'</select>')+
      label('Native endpoint',input('endpoint','','url',4000))+
      label('Original release / source',input('releaseRef','','text',4000))+
      label('Merchant case / work order',input('caseRef','','text',4000))+
      label('Receiving operator',input('acceptedBy','','text',300),'Required only when recording an actual handover.')+
      label('Actual handover date',input('acceptedAt','','date'))+
      label('Operator attribution / deployment source','<textarea name="sourceNote" rows="3" maxlength="12000"></textarea>')+
      '</div></fieldset>';
  }
  function customerUseContext(value){
    const use=value?.customerUse;if(!use)return '';
    return '<section class="buyer-source"><h4>Saved customer-use commissioning</h4>'+
      '<p>Commission '+esc(use.commission.id)+' · revision '+esc(use.commission.revision)+
      '<br>Original Calendar case '+esc(use.source.caseId)+' · observed version '+esc(use.source.caseVersion)+
      '<br><code>'+esc(use.commission.revisionSha256)+'</code></p>'+
      '<p class="buyer-note">These dates and modes describe the original saved plan. The native job rows below establish actual outcomes. Prepaid allowance use and reopening a retained result do not establish another settlement.</p>'+
      '<div class="buyer-jobs">'+use.bindings.map(binding=>'<article class="buyer-job"><strong>'+esc(binding.use.date)+
        ' · '+esc(binding.use.taskId)+'</strong><p>'+esc(human(binding.use.mode))+' · '+esc(human(binding.use.state))+
        ' · original buyer '+esc(binding.use.buyerDeploymentId)+'<br>Installation '+esc(binding.entry.installationId)+
        ' revision '+esc(binding.entry.revision)+' · entry '+esc(binding.entry.entryId)+
        '<br>'+esc(binding.requests.map(row=>row.intentId).join(' · '))+'</p>'+
        '<details><summary>Complete original use and request bindings</summary><pre>'+esc(JSON.stringify(binding,null,2))+'</pre></details></article>').join('')+'</div></section>';
  }
  function jobRows(review){
    return review.rows.map(row=>{
      const blocked=row.receiving==='CONFLICT',selection=row.suggestedPurchaseId||'',unpaid=row.purchase===null;
      const purchaseOptions=[['','Record a new original purchase'],...review.purchases.map(value=>[value.id,
        (value.intentId||value.transactionHash||value.id)+' · '+human(value.settlementStatus)])];
      const subtitle=row.sourceKind==='NODE_ACCOUNTING'?
        'Original Node command '+row.node.commandId:(row.method||'')+' '+(row.url||'');
      const facts=unpaid?
        '<div><dt>Original disposition</dt><dd>No payment required<small>No asset, amount, reservation or purchase is recorded.</small></dd></div>'+
        '<div><dt>Reported HTTP status</dt><dd>'+esc(row.output.httpStatus??'Unknown')+'<small>Original unsigned checkout observation</small></dd></div>'+
        '<div><dt>Response capture</dt><dd>'+esc(human(row.output.captureStatus))+'<small>No response body is embedded in this carrier.</small></dd></div>'+
        '<div><dt>Accounting outcome</dt><dd>'+esc(human(row.node.outcome))+'<small>'+esc(human(row.node.recordAuthority))+'</small></dd></div>':
        '<div><dt>Accepted / original atomic amount</dt><dd>'+esc(row.purchase.amountStroops)+'<small>'+esc(row.purchase.network)+' / '+esc(row.purchase.asset)+'</small></dd></div>'+
        '<div><dt>Payment attempt</dt><dd>'+esc(human(row.purchase.attemptStatus))+'</dd></div>'+
        '<div><dt>Settlement</dt><dd>'+esc(human(row.purchase.settlementStatus))+'<small>'+esc(row.purchase.transactionHash||'Original transaction unavailable')+'</small></dd></div>'+
        '<div><dt>Retained output at capture</dt><dd>'+esc(human(row.output.state))+'<small>'+esc(row.sourceKind==='NODE_ACCOUNTING'?
          'Response body not embedded in this carrier':row.output.bytes==null?'':row.output.bytes+' bytes')+'</small></dd></div>';
      const association=unpaid?
        '<p class="buyer-note">Receive this original operational observation against the selected deployment. It contributes no purchase, approved intent, cash, funding receipt or independent-customer count.</p>':
        '<div class="buyer-row-controls">'+label('Original purchase association','<select data-buyer-purchase="'+row.jobId+'">'+options(purchaseOptions,selection)+'</select>',
          row.receiving==='OBSERVE_ORIGINAL'?'Receive this recovery or source observation against the existing original.':'A new record retains this exact source intent; no payment is made.')+'</div>';
      const planned=review.customerUse?.bindings.filter(binding=>binding.requests.some(request=>request.jobId===row.jobId))??[];
      const useNote=planned.length?'<p class="buyer-note">Saved useful task: '+esc(planned.map(binding=>binding.use.date+' · '+binding.use.taskId+' · '+human(binding.use.mode)).join('; '))+
        '<br>Original Calendar buyer: '+esc(review.customerUseBinding.deployments[row.jobId])+'</p>':'';
      const linked=row.operationMatches?.length?
        '<p class="buyer-note">This original Node operation already has '+row.operationMatches.length+' retained source association'+
          (row.operationMatches.length===1?'':'s')+'. Its deployment and any established purchase identity remain bound.</p>':'';
      return '<article class="buyer-job"><header><label class="buyer-check"><input type="checkbox" data-buyer-job="'+row.jobId+'"'+
        (blocked?' disabled data-buyer-fixed="true"':' checked')+'><span><strong>'+esc(row.intentId)+'</strong><small>'+esc(subtitle)+'</small></span></label>'+
        tag(unpaid?'NO_PAYMENT_REQUIRED':row.nativeState)+'</header><dl class="buyer-facts">'+facts+'</dl>'+association+linked+
        (row.currentObservationPreserved?'<p class="buyer-note">This accounting source predates the current purchase observation. Receiving retains the original source times and preserves the current purchase state and observation time.</p>':'')+
        (row.identityConflicts?.length?'<p class="buyer-issue">Original identity differs: '+esc(row.identityConflicts.join(', '))+'. Review the retained deployment or purchase association before receiving.</p>':'')+
        (row.matches.length>1?'<p class="buyer-issue">This intent / transaction matches more than one active case record. Reconcile those original records first.</p>':'')+
        (row.issues.length?'<p class="buyer-issue">'+esc(row.issues.map(human).join(' · '))+'</p>':'')+
        useNote+'<details><summary>Original source, outcome and timing details</summary><pre>'+esc(JSON.stringify(row,null,2))+'</pre></details></article>';
    }).join('');
  }
  function received(){
    const files=current.sources.filter(nativeSource);
    if(!files.length)return '<p class="buyer-empty">Received buyer sources will reopen here with their exact bytes, deployment/purchase associations and native reports.</p>';
    return files.map(file=>{
      const handoff=file.buyerHandoff,node=handoff.sourceSchema==='stellar-forge.node-operation-accounting-export.v1';
      const observations=node?handoff.rows.map(row=>'<p class="buyer-note">'+esc(human(row.disposition))+
        ' · '+esc(row.purchaseId?'Original purchase '+row.purchaseId:'Operational observation; no purchase')+
        '<br>Reported HTTP '+esc(row.output.httpStatus??'unknown')+' · response capture '+esc(human(row.output.captureStatus))+
        ' · response body not embedded<br>Original command <code>'+esc(row.node.commandId)+'</code>'+
        '<br>Original identity <code>'+esc(row.node.sourceIdentitySha256)+'</code></p>').join(''):'';
      return '<article class="buyer-received"><div><h4>'+esc(handoff.originalFilename||file.filename)+'</h4><p>'+
        handoff.rows.length+' received of '+handoff.totalSourceJobs+' original jobs · '+esc(handoff.capturedAt)+
        '</p><code>'+esc(file.sha256)+'</code>'+observations+'</div><div class="buyer-actions">'+
        btn('Open original review','open-source','data-source="'+file.id+'"')+
        btn('Download original source','download-source','data-source="'+file.id+'"')+
        handoff.reports.map(report=>btn('Download native report','download-report','data-source="'+report.sourceId+'"')).join('')+'</div></article>';
    }).join('');
  }
  function render(){
    if(!available())return;
    const review=session.review;
    root.innerHTML='<header class="buyer-heading"><div><p class="buyer-eyebrow">DELIVERY OPERATIONS / ORIGINAL BUYER</p><h3>Receive native buyer work</h3>'+
      '<p>Receive original Inbox handoffs, saved customer-use returns or Node accounting exports in this delivery case. Keep unpaid operations separate from purchases, review the accountable deployment, and retain original source and request identities.</p></div>'+
      btn('Refresh original case','reload')+'</header><p data-buyer-message role="'+(session.error?'alert':'status')+'">'+esc(session.message||'')+'</p>'+
      '<section class="buyer-source"><h4>1 / Original source handoff</h4>'+
      '<label class="buyer-file">'+(session.pending?'Reselect the exact file for the retained request':'Select the original Inbox handoff, customer-use return or Node accounting export')+
      '<input type="file" accept=".json,application/json" data-buyer-file></label>'+
      (session.fileMeta?'<p>'+esc(session.fileMeta.filename)+' · '+session.fileMeta.bytes+' bytes<br><code>'+esc(session.fileMeta.sha256)+'</code></p>':'')+
      '<details><summary>Export from the existing native Inbox</summary><p>Use the installed original buyer component with the existing Inbox and explicit intent IDs. Choose a new private output filename.</p>'+
      '<pre>node sf88-operator-buyer-cli/operations-handoff/cli.mjs export \\\n  --inbox /private/original-inbox \\\n  --intent ORIGINAL_INTENT \\\n  --output /private/receiving/buyer-operations.json</pre>'+
      '<p>The export opens original records and verifies retained response files. It does not approve, sign, execute, recover, finalize or retry a purchase. The complete private source stays with this operating case.</p></details>'+
      '<details><summary>Use an existing Node accounting export</summary><p>Select the original <code>Operation_Accounting.json</code> produced by the native Node operation. The reader checks its embedded original attempt, evidence and saved accounting result. An unsigned response requiring no payment is received as a deployment observation with no purchase. This carrier embeds no response body.</p></details>'+
      '<details><summary>Receive saved customer-use results</summary><p>Select the complete return downloaded from Customer-use commissioning. The original Calendar Installations must already be retained in this case or its independently received history. Review the exact commissioning revision, dated useful tasks, original buyer and unchanged native job results together. This return does not execute a request or create a settlement.</p><p>Original Inbox and Node files remain bounded at 8 MiB. Customer-use returns allow 16 MiB; the existing whole-case 24 MiB source and 32 MiB export limits still apply.</p></details>'+
      (session.selected&&!session.pending?btn('Review retained source','preview'):'')+
      (session.pending?'<div class="buyer-pending"><h4>Original request retained</h4><p>Request '+esc(session.pending.requestId)+
      ' was prepared at case version '+session.pending.expectedVersion+'. Continue that exact request to read its committed result or complete its original save.</p>'+
      btn('Recover original request','recover')+'</div>':'')+'</section>'+
      (review?customerUseContext(review)+'<section class="buyer-summary"><div><strong>'+review.counts.jobs+'</strong><span>Original jobs</span></div><div><strong>'+review.counts.knownSignedAttempts+
      '</strong><span>Established signed attempts</span></div><div><strong>'+review.counts.settled+'</strong><span>Retained settled observations</span></div><div><strong>'+
      review.counts.verifiedRetainedOutputs+'</strong><span>Verified retained outputs</span></div>'+
      (review.counts.unpaidOperationalObservations?'<div><strong>'+review.counts.unpaidOperationalObservations+'</strong><span>Unpaid operational observations</span></div>':'')+'</section>'+
      '<p class="buyer-note">'+esc(review.interpretation)+'</p><form data-buyer-form><div data-buyer-draft>'+
      deploymentForm(review)+'<fieldset><legend>3 / Original operation and purchase observations</legend>'+
      '<p data-buyer-selected></p><p class="buyer-note">The complete source preserves every exported job. Selected paid observations retain their native purchase semantics; unpaid Node observations remain separate from financial metrics. Unselected and unresolved source facts stay visible.</p>'+
      '<div class="buyer-jobs">'+jobRows(review)+'</div></fieldset>'+
      '<fieldset><legend>4 / Receive into this case</legend>'+label('Receiving / reconciliation note','<textarea name="note" required rows="3" maxlength="12000"></textarea>',
        'Explain the original deployment association and, when applicable, the later observation of its existing purchase.')+
      '<p>Case '+esc(current.program.name)+' · reviewed version '+review.version+'. No award, cash, issuer acceptance or customer agreement is created.</p>'+
      '<button type="submit" data-buyer-send>Receive selected original jobs</button></fieldset></div></form>'+
      '<div class="buyer-actions">'+btn('Download source review','review-download')+'</div>':'')+
      '<section><h4>Received original buyer sources</h4>'+received()+'</section>'+
      (current.program.state!=='OPEN'?'<p class="buyer-note">This case is closed. Use its original Reopen review action before receiving another source.</p>':'');
    restore();configure();sync();
  }
  async function openSelected(){
    if(session.pending||session.accepted||session.sending)throw new Error('Recover the retained original receiving request first.');
    if(!session.selected)throw new Error('Select the original source file.');
    const selected=session.selected;
    const response=await api('/api/operations/'+current.program.id+'/buyer-preview',{expectedVersion:current.program.version,...selected});
    activeCheck();if(session.selected!==selected)return;
    session.review=response;session.rejected=null;
    tell('Original source reviewed against case version '+response.version+'. Choose the deployment and review the original operation or purchase association.');
    render();
  }
  async function selectFile(name,buffer){
    sourceSize(buffer);
    const file={filename:name,bytes:buffer.byteLength,sha256:await digest(buffer)};
    activeCheck();
    if(session.pending&&session.fileMeta&&(file.sha256!==session.fileMeta.sha256||file.bytes!==session.fileMeta.bytes))
      throw new Error('This is not the original file for the retained request. Reselect the same bytes.');
    const prior=session.fileMeta;
    session.fileMeta=session.pending?{...file,filename:session.pending.data.filename}:file;
    session.selected={filename:session.fileMeta.filename,contentBase64:b64(buffer)};
    if(session.pending){session.pending.data.contentBase64=session.selected.contentBase64;persist();tell('Exact original file restored. Recover the retained request.');render();return;}
    if(prior&&prior.sha256!==file.sha256)session.draft=null;
    session.review=null;persist();await openSelected();
  }
  async function originalBytes(source){
    const response=await api('/api/operations/'+current.program.id+'/sources/'+source.id,undefined,{download:true});
    const bytes=await response.arrayBuffer();activeCheck();
    if(bytes.byteLength!==source.bytes||await digest(bytes)!==source.sha256)throw new Error('The downloaded original source identity differs.');
    return bytes;
  }
  async function sendPending(){
    if(!session.pending)throw new Error('No original receiving request is retained.');
    if(!session.pending.data.contentBase64){
      const source=current.sources.find(row=>session.fileMeta&&row.sha256===session.fileMeta.sha256&&row.bytes===session.fileMeta.bytes);
      if(!source)throw new Error('Reselect the exact original source file to recover this request.');
      session.pending.data.contentBase64=b64(await originalBytes(source));
    }
    persist();
    if(!session.sending){
      const request=structuredClone(session.pending);
      session.sending=(async()=>{
        try{
          let result;
          try{result=await saveApi('/api/operations/'+current.program.id+'/command',request);}
          catch(error){
            if(definite(error)){
              session.pending=null;session.review=null;session.rejected={code:error.code,message:error.message};
              try{persist();}catch{}
              session.message=error.message+' The source and draft are retained. Refresh and review the current case.';
            }else session.message=error.message||'The response is unavailable. Recover this same original request.';
            session.error=true;throw error;
          }
          session.accepted=result;session.pending=null;session.rejected=null;
          session.review=null;session.selected=null;session.fileMeta=null;session.draft=null;
          session.message=result.unchanged?'This exact source and its original associations are already received.':
            'Received '+result.selectedJobIds.length+' original job'+(result.selectedJobIds.length===1?'':'s')+' at case version '+result.version+
            '; '+result.purchaseIds.length+' purchase association'+(result.purchaseIds.length===1?'':'s')+
            (result.operationalObservationIds?.length?', '+result.operationalObservationIds.length+' original Node operational observation'+(result.operationalObservationIds.length===1?'':'s'):'')+'.';
          session.error=false;
          try{persist();}catch{
            session.message+=' The original save is complete; this browser could not clear its local draft. Reopening the retained request will return that same saved result.';
          }
          return result;
        }finally{session.sending=null;session.notify?.();}
      })();
    }
    try{
      const result=await session.sending;
      if(available()){session.accepted=null;await onSaved(result);}
    }catch(error){
      if(session.rejected&&available()){await onReload();return;}
      throw error;
    }
  }
  root.addEventListener('input',event=>{if(event.target.closest('[data-buyer-form]'))draft();});
  root.addEventListener('change',event=>{
    if(event.target.matches('[data-buyer-file]')){
      const file=event.target.files?.[0];if(file)run(async()=>{
        if(file.size>MAX_FILE)throw new Error('Select an original handoff up to 8 MiB, or a customer-use return up to 16 MiB.');
        await selectFile(file.name,await file.arrayBuffer());
      });
    }
    if(event.target.closest('[data-buyer-form]')){draft();configure();draft();}
  });
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-buyer-action]');if(!target)return;
    run(async()=>{
      const action=target.dataset.buyerAction;
      if(action==='reload'){draft();return onReload();}
      if(action==='preview')return openSelected();
      if(action==='recover')return sendPending();
      if(action==='review-download'){if(session.review)download(session.review.html,'original-buyer-source-review.html','text/html');return;}
      const source=current.sources.find(row=>row.id===target.dataset.source);
      if(!source)throw new Error('This original source is unavailable in the current case.');
      const bytes=await originalBytes(source);
      if(action==='open-source'){
        if(session.pending||session.sending)throw new Error('Recover the original pending request first.');
        await selectFile(source.buyerHandoff?.originalFilename||source.filename,bytes);
      }else download(bytes,source.buyerHandoff?.originalFilename||source.filename,source.mediaType);
    });
  });
  root.addEventListener('submit',event=>{
    if(!event.target.matches('[data-buyer-form]'))return;event.preventDefault();
    if(!editable()||!session.review||!session.selected)return;
    draft();
    const data=new FormData(event.target);
    run(async()=>{
      const choice=String(data.get('deploymentId')||'__select__');
      if(choice==='__select__')throw new Error('Choose the accountable original deployment.');
      const selections=session.draft.selections;
      if(!selections?.length)throw new Error('Select one or more original jobs.');
      const bound=session.review.customerUseBinding?.deployments;
      if(bound&&selections.some(row=>bound[row.jobId]!==choice))throw new Error('Each selected job must retain the buyer from its exact original Calendar entry.');
      const body={...session.selected,expectedPreviewSha256:session.review.previewSha256,
        deploymentId:choice==='__new__'?null:choice,selections};
      if(choice==='__new__'){
        body.deployment=Object.fromEntries(['name','operator','operatorId','role','participantClass','environment','state',
          'endpoint','releaseRef','caseRef','acceptedBy','sourceNote'].map(key=>[key,String(data.get(key)||'')]));
        body.deployment.tranche=data.get('tranche')?Number(data.get('tranche')):null;
        body.deployment.acceptedAt=data.get('acceptedAt')||null;
        body.deployment.costIds=data.getAll('costIds').map(String);
      }
      const note=String(data.get('note')||'').trim();if(!note)throw new Error('Record the receiving or reconciliation reason.');
      const request={expectedVersion:session.review.version,actor:recordingActor(),note,action:'buyer.receive',data:body};
      request.requestId=await mutationId('operations:'+current.program.id,request);activeCheck();
      session.pending=structuredClone(request);persist();render();await sendPending();
    });
  });
  function dispose(){draft();active=false;if(session.notify===render)session.notify=null;}
  session.notify=render;render();
  const ready=(async()=>{
    if(session.sending){try{await session.sending;}catch{}if(available()&&session.accepted){const value=session.accepted;session.accepted=null;await onSaved(value);}return;}
    if(session.accepted){const value=session.accepted;session.accepted=null;await onSaved(value);return;}
    if(session.selected&&!session.pending&&(!session.review||session.review.version!==current.program.version)){
      busy=true;sync();try{await openSelected();}catch(error){if(available())tell(error.message,true);}finally{busy=false;sync();}
    }
  })();
  return {root,ready,dispose,setHostBusy};
}
