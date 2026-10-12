// MIT. Industrial Stellar wallet and daily activity operator.
const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)];
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const value=id=>$('#'+id).value.trim(),checked=id=>$('#'+id).checked;
const jsonInput=(id,fallback={})=>{const input=value(id);return input?JSON.parse(input):fallback;};
const selectedValues=id=>[...$('#'+id).selectedOptions].map(item=>item.value);
const stamp=()=>new Date().toISOString();
const uuid=()=>crypto.randomUUID();
const encode=value=>{const bytes=new TextEncoder().encode(JSON.stringify(value));let binary='';for(const b of bytes)binary+=String.fromCharCode(b);return btoa(binary);};
let state=null,bootstrap=null,catalog=[],templates={},page='overview',refreshing=null,selectedEdition=null,registryEditor=null,policyEditor=null,collectionEditor=null;
let detailReader=null,detailOffset=0,previewURL=null,activeRequests=0;
const views=new Map(),executing=new Set(),selectionCache={registries:{},policies:{},sources:{}};
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const originalIntent=args=>{const copy={...args};delete copy.expectedRevision;return canonical(copy);};
const initialURL=new URL(location.href),fragment=new URLSearchParams(initialURL.hash.slice(1));
if(fragment.has('token')){sessionStorage.setItem('stellar-ratings-token',fragment.get('token'));initialURL.hash='';history.replaceState(history.state,'',initialURL);}
const token=sessionStorage.getItem('stellar-ratings-token')??'';
function notice(message,error=false){const box=$('#notice');box.textContent=message;box.className=message?'visible'+(error?' error':''):'';}
function failure(error){notice((error.code?error.code+': ':'')+(error.message??String(error)),true);}
async function api(path,options={}){
 const response=await fetch(path,{...options,cache:'no-store',redirect:'error',headers:{Authorization:'Bearer '+token,...options.headers}});
 let result;try{result=await response.json();}catch{throw Object.assign(new Error('The operator response was interrupted. The original request remains saved.'),{code:'RESPONSE_INTERRUPTED',status:response.status});}
 if(!response.ok)throw Object.assign(new Error(result.error?.message??'Operator request failed.'),result.error??{code:'HTTP_'+response.status},{httpStatus:response.status});
 return result;
}
const read=(method,args={})=>api('/api/invoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})});
function identity(){if(!state)throw new Error('Open the original workspace first.');return {workspaceId:state.workspaceId,directory:bootstrap.operator.workspaceDirectory};}
function journalKey(requestId){const current=identity();return current.workspaceId+'|'+current.directory+'|'+requestId;}
let dbPromise=null;
function database(){
 return dbPromise??=new Promise((done,reject)=>{
  const request=indexedDB.open('stellar-forge.stellar-ratings.requests.v1',3);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('requests'))db.createObjectStore('requests',{keyPath:'key'});if(!db.objectStoreNames.contains('viewState'))db.createObjectStore('viewState',{keyPath:'key'});};
  request.onsuccess=()=>done(request.result);request.onerror=()=>reject(request.error);
 });
}
async function journalUpdate(key,change){
 const db=await database();return new Promise((done,reject)=>{
  const tx=db.transaction('requests','readwrite'),store=tx.objectStore('requests'),request=store.get(key);let result;
  request.onsuccess=()=>{try{result=change(request.result??null);if(result===null)store.delete(key);else if(result!==undefined)store.put(result);}catch(error){tx.abort();reject(error);}};
  tx.oncomplete=()=>done(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('The original browser request could not be retained.'));
 });
}
async function deliverySelection(value){
 const db=await database(),current=identity(),key=current.workspaceId+'|'+current.directory+'|delivery';
 return new Promise((done,reject)=>{
  const tx=db.transaction('viewState',value===undefined?'readonly':'readwrite'),table=tx.objectStore('viewState'),request=table.get(key);let result;
  request.onsuccess=()=>{result=request.result??null;if(value!==undefined){result={...result,key,...current,...value,updatedAt:stamp()};table.put(result);}};
  tx.oncomplete=()=>done(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('The receiving selection could not be retained.'));
 });
}
async function restoreDeliverySelection(){
 const selected=await deliverySelection();if(!selected)return;
 if(selected.sourceDirectory)$('#receive-source').value=selected.sourceDirectory;
 if(selected.manifestSha256)$('#receive-hash').value=selected.manifestSha256;
 if(selected.destination)$('#receive-destination').value=selected.destination;
 if(selected.receivedResult)$('#receiving-result').innerHTML='<h3>Independent installation received</h3><pre>'+esc(JSON.stringify(selected.receivedResult,null,2))+'</pre>';
 else if(selected.sourceDirectory)$('#receiving-result').innerHTML='<p>Original archive restored for receiving.</p>';
}

async function journalRows(){
 const db=await database(),all=await new Promise((done,reject)=>{const request=db.transaction('requests','readonly').objectStore('requests').getAll();request.onsuccess=()=>done(request.result);request.onerror=()=>reject(request.error);});
 const selected=identity();return all.filter(row=>row.workspaceId===selected.workspaceId&&row.directory===selected.directory).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
}
async function renderRequests(){
 if(!state)return;const rows=await journalRows();$('#pending-count').textContent=rows.length;
 $('#requests-list').innerHTML=rows.length?rows.map(row=>'<article class="request-card"><h3>'+esc(row.label)+' <span class="status">'+esc(row.status)+'</span></h3><p><code>'+esc(row.requestId)+'</code> · '+esc(row.createdAt)+'</p>'+(row.file?'<p>Original file: '+esc(row.file.name)+' · '+row.file.size.toLocaleString()+' bytes</p>':'')+(row.error?'<p>'+esc(row.error.code)+' · '+esc(row.error.message)+'</p>':'')+'<div class="toolbar"><button data-action="request-recover" data-id="'+esc(row.requestId)+'">Recover original request</button><button data-action="request-view" data-id="'+esc(row.requestId)+'">View saved selection</button></div></article>').join(''):'<div class="empty">All original requests have been received and refreshed.</div>';
}
function mutationArguments(args){return {...args,requestId:args.requestId??uuid(),expectedRevision:args.expectedRevision??state.revision};}
async function saveRequest({method,args={},label=method,kind='invoke',file=null,route=null}){
 const selected=mutationArguments(args),current=identity(),key=journalKey(selected.requestId);
 const body=kind==='invoke'?JSON.stringify({method,args:selected}):null,metadata=kind==='source'?encode(selected):null;
 const row={key,...current,requestId:selected.requestId,method,args:selected,label,kind,file,route,body,metadata,status:'PENDING',createdAt:stamp(),updatedAt:stamp(),attempts:[],result:null,error:null,journalToken:null};
 await journalUpdate(key,previous=>{
  if(previous){if(previous.method!==method||previous.kind!==kind||originalIntent(previous.args)!==originalIntent(selected))throw new Error('The original request identifier already names another operation.');return previous;}
  return row;
 });await renderRequests();return key;
}
async function finishRequest(key,attemptToken,result){
 const saved=await journalUpdate(key,row=>row?.journalToken===attemptToken?{...row,result,status:['PAUSED','FAILED','WAITING_FOR_BOUNDARY'].includes(result.status)&&result.originalArguments?'WAITING':'COMPLETE',error:result.error??null,updatedAt:stamp()}:row);
 await refresh();
 if(saved?.journalToken===attemptToken)await applyResult(result,saved.method);
 await journalUpdate(key,row=>row?.journalToken===attemptToken&&row.status==='COMPLETE'?null:row);
 await renderRequests();return result;
}

