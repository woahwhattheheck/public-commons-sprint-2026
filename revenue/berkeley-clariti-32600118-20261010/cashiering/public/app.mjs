const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object??{},key);
const list=value=>Array.isArray(value)?value:[];
const obj=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const clone=value=>value===undefined?undefined:structuredClone(value);
const txt=value=>value===null||value===undefined?'Not supplied':typeof value==='boolean'?(value?'Yes':'No'):typeof value==='object'?JSON.stringify(value):String(value);
const label=value=>String(value??'').replace(/[_-]+/g,' ').replace(/^\w/,c=>c.toUpperCase());
const json=value=>JSON.stringify(value,null,2);
const date=value=>value===null||value===undefined||value===''?'Not supplied':String(value).replace('T',' ').replace(/\.000Z$/,' UTC').replace(/Z$/,' UTC');
const short=value=>String(value??'').length>20?String(value).slice(0,10)+'…'+String(value).slice(-6):String(value??'');
const nonblank=value=>String(value??'').trim();
const escAttr=value=>h(value);
const count=value=>Number.isSafeInteger(value)?value.toLocaleString():txt(value);
function minor(value,currency,settings){
  if(value===null||value===undefined)return '<span class="muted">Not supplied</span>';
  const raw=String(value), scale=obj(settings?.scales)[String(currency)];
  if(!/^-?\d+$/.test(raw)||typeof value==='boolean')return h(raw)+' <span class="muted">original value</span>';
  if(!Number.isInteger(scale)||scale<0||scale>12)return h(raw)+' <span class="muted">minor units · scale not supplied</span>';
  const negative=raw.startsWith('-');let digits=(negative?raw.slice(1):raw).replace(/^0+(?=\d)/,'');
  digits=digits.padStart(scale+1,'0');
  const major=scale?digits.slice(0,-scale):digits, fraction=scale?'.'+digits.slice(-scale):'';
  return h((negative?'-':'')+major.replace(/\B(?=(\d{3})+(?!\d))/g,',')+fraction);
}
function money(value,currency,settings){return '<span class="numeric">'+minor(value,currency,settings)+'</span>';}
function badge(value){return '<span class="badge">'+h(value===null||value===undefined?'Not supplied':label(value))+'</span>';}
function button(text,action,attributes='',kind=''){return '<button type="button" class="'+h(kind)+'" data-action="'+h(action)+'" '+attributes+'>'+h(text)+'</button>';}
function empty(title,body='',action=''){return '<div class="empty"><h3>'+h(title)+'</h3>'+(body?'<p>'+h(body)+'</p>':'')+action+'</div>';}
function notice(text,title=''){return '<div class="notice">'+(title?'<strong>'+h(title)+'</strong> ':'')+h(text)+'</div>';}
function details(title,value,open=false){return '<details'+(open?' open':'')+'><summary>'+h(title)+'</summary><pre>'+h(json(value))+'</pre></details>';}
function field(key,title,control,help='',wide=false){return '<div class="field'+(wide?' wide':'')+'"><label for="'+h(key)+'">'+h(title)+'</label>'+control+(help?'<p class="help">'+h(help)+'</p>':'')+'</div>';}
function textInput(key,value='',attrs=''){return '<input id="'+h(key)+'" name="'+h(key)+'" value="'+h(value??'')+'" '+attrs+'>';}
function textArea(key,value='',attrs=''){return '<textarea id="'+h(key)+'" name="'+h(key)+'" data-initial-text="'+h(encodeURIComponent(String(value??'')))+'" '+attrs+'></textarea>';}
function hydrate(root=document){for(const textarea of $('textarea[data-initial-text]',root)){textarea.value=decodeURIComponent(textarea.dataset.initialText);delete textarea.dataset.initialText;}}
function selectInput(key,options,value='',attrs=''){
  return '<select id="'+h(key)+'" name="'+h(key)+'" '+attrs+'>'+options.map(option=>{
    const row=typeof option==='object'?option:{value:option,label:label(option)};
    return '<option value="'+h(row.value)+'"'+(String(row.value)===String(value)?' selected':'')+'>'+h(row.label??row.value)+'</option>';
  }).join('')+'</select>';
}
function checkInput(key,title,checked=false,attrs=''){return '<label class="check"><input type="checkbox" name="'+h(key)+'" id="'+h(key)+'"'+(checked?' checked':'')+' '+attrs+'><span>'+h(title)+'</span></label>';}
function section(title,body,actions='',subtitle=''){return '<section class="panel"><div class="panel-head"><div><h2>'+h(title)+'</h2>'+(subtitle?'<p class="muted">'+h(subtitle)+'</p>':'')+'</div>'+(actions?'<div class="actions">'+actions+'</div>':'')+'</div>'+body+'</section>';}
function dataTable(headers,rows,{emptyText='No recorded entries.',className=''}={}){
  if(!rows.length)return '<p class="muted">'+h(emptyText)+'</p>';
  return '<div class="table-wrap" tabindex="0" role="region" aria-label="'+h(headers.map(x=>typeof x==='string'?x:x.label).join(', '))+'"><table class="'+h(className)+'"><thead><tr>'+headers.map(x=>'<th scope="col"'+(typeof x==='object'&&x.className?' class="'+h(x.className)+'"':'')+'>'+h(typeof x==='string'?x:x.label)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function definitionList(values){return '<dl class="kv">'+values.map(([key,value])=>'<dt>'+h(key)+'</dt><dd>'+value+'</dd>').join('')+'</dl>';}
function stat(title,value,note=''){return '<div class="stat"><span>'+h(title)+'</span><strong>'+h(txt(value))+'</strong>'+(note?'<small>'+h(note)+'</small>':'')+'</div>';}
function externalLink(url,title){
  try{const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol))return h(title||url);return '<a href="'+h(parsed.href)+'" target="_blank" rel="noopener noreferrer">'+h(title||url)+'</a>';}catch{return h(title||url||'Not supplied');}
}
function notification(message,{persistent=false,error=false}={}){
  const node=document.createElement('div');node.className='notification'+(error?' error':'');
  const body=document.createElement('span');body.textContent=message;node.append(body);
  const close=document.createElement('button');close.type='button';close.textContent='Dismiss';close.addEventListener('click',()=>node.remove());node.append(close);
  $('#notifications').append(node);if(!persistent)setTimeout(()=>node.remove(),10000);
}
function errorText(error){return error?.message||String(error);}
function formValue(form,name){return form.elements.namedItem(name)?.value??'';}
function formBoolean(form,name){return !!form.elements.namedItem(name)?.checked;}
function parseObject(value,title,{array=false,empty={}}={}){
  if(!String(value??'').trim())return clone(empty);
  let parsed;try{parsed=JSON.parse(value);}catch{throw new Error(title+' must contain valid JSON.');}
  if(array?!Array.isArray(parsed):!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error(title+' must be a JSON '+(array?'array':'object')+'.');
  return parsed;
}
function textPairs(value,title){
  const output={};for(const line of String(value??'').split(/\r?\n/)){
    if(!line.trim())continue;const at=line.indexOf('=');
    if(at<1)throw new Error(title+': enter one original = interpreted pair per line.');
    const before=line.slice(0,at).trim(),after=line.slice(at+1).trim();
    if(!after||own(output,before))throw new Error(title+': every original key needs one distinct nonblank interpretation.');
    output[before]=after;
  }return output;
}
function pairsText(value){return Object.entries(obj(value)).map(([a,b])=>a+' = '+b).join('\n');}
function safeFilename(value,fallback='cashiering-download'){
  const name=String(value??'').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g,'').trim();
  return name&&name!=='.'&&name!=='..'?name:fallback;
}
function responseFilename(header,fallback){
  const extended=String(header??'').match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if(extended){try{return safeFilename(decodeURIComponent(extended[1].trim()),fallback);}catch{}}
  const quoted=String(header??'').match(/filename\s*=\s*"([^"]+)"/i);
  return safeFilename(quoted?.[1],fallback);
}
async function fileBase64(file,maxBytes){
  if(!file)throw new Error('Choose an original file.');
  if(maxBytes&&file.size>maxBytes)throw new Error('The original exceeds the permitted '+maxBytes+' byte limit.');
  const data=new Uint8Array(await file.arrayBuffer());let binary='';
  for(let i=0;i<data.length;i+=32768)binary+=String.fromCharCode(...data.subarray(i,i+32768));
  return btoa(binary);
}
function sourceIdentity(original){return h(original?.capture_id??'Not supplied')+(original?.line===null||original?.line===undefined?'':' · record '+h(original.line));}
function settingsFor(detail){return detail?.run?.settings??S.state?.settings??{};}
function nativeTotals(detail){
 const settings=settingsFor(detail);
 return dataTable(['Currency','Permit system','Receivables','Processor observed','Cashier observed','Allocated','Permit remainder','Receivables remainder'],list(detail?.totals).map(row=>[h(row.currency),...['permit_minor','receivables_minor','processor_minor','cashier_minor','allocated_minor','permit_remaining_minor','receivables_remaining_minor'].map(key=>money(row[key],row.currency,settings))]),{emptyText:'No native financial totals are available for this run.'});
}
function nativeBalances(detail){
 const settings=settingsFor(detail);
 return dataTable(['Business date','Session','Tender','Currency','Expected','Cashier observed','Difference','Processor observed','Difference'],list(detail?.balances).map(row=>[h(row.business_date),h(row.session_id),h(row.payment_type),h(row.currency),money(row.expected_minor,row.currency,settings),...['cashier','processor'].flatMap(lane=>row[lane+'_applicable']===false?['<span class="muted">Outside declared tender scope</span>','<span class="muted">Not applicable</span>']:[money(row[lane+'_minor'],row.currency,settings),money(row[lane+'_difference_minor'],row.currency,settings)])]),{emptyText:'No selected daily balances are available.'});
}
function nativeManifest(detail){
 return dataTable(['Role','Original export','Identity','Declared coverage'],list(detail?.manifest).map(row=>[
  badge(row.kind??row.lane??row.side),
  h(row.filename??row.name??row.id??row.capture_id),
  '<span class="mono">'+h(row.sha256??'Not supplied')+'</span>'+details('Exact retained source',row),
  details('Coverage and selected mapping',row.coverage??row.scope??row.reporting_period??null)
 ]),{emptyText:'This run has no retained source manifest.'});
}


