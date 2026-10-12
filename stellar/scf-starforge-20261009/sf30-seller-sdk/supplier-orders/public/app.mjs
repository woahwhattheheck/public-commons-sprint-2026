// MIT. Supplier-order operator on the original private workspace HTTP API.
import { sha256File, Sha256 } from '/file-sha256.mjs';
import { ZERO, exact, add, multiply, divide, rounded, decimal } from '/numbers.mjs';

const $=id=>document.getElementById(id), API='/api/supplier-orders';
const clone=value=>JSON.parse(JSON.stringify(value)), json=value=>JSON.stringify(value,null,2);
const encoded=value=>encodeURIComponent(String(value)), PAGE=30;
const SESSION='supplier-orders:'+location.origin;
const state={token:null,workspace:null,orders:[],orderTotal:0,orderOffset:0,order:null,documents:[],documentTotal:0,documentOffset:0,document:null,draft:null,working:null,lineIndex:null,dirty:false,prepared:null,request:null,requestFile:null,busy:false,editorGeneration:0,tab:'lines',refreshSequence:0};
const hashes=new WeakMap();
const labels={ORDER:'Order',ORDERRESPONSE:'Confirmation',DISPATCHNOTIFICATION:'Dispatch',INVOICE:'Invoice'};
function node(tag,text,css){const n=document.createElement(tag);if(text!==undefined&&text!==null)n.textContent=String(text);if(css)n.className=css;return n;}
function clear(element){element.replaceChildren();return element;}
function button(text,action){const n=node('button',text);n.type='button';n.addEventListener('click',guard(action));return n;}
function badge(text){return node('span',String(text??'').replaceAll('_',' '),'badge');}
function shown(id,value){$(id).hidden=!value;}
function message(text,error=false){$('notice').textContent=text??'';$('notice').classList.toggle('error',error);shown('notice',Boolean(text));}
function guard(action){return async event=>{event?.preventDefault();try{await action(event);}catch(error){if(error.name!=='AbortError')message(error.message,true);}};}
function privateStorage(key,value){try{if(value===undefined)return sessionStorage.getItem(SESSION+':'+key);if(value===null)sessionStorage.removeItem(SESSION+':'+key);else sessionStorage.setItem(SESSION+':'+key,value);return true;}catch{return false;}}
function auth(){const fragment=new URLSearchParams(location.hash.slice(1));const token=fragment.get('token');if(token){state.token=token;privateStorage('token',token);history.replaceState(null,'',location.pathname+location.search);}else state.token=privateStorage('token');const previous=privateStorage('request');if(previous){try{state.request=JSON.parse(previous);}catch{privateStorage('request',null);}}}
function object(value,label='Value'){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(label+' must be a JSON object.');return value;}
function parseValue(id,type='object'){const text=$(id).value;let value;try{value=JSON.parse(text|| (type==='array'?'[]':'{}'));}catch{throw new Error($(id).closest('label')?.firstChild?.textContent?.trim()+' must contain complete JSON.');}if(type==='array'){if(!Array.isArray(value))throw new Error('Use a JSON array in '+id+'.');}else object(value,id);return value;}
function query(path,values){const result=new URLSearchParams();for(const [key,value]of Object.entries(values??{}))if(value!==undefined&&value!==null&&value!=='')result.set(key,String(value));return path+(result.size?'?'+result:'');}
async function response(path,{method='GET',body,headers={},signal}={}){
  if(!state.token)throw new Error('Open the private workspace URL printed by the supplier-order server.');
  const result=await fetch(API+path,{method,body,headers:{authorization:'Bearer '+state.token,...headers},signal,cache:'no-store',credentials:'omit',redirect:'error'});
  if(!result.ok){let detail;try{detail=await result.json();}catch{detail=null;}const data=detail?.error??detail??{};const error=new Error(data.message??('Workspace returned HTTP '+result.status+'.'));Object.assign(error,{code:data.code??'ORDER_HTTP_ERROR',status:result.status,details:data.details??null});throw error;}
  return result;
}
async function api(path,{method='GET',body,signal}={}){return (await response(path,{method,body:body===undefined?undefined:JSON.stringify(body),headers:body===undefined?{}:{'content-type':'application/json'},signal})).json();}
function originalRequest(kind,path,body,input=null){
  if(state.request){showRequest();throw new Error('Continue the existing '+state.request.kind+' request before starting another write.');}
  const requestId='supplier-orders-'+crypto.randomUUID(), selected={...clone(body),requestId};
  const retained={version:1,requestId,kind,path,body:selected,input:input?clone(input):null,editorGeneration:kind.startsWith('draft-')?state.editorGeneration:null,createdAt:new Date().toISOString(),lastError:null};
  state.request=retained;
  if(!privateStorage('request',JSON.stringify(retained)))message('This original request is retained in this open tab. Keep the tab open until its response is received.');
  return retained;
}
function rememberError(error){if(state.request){state.request.lastError={code:error.code??'ORDER_RESPONSE_INTERRUPTED',status:error.status??null,message:error.message,details:error.details??null};privateStorage('request',JSON.stringify(state.request));}}
function retireRequest(operation){const r=state.request;if(r){privateStorage('last-request',JSON.stringify({requestId:r.requestId,kind:r.kind,operationId:operation?.id??r.requestId,state:operation?.state??null,completedAt:new Date().toISOString()}));privateStorage('request',null);}state.request=null;state.requestFile=null;if($('request-dialog').open)$('request-dialog').close();}
async function completeRequest(operation){
  if(operation?.state!=='COMPLETE'){const error=new Error(operation?.error?.message??('Original request is '+(operation?.state??'awaiting completion')+'.'));Object.assign(error,{code:operation?.error?.code??'ORDER_OPERATION_PENDING',status:operation?.state==='FAILED'?422:409,details:operation?.error?.details??{operationId:operation?.id}});rememberError(error);showRequest();throw error;}
  if(operation.id!==state.request?.requestId)throw new Error('The workspace returned another operation identity.');
  const retained=state.request,kind=retained.kind;retireRequest(operation);await receiveResult(kind,operation.result??{},retained);return operation;
}
async function sendOriginal(){
  const selected=state.request;if(!selected)return null;
  let operation;
  try{operation=await api('/operations/'+encoded(selected.requestId));}catch(error){if(error.status!==404)throw error;}
  if(operation?.state==='COMPLETE')return completeRequest(operation);
  if(operation&&operation.state!=='FAILED'&&operation.state!=='INTERRUPTED'){showRequest();throw new Error('The original request is still '+operation.state+'. Reopen its response after it completes.');}
  if(selected.input){
    if(!state.requestFile)throw new Error('Reselect the same original '+selected.input.name+' file to continue this request.');
    const file=state.requestFile,sha256=await checksum(file);
    if(file.name!==selected.input.name||file.size!==selected.input.bytes||sha256!==selected.input.sha256)throw new Error('The selected file differs from the retained original request.');
    operation=await(await response(selected.path,{method:'POST',body:file,headers:{'content-type':selected.kind==='source'?'application/xml':'application/zip','x-supplier-order-metadata':encodeURIComponent(JSON.stringify(selected.body))}})).json();
  }else operation=await api(selected.path,{method:'POST',body:selected.body});
  return completeRequest(operation);
}
async function mutate(kind,path,body,input=null,file=null){
  if(state.busy)throw new Error('The current workspace request is still running.');
  originalRequest(kind,path,body,input);state.requestFile=file;state.busy=true;if(kind.startsWith('draft-')){$('draft-editor').inert=true;$('draft-editor').setAttribute('aria-busy','true');}
  try{return await sendOriginal();}catch(error){rememberError(error);showRequest();throw error;}finally{state.busy=false;$('draft-editor').inert=false;$('draft-editor').removeAttribute('aria-busy');}
}
function showRequest(){
  const r=state.request;if(!r)return;
  $('request-description').textContent='The original '+r.kind+' request retains its exact ID, selected revisions and file identity. Reopen that response or review a confirmed revision conflict.';
  properties($('request-identity'),[['Request',r.requestId],['Created',r.createdAt],['Original file',r.input?.name],['Bytes',r.input?.bytes],['SHA-256',r.input?.sha256]]);
  clear($('request-details'));if(r.lastError){$('request-details').append(node('p',r.lastError.message,'hint'));if(r.lastError.details)$('request-details').append(node('pre',json(r.lastError.details)));}
  $('request-revise').disabled=!(r.lastError?.status===409||r.lastError?.status===422);
  if(!$('request-dialog').open)$('request-dialog').showModal();
}
async function retryOriginal(){if(state.busy)return;state.busy=true;const editing=state.request?.kind.startsWith('draft-');if(editing){$('draft-editor').inert=true;$('draft-editor').setAttribute('aria-busy','true');}try{await sendOriginal();}catch(error){rememberError(error);showRequest();throw error;}finally{state.busy=false;$('draft-editor').inert=false;$('draft-editor').removeAttribute('aria-busy');}}
async function reviewCurrentRequest(){
  const r=state.request;if(!r||![409,422].includes(r.lastError?.status))return;
  const op=await api('/operations/'+encoded(r.requestId)).catch(error=>{if(error.status===404)return null;throw error;});
  if(op?.state==='COMPLETE')return completeRequest(op);
  if(op&&!['FAILED','INTERRUPTED'].includes(op.state))throw new Error('The original operation is still active; reopen its response first.');
  privateStorage('previous-conflict',JSON.stringify(r));retireRequest(op);await refresh({preserveEditor:true});
  if(r.kind==='source')openSource();else if(r.kind==='package-import')$('transfer-dialog').showModal();else if(r.kind==='draft-save'){const current=r.body.draftId?await api('/drafts/'+encoded(r.body.draftId)):await api('/drafts/new',{method:'POST',body:{kind:r.body.kind,orderIds:r.body.orderIds}});const replaced=openEditor(current)!==false;state.conflictDraft=clone(r.body);$('draft-conflict-json').textContent=json(r.body);shown('draft-conflict',true);message(replaced?'The current saved draft is open. Compare the retained earlier edits before saving a new request.':'Your current unsaved document is retained. The earlier conflicting request is available below for comparison.');}
  else message('The conflicting request is retained in this tab’s history. Review current source and revisions before creating a new request.');
}
function properties(target,entries){clear(target);const list=target.tagName==='DL'?target:node('dl');for(const [label,value]of entries){if(value===undefined||value===null||value==='')continue;list.append(node('dt',label),node('dd',typeof value==='object'?json(value):value));}if(list!==target)target.append(list);}
function findingList(target,findings=[]){clear(target);if(!findings.length){target.append(node('p','No findings in this selection.','muted'));return;}for(const f of findings){const item=node('div',null,'finding');item.append(badge(f.severity??'review'),node('strong',f.code??'Review'),node('p',f.message??''));if(f.path)item.append(node('code',f.path));if(f.rule?.url){const a=node('a','Original rule');a.href=f.rule.url;a.target='_blank';a.rel='noopener noreferrer';item.append(a);}if(f.details)item.append(node('pre',json(f.details)));target.append(item);}}
function currentSelections(){return new Set([state.order?.document?.id,...(state.order?.selectedDocuments??[]).map(d=>d.id)].filter(Boolean));}
function orderRows(page){return page.items??[];}
async function refresh({preserveEditor=false}={}){
  const sequence=++state.refreshSequence;const [workspace,page]=await Promise.all([api('/state'),api(query('/orders',{query:$('order-query').value,status:$('order-status').value,offset:state.orderOffset,limit:PAGE}))]);if(sequence!==state.refreshSequence)return;
  state.workspace=workspace;state.orders=orderRows(page);state.orderTotal=page.total??state.orders.length;
  $('workspace-label').textContent=workspace.title??workspace.directory??workspace.id??'Private supplier-order workspace';
  renderOrders();renderDraftList();
  if(state.order){const current=await api('/orders/'+encoded(state.order.orderId));if(sequence!==state.refreshSequence)return;state.order=current;renderOrder();await loadDocuments();}
  if(!preserveEditor&&state.draft?.id&&!state.dirty){const current=await api('/drafts/'+encoded(state.draft.id));openEditor(current);}
}
function renderOrders(){
  const list=clear($('order-list'));
  if(!state.orders.length)list.append(node('p','No orders match this selection.','empty'));
  for(const row of state.orders){
    const card=button('',()=>selectOrder(row.orderId));card.className='order-card';if(row.orderId===state.order?.orderId)card.classList.add('selected');
    card.append(node('strong',row.orderId),badge(row.status),node('span',row.supplierId??row.header?.supplierId??row.documentId??'', 'muted'),node('span','Revision '+row.revision+(row.updatedAt?' · '+row.updatedAt:''),'muted'));list.append(card);
  }
  $('order-count').textContent=String(state.orderTotal);
  $('orders-page').textContent=state.orderTotal?(state.orderOffset+1)+'–'+Math.min(state.orderTotal,state.orderOffset+state.orders.length)+' of '+state.orderTotal:'0 orders';
  $('orders-previous').disabled=state.orderOffset===0;$('orders-next').disabled=state.orderOffset+state.orders.length>=state.orderTotal;
}
async function selectOrder(id){state.order=await api('/orders/'+encoded(id));state.document=null;state.documentOffset=0;renderOrders();renderOrder();await loadDocuments();}
function renderOrder(){
  const order=state.order;shown('selected-order',Boolean(order));shown('no-order',!order);if(!order)return;
  $('order-title').textContent=order.orderId;$('order-subtitle').textContent='Current revision '+order.revision+(order.header?.date?' · '+order.header.date:'');$('order-state').textContent=order.status.replaceAll('_',' ');
  const metrics=clear($('order-metrics'));for(const [label,value]of [['Original lines',order.items.length],['Selected documents',order.selectedDocuments?.length??0],['Findings',order.findings?.length??0],['Original net',order.totals?.net?.text??order.totals?.net?.decimal??'—']]){const item=node('div',null,'metric');item.append(node('span',label),node('strong',value));metrics.append(item);}
  renderLines();findingList($('order-findings').lastElementChild,order.findings);shown('order-findings',Boolean(order.findings?.length));
  properties($('order-parties'),[['Supplier account',order.header.supplierId],['Original supplier identity',order.header.supplierIdentity],['Parties',order.header.parties],['Header packages',order.header.packages],['Header remarks',order.header.remarks]]);
  clear($('order-history')).append(node('h3','Selection and revision history'),node('pre',json(order.history??[])));renderDraftList();
}
function renderLines(){
  const body=clear($('line-table').tBodies[0]),differences=$('differences-only').checked;
  for(const row of state.order?.items??[]){if(differences&&!row.findings?.length&&['DOCUMENTS_COMPLETE','CANCELLED'].includes(row.status))continue;
    const tr=node('tr');const title=node('td');title.append(button(row.lineId+' / '+(row.article?.supplierId??''),()=>showLine(row.lineId)));if(row.article?.descriptionShort)title.append(node('small',row.article.descriptionShort,'muted'));tr.append(title);
    for(const value of [row.ordered,row.confirmed,row.cancelled,row.dispatched,row.invoiced])tr.append(node('td',value??'—','number'));
    tr.append(node('td',row.unit),node('td',row.status.replaceAll('_',' ')));body.append(tr);
  }
}
function showLine(id){const row=state.order.items.find(x=>x.lineId===id);if(!row)return;$('line-title').textContent='Line '+id+' · '+(row.article?.supplierId??'');properties($('line-values'),[['Status',row.status],['Reported confirmation',row.reportedConfirmation],['Remaining to confirm',row.remainingToConfirm],['Remaining to dispatch',row.remainingToDispatch],['Remaining to invoice',row.remainingToInvoice],['Original price',row.price],['Confirmed price',row.confirmedPrice],['Delivery period',row.deliveryDate],['Packages',row.packages],['Serials',row.serials]]);clear($('line-contributions')).append(node('h4','Exact selected document contributions'),node('pre',json(row.documents)));const findings=node('div');findingList(findings,row.findings);$('line-contributions').append(findings);shown('line-detail',true);}
async function loadDocuments(){if(!state.order)return;const selected=state.order.orderId;const page=await api(query('/documents',{orderId:selected,kind:$('document-kind').value,offset:state.documentOffset,limit:PAGE}));if(state.order.orderId!==selected)return;state.documents=page.items??[];state.documentTotal=page.total??state.documents.length;renderDocuments();}
function renderDocuments(){
  const body=clear($('document-table').tBodies[0]),selected=currentSelections();
  for(const row of state.documents){const tr=node('tr');tr.append(node('td',row.documentId),node('td',labels[row.kind]??row.kind),node('td',row.revision),node('td',selected.has(row.id)?'Current':'Retained history'),node('td',(row.source?.name??'')+(row.createdAt?' · '+row.createdAt:'')));const actions=node('td');actions.append(button('Inspect',()=>selectDocument(row.id)));tr.append(actions);body.append(tr);}
  $('documents-page').textContent=state.documentTotal?(state.documentOffset+1)+'–'+Math.min(state.documentTotal,state.documentOffset+state.documents.length)+' of '+state.documentTotal:'0 documents';
  $('documents-previous').disabled=state.documentOffset===0;$('documents-next').disabled=state.documentOffset+state.documents.length>=state.documentTotal;
}
async function selectDocument(id){
  const row=await api('/documents/'+encoded(id));state.document=row;$('document-title').textContent=(labels[row.kind]??row.kind)+' '+row.documentId;
  properties($('document-metadata'),[['Revision',row.revision],['Source file',row.source?.name],['Original bytes',row.source?.bytes],['SHA-256',row.source?.sha256],['Order references',row.orderIds],['Direction',row.direction],['Saved',row.createdAt]]);
  findingList($('document-findings'),row.review?.findings??[]);$('document-json').textContent=json(row.document);$('selection-reason').value='';
  shown('document-selection',Boolean(state.order)&&!currentSelections().has(id));$('document-copy-draft').disabled=row.kind==='ORDER';shown('document-detail',true);selectTab('documents');
}
function selectTab(name){state.tab=name;for(const button of document.querySelectorAll('[data-tab]')){const active=button.dataset.tab===name;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));shown('tab-'+button.dataset.tab,active);}}
function renderDraftList(){
  const list=clear($('draft-list'));let drafts=state.workspace?.drafts??[];if(state.order)drafts=drafts.filter(row=>row.orderIds?.includes(state.order.orderId));
  if(!drafts.length){list.append(node('p','No saved working drafts in this selection.','empty'));return;}
  for(const row of drafts){const item=node('div',null,'draft-card');item.append(node('strong',row.title??labels[row.kind]),node('span','Revision '+row.revision+' · '+(row.updatedAt??''),'muted'),node('span',(row.orderIds??[]).join(', ')),button('Open draft',async()=>openEditor(await api('/drafts/'+encoded(row.id)))));list.append(item);}
}

