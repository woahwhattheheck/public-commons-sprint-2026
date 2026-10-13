/** Completed native stages → original process reports on the maintained operator. */
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const sameSelection = (first,second) => canonical({...first,include_figures:first?.include_figures??false})===canonical({...second,include_figures:second?.include_figures??false});
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
const TABLE_FILTERS = ['model','run_id','baseline_run_id','alternative_run_id','watershed','quantity','field','units'];
const FILTER_LABELS = {model:'Model',run_id:'Run',baseline_run_id:'Baseline run',alternative_run_id:'Alternative or matched control',watershed:'Native watershed',quantity:'Quantity',field:'Original quantity field',units:'Original unit'};
const REVIEW_SCHEMA = 'upstate.native-process-table-review/v1';
const REVIEW_LIMIT = 32 * 1024 * 1024;
const defaults = () => ({tableFields:'key',title:'',baseline:'',alternatives:[],models:['ndr','sdr'],include_figures:false,render:true,resultId:null,screen:'choose',table:'quantities',filters:Object.fromEntries(TABLE_FILTERS.map(field=>[field,''])),offset:0,deliveryId:'',pending:null});
const fileURL = value => {if(typeof value!=='string'||!/^\/api\/file\//.test(value)||/[\u0000-\u001f]/.test(value))throw Error('Use an original operator download.');return value;};


export function nativeProcessReviewPayload(review) {
  if(!review||typeof review!=='object'||Array.isArray(review)||review.schema!==REVIEW_SCHEMA||
      !/^[0-9a-f]{64}$/.test(review.report_id||'')||!/^[0-9a-f]{64}$/.test(review.review_id||'')||
      !['quantities','support','changes','paired-support'].includes(review.table)||
      !review.source||!/^[0-9a-f]{64}$/.test(review.source.sha256||'')||
      !Number.isSafeInteger(review.source.bytes)||review.source.bytes<0||
      !review.filters||typeof review.filters!=='object'||Array.isArray(review.filters)||
      Object.entries(review.filters).some(([key,value])=>!TABLE_FILTERS.includes(key)||typeof value!=='string')||
      !Array.isArray(review.columns)||new Set(review.columns).size!==review.columns.length||
      review.columns.some(value=>typeof value!=='string')||
      !Array.isArray(review.rows)||!Array.isArray(review.row_numbers)||
      !Number.isSafeInteger(review.total_rows)||review.total_rows<0||
      !Number.isSafeInteger(review.selected_rows)||review.selected_rows<0||review.selected_rows>review.total_rows||review.selected_rows>100000||
      review.rows.length!==review.selected_rows||review.row_numbers.length!==review.rows.length||
      review.rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)||
        Object.keys(row).length!==review.columns.length||
        review.columns.some(column=>typeof row[column]!=='string')||
        Object.entries(review.filters).some(([column,value])=>!review.columns.includes(column)||(value&&row[column]!==value)))||
      review.row_numbers.some((value,index)=>!Number.isSafeInteger(value)||value<1||
        value>review.total_rows||(index>0&&value<=review.row_numbers[index-1])))
    throw Error('Open a complete original native table selection JSON.');
  return {id:review.report_id,table:review.table,...review.filters,expected_source:copy(review.source)};
}

export function nativeProcessReviewCSV(review) {
  nativeProcessReviewPayload(review);
  const cell=value=>{
    let text=String(value??'');
    const trimmed=text.replace(/^[ \t\r\n]+/,'');
    if(/^[=+@]/.test(trimmed)||(trimmed.startsWith('-')&&!/^-(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed))||/^[\t\r\n]/.test(text))
      text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  };
  return [review.columns,...review.rows.map(row=>review.columns.map(column=>row[column]))]
    .map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}