const S={
  state:null,detail:null,tab:'overview',runId:'',captureId:'',groupId:'',findingId:'',profileId:'',
  busy:false,pending:null,readGeneration:0,pages:{},pageData:{},filters:{},dialog:null,sourceCatalog:null,
  actor:sessionStorage.getItem('berkeley-cashier-actor')||'',booted:false
};
const token=$('meta[name="workspace-token"]')?.content??'';
function appLink(path){return path.startsWith('/')?path:'/'+path;}
async function request(path,{method='GET',payload,signal}={}){
  const options={method,credentials:'same-origin',signal,headers:{'X-Workspace-Token':token}};
  if(payload!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(payload);}
  let response;
  try{response=await fetch(appLink(path),options);}catch(error){error.outcomeUnknown=method!=='GET';throw error;}
  let body;try{body=await response.text();}catch(error){error.outcomeUnknown=method!=='GET';throw error;}let parsed;
  try{parsed=body?JSON.parse(body):{};}catch{
    const error=new Error('The service returned a response that could not be read. Reload the saved workspace before another change.');
    error.status=response.status;error.outcomeUnknown=method!=='GET';throw error;
  }
  if(!response.ok){
    const error=new Error(parsed.message||parsed.error||'The service rejected this request.');
    error.status=response.status;error.details=parsed;error.outcomeUnknown=method!=='GET'&&response.status>=500;throw error;
  }
  return parsed;
}
async function downloadUrl(path,fallback='cashiering-download'){
  const response=await fetch(appLink(path),{credentials:'same-origin',headers:{'X-Workspace-Token':token}});
  if(!response.ok){let data;try{data=await response.json();}catch{}throw new Error(data?.message||'The retained file could not be downloaded.');}
  const name=responseFilename(response.headers.get('Content-Disposition'),fallback),blob=await response.blob(),url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  return {filename:name,bytes:blob.size};
}
function pagination(total,key,limit=50){
  const offset=S.pages[key]??0;
  return '<div class="pagination"><span>'+h(total?'Showing '+(offset+1)+'–'+Math.min(offset+limit,total)+' of '+total:'No entries')+'</span><div class="actions">'+
    button('Previous','page','data-page-key="'+h(key)+'" data-offset="'+Math.max(0,offset-limit)+'"'+(offset===0?' disabled':''),'small')+
    button('Next','page','data-page-key="'+h(key)+'" data-offset="'+(offset+limit)+'"'+(offset+limit>=total?' disabled':''),'small')+'</div></div>';
}
function localPage(rows,key,limit=50){const offset=Math.min(S.pages[key]??0,Math.max(0,Math.floor(Math.max(0,rows.length-1)/limit)*limit));S.pages[key]=offset;return rows.slice(offset,offset+limit);}
function setBusy(busy){
  S.busy=busy;
  $$('[data-write]').forEach(node=>{node.disabled=busy;});
  applyInteractionLocks();
  const top=$('#busy-status');if(top){top.hidden=!busy;top.textContent=busy?'Working with the retained workspace…':'';}
}
function dialogClose({force=false}={}){
  if(S.busy&&!force)return;
  const dialog=$('#editor');dialog.close();dialog.innerHTML='';S.dialog=null;
}
function openDialog(title,body,{submit,submitLabel='Save',wide=true,context,readOnly=false,reopen}={}){
  if(S.busy)return;
  const dialog=$('#editor');S.dialog={submit,context:clone(context),readOnly,reopen};
  dialog.classList.toggle('wide-dialog',wide);
  dialog.innerHTML='<form id="dialog-form"'+(readOnly?' data-read-only="true"':'')+'>'+
    '<div class="dialog-head"><h2 id="dialog-title">'+h(title)+'</h2>'+button('Close','close-dialog','','quiet')+'</div>'+
    '<div class="dialog-body">'+body+'<div class="dialog-error" role="alert" hidden></div></div>'+
    '<div class="dialog-foot">'+button(readOnly?'Close':'Cancel','close-dialog')+(!readOnly?'<button type="submit" class="primary" data-write>'+h(submitLabel)+'</button>':'')+'</div></form>';
  hydrate(dialog);dialog.showModal();
  const focus=$('input:not([type=hidden]),select,textarea,button',dialog);focus?.focus();
}
function showDialogError(error){
  const box=$('.dialog-error',$('#editor'));
  if(box){box.hidden=false;box.innerHTML='<p>'+h(errorText(error))+'</p>'+(error.status===409&&S.dialog?.reopen?'<p>Your entries remain in this form. Reopen it against the current saved edition, inspect the refreshed source, then submit the intended change.</p>'+button('Refresh and review current edition','reopen-dialog'):'')+(error.details?details('Service response',error.details):'');box.scrollIntoView({block:'nearest'});}
  else notification(errorText(error),{persistent:true,error:true});
}
function actorField(value=S.actor){return field('actor','Recorded by',textInput('actor',value,'required maxlength="180" autocomplete="name"'),'Use the named operator responsible for this change.');}
function rememberActor(value){S.actor=nonblank(value);sessionStorage.setItem('berkeley-cashier-actor',S.actor);}
function readonlyRecord(title,value){openDialog(title,details('Complete retained record',value,true),{readOnly:true});}
function pageHeading(title,description,actions=''){
 return '<div class="page-heading"><div><p class="eyebrow">Berkeley / Clariti</p><h1>'+h(title)+'</h1><p class="muted">'+h(description)+'</p></div><div class="actions">'+actions+'</div></div>';
}
function shell(content){
 const tabs=[['overview','Daily position'],['intake','Original exports'],['reconciliation','Transactions & allocation'],['findings','Exceptions'],['close','Cashier close'],['interfaces','ERP interface'],['handoff','Packets & history'],['settings','Setup']];
 return '<header class="topbar"><div class="brand"><a href="/">Permit workspace</a><span>Daily cashiering</span></div><div class="topmeta"><span>Saved revision <strong>'+h(S.state?.revision??'—')+'</strong></span>'+button('Refresh','refresh','','small')+'</div></header>'+
  '<div class="contextbar"><div id="run-selector"></div><div class="context-note">Source observations, staff decisions and receiving records stay separate.</div></div>'+
  '<nav class="tabs" aria-label="Cashiering workspace">'+tabs.map(([id,title])=>'<button type="button" data-action="tab" data-tab="'+h(id)+'"'+(S.tab===id?' aria-current="page"':'')+'>'+h(title)+'</button>').join('')+'</nav>'+
  '<div id="busy-status" class="busy-strip" role="status" hidden></div>'+
  '<main id="main" class="workspace" tabindex="-1">'+(S.pending?pendingNotice():'')+content+'</main>';
}

function overviewDisplay(detail){
 if(!detail)return empty('Prepare a daily reconciliation','Retain and map the actual source exports, declare the accounting window, then prepare a run.',button('Open original exports','tab','data-tab="intake"','primary'));
 const run=detail.run;
 const actions=button('Inspect all transactions','tab','data-tab="reconciliation"')+button('Refresh selected source edition','run-refresh','data-write')+button('Edit this run’s operating scope','run-settings','data-write')+button('Preview complete report','run-report');
 return pageHeading(run.label||'Daily financial position','Native totals retain the selected source scope and exact original currency scales.',actions)+
  '<div class="stats">'+stat('Accounting period',(run.start_date??'Not supplied')+' → '+(run.end_date??'Not supplied'))+stat('Run state',label(run.status))+stat('Source revision',run.source_revision)+stat('Edit revision',run.edit_revision)+'</div>'+
  section('Financial position',nativeTotals(detail),'','Missing observations remain visible; they do not become a zero amount.')+
  section('Daily balancing',nativeBalances(detail),button('Cashier review','tab','data-tab="close"'))+
  section('Selected source coverage',nativeManifest(detail))+
  section('Recorded population',definitionList(Object.entries(obj(detail.counts)).map(([k,v])=>[label(k),h(txt(v))]))+details('Frozen run settings',run.settings));
}
function groupDisplay(detail){
 const settings=settingsFor(detail),page=S.pageData.groups??{rows:[],total:0},rows=list(page.rows),key='groups';
 return pagination(page.total,key)+dataTable(['Group / lane','Transaction','Currency','Net','Allocated','Remaining','Permit / invoice / fee references',''],rows.map(row=>[
  h(row.id)+'<br>'+badge(row.kind),h(row.transaction_id),h(row.currency),
  money(row.net_minor,row.currency,settings),money(row.allocated_minor,row.currency,settings),money(row.remaining_minor,row.currency,settings),
  '<span class="wrap">'+h(txt(row.permit_ids))+'<br>'+h(txt(row.invoice_ids))+'<br>'+h(txt(row.fee_codes))+'</span>',
  button('Inspect / allocate','group','data-id="'+h(row.id)+'"','small')
 ]));
}
function allocationDisplay(detail){
 const settings=settingsFor(detail),page=S.pageData.allocations??{rows:[],total:0},rows=list(page.rows),key='allocations';
 return pagination(page.total,key)+dataTable(['Allocation','Permit group','Receivables group','Currency','Amount','State','Reason / owner',''],rows.map(row=>[
  h(row.id),h(row.source_group_id),h(row.target_group_id),h(row.currency),money(row.amount_minor,row.currency,settings),badge(row.active?'active':'removed'),
  h(row.owner)+'<br>'+h(row.note),row.active?button('Remove','remove-allocation','data-id="'+h(row.id)+'" data-write','small'):h(date(row.created_at))
 ]));
}
function transactionDisplay(detail,lane){
 const settings=settingsFor(detail),page=S.pageData.transactions??{rows:[],total:0},rows=list(page.rows),key='rows-'+lane;
 return pagination(page.total,key)+dataTable(['Transaction / original','Date / session','Event / state','References','Currency','Amount','Requested','Paid','Net',''],rows.map(row=>[
  '<span class="mono">'+h(row.transaction_id)+'</span><br><small>'+sourceIdentity(row.original)+'</small>',
  h(row.business_date)+'<br>'+h(row.session_id),badge(row.event)+' '+badge(row.status),
  h(row.permit_id)+'<br>'+h(row.invoice_id)+'<br>'+h(row.fee_code),h(row.currency),
  ...['amount_minor','requested_minor','paid_minor','net_minor'].map(key=>money(row[key],row.currency,settings)),
  button('Original / correction','transaction','data-lane="'+h(lane)+'" data-record-key="'+h(row.record_key??row.id??'')+'" data-transaction-id="'+h(row.transaction_id)+'"','small')
 ]),{emptyText:'No selected '+label(lane).toLowerCase()+' records in this run.'});
}
function findingReviewChoices(){return list(S.state?.catalog?.review_states).map(value=>({value,label:label(value)}));}
function findingsDisplay(detail){
 const page=S.pageData.findings??{rows:[],total:0},rows=list(page.rows),status=S.filters.findingStatus??'',key='findings';
 return pageHeading('Exceptions','Inspect the original evidence and record an explicit disposition for this retained run.')+
  section('Current findings','<form id="finding-filter" class="toolbar">'+field('finding-query','Search',textInput('finding-query',S.filters.findingQuery??'','placeholder="Transaction, reference or issue"'))+field('finding-status','Review state',selectInput('finding-status',[{value:'',label:'All reviews'},...findingReviewChoices()],status))+'<button type="submit">Filter</button></form>'+
   pagination(page.total,key)+dataTable(['Finding','Issue','Severity','Review','Owner / reason',''],rows.map(row=>[
    h(row.id),'<strong>'+h(row.code)+'</strong><p>'+h(row.message)+'</p>',badge(row.severity)+(row.waivable===false?'<br><small>Not waivable</small>':''),badge(row.review?.status??'open'),
    h(row.review?.owner)+'<br>'+h(row.review?.note),button('Inspect / review','finding','data-id="'+h(row.id)+'"','small')
   ]),{emptyText:'No findings match this view. Source coverage remains available in Daily position.'}));
}

async function reopenDialog(){
 if(S.busy||!S.dialog?.reopen)return;
 const callback=S.dialog.reopen,form=$('#dialog-form'),draft=[];
 for(const input of Array.from(form.elements)){
  if(!input.name||input.disabled||['submit','button'].includes(input.type))continue;
  if(input.type==='file')draft.push({name:input.name,type:'file',files:Array.from(input.files||[])});
  else if(['checkbox','radio'].includes(input.type))draft.push({name:input.name,type:input.type,value:input.value,checked:input.checked});
  else draft.push({name:input.name,type:input.type,value:input.value});
 }
 const refreshed=await refresh({keepDialog:true});if(!refreshed)return;dialogClose();await callback();
 const next=$('#dialog-form');
 for(const saved of draft){
  const control=next?.elements.namedItem(saved.name);if(!control||control.disabled)continue;
  if(saved.type==='file'){try{const transfer=new DataTransfer();saved.files.forEach(file=>transfer.items.add(file));control.files=transfer.files;}catch{}}
  else if(['checkbox','radio'].includes(saved.type))control.checked=saved.checked;
  else if(control.tagName==='SELECT'){if(Array.from(control.options).some(option=>option.value===saved.value))control.value=saved.value;}
  else control.value=saved.value;
 }
 notification('Your draft entries were retained. Review the current source edition before saving.',{persistent:true});
}