function setValue(id,value){$(id).value=value===null||value===undefined?'':String(value);}
function dateValues(prefix,date){setValue(prefix+'-type',date?.type);setValue(prefix+'-start',date?.start);setValue(prefix+'-end',date?.end);}
function readDate(prefix,previous){const type=$(prefix+'-type').value,start=$(prefix+'-start').value,end=$(prefix+'-end').value;if(!type&&!start&&!end)return null;const result={...(previous??{})};for(const [key,value]of Object.entries({type,start,end})){if(value)result[key]=value;else delete result[key];}return result;}
function optionalText(target,key,value){if(value==='')delete target[key];else target[key]=value;}
function markDirty(){if(!state.working)return;state.editorGeneration++;state.dirty=true;$('draft-save-state').textContent='Edited working document · save its next revision';$('prepare-draft').disabled=true;shown('prepared-result',false);}
function roundPolicy(){const mode=$('draft-rounding-mode').value;if(!mode)return null;const scale=Number($('draft-rounding-scale').value);if(!Number.isSafeInteger(scale)||scale<0||scale>100)throw new Error('Select 0–100 decimal places for explicit rounding.');return{scale,mode,taxBasis:$('draft-tax-basis').value};}
function openEditor(draft,{accepted=false}={}){
  if(!accepted&&state.busy&&state.request?.kind.startsWith('draft-'))throw new Error('Finish the original draft request before replacing its working document.');
  if(!accepted&&state.dirty&&!confirm('Replace the current unsaved working document?'))return false;
  state.editorGeneration++;shown('draft-conflict',false);
  state.draft=clone(draft);state.working=clone(draft.document);state.dirty=false;state.lineIndex=null;state.prepared=null;
  const d=state.working,h=d.header;shown('draft-editor',true);shown('draft-line-editor',false);shown('prepared-result',false);
  $('draft-title').textContent=draft.title??((labels[d.kind]??d.kind)+' '+(d.documentId||'working document'));
  $('draft-revision').textContent=draft.id?'Saved revision '+draft.revision+' · '+draft.id:'New working document';
  $('draft-source-selection').textContent='Original orders: '+draft.orderIds.join(', ')+' · reviewed revisions '+JSON.stringify(draft.orderRevisions??{});
  setValue('draft-document-id',d.documentId);setValue('draft-date',h.date);setValue('draft-currency',h.currency);setValue('draft-supplier-order',h.supplierOrderId);setValue('draft-supplier-account',h.supplierId);
  dateValues('draft-date',h.deliveryDate);$('draft-parties').value=json(h.parties??{});$('draft-packages').value=json(h.packages??[]);$('draft-remarks').value=json(h.remarks??[]);$('draft-summary').value=json(d.summary??{});
  setValue('draft-rounding-mode',draft.roundingPolicy?.mode??'');setValue('draft-rounding-scale',draft.roundingPolicy?.scale??2);setValue('draft-tax-basis',draft.roundingPolicy?.taxBasis??'line');
  setValue('draft-reason',draft.reason??'');$('draft-complete-json').value=json(d);
  $('draft-kind-hint').textContent=d.kind==='ORDERRESPONSE'?'A negative confirmed quantity records cancellation of that absolute quantity. A new selected confirmation revision replaces the earlier confirmation for each included line; omitted lines retain their existing selection.':d.kind==='DISPATCHNOTIFICATION'?'Retain original order and line references. Each distinct dispatch contributes its current quantities and original parcel or tracking references.':'Retain complete original order and delivery references, price quantities, applicable tax fractions and explicit invoice totals. Rounding is selected and saved with this working revision.';
  $('draft-save-state').textContent=draft.id?'Saved revision '+draft.revision:'Unsaved working document';$('prepare-draft').disabled=!draft.id;
  findingList($('draft-findings'),draft.review?.findings??[]);shown('draft-findings',Boolean(draft.review?.findings?.length));renderDraftLines();
  $('draft-editor').scrollIntoView({block:'start',behavior:'smooth'});
}
function collectDraft(){
  if(!state.working)throw new Error('Open a working document first.');
  if(state.lineIndex!==null)applyLineEdit(false);
  const d=clone(state.working),h=d.header;
  d.documentId=$('draft-document-id').value;
  optionalText(h,'date',$('draft-date').value);optionalText(h,'currency',$('draft-currency').value);optionalText(h,'supplierOrderId',$('draft-supplier-order').value);
  h.deliveryDate=readDate('draft-date',h.deliveryDate);h.parties=parseValue('draft-parties');h.packages=parseValue('draft-packages','array');h.remarks=parseValue('draft-remarks','array');d.summary=parseValue('draft-summary');
  state.working=d;return d;
}
function renderDraftLines(){
  const body=clear($('draft-lines').tBodies[0]);
  for(let i=0;i<(state.working?.items.length??0);i++){const item=state.working.items[i],tr=node('tr');if(i===state.lineIndex)tr.classList.add('selected');
    tr.append(node('td',item.lineId),node('td',(item.orderReference?.orderId??state.working.orderId??'')+' / '+(item.orderReference?.lineId??item.lineId)),node('td',item.article?.supplierId??''),node('td',item.quantity??'','number'),node('td',item.unit??''),node('td',item.price?.amount??'—','number'));
    const action=node('td');action.append(button('Edit complete line',()=>editLine(i)));tr.append(action);body.append(tr);
  }
}
function editLine(index){
  if(state.lineIndex!==null)applyLineEdit(false);
  state.lineIndex=index;const item=state.working.items[index];if(!item)return;shown('draft-line-editor',true);$('draft-line-heading').textContent='Complete line '+item.lineId;
  for(const [id,value]of Object.entries({'edit-line-id':item.lineId,'edit-order-id':item.orderReference?.orderId??state.working.orderId,'edit-order-line':item.orderReference?.lineId??item.lineId,'edit-order-date':item.orderReference?.date,'edit-article':item.article?.supplierId,'edit-description':item.article?.descriptionShort,'edit-description-long':item.article?.descriptionLong,'edit-quantity':item.quantity,'edit-unit':item.unit,'edit-price-type':item.price?.type,'edit-price-amount':item.price?.amount,'edit-price-quantity':item.price?.quantity,'edit-line-amount':item.price?.lineAmount,'edit-tax':item.price?.tax,'edit-tax-amount':item.price?.taxAmount,'edit-price-currency':item.price?.currency}))setValue(id,value);
  dateValues('edit-date',item.deliveryDate);
  for(const [id,value]of Object.entries({'edit-buyer-ids':item.article?.buyerIds??[],'edit-delivery-references':item.deliveryReferences??[],'edit-packages':item.packages??[],'edit-remarks':item.remarks??[],'edit-serials':item.serials??[]}))$(id).value=json(value);
  renderDraftLines();
}
function applyLineEdit(dirty=true){
  if(state.lineIndex===null)return;
  const item=clone(state.working.items[state.lineIndex]);item.lineId=$('edit-line-id').value;item.quantity=$('edit-quantity').value;item.unit=$('edit-unit').value;
  item.article={...(item.article??{}),supplierId:$('edit-article').value,buyerIds:parseValue('edit-buyer-ids','array')};
  optionalText(item.article,'descriptionShort',$('edit-description').value);optionalText(item.article,'descriptionLong',$('edit-description-long').value);
  const refOrder=$('edit-order-id').value,refLine=$('edit-order-line').value,refDate=$('edit-order-date').value;
  item.orderReference=refOrder||refLine||refDate?{...(item.orderReference??{}),orderId:refOrder,lineId:refLine}:null;
  if(item.orderReference)optionalText(item.orderReference,'date',refDate);
  const priceFields={type:'edit-price-type',amount:'edit-price-amount',quantity:'edit-price-quantity',lineAmount:'edit-line-amount',tax:'edit-tax',taxAmount:'edit-tax-amount',currency:'edit-price-currency'},present=Object.values(priceFields).some(id=>$(id).value!=='');
  item.price=present?{...(item.price??{})}:null;
  if(item.price)for(const [key,id]of Object.entries(priceFields))optionalText(item.price,key,$(id).value);
  item.deliveryDate=readDate('edit-date',item.deliveryDate);item.deliveryReferences=parseValue('edit-delivery-references','array');item.packages=parseValue('edit-packages','array');item.remarks=parseValue('edit-remarks','array');
  state.working.items[state.lineIndex]=item;
  if(dirty){markDirty();renderDraftLines();$('draft-complete-json').value=json(state.working);}
}
function showNewDraft(kind){if(!state.order)throw new Error('Select an original order first.');$('new-draft-kind').value=kind;$('new-draft-orders').value=json([state.order.orderId]);$('new-draft-dialog').showModal();}
async function makeDraft(){
  const orderIds=parseValue('new-draft-orders','array');if(!orderIds.length||orderIds.some(id=>typeof id!=='string'||!id))throw new Error('Select at least one exact original order ID.');
  const draft=await api('/drafts/new',{method:'POST',body:{kind:$('new-draft-kind').value,orderIds}});
  $('new-draft-dialog').close();openEditor(draft);
}
async function copyDocumentToDraft(){
  const row=state.document;if(!row||row.kind==='ORDER')return;
  if(state.dirty&&!confirm('Replace the unsaved working document in this tab?'))return;
  const draft=await api('/drafts/new',{method:'POST',body:{kind:row.kind,orderIds:row.orderIds}});
  draft.document=clone(row.document);draft.reason='Working revision of original '+row.documentId+' source '+row.source.sha256;if(openEditor(draft)!==false)markDirty();
}
async function restoreLines(){
  if(!state.draft)return;collectDraft();
  const selected=await api('/drafts/new',{method:'POST',body:{kind:state.draft.kind,orderIds:state.draft.orderIds}});
  state.working.items=clone(selected.document.items);state.draft.orderRevisions=clone(selected.orderRevisions);state.draft.sourceOrderDocuments=clone(selected.sourceOrderDocuments??{});
  state.lineIndex=null;shown('draft-line-editor',false);$('draft-summary').value=json({...state.working.summary,totalItems:String(state.working.items.length)});
  markDirty();renderDraftLines();$('draft-complete-json').value=json(state.working);
}
function addLine(){
  collectDraft();let number=1;const ids=new Set(state.working.items.map(item=>item.lineId));while(ids.has(String(number)))number++;
  const first=state.working.items[0];const line={lineId:String(number),article:{supplierId:'',buyerIds:[],descriptionShort:''},quantity:'',unit:first?.unit??'',price:null,deliveryDate:null,orderReference:{orderId:state.draft.orderIds[0],lineId:'',date:null},deliveryReferences:[],packages:[],remarks:[],serials:[],sourcePath:null};
  state.working.items.push(line);markDirty();editLine(state.working.items.length-1);
}
function removeLine(){if(state.lineIndex===null)return;state.working.items.splice(state.lineIndex,1);state.lineIndex=null;shown('draft-line-editor',false);markDirty();renderDraftLines();$('draft-complete-json').value=json(state.working);}
function useCompleteJSON(){
  const selected=parseValue('draft-complete-json');
  if(selected.schema!=='stellar-forge.supplier-order-document.v1'||selected.kind!==state.draft.kind||!Array.isArray(selected.items)||!selected.header||!selected.summary)throw new Error('Retain the complete selected document schema, kind, header, items and summary.');
  const draft={...clone(state.draft),document:selected,reason:$('draft-reason').value,roundingPolicy:roundPolicy()};openEditor(draft);markDirty();
}
function numericText(value,label){const result=decimal(value);if(result===null)throw new Error(label+' is a nonterminating decimal. Select the actual agreed rounding policy before calculating its XML value.');return result;}
function calculateAmounts(){
  const d=clone(collectDraft()),policy=roundPolicy();let net=ZERO,taxTotal=ZERO;
  for(const item of d.items){
    if(!item.price?.amount)throw new Error('Each selected line needs its original price before calculating complete amounts.');
    let amount=divide(multiply(exact(item.price.amount),exact(item.quantity)),exact(item.price.quantity??'1'));
    if(policy)amount=rounded(amount,policy);item.price.lineAmount=numericText(amount,'Net line amount');net=add(net,amount);
    if(item.price.tax===undefined||item.price.tax===null||item.price.tax==='')throw new Error('Each selected line needs its actual tax fraction before calculating complete tax.');
    let tax=multiply(amount,exact(item.price.tax));
    if(policy?.taxBasis==='line')tax=rounded(tax,policy);
    const lineTax=decimal(tax);if(lineTax!==null)item.price.taxAmount=lineTax;else delete item.price.taxAmount;
    taxTotal=add(taxTotal,tax);
  }
  if(policy?.taxBasis==='document')taxTotal=rounded(taxTotal,policy);
  d.summary={...d.summary,totalItems:String(d.items.length),totalAmount:numericText(net,'Complete net amount'),totalTaxAmount:numericText(taxTotal,'Complete tax amount')};
  state.working=d;state.lineIndex=null;shown('draft-line-editor',false);$('draft-summary').value=json(d.summary);$('draft-complete-json').value=json(d);markDirty();renderDraftLines();message('Calculated complete line amounts and totals using the selected exact rounding policy. Save this revision to receive the original document review.');
}
async function saveDraft(){
  const document=collectDraft(),reason=$('draft-reason').value;if(!reason.trim())throw new Error('Describe the reason for this complete document revision.');
  const body={kind:state.draft.kind,orderIds:clone(state.draft.orderIds),document,reason,roundingPolicy:roundPolicy(),expectedOrderRevisions:clone(state.draft.orderRevisions??{}),sourceOrderDocuments:clone(state.draft.sourceOrderDocuments??{})};
  if(state.draft.id){body.draftId=state.draft.id;body.expectedRevision=state.draft.revision;}
  return mutate('draft-save','/drafts',body);
}
async function prepareDraft(){if(state.dirty)throw new Error('Save the edited document revision before preparing its complete XML.');if(!state.draft?.id)throw new Error('Save a complete working revision first.');return mutate('draft-prepare','/drafts/'+encoded(state.draft.id)+'/prepare',{draftId:state.draft.id,expectedRevision:state.draft.revision});}
async function selectCurrentDocument(){
  if(!state.document||!state.order)return;const reason=$('selection-reason').value;if(!reason.trim())throw new Error('Explain why this document revision is current.');
  return mutate('document-select','/documents/'+encoded(state.document.id)+'/select',{id:state.document.id,orderId:state.order.orderId,expectedOrderRevision:state.order.revision,reason});
}
async function checksum(file,progress=null){
  if(!hashes.has(file)){const promise=sha256File(file,{onProgress:row=>{if(progress)$(progress).textContent='Reading original file: '+row.bytes.toLocaleString()+' / '+row.total.toLocaleString()+' bytes';}});hashes.set(file,promise);promise.catch(()=>hashes.delete(file));}
  return hashes.get(file);
}
function openSource(){if(!state.workspace)throw new Error('Wait for the original workspace to open.');$('source-order-revisions').value=json(state.workspace.orderRevisions??{});$('source-progress').textContent='';$('source-dialog').showModal();}
async function receiveSource(){
  const file=$('source-file').files[0];if(!file)throw new Error('Select the original XML file.');if(file.size===0||file.size>64*1024*1024)throw new Error('Select a nonempty original XML document up to 64 MiB.');
  if(state.request){state.requestFile=file;showRequest();return retryOriginal();}
  const expectedOrderRevisions=parseValue('source-order-revisions');for(const [id,revision]of Object.entries(expectedOrderRevisions))if(!id||!Number.isSafeInteger(revision)||revision<0)throw new Error('Current order revisions must map exact order IDs to nonnegative revision integers.');
  const sha256=await checksum(file,'source-progress'),provenance={};
  for(const [key,id]of Object.entries({publisher:'source-publisher',revision:'source-revision',url:'source-url',note:'source-note'}))if($(id).value)provenance[key]=$(id).value;
  const input={name:file.name,bytes:file.size,sha256};$('source-progress').textContent='Receiving the complete original XML and its selected revisions.';
  return mutate('source','/sources',{...input,provenance,selection:$('source-selection').value,expectedOrderRevisions},input,file);
}
async function importPackage(){
  const file=$('package-file').files[0];if(!file)throw new Error('Select the complete customer ZIP.');if(!file.size||file.size>8*1024*1024*1024)throw new Error('Select a nonempty original customer package up to 8 GiB.');
  if(state.request){state.requestFile=file;showRequest();return retryOriginal();}
  const input={name:file.name,bytes:file.size,sha256:await checksum(file,'package-progress')};$('package-progress').textContent='Receiving complete original workspace files and histories.';
  return mutate('package-import','/packages/import',{...input,mode:'merge'},input,file);
}
async function exportPackage(){return mutate('package-export','/packages/export',{});}
async function downloadFile(file,path=null){
  if(!file||typeof file.name!=='string'||!Number.isSafeInteger(file.bytes)||file.bytes<0||!/^[0-9a-f]{64}$/.test(file.sha256))throw new Error('The original workspace must return the complete file receipt before download.');
  const route=path??('/files/'+encoded(file.id));let handle=null,writer=null;
  if(window.showSaveFilePicker){handle=await window.showSaveFilePicker({suggestedName:file.name});writer=await handle.createWritable();}
  else if(file.bytes>128*1024*1024)throw new Error('For this complete file size, use a browser with direct file saving or the installed supplier-order CLI.');
  const controller=new AbortController();let reader=null,finished=false;const chunks=[],hash=new Sha256();let bytes=0;
  try{
    const result=await response(route,{signal:controller.signal});if(!result.body)throw new Error('The original file response has no readable body.');
    reader=result.body.getReader();
    while(true){const step=await reader.read();if(step.done)break;bytes+=step.value.byteLength;if(bytes>file.bytes)throw new Error('The download exceeded its original retained length.');hash.update(step.value);if(writer)await writer.write(step.value);else chunks.push(step.value);message('Downloading '+file.name+': '+bytes.toLocaleString()+' / '+file.bytes.toLocaleString()+' bytes');}
    if(bytes!==file.bytes||hash.hex()!==file.sha256)throw new Error('The completed download differs from its original length or SHA-256.');
    if(writer){await writer.close();writer=null;}else{const link=node('a');const url=URL.createObjectURL(new Blob(chunks,{type:file.mimeType??'application/octet-stream'}));link.href=url;link.download=file.name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
    finished=true;message('Downloaded '+file.name+' · '+bytes.toLocaleString()+' bytes · SHA-256 '+file.sha256);
  }finally{if(!finished)controller.abort();try{await reader?.cancel();}catch{}reader?.releaseLock();if(writer)await writer.abort().catch(()=>{});}
}
async function downloadSelectedDocument(){
  const row=state.document;if(!row)return;return downloadFile({id:row.id,name:row.source.name,bytes:row.source.bytes,sha256:row.source.sha256,mimeType:'application/xml'},'/documents/'+encoded(row.id)+'/file');
}
async function receiveResult(kind,result,request){
  if(kind==='draft-save'){const draft=result.draft??(result.draftId?await api('/drafts/'+encoded(result.draftId)):null);if(!draft)throw new Error('The saved operation did not return its original draft identity.');if(request?.editorGeneration===state.editorGeneration){openEditor(draft,{accepted:true});message('Saved working document revision '+draft.revision+'.');}else{state.draft=clone(draft);state.dirty=true;$('draft-revision').textContent='Saved original revision '+draft.revision+' · newer local edits retained';$('draft-save-state').textContent='The original request is saved; newer edits remain unsaved';$('prepare-draft').disabled=true;message('Saved original request revision '+draft.revision+'. Your newer edited fields remain in the working document.');}await refresh({preserveEditor:true});return;}
  if(kind==='draft-prepare'){const record=result.document??(result.documentId?await api('/documents/'+encoded(result.documentId)):null),file=result.file;if(!record||!file)throw new Error('The completed preparation must return its document and full file receipt.');state.prepared={record,file};properties($('prepared-metadata'),[['Document',record.documentId],['Revision',record.revision],['Prepared from working revision',request?.body.expectedRevision],['File',file.name],['Bytes',file.bytes],['SHA-256',file.sha256]]);shown('prepared-result',true);await refresh({preserveEditor:true});message('Prepared the complete XML. Review its revision selection when it should contribute to current quantities.');return;}
  if(kind==='package-export'){const file=result.file;if(!file)throw new Error('The completed workspace export has no retained file receipt.');const target=clear($('package-result'));properties(target,[['File',file.name],['Bytes',file.bytes],['SHA-256',file.sha256]]);target.append(button('Download complete customer ZIP',()=>downloadFile(file)));message('The complete customer package is retained for download.');return;}
  if(kind==='source'){if($('source-dialog').open)$('source-dialog').close();await refresh({preserveEditor:true});if(result.orderIds?.length)await selectOrder(result.orderIds[0]);if(result.document?.id)await selectDocument(result.document.id);else if(result.documentId)await selectDocument(result.documentId);message('Received the original XML and retained its complete source and document revision.');return;}
  if(kind==='document-select'){const id=state.document?.id;await refresh({preserveEditor:true});if(id)await selectDocument(id);message('The selected document revision now contributes to the current order reconciliation.');return;}
  if(kind==='package-import'){await refresh({preserveEditor:true});$('package-progress').textContent='Complete customer workspace received. Original histories and existing newer work are available.';message('Received the complete original customer package.');}
}

auth();
for(const value of ['AWAITING_CONFIRMATION','IN_PROGRESS','REVIEW','COMPLETE']){const option=node('option',value.replaceAll('_',' '));option.value=value;$('order-status').append(option);}
for(const control of document.querySelectorAll('[data-close]'))control.addEventListener('click',()=>$(control.dataset.close).close());
for(const control of document.querySelectorAll('[data-tab]'))control.addEventListener('click',()=>selectTab(control.dataset.tab));
$('refresh').addEventListener('click',guard(()=>refresh({preserveEditor:true})));
$('order-search').addEventListener('submit',guard(async()=>{state.orderOffset=0;await refresh({preserveEditor:true});}));
$('orders-previous').addEventListener('click',guard(async()=>{state.orderOffset=Math.max(0,state.orderOffset-PAGE);await refresh({preserveEditor:true});}));
$('orders-next').addEventListener('click',guard(async()=>{state.orderOffset+=PAGE;await refresh({preserveEditor:true});}));
$('document-kind').addEventListener('change',guard(async()=>{state.documentOffset=0;await loadDocuments();}));
$('documents-previous').addEventListener('click',guard(async()=>{state.documentOffset=Math.max(0,state.documentOffset-PAGE);await loadDocuments();}));
$('documents-next').addEventListener('click',guard(async()=>{state.documentOffset+=PAGE;await loadDocuments();}));
$('differences-only').addEventListener('change',renderLines);
$('close-line').addEventListener('click',()=>shown('line-detail',false));
$('close-document').addEventListener('click',()=>shown('document-detail',false));
$('document-selection').addEventListener('submit',guard(selectCurrentDocument));
$('document-download').addEventListener('click',guard(downloadSelectedDocument));
$('document-copy-draft').addEventListener('click',guard(copyDocumentToDraft));
$('drafts-refresh').addEventListener('click',guard(()=>refresh({preserveEditor:true})));
for(const [id,kind]of [['new-confirmation','ORDERRESPONSE'],['new-dispatch','DISPATCHNOTIFICATION'],['new-invoice','INVOICE']])$(id).addEventListener('click',guard(()=>showNewDraft(kind)));
$('new-draft-form').addEventListener('submit',guard(makeDraft));
$('draft-form').addEventListener('submit',guard(saveDraft));
$('draft-form').addEventListener('input',markDirty);
$('draft-form').addEventListener('change',markDirty);
$('apply-line-edit').addEventListener('click',guard(()=>applyLineEdit()));
$('add-draft-line').addEventListener('click',guard(addLine));
$('remove-draft-line').addEventListener('click',guard(removeLine));
$('restore-order-lines').addEventListener('click',guard(restoreLines));
$('apply-complete-json').addEventListener('click',guard(useCompleteJSON));
$('calculate-draft').addEventListener('click',guard(calculateAmounts));
$('prepare-draft').addEventListener('click',guard(prepareDraft));
$('prepared-download').addEventListener('click',guard(()=>downloadFile(state.prepared?.file)));
$('prepared-select').addEventListener('click',guard(async()=>{if(state.prepared?.record){await selectDocument(state.prepared.record.id);$('document-detail').scrollIntoView({block:'center',behavior:'smooth'});}}));
$('close-draft').addEventListener('click',()=>{if(state.request?.kind.startsWith('draft')){showRequest();return;}if(state.dirty&&!confirm('Close this unsaved working document?'))return;state.working=null;state.draft=null;state.dirty=false;state.lineIndex=null;shown('draft-editor',false);});
$('draft-conflict-restore').addEventListener('click',guard(()=>{if(!state.conflictDraft||!state.draft)return;const prior=clone(state.conflictDraft),current={...clone(state.draft),document:prior.document,reason:prior.reason,roundingPolicy:prior.roundingPolicy};openEditor(current,{accepted:true});state.conflictDraft=prior;shown('draft-conflict',true);$('draft-conflict-json').textContent=json(prior);markDirty();}));
$('open-source').addEventListener('click',guard(openSource));
$('source-form').addEventListener('submit',guard(receiveSource));
$('source-file').addEventListener('change',()=>{if(state.request?.kind==='source')state.requestFile=$('source-file').files[0]??null;});
$('open-transfer').addEventListener('click',()=>{$('transfer-dialog').showModal();});
$('export-workspace').addEventListener('click',guard(exportPackage));
$('import-workspace-form').addEventListener('submit',guard(importPackage));
$('package-file').addEventListener('change',()=>{if(state.request?.kind==='package-import')state.requestFile=$('package-file').files[0]??null;});
$('request-retry').addEventListener('click',guard(retryOriginal));
$('request-revise').addEventListener('click',guard(reviewCurrentRequest));
window.addEventListener('beforeunload',event=>{if(state.dirty||state.busy){event.preventDefault();event.returnValue='';}});
refresh().then(()=>{if(state.request)showRequest();}).catch(error=>message(error.message,true));
