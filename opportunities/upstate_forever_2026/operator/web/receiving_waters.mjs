import {attachReceivingWaterMonitoring} from './receiving_water_monitoring.mjs';
import {attachReceivingWaterReport} from './receiving_water_report.mjs';
import {copySelection,selectionObject,newReceptor,receptorFields,planFields,revisePlan,analysisFields,reviseAnalysis,groupFields,reviseGroup,changedPaths} from './receiving_water_editing.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = value => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined,{maximumFractionDigits:3});
const percent = value => value === null || value === undefined ? '—' : fmt(Number(value)*100)+'%';
const pretty = value => JSON.stringify(value,null,2);
const short = value => String(value || '').slice(0,12);
const human = value => String(value ?? '').replaceAll('_',' ');
const families = {critical_drinking_water:'Drinking-water sources',high_quality_waters:'High-quality waters'};
const pollutants = {nitrogen_export:'Nitrogen',phosphorus_export:'Phosphorus',sediment_export:'Sediment'};
const totalUnits = {nitrogen_export:'kg/year',phosphorus_export:'kg/year',sediment_export:'metric tonnes/year'};
const control = (action,label,attrs='',primary=false) => '<button type="button" data-action="'+esc(action)+'" '+attrs+(primary?' class="primary"':'')+'>'+esc(label)+'</button>';
const spatialControl = (label,kind,id,subject='',statistic='areas',run='',quantity='',subjectKind='') => control('spatial-item',label,
  'data-kind="receiving-water-'+esc(kind)+'" data-id="'+esc(id)+'" data-subject="'+esc(subject)+'" data-statistic="'+esc(statistic)+'" data-run="'+esc(run)+'" data-quantity="'+esc(quantity)+'" data-subject-kind="'+esc(subjectKind)+'"');
const input = (name,value='',attrs='') => '<input name="'+esc(name)+'" value="'+esc(value)+'" '+attrs+'>';
const area = (name,value='',attrs='') => '<textarea name="'+esc(name)+'" '+attrs+'>'+esc(value)+'</textarea>';
const field = (label,html,note='',wide=false) => '<label'+(wide?' class="full"':'')+'><span>'+esc(label)+'</span>'+html+(note?'<small>'+esc(note)+'</small>':'')+'</label>';
const options = (rows,value='',empty='Choose...') => '<option value="">'+esc(empty)+'</option>'+rows.map(row=>'<option value="'+esc(row[0])+'"'+(String(row[0])===String(value)?' selected':'')+'>'+esc(row[1])+'</option>').join('');
const select = (name,rows,value='',attrs='required',empty) => '<select name="'+esc(name)+'" '+attrs+'>'+options(rows,value,empty)+'</select>';
const table = (heads,rows) => '<div class="water-table-scroll"><table><thead><tr>'+heads.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const badge = value => '<span class="water-status">'+esc(human(value))+'</span>';
const section = (title,content,note='') => '<section class="water-section"><header><h2>'+esc(title)+'</h2>'+(note?'<p>'+esc(note)+'</p>':'')+'</header>'+content+'</section>';
const formRoot = () => document.querySelector('#operation-form');
const value = (name,root=formRoot()) => root?.querySelector('[name="'+name+'"]')?.value?.trim() || '';
const checked = (name,root=formRoot()) => [...root.querySelectorAll('[name="'+name+'"]:checked')].map(x=>x.value);
const jsonObject = (text,label) => {let item;try{item=JSON.parse(text);}catch{throw Error(label+' must contain a JSON object.');}if(!item||Array.isArray(item)||typeof item!=='object')throw Error(label+' must contain a JSON object.');return item;};
const safeDate = () => new Date().toISOString().slice(0,10);

