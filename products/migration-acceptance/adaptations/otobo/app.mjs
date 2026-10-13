// SPDX-License-Identifier: MIT
import {FAMILIES,inspectConfigurationCapture,evaluateConfigurationPlan,prepareConfigurationComparison,sealConfigurationPlan,nodeAt,canonical,hash,clone} from './core.mjs';
import {newProject,applyMapping,requireApproval,serializeProject,textPin} from './project.mjs';
import {prepareProviderMigration} from './provider-input.mjs';
import {newSession,receiveSession,serializeSession,remember,retainedInput,receiveBareProject,recordKey,MAX_BYTES} from './session.mjs';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parsePlanText=text=>JSON.parse(text.replace(/^\uFEFF/,''));
const pretty=v=>JSON.stringify(v,null,2)+'\n',now=()=>new Date().toISOString(),need=(v,m)=>{if(!v)throw Error(m);};
let session=newSession(),generation=0,selectionGeneration=0,pendingFile=null,cache=null,dirty=false,derived=null;
const captureCache=new Map();
function retainedCapture(input){const key=input.sha256+':'+input.bytes,prior=captureCache.get(key);if(prior?.text===input.text)return prior.value;const value=inspectConfigurationCapture(JSON.parse(input.text.replace(/^\uFEFF/,'')));captureCache.set(key,{text:input.text,value});if(captureCache.size>6)captureCache.delete(captureCache.keys().next().value);return value;}
const w=()=>session.working,e=()=>w().editor;
function error(value){$('error').hidden=!value;$('error').textContent=value?.message||value||'';}
function download(name,body,type='application/json;charset=utf-8'){
 const blob=body instanceof Blob?body:new Blob([body],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function changed(){generation++;dirty=true;cache=null;error(null);updateStatus();}
function adopt(next){const valid=receiveSession(next);session=valid;changed();render();}
function updateStatus(){
 const p=w().project,parts=Object.entries(w().intake).filter(([,v])=>v).map(([k,v])=>k+': '+v.filename);
 $('workspace-status').textContent=(dirty?'Unsaved working changes. ':'')+(parts.join(' · ')||'No capture selected.')+(p?' · Project '+p.id+', revision '+p.revision:'')+' · '+session.history.length+' prior working editions retained.';
 for(const id of ['download-plan','download-project','download-comparison','download-findings'])$(id).disabled=true;
 $('download-selected').hidden=!pendingFile;
}
function action(fn){return async event=>{event?.preventDefault();try{await fn(event);error(null);}catch(err){error(err);}};}
function context(){
 if(cache?.generation===generation)return cache;
 const c={generation,source:null,before:null,after:null,plan:null,review:null,comparison:null,planError:null};
 for(const role of ['source','before','after'])if(w().intake[role])c[role]=retainedCapture(w().intake[role]);
 const modelKey=[c.source?.capture.captureId,c.before?.capture.captureId,c.after?.capture.captureId].join('|');
 if(derived?.key===modelKey&&derived.text===e().planText){Object.assign(c,derived.value);cache=c;return c;}
 if(e().planText.trim())try{
  c.plan=parsePlanText(e().planText);
  if(c.source&&c.before&&c.plan.planId){c.review=evaluateConfigurationPlan({source:c.source.capture,before:c.before.capture,plan:c.plan});if(c.after)c.comparison=prepareConfigurationComparison({source:c.source.capture,before:c.before.capture,plan:c.plan,after:c.after.capture});}
 }catch(err){c.planError=err.message;}
 derived={key:modelKey,text:e().planText,value:{plan:c.plan,review:c.review,comparison:c.comparison,planError:c.planError}};cache=c;return c;
}
function decision(c,key=w().view.selected){return Array.isArray(c.plan?.decisions)?c.plan.decisions.find(d=>d&&recordKey(d.family,d.name)===key)??null:null;}
function draftFor(c,key){
 const d=decision(c,key),prior=e().decisionDrafts[key];
 if(prior)return prior;
 return{action:d?.action||'exclude',reason:d?.reason||'',genericAgentReviewed:d?.genericAgentReviewed===true,overridesText:pretty(d?.referenceOverrides||[]),basis:hash(d),overrideSourcePath:'',overrideTargetEntry:'',overrideTargetPath:'',overrideReason:''};
}
function draftChanged(d,original){
 try{return d.action!==(original?.action||'exclude')||d.reason!==(original?.reason||'')||d.genericAgentReviewed!==(original?.genericAgentReviewed===true)||canonical(JSON.parse(d.overridesText))!==canonical(original?.referenceOverrides||[]);}
 catch{return true;}
}
function unapplied(c){return Object.entries(e().decisionDrafts).filter(([key,d])=>draftChanged(d,decision(c,key))).length;}
function approvedCurrent(c){
 const p=w().project;if(!p||!c.plan||!c.review?.ready||unapplied(c))return false;
 try{requireApproval(p);return canonical(p.mapping)===canonical(c.plan)&&p.id===e().projectId&&p.title===e().title;}catch{return false;}
}
function selectOptions(element,items,value){element.innerHTML=items.map(row=>'<option value="'+esc(row.value)+'">'+esc(row.label)+'</option>').join('');element.value=value;if(element.value!==value&&items.length)element.value=items[0].value;}
function table(headers,rows){return '<div class="table-wrap"><table><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function findings(rows){return rows.length?table(['Level','Family / object','Finding'],rows.map(f=>[esc(f.severity),esc([f.family,f.name||f.identity&&JSON.stringify(f.identity)].filter(Boolean).join(' · ')),esc(f.message)+(f.code?'<br><code>'+esc(f.code)+'</code>':'')+'<details><summary>Complete finding details</summary><pre>'+esc(pretty(f))+'</pre></details>'])):'<p>No unresolved findings in this reviewed scope.</p>';}
function values(node,path=[],out=[]){if(!node)return out;if(node.kind==='map'){if(!Object.keys(node.value).length)out.push({path,kind:'map',text:'{}'});else for(const [k,v]of Object.entries(node.value))values(v,[...path,k],out);}
 else if(node.kind==='array'){if(!node.value.length)out.push({path,kind:'array',text:'[]'});else node.value.forEach((v,i)=>values(v,[...path,String(i)],out));}
 else out.push({path,kind:node.kind,text:node.kind==='null'?'null':node.value});return out;}
const pathLabel=path=>path.length?'/'+path.map(v=>v.replace(/~/g,'~0').replace(/\//g,'~1')).join('/'):'(root)';
const allowed=family=>family==='RoleGroups'?['replace-pair-permissions','keep-target','exclude']:family==='QueueTemplates'?['add-links','keep-target','exclude']:['create','overwrite','keep-target','exclude'];
function displayValue(node){return node===undefined?'<span class="muted">Absent</span>':'<code>'+esc(node.kind)+'</code><pre class="value-text">'+esc(node.kind==='null'?'null':['map','array'].includes(node.kind)?JSON.stringify(node.value,null,2):node.value)+'</pre>';}
function renderIntake(c){
 const count={};
 for(const role of ['source','before','after']){
  const x=c[role],input=w().intake[role];count[role]={};
  if(x)for(const entry of x.entries.values())count[role][entry.family]=(count[role][entry.family]||0)+1;
  $(role+'-summary').innerHTML=x?'<p><strong>'+esc(x.capture.workspaceReference)+'</strong><br>'+esc(x.capture.observedAt)+'<br>'+esc(x.capture.evidenceKind)+'</p><p>'+x.entries.size+' entries · '+x.files.size+' complete files</p><p class="hash">'+esc(x.capture.captureId)+'</p><p>'+esc(input.filename)+(input.generated?' · reconstructed capture JSON from complete project':'')+'</p>':'<p>No '+role+' capture.</p>';
  document.querySelector('[data-original="'+role+'"]').disabled=!x;
 }
 $('capture-populations').innerHTML=table(['Family','Source','Target baseline','Returned target'],FAMILIES.map(f=>[esc(f),...['source','before','after'].map(role=>c[role]?esc(count[role][f]||0)+'<br><small>'+ (c[role].capture.completeness[f]===true?'Complete selected family':'Partial / unspecified')+'</small>':'—')]));
}
function renderRecord(c){
 const key=w().view.selected,source=c.source?.entries.get(key);$('record-detail').hidden=!source;if(!source)return;
 const d=decision(c,key),draft=draftFor(c,key),review=c.review?.decisions.find(x=>recordKey(x.family,x.name)===key);
 $('record-heading').textContent=source.family+' · '+source.name;
 $('record-semantics').textContent=source.family==='RoleGroups'?'Replacing a role/group pair replaces its complete permission set. Unmentioned pairs remain unchanged. Review every permission, including rw.':source.family==='QueueTemplates'?'Selected queue-template relationships are added. Existing unrelated links remain. This plan does not remove links.':source.family==='GenericAgents'?'Review the full job actions, schedule and activation. An overwrite may replace the original job through the native importer.':'Create or overwrite uses the exact native object identity and retained fields. Dependencies and target context are checked with the complete plan.';
 selectOptions($('decision'),allowed(source.family).map(x=>({value:x,label:x})),draft.action);
 $('decision-reason').value=draft.reason;$('job-reviewed').checked=draft.genericAgentReviewed;$('job-review-label').hidden=source.family!=='GenericAgents';$('overrides-json').value=draft.overridesText;
 const sourceScalars=values(source.value).filter(v=>!['map','array'].includes(v.kind)&&v.path.length);
 selectOptions($('override-source-path'),[{value:'',label:'Select exact source field'},...sourceScalars.map(v=>({value:JSON.stringify(v.path),label:pathLabel(v.path)+' · '+v.kind}))],draft.overrideSourcePath);
 selectOptions($('override-target-entry'),[{value:'',label:'Select observed baseline entry'},...[...(c.before?.entries||[])].map(([k,x])=>({value:k,label:x.family+' · '+x.name}))],draft.overrideTargetEntry);
 renderTargetFields(c,draft);$('override-reason').value=draft.overrideReason;
 const original=c.before?.entries.get(key)?.value,proposed=review?.proposed??source.value,paths=new Map();
 for(const node of [source.value,original,proposed])for(const v of values(node))paths.set(JSON.stringify(v.path),v.path);
 $('record-fields').innerHTML=table(['Exact field','Original source','Target baseline','Reviewed proposed'],[...paths.values()].map(path=>[esc(pathLabel(path)),displayValue(nodeAt(source.value,path)),displayValue(nodeAt(original,path)),displayValue(nodeAt(proposed,path))]));
 $('record-dependencies').innerHTML='<h4>Selected dependencies</h4>'+(review?'<pre>'+esc(pretty(review.dependencies))+'</pre>':'<p>Review the complete plan to calculate selected dependencies.</p>')+(draft.basis!==hash(d)?'<p class="notice">This retained draft was opened against a different decision. Review its full source before applying it.</p>':'');
}
function renderTargetFields(c,draft){
 const target=c.before?.entries.get($('override-target-entry').value);
 selectOptions($('override-target-path'),[{value:'',label:'Select exact target scalar'},...values(target?.value).filter(v=>!['map','array'].includes(v.kind)).map(v=>({value:JSON.stringify(v.path),label:pathLabel(v.path)+' · '+v.kind+' · '+v.text.slice(0,100)}))],draft.overrideTargetPath);
}
function renderPlan(c){
 selectOptions($('family-filter'),[{value:'all',label:'All ten families'},...FAMILIES.map(x=>({value:x,label:x}))],w().view.family);$('record-filter').value=w().view.query;
 const entries=[...(c.source?.entries.values()||[])].filter(x=>(w().view.family==='all'||x.family===w().view.family)&&(!w().view.query||x.name.toLowerCase().includes(w().view.query.toLowerCase())));
 $('plan-records').innerHTML=table(['Family','Source identity','Decision','Draft','Review'],entries.map(x=>{const k=recordKey(x.family,x.name),d=decision(c,k);return[esc(x.family),esc(x.name),esc(d?.action||'Unselected'),e().decisionDrafts[k]&&draftChanged(e().decisionDrafts[k],d)?'Unapplied':'', '<button data-record="'+esc(k)+'">Review full record</button>'];}));
 $('plan-overview').innerHTML=c.planError?'<p class="notice">'+esc(c.planError)+'</p>':c.review?'<p><strong>'+(c.review.ready?'Plan is complete for the selected native scope.':'Plan has unresolved errors.')+'</strong> '+c.review.expectedRows.length+' expected comparison rows · '+c.review.importOrder.length+' selected native imports.</p>'+findings(c.review.findings):'<p>Create or open a plan, select each decision and review the complete plan. A named attributed approval is recorded separately.</p>';
 $('plan-json').value=e().planText;$('project-id').value=e().projectId;$('project-title').value=e().title;$('reviewer').value=e().reviewer;$('review-reason').value=e().reason;$('approve').checked=e().approve;
 renderRecord(c);const p=w().project;
 $('review-result').innerHTML=p?'<p>Retained project <strong>'+esc(p.id)+'</strong>, revision '+p.revision+'. '+(p.approval?'Last edition approved by '+esc(p.approval.actor)+'.':'Last edition has no native approval.')+'</p><p class="hash">'+esc(p.captureSha256)+'</p>':'<p>No attributed project edition has been saved.</p>';
 if(unapplied(c))$('review-result').innerHTML+='<p>'+unapplied(c)+' unapplied record drafts remain in the complete working copy.</p>';
 $('download-project').disabled=!p;$('download-plan').disabled=!approvedCurrent(c);
}
function renderComparison(c){
 const x=c.comparison;$('comparison-status').innerHTML=!c.after?'<p>Select the independently captured target after import to prepare a comparison.</p>':!x?'<p>Review the complete original plan to compare the returned target. '+esc(c.planError||'')+'</p>':'<p><strong>'+(x.ready?'Selected target coverage is ready for native comparison.':'Resolve unknown coverage or plan errors before native comparison.')+'</strong> '+x.differences.length+' differences in '+x.expectedRows.length+' expected rows. This browser preparation retains all values; the original native driver performs the actual comparison and acceptance.</p>';
 $('comparison-summary').innerHTML=x?table(['Family','Exact identity','Coverage'],x.coverage.map(row=>[esc(row.family),'<code>'+esc(JSON.stringify(row.identity))+'</code>',esc(row.status)])):'';
 $('comparison-records').innerHTML=x?'<h3>Complete differences</h3>'+table(['Family / identity','Expected','Observed'],x.differences.map(row=>[esc(row.family)+'<pre>'+esc(row.identity_json)+'</pre>','<pre>'+esc(row.expected)+'</pre>','<pre>'+esc(row.observed??'(not observed)')+'</pre>']))+findings(x.findings):'';
 $('download-findings').disabled=!x;$('download-comparison').disabled=!(x?.ready&&approvedCurrent(c));
}
function renderHistory(){
 const rows=[...session.history].reverse();
 $('history-list').innerHTML=rows.length?rows.map(x=>'<article><h3>Working edition '+x.id+' · '+esc(x.at)+'</h3><p>'+esc(x.reason)+'</p><p>'+esc(x.working.project?'Project '+x.working.project.id+', revision '+x.working.project.revision:'Unfinished capture / plan workspace')+'</p><div class="actions"><button data-history="'+x.id+'">Open preserved working edition</button><button data-history-download="'+x.id+'">Download complete working edition</button></div></article>').join(''):'<p>Earlier working editions appear here after source replacements, attributed reviews and explicit restarts.</p>';
 if(w().project)$('history-list').innerHTML+='<h3>Current project attributed review history</h3>'+table(['Revision','Reviewer','At','Reason','Decision'],w().project.history.map(h=>[esc(h.revision),esc(h.actor),esc(h.at),esc(h.reason),h.approval?'Approved exact capture and plan':'Draft / not approved']));
}
function renderFiles(c){
 $('source-files').innerHTML=['source','before','after'].filter(role=>c[role]).map(role=>'<article><h3>'+esc(role)+' · '+esc(c[role].capture.workspaceReference)+'</h3>'+table(['Original file','Family','Bytes','SHA-256','Download'],[...c[role].files.values()].map(x=>[esc(x.filename),esc(x.family||'Context evidence'),esc(x.bytes),'<code class="hash">'+esc(x.sha256)+'</code>','<button data-file-role="'+role+'" data-file-id="'+esc(x.id)+'">Download original bytes</button>']))+'</article>').join('')||'<p>No original files selected.</p>';
}
function renderNative(c){
 const p=w().project,approved=approvedCurrent(c),after=!!c.after;
 $('native-state').innerHTML='<p>'+(approved?'The exact current plan has a named approval.':'Save and approve the exact reviewed plan before native emission.')+' '+(after?'The independent returned target is retained.':'Target after import has not been selected.')+'</p>'+(after&&c.comparison?'<p>'+esc(c.comparison.ready?'Returned scope can be bound to the native comparison.':'Returned scope contains unresolved errors or unknown coverage.')+'</p>':'');
 $('emitter-command').textContent='Use node native/prepare-handover.mjs with the original source capture, target baseline and approved plan. This checked wrapper validates the complete plan before invoking the native emitter. See NATIVE_RECEIVING.md for the exact installed-helper options. Keep its emitted files and manifest with the original native import log.';
 $('native-command').textContent='node products/migration-acceptance/adaptations/otobo/receive.mjs \\\n  --project /absolute/path/'+(p?.id||'reviewed-project')+'.json \\\n  --directory /absolute/path/original-workspace \\\n  --receiving-directory /absolute/path/receiving \\\n  --runtime-ready /absolute/path/runtime-ready.json \\\n  --operation ORIGINAL_OPERATION \\\n  --actor REVIEWER';
}
function render(){
 updateStatus();const c=context();for(const name of ['intake','plan','comparison','history','files','native'])$('panel-'+name).hidden=w().view.tab!==name;
 for(const button of document.querySelectorAll('[data-tab]'))button.setAttribute('aria-current',button.dataset.tab===w().view.tab?'page':'false');
 renderIntake(c);renderPlan(c);renderComparison(c);renderHistory();renderFiles(c);renderNative(c);
}
function storeDecisionForm(){
 const key=w().view.selected;if(!key)return;const c=context(),base=draftFor(c,key);
 e().decisionDrafts[key]={...base,action:$('decision').value,reason:$('decision-reason').value,genericAgentReviewed:$('job-reviewed').checked,overridesText:$('overrides-json').value,
 overrideSourcePath:$('override-source-path').value,overrideTargetEntry:$('override-target-entry').value,overrideTargetPath:$('override-target-path').value,overrideReason:$('override-reason').value};changed();
}
function sealCurrent(candidate,c=context()){
 need(c.source&&c.before,'Select source and target baseline first.');need(e().reviewer.trim(),'Enter the named reviewer before sealing the complete plan.');
 need(candidate&&Array.isArray(candidate.decisions),'Retain a complete decision array.');
 return sealConfigurationPlan({source:c.source.capture,before:c.before.capture,reviewer:e().reviewer.trim(),reviewedAt:now(),decisions:candidate.decisions});
}
function preserve(reason){return remember(session,reason,now());}
function invalidatePlan(candidate){const out=clone(candidate);delete out.planId;delete out.importOrder;return out;}
async function readFile(input,kind){
 const token=++selectionGeneration;document.documentElement.dataset.otoboReading='true';pendingFile=input.files?.[0]||null;$('download-selected').hidden=!pendingFile;
 const file=pendingFile;if(!file){document.documentElement.dataset.otoboReading='false';return;}const baseGeneration=generation;
 const limit=kind==='plan'?32*1024*1024:MAX_BYTES;
 try{
  need(file.size<=limit,'Selected '+kind+' file exceeds its supported complete size. Download the original selected file to retain it.');
  const bytes=await file.arrayBuffer();
  if(token!==selectionGeneration||input.files?.[0]!==file||generation!==baseGeneration)return;
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  const value=JSON.parse(text.replace(/^\uFEFF/,''));
  let next;
  if(kind==='working'){
   next=value.schema==='otobo.review-working.v1'?receiveSession(value):receiveBareProject(value);
   if(dirty&&!confirm('Open this working copy? Download the current complete copy first if you need to keep its unsaved edits.'))return;
   if(token!==selectionGeneration||input.files?.[0]!==file||generation!==baseGeneration)return;
  }else{
   next=preserve('Before selecting '+kind+' file '+file.name);
   const nw=next.working;
   if(kind==='plan'){
    need(value?.schema==='otobo.handover-plan.v1','Select a complete OTOBO handover plan.');
    const c=context();need(c.source&&c.before,'Select source and baseline before receiving a plan.');
    evaluateConfigurationPlan({source:c.source.capture,before:c.before.capture,plan:value});
    nw.editor.planText=text;nw.editor.decisionDrafts={};nw.editor.approve=false;nw.view.tab='plan';
   }else{
    const capture=inspectConfigurationCapture(value).capture;need(capture.side===(kind==='source'?'source':'target'),'The capture has the wrong source/target role.');
    nw.intake[kind]=retainedInput(file.name,text);
    nw.project=null;nw.editor.projectId='';nw.editor.approve=false;
    if(kind==='source'||kind==='before'){
     nw.intake.after=null;nw.editor.planText='';nw.editor.decisionDrafts={};nw.view.selected=null;
    }
    nw.view.tab=kind==='after'?'comparison':'intake';
   }
  }
  adopt(next);
 }catch(err){if(token===selectionGeneration&&input.files?.[0]===file)error(err);}
 finally{if(token===selectionGeneration){document.documentElement.dataset.otoboReading='false';if(input.files?.[0]===file)input.value='';}}
}
for(const [id,kind]of [['source-file','source'],['before-file','before'],['after-file','after'],['plan-file','plan'],['restore-file','working']])$(id).addEventListener('change',event=>{event.stopPropagation();void readFile(event.target,kind);});
$('save-working').onclick=action(()=>{download('otobo-complete-working.json',serializeSession(session));dirty=false;updateStatus();render();});
$('download-selected').onclick=()=>{if(pendingFile)download(pendingFile.name,pendingFile);};
$('new-work').onclick=action(()=>{const next=preserve('Explicit new workspace; previous full captures, plan and project retained');next.working=newSession().working;adopt(next);});
for(const button of document.querySelectorAll('[data-original]'))button.onclick=()=>{const x=w().intake[button.dataset.original];if(x)download(x.filename,x.text);};
for(const button of document.querySelectorAll('[data-tab]'))button.onclick=()=>{w().view.tab=button.dataset.tab;changed();render();};
$('family-filter').onchange=()=>{w().view.family=$('family-filter').value;changed();render();};
$('record-filter').oninput=()=>{w().view.query=$('record-filter').value;changed();renderPlan(context());};
$('plan-json').oninput=()=>{e().planText=$('plan-json').value;changed();$('plan-overview').textContent='Edited plan text is retained. Review the complete plan to refresh findings.';$('comparison-status').textContent='The complete plan changed; review it before using returned-target findings.';$('comparison-summary').innerHTML='';$('comparison-records').innerHTML='';};
for(const [id,key]of [['project-id','projectId'],['project-title','title'],['reviewer','reviewer'],['review-reason','reason']])$(id).oninput=()=>{e()[key]=$(id).value;changed();};
$('approve').onchange=()=>{e().approve=$('approve').checked;changed();};
$('decision-form').addEventListener('input',event=>{if(event.target.type!=='file')storeDecisionForm();});
$('decision-form').addEventListener('change',event=>{if(event.target.type==='file')return;storeDecisionForm();if(event.target.id==='override-target-entry')renderTargetFields(context(),e().decisionDrafts[w().view.selected]);});
$('make-plan').onclick=action(()=>{
 const c=context();need(c.source&&c.before,'Select both source and target baseline.');
 const next=preserve('Before creating a complete decision draft');
 next.working.editor.planText=pretty({schema:'otobo.handover-plan.v1',caseId:c.source.capture.caseId,sourceCaptureId:c.source.capture.captureId,targetCaptureId:c.before.capture.captureId,expectedParser:c.source.capture.environment.parser,
 decisions:[...c.source.entries.values()].map(x=>({sourceFileId:x.fileId,family:x.family,name:x.name,action:c.before.entries.has(recordKey(x.family,x.name))?'keep-target':'exclude',reason:'Initial draft; retain target or exclude until the operator reviews this source entry.'}))});
 next.working.editor.decisionDrafts={};next.working.editor.approve=false;adopt(next);
});
$('plan-records').onclick=action(event=>{const button=event.target.closest('[data-record]');if(!button)return;w().view.selected=button.dataset.record;changed();renderRecord(context());});
$('add-override').onclick=action(()=>{
 storeDecisionForm();const c=context(),key=w().view.selected,d=e().decisionDrafts[key],entry=c.before.entries.get(d.overrideTargetEntry);
 need(entry&&d.overrideSourcePath&&d.overrideTargetPath&&d.overrideReason.trim(),'Select both exact scalar paths and enter the reason.');
 const path=JSON.parse(d.overrideSourcePath),targetPath=JSON.parse(d.overrideTargetPath),node=nodeAt(entry.value,targetPath);
 need(node&&!['map','array'].includes(node.kind),'Select an actual retained target scalar.');
 const overrides=JSON.parse(d.overridesText);need(Array.isArray(overrides),'Reference overrides must be an array.');
 overrides.push({path,targetFileId:entry.fileId,targetName:entry.name,targetPath,reason:d.overrideReason});
 d.overridesText=pretty(overrides);changed();renderRecord(context());
});
$('decision-form').onsubmit=action(()=>{
 storeDecisionForm();const c=context(),key=w().view.selected,d=e().decisionDrafts[key],original=decision(c,key),source=c.source.entries.get(key);
 need(c.plan&&original,'Create or open the complete plan first.');need(d.basis===hash(original),'This draft belongs to a prior decision. Save the complete working copy and reopen the current decision before applying it.');
 need(d.reason.trim(),'Enter a concrete decision reason.');const overrides=JSON.parse(d.overridesText);need(Array.isArray(overrides),'Reference overrides must be an array.');
 const candidate=invalidatePlan(c.plan),replacement={sourceFileId:source.fileId,family:source.family,name:source.name,action:d.action,reason:d.reason};
 if(source.family==='GenericAgents')replacement.genericAgentReviewed=d.genericAgentReviewed;if(overrides.length)replacement.referenceOverrides=overrides;
 candidate.decisions=candidate.decisions.map(x=>recordKey(x.family,x.name)===key?replacement:x);
 const next=preserve('Before applying decision '+source.family+' '+source.name);next.working.editor.planText=pretty(candidate);delete next.working.editor.decisionDrafts[key];next.working.editor.approve=false;adopt(next);
});
$('discard-decision-draft').onclick=action(()=>{const key=w().view.selected;need(key,'Select a source record.');const next=preserve('Before discarding one unapplied decision draft');delete next.working.editor.decisionDrafts[key];adopt(next);});
$('apply-plan').onclick=action(()=>{const c=context();need(!unapplied(c),'Apply or explicitly discard the retained record drafts before reviewing the complete plan.');const plan=sealCurrent(parsePlanText(e().planText),c);const next=preserve('Before sealing the complete reviewed plan');next.working.editor.planText=pretty(plan);next.working.editor.approve=false;adopt(next);});
$('save-plan-draft').onclick=()=>download('unfinished-otobo-plan.txt',e().planText,'text/plain;charset=utf-8');
$('save-reviewed').onclick=action(()=>{
 const c=context();need(c.source&&c.before&&c.plan&&c.review,'Review the complete plan first.');need(!unapplied(c),'Apply or discard all retained decision drafts first.');
 need(e().reviewer.trim()&&e().reason.trim(),'Record the actual reviewer and review reason.');if(e().approve)need(c.review.ready,'Resolve all plan errors before approving the native handover.');
 const capture={schema:'otobo.review-source.v1',source:c.source.capture,before:c.before.capture,after:c.after?.capture??null};
 const at=now();let p=w().project;
 if(p){need(p.id===e().projectId&&p.title===e().title,'Keep this original project identity; start a new workspace for a different project.');need(canonical(p.capture)===canonical(capture),'A changed capture needs a new complete project.');}
 else{need(!session.history.some(h=>h.working.project?.id===e().projectId),'Use a new project identifier for this separately captured edition.');p=newProject({id:e().projectId,title:e().title,capture,mapping:c.plan,at});}
 const request={operationId:'review-'+crypto.randomUUID(),projectId:p.id,captureSha256:p.captureSha256,expectedRevision:p.revision,mapping:c.plan,actor:e().reviewer.trim(),reason:e().reason.trim(),at,approve:e().approve};
 const result=applyMapping(p,request),next=preserve('Before attributed project edition '+p.id+' revision '+result.project.revision);
 next.working.project=result.project;adopt(next);
});
$('download-plan').onclick=action(()=>{const c=context();need(approvedCurrent(c),'Save the exact approved current plan first.');download('approved-otobo-handover-plan.json',pretty(w().project.mapping));});
$('download-project').onclick=action(()=>{need(w().project,'Save an attributed project first.');download(w().project.id+'.json',serializeProject(w().project));});
$('download-findings').onclick=action(()=>{const x=context().comparison;need(x,'Prepare the returned target comparison first.');download('otobo-returned-comparison.json',pretty(x));});
$('download-comparison').onclick=action(()=>{const c=context();need(approvedCurrent(c)&&c.comparison?.ready,'Approve the complete returned project with known target coverage first.');download('otobo-native-comparison-input.json',pretty(prepareProviderMigration({capture:w().project.capture,mapping:w().project.mapping})));});
$('history-list').onclick=action(event=>{
 const open=event.target.closest('[data-history]'),save=event.target.closest('[data-history-download]');if(!open&&!save)return;
 const id=Number((open||save).dataset[open?'history':'historyDownload']),h=session.history.find(x=>x.id===id);need(h,'Original working edition is absent.');
 if(save){const out=clone(session);out.working=clone(h.working);download('otobo-working-edition-'+id+'.json',serializeSession(out));return;}
 const next=preserve('Before reopening original working edition '+id);next.working=clone(h.working);adopt(next);
});
$('source-files').onclick=action(event=>{const b=event.target.closest('[data-file-id]');if(!b)return;const file=context()[b.dataset.fileRole]?.files.get(b.dataset.fileId);need(file,'Original file is absent.');download(file.filename,Uint8Array.from(atob(file.body_base64),v=>v.charCodeAt(0)),'application/octet-stream');});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
render();

document.documentElement.dataset.otoboReviewReady='true';
document.documentElement.dataset.otoboReading='false';