function sourceCatalogDisplay(catalog){
 const c=obj(catalog);
 return pageHeading('Source and operating scope','Original requirements and the application’s configured behavior remain separately identifiable.')+
  section(c.title||'Financial source contract',definitionList([
   ['Source review date',h(c.source_review_date??'Not supplied')],
   ['Existing product',h(c.relationship?.existing_product??'Retained permitting workspace')],
   ['Financial arm',h(c.relationship?.financial_arm??'Daily cashiering and receivables reconciliation')]
  ])+(c.relationship?.note?'<p>'+h(c.relationship.note)+'</p>':''))+
  section('Original sources',dataTable(['Source','Edition / date','Selected passages','Reference'],list(c.sources).map(source=>[
   '<strong>'+h(source.title)+'</strong><br><span class="mono">'+h(source.id)+'</span>',
   h(source.date??'Not supplied')+(source.edition_note?'<p>'+h(source.edition_note)+'</p>':''),
   (source.pdf_pages?'<p>PDF pages: '+h(txt(source.pdf_pages))+'</p>':'')+list(source.selected_locators).map(locator=>'<p>'+h(locator)+'</p>').join(''),
   externalLink(source.url,'Open original source')+(source.git_blob?'<p class="mono">Blob '+h(source.git_blob)+'</p>':'')
  ])))+
  section('Requirement and application behavior',dataTable(['Requirement','Issuer source meaning','Application behavior','Original locator'],list(c.requirements).map(row=>[
   '<strong>'+h(row.title)+'</strong><br>'+h(row.id),h(row.source_meaning),h(row.product_behavior),h(row.source_id)+'<br>'+h(row.locator)
  ])))+
  section('Supplied configuration',dataTable(['Configuration','Meaning'],list(c.proposed_configuration).map(row=>[h(row.key),h(row.meaning)])))+
  section('Complete operating acceptance',dataTable(['Outcome','Expected result'],list(c.acceptance).map(row=>['<strong>'+h(row.title)+'</strong><br>'+h(row.id),h(row.result)])))+
  section('Source uncertainty',dataTable(['Subject','Retained meaning'],list(c.uncertainties).map(row=>[h(row.key),h(row.detail)])),button('Back to setup','tab','data-tab="settings"'));
}
function genericSourcePreview(page){
 const rows=list(page?.rows);
 return dataTable(['Original record','Original values','Interpreted record','Input issues'],rows.map(row=>[
   h(row.original?.line??row.line??row.row_number??row.row_id),
   details('Original fields',row.original?.values??row.values??row.data??row.raw??null,true)+details('Original source types',row.original?.types??row.types??{}),
   details('Interpreted values',row.normalized??(row.record_key?row:row.interpreted??null)),
   list(row.errors??row.issues).map(issue=>'<p>'+h(typeof issue==='object'?(issue.message??issue.code??JSON.stringify(issue)):issue)+'</p>').join('')||'<span class="muted">None recorded</span>'
 ]),{emptyText:'No rows in this source page.'});
}
function mappingFieldRows(fields,mapping,headers){
 const fieldsObject=obj(mapping);
 return '<datalist id="original-source-fields">'+headers.map(header=>'<option value="'+h(header)+'"></option>').join('')+'</datalist>'+
 dataTable(['Interpreted field','Original export column / path'],fields.map(item=>{
   const key=typeof item==='string'?item:item.key??item.name,current=fieldsObject[key]??'';
   return ['<label for="map-'+h(key)+'">'+h(typeof item==='string'?label(item):item.label??label(key))+'</label>'+(item.help?'<p class="help">'+h(item.help)+'</p>':''),
     '<input id="map-'+h(key)+'" name="map:'+h(key)+'" list="original-source-fields" value="'+h(current)+'" autocomplete="off">'];
 }));
}
function readMappedFields(form,fields){
 const mapping={};
 for(const item of fields){const key=typeof item==='string'?item:item.key??item.name;mapping[key]=formValue(form,'map:'+key);}
 return mapping;
}
function originalHeaders(headers){
 return '<details><summary>All '+h(headers.length)+' original fields</summary><div class="header-list">'+headers.map(header=>'<code>'+h(header)+'</code>').join('')+'</div></details>';
}
function originalRowPanel(row){
 const metadata=obj(row.original);
 return section('Retained source record',definitionList([
  ['Source capture',h(metadata.capture_id??'Not supplied')],
  ['Original record',h(txt(metadata.line))],
  ['Transaction',h(row.transaction_id??'Not supplied')],
  ['Related transaction',h(row.related_transaction_id??'Not supplied')],
  ['Denial reason',h(row.denial_reason??'Not supplied')]
 ])+details('Complete original fields',metadata.values??metadata.data??metadata,true)+details('Native interpreted record',row));
}
function reviewerDisplay(detail){
 return dataTable(['Reviewer','Role','Statement','Note','Recorded','Reviewed edition'],list(detail?.signoffs).map(row=>[
  '<strong>'+h(row.name)+'</strong><br>'+h(row.reviewer_id),h(row.role),h(row.statement),h(row.note),h(date(row.created_at??row.signed_at)),
  'Edit '+h(row.edit_revision)+'<br><span class="mono">'+h(row.snapshot_hash)+'</span>'
 ]),{emptyText:'No reviewer signoff is recorded for this run.'});
}
function closingHistoryDisplay(detail){
 return dataTable(['Retained close','State','Reviewer / owner','Recorded','Reviewed source'],list(detail?.closings).map(row=>[
  h(row.id),badge(row.status),h(row.owner),h(date(row.closed_at??row.created_at??row.prepared_at)),h(row.edit_revision)+details('Complete close record',row)
 ]),{emptyText:'No daily close has been recorded.'});
}
function interfaceHistoryDisplay(detail){
 return list(detail?.interface_exports).length?list(detail.interface_exports).map(row=>'<article class="record-card"><div class="panel-head"><div><h3>'+h(row.label??row.title??row.filename??row.id)+'</h3><p>'+badge(row.status)+' <span class="mono">'+h(row.id)+'</span></p></div><div class="actions">'+button('Inspect / download','interface-export','data-id="'+h(row.id)+'"','small')+'</div></div>'+
 definitionList([
  ['Prepared',h(date(row.prepared_at??row.created_at))],['Layout',h(row.profile_id??'Not supplied')+' · '+h(row.profile_version??'Not supplied')],
  ['Transmitted',h(date(row.transmitted_at))],['Received',h(date(row.received_at))],
  ['Posting reference',h(row.posting_reference??'Not supplied')],['Original bytes',h(row.sha256??'Not supplied')]
 ])+'</article>').join(''):empty('No interface export prepared','Create a reviewed output using the actual receiving layout. A downloaded file remains a prepared output until its external observations are recorded.');
}


function closeDisplay(detail){
 if(!detail)return empty('Select a retained daily run','Prepare the accounting window from mapped original exports first.');
 return pageHeading('Cashier balance and deposit review','Use the observed cashier totals and two distinct authorized reviewer records for this exact edition.',
   button('Record reviewer statement','signoff','data-write','primary')+button('Record daily close','close-run','data-write')+button('Reopen financial work','reopen-run','data-write'))+
  section('Observed daily balances',nativeBalances(detail),'','Correct an original interpretation through its named correction record, then review the resulting edition.')+
  section('Reviewer observations',reviewerDisplay(detail),'','Each statement retains the reviewed edit revision and snapshot identity.')+
  section('Selected daily close',detail.closing?details('Complete selected close',detail.closing,true):empty('No current close selected','Record the required reviewer observations and request the native daily-close decision.'))+
  section('Prior close editions',closingHistoryDisplay(detail));
}
function reconciliationDisplay(detail){
 if(!detail)return empty('Select a retained reconciliation','Retain and confirm the relevant original exports before preparing a run.');
 const lane=S.filters.lane||'permits';
 return pageHeading('Transactions and allocation','Inspect exact source groups, allocate partial amounts deliberately, and keep every remaining balance visible.',
   button('Create allocation','allocate','data-write','primary'))+
  section('Transaction groups','<form id="group-filter" class="toolbar">'+field('group-kind','Source role',selectInput('group-kind',[{value:'',label:'All source roles'},'permits','receivables','processor','cashier'],S.filters.groupKind??''))+field('group-query','Original group or reference',textInput('group-query',S.filters.groupQuery??''))+'<button type="submit">Filter</button></form>'+groupDisplay(detail))+
  section('Recorded allocations',allocationDisplay(detail))+
  section('Interpretation correction history',correctionsDisplay())+
  section('Original and interpreted transactions','<form id="transaction-filter" class="toolbar">'+field('transaction-lane','Source role',selectInput('transaction-lane',['permits','receivables','processor','cashier'],lane))+field('transaction-query','Search original reference',textInput('transaction-query',S.filters.transactionQuery??''))+'<button type="submit">Filter</button></form>'+transactionDisplay(detail,lane));
}
function interfacesDisplay(detail){
 const profileRows=interfaceProfiles();
 return pageHeading('ERP interface and receiving','Prepare the agreed output layout, then retain the actual transmission and receiving observations.',
  button('Create interface profile','profile-new','data-write')+(detail?button('Prepare interface output','interface-prepare','data-write','primary'):''))+
  section('Retained receiving profiles',profileRows.length?dataTable(['Profile','Edition','Row family','Description',''],profileRows.map(row=>[
   '<strong>'+h(row.title??row.name??row.id)+'</strong><br><span class="mono">'+h(row.id)+'</span>',h(row.version??row.edition??'Not supplied'),h(row.scope)+(row.scope==='transactions'?' · '+h(row.lane):''),
   h(row.description??row.note??''),button('Inspect / edit','profile','data-id="'+h(row.id)+'" data-version="'+h(row.version)+'"','small')
  ])):empty('No receiving profile saved','Enter the supplied field layout and review it before preparing an output.'))+
  section('Prepared exports and actual observations',detail?interfaceHistoryDisplay(detail):empty('Select a run','Prepared interface files belong to a specific retained financial run.'));
}
function handoffDisplay(detail){
 const packets=packetEntries(),history=historyEntries();
 return pageHeading('Packets and saved history','Create immutable financial handoffs and reopen the complete original workspace.',
  (detail?button('Prepare complete packet','packet-prepare','data-write','primary'):'')+
  button('Download workspace backup','backup'))+
  (detail?section('Current retained financial run',definitionList([
    ['Run',h(detail.run.label??detail.run.id)],['Accounting period',h(detail.run.start_date)+' to '+h(detail.run.end_date)],
    ['Source revision',h(detail.run.source_revision)],['Edit revision',h(detail.run.edit_revision)]
  ])+details('Current native run summary',detail)+'<div class="actions">'+button('Preview complete report','run-report')+button('Download complete current run JSON','run-json')+'</div>'):'')+
  section('Prepared packets',packets.length?dataTable(['Packet','Run / edition','Prepared','Original bytes',''],packets.map(row=>[
    h(row.label??row.title??row.filename??row.id),h(row.run_id??'Not supplied')+'<br>'+h(row.edit_revision??'Not supplied'),h(date(row.created_at??row.prepared_at)),
    h(txt(row.bytes))+' bytes<br><span class="mono">'+h(row.sha256??'Not supplied')+'</span>',
    button('Inspect / download','packet','data-id="'+h(row.id)+'"','small')
  ])):empty('No packet prepared','The native packet includes the complete run, original exports, supporting documents, full ledgers and manifest.'))+
  section('Original financial editions',editionListDisplay())+
  section('Recorded changes',history.length?dataTable(['Recorded','Action','Actor','Details'],history.map(row=>[
   h(date(row.created_at??row.occurred_at??row.at)),h(row.action??row.kind??'Not supplied'),h(row.actor??row.owner??'Not supplied'),details('Recorded change',row)
  ]))+pagination(S.pageData.history?.total??history.length,'history'):empty('No history in this view','Select a run to inspect its original input and decision history.'));
}
async function previewGeneratedReport(path,title){
 const response=await fetch(appLink(path),{credentials:'same-origin',headers:{'X-Workspace-Token':token}});
 if(!response.ok)throw new Error('The generated report could not be read.');
 const mime=response.headers.get('Content-Type')||'';
 if(!mime.toLowerCase().includes('text/html'))throw new Error('This retained output is not an HTML report.');
 const html=await response.text(),blob=new Blob([html],{type:'text/html'}),url=URL.createObjectURL(blob);
 openDialog(title,'<iframe class="report-preview" sandbox="" title="'+h(title)+'" src="'+h(url)+'"></iframe>',{readOnly:true,wide:true});
 const dialog=$('#editor');dialog.addEventListener('close',()=>URL.revokeObjectURL(url),{once:true});
}


