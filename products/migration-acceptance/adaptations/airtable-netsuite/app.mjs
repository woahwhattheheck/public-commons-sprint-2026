// SPDX-License-Identifier: MIT
import {newProject,applyMapping,openProject,serializeProject,validateProject,textPin,clone,digest,MAX_BYTES} from './project.mjs';
import {prepareProviderMigration} from './provider-input.mjs';
const $=id=>document.getElementById(id),json=v=>JSON.stringify(v,null,2)+'\n';
const state={project:null,capture:null,mapping:null,prepared:null,preparationError:null,preview:null,offset:0,busy:false,dirty:false,serial:0};
const make=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text);return el;};
const fail=message=>{$('error').textContent=message;$('error').hidden=!message;};
const status=text=>$('status').textContent=text;
function controls(){
 for(const el of document.querySelectorAll('input,select,textarea,button'))el.disabled=state.busy;
 for(const id of ['save','save-working','export','preview','apply','restore-mapping','mapping-editor'])$(id).disabled=state.busy||!state.project;
 $('export').disabled=state.busy||!state.prepared;
 for(const id of ['table','side','query','prev','next','download-table'])$(id).disabled=state.busy||!state.prepared;
 $('prev').disabled||=state.offset===0;
 if(state.prepared){const selected=selectedRows(),q=$('query').value.toLocaleLowerCase();const n=selected?selected.rows.filter(r=>!q||JSON.stringify(r).toLocaleLowerCase().includes(q)).length:0;$('next').disabled||=state.offset+100>=n;}
}
async function run(fn){if(state.busy)return;state.busy=true;fail('');controls();try{await fn();}catch(e){fail(e.message);status('Current complete project is retained. Correct the input or retry the selected action.');}finally{state.busy=false;controls();}}
function download(content,name,type='application/json'){
 const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=make('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function readFile(file){if(!file)throw Error('Choose a complete source file.');if(file.size>MAX_BYTES)throw Error('The complete file exceeds 512 MiB.');const text=await file.text();if(textPin(text).bytes!==file.size)throw Error('The input is not the complete declared UTF-8 file.');return text;}
function currentPrepared(project){validateProject(project);return prepareProviderMigration({capture:project.capture,mapping:project.mapping});}
function activate(project){
 validateProject(project);let prepared=null,preparationError=null;try{prepared=currentPrepared(project);}catch(e){preparationError=e.message;}
 state.project=project;state.prepared=prepared;state.preparationError=preparationError;state.preview=null;state.dirty=false;state.offset=0;
 $('mapping-editor').value=json(project.mapping);$('project-id').value=project.id;$('title').value=project.title;$('approve').checked=false;
 state.serial++;render();status('Opened '+project.title+' · saved mapping edition '+project.revision+'.'+(preparationError?' Correct the complete mapping in this editor before preparing native input.':''));if(preparationError)fail(preparationError);
}
function render(){
 const p=state.project;if(!p)return;
 $('selection').textContent=json({id:p.id,revision:p.revision,captureSha256:p.captureSha256,mappingSha256:digest(p.mapping),approval:p.approval,
  sourceFiles:state.prepared?.files.length??0,selectedTables:state.prepared?.manifest.tables.length??0,consistency:state.prepared?.manifest.consistency??null,preparationError:state.preparationError});
 const old=$('table').value;$('table').replaceChildren(...(state.prepared?.manifest.tables??[]).map(t=>{const o=make('option',t.name);o.value=t.name;return o;}));
 if([...$('table').options].some(x=>x.value===old))$('table').value=old;
 const summary=make('table'),head=make('tr');for(const t of ['Table','Airtable rows','NetSuite rows','Original key'])head.append(make('th',t));summary.append(head);
 for(const t of state.prepared?.manifest.tables??[]){const r=make('tr');for(const v of [t.name,t.sourceRows,t.expectedRows,t.primaryKey.join(', ')])r.append(make('td',v));summary.append(r);}
 $('table-summary').replaceChildren(summary);
 $('relationship-report').textContent=json({consistency:state.prepared?.manifest.consistency??null,relationships:state.prepared?.manifest.relationships??[],preparationError:state.preparationError});
 const projection=state.prepared?.files.find(f=>f.path==='projection.json');$('projection').textContent=projection?.content??'A complete projection will appear after the mapping is valid.';
 const visibleFiles=state.prepared?.files??[{path:'capture.json',content:json(p.capture),...textPin(json(p.capture))},{path:'mapping.json',content:json(p.mapping),...textPin(json(p.mapping))}];
 $('source-list').replaceChildren(...visibleFiles.map(f=>{
  const row=make('div');row.className='source';const info=make('div');info.append(make('strong',f.path),make('p',f.bytes+' bytes'),make('code',f.sha256));
  const b=make('button','Download complete file');b.onclick=()=>download(f.content,f.path.split('/').at(-1));row.append(info,b);return row;}));
 $('history-list').replaceChildren(...[{revision:0,at:p.createdAt,mapping:p.initialMapping},...p.history].map(h=>{const d=make('details');d.append(make('summary','Edition '+h.revision+' · '+(h.actor||'original input')+' · '+h.at),make('pre',json(h)));return d;}));
 $('native-command').textContent='node adaptations/airtable-netsuite/receive.mjs \\\n  --project /absolute/path/project.json \\\n  --directory /absolute/path/original-workspace \\\n  --receiving-directory /absolute/path/independent-receiving \\\n  --runtime-ready /absolute/path/runtime-ready.json \\\n  --operation YOUR_STABLE_OPERATION \\\n  --actor YOUR_ORIGINAL_OPERATOR';
 renderRows();controls();
}
function selectedRows(){
 const t=state.prepared?.manifest.tables.find(t=>t.name===$('table').value);if(!t)return null;
 const path=$('side').value==='source'?t.sourcePath:t.expectedPath,f=state.prepared.files.find(f=>f.path===path),value=JSON.parse(f.content);
 const rows=Array.isArray(value)?value:value.rows.map(cells=>Object.fromEntries(t.columns.map((c,i)=>[c.name,cells[i].type==='null'?null:cells[i].value])));
 return{table:t,file:f,rows};
}
function renderRows(){
 const selected=selectedRows();if(!selected){$('thead').replaceChildren();$('tbody').replaceChildren();$('row-count').textContent='Correct the mapping to prepare complete table views.';return;}
 const query=$('query').value.toLocaleLowerCase(),rows=selected.rows.map((r,i)=>({r,i})).filter(x=>!query||JSON.stringify(x.r).toLocaleLowerCase().includes(query));
 if(state.offset>=rows.length&&state.offset>0)state.offset=Math.max(0,Math.floor((rows.length-1)/100)*100);
 const h=make('tr');h.append(make('th','Original row'));for(const c of selected.table.columns)h.append(make('th',c.name));$('thead').replaceChildren(h);
 $('tbody').replaceChildren(...rows.slice(state.offset,state.offset+100).map(({r,i})=>{
  const tr=make('tr');tr.append(make('td',i+1));for(const c of selected.table.columns){const td=make('td'),v=r[c.name],text=v===null?'null':typeof v==='string'?v:JSON.stringify(v);
   if(text.length>180){const d=make('details');d.append(make('summary',text.slice(0,100)+'…'),make('pre',text));td.append(d);}else td.textContent=text;tr.append(td);}return tr;}));
 $('row-count').textContent=rows.length?'Rows '+(state.offset+1)+'–'+Math.min(state.offset+100,rows.length)+' of '+rows.length+' matching · '+selected.rows.length+' complete rows':'No matching rows · '+selected.rows.length+' complete rows';
 $('next').disabled=state.busy||state.offset+100>=rows.length;$('prev').disabled=state.busy||state.offset===0;
}
for(const id of ['project-file','capture-file','mapping-file'])$(id).addEventListener('change',e=>{
 const f=e.target.files?.[0];e.target.value='';run(async()=>{
  if(!f)return;const serial=++state.serial,text=await readFile(f);if(serial!==state.serial)return;
  if(id==='project-file'){if(state.dirty)throw Error('Save the current attributed mapping or restore its saved text before opening another project.');const value=JSON.parse(text);if(value.schema==='tjlabs.provider-migration-working.v1'){
   if(typeof value.mappingText!=='string'||value.projectSha256!==digest(value.project))throw Error('The complete saved working copy differs from its retained project.');
   activate(validateProject(value.project));$('mapping-editor').value=value.mappingText;$('actor').value=String(value.actor??'');$('reason').value=String(value.reason??'');$('approve').checked=value.approve===true;state.dirty=value.mappingText!==json(state.project.mapping);status('Restored the full unfinished mapping and its last complete saved project.');
  }else activate(openProject(text));}
  else{const value=JSON.parse(text);state[id==='capture-file'?'capture':'mapping']=value;status('Retained '+f.name+' ('+f.size+' bytes). Create a project when both complete inputs are selected.');}
 });
});
$('create').onclick=()=>run(async()=>{if(state.dirty)throw Error('Keep the current complete mapping edition first.');if(!state.capture||!state.mapping)throw Error('Choose both original capture and mapping files.');
 const p=newProject({id:$('project-id').value.trim(),title:$('title').value.trim(),capture:state.capture,mapping:state.mapping,at:new Date().toISOString()});activate(p);});
$('mapping-editor').addEventListener('input',()=>{state.dirty=true;state.preview=null;state.serial++;$('mapping-result').textContent='Unfinished mapping text retained in this tab. Preview validates the whole selection; saving records an attributed new edition.';});
$('preview').onclick=()=>run(async()=>{const mapping=JSON.parse($('mapping-editor').value),prepared=prepareProviderMigration({capture:state.project.capture,mapping});state.preview=prepared;
 $('mapping-result').textContent=json({status:'complete preview; saved project unchanged',manifest:prepared.manifest});});
$('apply').onclick=()=>run(async()=>{
 const mapping=JSON.parse($('mapping-editor').value);prepareProviderMigration({capture:state.project.capture,mapping});
 const request={operationId:crypto.randomUUID().replaceAll('-',''),projectId:state.project.id,captureSha256:state.project.captureSha256,
 expectedRevision:state.project.revision,mapping,actor:$('actor').value.trim(),reason:$('reason').value.trim(),approve:$('approve').checked,at:new Date().toISOString()};
 const result=applyMapping(state.project,request);activate(result.project);$('mapping-result').textContent='Saved complete edition '+result.revision+'. Download the full project before closing the tab.';
});
$('restore-mapping').onclick=()=>run(async()=>{$('mapping-editor').value=json(state.project.mapping);state.dirty=false;state.preview=null;state.serial++;$('mapping-result').textContent='Restored the saved complete mapping text.';});
$('save').onclick=()=>run(async()=>{if(state.dirty)throw Error('Record the attributed mapping edition or restore saved text before downloading the project.');download(serializeProject(state.project),'project.json');status('Downloaded complete project with source and every review edition.');});
$('save-working').onclick=()=>run(async()=>{const body={schema:'tjlabs.provider-migration-working.v1',project:state.project,projectSha256:digest(state.project),mappingText:$('mapping-editor').value,actor:$('actor').value,reason:$('reason').value,approve:$('approve').checked};const text=json(body);if(textPin(text).bytes>MAX_BYTES)throw Error('The complete working copy exceeds 512 MiB.');download(text,'provider-working-copy.json');status('Downloaded the complete unfinished editor and saved source project.');});
$('export').onclick=()=>run(async()=>{
 if(state.dirty)throw Error('Save the attributed mapping edition before exporting its prepared source.');
 const prepared=currentPrepared(state.project),projectText=serializeProject(state.project),files=[...prepared.files,{path:'review/project.json',content:projectText,...textPin(projectText)}];
 const packet={schema:'tjlabs.provider-prepared-source.v1',projectId:state.project.id,revision:state.project.revision,captureSha256:state.project.captureSha256,
  manifest:prepared.manifest,files,receiving:'Materialize exact files, retain review/project.json through the original native continuation, then reopen the complete native handoff.'};
 const text=json(packet);if(textPin(text).bytes>MAX_BYTES)throw Error('The complete source package exceeds 512 MiB; use the original native source intake with the saved project.');
 download(text,'provider-prepared-source.json');status('Downloaded every complete prepared file and the editable project.');
});
$('download-table').onclick=()=>run(async()=>{const selected=selectedRows();if(selected)download(selected.file.content,selected.file.path.split('/').at(-1));});
for(const id of ['table','side','query'])$(id).addEventListener(id==='query'?'input':'change',()=>{state.offset=0;renderRows();});
$('prev').onclick=()=>{state.offset=Math.max(0,state.offset-100);renderRows();};$('next').onclick=()=>{state.offset+=100;renderRows();};
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>{for(const n of document.querySelectorAll('[data-tab]'))n.setAttribute('aria-selected',String(n===b));for(const tab of document.querySelectorAll('.tab'))tab.hidden=tab.id!==b.dataset.tab;};
window.addEventListener('beforeunload',e=>{if(state.dirty){e.preventDefault();e.returnValue='';}});
controls();

document.documentElement.dataset.providerReviewReady='true';
