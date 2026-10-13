/* Native operator adapter for the original OPT12 decision panel.
 * Original panel SHA-256: f82d2b853bc97bea48f8e97099920241b61458b5f395aae2315dcc59424e0f4a.
 * Scientific study construction, optimization, persistence and exports stay in eco_robust.
 */
const markup = "<header><div><h1>Ecosystem decision studies</h1><p>Compare complete modeled alternatives across retained parameter profiles.</p></div><span class=\"badge\">RETAINED DECISION STUDIES</span></header>\n<div class=\"rw-body\">\n<div class=\"toolbar\"><select id=\"rw-studies\" data-rw=\"studies\" aria-label=\"Saved studies\"><option value=\"\">Select a saved study</option></select><button id=\"rw-refresh\" data-rw=\"refresh\">Refresh</button><button id=\"rw-importToggle\" data-rw=\"importToggle\">Import study or project</button></div>\n<div id=\"rw-status\" data-rw=\"status\" class=\"status\" role=\"status\" aria-live=\"polite\"></div><div id=\"rw-operations\" data-rw=\"operations\"></div><div class=\"toolbar\"><label>Browser drafts <select id=\"rw-drafts\" data-rw=\"drafts\"><option value=\"\">Open a retained browser draft</option></select></label></div>\n<section id=\"rw-importCard\" data-rw=\"importCard\" class=\"card\">\n<h2>Prepare a decision study</h2><div class=\"toolbar\"><label class=\"rw-grow\">Retained native experiment<select id=\"rw-experiments\" data-rw=\"experiments\" aria-label=\"Retained native experiment\"><option value=\"\">Select an experiment</option></select></label><button id=\"rw-configureExperiment\" data-rw=\"configureExperiment\" class=\"primary\">Configure native experiment</button></div><p class=\"muted\">Choose an experiment with its original paired summary. Enter decision costs, capacity, metric scales and weights below; the native receiver binds its complete outcome matrix when you save.</p><h3>Use retained scientific diagnostics</h3><div class=\"toolbar\"><label class=\"rw-grow\">Saved shared-footprint analysis<select id=\"rw-diagnostics\" data-rw=\"diagnostics\" aria-label=\"Saved scientific diagnostics\"><option value=\"\">Select a diagnostic</option></select></label><button id=\"rw-configureDiagnostic\" data-rw=\"configureDiagnostic\">Configure saved diagnostics</button></div><p class=\"muted\">Use the saved common-valid-cell mass totals across the declared profiles and scenarios. This keeps the exact report revision and native run identities. Enter costs, capacity, scales and weights before saving.</p><h3>Receive existing work</h3><p class=\"muted\">Open a decision-study JSON or a complete exported project. For a native experiment, select its original summary and a configuration containing the chosen candidate costs, profiles, metric scales and weights.</p>\n<div class=\"file-row\"><label>Decision study or portable project<input id=\"rw-studyFile\" data-rw=\"studyFile\" type=\"file\" accept=\".json,application/json\"></label><label>Original experiment summary<input id=\"rw-nativeFile\" data-rw=\"nativeFile\" type=\"file\" accept=\".json,application/json\"></label><label>Decision configuration<input id=\"rw-configFile\" data-rw=\"configFile\" type=\"file\" accept=\".json,application/json\"></label></div>\n<div class=\"actions controls\"><button id=\"rw-importStudy\" data-rw=\"importStudy\">Receive study / project</button><button id=\"rw-importNative\" data-rw=\"importNative\">Receive native results</button></div>\n</section>\n<div id=\"rw-empty\" data-rw=\"empty\" class=\"card empty\">Receive a study or open a saved decision to compare alternatives.</div>\n<div id=\"rw-editor\" data-rw=\"editor\" class=\"hidden\">\n<section class=\"card\">\n<div class=\"toolbar\"><h2 style=\"margin:0;flex:1\">Decision inputs</h2><span id=\"rw-revision\" data-rw=\"revision\" class=\"badge\"></span><label>Saved revision <input id=\"rw-openRevision\" data-rw=\"openRevision\" aria-label=\"Saved study revision\" type=\"number\" min=\"1\" step=\"1\"></label><button id=\"rw-readRevision\" data-rw=\"readRevision\">Open revision</button></div>\n<div class=\"grid rw-input-grid\"><label>Study title<input id=\"rw-title\" data-rw=\"title\" type=\"text\"></label><label>Cost units<input id=\"rw-costUnitsInput\" data-rw=\"costUnitsInput\" type=\"text\" placeholder=\"Enter the actual decision cost unit\"></label><label>Budget ceiling <small id=\"rw-costUnits\" data-rw=\"costUnits\"></small><input id=\"rw-budget\" data-rw=\"budget\" type=\"number\" min=\"0\" step=\"any\" placeholder=\"No ceiling\"></label><label>Capacity ceiling<input id=\"rw-capacity\" data-rw=\"capacity\" type=\"number\" min=\"0\" step=\"any\" placeholder=\"No ceiling\"></label><label class=\"rw-wide\">Selection model<input id=\"rw-mode\" data-rw=\"mode\" type=\"text\" readonly></label></div>\n<p id=\"rw-basis\" data-rw=\"basis\" class=\"muted controls\"></p>\n<h3>Physical outcomes and decision preferences</h3><p class=\"muted\">Positive gain is lower annual export. Each target must be met in every included profile. The score is the sum of weight × gain ÷ scale; physical outcomes keep their original units.</p>\n<div class=\"scroll\"><table id=\"rw-metrics\" data-rw=\"metrics\"><thead><tr><th>Metric / annual unit</th><th>Fixed scale</th><th>Decision weight</th><th>Guaranteed gain</th></tr></thead><tbody></tbody></table></div>\n<h3>Candidate packages / actions</h3><div class=\"scroll\"><table id=\"rw-candidates\" data-rw=\"candidates\"><thead><tr><th>Candidate</th><th>Cost</th><th>Capacity used</th><th>Group</th><th>Selection constraints</th></tr></thead><tbody></tbody></table></div>\n<h3>Included parameter profiles</h3><div id=\"rw-diagnosticControls\" data-rw=\"diagnosticControls\" class=\"card hidden\"><label>Routing and model-period comparison<select id=\"rw-structuralMode\" data-rw=\"structuralMode\"><option value=\"single_group\">One retained structural model group</option><option value=\"explicit_structural_ensemble\">Explicit comparison of different structural models</option></select></label><label>Reason for comparing structural models<input id=\"rw-structuralReason\" data-rw=\"structuralReason\" type=\"text\" placeholder=\"Describe the routing or period hypotheses being compared\"></label><p class=\"muted\">Different periods, routing methods and model scopes remain identified as separate structural hypotheses. A combined comparison needs an explicit reason. Numeric table and parameter variations stay within their recorded groups.</p></div><div class=\"scroll\"><table id=\"rw-profiles\" data-rw=\"profiles\"><thead><tr><th>Profile</th><th>Explicit probability (optional)</th><th>Retained source</th></tr></thead><tbody></tbody></table></div>\n<details><summary>Original input matrix and source references</summary><div id=\"rw-matrix\" data-rw=\"matrix\" class=\"scroll\"></div></details>\n<details><summary>Advanced configuration</summary><p class=\"muted\">Edit the complete study for profile/candidate membership, group limits or source metadata. Applying it updates the form; saving creates a new revision.</p><textarea id=\"rw-advanced\" data-rw=\"advanced\" spellcheck=\"false\" aria-label=\"Complete study JSON\"></textarea><button id=\"rw-applyAdvanced\" data-rw=\"applyAdvanced\">Apply JSON to form</button></details>\n<p id=\"rw-preparationNote\" data-rw=\"preparationNote\" class=\"muted\"></p><div class=\"actions controls\"><button id=\"rw-save\" data-rw=\"save\" class=\"primary\">Save new revision</button><button id=\"rw-exportStudy\" data-rw=\"exportStudy\">Export current inputs</button><button id=\"rw-exportProject\" data-rw=\"exportProject\">Export complete project</button><button id=\"rw-transferStudy\" data-rw=\"transferStudy\">Transfer editable study</button><span id=\"rw-dirty\" data-rw=\"dirty\" class=\"muted\"></span></div>\n</section>\n<section class=\"card\">\n<h2>Calculate a decision</h2><div class=\"grid\"><label>Objective<select id=\"rw-objective\" data-rw=\"objective\"><option value=\"worst_case\">Maximize worst-profile score</option><option value=\"minimax_regret\">Minimize maximum regret</option><option value=\"expected\">Maximize expected score</option></select></label><label>Calculation time allowance (seconds)<input id=\"rw-timeLimit\" data-rw=\"timeLimit\" type=\"number\" min=\"1\" max=\"3600\" value=\"60\"></label><label>Frontier budgets (comma-separated)<input id=\"rw-budgets\" data-rw=\"budgets\" type=\"text\" placeholder=\"e.g. 10000, 25000, 50000\"></label><label>Source revision<input id=\"rw-solveRevision\" data-rw=\"solveRevision\" type=\"text\" readonly></label></div>\n<p class=\"muted\">Regret compares this decision with each profile’s best plan under the same constraints. Expected values require explicit probabilities. Save changed inputs before calculating.</p>\n<div class=\"actions\"><button id=\"rw-solve\" data-rw=\"solve\" class=\"primary\">Calculate selection</button><button id=\"rw-frontier\" data-rw=\"frontier\">Calculate budget frontier</button><span id=\"rw-runStatus\" data-rw=\"runStatus\" class=\"muted\"></span></div>\n</section>\n<section id=\"rw-results\" data-rw=\"results\" class=\"card hidden\"><div class=\"toolbar\"><h2 style=\"margin:0;flex:1\">Decision results</h2><button id=\"rw-reportHtml\" data-rw=\"reportHtml\">HTML report</button><button id=\"rw-reportCsv\" data-rw=\"reportCsv\">Outcome CSV</button><button id=\"rw-exportSelection\" data-rw=\"exportSelection\">Implementation selection</button><button id=\"rw-exportResult\" data-rw=\"exportResult\">Export result JSON</button><button id=\"rw-nativeDelivery\" data-rw=\"nativeDelivery\">Prepare map release</button></div><p id=\"rw-resultBinding\" data-rw=\"resultBinding\" class=\"muted\"></p><div id=\"rw-nativeDeliveryCard\" data-rw=\"nativeDeliveryCard\" class=\"card\" hidden><div class=\"toolbar\"><h3>Prepare map release from this saved calculation</h3><button id=\"rw-nativeClose\" data-rw=\"nativeClose\">Close map choices</button></div><p id=\"rw-nativeBinding\" data-rw=\"nativeBinding\" class=\"muted\"></p><p class=\"muted\">Choose the retained budget point where applicable, then the scientific profile whose original baseline and selected scenario will be mapped. The map release preserves the complete decision calculation and all-profile context. Current editor changes do not change this saved result.</p><div class=\"grid\"><label id=\"rw-nativePointField\" data-rw=\"nativePointField\" hidden>Retained frontier point<select id=\"rw-nativePoint\" data-rw=\"nativePoint\"><option value=\"\">Choose a retained frontier point</option></select></label><label>Scientific profile<select id=\"rw-nativeProfile\" data-rw=\"nativeProfile\"><option value=\"\">Choose the scientific profile for these maps</option></select></label></div><p id=\"rw-nativePair\" data-rw=\"nativePair\" class=\"muted wrap\"></p><div id=\"rw-nativeIssues\" data-rw=\"nativeIssues\" role=\"status\"></div><div class=\"actions\"><button id=\"rw-nativeOpenMap\" data-rw=\"nativeOpenMap\">Open map release</button></div></div><div id=\"rw-resultBody\" data-rw=\"resultBody\"></div></section>\n<details class=\"card\"><summary>Retained calculation history</summary><div id=\"rw-history\" data-rw=\"history\"></div></details>\n</div>\n<footer>Original native scenario packages remain whole. Separate additive-action studies require an explicit decomposition basis. Saved revisions and source identities travel with the complete project.</footer>\n</div>";
const clone=value=>JSON.parse(JSON.stringify(value));
const rows=value=>Array.isArray(value)?value:[];
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value);}
const actionLabels={
 'robust.study.create':'Receive decision study','robust.study.revise':'Save study revision',
 'robust.experiment.prepare':'Prepare native decision study','robust.summary.prepare':'Receive original paired results',
 'robust.diagnostic.prepare':'Prepare decision from saved diagnostics',
 'robust.solve':'Calculate selection','robust.frontier':'Calculate budget frontier',
 'robust.project.export':'Export complete project','robust.project.receive':'Receive complete project',
 'robust.selection.export':'Export implementation selection','robust.report.export':'Export decision report'
};
const exportActions=new Set(['robust.project.export','robust.selection.export','robust.report.export']);
export function createRobustWorkbench(host){
 if(typeof host.api!=='function'||typeof host.getState!=='function')throw Error('Open decision studies through the original scientific operator.');
 let root=null,events=null,workspace=null,lifecycle=0,loadVersion=0,disposed=true,catalog={studies:[],experiments:[],diagnostics:[]},taskSignature='',catalogRefreshPending=false,historyRefreshPending=null,refreshing=false;
 let memory={drafts:{},requests:[],selected:null,open_draft:null};
 let state={document:null,study:null,answer:null,dirty:false,busy:false,pendingExperiment:null,pendingDiagnostic:null,draftKey:null,runId:null,runRevision:null};
 let nativeView=null,nativeVersion=0;
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
   return {study:collect(false),document:state.document?{id:state.document.id,head:state.document.head,revision:state.document.revision,sha256:state.document.sha256??null,runs:[]}:null,pending_experiment:state.pendingExperiment,pending_diagnostic:clone(state.pendingDiagnostic),draft_key:state.draftKey};
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
   const diagnosticSelection=$('#diagnostics').value;clear($('#diagnostics'));$('#diagnostics').append(new Option('Select a diagnostic',''));
   for(const diagnostic of rows(catalog.diagnostics)){
     const option=new Option((diagnostic.title||diagnostic.id)+' · '+(diagnostic.state||'retained'),diagnostic.id);
     option.disabled=['running','unreadable'].includes(diagnostic.state);$('#diagnostics').append(option);
   }
   if(rows(catalog.diagnostics).some(value=>value.id===diagnosticSelection))$('#diagnostics').value=diagnosticSelection;
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
function renderStudy(){const s=state.study;$('#diagnosticControls').classList.toggle('hidden',!s.source?.diagnostic_id);$('#structuralMode').value=s.source?.diagnostic_design?.structural_mode||'single_group';$('#structuralReason').value=s.source?.diagnostic_design?.structural_reason||'';$('#editor').classList.remove('hidden');$('#empty').classList.add('hidden');$('#importCard').classList.add('hidden');$('#title').value=s.title;$('#budget').value=s.budget??'';$('#capacity').value=s.capacity??'';$('#costUnits').textContent=s.cost_units;$('#costUnitsInput').value=s.cost_units||'';$('#mode').value=s.mode==='native_packages'?'One complete native package':'Explicit additive actions';$('#basis').textContent=s.mode==='native_packages'?'Choose exactly one previously evaluated package. Scenario effects are never added together.':s.additive_basis;$('#revision').textContent=(state.pendingExperiment||state.pendingDiagnostic)?'NATIVE STUDY PREPARATION':'REVISION '+state.document.revision;$('#solveRevision').value=(state.pendingExperiment||state.pendingDiagnostic)?'Save the native study first':state.document.revision;$('#openRevision').value=state.document.revision??'';$('#openRevision').max=state.document.head??'';$('#openRevision').disabled=Boolean(state.pendingExperiment||state.pendingDiagnostic);
clear($('#metrics tbody'));for(const m of s.metrics){const tr=element('tr');const name=element('td',m.label||m.id);name.append(element('small',m.id+' · '+m.units));tr.append(name);inputCell(tr,m.scale,{min:0,label:m.id+' scale'});inputCell(tr,m.weight,{min:0,label:m.id+' weight'});inputCell(tr,m.guaranteed_gain,{label:m.id+' target'});$('#metrics tbody').append(tr);}
clear($('#candidates tbody'));for(const c of s.candidates){const tr=element('tr');const name=element('td',c.label||c.id);name.append(element('small',c.id));tr.append(name);inputCell(tr,c.cost,{min:0,label:c.id+' cost'});inputCell(tr,c.capacity,{min:0,label:c.id+' capacity'});tr.append(element('td',c.group||'—'));const td=element('td');const checks=element('div',undefined,'checks');for(const key of ['required','excluded']){const label=element('label');const input=element('input');input.type='checkbox';input.checked=c[key];input.setAttribute('aria-label',c.id+' '+key);input.addEventListener('change',mark);label.append(input,document.createTextNode(' '+key));checks.append(label);}td.append(checks);tr.append(td);$('#candidates tbody').append(tr);}
clear($('#profiles tbody'));for(const p of s.profiles){const tr=element('tr');const name=element('td',p.label||p.id);name.append(element('small',p.id));tr.append(name);inputCell(tr,p.probability,{min:0,label:p.id+' probability'});const cell=element('td',JSON.stringify(p.source||{}));cell.className='wrap';tr.append(cell);$('#profiles tbody').append(tr);}
clear($('#matrix'));const rows=s.cells.map(c=>[c.profile_id,c.candidate_id,...s.metrics.map(m=>number(c.gains[m.id])),c.source?.baseline_run_id||'—',c.source?.alternative_run_id||'—']);$('#matrix').append(table(['Profile','Candidate',...s.metrics.map(m=>m.id+' ['+m.units+']'),'Baseline run','Alternative run'],rows));const refs=element('pre',JSON.stringify(s.source,null,2));$('#matrix').append(refs);$('#advanced').value=JSON.stringify(s,null,2);state.dirty=false;$('#dirty').textContent=(state.pendingExperiment||state.pendingDiagnostic)?'Unsaved native preparation':'Saved inputs';$('#save').textContent=(state.pendingExperiment||state.pendingDiagnostic)?'Save native decision study':'Save new revision';$('#preparationNote').textContent=state.pendingDiagnostic?'Saved diagnostic '+state.pendingDiagnostic.id+' · report SHA-256 '+state.pendingDiagnostic.sha+'. This exact shared-footprint report is bound when you save.':state.pendingExperiment?'Original paired results will be bound to this configuration when the native study is saved. Outcome cells come from the retained experiment.':'';}
function collect(validate=true){const s=structuredClone(state.study);if(s.source?.diagnostic_id)s.source.diagnostic_design={structural_mode:$('#structuralMode').value,structural_reason:$('#structuralReason').value.trim()};s.title=$('#title').value;s.cost_units=$('#costUnitsInput').value.trim();if(validate&&!s.cost_units)throw Error('Supply the actual decision cost units.');s.budget=nullable($('#budget'),validate);s.capacity=nullable($('#capacity'),validate);[...$('#metrics tbody').rows].forEach((tr,i)=>{const [scale,weight,target]=tr.querySelectorAll('input');s.metrics[i].scale=requiredNumber(scale,validate);s.metrics[i].weight=requiredNumber(weight,validate);s.metrics[i].guaranteed_gain=nullable(target,validate);});[...$('#candidates tbody').rows].forEach((tr,i)=>{const [cost,capacity,required,excluded]=tr.querySelectorAll('input');Object.assign(s.candidates[i],{cost:requiredNumber(cost,validate),capacity:requiredNumber(capacity,validate),required:required.checked,excluded:excluded.checked});});[...$('#profiles tbody').rows].forEach((tr,i)=>s.profiles[i].probability=nullable(tr.querySelector('input'),validate));return s;}
function table(headers,rows){const t=element('table');const head=element('thead');const tr=element('tr');headers.forEach(h=>tr.append(element('th',h)));head.append(tr);t.append(head);const body=element('tbody');for(const cells of rows){const row=element('tr');for(const value of cells)row.append(element('td',String(value??'—'),'wrap'));body.append(row);}t.append(body);return t;}
function resultTable(container,headers,rows){const div=element('div',undefined,'scroll');div.append(table(headers,rows));container.append(div);}
function renderAnswer(answer,runId=null,revision=null){resetNativeDelivery();state.answer=answer;state.runId=runId;state.runRevision=revision;if(runId&&state.document?.id&&Number.isInteger(revision)){memory.calculation={study_id:state.document.id,run_id:runId,revision};persist();}$('#resultBinding').textContent=(state.document?.id?'Study '+state.document.id+' · ':'')+(revision!=null?'source revision '+revision:'Retained calculation');const box=$('#resultBody');clear(box);$('#results').classList.remove('hidden');
if(answer.schema_version==='ecosci.robust-frontier/1'){box.append(element('p','Budget comparison · each point retains its own complete input binding and profile results.','muted'));resultTable(box,['Budget','Status','Selected','Cost','Worst score','Maximum regret'],answer.points.map(p=>[number(p.budget),p.result?.status||p.status,(p.result?.selected_ids||[]).join(', '),number(p.result?.cost),number(p.result?.worst_score),number(p.result?.maximum_regret)]));}
else {const r=answer.result;box.append(element('p',answer.objective.replaceAll('_',' ')+' · '+r.status+' · '+number(answer.elapsed_seconds)+' seconds','muted'));if(r.selected_ids){const stats=element('div',undefined,'summary');for(const [label,value] of [['Selected',r.selected_ids.join(', ')],['Cost ['+r.cost_units+']',number(r.cost)],['Worst-profile score',number(r.worst_score)],['Maximum regret',number(r.maximum_regret)]]){const stat=element('div',undefined,'stat');stat.append(element('span',label),element('strong',value,'wrap'));stats.append(stat);}box.append(stats);box.append(element('h3','Performance in every included profile'));resultTable(box,['Profile','Score','Regret','Metric','Gain','Unit','Target','Shortfall'],r.profiles.flatMap(p=>p.metrics.map(m=>[p.id,number(p.score),number(p.regret),m.id,number(m.gain),m.units,number(m.guaranteed_gain),number(m.target_shortfall)])));box.append(element('h3','Constraint margins'));resultTable(box,['Constraint','Actual','Above minimum','Below maximum'],r.constraints.map(c=>[c.id,number(c.value),number(c.lower_slack),number(c.upper_slack)]));}
else{box.append(element('p',r.message||r.status));if(r.diagnostic_without_gain_targets){box.append(element('h3','Comparison with gain targets relaxed'));const d=r.diagnostic_without_gain_targets;box.append(element('p','Budget, capacity, membership and required/excluded choices are retained. This comparison identifies target shortfalls; it does not replace your constrained decision.','muted'));if(d.selected_ids){box.append(element('p','Selected: '+d.selected_ids.join(', ')));resultTable(box,['Profile','Metric','Gain','Target','Shortfall'],d.profiles.flatMap(p=>p.metrics.map(m=>[p.id,m.id,number(m.gain),number(m.guaranteed_gain),number(m.target_shortfall)])));}else box.append(element('p',d.message));}}
if(answer.profile_benchmarks?.length){box.append(element('h3','Profile-specific best plans'));resultTable(box,['Profile','Status','Best score','Selected'],answer.profile_benchmarks.map(b=>[b.profile_id,b.status,number(b.profile_optimum),(b.selected_ids||[]).join(', ')]));}if(answer.value_of_information){const v=answer.value_of_information;box.append(element('h3','Value of perfect profile information'));box.append(element('p',number(v.evpi)+' '+v.units+'. Expected score with perfect information: '+number(v.perfect_information_score)+'; best single expected plan: '+number(v.optimal_expected_score)+'.'));box.append(element('p','This diagnostic uses the supplied probabilities and the same all-profile feasibility requirements. It is an objective-score difference, not a currency valuation.','muted'));}}
const details=element('details');details.append(element('summary','Complete calculation and retained identities'),element('pre',JSON.stringify(answer,null,2)));box.append(details);}
function history(){clear($('#history'));for(const r of state.document.runs){const div=element('div',undefined,'toolbar controls');div.append(element('span',r.created+' · revision '+r.revision+' · '+r.objective+' · '+r.status,'muted'));if(r.result){const button=element('button','View result');button.onclick=()=>renderAnswer(r.result,r.id,r.revision);div.append(button);}if(r.error)div.append(element('span',r.error,'wrap'));$('#history').append(div);}if(rows(state.document._downloads).length){const files=element('div',undefined,'rw-study-files');files.append(element('h3','Saved study exports'));appendDownloads(files,state.document._downloads);$('#history').append(files);}}

function openDocument(d){state.pendingExperiment=null;state.pendingDiagnostic=null;state.document=d;state.study=structuredClone(d.study);renderStudy();history();const done=d.runs.filter(r=>r.result);if(done.length)renderAnswer(done.at(-1).result,done.at(-1).id,done.at(-1).revision);else{$('#results').classList.add('hidden');state.answer=null;state.runId=null;state.runRevision=null;}$('#studies').value=d.id;memory.selected=d.id;memory.open_draft=null;state.draftKey='study:'+d.id;persist();paintDrafts();}

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
   state.pendingExperiment=draft.pending_experiment||null;state.pendingDiagnostic=clone(draft.pending_diagnostic||null);state.draftKey=key;state.answer=null;state.runId=null;state.runRevision=null;
   renderStudy();history();$('#results').classList.add('hidden');mark();status('Restored the retained browser draft. Save it to create a native study revision.');
 }
 async function configureExperiment(selectedExperiment){
   const id=typeof selectedExperiment==='string'?selectedExperiment:$('#experiments').value;if(!id)throw Error('Select a retained experiment with an original paired summary.');
   persist();
   if(memory.drafts['experiment:'+id]?.pending_experiment===id){restoreDraft('experiment:'+id);return;}
   const version=++loadVersion;const value=await read('experiment',{experiment_id:id});
   if(version!==loadVersion)return;
   state.pendingExperiment=id;state.pendingDiagnostic=null;state.document={id:null,head:null,revision:null,runs:[]};
   state.study={...clone(value.configuration),cells:[]};state.draftKey='experiment:'+id;state.answer=null;state.runId=null;state.runRevision=null;
   renderStudy();history();$('#results').classList.add('hidden');mark();
   status('Enter the decision costs, capacity, scales and weights. Saving binds the original paired outcomes to this study.');
 }
 async function loadDiagnosticDraft(id,expectedSha=null,requestedWorkspace=current()){
   const key=requestedWorkspace,generation=lifecycle,version=++loadVersion;
   if(!key||key!==current())throw Error('Open this diagnostic in its original workspace.');
   if(!/^[0-9a-f]{64}$/.test(id||''))throw Error('Select an original saved diagnostic ID.');
   if(expectedSha!==null&&!/^[0-9a-f]{64}$/.test(expectedSha))throw Error('Select the exact saved diagnostic report revision.');
   const mounted=active(key,generation);
   if(root&&!mounted)throw Error('Reopen the decision view in the selected original workspace.');
   if(mounted)persist();
   const value=await host.api('/api/robust-workbench/diagnostic',{method:'POST',body:{workspace:key,diagnostic_id:id}});
   if(current()!==key||lifecycle!==generation||loadVersion!==version)throw Error('The decision view changed while its diagnostic was loading.');
   if(value.diagnostic_id!==id||!/^[0-9a-f]{64}$/.test(value.report_sha256||''))throw Error('The original diagnostic preview returned a different report identity.');
   if(expectedSha!==null&&value.report_sha256!==expectedSha)throw Error('This diagnostic report changed after it was opened. Reopen its current saved analysis before preparing the decision.');
   const draftKey='diagnostic:'+id+':'+value.report_sha256;
   const target=workspace===key?memory:stored(key),existing=target.drafts[draftKey];
   const draft=existing&&existing.pending_diagnostic?.id===id&&existing.pending_diagnostic?.sha===value.report_sha256
     ?clone(existing):{study:{...clone(value.configuration),cells:[]},document:{id:null,head:null,revision:null,runs:[]},
       pending_experiment:null,pending_diagnostic:{id,sha:value.report_sha256},draft_key:draftKey};
   target.drafts[draftKey]=draft;target.open_draft=draftKey;
   try{localStorage.setItem(storageKey(key),JSON.stringify(target));}
   catch{throw Error('The browser could not retain this diagnostic preparation. Restore browser storage before changing views.');}
   if(mounted){
     memory=target;restoreDraft(draftKey);
     status('Enter costs, capacity, scales and weights. Saving uses this exact common-support report; every requested pair must be complete.');
   }
   return {workspace_key:key,diagnostic_id:id,report_sha256:value.report_sha256,draft_key:draftKey};
 }
 async function configureDiagnostic(){
   const id=$('#diagnostics').value;if(!id)throw Error('Select a saved scientific diagnostic.');
   return loadDiagnosticDraft(id);
 }
 async function openForDiagnostic(options={}){
   if(!/^[0-9a-f]{64}$/.test(options.report_sha256||''))throw Error('Open a saved diagnostic with its exact report SHA-256.');
   return loadDiagnosticDraft(options.diagnostic_id,options.report_sha256,options.workspace_key||current());
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
     if(['robust.study.revise','robust.experiment.prepare','robust.diagnostic.prepare'].includes(request.action)&&request.draft_key&&memory.drafts[request.draft_key]&&canonical(memory.drafts[request.draft_key])===request.editor_signature)delete memory.drafts[request.draft_key];
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
   if(state.pendingDiagnostic){const configuration=clone(study);delete configuration.cells;return queue('robust.diagnostic.prepare',{diagnostic_id:state.pendingDiagnostic.id,report_sha256:state.pendingDiagnostic.sha,configuration},{openResult:true});}
   if(state.pendingExperiment){const configuration=clone(study);delete configuration.cells;return queue('robust.experiment.prepare',{experiment_id:state.pendingExperiment,configuration},{openResult:true});}
   if(!state.document?.id)throw Error('Receive a study or configure a retained native experiment first.');
   return queue('robust.study.revise',{study_id:state.document.id,study,expected_revision:state.document.head},{openResult:true});
 }
 async function calculate(frontier){
   if(!state.document?.id||state.pendingExperiment||state.pendingDiagnostic)throw Error('Save the native decision study before calculating.');
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

 function nativeContext(){
   const study_id=requireStudy(),run_id=requireRun(),revision=state.runRevision;
   if(!Number.isInteger(revision)||revision<1)throw Error('Open the saved calculation with its original study revision.');
   return {study_id,run_id,revision,key:study_id+':'+run_id};
 }
 function sameNativeContext(context){
   return state.document?.id===context.study_id&&state.runId===context.run_id&&state.runRevision===context.revision;
 }
 function nativeDraft(context){
   const value=memory.native_deliveries?.[context.key];
   return value&&value.revision===context.revision?value:{revision:context.revision,point_index:null,profile_id:null};
 }
 function saveNativeDraft(context,patch={}){
   if(!memory.native_deliveries||typeof memory.native_deliveries!=='object'||Array.isArray(memory.native_deliveries))memory.native_deliveries={};
   memory.native_deliveries[context.key]={...nativeDraft(context),...patch,revision:context.revision};
   memory.open_native_delivery=context.key;persist();
 }
 function resetNativeDelivery(){
   nativeVersion++;nativeView=null;
   if($('#nativeDeliveryCard'))$('#nativeDeliveryCard').hidden=true;
 }
 function nativeIssue(value){
   if(typeof value==='string')return value;
   if(!value||typeof value!=='object')return String(value??'');
   return value.message||value.reason||value.issue||value.code||JSON.stringify(value);
 }
 function paintNativeDelivery(){
   const view=nativeView;if(!view||!sameNativeContext(view.context))return;
   const value=view.options,draft=nativeDraft(view.context),points=view.points;
   $('#nativeDeliveryCard').hidden=false;
   $('#nativeBinding').textContent=(value.title||'Saved decision')+' · source revision '+value.revision+' · calculation '+value.run_id;
   const point=$('#nativePoint');clear(point);point.append(new Option('Choose a retained frontier point',''));
   for(const row of points){
     const option=new Option('Budget '+number(row.budget)+' · '+(row.status||'retained')+(row.ready===false?' · unavailable':''),String(row.point_index));
     option.disabled=row.ready===false;point.append(option);
   }
   const frontier=state.answer?.schema_version==='ecosci.robust-frontier/1';
   $('#nativePointField').hidden=!frontier;
   if(Number.isInteger(value.point_index)&&points.some(row=>row.point_index===value.point_index))point.value=String(value.point_index);
   else point.value='';
   const profiles=$('#nativeProfile');clear(profiles);profiles.append(new Option('Choose the scientific profile for these maps',''));
   for(const profile of rows(value.profiles)){
     const option=new Option((profile.label||profile.id)+(profile.ready===false?' · unavailable':''),profile.id);
     option.disabled=profile.ready===false;profiles.append(option);
   }
   if(rows(value.profiles).some(profile=>profile.id===draft.profile_id&&profile.ready!==false))profiles.value=draft.profile_id;
   else profiles.value='';
   clear($('#nativeIssues'));
   const messages=rows(value.issues).map(nativeIssue);
   for(const profile of rows(value.profiles))if(profile.ready===false){
     const problems=rows(profile.issues).map(nativeIssue).filter(Boolean);
     messages.push((profile.label||profile.id)+': '+(problems.join('; ')||'The original native pair is unavailable.'));
   }
   for(const message of [...new Set(messages.filter(Boolean))])$('#nativeIssues').append(element('p',message,'muted'));
   const selected=rows(value.profiles).find(profile=>profile.id===profiles.value);
   $('#nativePair').textContent=selected
     ?'Selected profile: '+(selected.label||selected.id)+' · grid '+selected.grid_id+' · original baseline '+selected.baseline_run_id+' · original alternative '+selected.alternative_run_id
     :'Choose an explicit profile. The map release retains the complete saved decision context across all included profiles.';
   $('#nativeOpenMap').hidden=typeof host.openExtension!=='function';
 }
 async function loadNativeDelivery(pointIndex=null,{restore=false}={}){
   const context=nativeContext(),key=workspace,generation=lifecycle,version=++nativeVersion;
   const prior=nativeView?.context.key===context.key?nativeView:null;
   if(pointIndex!==null&&(!Number.isInteger(pointIndex)||pointIndex<0))throw Error('Choose an original frontier point.');
   saveNativeDraft(context,{...(pointIndex!==null?{point_index:pointIndex}:{})});
   $('#nativeDeliveryCard').hidden=false;$('#nativeBinding').textContent='Reading the saved calculation and its original native pairs…';
   nativeView=null;
   const value=await read('delivery-options',{study_id:context.study_id,run_id:context.run_id,...(pointIndex!==null?{point_index:pointIndex}:{})});
   if(!active(key,generation)||version!==nativeVersion||!sameNativeContext(context))return null;
   if(value.workspace_key!==key||value.study_id!==context.study_id||value.run_id!==context.run_id||value.revision!==context.revision)throw Error('The native map options returned a different saved calculation.');
   if(pointIndex!==null&&value.point_index!==pointIndex)throw Error('The native map options returned a different frontier point.');
   const points=rows(value.points).length?rows(value.points):prior?.points||[];
   nativeView={context,options:value,points};paintNativeDelivery();
   if(restore&&state.answer?.schema_version==='ecosci.robust-frontier/1'&&pointIndex===null){
     const remembered=nativeDraft(context).point_index;
     if(Number.isInteger(remembered)&&points.some(row=>row.point_index===remembered&&row.ready!==false))return loadNativeDelivery(remembered);
   }
   return value;
 }
 async function openNativeMaps(){
   const context=nativeContext(),view=nativeView;
   if(!view||!sameNativeContext(view.context))throw Error('Read the saved native map options first.');
   const profile_id=$('#nativeProfile').value,profile=rows(view.options.profiles).find(row=>row.id===profile_id);
   if(!profile||profile.ready===false)throw Error('Choose an available scientific profile for the selected native scenario.');
   const frontier=state.answer?.schema_version==='ecosci.robust-frontier/1',pointText=$('#nativePoint').value;
   const point_index=frontier&&pointText!==''?Number(pointText):null;
   if(frontier&&(!Number.isInteger(point_index)||point_index<0||view.options.point_index!==point_index))throw Error('Choose and load a retained feasible frontier point first.');
   if(typeof host.openExtension!=='function')throw Error('Open the map release through the current scientific operator.');
   saveNativeDraft(context,{profile_id,point_index});
   const key=workspace,generation=lifecycle,version=++nativeVersion;
   const value=await read('delivery-release',{study_id:context.study_id,run_id:context.run_id,profile_id,...(point_index!==null?{point_index}:{})});
   if(!active(key,generation)||version!==nativeVersion||!sameNativeContext(context)||$('#nativeProfile').value!==profile_id||(frontier&&$('#nativePoint').value!==String(point_index)))return;
   if(value.workspace_key!==key||value.study_id!==context.study_id||value.run_id!==context.run_id||value.revision!==context.revision)throw Error('The native map release returned a different saved calculation.');
   if(!value.ready||!value.selection)throw Error(rows(value.issues).map(nativeIssue).filter(Boolean).join('; ')||'The original native map selection is not ready.');
   const source=value.selection.source_decision;
   if(!source||source.study_id!==context.study_id||source.run_id!==context.run_id||source.revision!==context.revision||source.profile_id!==profile_id||(source.point_index??null)!==point_index)throw Error('The native map selection does not match the chosen saved calculation, point and profile.');
   persist();
   return host.openExtension('map-atlas','create',{workspace_key:key,selection:value.selection});
 }
 async function restoreCalculation(options={},openNative=true){
   const key=options.workspace_key||current(),generation=lifecycle,version=++loadVersion;
   if(!active(key,generation))throw Error('Open Decision studies in the calculation’s original workspace.');
   if(!/^study_[0-9a-f]{32}$/.test(options.study_id||'')||!/^run_[0-9a-f]{32}$/.test(options.run_id||''))throw Error('Open an original saved Decision calculation.');
   if(options.revision!==undefined&&(!Number.isInteger(options.revision)||options.revision<1))throw Error('Select the calculation’s saved positive revision.');
   if(options.point_index!==undefined&&options.point_index!==null&&(!Number.isInteger(options.point_index)||options.point_index<0))throw Error('Choose an original frontier point.');
   persist();status('Opening the original calculation and its bound study revision…');
   const run=await read('run',{study_id:options.study_id,run_id:options.run_id});
   if(!active(key,generation)||version!==loadVersion)return;
   if(run.id!==options.run_id||run.study_id!==options.study_id||!Number.isInteger(run.revision)||run.revision<1||(options.revision!==undefined&&run.revision!==options.revision))throw Error('The retained calculation differs from its requested study revision.');
   if(run.status!=='completed'||!run.result)throw Error('This saved calculation has not completed.');
   const document=await read('study',{study_id:options.study_id,revision:run.revision});
   if(!active(key,generation)||version!==loadVersion)return;
   if(document.id!==options.study_id||document.revision!==run.revision)throw Error('The original study revision did not match the saved calculation.');
   openDocument(document);renderAnswer(run.result,run.id,run.revision);
   const context=nativeContext(),patch={};
   if(options.point_index!==undefined)patch.point_index=options.point_index;
   if(options.profile_id!==undefined)patch.profile_id=options.profile_id;
   if(openNative){saveNativeDraft(context,patch);await loadNativeDelivery(null,{restore:true});}
   if(active(key,generation))status('Opened the original saved calculation at revision '+run.revision+'.');
   return {workspace_key:key,study_id:options.study_id,run_id:run.id,revision:run.revision};
 }
 async function openForCalculation(options={}){return restoreCalculation(options,true);}

 function bindControls(){
   bind('refresh',()=>reconcileView());
   $('#importToggle').addEventListener('click',()=>$('#importCard').classList.toggle('hidden'),{signal:events.signal});
   bind('studies',async()=>{const id=$('#studies').value;if(id)await openStudy(id);},'change');
   bind('drafts',()=>{const key=$('#drafts').value;if(key)restoreDraft(key);},'change');
   bind('configureExperiment',configureExperiment);
   bind('configureDiagnostic',configureDiagnostic);
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
   $('#nativeDelivery').hidden=typeof host.openExtension!=='function';
   bind('nativeDelivery',()=>loadNativeDelivery(null,{restore:true}));
   bind('nativePoint',async()=>{const context=nativeContext(),value=$('#nativePoint').value;saveNativeDraft(context,{point_index:value===''?null:Number(value),profile_id:null});return loadNativeDelivery(value===''?null:Number(value));},'change');
   $('#nativeProfile').addEventListener('change',()=>{nativeVersion++;if(nativeView){saveNativeDraft(nativeView.context,{profile_id:$('#nativeProfile').value||null});paintNativeDelivery();}},{signal:events.signal});
   bind('nativeOpenMap',openNativeMaps);
   $('#nativeClose').addEventListener('click',()=>{memory.open_native_delivery=null;resetNativeDelivery();persist();},{signal:events.signal});
   bind('exportResult',()=>{if(!state.answer)throw Error('Open a retained calculation first.');download('decision-result.json',state.answer);});
   bind('exportSelection',()=>{
     const study_id=requireStudy(),run_id=requireRun();
     if(state.answer?.schema_version!=='ecosci.robust-result/1')throw Error('Choose a budget from the frontier, save that budget in a study revision, and calculate its selection before exporting implementation instructions.');
     if(!Array.isArray(state.answer.result?.selected_ids))throw Error('The retained calculation has no feasible selection. Review its constraints and native diagnostic before exporting implementation instructions.');
     return queue('robust.selection.export',{study_id,run_id});
   });
   for(const [id,format]of [['reportHtml','html'],['reportCsv','csv']])bind(id,()=>queue('robust.report.export',{study_id:requireStudy(),run_id:requireRun(),format}));
   bind('solve',()=>calculate(false));bind('frontier',()=>calculate(true));
   $('#structuralMode').addEventListener('change',mark,{signal:events.signal});
   for(const id of ['title','budget','capacity','costUnitsInput','structuralReason'])$('#'+id).addEventListener('input',mark,{signal:events.signal});
 }
 async function reconcileView({restoreSelection=false}={}){
   const key=workspace,generation=lifecycle,errors=[];
   status();
   const attempt=async(label,fn)=>{
     try{await fn();}catch(error){if(active(key,generation))errors.push(label+': '+(error.message||error));}
     return active(key,generation);
   };
   if(!await attempt('Study catalog',refreshCatalog))return;
   if(restoreSelection){
     if(memory.open_draft&&memory.drafts[memory.open_draft]){
       if(!await attempt('Browser draft',()=>restoreDraft(memory.open_draft)))return;
     }else if(memory.selected){
       const calculation=memory.calculation;
       if(calculation?.study_id===memory.selected){
         if(!await attempt('Saved calculation',()=>restoreCalculation({...calculation,workspace_key:key},memory.open_native_delivery===calculation.study_id+':'+calculation.run_id)))return;
       }else if(!await attempt('Saved study',()=>openStudy(memory.selected)))return;
     }
   }else if(state.document?.id&&!state.dirty){
     if(state.runId){
       const selected={workspace_key:key,study_id:state.document.id,run_id:state.runId,revision:state.runRevision};
       if(!await attempt('Saved calculation',()=>restoreCalculation(selected,memory.open_native_delivery===selected.study_id+':'+selected.run_id)))return;
     }else if(!await attempt('Saved study',()=>openStudy(state.document.id,state.document.revision)))return;
   }
   if(!await attempt('Original decision operations',settle))return;
   if(errors.length)status(errors.join(' · '));
 }
 async function mount(node,snapshot=host.getState()){
   detach();root=node;workspace=snapshot?.workspace_key||current();disposed=false;assertWorkspace();
   state={document:null,study:null,answer:null,dirty:false,busy:false,pendingExperiment:null,pendingDiagnostic:null,draftKey:null,runId:null,runRevision:null};
   catalog={studies:[],experiments:[],diagnostics:[]};taskSignature='';catalogRefreshPending=false;historyRefreshPending=null;refreshing=false;taskDetails.clear();memory=stored(workspace);events=new AbortController();
   root.classList.add('robust-workbench');root.innerHTML=markup;bindControls();paintOperations();status('Reading retained decision studies…');
   await reconcileView({restoreSelection:true});
 }
 function update(snapshot=host.getState()){
   if(disposed||!root)return;if(snapshot?.workspace_key!==workspace){detach();return;}
   const signature=canonical(rows(host.getState()?.tasks).map(task=>[task.id,task.state]));if(signature===taskSignature)return;taskSignature=signature;paintOperations();
   const key=workspace,generation=lifecycle,hadPending=catalogRefreshPending||historyRefreshPending;settle().then(()=>{if(hadPending&&active(key,generation))return refreshWhenIdle();}).catch(error=>{if(active(key,generation))status(error.message||error);});
 }
 function detach(){persist();resetNativeDelivery();disposed=true;lifecycle++;loadVersion++;events?.abort();events=null;root?.classList.remove('robust-workbench');root=null;state.busy=false;}
 return {mount,update,detach,open:openStudy,prepare:configureExperiment,openForDiagnostic,openForCalculation};
}
