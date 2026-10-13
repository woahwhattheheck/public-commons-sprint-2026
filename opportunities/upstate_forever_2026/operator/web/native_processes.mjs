/** Completed native stages → original process reports on the maintained operator. */
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy = value => JSON.parse(JSON.stringify(value));
const short = value => String(value ?? '').slice(0,12);
const fmt = value => value == null ? '—' : Number(value).toLocaleString(undefined,{maximumFractionDigits:5});
const size = value => {let n=Number(value||0),i=0;const units=['B','KiB','MiB','GiB','TiB'];while(n>=1024&&i<4){n/=1024;i++;}return fmt(n)+' '+units[i];};
const labels = {ndr:'Nutrient processes (NDR)',sdr:'Sediment processes (SDR)'};
const basis = {completed_stage_runtime:'completed stage runtime',observed_run_fallback:'observed run runtime; stage version unavailable',requested_legacy:'requested legacy version; execution version unavailable'};
const version = info => 'InVEST '+(info?.comparison_version||'unavailable')+' · '+(basis[info?.basis]||info?.basis||'source unavailable')+(info?.requested_version&&info.requested_version!==info.comparison_version?' · requested '+info.requested_version:'');
const button = (action,label,attrs='',disabled=false) => '<button type="button" data-np-action="'+esc(action)+'" '+attrs+(disabled?' disabled':'')+'>'+esc(label)+'</button>';
const options = (rows,selected,placeholder) => (placeholder!==undefined?'<option value="">'+esc(placeholder)+'</option>':'')+rows.map(([id,title])=>'<option value="'+esc(id)+'"'+(id===selected?' selected':'')+'>'+esc(title)+'</option>').join('');
const table = (heads,rows) => '<div class="np-table"><table><thead><tr>'+heads.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const metadata = values => '<dl class="np-defs">'+Object.entries(values).map(([key,value])=>'<dt>'+esc(key)+'</dt><dd>'+esc(value??'—')+'</dd>').join('')+'</dl>';
const defaults = () => ({title:'',baseline:'',alternatives:[],models:['ndr','sdr'],resultId:null,screen:'choose',table:'quantities',filters:{model:'',run_id:'',watershed:''},offset:0,deliveryId:'',pending:null});
const fileURL = value => {if(typeof value!=='string'||!/^\/api\/file\//.test(value)||/[\u0000-\u001f]/.test(value))throw Error('Use an original operator download.');return value;};

export function attachNativeProcesses({getState,getWorkspace,api,endpoint,toast,refreshState,
    openItem,openDelivery,navigate,closeDetail,showTask,openDesk}) {
  let root=null,workspace=null,epoch=0,intent=0,request=0,busy=false,error='',draft=defaults(),pendingOpen=null;
  let catalogue={native_runs:[],reports:[]},proposed=null,product=null,rows=null,pollSignature='';
  const memories=new Map();
  const current=()=>getWorkspace?.()??getState()?.workspace_key??null;
  const storage=key=>'upstate-native-processes:'+key;
  function remember(){if(!workspace)return;const value=copy(draft);memories.set(workspace,value);try{sessionStorage.setItem(storage(workspace),JSON.stringify(value));}catch{}}
  function restore(key){let value=memories.get(key);if(!value){try{value=JSON.parse(sessionStorage.getItem(storage(key))||'null');}catch{}}draft={...defaults(),...(value||{})};draft.filters={...defaults().filters,...(draft.filters||{})};}
  function mounted(mark){return root&&root===mark.root&&epoch===mark.epoch&&workspace===mark.workspace&&current()===mark.workspace;}
  function valid(mark){return mounted(mark)&&intent===mark.intent;}
  function mark(){return {root,epoch,intent,workspace};}
  function invalidateNavigation(){intent++;request++;if(pendingOpen){pendingOpen.resolve(false);pendingOpen=null;}}
  function url(path,values={}){if(current()!==workspace)throw Error('Reopen this desk in the intended Workspace.');return endpoint('/api/native-processes/'+path,{...values,workspace});}
  function name(kind,id){const item=getState()?.data?.[kind]?.find(x=>x.id===id);return item?.title||item?.metadata?.title||item?.selection?.title||short(id);}
  function title(run){return name('scenarios',run.selection.scenario_id)+' · '+name('profiles',run.selection.profile_id)+' · '+short(run.run_id);}
  function run(id){return catalogue.native_runs.find(x=>x.run_id===id);}
  function selected(){return [draft.baseline,...draft.alternatives].filter(Boolean);}
  function commonModels(){const chosen=selected().map(run).filter(Boolean);return chosen.length?['ndr','sdr'].filter(model=>chosen.every(row=>row.completed_models.includes(model)&&row.watershed_outputs[model])):[];}
  function normalizeRuns(){const baseline=run(draft.baseline);draft.alternatives=draft.alternatives.filter((id,index,list)=>id!==draft.baseline&&list.indexOf(id)===index&&run(id)?.selection.grid_id===baseline?.selection.grid_id);draft.models=draft.models.filter(x=>commonModels().includes(x));}
  function selection(){if(!draft.title.trim())throw Error('Give this original process report a title.');if(!draft.baseline)throw Error('Choose the first, baseline run.');if(!draft.models.length)throw Error('Choose a completed model shared by every selected run.');return {schema:'upstate.native-process-selection/v1',title:draft.title.trim(),run_ids:selected(),models:[...draft.models]};}
  function changed(){proposed=null;error='';remember();}
  function pendingMarkup(){const value=draft.pending;if(!value)return '';const task=getState()?.tasks?.find(x=>x.id===value.id);return '<aside class="np-notice"><strong>'+esc(task?.state||'Retained operation')+'</strong> '+esc(value.action)+' '+(value.id?button('task','Open original operation','data-id="'+esc(value.id)+'"'):'')+(task?.error?'<p>'+esc(task.error.message)+'</p>':'')+(task?._downloads?.length?'<p>'+task._downloads.map(file=>'<a href="'+esc(fileURL(file.url))+'?download=1" download>'+esc(file.label||file.filename)+'</a>').join(' · ')+'</p>':'')+'</aside>';}
  function stageRows(list){return list.flatMap(row=>row.completed_models.map(model=>'<tr><td>'+esc(title(row))+'<small class="np-id">'+esc(row.run_id)+'</small></td><td>'+esc(row.state||'Retained')+'</td><td>'+esc(labels[model])+'</td><td>'+esc(version(row.versions?.[model]))+'</td><td>'+esc(row.watershed_outputs?.[model]?'Original watershed output retained':'Watershed output absent')+'</td><td>'+button('run','Open run','data-id="'+esc(row.run_id)+'"')+'</td></tr>'));}
  function chooseMarkup(){
    const candidates=catalogue.native_runs.filter(row=>row.completed_models.some(model=>row.watershed_outputs[model]));
    const baseline=run(draft.baseline),common=commonModels();
    const alternatives=candidates.filter(row=>row.run_id!==draft.baseline&&row.selection.grid_id===baseline?.selection.grid_id);
    return '<section class="np-section"><h2>Select original completed stages</h2><p>The first run is the baseline. A baseline alone is a complete process report. Parent runs may remain unfinished while their selected NDR or SDR stages are complete.</p>'+
      '<div class="np-form"><label>Report title<input data-np-field="title" value="'+esc(draft.title)+'" required></label>'+
      '<label>Baseline native run<select data-np-field="baseline">'+options(candidates.map(row=>[row.run_id,title(row)+' · parent '+row.state]),draft.baseline,'Choose an original run')+'</select></label></div>'+
      '<fieldset><legend>Alternatives on the same original grid</legend>'+(baseline?(alternatives.length?alternatives.map(row=>'<label class="np-check"><input type="checkbox" data-np-alternative="'+esc(row.run_id)+'"'+(draft.alternatives.includes(row.run_id)?' checked':'')+'>'+esc(title(row))+' <small>Parent '+esc(row.state)+'</small></label>').join(''):'<p>No other retained native run currently shares this grid.</p>'):'<p>Choose the baseline to list its compatible grid.</p>')+'</fieldset>'+
      (draft.alternatives.length?'<h3>Alternative order</h3><ol class="np-order">'+draft.alternatives.map((id,index)=>'<li><span>'+esc(title(run(id)))+'</span>'+button('up','Move up','data-id="'+esc(id)+'"',index===0)+button('down','Move down','data-id="'+esc(id)+'"',index===draft.alternatives.length-1)+'</li>').join('')+'</ol>':'')+
      '<fieldset><legend>Completed process models</legend>'+['ndr','sdr'].map(model=>'<label class="np-check"><input type="checkbox" data-np-model="'+model+'"'+(draft.models.includes(model)?' checked':'')+(!common.includes(model)?' disabled':'')+'>'+esc(labels[model])+(common.includes(model)?'':' <small>Not retained for every selected run</small>')+'</label>').join('')+'</fieldset>'+
      (selected().length?table(['Original run','Parent state','Completed model','Producing version','Registry',''],stageRows(selected().map(run).filter(Boolean))):'')+
      '<div class="np-actions">'+button('preview','Preview original stage selection','',busy||!draft.baseline)+button('build','Build process report','',busy||!proposed)+'</div></section>'+
      (proposed?previewMarkup():'')+
      '<section class="np-section"><h2>Saved process reports</h2>'+(catalogue.reports.length?table(['Report','Status','Original selection',''],catalogue.reports.map(row=>'<tr><td>'+esc(row.title||row.id)+'<small class="np-id">'+esc(row.id)+'</small></td><td>'+esc(row.state||'Retained')+'</td><td>'+esc((row.selection?.models||[]).map(x=>x.toUpperCase()).join(' + '))+' · '+(row.selection?.run_ids?.length||0)+' run(s)</td><td>'+button('saved','Open saved report','data-id="'+esc(row.id)+'"')+'</td></tr>')):'<p>Reports created here or with the maintained CLI appear in this same Workspace.</p>')+'</section>';
  }
  function previewMarkup(){return '<section class="np-section"><h2>Original selection preview</h2>'+metadata({'Report identity':proposed.id,'Original grid':proposed.grid_id,'Selected native stage files':proposed.retained_original_files+' files · '+size(proposed.retained_original_bytes),'Comparison support':proposed.support})+'<p class="np-note">This count covers selected native stage files, companions and arguments. The retained report also includes grid, profile, scenario, parameter-table and implementation sources.</p>'+
    '<ul>'+Object.entries(proposed.versions.versions).map(([model,value])=>'<li>'+esc(labels[model])+': InVEST '+esc(value)+'</li>').join('')+'</ul>'+
    '<details><summary>Physical quantities and support interpretation</summary><ul>'+proposed.methods.map(value=>'<li>'+esc(value)+'</li>').join('')+'</ul></details></section>';}
  function downloadsMarkup(){
    if(!product?._downloads?.length)return '';
    return '<section class="np-section"><h2>Original report and data</h2><div class="np-downloads">'+product._downloads.map(file=>'<article><strong>'+esc(file.member)+'</strong><small>'+size(file.bytes)+' · SHA256 '+esc(file.sha256)+'</small><div>'+
      (file.member==='report.pdf'?'<a target="_blank" rel="noopener" href="'+esc(fileURL(file.url))+'">Open PDF</a> · ':'')+
      '<a href="'+esc(fileURL(file.url))+'?download=1" download>Download</a></div></article>').join('')+'</div>'+
      '<p class="np-note">The complete ZIP preserves the HTML report and every original relative source link. PDF and CSV files can be used independently.</p>'+button('package','Export complete report and original sources','',busy||product.state!=='complete')+'</section>';
  }
  function executionMarkup(){return table(['Original run','Model','Producing execution','Completed','Registry files',''],product.native_runs.flatMap((row,index)=>Object.entries(row.stages).map(([model,stage])=>'<tr><td>'+(index===0?'Baseline':'Alternative '+index)+'<small class="np-id">'+esc(row.id)+'</small><small>'+esc(name('scenarios',row.selection.scenario_id))+' · '+esc(name('profiles',row.selection.profile_id))+'</small></td><td>'+esc(labels[model])+'</td><td>'+esc(version(stage.version))+(stage.reused_from?'<small>Retained reuse: '+esc(JSON.stringify(stage.reused_from))+'</small>':'')+'</td><td>'+esc(stage.completed_at)+'</td><td>'+fmt(stage.registry_outputs)+' + '+fmt(stage.registry_companions)+' companions</td><td>'+button('run','Open run','data-id="'+esc(row.id)+'"')+'</td></tr>')));}
  function reportMarkup(){
    if(!product)return '<section class="np-section"><p>Opening original report…</p></section>';
    const deliveries=getState()?.data?.deliveries||[];
    return '<section class="np-section"><div class="np-actions">'+button('choose','New selection')+button('reuse','Reuse original selection')+button('refresh-report','Refresh saved report','',busy)+'</div><h2>'+esc(product.title)+'</h2>'+
      metadata({'Report identity':product.id,'State':product.state,'Phase':product.phase,'Original grid':product.grid_id,'Retained report files':product.retained_files+' files · '+size(product.retained_bytes),'Completed stage analyses':(product.completed_stages||[]).length})+
      (product.error?'<p role="alert" class="np-error">'+esc(product.error.message)+'</p>':'')+executionMarkup()+
      (product.state!=='complete'||!product.rendered?'<p>'+button('resume-report','Preview and continue original report','',busy)+'</p>':'')+'</section>'+
      (product.source_choice?'<section class="np-section"><h2>Continue with this scientific source</h2>'+metadata({'Source collection':product.source_choice.source_collection_id,'Source':product.source_choice.source_id})+
      '<div class="np-actions">'+button('source','Open original source collection')+'</div><p>This recipe is available in the existing ordered scientific-report picker. To revise an existing delivery, choose its original saved selection below; this report is appended once and the earlier report order is preserved.</p>'+
      '<label>Saved delivery<select data-np-field="deliveryId">'+options(deliveries.map(row=>[row.id,row.selection?.title||row.title||short(row.id)]),draft.deliveryId,'Choose a retained delivery')+'</select></label>'+button('delivery','Open delivery with this report','',busy||!draft.deliveryId)+'</section>':'')+
      downloadsMarkup()+(product.tables?.length?tableMarkup():'');
  }
  function tableMarkup(){
    return '<section class="np-section"><h2>Inspect original quantities and support</h2><p>Changes are alternative minus baseline. Native watershed masses and independently reconstructed same-cell quantities remain separate.</p>'+
      '<div class="np-filters"><label>Table<select data-np-field="table">'+options(product.tables.map(id=>[id,{'quantities':'Watershed quantities','support':'Original finite-cell support','changes':'Native watershed changes','paired-support':'Same-cell changes and coverage'}[id]]),draft.table)+'</select></label>'+
      (rows?['model','run_id','watershed'].filter(field=>rows.columns.includes(field)).map(field=>'<label>'+esc({'model':'Model','run_id':'Original run','watershed':'Watershed geometry'}[field])+'<select data-np-filter="'+field+'">'+options(rows.options[field].map(x=>[x,field==='model'?labels[x]||x:field==='run_id'?short(x):x]),draft.filters[field],'All original rows')+'</select></label>').join(''):'')+'</div>'+
      (rows?'<p>'+fmt(rows.selected_rows)+' selected of '+fmt(rows.total_rows)+' original rows; showing '+(rows.rows.length?draft.offset+1:0)+'–'+(draft.offset+rows.rows.length)+'. Original CSV fields and units are shown unchanged.</p>'+
      table(rows.columns,rows.rows.map(row=>'<tr>'+rows.columns.map(field=>'<td>'+esc(row[field]??'')+'</td>').join('')+'</tr>'))+
      '<div class="np-actions">'+button('previous','Previous 100 rows','',busy||draft.offset===0)+button('next','Next 100 rows','',busy||rows.next_offset==null)+'</div>':'<p>Opening the retained table…</p>')+'</section>';
  }
  function render(){
    if(!root||current()!==workspace)return;
    root.innerHTML='<div class="native-process-desk"><header><h1>Native process reports</h1><p>Original completed nutrient and sediment stages, watershed quantities and source-bound scientific reports.</p><div class="np-actions">'+button('refresh','Refresh original runs and reports','',busy)+'</div></header>'+
      (error?'<p class="np-error" role="alert">'+esc(error)+'</p>':'')+pendingMarkup()+(draft.screen==='report'?reportMarkup():chooseMarkup())+'</div>';
  }
  async function guarded(work){
    const m=mark();if(!valid(m))return;
    if(busy)return;busy=true;error='';render();
    try{await work(m);}catch(e){if(valid(m)){error=e.message||String(e);toast(error);}}
    finally{if(mounted(m)){busy=false;remember();render();void drainOpen();}}
  }
  async function loadCatalogue(m){
    const next=await api(url('catalog'));
    if(!valid(m))return false;
    catalogue=next;return true;
  }
  async function loadTable(m){
    if(!product?.tables?.length){rows=null;return;}
    if(!product.tables.includes(draft.table))draft.table=product.tables[0];
    const stamp=++request,body=await api(url('table',{id:product.id,table:draft.table,...draft.filters,offset:draft.offset,limit:100}));
    if(!valid(m)||stamp!==request)return;rows=body;
  }
  async function loadReport(id,m){
    const stamp=++request,body=await api(url('report',{id}));
    if(!valid(m)||stamp!==request)return false;
    product=body;draft.resultId=id;draft.screen='report';rows=null;
    await loadTable(m);return valid(m);
  }
  async function preview(m){
    const selected=selection(),fingerprint=JSON.stringify(selected),body=await api(url('preview'),{method:'POST',body:{selection:selected}});
    if(valid(m)&&JSON.stringify(selection())===fingerprint){proposed=body;return body;}return null;
  }
  async function enqueue(action,payload,m){
    if(!valid(m))return;
    const bodyKey=JSON.stringify({action,payload});
    const existing=draft.pending;
    const operation_id=existing?.bodyKey===bodyKey?existing.operation_id:crypto.randomUUID();
    draft.pending={id:existing?.bodyKey===bodyKey?existing.id:null,operation_id,bodyKey,action,autoOpen:true};remember();
    const response=await api('/api/actions',{method:'POST',body:{workspace:m.workspace,action,payload,operation_id}});
    // Preserve the request in its original Workspace even if the desk has detached.
    const saved=memories.get(m.workspace)||copy(draft);
    if(saved.pending?.operation_id===operation_id){saved.pending={...saved.pending,id:response.id};memories.set(m.workspace,saved);try{sessionStorage.setItem(storage(m.workspace),JSON.stringify(saved));}catch{}}
    if(root&&current()===m.workspace&&workspace===m.workspace&&draft.pending?.operation_id===operation_id){draft.pending={...draft.pending,id:response.id};remember();render();}
    if(!valid(m))return;
    toast('Original process operation retained.');await refreshState({force:true});
  }
  async function build(m){
    const chosen=selection();
    if(!proposed||JSON.stringify(chosen)!==JSON.stringify(proposed.selection))throw Error('Preview this exact original selection before building.');
    await enqueue('native.process.build',{selection:chosen,expected_preview_id:proposed.id},m);
  }
  async function waitForSource(choice,m){
    const deadline=Date.now()+15000;
    while(valid(m)){
      const found=getState()?.data?.sources?.some(row=>row.id===choice.source_collection_id&&row.entries?.some(entry=>entry.id===choice.source_id));
      if(found)return true;
      if(Date.now()>deadline)throw Error('The original source is retained. Refresh the Workspace before opening the delivery form.');
      await refreshState({force:true});
      if(!valid(m))return false;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    return false;
  }
  function useSelection(value,invalidate=true){
    if(invalidate)invalidateNavigation();
    if(draft.pending)draft.pending.autoOpen=false;
    draft.title=value.title;draft.baseline=value.run_ids[0];draft.alternatives=value.run_ids.slice(1);draft.models=[...value.models];draft.screen='choose';proposed=null;error='';remember();render();
  }
  async function action(buttonNode){
    const action=buttonNode.dataset.npAction,id=buttonNode.dataset.id;
    if(['run','source','task'].includes(action)){
      if(current()!==workspace)return;
      if(action==='run')return openItem('runs',id);
      if(action==='source')return openItem('sources',product.source_choice.source_collection_id);
      return showTask(id);
    }
    if(action==='choose'){invalidateNavigation();if(draft.pending)draft.pending.autoOpen=false;draft.screen='choose';error='';remember();render();return;}
    if(action==='reuse'){useSelection(product.selection);return;}
    if(action==='saved'){await openSaved(id);return;}
    if(action==='up'||action==='down'){
      const index=draft.alternatives.indexOf(id),next=index+(action==='up'?-1:1);
      if(index>=0&&next>=0&&next<draft.alternatives.length){[draft.alternatives[index],draft.alternatives[next]]=[draft.alternatives[next],draft.alternatives[index]];changed();render();}return;
    }
    await guarded(async m=>{
      if(action==='refresh'){await loadCatalogue(m);if(valid(m)&&draft.screen==='report'&&draft.resultId)await loadReport(draft.resultId,m);}
      else if(action==='preview')await preview(m);
      else if(action==='build')await build(m);
      else if(action==='refresh-report'){if(draft.pending)draft.pending.autoOpen=false;draft.filters=defaults().filters;draft.offset=0;await loadReport(id||draft.resultId,m);}
      else if(action==='resume-report'){useSelection(product.selection,false);await preview(m);}
      else if(action==='package')await enqueue('native.process.package',{id:product.id},m);
      else if(action==='previous'||action==='next'){draft.offset=action==='previous'?Math.max(0,draft.offset-100):rows.next_offset;await loadTable(m);}
      else if(action==='delivery'){
        const report=copy(product),delivery=draft.deliveryId;
        const value=await api(url('delivery'),{method:'POST',body:{id:report.id,delivery_id:delivery}});
        if(!valid(m)||!(await waitForSource(value.source_choice,m)))return;
        closeDetail();await openDelivery(value.selection);
      }
    });
  }
  function onClick(event){const node=event.target.closest('[data-np-action]');if(node&&root?.contains(node)){event.preventDefault();void action(node).catch(e=>toast(e.message||String(e)));}}
  function onChange(event){
    const target=event.target;if(!root?.contains(target)||busy)return;
    if(target.dataset.npField==='title'){draft.title=target.value;changed();return;}
    if(target.dataset.npField==='deliveryId'){draft.deliveryId=target.value;remember();render();return;}
    if(target.dataset.npField==='baseline'){draft.baseline=target.value;normalizeRuns();if(!draft.models.length)draft.models=commonModels();changed();render();return;}
    if(target.dataset.npAlternative){const id=target.dataset.npAlternative;if(target.checked){if(!draft.alternatives.includes(id))draft.alternatives.push(id);}else draft.alternatives=draft.alternatives.filter(x=>x!==id);normalizeRuns();changed();render();return;}
    if(target.dataset.npModel){const id=target.dataset.npModel;draft.models=['ndr','sdr'].filter(x=>x===id?target.checked:draft.models.includes(x));changed();render();return;}
    if(target.dataset.npField==='table'||target.dataset.npFilter){
      if(target.dataset.npField==='table'){draft.table=target.value;draft.filters=defaults().filters;}else draft.filters[target.dataset.npFilter]=target.value;
      draft.offset=0;rows=null;remember();void guarded(loadTable);
    }
  }
  async function mount(node){
    detach();root=node;workspace=current();restore(workspace);epoch++;busy=false;error='';catalogue={native_runs:[],reports:[]};product=null;proposed=null;rows=null;pollSignature='';
    root.addEventListener('click',onClick);root.addEventListener('change',onChange);render();
    await guarded(async m=>{if(await loadCatalogue(m)){if(draft.screen==='report'&&draft.resultId)await loadReport(draft.resultId,m);}});
  }
  function detach(){remember();invalidateNavigation();if(root){root.removeEventListener('click',onClick);root.removeEventListener('change',onChange);}root=null;epoch++;request++;busy=false;}
  async function update(state=getState()){
    if(!root)return;if(state?.workspace_key!==workspace||current()!==workspace){detach();return;}
    const task=state.tasks?.find(value=>value.id===draft.pending?.id);
    const signature=task?task.id+':'+task.state+':'+(task.updated_at||''):'';
    if(signature===pollSignature||busy)return;pollSignature=signature;
    if(task?.state==='complete'&&!busy){
      const reportId=task.result?.report_id||task.result?.id;
      await guarded(async m=>{if(await loadCatalogue(m)){if((draft.screen==='report'&&draft.resultId===reportId)||(draft.pending?.autoOpen&&task.action==='native.process.build')){draft.pending.autoOpen=false;await loadReport(reportId,m);}}});
    }else if(task&&!busy)render();
  }
  async function drainOpen(){
    if(busy||!pendingOpen)return;
    const opening=pendingOpen;pendingOpen=null;
    if(!root||workspace!==opening.workspace||current()!==opening.workspace||epoch!==opening.epoch){opening.resolve(false);return;}
    await guarded(async m=>{if(draft.pending)draft.pending.autoOpen=false;draft.filters=defaults().filters;draft.offset=0;await loadReport(opening.id,m);});
    opening.resolve(Boolean(root&&workspace===opening.workspace&&product?.id===opening.id&&draft.screen==='report'));
  }
  async function openSaved(id){
    if(!root||current()!==workspace)throw Error('Open this report in the selected Workspace.');
    invalidateNavigation();
    return new Promise(resolve=>{pendingOpen={id,workspace,epoch,resolve};void drainOpen();});
  }
  async function createForRun(value){
    const id=typeof value==='string'?value:value?.run_id;
    if(!root||current()!==workspace)throw Error('Open the process desk before selecting a run.');
    await guarded(async m=>{if(!(await loadCatalogue(m)))return;if(!run(id))throw Error('That run has no retained completed native process stage.');draft={...defaults(),baseline:id,title:'Original native watershed processes'};draft.models=commonModels();proposed=null;});
  }
  function taskActions(task){
    if(task.workspace!==current()||task.state!=='complete'||!['native.process.build','native.process.package'].includes(task.action))return '';
    const id=task.result?.report_id||task.result?.id;
    return id?'<div class="page-actions"><button type="button" data-action="nativeprocess-open" data-id="'+esc(id)+'" data-workspace="'+esc(task.workspace)+'">Open original process report</button></div>':'';
  }
  async function dispatch(node){
    if(node.dataset.action!=='nativeprocess-open')return false;
    if(node.dataset.workspace!==current())throw Error('Open the original task Workspace before its report.');
    closeDetail();await openDesk('native-process-reports','openSaved',node.dataset.id);return true;
  }
  return {mount,update,detach,openSaved,createForRun,taskActions,dispatch};
}
