/* TokenJunkieLabs: original parcel source acquisition and preparation desk. */
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[ch]));
const clone = value => JSON.parse(JSON.stringify(value));
const human = value => String(value ?? '').replace(/_/g, ' ');
const quantity = value => value === null || value === undefined || value === '' ? 'Unavailable' :
  Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined, {maximumFractionDigits:3}) : String(value);
const short = value => String(value ?? '').slice(0,12);
const button = (action, label, attrs='') => '<button type="button" data-parcel-action="' +
  escape(action) + '" ' + attrs + '>' + escape(label) + '</button>';
const nativeButton = (action, label, attrs='') => '<button type="button" data-action="' +
  escape(action) + '" ' + attrs + '>' + escape(label) + '</button>';
const field = (label, name, value, attrs='') => '<label>' + escape(label) +
  '<input name="' + escape(name) + '" value="' + escape(value) + '" ' + attrs + '></label>';
const select = (label, name, options, value, attrs='') => '<label>' + escape(label) +
  '<select name="' + escape(name) + '" ' + attrs + '>' + options.map(([key,title]) =>
    '<option value="' + escape(key) + '"' + (String(key)===String(value)?' selected':'') + '>' +
    escape(title) + '</option>').join('') + '</select></label>';
const sourceLink = value => typeof value === 'string' && /^https:\/\//i.test(value) ?
  '<a href="' + escape(value) + '" target="_blank" rel="noopener noreferrer">' + escape(value) + '</a>' : escape(value);
const TABLE_NAMES = {parcels:'Parcel candidates',context:'Cadastral context',excluded:'Excluded original records',counties:'County coverage',sources:'Original source editions'};
const CANCELLED = Symbol('parcel-desk-view-changed');
const POLLUTANTS = ['nitrogen_export','phosphorus_export','sediment_export'];
const STUDY_DRAFT_FIELDS = ['studyTitle','mode','baseline','alternatives','scoreBasis','scoreScale','scoreAlternative',...POLLUTANTS.map(key=>'weight_'+key)];
function fullNativeRun(row) {
  const models=row?.selection?.models ?? ['ndr','sdr'];
  return row?.state==='complete' && row.selection?.invest_version==='3.20.0' &&
    ['ndr','sdr'].every(name=>Array.isArray(models) && models.includes(name) &&
      Object.hasOwn(row.stages || row.stage_summary || {},name)) &&
    POLLUTANTS.every(name=>row.artifacts?.[name]);
}
function studyDefaults() {
  return {studyTitle:'',mode:'source_context',baseline:'',alternatives:[],
    scoreBasis:'current_export',scoreScale:'total',scoreAlternative:'',
    weight_nitrogen_export:1,weight_phosphorus_export:1,weight_sediment_export:1};
}

