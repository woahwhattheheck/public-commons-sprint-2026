// MIT. Customer statement operator desk. All displayed values are inserted as text.
const $=id=>document.getElementById(id);
const API='/api/customer-statements';
let state=null,working=false,preview=null,currentDocument=null,pendingRetention=null,bindingsOffset=0,bindingsTotal=0,registerOffset=0,registerTotal=0;
const knownStatements=new Map();
const create=(tag,text,className)=>{
  const element=document.createElement(tag);if(text!==undefined&&text!==null)element.textContent=String(text);if(className)element.className=className;return element;
};
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function actor(){const value=$('operator').value.trim();if(!value)throw new Error('Enter the operator name before saving workspace changes.');try{localStorage.setItem('merchant-customer-statement-operator',value);}catch{}return value;}
function readable(value){return String(value??'Unrecorded').replaceAll('_',' ').toLowerCase();}
function setOptions(element,rows,emptyLabel,selected=element.value){
  element.replaceChildren();
  if(emptyLabel!==null){const option=create('option',emptyLabel);option.value='';element.append(option);}
  for(const row of rows){const option=create('option',row.label);option.value=row.value;element.append(option);}
  if([...element.options].some(option=>option.value===selected))element.value=selected;
}
function availability(){
  document.querySelectorAll('button').forEach(button=>button.disabled=working);
  $('assign-button').disabled=working||!$('customer-picker').value;
  $('retain').disabled=working||(!preview&&!pendingRetention);
  $('bindings-prev').disabled=working||bindingsOffset===0;
  $('bindings-next').disabled=working||bindingsOffset+50>=bindingsTotal;
  $('register-prev').disabled=working||registerOffset===0;
  $('register-next').disabled=working||registerOffset+50>=registerTotal;
  $('correct-document').disabled=working||currentDocument?.statement.status!=='RETAINED';
  document.body.classList.toggle('working',working);
  document.body.setAttribute('aria-busy',String(working));
}
async function run(action){
  if(working)return;working=true;availability();
  try{await action();}
  catch(error){status(error.message||'The operation failed.',true);}
  finally{working=false;availability();}
}
async function request(path='',value){
  const response=await fetch(API+path,{method:value===undefined?'GET':'POST',cache:'no-store',
    headers:value===undefined?{}:{'Content-Type':'application/json','X-Workspace-Request':'1'},...(value===undefined?{}:{body:JSON.stringify(value)})});
  let result;
  try{result=await response.json();}catch{throw Object.assign(new Error('The workspace response could not be read. Refresh the register to recover the current document state.'),{uncertain:true});}
  if(!response.ok)throw Object.assign(new Error(result.error?.message??result.message??'The workspace operation failed.'),{code:typeof result.error==='string'?result.error:result.error?.code,status:response.status});
  return result;
}
function clearPreview(){
  preview=null;$('preview-panel').hidden=true;
  if(!pendingRetention){$('retain').textContent='Retain statement';$('retention-note').textContent='Review the original purchases, usage and adjustments before retaining this document.';}
}
function takeState(value){
  state=value;$('revision').textContent='Workspace revision '+state.revision;
  for(const row of state.statements)knownStatements.set(row.id,row);
  const chosen=$('customer-picker').value;
  const customers=state.customers.map(row=>({value:row.id,label:row.reference+' · '+row.name}));
  setOptions($('customer-picker'),customers,'New customer',chosen);
  setOptions($('statement-customer'),customers,'Choose customer');
  setOptions($('register-customer'),customers,'All customers');
  setOptions($('statement-run'),state.runs.map(row=>({value:row.id,label:(row.name??row.id)+' · '+(row.completedAt??row.createdAt??'')})),'Choose completed run');
  setOptions($('statement-usage'),state.usageImports.map(row=>({value:row.id,label:row.name+' · '+row.sourceCreatedAt})),'Purchases only');
  updateCorrections();
  $('metrics').replaceChildren();
  for(const [name,value] of [['Customers',state.customers.length],['Assigned orders',state.bindingCount],['Retained documents',state.statementCount],['Completed accounting runs',state.runs.length]]){
    const card=create('div',null,'metric');card.append(create('span',name),create('strong',value));$('metrics').append(card);
  }
  const latest=state.usageImports[0];$('usage-summary').replaceChildren();
  if(latest){$('usage-summary').append(create('p',latest.name),create('small',latest.orderCount+' original orders · Captured '+latest.sourceCreatedAt),
    create('small','Service revision '+latest.sourceRevision+' · '+state.usageImportCount+' retained captures'));}
  else $('usage-summary').append(create('p','No service usage captures imported.'));
  if(preview&&preview.revision!==state.revision&&!pendingRetention)clearPreview();
}
function fillCustomer(id){
  const row=state.customers.find(row=>row.id===id),form=$('customer-form');
  for(const key of ['reference','name','email','address','note'])form.elements[key].value=row?.[key]??'';
  form.dataset.id=row?.id??'';form.dataset.version=row?.version??'';
  if(row)$('statement-customer').value=row.id;
  updateCorrections();availability();
}
function updateCorrections(){
  const customerId=$('statement-customer').value;
  setOptions($('statement-replaces'),[...knownStatements.values()].filter(row=>row.status==='RETAINED'&&row.customerId===customerId)
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(row=>({value:row.id,label:row.number+' · '+row.createdAt})),'New statement');
}
async function loadBindings(){
  const customerId=$('customer-picker').value;
  const body=$('binding-rows');body.replaceChildren();
  if(!customerId){bindingsOffset=0;bindingsTotal=0;$('binding-count').textContent='';$('bindings-page').textContent='Choose customer';return;}
  const page=await request('/bindings?'+new URLSearchParams({customerId,offset:bindingsOffset,limit:50}));
  bindingsTotal=page.total;
  for(const row of page.items){const tr=create('tr');tr.append(create('td',row.orderRef,'mono'),create('td',row.label||'—'),create('td',row.version));body.append(tr);}
  if(!page.items.length){const td=create('td','No original orders assigned.','empty');td.colSpan=3;const tr=create('tr');tr.append(td);body.append(tr);}
  $('binding-count').textContent=page.total+' orders';
  $('bindings-page').textContent=page.total?String(bindingsOffset+1)+'–'+Math.min(bindingsOffset+50,page.total)+' of '+page.total:'0 orders';
}
async function loadRegister(){
  const query={offset:registerOffset,limit:50};
  if($('register-customer').value)query.customerId=$('register-customer').value;
  if($('register-status').value)query.status=$('register-status').value;
  const page=await request('/statements?'+new URLSearchParams(query));registerTotal=page.total;
  const body=$('register-rows');body.replaceChildren();
  for(const row of page.items){
    knownStatements.set(row.id,row);const tr=create('tr'),number=create('td',row.number),person=create('td',row.customerName);
    person.append(create('small',row.customerReference));const stateCell=create('td');stateCell.append(create('span',row.status,'badge'));
    const open=create('button','Open');open.type='button';open.addEventListener('click',()=>run(()=>openDocument(row.id)));const action=create('td');action.append(open);
    tr.append(number,person,create('td',row.createdAt),create('td',row.orderCount,'numeric'),stateCell,action);body.append(tr);
  }
  if(!page.items.length){const td=create('td','No retained statements match this selection.','empty');td.colSpan=6;const tr=create('tr');tr.append(td);body.append(tr);}
  $('register-page').textContent=page.total?String(registerOffset+1)+'–'+Math.min(registerOffset+50,page.total)+' of '+page.total:'0 documents';
  updateCorrections();
}
async function refresh(){
  takeState(await request());await loadBindings();await loadRegister();
  status('Workspace revision '+state.revision+' loaded.');
}
function addDefinition(dl,name,value,mono=false){dl.append(create('dt',name),create('dd',value,mono?'mono':null));}
function assetsTable(documentValue){
  const table=create('table'),head=create('thead'),tr=create('tr');
  for(const title of ['Network / asset / recipient','Orders','Original atomic amount','Officially matched','Verified refunds','Pending refunds'])tr.append(create('th',title));
  head.append(tr);table.append(head);const body=create('tbody');
  for(const row of documentValue.totals.byAsset){
    const tr=create('tr'),asset=create('td',row.network);
    asset.append(create('small','Asset '+row.assetDigest,'mono'),create('small','Recipient '+(row.recipientDigest??'unrecorded'),'mono'));tr.append(asset);
    for(const key of ['orders','reportedAmountAtomic','officialMatchedAmountAtomic','refundedAmountAtomic','pendingRefundAmountAtomic'])tr.append(create('td',row[key],'numeric'));
    body.append(tr);
  }
  table.append(body);const wrap=create('div',null,'table-wrap');wrap.append(table);return wrap;
}
const exclusionNames={
  ORDER_NOT_IN_SELECTED_REPORT:'Assigned order absent from the selected report or recorded date range.',
  AMBIGUOUS_ORDER_EVENTS:'Several original events use this assigned order reference.',
  SERVICE_PAYMENT_IDENTITY_MISMATCH:'The service usage snapshot differs from the original order, event or payment terms.',
  ORIGINAL_NATIVE_ORDER_REQUIRED:'The original native checkout capture is required for this order.'
};
function renderDocument(value,target){
  target.replaceChildren();
  const scope=create('p',value.selection.from?'Recorded purchases: '+value.selection.from+' through '+value.selection.until+' (end exclusive).':'All recorded purchases in the selected report.','document-scope');
  target.append(scope);
  const counts=create('div',null,'summary-grid');
  for(const [title,count] of [['Original orders',value.totals.orders],['Orders with usage',value.totals.serviceOrders],['Transfer reconciliation',value.totals.requiringReconciliation],['Assigned orders excluded',value.excluded.length]]){
    const card=create('div');card.append(create('span',title),create('strong',count));counts.append(card);
  }
  target.append(counts,assetsTable(value));
  const quotes=value.totals.merchantQuotedUsd;
  target.append(create('p','Known merchant USD quotes: '+quotes.knownTotal+' across '+quotes.knownOrders+' orders. '+quotes.unknownOrders+' orders have no recorded quote.','muted'));
  if(value.source.usage)target.append(create('p','Service units are cumulative as of '+value.source.usage.createdAt+' · Service revision '+value.source.usage.revision+'.','inset'));
  for(const row of value.items){
    const article=create('article',null,'purchase'),heading=create('div',null,'purchase-head'),left=create('div');
    left.append(create('h3',row.label),create('p','Order '+row.orderRef+' · '+row.recordedAt,'mono'));
    heading.append(left,create('strong',row.amountAtomic+' atomic units'));article.append(heading);
    const terms=create('dl',null,'key-values');
    addDefinition(terms,'Network',row.network);addDefinition(terms,'Asset',row.assetDigest,true);
    addDefinition(terms,row.recipientDigest?'Recorded recipient':row.termsRecipientDigest?'Recipient from selected terms':'Recipient',row.recipientDigest??row.termsRecipientDigest??'Unrecorded',true);
    addDefinition(terms,'Transfer',readable(row.transfer)+' · '+readable(row.verificationScope));
    addDefinition(terms,'Delivery',readable(row.delivery));
    addDefinition(terms,'Merchant USD quote',row.merchantQuoteUsd===null?'Unrecorded':row.merchantQuoteUsd+(row.merchantPriceBasis?' · '+row.merchantPriceBasis:''));
    addDefinition(terms,'Verified refunds',row.adjustmentSummary.refundedAmountAtomic+' atomic units');
    addDefinition(terms,'Pending refunds',row.adjustmentSummary.pendingRefundAmountAtomic+' atomic units');
    addDefinition(terms,'Recorded cancellations',row.adjustmentSummary.cancelledAmountAtomic+' atomic units');
    if(row.exception)addDefinition(terms,'Reconciliation',readable(row.exception));article.append(terms);
    if(row.service){
      const service=row.service;article.append(create('h3',service.planLabel));
      const units=create('div',null,'usage-units');
      for(const [title,key] of [['Purchased','unitsPurchased'],['Used','unitsUsed'],['Reserved','unitsReserved'],['Remaining','unitsRemaining']]){
        const item=create('div');item.append(create('span',title),create('b',service[key]));units.append(item);
      }
      article.append(units,create('p','Entitled '+service.entitledAt+' · Plan '+service.planId,'muted'));
    }else article.append(create('p',row.usageStatus==='NO_USAGE_SNAPSHOT'?'Purchase statement without a selected usage capture.':'This order is absent from the selected service usage capture.','muted'));
    if(row.service?.callsComplete){
      const calls=create('details');calls.append(create('summary','Original service call history · '+row.service.calls.length+' calls'));
      const table=create('table'),head=create('thead'),tr=create('tr');for(const name of ['Request / route','Unit price / consumed / reserved','Durable outcome','Updated at'])tr.append(create('th',name));head.append(tr);table.append(head);
      const body=create('tbody');
      for(const call of row.service.calls){const tr=create('tr'),identity=create('td',call.requestId,'mono');identity.append(create('small',call.method+' '+call.path));
        const outcome=create('td',readable(call.storedStatus));if(call.status!==call.storedStatus)outcome.append(create('small',readable(call.status)));
        tr.append(identity,create('td',call.units+' / '+call.consumedUnits+' / '+call.reservedUnits,'numeric'),outcome,create('td',call.updatedAt));body.append(tr);}
      table.append(body);const wrap=create('div',null,'table-wrap');wrap.append(table);calls.append(wrap);article.append(calls);
    }
    if(row.adjustments.length){
      const table=create('table'),head=create('thead'),tr=create('tr');for(const name of ['Adjustment','Status','Atomic amount','Effective at'])tr.append(create('th',name));head.append(tr);table.append(head);
      const body=create('tbody');
      for(const adjustment of row.adjustments){const item=create('tr');item.append(create('td',readable(adjustment.kind)),create('td',readable(adjustment.status)),create('td',adjustment.amountAtomic,'numeric'),create('td',adjustment.effectiveAt));body.append(item);}
      table.append(body);article.append(table);
    }
    const details=create('details');details.append(create('summary','Original order and payment identifiers'));const identifiers=create('dl',null,'key-values');
    addDefinition(identifiers,'Original event',row.eventId,true);addDefinition(identifiers,'Order digest',row.orderReferenceDigest,true);
    addDefinition(identifiers,'Receipt fingerprint',row.receiptFingerprint,true);addDefinition(identifiers,'Transaction fingerprint',row.transactionFingerprint??'Unrecorded',true);
    if(row.service)addDefinition(identifiers,'Purchased plan revision',row.service.planRevision,true);
    details.append(identifiers);article.append(details);target.append(article);
  }
  if(value.excluded.length){
    const section=create('section',null,'subsection');section.append(create('h3','Assigned orders outside this statement'));
    const table=create('table'),head=create('thead'),tr=create('tr');tr.append(create('th','Original order'),create('th','Reason'));head.append(tr);table.append(head);const body=create('tbody');
    for(const row of value.excluded){const tr=create('tr'),reason=create('td',exclusionNames[row.code]??row.code);reason.title=row.code;tr.append(create('td',row.orderRef,'mono'),reason);body.append(tr);}
    table.append(body);section.append(table);target.append(section);
  }
  const source=create('details');source.append(create('summary','Statement source records'));
  const fields=create('dl',null,'key-values');addDefinition(fields,'Original run',value.source.runId,true);addDefinition(fields,'Report SHA-256',value.source.reportSha256,true);
  if(value.source.usage)addDefinition(fields,'Usage SHA-256',value.source.usage.sha256,true);source.append(fields);target.append(source);
}
function renderRetained(result){
  currentDocument=result;knownStatements.set(result.statement.id,result.statement);
  $('document-panel').hidden=false;$('document-title').textContent=result.statement.number+' · '+result.document.customer.name;
  const statusBlock=$('document-status');statusBlock.replaceChildren(create('span',result.statement.status,'badge'));
  if(result.statement.supersededBy)statusBlock.append(create('p','Superseded by retained document '+(knownStatements.get(result.statement.supersededBy)?.number??result.statement.supersededBy)+'.'));
  if(result.statement.replacesId)statusBlock.append(create('p','Correction of '+(knownStatements.get(result.statement.replacesId)?.number??result.statement.replacesId)+'.'));
  const links=$('document-downloads');links.replaceChildren();
  for(const [name,title] of [['statement.html','Print document'],['statement.csv','Purchase CSV'],['usage.csv','Service call CSV'],['statement.json','Statement JSON'],['manifest.json','File manifest'],['status.json','Current document status']]){
    const link=create('a',title);link.href=API+'/statements/'+result.statement.id+'/download/'+name;link.download='';links.append(link);
  }
  renderDocument(result.document,$('document-content'));
  const list=$('document-history').querySelector('ol');list.replaceChildren();
  for(const event of result.statement.history)list.append(create('li',event.at+' · '+event.actor+' · '+event.action+(event.reason?' · '+event.reason:'')));
  $('withdraw-form').hidden=result.statement.status!=='RETAINED';
}
async function openDocument(id){
  const detail=await request('/statements/'+id);renderRetained(detail);$('document-panel').scrollIntoView({block:'start',behavior:'smooth'});status('Opened '+detail.statement.number+'.');
}
function utc(value){
  if(!value)return undefined;
  const normalized=new Date(value+'Z');if(!Number.isFinite(normalized.getTime()))throw new Error('Check the UTC recorded purchase period.');return normalized.toISOString();
}
function periodInput(value){return value?value.replace(/Z$/,'').replace(/\.\d+$/,''):'';}
$('refresh').addEventListener('click',()=>run(refresh));
$('new-customer').addEventListener('click',()=>run(async()=>{$('customer-picker').value='';fillCustomer('');bindingsOffset=0;await loadBindings();$('customer-form').elements.reference.focus();status('Enter the new customer profile.');}));
$('customer-picker').addEventListener('change',()=>run(async()=>{fillCustomer($('customer-picker').value);bindingsOffset=0;await loadBindings();}));
$('statement-customer').addEventListener('change',updateCorrections);
$('customer-form').addEventListener('submit',event=>{
  event.preventDefault();run(async()=>{
    const form=event.currentTarget,value=Object.fromEntries(new FormData(form));value.revision=state.revision;value.actor=actor();
    if(form.dataset.id){value.id=form.dataset.id;value.expectedVersion=Number(form.dataset.version);}
    const result=await request('/customers',value);takeState(result.state);$('customer-picker').value=result.customer.id;fillCustomer(result.customer.id);
    bindingsOffset=0;await loadBindings();status('Saved customer '+result.customer.reference+'.');
  });
});
$('assignment-form').addEventListener('submit',event=>{
  event.preventDefault();run(async()=>{
    const form=event.currentTarget,values=new FormData(form),customerId=$('customer-picker').value;
    if(!customerId)throw new Error('Save or select the customer before assigning orders.');
    const orders=String(values.get('orders')).split(/\r?\n/).filter(line=>line.trim()).map(line=>{
      const split=line.indexOf('\t');return {orderRef:(split<0?line:line.slice(0,split)).trim(),label:split<0?'':line.slice(split+1).trim()};
    });
    const result=await request('/bindings',{revision:state.revision,actor:actor(),customerId,orders,reassign:values.get('reassign')==='on',reason:values.get('reason')});
    takeState(result.state);form.reset();bindingsOffset=0;await loadBindings();status(result.changed+' order assignments saved.');
  });
});
$('usage-form').addEventListener('submit',event=>{
  event.preventDefault();run(async()=>{
    const form=event.currentTarget,file=form.elements.file.files[0];if(!file)throw new Error('Choose the original service usage JSON.');
    if(file.size>24000000)throw new Error('Choose a service usage export up to 24 MB.');
    const result=await request('/usage',{revision:state.revision,actor:actor(),name:form.elements.name.value.trim()||file.name,content:await file.text()});
    takeState(result.state);$('statement-usage').value=result.import.id;form.reset();
    status((result.reused?'Opened retained capture ':'Retained usage capture ')+result.import.name+' with '+result.import.orderCount+' original orders.');
  });
});
$('preview-form').addEventListener('submit',event=>{
  event.preventDefault();run(async()=>{
    if(pendingRetention)throw new Error('Retry the pending retention request first so the document register can return its saved result.');
    const values=Object.fromEntries(new FormData(event.currentTarget)),selection={customerId:values.customerId,runId:values.runId,usageId:values.usageId||null,replacesId:values.replacesId||null};
    if(values.from||values.until){if(!values.from||!values.until)throw new Error('Enter both UTC period bounds.');selection.from=utc(values.from);selection.until=utc(values.until);}
    preview=await request('/preview',selection);
    $('preview-panel').hidden=false;$('preview-title').textContent=preview.draft.customer.name+' · '+preview.draft.items.length+' original purchases';
    renderDocument(preview.draft,$('preview-content'));$('retain').textContent='Retain statement';
    $('retention-note').textContent='Review the original purchases, usage and adjustments before retaining this document.';
    $('preview-panel').scrollIntoView({block:'start',behavior:'smooth'});status('Statement prepared at workspace revision '+preview.revision+'.');
  });
});
$('retain').addEventListener('click',()=>run(async()=>{
  if(!pendingRetention){
    if(!preview)throw new Error('Prepare a statement first.');
    pendingRetention={...preview.intent,revision:preview.revision,actor:actor(),requestId:crypto.randomUUID(),previewSha256:preview.previewSha256};
    try{sessionStorage.setItem('merchant-customer-statement-pending',JSON.stringify(pendingRetention));}catch{}
  }
  let result;
  try{result=await request('/retain',pendingRetention);}
  catch(error){
    if(error.status&&error.status<500){
      pendingRetention=null;try{sessionStorage.removeItem('merchant-customer-statement-pending');}catch{}clearPreview();
      takeState(await request());throw error;
    }
    $('preview-panel').hidden=false;$('retain').textContent='Retry same retention';
    $('retention-note').textContent='The retention reply did not complete. Retry this same request to recover its saved document.';
    throw error;
  }
  pendingRetention=null;try{sessionStorage.removeItem('merchant-customer-statement-pending');}catch{}
  takeState(result.state);clearPreview();renderRetained(result);registerOffset=0;
  $('document-panel').scrollIntoView({block:'start',behavior:'smooth'});
  status((result.reused?'Recovered retained document ':'Retained ')+result.statement.number+'.');
  await loadRegister();
}));
$('correct-document').addEventListener('click',()=>run(async()=>{
  if(!currentDocument||currentDocument.statement.status!=='RETAINED')throw new Error('Open a current retained statement to prepare its correction.');
  const {statement,document}=currentDocument;
  $('statement-customer').value=statement.customerId;updateCorrections();$('statement-replaces').value=statement.id;
  $('statement-run').value=statement.runId;$('statement-usage').value=statement.usageId??'';
  $('preview-form').elements.from.value=periodInput(document.selection.from);$('preview-form').elements.until.value=periodInput(document.selection.until);
  $('prepare').scrollIntoView({block:'start',behavior:'smooth'});status('Review source records and prepare the correction of '+statement.number+'.');
}));
$('withdraw-form').addEventListener('submit',event=>{
  event.preventDefault();run(async()=>{
    const form=event.currentTarget,reason=form.elements.reason.value.trim();if(!reason)throw new Error('Enter the reason for withdrawing this document.');
    const result=await request('/statements/'+currentDocument.statement.id+'/withdraw',{revision:state.revision,actor:actor(),reason});
    takeState(result.state);renderRetained(result);form.reset();await loadRegister();status('Document '+result.statement.number+' withdrawn from the current register.');
  });
});
for(const [id,change] of [['bindings-prev',-50],['bindings-next',50]])$(id).addEventListener('click',()=>run(async()=>{bindingsOffset=Math.max(0,bindingsOffset+change);await loadBindings();}));
for(const [id,change] of [['register-prev',-50],['register-next',50]])$(id).addEventListener('click',()=>run(async()=>{registerOffset=Math.max(0,registerOffset+change);await loadRegister();}));
for(const id of ['register-customer','register-status'])$(id).addEventListener('change',()=>run(async()=>{registerOffset=0;await loadRegister();}));
try{$('operator').value=localStorage.getItem('merchant-customer-statement-operator')??'';}catch{}
run(async()=>{
  await refresh();
  try{pendingRetention=JSON.parse(sessionStorage.getItem('merchant-customer-statement-pending')??'null');}catch{pendingRetention=null;}
  if(pendingRetention){
    $('preview-panel').hidden=false;$('preview-title').textContent='Recover pending statement retention';
    $('retain').textContent='Retry same retention';$('retention-note').textContent='A retention request was prepared in this browser session. Retry it to recover its original saved document.';
    status('A pending retention request is available for recovery.');
  }
});
