/** Original USGS annual references on the current scientific operator. */
const esc = value => String(value ?? '').replace(/[&<>"']/g, value =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[value]));
const short = value => String(value ?? '').slice(0, 12);
const number = value => Number.isFinite(value) ?
  value.toLocaleString(undefined, {maximumSignificantDigits:7}) : '—';
const select = (name, values, selected='', attributes='') =>
  '<select name="'+esc(name)+'" '+attributes+'>'+values.map(([id, label]) =>
  '<option value="'+esc(id)+'" '+(id===selected?'selected':'')+'>'+esc(label)+'</option>').join('')+'</select>';
const methodLabel=row=>row.method_label||String(row.final_method||'').replaceAll('_',' ');
const unitLabel=value=>value==='metric_tonnes/year'?'metric tonnes/year':value;
const field = (label, body, help='') => '<label><span>'+esc(label)+'</span>'+body+
  (help?'<small>'+esc(help)+'</small>':'')+'</label>';
const action = (name, label, id='', extra='') => '<button type="button" data-annual-action="'+esc(name)+
  '" data-id="'+esc(id)+'" '+extra+'>'+esc(label)+'</button>';
const table = (heads, rows) => '<div class="annual-table"><table><thead><tr>'+
  heads.map(label=>'<th scope="col">'+esc(label)+'</th>').join('')+
  '</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';

export function createAnnualReferences(host) {
  let root=null, workspace=null, epoch=0, catalog=null, inventory=null, error='', pending=false;
  let chosen=new Map(), query='', series='', page=0, loading=null, taskSignature='';
  let files=null, browsing=false, inventoryRequest=0;
  const defaults={source_edition:'f7dn436b',mode:'registered',root_id:'',path:'',load_upload_id:'',site_upload_id:'',
    huc8:'03060101, 03060102, 03060103, 03060104, 03060105, 03060106, 03060107',
    title:'USGS annual-reference selection',comparability_note:''};
  const draft={source_edition:'f7dn436b',mode:'registered', root_id:'', path:'', load_upload_id:'', site_upload_id:'',
    huc8:'03060101, 03060102, 03060103, 03060104, 03060105, 03060106, 03060107',
    title:'USGS annual-reference selection', comparability_note:''};
  const current = () => host.getState()?.workspace_key;
  const fallbackEdition={id:'f7dn436b',title:'USGS published annual estimates — F7DN436B',
    description:'Original paired stations, final estimators, source periods and published standard errors.',
    modes:['registered','uploads','published'],available:true};
  const editions=()=>catalog?.source_editions||[fallbackEdition];
  const edition=()=>editions().find(row=>row.id===draft.source_edition)||fallbackEdition;
  function normalizeMode(){
    const modes=edition().modes;
    if(!modes.includes(draft.mode))draft.mode=modes[0];
    if(draft.mode==='registered'&&!catalog?.source_roots?.length)draft.mode='published';
  }
  const key = () => 'upstate-annual-reference:'+workspace;
  function save() {
    try { sessionStorage.setItem(key(), JSON.stringify({draft, selected:[...chosen], query, series,
      inventory_task_id:inventory?.task_id})); } catch (_) { /* Retained native tasks remain authoritative. */ }
  }
  function restore() {
    try {
      const value=JSON.parse(sessionStorage.getItem(key()) || 'null');
      if (!value) return null;
      for(const name of Object.keys(draft)) if(typeof value.draft?.[name]==='string') draft[name]=value.draft[name];
      chosen=new Map(Array.isArray(value.selected)?value.selected:[]);
      query=value.query||''; series=value.series||'';
      return value.inventory_task_id||null;
    } catch (_) { return null; }
  }
  function still(token, selected) { return root && token===epoch && selected===workspace && current()===workspace; }
  async function read(operation, values={}) {
    const token=epoch, selected=workspace;
    const value=await host.api(host.endpoint('/api/annual-references/'+operation, values));
    if (!still(token, selected)) throw Error('The workspace changed. Open its annual references again.');
    return value;
  }
  async function refresh() {
    if (!root || current()!==workspace) return;
    if (loading) return loading;
    const token=epoch, selected=workspace;
    loading=(async () => {
      try {
        const value=await read('catalog');
        if(!still(token, selected)) return;
        catalog=value;
        if(!draft.root_id && value.source_roots.length) draft.root_id=value.source_roots[0].id;
        normalizeMode();
        error='';
        render();
      } catch(err) { if(still(token, selected)){error=err.message;render();} }
      finally { if(still(token, selected)) loading=null; }
    })();
    return loading;
  }
  async function openInventory(id) {
    const request=++inventoryRequest;
    const value=await read('inventory', {task_id:id});
    if(request!==inventoryRequest)return;
    draft.source_edition=value.source_edition||'f7dn436b';normalizeMode();
    if(inventory?.task_id && inventory.task_id!==id) chosen=new Map();
    inventory=value; page=0;
    const rows=new Map(value.records.map(row=>[row.record_id,row]));
    chosen=new Map([...chosen].filter(([id, choice]) =>
      rows.has(id) && rows.get(id).catchment_choices.some(item=>item.id===choice)));
    save(); render();
  }
  function selectedRows() {
    return (inventory?.records || []).filter(row=>chosen.has(row.record_id));
  }
  function rows() {
    const token=query.trim().toLowerCase();
    return (inventory?.records || []).filter(row=>
      (!series || row.series===series) && (!token ||
       [row.station_id,row.station_name,row.flow_station_id,row.comid,...row.huc8].join(' ').toLowerCase().includes(token)));
  }
  function sourceForm() {
    const roots=(catalog?.source_roots || []).map(row=>[row.id,row.label]);
    const selectedEdition=edition(),regional=selectedEdition.id==='southeast-sparrow-2012';
    const modeLabels={registered:'Use received originals',uploads:'Use original ZIP uploads',
      published:regional?'Use retained published targets':'Receive the published originals'};
    const mode=select('mode',selectedEdition.modes.map(id=>[id,modeLabels[id]]),draft.mode);
    let selected='';
    if(draft.mode==='registered') {
      selected=field('Registered source folder', select('root_id',[['','Choose source folder'],...roots],draft.root_id))+
        field('Directory within that folder','<input name="path" value="'+esc(draft.path)+'">',
          regional?'This directory must contain the complete original calibration tables, metadata and published-reach crosswalk.':
            'This directory must contain the complete load_est.zip and sitegage.zip originals.')+
        '<div class="annual-buttons">'+action('browse','Browse directories')+'</div>';
    } else if(draft.mode==='uploads') {
      const options=bytes=>[['','Choose original ZIP'],...(catalog?.uploads || [])
        .filter(row=>row.bytes===bytes).map(row=>[row.id,row.filename+' · '+row.bytes.toLocaleString()+' bytes'])];
      selected=field('Published load estimates',select('load_upload_id',options(781822),draft.load_upload_id))+
        field('Paired station and flow records',select('site_upload_id',options(519872),draft.site_upload_id))+
        '<p class="annual-help">Select the complete originals already added through this operator’s upload flow.</p>';
    } else {
      selected=regional?
        '<p class="annual-help">Use the retained original nitrogen, phosphorus and sediment calibration tables, regional metadata and published-reach crosswalk. The native queue reuses received source files and retrieves missing originals through their published URLs.</p>':
        '<p class="annual-help">The existing native queue receives the two fixed USGS source archives and their original dictionary. Completed original files are reused when the task resumes.</p>';
    }
    return '<section class="section"><h2>Original annual-load source</h2><p>'+esc(selectedEdition.description)+
      '</p><div class="annual-fields">'+field('Published source edition',
      select('source_edition',editions().map(row=>[row.id,row.title]),draft.source_edition))+
      field('Source intake',mode)+selected+
      field('Source HUC8 selection','<input name="huc8" value="'+esc(draft.huc8)+'">',
        'Use comma-separated original eight-digit HUC codes. The default covers the seven Upper Savannah HUC8s.')+
      '</div>'+directoryBrowser()+'<div class="annual-buttons">'+action('inventory','Read original station records','',
        pending||selectedEdition.available===false?'disabled':'class="primary"')+'</div>'+
      (selectedEdition.available===false?'<p class="annual-help">Receive this edition’s complete source adapter into the application to open its original tables.</p>':'')+'</section>';
  }
  function directoryBrowser() {
    if(!browsing) return '';
    if(!files) return '<p role="status">Reading source directories…</p>';
    const parent=files.path.split('/').slice(0,-1).join('/');
    return '<div class="annual-browser"><h3>Registered source directory</h3><p class="mono">'+esc(files.path||'/')+
      '</p><div class="annual-buttons">'+(files.path?action('directory','Parent directory',parent):'')+
      action('choose-directory','Use this directory',files.path)+action('close-browser','Close')+'</div>'+
      '<ul>'+files.entries.filter(row=>row.is_dir).map(row=>'<li>'+action('directory',row.name,row.path)+'</li>').join('')+
      '</ul><p>'+files.entries.filter(row=>!row.is_dir).map(row=>esc(row.name)).join(' · ')+
      '</p>'+(files.next_offset!==null?action('directory-next','More directory entries',String(files.next_offset)):'')+'</div>';
  }
  function savedOperations() {
    const operations=catalog?.operations || [];
    if(!operations.length) return '<section class="section"><h2>Retained source operations</h2><p>Completed source inventories and imported observation editions appear here.</p></section>';
    return '<section class="section"><h2>Retained source operations</h2>'+
      table(['Operation','State','Original records',''],[...operations].reverse().map(row=>{
        const counts=row.record_counts?Object.entries(row.record_counts).map(([name,count])=>name.toUpperCase()+': '+count).join(' · '):'';
        const binding=row.binding;
        const open=row.action==='annual-reference.inventory' && row.state==='complete'?
          action('open-inventory','Select records',row.task_id):'';
        const calibrate=binding?action('calibrate','Open calibration',row.task_id)+
          action('study-calibration','Evaluate saved study',row.task_id):'';
        const sourceTitle=editions().find(value=>value.id===(row.source_edition||'f7dn436b'))?.title||row.source_edition;
        return '<tr><td><strong>'+esc(row.title)+'</strong><small>'+esc(short(row.task_id))+'</small><small>'+
          esc(sourceTitle)+'</small></td><td>'+
          esc(row.state)+(row.stage&&row.stage!=='complete'?'<small>'+esc(row.stage)+'</small>':'')+
          (row.error?'<small>'+esc(row.error.message)+'</small>':'')+'</td><td>'+
          esc(binding?String(binding.admitted_count)+' imported':counts)+'</td><td><div class="annual-buttons">'+
          open+calibrate+action('task','Open operation',row.task_id)+'</div></td></tr>';
      }))+'</section>';
  }
  function recordTable() {
    if(!inventory) return '';
    const filtered=rows(), pages=Math.max(1,Math.ceil(filtered.length/40));
    page=Math.max(0,Math.min(page,pages-1));
    const visible=filtered.slice(page*40,page*40+40);
    const reviewRows=visible.map(row=>{
      const possible=row.catchment_choices || [], selected=chosen.has(row.record_id);
      const choice=chosen.get(row.record_id)||possible[0]?.id||'';
      const unavailable=row.issues.length || !possible.length;
      return '<tr><td><input type="checkbox" name="record" value="'+esc(row.record_id)+'" aria-label="Select '+
        esc(row.station_id+' '+row.series)+'" '+(selected?'checked':'')+' '+(unavailable?'disabled':'')+
        '></td><td><strong>'+esc(row.station_name||row.station_id)+'</strong><small>'+
        esc(row.station_id)+(row.flow_station_id?' · flow '+esc(row.flow_station_id):'')+'</small><small>HUC '+esc(row.huc8.join(', '))+
        ' · COMID '+esc(row.comid)+'</small></td><td>'+esc(row.series.toUpperCase())+'<small>'+
        esc(row.parameter)+'</small></td><td>'+number(row.value)+'<small>'+esc(unitLabel(row.value_unit||'kg/year'))+' · '+esc(methodLabel(row))+
        '</small><small>'+(Number.isFinite(row.uncertainty?.value)?
          'SE '+number(row.uncertainty.value)+' '+esc(unitLabel(row.uncertainty.unit||row.value_unit||'kg/year')):
          'Published standard error unavailable')+'</small></td><td>'+
        esc(row.temporal_basis?.flow_start_inclusive || row.period_start || '—')+'<small>through '+
        esc(row.temporal_basis?.flow_end_inclusive || '—')+'</small>'+
        (row.temporal_basis?.scope==='source_global'?'<small>Published regional target horizon</small>':'')+'</td><td>'+
        (unavailable?'<p>'+esc(row.issues.join('; ') || 'No original USGS station/reach option in this row.')+'</p>':
          select('catchment',possible.map(item=>[item.id,item.label]),choice,'data-record="'+esc(row.record_id)+'"'))+
        '</td><td>'+action('record-detail','Original fields',row.record_id)+'</td></tr>';
    });
    const selected=selectedRows();
    return '<section class="section"><h2>Select original reference records</h2><p>'+
      esc(editions().find(row=>row.id===inventory.source_edition)?.title||fallbackEdition.title)+
      ' · '+inventory.station_count+' stations in the selected original HUC fields. '+selected.length+
      ' records selected. Each load is already an annual mass rate.</p>'+
      '<div class="annual-fields">'+field('Find a station, reach or HUC','<input name="query" value="'+esc(query)+'">')+
      field('Constituent',select('series',[['','All constituents'],['tn','Total nitrogen'],['tp','Total phosphorus'],
        ['ssc','Suspended sediment'],['tss','Total suspended solids']],series))+'</div>'+
      '<div class="annual-buttons">'+action('select-visible','Select usable records on this page')+
      action('clear-selection','Clear selection')+'</div>'+
      table(['Use','Original station','Constituent','Published estimate','Reference period','Catchment source',''],reviewRows)+
      '<div class="annual-buttons">'+action('previous','Previous page','',page===0?'disabled':'')+
      '<span>Page '+(page+1)+' of '+pages+' · '+filtered.length+' matching records</span>'+
      action('next','Next page','',page>=pages-1?'disabled':'')+'</div>'+
      '<p class="annual-help">Choose one sediment constituent per catchment: SSC and TSS retain distinct measurement definitions. Catchment geometry and source/model periods remain available in calibration.</p>'+
      '<div class="annual-fields">'+field('Observation edition title','<input name="title" value="'+esc(draft.title)+'">')+
      field('Study comparability note','<textarea name="comparability_note" rows="3">'+esc(draft.comparability_note)+'</textarea>',
        'Record the relevant relationship between these historical annual references and the selected model inputs.')+
      '</div><div class="annual-buttons">'+action('import','Import selected loads and catchments','',
        pending||!selected.length?'disabled':'class="primary"')+'</div></section>';
  }
  function render() {
    if(!root || workspace!==current() || root.querySelector('.annual-record-dialog')?.open) return;
    root.innerHTML='<div class="annual-reference"><header class="page-header"><div><p class="eyebrow">ORIGINAL ANNUAL REFERENCES</p>'+
      '<h1>Annual load observations</h1><p>Receive the published source, select its actual station records and carry those observations into native-model calibration.</p></div>'+
      action('refresh','Refresh')+'</header>'+(error?'<div class="annual-error" role="alert">'+esc(error)+'</div>':'')+
      (pending?'<p role="status">Submitting the selected operation…</p>':'')+
      (catalog?sourceForm()+recordTable()+savedOperations():'<p role="status">Loading annual-reference sources…</p>')+
      '<dialog class="annual-record-dialog"><div data-record-content></div><form method="dialog"><button>Close</button></form></dialog></div>';
  }
  function operationById(id) { return (catalog?.operations||[]).find(row=>row.task_id===id); }
  async function browse(path, offset=0) {
    if(!draft.root_id) throw Error('Choose a registered source folder first.');
    browsing=true; if(offset===0) files=null; render();
    files=await read('files',{root_id:draft.root_id,path,offset,limit:100});render();
  }
  function detail(id) {
    const row=inventory?.records.find(row=>row.record_id===id);
    if(!row) return;
    const dialog=root.querySelector('.annual-record-dialog');
    dialog.querySelector('[data-record-content]').innerHTML='<h2>'+esc(row.station_name||row.station_id)+
      ' · '+esc(row.series.toUpperCase())+'</h2><p>Published estimator: '+esc(methodLabel(row))+
      '. Original load field: '+esc(row.selected_load_field)+'.</p><p>'+
      (row.temporal_basis?.scope==='source_global'?
        'The displayed period is the published regional calibration-target horizon. The original source record and its method attributes are retained below.':
        'The included source period and original water-quality dates are retained below.')+'</p><pre>'+esc(JSON.stringify(row,null,2))+'</pre>';
    dialog.addEventListener('close',()=>render(),{once:true});
    dialog.showModal();
  }
  async function perform(button) {
    const name=button.dataset.annualAction, id=button.dataset.id;
    if(name==='refresh') return refresh();
    if(name==='open-inventory') return openInventory(id);
    if(name==='task') return host.showTask(id);
    if(name==='browse') return browse(draft.path);
    if(name==='directory') return browse(id);
    if(name==='directory-next') return browse(files.path,Number(id));
    if(name==='choose-directory'){draft.path=id;browsing=false;files=null;save();return render();}
    if(name==='close-browser'){browsing=false;return render();}
    if(name==='record-detail') return detail(id);
    if(name==='previous'){page--;return render();}
    if(name==='next'){page++;return render();}
    if(name==='clear-selection'){chosen.clear();save();return render();}
    if(name==='select-visible'){
      for(const row of rows().slice(page*40,page*40+40)) if(!row.issues.length&&row.catchment_choices.length){
        chosen.set(row.record_id,chosen.get(row.record_id)||row.catchment_choices[0].id);
      }
      save();return render();
    }
    if(name==='study-calibration'){
      const entry=operationById(id);
      if(!entry?.binding)throw Error('This operation has not imported an observation edition.');
      return host.openExtension('ensembles','annualReference',{
        workspace_key:workspace,annual_import_id:id,title:entry.title});
    }
    if(name==='calibrate'){
      const entry=operationById(id), binding=entry?.binding;
      if(!binding) throw Error('This operation has not imported an observation edition.');
      return host.openExtension('calibration','openForObservations',{
        observation_id:binding.observation_id,catchments:binding.catchments,
        temporal_weighting:binding.recommended_temporal_weighting,title:entry.title});
    }
    if(name==='inventory'){
      const huc8=draft.huc8.split(/[\s,;]+/).filter(Boolean);
      if(!huc8.length || huc8.some(value=>!/^[0-9]{8}$/.test(value))) throw Error('Enter the original eight-digit HUC codes.');
      if(draft.mode==='registered'&&!draft.root_id) throw Error('Choose the registered source folder.');
      if(draft.mode==='uploads'&&(!draft.load_upload_id||!draft.site_upload_id)) throw Error('Choose both original ZIP uploads.');
      pending=true;render();
      if(edition().available===false)throw Error('Receive the complete adapter for this source edition first.');
      await host.submitAction('annual-reference.inventory',{source_edition:draft.source_edition,
        mode:draft.mode,root_id:draft.root_id,path:draft.path,
        load_upload_id:draft.load_upload_id,site_upload_id:draft.site_upload_id,huc8,
        title:edition().title+' · '+huc8.join(', ')});
      return;
    }
    if(name==='import'){
      const selected=selectedRows();
      if(!inventory || !selected.length || !draft.title.trim()) throw Error('Select source records and name the observation edition.');
      const uses=new Set();
      for(const row of selected) {
        const choice=chosen.get(row.record_id);
        const identity=choice.includes('reach')?'reach:'+row.comid:
          choice==='flow-station'?'station:'+row.flow_station_id:'station:'+row.station_id;
        const pair=identity+':'+row.parameter;
        if(uses.has(pair)) throw Error('Choose one original '+row.parameter+' series for '+row.station_id+
          '. SSC and TSS cannot both represent the same catchment.');
        uses.add(pair);
      }
      pending=true;render();
      await host.submitAction('annual-reference.import',{inventory_task_id:inventory.task_id,title:draft.title.trim(),
        comparability_note:draft.comparability_note,records:selected.map(row=>({
          record_id:row.record_id,catchment:chosen.get(row.record_id)}))});
    }
  }
  async function click(event) {
    const button=event.target.closest?.('[data-annual-action]');
    if(!button || !root?.contains(button) || button.disabled) return;
    event.preventDefault(); event.stopPropagation();
    if(pending) return;
    const token=epoch, selected=workspace;
    try { error='';await perform(button); }
    catch(err) { if(still(token,selected)) error=err.message||String(err); }
    finally { if(still(token,selected)){pending=false;render();} }
  }
  function change(event) {
    const element=event.target, name=element.name;
    if(name==='record') {
      const row=inventory?.records.find(row=>row.record_id===element.value);
      if(element.checked&&row) {
        const field=element.closest('tr').querySelector('[name="catchment"]');
        chosen.set(row.record_id,field.value);
      } else chosen.delete(element.value);
      save();render();return;
    }
    if(name==='catchment') {
      if(chosen.has(element.dataset.record)) chosen.set(element.dataset.record,element.value);
      save();return;
    }
    if(name==='series'){series=element.value;page=0;save();render();return;}
    if(Object.hasOwn(draft,name)) {
      draft[name]=element.value;
      if(name==='source_edition'){
        inventoryRequest++;inventory=null;chosen.clear();query='';series='';page=0;
        files=null;browsing=false;draft.mode=edition().modes[0];normalizeMode();
      }
      if(name==='root_id'){draft.path='';files=null;browsing=false;}
      save();
      if(['source_edition','mode','root_id'].includes(name)) render();
    }
  }
  function input(event) {
    const element=event.target;
    if(element.name==='query') {
      const position=element.selectionStart;
      query=element.value;page=0;save();render();
      const target=root.querySelector('[name="query"]');target.focus();target.setSelectionRange(position,position);
    } else if(Object.hasOwn(draft,element.name)) {draft[element.name]=element.value;save();}
  }
  async function mount(node) {
    detach();
    root=node;workspace=current();epoch++;
    Object.assign(draft,defaults);query='';series='';page=0;
    const savedInventory=restore(), token=epoch, selected=workspace;
    root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('input',input);
    render();await refresh();
    if(savedInventory && still(token,selected)) {
      try {await openInventory(savedInventory);} catch(err){if(still(token,selected)){error=err.message;render();}}
    }
  }
  function update(state) {
    if(!root || workspace!==state?.workspace_key) return;
    const value=state?.data?.annual_references?.operations || [];
    const signature=JSON.stringify(value.map(row=>[row.task_id,row.state,row.updated_at]));
    if(signature!==taskSignature){taskSignature=signature;void refresh();}
  }
  function detach() {
    if(root){root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('input',input);}
    root=null;workspace=null;catalog=null;inventory=null;chosen=new Map();error='';pending=false;
    files=null;browsing=false;loading=null;taskSignature='';epoch++;inventoryRequest++;
  }
  return {mount,update,detach};
}
