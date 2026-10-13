// SPDX-License-Identifier: MIT
import {SCHEMA,clone,same,need,identity,sourceOriginal,newCopy,checkpoint,compareEdition,applyComparison,
 completeSelection,validateCopy,validateArchive,archive,mergeCopies,openStore,refKey} from './operations_gravitee_model.mjs';
import {staffDeskStorageKey} from './staff-session.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=v=>JSON.stringify(v,null,2);
const at=()=>new Date().toISOString();
function download(value,name,type='application/json'){
 const url=URL.createObjectURL(value instanceof Blob?value:new Blob([value],{type}));
 const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
const button=(name,action,attrs='')=>'<button type="button" data-gv-action="'+action+'" '+attrs+'>'+esc(name)+'</button>';
const field=(name,key,value,type='text')=>'<label>'+esc(name)+(type==='area'?'<textarea rows="3" data-gv-field="'+key+'">'+esc(value)+'</textarea>':'<input type="'+type+'" data-gv-field="'+key+'" value="'+esc(value)+'">')+'</label>';
const select=(name,key,value,rows)=>'<label>'+esc(name)+'<select data-gv-field="'+key+'">'+rows.map(([id,label])=>'<option value="'+esc(id)+'"'+(id===value?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label>';
const table=(heads,rows)=>'<div class="gv-table"><table><thead><tr>'+heads.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
function base64(text){const bytes=new TextEncoder().encode(text);let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
export function mountGraviteeSourceDesk(root,host){
 const scope=clone(host.context()),prefix='/api/operations/'+scope.caseId;
 root.className='gravitee-source-desk';root.hidden=true;root.setAttribute('aria-label','Gravitee source and Installation preparation');
 if(!document.querySelector('link[data-gravitee-desk]')){const l=document.createElement('link');l.rel='stylesheet';l.href='/operations_gravitee.css';l.dataset.graviteeDesk='true';document.head.append(l);}
 let alive=true,opened=false,busy=false,hostBusy=false,store=null,state={revision:0,copies:[],selected:null},conflict=false;
 let error='',notice='',sourceId='',name='',filter='',memberPath='',pageText='',pageNext=null,pageOffset=0,pageFile=null,view='cohort';
 let sourceVerified=false,readGeneration=0,saveTimer=null,saveChain=Promise.resolve(),dirty=false,editVersion=0,importFork=false;
 const current=()=>state.copies.find(x=>x.id===state.selected)||null;
 const $=s=>root.querySelector(s);
 const sourceRows=()=>host.caseData().sources;
 const reason=()=>host.readOnlyReason?.()||'';
 const textSource=id=>sourceRows().find(x=>x.id===id);
 function recordState(){return {copies:state.copies,selected:state.selected};}
 async function persist(){
  if(!store)throw new Error('Open browser storage before changing the complete working copy.');
  if(conflict)throw new Error('Download your full current work and resolve the other tab before saving.');
  const snapshot=clone(recordState()),generation=editVersion;
  saveChain=saveChain.catch(()=>{}).then(async()=>{
   try{const saved=await store.write(state.revision,snapshot);state.revision=saved.revision;dirty=editVersion!==generation;}
   catch(e){if(e.code==='GRAVITEE_COPY_CONFLICT')conflict=true;dirty=true;throw e;}
  });return saveChain;
 }
 function changed(){
  dirty=true;++editVersion;clearTimeout(saveTimer);saveTimer=setTimeout(()=>{persist().catch(e=>{error=e.message;render();});},350);
 }
 function capture(){
  const c=current();if(!c)return;
  if($('[data-gv-field="copyName"]'))c.name=$('[data-gv-field="copyName"]').value;
  if($('[data-gv-field="notes"]'))c.notes=$('[data-gv-field="notes"]').value;
  for(const el of root.querySelectorAll('[data-gv-row]')){
   const row=c.selection.cohort[Number(el.dataset.gvRow)],key=el.dataset.gvKey;
   if(row)row[key]=el.type==='checkbox'?el.checked:el.value;
  }
  if(c.bindings)for(const el of root.querySelectorAll('[data-gv-binding]')){
   const [section,key]=el.dataset.gvBinding.split('.');c.bindings[section][key]=el.value;
  }
  if(dirty)c.updatedAt=at();
 }
 function replace(next){const i=state.copies.findIndex(x=>x.id===next.id);need(i>=0,'Keep the original working-copy identity.');state.copies[i]=next;}
 function controls(){
  root.setAttribute('aria-busy',String(busy||hostBusy));
  for(const el of root.querySelectorAll('button,input,select,textarea')){
   const read=el.dataset.gvAction&&['download','close','source-download','selection-download','copy-open','view','member','page','history-open','member-download','download-conflict'].includes(el.dataset.gvAction);
   el.disabled=busy||hostBusy||(conflict&&!['close','download','download-conflict','store-reload','conflict-fork'].includes(el.dataset.gvAction))||(!read&&!!reason())||(!!current()?.pending&&!read&&!['recover','download','store-reload'].includes(el.dataset.gvAction));
  }
 }
 function render(){
  if(!alive||!opened)return;
  const c=current(),context=host.context(),sources=[['','Select complete attached source'],...sourceRows().map(x=>[x.id,x.filename+' · '+x.sha256.slice(0,12)])];
  const list=state.copies.map(x=>button(x.name||'Untitled','copy-open','data-id="'+esc(x.id)+'"')).join('');
  let body='<p>Choose a source-bearing Gravitee handover attached to this Operations case. Original source, commercial terms and native save remain together.</p>';
  if(c){
   const matching=c.source.report.cohort.map((r,i)=>({r,i})).filter(({r})=>(r.label+' '+refKey(r.reference)+' '+r.apiId+' '+r.state).toLowerCase().includes(filter.toLowerCase()));
   body='<div class="gv-fields">'+field('Working-copy name','copyName',c.name)+field('Review notes','notes',c.notes,'area')+'</div>'+
    '<p>Workspace <code>'+esc(c.selection.workspaceId)+'</code> · '+c.source.metadata.bytes+' original bytes · <code>'+esc(c.source.metadata.sha256)+'</code></p>'+
    '<p>'+esc(sourceVerified?'Complete source re-read through the original native reader.':'Retained working copy. Verify the attached original source before preparing it.')+'</p>'+
    '<div class="gv-actions">'+button('Verify original source','verify')+button('Save complete checkpoint','checkpoint')+button('Fork complete copy','fork')+button('Download original handover','source-download')+button('Download selected cohort','selection-download')+button('Download all working copies','download')+'</div>'+
    '<nav class="gv-actions">'+['cohort','source','compare','prepare','history'].map(x=>button(x==='cohort'?'API cohort':x==='source'?'Complete source':x==='compare'?'Later handover':x==='prepare'?'Prepare Installation':'Saved history','view','data-view="'+x+'"')).join('')+'</nav>';
   if(view==='cohort')body+=field('Find API, record or state','filter',filter,'search')+
    table(['Original record and source','Observed native state','Included','Environment role','Purpose or exclusion reason'],matching.map(({r,i})=>{
     const d=c.selection.cohort[i];
     return ['<strong>'+esc(r.label||r.reference.kind)+'</strong><br><code>'+esc(refKey(r.reference))+'</code><br>edition '+r.reference.revision+'<br>'+button('Read full record','member','data-path="workspace/records/'+r.reference.kind+'/'+r.reference.id+'/'+String(r.reference.revision).padStart(8,'0')+'.json"'),
      esc(r.state)+'<br>API '+esc(r.apiId??'Unassigned')+'<br>Deployment '+esc(r.deploymentState??'Unobserved'),
      '<input type="checkbox" aria-label="Include '+esc(r.label||refKey(r.reference))+'" data-gv-row="'+i+'" data-gv-key="included"'+(d.included?' checked':'')+'>',
      '<select aria-label="Environment for '+esc(r.label||refKey(r.reference))+'" data-gv-row="'+i+'" data-gv-key="stage">'+['unassigned','staging','production','other'].map(s=>'<option'+(s===d.stage?' selected':'')+'>'+s+'</option>').join('')+'</select>',
      '<textarea rows="3" maxlength="4000" aria-label="Purpose for '+esc(r.label||refKey(r.reference))+'" data-gv-row="'+i+'" data-gv-key="purpose">'+esc(d.purpose)+'</textarea>'];
    }));
   if(view==='source')body+='<p>Every original package member is retained. Text paging uses Unicode characters; downloads retain original bytes.</p>'+
    select('Complete original member','memberPath',memberPath,[['','Select source member'],...c.source.report.members.map(x=>[x.path,x.path+' · '+x.bytes+' B'])])+
    '<div class="gv-actions">'+button('Read member','member-open')+button('Download complete member','member-download')+'</div>'+
    (pageFile?'<p><code>'+esc(pageFile.path)+'</code> · '+pageFile.bytes+' B · '+esc(pageFile.sha256)+'</p>':'')+
    '<pre class="gv-source">'+esc(pageText)+'</pre>'+ (pageNext!==null?button('Read next complete page','page'):'');
   if(view==='compare'){
    const cmp=c.comparison;
    body+=select('Later complete attached handover','sourceId',sourceId,sources)+button('Compare full later edition','compare')+
     (cmp?'<p>Incoming source <code>'+esc(cmp.source.metadata.sha256)+'</code>. Every changed/added/removed record needs an explicit choice. The earlier full copy is retained in history.</p>'+
      table(['Record','Source movement','Earlier decision','Carry-forward choice'],cmp.rows.map((r,i)=>[
       esc(r.key),esc(r.state)+'<br>'+esc(r.before?.reference.sha256??'Absent')+'<br>→ '+esc(r.after?.reference.sha256??'Absent'),
       r.decision?esc((r.decision.included?'Included':'Excluded')+' · '+r.decision.stage+' · '+r.decision.purpose):'New record',
       '<select data-gv-choice="'+i+'" aria-label="Choice for '+esc(r.key)+'">'+[['','Select explicit choice'],...(r.state==='REMOVED'?[['ACK_REMOVED','Acknowledge removed source']]:r.state==='ADDED'?[['RESET','Prepare new decision']]:r.state==='UNCHANGED'?[['KEEP','Keep unchanged decision']]:[['KEEP','Carry previous decision to this changed record'],['RESET','Prepare new decision']])].map(([v,l])=>'<option value="'+v+'"'+(r.choice===v?' selected':'')+'>'+esc(l)+'</option>').join('')+'</select>']))+
      '<details><summary>Complete original member comparison ('+cmp.members.length+')</summary>'+table(['Member','Movement','Before / after bytes'],cmp.members.map(m=>[esc(m.path),esc(m.state),esc(m.before?.bytes??'Absent')+' / '+esc(m.after?.bytes??'Absent')]))+'</details>'+
      button('Apply all reviewed source choices','compare-apply'):'');
   }
   if(view==='prepare'){
    body+='<p>First receive the complete commercial Workshare in the original Installation editor. This prepares a new planned Installation; operated checks stay in their saved original edition.</p>'+
      button('Receive complete current Workshare draft','template')+
      (c.bindings?'<div class="gv-fields">'+[['source.reference','Actual source edition / reference'],['source.authority','Source-use authority'],['receiving.host','Receiving host'],['receiving.operator','Receiving engineer']].map(([k,l])=>{const [s,f]=k.split('.');return '<label>'+esc(l)+'<textarea rows="2" data-gv-binding="'+k+'" maxlength="4000">'+esc(c.bindings[s][f])+'</textarea></label>';}).join('')+'</div>'+
      '<details><summary>Complete preserved commercial document and technical bindings</summary><pre>'+esc(json({document:c.document,bindings:c.bindings}))+'</pre></details>'+
      '<div class="gv-actions">'+button('Attach exact reviewed cohort','attach')+button('Prepare complete native Installation','prepare')+'</div>':'')+
      (c.cohortAttachment?'<p>Original cohort source <code>'+esc(c.cohortAttachment.id)+'</code> · '+esc(c.cohortAttachment.sha256)+'</p>':'')+
      (c.prepared?'<h4>Complete preparation</h4><p>Case version '+c.prepared.scope.version+'. Review the full original fields and remaining selections below.</p><pre>'+esc(json(c.prepared.result.prepared))+'</pre>'+
        '<details><summary>Whole source cohort and original native preview</summary><pre>'+esc(json({snapshot:c.prepared.result.snapshot,preview:c.prepared.result.nativePreview}))+'</pre></details>'+
        button('Open complete prepared Installation draft','receive')+button('Download complete preparation','prepared-download'):'');
   }
   if(view==='history')body+=table(['Saved checkpoint','Time','Full edition'],c.history.map((h,i)=>[esc(h.label),esc(h.at),button('Open as complete separate copy','history-open','data-index="'+i+'"')+'<br><code>'+esc(h.sha256)+'</code>']));
  }
  root.innerHTML='<header><div><h3>Gravitee source and Installation</h3><p>Original case '+esc(scope.caseId)+' · current version '+context.version+'</p></div>'+button('Close source desk','close')+'</header>'+
   '<p role="'+(error?'alert':'status')+'" class="gv-status">'+esc(error||notice)+'</p>'+
   (dirty?'<p>Current changes are awaiting a complete browser save.</p>':'')+
   (conflict?'<section class="gv-warning"><h4>Another tab changed these working copies</h4><p>Your entire current work is still on this page. Download it before opening the other tab’s saved store, or keep it as a separate fork.</p>'+button('Download full current alternatives','download-conflict')+button('Reload saved store after preserving current work','store-reload')+button('Preserve current work as a new fork','conflict-fork')+'</section>':'')+
   (c?.pending?'<section class="gv-warning"><h4>Original source attachment request retained</h4><code>'+esc(c.pending.body.requestId)+'</code><p>Recover this exact original request. A different edit does not replace it.</p>'+button('Recover original attachment','recover')+'</section>':'')+
   '<div class="gv-layout"><aside><h4>Complete working copies</h4>'+list+'<h4>New original source</h4>'+select('Attached full handover','sourceId',sourceId,sources)+field('New copy name','name',name)+button('Inspect and open complete source','new')+button('Receive complete working-copy archive','import')+button('Receive conflicting copies as alternatives','import-fork')+'<input type="file" data-gv-import hidden accept=".json,application/json"></aside><main>'+body+'</main></div>';
  controls();
 }
 async function run(fn){
  if(!alive||busy||hostBusy)return;busy=true;error='';controls();
  try{clearTimeout(saveTimer);capture();await saveChain.catch(()=>{});await fn();}
  catch(e){error=e.message||String(e);}
  finally{busy=false;render();}
 }
 async function request(action,c,extra={}){
  const context=host.context();
  const result=await host.api(prefix+'/gravitee/'+action,{expectedVersion:context.version,sourceId:c.source.metadata.id,expectedSourceSha256:c.source.metadata.sha256,...extra});
  need(result.scope.caseId===scope.caseId&&result.scope.version===context.version&&result.source.sha256===c.source.metadata.sha256,'The original case/source response changed identity.');
  return result;
 }
 async function readSource(id){
  await host.refreshCase();const m=textSource(id);need(m,'Select an original handover attached to this case.');
  const original=await host.api(prefix+'/sources/'+id,undefined,{download:true}),raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await original.arrayBuffer());
  const probe={source:{metadata:m}},result=await request('inspect',probe);
  return sourceOriginal(m,raw,result.result);
 }
 async function verify(){
  const c=current();need(c,'Open a complete working copy first.');const actual=await readSource(c.source.metadata.id);
  need(actual.metadata.sha256===c.source.metadata.sha256&&actual.raw===c.source.raw&&same(actual.report,c.source.report),'The retained working source/report differs from the actual original case. Keep this file and reopen the original source.');
  sourceVerified=true;
 }
 async function readMember(path,offset=0){
  const c=current();need(c,'Open a complete source.');await verify();const result=await request('member',c,{path,offset,limit:16000});
  memberPath=path;pageFile=result.result.file;pageOffset=offset;
  if(result.result.encoding==='utf8'){pageText=result.result.text;pageNext=result.result.nextOffset;}
  else {pageText='This is a complete binary member. Download it from its original retained bytes.';pageNext=null;}
  view='source';
 }
 async function recover(){
  const c=current(),p=c?.pending;need(c,'Open the original complete working copy.');validateCopy(c);need(p,'Select the retained original attachment request.');
  let result;
  try{result=await host.saveApi(prefix+'/command',p.body);}
  catch(e){
   if([400,409,413,415,422].includes(e.status)&&typeof e.code==='string'){
    c.rejected={body:clone(p.body),error:{code:e.code,message:e.message},at:at()};c.pending=null;await persist();
   }throw e;
  }
  c.pending=null;c.attachedReceipt={body:clone(p.body),result:clone(result)};await persist();
  await host.refreshCase();const meta=textSource(result.recordId);
  need(meta&&meta.sha256===p.identity.sha256&&meta.bytes===p.identity.bytes,'Recover the original complete cohort source receipt from this case.');
  c.cohortAttachment=clone(meta);c.prepared=null;await persist();notice='The exact selected cohort is retained in the original case.';
 }
 async function attach(){
  const c=current();need(c?.bindings,'Receive the original commercial draft first.');await verify();const raw=completeSelection(c),id=identity(raw);
  await host.refreshCase();const existing=sourceRows().find(m=>m.sha256===id.sha256&&m.bytes===id.bytes);
  if(existing){c.cohortAttachment=clone(existing);c.prepared=null;await persist();notice='Reused this exact original cohort attachment.';return;}
  const body={requestId:crypto.randomUUID(),expectedVersion:host.context().version,actor:host.recordingActor(),
   action:'source.add',note:'Retain complete reviewed Gravitee API cohort',data:{filename:'Gravitee_Selected_Cohort.json',mediaType:'application/json',kind:'deployment',contentBase64:base64(raw),observedAt:at()}};
  c.pending={body,identity:id,raw};await persist();await recover();
 }
 async function template(){
  const c=current();need(c,'Open the complete original API source.');await verify();const target=host.currentDraft();
  need(target&&!target.installationId&&target.expectedRevision===0&&target.document.workshare,'Receive a new complete commercial Workshare draft in the original Installation editor first.');
  const result=await request('template',c,{document:target.document});
  c.document=clone(target.document);c.bindings=result.result.bindings;c.prepared=null;await persist();notice='Original commercial terms, checks and funded assignment retained in full.';
 }
 async function prepare(){
  const c=current();need(c?.document&&c.bindings&&c.cohortAttachment,'Receive the Workshare and attach the exact complete cohort first.');await verify();
  const raw=completeSelection(c),id=identity(raw);need(id.sha256===c.cohortAttachment.sha256,'The decisions changed after attachment. Retain the new exact cohort first.');
  const fresh=await request('template',c,{document:c.document});
  // Only the original case selection advances after attachment; every authored binding stays.
  const bindings={...clone(c.bindings),selection:fresh.result.bindings.selection};
  const result=await request('prepare',c,{document:c.document,bindings,cohortSourceId:c.cohortAttachment.id,expectedCohortSha256:id.sha256});
  c.bindings=bindings;c.prepared=result;await persist();notice='The complete native Installation preview is retained. Open it in the original editor to review and save.';
 }
 root.addEventListener('input',e=>{
  if(e.target.matches('[data-gv-field="filter"]')){filter=e.target.value;return;}
  if(e.target.matches('[data-gv-field="sourceId"]'))sourceId=e.target.value;
  if(e.target.matches('[data-gv-field="name"]'))name=e.target.value;
  if(e.target.matches('[data-gv-row],[data-gv-binding],[data-gv-field="copyName"],[data-gv-field="notes"]')){
   const c=current();capture();if(c){c.prepared=null;if(e.target.matches('[data-gv-row]'))c.comparison=null;}changed();
  }
 });
 root.addEventListener('change',e=>{
  if(e.target.matches('[data-gv-field="filter"]')){filter=e.target.value;render();}
  if(e.target.matches('[data-gv-field="sourceId"]'))sourceId=e.target.value;
  if(e.target.matches('[data-gv-field="memberPath"]'))memberPath=e.target.value;
  if(e.target.matches('[data-gv-choice]')){current().comparison.rows[Number(e.target.dataset.gvChoice)].choice=e.target.value;changed();}
  if(e.target.matches('[data-gv-import]')&&e.target.files[0])run(async()=>{
   need(e.target.files[0].size<=64*1024*1024,'Receive the complete working-copy archive within 64 MiB.');
   const incoming=validateArchive(await e.target.files[0].text());
   for(const c of incoming.copies)need(c.scope.caseId===scope.caseId&&c.scope.planId===scope.planId,'These original working copies belong to another case. Open their original complete Operations case before editing.');
   state.copies=mergeCopies(state.copies,incoming.copies,{forkConflict:importFork});await persist();notice='Received every complete source, draft, history and original request.';sourceVerified=false;
  });
 });
 root.addEventListener('click',e=>{
  const target=e.target.closest('[data-gv-action]');if(!target||target.disabled)return;
  const action=target.dataset.gvAction;
  if(action==='import'||action==='import-fork'){importFork=action==='import-fork';$('[data-gv-import]').value='';$('[data-gv-import]').click();return;}
  run(async()=>{
   const c=current();
   if(action==='close'){if(!conflict&&dirty)await persist();root.hidden=true;opened=false;host.close?.();return;}
   if(action==='download'||action==='download-conflict'){download(archive(state.copies,state.selected),'Gravitee_Complete_Working_Copies.json');notice='Complete working copies downloaded.';return;}
   if(action==='store-reload'){need(conflict,'The saved store is already current.');download(archive(state.copies,state.selected),'Gravitee_Unmerged_Working_Copies.json');state=await store.read();conflict=false;dirty=false;sourceVerified=false;return;}
   if(action==='conflict-fork'){
    const alternatives=clone(state.copies),saved=await store.read();
    state=saved;conflict=false;
    for(const old of alternatives){const original=state.copies.find(x=>x.id===old.id);if(original&&same(original,old))continue;old.id=crypto.randomUUID();old.name+=' · recovered tab';state.copies.push(old);}
    await persist();notice='Preserved all current-tab alternatives as distinct complete copies.';return;
   }
   if(action==='new'){
    const s=await readSource(sourceId),copy=newCopy({id:crypto.randomUUID(),name:name||s.metadata.filename,scope,source:s,at:at()});
    state.copies.push(copy);state.selected=copy.id;sourceVerified=true;view='cohort';await persist();return;
   }
   if(action==='copy-open'){if(dirty&&!conflict)await persist();state.selected=target.dataset.id;sourceVerified=false;pageText='';pageNext=null;view='cohort';await persist();return;}
   if(action==='verify'){await verify();notice='The complete original handover and every native cohort record were verified.';return;}
   if(action==='view'){view=target.dataset.view;if(dirty&&!conflict)await persist();return;}
   if(action==='checkpoint'){replace(checkpoint(c,'Named source review',at()));await persist();notice='Complete source, decisions and unfinished fields checkpointed.';return;}
   if(action==='fork'){const next=checkpoint(c,'Original complete fork basis',at());next.id=crypto.randomUUID();next.name+=' · fork';state.copies.push(next);state.selected=next.id;await persist();return;}
   if(action==='source-download'){download(c.source.raw,c.source.metadata.filename);return;}
   if(action==='selection-download'){download(json(c.selection)+'\n','Gravitee_Selected_Cohort.json');return;}
   if(action==='member'||action==='member-open'){return readMember(target.dataset.path||memberPath);}
   if(action==='page'){need(pageNext!==null,'The whole member has been read.');return readMember(memberPath,pageNext);}
   if(action==='member-download'){
    await verify();need(memberPath,'Select the original member.');const file=JSON.parse(c.source.raw.replace(/^\uFEFF/,'')).files.find(x=>x.path===memberPath);need(file,'The member is absent.');
    const bytes=Uint8Array.from(atob(file.base64),x=>x.charCodeAt(0));download(new Blob([bytes]),file.path.split('/').at(-1),'application/octet-stream');return;
   }
   if(action==='compare'){const next=await readSource(sourceId);c.comparison=compareEdition(c,next);await persist();return;}
   if(action==='compare-apply'){replace(applyComparison(c,at()));sourceVerified=true;await persist();view='cohort';return;}
   if(action==='history-open'){const saved=c.history[Number(target.dataset.index)];need(saved,'Select a retained whole checkpoint.');const next=clone(saved.snapshot);next.history=[];next.id=crypto.randomUUID();next.name+=' · restored '+(Number(target.dataset.index)+1);state.copies.push(next);state.selected=next.id;sourceVerified=false;await persist();view='cohort';return;}
   if(action==='template')return template();
   if(action==='attach')return attach();
   if(action==='recover')return recover();
   if(action==='prepare')return prepare();
   if(action==='prepared-download'){need(c.prepared,'Prepare the original Installation first.');download(json(c.prepared)+'\n','Gravitee_Complete_Installation_Preparation.json');return;}
   if(action==='receive'){
    await prepare();need(c.prepared,'Prepare the complete original Installation first.');await host.refreshCase();
    need(c.prepared.scope.version===host.context().version,'The original case changed. Prepare the selected cohort against its fresh source.');
    const result=await host.receiveDraft(c.prepared);
    need(result.applied,result.message||'Retain this full preparation and reopen the original Installation editor.');
    c.lastReceived={at:at(),draftKey:result.draftKey,preparation:clone(c.prepared)};await persist();notice='The complete prepared Installation is open in its original review/save editor.';return;
   }
  });
 });
 const ready=(async()=>{store=await openStore(staffDeskStorageKey('sf47.gravitee.'+scope.caseId+'.'+scope.planId+'.'+scope.createdAt));state=await store.read();archive(state.copies,state.selected);})();
 return {ready,async open(){await ready;opened=true;root.hidden=false;render();root.scrollIntoView({block:'start'});},
 setHostBusy(value){hostBusy=!!value;controls();},refresh(){if(opened&&!busy)render();},
 async flush(){capture();clearTimeout(saveTimer);if(dirty)await persist();},
 dispose(){capture();clearTimeout(saveTimer);if(dirty&&!conflict)persist().catch(()=>{});alive=false;++readGeneration;saveChain.finally(()=>store?.close());}};
}
