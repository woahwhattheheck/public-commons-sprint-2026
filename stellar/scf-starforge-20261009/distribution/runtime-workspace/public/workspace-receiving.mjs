// MIT. Full workspace backup, archive intake and reviewed receiving on this host.
const node = (tag, text, className) => {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
};
const bytesText = value => Number.isSafeInteger(value) ? value.toLocaleString() + ' bytes' : '—';
const dateText = value => value ? new Date(value).toLocaleString() : '—';
const query = (path, values) => path + '?' + new URLSearchParams(
  Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ''));
const shellQuote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
function button(label, action, disabled = false) {
  const value = node('button', label); value.type = 'button'; value.disabled = disabled;
  value.addEventListener('click', action); return value;
}
function facts(target, rows) {
  const list = node('dl', undefined, 'paths');
  for (const [key, value] of rows) {
    const row = node('div'); row.append(node('dt', key), node('dd', value ?? '—')); list.append(row);
  }
  target.replaceChildren(list);
}
function table(headers, rows) {
  const wrap = node('div', undefined, 'table-wrap'), value = node('table');
  const head = node('thead'), heading = node('tr'), body = node('tbody');
  for (const title of headers) heading.append(node('th', title)); head.append(heading);
  for (const row of rows) {
    const tr = node('tr');
    for (const cell of row) {
      const td = node('td'); td.append(cell instanceof Node ? cell : document.createTextNode(String(cell ?? '—'))); tr.append(td);
    }
    body.append(tr);
  }
  value.append(head, body); wrap.append(value); return wrap;
}
function detail(label, value) {
  const result = node('details');
  result.append(node('summary', label), node('pre', JSON.stringify(value, null, 2)));
  return result;
}
function rows(value) { return Array.isArray(value) ? value : []; }
const count = value => Array.isArray(value) ? value.length : Number.isSafeInteger(value) ? value : '—';

