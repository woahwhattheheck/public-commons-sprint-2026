import {calendarImpactHtml,filterCalendarImpact,calendarImpactSelection} from './operations_amendment_calendar.mjs';
// MIT. Reviewed plan amendments in the original SF47 Delivery view.
const DB_NAME='sf47-plan-amendment-drafts-v1', STORE='drafts';
const SCHEMA='stellar-forge.sf47-plan-amendment-draft.v1';
const LIMIT=512*1024;
let database;
const clone=value=>structuredClone(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const order=value=>Array.isArray(value)?value.map(order):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,order(value[k])])):value;
const canonical=value=>JSON.stringify(order(value));
const pretty=value=>JSON.stringify(value,null,2);
const date=()=>new Date().toISOString().slice(0,10);
const money=value=>value===null||value===undefined?'Unknown':'$'+value;
function openDatabase(){
  if(!database)database=new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(new Error('The browser could not open its retained amendment drafts.'));
    request.onblocked=()=>reject(new Error('Close the older amendment-draft reader before opening this edition.'));
  });
  return database;
}
async function readDraft(id){
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{const tx=db.transaction(STORE),r=tx.objectStore(STORE).get(id);
    r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);});
}
async function listDrafts(caseId,planId){
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{const tx=db.transaction(STORE),r=tx.objectStore(STORE).getAll();
    r.onsuccess=()=>resolve(r.result.filter(v=>v.caseId===caseId&&v.planId===planId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));
    r.onerror=()=>reject(r.error);});
}
async function writeDraft(value,expected){
  if(new TextEncoder().encode(JSON.stringify(value)).length>LIMIT)throw new Error('Download this draft and reduce its notes before continuing; the retained browser-draft bound is 512 KiB.');
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),r=store.get(value.id);
    let failure=null;
    r.onsuccess=()=>{
      const prior=r.result;
      if((prior?.sequence??0)!==expected||(prior&&(prior.caseId!==value.caseId||prior.planId!==value.planId))){
        failure=new Error('Another tab changed this local draft. Keep your current text and reopen its retained browser edition.');failure.code='LOCAL_DRAFT_CONFLICT';tx.abort();return;
      }
      store.put(value);
    };
    tx.oncomplete=()=>resolve(value);
    tx.onabort=tx.onerror=()=>reject(failure||tx.error||new Error('The browser did not retain this draft. Download it before leaving.'));
  });
}
function download(value,name,type='application/json'){
  const blob=value instanceof Blob?value:new Blob([typeof value==='string'?value:pretty(value)],{type});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
const table=(headers,rows)=>'<div class="amend-scroll" tabindex="0"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const button=(label,action,extra='',disabled=false)=>'<button type="button" data-amend-action="'+action+'" '+extra+(disabled?' disabled data-amend-fixed="true"':'')+'>'+esc(label)+'</button>';
const input=(label,name,value,options={})=>{
  const attrs=' name="'+esc(name)+'"'+(options.required?' required':'')+(options.multiple?' multiple size="4"':'');
  let element;
  if(options.options)element='<select'+attrs+'>'+options.options.map(([key,title])=>'<option value="'+esc(key)+'"'+((options.multiple?(value||[]).includes(key):String(value??'')===String(key))?' selected':'')+'>'+esc(title)+'</option>').join('')+'</select>';
  else if(options.area)element='<textarea'+attrs+' rows="3" maxlength="12000">'+esc(value)+'</textarea>';
  else element='<input'+attrs+' type="'+(options.type||'text')+'" value="'+esc(value)+'" maxlength="12000">';
  return '<label'+(options.wide?' class="amend-wide"':'')+'>'+esc(label)+element+(options.help?'<small>'+esc(options.help)+'</small>':'')+'</label>';
};
function exposureTable(rows){
  return table(['Package / tranche','Planned USD','Recorded invoices','Invoices over plan','Remaining before invoices','Recorded payments','Payments over plan','Remaining before payments','Planned hours','Recorded hours','Hours over plan','Remaining hours'],rows.map(r=>[
    esc(r.costId)+' / '+r.tranche,esc(money(r.plannedUsd)),esc(money(r.recordedInvoiceUsd)),esc(money(r.recordedInvoicesOverPlanUsd)),
    esc(money(r.remainingBeforeRecordedInvoicesUsd)),esc(money(r.recordedPaidUsd)),esc(money(r.recordedPaymentsOverPlanUsd)),
    esc(money(r.remainingBeforeRecordedPaymentsUsd)),esc(r.plannedHours??'Unknown'),esc(r.recordedHours),
    esc(r.recordedHoursOverPlan??'Unknown'),esc(r.remainingBeforeRecordedHours??'Unknown')]));
}
function attributionFields(kind,row){
  if(kind==='work')return {costId:row.costId,hours:row.hours};
  if(kind==='invoices')return row.lines.map(line=>({id:line.id,costId:line.costId,amountUsd:line.amountUsd,workIds:line.workIds}));
  return {costIds:row.costIds};
}
function attributionPreview(p){
  if(!Object.hasOwn(p.inputs,'packageMappings'))return '';
  const changes=p.recordChanges||[],reviews=p.retainedSelectionReviews||[];
  return '<h4>Reviewed package attribution</h4><p>'+changes.length+' original record'+(changes.length===1?'':'s')+' receive the selected budget attribution. Their identities, quantities, amounts, states and original source fields remain visible in the complete before and after records.</p>'+
    (p.inputs.packageMappings.length?table(['Original package','Selected attribution','Reason'],p.inputs.packageMappings.map(row=>[esc(row.fromCostId),row.toCostId===null?'Unassigned':esc(row.toCostId),esc(row.note)])):'<p>Current record attribution stays unchanged.</p>')+
    (changes.length?table(['Original record','Current attribution','Selected attribution','Complete retained record'],changes.map(row=>[
      esc(row.kind)+'<br><code>'+esc(row.recordId)+'</code>','<pre>'+esc(pretty(attributionFields(row.kind,row.before)))+'</pre>',
      '<pre>'+esc(pretty(attributionFields(row.kind,row.after)))+'</pre>',
      '<details><summary>Before and selected record</summary><pre>'+esc(pretty({before:row.before,selected:row.after}))+'</pre></details>'])):'')+
    (reviews.length?'<h4>Saved delivery selections</h4><p>Earlier assignments and installation editions keep their original plan. Review the current selections before continuing delivery under this revision.</p>'+
      table(['Saved selection','Current revision review','Retained package detail'],reviews.map(row=>[
        esc(row.kind)+'<br><code>'+esc(row.id)+'</code>',esc(row.message),'<pre>'+esc(pretty(row))+'</pre>'])):'');
}
function previewHtml(p){
  if(!p)return '<p>Preview the selected saved revision to read its complete changes and original record exposure.</p>';
  const conflicts=p.compatibility.blockers;
  return '<section class="amend-comparison"><h4>Reviewed plan comparison</h4><p>Baseline revision '+p.source.plan.revision+' → selected revision '+p.selectedPlan.revision+' · original case version '+p.observedVersion+'</p>'
    +'<p><strong>'+(conflicts.length?'Resolve '+conflicts.length+' retained-record conflict'+(conflicts.length===1?'':'s'):'The selected plan preserves the referenced records and original receipt clocks')+'</strong></p>'
    +(conflicts.length?table(['Conflict','Original target','Explanation','Retained references'],conflicts.map(v=>[esc(v.code),esc(v.id??v.tranche??''),esc(v.message),'<pre>'+esc(pretty(v.references??{before:v.before,after:v.after}))+'</pre>'])):'')
    +'<p>Case calendar anchor: '+esc(p.compatibility.caseCalendarStart??'Undated')+'. Selected planner anchor: '+esc(p.compatibility.selectedPlanningCalendarStart??'Undated')+'. The existing case retains its own anchor.</p>'
    +'<details open><summary>All '+p.changes.length+' selected input changes</summary>'+table(['Original input','Before','Selected revision'],p.changes.map(v=>[esc(v.path),v.beforePresent?'<pre>'+esc(pretty(v.before))+'</pre>':'Absent',v.afterPresent?'<pre>'+esc(pretty(v.after))+'</pre>':'Absent']))+'</details>'
    +attributionPreview(p)
    +'<h4>Recorded work and financial exposure</h4><p>These amounts compare the selected budget with recorded invoices, allocated payments and logged work. Remaining amounts do not establish unrecorded commitments or spendable cash. Paid-against-plan and invoiced-against-plan are separate comparisons.</p>'
    +'<details><summary>Original baseline</summary>'+exposureTable(p.exposure.before)+'</details>'
    +'<details open><summary>Selected baseline</summary>'+exposureTable(p.exposure.selected)+'</details>'
    +'<details><summary>Original payment-derived clocks</summary><pre>'+esc(pretty(p.paymentClocks))+'</pre></details>'
    +'<details><summary>Complete native reports and source pins</summary><pre>'+esc(pretty({source:p.source,reports:p.reports,previewSha256:p.previewSha256}))+'</pre></details></section>';
}
export function mountAmendments({container,current,api,saveApi=api,session={},mutationId,recordingActor,onCase,onSources,onCalendarOpen,planningReturn=null,onPlanningReturn,onOpenPlanning}){
  if(!document.querySelector('link[data-sf47-amendments]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./operations_amendments.css',import.meta.url).href;link.dataset.sf47Amendments='';document.head.append(link);
  }
  const root=document.createElement('section');root.className='plan-amendments';root.setAttribute('aria-label','Plan amendments');container.replaceChildren(root);
  const caseId=current.program.id,planId=current.program.planId,base='/api/operations/'+caseId,sessionKey='sf47.amendments.'+caseId;
  let active=true,hostBusy=false,busy=false,caseNow=current,index=null,desk=null,drafts=[],detail=null,preview=null,mappingPlan=null,error='',storageFault=false,serial=Promise.resolve(),opening=0;
  if(planningReturn)session.planningReturn=clone(planningReturn);
  const available=()=>active&&root.isConnected;
  const $=selector=>root.querySelector(selector);
  function storageRecovery(){
    if(!available())return;
    let panel=$('[data-amend-storage-recovery]');
    if(!panel&&storageFault){panel=document.createElement('section');panel.dataset.amendStorageRecovery='';root.prepend(panel);}
    if(!panel)return;
    panel.hidden=!storageFault;panel.className='amend-warning';
    if(storageFault&&!panel.hasChildNodes())panel.innerHTML='<h4>Keep the current fields and recover browser storage</h4><p>The visible proposal, review and application fields remain here. Download them before reopening the retained browser edition. Reopening also downloads that complete current selection first.</p><div class="amend-actions">'+button('Download all current fields','draft-export')+button('Download fields and reopen saved draft','reload-local')+'</div>';
    if(!storageFault)panel.replaceChildren();
  }
  function showError(value){error=value?.message||String(value);if(available()){const node=$('[data-amend-error]');if(node)node.textContent=error;controls();}}
  function validDesk(value){
    if(!value||value.schema!==SCHEMA||value.caseId!==caseId||value.planId!==planId||!value.id||!value.draft?.token||!Number.isInteger(value.sequence))throw new Error('This local amendment draft belongs to another case or format.');
    if(value.pending&&(value.pending.caseId!==caseId||value.pending.planId!==planId))throw new Error('The retained request belongs to another original case.');
    return value;
  }
  function retain(change){
    const target=desk?.id;
    const work=serial.then(async()=>{
      if(!desk||desk.id!==target)throw new Error('The selected local draft changed before it could be retained.');
      const old=desk,next=clone(desk);change(next);next.sequence=old.sequence+1;next.updatedAt=new Date().toISOString();
      try{await writeDraft(next,old.sequence);desk=next;session.deskId=next.id;storageFault=false;return next;}
      catch(exc){storageFault=true;desk={...next,sequence:old.sequence};showError(exc);throw exc;}
    });
    serial=work;
    work.catch(()=>{});
    return work;
  }
  function remember(id){session.deskId=id;try{sessionStorage.setItem(sessionKey,id);}catch{}}
  function blank(inputs){
    return {schema:SCHEMA,id:'amend-draft-'+crypto.randomUUID(),caseId,planId,sequence:1,
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
      draft:{token:crypto.randomUUID(),amendmentId:null,amendmentRevision:0,amendmentSha256:null,
        inputs:inputs||{selectedRevision:null,expectedContentSha256:'',asOfDate:date(),reason:'',packageMappings:[],
          basis:{kind:caseNow.program.mode==='WALKTHROUGH'?'WALKTHROUGH':'INTERNAL_PLAN',reference:'',date:null,sourceIds:[],note:''}}},
      selection:null,review:{decision:'APPROVE',statement:'',sourceIds:[],note:''},applyNote:'',
      pending:null,receipts:[]};
  }
  async function createDraft(source=null){
    await serial;if(desk?.pending)throw new Error('Recover the original pending request before opening another draft.');
    let next=blank(source?clone(source.preview.inputs):null);
    if(source){next.draft.amendmentId=source.id;next.draft.amendmentRevision=source.revision;next.draft.amendmentSha256=source.sha256;next.selection={id:source.id,revision:source.revision};}
    await writeDraft(next,0);desk=next;remember(next.id);preview=null;detail=source?{amendment:source,current:null,history:[]}:null;drafts=await listDrafts(caseId,planId);render();
    await loadMappingPlan();
    if(next.selection)await openSaved(next.selection.id,next.selection.revision,false);
  }
  async function openDraft(id){
    await serial;if(desk?.pending&&desk.id!==id)throw new Error('Recover the retained request in this draft before changing local work.');
    desk=validDesk(await readDraft(id));remember(id);preview=null;detail=null;storageFault=false;serial=Promise.resolve();render();
    await loadMappingPlan();
    if(desk.selection)await openSaved(desk.selection.id,desk.selection.revision,false);
  }

  function originalPlanningReturn(value){
    if(!value||value.caseId!==caseId||value.planId!==planId||typeof value.id!=='string'||
      !value.id||typeof value.draftId!=='string'||!Number.isSafeInteger(value.revision)||value.revision<1||
      !/^[a-f0-9]{64}$/.test(value.contentSha256??'')||!/^\d{4}-\d{2}-\d{2}$/.test(value.asOfDate??'')||
      typeof value.reason!=='string')throw new Error('Return the exact saved planning revision to its original case.');
    return value;
  }
  async function receivePlanningReturn(){
    await serial;
    const incoming=session.planningReturn;if(!incoming)return false;
    const selection=originalPlanningReturn(incoming);
    drafts=await listDrafts(caseId,planId);
    const existing=drafts.find(value=>value.planningReturn?.id===selection.id);
    if(desk?.pending&&desk.id!==existing?.id){render();return false;}
    const selected=await saveApi('/api/plans/'+planId+'/revision/'+selection.revision);
    if(selected.id!==planId||selected.revision!==selection.revision||selected.contentSha256!==selection.contentSha256)
      throw new Error('The returned native revision differs from its saved source. Keep the original planning draft.');
    if(existing){
      validDesk(existing);
      if(canonical(existing.planningReturn)!==canonical(selection))throw new Error('This returned planning identity has different retained content.');
      await openDraft(existing.id);
      await onPlanningReturn?.(selection,existing.id);
    }else if(caseNow.plan.revision===selection.revision&&caseNow.plan.contentSha256===selection.contentSha256){
      await onPlanningReturn?.(selection,null);
    }else{
      const next=blank();
      next.draft.inputs.selectedRevision=selection.revision;
      next.draft.inputs.expectedContentSha256=selection.contentSha256;
      next.draft.inputs.asOfDate=selection.asOfDate;
      next.draft.inputs.reason=selection.reason;
      next.planningReturn=clone(selection);
      await writeDraft(next,0);desk=next;remember(next.id);preview=null;detail=null;
      drafts=await listDrafts(caseId,planId);render();await loadMappingPlan();
      await onPlanningReturn?.(selection,next.id);
    }
    if(session.planningReturn?.id===selection.id)session.planningReturn=null;
    render();return true;
  }
  function planningReturnHtml(){
    const value=session.planningReturn;
    if(!value)return '';
    return '<section class="amend-warning"><h4>Saved workbook revision ready for this case</h4><p>Revision '+
      esc(value.revision)+' · comparison date '+esc(value.asOfDate)+' · <code>'+esc(value.contentSha256)+
      '</code></p><p>The complete planning draft retains this exact saved selection. Receive the original pending request in the current amendment before opening it.</p>'+
      button('Open returned planning revision','planning-return','',Boolean(desk?.pending))+'</section>';
  }

  async function refresh(){
    const [next,listing]=await Promise.all([saveApi(base),saveApi(base+'/amendments')]);
    if(next.program.id!==caseId||next.program.planId!==planId||listing.program.id!==caseId||listing.program.version!==next.program.version)throw new Error('The case changed during this read. Refresh the original case again before choosing an amendment.');
    caseNow=next;index=listing;drafts=await listDrafts(caseId,planId);
    return next;
  }
  async function openSaved(id,revision,rememberSelection=true){
    const chosen=++opening;
    if(rememberSelection)await retain(value=>{value.selection={id,revision};});
    const received=await saveApi(base+'/amendments/'+encodeURIComponent(id)+(revision?'?revision='+revision:''));
    if(!available()||chosen!==opening||desk.selection?.id!==id||(revision&&desk.selection?.revision!==revision))return;
    detail=received;render();
  }
  async function loadMappingPlan(){
    const selected=desk?.draft,token=selected?.token,inputs=selected?.inputs;
    mappingPlan=null;
    if(!inputs?.selectedRevision)return;
    const revision=inputs.selectedRevision,expected=inputs.expectedContentSha256;
    const value=await saveApi('/api/plans/'+encodeURIComponent(planId)+'/revision/'+revision);
    if(!desk||desk.draft.token!==token||desk.draft.inputs.selectedRevision!==revision||desk.draft.inputs.expectedContentSha256!==expected)return;
    if(value.id!==planId||value.revision!==revision||value.contentSha256!==expected)
      throw new Error('The selected native revision differs from this draft’s retained content. Choose the intended revision explicitly and preview it again.');
    mappingPlan=value;
    const panel=$('[data-amend-mappings]');if(panel){panel.innerHTML=mappingHtml();controls();}
  }
  function mappingHtml(){
    if(!desk)return '';
    const values=desk.draft.inputs.packageMappings;
    if(!Array.isArray(values))return '<section><h4>Package attribution</h4><p>This saved proposal retains its original comparison format. Enable the reviewed package mapping editor to prepare a new proposal edition with explicit package reassignment and completion reconciliation.</p>'+
      button('Enable reviewed package reassignment','enable-mappings')+'</section>';
    const target=mappingPlan&&mappingPlan.revision===desk.draft.inputs.selectedRevision&&mappingPlan.contentSha256===desk.draft.inputs.expectedContentSha256?mappingPlan:null;
    const after=new Map((target?.scenario.future_costs||[]).map(row=>[row.id,row]));
    const mappings=new Map(values.map(row=>[row.fromCostId,row]));
    const options=[['keep','Keep current attribution'],['unassigned','Explicitly unassigned'],...(target?.scenario.future_costs||[]).map(row=>['cost:'+row.id,row.id+' · tranche '+row.tranche])];
    return '<section><h4>Package attribution in the selected revision</h4><p>Map each retired package used by actual work, invoice lines or deployments. A package moving to another tranche needs an explicit mapping; select the same ID to retain its identity. The reason accompanies the original review. Cash allocations remain on their original invoice and line IDs.</p>'+
      (!target?'<p>Select the saved revision to load its exact available packages.</p>':'')+
      table(['Original package','Selected plan','Attribution choice','Reason'],caseNow.plan.scenario.future_costs.map(row=>{
        const saved=mappings.get(row.id),next=after.get(row.id),selected=saved?(saved.toCostId===null?'unassigned':'cost:'+saved.toCostId):'keep';
        const choices=[...options];if(saved&&saved.toCostId!==null&&!choices.some(value=>value[0]===selected))choices.push([selected,saved.toCostId+' · retained selection; verify target revision']);
        return [esc(row.id)+'<small>Tranche '+row.tranche+' · '+esc(money(row.amount_usd))+'</small>',
          target?(next?'Tranche '+next.tranche+' · '+esc(money(next.amount_usd)):'Retired from selected plan'):'Revision not loaded',
          input('Attribution for '+row.id,'mapTarget.'+row.id,selected,{options:choices}),
          input('Reason for '+row.id,'mapNote.'+row.id,saved?.note??desk.mappingNotes?.[row.id]??'',{area:true})];
      }))+'</section>';
  }
  function fieldValue(target){return target.type==='checkbox'?target.checked:target.multiple?[...target.selectedOptions].map(o=>o.value):target.value;}
  function fieldInto(next,name,value){
    if(name==='selectedRevision'){
      const row=index?.revisions.find(v=>String(v.revision)===String(value));
      next.draft.inputs.selectedRevision=row?.revision??null;next.draft.inputs.expectedContentSha256=row?.sha256??'';
    }else if(name.startsWith('mapTarget.')){
      const id=name.slice(10),rows=next.draft.inputs.packageMappings||[],prior=rows.find(row=>row.fromCostId===id);
      next.draft.inputs.packageMappings=rows.filter(row=>row.fromCostId!==id);
      if(value!=='keep')next.draft.inputs.packageMappings.push({fromCostId:id,
        toCostId:value==='unassigned'?null:value.slice(5),note:prior?.note??next.mappingNotes?.[id]??''});
    }else if(name.startsWith('mapNote.')){
      const id=name.slice(8),row=next.draft.inputs.packageMappings?.find(value=>value.fromCostId===id);
      next.mappingNotes={...next.mappingNotes,[id]:value};if(row)row.note=value;
    }else if(name==='reason'||name==='asOfDate')next.draft.inputs[name]=value;
    else if(name.startsWith('basis.'))next.draft.inputs.basis[name.slice(6)]=value===''&&name==='basis.date'?null:value;
    else if(name.startsWith('review.'))next.review[name.slice(7)]=value;
    else if(name==='applyNote')next.applyNote=value;
    else if(name==='acknowledgeBaselineChange')next.displayedAcknowledgment=Boolean(value);
  }
  function visibleDraft(){
    if(!desk)throw new Error('Open the original local draft before exporting its fields.');
    const retained=clone(desk);
    for(const el of root.querySelectorAll('[data-amend-form] [name],[data-amend-review] [name],[data-amend-apply] [name]'))fieldInto(retained,el.name,fieldValue(el));
    return retained;
  }
  function inputChange(target){
    const name=target.name,value=fieldValue(target);
    if(!desk||!name)return;
    preview=null;
    const changed=retain(next=>fieldInto(next,name,value));
    changed.then(async()=>{if(available()){const b=$('[data-amend-action="save"]');if(b)b.disabled=true;}
      if(name==='selectedRevision')await loadMappingPlan();}).catch(showError);
  }
  function controls(){
    if(!available())return;
    storageRecovery();
    root.setAttribute('aria-busy',String(busy||hostBusy));
    root.querySelectorAll('button').forEach(b=>{b.disabled=Boolean(b.dataset.amendFixed)||busy||hostBusy;});
    root.querySelectorAll('input,select,textarea').forEach(el=>{el.disabled=hostBusy||!desk||storageFault;});
    // Text entered after dispatch remains a later local draft. It never changes
    // the retained request which is already on the original native transaction.
    if(desk?.pending)root.querySelectorAll('[data-amend-mutation]').forEach(b=>b.disabled=true);
  }
  function render(){
    if(!available())return;
    const row=detail?.amendment,latest=detail?.current;
    const sameEdition=!!row&&(!latest||latest.revision===row.revision);
    const canReview=!!row&&sameEdition&&row.state!=='APPLIED'&&latest?.current?.businessMatches===true&&caseNow.program.state==='OPEN';
    const canApply=canReview&&row.state==='REVIEWED';
    const d=desk?.draft,items=index?.revisions||[],sourceOptions=(index?.sources||current.sources).map(s=>[s.id,s.filename+' · '+s.sha256.slice(0,12)]);
    const pending=desk?.pending;
    root.innerHTML='<header><div><h3>Plan amendments</h3><p>Select an actual saved native planning revision for this existing Delivery case. Review the complete budget change and any explicit package reassignment while retaining original observations, sources and case history.</p></div><div class="amend-actions">'+button('Refresh case and plans','refresh')+(onOpenPlanning?button('Edit plan and workbook','planning','',Boolean(desk?.pending)):'')+button('Sources','sources')+button('Export complete case','export-case')+'</div></header>'
      +'<p>Case <code>'+esc(caseId)+'</code> · version '+caseNow.program.version+' · current baseline revision '+caseNow.program.planRevision+' · '+esc(caseNow.program.mode)+'</p>'
      +'<p role="alert" data-amend-error>'+esc(error)+'</p>'
      +'<section data-amend-storage-recovery hidden></section>'+planningReturnHtml()
      +(pending?'<section class="amend-warning"><h4>Original request retained</h4><p>'+esc(pending.body.action)+' · <code>'+esc(pending.body.requestId)+'</code> · original case version '+pending.body.expectedVersion+'</p><p>'+esc(pending.error?.message||'Recover this request through the original transaction before recording another mutation.')+'</p><div class="amend-actions">'+button('Retry exact request','retry')+button('Download retained request','request-export')+(pending.error?.rejected?button('Keep draft and resolve rejected request','resolve-rejected'):'')+'</div></section>':'')
      +'<section><h4>Local work</h4><div class="amend-actions">'+input('Retained browser draft','localDraft',desk?.id||'',{options:[['','Select a retained draft'],...drafts.map(v=>[v.id,(v.draft.inputs.reason||'New amendment').slice(0,90)+' · '+v.updatedAt+(v.pending?' · request pending':'')])]})+button('New amendment draft','new')+(desk?button('Download local draft','draft-export'):'')+'</div>'
      +(d?'<form data-amend-form><div class="amend-fields">'+input('Saved native planning revision','selectedRevision',d.inputs.selectedRevision??'',{required:true,options:[['','Select an exact saved revision'],...items.filter(v=>v.revision!==caseNow.program.planRevision||v.revision===d.inputs.selectedRevision).map(v=>[v.revision,'Revision '+v.revision+' · '+v.savedAt+' · '+(v.note||'')])],help:'Save a partial change in the original planner, then select that complete revision here.'})
      +input('Comparison date','asOfDate',d.inputs.asOfDate,{type:'date',required:true})
      +input('Reason and intended change','reason',d.inputs.reason,{area:true,required:true,wide:true})
      +input('Decision basis','basis.kind',d.inputs.basis.kind,{options:[['INTERNAL_PLAN','Internal planning choice'],['ISSUER_DECISION','Original issuer decision'],['CUSTOMER_DECISION','Original customer decision'],...(caseNow.program.mode==='WALKTHROUGH'?[['WALKTHROUGH','Labelled walkthrough']]:[])]})
      +input('Original decision date','basis.date',d.inputs.basis.date,{type:'date'})
      +input('Original decision reference','basis.reference',d.inputs.basis.reference,{wide:true})
      +input('Retained decision attachments','basis.sourceIds',d.inputs.basis.sourceIds,{multiple:true,options:sourceOptions,wide:true})
      +input('Source and decision note','basis.note',d.inputs.basis.note,{area:true,wide:true})
      +'</div><div data-amend-mappings>'+mappingHtml()+'</div><p>'+esc(d.amendmentId?'Editing original amendment '+d.amendmentId+' from edition '+d.amendmentRevision+'.':'This draft will create one new amendment identity.')+'</p><div class="amend-actions">'+button('Preview complete amendment','preview')+button('Save proposal','save','data-amend-mutation',!preview||caseNow.program.state!=='OPEN')+'</div></form>':'<p>Open a retained local draft or start a new one.</p>')
      +previewHtml(preview)+calendarImpactHtml(preview?.calendarImpact,'draft')+'</section>'
      +'<section><h4>Saved proposals and applied baselines</h4>'+((index?.amendments||[]).length?table(['Original amendment','State / edition','Baseline change','Reason','Open'],index.amendments.map(a=>[
        '<code>'+esc(a.id)+'</code>',esc(a.state)+' / '+a.revision,a.fromPlan.revision+' → '+a.selectedPlan.revision,esc(a.reason),
        button('Open exact edition','open','data-id="'+a.id+'" data-revision="'+a.revision+'"')])):'<p>No amendment has been recorded in this case.</p>')+'</section>'
      +(row?'<section class="amend-saved"><h4>Saved amendment '+esc(row.id)+' · edition '+row.revision+'</h4><p>'+esc(row.state)+' · saved by '+esc(row.actor)+' at '+esc(row.updatedAt)+'</p><p>Selected source: <code>'+esc(row.preview.selectedPlan.contentSha256)+'</code></p>'
        +(!sameEdition?'<p class="amend-warning">A newer amendment edition exists. This complete historical edition remains available for inspection.</p>':'')
        +(latest&&!latest.current?.businessMatches&&row.state!=='APPLIED'?'<p class="amend-warning">The case baseline or its recorded facts changed since this proposal. Revise the proposal and preview it against the current case before deciding.</p>':'')
        +'<div class="amend-actions">'+button('Download complete saved amendment','saved-export')+button('Revise proposal in a new local draft','revise','',row.state==='APPLIED'||!sameEdition)+((detail.history||[]).length?input('Original amendment edition','savedEdition',row.revision,{options:detail.history.map(h=>[h.revision,h.revision+' · '+h.state+' · case version '+h.version])}):'')+'</div>'
        +previewHtml(row.preview)+calendarImpactHtml(detail.calendarImpact,'saved')
        +(row.review?'<h4>Retained operator review</h4><pre>'+esc(pretty(row.review))+'</pre>':'')
        +(row.application?'<h4>Applied baseline receipt</h4><pre>'+esc(pretty(row.application))+'</pre>':'')
        +(canReview&&desk?'<form data-amend-review><h4>Record your review of this exact edition</h4><p>The authenticated recording operator records this decision. Issuer or customer authority remains the selected original source.</p><div class="amend-fields">'
          +input('Decision','review.decision',desk.review.decision,{options:[['APPROVE','Approve this planning amendment'],['RETURN_FOR_CHANGES','Return for changes']]})
          +input('Review statement','review.statement',desk.review.statement,{area:true,required:true,wide:true})
          +input('Review attachments','review.sourceIds',desk.review.sourceIds,{multiple:true,options:sourceOptions,wide:true})
          +input('Reason recorded in case history','review.note',desk.review.note,{area:true,required:true,wide:true})
          +'</div>'+button('Record exact review','review','data-amend-mutation')+'</form>':'')
        +(canApply&&desk?'<form data-amend-apply><h4>Apply this reviewed baseline</h4><p>This changes the selected planning baseline in the same case. The listed work, invoices, cash, original payment clocks and earlier saved reports retain their identities and history.</p>'
          +input('Application note','applyNote',desk.applyNote,{area:true,required:true,wide:true})
          +'<label class="amend-check"><input type="checkbox" name="acknowledgeBaselineChange"> I have reviewed this exact saved amendment and select it for this case.</label>'
          +button('Apply reviewed baseline','apply','data-amend-mutation')+'</form>':'')
        +'</section>':'');
    controls();
  }
  async function run(action){
    if(!available()||busy||hostBusy)return;
    busy=true;error='';controls();
    try{await action();}
    catch(exc){showError(exc);}
    finally{busy=false;if(available()){const node=$('[data-amend-error]');if(node)node.textContent=error;controls();}}
  }
  async function previewDraft(){
    await serial;
    const token=desk.draft.token,inputs=clone(desk.draft.inputs);
    await refresh();
    const result=await api(base+'/amendment-preview',{expectedVersion:caseNow.program.version,inputs});
    await serial;
    if(desk.draft.token!==token||canonical(desk.draft.inputs)!==canonical(inputs)){preview=null;error='Later draft inputs were retained. Preview those inputs before saving.';render();return;}
    await retain(next=>{next.draft.inputs=clone(result.inputs);});
    preview=result;render();
  }
  async function issue(action,data,note){
    await serial;if(storageFault)throw new Error('Retain or recover the local draft before recording this action.');
    if(desk.pending)throw new Error('Recover the original retained request first.');
    const body={expectedVersion:caseNow.program.version,actor:recordingActor(),note,action,data:clone(data)};
    body.requestId=await mutationId('operations:'+caseId,body);
    await retain(next=>{next.pending={caseId,planId,body:clone(body),draftToken:next.draft.token,startedAt:new Date().toISOString(),error:null};});
    render();await sendPending();
  }
  async function sendPending(){
    await serial;const pending=clone(desk.pending);
    if(!pending)throw new Error('No original request is pending.');
    if(pending.caseId!==caseId||pending.planId!==planId)throw new Error('The retained request belongs to another case.');
    let result;
    try{result=await saveApi(base+'/command',pending.body);}
    catch(exc){
      const rejected=[409,413,422].includes(exc.status)&&exc.code&&exc.code!=='REQUEST_CONFLICT';
      await retain(next=>{if(next.pending?.body.requestId===pending.body.requestId)next.pending.error={message:exc.message,code:exc.code||null,status:exc.status||null,rejected:Boolean(rejected)};});
      if(available())render();throw exc;
    }
    if(result.id!==caseId||result.action!==pending.body.action||result.kind!=='amendment'||!result.recordId||!result.amendmentRevision)throw new Error('The original response did not identify this amendment; keep the retained request for recovery.');
    await retain(next=>{
      if(next.pending?.body.requestId!==pending.body.requestId)throw new Error('The original local request changed during its response.');
      next.receipts.push({requestId:pending.body.requestId,request:pending.body,result:clone(result),receivedAt:new Date().toISOString()});
      next.receipts=next.receipts.slice(-12);
      // Bind a creation/save result on both the ordinary path and exact replay.
      // Later text stays in place; another draft token never inherits this ID.
      if(pending.body.action==='amendment.save'&&next.draft.token===pending.draftToken){
        next.draft.amendmentId=result.recordId;next.draft.amendmentRevision=result.amendmentRevision;next.draft.amendmentSha256=result.amendmentSha256;
      }
      next.selection={id:result.recordId,revision:result.amendmentRevision};next.pending=null;
    });
    preview=null;
    const next=await refresh();
    if(available()){await openSaved(result.recordId,result.amendmentRevision,false);if(available())await onCase?.(next,result);}
  }
  root.addEventListener('input',event=>{
    const target=event.target;
    if(target.name&&target.name!=='localDraft'&&target.name!=='savedEdition'&&target.name!=='acknowledgeBaselineChange')inputChange(target);
  });
  root.addEventListener('change',event=>{
    const target=event.target;
    if(target.matches('[data-amend-calendar-filter]')){filterCalendarImpact(target);return;}
    if(target.name==='localDraft'&&target.value)run(()=>openDraft(target.value));
    if(target.name==='savedEdition')run(()=>openSaved(detail.amendment.id,Number(target.value)));
  });
  root.addEventListener('submit',event=>event.preventDefault());
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-amend-action]');if(!target||!root.contains(target))return;
    const action=target.dataset.amendAction;
    run(async()=>{
      if(action==='calendar-export'||action==='calendar-open'){
        const saved=target.dataset.calendarScope==='saved';
        const impact=saved?detail?.calendarImpact:preview?.calendarImpact;
        if(!impact)throw new Error('Open the original complete calendar comparison first.');
        if(action==='calendar-open'){
          const selection=calendarImpactSelection(impact,target.dataset.calendarEntry);
          if(selection)onCalendarOpen?.(selection.tab,selection.tranche,selection.context);
          return;
        }
        const selected= saved ? {amendmentId:detail.amendment.id,revision:detail.amendment.revision,
          expectedAmendmentSha256:detail.amendment.sha256,expectedImpactSha256:impact.impactSha256}
          : {expectedVersion:preview.observedVersion,inputs:clone(preview.inputs),
             expectedPreviewSha256:preview.previewSha256,expectedImpactSha256:impact.impactSha256};
        const response=await saveApi(base+'/amendment-calendar-export',selected,{download:true});
        download(await response.blob(),caseId+'-amendment-calendars.zip','application/zip');return;
      }
      if(action==='draft-export'){
        await serial.catch(()=>{});
        const retained=visibleDraft();download(retained,retained.id+'.json');return;
      }
      if(action==='reload-local'){
        await serial.catch(()=>{});const retained=visibleDraft();
        download(retained,retained.id+'-before-browser-reopen.json');
        const id=desk.id;serial=Promise.resolve();await openDraft(id);return;
      }
      if(action==='sources'){onSources?.();return;}
      if(action==='planning'){
        await serial;if(desk?.pending)throw new Error('Receive the original retained amendment request before opening planning work.');
        await onOpenPlanning?.({asOfDate:desk?.draft.inputs.asOfDate||date(),amendmentDraftId:desk?.id??null});return;
      }
      if(action==='planning-return'){await receivePlanningReturn();return;}
      if(action==='export-case'){const response=await saveApi(base+'/export.zip',undefined,{download:true});download(await response.blob(),caseId+'-complete.zip','application/zip');return;}
      await serial;
      if(action==='refresh'){await refresh();await loadMappingPlan();if(desk?.selection)await openSaved(desk.selection.id,desk.selection.revision,false);render();return;}
      if(action==='new'){await createDraft();return;}
      if(action==='enable-mappings'){
        await retain(next=>{next.draft.inputs.packageMappings=[];});preview=null;
        await loadMappingPlan();render();return;
      }
      if(action==='open'){if(!desk)await createDraft();await openSaved(target.dataset.id,Number(target.dataset.revision));return;}
      if(action==='revise'){await createDraft(detail.amendment);return;}
      if(action==='preview'){if(!$('[data-amend-form]').reportValidity())return;await previewDraft();return;}
      if(action==='save'){
        if(!preview||canonical(preview.inputs)!==canonical(desk.draft.inputs))throw new Error('Preview the complete current inputs before saving.');
        await issue('amendment.save',{amendmentId:desk.draft.amendmentId,expectedRevision:desk.draft.amendmentRevision,inputs:clone(desk.draft.inputs),expectedPreviewSha256:preview.previewSha256},desk.draft.inputs.reason);return;
      }
      if(action==='review'){
        if(!$('[data-amend-review]').reportValidity())return;const row=detail.amendment;
        await issue('amendment.review',{amendmentId:row.id,expectedRevision:row.revision,expectedAmendmentSha256:row.sha256,
          expectedPreviewSha256:row.preview.previewSha256,decision:desk.review.decision,statement:desk.review.statement,sourceIds:desk.review.sourceIds},desk.review.note);return;
      }
      if(action==='apply'){
        if(!$('[data-amend-apply]').reportValidity())return;
        if(!$('[name=acknowledgeBaselineChange]').checked)throw new Error('Explicitly select applying this reviewed baseline.');
        const row=detail.amendment;await issue('amendment.apply',{amendmentId:row.id,expectedRevision:row.revision,expectedAmendmentSha256:row.sha256,acknowledgeBaselineChange:true},desk.applyNote);return;
      }
      if(action==='retry'){await sendPending();return;}
      if(action==='request-export'){download(desk.pending,'Original_Amendment_Request.json');return;}
      if(action==='resolve-rejected'){
        if(!desk.pending?.error?.rejected)throw new Error('The original request has not returned a confirmed native rejection.');
        await retain(next=>{next.receipts.push({rejected:clone(next.pending),resolvedAt:new Date().toISOString()});next.receipts=next.receipts.slice(-12);next.pending=null;});
        preview=null;await refresh();render();return;
      }
      if(action==='saved-export'){download(detail.amendment,detail.amendment.id+'-edition-'+detail.amendment.revision+'.json');return;}
    });
  });
  const ready=(async()=>{
    await refresh();
    let retained=session.deskId;try{retained=retained||sessionStorage.getItem(sessionKey);}catch{}
    if(retained&&drafts.some(v=>v.id===retained))await openDraft(retained);
    if(session.planningReturn)await receivePlanningReturn();
    if(!desk&&drafts.length===0)await createDraft();
    else render();
  })();
  ready.catch(showError);
  return {ready,dispose(){active=false;opening++;},setHostBusy(value){hostBusy=Boolean(value);controls();}};
}
