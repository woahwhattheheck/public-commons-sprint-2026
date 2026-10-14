import {createLeadProcurementUI} from './lead_procurement_ui.mjs';
import {createLeadCustomerRequestsUI} from './lead_customer_requests_ui.mjs';
import {createLeadCustomerFilesUI} from './lead_customer_files_ui.mjs';
import {createLeadPackageContactUI} from './lead_first_contact_ui.mjs';
import {mountLeadReconciliation} from '/lead_reconciliation.js';
import {createCreatorProgrammeUI} from '/creator_programme_browser.mjs';
import {createCreatorMeasurementUI} from '/creator_programme_measurement_ui.mjs';
import {createCreatorOperatingUI} from '/creator_programme_operating_ui.mjs';
import {mountCreatorOperatingDesk} from '/creator_programme/operating_integration.mjs';
import {createCreatorWorkbookPanel} from '/creator_programme_workbook_panel.mjs';
import {createCreatorCommercialPane} from '/creator_programme/commercial_ui.mjs';
/** Lead fulfillment: complete records and recoverable operator saves. */
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(form,name)=>form.elements.namedItem(name);
const val=(form,name)=>field(form,name).value.trim();
const sampleQuantity=brief=>brief?.sample_quantity??1;
const leadCountLabel=count=>count+' '+(count===1?'lead':'leads');
function enteredSampleQuantity(){
  const value=val(packForm,'sample_quantity');if(value==='')return undefined;
  const count=Number(value);
  if(!Number.isSafeInteger(count)||count<1||count>500)throw new Error('Choose a whole free-sample quantity from 1 to 500, or leave it blank for the legacy one-lead default.');
  return count;
}
const option=(value,label)=>'<option value="'+esc(value)+'">'+esc(label)+'</option>';
const packForm=$('brief-form'),leadForm=$('lead-form'),importForm=$('import-form'),receiveForm=$('receive-form');
const replacementForm=$('replacement-form'),deliveryForm=$('delivery-form'),withdrawForm=$('withdraw-form'),reworkForm=$('rework-form');
const commerceForm=$('commerce-form'),caseDeliveryForm=$('case-delivery-form');
const feedbackForm=$('delivery-feedback-form'),followupForm=$('delivery-followup-form');
let feedbackInput=null,feedbackPreview=null;
const caseLinkForm=$('case-link-form');
let caseLinkOptions=null,caseLinkPreview=null,reconciliation=null;
const MUTATION_FORMS=[$('reconciliation-form'),caseLinkForm,packForm,leadForm,importForm,receiveForm,replacementForm,deliveryForm,withdrawForm,commerceForm,caseDeliveryForm,feedbackForm,followupForm];
let commerceCase=null,packageContactUI=null;
const KIND={sample:'Free sample',paid:'Paid pack',complimentary:'Complimentary full pack',replacement:'Replacement pack'};
const SIGNAL={paid_request:'Paid request',problem_signal:'Published problem',company_fit:'Company fit'};
const STATUS={open:'Open',unconfirmed:'Availability unconfirmed',closed:'Closed',expired:'Expired',excluded:'Excluded'};
function sourceStatus(lead){
  const kind=lead.signal_type||lead.lead_kind;
  if(kind==='company_fit'&&['open','unconfirmed'].includes(lead.source_status)){
    return lead.source_checked_at||lead.checked_at?'Company source reviewed':'Company source';
  }
  return STATUS[lead.source_status]||lead.source_status||'';
}

let state=null,selectedId='',leadId='',pending=null,pendingKey='',busy=false,importedRows=null,receivedBundle=null,receivedFiles=[],replacementRows=[];
const selectedLeads=new Set(),includedEditions=new Map(),dirty=new Set();

const REVIEW_SCHEMA='dealscout.customer-review.v1',REVIEW_PAGE_SIZE=30;
let reviewOffset=0,reviewGeneration=0,reviewLoading=false,reviewEditEpoch=0,reviewEdition='';
let reviewHistory=null,reviewReturning=false,reviewScrollTimer=null,reviewStorageNotice=false,reviewRestorePosition=null;
function normalizedReview(value){
  if(!value||value.schema!==REVIEW_SCHEMA||typeof value.workspace_identity!=='string')return null;
  const word=(v,n=2000)=>typeof v==='string'?v.slice(0,n):'';
  return {schema:REVIEW_SCHEMA,workspace_identity:word(value.workspace_identity,300),pack_id:word(value.pack_id,160),
    query:word(value.query),filter:['all','attention','unprepared'].includes(value.filter)?value.filter:'all',
    sort:['updated','customer','attention'].includes(value.sort)?value.sort:'updated',
    offset:Number.isSafeInteger(value.offset)&&value.offset>=0?value.offset:0,
    lead_query:word(value.lead_query),lead_filter:['all','ready','incomplete','used'].includes(value.lead_filter)?value.lead_filter:'all',
    leads:Array.isArray(value.leads)?value.leads.filter(row=>row&&typeof row.id==='string'&&Number.isSafeInteger(row.revision)).slice(0,1000).map(row=>({id:row.id.slice(0,160),revision:row.revision})):[],
    included_editions:Array.isArray(value.included_editions)?value.included_editions.filter(row=>row&&typeof row.id==='string'&&/^[a-f0-9]{64}$/.test(row.sha256)).slice(0,1000).map(row=>({id:row.id.slice(0,160),sha256:row.sha256})):[],
    edition_id:word(value.edition_id,160),lead_id:word(value.lead_id,160),
    scroll:Number.isFinite(value.scroll)&&value.scroll>=0?Math.min(value.scroll,10000000):0};
}
function reviewSnapshot(){
  if(!state)return null;
  return normalizedReview({schema:REVIEW_SCHEMA,workspace_identity:state.workspace_identity,pack_id:selectedId,
    query:$('pack-search').value,filter:$('pack-filter').value,sort:$('pack-sort').value,offset:reviewOffset,
    lead_query:$('lead-search').value,lead_filter:$('lead-filter').value,
    leads:(state.selected?.leads||[]).filter(row=>selectedLeads.has(row.id)).map(row=>({id:row.id,revision:row.revision})),
    included_editions:[...includedEditions].map(([id,sha256])=>({id,sha256})),
    edition_id:reviewEdition,lead_id:dirty.has('lead-form')?'':leadId,
    scroll:reviewRestorePosition?.generation===reviewGeneration?reviewRestorePosition.scroll:window.scrollY});
}
function reviewURL(context){
  const url=new URL(location.href);
  if(context.pack_id)url.searchParams.set('pack_id',context.pack_id);else url.searchParams.delete('pack_id');
  return url.pathname+url.search+url.hash;
}
function retainedReview(workspace){
  try{return normalizedReview(JSON.parse(sessionStorage.getItem('dealscout.customer-review.v1:'+encodeURIComponent(workspace))||'null'));}
  catch{return null;}
}
function rememberReview(mode='replace',supplied=null){
  const context=supplied||reviewSnapshot();if(!context)return;
  try{sessionStorage.setItem('dealscout.customer-review.v1:'+encodeURIComponent(context.workspace_identity),JSON.stringify(context));}
  catch{if(!reviewStorageNotice){reviewStorageNotice=true;message('This tab could not retain its review position. The saved customer records and pending request are available.');}}
  const previous=history.state?.lead_review;
  const index=mode==='push'?(Number.isSafeInteger(previous?.index)?previous.index+1:1):
    Number.isSafeInteger(previous?.index)?previous.index:0;
  const entry={schema:REVIEW_SCHEMA,index,context};
  history[mode==='push'?'pushState':'replaceState']({...history.state,lead_review:entry},'',reviewURL(context));
  reviewHistory={...entry,url:reviewURL(context)};
}
function matchingCustomerPacks(){
  if(!state)return [];
  const query=$('pack-search').value.trim().toLowerCase(),filter=$('pack-filter').value,sort=$('pack-sort').value;
  const rows=state.packs.filter(row=>[row.customer,row.title,row.id].join(' ').toLowerCase().includes(query)&&
    (filter!=='attention'||row.delivery_attention>0)&&(filter!=='unprepared'||!row.editions));
  const byCustomer=(a,b)=>String(a.customer||'').localeCompare(String(b.customer||''))||a.id.localeCompare(b.id);
  return rows.slice().sort((a,b)=>sort==='customer'?byCustomer(a,b):
    (sort==='attention'?(b.delivery_attention||0)-(a.delivery_attention||0):0)||
    (Date.parse(b.updated_at)||0)-(Date.parse(a.updated_at)||0)||byCustomer(a,b));
}
function renderReviewNavigation(rows=matchingCustomerPacks()){
  const index=rows.findIndex(row=>row.id===selectedId);
  $('review-customer-position').textContent=selectedId?(index<0?'This customer is outside the current list.':
    'Customer '+(index+1)+' of '+rows.length+' in this list.'):rows.length+' matching customer'+(rows.length===1?'':'s')+'.';
  $('review-previous-customer').disabled=busy||index<=0;
  $('review-next-customer').disabled=busy||index<0||index>=rows.length-1;
  $('review-results').disabled=busy;
}
function restoreReviewControls(context){
  if(!context||context.workspace_identity!==state.workspace_identity)return;
  $('pack-search').value=context.query;$('pack-filter').value=context.filter;$('pack-sort').value=context.sort;reviewOffset=context.offset;
  if(context.pack_id!==selectedId)return;
  $('lead-search').value=context.lead_query;$('lead-filter').value=context.lead_filter;
}
function restoreCustomerReview(context,generation,{position=false}={}){
  if(!context||context.workspace_identity!==state.workspace_identity||context.pack_id!==selectedId)return;
  const selected=state.selected;
  if(selected){
    for(const ref of context.included_editions||[]){
      const edition=selected.editions.find(row=>row.id===ref.id&&!row.withdrawn&&row.sha256===ref.sha256);
      if(edition)includedEditions.set(edition.id,edition.sha256);
    }
    for(const id of inclusionLeadIds())selectedLeads.add(id);
    const original=new Map(context.leads.map(row=>[row.id,row.revision]));
    for(const row of selected.leads)if(original.get(row.id)===row.revision&&leadSelectable(row))selectedLeads.add(row.id);
    renderLeads();
    if(context.edition_id&&selected.editions.some(row=>row.id===context.edition_id))reviewEdition=context.edition_id;
    const lead=context.lead_id&&selected.leads.find(row=>row.id===context.lead_id);
    if(lead&&!dirty.size)renderLeadEditor(lead);
  }
  if(position){
    reviewRestorePosition={generation,scroll:context.scroll};
    requestAnimationFrame(()=>{
      if(generation!==reviewGeneration)return;
      if(!dirty.size)window.scrollTo({top:context.scroll,behavior:'instant'});
      reviewRestorePosition=null;rememberReview();
    });
  }
}
function cancelCustomerOpening(){
  if(reviewLoading){reviewGeneration++;reviewLoading=false;reviewRestorePosition=null;updateControls();}
}
async function openReviewedCustomer(packId,context=null,mode='push'){
  if(!allowNavigate())return;
  if(mode!=='restore')rememberReview();
  const result=await loadState(packId,{review:context,history:mode,position:mode==='restore'});
  if(result&&mode!=='restore'){$('brief-panel').scrollIntoView({block:'start'});rememberReview();}
  return result;
}
function reviewChanged(){if(!state||reviewLoading)return;reviewOffset=0;renderPacks();rememberReview();}

let creatorMeasurementUI=null,creatorWorkbookUI=null,creatorCommercialUI=null,creatorCommercialSaving=false,creatorOperatingUI=null;
function updateCreatorCommercialSelection(){if(creatorCommercialSaving||!creatorCommercialUI)return;creatorCommercialUI.updateSelection().catch(error=>message(error.message,true));}
function creatorCommercialLocked(){return busy||reviewLoading||Boolean(pending)||Boolean(packageContactUI?.hasPending())||Boolean(creatorWorkbookUI?.isBusy())||Boolean(creatorWorkbookUI?.hasPending())||[...dirty].some(id=>id!=='creator-commercial-pane');}
const creatorProgrammeUI=createCreatorProgrammeUI({getState:()=>state,mutate,message,markDirty,dirty,updateControls,api,uuid,
  forms:MUTATION_FORMS,isLocked:()=>busy||reviewLoading||Boolean(pending)||Boolean(packageContactUI?.hasPending()),allowNavigate,
  onSelectionChange:()=>{creatorMeasurementUI?.render();creatorWorkbookUI?.render();updateCreatorCommercialSelection();void creatorOperatingUI?.render().catch(error=>message(error.message,true));}});
creatorMeasurementUI=createCreatorMeasurementUI({getState:()=>state,getSelection:()=>creatorProgrammeUI.getSelection(),api,mutate,message,markDirty,dirty,updateControls,
  forms:MUTATION_FORMS,isLocked:()=>busy||reviewLoading||Boolean(pending)||Boolean(packageContactUI?.hasPending()),allowNavigate});
creatorOperatingUI=createCreatorOperatingUI({root:$('creator-operating-panel'),mount:mountCreatorOperatingDesk,
  getState:()=>state,getSelection:()=>creatorProgrammeUI.getSelection(),loadSourceSelection:loadCreatorOperatingSource,
  saveRequest:retainedCreatorRequest,readState:bound=>loadState(bound.pack_id),reviewRejectedRequest:reviewOperatingRequest,
  getPending:()=>pending,message,dirty,markDirty,updateControls,
  isLocked:({allowPending=false}={})=>busy||reviewLoading||(!allowPending&&Boolean(pending))||Boolean(packageContactUI?.hasPending())});
const procurementUI=createLeadProcurementUI({getState:()=>state,mutate,message,markDirty,dirty,updateControls,api,uuid,
  forms:MUTATION_FORMS,isLocked:()=>busy||reviewLoading||Boolean(pending)||Boolean(packageContactUI?.hasPending()),allowNavigate});
creatorWorkbookUI=createCreatorWorkbookPanel({mount:$('creator-workbook-panel'),getState:()=>state,getSelection:()=>creatorProgrammeUI.getSelection(),
  api,markDirty,dirty,updateControls,isLocked:()=>busy||reviewLoading||Boolean(pending)||Boolean(packageContactUI?.hasPending()),
  saveOriginal:async(request,formId)=>{
    if(busy||reviewLoading||packageContactUI?.hasPending())throw Error('Finish the current workspace operation.');
    if([...dirty].some(id=>id!==formId))throw Error('Save or close the other edited form before saving this workbook.');
    const retained=readPending();
    if(retained){if(JSON.stringify(retained.body)!==JSON.stringify(request))throw Error('Resume the other original workspace request first.');pending=retained;}
    else stashPending(request);
    await performPending();
    const unresolved=readPending();
    if(unresolved?.body.operation_id===request.operation_id)throw Error(unresolved.failure?.message||'The original request is retained. Resume it to receive its saved result.');
  },
  afterSave:()=>loadState(selectedId)});
