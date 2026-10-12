'use strict';
(()=>{
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),json=v=>esc(JSON.stringify(v,null,2)),clone=v=>JSON.parse(JSON.stringify(v)),canonical=v=>JSON.stringify(v);
const A={view:null,schema:null,db:null,key:null,drafts:{},draftTokens:{},draftBases:{},draftConflict:null,selectionToken:null,pending:null,history:[],busy:false,tab:'overview',edition:null,rows:null,rowOffset:0,table:'observations',allEditions:[],preview:null,mappingImport:null,lastResult:null,polling:false};
let selectionEpoch=0;
let token=sessionStorage.getItem('coops-session')||'',epoch=0;
const fragment=location.hash.slice(1);if(/^[A-Za-z0-9_-]{43}$/.test(fragment)){token=fragment;sessionStorage.setItem('coops-session',token);history.replaceState(null,'',location.pathname);}
function notice(message,error=false){$('#notice').textContent=message;$('#notice').className=error?'error':'';}
function badge(value){return'<span class="badge status-'+esc(value)+'">'+esc(value)+'</span>';}
function button(cmd,label,id='',extra=''){return'<button type="button" data-cmd="'+esc(cmd)+'"'+(id?' data-id="'+esc(id)+'"':'')+' '+extra+'>'+esc(label)+'</button>';}
function options(rows,selected,value='id',label='label'){return rows.map(r=>'<option value="'+esc(r[value])+'"'+(r[value]===selected?' selected':'')+'>'+esc(r[label]??r[value])+'</option>').join('');}
function field(form,key,label,value='',type='text',extra=''){return'<label>'+esc(label)+'<input data-form="'+form+'" data-field="'+key+'" name="'+key+'" type="'+type+'" value="'+esc(value)+'" '+extra+'></label>';}
function area(form,key,label,value='',extra=''){return'<label '+extra+'>'+esc(label)+'<textarea data-form="'+form+'" data-field="'+key+'" name="'+key+'">'+esc(value)+'</textarea></label>';}
function select(form,key,label,items,value,extra=''){return'<label>'+esc(label)+'<select data-form="'+form+'" data-field="'+key+'" name="'+key+'" '+extra+'>'+items.map(x=>{const v=typeof x==='string'?x:x.value,l=typeof x==='string'?x:x.label;return'<option value="'+esc(v)+'"'+(v===value?' selected':'')+'>'+esc(l)+'</option>';}).join('')+'</select></label>';}
function subjectBinding(key,value=A.drafts[key]){
 if(key==='station')return{type:'station',id:value?.profileId||null};
 if(key==='mapping')return{type:'mapping',id:value?.mappingId||null};
 if(key.startsWith('review:'))return{type:'review',editionId:key.slice(7),subject:String(value?.subject??'').trim()};
 return null;
}
function recordKey(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return'['+value.map(recordKey).join(',')+']';return'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+recordKey(value[k])).join(',')+'}';}
function savedSubject(binding,view=A.view){
 if(binding.type==='station')return view.stations.find(p=>p.id===binding.id)??null;
 if(binding.type==='mapping')return view.mappings.find(m=>m.id===binding.id)??null;
 return view.annotations.find(a=>a.editionId===binding.editionId&&a.subject===binding.subject)??null;
}
function nativeDraft(binding,record,current){
 if(!record){const value=clone(current);if(binding.type==='station')value.profileId='';if(binding.type==='mapping')value.mappingId='';return value;}
 if(binding.type==='station')return{profileId:record.id,stationId:record.stationId,label:record.label,owner:record.owner,note:record.note,active:record.active};
 if(binding.type==='mapping')return{mappingId:record.id,name:record.name,table:record.table,columns:clone(record.columns),note:record.note};
 return{subject:record.subject,note:record.note,status:record.status};
}
function setDraft(key,value,{known=true}={}){
 A.drafts[key]=clone(value);A.draftTokens[key]=crypto.randomUUID();
 const binding=subjectBinding(key);if(binding)A.draftBases[key]={binding,known,record:clone(savedSubject(binding))};
 if(A.draftConflict?.key===key)A.draftConflict=null;
 return A.drafts[key];
}
function clearDraft(key){delete A.drafts[key];delete A.draftTokens[key];delete A.draftBases[key];if(A.draftConflict?.key===key)A.draftConflict=null;}
function draft(key,defaults){
 if(!Object.hasOwn(A.drafts,key)){
  const binding=subjectBinding(key,defaults),saved=binding?savedSubject(binding):null;
  return setDraft(key,binding?.type==='review'&&saved?nativeDraft(binding,saved,defaults):defaults);
 }
 A.draftTokens[key]??=crypto.randomUUID();
 const binding=subjectBinding(key);
 if(binding&&!A.draftBases[key]){
  const saved=savedSubject(binding),unsaved=(binding.type==='station'||binding.type==='mapping')&&!binding.id;
  A.draftBases[key]={binding,known:unsaved,record:clone(saved)};
 }
 return A.drafts[key];
}
function showDraftConflict(key,binding,current){
 const base=A.draftBases[key];A.draftConflict={key,token:A.draftTokens[key],binding:clone(binding),current:clone(current)};
 modal('Review the changed saved record',
  '<p>The draft stays as entered. Its original saved record has changed, or its earlier baseline is unavailable. Review these versions before choosing which fields to keep. Saving remains a separate action.</p>'+
  details('Draft inputs',A.drafts[key])+details(base?.known?'Original saved version':'Earlier baseline was not retained',base?.known?base.record:null)+details('Current saved version',current)+
  '<div class="actions">'+(current?button('draft-use-current','Use current saved fields'):button('draft-use-current','Keep this as a distinct new record'))+
  button('draft-keep','Keep draft against this reviewed version')+'</div>');
}
function checkDraftSave(key){
 const value=draft(key,{}),binding=subjectBinding(key,value),base=A.draftBases[key],current=savedSubject(binding);
 if(base?.known&&recordKey(base.binding)!==recordKey(binding)&&current===null){
  A.draftBases[key]={binding:clone(binding),known:true,record:null};
 }else if(!base?.known||recordKey(base.binding)!==recordKey(binding)||recordKey(base.record)!==recordKey(current)){
  showDraftConflict(key,binding,current);throw new Error('Review the current saved record before saving this retained draft.');
 }
 return{key,token:A.draftTokens[key],binding:clone(binding)};
}
async function resolveDraftConflict(useCurrent){
 const conflict=A.draftConflict;if(!conflict)throw new Error('Open the current draft comparison first.');
 await refresh(false);
 if(A.draftTokens[conflict.key]!==conflict.token)throw new Error('A different draft is open. Its fields were kept.');
 const binding=subjectBinding(conflict.key),current=savedSubject(binding);
 if(recordKey(binding)!==recordKey(conflict.binding)||recordKey(current)!==recordKey(conflict.current)){
  showDraftConflict(conflict.key,binding,current);throw new Error('The record changed again. Review this current version before continuing.');
 }
 if(useCurrent){
  A.drafts[conflict.key]=nativeDraft(binding,current,A.drafts[conflict.key]);
  A.draftTokens[conflict.key]=crypto.randomUUID();
 }
 const selected=subjectBinding(conflict.key);
 A.draftBases[conflict.key]={binding:clone(selected),known:true,record:clone(savedSubject(selected))};
 A.draftConflict=null;await persist();$('#dialog').close();renderPage();
 notice(useCurrent?'Current saved fields are open. Review and save any intended changes.':'The entered draft is retained against the version you reviewed. Save when ready.');
}
function applyDraftEffect(pending,response){
 const effect=pending.draftEffect;if(!effect)return;
 if(!A.drafts[effect.key]||A.draftTokens[effect.key]!==effect.token){effect.outcome='different_draft_preserved';return;}
 const record=response.result,binding=effect.binding;
 if(!record||typeof record.id!=='string')throw Object.assign(new Error('The saved record identity is missing from the original reply.'),{uncertain:true});
 if(binding.type==='station'||binding.type==='mapping'){
  const field=binding.type==='station'?'profileId':'mappingId',current=A.drafts[effect.key][field]||null;
  if(binding.id&&record.id!==binding.id)throw Object.assign(new Error('The original reply refers to another saved record.'),{uncertain:true});
  if(current&&current!==binding.id&&current!==record.id){effect.outcome='different_record_preserved';return;}
  A.drafts[effect.key][field]=record.id;
 }else if(record.editionId!==binding.editionId||record.subject!==binding.subject){
  throw Object.assign(new Error('The original review reply refers to another edition or subject.'),{uncertain:true});
 }
 const selected=subjectBinding(effect.key);
 if(binding.type!=='review'||recordKey(selected)===recordKey(binding))A.draftBases[effect.key]={binding:clone(selected),known:true,record:clone(record)};
 if(binding.type==='mapping'&&pending.request.payload.mappingSource&&recordKey(A.drafts[effect.key].mappingSource??null)===recordKey(pending.request.payload.mappingSource)){delete A.drafts[effect.key].mappingSource;delete A.drafts[effect.key].mappingSourceReceipt;}
 effect.outcome='saved_identity_applied';effect.savedId=record.id;
}
function details(title,value){return'<details><summary>'+esc(title)+'</summary><pre>'+json(value)+'</pre></details>';}
function table(headers,rows){return'<div class="scroll"><table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function modal(title,body){$('#dialog-content').innerHTML='<h2>'+esc(title)+'</h2>'+body;if(!$('#dialog').open)$('#dialog').showModal();}
function heading(title,description){return'<h1>'+esc(title)+'</h1><p class="muted">'+esc(description)+'</p>';}
async function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open('coops-original-operations',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function stored(value){return new Promise((resolve,reject)=>{const t=A.db.transaction('state',value===undefined?'readonly':'readwrite'),o=t.objectStore('state'),r=value===undefined?o.get(A.key):o.put(value,A.key);let data;r.onsuccess=()=>data=r.result;t.oncomplete=()=>resolve(data);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}
async function persist(){await stored({workspaceId:A.view.workspaceId,drafts:A.drafts,draftTokens:A.draftTokens,draftBases:A.draftBases,selectionToken:A.selectionToken,preview:A.preview,mappingImport:A.mappingImport,pending:A.pending,history:A.history.slice(-100),tab:A.tab,edition:A.edition?.id??null,table:A.table});}
async function api(path,{body}={}){
 const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 let value;try{value=await response.json();}catch{throw Object.assign(new Error('The original response is incomplete. Its pending request remains retained.'),{uncertain:true,status:response.status});}
 if(!response.ok)throw Object.assign(new Error(value.message||value.error||'Workspace HTTP '+response.status),{status:response.status,native:value,uncertain:[401,403,429].includes(response.status)||response.status>=500});
 return value;
}
function adoptView(view){if(!view||view.schema!=='stellar-forge.coops-workspace-view.v1'||view.workspaceId!==A.schema.workspaceId)throw new Error('The saved workspace identity changed.');if(!A.view||view.revision>=A.view.revision)A.view=view;$('#identity').textContent='Workspace '+A.view.workspaceId+' · revision '+A.view.revision;}
function renderPending(){
 const p=A.pending;if(!p){$('#pending').innerHTML='';return;}
 $('#pending').innerHTML='<strong>Original request retained</strong><p>'+esc(p.request.action)+' · <span class="pin">'+esc(p.request.operationId)+'</span> · '+esc(p.state)+'</p>'+(p.error?'<p>'+esc(p.error)+'</p>':'')+'<div class="actions">'+button('retry','Retry this exact request')+button('inspect-pending','Inspect native outcome')+(p.state==='rejected'?button('return-draft','Keep inputs and close this rejected request'):'')+'</div>'+details('Original request',p.request);
}
function applyViewEffects(pending,response){
 const selected=pending.editionEffect;
 if(selected&&A.selectionToken===selected.token){
  if(response.result?.editionId!==selected.edition.id)throw Object.assign(new Error('The original selection reply refers to another source edition.'),{uncertain:true});
  A.edition=clone(selected.edition);A.rowOffset=0;A.rows=null;A.tab='editions';
 }
 const preview=pending.previewEffect;
 if(preview&&A.draftTokens.capture===preview.token&&A.drafts.capture?.mode===preview.kind&&canonical(capturePayload())===preview.payload&&profilePin(A.drafts.capture.profileId)===preview.profile){
  A.preview={kind:preview.kind,payload:preview.payload,profile:preview.profile,result:clone(response.result)};
 }
}
async function perform(action,payload,{draftKey,editionEffect=null,previewEffect=null}={}){
 if(A.pending)throw new Error('Resolve the retained original request before issuing another action.');
 if(A.busy)throw new Error('The current original request is still in progress.');
 const draftEffect=draftKey?checkDraftSave(draftKey):null;
 A.pending={request:{action,payload:clone(payload),operationId:crypto.randomUUID(),expectedRevision:A.view.revision},draftEffect,editionEffect,previewEffect,createdAt:new Date().toISOString(),state:'prepared'};
 await persist();renderPending();return dispatch();
}
async function dispatch(){
 if(!A.pending||A.busy)return;const pending=A.pending;A.busy=true;pending.state='sending';await persist();renderPending();
 try{
  const response=await api('/api/action',{body:pending.request});
  if(response.operationId!==pending.request.operationId||!response.view)throw Object.assign(new Error('The original action reply did not retain its request identity.'),{uncertain:true});
  adoptView(response.view);pending.response=response;pending.state=response.state==='RUNNING'?'running':'complete';if(pending.state==='complete'){applyDraftEffect(pending,response);applyViewEffects(pending,response);}await persist();
  if(pending.state==='running'){notice('The original operation is running. Inspect its native outcome before continuing.');return response;}
  A.history.push({request:pending.request,response,draftEffect:pending.draftEffect??null,editionEffect:pending.editionEffect?{token:pending.editionEffect.token,editionId:pending.editionEffect.edition.id}:null,previewEffect:pending.previewEffect??null,completedAt:new Date().toISOString()});A.pending=null;A.lastResult=response.result;await persist();renderPending();notice('Saved '+pending.request.action+' at revision '+A.view.revision+(response.reused?' · original request replayed.':'.'));
  return response;
 }catch(error){A.pending??=pending;pending.state=error.uncertain?'uncertain':'rejected';pending.error=error.message;pending.status=error.status??null;await persist();renderPending();if([401,403].includes(error.status))notice('Open the current private session URL printed by the original workspace, then retry this retained request.',true);throw error;}
 finally{A.busy=false;}
}
async function refresh(render=true){const view=await api('/api/view');adoptView(view);for(const e of view.editions)if(!A.allEditions.some(x=>x.id===e.id))A.allEditions.push(e);if(render)renderPage();else updateProgress();}
function updateProgress(){for(const c of A.view.captures){for(const node of $$('[data-capture-status="'+CSS.escape(c.id)+'"]'))node.textContent=c.state;}for(const b of A.view.backfills){for(const node of $$('[data-backfill-status="'+CSS.escape(b.id)+'"]'))node.textContent=b.state;}$('#identity').textContent='Workspace '+A.view.workspaceId+' · revision '+A.view.revision;}
async function download(selector){
 const ticket=await api('/api/download-ticket',{body:selector});const a=document.createElement('a');a.href=ticket.url;a.download='';document.body.append(a);a.click();a.remove();
}
function downloadJSON(name,value){const a=document.createElement('a'),u=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function editionOptions(selected){return options(A.allEditions.map(e=>({...e,label:e.profile.label+' · '+e.query.beginDate+' → '+e.query.endDate+' · '+e.id.slice(0,10)})),selected);}
function profileOptions(){return A.view.stations.map(p=>({value:p.id,label:p.label+' · '+p.stationId+(p.active?'':' (archived)')}));}
function progress(c){const done=c.tasks.filter(t=>['COMPLETE','UNAVAILABLE'].includes(t.state)).length;return done+' / '+c.tasks.length+' source requests · '+c.pages.length+' retained responses';}
function renderOverview(){
 const v=A.view;
 return heading('Coastal source workspace','Select original station histories, review their datum and coverage, and deliver explicit model-input files with retained source evidence.')+
 '<div class="cards">'+[['Station profiles',v.stations.length],['Saved source editions',v.editionCount],['Historical studies',v.backfills.length],['Prepared datasets',v.datasets.length]].map(([k,n])=>'<div class="card"><div class="metric">'+n+'</div>'+esc(k)+'</div>').join('')+'</div>'+
 '<h2>Start a source study</h2><div class="actions">'+button('navigate','Station profiles','stations')+button('navigate','Capture a selected period','capture')+button('navigate','Open retained editions','editions')+'</div>'+
 '<p>The La Jolla seven-day recipe is a public reference selection. It creates no source observations until you explicitly start the native NOAA capture.</p>'+
 '<h2>Recent original capture activity</h2>'+captureCards(v.captures.slice(0,6))+details('Actual source contract',A.schema.source)+details('Native publication capabilities',v.capabilities);
}
function captureCards(captures){return captures.length?captures.map(c=>'<article class="card"><h3>'+esc(c.label)+'</h3><p><span data-capture-status="'+esc(c.id)+'">'+esc(c.state)+'</span> · '+esc(progress(c))+'</p><p>'+esc(c.query.beginDate)+' → '+esc(c.query.endDate)+' · '+esc(c.query.datum)+' / '+esc(c.query.units)+' / '+esc(c.query.timeZone)+'</p><div class="actions">'+button('capture-details','Inspect source requests',c.id)+(c.editionId?button('open-edition','Open retained edition',c.editionId):'')+(!['COMPLETE','RUNNING','QUEUED'].includes(c.state)?button('capture-resume','Resume original capture',c.id):'')+(['RUNNING','QUEUED'].includes(c.state)?button('capture-pause','Pause',c.id):'')+'</div>'+(c.error?'<p>'+esc(c.error.message)+'</p>':'')+'</article>').join(''):'<p>No capture has been started.</p>';}
function renderStations(){
 const d=draft('station',{profileId:'',stationId:'',label:'',owner:'',note:'',active:true});
 return heading('Station profiles','Use the original seven-digit NOAA station ID. Coordinates and station name come from captured NOAA metadata.')+
 '<div class="actions">'+button('new-station','New station profile')+button('reference-station','Use La Jolla public reference recipe')+'</div>'+
 table(['Profile','Original station','Responsible team','State',''],A.view.stations.map(p=>[esc(p.label),esc(p.stationId),esc(p.owner),p.active?'Active':'Archived',button('edit-station','Edit',p.id)]))+
 '<form id="station-form"><h2>'+(d.profileId?'Revise saved profile':'New station profile')+'</h2><div class="form-grid">'+field('station','stationId','NOAA station ID',d.stationId,'text','required pattern="[0-9]{7}" maxlength="7"')+field('station','label','Profile name',d.label,'text','required maxlength="160"')+field('station','owner','Responsible team',d.owner)+select('station','active','Profile state',[{value:'true',label:'Active'},{value:'false',label:'Archived'}],String(d.active))+area('station','note','Study purpose and source decisions',d.note,'class="wide"')+'</div><button class="primary" type="submit">Save station profile</button></form>';
}
function renderCapture(){
 const d=draft('capture',{profileId:profileOptions()[0]?.value??'',label:'',beginDate:'',endDate:'',products:['water_level'],units:'metric',timeZone:'gmt',datum:'MLLW',predictionInterval:'6',mode:'capture'});
 const productOptions=A.schema.products.map(p=>'<label><input data-form="capture" data-product="'+esc(p.id)+'" type="checkbox"'+(d.products.includes(p.id)?' checked':'')+'>'+esc(p.label)+'</label>').join('');
 return heading('Capture original sources','Review an explicit provider request plan. Historical studies retain consecutive source editions and resume their unfinished original requests.')+
 '<form id="capture-form"><div class="form-grid">'+select('capture','profileId','Saved station profile',profileOptions(),d.profileId)+field('capture','label','Study or capture name',d.label,'text','required maxlength="200"')+field('capture','beginDate','First service date',d.beginDate,'date','required')+field('capture','endDate','Last service date, inclusive',d.endDate,'date','required')+select('capture','mode','Operation',[{value:'capture',label:'One source edition, up to 366 days'},{value:'backfill',label:'Historical backfill, up to five years'}],d.mode)+select('capture','units','Original provider units',A.schema.units,d.units)+select('capture','timeZone','Provider time basis',A.schema.timeZones,d.timeZone)+select('capture','datum','Requested reference datum',A.schema.datums,d.datum)+select('capture','predictionInterval','Prediction interval',A.schema.predictionIntervals,d.predictionInterval)+'<div class="wide"><label>Separate provider products</label><div class="checks">'+productOptions+'</div></div></div><div class="actions"><button type="submit" class="primary">Review request plan</button>'+button('start-capture','Start the reviewed original requests')+button('reference-dates','Use January 1–7, 2025 reference dates')+'</div></form>'+
 (A.preview?'<section class="panel"><h2>Reviewed request plan</h2><p>'+esc(A.preview.kind)+' · '+esc(A.preview.result.planSha256)+'</p>'+details('Exact provider URLs, dates and original metadata policy',A.preview.result)+'</section>':'')+
 '<h2>Import retained original source package</h2><form id="source-import-form"><label>Complete native source package<input id="source-package" type="file" accept=".json,application/json" required></label><p>The selected station profile above must match the package’s original station. Every source response and digest is verified before native import.</p><button type="submit">Retain original package</button></form><h2>Captures</h2>'+captureCards(A.view.captures);
}
function renderBackfills(){
 return heading('Historical studies','Each study pins its station and source query. Completed annual editions remain intact through later capture failures or operator review.')+
 (A.view.backfills.length?A.view.backfills.map(b=>'<article class="card"><h2>'+esc(b.plan.label)+'</h2><p><span data-backfill-status="'+esc(b.id)+'">'+esc(b.state)+'</span> · '+esc(b.plan.beginDate)+' → '+esc(b.plan.endDate)+'</p>'+
 table(['Original period','State','Retained source edition',''],b.parts.map(p=>[esc(p.query.beginDate+' → '+p.query.endDate),badge(p.state),'<span class="pin">'+esc(p.editionId??'Not yet retained')+'</span>',p.editionId?button('open-edition','Open source edition',p.editionId):'']))+
 '<div class="actions">'+(!['COMPLETE','RUNNING','QUEUED'].includes(b.state)?button('backfill-resume','Resume original study',b.id):'')+(['RUNNING','QUEUED'].includes(b.state)?button('backfill-pause','Pause study',b.id):'')+button('backfill-export','Prepare combined export',b.id)+button('backfill-manifest','Save current study manifest',b.id)+'</div>'+details('Pinned study plan',b.plan)+'</article>').join(''):'<p>Create a historical study from Capture sources.</p>');
}
function renderEditions(){
 const e=A.edition;
 let body=heading('Source editions','Review exact retained sources. A new capture creates another edition; saved reviews and released files remain attached to the earlier edition.')+
 '<div class="actions"><label>Retained edition<select id="edition-select"><option value="">Choose an edition</option>'+editionOptions(e?.id)+'</select></label>'+button('load-edition','Open selected edition')+button('older-editions','Load older editions')+'</div>';
 if(!e)return body+'<p>Select a retained edition to inspect its source rows and datum evidence.</p>';
 body+='<article class="card"><h2>'+esc(e.profile.label)+'</h2><p>'+esc(e.stationMetadata?.name??e.query.stationId)+' · '+badge(e.complete?'SOURCE REQUESTS COMPLETE':'PARTIAL SOURCE')+'</p><p class="pin">Edition '+esc(e.id)+'</p>'+details('Original query and reference basis',e.query)+details('Coverage and metadata summary',e.summary)+'</article>';
 body+='<div class="actions">'+A.schema.tables.map(t=>button('table',t.label,t.id,A.table===t.id?'aria-pressed="true"':'')).join('')+'</div><div id="rows-panel">'+renderRows()+'</div>';
 body+='<h2>Source review</h2>';const d=draft('review:'+e.id,{subject:'Source, datum and coverage review',note:'',status:'open'});
 body+='<form id="review-form"><div class="form-grid">'+field('review:'+e.id,'subject','Review subject',d.subject,'text','required')+select('review:'+e.id,'status','Review decision',A.schema.annotationStatuses,d.status)+area('review:'+e.id,'note','Review note and responsible reviewer',d.note,'class="wide"')+'</div><button type="submit" class="primary">Save source review</button></form>'+details('Retained review history',A.view.annotations.filter(a=>a.editionId===e.id));
 body+='<h2>Original response register</h2>'+table(['Resource','Recorded outcome','Bytes / SHA-256',''],e.pages.map((p,i)=>[esc(p.resource??p.product),esc(p.unavailable?p.reason:'HTTP '+(p.statusObserved??'unrecorded')+' · '+p.records+' records'),esc(p.bytes)+'<br><span class="pin">'+esc(p.sha256)+'</span>',button('source-detail','Receipt',String(i))+button('source-download','Original bytes',String(i))]));
 body+='<div class="actions">'+button('export-edition','Prepare edition export',e.id)+button('coastal-analysis','Build coastal workbook',e.id)+button('new-dataset','Prepare native dataset',e.id)+'</div>';return body;
}
function renderRows(){
 if(!A.rows)return'<p>Open one of the source tables.</p>';const value=A.rows,fields=value.table==='metadata'?['metadataKind','metadataPath','value','valueType']:value.table==='coverage'?['product','field','value','valueType']:['product','timestamp','value','unit','valueType','quality','inferred','excludedSamples'];
 return'<p>'+value.total+' complete selected records · '+value.offset+'–'+(value.offset+value.rows.length)+'</p>'+table([...fields,'Original record'],value.rows.map((r,i)=>[...fields.map(k=>esc(r[k])),button('row-detail','Inspect',String(i))]))+
 '<div class="actions">'+button('rows-prev','Previous page','',''+(value.offset===0?'disabled':''))+button('rows-next','Next page','',''+(value.offset+value.rows.length>=value.total?'disabled':''))+'</div>';
}
function renderCompare(){
 const d=draft('compare',{leftId:'',rightId:'',table:'observations'});
 return heading('Compare retained editions','A comparison preserves source changes, window changes and duplicate keys separately. Different station, datum, units or time basis must be reconciled explicitly.')+
 '<form id="compare-form"><div class="form-grid"><label>Earlier edition<select data-form="compare" data-field="leftId"><option value="">Choose</option>'+editionOptions(d.leftId)+'</select></label><label>Later edition<select data-form="compare" data-field="rightId"><option value="">Choose</option>'+editionOptions(d.rightId)+'</select></label>'+select('compare','table','Original table',A.schema.tables.map(t=>({value:t.id,label:t.label})),d.table)+'</div><button type="submit">Compare selected editions</button></form>'+
 (A.lastResult?.schema==='stellar-forge.coops-comparison.v1'?details('Native comparison and complete export identity',A.lastResult):'')+renderAnalysis();
}
function renderAnalysis(){
 const d=draft('analysis',{observationsEditionId:'',predictionsEditionId:'',quality:'all',begin:'',end:'',excludeInferred:false,excludeToleranceFlags:false,maxSigma:'',upperThreshold:'',lowerThreshold:'',name:'',project:'',question:'',interpretation:'',followUp:''});
 const eligible=product=>A.allEditions.filter(e=>e.query.timeZone==='gmt'&&e.query.products.includes(product)&&(product!=='predictions'||e.query.predictionInterval==='6'))
  .map(e=>({value:e.id,label:e.profile.label+' · '+e.query.stationId+' · '+e.query.beginDate+' → '+e.query.endDate+' · '+e.query.datum+' / '+e.query.units+' · '+e.id.slice(0,10)}));
 return '<section class="card"><h2>Coastal residual workbook</h2><p>Select the retained six-minute GMT observation and prediction editions. A capture containing both products can supply both selections. The workbook carries every original response, source outcome, analysis row and analyst note.</p>'+
 '<form id="analysis-form"><div class="form-grid">'+
 select('analysis','observationsEditionId','Original water-level edition',[{value:'',label:'Choose an observation edition'},...eligible('water_level')],d.observationsEditionId,'required')+
 select('analysis','predictionsEditionId','Original tide-prediction edition',[{value:'',label:'Choose a prediction edition'},...eligible('predictions')],d.predictionsEditionId,'required')+
 select('analysis','quality','Observation quality',['all','verified','preliminary'],d.quality)+
 field('analysis','begin','Optional analysis start (GMT)',d.begin,'datetime-local','step="360"')+
 field('analysis','end','Optional analysis end (GMT)',d.end,'datetime-local','step="360"')+
 select('analysis','excludeInferred','Exclude inferred verified observations',[{value:'false',label:'Keep original inferred observations'},{value:'true',label:'Exclude inferred observations'}],String(d.excludeInferred))+
 select('analysis','excludeToleranceFlags','Exclude flat/rate/height flags',[{value:'false',label:'Keep original flagged observations'},{value:'true',label:'Exclude tolerance-flagged observations'}],String(d.excludeToleranceFlags))+
 field('analysis','maxSigma','Optional maximum sigma (source unit)',d.maxSigma,'number','step="any" min="0"')+
 field('analysis','upperThreshold','Optional upper residual threshold (source unit)',d.upperThreshold,'number','step="any"')+
 field('analysis','lowerThreshold','Optional lower residual threshold (source unit)',d.lowerThreshold,'number','step="any"')+
 field('analysis','name','Analyst',d.name)+field('analysis','project','Project',d.project)+
 area('analysis','question','Engineering question',d.question)+area('analysis','interpretation','Interpretation',d.interpretation)+area('analysis','followUp','Follow-up',d.followUp)+
 '</div><p>Blank date fields use the full overlapping source window. Thresholds use the selected source unit. Missing and ambiguous observations remain explicit in the complete workbook.</p>'+
 '<button type="submit" class="primary">Build and retain complete workbook</button></form></section>';
}
function analysisPayload(){
 const d=clone(A.drafts.analysis);
 if(!d.observationsEditionId||!d.predictionsEditionId)throw new Error('Select both original coastal editions.');
 const options={quality:d.quality,excludeInferred:d.excludeInferred===true||d.excludeInferred==='true',excludeToleranceFlags:d.excludeToleranceFlags===true||d.excludeToleranceFlags==='true'};
 for(const key of ['begin','end'])if(d[key])options[key]=/Z$/.test(d[key])?d[key]:d[key]+(/T\d\d:\d\d$/.test(d[key])?':00Z':'Z');
 for(const key of ['maxSigma','upperThreshold','lowerThreshold'])if(d[key]!==''&&d[key]!==undefined)options[key]=d[key];
 const analyst=Object.fromEntries(['name','project','question','interpretation','followUp'].map(key=>[key,d[key]??'']));
 return{observationsEditionId:d.observationsEditionId,predictionsEditionId:d.predictionsEditionId,options,analyst};
}
function analysisCompletion(result){
 modal('Complete coastal workbook','<p>Station '+esc(result.context.station)+' · '+esc(result.context.datum)+' · '+esc(result.context.unitLabel)+' · GMT</p>'+
 '<p>'+esc(result.coverage.included)+' included pairs across '+esc(result.coverage.expectedSlots)+' original six-minute slots. '+esc(result.files.length)+' complete files are retained in Handoff files.</p>'+
 '<div class="actions">'+button('download-export','Download complete offline workbook',result.workbookExportId)+button('download-export','Download editable portable workbook',result.portableExportId)+'</div>'+
 details('Coverage, original source and analysis',result));
}

function mappingFields(value){return{name:value.name,table:value.table,columns:clone(value.columns),note:value.note};}
function mappingDocument(){
 const d=draft('mapping',{}),record=A.view.mappings.find(m=>m.id===d.mappingId)??null;
 return{schema:'stellar-forge.coops-model-input-mapping-file.v1',role:'operator_mapping',mapping:mappingFields(d),
  source:{workspaceId:A.view.workspaceId,mappingId:d.mappingId||null,revision:record?.revision??null,sourceFile:d.mappingSourceReceipt??record?.sourceFile??null},
  note:'Selected column convention only. Original source values and empty/null distinctions remain unchanged. Receiving record selection is explicit.'};
}
function mappingFileForm(){
 const prior=A.mappingImport,targets='<option value="">Distinct new mapping</option>'+options(A.view.mappings,prior?.targetId??'','id','name');
 modal('Select an original mapping file','<form id="mapping-file-import-form"><label>Original UTF-8 JSON convention (up to 64 KiB)<input id="mapping-file" type="file" accept=".json,application/json"'+(prior?'':' required')+'></label>'+
  (prior?'<p>Retained incoming file: '+esc(prior.file.filename)+' · '+esc(prior.preview.source.bytes)+' bytes · <span class="pin">'+esc(prior.preview.source.sha256)+'</span>. Select another file to replace this incoming selection.</p>':'')+
  '<label>Receiving mapping<select id="mapping-file-target">'+targets+'</select></label><p>Any ID inside the file remains original provenance. Choose a current saved mapping here only when its next revision is intended.</p>'+
  '<label>Intake decision and model owner<textarea id="mapping-file-note" required maxlength="12000">'+esc(prior?.decision??'')+'</textarea></label><button class="primary" type="submit">Inspect file and compare target</button></form>');
}
function mappingFileReview(){
 const incoming=A.mappingImport;if(!incoming)return mappingFileForm();
 const original=incoming.targetRecord;
 modal('Review the incoming mapping convention',
  '<p>The next action opens a browser draft. Save mapping revision remains explicit, with the original file retained in that saved version.</p>'+
  details('Exact selected input file',incoming.preview.source)+details('Incoming convention',incoming.preview.mapping)+
  details(original?'Current receiving mapping · revision '+original.revision:'Distinct receiving mapping',original?mappingFields(original):null)+
  details('Current browser draft that will be replaced',incoming.draftValue)+
  '<p><strong>Intake decision:</strong> '+esc(incoming.decision)+'</p><div class="actions">'+button('mapping-file-apply','Open reviewed file as draft')+button('mapping-file-recompare','Review another target / file')+'</div>');
}
async function inspectMappingFile(form){
 const file=$('#mapping-file').files[0],targetId=$('#mapping-file-target').value,decision=$('#mapping-file-note').value;
 if(!decision.trim()||decision.length>12000)throw new Error('Record the intended model owner and intake decision.');
 const baseDraft=clone(draft('mapping',{})),draftToken=A.draftTokens.mapping;
 let selected=A.mappingImport?.file??null;
 if(file){
  if(!file.size||file.size>(A.schema.limits.mappingFileBytes??65536))throw new Error('Select one nonempty mapping JSON file up to 64 KiB.');
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let start=0;start<bytes.length;start+=8192)binary+=String.fromCharCode(...bytes.subarray(start,start+8192));
  selected={filename:file.name,base64:btoa(binary)};
 }
 if(!selected)throw new Error('Select the original mapping file.');
 await refresh(false);
 const targetRecord=targetId?clone(A.view.mappings.find(m=>m.id===targetId)??null):null;
 if(targetId&&!targetRecord)throw new Error('The chosen receiving mapping is no longer saved.');
 const preview=await api('/api/mapping-file',{body:selected});
 if(!form.isConnected||!$('#dialog').open||$('#mapping-file-target')?.value!==targetId||$('#mapping-file-note')?.value!==decision||$('#mapping-file')?.files[0]!==file||
    A.draftTokens.mapping!==draftToken||recordKey(A.drafts.mapping)!==recordKey(baseDraft)){
  throw new Error('The file selection or draft changed during inspection. The later inputs were kept; inspect them again.');
 }
 A.mappingImport={token:crypto.randomUUID(),file:selected,preview,targetId:targetId||null,targetRecord,decision,draftToken,draftValue:baseDraft,inspectedAt:new Date().toISOString()};
 await persist();mappingFileReview();
}
async function applyMappingFile(){
 const incoming=A.mappingImport;if(!incoming)throw new Error('Inspect the selected original file first.');
 await refresh(false);
 const current=incoming.targetId?A.view.mappings.find(m=>m.id===incoming.targetId)??null:null;
 if(recordKey(current)!==recordKey(incoming.targetRecord))throw new Error('The receiving mapping changed after inspection. Review another target / file to compare its current revision.');
 if(A.draftTokens.mapping!==incoming.draftToken||recordKey(A.drafts.mapping)!==recordKey(incoming.draftValue))throw new Error('A later browser draft is open. Keep it or inspect the incoming file again before replacing its fields.');
 const d={mappingId:incoming.targetId??'',...mappingFields(incoming.preview.mapping),
  mappingSource:{...clone(incoming.file),decision:incoming.decision},mappingSourceReceipt:clone(incoming.preview.source)};
 setDraft('mapping',d);A.mappingImport=null;await persist();$('#dialog').close();A.tab='mappings';renderPage();
 notice('The reviewed file is open as a draft. Edit intended headings, record the decision and explicitly save its mapping revision.');
}
function mappingSourceDetails(d){
 const current=A.view.mappings.find(m=>m.id===d.mappingId),source=d.mappingSourceReceipt??current?.sourceFile;
 return source?details(d.mappingSource?'Selected incoming file · retained when saved':'Original file behind this mapping revision',source):'';
}
function mappingHistory(id){
 const mapping=A.view.mappings.find(m=>m.id===id);if(!mapping)throw new Error('Choose an original saved mapping.');
 const versions=[mapping,...(mapping.history??[])];
 modal('Mapping revisions and original input files',table(['Revision','Convention','Original input file',''],versions.map(m=>[
  String(m.revision),esc(m.name)+'<br>'+esc(m.updatedAt),m.sourceFile?esc(m.sourceFile.filename)+'<br><span class="pin">'+esc(m.sourceFile.sha256)+'</span>':'Entered directly',
  (m.sourceFile?button('mapping-source-download','Download exact input',m.id,'data-revision="'+m.revision+'"'):'')+button('mapping-revision-details','Original convention / adaptations',m.id,'data-revision="'+m.revision+'"')
 ])));
}

function defaultColumns(){return ['editionId','recordId','sourcePageSha256','stationId','timestamp','value','valueType','unit','datum','timeZone','quality','flags'].map(source=>({source,heading:source}));}
function renderMappings(){
 const d=draft('mapping',{mappingId:'',name:'',table:'observations',columns:defaultColumns(),note:''});
 return heading('Model-input mappings','Select original columns and explicit receiving headings. Datum, time and unit conversions stay outside this values-preserving exchange.')+
 table(['Mapping','Table','Revision',''],A.view.mappings.map(m=>[esc(m.name),esc(m.table),String(m.revision),button('edit-mapping','Open',m.id)+button('mapping-history','Revisions / input file',m.id)]))+
 '<div class="actions">'+button('new-mapping','New explicit mapping')+button('mapping-file-open','Select mapping file')+(A.mappingImport?button('mapping-file-resume','Resume incoming file review'):'')+'</div><form id="mapping-form"><div class="form-grid">'+field('mapping','name','Mapping name',d.name,'text','required')+select('mapping','table','Separate source product table',['observations','predictions'],d.table)+'</div><p>Keep editionId, recordId and sourcePageSha256 to join the receiving rows to their complete retained source.</p><div id="mapping-columns">'+d.columns.map((c,i)=>'<div class="columns-row"><label>Original field<select data-column="'+i+'" data-part="source">'+A.schema.columns.map(k=>'<option'+(k===c.source?' selected':'')+'>'+esc(k)+'</option>').join('')+'</select></label><label>Receiving heading<input data-column="'+i+'" data-part="heading" value="'+esc(c.heading)+'" required></label>'+button('remove-column','Remove',String(i))+'</div>').join('')+'</div>'+button('add-column','Add source column')+area('mapping','note','Model owner, intended input and explicit decision',d.note)+mappingSourceDetails(d)+'<div class="actions"><button class="primary" type="submit">Save mapping revision</button>'+button('mapping-json','Download mapping draft')+'</div></form>';
}

function renderDatasets(){
 const d=draft('dataset',{editionId:A.edition?.id??'',table:'observations',name:'',beginDate:'',endDate:'',products:''}),r=draft('release',{datasetId:A.view.datasets[0]?.id??'',origin:'',path:'/coastal',scheme:'exact',network:'stellar:testnet',asset:'',amount:'',payTo:'',maxTimeoutSeconds:'60'});
 return heading('Datasets and original merchant releases','Prepare an explicitly selected immutable SF30 dataset. The original publisher, payment runtime and generation controls own release behavior.')+
 '<form id="dataset-form"><h2>Prepare a source dataset</h2><div class="form-grid"><label>Retained edition<select data-form="dataset" data-field="editionId" required><option value="">Choose</option>'+editionOptions(d.editionId)+'</select></label>'+select('dataset','table','Source table',A.schema.tables.map(t=>({value:t.id,label:t.label})),d.table)+field('dataset','name','Dataset name',d.name,'text','required maxlength="128"')+field('dataset','beginDate','Optional first date inside the edition',d.beginDate,'date')+field('dataset','endDate','Optional last date inside the edition',d.endDate,'date')+field('dataset','products','Optional original product IDs, comma separated',d.products)+'</div><p>Coverage and metadata retain the original edition dates. Data tables may use a narrower period. A larger study keeps its annual source editions and combined streamed exports.</p><button class="primary" type="submit">Prepare original SF30 dataset</button></form>'+
 table(['Dataset','Rows / snapshot','Source edition',''],A.view.datasets.map(x=>[esc(x.name),esc(x.rows)+'<br><span class="pin">'+esc(x.snapshot)+'</span>','<span class="pin">'+esc(x.editionId)+'</span>',button('query-dataset','Query',x.id)+button('dataset-details','Provenance',x.id)+button('choose-release','Use for release',x.id)]))+
 '<form id="release-form"><h2>Prepare a native release</h2><div class="form-grid">'+select('release','datasetId','Saved dataset',A.view.datasets.map(x=>({value:x.id,label:x.name})),r.datasetId)+field('release','origin','Merchant origin',r.origin,'url','required')+field('release','path','Resource path',r.path,'text','required')+select('release','network','Reviewed network',['stellar:testnet','stellar:pubnet'],r.network)+field('release','asset','Original asset',r.asset,'text','required')+field('release','amount','Payment amount in original integer units',r.amount,'text','required pattern="[1-9][0-9]*"')+field('release','payTo','Receiving address',r.payTo,'text','required')+field('release','maxTimeoutSeconds','Payment timeout, seconds',r.maxTimeoutSeconds,'number','required min="1" max="86400" step="1"')+'</div><p>Runtime: '+esc(A.view.capabilities.releaseRuntime.mode)+'. Enter the actual reviewed payment terms. Native activation uses the saved publisher generation.</p><button type="submit">Prepare native release</button></form>'+
 '<h2>Saved releases</h2>'+A.view.releases.map(x=>'<article class="card"><h3>'+esc(x.id)+'</h3><p>'+esc(x.origin??x.resource??'Original publisher selection')+'</p><div class="actions">'+button('release-inspect','Inspect original publisher',x.id)+button('release-control','Activate',x.id,'data-operation="activate"')+button('release-control','Start',x.id,'data-operation="start"')+button('release-control','Stop',x.id,'data-operation="stop"')+button('release-control','Rollback',x.id,'data-operation="rollback"')+'</div>'+details('Original release / publisher generation',x)+'</article>').join('');
}
function renderCustomers(){
 const d=draft('customer',{intentIds:''});
 return heading('Original customer receiving','Use the host-selected SF88 inbox and actual ordered page intents. The native SF100 receiver retains its original complete files.')+
 '<form id="customer-form">'+area('customer','intentIds','Original ordered page intent IDs, one per line',d.intentIds)+'<div class="actions"><button type="submit">Inspect original intents</button>'+button('receive-customer','Receive these completed original pages')+'</div></form>'+
 details('Last native result',A.lastResult)+
 A.view.receipts.map(r=>'<article class="card"><h2>'+esc(r.id)+'</h2>'+details('Original receipt and page order',r)+'<div class="actions">'+(r.downloads??[]).map(d=>button('customer-file',d.name,r.id,'data-file="'+esc(d.name)+'"')).join('')+'</div></article>').join('');
}
function renderExports(){
 return heading('Retained handoff files','Each export pins the original selected source editions, review notes and mapping revision. Downloads stream the retained bytes directly to the browser.')+
 table(['Original file','Source selection','Identity',''],[...A.view.exports].reverse().map(x=>[esc(x.name)+'<br>'+esc(x.format),esc(x.analysisId??x.backfillId??x.editionId??'Comparison')+'<br>'+esc(x.mapping?.name??''),esc(x.bytes)+' bytes<br><span class="pin">'+esc(x.sha256)+'</span>',button('download-export','Download retained file',x.id)+button('export-details','Receipt / source mapping',x.id)]));
}
function renderOperations(){
 return heading('Native operations and request recovery','The original workspace journal reconciles a stable operation ID before checking the current revision. Browser drafts and unresolved requests remain separate from saved source editions.')+
 table(['Operation','State','Original ID / time',''],A.view.operations.map(o=>[esc(o.action),badge(o.state),'<span class="pin">'+esc(o.operationId)+'</span><br>'+esc(o.createdAt),button('operation-detail','Inspect native record',o.operationId)]))+
 details('This browser’s retained completed requests',A.history.map(x=>({request:x.request,completedAt:x.completedAt,result:x.response?.result})));
}
function renderPage(){
 if(!A.view)return;epoch++;$$('[data-tab]').forEach(b=>b.setAttribute('aria-current',b.dataset.tab===A.tab?'page':'false'));
 const render={overview:renderOverview,stations:renderStations,capture:renderCapture,backfills:renderBackfills,editions:renderEditions,compare:renderCompare,mappings:renderMappings,datasets:renderDatasets,customers:renderCustomers,exports:renderExports,operations:renderOperations};
 $('#main').innerHTML=(render[A.tab]??renderOverview)();renderPending();
}
async function navigate(tab){A.tab=tab;await persist();renderPage();$('#main').focus();}
async function loadEdition(id){
 if(A.pending||A.busy)throw new Error('Resolve the retained action before changing the saved edition selection.');
 const generation=++selectionEpoch,selected=await api('/api/edition?editionId='+encodeURIComponent(id));
 if(generation!==selectionEpoch)return;if(selected.id!==id)throw new Error('The returned source edition differs from the selection.');
 A.selectionToken=crypto.randomUUID();await perform('edition.select',{editionId:id},{editionEffect:{token:A.selectionToken,edition:selected}});if(generation!==selectionEpoch)return;
 A.edition=selected;A.rowOffset=0;A.rows=null;A.tab='editions';await loadRows();await persist();renderPage();
}
async function loadRows(){
 if(!A.edition)return;const id=A.edition.id,table=A.table,offset=A.rowOffset,generation=++epoch;
 const rows=await api('/api/rows?'+new URLSearchParams({editionId:id,table,offset:String(offset),limit:'100'}));
 if(A.edition?.id!==id||A.table!==table||A.rowOffset!==offset||generation!==epoch)return;
 A.rows=rows;if(A.tab==='editions'&&$('#rows-panel'))$('#rows-panel').innerHTML=renderRows();
}
function capturePayload(){
 const d=draft('capture',{}),payload={profileId:d.profileId,label:d.label,beginDate:d.beginDate,endDate:d.endDate,products:d.products,units:d.units,timeZone:d.timeZone,datum:d.datum,predictionInterval:d.predictionInterval};
 if(!payload.profileId)throw new Error('Save and select an original station profile first.');return payload;
}
function profilePin(id){return canonical(A.view.stations.find(p=>p.id===id));}
function exportDialog(kind,id){
 const values=kind==='backfill'?['csv','json','jsonl']:A.schema.exportFormats;
 modal('Prepare a retained source export','<form id="export-form" data-kind="'+kind+'" data-id="'+esc(id)+'"><div class="form-grid">'+select('export','table','Separate source table',A.schema.tables.map(t=>({value:t.id,label:t.label})),A.table)+select('export','format','Complete export format',values,'csv')+'<label>Optional saved model-input mapping<select name="mappingId"><option value="">All original columns</option>'+options(A.view.mappings,id,'id','name')+'</select></label></div><p>Mapping selection and every original source edition remain in the export receipt. For large studies, CSV, JSON and JSONL are written incrementally.</p><button type="submit" class="primary">Prepare and retain export</button></form>');
}
async function inspectOperation(id){
 const record=await api('/api/operation?operationId='+encodeURIComponent(id));modal('Original native operation',details('Exact native disposition',record));
 return record;
}
function pendingDescription(p){return{request:p.request,draftEffect:p.draftEffect??null,state:p.state,createdAt:p.createdAt,error:p.error??null};}
async function reconcilePending(){
 const p=A.pending;if(!p)return;const record=await inspectOperation(p.request.operationId);
 if(record.state==='COMPLETE'){notice('The original request is complete. Retry its exact retained request to receive the original result.');}
 else if(record.state==='FAILED'&&record.error?.retryable===false){p.state='rejected';p.error=record.error.message;await persist();renderPending();}
 else notice('Native disposition: '+(record.state??'No reserved operation').toLowerCase()+'. Keep the original request identity for explicit retry.');
}
document.addEventListener('input',event=>{
 const el=event.target;
 if(el.dataset.column!==undefined){const d=draft('mapping',{}),row=d.columns[Number(el.dataset.column)];if(row)row[el.dataset.part]=el.value;}
 else if(el.dataset.product){const d=draft('capture',{});d.products=d.products.filter(p=>p!==el.dataset.product);if(el.checked)d.products.push(el.dataset.product);A.preview=null;}
 else if(el.dataset.form&&el.dataset.field){const d=A.drafts[el.dataset.form]??={};d[el.dataset.field]=el.dataset.field==='active'?el.value==='true':el.type==='checkbox'?el.checked:el.value;if(el.dataset.form==='capture')A.preview=null;}
 else return;
 void persist().catch(error=>notice('The browser could not retain the draft: '+error.message,true));
});
document.addEventListener('change',event=>{if(event.target.matches('select[data-form],select[data-column]'))event.target.dispatchEvent(new Event('input',{bubbles:true}));});
document.addEventListener('submit',event=>{
 const form=event.target;if(!(form instanceof HTMLFormElement))return;event.preventDefault();
 void (async()=>{
  if(form.id==='station-form'){
   const d=clone(draft('station',{}));if(!d.profileId)delete d.profileId;await perform('station.save',d,{draftKey:'station'});await refresh();return;
  }
  if(form.id==='capture-form'){
   const payload=capturePayload(),kind=A.drafts.capture.mode,profile=profilePin(payload.profileId);await perform(kind==='backfill'?'backfill.preview':'capture.preview',payload,{previewEffect:{kind,payload:canonical(payload),profile,token:A.draftTokens.capture}});renderPage();return;
  }
  if(form.id==='source-import-form'){
   const file=$('#source-package').files[0];if(!file||file.size>64*1024*1024)throw new Error('Choose a complete source package up to 64 MiB.');
   const payload={profileId:A.drafts.capture.profileId,label:A.drafts.capture.label||file.name,bundle:await file.text()};await perform('capture.import',payload);await refresh();return;
  }
  if(form.id==='review-form'){const key='review:'+A.edition.id;await perform('annotation.save',{editionId:A.edition.id,...clone(draft(key,{}))},{draftKey:key});renderPage();return;}
  if(form.id==='compare-form'){await perform('edition.compare',clone(A.drafts.compare));renderPage();return;}
  if(form.id==='analysis-form'){
   const saved=await perform('analysis.export',analysisPayload());
   if(saved?.result?.schema==='stellar-forge.coops-retained-analysis.v1')analysisCompletion(saved.result);
   return;
  }
  if(form.id==='mapping-file-import-form'){await inspectMappingFile(form);return;}
  if(form.id==='mapping-form'){const d=draft('mapping',{}),payload={...mappingFields(d),...(d.mappingId?{mappingId:d.mappingId}:{}),...(d.mappingSource?{mappingSource:clone(d.mappingSource)}:{})};await perform('mapping.save',payload,{draftKey:'mapping'});renderPage();return;}
  if(form.id==='dataset-form'){
   const p=clone(A.drafts.dataset);for(const k of ['beginDate','endDate'])if(!p[k])delete p[k];if(p.products.trim())p.products=p.products.split(',').map(x=>x.trim());else delete p.products;
   await perform('dataset.prepare',p);renderPage();return;
  }
  if(form.id==='release-form'){
   const d=A.drafts.release;await perform('release.prepare',{datasetId:d.datasetId,origin:d.origin,path:d.path,payment:{scheme:'exact',network:d.network,asset:d.asset,amount:d.amount,payTo:d.payTo,maxTimeoutSeconds:Number(d.maxTimeoutSeconds)}});renderPage();return;
  }
  if(form.id==='customer-form'){const ids=A.drafts.customer.intentIds.split(/\s+/).filter(Boolean);await perform('buyer.inspect',{intentIds:ids});renderPage();return;}
  if(form.id==='export-form'){
   const v=new FormData(form),payload={table:v.get('table'),format:v.get('format')};if(v.get('mappingId'))payload.mappingId=v.get('mappingId');
   payload[form.dataset.kind==='backfill'?'backfillId':'editionId']=form.dataset.id;
   await perform(form.dataset.kind==='backfill'?'backfill.export':'export.create',payload);$('#dialog').close();await navigate('exports');return;
  }
  if(form.id==='query-form'){
   await perform('dataset.query',{datasetId:form.dataset.id,query:new FormData(form).get('query')});modal('Native dataset response',details('Original query result',A.lastResult));return;
  }
 })().catch(error=>notice(error.message,true));
});
document.addEventListener('click',event=>{
 const control=event.target.closest('button');if(!control)return;
 if(control.dataset.tab){void navigate(control.dataset.tab).catch(e=>notice(e.message,true));return;}
 const cmd=control.dataset.cmd,id=control.dataset.id;
 if(!cmd)return;
 void(async()=>{
  if(cmd==='navigate')return navigate(id);
  if(cmd==='draft-use-current'||cmd==='draft-keep')return resolveDraftConflict(cmd==='draft-use-current');
  if(cmd==='retry'){await dispatch();if(A.edition&&!A.rows)await loadRows();await refresh();return;}
  if(cmd==='inspect-pending')return reconcilePending();
  if(cmd==='return-draft'){
   if(A.pending?.state!=='rejected')throw new Error('Keep an uncertain request until its native disposition is known.');
   A.history.push({...pendingDescription(A.pending),closedAt:new Date().toISOString()});A.pending=null;await persist();renderPending();return;
  }
  if(cmd==='new-station'){clearDraft('station');renderPage();await persist();return;}
  if(cmd==='reference-station'){setDraft('station',{profileId:'',stationId:'9410230',label:'La Jolla (Scripps Pier) public reference',owner:'',note:'Selected regional public-source reference: January 1–7, 2025, water_level, MLLW, metric, GMT. Station metadata and observations will come from the original NOAA capture.',active:true});await persist();renderPage();return;}
  if(cmd==='edit-station'){const p=A.view.stations.find(p=>p.id===id);if(!p)throw new Error('The selected station profile is no longer saved.');setDraft('station',{profileId:p.id,stationId:p.stationId,label:p.label,owner:p.owner,note:p.note,active:p.active});await persist();renderPage();return;}
  if(cmd==='reference-dates'){Object.assign(A.drafts.capture,{beginDate:'2025-01-01',endDate:'2025-01-07',label:'La Jolla public source reference · January 1–7, 2025',products:['water_level'],units:'metric',timeZone:'gmt',datum:'MLLW',predictionInterval:'6',mode:'capture'});A.preview=null;await persist();renderPage();return;}
  if(cmd==='start-capture'){
   const p=capturePayload();if(!A.preview||A.preview.payload!==canonical(p)||A.preview.profile!==profilePin(p.profileId)||A.preview.kind!==A.drafts.capture.mode)throw new Error('Review the exact current request plan before starting it.');
   await perform(A.preview.kind==='backfill'?'backfill.start':'capture.start',p);A.preview=null;await refresh();return;
  }
  if(cmd==='capture-resume'||cmd==='capture-pause'){await perform(cmd==='capture-resume'?'capture.resume':'capture.pause',{captureId:id});await refresh();return;}
  if(cmd==='backfill-resume'||cmd==='backfill-pause'){await perform(cmd==='backfill-resume'?'backfill.resume':'backfill.pause',{backfillId:id});await refresh();return;}
  if(cmd==='backfill-manifest'){downloadJSON('coops-study-'+id+'.json',A.view.backfills.find(b=>b.id===id));return;}
  if(cmd==='backfill-export'){exportDialog('backfill',id);return;}
  if(cmd==='capture-details'){
   const c=A.view.captures.find(c=>c.id===id),all=[...c.pages,...c.failedResponses];
   modal(c.label,details('Original source request ledger',c)+table(['Retained response','Bytes / status',''],all.map((p,i)=>[esc(p.resource??p.product??p.url),esc(p.bytes)+' / '+esc(p.statusObserved??'unrecorded'),button('capture-source-download','Download original',id,'data-page="'+i+'"')])));return;
  }
  if(cmd==='capture-source-download')return download({kind:'capture-source',id,page:Number(control.dataset.page)});
  if(cmd==='open-edition')return loadEdition(id);
  if(cmd==='load-edition'){const selected=$('#edition-select').value;if(!selected)throw new Error('Select one retained source edition.');return loadEdition(selected);}
  if(cmd==='older-editions'){const page=await api('/api/editions?offset='+A.allEditions.length+'&limit=100');for(const e of page.editions)if(!A.allEditions.some(x=>x.id===e.id))A.allEditions.push(e);renderPage();return;}
  if(cmd==='table'){A.table=id;A.rows=null;A.rowOffset=0;await loadRows();await persist();renderPage();return;}
  if(cmd==='rows-prev'||cmd==='rows-next'){A.rowOffset=Math.max(0,A.rowOffset+(cmd==='rows-next'?100:-100));await loadRows();return;}
  if(cmd==='row-detail'){const row=A.rows.rows[Number(id)];modal('Original projected record',details('Value, datum, native flags and exact source locator',row));return;}
  if(cmd==='source-detail'){modal('Original response receipt',details('Native capture receipt',A.edition.pages[Number(id)]));return;}
  if(cmd==='source-download')return download({kind:'source',id:A.edition.id,page:Number(id)});
  if(cmd==='coastal-analysis'){
   const e=A.allEditions.find(e=>e.id===id)??A.edition;
   if(!A.drafts.analysis)renderAnalysis();
   if(e?.query.timeZone==='gmt'){
    if(e.query.products.includes('water_level'))A.drafts.analysis.observationsEditionId=e.id;
    if(e.query.products.includes('predictions')&&e.query.predictionInterval==='6')A.drafts.analysis.predictionsEditionId=e.id;
   }
   await persist();return navigate('compare');
  }
  if(cmd==='export-edition'){exportDialog('edition',id);return;}
  if(cmd==='new-dataset'){A.drafts.dataset={editionId:id,table:A.table,name:A.edition.profile.label+' · '+A.table,beginDate:'',endDate:'',products:''};return navigate('datasets');}
  if(cmd==='mapping-file-open'||cmd==='mapping-file-recompare')return mappingFileForm();
  if(cmd==='mapping-file-resume')return mappingFileReview();
  if(cmd==='mapping-file-apply')return applyMappingFile();
  if(cmd==='mapping-history')return mappingHistory(id);
  if(cmd==='mapping-source-download')return download({kind:'mapping-source',id,page:Number(control.dataset.revision)});
  if(cmd==='mapping-revision-details'){const m=A.view.mappings.find(m=>m.id===id),r=[m,...(m?.history??[])].find(m=>m?.revision===Number(control.dataset.revision));if(!r)throw new Error('The selected original mapping revision is unavailable.');modal('Original mapping revision',details('Saved convention, exact source and adaptations',r));return;}
  if(cmd==='new-mapping'){clearDraft('mapping');renderPage();await persist();return;}
  if(cmd==='edit-mapping'){const m=A.view.mappings.find(m=>m.id===id);if(!m)throw new Error('The selected mapping is no longer saved.');setDraft('mapping',{mappingId:m.id,name:m.name,table:m.table,columns:clone(m.columns),note:m.note});await persist();renderPage();return;}
  if(cmd==='add-column'){A.drafts.mapping.columns.push({source:'value',heading:'value'});await persist();renderPage();return;}
  if(cmd==='remove-column'){A.drafts.mapping.columns.splice(Number(id),1);await persist();renderPage();return;}
  if(cmd==='mapping-json'){downloadJSON('coastal-model-input-mapping.json',mappingDocument());return;}
  if(cmd==='dataset-details'){modal('Original dataset and source identity',details('Native dataset receipt',A.view.datasets.find(d=>d.id===id)));return;}
  if(cmd==='query-dataset'){modal('Query the original SF30 dataset','<form id="query-form" data-id="'+esc(id)+'"><label>Native URL-encoded fields, filters, order or cursor<textarea name="query">limit=20</textarea></label><button type="submit">Run original dataset query</button></form>');return;}
  if(cmd==='choose-release'){A.drafts.release??={origin:'',path:'/coastal',network:'stellar:testnet',asset:'',amount:'',payTo:'',maxTimeoutSeconds:'60'};A.drafts.release.datasetId=id;await persist();renderPage();return;}
  if(cmd==='release-inspect'){await perform('release.inspect',{releaseId:id});modal('Original publisher inspection',details('Native publisher state',A.lastResult));return;}
  if(cmd==='release-control'){
   const operation=control.dataset.operation;
   if(operation==='stop'){await perform('release.stop',{releaseId:id});await refresh();return;}
   const inspected=await perform('release.inspect',{releaseId:id});const result=inspected.result;
   modal('Review original '+operation,'<p>Use the actual publisher generation from this inspection. The original SF82 runtime validates that generation again.</p>'+details('Original inspection',result)+'<form id="release-generation-form" data-id="'+esc(id)+'" data-operation="'+esc(operation)+'"><label>Exact current generation<input name="generation" type="number" min="0" step="1" required></label><button type="submit">Apply original '+esc(operation)+'</button></form>');return;
  }
  if(cmd==='receive-customer'){await perform('buyer.receive',{intentIds:A.drafts.customer.intentIds.split(/\s+/).filter(Boolean)});renderPage();return;}
  if(cmd==='customer-file')return download({kind:'receipt',id,file:control.dataset.file});
  if(cmd==='download-export')return download({kind:'export',id});
  if(cmd==='export-details'){modal('Retained export receipt',details('Original source editions, mapping and byte identity',A.view.exports.find(e=>e.id===id)));return;}
  if(cmd==='operation-detail')return inspectOperation(id);
 })().catch(error=>notice(error.message,true));
});
document.addEventListener('submit',event=>{
 if(event.target.id!=='release-generation-form')return;event.preventDefault();const form=event.target,generation=Number(new FormData(form).get('generation'));
 void perform('release.'+form.dataset.operation,{releaseId:form.dataset.id,expectedGeneration:generation}).then(()=>{$('#dialog').close();return refresh();}).catch(e=>notice(e.message,true));
});
$('#close-dialog').onclick=()=>$('#dialog').close();
$('#refresh').onclick=()=>{void refresh().catch(e=>notice(e.message,true));};
window.addEventListener('beforeunload',event=>{if(A.pending){event.preventDefault();event.returnValue='';}});
async function initialize(){
 try{
  A.schema=await api('/api/schema');A.db=await database();A.key=A.schema.workspaceId;adoptView(await api('/api/view'));
  const saved=await stored();if(saved){if(saved.workspaceId!==A.view.workspaceId)throw new Error('The retained browser journal belongs to another workspace.');A.drafts=saved.drafts??{};A.draftTokens=saved.draftTokens??{};A.draftBases=saved.draftBases??{};A.selectionToken=saved.selectionToken??null;A.preview=saved.preview??null;A.mappingImport=saved.mappingImport??null;A.pending=saved.pending??null;A.history=saved.history??[];A.tab=saved.tab??'overview';A.table=saved.table??'observations';if(saved.edition){A.edition=await api('/api/edition?editionId='+encodeURIComponent(saved.edition));}}
  A.allEditions=[...A.view.editions];renderPage();if(A.edition){await loadRows();renderPage();}
  if(A.pending)notice('An original request is retained. Inspect its native outcome, then retry the same request if needed.');
  setInterval(()=>{if(A.polling||A.busy||document.hidden)return;A.polling=true;void refresh(false).catch(e=>notice(e.message,true)).finally(()=>A.polling=false);},2500);
 }catch(error){notice(error.message,true);$('#main').innerHTML=heading('Open the original private session','Use the current session URL printed by the original workspace command or its managed Applications record. Saved browser drafts and requests stay keyed to the native workspace UUID.');}
}
void initialize();
})();
