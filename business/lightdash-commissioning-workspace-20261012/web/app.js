const $=id=>document.getElementById(id);
const S={state:null,configured:false,sourceEditionId:null,sourceManifest:null,draftManifest:null,editor:null,buffers:new Map(),comparison:null,reviewed:new Set(),operationId:null,loading:false};
const token=document.querySelector('meta[name="workspace-token"]').content;
const fmt=n=>Number(n??0).toLocaleString();
const time=value=>value?new Date(value).toLocaleString():'—';
const short=value=>value?value.slice(0,12):'—';
function node(tag,attrs={},children=[]) {
  const el=document.createElement(tag);
  for(const [key,value]of Object.entries(attrs)){if(key==='text')el.textContent=value;else if(key.startsWith('on')&&typeof value==='function')el.addEventListener(key.slice(2),value);else if(value!==false&&value!=null)el.setAttribute(key,value===true?'':value);}
  for(const child of [children].flat())if(child!=null)el.append(typeof child==='string'?document.createTextNode(child):child);
  return el;
}
function replace(id,children=[]){$(id).replaceChildren(...[children].flat());}
function flash(message,error=false){$('notice').hidden=false;$('notice').classList.toggle('error',error);$('notice').textContent=message;}
function task(fn){return async event=>{event?.preventDefault();try{await fn(event);}catch(error){flash(error.message,true);}};}
function button(label,fn,secondary=true){return node('button',{type:'button',class:secondary?'secondary':'',onclick:task(fn),text:label});}
function cell(text){return node('td',{text:String(text??'—')});}
function emptyRow(message,columns){return node('tr',{},node('td',{class:'empty',colspan:columns,text:message}));}
function badge(value){return node('span',{class:'badge'+(['SUCCEEDED','FAILED','NEEDS_RECONCILIATION'].includes(value)?' strong':''),text:value??'—'});}
function parseField(id){try{return JSON.parse($(id).value);}catch{throw new Error('Enter complete valid JSON in '+$(id).closest('label').firstChild.textContent.trim()+'.');}}
async function api(route,data) {
  const options={headers:{}};
  if(data!==undefined){options.method='POST';options.headers={'Content-Type':'application/json','X-Workspace-Token':token};options.body=JSON.stringify({...data,expectedRevision:data.expectedRevision??S.state?.metadata.revision});}
  const response=await fetch(route,options);
  const value=await response.json();
  if(!response.ok)throw Object.assign(new Error(value.error?.message??'Workspace request failed.'),{code:value.error?.code,status:response.status});
  return value;
}
function editionName(id){const edition=S.state?.editions.find(e=>e.id===id);return edition?edition.label+' · '+short(edition.id):'No edition selected';}
function populate(id,values,selected,label) {
  const el=$(id),prior=el.value;
  el.replaceChildren(...values.map(value=>node('option',{value:value.id,text:label(value)})));
  if(values.some(v=>v.id===prior))el.value=prior;
  else if(selected&&values.some(v=>v.id===selected))el.value=selected;
}
function show(section) {
  document.querySelectorAll('[data-section]').forEach(el=>el.hidden=el.dataset.section!==section);
  document.querySelectorAll('[data-view]').forEach(el=>{if(el.dataset.view===section)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
  if(section==='draft')loadDraft().catch(error=>flash(error.message,true));
}
function sourceURL(path,{editionId=S.sourceEditionId,draft=false,download=false}={}) {
  const params=new URLSearchParams({path});
  if(editionId)params.set('editionId',editionId);
  if(draft)params.set('draft','true');
  if(download)params.set('download','true');
  return '/api/source?'+params;
}
function renderState() {
  const state=S.state,meta=state.metadata;
  $('workspace-name').textContent=meta.label;
  $('workspace-revision').textContent='Revision '+meta.revision;
  $('edition-count').textContent=fmt(state.editions.length);
  $('draft-count').textContent=fmt(state.drafts.length);
  $('operation-count').textContent=fmt(state.operations.length);
  $('review-count').textContent=fmt(state.reviews.length);
  replace('selection-summary',Object.entries({
    'Source baseline':editionName(meta.baselineEditionId),'Selected candidate':editionName(meta.selectedEditionId),
    'Lightdash instance':meta.connection.origin??'Configure the selected instance',
    'Project UUID':meta.connection.projectUuid??'Choose the actual project',
    'dbt source':meta.connection.source?meta.connection.source.name+' · '+meta.connection.source.uuid:'Default project source',
    'Working draft':meta.draft.id??'Create a draft from a retained edition'
  }).flatMap(([label,value])=>[node('dt',{text:label}),node('dd',{text:value})]));
  if(!S.configured) {
    $('config-label').value=meta.label;
    $('config-connection').value=JSON.stringify(Object.keys(meta.connection).length?meta.connection:{
      id:'customer-project',origin:'https://app.lightdash.cloud',projectUuid:'',tokenEnv:'LIGHTDASH_API_KEY',allowHttp:false,source:null,
      runtime:{node:'/usr/bin/node',cliEntry:'/opt/lightdash-cli/node_modules/@lightdash/cli/dist/index.js',python:'/usr/bin/python3',dbt:'/opt/dbt/bin/dbt'},
      environment:{PGHOST:'PGHOST',PGPORT:'PGPORT',PGUSER:'PGUSER',PGPASSWORD:'PGPASSWORD',PGDATABASE:'PGDATABASE'}
    },null,2);
    $('config-edition').value=JSON.stringify(meta.editionSettings,null,2);
    S.configured=true;
  }
  $('engine-description').textContent=JSON.stringify(state.engine,null,2);
  replace('editions',state.editions.length?state.editions.map(e=>{
    const choices=node('div',{class:'row'},[
      button('Browse',()=>loadSource(e.id)),
      button(e.id===meta.baselineEditionId?'Baseline':'Use as baseline',async()=>{await api('/api/selection',{baselineId:e.id});await refresh();}),
      button(e.id===meta.selectedEditionId?'Selected':'Select candidate',async()=>{await api('/api/selection',{selectedId:e.id});await refresh();}),
      button('Draft',async()=>{await api('/api/draft',{editionId:e.id});await refresh();show('draft');})
    ]);
    return node('tr',{},[node('td',{},[node('strong',{text:e.label}),node('small',{text:e.id}),node('small',{text:e.note??''})]),cell(fmt(e.fileCount)),cell(fmt(e.bytes)),cell(time(e.createdAt)),node('td',{},choices)]);
  }):emptyRow('Import the complete source project to create a baseline.',5));
  for(const id of ['new-draft-edition','review-baseline','review-candidate','operation-edition']){
    populate(id,state.editions,id==='review-baseline'?meta.baselineEditionId:meta.selectedEditionId,e=>e.label+' · '+short(e.id));
  }
  populate('draft-selection',state.drafts,meta.draft.id,d=>short(d.id)+' · '+editionName(d.baseEditionId)+' · '+fmt(d.changeCount)+' file edits');
  if(meta.draft.id)$('draft-selection').value=meta.draft.id;
  replace('operations',state.operations.length?state.operations.map(o=>node('tr',{},[
    node('td',{},[button(o.id,()=>loadOperation(o.id)),node('small',{text:editionName(o.editionId)})]),cell(o.action),node('td',{},badge(o.status)),cell(time(o.updatedAt))
  ])):emptyRow('Prepare an operation against a retained source edition.',4));
  replace('handovers',(state.handovers??[]).length?state.handovers.map(h=>node('tr',{},[
    cell(h.id),cell(time(h.createdAt)),node('td',{},badge(h.state)),node('td',{},node('div',{class:'row'},[
      ...(h.state==='SUCCEEDED'?[node('a',{class:'button secondary',href:'/api/handover?'+new URLSearchParams({id:h.id,download:'true'}),text:'Download'})]:[]),
      button('Inspect original archive',async()=>{await api('/api/handover/inspect',{id:h.id});await packagePoll(h.id);})
    ]))
  ])):emptyRow('Build a complete portable handover when the selected workspace is ready.',4));
  replace('review-history',state.reviews.slice().reverse().map(r=>node('div',{},[node('h3',{text:r.reviewedBy+' · '+time(r.createdAt)}),node('p',{text:r.note}),node('p',{class:'help',text:editionName(r.baselineId)+' → '+editionName(r.candidateId)+' · '+r.id})])));
}
async function refresh() {
  if(S.loading)return;
  S.loading=true;
  try{S.state=await api('/api/state');renderState();}finally{S.loading=false;}
}
async function loadSource(id) {
  S.sourceEditionId=id;S.sourceManifest=await api('/api/manifest?editionId='+encodeURIComponent(id));
  $('source-browser-title').textContent='Source inventory · '+editionName(id);
  renderSourceFiles();show('source');
}
function renderSourceFiles() {
  const filter=$('source-filter').value.toLowerCase();
  const files=(S.sourceManifest?.files??[]).filter(f=>f.path.toLowerCase().includes(filter));
  replace('source-files',files.length?files.map(f=>node('tr',{},[
    node('td',{},button(f.path,async()=>{
      $('source-file-title').textContent=f.path;
      $('source-download').href=sourceURL(f.path,{download:true});$('source-download').hidden=false;
      try{const source=await api(sourceURL(f.path));$('source-content').textContent=source.content;}catch(error){$('source-content').textContent=error.message;}
    })),cell(fmt(f.bytes))
  ])):emptyRow(S.sourceManifest?'No paths match this filter.':'Choose a retained edition.',2));
}
async function loadDraft() {
  S.draftManifest=await api('/api/manifest?draft=true');
  $('draft-title').textContent=S.draftManifest?'Draft '+short(S.draftManifest.id)+' · '+fmt(S.draftManifest.files.length)+' files':'Create or select a working draft';
  renderDraftFiles();
}
function renderDraftFiles() {
  const filter=$('draft-filter').value.toLowerCase(),manifest=S.draftManifest;
  const changes=new Map((manifest?.changes??[]).map(c=>[c.path,c.change]));
  const files=(manifest?.files??[]).filter(f=>f.path.toLowerCase().includes(filter));
  replace('draft-files',files.length?files.map(f=>node('tr',{},[
    node('td',{},button(f.path,()=>openEditor(f.path))),
    node('td',{},[node('span',{text:changes.get(f.path)??'Original'}),node('a',{href:sourceURL(f.path,{draft:true,editionId:null,download:true}),text:' ↓',title:'Download complete file'})])
  ])):emptyRow(manifest?'No source paths match.':'Create a draft from an edition first.',2));
}
function editorKey(draftId,file){return draftId+'\0'+file;}
function retainEditor() {
  if(!S.editor){if(!S.draftManifest)return;S.editor={draftId:S.draftManifest.id,path:'',content:'',sha256:null,dirty:false};}
  const current={...S.editor,path:$('editor-path').value,content:$('editor-content').value,dirty:true};
  if(current.path!==S.editor.path)current.sha256=null;
  S.editor=current;
  if(current.path)S.buffers.set(editorKey(current.draftId,current.path),current);
  $('editor-status').textContent='Unsaved complete text · '+new TextEncoder().encode(current.content).length.toLocaleString()+' bytes';
}
async function openEditor(file) {
  if(!S.draftManifest)throw new Error('Create or select a draft first.');
  const key=editorKey(S.draftManifest.id,file);
  let value=S.buffers.get(key);
  if(!value){const source=await api(sourceURL(file,{draft:true,editionId:null}));value={...source,draftId:S.draftManifest.id,dirty:false};}
  S.editor=value;$('editor-path').readOnly=true;$('editor-path').value=file;$('editor-content').value=value.content;
  $('editor-status').textContent=(value.dirty?'Unsaved complete text':'Saved source')+' · '+fmt(value.bytes??new TextEncoder().encode(value.content).length)+' bytes · '+short(value.sha256);
}
function newFile() {
  if(!S.draftManifest)throw new Error('Create or select a draft first.');
  S.editor={draftId:S.draftManifest.id,path:'',content:'',sha256:null,dirty:false};
  $('editor-path').readOnly=false;$('editor-path').value='';$('editor-content').value='';$('editor-status').textContent='New text file. Enter its complete project-relative path.';$('editor-path').focus();
}
async function saveFile(remove=false) {
  if(!S.editor){if(!S.draftManifest)throw new Error('Create or select a draft first.');S.editor={draftId:S.draftManifest.id,path:$('editor-path').value,content:$('editor-content').value,sha256:null,dirty:true};}
  const savedEditor={...S.editor,path:$('editor-path').value,content:$('editor-content').value};
  if(!savedEditor.path)throw new Error('Enter a project file path.');
  const result=await api('/api/draft/file',{path:savedEditor.path,content:savedEditor.content,remove,
    expectedFileSha256:savedEditor.sha256,expectedDraftId:savedEditor.draftId});
  S.buffers.delete(editorKey(savedEditor.draftId,savedEditor.path));
  if(remove){S.editor=null;$('editor-path').value='';$('editor-content').value='';$('editor-status').textContent='Removed from this draft; its original source is retained.';}
  else if(S.editor?.draftId===savedEditor.draftId&&$('editor-path').value===savedEditor.path){
    const changedWhileSaving=$('editor-content').value!==savedEditor.content;
    S.editor={...savedEditor,...result.file,content:$('editor-content').value,dirty:changedWhileSaving};
    if(changedWhileSaving)S.buffers.set(editorKey(S.editor.draftId,S.editor.path),S.editor);
    $('editor-status').textContent=changedWhileSaving?'Earlier complete text saved; newer edits remain unsaved.':'Complete file saved · '+short(result.file.sha256);
  }
  await refresh();await loadDraft();flash(remove?'File removed from the selected draft.':'Complete source file saved.');
}
async function compare() {
  S.comparison=await api('/api/compare?'+new URLSearchParams({baselineId:$('review-baseline').value,candidateId:$('review-candidate').value}));
  S.reviewed=new Set();
  $('comparison-title').textContent=fmt(S.comparison.changes.length)+' changed files · '+short(S.comparison.baselineSha256)+' → '+short(S.comparison.candidateSha256);
  replace('changes',S.comparison.changes.length?S.comparison.changes.map(change=>node('tr',{},[
    node('td',{},[button(change.path,async()=>{
      $('diff-title').textContent=change.path+' · '+change.change;
      const read=async(editionId,present)=>{
        if(!present)return '(File absent in this edition)';
        try{return (await api(sourceURL(change.path,{editionId}))).content;}catch(error){return error.message;}
      };
      const [before,after]=await Promise.all([read(S.comparison.baselineId,change.before),read(S.comparison.candidateId,change.after)]);
      $('diff-before').value=before;$('diff-after').value=after;
    }),node('label',{class:'check'},[node('input',{type:'checkbox',onchange:event=>event.target.checked?S.reviewed.add(change.path):S.reviewed.delete(change.path)}),'Reviewed source'])]),
    cell(change.change),cell(change.before?fmt(change.before.bytes)+' bytes · '+short(change.before.sha256):'Absent'),cell(change.after?fmt(change.after.bytes)+' bytes · '+short(change.after.sha256):'Absent')
  ])):emptyRow('The two retained editions have the same complete source inventory.',4));
}
const actionInputs={
  'dbt-deps':{},'dbt-build':{},compile:{},
  'start-preview':{name:'commissioning-jaffle',expiresInHours:24,skipCopyContent:false},
  validate:{severity:'error',only:['tables','charts','dashboards']},
  deploy:{},download:{},
  upload:{content:{directory:'',manifestFile:'',manifestSha256:'',sourceProjectUuid:'',sourceOperationId:''},applySpaceAccess:false},
  'stop-preview':{name:'',previewProjectUuid:'',startOperationId:''}
};
const actionHelp={
  'dbt-deps':'Install the dependencies declared by this exact dbt source. The original runtime writes only into this operation’s prepared work directory.',
  'dbt-build':'Build and validate this original dbt project against the selected warehouse. Optional select, exclude and vars use the native contract.',
  compile:'Run the original Lightdash compilation for the selected complete edition.',
  'start-preview':'Start a retained preview using the original upstream command. The native result must identify the actual preview project before it can be used.',
  validate:'Run the original validation job. To validate a sealed preview, enter its actual projectUuid from the retained preview result.',
  deploy:'Deploy the selected source to the selected project or an explicitly identified preview. Review the intended source and target before running.',
  download:'Back up the complete original Lightdash content from the selected project.',
  upload:'Use an original content download’s directory, manifest and source operation. The original CLI performs the upload and retains its backup and recovery information.',
  'stop-preview':'Delete only the exact preview created by the named original start operation. Copy its actual name and UUID from that retained result.'
};
function newOperationId(){$('operation-id').value='lightdash-'+$('operation-action').value+'-'+crypto.randomUUID();}
function actionChanged(){$('operation-input').value=JSON.stringify(actionInputs[$('operation-action').value],null,2);$('operation-help').textContent=actionHelp[$('operation-action').value];newOperationId();}
async function loadOperation(id) {
  const operation=await api('/api/operation?id='+encodeURIComponent(id));
  S.operationId=id;$('operation-title').textContent=operation.id;$('operation-state').textContent=operation.action+' · '+operation.status+' · '+editionName(operation.editionId);
  $('operation-detail').textContent=JSON.stringify({plan:operation.plan,result:operation.nativeResult??null,lastError:operation.lastError??null},null,2);
  $('run-operation').disabled=['RUNNING','SUCCEEDED','FAILED'].includes(operation.status);
  $('inspect-operation').disabled=false;
  replace('content-exports',(operation.receivingContentExports??[]).length?[
    node('h3',{text:'Original content exports'}),
    ...(operation.receivingContentExports??[]).map(content=>content.error?node('p',{class:'help',text:content.error.message}):node('div',{class:'row'},[
      node('p',{class:'help',text:content.directory}),
      button('Use for content upload',()=>{
        $('operation-action').value='upload';actionChanged();$('operation-edition').value=operation.editionId;
        $('operation-input').value=JSON.stringify({content,applySpaceAccess:false},null,2);
        flash('Original complete export selected. Prepare a new command plan for the intended target.');
      })
    ]))
  ]:[]);
  const artifacts=Array.isArray(operation.nativeResult?.artifacts)?operation.nativeResult.artifacts:[];
  replace('artifacts',artifacts.length?artifacts.map(a=>node('tr',{},[
    node('td',{},node('a',{href:'/api/artifact?'+new URLSearchParams({operationId:id,id:a.id}),text:a.relativePath??a.path??a.id})),
    cell(a.role),cell(a.scope),cell(fmt(a.bytes))
  ])):emptyRow('Native artifact identities appear when the original operation returns them.',4));
  return operation;
}
async function nativeRun(inspect) {
  if(!S.operationId)throw new Error('Select a retained operation.');
  const id=S.operationId;
  await api(inspect?'/api/inspect':'/api/execute',{operationId:id});
  flash((inspect?'Inspecting':'Running')+' original operation '+id+'. Its state remains attached to that operation.');
  await refresh();await loadOperation(id);
}
async function packagePoll(id) {
  const selected=await api('/api/handover?id='+encodeURIComponent(id));
  if(['RUNNING','ACCEPTED'].includes(selected.state)) {
    replace('package-result',node('p',{text:'Building complete handover '+id+'…'}));
    setTimeout(()=>packagePoll(id).catch(error=>flash(error.message,true)),2000);return;
  }
  const result=selected.result??selected;
  if(selected.state==='FAILED')throw new Error(selected.error?.message??'Handover did not complete. Its original output remains in the handover directory.');
  replace('package-result',[
    node('a',{class:'button',href:'/api/handover?'+new URLSearchParams({id,download:'true'}),text:'Download complete handover'}),
    node('pre',{text:JSON.stringify(result,null,2)})
  ]);
  await refresh();flash('Complete handover is ready.');
}
document.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>show(el.dataset.view)));
$('refresh').addEventListener('click',task(async()=>{await refresh();if(S.operationId)await loadOperation(S.operationId);flash('Current workspace loaded.');}));
$('configuration').addEventListener('submit',task(async()=>{
  await api('/api/configure',{label:$('config-label').value,connection:parseField('config-connection'),editionSettings:parseField('config-edition')});
  S.configured=false;await refresh();flash('Connection references and project selection saved.');
}));
$('use-jaffle-layout').addEventListener('click',()=>{$('config-edition').value=JSON.stringify({projectDir:'dbt',profilesDir:'profiles',profile:'jaffle_shop',target:'jaffle',includeProfileFiles:true},null,2);flash('Original Jaffle source layout selected. Save configuration before importing its complete source directory.');});
$('intake').addEventListener('submit',task(async()=>{
  const result=await api('/api/intake',{projectRoot:$('source-root').value,label:$('source-label').value,note:$('source-note').value,operationId:$('source-operation').value});
  await refresh();await loadSource(result.edition.id);flash('Complete source edition retained: '+fmt(result.edition.fileCount)+' files.');
}));
$('source-filter').addEventListener('input',renderSourceFiles);
$('draft-filter').addEventListener('input',renderDraftFiles);
$('open-draft').addEventListener('click',task(async()=>{await api('/api/draft/select',{id:$('draft-selection').value});await refresh();await loadDraft();}));
$('new-draft').addEventListener('click',task(async()=>{await api('/api/draft',{editionId:$('new-draft-edition').value});await refresh();await loadDraft();flash('A new draft is ready. Previous drafts remain available.');}));
$('editor-path').addEventListener('input',retainEditor);$('editor-content').addEventListener('input',retainEditor);
$('editor').addEventListener('submit',task(()=>saveFile(false)));
$('remove-file').addEventListener('click',task(()=>saveFile(true)));
$('new-file').addEventListener('click',task(newFile));
$('seal').addEventListener('submit',task(async()=>{
  const draftId=S.draftManifest?.id;
  if(!draftId)throw new Error('Create or select a draft first.');
  for(const [key,buffer]of S.buffers){
    if(buffer.draftId!==draftId||!buffer.dirty)continue;
    const saved=await api('/api/draft/file',{path:buffer.path,content:buffer.content,expectedFileSha256:buffer.sha256,expectedDraftId:draftId});
    S.state.metadata=saved.metadata;S.buffers.delete(key);
    if(S.editor?.draftId===draftId&&S.editor.path===buffer.path)S.editor={...S.editor,...saved.file,dirty:false};
  }
  const result=await api('/api/seal',{label:$('candidate-label').value,note:$('candidate-note').value,expectedDraftId:S.draftManifest?.id});
  await refresh();$('review-candidate').value=result.edition.id;show('review');await compare();flash('Complete candidate edition sealed. Review its source changes before planning a native operation.');
}));
$('comparison').addEventListener('submit',task(compare));
$('save-review').addEventListener('submit',task(async()=>{
  if(!S.comparison)throw new Error('Compare the selected editions first.');
  await api('/api/review',{baselineId:S.comparison.baselineId,candidateId:S.comparison.candidateId,reviewedBy:$('reviewer').value,note:$('review-note').value,
    decisions:[...S.reviewed].sort().map(path=>({path,decision:'REVIEWED_SOURCE'}))});
  await refresh();flash('Source review saved against both complete editions and the selected connection.');
}));
$('operation-action').addEventListener('change',actionChanged);
$('new-operation-id').addEventListener('click',newOperationId);
$('operation-plan').addEventListener('submit',task(async()=>{
  const result=await api('/api/plan',{operationId:$('operation-id').value,action:$('operation-action').value,editionId:$('operation-edition').value,input:parseField('operation-input')});
  await refresh();await loadOperation(result.operation.id);flash('Original command plan prepared. Review its commands, source and target before running.');
}));
$('run-operation').addEventListener('click',task(()=>nativeRun(false)));
$('inspect-operation').addEventListener('click',task(()=>nativeRun(true)));
$('package').addEventListener('submit',task(async()=>{
  const result=await api('/api/handover',{includeOperatorPrivate:$('include-private').checked});
  await packagePoll(result.id);
}));
$('source-operation').value='lightdash-source-'+crypto.randomUUID();
actionChanged();
await refresh().catch(error=>flash(error.message,true));
setInterval(async()=>{
  if(!S.state?.operations.some(o=>['RUNNING','BUSY'].includes(o.status)))return;
  try{await refresh();if(S.operationId)await loadOperation(S.operationId);}catch{}
},3000);
