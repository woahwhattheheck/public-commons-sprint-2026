const $=id=>document.getElementById(id),token=document.querySelector('meta[name=workspace-token]').content;
const clone=value=>structuredClone(value),json=value=>JSON.stringify(value,null,2);
const C={state:null,source:null,mapping:null,entries:{},node:null,comparison:null,native:null,execution:null,archive:null,busy:false,restoring:false,loading:true,ready:false,seq:0,reads:{},requests:[],db:null,slot:null,saveTimer:null,nativeNotes:{},executionDrafts:{},executionContext:null,handoverDrafts:{},handoverContext:null};
const key=value=>encodeURIComponent(String(value));
function element(tag,text,props={}){const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);Object.assign(e,props);return e;}
function notice(message,error=false){$('notice').textContent=message;$('notice').hidden=!message;$('notice').classList.toggle('error',error);}
function required(value,message){if(value===null||value===undefined||value==='')throw Error(message);return value;}
function object(text,label){try{const v=JSON.parse(text);if(!v||typeof v!=='object'||Array.isArray(v))throw Error();return v;}catch{throw Error(label+' must be a complete JSON object.');}}
function array(text,label){try{const v=JSON.parse(text);if(!Array.isArray(v))throw Error();return v;}catch{throw Error(label+' must be a JSON array.');}}
function show(page){document.querySelectorAll('.page').forEach(e=>{e.hidden=e.id!=='page-'+page;});document.querySelectorAll('[data-page]').forEach(e=>e.setAttribute('aria-current',e.dataset.page===page?'page':'false'));schedule();}
function facts(target,rows){target.replaceChildren();for(const [name,value]of rows)target.append(element('dt',name),element('dd',typeof value==='object'?json(value):value??'—'));}
function downloadBlob(bytes,name,type='application/json'){const url=URL.createObjectURL(new Blob([bytes],{type})),a=element('a',undefined,{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function api(url,body,extra={}){
 const headers={'x-workspace-token':token,...(C.state?.workspace?{'x-workspace-id':C.state.workspace.id}:{})};
 if(body!==undefined)headers['Content-Type']='application/json';
 const r=await fetch(url,{method:body===undefined?'GET':'POST',headers:{...headers,...extra.headers},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',...extra});
 let value;try{value=await r.json();}catch{throw Error('The original workspace response was incomplete. Read the saved request before continuing.');}
 if(!r.ok)throw Object.assign(Error(value.message||'Workspace response '+r.status),{code:value.error,status:r.status,current_revision:value.current_revision});
 return value;
}
const read=(kind,id,paging={})=>api('/api/records/'+key(kind)+'/'+key(id)+(Object.keys(paging).length?'?'+new URLSearchParams(paging):''));
async function all(kind,id){const rows=[];let offset=0;for(;;){const p=await read(kind,id,{offset,limit:100});rows.push(...p.items);if(offset+p.items.length>=p.total)return rows;if(!p.items.length)throw Error('The original inventory page did not advance.');offset+=p.items.length;}}
async function download(kind,id){const file=await api('/api/downloads',{kind,id});const a=element('a','Download '+file.filename,{href:file.url,download:file.filename});document.body.append(a);a.click();a.remove();notice('Prepared complete '+file.filename+' ('+file.bytes+' bytes).');}
function options(control,rows,value=x=>x.id,label=x=>x.name||x.label||x.id){const selected=control.value;control.replaceChildren(element('option','Choose…',{value:''}));for(const row of rows)control.append(element('option',label(row),{value:value(row)}));if([...control.options].some(x=>x.value===selected))control.value=selected;}
function catalogs(){
 const s=C.state;
 document.querySelectorAll('[data-catalog]').forEach(control=>options(control,s.osf[control.dataset.catalog]||[],x=>x.id,x=>(x.name||x.context||x.phase||x.decision||x.id)+' · '+x.id.slice(-10)));
 options($('map-profile'),s.profiles,x=>x.id,x=>x.name+' · '+x.base_url);
 options($('target-capture'),s.captures,x=>x.id,x=>x.label+' · '+x.object_count+' objects');
 options($('execution-select'),s.executions,x=>x.id,x=>x.status+' · '+x.id);
}
async function refresh(){
 const n=(C.reads.refresh||0)+1;C.reads.refresh=n;const s=await api('/api/state');
 if(C.state?.workspace.id&&C.state.workspace.id!==s.workspace?.id)throw Error('The original workspace changed. Reopen its own local launch page.');
 if(C.reads.refresh!==n)return;
 C.state=s;required(s.workspace?.id,'Open the matching OSF workspace source release.');
 $('identity').textContent=s.workspace.directory+' · '+s.workspace.id;$('revision').textContent='Saved revision '+s.revision;catalogs();return s;
}
function request(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||Error('Browser storage read failed.'));});}
function done(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error||Error('Browser storage write failed.'));});}
async function db(){
 if(C.db)return C.db;C.db=await new Promise((resolve,reject)=>{const r=indexedDB.open('osf-institutional-transition',1);r.onupgradeneeded=()=>{for(const name of ['current','editions','requests'])if(!r.result.objectStoreNames.contains(name))r.result.createObjectStore(name,{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Close the older OSF workspace tab to finish opening browser storage.'));});return C.db;
}
async function put(store,value){const d=await db(),tx=d.transaction(store,'readwrite'),wait=done(tx);tx.objectStore(store).put(clone(value));await wait;}
async function get(store,id){const d=await db(),tx=d.transaction(store,'readonly'),wait=done(tx),value=await request(tx.objectStore(store).get(id));await wait;return value;}
async function stored(store){const d=await db(),tx=d.transaction(store,'readonly'),wait=done(tx),rows=await request(tx.objectStore(store).getAll());await wait;return rows.filter(v=>v.workspace_id===C.state.workspace.id);}
function values(){return Object.fromEntries([...document.querySelectorAll('[data-save]')].map(e=>[e.id,e.type==='checkbox'?e.checked:e.value]));}
function setValues(form){for(const [id,v]of Object.entries(form||{})){const e=$(id);if(!e?.hasAttribute('data-save'))continue;if(e.type==='checkbox')e.checked=Boolean(v);else{if(e.tagName==='SELECT'&&v&&![...e.options].some(x=>x.value===v))e.append(element('option',String(v)+' · retained',{value:v}));e.value=String(v??'');}}}
function rawEntry(){
 return {fields:Object.fromEntries([...document.querySelectorAll('#entry-editor [data-save]')].map(e=>[e.id,e.value])),
 metadata:[...$('metadata-fields').children].map(row=>({name:row.querySelector('.field-name').value,raw:row.querySelector('.field-values').value})),
 files:[...$('entry-files').querySelectorAll('[data-file-key]')].map(row=>({key:row.dataset.fileKey,action:row.querySelector('select').value,note:row.querySelector('input').value}))};
}
function retainEntry(){if(C.mapping&&C.node)C.entries[C.node]=rawEntry();}
function snapshot(){retainEntry();retainExecutionDraft();return {schema:'osf-transition-browser/v1',workspace_id:C.state.workspace.id,created_at:new Date().toISOString(),form:values(),mapping:clone(C.mapping),entries:clone(C.entries),node:C.node,source:clone(C.source),comparison:clone(C.comparison),native:clone(C.native),execution:clone(C.execution),archive:clone(C.archive),nativeNotes:clone(C.nativeNotes),executionDrafts:clone(C.executionDrafts),executionContext:C.executionContext,handoverDrafts:clone(C.handoverDrafts),handoverContext:C.handoverContext,review_checks:[...$('review-findings').querySelectorAll('input:checked')].map(e=>e.value),comparison_choices:[...$('comparison-fields').querySelectorAll('[data-field-key]')].map(e=>({key:e.dataset.fieldKey,side:e.querySelector('select').value,raw:e.querySelector('textarea').value})),absent_nodes:[...$('comparison-fields').querySelectorAll('[data-node-choice]:checked')].map(e=>e.dataset.nodeChoice),page:document.querySelector('[data-page][aria-current=page]')?.dataset.page||'source'};}
async function checkpoint(name){if(!C.state||C.restoring)return;const value=snapshot();await put('editions',{id:crypto.randomUUID(),workspace_id:C.state.workspace.id,name,created_at:value.created_at,snapshot:value});}
let writes=Promise.resolve();
function schedule(){
 if(!C.state||C.restoring||!C.slot)return;
 C.seq++;clearTimeout(C.saveTimer);C.saveTimer=setTimeout(()=>persist().catch(e=>notice('The current draft remains open; browser save failed: '+e.message,true)),200);
}
function persist(){
 clearTimeout(C.saveTimer);if(!C.slot||C.restoring)return Promise.resolve();const value=snapshot(),sequence=C.seq;
 writes=writes.catch(()=>{}).then(()=>put('current',{id:C.slot,workspace_id:C.state.workspace.id,sequence,snapshot:value})).then(()=>{$('draft-status').textContent='Complete current forms saved in this browser.';});return writes;
}
async function operate(fn,{archive='Before changing this workspace view'}={}){
 if(C.loading||!C.ready)throw Error('The original workspace is still opening. Use Refresh to finish loading its retained forms.');
 if(C.busy)return;C.busy=true;const oldInert=$('main').inert;$('main').inert=true;
 const controls=[...document.querySelectorAll('button,input,select,textarea')],disabled=controls.map(e=>e.disabled);controls.forEach(e=>e.disabled=true);document.body.setAttribute('aria-busy','true');
 try{if(archive)await checkpoint(archive);return await fn();}
 catch(e){notice((e.code?e.code+': ':'')+e.message,true);throw e;}
 finally{controls.forEach((e,i)=>e.disabled=disabled[i]);C.busy=false;$('main').inert=oldInert;$('restore-archive').disabled=!C.archive?.preview||!!C.archive.completed;document.body.removeAttribute('aria-busy');schedule();}
}
function on(id,event,fn){$(id).addEventListener(event,e=>{if(event==='submit')e.preventDefault();operate(()=>fn(e)).catch(()=>{});});}
async function mutate(action,body,{original,revision}={}){
 const record=original||{id:crypto.randomUUID(),workspace_id:C.state.workspace.id,action,created_at:new Date().toISOString(),input:{...clone(body),actor:required($('actor').value.trim(),'Enter the staff operator attribution.'),operationId:crypto.randomUUID(),revision:C.state.revision},state:'PREPARED'};
 if(record.workspace_id!==C.state.workspace.id)throw Error('The original request belongs to another workspace.');
 if(!original){record.id=record.input.operationId;await put('requests',record);}
 const interval=action==='osf-capture'?setInterval(()=>api('/api/state').then(s=>{const source=s.osf.osf_sources.find(x=>x.id.endsWith(record.input.operationId));$('capture-progress').textContent='Original capture continues in the server · saved revision '+s.revision+(source?' · '+source.status:'');}).catch(()=>{}),3000):null;
 try{
  const input={...record.input,...(revision!==undefined?{revision}:{})},result=await api('/api/actions/'+action,input);
  record.state='COMPLETE';record.result=clone(result);record.completed_at=new Date().toISOString();await put('requests',record);
  try{await refresh();}catch(e){notice('Original operation completed; refresh its saved result when available. '+e.message,true);}
  $('request-detail').textContent=json(record);return result;
 }catch(e){
  if(record.state!=='COMPLETE'){record.state=e.status&&e.status<500?'REQUIRES_ATTENTION':'UNCERTAIN';record.error={code:e.code,message:e.message};await put('requests',record).catch(()=>{});}
  throw e;
 }finally{if(interval)clearInterval(interval);}
}
function table(target,columns,rows,open){
 target.replaceChildren();const wrap=element('div',undefined,{className:'grid'}),t=element('table'),head=element('tr');
 columns.forEach(c=>head.append(element('th',c[0])));head.append(element('th','Original'));const h=element('thead');h.append(head);t.append(h);const b=element('tbody');
 rows.forEach(row=>{const tr=element('tr');columns.forEach(([,fn])=>{const v=fn(row);tr.append(element('td',typeof v==='object'?json(v):v??'—'));});const td=element('td'),button=element('button','Read');button.addEventListener('click',()=>open(row));td.append(button);tr.append(td);b.append(tr);});t.append(b);wrap.append(t);target.append(wrap);
}
async function inventory(offset=0){
 const sourceId=required(C.source?.id,'Open a saved source first.'),kind=$('inventory-kind').value,n=(C.reads.inventory||0)+1;C.reads.inventory=n;
 const r=await read('osf_'+kind,sourceId,{offset,limit:50});if(C.reads.inventory!==n||C.source?.id!==sourceId)return;
 const columns=kind==='versions'?[['Component',x=>x.node_id],['Provider',x=>x.provider],['Original path',x=>x.path],['Version',x=>x.version_id],['Bytes',x=>x.size],['Received',x=>x.retained]]:kind==='nodes'?[['Project / component',x=>x.title],['OSF ID',x=>x.id],['Public',x=>x.public],['Created',x=>x.date_created]]:[['Original identity',x=>x.id||x.key||x.node_id],['Details',x=>x.message||x.name||x.title||x.path||x.type||x.action||x.role],['Component',x=>x.node_id||x.from]];
 table($('inventory'),columns,r.items,row=>{$('inventory-detail').textContent=json(row);$('inventory-detail').parentElement.open=true;});
 const p=$('inventory-pager');p.replaceChildren();for(const [label,value,disabled]of [['Previous',Math.max(0,offset-50),offset===0],['Next',offset+r.items.length,offset+r.items.length>=r.total]]){const b=element('button',label,{disabled});b.addEventListener('click',()=>operate(()=>inventory(value),{archive:null}).catch(()=>{}));p.append(b);}p.append(element('span',r.total?((offset+1)+'–'+(offset+r.items.length)+' of '+r.total):'No records'));
}
async function openSource(id){
 const source=await read('osf_sources',required(id,'Choose a saved source.'));
 C.source=source;$('source-select').value=id;$('source-file').value='';$('source-file-state').textContent='Choose the original source JSON to import another capture.';
 facts($('source-facts'),[['Source',source.id],['Original roots',source.roots],['State',source.status],['Content SHA256',source.content_sha256],['Counts',source.counts],['Exceptions',source.findings_count]]);
 const target=$('source-files');target.replaceChildren();
 for(const d of source.documents||[]){if(!d.sha256)continue;const button=element('button',d.role+' · '+d.node_id+' · '+d.bytes+' bytes');button.addEventListener('click',()=>operate(()=>download('osf_response',d.response_id||source.id+':'+d.id),{archive:null}).catch(()=>{}));target.append(button);}
 for(const f of source.files||[]){const button=element('button',(f.path||f.name)+' · version '+(f.version_id??'current')+' · '+f.bytes+' bytes');button.addEventListener('click',()=>operate(async()=>{const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(f.key)))].map(v=>v.toString(16).padStart(2,'0')).join('');await download('osf_file',source.id+':'+hash);},{archive:null}).catch(()=>{}));target.append(button);}
 if(source.status==='CAPTURED')await inventory();show('source');
}
function fieldRow(name,raw){
 const row=element('div',undefined,{className:'field-row'}),field=element('input',undefined,{className:'field-name',value:name}),values=element('textarea',undefined,{className:'field-values',value:raw,rows:3}),remove=element('button','Remove',{type:'button'});
 remove.addEventListener('click',()=>operate(async()=>{row.remove();},{archive:'Before removing a complete metadata field'}).catch(()=>{}));row.append(field,values,remove);$('metadata-fields').append(row);
}
function renderEntry(nodeId){
 C.node=nodeId;$('map-node').value=nodeId;const entry=C.mapping?.entries.find(e=>e.node_id===nodeId);if(!entry)return;
 const retained=C.entries[nodeId];
 const f=retained?.fields||{'entry-decision':entry.decision,'entry-mode':entry.mode,'entry-reason':entry.reason,'entry-collection-capture':entry.collection_capture_id||'','entry-collection':entry.collection_uuid||'','entry-target-capture':entry.target_capture_id||'','entry-target':entry.target_uuid||'','entry-access':entry.rights?.access||'PUBLIC','entry-rights-reviewer':entry.rights?.confirmed_by||'','entry-rights':entry.rights?.statement||'','entry-rights-note':entry.rights?.note||'','entry-new-target':entry.new_destination_reason||'','target-capture':''};
 setValues(f);$('metadata-fields').replaceChildren();for(const item of retained?.metadata||Object.entries(entry.metadata).map(([name,v])=>({name,raw:json(v)})))fieldRow(item.name,item.raw);
 $('entry-files').replaceChildren();for(const file of retained?.files||entry.files){const row=element('div',undefined,{className:'row'});row.dataset.fileKey=file.key;const label=element('span',file.key,{className:'mono'}),select=element('select'),note=element('input',undefined,{value:file.note||'',placeholder:'Reason or native source note'});for(const [v,title]of [['COPY','Copy exact original'],['REFERENCE','Retain original reference'],['EXCLUDE','Exclude with reason']])select.append(element('option',title,{value:v}));select.value=file.action;row.append(label,select,note);$('entry-files').append(row);}
}
function entryValue(entry,raw){
 if(!raw)return clone(entry);const f=raw.fields,metadata={};
 for(const item of raw.metadata){if(!item.name.trim()||Object.hasOwn(metadata,item.name.trim()))throw Error('Use distinct nonempty metadata field names.');metadata[item.name.trim()]=array(item.raw,item.name+' values');}
 return {...clone(entry),decision:f['entry-decision'],mode:f['entry-mode'],reason:f['entry-reason'],collection_capture_id:f['entry-collection-capture']||null,collection_uuid:f['entry-collection']||null,target_capture_id:f['entry-target-capture']||null,target_uuid:f['entry-target']||null,new_destination_reason:f['entry-new-target']||null,metadata,rights:{...entry.rights,access:f['entry-access'],confirmed_by:f['entry-rights-reviewer'],statement:f['entry-rights'],note:f['entry-rights-note']},files:clone(raw.files)};
}
function mappingInput(){retainEntry();required(C.mapping,'Prepare or open a mapping first.');return {name:$('map-name').value,source_id:C.mapping.source_id,source_sha256:C.mapping.source_sha256,profile_id:$('map-profile').value||null,previous_mapping_id:C.mapping.id||C.mapping.previous_mapping_id||null,entries:C.mapping.entries.map(e=>entryValue(e,C.entries[e.node_id]))};}
async function loadMapping(mapping,{entryDrafts={},nodeId}={}){
 C.mapping=clone(mapping);C.entries=clone(entryDrafts);C.node=null;$('map-name').value=mapping.name||'';$('map-profile').value=mapping.profile_id||'';
 $('map-source').textContent=mapping.source_id+' · SHA256 '+mapping.source_sha256;$('mapping-state').textContent=mapping.id?'Saved '+mapping.id:'New mapping draft';
 options($('map-node'),mapping.entries,x=>x.node_id,x=>x.node_id+' · '+x.decision);renderEntry(nodeId||mapping.entries[0]?.node_id);$('mapping-json').value=json(mapping);
 $('review-note').value='';$('review-decision').value='APPROVED';$('review-findings').replaceChildren();$('review-binding').textContent=mapping.id?mapping.id+' · '+mapping.mapping_sha256:'Save this mapping before review.';
 if(mapping.id){
  $('mapping-select').value=mapping.id;const findings=await all('osf_findings',mapping.source_id);
  for(const f of findings){const label=element('label',undefined,{className:'finding'}),check=element('input',undefined,{type:'checkbox',value:f.id});check.dataset.finding=f.id;label.append(check,document.createTextNode(' '+(f.code||'Source exception')+' · '+(f.message||json(f))));$('review-findings').append(label);}
 }
 show('mapping');
}
async function openMapping(id){return loadMapping(await read('osf_mappings',required(id,'Choose a saved mapping.')));}
async function fullNative(){
 const binding=await read('osf_native_plans',required($('native-plan').value,'Choose the transition native plan.')),plan=await read('plans',binding.plan_id);
 if(C.native?.binding.id!==binding.id){if(C.native)C.nativeNotes[C.native.binding.id]={note:$('native-note').value,decision:$('native-decision').value};const draft=C.nativeNotes[binding.id];$('native-note').value=draft?.note||'';$('native-decision').value=draft?.decision||'APPROVED';}
 C.native={binding,plan};$('native-detail').textContent=json(C.native);return C.native;
}
function retainExecutionDraft(){
 if(C.executionContext)C.executionDrafts[C.executionContext]={resolutions:$('execution-resolutions').value};
}
function selectExecutionContext(id){
 if(C.executionContext!==id){retainExecutionDraft();C.executionContext=id;$('execution-resolutions').value=C.executionDrafts[id]?.resolutions??'[]';}
 $('execution-select').value=id??'';
}
async function openExecution(){
 const id=required($('execution-select').value,'Choose an original execution.'),value=await read('executions',id);
 if(value.id!==id)throw Error('The original execution identity changed.');
 selectExecutionContext(id);C.execution=value;$('execution-detail').textContent=json(value);return value;
}
async function openComparison(id){
 C.comparison=await read('osf_comparisons',required(id,'Choose a saved comparison.'));const c=C.comparison;$('comparison-select').value=c.id;$('comparison-json').textContent=json(c);
 facts($('comparison-facts'),[['Original mapping',c.mapping_id],['Incoming source',c.incoming_source_id],['Overlapping metadata edits',c.conflict_count],['Comparison SHA256',c.comparison_sha256]]);
 $('comparison-fields').replaceChildren();const newEntries=[],fileChoices=[];
 for(const row of c.entries){
  const group=element('div',undefined,{className:'conflict'});group.append(element('h3',row.node_id+' · '+row.status));
  if(row.status==='SOURCE_ABSENT'){const label=element('label'),check=element('input',undefined,{type:'checkbox',value:'REMOVE_ABSENT'});check.dataset.nodeChoice=row.node_id;label.append(check,document.createTextNode(' Retain old history and remove this absent component from the new mapping'));group.append(label);}
  if(row.status==='NEW_COMPONENT')newEntries.push({node_id:row.node_id,decision:'KEEP_OSF',reason:'Review the newly observed component.',mode:'CREATE_DRAFT',metadata:row.default_metadata,rights:{access:'PUBLIC',confirmed_by:'',note:''},files:[]});
  for(const f of row.fields||[]){const field=element('div',undefined,{className:'conflict'});field.dataset.fieldKey=f.key;field.append(element('strong',f.field+(f.conflict?' · decision required':'')));const columns=element('div',undefined,{className:'three'});for(const [label,value]of [['Earlier source',f.before],['Local staff fields',f.local],['Incoming source',f.incoming]]){const col=element('div');col.append(element('p',label),element('pre',json(value)));columns.append(col);}const select=element('select');for(const [v,label]of [['','Automatic when changes do not overlap'],['LOCAL','Keep local staff values'],['INCOMING','Use incoming source values'],['CUSTOM','Use reviewed custom array']])select.append(element('option',label,{value:v}));const custom=element('textarea',undefined,{rows:3,value:json(f.local.value||[])});custom.placeholder='Complete metadata value array';field.append(columns,select,custom);group.append(field);}
  for(const f of row.files||[])if(f.state==='NEW')fileChoices.push({key:f.key,action:f.received?'COPY':'REFERENCE',note:f.received?'':'Review this original version before copying.'});else if(f.state==='SOURCE_ABSENT')fileChoices.push({key:f.key,action:'REMOVE_ABSENT',note:'Review the absent version; its original history stays retained.'});
  $('comparison-fields').append(group);
 }
 $('reconcile-new').value=json(newEntries);$('reconcile-files').value=json(fileChoices);$('reconcile-name').value='Reconciled '+c.mapping_id;show('compare');
}
async function history(){
 const target=$('draft-history');target.replaceChildren();
 const rows=(await stored('editions')).sort((a,b)=>b.created_at.localeCompare(a.created_at));
 const add=(name,time,open,save)=>{const row=element('div',undefined,{className:'history-row'}),label=element('div',name+' · '+time,{className:'label'}),reopen=element('button','Open complete draft'),download=element('button','Download');reopen.addEventListener('click',()=>operate(open).catch(()=>{}));download.addEventListener('click',save);row.append(label,reopen,download);target.append(row);};
 for(const row of rows)add(row.name,row.created_at,()=>restoreDraft(row.snapshot),()=>downloadBlob(json(row.snapshot)+'\n','OSF_Draft_'+row.id+'.json'));
 for(const row of C.state.osf.osf_drafts||[])add(row.name,row.created_at,async()=>{const full=await read('osf_drafts',row.id);await restoreDraft(full.body,{received:true});},()=>operate(()=>download('osf_drafts',row.id),{archive:null}).catch(()=>{}));
 await requestHistory();
}
async function requestHistory(){
 const target=$('request-history');target.replaceChildren();C.requests=(await stored('requests')).sort((a,b)=>b.created_at.localeCompare(a.created_at));
 for(const row of C.requests){
  const item=element('div',undefined,{className:'history-row'}),label=element('div',row.action+' · '+row.state+' · '+row.id,{className:'label mono'}),inspect=element('button','Read original'),resume=element('button','Read and continue',{disabled:row.state==='COMPLETE'}),save=element('button','Download full request');
  inspect.addEventListener('click',()=>operate(async()=>{let native;try{native=await read('operations',row.input.operationId);}catch(e){if(e.status!==404)throw e;}$('request-detail').textContent=json({retained:row,native:native||null});},{archive:null}).catch(()=>{}));
  resume.addEventListener('click',()=>operate(async()=>{
   let native;try{native=await read('operations',row.input.operationId);}catch(e){if(e.status!==404)throw e;}
   if(native?.status==='COMPLETE'){row.state='COMPLETE';row.result=native.result;await put('requests',row);$('request-detail').textContent=json(row);await refresh();}
   else if(native?.action==='execute-plan'&&native.status==='FAILED')throw Error('Open the original execution under Native operations and recover that execution.');
   else await mutate(row.action,row.input,{original:row,revision:native?undefined:C.state.revision});
   await history();
  },{archive:null}).catch(()=>{}));save.addEventListener('click',()=>downloadBlob(json(row)+'\n','OSF_Request_'+row.id+'.json'));item.append(label,inspect,resume,save);target.append(item);
 }
}
async function restoreDraft(value,{received=false}={}){
 if(!value||value.schema!=='osf-transition-browser/v1'||!value.form||!value.entries)throw Error('Choose the complete original OSF browser draft.');
 if(value.workspace_id!==C.state.workspace.id&&!received)throw Error('This draft belongs to another original workspace. Receive its complete institutional archive first.');
 C.restoring=true;
 try{
  C.nativeNotes=clone(value.nativeNotes||{});C.executionDrafts=clone(value.executionDrafts||{});C.executionContext=value.executionContext||value.execution?.id||null;
  if(C.executionContext&&!C.executionDrafts[C.executionContext])C.executionDrafts[C.executionContext]={resolutions:value.form['execution-resolutions']??'[]'};
  C.handoverDrafts=clone(value.handoverDrafts||{});C.handoverContext=value.handoverContext||null;
  if(value.mapping){await read('osf_sources',value.mapping.source_id);await loadMapping(value.mapping,{entryDrafts:value.entries,nodeId:value.node});}else{C.mapping=null;C.entries={};C.node=null;}
  C.source=clone(value.source);C.comparison=clone(value.comparison);C.native=clone(value.native);C.execution=clone(value.execution);C.archive=received?null:clone(value.archive);
  if(C.source)await openSource(C.source.id);
  if(C.comparison)await openComparison(C.comparison.id);
  const form={...value.form};
  const originalSelections={'source-select':value.source?.id,'map-select':value.mapping?.id,
   'native-mapping':value.native?.binding?.mapping_id,'native-review':value.native?.binding?.review_id,'native-plan':value.native?.binding?.id,
   'execution-select':value.execution?.id,'compare-mapping':value.comparison?.mapping_id,'compare-source':value.comparison?.incoming_source_id,
   'comparison-select':value.comparison?.id,'handover-mapping':value.handoverContext};
  for(const [id,selection]of Object.entries(originalSelections))if(!Object.hasOwn(form,id)&&selection)form[id]=selection;
  setValues(form);
  if(C.executionContext)$('execution-resolutions').value=C.executionDrafts[C.executionContext]?.resolutions??'[]';
  for(const e of $('review-findings').querySelectorAll('input'))e.checked=(value.review_checks||[]).includes(e.value);
  for(const e of $('comparison-fields').querySelectorAll('[data-field-key]')){const v=(value.comparison_choices||[]).find(v=>v.key===e.dataset.fieldKey);if(v){e.querySelector('select').value=v.side;e.querySelector('textarea').value=v.raw;}}
  for(const e of $('comparison-fields').querySelectorAll('[data-node-choice]'))e.checked=(value.absent_nodes||[]).includes(e.dataset.nodeChoice);
  if(value.mapping){C.entries=clone(value.entries);renderEntry(value.node||value.mapping.entries[0]?.node_id);}
  $('source-file').value='';$('archive-file').value='';$('draft-file').value='';
  if(C.native)$('native-detail').textContent=json(C.native);if(C.execution)$('execution-detail').textContent=json(C.execution);
  $('archive-preview').textContent=C.archive?json(C.archive):'';$('restore-archive').disabled=!C.archive?.preview||!!C.archive.completed;show(value.page||'source');
 }finally{C.restoring=false;}
 await persist();notice('The complete retained draft is open. Its original requests remain under their own saved identities.');
}
document.querySelectorAll('[data-page]').forEach(button=>button.addEventListener('click',()=>{if(!C.ready||C.loading)return;show(button.dataset.page);if(button.dataset.page==='history')history().catch(e=>notice(e.message,true));}));
document.addEventListener('input',schedule);document.addEventListener('change',schedule);
$('refresh').addEventListener('click',()=>{if(C.loading)return;if(!C.ready)initialize().catch(e=>notice(e.message,true));else operate(refresh).catch(()=>{});});
on('capture-form','submit',async()=>{
 const keys=$('capture-keys').value.trim();const result=await mutate('osf-capture',{root_ids:$('capture-roots').value.split(/[\s,]+/).filter(Boolean),name:$('capture-name').value,recursive:$('capture-recursive').checked,include_versions:$('capture-versions').checked,download_files:$('capture-files').checked,...(keys?{download_file_keys:array(keys,'Selected original keys')}:{}) ,...($('capture-env').value?{token_env:$('capture-env').value}:{}),...($('capture-previous').value?{previous_source_id:$('capture-previous').value}:{})});
 await openSource(result.source_id);
});
on('import-form','submit',async()=>{
 const file=required($('source-file').files[0],'Select the full source JSON.');if(file.size>23*1024*1024)throw Error('Use scripts/osf_cli.mjs import for this complete source packet; it exceeds the HTTP JSON envelope.');
 const text=await file.text();const parsed=object(text,'Original source');if(parsed.schema!=='osf-project-source/v1')throw Error('Choose the original osf-project-source/v1 packet.');
 const result=await mutate('osf-import-source',{source_text:text,filename:file.name,name:$('import-name').value||file.name});await openSource(result.source_id);
});
on('open-source','click',()=>openSource($('source-select').value));
on('inventory-open','click',()=>inventory());
on('source-export','click',()=>download('osf_source',required(C.source?.id,'Open the original source.')));
on('new-map','click',async()=>loadMapping(await read('osf_default_mapping',required(C.source?.id,'Open a captured original source.'))));
on('open-mapping','click',()=>openMapping($('mapping-select').value));
on('mapping-export','click',()=>download('osf_mappings',required(C.mapping?.id,'Save or open the exact mapping.')));
$('map-node').addEventListener('change',()=>{const next=$('map-node').value;operate(async()=>{retainEntry();renderEntry(next);}).catch(()=>{$('map-node').value=C.node||'';});});
on('add-metadata','click',()=>fieldRow('dc.', '[]'));
on('read-targets','click',async()=>{
 const capture=await read('captures',required($('target-capture').value,'Choose an original institutional capture.'));
 const rows=capture.objects||capture.rows;options($('target-object'),rows.filter(v=>['collection','item'].includes(v.type)),v=>v.uuid||v.id,v=>v.type+' · '+(v.name||v.metadata?.['dc.title']?.[0]?.value||v.uuid));C.targets={capture:clone(capture),rows:clone(rows)};
});
on('choose-target','click',()=>{
 if(!C.targets||C.targets.capture.id!==$('target-capture').value)throw Error('Read this original destination capture first.');
 const selected=C.targets.rows.find(v=>String(v.uuid||v.id)===$('target-object').value);required(selected,'Choose a captured item or collection.');
 if(selected.type==='item'){$('entry-mode').value='UPDATE_ITEM';$('entry-target-capture').value=C.targets.capture.id;$('entry-target').value=selected.uuid||selected.id;}else{$('entry-collection-capture').value=C.targets.capture.id;$('entry-collection').value=selected.uuid||selected.id;}
});
on('mapping-form','submit',async()=>{const saved=await mutate('osf-save-mapping',mappingInput());await openMapping(saved.mapping_id);notice('Saved complete mapping edition '+saved.mapping_id+'.');});
on('map-json-open','click',()=>{$('mapping-json').value=json(mappingInput());$('map-json-panel').open=true;});
on('map-json-apply','click',()=>loadMapping(object($('mapping-json').value,'Mapping')));
on('review-form','submit',async()=>{
 required(C.mapping?.id,'Save the complete mapping before review.');
 if(json(mappingInput().entries)!==json(C.mapping.entries)||$('map-name').value!==C.mapping.name||($('map-profile').value||null)!==C.mapping.profile_id)throw Error('Save the current mapping fields before reviewing their exact edition.');
 const r=await mutate('osf-review-mapping',{mapping_id:C.mapping.id,mapping_sha256:C.mapping.mapping_sha256,decision:$('review-decision').value,note:$('review-note').value,acknowledged_findings:[...$('review-findings').querySelectorAll('input:checked')].map(e=>e.value)});
 $('native-mapping').value=C.mapping.id;$('native-review').value=r.review_id;selectHandoverMapping(C.mapping.id,{reviewId:r.review_id});notice('Saved the exact source and mapping review.');
});
on('prepare-form','submit',async()=>{
 const m=await read('osf_mappings',required($('native-mapping').value,'Choose a saved mapping.')),r=await mutate('osf-prepare-native',{mapping_id:m.id,mapping_sha256:m.mapping_sha256,review_id:$('native-review').value,phase:$('native-phase').value});
 $('native-plan').value=r.native_plan_id;await fullNative();
});
on('open-native','click',fullNative);
on('native-plan','change',fullNative);
function selectHandoverMapping(mappingId,{reviewId}={}){
 const fields=['handover-name','handover-state','handover-note','handover-destinations'];
 if(C.handoverContext!==mappingId){if(C.handoverContext)C.handoverDrafts[C.handoverContext]=Object.fromEntries(fields.map(id=>[id,$(id).value]));C.handoverContext=mappingId;setValues(C.handoverDrafts[mappingId]||{'handover-name':'','handover-state':'WORKING_HANDOVER','handover-note':'','handover-destinations':'[]'});$('handover-review').value='';}
 $('handover-mapping').value=mappingId;if(reviewId!==undefined)$('handover-review').value=reviewId;
}
on('handover-mapping','change',()=>selectHandoverMapping($('handover-mapping').value));
on('export-native','click',async()=>{const p=await fullNative();await download('plans',p.plan.id);});
on('native-review-form','submit',async()=>{const p=await fullNative();await mutate('review-plan',{plan_id:p.plan.id,decision:$('native-decision').value,note:$('native-note').value});await fullNative();});
on('execute-native','click',async()=>{const p=await fullNative();if(p.plan.status!=='APPROVED')throw Error('Save the original native plan approval first.');const r=await mutate('execute-plan',{plan_id:p.plan.id});$('execution-select').value=r.execution_id;await openExecution();});
on('open-execution','click',openExecution);
on('execution-select','change',openExecution);
on('recover-execution','click',async()=>{const e=await openExecution();const r=await mutate('recover-execution',{execution_id:e.id,resolutions:array($('execution-resolutions').value,'Original native subject resolutions')});$('execution-select').value=r.execution_id;await openExecution();});
on('adopt-execution','click',async()=>{const p=await fullNative(),e=await openExecution();if(e.plan_id!==p.plan.id)throw Error('Choose the execution belonging to this original transition plan.');const r=await mutate('osf-adopt-execution',{native_plan_id:p.binding.id,execution_id:e.id});notice('Retained '+r.accepted_steps+' accepted original native steps and '+r.pending_steps+' pending steps.');});
on('compare-form','submit',async()=>{const m=await read('osf_mappings',required($('compare-mapping').value,'Choose the saved local mapping.')),r=await mutate('osf-compare',{mapping_id:m.id,mapping_sha256:m.mapping_sha256,incoming_source_id:$('compare-source').value});await openComparison(r.comparison_id);});
on('open-comparison','click',()=>openComparison($('comparison-select').value));
on('export-comparison','click',()=>download('osf_comparisons',required(C.comparison?.id,'Open the saved comparison.')));
on('reconcile-form','submit',async()=>{
 const c=required(C.comparison,'Open a comparison.'),choices={};
 for(const e of $('comparison-fields').querySelectorAll('[data-field-key]')){const side=e.querySelector('select').value;if(side)choices[e.dataset.fieldKey]=side==='CUSTOM'?{side,value:array(e.querySelector('textarea').value,'Custom metadata')}:side;}
 for(const e of $('comparison-fields').querySelectorAll('[data-node-choice]:checked'))choices['node:'+e.dataset.nodeChoice]='REMOVE_ABSENT';
 const r=await mutate('osf-reconcile',{comparison_id:c.id,comparison_sha256:c.comparison_sha256,name:$('reconcile-name').value,choices,new_entries:array($('reconcile-new').value,'New component decisions'),file_choices:array($('reconcile-files').value,'File-version decisions')});await openMapping(r.mapping_id);
});
on('handover-form','submit',async()=>{
 const m=await read('osf_mappings',required($('handover-mapping').value,'Choose the exact saved mapping.')),r=await mutate('osf-freeze-delivery',{mapping_id:m.id,mapping_sha256:m.mapping_sha256,review_id:$('handover-review').value,state:$('handover-state').value,name:$('handover-name').value,note:$('handover-note').value,destinations:array($('handover-destinations').value,'Destination acceptances'),draft_ids:C.state.osf.osf_drafts.filter(d=>d.context.includes(m.id)).map(d=>d.id)});
 $('delivery-select').value=r.delivery_id;$('delivery-detail').textContent=json(await read('osf_deliveries',r.delivery_id));
});
on('open-delivery','click',async()=>{$('delivery-detail').textContent=json(await read('osf_deliveries',required($('delivery-select').value,'Choose the original handover.')));});
on('delivery-json','click',()=>download('osf_manifest',required($('delivery-select').value,'Choose the original handover.')));
on('delivery-archive','click',()=>download('osf_archive',required($('delivery-select').value,'Choose the original handover.')));
on('receive-form','submit',async()=>{
 const file=required($('archive-file').files[0],'Choose the complete original institutional archive.'),actor=required($('actor').value.trim(),'Enter the receiving staff attribution.');
 let original=C.archive;
 if(original&&original.filename!==file.name)throw Error('The retained original archive has another filename. Keep its saved preview and use a new empty workspace for another delivery.');
 if(!original){original={receiving_id:crypto.randomUUID(),filename:file.name,actor};C.archive=original;await persist();}
 const response=await fetch('/api/receiving/archive',{method:'POST',headers:{'x-workspace-token':token,'x-workspace-id':C.state.workspace.id,'x-workspace-metadata':encodeURIComponent(JSON.stringify({receiving_id:original.receiving_id,filename:original.filename,actor:original.actor})),'Content-Type':'application/octet-stream'},body:file,cache:'no-store'});
 const value=await response.json();if(!response.ok)throw Object.assign(Error(value.message),{code:value.error,status:response.status});
 C.archive=value;$('archive-preview').textContent=json(value);$('restore-archive').disabled=false;await persist();
});
on('restore-archive','click',async()=>{
 const a=required(C.archive?.preview&&C.archive,'Receive and read the complete archive preview first.');
 const r=await mutate('restore-file',{receiving_id:a.receiving_id,filename:a.filename,source_sha256:a.source_sha256});C.archive={...a,completed:r};$('restore-archive').disabled=true;$('archive-preview').textContent=json(C.archive);notice('Received the complete original institutional workspace. Open its retained mapping to continue.');
});
on('save-draft','click',async()=>{const body=snapshot(),context='mapping:'+(C.mapping?.id||C.mapping?.source_id||'source-inventory');await mutate('osf-save-draft',{name:$('draft-name').value||'Complete OSF working draft',context,body});await history();});
on('download-draft','click',()=>downloadBlob(json(snapshot())+'\n','OSF_Transition_Working_Draft.json'));
on('import-draft','click',async()=>{const file=required($('draft-file').files[0],'Choose the original draft JSON.');const v=JSON.parse(await file.text());await restoreDraft(v.body||v);await history();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')persist().catch(()=>{});});
async function initialize(){
 C.loading=true;C.ready=false;document.body.inert=true;document.body.setAttribute('aria-busy','true');
 try{
  await refresh();await db();let tab;
  try{tab=sessionStorage.getItem('osf-transition-tab')||crypto.randomUUID();sessionStorage.setItem('osf-transition-tab',tab);}catch{tab=crypto.randomUUID();}
  C.slot=C.state.workspace.id+':'+tab;const old=await get('current',C.slot);
  if(old)await restoreDraft(old.snapshot);else await persist();
  await history();C.ready=true;notice('Original institutional workspace opened.');
 }catch(error){notice('The original workspace has not finished opening. Use Refresh to retry its saved head. '+error.message,true);throw error;}
 finally{
  C.loading=false;document.body.inert=false;$('main').inert=!C.ready;$('actor').disabled=!C.ready;
  document.querySelectorAll('[data-page]').forEach(button=>button.disabled=!C.ready);
  document.body.removeAttribute('aria-busy');
 }
}
initialize().catch(()=>{});
