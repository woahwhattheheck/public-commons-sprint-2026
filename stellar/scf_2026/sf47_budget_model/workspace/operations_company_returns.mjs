// Company package intake borrows the original Operations request ledger.
const SCHEMA='sf47.company-return-intake-draft.v1', MAX=8*1024*1024, MAX_DRAFT=128*1024*1024;
const noteWrites=new Map(); // desk replacements await the same case's owned note writes
const copy=v=>structuredClone(v);
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
const equal=(a,b)=>stable(a)===stable(b);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function base64(raw){let s='';for(let i=0;i<raw.length;i+=32768)s+=String.fromCharCode(...raw.subarray(i,i+32768));return btoa(s);}
function bytes(value){const s=atob(value);return Uint8Array.from(s,c=>c.charCodeAt(0));}
async function hash(raw){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),x=>x.toString(16).padStart(2,'0')).join('');}
function download(raw,name,type='application/json'){const u=URL.createObjectURL(new Blob([raw],{type})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);}
const button=(name,action,disabled=false)=>'<button type="button" data-company-action="'+action+'"'+(disabled?' disabled':'')+'>'+esc(name)+'</button>';
async function database(){
  return new Promise((resolve,reject)=>{const r=indexedDB.open('sf47-company-return-intake',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('work',{keyPath:'id'});
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Close an older intake tab before reopening the private draft store.'));});
}
async function list(db,caseId){return new Promise((resolve,reject)=>{const t=db.transaction('work'),r=t.objectStore('work').getAll();r.onsuccess=()=>resolve(r.result.filter(x=>x.caseId===caseId));r.onerror=()=>reject(r.error);});}
async function retain(db,row){
  const next={...copy(row),localRevision:(row.localRevision||0)+1};
  await new Promise((resolve,reject)=>{const t=db.transaction('work','readwrite'),s=t.objectStore('work'),r=s.get(row.id);let problem;
    r.onsuccess=()=>{if((r.result?.localRevision||0)!==(row.localRevision||0)){problem=Error('This intake changed in another tab. Reopen its retained original before continuing.');t.abort();return;}s.put(next);};
    t.oncomplete=resolve;t.onerror=()=>reject(problem||t.error);t.onabort=()=>reject(problem||t.error||Error('The original intake could not be retained.'));});
  row.localRevision=next.localRevision;
}
export function mountCompanyReturnIntake({container,current,api,saveApi,mutationId,recordingActor,onDraft,onBusy,noteDrafts={},onNoteDrafts=()=>{},onNoteError=()=>{},locked=()=>false}){
  const root=document.createElement('section');root.className='company-return-intake';container.replaceChildren(root);
  const caseId=current.program.id,prefix='/api/operations/'+caseId;
  let active=true,busy=false,externalBusy=false,selectionGeneration=0,db=null,rows=[],selected=null,caseValue=current,error='',notice='',note='';
  let pendingNotes=Promise.resolve(),closing=false;
  const alive=()=>active&&root.isConnected;
  const chosen=()=>rows.find(x=>x.id===selected);
  const blocked=()=>externalBusy||locked();
  const sourceOf=(row,kind)=>kind==='archive'?{filename:'Installation_Return_'+row.inspection.package.returnId+'.zip',mediaType:'application/zip',kind:'other',sourceUrl:'',contentBase64:row.archiveBase64}:row.inspection.returnedSource;
  function retainNoteDrafts(){try{onNoteDrafts();}catch(e){noteError(e);}}
  function noteError(cause){
    error='The intake note could not be retained: '+(cause?.message||String(cause))+
      ' Your typed text remains in this receiving session. Refresh retained work, compare its current note, then explicitly save or download the draft.';
    onNoteError(error);
    if(alive()){
      let alert=root.querySelector('[data-company-note-error]');
      if(!alert){alert=document.createElement('p');alert.dataset.companyNoteError='true';alert.className='ir-warning';alert.setAttribute('role','alert');root.prepend(alert);}
      alert.textContent=error;
    }
  }
  function queueNote(row,text){
    if(!row||!db)return pendingNotes;
    const draft={note:text,baseNote:row.note||'',baseRevision:row.localRevision||0,token:crypto.randomUUID()};
    noteDrafts[row.id]=draft;retainNoteDrafts();
    const previous=noteWrites.get(caseId)||Promise.resolve();
    const write=previous.then(async()=>{
      if(noteDrafts[row.id]?.token!==draft.token)return; // later typing supersedes a queued, unstarted write
      const next={...copy(row),note:draft.note};
      await retain(db,next);
      row.note=next.note;row.localRevision=next.localRevision;
      if(noteDrafts[row.id]?.token===draft.token){delete noteDrafts[row.id];retainNoteDrafts();}
    });
    const settled=write.catch(noteError);pendingNotes=settled;
    noteWrites.set(caseId,settled);
    settled.then(()=>{if(noteWrites.get(caseId)===settled)noteWrites.delete(caseId);});
    return settled;
  }
  function selectedNote(){
    const row=chosen(),draft=row&&noteDrafts[row.id];
    if(draft&&row.note===draft.note){delete noteDrafts[row.id];retainNoteDrafts();}
    note=row?(noteDrafts[row.id]?.note??row.note??''):'';
  }
  function closeWhenDrained(){
    if(active||busy||closing)return;closing=true;
    pendingNotes.finally(()=>db?.close());
  }
  function controls(){if(!alive())return;root.setAttribute('aria-busy',String(busy));for(const el of root.querySelectorAll('button,input,select,textarea'))el.disabled=el.dataset.fixed==='true'||busy||blocked()||!db;}
  function render(){
    if(!alive())return;const row=chosen(),i=row?.inspection,pending=row&&Object.values(row.steps).some(x=>x.state==='pending');
    root.innerHTML='<header><h3>Receive a company return package</h3><p>Open one complete company ZIP, compare every original check, and retain its source files. The existing receiving and owner review screens remain the place to preview and save observations.</p><p><a href="/COMPANY_RETURN_INTAKE.md" target="_blank" rel="noopener">Complete company return intake guide</a></p></header>'+
      (error?'<p role="alert" class="ir-warning">'+esc(error)+'</p>':'')+(notice?'<p role="status" class="ir-notice">'+esc(notice)+'</p>':'')+
      '<div class="ir-fields"><label>Retained intake work<select data-company-work><option value="">Select original work</option>'+rows.map(x=>'<option value="'+esc(x.id)+'"'+(selected===x.id?' selected':'')+'>'+esc(x.inspection?.baselineName||x.id)+' · '+esc(x.inspection?.package?.returnId)+' · '+esc(x.openedAt)+'</option>').join('')+'</select></label>'+
      '<label>Complete company return ZIP<input type="file" data-company-file accept=".zip,application/zip"></label>'+
      '<label>Reopen a portable intake draft<input type="file" data-company-draft accept=".json,application/json"></label>'+
      '<label>Package already retained in this case<select data-company-source><option value="">Select original ZIP source</option>'+caseValue.sources.filter(x=>x.mediaType==='application/zip'||x.filename.toLowerCase().endsWith('.zip')).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.filename)+' · '+esc(x.sha256.slice(0,16))+'</option>').join('')+'</select></label></div>'+
      '<div class="ir-actions">'+button('Inspect retained source','source')+button('Refresh retained work','refresh')+'</div>'+
      (i?'<section class="ir-card"><h4>'+esc(i.baselineName)+'</h4><p>Installation '+esc(i.baseline.id)+' · edition '+i.baseline.revision+' · '+esc(i.package.returnId)+'</p>'+
        '<p>'+i.package.bytes+' package bytes · '+i.package.members.length+' verified package members · '+i.checks.length+' original checks</p><p><code>'+esc(i.package.sha256)+'</code></p>'+
        '<details><summary>Complete original and proposed observations</summary><pre>'+esc(JSON.stringify(i.comparison,null,2))+'</pre></details>'+
        '<details><summary>Original package, report and source selection</summary><pre>'+esc(JSON.stringify({package:i.package,baseline:i.baseline,retained:row.retained,steps:row.steps},null,2))+'</pre></details>'+
        '<label>Reason for retaining this original return<textarea data-company-note maxlength="12000">'+esc(note)+'</textarea></label>'+
        (noteDrafts[row.id]?'<p class="ir-warning">This session has an unsaved note. Current retained note: '+esc(row.note||'(empty)')+'. Refresh to compare another tab’s edition, then explicitly save this note or download the complete draft.</p>':'')+
        (i.returnedSourceCandidates?.length?'<label>Exact original returned JSON already retained<select data-company-json><option value="">Retain the package JSON as a new source</option>'+i.returnedSourceCandidates.map(x=>'<option value="'+esc(x.id)+'"'+(row.retained.returnedJson===x.id?' selected':'')+'>'+esc(x.filename)+' · '+esc(x.id)+'</option>').join('')+'</select></label>':'')+
        '<p>Original package: '+esc(row.retained.archive||'Not yet retained')+'<br>Original returned JSON: '+esc(row.retained.returnedJson||'Not yet retained')+'</p>'+
        (Object.values(row.steps).some(x=>x.state==='rejected')?'<p class="ir-warning">A selected source request was definitively rejected. Its full body remains here. Inspect the same package as a separate deliberate intake after resolving that error; the old request is unchanged.</p>':'')+
        '<div class="ir-actions">'+button(pending?'Recover original source request':'Retain originals and verify linked inputs','retain')+
        button('Open as receiving draft','open',!row.linked)+button('Save intake note','note')+button('Download complete intake draft','draft')+
        button('Download original package','archive',!row.archiveBase64)+button('Download original returned JSON','json')+'</div>'+
        '<p>The downloaded draft includes the complete original package and request bodies. Keep it with this private case. Closing this desk does not cancel an already admitted source request.</p></section>':'<p>No package has been selected. File inspection is read-only. Nothing is approved or saved merely by opening a customer package.</p>');
    for(const el of root.querySelectorAll('[disabled]'))el.dataset.fixed='true';
    controls();
  }
  async function run(fn,{allowUnsaved=false,retryNote=false}={}){
    if(busy||blocked()||!alive()||!db)return;busy=true;error='';onBusy?.(true);controls();
    try{
      await pendingNotes;
      const row=chosen();
      if(retryNote&&row&&(row.note!==note||noteDrafts[row.id]))await queueNote(row,note);
      if(row&&noteDrafts[row.id]&&!allowUnsaved)throw Error('The typed note remains unsaved. Refresh to compare retained work, then explicitly save the note or download its complete draft.');
      await fn();
    }catch(e){error=e.message||String(e);}finally{busy=false;if(active)onBusy?.(false);else closeWhenDrained();if(alive())render();}
  }
  async function refresh(){caseValue=await api(prefix);rows=await list(db,caseId);if(selected&&!chosen())selected=null;selectedNote();}
  async function inspect(raw,sha,retainedId){
    const next=await api(prefix);
    const body={expectedVersion:next.program.version,archiveSha256:sha,...(retainedId?{archiveSourceId:retainedId}:{archiveBase64:base64(raw)})};
    const result=await api(prefix+'/installation-company-return-inspect',body);
    if(result.schema!=='stellar-forge.sf47-company-return-intake.v1'||result.caseId!==caseId||result.package.sha256!==sha)
      throw Error('The returned inspection does not match this original package and case.');
    return {result,next};
  }
  async function selectPackage(raw,filename,retainedId=null,expected=null){
    if(raw.length<1||raw.length>MAX)throw Error('Select a complete company ZIP within the native 8 MiB source limit.');
    const generation=++selectionGeneration,sha=await hash(raw);
    if(expected&&sha!==expected)throw Error('The retained source download differs from its native SHA-256.');
    const {result,next}=await inspect(raw,sha,retainedId);
    if(!alive()||generation!==selectionGeneration)return;
    const row={schema:SCHEMA,id:crypto.randomUUID(),caseId,localRevision:0,openedAt:new Date().toISOString(),filename,archiveBase64:base64(raw),inspection:result,
      retained:{archive:result.retainedArchive?.id||null,returnedJson:null},steps:{},linked:null};
    await retain(db,row);rows.push(row);selected=row.id;caseValue=next;note='';notice='The complete original package was inspected. Choose exact retained source records or explicitly retain its original files.';
  }
  async function validateRow(row){
    if(row.schema!==SCHEMA||row.caseId!==caseId||!row.id||!row.archiveBase64||!row.inspection?.package?.sha256||!row.steps||!row.retained)
      throw Error('Select a complete private intake draft for this same case.');
    const raw=bytes(row.archiveBase64);
    if(raw.length>MAX||await hash(raw)!==row.inspection.package.sha256)throw Error('The portable original package differs.');
    const {result,next}=await inspect(raw,row.inspection.package.sha256);
    for(const key of ['package','baseline','checks','inputs','comparison','returnedSource'])
      if(!equal(row.inspection[key],result[key]))throw Error('The retained original '+key+' differs from the independently inspected package.');
    for(const [kind,step]of Object.entries(row.steps)){
      if(!['archive','returnedJson'].includes(kind)||!step?.body||step.body.action!=='source.add'||!equal(step.body.data,sourceOf(row,kind))||
         typeof step.body.actor!=='string'||!step.body.actor.trim()||typeof step.body.note!=='string'||!step.body.note.trim()||
         !Number.isInteger(step.body.expectedVersion)||step.body.expectedVersion<1||
         typeof step.body.requestId!=='string'||!step.body.requestId)
        throw Error('A retained original source request does not match the selected package.');
    }
    return next;
  }
  async function sourceStep(row,kind){
    let step=row.steps[kind];
    if(step?.state==='rejected')throw Error('The original '+kind+' request was rejected. Keep its original body and resolve the stated error before selecting a separate intake.');
    if(step?.state==='complete')return step.result.recordId;
    if(!step){
      if(!note.trim())throw Error('Enter the reason for retaining this company return.');
      const current=await api(prefix);
      if(current.program.state!=='OPEN')throw Error('Reopen this native case before admitting a new source. Its original retained files remain readable.');
      const body={expectedVersion:current.program.version,actor:recordingActor(),note:note.trim(),action:'source.add',data:copy(sourceOf(row,kind))};
      body.requestId=await mutationId('operations:company-return:'+caseId+':'+row.id+':'+kind,body);
      step={state:'pending',body};row.steps[kind]=step;
      await retain(db,row); // full original bytes and request precede dispatch
    }
    let result;
    try{result=await saveApi(prefix+'/command',step.body);}
    catch(e){
      if([400,401,403,404,409,413,422].includes(e?.status)&&typeof e.code==='string'){
        step.state='rejected';step.error={code:e.code,message:e.message,status:e.status};await retain(db,row);
      }
      throw e;
    }
    if(result.id!==caseId||result.action!=='source.add'||!/^source-[a-f0-9]{32}$/.test(result.recordId)||result.version!==step.body.expectedVersion+1)
      throw Error('The original source response needs reconciliation. Its frozen request remains selected.');
    step.result=copy(result);step.state='complete';row.retained[kind]=result.recordId;
    await retain(db,row);return result.recordId;
  }
  async function retainSources(){
    const row=chosen();if(!row)throw Error('Inspect the complete original package first.');
    caseValue=await validateRow(row);
    // Reconcile any frozen original before preparing a later phase or reading
    // a newer expected version. Its body is never rebuilt during recovery.
    for(const kind of ['archive','returnedJson'])if(row.steps[kind])await sourceStep(row,kind);
    if(!row.retained.archive)row.retained.archive=await sourceStep(row,'archive');
    if(!row.retained.returnedJson)row.retained.returnedJson=await sourceStep(row,'returnedJson');
    const current=await api(prefix);
    const linked=await api(prefix+'/installation-company-return-linked',{expectedVersion:current.program.version,
      archiveSourceId:row.retained.archive,returnSourceId:row.retained.returnedJson,archiveSha256:row.inspection.package.sha256});
    if(linked.package.sha256!==row.inspection.package.sha256||linked.caseId!==caseId||
       linked.retainedSources.archive.id!==row.retained.archive||linked.retainedSources.returnedJson.id!==row.retained.returnedJson)
      throw Error('The linked native selection differs from this intake.');
    row.linked=linked;await retain(db,row);caseValue=current;
    notice='Both exact original source files are retained and the full linked proposal passed native validation. Open it as a receiving draft when ready.';
  }
  async function openDraft(){
    const row=chosen();if(!row?.linked)throw Error('Retain and verify the complete originals first.');
    const current=await api(prefix),linked=await api(prefix+'/installation-company-return-linked',{expectedVersion:current.program.version,
      archiveSourceId:row.retained.archive,returnSourceId:row.retained.returnedJson,archiveSha256:row.inspection.package.sha256});
    if(!alive())return;
    await onDraft({inputs:copy(linked.inputs),checks:copy(linked.checks),baselineName:linked.baselineName,note:'',
      companyReturn:{returnId:linked.package.returnId,archiveSha256:linked.package.sha256,archiveSourceId:row.retained.archive,returnSourceId:row.retained.returnedJson}},current);
  }
  root.addEventListener('input',e=>{if(e.target.matches('[data-company-note]')){note=e.target.value;queueNote(chosen(),note);}});
  root.addEventListener('change',e=>{
    const target=e.target;
    if(target.matches('[data-company-work]')){const id=target.value;run(async()=>{selected=id;selectedNote();error='';},{allowUnsaved:true});return;}
    if(target.matches('[data-company-json]')){run(async()=>{const row=chosen();if(row.steps.returnedJson)throw Error('Keep the original returned-JSON request selected.');row.retained.returnedJson=target.value||null;row.linked=null;await retain(db,row);});return;}
    const file=target.files?.[0];if(!file)return;
    if(target.matches('[data-company-file]'))run(async()=>{if(file.size>MAX)throw Error('Select a ZIP within 8 MiB.');await selectPackage(new Uint8Array(await file.arrayBuffer()),file.name);});
    if(target.matches('[data-company-draft]'))run(async()=>{
      if(file.size>MAX_DRAFT)throw Error('The complete intake draft exceeds its 128 MiB transport bound.');
      const incoming=JSON.parse(await file.text()),next=await validateRow(incoming);
      if(!alive())return;
      const existing=(await list(db,caseId)).find(x=>x.id===incoming.id);
      if(existing){selected=existing.id;await refresh();notice='The existing original intake is retained. The imported copy did not replace later local work.';return;}
      incoming.localRevision=0;incoming.linked=null;
      // Captured outcomes are provenance. Reconcile each retained original
      // request with the native ledger before using it in this browser.
      for(const step of Object.values(incoming.steps)){step.capturedResult=step.result||step.capturedResult||null;delete step.result;step.state='pending';}
      await retain(db,incoming);rows.push(incoming);selected=incoming.id;caseValue=next;note=incoming.note||'';
      notice='Complete original work reopened. Recover its original source requests before using linked inputs.';
    });
  });
  root.addEventListener('click',e=>{
    const t=e.target.closest('[data-company-action]');if(!t||t.disabled)return;
    const action=t.dataset.companyAction;
    run(async()=>{
      const row=chosen();
      if(action==='refresh')return refresh();
      if(action==='note'){notice='The full intake and note are retained in this browser. Download the complete draft to move it.';return;}
      if(action==='source'){
        const id=root.querySelector('[data-company-source]').value,metadata=caseValue.sources.find(x=>x.id===id);
        if(!metadata)throw Error('Select the original retained ZIP source.');
        const response=await api(prefix+'/sources/'+id,undefined,{download:true}),raw=new Uint8Array(await response.arrayBuffer());
        return selectPackage(raw,metadata.filename,id,metadata.sha256);
      }
      if(action==='retain')return retainSources();
      if(action==='open')return openDraft();
      if(!row)throw Error('Select the complete original intake.');
      if(action==='draft'){
        const portable=copy(row);portable.note=noteDrafts[row.id]?.note??row.note??'';portable.linked=null; // native read-only output is regenerated on reopen
        const raw=JSON.stringify(portable)+'\n';
        if(new Blob([raw]).size>MAX_DRAFT)throw Error('This complete draft exceeds the 128 MiB transport bound; no truncated file was emitted. Keep the native originals and current private intake.');
        return download(raw,'Company_Return_Intake_'+row.id+'.json');
      }
      if(action==='archive')return download(bytes(row.archiveBase64),'Installation_Return_'+row.inspection.package.returnId+'.zip','application/zip');
      if(action==='json')return download(bytes(row.inspection.returnedSource.contentBase64),row.inspection.returnedSource.filename);
    },{allowUnsaved:['refresh','draft','archive','json'].includes(action),retryNote:action==='note'});
  });
  const ready=(async()=>{db=await database();await (noteWrites.get(caseId)||Promise.resolve());if(!alive()){db.close();return;}await refresh();render();})().catch(e=>{error='Private intake storage could not open: '+e.message;render();});
  render();
  return {root,ready,setHostBusy(value){externalBusy=!!value;controls();},dispose(){active=false;++selectionGeneration;closeWhenDrained();}};
}
