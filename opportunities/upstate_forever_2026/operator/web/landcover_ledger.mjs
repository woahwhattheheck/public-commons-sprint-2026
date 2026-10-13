/* Retained run and annual-source comparisons through the original native queue. */
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = value => JSON.parse(JSON.stringify(value));
const identity = value => JSON.stringify([value.source_collection_id, value.source_id]);
const defaults = () => ({title:'Land-cover change ledger',input_mode:'runs',baseline:'',alternatives:[],baseline_source:'',source_alternatives:[],baseline_band:'1',source_bands:{},zones:'',id_field:'huc12',name_field:'name',layer:'',ids:'',support:'all',unknown:'error',overlap:false,projected_area:false});

export function attachLandcoverLedger({getState, api, endpoint, toast}) {
  const sessions = new Map();
  let root=null, key=null, current=null, catalog=null, epoch=0, events=null;
  let catalogRequest=0, inputRequest=0, editionRequest=0;
  const find = selector => root?.querySelector(selector);
  const all = selector => [...(root?.querySelectorAll(selector) || [])];
  const field = name => find('[name="'+name+'"]');
  const alive = (workspace, view) => Boolean(root && key===workspace && epoch===view && getState()?.workspace_key===workspace);
  const note = (text,error=false) => {const p=find('[data-note]');if(p){p.textContent=text;p.setAttribute('role',error?'alert':'status');}};
  function save(session,workspace) {
    try {localStorage.setItem('upstate.landcover.draft:'+workspace,JSON.stringify({draft:session.draft,pending:session.pending,request:session.request,edit:session.edit,lastOpened:session.lastOpened}));session.storageFailure=false;}
    catch (_) {session.storageFailure=true;}
  }
  function sessionFor(workspace) {
    if(sessions.has(workspace))return sessions.get(workspace);
    let stored=null;try{stored=JSON.parse(localStorage.getItem('upstate.landcover.draft:'+workspace)||'null');}catch(_){}
    const session={draft:{...defaults(),...(stored?.draft||{})},pending:stored?.pending||null,request:stored?.request||null,edit:Number.isSafeInteger(stored?.edit)?stored.edit:0,lastOpened:stored?.lastOpened||'',sending:false,storageFailure:false};
    sessions.set(workspace,session);return session;
  }
  const controls = () => '<header><p>RETAINED LAND-COVER EDITIONS</p><h1>Land-cover changes</h1><p>Compare land-cover classes and changed hectares on the original raster grid, with coverage for each reporting area.</p></header>'+
    '<form><div class="lc-form"><label>Title<input name="title" required value="Land-cover change ledger"></label><label>Comparison inputs<select name="input_mode"><option value="runs">Retained model runs</option><option value="sources">Annual raster source editions</option></select></label></div>'+
    '<fieldset data-mode="runs"><legend>Retained runs</legend><div class="lc-form"><label>Baseline run<select name="baseline" required></select></label><label>Alternative runs<select name="alternatives" multiple required size="5"></select></label></div><p>Run operands must use the same original retained grid.</p></fieldset>'+
    '<fieldset data-mode="sources" hidden disabled><legend>Annual source editions</legend><p>Select original NLCD class rasters on the same native grid. Equal-area hectares are the default; a projected planar grid requires the explicit option below. Each band keeps its own valid-data mask. These comparisons describe land-cover change between the selected editions.</p><div class="lc-form"><label>Baseline source<select name="baseline_source" required></select></label><label>Baseline band<input name="baseline_band" type="number" min="1" step="1" required value="1"></label><label>Alternative sources<select name="source_alternatives" multiple required size="5"></select></label></div><div data-source-bands class="lc-form"></div><div data-source-summary></div></fieldset>'+
    '<fieldset><legend>Original reporting polygons</legend><div class="lc-form"><label>Reporting source<select name="zones" required></select></label><label>Identifier field<input name="id_field" value="huc12" required></label><label>Name field<input name="name_field" value="name"></label><label>Layer (empty uses original)<input name="layer"></label><label>Selected original IDs (one per line; empty selects all)<textarea name="ids" rows="3"></textarea></label><label>Common support<select name="support"><option value="all">Across every selected alternative</option><option value="pair">Separately for each alternative</option></select></label><label>Unknown classes<select name="unknown"><option value="error">Report input error</option><option value="exclude">Exclude and quantify missing area</option></select></label><label class="lc-checkbox"><input name="overlap" type="checkbox">Allow overlapping reporting areas; use a unique domain union</label><label class="lc-checkbox"><input name="projected_area" type="checkbox">Allow projected planar hectares on a retained projected grid. Default requires an equal-area projection.</label></div></fieldset>'+
    '<div class="lc-toolbar"><button type="button" data-action="check">Check selected inputs</button><button type="submit">Build land-cover ledger</button><button type="button" data-action="refresh">Refresh retained inputs</button><button type="button" data-action="resume" hidden>Resume original task</button></div></form>'+
    '<p data-note role="status" aria-live="polite"></p><section data-input-preview hidden></section><section><h2>Saved editions</h2><select name="edition"><option value="">Choose a saved ledger</option></select><button type="button" data-action="open">Open edition</button></section><section data-result></section>';
  function draft() {
    if(!root)return current?.draft;
    const value=name=>field(name)?.value||'';
    const selected=name=>[...(field(name)?.selectedOptions||[])].map(o=>o.value);
    const source_bands={...current.draft.source_bands};
    for(const input of all('[data-source-band]'))source_bands[input.dataset.sourceBand]=input.value;
    return {title:value('title'),input_mode:value('input_mode'),baseline:value('baseline'),alternatives:selected('alternatives'),baseline_source:value('baseline_source'),source_alternatives:selected('source_alternatives'),baseline_band:value('baseline_band'),source_bands,zones:value('zones'),id_field:value('id_field'),name_field:value('name_field'),layer:value('layer'),ids:value('ids'),support:value('support'),unknown:value('unknown'),overlap:Boolean(field('overlap')?.checked),projected_area:Boolean(field('projected_area')?.checked)};
  }
  function retain() {if(!root||!current)return;current.draft=draft();save(current,key);}
  function restore(value) {
    for(const [name,v] of Object.entries(value||{})) {
      const element=field(name);if(!element)continue;
      if(element.tagName==='SELECT') {
        const selected=element.multiple?(Array.isArray(v)?v:[]):[v];
        for(const item of selected)if(item&&!Array.from(element.options).some(o=>o.value===item)) {
          const option=document.createElement('option');option.value=item;option.textContent='Unavailable retained selection · '+item;element.append(option);
        }
        if(element.multiple)for(const option of element.options)option.selected=selected.includes(option.value);
        else element.value=v??'';
      } else if(element.type==='checkbox')element.checked=Boolean(v);
      else element.value=v??'';
    }
    mode();
  }
  function mode() {
    for(const group of all('[data-mode]')){const active=group.dataset.mode===field('input_mode').value;group.hidden=!active;group.disabled=!active;}
  }
  function sourceDetails() {
    const d=current.draft,rows=catalog?.rasters||[];
    const alternatives=d.source_alternatives||[];
    find('[data-source-bands]').innerHTML=alternatives.map(ref=>{const row=rows.find(item=>identity(item)===ref);return '<label>Band · '+escape(row?.title||ref)+'<input type="number" min="1" step="1" required data-source-band="'+escape(ref)+'" value="'+escape(d.source_bands?.[ref]||'1')+'"></label>';}).join('');
    const chosen=[d.baseline_source,...alternatives].filter(Boolean).map(ref=>rows.find(row=>identity(row)===ref)).filter(Boolean);
    find('[data-source-summary]').innerHTML=chosen.length?'<details><summary>Original source editions</summary><div class="lc-table"><table><thead><tr><th>Source</th><th>Vintage</th><th>Role</th><th>Source ID</th><th>SHA-256</th></tr></thead><tbody>'+chosen.map(row=>'<tr><td>'+escape(row.title)+'</td><td>'+escape(row.vintage)+'</td><td>'+escape(row.role||'unspecified')+'</td><td>'+escape(row.source_id)+'</td><td><code>'+escape(row.body?.sha256)+'</code></td></tr>').join('')+'</tbody></table></div></details>':'';
  }
  function lists() {
    const d=clone(current.draft);
    const runOptions=(catalog.runs||[]).filter(r=>r.landcover_ready).map(r=>'<option value="'+escape(r.id)+'">'+escape(r.title)+' · '+escape(r.id.slice(0,12))+' · '+escape(r.state)+'</option>').join('');
    field('baseline').innerHTML='<option value="">Choose baseline</option>'+runOptions;field('alternatives').innerHTML=runOptions;
    const rasterOptions=(catalog.rasters||[]).map(row=>'<option value="'+escape(identity(row))+'">'+escape(row.title)+' · '+escape(row.vintage)+' · '+escape(row.role||'role unspecified')+' · '+escape(row.source_id)+'</option>').join('');
    field('baseline_source').innerHTML='<option value="">Choose source</option>'+rasterOptions;field('source_alternatives').innerHTML=rasterOptions;
    field('zones').innerHTML='<option value="">Choose source</option>'+(catalog.vectors||[]).map(row=>'<option value="'+escape(identity(row))+'">'+escape(row.title)+' · '+escape(row.vintage)+'</option>').join('');
    const selectedEdition=field('edition').value||current.lastOpened;
    field('edition').innerHTML='<option value="">Choose a saved ledger</option>'+(catalog.editions||[]).map(row=>'<option value="'+escape(row.id)+'">'+escape(row.title)+' · '+row.zone_count+' areas · '+row.alternative_count+' alternatives · '+(row.selection?.input_mode==='sources'?'annual sources':'retained runs')+'</option>').join('');
    field('edition').value=selectedEdition;restore(d);sourceDetails();buttons();
  }
  function buttons() {
    if(!root)return;
    const active=current.sending||['queued','running'].includes(current.pending?.state);
    find('[type="submit"]').disabled=!catalog||active;
    find('[data-action="check"]').disabled=!catalog;
    find('[data-action="resume"]').hidden=current.pending?.state!=='failed';
    find('[data-action="resume"]').disabled=current.sending;
  }
  async function refresh() {
    const workspace=key,view=epoch,ticket=++catalogRequest;
    note('Opening retained raster, run and reporting-source choices…');
    try {
      const result=await api(endpoint('/api/landcover-ledger/catalog',{workspace}));
      if(!alive(workspace,view)||ticket!==catalogRequest)return false;
      catalog=result;lists();save(current,key);
      note((catalog.rasters||[]).length+' retained raster sources and '+(catalog.runs||[]).filter(r=>r.landcover_ready).length+' run operands available.');
      return true;
    } catch(error){if(alive(workspace,view)&&ticket===catalogRequest)note(error.message||String(error),true);return false;}
  }
  function selection() {
    if(!catalog)throw Error('Refresh the original input catalog.');
    retain();const d=current.draft;
    const vector=(catalog.vectors||[]).find(row=>identity(row)===d.zones);
    if(!vector)throw Error('Choose an original reporting source.');
    if(!d.title.trim()||!d.id_field.trim())throw Error('Enter a title and original reporting identifier field.');
    const ids=d.ids.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const payload={title:d.title,zones:{source_collection_id:vector.source_collection_id,source_id:vector.source_id,id_field:d.id_field,name_field:d.name_field,...(d.layer?{layer:d.layer}:{}),...(ids.length?{ids}:{})},options:{support_scope:d.support,unknown_policy:d.unknown,allow_overlap:d.overlap,...(d.projected_area?{allow_projected_area:true}:{})}};
    if(d.input_mode==='sources') {
      const source=(ref,band)=>{const row=(catalog.rasters||[]).find(item=>identity(item)===ref);const n=Number(band);if(!row)throw Error('Choose an available retained raster source.');if(!Number.isSafeInteger(n)||n<1)throw Error('Each selected raster band must be a positive integer.');return {source_collection_id:row.source_collection_id,source_id:row.source_id,band:n};};
      if(!d.source_alternatives.length)throw Error('Select at least one alternative raster source.');
      payload.input_mode='sources';payload.baseline_source=source(d.baseline_source,d.baseline_band);
      payload.alternative_sources=d.source_alternatives.map(ref=>source(ref,d.source_bands[ref]||'1'));
      const refs=[payload.baseline_source,...payload.alternative_sources].map(row=>JSON.stringify(row));
      if(new Set(refs).size!==refs.length)throw Error('Choose distinct baseline and alternative source bands.');
    } else {
      const run=(catalog.runs||[]).find(row=>row.id===d.baseline&&row.landcover_ready);
      if(!run||!d.alternatives.length||d.alternatives.includes(d.baseline))throw Error('Choose a baseline and distinct alternative runs.');
      if(d.alternatives.some(id=>!catalog.runs.find(row=>row.id===id&&row.landcover_ready&&row.selection.grid_id===run.selection.grid_id)))throw Error('Choose ready alternatives on the baseline’s original retained grid.');
      payload.baseline_run_id=d.baseline;payload.alternative_run_ids=d.alternatives;
    }
    return payload;
  }
  async function checkInputs() {
    const payload=selection(),workspace=key,view=epoch,edit=current.edit,ticket=++inputRequest;
    note('Checking original source bytes, selected bands, native grid and reporting identifiers…');
    try {
      const result=await api('/api/landcover-ledger/inputs',{method:'POST',body:{workspace,selection:payload}});
      if(!alive(workspace,view)||ticket!==inputRequest||edit!==current.edit)return;
      const grid=result.grid||{},box=find('[data-input-preview]');box.hidden=false;
      box.innerHTML='<h2>Selected inputs checked</h2><p>'+escape(result.reporting?.feature_count)+' original reporting features. Native grid: '+escape(grid.crs||grid.crs_wkt||'retained grid')+' · '+escape(grid.width)+' × '+escape(grid.height)+' cells. Area basis: '+escape(grid.area_basis||'retained native grid')+'.</p><p>'+escape(result.remaining)+'</p><details><summary>Original input check</summary><pre>'+escape(JSON.stringify(result,null,2))+'</pre></details>';
      note('Selected input identity and grid checks completed. Build computes actual class transitions and coverage.');
    } catch(error){if(alive(workspace,view)&&ticket===inputRequest&&edit===current.edit)note(error.message||String(error),true);}
  }
  async function submit() {
    const payload=selection(),session=current,workspace=key,view=epoch,edit=session.edit;
    if(session.sending||['queued','running'].includes(session.pending?.state))throw Error('The original ledger task is active; continue it in the native task list.');
    const fingerprint=JSON.stringify(payload);
    if(!session.request||session.request.fingerprint!==fingerprint)session.request={fingerprint,operation_id:crypto.randomUUID()};
    const operation=session.request.operation_id;session.sending=true;save(session,workspace);buttons();
    note('Submitting the selected original inputs to the native queue…');
    try {
      const result=await api('/api/actions',{method:'POST',body:{workspace,action:'landcover.ledger.build',payload,operation_id:operation}});
      if(session.request?.operation_id!==operation)return;
      session.pending={...result,accepted_edit:edit};save(session,workspace);
      if(alive(workspace,view)){note('Ledger task '+result.id+' accepted.'+(session.storageFailure?' Browser draft storage is unavailable; the native task is retained.':''));await completed(session,workspace,view);}
    } finally {
      session.sending=false;save(session,workspace);if(alive(workspace,view))buttons();
    }
  }
  function renderEdition(result) {
    const target=find('[data-result]');target.replaceChildren();
    const title=document.createElement('h2');title.textContent=result.edition.title;target.append(title);
    const caption=document.createElement('p');caption.textContent='Saved edition '+result.edition.id+' · '+result.edition.zone_count+' reporting areas · '+result.edition.alternative_count+' alternatives. Download the portable ZIP to retain the offline report with all report companions.';target.append(caption);
    const downloads=document.createElement('div');downloads.className='lc-downloads';
    for(const ticket of result._downloads||[]) {
      const url=ticket.url||ticket.href;
      if(typeof url!=='string'||!/^\/api\/file(?:\/|\?)/.test(url))continue;
      const link=document.createElement('a');link.href=url;link.textContent=ticket.label||ticket.title||ticket.filename||'Download retained file';link.setAttribute('download','');downloads.append(link);
    }
    target.append(downloads);
    const preview=result.preview_url;
    if(typeof preview!=='string'||!/^\/api\/file\/landcover-ledger\/[A-Za-z0-9_-]+\/[a-f0-9]{64}\?embedded=1$/.test(preview))throw Error('The saved report has no valid original-host preview route.');
    const iframe=document.createElement('iframe');iframe.title=result.edition.title;iframe.setAttribute('sandbox','allow-scripts allow-downloads allow-modals');iframe.src=preview;target.append(iframe);
    const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('pre');summary.textContent='Retained selection and original source bindings';body.textContent=JSON.stringify(result.binding,null,2);details.append(summary,body);target.append(details);
  }
  async function openEdition(id) {
    if(!id)throw Error('Choose a saved edition.');
    const workspace=key,view=epoch,ticket=++editionRequest;
    note('Opening the saved report, GIS files and source bindings…');
    try {
      const result=await api(endpoint('/api/landcover-ledger/edition',{id,workspace}));
      if(!alive(workspace,view)||ticket!==editionRequest)return;
      renderEdition(result);current.lastOpened=id;field('edition').value=id;save(current,key);
      note('Original land-cover edition opened.');
    } catch(error){if(alive(workspace,view)&&ticket===editionRequest)note(error.message||String(error),true);}
  }
  async function completed(session,workspace,view) {
    const task=session.pending;if(!task||task.state!=='complete')return;
    const id=task.result?.id,edit=task.accepted_edit,opened=editionRequest;
    session.pending=null;session.request=null;save(session,workspace);
    if(!alive(workspace,view))return;
    buttons();toast('Land-cover ledger completed.');
    if(await refresh()) {
      if(alive(workspace,view)&&current===session&&session.edit===edit&&editionRequest===opened&&id)await openEdition(id);
      else if(alive(workspace,view))note('Ledger completed; its saved edition is available below. Your current input draft is preserved.');
    }
  }
  function observe() {
    if(!root||key!==getState()?.workspace_key||!current.pending)return;
    const task=(getState()?.tasks||[]).find(row=>row.id===current.pending.id&&(row.workspace==null||row.workspace===key));
    if(task)current.pending={...current.pending,...task};
    save(current,key);buttons();
    if(current.pending.state==='complete'){const workspace=key,view=epoch;completed(current,workspace,view).catch(error=>{if(alive(workspace,view))note(error.message,true);});}
    else if(current.pending.state==='failed')note(current.pending.error?.message||'Original task failed. Resume preserves completed ledger windows.',true);
    else note('Original ledger task: '+current.pending.state+'.');
  }
  async function resume() {
    const session=current,workspace=key,view=epoch,id=session.pending?.id;if(!id||session.sending)return;
    session.sending=true;buttons();
    try {
      const task=await api('/api/task/resume',{method:'POST',body:{id}});
      if(session.pending?.id===id){session.pending={...session.pending,...task};save(session,workspace);}
      if(alive(workspace,view))note('The original ledger task is queued for continuation.');
    } finally {session.sending=false;save(session,workspace);if(alive(workspace,view))buttons();}
  }
  function changed(event) {
    if(!event.target.closest('form'))return;
    retain();current.edit++;inputRequest++;
    const preview=find('[data-input-preview]');preview.hidden=true;preview.replaceChildren();
    if(event.target.name==='input_mode')mode();
    if(event.target.name==='source_alternatives'||event.target.name==='baseline_source')sourceDetails();
    save(current,key);
  }
  function detach() {if(root&&current)retain();epoch++;catalogRequest++;inputRequest++;editionRequest++;events?.abort();events=null;root=null;}
  function mount(container) {
    if(root===container&&key===getState()?.workspace_key){observe();return;}
    detach();root=container;key=getState()?.workspace_key;current=sessionFor(key);catalog=null;
    root.classList.add('landcover-extension');root.innerHTML=controls();events=new AbortController();
    const listen=(target,type,handler)=>target.addEventListener(type,handler,{signal:events.signal});
    restore(current.draft);sourceDetails();buttons();
    listen(root,'input',changed);listen(root,'change',changed);
    listen(find('form'),'submit',event=>{event.preventDefault();const workspace=key,view=epoch;submit().catch(error=>{if(alive(workspace,view))note(error.message||String(error),true);});});
    listen(root,'click',event=>{
      const button=event.target.closest('[data-action]');if(!button)return;event.preventDefault();
      const workspace=key,view=epoch;let promise;
      if(button.dataset.action==='refresh')promise=refresh();
      if(button.dataset.action==='check')promise=checkInputs();
      if(button.dataset.action==='open')promise=openEdition(field('edition').value);
      if(button.dataset.action==='resume')promise=resume();
      Promise.resolve(promise).catch(error=>{if(alive(workspace,view))note(error.message||String(error),true);});
    });
    const workspace=key,view=epoch;
    refresh().then(ok=>{if(!ok||!alive(workspace,view))return;const last=current.lastOpened,hadPending=Boolean(current.pending);observe();if(last&&!hadPending)openEdition(last);});
  }
  function update(){if(root&&key!==getState()?.workspace_key){const container=root;mount(container);}else observe();}
  return {mount,update,detach};
}
