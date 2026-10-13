/** Original completed NLCD matrices, selected HUC support, and retained scientific reports. */
const rows=value=>Array.isArray(value)?value:[];
const clone=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const originalId=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const choiceKey=value=>JSON.stringify([value.source_collection_id,value.analysis_source_id,value.analysis_sha256]);
const number=(value,digits=3)=>value===null||value===undefined?'Not available':Number(value).toLocaleString(undefined,{maximumFractionDigits:digits});
const changedShare=(value,paired)=>value===null||value===undefined?'Changed share unavailable · '+number(paired,0)+' paired-valid cells':number(value)+'% of paired-valid cells changed class';
const cell=value=>'<td title="'+esc(value??'Not available')+'">'+esc(number(value))+'</td>';
const table=(columns,body)=>'<div class="olc-scroll"><table><thead><tr>'+columns.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></div>';
const action=(id,title,extra='')=>'<button type="button" data-lc-action="'+esc(id)+'" '+extra+'>'+esc(title)+'</button>';
const options=(values,current,label)=>'<option value="">'+esc(label)+'</option>'+values.map(row=>'<option value="'+esc(row.value)+'"'+(row.value===current?' selected':'')+'>'+esc(row.label)+'</option>').join('');

export function renderObservedLandcover(report,{huc='',unit='ha'}={}){
  const view=huc?rows(report.watersheds).find(row=>row.huc12===huc):report.summary;
  if(!view)throw Error('Choose an original selected watershed from this retained comparison.');
  const classes=rows(report.classes),years=report.binding.rasters,before=years.before.year,after=years.after.year;
  const transitions=new Map(rows(view.transitions).map(row=>[row.before_class+'|'+row.after_class,row]));
  const measure=row=>unit==='cells'?row.cells:unit==='percent'?row.percent_of_before_paired:row.area_ha;
  const unitLabel=unit==='cells'?'Cells':unit==='percent'?'% of earlier paired class':'Hectares';
  const support=[['Selected native cells',view.selected_cells],['Valid in both years',view.paired_valid_cells],
    ['Valid only in '+before,view.valid_before_only_cells],['Valid only in '+after,view.valid_after_only_cells],
    ['NoData in both years',view.both_nodata_cells],['Stable class cells',view.stable_class_cells],
    ['Changed class cells',view.changed_class_cells]];
  let out='<h2>'+esc(huc?(huc+' · '+(view.properties?.name||'')):'Selected watershed union')+'</h2>'+
    '<p>'+esc(before+' → '+after)+' · '+esc(changedShare(view.changed_percent_of_paired_valid,view.paired_valid_cells))+
    ' · '+esc(number(view.changed_area_ha))+' ha.</p>'+
    '<div class="olc-metrics">'+support.map(([label,value])=>'<div><span>'+esc(label)+'</span><strong>'+esc(number(value,0))+'</strong></div>').join('')+'</div>'+
    '<p class="olc-note">'+esc(report.interpretation)+'</p>'+
    '<h3>Full directional matrix · '+esc(unitLabel)+'</h3><p>Rows are '+esc(before)+', columns are '+esc(after)+
    '. The diagonal is unchanged class. Percentages use each earlier class’s paired-valid cells; empty earlier classes remain Not available.</p>'+
    table([before+' / '+after,...classes.map(row=>row.code)],classes.map(left=>'<tr><th scope="row">'+esc(left.code+' '+left.label)+'</th>'+
      classes.map(right=>{const row=transitions.get(left.code+'|'+right.code);if(!row)throw Error('The original directional matrix is incomplete.');
        return '<td class="'+(left.code===right.code?'olc-diagonal':'')+'" title="'+esc(left.label+' → '+right.label+'; '+row.cells+' cells; '+row.area_ha+' ha')+'">'+esc(number(measure(row),unit==='cells'?0:3))+'</td>';}).join('')+'</tr>').join(''))+
    '<h3>Gains, losses and independent annual inventories</h3><p>Gains and losses exclude unchanged class cells and use only paired support. Independent annual values include the year’s unmatched valid cells.</p>'+
    table(['Class','Description',before+' paired ha',after+' paired ha','Gained ha','Lost ha','Net ha',before+' all-valid ha',after+' all-valid ha',before+' only cells',after+' only cells'],
      rows(view.classes).map(row=>'<tr><th scope="row">'+esc(row.class_code)+'</th><td>'+esc(row.label)+'</td>'+
        ['before_ha','after_ha','gained_ha','lost_ha','net_ha','annual_before_ha','annual_after_ha','before_only_cells','after_only_cells'].map(key=>cell(row[key])).join('')+'</tr>').join(''))+
    '<details><summary>Every directional change with nonzero cells</summary>'+
    table([before+' class',after+' class','Cells','Hectares','% of earlier paired class'],
      rows(view.transitions).filter(row=>row.before_class!==row.after_class&&row.cells>0).sort((a,b)=>b.cells-a.cells||a.before_class-b.before_class||a.after_class-b.after_class).map(row=>'<tr><td>'+esc(row.before_class)+'</td><td>'+esc(row.after_class)+'</td>'+cell(row.cells)+cell(row.area_ha)+cell(row.percent_of_before_paired)+'</tr>').join(''))+'</details>'+
    '<details><summary>Each original selected watershed and its complete support</summary>'+
    table(['HUC12','Original name','Paired cells','Changed cells','Changed %','Earlier-only cells','Later-only cells','Both NoData'],
      rows(report.watersheds).map(row=>'<tr><th scope="row">'+esc(row.huc12)+'</th><td>'+esc(row.properties?.name||'')+'</td>'+
        ['paired_valid_cells','changed_class_cells','changed_percent_of_paired_valid','valid_before_only_cells','valid_after_only_cells','both_nodata_cells'].map(key=>cell(row[key])).join('')+'</tr>').join(''))+'</details>'+
    '<details><summary>Original source editions, grid and method</summary><p>Cell area: '+esc(report.binding.method.cell_area_m2)+
    ' m². '+esc(report.binding.method.pixel_rule)+'. Selected watersheds have zero overlapping selected cells.</p>'+
    '<pre>'+esc(JSON.stringify({selection:report.selection,rasters:report.binding.rasters,
      grid:report.binding.grid,source_domain_sha256:report.binding.source_domain_sha256,
      coordinate_operation:report.binding.coordinate_operation,source_entries:report.binding.inputs},null,2))+'</pre></details>';
  return out;
}