async function executeRequest(key){
 if(executing.has(key))return null;executing.add(key);activeRequests++;document.body.classList.add('busy');
 const attemptToken=uuid();let row;
 try{
  row=await journalUpdate(key,previous=>{if(!previous)throw new Error('The saved original request is unavailable.');return {...previous,journalToken:attemptToken,updatedAt:stamp()};});
  if(row.status==='COMPLETE')return await finishRequest(key,attemptToken,row.result);
  await journalUpdate(key,previous=>previous?.journalToken===attemptToken?{...previous,status:'PENDING',error:null,attempts:[...previous.attempts,{at:stamp(),body:previous.body,metadata:previous.metadata}]}:previous);
  let result;
  for(;;){
   try{
    const headers={'X-Ratings-Workspace-ID':row.workspaceId};
    if(row.kind==='invoke'){headers['Content-Type']='application/json';result=await api('/api/invoke',{method:'POST',headers,body:row.body});}
    else if(row.kind==='source'){headers['X-Ratings-Source']=row.metadata;result=await api('/api/sources/import',{method:'POST',headers,body:row.file});}
    else if(row.kind==='archive'){
     if(row.args.expectedManifestSha256)headers['X-Ratings-Manifest-SHA256']=row.args.expectedManifestSha256;
     result=await api(row.route,{method:'POST',headers,body:row.file});
    }
    break;
   }catch(error){
    if(error.code!=='REVISION_CONFLICT')throw error;
    await refresh();row=await journalUpdate(key,previous=>{
     if(previous?.journalToken!==attemptToken)throw new Error('A following browser attempt owns this original request.');
     const args={...previous.args,expectedRevision:state.revision};
     return {...previous,args,body:previous.kind==='invoke'?JSON.stringify({method:previous.method,args}):null,metadata:previous.kind==='source'?encode(args):null,
      attempts:[...previous.attempts,{at:stamp(),code:error.code,previousRevision:previous.args.expectedRevision}],updatedAt:stamp()};
    });
   }
  }
  const completed=await finishRequest(key,attemptToken,result);notice(row.label+' · '+(result.status??'Saved'));return completed;
 }catch(error){
  if(row)await journalUpdate(key,previous=>previous?.journalToken===attemptToken?{...previous,status:error.httpStatus?'ERROR':'UNCERTAIN',error:{code:error.code??'CONNECTION_INTERRUPTED',message:error.message},updatedAt:stamp()}:previous);
  await renderRequests();throw error;
 }finally{executing.delete(key);activeRequests--;if(!activeRequests)document.body.classList.remove('busy');}
}
async function mutate(method,args={},label=method){return executeRequest(await saveRequest({method,args,label}));}
async function recoverRequests(){
 for(const row of await journalRows()){
  if(row.status==='WAITING')continue;
  try{await executeRequest(row.key);}catch(error){failure(error);}
 }
}
async function applyResult(result,method){
 if(result?.registryId&&method==='registry.save')$('#active-registry').value=result.registryId;
 if(result?.policyId&&method==='policy.save')$('#active-policy').value=result.policyId;
 if(result?.editionId){$('#report-edition').value=result.editionId;$('#compare-right').value=result.editionId;}
 if(result?.reportId)$('#report-export-id').value=result.reportId;
 if(method==='package.unpack'){
  await deliverySelection({sourceDirectory:result.sourceDirectory,manifestSha256:result.manifestSha256,receivedResult:null});
  $('#receive-source').value=result.sourceDirectory;$('#receive-hash').value=result.manifestSha256;
  $('#receiving-result').innerHTML='<div class="source-issue">Original archive opened. '+esc(result.manifest?.files?.length??'')+' retained members are ready for receiving.</div>';
 }
 if(method==='package.receive'){await deliverySelection({sourceDirectory:value('receive-source'),manifestSha256:value('receive-hash'),destination:value('receive-destination'),receivedResult:result});$('#receiving-result').innerHTML='<h3>Independent installation received</h3><pre>'+esc(JSON.stringify(result,null,2))+'</pre>';}
}
function setOptions(element,rows,{empty='Select…',valueOf=row=>row.id,labelOf=row=>row.name??row.id}={}){
 const old=element.multiple?new Set([...element.selectedOptions].map(option=>option.value)):element.value;
 element.innerHTML=(!element.multiple?'<option value="">'+esc(empty)+'</option>':'')+rows.map(row=>'<option value="'+esc(valueOf(row))+'">'+esc(labelOf(row))+'</option>').join('');
 if(element.multiple)for(const option of element.options)option.selected=old.has(option.value);
 else if([...element.options].some(option=>option.value===old))element.value=old;
 else if(rows.length===1)element.value=valueOf(rows[0]);
}
function registrySelection(required=true){
 const id=$('#active-registry').value,row=state.registries[id]??selectionCache.registries[id];if(required&&!row)throw new Error('Select or save an asset registry.');
 return row?{registryId:id,registryVersion:row.currentVersion}:{};
}
function policySelection(required=true){
 const id=$('#active-policy').value,row=state.policies[id]??selectionCache.policies[id];if(required&&!row)throw new Error('Select or save a wallet policy.');
 return row?{policyId:id,policyVersion:row.currentVersion}:{};
}
function registryNetwork(){return (state.registries[$('#active-registry').value]??selectionCache.registries[$('#active-registry').value])?.network??null;}
function activePageFromURL(){return new URL(location.href).searchParams.get('page')??history.state?.page??'overview';}
function navigate(next,{object=null,replace=false}={}){
 if(!$$('nav [data-page]').some(button=>button.dataset.page===next))next='overview';page=next;
 const url=new URL(location.href);url.searchParams.set('page',page);url.hash='';
 for(const key of ['object','id'])url.searchParams.delete(key);
 if(object){url.searchParams.set('object',object.type);url.searchParams.set('id',object.id);}
 const data={page,object,registryId:$('#active-registry').value,policyId:$('#active-policy').value};
 history[replace?'replaceState':'pushState'](data,'',url);showPage(page);void refreshTables().catch(failure);
}
function showPage(next){
 page=next;for(const node of $$('[data-panel]'))node.hidden=node.dataset.panel!==next;
 for(const button of $$('nav [data-page]')){if(button.dataset.page===next)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
}
async function refresh(){
 if(refreshing)return refreshing;
 refreshing=(async()=>{
  const updated=await api('/api/state');if(state&&updated.workspaceId!==state.workspaceId)throw new Error('This operator opened another workspace. Open its original private link.');
  state=updated;renderState();await refreshTables();await renderRequests();
 })();try{return await refreshing;}finally{refreshing=null;}
}
function renderState(){
 $('#workspace-name').textContent=state.profile.name??'Stellar ratings';$('#workspace-revision').textContent='Revision '+state.revision;
 $('#workspace-path').textContent=bootstrap.operator.workspaceDirectory;
 setOptions($('#active-registry'),Object.values({...selectionCache.registries,...state.registries}),{labelOf:row=>row.name+' · v'+row.currentVersion});
 setOptions($('#active-policy'),Object.values({...selectionCache.policies,...state.policies}),{labelOf:row=>row.name+' · v'+row.currentVersion});
 $('#active-network').textContent=registryNetwork()??'Select a registry';
 setOptions($('#run-collection'),Object.values(state.collections),{labelOf:row=>row.name+' · v'+row.currentVersion});
 const sources=Object.values({...selectionCache.sources,...state.sources}).filter(row=>!row.network||!registryNetwork()||row.network===registryNetwork());
 for(const select of $$('.source-picker'))setOptions(select,sources,{labelOf:row=>row.provider+' / '+row.kind+' · '+row.label+' · '+row.id});
 $('#overview-counts').innerHTML=[['registries','Registries'],['runs','Review runs'],['collections','Daily collections'],['editions','Result editions'],['sources','Original sources'],['reports','Reports']].map(([key,label])=>'<div class="metric"><strong>'+state.counts[key].toLocaleString()+'</strong><span>'+label+'</span></div>').join('');
 $('#connections-overview').innerHTML=dataTable(state.connections.map(row=>({alias:row.alias,provider:row.provider,network:row.network??'Global',origin:row.origin})));
}
async function refreshTables(){
 const groups=new Map();
 for(const node of $$('[data-panel="'+page+'"] [data-table]')){
  const key=node.dataset.table+':'+(node.dataset.kind??'');if(!groups.has(key))groups.set(key,{table:node.dataset.table,kind:node.dataset.kind,nodes:[]});groups.get(key).nodes.push(node);
 }
 await Promise.all([...groups].map(async([key,group])=>{
  const old=views.get(key),result=await read('workspace.list',{table:group.table,...(group.kind?{kind:group.kind}:{}),offset:old?.offset??0,limit:50});
  views.set(key,result);for(const node of group.nodes)node.innerHTML=workTable(group.table,result,key);
 }));
}
function textCell(value){if(value===null||value===undefined)return '—';if(typeof value==='object')return esc(JSON.stringify(value));return esc(value);}
function dataTable(rows,{fields=null,recordSourceId=null}={}){
 if(!rows?.length)return '<div class="empty">No rows in this original selection.</div>';
 const keys=fields??[...new Set(rows.flatMap(row=>Object.keys(row)))].filter(key=>!['original','projection'].includes(key));
 return '<div class="table-scroll"><table><thead><tr>'+keys.map(key=>'<th>'+esc(key)+'</th>').join('')+(recordSourceId?'<th>Attribution</th>':'')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+keys.map(key=>'<td>'+textCell(row[key])+'</td>').join('')+(recordSourceId?'<td><button data-action="correct-record" data-source="'+esc(recordSourceId)+'" data-id="'+esc(row.id)+'">Correct attribution</button></td>':'')+'</tr>').join('')+'</tbody></table></div>';
}
const badge=status=>'<span class="status">'+esc(status??'Retained')+'</span>';
const button=(action,id,label,extra='')=>'<button data-action="'+action+'" data-id="'+esc(id)+'" '+extra+'>'+label+'</button>';
function workTable(table,result,key){
 const columns={
  registries:['Name','Network','Version','Assets'],policies:['Name','Version','Coverage'],collections:['Name','Network','Version','Current operation'],
  runs:['Name','Kind','Status','Sources','Tasks'],captures:['Name','Provider','Status','Sources','Attempts'],sources:['Label','Provider / kind','Original bytes','Records','Source time'],
  editions:['Name','Kind / date','Result','Sources','Source time'],decisions:['Action','Actor','Reason','Created'],reports:['Name','Kind','Formats','Created'],exports:['Package','Destination','Manifest']
 }[table]??['Name','Status'];
 const cells=row=>{
  if(table==='registries')return [row.name,row.network,row.currentVersion,row.versions.at(-1)?.assetCount??0];
  if(table==='policies')return [row.name,row.currentVersion,(row.versions.at(-1)?.minimumCoveragePercent??'')+'%'];
  if(table==='collections')return [row.name,row.network,row.currentVersion,row.execution?.status??'Ready'];
  if(table==='runs')return [row.name,row.kind,row.status,row.sourceIds?.length??row.sourceCount??0,row.taskCount??0];
  if(table==='captures')return [row.name,row.provider,row.status,row.sourceCount,row.attemptCount];
  if(table==='sources')return [row.label,row.provider+' / '+row.kind,row.bodyFile.bytes.toLocaleString(),row.selectedRecords,row.observedAt];
  if(table==='editions')return [row.name,row.kind+(row.utcDate?' / '+row.utcDate:''),row.status,row.sourceCount,row.asOf];
  if(table==='decisions')return [row.action,row.actor,row.reason,row.createdAt];
  if(table==='reports')return [row.name,row.kind,row.formats.join(', '),row.createdAt];
  if(table==='exports')return [row.id,row.directory,row.manifestSha256];return [row.name??row.id,row.status??''];
 };
 const actions=row=>{
  if(table==='registries')return button('registry-edit',row.id,'Edit version');
  if(table==='policies')return button('policy-edit',row.id,'Edit version');
  if(table==='collections')return button('collection-edit',row.id,'Edit')+button('collection-open',row.id,'Dates')+button('collection-continue',row.id,'Run')+button('collection-pause',row.id,'Pause')+button('collection-resume',row.id,'Resume');
  if(table==='runs')return button('run-open',row.id,'Progress')+(row.editionId?button('edition-open',row.editionId,'Result'):'')+(!['COMPLETE'].includes(row.status)?button('run-continue',row.id,'Continue')+button('run-pause',row.id,'Pause')+button('run-resume',row.id,'Resume / repair'):'');
  if(table==='captures')return button('capture-open',row.id,'Sources')+(row.status!=='COMPLETE'?button('capture-continue',row.id,'Continue')+button('capture-pause',row.id,'Pause')+button('capture-resume',row.id,'Resume'):'');
  if(table==='sources')return button('source-open',row.id,'Open')+button('source-download',row.id,'Original file')+button('source-project',row.id,'Project');
  if(table==='editions')return button('edition-open',row.id,'Open result')+button('edition-report',row.id,'Report')+button('edition-download',row.id,'JSON');
  if(table==='reports')return button('report-preview',row.id,'Preview')+row.formats.map(format=>button('report-download',row.id,format.toUpperCase(),'data-format="'+esc(format)+'"')).join('')+button('report-export',row.id,'Package');
  if(table==='exports')return button('package-download',row.id,'Download archive');
  if(table==='decisions')return button('decision-open',row.id,'Original decision');return '';
 };
 const body=result.rows.length?'<div class="table-scroll"><table><thead><tr>'+columns.map(name=>'<th>'+name+'</th>').join('')+'<th>Actions</th></tr></thead><tbody>'+result.rows.map(row=>'<tr>'+cells(row).map(cell=>'<td>'+textCell(cell)+'</td>').join('')+'<td>'+actions(row)+'</td></tr>').join('')+'</tbody></table></div>':'<div class="empty">No '+esc(table)+' in this selection.</div>';
 return body+'<div class="pager"><span>'+result.total.toLocaleString()+' total · '+(result.rows.length?result.offset+1:0)+'–'+(result.offset+result.rows.length)+'</span><span><button data-action="table-page" data-key="'+esc(key)+'" data-offset="'+Math.max(0,result.offset-result.limit)+'" '+(result.offset===0?'disabled':'')+'>Previous</button> <button data-action="table-page" data-key="'+esc(key)+'" data-offset="'+(result.nextOffset??result.offset)+'" '+(result.nextOffset===null?'disabled':'')+'>Next</button></span></div>';
}

