'use strict';
(function(){
const M=createMetadataDesk({hash:sha256Utf8,uuid:()=>crypto.randomUUID(),now:()=>new Date().toISOString()});
let w=globalThis.METADATA_DESK_INITIAL?M.validate(globalThis.METADATA_DESK_INITIAL.working):M.newWorkspace('Metadata commissioning project'),rawDraft=globalThis.METADATA_DESK_INITIAL?.rawDraft||'',dirty=false,storedVersion=0,saving=false,pending=false,busy=false,tab='overview',selectedRow='',filter='',message='';
const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const packet=()=>({schema:'tjl.datahub.working-file.v1',working:w,rawDraft});
const status=s=>{$('status').textContent=s;message=s;};
function download(text,name,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type})),a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function changed(){w.revision++;dirty=true;pending=true;status('Saving current work…');scheduleSave();}
let timer;
function scheduleSave(){clearTimeout(timer);timer=setTimeout(persist,350);}
const dbPromise=new Promise((resolve,reject)=>{try{const r=indexedDB.open('tjl-metadata-handover',1);r.onupgradeneeded=()=>r.result.createObjectStore('projects',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}catch(e){reject(e);}});
dbPromise.catch(()=>{});
async function persist(){
 if(saving){pending=true;return;}saving=true;pending=false;const selected=w,revision=w.revision,captured=JSON.stringify(packet()),expected=storedVersion;
 try{const db=await dbPromise;
  const version=await new Promise((resolve,reject)=>{const tx=db.transaction('projects','readwrite'),store=tx.objectStore('projects'),q=store.get(selected.id);let conflict;
   q.onsuccess=()=>{const actual=q.result?.version||0;if(actual!==expected){conflict=Error('Another browser page saved this project. Download your complete work, then reopen the chosen edition.');tx.abort();return;}
    store.put({id:selected.id,title:selected.title,version:actual+1,updated_at:new Date().toISOString(),text:captured});};
   tx.oncomplete=()=>resolve(expected+1);tx.onerror=tx.onabort=()=>reject(conflict||tx.error||Error('Browser save failed.'));
  });
  if(w.id===selected.id){storedVersion=Math.max(storedVersion,version);if(w===selected&&w.revision===revision){dirty=false;status('Complete browser copy saved. Download the full JSON for handover.');}else pending=true;}
 }catch(e){status('Current work remains open. Download complete JSON before closing. '+e.message);dirty=true;pending=false;}
 finally{saving=false;if(pending)scheduleSave();}
}
async function locked(fn){
 if(busy)return;busy=true;const disabled=[...document.querySelectorAll('button,input,textarea,select')].map(e=>[e,e.disabled]);disabled.forEach(([e])=>e.disabled=true);
 try{await fn();}catch(e){status(e.message);}finally{busy=false;disabled.forEach(([e,d])=>{if(e.isConnected)e.disabled=d;});}
}
function button(text,fn){const b=node('button',text);b.type='button';b.onclick=()=>locked(fn);return b;}
function field(label,value,change,{rows=2,type='text'}={}){
 const box=node('label',label),input=node(rows>1?'textarea':'input');if(rows>1)input.rows=rows;else input.type=type;input.value=value;
 input.oninput=()=>{change(input.value);changed();};box.append(input);return box;
}
function labelInput(text,input){const label=node('label',text);label.append(input);return label;}
function choose(label,options,value,fn){
 const box=node('label',label),s=node('select');s.append(new Option('Choose…',''));for(const o of options)s.append(new Option(o.label,o.id));s.value=value;s.onchange=()=>{fn(s.value);changed();render();};box.append(s);return box;
}
function table(rows,cols){
 const wrapper=node('div',undefined,'table-scroll'),t=node('table'),head=node('thead'),tr=node('tr');cols.forEach(([key,label])=>tr.append(node('th',label)));head.append(tr);t.append(head);
 const body=node('tbody');for(const row of rows){const r=node('tr');for(const[key]of cols){const td=node('td');const v=typeof row[key]==='function'?row[key]():row[key];if(v instanceof Node)td.append(v);else td.textContent=v==null?'':String(v);r.append(td);}body.append(r);}t.append(body);wrapper.append(t);return wrapper;
}
function section(title){const s=node('section');s.append(node('h2',title));$('content').append(s);return s;}
function draft(key,initial){w.editorDrafts=w.editorDrafts||{};return w.editorDrafts[key]||(w.editorDrafts[key]=initial);}
function keepInput(input,obj,key){input.value=obj[key]||'';input.oninput=()=>{obj[key]=input.value;changed();};return input;}
async function receiveComplete(text){const result=M.receiveWorkspace(w,text);let record;try{const db=await dbPromise;record=await new Promise((resolve,reject)=>{const tx=db.transaction('projects'),r=tx.objectStore('projects').get(result.working.id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}catch(e){status('Browser storage is unavailable; download the complete workspace before closing. '+e.message);}if(record){result.working.received_originals.push({at:new Date().toISOString(),label:'Previous browser project before explicit incoming edition',text:record.text,sha256:sha256Utf8(record.text).sha256});}w=result.working;rawDraft=result.rawDraft;storedVersion=record?.version||0;}
function comparison(){try{return M.compare(w);}catch(e){return null;}}
function render(){
 $('project-title').value=w.title;$('tabs').querySelectorAll('button').forEach(b=>b.setAttribute('aria-current',b.dataset.tab===tab?'page':'false'));$('content').replaceChildren();
 const c=comparison();
 if(tab==='overview'){
  const a=section('Project and receiving selection');for(const[k,v]of Object.entries(w.selection))if(!k.endsWith('_snapshot'))a.append(field(k.replaceAll('_',' '),v,x=>w.selection[k]=x));
  a.append(choose('Expected source edition',w.snapshots.filter(s=>s.observation.role==='source'),w.selection.source_snapshot,x=>w.selection.source_snapshot=x));
  a.append(choose('Observed target edition',w.snapshots.filter(s=>s.observation.role==='target'),w.selection.target_snapshot,x=>{w.selection.target_snapshot=x;const s=w.snapshots.find(s=>s.id===x);if(s?.observation.target_url)w.selection.target_url=s.observation.target_url;}));
  const summary=section('Current comparison');
  if(c){summary.append(table(Object.entries(c.counts).map(([state,count])=>({state,count})),[['state','Aspect state'],['count','Count']]));summary.append(node('p',c.entities.length+' selected source entities; '+c.entities.filter(x=>x.state==='present').length+' observed present in the target. '+c.errors.length+' source/readback errors. '+c.timeseries_source_count+' retained source time-series records are listed separately.'));}
  else summary.append(node('p','Import the SDK-normalized source observation and complete target readback, then select both editions.'));
  const guide=section('Working sequence');const ol=node('ol');['Normalize the retained complete DataHub source with the pinned SDK helper.','Import its source observation; collect every selected target entity using native/datahub_handover.py collect.','Compare actual current aspects, inspect fields and relationships, and record named decisions.','Prepare explicit changes against a selected target observation and export a reviewed plan.','Run the native apply/recover command on the selected GMS; import its complete run and fresh readback.','Export the complete project, report, registers and handover; reopen them in the receiving installation.'].forEach(t=>ol.append(node('li',t)));guide.append(ol);
 }else if(tab==='snapshots'){
  const s=section('Retained observations');s.append(node('p','Each import retains its complete original file. Target observations include the original HTTP readbacks. Source time-series records remain separate from current-aspect acceptance.'));
  s.append(table(w.snapshots.map(x=>({label:x.label,role:x.observation.role,entities:x.observation.entries.length,aspects:x.observation.entries.reduce((n,e)=>n+Object.keys(e.aspects).length,0),timeseries:x.observation.timeseries.length,errors:x.observation.errors.length,original:()=>button('Download original',()=>download(x.original_text,x.id+'.json'))})),[['label','Edition'],['role','Role'],['entities','Entities'],['aspects','Current aspects'],['timeseries','Time series'],['errors','Errors'],['original','Source file']]));
  for(const x of w.snapshots){const d=node('details'),h=node('summary',x.label+' · source and readback details');d.append(h,node('pre',JSON.stringify({id:x.id,sha256:x.original_sha256,origin:x.observation.normalization||x.observation.target_url,errors:x.observation.errors,timeseries:x.observation.timeseries},null,2)));s.append(d);}
 }else if(tab==='compare'){
  const s=section('Aspect comparison and decisions');if(!c){s.append(node('p','Choose complete source and target observations first.'));return;}
  const search=node('input');search.placeholder='Filter URN, aspect or state';search.value=filter;search.oninput=()=>{filter=search.value;drawRows();};s.append(labelInput('Filter comparison',search));const rows=node('div');s.append(rows);
  function drawRows(){const decisions=M.currentDecisions(w,c);rows.replaceChildren(table(c.rows.filter(r=>(r.urn+' '+r.aspect+' '+r.state).toLowerCase().includes(filter.toLowerCase())).map(r=>({urn:r.urn,aspect:r.aspect,state:r.state,decision:decisions.get(r.key)?.outcome||'',open:()=>button('Inspect',()=>{selectedRow=r.key;render();})})),[['urn','Entity URN'],['aspect','Aspect'],['state','State'],['decision','Decision'],['open','Review']]));}
  drawRows();const r=c.rows.find(r=>r.key===selectedRow);
  if(r){const detail=section(r.aspect+' · '+r.urn),cols=node('div',undefined,'comparison-columns');for(const[label,text]of [['Expected source',r.source_text],['Observed target',r.target_text]]){const d=node('div');d.append(node('h3',label),node('pre',text??'(aspect absent)'));cols.append(d);}detail.append(cols);
   const form=draft('review:'+c.id+':'+r.key,{reviewer:w.selection.reviewer,reason:'',outcome:'investigate',aspect_json:r.target_text||'',change_reason:''});const reviewer=node('input'),reason=node('textarea'),outcome=node('select');reviewer.placeholder='Reviewer name';keepInput(reviewer,form,'reviewer');reason.placeholder='Decision reason';reason.rows=3;keepInput(reason,form,'reason');['accepted','correct','investigate'].forEach(x=>outcome.append(new Option(x,x)));outcome.value=form.outcome;outcome.onchange=()=>{form.outcome=outcome.value;changed();};detail.append(labelInput('Reviewer',reviewer),labelInput('Outcome',outcome),labelInput('Reason',reason),button('Record decision',()=>{M.decision(w,c.id,r.key,outcome.value,reviewer.value,reason.value);changed();render();}));
   if(r.target_text!==null){const edit=node('textarea');edit.rows=15;keepInput(edit,form,'aspect_json');const changeReason=node('textarea');keepInput(changeReason,form,'change_reason');changeReason.placeholder='Why this exact target aspect should change';detail.append(node('h3','Proposed complete target aspect'),node('p','Editing begins with the full observed target so unrelated fields remain visible. The native operator checks this original before writing.'),labelInput('Complete proposed aspect JSON',edit),labelInput('Proposed change reason',changeReason),button('Retain proposed change',()=>{M.propose(w,r.urn,r.aspect,edit.value,reviewer.value,changeReason.value);changed();tab='changes';render();}));}
  }
  const rel=section('Selected source relationships');const graph=M.relationships(M.snapshot(w,c.source_id));rel.append(table(graph.edges,[['from','From'],['to','To'],['kind','Relationship'],['detail','Detail'],['in_selected_population','Target in selected population']]));rel.append(node('p','A referenced entity outside the selected population is an explicit scope question; this observation alone does not establish a broken reference.'));if(graph.issues.length)rel.append(node('pre',JSON.stringify(graph.issues,null,2)));
 }else if(tab==='changes'){
  const s=section('Reviewed change editions');s.append(node('p','Select one proposed edition for each aspect. Changes retain the complete before/after JSON and the specific observed target. Earlier proposals stay available.'));
  const releaseDraft=draft('release',{name:'',reviewer:w.selection.reviewer,selected:[]});const choices=[];s.append(table(w.proposals.map(p=>{const input=node('input');input.type='checkbox';input.value=p.id;input.checked=releaseDraft.selected.includes(p.id);input.onchange=()=>{releaseDraft.selected=choices.filter(x=>x.checked).map(x=>x.value);changed();};choices.push(input);return{select:()=>input,urn:p.urn,aspect:p.aspect,reviewer:p.reviewer,reason:p.reason,at:p.at};}),[['select','Select'],['urn','Entity'],['aspect','Aspect'],['reviewer','Owner'],['reason','Reason'],['at','Prepared']]));
  const name=node('input'),reviewer=node('input');name.placeholder='Release name';reviewer.placeholder='Release reviewer';keepInput(name,releaseDraft,'name');keepInput(reviewer,releaseDraft,'reviewer');s.append(labelInput('Release name',name),labelInput('Release reviewer',reviewer),button('Download reviewed native plan',()=>{const p=M.proposalPacket(w,choices.filter(x=>x.checked).map(x=>x.value),name.value,reviewer.value);download(JSON.stringify(p,null,2)+'\n','DataHub_Change_Plan.json');w.notes.push({id:crypto.randomUUID(),at:new Date().toISOString(),kind:'exported-change-plan',plan:p});changed();}));
  for(const p of w.proposals){const d=node('details');d.append(node('summary',p.aspect+' · '+p.id),node('h3','Before'),node('pre',p.before_json),node('h3','After'),node('pre',p.after_json));const revert=draft('revert:'+p.id,{reviewer:w.selection.reviewer,reason:''});d.append(field('Revert reviewer',revert.reviewer,x=>revert.reviewer=x,{rows:1}),field('Reason for reverting to the original before value',revert.reason,x=>revert.reason=x),button('Prepare revert against fresh target',()=>{M.proposeRevert(w,p.id,revert.reviewer,revert.reason);changed();render();}));s.append(d);}
 }else if(tab==='runs'){
  const s=section('Actual native operations');s.append(node('p','Import complete run.json from the original native apply/recover directory. A returned response and an observed final aspect remain separate events.'));
  if(!w.runs.length)s.append(node('p','No native run imported.'));
  for(const x of w.runs){const d=node('details');d.append(node('summary',x.run.id+' · '+(x.run.complete?'complete readback':'continuing')),node('pre',JSON.stringify(x.run,null,2)),button('Download original run',()=>download(x.original_text,x.run.id+'.json')));s.append(d);}
 }else if(tab==='handover'){
  const s=section('Complete handover');s.append(button('Download complete workspace',()=>{M.validate(w);download(JSON.stringify(packet(),null,2)+'\n','DataHub_Workspace.json');status('Complete workspace download prepared, including incoming originals and unfinished raw writing.');}));
  s.append(button('Download comparison report JSON',()=>download(JSON.stringify(M.report(w),null,2)+'\n','DataHub_Comparison_Report.json')));
  if(c){s.append(button('Download aspect register CSV',()=>download(M.csv(c.rows),'DataHub_Aspect_Register.csv','text/csv')),button('Download decisions CSV',()=>download(M.csv(w.decisions),'DataHub_Decisions.csv','text/csv')),button('Download relationship CSV',()=>download(M.csv(M.relationships(M.snapshot(w,c.source_id)).edges),'DataHub_Relationships.csv','text/csv')));}
  const handover=draft('handover',{edition:'',note:''});const label=node('input');label.placeholder='Name a saved edition';keepInput(label,handover,'edition');s.append(labelInput('Named edition',label),button('Save named edition',()=>{M.edition(w,label.value);changed();render();}));s.append(table(w.editions.map(e=>({label:e.label,at:e.at,revision:e.revision,restore:()=>button('Restore retained edition',()=>{w=M.restoreEdition(w,e.id);changed();render();})})),[['label','Edition'],['at','Saved'],['revision','Revision'],['restore','Continue edition']]));
  const notes=node('textarea');notes.placeholder='Operator handover note';notes.rows=4;keepInput(notes,handover,'note');s.append(labelInput('Operator handover note',notes),button('Add note',()=>{if(!notes.value.trim())throw Error('Write the handover note.');w.notes.push({id:crypto.randomUUID(),at:new Date().toISOString(),kind:'operator',text:notes.value});changed();render();}));
  for(const n of w.notes)s.append(node('pre',n.kind==='operator'?n.text:JSON.stringify(n,null,2)));
  const d=node('details');d.append(node('summary','Complete editable workspace source'));const raw=node('textarea');raw.rows=18;raw.value=rawDraft||JSON.stringify(w,null,2);raw.oninput=()=>{rawDraft=raw.value;changed();};d.append(labelInput('Complete editable workspace JSON',raw),button('Use edited source',async()=>{await receiveComplete(rawDraft||raw.value);rawDraft='';changed();render();}));s.append(d);
 }
}
async function importFile(file,kind){
 if(!file)return;const text=await file.text();
 if(kind==='observation'){const s=M.importObservation(w,text,file.name);if(s.observation.role==='target'&&s.observation.target_url)w.selection.target_url=s.observation.target_url;}
 else if(kind==='run')M.receiveRun(w,text);
 else {if(saving)throw Error('Let the current browser save finish, then open the selected workspace.');await receiveComplete(text);}
 changed();render();
}
for(const[kind,id]of [['observation','import-observation'],['run','import-run'],['workspace','open-workspace']])$(id).onchange=e=>{const f=e.target.files[0];e.target.value='';locked(()=>importFile(f,kind));};
$('project-title').oninput=e=>{w.title=e.target.value;changed();};
$('new').onclick=()=>locked(async()=>{if(dirty){download(JSON.stringify(packet(),null,2)+'\n','DataHub_Previous_Workspace.json');}w=M.newWorkspace('Metadata commissioning project');rawDraft='';storedVersion=0;changed();render();});
$('download').onclick=()=>locked(()=>{M.validate(w);download(JSON.stringify(packet(),null,2)+'\n','DataHub_Workspace.json');});
$('save').onclick=()=>locked(persist);
$('open-browser').onclick=()=>locked(async()=>{const db=await dbPromise;const list=await new Promise((resolve,reject)=>{const tx=db.transaction('projects'),r=tx.objectStore('projects').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const dialog=$('browser-dialog');const body=$('browser-list');body.replaceChildren();for(const p of list){body.append(button(p.title+' · '+p.updated_at,()=>{if(dirty)download(JSON.stringify(packet(),null,2)+'\n','DataHub_Previous_Workspace.json');const incomingPacket=JSON.parse(p.text);w=M.validate(incomingPacket.working);rawDraft=incomingPacket.rawDraft||'';storedVersion=p.version;dirty=false;dialog.close();render();status('Opened the selected saved browser project.');}));}if(!list.length)body.append(node('p','No saved browser projects.'));dialog.showModal();});
$('close-dialog').onclick=()=>{$('browser-dialog').close();};
$('tabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{if(!busy){tab=b.dataset.tab;render();}});
window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
render();
})();