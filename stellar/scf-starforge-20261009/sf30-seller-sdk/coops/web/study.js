/* MIT. Coastal study controls share the original console's state, drafts and operation journal. */
'use strict';
globalThis.createCoopsStudyView=function(H){
 const {A,$,$$,esc,clone,recordKey,details,table,button,heading,field,area,select,badge,draft,setDraft,clearDraft,api,perform,resumeOriginal,refresh,persist,renderPage,navigate,download,modal,notice}=H;
 const CHUNK=1048576;let selectedFile=null,uploading=false,previewSerial=0;
 const encode=encodeURIComponent,sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const base64=bytes=>{let out='';for(let i=0;i<bytes.length;i+=32768)out+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(out);};
 const studies=()=>A.view.studies??[],reviews=()=>A.view.studyReviews??[],releases=()=>A.view.studyReleases??[],uploads=()=>A.view.studyUploads??[],returns=()=>A.view.studyReturns??[],receivings=()=>A.view.studyReceivings??[];
 const selected=(list,id)=>{const row=list.find(x=>x.id===id);if(!row)throw new Error('The selected retained study record is unavailable. Refresh the workspace.');return row;};
 function original(id,revision){const current=selected(studies(),id);const value=[current,...(current.history??[])].find(s=>s.revision===Number(revision));if(!value)throw new Error('Choose a retained study revision.');return value;}
 function studyFields(s){return{studyId:s.id,expectedStudyRevision:s.revision,...Object.fromEntries(['name','project','question','owner','table','mappingId','basisPolicy','note'].map(k=>[k,s.selection[k]])),members:s.selection.members.map(m=>({editionId:m.editionId,beginDate:m.selection.beginDate,endDate:m.selection.endDate,products:m.selection.products.join(',')}))};}
 function binding(key,value){
  if(key==='study')return{type:'study',id:value?.studyId||null};
  if(key.startsWith('study-review:')){const [,studyId,revision]=key.split(':');return{type:'study-review',studyId,revision:Number(revision)};}
  if(key.startsWith('study-receive:'))return{type:'study-receive',returnId:key.slice(14)};
  return null;
 }
 function savedSubject(b,v){
  if(b.type==='study')return(v.studies??[]).find(s=>s.id===b.id)??null;
  if(b.type==='study-review')return(v.studyReviews??[]).filter(r=>r.studyId===b.studyId&&r.studyRevision===b.revision).at(-1)??null;
  if(b.type==='study-receive')return(v.studyReceivings??[]).filter(r=>r.returnId===b.returnId).at(-1)??null;
  throw new Error('Unknown study draft binding.');
 }
 function nativeDraft(b,s,current){
  if(b.type==='study')return s?studyFields(s):{...clone(current),studyId:'',expectedStudyRevision:null};
  if(b.type==='study-review')return s?{actor:s.actor,note:s.note,status:s.status,acknowledgedWarnings:clone(s.acknowledgedWarnings)}:clone(current);
  return s?{actor:s.actor,note:s.note,status:s.status}:clone(current);
 }
 function applyDraft(effect,response){
  const b=effect.binding,record=response.result,d=A.drafts[effect.key];
  if(b.type==='study'){
   if(b.id&&record.id!==b.id)throw Object.assign(new Error('The saved study reply belongs to another original draft.'),{uncertain:true});
   if(d.studyId&&d.studyId!==b.id&&d.studyId!==record.id){effect.outcome='different_study_preserved';return;}
   d.studyId=record.id;d.expectedStudyRevision=record.revision;
  }else if(b.type==='study-review'){
   if(record.studyId!==b.studyId||record.studyRevision!==b.revision)throw Object.assign(new Error('The saved study review changed its original subject.'),{uncertain:true});
  }else if(record.returnId!==b.returnId)throw Object.assign(new Error('The receiving reply changed its original returned file.'),{uncertain:true});
  A.draftBases[effect.key]={binding:clone(binding(effect.key,d)),known:true,record:clone(record)};effect.outcome='saved_identity_applied';effect.savedId=record.id;
 }
 function applyEffect(pending,response){
  const effect=pending.studyEffect;if(!effect)return;
  const d=A.drafts[effect.key];if(!d||A.draftTokens[effect.key]!==effect.token){effect.outcome='different_draft_preserved';return;}
  if(effect.kind==='dataset-prepare'){
   const r=response.result;
   if(r?.sourceKind!=='reviewed-study'||r.studyReleaseId!==effect.releaseId||r.studySha256!==effect.studySha256||r.csvSha256!==effect.csvSha256||r.name!==effect.name)
    throw Object.assign(new Error('The prepared dataset reply differs from its exact original study delivery.'),{uncertain:true});
   d.preparedDatasetId=r.id;d.preparedName=effect.name;effect.savedId=r.id;effect.outcome='original_study_dataset_applied';
  }
  if(effect.kind==='upload-start'){
   const r=response.result;if(!r?.id||r.releaseId!==effect.releaseId||r.filename!==effect.filename||r.bytes!==effect.bytes||r.format!==effect.format)throw Object.assign(new Error('The returned-file intake reply differs from its original selection.'),{uncertain:true});
   d.uploadId=r.id;d.original={filename:r.filename,bytes:r.bytes,format:r.format,releaseId:r.releaseId};effect.savedId=r.id;effect.outcome='original_intake_applied';
  }
 }
 function datasetReason(release){
  const file=release.files.find(f=>f.format==='csv'),limits=A.schema.studyDataset??{maximumRows:250000,maximumBytes:268435456};
  if(!file)return'The original complete CSV is unavailable.';
  if(release.counts.rows>limits.maximumRows||file.bytes>limits.maximumBytes)return'This complete CSV exceeds the native '+limits.maximumRows.toLocaleString()+'-row / 256 MiB query limit. Save and review a narrower study selection; this delivery remains complete.';
  const columns=release.manifest.columns,invalid=columns.filter(c=>!(/^[A-Za-z][A-Za-z0-9_]{0,47}$/).test(c)||['constructor','prototype','__proto__'].includes(c));
  if(invalid.length)return'The delivered headings need an explicitly revised mapping/study before native querying: '+invalid.join(', ')+'. This original CSV will retain its headings.';
  return'';
 }
 function openStudyDataset(release){
  const key='study-dataset:'+release.id,d=draft(key,{name:release.study.selection.name.slice(0,128),preparedDatasetId:'',preparedName:''}),
   file=release.files.find(f=>f.format==='csv'),reason=datasetReason(release),prepared=d.preparedDatasetId?(A.view.datasets??[]).find(x=>x.id===d.preparedDatasetId):null;
  modal('Use the reviewed delivery in native queries',
   '<p>'+esc(release.study.selection.name)+' · revision '+release.studyRevision+'</p><p class="pin">'+esc(release.id)+'<br>'+esc(release.studySha256)+'</p>'+
   '<p>The complete released CSV contains '+release.counts.rows.toLocaleString()+' rows and '+(file?.bytes??0).toLocaleString()+' bytes. The original SF30 query and SF82 publisher keep its exact stored review, mapping and source identities.</p>'+
   '<p>Recorded review: '+esc(release.review.actor)+' · '+esc(release.review.createdAt)+'. Later study or review decisions remain separate; this is the frozen decision attached to this delivery.</p>'+
   (reason?'<p role="alert">'+esc(reason)+'</p>':'')+
   '<form id="study-dataset-form" data-release-id="'+esc(release.id)+'" data-key="'+esc(key)+'">'+
   field(key,'name','Name for the native dataset',d.name,'text','required maxlength="128"')+
   '<button id="study-dataset-prepare" type="submit" '+(reason?'disabled':'')+'>Prepare or open this named dataset</button></form>'+
   (prepared?'<p>Original prepared dataset: <span class="pin">'+esc(prepared.id)+'</span> · '+esc(prepared.name)+'. The same name reopens that receipt. Entering another name explicitly prepares a separate dataset from the same frozen delivery.</p>'+button('study-dataset-open','Open saved dataset',prepared.id):'')+
   details('Released mapping and native basis warnings',{mapping:release.manifest.mapping,warnings:release.study.selection.warnings})+
   details('Exact released CSV / manifest',{file,manifestSha256:release.manifestSha256}));
 }
 function member(e,tableName='observations'){return{editionId:e?.id??'',beginDate:e?.query.beginDate??'',endDate:e?.query.endDate??'',products:(e?.query.products.filter(p=>tableName==='predictions'?p==='predictions':p!=='predictions')??[]).join(',')};}
 function defaults(){return{studyId:'',expectedStudyRevision:null,name:'',project:'',question:'',owner:'',table:'observations',mappingId:'',basisPolicy:'uniform_requests',members:A.allEditions.length?[member(A.allEditions[0])]:[],note:''};}
 function payload(){
  const d=draft('study',defaults()),p={...Object.fromEntries(['name','project','question','owner','table','mappingId','basisPolicy','note'].map(k=>[k,d[k]])),
   members:d.members.map(m=>({editionId:m.editionId,beginDate:m.beginDate,endDate:m.endDate,products:String(m.products).split(',').map(p=>p.trim()).filter(Boolean)}))};
  if(d.studyId){p.studyId=d.studyId;p.expectedStudyRevision=d.expectedStudyRevision;}return p;
 }
 const fileButtons=files=>'<div class="actions">'+files.map(f=>button('study-file',f.format+' · '+f.bytes.toLocaleString()+' bytes',f.id)).join('')+'</div>';
 function previewMarkup(p){
  if(!p)return'<p>Preview the complete selected windows and receiving columns before saving.</p>';
  const v=p.value;return'<section class="card"><h2>Selection preview</h2>'+badge(v.valid?'READY FOR REVIEW':'SELECTION NEEDS WORK')+
   '<p class="pin">Selection '+esc(v.sha256)+'</p>'+
   (v.errors.length?table(['Selection issue','Reason'],v.errors.map(e=>[esc(e.code),esc(e.message)])):'')+
   (v.warnings.length?table(['Review point','Reason'],v.warnings.map(w=>[esc(w.code),esc(w.message)])):'<p>No additional basis warning was identified. This does not establish complete observations.</p>')+
   table(['Station / original edition','Selected dates / products','Native basis','Source outcomes'],v.selection.members.map(m=>[
    esc(m.stationId)+' · '+esc(m.stationName)+'<br><span class="pin">'+esc(m.editionId)+'</span>',
    esc(m.selection.beginDate)+' → '+esc(m.selection.endDate)+'<br>'+esc(m.selection.products.join(', ')),
    esc(m.basis.datum)+' / '+esc(m.basis.units)+' / '+esc(m.basis.timeZone),
    (m.sourceComplete?'All selected requests have an outcome':'Unfinished requests retained')+'; '+m.unavailableRequests.length+' unavailable']))+
   details('Exact mapping, station context, source hashes and whole-edition coverage',v.selection)+'</section>';
 }
 function membersMarkup(d){
  const opts=A.allEditions.map(e=>({value:e.id,label:e.profile.label+' · '+e.query.beginDate+' → '+e.query.endDate+' · '+e.id.slice(0,10)}));
  return d.members.map((m,i)=>'<fieldset class="study-member"><legend>Source member '+(i+1)+'</legend><label>Original source edition<select data-study-member="'+i+'" data-member-field="editionId">'+
   [{value:'',label:'Select retained edition'},...opts].map(o=>'<option value="'+esc(o.value)+'"'+(o.value===m.editionId?' selected':'')+'>'+esc(o.label)+'</option>').join('')+'</select></label>'+
   '<div class="grid">'+[['beginDate','First selected date','date'],['endDate','Last selected date','date'],['products','Exact products (comma separated)','text']].map(([key,label,type])=>'<label>'+esc(label)+'<input type="'+type+'" data-study-member="'+i+'" data-member-field="'+key+'" value="'+esc(m[key])+'"></label>').join('')+'</div>'+
   '<div class="actions">'+button('study-member-up','Move earlier',String(i),' '+(i===0?'disabled':''))+button('study-member-down','Move later',String(i),' '+(i===d.members.length-1?'disabled':''))+button('study-member-remove','Remove selection',String(i))+'</div></fieldset>').join('');
 }
 function editor(){
  const d=draft('study',defaults()),p=A.drafts.studyPreview,current=p&&p.token===A.draftTokens.study&&p.payload===recordKey(payload())?p:null;
  return'<section class="card"><h2>'+esc(d.studyId?'Edit selected study · revision '+d.expectedStudyRevision:'Prepare a coastal study')+'</h2>'+
   '<p>Select each original source window explicitly. Ordered members define output order; overlapping station/product windows must be resolved.</p>'+
   '<form id="study-form" class="grid">'+field('study','name','Study name',d.name,'text','required')+field('study','project','Actual project or public-reference label',d.project)+
   area('study','question','Engineering question and receiving purpose',d.question)+field('study','owner','Responsible team',d.owner,'text','required')+
   select('study','table','Source table',['observations','predictions'],d.table)+select('study','basisPolicy','Request basis',[{value:'uniform_requests',label:'Matching native request bases'},{value:'mixed_native',label:'Explicitly separated mixed native bases'}],d.basisPolicy)+
   select('study','mappingId','Saved receiving mapping',[{value:'',label:'Select a saved mapping'},...(A.view.mappings??[]).filter(m=>m.table===d.table).map(m=>({value:m.id,label:m.name+' · revision '+m.revision}))],d.mappingId)+
   area('study','note','Source selection and receiving decisions',d.note)+
   '<div class="study-wide">'+membersMarkup(d)+'<div class="actions">'+button('study-member-add','Add original edition window')+button('older-editions','Load older retained editions')+button('navigate','Review model-input mappings','mappings')+'</div></div>'+
   '<div class="actions study-wide"><button type="submit" id="study-preview">Preview exact selection</button>'+button('study-save','Save this reviewed selection','','id="study-save" '+(!current?.value.valid?'disabled':''))+button('study-new','Open a distinct study draft')+'</div></form>'+previewMarkup(current)+'</section>';
 }
 function render(){
  const all=studies(),selectedView=A.drafts.studySelected,shown=selectedView?(()=>{try{return original(selectedView.id,selectedView.revision);}catch{return null;}})():null;
  return heading('Coastal studies and receiving','Select up to five stations and five years from retained editions. Save exact source windows, review the native bases, release complete model-input files, then compare a returned file without changing the original NOAA evidence.')+
   table(['Study','Current revision / source',''],all.map(s=>[esc(s.selection.name),String(s.revision)+' · '+esc(s.selection.source.stationIds.join(', ')),button('study-open','Open saved study',s.id)+button('study-edit','Edit current selection',s.id)+button('study-history','Earlier revisions',s.id)]))+
   editor()+(shown?savedMarkup(shown):'')+
   '<section class="card"><h2>Immutable deliveries</h2>'+table(['Study / revision','Original review / delivered rows','Files and receiving'],releases().slice().reverse().map(r=>[
    esc(r.study.selection.name)+' · '+r.studyRevision,esc(r.review.actor)+' · '+esc(r.review.createdAt)+'<br>'+r.counts.rows.toLocaleString()+' rows',
    fileButtons(r.files)+button('study-return-open','Retain a returned CSV or JSONL',r.id)+button('study-release-detail','Exact delivery manifest',r.id)+button('study-dataset','Use complete delivery in native queries',r.id)]))+'</section>'+
   returnMarkup()+
   '<section class="card"><h2>Returned files and decisions</h2>'+table(['Original file / study','Comparison',''],returns().slice().reverse().map(r=>{
    const decision=receivings().filter(d=>d.returnId===r.id).at(-1);return[esc(r.filename)+'<br>'+esc(r.studyId)+' · '+r.studyRevision,
     badge(r.summary.complete?'COMPLETE COMPARISON':'FOLLOW-UP REQUIRED')+'<br>'+esc(JSON.stringify(r.summary.counts))+'<br>'+(decision?badge(decision.status)+' · '+esc(decision.actor):'No receiving decision'),
     fileButtons(r.files)+button('study-return-detail','Inspect and record receiving',r.id)];}))+'</section>';
 }
 function savedMarkup(s){
  const decisions=reviews().filter(r=>r.studyId===s.id&&r.studyRevision===s.revision),latest=decisions.at(-1);
  return'<section class="card"><h2>Saved study · '+esc(s.selection.name)+' · revision '+s.revision+'</h2><p class="pin">'+esc(s.id)+' · '+esc(s.sha256)+'</p>'+
   (latest?'<p>Latest decision '+badge(latest.status)+' · '+esc(latest.actor)+' · '+esc(latest.createdAt)+'</p><p>'+esc(latest.note)+'</p>':'<p>No decision has been recorded for this exact revision.</p>')+
   '<div class="actions">'+button('study-rows','Inspect selected original rows',s.id,'data-revision="'+s.revision+'" data-offset="0"')+
   button('study-review-open','Review this revision',s.id,'data-revision="'+s.revision+'"')+
   button('study-release','Create immutable delivery',s.id,'data-revision="'+s.revision+'" '+(latest?.status!=='reviewed'?'disabled':''))+'</div>'+
   details('Complete saved selection',s)+details('Append-only review decisions',decisions)+'</section>';
 }
 function returnMarkup(){
  const d=draft('studyReturn',{releaseId:'',format:'csv',note:'',uploadId:'',original:null});
  if(!d.releaseId)return'';
  const release=releases().find(r=>r.id===d.releaseId);if(!release)return'';
  const u=d.uploadId?uploads().find(u=>u.id===d.uploadId):null;
  return'<section class="card"><h2>Return to delivery '+esc(release.id)+'</h2><p>'+esc(release.study.selection.name)+' · study revision '+release.studyRevision+'</p>'+
   '<p>Retain the original returned UTF-8 CSV or JSONL. Every mapped field is a string; keep the exact headings and the four source-identity columns. Reordering is allowed. An edited measurement remains receiving evidence.</p>'+
   '<form id="study-upload-form" class="grid"><label>Original returned file<input id="study-return-file" type="file" accept=".csv,.jsonl" '+(uploading?'disabled':'')+'></label>'+
   select('studyReturn','format','Original file format',['csv','jsonl'],u?u.format:d.format,u?'disabled':'')+
   area('studyReturn','note','Actual returned-file source and purpose',d.note)+
   '<div class="actions study-wide"><button type="submit" id="study-upload" '+(uploading?'disabled':'')+'>'+(u?'Resume original file intake':'Retain selected returned file')+'</button>'+
   button('study-upload-pause','Pause after current chunk','',' '+(!uploading?'disabled':''))+
   (u?button('study-return-finish',u.state==='COMPLETE'?'Open retained comparison':'Compare complete returned file',u.id,' '+(u.receivedBytes!==u.bytes||uploading?'disabled':'')):'')+'</div></form>'+
   '<p id="study-upload-progress">'+(u?esc(u.state)+' · '+u.receivedBytes.toLocaleString()+' / '+u.bytes.toLocaleString()+' bytes · '+esc(u.filename):'Select the original file. A browser reload requires reselecting its exact bytes.')+'</p>'+
   (u?details('Retained original chunks and operation identity',u):'')+
   '<h3>Earlier pending returns</h3>'+table(['File','State / retained bytes',''],uploads().filter(x=>x.releaseId===d.releaseId&&x.state!=='COMPLETE').map(x=>[esc(x.filename),esc(x.state)+' · '+x.receivedBytes+' / '+x.bytes,button('study-upload-open','Resume original intake',x.id)]))+'</section>';
 }
 function close(){if($('#dialog').open)$('#dialog').close();}
 function openReview(s){
  const key='study-review:'+s.id+':'+s.revision,latest=reviews().filter(r=>r.studyId===s.id&&r.studyRevision===s.revision).at(-1),
   d=draft(key,latest?{actor:latest.actor,note:latest.note,status:latest.status,acknowledgedWarnings:clone(latest.acknowledgedWarnings)}:{actor:'',note:'',status:'',acknowledgedWarnings:[]});
  modal('Review exact coastal study revision','<p>'+esc(s.selection.name)+' · revision '+s.revision+'</p><p class="pin">'+esc(s.sha256)+'</p>'+
   details('Original selected study and source evidence',s)+
   '<form id="study-review-form" class="grid" data-study-id="'+esc(s.id)+'" data-revision="'+s.revision+'" data-key="'+esc(key)+'">'+
   field(key,'actor','Actual reviewer',d.actor,'text','required')+
   select(key,'status','Decision',[{value:'',label:'Select a decision'},{value:'reviewed',label:'Reviewed'},{value:'follow_up',label:'Follow-up required'}],d.status)+
   area(key,'note','Source, basis and receiving review note',d.note)+
   '<fieldset class="study-wide"><legend>Explicit basis and coverage points</legend>'+s.selection.warnings.map(w=>'<label><input type="checkbox" data-study-warning="'+esc(w.id)+'" data-key="'+esc(key)+'" '+(d.acknowledgedWarnings.includes(w.id)?'checked':'')+'> '+esc(w.message)+'</label>').join('')+
   (!s.selection.warnings.length?'<p>No additional warning was generated; the reviewer still inspects the selected sources and requested scope.</p>':'')+'</fieldset><button type="submit">Save this exact review</button></form>');
 }
 function openReturned(r){
  const latest=receivings().filter(d=>d.returnId===r.id).at(-1),key='study-receive:'+r.id,
   d=draft(key,latest?{actor:latest.actor,note:latest.note,status:latest.status}:{actor:'',note:'',status:''});
  modal('Returned-file comparison and receiving','<p>'+esc(r.filename)+' · original delivery '+esc(r.releaseId)+'</p>'+
   '<p class="pin">Returned SHA-256 '+esc(r.original.sha256)+'<br>Complete comparison '+esc(r.comparisonSha256)+'</p>'+
   table(['Comparison','Count'],Object.entries(r.summary.counts).map(([k,v])=>[esc(k),String(v)]))+
   '<p>'+(r.summary.complete?'Every selected original and returned row was processed.':'This file remains unresolved; inspect the recorded format or capacity issue.')+' Duplicate identities are not assigned by occurrence. Original NOAA sources remain unchanged.</p>'+
   fileButtons(r.files)+details('Comparison summary and bounded examples; download the complete comparison for every row',r.summary)+details('Earlier receiving decisions',receivings().filter(d=>d.returnId===r.id))+
   '<form id="study-receiving-form" class="grid" data-return-id="'+esc(r.id)+'" data-key="'+esc(key)+'">'+
   field(key,'actor','Actual receiving operator',d.actor,'text','required')+
   select(key,'status','Decision',[{value:'',label:'Select a decision'},{value:'accepted',label:'Accept reviewed returned content'},{value:'follow_up',label:'Follow-up required'}],d.status)+
   area(key,'note','Changed, missing or added rows accepted; unresolved points and next action',d.note)+'<button type="submit">Save receiving decision</button></form>');
 }
 async function upload(form){
  if(uploading)throw new Error('The original file intake is still running.');
  if(A.pending)throw new Error('Reconcile the original pending request before resuming file intake.');
  const chosen=$('#study-return-file')?.files[0]??selectedFile;if(!chosen)throw new Error('Reselect the exact original returned file to resume.');
  if(chosen.size>1073741824)throw new Error('Select one original returned file up to 1 GiB.');
  selectedFile=chosen;const d=draft('studyReturn',{}),token=A.draftTokens.studyReturn,releaseId=d.releaseId,selectedFormat=d.format;
  const originalSpec={filename:chosen.name,bytes:chosen.size,format:selectedFormat,releaseId};
  if(d.uploadId&&recordKey(d.original)!==recordKey(originalSpec))throw new Error('This selection differs from the original intake. Preserve it and open a distinct return.');
  uploading=true;for(const node of [$('#study-return-file'),$('#study-upload')])if(node)node.disabled=true;const pause=$('[data-cmd="study-upload-pause"]');if(pause)pause.disabled=false;const live=()=>uploading&&A.draftTokens.studyReturn===token&&A.drafts.studyReturn.releaseId===releaseId;
  const ensure=()=>{if(!live())throw new Error('Intake paused. Its retained original chunks and pending request remain available.');};
  try{
   await refresh(false);ensure();
   if(!d.uploadId){
    await perform('study.return.start',{releaseId,format:selectedFormat,filename:chosen.name,bytes:chosen.size,note:d.note},
     {studyEffect:{kind:'upload-start',key:'studyReturn',token,...originalSpec}});
    ensure();if(!d.uploadId)throw new Error('Inspect or replay the original intake action before continuing.');
   }
   let u=selected(uploads(),d.uploadId);
   if(u.state==='COMPLETE'){openReturned(selected(returns(),u.returnId));return;}
   if(u.state==='COMPARING')throw new Error('Resume the original comparison operation '+u.finishingOperationId+' from the retained requests.');
   for(let offset=0;offset<chosen.size;offset+=CHUNK){
    ensure();const bytes=new Uint8Array(await chosen.slice(offset,Math.min(chosen.size,offset+CHUNK)).arrayBuffer());ensure();
    const prior=u.chunks.find(c=>c.offset===offset);
    if(prior){if(prior.bytes!==bytes.length||prior.sha256!==await sha(bytes))throw new Error('The reselected file differs from its retained original prefix. Keep this intake and use a distinct return for the changed file.');}
    else{
     await perform('study.return.chunk',{uploadId:u.id,offset,base64:base64(bytes)});ensure();u=selected(uploads(),u.id);
     const node=$('#study-upload-progress');if(node)node.textContent=u.state+' · '+u.receivedBytes.toLocaleString()+' / '+u.bytes.toLocaleString()+' bytes · '+u.filename;
    }
   }
   notice('All selected bytes are retained. Compare the complete returned file when ready.');
  }finally{uploading=false;if(A.tab==='studies')renderPage();}
 }
 async function submit(form){
  if(form.id==='study-form'){
   const p=payload(),token=A.draftTokens.study,serial=++previewSerial,key=recordKey(p);
   const value=await api('/api/study-preview',{body:p});
   if(serial!==previewSerial||token!==A.draftTokens.study||recordKey(payload())!==key)throw new Error('The study draft changed while its preview was being prepared. Preview the current fields.');
   A.drafts.studyPreview={value,payload:key,token};await persist();renderPage();return;
  }
  if(form.id==='study-review-form'){
   const s=original(form.dataset.studyId,form.dataset.revision),key=form.dataset.key,d=draft(key,{}),base=A.draftBases[key]?.record;
   await perform('study.review',{studyId:s.id,studyRevision:s.revision,studySha256:s.sha256,expectedReviewId:base?.id??'',actor:d.actor,status:d.status,note:d.note,acknowledgedWarnings:clone(d.acknowledgedWarnings)},{draftKey:key});
   close();renderPage();return;
  }
  if(form.id==='study-dataset-form'){
   const release=selected(releases(),form.dataset.releaseId),key=form.dataset.key,d=draft(key,{});
   if(key!=='study-dataset:'+release.id)throw new Error('Keep the original released study selection.');
   if(d.preparedDatasetId&&d.preparedName===d.name){
    const saved=(A.view.datasets??[]).find(x=>x.id===d.preparedDatasetId);
    if(saved?.studyReleaseId!==release.id||saved.name!==d.name)throw new Error('Inspect the retained original preparation before issuing another dataset.');
    close();await navigate('datasets');return;
   }
   const reason=datasetReason(release);if(reason)throw new Error(reason);
   await perform('study.dataset.prepare',{releaseId:release.id,name:d.name},{studyEffect:{kind:'dataset-prepare',key,token:A.draftTokens[key],
    releaseId:release.id,studySha256:release.studySha256,csvSha256:release.files.find(f=>f.format==='csv').sha256,name:d.name}});
   close();await navigate('datasets');return;
  }
  if(form.id==='study-upload-form')return upload(form);
  if(form.id==='study-receiving-form'){
   const r=selected(returns(),form.dataset.returnId),key=form.dataset.key,d=draft(key,{}),base=A.draftBases[key]?.record;
   await perform('study.receive',{returnId:r.id,comparisonSha256:r.comparisonSha256,expectedDecisionId:base?.id??'',actor:d.actor,status:d.status,note:d.note},{draftKey:key});close();renderPage();return;
  }
 }
 async function click(cmd,id,control){
  if(cmd==='study-save'){
   const p=payload(),preview=A.drafts.studyPreview;
   if(!preview?.value.valid||preview.token!==A.draftTokens.study||preview.payload!==recordKey(p))throw new Error('Preview this exact selected study before saving.');
   const saved=await perform('study.save',{...p,expectedPreviewSha256:preview.value.sha256},{draftKey:'study'});
   if(saved?.result?.id)A.drafts.studySelected={id:saved.result.id,revision:saved.result.revision};await persist();renderPage();return;
  }
  if(cmd==='study-new'){clearDraft('study');delete A.drafts.studyPreview;previewSerial++;await persist();renderPage();return;}
  if(cmd==='study-edit'){setDraft('study',studyFields(selected(studies(),id)));delete A.drafts.studyPreview;previewSerial++;await persist();renderPage();return;}
  if(cmd==='study-open'||cmd==='study-version'){const s=cmd==='study-version'?original(id,control.dataset.revision):selected(studies(),id);A.drafts.studySelected={id:s.id,revision:s.revision};close();await persist();renderPage();return;}
  if(cmd==='study-history'){const s=selected(studies(),id);modal('Earlier immutable study revisions',table(['Revision','Name / source period',''],[s,...s.history.slice().reverse()].map(v=>[String(v.revision),esc(v.selection.name)+'<br>'+esc(v.selection.source.beginDate)+' → '+esc(v.selection.source.endDate),button('study-version','Open exact revision',id,'data-revision="'+v.revision+'"')])));return;}
  if(cmd==='study-member-add'){const d=draft('study',defaults());if(d.members.length>=64)throw new Error('Select at most 64 source windows.');d.members.push(member(A.allEditions[0],d.table));}
  else if(cmd==='study-member-remove')draft('study',{}).members.splice(Number(id),1);
  else if(cmd==='study-member-up'||cmd==='study-member-down'){const a=draft('study',{}).members,i=Number(id),j=i+(cmd==='study-member-up'?-1:1);if(i>=0&&j>=0&&i<a.length&&j<a.length)[a[i],a[j]]=[a[j],a[i]];}
  else if(cmd==='study-rows'){
   const revision=Number(control.dataset.revision),offset=Number(control.dataset.offset??0),s=original(id,revision);
   const result=await api('/api/study-rows?'+new URLSearchParams({studyId:id,revision:String(revision),offset:String(offset),limit:'100'}));
   modal('Selected original source rows','<p>'+esc(s.selection.name)+' · revision '+revision+' · offset '+offset+'</p><p>'+esc(result.note)+'</p>'+
    table(['Station / source member','Native time / product','Original value / basis','Source identity'],result.rows.map(({memberId,row})=>[
     esc(row.stationId)+'<br>'+esc(memberId),esc(row.timestamp)+'<br>'+esc(row.product),esc(row.value)+' '+esc(row.unit)+' · '+esc(row.valueType)+'<br>'+esc(row.datum)+' / '+esc(row.timeZone),
     esc(row.recordId)+'<br><span class="pin">'+esc(row.sourcePageSha256)+'</span><br>'+esc(row.sourceRecord)]))+
    '<div class="actions">'+(offset?button('study-rows','Previous original rows',id,'data-revision="'+revision+'" data-offset="'+Math.max(0,offset-100)+'"'):'')+
    (result.nextOffset!==null?button('study-rows','Next original rows',id,'data-revision="'+revision+'" data-offset="'+result.nextOffset+'"'):'')+'</div>'+details('Full displayed rows, original flags and source locators',result));return;
  }else if(cmd==='study-review-open'){openReview(original(id,control.dataset.revision));return;}
  else if(cmd==='study-release'){
   const s=original(id,control.dataset.revision),latest=reviews().filter(r=>r.studyId===id&&r.studyRevision===s.revision).at(-1);
   if(latest?.status!=='reviewed')throw new Error('Review this exact study revision before preparing its delivery.');
   await perform('study.export',{studyId:s.id,studyRevision:s.revision,studySha256:s.sha256,reviewId:latest.id});renderPage();return;
  }else if(cmd==='study-file')return download({kind:'export',id});
  else if(cmd==='study-dataset'){openStudyDataset(selected(releases(),id));return;}
  else if(cmd==='study-dataset-open'){selected(A.view.datasets,id);close();await navigate('datasets');return;}
  else if(cmd==='study-release-detail'){modal('Exact retained delivery manifest',details('Original complete manifest',selected(releases(),id).manifest));return;}
  else if(cmd==='study-return-open'){uploading=false;selectedFile=null;setDraft('studyReturn',{releaseId:id,format:'csv',note:'',uploadId:'',original:null});await persist();renderPage();return;}
  else if(cmd==='study-upload-open'){
   const u=selected(uploads(),id);uploading=false;selectedFile=null;setDraft('studyReturn',{releaseId:u.releaseId,format:u.format,note:u.note,uploadId:u.id,original:{filename:u.filename,bytes:u.bytes,format:u.format,releaseId:u.releaseId}});await persist();renderPage();return;
  }else if(cmd==='study-upload-pause'){uploading=false;notice('Pausing after the current original chunk; its exact pending request is preserved.');return;}
  else if(cmd==='study-return-finish'){
   const u=selected(uploads(),id);if(u.state==='COMPLETE'){openReturned(selected(returns(),u.returnId));return;}
   let result;if(u.state==='COMPARING'){
    const record=await api('/api/operation?operationId='+encode(u.finishingOperationId));
    if(record.operationId!==u.finishingOperationId||record.resumeRequest?.payload?.uploadId!==u.id)throw new Error('The original native comparison request is unavailable. Keep this file intake for inspection.');
    result=await resumeOriginal(record.resumeRequest);
   }else result=await perform('study.return.finish',{uploadId:id});if(result?.result?.id)openReturned(result.result);return;
  }else if(cmd==='study-return-detail'){openReturned(selected(returns(),id));return;}
  else return;
  delete A.drafts.studyPreview;previewSerial++;await persist();renderPage();
 }
 document.addEventListener('input',event=>{
  const el=event.target;
  if(el.dataset.studyMember!==undefined){
   const d=draft('study',defaults()),i=Number(el.dataset.studyMember),m=d.members[i];if(!m)return;
   if(el.dataset.memberField==='editionId'){const e=A.allEditions.find(e=>e.id===el.value);d.members[i]=member(e,d.table);}
   else m[el.dataset.memberField]=el.value;
   delete A.drafts.studyPreview;previewSerial++;void persist().then(()=>{if(el.dataset.memberField==='editionId')renderPage();}).catch(e=>notice(e.message,true));return;
  }
  if(el.dataset.studyWarning){const d=draft(el.dataset.key,{});d.acknowledgedWarnings=d.acknowledgedWarnings.filter(x=>x!==el.dataset.studyWarning);if(el.checked)d.acknowledgedWarnings.push(el.dataset.studyWarning);void persist().catch(e=>notice(e.message,true));return;}
  if(el.dataset.form==='study'){delete A.drafts.studyPreview;previewSerial++;const save=$('#study-save');if(save)save.disabled=true;void persist().catch(e=>notice(e.message,true));}
 });
 document.addEventListener('change',event=>{
  const el=event.target;if(el.matches('select[data-study-member]'))el.dispatchEvent(new Event('input',{bubbles:true}));
  if(el.id==='study-return-file')selectedFile=el.files[0]??null;
 });
 function completedHistory(pending,response){
  if(!pending.request.action.startsWith('study.'))return null;
  const request=clone(pending.request),native=response.view.operations.find(o=>o.operationId===request.operationId);
  if(request.action==='study.return.chunk'){delete request.payload.base64;request.payloadStorage='Original bytes retained by the native upload chunk digest; this completed history entry is a receipt, not a replay request.';}
  const r=response.result,result=Object.fromEntries(['id','state','sourceKind','studyId','studyRevision','studySha256','studyReleaseId','snapshot','csvSha256','rows','sourceManifestSha256','releaseId','returnId','comparisonSha256','receivedBytes','bytes','sha256','status'].filter(k=>r?.[k]!==undefined).map(k=>[k,r[k]]));
  return{request,originalRequestSha256:native?.requestSha256??null,response:{operationId:response.operationId,reused:response.reused,result},draftEffect:pending.draftEffect??null,studyEffect:pending.studyEffect??null,originalResultStorage:'Read the original native operation for the complete immutable result.',completedAt:new Date().toISOString()};
 }
 return{render,binding,savedSubject,nativeDraft,applyDraft,applyEffect,completedHistory,submit,click};
};
