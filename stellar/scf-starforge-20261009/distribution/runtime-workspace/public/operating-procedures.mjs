// MIT. Original Operating Plan editing over the retained Runtime procedure API.
import { operatingPlanDraft, operatingPlanRevision, inspectOperatingPlan, saveOperatingPlanRevision, createOperatingStep,
  createOperatingFile, operatingFileBytes, OPERATING_FILE_MAX_BYTES } from './operating-plan.mjs';
import { compareOperatingPlanReturn } from './operating-plan-return.mjs';
const BASE = '/api/runtime-procedures', LIMIT = 256 * 1024 * 1024, BODY_LIMIT = 257 * 1024 * 1024;
const clone = value => structuredClone(value);
const el = (tag, text, className) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value; };
function button(label, click, disabled = false) { const node = el('button', label); node.type = 'button'; node.disabled = disabled; node.addEventListener('click', click); return node; }
function detail(label, value) {
  const node = el('details'), pre = el('pre'); node.append(el('summary', label), pre);
  node.addEventListener('toggle', () => { pre.textContent = node.open ? (typeof value === 'string' ? value : JSON.stringify(value, null, 2)) : ''; });
  return node;
}
function saveDownload(content, name, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type })), a = el('a');
  a.href = url; a.download = name; a.rel = 'noreferrer'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function field(label, value = '', multiline = false) {
  const wrapper = el('label', label), input = el(multiline ? 'textarea' : 'input');
  if (multiline) input.rows = 3; else input.type = 'text';
  input.value = value; wrapper.append(input); return { wrapper, input };
}
function openStorage() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('starforge-runtime-operating-procedures', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('entries');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Procedure browser storage is unavailable.'));
    request.onblocked = () => reject(new Error('Close the older procedure storage connection, then retry.'));
  });
}
async function savedValue(key, value, write = false) {
  const db = await openStorage();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('entries', write ? 'readwrite' : 'readonly'), store = tx.objectStore('entries');
      const req = write ? store.put(value, key) : store.get(key);
      let result; req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(write ? value : result);
      tx.onerror = () => reject(tx.error ?? new Error('Could not retain this procedure request.'));
      tx.onabort = () => reject(tx.error ?? new Error('Procedure storage transaction was interrupted.'));
    });
  } finally { db.close(); }
}
async function readSelectedFile(file) {
  if (!file || !file.size || file.size > LIMIT) throw new Error('Choose one complete nonempty JSON file no larger than 256 MiB.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
}
export function createOperatingProceduresView({ root, api, getState, getToken, getView, message, error,
  openLog, chooseRuntime, switchView, openApplication }) {
  let state = null, selectedId = null, loaded = null, draft = null, dirty = false, busy = null, loading = false;
  let epoch = 0, selectedStep = null, request = null, requestVersion = 0, incoming = null, pendingDraft = null, draftQueue = Promise.resolve();
  let editorVersion = 0, renderedEditor = null, renderedRecord = null, sourceSignature = null, selection = emptySelection();
  const temporarilyDisabled = new WeakMap();
  const draftSession = (() => { const key = 'starforge-runtime-procedure-editor-session';
    try { const value = sessionStorage.getItem(key) || crypto.randomUUID(); sessionStorage.setItem(key, value); return value; }
    catch { return crypto.randomUUID(); } })();
  const draftKey = id => key('draft:' + draftSession + ':' + id);
  const $ = id => root.querySelector('#rp-' + id);
  function emptySelection() { return { runtimeIds: [], operationIds: [], archiveIds: [], backupOperationIds: [] }; }
  function identity() { return state?.workspaceId ?? getState()?.workspaceId ?? null; }
  function scope() { const e = epoch, token = getToken(), workspaceId = identity(); return () => e === epoch && token === getToken() && (!workspaceId || identity() === workspaceId); }
  function key(suffix, workspaceId = identity()) { if (!workspaceId) throw new Error('Open the original Runtime workspace first.'); return workspaceId + ':' + suffix; }
  function json(value) { return JSON.stringify(value, null, 2) + '\n'; }
  function markDraft() {
    if (!draft) return;
    dirty = true;
    const value = { procedureId: selectedId, expectedSha256: loaded?.recordSha256, draft: clone(draft), at: new Date().toISOString() };
    const storageKey = draftKey(selectedId), current = scope();
    draftQueue = draftQueue.catch(() => {}).then(() => savedValue(storageKey, value, true)).catch(failure => {
      if (current()) { $('draft-status').textContent = 'Draft is only in this page. Download it before leaving: ' + failure.message; error(failure); }
      throw failure;
    });
    // A later save explicitly awaits the durable chain; input handlers never leak an unhandled rejection.
    draftQueue.catch(() => {});
    controls(); $('draft-status').textContent = 'Edited draft · retained browser copy pending';
    draftQueue.then(() => { if (current() && dirty) $('draft-status').textContent = 'Edited draft retained in this browser'; }).catch(() => {});
  }
  root.innerHTML = '<div class="section-title"><div><p class="eyebrow">RECURRING WORK</p><h2>Operating procedures</h2></div><button id="rp-refresh" type="button">Refresh procedures</button></div>' +
    '<p class="muted">Keep instructions, complete selected Runtime records, original plan revisions and reviewed returned work together. Run installation, applications and backups through their existing controls. <a href="/runtime-procedures-guide" target="_blank" rel="noreferrer">Read the operating guide</a>.</p>' +
    '<p id="rp-context" class="note"></p><button id="rp-request-history" type="button">Open retained browser requests</button><div id="rp-request-history-list" hidden></div><div id="rp-request" class="panel" hidden></div>' +
    '<div class="columns"><section class="panel"><h3>Saved procedures</h3><div id="rp-list"></div></section>' +
    '<section class="panel"><h3>New procedure</h3><form id="rp-create"><label>Title<input name="title" required></label><label>Customer or team<input name="customer"></label><label>Owner<input name="owner" required></label><label>Recurrence or trigger<input name="period"></label><label>Useful result<textarea name="purpose" rows="3"></textarea></label><button type="submit">Create procedure with selected source</button></form></section></div>' +
    '<section class="panel"><h3>Selected Runtime source</h3><p class="note">Select complete saved records for creation or the next observation. Large archives keep their original digest and native download reference.</p><div id="rp-sources"></div><label>Backup storage directory (optional)<input id="rp-storage" autocomplete="off" placeholder="/absolute/private/workspace.backups"></label></section>' +
    '<section class="panel"><h3>Receive an existing procedure</h3><form id="rp-receive"><label>Complete Runtime procedure JSON<input id="rp-receive-file" type="file" accept=".json,application/json" required></label><button type="submit">Inspect receiving file</button></form><div id="rp-incoming" hidden></div></section>' +
    '<section id="rp-selected" hidden><div class="section-title"><h3 id="rp-title"></h3><span id="rp-revision" class="status"></span></div><div id="rp-stale" class="panel" hidden></div>' +
    '<div class="actions"><button id="rp-json" type="button">Download complete procedure JSON</button><button id="rp-html" type="button">Download readable HTML</button><button id="rp-plan" type="button">Download original Operating Plan</button><button id="rp-plan-html" type="button">Download plan HTML</button><button id="rp-draft-download" type="button">Download current draft</button></div>' +
    '<div class="panel"><h3>Original revision history</h3><div id="rp-history"></div><div id="rp-saved-draft" hidden></div><p id="rp-draft-status" class="note"></p><label>Reopen downloaded draft<input id="rp-draft-file" type="file" accept=".json,application/json"></label><fieldset id="rp-edit-fieldset"><legend>Editable procedure</legend><div id="rp-editor"></div></fieldset><button id="rp-save" type="button">Save next original revision</button></div>' +
    '<div class="panel"><h3>Record an observation</h3><form id="rp-record"><label>Step<select name="stepId" id="rp-step" required></select></label><label>Recording operator<input name="owner" required></label><label>Operator assessment<select name="status"><option value="planned">planned</option><option value="in-progress">in progress</option><option value="completed">completed</option><option value="skipped">skipped</option></select></label><label>Observed result<textarea name="recordedResult" rows="4" required></textarea></label><button type="submit">Record selected originals and assessment</button></form><p class="note">This explicitly saves your named assessment and full selected source. A capture alone is not proof of completion or current liveness.</p><div id="rp-captures"></div></div>' +
    '<div class="panel"><h3>Review returned work</h3><form id="rp-return"><label>Original Operating Plan or full Runtime procedure JSON<input name="incoming" type="file" accept=".json,application/json" required></label><label>Reviewer<input name="reviewer" required></label><label>Review notes<textarea name="notes" rows="3"></textarea></label><button type="submit">Prepare original return comparison</button></form><div id="rp-returns"></div></div>' +
    '<details id="rp-full-details"><summary>Complete current record</summary><pre id="rp-full"></pre></details></section>';
  function controls() {
    for (const node of root.querySelectorAll('button,input,textarea,select,fieldset')) {
      if (busy) { if (!temporarilyDisabled.has(node)) temporarilyDisabled.set(node, node.disabled); node.disabled = true; }
      else if (temporarilyDisabled.has(node)) { node.disabled = temporarilyDisabled.get(node); temporarilyDisabled.delete(node); }
    }
    for (const node of root.querySelectorAll('[data-apply-review]')) node.disabled = Boolean(busy || request || dirty) || node.dataset.ready !== 'true';
    $('save').disabled = Boolean(busy) || !draft || !dirty || Boolean(request);
    if (!loaded) $('selected').hidden = true;
  }
  async function run(fn) {
    if (busy) return;
    const current = scope(), ticket = {}; busy = ticket; controls();
    try { await fn(current); }
    catch (failure) { if (current()) error(failure); }
    finally { if (busy === ticket) { busy = null; render(); } }
  }
  function currentSelection() {
    const result = clone(selection), storage = $('storage').value.trim();
    if (storage) result.storageDirectory = storage;
    return result;
  }
  function selectRequest(value) { request = value; requestVersion++; }
  function clearRequest(value) {
    if (request?.workspaceId === value.workspaceId && request?.input.requestId === value.input.requestId) selectRequest(null);
  }
  async function retainRequest(value) {
    const recordKey = key('request:' + value.input.requestId, value.workspaceId), pointerKey = key('pending', value.workspaceId);
    const db = await openStorage();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('entries', 'readwrite'), store = tx.objectStore('entries');
        store.put(value, recordKey); store.put({ requestId: value.input.requestId }, pointerKey);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }
  async function pendingRequest(workspaceId = identity()) {
    const pointer = await savedValue(key('pending', workspaceId));
    if (!pointer?.requestId) return null;
    const value = await savedValue(key('request:' + pointer.requestId, workspaceId));
    if (!value || value.workspaceId !== workspaceId || value.input?.requestId !== pointer.requestId)
      throw new Error('The retained pending request does not match its original workspace and request identity.');
    return value;
  }
  async function acknowledgeRequest(value, result = null) {
    const pointerKey = key('pending', value.workspaceId), recordKey = key('request:' + value.input.requestId, value.workspaceId);
    const db = await openStorage();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('entries', 'readwrite'), store = tx.objectStore('entries');
        store.put({ ...value, status: result ? 'RETURNED' : 'RETAINED',
          ...(result ? { resultIdentity: { procedureId: result.record.id, recordSha256: result.recordSha256 } } : {}) }, recordKey);
        const request = store.get(pointerKey);
        request.onsuccess = () => { if (request.result?.requestId === value.input.requestId) store.put(null, pointerKey); };
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }
  async function requestHistory() {
    const prefix = key('request:'), db = await openStorage();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('entries', 'readonly'), store = tx.objectStore('entries'), values = [];
        const cursor = store.openCursor(IDBKeyRange.bound(prefix, prefix + '\uffff'));
        cursor.onsuccess = () => { if (cursor.result) { values.push(cursor.result.value); cursor.result.continue(); } };
        tx.oncomplete = () => resolve(values); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }
  async function commit(action, input, current, { preserveDraft = false } = {}) {
    if (!current()) return null;
    if (request) throw new Error('Reconcile or explicitly retain the original pending request before starting another.');
    const exact = { requestId: crypto.randomUUID(), ...clone(input) };
    if (new TextEncoder().encode(JSON.stringify(exact)).length > BODY_LIMIT) throw new Error('This complete request exceeds 257 MiB. Retain the full originals and use a smaller complete source selection.');
    const retained = { action, input: exact, workspaceId: identity(), at: new Date().toISOString() };
    const savedDraftKey = action === 'save' ? draftKey(input.procedureId) : null;
    selectRequest(retained);
    await retainRequest(retained);
    if (!current()) return null;
    renderRequest();
    const result = await api(BASE + '/' + action, exact);
    if (!current()) return null;
    if (!result?.record || typeof result.recordSha256 !== 'string') throw new Error('The procedure returned an incomplete saved record.');
    inspectOperatingPlan(result.record.plan);
    if (!/^[a-f0-9]{64}$/.test(result.recordSha256) || (input.procedureId && result.record.id !== input.procedureId)) throw new Error('The saved procedure identity differs from the selected request.');
    await acknowledgeRequest(retained, result);
    if (!current()) return result;
    clearRequest(retained);
    if (savedDraftKey) await savedValue(savedDraftKey, null, true);
    if (!current()) return result;
    await acceptResult(result, current, preserveDraft); return result;
  }
  async function acceptResult(value, current, preserveDraft = false) {
    inspectOperatingPlan(value.record.plan);
    if (!current()) return;
    selectedId = value.record.id; loaded = value; pendingDraft = null;
    if (!preserveDraft) { draft = operatingPlanDraft(value.record.plan); dirty = false; editorVersion++; }
    await refresh({ keepSelection: true }); if (current()) message('Original procedure and request retained.');
  }
  async function choose(id) {
    if (busy) return;
    await run(async current => {
      const storageKey = draftKey(id);
      if (dirty) await draftQueue;
      if (!current()) return;
      const value = await api(BASE + '/read', { procedureId: id });
      if (!current()) return;
      inspectOperatingPlan(value.record.plan);
      const local = await savedValue(storageKey);
      if (!current()) return;
      selectedId = id; loaded = value; draft = operatingPlanDraft(value.record.plan);
      dirty = false; pendingDraft = local ?? null; selectedStep = null; editorVersion++;
    });
  }
  function renderRequest() {
    const target = $('request'); target.replaceChildren(); target.hidden = !request;
    if (!request) return;
    target.append(el('h3', 'Retained original request'), el('p', request.action + ' · ' + request.input.requestId),
      detail('Exact retained input', request.input),
      button('Continue retained request', () => run(async current => {
        const retained = clone(request); selectRequest(retained); await retainRequest(retained);
        if (!current()) return;
        const response = await api(BASE + '/' + retained.action, retained.input);
        if (!current()) return;
        if (!response?.record || typeof response.recordSha256 !== 'string') throw new Error('The retained request returned an incomplete record.');
        inspectOperatingPlan(response.record.plan);
        if (!/^[a-f0-9]{64}$/.test(response.recordSha256) || (retained.input.procedureId && response.record.id !== retained.input.procedureId)) throw new Error('The retained response identifies a different procedure.');
        await acknowledgeRequest(retained, response);
        if (!current()) return;
        clearRequest(retained);
        await acceptResult(response, current);
      }), false),
      button('Download retained request', () => saveDownload(json(request), 'runtime-procedure-pending-' + request.input.requestId + '.json'), false),
      button('Retain this request and allow another', () => run(async current => {
        const retained = clone(request); selectRequest(retained); await acknowledgeRequest(retained);
        if (!current()) return;
        clearRequest(retained);
        message('The original request is retained in browser storage. Its server record is unchanged; inspect it before dispatching different work.');
      }), false));
  }
  function renderSources() {
    const source = state?.source ?? {}, normalized = [
      ['runtimeIds', 'Runtime installations', source.runtimes], ['operationIds', 'Retained operations', source.operations],
      ['archiveIds', 'Source archives', source.archives], ['backupOperationIds', 'Backup and receiving operations', Array.isArray(source.backups) ? source.backups : source.backups?.operations],
    ];
    const signature = JSON.stringify(normalized);
    if (signature === sourceSignature) return;
    sourceSignature = signature; const target = $('sources'); target.replaceChildren();
    for (const [keyName, label, provided] of normalized) {
      const sourceKey = { runtimeIds: 'runtimes', operationIds: 'operations', archiveIds: 'archives', backupOperationIds: 'operations' }[keyName];
      const records = Array.isArray(provided) ? provided : provided?.[sourceKey] ?? [];
      if (!Array.isArray(records)) throw new Error('The Runtime source selection returned an unexpected collection.');
      const group = el('details'), summary = el('summary', label + ' · ' + (records?.length ?? 0)); group.append(summary);
      for (const value of records ?? []) {
        const id = value.id ?? value.operationId; if (!id) continue;
        const wrapper = el('label', undefined, 'check'), input = el('input'); input.type = 'checkbox';
        input.checked = selection[keyName].includes(id);
        input.addEventListener('change', () => { selection[keyName] = input.checked ? [...new Set([...selection[keyName], id])] : selection[keyName].filter(item => item !== id); });
        wrapper.append(input, document.createTextNode((value.label ?? value.name ?? value.operation ?? value.kind ?? id) + ' · ' + (value.displayPhase ?? value.phase ?? '') + ' · ' + id));
        group.append(wrapper, detail('Complete selected record ' + id, value));
      }
      if (provided && !Array.isArray(provided)) group.append(detail('Complete source view', provided));
      target.append(group);
    }
    if (source.error || source.unavailable) target.append(detail('Source availability', source));
  }
  function renderList() {
    const target = $('list'); target.replaceChildren();
    if (!state?.procedures?.length) { target.append(el('p', 'No saved procedures in this workspace.', 'empty')); return; }
    for (const item of state.procedures) {
      const b = button(item.plan.title + ' · revision ' + item.plan.revision + ' · ' + item.captureCount + ' captures',
        () => choose(item.id), false);
      b.dataset.procedureId = item.id; if (item.id === selectedId) b.setAttribute('aria-current', 'true');
      target.append(b, el('p', item.id, 'note'));
    }
  }
  function renderHistory() {
    const target = $('history'); target.replaceChildren();
    for (const revision of loaded.record.plan.revisions) {
      const row = el('div', undefined, 'actions');
      row.append(el('span', 'Revision ' + revision.revision + ' · ' + revision.savedAt),
        button('Inspect original revision ' + revision.revision, () => {
          const block = detail('Complete original revision ' + revision.revision, revision); block.open = true; target.append(block);
        }, false),
        button('Use revision ' + revision.revision + ' content in draft', () => {
          if (busy) return;
          draft = operatingPlanDraft(loaded.record.plan, revision.revision); markDraft(); renderedEditor = null; render();
        }, false));
      target.append(row);
    }
  }
  function renderReturns() {
    const target = $('returns'); target.replaceChildren();
    for (const review of loaded.record.returnReviews ?? []) {
      const comparison = compareOperatingPlanReturn(review), article = el('article', undefined, 'operation');
      article.append(el('h4', 'Return review ' + review.id), el('p', review.reviewer + ' · ' + review.createdAt),
        el('p', review.completion ? 'Applied · ' + review.completion.savedAt : comparison.summary.unresolved + ' unresolved · ' + comparison.summary.conflicts + ' conflicts'),
        detail('Complete original return comparison', comparison));
      for (const row of comparison.rows.filter(item => item.conflict || item.reviewed || item.current !== item.incoming)) {
        const block = el('details'); block.append(el('summary', row.label + (row.conflict ? ' · conflict' : '')),
          detail('Original base', row.base), detail('Current local value', row.current), detail('Returned value', row.incoming));
        if (!review.completion) {
          const choice = field('Reviewed choice'), select = el('select');
          for (const take of ['current', 'incoming', 'base', 'custom']) select.append(new Option(take, take));
          select.value = row.take; choice.input.replaceWith(select);
          const custom = field('Custom value (complete JSON)', row.take === 'custom' ? JSON.stringify(row.value, null, 2) : '', true);
          custom.wrapper.hidden = select.value !== 'custom';
          select.addEventListener('change', () => { custom.wrapper.hidden = select.value !== 'custom'; if (select.value === 'custom' && !custom.input.value) custom.input.value = JSON.stringify(row.value, null, 2); });
          const note = field('Decision note', row.note || '');
          block.append(choice.wrapper, custom.wrapper, note.wrapper, button('Save this decision', () => run(async current => {
            const decision = { take: select.value, note: note.input.value };
            if (decision.take === 'custom') decision.value = JSON.parse(custom.input.value);
            await commit('decide', { procedureId: selectedId, expectedSha256: loaded.recordSha256,
              reviewId: review.id, key: row.key, decision }, current, { preserveDraft: true });
          }), false),
          button('Remove explicit decision', () => run(current => commit('decide', {
            procedureId: selectedId, expectedSha256: loaded.recordSha256, reviewId: review.id, key: row.key, decision: null,
          }, current, { preserveDraft: true })), !row.reviewed));
        }
        article.append(block);
      }
      if (!review.completion) {
        const apply = button('Apply reviewed returned work', () => run(async current => {
          if (dirty) throw new Error('Save or retain and reload your current draft before applying returned work.');
          await commit('apply', { procedureId: selectedId, expectedSha256: loaded.recordSha256, reviewId: review.id }, current);
        }), Boolean(request) || !comparison.ready || dirty);
        apply.dataset.applyReview = review.id; apply.dataset.ready = String(comparison.ready); article.append(apply);
      }
      target.append(article);
    }
  }
  function render() {
    renderList(); renderSources(); renderRequest();
    $('context').textContent = state ? 'Original Runtime workspace: ' + state.workspaceId : 'Open the original Runtime workspace.';
    $('selected').hidden = !loaded;
    if (!loaded) { controls(); return; }
    $('title').textContent = operatingPlanRevision(loaded.record.plan).title;
    $('revision').textContent = 'Plan ' + operatingPlanRevision(loaded.record.plan).revision + ' · record ' + loaded.record.revision;
    const remote = state?.procedures?.find(row => row.id === selectedId), stale = remote && remote.recordSha256 !== loaded.recordSha256;
    $('stale').hidden = !stale; $('stale').replaceChildren();
    if (stale) $('stale').append(el('p', 'This procedure changed elsewhere. Your draft remains selected against its original record.'),
      button('Keep draft and reopen saved record', () => choose(selectedId), false));
    const retained = $('saved-draft'); retained.hidden = !pendingDraft; retained.replaceChildren();
    if (pendingDraft) retained.append(el('p', 'A complete earlier browser draft is retained. It is not automatically rebased.'),
      button('Download retained draft', () => saveDownload(json(pendingDraft), 'runtime-procedure-retained-draft.json'), false),
      button('Reopen retained draft', () => {
        if (busy) return;
        if (pendingDraft.expectedSha256 !== loaded.recordSha256) { error(new Error('This draft belongs to an earlier record. Download it and compare its complete content before preparing a new revision.')); return; }
        draft = clone(pendingDraft.draft); dirty = true; pendingDraft = null; editorVersion++; renderedEditor = null; render();
      }, false));
    if (renderedEditor !== editorVersion) {
      buildContentEditor($('editor'), draft, { onChange: markDraft, locked: false, run, selectStep: id => {
        selectedStep = id; $('step').value = id; $('record').scrollIntoView({ block: 'nearest' });
      } });
      renderedEditor = editorVersion;
    }
    if (renderedRecord !== loaded.recordSha256) renderHistory();
    const previousStep = selectedStep ?? $('step').value, steps = operatingPlanRevision(loaded.record.plan).steps;
    $('step').replaceChildren(new Option('Choose a saved step', ''), ...steps.map(step => new Option(step.title || step.id, step.id)));
    $('step').value = steps.some(step => step.id === previousStep) ? previousStep : '';
    $('captures').replaceChildren(...(loaded.record.captures ?? []).map(capture => detail('Capture ' + capture.id + ' · ' + capture.capturedAt, capture)));
    if (renderedRecord !== loaded.recordSha256) {
      renderReturns(); $('full').textContent = $('full-details').open ? json(loaded.record) : ''; renderedRecord = loaded.recordSha256;
    }
    controls();
  }
  async function refresh({ keepSelection = false } = {}) {
    if ((loading && !keepSelection) || (busy && !keepSelection)) return;
    const ticket = {}, version = requestVersion, current = scope(); loading = ticket;
    try {
      const storageDirectory = $('storage').value.trim();
      const result = await api(BASE + (storageDirectory ? '?storageDirectory=' + encodeURIComponent(storageDirectory) : ''));
      if (loading !== ticket || !current() || requestVersion !== version || $('storage').value.trim() !== storageDirectory) return;
      if (state && result.workspaceId !== state.workspaceId) { reset(); throw new Error('The Runtime workspace changed; reopen its procedure selection.'); }
      const retained = await pendingRequest(result.workspaceId);
      if (loading !== ticket || !current() || requestVersion !== version || $('storage').value.trim() !== storageDirectory) return;
      state = result; selectRequest(retained ?? null);
      render();
    } finally { if (loading === ticket) loading = false; }
  }
  $('full-details').addEventListener('toggle', () => { $('full').textContent = $('full-details').open && loaded ? json(loaded.record) : ''; });
  $('request-history').addEventListener('click', () => run(async current => {
    const values = await requestHistory();
    if (!current()) return;
    const target = $('request-history-list'); target.hidden = false; target.replaceChildren();
    for (const value of values) target.append(el('p', value.action + ' · ' + value.input.requestId + ' · ' + (value.status ?? 'PENDING')),
      button('Download exact request', () => saveDownload(json(value), 'runtime-procedure-request-' + value.input.requestId + '.json')),
      button('Select original request for reconciliation', () => run(async active => {
        if (request && request.input.requestId !== value.input.requestId) throw new Error('Retain the current pending request before selecting another.');
        if (value.workspaceId !== identity()) throw new Error('Select a retained request from this exact Runtime workspace.');
        const retained = clone(value); selectRequest(retained);
        await retainRequest(retained); if (!active()) return; renderRequest();
      })));
    if (!values.length) target.append(el('p', 'No retained requests in this browser for this workspace.'));
  }));
  $('storage').addEventListener('change', () => {
    selection.backupOperationIds = []; sourceSignature = null; refresh().catch(error);
  });
  $('refresh').addEventListener('click', () => refresh().catch(error));
  $('create').addEventListener('submit', event => {
    event.preventDefault();
    const input = Object.fromEntries(new FormData(event.currentTarget)); input.selection = currentSelection();
    run(current => commit('create', input, current));
  });
  $('save').addEventListener('click', () => run(async current => {
    await draftQueue;
    if (!current()) return;
    saveOperatingPlanRevision(loaded.record.plan, clone(draft));
    await commit('save', { procedureId: selectedId, expectedSha256: loaded.recordSha256, draft: clone(draft) }, current);
  }));
  $('record').addEventListener('submit', event => {
    event.preventDefault();
    const input = Object.fromEntries(new FormData(event.currentTarget));
    run(async current => {
      if (dirty) throw new Error('Save or retain and reopen the current draft before recording an observation against its saved step.');
      await commit('record', { ...input, procedureId: selectedId, expectedSha256: loaded.recordSha256, selection: currentSelection() }, current);
    });
  });
  $('return').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget, file = form.elements.incoming.files[0], reviewer = form.elements.reviewer.value, notes = form.elements.notes.value;
    run(async current => {
      const value = await readSelectedFile(file), plan = inspectOperatingPlan(value.plan ?? value);
      if (!current()) return;
      await commit('return', { procedureId: selectedId, expectedSha256: loaded.recordSha256, incoming: plan, reviewer, notes }, current, { preserveDraft: true });
    });
  });
  $('receive').addEventListener('submit', event => {
    event.preventDefault(); const file = $('receive-file').files[0];
    run(async current => {
      const document = await readSelectedFile(file);
      inspectOperatingPlan(document.plan);
      if (document.schema !== 'stellar-forge.runtime-operating-procedure.v1') throw new Error('Choose the complete original Runtime procedure record.');
      if (!current()) return;
      incoming = document; const target = $('incoming'); target.hidden = false; target.replaceChildren(
        el('p', document.id + ' · source workspace ' + document.workspaceId + ' · record ' + document.revision),
        detail('Complete received procedure', document),
        button('Receive this complete original record', () => run(current => commit('receive', { document: clone(document) }, current)), false));
    });
  });
  for (const [id, format] of [['json', 'json'], ['html', 'html'], ['plan', 'plan-json'], ['plan-html', 'plan-html']])
    $(id).addEventListener('click', () => run(async current => {
      const result = await api(BASE + '/export', { procedureId: selectedId, format });
      if (!current()) return;
      const bytes = new TextEncoder().encode(result.content), digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
      if (!current()) return;
      if (bytes.length !== result.bytes || digest !== result.sha256) throw new Error('The complete procedure download does not match its original identity.');
      saveDownload(bytes, result.filename, result.mediaType);
    }));
  $('draft-file').addEventListener('change', () => {
    const file = $('draft-file').files[0]; $('draft-file').value = '';
    if (!file) return;
    run(async current => {
      const value = await readSelectedFile(file), received = value.draft ?? value;
      if (!current()) return;
      if (value.procedureId && value.procedureId !== selectedId) throw new Error('Choose the draft for this exact original procedure.');
      saveOperatingPlanRevision(loaded.record.plan, received);
      if (value.expectedSha256 && value.expectedSha256 !== loaded.recordSha256)
        throw new Error('The original record changed. Preserve this draft and compare its full content with the saved current record before making a new revision.');
      draft = clone(received); markDraft(); editorVersion++; renderedEditor = null;
    });
  });
  $('draft-download').addEventListener('click', () => {
    if (draft) saveDownload(json({ procedureId: selectedId, expectedSha256: loaded.recordSha256, draft }), 'runtime-procedure-draft.json');
  });
  function reset() {
    epoch++; state = null; selectedId = null; loaded = null; draft = null; dirty = false; busy = null;
    loading = false; selectRequest(null); pendingDraft = null; incoming = null; selectedStep = null; renderedRecord = null;
    selection = emptySelection(); sourceSignature = null; editorVersion++; renderedEditor = null;
    $('incoming').replaceChildren(); $('incoming').hidden = true; $('storage').value = '';
    $('request-history-list').replaceChildren(); $('request-history-list').hidden = true;
    $('receive-file').value = ''; $('return').reset(); render();
  }
  return { refresh, reset, choose };
}


