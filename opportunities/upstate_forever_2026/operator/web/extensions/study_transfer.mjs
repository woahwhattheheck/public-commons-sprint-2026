import {attachReceivedStudies,receivedFieldworkPreview} from '../received_studies.mjs';
/** Selected editable scientific-study transfer in the original operator.
 * TokenJunkieLabs. Uses the original task queue, downloads and receiving form.
 */
const ROOTS = [
  ['experiment-diagnostics', 'Scientific analyses'],
  ['experiments', 'Experiment programmes'],
  ['runs', 'Native runs'],
  ['robust-decisions', 'Decision studies'],
  ['scientific-report-editions', 'Saved scientific reports'],
  ['reviews', 'Customer reviews'],
  ['receiving-water-plans', 'Receiving-water source plans'],
  ['receiving-water-analyses', 'Receiving-water analyses'],
  ['community-tables', 'Community source tables'],
  ['community-plans', 'Editable Community plans'],
  ['community-reports', 'Saved Community reports'],
  ['community-plan-comparisons', 'Community revision handovers'],
  ['conservation', 'Conservation study'],
  ['conservation-plans', 'Conservation portfolio'],
  ['conservation-exports', 'Conservation decision packet'],
  ['conservation-report-sources', 'Conservation report source'],
  ['receptor-networks', 'Original watershed networks'],
  ['receptor-scenario-areas', 'Prepared source-water areas'],
  ['receptor-programmes', 'Source-water native programmes'],
  ['receptor-experiments', 'Source-water experiment comparisons'],
  ['receptor-inventories', 'Native receiving-area inventories'],
  ['receptor-report-sources', 'Source geography report sources'],
  ['monitoring_networks', 'Monitoring networks'],
  ['monitoring_plans', 'Monitoring designs'],
  ['monitoring_frontiers', 'Monitoring budget frontiers'],
  ['monitoring_frontier_comparisons', 'Saved Monitoring budget choices'],
  ['monitoring_heads', 'Monitoring campaigns'],
  ['monitoring_observed_contexts', 'Monitoring observational context']
];
const rootLabels = Object.fromEntries(ROOTS);
const sourceWaterKinds = Object.freeze({
  'receptor-networks':'network', 'receptor-scenario-areas':'source-areas',
  'receptor-programmes':'programme', 'receptor-experiments':'comparison',
  'receptor-inventories':'inventory', 'receptor-report-sources':'report-source'
});

const monitoringOpenKinds=new Set(['monitoring_networks','monitoring_plans','monitoring_heads','monitoring_observed_contexts']);
const phases = {
  queued:'Queued', running:'Working', resolving:'Reading study dependencies',
  staging:'Preparing original study files', decisions:'Saving decision history', investigations:'Saving investigation history',
  archiving:'Writing and verifying archive',
  publishing:'Saving archive', complete:'Ready', failed:'Needs attention',
  interrupted:'Interrupted', cancelled:'Cancelled'
};
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const keyOf = row => row.kind + ':' + row.id;
const bytes = value => {
  if (!Number.isFinite(value)) return '—';
  const units=['B','KiB','MiB','GiB','TiB']; let n=value,index=0;
  while(n>=1024&&index<units.length-1){n/=1024;index++;}
  return new Intl.NumberFormat(undefined,{maximumFractionDigits:index?1:0}).format(n)+' '+units[index];
};
const number = value => new Intl.NumberFormat().format(value || 0);
const when = value => {
  if (!value) return '';
  const date=new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};
const button = (action,label,extra='') =>
  '<button type="button" data-study-action="'+action+'" '+extra+'>'+escapeHTML(label)+'</button>';