export function createWorkspaceReceivingView({ root, api, getState, getToken, getView, message, error }) {
  root.innerHTML = '<div class="section-title"><div><h2>Workspace backup and receiving</h2>' +
    '<p class="muted">Keep the complete workspace records, included files and original operating history together.</p></div>' +
    '<button type="button" id="wb-refresh">Refresh</button></div>' +
    '<p class="note">Receive at the original location or select a new host directory. The complete archived records remain intact. Review current runtime locations before reopening and save current application settings through Applications.</p>' +
    '<form id="wb-storage-form" class="panel"><h3>Backup storage</h3><label>Private directory outside every Runtime workspace' +
    '<input id="wb-storage" autocomplete="off" placeholder="/absolute/private/workspace.backups"></label>' +
    '<button>Open backup storage</button><p class="note">The selected directory retains reviews, archives, uploads and receiving operations across server restarts.</p></form>' +
    '<div class="columns"><section class="panel"><h3>Back up this workspace</h3><form id="wb-review-form">' +
    '<label>Backup name<input id="wb-label" required maxlength="120" value="Workspace backup"></label>' +
    '<button>Review complete workspace</button></form><div id="wb-review" hidden></div></section>' +
    '<section class="panel"><h3>Receive a workspace archive</h3><form id="wb-intake-form">' +
    '<label>Archive file<input id="wb-file" type="file" accept=".tgz,.gz,application/gzip"></label>' +
    '<p class="note">Or use a file already on this operator machine:</p>' +
    '<label>Existing archive path<input id="wb-path" autocomplete="off" placeholder="/absolute/private/workspace-backup.tgz"></label>' +
    '<label>Original archive SHA-256<input id="wb-sha" required pattern="[a-f0-9]{64}" maxlength="64" spellcheck="false"></label>' +
    '<button>Receive and inspect complete archive</button><p id="wb-upload-progress" class="note" role="status"></p></form>' +
    '<div id="wb-upload-pending" hidden></div></section></div>' +
    '<section class="panel"><h3>Retained archive uploads</h3><div id="wb-uploads"></div></section>' +
    '<section id="wb-pending" class="panel" hidden></section>' +
    '<section class="panel"><h3>Inspected archives</h3><label>Archive<select id="wb-archive"><option value="">Choose an inspected archive</option></select></label>' +
    '<div id="wb-inspection" class="result" hidden></div></section>' +
    '<section class="panel"><div class="section-title"><h3>Backup and receiving operations</h3><span id="wb-count" class="count">0</span></div>' +
    '<p class="note">Continue a retained operation after an interruption. Completed receiving keeps the original workspace identity and all retained operation history.</p>' +
    '<div id="wb-operations"></div></section>' +
    '<section id="wb-bindings" class="panel" hidden></section>';
  const $ = id => root.querySelector('#' + id);
  let state = null, storageDirectory = null, selectedArchive = null, selectedReview = null;
  let epoch = 0, busy = null, loading = null, workspaceIdentity = null;
  let bindingReview = null, selectedReceiving = null, openedReceiving = null;
  const identity = () => getState()?.workspaceId ?? workspaceIdentity;
  const prefix = () => 'starforge-workspace-backup-' + identity();
  const context = () => ({ epoch, workspaceId: identity(), token: getToken(), storageDirectory });
  const current = value => value.epoch === epoch && value.workspaceId === identity() &&
    value.token === getToken() && value.storageDirectory === storageDirectory;
  const base = () => storageDirectory ? { storageDirectory } : {};
  function readSaved(suffix) {
    try { return JSON.parse(localStorage.getItem(prefix() + suffix) ?? 'null'); } catch { return null; }
  }
  function save(suffix, value) {
    const key = prefix() + suffix;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  }
  const pending = () => {
    const value = readSaved('-request');
    return value?.storageDirectory === storageDirectory ? value : null;
  };
  const uploadPending = () => {
    const value = readSaved('-upload');
    return value?.storageDirectory === storageDirectory ? value : null;
  };
  function setDisabled() {
    root.querySelectorAll('form button, form input, form select, form textarea').forEach(value => { value.disabled = Boolean(busy); });
    $('wb-storage').disabled = Boolean(busy);
  }
  async function action(fn) {
    if (busy) return;
    if (!state?.workspaceId) { error(new Error('Refresh backup storage before choosing an operation.')); return; }
    const scope = context(); busy = scope; setDisabled();
    try { await fn(scope); }
    catch (value) { if (current(scope)) error(value); }
    finally {
      if (busy === scope) { busy = null; render(); }
    }
  }
  async function retainedPost(path, input, scope, label) {
    const old = pending();
    if (old && (old.path !== path || JSON.stringify(old.input) !== JSON.stringify(input)))
      throw new Error('Continue the retained request shown below before starting this request.');
    const saved = old ?? { path, input, storageDirectory, label };
    save('-request', saved);
    const value = await api(path, saved.input);
    if (!current(scope)) return null;
    if (JSON.stringify(pending()) === JSON.stringify(saved)) save('-request', null);
    return value;
  }
  function scopedDraft(kind, id) {
    const value = readSaved('-' + kind + '-' + id);
    return value?.storageDirectory === storageDirectory ? value.value : null;
  }
  function retainDraft(kind, id, value) {
    save('-' + kind + '-' + id, { storageDirectory, value });
  }
  function bindingDraft(value, receivingId) {
    return scopedDraft('host-bindings', receivingId) ?? {
      runtimeHome: value.hostBindings?.runtimeHome ?? '',
      runtimes: rows(value.hostBindings?.runtimes).map(item => ({ runtimeId: item.runtimeId, directory: item.directory })),
      actor: value.hostBindings?.actor ?? '', note: value.hostBindings?.note ?? '',
    };
  }
  function canonicalBindings(value) {
    return JSON.stringify({
      runtimeHome: String(value?.runtimeHome ?? '').trim(),
      runtimes: rows(value?.runtimes).filter(item => String(item.directory ?? '').trim())
        .map(item => ({ runtimeId: item.runtimeId, directory: String(item.directory).trim() }))
        .sort((a, b) => String(a.runtimeId).localeCompare(String(b.runtimeId))),
      actor: String(value?.actor ?? '').trim(), note: String(value?.note ?? ''),
    });
  }
  function rememberBindingReview(receivingId, value) {
    selectedReceiving = receivingId; bindingReview = value;
    save('-binding-review', { storageDirectory, receivingId, value });
  }
  function bindingDraftMatches(value, receivingId) {
    return value.mode !== 'new-host' || Boolean(value.hostBindings) &&
      canonicalBindings(bindingDraft(value, receivingId)) === canonicalBindings(value.hostBindings);
  }
  function hostBindingsForm(value, receivingId) {
    const form = node('form'), draft = bindingDraft(value, receivingId);
    form.append(node('h4', 'Current host locations'),
      node('p', 'Select the private runtime home and any recovered runtime installations to use on this host. Leave an installation blank to keep it unbound; it can be attached later through the existing Runtime controls.', 'note'));
    const homeLabel = node('label', 'Private runtime home on this host'), home = node('input');
    home.id = 'wb-current-runtime-home'; home.value = draft.runtimeHome; home.required = true;
    home.autocomplete = 'off'; home.placeholder = '/absolute/private/runtimes'; homeLabel.append(home); form.append(homeLabel);
    function changed() {
      retainDraft('host-bindings', receivingId, draft);
      const accept = $('wb-record-bindings');
      if (accept) accept.disabled = Boolean(busy) || !value.canOpen || !bindingDraftMatches(value, receivingId);
      const status = $('wb-binding-draft-state');
      if (status) status.textContent = bindingDraftMatches(value, receivingId) ?
        'These locations match the saved review.' : 'Current choices are saved in this browser. Review them before recording the receiving result.';
    }
    home.addEventListener('input', () => { if (!busy) { draft.runtimeHome = home.value; changed(); } });
    const entries = rows(value.runtimeEntries);
    if (entries.length) form.append(table(['Runtime', 'Original location and source', 'Current installation', 'Review status'],
      entries.map(item => {
        const label = node('label', item.label || item.runtimeId), currentPath = node('input');
        currentPath.value = rows(draft.runtimes).find(row => row.runtimeId === item.runtimeId)?.directory ?? '';
        currentPath.autocomplete = 'off'; currentPath.placeholder = 'Leave blank to attach later';
        currentPath.setAttribute('aria-label', 'Current installation for ' + (item.label || item.runtimeId));
        label.append(currentPath);
        currentPath.addEventListener('input', () => {
          if (busy) return;
          draft.runtimes = rows(draft.runtimes).filter(row => row.runtimeId !== item.runtimeId);
          if (currentPath.value) draft.runtimes.push({ runtimeId: item.runtimeId, directory: currentPath.value });
          changed();
        });
        const original = node('div');
        original.append(node('p', item.originalDirectory ?? 'Original location unavailable'),
          detail('Original runtime source identity', { runtimeId: item.runtimeId, sourceDirectory: item.sourceDirectory, expected: item.expected }));
        const status = node('div');
        status.append(node('p', item.status ?? 'Not reviewed'),
          node('p', item.sourceVerified ? 'Source identity verified' : 'No accepted source binding', 'note'));
        if (item.error) status.append(detail('Location review message', item.error));
        if (item.comparisons) status.append(detail('Source comparisons', item.comparisons));
        return [item.label || item.runtimeId, original, label, status];
      })));
    else form.append(node('p', 'This archive has no saved runtime installations to map. Use Runtime to attach an installation after reopening.', 'empty'));
    const actorLabel = node('label', 'Reviewed by'), actor = node('input');
    actor.value = draft.actor; actor.required = true; actor.maxLength = 160; actorLabel.append(actor);
    const noteLabel = node('label', 'Location review note'), note = node('textarea');
    note.value = draft.note; note.rows = 3; note.maxLength = 4000; noteLabel.append(note);
    actor.addEventListener('input', () => { if (!busy) { draft.actor = actor.value; changed(); } });
    note.addEventListener('input', () => { if (!busy) { draft.note = note.value; changed(); } });
    const status = node('p', bindingDraftMatches(value, receivingId) ? 'These locations match the saved review.' :
      'Review current host locations to prepare this workspace for reopening.', 'note'); status.id = 'wb-binding-draft-state';
    const submit = node('button', 'Review selected locations');
    form.append(actorLabel, noteLabel, status, submit);
    form.addEventListener('submit', event => {
      event.preventDefault(); action(async scope => {
        retainDraft('host-bindings', receivingId, draft);
        const hostBindings = JSON.parse(canonicalBindings(draft));
        if (!hostBindings.runtimeHome.startsWith('/') || hostBindings.runtimes.some(item => !item.directory.startsWith('/')))
          throw new Error('Use absolute paths for the current runtime home and each selected installation.');
        if (!hostBindings.actor) throw new Error('Enter who reviewed these locations.');
        const result = await retainedPost('/api/workspace-backups/bindings',
          { ...base(), receivingId, hostBindings }, scope, 'Review current host locations');
        if (!result || !current(scope)) return;
        rememberBindingReview(receivingId, result); renderBindings();
        message(result.canOpen ? 'Current host locations reviewed. Record this exact review to reopen.' :
          'Location review saved. Resolve the listed source or directory details, then review the same choices.');
      });
    });
    return form;
  }
  function bindingsTable(bindings) {
    return table(['Binding', 'Purpose', 'Availability', 'Expected source'],
      rows(bindings).map(item => [item.path, rows(item.roles).join(', '),
        item.status ?? 'Review on receiving host', item.expected ? JSON.stringify(item.expected) : 'Original binding']));
  }
  function renderReview() {
    const target = $('wb-review'); target.hidden = !selectedReview;
    if (!selectedReview) return;
    const value = selectedReview;
    facts(target, [['Workspace', value.directory], ['Workspace identity', value.workspaceId],
      ['Review time', dateText(value.createdAt)], ['Files', count(value.files)],
      ['Directories', count(value.directories)], ['Links', count(value.links)],
      ['Included file bytes', bytesText(value.bytes)], ['Inventory SHA-256', value.inventorySha256]]);
    target.append(node('h4', 'External bindings'));
    target.append(rows(value.externalBindings).length ? bindingsTable(value.externalBindings) :
      node('p', 'No external bindings are declared in this review.', 'note'));
    if (value.externalBindingDiscovery) target.append(detail('Embedded path discovery coverage', value.externalBindingDiscovery));
    if (rows(value.excluded).length) target.append(detail('Excluded kernel coordination files', value.excluded));
    target.append(button('Create this reviewed backup', () => action(async scope => {
      const input = { ...base(), requestId: crypto.randomUUID(),
        reviewId: value.reviewId, reviewSha256: value.reviewSha256 };
      const result = await retainedPost('/api/workspace-backups/create', input, scope, 'Create reviewed backup');
      if (!result || !current(scope)) return;
      await refresh(); message('Backup operation retained. Its complete archive will appear in the operation below.');
    }), Boolean(busy)));
  }
  async function download(archiveId) {
    const value = await api('/api/workspace-backups/download', { ...base(), archiveId });
    const url = new URL(value.url, location.href);
    if (url.origin !== location.origin || !/^\/workspace-backup-download\/[a-f0-9]{64}$/.test(url.pathname) ||
        url.search || url.hash || url.username || url.password)
      throw new Error('The workspace returned an unexpected backup download address.');
    const link = node('a'); link.href = url.href; link.download = value.filename; link.rel = 'noreferrer'; link.click();
    message('Downloading ' + value.filename + ' · ' + bytesText(value.bytes) + ' · SHA-256 ' + value.sha256);
  }
  function inspection() { return rows(state?.inspections).find(item => item.archiveId === selectedArchive) ?? null; }
  function renderInspection() {
    const select = $('wb-archive'), values = rows(state?.inspections);
    const signature = JSON.stringify(values.map(item => [item.archiveId, item.sha256]));
    if (select.dataset.options !== signature) {
      select.replaceChildren(new Option('Choose an inspected archive', ''),
        ...values.map(item => new Option((item.review?.label ?? item.archiveId) + ' · ' + item.sha256?.slice(0, 12), item.archiveId)));
      select.dataset.options = signature;
    }
    select.value = selectedArchive ?? '';
    const target = $('wb-inspection'), value = inspection(); target.hidden = !value;
    if (!value) return;
    const review = value.review;
    facts(target, [['Original workspace', review.directory], ['Workspace identity', review.workspaceId],
      ['Files', count(review.files)], ['Directories', count(review.directories)], ['Links', count(review.links)],
      ['Archive size', bytesText(value.bytes)], ['Archive SHA-256', value.sha256],
      ['Manifest SHA-256', value.manifestSha256]]);
    target.append(node('h4', 'External bindings to review on this host'),
      bindingsTable(review.externalBindings));
    if (review.externalBindingDiscovery) target.append(detail('Embedded path discovery coverage', review.externalBindingDiscovery));
    const saved = scopedDraft('restore', value.archiveId) ?? { mode: 'original', directory: '' };
    const form = node('form'), modeLabel = node('label', 'Receiving location'), mode = node('select');
    mode.id = 'wb-restore-mode'; mode.append(new Option('Original workspace location', 'original'), new Option('A new directory on this host', 'new-host'));
    mode.value = saved.mode; modeLabel.append(mode);
    const label = node('label', 'Destination directory'), destination = node('input');
    destination.id = 'wb-restore-directory'; destination.autocomplete = 'off'; destination.required = true;
    destination.value = mode.value === 'new-host' ? saved.directory : review.directory;
    destination.readOnly = mode.value !== 'new-host'; label.append(destination);
    const note = node('p', '', 'note');
    const explain = () => { note.textContent = mode.value === 'new-host' ?
      'The archived workspace identity, application settings and operation records remain unchanged. After receiving, review current runtime locations and save successor application settings through Applications.' :
      'The workspace is restored to its original location. Review its external bindings before reopening.'; };
    explain();
    mode.addEventListener('change', () => {
      if (busy) return;
      saved.mode = mode.value; destination.readOnly = mode.value !== 'new-host';
      destination.value = mode.value === 'new-host' ? saved.directory : review.directory;
      retainDraft('restore', value.archiveId, saved); explain();
    });
    destination.addEventListener('input', () => {
      if (busy || mode.value !== 'new-host') return;
      saved.directory = destination.value; retainDraft('restore', value.archiveId, saved);
    });
    const submit = node('button', 'Receive complete workspace'); submit.disabled = Boolean(busy);
    form.append(modeLabel, label, note, submit, node('p', 'The destination must be vacant or belong to this same receiving operation. Its request and complete archive identity are retained before work starts.', 'note'));
    form.addEventListener('submit', event => {
      event.preventDefault(); action(async scope => {
        const directory = mode.value === 'new-host' ? saved.directory.trim() : review.directory;
        if (!directory.startsWith('/')) throw new Error('Choose an absolute receiving directory.');
        retainDraft('restore', value.archiveId, saved);
        const result = await retainedPost('/api/workspace-backups/restore', { ...base(),
          requestId: crypto.randomUUID(), archiveId: value.archiveId,
          manifestSha256: value.manifestSha256, directory,
          ...(mode.value === 'new-host' ? { mode: 'new-host' } : {}),
        }, scope, mode.value === 'new-host' ? 'Receive workspace on this host' : 'Restore original workspace');
        if (!result || !current(scope)) return;
        await refresh(); message('Workspace receiving is retained. Review its locations after restoration completes.');
      });
    });
    target.append(form, button('Download this archive', () => action(() => download(value.archiveId)), Boolean(busy)));
  }
  function renderPending() {
    const target = $('wb-pending'), saved = pending();
    target.hidden = !saved; target.replaceChildren();
    if (saved) {
      target.append(node('h3', 'Retained request'), node('p', saved.label),
        node('p', 'Request: ' + (saved.input.requestId ?? saved.input.receivingId), 'note'),
        detail('Exact retained input', saved.input),
        button('Continue this exact request', () => action(async scope => {
          const result = await retainedPost(saved.path, saved.input, scope, saved.label);
          if (!result || !current(scope)) return;
          if (saved.path.endsWith('/review')) selectedReview = result;
          if (saved.path.endsWith('/bindings')) rememberBindingReview(saved.input.receivingId, result);
          if (saved.path.endsWith('/open')) {
            openedReceiving = { ...result, receivingId: saved.input.receivingId };
            save('-opened-receiving', { storageDirectory, value: openedReceiving });
          }
          await refresh(); renderReview();
          message('The original request has been reconciled.');
        }), Boolean(busy)),
        button('Keep original and start another request', () => {
          if (busy) return;
          save('-request', null); renderPending();
          message('Any existing original operation remains in the list below.');
        }, Boolean(busy)));
    }
    const upload = uploadPending(), uploadTarget = $('wb-upload-pending');
    uploadTarget.hidden = !upload; uploadTarget.replaceChildren();
    if (upload) {
      const actual = rows(state?.uploads).find(item => item.uploadId === upload.requestId);
      uploadTarget.append(node('p', 'Retained upload ' + upload.requestId + ' · ' +
        bytesText(actual?.receivedBytes ?? 0) + ' of ' + bytesText(upload.bytes) + '. Select the same archive and hash to continue.', 'note'),
        button('Keep original and choose another archive', () => {
          if (busy) return;
          save('-upload', null); renderPending();
        }, Boolean(busy)));
    }
  }
  async function reviewBindings(receivingId, scope) {
    const result = await api('/api/workspace-backups/bindings', { ...base(), receivingId });
    if (!current(scope)) return;
    rememberBindingReview(receivingId, result); renderBindings();
  }
  function renderBindings() {
    const target = $('wb-bindings'); target.hidden = !bindingReview;
    if (!bindingReview) return;
    const value = bindingReview, receivingId = selectedReceiving;
    const recorded = openedReceiving?.receivingId === receivingId ? openedReceiving :
      rows(state?.operations).find(item => item.operationId === receivingId)?.receiving;
    const accepted = recorded?.phase === 'BINDINGS_REVIEWED';
    const draftMatches = bindingDraftMatches(value, receivingId);
    facts(target, [['Restored workspace', value.directory], ['Original workspace location', value.originalDirectory ?? value.directory],
      ['Receiving mode', value.mode === 'new-host' ? 'New host directory' : 'Original location'],
      ['Runtime home available', value.runtimeHomeReady ? 'Yes' : 'No'],
      ['Binding review', accepted ? 'Recorded' : value.canOpen && draftMatches ? 'Ready to record' : 'Review current locations'],
      ['Imported operation records', value.importedOperationCount ?? '—'], ['Source readiness', value.sourceReadiness]]);
    target.prepend(node('h3', 'Review restored bindings'));
    if (value.mode === 'new-host' && !accepted) target.append(hostBindingsForm(value, receivingId));
    if (accepted && value.hostBindings) target.append(detail('Recorded current host locations', value.hostBindings));
    target.append(node('h4', value.mode === 'new-host' ? 'Historical external path references' : 'Original external bindings'),
      bindingsTable(value.bindings), node('p', value.mode === 'new-host' ?
        'These paths remain part of the archived history. Current runtime locations are recorded separately. Imported operations remain readable history; choose current work through the existing Runtime and Applications controls.' :
        'This review checks retained locations and source identities. Use the original Runtime and Applications controls to inspect readiness and start selected work.', 'note'));
    if (!accepted) {
    const actions = node('div', undefined, 'actions');
    actions.append(button('Refresh binding review', () => action(scope => reviewBindings(receivingId, scope)), Boolean(busy)));
    const accept = button('Record review and show reopening command', () => action(async scope => {
      if (!bindingDraftMatches(value, receivingId)) throw new Error('Review the current location choices before recording this result.');
      save('-binding-review', { storageDirectory, receivingId, value });
      const result = await retainedPost('/api/workspace-backups/open', { ...base(), receivingId,
        reviewId: value.reviewId, reviewSha256: value.reviewSha256 }, scope, 'Record reviewed receiving locations');
      if (!result || !current(scope)) return;
      openedReceiving = { ...result, receivingId };
      save('-opened-receiving', { storageDirectory, value: openedReceiving });
      renderBindings();
      message('The selected review is recorded. Use its reopening command, then review current application settings.');
    }), Boolean(busy) || !value.canOpen || !draftMatches);
    accept.id = 'wb-record-bindings'; actions.append(accept); target.append(actions);
    }
    if (recorded?.phase === 'BINDINGS_REVIEWED') {
      const command = 'starforge runtime-workspace serve --workspace ' + shellQuote(recorded.directory ?? value.directory);
      const output = node('div', undefined, 'result');
      output.append(node('h4', 'Reopen the restored workspace'), node('pre', command),
        node('p', 'Open the private URL printed by this command. The restored workspace retains its original application and operation records.', 'note'),
        value.mode === 'new-host' ? node('p', 'In the reopened workspace, choose Applications. Open each application’s saved settings, select its current runtime and input paths, then use Review and Save to create an attributed successor. Attach any unbound installation through Runtime. Historical operations remain available from Operations.', 'note') : node('span'),
        detail('Complete receiving result', recorded));
      target.append(output);
    }
  }
  function renderOperations() {
    const target = $('wb-operations'), operations = rows(state?.operations);
    $('wb-count').textContent = String(operations.length); target.replaceChildren();
    if (!operations.length) { target.append(node('p', 'Backup and receiving operations appear here after review or archive intake.', 'empty')); return; }
    for (const item of operations) {
      const article = node('article', undefined, 'operation'), title = node('div', undefined, 'section-title');
      title.append(node('h4', item.kind === 'EXPORT' ? 'Workspace backup' : 'Workspace receiving'),
        node('span', item.phase, 'status'));
      article.append(title, node('p', item.operationId + ' · ' + dateText(item.createdAt), 'note'));
      if (item.input?.directory) article.append(node('p', 'Receiving destination: ' + item.input.directory));
      if (item.input?.mode === 'new-host') article.append(node('p', 'New host receiving · archived identities and history retained', 'note'));
      if (item.error) article.append(node('p', item.error.code + ': ' + item.error.message));
      if (item.observation) article.append(detail('Current worker observation', item.observation));
      const actions = node('div', undefined, 'actions');
      if (item.phase !== 'COMPLETE') actions.append(button(
        item.phase === 'RUNNING' ? 'Check or continue original operation' : 'Continue original operation',
        () => action(async scope => {
          await api('/api/workspace-backups/continue', { ...base(), operationId: item.operationId });
          if (!current(scope)) return;
          await refresh(); message('The same retained operation is selected for continuation.');
        }), Boolean(busy)));
      if (item.result?.archiveId) {
        article.append(node('p', bytesText(item.result.bytes) + ' · SHA-256 ' + item.result.sha256, 'note'));
        actions.append(button('Download complete backup', () => action(() => download(item.result.archiveId)), Boolean(busy)));
      }
      if (item.result?.receivingId) actions.append(button('Review restored bindings',
        () => action(scope => reviewBindings(item.result.receivingId, scope)), Boolean(busy)));
      article.append(actions);
      if (item.receiving) {
        article.append(node('p', 'Current receiving state: ' + (item.receiving.phase ?? item.receiving.status), 'note'));
        if (item.receiving.error) article.append(node('p', item.receiving.error.code + ': ' + item.receiving.error.message));
        if (item.receiving.phase === 'BINDINGS_REVIEWED') {
          article.append(node('h5', 'Reopen the restored workspace'),
            node('pre', 'starforge runtime-workspace serve --workspace ' + shellQuote(item.receiving.directory)),
            detail('Recorded binding review', item.receiving));
        }
      }
      if (item.result) article.append(detail('Complete operation result', item.result));
      target.append(article);
    }
  }
  function renderUploads() {
    const target = $('wb-uploads'), uploads = rows(state?.uploads);
    target.replaceChildren();
    if (!uploads.length) { target.append(node('p', 'Archive uploads remain here across browser restarts.', 'empty')); return; }
    target.append(table(['Archive', 'Received', 'State', 'Continue'], uploads.map(item => [
      item.uploadId, bytesText(item.receivedBytes) + ' of ' + bytesText(item.bytes),
      item.complete ? 'Complete' : item.error ? item.error.code : 'Incomplete',
      button(item.complete ? 'Inspect retained archive' : 'Continue this upload', () => action(async scope => {
        if (item.complete) {
          const value = await api('/api/workspace-backups/inspect', { ...base(), uploadId: item.uploadId, sha256: item.sha256 });
          if (!current(scope)) return;
          selectedArchive = value.archiveId; await refresh();
        } else {
          save('-upload', { requestId: item.requestId ?? item.uploadId, sha256: item.sha256,
            bytes: item.bytes, storageDirectory });
          $('wb-sha').value = item.sha256; $('wb-path').value = '';
          renderPending(); $('wb-file').focus();
          message('Select this same original archive file, then continue receiving.');
        }
      }), Boolean(busy)),
    ])));
  }
  function render() {
    if (openedReceiving && rows(state?.operations).find(item => item.operationId === openedReceiving.receivingId)?.receiving?.available === false)
      openedReceiving = null;
    renderUploads(); renderReview(); renderInspection(); renderOperations(); renderPending(); renderBindings(); setDisabled();
  }
  async function refresh() {
    const main = getState();
    if (main?.workspaceId && workspaceIdentity !== main.workspaceId) {
      workspaceIdentity = main.workspaceId;
      storageDirectory = readSaved('-storage') ?? null;
      $('wb-storage').value = storageDirectory ?? '';
    }
    const scope = context();
    if (loading && current(loading)) return;
    loading = scope;
    try {
      const value = await api(query('/api/workspace-backups/state', base()));
      if (!current(scope)) return;
      state = value;
      if (!workspaceIdentity || !storageDirectory) {
        workspaceIdentity = value.workspaceId;
        const retainedStorage = readSaved('-storage');
        storageDirectory = retainedStorage ?? value.storageDirectory;
        $('wb-storage').value = storageDirectory;
        if (retainedStorage && retainedStorage !== value.storageDirectory) {
          loading = null;
          await refresh(); return;
        }
      }
      if (!selectedReview && rows(value.reviews).length)
        selectedReview = [...value.reviews].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1);
      if (selectedArchive && !rows(value.inspections).some(item => item.archiveId === selectedArchive))
        selectedArchive = null;
      if (!bindingReview) {
        const retained = readSaved('-binding-review');
        if (retained?.storageDirectory === storageDirectory && rows(value.operations).some(item => item.operationId === retained.receivingId)) {
          selectedReceiving = retained.receivingId; bindingReview = retained.value;
        }
      }
      if (!openedReceiving) {
        const retained = readSaved('-opened-receiving');
        if (retained?.storageDirectory === storageDirectory) openedReceiving = retained.value;
      }
      render();
    } finally { if (loading === scope) loading = null; }
  }
  async function receiveFile(file, sha256, scope) {
    const previous = uploadPending();
    if (previous && (previous.sha256 !== sha256 || previous.bytes !== file.size))
      throw new Error('Continue the retained archive or choose another archive using the control below.');
    const input = previous ?? { requestId: crypto.randomUUID(), sha256, bytes: file.size, storageDirectory };
    save('-upload', input);
    const observed = await api(query('/api/workspace-backups/state', base()));
    if (!current(scope)) return null;
    let saved = rows(observed.uploads).find(item => item.uploadId === input.requestId);
    if (saved && (saved.sha256 !== sha256 || saved.bytes !== file.size))
      throw new Error('The retained upload identity belongs to different archive bytes.');
    let offset = saved?.receivedBytes ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.size)
      throw new Error('The receiver returned an invalid retained upload length.');
    const CHUNK = 8 * 1024 * 1024;
    // A full-length unfinalized upload still receives an empty final stream,
    // allowing the original complete digest verification to resume.
    do {
      if (saved?.complete) break;
      $('wb-upload-progress').textContent = 'Receiving ' + bytesText(offset) + ' of ' + bytesText(file.size);
      const response = await fetch(query('/api/workspace-backups/upload', { ...base(),
        requestId: input.requestId, sha256, bytes: file.size, offset }), {
        method: 'POST', headers: { 'x-runtime-workspace-token': scope.token,
          'content-type': 'application/octet-stream' }, body: file.slice(offset, Math.min(offset + CHUNK, file.size)),
      });
      const value = await response.json();
      if (!response.ok) throw Object.assign(new Error(value.message ?? value.error), { code: value.error, status: response.status });
      if (!current(scope)) return null;
      if (value.uploadId !== input.requestId || value.bytes !== file.size ||
          !Number.isSafeInteger(value.receivedBytes) || value.receivedBytes < offset ||
          value.receivedBytes > file.size || (value.complete && value.receivedBytes !== file.size) || (!value.complete && value.receivedBytes === offset))
        throw new Error('The receiver returned an inconsistent archive continuation.');
      saved = value; offset = value.receivedBytes;
    } while (!saved.complete);
    const inspected = await api('/api/workspace-backups/inspect', { ...base(), uploadId: input.requestId, sha256 });
    if (!current(scope)) return null;
    save('-upload', null); $('wb-upload-progress').textContent = 'Complete archive received and inspected.';
    return inspected;
  }
  $('wb-storage-form').addEventListener('submit', event => {
    event.preventDefault();
    if (busy) return;
    const selected = $('wb-storage').value.trim() || (getState()?.directory ?? state?.directory) + '.backups';
    if (!selected.startsWith('/')) { error(new Error('Choose an absolute private backup directory.')); return; }
    epoch++; storageDirectory = selected; save('-storage', selected); state = null;
    selectedArchive = null; selectedReview = null; bindingReview = null; selectedReceiving = null; openedReceiving = null;
    render(); refresh().catch(error);
  });
  $('wb-review-form').addEventListener('submit', event => {
    event.preventDefault(); action(async scope => {
      const result = await retainedPost('/api/workspace-backups/review', { ...base(),
        requestId: crypto.randomUUID(), label: $('wb-label').value.trim(),
      }, scope, 'Review complete workspace');
      if (!result || !current(scope)) return;
      selectedReview = result; renderReview();
      message('Complete workspace reviewed. Inspect included files and external bindings, then create this backup.');
    });
  });
  $('wb-intake-form').addEventListener('submit', event => {
    event.preventDefault(); action(async scope => {
      const file = $('wb-file').files[0], archivePath = $('wb-path').value.trim(), sha256 = $('wb-sha').value.trim();
      if (Boolean(file) === Boolean(archivePath)) throw new Error('Choose an archive file or an existing operator path.');
      if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Enter the original archive SHA-256.');
      if (file && (!Number.isSafeInteger(file.size) || file.size <= 0)) throw new Error('Choose the complete nonempty archive.');
      const value = file ? await receiveFile(file, sha256, scope) :
        await api('/api/workspace-backups/inspect', { ...base(), archivePath, sha256 });
      if (!value || !current(scope)) return;
      selectedArchive = value.archiveId;
      await refresh(); message('The complete archive is inspected. Its original destination and external bindings appear below.');
    });
  });
  $('wb-archive').addEventListener('change', () => { selectedArchive = $('wb-archive').value || null; renderInspection(); });
  $('wb-refresh').addEventListener('click', () => refresh().catch(error));
  function reset() {
    epoch++; busy = null; loading = null; state = null; storageDirectory = null; workspaceIdentity = null;
    selectedReview = null; selectedArchive = null; bindingReview = null; selectedReceiving = null; openedReceiving = null;
    $('wb-file').value = ''; $('wb-path').value = ''; $('wb-sha').value = '';
    $('wb-upload-progress').textContent = ''; $('wb-storage').value = '';
    $('wb-archive').replaceChildren(new Option('Choose an inspected archive', '')); delete $('wb-archive').dataset.options;
    render();
  }
  return { refresh, reset };
}
