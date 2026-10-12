// MIT. Complete Research quote workflow around the maintained SF74 commercial desk.
import {mountCommercialDesk} from './native/commercial-desk.mjs';
const $=id=>document.getElementById(id),copy=value=>structuredClone(value),uuid=()=>crypto.randomUUID(),
 now=()=>new Date().toISOString(),pretty=value=>JSON.stringify(value,null,2),BASE='/api/customer-quotes',
 tokenKey='research-dossiers-session:'+location.origin,MAX_RESPONSE=64*1024*1024,MAX_FILE=256*1024*1024;
const state={token:sessionStorage.getItem(tokenKey)||'',workspaceId:null,instanceId:null,configuration:null,
 tab:'cases',caseId:null,form:null,operationId:null,operation:null,caseOffset:0,caseQuery:'',actor:{id:'',name:''},serial:0};
const writes=new Set(),writeErrors=new Map(),active=new Map();let database,nativeDesk=null,admissions=0,connecting=false;
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?
 Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const hash=value=>sha(new TextEncoder().encode(JSON.stringify(stable(value))));
const params=value=>{const q=new URLSearchParams();for(const [key,item]of Object.entries(value??{}))
 if(item!==undefined&&item!==null&&item!=='')q.set(key,String(item));return q.size?'?'+q.toString():'';};
const scope=()=>state.workspaceId+':',message=(value,error=false)=>{$('message').textContent=value;$('message').className=error?'error':'';};
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('token')){state.token=fragment.get('token');sessionStorage.setItem(tokenKey,state.token);
 history.replaceState(null,'',location.pathname+location.search);}