creatorCommercialUI=createCreatorCommercialPane({
  mount:$('creator-commercial-pane'),getSelection:()=>creatorProgrammeUI.getSelection(),getWorkspaceIdentity:()=>state?.workspace_identity||'',isLocked:creatorCommercialLocked,
  loadState:selection=>api('/api/lead-packs/creator-commercial-state?'+new URLSearchParams(selection)),
  prepareRequest:body=>api('/api/lead-packs/creator-commercial-prepare',body),
  previewRequest:body=>api('/api/lead-packs/creator-commercial-preview',body),requestStatus:body=>api('/api/lead-packs/creator-commercial-status',body),
  saveRequest:async body=>{
    if(creatorCommercialLocked())throw Error('Finish the other original workspace operation before saving service billing.');
    const originalPack=body.input.pack_id;if(originalPack!==state?.selected?.pack.id)throw Error('Open the original customer for this billing request.');
    creatorCommercialSaving=true;busy=true;updateControls();
    try{const result=await api('/api/lead-packs/creator-commercial-save',body);const reopened=await loadState(originalPack);if(!reopened)throw Error('Reopen the original customer before accepting this saved commercial request.');return result;}
    finally{creatorCommercialSaving=false;busy=false;updateControls();}
  },
  exportSource:async selection=>{
    const response=await fetch('/api/lead-packs/creator-commercial-export?'+new URLSearchParams(selection),{credentials:'same-origin'});
    if(!response.ok){const data=await response.json().catch(()=>({error:'The complete commercial source could not be exported.'}));throw Error(errorText(data));}
    const blob=await response.blob(),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=selection.programme_id+'-complete-commercial.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },
  onDirty:value=>{if(value)dirty.add('creator-commercial-pane');else dirty.delete('creator-commercial-pane');dirtyLabel();updateControls();},notify:(text,severity)=>message(text,severity==='error')
});
const customerRequestsUI=createLeadCustomerRequestsUI({getState:()=>state,mutate,message,markDirty,dirty,updateControls,api,uuid,
  forms:MUTATION_FORMS,isLocked:()=>busy||reviewLoading||Boolean(pending)});
const customerFilesUI=createLeadCustomerFilesUI({getState:()=>state,mutate,message,markDirty,dirty,updateControls,api,uuid,
  forms:MUTATION_FORMS,isLocked:()=>busy||reviewLoading||Boolean(pending)||Boolean(packageContactUI?.hasPending()),allowNavigate});
packageContactUI=createLeadPackageContactUI({getState:()=>state,api,uuid,message,markDirty,dirty,forms:MUTATION_FORMS,
  updateControls,isLocked:()=>busy||reviewLoading||Boolean(pending),
  openPack:async packId=>{
    if(busy||reviewLoading||pending)throw Error('Finish the current workspace operation.');
    if([...dirty].some(id=>id!=='cf-contact-form'))throw Error('Save or close the other edited form before opening the original customer.');
    await loadState(packId);
  },
  openFeedback:async ({pack_id,mailbox})=>{
    if(busy||reviewLoading||pending||packageContactUI?.hasPending())throw Error('Finish the current workspace operation.');
    if(pack_id!==state?.selected?.pack.id)throw Error('Open the original customer before reviewing its delivery report.');
    if([...dirty].some(id=>!['cf-contact-form','delivery-feedback-form'].includes(id)))throw Error('Save or close the other edited form before reviewing this delivery report.');
    if(dirty.has(feedbackForm.id))throw Error('Save or close the currently edited delivery report first.');
    feedbackInput=null;feedbackPreview=null;feedbackForm.reset();field(feedbackForm,'mailbox').value=mailbox;
    $('delivery-feedback-preview').textContent='Choose the complete delivery notice. The original case supplies its retained sent-message identity.';
    $('delivery-feedback-panel').hidden=false;markDirty(feedbackForm);
    $('delivery-feedback-panel').scrollIntoView({block:'start'});field(feedbackForm,'report_files').focus();
  },
  runExclusive:async operation=>{
    if(busy||reviewLoading||pending)throw Error('Finish the current workspace operation.');
    if([...dirty].some(id=>id!=='cf-contact-form'))throw Error('Save or close the other edited form before saving this package operation.');
    const originalPack=state?.selected?.pack.id;
    if(!originalPack)throw Error('Open the original saved customer.');
    busy=true;updateControls();
    try{await operation();await loadState(originalPack);}
    finally{busy=false;updateControls();}
  }});
function uuid(prefix){return prefix+'-'+crypto.randomUUID();}
function message(text,error=false){$('message').className='notice'+(error?' error':'');$('message').textContent=text;}
function list(value){return value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);}
function time(value){if(!value)return '';const dateOnly=/^\d{4}-\d\d-\d\d$/.test(value),at=new Date(dateOnly?value+'T12:00:00Z':value);return Number.isNaN(at.getTime())?String(value):dateOnly?new Intl.DateTimeFormat(undefined,{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(at):at.toLocaleString();}
function localTime(value){if(!value)return '';const at=new Date(value);return new Date(at.getTime()-at.getTimezoneOffset()*60000).toISOString().slice(0,-1);}
function iso(value){if(!value)return '';const at=new Date(value);if(!Number.isFinite(at.getTime()))throw new Error('Enter a valid date and time.');return at.toISOString();}
function setFields(form,values){for(const [name,value]of Object.entries(values)){const element=field(form,name);if(element)element.value=value??'';}}
function safeURL(value,mail=false){try{const u=new URL(value);return ['https:','http:',...(mail?['mailto:']:[])].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}}
function sourceLink(value,label='Open original request',mail=false){const url=safeURL(value,mail);return url?'<a class="inline-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>':'';}
function currencyScale(currency){try{return new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits;}catch{return 2;}}
function amount(minor,currency){const n=currencyScale(currency),s=String(minor??0).padStart(n+1,'0');return n?s.slice(0,-n)+'.'+s.slice(-n):s;}
function priceMinor(value,currency){
  const digits=currencyScale(currency),pattern=digits?new RegExp('^[0-9]+(?:\\.[0-9]{1,'+digits+'})?$'):/^[0-9]+$/;
  if(!pattern.test(value))throw new Error('Enter a nonnegative price with at most '+digits+' decimal places for '+currency+'.');
  const parts=value.split('.'),minor=Number(parts[0]+(parts[1]||'').padEnd(digits,'0'));
  if(!Number.isSafeInteger(minor))throw new Error('The price is too large.');return minor;
}
function money(minor,currency){try{return new Intl.NumberFormat(undefined,{style:'currency',currency}).format(Number(minor)/10**currencyScale(currency));}catch{return currency+' '+amount(minor,currency);}}
function download(name,content,type='application/json'){
  const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function errorText(data){
  const main=typeof data?.error==='string'?data.error:data?.error?.message||data?.message||'The workspace could not receive this request.';
  const details=data?.details??data?.error?.details;
  if(Array.isArray(details))return main+'\n'+details.map(row=>[row.lead_id||row.id,row.reason||row.message].filter(Boolean).join(': ')).join('\n');
  return main;
}
async function api(url,body){
  let response;
  try{response=await fetch(url,{cache:'no-store',...(body?{method:'POST',headers:{'content-type':'application/json',
    'x-dealscout-token':document.querySelector('meta[name="dealscout-token"]').content},body:JSON.stringify(body)}:{})});}
  catch(error){throw Object.assign(new Error('The response was interrupted. Resume the saved request to learn its outcome.'),{cause:error,ambiguous:true});}
  let data;
  try{data=await response.json();}catch{throw Object.assign(new Error('The workspace response could not be read. Resume the same saved request.'),{status:response.status,ambiguous:true});}
  if(!response.ok)throw Object.assign(new Error(errorText(data)),{status:response.status,details:data,ambiguous:response.status>=500});
  return data;
}
function productionURL(packId,editionId=''){
  const params=new URLSearchParams({pack_id:packId,expected:state.root_sha256});
  if(state.source_revision)params.set('revision',state.source_revision);
  if(editionId)params.set('edition_id',editionId);
  return '/lead-production?'+params;
}
function exportURL(format,editionId=''){
  const params=new URLSearchParams({pack_id:selectedId,format});
  if(editionId)params.set('edition_id',editionId);
  if(state?.source_revision)params.set('revision',state.source_revision);
  if(state?.root_sha256)params.set('expected',state.root_sha256);
  return '/api/lead-packs/export?'+params;
}
function dirtyLabel(){
  $('brief-dirty').textContent=dirty.has('brief-form')?'Unsaved changes':'';
  $('lead-dirty').textContent=dirty.has('lead-form')?'Unsaved changes':'';
}
function allowNavigate(){
  if(creatorCommercialUI?.hasUnsavedChanges()){message('Save service billing or use Keep draft for later before changing the original programme.',true);return false;}
  if(creatorWorkbookUI?.isBusy()||creatorWorkbookUI?.hasPending()){message('Resume the original workbook before changing programmes.',true);return false;}
  if(packageContactUI?.hasPending()){message('Resume the original package request before changing customers.',true);return false;}
  if(busy){message('Finish the current save first.');return false;}
  cancelCustomerOpening();
  if(dirty.size&&!window.confirm('Discard the unsaved form changes and open the selected saved record?'))return false;
  if(dirty.size){creatorOperatingUI?.discardSelection();renderSelected();}
  dirty.clear();dirtyLabel();return true;
}
function markDirty(form){reviewEditEpoch++;dirty.add(form.id);dirtyLabel();}
function pendingView(){
  $('recovery').hidden=!pending;
  if(pending){
    $('pending-description').textContent=pending.body.kind.replaceAll('-',' ')+' · '+pending.body.operation_id+
      '. The complete request is saved for this workspace.';
    $('pending-error').textContent=pending.failure?.message||
      'Its outcome needs a response from the workspace. Resume this request before starting another save.';
  }
  $('resume-save').disabled=busy||reviewLoading;
  $('review-request').hidden=!pending?.failure?.definitive;
  $('review-request').disabled=busy||reviewLoading;
  if(!pending)$('rework-form').hidden=true;
  updateControls();
}
function readPending(){
  const raw=localStorage.getItem(pendingKey);if(!raw)return null;
  const saved=JSON.parse(raw);
  if(saved.workspace_identity!==state.workspace_identity||!saved.body?.operation_id||!saved.body?.kind||!saved.body?.input)
    throw new Error('The saved request is incomplete. Keep its browser record and download it before changing this workspace.');
  return saved;
}
function stashPending(body,{replaces=''}={}){
  const requestBytes=new TextEncoder().encode(JSON.stringify(body)).byteLength;
  if(requestBytes>8*1024*1024)throw new Error('The complete save exceeds the console\'s 8 MiB request limit. Keep the complete file. Import source leads in complete smaller batches, or use the full workspace transfer for an existing larger team record.');
  const existing=readPending();
  if(existing&&existing.body.operation_id!==replaces&&existing.body.operation_id!==body.operation_id){
    pending=existing;pendingView();throw new Error('Another tab has a saved request for this workspace. Resume that original request first.');
  }
  if(existing?.body.operation_id===body.operation_id&&!samePreparedRequest(existing.body,body))
    throw new Error('This operation ID already retains a different complete request. Preserve and resume its original body.');
  const replacedHistory=existing&&existing.body.operation_id===replaces&&existing.body.kind.startsWith('creator-')
    ?retainRejectedCreatorRequest(existing):null;
  const saved={version:'dealscout.lead-fulfillment-request.v1',workspace_identity:state.workspace_identity,
    created_at:new Date().toISOString(),source_revision:state.source_revision,body,...(replacedHistory?{replaced_request_history:replacedHistory}:{})};
  try{localStorage.setItem(pendingKey,JSON.stringify(saved));}catch(error){throw new Error('Browser storage could not retain the complete request. Browser quotas can be smaller than 8 MiB. Keep this form or file and free browser storage before retrying.');}
  pending=saved;pendingView();
}
function saveFailure(error){
  pending={...pending,failure:{message:error.message,status:error.status||0,
    definitive:Boolean(error.status>=400&&error.status<500&&!error.ambiguous)}};
  try{const current=readPending();if(current?.body.operation_id===pending.body.operation_id)localStorage.setItem(pendingKey,JSON.stringify(pending));}
  catch{message(error.message+'\nThe original request remains available through Download saved request.',true);}
  pendingView();
}
function clearPending(operationId){
  const current=readPending();
  if(current?.body.operation_id===operationId)localStorage.removeItem(pendingKey);
  pending=readPending();pendingView();
}
async function performPending(){
  if(!pending||busy||reviewLoading)return;
  if(pending.workspace_identity!==state.workspace_identity)throw new Error('Open the workspace that owns this saved request.');
  const saved=pending;busy=true;pendingView();
  let accepted=false,result=null;
  try{
    result=await api(saved.body.kind==='case-handoff'?'/api/lead-packs/case-save':'/api/lead-packs/save',saved.body);accepted=true;
    procurementUI.accepted(saved.body);
    clearPending(saved.body.operation_id);
    const packId=result.pack_id||result.receipt?.pack_id||result.result?.pack_id||result.selected?.pack?.id||
      saved.body.input.pack_id||(saved.body.kind==='pack-save'?saved.body.input.id:selectedId);
    dirty.clear();dirtyLabel();importedRows=null;receivedBundle=null;
    await loadState(saved.body.kind==='workspace-record-receive'?'':packId||'');
    if(saved.body.kind==='case-handoff'){
      const caseId=result.case_id||result.receipt?.case_id||result.result?.case_id;
      if(!caseId)throw new Error('The save was received. Open Sales case to continue in its original record.');
      location.assign('/case?'+new URLSearchParams({case_id:caseId}));return {accepted:true,result,state};
    }
    message((result.replayed||result.receipt?.replayed?'Original save recovered. ':'Saved. ')+
      (saved.body.kind==='edition-prepare'?'The complete customer edition is ready in Prepared customer editions.':
      saved.body.kind==='procurement-save'?'The complete procurement response and its source references are saved.':
      saved.body.kind==='procurement-handover-prepare'?'The selected response edition and original source files are preserved in its handover.':
      saved.body.kind==='customer-files-save'?'The complete file sources and their original revisions are saved. Select their customer package below.':
      saved.body.kind==='customer-package-prepare'?'The complete customer package and file index are ready for download below.':
      saved.body.kind==='delivery-record'?(result.case_record_id?'The actual delivery is saved with its customer edition and original case.':'The actual delivery is attached to its prepared edition.'):
      saved.body.kind==='delivery-feedback-receive'?'The native delivery feedback is saved with the original customer attempt.':
      saved.body.kind==='delivery-followup-link'?'Both recorded sends are connected in this customer’s delivery history.':
      saved.body.kind==='customer-request-receive'?'The complete original request or operator observation is saved. Review its affected leads below.':
      saved.body.kind==='customer-request-review'?'The complete review is retained. Approved items can now be prepared in the original replacement workflow.':
      saved.body.kind==='customer-request-replace'?'The complete revised edition is prepared. Its customer files and resolution report are ready; record the actual delivery when it occurs.':
      saved.body.kind==='commercial-scope'?'The paid edition opens its saved commercial scope, invoice and payments below.':
      saved.body.kind==='commercial-delivery'?'The original delivery is attached to its saved commercial case.':
      saved.body.kind==='workspace-record-receive'?'All received customer briefs are open in this workspace.':
      saved.body.kind==='working-record-receive'?'The complete working record is open for continued work.':'The current workspace is shown below.'));
    return {accepted:true,result,state};
  }catch(error){
    if(accepted){message('The save was accepted. Refresh the workspace to reopen it. '+error.message,true);}
    else{saveFailure(error);message(error.message,true);}
    return {accepted,result,error,state:null};
  }finally{busy=false;pendingView();}
}
function samePreparedRequest(a,b){
  const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'
    ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
  return JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
}
async function reviewOriginalCreatorRequest(saved){
  if(!saved?.body?.kind?.startsWith('creator-'))throw new Error('Select an original creator save.');
  if(busy||reviewLoading)throw new Error('Finish the current workspace operation first.');
  const workspace=state.workspace_identity,packId=state.selected?.pack.id;
  busy=true;pendingView();let status;
  try{
    status=await api('/api/lead-packs/creator-request-status',saved.body);
    const current=readPending();
    if(state.workspace_identity!==workspace||!current||!samePreparedRequest(current.body,saved.body))
      throw new Error('The saved request changed while its original outcome was being read.');
    if(status.version!=='dealscout.creator-request-status.v1'||status.workspace_identity!==workspace||
      status.operation_id!==saved.body.operation_id||status.kind!==saved.body.kind)
      throw new Error('The original request status belongs to another selection. Preserve the request.');
  }finally{busy=false;pendingView();}
  if(status.status==='COMMITTED'){
    const outcome=await performPending();
    if(!outcome?.accepted||outcome.error)throw outcome?.error||new Error('Resume the original accepted request to reopen its result.');
    return {committed:true,state:outcome.state,status};
  }
  if(status.status!=='NOT_COMMITTED_STALE'||status.not_committed!==true)
    throw new Error(status.status==='IDENTITY_CONFLICT'
      ?'This operation ID belongs to different saved work. Keep both complete requests for explicit reconciliation.'
      :'The original outcome remains unresolved. Resume that same request before preparing a replacement.');
  await loadState(saved.body.input.pack_id||packId||'');
  const current=readPending();
  if(state.workspace_identity!==workspace||!current||!samePreparedRequest(current.body,saved.body))
    throw new Error('The original request selection changed while its current workspace was opening.');
  const retained={...current,creator_resolution:{status,reviewed_root_sha256:state.root_sha256,
    reviewed_source_revision:state.source_revision,at:new Date().toISOString()}};
  const encoded=JSON.stringify(retained);
  localStorage.setItem(pendingKey,encoded);
  if(localStorage.getItem(pendingKey)!==encoded)throw new Error('The complete original request status could not be retained.');
  pending=retained;pendingView();
  return {committed:false,state,status};
}
function retainRejectedCreatorRequest(saved){
  const resolution=saved?.creator_resolution;
  if(!saved?.body?.kind?.startsWith('creator-')||resolution?.status?.status!=='NOT_COMMITTED_STALE'||
    resolution.status.not_committed!==true||resolution.status.operation_id!==saved.body.operation_id||
    resolution.status.workspace_identity!==state.workspace_identity)
    throw new Error('Read and retain the original creator request outcome before making a following request.');
  const key=pendingKey+'.reviewed.'+encodeURIComponent(saved.body.operation_id);
  const existing=localStorage.getItem(key);
  if(existing){
    const prior=JSON.parse(existing);
    if(prior.workspace_identity!==saved.workspace_identity||!samePreparedRequest(prior.original.body,saved.body))
      throw new Error('A different original request already occupies this retained review identity.');
  }else{
    const value={version:'dealscout.creator-reviewed-request.v1',workspace_identity:saved.workspace_identity,
      original:saved,resolution,retained_at:new Date().toISOString()};
    const encoded=JSON.stringify(value);localStorage.setItem(key,encoded);
    if(localStorage.getItem(key)!==encoded)throw new Error('The original rejected request could not be retained before replacement.');
  }
  return key;
}
async function reviewOperatingRequest(saved,acceptReview){
  const reviewed=await reviewOriginalCreatorRequest(saved);
  if(reviewed.committed)return reviewed.state;
  const original=readPending();
  if(!original||!samePreparedRequest(original.body,saved.body))throw new Error('Open the original retained operating request.');
  retainRejectedCreatorRequest(original);
  clearPending(original.body.operation_id);
  try{return await acceptReview({operationId:original.body.operation_id,state,notCommitted:true});}
  catch(error){
    // A following returned-work request may already be durably pending. Preserve
    // it; otherwise restore the original exact body and its full review evidence.
    if(!readPending()){localStorage.setItem(pendingKey,JSON.stringify(original));pending=original;pendingView();}
    throw error;
  }
}
async function loadCreatorOperatingSource(bound){
  const capture={...bound,edit_epoch:reviewEditEpoch},current=creatorProgrammeUI.getSelection();
  const matches=()=>state?.workspace_identity===capture.workspace_identity&&
    creatorProgrammeUI.getSelection()?.pack_id===capture.pack_id&&creatorProgrammeUI.getSelection()?.programme_id===capture.programme_id&&
    state.source_revision===capture.source_revision&&state.root_sha256===capture.root_sha256&&reviewEditEpoch===capture.edit_epoch;
  if(!current||!matches())throw new Error('Open the original current programme before capturing its source.');
  const params=new URLSearchParams({pack_id:capture.pack_id,programme_id:capture.programme_id,format:'creator-programme-source',
    revision:String(capture.source_revision),expected:capture.root_sha256});
  const response=await fetch('/api/lead-packs/export?'+params,{credentials:'same-origin',cache:'no-store'});
  if(!response.ok){let detail;try{detail=await response.json();}catch{}throw new Error(detail?errorText(detail):'The complete original source export could not be read.');}
  const text=await response.text();
  if(!matches())throw new Error('The selected programme or an edited form changed during source capture. Its previous source remains retained.');
  return text;
}
async function retainedCreatorRequest(request,{formId='creator-operating-desk'}={}){
  if(!state?.selected)throw new Error('Open the original customer before saving its prepared programme request.');
  if(busy||reviewLoading||packageContactUI?.hasPending())throw new Error('Finish the current workspace operation first.');
  if([...dirty].some(id=>id!==formId))throw new Error('Save or close the other edited form before this prepared request.');
  if(!request||typeof request!=='object'||Array.isArray(request)||typeof request.operation_id!=='string'||
    !request.operation_id||typeof request.kind!=='string'||!request.kind.startsWith('creator-')||
    !request.input||typeof request.input!=='object'||typeof request.expected_root_sha256!=='string')
    throw new Error('Keep the complete original creator programme request.');
  const body=JSON.parse(JSON.stringify(request)),selected=creatorProgrammeUI.getSelection();
  if(!selected||body.input.programme_id!==selected.programme_id)
    throw new Error('Open the original programme selected by this prepared request.');
  const original=readPending();
  if(original){
    if(original.workspace_identity!==state.workspace_identity||!samePreparedRequest(original.body,body))
      throw new Error('Resume the different saved request before continuing this programme.');
    pending=original;pendingView();
  }else stashPending(body);
  const outcome=await performPending();
  if(!outcome?.accepted||outcome.error||!outcome.state)
    throw Object.assign(outcome?.error||new Error('The original save needs its response before continuing.'),
      {accepted:Boolean(outcome?.accepted),operation_id:body.operation_id,...(outcome?.result?{receipt:outcome.result}:{})});
  return outcome.state;
}
async function mutate(kind,input,formId=''){
  const other=[...dirty].filter(id=>id!==formId);
  if(other.length)throw new Error('Save or close the other edited form before saving this operation.');
  if(!state)throw new Error('Open the workspace before saving.');
  if(reviewLoading)throw new Error('Finish opening the selected customer before saving.');
  if(busy||pending||packageContactUI?.hasPending()||creatorWorkbookUI?.isBusy()||creatorWorkbookUI?.hasPending())throw new Error('Resume the saved request before starting another save.');
  const body={operation_id:uuid('lead-op'),kind,input,expected_root_sha256:state.root_sha256};
  try{stashPending(body);}catch(error){throw new Error('The save has not started. '+error.message);}
  await performPending();
}
function updateControls(){
  const locked=busy||reviewLoading||Boolean(pending)||Boolean(packageContactUI?.hasPending())||Boolean(creatorWorkbookUI?.isBusy())||Boolean(creatorWorkbookUI?.hasPending());
  $('case-link-start').disabled=locked;
  for(const form of MUTATION_FORMS)for(const element of form.elements)element.disabled=locked;
  $('case-link-save').disabled=locked||!caseLinkPreview;
  $('save-delivery-feedback').disabled=locked||!feedbackPreview?.can_receive;
  $('new-pack').disabled=busy;$('new-lead').disabled=locked;$('refresh').disabled=busy||reviewLoading;
  for(const id of ['pack-search','pack-filter','pack-sort','lead-search','lead-filter'])$(id).disabled=reviewLoading;
  $('pack-previous-page').disabled=reviewLoading||reviewOffset===0;
  $('pack-next-page').disabled=reviewLoading||reviewOffset+REVIEW_PAGE_SIZE>=matchingCustomerPacks().length;
  $('main').setAttribute('aria-busy',String(reviewLoading||busy));
  $('resume-save').disabled=busy||reviewLoading;$('review-request').disabled=busy||reviewLoading;
  renderReviewNavigation();
  for(const button of document.querySelectorAll('[data-prepare-replacement],[data-record-delivery],[data-record-followup],[data-link-followup],[data-withdraw],[data-commerce],[data-case-delivery]'))button.disabled=locked;
  $('receive-button').disabled=locked||!receivedBundle;
  $('save-import').disabled=locked||!importedRows;
  $('add-replacement').disabled=locked||!val(replacementForm,'replaces');
  const selection=editionSelection();
  const freeCount=sampleQuantity(state?.selected?.pack.document.brief);
  $('prepare-sample').textContent='Prepare free sample of '+leadCountLabel(freeCount);
  $('prepare-sample').disabled=locked||includedEditions.size>0||!selection.valid||selectedLeads.size!==freeCount;
  $('prepare-paid').disabled=locked||includedEditions.size>0||!selection.valid||selectedLeads.size!==(state?.selected?.pack.document.brief.quantity??0);
  $('prepare-complimentary').disabled=locked||!selection.valid||selectedLeads.size!==(state?.selected?.pack.document.brief.quantity??0);
  $('clear-selection').disabled=locked||(!selectedLeads.size&&!includedEditions.size);
  for(const box of document.querySelectorAll('[data-include-edition]'))box.disabled=locked;
  for(const box of document.querySelectorAll('[data-select-lead]')){
    const lead=state?.selected?.leads.find(row=>row.id===box.value);
    box.disabled=locked||!leadSelectable(lead)||inclusionLeadIds().has(box.value);
  }
  for(const button of reworkForm.querySelectorAll('button'))button.disabled=busy||reviewLoading;
  $('save-commerce').disabled=locked||!commerceCase;
  reconciliation?.controls();
  const useExisting=Boolean(val(commerceForm,'scope_id'));
  for(const element of $('commerce-terms').elements||$('commerce-terms').querySelectorAll('input,textarea'))element.disabled=locked||useExisting;
  customerRequestsUI.controls();customerFilesUI.controls();procurementUI.controls();packageContactUI?.controls();creatorProgrammeUI.controls();creatorMeasurementUI?.controls();creatorOperatingUI?.controls();creatorWorkbookUI?.controls();creatorCommercialUI?.controls();
}
function renderPacks(){
  const query=$('pack-search').value.trim(),matches=matchingCustomerPacks();
  reviewOffset=Math.min(Math.floor(reviewOffset/REVIEW_PAGE_SIZE)*REVIEW_PAGE_SIZE,Math.max(0,Math.floor((matches.length-1)/REVIEW_PAGE_SIZE)*REVIEW_PAGE_SIZE));
  const rows=matches.slice(reviewOffset,reviewOffset+REVIEW_PAGE_SIZE);
  $('pack-results-summary').textContent=matches.length?(reviewOffset+1)+'–'+(reviewOffset+rows.length)+' of '+matches.length+' matching customers · '+state.packs.length+' saved.':'No matching customers · '+state.packs.length+' saved.';
  $('pack-previous-page').disabled=reviewLoading||reviewOffset===0;$('pack-next-page').disabled=reviewLoading||reviewOffset+REVIEW_PAGE_SIZE>=matches.length;
  $('packs').innerHTML=rows.length?rows.map(row=>'<tr'+(row.id===selectedId?' aria-current="true"':'')+'><td><strong>'+esc(row.customer)+'</strong>'+esc(row.title)+'<small>'+esc(row.id)+'</small></td>'+
    '<td>'+esc(row.quantity)+' leads · '+esc(money(row.price_minor,row.currency))+'</td><td>'+esc(row.leads)+' leads / '+esc(row.editions)+' editions'+
      (row.delivery_attention?'<small>'+esc(row.delivery_attention)+' delivery '+(row.delivery_attention===1?'needs':'attempts need')+' attention</small>':'')+'</td>'+
    '<td>'+esc(time(row.updated_at))+'</td><td><button type="button" data-open-pack="'+esc(row.id)+'"'+(busy?' disabled':'')+'>Open</button></td></tr>').join(''):
    '<tr><td colspan="5" class="empty">'+(query?'No saved customer briefs match this search.':'Create a customer brief to prepare the first useful sample.')+'</td></tr>';
  renderReviewNavigation(matches);
  $('workspace-record').href=exportURL('workspace-record');
  $('workspace-edition').textContent='Workspace '+state.workspace_identity+' · Edition '+(state.source_revision||state.current_revision||state.root_sha256);
}
function renderBrief(pack=null){
  packForm.reset();$('brief-panel').hidden=false;field(packForm,'id').readOnly=Boolean(pack);
  const d=pack?.document;
  setFields(packForm,{id:pack?.id||uuid('pack'),customer_name:d?.customer.name||'',company_domain:d?.customer.company_domain||'',
    contact_url:d?.customer.contact_url||'',case_id:d?.customer.case_id||'',prospect_id:d?.customer.prospect_id||'',
    title:d?.brief.title||'',description:d?.brief.description||'',geography:d?.brief.geography||'',
    lead_kind:d?.brief.lead_kind||'any',sample_quantity:pack?(d?.brief.sample_quantity??''):5,quantity:d?.brief.quantity??5,currency:d?.brief.currency||'USD',
    price:amount(d?.brief.price_minor??2000,d?.brief.currency||'USD'),max_age_days:d?.brief.max_age_days??0,
    skills:(d?.brief.skills||[]).join('\n'),excluded_domains:(d?.brief.excluded_domains||[]).join('\n'),
    excluded_sources:(d?.brief.excluded_sources||[]).join('\n'),exclusions:d?.brief.exclusions||'',operator_note:d?.operator_note||''});
  $('brief-title').textContent=pack?d.customer.name+' · Customer brief':'New customer brief';
  $('brief-edition').textContent=pack?'Saved revision '+pack.revision+' · '+time(pack.updated_at):'Enter the customer criteria and paid offer.';
  $('working-record').hidden=!pack;if(pack)$('working-record').href=exportURL('working-record');
  const hasPaid=Boolean(pack&&(state.selected?.editions||[]).some(e=>e.kind==='paid'&&!e.withdrawn));
  $('production-history').hidden=!pack;
  if(pack)$('production-history').href='/lead-production/history?pack_id='+encodeURIComponent(pack.id);
  $('production-workspace').hidden=!hasPaid;
  $('production-empty').hidden=!pack||hasPaid;
  if(hasPaid)$('production-workspace').href=productionURL(pack.id);
  $('capture-workspace').hidden=!pack;if(pack)$('capture-workspace').href='/lead-captures?pack_id='+encodeURIComponent(pack.id);
  dirty.delete('brief-form');dirtyLabel();updateOffer();
}
function updateOffer(){
  const currency=val(packForm,'currency').toUpperCase(),count=val(packForm,'quantity'),price=val(packForm,'price');
  let priceLabel=price+' '+currency;try{priceLabel=money(priceMinor(price,currency),currency);}catch{}
  let free;try{free=enteredSampleQuantity();}catch(error){$('offer-summary').textContent=error.message;return;}
  const freeCount=free??1;
  $('offer-summary').textContent='Free sample: '+leadCountLabel(freeCount)+(free===undefined?' (legacy default; no quantity field saved)':'')+
    '. Paid offer: '+count+' additional leads for '+priceLabel+'. A complimentary full pack uses '+count+' leads at zero price'+
    '. Requests use the original date; company-fit sources use their checked date. An age limit of 0 accepts any date.';
}
function renderLeadEditor(row=null,documentOverride=null){
  leadForm.reset();leadId=row?.id||'';$('lead-editor').hidden=false;
  const d=documentOverride||row?.document||{};
  const dateOnly=/^\d{4}-\d\d-\d\d$/.test(d.checked_at||'');
  field(leadForm,'checked_date_only').checked=dateOnly;field(leadForm,'checked_at').type=dateOnly?'date':'datetime-local';
  field(leadForm,'checked_at').step=dateOnly?'1':'0.001';
  setFields(leadForm,{id:row?.id||uuid('lead'),organization:d.organization||'',person:d.person||'',company_domain:d.company_domain||'',
    company_url:d.company_url||'',buyer_key:d.buyer_key||'',source_url:d.source_url||'',published_on:d.published_on||'',
    author_updated_on:d.author_updated_on||'',lead_kind:d.lead_kind||'problem_signal',demand:d.demand||'',fit:d.fit||'',
    source_status:d.source_status||'unconfirmed',checked_at:dateOnly?d.checked_at:localTime(d.checked_at),deadline_on:d.deadline_on||'',
    deadline_at:localTime(d.deadline_at),status_note:d.status_note||'',contact_url:d.contact_url||'',
    contact_instructions:d.contact_instructions||'',geography:d.geography||'',budget:d.budget||'',
    opening_message:d.opening_message||'',tags:(d.tags||[]).join('\n'),operator_note:d.operator_note||'',
    observed_publication_label:d.source_time_observation?.publication_label||'',
    observed_closing_label:d.source_time_observation?.closing_label||'',
    observed_source_url:d.source_time_observation?.source_url||'',
    observed_checked_at:d.source_time_observation?.checked_at||''});
  field(leadForm,'observed_publication_label').dataset.present=String(Boolean(d.source_time_observation&&Object.hasOwn(d.source_time_observation,'publication_label')));
  for(const name of ['checked_at','deadline_at']){field(leadForm,name).dataset.original=d[name]||'';field(leadForm,name).dataset.local=field(leadForm,name).value;}
  field(leadForm,'id').readOnly=Boolean(row);
  $('lead-editor-title').textContent=row?(d.organization||row.id)+' · Lead record':'Add a lead';
  $('lead-edition').textContent=row?'Current saved revision '+row.revision+' · '+time(row.updated_at):'Incomplete records can be saved and completed later.';
  $('lead-history').hidden=!row?.history.length;
  $('lead-history-list').innerHTML=(row?.history||[]).slice().reverse().map(old=>'<p>Revision '+esc(old.revision)+' · '+esc(time(old.updated_at))+
    ' <button type="button" data-restore-lead="'+esc(row.id)+'" data-revision="'+old.revision+'">Open this revision as an editable draft</button></p>').join('');
  dirty.delete('lead-form');if(documentOverride)dirty.add('lead-form');dirtyLabel();updateControls();
}
function inclusionLeadIds(){
  const ids=new Set();
  for(const edition of state?.selected?.editions||[])if(includedEditions.get(edition.id)===edition.sha256&&!edition.withdrawn)
    for(const row of edition.leads)ids.add(row.id);
  return ids;
}
function leadSelectable(row){
  if(!row?.quality?.ready)return false;
  if(!row.used)return true;
  return Array.isArray(row.used_by_edition_ids)&&row.used_by_edition_ids.length>0&&
    row.used_by_edition_ids.every(id=>includedEditions.has(id));
}
function editionSelection(){
  const rows=state?.selected?.leads||[],required=inclusionLeadIds();
  const completeRefs=[...includedEditions].every(([id,sha])=>(state?.selected?.editions||[]).some(e=>e.id===id&&e.sha256===sha&&!e.withdrawn));
  return {valid:completeRefs&&[...required].every(id=>selectedLeads.has(id))&&
    [...selectedLeads].every(id=>leadSelectable(rows.find(row=>row.id===id))),required};
}
function renderIncludedEditions(){
  const editions=(state?.selected?.editions||[]).filter(row=>!row.withdrawn);
  for(const [id,sha]of includedEditions)if(!editions.some(row=>row.id===id&&row.sha256===sha))includedEditions.delete(id);
  $('complimentary-inclusion-list').innerHTML=editions.length?editions.map(edition=>
    '<div class="edition"><label class="check-label"><input type="checkbox" data-include-edition value="'+esc(edition.id)+'"'+
    (includedEditions.has(edition.id)?' checked':'')+'>Include every lead from '+esc(editionLabel(edition))+'</label>'+
    '<p class="muted">Original price: '+esc(money(edition.price_minor,edition.currency))+' · '+esc(edition.id)+'</p>'+
    '<details><summary>Review all '+esc(edition.leads.length)+' original selected leads</summary><ol>'+
    edition.leads.map(row=>'<li>'+esc(row.document.organization||row.id)+' · '+esc(row.id)+
      ' <button type="button" data-edit-lead="'+esc(row.id)+'">Open current research</button></li>').join('')+
    '</ol><button type="button" data-open-edition="'+esc(edition.id)+'">Open immutable original edition</button></details></div>').join(''):
    '<p class="muted">No earlier active edition is available to include. Choose the full quantity from ready, unused leads.</p>';
}
function renderLeads(){
  const all=state.selected?.leads||[],query=$('lead-search').value.trim().toLowerCase(),filter=$('lead-filter').value;
  renderIncludedEditions();const required=inclusionLeadIds();
  for(const id of required)selectedLeads.add(id);
  for(const id of [...selectedLeads]){const row=all.find(row=>row.id===id);if(!required.has(id)&&!leadSelectable(row))selectedLeads.delete(id);}
  const rows=all.filter(row=>{
    const d=row.document;
    if(query&&![row.id,d.organization,d.person,d.source_url,d.demand,d.geography,...d.tags].join(' ').toLowerCase().includes(query))return false;
    return filter==='all'||filter==='ready'&&leadSelectable(row)||filter==='incomplete'&&!row.quality.ready||filter==='used'&&row.used;
  });
  $('leads').innerHTML=rows.length?rows.map(row=>{const d=row.document;
    return '<tr><td><label class="check-label"><input type="checkbox" data-select-lead value="'+esc(row.id)+'" aria-label="Select '+esc(d.organization||row.id)+'"'+
      (selectedLeads.has(row.id)?' checked':'')+(!leadSelectable(row)||required.has(row.id)?' disabled':'')+'></label></td>'+
      '<td><strong>'+esc(d.organization||'Unnamed lead')+'</strong><p>'+esc(d.demand)+'</p><small>'+esc(SIGNAL[d.lead_kind]||d.lead_kind)+
      (d.geography?' · '+esc(d.geography):'')+'</small><small>'+esc(row.id)+' · Revision '+esc(row.revision)+'</small></td>'+
      '<td><span class="tag">'+esc(sourceStatus(d))+'</span>'+
      (d.published_on||d.lead_kind!=='company_fit'?'<small>'+(d.lead_kind==='company_fit'?'Published: ':'Original: ')+esc(time(d.published_on)||'Not recorded')+'</small>':'')+
      (d.author_updated_on?'<small>'+(d.lead_kind==='company_fit'?'Source update: ':'Buyer update: ')+esc(time(d.author_updated_on))+'</small>':'')+
      '<small>Checked: '+esc(time(d.checked_at)||'Not recorded')+'</small>'+
      (d.deadline_at||d.deadline_on?'<small>Deadline: '+esc(time(d.deadline_at||d.deadline_on))+'</small>':'')+
      (d.source_time_observation?'<small>Source label: '+esc([d.source_time_observation.publication_label,d.source_time_observation.closing_label].filter(Boolean).join(' · '))+
        ' · observed '+esc(time(d.source_time_observation.checked_at))+'</small>':'')+
      sourceLink(d.source_url,d.lead_kind==='company_fit'?'Open company source':'Open original request')+'</td><td>'+(row.used?'<span class="tag">'+(leadSelectable(row)?'Included for complimentary preparation':'Already prepared for this customer')+'</span>':
      row.quality.ready?'<span class="tag">Available for selection</span>':'<span class="tag">Needs completion</span>')+
      (row.quality.reasons.length?'<ul class="reason-list">'+row.quality.reasons.map(reason=>'<li>'+esc(reason)+'</li>').join('')+'</ul>':'')+
      row.quality.notes.map(note=>'<small>'+esc(note)+'</small>').join('')+
      (row.duplicates.length?'<small>Shares a company or request with: '+esc(row.duplicates.join(', '))+'</small>':'')+'</td>'+
      '<td><button type="button" data-edit-lead="'+esc(row.id)+'">Edit</button></td></tr>';
    }).join(''):'<tr><td colspan="5" class="empty">'+(all.length?'No leads match the current view.':'Add original buyer requests or import the complete lead JSON.')+'</td></tr>';
  selectionSummary();updateControls();
}
function selectionSummary(){
  const count=selectedLeads.size,brief=state?.selected?.pack.document.brief,quantity=brief?.quantity??5,freeCount=sampleQuantity(brief);
  const selection=editionSelection();
  $('selection-summary').textContent=count+' selected · A free sample uses '+leadCountLabel(freeCount)+' from unused inventory; paid and complimentary packs use '+leadCountLabel(quantity)+'.'+
    (includedEditions.size?' All '+selection.required.size+' leads from '+includedEditions.size+' included edition(s) stay selected. Only complimentary preparation is available.':'')+
    (!selection.valid?' Some selected leads need completion or are also used by an edition outside this inclusion. Review their current research and all original edition uses.':'');
}
function latestPaid(){
  const editions=state?.selected?.editions||[];
  return editions.filter(row=>row.kind!=='sample'&&!row.withdrawn&&!editions.some(next=>next.replaces===row.id));
}
function editionLabel(row){
  return KIND[row.kind]+' · '+time(row.prepared_at)+' · '+row.leads.length+' leads';
}
function focusEdition(editionId){
  const card=[...$('editions').querySelectorAll('[data-edition-id]')].find(row=>row.dataset.editionId===editionId);
  if(card){reviewEdition=editionId;card.scrollIntoView({block:'start'});card.focus({preventScroll:true});rememberReview();}
}
async function customerDownload(anchor){
  if(busy||reviewLoading)throw new Error('Finish opening or saving the current customer before downloading another edition.');
  busy=true;updateControls();anchor.setAttribute('aria-busy','true');
  message('Preparing the selected saved customer edition…');
  try{
    let response;
    try{response=await fetch(anchor.href,{cache:'no-store'});}catch{throw new Error('The download was interrupted. Download the same saved edition again.');}
    if(!response.ok){
      let failure;try{failure=await response.json();}catch{}
      throw new Error(failure?errorText(failure):'The saved customer download could not be opened. Refresh this workspace and select its edition again.');
    }
    const content=await response.blob();
    const filename=/filename="([^"]+)"/i.exec(response.headers.get('content-disposition')||'')?.[1];
    if(!filename)throw new Error('The customer download returned no filename. Keep this edition open and retry its download.');
    download(filename,content,response.headers.get('content-type')||'application/octet-stream');
    message(filename+' is ready in your downloads. Record its delivery after sharing it with the customer.');
  }finally{busy=false;anchor.removeAttribute('aria-busy');updateControls();}
}
function commerceFor(editionId){return state?.commercial?.editions.find(row=>row.edition_id===editionId)||null;}
function caseDeliverySummary(editionId,deliveryId){
  const current=commerceFor(editionId),saved=(current?.deliveries||[]).find(row=>row.delivery_id===deliveryId);
  if(saved)return '<p><a href="/deal?case='+esc(encodeURIComponent(saved.case_id))+'">'+
    (saved.available?(saved.source_changed?'Open corrected case delivery':'Open original case delivery'):'Receive the original case for this delivery')+'</a></p>';
  const edition=state?.selected?.editions.find(row=>row.id===editionId);
  return edition?.commercial_eligible===true&&current?.available?'<button type="button" data-case-delivery="'+esc(deliveryId)+'">Attach this delivery to the case</button>':'';
}
function commercialCard(edition){
  if(edition.commercial_eligible!==true)return edition.original_kind==='complimentary'||edition.kind==='complimentary'?'<p class="muted">Complimentary lineage: zero-price customer edition. No commercial scope or invoice is created for this lineage.</p>':'';
  const current=commerceFor(edition.id),link=current?.link;
  if(!link)return '<div class="commercial-section"><h4>Scope and collection</h4>'+
    (edition.withdrawn?'<p>This edition was withdrawn.</p>':
    '<p>Keep this paid pack in its original customer case.</p><button type="button" data-commerce="'+esc(current?.paid_edition_id||edition.id)+'">Prepare commercial scope</button>')+'</div>';
  const invoices=current.invoices||[];
  return '<div class="commercial-section"><h4>Scope and collection</h4><p><a href="'+esc(current.case_url)+'">Open original commercial case</a></p>'+
    (current.available?'<dl><dt>Customer</dt><dd>'+esc(current.scope.document.customer)+'</dd>'+
      '<dt>Saved scope</dt><dd>'+esc(current.scope.document.title)+' · Revision '+esc(current.scope.number)+'</dd>'+
      '<dt>Saved scope price</dt><dd>'+esc(current.scope.document.price?money(current.scope.document.price.amount_minor,current.scope.document.price.currency):'Unentered')+'</dd>'+
      '<dt>Original agreement records</dt><dd>'+esc(current.agreements.length)+'</dd>'+
      '<dt>Client acceptance records</dt><dd>'+esc(current.acceptances.length)+'</dd></dl>'+
      '<p><a download href="/api/deal/export?'+esc(new URLSearchParams({case:link.case_id,scope:link.scope_id}))+'">Download saved proposal</a></p>'+
      (invoices.length?'<div class="table-wrap"><table><caption>Invoices allocated to this exact scope revision</caption><thead><tr><th>Invoice</th><th>Amount</th><th>Recorded payment</th><th>Remaining</th><th>Due</th></tr></thead><tbody>'+
        invoices.map(row=>'<tr><td>'+esc(row.title)+'</td><td>'+esc(money(row.amount.amount_minor,row.amount.currency))+'</td>'+
          '<td>'+esc(money(row.recorded_paid.amount_minor,row.recorded_paid.currency))+'</td><td>'+esc(money(row.recorded_remaining.amount_minor,row.recorded_remaining.currency))+'</td><td>'+esc(row.due_date||'Unentered')+'</td></tr>').join('')+'</tbody></table></div>':
        '<p>Record the issued invoice and allocate its actual payment in the original commercial case. This view follows invoices assigned to scope revision '+esc(current.scope.number)+'.</p>'):
      '<p>Receive the original company case and saved scope into this workspace to continue its commercial work.</p>')+
    (edition.kind==='replacement'?'<p>This replacement continues the original paid pack scope.</p>':'')+
    (!edition.withdrawn?'<button type="button" data-commerce="'+esc(current.paid_edition_id)+'">Choose or revise scope link</button>':'')+
    ((current.prior_links||[]).length?'<details><summary>Earlier scope links</summary><ul>'+current.prior_links.map(old=>'<li><a href="/deal?case='+esc(encodeURIComponent(old.case_id))+'">'+esc(old.case_id)+'</a> · '+esc(old.scope_id)+(old.reason?' · '+esc(old.reason):'')+'</li>').join('')+'</ul></details>':'')+'</div>';
}
async function loadCommerceCase(caseId){
  const navigation=reviewGeneration;
  commerceCase=null;$('commerce-case').textContent=caseId?'Opening the original commercial case…':'Choose the existing company case.';
  field(commerceForm,'scope_id').innerHTML=option('','Prepare a new proposed scope');updateControls();
  if(!caseId)return;
  let selected;
  try{selected=await api('/api/deal/state?'+new URLSearchParams({case:caseId}));}
  catch(error){if(navigation!==reviewGeneration||val(commerceForm,'case_id')!==caseId)return;throw error;}
  if(navigation!==reviewGeneration||val(commerceForm,'case_id')!==caseId)return;
  if(!selected.selected?.expected_case_sha256)throw new Error('Open the original complete company case.');
  commerceCase=selected.selected;
  field(commerceForm,'scope_id').innerHTML=option('','Prepare a new proposed scope')+
    commerceCase.commercial.scopes.slice().reverse().map(row=>option(row.id,'Revision '+row.number+' · '+row.document.title)).join('');
  $('commerce-case').textContent=[commerceCase.buyer,commerceCase.partner,commerceCase.existing_owner].filter(Boolean).join(' · ');
  renderCommerceScope();updateControls();
}
function renderCommerceScope(){
  const scope=commerceCase?.commercial.scopes.find(row=>row.id===val(commerceForm,'scope_id'));
  $('commerce-terms').hidden=Boolean(scope);
  $('commerce-scope').textContent=scope?'Selected saved scope: '+scope.document.customer+' · '+
    (scope.document.price?money(scope.document.price.amount_minor,scope.document.price.currency):'Price unentered')+
    '. This preserves that scope’s recorded terms.':'The new proposed scope uses the paid edition’s exact price, lead count and saved customer criteria.';
  updateControls();
}
async function openCommerce(editionId){
  if(!allowNavigate())return;
  const navigation=reviewGeneration,packId=selectedId;
  const edition=state.selected.editions.find(row=>row.id===editionId);
  if(!edition||edition.kind!=='paid'||edition.commercial_eligible!==true)throw new Error('Choose the original commercially eligible paid edition.');
  const current=commerceFor(editionId),link=current?.link;
  commerceForm.reset();commerceCase=null;
  field(commerceForm,'case_id').innerHTML=option('','Choose an existing customer case')+
    (state.commercial?.cases||[]).map(row=>option(row.id,[row.buyer,row.partner,row.id].filter(Boolean).join(' · '))).join('');
  setFields(commerceForm,{edition_id:edition.id,previous_id:link?.id||'',title:edition.brief.brief.title.slice(0,200),
    customer:edition.brief.customer.name,exclusions:edition.brief.brief.exclusions});
  $('commerce-edition').textContent=edition.brief.brief.title+' · '+edition.leads.length+' additional leads · '+money(edition.price_minor,edition.currency);
  $('commerce-criteria').textContent=edition.brief.brief.description;
  $('commerce-reason-label').hidden=!link;field(commerceForm,'reason').required=Boolean(link);
  $('commerce-panel').hidden=false;dirty.delete('commerce-form');
  const suggestion=link?.case_id||state.selected.pack.document.customer.case_id||edition.brief.customer.case_id;
  if((state.commercial?.cases||[]).some(row=>row.id===suggestion))field(commerceForm,'case_id').value=suggestion;
  await loadCommerceCase(val(commerceForm,'case_id'));
  if(navigation!==reviewGeneration||packId!==selectedId)return;
  if(link&&commerceCase?.commercial.scopes.some(row=>row.id===link.scope_id)){
    field(commerceForm,'scope_id').value=link.scope_id;renderCommerceScope();
  }
  $('commerce-panel').scrollIntoView({block:'start'});field(commerceForm,'case_id').focus();
}
function updateDeliveryCommerce(){
  const current=commerceFor(val(deliveryForm,'edition_id'));
  const edition=state?.selected?.editions.find(row=>row.id===val(deliveryForm,'edition_id'));
  const linked=Boolean(edition?.commercial_eligible===true&&current?.link&&current.available);
  $('delivery-commerce').hidden=!linked;field(deliveryForm,'attach_to_case').checked=linked;
  field(deliveryForm,'receipt_url').required=linked;customerFilesUI.deliveryOptions();
  $('delivery-commerce-case').textContent=linked?'Scope: '+current.scope.document.title+' · '+current.scope.document.customer+'. The original source link records the same delivered edition in this case.':'';
}
async function openCaseDelivery(deliveryId){
  if(!allowNavigate())return;
  const delivery=state.selected.deliveries.find(row=>row.id===deliveryId),current=delivery&&commerceFor(delivery.edition_id);
  const edition=delivery&&state.selected.editions.find(row=>row.id===delivery.edition_id);
  if(!delivery||edition?.commercial_eligible!==true||!current?.available)throw new Error('Open this paid lineage’s original saved commercial case first.');
  caseDeliveryForm.reset();setFields(caseDeliveryForm,{delivery_id:deliveryId,evidence_url:delivery.receipt_url});
  $('case-delivery-description').textContent=delivery.channel+' · '+delivery.destination+' · '+time(delivery.delivered_at)+
    ' — '+current.scope.document.title;
  $('case-delivery-panel').hidden=false;dirty.delete('case-delivery-form');
  $('case-delivery-panel').scrollIntoView({block:'start'});field(caseDeliveryForm,'evidence_url').focus();
}

const DELIVERY_ACTION={failed:'Delivery failed',delayed:'Delivery delayed',delivered:'Mail server reported delivery',
  relayed:'Mail server relayed the message',expanded:'Mail server expanded the recipient'};
function deliveryFeedbackHTML(delivery){
  const selected=state.selected,events=(selected.delivery_feedback||[]).filter(row=>row.delivery_id===delivery.id);
  const current=(selected.delivery_states||[]).find(row=>row.delivery_id===delivery.id);
  const previousId=current?.previous_delivery_id||delivery.previous_delivery_id;
  const previous=previousId?selected.deliveries.find(row=>row.id===previousId):null;
  const association=(selected.delivery_followups||[]).find(row=>row.delivery_id===delivery.id);
  let out=previous?'<p>Follows the delivery to '+esc(previous.destination)+' on '+esc(time(previous.delivered_at))+'.</p>':'';
  if(association)out+='<p>'+esc(association.note)+'</p><p class="muted">Connection recorded '+esc(time(association.recorded_at))+'.</p>';
  if(events.length){
    const latest=events.find(row=>row.id===current?.latest_feedback_id);
    out+='<p><strong>'+esc(DELIVERY_ACTION[latest?.action]||latest?.state||'Delivery report received')+'</strong>'+
      (latest?.status?' · '+esc(latest.status):'')+'</p>';
    out+='<details'+(current?.needs_attention?' open':'')+'><summary>'+events.length+' delivery report'+(events.length===1?'':'s')+'</summary>'+
      events.slice().sort((a,b)=>Date.parse(a.occurred_at)-Date.parse(b.occurred_at)||a.id.localeCompare(b.id)).map(row=>
        '<dl><dt>Reported</dt><dd>'+esc(time(row.occurred_at))+'</dd><dt>Recipient</dt><dd>'+esc(row.recipient)+'</dd>'+
        '<dt>Outcome</dt><dd>'+esc(DELIVERY_ACTION[row.action]||row.state)+' · '+esc(row.delivery_failure_kind==='GMAIL_ATTACHMENT_POLICY'?'Attachment blocked by Gmail':row.delivery_failure_kind==='GMAIL_SENDING_LIMIT'?'Gmail sending limit':row.status)+'</dd>'+
        (row.diagnostic?.value?'<dt>Mail server detail</dt><dd>'+esc(row.diagnostic.value)+'</dd>':'')+
        (row.last_attempt_at?'<dt>Last attempt</dt><dd>'+esc(time(row.last_attempt_at))+'</dd>':'')+
        (row.will_retry_until?'<dt>Provider retry period ends</dt><dd>'+esc(time(row.will_retry_until))+'</dd>':'')+
        '<dt>Original notice</dt><dd>'+esc(row.notice_provider_id)+'</dd></dl>').join('')+'</details>';
  }
  const followups=(current?.followup_delivery_ids||[]).map(id=>selected.deliveries.find(row=>row.id===id)).filter(Boolean);
  if(followups.length)out+='<p>Follow-up delivery: '+followups.map(row=>esc(row.destination)+' · '+esc(time(row.delivered_at))).join('; ')+'.</p>';
  if(current?.needs_attention)out+=(current.account_recovery_required
    ? '<p>Gmail reported a sending limit for this original message. Keep the recipient and offer; continue through the existing account recovery when an actual send is available.</p>'
    : current.review_required ? '<p>The retained provider reports contain conflicting terminal outcomes. Review their original sources before continuing.</p>'
    : '<p>Review the published contact route and continue this customer’s prepared offer.</p>')+
    '<button type="button" data-record-followup="'+esc(delivery.id)+'">Record a follow-up delivery</button>';
  if(recordedFollowupCandidates(delivery).length)out+='<button type="button" data-link-followup="'+esc(delivery.id)+'">Link an already recorded send</button>';
  return out;
}
function recordedFollowupCandidates(previous){
  const selected=state?.selected,parents=new Map((selected?.delivery_states||[]).map(row=>[row.delivery_id,row.previous_delivery_id]));
  return (selected?.deliveries||[]).filter(row=>row.id!==previous.id&&row.edition_id===previous.edition_id&&
    Date.parse(row.delivered_at)>=Date.parse(previous.delivered_at)&&!parents.get(row.id)&&!row.previous_delivery_id)
    .sort((a,b)=>Date.parse(a.delivered_at)-Date.parse(b.delivered_at)||a.id.localeCompare(b.id));
}
function updateDeliveryFollowups(preferred=''){
  const editionId=val(deliveryForm,'edition_id'),selected=preferred||val(deliveryForm,'previous_delivery_id');
  const rows=(state?.selected?.deliveries||[]).filter(row=>row.edition_id===editionId);
  field(deliveryForm,'previous_delivery_id').innerHTML=option('','First or separate delivery')+
    rows.map(row=>option(row.id,row.destination+' · '+time(row.delivered_at))).join('');
  field(deliveryForm,'previous_delivery_id').value=rows.some(row=>row.id===selected)?selected:'';
}
function invalidateDeliveryFeedback(){
  feedbackInput=null;feedbackPreview=null;
  $('delivery-feedback-preview').textContent='Review the complete current messages before saving.';updateControls();
}
function fullProviderMessages(value,label){
  const input=value?.structuredContent??value;
  const rows=(Array.isArray(input)?input:Array.isArray(input?.messages)?input.messages:[input]).map(row=>row?.structuredContent??row);
  if(!rows.length||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)||!row.id||!row.payload))
    throw new Error('Choose complete native '+label+' messages with their original MIME payloads.');
  return rows;
}
function deliveryPreviewHTML(preview){
  const feedback=preview.feedback||[],unmatched=preview.unmatched||[],review=preview.review||[];
  const result=feedback.length?'<h3>'+feedback.length+' original delivery outcome'+(feedback.length===1?'':'s')+'</h3>'+
    '<div class="table-wrap"><table><thead><tr><th>Recipient</th><th>Outcome</th><th>Saved delivery</th><th>Provider detail</th></tr></thead><tbody>'+
    feedback.map(row=>'<tr><td>'+esc(row.recipient)+'</td><td>'+esc(DELIVERY_ACTION[row.action]||row.state)+' · '+esc(row.delivery_failure_kind==='GMAIL_ATTACHMENT_POLICY'?'Attachment blocked by Gmail':row.delivery_failure_kind==='GMAIL_SENDING_LIMIT'?'Gmail sending limit':row.status)+'</td>'+
      '<td>'+esc(row.delivery_id)+'</td><td>'+esc(row.diagnostic?.value||'')+'</td></tr>').join('')+'</tbody></table></div>':
    '<p>No original prepared delivery matched this report. Open or receive its original customer record and sent delivery, then review it again.</p>';
  const details=rows=>rows.length?'<ul>'+rows.map(row=>'<li>'+esc([row.recipient||row.recipient_email||row.provider_id||'',
    row.reason||row.message||row.state||'',...(Array.isArray(row.issues)?row.issues.map(item=>item.message||item.code||String(item)):[])].filter(Boolean).join(' · '))+'</li>').join('')+'</ul>':'';
  return result+(unmatched.length?'<h3>Other reported recipients</h3>'+details(unmatched):'')+
    (review.length?'<h3>Source review</h3>'+details(review):'')+
    '<p>The complete provider messages travel with the private team working record.</p>';
}
async function reviewDeliveryFeedback(){
  if(busy||pending)throw new Error('Finish or resume the current saved request before reviewing another report.');
  if(!state?.selected)throw new Error('Open the original customer pack.');
  const mailbox=val(feedbackForm,'mailbox').toLowerCase();
  if(!mailbox||!field(feedbackForm,'mailbox').checkValidity())throw new Error('Enter the original sending mailbox.');
  const parse=(value,label)=>{try{return fullProviderMessages(JSON.parse(value),label);}
    catch(error){if(error instanceof SyntaxError)throw new Error('Paste complete '+label+' JSON.');throw error;}};
  const reports=val(feedbackForm,'reports_json')?parse(val(feedbackForm,'reports_json'),'delivery notice'):[];
  const sent=val(feedbackForm,'sent_json')?parse(val(feedbackForm,'sent_json'),'sent'):[];
  if(!reports.length)throw new Error('Choose or paste a complete delivery notice.');
  const input={pack_id:selectedId,mailbox,reports,sent_messages:sent};
  if(new Blob([JSON.stringify({input,expected_root_sha256:state.root_sha256})]).size>8*1024*1024)
    throw new Error('The complete delivery report request exceeds the 8 MiB request limit.');
  busy=true;feedbackInput=null;feedbackPreview=null;updateControls();
  try{
    const preview=await api('/api/lead-packs/delivery-feedback-preview',{input,expected_root_sha256:state.root_sha256});
    feedbackInput=input;feedbackPreview=preview;$('delivery-feedback-preview').innerHTML=deliveryPreviewHTML(preview);
  }finally{busy=false;updateControls();}
}
async function readDeliveryFeedbackFiles(name,destination,label){
  if(busy||pending)throw new Error('Finish or resume the current saved request before reading another source.');
  const files=[...field(feedbackForm,name).files];if(!files.length)return;
  busy=true;feedbackInput=null;feedbackPreview=null;updateControls();
  try{
    const messages=[];for(const file of files)messages.push(...fullProviderMessages(await fileJSON(file),label));
    field(feedbackForm,destination).value=JSON.stringify(messages,null,2);
    $('delivery-feedback-preview').textContent='Complete messages loaded. Review their original delivery before saving.';markDirty(feedbackForm);
  }finally{busy=false;updateControls();}
}

