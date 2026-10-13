// SPDX-License-Identifier: MIT
import {newProject,applyMapping,serializeProject,validateProject,textPin,clone,digest,MAX_BYTES} from './project.mjs';
import {prepareProviderMigration,inspectCapture} from './provider-input.mjs';
import {initialSession,receiveSession,serializeSession,retainFile,TABS} from './session.mjs';
const $=id=>document.getElementById(id),json=v=>JSON.stringify(v,null,2)+'\n';
const make=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);return e;};
let session=initialSession(),prepared=null,inspected=null,preparationError='',preview=null,busy=false,generation=0,pendingFile=null,unsaved=false;
const fail=m=>{$('error').textContent=m;$('error').hidden=!m;},status=m=>$('status').textContent=m;
const parse=text=>JSON.parse(text.replace(/^\uFEFF/,''));
const mappingDirty=()=>session.project&&session.editor.mappingText!==json(session.project.mapping);
const draftCount=()=>Object.keys(session.editor.fieldDrafts).length+Object.keys(session.editor.tableDrafts).length;
function invalidate(){generation++;preview=null;unsaved=true;$('mapping-result').textContent='Draft changed. Preview the complete mapping before reviewing its new edition.';controls();}
function download(body,name,type='application/json;charset=utf-8'){const b=body instanceof Blob?body:new Blob([body],{type}),url=URL.createObjectURL(b),a=make('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function controls(){
 for(const e of document.querySelectorAll('.twenty-root input,.twenty-root select,.twenty-root textarea,.twenty-root button'))e.disabled=busy;
 const p=session.project;
 for(const id of ['save','export','preview','apply','restore-mapping','mapping-editor','mapping-table','mapping-field','save-table','remove-table','add-table','save-field','remove-field','reload-field'])$(id).disabled=busy||!p;
 $('export').disabled=busy||!prepared||mappingDirty()||draftCount()>0;$('save').disabled=busy||!p||mappingDirty()||draftCount()>0;
 for(const e of $('field-form').querySelectorAll('input,select,textarea'))e.disabled=busy||!p;
 for(const id of ['table','side','query','prev','next','download-table'])$(id).disabled=busy||!prepared;
 $('prev').disabled||=session.view.offset===0;
 if(prepared){const rows=selectedRows()?.rows??[],q=session.view.query.toLocaleLowerCase();$('next').disabled||=session.view.offset+100>=rows.filter(r=>!q||JSON.stringify(r).toLocaleLowerCase().includes(q)).length;}
 $('selected-file').hidden=!pendingFile;
}
async function run(fn){if(busy)return;busy=true;fail('');controls();try{await fn();}catch(e){fail(e.message);status('Current source and unfinished work remain retained. Download the working copy or selected original file before closing.');}finally{busy=false;controls();}}
function adopt(next,{dirty=true}={}){
 const checked=receiveSession(next);let pp=null,ii=null,error='';
 if(checked.project){try{ii=inspectCapture(checked.project.capture);pp=prepareProviderMigration({capture:checked.project.capture,mapping:checked.project.mapping});}catch(e){error=e.message;}}
 session=checked;prepared=pp;inspected=ii;preparationError=error;preview=null;generation++;unsaved=dirty;render();
 if(error)fail(error);
}
function setProject(p){const s=clone(session);s.project=validateProject(p);s.projectSha256=digest(p);s.editor.mappingText=json(p.mapping);s.editor.projectId=p.id;s.editor.title=p.title;s.editor.approve=false;s.editor.fieldDrafts={};s.editor.tableDrafts={};s.view.offset=0;adopt(s);}
function option(value,label=value){const e=make('option',label);e.value=String(value);return e;}
function options(id,list,wanted){$(id).replaceChildren(...list.map(x=>option(x.value,x.label)));if(list.some(x=>String(x.value)===String(wanted)))$(id).value=String(wanted);}
function fullSourceRow(name,body,pin){const row=make('div');row.className='source';const label=make('div');label.append(make('strong',name),make('p',pin.bytes+' bytes'),make('code',pin.sha256));const b=make('button','Download complete file');b.onclick=()=>download(body,name.split('/').at(-1));row.append(label,b);return row;}
function render(){
 const e=session.editor,p=session.project;
 for(const [id,key]of [['project-id','projectId'],['title','title'],['mapping-editor','mappingText'],['actor','actor'],['reason','reason']])$(id).value=e[key];
 $('approve').checked=e.approve;$('query').value=session.view.query;$('side').value=session.view.side;
 $('intake-list').replaceChildren(...Object.entries(session.intake).filter(([,x])=>x).map(([kind,x])=>fullSourceRow(kind+': '+x.filename,x.text,x)));
 $('selection').textContent=p?json({id:p.id,revision:p.revision,captureSha256:p.captureSha256,mappingSha256:digest(p.mapping),approval:p.approval,sourceFiles:prepared?.files.length??0,selectedTables:prepared?.manifest.tables.length??0,consistency:prepared?.manifest.consistency??null,preparationError:preparationError||null}):'No project selected. Original intake can be saved in an unfinished working copy.';
 options('table',(prepared?.manifest.tables??[]).map(t=>({value:t.name,label:t.name})),session.view.table);session.view.table=$('table').value;
 const summary=make('table'),head=make('tr');for(const x of ['Table','Original source rows','Captured destination rows','Business key'])head.append(make('th',x));summary.append(head);
 for(const t of prepared?.manifest.tables??[]){const row=make('tr');for(const x of [t.name,t.sourceRows,t.expectedRows,t.primaryKey.join(', ')])row.append(make('td',x));summary.append(row);}$('table-summary').replaceChildren(summary);
 $('relationship-report').textContent=json({consistency:prepared?.manifest.consistency??null,relationships:prepared?.manifest.relationships??[],preparationError:preparationError||null});
 $('projection').textContent=prepared?.files.find(x=>x.path==='projection.json')?.content??'Complete projection appears after the saved mapping is valid.';
 const ff=prepared?.files??(p?[{path:'capture.json',content:json(p.capture),...textPin(json(p.capture))},{path:'mapping.json',content:json(p.mapping),...textPin(json(p.mapping))}]:[]);
 $('source-list').replaceChildren(...ff.map(x=>fullSourceRow(x.path,x.content,x)));
 $('history-list').replaceChildren(...(p?[{revision:0,at:p.createdAt,mapping:p.initialMapping},...p.history]:[]).map(h=>{const d=make('details');d.append(make('summary','Edition '+h.revision+' · '+(h.actor||'original input')+' · '+h.at),make('pre',json(h)));const b=make('button','Download complete mapping edition');b.onclick=()=>download(json(h.mapping),'mapping-edition-'+h.revision+'.json');d.append(b);return d;}));
 $('native-command').textContent='node adaptations/twenty/receive.mjs \\\n  --project /absolute/path/project.json \\\n  --directory /absolute/path/original-workspace \\\n  --receiving-directory /absolute/path/independent-receiving \\\n  --runtime-ready /absolute/path/runtime-ready.json \\\n  --operation YOUR_STABLE_OPERATION \\\n  --actor YOUR_ORIGINAL_OPERATOR';
 renderMapping();renderRows();showTab(session.view.tab,false);controls();
}
function selectedRows(){const t=prepared?.manifest.tables.find(x=>x.name===session.view.table);if(!t)return null;const path=session.view.side==='source'?t.sourcePath:t.expectedPath,file=prepared.files.find(x=>x.path===path),value=parse(file.content);return {table:t,file,rows:Array.isArray(value)?value:value.rows.map(cells=>Object.fromEntries(t.columns.map((c,i)=>[c.name,cells[i].type==='null'?null:cells[i].value])))};}
function renderRows(){
 const chosen=selectedRows();if(!chosen){$('thead').replaceChildren();$('tbody').replaceChildren();$('row-count').textContent='No complete selected population prepared.';return;}
 const q=session.view.query.toLocaleLowerCase(),rows=chosen.rows.map((r,i)=>({r,i})).filter(x=>!q||JSON.stringify(x.r).toLocaleLowerCase().includes(q));if(session.view.offset>=rows.length)session.view.offset=Math.max(0,Math.floor((rows.length-1)/100)*100);
 const header=make('tr');header.append(make('th','Original row'));for(const c of chosen.table.columns)header.append(make('th',c.name));$('thead').replaceChildren(header);
 $('tbody').replaceChildren(...rows.slice(session.view.offset,session.view.offset+100).map(({r,i})=>{const tr=make('tr');tr.append(make('td',i+1));for(const c of chosen.table.columns){const td=make('td'),v=r[c.name],text=v===null?'null':typeof v==='string'?v:JSON.stringify(v);if(text.length>180){const d=make('details');d.append(make('summary',text.slice(0,100)+'…'),make('pre',text));td.append(d);}else td.textContent=text;tr.append(td);}return tr;}));
 $('row-count').textContent=rows.length?'Rows '+(session.view.offset+1)+'–'+Math.min(session.view.offset+100,rows.length)+' of '+rows.length+' matching · '+chosen.rows.length+' complete rows':'No matching rows · '+chosen.rows.length+' complete rows';controls();
}
const fieldBindings={name:'field-name',type:'field-type',nullable:'field-nullable',precision:'field-precision',scale:'field-scale',sourcePointer:'source-pointer',targetPointer:'target-pointer',sourceMissing:'source-missing',targetMissing:'target-missing',sourceValue:'source-value',targetValue:'target-value',sourceTransform:'source-transform',targetTransform:'target-transform'};
const tableBindings={name:'table-name',sourceObject:'source-object',targetObject:'target-object',primaryKey:'table-key'};
function draftMapping(){const m=parse(session.editor.mappingText);if(!m||typeof m!=='object'||!Array.isArray(m.tables))throw Error('The complete mapping needs a tables array.');return m;}
function fieldBasis(t,c){return digest({name:t.name,sourceObject:t.sourceObject,targetObject:t.targetObject,column:c??null});}
function fieldView(t,c){return {name:c?.name??'',type:c?.type??'text',nullable:c?.nullable??false,precision:String(c?.precision??''),scale:String(c?.scale??''),sourcePointer:c?.source?.pointer??'',targetPointer:c?.target?.pointer??'',sourceMissing:c?.source?.missing?.mode??'error',targetMissing:c?.target?.missing?.mode??'error',sourceValue:json(c?.source?.missing?.value??null),targetValue:json(c?.target?.missing?.value??null),sourceTransform:c?.source?.transform?json(c.source.transform):'',targetTransform:c?.target?.transform?json(c.target.transform):'',basisSha256:fieldBasis(t,c)};}
function fieldKey(){return session.view.mappingTable+'|'+session.view.mappingField;}
function renderMapping(){try{return renderMappingBody();}catch(error){$('captured-fields').textContent='The complete mapping draft needs review: '+error.message;options('mapping-table',[],'');options('mapping-field',[],'');}}
function renderMappingBody(){
 let m;try{m=draftMapping();}catch(e){$('captured-fields').textContent=e.message;options('mapping-table',[],'');options('mapping-field',[],'');return;}
 options('mapping-table',m.tables.map((t,i)=>({value:i,label:t.name||'Unnamed table '+i})),session.view.mappingTable);session.view.mappingTable=$('mapping-table').value||'0';const t=m.tables[Number(session.view.mappingTable)];
 if(!t){options('mapping-field',[],'');return;}
 const cols=Array.isArray(t.columns)?t.columns:[];
 options('mapping-field',[...cols.map((c,i)=>({value:i,label:c.name||'Unnamed column '+i})),{value:'new',label:'New mapped field'}],session.view.mappingField);session.view.mappingField=$('mapping-field').value||'new';
 for(const side of ['source','target']){const names=inspected?[...inspected[side].objects.keys()]:[],wanted=t[side+'Object'];if(wanted&&!names.includes(wanted))names.push(wanted);options(side+'-object',names.map(name=>({value:name,label:name})),wanted);}
 const td=session.editor.tableDrafts[session.view.mappingTable]??{name:t.name??'',sourceObject:t.sourceObject??'',targetObject:t.targetObject??'',primaryKey:(t.primaryKey??[]).join(', '),basisSha256:digest(t)};
 for(const [k,id]of Object.entries(tableBindings)){$(id).value=td[k]??'';if($(id).tagName==='SELECT'&&td[k]&&!$(id).value){$(id).append(option(td[k]));$(id).value=td[k];}}
 const c=session.view.mappingField==='new'?null:cols[Number(session.view.mappingField)],d=session.editor.fieldDrafts[fieldKey()]??fieldView(t,c);
 for(const [k,id]of Object.entries(fieldBindings)){if(k==='nullable')$(id).checked=d[k]===true;else $(id).value=d[k]??'';}
 $('captured-fields').textContent=inspected?json({source:[...inspected.source.objects].map(([name,x])=>({name,spec:x.spec,schema:x.schema,rows:x.records.length})),target:[...inspected.target.objects].map(([name,x])=>({name,spec:x.spec,schema:x.schema,rows:x.records.length}))}):'Original object details will appear after the complete capture is valid.';
}
function retainField(){let m;try{m=draftMapping();}catch{return;}const t=m.tables[Number(session.view.mappingTable)];if(!t)return;const c=session.view.mappingField==='new'?null:t.columns?.[Number(session.view.mappingField)],prior=session.editor.fieldDrafts[fieldKey()]??fieldView(t,c);const d={...prior};for(const [k,id]of Object.entries(fieldBindings))d[k]=k==='nullable'?$(id).checked:$(id).value;session.editor.fieldDrafts[fieldKey()]=d;invalidate();}
function retainTable(){let m;try{m=draftMapping();}catch{return;}const t=m.tables[Number(session.view.mappingTable)];if(!t)return;const d={...(session.editor.tableDrafts[session.view.mappingTable]??{basisSha256:digest(t)})};for(const[k,id]of Object.entries(tableBindings))d[k]=$(id).value;session.editor.tableDrafts[session.view.mappingTable]=d;invalidate();}
function writeMapping(m){session.editor.mappingText=json(m);$('mapping-editor').value=session.editor.mappingText;invalidate();renderMapping();}
for(const id of Object.values(fieldBindings))$(id).addEventListener($(id).tagName==='SELECT'||id==='field-nullable'?'change':'input',retainField);
for(const id of Object.values(tableBindings))$(id).addEventListener($(id).tagName==='SELECT'?'change':'input',retainTable);
$('mapping-table').onchange=()=>{session.view.mappingTable=$('mapping-table').value;session.view.mappingField='new';generation++;unsaved=true;renderMapping();};
$('mapping-field').onchange=()=>{session.view.mappingField=$('mapping-field').value;generation++;unsaved=true;renderMapping();};
$('save-field').onclick=()=>run(async()=>{const m=draftMapping(),t=m.tables[Number(session.view.mappingTable)];if(!t)throw Error('Select the original mapped table.');const key=fieldKey(),old=session.view.mappingField==='new'?null:t.columns[Number(session.view.mappingField)],d=session.editor.fieldDrafts[key]??fieldView(t,old);if(d.basisSha256!==fieldBasis(t,old))throw Error('This field changed in the complete mapping. Download the unfinished copy, then reload this selected field before applying a correction.');
 const c={...(old??{}),name:d.name,type:d.type,nullable:d.nullable};if(c.type==='decimal'){if(!/^(0|[1-9]\d*)$/.test(d.precision.trim())||!/^(0|[1-9]\d*)$/.test(d.scale.trim()))throw Error('Decimal precision and scale must be complete integer text. The unfinished form remains retained.');c.precision=Number(d.precision.trim());c.scale=Number(d.scale.trim());if(!Number.isSafeInteger(c.precision)||c.precision<1||c.precision>38||!Number.isSafeInteger(c.scale)||c.scale<0||c.scale>c.precision)throw Error('Review decimal precision 1–38 and scale 0–precision. The unfinished form remains retained.');}else{delete c.precision;delete c.scale;}
 for(const side of ['source','target']){const missing={mode:d[side+'Missing']};if(missing.mode==='value')missing.value=parse(d[side+'Value']);c[side]={...(old?.[side]??{}),pointer:d[side+'Pointer'],missing};if(d[side+'Transform'].trim())c[side].transform=parse(d[side+'Transform']);else delete c[side].transform;}
 if(old)t.columns[Number(session.view.mappingField)]=c;else{t.columns.push(c);session.view.mappingField=String(t.columns.length-1);}delete session.editor.fieldDrafts[key];writeMapping(m);
});
$('remove-field').onclick=()=>run(async()=>{const m=draftMapping(),t=m.tables[Number(session.view.mappingTable)],i=Number(session.view.mappingField);if(!t||session.view.mappingField==='new')throw Error('Select an existing field.');if(Object.keys(session.editor.fieldDrafts).some(k=>k.startsWith(session.view.mappingTable+'|')))throw Error('Retain or reload the selected table’s unfinished field drafts before changing their positions.');if(!confirm('Remove this mapped field from the draft? Original saved editions remain.'))return;t.columns.splice(i,1);session.view.mappingField='new';writeMapping(m);});
$('save-table').onclick=()=>run(async()=>{const m=draftMapping(),i=Number(session.view.mappingTable),t=m.tables[i],d=session.editor.tableDrafts[String(i)];if(!t||!d)throw Error('Edit the selected table settings first.');if(d.basisSha256!==digest(t))throw Error('This table changed while its settings were unfinished. Save the working copy and reload the selected draft before applying.');Object.assign(t,{name:d.name,sourceObject:d.sourceObject,targetObject:d.targetObject,primaryKey:d.primaryKey.split(',').map(s=>s.trim()).filter(Boolean)});delete session.editor.tableDrafts[String(i)];writeMapping(m);});
$('add-table').onclick=()=>run(async()=>{const m=draftMapping();m.tables.push({name:'',sourceObject:'',targetObject:'',primaryKey:[],columns:[]});session.view.mappingTable=String(m.tables.length-1);session.view.mappingField='new';writeMapping(m);});
$('remove-table').onclick=()=>run(async()=>{const m=draftMapping(),i=Number(session.view.mappingTable);if(!m.tables[i])throw Error('Select a table.');if(draftCount())throw Error('Retain or reload unfinished field/table drafts before changing table positions.');if(!confirm('Remove the selected mapped table from this draft? Original saved editions remain.'))return;m.tables.splice(i,1);session.view.mappingTable='0';session.view.mappingField='new';writeMapping(m);});
$('reload-field').onclick=()=>run(async()=>{if(!confirm('Reload the selected field and table settings from the complete mapping draft? Download the working copy first to retain the unfinished form.'))return;delete session.editor.fieldDrafts[fieldKey()];delete session.editor.tableDrafts[session.view.mappingTable];invalidate();renderMapping();});
for(const id of ['project-file','capture-file','mapping-file'])$(id).addEventListener('change',e=>{
 const file=e.target.files?.[0],token=++generation;let adopted=false;pendingFile=file??null;controls();if(!file)return;
 run(async()=>{if(file.size>MAX_BYTES)throw Error('The complete selected file exceeds 512 MiB.');const bytes=new Uint8Array(await file.arrayBuffer());if(token!==generation||e.target.files?.[0]!==file)return;
 const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);if(textPin(text).bytes!==file.size)throw Error('The complete UTF-8 input differs from its selected byte count.');const value=parse(text);
 if(id==='project-file'){const candidate=receiveSession(value);if(unsaved&&!confirm('Open this complete workspace? Download the current unfinished copy first if it must be retained.'))return;if(token!==generation)return;adopt(candidate,{dirty:false});adopted=true;status('Reopened complete source, saved review history and unfinished drafts.');}
 else{const next=clone(session),key=id==='capture-file'?'capture':'mapping';next.intake[key]=retainFile(file,text);adopt(next);adopted=true;status('Retained '+file.name+' byte for byte. Create a project after selecting both full inputs.');}
 }).finally(()=>{if((token===generation||adopted)&&e.target.files?.[0]===file)e.target.value='';});
});
$('selected-file').onclick=()=>{if(pendingFile)download(pendingFile,pendingFile.name);};
$('create').onclick=()=>run(async()=>{if(!session.intake.capture||!session.intake.mapping)throw Error('Retain the complete capture and mapping first.');if(session.project&&unsaved&&!confirm('Create a separate project from retained inputs? Download the current working copy to preserve it first.'))return;const capture=parse(session.intake.capture.text),mapping=parse(session.intake.mapping.text);inspectCapture(capture);setProject(newProject({id:session.editor.projectId.trim(),title:session.editor.title.trim(),capture,mapping,at:new Date().toISOString()}));status('Created original project. Review complete field mapping and independent populations.');});
for(const [id,key]of [['project-id','projectId'],['title','title'],['actor','actor'],['reason','reason']])$(id).addEventListener('input',()=>{session.editor[key]=$(id).value;invalidate();});
$('approve').onchange=()=>{session.editor.approve=$('approve').checked;invalidate();};
$('mapping-editor').oninput=()=>{session.editor.mappingText=$('mapping-editor').value;invalidate();};
$('mapping-editor').onchange=renderMapping;
$('preview').onclick=()=>run(async()=>{if(draftCount())throw Error('Apply or reload unfinished field/table forms before previewing the complete mapping.');const m=draftMapping();preview=prepareProviderMigration({capture:session.project.capture,mapping:m});$('mapping-result').textContent=json({status:'Complete draft preview; saved project unchanged',manifest:preview.manifest});});
$('apply').onclick=()=>run(async()=>{if(draftCount())throw Error('Apply or reload unfinished field/table forms before saving the whole mapping.');const mapping=draftMapping();prepareProviderMigration({capture:session.project.capture,mapping});const request={operationId:crypto.randomUUID().replaceAll('-',''),projectId:session.project.id,captureSha256:session.project.captureSha256,expectedRevision:session.project.revision,mapping,actor:session.editor.actor.trim(),reason:session.editor.reason.trim(),approve:session.editor.approve,at:new Date().toISOString()};const result=applyMapping(session.project,request);setProject(result.project);$('mapping-result').textContent='Saved attributed edition '+result.revision+'. Download the complete project before native receiving.';});
$('restore-mapping').onclick=()=>run(async()=>{if((mappingDirty()||draftCount())&&!confirm('Restore the complete saved mapping and clear its unfinished field/table forms? Download the working copy to retain them first.'))return;setProject(session.project);status('Restored the selected saved mapping. Original review history is unchanged.');});
$('save').onclick=()=>run(async()=>{if(mappingDirty()||draftCount())throw Error('Save an attributed mapping edition or restore it before downloading the complete native project.');download(serializeProject(session.project),'project.json');status('Downloaded complete native project. Use Save unfinished working copy to retain original intake filenames and all editor settings.');});
$('save-working').onclick=()=>run(async()=>{download(serializeSession(session),'twenty-working-copy.json');unsaved=false;status('Downloaded the complete working source, exact intake files, saved editions and unfinished forms.');});
$('export').onclick=()=>run(async()=>{if(mappingDirty()||draftCount())throw Error('Save the complete attributed mapping before exporting its prepared source.');const pp=prepareProviderMigration({capture:session.project.capture,mapping:session.project.mapping}),projectText=serializeProject(session.project),files=[...pp.files,{path:'review/project.json',content:projectText,...textPin(projectText)}];const packet={schema:'tjlabs.provider-prepared-source.v1',projectId:session.project.id,revision:session.project.revision,captureSha256:session.project.captureSha256,manifest:pp.manifest,files,receiving:'Retain complete review/project.json through the original native continuation, then reopen the full native workspace.'};const text=json(packet);if(textPin(text).bytes>MAX_BYTES)throw Error('The full prepared packet exceeds 512 MiB. Continue natively from the saved original project.');download(text,'provider-prepared-source.json');status('Downloaded all prepared files and the exact saved project.');});
$('download-table').onclick=()=>run(async()=>{const chosen=selectedRows();if(chosen)download(chosen.file.content,chosen.file.path.split('/').at(-1));});
for(const id of ['table','side','query'])$(id).addEventListener(id==='query'?'input':'change',()=>{session.view[id]=$(id).value;session.view.offset=0;generation++;unsaved=true;renderRows();});
$('prev').onclick=()=>{session.view.offset=Math.max(0,session.view.offset-100);generation++;unsaved=true;renderRows();};$('next').onclick=()=>{session.view.offset+=100;generation++;unsaved=true;renderRows();};
function showTab(tab,dirty=true){session.view.tab=tab;for(const b of document.querySelectorAll('[data-tab]'))b.setAttribute('aria-selected',String(b.dataset.tab===tab));for(const n of document.querySelectorAll('.tab'))n.hidden=n.id!==tab;if(dirty){generation++;unsaved=true;}}
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>showTab(b.dataset.tab);
window.addEventListener('beforeunload',e=>{if(unsaved){e.preventDefault();e.returnValue='';}});
render();document.documentElement.dataset.providerReviewReady='true';