function captureById(id){return list(S.state?.captures).find(row=>row.id===id)||null;}
function captureChoices({documents=true}={}){
 return list(S.state?.captures).filter(row=>documents||row.kind!=='document').map(row=>({value:row.id,label:label(row.kind)+' · '+row.filename+' · '+short(row.id)}));
}
function coverageDisplay(coverage){
 const c=obj(coverage);
 return definitionList([
  ['Accounting dates',h(c.start_date??'Not supplied')+' → '+h(c.end_date??'Not supplied')],
  ['Complete declared scope',h(txt(c.complete))],
  ['Sessions',h(txt(c.session_ids))],['Tender types',h(txt(c.payment_types))],['Currencies',h(txt(c.currencies))],
  ['Source mode',h(c.data_mode??'Not supplied')],['Source system',h(c.source_system??'Not supplied')],['Report family',h(c.report_family??'Not supplied')],['Scope note',h(c.note??'Not supplied')]
 ]);
}
function captureListDisplay(){
 const rows=list(S.state?.captures),key='captures';
 return pagination(rows.length,key)+dataTable(['Source role','Original file','Captured / size','Rows / mapping','Selected',''],localPage(rows,key).map(row=>[
  badge(row.kind),'<strong>'+h(row.filename)+'</strong><br><span class="mono">'+h(short(row.sha256))+'</span>',
  h(date(row.captured_at))+'<br>'+h(txt(row.bytes))+' bytes',
  h(txt(row.rows))+' rows<br>'+badge(row.confirmed?'confirmed':'mapping not confirmed')+' · edition '+h(row.mapping_version),
  badge(row.current?'selected':'retained'),
  button('Inspect / map','capture','data-id="'+h(row.id)+'"','small')+
   (row.kind!=='document'?button(row.current?'Unselect':'Select','select-capture','data-id="'+h(row.id)+'" data-selected="'+(row.current?'0':'1')+'" data-write','small'):'')
 ]),{emptyText:'No original source has been retained.'});
}
function intakeDisplay(){
 return pageHeading('Original financial exports','Retain the complete source bytes, declare coverage, and confirm the explicit interpretation before preparing a daily run.',
  button('Retain original export','upload','data-write','primary')+button('Attach supporting document','upload-document','data-write')+
  button('Prepare daily run','run-new','data-write'))+
  section('Four independent source roles',notice('Permit collections, receivables observations, processor settlements and cashier counts each retain their own original capture and coverage. A case-level payment comparison is separate from financial transaction reconciliation.'))+
  section('Saved source captures',captureListDisplay())+
  section('Working source selection',details('Current selected capture identities',list(S.state?.captures).filter(row=>row.current).map(row=>({id:row.id,kind:row.kind,filename:row.filename,sha256:row.sha256,mapping_version:row.mapping_version,coverage:row.coverage}))));
}
function coverageForm(coverage={}){
 return '<fieldset><legend>Declared source coverage</legend><div class="form-grid">'+
  field('start-date','First business date',textInput('start-date',coverage.start_date??'','type="date"'))+
  field('end-date','Last business date',textInput('end-date',coverage.end_date??'','type="date"'))+
  field('coverage-sessions','Session identifiers',textArea('coverage-sessions',json(coverage.session_ids??[]),'rows="3"'),'Exact original session identifiers as a JSON array. An empty list leaves this dimension unrestricted.')+
  field('coverage-tenders','Tender types',textArea('coverage-tenders',json(coverage.payment_types??[]),'rows="3"'),'The declared interpreted tender types as a JSON array.')+
  field('coverage-currencies','Currencies',textArea('coverage-currencies',json(coverage.currencies??[]),'rows="3"'),'The supplied currency codes as a JSON array.')+
  field('coverage-mode','Report mode',selectInput('coverage-mode',['event_stream','snapshot'],coverage.data_mode??'event_stream'),'Declare whether each row is an event or part of a source snapshot.')+
  field('coverage-system','Original source system',textInput('coverage-system',coverage.source_system??''))+
  field('coverage-family','Original report family',textInput('coverage-family',coverage.report_family??''))+
  '<div class="field">'+checkInput('coverage-complete','This capture contains the complete declared population.',coverage.complete===true)+'</div>'+
  field('coverage-note','Coverage and observation notes',textArea('coverage-note',coverage.note??'','rows="4"'),'Name omitted populations or a partial observation explicitly.',true)+
  '</div></fieldset>';
}
function readCoverage(form){
 const arrays=[['session_ids','coverage-sessions'],['payment_types','coverage-tenders'],['currencies','coverage-currencies']];
 const result={start_date:formValue(form,'start-date')||null,end_date:formValue(form,'end-date')||null,complete:formBoolean(form,'coverage-complete'),note:formValue(form,'coverage-note'),data_mode:formValue(form,'coverage-mode'),source_system:formValue(form,'coverage-system'),report_family:formValue(form,'coverage-family')};
 for(const [key,name] of arrays){
  result[key]=parseObject(formValue(form,name),label(key),{array:true,empty:[]});
  if(result[key].some(value=>typeof value!=='string'))throw new Error(label(key)+' must contain text values.');
 }
 return result;
}
function uploadEditor(kind='permits'){
 const context={revision:S.state.revision};
 const document=kind==='document';
 openDialog(document?'Retain supporting document':'Retain original financial export',
  '<div class="form-grid">'+
  field('source-kind','Source role',selectInput('source-kind',document?['document']:['permits','receivables','processor','cashier'],kind,'required'))+
  field('source-file','Original file','<input id="source-file" name="source-file" type="file"'+(document?'':' accept=".csv,.json"')+' required>','The actual bytes are retained unchanged.')+
  field('captured-at','Original capture time',textInput('captured-at','','required placeholder="2026-10-12T17:00:00-07:00"'),'Use the source observation time with its explicit UTC offset.',true)+
  '</div>'+coverageForm(),
  {submitLabel:'Retain original',context,reopen:()=>uploadEditor(kind),submit:async form=>{
    const file=form.elements.namedItem('source-file').files[0];
    const payload={revision:context.revision,kind:formValue(form,'source-kind'),filename:file?.name??'',captured_at:formValue(form,'captured-at'),coverage:readCoverage(form)};
    payload.content_base64=await fileBase64(file,25*1024*1024);
    await mutate('/api/cashiering/upload',payload,{label:'Retain original export',after:result=>{S.tab='intake';},message:'Original source retained with its declared coverage.'});
  }}
 );
}
function settingsDisplay(){
 const settings=obj(S.state?.settings);
 return pageHeading('Operating setup','Keep declared currency scales, source scope and reviewer requirements in the same permitting workspace.',
  button('Edit operating setup','settings-edit','data-write','primary')+button('Read source contract','source-catalog'))+
  section('Declared operating choices',definitionList([
   ['Timezone',h(settings.timezone??'Not supplied')],['Scope note',h(settings.scope_note??'Not supplied')],
   ['Required source roles',h(txt(settings.required_lanes))],['Reviewer records required',h(txt(settings.close_reviewers_required))],['Cashier comparison tender scope',h(settings.balance_payment_types?.cashier===null||settings.balance_payment_types?.cashier===undefined?'All source tender types':json(settings.balance_payment_types.cashier))],['Processor comparison tender scope',h(settings.balance_payment_types?.processor===null||settings.balance_payment_types?.processor===undefined?'All source tender types':json(settings.balance_payment_types.processor))]
  ]))+
  section('Currency scales and balancing tolerances',dataTable(['Currency','Decimal scale','Declared tolerance in minor units'],Object.keys(obj(settings.scales)).map(currency=>[
   h(currency),h(txt(settings.scales[currency])),h(txt(settings.balance_tolerance_minor?.[currency]))
  ])))+
  section('Complete retained configuration',details('Current settings',settings));
}
function tenderScope(value,title){
 if(!String(value??'').trim()||String(value).trim()==='null')return null;
 const result=parseObject(value,title,{array:true,empty:[]});
 if(result.some(item=>typeof item!=='string'))throw new Error(title+' must contain exact text tender values.');
 return result;
}
function settingsEditor({run=false}={}){
 const context=run?runContext():{revision:S.state.revision},settings=clone(run?S.detail.run.settings:S.state.settings);
 openDialog(run?'Edit this run’s operating scope':'Operating setup',
  (run?notice('This saves a new financial edition for this retained run. Prior settings and reviews remain in history; current reviews must match the revised scope.'):'')+
  '<div class="form-grid">'+
  field('timezone','Accounting timezone',textInput('timezone',settings.timezone,'required'),'Use the actual operating timezone.')+
  field('reviewers-required','Distinct reviewer records required',textInput('reviewers-required',settings.close_reviewers_required,'type="number" min="2" max="10" step="1" required'),'The native close checks the required distinct reviewer records.')+
  field('required-lanes','Required source roles',textArea('required-lanes',json(settings.required_lanes),'rows="3"'),'JSON array containing the roles required for this operating scope.')+
  field('currency-scales','Currency decimal scales',textArea('currency-scales',json(settings.scales),'rows="4"'),'Exact currency-to-integer-scale object, from 0 to 12; financial values stay strings.')+
  field('balance-tolerance','Balancing tolerance in minor units',textArea('balance-tolerance',json(settings.balance_tolerance_minor),'rows="4"'),'Currency-to-integer-string object. Explicit zero differs from an absent value.')+
  field('cashier-payment-types','Cashier comparison tender scope',textArea('cashier-payment-types',json(settings.balance_payment_types?.cashier??null),'rows="3"'),'Blank or null includes all source tender types. An explicit JSON list limits this comparison; [] makes it inapplicable to every tender.')+
  field('processor-payment-types','Processor comparison tender scope',textArea('processor-payment-types',json(settings.balance_payment_types?.processor??null),'rows="3"'),'For example, select only the exact declared card tender values when the processor report excludes cash. No scope is inferred from the report name.')+
  field('scope-note','Included population and operating scope',textArea('scope-note',settings.scope_note,'rows="5"'),'Describe the original systems, daily accounting window, tender comparison scope and known exclusions.',true)+
  (run?field('settings-note','Reason for this financial edition',textArea('settings-note','','rows="4" required'),'',true):'')+
  '</div>',
  {submitLabel:run?'Save this run’s scope':'Save operating setup',context,reopen:()=>settingsEditor({run}),submit:async form=>{
    const reviewerCount=Number(formValue(form,'reviewers-required'));
    if(!Number.isSafeInteger(reviewerCount))throw new Error('Reviewer count must be a whole number.');
    const next={...settings,timezone:formValue(form,'timezone'),scope_note:formValue(form,'scope-note'),close_reviewers_required:reviewerCount,
      required_lanes:parseObject(formValue(form,'required-lanes'),'Required source roles',{array:true,empty:[]}),
      scales:parseObject(formValue(form,'currency-scales'),'Currency scales'),
      balance_tolerance_minor:parseObject(formValue(form,'balance-tolerance'),'Balancing tolerance'),
      balance_payment_types:{cashier:tenderScope(formValue(form,'cashier-payment-types'),'Cashier tender scope'),processor:tenderScope(formValue(form,'processor-payment-types'),'Processor tender scope')}};
    for(const [currency,scale] of Object.entries(next.scales)){if(!Number.isInteger(scale)||scale<0||scale>12)throw new Error(currency+' requires an integer currency scale from 0 to 12.');}
    for(const [currency,tolerance] of Object.entries(next.balance_tolerance_minor)){if(typeof tolerance!=='string'||!/^\d+$/.test(tolerance))throw new Error(currency+' tolerance must be a nonnegative integer STRING in minor units.');}
    if(next.required_lanes.some(lane=>!['permits','receivables','processor','cashier'].includes(lane)))throw new Error('Required source roles must use the exact declared data-lane names.');
    const payload={revision:context.revision,settings:next,...(run?{run_id:context.run_id,note:formValue(form,'settings-note')}:{})};
    await mutate(base+(run?'/run-settings':'/settings'),payload,{label:run?'Revise run operating scope':'Save operating setup',message:run?'Revised scope retained in this financial run. Current reviews must match its new edition.':'Operating choices saved. Existing runs retain their original settings.'});
  }}
 );
}


const base='/api/cashiering';
function pathId(path,id){return base+'/'+path+'/'+encodeURIComponent(id);}
function interfaceProfiles(){return list(S.state?.profiles);}
function packetEntries(){return list(S.state?.packets).filter(row=>!S.runId||row.run_id===S.runId);}
function historyEntries(){return list(S.pageData.history?.rows);}
function pageQuery(key,extra={}){
 const params=new URLSearchParams({offset:String(S.pages[key]??0),limit:'50'});
 for(const [name,value] of Object.entries(extra)){if(value!==null&&value!==undefined&&value!=='')params.set(name,String(value));}
 return params.toString();
}
function selectedRunSummary(){return list(S.state?.runs).find(row=>row.id===S.runId)||null;}
async function loadPages(runId,tab){
 if(!runId)return {};
 const prefix=pathId('runs',runId),jobs=[];
 if(tab==='reconciliation'){
  jobs.push(['groups',prefix+'/groups?'+pageQuery('groups',{query:S.filters.groupQuery??'',kind:S.filters.groupKind??''})]);
  jobs.push(['allocations',prefix+'/allocations?'+pageQuery('allocations')]);
  const lane=S.filters.lane||'permits';
  jobs.push(['transactions',prefix+'/rows?'+pageQuery('rows-'+lane,{kind:lane,query:S.filters.transactionQuery??''})]);
  jobs.push(['corrections',prefix+'/corrections?'+pageQuery('corrections')]);
 }
 if(tab==='findings')jobs.push(['findings',prefix+'/findings?'+pageQuery('findings',{query:S.filters.findingQuery??'',status:S.filters.findingStatus??''})]);
 if(tab==='handoff'){jobs.push(['history',prefix+'/history?'+pageQuery('history')]);jobs.push(['editions',prefix+'/editions?'+pageQuery('editions')]);}
 const values=await Promise.all(jobs.map(async([key,url])=>[key,await request(url)]));
 return Object.fromEntries(values);
}
function pageContent(){
 if(S.tab==='intake')return intakeDisplay();
 if(S.tab==='reconciliation')return reconciliationDisplay(S.detail);
 if(S.tab==='findings')return S.detail?findingsDisplay(S.detail):empty('Select a retained run','Findings belong to a specific retained financial comparison.');
 if(S.tab==='close')return closeDisplay(S.detail);
 if(S.tab==='interfaces')return interfacesDisplay(S.detail);
 if(S.tab==='handoff')return handoffDisplay(S.detail);
 if(S.tab==='settings')return settingsDisplay();
 if(S.tab==='sources')return sourceCatalogDisplay(S.sourceCatalog);
 return overviewDisplay(S.detail);
}
function render(){
 $('#app').innerHTML=shell(pageContent());hydrate($('#app'));
 const choices=[{value:'',label:'No financial run selected'},...list(S.state.runs).map(row=>({value:row.id,label:(row.label||row.id)+' · '+row.start_date+' → '+row.end_date+' · '+label(row.status)}))];
 $('#run-selector').innerHTML='<label for="active-run">Retained daily run</label>'+selectInput('active-run',choices,S.runId);
 setBusy(S.busy);applyInteractionLocks();
}
async function refresh({providedState,providedDetail,keepDialog=false}={}){
 const generation=++S.readGeneration,requestedTab=S.tab;
 const state=providedState??await request(base+'/state');
 if(!state||!Number.isSafeInteger(state.revision))throw new Error('The service did not return a current workspace revision.');
 let runId=S.runId;
 if(runId&&!list(state.runs).some(row=>row.id===runId))runId='';
 if(!S.booted&&!runId)runId=list(state.runs)[0]?.id??'';
 const [detail,pages]=await Promise.all([
  runId?(providedDetail?.run?.id===runId?Promise.resolve(providedDetail):request(pathId('runs',runId)+'?summary=1')):Promise.resolve(null),
  loadPages(runId,requestedTab)
 ]);
 if(generation!==S.readGeneration)return false;
 S.state=state;S.runId=runId;S.detail=detail;S.pageData=pages;S.sourceCatalog=state.catalog?.source_catalog??null;S.booted=true;
 render();
 if(!keepDialog&&$('#editor').open&&!S.busy)dialogClose();
 return true;
}
function pendingMetadata(pending){
 return {path:pending.path,request_id:pending.payload?.request_id??pending.request_id,label:pending.label,at:pending.at,revision:pending.payload?.revision??pending.revision,run_id:pending.payload?.run_id??pending.run_id};
}
function savePending(pending){
 S.pending=pending;
 try{if(pending)sessionStorage.setItem('berkeley-cashier-pending',JSON.stringify(pendingMetadata(pending)));else sessionStorage.removeItem('berkeley-cashier-pending');}catch{}
}
function restorePending(){
 try{const saved=JSON.parse(sessionStorage.getItem('berkeley-cashier-pending')||'null');if(saved&&typeof saved.request_id==='string'&&typeof saved.path==='string')S.pending=saved;}catch{}
}
function pendingNotice(){
 const meta=pendingMetadata(S.pending);
 return '<section class="notice"><strong>A save needs reconciliation.</strong><p>The browser did not read the completed result for '+h(meta.label)+'. Recover its original request identity before creating another change.</p><div class="actions">'+
  button('Recover saved result','reconcile-pending')+
  (S.pending.payload?button('Resume this exact request','resume-pending'):'')+
  (S.pending.last_lookup_missing?button('Review local pending notice','dismiss-pending'):'')+
  '</div>'+details('Original request identity',meta)+'</section>';
}
async function mutate(path,payload,{label:actionLabel='Save change',message='Change saved.',after,recovery=false}={}){
 if(S.pending&&!recovery)throw new Error('Recover the pending original save before making another change.');
 const body=clone(payload);if(!body.request_id)body.request_id=crypto.randomUUID();
 const pending={path,payload:body,label:actionLabel,at:new Date().toISOString()};
 savePending(pending);setBusy(true);
 try{
  const response=await request(path,{method:'POST',payload:body});
  if(!response?.state||!Number.isSafeInteger(response.revision)||response.state.revision!==response.revision){
   const error=new Error('The save returned an incomplete result. Recover this original request before another change.');error.outcomeUnknown=true;throw error;
  }
  savePending(null);S.state=response.state;
  if(response.detail?.run?.id)S.runId=response.detail.run.id;
  if(after)await after(response.result,response);
  dialogClose({force:true});
  await refresh({providedState:response.state,providedDetail:response.detail,keepDialog:true});
  notification(message);
  return response;
 }catch(error){
  if(!error.outcomeUnknown)savePending(null);
  if(error.status===409){try{await refresh({keepDialog:true});}catch{}}
  if(error.outcomeUnknown){render();notification('The result is not yet known. The original request identity is retained for recovery.',{persistent:true,error:true});}
  throw error;
 }finally{setBusy(false);}
}
async function recoverPending({resume=false}={}){
 if(!S.pending)return;
 const pending=S.pending,meta=pendingMetadata(pending);
 if(resume){
  if(!pending.payload)throw new Error('The original full payload is no longer in this browser. Recover its saved result or inspect the retained workspace before preparing a new change.');
  await mutate(pending.path,pending.payload,{label:pending.label,message:'Original request recovered.',recovery:true});return;
 }
 setBusy(true);
 try{
  const result=await request(base+'/requests/'+encodeURIComponent(meta.request_id));
  if(result.found&&result.response){
   savePending(null);
   if(result.response.detail?.run?.id)S.runId=result.response.detail.run.id;
   dialogClose({force:true});
   await refresh({keepDialog:true});
   notification('The original committed result was recovered. No second change was created.');
  }else{
   S.pending.last_lookup_missing=new Date().toISOString();
   await refresh({keepDialog:true});
   notification('No committed result is retained for this request. The current saved state is visible; the exact original request remains available for deliberate continuation while this page is open.',{persistent:true});
  }
 }finally{setBusy(false);}
}


