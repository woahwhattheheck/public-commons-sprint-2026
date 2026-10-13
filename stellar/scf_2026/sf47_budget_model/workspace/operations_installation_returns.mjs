import { mountCompanyReturnIntake } from "./operations_company_returns.mjs";
// Complete receiver-to-owner handover in the original Operations application.
const SCHEMA='sf47.installation-return-editor.v1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>structuredClone(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const pretty=value=>esc(JSON.stringify(value,null,2));
const button=(label,action,extra='',fixed=false)=>'<button type="button" data-return-action="'+action+'" '+extra+(fixed?' disabled data-return-fixed="true"':'')+'>'+esc(label)+'</button>';
const table=(heads,rows)=>'<div class="ir-table"><table><thead><tr>'+heads.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const STATES=['OPEN','IN_PROGRESS','ACCEPTED','CHANGES_REQUIRED','NOT_APPLICABLE'];
function field(label,path,value='',config={}){
  const attrs=' data-return-field="'+esc(path)+'"'+(config.required?' required':'');
  let input;
  if(config.options)input='<select'+attrs+(config.multiple?' multiple size="3"':'')+'>'+config.options.map(([id,name])=>'<option value="'+esc(id)+'"'+((config.multiple?(value||[]).includes(id):String(value??'')===String(id))?' selected':'')+'>'+esc(name)+'</option>').join('')+'</select>';
  else if(config.area)input='<textarea'+attrs+' rows="'+(config.rows||3)+'" maxlength="'+(config.max||8000)+'">'+esc(value)+'</textarea>';
  else input='<input'+attrs+' value="'+esc(value)+'" maxlength="'+(config.max||1000)+'">';
  return '<label'+(config.wide?' class="ir-wide"':'')+'><span>'+esc(label)+'</span>'+input+(config.help?'<small>'+esc(config.help)+'</small>':'')+'</label>';
}
function assign(target,path,value){const keys=path.split('.');let at=target;for(const key of keys.slice(0,-1))at=at[key];at[keys.at(-1)]=value;}
function saveFile(raw,name,type='application/json'){
  const url=URL.createObjectURL(raw instanceof Blob?raw:new Blob([raw],{type}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
export function mountInstallationReturns({container,current,api,saveApi,session,mutationId,recordingActor,onCase,onSources,onInstallations}){
  const root=document.createElement('section');root.className='installation-return-desk';
  root.setAttribute('aria-label','Installation receiving returns');container.replaceChildren(root);
  if(!document.querySelector('link[data-installation-return-style]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='/operations_installation_returns.css';
    link.dataset.installationReturnStyle='true';document.head.append(link);
    const companyStyle=document.createElement('link');companyStyle.rel='stylesheet';companyStyle.href='/operations_company_returns.css';document.head.append(companyStyle);
  }
  const caseId=current.program.id,prefix='/api/operations/'+caseId,storageKey='sf47.installation-returns.'+caseId;
  const savedKeys=['mode','receiver','owner','selectedReview','pending','accepted','rejected','notice','stage','previousDrafts','returnCase','returnOptions','companyNoteDrafts'];
  if(!session.initialized){
    let stored;try{stored=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{}
    if(stored?.schema===SCHEMA&&stored.caseId===caseId)for(const key of savedKeys)if(Object.hasOwn(stored,key))session[key]=stored[key];
    session.initialized=true;
  }
  for(const [key,value] of Object.entries({mode:'receiver',receiver:null,owner:null,selectedReview:null,
    pending:null,accepted:null,rejected:[],stage:null,notice:'',inflight:null,companyNoteDrafts:{}}))if(!Object.hasOwn(session,key))session[key]=value;
  let packageDesk=null,packageBusy=false;
  let active=true,busy=false,hostBusy=false,generation=0,caseValue=current,reviewList=[],cases=[],savedRow=null,returnedRow=null,
    draftPreview=null,previewInput=null,installationPreview=null,installationInput=null,stageSeed=null,error='',storageNotice='';
  const $=selector=>root.querySelector(selector),available=()=>active&&root.isConnected;
  const currentDraft=()=>session.mode==='receiver'?session.receiver:session.mode==='owner'?session.owner:null;
  const writable=()=>caseValue.program.state==='OPEN';
  const guard=epoch=>available()&&epoch===generation;
  function persist(required=false){
    const body={schema:SCHEMA,caseId};for(const key of savedKeys)body[key]=session[key];
    try{sessionStorage.setItem(storageKey,JSON.stringify(body));storageNotice='';}
    catch(cause){storageNotice='The browser cannot retain this complete local draft. Download it before closing.';
      if(required)throw new Error('The browser could not retain the original request before dispatch. Download the complete draft and restore browser space.');}
  }
  function capture(){
    const draft=currentDraft();if(!draft)return;
    for(const input of root.querySelectorAll('[data-return-field]')){
      let value=input.multiple?[...input.selectedOptions].map(x=>x.value):input.value;
      const path=input.dataset.returnField;
      if(path.endsWith('.observedAt')&&value==='')value=null;
      assign(draft.inputs,path,value);
    }
    const note=$('[data-return-save-note]');if(note)draft.note=note.value;
    if(previewInput&&!same(previewInput,draft.inputs))draftPreview=null;
    persist();
  }
  function controls(){
    if(!available())return;
    const locked=hostBusy||busy||!!session.inflight||!!session.pending||!!session.accepted;
    root.setAttribute('aria-busy',String(hostBusy||busy||!!session.inflight));
    for(const el of root.querySelectorAll('button,input,select,textarea')){
      if(el.closest('[data-company-intake]'))continue;
      const action=el.dataset.returnAction;
      let disabled=el.dataset.returnFixed==='true'||hostBusy||busy||packageBusy||!!session.inflight;
      if(el.matches('[data-return-field],[data-return-save-note]'))disabled=locked||!writable();
      if(['new-receiver','load-return','load-retained-return','regenerate-stage','preview','save','stage-preview','stage-save'].includes(action))disabled=disabled||!!session.pending||!!session.accepted||!writable();
      if(action==='save')disabled=disabled||!draftPreview||!same(previewInput,currentDraft()?.inputs);
      if(action==='stage-preview')disabled=disabled||stageSeed?.savedInstallations?.length>0||stageSeed?.application?.canSave===false;
      if(action==='stage-save')disabled=disabled||!installationPreview||!same(installationInput,session.stage?.document);
      el.disabled=disabled;
    }
    packageDesk?.setHostBusy(hostBusy||busy||!!session.inflight||!!session.pending||!!session.accepted);
  }
  function fail(cause){error=cause?.message||String(cause);if(available())render();}
  async function run(fn){
    if(!available()||hostBusy||busy||packageBusy||session.inflight)return;
    capture();busy=true;error='';controls();
    try{return await fn();}catch(cause){fail(cause);}finally{busy=false;if(available())render();}
  }
  function sourceOptions(){return caseValue.sources.map(x=>[x.id,x.filename+' · '+x.sha256.slice(0,12)]);}
  function recordOptions(kind){return(caseValue.records[kind]||[]).map(x=>[x.id,(x.name||x.description||x.number||x.id)+' · '+x.state]);}
  function heading(){return '<header><div><h2>Receiving returns</h2><p>Finish the receiving work against a saved Installation, then return the whole case. The owner reviews the current definition before applying observations.</p></div></header>'+
    '<div class="ir-meta"><span>'+esc(caseValue.program.name)+'</span><span>Case version '+caseValue.program.version+'</span><span>'+esc(caseValue.program.mode)+'</span></div>'+
    '<nav aria-label="Receiving return work">'+[['package','Company return package'],['receiver','Record receiving'],['owner','Review a return'],['saved','Saved reports']].map(([mode,label])=>button(label,'mode','data-mode="'+mode+'"'+(session.mode===mode?' aria-current="page"':''))).join('')+'</nav>';}
  function recovery(){
    let html='';
    if(session.pending)html+='<aside class="ir-warning"><strong>Continue the retained request</strong><p>The complete original body and request identity are saved. Continue this request before editing its selection.</p>'+button('Continue original request','resume')+button('Download original request','request-download')+'</aside>';
    if(session.accepted)html+='<aside class="ir-warning"><strong>The original save returned</strong><p>Read back its saved review and current case to finish this same action.</p>'+button('Read saved result','readback')+'</aside>';
    return html;
  }
  function receiver(){
    const draft=session.receiver;
    const heads=caseValue.installations||[];
    let html='<section class="ir-card"><h3>Choose the exact edition</h3><p>Receiving starts with every original check open. Attach the actual files in Sources before recording their results.</p>'+
      '<div class="ir-fields"><label><span>Saved Installation</span><select data-return-installation>'+heads.map(x=>'<option value="'+x.id+'"'+(draft?.inputs.installationId===x.id?' selected':'')+'>'+esc(x.name)+' · current edition '+x.revision+'</option>').join('')+'</select></label>'+
      '<label><span>Edition to receive</span><input data-return-edition type="number" min="1" max="500" placeholder="Current saved edition"></label></div>'+
      '<div class="ir-actions">'+button(draft?'Start another retained receiving draft':'Start receiving','new-receiver','',!heads.length)+button('Attach original files','sources')+'</div></section>';
    if(!draft)return html+'<p>Select a saved Installation to enter named observations. Your original case and all earlier editions remain available.</p>';
    html+='<form data-return-form class="ir-card"><h3>'+esc(draft.baselineName)+'</h3><p>Original edition '+draft.inputs.revision+' · <code>'+esc(draft.inputs.sha256)+'</code></p><div class="ir-fields">'+
      field('Report name','name',draft.inputs.name,{required:true})+field('Intended owner / recipient','recipient',draft.inputs.recipient,{required:true})+
      field('Actual application, host and configuration','environment',draft.inputs.environment,{area:true,required:true,wide:true})+
      field('Whole receiving outcome and limitations','note',draft.inputs.note,{area:true,required:true,wide:true,max:12000})+'</div>';
    draft.checks.forEach((definition,index)=>{
      const row=draft.inputs.observations[index],base='observations.'+index+'.';
      html+='<fieldset class="ir-check"><legend>'+esc(definition.title)+'</legend><p class="ir-criterion">'+esc(definition.criterion||'Original criterion unentered')+'</p><p>'+esc(definition.id)+' · '+(definition.required?'Required':'Optional')+(definition.tranche?' · tranche '+definition.tranche:'')+'</p><div class="ir-fields">'+
        field('Observed state',base+'state',row.state,{options:STATES.map(x=>[x,x.replaceAll('_',' ')])})+
        field('Accountable receiving operator',base+'operator',row.operator)+
        field('Actual observation time in UTC',base+'observedAt',row.observedAt,{help:'Use a complete UTC timestamp, for example 2026-10-12T15:30:00Z.'})+
        field('Result, correction or reason',base+'note',row.note,{area:true,wide:true})+
        field('Complete original files',base+'sourceIds',row.sourceIds,{options:sourceOptions(),multiple:true,wide:true})+
        field('Original work records',base+'workIds',row.workIds,{options:recordOptions('work'),multiple:true})+
        field('Original purchase observations',base+'purchaseIds',row.purchaseIds,{options:recordOptions('purchases'),multiple:true})+
        field('Original delivery outcomes',base+'outcomeIds',row.outcomeIds,{options:recordOptions('outcomes'),multiple:true})+'</div></fieldset>';
    });
    return html+finishForm(draft,'Freeze receiving report');
  }
  function owner(){
    const draft=session.owner;
    let html='<section class="ir-card"><h3>Choose the complete returned case</h3><p>Use <strong>Import complete case</strong> in Delivery operations to receive the original ZIP. Then reopen the owner case and select that imported return here.</p>'+
      '<div class="ir-fields"><label><span>Imported receiving case</span><select data-return-owner-case>'+cases.map(x=>'<option value="'+x.id+'"'+((session.returnCase||draft?.inputs.returnedCaseId)===x.id?' selected':'')+'>'+esc(x.name)+' · version '+x.version+'</option>').join('')+'</select></label>'+
      '<label><span>Returned report</span><select data-return-owner-report>'+(session.returnOptions||[]).map(x=>'<option value="'+x.id+'"'+(draft?.inputs.reviewId===x.id?' selected':'')+'>'+esc(x.name)+' · '+esc(x.actor)+'</option>').join('')+'</select></label></div>'+
      '<div class="ir-actions">'+button('Read returned reports','list-return')+button('Open selected return','load-return','',!(session.returnOptions||[]).length)+'</div></section>';
    const retained=reviewList.filter(row=>row.purpose==='INSTALLATION_RETURN_REVIEW');
    html+='<section class="ir-card"><h3>Continue a review retained in this case</h3><p>A complete owner case includes its original returned files, report and source mappings. Select that saved review to compare the current Installation and prepare a new set of explicit decisions.</p><label><span>Retained owner review</span><select data-return-retained-review>'+retained.map(row=>'<option value="'+row.id+'">'+esc(row.name)+' · case version '+row.version+'</option>').join('')+'</select></label>'+button('Reopen retained owner review','load-retained-return','',!retained.length)+'</section>';
    if(!draft)return html+'<p>The owner will see changed definitions and keep or apply each original observation explicitly.</p>';
    const native=draft.returned.installationReturn;
    if(draft.inputs.retainedReview)html+='<aside class="ir-notice"><strong>Original retained return</strong><p>Reopened from review <code>'+esc(draft.inputs.retainedReview.id)+'</code>. Every proposed decision starts with Keep current owner observation. Select Apply only after reviewing this current comparison.</p><details><summary>Earlier owner decisions</summary><pre>'+pretty(draft.previousChoices||[])+'</pre></details></aside>';
    html+='<form data-return-form class="ir-card"><h3>'+esc(native.inputs.name)+'</h3><p>From '+esc(draft.returned.actor)+' · original edition '+native.baseline.revision+' · owner edition '+draft.inputs.expectedRevision+'</p>'+
      '<p>'+esc(native.inputs.environment)+'</p><p>'+esc(native.inputs.note)+'</p><div class="ir-fields">'+
      field('Owner review name','name',draft.inputs.name,{required:true})+
      field('Scope and reason for this owner review','note',draft.inputs.note,{area:true,required:true,wide:true,max:12000})+'</div>';
    native.document.checks.forEach((row,index)=>{
      const decision=draft.inputs.choices[index];
      html+='<fieldset class="ir-check"><legend>'+esc(row.title)+'</legend><p class="ir-criterion">'+esc(row.criterion)+'</p>'+
        '<p><strong>'+esc(row.state.replaceAll('_',' '))+'</strong> · '+esc(row.operator||'Operator unentered')+' · '+esc(row.observedAt||'Time unentered')+'</p><p>'+esc(row.note)+'</p>'+
        '<p>'+row.sourceIds.length+' complete files · '+row.workIds.length+' work records · '+row.purchaseIds.length+' purchase observations · '+row.outcomeIds.length+' outcomes</p><div class="ir-fields">'+
        field('Owner decision','choices.'+index+'.action',decision.action,{options:[['KEEP','Keep current owner observation'],['APPLY','Apply this returned observation']]})+
        field('Reason for this decision','choices.'+index+'.note',decision.note,{area:true,required:true,wide:true})+'</div></fieldset>';
    });
    return html+finishForm(draft,'Stage explicit owner choices');
  }
  function finishForm(draft,label){
    let html='<label class="ir-wide"><span>Reason recorded with this save</span><textarea data-return-save-note required rows="3" maxlength="12000">'+esc(draft.note||'')+'</textarea></label>'+
      '<div class="ir-actions">'+button('Preview complete selection','preview')+button(label,'save')+button('Download full draft','draft-download')+button('Import full draft','draft-import')+'</div></form>';
    if(draftPreview){
      if(session.mode==='receiver')html+='<section class="ir-card"><h3>Receiving preview</h3><p>'+draftPreview.report.acceptedChecks+' of '+draftPreview.report.totalChecks+' checks recorded accepted.</p><p>'+
        (draftPreview.basisUnchanged?'The selected acceptance basis matches the original Installation.':'The receiving source or configuration differs from the original. These results remain visible, and the owner must obtain fresh receiving before applying them.')+'</p><details><summary>Complete findings and source changes</summary><pre>'+pretty({report:draftPreview.report,changes:draftPreview.receivingBasisChanges})+'</pre></details></section>';
      else html+='<section class="ir-card"><h3>Owner comparison</h3><p>'+draftPreview.appliedChecks+' returned observations selected. New owner checks remain unchanged.</p>'+
        table(['Original check','Can apply','Owner choice','Record handling'],draftPreview.checks.map(x=>[esc(x.title),x.eligible?'Same current definition':'Fresh receiving required',esc(x.decision.action),esc(JSON.stringify(x.recordLinks))]))+
        '<details><summary>Complete source, configuration and definition differences</summary><pre>'+pretty({basisChanges:draftPreview.basisChanges,receivingBasisChanges:draftPreview.receivingBasisChanges,checks:draftPreview.checks.map(x=>({id:x.id,changes:x.definitionChanges})),newOwnerChecks:draftPreview.newOwnerChecks})+'</pre></details></section>';
    }
    return html;
  }
  function saved(){
    let html='<section class="ir-card"><h3>Saved receiving and owner reports</h3>'+button('Refresh saved reports','refresh')+
      table(['Report','Kind','Named operator','Original edition','Open'],reviewList.map(x=>[esc(x.name),x.purpose==='INSTALLATION_RETURN'?'Receiving return':'Owner review',esc(x.actor),String(x.revision),button('Open complete report','open-review','data-review="'+x.id+'"')]))+'</section>';
    if(!savedRow)return html;
    const receiving=savedRow.purpose==='INSTALLATION_RETURN',v=receiving?savedRow.installationReturn:savedRow.installationReturnReview;
    html+='<section class="ir-card"><h3>'+esc(v.inputs.name)+'</h3><p>'+esc(savedRow.actor)+' · '+esc(savedRow.createdAt)+'</p><p>'+esc(savedRow.note)+'</p>'+
      '<p>Review <code>'+esc(savedRow.id)+'</code><br>SHA-256 <code>'+esc(savedRow.sha256)+'</code></p>'+
      '<div class="ir-actions">'+button('Download complete case ZIP','export')+button('Download full review JSON','review-download')+'</div>'+
      '<details><summary>Original inputs and complete observations</summary><pre>'+pretty({inputs:v.inputs,checks:receiving?v.document.checks:v.checks,report:receiving?v.report:undefined})+'</pre></details></section>';
    if(!receiving){
      html+='<section class="ir-card"><h3>Confirm the next Installation edition</h3><p>The owner review and full source files are saved. Preview the complete proposed document with the original Installation model, then confirm its next edition.</p>'+
        '<label><span>Reason for the new Installation edition</span><textarea data-return-installation-note rows="3">'+esc(session.stage?.note||'')+'</textarea></label>'+
        '<div class="ir-actions">'+button('Compare staged and current case','stage-compare')+button('Regenerate owner review','regenerate-stage')+button('Preview next Installation edition','stage-preview')+button('Save next Installation edition','stage-save')+button('Open Customer installations','installations')+'</div>';
      if(stageSeed){
        const state=stageSeed.application,changes=[...state.selectedBasisChanges,...state.installationChanges,...state.documentChanges];
        if(stageSeed.savedInstallations.length)html+='<aside class="ir-notice"><strong>This original owner review is saved in an Installation edition.</strong><p>'+stageSeed.savedInstallations.map(item=>'Edition '+item.revision+' · '+esc(item.sha256)).join('<br>')+'</p></aside>';
        else html+='<aside class="'+(state.canSave?'ir-notice':'ir-warning')+'" data-return-stage-state="'+(state.canSave?'current':'changed')+'"><strong>'+(state.canSave?'The staged selection matches the current case.':'The staged selection and current case differ.')+'</strong><p>Staged Installation edition '+state.stagedInstallation.revision+'; current edition '+(state.currentInstallation?.revision??'unavailable')+'. Current case version '+state.source.version+'.</p>'+(state.unavailable?'<p>'+esc(state.unavailable)+'</p>':'')+(!state.canSave?'<p>Regenerate the owner review to compare this current selection. The earlier report and files remain available; changed criteria need fresh receiving before their observations can be applied.</p>':'')+'</aside>';
        if(changes.length)html+='<h4>Staged and current differences</h4>'+table(['Selection','Staged value','Current value'],changes.map(item=>[esc(item.field),'<pre>'+pretty(item.before)+'</pre>','<pre>'+pretty(item.after)+'</pre>']));
      }
      if(installationPreview)html+='<h4>Original Installation preview</h4><p>Current edition '+installationPreview.expectedRevision+' → '+(installationPreview.expectedRevision+1)+'</p><pre>'+pretty({changes:installationPreview.changes,report:installationPreview.report})+'</pre>';
      html+='</section>';
    }
    return html;
  }
  function render(){
    if(!available())return;
    packageDesk?.dispose();packageDesk=null;packageBusy=false;
    root.innerHTML=heading()+(error?'<p class="ir-warning" role="alert">'+esc(error)+'</p>':'')+
      (storageNotice?'<p class="ir-warning" role="alert">'+esc(storageNotice)+'</p>':'')+
      (session.notice?'<p class="ir-notice" role="status">'+esc(session.notice)+'</p>':'')+recovery()+
      (!writable()?'<p class="ir-warning">This original case is closed. Reopen it from Delivery operations before recording new work.</p>':'')+
      (session.mode==='package'?'<div data-company-intake></div>':session.mode==='receiver'?receiver():session.mode==='owner'?owner():saved())+'<input type="file" data-return-draft-file accept="application/json,.json" hidden>';
    if(session.mode==='package')packageDesk=mountCompanyReturnIntake({
      container:root.querySelector('[data-company-intake]'),current:caseValue,api,saveApi,mutationId,recordingActor,
      locked:()=>!!session.pending||!!session.accepted,
      noteDrafts:session.companyNoteDrafts,
      onNoteDrafts:()=>{persist();if(storageNotice)throw Error('The browser session could not retain the note recovery copy.');},
      onNoteError:message=>{
        session.notice=message;persist();
        if(available()){
          let alert=root.querySelector('[data-company-note-failure]');
          if(!alert){alert=document.createElement('p');alert.dataset.companyNoteFailure='true';alert.className='ir-warning';alert.setAttribute('role','alert');root.prepend(alert);}
          alert.textContent=message;
        }
      },
      onBusy:value=>{packageBusy=value;controls();},
      onDraft:async(draft,next)=>{
        if(session.pending||session.accepted)throw new Error('Finish the original receiving request before replacing its draft.');
        const previous=copy({receiver:session.receiver,previousDrafts:session.previousDrafts||[],mode:session.mode,notice:session.notice});
        if(session.receiver){session.previousDrafts??=[];session.previousDrafts.push(copy(session.receiver));}
        session.receiver=copy(draft);session.mode='receiver';
        session.notice='The complete company proposal is open with its original retained evidence. Preview and explicitly save this receiving report.';
        try{persist(true);}catch(cause){Object.assign(session,previous);throw cause;}
        caseValue=next;draftPreview=null;previewInput=null;render();
      }
    });
    controls();
  }
  async function refreshLists(){
    const epoch=generation,values=await Promise.all([api(prefix),api(prefix+'/installation-returns'),api('/api/operations')]);
    if(!guard(epoch))return;
    caseValue=values[0];reviewList=values[1].reviews;cases=values[2].cases.filter(x=>x.id!==caseId);render();
  }
  async function newReceiver(){
    if(session.pending||session.accepted)return;
    const id=$('[data-return-installation]')?.value,typed=$('[data-return-edition]')?.value;
    if(!id)throw new Error('Select a saved Installation.');
    const epoch=generation,row=await api(prefix+'/installations/'+id+(typed?'?revision='+encodeURIComponent(typed):''));
    const result=await api(prefix+'/installation-return-seed',{expectedVersion:caseValue.program.version,installationId:row.id,revision:row.revision,sha256:row.sha256});
    if(!guard(epoch))return;
    if(session.receiver){session.previousDrafts??=[];session.previousDrafts.push(copy(session.receiver));}
    session.receiver={inputs:result.inputs,checks:result.checks,baselineName:row.preview.document.name,note:''};
    session.mode='receiver';draftPreview=null;previewInput=null;persist();
  }
  async function listReturned(){
    const chosen=$('[data-return-owner-case]')?.value;if(!chosen)throw new Error('Select the imported receiving case.');
    const epoch=generation,result=await api('/api/operations/'+chosen+'/installation-returns');
    if(!guard(epoch))return;
    session.returnCase=chosen;session.returnOptions=result.reviews.filter(x=>x.purpose==='INSTALLATION_RETURN');persist();
  }
  async function loadReturned(){
    const chosen=$('[data-return-owner-case]')?.value,selected=$('[data-return-owner-report]')?.value;
    if(!chosen||chosen!==session.returnCase||!selected)throw new Error('Read the reports from this selected receiving case first.');
    const epoch=generation,row=await api('/api/operations/'+chosen+'/reviews/'+selected);
    if(row.purpose!=='INSTALLATION_RETURN')throw new Error('Select an original receiving report.');
    const original=row.installationReturn,current=await api(prefix+'/installations/'+original.baseline.id);
    if(!guard(epoch))return;
    returnedRow=row;
    session.owner={returned:copy(row),inputs:{returnedCaseId:chosen,reviewId:row.id,reviewSha256:row.sha256,
      installationId:current.id,expectedRevision:current.revision,name:original.inputs.name+' — owner review',note:'',
      choices:original.document.checks.map(x=>({id:x.id,action:'KEEP',note:''}))},note:''};
    session.mode='owner';draftPreview=null;previewInput=null;persist();
  }
  async function previewDraft(){
    capture();const draft=currentDraft();if(!draft)throw new Error('Open the original receiving selection first.');
    const epoch=generation,mode=session.mode,input=copy(draft.inputs),currentCase=await api(prefix);
    if(!guard(epoch)||mode!==session.mode||!same(input,currentDraft()?.inputs))return;
    caseValue=currentCase;
    const value=await api(prefix+(mode==='receiver'?'/installation-return-preview':'/installation-return-review-preview'),{expectedVersion:caseValue.program.version,inputs:input});
    if(!guard(epoch)||mode!==session.mode||!same(input,currentDraft()?.inputs))return;
    draftPreview=value;previewInput=input;session.notice='Reviewed the complete original selection. Confirm the named save when ready.';persist();
  }
  async function completeReadback(){
    const accepted=session.accepted;if(!accepted)return;
    const result=accepted.result;
    if(accepted.body.action==='installation.save'){
      const [row,next]=await Promise.all([api(prefix+'/installations/'+result.recordId+'?revision='+result.revision),api(prefix)]);
      if(row.sha256!==result.sha256||!same(row.preview.document,accepted.body.data.document)||!same(row.preview.returnReview,accepted.body.data.returnReview))throw new Error('The saved Installation differs from the original confirmed input.');
      if(!available())return;
      session.accepted=null;installationPreview=null;installationInput=null;
      if(session.stage?.reviewId===row.preview.returnReview?.id)session.stage.savedInstallation={id:row.id,revision:row.revision,sha256:row.sha256,version:row.version};
      session.notice='Saved Installation edition '+row.revision+' with the selected original receiving observations and full files.';persist();
      await onCase?.(next,result);return;
    }
    const [row,next]=await Promise.all([api(prefix+'/reviews/'+result.recordId),api(prefix)]);
    if(row.sha256!==result.reviewSha256||row.version!==result.version)throw new Error('The saved receiving report differs from the original receipt.');
    if(!available())return;
    savedRow=row;session.selectedReview=row.id;session.mode='saved';caseValue=next;
    if(row.purpose==='INSTALLATION_RETURN_REVIEW'){
      const value=row.installationReturnReview;
      session.stage={reviewId:row.id,returnReview:{id:row.id,sha256:row.sha256},document:copy(value.document),installationId:value.currentInstallation.id,
        expectedRevision:value.currentInstallation.revision,note:''};
    }
    session.accepted=null;draftPreview=null;previewInput=null;
    session.notice=row.purpose==='INSTALLATION_RETURN'?'Saved the complete receiving report. Export this whole case for its owner.':
      'Saved the explicit owner review and every original receiving file. Preview and confirm the next Installation edition.';
    persist();await onCase?.(next,result);
  }
  async function sendPending(){
    const pending=session.pending;if(!pending)return;
    if(session.inflight){await session.inflight;return;}
    const work=(async()=>{
      try{
        const result=await saveApi(prefix+'/command',pending.body);
        session.accepted={body:pending.body,result};session.pending=null;persist(true);return result;
      }catch(cause){
        // Native request replay remains safe after an unknown response. Do not clear
        // an accepted result merely because local storage publication failed.
        if(!session.accepted&&[400,401,403,404,409,413,422].includes(cause?.status)&&typeof cause.code==='string'){
          session.rejected.push({body:copy(pending.body),code:cause.code,message:cause.message});
          session.pending=null;persist();
        }
        throw cause;
      }
    })();
    session.inflight=work;controls();
    try{await work;}finally{if(session.inflight===work)session.inflight=null;}
    if(available())await completeReadback();
  }
  async function prepareSave(){
    capture();const draft=currentDraft();
    if(!draft||!draftPreview||!same(previewInput,draft.inputs)||!draft.note.trim())throw new Error('Preview this exact draft and enter the reason for saving it.');
    const body={expectedVersion:draftPreview.source.version,actor:recordingActor(),note:draft.note,
      action:session.mode==='receiver'?'installation.return':'installation.return-stage',
      data:{inputs:copy(draft.inputs),expectedPreviewSha256:draftPreview.previewSha256}};
    body.requestId=await mutationId('operations:'+body.action+':'+caseId,body);
    if(!available())return;
    session.pending={caseId,body};persist(true);await sendPending();
  }
  async function openReview(id){
    const epoch=generation,row=await api(prefix+'/reviews/'+id);if(!guard(epoch))return;
    if(!['INSTALLATION_RETURN','INSTALLATION_RETURN_REVIEW'].includes(row.purpose))throw new Error('Select a saved receiving report.');
    savedRow=row;session.selectedReview=id;session.mode='saved';
    if(row.purpose==='INSTALLATION_RETURN_REVIEW'){
      const value=row.installationReturnReview;
      if(session.stage?.reviewId!==id)session.stage={reviewId:id,returnReview:{id:row.id,sha256:row.sha256},document:copy(value.document),
        installationId:value.currentInstallation.id,expectedRevision:value.currentInstallation.revision,note:''};
      else session.stage.returnReview={id:row.id,sha256:row.sha256};
    }
    installationPreview=null;installationInput=null;stageSeed=null;persist();
    if(row.purpose==='INSTALLATION_RETURN_REVIEW')await compareStage();
  }
  async function selectedRetainedSeed(id){
    const epoch=generation,row=await api(prefix+'/reviews/'+id),next=await api(prefix);
    if(row.purpose!=='INSTALLATION_RETURN_REVIEW')throw new Error('Select an original owner receiving review in this same case.');
    const selected={id:row.id,sha256:row.sha256},seed=await api(prefix+'/installation-return-review-seed',{expectedVersion:next.program.version,retainedReview:selected});
    if(!guard(epoch))return null;
    if(seed.retainedReview.id!==selected.id||seed.retainedReview.sha256!==selected.sha256)throw new Error('The retained source selection changed.');
    caseValue=next;return{row,seed};
  }
  async function compareStage(){
    if(!savedRow||savedRow.purpose!=='INSTALLATION_RETURN_REVIEW')throw new Error('Open the saved owner review first.');
    const id=savedRow.id,selected=await selectedRetainedSeed(id);
    if(!selected||savedRow?.id!==id)return;
    stageSeed=selected.seed;installationPreview=null;installationInput=null;
  }
  async function regenerateStage(id=savedRow?.id){
    if(session.pending||session.accepted)throw new Error('Finish the retained request before opening a new review draft.');
    if(!id)throw new Error('Select the original retained owner review.');
    const selected=await selectedRetainedSeed(id);if(!selected)return;
    if(session.owner){session.previousDrafts??=[];session.previousDrafts.push(copy(session.owner));}
    session.owner={inputs:copy(selected.seed.inputs),returned:copy(selected.seed.returned),previousChoices:copy(selected.seed.previousChoices),note:''};
    session.mode='owner';draftPreview=null;previewInput=null;installationPreview=null;installationInput=null;
    session.notice='Reopened the complete original return from this case. Compare and explicitly select current owner decisions before staging a new edition.';persist();
  }
  async function previewInstallation(){
    if(!session.stage)throw new Error('Open the original staged owner review.');
    const note=$('[data-return-installation-note]')?.value;if(note!==undefined)session.stage.note=note;
    const original=copy(session.stage),epoch=generation,next=await api(prefix);
    const seed=await api(prefix+'/installation-return-review-seed',{expectedVersion:next.program.version,retainedReview:original.returnReview});
    if(!guard(epoch)||session.stage.reviewId!==original.reviewId)return;
    stageSeed=seed;caseValue=next;
    if(!seed.application.canSave)throw new Error('The staged selection and current case differ. Review the comparison and regenerate the owner review.');
    const value=await api(prefix+'/installation-preview',{expectedVersion:next.program.version,
      installationId:original.installationId,expectedRevision:original.expectedRevision,document:original.document,returnReview:original.returnReview});
    if(!guard(epoch)||session.stage.reviewId!==original.reviewId)return;
    caseValue=next;installationPreview=value;installationInput=copy(original.document);persist();
  }
  async function saveInstallation(){
    if(!session.stage||!installationPreview||!same(installationInput,session.stage.document))throw new Error('Preview the complete staged Installation first.');
    session.stage.note=$('[data-return-installation-note]')?.value||session.stage.note;
    if(!session.stage.note.trim())throw new Error('Enter the reason for this next Installation edition.');
    const original=copy(session.stage),body={expectedVersion:installationPreview.source.version,actor:recordingActor(),note:original.note,
      action:'installation.save',data:{installationId:original.installationId,expectedRevision:original.expectedRevision,
        document:original.document,returnReview:original.returnReview,expectedPreviewSha256:installationPreview.previewSha256}};
    body.requestId=await mutationId('operations:installation.save:'+caseId,body);
    if(!available())return;
    session.pending={caseId,body};persist(true);await sendPending();
  }
  root.addEventListener('input',event=>{
    if(event.target.matches('[data-return-field],[data-return-save-note]')){capture();controls();}
    if(event.target.matches('[data-return-installation-note]')&&session.stage){session.stage.note=event.target.value;persist();}
  });
  root.addEventListener('change',event=>{
    if(event.target.matches('[data-return-draft-file]')&&event.target.files[0]){
      const file=event.target.files[0];
      run(async()=>{
        if(file.size>8*1024*1024)throw new Error('Choose one complete receiving draft up to 8 MiB.');
        const imported=JSON.parse(await file.text()),epoch=generation;
        if(imported.schema!==SCHEMA||imported.caseId!==caseId||!['receiver','owner'].includes(imported.mode)||!imported.draft?.inputs)
          throw new Error('Select the complete original draft for this same operating case.');
        const draft=copy(imported.draft);
        if(imported.mode==='receiver'){
          const input=draft.inputs,row=await api(prefix+'/installations/'+input.installationId+'?revision='+input.revision);
          if(row.sha256!==input.sha256)throw new Error('The draft selected a different original Installation edition.');
          draft.checks=row.preview.document.checks.map(({id,title,criterion,tranche,required})=>({id,title,criterion,tranche,required}));
          if(!Array.isArray(input.observations)||input.observations.length!==draft.checks.length||
             input.observations.some((x,i)=>x.id!==draft.checks[i].id))throw new Error('Retain every original check in its saved order.');
          draft.baselineName=row.preview.document.name;
        }else{
          const input=draft.inputs;
          let row;
          if(input.retainedReview){
            const selected=await selectedRetainedSeed(input.retainedReview.id);if(!selected)return;
            if(selected.seed.retainedReview.sha256!==input.retainedReview.sha256)throw new Error('The draft selected a different retained owner review.');
            row=selected.seed.returned;draft.previousChoices=copy(selected.seed.previousChoices);
          }else row=await api('/api/operations/'+input.returnedCaseId+'/reviews/'+input.reviewId);
          if(row.purpose!=='INSTALLATION_RETURN'||row.id!==input.reviewId||row.sha256!==input.reviewSha256)throw new Error('The draft selected a different complete receiving report.');
          draft.returned=row;session.returnCase=input.returnedCaseId;
        }
        if(!guard(epoch))return;
        session.previousDrafts??=[];if(session[imported.mode])session.previousDrafts.push(copy(session[imported.mode]));
        session[imported.mode]=draft;session.mode=imported.mode;draftPreview=null;previewInput=null;
        session.notice='Restored the whole original draft. Preview its current native source before saving.';persist();
      });return;
    }
    if(event.target.matches('[data-return-field]')){capture();controls();}
    if(event.target.matches('[data-return-owner-case]')){session.returnOptions=[];session.returnCase=event.target.value;controls();}
  });
  root.addEventListener('submit',event=>{if(event.target.matches('[data-return-form]')){event.preventDefault();run(previewDraft);}});
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-return-action]');if(!target||target.disabled)return;
    const action=target.dataset.returnAction;
    if(action==='draft-import'){if(hostBusy||busy||session.inflight||session.pending||session.accepted)return;const input=$('[data-return-draft-file]');input.value='';input.click();return;}
    run(async()=>{
      if(action==='mode'){session.mode=target.dataset.mode;draftPreview=null;previewInput=null;persist();return;}
      if(action==='new-receiver')return newReceiver();
      if(action==='sources')return onSources?.();
      if(action==='installations')return onInstallations?.();
      if(action==='list-return')return listReturned();
      if(action==='load-return')return loadReturned();
      if(action==='load-retained-return')return regenerateStage($('[data-return-retained-review]')?.value);
      if(action==='regenerate-stage')return regenerateStage();
      if(action==='stage-compare')return compareStage();
      if(action==='preview')return previewDraft();
      if(action==='save')return prepareSave();
      if(action==='resume')return sendPending();
      if(action==='readback')return completeReadback();
      if(action==='refresh')return refreshLists();
      if(action==='open-review')return openReview(target.dataset.review);
      if(action==='draft-download'){const draft=currentDraft();if(draft)saveFile(JSON.stringify({schema:SCHEMA,caseId,mode:session.mode,draft},null,2)+'\n','installation-receiving-draft.json');return;}
      if(action==='request-download'){saveFile(JSON.stringify(session.pending,null,2)+'\n','installation-receiving-original-request.json');return;}
      if(action==='review-download'&&savedRow){saveFile(JSON.stringify(savedRow,null,2)+'\n',savedRow.id+'.json');return;}
      if(action==='export'&&savedRow){const id=savedRow.id,response=await api(prefix+'/installation-returns/'+id+'/export.zip',undefined,{download:true}),raw=await response.blob();if(available())saveFile(raw,id+'-installation-return.zip','application/zip');return;}
      if(action==='stage-preview')return previewInstallation();
      if(action==='stage-save')return saveInstallation();
    });
  });
  render();
  const ready=(async()=>{
    if(session.inflight)await session.inflight.catch(()=>{});
    await refreshLists();
    if(session.accepted){await completeReadback();return;}
    if(session.mode==='saved'&&session.selectedReview)await openReview(session.selectedReview);
    if(available())render();
  })().catch(fail);
  return {root,ready,setHostBusy(value){hostBusy=!!value;controls();},dispose(){capture();packageDesk?.dispose();packageDesk=null;active=false;++generation;persist();}};
}