function renderEditions(){
  const selected=state.selected,editions=selected?.editions||[],deliveries=selected?.deliveries||[];
  $('editions').innerHTML=editions.length?editions.slice().reverse().map(edition=>{
    const sent=deliveries.filter(row=>row.edition_id===edition.id).sort((a,b)=>Date.parse(a.delivered_at)-Date.parse(b.delivered_at)||a.id.localeCompare(b.id)),successor=editions.find(row=>row.replaces===edition.id);
    const previous=edition.replaces?editions.find(row=>row.id===edition.replaces):null;
    const earlier=edition.withdrawn||Boolean(successor);
    const changes=edition.replacements.map(change=>({
      ...change,before:previous?.leads.find(row=>row.id===change.old_id)?.document.organization||change.old_id,
      after:edition.leads.find(row=>row.id===change.new_id)?.document.organization||change.new_id}));
    return '<article tabindex="-1" data-edition-id="'+esc(edition.id)+'" class="edition'+(edition.withdrawn?' withdrawn':'')+'"><div class="section-heading"><h3>'+esc(KIND[edition.kind])+' · '+esc(edition.leads.length)+' leads</h3>'+
      '<span class="tag">'+(edition.withdrawn?'Withdrawn':successor?'Replaced by a later edition':sent.length?'Delivery recorded':'Ready for handover')+'</span></div>'+
      '<dl><dt>Prepared</dt><dd>'+esc(time(edition.prepared_at))+'</dd>'+
      '<dt>Customer</dt><dd>'+esc(edition.brief.customer.name)+'</dd>'+
      '<dt>Price</dt><dd>'+esc(money(edition.price_minor,edition.currency))+'</dd>'+
      (previous?'<dt>Updates the pack prepared</dt><dd>'+esc(time(previous.prepared_at))+'</dd>':'')+'</dl>'+
      ((edition.included_editions||[]).length?'<details><summary>Earlier editions explicitly included in this complimentary pack</summary><ul>'+
        edition.included_editions.map(ref=>'<li><button type="button" data-open-edition="'+esc(ref.id)+'">Open '+esc(ref.id)+'</button> · '+esc(ref.sha256)+'</li>').join('')+'</ul><p>The original editions and their prices remain unchanged. This edition uses the selected current lead revisions.</p></details>':'')+
      (successor?'<p>A later replacement contains the current selection. <button type="button" data-open-edition="'+esc(successor.id)+'">Open replacement</button></p>':'')+
      '<ol>'+edition.leads.map(row=>'<li>'+esc(row.document.organization||row.id)+' · '+esc(SIGNAL[row.document.lead_kind])+
        ' · '+esc(sourceStatus(row.document))+'</li>').join('')+'</ol>'+
      (changes.length?'<details open><summary>Replacement decisions</summary><ul>'+changes.map(change=>'<li>'+esc(change.before)+' → '+esc(change.after)+': '+esc(change.reason)+'</li>').join('')+'</ul></details>':'')+
      '<p class="muted">'+(earlier?'These downloads reopen this earlier saved selection.':'Download the complete customer ZIP, then share that file through the customer’s existing conversation.')+'</p>'+
      '<div class="actions"><a download data-customer-download href="'+esc(exportURL('zip',edition.id))+'">'+(earlier?'Download earlier customer ZIP':'Download customer ZIP')+'</a>'+
      '<a download data-customer-download href="'+esc(exportURL('html',edition.id))+'">HTML / print</a>'+
      '<a href="/lead-documents?'+esc(new URLSearchParams({pack_id:selectedId,edition_id:edition.id}))+'">Customer PDF</a>'+
      '<a download data-customer-download href="'+esc(exportURL('csv',edition.id))+'">CSV</a><a download data-customer-download href="'+esc(exportURL('json',edition.id))+'">JSON</a>'+
      (!edition.withdrawn&&edition.kind==='paid'?'<a target="_blank" rel="noopener" href="'+esc(productionURL(selectedId,edition.id))+'">Plan this paid edition</a>':'')+
      (!edition.withdrawn?'<button type="button" data-record-delivery="'+esc(edition.id)+'">Record delivery</button>':'')+
      (!edition.withdrawn&&edition.kind!=='sample'&&!successor?'<button type="button" data-prepare-replacement="'+esc(edition.id)+'">Replace leads</button>':'')+
      (!edition.withdrawn&&!sent.length&&!successor?'<button type="button" data-withdraw="'+esc(edition.id)+'">Withdraw</button>':'')+'</div>'+commercialCard(edition)+
      (sent.length?'<details open><summary>Recorded deliveries</summary>'+sent.map(row=>'<dl><dt>Sent or shared</dt><dd>'+esc(time(row.delivered_at))+'</dd>'+
        '<dt>Channel / destination</dt><dd>'+esc(row.channel)+' · '+esc(row.destination)+'</dd><dt>Provider reference</dt><dd>'+esc(row.provider_id)+'</dd>'+
        (row.customer_package_id?'<dt>Complete customer package</dt><dd>'+esc(state.selected.customer_files?.packages.find(packet=>packet.id===row.customer_package_id)?.title||row.customer_package_id)+'</dd>':'')+
        (row.receipt_url?'<dt>Delivery source</dt><dd>'+sourceLink(row.receipt_url,'Open delivery')+'</dd>':'')+
        (row.note?'<dt>Team note</dt><dd>'+esc(row.note)+'</dd>':'')+'</dl>'+
        deliveryFeedbackHTML(row)+caseDeliverySummary(edition.id,row.id)
        ).join('')+'</details>':'')+
      '<details><summary>Edition reference details</summary><dl><dt>Saved edition</dt><dd>'+esc(edition.id)+'</dd>'+
      '<dt>Brief revision</dt><dd>'+esc(edition.brief_revision)+'</dd><dt>Content identity</dt><dd>'+esc(edition.sha256)+'</dd></dl></details></article>';
  }).join(''):'<p class="empty">Select complete leads above to prepare a free sample, paid pack or complimentary full pack.</p>';
  const active=editions.filter(row=>!row.withdrawn),replaceable=latestPaid(),withdrawable=active.filter(row=>!deliveries.some(v=>v.edition_id===row.id)&&!editions.some(v=>v.replaces===row.id));
  field(deliveryForm,'edition_id').innerHTML=option('','Choose the delivered edition')+active.map(row=>option(row.id,editionLabel(row))).join('');
  field(withdrawForm,'edition_id').innerHTML=option('','Choose a prepared edition')+withdrawable.map(row=>option(row.id,editionLabel(row))).join('');
  field(replacementForm,'replaces').innerHTML=option('','Choose the paid or complimentary pack to update')+replaceable.map(row=>option(row.id,editionLabel(row))).join('');
  $('replacement-panel').hidden=!replaceable.length;$('delivery-panel').hidden=!active.length;$('withdraw-panel').hidden=!withdrawable.length;
  replacementRows=[];renderReplacementRows();deliveryForm.reset();withdrawForm.reset();updateDeliveryFollowups();updateDeliveryCommerce();
  $('delivery-feedback-panel').hidden=!deliveries.length;updateControls();
}
function renderReplacementRows(){
  const base=state?.selected?.editions.find(row=>row.id===val(replacementForm,'replaces'));
  const available=(state?.selected?.leads||[]).filter(row=>row.quality.ready&&!row.used);
  $('replacement-rows').innerHTML=replacementRows.map((change,index)=>'<div class="replacement-row" data-replacement-row="'+index+'"><div class="grid">'+
    '<label>Original lead<select data-old-id required>'+option('','Choose original lead')+(base?.leads||[]).map(row=>option(row.id,row.document.organization||row.id)).join('')+'</select></label>'+
    '<label>Replacement lead<select data-new-id required>'+option('','Choose additional lead')+available.map(row=>option(row.id,row.document.organization||row.id)).join('')+'</select></label></div>'+
    '<label>Reason<textarea data-replacement-reason rows="2" maxlength="4000" required>'+esc(change.reason||'')+'</textarea></label>'+
    '<button type="button" data-remove-replacement="'+index+'">Remove this change</button></div>').join('');
  for(const [index,change]of replacementRows.entries()){
    const row=$('replacement-rows').querySelector('[data-replacement-row="'+index+'"]');
    row.querySelector('[data-old-id]').value=change.old_id||'';row.querySelector('[data-new-id]').value=change.new_id||'';
  }
  replacementPreview();updateControls();
}
function readReplacementRows(){
  replacementRows=[...$('replacement-rows').querySelectorAll('[data-replacement-row]')].map(row=>({
    old_id:row.querySelector('[data-old-id]').value,new_id:row.querySelector('[data-new-id]').value,reason:row.querySelector('[data-replacement-reason]').value.trim()}));
}
function replacementPreview(){
  const base=state?.selected?.editions.find(row=>row.id===val(replacementForm,'replaces'));
  if(!base){$('replacement-preview').textContent='';return;}
  const oldIds=new Set(replacementRows.map(row=>row.old_id).filter(Boolean));
  const retained=base.leads.filter(row=>!oldIds.has(row.id));
  $('replacement-preview').textContent=retained.length+' leads remain from the original edition: '+retained.map(row=>row.document.organization||row.id).join(', ')+'.';
}
function resetDetail(){
  for(const id of ['case-link-panel','brief-panel','leads-panel','lead-editor','editions-panel','replacement-panel','delivery-panel','delivery-feedback-panel','delivery-followup-panel','withdraw-panel','commerce-panel','case-delivery-panel'])$(id).hidden=true;
  caseLinkOptions=null;caseLinkPreview=null;caseLinkForm.reset();caseLinkForm.hidden=true;$('case-link-review').textContent='';
  feedbackInput=null;feedbackPreview=null;feedbackForm.reset();followupForm.reset();$('delivery-feedback-preview').textContent='Choose the complete messages to review their saved delivery.';
  selectedLeads.clear();includedEditions.clear();leadId='';importedRows=null;replacementRows=[];commerceCase=null;importForm.reset();$('import-preview').textContent='';
}
function renderSelected(){
  resetDetail();
  if(state.selected){
    selectedId=state.selected.pack.id;renderBrief(state.selected.pack);renderCaseLink();
    $('leads-panel').hidden=false;$('editions-panel').hidden=false;renderLeads();renderEditions();
  }else selectedId='';
  receiveForm.reset();receivedBundle=null;$('receive-preview').textContent='';
  dirty.clear();customerRequestsUI.render(state.selected);customerFilesUI.render(state.selected);procurementUI.render(state.selected);packageContactUI?.render(state.selected);creatorProgrammeUI.render(state.selected);reconciliation?.render();dirtyLabel();updateControls();
}
async function loadState(packId='',options={}){
  const previous=state,initial=!previous,generation=++reviewGeneration,editEpoch=reviewEditEpoch;
  let context=options.review||(!initial?reviewSnapshot():null);
  reviewLoading=true;updateControls();
  try{
    const data=await api('/api/lead-packs/state'+(packId?'?'+new URLSearchParams({pack_id:packId}):''));
    if(generation!==reviewGeneration)return null;
    if(reviewEditEpoch!==editEpoch)throw new Error('Your form changed while this customer was opening. The current draft is still open.');
    if(!data||!Array.isArray(data.packs)||typeof data.root_sha256!=='string'||typeof data.workspace_identity!=='string')
      throw new Error('The complete lead workspace could not be opened.');
    if(initial&&!context)context=normalizedReview(history.state?.lead_review?.context)||retainedReview(data.workspace_identity);
    if(context?.workspace_identity!==data.workspace_identity)context=null;
    if(initial&&!packId&&context?.pack_id&&data.packs.some(row=>row.id===context.pack_id)&&data.selected?.pack.id!==context.pack_id)
      return await loadState(context.pack_id,{...options,review:context,position:true});
    state=data;selectedId=data.selected?.pack.id||'';reviewEdition='';
    pendingKey='dealscout.lead-fulfillment.pending.v1:'+encodeURIComponent(data.workspace_identity);
    try{pending=readPending();}catch(error){message(error.message,true);throw error;}
    if(context?.pack_id!==selectedId){$('lead-search').value='';$('lead-filter').value='all';}
    restoreReviewControls(context);
    renderPacks();renderSelected();pendingView();
    restoreCustomerReview(context,generation,{position:options.position||initial});
    rememberReview(options.history==='push'?'push':'replace');
    return data;
  }catch(error){if(generation!==reviewGeneration)return null;throw error;}
  finally{if(generation===reviewGeneration){reviewLoading=false;updateControls();}}
}