function canonicalFields(){return list(S.state?.catalog?.fields).map(row=>typeof row==='string'?{key:row,label:label(row),type:'text'}:row);}
function mappingRows(fields,mapping,headers){
 return '<datalist id="mapping-original-columns">'+headers.map(name=>'<option value="'+h(name)+'"></option>').join('')+'</datalist>'+
 dataTable(['Interpreted field','Input choice','Exact source column or literal'],fields.map(field=>{
   const saved=obj(mapping?.fields?.[field.key]),mode=own(saved,'column')?'column':own(saved,'literal')?'literal':'unmapped',value=mode==='unmapped'?'':saved[mode];
   return ['<label for="mapping-value-'+h(field.key)+'">'+h(field.label??label(field.key))+'</label>'+(list(field.required_for).length?'<p class="help">Required: '+h(field.required_for.join(', '))+'</p>':''),
    selectInput('mapping-mode:'+field.key,[{value:'unmapped',label:'Not mapped'},{value:'column',label:'Original column / path'},{value:'literal',label:'Explicit literal'}],mode),
    '<input id="mapping-value-'+h(field.key)+'" name="mapping-value:'+h(field.key)+'" value="'+h(value??'')+'" list="mapping-original-columns" autocomplete="off">'];
 }));
}
function readMapping(form,original){
 const next={...clone(original),fields:{}};
 for(const field of canonicalFields()){
  const mode=formValue(form,'mapping-mode:'+field.key),value=formValue(form,'mapping-value:'+field.key);
  if(mode==='column')next.fields[field.key]={column:value};
  if(mode==='literal'){const before=original?.fields?.[field.key];next.fields[field.key]={literal:before&&own(before,'literal')&&String(before.literal??'')===value?clone(before.literal):value};}
 }
 next.amount_mode=formValue(form,'amount-mode');next.amount_sign=formValue(form,'amount-sign');
 next.date_format=formValue(form,'date-format');next.net_mode=formValue(form,'net-mode');
 next.event_signs=parseObject(formValue(form,'event-signs'),'Event signs');
 next.event_map=parseObject(formValue(form,'event-map'),'Original event map');
 next.status_map=parseObject(formValue(form,'status-map'),'Original status map');
 next.note=formValue(form,'mapping-note');
 return next;
}
async function mappingEditor(id){
 const capture=await request(pathId('captures',id)),context={revision:S.state.revision,capture_id:id},mapping=obj(capture.mapping);
 if(capture.kind==='document')throw new Error('Supporting documents do not have a financial field mapping.');
 openDialog('Interpret '+capture.filename,
  notice('Confirm the supplied report meaning. Major amounts are original decimal currency values; minor amounts are already integer unit strings. Event labels alone never determine a sign.')+
  originalHeaders(list(capture.headers))+
  mappingRows(canonicalFields(),mapping,list(capture.headers))+
  '<fieldset><legend>Financial and date interpretation</legend><div class="form-grid">'+
  field('amount-mode','Original amount units',selectInput('amount-mode',[{value:'major',label:'Major currency amounts'},{value:'minor',label:'Integer minor units'}],mapping.amount_mode??'major'))+
  field('amount-sign','Signed contribution',selectInput('amount-sign',[{value:'as_supplied',label:'Preserve supplied signed amounts'},{value:'event',label:'Use the explicit event sign map'}],mapping.amount_sign??'as_supplied'))+
  field('date-format','Original date format',selectInput('date-format',[{value:'iso',label:'ISO year-month-day'},{value:'mdy',label:'Month/day/year'},{value:'dmy',label:'Day/month/year'}],mapping.date_format??'iso'))+
  field('net-mode','Financial comparison basis',selectInput('net-mode',[{value:'amount',label:'Declared principal amount'},{value:'reported',label:'Actually reported net amount'}],mapping.net_mode??'amount'))+
  field('event-signs','Explicit event signs',textArea('event-signs',json(mapping.event_signs??{}),'rows="6"'),'Each declared sign is the exact string 1, -1 or 0. Used only when the event-sign choice is selected.')+
  field('event-map','Original event classifications',textArea('event-map',json(mapping.event_map??{}),'rows="6"'),'JSON object mapping exact original event text to a native classification: '+list(S.state.catalog.events).join(', ')+'.')+
  field('status-map','Original status classifications',textArea('status-map',json(mapping.status_map??{}),'rows="6"'),'JSON object mapping exact original status text to '+list(S.state.catalog.statuses).join(', ')+'.')+
  field('mapping-note','Report meaning and interpretation',textArea('mapping-note',mapping.note??'','rows="5"'),'Explain the event stream or snapshot, amount basis and original source statuses.',true)+
  '</div></fieldset>'+checkInput('mapping-confirmed','Confirm this mapping for every nonblank original row.',capture.confirmed===true)+
  '<p class="help">Leave confirmation unchecked to retain a working mapping and inspect its row issues. Confirmed captures can be selected for a new run.</p>',
  {submitLabel:'Save mapping',context,reopen:()=>mappingEditor(id),submit:async form=>{
   const payload={revision:context.revision,capture_id:id,mapping:readMapping(form,mapping),confirmed:formBoolean(form,'mapping-confirmed')};
   await mutate(base+'/mapping',payload,{label:'Save source mapping',message:payload.confirmed?'Source mapping confirmed. Select the capture for the intended run.':'Working mapping retained. Inspect the interpreted rows and issues.'});
  }}
 );
}
async function captureInspector(id,{offset=0,normalized=false}={}){
 const capture=await request(pathId('captures',id));
 const preview=capture.kind==='document'?null:await request(pathId('captures',id)+'/rows?offset='+offset+'&limit=25&normalized='+(normalized?'1':'0'));
 const controls=button('Download original','capture-download','data-id="'+h(id)+'"')+
  (capture.kind==='document'?'':button('Edit mapping','mapping','data-id="'+h(id)+'" data-write','primary'));
 const body=section(capture.filename,
  definitionList([['Source role',badge(capture.kind)],['Captured',h(date(capture.captured_at))],['Original size',h(txt(capture.bytes))+' bytes'],['Original records',h(txt(capture.rows))],['Mapping edition',h(txt(capture.mapping_version))],['Confirmed',h(txt(capture.confirmed))]])+
  details('Exact original source identity',{id:capture.id,sha256:capture.sha256,filename:capture.filename,bytes:capture.bytes}),controls)+
  section('Declared coverage',coverageDisplay(capture.coverage))+
  (preview?section(normalized?'Interpreted original rows':'Untouched original rows',
   '<div class="actions">'+button(normalized?'View original values':'View interpreted values','capture-preview','data-id="'+h(id)+'" data-offset="0" data-normalized="'+(normalized?'0':'1')+'"')+'</div>'+
   originalHeaders(list(capture.headers))+
   '<div class="pagination"><span>'+h(preview.total?'Records '+(offset+1)+'–'+Math.min(offset+25,preview.total)+' of '+preview.total:'No records')+'</span><div class="actions">'+
   button('Previous','capture-preview','data-id="'+h(id)+'" data-offset="'+Math.max(0,offset-25)+'" data-normalized="'+(normalized?'1':'0')+'"'+(!offset?' disabled':''),'small')+
   button('Next','capture-preview','data-id="'+h(id)+'" data-offset="'+(offset+25)+'" data-normalized="'+(normalized?'1':'0')+'"'+(offset+25>=preview.total?' disabled':''),'small')+'</div></div>'+
   genericSourcePreview(preview)+(list(preview.issues).length?details('Native input issues',preview.issues):'')):'')+
  section('Mapping history',details('Every retained mapping edition',capture.mapping_history??[],true));
 openDialog('Original source · '+capture.filename,body,{readOnly:true});
}
function runCaptureCheckboxes(selected=[]){
 const selectedIds=new Set(selected);
 return list(S.state.captures).filter(c=>c.kind!=='document').map(c=>
 '<label class="check"><input type="checkbox" name="run-captures" value="'+h(c.id)+'"'+(selectedIds.has(c.id)?' checked':'')+'><span><strong>'+h(label(c.kind))+' · '+h(c.filename)+'</strong><br><small>'+h(c.id)+' · mapping '+h(c.mapping_version)+' · '+(c.confirmed?'confirmed':'not confirmed')+'</small></span></label>'
 ).join('')||'<p class="muted">No data capture is retained.</p>';
}
function selectedChecked(form,name){return $$('input[name="'+name+'"]:checked',form).map(input=>input.value);}
function runEditor({refreshRun=false}={}){
 const current=S.detail,context={revision:S.state.revision,run_id:refreshRun?current?.run.id:null};
 if(refreshRun&&!context.run_id)throw new Error('Select the run whose source edition will be refreshed.');
 const selected=refreshRun?list(current.manifest).map(row=>row.capture_id):list(S.state.captures).filter(c=>c.current).map(c=>c.id);
 openDialog(refreshRun?'Refresh this run from retained originals':'Prepare daily financial run',
  (refreshRun?notice('This creates a new financial edition in the same run. Prior sources, allocations and close history remain retained; current approvals must match the new edition.'):'')+
  '<div class="form-grid">'+(!refreshRun?
   field('run-label','Run label',textInput('run-label','','required'))+
   field('run-start','First business date',textInput('run-start','','type="date" required'))+
   field('run-end','Last business date',textInput('run-end','','type="date" required')):'')+
  field('run-note',refreshRun?'Source refresh reason':'Observation and scope note',textArea('run-note','','rows="4"'),'',true)+
  '</div><fieldset><legend>Explicit retained source editions</legend>'+runCaptureCheckboxes(selected)+'</fieldset>',
  {submitLabel:refreshRun?'Refresh source edition':'Prepare run',context,reopen:()=>runEditor({refreshRun}),submit:async form=>{
   const common={revision:context.revision,capture_ids:selectedChecked(form,'run-captures'),note:formValue(form,'run-note')};
   const payload=refreshRun?{...common,run_id:context.run_id}:{...common,label:formValue(form,'run-label'),start_date:formValue(form,'run-start'),end_date:formValue(form,'run-end')};
   await mutate(base+(refreshRun?'/refresh':'/run'),payload,{label:refreshRun?'Refresh run source edition':'Prepare daily run',message:refreshRun?'New source edition retained in this run.':'Daily run prepared from the selected original editions.',after:()=>{S.tab='overview';}});
  }}
 );
}