export function attachObservedLandcover(host){
  const {getState,api,endpoint,toast,openForm,submitAction,openScientificReport,openDesk}=host;
  let root=null,workspace=null,epoch=0,catalogRead=0,inputRead=0,comparisonRead=0,events=null,catalog=null,inputs=null,preview=null,opened=null;
  const contexts=new Map();
  const state=()=>getState()?.workspace_key||'';
  const find=s=>root?.querySelector(s);
  const field=name=>find('[name="'+name+'"]');
  const contextsKey=w=>'upstate.observed-landcover:'+w;
  const context=w=>{
    if(!contexts.has(w)){
      let saved={};try{saved=JSON.parse(globalThis.localStorage?.getItem(contextsKey(w))||'{}');}catch{}
      contexts.set(w,{draft:{source:'',huc12s:[],title:'Selected watershed land-cover changes',filter:'',unit:'ha',...saved.draft},
        lastOpened:saved.lastOpened||'',lastTask:saved.lastTask||'',observedTasks:new Set(),edit:0});
    }return contexts.get(w);
  };
  const alive=(w,g)=>Boolean(root&&workspace===w&&epoch===g&&state()===w);
  const note=(message,error=false)=>{const node=find('[data-lc-note]');if(node){node.textContent=message;node.setAttribute('role',error?'alert':'status');}};
  function persist(w){
    const c=context(w);try{globalThis.localStorage?.setItem(contextsKey(w),JSON.stringify({draft:c.draft,lastOpened:c.lastOpened,lastTask:c.lastTask}));}
    catch{note('Browser draft storage is unavailable. Completed comparisons remain in the original Workspace.');}
  }
  function selection(){
    const c=context(workspace),source=rows(catalog?.sources).find(row=>choiceKey(row)===c.draft.source);
    if(!source)throw Error('Choose a retained original annual land-cover source.');
    if(!c.draft.huc12s.length)throw Error('Select one or more original HUC12 watersheds.');
    return {...clone(source),title:c.draft.title.trim(),huc12s:[...c.draft.huc12s].sort()};
  }
  function clearPreview(){
    ++comparisonRead;preview=null;opened=null;const node=find('[data-lc-result]');if(node)node.replaceChildren();
    const tools=find('[data-lc-result-tools]');if(tools)tools.replaceChildren();
  }
  function controls(){
    return '<div class="observed-landcover"><header><p>ORIGINAL ANNUAL NLCD</p><h1>Observed watershed change</h1>'+
      '<p>Select original watersheds from the completed annual classification analysis. Inspect directional changes, retain the original support and prepare a scientific report.</p></header>'+
      '<div data-lc-note role="status" aria-live="polite"></div><section class="olc-panel"><div class="olc-toolbar">'+
      action('refresh','Refresh retained sources')+action('import','Import completed 217-HUC source')+'</div>'+
      '<label>Original analysis<select name="source"></select></label><div data-lc-source></div>'+
      '<div class="olc-toolbar"><label>Find HUC12, name or state<input name="filter" type="search"></label>'+
      action('select-visible','Select visible')+action('clear','Clear selection')+'<span data-lc-count></span></div>'+
      '<div class="olc-watersheds" data-lc-watersheds></div><label>Comparison title<input name="title" maxlength="240" required></label>'+
      '<div class="olc-toolbar">'+action('preview','Inspect selected watersheds')+action('save','Save comparison and report source')+'</div></section>'+
      '<section class="olc-panel"><h2>Saved comparisons</h2><label>Original saved selection<select name="edition"></select></label>'+
      action('open','Open saved comparison')+'</section><div data-lc-result-tools></div><div data-lc-result></div></div>';
  }
  function filtered(){
    const query=context(workspace).draft.filter.trim().toLowerCase();
    return rows(inputs?.watersheds).filter(row=>!query||[row.huc12,row.properties?.name,row.properties?.states].join(' ').toLowerCase().includes(query));
  }
  function updateCount(){
    if(root)find('[data-lc-count]').textContent=context(workspace).draft.huc12s.length+' selected · '+filtered().length+' visible · '+rows(inputs?.watersheds).length+' original watersheds';
  }
  function renderWatersheds(){
    if(!root)return;
    const c=context(workspace),selected=new Set(c.draft.huc12s),visible=filtered();
    find('[data-lc-watersheds]').innerHTML=visible.length?visible.map(row=>'<label class="olc-check"><input type="checkbox" name="huc12" value="'+esc(row.huc12)+'"'+
      (selected.has(row.huc12)?' checked':'')+'><span><strong>'+esc(row.huc12)+' · '+esc(row.properties?.name||'')+'</strong><small>'+
      esc(row.properties?.states||'')+' · '+esc(number(row.paired_valid_cells,0))+' paired cells · '+esc(changedShare(row.changed_percent_of_paired_valid,row.paired_valid_cells))+
      '</small></span></label>').join(''):'<p>Select an original analysis to list its retained watershed inventory.</p>';
    updateCount();
  }
  async function loadInputs(){
    const w=workspace,g=epoch,ticket=++inputRead,c=context(w),chosen=c.draft.source;
    inputs=null;clearPreview();renderWatersheds();
    const source=rows(catalog?.sources).find(row=>choiceKey(row)===chosen);if(!source)return;
    note('Reading original annual inventories, directional matrices and source support…');
    const result=await api(endpoint('/api/observed-landcover/inputs',{workspace:w}),{method:'POST',body:{selection:clone(source)}});
    if(!alive(w,g)||ticket!==inputRead||c.draft.source!==chosen)return;
    const exact=choiceKey(result.binding);if(exact!==chosen)throw Error('The returned original analysis differs from the selected source.');
    inputs=result;
    const valid=new Set(rows(result.watersheds).map(row=>row.huc12));
    c.draft.huc12s=c.draft.huc12s.filter(id=>valid.has(id));persist(w);renderWatersheds();
    const years=result.binding.rasters;
    find('[data-lc-source]').textContent=years.before.year+' → '+years.after.year+' · '+result.watersheds.length+' original HUC12s · '+result.binding.method.pixel_rule;
    note('Original source edition opened. Choose watersheds for a retained comparison.');
  }
  async function refresh({load=true}={}){
    const w=workspace,g=epoch,ticket=++catalogRead,c=context(w),chosen=c.draft.source;
    const result=await api(endpoint('/api/observed-landcover/catalog',{workspace:w}));
    if(!alive(w,g)||ticket!==catalogRead)return false;
    catalog=result;
    if(!rows(result.sources).some(row=>choiceKey(row)===chosen))c.draft.source='';
    field('source').innerHTML=options(rows(result.sources).map(row=>({value:choiceKey(row),label:row.title+' · '+row.analysis_sha256.slice(0,12)})),c.draft.source,'Choose original source');
    field('edition').innerHTML=options(rows(result.selections).map(row=>({value:row.id,label:row.title+' · '+row.huc12s.length+' HUCs'})),c.lastOpened,'Choose saved comparison');
    find('[data-lc-action="import"]').disabled=!result.published_source_available;
    persist(w);
    if(load&&c.draft.source)await loadInputs();
    return true;
  }
  async function readPreview(){
    const w=workspace,g=epoch,c=context(w),ticket=++comparisonRead,edit=c.edit,chosen=selection();
    note('Reading the complete selected directional comparison…');
    const report=await api(endpoint('/api/observed-landcover/inputs',{workspace:w}),{method:'POST',body:{selection:clone(chosen)}});
    if(!alive(w,g)||ticket!==comparisonRead||edit!==c.edit)return null;
    if(choiceKey(report.selection)!==choiceKey(chosen)||JSON.stringify(report.selection.huc12s)!==JSON.stringify(chosen.huc12s))
      throw Error('The returned comparison uses another original watershed selection.');
    preview={report,edit,payload:clone(chosen)};opened=null;renderReport(report);note('Selected original comparison opened. Save to retain its portable files and scientific report source.');
    return preview;
  }
  function renderReport(report,downloads=[]){
    const c=context(workspace);
    find('[data-lc-result-tools]').innerHTML='<section class="olc-panel"><div class="olc-toolbar"><label>Reporting area<select name="view_huc">'+
      '<option value="">All selected watersheds · unique union</option>'+rows(report.watersheds).map(row=>'<option value="'+esc(row.huc12)+'">'+esc(row.huc12+' · '+row.properties?.name)+'</option>').join('')+
      '</select></label><label>Matrix quantity<select name="unit">'+[['ha','Hectares'],['cells','Cells'],['percent','% of earlier paired class']].map(([value,title])=>'<option value="'+value+'"'+(c.draft.unit===value?' selected':'')+'>'+esc(title)+'</option>').join('')+'</select></label>'+
      (opened?action('compose','Open in Scientific Reports'):'')+'</div><div class="olc-downloads">'+rows(downloads).map(row=>{
        if(typeof row.url!=='string'||!/^\/api\/file\//.test(row.url))throw Error('An original download ticket is missing.');
        return '<a href="'+esc(row.url+(row.url.includes('?')?'&':'?')+'download=1')+'">'+esc(row.label||row.filename)+'</a>';
      }).join('')+'</div></section>';
    renderValues(report);
  }
  function renderValues(report=opened?.report||preview?.report){
    if(report)find('[data-lc-result]').innerHTML=renderObservedLandcover(report,{huc:field('view_huc')?.value||'',unit:context(workspace).draft.unit});
  }
  async function openSaved(id){
    if(!originalId(id))throw Error('Choose a complete saved original comparison ID.');
    const w=state();if(!root||workspace!==w){if(typeof openDesk!=='function')throw Error('Open the Observed watershed change desk.');return openDesk('observed-landcover','openSaved',id);}
    const g=epoch,ticket=++comparisonRead;note('Opening the retained comparison and original downloads…');
    const result=await api(endpoint('/api/observed-landcover/edition',{workspace:w,id}));
    if(!alive(w,g)||ticket!==comparisonRead)return;
    if(result.edition?.id!==id||result.edition.project_id!==getState()?.data?.project?.id)throw Error('The saved comparison belongs to another original project.');
    opened=result;preview=null;context(w).lastOpened=id;persist(w);
    renderReport(result.report,result._downloads);if(field('edition'))field('edition').value=id;
    note('Retained original comparison opened. The ZIP includes all selected tables, the report recipe and original result documents.');
    return result;
  }
  async function saveSelection(){
    const w=workspace,g=epoch,c=context(w);
    const checked=preview?.edit===c.edit?preview:await readPreview();
    if(!checked||!alive(w,g))return;
    const frozen=clone(checked.payload),report=checked.report;
    openForm('Save observed watershed comparison','Retain the full selected comparison, original source documents and Scientific Reports source.',
      '<p>'+esc(frozen.huc12s.length)+' original HUC12s · '+esc(number(report.summary.paired_valid_cells,0))+
      ' paired-valid cells · '+esc(changedShare(report.summary.changed_percent_of_paired_valid,report.summary.paired_valid_cells))+'.</p><p>'+esc(report.title)+
      '</p><details><summary>Frozen original selection</summary><pre>'+esc(JSON.stringify(frozen,null,2))+'</pre></details>',
      'Save complete comparison',async()=>{
        if(state()!==w||!alive(w,g))throw Error('Reopen this selected comparison in its original Workspace.');
        const result=await submitAction('observed.landcover.save',clone(frozen));
        if(result?.id){c.lastTask=result.id;persist(w);}
        return result;
      });
  }
  function importPublished(){
    const w=workspace,g=epoch;
    openForm('Import original completed annual source','Retain the published 217-HUC annual inventories and full directional matrices in this Workspace.',
      '<p>The original analysis-run document binds the annual 2023 and 2025 source results and their hashes. The native source importer retains their complete bytes.</p>',
      'Import original results',async()=>{
        if(state()!==w||!alive(w,g))throw Error('Reopen source import in its original Workspace.');
        const result=await submitAction('observed.landcover.import',{});
        if(result?.id){context(w).lastTask=result.id;persist(w);}
        return result;
      });
  }
  async function compose(){
    if(!opened)throw Error('Open a saved comparison before creating its scientific report.');
    const w=workspace,source=clone(opened.edition.source),title=opened.edition.title;
    if(state()!==w)throw Error('Open this report in its original Workspace.');
    return openScientificReport({workspace_key:w,sources:[source],title});
  }
  async function click(actionName,button){
    if(actionName==='refresh')return refresh({load:!opened&&!preview});
    if(actionName==='import')return importPublished();
    if(actionName==='preview')return readPreview();
    if(actionName==='save')return saveSelection();
    if(actionName==='open')return openSaved(field('edition').value);
    if(actionName==='compose')return compose();
    const c=context(workspace);
    if(actionName==='select-visible')c.draft.huc12s=[...new Set([...c.draft.huc12s,...filtered().map(row=>row.huc12)])].sort();
    else if(actionName==='clear')c.draft.huc12s=[];
    else throw Error('Choose an original observed watershed action.');
    c.edit++;clearPreview();persist(workspace);renderWatersheds();
  }
  async function dispatch(button){
    const type=button?.dataset?.action;
    if(type==='observed-lc-open')return openSaved(button.dataset.id);
    if(type==='observed-lc-source'){
      if(!root||workspace!==state())return openDesk('observed-landcover','openImported',clone(button.dataset));
      return openImported(button.dataset);
    }
    return false;
  }
  async function openImported(value){
    const w=state();if(!root||workspace!==w)return openDesk('observed-landcover','openImported',value);
    await refresh({load:false});if(workspace!==w||state()!==w)return;
    const found=rows(catalog?.sources).find(row=>row.source_collection_id===value.collection&&row.analysis_source_id===value.source);
    if(!found)throw Error('The original imported analysis is not in this Workspace catalogue.');
    context(w).draft.source=choiceKey(found);context(w).draft.huc12s=[];context(w).edit++;field('source').value=choiceKey(found);persist(w);
    return loadInputs();
  }
  function taskActions(task){
    if(task?.workspace!==state()||task.state!=='complete')return '';
    if(task.action==='observed.landcover.save'&&originalId(task.result?.id))
      return '<button type="button" data-action="observed-lc-open" data-id="'+esc(task.result.id)+'">Open selected watershed comparison</button>';
    if(task.action==='observed.landcover.import'&&originalId(task.result?.source_collection_id))
      return '<button type="button" data-action="observed-lc-source" data-collection="'+esc(task.result.source_collection_id)+'" data-source="'+esc(task.result.analysis_source_id)+'">Choose original watersheds</button>';
    return '';
  }
  function changed(event){
    const target=event.target,c=context(workspace),name=target.name;
    if(name==='source'){
      c.draft.source=target.value;c.draft.huc12s=[];c.edit++;persist(workspace);
      const w=workspace,g=epoch;loadInputs().catch(error=>{if(alive(w,g))note(error.message,true);});return;
    }
    if(name==='filter'){c.draft.filter=target.value;persist(workspace);renderWatersheds();return;}
    if(name==='view_huc'){renderValues();return;}
    if(name==='unit'){c.draft.unit=target.value;persist(workspace);renderValues();return;}
    if(name==='huc12'){
      const chosen=new Set(c.draft.huc12s);if(target.checked)chosen.add(target.value);else chosen.delete(target.value);c.draft.huc12s=[...chosen].sort();updateCount();
    }else if(name==='title')c.draft.title=target.value;
    else return;
    c.edit++;clearPreview();persist(workspace);
  }
  function detach(){++epoch;++catalogRead;++inputRead;++comparisonRead;events?.abort();events=null;root=null;workspace=null;catalog=null;inputs=null;preview=null;opened=null;}
  async function mount(container){
    if(root===container&&workspace===state())return update();
    detach();root=container;workspace=state();const w=workspace,g=epoch,c=context(w);
    root.innerHTML=controls();events=new AbortController();
    field('title').value=c.draft.title;field('filter').value=c.draft.filter;
    root.addEventListener('change',event=>{if(!['title','filter'].includes(event.target.name))changed(event);},{signal:events.signal});
    root.addEventListener('input',event=>{if(['title','filter'].includes(event.target.name))changed(event);},{signal:events.signal});
    root.addEventListener('click',event=>{
      const button=event.target.closest('[data-lc-action]');if(!button)return;event.preventDefault();
      Promise.resolve().then(()=>click(button.dataset.lcAction,button)).catch(error=>{if(alive(w,g))note(error.message||String(error),true);});
    },{signal:events.signal});
    try{
      const initialEdit=c.edit;
      await refresh({load:false});
      if(!alive(w,g)||c.edit!==initialEdit)return;
      if(c.draft.source)await loadInputs();
      if(!alive(w,g)||c.edit!==initialEdit)return;
      if(c.lastOpened)await openSaved(c.lastOpened);
      else if(!c.draft.source)note('Import the completed original source or select a retained analysis.');
    }catch(error){if(alive(w,g))note(error.message||String(error),true);}
  }
  function update(){
    if(!root)return;
    if(workspace!==state()){const target=root;return mount(target);}
    const c=context(workspace),task=rows(getState()?.tasks).find(row=>row.id===c.lastTask&&row.workspace===workspace);
    if(task&&task.state==='complete'&&!c.observedTasks.has(task.id)){
      c.observedTasks.add(task.id);persist(workspace);
      note('Original operation completed. Open its result from Tasks or refresh the saved comparison list.');
      const w=workspace,g=epoch;refresh({load:false}).catch(error=>{if(alive(w,g))note('Operation retained. Catalogue refresh: '+error.message,true);});
    }
  }
  return {mount,update,detach,dispatch,taskActions,openSaved,openImported};
}
