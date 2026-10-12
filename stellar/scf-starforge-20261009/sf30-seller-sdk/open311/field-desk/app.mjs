// MIT. Complete municipal field-work planning, portable crew returns, supervisor review and destination delivery.
(async function municipalFieldDesk(){

  'use strict';
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const list=v=>Array.isArray(v)?v:[], clone=v=>JSON.parse(JSON.stringify(v)), pretty=v=>JSON.stringify(v,null,2);
  const short=v=>String(v??'').slice(0,12), human=v=>v===null||v===undefined||v===''?'—':typeof v==='object'?JSON.stringify(v):String(v);
  const label=v=>({in_progress:'In progress',return_to_crew:'Return to crew',request_closure:'Request closure',unable:'Unable to complete'}[v]??String(v??'').replace(/_/g,' '));
  const stamp=v=>v&&Number.isFinite(new Date(v).getTime())?new Date(v).toLocaleString():'—';
  const count=v=>Number(v??0).toLocaleString(), bytes=v=>Number(v)<1024?count(v)+' B':Number(v)<1048576?(Number(v)/1024).toFixed(1)+' KiB':(Number(v)/1048576).toFixed(1)+' MiB';
  const uid=prefix=>prefix+'-'+crypto.randomUUID();
  const statuses=['planned','assigned','in_progress','completed','unable','cancelled'];
  const views=['overview','sources','crews','visits','packages','returns','updates','transfer'];
  const ui={view:'overview',sourceId:'',sourceOffset:0,sourceQuery:'',crewId:'',visitId:'',packageId:'',returnId:'',updateId:'',offset:0,limit:100,query:'',crewFilter:'',sourceFilter:'',statusFilter:'',selected:new Set(),epoch:0,inspection:null,sourceText:'',visitDraft:null,returnChoices:new Map()};
  let workspace=null,launch=null,pending=null,busy=false,dbPromise,formTimer,detail=null,lastError=null;
  const options=(values,chosen,first)=>`${first!==undefined?`<option value="">${esc(first)}</option>`:''}${values.map(v=>{const value=typeof v==='object'?v.id:v,text=typeof v==='object'?v.name:label(v);return `<option value="${esc(value)}"${String(value)===String(chosen)?' selected':''}>${esc(text)}</option>`;}).join('')}`;
  const button=(text,action,attrs='',primary=false)=>`<button type="button" data-action="${esc(action)}"${primary?' class="primary"':''} ${attrs}>${esc(text)}</button>`;
  const exportLink=(text,kind,params={})=>`<a class="button" href="${esc(url('/api/export',{kind,...params}))}" download>${esc(text)}</a>`;
  function url(path,params={}) {const u=new URL(path,location.origin);for(const [k,v]of Object.entries(params))if(v!==null&&v!==undefined&&v!=='')u.searchParams.set(k,String(v));return u.pathname+u.search;}
  function localDate(v){if(!v)return '';const d=new Date(v);if(!Number.isFinite(d.getTime()))return '';const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;}
  function iso(v,original){if(v===localDate(original))return original??null;if(!v)return null;const d=new Date(v);if(!Number.isFinite(d.getTime()))throw new Error('Enter a complete date and time.');return d.toISOString();}
  const timezone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'local device time';
  function showNotice(message){$('#notice').textContent=message;$('#notice').hidden=false;}
  function showError(error){lastError=error;$('#error-message').textContent=error?.message??String(error);$('#error-details').textContent=error?.details?pretty(error.details):'';$('#error').hidden=false;$('#main').setAttribute('aria-busy','false');}
  function clearError(){$('#error').hidden=true;lastError=null;}
  function database(){return dbPromise??=new Promise((resolve,reject)=>{if(!globalThis.indexedDB)return reject(new Error('This browser does not provide local draft storage.'));const r=indexedDB.open('open311-field-desk-browser',1);r.onupgradeneeded=()=>r.result.createObjectStore('records');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  const storageKey=suffix=>'field-desk:'+String(workspace?.directory??launch?.directory??location.origin)+':'+suffix;
  async function localRead(key){try{const db=await database();return await new Promise((resolve,reject)=>{const r=db.transaction('records','readonly').objectStore('records').get(key);r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error);});}catch{try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}}
  async function localWrite(key,value){try{const db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite');if(value===null)tx.objectStore('records').delete(key);else tx.objectStore('records').put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}catch(error){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(value));}}
  async function api(path,body,identity=workspace?.workspaceId){
    let response;
    try{response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json','X-Open311-Field-Desk-Workspace':identity??''})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
    catch(cause){const error=new Error('The workspace connection was interrupted. Recover the saved operation before sending it again.');error.uncertain=body!==undefined;error.cause=cause;throw error;}
    let result;try{result=await response.json();}catch{const error=new Error('The workspace returned an unreadable response.');error.uncertain=body!==undefined;throw error;}
    if(!response.ok||result?.error){const error=new Error(result?.error?.message??'Workspace request failed ('+response.status+').');error.code=result?.error?.code;error.details=result?.error?.details;error.status=response.status;error.uncertain=body!==undefined&&response.status>=500;throw error;}
    return result;
  }
  function header(){
    $('#workspace-name').textContent=workspace?.directory?.split(/[\\/]/).filter(Boolean).pop()||'Field-work desk';
    $('#workspace-meta').textContent='Revision '+(workspace?.revision??'—')+' · '+short(workspace?.workspaceId);
    for(const link of $$('[data-view]'))link.setAttribute('aria-current',link.dataset.view===ui.view?'page':'false');
    $('#main').setAttribute('aria-busy',String(busy));
    for(const b of $$('button')){if(busy&&!b.disabled&&b.dataset.action!=='dismiss-error'&&b.dataset.action!=='close-dialog'){b.dataset.busyDisabled='true';b.disabled=true;}else if(!busy&&b.dataset.busyDisabled){delete b.dataset.busyDisabled;b.disabled=false;}}
    $('#pending').hidden=!pending;
    if(pending)$('#pending-description').textContent=label(pending.path.replace('/api/',''))+' · '+pending.requestId+' · saved '+stamp(pending.createdAt);
  }
  async function refreshState(){workspace=await api('/api/state');header();return workspace;}
  async function reconcilePending(retry=false){
    if(!pending)return null;
    const original=pending;
    const operation=await api(url('/api/operation',{requestId:original.requestId}));
    if(operation?.state==='SUCCEEDED'){pending=null;await localWrite(storageKey('pending'),null);await refreshState();showNotice('Recovered the completed '+label(operation.kind)+' operation.');return operation.result;}
    if(!retry){showNotice('A saved operation has no completed response yet. Use Resume saved operation to send the original request once more.');header();return null;}
    try{
      const result=await api(original.path,original.body,original.workspaceId);pending=null;await localWrite(storageKey('pending'),null);await refreshState();showNotice('The original saved operation completed.');return result;
    }catch(error){if(!error.uncertain){pending=null;await localWrite(storageKey('pending'),null);}header();throw error;}
  }
  async function mutate(path,body){
    if(pending){await reconcilePending(false);if(pending)throw new Error('Resume the saved operation shown above before starting another change.');}
    const requestId=uid('request'), input={...body,requestId,expectedRevision:workspace.revision};
    pending={requestId,path,workspaceId:workspace.workspaceId,body:input,createdAt:new Date().toISOString()};
    await localWrite(storageKey('pending'),pending);header();
    try{const result=await api(path,input,pending.workspaceId);pending=null;await localWrite(storageKey('pending'),null);await refreshState();return result;}
    catch(error){if(!error.uncertain){pending=null;await localWrite(storageKey('pending'),null);}header();throw error;}
  }
  async function work(fn){if(busy)return;busy=true;clearError();header();try{return await fn();}catch(error){showError(error);}finally{busy=false;header();}}
  function formData(form){return Object.fromEntries(new FormData(form));}
  function draftKey(form){return storageKey('form:'+workspace.workspaceId+':'+form.dataset.draft);}

  function returnBasis(result){return JSON.stringify(list(result?.proposals).map(p=>({id:p.id,currentVersionId:p.currentVersionId,status:p.status,sourceChange:p.sourceChange,assignmentChanged:p.assignmentChanged,changes:p.changes})));}
  function formFieldKey(e){
    const row=e.closest('[data-member-id],[data-note-id],[data-resource-id]');
    const owner=row?row.dataset.memberId??row.dataset.noteId??row.dataset.resourceId:'form';
    return owner+':'+e.name+((e.type==='checkbox'||e.type==='radio')?':'+e.value:'');
  }
  async function storeForm(form){
    if(!form?.dataset.draft||!form.isConnected)return;
    const values={};for(const e of [...form.elements])if(e.name&&e.type!=='file'&&!e.disabled)values[formFieldKey(e)]=e.type==='checkbox'||e.type==='radio'?e.checked:e.value;
    const get=(row,name)=>$(`[name="${name}"]`,row)?.value??'';
    const repeaters={
      members:$$('[data-member-id]',form).map(row=>({id:row.dataset.memberId,name:get(row,'memberName'),role:get(row,'memberRole'),contact:get(row,'memberContact')})),
      notes:$$('[data-note-id]',form).map(row=>({id:row.dataset.noteId,author:get(row,'noteAuthor'),text:get(row,'noteText'),recordedAt:get(row,'noteRecorded'),originalRecordedAt:row.dataset.recordedAt??null})),
      resources:$$('[data-resource-id]',form).map(row=>({id:row.dataset.resourceId,kind:get(row,'resourceKind'),name:get(row,'resourceName'),quantity:get(row,'resourceQuantity'),unit:get(row,'resourceUnit'),unitCost:get(row,'resourceCost')||null,currency:get(row,'resourceCurrency')||null,note:get(row,'resourceNote')})),
      attachments:$$('[data-attachment-id]',form).map(row=>({id:row.dataset.attachmentId,filename:$('strong',row)?.textContent??row.dataset.attachmentId,detail:$('small',row)?.textContent??''}))
    };
    await localWrite(draftKey(form),{values,repeaters,at:new Date().toISOString(),visitVersion:ui.visitDraft?.versionId??null,crewVersion:ui.crewDetail?.crew?.versionId??null,returnBasis:form.id==='return-review'?returnBasis(ui.returnDetail):null});
  }
  async function restoreForms(){
    for(const form of $$('form[data-draft]')){
      const saved=await localRead(draftKey(form));if(!saved?.values)continue;
      if(form.id==='return-review'&&saved.returnBasis&&saved.returnBasis!==returnBasis(ui.returnDetail)){ui.staleReturnDraft=saved;const at=$('.draft-state',form);if(at)at.innerHTML='The current visit or source comparison changed after this draft. '+button('Download earlier review draft','download-stale-return-draft');continue;}
      if(form.id==='visit-save'&&saved.visitVersion&&saved.visitVersion!==ui.visitDraft?.versionId){
        ui.staleVisitDraft=saved;const at=$('.draft-state',form);if(at)at.innerHTML='An earlier draft belongs to another visit version. '+button('Download earlier draft','download-stale-draft');continue;
      }
      if(form.id==='crew-save'&&saved.crewVersion&&saved.crewVersion!==ui.crewDetail?.crew?.versionId){ui.staleCrewDraft=saved;const at=$('.draft-state',form);if(at)at.innerHTML='An earlier crew draft belongs to another version. '+button('Download earlier draft','download-stale-crew-draft');continue;}
      const r=saved.repeaters;
      if(r&&form.id==='crew-save')$('#crew-members').innerHTML=memberRows(r.members);
      if(r&&form.id==='visit-save'){
        $('#visit-notes').innerHTML=visitNotes(r.notes);for(const row of $$('[data-note-id]',form)){const prior=r.notes.find(n=>n.id===row.dataset.noteId);if(prior?.originalRecordedAt)row.dataset.recordedAt=prior.originalRecordedAt;}
        $('#visit-resources').innerHTML=visitResources(r.resources);
        $('#visit-attachments').innerHTML=r.attachments.map(attachmentMarkup).join('');
      }
      for(const e of [...form.elements])if(e.name&&e.type!=='file'){
        const key=formFieldKey(e);if(!(key in saved.values))continue;
        if(e.type==='checkbox'||e.type==='radio')e.checked=saved.values[key];else e.value=saved.values[key];
      }
      const at=$('.draft-state',form);if(at)at.textContent='Recovered draft from '+stamp(saved.at);
    }
  }
  async function clearFormDraft(form){if(form?.dataset.draft)await localWrite(draftKey(form),null);}

  function empty(title,text,action=''){return `<section class="empty"><h2>${esc(title)}</h2><p>${esc(text)}</p>${action}</section>`;}
  function heading(title,text,actions=''){return `<div class="page-heading"><div><h1>${esc(title)}</h1><p class="muted">${esc(text)}</p></div><div class="actions">${actions}</div></div>`;}
  function paginator(data,kind){if(!data)return '';const n=list(data.items).length;return `<div class="pagination"><span>${data.total?count(data.offset+1)+'–'+count(data.offset+n)+' of '+count(data.total):'No matching records'}</span><div class="actions">${button('Previous','page',`data-kind="${kind}" data-offset="${Math.max(0,data.offset-data.limit)}"${data.offset<=0?' disabled':''}`)}${button('Next','page',`data-kind="${kind}" data-offset="${data.nextOffset??data.offset}"${data.nextOffset===null||data.nextOffset===undefined?' disabled':''}`)}</div></div>`;}
  function fact(name,value){return `<div><small>${esc(name)}</small><strong>${esc(human(value))}</strong></div>`;}
  function jsonDetail(title,value){return `<details><summary>${esc(title)}</summary><pre>${esc(pretty(value))}</pre></details>`;}
  function sourceTitle(row){const r=row?.request??{};return r.description??r.serviceName??r.service_name??r.summary??r.title??row?.serviceRequestId??row?.key??'Service request';}
  function originalStatus(row){const r=row?.request??{};return r.status??r.sourceStatus??r.statusRaw??r.rawStatus??r.raw?.STATUS??'—';}
  function sourceLinks(row){
    const request=row?.request??{}, values=[request.mediaUrl,request.media_url,...list(request.media).map(v=>typeof v==='string'?v:v?.url)].filter(Boolean);
    const unique=[...new Set(values)].filter(v=>{try{return ['http:','https:'].includes(new URL(v).protocol);}catch{return false;}});
    return unique.length?`<p>Original report media: ${unique.map((v,i)=>`<a href="${esc(v)}" target="_blank" rel="noopener noreferrer">Source file ${i+1}</a>`).join(' · ')}</p>`:'';
  }
  function rowMap(rows){
    const points=[];
    for(const row of rows){const g=row.geometry??row.sourceRow?.geometry;if(g?.type==='Point'&&Array.isArray(g.coordinates)&&g.coordinates.length>=2&&g.coordinates.slice(0,2).every(Number.isFinite)){const [x,y]=g.coordinates;if(Math.abs(x)<=180&&Math.abs(y)<=90)points.push({x,y,id:row.serviceRequestId??row.sourceRow?.serviceRequestId??row.key??'',key:row.key??row.sourceKey??''});}}
    if(!points.length)return '';
    let minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));
    const centerY=(minY+maxY)/2,cos=Math.max(.01,Math.cos(centerY*Math.PI/180)),dx=Math.max((maxX-minX)*cos,.00001),dy=Math.max(maxY-minY,.00001),scale=Math.min(840/dx,300/dy),cx=(minX+maxX)/2,cy=(minY+maxY)/2;
    return `<details><summary>Source location view · ${count(points.length)} points on this page</summary><p class="hint">WGS84 source coordinates, north up. Select a point to open the original request.</p><svg class="location-map" viewBox="0 0 900 360" role="img" aria-label="Source request point locations"><rect x="1" y="1" width="898" height="358" fill="#f1f1ee" stroke="#bbb"/><path d="M30 30V330H870" fill="none" stroke="#bbb"/><text x="14" y="21" font-size="12">N</text>${points.map(p=>`<a href="#sources" data-map-source="${esc(p.key)}"><circle cx="${450+(p.x-cx)*cos*scale}" cy="${180-(p.y-cy)*scale}" r="5" fill="#3e3e3a" stroke="#fff"><title>${esc(p.id)} · ${p.y}, ${p.x}</title></circle></a>`).join('')}</svg><p class="hint">${count(rows.length-points.length)} other row(s) on this page have no usable WGS84 point location.</p></details>`;
  }
  function download(text,name,type='application/json'){const object=new Blob([text],{type}),u=URL.createObjectURL(object),a=document.createElement('a');a.href=u;a.download=name.replace(/[\\/:*?"<>|]/g,'-');a.click();setTimeout(()=>URL.revokeObjectURL(u),60000);}
  const encode64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);};


  async function overviewView(){
    const counts=workspace.counts??{},page=await api(url('/api/visits',{limit:10,offset:0}));
    return heading('Field-work desk','Plan and complete field visits from approved municipal work.',button('Open approved source work','navigate','data-view="sources"'))+
      `<div class="cards">${[['Visits',counts.visits],['Crews',counts.crews],['Awaiting supervisor review',counts.pendingProposals],['Destination packages',counts.updates]].map(([title,n])=>`<section class="card"><small>${esc(title)}</small><strong class="number">${count(n)}</strong></section>`).join('')}</div>
      <div class="split"><section class="panel"><h2>Field outcomes</h2><div class="table-scroll"><table><thead><tr><th>Outcome</th><th>Visits</th></tr></thead><tbody>${statuses.map(s=>`<tr><td>${button(label(s),'filter-status',`data-status="${s}"`)}</td><td>${count(counts.fieldStatuses?.[s])}</td></tr>`).join('')}</tbody></table></div></section><section class="panel"><h2>Current work</h2><ul class="record-list">${list(workspace.returns).filter(r=>Number(r.pendingProposals??r.pending??0)>0).slice(0,5).map(r=>`<li><span><strong>${esc(r.name||r.id)}</strong><br><small>${esc(stamp(r.createdAt))}</small></span>${button('Review return','open-return',`data-id="${esc(r.id)}"`)}</li>`).join('')||'<li class="muted">Returned work appears here after a crew return is imported.</li>'}</ul><div class="actions">${button('Crew packages','navigate','data-view="packages"')}${button('Returned work','navigate','data-view="returns"')}${exportLink('Save complete workspace','workspace')}</div></section></div>
      <section class="panel"><div class="section-heading"><h2>Recent visits</h2>${button('All visits','navigate','data-view="visits"')}</div>${visitTable(page.items,false)}</section>
      ${list(workspace.operations).length?jsonDetail('Recent saved operations',workspace.operations):''}`;
  }
  function visitTable(items,selection=true){
    if(!list(items).length)return '<p class="muted">No matching visits.</p>';
    return `<div class="table-scroll"><table><thead><tr>${selection?'<th><input type="checkbox" data-action="select-page" aria-label="Select all visits on this page"></th>':''}<th>Visit and source request</th><th>Crew</th><th>Planned / due</th><th>Field outcome</th><th>Supervisor</th></tr></thead><tbody>${items.map(v=>`<tr>${selection?`<td><input type="checkbox" data-select-visit="${esc(v.id)}" aria-label="Select ${esc(v.title||v.serviceRequestId)}"${ui.selected.has(v.id)?' checked':''}></td>`:''}<td><button type="button" class="row-title" data-action="open-visit" data-id="${esc(v.id)}">${esc(v.title||v.serviceRequestId||v.id)}</button><span class="subline">${esc(v.serviceRequestId)} · ${esc(label(v.priority))}${v.sourceChanged?' · Source changed':''}</span></td><td>${esc(v.crewName??'Unassigned')}</td><td>${esc(stamp(v.plannedStart))}<span class="subline">Due ${esc(stamp(v.dueAt))}</span></td><td><span class="badge">${esc(label(v.field?.status))}</span></td><td>${esc(approvalLabel(v.approval))}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function approvalLabel(a){if(!a)return 'Awaiting review';if(typeof a==='string')return label(a);if(a.outcome==='approve')return a.current===true?'Approved current version':'Approval needs review';if(a.outcome==='return_to_crew')return 'Returned to crew';return label(a.outcome??a.status??a.state??'Awaiting review');}
  async function sourcesView(){
    if(!ui.sourceId&&workspace.sources?.length)ui.sourceId=workspace.sources.at(-1).id;
    let source=null,page=null;
    if(ui.sourceId){source=await api(url('/api/source',{id:ui.sourceId}));page=await api(url('/api/source-rows',{sourceId:ui.sourceId,q:ui.sourceQuery,offset:ui.sourceOffset,limit:ui.limit}));ui.sourceRows=page.items;ui.sourceDetail=source;}
    return heading('Approved source work','Import a saved dispatch or complete follow-through workspace to plan field visits.')+
      `<details class="panel"${!workspace.sources?.length||ui.inspection?' open':''}><summary>Import approved work</summary><form id="source-import" data-draft="source-import"><div class="form-grid"><label>Source name<input name="name" required placeholder="City programme · approved work"></label><label>Dispatch ID, if the workspace has several<input name="dispatchId" list="source-dispatches" placeholder="Select the saved dispatch"><datalist id="source-dispatches">${list(ui.inspection?.dispatches).map(d=>`<option value="${esc(d.id)}">${esc(d.name)} · ${count(d.rows)} rows</option>`).join('')}</datalist></label><label>Original JSON file<input id="source-file" type="file" accept=".json,application/json"></label></div><label>Complete original JSON<textarea name="originalText" rows="7" spellcheck="false" required>${esc(ui.sourceText)}</textarea></label><p class="hint">Use the original dispatch JSON or complete editable follow-through workspace. Each saved source retains the original bytes and approved relationships.</p><p class="draft-state"></p><div class="actions"><button type="button" data-action="inspect-source">Inspect source</button><button type="submit" class="primary">Import source</button></div></form>${ui.inspection?jsonDetail('Source inspection',ui.inspection):''}</details>
      ${workspace.sources?.length?`<form id="source-filter" class="filters"><label>Saved source<select name="sourceId">${options(workspace.sources.map(s=>({id:s.id,name:s.name+' · '+s.rows+' rows'})),ui.sourceId)}</select></label><label class="search">Search approved work<input name="q" value="${esc(ui.sourceQuery)}" type="search" placeholder="Request, description or work"></label><button type="submit">Apply</button></form>`:''}
      ${source?`<div class="facts">${fact('Source',source.source.name)}${fact('Approved rows',source.source.rows)}${fact('Created',stamp(source.source.createdAt))}${fact('Saved dispatch',source.source.dispatchId)}</div><div class="actions">${exportLink('Download original source','source',{sourceId:ui.sourceId})}${button('Plan a visit from this source','new-visit')}</div>${rowMap(page.items)}
      <div class="table-scroll"><table><thead><tr><th>Request</th><th>Source status</th><th>Approved work</th><th>Location</th><th></th></tr></thead><tbody>${list(page.items).map(row=>`<tr><td><button class="row-title" type="button" data-action="source-detail" data-key="${esc(row.key)}">${esc(row.serviceRequestId||row.key)}</button><span class="subline">${esc(sourceTitle(row))}</span></td><td>${esc(human(originalStatus(row)))}</td><td>${esc(label(row.work?.action??row.work?.kind??row.work?.type??'Assigned work'))}<span class="subline">${esc(row.work?.assignee??row.work?.assignedTo??row.work?.title??'')}</span></td><td>${row.geometry?.type==='Point'?'Source point':'No point'}</td><td>${button('Plan visit','visit-from-source',`data-key="${esc(row.key)}"`)}</td></tr>`).join('')||'<tr><td colspan="5">No matching approved work.</td></tr>'}</tbody></table></div>${paginator(page,'source')}${jsonDetail('Saved source identity',source.source)}`:empty('Start with approved municipal work','Import a saved dispatch or full editable follow-through workspace. The field desk will retain the source request, related orders and approved work with each visit.')}`;
  }
  function memberRows(members){
    return list(members).map(m=>`<div class="member-row form-grid" data-member-id="${esc(m.id||uid('member'))}"><label>Member name<input name="memberName" value="${esc(m.name)}" required></label><label>Role<input name="memberRole" value="${esc(m.role)}"></label><label>Contact<input name="memberContact" value="${esc(m.contact)}"></label><button type="button" data-action="remove-member">Remove member</button></div>`).join('');
  }
  async function crewsView(){
    const result=ui.crewId?await api(url('/api/crew',{id:ui.crewId})):null;ui.crewDetail=result;const c=result?.crew??{name:'',members:[],note:'',active:true};
    return heading('Crews','Name the people responsible for field visits and keep their contact details with the assigned work.',button('New crew','new-crew'))+
      `<div class="two-column"><section><h2>Saved crews</h2>${list(workspace.crews).map(crew=>button('', 'open-crew',`data-id="${esc(crew.id)}" class="list-choice" aria-current="${crew.id===ui.crewId}"`).replace('></button>',`><span><span class="choice-title">${esc(crew.name)}</span><span class="choice-meta">${list(crew.members).length} members · ${crew.active?'Active':'Inactive'}</span></span></button>`)).join('')||'<p class="muted">No crews saved.</p>'}</section><section class="panel"><h2>${c.id?'Edit crew':'Create a crew'}</h2><form id="crew-save" data-draft="crew:${esc(c.id||'new')}"><label>Crew name<input name="name" value="${esc(c.name)}" required></label><label class="check"><input type="checkbox" name="active"${c.active!==false?' checked':''}> Available for assignments</label><div class="section-heading"><h3>Members</h3>${button('Add member','add-member')}</div><div id="crew-members">${memberRows(c.members)}</div><label>Crew note<textarea name="note" rows="4">${esc(c.note)}</textarea></label><p class="draft-state"></p><button type="submit" class="primary">Save crew</button></form>${result?jsonDetail('Crew history',result.history):''}</section></div>`;
  }
  function selectedBar(){return ui.selected.size?`<div class="selected-bar"><strong>${count(ui.selected.size)} visits selected</strong><div class="actions">${button('Create crew package','selection-package')}${button('Review selected visits','selection-review')}${button('Prepare destination update','selection-update')}${button('Clear selection','clear-selection')}</div></div>`:'';}
  async function visitsView(){
    if(ui.visitId||ui.newVisit)return visitDetailView();
    const page=await api(url('/api/visits',{q:ui.query,crewId:ui.crewFilter,sourceId:ui.sourceFilter,status:ui.statusFilter,offset:ui.offset,limit:ui.limit}));ui.visitPage=page;
    return heading('Visits and field records','Assign work, record field outcomes, and review the exact visit version for delivery.',button('Plan visit','new-visit','',true))+
      `<form id="visit-filter" class="filters"><label class="search">Search<input name="q" type="search" value="${esc(ui.query)}" placeholder="Visit, request or work"></label><label>Crew<select name="crewId">${options(workspace.crews,ui.crewFilter,'All crews')}</select></label><label>Source<select name="sourceId">${options(workspace.sources,ui.sourceFilter,'All sources')}</select></label><label>Field outcome<select name="status">${options(statuses,ui.statusFilter,'All outcomes')}</select></label><button type="submit">Apply</button></form>${selectedBar()}${visitTable(page.items)}${paginator(page,'visits')}<div class="actions">${exportLink('Visit register CSV','visits-csv')}</div>`;
  }
  function visitNotes(notes){return list(notes).map(n=>`<div class="note-row" data-note-id="${esc(n.id)}"><div class="form-grid"><label>Author<input name="noteAuthor" value="${esc(n.author)}" required></label><label>Recorded<input name="noteRecorded" type="datetime-local" value="${esc(localDate(n.recordedAt))}" required></label><button type="button" data-action="remove-note">Remove note</button></div><label>Note<textarea name="noteText" rows="2" required>${esc(n.text)}</textarea></label></div>`).join('');}
  function visitResources(resources){return list(resources).map(r=>`<tr data-resource-id="${esc(r.id)}"><td><select name="resourceKind" aria-label="Resource type">${options(['labor','material','equipment','other'],r.kind)}</select></td><td><input name="resourceName" class="resource-name" aria-label="Resource name" value="${esc(r.name)}" required><input name="resourceNote" aria-label="Resource note" placeholder="Optional note" value="${esc(r.note)}"></td><td><input name="resourceQuantity" aria-label="Quantity" inputmode="decimal" value="${esc(r.quantity)}" required></td><td><input name="resourceUnit" aria-label="Unit" value="${esc(r.unit)}" required></td><td><input name="resourceCost" aria-label="Unit cost" inputmode="decimal" value="${esc(r.unitCost)}" placeholder="Optional"></td><td><input name="resourceCurrency" aria-label="Currency" value="${esc(r.currency)}" placeholder="USD"></td><td>${button('Remove','remove-resource')}</td></tr>`).join('');}
  function resourceTotals(resources){
    const groups=new Map();
    const decimal=s=>{const m=String(s).match(/^(\d+)(?:\.(\d+))?$/);return m?{n:BigInt(m[1]+(m[2]||'')),p:(m[2]||'').length}:null;};
    const add=(a,b)=>{if(!a)return b;const p=Math.max(a.p,b.p);return{n:a.n*10n**BigInt(p-a.p)+b.n*10n**BigInt(p-b.p),p};};
    const display=a=>{const raw=a.n.toString().padStart(a.p+1,'0');return a.p?raw.slice(0,-a.p)+'.'+raw.slice(-a.p):raw;};
    for(const r of list(resources)){const q=decimal(r.quantity);if(!q)continue;const k=JSON.stringify([r.kind,r.unit,r.currency??null]),g=groups.get(k)??{kind:r.kind,unit:r.unit,currency:r.currency??null,quantity:null,cost:null};g.quantity=add(g.quantity,q);const c=decimal(r.unitCost);if(c)g.cost=add(g.cost,{n:q.n*c.n,p:q.p+c.p});groups.set(k,g);}
    return groups.size?`<details><summary>Resource totals by unit and currency</summary><div class="table-scroll"><table class="resource-summary"><thead><tr><th>Type</th><th>Unit</th><th>Quantity</th><th>Recorded cost</th></tr></thead><tbody>${[...groups.values()].map(g=>`<tr><td>${esc(label(g.kind))}</td><td>${esc(g.unit)}</td><td>${display(g.quantity)}</td><td>${g.cost?display(g.cost)+' '+esc(g.currency):'—'}</td></tr>`).join('')}</tbody></table></div></details>`:'';
  }
  async function visitDetailView(){
    const result=ui.visitId?await api(url('/api/visit',{id:ui.visitId})):null;
    let v=result?.visit??ui.newVisit??{},f=v.field??{status:'planned',actualStart:null,actualEnd:null,completionNote:'',notes:[],resources:[],attachmentIds:[]};
    if(!v.sourceId)v.sourceId=ui.sourceId||workspace.sources?.at(-1)?.id||'';
    if(!v.sourceKey)v.sourceKey=ui.newSourceRow?.key||'';
    ui.visitDetail=result;ui.visitDraft=clone({...v,field:f});
    const row=result?.sourceRow??ui.newSourceRow;
    const crew=workspace.crews.find(c=>c.id===v.crewId);
    const attachments=list(result?.attachments);
    return heading(v.id?v.title||'Field visit':'Plan a field visit','Keep the assigned source work and the recorded field outcome together.',button('Back to visits','visits-list'))+
      (result?`<div class="facts">${fact('Source request status',originalStatus(row))}${fact('Field outcome',label(f.status))}${fact('Supervisor',approvalLabel(result.approval))}${fact('Current visit version',short(v.versionId))}</div>`:'')+
      (result?.sourceChange?.changed?`<section class="review-summary"><strong>Source edition review</strong><p>Inspect the current source comparison before choosing a new source edition for this visit.</p>${jsonDetail('Source comparison',result.sourceChange)}</section>`:'')+
      `<form id="visit-save" data-draft="visit:${esc(v.id||'new')}"><section class="panel"><h2>Visit plan</h2><div class="form-grid"><label class="span-all">Visit title<input name="title" required value="${esc(v.title||sourceTitle(row)||'')}"></label><label>Approved source<select name="sourceId" required>${options(workspace.sources,v.sourceId,'Choose a saved source')}</select></label><label>Source row key<input name="sourceKey" value="${esc(v.sourceKey)}" required></label><label>Crew<select name="crewId">${options(workspace.crews.filter(c=>c.active||c.id===v.crewId),v.crewId,'Unassigned')}</select></label><label>Planned start<input name="plannedStart" type="datetime-local" value="${esc(localDate(v.plannedStart))}"></label><label>Planned end<input name="plannedEnd" type="datetime-local" value="${esc(localDate(v.plannedEnd))}"></label><label>Due at<input name="dueAt" type="datetime-local" value="${esc(localDate(v.dueAt))}"></label><label>Priority<select name="priority">${options(['low','normal','high','urgent'],v.priority||'normal')}</select></label></div><p class="hint">Date entry uses ${esc(timezone())}; the workspace stores UTC instants. Selecting a source successor is an explicit visit update.</p><label>Work instructions<textarea name="instructions" rows="4">${esc(v.instructions||'')}</textarea></label></section>
      <section class="panel"><h2>Field record</h2><div class="form-grid"><label>Field outcome<select name="fieldStatus">${options(statuses,f.status)}</select></label><label>Actual start<input name="actualStart" type="datetime-local" value="${esc(localDate(f.actualStart))}"></label><label>Actual end<input name="actualEnd" type="datetime-local" value="${esc(localDate(f.actualEnd))}"></label></div><label>Completion or exception note<textarea name="completionNote" rows="4">${esc(f.completionNote)}</textarea></label><div class="section-heading"><h3>Field notes</h3>${button('Add note','add-note')}</div><div id="visit-notes">${visitNotes(f.notes)}</div><div class="section-heading"><h3>Labor, materials and equipment</h3>${button('Add resource','add-resource')}</div><div class="table-scroll"><table><thead><tr><th>Type</th><th>Resource and note</th><th>Quantity</th><th>Unit</th><th>Unit cost</th><th>Currency</th><th></th></tr></thead><tbody id="visit-resources">${visitResources(f.resources)}</tbody></table></div><p class="hint">Use explicit units and nonnegative decimal quantities. A unit cost requires its currency.</p>${resourceTotals(f.resources)}
      <div class="section-heading"><h3>Visit files</h3><label class="file-input">Add files<input id="visit-files" type="file" multiple></label></div><ul id="visit-attachments" class="record-list">${list(f.attachmentIds).map(id=>{const a=attachments.find(x=>x.id===id);return `<li data-attachment-id="${esc(id)}"><span><strong>${esc(a?.filename||id)}</strong><br><small>${a?bytes(a.bytes)+' · '+esc(a.contentType):''}</small></span><div class="actions"><a class="button" href="${esc(url('/api/attachment',{id}))}" download>Download</a>${button('Remove from visit','remove-attachment')}</div></li>`;}).join('')}</ul></section><p class="draft-state"></p><div class="sticky-actions"><button type="submit" class="primary">${v.id?'Save visit changes':'Create visit'}</button>${v.id?button('Review this saved visit','review-visit',`data-id="${esc(v.id)}"`):''}<span class="hint">Each save creates a version. Supervisor approval applies to the reviewed version.</span></div></form>
      ${row?`<section class="panel"><h2>Original municipal work</h2><p>${esc(sourceTitle(row))}</p>${sourceLinks(row)}${jsonDetail('Original request',row.request)}${jsonDetail('Confirmed related orders',row.orders)}${jsonDetail('Approved work',row.work)}${rowMap([row])}</section>`:''}${result?jsonDetail('Visit version history',result.history):''}`;
  }


  const packageSize=p=>Array.isArray(p.visits)?p.visits.length:p.visitCount??p.visits??p.count??0;
  async function selectedVisits(){const ids=[...ui.selected];if(!ids.length)return [];return Promise.all(ids.map(id=>api(url('/api/visit',{id}))));}
  function packageChoices(items,selected,action){return list(items).map(p=>`<button type="button" class="list-choice" data-action="${esc(action)}" data-id="${esc(p.id)}" aria-current="${selected===p.id}"><span><span class="choice-title">${esc(p.name||p.id)}</span><span class="choice-meta">${esc(stamp(p.createdAt))}</span></span></button>`).join('');}
  async function packagesView(){
    const result=ui.packageId?await api(url('/api/package',{id:ui.packageId})):null;
    const selected=await selectedVisits();ui.packageSelection=selected;
    const packet=result?.package;
    return heading('Crew packages','Send complete visit instructions in a portable editor that crews can use offline.')+
      `<section class="panel"><h2>Create a crew package</h2>${selected.length?`<p>${selected.length} selected visits will travel with their assigned source records, crew details and existing files.</p><ul>${selected.map(x=>`<li>${esc(x.visit.title||x.visit.serviceRequestId)} · ${esc(x.crew?.name||'Unassigned')} · ${esc(label(x.visit.field?.status))}</li>`).join('')}</ul>`:`<p>Select visits from the visit register to prepare a crew package.</p>${button('Select visits','navigate','data-view="visits"')}`}
      <form id="package-create" data-draft="package-create"><div class="form-grid"><label class="span-all">Package name<input name="name" required placeholder="Crew and operating date"></label></div><label>Instructions accompanying this package<textarea name="note" rows="3"></textarea></label><p class="draft-state"></p><button type="submit" class="primary"${selected.length?'':' disabled'}>Create saved crew package</button></form></section>
      <div class="two-column"><section><h2>Saved packages</h2>${packageChoices(workspace.packages,ui.packageId,'open-package')||'<p class="muted">No crew packages saved.</p>'}</section>
      <section>${packet?`<div class="panel"><h2>${esc(packet.name)}</h2><p>${esc(packet.note)}</p><div class="facts">${fact('Visits',list(packet.visits).length)}${fact('Created',stamp(packet.createdAt))}${fact('Original revision',packet.workspaceRevision)}${fact('Existing files',list(packet.attachments).length)}</div><div class="actions">${exportLink('Download offline crew editor','crew-html',{packageId:packet.id})}${exportLink('Download original package JSON','crew-json',{packageId:packet.id})}</div><p class="hint">Open the HTML file directly in a browser. The crew records its field changes and returns one JSON file for supervisor review.</p>${visitTable(list(packet.visits).map(x=>({...x.visit,crewName:x.crew?.name})),false)}${jsonDetail('Package identity',{id:packet.id,workspaceId:packet.workspaceId,workspaceRevision:packet.workspaceRevision,sha256:packet.sha256})}</div>`:empty('Open a saved crew package','Choose a package to download its complete offline editor or original JSON.')}</section></div>`;
  }
  function returnProposals(result){
    const returned=result.return, proposals=list(result.proposals);
    ui.returnDetail=result;
    return `<section class="panel"><h2>${esc(returned.name||returned.id)}</h2><div class="facts">${fact('Returned by',returned.returnedBy)}${fact('Created',stamp(returned.createdAt))}${fact('Proposals',proposals.length)}${fact('Original package',result.package?.name||result.package?.id)}</div><p>${esc(returned.note||'')}</p><div class="actions">${exportLink('Download original return','returned',{returnId:returned.id})}${button('Refresh current versions','refresh-return')}</div></section>
      <form id="return-review" data-draft="return:${esc(returned.id)}"><div class="panel"><div class="form-grid"><label>Supervisor / reviewer<input name="reviewer" autocomplete="name" required></label><label class="span-all">Review note<textarea name="note" rows="3"></textarea></label></div></div>
      ${proposals.map((p,index)=>`<section class="review-proposal" data-proposal-id="${esc(p.id)}"><div class="section-heading"><div><p class="eyebrow">Proposal ${index+1} · ${esc(p.visitId)}</p><h3>${esc(p.title||'Returned visit changes')}</h3><p class="muted">Crew base ${esc(short(p.baseVersionId))} · current ${esc(short(p.currentVersionId))}</p></div><span class="badge">${esc(label(p.status))}</span></div>
      ${p.sourceChange?.changed?`<div class="review-summary"><strong>Source comparison</strong>${jsonDetail('Source details',p.sourceChange)}${p.status==='pending'?`<label class="check"><input type="checkbox" name="sourceAck:${esc(p.id)}"> I reviewed the source changes for this decision.</label>`:''}</div>`:''}
      ${p.assignmentChanged?`<div class="review-summary"><strong>The assigned visit changed after this crew package was created.</strong>${p.status==='pending'?`<label class="check"><input type="checkbox" name="assignmentAck:${esc(p.id)}"> I reviewed the changed assignment for this decision.</label>`:''}</div>`:''}
      ${list(p.changes).map(c=>`<div class="field-change"><strong>${esc(Array.isArray(c.path)?c.path.join(' / '):c.path)}${c.conflict?' · overlapping changes':''}</strong><div class="form-grid"><div><small>Sent to the crew</small><pre>${esc(pretty(c.base)??'No value')}</pre></div><div><small>Current workspace</small><pre>${esc(pretty(c.current)??'No value')}</pre></div><div><small>Returned by the crew</small><pre>${esc(pretty(c.returned)??'No value')}</pre></div></div>${c.conflict&&p.status==='pending'?`<fieldset><legend>Choose the value to keep if you accept this proposal</legend><label class="check"><input type="radio" name="choice:${esc(p.id)}:${esc(c.id)}" value="returned"> Returned value</label><label class="check"><input type="radio" name="choice:${esc(p.id)}:${esc(c.id)}" value="current"> Current value</label></fieldset>`:''}</div>`).join('')||'<p>No field changes in this proposal.</p>'}
      ${p.status==='pending'?`<div class="decision-choice form-grid"><label>Decision<select name="decision:${esc(p.id)}">${options([{id:'later',name:'Leave for later'},{id:'accept',name:'Accept reviewed changes'},{id:'reject',name:'Reject these changes'}],'later')}</select></label><label class="span-all">Decision note<textarea name="note:${esc(p.id)}" rows="2"></textarea></label></div>`:''}</section>`).join('')}
      ${proposals.some(p=>p.status==='pending')?`<p class="draft-state"></p><div class="sticky-actions"><button type="submit" class="primary">Save selected review decisions</button><span class="hint">Proposals left for later remain pending. Each accepted decision creates and approves a specific visit version.</span></div>`:''}</form>${jsonDetail('Saved supervisor decisions',result.decisions)}`;
  }
  async function returnsView(){
    const result=ui.returnId?await api(url('/api/return',{id:ui.returnId})):null;
    return heading('Returned work','Review crew changes against the original assignment and the current workspace.')+
      `<details class="panel"${!workspace.returns?.length?' open':''}><summary>Import a crew return</summary><form id="return-import" data-draft="return-import"><div class="form-grid"><label>Return label<input name="name" placeholder="Optional label"></label><label>Returned JSON file<input id="return-file" type="file" accept=".json,application/json"></label></div><label>Complete returned JSON<textarea name="originalText" rows="7" required spellcheck="false"></textarea></label><p class="hint">Use the return exported by the portable crew editor. Omitted visits and fields remain unchanged.</p><p class="draft-state"></p><button type="submit" class="primary">Import returned work</button></form></details>
      <form id="return-select" class="filters"><label>Saved return<select name="returnId">${options(list(workspace.returns),ui.returnId,'Select returned work')}</select></label><button type="submit">Open return</button></form>${result?returnProposals(result):empty('Choose returned work for review','Open a saved crew return to see its original assignment, current workspace values and returned changes.')}`;
  }
  async function updatesView(){
    const selected=await selectedVisits();ui.updateSelection=selected;
    const result=ui.updateId?await api(url('/api/update',{id:ui.updateId})):null;
    const update=result?.update;
    return heading('Destination updates','Prepare an explicit delivery from supervisor-approved visit versions.')+
      `<section class="panel"><h2>Prepare a destination update package</h2><p>Each item is bound to the approved source and visit version. Select the intended destination and action for each item.</p>${!selected.length?button('Select approved visits','navigate','data-view="visits"'):''}
      <form id="update-create" data-draft="update-create"><div class="form-grid"><label>Package name<input name="name" required></label><label>Reviewer<input name="reviewer" autocomplete="name" required></label><label>Destination name<input name="destinationName" placeholder="Customer operations team" required></label><label>Destination system<input name="destinationSystem" placeholder="Named service or work-order system" required></label><label>Destination reference<input name="destinationReference" placeholder="Customer, account, project or endpoint reference"></label></div><label>Delivery note<textarea name="note" rows="3"></textarea></label>
      ${selected.length?`<div class="table-scroll"><table><thead><tr><th>Selected visit</th><th>Field outcome / supervisor</th><th>Destination action</th><th>Destination item reference</th><th>Item note</th></tr></thead><tbody>${selected.map(x=>`<tr data-update-visit="${esc(x.visit.id)}"><td>${esc(x.visit.title||x.visit.serviceRequestId)}<span class="subline">Version ${esc(short(x.visit.versionId))}</span></td><td>${esc(label(x.visit.field?.status))}<span class="subline">${esc(approvalLabel(x.approval))}</span></td><td><select name="action:${esc(x.visit.id)}">${options([{id:'update',name:'Update field information'},{id:'request_closure',name:'Request destination closure'}],'update')}</select></td><td><input name="reference:${esc(x.visit.id)}"></td><td><input name="itemNote:${esc(x.visit.id)}"></td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No visits selected.</p>'}<p class="hint">Request closure only for completed field work approved by a supervisor. The package records the intended update for the named destination.</p><p class="draft-state"></p><button type="submit" class="primary"${selected.length?'':' disabled'}>Create saved destination package</button></form></section>
      <div class="two-column"><section><h2>Saved destination packages</h2>${packageChoices(workspace.updates,ui.updateId,'open-update')||'<p class="muted">No destination packages saved.</p>'}</section><section>${update?`<div class="panel"><h2>${esc(update.name)}</h2><p>${esc(update.note)}</p><div class="facts">${fact('Destination',update.destination?.name)}${fact('System',update.destination?.system)}${fact('Reviewer',update.reviewer)}${fact('Created',stamp(update.createdAt))}</div><div class="actions">${exportLink('JSON','update-json',{updateId:update.id})}${exportLink('CSV','update-csv',{updateId:update.id})}${exportLink('GeoJSON','update-geojson',{updateId:update.id})}${exportLink('Report','update-report',{updateId:update.id})}</div>${jsonDetail('Complete destination package',update)}</div>`:empty('Open a saved destination package','Choose a package to download the customer delivery or its complete report.')}</section></div>`;
  }
  async function transferView(){
    const populated=Object.entries(workspace.counts??{}).some(([k,v])=>k!=='fieldStatuses'&&Number(v)>0);
    return heading('Open a handover','Continue a complete field-work workspace with its original sources, visits, files and history.')+
      `<section class="panel"><h2>Save the current workspace</h2><p>The editable JSON carries complete source records, saved visits and versions, crew packages, original returns, decisions, destination packages, and file bytes.</p><div class="actions">${exportLink('Save complete editable workspace','workspace')}${exportLink('Save visit register CSV','visits-csv')}</div><div class="facts">${fact('Workspace',workspace.workspaceId)}${fact('Revision',workspace.revision)}${fact('Visits',workspace.counts?.visits)}${fact('Files',workspace.counts?.attachments)}</div></section>
      <section class="panel"><h2>Receive a complete field-work workspace</h2>${populated?'<p>This workspace contains saved work. Open an empty field desk directory to receive a separate handover.</p>':'<p>Receiving a complete handover adopts its original workspace identity and history. Continue operating the received work here.</p>'}<form id="workspace-receive" data-draft="workspace-receive"><label>Editable workspace JSON file<input id="workspace-file" type="file" accept=".json,application/json"${populated?' disabled':''}></label><label>Complete editable workspace JSON<textarea name="originalText" rows="8" required spellcheck="false"${populated?' disabled':''}></textarea></label><p class="draft-state"></p><button type="submit" class="primary"${populated?' disabled':''}>Receive and open workspace</button></form></section>${workspace.receivedFrom?jsonDetail('Receiving history',workspace.receivedFrom):''}${jsonDetail('Workspace launch',{directory:workspace.directory,workspaceId:workspace.workspaceId,revision:workspace.revision,launch})}`;
  }
  async function renderView(){
    const epoch=++ui.epoch;$('#main').setAttribute('aria-busy','true');header();
    const fn={overview:overviewView,sources:sourcesView,crews:crewsView,visits:visitsView,packages:packagesView,returns:returnsView,updates:updatesView,transfer:transferView}[ui.view]??overviewView;
    const html=await fn();if(epoch!==ui.epoch)return;
    $('#main').innerHTML=html;await restoreForms();$('#main').setAttribute('aria-busy','false');header();
  }
  async function navigate(view,params={}){
    if(!views.includes(view))view='overview';
    for(const form of $$('form[data-draft]'))await storeForm(form);
    Object.assign(ui,params);ui.view=view;
    if(location.hash!== '#'+view)history.replaceState(null,'','#'+view);
    await refreshState();await renderView();$('#main').focus({preventScroll:true});
  }
  function openDialog(title,html){$('#record-title').textContent=title;$('#record-content').innerHTML=html;if(!$('#record-dialog').open)$('#record-dialog').showModal();}
  async function reviewVisits(ids){
    if(!ids.length)throw new Error('Select at least one saved visit to review.');
    ui.reviewTargets=await Promise.all(ids.map(id=>api(url('/api/visit',{id}))));
    openDialog('Review saved field visits',`<p>Review each current visit version and its source record before approving it for a destination package.</p><form id="visit-review"><label>Supervisor / reviewer<input name="reviewer" autocomplete="name" required></label><label>Review note<textarea name="note" rows="3"></textarea></label>${ui.reviewTargets.map(x=>`<section class="review-proposal"><h3>${esc(x.visit.title||x.visit.serviceRequestId)}</h3><div class="facts">${fact('Source status',originalStatus(x.sourceRow))}${fact('Field outcome',label(x.visit.field?.status))}${fact('Crew',x.crew?.name||'Unassigned')}${fact('Visit version',short(x.visit.versionId))}</div><p>${esc(x.visit.field?.completionNote)}</p>${jsonDetail('Saved field record',x.visit.field)}${jsonDetail('Assigned source work',x.sourceRow)}${x.sourceChange?.changed?jsonDetail('Source comparison',x.sourceChange):''}<label>Review outcome<select name="outcome:${esc(x.visit.id)}">${options([{id:'approve',name:'Approve this saved version'},{id:'return_to_crew',name:'Return to the crew'}],'approve')}</select></label><label>Visit note<textarea name="note:${esc(x.visit.id)}" rows="2"></textarea></label></section>`).join('')}<button type="submit" class="primary">Save supervisor review</button></form>`);
  }


  const decimalPattern=/^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,9})?$/;
  function readVisitForm(form){
    const data=formData(form),prior=ui.visitDraft??{},f=prior.field??{},fieldValue=(n,original)=>iso(data[n],original);
    const notes=$$('[data-note-id]',form).map(row=>{const before=list(f.notes).find(n=>n.id===row.dataset.noteId),at=$('[name="noteRecorded"]',row).value;return{id:row.dataset.noteId,author:$('[name="noteAuthor"]',row).value,text:$('[name="noteText"]',row).value,recordedAt:iso(at,before?.recordedAt??row.dataset.recordedAt)};});
    const resources=$$('[data-resource-id]',form).map(row=>{const v=n=>$(`[name="${n}"]`,row).value;return{id:row.dataset.resourceId,kind:v('resourceKind'),name:v('resourceName'),quantity:v('resourceQuantity').trim(),unit:v('resourceUnit'),unitCost:v('resourceCost').trim()||null,currency:v('resourceCurrency').trim().toUpperCase()||null,note:v('resourceNote')};});
    for(const r of resources){if(!decimalPattern.test(r.quantity)||r.unitCost!==null&&!decimalPattern.test(r.unitCost))throw new Error('Resource quantities and unit costs must be nonnegative decimals with at most 18 whole and 9 fractional digits.');if(r.unitCost!==null&&!r.currency)throw new Error('Enter a currency for each recorded unit cost.');if(r.currency&&!/^[A-Z]{3}$/.test(r.currency))throw new Error('Use a three-letter currency code, such as USD.');}
    const field={status:data.fieldStatus,actualStart:fieldValue('actualStart',f.actualStart),actualEnd:fieldValue('actualEnd',f.actualEnd),completionNote:data.completionNote,notes,resources,attachmentIds:$$('[data-attachment-id]',form).map(row=>row.dataset.attachmentId)};
    const visit={...(prior.id?{id:prior.id}:{}),sourceId:data.sourceId,sourceKey:data.sourceKey,crewId:data.crewId||null,title:data.title,plannedStart:fieldValue('plannedStart',prior.plannedStart),plannedEnd:fieldValue('plannedEnd',prior.plannedEnd),dueAt:fieldValue('dueAt',prior.dueAt),priority:data.priority,instructions:data.instructions,field};
    if(visit.plannedStart&&visit.plannedEnd&&new Date(visit.plannedEnd)<new Date(visit.plannedStart))throw new Error('The planned end precedes the planned start.');
    if(field.actualStart&&field.actualEnd&&new Date(field.actualEnd)<new Date(field.actualStart))throw new Error('The actual end precedes the actual start.');
    return visit;
  }
  async function ensureCurrentVisit(){
    const original=ui.visitDraft;if(!original?.id)return;
    const current=await api(url('/api/visit',{id:original.id}));
    if(current.visit.versionId!==original.versionId){const error=new Error('This visit changed while you were editing. Your form draft is saved. Refresh the visit and compare the current version before saving.');error.details={editedVersion:original.versionId,currentVersion:current.visit.versionId};throw error;}
  }
  function attachmentMarkup(a){return `<li data-attachment-id="${esc(a.id)}"><span><strong>${esc(a.filename||a.id)}</strong><br><small>${esc(a.detail??(bytes(a.bytes)+' · '+a.contentType))}</small></span><div class="actions"><a class="button" href="${esc(url('/api/attachment',{id:a.id}))}" download>Download</a>${button('Remove from visit','remove-attachment')}</div></li>`;}
  async function addVisitFiles(files){
    const form=$('#visit-save');if(!form||!files.length)return;
    await storeForm(form);await ensureCurrentVisit();
    for(const file of files){
      const buffer=new Uint8Array(await file.arrayBuffer()),result=await mutate('/api/attachments',{attachment:{filename:file.name,contentType:file.type||'application/octet-stream',contentBase64:encode64(buffer)}});
      if(!$$('[data-attachment-id]',form).some(row=>row.dataset.attachmentId===result.attachment.id))$('#visit-attachments').insertAdjacentHTML('beforeend',attachmentMarkup(result.attachment));
      await storeForm(form);
    }
    showNotice(files.length+' file(s) saved. Save the visit to keep these file references with its field record.');
  }
  async function chooseSourceRow(key){
    let row=list(ui.sourceRows).find(row=>row.key===key);
    if(!row&&ui.visitDetail?.sourceRow?.key===key)row=ui.visitDetail.sourceRow;
    if(!row&&ui.newSourceRow?.key===key)row=ui.newSourceRow;
    if(!row)throw new Error('Open the source page containing this request to select it.');
    return row;
  }
  async function startVisit(row=null){
    if(!workspace.sources?.length){await navigate('sources');showNotice('Import an approved dispatch before planning field visits.');return;}
    if(!row){
      ui.visitId='';ui.newVisit=null;ui.newSourceRow=null;
      await navigate('sources');showNotice('Choose Plan visit beside an approved source request.');return;
    }
    ui.visitId='';ui.newSourceRow=row;ui.newVisit={sourceId:ui.sourceId,sourceKey:row.key,title:row.work?.title||sourceTitle(row),priority:'normal',instructions:row.work?.actionNote||row.work?.instructions||row.work?.note||'',field:{status:'planned',actualStart:null,actualEnd:null,completionNote:'',notes:[],resources:[],attachmentIds:[]}};
    await navigate('visits');
  }
  async function onSubmit(form){
    clearTimeout(formTimer);
    if(!form.reportValidity())return;
    const data=formData(form);
    if(form.id==='source-filter'){ui.sourceId=data.sourceId;ui.sourceQuery=data.q;ui.sourceOffset=0;return renderView();}
    if(form.id==='visit-filter'){ui.query=data.q;ui.crewFilter=data.crewId;ui.sourceFilter=data.sourceId;ui.statusFilter=data.status;ui.offset=0;return renderView();}
    if(form.id==='return-select'){ui.returnId=data.returnId;return renderView();}
    if(form.id==='source-import'){
      const result=await mutate('/api/sources',{name:data.name,originalText:data.originalText,...(data.dispatchId?{dispatchId:data.dispatchId}:{})});
      await clearFormDraft(form);ui.sourceId=result.source.id;ui.sourceOffset=0;ui.sourceQuery='';ui.sourceText='';ui.inspection=null;await renderView();showNotice('Approved source work imported with its complete original records.');return;
    }
    if(form.id==='crew-save'){
      const existing=ui.crewDetail?.crew;
      if(existing){const current=await api(url('/api/crew',{id:existing.id}));if(current.crew.versionId!==existing.versionId)throw new Error('This crew changed while you were editing. Refresh the saved crew before updating it.');}
      const members=$$('[data-member-id]',form).map(row=>({id:row.dataset.memberId,name:$('[name="memberName"]',row).value,role:$('[name="memberRole"]',row).value,contact:$('[name="memberContact"]',row).value}));
      const result=await mutate('/api/crews',{crew:{...(existing?{id:existing.id}:{}),name:data.name,members,note:data.note,active:form.elements.namedItem('active').checked}});
      await clearFormDraft(form);ui.crewId=result.crew.id;await renderView();showNotice('Crew saved.');return;
    }
    if(form.id==='visit-save'){
      await storeForm(form);await ensureCurrentVisit();
      const result=await mutate('/api/visits',{visit:readVisitForm(form)});await clearFormDraft(form);ui.visitId=result.visit.id;ui.newVisit=null;ui.newSourceRow=null;await renderView();showNotice('Saved a new visit version.');return;
    }
    if(form.id==='package-create'){
      if(!ui.selected.size)throw new Error('Select visits from the visit register.');
      const result=await mutate('/api/packages',{name:data.name,note:data.note,visitIds:[...ui.selected]});await clearFormDraft(form);ui.packageId=result.package.id;await renderView();showNotice('Crew package saved. Download its standalone HTML editor for field use.');return;
    }
    if(form.id==='return-import'){
      const result=await mutate('/api/returns',{...(data.name?{name:data.name}:{}),originalText:data.originalText});await clearFormDraft(form);ui.returnId=result.return.id;await renderView();showNotice('Crew return imported. Its proposed changes are ready for supervisor review.');return;
    }
    if(form.id==='return-review'){
      const returned=ui.returnDetail,decisions=[];
      for(const p of returned.proposals){
        const selected=data['decision:'+p.id];if(!selected||selected==='later'||p.status!=='pending')continue;
        const fieldChoices=[];
        if(selected==='accept'){
          for(const change of p.changes.filter(c=>c.conflict)){const choice=data['choice:'+p.id+':'+change.id];if(!['current','returned'].includes(choice))throw new Error('Choose the current or returned value for every overlapping field in each accepted proposal.');fieldChoices.push({changeId:change.id,choice});}
          if(p.sourceChange?.changed&&!form.elements.namedItem('sourceAck:'+p.id)?.checked)throw new Error('Review and acknowledge the source changes before accepting this returned visit.');
          if(p.assignmentChanged&&!form.elements.namedItem('assignmentAck:'+p.id)?.checked)throw new Error('Review and acknowledge the changed assignment before accepting this returned visit.');
        }
        decisions.push({proposalId:p.id,choice:selected,expectedVisitVersionId:p.currentVersionId,fieldChoices,acknowledgeSourceChange:form.elements.namedItem('sourceAck:'+p.id)?.checked===true,acknowledgeAssignmentChange:form.elements.namedItem('assignmentAck:'+p.id)?.checked===true,note:data['note:'+p.id]||''});
      }
      if(!decisions.length)throw new Error('Choose at least one pending proposal to accept or reject.');
      await mutate('/api/decisions',{returnId:returned.return.id,reviewer:data.reviewer,note:data.note,decisions});await clearFormDraft(form);await renderView();showNotice(decisions.length+' supervisor decision(s) saved. Remaining proposals stay available for review.');return;
    }
    if(form.id==='visit-review'){
      const selections=ui.reviewTargets.map(x=>({visitId:x.visit.id,expectedVersionId:x.visit.versionId,outcome:data['outcome:'+x.visit.id],note:data['note:'+x.visit.id]||''}));
      await mutate('/api/visit-reviews',{reviewer:data.reviewer,note:data.note,selections});$('#record-dialog').close();await renderView();showNotice('Supervisor review saved for '+selections.length+' visit(s).');return;
    }
    if(form.id==='update-create'){
      const items=ui.updateSelection.map(x=>({visitId:x.visit.id,expectedVersionId:x.visit.versionId,action:data['action:'+x.visit.id],destinationReference:data['reference:'+x.visit.id]||'',note:data['itemNote:'+x.visit.id]||''}));
      const result=await mutate('/api/updates',{name:data.name,reviewer:data.reviewer,destination:{name:data.destinationName,system:data.destinationSystem,reference:data.destinationReference||''},note:data.note,items});await clearFormDraft(form);ui.updateId=result.update.id;await renderView();showNotice('Destination update package saved for the selected approved visit versions.');return;
    }
    if(form.id==='workspace-receive'){
      const priorKey=draftKey(form),result=await mutate('/api/receive',{originalText:data.originalText});await localWrite(priorKey,null);ui.selected.clear();Object.assign(ui,{sourceId:'',crewId:'',visitId:'',packageId:'',returnId:'',updateId:'',newVisit:null,newSourceRow:null,offset:0,sourceOffset:0});launch=await api('/api/launch');await navigate('overview');showNotice('The complete field workspace is open at revision '+result.revision+'.');return;
    }
  }
  async function handleAction(target){
    const action=target.dataset.action;
    if(action==='download-stale-return-draft'){if(ui.staleReturnDraft)download(pretty(ui.staleReturnDraft)+'\n','earlier-return-review-draft.json');return;}
    if(action==='download-stale-draft'){if(ui.staleVisitDraft)download(pretty(ui.staleVisitDraft)+'\n','earlier-visit-draft.json');return;}
    if(action==='download-stale-crew-draft'){if(ui.staleCrewDraft)download(pretty(ui.staleCrewDraft)+'\n','earlier-crew-draft.json');return;}
    if(action==='dismiss-error'){clearError();return;}
    if(action==='close-dialog'){$('#record-dialog').close();return;}
    if(action==='navigate'){if(target.dataset.view==='visits'){ui.visitId='';ui.newVisit=null;ui.newSourceRow=null;}await navigate(target.dataset.view);return;}
    if(action==='refresh'){for(const form of $$('form[data-draft]'))await storeForm(form);await refreshState();if(pending)await reconcilePending(false);await renderView();showNotice('Workspace refreshed.');return;}
    if(action==='check-pending'){await reconcilePending(false);await renderView();return;}
    if(action==='resume-pending'){await reconcilePending(true);await renderView();return;}
    if(action==='save-pending'){if(pending)download(pretty(pending)+'\n','field-desk-saved-request.json');return;}
    if(action==='page'){if(target.dataset.kind==='source')ui.sourceOffset=Number(target.dataset.offset);else ui.offset=Number(target.dataset.offset);await renderView();return;}
    if(action==='filter-status'){ui.statusFilter=target.dataset.status;ui.offset=0;ui.visitId='';ui.newVisit=null;await navigate('visits');return;}
    if(action==='inspect-source'){
      const form=$('#source-import'),data=formData(form);if(!data.originalText.trim())throw new Error('Select an original JSON file or paste its complete content.');
      ui.sourceText=data.originalText;ui.inspection=await api('/api/source-inspect',{originalText:data.originalText,...(data.dispatchId?{dispatchId:data.dispatchId}:{})});
      await storeForm(form);await renderView();
      const name=$('#source-import [name="dispatchId"]');if(ui.inspection.selectedDispatchId)name.value=ui.inspection.selectedDispatchId;
      showNotice(ui.inspection.requiresSelection?'Choose a saved dispatch from the source inspection before importing.':'Source inspection complete.');return;
    }
    if(action==='source-detail'){
      const row=await chooseSourceRow(target.dataset.key);
      openDialog('Source request '+(row.serviceRequestId||row.key),`<p>${esc(sourceTitle(row))}</p><div class="facts">${fact('Source status',originalStatus(row))}${fact('Source row key',row.key)}</div>${sourceLinks(row)}${jsonDetail('Original request',row.request)}${jsonDetail('Approved work',row.work)}${jsonDetail('Confirmed related orders',row.orders)}${jsonDetail('Source geometry',row.geometry)}${button('Plan field visit','visit-from-source',`data-key="${esc(row.key)}"`,true)}`);return;
    }
    if(action==='new-visit'){await startVisit();return;}
    if(action==='visit-from-source'){const row=await chooseSourceRow(target.dataset.key);$('#record-dialog').close();await startVisit(row);return;}
    if(action==='open-visit'){ui.visitId=target.dataset.id;ui.newVisit=null;ui.newSourceRow=null;await navigate('visits');return;}
    if(action==='visits-list'){ui.visitId='';ui.newVisit=null;ui.newSourceRow=null;await navigate('visits');return;}
    if(action==='new-crew'){ui.crewId='';await navigate('crews');return;}
    if(action==='open-crew'){ui.crewId=target.dataset.id;await navigate('crews');return;}
    if(action==='add-member'){$('#crew-members').insertAdjacentHTML('beforeend',memberRows([{id:uid('member'),name:'',role:'',contact:''}]));await storeForm($('#crew-save'));return;}
    if(action==='remove-member'){target.closest('[data-member-id]').remove();await storeForm($('#crew-save'));return;}
    if(action==='add-note'){const n={id:uid('note'),author:'',text:'',recordedAt:new Date().toISOString()};$('#visit-notes').insertAdjacentHTML('beforeend',visitNotes([n]));const row=$$('#visit-notes [data-note-id]').at(-1);row.dataset.recordedAt=n.recordedAt;await storeForm($('#visit-save'));row.querySelector('input').focus();return;}
    if(action==='remove-note'){target.closest('[data-note-id]').remove();await storeForm($('#visit-save'));return;}
    if(action==='add-resource'){$('#visit-resources').insertAdjacentHTML('beforeend',visitResources([{id:uid('resource'),kind:'labor',name:'',quantity:'1',unit:'hours',unitCost:null,currency:null,note:''}]));await storeForm($('#visit-save'));return;}
    if(action==='remove-resource'){target.closest('[data-resource-id]').remove();await storeForm($('#visit-save'));return;}
    if(action==='remove-attachment'){target.closest('[data-attachment-id]').remove();await storeForm($('#visit-save'));return;}
    if(action==='clear-selection'){ui.selected.clear();await renderView();return;}
    if(action==='selection-package'){ui.packageId='';await navigate('packages');return;}
    if(action==='selection-update'){ui.updateId='';await navigate('updates');return;}
    if(action==='selection-review'){await reviewVisits([...ui.selected]);return;}
    if(action==='review-visit'){await reviewVisits([target.dataset.id]);return;}
    if(action==='open-package'){ui.packageId=target.dataset.id;await navigate('packages');return;}
    if(action==='open-return'){ui.returnId=target.dataset.id;await navigate('returns');return;}
    if(action==='open-update'){ui.updateId=target.dataset.id;await navigate('updates');return;}
    if(action==='refresh-return'){await storeForm($('#return-review'));await refreshState();await renderView();return;}
  }
  document.addEventListener('submit',event=>{event.preventDefault();work(()=>onSubmit(event.target));});
  document.addEventListener('click',event=>{
    const link=event.target.closest('a[data-view]');if(link){event.preventDefault();work(async()=>{if(link.dataset.view==='visits'){ui.visitId='';ui.newVisit=null;ui.newSourceRow=null;}await navigate(link.dataset.view);});return;}
    const map=event.target.closest('[data-map-source]');if(map){event.preventDefault();work(()=>handleAction({dataset:{action:'source-detail',key:map.dataset.mapSource}}));return;}
    const control=event.target.closest('[data-action]');if(!control||control.type==='checkbox')return;
    event.preventDefault();work(()=>handleAction(control));
  });
  document.addEventListener('change',event=>{
    const control=event.target;
    if(control.dataset.selectVisit){if(control.checked)ui.selected.add(control.dataset.selectVisit);else ui.selected.delete(control.dataset.selectVisit);const bar=$('.selected-bar');if(bar)bar.outerHTML=selectedBar();else if(ui.selected.size)$('#main .table-scroll')?.insertAdjacentHTML('beforebegin',selectedBar());return;}
    if(control.dataset.action==='select-page'){for(const v of list(ui.visitPage?.items)){if(control.checked)ui.selected.add(v.id);else ui.selected.delete(v.id);}for(const input of $$('[data-select-visit]'))input.checked=ui.selected.has(input.dataset.selectVisit);const bar=$('.selected-bar');if(bar)bar.outerHTML=selectedBar();else if(ui.selected.size)$('#main .table-scroll')?.insertAdjacentHTML('beforebegin',selectedBar());return;}
    if(control.id==='visit-files'){work(()=>addVisitFiles([...control.files]));return;}
    const targetForm={'source-file':'source-import','return-file':'return-import','workspace-file':'workspace-receive'}[control.id];
    if(targetForm&&control.files?.[0]){const file=control.files[0];work(async()=>{const text=await file.text(),form=document.getElementById(targetForm);form.elements.namedItem('originalText').value=text;if(targetForm==='source-import'){ui.sourceText=text;if(!form.elements.namedItem('name').value)form.elements.namedItem('name').value=file.name.replace(/\.json$/i,'');}await storeForm(form);showNotice('Loaded the complete '+file.name+' file ('+bytes(file.size)+').');});return;}
    const form=control.closest('form[data-draft]');if(form)storeForm(form).catch(error=>showNotice('This draft is kept in the open form. Browser storage could not save it: '+error.message));
  });
  document.addEventListener('input',event=>{const form=event.target.closest('form[data-draft]');if(!form)return;clearTimeout(formTimer);formTimer=setTimeout(()=>storeForm(form).catch(error=>showNotice('This draft is kept in the open form. Browser storage could not save it: '+error.message)),350);});
  window.addEventListener('hashchange',()=>work(()=>navigate(location.hash.slice(1))));
  (async()=>{try{
    [workspace,launch]=await Promise.all([api('/api/state'),api('/api/launch')]);ui.view=views.includes(location.hash.slice(1))?location.hash.slice(1):'overview';
    pending=await localRead(storageKey('pending'));header();if(pending)await reconcilePending(false);await renderView();
  }catch(error){showError(error);}})();

})();