const copy=value=>JSON.parse(JSON.stringify(value));
const numericText=value=>value===null||value===undefined?'—':typeof value==='object'?String(value.value??value.amount??JSON.stringify(value)):String(value);
const externalLink=(url,label)=>typeof url==='string'&&/^https:\/\//i.test(url)?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>':esc(label);
function networkForm(value){return {'stellar:pubnet':'public','stellar:testnet':'testnet','stellar:futurenet':'futurenet'}[value]??value??'public';}
function selectedSourceIds(elementId,ids){const select=$('#'+elementId);for(const option of select.options)option.selected=ids.includes(option.value);}
function registryToEditor(body=null){
 const definition=copy(body?.definition??templates.registry??{name:'Stellar assets',network:'public',assets:[]});
 registryEditor={id:body?.id??null,version:body?.version??null,definition};
 $('#registry-name').value=definition.name??'';$('#registry-network').value=networkForm(definition.network);$('#registry-json').value=JSON.stringify(definition,null,2);
 $('#registry-editing').textContent=body?.id?'Following version of '+body.id+' · v'+body.version:'New registry';renderAssets();
}
function renderAssets(){
 const fields=['id','assetCode','assetIssuer','bluechipSymbol','pricingKey'];
 $('#asset-editor tbody').innerHTML=registryEditor.definition.assets.map((row,index)=>'<tr data-asset-index="'+index+'"><td><input type="checkbox" aria-label="Asset '+(index+1)+' enabled" data-asset-field="enabled" '+(row.enabled!==false?'checked':'')+'></td>'+fields.map(field=>'<td><input data-asset-field="'+field+'" aria-label="'+esc(field)+' for asset '+(index+1)+'" value="'+esc(row[field]??'')+'"></td>').join('')+'<td><input data-asset-field="peg.amount" aria-label="Peg amount for asset '+(index+1)+'" value="'+esc(row.peg?.amount??'')+'"></td><td><input data-asset-field="peg.currency" aria-label="Peg currency for asset '+(index+1)+'" value="'+esc(row.peg?.currency??'')+'"></td><td>'+button('asset-remove',index,'Remove')+'</td></tr>').join('');
}
function readAssetEditor(){
 const rows=copy(registryEditor.definition.assets);
 for(const node of $$('#asset-editor tbody tr')){
  const row=rows[Number(node.dataset.assetIndex)];
  for(const input of [...node.querySelectorAll('[data-asset-field]')]){
   const field=input.dataset.assetField,val=input.type==='checkbox'?input.checked:input.value.trim();
   if(field.startsWith('peg.')){row.peg??={};row.peg[field.slice(4)]=val;}
   else row[field]=val===''?null:val;
  }
  if(!row.peg?.amount&&!row.peg?.currency)row.peg=null;
  if(row.assetCode==='XLM'&&!row.assetIssuer)row.assetType='native';
  else if(row.assetIssuer)row.assetType='credit';
 }
 return {...copy(registryEditor.definition),name:value('registry-name'),network:value('registry-network'),assets:rows};
}
async function loadRegistry(id){
 const body=await read('registry.read',{registryId:id});selectionCache.registries[id]={id,name:body.name,network:body.definition.network,currentVersion:body.version};if(!state.registries[id]){const option=new Option(body.name+' · v'+body.version,id);$('#active-registry').add(option);}
 $('#active-registry').value=id;registryToEditor(body);navigate('registry');return body;
}
function policyToEditor(body=null){
 const definition=copy(body?.definition??templates['wallet-policy']);policyEditor={id:body?.id??null,version:body?.version??null,definition};
 $('#policy-name').value=definition.name;$('#policy-coverage').value=definition.minimumCoveragePercent;
 $('#policy-price-age').value=definition.priceMaxAgeSeconds;$('#policy-rating-age').value=definition.ratingMaxAgeSeconds;$('#policy-score-age').value=definition.scoreMaxAgeSeconds;
 $('#policy-bands').value=JSON.stringify(definition.gradeBands??[],null,2);$('#policy-json').value=JSON.stringify(definition,null,2);
 selectedSourceIds('policy-sources',definition.methodologySourceIds??[]);
 $('#policy-stale-prices').checked=definition.allowStalePrices===true;$('#policy-stale-ratings').checked=definition.allowStaleRatings===true;$('#policy-stale-scores').checked=definition.allowStaleScores===true;
 $('#policy-editing').textContent=body?.id?'Following version of '+body.id+' · v'+body.version:'New policy';
}

