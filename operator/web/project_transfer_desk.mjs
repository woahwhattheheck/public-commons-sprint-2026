/** Registered original transfer desk; TokenJunkieLabs. */
export function createProjectTransferDesk(host) {
  const arr = value => Array.isArray(value) ? value : [];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const short = value => String(value || '').slice(0, 12);
  const countLabel = (value, noun) => value.toLocaleString()+' '+noun+(value===1?'':'s');
  const identity = /^[0-9a-f]{64}$/;
  const bytes = value => {
    if (!Number.isFinite(Number(value)) || value === null) return 'Unavailable';
    let n = Number(value), u = 0; const units = ['B','KiB','MiB','GiB','TiB'];
    while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
    return n.toLocaleString(undefined,{maximumFractionDigits:u ? 1 : 0}) + ' ' + units[u];
  };
  const date = value => value ? new Date(typeof value === 'number' ? value * 1000 : value).toLocaleString() : 'Date unavailable';
  const canonical = value => {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
    return JSON.stringify(value);
  };
  const terminal = value => ['complete','failed','interrupted','cancelled'].includes(value);
  const names = {
    'project.transfer.capture':'Capture current workspace',
    'project.transfer.capture-study':'Capture selected study',
    'project.transfer.accept':'Accept transfer manifest',
    'project.transfer.receive':'Receive transfer part',
    'project.transfer.parts':'Prepare transfer parts',
    'project.transfer.archive':'Rebuild original archive',
    'project.transfer.restore':'Restore editable workspace',
    'project.transfer.report':'Export complete inventory',
    'project.transfer.inspect':'Check receiving progress',
    'project.transfer.diff':'Compare transfer editions'
  };
  let node = null, state = host.getState(), workspace = null, generation = 0, timer = null;
  let catalog = null, catalogPromise = null, detail = null, detailBusy = false, detailPromise = null;
  let busy = false, loading = false, error = '', message = '', taskFingerprint = '', taskDetailsPromise = null;
  let tab = 'prepare', selectedSnapshot = '', selectedExport = '', incomingStudy = null;
  let mode = 'study', chunkMiB = 4, payloadMiB = 64, includeIntermediates = true, includeDeliveries = true;
  let requestUpload = null, beforeSnapshot = '', fileOffset = 0, historyLimit = 20;
  let pending = {}, localTasks = new Map(), seenComplete = new Set(), fileInputs = {};
  const key = () => 'upstate-project-transfer-v2:' + workspace;
  const button = (action, title, extra = '', disabled = false, primary = false) =>
    '<button type="button" data-pt-action="'+action+'" '+extra+(disabled?' disabled':'')+
    (primary?' class="pt-primary"':'')+'>'+esc(title)+'</button>';
  function tasks() {
    const rows = new Map();
    for (const item of localTasks.values()) if (item.workspace === workspace) rows.set(item.id,item);
    for (const item of arr(state?.tasks)) if (item.workspace === workspace && names[item.action]) {
      const previous = rows.get(item.id) || {};
      const merged = {...previous,...item};
      if (item.state !== 'complete') delete merged._downloads;
      rows.set(item.id,merged);
    }
    return [...rows.values()].sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || b.id.localeCompare(a.id));
  }
  function persist() {
    if (!workspace) return;
    try {
      sessionStorage.setItem(key(),JSON.stringify({tab,selectedSnapshot,selectedExport,incomingStudy,mode,chunkMiB,payloadMiB,
        includeIntermediates,includeDeliveries,requestUpload,beforeSnapshot,pending}));
    } catch { /* Native queue and source files remain authoritative. */ }
  }
  function activate(next) {
    if (next === workspace) return;
    generation++; workspace = next; catalog = null; catalogPromise = null; detail = null; detailPromise = null;
    detailBusy = false; loading = false; busy = false; taskDetailsPromise = null;
    localTasks = new Map(); seenComplete = new Set(); pending = {}; fileInputs = {};
    tab = 'prepare'; selectedSnapshot = ''; selectedExport = ''; incomingStudy = null; beforeSnapshot = '';
    mode = 'study'; chunkMiB = 4; payloadMiB = 64; requestUpload = null; fileOffset = 0;
    includeIntermediates = true; includeDeliveries = true; error = ''; message = ''; taskFingerprint = '';
    try {
      const saved = JSON.parse(sessionStorage.getItem(key()) || '{}');
      tab = ['prepare','receive','inspect'].includes(saved.tab) ? saved.tab : 'prepare';
      selectedSnapshot = saved.selectedSnapshot || ''; selectedExport = saved.selectedExport || '';
      incomingStudy = saved.incomingStudy?.workspace_key === workspace ? saved.incomingStudy : null;
      mode = saved.mode === 'workspace' ? 'workspace' : 'study';
      chunkMiB = Number(saved.chunkMiB) || 4; payloadMiB = Number(saved.payloadMiB) || 64;
      includeIntermediates = saved.includeIntermediates !== false; includeDeliveries = saved.includeDeliveries !== false;
      requestUpload = saved.requestUpload || null; beforeSnapshot = saved.beforeSnapshot || ''; pending = saved.pending || {};
    } catch { /* Start with the current workspace's retained inventory. */ }
    for (const item of tasks()) if (item.state === 'complete') seenComplete.add(item.id);
  }
  function selectedStudy() {
    return arr(catalog?.study_exports).find(row => row.task_id === selectedExport) ||
      (incomingStudy?.task_id === selectedExport ? {task_id:incomingStudy.task_id,study_id:incomingStudy.study_id,
        title:incomingStudy.title,bytes:incomingStudy.archive?.bytes,sha256:incomingStudy.archive?.sha256} : null);
  }
  function selectedTitle(id) {
    const source = tasks().find(item => item.result?.snapshot_id === id && item.result?.study_title);
    const snapshot = arr(catalog?.snapshots).find(item => item.id === id);
    return source?.result?.study_title || snapshot?.project?.title || 'Transfer ' + short(id);
  }
  async function read(operation, payload = {}, expected = workspace) {
    return host.api('/api/project-transfers/' + operation,{method:'POST',body:{workspace:expected,...payload}});
  }
  async function loadCatalog(more = false) {
    if (!workspace) return;
    if (catalogPromise) return catalogPromise;
    const expected = workspace, epoch = generation, offset = more ? catalog?.next_offset : 0;
    if (more && offset == null) return;
    loading = true;
    const promise = (async () => {
      try {
        const result = await read('catalog',{offset:offset || 0,limit:100},expected);
        if (workspace !== expected || generation !== epoch) return;
        catalog = more ? {...result,study_exports:[...arr(catalog?.study_exports),...arr(result.study_exports)]} : result;
        if (!selectedExport && result.study_exports?.length) selectedExport = result.study_exports[0].task_id;
        if (!selectedSnapshot && result.snapshots?.length) selectedSnapshot = [...result.snapshots].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0].id;
        persist();
      } catch (problem) { if (workspace === expected) error = problem.message; }
      finally { if (workspace === expected && generation === epoch) { loading = false; catalogPromise = null; render(); } }
    })();
    catalogPromise = promise;
    return promise;
  }
  async function refreshTaskDetails() {
    if (!workspace) return;
    if (taskDetailsPromise) return taskDetailsPromise;
    const expected = workspace, epoch = generation;
    const ids = tasks().slice(0,historyLimit).map(item=>item.id);
    if (!ids.length) return;
    const promise = (async () => {
      try {
        const result = await read('tasks',{task_ids:ids},expected);
        if (workspace === expected && generation === epoch) {
          for (const item of arr(result.items)) localTasks.set(item.id,item);
          render();
        }
      } catch (problem) { if (workspace === expected && generation === epoch) error=problem.message; }
    })();
    taskDetailsPromise=promise;
    try { await promise; }
    finally { if (taskDetailsPromise===promise) taskDetailsPromise=null; }
  }
  async function loadDetail(offset = fileOffset) {
    if (!selectedSnapshot || !workspace) return;
    const expected = workspace, selected = selectedSnapshot, epoch = generation;
    if (detailPromise) {
      await detailPromise;
      if (workspace === expected && generation === epoch && selectedSnapshot === selected &&
          (detail?.snapshot_id !== selected || detail?.offset !== offset)) return loadDetail(offset);
      return;
    }
    detailBusy = true;
    const promise = (async () => {
      try {
        const result = await read('snapshot',{snapshot_id:selected,offset,limit:200},expected);
        if (workspace === expected && generation === epoch && selectedSnapshot === selected) {
          detail = result; fileOffset = offset;
        }
      } catch (problem) { if (workspace === expected && generation === epoch && selectedSnapshot === selected) error = problem.message; }
    })();
    detailPromise = promise;
    try { await promise; }
    finally {
      if (detailPromise === promise) { detailPromise = null; detailBusy = false; }
      if (workspace === expected && generation === epoch) render();
    }
  }
  function downloads(items) {
    if (!arr(items).length) return '';
    return '<ul class="pt-files">'+items.map(item => {
      const url = typeof item.url === 'string' && /^\/api\/file\/[0-9a-f]{64}$/.test(item.url) ? item.url : '';
      return '<li><div><strong>'+esc(item.label || item.filename)+'</strong><small>'+bytes(item.bytes)+
        ' · <span title="'+esc(item.sha256)+'">'+short(item.sha256)+'</span></small></div>'+
        (url?'<a href="'+esc(url)+'?download=1" download>Download</a>':'')+'</li>';
    }).join('')+'</ul>';
  }
  function notice() {
    return (error?'<div class="pt-notice pt-error" role="alert"><strong>Action needs attention</strong><p>'+esc(error)+'</p></div>':'')+
      (message?'<div class="pt-notice" role="status">'+esc(message)+'</div>':'');
  }
  function snapshotOptions(value, empty = 'Choose a retained transfer') {
    return '<option value="">'+esc(empty)+'</option>'+arr(catalog?.snapshots).map(item =>
      '<option value="'+item.id+'"'+(item.id===value?' selected':'')+'>'+esc(selectedTitle(item.id))+
      ' · '+short(item.id)+' · '+item.files.toLocaleString()+' files</option>').join('');
  }
  function prepareView() {
    const study = selectedStudy(), exports = arr(catalog?.study_exports);
    const options = exports.map(item => '<option value="'+item.task_id+'"'+(item.task_id===selectedExport?' selected':'')+'>'+
      esc(item.title)+' · '+bytes(item.bytes)+' · '+date(item.ended_at)+'</option>').join('');
    const extra = incomingStudy && !exports.some(item=>item.task_id===incomingStudy.task_id) ?
      '<option value="'+esc(incomingStudy.task_id)+'" selected>'+esc(incomingStudy.title || 'Selected scientific study')+'</option>' : '';
    return '<section class="pt-card"><h2>Prepare an editable handover</h2><p>Capture a completed study export or the current workspace. The original project identity and retained files travel together.</p>'+
      '<div class="pt-choice"><label><input type="radio" name="pt-mode" value="study" data-pt-field="mode"'+(mode==='study'?' checked':'')+'> Completed study export</label>'+
      '<label><input type="radio" name="pt-mode" value="workspace" data-pt-field="mode"'+(mode==='workspace'?' checked':'')+'> Current workspace</label></div>'+
      (mode==='study'?'<label class="pt-field">Study export<select data-pt-field="selectedExport"><option value="">Choose a completed export</option>'+extra+options+'</select></label>'+
        (catalog?.next_offset!=null?button('more-exports','Load more completed exports','',loading):'')+
        (study?'<div class="pt-source"><strong>'+esc(study.title)+'</strong><span>'+bytes(study.bytes)+' · export '+short(study.task_id)+'</span>'+
          button('source-task','Open original export task','data-id="'+esc(study.task_id)+'"')+'</div>':
          '<p class="pt-empty">Completed study exports appear here. Open the study desk to select runs, experiments and saved results.</p>')+
        button('study-desk','Open selected studies'):
        '<div class="pt-choice"><label><input type="checkbox" data-pt-field="includeIntermediates"'+(includeIntermediates?' checked':'')+'> Retain native intermediate files</label>'+
        '<label><input type="checkbox" data-pt-field="includeDeliveries"'+(includeDeliveries?' checked':'')+'> Retain deliveries</label></div>')+
      '<details class="pt-settings"><summary>Transfer block size</summary><label class="pt-field">Block size (MiB)<input type="number" min="0.0625" max="64" step="0.0625" data-pt-field="chunkMiB" value="'+esc(chunkMiB)+'"></label>'+
      '<p>Use the same block size for later editions to reuse unchanged blocks. The default is 4 MiB.</p></details>'+
      '<div class="pt-actions">'+button('capture',mode==='study'?'Prepare selected study transfer':'Capture current workspace','',busy||(mode==='study'&&!study),true)+'</div></section>'+
      partsView();
  }
  function partsView() {
    return '<section class="pt-card"><h2>Send manifest and parts</h2><p>Send the manifest first. A receiver can return its missing-block request so later parts contain only the data it needs.</p>'+
      '<label class="pt-field">Retained transfer<select data-pt-field="selectedSnapshot">'+snapshotOptions(selectedSnapshot)+'</select></label>'+
      '<div class="pt-grid"><label class="pt-field">Raw payload per part (MiB)<input type="number" min="0.0625" step="1" data-pt-field="payloadMiB" value="'+esc(payloadMiB)+'"></label>'+
      '<label class="pt-field">Receiver request (optional)<input type="file" accept=".json,application/json" data-pt-file="request">'+(fileInputs.request?'<small>Selected: '+esc(fileInputs.request.name)+'</small>':'')+'</label></div>'+
      (requestUpload?'<div class="pt-inline">Retained request: '+esc(requestUpload.filename || 'receiver request')+' '+button('clear-request','Use all blocks')+'</div>':'')+
      '<p class="pt-help">Parts also contain the original manifest and ZIP metadata. Their downloaded file size can exceed the raw payload setting. This operator accepts uploads up to '+bytes(state?.limits?.upload_bytes)+'.</p>'+
      '<div class="pt-actions">'+button('inspect','Download manifest and receiver request','',busy||!selectedSnapshot)+
      button('parts','Prepare transfer parts','',busy||!selectedSnapshot,true)+'</div></section>';
  }
  function receivingView() {
    return '<section class="pt-card"><h2>Receive an existing project edition</h2><p>Choose the sender’s original transfer manifest and part files. Received blocks are retained and reused across retries and later editions.</p>'+
      '<label class="pt-field">Original transfer manifest<input type="file" accept=".json,application/json" data-pt-file="manifest">'+(fileInputs.manifest?'<small>Selected: '+esc(fileInputs.manifest.name)+'</small>':'')+'</label>'+
      '<div class="pt-actions">'+button('accept','Retain transfer manifest','',busy||!fileInputs.manifest)+'</div>'+
      '<label class="pt-field">Transfer parts<input type="file" accept=".zip,application/zip" multiple data-pt-file="parts"></label>'+
      '<p class="pt-help">'+(fileInputs.parts?.length?fileInputs.parts.length+' selected part files: '+fileInputs.parts.map(file=>esc(file.name)).join(', '):'Part files may be received in any order; each carries its original manifest.')+'</p>'+
      '<div class="pt-actions">'+button('receive','Receive selected parts','',busy||!fileInputs.parts?.length,true)+'</div></section>'+
      inspectView(false);
  }
  function inspectView(showInventory = true) {
    const request = detail?.request, percent = request?.bytes_total ? 100*request.bytes_present/request.bytes_total : (request?.complete?100:0);
    const ready = request?.complete === true;
    return '<section class="pt-card"><h2>Retained transfer</h2><label class="pt-field">Project edition<select data-pt-field="selectedSnapshot">'+snapshotOptions(selectedSnapshot)+'</select></label>'+
      (selectedSnapshot?'<p class="pt-id">'+esc(selectedSnapshot)+'</p>':'<p class="pt-empty">Capture a study or receive an original manifest to create a retained transfer.</p>')+
      (detail?'<div class="pt-metrics"><div><strong>'+Number(detail.file_count).toLocaleString()+'</strong><span>Original files</span></div>'+
      '<div><strong>'+bytes(detail.logical_bytes)+'</strong><span>Original file content</span></div><div><strong>'+bytes(request.bytes_present)+'</strong><span>Verified blocks retained</span></div>'+
      '<div><strong>'+bytes(request.bytes_remaining)+'</strong><span>Still needed</span></div></div>'+
      '<label class="pt-progress-label">Receiving coverage — '+percent.toFixed(1)+'%<progress max="100" value="'+percent+'"></progress></label>'+
      '<p class="pt-status"><strong>'+(ready?'All blocks are available.':'Receive the remaining original blocks.')+'</strong> '+
      request.blocks_present.toLocaleString()+' of '+request.blocks_total.toLocaleString()+' unique blocks are present.</p>':'')+
      '<div class="pt-actions">'+button('check','Refresh receiving coverage','',busy||detailBusy||!selectedSnapshot)+
      button('inspect','Download missing-block request','',busy||!selectedSnapshot)+
      button('report','Export file inventory','',busy||!selectedSnapshot)+'</div>'+
      acquisitionsView(detail?.source_acquisitions)+implementationView(detail?.implementation)+parameterStudiesView(detail?.parameter_studies)+
      '<div class="pt-divider"><h3>Reconstruct and continue</h3><p>Build a complete original archive for storage, or restore an editable copy into this operator’s receiving area.</p>'+
      '<div class="pt-actions">'+button('archive','Build original archive','',busy||!ready)+button('restore','Restore editable copy','',busy||!ready,true)+'</div></div></section>'+
      (showInventory?'<section class="pt-card"><h2>Compare editions</h2><div class="pt-grid"><label class="pt-field">Earlier edition<select data-pt-field="beforeSnapshot">'+snapshotOptions(beforeSnapshot)+'</select></label>'+
      '<div class="pt-field"><span>Current edition</span><strong>'+esc(selectedTitle(selectedSnapshot))+'</strong></div></div>'+
      button('diff','Compare original files','',busy||!beforeSnapshot||!selectedSnapshot||beforeSnapshot===selectedSnapshot)+
      '<p class="pt-help">The comparison lists added, changed, unchanged and removed members, with reusable block bytes.</p></section>'+inventoryView():'');
  }
  function inventoryView() {
    if (!detail) return '';
    return '<section class="pt-card"><h2>Original file inventory</h2><div class="pt-table"><table><thead><tr><th>Original member</th><th>Bytes</th><th>SHA-256</th></tr></thead><tbody>'+
      arr(detail.files).map(row=>'<tr><td>'+esc(row.path)+'</td><td>'+bytes(row.bytes)+'</td><td title="'+esc(row.sha256)+'">'+short(row.sha256)+'</td></tr>').join('')+
      '</tbody></table></div><div class="pt-pager"><span>'+Math.min(detail.offset+1,detail.total_files).toLocaleString()+'–'+
      Math.min(detail.offset+detail.files.length,detail.total_files).toLocaleString()+' of '+detail.total_files.toLocaleString()+' members</span>'+
      button('previous-files','Previous','',detailBusy||detail.offset===0)+button('next-files','Next','',detailBusy||detail.next_offset==null)+'</div></section>';
  }
  function progressText(value) {
    if (!value) return '';
    const phase = String(value.phase || '').replaceAll('_',' ');
    if (value.bytes_total != null) return phase+' · '+bytes(value.bytes_done ?? value.received_bytes ?? 0)+' / '+bytes(value.bytes_total);
    if (value.parts_total != null) return phase+' · '+value.parts_done+' / '+value.parts_total+' parts';
    if (value.files_total != null) return phase+' · '+value.files_done+' / '+value.files_total+' files';
    if (value.received_bytes != null) return phase+' · received '+bytes(value.received_bytes)+' · reused '+bytes(value.reused_bytes);
    return phase;
  }
  function acquisitionsView(value, task = null) {
    if (!value || value.schema !== 'upstate.source-acquisition-receiving/v1') return '';
    const rows = arr(value.operations);
    const destination = task?.result?.workspace_key ||
      (['project.transfer.capture','project.transfer.capture-study'].includes(task?.action) ? task.workspace : null);
    const continuations = rows.filter(row => row.continued_from).length;
    return '<details class="pt-settings"><summary>Retained soil and floodplain acquisitions · '+
      countLabel(rows.length,'operation')+' · '+countLabel(continuations,'continuation')+'</summary>'+
      '<p>Original source requests, provider responses, imported source editions and continuation history travel with this project.</p>'+
      (rows.length?'<div class="pt-table"><table><thead><tr><th>Acquisition</th><th>Retained state</th><th>Source editions</th><th>Open</th></tr></thead><tbody>'+
      rows.map(row => {
        const retained = row.selection_retained === true && identity.test(row.resume_operation_id || '');
        const editions = [row.source_collection_id,row.original_source_collection_id].filter(Boolean);
        const action = task?.state === 'complete' && destination && retained ?
          button('open-acquisition','Open acquisition','data-id="'+esc(task.id)+'" data-operation-id="'+esc(row.id)+'"') : '';
        return '<tr><td><strong>'+esc(row.title || 'Source acquisition')+'</strong><div class="pt-id">'+esc(row.id)+'</div>'+
          (row.continued_from?'<small>Continues '+esc(short(row.continued_from))+'</small>':'')+
          '<div>'+arr(row.families).map(esc).join(', ')+'</div></td><td>'+esc(String(row.state || 'prepared').replaceAll('_',' '))+
          (Number.isSafeInteger(row.retained_result_files)?'<small> · '+countLabel(row.retained_result_files,'result file')+'</small>':'')+
          '</td><td>'+editions.map(value=>'<span class="pt-id" title="'+esc(value)+'">'+esc(short(value))+'</span>').join('<br>')+
          (editions.length?'':'No imported edition in this acquisition')+'</td><td>'+action+
          (!retained?'Original preparation retained':!destination?'Available after editable restoration':'')+'</td></tr>';
      }).join('')+'</tbody></table></div>':'<p class="pt-empty">This edition contains no retained soil or floodplain acquisition operations.</p>')+
      '</details>';
  }
  function implementationView(value, task = null) {
    if (!value || value.schema !== 'upstate.implementation-receiving/v1') return '';
    const plans = arr(value.plans);
    const destination = task?.result?.workspace_key ||
      (['project.transfer.capture','project.transfer.capture-study'].includes(task?.action) ? task.workspace : null);
    const reports = plans.reduce((n,row) => n + arr(row.reports).length,0);
    return '<details class="pt-settings"><summary>Implementation and fieldwork · '+
      countLabel(plans.length,'plan')+' · '+countLabel(reports,'report edition')+'</summary>'+
      '<p>Saved plan revisions, tasks, sites, field records, attached originals and retained reports remain available in the editable project.</p>'+
      (plans.length?'<div class="pt-table"><table><thead><tr><th>Saved plan</th><th>Fieldwork</th><th>Sources and reports</th><th>Open</th></tr></thead><tbody>'+
      plans.map(row => {
        const counts = row.record_counts || {}, linked = arr(row.unavailable_attachments);
        const revisions = Number.isSafeInteger(row.revision_count) ? row.revision_count : null;
        const action = task?.state === 'complete' && destination && typeof row.id === 'string' &&
          Number.isSafeInteger(row.revision) && row.revision >= 1 ?
          button('open-fieldwork','Open saved revision','data-id="'+esc(task.id)+'" data-plan-id="'+esc(row.id)+'"') : '';
        const fieldCounts = [['tasks','task'],['sites','site'],['visits','visit'],['activities','activity'],['observations','observation'],['monitoring_plans','monitoring plan']]
          .filter(([key])=>Number.isSafeInteger(counts[key])&&counts[key]>0)
          .map(([key,label])=>label==='activity'?counts[key].toLocaleString()+' '+(counts[key]===1?'activity':'activities'):countLabel(counts[key],label)).join(' · ');
        return '<tr><td><strong>'+esc(row.title || 'Implementation plan')+'</strong><div class="pt-id">'+esc(row.id)+'</div>'+
          '<small>Revision '+esc(row.revision)+(revisions===null?'':' · '+countLabel(revisions,'retained revision'))+'</small></td>'+
          '<td>'+(fieldCounts||'No fieldwork records in this revision')+'</td><td>'+
          (Number.isSafeInteger(row.attachment_count)?countLabel(row.attachment_count,'attached original'):'')+
          (linked.length?'<div>'+countLabel(linked.length,'external source reference')+'</div><ul>'+
            linked.map(item=>'<li>'+esc(item.label||item.id||item.reference)+'</li>').join('')+'</ul>':'')+
          (arr(row.reports).length?'<ul>'+row.reports.map(report=>'<li>Report revision '+esc(report.revision)+
            (report.as_of?' · '+esc(report.as_of):'')+(Number.isSafeInteger(report.files)?' · '+countLabel(report.files,'file'):'')+'</li>').join('')+'</ul>':'<div>No retained report edition</div>')+
          '</td><td>'+action+(!destination?'Available after editable restoration':'')+'</td></tr>';
      }).join('')+'</tbody></table></div>':'<p class="pt-empty">This edition contains no saved implementation or fieldwork plans.</p>')+
      '</details>';
  }

  function parameterStudiesView(value,task=null) {
    if(!value||value.schema!=='upstate.parameter-study-receiving/v1')return '';
    const studies=arr(value.studies),destination=task?.result?.workspace_key||
      (['project.transfer.capture','project.transfer.capture-study'].includes(task?.action)?task.workspace:null);
    return '<details class="pt-settings"><summary>Parameter studies · '+studies.length.toLocaleString()+' saved '+(studies.length===1?'study':'studies')+'</summary>'+
      '<p>Original model cases, quantitative results, difference maps and complete result archives travel with the editable workspace.</p>'+
      (studies.length?'<div class="pt-table"><table><thead><tr><th>Study</th><th>Native cases</th><th>Retained results</th><th>Open</th></tr></thead><tbody>'+
      studies.map(row=>{
        const progress=row.progress||{},artifacts=row.artifacts||{};
        const available=Object.values(artifacts).filter(item=>item.receiving_state==='matched');
        const maps=available.filter(item=>/\.tiff?$/i.test(item.path||'')).length;
        const refresh=Object.keys(artifacts).length-available.length;
        const action=task?.state==='complete'&&destination&&identity.test(row.id||'')?
          button('open-parameter-study','Open saved study','data-id="'+esc(task.id)+'" data-study-id="'+esc(row.id)+'"'):'';
        return '<tr><td><strong>'+esc(row.title||row.id)+'</strong><p>'+esc(row.purpose||'')+'</p><small>'+esc(row.design)+' · '+esc(arr(row.models).join(' + '))+'</small></td>'+
          '<td>'+esc(progress.completed||0)+' / '+esc(progress.total||arr(row.cases).length)+' complete'+
          (progress.failed?'<br>'+esc(progress.failed)+' require recovery':'')+'</td><td>'+
          countLabel(available.length,'matched result file')+(maps?' · '+countLabel(maps,'GIS map'):'')+
          (artifacts.archive?.receiving_state==='matched'?'<br>Complete result ZIP retained':'')+
          (refresh?'<br>'+countLabel(refresh,'export')+' require refresh from retained native cases':'')+'</td><td>'+action+(!destination?'Available after editable restoration':'')+'</td></tr>';
      }).join('')+'</tbody></table></div>':'<p class="pt-empty">This edition contains no saved parameter studies.</p>')+'</details>';
  }

  function taskView(item) {
    const result = item.result || {}, progress = item._transfer_progress;
    let outcome = '';
    if (result.snapshot_id) outcome += '<p>Transfer <span class="pt-id-inline" title="'+esc(result.snapshot_id)+'">'+short(result.snapshot_id)+'</span>'+
      ' '+button('open-snapshot','Open transfer','data-id="'+esc(result.snapshot_id)+'"')+'</p>';
    if (result.received_bytes != null) outcome += '<p>Received '+bytes(result.received_bytes)+'; reused '+bytes(result.reused_bytes)+'.</p>';
    if (result.parts != null) outcome += '<p>'+result.parts+' parts; '+bytes(result.payload_bytes)+' raw payload.</p>';
    if (Array.isArray(result.changed)) outcome += '<dl class="pt-diff"><div><dt>Added</dt><dd>'+result.added.length+'</dd></div><div><dt>Changed</dt><dd>'+
      result.changed.length+'</dd></div><div><dt>Unchanged</dt><dd>'+result.unchanged.length+'</dd></div><div><dt>Removed</dt><dd>'+result.removed.length+
      '</dd></div></dl><p>Reusable blocks: '+bytes(result.reusable_bytes)+'. New blocks: '+bytes(result.new_unique_bytes)+'.</p>'+
      '<details><summary>View changed member names</summary><pre>'+esc(JSON.stringify({added:result.added,changed:result.changed,removed:result.removed},null,2))+'</pre></details>';
    if (result.workspace_key) outcome += '<div class="pt-notice"><strong>Editable workspace restored.</strong>'+
      button('open-restored','Open restored workspace','data-id="'+esc(result.workspace_key)+'"','',true)+'</div>';
    return '<article class="pt-task"><div class="pt-task-head"><strong>'+esc(names[item.action] || item.action)+'</strong><span>'+esc(item.state)+'</span></div>'+
      '<small>'+date(item.created_at)+' · '+short(item.id)+'</small>'+
      (!terminal(item.state)?'<p role="status">'+esc(progressText(progress) || item.state)+'</p>':'')+
      (item.error?'<div class="pt-error"><strong>'+esc(item.error.code || 'Task error')+'</strong><p>'+esc(item.error.message || item.error)+'</p></div>':'')+
      outcome+acquisitionsView(result.source_acquisitions,item)+implementationView(result.implementation,item)+parameterStudiesView(result.parameter_studies,item)+downloads(item._downloads)+'<div class="pt-actions">'+button('task','Task details','data-id="'+item.id+'"')+
      (['failed','interrupted'].includes(item.state)?button('resume','Resume original task','data-id="'+item.id+'"',busy):'')+'</div></article>';
  }
  function render() {
    if (!node) return;
    if (!workspace) { node.innerHTML = '<div class="pt-desk"><h1>Transfer and restore</h1><p class="pt-empty">Open or create a workspace using the original workspace selector, then receive or prepare a transfer here.</p></div>'; return; }
    const focused = node.contains(node.ownerDocument.activeElement) ? node.ownerDocument.activeElement : null;
    const focusKey = focused ? {field:focused.dataset.ptField,action:focused.dataset.ptAction,id:focused.dataset.id,value:focused.value} : null;
    const items = tasks();
    node.innerHTML = '<div class="pt-desk"><header class="pt-heading"><div><p class="pt-kicker">Scientific project handover</p><h1>Transfer and restore</h1>'+
      '<p>Move the complete retained study, resume missing data, and continue from an editable restored copy.</p></div>'+
      button('refresh',loading?'Refreshing…':'Refresh','',busy||loading)+'</header>'+notice()+
      '<nav class="pt-tabs" aria-label="Transfer workflow">'+['prepare','receive','inspect'].map(value=>'<button type="button" data-pt-action="tab" data-value="'+value+'"'+
      (value===tab?' aria-current="page"':'')+'>'+({prepare:'Prepare and send',receive:'Receive',inspect:'Inspect and restore'}[value])+'</button>').join('')+'</nav>'+
      (tab==='prepare'?prepareView():tab==='receive'?receivingView():inspectView())+
      '<section class="pt-card"><div class="pt-section-heading"><h2>Original transfer tasks</h2><span>'+items.length.toLocaleString()+' retained</span></div>'+
      (items.length?items.slice(0,historyLimit).map(taskView).join(''):'<p class="pt-empty">Transfer operations appear here with their progress, downloads and original task identity.</p>')+
      (items.length>historyLimit?button('older-tasks','Show older tasks'):'')+'</section></div>';
    if (focusKey && (focusKey.field || focusKey.action)) {
      const next = [...node.querySelectorAll('[data-pt-field],[data-pt-action]')].find(element =>
        element.dataset.ptField === focusKey.field && element.dataset.ptAction === focusKey.action &&
        element.dataset.id === focusKey.id && (element.type !== 'radio' || element.value === focusKey.value));
      if (next && !next.disabled) next.focus({preventScroll:true});
    }
  }
  async function submit(action,payload) {
    const expected = workspace, epoch = generation, requestKey = canonical({workspace:expected,action,payload});
    let request = pending[requestKey], prior = request?.task_id ? tasks().find(item=>item.id===request.task_id) : null;
    if (!request || (prior && prior.state === 'complete')) {
      request = {operation_id:'transfer-'+crypto.randomUUID(),created_at:new Date().toISOString()};
      pending[requestKey] = request;
    }
    persist();
    const task = await host.api('/api/actions',{method:'POST',body:{workspace:expected,action,payload,operation_id:request.operation_id}});
    if (workspace !== expected || generation !== epoch || host.getWorkspace() !== expected) {
      throw new Error('The workspace changed. Reopen the original workspace to continue its transfer.');
    }
    request.task_id = task.id; localTasks.set(task.id,task); persist();
    message = 'The original '+(names[action] || 'transfer')+' task is '+task.state+'.';
    return task;
  }
  async function upload(file) {
    if (!file) throw new Error('Choose the original file.');
    const maximum = Number(state?.limits?.upload_bytes);
    if (Number.isFinite(maximum) && file.size > maximum) throw new Error(file.name+' exceeds this operator’s '+bytes(maximum)+' upload limit. Prepare smaller transfer parts on the sender.');
    message = 'Retaining '+file.name+' ('+bytes(file.size)+')…'; render();
    return host.api('/api/upload',{method:'POST',raw:file,filename:file.name});
  }
  async function refreshAll() {
    const expected = workspace, epoch = generation;
    await (host.refreshState || host.refresh)({force:true});
    if (workspace !== expected || generation !== epoch || host.getWorkspace() !== expected) return;
    state = host.getState(); update(state); await refreshTaskDetails(); await loadCatalog(); await loadDetail();
  }
  async function run(work) {
    if (busy) return;
    busy = true; error = ''; render();
    const expected = workspace, epoch = generation;
    const guard = () => { if (workspace !== expected || generation !== epoch || host.getWorkspace() !== expected) throw new Error('The workspace changed. Reopen the original workspace to continue its transfer.'); };
    try { guard(); await work(guard); }
    catch (problem) { if (workspace===expected && generation===epoch) error = problem.message; }
    finally { if (workspace===expected && generation===epoch) { busy = false; persist(); render(); schedule(); } }
  }
  async function action(target) {
    const name = target.dataset.ptAction, id = target.dataset.id;
    if (name==='tab') {tab=target.dataset.value;persist();render();if(tab!=='prepare')await loadDetail();return;}
    if (name==='task'||name==='source-task') {await host.showTask(id);return;}
    if (name==='study-desk') {await host.navigate('study-transfer');return;}
    if (name==='open-restored') {await host.selectWorkspace(id);await host.navigate('study-transfer');return;}
    if (name==='open-acquisition') {
      const task = tasks().find(item => item.id === id && item.state === 'complete');
      const row = arr(task?.result?.source_acquisitions?.operations)
        .find(item => item.id === target.dataset.operationId);
      const destination = task?.result?.workspace_key ||
        (['project.transfer.capture','project.transfer.capture-study'].includes(task?.action) ? task.workspace : null);
      if (!row?.selection_retained || !identity.test(row.resume_operation_id || '') || !destination)
        throw new Error('Choose a retained acquisition from a completed capture or editable restoration.');
      if (typeof host.openDesk !== 'function') throw new Error('Reopen the current operator to use its registered scientific desks.');
      if (host.getWorkspace() !== destination) await host.selectWorkspace(destination);
      if (host.getWorkspace() !== destination) throw new Error('The workspace changed while opening the retained acquisition.');
      await host.openDesk('conservation','dispatch',{dataset:{
        action:'conservation-open-source-capture',operationId:row.resume_operation_id
      }});
      return;
    }
    if (name==='open-fieldwork') {
      const task = tasks().find(item => item.id === id && item.state === 'complete');
      const plan = arr(task?.result?.implementation?.plans).find(item => item.id === target.dataset.planId);
      const destination = task?.result?.workspace_key ||
        (['project.transfer.capture','project.transfer.capture-study'].includes(task?.action) ? task.workspace : null);
      if (!plan || !Number.isSafeInteger(plan.revision) || plan.revision < 1 || !destination)
        throw new Error('Choose a saved fieldwork revision from a completed capture or editable restoration.');
      if (typeof host.openDesk !== 'function') throw new Error('Reopen the current operator to use its registered scientific desks.');
      if (host.getWorkspace() !== destination) await host.selectWorkspace(destination);
      if (host.getWorkspace() !== destination) throw new Error('The workspace changed while opening the saved fieldwork plan.');
      await host.openDesk('implementation','openSavedPlan',{
        workspace_key:destination,plan_id:plan.id,revision:plan.revision
      });
      return;
    }

    if(name==='open-parameter-study') {
      const task=tasks().find(item=>item.id===id&&item.state==='complete');
      const study=arr(task?.result?.parameter_studies?.studies).find(item=>item.id===target.dataset.studyId);
      const destination=task?.result?.workspace_key||
        (['project.transfer.capture','project.transfer.capture-study'].includes(task?.action)?task.workspace:null);
      if(!study||!identity.test(study.id||'')||!destination)
        throw new Error('Choose a saved parameter study from a completed capture or editable restoration.');
      if(typeof host.openParameterStudy!=='function')
        throw new Error('Open the current application to continue this saved parameter study.');
      if(host.getWorkspace()!==destination)await host.selectWorkspace(destination);
      if(host.getWorkspace()!==destination)throw new Error('The workspace changed while opening the retained study.');
      await host.openParameterStudy({workspace_key:destination,experiment_id:study.id});
      return;
    }

    if (name==='older-tasks') {historyLimit+=20;render();await refreshTaskDetails();return;}
    if (name==='clear-request') {requestUpload=null;fileInputs.request=null;persist();render();return;}
    if (name==='open-snapshot') {selectedSnapshot=id;detail=null;fileOffset=0;tab='inspect';persist();render();await loadDetail(0);return;}
    await run(async guard=>{
      guard();
      if (name==='refresh') {await refreshAll();return;}
      if (name==='more-exports') {await loadCatalog(true);return;}
      if (name==='check') {await loadDetail();return;}
      if (name==='previous-files'||name==='next-files') {await loadDetail(name==='previous-files'?Math.max(0,fileOffset-200):detail.next_offset);return;}
      if (name==='resume') {await host.api('/api/task/resume',{method:'POST',body:{id}});await refreshAll();return;}
      if (name==='capture') {
        const amount = Math.round(Number(chunkMiB)*1024**2);
        if (!Number.isSafeInteger(amount)||amount<65536||amount>64*1024**2) throw new Error('Choose a block size from 0.0625 to 64 MiB.');
        if (mode==='study') {
          const source=selectedStudy();if(!source)throw new Error('Choose a completed study export.');
          await submit('project.transfer.capture-study',{source_task_id:source.task_id,study_id:source.study_id,chunk_bytes:amount});
        } else await submit('project.transfer.capture',{include_intermediates:includeIntermediates,include_deliveries:includeDeliveries,chunk_bytes:amount});
      } else if (name==='accept') {
        const uploaded=await upload(fileInputs.manifest);guard();await submit('project.transfer.accept',{upload_id:uploaded.id});fileInputs.manifest=null;
      } else if (name==='receive') {
        const files=[...(fileInputs.parts||[])];if(!files.length)throw new Error('Choose the original transfer part files.');
        for (const file of files) {guard();const uploaded=await upload(file);guard();await submit('project.transfer.receive',{upload_id:uploaded.id});}
        fileInputs.parts=null;
      } else if (name==='parts') {
        const amount=Math.round(Number(payloadMiB)*1024**2);if(!Number.isSafeInteger(amount)||amount<65536)throw new Error('Choose a positive part payload of at least 0.0625 MiB.');
        if(fileInputs.request){const uploadedRequest=await upload(fileInputs.request);guard();requestUpload=uploadedRequest;fileInputs.request=null;persist();}
        await submit('project.transfer.parts',{snapshot_id:selectedSnapshot,payload_bytes:amount,...(requestUpload?{request_upload_id:requestUpload.id}:{})});
      } else if (name==='diff') await submit('project.transfer.diff',{before_id:beforeSnapshot,after_id:selectedSnapshot});
      else if(['inspect','archive','restore','report'].includes(name)) await submit('project.transfer.'+name,{snapshot_id:selectedSnapshot});
      guard();await refreshAll();
    });
  }
  const onClick = event => {
    const target=event.target.closest('[data-pt-action]');if(!target||!node?.contains(target))return;
    event.preventDefault();event.stopPropagation();
    Promise.resolve(action(target)).catch(problem=>{error=problem.message;render();});
  };
  const onChange = event => {
    const target=event.target;
    if(target.dataset.ptFile){fileInputs[target.dataset.ptFile]=target.multiple?[...target.files]:target.files?.[0]||null;render();return;}
    const field=target.dataset.ptField;if(!field)return;
    const value=target.type==='checkbox'?target.checked:target.value;
    if(field==='mode')mode=value;
    else if(field==='selectedExport')selectedExport=value;
    else if(field==='chunkMiB')chunkMiB=Number(value);
    else if(field==='payloadMiB')payloadMiB=Number(value);
    else if(field==='includeIntermediates')includeIntermediates=value;
    else if(field==='includeDeliveries')includeDeliveries=value;
    else if(field==='beforeSnapshot')beforeSnapshot=value;
    else if(field==='selectedSnapshot'){selectedSnapshot=value;detail=null;fileOffset=0;}
    persist();render();if(field==='selectedSnapshot')loadDetail(0);
  };
  const onInput = event => {
    if (event.target.dataset.ptField === 'chunkMiB') chunkMiB=event.target.value;
    else if (event.target.dataset.ptField === 'payloadMiB') payloadMiB=event.target.value;
    else return;
    persist();
  };
  function schedule() {
    clearTimeout(timer);timer=null;
    if(!node||busy||!tasks().some(item=>!terminal(item.state)))return;
    const expected=workspace,epoch=generation;
    timer=setTimeout(async()=>{
      if(!node||workspace!==expected||generation!==epoch)return;
      try{await (host.refreshState||host.refresh)({force:true});if(workspace===expected){state=host.getState();await refreshTaskDetails();update(state);}}
      catch(problem){if(workspace===expected){error=problem.message;render();}}
      finally{schedule();}
    },3000);
  }
  function update(next=host.getState()) {
    const current=next?.workspace_key??host.getWorkspace();
    if(current!==workspace){activate(current);state=next;if(node){loadCatalog().then(()=>loadDetail());render();}return;}
    state=next;
    const currentTasks=tasks();
    const fingerprint=currentTasks.map(item=>[item.id,item.state,item.ended_at,item._transfer_progress?.updated_at].join(':')).join('|');
    if(fingerprint===taskFingerprint){schedule();return;}
    taskFingerprint=fingerprint;
    let completed=false, chosen=false;
    for(const item of currentTasks)if(item.state==='complete'&&!seenComplete.has(item.id)){
      seenComplete.add(item.id);completed=true;
      const owned = localTasks.has(item.id) || Object.values(pending).some(record=>record.task_id===item.id);
      if(!chosen&&owned&&item.result?.snapshot_id){selectedSnapshot=item.result.snapshot_id;fileOffset=0;detail=null;chosen=true;}
    }
    persist();render();
    if(completed&&node)loadCatalog().then(()=>loadDetail(0));
    schedule();
  }
  function mount(container,next=host.getState()) {
    if(node&&node!==container){node.removeEventListener('click',onClick);node.removeEventListener('change',onChange);node.removeEventListener('input',onInput);}
    node=container;state=next;activate(next?.workspace_key??host.getWorkspace());
    node.removeEventListener('click',onClick);node.removeEventListener('change',onChange);node.removeEventListener('input',onInput);
    node.addEventListener('click',onClick);node.addEventListener('change',onChange);node.addEventListener('input',onInput);
    render();loadCatalog().then(()=>refreshTaskDetails()).then(()=>loadDetail());schedule();
  }
  function detach() {
    persist();clearTimeout(timer);timer=null;
    if(node){node.removeEventListener('click',onClick);node.removeEventListener('change',onChange);node.removeEventListener('input',onInput);}
    node=null;fileInputs={};generation++;catalogPromise=null;detailPromise=null;taskDetailsPromise=null;loading=false;detailBusy=false;busy=false;
  }
  async function openForStudy(selection) {
    const current=host.getWorkspace();
    if(!selection||selection.workspace_key!==current||!identity.test(selection.task_id||'')||!identity.test(selection.study_id||''))throw new Error('Open a completed study export from the current workspace.');
    activate(current);state=host.getState();incomingStudy={workspace_key:current,task_id:selection.task_id,study_id:selection.study_id,title:selection.title,archive:selection.archive};
    selectedExport=selection.task_id;mode='study';tab='prepare';persist();
    await host.navigate('project-transfer');await loadCatalog();render();
    return {workspace_key:current,source_task_id:selection.task_id,study_id:selection.study_id};
  }
  async function openSnapshot(snapshot_id) {
    if(!identity.test(snapshot_id||''))throw new Error('Choose a retained transfer identifier.');
    activate(host.getWorkspace());state=host.getState();selectedSnapshot=snapshot_id;fileOffset=0;detail=null;tab='inspect';persist();
    await host.navigate('project-transfer');await loadCatalog();await loadDetail(0);
  }
  activate(state?.workspace_key??host.getWorkspace());
  return {mount,update,detach,openForStudy,openSnapshot};
}