export function attachStudyTransfer(host) {
  if (typeof host?.api!=='function'||typeof host?.getState!=='function') {
    throw new TypeError('The study desk needs the original operator API and workspace state.');
  }
  let root=null,workspace=null,epoch=0,searchTimer=null,exportTimer=null;
  const received=attachReceivedStudies({...host,getWorkspace:()=>host.getWorkspace?.()??host.getState()?.workspace_key});
  let catalogue={items:[],total:0,offset:0,limit:200,next_offset:null};
  let exportsPage={items:[],total:0,offset:0,limit:50,next_offset:null};
  let selected=new Map(),title='Selected scientific study',kind='',query='',selectedOnly=false,offset=0;
  let related=true,plan=null,planSignature=null,busy=false,catalogueBusy=false,exportBusy=false;
  let taskSignature='',lastError='',requestSerial=0,receivingRequest=0,sourceWaterRequest=0;
  let pendingSubmission=null;
  let transferHandler=typeof host.openStudyTransfer==='function'?host.openStudyTransfer:
    typeof host.openExtension==='function'?
      selection=>host.openExtension('project-transfer','openForStudy',selection):null;
  const requests=new Set();
  const workspaceNow=()=>host.getWorkspace?.()??host.getState()?.workspace_key??null;
  const current=stamp=>root&&stamp.epoch===epoch&&stamp.workspace===workspace&&workspace===workspaceNow();
  const stamp=()=>({epoch,workspace});
  const selection=()=>({
    schema:'upstate.study-selection/v1',title:title.trim()||'Selected scientific study',
    roots:[...selected.values()].map(({kind,id})=>({kind,id}))
      .sort((a,b)=>keyOf(a).localeCompare(keyOf(b))),
    include_related_results:related
  });
  const signature=()=>JSON.stringify(selection());
  const endpoint=(path,values={})=>path+'?'+new URLSearchParams({workspace,...values});
  const notice=(message,error=false)=>{
    if(!root)return;
    const node=root.querySelector('[data-study-notice]');
    node.textContent=message||'';
    node.classList.toggle('is-error',error);
    node.hidden=!message;
  };
  const fail=error=>{
    if(error?.name==='AbortError')return;
    lastError=error?.message||String(error);
    notice(lastError,true);
  };

  async function request(path,options={}) {
    const controller=new AbortController();requests.add(controller);
    try{return await host.api(path,{...options,signal:controller.signal});}
    finally{requests.delete(controller);}
  }

  function skeleton() {
    root.innerHTML=
      '<header class="st-heading"><div><p class="st-eyebrow">Scientific workspace</p>'+
      '<h2>Transfer a scientific study</h2>'+
      '<p>Choose saved scientific reports, studies and customer reviews. The receiving workspace keeps original source editions, results and editable study history.</p>'+
      '</div><button type="button" data-action="restore">Receive study archive</button></header>'+
      '<div class="st-notice" data-study-notice role="status" aria-live="polite" hidden></div>'+
      '<section class="st-panel"><div class="st-panel-heading"><h3>Choose studies</h3>'+
      button('reload','Refresh studies')+'</div>'+
      '<div class="st-filters"><label><span>Study type</span><select data-study-field="kind"><option value="">All study types</option>'+
      ROOTS.map(([id,label])=>'<option value="'+id+'">'+label+'</option>').join('')+'</select></label>'+
      '<label class="st-search"><span>Search titles or original identities</span><input type="search" data-study-field="query" autocomplete="off"></label>'+
      '<label class="st-check"><input type="checkbox" data-study-field="selected-only"><span>Show selected studies</span></label></div>'+
      '<div class="st-selection-bar"><span data-study-selection-count></span><div>'+
      button('select-page','Select this page')+button('clear-page','Clear this page')+button('clear-all','Clear selection')+
      '</div></div><div data-study-catalogue></div><div class="st-pagination" data-study-pages></div></section>'+
      '<section class="st-panel"><div class="st-panel-heading"><h3>Study contents</h3></div>'+
      '<div class="st-export-fields"><label><span>Archive title</span><input type="text" data-study-field="title" maxlength="240"></label>'+
      '<label class="st-check"><input type="checkbox" data-study-field="related"><span>Include saved comparisons for the selected cohort</span></label></div>'+
      '<p class="st-description">Shared source editions and prepared grids are included once. Saved reports keep their original source order and files, with recorded local scientific and planning history for further work.</p>'+
      '<div class="st-actions">'+button('preview','Preview contents')+button('export','Export editable study','class="st-primary"')+'</div>'+
      '<div data-study-plan></div></section>'+
      '<section class="st-panel"><div class="st-panel-heading"><h3>Study archives</h3>'+
      button('refresh-exports','Refresh exports')+'</div><div data-study-exports></div>'+
      '<div class="st-pagination" data-study-export-pages></div></section>'+
      '<section class="st-panel" data-study-received></section>';
    root.querySelector('[data-study-field="kind"]').value=kind;
    root.querySelector('[data-study-field="query"]').value=query;
    root.querySelector('[data-study-field="title"]').value=title;
    root.querySelector('[data-study-field="related"]').checked=related;
    root.querySelector('[data-study-field="selected-only"]').checked=selectedOnly;
    root.addEventListener('click',onClick);
    root.addEventListener('change',onChange);
    root.addEventListener('input',onInput);
    renderCatalogue();renderPlan();renderExports();
  }

  function visibleSelected() {
    let rows=[...selected.values()].filter(row=>(!kind||row.kind===kind)&&
      (!query||JSON.stringify(row).toLocaleLowerCase().includes(query.toLocaleLowerCase())));
    rows.sort((a,b)=>(a.title||a.id).localeCompare(b.title||b.id));
    return rows;
  }

  function visiblePage() {
    if(!selectedOnly)return catalogue;
    const rows=visibleSelected(),items=rows.slice(offset,offset+200),next=offset+items.length;
    return {items,total:rows.length,offset,limit:200,next_offset:next<rows.length?next:null};
  }

  function controls() {
    if(!root)return;
    root.querySelector('[data-study-selection-count]').textContent=number(selected.size)+' selected';
    for(const action of ['preview','export'])root.querySelector('[data-study-action="'+action+'"]').disabled=
      !selected.size||busy;
    for(const action of ['select-page','clear-page'])root.querySelector('[data-study-action="'+action+'"]').disabled=
      busy||catalogueBusy||!visiblePage().items.length;
    root.querySelector('[data-study-action="clear-all"]').disabled=!selected.size||busy;
    root.querySelector('[data-study-action="export"]').textContent=busy==='export'?'Preparing export…':'Export editable study';
    root.querySelector('[data-study-action="preview"]').textContent=busy==='preview'?'Reading contents…':'Preview contents';
    for(const field of root.querySelectorAll('[data-study-field]'))field.disabled=Boolean(busy);
    for(const field of root.querySelectorAll('[data-study-root]'))field.disabled=Boolean(busy)||field.dataset.studyUnavailable==='true';
    for(const field of root.querySelectorAll('[data-study-action="open-monitoring"]'))field.disabled=Boolean(busy);
  }

  function sourceWaterControl(row){
    if(!Object.hasOwn(sourceWaterKinds,row?.kind)||!/^[0-9a-f]{64}$/.test(row?.id||'')||
        row.state==='unreadable'||typeof host.openDesk!=='function')return '';
    return button('open-source-water','Open in Source-water areas','data-study-kind="'+escapeHTML(row.kind)+'" data-study-id="'+escapeHTML(row.id)+'"');
  }
  async function openSourceWater(kind,id){
    if(!Object.hasOwn(sourceWaterKinds,kind)||!/^[0-9a-f]{64}$/.test(id||''))
      throw Error('Choose an original saved source-water study.');
    if(typeof host.openDesk!=='function')throw Error('Open this study in the maintained Source-water areas desk.');
    const available=[...visiblePage().items,...(plan?.nodes||[])].find(row=>row.kind===kind&&row.id===id);
    if(!available||available.state==='unreadable')throw Error('Refresh this saved source-water study before opening it.');
    const captured=stamp(),serial=++sourceWaterRequest,recordKind=sourceWaterKinds[kind];
    let row;
    try{row=await request(endpoint('/api/receptors/'+recordKind,{id,workspace:captured.workspace}));}
    catch(error){if(!current(captured)||serial!==sourceWaterRequest)return null;throw error;}
    if(!current(captured)||serial!==sourceWaterRequest)return null;
    if(row?.id!==id||row?._kind!==recordKind||row?.workspace_key!==captured.workspace)
      throw Error('The source-water reply identifies another original study or workspace.');
    try{return await host.openDesk('receptors','openStudy',{workspace_key:captured.workspace,kind,id});}
    catch(error){if(workspaceNow()!==captured.workspace||serial!==sourceWaterRequest)return null;throw error;}
  }
  function receivingControl(row){
    if(!['receiving-water-plans','receiving-water-analyses'].includes(row?.kind)||
        !/^[0-9a-f]{64}$/.test(row?.id||'')||row.state==='unreadable'||
        (row.state&&row.state!=='complete')||typeof host.openExtension!=='function')return '';
    return button('open-receiving','Open in Receiving waters','data-study-kind="'+escapeHTML(row.kind)+'" data-study-id="'+escapeHTML(row.id)+'"');
  }
  async function openReceiving(kind,id){
    if(!['receiving-water-plans','receiving-water-analyses'].includes(kind)||!/^[0-9a-f]{64}$/.test(id||''))
      throw Error('Choose an original receiving-water study from this workspace.');
    if(typeof host.openExtension!=='function')throw Error('Open the maintained Receiving waters desk.');
    const captured=stamp(),serial=++receivingRequest,recordKind=kind==='receiving-water-plans'?'plan':'analysis';
    const row=await request(endpoint('/api/receiving-waters/'+recordKind,{[recordKind+'_id']:id}));
    if(!current(captured)||serial!==receivingRequest)throw Error('The workspace or Study transfer view changed. Choose the saved study again.');
    if(row.id!==id||row.state!=='complete'||row.schema!=='upstate.receiving-water-'+recordKind+'/v1')
      throw Error('Open a complete original receiving-water study.');
    return host.openExtension('receiving-waters',recordKind==='plan'?'openPlan':'openAnalysis',
      {id:row.id,workspace_key:captured.workspace});
  }
  function renderCatalogue() {
    if(!root)return;
    const page=visiblePage(),body=root.querySelector('[data-study-catalogue]');
    if(catalogueBusy&&!page.items.length){
      body.innerHTML='<p class="st-empty">Reading saved studies…</p>';
    }else if(!page.items.length){
      body.innerHTML='<p class="st-empty">'+(selectedOnly?'No selected studies match this view.':
        'No saved studies match this view. Saved analyses, programmes, native runs and decision studies appear here.')+'</p>';
    }else{
      body.innerHTML='<div class="st-table-scroll"><table class="st-table"><thead><tr>'+
        '<th scope="col"><span class="st-sr">Select</span></th><th scope="col">Study</th>'+
        '<th scope="col">Type</th><th scope="col">State</th><th scope="col">Updated</th></tr></thead><tbody>'+
        page.items.map(row=>{
          const key=keyOf(row),scope=row.models?.map(name=>name.toUpperCase()).join(' + ');
          return '<tr'+(selected.has(key)?' class="st-selected"':'')+'><td>'+
            '<input type="checkbox" data-study-unavailable="'+String(row.state==='unreadable')+'" data-study-root="'+escapeHTML(key)+'" aria-label="Select '+escapeHTML(row.title||row.id)+'" '+
            (selected.has(key)?'checked ':'')+(row.state==='unreadable'?'disabled ':'')+'></td><td>'+
            '<strong>'+escapeHTML(row.title||row.id.slice(0,12))+'</strong>'+
            '<small class="st-identity" title="'+escapeHTML(row.id)+'">'+escapeHTML(row.id.slice(0,16))+'</small>'+
            (scope?'<small>'+escapeHTML(scope)+'</small>':'')+
            (row.error?.message?'<small class="st-row-error">'+escapeHTML(row.error.message)+'</small>':'')+receivingControl(row)+sourceWaterControl(row)+
            (row.state!=='unreadable'&&monitoringOpenKinds.has(row.kind)&&typeof host.openDesk==='function'
              ?button('open-monitoring','Open in Monitoring','data-study-open="'+escapeHTML(key)+'"'):'')+
            '</td><td>'+escapeHTML(rootLabels[row.kind]||row.kind)+'</td>'+
            '<td><span class="st-state">'+escapeHTML(row.state||'Saved')+'</span></td>'+
            '<td>'+escapeHTML(when(row.updated_at))+'</td></tr>';
        }).join('')+'</tbody></table></div>';
    }
    const end=page.offset+page.items.length;
    root.querySelector('[data-study-pages]').innerHTML='<span>'+
      (page.total?number(page.offset+1)+'–'+number(end)+' of '+number(page.total):'0 studies')+'</span><div>'+
      button('previous-page','Previous',page.offset===0?'disabled':'')+
      button('next-page','Next',page.next_offset===null?'disabled':'')+'</div>';
    controls();
  }

  function invalidatePlan() {
    planSignature=null;
    if(plan&&root)root.querySelector('[data-study-plan]').innerHTML=
      '<p class="st-description">The selection changed. Preview contents again or export the current selection.</p>';
    controls();
  }

  function renderPlan() {
    if(!root)return;
    const body=root.querySelector('[data-study-plan]');
    if(!plan){body.innerHTML='';return;}
    const groups=plan.groups.map(row=>'<tr><th scope="row">'+escapeHTML(row.kind==='objects'?'Original source files':row.title)+
      '</th><td>'+number(row.files)+'</td><td>'+bytes(row.bytes)+'</td></tr>').join('');
    let html='<div class="st-totals"><div><strong>'+bytes(plan.bytes)+'</strong><span>Original study data</span></div>'+
      '<div><strong>'+number(plan.files)+'</strong><span>Retained files</span></div>'+
      '<div><strong>'+number(plan.nodes.length)+'</strong><span>Scientific records</span></div></div>'+
      '<p class="st-description">The archive also includes the application source. Its final download size appears after compression.</p>'+
      '<div class="st-table-scroll"><table class="st-table"><thead><tr><th scope="col">Contents</th>'+
      '<th scope="col">Files</th><th scope="col">Uncompressed size</th></tr></thead><tbody>'+groups+'</tbody></table></div>';
    if(plan.scientific_report_editions?.length)html+='<section class="st-details"><h4>Original report order</h4>'+
      plan.scientific_report_editions.map(edition=>'<div><strong>'+escapeHTML(edition.title)+'</strong>'+
        '<ol>'+edition.sources.map(source=>'<li>'+escapeHTML(source.title||source.source_id)+
          '<small class="st-identity">'+escapeHTML(source.source_id)+' · '+escapeHTML(source.body_sha256)+'</small></li>').join('')+
        '</ol></div>').join('')+'</section>';
    if(plan.decision_history?.studies)html+='<p class="st-description">The export also captures '+
      number(plan.decision_history.studies)+' decision studies, '+number(plan.decision_history.revisions)+
      ' saved revisions and '+number(plan.decision_history.calculations)+
      ' calculations in their original editable database. Its captured size is included in the completed archive.</p>';
    if(plan.external_decision_dependencies?.length)html+='<details class="st-details"><summary>'+
      number(plan.external_decision_dependencies.length)+' original-workspace references retained with received decision history</summary>'+
      '<p class="st-description">These decisions were received from another scientific workspace. Their complete revisions, gains and calculation history remain editable here. Open the original workspace for those ecological model runs.</p><ul>'+
      plan.external_decision_dependencies.map(row=>'<li>'+escapeHTML(row.kind)+': '+
        escapeHTML(row.id)+' · revision '+number(row.revision)+' · original workspace '+
        escapeHTML(row.source_workspace_id||'not recorded')+'</li>').join('')+'</ul></details>';
    if(plan.planned_cases||plan.expected_unmaterialized?.length)html+='<p class="st-description">'+
      number(plan.planned_cases)+' programme cases remain available to prepare. '+
      number(plan.expected_unmaterialized?.length)+' declared future records retain their original planned state.</p>';
    html+='<details class="st-details"><summary>Included scientific records</summary>'+
      '<div class="st-table-scroll"><table class="st-table"><thead><tr><th scope="col">Record</th>'+
      '<th scope="col">Type</th><th scope="col">Reason included</th></tr></thead><tbody>'+
      plan.nodes.map(row=>'<tr><td><strong>'+escapeHTML(row.title)+'</strong><small class="st-identity">'+
        escapeHTML(row.id.slice(0,16))+'</small>'+receivingControl(row)+sourceWaterControl(row)+'</td><td>'+escapeHTML(rootLabels[row.kind]||row.kind.replaceAll('-',' '))+
        '</td><td>'+escapeHTML(row.reasons.join('; '))+'</td></tr>').join('')+'</tbody></table></div></details>';
    if(plan.related_result_issues?.length)html+='<details class="st-details"><summary>'+
      number(plan.related_result_issues.length)+' additional comparison records need repair</summary><ul>'+
      plan.related_result_issues.map(row=>'<li>'+escapeHTML(row.path)+': '+escapeHTML(row.message)+'</li>').join('')+'</ul></details>';
    html+=receivedFieldworkPreview(plan.implementation_report_sources);
    body.innerHTML=html;
  }

  async function loadCatalogue() {
    if(!root||!workspace)return;
    if(selectedOnly){catalogueBusy=false;renderCatalogue();return;}
    const captured=stamp(),serial=++requestSerial;
    catalogueBusy=true;renderCatalogue();
    try {
      const value=await request(endpoint('/api/study-transfer/catalog',{kind,query,offset,limit:200}));
      if(!current(captured)||serial!==requestSerial)return;
      catalogue=value;
      for(const row of value.items)if(selected.has(keyOf(row)))selected.set(keyOf(row),row);
      notice('');
    }catch(error){if(current(captured)&&serial===requestSerial)fail(error);}
    finally{if(current(captured)&&serial===requestSerial){catalogueBusy=false;renderCatalogue();}}
  }

  async function previewContents() {
    if(busy||!selected.size)return;
    const captured=stamp(),chosen=selection(),chosenSignature=JSON.stringify(chosen);
    busy='preview';controls();notice('Reading the selected study contents…');
    try {
      const value=await request('/api/study-transfer/preview',{method:'POST',body:{workspace,selection:chosen}});
      if(!current(captured))return;
      if(signature()!==chosenSignature){notice('The selection changed while its contents were read.');return;}
      plan=value;planSignature=chosenSignature;renderPlan();notice('');
    }catch(error){if(current(captured))fail(error);}
    finally{if(current(captured)){busy=false;controls();}}
  }

  function operationID() {
    if(globalThis.crypto?.randomUUID)return 'study-'+globalThis.crypto.randomUUID();
    const values=new Uint32Array(4);
    if(!globalThis.crypto?.getRandomValues)throw new Error('This browser needs its secure random generator to submit an export.');
    globalThis.crypto.getRandomValues(values);
    return 'study-'+[...values].map(x=>x.toString(16).padStart(8,'0')).join('');
  }

  function savePending(value) {
    pendingSubmission=value;
    try{
      const storageKey='upstate-study-transfer-pending:'+workspace;
      if(value)globalThis.sessionStorage?.setItem(storageKey,JSON.stringify(value));
      else globalThis.sessionStorage?.removeItem(storageKey);
    }catch(_){/* The retained queue operation still provides retry identity. */}
  }

  async function exportStudy() {
    if(busy||!selected.size)return;
    const captured=stamp(),chosen=selection(),chosenSignature=JSON.stringify(chosen);
    busy='export';controls();notice('Preparing the selected study export…');
    try {
      let submission=pendingSubmission;
      if(!submission||submission.workspace!==workspace||submission.selectionSignature!==chosenSignature){
        if(planSignature!==chosenSignature){
          const value=await request('/api/study-transfer/preview',{method:'POST',body:{workspace,selection:chosen}});
          if(!current(captured))return;
          plan=value;planSignature=chosenSignature;renderPlan();
        }
        submission={workspace,selectionSignature:chosenSignature,body:{
          workspace,action:'study.export',payload:{...chosen,preview_token:plan.preview_token},
          operation_id:operationID()
        }};
        savePending(submission);
      }
      const task=await request('/api/actions',{method:'POST',body:submission.body});
      if(!current(captured))return;
      savePending(null);
      notice('Export queued: '+chosen.title+'.');
      await loadExports(0);
      if(current(captured)&&typeof host.refreshState==='function')await host.refreshState();
      if(current(captured))scheduleExportRefresh();
      return task;
    }catch(error){
      if(current(captured)){
        if(error?.status>=400&&error.status<500)savePending(null);
        fail(error);
      }
    }finally{if(current(captured)){busy=false;controls();}}
  }

  function exportFile(task) {
    return task?._downloads?.find(file=>typeof file.url==='string'&&/^\/api\/file\/[0-9a-f]{64}$/.test(file.url));
  }

  function renderExports() {
    if(!root)return;
    const body=root.querySelector('[data-study-exports]');
    if(!exportsPage.items.length){
      body.innerHTML='<p class="st-empty">'+(exportBusy?'Reading study archives…':
        'Exported studies appear here with their download and original task.')+'</p>';
    }else{
      body.innerHTML='<div class="st-exports">'+exportsPage.items.map(task=>{
        const info=task._study_transfer||{},progress=task._study_progress||{},file=exportFile(task);
        const phase=task.state==='running'?(progress.phase||task.state):task.state;
        const sourceBytes=task.result?.source_bytes??task.result?.study?.source_bytes;
        let detail=task.state==='complete'?bytes(file?.bytes??task.result?.bytes)+' archive':
          (phases[phase]||phase||'Saved task');
        if(phase==='staging'&&Number.isFinite(progress.copied_files)){
          detail+=' · '+number(progress.copied_files)+' / '+number(progress.files)+' files';
        }
        return '<article class="st-export"><div><h4>'+escapeHTML(info.title||task.payload?.title||'Scientific study')+
          '</h4><p><span class="st-state">'+escapeHTML(phases[task.state]||task.state)+'</span> '+
          escapeHTML(detail)+(Number.isFinite(sourceBytes)?' · '+bytes(sourceBytes)+' original data':'')+
          '</p><small>'+escapeHTML(when(task.created_at))+'</small>'+
          (task.error?.message?'<p class="st-row-error">'+escapeHTML(task.error.message)+'</p>':'')+
          (task.result?.study?.preview_changed?'<p class="st-description">The archive includes the current saved state of the selected studies.</p>':'')+
          '</div><div class="st-export-actions">'+
          (file?'<a class="st-download" href="'+escapeHTML(file.url)+'?download=1" download="'+escapeHTML(file.filename)+'">Download study</a>':'')+
          (file&&transferHandler?button('transfer','Transfer archive','data-study-task="'+escapeHTML(task.id)+'"'):'')+
          button('task','Open export task','data-study-task="'+escapeHTML(task.id)+'"')+
          '</div></article>';
      }).join('')+'</div>';
    }
    root.querySelector('[data-study-export-pages]').innerHTML='<span>'+
      (exportsPage.total?number(exportsPage.offset+1)+'–'+number(exportsPage.offset+exportsPage.items.length)+
      ' of '+number(exportsPage.total)+' exports':'0 exports')+'</span><div>'+
      button('previous-exports','Previous',exportsPage.offset===0?'disabled':'')+
      button('next-exports','Next',exportsPage.next_offset===null?'disabled':'')+'</div>';
  }

  async function loadExports(requestedOffset=exportsPage.offset) {
    if(!root||!workspace||exportBusy)return;
    const captured=stamp();exportBusy=true;
    try {
      const value=await request(endpoint('/api/study-transfer/exports',{offset:requestedOffset,limit:50}));
      if(!current(captured))return;
      exportsPage=value;renderExports();
    }catch(error){if(current(captured))fail(error);}
    finally{
      if(current(captured)){exportBusy=false;renderExports();scheduleExportRefresh();}
    }
  }

  function scheduleExportRefresh() {
    clearTimeout(exportTimer);exportTimer=null;
    if(root&&exportsPage.items.some(task=>['queued','running'].includes(task.state))){
      exportTimer=setTimeout(()=>{if(root)loadExports();},2500);
    }
  }

  function onInput(event) {
    const name=event.target.dataset.studyField;
    if(name==='title'){
      title=event.target.value;invalidatePlan();
    }else if(name==='query'){
      query=event.target.value;offset=0;
      clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadCatalogue(),300);
    }
  }

  function onChange(event) {
    const name=event.target.dataset.studyField;
    if(name==='kind'||name==='selected-only'){
      kind=root.querySelector('[data-study-field="kind"]').value;
      selectedOnly=root.querySelector('[data-study-field="selected-only"]').checked;
      offset=0;loadCatalogue();return;
    }
    if(name==='related'){related=event.target.checked;invalidatePlan();return;}
    const key=event.target.dataset.studyRoot;
    if(!key)return;
    const row=visiblePage().items.find(item=>keyOf(item)===key);
    if(event.target.checked&&row)selected.set(key,row);
    else selected.delete(key);
    if(selectedOnly&&offset>=visibleSelected().length)offset=Math.max(0,Math.floor((visibleSelected().length-1)/200)*200);
    invalidatePlan();renderCatalogue();
  }

  async function onClick(event) {
    const target=event.target.closest('[data-study-action]');
    if(!target||!root.contains(target)||target.disabled)return;
    event.preventDefault();event.stopPropagation();
    const action=target.dataset.studyAction;
    try{
      if(action==='open-source-water'){await openSourceWater(target.dataset.studyKind,target.dataset.studyId);}
      else if(action==='open-receiving'){await openReceiving(target.dataset.studyKind,target.dataset.studyId);}
      else if(action==='open-monitoring'){
        const row=visiblePage().items.find(item=>keyOf(item)===target.dataset.studyOpen);
        if(!row||row.state==='unreadable'||!monitoringOpenKinds.has(row.kind))
          throw new Error('Choose an available saved Monitoring record.');
        if(typeof host.openDesk!=='function')throw new Error('Use the current native Monitoring desk to open this study.');
        await host.openDesk('monitoring','openStudy',{workspace_key:workspace,kind:row.kind,id:row.id});
      }else if(action==='reload'){await loadCatalogue();}
      else if(action==='select-page'){
        for(const row of visiblePage().items)if(row.state!=='unreadable')selected.set(keyOf(row),row);
        invalidatePlan();renderCatalogue();
      }else if(action==='clear-page'){
        for(const row of visiblePage().items)selected.delete(keyOf(row));
        if(selectedOnly)offset=0;
        invalidatePlan();renderCatalogue();
      }else if(action==='clear-all'){
        selected.clear();offset=0;invalidatePlan();renderCatalogue();
      }else if(action==='previous-page'||action==='next-page'){
        const page=visiblePage();
        offset=action==='previous-page'?Math.max(0,page.offset-page.limit):page.next_offset;
        if(offset!==null)await loadCatalogue();
      }else if(action==='preview')await previewContents();
      else if(action==='export')await exportStudy();
      else if(action==='refresh-exports')await loadExports(0);
      else if(action==='previous-exports')await loadExports(Math.max(0,exportsPage.offset-exportsPage.limit));
      else if(action==='next-exports'&&exportsPage.next_offset!==null)await loadExports(exportsPage.next_offset);
      else if(action==='task'&&typeof host.showTask==='function')await host.showTask(target.dataset.studyTask);
      else if(action==='transfer'&&transferHandler){
        const task=exportsPage.items.find(row=>row.id===target.dataset.studyTask),file=exportFile(task);
        if(!task||!file)throw new Error('Reopen this saved archive before transferring it.');
        await transferHandler({workspace_key:workspace,task_id:task.id,
          study_id:task.result?.id,title:task._study_transfer?.title||task.payload?.title,archive:file});
      }
    }catch(error){fail(error);if(!root&&typeof host.toast==='function')host.toast(error.message||String(error));}
  }

  function reset(nextWorkspace) {
    workspace=nextWorkspace;catalogue={items:[],total:0,offset:0,limit:200,next_offset:null};
    exportsPage={items:[],total:0,offset:0,limit:50,next_offset:null};
    selected=new Map();title='Selected scientific study';kind='';query='';selectedOnly=false;offset=0;
    related=true;plan=null;planSignature=null;busy=false;catalogueBusy=false;exportBusy=false;
    taskSignature='';lastError='';
    pendingSubmission=null;
    try{
      const retained=globalThis.sessionStorage?.getItem('upstate-study-transfer-pending:'+workspace);
      if(retained){
        const value=JSON.parse(retained),payload=value?.body?.payload;
        const validRoots=Array.isArray(payload?.roots)&&payload.roots.length&&payload.roots.every(row=>
          Object.hasOwn(rootLabels,row.kind)&&(row.kind==='robust-decisions'?/^study_[0-9a-f]{32}$/:/^[0-9a-f]{64}$/).test(row.id||''));
        if(value?.workspace===workspace&&value.body?.workspace===workspace&&value.body?.action==='study.export'&&
          validRoots&&typeof payload.title==='string'&&typeof payload.include_related_results==='boolean'){
          pendingSubmission=value;
          selected=new Map(payload.roots.map(row=>[keyOf(row),{...row,title:row.id.slice(0,12),state:'Saved'}]));
          title=payload.title;related=payload.include_related_results;selectedOnly=true;
        }
      }
    }catch(_){/* Reopen the original queued task through the export list. */}
  }

  function mount(container,state=host.getState()) {
    detach();
    const next=workspaceNow()??state?.workspace_key;
    if(!next)throw new Error('Open a scientific workspace before transferring studies.');
    if(workspace!==next)reset(next);
    root=container.ownerDocument.createElement('div');
    root.className='study-transfer';container.replaceChildren(root);
    epoch++;skeleton();
    received.mount(root.querySelector('[data-study-received]'));
    if(lastError)notice(lastError,true);
    loadCatalogue();loadExports(0);
  }

  function detach() {
    received.detach();
    epoch++;requestSerial++;
    clearTimeout(searchTimer);clearTimeout(exportTimer);searchTimer=null;exportTimer=null;
    for(const controller of requests)controller.abort();
    requests.clear();
    if(root){root.removeEventListener('click',onClick);root.removeEventListener('change',onChange);root.removeEventListener('input',onInput);}
    root=null;busy=false;catalogueBusy=false;exportBusy=false;
  }

  function update(state=host.getState()) {
    if(!root||state?.workspace_key!==workspace)return;
    const next=JSON.stringify((state.tasks||[]).filter(task=>task.action==='study.export').map(task=>
      [task.id,task.state,task.ended_at,task.error?.message]));
    if(next!==taskSignature){taskSignature=next;loadExports();}
  }

  function setTransferHandler(callback) {
    if(callback!==null&&typeof callback!=='function')throw new TypeError('The transfer handler must be a function or null.');
    transferHandler=callback;renderExports();
  }

  function openForStudies(selection) {
    const roots=Array.isArray(selection)?selection:selection?.roots;
    if(!Array.isArray(roots)||!roots.length)throw new Error('Select saved scientific studies.');
    const next=workspaceNow();
    if(!Array.isArray(selection)&&selection?.workspace_key!==next)throw new Error('Open these saved studies in their original workspace.');
    if(!next)throw new Error('Open a scientific workspace first.');
    if(workspace!==next)reset(next);
    for(const row of roots){
      if(!Object.hasOwn(rootLabels,row.kind)||!(row.kind==='robust-decisions'?/^study_[0-9a-f]{32}$/:/^[0-9a-f]{64}$/).test(row.id||''))throw new Error('Select an original saved scientific study.');
      selected.set(keyOf(row),{...row,title:row.title||row.id.slice(0,12),state:row.state||'Saved'});
    }
    selectedOnly=true;kind='';query='';offset=0;invalidatePlan();
    if(typeof host.navigate==='function')host.navigate('study-transfer');
    if(root){
      root.querySelector('[data-study-field="kind"]').value='';
      root.querySelector('[data-study-field="query"]').value='';
      root.querySelector('[data-study-field="selected-only"]').checked=true;
      renderCatalogue();
    }
  }

  return {mount,update,detach,setTransferHandler,openForStudies};
}