function runContext(){
 if(!S.detail?.run?.id)throw new Error('Select a retained financial run.');
 return {revision:S.state.revision,run_id:S.detail.run.id,edit_revision:S.detail.run.edit_revision,snapshot_hash:S.detail.snapshot_hash};
}
function ownerReasonForm(note=''){
 return '<div class="form-grid">'+actorField()+field('note','Reason and observed evidence',textArea('note',note,'rows="4" required'),'',true)+'</div>';
}
function ownerValues(form){const owner=formValue(form,'actor');rememberActor(owner);return {owner,note:formValue(form,'note')};}
async function groupById(id){
 const cached=list(S.pageData.groups?.rows).find(row=>row.id===id);if(cached)return cached;
 const page=await request(pathId('runs',S.runId)+'/groups?query='+encodeURIComponent(id)+'&limit=50');
 const row=list(page.rows).find(row=>row.id===id);if(!row)throw new Error('This group is no longer present in the current financial edition. Refresh the run.');return row;
}
function groupChoice(row){return {value:row.id,label:row.transaction_id+' · '+row.currency+' · remainder '+txt(row.remaining_minor)+' minor units'};}
async function allocationEditor({sourceId='',targetId='',sourceQuery='',targetQuery=''}={}){
 const context=runContext(),prefix=pathId('runs',context.run_id);
 const [sourcePage,targetPage]=await Promise.all([
  request(prefix+'/groups?kind=permits&query='+encodeURIComponent(sourceQuery)+'&limit=100'),
  request(prefix+'/groups?kind=receivables&query='+encodeURIComponent(targetQuery)+'&limit=100')
 ]);
 const sources=list(sourcePage.rows),targets=list(targetPage.rows);
 if(sourceId&&!sources.some(row=>row.id===sourceId))sources.unshift(await groupById(sourceId));
 if(targetId&&!targets.some(row=>row.id===targetId))targets.unshift(await groupById(targetId));
 openDialog('Allocate permit collections to receivables',
  notice('Choose the exact original groups and a deliberate signed minor-unit amount. Partial and many-to-many allocations are supported; remaining amounts are computed by the native engine.')+
  '<div class="form-grid">'+
  field('source-group-query','Find permit group',textInput('source-group-query',sourceQuery))+
  field('target-group-query','Find receivables group',textInput('target-group-query',targetQuery))+
  '<div class="field wide"><div class="actions">'+button('Search group choices','allocation-search')+'</div><p class="help">Showing '+h(sources.length)+' of '+h(sourcePage.total)+' permit groups and '+h(targets.length)+' of '+h(targetPage.total)+' receivables groups. Search by an exact original reference when the required group is outside this page.</p></div>'+
  field('source-group','Permit group',selectInput('source-group',[{value:'',label:'Choose the original permit group'},...sources.filter(row=>row.kind==='permits').map(groupChoice)],sourceId,'required'))+
  field('target-group','Receivables group',selectInput('target-group',[{value:'',label:'Choose the original receiving group'},...targets.filter(row=>row.kind==='receivables').map(groupChoice)],targetId,'required'))+
  field('allocation-amount','Signed allocation in minor units',textInput('allocation-amount','','required inputmode="numeric" autocomplete="off"'),'Use a signed integer string. The amount must have the direction of both remaining balances and fit each remainder.',true)+
  '</div>'+ownerReasonForm(),
  {submitLabel:'Record allocation',context,reopen:()=>allocationEditor({sourceId,targetId,sourceQuery,targetQuery}),submit:async form=>{
   const payload={revision:context.revision,run_id:context.run_id,source_group_id:formValue(form,'source-group'),target_group_id:formValue(form,'target-group'),amount_minor:formValue(form,'allocation-amount'),...ownerValues(form)};
   await mutate(base+'/allocate',payload,{label:'Record financial allocation',message:'Explicit allocation retained. Native remainders and review edition updated.'});
  }}
 );
}
async function groupInspector(id){
 const row=await groupById(id),settings=settingsFor(S.detail);
 const actions=(row.kind==='permits'?button('Allocate this permit group','allocate','data-source="'+h(row.id)+'" data-write','primary'):
 row.kind==='receivables'?button('Allocate to this receivables group','allocate','data-target="'+h(row.id)+'" data-write','primary'):'')+
 button('Inspect source transactions','group-transactions','data-kind="'+h(row.kind)+'" data-query="'+h(row.transaction_id)+'"');
 openDialog('Transaction group · '+row.transaction_id,
  section(label(row.kind),definitionList([
   ['Group identity',h(row.id)],['Transaction',h(row.transaction_id)],['Currency',h(row.currency)],
   ['Native net',money(row.net_minor,row.currency,settings)],['Allocated',money(row.allocated_minor,row.currency,settings)],
   ['Remaining',money(row.remaining_minor,row.currency,settings)]
  ])+details('Original references and source rows',row,true),actions),{readOnly:true});
}
async function retireAllocationEditor(id){
 const row=await lookupRunEntry('allocations',id);
 const context=runContext();
 openDialog('Retire recorded allocation',details('Allocation that will remain in history',row,true)+ownerReasonForm(),
  {submitLabel:'Retire allocation',context,reopen:()=>retireAllocationEditor(id),submit:async form=>{
   await mutate(base+'/allocation-retire',{revision:context.revision,run_id:context.run_id,allocation_id:id,...ownerValues(form)},{label:'Retire financial allocation',message:'Allocation retired; its original amount and decision remain in history.'});
  }});
}
function findRow(recordKey){
 return list(S.pageData.transactions?.rows).find(row=>row.record_key===recordKey)||null;
}
function correctionFieldControl(field,row){
 const key=field.key,value=row[key];
 const values=key==='event'?list(S.state.catalog.events):key==='status'?list(S.state.catalog.statuses):null;
 if(values)return selectInput('change:'+key,[{value:'',label:'Not supplied'},...values],value??'');
 return textInput('change:'+key,value??'',(key.endsWith('_minor')?'inputmode="numeric" ':'')+'autocomplete="off"');
}
async function correctionEditor(recordKey){
 const row=await lookupRunEntry('rows',recordKey,'record_key');
 const context=runContext(),fields=canonicalFields().filter(field=>field.key!=='record_id');
 openDialog('Correct an interpreted source observation',
  originalRowPanel(row)+
  notice('Only checked fields change. Monetary corrections use exact signed integer MINOR units, regardless of the original file’s amount format. Original bytes and before/after history remain unchanged.')+
  dataTable(['Apply','Interpreted field','Current / intended value'],fields.map(field=>[
   '<input type="checkbox" name="apply:'+h(field.key)+'" id="apply-'+h(field.key)+'" aria-label="Apply '+h(field.label??field.key)+'">',
   '<label for="apply-'+h(field.key)+'">'+h(field.label??label(field.key))+'</label>',
   correctionFieldControl(field,row)
  ]))+
  '<fieldset><legend>Explicit row exclusion</legend>'+
  checkInput('apply:excluded','Change whether this source row is excluded from this interpretation.',false)+
  checkInput('change:excluded','Exclude this row from financial contribution.',row.excluded===true)+
  field('exclusion-reason','Exclusion reason',textArea('exclusion-reason',row.exclusion_reason??'','rows="3"'))+'</fieldset>'+
  ownerReasonForm(),
  {submitLabel:'Record interpretation correction',context,reopen:()=>correctionEditor(recordKey),submit:async form=>{
   const changes={};
   for(const field of fields){
    if(!formBoolean(form,'apply:'+field.key))continue;
    const value=formValue(form,'change:'+field.key);
    changes[field.key]=field.key.endsWith('_minor')&&value===''?null:value;
   }
   if(formBoolean(form,'apply:excluded')){changes.excluded=formBoolean(form,'change:excluded');changes.exclusion_reason=formValue(form,'exclusion-reason');}
   if(!Object.keys(changes).length)throw new Error('Choose the interpreted field or exclusion that should change.');
   await mutate(base+'/correct',{revision:context.revision,run_id:context.run_id,record_key:recordKey,changes,...ownerValues(form)},{label:'Correct source interpretation',message:'Named correction retained with its original source and before/after values.'});
  }}
 );
}
function correctionsDisplay(){
 const page=S.pageData.corrections??{rows:[],total:0};
 return pagination(page.total,'corrections')+dataTable(['Correction','Source record','State','Recorded by / reason','Before / after',''],list(page.rows).map(row=>[
  h(row.id),h(row.record_key),badge(row.active===false?'retired':'active'),h(row.owner)+'<br>'+h(row.note),details('Retained correction event',row),
  row.active===false?'':button('Retire correction','correction-retire','data-id="'+h(row.id)+'" data-write','small')
 ]),{emptyText:'No interpretation correction is recorded.'});
}
async function retireCorrectionEditor(id){
 const row=await lookupRunEntry('corrections',id);
 const context=runContext();
 openDialog('Retire interpretation correction',details('Original correction retained in history',row,true)+ownerReasonForm(),
  {submitLabel:'Retire correction',context,reopen:()=>retireCorrectionEditor(id),submit:async form=>{
   await mutate(base+'/correction-retire',{revision:context.revision,run_id:context.run_id,correction_id:id,...ownerValues(form)},{label:'Retire interpretation correction',message:'Correction retired. The remaining active corrections determine the new financial edition.'});
  }});
}
async function findingEditor(id){
 const finding=await lookupRunEntry('findings',id);
 const context=runContext(),states=findingReviewChoices().filter(row=>finding.waivable===true||row.value!=='accepted_exception');
 openDialog('Review '+finding.code,
  '<h3>'+h(finding.message)+'</h3><p>'+badge(finding.severity)+(finding.waivable===true?' · An explained exception is available.':' · This finding cannot be waived.')+'</p>'+
  details('Exact source-bound finding',finding,true)+
  field('review-status','Recorded disposition',selectInput('review-status',states,finding.review?.status??'open','required'))+
  '<p class="help">A resolved investigation does not remove a still-present discrepancy. An accepted exception remains separate from the native arithmetic.</p>'+
  ownerReasonForm(finding.review?.note??''),
  {submitLabel:'Record finding review',context,reopen:()=>findingEditor(id),submit:async form=>{
   await mutate(base+'/review',{revision:context.revision,run_id:context.run_id,finding_id:id,status:formValue(form,'review-status'),...ownerValues(form)},{label:'Review financial finding',message:'Finding disposition retained against its exact source evidence.'});
  }});
}


