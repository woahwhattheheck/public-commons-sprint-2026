/** Compare explicit saved Monitoring editions through the existing native queue. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>JSON.parse(JSON.stringify(value));
const id=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const rows=value=>Array.isArray(value)?value:[];
const ordered=value=>Array.isArray(value)?'['+value.map(ordered).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+ordered(value[k])).join(',')+'}':JSON.stringify(value);
const labels={'temporal-comparison.zip':'Complete comparison with both original packages (ZIP)','review.html':'Report HTML (keep with extracted companion files)','comparison.json':'Complete original comparison (JSON)','selection.json':'Saved comparison selection (JSON)','series-comparison.csv':'All series (CSV)','source-record-changes.csv':'Every original source row (CSV)','settings-changes.csv':'Settings changes (CSV)','source-file-changes.csv':'Original file changes (CSV)','monthly-support-changes.csv':'Calendar support (CSV)','before/temporal-analysis.zip':'Exact before analysis ZIP','after/temporal-analysis.zip':'Exact after analysis ZIP'};
function interval(cohort){
 if(!cohort)return 'No series in this edition';
 const e=cohort.estimate||{},show=v=>v===null||v===undefined?'unavailable':String(v);
 return (e.slope_lower_unbounded?'−∞':show(e.slope_lower))+' to '+(e.slope_upper_unbounded?'+∞':show(e.slope_upper))+' '+(cohort.unit||'unspecified unit')+'/year';
}
export function mountTemporalComparison(element,host,{request,catalog:initialCatalog=null,state:initialState=null}={}){
 const workspace=host.getWorkspace(),controller=new AbortController(),storage='temporal-comparison:'+workspace;
 let dead=false,busy=false,generation=0,catalog=initialCatalog,draft={title:'Compare saved Monitoring editions',before_id:'',after_id:''},
     result=null,selectedId='',pending=null,operations={},message='',error='',tasks=[],fingerprint='';
 const active=()=>!dead&&host.getWorkspace()===workspace;
 function persist(required=false){try{localStorage.setItem(storage,JSON.stringify({draft,selectedId,pending,operations}));if(required){const saved=JSON.parse(localStorage.getItem(storage));if(ordered(saved)!==ordered({draft,selectedId,pending,operations}))throw Error('Saved request differs.');}}catch(e){if(required)throw Error('Save the original comparison request before dispatch. Browser storage is unavailable: '+e.message);}}
 try{const saved=JSON.parse(localStorage.getItem(storage)||'{}');if(saved.draft&&typeof saved.draft.title==='string')draft={...draft,...saved.draft};if(id(saved.selectedId))selectedId=saved.selectedId;pending=saved.pending||null;operations=saved.operations||{};if(pending&&(!['temporal.comparison.build','temporal.comparison.receive'].includes(pending.action)||typeof pending.operation_id!=='string'||!pending.payload||typeof pending.payload!=='object'||(pending.action==='temporal.comparison.build'?(!id(pending.payload.before_id)||!id(pending.payload.after_id)||typeof pending.payload.title!=='string'||Object.keys(pending.payload).some(k=>!['before_id','after_id','title'].includes(k))):(!id(pending.payload.upload_id)||Object.keys(pending.payload).some(k=>k!=='upload_id')))))pending=null;}catch{}
 function capture(){const form=element.querySelector('[data-tcmp-form]');if(form){draft={title:form.elements.title.value,before_id:form.elements.before_id.value,after_id:form.elements.after_id.value};persist();}}
 function optionList(selected,entries){return '<option value="">Choose a saved edition</option>'+entries.map(e=>'<option value="'+esc(e.id)+'" '+(selected===e.id?'selected':'')+'>'+esc(e.title)+' · '+esc(e.id.slice(0,12))+'</option>').join('')+(selected&&!entries.some(e=>e.id===selected)?'<option value="'+esc(selected)+'" selected>Retained selection unavailable in this workspace: '+esc(selected.slice(0,12))+'</option>':'');}
 function savedList(){const select=element.querySelector('[data-tcmp-saved]');if(select)select.innerHTML=optionList(selectedId,rows(catalog?.comparisons));}
 function draw(){
  if(!active())return;
  element.innerHTML='<section class="ta-card"><h3>Compare two saved Monitoring editions</h3><p>Review the original source, settings, monthly coverage and retained estimates before interpreting a difference. Both original reports and complete packages travel with the comparison.</p><form data-tcmp-form><label>Comparison title<input name="title" maxlength="200" required value="'+esc(draft.title)+'"></label><div class="ta-grid"><label>Before saved edition<select name="before_id">'+optionList(draft.before_id,rows(catalog?.editions))+'</select></label><label>After saved edition<select name="after_id">'+optionList(draft.after_id,rows(catalog?.editions))+'</select></label></div><div class="ta-actions"><button type="submit">Save complete comparison</button><button type="button" data-tcmp-action="download-choice">Save working selection</button><button type="button" data-tcmp-action="import-choice">Open working selection</button></div></form><div class="ta-actions"><button data-tcmp-action="receive">Receive saved comparison ZIP</button><button data-tcmp-action="retry" '+(pending?'':'hidden')+'>Resume retained request</button><input data-tcmp-package type="file" accept=".zip,application/zip" hidden><input data-tcmp-choice type="file" accept=".json,application/json" hidden></div><p data-tcmp-notice role="status" class="ta-help"></p><label>Saved comparison<select data-tcmp-saved></select></label><div data-tcmp-result></div><div data-tcmp-tasks></div></section>';
  savedList();notice();drawResult();drawTasks();disable();
 }
 function notice(){const target=element.querySelector('[data-tcmp-notice]');if(target)target.textContent=error||message;}
 function disable(){for(const item of element.querySelectorAll('button,input,select'))item.disabled=busy;}
 function drawTasks(){const target=element.querySelector('[data-tcmp-tasks]');if(!target)return;target.innerHTML=tasks.slice(-8).reverse().map(t=>'<p><button data-tcmp-action="task" data-id="'+esc(t.id)+'">'+esc(t.state)+' · '+esc(t.payload?.title||'Saved comparison')+'</button>'+(t.state==='complete'&&id(t.result?.id)?' <button data-tcmp-action="open" data-id="'+esc(t.result.id)+'">Open complete comparison</button>':'')+(t.error?' · '+esc(t.error.message||t.error):'')+'</p>').join('');}
 function drawResult(){const target=element.querySelector('[data-tcmp-result]');if(!target)return;if(!result){target.innerHTML='<p class="ta-help">Select a saved comparison, or create one from two original saved editions.</p>';return;}
  const view=result.overview;
  const downloads=rows(result._downloads).slice().sort((a,b)=>Number((b.label||b.filename)==='temporal-comparison.zip')-Number((a.label||a.filename)==='temporal-comparison.zip'));
  target.innerHTML='<h4>'+esc(result.title)+'</h4><p>'+esc(view.rule)+'</p><p>'+esc(view.summary.before_records)+' before rows · '+esc(view.summary.after_records)+' after rows · '+esc(view.summary.series)+' series · '+esc(view.summary.point_deltas)+' eligible point differences.</p><div class="ta-actions">'+downloads.map(f=>'<a class="ta-download" href="'+esc(f.url)+'" download="'+esc(f.label||f.filename||'download')+'">'+esc(labels[f.label||f.filename]||f.label||f.filename)+'</a>').join('')+'</div><p class="ta-help">Open the complete ZIP and keep its files together. Each original uncertainty envelope remains separate; there is no inferred interval for a difference or causal claim.</p><div class="ta-scroll"><table><thead><tr><th>Original series</th><th>Before</th><th>After</th><th>Difference or reason</th></tr></thead><tbody>'+rows(view.series).map(s=>'<tr><td>'+esc(s.station)+'<br>'+esc(s.parameter)+'<br><small>'+esc(s.cohort_id)+'</small></td><td>'+esc(interval(s.before))+'</td><td>'+esc(interval(s.after))+'</td><td>'+(s.point_delta_eligible?esc(s.after_minus_before_point_slope)+' '+esc(s.unit)+'/year':rows(s.comparison_reasons).map(esc).join('<br>'))+'</td></tr>').join('')+'</tbody></table></div><details><summary>Original pair and retained request</summary><pre>'+esc(JSON.stringify({comparison_id:view.id,selection:view.selection,input_archives:view.input_archives,summary:view.summary},null,2))+'</pre></details>';
 }
 async function open(key){
  if(busy||!id(key)||!active())return;capture();selectedId=key;result=null;drawResult();persist();const stamp=++generation;error='';message='Opening the original saved comparison…';notice();
  try{const value=await request('comparison',{id:key});if(!active()||stamp!==generation||selectedId!==key)return;
   if(value?.id!==key||!id(value.comparison_id)||value.overview?.id!==value.comparison_id||ordered(value.overview.selection)!==ordered(value.selection))throw Error('Returned comparison differs from the selected original edition.');
   result=value;message='Original comparison reopened.';drawResult();savedList();notice();
  }catch(e){if(active()&&stamp===generation){error=e.message;notice();}}
 }
 async function refresh(){const value=await request('catalog',{});if(!active())return;catalog=value;savedList();}
 async function dispatch(action,payload,operation){
  if(!active())return;
  pending={action,payload:copy(payload),operation_id:operation};persist(true);
  const task=await host.api('/api/actions',{method:'POST',body:{workspace,action,payload,operation_id:operation}});
  if(!active())return;
  if(!task?.id)throw Error('The native queue did not return its original task.');
  pending=null;persist();host.showTask(task.id);
  await host.refresh({force:true});if(!active())return;
  await refresh();if(!active())return;
  if(task.state==='complete'&&id(task.result?.id)){busy=false;await open(task.result.id);}else{message='Comparison request is '+task.state+'. Its native task retains the original inputs.';notice();}
 }
 async function run(work){
  if(busy||!active())return;capture();busy=true;error='';generation++;disable();notice();
  try{await work();}catch(e){if(active()){error=e.message;notice();}}
  finally{if(active()){busy=false;disable();}}
 }
 async function submit(){return run(async()=>{
  if(!draft.title.trim()||!id(draft.before_id)||!id(draft.after_id)||draft.before_id===draft.after_id)throw Error('Select two distinct saved editions and give the comparison a title.');
  if([draft.before_id,draft.after_id].some(key=>!rows(catalog?.editions).some(e=>e.id===key)))throw Error('Both selected original editions must be present in this workspace.');
  const payload={title:draft.title,before_id:draft.before_id,after_id:draft.after_id},key=ordered(payload);
  if(!operations[key])operations[key]='temporal-comparison-'+crypto.randomUUID();
  await dispatch('temporal.comparison.build',payload,operations[key]);
 });}
 async function receive(file){if(!file)return;return run(async()=>{
  message='Retaining the complete original comparison package…';notice();
  const upload=await host.api('/api/upload',{method:'POST',raw:file,filename:file.name,mediaType:file.type||'application/zip'});
  if(!active())return;
  if(!id(upload?.id))throw Error('Upload did not return a retained original package ID.');
  const payload={upload_id:upload.id},key='receive:'+upload.id;
  if(!operations[key])operations[key]='temporal-comparison-receive-'+crypto.randomUUID();
  await dispatch('temporal.comparison.receive',payload,operations[key]);
 });}
 async function restoreChoice(file){
  if(!file||busy||!active())return;capture();const stamp=++generation;
  try{const value=JSON.parse(await file.text());if(!active()||stamp!==generation)return;
   if(value?.schema!=='upstate.temporal-comparison-draft/v1'||value.workspace!==workspace||typeof value.selection?.title!=='string'||!id(value.selection.before_id)||!id(value.selection.after_id))throw Error('Select the complete working choice for this original workspace.');
   draft=copy(value.selection);persist(true);draw();message='Original saved-edition choices restored. Saving a comparison remains explicit.';notice();
  }catch(e){if(active()&&stamp===generation){error=e.message;notice();}}
 }
 function downloadChoice(){capture();if(!id(draft.before_id)||!id(draft.after_id)){error='Choose both original saved editions before saving the working choice.';notice();return;}const value={schema:'upstate.temporal-comparison-draft/v1',workspace,selection:copy(draft)},url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='monitoring-comparison-selection.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 element.addEventListener('input',e=>{if(e.target.closest('[data-tcmp-form]')){capture();generation++;}},{signal:controller.signal});
 element.addEventListener('change',e=>{if(e.target.matches('[data-tcmp-saved]'))open(e.target.value);if(e.target.matches('[data-tcmp-package]')){const f=e.target.files[0];e.target.value='';receive(f);}if(e.target.matches('[data-tcmp-choice]')){const f=e.target.files[0];e.target.value='';restoreChoice(f);}},{signal:controller.signal});
 element.addEventListener('submit',e=>{if(e.target.matches('[data-tcmp-form]')){e.preventDefault();submit();}},{signal:controller.signal});
 element.addEventListener('click',e=>{const button=e.target.closest('[data-tcmp-action]');if(!button||busy)return;switch(button.dataset.tcmpAction){case 'receive':element.querySelector('[data-tcmp-package]').click();break;case 'import-choice':element.querySelector('[data-tcmp-choice]').click();break;case 'download-choice':downloadChoice();break;case 'task':host.showTask(button.dataset.id);break;case 'open':open(button.dataset.id);break;case 'retry':if(pending)run(()=>dispatch(pending.action,pending.payload,pending.operation_id));break;}},{signal:controller.signal});
 function update(nextCatalog,nextState=host.getState?.()){
  if(!active())return;capture();if(nextCatalog)catalog=nextCatalog;
  tasks=rows(nextState?.tasks).filter(t=>t.workspace===workspace&&['temporal.comparison.build','temporal.comparison.receive'].includes(t.action));
  const next=tasks.map(t=>t.id+':'+t.state).join('|'),changed=fingerprint&&next!==fingerprint;fingerprint=next;
  if(!busy){const form=element.querySelector('[data-tcmp-form]');for(const field of ['before_id','after_id'])if(form)form.elements[field].innerHTML=optionList(draft[field],rows(catalog?.editions));}
  savedList();drawTasks();disable();if(changed&&tasks.some(t=>t.state==='complete'))refresh().catch(e=>{if(active()){error=e.message;notice();}});
 }
 function destroy(){capture();dead=true;generation++;controller.abort();}
 draw();update(initialCatalog,initialState);if(selectedId)open(selectedId);
 return {update,destroy};
}
