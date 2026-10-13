/** Original-operator reach chemistry. No second app, queue, auth or workspace. */
const esc = x => String(x ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty = x => JSON.stringify(x,null,2);
const valueText = x => typeof x==='number'&&!Number.isInteger(x)?x.toPrecision(7):typeof x==='object'?JSON.stringify(x):x;
const button = (action,label,id='') => `<button type="button" data-action="chemistry-${action}" data-id="${esc(id)}">${esc(label)}</button>`;
const parse = (element,label) => {try{return JSON.parse(element.value)}catch(e){throw new Error(`${label}: ${e.message}`)}};
function table(rows,columns){
 if(!rows?.length)return '<p class="chemistry-muted">No records in this selection.</p>';
 return `<div class="chemistry-scroll"><table><thead><tr>${columns.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${columns.map(c=>`<td>${esc(valueText(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
export function csvObservations(text, reference, project=null){
 if(!reference?.trim())throw new Error('State the source reference for the observation file.');
 let rows=[],row=[],cell='',quoted=false;
 for(let i=0;i<=text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else if(c===undefined)throw new Error('Unclosed quoted CSV value.');else cell+=c;}
  else if(c==='"'){if(cell)throw new Error('Unexpected quote in CSV value.');quoted=true;}
  else if(c===','||c==='\n'||c===undefined){row.push(cell);cell='';if(c!==','){if(row.some(x=>x.trim()))rows.push(row);row=[];}}
  else if(c!=='\r')cell+=c;
 }
 if(rows.length<2)throw new Error('Observation CSV needs a header and at least one record.');
 const header=rows.shift().map(x=>x.trim().replace(/^\uFEFF/,''));
 if(new Set(header).size!==header.length||header.some(x=>!x))throw new Error('Observation CSV needs unique, nonempty column names.');
 for(const field of ['id','reach','day','sigma_mg_l'])if(!header.includes(field))throw new Error(`Missing CSV column ${field}.`);
 const known=project?new Map((project.species||[]).map(s=>[s.id,s])):null,ids=new Set();
 return rows.map((row,i)=>{
  const fail=message=>{throw new Error(`Row ${i+2}: ${message}`);};
  if(row.length!==header.length)fail('different column count.');
  let r=Object.fromEntries(header.map((h,j)=>[h,row[j]]));
  for(const key of ['id','reach'])if(!r[key]?.trim())fail(key+' is required.');
  if(ids.has(r.id))fail('observation ID is repeated.');ids.add(r.id);
  const numeric=key=>{if(!String(r[key]??'').trim()||!Number.isFinite(Number(r[key])))fail(key+' must be a finite number.');r[key]=Number(r[key]);};
  for(const key of ['day','sigma_mg_l'])numeric(key);
  if(r.day<0||r.sigma_mg_l<=0)fail('day must be nonnegative and sigma_mg_l positive.');
  r.role=r.role?.trim()||'fit';r.qualifier=r.qualifier?.trim()||'equal';
  if(!['fit','holdout'].includes(r.role))fail('role must be fit or holdout.');
  if(!['equal','below','interval'].includes(r.qualifier))fail('qualifier must be equal, below or interval.');
  if(r.species?.trim()){
   if(['measurement','components'].some(k=>r[k]?.trim()))fail('choose a species or a compound measurement, not both.');
   if(known&&!known.has(r.species))fail('species is absent from the selected project.');
   if(r.basis?.trim()){if(known&&known.get(r.species).basis!==r.basis)fail('basis differs from the selected species.');}else delete r.basis;
   for(const key of ['measurement','components'])delete r[key];
  }else{
   delete r.species;
   if(!r.measurement?.trim()||!r.basis?.trim())fail('a compound measurement requires measurement, basis and components.');
   try{r.components=JSON.parse(r.components);}catch{fail('components must be a JSON array of {species,weight}.');}
   if(!Array.isArray(r.components)||!r.components.length)fail('components must be a nonempty JSON array.');
   const seen=new Set();
   for(const component of r.components){
    if(!component||typeof component.species!=='string'||!component.species.trim()||seen.has(component.species)
      ||typeof component.weight!=='number'||!Number.isFinite(component.weight)||component.weight<=0)fail('components require unique species and positive finite numeric weights.');
    seen.add(component.species);
    if(known&&(!known.has(component.species)||known.get(component.species).basis!==r.basis))fail('every component must use the exact declared conserved basis.');
   }
  }
  if(r.qualifier==='interval'){
   if(String(r.mg_l??'').trim())fail('interval records omit mg_l; keep the original two limits.');
   delete r.mg_l;
   for(const key of ['lower_mg_l','upper_mg_l'])numeric(key);
   if(r.lower_mg_l<0||r.upper_mg_l<=r.lower_mg_l)fail('interval limits require 0 ≤ lower_mg_l < upper_mg_l.');
   for(const key of ['lower_closed','upper_closed']){
    const supplied=String(r[key]??'').trim();
    if(!['true','false'].includes(supplied))fail(key+' must explicitly be true or false.');
    r[key]=supplied==='true';
   }
  }else{
   numeric('mg_l');if(r.mg_l<0)fail('mg_l must be nonnegative.');
   for(const key of ['lower_mg_l','upper_mg_l','lower_closed','upper_closed']){
    if(String(r[key]??'').trim())fail(key+' belongs to interval records.');
    delete r[key];
   }
  }
  return {...r,provenance:{kind:'user-selected-observation',reference}};
 });
}
function observationView(row){
 const r=row.observation||row.candidate||row,compound=!Object.hasOwn(r,'species')&&Array.isArray(r.components);
 const expression=compound?r.components.map(c=>String(c.weight)+' × '+c.species).join(' + '):r.species;
 const limit=r.qualifier==='interval'
  ?(r.lower_closed?'[':'(')+r.lower_mg_l+', '+r.upper_mg_l+(r.upper_closed?']':')')
  :(r.qualifier==='below'?'≤ ':'')+(r.observed_mg_l??r.mg_l??'');
 return {id:r.id,measurement:compound?r.measurement:r.species,operator:expression,basis:r.basis,
  reach:r.reach,day:r.day,role:r.role,qualifier:r.qualifier||'equal',reference_or_limits:limit,
  error_scale:r.sigma_mg_l,prediction:row.predicted_mg_l??r.predicted_mg_l,
  interval_contains_prediction:r.interval_contains_prediction,
  source:r.provenance?.reference};
}
export function attachChemistry(host){
 const {getState,api,endpoint,submitAction,showTask,toast,fileList}=host;
 let root=null,generation=0,editorGeneration=0,runGeneration=0,reportGeneration=0,sourceGeneration=0,selectedCase='',editorCase='',selectedRun='',catalog={cases:[],runs:[]},page=0;
 const workspace=()=>{const s=getState();return s.workspace_key??s.workspace??s.workspaceKey??s.data?.workspace_key;};
 const liveWorkspace=()=>host.getWorkspace();
 const read=(kind,payload={})=>api(endpoint(`/api/chemistry/${kind}`,payload));
 async function perform(action,payload){
  const name=`chemistry.${action}`,key=workspace();
  if(!key)throw new Error('Open the original workspace before submitting a calculation.');
  const signature=JSON.stringify({action:name,payload}),storageKey='upstate-chemistry-requests:'+key;
  let retained={};try{retained=JSON.parse(sessionStorage.getItem(storageKey)||'{}')}catch{}
  const operationId=retained[signature]||crypto.randomUUID();retained[signature]=operationId;
  sessionStorage.setItem(storageKey,JSON.stringify(retained));
  const task=await api('/api/actions',{method:'POST',body:{workspace:key,action:name,payload,operation_id:operationId}});
  delete retained[signature];sessionStorage.setItem(storageKey,JSON.stringify(retained));
  await showTask(task.id);return task;
 };
 function report(error){if(root){let n=root.querySelector('[data-chemistry-status]');if(!n){n=document.createElement('p');n.dataset.chemistryStatus='';root.append(n);const retry=document.createElement('button');retry.type='button';retry.dataset.action='chemistry-refresh';retry.textContent='Retry opening chemistry';root.append(retry)}n.textContent=error.message||String(error);n.setAttribute('role','alert')}else toast(error.message||String(error));}
 async function reload(){
  sourceGeneration++;reportGeneration++;runGeneration++;editorGeneration++;
  const current=++generation;const result=await read('catalog');if(current!==generation||!root)return;
  catalog=result;if(selectedCase&&!catalog.cases.some(c=>c.id===selectedCase))selectedCase='';
  render();
 }
 function render(){
  if(!root)return;
  root.innerHTML=`<section class="chemistry-panel"><header><div><p class="chemistry-eyebrow">WATERSHED SCIENCE / REACH NETWORK</p><h1>Chemical transport & inference</h1><p>Retain a chemical scenario, calculate downstream concentrations and account for every conserved mass basis.</p></div>${button('refresh','Refresh')}</header>
   <p data-chemistry-status role="status" aria-live="polite"></p>
   <div class="chemistry-columns"><section><h2>Saved chemical scenarios</h2><label>Scenario<select data-case><option value="">Choose a scenario</option>${catalog.cases.map(c=>`<option value="${esc(c.id)}" ${c.id===selectedCase?'selected':''}>${esc(c.title)} — ${esc(c.id.slice(0,10))}</option>`).join('')}</select></label>
   <div class="chemistry-actions">${button('open','Open scenario')}${button('new','New from project file')}${button('export','Export editable project')}</div>
   <h3>Retained source intake</h3><label>Source edition / file<select data-source><option value="">Choose an original retained source</option>${(catalog.sources||getState().sources||getState().data?.sources||[]).flatMap(c=>(c.entries||[]).map(e=>`<option value="${esc(JSON.stringify({source_collection_id:c.id,source_id:e.id}))}">${esc(c.title)} / ${esc(e.title||e.id)}</option>`)).join('')}</select></label>
   <div class="chemistry-actions">${button('from-source','Import chemical project')}${button('receive','Receive editable ZIP')}</div>
   <p class="chemistry-muted">Use the original Sources intake for project JSON, observation files and editable ZIPs. Original file identities remain attached to the scenario.</p></section>
   <section><h2>Retained analyses</h2><div data-chemistry-runs>${catalog.runs.map(r=>`<div class="chemistry-run">${button('run-open',`${r.mode} · ${r.state} · ${r.id.slice(0,10)}`,r.id)}<span>${esc(r.title)}</span></div>`).join('')||'<p>No analysis yet.</p>'}</div></section></div>
   <section><h2>Saved scientific reports</h2><div data-chemistry-reports>${reportList()}</div></section>
   <section><h2>Sources for scientific reports</h2><p>Open a retained Chemistry source in the existing ordered report composer, alongside other selected scientific studies.</p><div data-chemistry-report-sources>${sourceList()}</div></section>
   <section data-chemistry-editor hidden></section><section data-chemistry-result hidden></section></section>`;
  root.querySelector('[data-case]').addEventListener('change',e=>{selectedCase=e.target.value});
 }
 function reportList(){
  return (catalog.reports||[]).map(r=>`<div class="chemistry-run">${button('report-open',r.summary?.mode+' · '+r.id.slice(0,10),r.id)}<span>${esc(r.title)} · ${esc(r.edition)}</span></div>`).join('')||'<p>No scientific report saved yet. Open a completed analysis to prepare one.</p>';
 }
 function sourceList(reportId=null){
  const rows=(catalog.report_sources||[]).filter(value=>!reportId||value.report_id===reportId);
  return rows.map(value=>`<div class="chemistry-run"><div class="chemistry-actions">${button('source-compose','Open scientific report',value.id)}${button('source-open','Inspect retained source',value.id)}</div><span>${esc(value.title)} · ${esc(value.mode)} · ${esc(value.figure_count)} figures · ${esc(value.companion_count)} companions</span></div>`).join('')||'<p>No report source prepared yet. Open a saved scientific report to prepare its original figures and companions.</p>';
 }
 async function openSource(id,compose=false){
  const current=++sourceGeneration,selectedWorkspace=liveWorkspace();reportGeneration++;runGeneration++;
  if(selectedWorkspace!==workspace())throw Error('Reopen Chemistry in the original workspace.');
  const value=await read('report-source',{source_record_id:id});
  if(!root||current!==sourceGeneration||liveWorkspace()!==selectedWorkspace||workspace()!==selectedWorkspace)return;
  const selected=value.scientific_report_selection,choice=value.source_selection;
  if(value.workspace_key!==selectedWorkspace||value.id!==id||!choice
     ||choice.source_collection_id!==value.source_collection_id||choice.source_id!==value.source_id
     ||selected?.workspace_key!==selectedWorkspace||selected.sources?.length!==1
     ||selected.sources[0]?.source_collection_id!==choice.source_collection_id
     ||selected.sources[0]?.source_id!==choice.source_id){
   throw Error('The report source response differs from the selected original workspace or source edition.');
  }
  if(compose)return await host.openScientificReport(selected);
  const target=root.querySelector('[data-chemistry-result]');target.hidden=false;
  target.innerHTML=`<h2>Retained Chemistry report source</h2><p>${esc(value.title)}</p><p class="chemistry-mono">${esc(value.id)} · ${esc(value.edition)}</p>
   ${table([{mode:value.mode,original_report:value.report_id,original_run:value.run_id,figures:value.figure_count,companions:value.companion_count}],['mode','original_report','original_run','figures','companions'])}
   <p>This source retains the saved Chemistry result, declared physical units and scientific figure recipe. Open the scientific report composer to preview, order and publish it with other saved studies. The original analysis and editable project remain available.</p>
   <p class="chemistry-mono">Source edition ${esc(value.source_collection_id)} / ${esc(value.source_id)}</p>
   <div class="chemistry-actions">${button('source-compose','Open scientific report',value.id)}${button('report-open','Open original saved report',value.report_id)}${button('run-open','Open original analysis',value.run_id)}</div>
   ${fileList(value._downloads||[])}`;
 }
 async function openReport(id){
  sourceGeneration++;
  const current=++reportGeneration,selectedWorkspace=liveWorkspace();runGeneration++;
  if(selectedWorkspace!==workspace())throw Error('Reopen Chemistry in the original workspace.');
  const value=await read('report',{report_id:id});
  if(!root||current!==reportGeneration||workspace()!==selectedWorkspace||liveWorkspace()!==selectedWorkspace)return;
  if(value.workspace_key!==selectedWorkspace||value.id!==id)throw Error('The saved report response belongs to another workspace or report.');
  const target=root.querySelector('[data-chemistry-result]');target.hidden=false;
  const s=value.summary||{};
  target.innerHTML=`<h2>Saved Chemistry scientific report</h2><p>${esc(value.title)}</p><p class="chemistry-mono">${esc(value.id)} · ${esc(value.edition)}</p>
   ${table([{mode:s.mode,source_kind:s.project_provenance?.kind,source:s.project_provenance?.reference,fit_records:s.fit_records,held_out_records:s.held_out_records,converged:s.converged,termination:s.termination,parameter_draws:s.draw_count,seed:s.seed}],['mode','source_kind','source','fit_records','held_out_records','converged','termination','parameter_draws','seed'])}
   <p>The report uses the selected completed run and its original inputs. Download the complete scientific-report ZIP to open all relative links offline; the editable project ZIP reopens through the original Chemistry intake.</p>
   <div class="chemistry-actions">${button('source-prepare','Prepare source for scientific reports',value.id)}${button('run-open','Open original analysis',value.run_id)}</div>
   <div data-chemistry-saved-source-list>${sourceList(value.id)}</div>
   ${fileList(value._downloads||[])}
   <iframe data-chemistry-report-frame title="Retained Chemistry scientific report" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" style="width:100%;height:78vh;border:1px solid #aaa;background:white"></iframe>`;
  target.querySelector('[data-chemistry-report-frame]').srcdoc=value.preview_html;
 }
 async function editor(project=null,caseId=null){
  sourceGeneration++;reportGeneration++;runGeneration++;
  const current=++editorGeneration;
  let original=null;if(!caseId)selectedCase='';if(caseId){original=await read('case',{case_id:caseId});if(current!==editorGeneration||!root)return;project=original.project;selectedCase=caseId;}
  if(!root||current!==editorGeneration)return;editorCase=caseId||'';const area=root.querySelector('[data-chemistry-editor]');area.hidden=false;
  area.innerHTML=`<h2>Scenario & analysis</h2><p>Concentrations are mg of the declared conserved basis per litre. Loads are kg of that basis per day; reach volumes are m³ and flow rates are m³/day.</p>
  <label>Project JSON<input data-project-file type="file" accept=".json,application/json"></label>
  <section data-physical></section><details><summary>Complete project JSON and provenance</summary><label>Complete chemical project<textarea data-project rows="16" spellcheck="false">${esc(project?pretty(project):'')}</textarea></label></details>
  <label>Reason for this scenario or edit<input data-reason value="${esc(original?.reason||'')}"></label>
  <div class="chemistry-actions">${button('save','Save immutable scenario edition')}</div>
  <h3>Run request</h3><label>Analysis<select data-mode>${['simulate','attribute','sensitivity','calibrate','monitoring','uncertainty'].map(m=>`<option>${m}</option>`).join('')}</select></label>
  <label>Complete analysis request<textarea data-request rows="12" spellcheck="false">${esc(pretty({mode:'simulate',sample_days:[0,...(project?.phases||[]).map(p=>p.until_day)]}))}</textarea></label>
  <details><summary>Import observation CSV</summary><p>Every row uses id, reach, day and positive sigma_mg_l. Supply species for a single pool, or measurement, basis and components for a weighted measurement. Components is a quoted JSON array of unique {species, weight} objects; all pools must share the exact conserved basis.</p><p>Use qualifier equal or below with mg_l, or interval with lower_mg_l, upper_mg_l, lower_closed and upper_closed. Interval endpoints require explicit true/false; leave mg_l empty. Optional role is fit or holdout.</p><p>Weights define the measurement operator; they do not convert mass bases. A total-N measurement must use nonoverlapping modeled pools so a component already included in TKN is not counted twice.</p><label>Observation source reference<input data-observation-reference></label><input type="file" data-observation-file accept=".csv,text/csv"></details><details><summary>Review measurement definitions and limits</summary><div data-observation-review></div></details>
  <div class="chemistry-actions">${button('execute','Run selected analysis')}</div>
  <p class="chemistry-muted">Calibration saves a child scenario. Holdout observations remain outside fitting. Uncertainty requires explicit distributions, draw count and seed. Monitoring design requires a prior precision matrix and candidate errors.</p>`;
  function physical(){
   let value;try{value=JSON.parse(area.querySelector('[data-project]').value)}catch{return}
   const groups=[['reaches','Reach storage',['volume_m3','temperature_c']],['flows','Water transport',['m3_day']],['loads','External chemical loading',['kg_day']],['reactions','First-order transformation',['rate_day','theta','reference_temperature_c']]];
   area.querySelector('[data-physical]').innerHTML=groups.map(([group,label,fields])=>`<details open><summary>${esc(label)}</summary><div class="chemistry-scroll"><table><thead><tr><th>Original ID / connection</th>${fields.map(f=>`<th>${esc(f)}</th>`).join('')}<th>Source reference</th></tr></thead><tbody>${(value[group]||[]).map((r,i)=>`<tr><td>${esc(r.id)}<br><small>${esc([r.source,r.target,r.reach,r.species].filter(Boolean).join(' → '))}</small></td>${fields.map(f=>`<td><input aria-label="${esc(r.id+' '+f)}" type="number" step="any" data-physical-group="${group}" data-row="${i}" data-field="${f}" value="${esc(r[f]??'')}"></td>`).join('')}<td>${esc(r.provenance?.reference||'')}</td></tr>`).join('')}</tbody></table></div></details>`).join('');
  }
  function observations(){
   const target=area.querySelector('[data-observation-review]');
   try{const q=parse(area.querySelector('[data-request]'),'Analysis request'),rows=q.observations||[];
    target.innerHTML=table(rows.map(observationView),['id','measurement','operator','basis','reach','day','role','qualifier','reference_or_limits','error_scale','source']);
   }catch(error){target.textContent=error.message;}
  }
  observations();area.querySelector('[data-request]').addEventListener('change',observations);
  physical();
  area.querySelector('[data-physical]').addEventListener('change',e=>{
   const target=e.target;if(!target.dataset.physicalGroup)return;
   try{let value=parse(area.querySelector('[data-project]'),'Chemical project');const r=value[target.dataset.physicalGroup][Number(target.dataset.row)];const field=target.dataset.field;
    if(target.value==='')delete r[field];else{const v=Number(target.value);if(!Number.isFinite(v))throw new Error('Enter a finite physical value.');r[field]=v;}
    area.querySelector('[data-project]').value=pretty(value);
   }catch(error){report(error)}
  });
  area.querySelector('[data-project]').addEventListener('change',physical);
  area.querySelector('[data-project-file]').addEventListener('change',async e=>{try{const file=e.target.files[0];if(file){const p=JSON.parse(await file.text());area.querySelector('[data-project]').value=pretty(p);physical();}}catch(e){report(e)}});
  area.querySelector('[data-mode]').addEventListener('change',e=>{try{let request=parse(area.querySelector('[data-request]'),'Analysis request');request.mode=e.target.value;area.querySelector('[data-request]').value=pretty(request);}catch(e){report(e)}});
  area.querySelector('[data-observation-file]').addEventListener('change',async e=>{try{const f=e.target.files[0];if(!f)return;let q=parse(area.querySelector('[data-request]'),'Analysis request');const text=await f.text();if(!root||current!==editorGeneration||!area.isConnected)return;const imported=csvObservations(text,area.querySelector('[data-observation-reference]').value,parse(area.querySelector('[data-project]'),'Chemical project'));q.observations=imported;area.querySelector('[data-request]').value=pretty(q);observations();area.querySelector('[data-observation-review]').parentElement.open=true;}catch(e){report(e)}});
 }
 async function openRun(id,field='final',offset=0){
  sourceGeneration++;reportGeneration++;
  const current=++runGeneration;
  selectedRun=id;page=offset;const run=await read('run',{run_id:id});if(!root||current!==runGeneration)return;
  const target=root.querySelector('[data-chemistry-result]');target.hidden=false;
  target.innerHTML=`<h2>${esc(run.mode)} / ${esc(run.state)}</h2><p class="chemistry-mono">${esc(id)}</p>${run.error?`<p role="alert">${esc(run.error.message)}</p>`:''}<pre>${esc(pretty(run.progress||{}))}</pre><div class="chemistry-actions">${run.state==='complete'?'':button('resume','Resume same analysis',id)}${run.state==='running'?button('cancel','Cancel after current integration step',id):''}${run.calibrated_case_id?button('case-open','Open calibrated scenario',run.calibrated_case_id):''}${run.state==='complete'?button('report-prepare','Prepare scientific report',id):''}</div>${fileList(run._downloads||[])}
  <label>Result collection<select data-result-field>${['final','samples','budgets','reactions','observations','scores','interval_scores','parameters','rows','selected','summaries','sources'].map(f=>`<option ${f===field?'selected':''}>${f}</option>`).join('')}</select></label><div data-result-table></div><div class="chemistry-actions">${button('previous','Previous page')}${button('next','Next page')}</div>`;
  target.querySelector('[data-result-field]').addEventListener('change',e=>openRun(id,e.target.value,0).catch(report));
  if(run.state==='complete'){
   const result=await read('page',{run_id:id,field,offset,limit:100});if(selectedRun!==id||!root||current!==runGeneration)return;
   const columns=[...new Set(result.rows.flatMap(row=>Object.keys(row)))];
   target.querySelector('[data-result-table]').innerHTML=(field==='observations'?'<h3>Measurement operators and original limits</h3>'+table(result.rows.map(observationView),['id','measurement','operator','basis','reach','day','role','qualifier','reference_or_limits','prediction','interval_contains_prediction','error_scale'])+'<h3>Complete retained result fields</h3>':'')+`<p>${result.total?result.offset+1:0}–${result.offset+result.rows.length} of ${result.total} records</p>${table(result.rows,columns)}`;
   target.querySelector('[data-action="chemistry-next"]').disabled=result.next_offset===null;
   target.querySelector('[data-action="chemistry-previous"]').disabled=offset===0;
  }
 }
 async function dispatch(element){
  try{
   const action=element.dataset.action.slice(10),id=element.dataset.id;
   if(action==='refresh')return await reload();
   if(action==='new')return await editor();
   if(action==='open'||action==='case-open'){const key=id||root.querySelector('[data-case]').value;if(!key)throw new Error('Choose a saved scenario.');return await editor(null,key);}
   if(action==='run-open')return await openRun(id);
   if(action==='report-open')return await openReport(id);
   if(action==='source-open'||action==='source-compose')return await openSource(id,action==='source-compose');
   if(action==='source-prepare')return await perform('report.source.prepare',{report_id:id});
   if(action==='report-prepare')return await perform('report.prepare',{run_id:id});
   if(action==='from-source'||action==='receive'){const v=root.querySelector('[data-source]').value;if(!v)throw new Error('Choose an original retained source.');return await perform(action==='from-source'?'case.from-source':'receive',JSON.parse(v));}
   if(action==='save'){
    const area=root.querySelector('[data-chemistry-editor]');const project=parse(area.querySelector('[data-project]'),'Chemical project');
    let refs=[];if(editorCase){const current=await read('case',{case_id:editorCase});refs=current.source_refs;}
    return await perform('case.save',{project,reason:area.querySelector('[data-reason]').value,source_refs:refs,...(editorCase?{parent_id:editorCase}:{})});
   }
   if(action==='execute'){if(!editorCase)throw new Error('Save and open the scenario before calculating.');const request=parse(root.querySelector('[data-request]'),'Analysis request');const saved=await read('case',{case_id:editorCase});const draft=parse(root.querySelector('[data-project]'),'Chemical project');if(JSON.stringify(saved.project)!==JSON.stringify(draft))throw new Error('Save the edited scenario before calculating.');return await perform('run',{case_id:editorCase,request});}
   if(action==='resume'){const run=await read('run',{run_id:id});return await perform('run',{case_id:run.case_id,request:run.selection.request});}
   if(action==='cancel'){await api('/api/chemistry/cancel',{method:'POST',body:{workspace:workspace(),run_id:id}});return await openRun(id);}
   if(action==='export'){if(!selectedCase)throw new Error('Choose a saved scenario.');return await perform('export',{case_id:selectedCase,run_ids:catalog.runs.filter(r=>r.case_id===selectedCase&&r.state==='complete').map(r=>r.id)});}
   if(action==='previous'||action==='next'){const field=root.querySelector('[data-result-field]').value;return await openRun(selectedRun,field,Math.max(0,page+(action==='next'?100:-100)));}
  }catch(error){report(error)}
 }
 async function update(){
  if(!root)return;
  const current=++generation,result=await read('catalog');
  if(current!==generation||!root)return;
  catalog=result;
  const selection=root.querySelector('[data-case]');
  if(selection){
   selection.innerHTML='<option value="">Choose a scenario</option>'+catalog.cases.map(c=>`<option value="${esc(c.id)}">${esc(c.title)} — ${esc(c.id.slice(0,10))}</option>`).join('');
   selection.value=selectedCase;
  }
  const sources=root.querySelector('[data-source]');
  if(sources){
   const chosen=sources.value;
   sources.innerHTML='<option value="">Choose an original retained source</option>'+(catalog.sources||[]).flatMap(c=>(c.entries||[]).map(e=>`<option value="${esc(JSON.stringify({source_collection_id:c.id,source_id:e.id}))}">${esc(c.title)} / ${esc(e.title||e.id)}</option>`)).join('');
   if([...sources.options].some(option=>option.value===chosen))sources.value=chosen;
  }
  const reports=root.querySelector('[data-chemistry-reports]');
  if(reports)reports.innerHTML=reportList();
  const reportSources=root.querySelector('[data-chemistry-report-sources]');
  if(reportSources)reportSources.innerHTML=sourceList();
  const runs=root.querySelector('[data-chemistry-runs]');
  if(runs)runs.innerHTML=catalog.runs.map(r=>`<div class="chemistry-run">${button('run-open',`${r.mode} · ${r.state} · ${r.id.slice(0,10)}`,r.id)}<span>${esc(r.title)}</span></div>`).join('')||'<p>No analysis yet.</p>';
 }
 return {update,mount(element){if(root===element)return;root=element;root.innerHTML='<p role="status">Opening retained chemical scenarios…</p>';return reload().catch(report)},detach(){generation++;editorGeneration++;runGeneration++;reportGeneration++;sourceGeneration++;root=null},dispatch,
 taskActions(task){
  const r=task.result||{},key=workspace();if(task.state!=='complete'||!task.action?.startsWith('chemistry.')||(task.workspace&&task.workspace!==key))return '';
  const isSource=['chemistry.report.source.prepare','chemistry.report.source.get'].includes(task.action);
  const control=isSource&&r.id&&r.source_collection_id&&r.source_id?button('source-compose','Open scientific report',r.id)+button('source-open','Inspect retained source',r.id):r.schema==='upstate.chemistry-run/v1'?button('run-open','Open chemical results',r.id):r.schema==='upstate.chemistry-scientific-report/v1'?button('report-open','Open scientific report',r.id):'';
  return control.replaceAll('data-id=',`data-workspace="${esc(key)}" data-id=`);
 }};
}
