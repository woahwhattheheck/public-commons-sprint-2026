// MIT. Industrial source operator. Explicit original intents survive loss/reload.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const clone = value => structuredClone(value);
const pretty = value => JSON.stringify(value, null, 2);
const uuid = () => crypto.randomUUID();
const short = value => value ? String(value).slice(0,12) : '—';
const byteText = value => Number.isSafeInteger(value) ? value.toLocaleString() + ' B' : 'Unknown';
const when = value => value ? new Date(value).toLocaleString() : '—';
const pill = value => '<span class="pill">' + esc(value ?? 'UNKNOWN') + '</span>';
const empty = text => '<div class="empty">' + esc(text) + '</div>';
const jsonDetail = (label,value,open=false) => '<details'+(open?' open':'')+'><summary>'+esc(label)+'</summary><pre>'+esc(pretty(value))+'</pre></details>';
const button = (label,action,data={},primary=false,disabled=false) => '<button type="button" data-action="'+esc(action)+'" '+
  Object.entries(data).map(([key,value])=>'data-'+key+'="'+esc(value)+'"').join(' ')+(primary?' class="primary"':'')+(disabled?' disabled':'')+'>'+esc(label)+'</button>';
const option = (value,label,selected) => '<option value="'+esc(value)+'"'+(String(value)===String(selected)?' selected':'')+'>'+esc(label)+'</option>';
const frame = (title,lead,content) => '<h2>'+esc(title)+'</h2><p class="lead">'+esc(lead)+'</p>'+content;
const card = (title,content) => '<section class="card">'+(title?'<h3>'+esc(title)+'</h3>':'')+content+'</section>';
const safeUrl = value => { try { const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:null; } catch{return null;} };
const link = (url,label) => safeUrl(url)?'<a class="source-url" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(label??url)+'</a>':esc(label??url);
const table = (headers,rows,classes='') => rows.length?'<div class="table-wrap"><table class="'+classes+'"><thead><tr>'+headers.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table>':'';
const token = $('meta[name="workspace-token"]').content;
let state=null, view='source', busy=false, renderGeneration=0, drafts={}, intents={}, notice=null;
let listing=null, listingSourceId=null, selectedFile=null, capture=null, sample=null, projectionRows=[], mapping=null, editionId=null, productId=null, publisher=null, nativeResult=null, recovered=null;
let selectedCaptureId=null, lastResult=null, publisherAction='publisher.status';
const key=part=>'stellar-forge.webdav.'+state.id+'.'+part;
const revisionContext = saved => ({workspaceId:saved?.id,revision:saved?.revision,source:saved?.source,
 activeSourceId:saved?.activeSourceId,activeMerchantId:saved?.activeMerchantId,activeProductId:saved?.activeProductId,
 mappings:saved?.mappings,editions:saved?.editions,exports:saved?.exports,merchants:saved?.merchants,products:saved?.products,
 recentOperations:saved?.operations?.slice(0,8)});