function documentCheckboxes(name,selected=[]){
 const ids=new Set(selected);
 return list(S.state.captures).map(row=>'<label class="check"><input type="checkbox" name="'+h(name)+'" value="'+h(row.id)+'"'+(ids.has(row.id)?' checked':'')+'><span>'+h(row.filename)+' · '+h(label(row.kind))+'<br><small class="mono">'+h(row.id)+'</small></span></label>').join('')||'<p class="muted">No original supporting document or source is retained.</p>';
}
function signoffEditor(){
 const context=runContext();
 openDialog('Record supplied staff review',
  notice('This records the named staff member’s supplied statement against the exact current financial edition. It is separate from agency-system authentication.')+
  definitionList([['Run',h(S.detail.run.label??context.run_id)],['Financial edit revision',h(context.edit_revision)],['Reviewed snapshot',h(context.snapshot_hash)]])+
  '<div class="form-grid">'+
  field('reviewer-id','Distinct staff identifier',textInput('reviewer-id','','required autocomplete="off"'),'Use the actual stable staff identity for this review.')+
  field('reviewer-name','Staff name',textInput('reviewer-name','','required autocomplete="name"'))+
  field('reviewer-role','Role',textInput('reviewer-role','','required'))+
  field('reviewer-statement','Review statement',textArea('reviewer-statement','','rows="5" required'),'Record what was checked and the staff member’s actual conclusion.',true)+
  field('reviewer-note','Supporting review note',textArea('reviewer-note','','rows="3"'),'',true)+
  '</div>',
  {submitLabel:'Retain staff review',context,reopen:signoffEditor,submit:async form=>{
   await mutate(base+'/signoff',{revision:context.revision,run_id:context.run_id,reviewer_id:formValue(form,'reviewer-id'),name:formValue(form,'reviewer-name'),role:formValue(form,'reviewer-role'),statement:formValue(form,'reviewer-statement'),note:formValue(form,'reviewer-note')},{label:'Record staff review',message:'Staff review retained against this exact financial edition.'});
  }}
 );
}
function closeRunEditor({reopen=false}={}){
 const context=runContext();
 openDialog(reopen?'Reopen financial work':'Record daily close',
  (reopen?notice('The earlier close and all original reviews remain in history. A later close needs renewed staff reviews.'):
  section('Current reviewer observations',reviewerDisplay(S.detail))+
  '<fieldset><legend>Original deposit and supporting documents</legend>'+documentCheckboxes('deposit-documents')+'</fieldset>')+
  ownerReasonForm(),
  {submitLabel:reopen?'Reopen retained run':'Record daily close',context,reopen:()=>closeRunEditor({reopen}),submit:async form=>{
   const payload={revision:context.revision,run_id:context.run_id,...ownerValues(form)};
   if(!reopen)payload.deposit_document_ids=selectedChecked(form,'deposit-documents');
   await mutate(base+(reopen?'/reopen':'/close'),payload,{label:reopen?'Reopen financial run':'Record daily close',message:reopen?'Financial work reopened; previous close remains retained.':'Daily close retained with its exact reviewer and document identities.'});
  }}
 );
}
function packetEditor(){
 const context=runContext();
 openDialog('Prepare complete financial packet',
  notice('The packet freezes this run’s complete originals, financial ledgers, corrections, allocations, staff reviews, actual exchange observations and implementation. Prior packet bytes remain available.')+
  field('packet-label','Packet label',textInput('packet-label',(S.detail.run.label??'Daily cashiering')+' · current edition','required'))+
  ownerReasonForm(),
  {submitLabel:'Prepare immutable packet',context,reopen:packetEditor,submit:async form=>{
   await mutate(base+'/packet',{revision:context.revision,run_id:context.run_id,label:formValue(form,'packet-label'),...ownerValues(form)},{label:'Prepare complete financial packet',message:'Complete immutable financial packet prepared.',after:()=>{S.tab='handoff';}});
  }}
 );
}
async function packetInspector(id){
 const packet=await request(pathId('packets',id));
 openDialog(packet.label??packet.title??'Retained financial packet',
  definitionList([['Packet',h(packet.id)],['Run',h(packet.run_id)],['Financial edition',h(packet.edit_revision)],['Prepared',h(date(packet.created_at))],['Bytes',h(txt(packet.bytes))],['SHA-256',h(packet.sha256)]])+
  '<div class="actions">'+button('Download exact packet','artifact-download','data-id="'+h(packet.artifact_id)+'" data-filename="cashiering-packet.zip"','primary')+'</div>'+
  details('Complete member manifest and source binding',packet,true),{readOnly:true});
}
async function editionInspector(id){
 const detail=await request(base+'/editions/'+encodeURIComponent(id)),settings=settingsFor(detail);
 openDialog('Original financial edition · '+txt(detail.run?.edit_revision),
  notice('This is a retained prior edition. Inspecting it does not change current sources, decisions or the selected daily close.')+
  definitionList([['Run',h(detail.run?.label??detail.run?.id)],['Created',h(date(detail.run?.created_at))],['Financial edition',h(detail.run?.edit_revision)],['Snapshot',h(detail.snapshot_hash)]])+
  '<div class="actions">'+button('Download original edition JSON','edition-download','data-id="'+h(id)+'"')+'</div>'+
  section('Original financial position',nativeTotals(detail))+
  section('Original daily balances',nativeBalances(detail))+
  section('Original selected sources',nativeManifest(detail))+
  details('Complete historical detail',detail),{readOnly:true});
}
function editionListDisplay(){
 const page=S.pageData.editions??{rows:[],total:0};
 return pagination(page.total,'editions')+dataTable(['Edition','Recorded','Action','Snapshot',''],list(page.rows).map(row=>[
  h(row.edit_revision),h(date(row.created_at)),h(row.action),'<span class="mono">'+h(row.snapshot_hash)+'</span>',button('Inspect original edition','edition','data-id="'+h(row.id)+'"','small')
 ]),{emptyText:'No previous financial edition is retained in this view.'});
}


function profileKey(profile){return encodeURIComponent(profile.id)+'@'+profile.version;}
function parseProfileKey(value){
 const at=String(value).lastIndexOf('@');if(at<1)throw new Error('Choose a retained receiving profile edition.');
 const id=decodeURIComponent(value.slice(0,at)),version=Number(value.slice(at+1));
 if(!Number.isSafeInteger(version))throw new Error('The retained profile version is invalid.');
 return {id,version};
}
function findProfile(id,version){
 const rows=interfaceProfiles().filter(row=>row.id===id);
 return version!==undefined?rows.find(row=>row.version===Number(version))??null:rows.sort((a,b)=>b.version-a.version)[0]??null;
}
const balanceFieldNames=['business_date','session_id','payment_type','currency','expected_minor','cashier_minor','cashier_difference_minor','processor_minor','processor_difference_minor'];
function profileFieldChoices(){return [...new Set([...balanceFieldNames,...canonicalFields().map(field=>field.key),'record_key','raw_status','raw_event','in_scope','excluded','reported_net_minor'])];}
function profileColumnRow(index,column={}){
 const mode=own(column,'literal')?'literal':'field',value=mode==='literal'?column.literal:column.field??'';
 return '<tr class="profile-column" data-index="'+index+'"><td>'+textInput('column-header:'+index,column.header??'','required aria-label="Column header"')+'</td>'+
  '<td>'+selectInput('column-mode:'+index,[{value:'field',label:'Native field'},{value:'literal',label:'Supplied literal'}],mode,'aria-label="Column source"')+'</td>'+
  '<td>'+textInput('column-value:'+index,value??'','list="profile-field-options" aria-label="Field or literal"')+'</td>'+
  '<td>'+selectInput('column-format:'+index,['text','minor','major'],column.format??'text','aria-label="Column format"')+'</td>'+
  '<td>'+button('Remove','profile-column-remove','data-index="'+index+'"','small')+'</td></tr>';
}
function readProfileColumns(form){
 return $$('.profile-column',form).map(row=>{
  const i=row.dataset.index,mode=formValue(form,'column-mode:'+i),value=formValue(form,'column-value:'+i);
  return {header:formValue(form,'column-header:'+i),format:formValue(form,'column-format:'+i),...(mode==='literal'?{literal:value}:{field:value})};
 });
}
function profileEditor(id='',version){
 const profile=id?findProfile(id,version):null;if(id&&!profile)throw new Error('Refresh the retained profile list.');
 const context={revision:S.state.revision},columns=clone(profile?.columns??[{header:'',field:'',format:'text'}]);
 S.profileNextIndex=columns.length;
 const delimiters=[{value:',',label:'Comma'},{value:'\t',label:'Tab'},{value:';',label:'Semicolon'},{value:'|',label:'Vertical bar'}];
 if(profile?.delimiter&&!delimiters.some(row=>row.value===profile.delimiter))delimiters.push({value:profile.delimiter,label:'Retained delimiter: '+profile.delimiter});
 openDialog(id?'Edit retained receiving layout':'Create explicit receiving layout',
  notice('Use the actual partner-supplied layout and account-code literals. The workspace does not assume a Munis or payment-provider file definition.')+
  '<div class="form-grid">'+
  field('profile-name','Layout name',textInput('profile-name',profile?.name??'','required'))+
  field('profile-scope','Row family',selectInput('profile-scope',[{value:'balances',label:'Daily balance groups'},{value:'transactions',label:'Original interpreted transactions'}],profile?.scope??'balances'))+
  field('profile-lane','Transaction source role',selectInput('profile-lane',['permits','receivables','processor','cashier'],profile?.lane??'permits'),'Used for a transaction-row layout.')+
  field('profile-delimiter','Field delimiter',selectInput('profile-delimiter',delimiters,profile?.delimiter??','))+
  field('profile-line-ending','Line ending',selectInput('profile-line-ending',['CRLF','LF'],profile?.line_ending??'CRLF'))+
  '<div class="field">'+checkInput('profile-header','Include the declared header row.',profile?.include_header??true)+'</div>'+
  '</div><datalist id="profile-field-options">'+profileFieldChoices().map(name=>'<option value="'+h(name)+'"></option>').join('')+'</datalist>'+
  '<div class="table-wrap" tabindex="0" role="region" aria-label="Declared output columns"><table><thead><tr><th>Output header</th><th>Source</th><th>Exact field / literal</th><th>Format</th><th></th></tr></thead><tbody id="profile-columns">'+columns.map((column,index)=>profileColumnRow(index,column)).join('')+'</tbody></table></div>'+
  '<div class="actions">'+button('Add output column','profile-column-add')+'</div>'+
  '<p class="help">Column order is the output order. “Major” uses each row’s native currency scale. “Minor” retains signed integer unit strings. These machine-interface bytes are separate from spreadsheet-safe human report CSVs.</p>'+
  field('profile-note','Source layout and review notes',textArea('profile-note',profile?.note??'','rows="5" required'),'Name the actual supplied layout, field meanings, constants and intended receiving behavior.')+
  (profile?details('Original retained profile edition',profile):''),
  {submitLabel:id?'Save new layout edition':'Save receiving layout',context,reopen:()=>profileEditor(id),submit:async form=>{
   const payload={revision:context.revision,...(id?{id}:{}),name:formValue(form,'profile-name'),columns:readProfileColumns(form),delimiter:formValue(form,'profile-delimiter'),include_header:formBoolean(form,'profile-header'),line_ending:formValue(form,'profile-line-ending'),scope:formValue(form,'profile-scope'),lane:formValue(form,'profile-lane'),note:formValue(form,'profile-note')};
   await mutate(base+'/profile',payload,{label:'Save receiving layout edition',message:'Exact receiving layout edition retained.'});
  }}
 );
}
function profileReviewDisplay(profile){
 if(!profile)return empty('Choose a retained layout edition');
 return definitionList([['Layout',h(profile.name)],['Version',h(profile.version)],['Row family',h(profile.scope)+(profile.scope==='transactions'?' · '+h(profile.lane):'')],['Header',h(txt(profile.include_header))],['Line ending',h(profile.line_ending)]])+
  dataTable(['Output header','Source field / supplied literal','Format'],list(profile.columns).map(column=>[
   h(column.header),own(column,'literal')?'Literal: '+h(txt(column.literal)):h(column.field),h(column.format)
  ]))+details('Complete exact layout and source notes',profile);
}
function interfacePrepareEditor(){
 const context=runContext(),profiles=interfaceProfiles();
 if(!profiles.length)throw new Error('Create the supplied receiving profile first.');
 const first=profiles[0];
 openDialog('Review layout and prepare interface output',
  field('export-profile','Exact retained layout edition',selectInput('export-profile',profiles.map(profile=>({value:profileKey(profile),label:profile.name+' · edition '+profile.version})),profileKey(first),'required'))+
  '<div id="selected-profile-review">'+profileReviewDisplay(first)+'</div>'+
  field('export-label','Prepared output label',textInput('export-label','','required'))+
  checkInput('layout-reviewed','I reviewed these exact columns, formats and supplied literals for this output.',false,'required')+
  ownerReasonForm(),
  {submitLabel:'Prepare reviewed layout',context,reopen:interfacePrepareEditor,submit:async form=>{
   if(!formBoolean(form,'layout-reviewed'))throw new Error('Review the selected layout before preparing its output.');
   const profile=parseProfileKey(formValue(form,'export-profile'));
   await mutate(base+'/interface-prepare',{revision:context.revision,run_id:context.run_id,profile_id:profile.id,profile_version:profile.version,label:formValue(form,'export-label'),...ownerValues(form)},{label:'Prepare receiving interface output',message:'Exact interface bytes prepared. No transmission or posting has been recorded.'});
  }}
 );
}
function interfaceExportById(id){return list(S.detail?.interface_exports).find(row=>row.id===id)||null;}
function interfaceInspector(id){
 const row=interfaceExportById(id);if(!row)throw new Error('Refresh this run’s retained interface outputs.');
 openDialog('Prepared interface · '+(row.label??row.filename??row.id),
  definitionList([['Prepared identity',h(row.id)],['Financial edit revision',h(row.edit_revision)],['Layout edition',h(row.profile_id??row.layout_id)+' · '+h(row.profile_version??row.layout_version)],['Native observation state',badge(row.status)],['Original bytes',h(row.sha256)]])+
  '<div class="actions">'+button('Download exact interface','artifact-download','data-id="'+h(row.artifact_id)+'" data-filename="cashiering-interface.csv"','primary')+
  button('Record actual external observation','interface-receipt','data-id="'+h(row.id)+'" data-write')+'</div>'+
  details('Full prepared output and receiving history',row,true),{readOnly:true});
}
function interfaceReceiptEditor(id){
 const output=interfaceExportById(id);if(!output)throw new Error('Refresh this run’s prepared interface list.');
 const context=runContext();
 openDialog('Record actual receiving or transmission observation',
  notice('Record the supplied external observation for this exact prepared file. An export or a note alone does not establish acceptance or posting.')+
  details('Exact prepared output',output)+
  '<div class="form-grid">'+
  field('receipt-status','Actual observation',selectInput('receipt-status',[{value:'',label:'Choose the supplied observation'},...list(S.state.catalog.receipt_states)],'','required'))+
  field('receipt-at','Observed at',textInput('receipt-at','','required placeholder="2026-10-12T17:05:00-07:00"'),'Original observation time with its explicit offset.')+
  field('receipt-reference','Native batch / transaction / receipt reference',textInput('receipt-reference','','required'))+
  field('receipt-document','Original supporting record',selectInput('receipt-document',[{value:'',label:'Choose the retained original'},...captureChoices()],'','required'),'Attach the actual original first if it is not retained.')+
  '</div>'+ownerReasonForm(),
  {submitLabel:'Retain actual observation',context,reopen:()=>interfaceReceiptEditor(id),submit:async form=>{
   await mutate(base+'/interface-receipt',{revision:context.revision,run_id:context.run_id,export_id:id,status:formValue(form,'receipt-status'),observed_at:formValue(form,'receipt-at'),reference:formValue(form,'receipt-reference'),document_id:formValue(form,'receipt-document'),...ownerValues(form)},{label:'Retain actual interface observation',message:'External observation retained against the exact prepared file and source document.'});
  }}
 );
}



