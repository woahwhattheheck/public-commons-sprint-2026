// MIT. Private Gravity referral operator, original saved data and complete receiving.
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty = v => JSON.stringify(v, null, 2);
const enc = encodeURIComponent;
const short = v => String(v || '').slice(0, 12);
const R = '/api/referrals';
let state, catalogue, profile, nativeCatalogue, actor = sessionStorage.getItem('gravity.actor') || '';
let section = 'queue', busy = false, renderEpoch = 0, actionSeq = 0, dirty = new Set(), pendingDraft = Promise.resolve();
let actions = new Map(), forms = new Map(), database;
const selection = {sourceId:'',editionId:'',reviewId:'',assessmentId:'',taskId:'',sourceType:'Task',sourceOffset:0,reviewKind:'requirements'};
const tokenKey = 'gravity.operator.' + location.origin;
if (location.hash && !location.hash.startsWith('#/')) {
  sessionStorage.setItem(tokenKey, decodeURIComponent(location.hash.slice(1)));
  history.replaceState(null, '', location.pathname + location.search);
}
const token = sessionStorage.getItem(tokenKey) || '';
$('#operator-actor').value = actor;
$('#operator-actor').addEventListener('change', e => { actor=e.target.value.trim(); sessionStorage.setItem('gravity.actor',actor); });
function requireActor(){ if(!actor.trim())throw new Error('Enter the operator name or operating role in the header.'); return actor.trim(); }
function notice(text='', kind='status'){ const n=$('#notice'); n.textContent=text; n.dataset.kind=kind; }
function badge(v){ return '<span class="badge">'+esc(v ?? '—')+'</span>'; }
function select(name,label,rows,value='',help=''){
  return '<label class="field"><span>'+esc(label)+'</span><select name="'+esc(name)+'"><option value="">Select…</option>'+
    rows.map(r=>{const [id,title]=Array.isArray(r)?r:[r.id,r.label||r.name||r.id];return '<option value="'+esc(id)+'"'+(id===value?' selected':'')+'>'+esc(title)+'</option>';}).join('')+
    '</select>'+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
}
function input(name,label,value='',options={}){
  return '<label class="field"><span>'+esc(label)+'</span><input name="'+esc(name)+'" type="'+esc(options.type||'text')+'" value="'+esc(value)+'"'+(options.required?' required':'')+
    (options.step?' step="'+esc(options.step)+'"':'')+(options.min!==undefined?' min="'+esc(options.min)+'"':'')+(options.max!==undefined?' max="'+esc(options.max)+'"':'')+
    ' autocomplete="off">'+(options.help?'<small>'+esc(options.help)+'</small>':'')+'</label>';
}
function area(name,label,value='',options={}){
  return '<label class="field"><span>'+esc(label)+'</span><textarea name="'+esc(name)+'"'+(options.code?' class="code" spellcheck="false"':'')+(options.required?' required':'')+'>'+esc(value)+'</textarea>'+
    (options.help?'<small>'+esc(options.help)+'</small>':'')+'</label>';
}
function check(name,label,checked=false){ return '<label class="checkline"><input type="checkbox" name="'+esc(name)+'"'+(checked?' checked':'')+'><span>'+esc(label)+'</span></label>'; }
function action(label,fn,cls=''){const id='a'+(++actionSeq);actions.set(id,fn);return '<button type="button" data-action="'+id+'" class="'+esc(cls)+'">'+esc(label)+'</button>';}
function form(id,content,label,handler){
  forms.set(id,handler);return '<form id="'+esc(id)+'" data-native-form>'+content+'<div class="controls"><button class="primary" type="submit">'+esc(label)+'</button><span class="muted" data-draft-note></span></div></form>';
}
function field(form,name){return new FormData(form).get(name) ?? '';}
function allFields(form,name){return new FormData(form).getAll(name);}
function number(form,name,fallback=null){const s=field(form,name);return s===''?fallback:Number(s);}
function jsonField(form,name,fallback={}){const raw=field(form,name).trim();if(!raw)return fallback;try{return JSON.parse(raw);}catch(e){throw new Error(name+' requires complete JSON: '+e.message);}}
function panel(title,content,description=''){return '<section class="panel"><h2>'+esc(title)+'</h2>'+(description?'<p>'+esc(description)+'</p>':'')+content+'</section>';}
function table(columns,rows,empty='No saved records in this selection.'){
  if(!rows.length)return '<div class="empty">'+esc(empty)+'</div>';
  return '<div class="table-scroll"><table><thead><tr>'+columns.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+
    rows.map(row=>'<tr>'+row.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function recordOptions(kind){return (state.referral[kind]||[]).map(r=>[r.id,(r.label||r.id)+' · '+short(r.id)]);}
function baseOptions(kind){return (state[kind]||[]).map(r=>[r.id||r.operationId,(r.label||r.name||r.connection?.label||r.id||r.operationId)+' · '+short(r.id||r.operationId)]);}
function recordView(kind,id){return api(R+'/records/'+enc(kind)+'/'+enc(id));}
async function selectedRows(sourceId, ids){
  const rows=[];
  for(let offset=0;offset<ids.length;offset+=4){rows.push(...await Promise.all(ids.slice(offset,offset+4).map(id=>api('/api/sources/'+sourceId+'/rows/'+id))));}
  return rows;
}
async function api(path,body,extra={}){
  const headers={Authorization:'Bearer '+token,...extra.headers};
  const opts={...extra,method:body===undefined?'GET':'POST',headers};
  delete opts.binary;
  if(body!==undefined){if(body instanceof Blob||body instanceof ArrayBuffer){opts.body=body;}else{headers['Content-Type']='application/json';opts.body=JSON.stringify(body);}}
  const response=await fetch(path,opts);
  if(!response.ok){const raw=await response.text();let detail;try{detail=JSON.parse(raw);}catch{}throw new Error(detail?.error||('HTTP '+response.status+' '+raw.slice(0,500)));}
  if(extra.binary)return response;
  return response.json();
}
async function download(path,name){
  const response=await api(path,undefined,{binary:true});
  const blob=await response.blob(), url=URL.createObjectURL(blob), link=document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  return {name,bytes:blob.size};
}
async function show(title,value,extra=''){
  $('#detail-title').textContent=title;$('#detail-body').innerHTML=extra+'<pre>'+esc(typeof value==='string'?value:pretty(value))+'</pre>';
  if(!$('#detail').open)$('#detail').showModal();
}
async function openRecord(kind,id){await show(kind+' · '+short(id),await recordView(kind,id));}
async function bootDB(){
  database=await new Promise((resolve,reject)=>{const r=indexedDB.open('gravity-referral-drafts',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
function dbOp(mode,key,value){
  if(!database)return Promise.resolve(undefined);
  return new Promise((resolve,reject)=>{const tx=database.transaction('drafts',mode),s=tx.objectStore('drafts');const r=mode==='readonly'?s.get(key):value===undefined?s.delete(key):s.put(value,key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
function draftKey(id){return (state?.workspaceId||'opening')+':'+id;}
function readControls(f){
  return [...f.elements].filter(e=>e.name&&!['file','submit','button'].includes(e.type)).map(e=>({name:e.name,type:e.type,value:e.value,checked:e.checked}));
}
async function saveFormDraft(f){
  if(!f?.id||!state)return;
  await dbOp('readwrite',draftKey(f.id),{values:readControls(f),savedAt:new Date().toISOString()});
  dirty.delete(f.id);const n=$('[data-draft-note]',f);if(n)n.textContent='Draft saved on this device';
  $('#draft-state').textContent='Drafts saved on this device · original records save through the native workspace';
}
async function restoreDrafts(){
  for(const f of $$('form[data-native-form]')){
    const saved=await dbOp('readonly',draftKey(f.id));if(!saved)continue;
    const used={};for(const v of saved.values||[]){const group=[...f.elements].filter(e=>e.name===v.name&&e.type===v.type);const i=used[v.name+'|'+v.type]||0;used[v.name+'|'+v.type]=i+1;const e=group[i];if(!e)continue;e.value=v.value;if(['checkbox','radio'].includes(e.type))e.checked=v.checked;}
    const n=$('[data-draft-note]',f);if(n)n.textContent='Retained local draft restored';
  }
}
async function clearDraft(f){await dbOp('readwrite',draftKey(f.id),undefined);dirty.delete(f.id);}
async function flushDrafts(){await pendingDraft;for(const id of [...dirty]){const f=document.getElementById(id);if(f)await saveFormDraft(f);}}
async function refreshState(){
  state=await api('/api/state');
  $('#workspace-id').textContent=state.workspaceId;
  for(const [key,kind] of [['sourceId','sources'],['editionId','editions'],['reviewId','reviews'],['assessmentId','assessments']]){
    const rows=kind==='sources'?state.sources:state.referral[kind];
    if(!rows.some(r=>r.id===selection[key]))selection[key]=(kind==='sources'?rows[0]?.id:rows.at(-1)?.id)||'';
  }
}
async function run(fn,{rerender=true}={}){
  if(busy){notice('The current native operation is still returning. Its saved request identity remains selected.');return;}
  busy=true;notice('');document.body.setAttribute('aria-busy','true');$$('button').forEach(b=>b.disabled=true);
  try{const result=await fn();if(result?.message)notice(result.message);if(rerender){await refreshState();await render();}return result;}
  catch(e){notice(e.message,'error');throw e;}
  finally{busy=false;document.body.removeAttribute('aria-busy');$$('button').forEach(b=>b.disabled=false);}
}
function activeSelection(){
  return '<div class="row">'+select('editionId','Referral edition',recordOptions('editions'),selection.editionId)+
    select('reviewId','Requirement and field review',recordOptions('reviews'),selection.reviewId)+'</div>';
}
async function queueView(){
  let assessment=selection.assessmentId?await recordView('assessments',selection.assessmentId):null;
  let page=assessment?await api(R+'/assessments/'+enc(assessment.id)+'/tasks?limit=100'):null;
  let findingPage=assessment?await api(R+'/assessments/'+enc(assessment.id)+'/findings?limit=250'):null;
  const summary=assessment?.summary||{};
  const metrics=[['Selected referrals',summary.tasks||0],['Completed with outcome',summary.completedWithOutcome||0],['Consent reviews recorded',summary.consentReviewRecorded||0],['Contact instructions',summary.contactProhibited||0]];
  let content='<div class="metric-strip">'+metrics.map(([label,value])=>'<div class="metric"><strong>'+esc(value)+'</strong><span>'+esc(label)+'</span></div>').join('')+'</div>';
  content+=panel('Assess a saved referral edition',form('assess-form',activeSelection()+input('label','Assessment label','Referral operating review')+area('note','Operator note'), 'Save complete assessment',async f=>{
    selection.editionId=field(f,'editionId');selection.reviewId=field(f,'reviewId');
    const result=await api(R+'/assessments',{label:field(f,'label'),actor:requireActor(),note:field(f,'note'),editionId:selection.editionId,reviewId:selection.reviewId});
    selection.assessmentId=result.id;await clearDraft(f);return {message:'Complete assessment saved: '+result.id};
  }), 'The assessment retains all selected Tasks, exact focused requests, source fields, decisions and operating findings.');
  if(state.referral.assessments.length)content+=panel('Saved operating views',table(['Assessment','As of','Referrals','Open'],state.referral.assessments.slice().reverse().map(r=>[
    esc(r.label),esc(r.asOf),esc(r.summary?.tasks),action(r.id===selection.assessmentId?'Selected':'Open',async()=>{selection.assessmentId=r.id;selection.editionId=r.editionId;selection.reviewId=r.reviewId;await render();},'link')])));
  if(!assessment)return content+panel('Build the first referral view','<p>Retain a complete original source, select its referral Tasks and actor topology, then adopt the full source requirements and field review.</p>'+action('Open original sources',()=>navigate('sources')));
  content+='<div class="selection"><strong>'+esc(assessment.label)+'</strong> · '+esc(assessment.asOf)+'<code class="inline-code">'+esc(assessment.id)+'</code>'+
    action('Download complete assessment',()=>download(R+'/assessments/'+assessment.id+'/file','Gravity_Complete_Assessment.json'),'link')+'</div>';
  content+=table(['Original Task','Status','Owner / requester','Subject','Requests','Open'],page.rows.map(r=>[
    esc(r.logicalId)+'<code class="inline-code">'+esc(short(r.taskId))+'</code>',badge(r.status)+(r.contactProhibited?'<div class="muted">Contact prohibited instruction</div>':''),
    esc(r.owner||'Unassigned')+'<br><small>'+esc(r.requester)+'</small>',esc(r.subject),esc(r.requests.length),
    action('Referral detail',()=>referralDetail(assessment,r),'link')
  ]));
  content+=panel('Source and operating findings',table(['Severity','Finding','Owner','State','Original'],findingPage.rows.map(f=>[
    badge(f.severity),esc(f.label),esc(f.owner),badge(f.state),action(short(f.taskId),()=>show('Original finding',f),'link')])),
    findingPage.nextOffset!==null?'Showing the first '+findingPage.rows.length+' findings; the complete assessment file retains every original finding.':'Every finding in this assessment is shown.');
  return content;
}
async function referralDetail(assessment,task){
  const cells=await api(R+'/assessments/'+enc(assessment.id)+'/cells?taskId='+enc(task.taskId)+'&limit=100');
  const sourceRow=await api('/api/sources/'+enc(assessment.sourceId)+'/rows/'+enc(task.taskId));
  const info=table(['Field','Original presence','Exact values'],cells.rows.map(c=>[
    esc(c.label),badge(c.state),c.values.map(v=>'<code>'+esc(v.jsonText)+'</code><small class="inline-code">'+esc(v.pointer)+'</small>').join('<hr>')]));
  await show('Original referral · '+task.logicalId,task,info+'<h3>Unchanged source JSON</h3><pre>'+esc(sourceRow.jsonText)+'</pre><h3>Operating selection</h3>');
}
async function sourcesView(){
  const current=selection.sourceId?await api('/api/sources/'+enc(selection.sourceId)):null;
  const types=current?.inventory?.resourceTypes||[];
  if(types.length&&!types.some(t=>(t.type||t.resourceType)===selection.sourceType))selection.sourceType=types[0].type||types[0].resourceType;
  const rows=current?await api('/api/sources/'+enc(current.id)+'/rows?resourceType='+enc(selection.sourceType)+'&offset='+selection.sourceOffset+'&limit=50'):null;
  let out='<div class="grid">'+panel('Retain an original FHIR source',form('source-intake',input('label','Source label','Original referral source',{required:true})+
    '<label class="field"><span>Complete original JSON or declared source ZIP</span><input type="file" name="file" required></label>',
    'Retain complete original',async f=>{const file=$('input[type=file]',f).files[0];if(!file)throw new Error('Select the complete original file.');const r=await api('/api/sources',file,{headers:{'X-Source-Name':enc(file.name),'X-Source-Label':enc(field(f,'label'))}});selection.sourceId=r.id;selection.sourceOffset=0;await clearDraft(f);return{message:'Complete source retained: '+r.id};}),
    'Every original resource and member keeps its exact content and source identity.')+
    panel('Adopt published Gravity examples',form('published-intake',input('label','Published source label','Gravity STU3 published examples',{required:true})+
      '<label class="field"><span>Unchanged published examples ZIP</span><input type="file" name="file" accept=".zip" required></label>'+
      input('publicationUrl','Original archive URL','https://hl7.org/fhir/us/sdoh-clinicalcare/3.0.0/examples.json.zip',{required:true})+
      input('referenceBase','Reviewed example reference base','https://hl7.org/fhir/us/sdoh-clinicalcare',{required:true,help:'The saved adoption assigns explicit full URLs for the separately published examples; original member bytes remain unchanged.'})+
      area('note','Adoption note'),'Retain originals and reviewed collection',async f=>{const file=$('input[type=file]',f).files[0];if(!file)throw new Error('Select the original published archive.');const r=await api(R+'/published-examples',file,{headers:{'X-Source-Label':enc(field(f,'label')),'X-Actor':enc(requireActor()),'X-Publication-Url':enc(field(f,'publicationUrl')),'X-Reference-Base':enc(field(f,'referenceBase')),'X-Source-Note':enc(field(f,'note'))}});selection.sourceId=r.source.id;selection.sourceOffset=0;await clearDraft(f);return{message:'Original archive and '+r.resourceDocuments+' published resource documents retained.'};}),
      'Use the original published ZIP. The derived collection and every reviewed URL assignment are retained alongside it.')+'</div>';
  out+=panel('Retained complete sources',table(['Label','Original name','Bytes','Source identity','Open'],state.sources.map(s=>[
    esc(s.label),esc(s.name),esc(s.bytes),'<code>'+esc(short(s.id))+'</code>',action(s.id===selection.sourceId?'Selected':'Open',async()=>{selection.sourceId=s.id;selection.sourceOffset=0;await render();},'link')])));
  if(!current)return out;
  out+='<div class="selection"><strong>'+esc(current.label)+'</strong><code class="inline-code">'+esc(current.id)+'</code><div class="controls">'+
    action('Download complete original',()=>download('/api/sources/'+current.id+'/packet',current.name||'Gravity_Original_Source.zip'))+
    action('View original inventory',()=>show('Complete original inventory',current.inventory))+
    action('View original members',async()=>show('Every retained original member',await api('/api/sources/'+current.id+'/members')))+
    action('Select referral edition',()=>navigate('editions'))+'</div></div>';
  out+=form('source-filter',select('resourceType','Resource type',types.map(t=>[t.type||t.resourceType,(t.type||t.resourceType)+' · '+t.count]),selection.sourceType),
    'Open original resource type',async f=>{selection.sourceType=field(f,'resourceType');selection.sourceOffset=0;await clearDraft(f);return {message:'Original resource type selected.'};});
  out+=table(['Original resource','Logical ID','Version','Member / pointer','Complete record'],rows.rows.map(r=>[
    esc(r.resourceType),esc(r.id),esc(r.versionId||'—'),esc(r.memberId)+'<code class="inline-code">'+esc(r.entryPointer)+'</code>',
    action(short(r.recordId),async()=>{const row=await api('/api/sources/'+current.id+'/rows/'+r.recordId);await show('Complete original resource',row.jsonText,'<p><code>'+esc(r.recordId)+'</code></p>');},'link')]));
  out+='<div class="pager"><span>Offset '+rows.offset+' · '+(rows.total??'?')+' original records</span>'+
    (selection.sourceOffset? action('Previous',async()=>{selection.sourceOffset=Math.max(0,selection.sourceOffset-50);await render();}):'')+
    (rows.nextOffset!==null? action('Next',async()=>{selection.sourceOffset=rows.nextOffset;await render();}):'')+'</div>';
  return out;
}
async function editionsView(){
  const sourceId=selection.sourceId;
  let taskRows=[];
  if(sourceId){let offset=0;do{const p=await api('/api/sources/'+sourceId+'/rows?resourceType=Task&offset='+offset+'&limit=250');taskRows.push(...p.rows);offset=p.nextOffset;}while(offset!==null&&taskRows.length<10000);}
  let out=panel('Retained referral editions',table(['Edition','Selected Tasks','Source','Topology','Open'],state.referral.editions.map(r=>[
    esc(r.label),esc(r.taskIds.length),'<code>'+esc(short(r.sourceId))+'</code>',esc(short(r.configurationId)),
    '<div class="record-actions">'+action('Use',async()=>{selection.editionId=r.id;selection.sourceId=r.sourceId;await navigate('queue');},'link')+
    action('Original selection',()=>openRecord('editions',r.id),'link')+'</div>'])));
  if(!sourceId)return out+panel('Select an original source','<p>Open the unchanged source before selecting its exact referral Task records.</p>'+action('Open sources',()=>navigate('sources')));
  const picks=taskRows.map(r=>'<label><input type="checkbox" name="taskId" value="'+esc(r.recordId)+'"> '+esc(r.id||r.recordId)+' <code>'+esc(short(r.recordId))+'</code></label>').join('');
  out+=panel('Create a referral cohort edition',form('edition-form-'+sourceId,input('label','Edition label','Referral cohort',{required:true})+
    select('configurationId','Saved actor / server topology',recordOptions('configurations'),state.referral.configurations.at(-1)?.id||'')+
    select('predecessorId','Prior edition, when this continues an existing selection',recordOptions('editions'))+
    '<div class="field"><span>Exact original Task selection · up to 100</span><div class="checkbox-list">'+picks+'</div></div>'+
    '<div class="row">'+select('referencePolicy','Reference policy',[['bundle','Original Bundle identities'],['selected-base','Reviewed selected base']],'bundle')+
    input('baseUrl','Reviewed reference base','',{help:'Leave empty for original Bundle identities. For selected-base, enter the exact reviewed HTTPS reference base.'})+'</div>'+
    area('note','Cohort and source-selection note'),'Save referral edition',async f=>{
      const selected=allFields(f,'taskId');if(!selected.length||selected.length>100)throw new Error('Select between 1 and 100 original referral Tasks.');
      const r=await api(R+'/editions',{label:field(f,'label'),actor:requireActor(),note:field(f,'note'),sourceId,configurationId:field(f,'configurationId'),
        taskIds:selected,predecessorId:field(f,'predecessorId')||null,referencePolicy:field(f,'referencePolicy'),baseUrl:field(f,'baseUrl'),decisionIds:[]});
      selection.editionId=r.id;await clearDraft(f);return {message:'Original referral edition saved: '+r.id};
    }), 'Select the actual Tasks. The source graph retains focused requests, parent tasks, consent references and outcome resources.');
  return out;
}

async function requirementsView(){
  const selected=selection.reviewId?await recordView('reviews',selection.reviewId):null;
  let out=panel('Complete source review',form('profile-adoption',input('label','Review label','Gravity original requirements and field review',{required:true})+
    area('note','Adoption scope'), 'Adopt all 57 requirements and 24 field rows',async f=>{
      const result=await api(R+'/reviews/profile',{label:field(f,'label'),actor:requireActor(),note:field(f,'note')});
      selection.reviewId=result.id;await clearDraft(f);return{message:'The complete original source profile is retained as an editable review draft.'};
    }), 'Every source requirement and field is retained. Review states, owners, mappings and receiving references are explicit operator decisions.');
  out+=table(['Saved review','Requirements','Fields','Open'],state.referral.reviews.map(r=>[
    esc(r.label),esc(pretty(r.counts?.requirements||{})),esc(pretty(r.counts?.fields||{})),
    action(r.id===selection.reviewId?'Selected':'Open',async()=>{selection.reviewId=r.id;await render();},'link')]));
  if(!selected)return out;
  const origins={requirements:new Map(selected.profileSnapshot.requirements.map(r=>[r.key,r])),fields:new Map(selected.profileSnapshot.fields.map(r=>[r.key,r]))};
  const rowHTML=(group,row)=>{
    const prefix=group+'__'+row.key+'__', original=origins[group].get(row.key);
    const originalText=group==='requirements'?original.original.requirement||pretty(original.original):original.operating_interpretation;
    return '<div class="review-item" data-review-group="'+group+'"><h3>'+esc(row.key)+' · '+esc(original.label||original.category)+'</h3>'+
      '<div class="original">'+esc(originalText)+'</div><div class="grid three">'+
      select(prefix+'status','Review status',catalogue.reviewStates.map(v=>[v,v]),row.status)+
      input(prefix+'owner','Operating owner',row.owner)+input(prefix+'reviewer','Reviewer',row.reviewer)+'</div>'+
      area(prefix+'reason','Concrete review or absence decision',row.reason)+
      '<div class="grid">'+input(prefix+'targetPath','Selected target path',row.targetPath)+area(prefix+'mapping','Authored transformation / mapping',row.mapping)+'</div>'+
      '<details><summary>Original citations and receiving reference</summary><pre>'+esc(pretty(original.source_refs))+'</pre>'+
      area(prefix+'sourceRefs','Reviewed native source citations',pretty(row.sourceRefs),{code:true,help:'Keep exact sourceId, recordId and pointer or an original member / URL.'})+
      input(prefix+'receivingId','Actual saved receiving result ID',row.receivingId||'')+
      input(prefix+'reviewedAt','Original review time with timezone',row.reviewedAt||'')+'</details></div>';
  };
  const body=input('label','Successor review label',selected.label+' · reviewed',{required:true})+area('note','Complete review note',selected.note)+
    '<div class="tabs">'+action('Requirements (57)',async()=>{$$('[data-review-group]').forEach(e=>e.hidden=e.dataset.reviewGroup!=='requirements');})+
    action('Fields (24)',async()=>{$$('[data-review-group]').forEach(e=>e.hidden=e.dataset.reviewGroup!=='fields');})+
    action('Show all',async()=>{$$('[data-review-group]').forEach(e=>e.hidden=false);})+'</div>'+
    selected.requirements.map(r=>rowHTML('requirements',r)).join('')+selected.fields.map(r=>rowHTML('fields',r)).join('');
  out+=panel('Review every original row',form('review-editor-'+selected.id,body,'Save complete successor review',async f=>{
    const request={label:field(f,'label'),actor:requireActor(),note:field(f,'note'),profileId:selected.profileId,predecessorId:selected.id};
    for(const group of ['requirements','fields']){
      request[group]=selected[group].map(old=>{
        const p=group+'__'+old.key+'__',status=field(f,p+'status'),reason=field(f,p+'reason');
        return {key:old.key,status,reason,owner:field(f,p+'owner'),reviewer:field(f,p+'reviewer')||(status!=='unreviewed'?requireActor():''),
          reviewedAt:field(f,p+'reviewedAt')||(status!=='unreviewed'?new Date().toISOString():null),
          sourceRefs:jsonField(f,p+'sourceRefs',[]),targetPath:field(f,p+'targetPath'),mapping:field(f,p+'mapping'),
          receivingId:field(f,p+'receivingId')||null};
      });
    }
    const result=await api(R+'/reviews',request);selection.reviewId=result.id;await clearDraft(f);
    return{message:'Complete reviewed successor saved with all 81 original rows.'};
  }), 'The prior review remains unchanged. A disposition beyond unreviewed needs its concrete reason and responsible reviewer.');
  return out;
}
async function topologyView(){
  let out=panel('Selected actor and server editions',table(['Configuration','Topology','Recipient host','Source version','Open'],state.referral.configurations.map(r=>[
    esc(r.label),badge(r.topology),esc(r.recipientHostRole),esc(r.sourceVersion),action('Complete configuration',()=>openRecord('configurations',r.id),'link')])));
  let body=input('label','Configuration label','Referral operating topology',{required:true})+
    '<div class="grid">'+select('topology','Referral topology',catalogue.topologies.map(r=>[r.id||r.key||r.topology||r.name, r.label||r.name||r.id||r.key||r.topology]),'direct')+
    select('recipientHostRole','Recipient server owner',[['source','Source'],['intermediary','Intermediary'],['target','Target']],'target')+'</div>'+
    '<div class="grid">'+select('sourceVersion','Selected source version',[['3.0.0','Gravity STU3 3.0.0'],['2.3.0','Explicit legacy Gravity 2.3.0']],'3.0.0')+
    select('classification','Input classification',[['published_example','Published examples'],['client_supplied','Client supplied originals'],['operator_transformation','Authored transformation']],'client_supplied')+'</div>'+
    select('predecessorId','Original predecessor configuration',recordOptions('configurations'))+
    select('legacyProfileArtifactId','Complete original legacy profile artifact, when selected',baseOptions('artifacts'));
  for(const role of ['source','intermediary','target']){
    body+='<h3>'+esc(role.charAt(0).toUpperCase()+role.slice(1))+' role</h3><div class="grid">'+
      input(role+'Organization','Original organisation reference','',{help:'Retain the actual organisation / original reference. The intermediary fields apply only to intermediary topologies.'})+
      input(role+'Owner','Operating owner',actor)+'</div>'+
      select(role+'Connection','Actual selected server connection',baseOptions('connections'))+
      input(role+'Note','Role and server responsibility');
  }
  body+='<h3>Selected monitoring</h3><div class="grid three">'+select('monitorMode','Mode',[['manual','Manual'],['poll','Poll'],['subscription','Subscription']],'manual')+
    input('intervalMinutes','Chosen interval in minutes','',{type:'number',min:1,max:10080})+input('timezone','IANA timezone','UTC')+'</div>'+
    '<div class="grid three">'+input('businessDays','ISO business days','1,2,3,4,5')+input('businessStart','Business day start','09:00',{type:'time'})+
    input('businessEnd','Business day end','17:00',{type:'time'})+'</div>'+
    check('urgent','Explicit urgent situation for a selected interval below 15 minutes')+
    input('monitorOwner','Monitoring owner',actor)+area('monitorReason','Monitoring selection and urgency reason')+
    area('note','Scope and topology note');
  // The source catalogue retains its complete original topology descriptions.
  body=body.replace('<select name="topology"><option value="">Select…</option></select>',
    '<select name="topology">'+['direct','direct-light','intermediary','intermediary-light'].map(t=>'<option value="'+t+'">'+t+'</option>').join('')+'</select>');
  out+=panel('Save actor and server ownership',form('topology-form',body,'Save complete topology',async f=>{
    const topology=field(f,'topology'),roles=topology.startsWith('intermediary')?['source','intermediary','target']:['source','target'];
    const result=await api(R+'/configurations',{label:field(f,'label'),actor:requireActor(),note:field(f,'note'),topology,
      roles:roles.map(role=>({role,organization:field(f,role+'Organization'),owner:field(f,role+'Owner'),connectionId:field(f,role+'Connection')||null,note:field(f,role+'Note')})),
      recipientHostRole:field(f,'recipientHostRole'),sourceVersion:field(f,'sourceVersion'),classification:field(f,'classification'),
      predecessorId:field(f,'predecessorId')||null,legacyProfileArtifactId:field(f,'legacyProfileArtifactId')||null,
      monitoring:{mode:field(f,'monitorMode'),intervalMinutes:number(f,'intervalMinutes'),timezone:field(f,'timezone'),
        businessDays:field(f,'businessDays').split(',').filter(Boolean).map(Number),businessStart:field(f,'businessStart'),businessEnd:field(f,'businessEnd'),
        urgent:!!field(f,'urgent'),reason:field(f,'monitorReason'),owner:field(f,'monitorOwner')}});
    await clearDraft(f);return{message:'Actor topology and server ownership saved: '+result.id};
  }), 'Direct hosts the recipient on the target server. Direct-light hosts it on the source. Intermediary retains the third actor; intermediary-light records the selected source or intermediary host.');
  out+=panel('Original topology definitions','<pre>'+esc(pretty(profile.topologies))+'</pre>');
  return out;
}
async function decisionsView(){
  const edition=selection.editionId?await recordView('editions',selection.editionId):null;
  let out=panel('Original scoped decisions',table(['Decision','Kind / outcome','Owner','Scope','Open'],state.referral.decisions.map(r=>[
    esc(r.label),badge(r.kind)+' '+badge(r.outcome),esc(r.owner),esc(r.taskIds.length)+' Tasks · '+esc(short(r.editionId)),
    action('Complete decision',()=>openRecord('decisions',r.id),'link')])));
  if(!edition)return out+panel('Select the referral edition','<p>Open the exact edition before recording consent, ownership, relationships or finding decisions.</p>'+action('Open referral editions',()=>navigate('editions')));
  const tasks=await selectedRows(edition.sourceId,edition.taskIds);
  const checkTasks=tasks.map(r=>'<label><input type="checkbox" name="taskId" value="'+r.recordId+'">'+esc(r.id)+' <code>'+esc(short(r.recordId))+'</code></label>').join('');
  let outBody=input('label','Decision label','Referral operating decision',{required:true})+
    '<div class="grid">'+select('kind','Decision kind',['consent','ownership','workflow','finding','resource-link','receiving','contact'].map(v=>[v,v]),'ownership')+
    select('outcome','Disposition',['permit','deny','review-required','accepted','resolved','deferred','rejected'].map(v=>[v,v]),'accepted')+'</div>'+
    input('owner','Responsible owner',actor)+input('purpose','Exact permitted exchange purpose')+
    '<div class="field"><span>Original referral Tasks covered</span><div class="checkbox-list">'+checkTasks+'</div></div>'+
    area('reason','Concrete decision and source basis','',{required:true})+
    input('resourceIds','Selected original resource IDs, comma separated','',{help:'For consent, retain original Consent record IDs from the selected source; for other decisions retain exact relevant original resources.'})+
    select('assessmentId','Original assessment for a finding decision',recordOptions('assessments'),selection.assessmentId)+
    input('findingIds','Exact finding IDs, comma separated')+
    select('supersedesId','Prior decision being superseded',recordOptions('decisions'))+
    '<div class="grid">'+input('recordedAt','Decision time with timezone',new Date().toISOString())+
    input('expiresAt','Expiry with timezone, if applicable')+'</div>'+
    area('sourceRefs','Exact original source citations','[]',{code:true})+
    area('relatedRecords','Reviewed many-to-many resource links','[]',{code:true,help:'Each link retains fromRecordId, toRecordId, toEditionId, relationship and reason. Preserve distinct original IDs.'})+
    area('note','Additional scope note');
  out+=panel('Record a responsible source-bound decision',form('decision-form-'+edition.id,outBody,'Save original decision',async f=>{
    const result=await api(R+'/decisions',{label:field(f,'label'),actor:requireActor(),note:field(f,'note'),editionId:edition.id,
      kind:field(f,'kind'),outcome:field(f,'outcome'),owner:field(f,'owner'),purpose:field(f,'purpose'),taskIds:allFields(f,'taskId'),
      resourceIds:field(f,'resourceIds').split(',').map(v=>v.trim()).filter(Boolean),reason:field(f,'reason'),sourceRefs:jsonField(f,'sourceRefs',[]),
      recordedAt:field(f,'recordedAt'),expiresAt:field(f,'expiresAt')||null,supersedesId:field(f,'supersedesId')||null,
      assessmentId:field(f,'assessmentId')||null,findingIds:field(f,'findingIds').split(',').map(v=>v.trim()).filter(Boolean),
      relatedRecords:jsonField(f,'relatedRecords',[])});
    await clearDraft(f);return{message:'Original decision saved with its exact Task, purpose and source scope: '+result.id};
  }), 'Consent originals and an operator’s scoped decision remain separate records. A native write selects the current permitting decision for its exact purpose.');
  return out;
}
async function correctionsView(){
  let out=panel('Original edition comparisons',table(['Comparison','Before / after','Summary','Complete'],state.referral.comparisons.map(r=>[
    esc(r.label),esc(short(r.beforeId))+' → '+esc(short(r.afterId)),esc(pretty(r.summary)),
    '<div class="record-actions">'+action('Inspect',async()=>show('Complete comparison',await recordView('comparisons',r.id)),'link')+
    action('Download full changes',()=>download(R+'/edition-comparisons/'+r.id+'/file','Gravity_Complete_Edition_Changes.json'),'link')+'</div>'])));
  out+=panel('Compare two original editions',form('edition-compare-form',input('label','Comparison label','Original referral edition comparison')+
    '<div class="grid">'+select('beforeId','Original prior edition',recordOptions('editions'),selection.editionId)+
    select('afterId','Original receiving / successor edition',recordOptions('editions'))+'</div>'+
    input('decisionIds','Reviewed resource-link decision IDs, comma separated')+area('note','Comparison note'),
    'Save complete edition comparison',async f=>{
      const r=await api(R+'/edition-comparisons',{label:field(f,'label'),actor:requireActor(),note:field(f,'note'),
        beforeId:field(f,'beforeId'),afterId:field(f,'afterId'),decisionIds:field(f,'decisionIds').split(',').map(s=>s.trim()).filter(Boolean)});
      await clearDraft(f);return {message:'Complete original edition comparison saved: '+r.id};
    }), 'The native graph uses complete qualified original identities. Different logical IDs require an explicit reviewed link; title similarity does not join resources.');
  const edition=selection.editionId?await recordView('editions',selection.editionId):null;
  if(edition){
    const taskRows=await selectedRows(edition.sourceId,edition.taskIds);
    let body=input('label','Successor label',edition.label+' · correction')+
      select('recordId','Exact original referral Task',taskRows.map(r=>[r.recordId,r.id||r.recordId]))+
      input('otherRecordId','Or exact other original resource record ID')+
      '<div class="grid">'+input('path','Exact JSON Pointer','/status')+
      select('action','Correction action',[['replace','Replace existing value'],['add','Add value'],['remove','Remove value']],'replace')+'</div>'+
      area('valueJson','Complete replacement JSON value','"in-progress"',{code:true})+
      area('extraPatches','Additional ordered exact patches','[]',{code:true,help:'Optional array of {recordId,path,action,valueJson}. Every original preimage and complete successor remains retained.'})+
      area('reason','Concrete correction reason','',{required:true})+area('note','Correction note');
    out+=panel('Preview an authored source correction',form('correction-form-'+edition.id,body,'Retain exact correction preview',async f=>{
      const action=field(f,'action'),patch={recordId:field(f,'otherRecordId')||field(f,'recordId'),path:field(f,'path'),action};
      if(action!=='remove')patch.valueJson=field(f,'valueJson');
      const r=await api(R+'/corrections/preview',{label:field(f,'label'),actor:requireActor(),note:field(f,'note'),editionId:edition.id,
        reason:field(f,'reason'),patches:[patch,...jsonField(f,'extraPatches',[])]});
      await clearDraft(f);await show('Exact retained correction preview',r);
      return{message:'Correction preview retained. Review the original before/after values before applying '+r.id+'.'};
    }), 'This creates a new source edition. Existing original source bytes and IDs stay available throughout the receiving history.');
  }
  out+=panel('Retained previews and source successors',table(['Preview','Changes','Request identity','Actions'],state.referral.correctionPreviews.map(r=>[
    esc(r.label),esc(r.changeCount),'<code>'+esc(short(r.requestSha256))+'</code>',
    '<div class="record-actions">'+action('Review values',async()=>show('Exact original correction preview',await recordView('correctionPreviews',r.id)),'link')+
    action('Apply reviewed preview',async()=>{const p=await recordView('correctionPreviews',r.id);const result=await api(R+'/corrections/apply',{previewId:p.id,expectedRequestSha256:p.requestSha256});
      selection.editionId=result.editionId;selection.sourceId=result.sourceId;notice('Original correction applied as successor '+result.editionId);await refreshState();await render();})+'</div>'])));
  out+=table(['Successor','Original edition','Source','Open'],state.referral.corrections.map(r=>[
    esc(r.label),esc(short(r.sourceEditionId)),esc(short(r.sourceId)),action('Complete lineage',()=>openRecord('corrections',r.id),'link')]));
  return out;
}

async function exchangeView(){
  const auth=await api('/api/auth-profiles');
  const connectionRows=state.connections||[],discoveries=state.discoveries||[];
  let out=panel('Selected original connections',table(['Connection','Base / origin','Authentication profile','Native discovery'],connectionRows.map(r=>[
    esc(r.connection.label),esc(r.connection.baseUrl)+'<small class="inline-code">'+esc(r.connection.origin)+'</small>',esc(r.connection.authProfile||'No profile'),
    '<div class="record-actions">'+action('Discover actual capability',async()=>{const d=await api('/api/connections/'+r.id+'/discover',{});notice('Original CapabilityStatement retained: '+d.id);await refreshState();await render();})+
    action('Saved definition',()=>show('Original selected connection',r),'link')+'</div>'])));
  out+=panel('Save a source connection',form('connection-form',input('label','Connection label','Selected referral server',{required:true})+
    input('baseUrl','Actual FHIR base URL','',{required:true})+'<div class="grid">'+
    select('origin','Source classification',[['operator_source','Authorised original source'],['published_sample','Published reference sample']],'operator_source')+
    select('authProfile','Existing local authentication profile',auth.map(p=>[p.name,p.name+' · '+p.type]))+'</div>'+
    input('publisher','Original provider / server owner')+input('sourceUrl','Original setup or source URL')+area('note','Connection purpose'),
    'Save original connection',async f=>{
      const r=await api('/api/connections',{label:field(f,'label'),baseUrl:field(f,'baseUrl'),origin:field(f,'origin'),
        authProfile:field(f,'authProfile')||null,publisher:field(f,'publisher'),sourceUrl:field(f,'sourceUrl'),note:field(f,'note')});
      await clearDraft(f);return {message:'Connection saved. Discover its actual capability before selecting native exchange.'};
    }), 'Authentication remains in the existing local credential-profile file. Original provider responses and request selections are retained in the same workspace.');
  if(discoveries.length)out+=panel('Retained actual capabilities',table(['Discovery','Connection','FHIR / kind','Open'],discoveries.map(r=>[
    esc(short(r.id)),esc(short(r.connectionId)),esc(r.fhirVersion)+' · '+esc(r.kind),
    action('Complete original capability',async()=>show('Original provider capability',await api('/api/discoveries/'+r.id)),'link')])));
  const edition=selection.editionId?await recordView('editions',selection.editionId):null;
  const consentOptions=state.referral.decisions.filter(r=>r.kind==='consent'&&r.editionId===edition?.id).map(r=>[r.id,(r.label||short(r.id))+' · '+r.outcome]);
  if(edition){
    let exchangeBody=input('label','Selected exchange label','Original referral receiving',{required:true})+
      '<div class="grid">'+select('connectionId','Actual selected connection',baseOptions('connections'))+
      select('discoveryId','Actual discovery from this connection',discoveries.map(r=>[r.id,short(r.connectionId)+' · '+r.fhirVersion+' · '+short(r.id)]))+'</div>'+
      '<div class="grid three">'+select('role','Operating role',[['source','Source'],['intermediary','Intermediary'],['target','Target']],'target')+
      select('method','Native method',[['GET','Read original resource'],['PUT','Conditional full-resource update']],'GET')+
      select('resourceType','Resource type',catalogue.exchangeTypes.map(v=>[v,v]),'Task')+'</div>'+
      '<div class="grid">'+input('logicalId','Exact original FHIR logical ID')+input('recordId','Retained original source record ID')+'</div>'+
      area('bodyJson','Complete reviewed update JSON','',{code:true,help:'For PUT, retain the full selected FHIR resource, original resourceType and logical ID. GET has no body.'})+
      input('expectedETag','Expected original quoted ETag, when explicitly selected','',{help:'The receiver reads and records the actual preimage/ETag before a conditional update.'})+
      check('createIfAbsent','Explicitly selected PUT creation with If-None-Match: *')+
      select('consentDecisionId','Current responsible consent review for the exact purpose',consentOptions)+
      input('purpose','Exact recorded exchange purpose')+area('note','Exchange note');
    out+=panel('Prepare a source-selected native exchange',form('exchange-request-form-'+edition.id,exchangeBody,'Save reviewed exchange request',async f=>{
      const method=field(f,'method');const r=await api(R+'/exchange-requests',{label:field(f,'label'),actor:requireActor(),note:field(f,'note'),editionId:edition.id,
        connectionId:field(f,'connectionId'),discoveryId:field(f,'discoveryId'),role:field(f,'role'),method,resourceType:field(f,'resourceType'),
        logicalId:field(f,'logicalId'),recordId:field(f,'recordId')||null,bodyJson:method==='PUT'?field(f,'bodyJson'):null,
        expectedETag:field(f,'expectedETag')||null,createIfAbsent:!!field(f,'createIfAbsent'),
        consentDecisionId:field(f,'consentDecisionId')||null,purpose:field(f,'purpose')});
      await clearDraft(f);return{message:'Exact original exchange request retained: '+r.id};
    }), 'The selected role and endpoint must match the saved topology. Conditional updates retain the original preimage, exact request body, actual provider response and complete resource readback.');
  }
  out+=panel('Advance the same original exchange',form('exchange-advance-form',select('requestId','Saved reviewed request',recordOptions('exchangeRequests'))+
    input('operationId','Original operation UUID',crypto.randomUUID(),{required:true,help:'Keep this identity when continuing after transport loss. The native receiver reconciles its original conditional write before another attempt.'}),
    'Advance original exchange and readback',async f=>{
      await saveFormDraft(f);const result=await api(R+'/exchange-requests/'+enc(field(f,'requestId'))+'/advance',{operationId:field(f,'operationId')});
      if(result.state==='complete')await clearDraft(f);await show('Original exchange result',result);return {message:'Original exchange '+result.id+': '+result.state+' / '+result.phase};
    }));
  out+=table(['Original operation','State / phase','Selected request','Source / files','Continue'],state.referral.exchangeOperations.map(r=>[
    '<code>'+esc(r.id)+'</code>',badge(r.state)+'<small class="inline-code">'+esc(r.phase)+(r.notBefore?' · eligible '+esc(r.notBefore):'')+'</small>',
    esc(short(r.requestId)),(r.sourceId?'<code>'+esc(short(r.sourceId))+'</code>':'')+'<div class="record-actions">'+
      action('Complete result',async()=>show('Original native operation',await api(R+'/exchange-operations/'+r.id)),'link')+
      action('All original files',()=>download(R+'/exchange-operations/'+r.id+'/packet','Gravity_Original_Exchange.zip'),'link')+'</div>',
    r.state==='complete'?'':action('Resume same operation',async()=>{const result=await api(R+'/exchange-requests/'+r.requestId+'/advance',{operationId:r.id});notice('Original exchange '+r.id+': '+result.state);await refreshState();await render();})]));
  out+=panel('Prepare source-native monitoring or history',form('monitoring-form',input('label','Monitoring selection label','Original referral progress window')+
    '<div class="grid">'+select('configurationId','Saved topology',recordOptions('configurations'),state.referral.configurations.at(-1)?.id||'')+
    select('connectionId','Actual connection',baseOptions('connections'))+'</div>'+
    select('discoveryId','Actual selected discovery',discoveries.map(r=>[r.id,short(r.connectionId)+' · '+short(r.id)]))+
    '<div class="grid">'+input('since','Original lower instant · _lastUpdated for search / _since for history')+input('until','Original upper exclusive _lastUpdated instant')+'</div>'+
    '<div class="grid">'+input('owner','Exact Task.owner filter')+input('requester','Exact Task.requester filter')+'</div>'+
    input('statuses','Selected statuses, comma separated')+check('history','Read the complete selected Task history instead of a search')+
    input('taskId','Exact original Task logical ID for history')+area('note','Monitoring purpose'),
    'Save original monitoring request',async f=>{
      const r=await api(R+'/monitoring',{label:field(f,'label'),actor:requireActor(),note:field(f,'note'),configurationId:field(f,'configurationId'),
        connectionId:field(f,'connectionId'),discoveryId:field(f,'discoveryId'),since:field(f,'since')||null,until:field(f,'until')||null,
        owner:field(f,'owner'),requester:field(f,'requester'),statuses:field(f,'statuses').split(',').map(v=>v.trim()).filter(Boolean),
        history:!!field(f,'history'),taskId:field(f,'taskId')||null});
      await clearDraft(f);return {message:'Monitoring uses the original native source request '+r.requestId+'.'};
    }), 'Search retains the selected update window, owner, requester and statuses. Instance history uses its exact Task ID and optional _since instant; upper-window and search-only filters must be empty. Complete original pages, history versions and references stay in the same operation.');
  out+=panel('Advance original source acquisition',form('source-advance-form',select('requestId','Saved native acquisition request',(state.requests||[]).map(r=>[r.id,(r.request?.label||short(r.id))+' · '+short(r.id)]))+
    input('operationId','Original acquisition operation UUID',crypto.randomUUID(),{required:true}),
    'Advance original source request',async f=>{
      await saveFormDraft(f);const r=await api('/api/requests/'+enc(field(f,'requestId'))+'/advance',{operationId:field(f,'operationId')});
      if(r.state==='complete')await clearDraft(f);await show('Original acquisition operation',r);return {message:'Original acquisition '+r.operationId+': '+r.state+' / '+r.phase};
    }));
  out+=table(['Acquisition operation','State / phase','Original source','Open'],(state.operations||[]).map(r=>[
    esc(r.operationId),badge(r.state)+'<small class="inline-code">'+esc(r.phase)+'</small>',esc(short(r.sourceId)),
    action('Original retained operation',async()=>show('Original source acquisition',await api('/api/operations/'+r.operationId)),'link')]));
  return out;
}
async function datasetsView(){
  let out=panel('Original native dataset mappings',table(['Mapping','Identity','Open'],state.plans.map(p=>[
    esc(p.name),'<code>'+esc(p.id)+'</code>',action('Complete mapping',async()=>show('Original saved mapping',await api('/api/plans/'+p.id)),'link')])));
  out+=panel('Prepare a mapping from retained originals',form('mapping-draft-form',select('sourceId','Retained original source',baseOptions('sources'),selection.sourceId)+
    select('resourceType','Resource population',catalogue.exchangeTypes.map(v=>[v,v]),'Task')+input('name','Dataset name','gravity-referrals'),
    'Prepare exact native mapping',async f=>{
      const p=await api('/api/sources/'+enc(field(f,'sourceId'))+'/mapping',{resourceType:field(f,'resourceType'),name:field(f,'name')});
      await dbOp('readwrite',draftKey('mapping-save-form'),{values:[{name:'plan',type:'textarea',value:pretty(p),checked:false}],savedAt:new Date().toISOString()});
      await clearDraft(f);return{message:'The source-derived complete mapping draft is ready below.'};
    }), 'Projection uses the unchanged SF30 native engine. The retained source and exact resource locators accompany every dataset.');
  out+=panel('Review and save a full native mapping',form('mapping-save-form',area('plan','Complete selected mapping JSON','',{code:true,required:true}),
    'Save original native mapping',async f=>{const r=await api('/api/plans',jsonField(f,'plan'));await clearDraft(f);return{message:'Complete mapping saved: '+r.id};}));
  out+=panel('Preview selected original values',form('projection-preview-form',select('sourceId','Original source',baseOptions('sources'),selection.sourceId)+
    select('planId','Saved mapping',baseOptions('plans'))+input('limit','Preview row count',25,{type:'number',min:1,max:250}),
    'Read actual original projection',async f=>{
      const mapping=await api('/api/plans/'+enc(field(f,'planId')));const r=await api('/api/sources/'+enc(field(f,'sourceId'))+'/preview',{plan:mapping.plan,limit:number(f,'limit',25)});
      await show('Original native projection',r);return{message:'Original source projection returned '+r.totalRows+' total selected rows.'};
    }));
  out+=panel('Build the complete native dataset',form('dataset-build-form',select('sourceId','Exact source edition',baseOptions('sources'),selection.sourceId)+
    select('planId','Saved native mapping',baseOptions('plans')),'Build original SF30 dataset',async f=>{
      const r=await api('/api/builds',{sourceId:field(f,'sourceId'),planId:field(f,'planId')});
      await clearDraft(f);return{message:'Original native dataset built: '+r.rowCount+' rows, build '+r.id};
    }));
  out+=table(['Native build','Rows','Original source / mapping','Complete receiving'],state.builds.map(b=>[
    esc(short(b.id)),esc(b.rowCount),esc(short(b.source))+' / '+esc(short(b.plan)),
    '<div class="record-actions">'+action('View native review',()=>show('Complete native build',b),'link')+
    action('Complete customer packet',()=>download('/api/builds/'+b.id+'/packet','Gravity_Complete_Customer_Dataset.zip'),'link')+
    action('Native merchant files',()=>download('/api/builds/'+b.id+'/dataset','Gravity_Native_Merchant_Dataset.zip'),'link')+'</div>']));
  out+=panel('Run the original dataset query',form('dataset-query-form',select('buildId','Completed native build',state.builds.map(r=>[r.id,short(r.id)+' · '+r.rowCount+' rows']))+
    area('query','Exact scalar-string query parameters','{"limit":"20"}',{code:true}),
    'Run native query',async f=>{
      const params=jsonField(f,'query');if(Object.values(params).some(v=>typeof v!=='string'))throw new Error('Native query parameter values must be strings.');
      const r=await api('/api/builds/'+enc(field(f,'buildId'))+'/query?'+new URLSearchParams(params));await show('Complete native query response',r);
      return{message:'Original native query completed.'};
    }));
  out+=panel('Compare original keyed native datasets',form('dataset-comparison-form',
    '<div class="grid">'+select('beforeId','Prior build',state.builds.map(r=>[r.id,short(r.id)]))+select('afterId','Successor build',state.builds.map(r=>[r.id,short(r.id)]))+'</div>',
    'Compare exact original projected cells',async f=>{const r=await api('/api/comparisons',{beforeId:field(f,'beforeId'),afterId:field(f,'afterId')});await show('Original keyed comparison',r);return{message:'Complete native dataset comparison retained.'};}),
    'Select the same saved mapping with explicit original keys on both builds.');
  return out;
}
async function receivingView(){
  let out=panel('Freeze a complete referral handoff',form('handoff-form',
    input('label','Handoff label','Complete referral operating handoff',{required:true})+
    '<div class="grid">'+select('editionId','Exact referral edition',recordOptions('editions'),selection.editionId)+
    select('assessmentId','Frozen complete assessment',recordOptions('assessments'),selection.assessmentId)+'</div>'+
    input('receiver','Receiving organisation or role','',{required:true})+input('purpose','Receiving purpose')+
    select('scope','Complete receiving scope',[['complete-workspace','Full editable workspace and original files']],'complete-workspace')+
    area('note','Operating handover note')+area('sourceRefs','Additional exact receiving source references','[]',{code:true}),
    'Freeze full editable handoff',async f=>{
      const r=await api(R+'/handoffs',{label:field(f,'label'),actor:requireActor(),note:field(f,'note'),editionId:field(f,'editionId'),
        assessmentId:field(f,'assessmentId'),receiver:field(f,'receiver'),purpose:field(f,'purpose'),scope:field(f,'scope'),sourceRefs:jsonField(f,'sourceRefs',[])});
      await clearDraft(f);return{message:'Complete source, review, topology and native exchange handoff frozen: '+r.id};
    }), 'The snapshot includes readable HTML and CSVs, complete source JSON, original requirements, decisions, datasets and saved conditional exchange receipts.');
  out+=table(['Frozen handoff','Receiver / scope','Referrals','Complete delivery'],state.referral.handoffs.map(r=>[
    esc(r.label),esc(r.receiver)+'<small class="inline-code">'+esc(r.scope)+'</small>',esc(r.taskCount),
    '<div class="record-actions">'+action('Complete editable handoff',()=>download(R+'/handoffs/'+r.id+'/packet','Gravity_Complete_Referral_Handoff.zip'),'link')+
    action('Original snapshot',()=>openRecord('handoffs',r.id),'link')+'</div>']));
  out+='<div class="grid">'+panel('Complete editable workspace','<p>Download every original source, authored record, full native dataset and retained operation as one reopenable workspace. The receiver preserves the original workspace UUID.</p>'+
    action('Download complete editable workspace',()=>download(R+'/workspace/packet','Gravity_Complete_Editable_Workspace.zip'),'primary'))+
    panel('Prepare a retained delivery file',form('export-prepare-form',select('kind','Original file selection',[
      ['workspace','Complete editable workspace'],['handoff','Complete frozen handoff'],['assessment','Complete assessment'],
      ['comparison','Complete edition changes'],['exchange-operation','Complete original exchange custody']],'workspace')+
      input('id','Exact selected record or original operation ID')+input('label','File label','Gravity original receiving'),
      'Prepare complete native file',async f=>{const v={kind:field(f,'kind'),label:field(f,'label')};if(v.kind!=='workspace')v.id=field(f,'id');
        const r=await api(R+'/exports',v);await clearDraft(f);await show('Complete original delivery descriptor',r);
        return{message:'Complete delivery file retained as original artifact '+r.artifact.id};}))+'</div>';
  out+=panel('Attach an actual receiving result',form('receiving-artifact-form',input('label','Result label','Original receiving result')+
    '<label class="field"><span>Complete original result file</span><input name="file" type="file" required></label>',
    'Retain complete receiving file',async f=>{const file=$('input[type=file]',f).files[0];if(!file)throw new Error('Select the complete original result file.');
      const r=await api('/api/artifacts',file,{headers:{'X-Artifact-Name':enc(file.name),'X-Artifact-Label':enc(field(f,'label')),'X-Artifact-Content-Type':file.type||'application/octet-stream'}});
      await clearDraft(f);return{message:'Complete receiving result retained: '+r.id};}));
  out+=panel('Record actual handoff receiving',form('receiving-result-form',input('label','Receiving record label','Original handoff receiving')+
    select('handoffId','Exact frozen handoff',recordOptions('handoffs'))+input('receiver','Actual receiver','',{required:true})+
    select('state','Actual receiving disposition',[['received','Received'],['accepted','Accepted'],['needs-correction','Needs correction'],['rejected','Rejected']],'received')+
    select('artifactId','Complete retained receiving result',baseOptions('artifacts'))+input('destinationObjectId','Exact original destination object')+
    input('operationId','Original receiving operation ID',crypto.randomUUID(),{required:true})+
    input('receivedAt','Actual receiving time with timezone',new Date().toISOString())+
    select('correctionOf','Prior receiving result being corrected',recordOptions('receivings'))+
    area('note','Observed result and continuation')+area('sourceRefs','Original receiving citations','[]',{code:true}),
    'Save actual receiving result',async f=>{
      await saveFormDraft(f);const r=await api(R+'/receivings',{label:field(f,'label'),actor:requireActor(),note:field(f,'note'),
        handoffId:field(f,'handoffId'),receiver:field(f,'receiver'),state:field(f,'state'),artifactId:field(f,'artifactId')||null,
        destinationObjectId:field(f,'destinationObjectId'),operationId:field(f,'operationId'),receivedAt:field(f,'receivedAt'),
        correctionOf:field(f,'correctionOf')||null,sourceRefs:jsonField(f,'sourceRefs',[])});
      await clearDraft(f);return{message:'Original receiving result saved: '+r.id};
    }));
  out+=table(['Receiving','Original handoff','Receiver','State / destination','Open'],state.referral.receivings.map(r=>[
    esc(r.label),esc(short(r.handoffId)),esc(r.receiver),badge(r.state)+'<small class="inline-code">'+esc(r.destinationObjectId)+'</small>',
    action('Complete result',()=>openRecord('receivings',r.id),'link')]));
  out+=panel('Retained complete delivery files',table(['Name','Label','Bytes','Complete original'],state.artifacts.map(r=>[
    esc(r.name),esc(r.label),esc(r.bytes),action('Download',()=>download('/api/artifacts/'+r.id+'/file',r.name),'link')])));
  out+=panel('Reopen a complete original workspace',form('workspace-receive-form',
    select('kind','Original packet kind',[['workspace','Complete editable workspace'],['handoff','Complete frozen referral handoff']],'workspace')+
    '<label class="field"><span>Complete original receiving ZIP</span><input type="file" name="file" accept=".zip" required></label>',
    'Receive the original complete workspace',async f=>{const file=$('input[type=file]',f).files[0];if(!file)throw new Error('Select the complete original receiving ZIP.');
      const route=field(f,'kind')==='workspace'?R+'/workspace/packet':R+'/handoffs/receive';
      const r=await api(route,file);await clearDraft(f);return{message:'Complete receiving reconstructed original workspace '+r.workspaceId};}),
    'Use a fresh empty receiving workspace, or continue the identical archive already being received. Every original file and native record is verified and reopened under its original identity.');
  return out;
}
async function guidanceView(){
  const manifest=await api(R+'/guidance');
  let out='<div class="profile-meta"><span>Gravity STU3 3.0.0</span><span>FHIR R4 4.0.1</span><span>191 complete original files</span><span>57 requirements · 24 operating field reviews</span></div>';
  out+=panel('Complete primary source', '<p>The installed source packet retains the complete original HL7 files, exact original content hashes and publication version. The reviewed operator mappings are carried separately in each saved review.</p>'+
    action('Download every original source file and index',()=>download(R+'/guidance/packet','Gravity_Complete_Original_Source.json'),'primary')+
    '<div class="controls">'+action('Full original requirement and field profile',()=>show('Complete Gravity source profile',profile))+'</div>');
  out+=table(['Original source path','Bytes','Source identity','Open'],manifest.files.map(f=>[
    esc(f.path),esc(f.bytes),'<code>'+esc(short(f.sha256))+'</code>',
    action('Complete original',async()=>{const response=await api(R+'/guidance/file?name='+enc(f.path),undefined,{binary:true});await show(f.path,await response.text());},'link')]));
  out+=panel('Original operating and monitoring guidance','<pre>'+esc(pretty(profile.monitoring))+'</pre>');
  return out;
}
const viewFns={queue:queueView,sources:sourcesView,editions:editionsView,requirements:requirementsView,topology:topologyView,
  decisions:decisionsView,corrections:correctionsView,exchange:exchangeView,datasets:datasetsView,receiving:receivingView,guidance:guidanceView};
const titles={queue:'Referral queue',sources:'Original sources',editions:'Referral editions',requirements:'Requirements & fields',
  topology:'Actors & servers',decisions:'Decisions & consent',corrections:'Corrections & history',exchange:'Native exchange',
  datasets:'Datasets & queries',receiving:'Handoffs & receiving',guidance:'Source guidance'};
async function render(){
  const epoch=++renderEpoch;$('#content').setAttribute('aria-busy','true');actions=new Map();forms=new Map();actionSeq=0;
  $('#title').textContent=titles[section];$$('[data-nav]').forEach(b=>b.setAttribute('aria-current',b.dataset.nav===section?'page':'false'));
  const markup=await viewFns[section]();if(epoch!==renderEpoch)return;
  $('#content').innerHTML=markup;await restoreDrafts();
  if(busy)$$('button').forEach(b=>b.disabled=true);
  $('#content').setAttribute('aria-busy','false');document.body.dataset.ready='true';
}
async function navigate(next){
  if(!viewFns[next])return;
  await flushDrafts();section=next;sessionStorage.setItem('gravity.section.'+state.workspaceId,section);await render();
}
document.addEventListener('submit',e=>{
  const f=e.target;if(!(f instanceof HTMLFormElement)||!f.matches('[data-native-form]'))return;
  e.preventDefault();const handler=forms.get(f.id);if(!handler)return;
  run(async()=>{await flushDrafts();return handler(f);}).catch(()=>{});
});
document.addEventListener('input',e=>{
  const f=e.target.closest('form[data-native-form]');if(!f)return;
  if(e.target.type==='file'){const n=$('[data-draft-note]',f);if(n)n.textContent='Selected local file; retain it before leaving this view.';return;}
  dirty.add(f.id);pendingDraft=pendingDraft.then(()=>saveFormDraft(f)).catch(err=>{notice('Local draft save failed: '+err.message,'error');});
});
document.addEventListener('click',e=>{
  const button=e.target.closest('button');if(!button)return;
  if(button.dataset.nav){if(!busy)navigate(button.dataset.nav).catch(err=>notice(err.message,'error'));return;}
  const callback=actions.get(button.dataset.action);if(callback)run(callback,{rerender:false}).catch(()=>{});
});
$('#refresh').addEventListener('click',()=>run(async()=>{await flushDrafts();await refreshState();notice('Original saved workspace refreshed.');}).catch(()=>{}));
$('#close-detail').addEventListener('click',()=>$('#detail').close());
window.addEventListener('beforeunload',e=>{if(busy||dirty.size){e.preventDefault();e.returnValue='';}});
(async()=>{
  try{
    await bootDB();
    if(!token)throw new Error('Open the current private operator URL from the original workspace startup.');
    [catalogue,profile,nativeCatalogue]=await Promise.all([api(R+'/catalogue'),api(R+'/profile'),api('/api/catalogue')]);
    await refreshState();section=sessionStorage.getItem('gravity.section.'+state.workspaceId)||'queue';if(!viewFns[section])section='queue';
    $('#draft-state').textContent='Drafts are retained on this device';
    await render();
  }catch(error){notice(error.message,'error');$('#content').setAttribute('aria-busy','false');document.body.dataset.ready='error';$('#content').innerHTML='<div class="empty">The original workspace could not be opened. Reuse the private URL from its current native startup.</div>';}
})();