export function attachNativeProcesses({getState,getWorkspace,api,endpoint,toast,refreshState,
    openItem,openDelivery,navigate,closeDetail,showTask,openDesk,openScientificReport}) {
  let root=null,workspace=null,epoch=0,intent=0,request=0,busy=false,error='',draft=defaults(),pendingOpen=null;
  let catalogue={native_runs:[],reports:[]},proposed=null,product=null,rows=null,pollSignature='',reviewCache=null,tableFocus=null;
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
  function selection(){if(!draft.title.trim())throw Error('Give this original process report a title.');if(!draft.baseline)throw Error('Choose the first, baseline run.');if(!draft.models.length)throw Error('Choose a completed model shared by every selected run.');return {schema:'upstate.native-process-selection/v1',title:draft.title.trim(),run_ids:selected(),models:[...draft.models],...(catalogue.include_figures_available||draft.include_figures?{include_figures:Boolean(draft.include_figures)}:{})};}
  function changed(){proposed=null;error='';remember();}
  function pendingMarkup(){const value=draft.pending;if(!value)return '';const task=getState()?.tasks?.find(x=>x.id===value.id);return '<aside class="np-notice"><strong>'+esc(task?.state||'Retained operation')+'</strong> '+esc(value.action)+' '+(value.id?button('task','Open original operation','data-id="'+esc(value.id)+'"'):'')+(task?._native_process?.id?button('saved','Open retained process state','data-id="'+esc(task._native_process.id)+'"'):'')+(task?.error?'<p>'+esc(task.error.message)+'</p>':'')+(task?._downloads?.length?'<p>'+task._downloads.map(file=>'<a href="'+esc(fileURL(file.url))+'?download=1" download>'+esc(file.label||file.filename)+'</a>').join(' · ')+'</p>':'')+'</aside>';}
  function stageRows(list){return list.flatMap(row=>row.completed_models.map(model=>'<tr><td>'+esc(title(row))+'<small class="np-id">'+esc(row.run_id)+'</small></td><td>'+esc(row.state||'Retained')+'</td><td>'+esc(labels[model])+'</td><td>'+esc(version(row.versions?.[model]))+'</td><td>'+esc(row.watershed_outputs?.[model]?'Original watershed output retained':'Watershed output absent')+'</td><td>'+button('run','Open run','data-id="'+esc(row.run_id)+'"')+'</td></tr>'));}
  function chooseMarkup(){
    const candidates=catalogue.native_runs.filter(row=>row.completed_models.some(model=>row.watershed_outputs[model]));
    const baseline=run(draft.baseline),common=commonModels();
    const alternatives=candidates.filter(row=>row.run_id!==draft.baseline&&row.selection.grid_id===baseline?.selection.grid_id);
    return '<section class="np-section"><h2>Select original completed stages</h2><p>The first run is the baseline. A baseline alone is a complete process report. Parent runs may remain unfinished while their selected NDR or SDR stages are complete.</p>'+
      '<div class="np-form"><label>Report title<input data-np-field="title" value="'+esc(draft.title)+'" required></label>'+
      '<label>Baseline native run<select data-np-field="baseline">'+options(candidates.map(row=>[row.run_id,title(row)+' · parent '+row.state]),draft.baseline,'Choose an original run')+'</select></label></div>'+
      '<fieldset><legend>Alternatives on the same original grid</legend>'+(baseline?(alternatives.length?alternatives.map(row=>'<label class="np-check"><input type="checkbox" data-np-alternative="'+esc(row.run_id)+'"'+(draft.alternatives.includes(row.run_id)?' checked':'')+'>'+esc(title(row))+' <small>Parent '+esc(row.state)+'</small></label>').join(''):'<p>No other retained native run currently shares this grid.</p>'):'<p>Choose the baseline to list its compatible grid.</p>')+'</fieldset>'+
      (draft.alternatives.length?'<h3>Alternative order</h3><ol class="np-order">'+draft.alternatives.map((id,index)=>'<li><span>'+esc(run(id)?title(run(id)):short(id))+'</span>'+button('up','Move up','data-id="'+esc(id)+'"',index===0)+button('down','Move down','data-id="'+esc(id)+'"',index===draft.alternatives.length-1)+'</li>').join('')+'</ol>':'')+
      '<fieldset><legend>Completed process models</legend>'+['ndr','sdr'].map(model=>'<label class="np-check"><input type="checkbox" data-np-model="'+model+'"'+(draft.models.includes(model)?' checked':'')+(!common.includes(model)?' disabled':'')+'>'+esc(labels[model])+(common.includes(model)?'':' <small>Not retained for every selected run</small>')+'</label>').join('')+'</fieldset>'+
      (selected().length?table(['Original run','Parent state','Completed model','Producing version','Registry',''],stageRows(selected().map(run).filter(Boolean))):'')+
      '<fieldset><legend>Report presentation</legend><label class="np-check"><input type="checkbox" data-np-field="render"'+(draft.render?' checked':'')+'>Render the original PDF, HTML and companion report files</label><p class="np-note">Clearing this keeps the complete scientific source and tables for later rendering.</p>'+
      (catalogue.include_figures_available||draft.include_figures?'<label class="np-check"><input type="checkbox" data-np-field="include_figures"'+(draft.include_figures?' checked':'')+(!catalogue.include_figures_available?' disabled':'')+'>Include the original process figures</label><p class="np-note">Selected SVG figures use the installed scientific renderer even when PDF/HTML rendering is deferred.</p>':'')+'</fieldset>'+
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
      metadata({'Report identity':product.id,'State':product.state,'Phase':product.phase,'Original grid':product.grid_id,'Retained report files':product.retained_files+' files · '+size(product.retained_bytes),'Completed stage analyses':(product.completed_stages||[]).length,...(product.figure_count!=null?{'Original figures':product.figure_count,'Original panels':product.panel_count}:{})})+
      (product.error?'<p role="alert" class="np-error">'+esc(product.error.message)+'</p>':'')+executionMarkup()+
      (product.state!=='complete'||!product.rendered?'<p>'+button('resume-report','Preview and continue original report','',busy)+'</p>':'')+'</section>'+
      (product.source_choice?'<section class="np-section"><h2>Continue with this scientific source</h2>'+metadata({'Source collection':product.source_choice.source_collection_id,'Source':product.source_choice.source_id})+
      '<div class="np-actions">'+(typeof openScientificReport==='function'?button('scientific-report','Open this report only','data-selection-mode="replace"',busy)+button('scientific-report','Add to current report','data-selection-mode="append"',busy):'')+button('source','Open original source collection')+'</div><p>Open this report only starts the composer with this source and report title. Add to current report preserves the current ordered sources and title, adding this source once.</p><p>To revise an existing mapped delivery, choose its original saved selection below; this report is appended once and the earlier report order is preserved.</p>'+
      '<label>Saved delivery<select data-np-field="deliveryId">'+options(deliveries.map(row=>[row.id,row.selection?.title||row.title||short(row.id)]),draft.deliveryId,'Choose a retained delivery')+'</select></label>'+button('delivery','Open delivery with this report','',busy||!draft.deliveryId)+'</section>':'')+
      downloadsMarkup()+(product.tables?.length?tableMarkup():'');
  }
  function rowLabel(field,value){
    if(['run_id','baseline_run_id','alternative_run_id'].includes(field)){
      const original=product?.native_runs?.find(row=>row.id===value);
      return original?name('scenarios',original.selection.scenario_id)+' · '+name('profiles',original.selection.profile_id)+' · '+short(value):short(value);
    }
    if(field==='watershed')return product?.watershed_labels?.[value]||('Native watershed · '+short(value));
    if(field==='model')return labels[value]||value;
    return rows?.option_labels?.[field]?.[value]||value;
  }
  function tableMarkup(){
    const titles={quantities:'Watershed quantities',support:'Original finite-cell support',changes:'Native watershed changes','paired-support':'Same-cell changes and coverage'};
    const keyFields={
      quantities:['run_id','model','watershed','quantity','label','value','units'],
      support:['run_id','model','watershed','field','units','valid_cells','valid_area_ha','coverage_fraction','native_watershed_mass','mass','native_minus_pixel_centre_mass'],
      changes:['baseline_run_id','alternative_run_id','model','watershed','quantity','label','baseline','alternative','change','relative_change_pct','units'],
      'paired-support':['baseline_run_id','alternative_run_id','model','watershed','field','units','common_cells','baseline_only_cells','alternative_only_cells','baseline_common_mass','alternative_common_mass','common_change','common_relative_change_pct'],
    };
    const headings={...FILTER_LABELS,label:'Quantity description',value:'Original value',baseline:'Baseline value',alternative:'Alternative value',change:'Change',relative_change_pct:'Change (%)',valid_cells:'Finite cells',valid_area_ha:'Finite area (ha)',coverage_fraction:'Coverage fraction',native_watershed_mass:'Native watershed mass',mass:'Reconstructed mass',native_minus_pixel_centre_mass:'Native minus reconstructed mass',common_cells:'Common finite cells',baseline_only_cells:'Baseline-only cells',alternative_only_cells:'Alternative-only cells',baseline_common_mass:'Baseline same-cell mass',alternative_common_mass:'Alternative same-cell mass',common_change:'Same-cell mass change',common_relative_change_pct:'Same-cell change (%)'};
    const columns=rows?(draft.tableFields==='all'?rows.columns:(keyFields[draft.table]||rows.columns).filter(field=>rows.columns.includes(field))):[];
    const rowCell=(row,field)=>{
      const value=row[field]??'';
      if(value&&['run_id','baseline_run_id','alternative_run_id','watershed'].includes(field))
        return '<td>'+esc(rowLabel(field,value))+'<small class="np-id">'+esc(value)+'</small></td>';
      return '<td>'+esc(value)+'</td>';
    };
    return '<section class="np-section"><h2>Review quantities and changes</h2>'+
      '<p>Changes are alternative minus baseline. Choose the restoration or matched-control run explicitly. Native watershed masses and reconstructed same-cell quantities retain their separate support.</p>'+
      (draft.filters.alternative_run_id?'<h3>'+esc(rowLabel('alternative_run_id',draft.filters.alternative_run_id))+'</h3>':'')+
      '<div class="np-filters"><label>Table<select data-np-field="table"'+(busy?' disabled':'')+'>'+options(product.tables.map(id=>[id,titles[id]]),draft.table)+'</select></label>'+
      (rows?TABLE_FILTERS.filter(field=>rows.columns.includes(field)).map(field=>'<label>'+esc(FILTER_LABELS[field])+'<select data-np-filter="'+field+'"'+(busy?' disabled':'')+'>'+options(rows.options[field].map(value=>[value,rowLabel(field,value)]),draft.filters[field]||'','All original values')+'</select></label>').join(''):'')+
      '<label>Displayed fields<select data-np-field="tableFields"'+(busy?' disabled':'')+'>'+options([['key','Key quantities and support'],['all','Every original CSV field']],draft.tableFields)+'</select></label></div>'+
      (rows?'<p class="np-review-basis"><strong>'+esc(rows.basis||titles[draft.table])+ '</strong><br>Spatial basis: original native model-domain watersheds. A watershed row is not a South Carolina clip or an intake concentration.</p>'+
      '<p role="status">'+fmt(rows.selected_rows)+' selected of '+fmt(rows.total_rows)+' original rows; showing '+(rows.rows.length?draft.offset+1:0)+'–'+(draft.offset+rows.rows.length)+'. Blank unavailable values remain blank. Display and export keep original numerical precision.</p>'+
      '<div class="np-actions">'+button('clear-filters','Clear table filters','',busy)+button('save-table-csv','Download selected CSV','',busy||!rows.selected_rows)+button('save-table-json','Save selection and original rows','',busy)+button('open-table-json','Open saved table selection','',busy)+'</div>'+
      '<p class="np-note">Downloads include every matching row, beyond the current page, and every original column. JSON also retains report, grid, run and source-file identities for reopening. CSV protects spreadsheet formula text; JSON preserves every original cell exactly. Full original CSV downloads remain under Original report and data.</p>'+
      table(columns.map(field=>headings[field]||field),rows.rows.map(row=>'<tr>'+columns.map(field=>rowCell(row,field)).join('')+'</tr>'))+
      '<div class="np-actions">'+button('previous','Previous 100 rows','',busy||draft.offset===0)+button('next','Next 100 rows','',busy||rows.next_offset==null)+'</div>'+
      '<details><summary>Original table source</summary>'+metadata({'Report':product.id,'Original member':rows.source.path,'Original CSV bytes':rows.source.bytes,'Original CSV SHA-256':rows.source.sha256})+'</details>':'<p>Opening the retained table…</p>')+'</section>';
  }

  function render(){
    if(!root||current()!==workspace)return;
    root.innerHTML='<div class="native-process-desk"><header><h1>Native process reports</h1><p>Original completed nutrient and sediment stages, watershed quantities and source-bound scientific reports.</p><div class="np-actions">'+button('refresh','Refresh original runs and reports','',busy)+button('open-table-json','Open saved table selection','',busy)+'</div></header>'+
      (error?'<p class="np-error" role="alert">'+esc(error)+'</p>':'')+pendingMarkup()+(draft.screen==='report'?reportMarkup():chooseMarkup())+'</div>';
    if(!busy&&tableFocus){const selector=tableFocus;tableFocus=null;root.querySelector?.(selector)?.focus();}
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
    reviewCache=null;
    const stamp=++request,body=await api(url('report',{id}));
    if(!valid(m)||stamp!==request)return false;
    product=body;draft.resultId=id;draft.screen='report';rows=null;
    await loadTable(m);return valid(m);
  }
  async function preview(m){
    const selected=selection(),body=await api(url('preview'),{method:'POST',body:{selection:selected}});
    if(valid(m)&&sameSelection(selection(),selected)){proposed=body;return body;}return null;
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
    if(!proposed||!sameSelection(chosen,proposed.selection))throw Error('Preview this exact original selection before building.');
    await enqueue('native.process.build',{selection:copy(proposed.selection),expected_preview_id:proposed.id,render:Boolean(draft.render)},m);
  }
  async function waitForSource(choice,m){
    const deadline=Date.now()+15000;
    while(valid(m)){
      const found=getState()?.data?.sources?.some(row=>row.id===choice.source_collection_id&&row.entries?.some(entry=>entry.id===choice.source_id));
      if(found)return true;
      if(Date.now()>deadline)throw Error('The original source is retained. Refresh the Workspace before opening the scientific source.');
      await refreshState({force:true});
      if(!valid(m))return false;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    return false;
  }
  function useSelection(value,invalidate=true){
    if(invalidate)invalidateNavigation();
    if(draft.pending)draft.pending.autoOpen=false;
    draft.title=value.title;draft.baseline=value.run_ids[0];draft.alternatives=value.run_ids.slice(1);draft.models=[...value.models];draft.include_figures=Boolean(value.include_figures);draft.render=true;draft.screen='choose';proposed=null;error='';remember();render();
  }

  function saveDownload(filename,body,type){
    const address=URL.createObjectURL(new Blob([body],{type}));
    const anchor=document.createElement('a');anchor.href=address;anchor.download=filename;
    document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(address),30000);
  }
  async function selectedTable(m){
    if(!product||!rows)throw Error('Open an original process table first.');
    const payload={id:product.id,table:draft.table,...draft.filters,expected_source:copy(rows.source)};
    const key=canonical(payload);
    if(reviewCache?.key===key)return reviewCache.value;
    const value=await api(url('table-selection'),{method:'POST',body:payload});
    if(!valid(m))return null;
    nativeProcessReviewPayload(value);
    if(value.report_id!==product.id||value.table!==draft.table||canonical(value.source)!==canonical(rows.source))
      throw Error('The original table changed while opening its complete selection.');
    reviewCache={key,value};return value;
  }
  async function saveTable(format,m){
    const value=await selectedTable(m);if(!value||!valid(m))return;
    const stem='native-'+value.table+'-'+value.report_id.slice(0,12)+'-'+value.review_id.slice(0,12);
    if(format==='csv')saveDownload(stem+'.csv',nativeProcessReviewCSV(value),'text/csv;charset=utf-8');
    else saveDownload(stem+'.json',JSON.stringify(value)+'\n','application/json');
    toast('Saved '+value.selected_rows+' original rows from the complete table selection.');
  }
  async function reopenTable(file,m){
    if(!file)return;
    if(file.size>REVIEW_LIMIT)throw Error('Open a native table selection of at most 32 MiB.');
    const supplied=JSON.parse(await file.text());
    if(!valid(m))return;
    const payload=nativeProcessReviewPayload(supplied);
    const checked=await api(url('table-selection'),{method:'POST',body:payload});
    if(!valid(m))return;
    if(canonical(checked)!==canonical(supplied))
      throw Error('The saved selection or its original rows differ from this retained report. The current view was preserved.');
    const nextProduct=await api(url('report',{id:supplied.report_id}));
    if(!valid(m))return;
    if(nextProduct.id!==supplied.report_id||nextProduct.grid_id!==supplied.grid_id)
      throw Error('The saved table belongs to another original report or grid.');
    const firstPage=await api(url('table',{id:supplied.report_id,table:supplied.table,...supplied.filters,expected_source:supplied.source,offset:0,limit:100}));
    if(!valid(m))return;
    if(firstPage.report_id!==supplied.report_id||canonical(firstPage.source)!==canonical(supplied.source))
      throw Error('The original CSV changed before the saved selection reopened.');
    if(draft.pending)draft.pending.autoOpen=false;
    product=nextProduct;rows=firstPage;draft.resultId=supplied.report_id;draft.screen='report';
    draft.table=supplied.table;draft.filters={...defaults().filters,...supplied.filters};draft.offset=0;
    reviewCache=null;remember();toast('Reopened '+supplied.selected_rows+' source-bound original rows.');
  }
  function chooseTableFile(){
    const picker=document.createElement('input');picker.type='file';picker.accept='.json,application/json';
    const opening=mark();
    picker.addEventListener('change',()=>{if(valid(opening))void guarded(m=>reopenTable(picker.files?.[0],m));},{once:true});
    picker.click();
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
    if(action==='open-table-json'){chooseTableFile();return;}
    if(action==='up'||action==='down'){
      const index=draft.alternatives.indexOf(id),next=index+(action==='up'?-1:1);
      if(index>=0&&next>=0&&next<draft.alternatives.length){invalidateNavigation();[draft.alternatives[index],draft.alternatives[next]]=[draft.alternatives[next],draft.alternatives[index]];changed();render();}return;
    }
    await guarded(async m=>{
      if(action==='refresh'){await loadCatalogue(m);if(valid(m)&&draft.screen==='report'&&draft.resultId)await loadReport(draft.resultId,m);}
      else if(action==='preview')await preview(m);
      else if(action==='build')await build(m);
      else if(action==='refresh-report'){if(draft.pending)draft.pending.autoOpen=false;draft.filters=defaults().filters;draft.offset=0;await loadReport(id||draft.resultId,m);}
      else if(action==='resume-report'){useSelection(product.selection,false);await preview(m);}
      else if(action==='package')await enqueue('native.process.package',{id:product.id},m);
      else if(action==='save-table-csv'||action==='save-table-json')await saveTable(action==='save-table-csv'?'csv':'json',m);
      else if(action==='clear-filters'){draft.filters=defaults().filters;draft.offset=0;reviewCache=null;await loadTable(m);}
      else if(action==='previous'||action==='next'){draft.offset=action==='previous'?Math.max(0,draft.offset-100):rows.next_offset;await loadTable(m);}
      else if(action==='scientific-report'){
        if(typeof openScientificReport!=='function')throw Error('Receive the maintained scientific-report composer in this application.');
        const selectionMode=buttonNode.dataset.selectionMode;
        if(!['replace','append'].includes(selectionMode))throw Error('Choose whether to open this report only or add it to the current report.');
        const report=copy(product),choice=copy(report.source_choice);
        if(!valid(m)||!(await waitForSource(choice,m)))return;
        if(!valid(m))return;
        closeDetail();
        await openScientificReport({workspace_key:m.workspace,sources:[choice],title:report.title,selection_mode:selectionMode});
      }
      else if(action==='delivery'){
        const report=copy(product),delivery=draft.deliveryId;
        const value=await api(url('delivery'),{method:'POST',body:{id:report.id,delivery_id:delivery}});
        if(!valid(m)||!(await waitForSource(value.source_choice,m)))return;
        if(!valid(m))return;
        closeDetail();await openDelivery(value.selection);
      }
    });
  }
  function onClick(event){const node=event.target.closest('[data-np-action]');if(node&&root?.contains(node)){event.preventDefault();void action(node).catch(e=>toast(e.message||String(e)));}}
  function onChange(event){
    const target=event.target;if(!root?.contains(target)||busy)return;
    if(target.dataset.npField==='title'){draft.title=target.value;changed();return;}
    if(target.dataset.npField==='include_figures'){draft.include_figures=target.checked;changed();render();return;}
    if(target.dataset.npField==='render'){draft.render=target.checked;remember();return;}
    if(target.dataset.npField==='tableFields'){draft.tableFields=target.value==='all'?'all':'key';remember();render();return;}
    if(target.dataset.npField==='deliveryId'){draft.deliveryId=target.value;remember();render();return;}
    if(target.dataset.npField==='baseline'){draft.baseline=target.value;normalizeRuns();if(!draft.models.length)draft.models=commonModels();changed();render();return;}
    if(target.dataset.npAlternative){const id=target.dataset.npAlternative;if(target.checked){if(!draft.alternatives.includes(id))draft.alternatives.push(id);}else draft.alternatives=draft.alternatives.filter(x=>x!==id);normalizeRuns();changed();render();return;}
    if(target.dataset.npModel){const id=target.dataset.npModel;draft.models=['ndr','sdr'].filter(x=>x===id?target.checked:draft.models.includes(x));changed();render();return;}
    if(target.dataset.npField==='table'||target.dataset.npFilter){
      tableFocus=target.dataset.npFilter?'[data-np-filter="'+target.dataset.npFilter+'"]':'[data-np-field="table"]';
      if(target.dataset.npField==='table'){draft.table=target.value;draft.filters=defaults().filters;}else draft.filters[target.dataset.npFilter]=target.value;
      draft.offset=0;rows=null;reviewCache=null;remember();void guarded(loadTable);
    }
  }
  async function mount(node){
    detach();root=node;workspace=current();restore(workspace);epoch++;busy=false;error='';catalogue={native_runs:[],reports:[]};product=null;proposed=null;rows=null;pollSignature='';
    root.addEventListener('click',onClick);root.addEventListener('change',onChange);render();
    await guarded(async m=>{if(await loadCatalogue(m)){if(draft.screen==='report'&&draft.resultId)await loadReport(draft.resultId,m);}});
  }
  function detach(){remember();invalidateNavigation();if(root){root.removeEventListener('click',onClick);root.removeEventListener('change',onChange);}root=null;epoch++;request++;busy=false;reviewCache=null;tableFocus=null;}
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
  function requestedRuns(value){
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Choose an original native run selection.');
    if(value.workspace_key!==workspace||value.workspace_key!==current())throw Error('Open the original run selection in its intended Workspace.');
    const ids=value.run_ids;
    if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||!/^[0-9a-f]{64}$/.test(id))||new Set(ids).size!==ids.length)
      throw Error('Choose each original native run once, with the baseline first.');
    let models=null;
    if(value.models!==undefined){
      if(!Array.isArray(value.models)||!value.models.length||value.models.some(model=>!['ndr','sdr'].includes(model))||new Set(value.models).size!==value.models.length)
        throw Error('Choose each completed process model once: NDR, SDR, or both.');
      models=['ndr','sdr'].filter(model=>value.models.includes(model));
    }
    if(value.title!==undefined&&(typeof value.title!=='string'||!value.title.trim()))throw Error('Give this original process report a title.');
    return {workspace_key:value.workspace_key,run_ids:[...ids],models,title:value.title?.trim()||'Original native watershed processes'};
  }
  function catalogueSelection(value){
    const original=value.run_ids.map(id=>{
      const found=run(id);
      if(!found)throw Error('Original run '+short(id)+' has no retained completed native process stage. Keep the full selection and refresh its run.');
      return found;
    });
    const grid=original[0].selection?.grid_id;
    if(!grid||original.some(row=>row.selection?.grid_id!==grid))throw Error('Choose original runs on the same native grid.');
    const common=['ndr','sdr'].filter(model=>original.every(row=>row.completed_models?.includes(model)&&row.watershed_outputs?.[model]));
    const models=value.models||common;
    if(!models.length||models.some(model=>!common.includes(model)))throw Error('Every selected original run must retain each requested completed model and its watershed output.');
    return {title:value.title,run_ids:[...value.run_ids],models:[...models],include_figures:false};
  }
  async function drainOpen(){
    if(busy||!pendingOpen)return;
    const opening=pendingOpen;pendingOpen=null;
    if(!root||workspace!==opening.workspace||current()!==opening.workspace||epoch!==opening.epoch){opening.resolve(false);return;}
    let applied=false;
    await guarded(async m=>{
      if(opening.kind==='selection'){
        if(!(await loadCatalogue(m)))return;
        const selected=catalogueSelection(opening.selection);
        if(!valid(m))return;
        const retained=draft.pending?{...draft.pending,autoOpen:false}:null;
        draft={...defaults(),pending:retained};
        product=null;rows=null;pollSignature='';
        useSelection(selected,false);
        applied=true;
      }else{
        if(draft.pending)draft.pending.autoOpen=false;
        draft.filters=defaults().filters;draft.offset=0;
        applied=Boolean(await loadReport(opening.id,m));
      }
    });
    opening.resolve(Boolean(applied&&root&&workspace===opening.workspace&&current()===opening.workspace&&epoch===opening.epoch&&intent===opening.intent));
  }
  async function openSaved(id){
    if(!root||current()!==workspace)throw Error('Open this report in the selected Workspace.');
    invalidateNavigation();
    return new Promise(resolve=>{pendingOpen={kind:'report',id,workspace,epoch,intent,resolve};void drainOpen();});
  }
  async function createForRuns(value){
    if(!root||current()!==workspace)throw Error('Open the process desk before selecting original runs.');
    const selection=requestedRuns(value);
    invalidateNavigation();
    return new Promise(resolve=>{pendingOpen={kind:'selection',selection,workspace,epoch,intent,resolve};void drainOpen();});
  }
  async function createForRun(value){
    const id=typeof value==='string'?value:value?.run_id;
    return createForRuns({workspace_key:typeof value==='object'&&value?.workspace_key!==undefined?value.workspace_key:current(),
      run_ids:[id],...(value&&typeof value==='object'&&value.models!==undefined?{models:value.models}:{}),
      ...(value&&typeof value==='object'&&value.title!==undefined?{title:value.title}:{})});
  }
  function taskActions(task){
    if(task.workspace!==current()||!['native.process.build','native.process.package'].includes(task.action))return '';
    const id=task._native_process?.id||(task.state==='complete'?(task.result?.report_id||task.result?.id):null);
    return id?'<div class="page-actions"><button type="button" data-action="nativeprocess-open" data-id="'+esc(id)+'" data-workspace="'+esc(task.workspace)+'">Open original process report</button></div>':'';
  }
  async function dispatch(node){
    if(node.dataset.action!=='nativeprocess-open')return false;
    if(node.dataset.workspace!==current())throw Error('Open the original task Workspace before its report.');
    closeDetail();await openDesk('native-process-reports','openSaved',node.dataset.id);return true;
  }
  return {mount,update,detach,openSaved,createForRun,createForRuns,taskActions,dispatch};
}
