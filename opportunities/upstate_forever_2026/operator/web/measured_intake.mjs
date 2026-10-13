/** Original Measurements guided intake; no scientific interpretation in the browser. */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const opt=(v,t,s)=>'<option value="'+esc(v)+'"'+(v===s?' selected':'')+'>'+esc(t)+'</option>';
const labels={station:'Station identifier',organization:'Source organisation',activity:'Sampling activity identifier',result:'Result identifier',date:'Sample date (YYYY-MM-DD)',datetime:'Sample date and time',time:'Sample time',zone:'Source time zone',characteristic:'Measured characteristic',value:'Measured value',unit:'Source unit',detection:'Detection condition',qualifier:'Result qualifier',fraction:'Sample fraction',status:'Result status',valueType:'Value type',medium:'Sample medium',activityType:'Activity type',method:'Analytical method',laboratory:'Laboratory',pcode:'USGS parameter code',name:'Station name',latitude:'Latitude',longitude:'Longitude',datum:'Coordinate datum',comment:'Source comment'};
const json=x=>JSON.stringify(x);
const clone=x=>JSON.parse(json(x));
const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const read=async file=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());
function download(name,value,type='application/json'){const a=document.createElement('a'),u=URL.createObjectURL(new Blob([typeof value==='string'?value:json(value)],{type}));a.href=u;a.download=name.replace(/[\\/:*?"<>|]/g,'_').slice(0,200)||'source.txt';a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);}
async function database(){
  return new Promise((resolve,reject)=>{const r=indexedDB.open('eco-measurement-intake-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
const liveRecovery=new Map();
export function mountGuidedIntake({api,onImported=()=>{}}){
  const element=document.createElement('section');element.className='mi mw-panel';
  let db=null,workspaceId=null,selected=null,savedList=[],localList=[],inspection=null,busy=false,dead=false,generation=0,timer=null,interpretations={};
  const viewId=crypto.randomUUID();
  let lockRevision=0,rescueSignature=null,storageQueue=Promise.resolve();
  const active=()=>{if(dead){const e=new Error('This measurement workspace was closed. Its complete preparation is retained for the original workspace.');e.name='AbortError';throw e;}};
  function remember(){if(workspaceId&&selected)liveRecovery.set(workspaceId,{working:clone(selected),localRevision:lockRevision});}
  function retain(value,expected){const snapshot=clone(value);const run=()=>retainNow(snapshot,expected===undefined?lockRevision:expected);storageQueue=storageQueue.catch(()=>{}).then(run);return storageQueue;}
  function message(text,error=false){const el=element.querySelector('[data-status]');if(el){el.textContent=text;el.dataset.error=String(error);}}
  async function localRead(key){return new Promise((resolve,reject)=>{const tx=db.transaction('drafts'),r=tx.objectStore('drafts').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  async function allLocal(){return new Promise((resolve,reject)=>{const tx=db.transaction('drafts'),r=tx.objectStore('drafts').getAll();r.onsuccess=()=>resolve(r.result.filter(x=>x.workspaceId===workspaceId));r.onerror=()=>reject(r.error);});}
  async function retainNow(value,expected){
    if(!db)throw new Error('Browser draft storage is unavailable. Download the unsaved preparation before leaving; no native import will be sent.');
    const snapshot=clone(value),key=workspaceId+':'+snapshot.id;
    const row=await new Promise((resolve,reject)=>{
      const tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),r=store.get(key);let result;
      r.onsuccess=()=>{
        const prior=r.result;
        if((prior?.localRevision||0)!==expected){tx.abort();return;}
        result={key,workspaceId,localRevision:expected+1,writer:viewId,updatedAt:new Date().toISOString(),working:snapshot};store.put(result);
      };
      tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(new Error('This browser preparation changed in another tab. Download these unsaved inputs, then open the saved copy or create a separate copy.'));tx.onerror=()=>reject(tx.error||new Error('Browser storage failed; keep this page open and download the unsaved preparation.'));
    });
    if(selected?.id===snapshot.id){lockRevision=row.localRevision;remember();}
    return row;
  }
  async function protect(){
    if(!selected)return;
    clearTimeout(timer);capture();
    const owner=selected,snapshot=clone(owner);
    try{await retain(snapshot);}catch(e){if(rescueSignature!==json(snapshot))throw e;}
    return owner;
  }
  function capture(){
    if(!selected)return;
    const form=element.querySelector('[data-edit]');if(!form)return;
    for(const k of ['label','reviewer','note','context'])selected.value[k]=form.elements[k].value;
    const scientific=form.elements.interpretation;if(scientific){const key=selected.value.kind==='usgs-daily'?'_usgs_daily':'_wqp_detection';if(scientific.value)selected.value.mapping[key]=scientific.value;else delete selected.value.mapping[key];}
    for(const s of form.querySelectorAll('[data-map]'))selected.value.mapping[s.dataset.map]=s.value;
    remember();
  }
  function dirty(){return selected&&json(selected.value)!==selected.savedValue;}
  function body(){if(!selected)return '<p>Select a complete source file. Its original rows appear before mapping is required.</p>';
    const v=selected.value,i=inspection;
    return '<div class="mi-facts"><span>File <strong>'+esc(v.sourceName)+'</strong></span><span>Saved edition <strong>'+selected.revision+'</strong></span><span>Preparation <code>'+esc(selected.id)+'</code></span></div><form data-edit><label>Source name<input name="label" value="'+esc(v.label)+'"></label><div class="mi-grid"><label>Mapping reviewer<input name="reviewer" value="'+esc(v.reviewer)+'"></label><label>Review note<input name="note" value="'+esc(v.note)+'"></label></div><label>Original context: workbook/sheet, agency, date window or supplied instructions<textarea name="context" rows="2">'+esc(v.context)+'</textarea></label>'+
      (i?'<p><strong>'+i.rawRows+'</strong> source rows; '+i.rawRejectedCount+' malformed rows. Showing up to twelve original rows. Complete original is retained.</p><details open><summary>Original columns and sample rows</summary><div class="mw-table-wrap"><table><thead><tr><th>Source line</th>'+i.headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+i.sample.map(r=>'<tr><td>'+r.line+'</td>'+i.headers.map(h=>'<td>'+esc(r.raw[h])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></details>':'')+
      (v.kind!=='usgs-daily'&&i?.headers.length?'<h3>Map the columns you recognise</h3><p>Suggestions use the original importer’s exact header aliases. Review dates, units, time zones and fractions; no missing unit or location is invented.</p><div class="mi-grid">'+i.mappingFields.map(k=>'<label>'+esc(labels[k]||k)+'<select data-map="'+k+'">'+opt('','Not supplied',v.mapping[k]||'')+i.headers.map(h=>opt(h,h,v.mapping[k]||'')).join('')+(!i.headers.includes(v.mapping[k])&&v.mapping[k]?opt(v.mapping[k],'Missing column: '+v.mapping[k],v.mapping[k]):'')+'</select></label>').join('')+'</div>':'')+
      (v.kind==='stations'?'':'<label>Scientific interpretation<select name="interpretation">'+opt('','Original unpinned interpretation',v.mapping[v.kind==='usgs-daily'?'_usgs_daily':'_wqp_detection']||'')+opt(interpretations[v.kind],interpretations[v.kind],v.mapping[v.kind==='usgs-daily'?'_usgs_daily':'_wqp_detection']||'')+'</select><small>Changing this choice creates a separate native source interpretation. Earlier imports stay intact.</small></label>')+'<div class="mi-actions"><button type="button" data-action="save">Save preparation</button><button type="button" data-action="preview">Review mapped measurements</button><button type="button" data-action="copy">Save separate copy</button><button type="button" data-action="original">Download original</button><button type="button" data-action="project">Download complete preparation</button><button type="button" data-action="rescue">Download unsaved inputs</button></div></form>'+
      (i?.issues.length?'<div class="mw-notice">'+i.issues.map(x=>'<p>'+esc(x)+'</p>').join('')+'</div>':'')+
      (i?.native?'<section class="mi-preview"><h3>Review the native interpretation</h3><p>'+i.native.rows+' accepted; '+i.native.rejectedCount+' rejected; '+i.native.stationCount+' stations; '+i.native.censored+' censored results.</p><p>These values come from the existing scientific normaliser. Censored values remain bounds; units, fractions and source times remain distinct.</p><div class="mw-table-wrap"><table><thead><tr><th>Source line</th><th>Station</th><th>Date / precision</th><th>Characteristic</th><th>Value / bounds</th><th>Unit / basis / fraction</th><th>Issues</th></tr></thead><tbody>'+i.native.sample.map(r=>'<tr><td>'+r.sourceLine+'</td><td>'+esc(r.stationId||r.id)+'</td><td>'+esc([r.sampledDate,r.timePrecision,r.sourceTime,r.timeZone].filter(Boolean).join(' / '))+'</td><td>'+esc(r.characteristic||r.name)+'</td><td>'+esc(r.censor&&r.censor!=='none'?r.censor+' ['+r.lower+', '+r.upper+']':r.value??'')+'</td><td>'+esc([r.unit,r.basis,r.fraction].filter(Boolean).join(' / '))+'</td><td>'+esc((r.issues||[]).join('; '))+'</td></tr>').join('')+'</tbody></table></div><details><summary>Complete preview accounting and rejection sample</summary><pre>'+esc(JSON.stringify(i.native,null,2))+'</pre></details>'+
      (i.previewSha?'<label class="mi-confirm"><input type="checkbox" data-confirm> I reviewed this source edition, its mapping, accepted/rejected counts and scientific interpretation.</label><button data-action="import" '+(!i.native.rows?'disabled':'')+'>Import reviewed source</button>':'<p>Save and review the mapped preparation to enable import.</p>')+'</section>':'')+
      (selected.receipt?'<p class="mw-notice">Native source retained: <code>'+esc(selected.receipt.importId)+'</code>. Reopening this preparation does not create another import.</p>':'');
  }
  function render(){
    if(dead)return;
    const options=new Map(savedList.map(x=>[x.id,{id:x.id,label:x.value.label||x.value.sourceName,revision:x.revision}]));
    for(const x of localList)if(!options.has(x.working.id))options.set(x.working.id,{id:x.working.id,label:x.working.value.label||x.working.value.sourceName,revision:x.working.revision});
    element.innerHTML='<h2>Prepare a measurement file</h2><p>Open the original, review its columns, then import the saved mapping into this workspace.</p><div class="mi-grid"><label>Saved preparations<select data-select>'+opt('','Choose a preparation',selected?.id)+[...options.values()].map(x=>opt(x.id,x.label+' · edition '+x.revision,selected?.id)).join('')+'</select></label><label>Open a complete preparation<input type="file" data-project accept=".json"></label></div><details '+(!selected?'open':'')+'><summary>Choose another original file</summary><form data-file-form><label>File type<select name="kind">'+opt('wqp','Chemistry / WQP','wqp')+opt('stations','Monitoring stations','wqp')+opt('usgs-daily','USGS daily discharge GeoJSON','wqp')+'</select></label><label>Complete original UTF-8 file<input type="file" name="file" required accept=".csv,.json,.geojson,.txt"></label><button>Open and inspect original</button></form></details><p data-status role="status" aria-live="polite"></p><div data-body>'+body()+'</div>';
    freeze(busy);if(selected)message(dirty()?'Inputs changed. Browser recovery retains edits; Save preparation records a native edition.':'Preparation loaded. Original source and saved mapping are retained.');
  }
  function freeze(value){for(const x of element.querySelectorAll('button,input,select,textarea'))x.disabled=value;}
  async function run(fn){
    if(busy||dead)return;busy=true;freeze(true);
    try{await fn();}catch(e){if(!dead)message(e.message,true);}finally{busy=false;if(!dead)freeze(false);}
  }
  async function lists(){const data=await api('/intake');if(dead)return;workspaceId=data.workspaceId;interpretations=data.interpretations||{};savedList=data.preparations;localList=await allLocal();const memory=liveRecovery.get(workspaceId);if(memory&&!localList.some(x=>x.working.id===memory.working.id))localList.push({working:memory.working});}
  async function inspect(){
    const owner=selected,g=++generation;
    const result=await api('/intake/inspect','POST',{kind:owner.value.kind,text:owner.text,mapping:owner.value.mapping});
    if(dead||selected!==owner||g!==generation)return;
    inspection=result;
  }
  async function save(){
    capture();const owner=selected;if(!owner)throw new Error('Choose a complete original file first.');
    if(owner.pending){await reconcilePending(owner);}
    active();const request={id:owner.id,expectedRevision:owner.revision,value:clone(owner.value),text:owner.text};
    owner.pending={kind:'save',request};await retain(owner);active();
    const result=await api('/intake/'+encodeURIComponent(owner.id),'PUT',request);
    if(dead||selected!==owner)return;
    owner.revision=result.revision;owner.savedValue=json(result.value);owner.receipt=result.receipt;owner.pending=null;
    await retain(owner);await lists();
  }
  async function reconcilePending(owner){
    const p=owner.pending;if(!p)return;active();
    if(p.kind==='save'){
      // Same exact request/identity, protected locally before its first dispatch.
      const result=await api('/intake/'+encodeURIComponent(owner.id),'PUT',p.request);
      owner.revision=result.revision;owner.savedValue=json(result.value);owner.pending=null;owner.receipt=result.receipt;await retain(owner);
    }else if(p.kind==='copy'){
      const result=await api('/intake/copy','POST',p.request);owner.revision=result.revision;owner.savedValue=json(result.value);owner.pending=null;owner.receipt=result.receipt;await retain(owner);
    }else if(p.kind==='import'){
      const result=await api('/intake/'+encodeURIComponent(owner.id)+'/import','POST',p.request);
      owner.receipt=result;owner.pending=null;await retain(owner);
    }
  }
  async function open(id){
    await protect();const local=await localRead(workspaceId+':'+id);
    let candidate;
    if(liveRecovery.get(workspaceId)?.working.id===id){const memory=liveRecovery.get(workspaceId);candidate=clone(memory.working);lockRevision=memory.localRevision;}
    else if(local){candidate=clone(local.working);lockRevision=local.localRevision;}
    else{
      const r=await api('/intake/'+encodeURIComponent(id));candidate={id:r.id,revision:r.revision,value:r.value,text:r.text,savedValue:json(r.value),receipt:r.receipt,pending:null};lockRevision=0;
    }
    active();selected=candidate;inspection=null;render();await inspect();render();
    if(candidate.pending)message('An earlier native request has no confirmed browser receipt. Use Save preparation to reconcile that exact request first.',true);
  }
  async function fileOpen(form){
    await protect();const f=form.elements.file.files[0],kind=form.elements.kind.value;
    if(!f)throw new Error('Choose the full original file.');
    if(f.size>128*1024*1024)throw new Error('Use the existing large-file intake above for files over the native 128 MiB request route.');
    const text=await read(f),sha=await digest(text);
    const candidate={id:crypto.randomUUID(),revision:0,value:{kind,label:f.name,sourceName:f.name,sourceSha:sha,mapping:{},reviewer:'',note:'',context:''},text,savedValue:'',receipt:null,pending:null};
    active();const kept=await retain(candidate,0);active();lockRevision=kept.localRevision;selected=candidate;inspection=null;render();
    const inspectionResult=await api('/intake/inspect','POST',{kind,text,mapping:{}});
    active();candidate.value.mapping=inspectionResult.mapping;
    inspection=inspectionResult;await retain(candidate);await lists();render();
    message('Complete original retained in browser recovery. Review the source columns before saving/importing.');
  }
  element.addEventListener('submit',e=>{if(e.target.matches('[data-file-form]')){e.preventDefault();e.stopPropagation();run(()=>fileOpen(e.target));}});
  element.addEventListener('input',e=>{
    if(!e.target.closest('[data-edit]')||busy)return;capture();inspection=inspection?{...inspection,previewSha:undefined}:null;
    message('Changed inputs retained as a working draft; save and review again before import.');
    clearTimeout(timer);timer=setTimeout(()=>{if(!busy&&!dead)run(async()=>{await protect();message('Working inputs retained in this browser. Save preparation records a native edition.');});},450);
  });
  element.addEventListener('change',e=>{
    if(e.target.matches('[data-select]')){const id=e.target.value;run(async()=>{if(id)await open(id);else render();});}
    if(e.target.matches('[data-project]')){const f=e.target.files[0];if(f)run(async()=>{
      await protect();const p=JSON.parse(await read(f));
      if(p.format==='upper-savannah-measurement-intake-working/v1'){
        const w=p.working;if(!w?.value||typeof w.text!=='string'||await digest(w.text)!==w.value.sourceSha)throw new Error('Unsaved source checksum mismatch.');
        const candidate={...clone(w),id:crypto.randomUUID(),revision:0,savedValue:'',receipt:null,pending:null};active();const kept=await retain(candidate,0);active();lockRevision=kept.localRevision;selected=candidate;inspection=null;render();await inspect();await lists();render();message('Unsaved inputs received as a separate draft. No prior native request was replayed.');
      }else{
        const last=p.editions?.at(-1),file=p.sources?.find(x=>x.sha===last?.value?.sourceSha);
        if(p.format!=='upper-savannah-measurement-intake/v1'||!last||typeof file?.text!=='string'||await digest(file.text)!==file.sha)throw new Error('Complete preparation source checksum mismatch.');
        const id=crypto.randomUUID(),candidate={id,revision:0,value:clone(last.value),text:file.text,savedValue:'',receipt:null,pending:{kind:'copy',request:{id,project:p}}};
        active();const kept=await retain(candidate,0);active();lockRevision=kept.localRevision;selected=candidate;inspection=null;render();await reconcilePending(candidate);await inspect();await lists();render();message('Complete original history received as a separate native preparation.');
      }
    });}
  });
  element.addEventListener('click',e=>{
    const b=e.target.closest('[data-action]');if(!b)return;e.preventDefault();e.stopPropagation();
    if(b.dataset.action==='rescue'){capture();if(selected){download('unsaved-measurement-intake.json',{format:'upper-savannah-measurement-intake-working/v1',workspaceId,working:selected});rescueSignature=json(selected);message('Full unsaved inputs downloaded. You may deliberately open another preparation; retain this file if browser storage is unavailable.');}return;}
    run(async()=>{
      capture();if(!selected)throw new Error('Choose an original source first.');
      const action=b.dataset.action;
      if(action==='original'){download(selected.value.sourceName,selected.text,'text/plain;charset=utf-8');return;}
      if(action==='copy'){
        capture();const previous=selected,id=crypto.randomUUID(),candidate={...clone(previous),id,revision:0,savedValue:'',receipt:null,pending:null,copiedFrom:{id:previous.id,revision:previous.revision,pending:previous.pending}};
        if(previous.revision>0){const project=await api('/intake/'+encodeURIComponent(previous.id)+'/export');candidate.pending={kind:'copy',request:{id,project}};}
        active();const kept=await retain(candidate,0);active();lockRevision=kept.localRevision;selected=candidate;inspection=null;render();
        await save();await inspect();await lists();render();message('Separate preparation saved; complete preceding native history is retained and the old copy remains intact.');return;
      }
      if(action==='save'){await save();render();message('Preparation saved. Earlier editions and the full original remain retained.');}
      if(action==='preview'){await save();const owner=selected;const r=await api('/intake/'+owner.id+'/preview','POST',{revision:owner.revision});if(selected!==owner||dead)return;inspection=r;render();message('Review this exact saved edition before import.');}
      if(action==='project'){await save();download('measurement-preparation.json',await api('/intake/'+selected.id+'/export'));message('Complete original, mapping editions and received history exported.');}
      if(action==='import'){
        if(!element.querySelector('[data-confirm]')?.checked)throw new Error('Confirm the reviewed mapping and interpretation first.');
        if(dirty()||!inspection?.previewSha||inspection.revision!==selected.revision)throw new Error('Inputs changed. Save and review again before import.');
        const owner=selected;owner.pending={kind:'import',request:{revision:owner.revision,previewSha:inspection.previewSha}};await retain(owner);active();await reconcilePending(owner);
        await lists();render();message('Reviewed source imported. Exact replays recover the original import.');await onImported();
      }
    });
  });
  const unload=e=>{if(selected&&(dirty()||selected.pending)){e.preventDefault();e.returnValue='';}};
  window.addEventListener('beforeunload',unload);
  render();
  run(async()=>{db=await database();await lists();render();message('Saved preparations loaded. Choose an original file or reopen a saved preparation.');});
  return {element,destroy(){capture();remember();dead=true;generation++;clearTimeout(timer);window.removeEventListener('beforeunload',unload);const final=selected&&db?retain(selected):storageQueue;final.catch(()=>{remember();}).finally(()=>db?.close());}};
}