let interactionInFlight=false;
const interactionControls=new Map();
function applyInteractionLocks(){
 if(!interactionInFlight)return;
 for(const node of $$('#app button,#app input,#app select,#app textarea,#editor button,#editor input,#editor select,#editor textarea')){
  if(!interactionControls.has(node))interactionControls.set(node,node.disabled);
  node.disabled=true;
 }
 $('#app')?.setAttribute('aria-busy','true');
 if($('#editor').open)$('#editor').setAttribute('aria-busy','true');
}
function interactionLock(value){
 interactionInFlight=value;
 if(value){applyInteractionLocks();return;}
 for(const [node,disabled] of interactionControls){if(node.isConnected)node.disabled=disabled;}
 interactionControls.clear();
 $('#app')?.removeAttribute('aria-busy');$('#editor')?.removeAttribute('aria-busy');
 setBusy(S.busy);
}
function boundedCount(value,fallback=0){
 const parsed=Number(value);return Number.isSafeInteger(parsed)&&parsed>=0?parsed:fallback;
}
async function lookupRunEntry(collection,id,key='id'){
 const cache=collection==='rows'?S.pageData.transactions:S.pageData[collection];
 const cached=list(cache?.rows).find(row=>row[key]===id);if(cached)return cached;
 const runId=S.runId;if(!runId)throw new Error('Select the retained run first.');
 const params=new URLSearchParams({query:String(id),limit:'100',offset:'0'});
 if(collection==='rows')params.set('kind',S.filters.lane||'permits');
 const page=await request(pathId('runs',runId)+'/'+collection+'?'+params);
 const row=list(page.rows).find(item=>item[key]===id);
 if(!row)throw new Error('The selected '+label(collection).toLowerCase()+' entry is absent from the current edition. Inspect its original edition in Packets & history.');
 return row;
}
function draftFields(form){
 return Array.from(form?.elements??[]).filter(node=>node.name&&!['button','submit','file'].includes(node.type)).map(node=>({
  name:node.name,type:node.type,value:node.value,checked:node.checked
 }));
}
function restoreDraftFields(form,draft,skip=[]){
 for(const saved of draft){
  if(skip.includes(saved.name))continue;
  const control=form?.elements.namedItem(saved.name);if(!control)continue;
  if(['checkbox','radio'].includes(saved.type))control.checked=saved.checked;
  else if(control.tagName==='SELECT'){if(Array.from(control.options).some(option=>option.value===saved.value))control.value=saved.value;}
  else if('value' in control)control.value=saved.value;
 }
}
async function searchAllocationChoices(){
 const form=$('#dialog-form'),draft=draftFields(form),args={
  sourceId:formValue(form,'source-group'),targetId:formValue(form,'target-group'),
  sourceQuery:formValue(form,'source-group-query'),targetQuery:formValue(form,'target-group-query')
 };
 await allocationEditor(args);
 restoreDraftFields($('#dialog-form'),draft);
}
function changeTab(tab){
 if(!['overview','intake','reconciliation','findings','close','interfaces','handoff','settings','sources'].includes(tab))throw new Error('Unknown operator view.');
 S.tab=tab;
}
async function switchView(tab,{focus=true}={}){
 changeTab(tab);dialogClose();await refresh({keepDialog:true});
 if(focus)$('#main')?.focus({preventScroll:true});
}
async function selectCapture(id,selected){
 const capture=captureById(id);if(!capture)throw new Error('Refresh the source register.');
 await mutate(base+'/select',{revision:S.state.revision,capture_id:id,selected},{label:selected?'Select retained source':'Unselect retained source',message:selected?'Source selected for the defaults of a new run. Existing runs remain retained.':'Source unselected from new-run defaults. Earlier runs retain their original selection.'});
}
function pendingDismissEditor(){
 const pending=S.pending;
 if(!pending?.last_lookup_missing)throw new Error('Recover the original request result before reviewing this browser notice.');
 openDialog('Review an unresolved browser request',
  notice('The latest native lookup found no committed result for this exact request ID. Removing this browser notice does not cancel an in-flight request or claim that it failed. The current workspace revision protects a later change from silently overlapping another writer.')+
  details('Original retained request identity',pendingMetadata(pending),true)+
  definitionList([['Current saved workspace revision',h(S.state.revision)],['Last original lookup',h(date(pending.last_lookup_missing))]])+
  checkInput('pending-state-reviewed','I inspected the current saved records and want to remove only this browser’s pending notice.',false,'required'),
  {submitLabel:'Remove this browser notice',context:{request_id:pendingMetadata(pending).request_id},submit:async form=>{
   if(!formBoolean(form,'pending-state-reviewed'))throw new Error('Inspect the current saved state before removing the local notice.');
   savePending(null);dialogClose({force:true});await refresh({keepDialog:true});
   notification('The local pending notice was removed. No backend action was canceled or replayed.');
  }}
 );
}
async function dispatchAction(node){
 const action=node.dataset.action,d=node.dataset;
 switch(action){
  case 'close-dialog':dialogClose();return;
  case 'reopen-dialog':await reopenDialog();return;
  case 'refresh':await refresh();return;
  case 'tab':await switchView(d.tab);return;
  case 'source-catalog':await switchView('sources');return;
  case 'page':
   if(!/^(captures|groups|allocations|corrections|findings|history|editions|rows-(permits|receivables|processor|cashier))$/.test(d.pageKey??''))throw new Error('Unknown retained page.');
   S.pages[d.pageKey]=boundedCount(d.offset);await refresh({keepDialog:true});return;
  case 'upload':uploadEditor('permits');return;
  case 'upload-document':uploadEditor('document');return;
  case 'capture':S.captureId=d.id;await captureInspector(d.id);return;
  case 'capture-preview':await captureInspector(d.id,{offset:boundedCount(d.offset),normalized:d.normalized==='1'});return;
  case 'capture-download':await downloadUrl(pathId('captures',d.id)+'/download',captureById(d.id)?.filename??'original-source');return;
  case 'mapping':await mappingEditor(d.id);return;
  case 'select-capture':await selectCapture(d.id,d.selected==='1');return;
  case 'run-new':runEditor();return;
  case 'run-refresh':runEditor({refreshRun:true});return;
  case 'run-settings':settingsEditor({run:true});return;
  case 'settings-edit':settingsEditor();return;
  case 'group':await groupInspector(d.id);return;
  case 'group-transactions':
   S.filters.lane=d.kind;S.filters.transactionQuery=d.query??'';S.pages['rows-'+d.kind]=0;
   await switchView('reconciliation');$('#transaction-filter')?.scrollIntoView({block:'start'});return;
  case 'allocate':await allocationEditor({sourceId:d.source??'',targetId:d.target??''});return;
  case 'allocation-search':await searchAllocationChoices();return;
  case 'remove-allocation':await retireAllocationEditor(d.id);return;
  case 'transaction':await correctionEditor(d.recordKey);return;
  case 'correction-retire':await retireCorrectionEditor(d.id);return;
  case 'finding':await findingEditor(d.id);return;
  case 'signoff':signoffEditor();return;
  case 'close-run':closeRunEditor();return;
  case 'reopen-run':closeRunEditor({reopen:true});return;
  case 'profile-new':profileEditor();return;
  case 'profile':profileEditor(d.id,d.version?boundedCount(d.version):undefined);return;
  case 'profile-column-add':{
   const body=$('#profile-columns');if(!body)throw new Error('Open the receiving-layout editor first.');
   body.insertAdjacentHTML('beforeend',profileColumnRow(S.profileNextIndex++));
   $('.profile-column:last-child input',body)?.focus();applyInteractionLocks();return;
  }
  case 'profile-column-remove':node.closest('.profile-column')?.remove();return;
  case 'interface-prepare':interfacePrepareEditor();return;
  case 'interface-export':interfaceInspector(d.id);return;
  case 'interface-receipt':interfaceReceiptEditor(d.id);return;
  case 'artifact-download':await downloadUrl(pathId('artifacts',d.id),d.filename||'cashiering-artifact');return;
  case 'packet-prepare':packetEditor();return;
  case 'packet':await packetInspector(d.id);return;
  case 'edition':await editionInspector(d.id);return;
  case 'edition-download':await downloadUrl(base+'/editions/'+encodeURIComponent(d.id),'cashiering-original-edition.json');return;
  case 'run-json':if(!S.runId)throw new Error('Select a run first.');await downloadUrl(pathId('runs',S.runId),'cashiering-current-run.json');return;
  case 'run-report':if(!S.runId)throw new Error('Select a run first.');await previewGeneratedReport(pathId('runs',S.runId)+'/report','Daily cashiering · complete report');return;
  case 'backup':await downloadUrl('/api/backup','berkeley-permit-cashiering-workspace.sqlite');return;
  case 'reconcile-pending':await recoverPending();return;
  case 'resume-pending':await recoverPending({resume:true});return;
  case 'dismiss-pending':pendingDismissEditor();return;
  default:throw new Error('This operator control is not registered: '+action);
 }
}
document.addEventListener('click',async event=>{
 const node=event.target.closest?.('[data-action]');if(!node)return;
 event.preventDefault();if(interactionInFlight||S.busy||node.disabled)return;
 interactionLock(true);
 try{await dispatchAction(node);}catch(error){showDialogError(error);}
 finally{interactionLock(false);}
});
document.addEventListener('submit',async event=>{
 const form=event.target;
 if(!['dialog-form','finding-filter','transaction-filter','group-filter'].includes(form.id))return;
 event.preventDefault();if(interactionInFlight||S.busy)return;
 if(!form.reportValidity())return;
 const submit=S.dialog?.submit;
 if(form.id==='dialog-form'&&(!submit||S.dialog.readOnly))return;
 interactionLock(true);
 try{
  if(form.id==='dialog-form'){const error=$('.dialog-error',form);if(error){error.hidden=true;error.innerHTML='';}await submit(form);}
  else if(form.id==='finding-filter'){
   S.filters.findingQuery=formValue(form,'finding-query');S.filters.findingStatus=formValue(form,'finding-status');S.pages.findings=0;await refresh({keepDialog:true});
  }else if(form.id==='transaction-filter'){
   S.filters.lane=formValue(form,'transaction-lane');S.filters.transactionQuery=formValue(form,'transaction-query');S.pages['rows-'+S.filters.lane]=0;await refresh({keepDialog:true});
  }else{
   S.filters.groupKind=formValue(form,'group-kind');S.filters.groupQuery=formValue(form,'group-query');S.pages.groups=0;await refresh({keepDialog:true});
  }
 }catch(error){showDialogError(error);}
 finally{interactionLock(false);}
});
document.addEventListener('change',async event=>{
 const control=event.target;
 if(control.id==='export-profile'){
  if(interactionInFlight||S.busy)return;
  try{const profile=parseProfileKey(control.value);$('#selected-profile-review').innerHTML=profileReviewDisplay(findProfile(profile.id,profile.version));const reviewed=$('#layout-reviewed');if(reviewed)reviewed.checked=false;}catch(error){showDialogError(error);}return;
 }
 if(control.id!=='active-run')return;
 if(interactionInFlight||S.busy){control.value=S.runId;return;}
 interactionLock(true);
 try{
  const selected=control.value;
  if(selected&&!list(S.state?.runs).some(row=>row.id===selected))throw new Error('The selected retained run is no longer in this workspace.');
  S.runId=selected;S.pages={};S.pageData={};dialogClose();await refresh({keepDialog:true});
 }catch(error){notification(errorText(error),{persistent:true,error:true});}
 finally{interactionLock(false);}
});
$('#editor').addEventListener('cancel',event=>{
 if(interactionInFlight||S.busy){event.preventDefault();return;}
 event.preventDefault();dialogClose();
});
$('#editor').addEventListener('close',()=>{if(!$('#editor').open)S.dialog=null;});
window.addEventListener('beforeunload',event=>{
 if(S.busy||interactionInFlight){event.preventDefault();event.returnValue='';}
});
async function boot(){
 restorePending();
 interactionLock(true);
 try{await refresh({keepDialog:true});}
 catch(error){
  $('#app').innerHTML='<main id="main" class="workspace">'+empty('The saved workspace could not be read',errorText(error),button('Read saved workspace again','refresh'))+'</main>';
  notification('No new financial action was sent. '+errorText(error),{persistent:true,error:true});
 }
 finally{interactionLock(false);}
}
boot();