async function ensureSelectedSources(ids){
 for(const id of new Set(ids??[])){if(state.sources[id]||selectionCache.sources[id])continue;const {source}=await read('source.read',{sourceId:id,limit:1});selectionCache.sources[id]=source;}
 renderState();
}
async function loadPolicy(id){const body=await read('policy.read',{policyId:id});await ensureSelectedSources(body.definition.methodologySourceIds);selectionCache.policies[id]={id,name:body.name,currentVersion:body.version};renderState();$('#active-policy').value=id;policyToEditor(body);navigate('registry');return body;}
function collectionToEditor(body=null){
 const definition=copy(body?.definition??templates.collection??{});collectionEditor={id:body?.id??null,version:body?.version??null,definition};
 $('#collection-name').value=definition.name??'Stellar daily activity';$('#collection-launch').value=body?definition.launchDate:stamp().slice(0,10);
 $('#collection-registry-version').value=body?.id?definition.registryVersion:'';$('#collection-policy-version').value=body?.id?definition.policyVersion:'';
 $('#collection-enabled').checked=definition.enabled!==false;$('#collection-aliases').value=JSON.stringify(definition.connectionAliases??{},null,2);
 selectedSourceIds('collection-sources',definition.sourceIds??[]);
 $('#collection-editing').textContent=body?.id?'Following version of '+body.id+' · v'+body.version:'New collection';
}
async function loadCollection(id){
 const result=await read('collection.read',{collectionId:id}),definition=result.definition.definition;
 await ensureSelectedSources(definition.sourceIds);
 if(!state.registries[definition.registryId]&&!selectionCache.registries[definition.registryId]){const row=await read('registry.read',{registryId:definition.registryId});selectionCache.registries[row.id]={id:row.id,name:row.name,network:row.definition.network,currentVersion:row.version};}
 if(!state.policies[definition.policyId]&&!selectionCache.policies[definition.policyId]){const row=await read('policy.read',{policyId:definition.policyId});selectionCache.policies[row.id]={id:row.id,name:row.name,currentVersion:row.version};}
 renderState();$('#active-registry').value=definition.registryId;$('#active-policy').value=definition.policyId;collectionToEditor(result.definition);
 $('#run-collection').value=id;navigate('activity');return result;
}

function setupCatalog(){
 setOptions($('#capture-connection'),catalog.map(row=>row.connection),{valueOf:row=>row.alias,labelOf:row=>row.alias+' · '+row.provider});
 updateCaptureKinds();
}
function updateCaptureKinds(){
 const selected=catalog.find(row=>row.connection.alias===value('capture-connection')),entries=selected?.catalog??[];
 setOptions($('#capture-kind'),entries,{valueOf:row=>row.kind,labelOf:row=>row.label??row.kind});renderCaptureFilters();
}
function renderCaptureFilters(){
 const entry=catalog.find(row=>row.connection.alias===value('capture-connection'))?.catalog.find(row=>row.kind===value('capture-kind'));
 $('#capture-filters').innerHTML=entry?Object.entries(entry.filtersSchema?.properties??{}).map(([field,schema])=>{
  const required=(entry.filtersSchema.required??[]).includes(field),label=esc(field)+(required?' *':''),type=schema.type??schema.anyOf?.find(item=>item.type==='string')?.type??'string';
  const attributes=' data-native-filter="'+esc(field)+'" data-native-type="'+esc(type)+'"'+(required?' required':'');
  if(schema.enum)return '<label>'+label+'<select'+attributes+'><option value="">Default</option>'+schema.enum.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('')+'</select></label>';
  if(type==='boolean')return '<label>'+label+'<select'+attributes+'><option value="">Default</option><option value="true">Yes</option><option value="false">No</option></select></label>';
  if(type==='array'||type==='object')return '<label>'+label+' · JSON<textarea'+attributes+' rows="3" spellcheck="false" placeholder="'+esc(type==='array'?'[]':'{}')+'"></textarea></label>';
  return '<label>'+label+'<input'+attributes+(type==='integer'?' type="number" step="1"'+(schema.minimum!==undefined?' min="'+schema.minimum+'"':'')+(schema.maximum!==undefined?' max="'+schema.maximum+'"':''):' type="text"')+'></label>';
 }).join(''):'';
 const filters={};if(entry)for(const name of entry.filtersSchema?.required??[]){const type=entry.filtersSchema.properties?.[name]?.type;filters[name]=type==='array'?[]:type==='object'?{}:type==='boolean'?false:type==='integer'?null:'';}
 $('#capture-read').value=JSON.stringify({kind:entry?.kind??'',filters},null,2);
}
function captureSelection(){
 if(checked('capture-use-json'))return jsonInput('capture-read');
 const filters={};for(const input of $$('[data-native-filter]')){
  if(!input.value.trim())continue;const type=input.dataset.nativeType;
  filters[input.dataset.nativeFilter]=type==='integer'?Number(input.value):type==='boolean'?input.value==='true':['array','object'].includes(type)?JSON.parse(input.value):input.value.trim();
 }
 return {kind:value('capture-kind'),filters};
}

