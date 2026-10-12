// MIT. Complete seller/buyer operations on the original authenticated Research host.
const $=id=>document.getElementById(id),clone=value=>structuredClone(value),uid=()=>crypto.randomUUID(),
 now=()=>new Date().toISOString(),pretty=value=>JSON.stringify(value,null,2),BASE='/api/customer-commerce',
 tokenKey='research-dossiers-session:'+location.origin;
const state={token:sessionStorage.getItem(tokenKey)||'',workspaceId:null,instanceId:null,tab:'publications',
 selected:null,configuration:null,offset:0,snapshot:null,page:null,form:null,view:null,renderId:0};
const active=new Map(),writes=new Set(),writeErrors=new Map();
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('token')){state.token=fragment.get('token');sessionStorage.setItem(tokenKey,state.token);
 history.replaceState(null,'',location.pathname+location.search);}
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:message});};
const message=(text,error=false)=>{$('message').textContent=text;$('message').className=error?'error':'';};
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?
 Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const hash=value=>sha(new TextEncoder().encode(JSON.stringify(stable(value))));
const params=value=>{const q=new URLSearchParams();for(const [key,item]of Object.entries(value??{}))
 if(item!==undefined&&item!==null&&item!=='')q.set(key,String(item));return q.size?'?'+q.toString():'';};