const unresolvedIntent = intent => !['COMPLETE','FAILED','INTERRUPTED'].includes(intent.status);
function remember() {
  if(!state)return;
  try{sessionStorage.setItem(key('drafts'),pretty(drafts));sessionStorage.setItem(key('intents'),pretty(intents));}catch{
    $('#connection').textContent='Browser draft storage is unavailable; keep this page open.';
  }
}
function restored() {
  try{drafts=JSON.parse(sessionStorage.getItem(key('drafts'))??'{}');intents=JSON.parse(sessionStorage.getItem(key('intents'))??'{}');}
  catch{drafts={};intents={};}
}
const value=(form,name,fallback='')=>Object.hasOwn(drafts[form]??{},name)?drafts[form][name]:fallback;
const field=(form,name,label,fallback='',type='text',help='',attributes='')=>{
 const id=form+'-'+name,v=value(form,name,fallback);
 return '<div class="field"><label for="'+esc(id)+'">'+esc(label)+'</label><input id="'+esc(id)+'" name="'+esc(name)+'" type="'+type+'" value="'+esc(v)+'" '+attributes+'>'+(help?'<small>'+esc(help)+'</small>':'')+'</div>';
};
const area=(form,name,label,fallback='',code=false,help='')=>'<div class="field full"><label for="'+esc(form+'-'+name)+'">'+esc(label)+'</label><textarea id="'+esc(form+'-'+name)+'" name="'+esc(name)+'"'+(code?' class="code" spellcheck="false"':'')+'>'+esc(value(form,name,fallback))+'</textarea>'+(help?'<small>'+esc(help)+'</small>':'')+'</div>';
const select=(form,name,label,items,fallback='',help='')=>'<div class="field"><label for="'+esc(form+'-'+name)+'">'+esc(label)+'</label><select id="'+esc(form+'-'+name)+'" name="'+esc(name)+'">'+items.map(([v,l])=>option(v,l,value(form,name,fallback))).join('')+'</select>'+(help?'<small>'+esc(help)+'</small>':'')+'</div>';
const check=(form,name,label,fallback=false)=>'<label class="check"><input type="checkbox" name="'+esc(name)+'"'+(value(form,name,fallback)?' checked':'')+'>'+esc(label)+'</label>';
function readForm(form) {
  const result={};
  for(const element of form.elements)if(element.name&&element.type!=='file'&&element.type!=='submit')
    result[element.name]=element.type==='checkbox'?element.checked:element.value;
  return result;
}
function saveDraft(form) { if(!form?.dataset.form)return;drafts[form.dataset.form]=readForm(form);remember(); }
function clearDraft(name){delete drafts[name];remember();}
function message(text,type='info'){notice={text,type};renderNotices();}
function renderNotices(){
 $('#notice').innerHTML=notice?'<div class="notice '+esc(notice.type)+'"><span>'+esc(notice.text)+'</span><button type="button" data-action="dismiss">Dismiss</button></div>':'';
 const running=state?.running??[];
 $('#operation-status').innerHTML=busy||running.length?'<div class="status-box"><div><strong>'+esc(running[0]?.action??'Working with the retained workspace')+'</strong><div class="small">Edits stay in their current form while this original operation completes.</div></div>'+
 (running.some(x=>x.action.startsWith('capture.'))?button('Pause source read','cancel',{id:running[0].id}):'')+'</div>':'';
 const unresolved=Object.values(intents).filter(unresolvedIntent);
 $('#recovery').innerHTML=unresolved.length?'<section class="pending"><h3>Retained operation '+esc(short(unresolved.at(-1).operationId))+'</h3><p class="small">The original intent is saved. Reopen its recorded result before continuing that operation.</p><div class="actions compact">'+
 button('Read original operation','operation',{id:unresolved.at(-1).operationId})+button('Open operation history','goto',{view:'handoff'})+'</div></section>':'';
}
async function request(path,{method='GET',body:payload,raw=false}={}){
 let response;
 try{response=await fetch(path,{method,headers:{'X-Workspace-Token':token,...(payload!==undefined?{'Content-Type':'application/json'}:{})},...(payload!==undefined?{body:JSON.stringify(payload)}:{})});}
 catch{throw Object.assign(new Error('The connection ended before its result was received. Your draft and original operation ID are retained.'),{uncertain:true});}
 if(raw&&response.ok)return response;
 const text=await response.text();let result;
 try{result=JSON.parse(text);}catch{throw Object.assign(new Error(response.ok?'The service returned an unreadable completion. Reopen the original operation; your draft is retained.':'The service response could not be read. Your draft is retained.'),{status:response.status,uncertain:true});}
 if(!response.ok)throw Object.assign(new Error(result.error?.message??'The original operation did not complete.'),{status:response.status,code:result.error?.code,state:result.state,details:result.error?.details});
 return result;
}
function accept(next){if(!next||next.schema!=='stellar-forge.webdav-workspace.v1'||!Number.isSafeInteger(next.revision))throw Object.assign(new Error('The returned saved state could not be read; the original operation is retained.'),{uncertain:true});state=next;}
function controls(locked){
 for(const element of $$('button,input,select,textarea')){
  if(element.dataset.action==='cancel')continue;
  if(locked){element.dataset.wasDisabled=element.disabled?'1':'0';element.disabled=true;}
  else if(Object.hasOwn(element.dataset,'wasDisabled')){element.disabled=element.dataset.wasDisabled==='1';delete element.dataset.wasDisabled;}
 }
}
async function work(fn){
 if(busy)return;
 for(const form of $$('form[data-form]'))saveDraft(form);
 busy=true;const generation=++renderGeneration;controls(true);renderNotices();
 try{await fn(generation);}
 catch(error){if(error.state){try{accept(error.state);}catch{}}message((error.code?error.code+': ':'')+error.message,'error');}
 finally{busy=false;controls(false);render();}
}
async function mutate(action,input,retained=null){
 if(!retained){
  const pending=Object.values(intents).find(intent=>unresolvedIntent(intent)&&intent.action===action&&
   (action!=='publisher.act'||intent.input?.action===input.action&&pretty(intent.input)===pretty(input)));
  if(pending)throw Object.assign(new Error('Read original operation '+pending.operationId+' before submitting this source decision again. Its original input and ID are retained.'),{code:'WEBDAV_ORIGINAL_INTENT_PENDING'});
 }
 const intent=retained??{action,input:clone(input),operationId:uuid(),expectedRevision:state.revision,createdAt:new Date().toISOString(),workspaceId:state.id};
 if(intent.workspaceId!==state.id)throw new Error('This retained intent belongs to a different workspace.');
 intents[intent.operationId]={...intent,status:'SENT'};remember();renderNotices();
 let result;
 try{
  result=await request('/api/act',{method:'POST',body:{action:intent.action,input:intent.input,operationId:intent.operationId,expectedRevision:intent.expectedRevision}});
 }catch(error){
  const observed=error.state?.operations?.find(row=>row.id===intent.operationId);
  if(observed)intents[intent.operationId].status=observed.status;
  else if(error.status>=400&&error.status<500&&error.state&&error.code!=='WEBDAV_STALE_REVISION'&&error.code!=='WEBDAV_OPERATION_REVIEW')intents[intent.operationId].status='FAILED';
  if(error.code==='WEBDAV_STALE_REVISION'||error.code==='WEBDAV_OPERATION_REVIEW'){
   intents[intent.operationId].status=observed?'REVIEW_REQUIRED':'NOT_RECORDED_STALE';
   intents[intent.operationId].observedRevision=error.state?.revision??error.details?.currentRevision;
   recovered={operation:{...intents[intent.operationId],id:intent.operationId},result:null,active:false,
    review:{originalExpectedRevision:intent.expectedRevision,currentRevision:intents[intent.operationId].observedRevision,saved:revisionContext(error.state)}};
   view='handoff';
  }
  remember();throw error;
 }
 if(!result.operation||result.operation.id!==intent.operationId||!Object.hasOwn(result,'result'))
   throw Object.assign(new Error('The original completion could not be reconciled. Reopen its operation ID.'),{uncertain:true});
 accept(result.state);intents[intent.operationId].status=result.operation.status;remember();lastResult=result;
 return result.result;
}
async function download(path,filename){
 const response=await request(path,{raw:true}), blob=await response.blob(), url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download=filename;a.hidden=true;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
const filePath=(kind,id,name,sourceId)=>'/api/file?'+new URLSearchParams({kind,id,...(name?{name}:{}),...(sourceId?{sourceId}:{})});
const fileButton=(label,kind,id,name,sourceId)=>button(label,'file',{kind,id,name:name??'',source:sourceId??''});
function sourcePage(){
 const source=state.source??{connection:{rootUrl:'',auth:{type:'none'},allowLocalHttp:false},limits:{maxListingBytes:4194304,maxEntries:10000,maxFileBytes:67108864,timeoutMs:30000,maxCaptureMs:600000}};
 const c=source.connection,a=c.auth,l=source.limits;
 return frame('Source connection','Select one original WebDAV collection. Credential values remain in the host environment; this declaration holds only their names.',
 card('Connection declaration','<form data-form="source" data-submit="source"><div class="grid">'+
 field('source','rootUrl','Collection URL',c.rootUrl,'url','Use the actual collection URL, including its final slash.','required')+
 select('source','auth','Authentication',[['none','No authorization header'],['basic','HTTP Basic from environment'],['bearer','Bearer token from environment']],a.type)+
 field('source','usernameEnv','Username environment name',a.usernameEnv??'','text','Used only for HTTP Basic.')+
 field('source','passwordEnv','Password environment name',a.passwordEnv??'','text','Used only for HTTP Basic.')+
 field('source','tokenEnv','Bearer-token environment name',a.tokenEnv??'','text','Used only for bearer authentication.')+
 field('source','caFileEnv','Private CA file environment name',c.caFileEnv??'','text','Optional; the referenced host file supplies an additional CA bundle.')+
 '<div class="full">'+check('source','allowLocalHttp','Allow explicit HTTP for a loopback server on this host',c.allowLocalHttp)+'</div>'+
 field('source','maxFileBytes','Maximum source bytes',l.maxFileBytes,'number','Hard ceiling: 268,435,456 bytes.','min="1" max="268435456" required')+
 field('source','maxListingBytes','Maximum listing bytes',l.maxListingBytes,'number','','min="1024" max="16777216" required')+
 field('source','maxEntries','Maximum collection responses',l.maxEntries,'number','','min="1" max="20000" required')+
 field('source','timeoutMs','Request timeout (milliseconds)',l.timeoutMs,'number','','min="1000" max="120000" required')+
 field('source','maxCaptureMs','Capture deadline (milliseconds)',l.maxCaptureMs,'number','','min="1000" max="3600000" required')+
 '</div><div class="actions"><button class="primary" type="submit">Save source revision</button>'+button('Show declaration JSON','source-json')+
 '<label class="small">Load declaration <input type="file" class="file-input" id="source-import" accept=".json,application/json"></label></div></form>')+
 card('Saved source and host references',state.activeSourceId?'<dl><dt>Selected revision</dt><dd class="hash">'+esc(state.activeSourceId)+'</dd><dt>Collection</dt><dd>'+link(c.rootUrl)+'</dd></dl>'+
 table(['Environment name','Present on this host'],state.environment.map(row=>'<tr><td class="mono">'+esc(row.name)+'</td><td>'+pill(row.configured?'CONFIGURED':'MISSING')+'</td></tr>'))+
 '<div class="actions">'+fileButton('Download declaration','source',state.activeSourceId)+button('Read collection','open-files',{},true)+'</div>':empty('Save the collection declaration to begin.'))+
 (sourceJSONPreview?card('Declaration JSON',jsonDetail('Current editor declaration',sourceJSONPreview,true)):'')+
 (state.sources.length?card('Retained source revisions',table(['Saved','Collection','Identity','Action'],state.sources.slice().reverse().map(row=>'<tr><td>'+esc(when(row.createdAt))+'</td><td class="wrap">'+esc(row.rootUrl)+'</td><td class="hash">'+esc(short(row.sourceHash))+'</td><td>'+button('Load for editing','source-load',{id:row.id})+'</td></tr>'))):''));
}
function filesPage(){
 const list=listing,sourceId=listingSourceId??state.lastListing?.sourceId;
 let content=card('Read a collection','<form data-form="catalogue" data-submit="catalogue"><div class="grid">'+field('catalogue','href','Collection href',state.source?.connection.rootUrl??'','text','A full URL or href within the configured collection.')+
 select('catalogue','depth','Depth',[['1','This collection and immediate children'],['0','This resource only']],'1')+'</div><div class="actions"><button type="submit" class="primary"'+(!state.source?' disabled':'')+'>Read original listing</button>'+
 (state.lastListing?button('Reopen saved listing','listing-reopen'):'')+'</div></form>');
 if(list){
  content+=card('Retained collection response','<dl><dt>Captured</dt><dd>'+esc(when(list.capturedAt))+'</dd><dt>Href</dt><dd>'+esc(list.href)+'</dd><dt>XML</dt><dd>'+byteText(list.bytes)+' · <span class="hash">'+esc(list.sha256)+'</span></dd><dt>Responses</dt><dd>'+esc(list.total)+'</dd></dl>'+
  '<div class="actions compact">'+fileButton('Download original XML','listing',list.id,'xml',sourceId)+fileButton('Download property receipt','listing',list.id,'json',sourceId)+'</div><div class="divider"></div>'+
  (list.entries?.length?table(['Name / href','Kind','Reported bytes','ETag / property outcome','Use'],list.entries.map((row,index)=>'<tr><td class="wrap"><strong>'+esc(row.name)+'</strong><div class="mono small">'+esc(row.relativeHref??row.originalHref)+'</div></td><td>'+pill(row.kind)+'</td><td class="nowrap">'+esc(row.contentLengthText??'Unknown')+'</td><td class="wrap"><span class="mono">'+esc(row.etag??'Not supplied')+'</span>'+jsonDetail('Property statuses and issues',{propertyStatus:row.propertyStatus,issues:row.issues,fileId:row.fileId,instanceFileId:row.instanceFileId})+'</td><td>'+button(row.kind==='collection'?'Browse':'Select version',row.kind==='collection'?'browse':'select-file',{index},false,!row.accessible||!['file','collection'].includes(row.kind))+'</td></tr>')):empty('The retained response contains no entries.'))+
  '<div class="actions">'+(list.offset?button('Previous entries','listing-page',{offset:Math.max(0,list.offset-list.limit)}):'')+(Number.isInteger(list.nextOffset)?button('Next entries','listing-page',{offset:list.nextOffset}):'')+'</div>');
 }
 if(selectedFile)content+=card('Selected original file','<dl><dt>Resource</dt><dd>'+esc(selectedFile.href)+'</dd><dt>ETag</dt><dd class="mono">'+esc(selectedFile.etag??'Not supplied')+'</dd><dt>Reported size</dt><dd>'+byteText(selectedFile.contentLength)+'</dd></dl>'+
 '<form data-form="capture" data-submit="capture"><div class="grid">'+field('capture','expectedSha256','Expected SHA-256 (optional)','','text','Only enter a separately known content digest. WebDAV metadata checksums are not used as proof.','pattern="[a-f0-9]{64}"')+'</div><p class="help">A strong original ETag enables conditional range continuation. A weak or absent ETag still permits a complete bounded read; an interrupted unversioned transfer requires a fresh file selection.</p><div class="actions"><button class="primary" type="submit">Capture selected version</button>'+button('Clear selection','clear-file')+'</div></form>');
 return frame('Collection and files','Read the actual multistatus response, including individual property outcomes. File selection remains bound to that original source revision.',content);
}
function capturesPage(){
 const rows=state.captures??[];
 let content=card('Original source captures',rows.length?table(['Captured source','State','Retained bytes','Validator','Actions'],rows.map(row=>'<tr><td class="wrap"><strong>'+esc(row.selection.href.split('/').at(-1))+'</strong><div class="mono">'+esc(short(row.id))+'</div><div class="small">'+esc(when(row.createdAt))+'</div></td><td>'+pill(row.state)+(row.lastError?'<div class="small">'+esc(row.lastError.message)+'</div>':'')+'</td><td>'+byteText(row.bytes)+'</td><td class="wrap mono">'+esc(row.validator??row.selection.etag??'No strong validator')+'</td><td><div class="actions">'+button('Inspect','capture-inspect',{id:row.id})+(row.state==='COMPLETE'?button('Project','capture-project',{id:row.id}):button('Resume original','capture-resume',{id:row.id},false,row.state==='SOURCE_CHANGED'))+'</div></td></tr>')):empty('Select an original file from the collection to capture it.'));
 if(capture){
  const r=capture.receipt,p=capture.progress;
  content+=card('Capture '+short(capture.intent.id),'<dl><dt>Selected href</dt><dd>'+esc(capture.intent.selection.href)+'</dd><dt>State</dt><dd>'+pill(p?.state??'PREPARED')+'</dd><dt>Durable checkpoint</dt><dd>'+byteText(p?.checkpoint?.bytes??0)+'</dd><dt>Checkpoint hash</dt><dd class="hash">'+esc(p?.checkpoint?.sha256??'—')+'</dd><dt>Original validator</dt><dd class="mono">'+esc(p?.validator??capture.intent.selection.etag??'Not supplied')+'</dd></dl>'+
  (r?'<div class="actions">'+fileButton('Download exact source bytes','capture',capture.intent.id,'body.bin')+fileButton('Download capture receipt','capture',capture.intent.id,'receipt.json')+button('Create public projection','capture-project',{id:capture.intent.id},true)+'</div>':'<p class="help">Resume keeps this original capture ID and verifies its durable prefix before any range request. If the original source changed, choose its new version from a fresh listing.</p>')+
  jsonDetail('Original selection and transfer attempts',{intent:capture.intent,progress:capture.progress,receipt:capture.receipt}));
 }
 return frame('Captures and recovery','Downloaded bytes, the original validator and every transfer attempt remain with the same capture. Using a completed capture verifies the retained bytes before projection or download.',content);
}

function selectedCapture(){return (state.captures??[]).find(row=>row.id===selectedCaptureId)??(state.captures??[]).find(row=>row.state==='COMPLETE')??null;}
function projectionPage(){
 const chosen=selectedCapture();if(chosen)selectedCaptureId=chosen.id;
 if(!projectionRows.length&&Array.isArray(drafts.projectionGrid))projectionRows=clone(drafts.projectionGrid);
 let content=card('Read the completed source','<form data-form="sample" data-submit="sample"><div class="grid">'+
 select('sample','captureId','Completed original capture',(state.captures??[]).filter(x=>x.state==='COMPLETE').map(x=>[x.id,x.selection.href.split('/').at(-1)+' · '+short(x.sha256)]),chosen?.id??'')+
 select('sample','format','Original file format',[['csv','CSV'],['json','JSON array / selected array'],['ndjson','NDJSON (one record per line)']],sample?.format??(/\.jsonl?$/.test(chosen?.selection.href??'')?'json':'csv'))+
 field('sample','recordsPointer','JSON array pointer',sample?.recordsPointer??'','text','Empty for a root array. CSV and NDJSON use an empty pointer.')+
 field('sample','limit','Sample records',20,'number','The complete source is scanned; only this bounded sample is displayed.','min="1" max="100" required')+
 '</div><div class="actions"><button class="primary" type="submit"'+(!chosen?' disabled':'')+'>Inspect retained records</button></div></form>');
 if(sample)content+=card('Original sample','<div class="metrics"><div class="metric"><strong>'+sample.rowCount.toLocaleString()+'</strong><span>original records</span></div><div class="metric"><strong>'+sample.sampleCount+'</strong><span>displayed records</span></div><div class="metric"><strong>'+byteText(sample.bytes)+'</strong><span>retained source</span></div></div>'+
 '<p class="help">Numeric JSON tokens remain exact strings until an explicit reviewed conversion. Suggested fields start as strings unless the original value is boolean.</p>'+
 (sample.sampleLimited?'<p class="review-note">The sample reached its byte limit. Actual source ordinals remain attached to the displayed records.</p>':'')+
 jsonDetail('Source fields and observed types',sample.columns)+jsonDetail('Exact sampled records',sample.rows)+
 '<div class="actions">'+button('Use suggested public columns','projection-suggest',{},false,Boolean(projectionRows.length))+
 button('Replace columns from this sample','projection-replace',{},false,!projectionRows.length)+'</div>');
 const rows=projectionRows.map((row,index)=>'<tr><td><input class="name" aria-label="Public name '+(index+1)+'" data-column="'+index+'" data-column-field="name" value="'+esc(row.name)+'"></td><td><input class="pointer" aria-label="Source pointer '+(index+1)+'" data-column="'+index+'" data-column-field="pointer" value="'+esc(row.pointer)+'"></td><td><select aria-label="Public type '+(index+1)+'" data-column="'+index+'" data-column-field="type">'+['string','integer','number','boolean'].map(x=>option(x,x,row.type)).join('')+'</select></td><td><input type="checkbox" aria-label="Nullable column '+(index+1)+'" data-column="'+index+'" data-column-field="nullable"'+(row.nullable?' checked':'')+'></td><td><select aria-label="Missing field '+(index+1)+'" data-column="'+index+'" data-column-field="missing">'+option('error','Reject record',row.missing)+option('null','Null (nullable)',row.missing)+'</select></td><td>'+button('Remove','projection-remove',{index})+'</td></tr>');
 content+=card('Explicit public projection','<p class="help">Keep only fields intended for the public dataset. IDs and exact decimal lexemes can remain strings. A present empty string and a missing value retain different source meanings; the original CSV encoder rejects ambiguous nullable output.</p>'+
 (rows.length?table(['Public name','Original pointer','Type','Nullable','Missing field',''],rows,'projection-grid'):empty('Inspect the retained source, then choose or add public columns.'))+
 '<div class="actions">'+button('Add column','projection-add')+button('Show projection JSON','projection-json')+'</div>'+
 '<form data-form="projection" data-submit="projection"><div class="actions"><button class="primary" type="submit"'+(!sample||!projectionRows.length?' disabled':'')+'>Save reviewed field mapping</button></div></form>'+
 '<details><summary>Load an exact projection document</summary><form data-form="projection-import" data-submit="projection-import">'+area('projection-import','json','Projection JSON','',true,'format, recordsPointer and columns use the original source-projection schema.')+'<div class="actions"><button type="submit">Load into editor</button></div></form></details>');
 if(projectionJSONPreview)content+=card('Projection JSON',jsonDetail('Explicit original projection',projectionJSONPreview,true));
 if(state.mappings.length)content+=card('Saved immutable mappings',table(['Saved','Capture','Projection','Actions'],state.mappings.slice().reverse().map(row=>'<tr><td>'+esc(when(row.createdAt))+'</td><td class="hash">'+esc(short(row.captureSha256))+'</td><td>'+Object.keys(row.projection.columns).length+' public columns<div class="hash">'+esc(short(row.projectionHash))+'</div></td><td>'+button('Use for edition','mapping-select',{id:row.id})+button('Load into editor','mapping-edit',{id:row.id})+'</td></tr>')));
 return frame('Public projection','Inspect the original records, select a typed public projection, and save its exact binding to the completed capture.',content);
}
function currentMapping(){return mapping??state.mappings.at(-1)??null;}
function currentEdition(){return state.editions.find(x=>x.id===editionId)??state.editions.at(-1)??null;}
let datasetPreview=null;
function editionsPage(){
 const m=currentMapping(),edition=currentEdition(),merchant=state.merchants.find(x=>x.id===state.activeMerchantId)??state.merchants.at(-1);
 if(edition)editionId=edition.id;
 let content=card('Build a reviewed native dataset','<form data-form="edition" data-submit="edition"><div class="grid">'+
 select('edition','mappingId','Saved projection',state.mappings.map(x=>[x.id,short(x.projectionHash)+' · '+Object.keys(x.projection.columns).join(', ')]),m?.id??'')+
 field('edition','name','Public dataset name',edition?.dataset?.name??'','text','','required maxlength="128"')+
 field('edition','reviewer','Reviewer','','text','','required maxlength="160"')+
 field('edition','maxRows','Maximum original records',250000,'number','','min="1" max="1000000" required')+
 field('edition','defaultLimit','Default page records',50,'number','','min="1" max="1000" required')+
 field('edition','maxLimit','Maximum page records',250,'number','','min="1" max="1000" required')+
 area('edition','note','Review note','',false,'Describe the intended public fields and the source edition reviewed.')+
 '</div><h4>Native query capabilities</h4><p class="help">Opt in per public field. The original dataset validates its existing query and page limits.</p>'+
 (m?table(['Public field','Type','Equality filter','Range filter','Sort'],Object.entries(m.projection.columns).map(([name,column])=>'<tr><td>'+esc(name)+'</td><td>'+esc(column.type)+'</td>'+['filter','range','sort'].map(kind=>'<td><input type="checkbox" name="'+kind+'.'+esc(name)+'" aria-label="'+esc(kind+' '+name)+'"'+(value('edition',kind+'.'+name,false)?' checked':'')+(kind==='range'&&column.type==='boolean'?' disabled':'')+'></td>').join('')+'</tr>')):empty('Select a saved public mapping first.'))+
 '<p class="review-note">Approval binds the exact capture hash '+esc(short(m?.captureSha256))+' and mapping hash '+esc(short(m?.projectionHash))+'.</p><div class="actions"><button class="primary" type="submit"'+(!m?' disabled':'')+'>Approve and build edition</button></div></form>');
 if(state.editions.length)content+=card('Retained dataset editions',table(['Built','Dataset / snapshot','Rows','Exact CSV','Action'],state.editions.slice().reverse().map(row=>'<tr><td>'+esc(when(row.builtAt))+'</td><td>'+esc(row.dataset.name)+'<div class="hash">'+esc(row.dataset.snapshot)+'</div></td><td>'+row.rowCount.toLocaleString()+'</td><td>'+byteText(row.csvBytes)+'<div class="hash">'+esc(short(row.csvSha256))+'</div></td><td>'+button('Select','edition-select',{id:row.id})+'</td></tr>')));
 if(edition){
  content+=card('Selected edition: '+edition.dataset.name,'<dl><dt>Snapshot</dt><dd class="hash">'+esc(edition.dataset.snapshot)+'</dd><dt>CSV SHA-256</dt><dd class="hash">'+esc(edition.csvSha256)+'</dd></dl><div class="actions compact">'+
 ['dataset.csv','dataset.json','source.json','edition.json'].map(name=>fileButton(name,'edition',edition.id,name)).join('')+'</div><div class="divider"></div>'+
 '<form data-form="query" data-submit="query"><div class="grid">'+field('query','query','Original query string','','text','Use native parameters such as fields, limit, filter, range or sort exactly as advertised below.')+
 '</div><div class="actions"><button type="submit">Preview native page</button></div></form>'+jsonDetail('Native dataset description',edition.dataset)+(datasetPreview?jsonDetail('Original query result',datasetPreview,true):''));
  const pay=merchant?.payment??{};
  content+=card('Public merchant terms','<form data-form="merchant" data-submit="merchant"><div class="grid">'+
 field('merchant','origin','Public merchant origin',merchant?.origin??'','url','The origin used in the original seller definition.','required')+
 field('merchant','path','Dataset route',merchant?.path??'/data','text','','required')+
 field('merchant','scheme','Payment scheme',pay.scheme??'exact','text','','required')+
 field('merchant','network','Original network identifier',pay.network??'','text','Use the actual supported network identifier.','required')+
 field('merchant','asset','Original asset identifier',pay.asset??'','text','','required')+
 field('merchant','amount','Atomic amount (string)',pay.amount??'','text','Preserved exactly; never converted through floating-point currency.','required pattern="[0-9]+"')+
 field('merchant','payTo','Public pay-to address',pay.payTo??'','text','','required')+
 field('merchant','maxTimeoutSeconds','Payment timeout (seconds)',pay.maxTimeoutSeconds??300,'number','','required min="1"')+
 field('merchant','reviewer','Merchant reviewer',merchant?.reviewer??'','text','','required')+
 area('merchant','note','Merchant review note',merchant?.note??'')+
 '</div><div class="actions"><button type="submit">Save validated merchant terms</button></div></form>');
  content+=card('Export the original publisher input','<form data-form="export" data-submit="export"><div class="grid">'+
 select('export','merchantId','Retained merchant terms',state.merchants.map(x=>[x.id,x.origin+x.path+' · '+x.payment.amount+' atomic']),merchant?.id??'')+
 field('export','reviewer','Export reviewer','','text','','required')+
 area('export','note','Export note','',false)+'</div><p class="help">The export contains exact dataset.csv, dataset.json, source.json and the original compiled seller.json beside its manifest.</p><div class="actions"><button type="submit" class="primary"'+(!merchant?' disabled':'')+'>Create reviewed merchant export</button></div></form>');
 }
 if(state.exports.length)content+=card('Complete merchant exports',table(['Created','Native snapshot','Files','Action'],state.exports.slice().reverse().map(row=>'<tr><td>'+esc(when(row.createdAt))+'</td><td class="hash">'+esc(row.snapshot)+'</td><td>'+row.files.map(file=>fileButton(file.path,'export',row.id,file.path)).join(' ')+'</td><td>'+button('Prepare original publisher','prepare-export',{id:row.id},true)+'</td></tr>')));
 return frame('Dataset and merchant','Build an immutable edition through the original dataset loader, inspect its actual query result, and export its validated public merchant definition.',content);
}

const PUBLISHER_ACTIONS = {
 'publisher.status':['Read original target status',{}],
 'publisher.preview':['Preview a draft or retained version',{target:'',query:''}],
 'publisher.reviewDraft':['Review candidate against the displayed target',{draftId:'',expectedSnapshot:'',expectedRevision:1}],
 'publisher.publish':['Publish reviewed candidate to the existing dataset',{draftId:'',expectedSnapshot:'',expectedRevision:1}],
 'publisher.activateSnapshot':['Select a retained original dataset version',{snapshot:'',expectedSnapshot:'',expectedRevision:1}],
 'publisher.collect':['Collect expired original versions',{}],
 'publisher.release.stage':['Stage an original SF82 dataset release',{draftId:'',id:'',label:'',runtime:{port:0}}],
 'publisher.release.inspect':['Inspect the retained SF82 release',{id:''}],
 'publisher.release.activate':['Activate the reviewed SF82 selection',{id:'',expectedGeneration:0}],
 'publisher.release.rollback':['Select the original previous release',{expectedGeneration:0}],
 'publisher.release.start':['Start this process’s original selected seller',{expectedGeneration:0}],
 'publisher.release.stop':['Drain only this process’s original seller',{}],
 'publisher.buyer.review':['Read the actual seller offer and query',{snapshot:'',query:''}],
 'publisher.buyer.prepare':['Prepare the exact reviewed original buyer request',{review:{},intentId:'',acceptIndex:0,offerSha256:''}],
 'publisher.buyer.session':['Bind the original buyer to an existing operator workspace',{buyerId:'',workspaceDirectory:'',maxPages:1,maxTotalAtomic:'',maxRows:1000000,maxPageBytes:1048576}],
 'publisher.buyer.run':['Run the explicit original dataset acquisition',{id:''}],
 'publisher.buyer.recover':['Recover the existing original acquisition',{id:''}],
 'publisher.buyer.account':['Account the existing original acquisition',{id:''}],
 'publisher.buyer.export':['Export the original acquired result and manifest',{id:''}],
};
let buyerOffer=null;
function originalDefaults(action,chosenId){
 const defaults=clone(PUBLISHER_ACTIONS[action]?.[1]??{});
 const draft=publisher?.drafts?.candidates?.find(x=>x.id===chosenId)??publisher?.drafts?.candidates?.at(-1);
 const release=publisher?.releases?.releases?.find(x=>x.id===chosenId)??publisher?.releases?.releases?.[0];
 const versions=publisher?.target?.versions, selection=publisher?.releases?.state;
 if(Object.hasOwn(defaults,'draftId'))defaults.draftId=draft?.id??'';
 if(Object.hasOwn(defaults,'expectedSnapshot'))defaults.expectedSnapshot=versions?.current??'';
 if(Object.hasOwn(defaults,'expectedRevision'))defaults.expectedRevision=versions?.revision??1;
 if(Object.hasOwn(defaults,'expectedGeneration'))defaults.expectedGeneration=selection?.generation??0;
 if(Object.hasOwn(defaults,'snapshot'))defaults.snapshot=chosenId??versions?.current??'';
 if(action==='publisher.preview')defaults.target=draft?'draft:'+draft.id:versions?.current??'';
 if(action==='publisher.release.stage'){defaults.id='webdav-'+short(draft?.dataset?.snapshot??uuid());defaults.label=draft?.dataset?.name??'WebDAV dataset';}
 if(['publisher.release.inspect','publisher.release.activate'].includes(action))defaults.id=release?.id??'';
 if(action==='publisher.buyer.prepare'&&buyerOffer){defaults.review=buyerOffer;defaults.intentId=uuid();defaults.offerSha256=buyerOffer.offerSha256;}
 if(action==='publisher.buyer.session')defaults.buyerId=chosenId??publisher?.drafts?.buyers?.at(-1)?.id??'';
 if(['publisher.buyer.run','publisher.buyer.recover','publisher.buyer.account','publisher.buyer.export'].includes(action))defaults.id=chosenId??publisher?.sessions?.at(-1)?.id??'';
 return defaults;
}
function setPublisherAction(action,chosenId){
 const previous=drafts['publisher-command'];
 if(previous){drafts.publisherInputs??={};drafts.publisherInputs[previous.action??publisherAction]=previous.input;}
 publisherAction=action;drafts['publisher-command']={action,input:pretty(originalDefaults(action,chosenId)),reviewed:false};remember();
}
function publisherPage(){
 const selected=state.products.find(x=>x.id===productId)??state.products.find(x=>x.id===state.activeProductId)??state.products.at(-1);
 if(selected)productId=selected.id;
 let content=card('Prepare the same original publisher','<form data-form="prepare" data-submit="prepare"><div class="grid">'+
 select('prepare','exportId','Reviewed merchant export',state.exports.map(x=>[x.id,short(x.snapshot)+' · '+when(x.createdAt)]),state.exports.at(-1)?.id??'')+
 select('prepare','productId','Merchant product',[['','Create a new product'],...state.products.map(x=>[x.id,x.title+' · '+short(x.id)])],selected?.id??'')+
 field('prepare','title','Product title',selected?.title??'','text','A new edition can be prepared into the same existing product.','required maxlength="128"')+
 '</div><div class="actions"><button type="submit" class="primary"'+(!state.exports.length?' disabled':'')+'>Prepare original publisher</button></div></form>');
 if(selected)content+=card('Select a retained product','<div class="grid"><div class="field"><label for="product-selector">Retained merchant product</label><select id="product-selector">'+state.products.map(x=>option(x.id,x.title+' · '+short(x.id),selected.id)).join('')+'</select></div></div><div class="actions">'+button('Read original publisher state','publisher-state',{},true)+'</div><p class="help">Portable source import retains the product reference. Prepare a retained merchant export at this host before using its publisher.</p>');
 if(publisher&&publisher.prepared!==false){
  const target=publisher.target, releases=publisher.releases, candidates=publisher.drafts?.candidates??[], buyers=publisher.drafts?.buyers??[];
  content+=card('Original dataset and release','<div class="metrics"><div class="metric"><strong>'+esc(target?.versions?.revision??'—')+'</strong><span>native dataset revision</span></div><div class="metric"><strong>'+esc(releases?.state?.generation??0)+'</strong><span>SF82 selection generation</span></div><div class="metric"><strong>'+esc(releases?.runtime?.state??'STOPPED')+'</strong><span>original seller</span></div></div>'+
  '<dl><dt>Current snapshot</dt><dd class="hash">'+esc(target?.versions?.current??'Not initialized')+'</dd><dt>Active release</dt><dd>'+esc(releases?.state?.active??'None')+'</dd><dt>Actual listener</dt><dd>'+link(releases?.runtime?.observed?.listener??'Not running')+'</dd></dl>'+
  '<p class="help">Stage a retained candidate, activate the displayed selection, then start the original seller. Later publication retains the existing dataset version store and original buyer identities.</p>'+
  '<div class="actions">'+button('Stage candidate…','publisher-command',{command:'publisher.release.stage'},false,!candidates.length)+button('Activate release…','publisher-command',{command:'publisher.release.activate'},false,!releases?.releases?.length)+
  button('Start selected seller…','publisher-command',{command:'publisher.release.start'},false,!releases?.state?.active)+button('Drain owned seller…','publisher-command',{command:'publisher.release.stop'},false,!publisher.ownsRelease)+button('Rollback selection…','publisher-command',{command:'publisher.release.rollback'},false,!releases?.state?.previous)+'</div>'+
  jsonDetail('Original retained dataset / release status',{target,releases}));
  if(candidates.length)content+=card('Original publisher candidates',table(['Candidate','Native snapshot','Review binding','Actions'],candidates.map(row=>'<tr><td>'+esc(row.label??row.name??row.dataset?.name??short(row.id))+'<div class="mono">'+esc(row.id)+'</div></td><td class="hash">'+esc(row.dataset?.snapshot)+'</td><td>'+esc(row.expectedRevision??'—')+'<div class="hash">'+esc(short(row.expectedSnapshot))+'</div></td><td><div class="actions">'+button('Preview…','publisher-command',{command:'publisher.preview',id:row.id})+button('Review…','publisher-command',{command:'publisher.reviewDraft',id:row.id})+button('Publish…','publisher-command',{command:'publisher.publish',id:row.id},false,!target?.connected)+button('CSV','publisher-file',{kind:'draft-csv',id:row.id})+button('Review file','publisher-file',{kind:'draft-review',id:row.id})+'</div></td></tr>')));
  content+=card('Customer offer and retained request','<p class="help">Read the actual seller’s offer for a published snapshot and query. Prepare its exact original buyer request, then bind an existing original operator workspace and explicit acquisition limits. Payment approval and recovery remain with that original operator.</p>'+
  '<div class="actions">'+button('Read actual offer…','publisher-command',{command:'publisher.buyer.review'},false,!target?.connected)+button('Prepare reviewed request…','publisher-command',{command:'publisher.buyer.prepare'},false,!buyerOffer)+'</div>'+
  (buyerOffer?jsonDetail('Actual current seller offer',buyerOffer):'')+
  (buyers.length?table(['Original buyer','Snapshot','Actions'],buyers.map(row=>'<tr><td class="mono">'+esc(row.id)+'</td><td class="hash">'+esc(row.snapshot)+'</td><td><div class="actions">'+button('Download request','publisher-file',{kind:'buyer-config',id:row.id})+button('Bind operator workspace…','publisher-command',{command:'publisher.buyer.session',id:row.id})+'</div></td></tr>')):''));
  if(publisher.sessions?.length)content+=card('Original customer acquisitions',table(['Session','Original operator binding','State / retained result','Actions'],publisher.sessions.map(row=>'<tr><td class="mono">'+esc(row.id)+'</td><td class="wrap mono">'+esc(row.binding?.workspaceDirectory??'')+'</td><td class="wrap">'+jsonDetail('Original session report',row.report??row.error)+'</td><td><div class="actions">'+['run','recover','account','export'].map(action=>button(action[0].toUpperCase()+action.slice(1)+'…','publisher-command',{command:'publisher.buyer.'+action,id:row.id})).join('')+button('Manifest','publisher-file',{kind:'session-manifest',id:row.id})+'</div></td></tr>')));
  const action=value('publisher-command','action',publisherAction);
  content+=card('Review one original publisher command','<form data-form="publisher-command" data-submit="publisher-command"><div class="grid">'+
  select('publisher-command','action','Original command',Object.entries(PUBLISHER_ACTIONS).map(([name,[label]])=>[name,label+' · '+name]),action)+
  '<div class="field"><span class="label">Current original target</span><span class="small">Dataset revision '+esc(target?.versions?.revision??'—')+' · release generation '+esc(releases?.state?.generation??0)+'</span></div>'+
  area('publisher-command','input','Exact original parameters',pretty(originalDefaults(action)),true,'Atomic limits are JSON strings. Review the current snapshot, selection generation and original buyer identity in these exact parameters.')+
  '<div class="full">'+check('publisher-command','reviewed','I reviewed this one command and its original identities / limits',false)+'</div></div><div class="actions"><button type="submit" class="primary">Run this explicit command</button>'+
  button('Load current native bindings','publisher-prefill')+'</div></form><p class="help">No automatic payment, polling retry or new ledger is added. If a native command loses its response, inspect its retained state and use the original recovery command.</p>'+
  (nativeResult?jsonDetail('Last original command result',nativeResult,true):''));
 }else if(publisher?.prepared===false)content+=empty('This retained product has not been prepared at the current host. Select its merchant export above to create its original native publisher.');
 return frame('Publisher and customer','Use the maintained dataset publisher, SF82 release manager and SF88 customer acquisition through their unchanged native actions.',content);
}
function handoffPage(){
 const packets=(state.operations??[]).filter(x=>x.action==='source.packet'&&x.status==='COMPLETE');
 let content=card('Portable source handoff','<p>The packet contains exact collection XML and property receipts, captured complete or partial files, saved projections, dataset editions and merchant exports. Each file is checked against the packet’s declared size and SHA-256 when imported.</p>'+
 '<p class="help">Original publisher, running release, buyer workspace, key and ledger directories remain in the original host backup. A recipient prepares one of the retained four-file merchant exports through that same publisher at the new host.</p>'+
 '<div class="actions">'+button('Create source packet','source-packet',{},true)+button('Read full operator guide','handbook')+'</div>'+
 (packets.length?table(['Created','Original operation','Download'],packets.map(row=>'<tr><td>'+esc(when(row.completedAt))+'</td><td class="mono">'+esc(row.id)+'</td><td>'+fileButton('Download source packet','packet',row.id)+'</td></tr>')):'')+
 '<h4>Fresh recipient workspace</h4><pre>node cli.mjs inspect-source --input /absolute/source-packet.zip\nnode cli.mjs import-source --input /absolute/source-packet.zip --directory /absolute/new-private-workspace\nnode cli.mjs serve --directory /absolute/new-private-workspace --port 0</pre>'+
 '<p class="help">Both input and destination are explicit operator paths. Restore creates a new directory; the original workspace and any incomplete destination are retained.</p>'+
 (state.sourcePacket?jsonDetail('Original imported source packet',state.sourcePacket):''));
 content+=card('Operation history','<p class="help">Read the original operation before continuing a lost response. Completed replay reopens its retained result. A failed native mutation stays with its original publisher recovery.</p>'+
 ((state.operations??[]).length?'<div class="history-list">'+table(['Recorded','Action','State','Original ID','Readback'],state.operations.map(row=>'<tr><td>'+esc(when(row.createdAt))+'</td><td>'+esc(row.action)+'</td><td>'+pill(row.status)+'</td><td class="mono">'+esc(short(row.id))+'</td><td>'+button('Read original','operation',{id:row.id})+'</td></tr>'))+'</div>':empty('The workspace has no operations yet.')));
 if(recovered){
  const operation=recovered.operation, original=intents[operation.id], sourceDecision=!operation.action.startsWith('publisher.'),
   sourceResume=['capture.start','capture.resume','source.packet','source.catalogue','capture.sample'].includes(operation.action),
   unrecorded=operation.status==='NOT_RECORDED', stale=['NOT_RECORDED_STALE','REVIEW_REQUIRED'].includes(operation.status);
  content+=card('Original operation '+short(operation.id),'<dl><dt>Action</dt><dd>'+esc(operation.action)+'</dd><dt>Status</dt><dd>'+pill(operation.status)+'</dd><dt>Original ID</dt><dd class="mono">'+esc(operation.id)+'</dd><dt>Active process</dt><dd>'+esc(recovered.active?'Owned and running':'No active execution in this service')+'</dd></dl>'+
  jsonDetail('Original recorded intent',operation,true)+jsonDetail('Retained native result',recovered.result)+(recovered.review?jsonDetail('Saved revision to review',recovered.review,true):'')+
  '<div class="actions">'+(sourceDecision&&operation.status!=='FAILED'&&!stale&&!recovered.active?button(operation.status==='COMPLETE'?'Reopen completed result':'Resume original intent','operation-resume',{id:operation.id},true):'')+
  (stale&&sourceDecision?button('Use reviewed revision '+recovered.review?.currentRevision+' with original ID','operation-rebase',{id:operation.id},true):'')+
  (operation.action.startsWith('publisher.')?button('Inspect original publisher','goto',{view:'publisher'}):'')+
  (original&&operation.status==='COMPLETE'?button('Dismiss completed browser intent','intent-dismiss',{id:operation.id}):'')+'</div>');
 }
 if(lastResult)content+=card('Latest completed workspace result',jsonDetail('Original result',lastResult,true));
 return frame('Handoff and history','Export the retained source product, reopen its exact operation results, and carry the complete source workflow to a fresh recipient workspace.',content);
}
function render(){
 if(!state)return;
 ++renderGeneration;
 const views={source:sourcePage,files:filesPage,captures:capturesPage,projection:projectionPage,editions:editionsPage,publisher:publisherPage,handoff:handoffPage};
 if(!views[view])view='source';
 $('#main').innerHTML=views[view]();
 for(const item of $$('nav button'))item.setAttribute('aria-current',item.dataset.view===view?'page':'false');
 $('#connection').textContent='Saved revision '+state.revision+(busy?' · operation in progress':'');
 $('#identity').textContent='Workspace '+state.id+' · '+state.directory;
 renderNotices();if(busy)controls(true);
}

let sourceJSONPreview=null, projectionJSONPreview=null;
function sourceFromForm(form){
 const r=readForm(form),auth={type:r.auth};
 if(r.auth==='basic'){auth.usernameEnv=r.usernameEnv;auth.passwordEnv=r.passwordEnv;}
 if(r.auth==='bearer')auth.tokenEnv=r.tokenEnv;
 return {schema:'stellar-forge.webdav-source.v1',connection:{rootUrl:r.rootUrl,auth,allowLocalHttp:r.allowLocalHttp,
 ...(r.caFileEnv?{caFileEnv:r.caFileEnv}:{})},limits:Object.fromEntries(['maxFileBytes','maxListingBytes','maxEntries','timeoutMs','maxCaptureMs'].map(name=>[name,Number(r[name])]))};
}
function loadSource(source){
 if(source?.schema!=='stellar-forge.webdav-source.v1'||!source.connection)throw new Error('Choose a complete original WebDAV source declaration.');
 const c=source.connection,limits={maxListingBytes:4194304,maxEntries:10000,maxFileBytes:67108864,timeoutMs:30000,maxCaptureMs:600000,...(source.limits??{})};
 drafts.source={rootUrl:c.rootUrl,auth:c.auth?.type??'none',usernameEnv:c.auth?.usernameEnv??'',passwordEnv:c.auth?.passwordEnv??'',tokenEnv:c.auth?.tokenEnv??'',caFileEnv:c.caFileEnv??'',allowLocalHttp:c.allowLocalHttp??false,...limits};
 sourceJSONPreview=source;remember();view='source';
}
function gridProjection(){
 if(!sample)throw new Error('Inspect the selected completed capture first.');
 const columns={};
 for(const row of projectionRows){
  if(!row.name||Object.hasOwn(columns,row.name))throw new Error('Public column names must be nonempty and unique.');
  if(['__proto__','constructor','prototype'].includes(row.name))throw new Error('Choose an ordinary public column name.');
  columns[row.name]={pointer:row.pointer,type:row.type,nullable:Boolean(row.nullable),missing:row.missing};
 }
 return {format:sample.format,recordsPointer:sample.recordsPointer,columns};
}
function loadProjection(projection){
 if(!projection||!['csv','json','ndjson'].includes(projection.format)||typeof projection.recordsPointer!=='string'||!projection.columns||Array.isArray(projection.columns))throw new Error('Choose the original format, recordsPointer and columns object.');
 const entries=Object.entries(projection.columns);if(!entries.length||entries.length>64)throw new Error('Select between one and 64 public columns.');
 projectionRows=entries.map(([name,column])=>({name,pointer:column.pointer,type:column.type,nullable:column.nullable??false,missing:column.missing??'error'}));
 drafts.projectionGrid=clone(projectionRows);drafts.sample={...(drafts.sample??{}),format:projection.format,recordsPointer:projection.recordsPointer};remember();projectionJSONPreview=projection;
}
async function loadListing(id,sourceId,offset=0){
 const result=await request('/api/listing?'+new URLSearchParams({id,sourceId,offset:String(offset),limit:'200'}));
 listing=result;listingSourceId=sourceId;return result;
}
async function originalPublisher(){
 if(!productId)throw new Error('Select a prepared original product.');
 publisher=await request('/api/publisher?'+new URLSearchParams({id:productId}));
 return publisher;
}
async function readOperation(id){
 let result;
 try{result=await request('/api/operation?'+new URLSearchParams({id}));}
 catch(error){
  if(error.status!==404||!intents[id])throw error;
  accept(await request('/api/state'));
  const retained=intents[id],stale=retained.status==='NOT_RECORDED_STALE';
  recovered={operation:{...retained,id,status:stale?'NOT_RECORDED_STALE':'NOT_RECORDED',reservedRevision:null},result:null,active:false,
   ...(stale?{review:{originalExpectedRevision:retained.expectedRevision,currentRevision:state.revision,saved:revisionContext(state)}}:{})};
  view='handoff';message('The original ID has no saved operation at this service. Its local input remains available for explicit review and retry.');return;
 }
 accept(result.state);recovered=result;view='handoff';
 if(intents[id]){intents[id].status=result.operation.status;remember();}
 if(result.operation.action==='capture.sample'&&result.operation.status==='COMPLETE')sample=result.result;
 if(result.operation.status==='COMPLETE')message('Reopened the original completed result; no native action was repeated.');
}
async function submit(form){
 const name=form.dataset.submit,r=readForm(form);saveDraft(form);
 if(name==='source'){
  const result=await mutate('source.save',{source:sourceFromForm(form)});clearDraft('source');
  listing=null;listingSourceId=null;selectedFile=null;sourceJSONPreview=null;
  message('Saved source revision '+short(result.id)+'. Existing captures remain bound to their original source.');
 }else if(name==='catalogue'){
  const sourceId=state.activeSourceId;
  listing=await mutate('source.catalogue',{href:r.href,depth:Number(r.depth),limit:200,offset:0});listingSourceId=sourceId;selectedFile=null;
  clearDraft('catalogue');drafts.catalogue={href:listing.href,depth:String(listing.depth)};remember();
  message('Retained the original XML and all '+listing.total+' property responses.');
 }else if(name==='capture'){
  if(!selectedFile)throw new Error('Select an original file version.');
  const currentSource=state.sources.find(x=>x.id===state.activeSourceId), selectedSource=state.sources.find(x=>x.id===selectedFile.sourceId);
  if(currentSource?.sourceHash!==selectedSource?.sourceHash)throw new Error('The active source changed. Load the original source revision or read a fresh current listing before capture.');
  const selection={id:uuid(),href:selectedFile.href,etag:selectedFile.etag,contentLength:selectedFile.contentLength,lastModified:selectedFile.lastModified};
  if(r.expectedSha256)selection.expectedSha256=r.expectedSha256;
  const result=await mutate('capture.start',{selection});clearDraft('capture');selectedCaptureId=result.id;
  capture=await request('/api/capture?'+new URLSearchParams({id:result.id}));view='captures';
  message('Captured '+byteText(result.bytes)+' as '+short(result.sha256)+'.');
 }else if(name==='sample'){
  sample=await mutate('capture.sample',{captureId:r.captureId,format:r.format,recordsPointer:r.recordsPointer,limit:Number(r.limit)});
  selectedCaptureId=sample.captureId;message('Inspected '+sample.rowCount.toLocaleString()+' retained records. Choose the public fields and types below.');
 }else if(name==='projection'){
  const projection=gridProjection();
  mapping=await mutate('mapping.save',{captureId:sample.captureId,expectedCaptureSha256:sample.captureSha256,projection});
  clearDraft('projection');drafts.edition={...(drafts.edition??{}),mappingId:mapping.id};remember();view='editions';
  message('Saved the exact public projection and capture binding.');
 }else if(name==='projection-import'){
  const projection=JSON.parse(r.json);loadProjection(projection);sample=null;
  message('Loaded the exact projection. Inspect the selected source with its declared format before saving this mapping.');
 }else if(name==='edition'){
  const selected=state.mappings.find(x=>x.id===r.mappingId);if(!selected)throw new Error('Select a saved projection.');
  const columns=Object.keys(selected.projection.columns);
  const dataset={name:r.name,filters:columns.filter(x=>r['filter.'+x]),ranges:columns.filter(x=>r['range.'+x]),sorts:columns.filter(x=>r['sort.'+x]),
   maxRows:Number(r.maxRows),defaultLimit:Number(r.defaultLimit),maxLimit:Number(r.maxLimit)};
  const result=await mutate('edition.build',{mappingId:selected.id,dataset,review:{reviewer:r.reviewer,decision:'approve',note:r.note,
   expectedCaptureSha256:selected.captureSha256,projectionHash:selected.projectionHash}});
  editionId=result.id;datasetPreview=null;clearDraft('edition');
  message('Built '+result.rowCount.toLocaleString()+' native dataset rows at snapshot '+short(result.dataset.snapshot)+'.');
 }else if(name==='query'){
  const selected=currentEdition();if(!selected)throw new Error('Select a retained native dataset.');
  datasetPreview=await request('/api/preview',{method:'POST',body:{editionId:selected.id,query:r.query}});
  message('Read the original dataset query result.');
 }else if(name==='merchant'){
  const selected=currentEdition();if(!selected)throw new Error('Select a dataset edition.');
  const payment={scheme:r.scheme,network:r.network,asset:r.asset,amount:r.amount,payTo:r.payTo,maxTimeoutSeconds:Number(r.maxTimeoutSeconds)};
  await mutate('merchant.save',{editionId:selected.id,origin:r.origin,path:r.path,payment,reviewer:r.reviewer,note:r.note});
  clearDraft('merchant');message('Saved the validated original public merchant terms.');
 }else if(name==='export'){
  const selected=currentEdition();if(!selected)throw new Error('Select a dataset edition.');
  const result=await mutate('edition.export',{editionId:selected.id,merchantId:r.merchantId,reviewer:r.reviewer,note:r.note});
  clearDraft('export');drafts.prepare={...(drafts.prepare??{}),exportId:result.id};remember();
  message('Created the complete four-file original publisher input.');
 }else if(name==='prepare'){
  const input={exportId:r.exportId,title:r.title};if(r.productId)input.productId=r.productId;
  const result=await mutate('publisher.prepare',input);productId=result.productId;publisher=result.state;nativeResult={action:'publisher.prepare',result:result.result};
  buyerOffer=null;clearDraft('prepare');message('Prepared the retained export through the original publisher.');
 }else if(name==='publisher-command'){
  if(!r.reviewed)throw new Error('Review this one original command and its exact parameters first.');
  if(!Object.hasOwn(PUBLISHER_ACTIONS,r.action))throw new Error('Select an original publisher command.');
  const input=JSON.parse(r.input);
  const result=await mutate('publisher.act',{productId,action:r.action,input});
  publisher=result.state;nativeResult={action:r.action,result:result.result};
  if(r.action==='publisher.buyer.review')buyerOffer=result.result;
  drafts['publisher-command']={...r,reviewed:false};remember();
  message('Original command returned: '+r.action+'. Its complete result and identities are retained.');
 }
}
async function action(buttonElement){
 const {action:a}=buttonElement.dataset,d=buttonElement.dataset;
 if(a==='dismiss'){notice=null;renderNotices();return;}
 if(a==='goto'){for(const form of $$('form[data-form]'))saveDraft(form);view=d.view;render();$('#main').focus();return;}
 if(a==='cancel'){
  try{const result=await request('/api/cancel',{method:'POST',body:{operationId:d.id}});accept(result.state);message(result.cancelling?'Pause requested for the same source read. Its durable checkpoint will be retained.':'This original operation is no longer active.');}
  catch(error){message(error.message,'error');}return;
 }
 await work(async()=>{
  if(a==='file')return download(filePath(d.kind,d.id,d.name||null,d.source||null),d.kind==='packet'?'webdav-source-packet.zip':d.name||'webdav-source.json');
  if(a==='source-json'){sourceJSONPreview=sourceFromForm($('form[data-form="source"]'));return;}
  if(a==='source-load'){loadSource(await request(filePath('source',d.id)));message('Loaded the retained declaration for editing. Save to select it as a new revision.');return;}
  if(a==='open-files'){view='files';return;}
  if(a==='listing-reopen'){if(state.lastListing)await loadListing(state.lastListing.id,state.lastListing.sourceId);return;}
  if(a==='listing-page'){await loadListing(listing.id,listingSourceId,Number(d.offset));return;}
  if(a==='browse'){
   const entry=listing.entries[Number(d.index)];const sourceId=state.activeSourceId;
   const configured=state.sources.find(x=>x.id===sourceId),prior=state.sources.find(x=>x.id===listingSourceId);
   if(configured?.sourceHash!==prior?.sourceHash)throw new Error('Load the original source declaration before browsing its retained collection.');
   listing=await mutate('source.catalogue',{href:entry.href,depth:1,limit:200,offset:0});listingSourceId=sourceId;
   drafts.catalogue={href:entry.href,depth:'1'};selectedFile=null;remember();return;
  }
  if(a==='select-file'){selectedFile={...clone(listing.entries[Number(d.index)]),sourceId:listingSourceId};clearDraft('capture');message('Selected the original reported version. Review its validator below before capture.');return;}
  if(a==='clear-file'){selectedFile=null;return;}
  if(a==='capture-inspect'){capture=await request('/api/capture?'+new URLSearchParams({id:d.id}));selectedCaptureId=d.id;return;}
  if(a==='capture-project'){selectedCaptureId=d.id;sample=null;drafts.sample={...(drafts.sample??{}),captureId:d.id};remember();view='projection';return;}
  if(a==='capture-resume'){
   const result=await mutate('capture.resume',{captureId:d.id});capture=await request('/api/capture?'+new URLSearchParams({id:d.id}));
   message('Reopened or completed the original capture: '+byteText(result.bytes)+'.');return;
  }
  if(a==='projection-suggest'||a==='projection-replace'){
   if(!sample)throw new Error('Inspect the original source first.');
   loadProjection({format:sample.format,recordsPointer:sample.recordsPointer,columns:sample.suggestedColumns});return;
  }
  if(a==='projection-add'){if(projectionRows.length>=64)throw new Error('The original dataset supports at most 64 exposed fields.');projectionRows.push({name:'',pointer:'',type:'string',nullable:false,missing:'error'});drafts.projectionGrid=clone(projectionRows);remember();return;}
  if(a==='projection-remove'){projectionRows.splice(Number(d.index),1);drafts.projectionGrid=clone(projectionRows);remember();return;}
  if(a==='projection-json'){projectionJSONPreview=gridProjection();return;}
  if(a==='mapping-select'){mapping=await request('/api/mapping?'+new URLSearchParams({id:d.id}));drafts.edition={...(drafts.edition??{}),mappingId:d.id};remember();view='editions';return;}
  if(a==='mapping-edit'){
   mapping=await request('/api/mapping?'+new URLSearchParams({id:d.id}));selectedCaptureId=mapping.captureId;loadProjection(mapping.projection);
   drafts.sample={...(drafts.sample??{}),captureId:mapping.captureId};sample=null;remember();view='projection';
   message('Loaded the original saved mapping. Inspect its completed capture to display the records.');return;
  }
  if(a==='edition-select'){editionId=d.id;datasetPreview=null;message('Selected the original edition '+short(d.id)+'.');return;}
  if(a==='prepare-export'){drafts.prepare={...(drafts.prepare??{}),exportId:d.id};remember();view='publisher';return;}
  if(a==='publisher-state'){await originalPublisher();message('Read the existing native publisher and release state.');return;}
  if(a==='publisher-command'){setPublisherAction(d.command,d.id);return;}
  if(a==='publisher-prefill'){const selected=$('#publisher-command-action').value;setPublisherAction(selected);return;}
  if(a==='publisher-file')return download('/api/publisher-file?'+new URLSearchParams({productId,kind:d.kind,id:d.id}),d.kind==='draft-csv'?'dataset.csv':d.kind+'.json');
  if(a==='source-packet'){const result=await mutate('source.packet',{});message('Created the exact portable source packet: '+byteText(result.bytes)+' across '+result.files+' files.');return;}
  if(a==='handbook'){const response=await request('/api/handbook',{raw:true});lastResult={operatorGuide:await response.text()};return;}
  if(a==='operation'){await readOperation(d.id);return;}
  if(a==='operation-resume'){
   if(!recovered||recovered.operation.id!==d.id)throw new Error('Read the original operation first.');
   const op=recovered.operation;
   if(op.action.startsWith('publisher.'))throw new Error('Inspect the existing native publisher and choose its original recovery command.');
   const intent={workspaceId:state.id,action:op.action,input:op.input,operationId:op.id,
    expectedRevision:op.expectedRevision??op.reservedRevision-1,createdAt:op.createdAt};
   await mutate(op.action,op.input,intent);await readOperation(op.id);return;
  }
  if(a==='operation-rebase'){
   if(!recovered||recovered.operation.id!==d.id||!['NOT_RECORDED_STALE','REVIEW_REQUIRED'].includes(recovered.operation.status)||recovered.operation.action.startsWith('publisher.'))
    throw new Error('Read the original source decision and review its actual stale revision first.');
   const saved=clone(recovered),reviewedRevision=saved.review.currentRevision;
   try{
    const actual=await request('/api/operation?'+new URLSearchParams({id:d.id}));
    accept(actual.state);
    if(saved.operation.status==='REVIEW_REQUIRED'&&!actual.active&&actual.operation.status==='RUNNING'){
     if(state.revision!==reviewedRevision){recovered={...saved,review:{...saved.review,currentRevision:state.revision,saved:revisionContext(state)}};throw new Error('The saved revision changed again. Review its current state before continuing.');}
     await mutate(actual.operation.action,actual.operation.input,{workspaceId:state.id,action:actual.operation.action,input:actual.operation.input,
      operationId:d.id,expectedRevision:reviewedRevision,createdAt:actual.operation.createdAt});
     await readOperation(d.id);return;
    }
    recovered=actual;
    if(intents[d.id]){intents[d.id].status=actual.operation.status;remember();}
    message('The original operation was found. Its recorded state is shown; a second intent was not submitted.');return;
   }catch(error){if(error.status!==404)throw error;}
   const current=await request('/api/state');accept(current);
   if(state.revision!==reviewedRevision){
    recovered={...saved,review:{...saved.review,currentRevision:state.revision,saved:revisionContext(state)}};
    throw new Error('The saved revision changed again. Review the newly displayed state before continuing the original ID.');
   }
   const op=saved.operation,intent={workspaceId:state.id,action:op.action,input:op.input,operationId:op.id,
    expectedRevision:reviewedRevision,createdAt:op.createdAt};
   await mutate(op.action,op.input,intent);await readOperation(op.id);return;
  }
  if(a==='intent-dismiss'){if(intents[d.id]?.status==='COMPLETE'){delete intents[d.id];remember();}return;}
 });
}
document.addEventListener('click',event=>{
 const target=event.target.closest('button');
 if(!target)return;
 if(target.dataset.view){
  if(busy)return;for(const form of $$('form[data-form]'))saveDraft(form);
  view=target.dataset.view;render();$('#main').focus();return;
 }
 if(target.dataset.action){event.preventDefault();if(!busy||target.dataset.action==='cancel')void action(target);}
});
document.addEventListener('submit',event=>{
 const form=event.target;if(!form.dataset.submit)return;
 event.preventDefault();void work(()=>submit(form));
});
document.addEventListener('input',event=>{
 const element=event.target;
 if(element.dataset.column!==undefined){
  const row=projectionRows[Number(element.dataset.column)];
  if(row){row[element.dataset.columnField]=element.type==='checkbox'?element.checked:element.value;drafts.projectionGrid=clone(projectionRows);remember();}
 }else saveDraft(element.closest('form[data-form]'));
});
document.addEventListener('change',event=>{
 const element=event.target;
 if(element.dataset.column!==undefined){const row=projectionRows[Number(element.dataset.column)];if(row){row[element.dataset.columnField]=element.type==='checkbox'?element.checked:element.value;drafts.projectionGrid=clone(projectionRows);remember();}return;}
 if(element.id==='source-import'){
  const selected=element.files?.[0];if(!selected)return;
  void work(async()=>{if(selected.size>1048576)throw new Error('A source declaration is limited to one MiB.');const content=new TextDecoder('utf-8',{fatal:true}).decode(await selected.arrayBuffer());loadSource(JSON.parse(content));message('Loaded the declaration into the editor. Save it to select this source.');});return;
 }
 if(element.id==='product-selector'){const selected=element.value;void work(async()=>{productId=selected;publisher=null;nativeResult=null;buyerOffer=null;clearDraft('publisher-command');await originalPublisher();});return;}
 if(element.id==='publisher-command-action'){
  const action=element.value,old=publisherAction;
  const input=$('#publisher-command-input').value;
  drafts.publisherInputs??={};drafts.publisherInputs[old]=input;
  publisherAction=action;drafts['publisher-command']={action,input:drafts.publisherInputs[action]??pretty(originalDefaults(action)),reviewed:false};remember();render();return;
 }
 if(element.id==='edition-mappingId'){const selected=element.value;void work(async()=>{mapping=await request('/api/mapping?'+new URLSearchParams({id:selected}));drafts.edition={...(drafts.edition??{}),mappingId:selected};remember();});return;}
 saveDraft(element.closest('form[data-form]'));
});
$('#refresh').addEventListener('click',()=>void work(async()=>{accept(await request('/api/state'));message('Read the latest saved state. Your unsaved form fields remain in the editor.');}));
let polling=false;
setInterval(async()=>{
 if(!busy||polling||!state)return;polling=true;
 try{
  const generation=renderGeneration,currentId=state.id,next=await request('/api/state');
  if(busy&&generation===renderGeneration&&next.id===currentId&&next.revision>=state.revision){accept(next);renderNotices();$('#connection').textContent='Saved revision '+state.revision+' · original operation in progress';}
 }catch{}finally{polling=false;}
},2000);
try{
 accept(await request('/api/state'));restored();productId=state.activeProductId;
 if(state.lastListing){try{await loadListing(state.lastListing.id,state.lastListing.sourceId);}catch(error){notice={type:'error',text:error.message};}}
 render();
}catch(error){$('#main').innerHTML=empty(error.message);$('#connection').textContent='Original workspace unavailable';}
