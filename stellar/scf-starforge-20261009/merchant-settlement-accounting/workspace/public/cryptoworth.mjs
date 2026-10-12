// MIT. Native Cryptoworth review over the original merchant/accountant workspace.
const BASE='/api/cryptoworth',LIMIT=50,MAX_FILE=64*1024*1024;
const $=id=>document.getElementById(id),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const enc=encodeURIComponent,copy=x=>structuredClone(x),present=x=>x===null||x===undefined?'Not recorded':typeof x==='object'?JSON.stringify(x,null,2):String(x);
const names={date:'Date',cryptoId:'Crypto ID',type:'Transaction type',amountOne:'Amount One',amountOneType:'Amount One asset type',amountTwo:'Amount Two',amountTwoType:'Amount Two asset type',transactionHash:'Transaction hash',connectionId:'Connection ID',note:'Note',ledgerId:'Returned ledger ID',rowId:'Returned row ID'};
const roles=['date','cryptoId','type','amountOne','amountOneType','amountTwo','amountTwoType'];
const extraRoles=['transactionHash','connectionId','note'];
const receivedRoles=[...roles,'transactionHash','ledgerId','connectionId','rowId'];
const problem=(message,status,code)=>Object.assign(new Error(message),{status,code});
let db,root=null,scope='',busy=false,hydrating=false,writingTimer;
let draft={fields:{},assets:[],decisions:{},dateEvidence:{},template:null,captureTemplate:null,previousProfileId:null};
let previews={},pending=null,source=null,selectedMovement=null,selectedPlan=null,planDetail=null;
let sourceOffset=0,planOffset=0,captureOffset=0,sourceGeneration=0,planGeneration=0,captureGeneration=0;
const files=new Map();
function tell(message,error=false){$('message').hidden=!message;$('message').textContent=message??'';$('message').classList.toggle('error',error);}
function text(id,value){$(id).textContent=present(value);}
function actor(){const value=$('actor').value.trim();if(!value)throw problem('Enter the operator or reviewer name.');return value;}
function field(id){return $(id).value;}
function requireValue(id,label){const value=field(id).trim();if(!value)throw problem('Enter '+label+'.');return value;}
function badge(value){return '<span class="badge'+(/BLOCKED|INVALID|CHANGED|AMBIGUOUS|MISSING|DUPLICATE/.test(value)?' problem':'')+'">'+esc(value)+'</span>';}
function factRows(values){return Object.entries(values).map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(present(v))+'</dd>').join('');}
function facts(values){return '<dl class="facts">'+factRows(values)+'</dl>';}
function metrics(target,value,keys){$(target).innerHTML=keys.filter(k=>value?.[k]!==undefined).map(k=>'<div class="metric"><strong>'+esc(value[k])+'</strong><span>'+esc(k.replace(/([A-Z])/g,' $1').toLowerCase())+'</span></div>').join('');}
function detail(title,value){text('detail-title',title);$('detail-body').innerHTML='<pre>'+esc(present(value))+'</pre>';$('detail-dialog').showModal();}
function pageLabel(target,page){const total=page?.totalRows??page?.total??0,offset=page?.offset??0,count=page?.items?.length??0;text(target,total?String(offset+1)+'–'+String(offset+count)+' of '+String(total):'No rows in this selection');}
function pageButtons(prefix,page){const total=page?.totalRows??page?.total??0,offset=page?.offset??0,count=page?.items?.length??0;$(prefix+'-prev').disabled=busy||offset===0;$(prefix+'-next').disabled=busy||offset+count>=total;}
function setBusy(value){busy=value;document.body.setAttribute('aria-busy',String(value));for(const control of document.querySelectorAll('button,input,select,textarea'))control.disabled=value;updateControls();}
function updateControls(){
 if(busy){for(const control of document.querySelectorAll('button,input,select,textarea'))control.disabled=true;return;}
 for(const kind of ['profile','plan','capture','return','rollback','packet'])$(kind+'-save').disabled=!previews[kind]||!!previews[kind]?.saved||!!pending;
 $('pending').hidden=!pending;
 if(pending)text('pending-text',pending.label+' is retained with its original request. Check the saved outcome or continue that same request.');
 pageButtons('source',source);pageButtons('plan',previews.plan);pageButtons('capture',previews.capture);
 $('source-form').querySelector('button[type=submit]').disabled=!field('source-handoff');
}
async function act(fn){if(busy)return;tell('');setBusy(true);try{return await fn();}catch(error){tell(error.message??String(error),true);}finally{setBusy(false);}}
function openDatabase(){return new Promise((resolve,reject)=>{const request=indexedDB.open('stellar-forge-cryptoworth-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('items');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(problem('This browser could not open the private draft store. '+request.error?.message));});}
function itemKey(name){if(!scope)throw problem('Open the original workspace first.');return scope+':'+name;}
function stored(name){return new Promise((resolve,reject)=>{const transaction=db.transaction('items','readonly'),request=transaction.objectStore('items').get(itemKey(name));request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
function writeStored(name,value){return new Promise((resolve,reject)=>{const transaction=db.transaction('items','readwrite');if(value===undefined)transaction.objectStore('items').delete(itemKey(name));else transaction.objectStore('items').put(value,itemKey(name));transaction.oncomplete=()=>resolve();transaction.onabort=()=>reject(problem('The browser could not retain this draft. '+(transaction.error?.message??'Check available browser storage.')));transaction.onerror=()=>{};});}
function smallFields(){return Object.fromEntries([...document.querySelectorAll('input[id]:not([type=file]),select[id],textarea[id]')].map(el=>[el.id,el.type==='checkbox'?el.checked:el.value]));}
function readAssets(){return [...$('asset-mappings').children].map(tr=>Object.fromEntries([...tr.querySelectorAll('[data-asset]')].map(el=>[el.dataset.asset,el.value])));}
async function retainDraft(){if(hydrating||!scope)return;draft.fields=smallFields();draft.assets=readAssets();if(draft.template){draft.columns=collectColumns('profile-role',[...roles,...extraRoles]);draft.constants=Object.fromEntries([...$('profile-constants').querySelectorAll('[data-constant]')].map(input=>[input.dataset.constant,input.value]));}if(draft.captureTemplate)draft.captureColumns=collectColumns('capture-role',receivedRoles);await writeStored('draft',draft);}
function deferDraft(){clearTimeout(writingTimer);writingTimer=setTimeout(()=>retainDraft().catch(e=>tell(e.message,true)),450);}
async function invalidate(kind){delete previews[kind];$(kind+'-preview').hidden=true;await writeStored('preview:'+kind,undefined);updateControls();}
async function keepPreview(kind,value){await writeStored('preview:'+kind,value);previews[kind]=value;renderPreview(kind);await retainDraft();}
async function api(path='',{method='GET',value,signal}={}){
 const url=path.startsWith('/api/')?path:BASE+path;
 const response=await fetch(url,{method,headers:{'Accept':'application/json',...(method==='POST'?{'Content-Type':'application/json','X-Workspace-Request':'1'}:{})},...(method==='POST'?{body:JSON.stringify({...value,workspaceId:scope})}:{}),signal});
 let data;try{data=await response.json();}catch{throw problem('The workspace returned an unreadable response.',response.status);}
 if(!response.ok)throw problem(data.message??data.error??'The workspace request failed.',response.status,data.error);return data;
}
async function inspectFile(key){const file=await getFile(key);return api('/templates/inspect',{method:'POST',value:{file,...(field(key==='template'?'template-delimiter':'capture-delimiter')?{delimiter:field(key==='template'?'template-delimiter':'capture-delimiter')}:{})}});}
async function saveFile(input,key){const file=input.files?.[0];if(!file)return getFile(key);if(file.size===0||file.size>MAX_FILE)throw problem('Choose a nonempty file up to 64 MiB.');const dataBase64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(problem('The selected file could not be read.'));reader.readAsDataURL(file);});const value={name:file.name,dataBase64};await writeStored('file:'+key,value);files.set(key,value);return value;}
async function getFile(key){const value=files.get(key)??await stored('file:'+key);if(!value)throw problem('Choose the original '+(key==='template'?'customer template':key==='capture'?'returned CSV':key==='packet'?'packet':'date source file')+'.');files.set(key,value);return value;}
function fileLabel(id,file){text(id,file?file.name+' · '+(Math.floor(file.dataBase64.length*3/4)-(file.dataBase64.endsWith('==')?2:file.dataBase64.endsWith('=')?1:0)).toLocaleString()+' bytes retained for this workspace':'Choose the original file.');}
function options(id,items,{empty,selected,initialLabel}={}){const before=selected??field(id),list=Array.isArray(items)?items:[];$(id).innerHTML=(empty!==undefined?'<option value="">'+esc(empty)+'</option>':'')+(initialLabel?'<option value="initial">'+esc(initialLabel)+'</option>':'')+list.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name??x.label??x.id)+'</option>').join('');if([...$(id).options].some(o=>o.value===before))$(id).value=before;}
function renderRoot(){
 options('source-handoff',root.handoffs,{empty:'Select a retained handoff'});
 options('profile-existing',root.profiles,{empty:'Create a mapping'});
 options('plan-profile',root.profiles,{empty:'Select a saved mapping'});
 for(const id of ['plan-previous','capture-plan','saved-plan'])options(id,root.plans,{empty:id==='plan-previous'?'First plan':'Select a saved plan'});
 text('workspace-state','Workspace revision '+root.revision);
 $('docs').innerHTML='<ul>'+[
 ['Import template and manual connection','https://help.cryptoworth.com/en/articles/10396994-how-to-bulk-import-manual-transactions'],
 ['Find the Crypto ID for the correct protocol','https://help.cryptoworth.com/en/articles/10426331-how-to-find-the-crypto-id'],
 ['Migration cutoff and original balance review','https://help.cryptoworth.com/en/articles/12327176-switching-to-cryptoworth-from-another-platform'],
 ['Roll back an exact native import','https://help.cryptoworth.com/en/articles/10424777-how-to-roll-back-imported-transactions']
 ].map(([label,url])=>'<li><a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a></li>').join('')+'</ul>';
}
async function refresh({first=false}={}){
 const next=await api('');if(typeof next.workspaceId!=='string'||!next.workspaceId)throw problem('The current Cryptoworth workspace must expose its stable workspace identity.');
 if(scope&&scope!==next.workspaceId){clearTimeout(writingTimer);files.clear();previews={};pending=null;source=null;selectedMovement=null;selectedPlan=null;planDetail=null;draft={fields:{},assets:[],decisions:{},dateEvidence:{},template:null,captureTemplate:null,previousProfileId:null};for(const input of document.querySelectorAll('input,textarea'))if(input.type!=='file')input.value='';first=true;}
 root=next;scope=next.workspaceId;renderRoot();
 if(first){
  hydrating=true;try{
   const saved=await stored('draft');if(saved)draft={...draft,...saved};
   for(const [id,value]of Object.entries(draft.fields??{}))if($(id)&&$(id).type!=='file'){$(id).value=value;}
   renderRoot();
   if(field('source-handoff'))await loadHandoffRevisions(draft.fields?.['source-revision']);
   for(const kind of ['profile','plan','capture','return','rollback','packet']){const value=await stored('preview:'+kind);if(value)previews[kind]=value;}
   pending=await stored('pending')??null;
   for(const key of ['template','capture']){const value=await stored('file:'+key);if(value){files.set(key,value);fileLabel(key==='template'?'template-selection':'capture-selection',value);}}
   renderTemplate();renderAssets(draft.assets??[]);renderCaptureColumns();for(const kind of Object.keys(previews))renderPreview(kind);
  }finally{hydrating=false;}
 }
 updateSourceLabel();updateControls();
}
async function loadHandoffRevisions(wanted){
 const handoffId=field('source-handoff');if(!handoffId){options('source-revision',[],{initialLabel:'Initial handoff'});return;}
 let record=(root.handoffs??[]).find(x=>x.id===handoffId);
 if(!Array.isArray(record?.revisions)){const result=await api('/api/accountant/handoffs/'+enc(handoffId));record=result.record??result;}
 options('source-revision',record?.revisions??[],{initialLabel:'Initial handoff',selected:wanted??field('source-revision')});
}
function selectedSource(){const handoffId=field('source-handoff');if(!handoffId)throw problem('Select and open an accountant handoff first.');return {handoffId,accountantRevisionId:field('source-revision')||'initial'};}
function updateSourceLabel(){const id=field('source-handoff'),row=root?.handoffs?.find(x=>x.id===id);text('plan-source-label',id?(row?.name??id)+' · '+(field('source-revision')==='initial'?'initial handoff':field('source-revision')):'Select the original source in step 1.');text('plan-decision-label',Object.keys(draft.decisions??{}).length+' explicit movement decisions · '+Object.keys(draft.dateEvidence??{}).length+' supplied date sources');}
function tab(name){for(const section of document.querySelectorAll('.tab'))section.hidden=section.id!=='tab-'+name;for(const button of document.querySelectorAll('.tabs [data-tab]')){if(button.dataset.tab===name)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}draft.tab=name;deferDraft();}

async function loadSource(offset=0){
 const generation=++sourceGeneration,selection=selectedSource();sourceOffset=offset;
 const query=new URLSearchParams({...selection,offset:String(offset),limit:String(LIMIT),search:field('source-search')});
 const value=await api('/source?'+query);if(generation!==sourceGeneration)return;
 source=value;renderSource();await retainDraft();
}
function renderSource(){
 metrics('source-summary',source?.summary,['events','movements','payments','refunds','context','sourceIssues']);
 $('source-context').innerHTML=source?facts({'Selected handoff':source.source?.handoffId??field('source-handoff'),'Accountant revision':source.source?.accountantRevisionId??field('source-revision'),'Captured source':source.source?.handoffName??source.source?.runId??'Retained original handoff'}):'';
 const rows=source?.items??[];
 $('source-rows').innerHTML=rows.length?rows.map((r,i)=>{
 const key=r.selectionId??r.movementId,decision=draft.decisions?.[key],issues=r.issues??[];
 return '<tr><td>'+badge(r.kind??'CONTEXT')+'<small>'+esc(r.eventId??r.rowId??r.movementId)+'</small></td><td>'+esc(r.network)+'<small>'+esc(r.asset??r.assetDigest)+'</small></td><td class="mono">'+esc(r.amountAtomic??'')+'<small>'+esc(r.direction??'')+'</small></td><td>'+esc(r.nativeTransferAt??'Needs original date')+'<small>Recorded '+esc(r.recordedAt??'')+'</small></td><td>'+esc(decision?.action??'Original eligibility')+'<small>'+esc(issues.map(issue=>typeof issue==='object'?issue.message??issue.code??JSON.stringify(issue):issue).join(' · '))+'</small></td><td><button type="button" data-movement="'+i+'">Review</button></td></tr>';
 }).join(''):'<tr><td colspan="6" class="empty">No original movements match this selection.</td></tr>';
 pageLabel('source-page',source);pageButtons('source',source);updateSourceLabel();
}
function reviewMovement(index){
 selectedMovement=source?.items?.[index];if(!selectedMovement)return;
 const r=selectedMovement,key=r.selectionId??r.movementId,decision=draft.decisions?.[key]??{},evidence=draft.dateEvidence?.[r.movementId]??{};
 $('movement-review').hidden=false;text('movement-name',r.eventId??r.rowId??r.movementId);
 $('movement-values').innerHTML=factRows({'Movement identity':r.movementId,'Selected occurrence':r.selectionId??r.rowId,'Direction':r.direction,'Atomic amount':r.amountAtomic,'Network':r.network,'Asset':r.asset??r.assetDigest,'Merchant account':r.merchantAccount,'Native transaction':r.transactionHash,'Native transfer date':r.nativeTransferAt,'Recorded at':r.recordedAt,'Adjustment':r.adjustmentId,'Accountant values':r.accountant,'Issues':r.issues});
 $('movement-action').value=decision.action??'';$('movement-reason').value=decision.reason??'';$('movement-reference').value=decision.reference??'';
 $('evidence-at').value=evidence.transferAt??'';$('evidence-note').value=evidence.note??'';$('evidence-file').value='';
 $('movement-review').scrollIntoView({behavior:'smooth',block:'start'});
}
function renderAssets(items){$('asset-mappings').innerHTML=(items??[]).map((asset,index)=>'<tr>'+['network','assetDigest','cryptoId','amountType','scale'].map(key=>'<td><input data-asset="'+key+'" aria-label="'+esc(key)+' for asset '+(index+1)+'" '+(key==='scale'?'type="number" min="0" max="30" step="1"':'type="text" spellcheck="false"')+' value="'+esc(asset[key]??'')+'"></td>').join('')+'<td><button type="button" class="asset-delete" data-remove-asset="'+index+'">Remove</button></td></tr>').join('');}
function collectColumns(prefix,all){return Object.fromEntries(all.map(role=>[role,$(prefix+'-'+role)?.value??'']).filter(([,value])=>value!==''));}
function columnControls(target,prefix,headers,all,selected={},required=[]){
 $(target).innerHTML=all.map(role=>'<label>'+esc(names[role]??role)+(required.includes(role)?'':' · optional')+'<select id="'+prefix+'-'+role+'" '+(required.includes(role)?'required':'')+'><option value="">'+(required.includes(role)?'Select exact file column':'Unmapped')+'</option>'+headers.map(header=>'<option value="'+esc(header)+'" '+(selected[role]===header?'selected':'')+'>'+esc(header||'(Empty heading)')+'</option>').join('')+'</select></label>').join('');
}
function renderConstants(){
 const template=draft.template;if(!template)return;
 const old={...(draft.constants??{})};for(const input of $('profile-constants').querySelectorAll('[data-constant]'))old[input.dataset.constant]=input.value;
 const selected=new Set(Object.values(collectColumns('profile-role',[...roles,...extraRoles])));
 draft.constants=old;
 $('profile-constants').innerHTML=template.headers.filter(header=>!selected.has(header)).map((header,index)=>'<label>Literal · '+esc(header)+'<input id="constant-'+index+'" data-constant="'+esc(header)+'" value="'+esc(old[header]??'')+'" aria-label="Literal value for '+esc(header)+'"></label>').join('');
}
function renderTemplate(binding){
 const t=draft.template;if(!t){$('profile-columns').innerHTML='';$('profile-constants').innerHTML='';return;}
 const selected=binding??draft.columns??draft.suggestedColumns??{};
 columnControls('profile-columns','profile-role',t.headers,[...roles,...extraRoles],selected,roles);
 $('template-summary').innerHTML=facts({'Original file':t.name,'SHA-256':t.sha256,'Column order':t.headers,'Delimiter':t.delimiter==='\t'?'Tab':t.delimiter,'Bytes':t.bytes});
 renderConstants();
}
function renderCaptureColumns(binding){
 const headers=draft.captureTemplate?.headers??[],selected=binding??draft.captureColumns??{};
 columnControls('capture-columns','capture-role',headers,receivedRoles,selected,['date','cryptoId','type','amountOne']);
 $('capture-mapped').hidden=field('capture-kind')!=='MAPPED_EXPORT';
}
async function profileRequest(){
 const assets=readAssets().map((row,index)=>{if(row.scale===''||!Number.isInteger(Number(row.scale)))throw problem('Enter the integer decimal scale for asset '+(index+1)+'.');return {...row,scale:Number(row.scale)};});
 const constants=Object.fromEntries([...$('profile-constants').querySelectorAll('[data-constant]')].map(input=>[input.dataset.constant,input.value]));
 return {name:requireValue('profile-name','a mapping name'),actor:actor(),file:await getFile('template'),...(draft.previousProfileId?{previousProfileId:draft.previousProfileId}:{}),...(field('template-delimiter')?{delimiter:field('template-delimiter')}:{}),
 target:{entityId:requireValue('target-entity-id','the native entity ID'),entityName:requireValue('target-entity-name','the entity name'),connectionId:requireValue('target-connection-id','the native connection ID'),connectionName:requireValue('target-connection-name','the connection name'),merchantAccount:requireValue('target-merchant','the merchant account')},
 columns:collectColumns('profile-role',[...roles,...extraRoles]),constants,date:{format:requireValue('profile-date','the template date format'),timeZone:requireValue('profile-zone','the account timezone')},assets};
}
async function planRequest(){
 const sourceSelection=selectedSource(),dateEvidence=[];
 for(const value of Object.values(draft.dateEvidence??{}))dateEvidence.push({...value,file:await getFile(value.fileKey),fileKey:undefined});
 return {name:requireValue('plan-name','a plan name'),actor:actor(),profileId:requireValue('plan-profile','a saved mapping'),...sourceSelection,...(field('plan-previous')?{previousPlanId:field('plan-previous')}:{}),decisions:Object.values(draft.decisions??{}),...(dateEvidence.length?{dateEvidence}:{})};
}
function renderPlanRows(page){
 const items=page?.items??[];
 $('plan-rows').innerHTML=items.length?items.map(r=>'<tr><td>'+esc(r.eventId??r.rowId??r.movementId)+'<small>'+esc(r.kind??'')+'</small></td><td>'+badge(r.status??'')+'<small>'+esc(typeof r.decision==='object'?[r.decision?.action,r.decision?.reason].filter(Boolean).join(' · '):r.decision??'')+'</small></td><td>'+esc(r.direction??'')+'<small>'+esc(r.mapping?.cryptoId??r.cryptoId??'')+'</small></td><td class="mono">'+esc(r.quantity??'')+'<small>'+esc(r.amountAtomic??'')+' atomic</small></td><td>'+esc(r.date??'')+'</td><td>'+esc((r.issues??[]).map(x=>typeof x==='object'?x.message??x.code??JSON.stringify(x):x).join(' · '))+'</td></tr>').join(''):'<tr><td colspan="6" class="empty">No mapped rows in this page.</td></tr>';
 pageLabel('plan-page',page);pageButtons('plan',page);
}
function renderGroups(groups){return '<table><caption>Exact selected totals by network, asset and direction</caption><thead><tr><th>Network / asset</th><th>Crypto ID</th><th>Direction</th><th>Rows</th><th>Atomic amount</th><th>Exact quantity</th></tr></thead><tbody>'+(groups??[]).map(g=>'<tr><td>'+esc(g.network)+'<small>'+esc(g.asset??g.assetDigest)+'</small></td><td>'+esc(g.cryptoId)+'</td><td>'+esc(g.direction)+'</td><td>'+esc(g.rows)+'</td><td class="mono">'+esc(g.amountAtomic)+'</td><td class="mono">'+esc(g.quantity)+'</td></tr>').join('')+'</tbody></table>';}
function renderComparison(page){
 const items=page?.items??[];
 $('capture-comparison').innerHTML='<table><caption class="sr-only">Returned record comparison</caption><thead><tr><th>Original event</th><th>Comparison</th><th>Expected</th><th>Received</th><th>Changes / issues</th></tr></thead><tbody>'+items.map((row,i)=>'<tr><td>'+esc(row.eventId??row.movementId??'Received row')+'</td><td>'+badge(row.status??'')+'</td><td>'+esc(row.expected?.quantity??row.expected?.amountOne??'')+'<small>'+esc(row.expected?.date??'')+'</small></td><td>'+esc(Array.isArray(row.received)?row.received.length+' matching candidate(s)':present(row.received??''))+'</td><td><button type="button" data-compare="'+i+'">Open row details</button><small>'+esc((row.issues??[]).map(x=>typeof x==='object'?x.message??x.code??JSON.stringify(x):x).join(' · '))+'</small></td></tr>').join('')+(items.length?'':'<tr><td colspan="5" class="empty">No comparison rows in this page.</td></tr>')+'</tbody></table>';
 pageLabel('capture-page',page);pageButtons('capture',page);
}
function renderPreview(kind){
 const value=previews[kind];$(kind+'-preview').hidden=!value;if(!value)return;
 if(kind==='profile'){
  const p=value.profile??{};$('profile-preview-content').innerHTML=facts({'Name':p.name,'Entity':p.target?.entityName??p.target?.entityId,'Connection':p.target?.connectionName??p.target?.connectionId,'Merchant account':p.target?.merchantAccount,'Date format':p.date,'Column mapping':p.columns,'Other column values':p.constants,'Assets':p.assets,'Original template SHA-256':p.template?.sha256});
 }else if(kind==='plan'){
  const p=value.plan??{};metrics('plan-summary',p.summary,['totalRows','ready','blocked','alreadyImported','excluded','context']);$('plan-groups').innerHTML=renderGroups(p.summary?.groups);text('plan-export-ready',p.canExport?'The selected rows are ready for CSV export.':'Review the blocked rows and source decisions before using an import CSV.');$('plan-issues').innerHTML=p.issues?.length?facts({'Plan issues':p.issues}):'';renderPlanRows(value);
 }else if(kind==='capture'){
  $('capture-save').hidden=!!value.saved;metrics('capture-summary',value.comparison?.summary??value.summary,['matched','changed','missing','unexpected','ambiguous','duplicateReceived','invalid']);renderComparison(value);
 }else if(kind==='return'){
  $('return-summary').innerHTML=facts({'Selected capture':value.request?.captureId,'Status':value.request?.status,'Book reference':value.request?.bookRef,'Matched return':value.summary,'Original accountant preview':value.accountantPreview?.revision?.summary??value.accountantPreview?.summary});
 }else if(kind==='rollback'){
  $('rollback-summary').innerHTML=facts({'Native import':value.request.nativeImportId,'Completed at':value.request.completedAt,'Reason':value.request.reason,'Native reference':value.request.reference,'Selected capture':value.request.captureId});
 }else if(kind==='packet'){
  $('packet-summary').innerHTML=facts({'Packet summary':value.inspection?.summary??value.inspection,'Receiving name':value.name});
 }
 updateControls();
}

async function switchSourceDraft(){
 const key=field('source-handoff')+':'+field('source-revision');if(draft.sourceKey===key)return;
 draft.sourceDrafts??={};if(draft.sourceKey)draft.sourceDrafts[draft.sourceKey]={decisions:draft.decisions,dateEvidence:draft.dateEvidence};
 const prior=draft.sourceDrafts[key]??{};draft.decisions=prior.decisions??{};draft.dateEvidence=prior.dateEvidence??{};draft.sourceKey=key;
 source=null;selectedMovement=null;$('movement-review').hidden=true;renderSource();await invalidate('plan');await retainDraft();
}
function planFiles(target,id,list,{captureId}={}){
 $(target).innerHTML=(list??[]).map(file=>{const name=typeof file==='string'?file:file.name;if(!name)return '';const suffix=captureId?'?captureId='+enc(captureId):'';return '<a href="'+BASE+'/plans/'+enc(id)+'/download/'+enc(name)+suffix+'" download>'+esc(name)+(typeof file.bytes==='number'?' · '+file.bytes.toLocaleString()+' B':'')+'</a>';}).join('');
}
async function openPlan(id,{select=true}={}){
 if(!id)throw problem('Choose a saved import plan.');
 const generation=++planGeneration,value=await api('/plans/'+enc(id));if(generation!==planGeneration)return;
 selectedPlan=id;planDetail=value;
 if(select){$('saved-plan').value=id;$('capture-plan').value=id;}
 const plan=value.plan??{},record=value.record??{};
 const overview={'Plan':plan.name??record.name,'Native entity':plan.target?.entityName??plan.target?.entityId,'Native connection':plan.target?.connectionName??plan.target?.connectionId,'Original handoff':plan.handoffId,'Accountant revision':plan.accountantRevisionId,'Saved mapping':plan.profileId,'Selected rows':plan.summary,'CSV ready':plan.canExport};
 $('saved-summary').innerHTML=facts(overview);$('capture-plan-summary').innerHTML=facts({'Plan':overview.Plan,'Entity':plan.target?.entityName??plan.target?.entityId,'Connection':plan.target?.connectionName??plan.target?.connectionId,'Import rows':plan.summary?.ready,'Blocked rows':plan.summary?.blocked});
 planFiles('saved-files',id,value.files??record.files);planFiles('capture-files',id,(value.files??record.files??[]).filter(x=>['import.csv','source-index.csv','review.html'].includes(typeof x==='string'?x:x.name)));
 $('capture-entity').value=plan.target?.entityId??'';$('capture-connection').value=plan.target?.connectionId??'';
 $('packet-download').href=BASE+'/plans/'+enc(id)+'/packet';$('packet-download').hidden=false;
 const captures=value.captures??record.captures??[],returns=value.returns??record.returns??[],rollbacks=value.rollbacks??record.rollbacks??[];
 options('return-capture',captures,{empty:'Select a saved native capture'});options('rollback-capture',captures,{empty:'Select a saved native capture'});
 $('saved-captures').innerHTML='<h3>Native captures</h3>'+(captures.length?'<div class="table-wrap"><table><thead><tr><th>Name / purpose</th><th>Native import</th><th>Comparison</th><th></th></tr></thead><tbody>'+captures.map(c=>'<tr><td>'+esc(c.name??c.id)+'<small>'+esc(c.purpose??'')+'</small></td><td>'+esc(c.nativeImport?.id??c.nativeImportId??'')+'</td><td>'+esc(present(c.summary??''))+'</td><td><button type="button" data-saved-capture="'+esc(c.id)+'">Open comparison</button></td></tr>').join('')+'</tbody></table></div>':'<p class="hint">No saved native capture.</p>');
 $('saved-returns').innerHTML='<h3>Accountant returns</h3>'+(returns.length?returns.map((r,i)=>'<p><button type="button" data-saved-return="'+i+'">'+esc(r.name??r.id)+'</button> '+esc(r.status??r.summary?.selectedStatus??'')+'</p>').join(''):'<p class="hint">No accountant return from this plan.</p>');
 $('saved-rollbacks').innerHTML='<h3>Completed native rollbacks</h3>'+(rollbacks.length?rollbacks.map((r,i)=>'<p><button type="button" data-saved-rollback="'+i+'">'+esc(r.nativeImportId??r.id)+'</button> '+esc(r.completedAt??'')+'</p>').join(''):'<p class="hint">No native rollback recorded.</p>');
 draft.selectedPlan=id;await retainDraft();updateControls();
}
function requirePlan(){if(!selectedPlan||!planDetail?.plan)throw problem('Open the selected saved plan first.');return selectedPlan;}
async function captureRequest(){
 requirePlan();
 const kind=field('capture-kind'),layout={kind,...(field('capture-delimiter')?{delimiter:field('capture-delimiter')}:{}),amountConvention:field('capture-sign'),amountTwoConvention:field('capture-second-sign'),groupSeparator:field('capture-group')};
 if(kind==='MAPPED_EXPORT'){layout.columns=collectColumns('capture-role',receivedRoles);layout.date={format:requireValue('capture-date','the returned date format'),timeZone:requireValue('capture-zone','the returned timezone')};}
 return {name:requireValue('capture-name','a capture name'),actor:actor(),purpose:field('capture-purpose'),file:await getFile('capture'),
 nativeImport:{id:requireValue('capture-native-id','the original native import ID'),entityId:requireValue('capture-entity','the native entity ID'),connectionId:requireValue('capture-connection','the native connection ID'),receivedAt:requireValue('capture-at','the native receiving timestamp'),reference:requireValue('capture-reference','the native reference'),note:field('capture-note')},layout};
}
async function loadPlanPage(offset){
 const current=previews.plan;if(!current)return;const generation=++planGeneration;planOffset=Math.max(0,offset);
 const value=await api('/plans/preview?'+new URLSearchParams({offset:String(planOffset),limit:String(LIMIT)}),{method:'POST',value:current.request});
 if(generation!==planGeneration)return;
 if(value.previewSha256!==current.previewSha256){await invalidate('plan');throw problem('The selected source or prior-import coverage changed. Preview the complete import again.');}
 previews.plan={...current,items:value.items,totalRows:value.totalRows,offset:value.offset,limit:value.limit};renderPreview('plan');
}
async function loadCapturePage(offset){
 const current=previews.capture;if(!current)return;const generation=++captureGeneration;captureOffset=Math.max(0,offset);
 const query=new URLSearchParams({offset:String(captureOffset),limit:String(LIMIT)});
 let value;if(current.saved)value=await api('/plans/'+enc(current.planId)+'/captures/'+enc(current.captureId)+'/rows?'+query);
 else value=await api('/plans/'+enc(current.planId)+'/captures/preview?'+query,{method:'POST',value:current.request});
 if(generation!==captureGeneration)return;
 if(!current.saved&&value.previewSha256!==current.previewSha256){await invalidate('capture');throw problem('The selected comparison changed. Compare the complete returned file again.');}
 previews.capture={...current,items:value.items,totalRows:value.totalRows,offset:value.offset,limit:value.limit};renderPreview('capture');
}
async function openCapture(id){
 const planId=requirePlan(),[value,rows]=await Promise.all([api('/plans/'+enc(planId)+'/captures/'+enc(id)),api('/plans/'+enc(planId)+'/captures/'+enc(id)+'/rows?limit='+LIMIT)]);
 const capture=value.capture??value.comparison??value;
 previews.capture={...rows,comparison:capture,saved:true,planId,captureId:id};renderPreview('capture');$('capture-save').hidden=true;
 $('return-capture').value=id;$('rollback-capture').value=id;$('rollback-native-id').value=capture.nativeImport?.id??'';
 tab('capture');updateControls();
}
async function returnRequest(){
 requirePlan();const handoff=await api('/api/accountant/handoffs/'+enc(planDetail.plan.handoffId));
 const record=handoff.record??handoff,expectedParentId=handoff.revision?.id??handoff.currentRevision?.id??record.revisions?.at(-1)?.id??null;
 return {name:requireValue('return-name','a return name'),actor:actor(),captureId:requireValue('return-capture','a saved native capture'),status:field('return-status'),bookRef:field('return-book-ref'),...(field('return-account-code')?{accountCode:field('return-account-code')}:{}),note:field('return-note'),expectedParentId};
}
function lookupFor(kind,value){
 if(kind==='profile')return {path:'/profiles/'+enc(value.request.id),id:value.request.id,kind};
 if(kind==='plan')return {path:'/plans/'+enc(value.request.id),id:value.request.id,kind};
 if(kind==='capture')return {path:'/plans/'+enc(value.planId)+'/captures/'+enc(value.request.id),id:value.request.id,planId:value.planId,kind};
 if(kind==='return'||kind==='rollback')return {path:'/plans/'+enc(value.planId),id:value.request.id,planId:value.planId,list:kind==='return'?'returns':'rollbacks',kind};
 if(kind==='packet'){const id=value.inspection?.planId??value.inspection?.plan?.id??value.inspection?.summary?.planId;return {path:id?'/plans/'+enc(id):null,id,planId:id,kind};}
 throw problem('This save kind is not supported.');
}
async function verifyWorkspace(){const next=await api('');if(next.workspaceId!==scope)throw problem('The local address now serves a different workspace. Refresh it before saving.',409,'WORKSPACE_REPLACED');return next;}
async function beginSave(kind){
 if(pending)throw problem('Continue the already retained request first.');
 const preview=previews[kind];if(!preview||preview.saved)throw problem('Preview this change first.');
 await verifyWorkspace();
 let path,request;
 if(kind==='profile'||kind==='plan'){path=kind==='profile'?'/profiles':'/plans';request={...preview.request,previewSha256:preview.previewSha256,revision:preview.workspaceRevision};}
 else if(kind==='capture'||kind==='return'){path='/plans/'+enc(preview.planId)+(kind==='capture'?'/captures':'/returns');request={...preview.request,previewSha256:preview.previewSha256,revision:preview.workspaceRevision};}
 else if(kind==='rollback'){path='/plans/'+enc(preview.planId)+'/rollbacks';request={...preview.request,revision:preview.workspaceRevision};}
 else if(kind==='packet'){path='/packets/receive';request={file:await getFile('packet'),name:preview.name,actor:preview.actor,revision:preview.workspaceRevision};}
 const candidate={kind,label:({profile:'Mapping edition',plan:'Import plan',capture:'Native capture',return:'Accountant return',rollback:'Native rollback record',packet:'Packet receiving'})[kind],path,request,lookup:lookupFor(kind,preview),previewSha256:preview.previewSha256??null,workspaceId:scope};
 await writeStored('pending',candidate);pending=candidate;updateControls();await sendPending();
}
async function findPending(){
 if(!pending)return {found:false};await verifyWorkspace();
 if(!pending.lookup.path)return {found:false,unresolved:true};
 let value;try{value=await api(pending.lookup.path);}catch(error){if(error.status===404)return {found:false};throw error;}
 if(pending.lookup.list){const record=(value[pending.lookup.list]??value.record?.[pending.lookup.list]??[]).find(item=>item.id===pending.lookup.id);return {found:!!record,value:record};}
 const original=value.profile??value.plan??value.capture??value.comparison??value;
 const observed=original.integrity?.sha256;
 if(pending.previewSha256&&observed&&observed!==pending.previewSha256)throw problem('This saved identity belongs to different reviewed bytes. The retained request is preserved for inspection.',409,'SAVED_REQUEST_CONFLICT');
 return {found:true,value};
}
async function finishPending(value){
 const saved=pending;if(!saved)return;
 await writeStored('pending',undefined);pending=null;await invalidate(saved.kind);await refresh();
 const planId=saved.kind==='plan'?saved.lookup.id:saved.lookup.planId;
 if(saved.kind==='profile'){draft.previousProfileId=null;$('plan-profile').value=saved.lookup.id;tab('plan');}
 if(planId){await openPlan(planId);tab(saved.kind==='capture'||saved.kind==='return'||saved.kind==='rollback'?'capture':'saved');}
 tell(saved.label+' saved. Its original records are available in this workspace.');await retainDraft();updateControls();
}
async function sendPending(){
 if(!pending)return;await verifyWorkspace();let result;
 try{result=await api(pending.path,{method:'POST',value:pending.request});}
 catch(error){
  let observation;try{observation=await findPending();}catch(readError){tell(error.message+'\nThe original request remains saved. '+readError.message,true);return;}
  if(observation?.found){await finishPending(observation.value);return;}
  const rejected=error.status>=400&&error.status<500&&error.code&&error.code!=='WORKSPACE_OPERATION_FAILED'&&!/ENOSPC|EIO|FAILED|INTERRUPT|REPLACED/.test(error.code);
  if(rejected&&!observation?.unresolved){const kind=pending.kind;await writeStored('pending',undefined);pending=null;await invalidate(kind);await refresh();tell(error.message+'\nYour form and source files remain available. Review the corrected request again.',true);return;}
  tell(error.message+'\nThe exact request is retained. Check its saved outcome or continue the same request.',true);updateControls();return;
 }
 await finishPending(result);
}
async function checkPending(){const result=await findPending();if(result.found)await finishPending(result.value);else tell('The original request has no completed saved outcome yet. Continue that same request to recover it.');}

function bind(id,event,fn){$(id).addEventListener(event,e=>{if(event==='submit')e.preventDefault();void act(()=>fn(e));});}
function editable(){if(pending)throw problem('Continue the retained save request before preparing another change.');}
async function prepare(kind,path,request,{planId}={}){
 editable();const selectedScope=scope,result=await api(path,{method:'POST',value:request});if(selectedScope!==scope)throw problem('The workspace changed during review. Open its saved state again.');
 if(planId)result.planId=planId;await keepPreview(kind,result);tell('Review the complete '+({profile:'mapping',plan:'import plan',capture:'comparison',return:'accountant return'})[kind]+' below before saving.');
}
async function loadSavedProfileFile(id,profile,detail){
 const entry=(detail.files??[]).find(x=>x.name==='template.csv');if(!entry)throw problem('The saved mapping does not expose its original template file.');
 const response=await fetch(BASE+'/profiles/'+enc(id)+'/download/'+enc(entry.name),{headers:{Accept:'text/csv'}});
 if(!response.ok){let value;try{value=await response.json();}catch{}throw problem(value?.message??'The retained template could not be read.',response.status);}
 const blob=await response.blob();if(blob.size===0||blob.size>MAX_FILE)throw problem('The saved template exceeds the supported file size.');
 const buffer=await blob.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',buffer),sha=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
 if(sha!==profile.template.sha256)throw problem('The downloaded template differs from the selected mapping.');
 const dataBase64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(problem('The retained template could not be read.'));reader.readAsDataURL(blob);});
 const file={name:profile.template.name??'template.csv',dataBase64};await writeStored('file:template',file);files.set('template',file);fileLabel('template-selection',file);return file;
}
bind('refresh','click',async()=>{await refresh();if(field('source-handoff'))await loadHandoffRevisions();if(selectedPlan)await openPlan(selectedPlan);tell('Saved workspace refreshed.');});
bind('pending-check','click',checkPending);bind('pending-retry','click',sendPending);
bind('source-form','submit',async()=>{await switchSourceDraft();await loadSource(0);});
bind('source-handoff','change',async()=>{await loadHandoffRevisions('initial');await switchSourceDraft();updateSourceLabel();});
bind('source-revision','change',async()=>{await switchSourceDraft();updateSourceLabel();});
bind('source-filter','submit',()=>loadSource(0));
bind('source-prev','click',()=>loadSource(Math.max(0,sourceOffset-LIMIT)));
bind('source-next','click',()=>loadSource(sourceOffset+LIMIT));
$('source-rows').addEventListener('click',event=>{const button=event.target.closest('[data-movement]');if(button)reviewMovement(Number(button.dataset.movement));});
bind('movement-form','submit',async()=>{
 if(!selectedMovement)throw problem('Choose an original movement.');const r=selectedMovement,key=r.selectionId??r.movementId,action=field('movement-action');
 if(action){draft.decisions[key]={movementId:r.movementId,...(r.selectionId?{selectionId:r.selectionId}:{}),action,reason:field('movement-reason'),reference:field('movement-reference')};}
 else delete draft.decisions[key];
 await invalidate('plan');await retainDraft();renderSource();tell('The exact occurrence decision is retained in this source draft.');
});
bind('date-evidence-form','submit',async()=>{
 if(!selectedMovement)throw problem('Choose the original movement.');const r=selectedMovement,key=r.movementId,fileKey='date:'+key;
 await saveFile($('evidence-file'),fileKey);
 draft.dateEvidence[key]={movementId:r.movementId,transferAt:requireValue('evidence-at','the original UTC transfer timestamp'),note:requireValue('evidence-note','the date source note'),fileKey};
 await invalidate('plan');await retainDraft();updateSourceLabel();tell('The transfer date and original file are retained in this draft.');
});
bind('evidence-remove','click',async()=>{if(!selectedMovement)return;delete draft.dateEvidence[selectedMovement.movementId];await invalidate('plan');await retainDraft();$('evidence-at').value='';$('evidence-note').value='';$('evidence-file').value='';updateSourceLabel();});
bind('template-file','change',async()=>{const file=await saveFile($('template-file'),'template');fileLabel('template-selection',file);draft.template=null;draft.columns={};draft.constants={};renderTemplate();await invalidate('profile');await retainDraft();});
bind('template-inspect','click',async()=>{editable();const result=await inspectFile('template');draft.template=result.template;draft.suggestedColumns=result.suggestedColumns??{};draft.columns={...draft.suggestedColumns};draft.constants={};renderTemplate();await invalidate('profile');await retainDraft();tell('The exact template headers and order are ready for mapping.');});
bind('profile-use','click',async()=>{
 const id=field('profile-existing');if(!id)throw problem('Choose a saved mapping.');const value=await api('/profiles/'+enc(id)),profile=value.profile??value;
 await loadSavedProfileFile(id,profile,value);
 draft.previousProfileId=profile.id;draft.template=profile.template;draft.columns=profile.columns;draft.constants=profile.constants??{};
 $('profile-name').value=(profile.name??'Mapping')+' · next edition';
 for(const [id,key]of [['target-entity-name','entityName'],['target-entity-id','entityId'],['target-connection-name','connectionName'],['target-connection-id','connectionId'],['target-merchant','merchantAccount']])$(id).value=profile.target?.[key]??'';
 $('profile-date').value=profile.date?.format??'';$('profile-zone').value=profile.date?.timeZone??'';$('template-delimiter').value=profile.template?.delimiter??'';
 renderTemplate(profile.columns);renderAssets(profile.assets??[]);await invalidate('profile');await retainDraft();tell('The original template and mapping are ready as a new edition.');
});
bind('asset-add','click',async()=>{renderAssets([...readAssets(),{network:'',assetDigest:'',cryptoId:'',amountType:'',scale:''}]);await invalidate('profile');await retainDraft();});
bind('asset-source','click',async()=>{
 if(!source)await loadSource(0);const rows=readAssets(),keys=new Set(rows.map(row=>row.network+'\n'+row.assetDigest));
 for(const item of source.assetKeys??source.source?.assetKeys??[]){if(typeof item!=='object'||!item.network||!item.assetDigest)continue;const key=item.network+'\n'+item.assetDigest;if(!keys.has(key)){rows.push({network:item.network,assetDigest:item.assetDigest,cryptoId:'',amountType:'',scale:''});keys.add(key);}}
 renderAssets(rows);await invalidate('profile');await retainDraft();
});
$('asset-mappings').addEventListener('click',event=>{const button=event.target.closest('[data-remove-asset]');if(button)void act(async()=>{const rows=readAssets();rows.splice(Number(button.dataset.removeAsset),1);renderAssets(rows);await invalidate('profile');await retainDraft();});});
$('profile-columns').addEventListener('change',()=>{draft.columns=collectColumns('profile-role',[...roles,...extraRoles]);renderConstants();deferDraft();});
bind('profile-form','submit',async()=>{if(!draft.template)throw problem('Inspect the customer template first.');await prepare('profile','/profiles/preview',await profileRequest());});
bind('plan-form','submit',async()=>{planOffset=0;await prepare('plan','/plans/preview?limit='+LIMIT,await planRequest());});
bind('plan-prev','click',()=>loadPlanPage(planOffset-LIMIT));bind('plan-next','click',()=>loadPlanPage(planOffset+LIMIT));
bind('capture-plan-open','click',async()=>{await invalidate('capture');await invalidate('return');await openPlan(field('capture-plan'));});
bind('capture-plan','change',async()=>{selectedPlan=null;planDetail=null;await invalidate('capture');await invalidate('return');await invalidate('rollback');await retainDraft();});
bind('capture-file','change',async()=>{const file=await saveFile($('capture-file'),'capture');fileLabel('capture-selection',file);draft.captureTemplate=null;draft.captureColumns={};renderCaptureColumns();await invalidate('capture');await retainDraft();});
bind('capture-inspect','click',async()=>{editable();const result=await inspectFile('capture');draft.captureTemplate=result.template;draft.captureColumns=result.suggestedColumns??{};renderCaptureColumns();await invalidate('capture');await retainDraft();tell('The returned headers are ready for explicit layout mapping.');});
bind('capture-kind','change',async()=>{renderCaptureColumns(collectColumns('capture-role',receivedRoles));await invalidate('capture');await retainDraft();});
$('capture-columns').addEventListener('change',()=>{draft.captureColumns=collectColumns('capture-role',receivedRoles);deferDraft();});
bind('capture-form','submit',async()=>{captureOffset=0;const planId=requirePlan();$('capture-save').hidden=false;await prepare('capture','/plans/'+enc(planId)+'/captures/preview?limit='+LIMIT,await captureRequest(),{planId});});
bind('capture-prev','click',()=>loadCapturePage(captureOffset-LIMIT));bind('capture-next','click',()=>loadCapturePage(captureOffset+LIMIT));
$('capture-comparison').addEventListener('click',event=>{const button=event.target.closest('[data-compare]');if(button)detail('Returned record comparison',previews.capture?.items?.[Number(button.dataset.compare)]);});
bind('return-form','submit',async()=>{const planId=requirePlan();await prepare('return','/plans/'+enc(planId)+'/returns/preview',await returnRequest(),{planId});});
bind('rollback-capture','change',async()=>{if(!field('rollback-capture'))return;const value=await api('/plans/'+enc(requirePlan())+'/captures/'+enc(field('rollback-capture')));$('rollback-native-id').value=(value.capture??value.comparison??value).nativeImport?.id??'';await invalidate('rollback');await retainDraft();});
bind('rollback-form','submit',async()=>{
 editable();const planId=requirePlan(),next=await verifyWorkspace();
 const request={id:crypto.randomUUID(),captureId:requireValue('rollback-capture','a native capture'),nativeImportId:requireValue('rollback-native-id','the completed native import ID'),completedAt:requireValue('rollback-at','the native completion timestamp'),actor:actor(),reason:requireValue('rollback-reason','the rollback reason'),reference:requireValue('rollback-reference','the native completion reference')};
 await keepPreview('rollback',{request,workspaceRevision:next.revision,planId});
});
bind('saved-open','click',()=>openPlan(field('saved-plan')));
bind('saved-to-capture','click',async()=>{await openPlan(field('saved-plan'));tab('capture');});
bind('saved-to-next','click',async()=>{
 await openPlan(field('saved-plan'));const p=planDetail.plan;
 $('source-handoff').value=p.handoffId;await loadHandoffRevisions(p.accountantRevisionId);await switchSourceDraft();
 $('plan-profile').value=p.profileId;$('plan-previous').value=p.id;$('plan-name').value=p.name+' · next period';
 await invalidate('plan');updateSourceLabel();await retainDraft();tab('source');tell('The mapping and prior import coverage are selected. Choose the next period’s original handoff before preparing its import.');
});
$('saved-captures').addEventListener('click',event=>{const button=event.target.closest('[data-saved-capture]');if(button)void act(()=>openCapture(button.dataset.savedCapture));});
$('saved-returns').addEventListener('click',event=>{const button=event.target.closest('[data-saved-return]');if(button)detail('Original accountant return',(planDetail.returns??planDetail.record?.returns??[])[Number(button.dataset.savedReturn)]);});
$('saved-rollbacks').addEventListener('click',event=>{const button=event.target.closest('[data-saved-rollback]');if(button)detail('Completed native rollback',(planDetail.rollbacks??planDetail.record?.rollbacks??[])[Number(button.dataset.savedRollback)]);});
bind('packet-file','change',async()=>{await saveFile($('packet-file'),'packet');await invalidate('packet');await retainDraft();});
bind('packet-form','submit',async()=>{
 editable();const file=await saveFile($('packet-file'),'packet'),name=requireValue('packet-name','the receiving name'),operator=actor();
 const inspection=await api('/packets/inspect',{method:'POST',value:{file}}),next=await verifyWorkspace();
 await keepPreview('packet',{inspection,name,actor:operator,workspaceRevision:next.revision});
});
for(const kind of ['profile','plan','capture','return','rollback','packet'])bind(kind+'-save','click',()=>beginSave(kind));
document.addEventListener('click',event=>{const button=event.target.closest('[data-tab]');if(button)tab(button.dataset.tab);});
for(const [id,kind]of [['profile-form','profile'],['plan-form','plan'],['capture-form','capture'],['return-form','return'],['rollback-form','rollback'],['packet-form','packet']]){
 $(id).addEventListener('input',()=>{if(hydrating)return;void invalidate(kind).catch(error=>tell(error.message,true));deferDraft();});
 $(id).addEventListener('change',()=>{if(hydrating)return;void invalidate(kind).catch(error=>tell(error.message,true));deferDraft();});
}
document.addEventListener('input',event=>{if(event.target.matches('input,select,textarea'))deferDraft();});
$('actor').addEventListener('change',()=>{for(const kind of Object.keys(previews))void invalidate(kind).catch(error=>tell(error.message,true));});
$('detail-close').addEventListener('click',()=>$('detail-dialog').close());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')void retainDraft().catch(()=>{});});
window.addEventListener('pagehide',()=>{clearTimeout(writingTimer);void retainDraft().catch(()=>{});});
void act(async()=>{
 db=await openDatabase();
 const zones=typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('timeZone'):[];$('timezones').innerHTML=['UTC',...zones].map(zone=>'<option value="'+esc(zone)+'"></option>').join('');
 await refresh({first:true});tab(draft.tab??'source');
 if(draft.selectedPlan&&root.plans?.some(plan=>plan.id===draft.selectedPlan))await openPlan(draft.selectedPlan);
 if(field('source-handoff')){await switchSourceDraft();await loadSource(0);}
});