function buildContentEditor(host, draft, { onChange, locked, run, selectStep }) {
  const content = draft.content;
  const change = () => onChange(draft);
  function field(label, value, setter, { multiline = false, type = 'text', maximum } = {}) {
    const wrapper = el('label', label), input = el(multiline ? 'textarea' : 'input');
    if (multiline) { input.rows = 3; input.spellcheck = true; } else input.type = type;
    input.value = value ?? ''; input.disabled = locked;
    if (maximum) input.maxLength = maximum;
    input.addEventListener('input', () => { setter(input.value); change(); });
    wrapper.append(input); return wrapper;
  }
  host.replaceChildren();
  host.append(field('Procedure title', content.title, value => content.title = value),
    field('Customer or team', content.customer, value => content.customer = value),
    field('Owner', content.owner, value => content.owner = value),
    field('Useful result', content.purpose, value => content.purpose = value, { multiline: true }),
    field('Recurrence or trigger', content.period, value => content.period = value),
    field('Receiving instructions', content.receiving, value => content.receiving = value, { multiline: true }),
    field('Notes', content.notes, value => content.notes = value, { multiline: true }));
  const list = el('div', undefined, 'operation-list');
  for (const [index, step] of content.steps.entries()) {
    const card = el('article', undefined, 'operation'), heading = el('div', undefined, 'section-title');
    heading.append(el('h4', (index + 1) + '. ' + (step.title || 'Untitled step')), el('span', step.status, 'status'));
    card.append(heading, el('p', 'Original step: ' + step.id, 'note'));
    for (const [key, label, multiline] of [
      ['title', 'Step title'], ['instruction', 'Instructions', true], ['inputs', 'Exact inputs', true],
      ['expectedResult', 'Expected complete output', true], ['owner', 'Step owner'], ['due', 'Due date (YYYY-MM-DD)'],
      ['recordedResult', 'Operator-written result', true],
    ]) card.append(field(label, step[key], value => step[key] = value, { multiline, type: key === 'due' ? 'date' : 'text' }));
    const stateLabel = el('label', 'Operator assessment'), state = el('select');
    for (const value of ['planned', 'in-progress', 'completed', 'skipped']) state.append(new Option(value.replaceAll('-', ' '), value));
    state.value = step.status; state.disabled = locked;
    state.addEventListener('change', () => { step.status = state.value; change(); });
    stateLabel.append(state); card.append(stateLabel);
    const actions = el('div', undefined, 'actions');
    actions.append(button('Select for observation', () => selectStep(step.id), locked),
      button('Move up', () => { if (locked || index === 0) return; content.steps.splice(index, 1); content.steps.splice(index - 1, 0, step); change(); buildContentEditor(host, draft, { onChange, locked, run, selectStep }); }, locked || index === 0),
      button('Move down', () => { if (locked || index === content.steps.length - 1) return; content.steps.splice(index, 1); content.steps.splice(index + 1, 0, step); change(); buildContentEditor(host, draft, { onChange, locked, run, selectStep }); }, locked || index === content.steps.length - 1),
      button('Remove from this draft', () => { if (locked) return; content.steps.splice(index, 1); change(); buildContentEditor(host, draft, { onChange, locked, run, selectStep }); }, locked));
    card.append(actions);
    if (step.selection || step.argv?.length) card.append(detail('Retained command and registration', {
      argv: step.argv, selection: step.selection,
      instruction: 'The retained command is shown for review. Use its existing product control to run it.',
    }));
    const fileList = el('div');
    for (const file of step.files ?? []) {
      const row = el('div', undefined, 'panel');
      row.append(el('p', file.name + ' · ' + file.bytes.toLocaleString() + ' bytes · ' + file.mediaType),
        el('p', file.note || '', 'note'),
        button('Download original file', () => {
          saveDownload(operatingFileBytes(file), file.name, file.mediaType);
        }, locked),
        button('Remove file from this draft', () => { if (locked) return; step.files = step.files.filter(item => item.id !== file.id); change(); buildContentEditor(host, draft, { onChange, locked, run, selectStep }); }, locked));
      fileList.append(row);
    }
    const fileLabel = el('label', 'Carry a complete original deliverable file'), files = el('input');
    files.type = 'file'; files.multiple = true; files.disabled = locked;
    files.addEventListener('change', () => {
      const selected = [...files.files]; files.value = '';
      run(async current => {
        const additions = [];
        for (const file of selected) {
          if (file.size > OPERATING_FILE_MAX_BYTES) throw new Error('A carried file exceeds the original 24 MiB limit. Use its native archive transfer and retain an explicit source reference.');
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (!current()) return;
          additions.push(createOperatingFile({ id: crypto.randomUUID(), name: file.name, bytes,
            mediaType: file.type || 'application/octet-stream', note: '' }));
        }
        if (!current()) return;
        step.files = [...(step.files ?? []), ...additions]; change();
        buildContentEditor(host, draft, { onChange, locked, run, selectStep });
      });
    });
    fileLabel.append(files); card.append(fileList, fileLabel); list.append(card);
  }
  host.append(list, button('Add operating step', () => {
    if (locked) return;
    content.steps.push(createOperatingStep({ id: crypto.randomUUID(), title: 'New operating step', owner: content.owner }));
    change(); buildContentEditor(host, draft, { onChange, locked, run, selectStep });
  }, locked));
}
