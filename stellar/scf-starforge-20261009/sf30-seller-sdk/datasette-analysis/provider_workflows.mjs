import {mountProviderInputs} from './provider_inputs.mjs';
/** Installed provider source desk. Uses the original workflow capability and provider CLI engines. */
const PROVIDERS = {
  'shopify-payments': {title: 'Shopify Payments', purpose: 'Complete selected payouts, their original balance transactions and retail reconciliation.'},
  'xero-contacts': {title: 'Xero contacts', purpose: 'Original contact capture, explicit mapping decisions and complete contact preparation.'},
  'odoo-target': {title: 'Odoo targets', purpose: 'Existing partner identities, complete parent relationships and actual import-result reconciliation.'}
};
const ACTIONS = {
  capture: ['Capture source', 'Read the installed account and complete selected source.'],
  inspect: ['Inspect capture', 'Read the retained original source and its complete inventory.'],
  review: ['Review Xero contacts', 'Produce the original review from the selected complete capture.'],
  compare: ['Compare Xero captures', 'Compare two retained editions of the same original contact source.'],
  prepare: ['Prepare workflow', 'Feed the original selected source into its existing preparation engine.'],
  reconcile: ['Reconcile import result', 'Compare the actual returned import result and fresh Odoo targets with the original preparation.'],
  handover: ['Prepare complete handover', 'Retain the original acquisition, preparation, source files and selected native delivery together.'],
  receive: ['Receive handover', 'Reopen the complete original handover through its existing receiver.'],
  configure: ['Prepare original analysis', 'Bind the prepared files and installation to the original business request.']
};
const STATES = {QUEUED: 'Queued', RUNNING: 'Running', COMPLETE: 'Complete', INTERRUPTED: 'Continue required', FAILED: 'Needs review'};
const TERMINAL = new Set(['COMPLETE', 'FAILED', 'INTERRUPTED']);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const pretty = x => JSON.stringify(x ?? {}, null, 2);
const bytes = n => !Number.isFinite(n) ? '' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const date = x => x ? new Date(x).toLocaleString() : '';
function node(tag, value, className) {
  const e = document.createElement(tag);
  if (value !== undefined && value !== null) e.textContent = String(value);
  if (className) e.className = className;
  return e;
}
function button(label, action, secondary = true) {
  const e = node('button', label, secondary ? 'pw-secondary' : '');
  e.type = 'button'; e.addEventListener('click', action); return e;
}
function details(label, value) {
  const e = node('details'); e.append(node('summary', label), node('pre', typeof value === 'string' ? value : pretty(value))); return e;
}
function table(headers, rows) {
  const wrap = node('div', null, 'pw-table-wrap'), t = node('table', null, 'pw-table');
  const head = t.createTHead().insertRow(), body = t.createTBody();
  for (const h of headers) head.append(node('th', h));
  for (const values of rows) { const tr = body.insertRow(); for (const value of values) {
    const td = tr.insertCell(); if (value instanceof Node) td.append(value); else td.textContent = String(value ?? '');
  }}
  wrap.append(t); return wrap;
}
function definition(values) {
  const dl = node('dl', null, 'pw-identity');
  for (const [key, value] of values) { dl.append(node('dt', key), node('dd', value ?? '')); } return dl;
}
function save(name, blob) {
  const link = node('a'); const url = URL.createObjectURL(blob);
  link.href = url; link.download = String(name).replace(/[\\/\u0000-\u001f]/g, '_');
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function saveJSON(name, value) { save(name, new Blob([pretty(value) + '\n'], {type: 'application/json'})); }
function option(value, label) { const e = node('option', label); e.value = value; return e; }
function originalId(row) { return row.id ?? row.operationId; }
function actionTitle(action) { return ACTIONS[action]?.[0] || action; }

export function mountProviderWorkflows({root, api, request, notify = () => {}, onOpenRequest = () => {}}) {
  if (!(root instanceof HTMLElement) || typeof api !== 'function' || typeof request !== 'function') throw new Error('Provider desk requires the original operator host.');
  root.classList.add('provider-workflows');
  const state = {started: false, loading: false, catalog: null, operations: [], selected: null, detail: null,
    generation: 0, tab: 'overview', draft: null, pending: null, storageKey: null, busy: new Set(), formOpen: false,
    timer: null, closed: false, query: '', filter: '', preview: null, drafts: {}, recoveries: {}, nativeRequests: []};
  const shell = node('div', null, 'pw-shell'), side = node('div', null, 'pw-sidebar'), main = node('div', null, 'pw-main');
  const sideHeading = node('div', null, 'pw-row');
  const createButton = button('New', () => openDraft()); createButton.disabled = true;
  sideHeading.append(node('h2', 'Provider sources'), createButton);
  const searchLabel = node('label', 'Find an operation'), search = node('input');
  search.type = 'search'; search.id = 'pw-operation-search'; searchLabel.htmlFor = search.id;
  search.setAttribute('aria-label', 'Find a provider operation'); search.placeholder = 'Title, account or operation ID';
  search.addEventListener('input', () => { state.query = search.value; renderList(); });
  const filter = node('select'); filter.setAttribute('aria-label', 'Filter provider operations');
  filter.append(option('', 'All providers'), ...Object.entries(PROVIDERS).map(([id, value]) => option(id, value.title)));
  filter.addEventListener('change', () => { state.filter = filter.value; renderList(); });
  const count = node('p', '', 'pw-muted pw-small'), list = node('nav', null, 'pw-list');
  list.setAttribute('aria-label', 'Retained provider operations');
  side.append(sideHeading, searchLabel, search, filter, count, list);
  const notice = node('div', null, 'pw-notice'); notice.hidden = true; notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  const pendingHost = node('section'), formHost = node('section'), detailHost = node('section'), previewHost = node('section', null, 'pw-preview');
  const inputHost = node('details', null, 'pi-host'), inputRoot = node('div');
  inputHost.append(node('summary', 'Original input files'), inputRoot);
  let inputDesk = null;
  const filesButton = button('Add or reopen an original file', () => openInputs());
  side.append(filesButton);
  main.append(notice, inputHost, pendingHost, formHost, detailHost, previewHost); shell.append(side, main); root.replaceChildren(shell);
  function openInputs() {
    inputHost.open = true;
    inputHost.scrollIntoView({block: 'start', behavior: 'auto'});
    inputRoot.querySelector('input[type=file]:not(.pw-file-input)')?.focus();
  }
  async function useInput(row) {
    const catalog = await api('/api/providers/catalog');
    if (catalog.workspaceId !== state.catalog.workspaceId) throw new Error('Reopen the original workspace before selecting this file.');
    state.catalog = catalog;
    const current = state.draft, c = connection(current?.connectionId);
    const mapping = {
      contacts: {provider: 'odoo-target', action: 'prepare', field: 'contactsInputId'},
      'native-result': {provider: 'odoo-target', action: 'reconcile', field: 'nativeResultInputId'},
      'native-delivery': {action: 'handover', field: 'nativeDeliveryInputId'},
      'provider-handover': {action: 'receive', field: 'handoverInputId'},
      handover: {action: 'receive', field: 'handoverInputId'},
      decisions: {provider: 'xero-contacts', action: 'prepare', field: 'decisions'}
    };
    const selected = mapping[row.kind];
    if (!selected || !c || selected.provider && c.provider !== selected.provider) {
      message('The complete file is retained. Choose its original installed connection and operation, then use this file.'); return;
    }
    let value = row.inputId;
    if (row.kind === 'decisions') {
      if (row.bytes > 8 * 1024 * 1024) throw new Error('This decision document exceeds the browser form limit. Download the complete original and retain its existing CLI preparation.');
      const response = await request('/api/providers/inputs/' + encodeURIComponent(row.inputId) + '/file');
      if (!response.ok) throw new Error('The original mapping decisions could not be opened.');
      const raw = await response.arrayBuffer();
      const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw))].map(x => x.toString(16).padStart(2, '0')).join('');
      if (raw.byteLength !== row.bytes || sha !== row.sha256) throw new Error('The original decision document identity changed.');
      value = new TextDecoder('utf-8', {fatal: true}).decode(raw);
      if (!object(JSON.parse(value))) throw new Error('Select the complete original decision object.');
    }
    const fields = current.action === selected.action ? {...current.fields} : {};
    fields[selected.field] = value;
    if (selected.field === 'handoverInputId') delete fields.handoverOperationId;
    if (selected.field === 'nativeDeliveryInputId') delete fields.nativeRequestId;
    if (current.action !== selected.action || state.pending?.body?.operationId === current.operationId)
      openDraft(c.id, selected.action, fields, true);
    else { current.fields = fields; updateDraft(); state.formOpen = true; renderForm(); }
    inputHost.open = false;
    formHost.scrollIntoView({block: 'start', behavior: 'auto'});
    message(row.fileName + ' selected in the retained original operation draft. Review the remaining source selections before submitting.');
  }
  function message(text, error = false) {
    notice.hidden = false; notice.textContent = text; notice.dataset.error = String(error); notify(text, error);
  }
  function persist() {
    if (!state.storageKey) return;
    try { localStorage.setItem(state.storageKey, JSON.stringify({schema: 'stellar-forge.provider-workflow-browser-draft.v1',
      workspaceId: state.catalog.workspaceId, draft: state.draft, pending: state.pending, drafts: state.drafts, recoveries: state.recoveries})); }
    catch { message('This browser could not retain the working selection. Download the draft before closing this page.', true); }
  }
  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(state.storageKey) || 'null');
      if (saved?.schema === 'stellar-forge.provider-workflow-browser-draft.v1' && saved.workspaceId === state.catalog.workspaceId) {
        state.draft = object(saved.draft) ? saved.draft : null;
        state.drafts = object(saved.drafts) ? saved.drafts : {};
        state.recoveries = object(saved.recoveries) ? saved.recoveries : {};
        state.pending = object(saved.pending) && object(saved.pending.body) ? saved.pending : null;
      }
    } catch { message('A saved browser draft could not be read. The original server operations remain available.', true); }
  }
  async function call(path, body) {
    const response = await request(path, {method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})});
    let value;
    try { value = await response.json(); } catch { throw new Error('The operator returned an unreadable response. Reconcile this original request before continuing.'); }
    if (!response.ok) { const e = new Error(value.message || value.error || 'The original provider operation could not be read.');
      e.status = response.status; e.code = value.code || value.error; throw e; }
    return value;
  }
  const route = id => '/api/providers/operations/' + encodeURIComponent(id);
  function connection(id) { return (state.catalog?.connections || []).find(c => c.id === id); }
  function actionsFor(c) { return (c?.actions || state.catalog?.actions?.[c?.provider] || []).map(x => typeof x === 'string' ? x : x.id); }
  function opLabel(op) {
    const c = connection(op.connectionId);
    return (op.title || actionTitle(op.action)) + ' · ' + (c?.title || op.connectionId || op.provider) + ' · ' + originalId(op);
  }
  function renderList() {
    list.replaceChildren();
    const q = state.query.trim().toLowerCase();
    const rows = state.operations.filter(op => (!state.filter || op.provider === state.filter) &&
      (!q || (opLabel(op) + ' ' + op.status).toLowerCase().includes(q)));
    count.textContent = rows.length + ' shown · ' + state.operations.length + ' retained';
    for (const row of rows) {
      const id = originalId(row), item = button('', () => select(id)); item.className = 'pw-card';
      item.setAttribute('aria-current', String(id === state.selected));
      item.append(node('strong', row.title || actionTitle(row.action)),
        node('span', (connection(row.connectionId)?.title || row.connectionId) + ' · ' + (STATES[row.status] || row.status)),
        node('span', date(row.updatedAt || row.createdAt)), node('span', id));
      list.append(item);
    }
    if (!rows.length) list.append(node('p', 'Operations matching this selection appear here.', 'pw-muted'));
  }
  function renderEmpty() {
    detailHost.replaceChildren();
    const panel = node('div', null, 'pw-empty');
    panel.append(node('h2', 'Acquire, prepare and receive the original source'));
    panel.append(node('p', 'Use an installed provider connection to retain its source, prepare the existing customer workflow and transfer the complete result.'));
    const stages = node('ol', null, 'pw-stage-list');
    for (const value of ['Select the installed account and original source scope.',
      'Capture and inspect its complete retained observations.',
      'Prepare or reconcile through the existing provider engine.',
      'Receive the complete handover or run the original configured Analysis request.']) stages.append(node('li', value));
    panel.append(stages);
    if (!state.catalog?.configured || !(state.catalog.connections || []).length) {
      panel.append(node('p', 'This operator has no provider connections configured. Open the selected installation with its original providers descriptor to use this desk.', 'pw-muted'));
    } else panel.append(button(state.draft ? 'Continue browser draft' : 'Prepare an operation', () => openDraft(), false));
    detailHost.append(panel);
  }
  function renderPending() {
    pendingHost.replaceChildren(); if (!state.pending) return;
    const p = state.pending, panel = node('div', null, 'pw-panel');
    panel.append(node('h3', 'Original submission awaiting reconciliation'),
      node('p', 'This exact request is retained in this browser. Read its current server record or continue the same request ID.'));
    panel.append(definition([['Operation', p.body.operationId], ['Action', actionTitle(p.body.action)],
      ['Connection', p.body.connectionId], ['Saved', date(p.createdAt)]]));
    const controls = node('div', null, 'pw-actions');
    controls.append(button('Read original operation', () => reconcilePending()),
      button('Continue same request', () => dispatch(p.body), false),
      button('Download original request', () => saveJSON('Provider_Request_' + p.body.operationId + '.json', p.body)));
    for (const child of controls.children) child.disabled = state.busy.has('submit');
    panel.append(controls, details('Exact retained request', p.body)); pendingHost.append(panel);
  }
  async function reconcilePending() {
    if (!state.pending) return;
    try {
      const body = state.pending.body, op = await call(route(body.operationId));
      checkRelation(op, body); state.pending = null;
      if (state.draft?.operationId === body.operationId) { state.drafts[state.draft.operationId] = state.draft; state.draft = null; }
      persist(); renderPending();
      state.formOpen = false; formHost.replaceChildren(); await refresh(); await select(originalId(op));
      message('The original provider operation is retained on the server.');
    } catch (e) { message(e.status === 404 ? 'The original request has not been found. Continue the same saved request to submit it.' : e.message, e.status !== 404); }
  }
  function checkRelation(op, body) {
    const stable = x => Array.isArray(x) ? x.map(stable) : object(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])])) : x;
    const canonical = value => {
      const result = {...value, inputs: value.inputs || {}}; delete result.recoverLockId; return stable(result);
    };
    if (!object(op.submission) || originalId(op) !== body.operationId || op.connectionId !== body.connectionId ||
      op.action !== body.action || JSON.stringify(stable(op.inputs || {})) !== JSON.stringify(stable(body.inputs || {})) ||
      JSON.stringify(canonical(op.submission)) !== JSON.stringify(canonical(body)))
      throw new Error('The returned operation does not match this exact retained submission.');
  }
  async function dispatch(body) {
    if (state.busy.has('submit')) return;
    if (state.pending) {
      const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ?
        Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
      const submission = value => { const copy = {...value}; delete copy.recoverLockId; return JSON.stringify(canonical(copy)); };
      if (state.pending.body.operationId !== body.operationId) {
        message('Read or continue the retained pending request before submitting another operation. Your new draft remains saved.', true); return;
      }
      if (submission(state.pending.body) !== submission(body)) {
        message('This changes the original pending request. Read or continue its exact original body, then use Start a new operation for changed inputs.', true); return;
      }
    }
    state.pending = {body: JSON.parse(JSON.stringify(body)), createdAt: state.pending?.createdAt || new Date().toISOString()};
    persist(); state.busy.add('submit'); renderPending();
    try {
      const result = await call('/api/providers/operations', state.pending.body); checkRelation(result, body);
      state.pending = null;
      if (state.draft?.operationId === body.operationId) { state.drafts[state.draft.operationId] = state.draft; state.draft = null; }
      persist(); state.formOpen = false; formHost.replaceChildren();
      await refresh(); await select(originalId(result)); message('The original provider request is retained. Its source and progress appear below.');
    } catch (e) { message(e.message, true); }
    finally { state.busy.delete('submit'); renderPending(); }
  }
  function newDraft(c, action, seed = {}) {
    return {operationId: crypto.randomUUID(), connectionId: c?.id || '', action: action || actionsFor(c)[0] || '',
      title: '', fields: {...seed}, updatedAt: new Date().toISOString()};
  }
  function openDraft(cId, action, seed, force = false) {
    if (force || !state.draft) {
      if (force && state.draft) state.drafts[state.draft.operationId] = JSON.parse(JSON.stringify(state.draft));
      const c = connection(cId) || state.catalog.connections?.[0]; state.draft = newDraft(c, action, seed);
    }
    state.formOpen = true; state.preview = null; previewHost.replaceChildren(); persist(); renderForm();
    formHost.scrollIntoView({block: 'start', behavior: 'auto'});
  }
  function draftDocument() {
    return {schema: 'stellar-forge.provider-workflow-browser-draft.v1', workspaceId: state.catalog.workspaceId,
      draft: state.draft};
  }
  function updateDraft() { state.draft.updatedAt = new Date().toISOString(); persist(); }
  function labeled(container, label, control, help) {
    const wrap = node('label', label); const id = 'pw-' + crypto.randomUUID();
    wrap.htmlFor = id; control.id = id; control.setAttribute('aria-label', label); wrap.append(control);
    if (help) wrap.append(node('p', help, 'pw-field-help')); container.append(wrap); return control;
  }
  function selectField(container, key, label, choices, help, required = true) {
    const input = node('select'); input.append(option('', required ? 'Select an original record' : 'None selected'));
    for (const item of choices) input.append(option(item.id, item.label));
    input.value = state.draft.fields[key] || '';
    if (state.draft.fields[key] && !choices.some(x => x.id === state.draft.fields[key])) {
      input.append(option(state.draft.fields[key], 'Retained selection · ' + state.draft.fields[key])); input.value = state.draft.fields[key];
    }
    input.required = required; input.addEventListener('change', () => { state.draft.fields[key] = input.value; updateDraft(); });
    return labeled(container, label, input, help);
  }
  function operationChoices(provider, actions, acrossConnections = false) {
    return state.operations.filter(op => op.provider === provider && op.status === 'COMPLETE' && actions.includes(op.action) &&
      (acrossConnections || op.connectionId === state.draft?.connectionId))
      .sort((a, b) => Number(b.connectionId === state.draft?.connectionId) - Number(a.connectionId === state.draft?.connectionId))
      .map(op => ({id: originalId(op), label: opLabel(op)}));
  }
  function inputChoices(kind) {
    const kinds = Array.isArray(kind) ? kind : [kind];
    const inputs = state.catalog.inputs || [], known = inputs.filter(i => kinds.includes(i.kind));
    return known.map(i => ({id: i.id, label: (i.title || i.id) + ' · ' + i.kind +
      (Number.isFinite(i.bytes) ? ' · ' + bytes(i.bytes) : '') + (i.available === false ? ' · unavailable' : '')}));
  }
  function jsonField(container, key, label, help) {
    const input = node('textarea'); input.spellcheck = false; input.rows = 9; input.value = state.draft.fields[key] || '{}';
    input.addEventListener('input', () => { state.draft.fields[key] = input.value; updateDraft(); });
    labeled(container, label, input, help);
    const pick = node('input'); pick.type = 'file'; pick.accept = '.json,application/json'; pick.className = 'pw-file-input';
    const importButton = button('Load original JSON file', () => pick.click());
    pick.addEventListener('change', async () => {
      const file = pick.files?.[0]; if (!file) return;
      try {
        const raw = await file.text(), value = JSON.parse(raw);
        if (!object(value)) throw new Error('Select an original JSON object.');
        input.value = raw; state.draft.fields[key] = raw; updateDraft(); message(file.name + ' loaded into the retained draft.');
      } catch (e) { message(e.message, true); } finally { pick.value = ''; }
    });
    container.append(importButton, pick);
  }
  function renderForm() {
    formHost.replaceChildren(); if (!state.formOpen || !state.draft) return;
    const d = state.draft, c = connection(d.connectionId);
    const form = node('form', null, 'pw-form'), heading = node('div', null, 'pw-heading');
    heading.append(node('h2', 'Prepare a provider operation'), button('Close draft', () => { state.formOpen = false; formHost.replaceChildren(); }));
    form.append(heading, node('p', 'The installed connection supplies its original account, source scope and credential reference. This draft records the selected operation and original inputs.', 'pw-muted'));
    const grid = node('div', null, 'pw-grid'), connectionSelect = node('select');
    connectionSelect.append(option('', 'Select an installed connection'), ...(state.catalog.connections || []).map(x => option(x.id, x.title || x.id)));
    connectionSelect.value = d.connectionId; connectionSelect.required = true;
    connectionSelect.addEventListener('change', () => {
      d.connectionId = connectionSelect.value; d.action = actionsFor(connection(d.connectionId))[0] || '';
      d.fields = {}; updateDraft(); renderForm();
    });
    labeled(grid, 'Installed connection', connectionSelect);
    const action = node('select'); action.append(...actionsFor(c).map(x => option(x, actionTitle(x))));
    action.value = d.action; action.required = true;
    action.addEventListener('change', () => { d.action = action.value; d.fields = {}; updateDraft(); renderForm(); });
    labeled(grid, 'Operation', action);
    const title = node('input'); title.value = d.title || ''; title.maxLength = 200; title.placeholder = 'Useful title for this original operation';
    title.addEventListener('input', () => { d.title = title.value; updateDraft(); });
    labeled(grid, 'Operator title', title);
    const id = node('input'); id.value = d.operationId; id.readOnly = true;
    labeled(grid, 'Original provider operation ID', id, 'This same ID is retained when a reply is interrupted.');
    form.append(grid);
    if (c) {
      form.append(node('p', PROVIDERS[c.provider]?.purpose || c.provider, 'pw-muted'));
      form.append(definition([['Credential reference', c.credential?.reference || 'No reference configured'],
        ['Availability', c.credential?.available ? 'Available to the installed operator' : 'Unavailable for a new provider read']]));
      form.append(details('Selected account and original source scope', c.selection));
    }
    form.append(node('p', ACTIONS[d.action]?.[1] || '', 'pw-muted'));
    const fields = node('div', null, 'pw-grid'), provider = c?.provider, captures = operationChoices(provider, ['capture', 'receive'], d.action === 'compare'),
      preparations = operationChoices(provider, ['prepare', 'reconcile', 'receive', 'configure']),
      baselines = operationChoices(provider, ['prepare', 'reconcile', 'receive', 'configure']);
    const capture = () => selectField(fields, 'captureOperationId', 'Original complete capture', captures,
      'Choose the complete retained source; its provider engine checks the original source relation.',
      !(d.action === 'handover' && provider === 'xero-contacts'));
    if (['inspect', 'review', 'prepare', 'reconcile', 'handover'].includes(d.action)) capture();
    if (d.action === 'compare') {
      selectField(fields, 'beforeOperationId', 'Earlier Xero capture', captures);
      selectField(fields, 'afterOperationId', 'Later Xero capture', captures);
    }
    if (d.action === 'prepare') {
      if (provider === 'odoo-target') selectField(fields, 'contactsInputId', 'Original contact input', inputChoices('contacts'));
      if (provider === 'xero-contacts') {
        const box = node('div', null, 'pw-wide');
        jsonField(box, 'decisions', 'Original Xero review and mapping decisions',
          'Load and review the original decision document. Every mapping remains part of the full source delivery.'); fields.append(box);
      }
    }
    if (d.action === 'reconcile') {
      selectField(fields, 'baselineOperationId', 'Original baseline preparation', baselines);
      selectField(fields, 'nativeResultInputId', 'Actual returned import result', inputChoices('native-result'),
        'This is the original importer result retained by the installed host.');
    }
    if (['prepare', 'reconcile', 'configure'].includes(d.action)) {
      selectField(fields, 'installationId', 'Original Analysis installation',
        (state.catalog.installations || []).map(i => ({id: i.id, label: (i.title || i.id) + (i.available ? '' : ' · unavailable')})),
        'Select the original installed source and Analysis workspace.', d.action === 'configure');
    }
    if (['handover', 'configure'].includes(d.action)) selectField(fields, 'preparedOperationId', 'Complete original preparation',
      d.action === 'configure' ? operationChoices(provider, ['prepare', 'reconcile', 'receive', 'configure']) : preparations);
    if (d.action === 'handover') {
      if (provider === 'odoo-target') selectField(fields, 'baselineOperationId', 'Earlier baseline preparation', baselines,
        'Select the baseline when this delivery includes an after-capture and reconciliation.', false);
      selectField(fields, 'nativeRequestId', 'Completed original Analysis request',
        state.nativeRequests.filter(r => r.resultSha256).map(r => ({id: r.requestId,
          label: r.requestId + ' · ' + (r.profile || '') + ' · ' + (r.status || '')})),
        'The existing workflow exports this complete native result directly. Select either this request or an existing archive below.', false);
      selectField(fields, 'nativeDeliveryInputId', 'Existing original native archive', inputChoices('native-delivery'),
        'Use this alternative only when no completed Analysis request is selected. Original archive bytes remain unchanged.', false);
    }
    if (d.action === 'receive') {
      selectField(fields, 'handoverOperationId', 'Retained handover operation',
        operationChoices(provider, ['handover']), 'Select either an original operation here or a complete uploaded or configured handover file below.', false);
      selectField(fields, 'handoverInputId', 'Complete handover file from another operator',
        inputChoices(['provider-handover', 'handover']), 'Upload the original downloaded bundle in Original input files or select a configured file. Its existing receiver verifies and restores the complete source.', false);
    }
    if (d.action === 'configure') {
      const box = node('div', null, 'pw-wide'); jsonField(box, 'request', 'Original business request',
        'Use the complete existing request, profile, correlation and parameters. Its source is bound to this preparation.'); fields.append(box);
    }
    form.append(fields, button('Add or reopen an original file', () => openInputs()));
    const controls = node('div', null, 'pw-actions'), submit = node('button', actionTitle(d.action));
    submit.type = 'submit'; submit.disabled = !c || !d.action || state.busy.has('submit') ||
      (d.action === 'capture' && !c.credential?.available);
    controls.append(submit, button('Download browser draft', () => saveJSON('Provider_Draft_' + d.operationId + '.json', draftDocument())),
      button('Import browser draft', () => draftInput.click()),
      button('Start a new operation', () => openDraft(d.connectionId, d.action, {}, true)));
    const draftInput = node('input'); draftInput.type = 'file'; draftInput.accept = '.json,application/json'; draftInput.className = 'pw-file-input';
    draftInput.addEventListener('change', async () => {
      const file = draftInput.files?.[0]; if (!file) return;
      try {
        const value = JSON.parse(await file.text());
        if (value.schema !== 'stellar-forge.provider-workflow-browser-draft.v1' || value.workspaceId !== state.catalog.workspaceId ||
          !object(value.draft) || !connection(value.draft.connectionId) || !object(value.draft.fields))
          throw new Error('Select a retained provider draft for this original workspace and installed connection.');
        if (!actionsFor(connection(value.draft.connectionId)).includes(value.draft.action) || typeof value.draft.operationId !== 'string' || !value.draft.operationId)
          throw new Error('The draft does not select a supported original operation.');
        if (state.pending && value.draft.operationId === state.pending.body.operationId)
          throw new Error('Reconcile the retained pending submission before changing this operation.');
        state.draft = value.draft; updateDraft(); renderForm(); message('The complete browser draft is restored.');
      } catch (e) { message(e.message, true); }
    });
    const priorDrafts = Object.values(state.drafts).filter(x => object(x) && x.operationId !== d.operationId);
    if (priorDrafts.length) {
      const picker = node('select'); picker.append(option('', 'Select an earlier browser draft'));
      for (const prior of priorDrafts) picker.append(option(prior.operationId, (prior.title || actionTitle(prior.action)) + ' · ' + prior.operationId));
      picker.addEventListener('change', () => {
        const prior = state.drafts[picker.value]; if (!prior) return;
        state.drafts[d.operationId] = JSON.parse(JSON.stringify(d)); state.draft = JSON.parse(JSON.stringify(prior));
        updateDraft(); renderForm();
      });
      labeled(form, 'Earlier browser drafts', picker, 'Earlier submitted IDs retain their original request; use Start a new operation for changed inputs.');
    }
    form.append(controls, draftInput, node('p', 'The draft stays in this browser and is scoped to the original workflow workspace. Download it to move the selection to another browser on that workspace.', 'pw-muted pw-small'));
    form.addEventListener('submit', event => {
      event.preventDefault();
      try {
        const body = bodyFromDraft();
        if (state.pending && JSON.stringify(state.pending.body) !== JSON.stringify(body))
          throw new Error('Reconcile the original pending submission above before starting another operation.');
        dispatch(body);
      } catch (e) { message(e.message, true); }
    });
    formHost.append(form);
  }
  function bodyFromDraft() {
    const d = state.draft, c = connection(d.connectionId);
    if (!c || !actionsFor(c).includes(d.action)) throw new Error('Select an installed connection and supported operation.');
    const fields = d.fields || {}, inputs = {};
    const include = (key, required = false) => {
      const value = fields[key];
      if (value !== undefined && value !== '') inputs[key] = value;
      else if (required) throw new Error('Select ' + key + ' from the original records.');
    };
    if (['inspect', 'review', 'prepare', 'reconcile', 'handover'].includes(d.action))
      include('captureOperationId', !(d.action === 'handover' && c.provider === 'xero-contacts'));
    if (d.action === 'compare') { include('beforeOperationId', true); include('afterOperationId', true); }
    if (d.action === 'prepare' && c.provider === 'odoo-target') include('contactsInputId', true);
    if (d.action === 'prepare' && c.provider === 'xero-contacts') inputs.decisions = readObject(fields.decisions, 'Original Xero decisions');
    if (d.action === 'reconcile') { include('baselineOperationId', true); include('nativeResultInputId', true); }
    if (['prepare', 'reconcile', 'configure'].includes(d.action)) include('installationId', d.action === 'configure');
    if (['handover', 'configure'].includes(d.action)) include('preparedOperationId', true);
    if (d.action === 'handover') {
      include('baselineOperationId'); include('nativeDeliveryInputId'); include('nativeRequestId');
      if (inputs.nativeDeliveryInputId && inputs.nativeRequestId) throw new Error('Select one native delivery: a completed Analysis request or an existing original archive.');
    }
    if (d.action === 'receive') {
      include('handoverOperationId'); include('handoverInputId');
      if (Boolean(inputs.handoverOperationId) === Boolean(inputs.handoverInputId))
        throw new Error('Select exactly one original handover: a retained operation or a complete supplied file.');
    }
    if (d.action === 'configure') inputs.request = readObject(fields.request, 'Original business request');
    return {operationId: d.operationId, connectionId: c.id, action: d.action, inputs,
      title: d.title.trim() || (c.title || c.id) + ' · ' + actionTitle(d.action)};
  }
  function readObject(raw, label) {
    let value; try { value = JSON.parse(raw || '{}'); } catch { throw new Error(label + ' must be complete JSON.'); }
    if (!object(value) || !Object.keys(value).length) throw new Error(label + ' must be the original nonempty JSON object.'); return value;
  }
  async function select(id) {
    state.selected = id; state.detail = null; state.generation++; state.preview = null; previewHost.replaceChildren(); renderList();
    try { await refreshDetail(); } catch (e) { message(e.message, true); }
  }
  async function refreshDetail() {
    const id = state.selected, generation = state.generation; if (!id) return;
    const detail = await call(route(id));
    if (state.selected === id && state.generation === generation) {
      const changed = JSON.stringify(state.detail) !== JSON.stringify(detail); state.detail = detail; if (changed) renderDetail();
    }
  }
  function chooseNext(op, action, fields) {
    openDraft(op.connectionId, action, fields, true);
  }
  function renderDetail() {
    const op = state.detail; if (!op) return renderEmpty();
    detailHost.replaceChildren();
    const heading = node('div', null, 'pw-heading');
    const title = node('div'); title.append(node('h2', op.title || actionTitle(op.action)),
      node('p', (connection(op.connectionId)?.title || op.connectionId) + ' · ' + actionTitle(op.action), 'pw-muted'));
    heading.append(title, node('span', STATES[op.status] || op.status, 'pw-status')); detailHost.append(heading);
    detailHost.append(definition([['Operation', originalId(op)], ['Created', date(op.createdAt)], ['Updated', date(op.updatedAt)]]));
    if (op.error) { const error = node('div', null, 'pw-notice'); error.dataset.error = 'true';
      error.append(node('strong', op.error.message || op.error.code || 'The original operation needs review.'), details('Original error', op.error)); detailHost.append(error); }
    const controls = node('div', null, 'pw-actions');
    controls.append(button('Refresh original operation', () => refresh(false)),
      button('Download complete operation record', () => saveJSON('Provider_Operation_' + originalId(op) + '.json', op)));
    if (['INTERRUPTED', 'FAILED'].includes(op.status)) {
      const recovery = node('details'); recovery.append(node('summary', 'Original lock recovery'));
      const input = node('input'); input.value = state.recoveries[originalId(op)] || ''; input.autocomplete = 'off';
      input.addEventListener('input', () => { state.recoveries[originalId(op)] = input.value; persist(); });
      labeled(recovery, 'Reconciled original lock owner ID', input,
        'If the retained original operation asks for a lock owner ID, reconcile that process first and enter its exact returned ID. Leave this empty for ordinary continuation.');
      if (op.recovery) recovery.append(details('Observed original lock owner', op.recovery));
      detailHost.append(recovery);
      controls.append(button('Continue original operation', () => resume(op), false));
    }
    if (op.status === 'COMPLETE') {
      const available = actionsFor(connection(op.connectionId));
      const add = (action, fields) => { if (available.includes(action)) controls.append(button(actionTitle(action), () => chooseNext(op, action, fields))); };
      if (op.action === 'capture') { add('inspect', {captureOperationId: originalId(op)}); add(op.provider === 'xero-contacts' ? 'review' : 'prepare', {captureOperationId: originalId(op)}); }
      if (op.action === 'review') add('prepare', {captureOperationId: op.inputs.captureOperationId});
      if (['prepare', 'reconcile'].includes(op.action)) {
        add('handover', {captureOperationId: op.inputs.captureOperationId, preparedOperationId: originalId(op),
          ...(op.action === 'reconcile' ? {baselineOperationId: op.inputs.baselineOperationId} : {})});
        add('configure', {preparedOperationId: originalId(op), installationId: op.inputs.installationId || ''});
      }
      if (op.action === 'handover') add('receive', {handoverOperationId: originalId(op)});
      if (op.action === 'receive') {
        add('inspect', {captureOperationId: originalId(op)});
        add('prepare', {captureOperationId: originalId(op)});
        add('handover', {captureOperationId: originalId(op), preparedOperationId: originalId(op)});
        add('configure', {preparedOperationId: originalId(op)});
      }
      if (op.action === 'configure' && op.preparedOperation) {
        const run = button('Run original Analysis request', () => runAnalysis(op), false); run.disabled = state.busy.has('analysis:' + originalId(op)); controls.append(run);
      }
    }
    detailHost.append(controls);
    const tabs = node('div', null, 'pw-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Provider operation');
    for (const [key, label] of [['overview', 'Source and result'], ['files', 'Complete files'], ['history', 'Attempts and history']]) {
      const tab = button(label, () => { state.tab = key; renderDetail(); detailHost.querySelector('[data-provider-tab="' + key + '"]')?.focus(); }); tab.setAttribute('role', 'tab');
      tab.id = 'pw-tab-' + key; tab.tabIndex = state.tab === key ? 0 : -1; tab.setAttribute('aria-controls', 'pw-detail-panel');
      tab.addEventListener('keydown', event => {
        const order = ['overview', 'files', 'history']; let at = order.indexOf(state.tab);
        if (event.key === 'ArrowRight') at = (at + 1) % order.length;
        else if (event.key === 'ArrowLeft') at = (at + order.length - 1) % order.length;
        else if (event.key === 'Home') at = 0; else if (event.key === 'End') at = order.length - 1; else return;
        event.preventDefault(); state.tab = order[at]; renderDetail();
        detailHost.querySelector('[data-provider-tab="' + state.tab + '"]')?.focus();
      });
      tab.setAttribute('aria-selected', String(state.tab === key)); tab.dataset.providerTab = key; tabs.append(tab);
    }
    detailHost.append(tabs); const panel = node('section'); panel.id = 'pw-detail-panel'; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', 'pw-tab-' + state.tab);
    panel.setAttribute('aria-label', state.tab === 'files' ? 'Complete files' : state.tab === 'history' ? 'Attempts and history' : 'Source and result');
    if (state.tab === 'overview') {
      const c = connection(op.connectionId);
      panel.append(node('h3', 'Original selected inputs'), details('Complete input relation', op.inputs));
      if (c) panel.append(details('Installed source scope', c.selection));
      if (op.preparedOperation) {
        panel.append(node('h3', 'Prepared original Analysis request'), definition([
          ['Request', op.preparedOperation.requestId || 'See the original prepared record'],
          ['Configuration', op.preparedOperation.configurationArtifactId || op.preparedOperation.configurationId || 'Retained original configuration'],
          ['Source', op.preparedOperation.sourceIdentity ? pretty(op.preparedOperation.sourceIdentity) : 'Complete prepared files']]),
          details('Complete native binding', op.preparedOperation));
      }
      if (op.nativeReceiving) {
        const received = op.nativeReceiving;
        panel.append(node('h3', 'Received original workspace'),
          node('p', 'Open these retained directories with the existing installed Source workflows and Analysis applications. The original receiving result below retains their request and source identities.', 'pw-muted'));
        const identities = [
          ['Request', received.requestId || received.result?.requestId || 'See the original receiving record'],
          ['Workflow workspace', received.workflowDirectory || 'See the original receiving record'],
          ['Analysis workspace', received.analysisDirectory || 'See the original receiving record']
        ];
        panel.append(definition(identities), details('Complete original receiving result', received));
        const receiveControls = node('div', null, 'pw-actions');
        for (const [key, label] of [['workflowDirectory', 'Copy Workflow directory'], ['analysisDirectory', 'Copy Analysis directory']]) {
          if (typeof received[key] === 'string' && received[key])
            receiveControls.append(button(label, async () => {
              try { await navigator.clipboard.writeText(received[key]); message('The exact received directory is copied.'); }
              catch { message('Select the directory text above or download the complete receiving record.', true); }
            }));
        }
        receiveControls.append(button('Download original receiving record',
          () => saveJSON('Provider_Receiving_' + originalId(op) + '.json', received)));
        panel.append(receiveControls);
      }
      if (op.result !== undefined && op.result !== null) panel.append(node('h3', 'Original provider outcome'), node('pre', pretty(op.result)));
      else panel.append(node('p', op.status === 'RUNNING' || op.status === 'QUEUED' ? 'The original operation is active. Retained attempts and available files update here.' : 'The original outcome will appear when the provider engine completes.', 'pw-muted'));
    } else if (state.tab === 'files') renderFiles(panel, op);
    else {
      panel.append(node('h3', 'Original execution attempts'));
      const attempts = op.attempts || [];
      if (attempts.length) panel.append(table(['Attempt', 'State', 'Started', 'Finished', 'Exit'], attempts.map(a => [a.id, STATES[a.status] || a.status, date(a.startedAt), date(a.finishedAt), a.exitCode ?? ''])));
      else panel.append(node('p', 'Execution attempts are retained with the original operation.', 'pw-muted'));
      panel.append(details('Full retained operation', op));
      const logs = (op.artifacts || []).filter(f => /log|stdout|stderr|progress/i.test([f.role, f.name].join(' ')));
      if (logs.length) { panel.append(node('h3', 'Retained progress and logs')); renderFiles(panel, {...op, artifacts: logs}); }
    }
    detailHost.append(panel);
  }
  async function resume(op) {
    try {
      const body = op.submission;
      if (!object(body)) throw new Error('The original submitted request is required for exact continuation. Refresh the retained operation record.');
      checkRelation(op, body);
      const recoverLockId = (state.recoveries[originalId(op)] || '').trim();
      await dispatch(recoverLockId ? {...body, recoverLockId} : body);
    } catch (e) { message(e.message, true); }
  }
  async function runAnalysis(op) {
    const key = 'analysis:' + originalId(op); if (state.busy.has(key)) return;
    state.busy.add(key); renderDetail();
    try {
      const value = await call(route(originalId(op)) + '/run', {});
      if (!value.requestId || (op.preparedOperation.requestId && value.requestId !== op.preparedOperation.requestId))
        throw new Error('The native response did not retain the prepared original business request.');
      await onOpenRequest(value.requestId);
      message(value.started ? 'The original Analysis request is running with its own prepared configuration.' : 'The original Analysis request is available with its retained outcome.');
    } catch (e) { message(e.message, true); }
    finally { state.busy.delete(key); if (state.detail?.id === originalId(op)) renderDetail(); }
  }
  function renderFiles(host, op) {
    const files = op.artifacts || [];
    if (!files.length) { host.append(node('p', 'Complete original files appear here as the provider engine retains them.', 'pw-muted')); return; }
    host.append(table(['Original file', 'Role', 'Size', 'Content identity', ''], files.map(file => {
      const controls = node('div', null, 'pw-file-actions');
      controls.append(button('Download', () => transfer(op, file, false)));
      if (file.bytes <= 2 * 1024 * 1024 && /json|text|javascript|csv|xml|log/i.test((file.contentType || '') + ' ' + (file.name || '')))
        controls.append(button('Read', () => transfer(op, file, true)));
      return [file.name, file.role || '', bytes(file.bytes), node('code', file.sha256), controls];
    })));
  }
  async function transfer(op, file, preview) {
    const key = 'file:' + originalId(op) + ':' + file.id; if (state.busy.has(key)) return;
    state.busy.add(key);
    try {
      message('Receiving ' + file.name + '…');
      const response = await request(route(originalId(op)) + '/files/' + encodeURIComponent(file.id), {method: 'GET'});
      if (!response.ok) { let value; try { value = await response.json(); } catch {} throw new Error(value?.message || value?.error || 'The retained original file could not be received.'); }
      const raw = await response.arrayBuffer();
      const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw))].map(x => x.toString(16).padStart(2, '0')).join('');
      const header = response.headers.get('X-Content-SHA256');
      if (raw.byteLength !== file.bytes || actual !== file.sha256 || (header && header !== actual))
        throw new Error('The transfer does not match the retained original file. Download that same member again.');
      if (preview) {
        const text = new TextDecoder('utf-8', {fatal: true}).decode(raw);
        previewHost.replaceChildren(node('h3', file.name), node('p', bytes(raw.byteLength) + ' · SHA-256 ' + actual, 'pw-muted'), node('pre', text),
          button('Close file view', () => previewHost.replaceChildren()));
        previewHost.scrollIntoView({block: 'start', behavior: 'auto'});
      } else save(file.name, new Blob([raw], {type: file.contentType || 'application/octet-stream'}));
      message(file.name + ' received in full with its original content identity.');
    } catch (e) { message(e.message, true); }
    finally { state.busy.delete(key); }
  }
  async function refresh(silent = true) {
    if (state.loading || state.closed) return; state.loading = true;
    try {
      const [listing, catalog] = await Promise.all([api('/api/providers/operations'), api('/api/providers/catalog')]);
      if (catalog.workspaceId !== state.catalog.workspaceId) throw new Error('The operator workspace changed; reopen its own saved provider drafts.');
      state.catalog = catalog; state.nativeRequests = Array.isArray(catalog.nativeRequests) ? catalog.nativeRequests : [];
      state.operations = Array.isArray(listing.operations) ? listing.operations : [];
      renderList(); if (state.selected) await refreshDetail(); else if (!state.formOpen) renderEmpty();
    } catch (e) { if (!silent) message(e.message, true); }
    finally { state.loading = false; }
  }
  async function start() {
    if (state.started) { await refresh(false); return; }
    state.started = true; detailHost.replaceChildren(node('p', 'Reading the original installed provider connections…', 'pw-muted'));
    try {
      state.catalog = await api('/api/providers/catalog');
      if (!state.catalog.workspaceId) state.catalog.workspaceId = (await api('/api/health')).workspaceId;
      if (!state.catalog.workspaceId) throw new Error('The original workflow workspace identity is required to retain a provider draft.');
      state.storageKey = 'source-provider-workflow:' + location.origin + ':' + state.catalog.workspaceId;
      if (!inputDesk) {
        inputDesk = mountProviderInputs({root: inputRoot, request, workspaceId: state.catalog.workspaceId,
          notify, onComplete: async () => { await refresh(false); }, onUse: useInput});
        await inputDesk.start();
      }
      restore(); createButton.disabled = !(state.catalog.connections || []).length; renderPending();
      await refresh(false); if (!state.selected) renderEmpty();
      state.timer = setInterval(() => { if (!state.closed && !document.hidden && !root.hidden) refresh(true); }, 5000);
    } catch (e) { state.started = false; createButton.disabled = true; message(e.message, true); }
  }
  return {start, refresh, show: start, destroy() { state.closed = true; clearInterval(state.timer); inputDesk?.destroy(); }};
}