export function attachReceivingWaters(context){
  const {getState,api,endpoint,openForm,submitAction,detail,fileList,showTask,toast}=context;
  const monitoring=attachReceivingWaterMonitoring(context);
  const report=attachReceivingWaterReport({...context,refreshReportView:()=>{
    const target=host?.querySelector('#water-report-sources');
    if(target)target.innerHTML=report.render();
  }});
  let host=null,version=0,controller=null,timer=null,selected=null,record=null,catalog=null,workspaceKey=null;
  let nextReceptor=1,nextCatalogSource=1,studyRequest=0;
  const pageSize=75;
  let searchIndex=new WeakMap();
  let display={search:'',family:'',kind:'',run:'',quantity:'physical'};
  const data = () => {const row=getState()?.data||{};return {...row,...(row.receiving_waters||{})};};
  const currentWorkspace = () => getState()?.workspace_key;
  const plans = () => data().receiving_water_plans || [];
  const analyses = () => data().receiving_water_analyses || [];
  const catalogs = () => data().receiving_water_catalogs || [];
  const runs = () => data().runs || [];
  const runTitle = id => {
    const run=runs().find(x=>x.id===id),selection=run?.selection || {};
    const scenario=(data().scenarios||[]).find(x=>x.id===selection.scenario_id);
    const profile=(data().profiles||[]).find(x=>x.id===selection.profile_id);
    return [scenario?.title||scenario?.spec?.title,profile?.title].filter(Boolean).join(' / ')||short(id);
  };
  const planTitle = id => plans().find(x=>x.id===id)?.title||short(id);
  const storageKey = () => 'upstate-receiving-water-view:'+currentWorkspace();
  function remember(){
    try{if(selected)sessionStorage.setItem(storageKey(),JSON.stringify(selected));else sessionStorage.removeItem(storageKey());}catch{}
  }
  function switchWorkspace(){
    if(workspaceKey===currentWorkspace())return;
    workspaceKey=currentWorkspace();record=null;catalog=null;display={search:'',family:'',kind:'',run:'',quantity:'physical'};
    try{const saved=JSON.parse(sessionStorage.getItem(storageKey())||'null');selected=saved&&['plan','analysis','designation-catalog'].includes(saved.kind)&&/^[0-9a-f]{64}$/.test(saved.id)?saved:null;}catch{selected=null;}
  }
  function studyControl(kind,row,workspace=currentWorkspace()){
    if(!['plan','analysis'].includes(kind)||row?.state!=='complete'||
        !/^[0-9a-f]{64}$/.test(row?.id||'')||!workspace||
        (typeof context.openStudyTransfer!=='function'&&typeof context.openExtension!=='function'))return '';
    return control('water-study-transfer','Transfer editable study',
      'data-kind="'+esc(kind)+'" data-id="'+esc(row.id)+'" data-workspace="'+esc(workspace)+'"');
  }
  async function transferStudy(value){
    const kind=value?.kind,id=value?.id,workspace=currentWorkspace(),marker=version,request=++studyRequest;
    const view=typeof context.getView==='function'?context.getView():undefined;
    if(!workspace||!['plan','analysis'].includes(kind)||!/^[0-9a-f]{64}$/.test(id||''))
      throw Error('Choose an original saved receiving-water plan or analysis.');
    if(value.workspace_key!==undefined&&value.workspace_key!==workspace)
      throw Error('Open this receiving-water study in its original workspace.');
    if(typeof context.openStudyTransfer!=='function'&&typeof context.openExtension!=='function')
      throw Error('Open the maintained Study transfer desk to transfer this saved study.');
    const row=await api(endpoint('/api/receiving-waters/'+kind,{[kind+'_id']:id}));
    if(workspace!==currentWorkspace()||marker!==version||request!==studyRequest||
        (view!==undefined&&view!==context.getView?.()))
      throw Error('The workspace or Receiving view changed. Choose the saved study again.');
    if(row?.id!==id||row?.schema!=='upstate.receiving-water-'+kind+'/v1'||row?.state!=='complete')
      throw Error('Choose the complete original receiving-water '+kind+' before transferring it.');
    const selection={workspace_key:workspace,roots:[{
      kind:kind==='plan'?'receiving-water-plans':'receiving-water-analyses',
      id:row.id,title:row.title,state:row.state
    }]};
    if(typeof context.closeDetail==='function')context.closeDetail();
    return typeof context.openExtension==='function'?
      context.openExtension('study-transfer','openForStudies',selection):context.openStudyTransfer(selection);
  }
  function progress(row){
    if(row.state==='complete')return 'Complete';
    const done=row.completed_subjects,total=row.total_subjects;
    return Number.isFinite(total)&&total>0?fmt(done||0)+' / '+fmt(total)+' areas':human(row.state);
  }
  function render(){
    switchWorkspace();
    const planRows=plans(),analysisRows=analyses(),tasks=(getState()?.tasks||[]).filter(x=>x.action?.startsWith('receiving.water.')&&['queued','running','failed','interrupted'].includes(x.state));
    let html='<div class="water-workbench"><header class="water-heading"><div><p class="eyebrow">UPPER SAVANNAH SCIENTIFIC WORKBENCH</p><h1>Receiving waters</h1><p>Link original water sources and designated reaches to their contributing land. Compare modeled exports for each receiving water and the combined source areas.</p></div><div class="water-actions">'+control('water-catalog-new','Choose published waters')+control('water-profile-new','Use utility profile')+control('water-plan-new','Define receiving areas')+control('water-analyze-new','Analyze model results','',true)+'</div></header>';
    html+='<div class="water-summary"><div><strong>'+fmt(planRows.length)+'</strong><span>Saved source plans</span></div><div><strong>'+fmt(analysisRows.filter(x=>x.state==='complete').length)+'</strong><span>Completed analyses</span></div><div><strong>'+fmt(runs().filter(x=>x.state==='complete').length)+'</strong><span>Available native runs</span></div></div>';
    if(tasks.length)html+=section('Operations',table(['Operation','State','Created',''],tasks.map(t=>'<tr><td>'+esc({'receiving.water.plan':'Prepare receiving areas','receiving.water.profile':'Prepare utility areas','receiving.water.catalog':'Compile published waters','receiving.water.analyze':'Analyze receiving waters','receiving.water.monitoring':'Prepare monitoring network','receiving.water.report.prepare':'Prepare scientific report source'}[t.action]||t.action)+(t.error?'<small class="water-error">'+esc(t.error.message||t.error)+'</small>':'')+'</td><td>'+badge(t.state)+'</td><td>'+esc(t.created_at?new Date(t.created_at).toLocaleString():'')+'</td><td>'+control('water-task','Inspect','data-id="'+esc(t.id)+'"')+'</td></tr>')),'Selections and completed work remain available when the operator reopens.');
    if(catalogs().length)html+=section('Published-water catalogs',table(['Catalog','Original records','Selected waters','As of',''],catalogs().map(row=>'<tr><td><strong>'+esc(row.title||'Published receiving waters')+'</strong><small>'+esc(human(row.state))+'</small></td><td>'+fmt(row.record_count)+'</td><td>'+fmt(row.selected_count)+'</td><td>'+esc(row.as_of||'')+'</td><td>'+control('water-open','Open','data-kind="designation-catalog" data-id="'+esc(row.id)+'"')+'</td></tr>')));
    html+=section('Source plans',planRows.length?table(['Plan','Receiving waters','Families','Created',''],planRows.map(row=>'<tr><td><strong>'+esc(row.title)+'</strong><small>'+esc(short(row.id))+'</small></td><td>'+fmt(row.receptor_count)+'</td><td>'+esc((row.families||[]).map(x=>families[x]||human(x)).join(', '))+'</td><td>'+esc(row.created_at?new Date(row.created_at).toLocaleString():'')+'</td><td class="water-row-actions">'+control('water-open','Open','data-kind="plan" data-id="'+esc(row.id)+'"')+control('water-analyze-new','Analyze','data-plan-id="'+esc(row.id)+'"')+studyControl('plan',row)+'</td></tr>')):'<div class="water-empty"><p>Choose original published water features or an existing utility profile to prepare a source plan.</p><p>The plan saves its water features, contribution boundaries, source editions, and relationship methods.</p></div>');
    html+=section('Model analyses',analysisRows.length?table(['Analysis','Baseline','Quantity domain','Progress',''],analysisRows.map(row=>'<tr><td><strong>'+esc(row.title)+'</strong><small>'+esc(planTitle(row.plan_id))+'</small></td><td>'+esc(runTitle(row.baseline_run_id))+'</td><td>'+esc(row.quantity_scope==='model_domain'?'Full modeled domain':'Reporting area')+'</td><td>'+badge(progress(row))+'</td><td>'+control('water-open','Open','data-kind="analysis" data-id="'+esc(row.id)+'"')+(row.state==='failed'?control('water-analysis-resume','Resume selection','data-id="'+esc(row.id)+'"'):'')+studyControl('analysis',row)+'</td></tr>')):'<div class="water-empty"><p>Choose a source plan, completed baseline, and any compatible land-cover alternatives. Each analysis saves its physical quantities and map layers.</p></div>');
    html+=monitoring.render();
    html+='<div id="water-report-sources">'+report.render()+'</div>';
    html+='<section class="water-section" id="water-selected" aria-live="polite">'+(selected?'<p class="water-loading">Opening saved '+esc(selected.kind)+'...</p>':'<p class="water-empty">Open a plan or analysis to inspect its receiving areas and results.</p>')+'</section></div>';
    return html;
  }
  function detach(){
    report.detach();
    studyRequest++;
    version++;host?.removeEventListener('input',onInput);host?.removeEventListener('change',onChange);host?.removeEventListener('toggle',onToggle,true);host=null;clearTimeout(timer);timer=null;controller?.abort();controller=null;
  }
  function onInput(event){
    if(event.target.matches('[data-water-catalog-search]')){display.catalogSearch=event.target.value;display.catalogPage=0;updateCatalog();return;}
    if(event.target.matches('[data-water-download-search]')){display.downloadSearch=event.target.value;display.downloadPage=0;updateDownloads();return;}
    if(!event.target.matches('[data-water-search]'))return;
    display.search=event.target.value;display.page=0;updateResults();
  }
  function onChange(event){
    const name=event.target.dataset.waterFilter;if(!name)return;
    display[name]=event.target.value;if(name==='catalogFilter'){display.catalogPage=0;updateCatalog();}else{display.page=0;updateResults();}
  }
  function mount(node){
    detach();host=node;
    const marker=version;host.addEventListener('input',onInput);host.addEventListener('change',onChange);host.addEventListener('toggle',onToggle,true);
    if(selected)loadSelection(marker).catch(error=>showError(error,marker));
  }
  function showError(error,marker=version){
    if(marker!==version||error.name==='AbortError')return;
    const target=host?.querySelector('#water-selected');
    if(target){target.setAttribute('aria-busy','false');target.innerHTML='<div class="water-error" role="alert"><h2>Unable to open selected record</h2><p>'+esc(error.message)+'</p>'+control('water-reload','Retry')+'</div>';}
  }
  async function loadSelection(marker=version){
    if(!host||!selected)return;
    clearTimeout(timer);controller?.abort();controller=new AbortController();
    const choice={...selected},workspace=currentWorkspace();
    const loading=host.querySelector('#water-selected');if(loading){loading.setAttribute('aria-busy','true');delete loading.dataset.waterRecordId;delete loading.dataset.waterRecordKind;}
    const result=await api(endpoint('/api/receiving-waters/'+choice.kind,{[choice.kind==='designation-catalog'?'catalog_id':choice.kind+'_id']:choice.id}),{signal:controller.signal});
    if(marker!==version||workspace!==currentWorkspace()||selected?.id!==choice.id||selected?.kind!==choice.kind)return;
    record=result;searchIndex=new WeakMap();
    const target=host.querySelector('#water-selected');if(!target)return;
    target.innerHTML=choice.kind==='plan'?planView(result):choice.kind==='designation-catalog'?catalogView(result):analysisView(result);
    target.dataset.waterRecordId=choice.id;target.dataset.waterRecordKind=choice.kind;target.setAttribute('aria-busy','false');
    if(choice.kind==='plan')updatePlan();
    if(choice.kind==='designation-catalog')updateCatalog();
    if(choice.kind==='analysis'){updateResults();if(['building','queued','running'].includes(result.state))timer=setTimeout(()=>loadSelection(marker).catch(error=>showError(error,marker)),3500);}
  }
  function openSelection(kind,id){
    if(!['plan','analysis','designation-catalog'].includes(kind)||!/^[0-9a-f]{64}$/.test(id))throw Error('Choose a saved receiving-water record.');
    selected={kind,id};record=null;resetPages();remember();
    return loadSelection().then(()=>host?.querySelector('#water-selected')?.scrollIntoView({behavior:'smooth',block:'start'}));
  }
  function sourceTitle(source){
    const collection=(data().sources||[]).find(x=>x.id===source?.source_collection_id);
    return collection?.entries?.find(x=>x.id===source?.source_id)?.title||source?.source_id||'Family union';
  }
  function resetPages(){
    display.page=0;display.catalogPage=0;display.downloadPage=0;display.downloadSearch='';
    display.search='';display.family='';display.kind='';display.catalogSearch='';display.catalogFilter='';
  }
  function matchesRows(rows,needle,predicate=()=>true,full=false){
    needle=String(needle||'').trim().toLocaleLowerCase();
    const eligible=rows.filter(predicate);if(!needle)return eligible;
    const exact=eligible.filter(row=>String(row.id||'').toLocaleLowerCase()===needle);
    if(exact.length)return exact;
    return eligible.filter(row=>{
      let text=searchIndex.get(row);
      if(text===undefined){
        text=(full?JSON.stringify(row):[row.title,row.id,sourceTitle(row.source)].join(' ')).toLocaleLowerCase();
        searchIndex.set(row,text);
      }
      return text.includes(needle);
    });
  }
  function pageRows(rows,key){
    const max=Math.max(0,Math.ceil(rows.length/pageSize)-1);
    const requested=Number(display[key]);
    const page=Number.isFinite(requested)?Math.max(0,Math.min(Math.trunc(requested),max)):0;
    display[key]=page;
    return {rows:rows.slice(page*pageSize,(page+1)*pageSize),page,max,total:rows.length,
      first:rows.length?page*pageSize+1:0,last:Math.min(rows.length,(page+1)*pageSize)};
  }
  function pageControls(page,key,label='records'){
    return '<div class="water-section-heading"><p class="water-result-count" role="status">'+
      fmt(page.first)+'–'+fmt(page.last)+' of '+fmt(page.total)+' '+esc(label)+'</p><div class="water-actions">'+
      control('water-page','Previous','data-page-key="'+esc(key)+'" data-direction="-1"'+(page.page===0?' disabled':''))+
      '<span>Page '+fmt(page.page+1)+' of '+fmt(page.max+1)+'</span>'+
      control('water-page','Next','data-page-key="'+esc(key)+'" data-direction="1"'+(page.page===page.max?' disabled':''))+'</div></div>';
  }
  function downloadsView(title){
    return '<details data-water-downloads><summary>'+esc(title)+' ('+fmt(record?._downloads?.length||0)+')</summary>'+
      '<div class="water-filters">'+field('Find a download',input('water_download_search',display.downloadSearch||'','data-water-download-search placeholder="File name, label, or SHA256"'))+'</div><div id="water-download-list"></div></details>';
  }
  function onToggle(event){
    if(event.target.matches('[data-water-downloads]')&&event.target.open)updateDownloads();
    if(event.target.matches('[data-water-selection]')&&event.target.open){
      const body=event.target.querySelector('[data-water-selection-body]');
      if(body&&!body.dataset.loaded){body.textContent=pretty(record?.identity?.selection||record?.selection);body.dataset.loaded='true';}
    }
  }
  function updateDownloads(){
    const target=host?.querySelector('#water-download-list');if(!target||!record)return;
    const needle=String(display.downloadSearch||'').trim().toLocaleLowerCase();
    const rows=(record._downloads||[]).filter(row=>!needle||[row.label,row.filename,row.sha256].join(' ').toLocaleLowerCase().includes(needle));
    const page=pageRows(rows,'downloadPage');
    target.innerHTML=pageControls(page,'downloadPage','matching downloads')+
      (page.rows.length?fileList(page.rows):'<p class="water-empty">No downloads match this selection.</p>');
  }
  function planView(row){
    return '<header class="water-section-heading"><div><p class="eyebrow">SAVED SOURCE PLAN</p><h2>'+esc(row.title)+'</h2><p>'+fmt(row.receptors?.length||0)+' receiving waters</p></div>'+control('water-analyze-new','Analyze this plan','data-plan-id="'+esc(row.id)+'"',true)+control('water-monitoring-new','Plan monitoring','data-kind="plan" data-id="'+esc(row.id)+'"')+control('water-report-new','Prepare scientific report source','data-kind="plan" data-id="'+esc(row.id)+'"')+studyControl('plan',row)+control('water-revise','Revise source plan','data-kind="plan" data-id="'+esc(row.id)+'"')+'</header>'+
      '<div class="water-filters">'+field('Search receiving waters',input('water_search',display.search,'data-water-search placeholder="Name, exact native ID, or source"'))+
      field('Family',select('water_family',Object.entries(families),display.family,'data-water-filter="family"','All families'))+'</div>'+
      '<div id="water-plan-table"></div>'+downloadsView('Source geometries and plan downloads')+
      '<details data-water-selection><summary>Original source selection</summary><pre class="json-view" data-water-selection-body></pre></details>';
  }
  function updatePlan(){
    const target=host?.querySelector('#water-plan-table');if(!target||selected?.kind!=='plan'||!record)return;
    const rows=matchesRows(record.receptors||[],display.search,r=>!display.family||r.family===display.family);
    const page=pageRows(rows,'page');
    target.innerHTML=pageControls(page,'page','matching receiving waters')+
      (page.rows.length?table(['Receiving water','Family','Relationship','Contribution area (ha)','Original source',''],page.rows.map(r=>'<tr><td><strong>'+esc(r.title)+'</strong><small>'+esc(r.id)+'</small></td><td>'+esc(families[r.family]||human(r.family))+'</td><td>'+esc(r.relationship_precision||human(r.relation?.method))+'</td><td>'+fmt(r.contribution_area_ha)+'</td><td>'+esc(sourceTitle(r.source))+'</td><td>'+control('water-subject','Details','data-id="'+esc(r.id)+'" data-subject-kind="receptor"')+spatialControl('Boundaries','plan',record.id,r.id)+'</td></tr>')):'<p class="water-empty">No receiving waters match this selection.</p>');
  }
  function measurementKeys(row){
    if(Array.isArray(row.pollutants)&&row.pollutants.length)return row.pollutants;
    return [...new Set((row.subjects||[]).flatMap(s=>Object.keys(s.metrics?.baseline_physical||{})))];
  }
  const accountingRoles={total:'Downstream total',upstream_union:'Upstream union',incremental:'Downstream incremental',reservoir_inflow:'Above-reservoir land',other_upstream:'Other upstream land'};
  function accountingView(row){
    const groups=row.accounting?.groups||[];
    if(!groups.length)return '';
    return '<section class="water-accounting-summary"><h3>Nested catchment accounting</h3><p class="water-note">Each group partitions its downstream total on the original raster grid. Reservoir catchments identify land export to streams above the dam. The upstream union is a subtotal; use the disjoint partition rows to reconcile with the total.</p>'+
      table(['Catchment group','Downstream total','Partition',''],groups.map(group=>{
        const parent=(row.subjects||[]).find(s=>s.id===group.parent_receptor_id&&s.kind==='receptor')||(row.subjects||[]).find(s=>s.id===group.subject_ids?.total&&s.kind==='receptor');
        return '<tr><td><strong>'+esc(group.title||group.id)+'</strong><small>'+esc(group.id)+'</small></td><td>'+esc(parent?.title||group.parent_receptor_id||group.subject_ids?.total||'')+'</td><td>'+esc((group.partition_roles||[]).map(role=>accountingRoles[role]||human(role)).join(' + '))+'</td><td>'+control('water-accounting-detail','Open accounting','data-id="'+esc(group.id)+'"')+'</td></tr>';
      }))+'</section>';
  }
  function accountingDetails(id){
    const group=(record?.accounting?.groups||[]).find(row=>row.id===id);
    if(!group)throw Error('Choose a catchment group from this saved analysis.');
    const subjects=record.subjects||[],findSubject=role=>subjects.find(row=>row.id===group.subject_ids?.[role]&&row.kind===(role==='total'?'receptor':'accounting'));
    const roles=['total','upstream_union',...(group.partition_roles||[])].filter((role,index,all)=>all.indexOf(role)===index&&group.subject_ids?.[role]);
    let html='<p>'+esc(group.rationale||'')+'</p><p class="water-note">Totals are modeled land export to streams within the selected source boundaries. Above-reservoir quantities preserve that same meaning. Catchment precision follows the original source relationship.</p>'+
      table(['Accounting area','Saved area','Selected cells','Domain area (ha)',''],roles.map(role=>{
        const subject=findSubject(role);return '<tr><th scope="row">'+esc(accountingRoles[role]||human(role))+'</th><td>'+esc(subject?.title||group.subject_ids[role])+'</td><td class="water-number">'+fmt(group.selected_cells?.[role]??subject?.metrics?.selected_cells)+'</td><td class="water-number">'+fmt(subject?.area_in_quantity_scope_ha)+'</td><td>'+(subject?control('water-subject','Physical results','data-id="'+esc(subject.id)+'" data-subject-kind="'+esc(subject.kind)+'"'):'')+'</td></tr>';
      }))+'<p>Selected-cell partition residual: <strong>'+fmt(group.selected_cell_residual)+'</strong>.</p>';
    const quantities=group.quantities||[];
    const runIds=[record.baseline_run_id,...(record.alternative_run_ids||[])];
    for(const runId of runIds){
      const runRows=quantities.filter(row=>row.run_id===runId);
      if(!runRows.length)continue;
      html+='<h3>'+esc(runTitle(runId))+'</h3>';
      for(const statistic of [...new Set(runRows.map(row=>row.statistic))]){
        const rows=runRows.filter(row=>row.statistic===statistic);
        html+='<h4>'+esc(({current_export:'Baseline export',alternative_export:'Alternative export',alternative_minus_baseline:'Signed change',positive_increased_export:'Increased export',positive_avoided_export:'Avoided export',common_baseline_export:'Baseline on common valid cells',common_alternative_export:'Alternative on common valid cells'})[statistic]||human(statistic))+'</h4>'+table(['Quantity',...roles.map(role=>accountingRoles[role]||human(role)),'Units','Closure residual','Closure'],rows.map(row=>{
          const closure=row.closure||{};
          return '<tr><th scope="row">'+esc(pollutants[row.quantity]||human(row.quantity))+'</th>'+roles.map(role=>{
            const v=row.values?.[role];return '<td class="water-number">'+fmt(v?.sum)+'<small>'+fmt(v?.valid_cells)+' valid cells · '+percent(v?.coverage_fraction)+'</small></td>';
          }).join('')+'<td>'+esc(row.units||totalUnits[row.quantity]||'')+'</td><td class="water-number">'+fmt(closure.residual)+'<small>Cell residual '+fmt(closure.valid_cell_residual)+'</small></td><td>'+esc(human(closure.status||''))+(typeof closure.within_summation_allowance==='boolean'?'<small>'+(closure.within_summation_allowance?'Within recorded summation allowance':'Review partition quantities')+'</small>':'')+'</td></tr>';
        }));
      }
    }
    if(!quantities.length)html+='<p class="water-note">Accounting quantities appear as the saved analysis completes its source areas.</p>';
    html+='<h3>Original relationship references</h3><ul>'+(group.references||[]).map(reference=>'<li>'+esc(typeof reference==='string'?reference:pretty(reference))+'</li>').join('')+'</ul>'+
      '<details><summary>Source relationships and complete saved accounting</summary><pre class="json-view">'+esc(pretty(group))+'</pre></details>';
    detail(group.title||group.id,html,{kind:'receiving-water-accounting',id:group.id,state:record.state});
  }
  function analysisView(row){
    const keys=measurementKeys(row),active=['building','queued','running'].includes(row.state);
    const runOptions=(row.alternative_run_ids||[]).map(id=>[id,runTitle(id)]);
    if(display.run&&!runOptions.some(x=>x[0]===display.run))display.run='';
    return '<header class="water-section-heading"><div><p class="eyebrow">SAVED MODEL ANALYSIS</p><h2>'+esc(row.title)+'</h2><p>'+esc(runTitle(row.baseline_run_id))+' · '+esc(row.quantity_scope==='model_domain'?'Full modeled domain':'Reporting area')+' · '+esc(keys.map(k=>pollutants[k]||human(k)).join(', '))+'</p></div>'+badge(progress(row))+'</header>'+
      (row.state==='complete'?'<div class="water-actions">'+spatialControl('Review receiving areas','analysis',row.id)+control('water-monitoring-new','Plan monitoring from priorities','data-kind="analysis" data-id="'+esc(row.id)+'"')+control('water-report-new','Prepare scientific report source','data-kind="analysis" data-id="'+esc(row.id)+'"')+studyControl('analysis',row)+control('water-revise','Revise analysis','data-kind="analysis" data-id="'+esc(row.id)+'"')+control('water-revise','Revise original source plan','data-kind="plan" data-id="'+esc(row.plan_id||row.identity?.selection?.plan_id)+'"')+'</div>':'')+
      (row.state==='complete'&&typeof context.openDelivery==='function'&&Object.keys(pollutants).every(key=>keys.includes(key))?'<div class="water-actions">'+control('water-delivery','Add to maps and delivery','data-id="'+esc(row.id)+'"')+'</div>':'')+
      (active?'<p class="water-progress" role="status">Calculating receiving areas. Completed geometry results are saved as the analysis proceeds.</p>':'')+
      (row.error?'<div class="water-error" role="alert">'+esc(typeof row.error==='string'?row.error:row.error.message||pretty(row.error))+' '+control('water-analysis-resume','Resume saved selection','data-id="'+esc(row.id)+'"')+'</div>':'')+
      '<div class="water-filters">'+field('Search receiving waters',input('water_search',display.search,'data-water-search placeholder="Name, exact native ID, or source"'))+
      field('Family',select('water_family',Object.entries(families),display.family,'data-water-filter="family"','All families'))+
      field('Area type',select('water_kind',[['receptor','Individual receiving water'],['family_union','Combined family area'],['accounting','Catchment accounting partition']],display.kind,'data-water-filter="kind"','All areas'))+
      field('Model run',select('water_run',runOptions,display.run,'data-water-filter="run"','Baseline'))+
      field('Quantity',select('water_quantity',[['physical','Total export'],['change','Signed export change'],['increased','Increased export'],['avoided','Avoided export']],display.quantity,'data-water-filter="quantity"','Choose quantity'))+'</div>'+
      '<p class="water-note">Each family combines its contributing areas once. Individual receiving-water totals can overlap. Export changes use the same valid pixels in both runs.</p><div id="water-result-table"></div>'+
      accountingView(row)+
      '<details><summary>Priority calculation and source interpretation</summary><div class="water-definition">'+
      '<h3>Normalization</h3><pre class="json-view">'+esc(pretty(row.normalization||{}))+'</pre><h3>Physical measurement</h3><pre class="json-view">'+esc(pretty(row.measurement||{}))+'</pre></div></details>'+
      downloadsView('Saved maps, quantities, and receiving areas');
  }
  function analysisMapControl(subject){
    const statistic=display.run&&display.quantity==='increased'?'increased_export_priority':display.run&&display.quantity==='avoided'?'avoided_export_priority':'current_priority';
    const key=(display.run?display.run+'_':'')+statistic;
    if(!subject.metrics?.files?.[key])return '';
    return spatialControl(statistic==='current_priority'?'Priority map':statistic==='increased_export_priority'?'Increased-export map':'Avoided-export map','analysis',record.id,subject.id,statistic,display.run,'',subject.kind);
  }
  function selectedStats(subject,key){
    const metrics=subject.metrics||{};
    if(!display.run)return metrics.baseline_physical?.[key];
    const alt=metrics.alternatives?.[display.run];
    return display.quantity==='physical'?alt?.physical?.[key]:alt?.changes?.[key];
  }
  function selectedQuantity(stats){
    if(!stats)return null;
    if(!display.run||display.quantity==='physical'||display.quantity==='change')return stats.sum;
    return display.quantity==='increased'?stats.sum_increased_export:stats.sum_avoided_export;
  }
  function updateResults(){
    if(selected?.kind==='plan')return updatePlan();
    const target=host?.querySelector('#water-result-table');if(!target||selected?.kind!=='analysis'||!record)return;
    const keys=measurementKeys(record);
    const rows=matchesRows(record.subjects||[],display.search,s=>(!display.family||s.family===display.family)&&(!display.kind||s.kind===display.kind));
    const page=pageRows(rows,'page');
    const heads=['Receiving area',...keys.map(k=>(pollutants[k]||human(k))+' ('+(totalUnits[k]||'original units')+')'),'Minimum valid coverage','Area in quantity domain (ha)',''];
    const body=page.rows.map(s=>{
      const coverage=keys.map(k=>selectedStats(s,k)?.coverage_fraction).filter(x=>x!==null&&x!==undefined);
      return '<tr><td><strong>'+esc(s.title)+'</strong><small>'+esc(s.kind==='accounting'?(accountingRoles[s.accounting_role]||human(s.accounting_role)):s.kind==='family_union'?'Combined family area':families[s.family]||human(s.family))+'</small></td>'+
        keys.map(k=>'<td class="water-number">'+fmt(selectedQuantity(selectedStats(s,k)))+'</td>').join('')+
        '<td class="water-number">'+percent(coverage.length?Math.min(...coverage):null)+'</td><td class="water-number">'+fmt(s.area_in_quantity_scope_ha)+'</td><td>'+control('water-subject','Details','data-id="'+esc(s.id)+'" data-subject-kind="'+esc(s.kind)+'"')+analysisMapControl(s)+'</td></tr>';
    });
    target.innerHTML=(display.quantity!=='physical'&&!display.run?'<p class="water-note">Choose an alternative run to show export changes. The table currently shows the baseline.</p>':'')+
      pageControls(page,'page','matching areas')+(body.length?table(heads,body):'<p class="water-empty">No completed areas match this selection.</p>');
  }
  function subjectDetails(id,kind){
    const matches=(record?.subjects||record?.receptors||[]).filter(x=>x.id===id&&(!kind||(x.kind||'receptor')===kind));
    if(matches.length!==1)throw Error('Choose the individual water or combined family area from the saved receiving-water record.');
    const subject=matches[0];
    let html='<p>'+esc(subject.interpretation||subject.relationship_precision||'')+'</p>'+
      table(['Source relationship','Value'],[
        ['Family',families[subject.family]||subject.family],['Method',subject.relationship_precision||subject.relation?.method],
        ['Original source',sourceTitle(subject.source)],['Contribution area (ha)',fmt(subject.contribution_area_ha)],
        ['Area in quantity domain (ha)',fmt(subject.area_in_quantity_scope_ha)]
      ].map(([k,v])=>'<tr><th scope="row">'+esc(k)+'</th><td>'+esc(v||'—')+'</td></tr>'));
    if(subject.accounting_group_id)html+='<div class="water-actions">'+control('water-accounting-detail','Open catchment accounting','data-id="'+esc(subject.accounting_group_id)+'"')+'</div>';
    const metrics=subject.metrics;
    if(!metrics)html+='<div class="water-actions">'+spatialControl('Review boundaries','plan',record.id,subject.id)+'</div>';
    else if(metrics.files?.current_priority)html+='<div class="water-actions">'+spatialControl('Review baseline priority','analysis',record.id,subject.id,'current_priority','','',subject.kind)+'</div>';
    if(metrics){
      const keys=Object.keys(metrics.baseline_physical||{});
      html+='<h3>Baseline physical export</h3>'+table(['Quantity','Total','Units','Valid cells','Coverage'],keys.map(key=>{
        const v=metrics.baseline_physical[key];return '<tr><th scope="row">'+esc(pollutants[key]||human(key))+'</th><td>'+fmt(v.sum)+'</td><td>'+esc(totalUnits[key]||v.sum_units)+'</td><td>'+fmt(v.valid_cells)+'</td><td>'+percent(v.coverage_fraction)+'</td></tr>';
      }));
      for(const [runId,alt]of Object.entries(metrics.alternatives||{})){
        html+='<h3>'+esc(runTitle(runId))+'</h3><p class="water-note">Paired baseline and alternative totals use their common valid cells. Signed change is alternative minus baseline.</p>'+
          table(['Quantity','Baseline on common cells','Alternative on common cells','Signed change','Increased export','Avoided export','Units','Paired coverage','Map'],keys.map(key=>{
            const v=alt.changes?.[key]||{};return '<tr><th scope="row">'+esc(pollutants[key]||human(key))+'</th>'+
              ['baseline_sum_on_common_cells','alternative_sum_on_common_cells','sum','sum_increased_export','sum_avoided_export'].map(k=>'<td class="water-number">'+fmt(v[k])+'</td>').join('')+
              '<td>'+esc(totalUnits[key]||v.sum_units||'')+'</td><td>'+percent(v.coverage_fraction)+'</td><td>'+(metrics.files?.[runId+'_'+key+'_change']?spatialControl('Signed change','analysis',record.id,subject.id,'change',runId,key,subject.kind):'—')+'</td></tr>';
          }));
      }
      html+='<h3>Priority statistics</h3><p class="water-note">Priority values are dimensionless. Physical export quantities remain in the tables above.</p><pre class="json-view">'+esc(pretty({baseline:metrics.current_priority,alternatives:Object.fromEntries(Object.entries(metrics.alternatives||{}).map(([id,a])=>[id,{current:a.current_priority,increased:a.increased_export_priority,avoided:a.avoided_export_priority}]))}))+'</pre>';
    }
    html+='<details><summary>Source designation and original features</summary><pre class="json-view">'+esc(pretty({classification:subject.classification,source:subject.source,relation:subject.relation,original_features:subject.original_features,metadata:subject.metadata}))+'</pre></details>';
    detail(subject.title,html,{kind:'receiving-water-subject',id:subject.id,state:record?.state});
  }
  async function loadCatalog(){
    const workspace=currentWorkspace(),result=await api(endpoint('/api/receiving-waters/catalog'));
    if(workspace!==currentWorkspace())throw Error('Reopen the form in the selected workspace.');
    catalog=result;return result;
  }
  function vectorSources(c=catalog){
    return (c?.sources||data().sources||[]).flatMap(collection=>(collection.entries||[]).filter(e=>e.kind==='vector').map(entry=>({
      key:JSON.stringify({source_collection_id:collection.id,source_id:entry.id}),
      title:entry.title+' / '+collection.title,entry,collection
    })));
  }
  function sourceSelector(name,selected='',required=true){
    return select(name,retainedOptions(vectorSources().map(x=>[x.key,x.title]),selected,'Retained source'),selected,required?'required':'','Choose original vector source');
  }
  function sourceChoice(name,root=formRoot(),required=true){
    const raw=value(name,root);if(!raw){if(required)throw Error('Choose the original source for '+human(name)+'.');return undefined;}
    return jsonObject(raw,'Source selection');
  }
  function addSourceLayer(choice,name,root=formRoot()){
    const layer=value(name,root);if(layer)choice.layer=layer;return choice;
  }
  async function profileForm(){
    const c=await loadCatalog(),grids=(c.grids||[]).filter(g=>g.state==='complete');
    openForm('Prepare utility receiving areas','Use the saved utility-focus profile with its original HUC anchors and source reference.',
      '<div class="form-grid">'+field('Utility profile JSON','<input type="file" name="utility_file" accept=".json,application/json">','Choose the existing utility-focus profile.',true)+
      field('Prepared model grid',select('utility_grid',grids.map(g=>[g.id,g.spec?.title||short(g.id)]),'',''), 'Select the grid carrying the original catchment source.',true)+
      field('Profile content',area('utility_profile','','required rows="16" spellcheck="false"'),'The selected file is loaded here for review.',true)+'</div>',
      'Prepare utility areas',()=>submitAction('receiving.water.profile',{receptor_spec:jsonObject(value('utility_profile'),'Utility profile'),...(value('utility_grid')?{grid_id:value('utility_grid')}:{})}),
      ()=>{formRoot().querySelector('[name="utility_file"]').addEventListener('change',async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>4*1024*1024)throw Error('Choose a profile smaller than 4 MiB.');const text=await f.text();jsonObject(text,'Utility profile');formRoot().querySelector('[name="utility_profile"]').value=text;}catch(error){toast(error.message);}});});
  }
  function retainedOptions(rows,selected,label='Retained choice'){
    return selected&&!rows.some(row=>String(row[0])===String(selected))?
      [...rows,[selected,label+' · '+short(selected)]]:rows;
  }
  function draftTools(seed,origin){
    return '<section class="full water-edit-review"><p>'+(origin?
      'Editing a copy of the original '+esc(origin.kind)+' '+esc(short(origin.id))+'. The saved study and its source files remain available. ':
      '')+'Changes use the existing preparation queue. An unchanged selection can reuse its original completed result.</p>'+
      '<p data-water-edit-summary role="status">Original settings are retained.</p>'+
      '<details><summary>Advanced retained selection</summary><p>All original source filters, metadata, intake references, catchment settings and scientific choices are retained. To change fields beyond this form, edit this complete selection and apply it. Applying replaces the visible form values.</p>'+
      area('receiving_advanced_selection',pretty(seed),'rows="16" spellcheck="false"')+
      '<button type="button" data-water-apply-selection>Apply selection to form</button></details></section>';
  }
  function checkDraft(root,seed,workspace){
    if(root!==formRoot()||workspace!==currentWorkspace())throw Error('Reopen the form in its original workspace before saving.');
    if(JSON.stringify(jsonObject(value('receiving_advanced_selection',root),'Advanced retained selection'))!==JSON.stringify(seed))
      throw Error('Apply the edited advanced selection to the form before saving.');
  }
  function mountDraft(root,seed,read,reopen,workspace,original=seed){
    const summary=root.querySelector('[data-water-edit-summary]');
    const update=()=>{
      try{
        checkDraft(root,seed,workspace);
        const changed=changedPaths(original,read());
        summary.textContent=changed.length?'Changed settings: '+changed.slice(0,12).join(', ')+(changed.length>12?' and '+(changed.length-12)+' more.':'.'):
          'No changes to the retained selection. Saving can reuse the original completed result.';
      }catch(error){summary.textContent=error.message;}
    };
    root.addEventListener('input',update);root.addEventListener('change',update);
    root.querySelector('[data-water-apply-selection]').addEventListener('click',async()=>{
      try{
        if(root!==formRoot()||workspace!==currentWorkspace())throw Error('Reopen the form in its original workspace.');
        const next=jsonObject(value('receiving_advanced_selection',root),'Advanced retained selection');
        await reopen(next);
      }catch(error){toast(error.message);}
    });
    update();
  }
  function receptorRow(index,seed=newReceptor(index),fields=receptorFields(seed)){
    const f=fields;
    return '<fieldset class="full water-receptor-row" data-water-receptor data-water-receptor-index="'+index+'"><legend>Receiving area '+esc(seed.title||seed.id||index)+'</legend><div class="form-grid">'+
      field('Name',input('receptor_title',f.title,'required'))+field('Stable area ID',input('receptor_id',f.id,'required pattern="[A-Za-z0-9_.-]{1,128}"'))+
      field('Map family',select('receptor_family',retainedOptions(Object.entries(families),f.family),f.family))+
      field('Original vector source',sourceSelector('receptor_source',f.source))+
      field('Source layer',input('receptor_layer',f.layer),'Optional original layer name.')+
      field('Contribution method',select('receptor_method',[['upstream_huc','Original HUC / ToHUC upstream land'],['source_area','Published source-area polygon'],['geometric_context','Explicit geometric context']],f.method))+
      field('Native feature IDs',input('receptor_features',f.features),'JSON preserves numeric and string IDs exactly. Comma-separated new IDs are treated as strings.',true)+
      field('Exact attribute selection',area('receptor_where',f.where,'rows="2" spellcheck="false"'),'Original field names and typed equality values are retained.',true)+
      field('Relationship rationale',area('receptor_rationale',f.rationale,'required rows="2"'),'Describe how this source defines its receiving area.',true)+
      field('Context buffer (metres)',input('receptor_buffer',f.buffer,'type="number" min="0" step="any"'),'Used for geometric context. A published source-area relationship requires zero.')+
      field('Original designation',input('receptor_designation',f.designation),'Other classification and source metadata remain retained.')+
      '</div><p class="water-note">Changing a source keeps its original filters, layer and supporting metadata until you explicitly edit them. Review these bindings and the advanced selection when choosing another source edition.</p>'+
      '<div class="water-actions">'+control('water-source-inspect','Inspect selected source')+control('water-receptor-remove','Remove area')+'</div></fieldset>';
  }
  function readReceptorFields(root){
    return Object.fromEntries(['title','id','family','source','layer','features','where','method','rationale','buffer','designation']
      .map(key=>[key,value('receptor_'+key,root)]));
  }
  async function planForm(initial=null,origin=null){
    const workspace=currentWorkspace(),marker=version,view=context.getView?.();
    await loadCatalog();
    if(workspace!==currentWorkspace()||marker!==version||(view!==undefined&&view!==context.getView?.()))throw Error('Reopen the source-plan form in its original workspace.');
    if(!vectorSources().length)throw Error('Import the original water and catchment vector sources first.');
    const seed=initial===null?{title:'',analysis_crs:'EPSG:5070',receptors:[newReceptor(1)]}:selectionObject(initial);
    if(!Array.isArray(seed.receptors)||!seed.receptors.length)throw Error('Retain at least one original receiving-area selection.');
    const f=planFields(seed),rows=seed.receptors.map((row,index)=>({index:index+1,seed:selectionObject(row),fields:receptorFields(row)}));
    nextReceptor=rows.length;let root,page=0;
    const pageLength=20;
    const flush=()=>{for(const node of root.querySelectorAll('[data-water-receptor]')){
      const row=rows.find(row=>String(row.index)===node.dataset.waterReceptorIndex);
      if(row)row.fields=readReceptorFields(node);
    }};
    const read=()=>{
      flush();
      return revisePlan(seed,{title:value('plan_title',root),crs:value('plan_crs',root),catchments:value('plan_catchments',root),
        catchmentLayer:value('plan_catchment_layer',root),huc:value('plan_huc_field',root),tohuc:value('plan_tohuc_field',root)},rows);
    };
    const paint=()=>{
      page=Math.max(0,Math.min(page,Math.ceil(rows.length/pageLength)-1));
      root.querySelector('#water-receptor-rows').innerHTML=rows.slice(page*pageLength,(page+1)*pageLength).map(row=>receptorRow(row.index,row.seed,row.fields)).join('');
      root.querySelector('[data-water-plan-pages]').innerHTML='<p>'+fmt(Math.min(page*pageLength+1,rows.length))+'–'+fmt(Math.min((page+1)*pageLength,rows.length))+' of '+fmt(rows.length)+' receiving areas. All pages are retained.</p>'+
        '<button type="button" data-water-plan-page="-1"'+(page===0?' disabled':'')+'>Previous areas</button> '+
        '<button type="button" data-water-plan-page="1"'+((page+1)*pageLength>=rows.length?' disabled':'')+'>Next areas</button>';
    };
    openForm(origin?'Revise saved receiving areas':'Define receiving areas','Choose original source geometry and its contribution relationship. Save a new selection while retaining the original source plan.',
      '<div class="form-grid">'+field('Study title',input('plan_title',f.title,'required'),'',true)+
      field('Catchment network',sourceSelector('plan_catchments',f.catchments,false),'Required for HUC / ToHUC upstream relationships.',true)+
      field('Catchment layer',input('plan_catchment_layer',f.catchmentLayer),'Retain the original layer name when supplied.',true)+
      field('Catchment ID field',input('plan_huc_field',f.huc))+field('Downstream HUC field',input('plan_tohuc_field',f.tohuc))+
      field('Projected analysis CRS',input('plan_crs',f.crs,'required'),'Use a projected CRS measured in metres.',true)+
      '<div class="full" data-water-plan-pages></div><div class="full" id="water-receptor-rows"></div><div class="full">'+control('water-receptor-add','Add receiving area')+'</div>'+
      draftTools(seed,origin)+'</div>',
      origin?'Save revised source plan':'Save source plan',()=>{
        checkDraft(root,seed,workspace);return submitAction('receiving.water.plan',read());
      },()=>{
        root=formRoot();
        root.receivingPlanEditor={
          add(){flush();const added=newReceptor(++nextReceptor);rows.push({index:nextReceptor,seed:added,fields:receptorFields(added)});page=Math.floor((rows.length-1)/pageLength);paint();},
          remove(node){flush();const index=rows.findIndex(row=>String(row.index)===node?.dataset.waterReceptorIndex);if(index<0)throw Error('Choose an area in this form.');rows.splice(index,1);paint();}
        };
        root.addEventListener('click',event=>{const button=event.target.closest('[data-water-plan-page]');if(!button)return;event.preventDefault();flush();page+=Number(button.dataset.waterPlanPage);paint();});
        paint();mountDraft(root,seed,read,next=>planForm(next,origin),workspace,origin?.selection||seed);
      });
  }
  async function inspectSource(button){
    const root=button.closest('[data-water-receptor]'),choice=sourceChoice('receptor_source',root);
    const layer=value('receptor_layer',root),result=await api(endpoint('/api/source-info',{collection:choice.source_collection_id,source:choice.source_id,...(layer?{layer}:{})}));
    detail(result.source?.title||'Original water source','<p>'+fmt(result.feature_count)+' features · '+esc(result.geometry_type||'')+'</p><h3>Original fields</h3><pre class="json-view">'+esc(pretty(result.fields))+'</pre><h3>Original sample records</h3><pre class="json-view">'+esc(pretty(result.sample))+'</pre>',{kind:'receiving-water-source'});
  }
  function accountingFormControls(){
    return '<details class="full water-accounting-editor"><summary>Nested catchments and reservoirs</summary>'+
      '<p>Separate a receiving catchment into the union of its declared upstream catchments and the remaining land. Reservoir catchments can be reported separately within that upstream union.</p>'+
      '<p class="water-note">Choose source areas from this saved plan. Boundaries and the original source relationship determine the precision. Reservoir rows describe land export to streams above the dam; reservoir throughput requires a separate model.</p>'+
      '<p id="water-accounting-plan-status" role="status">Choose a source plan to load its original areas.</p>'+
      '<div id="water-accounting-groups"></div>'+
      '<button type="button" data-water-accounting-add disabled>Add catchment group</button></details>';
  }
  function mountAccountingForm(root,initial){
    const retained=initial===undefined?undefined:copySelection(initial);
    if(retained!==undefined&&retained!==null&&(!retained||typeof retained!=='object'||Array.isArray(retained)))
      throw Error('Retain the original accounting object.');
    let plan=null,request=0,sequence=0,waiting=true,errorMessage='';
    let savedGroups=(retained?.groups||[]).map(group=>selectionObject(group,'Accounting group'));
    const list=root.querySelector('#water-accounting-groups'),status=root.querySelector('#water-accounting-plan-status'),add=root.querySelector('[data-water-accounting-add]');
    const rows=()=>plan?.receptors||[];
    function updateMembers(group){
      const parent=value('account_parent',group),seed=group.receivingSeed;
      const previous=new Map([...group.querySelectorAll('[data-water-accounting-member]')].map(row=>[row.dataset.waterAccountingMember,value('account_role',row)]));
      if(!previous.size)for(const id of seed.upstream_receptor_ids||[])previous.set(id,(seed.reservoir_receptor_ids||[]).includes(id)?'reservoir':'upstream');
      for(const id of seed.reservoir_receptor_ids||[])if(!previous.has(id))previous.set(id,'reservoir');
      const available=rows().filter(row=>row.id!==parent||previous.get(row.id));
      for(const [id,role]of previous)if(role&&!available.some(row=>row.id===id))available.push({id,title:'Retained area '+id,missing:true});
      group.querySelector('[data-water-accounting-members]').innerHTML=available.map(row=>
        '<div class="water-accounting-member" data-water-accounting-member="'+esc(row.id)+'"><label><span>'+esc(row.title||row.id)+'<small>'+esc(row.id)+' · '+esc(row.missing?'Not present in this source plan':row.id===parent?'Also selected as downstream total — review this membership':row.relationship_precision||human(row.relation?.method))+'</small></span>'+
        select('account_role',[['upstream','Upstream catchment'],['reservoir','Reservoir catchment']],previous.get(row.id)||'','','Exclude')+'</label></div>').join('')||'<p class="water-note">This plan needs another source area to form a nested group.</p>';
    }
    function appendGroup(seed={id:'catchment-'+(sequence+1),title:'',parent_receptor_id:'',upstream_receptor_ids:[],reservoir_receptor_ids:[],references:[],rationale:''}){
      if(!plan||plan.id!==value('analysis_plan',root))return;
      if(list.children.length>=100){status.textContent='This analysis supports up to 100 catchment groups.';return;}
      const index=++sequence,group=document.createElement('fieldset'),f=groupFields(seed);
      group.className='water-accounting-group';group.dataset.waterAccountingGroup=String(index);group.receivingSeed=copySelection(seed);
      group.innerHTML='<legend>Catchment group '+index+'</legend><div class="form-grid">'+
        field('Group name',input('account_title',f.title,'required'),'For example, the selected downstream intake and its upstream catchments.',true)+
        field('Stable group ID',input('account_id',f.id,'required maxlength="128" pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,127}"'),'Original group identity is retained unless edited.')+
        field('Downstream total catchment',select('account_parent',retainedOptions(rows().map(row=>[row.id,row.title||row.id]),f.parent,'Retained area (not in this plan)'),f.parent),'Its full contributing area contains the upstream selections.')+
        '<div class="full"><h4>Original upstream areas</h4><p class="water-note">Select the catchments whose complete contributing land lies inside the downstream area. Overlaps enter their union once.</p><div data-water-accounting-members></div></div>'+
        field('Source references',area('account_references',f.references,'required rows="3"'),'One original URL or citation per line; original structured references remain unchanged unless edited.',true)+
        field('Relationship rationale',area('account_rationale',f.rationale,'required rows="3"'),'Describe the upstream catchment and reservoir relationships.',true)+
        '</div><div class="water-actions"><button type="button" data-water-accounting-remove>Remove group</button></div>';
      list.append(group);updateMembers(group);
    }
    function readGroups(strict=true){
      return [...list.querySelectorAll('[data-water-accounting-group]')].map(group=>{
        const fields={id:value('account_id',group),title:value('account_title',group),parent:value('account_parent',group),
          references:value('account_references',group),rationale:value('account_rationale',group)};
        const members=[...group.querySelectorAll('[data-water-accounting-member]')].map(row=>({id:row.dataset.waterAccountingMember,role:value('account_role',row)}));
        if(strict){
          const ids=new Set(rows().map(row=>row.id));
          if(!ids.has(fields.parent)||members.some(row=>row.role&&(!ids.has(row.id)||row.id===fields.parent)))
            throw Error('Review retained catchment membership against the selected source plan before saving.');
        }
        return reviseGroup(group.receivingSeed,fields,members);
      });
    }
    root.querySelector('[name="analysis_plan"]').addEventListener('change',()=>{
      try{if(list.children.length)savedGroups=readGroups(false);loadPlan();}
      catch(error){errorMessage=error.message;status.textContent='Keep or correct the current accounting draft before changing plans: '+error.message;}
    });
    add.addEventListener('click',()=>appendGroup());
    list.addEventListener('click',event=>{const button=event.target.closest('[data-water-accounting-remove]');if(button)button.closest('[data-water-accounting-group]')?.remove();});
    list.addEventListener('change',event=>{if(event.target.name==='account_parent')updateMembers(event.target.closest('[data-water-accounting-group]'));});
    async function loadPlan(){
      const marker=++request,id=value('analysis_plan',root),workspace=currentWorkspace();
      waiting=true;errorMessage='';plan=null;add.disabled=true;list.replaceChildren();
      if(!id){status.textContent='Choose a source plan to load its original areas.';return;}
      status.textContent='Loading original contributing areas; retained groups will be restored when ready…';
      try{
        const loaded=await api(endpoint('/api/receiving-waters/plan',{plan_id:id}));
        if(marker!==request||workspace!==currentWorkspace()||!root.isConnected)return;
        if(loaded.id!==id||loaded.state!=='complete'||!Array.isArray(loaded.receptors))throw Error('Choose the complete original source plan.');
        plan=loaded;waiting=false;add.disabled=rows().length<2;
        for(const group of savedGroups)appendGroup(group);
        status.textContent=rows().length+' original receiving areas loaded. '+savedGroups.length+' retained groups preserved; review memberships after changing the plan.';
      }catch(error){if(marker===request&&root.isConnected){waiting=false;errorMessage=error.message;status.textContent='Unable to load accounting areas: '+error.message;}}
    }
    loadPlan();
    return ()=>{
      if((savedGroups.length||list.children.length)&&(waiting||errorMessage||!plan||plan.id!==value('analysis_plan',root)))
        throw Error(errorMessage||'Wait for the selected source plan and its retained accounting groups to finish loading.');
      const groups=readGroups();
      if(new Set(groups.map(group=>group.id)).size!==groups.length)throw Error('Each catchment group needs a different stable ID.');
      if(!groups.length&&!(retained?.groups?.length))return retained;
      const out=retained&&typeof retained==='object'?copySelection(retained):{};
      out.groups=groups;return out;
    };
  }
  async function analyzeForm(planId='',initial=null,origin=null){
    const workspace=currentWorkspace(),marker=version,view=context.getView?.();
    await loadCatalog();
    if(workspace!==currentWorkspace()||marker!==version||(view!==undefined&&view!==context.getView?.()))throw Error('Reopen the analysis form in its original workspace.');
    const seed=initial===null?{plan_id:planId,baseline_run_id:'',alternative_run_ids:[],quantity_scope:'reporting'}:selectionObject(initial);
    const f=analysisFields(seed),complete=runs().filter(r=>r.state==='complete');
    if(!plans().length&&!f.plan)throw Error('Prepare a receiving-water source plan first.');
    if(!complete.length&&!f.baseline)throw Error('Complete a native model run before calculating receiving-water exports.');
    let readAccounting=()=>seed.accounting,root;
    const read=()=>reviseAnalysis(seed,{
      title:value('analysis_title',root),plan:value('analysis_plan',root),baseline:value('analysis_baseline',root),
      alternatives:checked('analysis_alternatives',root),scope:value('analysis_scope',root),
      weights:value('analysis_weights',root),normalization:value('analysis_normalization',root)
    },readAccounting());
    openForm(origin?'Revise saved receiving-water analysis':'Analyze receiving-water exports',
      'Use the original saved plan and completed native cohort. Changed settings create a separate analysis; unchanged settings preserve native resume or reuse.',
      '<div class="form-grid">'+field('Analysis title',input('analysis_title',f.title),'Optional; otherwise uses the source-plan title.',true)+
      field('Source plan',select('analysis_plan',retainedOptions(plans().map(p=>[p.id,p.title]),f.plan,'Retained plan'),f.plan),'',true)+
      field('Baseline native run',select('analysis_baseline',retainedOptions(complete.map(r=>[r.id,runTitle(r.id)]),f.baseline,'Retained run (not complete or available)'),f.baseline),'',true)+
      '<fieldset class="full"><legend>Land-cover alternatives</legend><div id="water-alternatives"></div></fieldset>'+
      field('Quantity domain',select('analysis_scope',[['reporting','Reporting area'],['model_domain','Full modeled domain']],f.scope),'Reporting uses delivered mass rasters. Full domain uses original native output and its recorded pixel area.',true)+
      accountingFormControls()+
      '<details class="full"><summary>Priority weights and normalization</summary><p>Original weights, caps and reference are retained. Blank new settings use the native defaults for available quantities.</p>'+
      field('Explicit weights',area('analysis_weights',f.weights,'rows="3" spellcheck="false"'),'JSON names original pollutant keys.',true)+
      field('Explicit normalization',area('analysis_normalization',f.normalization,'rows="4" spellcheck="false"'),'Explicit caps retain their original physical mass-per-pixel basis.',true)+'</details>'+
      draftTools(seed,origin)+'</div>',
      origin?'Save revised analysis':'Start analysis',()=>{
        checkDraft(root,seed,workspace);
        const selection=read();
        if(!complete.some(row=>row.id===selection.baseline_run_id))throw Error('Choose a complete retained baseline native run.');
        for(const id of selection.alternative_run_ids||[])if(!complete.some(row=>row.id===id))
          throw Error('A retained alternative is unavailable or incomplete. Restore its original run or explicitly remove it.');
        return submitAction('receiving.water.analyze',selection);
      },()=>{
        root=formRoot();readAccounting=mountAccountingForm(root,seed.accounting);
        let first=true;
        const update=()=>{
          const selectedIds=first?[...f.alternatives]:checked('analysis_alternatives',root);first=false;
          const baseline=complete.find(r=>r.id===value('analysis_baseline',root));
          const eligible=baseline?complete.filter(r=>r.id!==baseline.id&&r.selection?.grid_id===baseline.selection?.grid_id&&r.selection?.profile_id===baseline.selection?.profile_id&&r.selection?.scenario_id!==baseline.selection?.scenario_id):[];
          const rows=eligible.map(row=>({id:row.id,label:runTitle(row.id),eligible:true}));
          for(const id of selectedIds)if(!rows.some(row=>row.id===id))rows.push({id,label:runTitle(id),eligible:false});
          root.querySelector('#water-alternatives').innerHTML=rows.length?rows.map(row=>'<label class="water-check"><input type="checkbox" name="analysis_alternatives" value="'+esc(row.id)+'"'+(selectedIds.includes(row.id)?' checked':'')+'><span>'+esc(row.label)+(!row.eligible?'<small>Retained selection is unavailable or differs from this baseline. Review it explicitly; it has not been removed.</small>':'')+'</span></label>').join(''):
            '<p class="water-note">'+(baseline?'No completed alternatives share this grid and scientific profile. A baseline-only analysis is available.':'Choose the baseline.')+'</p>';
        };
        root.querySelector('[name="analysis_baseline"]').addEventListener('change',update);update();
        mountDraft(root,seed,read,next=>analyzeForm(next.plan_id||'',next,origin),workspace,origin?.selection||seed);
      });
  }
  async function editSaved(kind,id){
    const workspace=currentWorkspace(),marker=version,request=++studyRequest;
    const view=typeof context.getView==='function'?context.getView():undefined;
    if(!['plan','analysis'].includes(kind)||!/^[0-9a-f]{64}$/.test(id||''))throw Error('Choose the original saved plan or analysis.');
    const row=await api(endpoint('/api/receiving-waters/'+kind,{[kind+'_id']:id}));
    if(workspace!==currentWorkspace()||marker!==version||request!==studyRequest||(view!==undefined&&view!==context.getView?.()))
      throw Error('The workspace or Receiving view changed. Choose the saved study again.');
    if(row.id!==id||row.schema!=='upstate.receiving-water-'+kind+'/v1'||row.state!=='complete')
      throw Error('Open the complete original receiving-water study before revising it.');
    const seed=selectionObject(row.identity?.selection,'Original saved selection'),origin={kind,id,selection:copySelection(seed)};
    return kind==='plan'?planForm(seed,origin):analyzeForm(seed.plan_id||'',seed,origin);
  }
  const agencyProfiles=[
    ['scdes_classified_waters','SCDES classified waters'],
    ['scdes_classified_streams','SCDES classified streams (SCHydroClass)'],
    ['scdes_surface_intakes','SCDES surface-water intakes'],
    ['scdes_source_water_areas','SCDES source-water protection areas'],
    ['scdes_protection_zones','SCDES protection zones']
  ];
  function allSourceRows(){
    return (data().sources||[]).flatMap(collection=>(collection.entries||[]).map(entry=>[JSON.stringify({source_collection_id:collection.id,source_id:entry.id}),entry.title+' / '+collection.title]));
  }
  function catalogSourceRow(index){
    return '<fieldset class="full water-catalog-source" data-water-catalog-source><legend>Published source '+index+'</legend><div class="form-grid">'+
      field('Agency source profile',select('catalog_profile',catalog?.compiler_profiles?.length?catalog.compiler_profiles.map(row=>[row.id,row.title||human(row.id)]):agencyProfiles),'',true)+
      field('Original vector source',sourceSelector('catalog_source'),'',true)+
      field('Original layer metadata source',select('catalog_metadata_source',allSourceRows(),'','','Use embedded metadata or metadata JSON below'),'Choose the imported ArcGIS metadata record when available.',true)+
      field('Designation status',select('catalog_status',[['effective','Effective'],['proposed','Proposed'],['historical','Historical'],['unknown','Unresolved in this source']]),'Status belongs to this source edition, with its original authority evidence.')+
      field('Effective from',input('catalog_effective_from','','type="date"'),'Optional original effective date.')+
      field('Effective until (exclusive)',input('catalog_effective_to','','type="date"'),'The source is historical on this date; leave blank when the source has no stated end date.')+
      field('Authority evidence URLs',area('catalog_evidence','','required rows="2"'),'One original rule, agency publication, or layer metadata URL per line.',true)+
      field('Selected designation classes',input('catalog_classes'),'Required for classified waters. Enter designation codes separated by commas, such as ORW, ONRW, TPGT.',true)+
      field('Class selection rationale',area('catalog_rationale','','rows="2"'),'Explain the selected classified-water scope.',true)+
      '<details class="full"><summary>Original layer and record selection</summary>'+
      field('Source layer',input('catalog_layer'),'Optional exact layer name.',true)+
      field('Native feature IDs',input('catalog_feature_ids'),'Optional comma-separated native feature IDs.',true)+
      field('Exact source attribute filter',area('catalog_where','{}','rows="2" spellcheck="false"'),'Exact original field names and values.',true)+
      field('Original ArcGIS layer metadata',area('catalog_metadata','','rows="6" spellcheck="false"'),'Use the complete original metadata JSON when it is not already stored with the source.',true)+
      field('Explicit field mapping',area('catalog_field_map','','rows="3" spellcheck="false"'),'Optional mapping of object_id, classification, name, description, status, system_id and intake_id to original field names.',true)+
      field('Original status filter',area('catalog_status_filter','','rows="3" spellcheck="false"'),'Optional {"field":"original status field","include":["original value"]}.',true)+
      field('Per-record source interpretation',area('catalog_record_overrides','','rows="4" spellcheck="false"'),'Optional exact object-ID keyed overrides retained in the catalog.',true)+
      '</details></div><div class="water-actions">'+control('water-catalog-source-remove','Remove source')+'</div></fieldset>';
  }
  async function catalogForm(){
    await loadCatalog();nextCatalogSource=1;
    if(!vectorSources().length)throw Error('Import the original agency water vector sources first.');
    openForm('Choose published receiving waters','Select the original water features, authority evidence, and designation edition. The catalog retains every source record and prepares the selected effective or proposed plan.',
      '<div class="form-grid">'+field('As-of date',input('catalog_as_of',safeDate(),'required type="date"'))+
      field('Plan to prepare',select('catalog_prepare',[['effective','Effective designations'],['proposed','Proposed designations']],'effective'))+
      field('Original catchment network',sourceSelector('catalog_catchments','',false),'Select the original HUC / ToHUC vector source for surface-water upstream relationships.',true)+
      field('Catchment ID field',input('catalog_huc_field','huc12'))+field('Downstream HUC field',input('catalog_tohuc_field','tohuc'))+
      '<div class="full" id="water-catalog-sources">'+catalogSourceRow(1)+'</div><div class="water-actions full">'+control('water-catalog-source-add','Add published source')+control('water-catalog-json','Load a prepared selection')+'</div></div>',
      'Compile and prepare source plan',()=>{
        const sources=[...formRoot().querySelectorAll('[data-water-catalog-source]')].map(root=>{
          const profile=value('catalog_profile',root),source=sourceChoice('catalog_source',root);
          const layer=value('catalog_layer',root);if(layer)source.layer=layer;
          const where=jsonObject(value('catalog_where',root)||'{}','Source attribute selection');if(Object.keys(where).length)source.where=where;
          const ids=value('catalog_feature_ids',root).split(',').map(x=>x.trim()).filter(Boolean);if(ids.length)source.feature_ids=ids;
          const urls=value('catalog_evidence',root).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
          if(!urls.length||urls.some(url=>!/^https?:\/\//i.test(url)))throw Error('Enter original HTTP or HTTPS authority evidence URLs for each source.');
          const vintage={status:value('catalog_status',root),evidence:urls.map(url=>({url}))};
          for(const key of ['effective_from','effective_to'])if(value('catalog_'+key,root))vintage[key]=value('catalog_'+key,root);
          const selection={profile,source,vintage};
          const metadataSource=sourceChoice('catalog_metadata_source',root,false);if(metadataSource)selection.layer_metadata_source=metadataSource;
          for(const key of ['metadata','field_map','status_filter','record_overrides'])if(value('catalog_'+key,root))selection[key==='metadata'?'layer_metadata':key]=jsonObject(value('catalog_'+key,root),human(key));
          const profileSpec=catalog?.compiler_profiles?.find(row=>row.id===profile);
          if(profileSpec?.kind==='classified_water'||profileSpec?.required_fields?.includes('classification')||['scdes_classified_waters','scdes_classified_streams'].includes(profile)){
            selection.include_classes=value('catalog_classes',root).split(',').map(x=>x.trim()).filter(Boolean);
            selection.selection_rationale=value('catalog_rationale',root);
            if(!selection.include_classes.length||!selection.selection_rationale)throw Error('Choose the classified-water designations and explain their selection.');
          }
          return selection;
        });
        if(!sources.length)throw Error('Choose at least one original published water source.');
        const selection={schema:'upstate.receiving-water-selection/1',as_of:value('catalog_as_of'),sources};
        const catchments=sourceChoice('catalog_catchments',formRoot(),false);if(catchments)selection.catchments={...catchments,id_field:value('catalog_huc_field'),downstream_field:value('catalog_tohuc_field')};
        return submitAction('receiving.water.catalog',{selection,prepare_vintage:value('catalog_prepare')});
      });
  }
  function catalogView(row){
    const compiled=row.catalog||{},summaries=compiled.source_selections||[];
    const linked=Object.entries(row.prepared_plan_ids||{}).map(([vintage,id])=>control('water-open','Open '+vintage+' plan','data-kind="plan" data-id="'+esc(id)+'"')).join('');
    return '<header class="water-section-heading"><div><p class="eyebrow">PUBLISHED-WATER CATALOG</p><h2>'+esc(row.title||'Receiving-water source catalog')+'</h2><p>As of '+esc(row.as_of||compiled.as_of||'')+' · '+fmt(row.record_count??compiled.summary?.records)+' original records · '+fmt(row.selected_count??compiled.summary?.selected)+' selected waters</p></div><div class="water-actions">'+linked+'</div></header>'+
      (row.error?'<p class="water-error">'+esc(row.error.message||pretty(row.error))+'</p>':'')+
      '<div class="water-filters">'+field('Search original records',input('catalog_search',display.catalogSearch||'','data-water-catalog-search placeholder="Name, class, or source"'))+
      field('Selection',select('catalog_filter',[['selected','Selected waters'],['unselected','Other original records']],display.catalogFilter||'','data-water-filter="catalogFilter"','All records'))+'</div>'+
      '<div id="water-catalog-table"></div><details><summary>Source fields, original class counts, and vintage selection</summary><pre class="json-view">'+esc(pretty(summaries))+'</pre></details>'+
      downloadsView('Catalog and source-plan downloads');
  }
  function updateCatalog(){
    const target=host?.querySelector('#water-catalog-table');if(!target||selected?.kind!=='designation-catalog'||!record)return;
    const all=record.catalog?.records||[];
    const rows=matchesRows(all,display.catalogSearch,r=>!display.catalogFilter||(display.catalogFilter==='selected')===Boolean(r.selected),true);
    const pageSize=75,maxPage=Math.max(0,Math.ceil(rows.length/pageSize)-1);display.catalogPage=Math.min(display.catalogPage||0,maxPage);
    const page=rows.slice(display.catalogPage*pageSize,(display.catalogPage+1)*pageSize);
    target.innerHTML='<div class="water-section-heading"><p>'+fmt(rows.length)+' matching records · page '+fmt(display.catalogPage+1)+' of '+fmt(maxPage+1)+'</p><div class="water-actions">'+control('water-catalog-prev','Previous',display.catalogPage===0?'disabled':'')+control('water-catalog-next','Next',display.catalogPage===maxPage?'disabled':'')+'</div></div>'+
      table(['Record','Source class','Designation edition','Selection',''],page.map(r=>'<tr><td><strong>'+esc(r.title||r.name||r.id||'Original record')+'</strong><small>'+esc(r.id||'')+'</small></td><td>'+esc(r.classification?.source_classification?.designation||r.classification?.original_class||'')+'</td><td>'+esc(r.classification?.vintage?.selection_status||r.vintage?.selection_status||'')+'</td><td>'+esc(r.selected?'Selected':'Retained source record')+'</td><td>'+control('water-catalog-record','Details','data-index="'+all.indexOf(r)+'"')+'</td></tr>'));
  }

  async function catalogJsonForm(initialSelection=null,settings={}){
    const c=await loadCatalog();
    const initial=initialSelection===null?{schema:'upstate.receiving-water-selection/1',as_of:safeDate(),sources:[]}:jsonObject(pretty(initialSelection),'Catalog selection');
    const vintage=settings.prepare_vintage||'effective';
    if(!['effective','proposed'].includes(vintage))throw Error('Choose an effective or proposed source plan.');
    openForm('Choose published receiving waters','Compile the original agency records and keep effective and proposed designations in separate source plans.',
      '<div class="form-grid">'+field('Catalog selection JSON','<input name="catalog_file" type="file" accept=".json,application/json">','Choose a prepared agency source selection, or edit the original selection below.',true)+
      field('Prepared selection',area('catalog_selection',pretty(initial), 'required rows="16" spellcheck="false"'),'Use retained source collection and source IDs. Source profile definitions and imported sources appear below.',true)+
      field('Plan to prepare',select('catalog_vintage',[['effective','Effective designations'],['proposed','Proposed designations']],vintage),'The catalog preserves both designations; choose the plan to use for this operation.',true)+
      '<details class="full"><summary>Source profiles and original vector sources</summary><pre class="json-view">'+esc(pretty({profiles:c.compiler_profiles||[],sources:vectorSources(c).map(s=>({title:s.title,source:JSON.parse(s.key),vintage:s.entry.vintage,uri:s.entry.uri}))}))+'</pre></details></div>',
      'Compile and prepare source plan',()=>submitAction('receiving.water.catalog',{selection:jsonObject(value('catalog_selection'),'Catalog selection'),prepare_vintage:value('catalog_vintage')}),
      ()=>{formRoot().querySelector('[name="catalog_file"]').addEventListener('change',async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>4*1024*1024)throw Error('Choose a selection smaller than 4 MiB.');const text=await f.text();jsonObject(text,'Catalog selection');formRoot().querySelector('[name="catalog_selection"]').value=text;}catch(error){toast(error.message);}});});
  }
  async function openSaved(kind,value){
    if(value?.workspace_key!==undefined&&value.workspace_key!==currentWorkspace())throw Error('Open this saved receiving-water study in its original workspace.');
    switchWorkspace();
    const id=typeof value==='string'?value:value?.id;
    if(!['plan','analysis','designation-catalog'].includes(kind)||!/^[0-9a-f]{64}$/.test(id||''))throw Error('Choose a saved receiving-water record.');
    selected={kind,id};record=null;resetPages();remember();
    if(typeof context.navigate==='function')context.navigate('receiving-waters');
    else if(location.hash!=='#receiving-waters')location.hash='receiving-waters';
    if(host)await loadSelection();
    return {kind,id};
  }
  async function planJsonForm(initialSelection){
    await loadCatalog();
    const initial=jsonObject(pretty(initialSelection),'Receiving-water plan');
    if(!Array.isArray(initial.receptors)||!initial.receptors.length)throw Error('A source plan must contain at least one original receiving-water selection.');
    openForm('Prepare the selected receiving waters','Review the exact original source selection from the designation or source-review desk. Saving uses the existing receiving-water engine and preserves its original source references.',
      '<div class="form-grid">'+
      field('Source plan selection',area('receiving_plan_selection',pretty(initial),'required rows="18" spellcheck="false"'),'Original source IDs, feature filters, rule context, and contribution relationships remain editable before submission.',true)+
      '</div>','Prepare source plan',()=>submitAction('receiving.water.plan',jsonObject(value('receiving_plan_selection'),'Receiving-water plan')));
  }
  async function openDeliveryForAnalysis(value){
    if(typeof context.openDelivery!=='function')throw Error('Open Maps and delivery and choose this completed receiving-water analysis.');
    const id=typeof value==='string'?value:value?.id;
    if(!/^[0-9a-f]{64}$/.test(id||''))throw Error('Choose a saved receiving-water analysis.');
    const workspace=currentWorkspace();
    const row=await api(endpoint('/api/receiving-waters/analysis',{analysis_id:id}));
    if(workspace!==currentWorkspace())throw Error('The workspace changed. Open the analysis in the selected workspace.');
    if(row.state!=='complete')throw Error('Complete the receiving-water analysis before adding it to a delivery.');
    if(!Object.keys(pollutants).every(key=>measurementKeys(row).includes(key)))throw Error('The complete seven-map delivery needs nitrogen, phosphorus, and sediment from the same native cohort. Choose a receiving-water analysis containing all three quantities.');
    return context.openDelivery({
      baseline_run_id:row.baseline_run_id,scenario_run_ids:[...(row.alternative_run_ids||[])],
      receiving_waters:{analysis_id:row.id}
    });
  }
  async function resumeAnalysis(id){
    const workspace=currentWorkspace(),row=await api(endpoint('/api/receiving-waters/analysis',{analysis_id:id}));
    if(workspace!==currentWorkspace())return;
    const selection=row.identity?.selection;if(!selection)throw Error('The original analysis selection is missing.');
    return submitAction('receiving.water.analyze',selection);
  }
  function taskActions(task){
    const item=task._receiving_water;
    const transfer=item&&task.state==='complete'&&task.workspace===currentWorkspace()?
      studyControl(item.kind,{id:item.id,state:'complete'},task.workspace):'';
    return report.taskActions(task)+(item?'<div class="water-actions">'+control('water-task-result','Open '+item.kind,'data-kind="'+esc(item.kind)+'" data-id="'+esc(item.id)+'"')+transfer+'</div>':'');
  }
  async function inspectDeliveryPlan(id){
    if(!/^[0-9a-f]{64}$/.test(id||''))throw Error('Choose the original prepared receiving-water plan.');
    const workspace=currentWorkspace(),draft=formRoot();
    const row=await api(endpoint('/api/receiving-waters/plan',{plan_id:id}));
    if(workspace!==currentWorkspace()||draft!==formRoot())throw Error('Return to the original delivery draft before inspecting its prepared plan.');
    if(row.id!==id||row.state!=='complete')throw Error('Open the completed original source plan.');
    const body='<p>Your current delivery draft remains open. These are the original prepared source geometries and relationships; native model quantities are calculated by the selected analysis.</p>'+
      '<p>Original plan: <code>'+esc(row.id)+'</code></p>'+
      table(['Receiving water','Family','Original relationship','Prepared contribution area (ha)','Original source'],
        (row.receptors||[]).map(r=>'<tr><td>'+esc(r.title||r.id)+'<small>'+esc(r.id)+'</small></td>'+
          '<td>'+esc(families[r.family]||human(r.family))+'</td><td>'+esc(r.relationship_precision||human(r.relation?.method))+'</td>'+
          '<td>'+fmt(r.contribution_area_ha)+'</td><td>'+esc(sourceTitle(r.source))+'</td></tr>'))+
      '<details><summary>Original source choices</summary><pre class="json-view">'+esc(pretty(row.identity?.selection||row.selection))+'</pre></details>'+
      '<details><summary>Original plan and geometry files</summary>'+fileList(row._downloads||[])+'</details>';
    return detail(row.title||'Original prepared receiving-water plan',body,{kind:'receiving-water-plan',id});
  }
  function deliveryFields(selection={}){
    const rows=analyses().filter(x=>x.state==='complete').map(x=>[x.id,x.title+' / '+runTitle(x.baseline_run_id)]);
    const original=selection.receiving_waters||{},planId=original.plan_id;
    const prepared=planId?plans().find(row=>row.id===planId):null;
    const retainedPlan=planId?
      '<div class="full">'+
      field('Retained prepared plan','<input type="checkbox" name="receiving_water_keep_plan" value="1" checked> Keep '+esc(prepared?.title||planId),
        'A selected completed analysis replaces this plan. Leave the completed-analysis choice empty to keep the plan, or clear this checkbox to detach it.',true)+
      input('receiving_water_seed_workspace',currentWorkspace()||'','type="hidden"')+
      '<p>Original plan ID: <code>'+esc(planId)+'</code>. Scope: '+esc(original.quantity_scope||'reporting')+
      '. The original receiving-water engine calculates this plan on the chosen native cohort during delivery. Overlapping land is counted once in each native family union.</p>'+
      control('water-open-prepared-plan','Inspect original prepared plan','data-id="'+esc(planId)+'"')+
      '<details class="technical"><summary>Original prepared-plan settings</summary><pre class="json-view">'+esc(pretty(original))+'</pre></details></div>':'';
    return '<fieldset class="full"><legend>Receiving-water contribution maps</legend>'+retainedPlan+
      field('Completed water analysis',select('receiving_water_analysis',rows,original.analysis_id||'','','Choose a completed analysis'),
        'The analysis must use this delivery baseline and the same alternatives. Its two family maps, per-water quantities, and source boundaries enter the delivery.'+(planId?' Choosing an analysis supersedes the retained prepared plan.':''),true)+'</fieldset>';
  }
  function deliverySelection(selection,initialSelection={}){
    const id=value('receiving_water_analysis');
    if(id){
      const row=analyses().find(x=>x.id===id),alternatives=selection.scenario_run_ids||[];
      if(!row||row.state!=='complete'||row.baseline_run_id!==selection.baseline_run_id||[...(row.alternative_run_ids||[])].sort().join(',')!==[...alternatives].sort().join(','))throw Error('Choose a receiving-water analysis with the same completed baseline and alternatives as this delivery.');
      return {receiving_waters:{analysis_id:id}};
    }
    const original=initialSelection.receiving_waters,keep=formRoot()?.querySelector('[name="receiving_water_keep_plan"]')?.checked;
    if(!keep)return {};
    if(value('receiving_water_seed_workspace')!==(currentWorkspace()||''))throw Error('Open the retained prepared-plan selection in its original workspace before delivery.');
    if(!original||!/^[0-9a-f]{64}$/.test(original.plan_id||''))throw Error('Keep the original prepared receiving-water plan ID with this delivery.');
    if(original.quantity_scope!==undefined&&!['reporting','model_domain'].includes(original.quantity_scope))throw Error('Keep the original reporting or model-domain quantity scope.');
    const selected=JSON.parse(JSON.stringify(original));
    if(['analysis_id','plan','receptor_spec'].some(name=>selected[name]!==undefined))throw Error('Choose one original prepared plan or one completed receiving-water analysis.');
    return {receiving_waters:selected};
  }
  async function dispatch(button){
    const action=button.dataset.action,id=button.dataset.id;
    if(action?.startsWith('water-report-'))return report.dispatch(button);
    if(action?.startsWith('water-monitoring-'))return monitoring.dispatch(button);
    if(action==='water-task-result'&&button.dataset.kind==='monitoring')return monitoring.open(id);
    if(action==='water-open')return openSelection(button.dataset.kind,id);
    if(action==='water-study-transfer')return transferStudy({kind:button.dataset.kind,id,workspace_key:button.dataset.workspace});
    if(action==='water-revise')return editSaved(button.dataset.kind,id);
    if(action==='water-open-prepared-plan')return inspectDeliveryPlan(id);
    if(action==='water-page'){
      const key=button.dataset.pageKey;if(!['page','downloadPage'].includes(key))throw Error('Choose a supported receiving-water page.');
      const direction=Number(button.dataset.direction);if(![-1,1].includes(direction))throw Error('Choose the previous or next page.');
      display[key]=Math.max(0,(display[key]||0)+direction);
      if(key==='downloadPage')updateDownloads();else updateResults();return;
    }
    if(action==='water-task-result'){selected={kind:button.dataset.kind,id};record=null;resetPages();remember();document.querySelector('#detail-dialog')?.close();if(location.hash==='#receiving-waters')return loadSelection();location.hash='receiving-waters';return;}
    if(action==='water-task')return showTask(id);
    if(action==='water-subject')return subjectDetails(id,button.dataset.subjectKind);
    if(action==='water-accounting-detail')return accountingDetails(id);
    if(action==='water-profile-new')return profileForm();
    if(action==='water-plan-new')return planForm();
    if(action==='water-catalog-new')return catalogForm();
    if(action==='water-catalog-json')return catalogJsonForm();
    if(action==='water-catalog-source-add'){const list=formRoot().querySelector('#water-catalog-sources');if(list)list.insertAdjacentHTML('beforeend',catalogSourceRow(++nextCatalogSource));return;}
    if(action==='water-catalog-source-remove'){button.closest('[data-water-catalog-source]')?.remove();return;}
    if(action==='water-catalog-prev'){display.catalogPage=Math.max(0,(display.catalogPage||0)-1);updateCatalog();return;}
    if(action==='water-catalog-next'){display.catalogPage=(display.catalogPage||0)+1;updateCatalog();return;}
    if(action==='water-catalog-record'){const r=record?.catalog?.records?.[Number(button.dataset.index)];if(r)detail(r.title||r.name||'Original receiving-water record','<pre class="json-view">'+esc(pretty(r))+'</pre>',{kind:'receiving-water-catalog-record'});return;}
    if(action==='water-analyze-new')return analyzeForm(button.dataset.planId||'');
    if(action==='water-analysis-resume')return resumeAnalysis(id);
    if(action==='water-reload')return loadSelection();
    if(action==='water-delivery')return openDeliveryForAnalysis(id);
    if(action==='water-source-inspect')return inspectSource(button);
    if(action==='water-receptor-add'){if(!formRoot()?.receivingPlanEditor)throw Error('Reopen the source-plan form.');formRoot().receivingPlanEditor.add();return;}
    if(action==='water-receptor-remove'){if(!formRoot()?.receivingPlanEditor)throw Error('Reopen the source-plan form.');formRoot().receivingPlanEditor.remove(button.closest('[data-water-receptor]'));return;}
    throw Error('Choose a supported receiving-water operation.');
  }
  return {render,mount,detach,dispatch,taskActions,deliveryFields,deliverySelection,
    openPlan:value=>openSaved('plan',value),
    openAnalysis:value=>openSaved('analysis',value),
    openCatalog:value=>openSaved('designation-catalog',value),
    createCatalog:catalogJsonForm,createPlan:planJsonForm,
    analyze:analyzeForm,openDelivery:openDeliveryForAnalysis,openStudyTransfer:transferStudy};
}