const scope=()=>state.workspaceId+':';
let database;
function db(){return database??=new Promise((resolve,reject)=>{
 const request=indexedDB.open('research-customer-commerce-v1',1);
 request.onupgradeneeded=()=>request.result.createObjectStore('records',{keyPath:'key'});
 request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
async function transaction(mode,work){
 const connection=await db();return new Promise((resolve,reject)=>{
  const tx=connection.transaction('records',mode),store=tx.objectStore('records');let value;
  tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('Local save interrupted.'));
  work(store,next=>{value=next;});
 });
}
const get=key=>transaction('readonly',(store,set)=>{const r=store.get(key);r.onsuccess=()=>set(r.result);});
const put=value=>transaction('readwrite',store=>store.put(value));
const remove=key=>transaction('readwrite',store=>store.delete(key));
const rows=prefix=>transaction('readonly',(store,set)=>{const result=[],r=store.openCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'));
 r.onsuccess=()=>{const cursor=r.result;if(cursor){result.push(cursor.value);cursor.continue();}else set(result);};});
function retain(form){
 const value=clone({...form,updatedAt:now()}),operation=put(value).then(()=>writeErrors.delete(value.key),error=>{
  writeErrors.set(value.key,error);message('The working form could not be saved locally. Export its complete form before leaving. '+error.message,true);
 });
 writes.add(operation);operation.finally(()=>writes.delete(operation));return operation;
}
async function flush(){await Promise.all([...writes]);if(writeErrors.size)throw writeErrors.values().next().value;}
function el(tag,text,attributes={}){
 const node=document.createElement(tag);if(text!==undefined&&text!==null)node.textContent=String(text);
 for(const [key,value]of Object.entries(attributes))if(value!==undefined&&value!==null)node.setAttribute(key,String(value));return node;
}
function button(text,work,{disabled=false,primary=false}={}){
 const node=el('button',text,{type:'button',...(primary?{class:'primary'}:{})});node.disabled=disabled;
 node.addEventListener('click',()=>act(work));return node;
}
function section(title,parent=$('workspace')){const node=el('section');node.append(el('h2',title));parent.append(node);return node;}
function details(title,value,parent){
 const node=el('details'),summary=el('summary',title);node.append(summary);let shown=false;
 node.addEventListener('toggle',()=>{if(node.open&&!shown){node.append(el('pre',pretty(value)));shown=true;}});parent.append(node);return node;
}
function description(parent,values){
 const dl=el('dl');for(const [key,value]of Object.entries(values)){if(value===undefined||value===null)continue;
  dl.append(el('dt',key),el('dd',typeof value==='object'?pretty(value):value));}parent.append(dl);
}
async function act(work){try{await work();}catch(error){message(error.message??String(error),true);}}
async function api(path,{body,signal}={}){
 const response=await fetch(path,{method:body===undefined?'GET':'POST',redirect:'error',signal:signal??AbortSignal.timeout(900000),
  headers:{Authorization:'Bearer '+state.token,Accept:'application/json',
   ...(state.workspaceId?{'X-Research-Workspace-Id':state.workspaceId}:{}),
   ...(state.instanceId?{'X-Research-Instance-Id':state.instanceId}:{}),
   ...(body===undefined?{}:{'Content-Type':'application/json'})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
 const chunks=[];let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;
  need(bytes<=64*1024*1024,'The native response exceeds the full Research response limit.');chunks.push(chunk);}
 const raw=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
 catch{throw Object.assign(new Error('The original listener returned an incomplete response.'),{outcomeUnknown:body!==undefined});}
 if(!response.ok)throw Object.assign(new Error(value.error??'The original operation returned an error.'),value,
  {httpStatus:response.status,outcomeUnknown:value.outcomeUnknown??(body!==undefined&&response.status>=500)});
 return value;
}
async function allPages(path,query={}){
 const result=[];let offset=0,snapshot,revision=query.revision;
 for(;;){const page=await api(path+params({...query,offset,limit:100,snapshot,revision}));
  need(Array.isArray(page.items)&&page.offset===offset,'The original page selection changed.');
  result.push(...page.items);snapshot=page.snapshot??snapshot;revision=page.revision??revision;
  if(page.nextOffset===null)return result;
  need(page.nextOffset>offset,'The original page did not advance.');offset=page.nextOffset;
 }
}
function customerUrl(dossier){return '/customer-updates.html'+params({dossier});}
function nativeLink(parent,label,url){
 const parsed=new URL(url,location.origin);need(['http:','https:'].includes(parsed.protocol),'Original application URL is invalid.');
 const link=el('a',label,{href:parsed.href,target:'_blank',rel:'noopener noreferrer'});parent.append(link);return link;
}
function clearWorkspace(){const node=$('workspace');node.replaceChildren();return node;}
async function saveSelection(){if(state.workspaceId)await put({key:'selection:'+scope(),
 tab:state.tab,selected:state.selected,formKey:state.form?.key??null});}
async function go(tab,id=null,form=null){
 await flush();state.tab=tab;state.selected=id;state.form=form;state.view=null;state.offset=0;state.snapshot=null;
 await saveSelection();await render();
}
function fillField(parent,label,value,{kind='input',type='text',options,onChange,span=false,readOnly=false}={}){
 const wrapper=el('div',null,span?{class:'span2'}:{}),caption=el('label',label),control=el(kind);
 if(kind==='select'){
  for(const option of options??[])control.append(el('option',option.label,{value:option.value}));
 }else if(kind==='input')control.type=type;
 control.value=value??'';control.readOnly=readOnly;caption.append(control);wrapper.append(caption);parent.append(wrapper);
 if(onChange)control.addEventListener(kind==='select'?'change':'input',()=>onChange(control.value,control));
 return control;
}
async function newForm(type,data={}){
 const id=uid(),form={key:'form:'+scope()+id,id,type,workspaceId:state.workspaceId,createdAt:now(),updatedAt:now(),data:clone(data)};
 await put(form);return form;
}
function editForm(key,value){need(state.form,'Select a working form.');state.form.data[key]=value;retain(state.form);}
function formBar(parent,title){
 const bar=el('div',null,{class:'form-bar'});bar.append(el('h2',title),
  button('Export working form',()=>downloadJSON({schema:'sf88-research-commerce-working-form/v1',
   workspaceId:state.workspaceId,form:state.form},'research-commerce-working-form.json')));
 parent.append(bar);
}
function downloadJSON(value,name){
 const blob=new Blob([pretty(value)+'\n'],{type:'application/json'});downloadBlob(blob,name);
}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=el('a',null,{href:url,download:name});
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function operation(action,body,{replayOf}={}){
 await flush();const selected=clone(body),digest=await hash({action,body:selected}),key='request:'+scope()+digest+(replayOf?':'+uid():'');
 let saved=await get(key);
 if(!saved){saved={key,workspaceId:state.workspaceId,action,body:selected,digest,status:'PENDING',
  createdAt:now(),...(replayOf?{replayOf}:{})};await put(saved);}
 need(saved.digest===digest&&await hash({action:saved.action,body:saved.body})===digest,
  'The retained original request changed.');return dispatch(saved);
}
async function dispatch(record){
 if(active.has(record.key))return active.get(record.key);
 if(record.status==='COMPLETE')return record.result;
 const task=(async()=>{
  need(record.workspaceId===state.workspaceId,'Open the original Research workspace for this saved request.');
  record={...record,status:'PENDING',error:null};await put(record);
  message('The exact request is saved. The original operation is running; refresh and cancellation remain available.');
  try{
   const result=await api(BASE+'/'+record.action,{body:record.body});
   const id=record.action==='publications/prepare'||record.action==='purchases/receive'?record.body.requestId:record.body.id;
   need(result.schema==='sf88-research-customer-commerce/v1'&&result.id===id,'The original operation returned a different selection.');
   const complete={...record,status:'COMPLETE',result,completedAt:now()};
   await put(complete);message('Saved the complete original result.');return result;
  }catch(error){
   record={...record,status:error.outcomeUnknown===false?'REJECTED':'PENDING',
    error:error.code??error.message,outcomeUnknown:error.outcomeUnknown??true,
    native:error.researchCommerce??null,lastAttemptAt:now()};
   await put(record);throw error;
  }finally{active.delete(record.key);}
 })();active.set(record.key,task);return task;
}
async function savedAction(action,base,{key}={}){
 const formKey='native-action:'+scope()+(key??await hash({action,base}));let saved=await get(formKey);
 if(!saved){saved={key:formKey,body:{...clone(base),requestId:uid()}};await put(saved);}
 for(const [name,value]of Object.entries(base))need(JSON.stringify(saved.body[name])===JSON.stringify(value),
  'The saved action selects different original inputs.');
 const result=await operation(action,saved.body);return result;
}
async function downloadFile(kind,id,part){
 const path=BASE+'/'+kind+'/'+id+'/files/'+part,selection=await api(path+'?metadata=true'),file=selection.descriptor;
 need(selection.workspaceId===state.workspaceId&&selection.id===id&&selection.kind===kind&&selection.file===part&&
  file&&/^[a-f0-9]{64}$/.test(file.sha256),'The selected original file changed.');
 await put({key:'download:'+scope()+kind+':'+id+':'+part,selection,createdAt:now()});
 const response=await fetch(path,{headers:{Authorization:'Bearer '+state.token,'X-Research-Workspace-Id':state.workspaceId,
  'X-Research-Instance-Id':state.instanceId},redirect:'error',signal:AbortSignal.timeout(900000)});
 need(response.ok&&response.headers.get('x-content-sha256')===file.sha256&&
  response.headers.get('content-length')===String(file.bytes),'The original download response changed.');
 const chunks=[];let size=0;
 for await(const chunk of response.body){size+=chunk.length;need(size<=file.bytes,'The original file exceeds its selected size.');chunks.push(chunk);}
 need(size===file.bytes,'The original file is incomplete.');const blob=new Blob(chunks,{type:file.contentType});
 need(await sha(await blob.arrayBuffer())===file.sha256,'The original file checksum changed.');
 downloadBlob(blob,file.name);message('Downloaded '+file.name+' — '+file.bytes+' bytes.');
}
function filesPanel(parent,kind,id,parts){
 const bar=el('div',null,{class:'toolbar'});
 for(const part of parts)bar.append(button('Download '+part,()=>downloadFile(kind,id,part)));parent.append(bar);
}
function fileTable(parent,files){
 const table=el('table'),head=el('thead'),row=el('tr');
 for(const label of ['Original member','Bytes','SHA256'])row.append(el('th',label));head.append(row);table.append(head);
 const body=el('tbody');for(const file of files){const tr=el('tr');tr.append(el('td',file.name),el('td',file.bytes),el('td',file.sha256));body.append(tr);}
 table.append(body);parent.append(table);
}

async function publicationEditor(parent,form,ticket){
 formBar(parent,'Prepare a paid publication');
 parent.append(el('p','Choose one frozen customer delivery. Review retains its complete reports, editable dossier, and any selected original source workspace.'));
 const data=form.data,grid=el('div',null,{class:'grid'});parent.append(grid);
 const dossiers=await allPages('/api/dossiers');if(ticket!==state.renderId)return;
 fillField(grid,'Original dossier',data.dossierId,{kind:'select',
  options:[{value:'',label:'Select a dossier'},...dossiers.map(row=>({value:row.id,label:row.title??row.id}))],
  onChange:async value=>{editForm('dossierId',value);editForm('deliveryId','');editForm('revision','');await act(()=>render());}});
 let deliveries=[];
 if(data.dossierId)deliveries=await allPages('/api/dossiers/'+encodeURIComponent(data.dossierId)+'/customer-updates',{section:'deliveries'});
 if(ticket!==state.renderId)return;
 fillField(grid,'Frozen delivery',data.deliveryId,{kind:'select',
  options:[{value:'',label:'Select a frozen delivery'},...deliveries.map(row=>({value:row.id,
   label:(row.title??row.id)+' · saved revision '+row.revision}))],
  onChange:value=>{const row=deliveries.find(item=>item.id===value);editForm('deliveryId',value);editForm('revision',row?.revision??'');}});
 fillField(grid,'Existing merchant',data.merchant,{kind:'select',
  options:[{value:'',label:'Select configured checkout'},...state.configuration.merchants.map(row=>({value:row.id,label:row.label}))],
  onChange:value=>editForm('merchant',value)});
 fillField(grid,'Public title',data.title,{onChange:value=>editForm('title',value)});
 fillField(grid,'Public description',data.summary,{kind:'textarea',span:true,onChange:value=>editForm('summary',value)});
 fillField(grid,'Usage and delivery terms',data.usage,{kind:'textarea',span:true,onChange:value=>editForm('usage',value)});
 const source=el('details');source.append(el('summary','Include the complete original Europe PMC source workspace'));
 const sourceGrid=el('div',null,{class:'grid'});source.append(sourceGrid);parent.append(source);
 const toggle=el('input');toggle.type='checkbox';toggle.checked=!!data.sourceWorkspace;
 const label=el('label','Include original acquisition queries, response files, and source history');label.prepend(toggle);sourceGrid.append(label);
 toggle.addEventListener('change',()=>{editForm('sourceWorkspace',toggle.checked?
  {library:'original',actor:'',requestId:uid()}:null);act(()=>render());});
 if(data.sourceWorkspace){
  const update=(key,value)=>editForm('sourceWorkspace',{...state.form.data.sourceWorkspace,[key]:value});
  fillField(sourceGrid,'Original source library',data.sourceWorkspace.library,{onChange:value=>update('library',value)});
  fillField(sourceGrid,'Original source operator',data.sourceWorkspace.actor,{onChange:value=>update('actor',value)});
  fillField(sourceGrid,'Retained source export request ID',data.sourceWorkspace.requestId,{span:true,onChange:value=>update('requestId',value)});
 }
 const bar=el('div',null,{class:'toolbar'});parent.append(bar);
 bar.append(button('Review complete publication',async()=>{
  await flush();const selected=clone(form.data);
  need(selected.dossierId&&selected.deliveryId&&Number.isSafeInteger(selected.revision)&&selected.merchant&&selected.title?.trim(),
   'Select the original dossier, frozen delivery, configured merchant, and public title.');
  const body={requestId:selected.requestId,merchant:selected.merchant,dossierId:selected.dossierId,
   deliveryId:selected.deliveryId,revision:selected.revision,title:selected.title,summary:selected.summary??'',usage:selected.usage??'',
   sourceWorkspace:selected.sourceWorkspace??null};
  const result=await operation('publications/prepare',body);
  if(state.form?.key===form.key&&state.tab==='publications')await go('publications',result.id);
 },{primary:true}));
 bar.append(button('Create a new publication from this form',async()=>{
  const next=await newForm('publication',{...clone(form.data),requestId:uid()});await go('publications',null,next);
 }));
 const selected=deliveries.find(row=>row.id===data.deliveryId);
 if(selected){details('Original frozen delivery',selected,parent);if(selected.files)fileTable(parent,selected.files);}
}
async function publicationView(parent,view){
 parent.append(el('h2',view.review?.title??view.request?.title??view.id),el('p',view.status,{class:'status'}));
 const bar=el('div',null,{class:'toolbar'});bar.append(button('Refresh saved publication',()=>render()));parent.append(bar);
 const review=view.review;
 if(!review){
  parent.append(el('p','The original review is still being retained. Resume its exact request from Saved requests and forms.'));
  if(view.request)details('Original complete request',view.request,parent);return;
 }
 parent.append(el('p',review.summary),el('h3','Usage and delivery terms'),el('p',review.usage||'No additional usage text was supplied.'));
 description(parent,{'Original dossier':review.dossierId,'Frozen delivery':review.deliveryId,'Saved revision':review.revision,
  'Merchant':review.merchant.label,'Purchase resource':review.merchant.purchaseUrl,'Order reference':review.orderReference,
  'Archive bytes':review.archive.bytes,'Archive SHA256':review.archive.sha256,'Review SHA256':review.reviewSha256});
 details('Original merchant payment terms',review.merchant.payment,parent);
 fileTable(parent,review.files);
 const ready=el('div',null,{class:'summary'});
 ready.append(el('p','Enrollment registers this exact archive and the existing merchant terms in the native checkout receiver.'));
 if(view.status!=='ENROLLED')ready.append(button('Enroll this reviewed delivery',async()=>{
  const result=await operation('publications/enroll',{id:view.id,reviewSha256:review.reviewSha256});
  if(state.selected===view.id){state.view=result;await render();}
 },{primary:true}));
 else{
  ready.append(el('p','The original order is enrolled. Send publication.json to the buyer so the complete archive and order terms stay together.'));
  filesPanel(ready,'publications',view.id,['publication','handoff','archive']);
  details('Original enrollment result',view.result,ready);
 }
 parent.append(ready);nativeLink(parent,'Open original customer delivery',customerUrl(review.dossierId));
}
async function purchaseEditor(parent,form){
 formBar(parent,'Receive a seller publication');
 parent.append(el('p','Load the seller’s complete publication.json. The existing Buyer application will retain the original order and show its native payment approval.'));
 const grid=el('div',null,{class:'grid'});parent.append(grid);
 fillField(grid,'Existing Buyer application',form.data.buyer,{kind:'select',
  options:[{value:'',label:'Select configured Buyer'},...state.configuration.buyers.map(row=>({value:row.id,label:row.label}))],
  onChange:value=>editForm('buyer',value)});
 const file=fillField(grid,'Seller publication file','',{type:'file'});file.accept='.json,application/json';
 file.addEventListener('change',()=>act(async()=>{
  const selected=file.files[0];if(!selected)return;
  need(selected.size>0&&selected.size<=1024*1024,'Select the complete publication JSON, at most 1 MiB.');
  const bytes=new Uint8Array(await selected.arrayBuffer()),offer=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  need(offer.schema==='sf88-research-paid-publication/v1'&&offer.delivery&&offer.archive&&offer.handoff,
   'Select an original paid Research publication.');
  let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
  editForm('filename',selected.name);editForm('base64',btoa(binary));editForm('offer',offer);await render();
 }));
 if(form.data.offer){
  const offer=form.data.offer;parent.append(el('h3',offer.title),el('p',offer.summary));
  description(parent,{'Frozen delivery':offer.delivery.deliveryId,'Original dossier':offer.delivery.dossierId,
   'Saved revision':offer.delivery.revision,'Archive bytes':offer.archive.bytes,'Archive SHA256':offer.archive.sha256});
  details('Original merchant handoff and payment terms',offer.handoff,parent);
  fileTable(parent,offer.delivery.files);
 }
 parent.append(button('Receive this publication',async()=>{
  await flush();const data=clone(form.data);
  need(data.buyer&&data.base64&&data.filename,'Choose the configured Buyer and complete seller publication.');
  const result=await operation('purchases/receive',{requestId:data.requestId,buyer:data.buyer,filename:data.filename,base64:data.base64});
  if(state.form?.key===form.key&&state.tab==='purchases')await go('purchases',result.id);
 },{primary:true,disabled:!form.data.base64}));
}
async function buyerWorkingForm(id,view){
 const key='form:'+scope()+'buyer:'+id;let form=await get(key);
 if(!form){form={key,id:'buyer:'+id,type:'buyer',workspaceId:state.workspaceId,createdAt:now(),updatedAt:now(),
  data:{purchaseId:id,requestId:uid(),totalAtomic:'',dailyAtomic:'',claimEnv:'SF101_CLAIM_TOKEN',sourceActor:''}};
  await put(form);}
 return form;
}
async function purchaseView(parent,view,ticket){
 parent.append(el('h2',view.publication.title),el('p',view.status,{class:'status'}));
 const bar=el('div',null,{class:'toolbar'});parent.append(bar);
 bar.append(button('Refresh original buyer and approval',async()=>{
  const id=view.id,next=await api(BASE+'/purchases/'+id+'?refresh=true');
  if(state.selected===id&&state.tab==='purchases'){state.view=next;await render({retainedView:true});}
 }));
 if(view.buyerConnection?.url)nativeLink(bar,'Open original Buyer approval',view.buyerConnection.url);
 description(parent,{'Buyer':view.buyer.label,'Publication':view.publication.publicationId,
  'Original order':view.publication.handoff.orderReference,'Archive SHA256':view.publication.archive.sha256,
  'Archive bytes':view.publication.archive.bytes});
 parent.append(el('p',view.publication.summary),el('p',view.publication.usage||''));
 details('Original order and payment terms',view.publication.handoff,parent);
 const working=await buyerWorkingForm(view.id,view);
 if(ticket!==state.renderId)return;state.form=working;
 if(!view.prepared){
  const panel=section('Prepare the original acquisition',parent);
  panel.append(el('p','Refresh the original Buyer to load its current review revision. Enter budget limits in the asset’s atomic units and the existing claim environment variable name.'));
  const data=working.data,grid=el('div',null,{class:'grid'});panel.append(grid);
  fillField(grid,'Total budget, atomic units',data.totalAtomic,{onChange:value=>editForm('totalAtomic',value)});
  fillField(grid,'Daily budget, atomic units',data.dailyAtomic,{onChange:value=>editForm('dailyAtomic',value)});
  fillField(grid,'Existing buyer claim environment variable',data.claimEnv,{span:true,onChange:value=>editForm('claimEnv',value)});
  description(panel,{'Original paid-file revision':view.paidFile?.revision});
  panel.append(button('Prepare selected Buyer operation',async()=>{
   await flush();need(Number.isSafeInteger(view.paidFile?.revision),'Refresh the original Buyer before preparing its reviewed operation.');
   const data=clone(working.data),result=await operation('purchases/prepare',{id:view.id,requestId:data.requestId,
    expectedRevision:view.paidFile.revision,totalAtomic:data.totalAtomic,dailyAtomic:data.dailyAtomic,claimEnv:data.claimEnv});
   if(state.selected===view.id){state.view=await api(BASE+'/purchases/'+view.id+'?refresh=true');await render({retainedView:true});}
  },{primary:true,disabled:!Number.isSafeInteger(view.paidFile?.revision)}));
 }else{
  const prepared=view.prepared,panel=section('Original Buyer execution',parent);
  description(panel,{'Native run':prepared.runId,'Native operation':prepared.operationId,'Original payment intent':prepared.intentId,
   'Prepared selection':prepared.preparedSha256});
  panel.append(el('p','Start the original operation, then use its Buyer application to review the native approval. Refresh reads the same running execution and payment state.'));
  const controls=el('div',null,{class:'toolbar'});panel.append(controls);
  const perform=async kind=>{
   const selectedId=view.id,result=await savedAction('purchases/'+kind,{id:view.id,preparedSha256:prepared.preparedSha256});
   if(state.selected===selectedId&&state.tab==='purchases'){state.view=await api(BASE+'/purchases/'+selectedId+'?refresh=true');
    await render({retainedView:true});}return result;
  };
  controls.append(button('Start original purchase',()=>perform('execute'),{primary:true}));
  controls.append(button('Recover original run',()=>perform('recover')));
  controls.append(button('Retrieve purchased archive',()=>perform('retrieve')));
  controls.append(button('Finalize original operation',()=>perform('finalize')));
  if(view.run?.active&&!view.run.active.finishedAt&&view.run.active.executionId)
   controls.append(button('Cancel this running execution',async()=>{
    const executionId=view.run.active.executionId;
    await savedAction('purchases/cancel',{id:view.id,preparedSha256:prepared.preparedSha256,executionId},
     {key:'cancel:'+view.id+':'+executionId});
    if(state.selected===view.id){state.view=await api(BASE+'/purchases/'+view.id+'?refresh=true');await render({retainedView:true});}
   }));
  if(view.approval)details('Original approval state',view.approval,panel);
  if(view.run)details('Complete original run and payment state',view.run,panel);
  else panel.append(el('p','Refresh the original Buyer to inspect the current execution and approval.'));
  const receiving=section('Receive the complete customer workspace',parent);
  receiving.append(el('p','After retrieval, receive all frozen reports, the editable dossier, and the selected source workspace through the original Research receivers.'));
  fillField(receiving,'Source receiving operator, when an original source workspace is included',working.data.sourceActor,
   {onChange:value=>editForm('sourceActor',value)});
  receiving.append(button('Receive complete Research delivery',async()=>{
   await flush();const id=view.id,base={id,preparedSha256:prepared.preparedSha256,
    ...(working.data.sourceActor?{sourceActor:working.data.sourceActor}:{})};
   await savedAction('purchases/receive-dossier',base);
   if(state.selected===id){state.view=await api(BASE+'/purchases/'+id);await render({retainedView:true});}
  },{primary:true}));
 }
 if(view.received){
  const received=section('Received customer workspace',parent);
  description(received,{'Original delivery':view.received.nativeReceiving.deliveryId,
   'Saved revision':view.received.nativeReceiving.revision,'Receiving workspace':view.received.workspaceId});
  nativeLink(received,'Open received editable customer work',customerUrl(view.received.nativeReceiving.dossierId));
  filesPanel(received,'purchases',view.id,['publication','handoff','archive','received']);
  details('Complete original receiving result',view.received,received);
 }else filesPanel(parent,'purchases',view.id,['publication','handoff']);
 details('Original frozen delivery members',view.publication.delivery.files,parent);
}

async function importWorking(file){
 need(file&&file.size>0&&file.size<=2*1024*1024,'Select a complete working form, at most 2 MiB.');
 const packet=JSON.parse(await file.text());
 need(packet.schema==='sf88-research-commerce-working-form/v1'&&packet.workspaceId===state.workspaceId&&
  packet.form?.workspaceId===state.workspaceId&&['publication','purchase','buyer'].includes(packet.form.type)&&
  packet.form.data&&typeof packet.form.data==='object'&&!Array.isArray(packet.form.data),
  'Open the original Research workspace and select one of its complete working forms.');
 const original=clone(packet.form);
 if(original.type==='publication'){
  need(/^[a-f0-9-]{36}$/.test(original.data.requestId),'The original publication request ID is missing.');
  if(original.data.dossierId&&original.data.deliveryId){
   const rows=await allPages('/api/dossiers/'+encodeURIComponent(original.data.dossierId)+'/customer-updates',
    {section:'deliveries',revision:original.data.revision});
   const delivery=rows.find(row=>row.id===original.data.deliveryId);
   need(delivery?.revision===original.data.revision,'Receive the original dossier and selected delivery revision before opening this form.');
  }
 }else if(original.type==='buyer'){
  need(/^[a-f0-9-]{36}$/.test(original.data.purchaseId),'The original purchase ID is missing.');
  await api(BASE+'/purchases/'+original.data.purchaseId);
 }
 await flush();
 const imported=await newForm(original.type,original.data);
 imported.importedFrom={key:original.key,createdAt:original.createdAt,importedAt:now()};
 await put(imported);
 // Imported working data owns a separate durable form; an existing editor stays retained.
 if(original.type==='buyer'){
  state.tab='history';state.form=imported;state.selected=null;await saveSelection();await render();
  message('Imported the complete buyer working form as a separate retained draft. Open it from this history to review or apply its values.');
 }else await go(original.type==='publication'?'publications':'purchases',null,imported);
}
async function historyPanel(parent){
 parent.append(el('h2','Saved requests and working forms'),
  el('p','Each native request keeps its complete original input and first result. Working forms remain separate when you open another item.'));
 const imported=el('input',null,{type:'file',accept:'.json,application/json'});
 const importLabel=el('label','Receive a complete working form');importLabel.append(imported);parent.append(importLabel);
 imported.addEventListener('change',()=>act(()=>importWorking(imported.files[0])));
 const operations=(await rows('request:'+scope())).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const current=operations.slice(state.offset,state.offset+30);
 const pager=el('div',null,{class:'toolbar'});pager.append(el('span',operations.length+' saved requests'));
 pager.append(button('Newer',async()=>{state.offset=Math.max(0,state.offset-30);await render();},{disabled:state.offset===0}),
  button('Older',async()=>{state.offset+=30;await render();},{disabled:state.offset+30>=operations.length}));parent.append(pager);
 for(const record of current){
  const panel=el('section',null,{class:'summary'});panel.append(el('h3',record.action+' · '+record.status),
   el('p',record.createdAt,{class:'small'}));const actions=el('div',null,{class:'toolbar'});panel.append(actions);
  if(record.status!=='COMPLETE')actions.append(button('Resume this exact request',async()=>{
   await dispatch(record);await render();
  },{disabled:active.has(record.key)}));
  if(record.status==='COMPLETE')actions.append(button('Replay exact native request',async()=>{
   await operation(record.action,record.body,{replayOf:record.key});await render();
  }));
  actions.append(button('Export complete request and result',()=>downloadJSON(record,'research-commerce-request.json')));
  const id=record.action==='publications/prepare'||record.action==='purchases/receive'?record.body.requestId:record.body.id;
  actions.append(button('Open saved operation',()=>go(record.action.startsWith('publications/')?'publications':'purchases',id)));
  if(record.native?.originalRequestId&&record.action.startsWith('purchases/'))
   actions.append(button('Reconcile original Buyer request',async()=>{
    await savedAction('purchases/reconcile',{id,nativeRequestId:record.native.originalRequestId});
    message('The original Buyer request has been reconciled. Resume its saved Research request.');await render();
   }));
  if(record.error)panel.append(el('p',record.error,{class:'warning'}));
  details('Full retained input and first native result',record,panel);parent.append(panel);
 }
 const forms=(await rows('form:'+scope())).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 parent.append(el('h3','Retained working forms'));
 for(const form of forms){
  const panel=el('div',null,{class:'summary'}),bar=el('div',null,{class:'toolbar'});
  panel.append(el('strong',form.data.title??form.data.offer?.title??form.type),el('p',form.updatedAt,{class:'small'}),bar);
  bar.append(button('Open this working form',async()=>{
   if(form.type==='buyer'){
    const original=await buyerWorkingForm(form.data.purchaseId),preserved=clone(original);
    const preservedKey='form:'+scope()+uid();preserved.key=preservedKey;preserved.id=preservedKey.split(':').at(-1);
    preserved.updatedAt=now();preserved.preservedFrom=original.key;
    // Preserve the complete existing buyer form and apply the explicitly chosen one in one transaction.
    await flush();await transaction('readwrite',store=>{
     store.put(preserved);store.put({...original,data:clone(form.data),updatedAt:now()});
    });
    await go('purchases',form.data.purchaseId);
   }else await go(form.type==='publication'?'publications':'purchases',null,form);
  }));
  bar.append(button('Export complete form',()=>downloadJSON({schema:'sf88-research-commerce-working-form/v1',
   workspaceId:state.workspaceId,form},'research-commerce-working-form.json')));
  details('Working values',form.data,panel);parent.append(panel);
 }
 const downloads=await rows('download:'+scope());
 if(downloads.length){parent.append(el('h3','Original downloaded-file selections'));
  for(const record of downloads){const selection=record.selection,panel=el('div',null,{class:'summary'});
   panel.append(el('strong',selection.descriptor.name),el('p',selection.descriptor.sha256,{class:'small'}),
    button('Download the same original file',()=>downloadFile(selection.kind,selection.id,selection.file)));parent.append(panel);}
 }
}
function configurationPanel(parent){
 parent.append(el('h2','Existing merchant and Buyer connections'),
  el('p','The local Research launcher selects these original configuration files. Publishing and receiving use those same merchant and Buyer applications.'));
 description(parent,{'Research workspace':state.workspaceId,'Host configuration':state.configuration.configurationFile??'Not selected'});
 if(!state.configuration.configurationFile)parent.append(el('p',
  'Start the same Research workspace with --customer-commerce-host /private/research-commerce.json. The operator guide contains the complete native setup and host schema.',{class:'warning'}));
 for(const merchant of state.configuration.merchants){
  const panel=el('section',null,{class:'summary'});panel.append(el('h3',merchant.label));
  description(panel,{'Alias':merchant.id,'Original checkout':merchant.checkoutFile,'Purchase resource':merchant.purchaseUrl,
   'Claim environment':merchant.claimEnv,'Claim available':merchant.claimAvailable?'Yes':'No'});
  details('Exact original native payment terms',merchant.payment,panel);parent.append(panel);
 }
 for(const buyer of state.configuration.buyers){
  const panel=el('section',null,{class:'summary'});panel.append(el('h3',buyer.label));
  description(panel,{'Alias':buyer.id,'Original Buyer workspace':buyer.directory,'Selected source':buyer.selectionSha256,
   'File capacity':buyer.maximumFileBytes,'Export capacity':buyer.maximumExportBytes});parent.append(panel);
 }
 if(state.configuration.errors.length)details('Original connection errors',state.configuration.errors,parent);
 parent.append(button('Refresh configured connections',async()=>{
  state.configuration=await api(BASE+'/configuration');await render();
 }));
}
async function library(ticket){
 $('library-title').textContent=state.tab==='publications'?'Publications':state.tab==='purchases'?'Purchases':'Workspace';
 const parent=$('library'),pager=$('library-pages');parent.replaceChildren();pager.replaceChildren();
 if(!['publications','purchases'].includes(state.tab)){
  parent.append(el('p','Use the main panel to inspect saved requests, working forms, and selected connections.'));return;
 }
 const kind=state.tab;
 parent.append(button(kind==='publications'?'Prepare new publication':'Receive seller publication',async()=>{
  const type=kind==='publications'?'publication':'purchase',
   form=await newForm(type,{requestId:uid(),...(type==='publication'?{dossierId:'',deliveryId:'',revision:'',
    merchant:'',title:'',summary:'',usage:'',sourceWorkspace:null}:{buyer:'',filename:'',base64:'',offer:null})});
  await go(kind,null,form);
 },{primary:true}));
 const page=await api(BASE+'/'+kind+params({offset:state.offset,limit:30,snapshot:state.offset>0?state.snapshot:undefined}));
 if(ticket!==state.renderId)return;
 state.page=page;state.snapshot=page.snapshot;
 for(const row of page.items){
  const item=button('',()=>go(kind,row.id));item.className='item'+(row.id===state.selected?' selected':'');
  item.append(el('strong',row.title),el('span',row.status),el('span',row.createdAt));parent.append(item);
 }
 if(!page.items.length)parent.append(el('p','No saved '+kind+' in this page.',{class:'muted'}));
 if(page.errors.length)details('Original saved item errors',page.errors,parent);
 pager.append(button('Previous',async()=>{state.offset=Math.max(0,state.offset-30);await render();},{disabled:state.offset===0}),
  button('Next',async()=>{state.offset=page.nextOffset;await render();},{disabled:page.nextOffset===null}));
}
async function render({retainedView=false}={}){
 if(!state.workspaceId)return;
 const ticket=++state.renderId;
 document.querySelectorAll('[data-tab]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.tab===state.tab)));
 await library(ticket);if(ticket!==state.renderId)return;
 const parent=clearWorkspace();
 if(state.tab==='configuration'){configurationPanel(parent);return;}
 if(state.tab==='history'){await historyPanel(parent);return;}
 if(state.form&&!state.selected){
  if(state.form.type==='publication')await publicationEditor(parent,state.form,ticket);
  else if(state.form.type==='purchase')await purchaseEditor(parent,state.form);
  return;
 }
 if(!state.selected){
  parent.append(el('h2',state.tab==='publications'?'Publish a complete customer delivery':'Receive a paid customer delivery'),
   el('p',state.tab==='publications'?
    'Prepare a publication from a frozen delivery, review the original merchant terms, then enroll its complete archive.':
    'Receive the seller’s publication, prepare the original Buyer operation, complete its native approval, and reopen the editable Research delivery.'));
  return;
 }
 const kind=state.tab,id=state.selected;
 const view=retainedView&&state.view?.id===id?state.view:await api(BASE+'/'+kind+'/'+id);
 if(ticket!==state.renderId)return;state.view=view;
 if(kind==='publications')await publicationView(parent,view);else await purchaseView(parent,view,ticket);
}
async function connect(){
 await flush();state.token=$('token').value;need(state.token,'Enter the existing Research session token.');
 state.workspaceId=null;state.instanceId=null;
 const status=await api('/api/status');need(/^research_[a-f0-9]{64}$/.test(status.workspaceId)&&status.api?.customerCommerce,
  'Install the complete paid-delivery source in this original Research application.');
 state.workspaceId=status.workspaceId;state.instanceId=status.instanceId;
 sessionStorage.setItem(tokenKey,state.token);state.configuration=await api(BASE+'/configuration');
 const saved=await get('selection:'+scope());
 if(saved){state.tab=saved.tab;state.selected=saved.selected;state.form=saved.formKey?await get(saved.formKey):null;}
 else{state.tab='publications';state.selected=null;state.form=null;}
 $('identity').textContent='Original workspace '+state.workspaceId;
 message('Opened the original Research workspace.');await render();
}
$('token').value=state.token;
$('connect').addEventListener('click',()=>act(connect));
$('library-refresh').addEventListener('click',()=>act(async()=>{await flush();state.offset=0;state.snapshot=null;await render();}));
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>act(()=>go(button.dataset.tab))));
window.addEventListener('beforeunload',event=>{if(writes.size||writeErrors.size){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{if(state.form)retain(state.form);});
if(state.token)act(connect);