function db(){return database??=new Promise((resolve,reject)=>{
 const request=indexedDB.open('research-customer-quotes-v1',1);
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
const rows=prefix=>transaction('readonly',(store,set)=>{const values=[],r=store.openCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'));
 r.onsuccess=()=>{const cursor=r.result;if(cursor){values.push(cursor.value);cursor.continue();}else set(values);};});
function retain(value){
 const selected=copy(value),work=put(selected).then(()=>writeErrors.delete(selected.key),error=>{
  writeErrors.set(selected.key,error);message('The complete working form could not be saved locally. Export it before leaving. '+error.message,true);
 });writes.add(work);work.finally(()=>writes.delete(work));return work;
}
async function flush(){await Promise.all([...writes]);if(writeErrors.size)throw writeErrors.values().next().value;}
function edit(key,value){
 need(state.form,'Open a working form.');state.form.data[key]=copy(value);state.form.updatedAt=now();retain(state.form);
}
function selection(){return {key:'selection:'+scope(),tab:state.tab,caseId:state.caseId,formKey:state.form?.key??null,
 operationId:state.operationId,actor:copy(state.actor)};}
function actor(){need(state.actor.id.trim()&&state.actor.name.trim(),'Enter the operator ID and recorded-by name.');return copy(state.actor);}
function headerOptions(body){return {method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(900000),
 headers:{Authorization:'Bearer '+state.token,Accept:'application/json',
  ...(state.workspaceId?{'X-Research-Workspace-Id':state.workspaceId}:{}),
  ...(state.instanceId?{'X-Research-Instance-Id':state.instanceId}:{}),
  ...(body===undefined?{}:{'Content-Type':'application/json'})},
 ...(body===undefined?{}:{body:JSON.stringify(body)})};}
async function api(path,{body}={}){
 const response=await fetch(path,headerOptions(body)),chunks=[];let length=0;
 for await(const chunk of response.body){length+=chunk.length;need(length<=MAX_RESPONSE,'The native response exceeds its complete response limit.');chunks.push(chunk);}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
 catch{throw Object.assign(new Error('The original listener returned an incomplete response.'),{outcomeUnknown:body!==undefined});}
 if(!response.ok)throw Object.assign(new Error(value.error??'The original operation returned an error.'),value,
  {httpStatus:response.status,outcomeUnknown:value.outcomeUnknown??(body!==undefined&&response.status>=500)});
 return value;
}
async function pages(path,query={}){
 const items=[];let offset=0,snapshot,revision=query.revision;
 for(;;){
  const page=await api(path+params({...query,offset,limit:100,snapshot,revision}));
  need(Array.isArray(page.items)&&page.offset===offset,'The selected native history page changed.');
  items.push(...page.items);need(items.length<=100000,'The complete selected history exceeds the original reader limit.');
  snapshot=page.snapshot??snapshot;revision=page.revision??revision;
  if(page.nextOffset===null)return {items,revision,snapshot};
  need(page.nextOffset>offset,'The original history did not advance.');offset=page.nextOffset;
 }
}
async function customer(dossierId,section,extra={}){
 return pages('/api/dossiers/'+encodeURIComponent(dossierId)+'/customer-updates',{section,...extra});
}
function dispatch(route,body,options={}){
 need(!connecting&&state.workspaceId,'Wait for the original workspace to finish opening.');
 admissions++;const result=dispatchAdmitted(route,copy(body),options);
 return result.finally(()=>{admissions--;});
}
async function dispatchAdmitted(route,body,{replay=false,recordKey}={}){
 await flush();const selected=copy(body),inputSha256=await hash({route,body:selected}),
  key=recordKey??'request:'+scope()+inputSha256;
 if(active.has(key))return active.get(key);
 const operation=(async()=>{
  let record=await get(key);
  if(record)need(record.workspaceId===state.workspaceId&&record.route===route&&same(record.body,selected)&&
   record.inputSha256===inputSha256,'This saved request belongs to different inputs.');
  else record={key,schema:'sf88-research-quote-browser-request/v1',workspaceId:state.workspaceId,
   route,body:selected,inputSha256,createdAt:now(),attempts:0,status:'PENDING',firstResult:null,lastResult:null};
  if(record.status==='COMPLETE'&&!replay)return copy(record.firstResult);
  record={...record,status:'PENDING',attempts:record.attempts+1,lastAttempt:now()};await put(record);
  let result;
  try{result=await api(BASE+route,{body:selected});}
  catch(error){
   const retained={...record,status:error.outcomeUnknown===false?'REJECTED':'PENDING',
    error:{message:error.message,code:error.error??error.code??null,outcomeUnknown:error.outcomeUnknown!==false}};
   try{await put(retained);}catch(storageError){message('The original request remains saved; its latest error could not be recorded. '+storageError.message,true);}
   throw error;
  }
  const saved={...record,status:'COMPLETE',firstResult:record.firstResult??copy(result),lastResult:copy(result),
   completedAt:record.completedAt??now(),lastCompletedAt:now(),error:null};
  await put(saved);return result;
 })();active.set(key,operation);
 try{return await operation;}finally{active.delete(key);}
}
async function act(work){try{await work();}catch(error){message(error.message??String(error),true);}}
function node(tag,text,attributes={}){
 const result=document.createElement(tag);if(text!==undefined&&text!==null)result.textContent=String(text);
 for(const [key,value]of Object.entries(attributes))if(value!==undefined&&value!==null)result.setAttribute(key,String(value));return result;
}
function button(label,work,{disabled=false,primary=false}={}){
 const result=node('button',label,{type:'button',...(primary?{class:'primary'}:{})});result.disabled=disabled;
 result.addEventListener('click',()=>act(work));return result;
}
function panel(parent,title){
 const result=node('section');if(title)result.append(node('h2',title));parent.append(result);return result;
}
function details(parent,label,value){
 const result=node('details'),heading=node('summary',label);result.append(heading);let loaded=false;
 result.addEventListener('toggle',()=>{if(result.open&&!loaded){result.append(node('pre',pretty(value)));loaded=true;}});
 parent.append(result);return result;
}
function description(parent,value){
 const dl=node('dl');for(const [key,item]of Object.entries(value))if(item!==undefined&&item!==null)
  dl.append(node('dt',key),node('dd',typeof item==='object'?pretty(item):item));parent.append(dl);
}
function field(parent,label,value,{type='text',kind='input',options=[],change,span=false,readOnly=false}={}){
 const wrapper=node('div',null,span?{class:'span2'}:{}),input=node(kind),identity='field-'+uuid(),name=node('label',label,{for:identity});
 input.id=identity;if(kind==='input')input.type=type;if(kind==='textarea')input.rows=4;
 if(kind==='select')for(const option of options)input.append(node('option',option.label,{value:option.value}));
 input.value=value??'';input.readOnly=readOnly;wrapper.append(name,input);parent.append(wrapper);
 if(change)input.addEventListener(kind==='select'?'change':'input',()=>{const result=change(input.value);if(result?.catch)result.catch(error=>message(error.message,true));});
 return input;
}
function toolbar(parent){const bar=node('div',null,{class:'toolbar'});parent.append(bar);return bar;}
function link(parent,label,path){
 const a=node('a',label,{href:path,target:'_blank',rel:'noopener noreferrer'});parent.append(a);return a;
}
function saveJSON(value,name){
 const blob=new Blob([pretty(value)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=node('a',null,{href:url,download:name});
 a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function completeFile(route,{body,descriptor}={}){
 const response=await fetch(BASE+route,headerOptions(body));
 if(!response.ok){let value;try{value=await response.json();}catch{}throw new Error(value?.error??'The original download failed.');}
 need(response.headers.get('x-content-sha256')===descriptor.sha256&&
  Number(response.headers.get('content-length'))===descriptor.bytes&&descriptor.bytes<=MAX_FILE,'The original file descriptor changed.');
 const chunks=[];let count=0;
 for await(const chunk of response.body){count+=chunk.length;need(count<=descriptor.bytes,'The original download grew.');chunks.push(chunk);}
 need(count===descriptor.bytes,'The original download was interrupted.');
 const blob=new Blob(chunks,{type:descriptor.contentType});
 need(await sha(await blob.arrayBuffer())===descriptor.sha256,'The complete file checksum changed.');
 return blob;
}
async function downloadFile(id,name){
 const selected=await api(BASE+'/operations/'+id+'/files/'+name+'?metadata=true');
 await put({key:'download:'+scope()+id+':'+name,selection:copy(selected),createdAt:now()});
 const blob=await completeFile('/operations/'+id+'/files/'+name,{descriptor:selected.descriptor}),
  url=URL.createObjectURL(blob),a=node('a',null,{href:url,download:selected.descriptor.name});
 a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function originalCaseDownload(caseId,kind,args){
 const route='/cases/'+caseId+'/'+kind,selected=await api(BASE+route+'?metadata=true',{body:args});
 const request={...copy(args),revision:args.revision??selected.case.revision},descriptor=selected.descriptor;
 return {descriptor:{...descriptor,filename:descriptor.name,mediaType:descriptor.contentType},
  response:await fetch(BASE+route,headerOptions(request))};
}
async function newForm(kind,data={}){
 await flush();const requestId=uuid(),value={key:'form:'+scope()+uuid(),schema:'sf88-research-quote-working-form/v1',
  workspaceId:state.workspaceId,kind,createdAt:now(),updatedAt:now(),data:{requestId,...copy(data)}};
 await put(value);return value;
}
async function go(tab,{form=null,operationId=null,caseId=state.caseId}={}){
 await flush();nativeDesk?.destroy();nativeDesk=null;state.tab=tab;state.form=form;state.operationId=operationId;
 state.operation=null;state.caseId=caseId;await put(selection());await render();
}
function operatorFields(parent){
 const grid=node('div',null,{class:'grid'});parent.append(grid);
 field(grid,'Operator ID',state.actor.id,{change:value=>{state.actor.id=value;retain(selection());}});
 field(grid,'Recorded by',state.actor.name,{change:value=>{state.actor.name=value;retain(selection());}});
}
function formBar(parent,form,title){
 parent.append(node('h2',title),node('p','Working request '+form.data.requestId,{class:'small'}));
 const bar=toolbar(parent);
 bar.append(button('Export complete working form',async()=>{await flush();saveJSON(copy(form),'research-quote-working-form.json');}),
  button('Create another request from these values',async()=>{
   const next=await newForm(form.kind,{...copy(form.data),requestId:uuid()});await go(form.kind==='case'?'cases':form.kind,{form:next});
  }));
}
async function showOperation(result){
 need(result?.id,'The original native operation did not return its retained ID.');
 const tab={BRIEF:'brief',RESPONSE:'response',PUBLICATION:'publication',REALIZED:'report',CASE:'cases'}[result.kind]??'history';
 if(result.kind==='CASE'&&result.result?.caseId)await go('cases',{caseId:result.result.caseId});
 else await go(tab,{operationId:result.id});
}
async function chooseNew(kind,data={}){
 const defaults={brief:{caseId:state.caseId??'',caseRevision:'',quoteId:'',quoteSha256:'',dossierId:'',revision:'',
   projectId:'',briefId:'',merchant:'',scope:{component:'IMPLEMENTATION',unit:'one complete customer delivery',note:''},reason:''},
  response:{bindingId:'',caseRevision:'',responseId:'',revision:'',by:{id:'',name:''}},
  publication:{bindingId:'',dossierId:'',revision:'',deliveryId:'',title:'',summary:'',usage:'',sourceWorkspace:null},
  report:{bindingId:'',publicationId:'',purchaseIds:[],revision:'',pricing:null}};
 const form=await newForm(kind,{...defaults[kind],...copy(data)});await go(kind,{form});
}

async function nativeCaseAction(caseId,action,args){
 const selected=copy(args),route='/cases/'+caseId+'/'+action,mutating=[
  'save-draft','publish','receive','receive-pricing','adopt-implementation','receiving-capture','receiving-attach',
  'receiving-restore','tariff-capture','tariff-attach','tariff-restore'].includes(action);
 if(['save-draft','publish','receive','receive-pricing'].includes(action)&&selected.actor===undefined){
  const key='native-actor:'+scope()+caseId+':'+action+':'+selected.requestId;let retained=await get(key);
  if(retained)need(same(retained.args,selected),'The original native request inputs changed.');
  else{retained={key,args:copy(selected),actor:actor().name};await put(retained);}
  selected.actor=retained.actor;
 }
 const result=mutating?await dispatch(route,selected):await api(BASE+route,{body:selected});
 need(result.workspaceId===state.workspaceId&&result.caseId===caseId,'The native result belongs to another case.');
 return result.result;
}
async function mountCase(parent,caseId){
 const original=caseId,host=node('div',null,{class:'native-case'});parent.append(host);
 const actions={preview:'preview',saveDraft:'save-draft',publish:'publish',compare:'compare',receive:'receive',receivePricing:'receive-pricing',
  previewImplementation:'preview-implementation',adoptImplementation:'adopt-implementation',
  receivingStatus:'receiving-status',receivingCapture:'receiving-capture',receivingInspect:'receiving-inspect',
  receivingAttach:'receiving-attach',receivingCase:'receiving-case',receivingRestore:'receiving-restore',
  tariffStatus:'tariff-status',tariffCatalog:'tariff-catalog',tariffSelection:'tariff-selection',tariffCapture:'tariff-capture',
  tariffInspect:'tariff-inspect',tariffAttach:'tariff-attach',tariffCase:'tariff-case',tariffRestore:'tariff-restore'};
 const services={read:async()=>{
   const value=await api(BASE+'/cases/'+original);need(value.workspaceId===state.workspaceId&&value.caseId===original,
    'The original case connection changed.');return value.result;
  },download:args=>originalCaseDownload(original,'download',args),
  tariffDownload:args=>originalCaseDownload(original,'tariff-download',args)};
 for(const [name,action]of Object.entries(actions))services[name]=args=>{
  need(args.scope?.caseId===original,'The original quotation case changed.');return nativeCaseAction(original,action,args);
 };
 nativeDesk=mountCommercialDesk({root:host,services});await nativeDesk.connect();
}
async function researchFields(parent,form,ticket,{label='Original customer project'}={}){
 const data=form.data,grid=node('div',null,{class:'grid'});parent.append(grid);
 const dossiers=await pages('/api/dossiers');if(ticket!==state.serial)return null;
 field(grid,'Original Research dossier',data.dossierId,{kind:'select',options:[{value:'',label:'Select a saved dossier'},
  ...dossiers.items.map(row=>({value:row.id,label:row.title??row.id}))],change:async value=>{
   edit('dossierId',value);edit('revision','');edit('projectId','');edit('briefId','');await render();
  }});
 if(!data.dossierId)return null;
 const source=await customer(data.dossierId,'projects',Number.isSafeInteger(data.revision)?{revision:data.revision}:{});
 if(ticket!==state.serial)return null;
 if(!Number.isSafeInteger(data.revision))edit('revision',source.revision);
 field(grid,label,data.projectId,{kind:'select',options:[{value:'',label:'Select the commissioned project'},
  ...source.items.map(row=>({value:row.id,label:row.name+' · '+row.customer.name}))],change:async value=>{
   const project=source.items.find(row=>row.id===value);edit('projectId',value);edit('briefId',project?.currentBriefId??'');await render();
  }});
 const project=source.items.find(row=>row.id===data.projectId);
 description(parent,{'Selected Research revision':data.revision,'Selected brief':data.briefId||null});
 toolbar(parent).append(button('Use current Research edition',async()=>{
  const current=await customer(data.dossierId,'projects'),row=current.items.find(item=>item.id===data.projectId);
  edit('revision',current.revision);edit('briefId',row?.currentBriefId??'');await render();
 }));
 if(!project)return null;
 const briefs=await customer(data.dossierId,'briefs',{revision:data.revision,projectId:project.id});
 if(ticket!==state.serial)return null;
 const brief=briefs.items.find(row=>row.id===data.briefId);
 if(brief)details(parent,'Complete original customer brief',brief);
 link(parent,'Open original customer work','/customer-updates.html'+params({dossier:data.dossierId}));
 return {project,brief,revision:data.revision};
}
async function createCaseEditor(parent,form,ticket){
 formBar(parent,form,'Create a case for the existing Research project');
 parent.append(node('p','This creates the original merchant case from the selected customer brief. Prepare and publish its quote in the full editor below.'));
 const source=await researchFields(parent,form,ticket);if(ticket!==state.serial)return;
 description(parent,{'New case ID':form.data.caseId});operatorFields(parent);
 toolbar(parent).append(button('Create and open original case',async()=>{
  need(source?.brief,'Select the original project and brief.');await flush();
  const body={requestId:form.data.requestId,caseId:form.data.caseId,dossierId:form.data.dossierId,
   revision:form.data.revision,projectId:form.data.projectId,briefId:form.data.briefId,actor:actor()};
  const result=await dispatch('/cases/create',body);await showOperation(result);
 },{primary:true}));
}
async function casesPanel(parent,ticket){
 if(state.form?.kind==='case')return createCaseEditor(panel(parent),state.form,ticket);
 const library=panel(parent,'Cases and quotations'),bar=toolbar(library);
 field(library,'Search existing case names, customers, owners, and work',state.caseQuery,{change:value=>{state.caseQuery=value;}});
 bar.append(button('Search cases',async()=>{state.caseOffset=0;await render();}),
  button('Create case from Research project',async()=>{
   const form=await newForm('case',{caseId:uuid(),dossierId:'',revision:'',projectId:'',briefId:''});await go('cases',{form});
  }));
 const value=await api(BASE+'/cases'+params({q:state.caseQuery,offset:state.caseOffset,limit:20}));if(ticket!==state.serial)return;
 const page=value.result,list=node('div',null,{class:'list'});library.append(list);
 for(const row of page.cases){
  const item=button('',()=>go('cases',{caseId:row.id}));item.className='case-row';
  item.append(node('strong',row.name),node('span',row.metadata.merchant+' · '+row.metadata.status));list.append(item);
 }
 if(!page.cases.length)list.append(node('p','No original cases match this page.'));
 const pager=toolbar(library);
 pager.append(button('Previous',async()=>{state.caseOffset=Math.max(0,state.caseOffset-20);await render();},{disabled:state.caseOffset===0}),
  button('Next',async()=>{state.caseOffset=page.nextOffset;await render();},{disabled:page.nextOffset===null}));
 if(page.unavailable.length)details(library,'Original unavailable case entries',page.unavailable);
 const opening=node('div',null,{class:'grid'});library.append(opening);
 let entered=state.caseId??'';field(opening,'Open an existing case UUID',entered,{change:value=>{entered=value;}});
 toolbar(opening).append(button('Open this case',()=>go('cases',{caseId:entered.trim()})));
 if(!state.caseId)return;
 const context=panel(parent,'Selected quotation workspace');description(context,{'Case':state.caseId});operatorFields(context);
 const actions=toolbar(context);
 actions.append(button('Use a saved quote in the customer brief',()=>chooseNew('brief',{caseId:state.caseId})),
  button('Review retained quote responses',()=>chooseNew('response')),
  button('Publish a delivery under its quote',()=>chooseNew('publication')));
 await mountCase(parent,state.caseId);
}
async function bindingField(parent,form,ticket){
 const result=await pages(BASE+'/operations',{kind:'BRIEF'});if(ticket!==state.serial)return null;
 const choices=result.items.filter(row=>row.status==='COMPLETE'),data=form.data;
 field(parent,'Applied customer quote',data.bindingId,{kind:'select',
  options:[{value:'',label:'Select the applied original quote'},...choices.map(row=>({value:row.id,
   label:row.createdAt+' · '+(row.dossierId??row.caseId??row.id)}))],change:async value=>{
   edit('bindingId',value);
   for(const key of ['caseRevision','responseId','revision','deliveryId','dossierId','publicationId'])
    if(Object.hasOwn(form.data,key))edit(key,'');
   if(Object.hasOwn(form.data,'purchaseIds'))edit('purchaseIds',[]);await render();
  }});
 if(!data.bindingId)return null;
 const binding=await api(BASE+'/operations/'+data.bindingId);if(ticket!==state.serial)return null;
 need(binding.kind==='BRIEF'&&binding.status==='COMPLETE','Select an applied original customer quote.');
 const review=binding.review;
 description(parent,{'Quotation':review.quote.title,'Customer':review.quote.draft.customer.name,
  'Case':review.selection.caseId,'Original quote amount':review.brief.scope,
  'Published brief':binding.result.native.operation.result.brief.id,'Merchant':review.merchant.view.label});
 details(parent,'Original compiled merchant terms',review.merchant.view.payment);
 toolbar(parent).append(button('Open original quotation case',()=>go('cases',{caseId:review.selection.caseId})));
 return binding;
}
async function briefEditor(parent,form,ticket){
 formBar(parent,form,'Apply a saved quotation to the customer brief');
 parent.append(node('p','Choose the original quote edition and the scope component it prices. The native checkout remains the source for payment terms.'));
 const data=form.data,caseGrid=node('div',null,{class:'grid'});parent.append(caseGrid);
 field(caseGrid,'Saved case UUID',data.caseId,{change:value=>{edit('caseId',value);edit('caseRevision','');edit('quoteId','');edit('quoteSha256','');}});
 toolbar(caseGrid).append(button('Load selected case',()=>render()));
 let selectedCase=null;
 if(data.caseId){
  const value=await api(BASE+'/cases/'+data.caseId+params({revision:data.caseRevision||undefined}));if(ticket!==state.serial)return;
  selectedCase=value.result;if(!data.caseRevision)edit('caseRevision',selectedCase.revision);
  field(caseGrid,'Original quote edition',data.quoteId,{kind:'select',options:[{value:'',label:'Select a published quote'},
   ...selectedCase.quotes.map(row=>({value:row.id,label:row.title+' · '+row.createdAt}))],change:async value=>{
    const quote=selectedCase.quotes.find(row=>row.id===value);edit('quoteId',value);edit('quoteSha256',quote?.sha256??'');await render();
   }});
  toolbar(parent).append(button('Use current saved case',async()=>{edit('caseRevision','');await render();}),
   button('Open full quotation editor',()=>go('cases',{caseId:data.caseId})));
  description(parent,{'Selected case revision':data.caseRevision});
  const quote=selectedCase.quotes.find(row=>row.id===data.quoteId);if(quote)details(parent,'Complete selected native quotation',quote);
 }
 const original=await researchFields(parent,form,ticket);if(ticket!==state.serial)return;
 const grid=node('div',null,{class:'grid'});parent.append(grid);
 const merchants=state.configuration.merchants.items;
 field(grid,'Existing checkout merchant',data.merchant,{kind:'select',options:[{value:'',label:'Select the existing merchant'},
  ...merchants.map(row=>({value:row.id,label:row.label}))],change:value=>edit('merchant',value)});
 field(grid,'Quoted scope component',data.scope.component,{kind:'select',options:[
  {value:'IMPLEMENTATION',label:'Implementation total'},{value:'RECURRING',label:'Monthly service and planned route usage'},
  {value:'ROUTE_USAGE',label:'Planned route usage only'},{value:'KEEP',label:'Keep the complete original brief scope'}],
  change:async value=>{edit('scope',{...data.scope,component:value});await render();}});
 field(grid,'Billing unit for this customer scope',data.scope.unit,{change:value=>edit('scope',{...data.scope,unit:value})});
 field(grid,'Scope and billing note',data.scope.note,{kind:'textarea',span:true,change:value=>edit('scope',{...data.scope,note:value})});
 field(grid,'Reason for the revised customer brief',data.reason,{kind:'textarea',span:true,change:value=>edit('reason',value)});
 operatorFields(parent);
 toolbar(parent).append(button('Review exact customer quote',async()=>{
  need(original?.brief&&data.quoteId&&data.merchant,'Select the quote, customer project, and existing merchant.');await flush();
  const body={...copy(data),actor:actor()};await showOperation(await dispatch('/prepare',body));
 },{primary:true}));
}
async function responseEditor(parent,form,ticket){
 formBar(parent,form,'Receive the actual customer quotation response');
 parent.append(node('p','Record the customer reply in the original quotation editor, then select that saved response here to update the Research agreement.'));
 const binding=await bindingField(parent,form,ticket);if(ticket!==state.serial||!binding)return;
 const data=form.data,selection=binding.review.selection,
  selected=await api(BASE+'/cases/'+selection.caseId+params({revision:data.caseRevision||undefined}));
 if(ticket!==state.serial)return;
 if(!data.caseRevision)edit('caseRevision',selected.result.revision);
 const quote=selected.result.quotes.find(row=>row.id===selection.quoteId&&row.sha256===selection.quoteSha256);
 const grid=node('div',null,{class:'grid'});parent.append(grid);
 field(grid,'Saved original customer response',data.responseId,{kind:'select',options:[{value:'',label:'Select a saved response'},
  ...(quote?.receiving??[]).map(row=>({value:row.id,label:row.status+' · '+row.observedAt}))],change:async value=>{edit('responseId',value);await render();}});
 const response=quote?.receiving.find(row=>row.id===data.responseId);if(response)details(parent,'Original response and source',response);
 toolbar(parent).append(button('Use current case responses',async()=>{edit('caseRevision','');await render();}));
 const current=await customer(selection.dossierId,'projects',Number.isSafeInteger(data.revision)?{revision:data.revision}:{});
 if(ticket!==state.serial)return;if(!Number.isSafeInteger(data.revision))edit('revision',current.revision);
 field(grid,'Customer contact ID',data.by.id,{change:value=>edit('by',{...data.by,id:value})});
 field(grid,'Customer contact name',data.by.name,{change:value=>edit('by',{...data.by,name:value})});
 description(parent,{'Selected Research revision':data.revision,'Selected case revision':data.caseRevision});operatorFields(parent);
 toolbar(parent).append(button('Use current Research revision',async()=>{edit('revision','');await render();}),
  button('Review original customer response',async()=>{
   need(response,'Select the actual saved customer response.');await flush();
   await showOperation(await dispatch('/responses/prepare',{...copy(data),actor:actor()}));
  },{primary:true}));
}
async function publicationEditor(parent,form,ticket){
 formBar(parent,form,'Publish the quoted customer delivery');
 const binding=await bindingField(parent,form,ticket);if(ticket!==state.serial||!binding)return;
 const data=form.data,selection=binding.review.selection,briefId=binding.result.native.operation.result.brief.id;
 if(!data.dossierId)edit('dossierId',selection.dossierId);
 need(data.dossierId===selection.dossierId,'The working form points to a different dossier.');
 const [delivered,requested]=await Promise.all([customer(data.dossierId,'deliveries',{projectId:selection.projectId}),
  customer(data.dossierId,'requests',{projectId:selection.projectId})]);
 if(ticket!==state.serial)return;
 const ids=new Set(requested.items.filter(row=>row.definition.briefId===briefId).map(row=>row.id)),
  deliveries=delivered.items.filter(row=>ids.has(row.requestEditionId)),grid=node('div',null,{class:'grid'});parent.append(grid);
 field(grid,'Frozen delivery prepared from this brief',data.deliveryId,{kind:'select',options:[{value:'',label:'Select the original frozen delivery'},
  ...deliveries.map(row=>({value:row.id,label:row.title+' · revision '+row.revision}))],change:async value=>{
   const row=deliveries.find(item=>item.id===value);edit('deliveryId',value);edit('revision',row?.revision??'');await render();
  }});
 field(grid,'Public delivery title',data.title,{change:value=>edit('title',value)});
 field(grid,'Public description',data.summary,{kind:'textarea',span:true,change:value=>edit('summary',value)});
 field(grid,'Usage and delivery terms',data.usage,{kind:'textarea',span:true,change:value=>edit('usage',value)});
 const toggle=node('input');toggle.type='checkbox';toggle.checked=!!data.sourceWorkspace;
 const label=node('label','Include the complete original source workspace');label.prepend(toggle);parent.append(label);
 toggle.addEventListener('change',()=>act(async()=>{
  edit('sourceWorkspace',toggle.checked?{library:'original',actor:'',requestId:uuid()}:null);await render();
 }));
 if(data.sourceWorkspace){
  field(grid,'Source workspace alias',data.sourceWorkspace.library,{change:value=>edit('sourceWorkspace',{...data.sourceWorkspace,library:value})});
  field(grid,'Source workspace operator',data.sourceWorkspace.actor,{change:value=>edit('sourceWorkspace',{...data.sourceWorkspace,actor:value})});
  description(parent,{'Original source export request':data.sourceWorkspace.requestId});
 }
 const delivery=deliveries.find(row=>row.id===data.deliveryId);if(delivery)details(parent,'Complete frozen delivery',delivery);
 toolbar(parent).append(button('Review quoted publication',async()=>{
  need(delivery&&data.title.trim(),'Choose the frozen delivery and its public title.');await flush();
  await showOperation(await dispatch('/publications/prepare',copy(data)));
 },{primary:true}));
 link(parent,'Continue original delivery authoring','/customer-updates.html'+params({dossier:data.dossierId}));
}

async function reportEditor(parent,form,ticket){
 formBar(parent,form,'Capture realized payment and customer receiving');
 parent.append(node('p','Select the enrolled delivery and its actual Buyer receiving operations. The saved report retains the original order, customer events, and selected merchant economics together.'));
 const binding=await bindingField(parent,form,ticket);if(ticket!==state.serial||!binding)return;
 const data=form.data,selected=binding.review.selection,
  publications=await pages(BASE+'/operations',{kind:'PUBLICATION'});if(ticket!==state.serial)return;
 const choices=publications.items.filter(row=>row.status==='COMPLETE'&&row.bindingId===data.bindingId),
  grid=node('div',null,{class:'grid'});parent.append(grid);
 field(grid,'Original enrolled publication',data.publicationId,{kind:'select',options:[{value:'',label:'Select the quoted enrolled delivery'},
  ...choices.map(row=>({value:row.id,label:row.createdAt+' · '+row.id}))],change:async value=>{
   edit('publicationId',value);edit('purchaseIds',[]);await render();
  }});
 const current=await customer(selected.dossierId,'projects',Number.isSafeInteger(data.revision)?{revision:data.revision}:{});
 if(ticket!==state.serial)return;if(!Number.isSafeInteger(data.revision))edit('revision',current.revision);
 description(parent,{'Selected customer history revision':data.revision});
 toolbar(parent).append(button('Use current customer receiving history',async()=>{edit('revision','');await render();}));
 field(grid,'Original Buyer receiving operation IDs, one per line',data.purchaseIds.join('\n'),{kind:'textarea',span:true,
  change:value=>edit('purchaseIds',value.split(/\s+/).map(row=>row.trim()).filter(Boolean))});
 const buyers=panel(parent,'Select actual Buyer receiving');
 let buyerOffset=0;
 const buyerRows=node('div');buyers.append(buyerRows);
 async function buyerPage(){
  need(data.publicationId,'Select the enrolled original publication.');
  const page=await api('/api/customer-commerce/purchases'+params({offset:buyerOffset,limit:20,
   snapshot:buyerOffset?buyers.dataset.snapshot:undefined}));
  buyers.dataset.snapshot=page.snapshot;
  const matches=[];
  for(const row of page.items){
   const value=await api('/api/customer-commerce/purchases/'+row.id);
   if(value.publication?.publicationId===data.publicationId)matches.push(value);
  }
  buyerRows.replaceChildren();
  for(const value of matches){
   const input=node('input');input.type='checkbox';input.checked=data.purchaseIds.includes(value.id);
   const label=node('label',value.buyer.label+' · '+value.status+' · '+value.id,{class:'choice'});label.prepend(input);
   input.addEventListener('change',()=>{const chosen=new Set(data.purchaseIds);input.checked?chosen.add(value.id):chosen.delete(value.id);
    edit('purchaseIds',[...chosen]);});
   buyerRows.append(label);details(buyerRows,'Original publication and receiving',value);
  }
  if(!matches.length)buyerRows.append(node('p','This page has no Buyer operation for the selected publication.'));
  const controls=toolbar(buyerRows);
  controls.append(button('Previous Buyer page',async()=>{buyerOffset=Math.max(0,buyerOffset-20);await buyerPage();},{disabled:buyerOffset===0}),
   button('Next Buyer page',async()=>{buyerOffset=page.nextOffset;await buyerPage();},{disabled:page.nextOffset===null}));
 }
 toolbar(buyers).append(button('Load original Buyer receiving',buyerPage));
 link(buyers,'Open complete Buyer approval and receiving','/customer-commerce.html');
 const economics=panel(parent,'Selected merchant pricing and supplier costs');
 const check=node('input');check.type='checkbox';check.checked=data.pricing!==null;
 const label=node('label','Include a complete original merchant pricing version');label.prepend(check);economics.append(label);
 check.addEventListener('change',()=>act(async()=>{edit('pricing',check.checked?{profile:'',version:''}:null);await render();}));
 if(data.pricing){
  const pricingGrid=node('div',null,{class:'grid'});economics.append(pricingGrid);
  field(pricingGrid,'Declared pricing workspace',data.pricing.profile,{kind:'select',
   options:[{value:'',label:'Select the original pricing workspace'},...state.configuration.pricing.map(row=>({value:row.id,label:row.label}))],
   change:async value=>{edit('pricing',{profile:value,version:''});await render();}});
  if(data.pricing.profile){
   const [pricing,costs]=await Promise.all([
    api(BASE+'/pricing/'+data.pricing.profile+'/state',{body:{}}),
    api(BASE+'/pricing/'+data.pricing.profile+'/economics-state',{body:{}})
   ]);if(ticket!==state.serial)return;
   field(pricingGrid,'Saved native pricing version',data.pricing.version,{kind:'select',options:[{value:'',label:'Select a complete saved pricing review'},
    ...pricing.result.history.map(row=>({value:row.version,label:row.label+' · '+row.savedAt}))],change:async value=>{
     edit('pricing',{profile:data.pricing.profile,version:value});await render();
    }});
   field(pricingGrid,'Saved supplier-cost edition',data.pricing.costEdition??'',{kind:'select',
    options:[{value:'',label:'Pricing report only'},...costs.result.editions.filter(row=>row.pricingVersion===data.pricing.version)
     .map(row=>({value:row.edition,label:row.label+' · '+row.savedAt}))],change:value=>{
      const next={...data.pricing};if(value)next.costEdition=value;else delete next.costEdition;edit('pricing',next);
     }});
   if(pricing.result.sourceError)economics.append(node('p',pricing.result.sourceError,{class:'warning'}));
   details(economics,'Original configured pricing state',pricing);
   details(economics,'Original supplier-cost state',costs);
   if(data.pricing.version){
    const version=await api(BASE+'/pricing/'+data.pricing.profile+'/version',{body:{version:data.pricing.version}});
    if(ticket!==state.serial)return;details(economics,'Complete selected native pricing report',version.result);
   }
  }
 }
 operatorFields(parent);
 toolbar(parent).append(button('Capture complete realized report',async()=>{
  need(data.publicationId,'Select the original enrolled publication.');
  if(data.pricing)need(data.pricing.profile&&data.pricing.version,'Select the exact saved pricing version.');
  await flush();await showOperation(await dispatch('/reports/prepare',{...copy(data),actor:actor()}));
 },{primary:true}));
}
async function operationFiles(parent,id){
 const original=await api(BASE+'/operations/'+id+'/files'),table=node('table'),head=node('thead'),row=node('tr');
 for(const label of ['Complete original file','Bytes','Download'])row.append(node('th',label));head.append(row);table.append(head);
 const body=node('tbody');for(const file of original.files){
  const item=node('tr'),name=node('td');name.append(node('strong',file.name),node('p',file.sha256,{class:'small'}));
  const action=node('td');action.append(button('Download',()=>downloadFile(id,file.name)));
  item.append(name,node('td',file.bytes),action);body.append(item);
 }
 table.append(body);const wrap=node('div',null,{class:'table-wrap'});wrap.append(table);parent.append(wrap);
}
async function operationPanel(parent,ticket){
 const result=await api(BASE+'/operations/'+state.operationId);if(ticket!==state.serial)return;
 state.operation=result;const section=panel(parent,result.review?.quote?.title??result.request?.title??'Saved customer quotation work');
 section.append(node('span',result.kind+' · '+result.status,{class:'status'}));
 description(section,{'Original operation':result.id,'Created':result.createdAt,'Request SHA-256':result.requestSha256,
  'Review SHA-256':result.review?.reviewSha256});
 toolbar(section).append(button('Reopen original saved operation',()=>render()),
  button('Replay this exact original preparation',async()=>{
   const route={BRIEF:'/prepare',RESPONSE:'/responses/prepare',PUBLICATION:'/publications/prepare',
    REALIZED:'/reports/prepare',CASE:'/cases/create'}[result.kind];
   await dispatch(route,result.request,{replay:true});await render();message('The same original native request was replayed.');
  }));
 if(!result.review){
  section.append(node('p','The complete original request is retained. Replay its exact preparation to finish the saved review.'));
  details(section,'Original request',result.request);return;
 }
 const review=result.review;
 if(result.kind==='BRIEF'){
  const grid=node('div',null,{class:'grid'});section.append(grid);
  const before=panel(grid,'Original brief scope'),after=panel(grid,'Reviewed customer scope');
  description(before,review.before.definition.scope);description(after,review.brief.scope);
  description(section,{'Customer':review.brief.customer.name,'Quoted component':review.scope.component,
   'Merchant resource':review.merchant.view.purchaseUrl,'Saved case':review.selection.caseId});
  details(section,'Original native checkout terms',review.merchant.view.payment);
  details(section,'Complete revised brief',review.brief);
  if(result.status!=='COMPLETE')toolbar(section).append(button('Apply this exact reviewed customer brief',async()=>{
   await dispatch('/apply',{id:result.id,reviewSha256:review.reviewSha256});await render();
  },{primary:true}));
  else{
   const bar=toolbar(section);bar.append(button('Receive original customer response',()=>chooseNew('response',{bindingId:result.id})),
    button('Publish the quoted delivery',()=>chooseNew('publication',{bindingId:result.id})),
    button('Capture realized delivery',()=>chooseNew('report',{bindingId:result.id})));
  }
  link(section,'Continue original customer delivery','/customer-updates.html'+params({dossier:review.selection.dossierId}));
 }
 if(result.kind==='RESPONSE'){
  description(section,{'Response':review.response.status,'Customer':review.nativeRequest.data.by.name,
   'Observed':review.response.observedAt,'Original source':review.response.source});
  section.append(node('p',review.response.note));
  if(result.status!=='COMPLETE')toolbar(section).append(button('Apply this exact customer agreement',async()=>{
   await dispatch('/apply',{id:result.id,reviewSha256:review.reviewSha256});await render();
  },{primary:true}));
 }
 if(result.kind==='PUBLICATION'){
  const commerce=review.commerce.review;
  description(section,{'Public title':commerce.title,'Original frozen delivery':commerce.deliveryId,
   'Merchant':commerce.merchant.label,'Purchase resource':commerce.merchant.purchaseUrl,
   'Original order reference':commerce.orderReference,'Archive bytes':commerce.archive.bytes,'Archive SHA-256':commerce.archive.sha256});
  details(section,'Actual original checkout terms',commerce.merchant.payment);
  section.append(node('p',commerce.summary),node('h3','Usage and delivery terms'),node('p',commerce.usage));
  if(result.status!=='COMPLETE')toolbar(section).append(button('Enroll this original reviewed delivery',async()=>{
   await dispatch('/publications/enroll',{id:result.id,reviewSha256:review.reviewSha256});await render();
  },{primary:true}));
  else{
   section.append(node('p','This complete archive is enrolled in the original merchant checkout.'));
   link(section,'Open original publication, Buyer approval, and receiving','/customer-commerce.html');
   toolbar(section).append(button('Capture its realized receiving',()=>chooseNew('report',{
    bindingId:result.request.bindingId,publicationId:result.id})));
  }
 }
 if(result.kind==='REALIZED'&&result.result?.report){
  const report=result.result.report;
  description(section,{'Captured':report.capturedAt,'Original quote':report.quote.title,
   'Publication':report.publication.publicationId,'Native order state':report.originalOrder.state,
   'Customer history revision':report.customer.revision,'Buyer receiving operations':report.purchases.length});
  details(section,'Complete native realized report',report);
 }
 details(section,'Complete retained request, native review, and saved result',result);
 await operationFiles(section,result.id);
}
async function importForm(file){
 need(file&&file.size>0&&file.size<=8*1024*1024,'Choose the complete working form within 8 MiB.');
 const bytes=new Uint8Array(await file.arrayBuffer()),value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 need(value.schema==='sf88-research-quote-working-form/v1'&&value.workspaceId===state.workspaceId&&
  ['case','brief','response','publication','report'].includes(value.kind)&&value.data&&typeof value.data==='object',
  'This working form belongs to a different Research workspace or workflow.');
 // Inspect the original selected records before receiving another complete form.
 if(value.data.bindingId){
  const binding=await api(BASE+'/operations/'+value.data.bindingId);
  need(binding.kind==='BRIEF'&&binding.status==='COMPLETE','Reopen the original applied quote before receiving this form.');
 }
 if(value.data.dossierId&&Number.isSafeInteger(value.data.revision)){
  const page=await customer(value.data.dossierId,'projects',{revision:value.data.revision});
  if(value.data.projectId)need(page.items.some(row=>row.id===value.data.projectId),'The selected original project is absent from this dossier revision.');
 }
 if(value.data.caseId&&value.kind!=='case'){
  const original=await api(BASE+'/cases/'+value.data.caseId+params({revision:value.data.caseRevision||undefined}));
  if(value.data.quoteId)need(original.result.quotes.some(row=>row.id===value.data.quoteId&&row.sha256===value.data.quoteSha256),
   'The selected original quotation is absent from this case revision.');
 }
 await flush();const imported={...copy(value),key:'form:'+scope()+uuid(),updatedAt:now(),
  receivedFrom:{name:file.name,bytes:bytes.length,sha256:await sha(bytes)},originalFormKey:value.key};
 await put(imported);await go(value.kind==='case'?'cases':value.kind,{form:imported});
 message('The complete working form is received as a separate retained draft.');
}
async function historyPanel(parent,ticket){
 const section=panel(parent,'Saved work and original native requests'),bar=toolbar(section);
 const chooser=field(section,'Receive a complete working form','',{type:'file'});chooser.accept='.json,application/json';
 chooser.addEventListener('change',()=>act(()=>importForm(chooser.files[0])));
 bar.append(button('Refresh saved work',()=>render()));
 const native=await pages(BASE+'/operations');if(ticket!==state.serial)return;
 const list=node('div',null,{class:'list'});section.append(node('h3','Original saved operations'),list);
 for(const item of native.items){
  const row=button('',()=>go(({BRIEF:'brief',RESPONSE:'response',PUBLICATION:'publication',REALIZED:'report',CASE:'cases'})[item.kind],
   {operationId:item.id}));row.className='case-row';
  row.append(node('strong',item.kind+' · '+item.status),node('span',item.createdAt+' · '+item.id));list.append(row);
 }
 const local=await rows('request:'+scope());if(ticket!==state.serial)return;
 local.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 section.append(node('h3','Original requests and recovery'));
 for(const record of local){
  const item=node('div',null,{class:'panel'});item.append(node('strong',record.route),node('p',record.status+' · '+record.createdAt));
  toolbar(item).append(button(record.status==='COMPLETE'?'Replay this exact original request':'Resume original request',async()=>{
   await dispatch(record.route,record.body,{replay:true,recordKey:record.key});await render();
   message('The exact saved request has returned from the original native writer.');
  }),button('Export complete original request and result',()=>saveJSON(record,'research-quote-request.json')));
  details(item,'Retained original input and first result',record);section.append(item);
 }
 section.append(node('h3','Independent retained working forms'));
 for(const form of (await rows('form:'+scope())).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))){
  const item=node('div',null,{class:'panel'});item.append(node('strong',form.kind+' · '+form.data.requestId),
   node('p',form.updatedAt,{class:'small'}));
  toolbar(item).append(button('Open this working form',()=>go(form.kind==='case'?'cases':form.kind,{form})),
   button('Export complete form',()=>saveJSON(form,'research-quote-working-form.json')));
  details(item,'Complete working values',form.data);section.append(item);
 }
}
async function configurationPanel(parent){
 const section=panel(parent,'Original case, pricing, and merchant connections');
 description(section,{'Research workspace':state.workspaceId,'Cases directory':state.configuration.cases.directory,
  'Original case workspace':state.configuration.cases.workspaceId,
  'Quote host configuration':state.configuration.configurationFile??'Default private Research case directory'});
 for(const profile of state.configuration.pricing){
  const item=panel(section,profile.label);
  description(item,{'Alias':profile.id,'Seller configuration':profile.config,'Pricing directory':profile.directory,
   'Original observation':profile.snapshot??profile.history});
 }
 for(const merchant of state.configuration.merchants.items){
  const item=panel(section,merchant.label);
  description(item,{'Alias':merchant.id,'Original checkout':merchant.checkoutFile,'Purchase resource':merchant.purchaseUrl});
  details(item,'Actual native payment terms',merchant.payment);
 }
 if(state.configuration.merchants.errors.length)details(section,'Existing merchant configuration errors',state.configuration.merchants.errors);
 toolbar(section).append(button('Refresh original connections',async()=>{state.configuration=await api(BASE+'/configuration');await render();}));
 const advanced=panel(parent,'Original native pricing operations');
 advanced.append(node('p','Use the maintained SF97 inputs for saved pricing reviews, planning scenarios, supplier-cost editions, and repricing. Each complete request and result remains in Saved work.'));
 const key='pricing-form:'+scope(),saved=await get(key),form=saved??{key,profile:'',action:'state',text:'{}',updatedAt:now()};
 const persist=()=>retain({...form,updatedAt:now()}),grid=node('div',null,{class:'grid'});advanced.append(grid);
 field(grid,'Original pricing profile',form.profile,{kind:'select',options:[{value:'',label:'Select configured workspace'},
  ...state.configuration.pricing.map(row=>({value:row.id,label:row.label}))],change:value=>{form.profile=value;persist();}});
 const actions=['state','preview','save','version','compare','planning-state','planning-preview','planning-save','planning-read',
  'economics-state','economics-preview','economics-save','economics-edition','economics-proposal','economics-apply',
  'repricing-source','repricing-preview','repricing-save','repricing-stage'];
 field(grid,'Original native action',form.action,{kind:'select',options:actions.map(value=>({value,label:value})),
  change:value=>{form.action=value;persist();}});
 field(grid,'Complete original native request JSON',form.text,{kind:'textarea',span:true,change:value=>{form.text=value;persist();}});
 const output=node('div');advanced.append(output);
 toolbar(advanced).append(button('Run retained native operation',async()=>{
  need(form.profile,'Choose the original pricing workspace.');await flush();
  const result=await dispatch('/pricing/'+form.profile+'/'+form.action,JSON.parse(form.text),{replay:true});
  output.replaceChildren();details(output,'Complete original pricing result',result).open=true;
 }));
}
async function render(){
 if(!state.workspaceId)return;const ticket=++state.serial;
 nativeDesk?.destroy();nativeDesk=null;
 document.querySelectorAll('[data-tab]').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.tab===state.tab)));
 const parent=$('workspace');parent.replaceChildren();
 if(state.operationId){await operationPanel(parent,ticket);return;}
 if(state.tab==='cases'){await casesPanel(parent,ticket);return;}
 if(state.tab==='history'){await historyPanel(parent,ticket);return;}
 if(state.tab==='configuration'){await configurationPanel(parent);return;}
 if(!state.form){
  const titles={brief:'Apply a saved quotation to the customer brief',response:'Receive an original customer response',
   publication:'Publish the quoted delivery',report:'Capture original payment and receiving'};
  const section=panel(parent,titles[state.tab]);
  section.append(node('p','Start a complete working request or reopen its saved form from Saved work.'));
  toolbar(section).append(button('Prepare new request',()=>chooseNew(state.tab),{primary:true}));return;
 }
 const section=panel(parent);
 const methods={brief:briefEditor,response:responseEditor,publication:publicationEditor,report:reportEditor};
 await methods[state.tab](section,state.form,ticket);
}
async function connect(){
 need(!connecting&&admissions===0&&active.size===0,'Let the accepted original request finish before changing the connection.');
 connecting=true;try{return await connectOriginal();}finally{connecting=false;}
}
async function connectOriginal(){
 await flush();nativeDesk?.destroy();nativeDesk=null;state.token=$('token').value;
 need(state.token,'Enter the existing Research session token.');state.workspaceId=null;state.instanceId=null;
 const status=await api('/api/status');need(/^research_[a-f0-9]{64}$/.test(status.workspaceId)&&status.api?.customerQuotes,
  'Install the complete customer quotation source in the original Research application.');
 state.workspaceId=status.workspaceId;state.instanceId=status.instanceId;sessionStorage.setItem(tokenKey,state.token);
 state.configuration=await api(BASE+'/configuration');
 const saved=await get('selection:'+scope());
 state.tab=saved?.tab??'cases';state.caseId=saved?.caseId??null;state.operationId=saved?.operationId??null;
 state.form=saved?.formKey?await get(saved.formKey):null;state.actor=saved?.actor??{id:'',name:''};
 $('identity').textContent='Research '+state.workspaceId+' · original case workspace '+state.configuration.cases.workspaceId;
 message('Opened the original Research and quotation workspace.');await render();
}
$('token').value=state.token;$('connect').addEventListener('click',()=>act(connect));
document.querySelectorAll('[data-tab]').forEach(item=>item.addEventListener('click',()=>act(()=>go(item.dataset.tab))));
window.addEventListener('beforeunload',event=>{if(writes.size||writeErrors.size||active.size||admissions||nativeDesk?.snapshot().dirty){
 event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{if(state.form)retain(state.form);nativeDesk?.destroy();nativeDesk=null;});
if(state.token)act(connect);
