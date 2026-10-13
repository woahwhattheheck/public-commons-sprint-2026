const STORAGE='curriculum-migration-workbench.v1';
let workspace, originalWorkspace, selected, tab='case', search='', page=0, contractId=null, curriculumPanel=null;
const $=s=>document.querySelector(s);
const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=x=>JSON.stringify(x,null,2);
const now=()=>({actor:$('#engineer').value.trim(),at:new Date().toISOString()});
const uid=prefix=>prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
function save(next,message='Saved') {
  workspace=Curriculum.receiveCurriculumWorkspace(next);
  try {localStorage.setItem(STORAGE,JSON.stringify(workspace));$('#storage').textContent='Saved in this browser';}
  catch(e){$('#storage').textContent='Browser storage is unavailable — export the workspace to keep this edition.';}
  render();notice(message);
}
function notice(message,error=false){const n=$('#notice');n.textContent=message;n.className=error?'notice error':'notice';}
function action(fn){return async()=>{try{await fn();}catch(e){notice(e.message||String(e),true);}};}
function download(name,content,type='application/json'){
 const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
function selectedCase(){return workspace.cases.find(c=>c.id===selected);}
function option(value,label,chosen){return '<option value="'+html(value)+'"'+(value===chosen?' selected':'')+'>'+html(label)+'</option>';}
function field(name,label,value,type='text'){return '<label>'+html(label)+'<input id="'+name+'" type="'+type+'" value="'+html(value)+'"></label>';}
function textarea(name,label,value,rows=8){return '<label>'+html(label)+'<textarea id="'+name+'" rows="'+rows+'" spellcheck="false">'+html(value)+'</textarea></label>';}
function sourceLabel(r){return r?html(r.provenance.kind)+' · '+html(r.provenance.label):'Awaiting returned output';}
function render(){
 if(curriculumPanel&&tab!=='curriculum'){curriculumPanel.destroy();curriculumPanel=null;}
 $('#workspace-name').textContent=workspace.name;
 $('#revision').textContent='Revision '+workspace.revision+' · '+workspace.editions.length+' source editions';
 const rows=Model.portfolio(workspace),visible=rows.filter(r=>(r.name+' '+r.operation).toLowerCase().includes(search.toLowerCase()));
 $('#case-list').innerHTML=visible.map(r=>'<button class="case-item '+(r.id===selected?'selected':'')+'" data-case="'+html(r.id)+'"><strong>'+html(r.name)+'</strong><span>'+html(r.operation)+'</span><small>'+html(r.state)+' · '+html(r.decision)+'</small></button>').join('')||'<p>No matching cases.</p>';
 $('#totals').textContent=rows.length+' cases · '+rows.filter(r=>r.state==='MATCH').length+' matches · '+rows.filter(r=>r.state==='REVIEW'||r.state==='CHANGED').length+' for review';
 document.querySelectorAll('[data-case]').forEach(b=>b.onclick=()=>{selected=b.dataset.case;tab='case';page=0;render();});
 document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 if(tab==='case')renderCase();else if(tab==='curriculum')renderCurriculum();else if(tab==='contracts')renderContracts();else if(tab==='sources')renderSources();else if(tab==='history')renderHistory();else renderOverview();
}
function renderCurriculum(){
 if(curriculumPanel){curriculumPanel.refresh();return;}
 const main=$('#main');main.replaceChildren();
 curriculumPanel=CurriculumPanel.mountCurriculumPlanner(main,{
  getWorkspace:()=>workspace,
  actor:()=>$('#engineer').value.trim(),
  onWorkspace:(next,{workspaceId,expectedRevision})=>{
   if(workspace.id!==workspaceId||workspace.revision!==expectedRevision)throw Error('The workspace changed during this operation. Refresh the current case.');
   save(next,'Curriculum migration plan and history saved.');
  }
 });
}
function renderCase(){
 const c=selectedCase(),main=$('#main');
 if(!c){main.innerHTML='<h2>Select a case</h2><p>Choose a published example or create a case for an actual returned API output.</p>';return;}
 const r=c.runs.at(-1),current=r&&r.caseRevision===c.revision;
 main.innerHTML='<div class="section-heading"><div><h2>'+html(c.name)+'</h2><p class="mono">'+html(c.operationKey)+'</p></div><span class="badge">'+(r?current?r.status:'CHANGED':'READY')+'</span></div>'+
 '<div class="pair">'+field('case-name','Case name',c.name)+'<label>Candidate contract edition<select id="target-edition">'+workspace.editions.map(e=>option(e.id,e.name||e.id,c.targetEditionId)).join('')+'</select></label></div>'+
 '<details><summary>Request and comparison settings</summary>'+textarea('request','Retained request parameters / body',json(c.request),5)+textarea('array-keys','Optional keyed arrays: pointer → row-key pointer',json(c.arrayKeys),4)+'<p>Arrays are compared in their original order. To compare an explicitly unordered collection, enter an exact array path and stable scalar row key, for example {"/items":"/id"}. Duplicate or missing keys produce an error.</p><button id="save-case">Save case settings</button></details>'+
 '<div class="pair responses">'+['original','candidate'].map(lane=>{const v=c.responses[lane];return '<section><h3>'+html(lane==='original'?'Original response':'Candidate response')+'</h3><p class="source">'+sourceLabel(v)+'</p>'+field(lane+'-status','HTTP status',v?.status??200,'number')+field(lane+'-source','Source description',v?.provenance.label??'')+'<label>Source kind<select id="'+lane+'-kind">'+['captured-http','operator-file','published-example'].map(k=>option(k,k,v?.provenance.kind??'operator-file')).join('')+'</select></label>'+textarea(lane+'-headers','Retained response headers',json(v?.headers??{}),2)+textarea(lane+'-body','Complete JSON response body',v?json(v.body):'',14)+'<div class="actions"><button data-save-response="'+lane+'">Save '+lane+'</button><label class="file-button">Load JSON file<input data-response-file="'+lane+'" type="file" accept=".json,application/json"></label></div></section>';}).join('')+'</div>'+
 '<details open><summary>Field migration</summary><p>Use explicit copy, move, omit or constant operations with JSON Pointers. A wildcard walks existing array elements and preserves their order. Every change keeps its engineering reason.</p>'+
 textarea('mappings','Mapping operations',json(c.mappings),7)+'<div class="actions"><button id="save-mapping">Save mappings</button><button id="mapping-help">Insert mapping example</button><button id="preview-mapping">Preview expected output</button></div><pre id="mapping-preview" hidden></pre></details>'+
 '<div class="actions major"><button id="compare" class="primary">Compare complete outputs</button><button id="export-case">Export case and all runs</button></div>'+
 (r?'<section><h3>Comparison '+html(r.id)+'</h3><p>'+html(r.at)+' · '+html(r.actor)+' · '+r.differences.length+' differences'+(!current?' · Run again after the saved edits.':'')+'</p><div class="pair"><div><h4>Original contract</h4>'+validation(r.originalValidation)+'</div><div><h4>Candidate contract</h4>'+validation(r.candidateValidation)+'</div></div>'+
 '<div id="diffs"></div><div class="actions"><button id="previous-diffs">Previous differences</button><span id="diff-page"></span><button id="next-diffs">Next differences</button></div>'+
 '<label>Engineering decision<select id="decision"><option value="changes-required">Changes required</option><option value="accepted">Accepted by the operating engineer</option></select></label>'+textarea('decision-note','Decision and remaining delivery work','',3)+'<button id="save-decision">Record decision for this run</button>'+
 '<details><summary>Prior runs and decisions ('+c.runs.length+' / '+c.decisions.length+')</summary><pre>'+html(json({runs:c.runs.map(x=>({id:x.id,status:x.status,at:x.at,actor:x.actor,differences:x.differences.length})),decisions:c.decisions}))+'</pre></details></section>':'');
 $('#save-case').onclick=action(()=>save(Model.updateCase(workspace,c.id,{name:$('#case-name').value,request:JSON.parse($('#request').value),arrayKeys:JSON.parse($('#array-keys').value),targetEditionId:$('#target-edition').value},now()),'Case settings saved; compare the new revision.'));
 document.querySelectorAll('[data-save-response]').forEach(b=>b.onclick=action(()=>{const lane=b.dataset.saveResponse;save(Model.saveResponse(workspace,c.id,lane,{status:Number($('#'+lane+'-status').value),body:JSON.parse($('#'+lane+'-body').value),headers:JSON.parse($('#'+lane+'-headers').value),contentType:'application/json',provenance:{kind:$('#'+lane+'-kind').value,label:$('#'+lane+'-source').value}},now()),'Complete '+lane+' response saved.');}));
 document.querySelectorAll('[data-response-file]').forEach(input=>input.onchange=action(async()=>{const f=input.files[0];if(!f)return;const body=JSON.parse(await f.text()),lane=input.dataset.responseFile;$('#'+lane+'-body').value=json(body);$('#'+lane+'-source').value=f.name;$('#'+lane+'-kind').value='operator-file';notice('File loaded into the editor. Save the response to retain it.');}));
 $('#save-mapping').onclick=action(()=>save(Model.updateCase(workspace,c.id,{mappings:JSON.parse($('#mappings').value)},now()),'Mappings saved.'));
 $('#mapping-help').onclick=()=>{$('#mappings').value=json([{action:'copy',from:'/existingField',to:'/newField',reason:'Explain the agreed target field.'}]);notice('Replace the example paths with fields in your original output before saving.');};
 $('#preview-mapping').onclick=action(()=>{if(!c.responses.original)throw Error('Save an original response first.');const v=Model.applyMappings(c.responses.original.body,JSON.parse($('#mappings').value));$('#mapping-preview').textContent=json(v);$('#mapping-preview').hidden=false;});
 $('#compare').onclick=action(()=>{save(Model.compareCase(workspace,c.id,now()),'Comparison saved with both complete outputs.');});
 $('#export-case').onclick=()=>download(c.id+'.json',json(c));
 if(r){
  renderDiffs(r);
  $('#previous-diffs').onclick=()=>{page=Math.max(0,page-1);renderDiffs(r);};
  $('#next-diffs').onclick=()=>{page=Math.min(Math.max(0,Math.ceil(r.differences.length/100)-1),page+1);renderDiffs(r);};
  $('#save-decision').onclick=action(()=>save(Model.decide(workspace,c.id,{runId:r.id,outcome:$('#decision').value,note:$('#decision-note').value},now()),'Engineering decision saved.'));
 }
}
function validation(result){return '<p><strong>'+ (result.valid?'VALID':'REVIEW')+'</strong> · '+result.errors.length+' violations · '+result.unsupported.length+' unsupported assertions</p>'+((result.errors.length||result.unsupported.length)?'<pre>'+html(json([...result.errors,...result.unsupported]))+'</pre>':'');}
function renderDiffs(run){
 const rows=run.differences.slice(page*100,(page+1)*100);
 $('#diffs').innerHTML=rows.length?'<table><thead><tr><th>Path / change</th><th>Expected after mappings</th><th>Candidate</th></tr></thead><tbody>'+rows.map(d=>'<tr><td><code>'+html(d.path||'/')+'</code><br>'+html(d.kind)+'</td><td><pre>'+html(Object.hasOwn(d,'before')?json(d.before):'(absent)')+'</pre></td><td><pre>'+html(Object.hasOwn(d,'after')?json(d.after):'(absent)')+'</pre></td></tr>').join('')+'</tbody></table>':'<p>Every compared value is equal. Contract validation appears above.</p>';
 $('#diff-page').textContent=run.differences.length?'Showing '+(page*100+1)+'–'+Math.min((page+1)*100,run.differences.length)+' of '+run.differences.length:'0 differences';
}
function renderOverview(){
 const rows=Model.portfolio(workspace);
 $('#main').innerHTML='<h2>Commissioning overview</h2><p>Each case retains the source edition, request, original output, candidate output, applied mappings and engineering decisions. Published examples establish the public contract baseline. Load actual returned output for the selected installation.</p>'+
 '<table><thead><tr><th>Case</th><th>Operation</th><th>Comparison</th><th>Decision</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+html(r.name)+'</td><td><code>'+html(r.operation)+'</code></td><td>'+html(r.state)+'</td><td>'+html(r.decision)+'</td></tr>').join('')+'</tbody></table><button id="export-summary">Export commissioning summary</button>';
 $('#export-summary').onclick=()=>download('commissioning-summary.json',json({workspace:workspace.id,revision:workspace.revision,cases:rows}));
}
function renderContracts(){
 const ed=workspace.editions.find(e=>e.id===contractId)||workspace.editions.at(-1),inv=Model.sourceInventory(ed);
 $('#main').innerHTML='<h2>Contracts and generated SDK</h2><label>Retained edition<select id="contract-edition">'+workspace.editions.map(e=>option(e.id,e.name||e.id,ed.id)).join('')+'</select></label><p class="mono">'+html(ed.provenance.repository||'Imported source')+' · '+html(ed.provenance.commit||ed.id)+'</p>'+
 '<div class="actions"><button id="sdk">Generate and download TypeScript SDK</button><button id="edition-export">Export complete source edition</button><label class="file-button">Import new edition<input id="edition-import" type="file" accept=".json"></label></div>'+
 '<p>Imported editions use {id, name, provenance, surface, bulkSchema, graphql, owaSource}. Choose the candidate edition within each case; saved original outputs retain their original edition.</p>'+
 '<h3>'+inv.operations.length+' published operations</h3><table><thead><tr><th>Method and route</th><th>Operation</th></tr></thead><tbody>'+inv.operations.map(o=>'<tr><td><code>'+html(o.key)+'</code></td><td>'+html(o.id)+'</td></tr>').join('')+'</tbody></table>'+
 '<h3>'+inv.relations.length+' GraphQL relation names</h3><p>'+ (inv.fieldMetadataPresent?'This edition contains field metadata.':'This published edition supplies type names and descriptions. Import the authorised complete introspection or Hasura metadata as a source asset to carry its fields and relationships.')+'</p>'+
 '<details><summary>View complete relation inventory</summary><table><thead><tr><th>Name</th><th>Source description</th><th>Fields</th></tr></thead><tbody>'+inv.relations.map(r=>'<tr><td><code>'+html(r.name)+'</code></td><td>'+html(r.description)+'</td><td>'+ (r.fields===null?'not supplied':r.fields.length)+'</td></tr>').join('')+'</tbody></table></details>'+
 '<details><summary>Exact source view constants ('+inv.constants.length+')</summary><pre>'+html(json(inv.constants))+'</pre></details><pre id="sdk-result" hidden></pre>';
 $('#contract-edition').onchange=()=>{contractId=$('#contract-edition').value;renderContracts();};
 bindContracts(ed);
}
function bindContracts(ed){
 $('#edition-export').onclick=()=>download(ed.id+'.json',json(ed));
 $('#edition-import').onchange=action(async()=>{const f=$('#edition-import').files[0];if(f)save(Model.addEdition(workspace,JSON.parse(await f.text()),now()),'New contract edition received.');});
 $('#sdk').onclick=action(()=>{const result=Sdk.generateSdk(ed);const url=URL.createObjectURL(zipFiles(result.files)),link=document.createElement('a');link.href=url;link.download='curriculum-sdk.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);$('#sdk-result').textContent=json({files:result.files.map(f=>({path:f.path,characters:f.content.length})),diagnostics:result.diagnostics});$('#sdk-result').hidden=false;notice('SDK generated from the selected saved edition.');});
}
function renderSources(){
 $('#main').innerHTML='<h2>Source assets and migration dependencies</h2><p>Keep complete SQL, Drizzle modules, Hasura metadata and private source extracts with the receiving workspace. Each saved asset is immutable; receive a later file as a new source edition.</p>'+
 field('asset-name','Source name','')+'<label>Kind<select id="asset-kind">'+['sql','hasura-metadata','drizzle','graphql-introspection','source-notes'].map(k=>option(k,k,'sql')).join('')+'</select></label>'+
 textarea('asset-content','Complete source body','',10)+'<div class="actions"><label class="file-button">Load source file<input id="asset-file" type="file"></label><button id="asset-save">Retain complete source</button></div>'+
 workspace.assets.map(a=>'<details><summary>'+html(a.name)+' · '+html(a.kind)+'</summary><pre>'+html(a.content)+'</pre></details>').join('');
 $('#asset-file').onchange=action(async()=>{const f=$('#asset-file').files[0];if(f){$('#asset-name').value=f.name;$('#asset-content').value=await f.text();notice('Source loaded into the editor. Save to retain it.');}});
 $('#asset-save').onclick=action(()=>save(Model.addAsset(workspace,{id:uid('source'),name:$('#asset-name').value,kind:$('#asset-kind').value,content:$('#asset-content').value},now()),'Complete source retained.'));
}
function renderHistory(){
 $('#main').innerHTML='<h2>Operation history</h2><p>'+workspace.history.length+' saved operations. The full history travels with the exported workspace.</p>'+workspace.history.slice().reverse().map(h=>'<details><summary>#'+h.sequence+' · '+html(h.type)+' · '+html(h.actor)+' · '+html(h.at)+'</summary><pre>'+html(json(h.detail))+'</pre></details>').join('');
}
async function exportWorkspace(){
 const body=Model.canonical(workspace),packet={format:'curriculum-workspace-export.v1',sha256:Codec.sha256(body),workspace};
 download(workspace.id+'-r'+workspace.revision+'.json',json(packet));notice('Complete workspace exported with its source editions, outputs, assets and history.');
}
async function receiveFile(file){
 const packet=JSON.parse(await file.text());
 if(packet.format!=='curriculum-workspace-export.v1'||Codec.sha256(Model.canonical(packet.workspace))!==packet.sha256)throw Error('Workspace checksum or format does not match.');
 const received=Curriculum.receiveCurriculumWorkspace(packet.workspace);
 if(workspace && workspace.id===received.id && workspace.revision>received.revision)throw Error('This received file is older than the saved browser workspace. Export the current workspace and use a separate browser context to inspect the older edition.');
 workspace=received;selected=workspace.cases[0]?.id;save(workspace,'Complete workspace received and reopened.');
}
function newCase(){
 const dialog=$('#new-dialog'),e=workspace.editions.at(-1);
 $('#new-operation').innerHTML=Model.operations(e).map(o=>option(o.key,o.key,'')).join('')+option('BULK','BULK — complete export','');
 dialog.showModal();
 $('#create-case').onclick=action(()=>{const id=uid('case');save(Model.addCase(workspace,{id,name:$('#new-name').value||'Migration case',operationKey:$('#new-operation').value,sourceEditionId:e.id,targetEditionId:e.id},now()),'Case created.');selected=id;dialog.close();render();});
}
async function boot(){
 try {
  const bytes=Uint8Array.from(atob(INITIAL_GZIP),c=>c.charCodeAt(0));
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const initial=JSON.parse(await new Response(stream).text());originalWorkspace=initial;
  if(Codec.sha256(Model.canonical(initial))!==INITIAL_SHA)throw Error('Embedded source edition checksum differs.');
  let retained;try{retained=localStorage.getItem(STORAGE);}catch{} workspace=retained?Curriculum.receiveCurriculumWorkspace(JSON.parse(retained)):initial;
  selected=workspace.cases[0]?.id;
  $('#engineer').value=sessionStorage.getItem('curriculum-engineer')||'';
  $('#engineer').onchange=()=>{try{sessionStorage.setItem('curriculum-engineer',$('#engineer').value);}catch{}};
  $('#case-search').oninput=e=>{search=e.target.value;render();};
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;render();});
  $('#export-workspace').onclick=action(exportWorkspace);
  $('#receive-workspace').onchange=action(async()=>{const f=$('#receive-workspace').files[0];if(f)await receiveFile(f);});
  $('#new-case').onclick=newCase;
  $('#close-dialog').onclick=()=>$('#new-dialog').close();
  $('#download-source').onclick=action(async()=>{
 const bytes=Uint8Array.from(atob(APP_SOURCE_GZIP),c=>c.charCodeAt(0)),payload=JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
 const files=payload.files.map(f=>({path:f.path,content:f.content}));
 files.push({path:'initial-workspace.json',content:json(originalWorkspace)});
 files.push({path:'public-source.json.gz.json',content:PUBLIC_SOURCE_CARRIER});
 files.push({path:'curriculum-migration-workbench.html',content:'<!doctype html>\n'+document.documentElement.outerHTML});
 files.push({path:'current-workspace.json',content:json({format:'curriculum-workspace-export.v1',sha256:Codec.sha256(Model.canonical(workspace)),workspace})});
 const generated=Sdk.generateSdk(workspace.editions.at(-1));files.push(...generated.files.map(f=>({path:'generated/'+f.path,content:f.content})));
 const blob=zipFiles(files),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Curriculum_Migration_Workbench.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);notice('Complete application, source, generated SDK and current workspace exported.');
 });
  render();notice('Published contract baseline loaded. Select a case and save its candidate output.');
 }catch(e){notice('Unable to open workspace: '+e.message,true);}
}
boot();