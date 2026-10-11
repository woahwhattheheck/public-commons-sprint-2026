"""The retained-response mapping UI, joined to the original analysis application."""

HTML = r'''
<section id="tab-responses" hidden>
<section class="panel"><div class="section-head"><div><h2>Retained responses and files</h2><p>Choose records from an original response, delivered object, or typed stream export. The imported table, saved analysis and reports keep its original source and completion scope.</p></div></div>
<div class="form-row"><label>Registered response<select id="response-source"><option value="">No registered response</option></select></label><button id="response-inspect">Inspect retained records</button></div>
<div id="response-source-info" class="facts"></div><p id="response-source-help" class="muted"></p>
<details><summary>Register a response locally</summary><p>The local operator registers original files before opening this workspace. The browser selects registered sources by name and revision.</p><pre>python -m stellar_forge_buyer.analysis_workspace --database DATA response --name games --input-kind stream --stream-export ORIGINAL_EXPORT
python -m stellar_forge_buyer.analysis_workspace --database DATA --checkout ORIGINAL_RUNTIME response --name sales --input-kind mcp --manifest ORIGINAL_RESULT.meta.json
python -m stellar_forge_buyer.analysis_workspace --database DATA --checkout ORIGINAL_RUNTIME response --name inventory --input-kind object --object-session ORIGINAL_OBJECT_SESSION --object-destination ORIGINAL_ASSEMBLY.csv --format csv</pre><p>Original SF88 buyer configuration/result pairs and SF31 response-file configuration/receipt pairs support JSON and CSV with the same response command. A delivered object uses its recorded COMPLETE session and selected assembly. Choose JSON or CSV, then map and import it here. See WORKSPACE.md and OBJECT_ANALYSIS.md for the exact flags.</p></details>
</section>
<section id="response-mapping-panel" class="panel" hidden><h2>Select records and column types</h2>
<div class="form-row"><label>JSON record collection<input id="response-collection" list="response-collections" placeholder="/structuredContent/rows" spellcheck="false"><datalist id="response-collections"></datalist><span class="hint">JSON Pointer. Empty selects the root array or one root object. CSV and streams already define their record sequence.</span></label><label id="response-sse-label" hidden>SSE data<select id="response-sse"><option value="text">Keep data as text</option><option value="json">Parse each data value as JSON</option></select></label><button id="response-fields">Read fields from this collection</button></div>
<p>Choose an explicit column type. Native keeps JSON scalar types and CSV text; exact decimal strings stay text. Missing values fail the import unless you select NULL. Existing JSON null always remains SQL NULL.</p>
<div class="table-scroll"><table class="response-map"><thead><tr><th>SQL column</th><th>Field pointer</th><th>Value type</th><th>Missing field</th><th></th></tr></thead><tbody id="response-columns"></tbody></table></div>
<div class="toolbar"><button id="response-add">Add column</button><button id="response-preview" class="primary">Preview all mapped records</button></div>
<p id="response-draft-info" class="muted"></p>
<details><summary>Original sample records</summary><p>This sample helps choose fields. The full preview checks every retained record.</p><pre id="response-sample"></pre></details>
</section>
<section id="response-preview-panel" class="panel" hidden><h2>Review the complete projection</h2><div id="response-preview-info" class="facts"></div>
<div id="response-incomplete" class="notice" hidden><p id="response-incomplete-text"></p><label><input id="response-allow-incomplete" type="checkbox"> Use these retained records with their incomplete scope attached to the imported version and reports.</label></div>
<p id="response-preview-note"></p>
<div class="table-scroll"><table id="response-preview-table"><thead></thead><tbody></tbody></table></div>
<details><summary>Source identity, mapping and completion</summary><pre id="response-preview-binding"></pre></details>
<div class="toolbar"><button id="response-import" class="primary">Import reviewed projection</button><button id="response-data">Open imported versions</button></div>
<p>Import creates an immutable version. Select its SQL view in Data, or compare it with a current view before changing the working selection.</p>
</section>
</section>
'''