function renderCaseLink(){
  $('case-link-panel').hidden=false;
  const linked=state.selected.pack.document.customer.case_id;
  $('case-link-open').hidden=!/^[a-z0-9][a-z0-9-]{2,95}$/.test(linked||'');
  if(!$('case-link-open').hidden)$('case-link-open').href='/case?'+new URLSearchParams({case_id:linked});
  $('case-link-status').textContent=linked?'The saved pack retains its company case reference.':'Prepare the company case from this saved research.';
}
function invalidateCaseLink(){
  caseLinkPreview=null;$('case-link-review').textContent='';updateControls();
}
function caseLinkInput(){
  return {pack_id:selectedId,case_id:val(caseLinkForm,'case_id'),
    company_url:val(caseLinkForm,'company_url'),source_url:val(caseLinkForm,'source_url'),
    source_observed_at:iso(val(caseLinkForm,'source_observed_at')),
    existing_owner:val(caseLinkForm,'existing_owner'),service_name:val(caseLinkForm,'service_name'),
    service_url:val(caseLinkForm,'service_url')};
}
function chooseCaseLink(){
  const chosen=caseLinkOptions?.cases.find(row=>row.case_id===val(caseLinkForm,'case_id'));
  if(chosen){
    setFields(caseLinkForm,{company_url:chosen.buyer_url,existing_owner:chosen.existing_owner,
      service_name:chosen.partner,service_url:chosen.partner_url});
    for(const name of ['existing_owner','service_name','service_url'])field(caseLinkForm,name).readOnly=true;
  }else{
    for(const name of ['existing_owner','service_name','service_url'])field(caseLinkForm,name).readOnly=false;
  }
  invalidateCaseLink();
}
async function openCaseLink(){
  if(!state?.selected||busy||pending)throw new Error('Open the saved lead pack and finish its current save first.');
  if([...dirty].some(id=>id!=='case-link-form'))throw new Error('Save or close the other edited form before preparing the sales case.');
  const packId=selectedId;
  busy=true;updateControls();
  try{
    const result=await api('/api/lead-packs/case-options?'+new URLSearchParams({pack_id:packId}));
    if(selectedId!==packId)return;
    if(result.root_sha256!==state.root_sha256)throw new Error('The saved pack changed. Refresh it before preparing the sales case.');
    caseLinkOptions=result;caseLinkPreview=null;
    const customer=state.selected.pack.document.customer;
    field(caseLinkForm,'case_id').innerHTML=option('','Find the original case or prepare a new one')+
      result.cases.map(row=>option(row.case_id,row.buyer+' · '+row.partner+' · '+row.existing_owner)).join('');
    const linked=result.cases.find(row=>row.case_id===result.selected_case_id)?.case_id||
      result.cases.find(row=>row.case_id===(customer.case_id||'').toLowerCase())?.case_id||'';
    setFields(caseLinkForm,{case_id:linked,company_url:customer.company_domain?'https://'+customer.company_domain:'',
      source_url:customer.company_domain?'https://'+customer.company_domain:'',source_observed_at:'',
      existing_owner:'',service_name:'TokenJunkieLabs',service_url:''});
    chooseCaseLink();caseLinkForm.hidden=false;$('case-link-review').textContent='';
    $('case-link-status').textContent='Review the company source and prepared work, then save the case.';
    caseLinkForm.scrollIntoView({block:'start'});field(caseLinkForm,'company_url').focus();
  }finally{busy=false;updateControls();}
}
function caseLinkReviewHTML(preview){
  return '<h3>'+esc(preview.added?'New company case':'Existing company case')+'</h3><p><strong>'+esc(preview.buyer)+
    '</strong> · '+esc(preview.partner)+'</p><p>Responsible: '+esc(preview.existing_owner)+'</p><ul>'+
    preview.work_items.map(row=>'<li>'+esc(row.title)+' · '+esc(row.status.toLowerCase().replaceAll('_',' '))+'</li>').join('')+
    '</ul>'+(preview.additional_editions?'<p>Open the complete lead pack for '+preview.additional_editions+' additional customer selections.</p>':'')+
    '<p>The case and lead pack will be saved together.</p>';
}
async function reviewCaseLink(){
  if(!caseLinkForm.reportValidity())return;
  if(busy||pending)throw new Error('Finish the retained save first.');
  if([...dirty].some(id=>id!=='case-link-form'))throw new Error('Save or close the other edited form before reviewing this case.');
  busy=true;updateControls();
  try{
    const preview=await api('/api/lead-packs/case-preview',{input:caseLinkInput(),expected_root_sha256:state.root_sha256});
    caseLinkPreview=preview;$('case-link-review').innerHTML=caseLinkReviewHTML(preview);
    $('case-link-status').textContent=preview.added?'The new company case is ready to save.':'The prepared work is ready to join the original case.';
  }finally{busy=false;updateControls();}
}
async function saveCaseLink(){
  if(!caseLinkPreview)throw new Error('Review the case and its prepared work first.');
  if(busy||pending)throw new Error('Finish the retained save first.');
  if([...dirty].some(id=>id!=='case-link-form'))throw new Error('Save or close the other edited form first.');
  const preview=caseLinkPreview;
  stashPending({operation_id:uuid('lead-case'),kind:'case-handoff',
    input:{...preview.request_input,expected_case_sha256:preview.expected_case_sha256,preview_sha256:preview.preview_sha256},
    expected_root_sha256:preview.expected_root_sha256,expected_workspace_revision:preview.expected_workspace_revision});
  await performPending();
}

