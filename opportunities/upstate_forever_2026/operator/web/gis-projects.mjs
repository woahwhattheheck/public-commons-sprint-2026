/** Complete GIS export/receiving panel using the original Operator API and task queue. */
export function attachGISProjects({getState, api, refreshState, showTask, toast}) {
  let root=null, catalogue=null, controller=null, signature='', activeWorkspace=null;
  let pending=null, lastSelection=null, intakeVersion=0, intakeLoading=false, vectorReviewVersion=0;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pretty=n=>Number(n||0).toLocaleString();
  const options=(rows,label)=>'<option value="">None selected</option>'+rows.map(x=>'<option value="'+esc(x.id)+'">'+esc(label(x))+'</option>').join('');
  const nativeStudyViews=new Map();
  const storageKey=ws=>'upstate-gis-selection:'+ws;
  function error(message){const box=root?.querySelector('[data-gis-error]');if(box){box.textContent=message;box.hidden=!message;}}
  function readSaved(){try{return JSON.parse(localStorage.getItem(storageKey(activeWorkspace))||'null');}catch{return null;}}
  function saveSelection(value){lastSelection=value;try{localStorage.setItem(storageKey(activeWorkspace),JSON.stringify(value));}catch{}}
  function stateSignature(state){return JSON.stringify({workspace:state?.workspace_key,
    sources:state?.data?.sources?.map(x=>x.id),grids:state?.data?.grids?.map(x=>[x.id,x.state]),
    runs:state?.data?.runs?.map(x=>[x.id,x.state]),comparisons:state?.data?.comparisons?.map(x=>x.id),
    deliveries:state?.data?.deliveries?.map(x=>[x.id,x.state]),
    tasks:state?.tasks?.filter(x=>x.action?.startsWith('gis.project.')||x.action==='gis.vector.review').map(x=>[x.id,x.state])});}
  function selected(name){return root?.querySelector('[name="'+name+'"]');}
  function sourceChoices(collection,saved){
    const list=root?.querySelector('[data-gis-sources]');if(!list)return;
    const all=catalogue?.sources.find(x=>x.id===collection)?.entries||[];
    const rows=all.filter(x=>!x.gis_required_context),context=all.filter(x=>x.gis_required_context);
    const keys=saved?.sources?new Set(saved.sources.map(x=>x.source_id)):null;
    list.innerHTML=rows.length?rows.map(x=>'<label class="gis-choice"><input type="checkbox" name="source" value="'+esc(x.id)+'" '+((keys?keys.has(x.id):['vector','raster'].includes(x.kind))?'checked':'')+'><span>'+esc(x.title)+'<small>'+esc(x.kind)+' · '+esc(describe(x.units)||'original source metadata')+'</small></span></label>').join(''):'<p>Select an original source edition or use completed model results below.</p>';
    if(context.length)list.insertAdjacentHTML('beforeend','<details class="gis-context"><summary>'+pretty(context.length)+' source context files carried automatically</summary><p>These files accompany the associated selected sources, including their original companions, dated context and edition history.</p><ul>'+context.map(x=>'<li>'+esc(x.title)+'</li>').join('')+'</ul></details>');
  }
  function fillForm(saved){
    if(!root||!catalogue)return;
    selected('title').value=saved?.title||'Editable GIS · '+(getState()?.data?.project?.title||'Selected study');
    selected('project_crs').value=saved?.project_crs||'EPSG:5070';
    selected('native_study_collection').value=saved?.native_study?.source_collection_id||'';
    selected('delivery_id').value=saved?.delivery_id||'';
    const original=catalogue.sources.some(x=>x.id===saved?.source_collection_id)?saved.source_collection_id:
      (saved&&Array.isArray(saved.sources)?'':catalogue.sources[0]?.id||'');
    selected('source_collection_id').value=original;sourceChoices(original,saved);
    for(const name of ['grid_id','baseline_run_id'])if(saved?.[name])selected(name).value=saved[name];
    for(const name of ['scenario_run_ids','comparison_ids'])for(const input of root.querySelectorAll('[name="'+name+'"]'))input.checked=(saved?.[name]||[]).includes(input.value);
    selected('notes').value=(saved?.notes||[]).join('\n');
    syncNativeStudy();
  }

  function nativeStudy(){
    const id=selected('native_study_collection')?.value;
    return (catalogue?.native_studies||[]).find(row=>row.source_collection_id===id);
  }
  function syncNativeStudy(){
    const active=!!selected('native_study_collection')?.value;
    for(const name of ['delivery_id','source_collection_id','source','grid_id','baseline_run_id','scenario_run_ids','comparison_ids'])
      for(const input of root.querySelectorAll('[name="'+name+'"]'))input.disabled=active;
    const panel=root.querySelector('[data-native-study-summary]');if(!panel)return;
    const row=nativeStudy();
    if(!row){panel.textContent=active?'Refresh this original saved study source before exporting.':'';return;}
    const detail=nativeStudyViews.get(activeWorkspace+':'+row.source_collection_id+':'+row.source_sha256);
    panel.innerHTML='<p>'+esc(row.title)+'</p><p>The complete original cohort, report, numeric tables and companions travel together. Native rasters retain their units and reporting support.</p>'+
      (detail?'<p>'+pretty(detail.run_count)+' completed runs · '+pretty(detail.comparison_count)+' original comparisons · '+pretty(detail.source_companions)+' report companions</p>'+
       '<p>'+esc(detail.interpretation)+'</p><details><summary>Original grid, scope and quantities</summary><pre>'+
       esc(JSON.stringify({grid:detail.grid,scope:detail.scope,quantities:detail.quantities},null,2))+'</pre></details>':'');
  }
  async function createForNativeStudy(request){
    const frozen=JSON.parse(JSON.stringify(request||{})),workspace=getState()?.workspace_key;
    if(!root||!workspace||frozen.workspace_key!==workspace)
      throw new Error('Open the original native-study Workspace before preparing its GIS handover.');
    const collection=frozen.source_collection_id;
    if(!/^[0-9a-f]{64}$/.test(collection||''))throw new Error('Choose a retained native-study source.');
    const before=canonical(formSelection(false)),element=root,token=++intakeVersion;
    controller?.abort();const own=new AbortController();controller=own;intakeLoading=true;
    try{
      const data=await api('/api/gis/projects?'+new URLSearchParams({workspace,native_study_collection:collection,
        native_study_source:frozen.source_id||'saved-native-ensemble-study'}),{signal:own.signal});
      if(token!==intakeVersion||own.signal.aborted||root!==element||getState()?.workspace_key!==workspace||
         canonical(formSelection(false))!==before)
        throw new Error('The Workspace or handover selection changed while opening this native study.');
      if(data.workspace_key!==workspace||data.native_study?.source_collection_id!==collection)
        throw new Error('The native-study response belongs to another original selection.');
      const detail=data.native_study,row=(catalogue.native_studies||[]).find(x=>x.source_collection_id===collection);
      if(!row||row.source_id!==detail.source_id||row.source_sha256!==detail.source_sha256)
        throw new Error('Refresh the original saved native-study source before opening it.');
      nativeStudyViews.set(workspace+':'+collection+':'+detail.source_sha256,detail);
      const value={title:(detail.source_title+' · editable GIS').slice(0,240),
        project_crs:detail.project_crs||selected('project_crs').value,
        native_study:{source_collection_id:collection,source_id:detail.source_id,source_sha256:detail.source_sha256,
          ...(detail.rendered_report?{rendered_report:{source_operation_id:detail.rendered_report.source_operation_id,
            files_sha256:detail.rendered_report.files_sha256}}:{})},
        notes:[]};
      saveSelection(value);render();root.querySelector('[data-gis-export]')?.scrollIntoView({block:'start'});
      return JSON.parse(JSON.stringify(value));
    }finally{if(token===intakeVersion)intakeLoading=false;}
  }

  function links(record){return '<div class="gis-links"><a target="_blank" rel="noopener" href="'+esc(record.viewer_url)+'">Open layer view</a><a href="'+esc(record.archive_download.url)+'?download=1">Download complete editable ZIP</a></div>';}
  const describe=value=>value==null?'':typeof value==='object'?JSON.stringify(value):String(value);
  const adoptionKey=(workspace,receipt)=>'upstate-gis-adoption:'+workspace+':'+receipt;
  function adoptionDraft(receipt){try{return JSON.parse(localStorage.getItem(adoptionKey(activeWorkspace,receipt))||'null');}catch{return null;}}
  const reviewSelections=new Map();
  const reviewKey=(workspace,receipt)=>'upstate-gis-review:'+workspace+':'+receipt;
  function reviewDraft(receipt){
    const key=reviewKey(activeWorkspace,receipt);
    if(reviewSelections.has(key))return reviewSelections.get(key);
    try{const value=JSON.parse(localStorage.getItem(key)||'null');
      if(value&&typeof value==='object'){reviewSelections.set(key,value);return value;}
    }catch{}
    return {export_id:'',review_id:''};
  }
  function saveReview(receipt,value){
    const key=reviewKey(activeWorkspace,receipt),saved={export_id:value.export_id||'',review_id:value.review_id||''};
    reviewSelections.set(key,saved);try{localStorage.setItem(key,JSON.stringify(saved));}catch{}
  }
  function compatibleReviews(record){
    const selected=reviewDraft(record.id);
    return (record.reviews||[]).filter(row=>row.state==='complete'&&
      row.selection?.receipt_id===record.id&&row.selection?.export_id===selected.export_id&&
      row.selection?.received_fingerprint===record.result.fingerprint);
  }
  function reviewChoice(record){
    const saved=reviewDraft(record.id),rows=compatibleReviews(record);
    return '<label>Retain a change review with this source edition<select name="adoption_review">'+
      '<option value="">Source adoption without a review attachment</option>'+
      rows.map(row=>'<option value="'+esc(row.id)+'"'+(row.id===saved.review_id?' selected':'')+'>'+
        esc('Review '+row.id.slice(0,12)+' · '+(row.created_at||'retained original edition'))+'</option>').join('')+
      (saved.review_id&&!rows.some(row=>row.id===saved.review_id)?
       '<option value="'+esc(saved.review_id)+'" selected disabled>Unavailable review · '+esc(saved.review_id.slice(0,12))+'</option>':'')+
      '</select></label><p class="gis-help">A selected review travels with the new source edition. Choose its original export in the comparison form; changing that pair clears an incompatible review selection.</p>';
  }
  function reviewForm(record){
    if(record.kind!=='received')return '';
    const saved=reviewDraft(record.id),choices=record.review_exports||[];
    const reviews=(record.reviews||[]).map(row=>{
      const exported=choices.find(value=>value.id===row.selection.export_id);
      const summary=row.layers.map(layer=>{
        const counts=Object.entries(layer.counts||{}).map(([key,value])=>key.replaceAll('_',' ')+': '+pretty(value)).join(' · ');
        return '<tr><th>'+esc(layer.title)+'</th><td>'+esc(layer.kind)+' · '+esc(describe(layer.units))+'</td>'+
          '<td>'+esc(counts||layer.comparison||layer.scope||'Original layer metadata')+
          (layer.metadata_changed?.length?'<p>Metadata changed: '+esc(layer.metadata_changed.join(', '))+'</p>':'')+
          '<p>'+esc(layer.scope||'')+'</p>'+(layer.reason?'<p>'+esc(layer.reason)+'</p>':'')+'</td></tr>';
      }).join('');
      return '<details><summary>'+esc('Review against '+(exported?.title||row.selection.export_id.slice(0,12)))+'</summary>'+
        '<p class="gis-id">Export '+esc(row.selection.export_id)+'<br>Received edition '+esc(row.selection.received_edition_id)+'</p>'+
        (row.created_at?'<p>'+esc(row.created_at)+'</p>':'')+
        '<div class="gis-links">'+row.downloads.map(file=>'<a href="'+esc(file.url)+
          (file.path==='REVIEW.html'?'" target="_blank" rel="noopener">':'?download=1">')+esc(file.label)+'</a>').join('')+'</div>'+
        '<table><thead><tr><th>Layer</th><th>Kind and units</th><th>Actual changes</th></tr></thead><tbody>'+summary+'</tbody></table></details>';
    }).join('');
    return '<section class="gis-review"><h4>Compare exported and received working editions</h4>'+
      '<p>Compare the actual received working layers with their retained original export. The report preserves vector rows and geometry, raster values and valid support, and original units.</p>'+
      '<form data-gis-review="'+esc(record.id)+'"><label>Original exported GIS project<select name="review_export" required>'+
      '<option value="">Choose the retained original export</option>'+
      choices.map(row=>'<option value="'+esc(row.id)+'"'+(row.id===saved.export_id?' selected':'')+'>'+
        esc(row.title+' · '+row.id.slice(0,12))+'</option>').join('')+
      (saved.export_id&&!choices.some(row=>row.id===saved.export_id)?
       '<option value="'+esc(saved.export_id)+'" selected disabled>Unavailable original export · '+esc(saved.export_id.slice(0,12))+'</option>':'')+
      '</select></label><button type="submit"'+(!choices.length?' disabled':'')+'>Build complete edition comparison</button></form>'+
      (!choices.length?'<p class="gis-help">This Workspace needs the retained export of the same original GIS selection to pair its working data.</p>':'')+
      (reviews||'<p>No retained data-change review for this received edition yet.</p>')+'</section>';
  }
  async function submitReview(event){
    event.preventDefault();event.stopPropagation();error('');
    const form=event.currentTarget,button=event.submitter;button.disabled=true;
    try{
      if(!root||getState()?.workspace_key!==activeWorkspace)throw new Error('Return to this original GIS workspace.');
      const receipt_id=form.dataset.gisReview,record=catalogue.received.find(row=>row.id===receipt_id);
      const export_id=form.querySelector('[name="review_export"]').value;
      if(!record||(record.review_exports||[]).every(row=>row.id!==export_id))
        throw new Error('Choose the retained original export of this received GIS selection.');
      const prior=reviewDraft(receipt_id);
      saveReview(receipt_id,{export_id,review_id:prior.export_id===export_id?prior.review_id:''});
      const review_version=catalogue.review_version;
      if(typeof review_version!=='string'||!review_version.trim())
        throw new Error('Receive the current GIS review provider and refresh this catalogue before building its report.');
      await submit('gis.project.review',{receipt_id,export_id,review_version});
    }catch(failure){error(failure.message);}finally{button.disabled=false;}
  }
  function adoptionPayload(form){
    const checked=name=>[...form.querySelectorAll('[name="'+name+'"]:checked')].map(x=>x.value);
    const payload={receipt_id:form.dataset.gisAdopt,
      title:form.querySelector('[name="adoption_title"]').value.trim(),
      reason:form.querySelector('[name="adoption_reason"]').value.trim(),
      layer_ids:checked('adoption_layer'),attachment_ids:checked('adoption_attachment')};
    if(!payload.layer_ids.length&&!payload.attachment_ids.length)
      throw new Error('Select a received working layer, original table or document.');
    if(!payload.title||!payload.reason)throw new Error('Name the source edition and explain its adoption.');
    const review_id=form.querySelector('[name="adoption_review"]')?.value||'';
    if(review_id){
      const record=catalogue.received.find(row=>row.id===payload.receipt_id);
      if(!record||!compatibleReviews(record).some(row=>row.id===review_id))
        throw new Error('Choose a complete review of this exact received edition and selected original export.');
      payload.review_id=review_id;
    }
    return payload;
  }
  function retainAdoption(form){
    const draft={title:form.querySelector('[name="adoption_title"]').value,
      reason:form.querySelector('[name="adoption_reason"]').value};
    for(const name of ['adoption_layer','adoption_attachment'])
      draft[name]=[...form.querySelectorAll('[name="'+name+'"]:checked')].map(x=>x.value);
    const prior=reviewDraft(form.dataset.gisAdopt);
    saveReview(form.dataset.gisAdopt,{...prior,review_id:form.querySelector('[name="adoption_review"]')?.value||''});
    try{localStorage.setItem(adoptionKey(activeWorkspace,form.dataset.gisAdopt),JSON.stringify(draft));}catch{}
  }
  function syncAdoption(form){
    const layers=form.querySelectorAll('[name="adoption_layer"]:checked').length>0;
    for(const input of form.querySelectorAll('[name="adoption_attachment"]')){
      if(layers)input.checked=true;
      input.disabled=layers;
    }
    const help=form.querySelector('[data-gis-adoption-help]');
    if(help)help.textContent=layers?'Working layers keep all original tables, documents and companions. Clear the working layers to choose only original tables or documents.':'Only the selected original tables or documents and this received edition’s provenance will be adopted. Complete declared companions remain attached.';
  }
  function adoptionForm(record){
    if(record.kind!=='received')return '';
    const saved=adoptionDraft(record.id), layers=record.layer_choices||[], attachments=record.attachment_choices||[];
    const chosen=(name,id)=>saved&&Array.isArray(saved[name])?saved[name].includes(id):true;
    return '<details class="gis-adoption"><summary>Use received layers, tables or documents as study sources</summary><p>Choose a complete working-layer edition or select original tables and documents on their own.</p><form data-gis-adopt="'+esc(record.id)+'"><label>New source edition title<input name="adoption_title" value="'+esc(saved?.title??('Received GIS sources · '+record.title))+'" required maxlength="240"></label><fieldset><legend>Working layers</legend>'+layers.map(x=>'<label class="gis-choice"><input type="checkbox" name="adoption_layer" value="'+esc(x.id)+'" '+(chosen('adoption_layer',x.id)?'checked':'')+'><span>'+esc(x.title)+'<small>'+esc(x.kind)+' · '+esc(describe(x.units))+'</small></span></label>').join('')+'</fieldset><fieldset><legend>Original tables and documents</legend>'+attachments.map(x=>'<label class="gis-choice"><input type="checkbox" name="adoption_attachment" value="'+esc(x.id)+'" '+(chosen('adoption_attachment',x.id)?'checked':'')+'><span>'+esc(x.title)+'<small>'+[x.kind,x.vintage,x.geography_basis,describe(x.units)].filter(x=>x!=null&&x!=='').map(esc).join(' · ')+' · '+pretty(x.companions)+' companions</small></span></label>').join('')+(attachments.length?'':'<p>No original attachments in this received edition.</p>')+'</fieldset><p data-gis-adoption-help class="gis-help"></p><label>Reason for this source edition<textarea name="adoption_reason" required rows="2">'+esc(saved?.reason??'')+'</textarea></label>'+reviewChoice(record)+'<button type="submit">Adopt selected study sources</button></form></details>';
  }
  function vectorReviewControls(record){
    const vectors=(record.layer_choices||[]).filter(row=>row.kind==='vector');
    if(record.kind!=='received'||!vectors.length)return '';
    return '<section class="gis-vector-review"><h4>Working vector changes</h4>'+
      '<p>Compare the received features with their retained originals before choosing an adoption. Exact original identities pair the features; changed or missing identities remain explicit.</p>'+
      '<button type="button" data-gis-vector-review="'+esc(record.id)+'">Review all '+pretty(vectors.length)+' vector layers</button>'+
      '<div data-gis-vector-reviews="'+esc(record.id)+'"><p>Loading saved reviews…</p></div></section>';
  }
  function reviewSummary(review){
    const sums={};for(const layer of review.layers||[])for(const [key,value] of Object.entries(layer.counts||{}))sums[key]=(sums[key]||0)+value;
    return '<article><h5>'+esc(review.title)+'</h5><p>'+pretty(sums.matched)+' paired features · '+
      pretty(sums.attribute_changed)+' with attribute changes · '+pretty(sums.geometry_changed)+' with geometry changes · '+
      pretty(sums.added_identities)+' added identities · '+pretty(sums.removed_identities)+' removed identities</p>'+
      '<p>'+pretty((sums.ambiguous_ids||0)+(sums.missing_working_identity||0)+(sums.unmatched_original||0))+
      ' unresolved identity cases · '+pretty(sums.geometry_unassessed)+' geometry comparisons requiring review · '+
      pretty((sums.invalid_original||0)+(sums.invalid_working||0))+' invalid geometries · '+pretty(sums.schema_changes)+' field schema changes</p>'+
      '<button type="button" data-gis-open-vector-review="'+esc(review.id)+'">Open review and complete files</button>'+
      '<div data-gis-vector-review-files="'+esc(review.id)+'"></div></article>';
  }
  async function loadVectorReviews(){
    const workspace=activeWorkspace,node=root,version=++vectorReviewVersion;
    if(!node||!workspace)return;
    try{
      const data=await api('/api/gis-vector-reviews/catalog?'+new URLSearchParams({workspace}));
      if(version!==vectorReviewVersion||root!==node||activeWorkspace!==workspace||getState()?.workspace_key!==workspace)return;
      if(data.workspace_key!==workspace)throw new Error('Vector review catalogue belongs to another workspace.');
      for(const target of node.querySelectorAll('[data-gis-vector-reviews]')){
        const rows=(data.reviews||[]).filter(row=>row.selection.receipt_id===target.dataset.gisVectorReviews);
        target.innerHTML=rows.length?rows.map(reviewSummary).join(''):'<p>No saved vector review for this received edition yet.</p>';
      }
      for(const button of node.querySelectorAll('[data-gis-open-vector-review]'))
        button.addEventListener('click',()=>openVectorReview(button.dataset.gisOpenVectorReview));
    }catch(e){
      if(version!==vectorReviewVersion||root!==node||activeWorkspace!==workspace||getState()?.workspace_key!==workspace)return;
      for(const target of node.querySelectorAll('[data-gis-vector-reviews]'))target.textContent='Saved vector reviews could not be read: '+e.message;
    }
  }
  async function submitVectorReview(receipt){
    const workspace=activeWorkspace;
    const record=(catalogue?.received||[]).find(row=>row.id===receipt);
    const layer_ids=(record?.layer_choices||[]).filter(row=>row.kind==='vector').map(row=>row.id);
    if(!layer_ids.length)return error('Choose a retained received vector layer.');
    try{
      error('');await submit('gis.vector.review',{receipt_id:receipt,layer_ids});
      if(activeWorkspace===workspace&&getState()?.workspace_key===workspace)await loadVectorReviews();
    }catch(e){if(activeWorkspace===workspace&&getState()?.workspace_key===workspace)error(e.message);}
  }
  async function openVectorReview(id){
    const workspace=activeWorkspace,node=root;
    const target=[...node.querySelectorAll('[data-gis-vector-review-files]')].find(row=>row.dataset.gisVectorReviewFiles===id);
    if(!target)return;
    target.textContent='Reading the retained review and original edition…';
    try{
      const data=await api('/api/gis-vector-reviews/inspect?'+new URLSearchParams({workspace,id}));
      if(root!==node||activeWorkspace!==workspace||getState()?.workspace_key!==workspace||!node.contains(target))return;
      if(data.workspace_key!==workspace||data.id!==id)throw new Error('The vector review belongs to a different original selection.');
      const files=data._downloads||[];
      const labels={'vector-review.zip':'Download complete offline review ZIP','review.html':'Open complete feature review',
        'review.json':'Download full JSON','feature-changes.csv':'Download feature changes CSV'};
      target.innerHTML='<p>Geometry comparisons use the retained original CRS; identity and attribute values remain exact. The ZIP opens offline with all three report files.</p>'+
        files.map(file=>'<p><a target="_blank" rel="noopener" href="'+esc(file.url)+'?download='+(file.filename==='review.html'?'0':'1')+'">'+
          esc(labels[file.filename]||file.label||file.filename)+'</a> · '+pretty(file.bytes)+' bytes</p>').join('')+
        (data.layers||[]).map(layer=>'<details><summary>'+esc(layer.title)+' · '+pretty(layer.counts.matched)+' paired features</summary>'+
          '<p>Original CRS '+esc(layer.crs.original)+' · Working CRS '+esc(layer.crs.working)+'</p><pre>'+
          esc(JSON.stringify(layer.counts,null,2))+'</pre></details>').join('');
    }catch(e){
      if(root===node&&activeWorkspace===workspace&&getState()?.workspace_key===workspace&&node.contains(target))target.textContent=e.message;
    }
  }
  function records(rows){return rows.length?rows.map(x=>'<article class="gis-record"><h3>'+esc(x.title)+'</h3><p>'+pretty(x.layers)+' layers · '+pretty(x.bytes)+' bytes · '+esc(x.kind==='received'?'Received independent edition':'Retained scientific-workspace export')+'</p><p class="gis-id">Edition '+esc(x.result.edition_id)+'</p>'+links(x)+vectorReviewControls(x)+reviewForm(x)+adoptionForm(x)+'</article>').join(''):'<p>No GIS projects in this section yet.</p>';}
  function adopted(){return (catalogue.adoptions||[]).map(x=>'<article class="gis-record"><h3>'+esc(x.title)+'</h3><p>'+pretty(x.sources?.length)+' working layers · '+(Array.isArray(x.context_sources)?pretty(x.context_sources.length)+' original tables and documents adopted.':'original source context retained.')+'</p><p class="gis-id">Source edition '+esc(x.source_collection_id)+'</p><button type="button" data-gis-open-source="'+esc(x.source_collection_id)+'">Open original source files</button>'+((x.sources||[]).length?'<button type="button" data-gis-use-source="'+esc(x.source_collection_id)+'">Select this source edition for GIS export</button>':'<p class="gis-help">These original sources are available in Sources and Investigations. Tables keep their original geography and dates.</p>')+'<div data-gis-source-files="'+esc(x.source_collection_id)+'"></div></article>').join('')||'<p>Adopt received layers or original tables and documents below each independent edition.</p>';}
  async function openSource(collection){
    const workspace=activeWorkspace,target=root?.querySelector('[data-gis-source-files="'+CSS.escape(collection)+'"]');
    if(!target)return;
    target.textContent='Opening original source files…';
    try{
      const record=await api('/api/item?'+new URLSearchParams({workspace,kind:'sources',id:collection}));
      if(!root||activeWorkspace!==workspace||getState()?.workspace_key!==workspace||!target.isConnected)return;
      if(record.id!==collection)throw new Error('The returned source edition has another identity.');
      const downloads=record._downloads||[];
      const file=body=>downloads.find(row=>row.sha256===body.sha256&&row.bytes===body.bytes&&row.filename===body.filename);
      target.innerHTML=(record.entries||[]).map(row=>'<section><h4>'+esc(row.title)+'</h4><p>'+[row.kind,row.vintage,row.geography_basis,describe(row.units)].filter(x=>x!=null&&x!=='').map(esc).join(' · ')+'</p><ul>'+[row.body,...(row.companions||[])].map(body=>{const link=file(body);return '<li>'+(link?'<a href="'+esc(link.url)+'?download=1">'+esc(body.filename)+'</a>':esc(body.filename))+' · '+pretty(body.bytes)+' bytes</li>';}).join('')+'</ul></section>').join('');
    }catch(e){if(target.isConnected&&activeWorkspace===workspace)target.textContent=e.message;}
  }

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
    root.innerHTML='<section class="gis-workspace"><header><p class="eyebrow">UPPER SAVANNAH SCIENTIFIC WORKBENCH</p><h1>Editable GIS projects</h1><p>Export retained sources and physical results as a complete QGIS working directory. Receive a colleague’s revised edition without changing the original study.</p></header><p data-gis-error class="gis-error" role="alert" hidden></p><div class="gis-columns"><form data-gis-export><h2>Prepare a GIS handover</h2><label>Project title<input name="title" required maxlength="240"></label><label>Display coordinate system<input name="project_crs" required placeholder="EPSG:5070"></label><p class="gis-help">Display projection only. Working files retain their native coordinates, numerical cells and masks.</p><label>Saved native-model study<select name="native_study_collection">'+
      '<option value="">Manual selection or map delivery</option>'+
      (catalogue.native_studies||[]).map(row=>'<option value="'+esc(row.source_collection_id)+'"'+
        (!row.local_project?' disabled':'')+'>'+esc(row.title)+(!row.local_project?' · open original project':'')+'</option>').join('')+
      (saved?.native_study?.source_collection_id&&!(catalogue.native_studies||[]).some(row=>row.source_collection_id===saved.native_study.source_collection_id)?
        '<option value="'+esc(saved.native_study.source_collection_id)+'" disabled>Unavailable saved native-study source</option>':'')+
      '</select></label><div data-native-study-summary class="gis-help"></div><label>Completed map delivery<select name="delivery_id">'+deliveryOptions+'</select></label><p class="gis-help">Include the delivery’s actual exports, signed changes and selected priorities, with original maps, metadata and PDF reports. Choosing a delivery starts with those datasets; add other retained study selections explicitly below.</p><label>Original source edition<select name="source_collection_id">'+options(catalogue.sources,x=>x.title)+'</select></label><fieldset><legend>Complete retained source files</legend><div data-gis-sources></div></fieldset><label>Prepared study grid<select name="grid_id">'+options(catalogue.grids.filter(x=>x.state==='complete'),x=>(x.spec?.title||'Model grid')+' · '+x.id.slice(0,12))+'</select></label><label>Completed baseline run<select name="baseline_run_id">'+options(completeRuns,runName)+'</select></label><fieldset><legend>Completed alternative runs</legend>'+(completeRuns.length?completeRuns.map(x=>'<label class="gis-choice"><input type="checkbox" name="scenario_run_ids" value="'+esc(x.id)+'"><span>'+esc(runName(x))+'</span></label>').join(''):'<p>Complete native runs will appear here. Source-only GIS handover is available now.</p>')+'</fieldset><fieldset><legend>Existing signed comparisons</legend>'+(catalogue.comparisons.length?catalogue.comparisons.map(x=>'<label class="gis-choice"><input type="checkbox" name="comparison_ids" value="'+esc(x.id)+'"><span>'+esc(x.direction||'Retained comparison')+' · '+esc(x.id.slice(0,12))+'</span></label>').join(''):'<p>No saved comparison yet.</p>')+'</fieldset><label>Operator notes<textarea name="notes" rows="3" placeholder="Explain this selected handover in ordinary language."></textarea></label><button type="submit">Build complete GIS project</button><p class="gis-help">Uses the original retained task queue. The source scientific models are not rerun.</p></form><aside><section class="gis-receive"><h2>Receive an edited project</h2><p>Choose the complete ZIP after the sender seals its saved GIS edition. All working data, original files and history enter a new receiving directory.</p><form data-gis-receive><label>Complete GIS archive<input name="archive" type="file" accept=".zip" required></label><button type="submit">Receive independent edition</button></form></section><section class="gis-steps"><h2>Continue in desktop GIS</h2><ol><li>Download and extract the <strong>complete ZIP</strong>.</li><li>Open <strong>OPEN_GIS.html</strong> to inspect geography, layer provenance and units.</li><li>Open <strong>project.qgz</strong> in QGIS. Keep every accompanying directory together.</li><li>Edit the independent GeoPackage attributes or geometry; retain source layer identities.</li><li>Save and close editing, then follow the included <strong>seal → pack → receive</strong> instructions.</li></ol><p>Native layer metadata distinguishes physical results, signed changes, categorical data and contextual geometry.</p></section><button type="button" data-gis-refresh>Refresh retained projects</button></aside></div><section class="gis-outputs"><h2>Exported from this study</h2>'+records(catalogue.exports)+'</section><section class="gis-outputs"><h2>Received independent editions</h2>'+records(catalogue.received)+'</section><section class="gis-outputs"><h2>Adopted study source editions</h2>'+adopted()+'</section></section>';
    fillForm(saved);
    root.querySelector('[data-gis-export]').addEventListener('submit',submitExport);
    root.querySelector('[data-gis-receive]').addEventListener('submit',submitReceive);
    for(const form of root.querySelectorAll('[data-gis-adopt]')){
      syncAdoption(form);
      form.addEventListener('submit',submitAdoption);
      form.addEventListener('input',()=>{syncAdoption(form);retainAdoption(form);});
      form.addEventListener('change',()=>{syncAdoption(form);retainAdoption(form);});
    }
    for(const form of root.querySelectorAll('[data-gis-review]')){
      form.addEventListener('submit',submitReview);
      form.querySelector('[name="review_export"]').addEventListener('change',event=>{
        const receipt=form.dataset.gisReview,prior=reviewDraft(receipt),export_id=event.target.value;
        if(export_id===prior.export_id)return;
        const adoption=root.querySelector('[data-gis-adopt="'+CSS.escape(receipt)+'"]');
        if(adoption)retainAdoption(adoption);
        saveReview(receipt,{export_id,review_id:''});
        if(adoption){
          const record=catalogue.received.find(row=>row.id===receipt);
          const select=adoption.querySelector('[name="adoption_review"]');
          if(select&&record){
            const holder=document.createElement('div');holder.innerHTML=reviewChoice(record);
            select.replaceWith(holder.querySelector('[name="adoption_review"]'));
          }
        }
      });
    }
    for(const button of root.querySelectorAll('[data-gis-open-source]'))
      button.addEventListener('click',()=>openSource(button.dataset.gisOpenSource));
    for(const button of root.querySelectorAll('[data-gis-use-source]'))button.addEventListener('click',()=>{
      const source=catalogue.sources.find(x=>x.id===button.dataset.gisUseSource);
      if(!source)return error('Refresh the original source edition before selecting it.');
      saveSelection({title:source.title+' · editable GIS',project_crs:selected('project_crs').value||'EPSG:5070',source_collection_id:source.id,sources:source.entries.map(x=>({source_collection_id:source.id,source_id:x.id})),notes:[]});
      render();root.querySelector('[data-gis-export]').scrollIntoView({block:'start'});
    });
    selected('native_study_collection').addEventListener('change',event=>{
      syncNativeStudy();const row=nativeStudy();
      if(!event.target.value){saveSelection(formSelection(false));return;}
      if(!row)return error('Refresh the original native-study catalogue.');
      void createForNativeStudy({workspace_key:activeWorkspace,source_collection_id:row.source_collection_id,source_id:row.source_id})
        .catch(failure=>{if(failure.name!=='AbortError')error(failure.message);});
    });
    selected('source_collection_id').addEventListener('change',event=>sourceChoices(event.target.value,null));
    selected('delivery_id').addEventListener('change',event=>{
      const id=event.target.value;if(!id)return;
      const delivery=(catalogue.deliveries||[]).find(row=>row.id===id&&row.eligible);
      if(!delivery)return error('Choose a current completed delivery with its retained dataset catalogue.');
      try{const value=deliverySelection(delivery);saveSelection(value);render();}catch(failure){error(failure.message);}
    });
    root.querySelector('[data-gis-refresh]').addEventListener('click',()=>load(true));
    for(const button of root.querySelectorAll('[data-gis-vector-review]'))
      button.addEventListener('click',()=>submitVectorReview(button.dataset.gisVectorReview));
    if((catalogue.received||[]).some(row=>(row.layer_choices||[]).some(layer=>layer.kind==='vector')))
      loadVectorReviews();
  }
  function formSelection(validate=true){
    const selectedIDs=name=>[...root.querySelectorAll('[name="'+name+'"]:checked')].map(x=>x.value);
    const sourceIDs=selectedIDs('source');const collection=selected('source_collection_id').value;
    const value={title:selected('title').value.trim(),project_crs:selected('project_crs').value.trim(),
      sources:sourceIDs.map(id=>({source_collection_id:collection,source_id:id})),
      scenario_run_ids:selectedIDs('scenario_run_ids'),comparison_ids:selectedIDs('comparison_ids'),
      include_grid:true,notes:selected('notes').value.split('\n').map(x=>x.trim()).filter(Boolean)};
    if(selected('native_study_collection')?.value){
      const row=nativeStudy(),retained=lastSelection||readSaved();
      if(!row||!row.local_project)throw new Error('Choose the saved native study in its original restored project.');
      if(validate&&(retained?.native_study?.source_collection_id!==row.source_collection_id||
         retained.native_study.source_id!==row.source_id||retained.native_study.source_sha256!==row.source_sha256))
        throw new Error('Open the selected native-study preview before exporting its report and results.');
      return {title:value.title,project_crs:value.project_crs,notes:value.notes,
        native_study:{source_collection_id:row.source_collection_id,source_id:row.source_id,source_sha256:row.source_sha256,
          ...((retained?.native_study?.source_collection_id===row.source_collection_id&&retained.native_study.source_sha256===row.source_sha256&&retained.native_study.rendered_report)?
            {rendered_report:retained.native_study.rendered_report}:{})}};
    }
    if(sourceIDs.length)value.source_collection_id=collection;
    for(const name of ['grid_id','baseline_run_id','delivery_id'])if(selected(name).value)value[name]=selected(name).value;
    if(validate&&value.scenario_run_ids.includes(value.baseline_run_id))throw new Error('Choose the baseline once; remove it from alternative runs.');
    if(validate&&value.delivery_id&&!(catalogue.deliveries||[]).some(row=>row.id===value.delivery_id&&row.eligible))
      throw new Error('Choose a current completed delivery with its retained dataset catalogue.');
    if(validate&&!sourceIDs.length&&!value.delivery_id&&!value.grid_id&&!value.baseline_run_id&&!value.scenario_run_ids.length&&!value.comparison_ids.length)throw new Error('Select a completed delivery, original source files, a completed grid, run or comparison.');
    return value;
  }
  const canonical=value=>JSON.stringify(value,(key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(name=>[name,item[name]])):item);
  const operationKey=workspace=>'upstate-gis-operation:'+workspace;
  function saveOperation(workspace,value=pending){try{localStorage.setItem(operationKey(workspace)+':'+encodeURIComponent(value.key),JSON.stringify(value));}catch{}}
  function operation(action,payload){
    const key=canonical({workspace:activeWorkspace,action,payload});
    if(pending?.key===key)return pending;
    try{const retained=JSON.parse(localStorage.getItem(operationKey(activeWorkspace)+':'+encodeURIComponent(key))||'null');
      if(retained?.key===key&&typeof retained.operation_id==='string'&&/^gis-[0-9a-f]{32}$/.test(retained.operation_id)){
        pending=retained;return pending;
      }
    }catch{}
    const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
    pending={key,operation_id:'gis-'+[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('')};
    saveOperation(activeWorkspace);return pending;
  }
  async function submit(action,payload){
    const workspace=activeWorkspace,body=JSON.parse(JSON.stringify(payload)),op=operation(action,body);
    let task;
    try{task=await api('/api/actions',{method:'POST',body:{workspace,action,payload:body,operation_id:op.operation_id}});}
    catch(original){
      // Reconcile the same retained request after a lost response, including reload.
      try{const state=await api('/api/state?'+new URLSearchParams({workspace}));
        task=state.tasks.find(x=>x.operation_id===(op.accepted_operation_id||op.operation_id));
      }catch{}
      if(!task)throw original;
    }
    if(task?.workspace!==workspace||task.action!==action||canonical(task.payload)!==canonical(body))
      throw new Error('The returned GIS task belongs to a different original selection.');
    const accepted=op.accepted_operation_id||op.operation_id;
    if(task.operation_id!==accepted){
      if(op.accepted_operation_id||!['queued','running'].includes(task.state))
        throw new Error('The returned GIS task changed its accepted operation identity.');
      op.accepted_operation_id=task.operation_id;
    }
    saveOperation(workspace,op);
    if(!root||activeWorkspace!==workspace||getState()?.workspace_key!==workspace)return;
    toast('GIS operation queued in the original task list.');await showTask(task.id);await refreshState({force:true});
  }
  async function submitExport(event){
    event.preventDefault();event.stopPropagation();error('');const button=event.submitter;button.disabled=true;
    try{if(intakeLoading)throw new Error('Wait for the selected source preview to finish before exporting.');const value=formSelection();saveSelection(value);await submit('gis.project.export',value);}catch(e){error(e.message);}finally{button.disabled=false;}
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
      syncAdoption(form);retainAdoption(form);
      const payload=adoptionPayload(form);
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
    createForSources,createForDelivery,createForNativeStudy
  };
}
