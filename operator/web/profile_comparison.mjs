/* Original source-profile comparison and existing native-study handoff. */
const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short = value => String(value ?? '').slice(0,12);
const number = value => value == null ? '—' : Number(value).toLocaleString(undefined,{maximumSignificantDigits:7});
const cell = value => '<td>'+esc(value)+'</td>';
const json = value => JSON.stringify(value,null,2);
const button = (action,label,id='',disabled=false) => '<button type="button" data-pc-action="'+esc(action)+'"'+
  (id?' data-id="'+esc(id)+'"':'')+(disabled?' disabled':'')+'>'+esc(label)+'</button>';
const table = (heads,rows) => '<div class="pc-scroll"><table><thead><tr>'+heads.map(x=>'<th>'+esc(x)+'</th>').join('')+
  '</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const option = (row,label) => '<option value="'+esc(row.id)+'">'+esc(label||row.title||row.spec?.title||short(row.id))+'</option>';

export function attachProfileComparison(context) {
  const {api,getState,toast}=context;
  let root=null,workspace=null,catalog=null,record=null,epoch=0,version=0,detailVersion=0;
  let listeners=null,reads=null,timer=null,taskId=null,pending=null,draft=null,queuedOpen=null;
  let savedSignature='',taskBusy=false;
  const q = selector => root?.querySelector(selector);
  const field = name => q('[name="'+name+'"]');
  const value = name => field(name)?.value||'';
  const current = (token,key) => root&&epoch===token&&workspace===key&&getState()?.workspace_key===key;
  const endpoint = (path,extra={},key=workspace) => path+'?'+new URLSearchParams({workspace:key,...extra});
  const storageKey = key => 'upstate-profile-comparison:'+key;
  const profileTitle = id => catalog?.profiles.find(row=>row.id===id)?.title||short(id);

  function notify(message,error=false) {
    const node=q('[data-pc-notice]');if(!node)return;
    node.textContent=message;node.hidden=!message;node.setAttribute('role',error?'alert':'status');
  }
  function remember() {
    if(!workspace)return;
    try {globalThis.sessionStorage?.setItem(storageKey(workspace),JSON.stringify({draft,pending,taskId}));}
    catch(_) {}
  }
  function capture() {
    if(!root||!field('reference'))return;
    draft={title:value('title'),reference:value('reference'),grid:value('grid'),
      candidates:[...root.querySelectorAll('[name="candidate"]:checked')].map(node=>node.value)};
    remember();
  }
  function restore() {
    draft=null;pending=null;taskId=null;
    try {const saved=JSON.parse(globalThis.sessionStorage?.getItem(storageKey(workspace))||'null');
      if(saved&&typeof saved==='object'){draft=saved.draft;pending=saved.pending;taskId=saved.taskId;}}
    catch(_) {}
  }
  function detach() {
    capture();epoch++;detailVersion++;listeners?.abort();reads?.abort();clearTimeout(timer);
    root=null;workspace=null;catalog=null;record=null;timer=null;taskBusy=false;savedSignature='';
  }
  function layout() {
    root.innerHTML='<div class="profile-comparison-desk"><header><div><h1>Source profiles</h1>'+
      '<p>Compare original biophysical tables, model parameters and source coverage before selecting a native study.</p></div>'+
      button('reload','Refresh catalogue')+'</header><p data-pc-notice hidden></p>'+
      '<section class="pc-selection"><h2>Compare retained source editions</h2>'+
      '<div class="pc-fields"><label>Comparison title<input name="title" maxlength="240" placeholder="Name the source alternatives"></label>'+
      '<label>Reference profile<select name="reference"><option value="">Choose a reference</option></select></label>'+
      '<label>Prepared grid<select name="grid"><option value="">Compare sources without a grid</option></select></label></div>'+
      '<fieldset><legend>Candidate profiles</legend><div data-pc-candidates class="pc-candidates"></div></fieldset>'+
      '<div class="pc-actions">'+button('preview','Compare sources')+button('save','Save comparison and report')+
      button('replay','Continue last submitted request')+'</div><p data-pc-task class="pc-muted"></p></section>'+
      '<section><h2>Saved comparisons</h2><div data-pc-saved></div></section><section data-pc-result></section></div>';
  }
  async function mount(container,state=getState()) {
    if(root)detach();root=container;workspace=state?.workspace_key;
    const token=++epoch,key=workspace;listeners=new AbortController();reads=new AbortController();
    restore();layout();
    root.addEventListener('click',onClick,{signal:listeners.signal});
    root.addEventListener('change',onChange,{signal:listeners.signal});
    root.addEventListener('input',onInput,{signal:listeners.signal});
    await reload({token,key,restoreDraft:true});
    if(!current(token,key))return;
    if(queuedOpen){const id=queuedOpen;queuedOpen=null;await open(id);}
    if(taskId)schedule();
  }
  async function reload({token=epoch,key=workspace,restoreDraft=false}={}) {
    if(!restoreDraft)capture();
    const result=await api(endpoint('/api/profile-comparison/catalog',{},key),{signal:reads.signal});
    if(!current(token,key))return;
    catalog=result;
    field('reference').innerHTML='<option value="">Choose a reference</option>'+result.profiles.map(row=>option(row,row.title+' · '+row.models.join('/'))).join('');
    field('grid').innerHTML='<option value="">Compare sources without a grid</option>'+(result.grids||[]).map(row=>option(row)).join('');
    field('title').value=draft?.title||'';
    field('reference').value=draft?.reference||'';
    field('grid').value=draft?.grid||'';
    renderCandidates(draft?.candidates||[]);
    renderSaved(result.comparisons||[]);
    notify(result.profiles.length?'Original source-profile catalogue loaded.':'Retain original parameter profiles in this workspace to compare them.');
  }
  function renderCandidates(selected) {
    q('[data-pc-candidates]').innerHTML=(catalog?.profiles||[]).filter(row=>row.id!==value('reference')).map(row=>
      '<label class="pc-choice"><input type="checkbox" name="candidate" value="'+esc(row.id)+'"'+
      (selected.includes(row.id)?' checked':'')+'><span><strong>'+esc(row.title)+'</strong><small>'+
      esc(row.models.join(' / '))+' · '+esc(short(row.table_summary?.sha256))+'</small></span></label>').join('');
  }
  function selection() {
    const selected={title:value('title').trim(),reference_profile_id:value('reference'),
      candidate_profile_ids:[...root.querySelectorAll('[name="candidate"]:checked')].map(node=>node.value),grid_id:value('grid')||null};
    if(!selected.title)throw Error('Name this source-profile comparison.');
    if(!selected.reference_profile_id)throw Error('Choose the retained reference profile.');
    if(!selected.candidate_profile_ids.length)throw Error('Choose at least one retained candidate profile.');
    return selected;
  }
  async function preview() {
    const token=epoch,key=workspace,revision=version,selected=selection(),request=++detailVersion;
    notify('Reading original tables, source references and prepared-grid coverage…');
    const result=await api(endpoint('/api/profile-comparison/preview',{},key),
      {method:'POST',body:{selection:selected},signal:reads.signal});
    if(!current(token,key)||revision!==version||request!==detailVersion)return;
    record=result;renderRecord();notify('Source comparison ready. Save it to retain this edition and hand selected profiles to a native study.');
  }
  async function submit(action,payload,replay=false) {
    const token=epoch,key=workspace;
    if(replay){
      if(!pending||pending.workspace!==key)throw Error('No retained request belongs to this workspace.');
    } else {
      pending={workspace:key,action,payload,operation_id:globalThis.crypto.randomUUID()};
      remember();
    }
    const request={...pending};notify('Retaining the request in the original operator queue…');
    const task=await api('/api/actions',{method:'POST',body:request});
    if(!current(token,key))return;
    taskId=task.id;pending=null;remember();
    await context.refresh({force:true});
    if(!current(token,key))return;
    await context.showTask(task.id);
    if(!current(token,key))return;
    q('[data-pc-task]').textContent='Task '+short(task.id)+' · '+task.state;
    schedule();
  }
  function schedule() {
    clearTimeout(timer);if(!root||!taskId)return;
    timer=setTimeout(()=>poll().catch(error=>{if(error.name!=='AbortError'){notify(error.message,true);schedule();}}),1800);
  }
  async function poll() {
    if(taskBusy||!root||!taskId)return;
    taskBusy=true;const token=epoch,key=workspace,id=taskId;
    try {
      const task=await api(endpoint('/api/task',{id},key),{signal:reads.signal});
      if(!current(token,key)||id!==taskId)return;
      if(task.workspace!==key||!['profile_comparison.create','profile_comparison.export'].includes(task.action))throw Error('The retained task belongs to another workspace or operation.');
      q('[data-pc-task]').textContent='Task '+short(id)+' · '+task.state+(task.error?' · '+(task.error.message||json(task.error)):'');
      if(['queued','running'].includes(task.state)){schedule();return;}
      taskId=null;remember();
      if(task.state==='complete'&&task.result?.id){
        await context.refresh({force:true});
        if(!current(token,key))return;
        await open(task.result.id);notify('Source comparison and original report retained.');
      }
    } finally {taskBusy=false;}
  }
  function renderSaved(rows) {
    const signature=JSON.stringify(rows);if(signature===savedSignature)return;savedSignature=signature;
    q('[data-pc-saved]').innerHTML=rows.length?table(['Comparison','Profiles','Prepared grid',''],rows.map(row=>
      '<tr><th scope="row">'+esc(row.title)+'<small>'+esc(short(row.id))+'</small></th>'+cell(row.profile_count)+
      cell(row.grid_id?short(row.grid_id):'Source tables')+'<td>'+button('open','Open',row.id)+'</td></tr>')):
      '<p class="pc-muted">Saved source comparisons remain with this scientific workspace and its portable backup.</p>';
  }
  function update(state=getState()) {
    if(!root||state?.workspace_key!==workspace)return;
    renderSaved(state.data?.profile_comparisons||catalog?.comparisons||[]);
  }
  async function open(id) {
    const token=epoch,key=workspace,request=++detailVersion;
    const result=await api(endpoint('/api/profile-comparison/inspect',{comparison_id:id},key),{signal:reads.signal});
    if(!current(token,key)||request!==detailVersion)return;
    record=result;renderRecord();q('[data-pc-result]').scrollIntoView?.({block:'nearest'});
  }
  function profileNames() {
    return Object.fromEntries((record?.profiles||[]).map(row=>[row.id,row.title]));
  }
  function renderRecord() {
    const names=profileNames(),saved=Boolean(record.id),coverage=record.coverage;
    let html='<article><h2>'+esc(record.title)+'</h2><p>Reference: <strong>'+esc(record.profiles[0].title)+
      '</strong>. Differences are candidate minus reference.</p><div class="pc-actions">'+
      (saved?button('study','Use selected source profiles in a native study')+button('export','Rebuild complete report',record.id):'')+
      (record._report_url?'<a href="'+esc(record._report_url)+'" target="_blank" rel="noopener">Open full source report</a>':'')+'</div>';
    if(record._downloads?.length)html+='<div class="pc-downloads">'+record._downloads.filter(row=>/\.zip$|\.csv$|comparison.json$/.test(row.filename||row.label||'')).map(row=>
      '<a href="'+esc(row.url)+'" download>'+esc(row.label||row.filename)+'</a>').join('')+'</div>';
    html+='<h3>Source alternatives</h3>'+table(['Use in study','Candidate','Shared models','Changed land-cover codes','Changed prepared-grid cells','Changed model parameters','Grid codes absent'],record.contrasts.map(row=>{
      const missing=Object.values(row.missing_grid_codes||{}).flatMap(value=>value.lucodes||[]);
      return '<tr><td><input aria-label="Use '+esc(names[row.candidate_profile_id])+'" type="checkbox" name="study_candidate" value="'+esc(row.candidate_profile_id)+'"'+
        (row.study_models.length?' checked':' disabled')+'></td>'+cell(names[row.candidate_profile_id])+cell(row.shared_models.join(' / '))+
        cell(row.changed_lucodes.join(', ')||'None')+cell(number(row.changed_prepared_grid_cells))+cell(row.changed_parameter_count)+
        cell([...new Set(missing)].join(', ')||'None')+'</tr>';
    }));
    if(coverage)html+='<p class="pc-context"><strong>Prepared input support:</strong> '+esc(coverage.scope)+'. '+
      number(coverage.valid_cells)+' valid cells. Counts include the aligned rectangular input, before a reporting mask is applied. Grid '+
      esc(short(coverage.grid_id))+'; resolution '+esc(coverage.grid_definition.resolution_m)+' m.</p>';
    html+='<details><summary>Original profile references and full tables</summary>'+
      record.profiles.map(profile=>'<section class="pc-source"><h4>'+esc(profile.title)+'</h4><p>'+esc(profile.models.join(' / '))+
        ' · table SHA256 <code>'+esc(profile.table.sha256)+'</code></p><p>Scientific status: '+
        esc(profile.profile.scientific_status||'As retained in original profile')+'</p><pre>'+esc(json({
          references:profile.profile.references,source:profile.source,table:profile.table,profile:profile.profile
        }))+'</pre></section>').join('')+'</details>';
    html+='<h3>Biophysical coefficient comparison</h3><div class="pc-filters">'+
      '<label>Candidate<select name="filter_candidate"><option value="">All candidates</option>'+
      record.profiles.slice(1).map(row=>option(row)).join('')+'</select></label>'+
      '<label>Model<select name="filter_model"><option value="">NDR and SDR</option><option value="ndr">NDR</option><option value="sdr">SDR</option></select></label>'+
      '<label>Field<select name="filter_field"><option value="">All fields</option>'+record.fields.map(row=>'<option value="'+esc(row.id)+'">'+esc(row.title)+'</option>').join('')+'</select></label>'+
      '<label>Land-cover code<input name="filter_code" inputmode="numeric" placeholder="Any code"></label>'+
      '<label class="pc-check"><input type="checkbox" name="filter_changed" checked>Show changes only</label>'+
      '<label class="pc-check"><input type="checkbox" name="filter_active" checked>Shared model scope</label></div>'+
      '<p class="pc-muted">Application-rate loads are adjusted by (1 − retention efficiency); measured-runoff loads retain their original value at this step. The derived loading columns precede native runoff and routing. Raw loads with different definitions remain marked separately.</p>'+
      '<div data-pc-coefficients></div><h3>Native model parameter comparison</h3><div data-pc-parameters></div>';
    html+='<details><summary>Native run snapshot for these exact profiles'+(coverage?' and grid':'')+'</summary>'+
      table(['Native run','State','Profile','Grid','Scenario','Retained output quantities'],record.native_runs.map(row=>'<tr>'+
        '<td>'+button('native-run',short(row.id),row.id)+'</td>'+cell(row.state)+cell(names[row.selection.profile_id]||short(row.selection.profile_id))+
        cell(short(row.selection.grid_id))+cell(short(row.selection.scenario_id))+cell(json(row.artifacts))+'</tr>'))+'</details>';
    html+='<details><summary>Method references and interpretation</summary>'+record.methods.map(row=>'<p><a href="'+esc(row.url)+'" target="_blank" rel="noopener">'+
      esc('InVEST '+row.version+' · '+row.section)+'</a>: '+esc(row.rule)+'</p>').join('')+
      record.interpretation.map(text=>'<p>'+esc(text)+'</p>').join('')+'</details></article>';
    q('[data-pc-result]').innerHTML=html;renderValues();
  }
  function renderValues() {
    if(!record)return;const names=profileNames(),candidate=value('filter_candidate'),model=value('filter_model'),
      selectedField=value('filter_field'),code=value('filter_code').trim(),changed=field('filter_changed')?.checked,active=field('filter_active')?.checked;
    const rows=record.coefficients.filter(row=>(!candidate||candidate===row.candidate_profile_id)&&(!model||model===row.model)&&
      (!selectedField||selectedField===row.field)&&(!code||String(row.lucode)===code)&&(!changed||row.changed)&&(!active||row.model_active_in_both));
    q('[data-pc-coefficients]').innerHTML='<p>'+number(rows.length)+' of '+number(record.coefficients.length)+' coefficient entries.</p>'+
      table(['Candidate','Code / source descriptions','Coefficient','Reference','Candidate value','Change','Change %','Prepared cells','Definition'],rows.map(row=>
      '<tr>'+cell(names[row.candidate_profile_id])+'<td><strong>'+esc(row.lucode)+'</strong><small>'+esc(row.reference_description||'')+
      (row.candidate_description!==row.reference_description?' → '+esc(row.candidate_description||''):'')+'</small></td>'+
      '<td>'+esc(row.title)+'<small>'+esc(row.units)+(row.derived?' · derived':'')+'</small></td>'+
      cell(row.reference_value)+cell(row.candidate_value)+cell(number(row.difference))+cell(number(row.relative_change_percent))+
      cell(number(row.prepared_grid_cells))+cell(row.load_definition_matches?(row.model_active_in_both?'Shared scope':'Inactive model'):'Load definitions differ')+'</tr>'));
    const parameters=record.parameters.filter(row=>(!candidate||candidate===row.candidate_profile_id)&&(!model||model===row.model)&&
      (!changed||row.changed)&&(!active||row.model_active_in_both));
    q('[data-pc-parameters]').innerHTML=table(['Candidate','Model','Parameter','Reference','Candidate value','Change','Change %'],
      parameters.map(row=>'<tr>'+cell(names[row.candidate_profile_id])+cell(row.model.toUpperCase())+cell(row.field)+cell(row.reference_value)+
      cell(row.candidate_value)+cell(number(row.difference))+cell(number(row.relative_change_percent))+'</tr>'));
  }
  async function study() {
    if(!record?.id)throw Error('Save this source comparison before preparing its native study.');
    const ids=[...root.querySelectorAll('[name="study_candidate"]:checked')].map(node=>node.value),token=epoch,key=workspace;
    const selected=await api(endpoint('/api/profile-comparison/study',{},key),
      {method:'POST',body:{comparison_id:record.id,candidate_profile_ids:ids},signal:reads.signal});
    if(!current(token,key))return;
    return context.openExtension('ensembles','prepare',selected);
  }
  function onChange(event) {
    if(event.target.name?.startsWith('filter_')){renderValues();return;}
    if(event.target.name==='study_candidate')return;
    if(event.target.name==='reference'){
      const selected=[...root.querySelectorAll('[name="candidate"]:checked')].map(node=>node.value);
      renderCandidates(selected);
    }
    version++;capture();
  }
  function onInput(event) {
    if(event.target.name?.startsWith('filter_')){renderValues();return;}
    if(event.target.name==='title'){version++;capture();}
  }
  async function onClick(event) {
    const node=event.target.closest?.('[data-pc-action]');if(!node||!root?.contains(node))return;
    event.preventDefault();event.stopPropagation();node.disabled=true;
    try {
      const action=node.dataset.pcAction,id=node.dataset.id;
      if(action==='reload')await reload();
      else if(action==='preview')await preview();
      else if(action==='save'){capture();await submit('profile_comparison.create',{selection:selection()});}
      else if(action==='replay')await submit(null,null,true);
      else if(action==='open')await open(id);
      else if(action==='export')await submit('profile_comparison.export',{comparison_id:id});
      else if(action==='study')await study();
      else if(action==='native-run')await context.openItem('runs',id);
    } catch(error){if(error.name!=='AbortError'){notify(error.message,true);toast?.(error.message);}}
    finally {if(node.isConnected)node.disabled=false;}
  }
  return {mount,update,detach,open:id=>{
    queuedOpen=id;context.navigate('profile-comparison');
    if(root&&catalog&&workspace===getState()?.workspace_key){queuedOpen=null;return open(id);}
  }};
}