function packInput(){
  const currency=val(packForm,'currency').toUpperCase(),freeCount=enteredSampleQuantity();
  return {id:val(packForm,'id'),customer:{name:val(packForm,'customer_name'),company_domain:val(packForm,'company_domain'),
    contact_url:val(packForm,'contact_url'),case_id:val(packForm,'case_id'),prospect_id:val(packForm,'prospect_id')},
    brief:{title:val(packForm,'title'),description:val(packForm,'description'),geography:val(packForm,'geography'),
      skills:list(val(packForm,'skills')),lead_kind:val(packForm,'lead_kind'),quantity:Number(val(packForm,'quantity')),currency,
      ...(freeCount===undefined?{}:{sample_quantity:freeCount}),
      price_minor:priceMinor(val(packForm,'price'),currency),max_age_days:Number(val(packForm,'max_age_days')),
      excluded_domains:list(val(packForm,'excluded_domains')),excluded_sources:list(val(packForm,'excluded_sources')),
      exclusions:val(packForm,'exclusions')},operator_note:val(packForm,'operator_note')};
}
function sourceCheckedInput(){
  const element=field(leadForm,'checked_at');
  return val(leadForm,'checked_at')===element.dataset.local?element.dataset.original:
    field(leadForm,'checked_date_only').checked?val(leadForm,'checked_at'):iso(val(leadForm,'checked_at'));
}
function leadInput(){
  const d={};
  for(const name of ['organization','person','company_domain','company_url','buyer_key','source_url','published_on','author_updated_on',
    'lead_kind','demand','fit','source_status','deadline_on','status_note','contact_url','contact_instructions','geography','budget','opening_message','operator_note'])d[name]=val(leadForm,name);
  for(const name of ['checked_at','deadline_at']){const element=field(leadForm,name);d[name]=val(leadForm,name)===element.dataset.local?element.dataset.original:
    name==='checked_at'&&field(leadForm,'checked_date_only').checked?val(leadForm,name):iso(val(leadForm,name));}
  d.tags=list(val(leadForm,'tags'));
  const publication=val(leadForm,'observed_publication_label'),closing=val(leadForm,'observed_closing_label'),
    source=val(leadForm,'observed_source_url'),checked=val(leadForm,'observed_checked_at');
  if(publication||closing||source||checked)d.source_time_observation={
    source_url:source,checked_at:checked,closing_label:closing,
    ...(publication||field(leadForm,'observed_publication_label').dataset.present==='true'?{publication_label:publication}:{})
  };
  return {id:val(leadForm,'id'),document:d};
}
async function fileText(file){
  if(!file)throw new Error('Choose the complete source file or its gzip copy.');
  const limit=8*1024*1024;
  if(file.size>limit)throw new Error('This file exceeds the 8 MiB import limit. Use the full workspace transfer for a larger team record.');
  let bytes=new Uint8Array(await file.arrayBuffer());
  if(bytes[0]===0x1f&&bytes[1]===0x8b){
    if(typeof DecompressionStream!=='function')throw new Error('This browser cannot unpack gzip files. Unpack the JSON file first, or use the command-line receiver.');
    let reader;
    try{
      reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
      const chunks=[];let size=0;
      for(;;){
        const part=await reader.read();if(part.done)break;
        size+=part.value.byteLength;
        if(size>limit){
          await reader.cancel();
          throw Object.assign(new Error('The unpacked JSON exceeds the 8 MiB import limit.'),{code:'LEAD_JSON_LIMIT'});
        }
        chunks.push(part.value);
      }
      bytes=new Uint8Array(size);let offset=0;
      for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    }catch(error){
      if(error.code==='LEAD_JSON_LIMIT')throw error;
      throw new Error('Choose the complete gzip file containing the original JSON.');
    }finally{if(reader)reader.releaseLock();}
  }
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{throw new Error('Choose a complete UTF-8 file, or its gzip copy.');}
}
async function fileJSON(file){
  const text=await fileText(file);
  try{return JSON.parse(text);}catch{throw new Error('Choose a complete JSON file, or its gzip copy.');}
}
function previewImport(){
  importedRows=null;updateControls();
  let parsed;try{parsed=JSON.parse(val(importForm,'json'));}catch{throw new Error('Paste a complete JSON array or an object with a leads array.');}
  const rows=Array.isArray(parsed)?parsed:parsed.leads;
  if(!Array.isArray(rows)||!rows.length||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error('The import needs a nonempty list of complete lead objects.');
  const existing=new Set(state.selected.leads.map(row=>row.id));
  const proposed=rows.map(row=>({id:row.id||uuid('lead'),document:row.document||Object.fromEntries(Object.entries(row).filter(([key])=>key!=='id'))}));
  if(new Set(proposed.map(row=>row.id)).size!==proposed.length)throw new Error('Use each lead ID once in this import.');
  importedRows=proposed;
  field(importForm,'json').value=JSON.stringify(importedRows,null,2);
  const updateCount=importedRows.filter(row=>existing.has(row.id)).length;
  $('import-preview').innerHTML='<p>'+esc(importedRows.length)+' complete lead records: '+esc(updateCount)+' existing revisions and '+esc(importedRows.length-updateCount)+' new records.</p>'+
    '<ol>'+importedRows.map(row=>'<li>'+esc(row.document.organization||row.id)+' · '+esc(row.document.source_url||'Original request not entered')+'</li>').join('')+'</ol>';
  updateControls();
}
function run(handler){return async event=>{try{await handler(event);}catch(error){message(error.message,true);}};}
for(const form of MUTATION_FORMS)form.addEventListener('input',()=>markDirty(form));
$('case-link-start').addEventListener('click',run(openCaseLink));
$('case-link-preview').addEventListener('click',run(reviewCaseLink));
caseLinkForm.addEventListener('input',invalidateCaseLink);
field(caseLinkForm,'case_id').addEventListener('change',chooseCaseLink);
caseLinkForm.addEventListener('submit',run(async event=>{event.preventDefault();await saveCaseLink();}));
$('case-link-cancel').addEventListener('click',run(()=>{
  if(dirty.has(caseLinkForm.id)&&!window.confirm('Discard the unsaved sales-case form changes?'))return;
  dirty.delete(caseLinkForm.id);caseLinkForm.hidden=true;caseLinkPreview=null;dirtyLabel();updateControls();
}));
window.addEventListener('beforeunload',event=>{if(dirty.size){event.preventDefault();event.returnValue='';}});
window.addEventListener('storage',event=>{
  if(event.key===pendingKey&&state){try{pending=readPending();pendingView();if(pending)message('Another tab has a saved request in this workspace. Resume it before a new save.');}catch(error){message(error.message,true);}}
});
$('pack-search').addEventListener('input',reviewChanged);
$('pack-filter').addEventListener('change',reviewChanged);
$('pack-sort').addEventListener('change',reviewChanged);
for(const [id,step]of [['pack-previous-page',-1],['pack-next-page',1]])$(id).addEventListener('click',()=>{if(!state||reviewLoading)return;reviewOffset=Math.max(0,reviewOffset+step*REVIEW_PAGE_SIZE);renderPacks();rememberReview();$('packs-title').scrollIntoView({block:'start'});});
for(const [id,step]of [['review-previous-customer',-1],['review-next-customer',1]])$(id).addEventListener('click',run(async()=>{const rows=matchingCustomerPacks(),at=rows.findIndex(row=>row.id===selectedId),row=rows[at+step];if(at>=0&&row)await openReviewedCustomer(row.id);}));
$('review-results').addEventListener('click',()=>{if(state){$('packs-title').scrollIntoView({block:'start'});rememberReview();}});
$('lead-search').addEventListener('input',()=>{if(state){renderLeads();rememberReview();}});
$('lead-filter').addEventListener('change',()=>{if(state){renderLeads();rememberReview();}});
for(const name of ['currency','quantity','price','sample_quantity'])field(packForm,name).addEventListener('input',updateOffer);
$('refresh').addEventListener('click',run(async()=>{if(allowNavigate()){await loadState(selectedId);message('Current workspace opened.');}}));
$('new-pack').addEventListener('click',run(()=>{if(!state)throw new Error('Open the workspace first.');if(!allowNavigate())return;
  resetDetail();renderBrief();$('brief-panel').scrollIntoView({block:'start'});field(packForm,'customer_name').focus();updateControls();}));
$('close-brief').addEventListener('click',run(()=>{if(allowNavigate()){$('brief-panel').hidden=true;}}));
$('new-lead').addEventListener('click',run(()=>{if(!allowNavigate())return;renderLeadEditor();$('lead-editor').scrollIntoView({block:'start'});field(leadForm,'organization').focus();}));
$('close-lead').addEventListener('click',run(()=>{if(allowNavigate()){$('lead-editor').hidden=true;leadId='';rememberReview();}}));
field(leadForm,'checked_date_only').addEventListener('change',()=>{
  const element=field(leadForm,'checked_at'),old=element.value,dateOnly=field(leadForm,'checked_date_only').checked;
  element.type=dateOnly?'date':'datetime-local';element.step=dateOnly?'1':'0.001';
  element.value=dateOnly?old.slice(0,10):'';
  markDirty(leadForm);
});
$('checked-now').addEventListener('click',()=>{
  field(leadForm,'checked_date_only').checked=false;field(leadForm,'checked_at').type='datetime-local';field(leadForm,'checked_at').step='0.001';
  field(leadForm,'checked_at').value=localTime(new Date().toISOString());markDirty(leadForm);
});
$('bind-source-time').addEventListener('click',run(async()=>{
  const source=val(leadForm,'source_url'),checked=sourceCheckedInput(),closing=val(leadForm,'observed_closing_label'),
    publication=val(leadForm,'observed_publication_label');
  if(!source||!checked||!(publication||closing))throw new Error('Enter the original source URL, actual source-check time and a complete publication or closing label first.');
  field(leadForm,'observed_source_url').value=source;
  field(leadForm,'observed_checked_at').value=checked;markDirty(leadForm);
}));
$('clear-source-time').addEventListener('click',()=>{
  for(const name of ['observed_publication_label','observed_closing_label','observed_source_url','observed_checked_at'])field(leadForm,name).value='';
  field(leadForm,'observed_publication_label').dataset.present='false';markDirty(leadForm);
});
packForm.addEventListener('submit',run(async event=>{event.preventDefault();await mutate('pack-save',packInput(),'brief-form');}));
leadForm.addEventListener('submit',run(async event=>{event.preventDefault();await mutate('leads-save',{pack_id:selectedId,leads:[leadInput()]},'lead-form');}));
$('leads').addEventListener('change',event=>{const box=event.target.closest('[data-select-lead]');if(!box)return;
  const row=state?.selected?.leads.find(row=>row.id===box.value);
  if(inclusionLeadIds().has(box.value)||!leadSelectable(row)){renderLeads();return;}
  box.checked?selectedLeads.add(box.value):selectedLeads.delete(box.value);selectionSummary();updateControls();rememberReview();});
$('complimentary-inclusion-list').addEventListener('change',event=>{
  const box=event.target.closest('[data-include-edition]');if(!box)return;
  if(busy||reviewLoading||pending){renderLeads();return;}
  const edition=state?.selected?.editions.find(row=>row.id===box.value&&!row.withdrawn);if(!edition)return;
  const previous=inclusionLeadIds();
  if(box.checked)includedEditions.set(edition.id,edition.sha256);else includedEditions.delete(edition.id);
  const next=inclusionLeadIds();for(const id of previous)if(!next.has(id))selectedLeads.delete(id);
  for(const id of next)selectedLeads.add(id);
  renderLeads();rememberReview();
});
$('clear-selection').addEventListener('click',()=>{selectedLeads.clear();includedEditions.clear();renderLeads();rememberReview();});
for(const [button,kind]of [['prepare-sample','sample'],['prepare-paid','paid'],['prepare-complimentary','complimentary']])$(button).addEventListener('click',run(async()=>{
  if(dirty.size)throw new Error('Save the edited brief or lead records before preparing a customer edition.');
  if(!editionSelection().valid)throw new Error('Complete every selected lead and include each edition that already uses its identity.');
  if(kind!=='complimentary'&&includedEditions.size)throw new Error('Earlier editions can only be included in a complimentary full pack.');
  const brief=state?.selected?.pack.document.brief,expected=kind==='sample'?sampleQuantity(brief):brief?.quantity;
  if(selectedLeads.size!==expected)throw new Error('Select exactly '+leadCountLabel(expected)+' for this '+(kind==='sample'?'free sample':'full pack')+'.');
  await mutate('edition-prepare',{id:uuid('edition'),pack_id:selectedId,kind,lead_ids:[...selectedLeads],
    ...(kind==='complimentary'&&includedEditions.size?{include_edition_ids:[...includedEditions.keys()]}:{})});
}));
field(importForm,'file').addEventListener('change',run(async()=>{
  if(busy||pending)throw new Error('Finish or recover the current saved request before reading another file.');
  busy=true;importedRows=null;$('import-preview').textContent='Reading the complete source file…';updateControls();
  try{
    const data=await fileJSON(field(importForm,'file').files[0]);field(importForm,'json').value=JSON.stringify(data,null,2);
    previewImport();markDirty(importForm);
  }catch(error){$('import-preview').textContent=error.message;throw error;}
  finally{busy=false;updateControls();}
}));
field(importForm,'json').addEventListener('input',()=>{importedRows=null;$('import-preview').textContent='Review the complete edited import before saving.';updateControls();});
$('preview-import').addEventListener('click',run(previewImport));
importForm.addEventListener('submit',run(async event=>{event.preventDefault();if(!importedRows)throw new Error('Review the import first.');
  await mutate('leads-save',{pack_id:selectedId,leads:importedRows},'import-form');}));
function workspaceBundle(bundle){
  return bundle?.version==='dealscout.lead-workspace-record.v1'||
    bundle&&Object.keys(bundle).length===1&&bundle.lead_fulfillment?.version==='dealscout.lead-fulfillment.v1';
}
function receiveFilesHTML(){
  if(!receivedFiles.length)return '';
  return '<details open><summary>Files from this document ('+esc(receivedFiles.length)+')</summary><div class="table-wrap"><table><thead><tr>'+
    '<th>Original file</th><th>Size</th><th>Download</th></tr></thead><tbody>'+receivedFiles.map((file,index)=>'<tr><td>'+esc(file.path)+
      '</td><td>'+esc(new Intl.NumberFormat().format(file.bytes))+' bytes</td><td><button type="button" data-receive-file="'+index+
      '" aria-label="Download '+esc(file.path)+'">Download</button></td></tr>').join('')+'</tbody></table></div></details>';
}
async function previewReceive(){
  if(busy||pending)throw new Error('Finish or recover the current saved request before reviewing a team copy.');
  receivedBundle=null;receivedFiles=[];reconciliation?.clear();busy=true;$('receive-preview').textContent='Reading the complete source and its files…';updateControls();
  try{
    const {decodeLeadSource}=await import('/lead_fulfillment_carrier.mjs');
    const decoded=await decodeLeadSource(val(receiveForm,'json'),{recordPath:val(receiveForm,'record_path'),requireRecord:false});
    receivedFiles=decoded.files;
    const bundle=decoded.bundle;
    if(!bundle){
      $('receive-preview').innerHTML='<p>The complete customer files are ready to download. Choose their working record to receive customer history.</p>'+receiveFilesHTML();
      return;
    }
    const whole=workspaceBundle(bundle),source=whole?(bundle.workspace||bundle.lead_fulfillment):bundle;
    if(!source||!Array.isArray(source.leads)||!Array.isArray(source.editions)||!Array.isArray(source.deliveries)||!Array.isArray(source.withdrawals)||
      (whole?(!Array.isArray(source.packs)||!Array.isArray(source.operations)):
        (!['dealscout.lead-working-record.v1','dealscout.lead-working-record.v2','dealscout.lead-working-record.v3'].includes(bundle?.version)||
          !bundle.pack?.document?.customer||!bundle.pack?.document?.brief||typeof bundle.sha256!=='string')))
      throw new Error('Choose the complete customer or workspace record exported from Lead fulfillment.');
    $('receive-preview').textContent=whole?'Reading every customer and saved operation…':'Reading the saved customer history…';
    const report=await api('/api/lead-packs/receive-preview',{bundle,expected_root_sha256:state.root_sha256});
    const label={briefs:'customer brief',leads:'lead',editions:'prepared edition',deliveries:'delivery',withdrawals:'withdrawal',
      commercial_links:'commercial scope link',commercial_deliveries:'case delivery link',operations:'saved operation',
      delivery_feedback:'delivery report',delivery_feedback_sources:'original mail source',delivery_followups:'delivery connection',
      workspace_fields:'workspace extension',capture_plans:'capture plan',capture_results:'capture result',capture_reviews:'capture review'};
    const action={add:'Add',advance:'Advance matching history',keep_current:'Keep newer local revision',unchanged:'Already present'};
    const added=Object.entries(report.added).filter(([,count])=>count).map(([kind,count])=>count+' '+(label[kind]||kind)+(count===1?'':'s')).join(', ');
    const advanced=report.advanced.briefs+report.advanced.leads;
    const overview=report.packs?'<div class="table-wrap"><table><caption>Customer receiving summary</caption><thead><tr><th>Customer</th><th>New records</th><th>Matching revisions</th><th>Result</th></tr></thead><tbody>'+
      report.packs.map(row=>'<tr><td><strong>'+esc(row.customer)+'</strong>'+esc(row.title)+'<small>'+esc(row.pack_id)+'</small></td><td>'+
        esc(Object.values(row.added).reduce((sum,n)=>sum+n,0))+'</td><td>'+esc(row.advanced.briefs+row.advanced.leads)+'</td><td>'+
        (row.can_receive?(row.changed?'Ready to receive':'Already present'):'Review conflicting records')+'</td></tr>').join('')+'</tbody></table></div>':'';
    $('receive-preview').innerHTML='<p><strong>'+esc(report.customer)+'</strong> · '+esc(report.title)+'</p>'+
      '<p>'+(added?'Add '+esc(added)+'. ':'')+(advanced?'Advance '+esc(advanced)+' matching revision'+(advanced===1?'':'s')+'. ':'')+
      (report.kept_current?'Keep '+esc(report.kept_current)+' newer local revision'+(report.kept_current===1?'':'s')+'. ':'')+
      (report.local_records_preserved?'Retain '+esc(report.local_records_preserved)+' additional local lead'+(report.local_records_preserved===1?'':'s')+'. ':'')+
      (report.local_packs_preserved?'Retain '+esc(report.local_packs_preserved)+' additional local customer brief'+(report.local_packs_preserved===1?'':'s')+'. ':'')+
      (!report.changed&&!report.conflicts.length?'This copy adds no records or revisions.':'')+'</p>'+overview+
      (report.conflicts.length?'<h3>Conflicting work to reconcile</h3><ul>'+report.conflicts.map(row=>'<li><strong>'+
        (row.customer?esc(row.customer)+' · ':'')+esc(label[row.entity]||row.entity)+' '+esc(row.id)+'</strong>: '+esc(row.reason)+
        (row.local_revision?' Local revision '+esc(row.local_revision)+'; incoming '+esc(row.incoming_revision)+'.':'')+
        (row.other_id?' Related record '+esc(row.other_id)+'.':'')+'</li>').join('')+'</ul>':'')+
      '<details><summary>Complete receiving changes ('+esc(report.records.length)+')</summary><div class="table-wrap"><table><thead><tr>'+
      (whole?'<th>Customer</th>':'')+'<th>Record</th><th>Action</th><th>Revision</th></tr></thead><tbody>'+
      report.records.map(row=>'<tr>'+(whole?'<td>'+esc(row.customer||'Workspace')+'</td>':'')+
        '<td>'+esc(label[row.entity]||row.entity)+' · '+esc(row.name)+'<small>'+esc(row.id)+'</small></td><td>'+
        esc(action[row.action]||row.action)+'</td><td>'+esc(row.revision||'—')+'</td></tr>').join('')+'</tbody></table></div></details>';
    $('receive-preview').insertAdjacentHTML('beforeend',receiveFilesHTML());
    if(report.can_receive)receivedBundle=bundle;
    reconciliation?.offer(bundle,report);
    $('receive-button').textContent=whole?'Receive complete workspace':'Receive customer record';
  }catch(error){
    $('receive-preview').textContent=error.ambiguous?'Review the same complete record again to refresh its proposed changes.':error.message;
    throw error;
  }finally{busy=false;updateControls();}
}
field(receiveForm,'file').addEventListener('change',run(async()=>{
  if(busy||pending)throw new Error('Finish or recover the current saved request before reading another file.');
  busy=true;receivedBundle=null;$('receive-preview').textContent='Reading the complete source file…';updateControls();
  try{
    field(receiveForm,'json').value=await fileText(field(receiveForm,'file').files[0]);
    busy=false;await previewReceive();markDirty(receiveForm);
  }catch(error){$('receive-preview').textContent=error.message;throw error;}
  finally{busy=false;updateControls();}
}));
function invalidateReceive(){receivedBundle=null;receivedFiles=[];reconciliation?.clear();$('receive-preview').textContent='Review the complete source before receiving its records or files.';updateControls();}
field(receiveForm,'json').addEventListener('input',invalidateReceive);
field(receiveForm,'record_path').addEventListener('input',invalidateReceive);
$('receive-preview').addEventListener('click',event=>{
  const button=event.target.closest('[data-receive-file]');
  if(!button||busy||pending)return;
  const file=receivedFiles[Number(button.dataset.receiveFile)];if(!file)return;
  const ext=file.path.split('.').pop().toLowerCase(),type={html:'text/html',csv:'text/csv',json:'application/json',zip:'application/zip',md:'text/markdown',txt:'text/plain'}[ext]||'application/octet-stream';
  download(file.path.split('/').pop(),file.content,type);
});
$('preview-receive').addEventListener('click',run(previewReceive));
receiveForm.addEventListener('submit',run(async event=>{event.preventDefault();if(!receivedBundle)throw new Error('Choose the complete working record.');
  await mutate(workspaceBundle(receivedBundle)?'workspace-record-receive':'working-record-receive',{bundle:receivedBundle},'receive-form');}));
field(replacementForm,'replaces').addEventListener('change',()=>{replacementRows=val(replacementForm,'replaces')?[{old_id:'',new_id:'',reason:''}]:[];renderReplacementRows();markDirty(replacementForm);});
$('add-replacement').addEventListener('click',()=>{readReplacementRows();replacementRows.push({old_id:'',new_id:'',reason:''});renderReplacementRows();markDirty(replacementForm);});
$('replacement-rows').addEventListener('input',()=>{readReplacementRows();replacementPreview();});
replacementForm.addEventListener('submit',run(async event=>{event.preventDefault();readReplacementRows();
  if(!replacementRows.length||replacementRows.some(row=>!row.old_id||!row.new_id||!row.reason))throw new Error('Choose each original lead, replacement, and reason.');
  if(new Set(replacementRows.map(row=>row.old_id)).size!==replacementRows.length||new Set(replacementRows.map(row=>row.new_id)).size!==replacementRows.length)
    throw new Error('Choose each original lead and each replacement once.');
  await mutate('edition-prepare',{id:uuid('edition'),pack_id:selectedId,kind:'replacement',replaces:val(replacementForm,'replaces'),replacements:replacementRows},'replacement-form');
}));
deliveryForm.addEventListener('submit',run(async event=>{event.preventDefault();
  await mutate('delivery-record',{id:uuid('delivery'),edition_id:val(deliveryForm,'edition_id'),delivered_at:iso(val(deliveryForm,'delivered_at')),
    channel:val(deliveryForm,'channel'),destination:val(deliveryForm,'destination'),provider_id:val(deliveryForm,'provider_id'),
    receipt_url:val(deliveryForm,'receipt_url'),note:val(deliveryForm,'note'),
    ...(val(deliveryForm,'previous_delivery_id')?{previous_delivery_id:val(deliveryForm,'previous_delivery_id')}:{}),
    ...(val(deliveryForm,'customer_package_id')?{customer_package_id:val(deliveryForm,'customer_package_id')}:{}),
    ...(field(deliveryForm,'attach_to_case').checked?{attach_to_case:true,expected_case_sha256:commerceFor(val(deliveryForm,'edition_id'))?.expected_case_sha256}:{})},'delivery-form');
}));
field(deliveryForm,'edition_id').addEventListener('change',()=>{updateDeliveryCommerce();updateDeliveryFollowups();});
feedbackForm.addEventListener('input',invalidateDeliveryFeedback);
field(feedbackForm,'report_files').addEventListener('change',run(()=>readDeliveryFeedbackFiles('report_files','reports_json','delivery notice')));
field(feedbackForm,'sent_files').addEventListener('change',run(()=>readDeliveryFeedbackFiles('sent_files','sent_json','sent')));
$('preview-delivery-feedback').addEventListener('click',run(reviewDeliveryFeedback));
feedbackForm.addEventListener('submit',run(async event=>{event.preventDefault();
  if(!feedbackPreview?.can_receive||!feedbackInput)throw new Error('Review the current complete delivery report first.');
  await mutate('delivery-feedback-receive',feedbackInput,'delivery-feedback-form');
}));
$('editions').addEventListener('click',run(event=>{
  const button=event.target.closest('[data-record-followup]');if(!button)return;
  if(!allowNavigate())return;
  const previous=state.selected.deliveries.find(row=>row.id===button.dataset.recordFollowup);
  if(!previous)throw new Error('Open the original delivery attempt.');
  deliveryForm.reset();setFields(deliveryForm,{edition_id:previous.edition_id,channel:previous.channel,destination:previous.destination});
  updateDeliveryFollowups(previous.id);updateDeliveryCommerce();markDirty(deliveryForm);
  $('delivery-panel').hidden=false;$('delivery-panel').scrollIntoView({block:'start'});field(deliveryForm,'destination').focus();
}));
$('editions').addEventListener('click',run(event=>{
  const button=event.target.closest('[data-link-followup]');if(!button)return;
  if(!allowNavigate())return;
  const previous=state.selected.deliveries.find(row=>row.id===button.dataset.linkFollowup);
  if(!previous)throw new Error('Open the original earlier delivery.');
  const candidates=recordedFollowupCandidates(previous);
  if(!candidates.length)throw new Error('There is no unlinked later send on this prepared edition.');
  followupForm.reset();setFields(followupForm,{previous_delivery_id:previous.id});
  field(followupForm,'delivery_id').innerHTML=option('','Choose the existing later send')+
    candidates.map(row=>option(row.id,row.destination+' · '+time(row.delivered_at)+' · '+row.provider_id)).join('');
  $('delivery-followup-description').textContent='Earlier send: '+previous.destination+' · '+time(previous.delivered_at)+' · '+previous.provider_id;
  $('delivery-followup-panel').hidden=false;markDirty(followupForm);updateControls();
  $('delivery-followup-panel').scrollIntoView({block:'start'});field(followupForm,'delivery_id').focus();
}));
followupForm.addEventListener('submit',run(async event=>{
  event.preventDefault();
  await mutate('delivery-followup-link',{id:uuid('delivery-followup'),previous_delivery_id:val(followupForm,'previous_delivery_id'),
    delivery_id:val(followupForm,'delivery_id'),note:val(followupForm,'note')},'delivery-followup-form');
}));
$('close-delivery-followup').addEventListener('click',run(()=>{if(allowNavigate())$('delivery-followup-panel').hidden=true;}));
field(deliveryForm,'attach_to_case').addEventListener('change',()=>{field(deliveryForm,'receipt_url').required=field(deliveryForm,'attach_to_case').checked;});
field(commerceForm,'case_id').addEventListener('change',run(async()=>{await loadCommerceCase(val(commerceForm,'case_id'));markDirty(commerceForm);}));
field(commerceForm,'scope_id').addEventListener('change',renderCommerceScope);
$('close-commerce').addEventListener('click',run(()=>{if(allowNavigate())$('commerce-panel').hidden=true;}));
$('close-case-delivery').addEventListener('click',run(()=>{if(allowNavigate())$('case-delivery-panel').hidden=true;}));
commerceForm.addEventListener('submit',run(async event=>{
  event.preventDefault();if(!commerceCase)throw new Error('Choose the original company case.');
  const scopeId=val(commerceForm,'scope_id'),scope=commerceCase.commercial.scopes.find(row=>row.id===scopeId);
  const terms=Object.fromEntries(['title','customer','supplier','schedule','payment_terms','dependencies','exclusions','rights','change_process'].map(key=>[key,val(commerceForm,key)]));
  await mutate('commercial-scope',{id:uuid('lead-scope'),pack_id:selectedId,edition_id:val(commerceForm,'edition_id'),
    case_id:val(commerceForm,'case_id'),expected_case_sha256:commerceCase.expected_case_sha256,
    previous_id:val(commerceForm,'previous_id'),reason:val(commerceForm,'reason'),
    ...(scope?{scope_id:scope.id,expected_scope_sha256:scope.sha256}:{terms})},'commerce-form');
}));
caseDeliveryForm.addEventListener('submit',run(async event=>{
  event.preventDefault();
  const delivery=state.selected.deliveries.find(row=>row.id===val(caseDeliveryForm,'delivery_id'));
  const current=delivery&&commerceFor(delivery.edition_id);
  if(!current?.available)throw new Error('Open the original saved commercial case.');
  await mutate('commercial-delivery',{delivery_id:delivery.id,expected_case_sha256:current.expected_case_sha256,
    evidence_url:val(caseDeliveryForm,'evidence_url')},'case-delivery-form');
}));
withdrawForm.addEventListener('submit',run(async event=>{event.preventDefault();
  await mutate('edition-withdraw',{id:uuid('withdrawal'),edition_id:val(withdrawForm,'edition_id'),reason:val(withdrawForm,'reason')},'withdraw-form');
}));
$('resume-save').addEventListener('click',run(performPending));
$('download-request').addEventListener('click',()=>{if(pending)download(pending.body.operation_id+'.json',JSON.stringify(pending.body,null,2)+'\n');});
$('review-request').addEventListener('click',run(async()=>{
  if(!pending?.failure?.definitive)throw new Error('Resume the original request to learn its outcome first.');
  const saved=pending;
  if(saved.body.kind.startsWith('creator-')){
    if(saved.body.kind==='creator-programme-save'&&saved.body.input.document?.operating_plan)
      throw new Error('Use Review retained save against current programme in the operating pane to compare its complete retained work.');
    const reviewed=await reviewOriginalCreatorRequest(saved);if(reviewed.committed)return;
    reworkForm.dataset.creatorReviewedRoot=state.root_sha256;
  }else await loadState(saved.body.input.pack_id||selectedId);
  if(pending?.body.operation_id!==saved.body.operation_id)throw new Error('The saved request changed in another tab. Open its current request.');
  field(reworkForm,'input').value=JSON.stringify(saved.body.input,null,2);$('rework-form').hidden=false;
  message('The rejected input is open for review against the current workspace. Its original request remains downloadable.');
}));
reworkForm.addEventListener('submit',run(async event=>{event.preventDefault();
  if(!pending?.failure?.definitive)throw new Error('Resume the original request before making a revised request.');
  let input;try{input=JSON.parse(val(reworkForm,'input'));}catch{throw new Error('Keep a complete JSON operation input.');}
  if(!input||Array.isArray(input)||typeof input!=='object')throw new Error('Keep an operation input object.');
  const old=pending.body;
  if(old.kind.startsWith('creator-')){
    if(old.kind==='creator-programme-save'&&old.input.document?.operating_plan)
      throw new Error('Use the operating pane to compare the complete retained programme.');
    const reviewedRoot=reworkForm.dataset.creatorReviewedRoot,reviewed=await reviewOriginalCreatorRequest(pending);
    if(reviewed.committed)return;
    if(reviewedRoot!==state.root_sha256){
      field(reworkForm,'input').value=JSON.stringify(input,null,2);reworkForm.dataset.creatorReviewedRoot=state.root_sha256;
      $('rework-form').hidden=false;message('The current workspace changed. Review the retained proposed input against this source, then submit again.');return;
    }
  }
  if(old.kind==='case-handoff'){
    const preview=await api('/api/lead-packs/case-preview',{input,expected_root_sha256:state.root_sha256});
    const revised={...preview.request_input,expected_case_sha256:preview.expected_case_sha256,preview_sha256:preview.preview_sha256};
    const reviewed=reworkForm.dataset.casePreview===preview.preview_sha256;
    if(!reviewed){
      field(reworkForm,'input').value=JSON.stringify(revised,null,2);reworkForm.dataset.casePreview=preview.preview_sha256;
      let review=$('case-rework-preview');if(!review){review=document.createElement('div');review.id='case-rework-preview';reworkForm.append(review);}
      review.innerHTML=caseLinkReviewHTML(preview);
      message('Review the current case and prepared work below. Submit this revised request to save it.');return;
    }
    stashPending({operation_id:uuid('lead-case'),kind:old.kind,input:revised,expected_root_sha256:preview.expected_root_sha256,
      expected_workspace_revision:preview.expected_workspace_revision},{replaces:old.operation_id});
    delete reworkForm.dataset.casePreview;
  }else stashPending({operation_id:uuid('lead-op'),kind:old.kind,input,expected_root_sha256:state.root_sha256},{replaces:old.operation_id});
  $('rework-form').hidden=true;await performPending();
}));
document.addEventListener('click',run(async event=>{
  const downloadLink=event.target.closest('[data-customer-download]');
  if(downloadLink&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey){event.preventDefault();await customerDownload(downloadLink);return;}
  const edition=event.target.closest('[data-open-edition]');if(edition){focusEdition(edition.dataset.openEdition);return;}
  const open=event.target.closest('[data-open-pack]');if(open){await openReviewedCustomer(open.dataset.openPack);return;}
  const edit=event.target.closest('[data-edit-lead]');if(edit){if(allowNavigate()){renderLeadEditor(state.selected.leads.find(row=>row.id===edit.dataset.editLead));$('lead-editor').scrollIntoView({block:'start'});rememberReview();}return;}
  const restore=event.target.closest('[data-restore-lead]');if(restore){if(allowNavigate()){
    const row=state.selected.leads.find(row=>row.id===restore.dataset.restoreLead),old=row.history.find(v=>v.revision===Number(restore.dataset.revision));
    renderLeadEditor(row,old.document);message('Earlier revision opened as a draft. Saving retains the current record and creates its next revision.');}return;}
  const replace=event.target.closest('[data-prepare-replacement]');if(replace){
    if(!allowNavigate())return;field(replacementForm,'replaces').value=replace.dataset.prepareReplacement;
    replacementRows=[{old_id:'',new_id:'',reason:''}];renderReplacementRows();$('replacement-panel').scrollIntoView({block:'start'});return;}
  const remove=event.target.closest('[data-remove-replacement]');if(remove){readReplacementRows();replacementRows.splice(Number(remove.dataset.removeReplacement),1);renderReplacementRows();markDirty(replacementForm);return;}
  const commerce=event.target.closest('[data-commerce]');if(commerce){await openCommerce(commerce.dataset.commerce);return;}
  const caseDelivery=event.target.closest('[data-case-delivery]');if(caseDelivery){await openCaseDelivery(caseDelivery.dataset.caseDelivery);return;}
  const deliver=event.target.closest('[data-record-delivery]');if(deliver){
    if(!allowNavigate())return;deliveryForm.reset();field(deliveryForm,'edition_id').value=deliver.dataset.recordDelivery;updateDeliveryFollowups();updateDeliveryCommerce();$('delivery-panel').scrollIntoView({block:'start'});field(deliveryForm,'delivered_at').focus();return;}
  const withdraw=event.target.closest('[data-withdraw]');if(withdraw){
    if(!allowNavigate())return;field(withdrawForm,'edition_id').value=withdraw.dataset.withdraw;$('withdraw-panel').scrollIntoView({block:'start'});field(withdrawForm,'reason').focus();}
}));
reconciliation=mountLeadReconciliation({getState:()=>state,isLocked:()=>busy||reviewLoading||Boolean(pending),setWorking:value=>{busy=value;updateControls();},api,mutate,run,markDirty,uuid});

window.addEventListener('pagehide',()=>{if(!reviewLoading)rememberReview();});
window.addEventListener('scroll',()=>{clearTimeout(reviewScrollTimer);reviewScrollTimer=setTimeout(()=>{if(state&&!reviewLoading)rememberReview();},250);},{passive:true});
window.addEventListener('popstate',run(async event=>{
  if(reviewReturning){reviewReturning=false;return;}
  const incoming=event.state?.lead_review,context=normalizedReview(incoming?.context),previous=reviewHistory;
  if(!allowNavigate()){
    if(previous&&Number.isSafeInteger(incoming?.index)&&previous.index!==incoming.index){reviewReturning=true;history.go(previous.index-incoming.index);}
    else if(previous)history.replaceState({...history.state,lead_review:{schema:REVIEW_SCHEMA,index:previous.index,context:previous.context}},'',previous.url);
    return;
  }
  const requested=new URL(location.href).searchParams.get('pack_id')||'';
  await loadState(requested,{review:context,history:'restore',position:true});
}));

run(async()=>{
  const requested=new URL(location.href).searchParams.get('pack_id')||'';
  try{await loadState(requested);}catch(error){if(requested&&error.status===404)await loadState();else throw error;}
  if(pending)message('A saved request is available. Resume it to continue the same operation.');
  else message(state.packs.length?'Open a saved customer brief or prepare a new sample.':'Create a customer brief to begin.');
})();
