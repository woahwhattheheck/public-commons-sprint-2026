// Original SF74 observations, explicit SF47 links and frozen implementation reviews.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>structuredClone(value);
const label=value=>String(value??'').replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const json=value=>JSON.stringify(value,null,2);
const keyFor=id=>'sf47.implementation-evidence.'+id;
const empty=value=>'<p class="impl-empty">'+esc(value)+'</p>';
const note=value=>'<p class="impl-note">'+esc(value)+'</p>';
const pill=(value,tone='')=>'<span class="impl-pill '+tone+'">'+esc(value)+'</span>';
const button=(title,action,attrs='',disabled=false)=>'<button type="button" data-impl-action="'+action+'" '+attrs+(disabled?' disabled data-impl-fixed="true"':'')+'>'+esc(title)+'</button>';
const details=(title,value)=>'<details><summary>'+esc(title)+'</summary><pre>'+esc(json(value))+'</pre></details>';
const table=(heads,rows)=>'<div class="impl-table"><table><thead><tr>'+heads.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const kinds={task:'tasks',receiving:'receiving',measurement:'measurements'};
const linkKinds={deploymentIds:'deployments',workIds:'work',purchaseIds:'purchases',outcomeIds:'outcomes'};
const fmt=value=>value===null||value===undefined?'Not recorded':String(value);
function field(title,name,value='',options={}){
  const attrs=' name="'+esc(name)+'"'+(options.required?' required':'')+(options.attrs?' '+options.attrs:'');
  let input;
  if(options.options)input='<select'+attrs+(options.multiple?' multiple size="'+(options.size||5)+'"':'')+'>'+options.options.map(([id,title])=>'<option value="'+esc(id)+'"'+((options.multiple?(value||[]).includes(id):String(value??'')===String(id))?' selected':'')+'>'+esc(title)+'</option>').join('')+'</select>';
  else if(options.area)input='<textarea'+attrs+' rows="'+(options.rows||3)+'">'+esc(value??'')+'</textarea>';
  else input='<input'+attrs+' type="'+(options.type||'text')+'" value="'+esc(value)+'">';
  return '<label class="'+(options.wide?'impl-wide':'')+'">'+esc(title)+input+(options.help?'<small>'+esc(options.help)+'</small>':'')+'</label>';
}
function download(value,name,type='application/json'){
  const blob=value instanceof Blob?value:new Blob([typeof value==='string'?value:json(value)+'\n'],{type});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
const definitive=error=>[400,401,403,404,409,413,422].includes(error?.status)&&typeof error?.code==='string';

export function mountImplementationEvidence({container,current,saveApi,session,mutationId,recordingActor,onCase,onSources}){
  const root=document.createElement('section');root.className='implementation-evidence-desk';root.setAttribute('aria-label','Implementation evidence');container.replaceChildren(root);
  if(!document.querySelector('link[data-implementation-style]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='/operations_implementation.css';link.dataset.implementationStyle='true';document.head.append(link);
  }
  if(!session.loaded){
    try{const saved=JSON.parse(sessionStorage.getItem(keyFor(current.program.id))||'null');if(saved?.schema==='sf47.implementation-session.v1')Object.assign(session,saved);}catch{}
    session.loaded=true;
  }
  for(const [key,value] of Object.entries({sourceId:'',tab:'source',drafts:{},nativeBySource:{},page:0,filter:'',kind:'task',preview:null,review:null,reviewId:'',dialog:null,linkDrafts:{},pending:null,accepted:null,inflight:null,error:'',notice:''})){
    if(!Object.hasOwn(session,key))session[key]=value;
  }
  let active=true,busy=false,hostBusy=false,caseValue=current;
  const prefix='/api/operations/'+encodeURIComponent(current.program.id);
  const available=()=>active&&root.isConnected;
  const $=selector=>root.querySelector(selector);
  const draft=()=>session.drafts[session.sourceId];
  const inputs=()=>draft()?.inputs;
  const native=()=>session.nativeBySource[session.sourceId]||null;
  const mutable=()=>caseValue.program.state==='OPEN'&&!busy&&!hostBusy&&!session.pending&&!session.accepted&&!session.inflight;
  const source=()=>caseValue.sources.find(row=>row.id===session.sourceId);
  const recordName=(kind,id)=>{const row=caseValue.records[kind]?.find(x=>x.id===id);return row?.name||row?.title||row?.label||id;};
  const sourceUrl=id=>prefix+'/sources/'+encodeURIComponent(id);
  const blobUrl=sha=>prefix+'/implementation-originals/'+encodeURIComponent(session.sourceId)+'/'+sha;
  const originalRef=sha=>inputs()?.originalFileRefs?.find(row=>row.sha256===sha);
  function originalLink(sha,name='original-file'){
    if(native()?.files.some(file=>file.sha256===sha))return '<a href="'+blobUrl(sha)+'" download="'+esc(name)+'">Download exact original</a>';
    const linked=originalRef(sha),source=linked&&caseValue.sources.find(row=>row.id===linked.sourceId&&row.sha256===sha);
    if(source)return '<a href="'+sourceUrl(source.id)+'" download="'+esc(name)+'">Download retained original</a>';
    const edition=native()?.state.editions.find(row=>row.sourceBundle&&row.inputs.supportText===sha);
    if(edition){
      const original=native().externalFiles.find(file=>file.sourceFile?.manifestSha256===edition.sourceBundle.manifestSha256&&file.sourceFile.path==='originals/support.json');
      const ref=original&&originalRef(original.sha256),carrier=ref&&caseValue.sources.find(row=>row.id===ref.sourceId&&row.sha256===original.sha256);
      if(carrier)return '<a href="'+sourceUrl(carrier.id)+'" download>Download containing original Support handoff</a><small>The selected runtime retains its separate SHA-256.</small>';
    }
    return '<span class="impl-note">Original source-bundle file is not bound. Use Original files to select its exact retained source.</span>';
  }
  const selections=()=>inputs()?.selections||[];
  const selected=(kind,id)=>selections().find(row=>row.kind===kind&&row.id===id);
  const nativeRow=(kind,id)=>native()?.state[kinds[kind]]?.find(row=>row.id===id);
  function persist(critical=false){
    const saved={schema:'sf47.implementation-session.v1',sourceId:session.sourceId,tab:session.tab,drafts:session.drafts,page:session.page,filter:session.filter,kind:session.kind,reviewId:session.reviewId,dialog:session.dialog,linkDrafts:session.linkDrafts,pending:session.pending,accepted:session.accepted};
    try{
      const raw=JSON.stringify(saved);if(raw.length>2000000)throw new Error('The entered review exceeds the 2 MB browser draft bound.');
      sessionStorage.setItem(keyFor(current.program.id),raw);
    }catch(error){
      if(critical)throw new Error('The browser could not retain the exact original request before dispatch. Export the draft or free this site’s session storage, then continue. '+error.message);
      session.storageWarning='The current browser draft could not be retained across a reload. Export it before closing.';
    }
  }
  function controls(){
    if(!available())return;
    root.setAttribute('aria-busy',String(busy||hostBusy||!!session.inflight));
    for(const el of root.querySelectorAll('button,input,select,textarea')){
      el.disabled=el.dataset.implFixed==='true'||busy||hostBusy||!!session.inflight||
        (!!(session.pending||session.accepted)&&el.dataset.implRecovery!=='true')||
        (el.dataset.implWrite==='true'&&caseValue.program.state!=='OPEN');
    }
  }
  function changed({cutoff=false}={}){
    if(draft())draft().dirty=true;
    if(cutoff)delete session.nativeBySource[session.sourceId];
    session.preview=null;session.error='';persist();
  }
  async function run(fn){
    if(!available()||busy||hostBusy||session.inflight)return;
    busy=true;session.error='';controls();
    try{return await fn();}catch(error){session.error=error.message||String(error);}
    finally{busy=false;persist();if(available())render();}
  }
  async function refresh(adopt=false){
    const next=await saveApi(prefix);
    if(next.program.id!==current.program.id)throw new Error('The returned Operations case changed identity.');
    caseValue=next;
    if(adopt&&draft())draft().baseVersion=next.program.version;
    if(session.preview?.source.version!==next.program.version)session.preview=null;
    return next;
  }
  async function readSource({adopt=false}={}){
    const original=source();if(!original)throw new Error('Select an original source attached to this case.');
    const old=draft(),cutoff=old?.inputs.asOfAt||new Date().toISOString();
    const result=await saveApi(prefix+'/implementation-source',{expectedVersion:caseValue.program.version,sourceId:original.id,asOfAt:cutoff});
    if(result.caseId!==caseValue.program.id||result.version!==caseValue.program.version||result.source.id!==original.id||result.source.sha256!==original.sha256||result.native.source.sha256!==original.sha256||result.native.asOfAt!==cutoff)
      throw new Error('The original source read no longer matches the selected case, hash or cutoff.');
    if(old&&old.inputs.sourceSha256!==original.sha256)throw new Error('The draft names another source hash. Keep it exported and explicitly select its original source.');
    session.nativeBySource[original.id]=result.native;
    if(!old)session.drafts[original.id]={inputs:result.inputs,baseVersion:result.version,dirty:false};
    else if(adopt)old.baseVersion=result.version;
    session.preview=null;session.notice='Read the complete original implementation and its producer calculations. Original source bytes remain attached.';
    persist();
  }
  async function showReview(id){
    const value=await saveApi(prefix+'/reviews/'+encodeURIComponent(id));
    if(value.purpose!=='IMPLEMENTATION_EVIDENCE')throw new Error('Select an original implementation evidence review.');
    session.review=value;session.reviewId=value.id;session.tab='reviews';session.dialog=null;persist();
  }
  async function finishAccepted(){
    if(!session.accepted)return;
    const accepted=session.accepted,result=accepted.result,next=await refresh();
    if(result.id!==next.program.id||next.program.version<result.version)throw new Error('The original saved review has not appeared in the case readback yet.');
    const review=await saveApi(prefix+'/reviews/'+encodeURIComponent(result.recordId));
    if(review.purpose!=='IMPLEMENTATION_EVIDENCE'||review.implementation.previewSha256!==accepted.payload.data.expectedPreviewSha256)
      throw new Error('The returned review differs from the original frozen request.');
    session.review=review;session.reviewId=review.id;session.tab='reviews';session.accepted=null;session.preview=null;
    const d=session.drafts[review.implementation.inputs.sourceId];if(d){d.baseVersion=next.program.version;d.dirty=false;}
    session.notice='Frozen the selected original observations and read back the exact review. Separate receiving and business decisions retain their original states.';
    persist(true);if(available())await onCase(next,result);
  }
  async function sendPending(){
    const pending=session.pending;if(!pending)return;persist(true);
    if(session.inflight){await session.inflight;return;}
    const work=(async()=>{
      try{
        const result=await saveApi(prefix+'/command',pending.payload);
        session.accepted={payload:pending.payload,result};session.pending=null;persist(true);return result;
      }catch(error){
        if(definitive(error)){session.pending=null;session.rejected={payload:pending.payload,code:error.code};session.notice='The original request was rejected. Your draft and selected source remain available.';persist();}
        throw error;
      }
    })();
    session.inflight=work;controls();
    try{await work;}finally{if(session.inflight===work)session.inflight=null;}
    await finishAccepted();
  }
  async function preview(){
    if(!draft()||!native())throw new Error('Read the selected original source and cutoff first.');
    const result=await saveApi(prefix+'/implementation-preview',{expectedVersion:draft().baseVersion,inputs:clone(inputs())});
    if(result.source.programId!==caseValue.program.id||result.source.version!==draft().baseVersion||result.inputs.sourceSha256!==inputs().sourceSha256)
      throw new Error('The preview does not match the selected original case and source.');
    session.preview=result;session.tab='preview';session.dialog=null;
  }
  async function freeze(){
    if(hostBusy||session.pending||session.accepted||session.inflight||caseValue.program.state!=='OPEN'||!session.preview||!inputs()?.selections.length)return;
    if(session.preview.source.version!==draft().baseVersion)throw new Error('Preview the current entered selection before freezing.');
    const payload={expectedVersion:draft().baseVersion,actor:recordingActor(),action:'implementation.prepare',note:inputs().note||inputs().name,data:{inputs:clone(inputs()),expectedPreviewSha256:session.preview.previewSha256}};
    payload.requestId=await mutationId('operations:implementation.prepare',payload);
    session.pending={payload};persist(true);await sendPending();
  }
  function inputRefs(){
    return (caseValue.installations||[]).map(row=>[row.id+'@'+row.revision,(row.name||row.title||row.id)+' · revision '+row.revision]);
  }
  function installationRef(key){
    const row=(caseValue.installations||[]).find(x=>x.id+'@'+x.revision===key);
    return row?{id:row.id,revision:row.revision,sha256:row.sha256}:null;
  }
  function installationOptions(){
    const choices=inputRefs(),seen=new Set(choices.map(x=>x[0]));
    for(const ref of inputs()?.installationRefs||[]){const key=ref.id+'@'+ref.revision;if(!seen.has(key))choices.push([key,ref.id+' · retained revision '+ref.revision]);}
    return choices;
  }
  function header(){
    const d=draft(),stale=d&&d.baseVersion!==caseValue.program.version;
    return '<header class="impl-header"><div><p class="impl-eyebrow">Original delivery observations · explicit Operations links</p><h2>Implementation evidence</h2><p>'+esc(caseValue.program.name)+' · version '+caseValue.program.version+'</p></div><div class="impl-actions">'+
      button('Attach original source','sources','data-impl-write="true"')+
      button('Refresh case','refresh','data-impl-recovery="true"')+
      button('Export draft','draft-export','data-impl-recovery="true"',!d)+
      button('Import draft','draft-import')+'</div></header>'+
      '<div class="impl-facts">'+pill(label(caseValue.program.mode))+pill(label(caseValue.program.state))+
      (d?pill('Draft source v'+d.baseVersion,stale?'attention':''):'')+
      (d?.dirty?pill('Entered draft retained'):'')+'</div>'+
      (stale?'<aside class="impl-warning"><p>The case has a later version. Your original selections are retained. Adopt the current version after reviewing its records.</p>'+button('Adopt current case version','adopt')+'</aside>':'')+
      (session.notice?'<p class="impl-success" role="status">'+esc(session.notice)+'</p>':'')+
      (session.storageWarning?'<p class="impl-warning">'+esc(session.storageWarning)+'</p>':'')+
      (session.error?'<p class="impl-error" role="alert">'+esc(session.error)+'</p>':'')+
      (session.pending?'<aside class="impl-warning"><h3>Original freeze awaiting its result</h3><p>Request '+esc(session.pending.payload.requestId)+' retains version '+session.pending.payload.expectedVersion+'. Continue this exact request to recover its saved result or finish the original transaction.</p>'+button('Continue original freeze','retry','data-impl-recovery="true"')+details('Exact retained request',session.pending.payload)+'</aside>':'')+
      (session.accepted?'<aside class="impl-warning"><p>The original freeze was accepted; complete its saved-review readback.</p>'+button('Read back accepted review','readback','data-impl-recovery="true"')+'</aside>':'');
  }
  function navigation(){
    return '<nav class="impl-tabs" aria-label="Implementation evidence sections">'+[['source','Source & scope'],['files','Original files'],['task','Tasks'],['receiving','Receiving'],['measurement','Measurements'],['links','Linked evidence'],['preview','Review selection'],['reviews','Frozen reviews']].map(([id,title])=>
      '<button type="button" data-impl-action="tab" data-tab="'+id+'" aria-current="'+(session.tab===id?'page':'false')+'">'+esc(title)+'</button>').join('')+'</nav>';
  }
  function sourcePage(){
    const n=native(),x=inputs();
    return '<section class="impl-panel"><h3>Select the original implementation</h3><div class="impl-fields">'+
      field('Attached original','sourceId',session.sourceId,{options:[['','Select an original source'],...caseValue.sources.map(row=>[row.id,row.filename+' · '+row.bytes+' bytes · '+row.sha256.slice(0,12)])],wide:true})+
      '</div><div class="impl-actions">'+button(n?'Read selected cutoff again':'Read original implementation','read-source','',!session.sourceId)+
      (session.sourceId?'<a href="'+sourceUrl(session.sourceId)+'" download>Download attached original</a>':'')+'</div>'+
      note('Use the complete merchant-commissioning.json, merchant workspace or merchant Support handoff. The existing source intake retains the exact original bytes, up to 8 MiB per source. A runtime-only handoff has no implementation observations.')+
      (source()?details('Original attached source identity',source()):'')+'</section>'+
      (x?'<section class="impl-panel"><h3>Review scope</h3><form data-impl-scope><div class="impl-fields">'+
        field('Review name','name',x.name,{required:true,wide:true})+
        field('Evidence tranche','tranche',x.tranche??'',{options:[['','Unassigned'],[1,'Tranche 1'],[2,'Tranche 2'],[3,'Tranche 3']]})+
        field('Observed and recorded through · UTC','asOfAt',x.asOfAt,{required:true,help:'Canonical UTC including milliseconds. After changing it, read the selected cutoff again. Later corrections remain in the source history.'})+
        field('Selected installation editions','installationRefs',x.installationRefs.map(row=>row.id+'@'+row.revision),{options:installationOptions(),multiple:true,wide:true,help:'Explicit existing Installation references. This review preserves each selected edition; it does not revise its acceptance.'})+
        field('Review basis','note',x.note,{area:true,wide:true})+'</div></form>'+
        '<div class="impl-actions">'+button('Preview selected evidence','preview','',!n||!x.selections.length)+'</div></section>':'')+
      (n?'<section class="impl-panel"><h3>Original producer scope</h3>'+note(n.definitionBasis)+
        table(['Original state','Value'],[['Selected workorder',esc(n.state.activeEditionId||'None')],['Source revision',esc(n.state.revision)],['Workorder editions',esc(n.state.editions.length)],['Tasks',esc(n.state.tasks.length)],['Receiving observations',esc(n.state.receiving.length)],['Measurement observations',esc(n.state.measurements.length)],['Original files',esc(n.files.length)]])+
        '<div class="impl-stat-grid">'+[['Technical accepted tasks',n.summary.technicalAccepted],['Customer accepted tasks',n.summary.accepted],['Tasks marked done',n.summary.done],['Receiving needs update',n.summary.receivingNeedsUpdate]].map(([title,value])=>'<div><span>'+esc(title)+'</span><strong>'+esc(value)+'</strong></div>').join('')+'</div>'+
        note('The two receiving counts are the producer’s current-task calculation at this observation cutoff. Task definitions come from the complete selected source snapshot. They do not establish independent customers, grant acceptance or payment.')+
        details('Original implementation plan',n.state.plan)+details('Producer source and reader identities',{source:n.source,origin:n.origin,reader:n.reader,projectionSha256:n.projectionSha256})+
        '<div class="impl-actions">'+button('Download complete producer report','producer-report')+'</div></section>':'');
  }
  function status(kind,row){
    const n=native();
    if(kind==='task')return [row.retired?'Retired':label(row.status),row.editionId&&row.editionId!==n.state.activeEditionId?'Earlier workorder':''].filter(Boolean).join(' · ');
    const value=(kind==='receiving'?n.receivingStatus:n.measurementStatus).find(x=>x.id===row.id);
    return [value.withinCutoff?'Within cutoff':'After cutoff',value.supersededBy?'Corrected at cutoff':value.currentSupersededBy?'Later correction retained':'',!value.activeEdition?'Earlier workorder':'',kind==='receiving'&&!value.subjectMatches?'Subject changed':''].filter(Boolean).join(' · ');
  }
  function rowTitle(kind,row){
    return kind==='task'?row.title:kind==='receiving'?label(row.kind)+' · '+label(row.outcome):label(row.phase)+' · '+row.taskDefinition;
  }
  function selectButtons(kind,row){
    const linked=selected(kind,row.id),attrs='data-kind="'+kind+'" data-id="'+esc(row.id)+'"';
    return '<div class="impl-actions">'+button('Open original','detail',attrs)+
      (linked?button('Edit '+label(linked.use),'link',attrs):button('Use evidence','select',attrs+' data-use="EVIDENCE"')+button('Keep as context','select',attrs+' data-use="CONTEXT"'))+'</div>';
  }
  function rowsPage(kind){
    const n=native();if(!n)return empty('Read the complete original source and selected cutoff in Source & scope.');
    const all=n.state[kinds[kind]],query=session.filter.trim().toLowerCase();
    const rows=query?all.filter(row=>JSON.stringify(row).toLowerCase().includes(query)):all;
    const pages=Math.max(1,Math.ceil(rows.length/50));session.page=Math.min(session.page,pages-1);
    const shown=rows.slice(session.page*50,(session.page+1)*50);
    const heads=kind==='task'?['Original task','Owner / status','Workorder / due','Selection']:
      kind==='receiving'?['Original receiving','Observed / recorded','Effective source status','Selection']:
      ['Original measurement','Quantity and effort','Observed / source status','Selection'];
    return '<section class="impl-panel"><div class="impl-section-heading"><h3>'+esc(label(kinds[kind]))+'</h3><span>'+rows.length+' of '+all.length+' originals</span></div>'+
      '<div class="impl-row-tools">'+field('Find in original fields','filter',session.filter)+button('Apply filter','filter')+button('Previous','previous','',session.page===0)+'<span>Page '+(session.page+1)+' of '+pages+'</span>'+button('Next','next','',session.page+1>=pages)+'</div>'+
      (rows.length?table(heads,shown.map(row=>{
        const title='<strong>'+esc(rowTitle(kind,row))+'</strong><br><code>'+esc(row.id)+'</code>';
        if(kind==='task')return [title,esc(row.owner||'Unassigned')+'<br>'+pill(status(kind,row)),esc(row.editionId||'Local task')+'<br>'+esc(row.dueOn||'No date'),selectButtons(kind,row)];
        if(kind==='receiving')return [title,esc(row.observedAt)+'<br><small>Recorded '+esc(row.recordedAt)+'</small>',pill(status(kind,row))+'<br>'+row.taskIds.length+' selected tasks',selectButtons(kind,row)];
        return [title,esc(fmt(row.units))+' '+esc(row.unit)+'<br>'+esc(fmt(row.activeMinutes))+' active minutes · '+esc(fmt(row.elapsedMinutes))+' elapsed minutes<br>'+esc(fmt(row.manualCorrections))+' corrections',esc(row.observedAt)+'<br>'+pill(status(kind,row)),selectButtons(kind,row)];
      })):empty('No original rows match this filter.'))+
      (kind==='measurement'?note('Missing values remain “Not recorded”; an observed zero remains zero. Open each measurement for the original task/input/output scope and the producer’s baseline comparison.'):'')+'</section>';
  }
  function originalFilesPage(){
    const n=native();if(!n)return empty('Read the complete original source and cutoff first.');
    const query=session.filter.trim().toLowerCase(),all=n.originalFiles;
    const rows=query?all.filter(row=>JSON.stringify(row).toLowerCase().includes(query)):all;
    const pages=Math.max(1,Math.ceil(rows.length/50));session.page=Math.min(session.page,pages-1);
    const shown=rows.slice(session.page*50,(session.page+1)*50);
    return '<section class="impl-panel"><h3>Complete original file inventory</h3>'+
      note('This is the maintained producer’s named inventory, including historical and unassigned native bundle members. Embedded originals are already retained. Bind each external file to its exact existing source SHA-256 and byte count; attaching a file remains the original Sources workflow.')+
      '<div class="impl-row-tools">'+field('Find original files','filter',session.filter)+button('Apply filter','filter')+button('Previous','previous','',session.page===0)+
      '<span>Page '+(session.page+1)+' of '+pages+' · '+rows.length+' of '+all.length+' original paths</span>'+button('Next','next','',session.page+1>=pages)+button('Attach original source','sources')+'</div>'+
      (shown.length?table(['Original path and role','Exact bytes','Retained source binding','Original'],shown.map(row=>{
        const embedded=n.files.some(file=>file.sha256===row.sha256),ref=originalRef(row.sha256);
        const options=caseValue.sources.filter(source=>source.sha256===row.sha256&&source.bytes===row.bytes).map(source=>[source.id,source.filename+' · '+source.id]);
        if(ref&&!options.some(item=>item[0]===ref.sourceId))options.push([ref.sourceId,ref.sourceId+' · original unavailable']);
        return [esc(row.name)+'<small>'+esc(row.role||'Original workorder / material')+'</small>',
          row.bytes+' bytes<br><code>'+esc(row.sha256)+'</code>',
          embedded?pill('Embedded original'):field('Exact retained source','originalFile:'+row.sha256,ref?.sourceId||'',{options:[['','Select the original source'],...options]}),
          originalLink(row.sha256,row.name.split('/').at(-1))];
      })):empty('No original files match this filter.'))+
      details('Original native source-bundle manifests',n.sourceBundles)+'</section>';
  }
  function linksPage(){
    if(!draft())return empty('Select and read the original source first.');
    const list=selections();
    return '<section class="impl-panel"><div class="impl-section-heading"><h3>Explicit original evidence links</h3><span>'+list.length+' / 200 selected observations</span></div>'+
      note('These associations connect source observations to the selected existing records. They do not change work approval, purchase settlement, Installation acceptance or an outcome record.')+
      (list.length?table(['Original observation','Review use','Linked Operations records','Actions'],list.map(row=>[
        esc(label(row.kind))+'<br><code>'+esc(row.id)+'</code>',
        pill(label(row.use))+'<p>'+esc(row.note)+'</p>',
        Object.entries(linkKinds).flatMap(([field,kind])=>row[field].map(id=>'<span>'+esc(label(kind))+': '+esc(recordName(kind,id))+'</span>')).join('<br>')||'No record link',
        '<div class="impl-actions">'+button('Edit links','link','data-kind="'+row.kind+'" data-id="'+esc(row.id)+'"')+button('Remove selection','remove','data-kind="'+row.kind+'" data-id="'+esc(row.id)+'"')+'</div>'
      ])):empty('Open Tasks, Receiving or Measurements and select the observations you intend to review.'))+
      '<div class="impl-actions">'+button('Preview selected evidence','preview','',!native()||!list.length)+'</div></section>';
  }
  function findings(value){
    return value.issues.length?table(['Finding','Original observation','Review effect'],value.issues.map(row=>[
      '<strong>'+esc(label(row.code))+'</strong><p>'+esc(row.message)+'</p>',
      row.id?esc(row.kind)+'<br><code>'+esc(row.id)+'</code>':'Selected source',
      pill(row.blocking?'Needs current evidence':'Retained observation',row.blocking?'attention':'')
    ])):empty('No selection or source-binding findings.');
  }
  function reviewBody(value){
    const s=value.summary;
    return '<div class="impl-stat-grid">'+[['Selected evidence',s.evidence],['Context only',s.context],['Technical accepted tasks',s.technicalAcceptedTasks],['Customer accepted tasks',s.customerAcceptedTasks],['Comparable measurements',s.comparisons],['Installation editions',s.linkedInstallations],['External originals',s.externalOriginalFiles],['Original files still needed',s.missingOriginalFiles]].map(([name,count])=>'<div><span>'+esc(name)+'</span><strong>'+esc(count)+'</strong></div>').join('')+'</div>'+
      note(value.native.definitionBasis)+
      '<p>Source '+esc(value.inputs.sourceId)+' · <code>'+esc(value.inputs.sourceSha256)+'</code><br>Cutoff '+esc(value.inputs.asOfAt)+' · '+(value.inputs.tranche?'Tranche '+value.inputs.tranche:'Tranche unassigned')+'</p>'+
      findings(value)+
      table(['Selected original','Use','Retained source result'],value.selected.map(row=>[
        esc(label(row.link.kind))+'<br><code>'+esc(row.link.id)+'</code>',esc(label(row.link.use)),
        details('Original observation and effective status',{original:row.original,status:row.status,comparison:row.comparison??null,links:row.link})
      ]))+details('Exact linked Operations and Installation snapshots',value.bindings)+details('Complete frozen selection and source identity',{source:value.source,inputs:value.inputs,previewSha256:value.previewSha256});
  }
  function previewPage(){
    const value=session.preview;
    if(!value)return '<section class="impl-panel"><h3>Review selected evidence</h3>'+empty('Preview the retained selection to bind its original source, current case records and selected Installation editions.')+button('Preview selected evidence','preview','',!native()||!selections().length)+'</section>';
    return '<section class="impl-panel"><div class="impl-section-heading"><h3>'+esc(value.inputs.name)+'</h3>'+pill(value.ready?'Current evidence reviewed':'Findings retained',value.ready?'':'attention')+'</div>'+reviewBody(value)+
      note('Freezing retains the exact review, including any findings. Completion independently checks its selected tranche, dates and current linked records. Only the original issuer workflow can record acceptance.')+
      '<div class="impl-actions">'+button('Freeze evidence review','freeze','data-impl-write="true"',!value.selected.length||caseValue.program.state!=='OPEN')+'</div></section>';
  }
  function reviewsPage(){
    const saved=caseValue.reviews.filter(row=>row.purpose==='IMPLEMENTATION_EVIDENCE');
    return '<section class="impl-panel"><h3>Frozen implementation reviews</h3>'+
      (saved.length?table(['Original review','Cutoff / source','Current links','Actions'],saved.map(row=>[
        esc(row.implementationName||row.note)+'<br><code>'+esc(row.id)+'</code>',
        esc(row.implementationAsOfAt)+'<br>'+esc(row.implementationSourceId),
        row.implementationCurrent?.current?pill('Selected links current'):pill('Review linked changes','attention'),
        '<div class="impl-actions">'+button('Open frozen review','review','data-id="'+esc(row.id)+'"')+'<a href="'+prefix+'/implementation-reviews/'+encodeURIComponent(row.id)+'/export.zip" download>Download complete evidence</a></div>'
      ])):empty('No original implementation review has been frozen in this case.'))+'</section>'+
      (session.review?'<section class="impl-panel"><div class="impl-section-heading"><h3>'+esc(session.review.implementation.inputs.name)+'</h3>'+pill('Frozen at v'+session.review.version)+'</div>'+
        '<p>'+esc(session.review.actor)+' · '+esc(session.review.createdAt)+'</p>'+
        reviewBody(session.review.implementation)+
        '<div class="impl-actions">'+button('Use as new draft','reuse-review')+
        '<a href="'+prefix+'/implementation-reviews/'+encodeURIComponent(session.review.id)+'/export.zip" download>Download complete evidence</a>'+button('Download frozen review JSON','review-json')+'</div>'+
        note('The ZIP requires every embedded and referenced original file, the full implementation source, linked record and Installation snapshots, producer report, CSV tables and hash manifest. Missing exact source-bundle bytes remain a finding and prevent a complete evidence export. The original case export also retains these reviews for full reopen.')+'</section>':'');
  }
  function originalDetails(kind,row){
    const n=native(),mats=n.state.materials.filter(item=>(row.materialIds||[]).includes(item.id)||kind==='task'&&item.taskIds.includes(row.id));
    const edition=n.state.editions.find(item=>item.id===row.editionId);
    const files=mats.map(item=>[esc(item.name),esc(item.kind)+'<br><code>'+esc(item.sha256)+'</code>',originalLink(item.sha256,item.name)]);
    const refs=edition?Object.entries({packet:edition.packet,html:edition.html,checklist:edition.checklist,...edition.inputs}):[];
    const comparison=kind==='measurement'?n.comparisons.find(item=>item.measurementId===row.id):null;
    return '<h3>'+esc(rowTitle(kind,row))+'</h3><p>'+pill(status(kind,row))+'</p>'+details('Complete original observation',row)+
      (kind==='measurement'?details('Producer baseline comparison',comparison||{comparable:false,reason:'No applicable paired baseline in this selected source/cutoff.'}):'')+
      (files.length?table(['Original file','Kind / SHA-256','Open'],files):empty('This observation references no selected deliverable file.'))+
      (edition?'<h4>Original workorder edition</h4>'+details('Retained edition identity',edition)+
        table(['Original workorder input','SHA-256','Download'],refs.map(([key,sha])=>[esc(key),'<code>'+esc(sha)+'</code>',originalLink(sha,key)])):'');
  }
  function dialog(){
    const d=session.dialog;if(!d||!native())return '';
    const row=nativeRow(d.kind,d.id);if(!row)return '<aside class="impl-error">The selected original row is unavailable. '+button('Close','close-dialog')+'</aside>';
    if(d.type==='detail')return '<dialog open class="impl-dialog"><div class="impl-section-heading"><h2>Original implementation evidence</h2>'+button('Close','close-dialog')+'</div>'+originalDetails(d.kind,row)+'<div class="impl-actions">'+button(selected(d.kind,d.id)?'Edit evidence links':'Use evidence','link','data-kind="'+d.kind+'" data-id="'+esc(d.id)+'"')+'</div></dialog>';
    const x=d.value;
    return '<dialog open class="impl-dialog"><div class="impl-section-heading"><h2>Link original '+esc(d.kind)+'</h2>'+button('Close and retain draft','close-dialog')+'</div><p>'+esc(rowTitle(d.kind,row))+'<br><code>'+esc(row.id)+'</code></p>'+
      '<form data-impl-link><div class="impl-fields">'+field('Use in this review','use',x.use,{options:[['EVIDENCE','Evidence'],['CONTEXT','Historical or contextual observation']]})+
      Object.entries(linkKinds).map(([fieldName,kind])=>field('Existing '+label(kind),fieldName,x[fieldName],{options:(caseValue.records[kind]||[]).map(item=>[item.id,recordName(kind,item.id)+' · '+item.id]),multiple:true,wide:true})).join('')+
      field('Association and observation basis','note',x.note,{area:true,wide:true,help:'Record why these exact existing records are associated. A purchase link alone does not prove that its output is the selected material.'})+'</div><div class="impl-actions"><button type="submit">Retain evidence links</button></div></form>'+
      details('Unchanged original record',row)+'</dialog>';
  }
  function render(){
    if(!available())return;
    const body=session.tab==='source'?sourcePage():session.tab==='files'?originalFilesPage():Object.hasOwn(kinds,session.tab)?rowsPage(session.tab):session.tab==='links'?linksPage():session.tab==='preview'?previewPage():reviewsPage();
    root.innerHTML=header()+navigation()+body+dialog();controls();
  }
  function openLink(kind,id,use='EVIDENCE'){
    if(!nativeRow(kind,id))throw new Error('Select an original observation.');
    const value=clone(session.linkDrafts[session.sourceId+':'+kind+':'+id]||selected(kind,id)||{kind,id,use,deploymentIds:[],workIds:[],purchaseIds:[],outcomeIds:[],note:''});
    session.dialog={type:'link',kind,id,value};persist();render();
  }
  function retainLink(value){
    const list=selections(),at=list.findIndex(row=>row.kind===value.kind&&row.id===value.id);
    if(at<0&&list.length>=200)throw new Error('Select at most 200 original observations in one review.');
    if(at<0)list.push(value);else list[at]=value;
    delete session.linkDrafts[session.sourceId+':'+value.kind+':'+value.id];
    session.dialog=null;changed();render();
  }
  function captureScope(form){
    const data=new FormData(form),x=inputs();if(!x)return;
    const old=x.asOfAt;
    x.name=String(data.get('name')||'');x.note=String(data.get('note')||'');x.asOfAt=String(data.get('asOfAt')||'');x.tranche=data.get('tranche')?Number(data.get('tranche')):null;
    const previous=new Map(x.installationRefs.map(row=>[row.id+'@'+row.revision,row]));
    x.installationRefs=data.getAll('installationRefs').map(String).map(key=>installationRef(key)||previous.get(key)).filter(Boolean);
    changed({cutoff:x.asOfAt!==old});
  }
  function captureLink(form){
    if(session.dialog?.type!=='link')return;
    const data=new FormData(form),x=session.dialog.value;x.use=String(data.get('use')||'EVIDENCE');x.note=String(data.get('note')||'');
    for(const name of Object.keys(linkKinds))x[name]=data.getAll(name).map(String);
    session.linkDrafts[session.sourceId+':'+x.kind+':'+x.id]=clone(x);persist();
  }
  root.addEventListener('input',event=>{
    if(event.target.closest('[data-impl-scope]'))captureScope(event.target.closest('form'));
    if(event.target.closest('[data-impl-link]'))captureLink(event.target.closest('form'));
    if(event.target.name==='filter'){session.filter=event.target.value;session.page=0;persist();}
  });
  root.addEventListener('change',event=>{
    if(event.target.name?.startsWith('originalFile:')){
      const sha=event.target.name.slice('originalFile:'.length),sourceId=event.target.value;
      if(!inputs())return;
      inputs().originalFileRefs=(inputs().originalFileRefs||[]).filter(row=>row.sha256!==sha);
      if(sourceId)inputs().originalFileRefs.push({sha256:sha,sourceId});
      changed();render();return;
    }
    if(event.target.name==='sourceId'){
      session.sourceId=event.target.value;session.preview=null;session.dialog=null;session.filter='';session.page=0;persist();render();return;
    }
    if(event.target.closest('[data-impl-scope]'))captureScope(event.target.closest('form'));
    if(event.target.closest('[data-impl-link]'))captureLink(event.target.closest('form'));
  });
  root.addEventListener('submit',event=>{
    if(event.target.matches('[data-impl-scope]')){event.preventDefault();captureScope(event.target);return;}
    if(event.target.matches('[data-impl-link]')){event.preventDefault();captureLink(event.target);run(async()=>retainLink(clone(session.dialog.value)));}
  });
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-impl-action]');if(!target||target.disabled)return;
    const action=target.dataset.implAction,kind=target.dataset.kind,id=target.dataset.id;
    run(async()=>{
      if(action==='tab'){session.tab=target.dataset.tab;session.dialog=null;session.page=0;session.filter='';return;}
      if(action==='sources'){persist();await onSources();return;}
      if(action==='refresh'){await refresh();return;}
      if(action==='adopt'){await refresh(true);session.notice='The entered selection now targets the current case version. Preview its exact linked records again.';return;}
      if(action==='read-source'){await readSource({adopt:!draft()});return;}
      if(action==='producer-report'){download(native().originalReportHtml,'original-implementation-report.html','text/html');return;}
      if(action==='filter'){session.page=0;return;}
      if(action==='previous'){session.page=Math.max(0,session.page-1);return;}
      if(action==='next'){session.page++;return;}
      if(action==='detail'){session.dialog={type:'detail',kind,id};return;}
      if(action==='link'){openLink(kind,id);return;}
      if(action==='select'){openLink(kind,id,target.dataset.use);return;}
      if(action==='remove'){inputs().selections=selections().filter(row=>row.kind!==kind||row.id!==id);changed();return;}
      if(action==='close-dialog'){session.dialog=null;return;}
      if(action==='preview'){await preview();return;}
      if(action==='freeze'){await freeze();return;}
      if(action==='retry'){await sendPending();return;}
      if(action==='readback'){await finishAccepted();return;}
      if(action==='review'){await showReview(id);return;}
      if(action==='review-json'){download(session.review,session.review.id+'.json');return;}
      if(action==='reuse-review'){
        const value=session.review.implementation,x=clone(value.inputs);session.sourceId=x.sourceId;
        session.drafts[x.sourceId]={inputs:x,baseVersion:caseValue.program.version,dirty:true};
        session.nativeBySource[x.sourceId]=clone(value.native);session.preview=null;session.tab='source';session.review=null;
        session.notice='The original frozen scope is now an entered draft. Preview it against the current linked case records before freezing a new review.';return;
      }
      if(action==='draft-export'){download({schema:'sf47.implementation-draft.v1',caseId:current.program.id,sourceId:session.sourceId,draft:draft()},'implementation-evidence-draft.json');return;}
      if(action==='draft-import'){
        const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
        input.addEventListener('change',()=>run(async()=>{
          const file=input.files?.[0];if(!file)return;if(file.size>2000000)throw new Error('Select an entered draft up to 2 MB.');
          const value=JSON.parse(await file.text());
          if(value.schema!=='sf47.implementation-draft.v1'||value.caseId!==caseValue.program.id||!value.draft?.inputs||value.draft.inputs.sourceId!==value.sourceId)throw new Error('Select an entered draft for this original case.');
          const original=caseValue.sources.find(row=>row.id===value.sourceId);
          if(!original||original.sha256!==value.draft.inputs.sourceSha256)throw new Error('The draft’s exact original source is not attached to this case.');
          if(!Array.isArray(value.draft.inputs.selections)||value.draft.inputs.selections.length>200)throw new Error('The entered selection exceeds its review bound.');
          session.sourceId=value.sourceId;session.drafts[value.sourceId]=clone(value.draft);session.drafts[value.sourceId].dirty=true;
          delete session.nativeBySource[value.sourceId];session.preview=null;session.dialog=null;session.tab='source';
          session.notice='Imported the entered draft. Read its exact source and selected cutoff before previewing.';
        }),{once:true});input.click();
      }
    });
  });
  render();
  const ready=(async()=>{
    if(session.inflight){try{await session.inflight;}catch{}if(available()&&session.accepted)await run(finishAccepted);}
    else if(session.accepted)await run(finishAccepted);
    else if(session.reviewId&&!session.review)await run(()=>showReview(session.reviewId));
  })();
  return {root,ready,dispose(){active=false;persist();},setHostBusy(value){hostBusy=!!value;controls();}};
}