function detail(title,body,actions='',reader=null){
 $('#detail-title').textContent=title;$('#detail-body').innerHTML=body;$('#detail-actions').innerHTML=actions;detailReader=reader;detailOffset=0;
 $('#detail-pager').innerHTML='';if(!$('#detail-dialog').open)$('#detail-dialog').showModal();
}
function detailPaging(result){
 const next=result.nextOffset??result.sources?.nextOffset??result.attempts?.nextOffset??result.tasks?.nextOffset??result.steps?.nextOffset??result.dates?.nextOffset??null;
 $('#detail-pager').innerHTML=detailReader?'<button data-action="detail-page" data-offset="'+Math.max(0,detailOffset-50)+'" '+(detailOffset===0?'disabled':'')+'>Previous</button><span>Original rows from '+detailOffset+'</span><button data-action="detail-page" data-offset="'+(next??detailOffset)+'" '+(next===null?'disabled':'')+'>Next</button>':'';
}
async function openSource(id,{route=true,offset=0}={}){
 const result=await read('source.read',{sourceId:id,offset,limit:50}),source=result.source;
 const body='<p>'+esc(source.provider)+' / '+esc(source.kind)+' · '+source.bodyFile.bytes.toLocaleString()+' original bytes · '+esc(source.observedAt)+'</p>'+
  (source.error?'<div class="source-issue">'+esc(source.error.code)+' · '+esc(source.error.message)+'</div>':'')+
  dataTable(result.rows.map(row=>({id:row.id,...row.projection,observedAt:row.observedAt})),{recordSourceId:id})+
  '<details><summary>Original manifest and complete selected records</summary><pre>'+esc(JSON.stringify(result,null,2))+'</pre></details>';
 detail('Original source · '+source.label,body,button('source-download',id,'Download original bytes')+button('source-project',id,'Create a new projection')+button('source-use',id,'Use in wallet review'),next=>openSource(id,{route:false,offset:next}));
 detailOffset=offset;detailPaging(result);if(route)navigate('sources',{object:{type:'source',id}});
}
async function openCapture(id,{offset=0}={}){
 const result=await read('capture.read',{captureId:id,offset,limit:50}),row=result.capture;
 detail('Capture · '+row.name,'<p>'+badge(row.status)+' · '+esc(row.provider)+' · '+esc(row.connectionAlias)+'</p><h3>Original source pages</h3><div class="toolbar">'+result.sources.rows.map(sourceId=>button('source-open',sourceId,'Open '+sourceId)).join('')+'</div><h3>Original attempts</h3>'+dataTable(result.attempts.rows)+'<details><summary>Complete retained continuation</summary><pre>'+esc(JSON.stringify(row,null,2))+'</pre></details>',
  button('capture-continue',id,'Continue')+button('capture-pause',id,'Pause')+button('capture-resume',id,'Resume'),next=>openCapture(id,{offset:next}));
 detailOffset=offset;detailPaging(result);
}
async function openRun(id,{offset=0}={}){
 const result=await read('run.read',{runId:id,offset,limit:50}),row=result.run;
 detail('Run · '+row.name,'<p>'+badge(row.status)+' · '+esc(row.phase)+' · '+esc(row.network)+'</p>'+
  (row.nextBoundary?'<p>Original UTC boundary: '+esc(row.nextBoundary)+'</p>':'')+
  '<h3>Source tasks</h3>'+dataTable(result.tasks.rows)+'<h3>Retained steps</h3>'+dataTable(result.steps.rows)+'<h3>Original source files</h3><div class="toolbar">'+result.sourceIds.rows.map(sourceId=>button('source-open',sourceId,'Open '+sourceId)).join('')+'</div>'+
  '<details><summary>Complete original run</summary><pre>'+esc(JSON.stringify(row,null,2))+'</pre></details>',
  (row.editionId?button('edition-open',row.editionId,'Open result'):'')+button('run-continue',id,'Continue')+button('run-pause',id,'Pause')+button('run-resume',id,'Resume / repair'),next=>openRun(id,{offset:next}));
 detailOffset=offset;detailPaging(result);
}
async function openCollection(id,{offset=0}={}){
 const result=await read('collection.read',{collectionId:id,offset,limit:50});
 detail('Collection · '+result.definition.definition.name,'<p>Accepted launch '+esc(result.definition.definition.launchDate)+' · '+esc(result.definition.definition.network)+'</p>'+
  dataTable(result.dates.rows)+'<div class="toolbar">'+result.dates.rows.map(row=>button('edition-open',row.latestEditionId,row.utcDate+' result')).join('')+'</div>'+
  '<details open><summary>Original current operation</summary><pre>'+esc(JSON.stringify(result.execution,null,2))+'</pre></details>',
  button('collection-continue',id,'Run complete collection')+button('collection-pause',id,'Pause')+button('collection-resume',id,'Resume'),next=>openCollection(id,{offset:next}));
 detailOffset=offset;detailPaging(result);
}
function metric(label,amount){return '<div class="metric"><strong>'+esc(numericText(amount))+'</strong><span>'+esc(label)+'</span></div>';}
function originalContext(edition){return '<p>'+esc(edition.network)+' · '+esc(edition.asOf)+' · Registry v'+esc(edition.registryVersion)+' · Policy v'+esc(edition.policyVersion)+'</p>';}
async function openEdition(id,{route=true}={}){
 const edition=await read('edition.read',{editionId:id});selectedEdition=edition;$('#detail-dialog').close();
 $('#report-edition').value=id;$('#compare-right').value=id;
 const actions='<div class="toolbar">'+button('edition-report',id,'Create report')+button('edition-download',id,'Download original JSON')+'</div>';
 const conditions=(edition.issues?.length?'<h3>Source conditions</h3>'+dataTable(edition.issues):'')+(edition.sourceErrors?.length?'<h3>Capture conditions</h3>'+dataTable(edition.sourceErrors):'');
 if(edition.kind==='wallet'){
  const summary=edition.summary??{},coverage=edition.coverage??{},aggregate=edition.aggregate??{};
  const holdings=edition.holdings.map(row=>'<tr><td><code>'+esc(row.account)+'</code></td><td>'+esc(row.registryAssetId??row.assetCode??row.assetKey)+'</td><td>'+esc(row.amount)+'</td><td>'+esc(numericText(row.valueUSD))+'</td><td>'+externalLink(row.rating?.attribution?.gradeUrl??row.rating?.url,row.rating?.grade??'Unrated')+(row.rating?.grade?'<br><small>by Bluechip</small>':'')+'</td><td>'+esc(numericText(row.score))+'</td><td>'+esc(row.eligible?'Eligible':(row.exclusionReasons??[]).join(', '))+'</td></tr>').join('');
  $('#wallet-result').className='';$('#wallet-result').innerHTML=originalContext(edition)+'<div class="metrics">'+metric('Known value · USD',summary.totalKnownValueUSD)+metric('Rated value · USD',summary.ratedValueUSD)+metric('Rated coverage · %',coverage.percent)+metric('Wallet grade',aggregate.grade??aggregate.status)+metric('Aggregate score',aggregate.score)+metric('Unpriced holdings',summary.unpricedHoldings)+'</div>'+
   '<p>'+externalLink(edition.attribution?.url??'https://bluechip.org/',edition.attribution?.label??'by Bluechip')+' · '+esc(coverage.status??edition.status)+'</p>'+actions+
   '<div class="table-scroll"><table><thead><tr><th>Account</th><th>Asset</th><th>Original quantity</th><th>Value USD</th><th>Grade</th><th>Score</th><th>Coverage</th></tr></thead><tbody>'+holdings+'</tbody></table></div>'+
   (edition.unresolvedHoldings?.length?'<h3>Unresolved original holdings</h3>'+dataTable(edition.unresolvedHoldings):'')+
   '<h3>Account reads and original labels</h3>'+dataTable(edition.accounts)+conditions;
  if(route)navigate('wallets',{object:{type:'edition',id}});else showPage('wallets');
 }else{
  $('#activity-result').className='';$('#activity-result').innerHTML=originalContext(edition)+'<p>'+esc(edition.period.from)+' through '+esc(edition.period.to)+' · '+badge(edition.status)+'</p>'+actions+
   '<h3>Daily metrics</h3>'+dataTable(edition.metrics,{fields:['assetId','utcDate','name','value','unit','status','source','asOf']})+
   '<h3>Original coverage</h3>'+dataTable(edition.coverageDetails??edition.coverage)+
   '<details><summary>Original holders and account distribution</summary>'+dataTable(edition.holders)+'</details>'+conditions;
  if(route)navigate('activity',{object:{type:'edition',id}});else showPage('activity');
 }
}
async function download(path,name,{preview=false}={}){
 const response=await fetch(path,{cache:'no-store',redirect:'error',headers:{Authorization:'Bearer '+token}});
 if(!response.ok){let result;try{result=await response.json();}catch{}throw Object.assign(new Error(result?.error?.message??'The original download failed.'),result?.error??{});}
 const blob=await response.blob(),expected=response.headers.get('X-Content-SHA256');
 if(expected){
  const bytes=await blob.arrayBuffer(),actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(actual!==expected)throw new Error('The original download differs from its retained source hash.');
 }
 if(preview){if(previewURL)URL.revokeObjectURL(previewURL);previewURL=URL.createObjectURL(blob);$('#report-preview').src=previewURL;$('#report-preview').hidden=false;return;}
 const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function projectSource(id){
 const result=await read('source.read',{sourceId:id,limit:1}),source=result.source;
 detail('Project original source','<form id="projection-form"><input type="hidden" id="projection-source" value="'+esc(id)+'"><div class="form-grid"><label>Provider<input id="projection-provider" value="'+esc(source.provider)+'" required></label><label>Kind<input id="projection-kind" value="'+esc(source.kind)+'" required></label><label>Records pointer<input id="projection-pointer" value="'+esc(source.recordsPath??'')+'"></label><label>Original scope<input id="projection-scope" value="'+esc(source.sourceScope)+'" required></label></div><label>Original field mapping<textarea id="projection-mapping" rows="9" spellcheck="false">'+esc(JSON.stringify(source.mapping,null,2))+'</textarea></label><button class="primary" type="submit">Retain a new projection</button></form>');
}
async function originalContinuation(kind,id,{resume=false}={}){
 const method=kind==='run'?'run.read':kind==='capture'?'capture.read':'collection.read',key=kind+'Id';
 let result=await read(method,{[key]:id,limit:1});
 if(resume)await mutate(kind+'.resume',{[key]:id},'Resume original '+kind);
 result=await read(method,{[key]:id,limit:1});
 const original=kind==='run'?result.run.execution?.args:kind==='capture'?result.capture.run?.args:result.execution?.status!=='COMPLETE'?result.execution?.args:null;
 const operation=kind==='run'?'run.continue':kind==='capture'?'capture.run':'collection.run';
 const output=await mutate(operation,original??{[key]:id},'Complete original '+kind);
 if(output?.editionId)await openEdition(output.editionId);return output;
}

const actions={
 'table-page':async button=>{const key=button.dataset.key,view=views.get(key);views.set(key,{...view,offset:Number(button.dataset.offset)});await refreshTables();},
 'asset-remove':async button=>{registryEditor.definition=readAssetEditor();registryEditor.definition.assets.splice(Number(button.dataset.id),1);renderAssets();$('#registry-json').value=JSON.stringify(registryEditor.definition,null,2);},
 'registry-edit':button=>loadRegistry(button.dataset.id),'policy-edit':button=>loadPolicy(button.dataset.id),'collection-edit':button=>loadCollection(button.dataset.id),
 'source-open':button=>openSource(button.dataset.id),'source-project':button=>projectSource(button.dataset.id),'source-download':button=>download('/api/sources/'+button.dataset.id+'/original','stellar-source-'+button.dataset.id+'.body'),
 'source-use':async button=>{const result=await read('source.read',{sourceId:button.dataset.id,limit:1}),source=result.source;selectionCache.sources[source.id]={...source,file:null};renderState();for(const option of $('#wallet-sources').options)if(option.value===source.id)option.selected=true;$('#detail-dialog').close();navigate('wallets');},
 'capture-open':button=>openCapture(button.dataset.id),'run-open':button=>openRun(button.dataset.id),'collection-open':button=>openCollection(button.dataset.id),
 'capture-continue':button=>originalContinuation('capture',button.dataset.id),'run-continue':button=>originalContinuation('run',button.dataset.id),'collection-continue':button=>originalContinuation('collection',button.dataset.id),
 'capture-resume':button=>originalContinuation('capture',button.dataset.id,{resume:true}),'run-resume':button=>originalContinuation('run',button.dataset.id,{resume:true}),'collection-resume':button=>originalContinuation('collection',button.dataset.id,{resume:true}),
 'capture-pause':button=>mutate('capture.pause',{captureId:button.dataset.id},'Pause source capture'),'run-pause':button=>mutate('run.pause',{runId:button.dataset.id},'Pause review'),'collection-pause':button=>mutate('collection.pause',{collectionId:button.dataset.id},'Pause daily collection'),
 'edition-open':button=>openEdition(button.dataset.id),'edition-download':button=>download('/api/editions/'+button.dataset.id+'/original','stellar-ratings-edition-'+button.dataset.id+'.json'),
 'edition-report':async button=>{$('#report-edition').value=button.dataset.id;$('#detail-dialog').close();navigate('reports');},
 'correct-record':async button=>{$('#decision-source').value=button.dataset.source;$('#decision-record').value=button.dataset.id;$('#decision-actor').value=state.profile.operator??'';$('#detail-dialog').close();navigate('decisions');},
 'decision-open':async button=>{const result=await read('decision.read',{decisionId:button.dataset.id});detail('Original correction','<pre>'+esc(JSON.stringify(result,null,2))+'</pre>');},
 'report-preview':async button=>{const report=await read('report.read',{reportId:button.dataset.id});if(!report.formats.includes('html')){detail('Original report','<pre>'+esc(JSON.stringify(report,null,2))+'</pre>');return;}navigate('reports');await download('/api/reports/'+button.dataset.id+'/files/html','report.html',{preview:true});$('#report-preview').scrollIntoView({block:'start'});},
 'report-download':async button=>{const report=await read('report.read',{reportId:button.dataset.id}),format=button.dataset.format,member=report.files.find(row=>row.format===format);await download('/api/reports/'+button.dataset.id+'/files/'+encodeURIComponent(format),member.filename);},
 'report-export':async button=>{$('#report-export-id').value=button.dataset.id;$('#report-export-destination').value=bootstrap.operator.workspaceDirectory+'.deliveries/report-'+button.dataset.id;navigate('receiving');},
 'package-download':button=>download('/api/packages/'+button.dataset.id+'/archive','stellar-ratings-'+button.dataset.id+'.tar.gz'),
 'detail-page':async button=>{if(detailReader)await detailReader(Number(button.dataset.offset));},
 'request-recover':button=>executeRequest(journalKey(button.dataset.id)),
 'request-view':async button=>{const row=(await journalRows()).find(item=>item.requestId===button.dataset.id);detail('Saved original request','<pre>'+esc(JSON.stringify({...row,file:row.file?{name:row.file.name,size:row.file.size,type:row.file.type}:null},null,2))+'</pre>');}
};
document.addEventListener('click',event=>{
 const button=event.target.closest('button[data-action]');if(!button||button.disabled)return;
 const action=actions[button.dataset.action];if(!action)return;event.preventDefault();button.disabled=true;
 Promise.resolve().then(()=>action(button)).catch(failure).finally(()=>{button.disabled=false;});
});
function bind(id,event,work){$('#'+id).addEventListener(event,source=>{Promise.resolve().then(()=>work(source)).catch(failure);});}
for(const button of $$('nav [data-page]'))button.addEventListener('click',()=>navigate(button.dataset.page));
bind('refresh','click',refresh);bind('requests-open','click',()=>navigate('requests'));bind('requests-recover','click',recoverRequests);
bind('active-registry','change',()=>{renderState();history.replaceState({...history.state,registryId:$('#active-registry').value},'');});
bind('active-policy','change',()=>history.replaceState({...history.state,policyId:$('#active-policy').value},''));
bind('registry-new','click',()=>registryToEditor());bind('registry-load','click',()=>loadRegistry(registrySelection().registryId));
bind('policy-new','click',()=>policyToEditor());bind('policy-load','click',()=>loadPolicy(policySelection().policyId));
bind('collection-new','click',()=>collectionToEditor());
bind('asset-add','click',()=>{registryEditor.definition=readAssetEditor();registryEditor.definition.assets.push({id:'',assetCode:'',assetIssuer:null,bluechipSymbol:null,pricingKey:null,enabled:true,peg:null,issuerAccounts:[],distributionAccounts:[],sourceIds:[]});renderAssets();});
bind('registry-json-apply','click',()=>{const definition=jsonInput('registry-json');registryToEditor(registryEditor.id?{id:registryEditor.id,version:registryEditor.version,definition}:{definition});});
bind('policy-json-apply','click',()=>{const definition=jsonInput('policy-json');policyToEditor(policyEditor.id?{id:policyEditor.id,version:policyEditor.version,definition}:{definition});});
bind('capture-connection','change',updateCaptureKinds);bind('capture-kind','change',renderCaptureFilters);
bind('source-provider','change',()=>{const provider=value('source-provider');$('#source-kind').value=({document:'document',bluechip:'grade',horizon:'account','stellar-expert':'assets',stellar:'ledger-entries',activity:'activity'})[provider]??'price';});
bind('detail-close','click',()=>{$('#detail-dialog').close();const url=new URL(location.href);url.searchParams.delete('object');url.searchParams.delete('id');history.replaceState({...history.state,object:null},'',url);});
bind('profile-open','click',()=>{$('#profile-name').value=state.profile.name??'Stellar ratings';$('#profile-operator').value=state.profile.operator??'';$('#profile-daily').checked=typeof state.profile.collectDaily==='boolean'?state.profile.collectDaily:bootstrap.operator.collectDaily===true;$('#profile-dialog').showModal();});
bind('profile-close','click',()=>$('#profile-dialog').close());
bind('popular-refresh','click',async()=>{$('#popular-result').innerHTML=dataTable((await read('wallet.popular',{network:registryNetwork(),limit:100})).wallets);});
bind('lookup-refresh','click',async()=>{const result=await read('lookup.read',{network:registryNetwork(),limit:100});$('#popular-result').innerHTML='<h3>Private successful-wallet lookup counts</h3>'+dataTable(result.rows)+'<p>'+result.total+' original wallets. Full original history remains in the workspace.</p>';});
bind('history-load','click',async()=>{const show=async offset=>{const result=await read('workspace.history',{offset,limit:50});detail('Original workspace history',dataTable(result.records),'',show);detailOffset=offset;detailPaging(result);};await show(0);});
bind('package-inspect','click',async()=>{const result=await read('package.inspect',{sourceDirectory:value('receive-source'),expectedManifestSha256:value('receive-hash')||undefined});$('#receiving-result').innerHTML='<h3>Original delivery inspection</h3><pre>'+esc(JSON.stringify(result,null,2))+'</pre>';});
const forms={
 'profile-form':async()=>{
  await mutate('workspace.profile',{profile:{...state.profile,name:value('profile-name'),operator:value('profile-operator'),collectDaily:checked('profile-daily')}},'Save workspace settings');$('#profile-dialog').close();
 },
 'registry-form':async()=>{
  const args={definition:readAssetEditor(),...(registryEditor.id?{registryId:registryEditor.id,expectedVersion:registryEditor.version}:{})};
  const result=await mutate('registry.save',args,'Save registry version');if(result)await loadRegistry(result.registryId);
 },
 'policy-form':async()=>{
  const definition={...copy(policyEditor.definition),name:value('policy-name'),minimumCoveragePercent:value('policy-coverage'),priceMaxAgeSeconds:Number(value('policy-price-age')),
   ratingMaxAgeSeconds:Number(value('policy-rating-age')),scoreMaxAgeSeconds:Number(value('policy-score-age')),gradeBands:jsonInput('policy-bands',[]),methodologySourceIds:selectedValues('policy-sources'),
   allowStalePrices:checked('policy-stale-prices'),allowStaleRatings:checked('policy-stale-ratings'),allowStaleScores:checked('policy-stale-scores')};
  const result=await mutate('policy.save',{definition,...(policyEditor.id?{policyId:policyEditor.id,expectedVersion:policyEditor.version}:{})},'Save original wallet policy');if(result)await loadPolicy(result.policyId);
 },
 'wallet-form':async()=>{
  const addresses=value('wallet-addresses').split(/[\s,;]+/).filter(Boolean),asOf=value('wallet-asof');
  const result=await mutate('wallet.review',{...registrySelection(),...policySelection(),name:value('wallet-name'),addresses,mode:value('wallet-mode'),
   connectionAliases:jsonInput('wallet-aliases'),sourceIds:selectedValues('wallet-sources'),...(asOf?{asOf:new Date(asOf+'Z').toISOString()}:{})},'Complete wallet review');
  if(result?.editionId)await openEdition(result.editionId);else if(result?.runId)await openRun(result.runId);
 },
 'collection-form':async()=>{
  const definition={...copy(collectionEditor?.definition??{}),...registrySelection(),...policySelection(),name:value('collection-name'),launchDate:value('collection-launch'),enabled:checked('collection-enabled'),
   ...(value('collection-registry-version')?{registryVersion:Number(value('collection-registry-version'))}:{}),...(value('collection-policy-version')?{policyVersion:Number(value('collection-policy-version'))}:{}),
   connectionAliases:jsonInput('collection-aliases'),sourceIds:selectedValues('collection-sources')};
  const result=await mutate('collection.save',{definition,...(collectionEditor?.id?{collectionId:collectionEditor.id,expectedVersion:collectionEditor.version}:{})},'Save daily collection');if(result)await loadCollection(result.collectionId);
 },
 'collection-run-form':async()=>{
  const args={collectionId:value('run-collection'),repair:checked('collection-repair'),...(value('collection-from')?{from:value('collection-from')}:{}) ,...(value('collection-to')?{to:value('collection-to')}:{})};
  const current=await read('collection.read',{collectionId:args.collectionId,limit:1});
  if(current.execution&&current.execution.status!=='COMPLETE')throw new Error('Use Resume on the current collection to continue its original dates. Finish that operation before selecting another period.');
  const result=await mutate('collection.run',args,'Run complete daily collection');if(result)await openCollection(result.collectionId);
 },
 'source-form':async()=>{
  const file=$('#source-file').files[0];if(!file)throw new Error('Select the complete original source file.');
  const provider=value('source-provider'),args={...registrySelection(false),provider,kind:value('source-kind'),sourceScope:value('source-scope'),filename:file.name,contentType:file.type,
   label:value('source-label')||file.name,recordsPath:value('source-pointer')||null,mapping:jsonInput('source-mapping',null),...(['source','activity'].includes(provider)&&(/\.csv$/i.test(file.name)||/csv/i.test(file.type))?{format:'csv'}:{})};
  const result=await executeRequest(await saveRequest({method:'source.import',args,label:'Retain '+file.name,kind:'source',file}));if(result?.sourceId){$('#source-file').value='';await openSource(result.sourceId);}
 },
 'capture-form':async()=>{
  const result=await mutate('capture.start',{...registrySelection(),connectionAlias:value('capture-connection'),read:captureSelection()},'Create original native capture');
  if(result?.captureId){if(checked('capture-complete'))await originalContinuation('capture',result.captureId);await openCapture(result.captureId);}
 },
 'projection-form':async()=>{
  const sourceId=value('projection-source'),result=await mutate('source.project',{sourceId,provider:value('projection-provider'),kind:value('projection-kind'),recordsPath:value('projection-pointer')||null,
   sourceScope:value('projection-scope'),mapping:jsonInput('projection-mapping',null)},'Project original source');if(result?.sourceId)await openSource(result.sourceId);
 },
 'decision-form':async()=>{
  const result=await mutate('decision.save',{...registrySelection(),sourceId:value('decision-source'),recordId:value('decision-record'),action:value('decision-action'),actor:value('decision-actor'),
   reason:value('decision-reason'),mapping:jsonInput('decision-mapping'),...(value('decision-supersedes')?{supersedes:value('decision-supersedes')}:{})},'Save attributable correction');
  if(result)notice('Correction retained. Review the original selected sources into a following edition.');
 },
 'compare-form':async()=>{
  const show=async offset=>{const result=await read('edition.compare',{leftEditionId:value('compare-left'),rightEditionId:value('compare-right'),offset,limit:50});
   detail('Edition comparison','<p>'+esc(JSON.stringify(result.summary))+'</p>'+dataTable(result.changes.rows),'',show);detailOffset=offset;detailPaging(result.changes);};await show(0);
 },
 'report-form':async()=>{
  const result=await mutate('report.create',{editionId:value('report-edition'),formats:$$('input[name="report-format"]:checked').map(input=>input.value),
   ...(value('report-name')?{name:value('report-name')}:{}),...(value('report-asset')?{assetId:value('report-asset')}:{}),...(value('report-account')?{account:value('report-account')}:{})},'Create complete original report');
  if(result?.report.formats.includes('html'))await download('/api/reports/'+result.reportId+'/files/html','ratings-result.html',{preview:true});
 },
 'export-form':async()=>{const result=await mutate('workspace.export',{destination:value('export-destination')},'Export complete workspace');if(result)$('#export-destination').value=bootstrap.operator.workspaceDirectory+'.deliveries/'+uuid();},
 'report-export-form':async()=>mutate('report.export',{reportId:value('report-export-id'),destination:value('report-export-destination')},'Export original report package'),
 'unpack-form':async()=>{
  const file=$('#package-file').files[0];if(!file)throw new Error('Select the complete original delivery archive.');
  const requestId=uuid(),expectedManifestSha256=value('package-upload-hash')||undefined,args={requestId,...(expectedManifestSha256?{expectedManifestSha256}:{})};
  const route='/api/packages/unpack?requestId='+requestId+(expectedManifestSha256?'&manifestSha256='+expectedManifestSha256:'');
  await executeRequest(await saveRequest({method:'package.unpack',args,label:'Receive archive '+file.name,kind:'archive',file,route}));
 },
 'receive-form':async()=>mutate('package.receive',{sourceDirectory:value('receive-source'),destination:value('receive-destination'),expectedManifestSha256:value('receive-hash')},'Receive independent complete installation')
};
document.addEventListener('submit',event=>{
 const form=event.target,handler=forms[form.id];if(!handler)return;event.preventDefault();
 const submit=form.querySelector('[type="submit"]');if(submit?.disabled)return;if(submit)submit.disabled=true;
 Promise.resolve().then(handler).catch(failure).finally(()=>{if(submit)submit.disabled=false;});
});
async function restoreRoute(){
 const url=new URL(location.href),next=activePageFromURL();showPage($$('nav [data-page]').some(button=>button.dataset.page===next)?next:'overview');
 const saved=history.state;if(saved?.registryId&&[...$('#active-registry').options].some(row=>row.value===saved.registryId))$('#active-registry').value=saved.registryId;
 if(saved?.policyId&&[...$('#active-policy').options].some(row=>row.value===saved.policyId))$('#active-policy').value=saved.policyId;
 const type=url.searchParams.get('object'),id=url.searchParams.get('id');
 if(id&&type==='source')await openSource(id,{route:false});
 else if(id&&type==='edition')await openEdition(id,{route:false});
 else $('#detail-dialog').close();
 await refreshTables();
}
window.addEventListener('popstate',()=>restoreRoute().catch(failure));
window.addEventListener('beforeunload',()=>{if(previewURL)URL.revokeObjectURL(previewURL);});
async function start(){
 if(!token)throw new Error('Open the complete private workspace URL from the running operator.');
 bootstrap=await api('/api/bootstrap');state=bootstrap.state;catalog=bootstrap.catalog;templates=bootstrap.templates??{};
 renderState();setupCatalog();registryToEditor();policyToEditor();collectionToEditor();
 $('#export-destination').value=bootstrap.operator.workspaceDirectory+'.deliveries/'+uuid();
 $('#report-export-destination').value=bootstrap.operator.workspaceDirectory+'.deliveries/report-'+uuid();
 $('#receive-destination').value=bootstrap.operator.workspaceDirectory+'.received-'+uuid().slice(0,8);
 $('#decision-actor').value=state.profile.operator??'';
 await restoreDeliverySelection();await restoreRoute();await renderRequests();await recoverRequests();notice('Workspace ready · Revision '+state.revision);
}
setInterval(()=>{if(activeRequests&&state&&!refreshing)refresh().catch(failure);},2500);
start().catch(failure);
