// MIT. Plain, retained-state operator UI; all domain behavior stays in the application.
const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state,selectedEdition=null,loadedRows=[],rowPage=0,merchant=null,pageIdentity=null;
let liveProducts=[],selectedLive=null,liveDetail=null,livePlanIdentity=null;
function notify(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
async function api(path,body){const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw new Error(result.message||result.error||'Operation failed.');return result;}
async function action(label,fn,button){if(button)button.disabled=true;notify(label+'…');try{const result=await fn();await refresh();notify(label+' completed.');return result;}catch(error){notify(error.message,true);}finally{if(button)button.disabled=false;}}
function options(id,items,label=value=>value.name||value.label||value.id){const node=$(id),selected=node.value;node.innerHTML=items.map(value=>`<option value="${esc(value.id)}">${esc(label(value))}</option>`).join('');if(items.some(value=>value.id===selected))node.value=selected;}
function table(headers,rows){return rows.length?`<table><thead><tr>${headers.map(value=>`<th>${esc(value)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(value=>`<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<div class="empty">No records yet.</div>';}
const badge=value=>`<span class="status ${value==='COMPLETE'?'complete':value==='FAILED'?'failed':''}">${esc(value)}</span>`;
const time=value=>value?new Date(value).toLocaleString():'';
const connection=()=>state?.connections.find(value=>value.id===$('connection').value);
const entity=()=>connection()?.catalog.entitySets.find(value=>value.name===$('entity-set').value);
const fields=()=>entity()?.fields||[];
function drawSchema(){
  const set=entity(),catalog=connection()?.catalog;
  if(!set){$('properties').innerHTML='<div class="empty">Connect a service to inspect its entity sets.</div>';return;}
  $('schema-summary').innerHTML=`<span>${esc(set.entityType)}</span><span>${set.fields.length} properties</span><span>Keys: ${esc(set.keyFields.join(', '))}</span><span>OData ${esc(catalog.version||'4')}</span>`;
  $('properties').innerHTML=table(['Select','Property','Type','Nullable','Key'],set.fields.map(field=>[
    `<input type="checkbox" data-property="${esc(field.path||field.name)}" aria-label="Select ${esc(field.path||field.name)}" ${field.key?'checked disabled':'checked'}>`,
    `<code>${esc(field.path||field.name)}</code>`,esc(field.type)+(field.collection?' []':''),field.nullable?'Yes':'No',field.key?'Key':'']));
  $('order-field').innerHTML='<option value="">Entity keys</option>'+set.fields.filter(value=>!value.collection).map(field=>`<option value="${esc(field.path||field.name)}">${esc(field.path||field.name)}</option>`).join('');
  $('filters').innerHTML='';
}
function drawConnection(){const saved=$('entity-set').value,sets=connection()?.catalog.entitySets||[];$('entity-set').innerHTML=sets.map(value=>`<option value="${esc(value.name)}">${esc(value.name)}</option>`).join('');if(sets.some(value=>value.name===saved))$('entity-set').value=saved;drawSchema();}
function drawEdition(){const record=state?.editions.find(value=>value.id===selectedEdition);if(!record)return;$('edition-heading').textContent=record.label;
  $('edition-detail').innerHTML=`<div class="metric-row"><div class="metric"><b>${record.rowCount}</b><span>RETAINED ROWS</span></div><div class="metric"><b>${record.pageCount}</b><span>ORIGINAL PAGES</span></div><div class="metric"><b>${esc(record.sourceCount??'—')}</b><span>SERVICE COUNT</span></div></div><p>${badge(record.status)} <code>${esc(record.id)}</code></p>${record.error?`<p>${esc(record.error.message)}</p>`:''}<details><summary>Original query and continuation</summary><pre>${esc(record.queryUrl)}${record.nextLink?'\n\nNext: '+esc(record.nextLink):''}</pre></details>`;
  $('review-edition').value=record.id;
  const identity=record.id+':'+record.pageCount;
  if(pageIdentity!==identity){pageIdentity=identity;void drawPages(record.id,identity).catch(error=>{pageIdentity=null;notify(error.message,true);});}
}
async function drawPages(id,identity){
  const record=await api('/api/edition?id='+encodeURIComponent(id));if(pageIdentity!==identity)return;
  $('pages').innerHTML='<h4>Original response pages</h4>'+table(['Page','Rows','Response','Received','Original bytes'],record.pages.map(page=>[
    String(page.number),String(page.rowCount),String(page.status),esc(time(page.source.receivedAt)),
    `<a href="/api/source?hash=${esc(page.source.sha256)}" title="${esc(page.source.requestedUrl)}">Download page ${page.number}</a>`]));
}
function drawRows(){if(!loadedRows.length){$('rows').innerHTML='<div class="empty">This edition has no retained rows.</div>';$('row-pager').innerHTML='';return;}
  const paths=state.editions.find(value=>value.id===selectedEdition)?.fields.map(value=>value.path||value.name)||Object.keys(loadedRows[0]);
  const value=(row,path)=>{let cell=row;for(const part of path.split('/')){if(cell===null)return '<span class="muted">null</span>';if(typeof cell!=='object'||!Object.hasOwn(cell,part))return '<span class="muted">missing</span>';cell=cell[part];}
    return cell===null?'<span class="muted">null</span>':esc(typeof cell==='object'?JSON.stringify(cell):cell);};
  const start=rowPage*50;$('rows').innerHTML=table(paths,loadedRows.slice(start,start+50).map(row=>paths.map(path=>value(row,path))));
  $('row-pager').innerHTML=`<button class="small" data-page="-1" ${rowPage===0?'disabled':''}>Previous</button><span>${start+1}–${Math.min(start+50,loadedRows.length)} of ${loadedRows.length}</span><button class="small" data-page="1" ${start+50>=loadedRows.length?'disabled':''}>Next</button>`;
}
async function refresh(){
  const oldConnection=$('connection').value;state=await api('/api/state');
  $('stats').innerHTML=`<dt>Connections</dt><dd>${state.connections.length}</dd><dt>Saved queries</dt><dd>${state.plans.length}</dd><dt>Complete editions</dt><dd>${state.editions.filter(value=>value.status==='COMPLETE').length}</dd><dt>Exports</dt><dd>${state.exports.length}</dd>`;
  options('connection',state.connections);if(!oldConnection||oldConnection!==$('connection').value||!$('entity-set').options.length)drawConnection();
  options('review-plan',state.plans);options('capture-plan',state.plans.filter(value=>value.reviewedAt));
  $('plans').innerHTML=table(['Query','Entity set','Review','Original query'],state.plans.map(value=>[esc(value.name),esc(typeof value.query.entitySet==='string'?value.query.entitySet:value.query.entitySet.name),value.reviewedAt?esc(time(value.reviewedAt)):'Awaiting scope review',`<code>${esc(value.query.url)}</code>`]));
  $('query-url').textContent=state.plans.find(value=>value.id===$('review-plan').value)?.query.url||'';
  const complete=state.editions.filter(value=>value.status==='COMPLETE');options('review-edition',complete);options('compare-before',complete);options('compare-after',complete);
  options('export-edition',complete.filter(value=>value.decisions.at(-1)?.decision==='accept'));
  $('edition-list').innerHTML=table(['Edition','Entity set','State','Rows / pages','Created','Actions'],state.editions.map(value=>[
    esc(value.label),esc(value.entitySet),badge(value.status),`${value.rowCount} / ${value.pageCount}`,esc(time(value.createdAt)),
    `<div class="row-actions"><button class="small" data-edition="${esc(value.id)}">Open</button>${value.status!=='COMPLETE'?`<button class="small" data-resume="${esc(value.id)}">Resume</button><button class="small" data-pause="${esc(value.id)}">Pause</button>`:''}</div>`]));
  if(!selectedEdition&&state.editions.length)selectedEdition=state.editions.at(-1).id;drawEdition();
  $('exports').innerHTML=table(['Dataset','Rows','Merchant','Files'],state.exports.map(value=>[esc(value.dataset.name),String(value.dataset.rowCount),value.merchant?'Configured':'Dataset',
    value.files.map(file=>`<a href="/api/export?id=${esc(value.id)}&file=${esc(file)}">${esc(file)}</a>`).join(' · ')]));
  options('query-export',state.exports,value=>value.dataset.name+' · '+value.id.slice(0,8));options('merchant-export',state.exports.filter(value=>value.merchant),value=>value.dataset.name+' · '+value.id.slice(0,8));
  options('live-plan',state.plans.filter(value=>value.reviewedAt));drawLiveScope();
  if(state.liveProducts?.length||!$('live').hidden)await refreshLive();
}
document.querySelectorAll('nav button').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.section').forEach(section=>section.hidden=section.id!==button.dataset.section);document.querySelectorAll('nav button').forEach(item=>item.classList.toggle('selected',item===button));if(button.dataset.section==='live')refreshLive().catch(error=>notify(error.message,true));}));
$('refresh').onclick=()=>action('Refresh',refresh);$('connection').onchange=drawConnection;$('entity-set').onchange=drawSchema;
$('connect-form').onsubmit=event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.target));if(!data.authEnv)delete data.authEnv;action('Service discovery',()=>api('/api/connect',data),event.submitter);};
$('refresh-schema').onclick=()=>action('Schema refresh',async()=>{await api('/api/refresh',{id:$('connection').value});await refresh();drawConnection();});
$('add-filter').onclick=()=>{const node=document.createElement('div');node.className='filter-row';node.innerHTML=`<select aria-label="Filter property" class="field">${fields().filter(value=>!value.collection).map(field=>`<option value="${esc(field.path||field.name)}">${esc(field.path||field.name)}</option>`).join('')}</select><select aria-label="Filter operation" class="op">${['eq','ne','gt','ge','lt','le','contains','startswith','endswith'].map(op=>`<option>${op}</option>`).join('')}</select><input class="value" aria-label="Filter value" placeholder="Value, or null"><button type="button" class="small">Remove</button>`;node.querySelector('button').onclick=()=>node.remove();$('filters').append(node);};
$('plan-form').onsubmit=event=>{event.preventDefault();action('Save query',async()=>{
  const form=Object.fromEntries(new FormData(event.target)),filters=[...$('filters').children].map(node=>{const path=node.querySelector('.field').value,raw=node.querySelector('.value').value,type=fields().find(field=>(field.path||field.name)===path)?.type;
    let value=raw;if(raw==='null')value=null;else if(type==='Edm.Boolean'){if(!['true','false'].includes(raw))throw new Error('Boolean filters require true or false.');value=raw==='true';}
    else if(['Edm.Byte','Edm.SByte','Edm.Int16','Edm.Int32','Edm.Single','Edm.Double'].includes(type)){value=Number(raw);if(!raw||!Number.isFinite(value))throw new Error('Use a numeric filter value.');}
    return {field:path,op:node.querySelector('.op').value,value};});
  const query={entitySet:$('entity-set').value,select:[...$('properties').querySelectorAll('input:checked')].map(node=>node.dataset.property),filters,filterMode:form.filterMode,
    orderBy:form.orderBy?[{field:form.orderBy,direction:form.direction}]:[],pageSize:Number(form.pageSize),count:true};if(form.top)query.top=Number(form.top);
  const saved=await api('/api/plan',{connectionId:$('connection').value,name:form.name,query});await refresh();$('review-plan').value=saved.id;$('query-url').textContent=saved.query.url;
},event.submitter);};
$('review-plan').onchange=()=>{$('query-url').textContent=state.plans.find(value=>value.id===$('review-plan').value)?.query.url||'';};
$('plan-review-form').onsubmit=event=>{event.preventDefault();action('Query review',()=>api('/api/review-plan',Object.fromEntries(new FormData(event.target))),event.submitter);};
$('capture-form').onsubmit=event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.target));data.pageBudget=Number(data.pageBudget);action('Start import',async()=>{const record=await api('/api/capture',data);selectedEdition=record.id;loadedRows=[];},event.submitter);};
$('edition-list').onclick=event=>{const node=event.target;if(node.dataset.edition){selectedEdition=node.dataset.edition;loadedRows=[];drawEdition();$('rows').innerHTML='';$('row-pager').innerHTML='';}
  if(node.dataset.resume)action('Resume import',()=>api('/api/resume',{id:node.dataset.resume,pageBudget:10000}),node);if(node.dataset.pause)action('Pause import',()=>api('/api/pause',{id:node.dataset.pause}),node);};
$('load-rows').onclick=()=>action('Load records',async()=>{if(!selectedEdition)throw new Error('Select an edition.');loadedRows=(await api('/api/rows?id='+encodeURIComponent(selectedEdition))).rows;rowPage=0;drawRows();});
$('row-pager').onclick=event=>{if(event.target.dataset.page){rowPage+=Number(event.target.dataset.page);drawRows();}};
$('edition-review-form').onsubmit=event=>{event.preventDefault();action('Receiving review',()=>api('/api/review',Object.fromEntries(new FormData(event.target))),event.submitter);};
$('compare-form').onsubmit=event=>{event.preventDefault();action('Edition comparison',async()=>{const form=new FormData(event.target),result=await api('/api/compare?before='+encodeURIComponent(form.get('before'))+'&after='+encodeURIComponent(form.get('after')));
  $('comparison').innerHTML=`<div class="metric-row">${[['Added',result.added.length],['Removed',result.removed.length],['Changed',result.changed.length]].map(([name,total])=>`<div class="metric"><b>${total}</b><span>${name.toUpperCase()}</span></div>`).join('')}</div><p>${esc(result.note)}</p>`+
    table(['Change','Entity key','Property','Before','After'],[...result.changed.flatMap(row=>row.fields.map(field=>['Changed',`<code>${esc(row.key)}</code>`,esc(field.path),esc(JSON.stringify(field.before)),esc(JSON.stringify(field.after))])),...result.added.map(row=>['Added',esc(row.key),'','',esc(JSON.stringify(row.row))]),...result.removed.map(row=>['Removed',esc(row.key),'',esc(JSON.stringify(row.row)),''])]);},event.submitter);};
$('merchant-enabled').onchange=()=>$('payment-fields').hidden=!$('merchant-enabled').checked;
$('export-form').onsubmit=event=>{event.preventDefault();action('Create dataset export',async()=>{const data=Object.fromEntries(new FormData(event.target)),input={id:data.id,name:data.name};if(data.fields.trim())input.fields=data.fields.split(',').map(value=>value.trim());
  if($('merchant-enabled').checked){input.origin=data.origin;input.path=data.path;input.payment={scheme:'exact',network:data.network,asset:data.asset,amount:data.amount,payTo:data.payTo,maxTimeoutSeconds:300};}
  return api('/api/export',input);},event.submitter);};
$('query-export-form').onsubmit=event=>{event.preventDefault();action('Dataset preview',async()=>{const result=await api('/api/query',Object.fromEntries(new FormData(event.target)));const body=result.body;
  $('dataset-response').innerHTML=`<p>Response ${esc(result.status)}</p>`+(body?.rows?.length?table(Object.keys(body.rows[0]),body.rows.map(row=>Object.values(row).map(value=>esc(typeof value==='object'?JSON.stringify(value):value)))):`<pre>${esc(JSON.stringify(body,null,2))}</pre>`);},event.submitter);};
$('restore-file').onchange=event=>{const file=event.target.files[0];if(file)action('Restore workspace',async()=>api('/api/restore',JSON.parse(await file.text())));event.target.value='';};
async function refreshMerchant(){merchant=await api('/api/merchant');const generation=merchant.state?.generation??merchant.generation??0;$('generation').value=generation;
  const releases=merchant.releases||[],runtime=merchant.runtime||{};
  $('merchant-status').innerHTML=`<h3>Release store</h3><div class="metadata"><span>Generation ${generation}</span><span>Active: ${esc(merchant.state?.active||'None')}</span><span>Runtime: ${esc(runtime.state||'STOPPED')}</span></div>`+
    (runtime.message?`<p>${esc(runtime.message)}</p>`:'')+table(['Release','Label','Selected','Created'],releases.map(release=>[
      `<code>${esc(release.id)}</code>`,esc(release.label||release.name||release.id),release.id===merchant.state?.active?'Active':'Staged',esc(time(release.createdAt))]))+
    `<details><summary>Release and runtime detail</summary><pre>${esc(JSON.stringify(merchant,null,2))}</pre></details>`;
  $('run-command').textContent='node stellar/scf-starforge-20261009/sf30-seller-sdk/odata/cli.mjs --workspace "YOUR_WORKSPACE" merchant run --expect '+generation;}
$('merchant-refresh').onclick=()=>action('Release status',refreshMerchant);
$('merchant-prepare').onsubmit=event=>{event.preventDefault();action('Stage merchant release',async()=>{const data=Object.fromEntries(new FormData(event.target)),runtime={port:Number(data.port)};if(data.facilitator)runtime.facilitator=data.facilitator;
  const result=await api('/api/merchant/prepare',{exportId:data.exportId,releaseId:data.releaseId,runtime});await refreshMerchant();return result;},event.submitter);};
$('merchant-select').onsubmit=event=>{event.preventDefault();action('Activate release',async()=>{const data=Object.fromEntries(new FormData(event.target));data.expectedGeneration=Number(data.expectedGeneration);await api('/api/merchant/activate',data);await refreshMerchant();},event.submitter);};
$('merchant-rollback').onclick=()=>action('Roll back release',async()=>{const data=Object.fromEntries(new FormData($('merchant-select')));await api('/api/merchant/rollback',{expectedGeneration:Number(data.expectedGeneration),reason:data.reason});await refreshMerchant();});
function drawLiveScope(){const saved=state.plans.find(value=>value.id===$('live-plan').value),query=saved?.query.plan;
  if(!query){$('live-scope').textContent='Review a source query in Sources & queries to prepare a service.';return;}
  if(livePlanIdentity!==saved.id){livePlanIdentity=saved.id;$('live-total').value=query.top??100000;$('live-total').max=query.top??1000000000;}
  $('live-scope').textContent=query.entitySet+' · '+query.select.join(', ')+' · '+(query.filters.length?query.filters.map(filter=>filter.field+' '+filter.op+' '+JSON.stringify(filter.value)).join(' '+query.filterMode+' '):'All matching records')+' · '+(query.top?'Reviewed limit '+query.top:'Complete source query');}
function liveLink(id,kind,recordId,name){return '<a href="/api/live/file?'+esc(new URLSearchParams({id,kind,...(recordId?{recordId}:{}),name}).toString())+'">'+esc(name)+'</a>';}
function drawLiveDetail(){const detail=liveDetail;if(!detail)return;const runtime=detail.runtime,operation=detail.plan.operations.find(value=>value.id===detail.operation);
  const metric=runtime?.snapshot||{},counts=Object.entries(metric).filter(([,value])=>typeof value==='number');
  $('live-detail').innerHTML='<div class="subheading"><h3>'+esc(detail.name)+'</h3>'+badge(runtime?runtime.state:'PREPARED')+'</div><div class="metadata"><span>'+esc(detail.plan.serviceRoot)+'</span><span>'+esc(operation.entitySet)+'</span></div>'+
    '<p><code>'+esc(detail.plan.publicOrigin+operation.path)+'</code> · '+esc(operation.amountAtomic)+' asset units per page</p>'+
    '<p>Fields: '+esc(operation.fields.join(', '))+'. Source conditions: '+esc((operation.sourceFilters||[]).map(filter=>filter.field+' '+filter.op+' '+JSON.stringify(filter.value)).join(' '+(operation.sourceFilterMode||'and')+' ')||'All matching records')+'.</p>'+
    (runtime?'<p>'+esc(runtime.mode)+' · <a target="_blank" rel="noopener" href="'+esc(runtime.operationsUrl)+'">Open seller operations</a></p><div class="metric-row">'+counts.map(([label,value])=>'<div class="metric"><b>'+esc(value)+'</b><span>'+esc(label)+'</span></div>').join('')+'</div>':'<p>Start the service to open its local seller and operations view.</p>')+
    '<div class="toolbar"><button data-live-start="'+esc(detail.id)+'" '+(runtime?'disabled':'')+'>Start service</button><button data-live-stop="'+esc(detail.id)+'" '+(runtime?'':'disabled')+'>Stop service</button></div><h4 class="subheading">Prepared service files</h4><div class="toolbar">'+detail.files.filter(name=>name.startsWith('package/')).map(name=>liveLink(detail.id,'package',null,name.slice(8))).join(' · ')+'</div>';
  $('live-buyer-product').value=detail.id;$('live-receive-product').value=detail.id;
  const prior=$('live-next-page').value;$('live-next-page').innerHTML='<option value="">First page of the reviewed query</option>'+detail.received.filter(row=>row.nextRequest).map(row=>'<option value="'+esc(row.id)+'">Continue after '+esc(row.seenRows)+' rows · '+esc(row.id.slice(0,8))+'</option>').join('');
  if([...$('live-next-page').options].some(option=>option.value===prior))$('live-next-page').value=prior;
  $('live-customer-files').innerHTML='<h3>Customer handoffs</h3>'+table(['Intent','Prepared request','Original buyer files'],detail.buyers.map(row=>[esc(row.intentId),'<code>'+esc(row.requestSha256.slice(0,16))+'</code>',
    ['request.json','offers.json','buyer.json','handoff.json'].map(name=>liveLink(detail.id,'buyer',row.id,name)).join(' · ')]))+
    (detail.buyers.length?'<p class="muted">The handoff.json file retains each original buyer operation directory and request identity. Continue an existing purchase through its original SF88 buyer state.</p>':'')+
    '<h3 class="subheading">Received pages</h3>'+table(['Rows','Cumulative rows','Completion','Original and typed files'],detail.received.map(row=>[esc(row.rows),esc(row.seenRows),esc(typeof row.completion==='string'?row.completion:JSON.stringify(row.completion)),
      ['original-response.json','rows.jsonl','receiving.json',...(row.nextRequest?['next-request.json']:[])].map(name=>liveLink(detail.id,'receiving',row.id,name)).join(' · ')]));}
async function refreshLive(){const result=await api('/api/live');liveProducts=result.products;options('live-buyer-product',liveProducts);options('live-receive-product',liveProducts);
  $('live-products').innerHTML=table(['Service','Source query','State','Created','Actions'],liveProducts.map(row=>[esc(row.name),esc(state.plans.find(plan=>plan.id===row.planId)?.name||row.planId),badge(row.runtime?'RUNNING':'PREPARED'),esc(time(row.createdAt)),
    '<button class="small" data-live-open="'+esc(row.id)+'">Open</button>']));
  if(!liveProducts.some(row=>row.id===selectedLive))selectedLive=liveProducts.at(-1)?.id||null;
  if(selectedLive){liveDetail=await api('/api/live/detail?id='+encodeURIComponent(selectedLive));drawLiveDetail();}}
$('live-plan').onchange=drawLiveScope;$('live-refresh').onclick=()=>action('Live service status',refreshLive);
$('live-prepare').onsubmit=event=>{event.preventDefault();action('Prepare live service',async()=>{const data=Object.fromEntries(new FormData(event.target)),input={id:data.id,name:data.name,planId:data.planId,origin:data.origin,amount:data.amount,
    payment:{network:data.network,asset:data.asset,payTo:data.payTo,maxTimeoutSeconds:Number(data.maxTimeoutSeconds)},maxPageRows:Number(data.maxPageRows),maxTotalRows:Number(data.maxTotalRows),port:Number(data.port),operationsPort:Number(data.operationsPort)};
    if(data.path)input.path=data.path;if(data.facilitator)input.facilitator=data.facilitator;const result=await api('/api/live/prepare',input);selectedLive=result.id;return result;},event.submitter);};
$('live-products').onclick=event=>{if(event.target.dataset.liveOpen)action('Open live service',async()=>{selectedLive=event.target.dataset.liveOpen;await refreshLive();},event.target);};
$('live-detail').onclick=event=>{const node=event.target;if(node.dataset.liveStart)action('Start live service',()=>api('/api/live/start',{id:node.dataset.liveStart}),node);if(node.dataset.liveStop)action('Stop live service',()=>api('/api/live/stop',{id:node.dataset.liveStop}),node);};
for(const id of ['live-buyer-product','live-receive-product'])$(id).onchange=()=>action('Open service customer work',async()=>{selectedLive=$(id).value;await refreshLive();});
$('live-buyer').onsubmit=event=>{event.preventDefault();action('Prepare customer handoff',async()=>{const data=Object.fromEntries(new FormData(event.target));if(!data.receivedId)delete data.receivedId;selectedLive=data.id;return api('/api/live/buyer',data);},event.submitter);};
$('live-receive').onsubmit=event=>{event.preventDefault();action('Receive original response',async()=>{const data=new FormData(event.target),file=data.get('response');if(file.size>16*1024*1024)throw new Error('Select an original response up to 16 MiB.');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let start=0;start<bytes.length;start+=32768)binary+=String.fromCharCode(...bytes.subarray(start,start+32768));
    selectedLive=data.get('id');return api('/api/live/receive',{id:selectedLive,bodyBase64:btoa(binary)});},event.submitter);};

await refresh().then(()=>notify('Workspace ready.')).catch(error=>notify(error.message,true));
setInterval(()=>{if(state?.running.length)refresh().catch(error=>notify(error.message,true));else if(!$('live').hidden&&liveProducts.some(row=>row.runtime))refreshLive().catch(error=>notify(error.message,true));},2000);
