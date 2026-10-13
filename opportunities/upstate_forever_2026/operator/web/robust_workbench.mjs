/* Native operator adapter for the original OPT12 decision panel.
 * Original panel SHA-256: f82d2b853bc97bea48f8e97099920241b61458b5f395aae2315dcc59424e0f4a.
 * Scientific study construction, optimization, persistence and exports stay in eco_robust.
 */
const markup = "<header><div><h1>Ecosystem decision studies</h1><p>Compare complete modeled alternatives across retained parameter profiles.</p></div><span class=\"badge\">RETAINED DECISION STUDIES</span></header>\n<div class=\"rw-body\">\n<div class=\"toolbar\"><select id=\"rw-studies\" data-rw=\"studies\" aria-label=\"Saved studies\"><option value=\"\">Select a saved study</option></select><button id=\"rw-refresh\" data-rw=\"refresh\">Refresh</button><button id=\"rw-importToggle\" data-rw=\"importToggle\">Import study or project</button></div>\n<div id=\"rw-status\" data-rw=\"status\" class=\"status\" role=\"status\" aria-live=\"polite\"></div><div id=\"rw-operations\" data-rw=\"operations\"></div><div class=\"toolbar\"><label>Browser drafts <select id=\"rw-drafts\" data-rw=\"drafts\"><option value=\"\">Open a retained browser draft</option></select></label></div>\n<section id=\"rw-importCard\" data-rw=\"importCard\" class=\"card\">\n<h2>Prepare a decision study</h2><div class=\"toolbar\"><label class=\"rw-grow\">Retained native experiment<select id=\"rw-experiments\" data-rw=\"experiments\" aria-label=\"Retained native experiment\"><option value=\"\">Select an experiment</option></select></label><button id=\"rw-configureExperiment\" data-rw=\"configureExperiment\" class=\"primary\">Configure native experiment</button></div><p class=\"muted\">Choose an experiment with its original paired summary. Enter decision costs, capacity, metric scales and weights below; the native receiver binds its complete outcome matrix when you save.</p><h3>Receive existing work</h3><p class=\"muted\">Open a decision-study JSON or a complete exported project. For a native experiment, select its original summary and a configuration containing the chosen candidate costs, profiles, metric scales and weights.</p>\n<div class=\"file-row\"><label>Decision study or portable project<input id=\"rw-studyFile\" data-rw=\"studyFile\" type=\"file\" accept=\".json,application/json\"></label><label>Original experiment summary<input id=\"rw-nativeFile\" data-rw=\"nativeFile\" type=\"file\" accept=\".json,application/json\"></label><label>Decision configuration<input id=\"rw-configFile\" data-rw=\"configFile\" type=\"file\" accept=\".json,application/json\"></label></div>\n<div class=\"actions controls\"><button id=\"rw-importStudy\" data-rw=\"importStudy\">Receive study / project</button><button id=\"rw-importNative\" data-rw=\"importNative\">Receive native results</button></div>\n</section>\n<div id=\"rw-empty\" data-rw=\"empty\" class=\"card empty\">Receive a study or open a saved decision to compare alternatives.</div>\n<div id=\"rw-editor\" data-rw=\"editor\" class=\"hidden\">\n<section class=\"card\">\n<div class=\"toolbar\"><h2 style=\"margin:0;flex:1\">Decision inputs</h2><span id=\"rw-revision\" data-rw=\"revision\" class=\"badge\"></span><label>Saved revision <input id=\"rw-openRevision\" data-rw=\"openRevision\" aria-label=\"Saved study revision\" type=\"number\" min=\"1\" step=\"1\"></label><button id=\"rw-readRevision\" data-rw=\"readRevision\">Open revision</button></div>\n<div class=\"grid rw-input-grid\"><label>Study title<input id=\"rw-title\" data-rw=\"title\" type=\"text\"></label><label>Cost units<input id=\"rw-costUnitsInput\" data-rw=\"costUnitsInput\" type=\"text\" placeholder=\"Enter the actual decision cost unit\"></label><label>Budget ceiling <small id=\"rw-costUnits\" data-rw=\"costUnits\"></small><input id=\"rw-budget\" data-rw=\"budget\" type=\"number\" min=\"0\" step=\"any\" placeholder=\"No ceiling\"></label><label>Capacity ceiling<input id=\"rw-capacity\" data-rw=\"capacity\" type=\"number\" min=\"0\" step=\"any\" placeholder=\"No ceiling\"></label><label class=\"rw-wide\">Selection model<input id=\"rw-mode\" data-rw=\"mode\" type=\"text\" readonly></label></div>\n<p id=\"rw-basis\" data-rw=\"basis\" class=\"muted controls\"></p>\n<h3>Physical outcomes and decision preferences</h3><p class=\"muted\">Positive gain is lower annual export. Each target must be met in every included profile. The score is the sum of weight × gain ÷ scale; physical outcomes keep their original units.</p>\n<div class=\"scroll\"><table id=\"rw-metrics\" data-rw=\"metrics\"><thead><tr><th>Metric / annual unit</th><th>Fixed scale</th><th>Decision weight</th><th>Guaranteed gain</th></tr></thead><tbody></tbody></table></div>\n<h3>Candidate packages / actions</h3><div class=\"scroll\"><table id=\"rw-candidates\" data-rw=\"candidates\"><thead><tr><th>Candidate</th><th>Cost</th><th>Capacity used</th><th>Group</th><th>Selection constraints</th></tr></thead><tbody></tbody></table></div>\n<h3>Included parameter profiles</h3><div class=\"scroll\"><table id=\"rw-profiles\" data-rw=\"profiles\"><thead><tr><th>Profile</th><th>Explicit probability (optional)</th><th>Retained source</th></tr></thead><tbody></tbody></table></div>\n<details><summary>Original input matrix and source references</summary><div id=\"rw-matrix\" data-rw=\"matrix\" class=\"scroll\"></div></details>\n<details><summary>Advanced configuration</summary><p class=\"muted\">Edit the complete study for profile/candidate membership, group limits or source metadata. Applying it updates the form; saving creates a new revision.</p><textarea id=\"rw-advanced\" data-rw=\"advanced\" spellcheck=\"false\" aria-label=\"Complete study JSON\"></textarea><button id=\"rw-applyAdvanced\" data-rw=\"applyAdvanced\">Apply JSON to form</button></details>\n<p id=\"rw-preparationNote\" data-rw=\"preparationNote\" class=\"muted\"></p><div class=\"actions controls\"><button id=\"rw-save\" data-rw=\"save\" class=\"primary\">Save new revision</button><button id=\"rw-exportStudy\" data-rw=\"exportStudy\">Export current inputs</button><button id=\"rw-exportProject\" data-rw=\"exportProject\">Export complete project</button><button id=\"rw-transferStudy\" data-rw=\"transferStudy\">Transfer editable study</button><span id=\"rw-dirty\" data-rw=\"dirty\" class=\"muted\"></span></div>\n</section>\n<section class=\"card\">\n<h2>Calculate a decision</h2><div class=\"grid\"><label>Objective<select id=\"rw-objective\" data-rw=\"objective\"><option value=\"worst_case\">Maximize worst-profile score</option><option value=\"minimax_regret\">Minimize maximum regret</option><option value=\"expected\">Maximize expected score</option></select></label><label>Calculation time allowance (seconds)<input id=\"rw-timeLimit\" data-rw=\"timeLimit\" type=\"number\" min=\"1\" max=\"3600\" value=\"60\"></label><label>Frontier budgets (comma-separated)<input id=\"rw-budgets\" data-rw=\"budgets\" type=\"text\" placeholder=\"e.g. 10000, 25000, 50000\"></label><label>Source revision<input id=\"rw-solveRevision\" data-rw=\"solveRevision\" type=\"text\" readonly></label></div>\n<p class=\"muted\">Regret compares this decision with each profile’s best plan under the same constraints. Expected values require explicit probabilities. Save changed inputs before calculating.</p>\n<div class=\"actions\"><button id=\"rw-solve\" data-rw=\"solve\" class=\"primary\">Calculate selection</button><button id=\"rw-frontier\" data-rw=\"frontier\">Calculate budget frontier</button><span id=\"rw-runStatus\" data-rw=\"runStatus\" class=\"muted\"></span></div>\n</section>\n<section id=\"rw-results\" data-rw=\"results\" class=\"card hidden\"><div class=\"toolbar\"><h2 style=\"margin:0;flex:1\">Decision results</h2><button id=\"rw-reportHtml\" data-rw=\"reportHtml\">HTML report</button><button id=\"rw-reportCsv\" data-rw=\"reportCsv\">Outcome CSV</button><button id=\"rw-exportSelection\" data-rw=\"exportSelection\">Implementation selection</button><button id=\"rw-exportResult\" data-rw=\"exportResult\">Export result JSON</button></div><p id=\"rw-resultBinding\" data-rw=\"resultBinding\" class=\"muted\"></p><div id=\"rw-resultBody\" data-rw=\"resultBody\"></div></section>\n<details class=\"card\"><summary>Retained calculation history</summary><div id=\"rw-history\" data-rw=\"history\"></div></details>\n</div>\n<footer>Original native scenario packages remain whole. Separate additive-action studies require an explicit decomposition basis. Saved revisions and source identities travel with the complete project.</footer>\n</div>";
const clone=value=>JSON.parse(JSON.stringify(value));
const rows=value=>Array.isArray(value)?value:[];
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value);}
const actionLabels={
 'robust.study.create':'Receive decision study','robust.study.revise':'Save study revision',
 'robust.experiment.prepare':'Prepare native decision study','robust.summary.prepare':'Receive original paired results',
 'robust.solve':'Calculate selection','robust.frontier':'Calculate budget frontier',
 'robust.project.export':'Export complete project','robust.project.receive':'Receive complete project',
 'robust.selection.export':'Export implementation selection','robust.report.export':'Export decision report'
};
const exportActions=new Set(['robust.project.export','robust.selection.export','robust.report.export']);
export function createRobustWorkbench(host){
 if(typeof host.api!=='function'||typeof host.getState!=='function')throw Error('Open decision studies through the original scientific operator.');
 let root=null,events=null,workspace=null,lifecycle=0,loadVersion=0,disposed=true,catalog={studies:[],experiments:[]},taskSignature='',catalogRefreshPending=false,historyRefreshPending=null,refreshing=false;
 let memory={drafts:{},requests:[],selected:null,open_draft:null};
 let state={document:null,study:null,answer:null,dirty:false,busy:false,pendingExperiment:null,draftKey:null,runId:null,runRevision:null};
 const taskDetails=new Map(),uploads=new WeakMap();
 const $=selector=>root?.querySelector(selector.replace(/#([A-Za-z_][\w-]*)/g,'#rw-$1'));
 const $$=selector=>root?[...root.querySelectorAll(selector.replace(/#([A-Za-z_][\w-]*)/g,'#rw-$1'))]:[];
 const current=()=>host.getState()?.workspace_key||null;
 const active=(key=workspace,generation=lifecycle)=>!disposed&&root&&workspace===key&&current()===key&&lifecycle===generation;
 const tasks=()=>rows(host.getState()?.tasks).filter(task=>String(task.action||'').startsWith('robust.'));
 const storageKey=key=>'upstate-robust-workbench-v1:'+key;
 function element(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
 function clear(node){node?.replaceChildren();}
 function status(text=''){if($('#status'))$('#status').textContent=String(text);}
 const number=x=>x===null||x===undefined?'—':Number(x).toLocaleString(undefined,{maximumSignificantDigits:8});
 function nullable(input,validate=true){
   const value=input.value.trim(),label=input.getAttribute('aria-label')||input.closest('label')?.childNodes[0]?.textContent?.trim()||'optional numeric value';
   if(input.validity?.badInput){if(validate)throw Error('Supply a finite '+label+' or clear the field.');return '';}
   if(value==='')return null;const numeric=Number(value);
   if(!Number.isFinite(numeric)){if(validate)throw Error('Supply a finite '+label+' or clear the field.');return value;}return numeric;
 }
 function requiredNumber(input,validate=true){
   const value=input.value.trim();
   if(!value){if(validate)throw Error('Supply '+input.getAttribute('aria-label')+'.');return '';}
   const numeric=Number(value);if(!Number.isFinite(numeric)){if(validate)throw Error('Supply a finite '+input.getAttribute('aria-label')+'.');return value;}return numeric;
 }
 function mark(){if(!state.study)return;state.dirty=true;if($('#dirty'))$('#dirty').textContent='Unsaved changes · retained in this browser';persist();paintDrafts();}
 function stored(key){try{const value=JSON.parse(localStorage.getItem(storageKey(key))||'null');if(value?.drafts&&typeof value.drafts==='object')return {...value,requests:rows(value.requests)};}catch{}return {drafts:{},requests:[],selected:null,open_draft:null};}
 function editorSnapshot(){
   if(!state.study||!root)return null;
   return {study:collect(false),document:state.document?{id:state.document.id,head:state.document.head,revision:state.document.revision,sha256:state.document.sha256??null,runs:[]}:null,pending_experiment:state.pendingExperiment,draft_key:state.draftKey};
 }
 function editorSignature(){return canonical(editorSnapshot());}
 function persist(){
   if(!workspace)return;
   if(root&&state.study&&state.dirty&&state.draftKey){memory.drafts[state.draftKey]=editorSnapshot();memory.open_draft=state.draftKey;}
   else if(root&&!state.dirty)memory.open_draft=null;
   if(state.document?.id)memory.selected=state.document.id;
   try{localStorage.setItem(storageKey(workspace),JSON.stringify(memory));}catch{status('Browser draft storage is unavailable. Save the study to retain these decision inputs with the workspace.');}
 }
 function retainReceipt(key,request,taskId){
   const target=key===workspace?memory:stored(key);let record=target.requests.find(row=>row.operation_id===request.operation_id);
   if(!record){record=clone(request);target.requests.push(record);}record.task_id=taskId;
   if(key===workspace)persist();else try{localStorage.setItem(storageKey(key),JSON.stringify(target));}catch{}
 }
 function assertWorkspace(key=workspace){if(!key||key!==current())throw Error('The selected workspace changed. Reopen this decision in its original workspace.');}
 async function read(operation,payload={}){
   const key=workspace,generation=lifecycle;assertWorkspace(key);
   const value=await host.api('/api/robust-workbench/'+operation,{method:'POST',body:{workspace:key,...payload}});
   if(!active(key,generation))throw Error('The decision view changed while its data was loading.');return value;
 }
 function download(name,value,raw=false,mediaType='application/json'){
   const url=URL.createObjectURL(new Blob([raw?value:JSON.stringify(value,null,2)+'\n'],{type:mediaType}));
   const link=element('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function runTask(fn){return async event=>{
   event?.preventDefault();if(state.busy||!active())return;
   const key=workspace,generation=lifecycle;state.busy=true;status();$$('button').forEach(button=>button.disabled=true);
   try{await fn(event);}catch(error){if(active(key,generation))status(error.message||error);}
   finally{if(active(key,generation)){state.busy=false;$$('button').forEach(button=>button.disabled=false);}}
 };}
 function bind(id,fn,event='click'){$('#'+id).addEventListener(event,runTask(fn),{signal:events.signal});}
 function paintDrafts(){
   const select=$('#drafts');if(!select)return;clear(select);select.append(new Option('Open a retained browser draft',''));
   for(const [key,value]of Object.entries(memory.drafts))select.append(new Option(value.study?.title||key,key));
   if(state.dirty&&state.draftKey)select.value=state.draftKey;
 }
 function renderCatalog(){
   if(!root)return;
   clear($('#studies'));$('#studies').append(new Option('Select a saved study',''));
   for(const study of rows(catalog.studies))$('#studies').append(new Option(study.title+' · rev '+study.head,study.id));
   if(state.document?.id)$('#studies').value=state.document.id;
   const selected=$('#experiments').value;clear($('#experiments'));$('#experiments').append(new Option('Select an experiment',''));
   for(const experiment of rows(catalog.experiments)){
     const option=new Option((experiment.title||experiment.id)+' · '+(experiment.state||'retained')+(experiment.summary_available?'':' · summary unavailable'),experiment.id);
     option.disabled=!experiment.summary_available;$('#experiments').append(option);
   }
   if(rows(catalog.experiments).some(value=>value.id===selected))$('#experiments').value=selected;
   paintDrafts();paintOperations();
 }
 function retainStudyChoice(document){
   if(!document?.id||!document.study)return;
   const entry={id:document.id,title:document.study.title,head:document.head},existing=rows(catalog.studies).findIndex(row=>row.id===document.id);
   catalog.studies=rows(catalog.studies);if(existing<0)catalog.studies.push(entry);else catalog.studies[existing]={...catalog.studies[existing],...entry};
 }
 async function refreshCatalog(){
   const key=workspace,generation=lifecycle,version=++loadVersion;const value=await read('catalog');
   if(!active(key,generation)||version!==loadVersion)return false;catalog=value;catalogRefreshPending=false;renderCatalog();return true;
 }
 const queueActive=()=>rows(host.getState()?.tasks).some(task=>['queued','running'].includes(task.state));
 async function refreshWhenIdle(){
   if(!active()||refreshing||queueActive())return;
   const key=workspace,generation=lifecycle;refreshing=true;
   try{
     if(catalogRefreshPending)await refreshCatalog();
     if(!active(key,generation))return;
     const needed=historyRefreshPending;
     if(needed&&state.document?.id===needed.study_id&&state.document.revision===needed.revision){
       const document=await read('study',needed);
       if(!active(key,generation))return;
       if(state.document?.id===needed.study_id&&state.document.revision===needed.revision){
         state.document.runs=document.runs;state.document.operations=document.operations;state.document._downloads=document._downloads;history();
       }
       if(historyRefreshPending===needed)historyRefreshPending=null;
     }else historyRefreshPending=null;
   }catch(error){if(active(key,generation))status('The native result remains retained. Refreshing study information returned: '+(error.message||error));}
   finally{if(active(key,generation))refreshing=false;}
 }
 function appendDownloads(container,files){
   for(const file of rows(files)){
     if(!/^\/api\/file\/[A-Za-z0-9/_-]+$/.test(file.url||''))continue;
     const link=element('a',file.label||file.filename||'Download retained file');link.href=file.url+'?download=1';link.download=file.filename||'';container.append(link,document.createTextNode(' '));
   }
 }
 function paintOperations(){
   const container=$('#operations');if(!container)return;clear(container);
   const visible=tasks().filter(task=>['queued','running','failed','interrupted'].includes(task.state)||memory.requests.some(request=>request.task_id===task.id));
   if(!visible.length)return;
   const card=element('section',undefined,'card');card.append(element('h2','Decision operations'));
   for(const task of visible.slice(0,12)){
     const row=element('div',undefined,'rw-operation'),toolbar=element('div',undefined,'actions');row.dataset.rwTaskId=task.id;
     toolbar.append(element('strong',actionLabels[task.action]||task.action),element('span',task.state,'badge'));
     const open=element('button','Open operation');open.addEventListener('click',()=>host.showTask?.(task.id),{signal:events.signal});toolbar.append(open);
     if(['failed','interrupted'].includes(task.state)){
       const resume=element('button','Resume same operation');resume.addEventListener('click',runTask(async()=>{
         await host.api('/api/task/resume',{method:'POST',body:{id:task.id}});await host.refreshState({force:true});paintOperations();
       }),{signal:events.signal});toolbar.append(resume);
     }
     row.append(toolbar);if(task.error)row.append(element('p',typeof task.error==='string'?task.error:task.error.message||JSON.stringify(task.error)));
     const detail=taskDetails.get(task.id);
     appendDownloads(row,detail?._downloads);
     card.append(row);
   }
   container.append(card);
 }
function inputCell(row,value,options={}){const td=element('td');const input=element('input');input.type='number';input.step='any';if(options.min!==undefined)input.min=options.min;input.value=value??'';input.setAttribute('aria-label',options.label||'Value');input.addEventListener('input',mark);td.append(input);row.append(td);return input;}
function renderStudy(){const s=state.study;$('#editor').classList.remove('hidden');$('#empty').classList.add('hidden');$('#importCard').classList.add('hidden');$('#title').value=s.title;$('#budget').value=s.budget??'';$('#capacity').value=s.capacity??'';$('#costUnits').textContent=s.cost_units;$('#costUnitsInput').value=s.cost_units||'';$('#mode').value=s.mode==='native_packages'?'One complete native package':'Explicit additive actions';$('#basis').textContent=s.mode==='native_packages'?'Choose exactly one previously evaluated package. Scenario effects are never added together.':s.additive_basis;$('#revision').textContent=state.pendingExperiment?'NATIVE STUDY PREPARATION':'REVISION '+state.document.revision;$('#solveRevision').value=state.pendingExperiment?'Save the native study first':state.document.revision;$('#openRevision').value=state.document.revision??'';$('#openRevision').max=state.document.head??'';$('#openRevision').disabled=Boolean(state.pendingExperiment);
clear($('#metrics tbody'));for(const m of s.metrics){const tr=element('tr');const name=element('td',m.label||m.id);name.append(element('small',m.id+' · '+m.units));tr.append(name);inputCell(tr,m.scale,{min:0,label:m.id+' scale'});inputCell(tr,m.weight,{min:0,label:m.id+' weight'});inputCell(tr,m.guaranteed_gain,{label:m.id+' target'});$('#metrics tbody').append(tr);}
clear($('#candidates tbody'));for(const c of s.candidates){const tr=element('tr');const name=element('td',c.label||c.id);name.append(element('small',c.id));tr.append(name);inputCell(tr,c.cost,{min:0,label:c.id+' cost'});inputCell(tr,c.capacity,{min:0,label:c.id+' capacity'});tr.append(element('td',c.group||'—'));const td=element('td');const checks=element('div',undefined,'checks');for(const key of ['required','excluded']){const label=element('label');const input=element('input');input.type='checkbox';input.checked=c[key];input.setAttribute('aria-label',c.id+' '+key);input.addEventListener('change',mark);label.append(input,document.createTextNode(' '+key));checks.append(label);}td.append(checks);tr.append(td);$('#candidates tbody').append(tr);}
clear($('#profiles tbody'));for(const p of s.profiles){const tr=element('tr');const name=element('td',p.label||p.id);name.append(element('small',p.id));tr.append(name);inputCell(tr,p.probability,{min:0,label:p.id+' probability'});const cell=element('td',JSON.stringify(p.source||{}));cell.className='wrap';tr.append(cell);$('#profiles tbody').append(tr);}
clear($('#matrix'));const rows=s.cells.map(c=>[c.profile_id,c.candidate_id,...s.metrics.map(m=>number(c.gains[m.id])),c.source?.baseline_run_id||'—',c.source?.alternative_run_id||'—']);$('#matrix').append(table(['Profile','Candidate',...s.metrics.map(m=>m.id+' ['+m.units+']'),'Baseline run','Alternative run'],rows));const refs=element('pre',JSON.stringify(s.source,null,2));$('#matrix').append(refs);$('#advanced').value=JSON.stringify(s,null,2);state.dirty=false;$('#dirty').textContent=state.pendingExperiment?'Unsaved native preparation':'Saved inputs';$('#save').textContent=state.pendingExperiment?'Save native decision study':'Save new revision';$('#preparationNote').textContent=state.pendingExperiment?'Original paired results will be bound to this configuration when the native study is saved. Outcome cells come from the retained experiment.':'';}
function collect(validate=true){const s=structuredClone(state.study);s.title=$('#title').value;s.cost_units=$('#costUnitsInput').value.trim();if(validate&&!s.cost_units)throw Error('Supply the actual decision cost units.');s.budget=nullable($('#budget'),validate);s.capacity=nullable($('#capacity'),validate);[...$('#metrics tbody').rows].forEach((tr,i)=>{const [scale,weight,target]=tr.querySelectorAll('input');s.metrics[i].scale=requiredNumber(scale,validate);s.metrics[i].weight=requiredNumber(weight,validate);s.metrics[i].guaranteed_gain=nullable(target,validate);});[...$('#candidates tbody').rows].forEach((tr,i)=>{const [cost,capacity,required,excluded]=tr.querySelectorAll('input');Object.assign(s.candidates[i],{cost:requiredNumber(cost,validate),capacity:requiredNumber(capacity,validate),required:required.checked,excluded:excluded.checked});});[...$('#profiles tbody').rows].forEach((tr,i)=>s.profiles[i].probability=nullable(tr.querySelector('input'),validate));return s;}
function table(headers,rows){const t=element('table');const head=element('thead');const tr=element('tr');headers.forEach(h=>tr.append(element('th',h)));head.append(tr);t.append(head);const body=element('tbody');for(const cells of rows){const row=element('tr');for(const value of cells)row.append(element('td',String(value??'—'),'wrap'));body.append(row);}t.append(body);return t;}
function resultTable(container,headers,rows){const div=element('div',undefined,'scroll');div.append(table(headers,rows));container.append(div);}
function renderAnswer(answer,runId=null,revision=null){state.answer=answer;state.runId=runId;state.runRevision=revision;$('#resultBinding').textContent=(state.document?.id?'Study '+state.document.id+' · ':'')+(revision!=null?'source revision '+revision:'Retained calculation');const box=$('#resultBody');clear(box);$('#results').classList.remove('hidden');
if(answer.schema_version==='ecosci.robust-frontier/1'){box.append(element('p','Budget comparison · each point retains its own complete input binding and profile results.','muted'));resultTable(box,['Budget','Status','Selected','Cost','Worst score','Maximum regret'],answer.points.map(p=>[number(p.budget),p.result?.status||p.status,(p.result?.selected_ids||[]).join(', '),number(p.result?.cost),number(p.result?.worst_score),number(p.result?.maximum_regret)]));}
else {const r=answer.result;box.append(element('p',answer.objective.replaceAll('_',' ')+' · '+r.status+' · '+number(answer.elapsed_seconds)+' seconds','muted'));if(r.selected_ids){const stats=element('div',undefined,'summary');for(const [label,value] of [['Selected',r.selected_ids.join(', ')],['Cost ['+r.cost_units+']',number(r.cost)],['Worst-profile score',number(r.worst_score)],['Maximum regret',number(r.maximum_regret)]]){const stat=element('div',undefined,'stat');stat.append(element('span',label),element('strong',value,'wrap'));stats.append(stat);}box.append(stats);box.append(element('h3','Performance in every included profile'));resultTable(box,['Profile','Score','Regret','Metric','Gain','Unit','Target','Shortfall'],r.profiles.flatMap(p=>p.metrics.map(m=>[p.id,number(p.score),number(p.regret),m.id,number(m.gain),m.units,number(m.guaranteed_gain),number(m.target_shortfall)])));box.append(element('h3','Constraint margins'));resultTable(box,['Constraint','Actual','Above minimum','Below maximum'],r.constraints.map(c=>[c.id,number(c.value),number(c.lower_slack),number(c.upper_slack)]));}
else{box.append(element('p',r.message||r.status));if(r.diagnostic_without_gain_targets){box.append(element('h3','Comparison with gain targets relaxed'));const d=r.diagnostic_without_gain_targets;box.append(element('p','Budget, capacity, membership and required/excluded choices are retained. This comparison identifies target shortfalls; it does not replace your constrained decision.','muted'));if(d.selected_ids){box.append(element('p','Selected: '+d.selected_ids.join(', ')));resultTable(box,['Profile','Metric','Gain','Target','Shortfall'],d.profiles.flatMap(p=>p.metrics.map(m=>[p.id,m.id,number(m.gain),number(m.guaranteed_gain),number(m.target_shortfall)])));}else box.append(element('p',d.message));}}
if(answer.profile_benchmarks?.length){box.append(element('h3','Profile-specific best plans'));resultTable(box,['Profile','Status','Best score','Selected'],answer.profile_benchmarks.map(b=>[b.profile_id,b.status,number(b.profile_optimum),(b.selected_ids||[]).join(', ')]));}if(answer.value_of_information){const v=answer.value_of_information;box.append(element('h3','Value of perfect profile information'));box.append(element('p',number(v.evpi)+' '+v.units+'. Expected score with perfect information: '+number(v.perfect_information_score)+'; best single expected plan: '+number(v.optimal_expected_score)+'.'));box.append(element('p','This diagnostic uses the supplied probabilities and the same all-profile feasibility requirements. It is an objective-score difference, not a currency valuation.','muted'));}}
const details=element('details');details.append(element('summary','Complete calculation and retained identities'),element('pre',JSON.stringify(answer,null,2)));box.append(details);}
function history(){clear($('#history'));for(const r of state.document.runs){const div=element('div',undefined,'toolbar controls');div.append(element('span',r.created+' · revision '+r.revision+' · '+r.objective+' · '+r.status,'muted'));if(r.result){const button=element('button','View result');button.onclick=()=>renderAnswer(r.result,r.id,r.revision);div.append(button);}if(r.error)div.append(element('span',r.error,'wrap'));$('#history').append(div);}if(rows(state.document._downloads).length){const files=element('div',undefined,'rw-study-files');files.append(element('h3','Saved study exports'));appendDownloads(files,state.document._downloads);$('#history').append(files);}}

function openDocument(d){state.pendingExperiment=null;state.document=d;state.study=structuredClone(d.study);renderStudy();history();const done=d.runs.filter(r=>r.result);if(done.length)renderAnswer(done.at(-1).result,done.at(-1).id,done.at(-1).revision);else{$('#results').classList.add('hidden');state.answer=null;state.runId=null;state.runRevision=null;}$('#studies').value=d.id;memory.selected=d.id;memory.open_draft=null;state.draftKey='study:'+d.id;persist();paintDrafts();}

 async function openStudy(id,revision,guard){
   persist();const version=++loadVersion,key=workspace,generation=lifecycle;
   status('Opening retained study inputs and calculation history…');
   const value=await read('study',{study_id:id,...(revision!=null?{revision}: {})});
   if(!active(key,generation)||version!==loadVersion||(guard&&!guard()))return;
   openDocument(value);status();
 }
 function restoreDraft(key){
   const draft=memory.drafts[key];if(!draft)throw Error('That browser draft is no longer available.');
   persist();state.document=clone(draft.document||{id:null,head:null,revision:null,runs:[]});state.study=clone(draft.study);
   state.pendingExperiment=draft.pending_experiment||null;state.draftKey=key;state.answer=null;state.runId=null;state.runRevision=null;
   renderStudy();history();$('#results').classList.add('hidden');mark();status('Restored the retained browser draft. Save it to create a native study revision.');
 }
 async function configureExperiment(selectedExperiment){
   const id=typeof selectedExperiment==='string'?selectedExperiment:$('#experiments').value;if(!id)throw Error('Select a retained experiment with an original paired summary.');
   persist();
   if(memory.drafts['experiment:'+id]?.pending_experiment===id){restoreDraft('experiment:'+id);return;}
   const version=++loadVersion;const value=await read('experiment',{experiment_id:id});
   if(version!==loadVersion)return;
   state.pendingExperiment=id;state.document={id:null,head:null,revision:null,runs:[]};
   state.study={...clone(value.configuration),cells:[]};state.draftKey='experiment:'+id;state.answer=null;state.runId=null;state.runRevision=null;
   renderStudy();history();$('#results').classList.add('hidden');mark();
   status('Enter the decision costs, capacity, scales and weights. Saving binds the original paired outcomes to this study.');
 }
 async function selectedFile(id){
   const file=$('#'+id).files[0];if(!file)throw Error('Select the required original JSON file.');
   const key=workspace,generation=lifecycle;const value=JSON.parse(await file.text());
   if(!active(key,generation))throw Error('The workspace changed while the file was being read.');
   return {file,value};
 }
 async function upload(file){
   if(uploads.has(file))return uploads.get(file);
   const key=workspace,generation=lifecycle;
   const result=await host.api('/api/upload',{method:'POST',raw:file,filename:file.name});
   if(!active(key,generation))throw Error('The workspace changed while the file was being received.');
   if(!result.id)throw Error('The original operator did not return an upload identity.');
   uploads.set(file,result.id);return result.id;
 }
 async function queue(action,payload,{openResult=false}={}){
   const key=workspace,generation=lifecycle;assertWorkspace(key);
   const signature=canonical({action,payload});let request=[...memory.requests].reverse().find(value=>value.key===signature);
   if(action==='robust.project.export'&&request&&(request.handled||tasks().some(task=>task.id===request.task_id&&task.state==='complete')))request=null;
   if(!request){request={key:signature,action,operation_id:crypto.randomUUID()};memory.requests.push(request);}
   Object.assign(request,{handled:false,draft_key:state.draftKey,editor_signature:editorSignature(),study_id:payload.study_id||state.document?.id||null,expected_revision:payload.expected_revision,open_result:openResult});
   persist();const original=clone(request);
   const task=await host.api('/api/actions',{method:'POST',body:{workspace:key,action,payload,operation_id:request.operation_id}});
   retainReceipt(key,original,task.id);if(!active(key,generation))return task;
   await host.refreshState({force:true});if(!active(key,generation))return task;
   await settle();if(!active(key,generation))return task;paintOperations();
   status(task.state==='complete'?'The native decision operation completed.':'The original operator retained the decision operation. Open its progress above.');
   return task;
 }
 async function settle(){
   if(!active())return;
   const key=workspace,generation=lifecycle,done=[],exports=[];
   for(const request of memory.requests){
     if(request.handled||!request.task_id)continue;
     const task=tasks().find(value=>value.id===request.task_id);
     if(!task||task.state!=='complete')continue;request.handled=true;
     done.push({request,task});if(exportActions.has(request.action))exports.push(task);
     if(task.result?.study)retainStudyChoice(task.result);
   }
   if(!done.length)return;persist();catalogRefreshPending=true;renderCatalog();
   const received=[...done].reverse().find(({request,task})=>request.open_result&&task.result?.study&&request.editor_signature===editorSignature());
   if(received){
     const {request,task}=received;
     if(['robust.study.revise','robust.experiment.prepare'].includes(request.action)&&request.draft_key&&memory.drafts[request.draft_key]&&canonical(memory.drafts[request.draft_key])===request.editor_signature)delete memory.drafts[request.draft_key];
     state.dirty=false;openDocument(task.result);status('Saved native study revision '+task.result.revision+'.');
   }
   for(const {request,task}of done){
     if(request.action==='robust.study.revise'&&task.result?.study&&state.dirty&&request.study_id===state.document?.id&&request.draft_key===state.draftKey&&state.document.head===request.expected_revision){
       state.study=collect(false);state.document=task.result;
       $('#revision').textContent='REVISION '+task.result.revision+' · newer draft changes';
       $('#solveRevision').value=task.result.revision;$('#openRevision').value=task.result.revision;$('#openRevision').max=task.result.head;
       history();mark();
     }
     if(!['robust.solve','robust.frontier'].includes(request.action)||state.document?.id!==request.study_id||!task.result?.answer)continue;
     renderAnswer(task.result.answer,task.result.run_id,task.result.revision);
     $('#runStatus').textContent='Result retained · source revision '+task.result.revision;
     historyRefreshPending={study_id:request.study_id,revision:state.document.revision};
   }
   paintOperations();
   for(const task of exports){
     try{const detail=await host.api('/api/task?id='+encodeURIComponent(task.id));if(!active(key,generation))return;taskDetails.set(task.id,detail);paintOperations();}
     catch(error){if(active(key,generation))status('The export is retained in its operation. '+(error.message||error));}
     if(state.document?.id)historyRefreshPending={study_id:state.document.id,revision:state.document.revision};
   }
   if(active(key,generation))await refreshWhenIdle();
 }
 async function save(){
   const study=collect();
   if(state.pendingExperiment){const configuration=clone(study);delete configuration.cells;return queue('robust.experiment.prepare',{experiment_id:state.pendingExperiment,configuration},{openResult:true});}
   if(!state.document?.id)throw Error('Receive a study or configure a retained native experiment first.');
   return queue('robust.study.revise',{study_id:state.document.id,study,expected_revision:state.document.head},{openResult:true});
 }
 async function calculate(frontier){
   if(!state.document?.id||state.pendingExperiment)throw Error('Save the native decision study before calculating.');
   if(state.dirty)throw Error('Save changed decision inputs before calculating.');
   const time=Number($('#timeLimit').value);if(!$('#timeLimit').value.trim()||!Number.isFinite(time)||time<1||time>3600)throw Error('Enter a calculation time allowance from 1 to 3600 seconds.');
   const payload={study_id:state.document.id,revision:state.document.revision,objective:$('#objective').value,time_limit:time};
   if(frontier){
     const parts=$('#budgets').value.split(',').map(value=>value.trim());
     if(!parts.length||parts.some(value=>!value||!Number.isFinite(Number(value))||Number(value)<0))throw Error('Enter comma-separated nonnegative frontier budgets.');
     payload.budgets=parts.map(Number);
   }
   $('#runStatus').textContent='Queued through the original operator';return queue(frontier?'robust.frontier':'robust.solve',payload);
 }
 function requireStudy(){if(!state.document?.id)throw Error('Open a retained native decision study.');return state.document.id;}
 function requireRun(){requireStudy();if(!state.runId)throw Error('Open a retained calculation from history.');return state.runId;}
 function bindControls(){
   bind('refresh',async()=>{await refreshCatalog();if(state.document?.id&&!state.dirty)await openStudy(state.document.id,state.document.revision);});
   $('#importToggle').addEventListener('click',()=>$('#importCard').classList.toggle('hidden'),{signal:events.signal});
   bind('studies',async()=>{const id=$('#studies').value;if(id)await openStudy(id);},'change');
   bind('drafts',()=>{const key=$('#drafts').value;if(key)restoreDraft(key);},'change');
   bind('configureExperiment',configureExperiment);
   bind('readRevision',async()=>{const id=requireStudy(),value=$('#openRevision').value.trim(),revision=Number(value);if(!value||!Number.isInteger(revision)||revision<1)throw Error('Enter a positive saved revision number.');await openStudy(id,revision);});
   bind('importStudy',async()=>{
     const {file,value}=await selectedFile('studyFile'),upload_id=await upload(file);
     await queue(value.schema_version==='ecosci.robust-project/1'?'robust.project.receive':'robust.study.create',{upload_id},{openResult:true});
   });
   bind('importNative',async()=>{
     const summary=await selectedFile('nativeFile'),configuration=await selectedFile('configFile');
     const summary_upload_id=await upload(summary.file),configuration_upload_id=await upload(configuration.file);
     await queue('robust.summary.prepare',{summary_upload_id,configuration_upload_id},{openResult:true});
   });
   bind('applyAdvanced',()=>{
     const value=JSON.parse($('#advanced').value);for(const key of ['metrics','profiles','candidates','cells'])if(!Array.isArray(value[key]))throw Error('Complete study needs '+key+'.');
     state.study=value;renderStudy();mark();status('Advanced inputs applied to the working form. Save a native revision to retain them.');
   });
   bind('save',save);
   bind('exportStudy',()=>{if(!state.study)throw Error('Open a study first.');download('decision-study.json',collect());});
   bind('exportProject',()=>queue('robust.project.export',{study_id:requireStudy()}));
   $('#transferStudy').hidden=typeof host.openExtension!=='function';
   bind('transferStudy',async()=>{
     const id=requireStudy();
     if(typeof host.openExtension!=='function')throw Error('The selected-study transfer desk is unavailable in this operator.');
     const saved=await read('study',{study_id:id});
     await host.openExtension('study-transfer','openForStudies',[{
       kind:'robust-decisions',id,title:saved.study.title,state:'Saved'
     }]);
   });
   bind('exportResult',()=>{if(!state.answer)throw Error('Open a retained calculation first.');download('decision-result.json',state.answer);});
   bind('exportSelection',()=>{
     const study_id=requireStudy(),run_id=requireRun();
     if(state.answer?.schema_version!=='ecosci.robust-result/1')throw Error('Choose a budget from the frontier, save that budget in a study revision, and calculate its selection before exporting implementation instructions.');
     if(!Array.isArray(state.answer.result?.selected_ids))throw Error('The retained calculation has no feasible selection. Review its constraints and native diagnostic before exporting implementation instructions.');
     return queue('robust.selection.export',{study_id,run_id});
   });
   for(const [id,format]of [['reportHtml','html'],['reportCsv','csv']])bind(id,()=>queue('robust.report.export',{study_id:requireStudy(),run_id:requireRun(),format}));
   bind('solve',()=>calculate(false));bind('frontier',()=>calculate(true));
   for(const id of ['title','budget','capacity','costUnitsInput'])$('#'+id).addEventListener('input',mark,{signal:events.signal});
 }
 async function mount(node,snapshot=host.getState()){
   detach();root=node;workspace=snapshot?.workspace_key||current();disposed=false;assertWorkspace();
   state={document:null,study:null,answer:null,dirty:false,busy:false,pendingExperiment:null,draftKey:null,runId:null,runRevision:null};
   catalog={studies:[],experiments:[]};taskSignature='';catalogRefreshPending=false;historyRefreshPending=null;refreshing=false;taskDetails.clear();memory=stored(workspace);events=new AbortController();
   root.classList.add('robust-workbench');root.innerHTML=markup;bindControls();paintOperations();status('Reading retained decision studies…');
   const key=workspace,generation=lifecycle;
   try{
     await refreshCatalog();if(!active(key,generation))return;
     if(memory.open_draft&&memory.drafts[memory.open_draft])restoreDraft(memory.open_draft);
     else if(memory.selected&&rows(catalog.studies).some(value=>value.id===memory.selected))await openStudy(memory.selected);
     else status();
     if(active(key,generation))await settle();
   }catch(error){if(active(key,generation))status(error.message||error);}
 }
 function update(snapshot=host.getState()){
   if(disposed||!root)return;if(snapshot?.workspace_key!==workspace){detach();return;}
   const signature=canonical(rows(host.getState()?.tasks).map(task=>[task.id,task.state]));if(signature===taskSignature)return;taskSignature=signature;paintOperations();
   const key=workspace,generation=lifecycle,hadPending=catalogRefreshPending||historyRefreshPending;settle().then(()=>{if(hadPending&&active(key,generation))return refreshWhenIdle();}).catch(error=>{if(active(key,generation))status(error.message||error);});
 }
 function detach(){persist();disposed=true;lifecycle++;loadVersion++;events?.abort();events=null;root?.classList.remove('robust-workbench');root=null;state.busy=false;}
 return {mount,update,detach,open:openStudy,prepare:configureExperiment};
}
