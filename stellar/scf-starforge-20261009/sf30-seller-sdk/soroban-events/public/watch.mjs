const $ = (id) => document.getElementById(id);
const formatState = (value) => String(value ?? '').replaceAll('_', ' ').toLowerCase();
const json = (value) => JSON.stringify(value, null, 2);
function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}
function option(value, label) { const result = node('option', label); result.value = value; return result; }
function absolute(value, label, optional = false) {
  const path = value.trim();
  if (!path && optional) return null;
  if (!path.startsWith('/') || path.includes('\0')) throw new Error(label + ' must be an absolute folder on this operator host.');
  return path;
}
function number(id, optional = false) {
  const value = $(id).value.trim();
  if (!value && optional) return null;
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('Enter a whole number for ' + $(id).closest('label').firstChild.textContent.trim() + '.');
  return result;
}

export function createSorobanWatchView({ request, notice, getWorkspace, refreshWorkspace, openCapture, downloadArchive, saveFolder }) {
  let controls = null, selectedId = null, editingId = null, selectedExport = null, loadedKey = null;
  let pending = {}, fetching = null, transferActive = false;
  const executing = new Set();
  const run = (work) => Promise.resolve().then(work).catch((error) => notice(error.message, true));
  const key = () => controls ? 'soroban-event-watch-requests:' + controls.workspaceId : null;
  const selected = () => controls?.watches.find((entry) => entry.id === selectedId) ?? null;
  const unresolved = (action, watchId = null) => Object.values(pending).some((entry) =>
    entry.action === action && (entry.body.watchId ?? null) === watchId);
  function persist() { if (key()) sessionStorage.setItem(key(), JSON.stringify(pending)); }
  function button(label, work, disabled = false) {
    const result = node('button', label); result.type = 'button'; result.disabled = disabled;
    result.addEventListener('click', () => run(work)); return result;
  }
  function connectionOptions(select, optional, selectedValue) {
    select.replaceChildren();
    if (optional) select.append(option('', 'None'));
    for (const entry of controls?.connections ?? []) select.append(option(entry.alias, entry.alias + ' · ' + entry.network + ' · ' + entry.rpcOrigin));
    if (!select.options.length) select.append(option('', 'No connection configured'));
    if (selectedValue !== undefined && [...select.options].some((entry) => entry.value === selectedValue)) select.value = selectedValue;
    else if (!optional && [...select.options].some((entry) => entry.value === 'default')) select.value = 'default';
  }
  function refreshConnectionChoices() {
    for (const [id, optional] of [['watch-connection',false],['watch-recovery-connection',true],
      ['watch-archive-connection',false],['watch-receive-connection',false],['watch-receive-recovery',true]])
      connectionOptions($(id), optional, $(id).value);
  }
  function planVersions(value = undefined) {
    const plan = getWorkspace()?.plans.find((entry) => entry.id === $('watch-plan').value);
    const select = $('watch-plan-version'); select.replaceChildren();
    for (const version of plan?.versions ?? []) select.append(option(String(version.version), 'Version ' + version.version + ' · ' + version.name));
    if (value !== undefined && [...select.options].some((entry) => entry.value === String(value))) select.value = String(value);
    else if (plan) select.value = String(plan.currentVersion);
  }
  function refreshPlanChoices() {
    const plan = $('watch-plan').value, version = $('watch-plan-version').value;
    $('watch-plan').replaceChildren();
    for (const entry of getWorkspace()?.plans ?? []) $('watch-plan').append(option(entry.id, entry.name));
    if ([...$('watch-plan').options].some((entry) => entry.value === plan)) $('watch-plan').value = plan;
    planVersions(version || undefined);
  }
  function fillForm(watch = null) {
    editingId = watch?.id ?? null;
    $('watch-form-title').textContent = watch ? 'Service settings' : 'Create service';
    $('watch-name').value = watch?.name ?? '';
    refreshPlanChoices();
    if (watch) { $('watch-plan').value = watch.planId; planVersions(watch.planVersion); }
    $('watch-plan').disabled = Boolean(watch);
    $('watch-start-ledger').disabled = Boolean(watch);
    $('watch-start-ledger').value = watch ? (watch.initialLedger ?? watch.windows?.[0]?.startLedger ?? watch.active?.startLedger ?? watch.nextLedger ?? '') : '';
    $('watch-end-ledger').value = watch?.endLedger ?? '';
    $('watch-window-ledgers').value = watch?.config.windowLedgers ?? 1000;
    $('watch-poll-seconds').value = (watch?.config.pollIntervalMs ?? 15000) / 1000;
    connectionOptions($('watch-connection'), false, watch?.config.connectionAlias ?? 'default');
    connectionOptions($('watch-recovery-connection'), true, watch?.config.recoveryConnectionAlias ?? '');
    $('watch-publication-directory').value = watch?.config.publication?.directory ?? '';
    $('watch-save').textContent = watch ? 'Save settings for following ranges' : 'Save service';
    updateButtons();
  }
  function open(watchId) {
    if (selectedExport && selectedExport.watchId !== watchId) selectedExport = null;
    selectedId = watchId; const watch = selected();
    fillForm(watch); render();
  }
  function updateButtons() {
    const watch = selected();
    $('watch-save').disabled = !controls || unresolved(editingId ? 'configure' : 'save', editingId);
    $('watch-start').disabled = !watch || unresolved('start', watch.id) || watch.status === 'COMPLETE';
    $('watch-start').textContent = watch?.desiredState === 'RUNNING' ? 'Continue service' : 'Start service';
    $('watch-pause').disabled = !watch || unresolved('pause', watch.id) ||
      (watch.desiredState === 'PAUSED' && !watch.active);
    $('watch-download').disabled = !selectedExport || transferActive;
    $('watch-save-folder').disabled = !selectedExport || transferActive || typeof window.showDirectoryPicker !== 'function';
  }
  function pendingView() {
    const items = Object.values(pending); $('watch-pending').hidden = !items.length;
    const container = $('watch-pending-list'); container.replaceChildren();
    for (const entry of items) {
      const row = node('div', undefined, 'item');
      row.append(node('span', entry.action + ' · ' + entry.body.requestId, 'item-title'),
        node('span', entry.body.watchId ?? 'New service or receiving operation', 'item-meta'),
        button(executing.has(entry.body.requestId) ? 'Running original request' : 'Recover original request',
          () => execute(entry.body.requestId), executing.has(entry.body.requestId)));
      container.append(row);
    }
  }
  function facts(watch) {
    const last = watch.windows?.at(-1), rows = [
      ['Desired operation', formatState(watch.desiredState)],
      ['Next ledger', watch.nextLedger === null ? 'Awaiting the first native network observation' : String(watch.nextLedger)],
      ['End ledger, exclusive', watch.endLedger === null ? 'Following the network' : String(watch.endLedger)],
      ['Saved event plan', watch.planId + ' · version ' + watch.planVersion],
      ['Complete ranges', String(watch.windows?.length ?? 0)],
      ['Latest complete range', last ? last.startLedger + ' to ' + last.endLedger + ' exclusive' : 'Awaiting first complete range'],
      ['Active step', watch.active ? formatState(watch.active.phase) : 'Ready for the next operation'],
      ['Publication folder', watch.config.publication?.directory ?? 'Source editions only'],
      ['Logical source', watch.sourceWorkspaceId + ' · ' + watch.network],
      ['Updated', watch.updatedAt],
    ];
    const container = $('watch-progress'); container.replaceChildren();
    for (const [label, value] of rows) container.append(node('dt', label), node('dd', value));
  }
  function history(watch) {
    const container = $('watch-history'); container.replaceChildren();
    const rows = [...(watch.windows ?? [])].reverse();
    if (!rows.length && !watch.active) return;
    const table = node('table'), head = node('thead'), labels = node('tr'), body = node('tbody');
    for (const label of ['Ledger range, exclusive end', 'Original capture', 'Source edition', 'Events']) labels.append(node('th',label));
    head.append(labels); table.append(head,body);
    for (const window of rows) {
      const row = node('tr'), capture = node('td');
      capture.append(button('Open capture', () => openCapture(window.captureId)));
      const edition = getWorkspace()?.editions.find((entry) => entry.id === window.editionId);
      row.append(node('td',window.startLedger + ' → ' + window.endLedger),capture,node('td',window.editionId),
        node('td',edition?.eventCount ?? window.eventCount ?? 'See edition'));
      body.append(row);
    }
    if (watch.active?.captureId) {
      const row = node('tr'), capture = node('td'); capture.append(button('Inspect active capture', () => openCapture(watch.active.captureId)));
      row.append(node('td',formatState(watch.active.phase)),capture,node('td',watch.active.editionId ?? 'In progress'),node('td','In progress'));
      body.prepend(row);
    }
    container.append(table);
  }
  function repairChoices(watch) {
    const select = $('watch-repair-editions'), before = new Set([...select.selectedOptions].map((entry) => entry.value));
    select.replaceChildren();
    const editions = getWorkspace()?.editions.filter((entry) => entry.network === watch.network && entry.planId === watch.planId) ?? [];
    for (const edition of editions) {
      const item = option(edition.id, edition.startLedger + ' → ' + edition.endLedger + ' · ' + edition.name + ' · ' + edition.id);
      item.selected = before.has(edition.id); select.append(item);
    }
    connectionOptions($('watch-archive-connection'), false, watch.config.recoveryConnectionAlias ?? $('watch-archive-connection').value);
  }
  function renderExport() {
    $('watch-export').hidden = !selectedExport;
    if (!selectedExport) return;
    $('watch-export-location').textContent = selectedExport.directory;
    $('watch-export-identity').textContent = 'Manifest SHA-256: ' + selectedExport.manifestSha256;
    const container = $('watch-export-files'); container.replaceChildren();
    const table = node('table'), head = node('thead'), row = node('tr'), body = node('tbody');
    for (const title of ['Original file','Bytes']) row.append(node('th',title));
    head.append(row);
    for (const file of [{path:'manifest.json',bytes:null}, ...selectedExport.manifest.files]) {
      const item = node('tr'); item.append(node('td',file.path),node('td',file.bytes === null ? 'Manifest' : file.bytes.toLocaleString())); body.append(item);
    }
    table.append(head,body);container.append(table);
    updateButtons();
  }
  function render() {
    const list = $('watch-list'); list.replaceChildren();
    for (const watch of controls?.watches ?? []) {
      const row = node('div', undefined, 'item'); row.dataset.selected = String(watch.id === selectedId);
      row.append(node('span',watch.name,'item-title'),
        node('span',formatState(watch.status) + ' · ' + (watch.windows?.length ?? 0) + ' complete range(s) · next ledger ' + (watch.nextLedger ?? 'awaiting network'),'item-meta'),
        button('Open service',() => open(watch.id)));
      list.append(row);
    }
    if (!controls?.watches.length) list.append(node('p','Save an event plan, then create a recurring service.','muted'));
    const runner = controls?.runner;
    $('watch-runner-state').textContent = runner ? 'Operator runner: ' + formatState(runner.status) +
      (runner.lastError ? ' · ' + runner.lastError.message : '') : '';
    const watch = selected();
    $('watch-detail').hidden = !watch; $('watch-recovery').hidden = !watch; $('watch-transfer').hidden = !watch;
    if (watch) {
      $('watch-title').textContent = watch.name; $('watch-status').textContent = formatState(watch.status);
      facts(watch);history(watch);repairChoices(watch);$('watch-json').textContent=json(watch);
      $('watch-error').hidden = !watch.lastError;
      $('watch-error').textContent = watch.lastError ? (watch.lastError.message ?? json(watch.lastError)) : '';
    }
    pendingView();renderExport();updateButtons();
  }
  async function refresh() {
    if (!getWorkspace()) return;
    if (fetching) return fetching;
    const task = (async () => {
      const next = await request('/api/watches');
      if (controls && controls.workspaceId === next.workspaceId && next.revision < controls.revision) return;
      controls = next;
      if (loadedKey !== key()) {
        pending = {};
        try {
          const saved = JSON.parse(sessionStorage.getItem(key()) ?? '{}');
          if (saved && typeof saved === 'object' && !Array.isArray(saved))
            pending = Object.fromEntries(Object.entries(saved).filter(([id,entry]) =>
              entry && typeof entry === 'object' && ['save','configure','start','pause','repair','export','receive'].includes(entry.action) &&
              entry.body && typeof entry.body === 'object' && entry.body.requestId === id && Number.isSafeInteger(entry.body.expectedRevision)));
        } catch { sessionStorage.removeItem(key()); }
        loadedKey = key();
      }
      refreshPlanChoices();refreshConnectionChoices();render();
    })();
    fetching=task;
    try { return await task; } finally { if(fetching === task)fetching=null; }
  }
  async function execute(requestId) {
    if (executing.has(requestId) || !pending[requestId]) return;
    const operation = structuredClone(pending[requestId]);
    executing.add(requestId);render();
    try {
      const result = await request('/api/watch/' + operation.action, operation.body);
      delete pending[requestId];persist();
      if (result.export) selectedExport = result.export;
      if (result.watch && (!controls || result.revision >= controls.revision)) {
        controls.revision = result.revision;
        controls.watches = [...controls.watches.filter((entry)=>entry.id!==result.watch.id),result.watch];
      }
      await refreshWorkspace().catch(() => {});
      if (result.watch && ['save','configure','receive'].includes(operation.action)) open(result.watch.id);
      render();
      notice(operation.action === 'export' ? 'Complete private service bundle is ready.' :
        operation.action === 'receive' ? 'Service received and opened at its retained continuation position.' :
        operation.action === 'pause' ? 'Pause saved. The active native range will finish before the service pauses.' :
        operation.action === 'start' ? 'Service started from its saved next ledger.' :
        operation.action === 'repair' ? 'Recovery selection saved for the original source range.' : 'Service settings saved.');
      return result;
    } catch (error) {
      if (error.definitive) { delete pending[requestId];persist();await refresh().catch(()=>{}); }
      else error.message += '\nThe original service request is saved below for recovery.';
      throw error;
    } finally { executing.delete(requestId);render(); }
  }
  async function change(action, body) {
    if (!controls) await refresh();
    if (!controls) throw new Error('Open the event workspace first.');
    if (unresolved(action, body.watchId ?? null)) throw new Error('Recover the saved ' + action + ' request before repeating it.');
    const requestId=crypto.randomUUID();
    pending[requestId]={action,body:{...structuredClone(body),requestId,expectedRevision:controls.revision}};
    persist();return execute(requestId);
  }
  function readForm() {
    const current=controls?.watches.find((entry)=>entry.id===editingId);
    const directory=absolute($('watch-publication-directory').value,'Publication folder',true);
    const body={name:$('watch-name').value.trim(),planVersion:number('watch-plan-version'),
      endLedger:number('watch-end-ledger',true),windowLedgers:number('watch-window-ledgers'),
      pollIntervalMs:number('watch-poll-seconds')*1000,
      ...( $('watch-connection').value ? {connectionAlias:$('watch-connection').value} : {}),
      recoveryConnectionAlias:$('watch-recovery-connection').value || null,
      publication:directory ? {...current?.config.publication,directory} : null};
    if(editingId) body.watchId=editingId;
    else {body.planId=$('watch-plan').value;body.startLedger=number('watch-start-ledger',true);}
    return body;
  }
  const bind=(id,work)=>$(id).addEventListener('submit',(event)=>{event.preventDefault();run(work);});
  $('watch-new').addEventListener('click',()=>{selectedId=null;selectedExport=null;fillForm();render();});
  $('watch-cancel-edit').addEventListener('click',()=>fillForm(selected()));
  $('watch-plan').addEventListener('change',()=>planVersions());
  $('watch-inspect').addEventListener('click',()=>run(()=>refreshWorkspace()));
  $('watch-start').addEventListener('click',()=>run(()=>change('start',{watchId:selectedId})));
  $('watch-pause').addEventListener('click',()=>run(()=>change('pause',{watchId:selectedId})));
  bind('watch-form',()=>change(editingId?'configure':'save',readForm()));
  bind('watch-repair-form',()=>{
    const editionIds=[...$('watch-repair-editions').selectedOptions].map((entry)=>entry.value);
    if(!editionIds.length)throw new Error('Select the complete source editions that cover the required range.');
    return change('repair',{watchId:selectedId,editionIds});
  });
  bind('watch-connection-form',()=>{
    const recoveryConnectionAlias=$('watch-archive-connection').value;
    if(!recoveryConnectionAlias)throw new Error('Configure a named archive connection on this operator host first.');
    return change('repair',{watchId:selectedId,recoveryConnectionAlias});
  });
  bind('watch-export-form',()=>change('export',{watchId:selectedId}));
  bind('watch-receive-form',()=>{
    const sourceDirectory=absolute($('watch-receive-directory').value,'Complete service folder');
    const publicationDirectory=absolute($('watch-receive-publication').value,'Publication folder',true);
    const expectedManifestSha256=$('watch-receive-sha256').value.trim();
    return change('receive',{sourceDirectory,...(expectedManifestSha256?{expectedManifestSha256}:{}),
      ...(publicationDirectory?{publicationDirectory}:{}),
      ...($('watch-receive-connection').value?{connectionAlias:$('watch-receive-connection').value}:{}),
      ...($('watch-receive-recovery').value?{recoveryConnectionAlias:$('watch-receive-recovery').value}:{})});
  });
  const transferOptions={progressId:'watch-download-progress',filenamePrefix:'soroban-service',
    setTransferring(value){transferActive=value;updateButtons();}};
  $('watch-download').addEventListener('click',()=>run(()=>downloadArchive(selectedExport,transferOptions)));
  $('watch-save-folder').addEventListener('click',()=>run(()=>saveFolder(selectedExport,transferOptions)));
  fillForm();
  return {refresh,open};
}