export function createParcelSourceDesk(host) {
  const memories = new Map();
  let root = null, activeKey = null, generation = 0, listeners = null, timer = null;
  const controls = new Set();
  const workspace = () => host.getState()?.workspace_key || null;
  function memory(key=workspace()) {
    if (!memories.has(key)) {
      let retained = {};
      try {
        const project = host.getState()?.data?.project?.id || key;
        retained = JSON.parse(sessionStorage.getItem('upstate-parcel-sources:' + project) || '{}');
      } catch (_) {}
      memories.set(key, {
        tab:'captures', catalog:null, browse:null, capture:null, edition:null, page:null,
        rootId:retained.rootId || '', path:retained.path || '', title:retained.title || '',
        editionId:retained.editionId || '', table:retained.table || 'parcels',
        county:retained.county || '', query:retained.query || '', offset:0,
        retryFailed:false, busy:false, notice:'', detail:null, requests:retained.requests || {},
        ...studyDefaults(),studyDrafts:retained.studyDrafts || {},
        lastTask:retained.lastTask || null, preparationTask:retained.preparationTask || null,
        lastStudyTask:retained.lastStudyTask || null,
        lastStamp:'', rowGeneration:0, editionGeneration:0,
      });
    }
    return memories.get(key);
  }
  function retain(m=memory()) {
    try {
      const project = host.getState()?.data?.project?.id || workspace();
      if(m.editionId)m.studyDrafts[m.editionId]=Object.fromEntries(STUDY_DRAFT_FIELDS.map(key=>[key,clone(m[key])]));
      sessionStorage.setItem('upstate-parcel-sources:' + project, JSON.stringify({
        rootId:m.rootId,path:m.path,title:m.title,editionId:m.editionId,
        table:m.table,county:m.county,query:m.query,studyDrafts:m.studyDrafts,
        requests:m.requests,lastTask:m.lastTask,preparationTask:m.preparationTask,lastStudyTask:m.lastStudyTask,
      }));
    } catch (_) {}
  }
  function alive(key, stamp) {
    return root && activeKey===key && workspace()===key && generation===stamp;
  }
  async function request(operation, payload={}) {
    const key=workspace(), stamp=generation, control=new AbortController();
    controls.add(control);
    try {
      const value=await host.api('/api/parcel-sources/' + operation, {
        method:'POST',body:{workspace:key,...payload},signal:control.signal,
      });
      if (!alive(key,stamp)) throw CANCELLED;
      return value;
    } catch(error) {
      if (!alive(key,stamp) || error?.name==='AbortError') throw CANCELLED;
      throw error;
    } finally {controls.delete(control);}
  }
  function currentLocator(m=memory()) {
    return {root_id:m.rootId,path:m.path};
  }
  function notice(error) {
    if(error===CANCELLED)return;
    memory().notice=error?.message || String(error);
    paint();
    host.toast?.(memory().notice);
  }
  async function work(callback) {
    const key=workspace(), stamp=generation, m=memory(key);
    if(m.busy)return;
    m.busy=true;m.notice='';paint();
    try {await callback(m);}
    catch(error){if(alive(key,stamp))notice(error);}
    finally {m.busy=false;if(alive(key,stamp))paint();}
  }
  function downloads(m) {
    const links=m.edition?._downloads || [];
    return links.length ? '<ul class="parcel-downloads">' + links.map(item =>
      '<li><a href="' + escape(item.url) + '?download=1" download>' + escape(item.label || item.filename) +
      '</a><span>' + quantity(item.bytes) + ' bytes</span></li>').join('') + '</ul>' : '';
  }
  function countyTable(rows, coverage=false) {
    const headings=coverage?['County','Capture','Reporting ha','Cadastral ha','Parcel ha','Uncovered ha','Overlap excess ha']:
      ['County','Capture','Provider','Native records','Native ID','Parcel reference','Expected reporting ha'];
    const body=(rows || []).map(row => {
      const values=coverage ? [
        row.county_name,row.capture_status,quantity(row.expected_ha),quantity(row.covered_ha),
        quantity(row.parcel_coverage_ha),quantity(row.uncovered_ha),quantity(row.overlap_excess_ha)
      ] : [
        row.name,row.status,row.provider_id || 'Source required',quantity(row.selected_native_features),
        row.native_id_field || 'Awaiting source', (row.parcel_reference_fields || []).join(', '),
        quantity(row.expected_reporting_area_ha)
      ];
      return '<tr>'+values.map((value,index)=>'<td'+(index>2?' class="parcel-number"':'')+'>'+escape(value)+'</td>').join('')+'</tr>' +
        (!coverage && row.exception ? '<tr><td colspan="7" class="parcel-source-exception">'+escape(row.exception.message || JSON.stringify(row.exception))+'</td></tr>':'');
    }).join('');
    return '<div class="parcel-table-scroll"><table><thead><tr>'+headings.map(value=>'<th scope="col">'+escape(value)+'</th>').join('')+
      '</tr></thead><tbody>'+body+'</tbody></table></div>';
  }
  function directoryView(m) {
    const roots=m.catalog?.roots || [];
    if(!roots.length)return '<section class="parcel-section"><h2>Select retained source data</h2><p>Register the existing parcel plan or capture directory when opening this operator. The startup guide uses the current operator’s <code>--source-root</code> option. Saved parcel editions remain available in this workspace.</p></section>';
    const browse=m.browse;
    return '<section class="parcel-section"><h2>Select an original capture</h2>'+
      select('Registered source directory','rootId',[['','Choose a directory'],...roots.map(row=>[row.id,row.label])],m.rootId)+
      (browse?'<div class="parcel-toolbar"><span class="parcel-path">'+escape(m.path || 'Source directory')+'</span>'+
        (m.path?button('directory','Up one directory','data-path="'+escape(browse.parent)+'"'):'')+
        (browse.has_plan?button('choose-capture','Open this parcel capture'):'')+'</div>'+
        '<div class="parcel-directory-list">'+browse.directories.map(row=>button('directory',row.name+
          (row.has_inventory?' · prepared inventory':row.has_progress?' · county capture':row.has_plan?' · parcel plan':''),
          'data-path="'+escape(row.path)+'"')).join('')+'</div>'+
        '<p class="parcel-muted">'+quantity(browse.total)+' folders'+
        (browse.next_offset!==null?' · '+button('directory-next','More folders','data-offset="'+browse.next_offset+'"'):'')+'</p>':'')+
      '</section>';
  }
  function captureView(m) {
    if(!m.capture)return '';
    const capture=m.capture, pending=capture.counties.filter(row=>row.provider_id && row.status!=='complete');
    return '<section class="parcel-section"><div class="parcel-toolbar"><h2>Original county capture</h2>'+button('refresh-capture','Refresh source status')+'</div>'+
      '<div class="parcel-facts"><span><strong>'+quantity(capture.complete_counties)+' / '+quantity(capture.required_counties)+
      '</strong> counties received</span><span><strong>'+quantity(capture.reporting_area_ha)+'</strong> reporting hectares</span>'+
      '<span><strong>'+escape(human(capture.state))+'</strong> acquisition</span></div>'+
      '<p>This edition uses the complete original county records already received for the retained Upper Savannah reporting boundary. Source coverage and capture status are shown separately.</p>'+
      countyTable(capture.counties)+
      '<details><summary>County source and classification details</summary>'+
      capture.counties.map(row=>'<section class="parcel-native-source"><h3>'+escape(row.name)+'</h3><p>'+sourceLink(row.source_uri)+'</p>'+
        '<p>'+escape(row.source_provenance || '')+'</p><dl><dt>Declared source edition</dt><dd>'+escape(row.source_edition || 'Retained in original provider metadata')+
        '</dd><dt>Native coordinate system</dt><dd><code>'+escape(JSON.stringify(row.source_crs))+'</code></dd><dt>Source classification</dt><dd><code>'+
        escape(JSON.stringify(row.classification))+'</code></dd></dl></section>').join('')+
      '</details>'+
      (pending.length?'<div class="parcel-acquisition"><p>'+quantity(pending.length)+' selected county providers can continue through the original receiver.</p>'+
        '<label class="parcel-check"><input name="retryFailed" type="checkbox" '+(m.retryFailed?'checked':'')+
        '>Retry retained provider failures</label>'+button('receive','Continue original county acquisition',m.busy?'disabled':'')+'</div>':'')+
      '<form data-parcel-form="prepare" class="parcel-form">'+field('Saved parcel source edition','title',m.title,'required maxlength="300"')+
      '<p>The original preparation creates the parcel, cadastral context, county coverage and gap layers. It imports the exact source edition for analysis and preserves all original IDs and source rows.</p>'+
      '<button type="submit" '+(!capture.complete_counties || m.busy?'disabled':'')+'>Prepare and import these completed sources</button>'+
      (!capture.complete_counties?'<p>Receive a complete county source to prepare its parcel inventory.</p>':'')+'</form></section>';
  }
  function editionsView(m) {
    const editions=m.catalog?.editions || [];
    return '<section class="parcel-section"><div class="parcel-toolbar"><h2>Saved source editions</h2>'+button('refresh','Refresh saved editions')+'</div>'+
      (editions.length?'<div class="parcel-table-scroll"><table><thead><tr><th>Edition</th><th>Parcels</th><th>Context</th><th>Counties</th><th>Capture</th><th></th></tr></thead><tbody>'+
        editions.map(row=>'<tr><td>'+escape(row.title)+'</td><td>'+quantity(row.parcel_count)+'</td><td>'+quantity(row.context_count)+
          '</td><td>'+quantity(row.complete_counties)+'</td><td>'+escape(human(row.capture_state))+'</td><td>'+
          button('open-edition','Open edition','data-id="'+escape(row.id)+'"')+'</td></tr>').join('')+'</tbody></table></div>':
        '<p>Prepare an original county capture to save its parcel source edition here.</p>')+'</section>';
  }
  function pageView(m) {
    if(!m.edition)return '';
    const page=m.page;
    const counties=m.edition.tables?.[m.table]?.counties || [];
    const filters='<form data-parcel-form="search" class="parcel-filter">'+
      select('Inventory','table',Object.entries(TABLE_NAMES),m.table)+
      select('County','county',[['','All counties'],...counties.map(row=>[row.fips,row.name])],m.county)+
      field('Search original parcel ID, reference, source or attributes','query',m.query,'maxlength="300"')+
      '<button type="submit">Search complete inventory</button></form>';
    let content=page?'<p aria-live="polite">'+(page.rows.length?quantity(page.offset+1)+'–'+quantity(page.offset+page.rows.length):'0')+
      ' of '+quantity(page.total)+' matching rows · '+quantity(page.source_rows)+' original '+escape(TABLE_NAMES[m.table].toLowerCase())+' rows</p>'+
      '<div class="parcel-table-scroll"><table><thead><tr>'+page.display_columns.map(column=>'<th scope="col">'+escape(human(column))+'</th>').join('')+
      '<th scope="col">Original record</th></tr></thead><tbody>'+page.rows.map(row=>'<tr>'+page.display_columns.map(column=>'<td>'+
        escape(row.values[column])+'</td>').join('')+'<td>'+button('record','Inspect','data-ordinal="'+row.ordinal+'"')+'</td></tr>').join('')+
      '</tbody></table></div><div class="parcel-toolbar">'+
      button('previous','Previous page',page.offset===0?'disabled':'')+
      button('next','Next page',page.next_offset===null?'disabled':'')+'</div>':'<p>Opening the saved original table…</p>';
    if(m.detail)content+='<section class="parcel-record"><div class="parcel-toolbar"><h3>Original source record</h3>'+button('close-record','Close record')+'</div>'+
      '<dl>'+Object.entries(m.detail).map(([key,value])=>'<dt>'+escape(human(key))+'</dt><dd>'+escape(value===''?'Blank in original row':value)+'</dd>').join('')+
      '</dl><p>Area fields ending in <code>_ha</code> are hectares. Native parcel references and ID fields keep their original text, including leading zeros.</p></section>';
    return '<section class="parcel-section"><h2>Browse the complete source inventory</h2>'+filters+content+'</section>';
  }
  function studyView(m) {
    if(!m.edition)return '';
    const state=host.getState(), runs=(state?.data?.runs || []).filter(fullNativeRun);
    const baseline=runs.find(row=>row.id===m.baseline);
    const runTitle=row=>row.title || row.selection?.title || 'Run '+short(row.id);
    const alternatives=baseline ? runs.filter(row=>row.id!==m.baseline && row.selection?.grid_id===baseline.selection?.grid_id) : [];
    const scoredAlternatives=alternatives.filter(row=>m.alternatives.includes(row.id));
    const scores=select('Priority quantity','scoreBasis',[
      ['current_export','Current export from the baseline'],
      ['scenario_reduction','Reduction from baseline to an alternative'],
      ['disturbance_increase','Increase from baseline to an alternative']
    ],m.scoreBasis)+
      select('Quantity basis','scoreScale',[['total','Whole parcel reporting total'],['per_hectare','Per reporting hectare']],m.scoreScale)+
      (m.scoreBasis==='current_export'?'':select('Alternative used for priority','scoreAlternative',
        [['','Choose a selected alternative'],...scoredAlternatives.map(row=>[row.id,runTitle(row)])],m.scoreAlternative,'required'))+
      POLLUTANTS.map(key=>field(human(key)+' weight','weight_'+key,m['weight_'+key],
        'type="number" min="0" step="any" required')).join('')+
      '<p>The original engine retains each pollutant in its own units and normalizes the weighted priority using the recorded 95th-percentile method. Choose these weights for the study purpose.</p>';
    const countyOptions=m.edition.tables?.parcels?.counties || [];
    const selectedCounty=m.county && countyOptions.some(row=>row.fips===m.county) ? m.county : '';
    return '<section class="parcel-section"><h2>Use this edition in Conservation plans</h2>'+
      '<p>Create the original candidate inventory from the saved parcel source. Conservation plans then provides detailed source rules, manual or ranked portfolios, union quantities and land-cover scenarios.</p>'+
      '<form data-parcel-form="study" class="parcel-form">'+field('Inventory title','studyTitle',m.studyTitle || m.edition.title+' · parcel inventory','required maxlength="300"')+
      select('Original inventory mode','mode',[['source_context','Source geometry and reporting coverage'],['native_model','Completed native model quantities']],m.mode)+
      '<p>County selection: <strong>'+escape(selectedCounty?(countyOptions.find(row=>row.fips===selectedCounty)?.name || selectedCounty):'All counties in this source edition')+
      '</strong>. Use the inventory County control above to choose one county before creating the study.</p>'+
      (m.mode==='native_model'?select('Completed original baseline','baseline',[['','Choose a completed native run'],...runs.map(row=>[row.id,runTitle(row)])],m.baseline,'required')+
        '<fieldset><legend>Completed alternatives on the same original grid</legend>'+alternatives.map(row=>
        '<label class="parcel-check"><input name="alternative" type="checkbox" value="'+escape(row.id)+'" '+
        (m.alternatives.includes(row.id)?'checked':'')+'>'+escape(runTitle(row))+'</label>').join('')+'</fieldset>'+
        '<p>Available runs retain complete InVEST 3.20.0 NDR and SDR quantities. Both selected models must be complete on the same original grid.</p>'+scores:'')+
      '<button type="submit" '+(m.busy?'disabled':'')+'>Build the original conservation inventory</button>'+
      button('study-selection','Download the selected study settings')+'</form>'+
      '<p>Source-context mode retains actual geometry and coverage. Native-model mode also binds the chosen completed run quantities. Conservation plans exposes the resulting score, coverage and scenario settings for further decisions.</p>'+
      '<div class="parcel-toolbar">'+button('conservation','Open Conservation plans')+
      (host.openDelivery?button('delivery','Use this parcel source in map delivery'):'')+'</div>'+
      '</section>';
  }
  function editionView(m) {
    if(!m.edition)return '';
    const edition=m.edition,native=edition.native_inventory,binding=edition.bindings;
    return '<section class="parcel-section"><div class="parcel-toolbar"><h2>'+escape(edition.title)+'</h2>'+
      nativeButton('item','Open retained source collection','data-kind="sources" data-id="'+escape(edition.source_collection_id)+'"')+'</div>'+
      '<p>'+quantity(native.parcel_count)+' parcel candidates · '+quantity(native.cadastral_context_count)+' context records · acquisition '+escape(human(native.capture_state))+'</p>'+
      countyTable(native.county_coverage,true)+
      '<p>Coverage is the unique union of available cadastral geometry. Parcel-only area, overlap and remaining gaps have separate original measures. Each county keeps its own source edition.</p>'+
      '<div class="parcel-toolbar">'+[['parcels','Open parcel map'],['coverage','Open county coverage map'],['gaps','Open source gap map']].map(([key,label])=>
        nativeButton('spatial-item',label,'data-kind="source-info" data-id="'+escape(binding[key].source_id)+'" data-collection="'+escape(binding[key].source_collection_id)+'"')).join('')+'</div>'+
      '<details><summary>Saved source bindings and original inventory identity</summary><pre>'+escape(JSON.stringify({
        source_collection_id:edition.source_collection_id,plan_sha256:native.plan_sha256,
        native_inventory:native.source_fingerprint,bindings:binding
      },null,2))+'</pre></details></section>'+
      pageView(m)+studyView(m)+
      '<section class="parcel-section"><h2>Download and reopen</h2><p>The GeoPackage contains the original prepared parcel, cadastral, county and gap layers. The complete CSVs preserve all source rows. The printable report explains the current county coverage and source editions.</p>'+
      downloads(m)+'<div class="parcel-toolbar">'+button('backup','Create complete workspace backup')+
      button('reopen','Reopen this saved edition')+'</div><p>A complete workspace backup includes this source edition, original inputs, searchable inventory and the installed application. The original workspace restore opens these same records in the received project.</p></section>';
  }
  function operationsView(m) {
    const tasks=(host.getState()?.tasks || []).filter(row=>
      row.action?.startsWith('parcel.source.') ||
      row.id===m.lastStudyTask || row.id===m.lastTask);
    const operations=new Map((m.catalog?.operations || []).map(row=>[row.id,row]));
    if(!tasks.length)return '';
    return '<section class="parcel-section"><h2>Original operations</h2><div class="parcel-table-scroll"><table><thead><tr>'+
      '<th>Operation</th><th>State</th><th>Progress</th><th></th></tr></thead><tbody>'+
      tasks.slice(0,12).map(task=>{
        const op=operations.get(task.id),outcome=task.result?.capture;
        const stage=op?.stage || (outcome?outcome.complete_counties+' / '+outcome.required_counties+' counties received':'');
        const progress=op?.progress || {};
        return '<tr><td>'+escape(human(task.action))+'</td><td>'+escape(human(task.state))+
          (outcome?' · '+escape(outcome.state)+' capture':'')+'</td><td>'+escape(stage)+
          (progress.completed!==undefined?' · '+quantity(progress.completed)+(progress.total!==undefined?' / '+quantity(progress.total):''):'')+
          '</td><td>'+button('task','Open operation','data-id="'+escape(task.id)+'"')+
          (['failed','interrupted'].includes(task.state)?button('resume','Resume this operation','data-id="'+escape(task.id)+'"'):'')+
          (task.action==='parcel.source.prepare'&&task.state==='complete'&&task.result?.id?button('open-edition','Open prepared edition','data-id="'+escape(task.result.id)+'"'):'')+
          (task.action==='conservation.build'&&task.state==='complete'&&task.result?.id?
            nativeButton('conservation-open-study','Open conservation inventory','data-study-id="'+escape(task.result.id)+'"'):'')+'</td></tr>';
      }).join('')+'</tbody></table></div></section>';
  }
  function captureFocus() {
    const active=document.activeElement;
    if(!root?.contains(active) || !active.name)return null;
    return {name:active.name,start:active.selectionStart,end:active.selectionEnd};
  }
  function paint() {
    if(!root || activeKey!==workspace())return;
    const m=memory(),focus=captureFocus(),scroll=root.scrollTop;
    root.innerHTML='<section class="parcel-source-desk" aria-busy="'+(m.busy?'true':'false')+'">'+
      '<header><h1>Parcel sources</h1><p>Receive county sources, inspect reporting coverage, and prepare a saved parcel edition for the watershed application.</p></header>'+
      '<div class="parcel-tabs" role="group" aria-label="Parcel source views">'+
      button('tab-captures','Sources and captures','aria-pressed="'+(m.tab==='captures')+'"')+
      button('tab-editions','Saved editions','aria-pressed="'+(m.tab==='editions')+'"')+'</div>'+
      (m.notice?'<p role="alert" class="parcel-notice">'+escape(m.notice)+'</p>':'')+
      (!m.catalog?'<p aria-live="polite">Opening the original project sources…</p>':
      m.tab==='captures'?directoryView(m)+captureView(m):editionsView(m)+editionView(m))+
      operationsView(m)+
      '<details class="parcel-section"><summary>Explain this workflow</summary><ol>'+
      '<li>Select an existing original county capture. “We keep each county source and its publication context.”</li>'+
      '<li>Inspect received counties and reporting hectares. “The coverage view shows where the available source geometry reaches.”</li>'+
      '<li>Prepare and import the source edition. “This creates the parcel GIS and complete inventory from those retained inputs.”</li>'+
      '<li>Search an original parcel and open the maps. “The local identifier and source record stay attached to each parcel.”</li>'+
      '<li>Build the original conservation inventory. “We can use these same parcels for a saved conservation portfolio and an explicit land-cover scenario.”</li>'+
      '<li>Download and reopen. “The recipient gets editable GIS, full tables, the source report and the working project.”</li></ol></details></section>';
    root.scrollTop=scroll;
    if(focus) {
      const element=[...root.querySelectorAll('[name]')].find(node=>node.name===focus.name);
      if(element){element.focus({preventScroll:true});try{element.setSelectionRange(focus.start,focus.end);}catch(_){}}
    }
  }
  async function loadCatalog({restore=false}={}) {
    const m=memory(),value=await request('catalog');
    m.catalog=value;
    if(!value.roots.some(row=>row.id===m.rootId)){m.rootId='';m.path='';m.browse=null;m.capture=null;}
    if(restore && m.editionId && value.editions.some(row=>row.id===m.editionId)) {
      m.tab='editions';await openEdition(m.editionId);
    } else if(m.rootId && !m.browse) await browse(m.path);
    paint();
  }
  async function browse(path='',offset=0) {
    const m=memory();
    const value=await request('directories',{root_id:m.rootId,path,offset});
    m.path=path;m.browse=value;m.capture=null;retain(m);paint();
  }
  async function loadCapture({quiet=false}={}) {
    const m=memory(),selection=currentLocator(m);
    const value=await request('capture',selection);
    if(m.rootId!==selection.root_id || m.path!==selection.path)return;
    m.capture=value;
    if(!m.title)m.title='Upper Savannah county parcel edition';
    retain(m);if(!quiet)paint();
  }
  async function loadRows() {
    const m=memory(),requestId=++m.rowGeneration;
    const value=await request('rows',{edition_id:m.editionId,table:m.table,county:m.county,query:m.query,offset:m.offset,limit:100});
    if(requestId!==m.rowGeneration)return;
    m.page=value;m.detail=null;paint();
  }
  async function openEdition(id) {
    const m=memory(),requestId=++m.editionGeneration;
    const value=await request('edition',{edition_id:id});
    if(requestId!==m.editionGeneration)return;
    const draft=m.edition?.id===value.id ? Object.fromEntries(STUDY_DRAFT_FIELDS.map(key=>[key,clone(m[key])])) : m.studyDrafts[value.id];
    m.edition=value;m.editionId=value.id;m.tab='editions';m.page=null;m.offset=0;m.detail=null;
    Object.assign(m,studyDefaults(),draft || m.studyDrafts[value.id] || {});
    if(!m.studyTitle)m.studyTitle=value.title+' · parcel inventory';
    if(!value.tables?.[m.table])m.table='parcels';
    if(m.county && !value.tables[m.table].counties.some(row=>row.fips===m.county))m.county='';
    retain(m);paint();await loadRows();
  }
  function operationId(m,action,payload) {
    const signature=JSON.stringify({action,payload});
    if(!m.requests[signature]){
      const random=globalThis.crypto?.randomUUID?.() || Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
      m.requests[signature]='parcel-desk-'+random;
      retain(m);
    }
    return m.requests[signature];
  }
  async function queue(action,payload) {
    const m=memory(),key=workspace(),stamp=generation;
    const task=await host.api('/api/actions',{method:'POST',body:{
      workspace:key,action,payload,operation_id:operationId(m,action,payload)
    }});
    if(!alive(key,stamp))throw CANCELLED;
    m.lastTask=task.id;
    if(action==='parcel.source.prepare')m.preparationTask=task.id;
    if(action==='conservation.build')m.lastStudyTask=task.id;
    retain(m);
    if(['failed','interrupted'].includes(task.state)) {
      await host.api('/api/task/resume',{method:'POST',body:{id:task.id}});
      if(!alive(key,stamp))throw CANCELLED;
    }
    await (host.refreshState || host.refresh)?.();
    if(alive(key,stamp))await host.showTask(task.id);
    return task;
  }
  async function makeStudySpec(m) {
    const selectedCounty=(m.edition.tables.parcels.counties || []).some(row=>row.fips===m.county)?m.county:'';
    const spec={title:m.studyTitle || m.edition.title+' · parcel inventory',mode:m.mode,
      county_fips:selectedCounty,purpose:'screening',contexts:{},rules:{}};
    if(m.mode==='native_model') {
      const runs=(host.getState()?.data?.runs || []).filter(fullNativeRun);
      const baseline=runs.find(row=>row.id===m.baseline);
      if(!baseline)throw new Error('Choose a completed original NDR and SDR baseline run.');
      const allowed=new Set(runs.filter(row=>row.id!==baseline.id &&
        row.selection.grid_id===baseline.selection.grid_id).map(row=>row.id));
      if(m.alternatives.some(id=>!allowed.has(id)))throw new Error('Reopen the alternatives and select completed NDR and SDR runs on the baseline grid.');
      const weights=Object.fromEntries(POLLUTANTS.map(key=>{
        const value=Number(m['weight_'+key]);
        if(m['weight_'+key]==='' || !Number.isFinite(value) || value<0)throw new Error('Enter a nonnegative '+human(key)+' weight.');
        return [key,value];
      }));
      if(!Object.values(weights).some(value=>value>0))throw new Error('Choose at least one positive pollutant weight.');
      spec.baseline_run_id=m.baseline;spec.alternative_run_ids=[...m.alternatives];
      spec.score={basis:m.scoreBasis,scale:m.scoreScale,weights};
      if(m.scoreBasis!=='current_export'){
        if(!m.alternatives.includes(m.scoreAlternative))throw new Error('Choose a selected alternative for this priority quantity.');
        spec.score.alternative_run_id=m.scoreAlternative;
      }
    }
    return request('study-selection',{edition_id:m.editionId,spec});
  }
  function saveJSON(value,filename) {
    const blob=new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function fillDelivery(m) {
    if(!host.openDelivery)throw new Error('Open Maps and delivery and select this saved parcel source edition.');
    const key=workspace(),stamp=generation,edition=m.edition;
    await host.openDelivery({baseline_run_id:m.baseline || undefined,scenario_run_ids:[...m.alternatives]});
    if(!alive(key,stamp))throw CANCELLED;
    const form=document.getElementById('operation-form');
    const binding=edition.bindings.parcels;
    function set(name,value) {
      const control=form?.elements.namedItem(name);
      if(!control)throw new Error('The current delivery form is missing its original '+name+' control.');
      if(control.tagName==='SELECT' && ![...control.options].some(option=>option.value===String(value)))
        throw new Error('Refresh the current source edition before opening map delivery.');
      control.value=value;control.dispatchEvent(new Event('change',{bubbles:true}));
    }
    const enabled=form?.elements.namedItem('overlay_parcels_enabled');
    if(!enabled)throw new Error('The current delivery form is missing its parcel overlay selector.');
    enabled.checked=true;enabled.dispatchEvent(new Event('change',{bubbles:true}));
    for(const prefix of ['role_PARCEL','overlay_parcels']){
      set(prefix+'_collection',binding.source_collection_id);
      set(prefix+'_source',binding.source_id);
    }
    set('overlay_parcels_layer',binding.layer);
    host.toast?.('The original parcel source and parcel overlay are selected. Complete the remaining delivery settings.');
  }
  async function dispatch(control) {
    const m=memory(),action=control.dataset.parcelAction;
    if(action==='record'){
      m.detail=m.page?.rows.find(row=>String(row.ordinal)===control.dataset.ordinal)?.values || null;paint();return;
    }
    if(action==='close-record'){m.detail=null;paint();return;}
    if(action==='tab-captures'){m.tab='captures';paint();return;}
    if(action==='tab-editions'){m.tab='editions';paint();return;}
    await work(async()=>{
      if(action==='refresh')return loadCatalog();
      if(action==='directory')return browse(control.dataset.path);
      if(action==='directory-next')return browse(m.path,Number(control.dataset.offset));
      if(action==='choose-capture' || action==='refresh-capture')return loadCapture();
      if(action==='open-edition')return openEdition(control.dataset.id);
      if(action==='reopen')return openEdition(m.editionId);
      if(action==='task')return host.showTask(control.dataset.id);
      if(action==='resume'){
        await host.api('/api/task/resume',{method:'POST',body:{id:control.dataset.id}});
        await (host.refreshState || host.refresh)?.();return host.showTask(control.dataset.id);
      }
      if(action==='receive'){
        if(!m.capture)throw new Error('Open the original parcel capture first.');
        const providers=m.capture.counties.filter(row=>row.provider_id && row.status!=='complete').map(row=>row.provider_id);
        return queue('parcel.source.receive',{...currentLocator(m),plan_sha256:m.capture.plan_sha256,
          providers,retry_failed:m.retryFailed});
      }
      if(action==='prepare'){
        if(!m.capture?.complete_counties)throw new Error('Choose a capture with a complete county source.');
        return queue('parcel.source.prepare',{...currentLocator(m),selection:clone(m.capture.selection),title:m.title});
      }
      if(action==='search'){m.offset=0;retain(m);return loadRows();}
      if(action==='previous'){m.offset=Math.max(0,m.offset-100);return loadRows();}
      if(action==='next'){if(m.page?.next_offset!==null)m.offset=m.page.next_offset;return loadRows();}
      if(action==='build-study')return queue('conservation.build',{spec:await makeStudySpec(m)});
      if(action==='study-selection')return saveJSON(await makeStudySpec(m),'parcel-conservation-selection.json');
      if(action==='conservation')return host.navigate('conservation');
      if(action==='delivery')return fillDelivery(m);
      if(action==='backup')return queue('workspace.backup',{include_intermediates:true});
      throw new Error('Unknown parcel source control.');
    });
  }
  function changed(event) {
    const target=event.target,m=memory(),name=target?.name;
    if(!name)return;
    if(name==='alternative'){
      const selected=new Set(m.alternatives);target.checked?selected.add(target.value):selected.delete(target.value);
      m.alternatives=[...selected];
      if(!selected.has(m.scoreAlternative))m.scoreAlternative='';
      retain(m);paint();return;
    }
    if(!['rootId','title','query','county','table','retryFailed',...STUDY_DRAFT_FIELDS].includes(name))return;
    m[name]=target.type==='checkbox'?target.checked:target.value;retain(m);
    if(event.type==='change' && name==='rootId'){
      m.path='';m.browse=null;m.capture=null;retain(m);
      if(m.rootId)void work(()=>browse(''));else paint();
    }
    if(event.type==='change' && name==='table'){
      m.county='';m.offset=0;retain(m);void work(()=>loadRows());
    }
    if(event.type==='change' && ['mode','scoreBasis'].includes(name))paint();
    if(event.type==='change' && name==='baseline'){
      const run=(host.getState()?.data?.runs || []).find(row=>row.id===m.baseline);
      const allowed=new Set((host.getState()?.data?.runs || []).filter(row=>
        fullNativeRun(row) && row.id!==m.baseline && row.selection?.grid_id===run?.selection?.grid_id).map(row=>row.id));
      m.alternatives=m.alternatives.filter(id=>allowed.has(id));
      if(!m.alternatives.includes(m.scoreAlternative))m.scoreAlternative='';
      retain(m);paint();
    }
  }
  async function tick() {
    if(!root || activeKey!==workspace())return;
    const key=workspace(),stamp=generation,m=memory(key);
    try {
      if(m.tab==='captures' && m.capture && !m.busy){await loadCapture({quiet:true});paint();}
    } catch(error){if(error!==CANCELLED && alive(key,stamp)){m.notice=error?.message || String(error);paint();}}
    if(alive(key,stamp))timer=setTimeout(tick,5000);
  }
  function mount(node,state=host.getState()) {
    if(!node || !state?.workspace_key)return;
    detach();root=node;activeKey=state.workspace_key;generation++;
    listeners=new AbortController();
    root.addEventListener('click',event=>{
      const control=event.target.closest('[data-parcel-action]');
      if(!control || !root.contains(control))return;
      event.preventDefault();event.stopPropagation();void dispatch(control);
    },{signal:listeners.signal});
    for(const type of ['input','change'])root.addEventListener(type,changed,{signal:listeners.signal});
    root.addEventListener('submit',event=>{
      const form=event.target.closest('[data-parcel-form]');
      if(!form)return;event.preventDefault();event.stopPropagation();
      const action={prepare:'prepare',search:'search',study:'build-study'}[form.dataset.parcelForm];
      void dispatch({dataset:{parcelAction:action}});
    },{signal:listeners.signal});
    paint();void loadCatalog({restore:true}).catch(notice);timer=setTimeout(tick,5000);
  }
  function update(state=host.getState()) {
    if(!root)return;
    if(activeKey!==state?.workspace_key){detach();return;}
    const m=memory(),data=state.data?.parcel_source_desk;
    if(data && m.catalog)m.catalog={...m.catalog,...data};
    const stamp=JSON.stringify((state.tasks || []).filter(row=>
      row.action?.startsWith('parcel.source.') || row.id===m.lastStudyTask || row.id===m.lastTask)
      .map(row=>[row.id,row.state,row.result?.id,row.error]));
    const progress=JSON.stringify(data?.operations?.map(row=>[row.id,row.stage,row.progress,row.state]));
    const signature=stamp+progress;
    if(signature!==m.lastStamp){
      m.lastStamp=signature;
      const completed=(state.tasks || []).find(row=>row.id===m.preparationTask && row.state==='complete' && row.result?.id);
      if(completed && m.editionId!==completed.result.id){
        m.preparationTask=null;void openEdition(completed.result.id).catch(notice);
      }else paint();
    }
  }
  function detach() {
    generation++;clearTimeout(timer);timer=null;
    listeners?.abort();listeners=null;
    for(const control of controls)control.abort();controls.clear();
    root=null;activeKey=null;
  }
  return {mount,update,detach,openEdition};
}