CSS = r'''
#tab-responses pre{overflow-wrap:anywhere;white-space:pre-wrap;max-height:28rem;overflow:auto}
#response-collection{min-width:18rem}#response-source-info{overflow-wrap:anywhere}
.response-map input{min-width:9rem;width:100%}.response-map td:nth-child(2){width:38%}
.response-map select{min-width:8rem}#response-incomplete input{width:auto;display:inline}
#response-preview-info{overflow-wrap:anywhere}#response-draft-info{overflow-wrap:anywhere}
@media(max-width:640px){#response-collection{min-width:0}.response-map{min-width:650px}}
'''

JS = r'''
(()=>{
const r={source:null,description:null,columns:[],preview:null,draftLoaded:false,savedPreview:null,load:0};
const types=['native','text','integer','number','boolean','json'];
const selection=()=>s.data?.sources.find(v=>v.kind==='response'&&v.name===$('response-source').value);
const mapping=()=>({collection:$('response-collection').value,sse_data:$('response-sse').value,columns:r.columns.map(v=>({...v}))});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const request=()=>({source:selection()?.name,source_revision:selection()?.revision,mapping:mapping()});
function remember(){if(!s.data)return;try{localStorage.setItem('sf-response-draft:'+s.data.workspace_id,JSON.stringify({source:selection()?.name,source_revision:selection()?.revision,mapping:mapping(),description:r.description,preview_id:r.preview?.id}));}catch{}}
function invalidate(){r.preview=null;$('response-preview-panel').hidden=true;$('response-allow-incomplete').checked=false;remember();label();controls();}
function label(){$('response-draft-info').textContent=r.preview?'The complete preview below is bound to these exact columns and the original source revision.':'Mapping retained in this browser. Preview every selected record before importing.';}
function controls(){
 const unavailable=s.busy||!s.data,active=!!s.active;
 for(const name of ['response-source','response-inspect','response-collection','response-sse','response-fields','response-add','response-preview','response-import','response-allow-incomplete'])$(name).disabled=unavailable||active;
 $('response-inspect').disabled||=!selection();
 $('response-collection').disabled||=selection()?.format!=='json';
 for(const name of ['response-fields','response-add','response-preview'])$(name).disabled||=!r.description;
 $('response-preview').disabled||=!r.columns.length;
 $('response-import').disabled||=!r.preview||r.preview.result.manifest.completion.requiresIncompleteAcknowledgement&&!$('response-allow-incomplete').checked;
 for(const input of $('response-columns').querySelectorAll('input,select,button'))input.disabled=unavailable||active;
 $('response-data').disabled=unavailable;
}
function sourceInfo(){
 const source=selection(),box=$('response-source-info');box.replaceChildren();
 if(source){fact(box,'Native kind',source.identity.original.nativeKind);fact(box,'Native status',source.native_status);fact(box,'Format',source.format);fact(box,'Original bytes',source.identity.original.sourceBytes);fact(box,'Transport complete',source.identity.original.transportComplete);fact(box,'Original SHA-256',source.identity.original.sourceSha256);fact(box,'Registration revision',source.revision);}
 $('response-source-help').textContent=source?'This is a retained local response. Inspection and import use its original readers.':'Register a retained response locally, then refresh this workspace. Imported tables and reports reopen without the original checkout or source files.';
 controls();
}
function addSelect(values,current,onchange){const select=node('select');for(const [value,label] of values){const option=node('option',label);option.value=value;select.append(option);}select.value=current;select.addEventListener('change',()=>onchange(select.value));return select;}
function renderColumns(){
 const body=$('response-columns');body.replaceChildren();
 r.columns.forEach((column,index)=>{
  const row=node('tr'),name=node('input'),pointer=node('input');name.value=column.name;pointer.value=column.pointer;name.setAttribute('aria-label','SQL column '+(index+1));pointer.setAttribute('aria-label','Field pointer '+(index+1));name.spellcheck=pointer.spellcheck=false;
  name.addEventListener('input',()=>{column.name=name.value;invalidate();});pointer.addEventListener('input',()=>{column.pointer=pointer.value;invalidate();});
  cell(row).append(name);cell(row).append(pointer);
  cell(row).append(addSelect(types.map(v=>[v,v==='native'?'Native scalar':v==='text'?'Text (exact strings)':v==='json'?'JSON text':v]),column.type,value=>{column.type=value;invalidate();}));
  cell(row).append(addSelect([['error','Require field'],['null','Use NULL']],column.missing,value=>{column.missing=value;invalidate();}));
  const remove=node('button','Remove');remove.addEventListener('click',()=>{r.columns.splice(index,1);renderColumns();invalidate();});cell(row).append(remove);body.append(row);
 });if(!r.columns.length)empty(body,5,'Add the fields you want in the analytical table.');controls();
}
function description(value,{replaceColumns=true}={}){
 r.description=value;r.source=selection()?.name;
 $('response-mapping-panel').hidden=false;$('response-collection').value=value.default_collection;
 $('response-collection').disabled=value.identity.format!=='json';$('response-sse-label').hidden=value.identity.format!=='sse';
 const choices=$('response-collections');choices.replaceChildren();for(const option of value.collections){const o=node('option');o.value=option.pointer;o.label=option.kind+' · '+option.records+' records';choices.append(o);}
 $('response-sample').textContent=value.sample_text+(value.sample_clipped?'\n[Sample display clipped]':'');
 if(replaceColumns){const used=new Set();r.columns=value.field_hints.slice(0,12).map(hint=>{let name=hint.name,n=2;while(used.has(name.toLowerCase()))name=hint.name+'_'+n++;used.add(name.toLowerCase());return {name,pointer:hint.pointer,type:hint.type,missing:'error'};});}
 renderColumns();label();remember();
}
async function inspect(useFields=false){
 const source=selection();if(!source)return;
 const seq=++r.load,query=new URLSearchParams({revision:String(source.revision),sse_data:$('response-sse').value});
 if(useFields)query.set('collection',$('response-collection').value);
 const value=await api('/api/response-source/'+encodeURIComponent(source.name)+'?'+query);
 if(seq!==r.load||selection()?.name!==source.name||selection()?.revision!==source.revision)return;
 invalidate();description(value);message('Choose columns, then preview all retained records.');
}
function renderPreview(){
 const job=r.preview;if(!job)return;
 const value=job.result,manifest=value.manifest,box=$('response-preview-info');box.replaceChildren();
 fact(box,'Source',value.source+' · revision '+value.source_revision);fact(box,'Every retained row',manifest.rows);fact(box,'Mapped columns',manifest.projectedFields.length);fact(box,'Mapped bytes',manifest.outputs['mapped.jsonl'].bytes);fact(box,'Projection SHA-256',manifest.outputs['mapped.jsonl'].sha256);
 const incomplete=manifest.completion.requiresIncompleteAcknowledgement;$('response-incomplete').hidden=!incomplete;
 $('response-incomplete-text').textContent=manifest.completion.transportComplete!==true?'The original response stream did not complete. These are the valid records the native export retained; the imported version will remain marked incomplete.':'The provider marked this returned collection as truncated. Import preserves that recorded scope.';
 $('response-preview-note').textContent=manifest.rows+' total records checked. '+value.sample.length+' rows shown'+(value.sample_clipped?' (sample display limited)':'')+'. '+(Object.values(manifest.missingAsNull).some(v=>v)?'Missing-to-NULL counts are recorded in the mapping manifest.':'No selected fields were missing.');
 const table=$('response-preview-table');table.tHead.replaceChildren();table.tBodies[0].replaceChildren();const head=node('tr');for(const field of manifest.projectedFields)head.append(node('th',field));table.tHead.append(head);
 for(const values of value.sample){const row=node('tr');for(const value of values){const td=cell(row,value.type==='null'?'NULL':value.text);td.classList.toggle('null',value.type==='null');td.title=value.type;}table.tBodies[0].append(row);}if(!value.sample.length)empty(table.tBodies[0],manifest.projectedFields.length,'The selected collection is empty.');
 $('response-preview-binding').textContent=JSON.stringify({preview_id:job.id,preview_sha256:value.preview_sha256,...manifest},null,2);$('response-preview-panel').hidden=false;label();remember();controls();
}
async function open(job){
 if(job.status!=='COMPLETE')return;
 $('response-source').value=job.request.source;
 if(!selection()||selection().revision!==job.request.source_revision){message('This preview is retained in Activity. The registered response now has a different revision.',true);showActivity(job);tab('activity');return;}
 r.source=job.request.source;r.columns=job.request.mapping.columns.map(v=>({...v}));$('response-collection').value=job.request.mapping.collection;$('response-sse').value=job.request.mapping.sse_data;
 // Retained previews reopen from the database without reading external files.
 r.description={...(r.description||{}),identity:{format:selection().format}};$('response-mapping-panel').hidden=false;
 $('response-sse-label').hidden=selection().format!=='sse';$('response-sample').textContent='The complete retained preview below supplies these records. Inspect the source again to load a fresh discovery sample.';
 r.preview=job;$('response-allow-incomplete').checked=false;sourceInfo();renderColumns();renderPreview();tab('responses');
}
async function refresh(){
 const old=$('response-source').value,sources=s.data.sources.filter(v=>v.kind==='response'),select=$('response-source');
 select.replaceChildren();for(const source of sources){const option=node('option',source.name+' · '+source.format+' · '+source.native_status);option.value=source.name;select.append(option);}if(!sources.length){const option=node('option','No registered response');option.value='';select.append(option);}if(sources.some(v=>v.name===old))select.value=old;
 if(!r.draftLoaded){r.draftLoaded=true;let draft;try{draft=JSON.parse(localStorage.getItem('sf-response-draft:'+s.data.workspace_id));}catch{}
  if(draft?.mapping&&sources.some(v=>v.name===draft.source)){select.value=draft.source;r.columns=draft.mapping.columns||[];$('response-collection').value=draft.mapping.collection||'';$('response-sse').value=draft.mapping.sse_data||'text';r.source=draft.source;r.description=draft.description;$('response-mapping-panel').hidden=!r.description;renderColumns();if(draft.preview_id&&selection()?.revision===draft.source_revision){try{const job=await api('/api/jobs/'+draft.preview_id);if(job.kind==='response-preview'&&job.status==='COMPLETE'&&same(job.request.mapping,mapping()))await open(job);}catch{}}}
 }
 if(r.preview&&(r.preview.request.source!==selection()?.name||r.preview.request.source_revision!==selection()?.revision))invalidate();
 sourceInfo();label();controls();
}
$('response-source').addEventListener('change',()=>{++r.load;r.description=null;r.columns=[];invalidate();$('response-mapping-panel').hidden=true;sourceInfo();});
$('response-inspect').addEventListener('click',()=>act(()=>inspect()));
$('response-fields').addEventListener('click',()=>act(()=>inspect(true)));
for(const field of ['response-collection','response-sse'])$(field).addEventListener('input',invalidate);
$('response-add').addEventListener('click',()=>{r.columns.push({name:'column_'+(r.columns.length+1),pointer:'',type:'native',missing:'error'});renderColumns();invalidate();});
$('response-preview').addEventListener('click',()=>act(async()=>{const spec=request();invalidate();await start('response-preview',spec);}));
$('response-import').addEventListener('click',()=>act(()=>start('response-import',{preview_id:r.preview.id,preview_sha256:r.preview.result.preview_sha256,allow_incomplete:$('response-allow-incomplete').checked})));
$('response-allow-incomplete').addEventListener('change',controls);
$('response-data').addEventListener('click',()=>tab('data'));
window.responseTables={controls,refresh,open};
})();
'''
