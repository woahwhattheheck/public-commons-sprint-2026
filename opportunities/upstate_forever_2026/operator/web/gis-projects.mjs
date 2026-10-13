/** Complete GIS export/receiving panel using the original Operator API and task queue. */
export function attachGISProjects({getState, api, refreshState, showTask, toast}) {
  let root=null, catalogue=null, controller=null, signature='', activeWorkspace=null;
  let pending=null, lastSelection=null, intakeVersion=0, intakeLoading=false;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pretty=n=>Number(n||0).toLocaleString();
  const options=(rows,label)=>'<option value="">None selected</option>'+rows.map(x=>'<option value="'+esc(x.id)+'">'+esc(label(x))+'</option>').join('');
  const storageKey=ws=>'upstate-gis-selection:'+ws;
  function error(message){const box=root?.querySelector('[data-gis-error]');if(box){box.textContent=message;box.hidden=!message;}}
  function readSaved(){try{return JSON.parse(localStorage.getItem(storageKey(activeWorkspace))||'null');}catch{return null;}}
  function saveSelection(value){lastSelection=value;try{localStorage.setItem(storageKey(activeWorkspace),JSON.stringify(value));}catch{}}
  function stateSignature(state){return JSON.stringify({workspace:state?.workspace_key,
    sources:state?.data?.sources?.map(x=>x.id),grids:state?.data?.grids?.map(x=>[x.id,x.state]),
    runs:state?.data?.runs?.map(x=>[x.id,x.state]),comparisons:state?.data?.comparisons?.map(x=>x.id),
    deliveries:state?.data?.deliveries?.map(x=>[x.id,x.state]),
    tasks:state?.tasks?.filter(x=>x.action?.startsWith('gis.project.')).map(x=>[x.id,x.state])});}
  function selected(name){return root?.querySelector('[name="'+name+'"]');}
  function sourceChoices(collection,saved){
    const list=root?.querySelector('[data-gis-sources]');if(!list)return;
    const all=catalogue?.sources.find(x=>x.id===collection)?.entries||[];
    const rows=all.filter(x=>!x.gis_required_context),context=all.filter(x=>x.gis_required_context);
    const keys=saved?.sources?new Set(saved.sources.map(x=>x.source_id)):null;
    list.innerHTML=rows.length?rows.map(x=>'<label class="gis-choice"><input type="checkbox" name="source" value="'+esc(x.id)+'" '+((keys?keys.has(x.id):['vector','raster'].includes(x.kind))?'checked':'')+'><span>'+esc(x.title)+'<small>'+esc(x.kind)+' · '+esc(x.units||'original source metadata')+'</small></span></label>').join(''):'<p>Select an original source edition or use completed model results below.</p>';
    if(context.length)list.insertAdjacentHTML('beforeend','<details class="gis-context"><summary>'+pretty(context.length)+' original and attribution documents carried automatically</summary><p>These files accompany the associated selected working layers, including their original source companions and edition history.</p><ul>'+context.map(x=>'<li>'+esc(x.title)+'</li>').join('')+'</ul></details>');
  }
  function fillForm(saved){
    if(!root||!catalogue)return;
    selected('title').value=saved?.title||'Editable GIS · '+(getState()?.data?.project?.title||'Selected study');
    selected('project_crs').value=saved?.project_crs||'EPSG:5070';
    selected('delivery_id').value=saved?.delivery_id||'';
    const original=catalogue.sources.some(x=>x.id===saved?.source_collection_id)?saved.source_collection_id:
      (saved&&Array.isArray(saved.sources)?'':catalogue.sources[0]?.id||'');
    selected('source_collection_id').value=original;sourceChoices(original,saved);
    for(const name of ['grid_id','baseline_run_id'])if(saved?.[name])selected(name).value=saved[name];
    for(const name of ['scenario_run_ids','comparison_ids'])for(const input of root.querySelectorAll('[name="'+name+'"]'))input.checked=(saved?.[name]||[]).includes(input.value);
    selected('notes').value=(saved?.notes||[]).join('\n');
  }
  function links(record){return '<div class="gis-links"><a target="_blank" rel="noopener" href="'+esc(record.viewer_url)+'">Open layer view</a><a href="'+esc(record.archive_download.url)+'?download=1">Download complete editable ZIP</a></div>';}
  function adoptionForm(record){
    if(record.kind!=='received')return '';
    return '<details class="gis-adoption"><summary>Use edited working layers as new study sources</summary><p>This adds a new original source edition. Existing sources, grids, profiles and model runs stay unchanged.</p><form data-gis-adopt="'+esc(record.id)+'"><label>New source edition title<input name="adoption_title" value="'+esc('Received GIS sources · '+record.title)+'" required maxlength="240"></label><fieldset><legend>Working layers to adopt</legend>'+record.layer_choices.map(x=>'<label class="gis-choice"><input type="checkbox" name="adoption_layer" value="'+esc(x.id)+'" checked><span>'+esc(x.title)+'<small>'+esc(x.kind)+' · '+esc(x.units)+'</small></span></label>').join('')+'</fieldset><label>Reason for this source edition<textarea name="adoption_reason" required rows="2"></textarea></label><button type="submit">Adopt selected study sources</button></form></details>';
  }
  function records(rows){return rows.length?rows.map(x=>'<article class="gis-record"><h3>'+esc(x.title)+'</h3><p>'+pretty(x.layers)+' layers · '+pretty(x.bytes)+' bytes · '+esc(x.kind==='received'?'Received independent edition':'Retained scientific-workspace export')+'</p><p class="gis-id">Edition '+esc(x.result.edition_id)+'</p>'+links(x)+adoptionForm(x)+'</article>').join(''):'<p>No GIS projects in this section yet.</p>';}
  function adopted(){return (catalogue.adoptions||[]).map(x=>'<article class="gis-record"><h3>'+esc(x.title)+'</h3><p>'+pretty(x.sources.length)+' working layers adopted through the original source importer.</p><p class="gis-id">Source edition '+esc(x.source_collection_id)+'</p><button type="button" data-gis-use-source="'+esc(x.source_collection_id)+'">Select this source edition for export</button></article>').join('')||'<p>Received working layers can be adopted below each independent edition.</p>';}

  function render(){
    if(!root||!catalogue)return;
    const saved=lastSelection||readSaved();
    const completeRuns=catalogue.runs.filter(x=>x.state==='complete');
    const runName=x=>(x.title||'Native run')+' · '+x.id.slice(0,12);
    const deliveries=catalogue.deliveries||[];
    const deliveryOptions='<option value="">No delivery selected</option>'+deliveries.map(row=>
      '<option value="'+esc(row.id)+'"'+(!row.eligible?' disabled':'')+'>'+
      esc(row.title+' · '+(row.eligible?row.dataset_count+' GIS datasets':row.reason||row.state))+'</option>').join('')+
      (saved?.delivery_id&&!deliveries.some(row=>row.id===saved.delivery_id)?
       '<option value="'+esc(saved.delivery_id)+'" disabled>Unavailable retained delivery · '+esc(saved.delivery_id.slice(0,12))+'</option>':'');
    root.innerHTML='<section class="gis-workspace"><header><p class="eyebrow">UPPER SAVANNAH SCIENTIFIC WORKBENCH</p><h1>Editable GIS projects</h1><p>Export retained sources and physical results as a complete QGIS working directory. Receive a colleague’s revised edition without changing the original study.</p></header><p data-gis-error class="gis-error" role="alert" hidden></p><div class="gis-columns"><form data-gis-export><h2>Prepare a GIS handover</h2><label>Project title<input name="title" required maxlength="240"></label><label>Display coordinate system<input name="project_crs" required placeholder="EPSG:5070"></label><p class="gis-help">Display projection only. Working files retain their native coordinates, numerical cells and masks.</p><label>Completed map delivery<select name="delivery_id">'+deliveryOptions+'</select></label><p class="gis-help">Include the delivery’s actual exports, signed changes and selected priorities, with original maps, metadata and PDF reports. Choosing a delivery starts with those datasets; add other retained study selections explicitly below.</p><label>Original source edition<select name="source_collection_id">'+options(catalogue.sources,x=>x.title)+'</select></label><fieldset><legend>Complete retained source files</legend><div data-gis-sources></div></fieldset><label>Prepared study grid<select name="grid_id">'+options(catalogue.grids.filter(x=>x.state==='complete'),x=>(x.spec?.title||'Model grid')+' · '+x.id.slice(0,12))+'</select></label><label>Completed baseline run<select name="baseline_run_id">'+options(completeRuns,runName)+'</select></label><fieldset><legend>Completed alternative runs</legend>'+(completeRuns.length?completeRuns.map(x=>'<label class="gis-choice"><input type="checkbox" name="scenario_run_ids" value="'+esc(x.id)+'"><span>'+esc(runName(x))+'</span></label>').join(''):'<p>Complete native runs will appear here. Source-only GIS handover is available now.</p>')+'</fieldset><fieldset><legend>Existing signed comparisons</legend>'+(catalogue.comparisons.length?catalogue.comparisons.map(x=>'<label class="gis-choice"><input type="checkbox" name="comparison_ids" value="'+esc(x.id)+'"><span>'+esc(x.direction||'Retained comparison')+' · '+esc(x.id.slice(0,12))+'</span></label>').join(''):'<p>No saved comparison yet.</p>')+'</fieldset><label>Operator notes<textarea name="notes" rows="3" placeholder="Explain this selected handover in ordinary language."></textarea></label><button type="submit">Build complete GIS project</button><p class="gis-help">Uses the original retained task queue. The source scientific models are not rerun.</p></form><aside><section class="gis-receive"><h2>Receive an edited project</h2><p>Choose the complete ZIP after the sender seals its saved GIS edition. All working data, original files and history enter a new receiving directory.</p><form data-gis-receive><label>Complete GIS archive<input name="archive" type="file" accept=".zip" required></label><button type="submit">Receive independent edition</button></form></section><section class="gis-steps"><h2>Continue in desktop GIS</h2><ol><li>Download and extract the <strong>complete ZIP</strong>.</li><li>Open <strong>OPEN_GIS.html</strong> to inspect geography, layer provenance and units.</li><li>Open <strong>project.qgz</strong> in QGIS. Keep every accompanying directory together.</li><li>Edit the independent GeoPackage attributes or geometry; retain source layer identities.</li><li>Save and close editing, then follow the included <strong>seal → pack → receive</strong> instructions.</li></ol><p>Native layer metadata distinguishes physical results, signed changes, categorical data and contextual geometry.</p></section><button type="button" data-gis-refresh>Refresh retained projects</button></aside></div><section class="gis-outputs"><h2>Exported from this study</h2>'+records(catalogue.exports)+'</section><section class="gis-outputs"><h2>Received independent editions</h2>'+records(catalogue.received)+'</section><section class="gis-outputs"><h2>Adopted study source editions</h2>'+adopted()+'</section></section>';
    fillForm(saved);
    root.querySelector('[data-gis-export]').addEventListener('submit',submitExport);
    root.querySelector('[data-gis-receive]').addEventListener('submit',submitReceive);
    for(const form of root.querySelectorAll('[data-gis-adopt]'))form.addEventListener('submit',submitAdoption);
    for(const button of root.querySelectorAll('[data-gis-use-source]'))button.addEventListener('click',()=>{
      const source=catalogue.sources.find(x=>x.id===button.dataset.gisUseSource);
      if(!source)return error('Refresh the original source edition before selecting it.');
      saveSelection({title:source.title+' · editable GIS',project_crs:selected('project_crs').value||'EPSG:5070',source_collection_id:source.id,sources:source.entries.map(x=>({source_collection_id:source.id,source_id:x.id})),notes:[]});
      render();root.querySelector('[data-gis-export]').scrollIntoView({block:'start'});
    });
    selected('source_collection_id').addEventListener('change',event=>sourceChoices(event.target.value,null));
    selected('delivery_id').addEventListener('change',event=>{
      const id=event.target.value;if(!id)return;
      const delivery=(catalogue.deliveries||[]).find(row=>row.id===id&&row.eligible);
      if(!delivery)return error('Choose a current completed delivery with its retained dataset catalogue.');
      try{const value=deliverySelection(delivery);saveSelection(value);render();}catch(failure){error(failure.message);}
    });
    root.querySelector('[data-gis-refresh]').addEventListener('click',()=>load(true));
  }
  function formSelection(validate=true){
    const selectedIDs=name=>[...root.querySelectorAll('[name="'+name+'"]:checked')].map(x=>x.value);
    const sourceIDs=selectedIDs('source');const collection=selected('source_collection_id').value;
    const value={title:selected('title').value.trim(),project_crs:selected('project_crs').value.trim(),
      sources:sourceIDs.map(id=>({source_collection_id:collection,source_id:id})),
      scenario_run_ids:selectedIDs('scenario_run_ids'),comparison_ids:selectedIDs('comparison_ids'),
      include_grid:true,notes:selected('notes').value.split('\n').map(x=>x.trim()).filter(Boolean)};
    if(sourceIDs.length)value.source_collection_id=collection;
    for(const name of ['grid_id','baseline_run_id','delivery_id'])if(selected(name).value)value[name]=selected(name).value;
    if(validate&&value.scenario_run_ids.includes(value.baseline_run_id))throw new Error('Choose the baseline once; remove it from alternative runs.');
    if(validate&&value.delivery_id&&!(catalogue.deliveries||[]).some(row=>row.id===value.delivery_id&&row.eligible))
      throw new Error('Choose a current completed delivery with its retained dataset catalogue.');
    if(validate&&!sourceIDs.length&&!value.delivery_id&&!value.grid_id&&!value.baseline_run_id&&!value.scenario_run_ids.length&&!value.comparison_ids.length)throw new Error('Select a completed delivery, original source files, a completed grid, run or comparison.');
    return value;
  }
  function operation(action,payload){
    const key=JSON.stringify({workspace:activeWorkspace,action,payload});
    if(pending?.key===key)return pending;
    const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
    pending={key,operation_id:'gis-'+[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('')};return pending;
  }
  async function submit(action,payload){
    const workspace=activeWorkspace,op=operation(action,payload);
    let task;
    try{task=await api('/api/actions',{method:'POST',body:{workspace,action,payload,operation_id:op.operation_id}});}
    catch(original){
      // A lost response can already have committed the original queued operation.
      try{const state=await api('/api/state?'+new URLSearchParams({workspace}));task=state.tasks.find(x=>x.operation_id===op.operation_id);}catch{}
      if(!task)throw original;
    }
    if(!root||activeWorkspace!==workspace||getState()?.workspace_key!==workspace)return;
    toast('GIS operation queued in the original task list.');await showTask(task.id);await refreshState({force:true});
  }
  async function submitExport(event){
    event.preventDefault();event.stopPropagation();error('');const button=event.submitter;button.disabled=true;
    try{const value=formSelection();saveSelection(value);await submit('gis.project.export',value);}catch(e){error(e.message);}finally{button.disabled=false;}
  }
  async function submitReceive(event){
    event.preventDefault();event.stopPropagation();error('');const button=event.submitter;button.disabled=true;
    const workspace=activeWorkspace;
    try{const file=root.querySelector('[name="archive"]').files[0];if(!file)throw new Error('Select a complete GIS ZIP archive.');
      const uploaded=await api('/api/upload',{method:'POST',raw:file,filename:file.name});
      if(!root||activeWorkspace!==workspace||getState()?.workspace_key!==workspace)return;
      await submit('gis.project.receive',{upload_id:uploaded.id});
    }catch(e){error(e.message);}finally{button.disabled=false;}
  }
  async function submitAdoption(event){
    event.preventDefault();event.stopPropagation();error('');const form=event.currentTarget,button=event.submitter;button.disabled=true;
    try{
      const layer_ids=[...form.querySelectorAll('[name="adoption_layer"]:checked')].map(x=>x.value);
      if(!layer_ids.length)throw new Error('Choose at least one received working layer.');
      const payload={receipt_id:form.dataset.gisAdopt,title:form.querySelector('[name="adoption_title"]').value.trim(),reason:form.querySelector('[name="adoption_reason"]').value.trim(),layer_ids};
      if(!payload.title||!payload.reason)throw new Error('Name the source edition and explain its adoption.');
      await submit('gis.project.adopt-sources',payload);
    }catch(e){error(e.message);}finally{button.disabled=false;}
  }
  async function createForSources(request){
    const frozen=JSON.parse(JSON.stringify(request||{}));
    const workspace=getState()?.workspace_key,selection=frozen.selection;
    if(!root||!workspace||frozen.workspace_key!==workspace)
      throw new Error('Open the selected original workspace before preparing its GIS handover.');
    if(!selection||typeof selection!=='object'||!Array.isArray(selection.sources)||!selection.sources.length)
      throw new Error('Choose registered original sources for this GIS handover.');
    const collection=selection.source_collection_id;
    if(typeof collection!=='string'||!collection||selection.sources.some(row=>
       !row||row.source_collection_id!==collection||typeof row.source_id!=='string'||!row.source_id))
      throw new Error('Choose source members from one retained original collection.');
    const ids=selection.sources.map(row=>row.source_id);
    if(new Set(ids).size!==ids.length)throw new Error('Choose each original source once.');
    const title=selection.title,projectCRS=selection.project_crs;
    if(typeof title!=='string'||!title.trim()||title.length>240||typeof projectCRS!=='string'||!projectCRS.trim())
      throw new Error('Name the GIS handover and its display coordinate system.');
    const notes=selection.notes||[];
    if(!Array.isArray(notes)||notes.some(value=>typeof value!=='string'))
      throw new Error('Keep GIS handover notes as text.');
    const token=++intakeVersion,element=root;
    controller?.abort();const own=new AbortController();controller=own;intakeLoading=true;
    try{
      const data=await api('/api/gis/projects?'+new URLSearchParams({workspace}),{signal:own.signal});
      if(token!==intakeVersion||own.signal.aborted||root!==element||getState()?.workspace_key!==workspace)
        throw new Error('The workspace or source selection changed while opening the GIS handover.');
      if(data.workspace_key!==workspace)throw new Error('GIS response belongs to a different workspace.');
      const original=data.sources?.find(row=>row.id===collection);
      if(!original||ids.some(id=>!original.entries.some(row=>row.id===id)))
        throw new Error('Refresh the admitted source collection before preparing its GIS handover.');
      if(!original.entries.some(row=>ids.includes(row.id)&&['vector','raster'].includes(row.kind)))
        throw new Error('Include at least one original vector or raster layer in the GIS handover.');
      activeWorkspace=workspace;catalogue=data;signature=stateSignature(getState());
      const value={title:title.trim(),project_crs:projectCRS.trim(),source_collection_id:collection,
        sources:selection.sources.map(row=>({source_collection_id:collection,source_id:row.source_id})),
        scenario_run_ids:[],comparison_ids:[],include_grid:true,notes:[...notes]};
      saveSelection(value);render();
      root.querySelector('[data-gis-export]')?.scrollIntoView({block:'start'});
      return JSON.parse(JSON.stringify(value));
    }finally{if(token===intakeVersion)intakeLoading=false;}
  }

  function deliverySelection(delivery){
    if(typeof delivery.project_crs!=='string'||!delivery.project_crs.trim())
      throw new Error('The completed delivery has no retained display coordinate system.');
    return {title:(delivery.title+' · editable GIS').slice(0,240),project_crs:delivery.project_crs,
      delivery_id:delivery.id,sources:[],scenario_run_ids:[],comparison_ids:[],
      include_grid:true,notes:[]};
  }
  async function createForDelivery(request){
    const frozen=JSON.parse(JSON.stringify(request||{}));
    const workspace=getState()?.workspace_key;
    if(!root||!workspace||frozen.workspace_key!==workspace)
      throw new Error('Open the original delivery workspace before preparing its GIS project.');
    if(!/^[0-9a-f]{64}$/.test(frozen.delivery_id||''))
      throw new Error('Choose an original completed delivery identity.');
    const token=++intakeVersion,element=root;
    controller?.abort();const own=new AbortController();controller=own;intakeLoading=true;
    try{
      const data=await api('/api/gis/projects?'+new URLSearchParams({workspace}),{signal:own.signal});
      if(token!==intakeVersion||own.signal.aborted||root!==element||getState()?.workspace_key!==workspace)
        throw new Error('The workspace or delivery selection changed while opening the GIS project.');
      if(data.workspace_key!==workspace)throw new Error('GIS response belongs to a different workspace.');
      const delivery=data.deliveries?.find(row=>row.id===frozen.delivery_id);
      if(!delivery?.eligible){
        activeWorkspace=workspace;catalogue=data;signature=stateSignature(getState());
        // Keep the selected historical edition visible in the existing desk;
        // its original download and atlas remain unchanged.
        saveSelection({title:delivery?.title||'Retained delivery',delivery_id:frozen.delivery_id,
          project_crs:delivery?.project_crs||'',sources:[],scenario_run_ids:[],
          comparison_ids:[],include_grid:true,notes:[]});
        render();
        const reason=delivery?.reason||'Receive the current GIS component and complete the delivery dataset catalogue.';
        error(reason);
        return {delivery_id:frozen.delivery_id,eligible:false,reason};
      }
      const value=deliverySelection(delivery);
      activeWorkspace=workspace;catalogue=data;signature=stateSignature(getState());
      saveSelection(value);render();
      root.querySelector('[data-gis-export]')?.scrollIntoView({block:'start'});
      return JSON.parse(JSON.stringify(value));
    }finally{if(token===intakeVersion)intakeLoading=false;}
  }
  async function load(force=false){
    if(!root||intakeLoading)return;const state=getState();const key=state?.workspace_key;if(!key)return;
    const next=stateSignature(state);if(!force&&signature===next)return;
    if(activeWorkspace!==key){activeWorkspace=key;lastSelection=null;pending=null;catalogue=null;}
    if(catalogue&&root.querySelector('[data-gis-export]')){try{lastSelection=formSelection(false);}catch{}}
    controller?.abort();const own=new AbortController();controller=own;
    try{const data=await api('/api/gis/projects?'+new URLSearchParams({workspace:key}),{signal:own.signal});
      if(own.signal.aborted||getState()?.workspace_key!==key||!root)return;
      if(data.workspace_key!==key)throw new Error('GIS response belongs to a different workspace.');
      // Preserve edits made while this catalogue request was in flight,
      // including an intentionally incomplete selection.
      if(catalogue&&root.querySelector('[data-gis-export]'))lastSelection=formSelection(false);
      catalogue=data;signature=next;render();
    }catch(e){if(e.name!=='AbortError')error(e.message);}
  }
  return {
    mount(element,state){root=element;if(activeWorkspace!==state.workspace_key)signature='';
      if(!catalogue||activeWorkspace!==state.workspace_key)root.innerHTML='<section class="gis-workspace"><h1>Editable GIS projects</h1><p>Opening the retained study selections…</p><p data-gis-error role="alert" hidden></p></section>';
      else render();void load(true);},
    update(state){if(root&&getState()?.workspace_key===state?.workspace_key)void load();},
    detach(){intakeVersion++;intakeLoading=false;controller?.abort();controller=null;root=null;},
    createForSources,createForDelivery
  };
}
