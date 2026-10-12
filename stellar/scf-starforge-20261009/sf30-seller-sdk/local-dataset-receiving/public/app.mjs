// SPDX-License-Identifier: MIT
// Complete operator extension for the original publisher and DuckDB customer.
import { publisherHost } from '/app.mjs';

(async function localDatasetCustomer() {
  if (document.getElementById('local-dataset-customer')) return;
  const API = '/api/local-customer';
  const root = document.createElement('section');
  root.id = 'local-dataset-customer';
  root.setAttribute('aria-label', 'Local dataset receiving');
  (document.querySelector('main') || document.body).append(root);
  const S = {
    status: null, workspaceId: null, selected: null, record: null, selection: 0,
    tab: 'source', source: null, sourceKey: '', prepared: new Map(),
    requests: new Map(), storage: null, storageError: null, sending: false,
    message: '', messageKind: 'info', recordsOffset: 0, recordsLimit: 25,
    mapping: new Map(), catalogs: new Map(), catalogPages: new Map(),
    views: null, viewWorkspace: null, viewDraft: {name: '', editionId: '', revision: 0, boundName: ''},
    query: {name: '', sql: '', parametersText: '[]', queryId: null, revision: 0, maxRows: 50},
    queryResult: null, comparison: {before: '', after: '', keys: '', result: null},
    exportRecords: new Map(), selectedExports: new Set(), warehouseExport: '',
    activePackage: null, packageRecords: new Map(), focusRequest: null,
    autoRequest: null, timer: null, pollBusy: false, reads: new Set(), initial: true
  };
  const tabs = [
    ['source', 'Source and deliveries'], ['mapping', 'Map and import'],
    ['views', 'Editions and views'], ['query', 'Queries and reports'], ['files', 'Files and receiving']
  ];
  const terminal = state => ['COMPLETE', 'FAILED', 'REJECTED'].includes(state);
  const plain = value => value && typeof value === 'object' && !Array.isArray(value);
  const copy = value => JSON.parse(JSON.stringify(value));
  const text = value => value == null ? '' : String(value);
  const short = value => text(value).length > 18 ? text(value).slice(0, 12) + '…' + text(value).slice(-4) : text(value);
  const bytes = value => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return text(value || '—');
    if (value < 1024) return value.toLocaleString() + ' B';
    return (value / (value >= 1048576 ? 1048576 : 1024)).toLocaleString(undefined, {maximumFractionDigits: 2}) + (value >= 1048576 ? ' MiB' : ' KiB');
  };
  const number = value => typeof value === 'number' ? value.toLocaleString() : value == null ? '—' : text(value);
  const time = value => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? text(value) : date.toLocaleString();
  };
  function node(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (['value', 'checked', 'disabled', 'selected', 'hidden', 'readOnly'].includes(key)) el[key] = value;
      else el.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat(Infinity)) {
      if (child !== null && child !== undefined && child !== false) el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }
  function button(label, action, {primary = false, disabled = false, quiet = false, id} = {}) {
    return node('button', {type: 'button', id, class: primary ? 'ldr-primary' : quiet ? 'ldr-quiet' : '',
      disabled, onclick: () => run(action)}, label);
  }
  function field(label, control, hint, wide = false) {
    return node('label', {class: 'ldr-field' + (wide ? ' ldr-wide' : '')},
      node('span', {}, label), control, hint ? node('span', {class: 'ldr-hint'}, hint) : null);
  }
  function input(id, value, change, extra = {}) {
    return node('input', {id, value: value ?? '', ...extra, oninput: event => change(event.target.value)});
  }
  function textarea(id, value, change, extra = {}) {
    return node('textarea', {id, value: value ?? '', ...extra, oninput: event => change(event.target.value)});
  }
  function select(id, options, selected, change, extra = {}) {
    const el = node('select', {id, ...extra, onchange: event => change(event.target.value)});
    for (const item of options) {
      const [value, label] = Array.isArray(item) ? item : [item, item];
      el.append(node('option', {value, selected: value === selected}, label));
    }
    el.value = selected ?? '';
    return el;
  }
  function badge(state) {
    return node('span', {class: 'ldr-status', 'data-state': text(state).toLowerCase()}, text(state || 'Not started').replaceAll('_', ' '));
  }
  function metadata(items) {
    return node('dl', {class: 'ldr-meta'}, items.map(([label, value]) =>
      node('div', {}, node('dt', {}, label), node('dd', {}, value == null ? '—' : value))));
  }
  function detail(label, value) {
    return node('details', {}, node('summary', {}, label), node('pre', {}, typeof value === 'string' ? value : JSON.stringify(value, null, 2)));
  }
  function empty(title, description, action) {
    return node('div', {class: 'ldr-empty'}, node('h3', {}, title), node('p', {}, description), action ? node('div', {class: 'ldr-actions ldr-separated'}, action) : null);
  }
  function table(headers, rows, {className = '', numeric = []} = {}) {
    return node('div', {class: 'ldr-table-wrap ' + className}, node('table', {},
      node('thead', {}, node('tr', {}, headers.map((h, i) => node('th', {scope: 'col', class: numeric.includes(i) ? 'ldr-number' : ''}, h)))),
      node('tbody', {}, rows.map(row => node('tr', {}, row.map((cell, i) => node('td', {
        class: numeric.includes(i) ? 'ldr-number' : 'ldr-cell-value'}, cell instanceof Node ? cell : node('div', {class: 'ldr-inline-value'}, cell))))))));
  }
  function cell(value) {
    if (value === null) return 'NULL';
    if (plain(value) && value.encoding === 'json-integer' && typeof value.text === 'string') return value.text;
    return typeof value === 'object' ? JSON.stringify(value, null, 2) : text(value);
  }
  function resultTable(result, caption) {
    const columns = Array.isArray(result?.columns) ? result.columns.map(c => typeof c === 'string' ? c : c.name) : [];
    const rows = Array.isArray(result?.rows) ? result.rows : Array.isArray(result?.preview) ? result.preview : [];
    const names = columns.length ? columns : plain(rows[0]) ? Object.keys(rows[0]) : [];
    if (!names.length) return detail(caption || 'Complete returned result', result);
    return node('div', {}, table(names, rows.map(row => names.map((name, i) => cell(Array.isArray(row) ? row[i] : row[name])))),
      node('p', {class: 'ldr-table-note'}, caption || (result.truncated ? 'Preview only. More rows exist; use a saved query and full export for the complete result.' : 'All rows returned by this request are shown.')),
      result.columns ? detail('Returned column types', result.columns) : null);
  }
  function notice(message, kind = 'info') {
    S.message = message; S.messageKind = kind; render();
  }
  async function run(action) {
    try { await action(); }
    catch (error) { notice(error.message || String(error), 'error'); }
  }
  function url(path, parameters = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(parameters)) if (value !== undefined && value !== null) query.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    return API + path + (query.size ? '?' + query.toString() : '');
  }
  async function api(path, body, workspace = S.workspaceId) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    const options = {method: body === undefined ? 'GET' : 'POST', cache: 'no-store', redirect: 'error',
      credentials: 'same-origin', signal: controller.signal, headers: {'Accept': 'application/json'}};
    if (workspace) options.headers['X-Local-Dataset-Workspace'] = workspace;
    if (body !== undefined) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
    try {
      const response = await fetch(path.startsWith(API) ? path : url(path), options);
      let value;
      try { value = await response.json(); } catch { throw Object.assign(new Error('The response was not complete JSON. Recover the original request before repeating an action.'), {status: response.status, uncertain: true}); }
      if (!response.ok) throw Object.assign(new Error(value.message || value.error || ('Request failed (' + response.status + ').')),
        {status: response.status, code: value.error, original: value});
      return value;
    } catch (error) {
      if (error.name === 'AbortError') throw Object.assign(new Error('The response timed out. The original request may still be running; read its saved status.'), {uncertain: true});
      throw error;
    } finally { clearTimeout(timer); }
  }
  function openStorage() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('sf-local-dataset-receiving-v1', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('requests')) request.result.createObjectStore('requests', {keyPath: 'key'});
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Request storage unavailable.'));
      request.onblocked = () => reject(new Error('Close the older receiving tab to open its request storage.'));
    });
  }
  function stored(mode, action) {
    return new Promise((resolve, reject) => {
      if (!S.storage) return reject(new Error('Local request storage is unavailable. No new action was sent.'));
      const tx = S.storage.transaction('requests', mode), store = tx.objectStore('requests');
      let value;
      const request = action(store);
      if (request) { request.onsuccess = () => { value = request.result; }; request.onerror = () => reject(request.error); }
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error || new Error('Could not save the original request locally.'));
      tx.onabort = () => reject(tx.error || new Error('Local request storage was interrupted.'));
    });
  }
  async function retain(entry) {
    S.requests.set(entry.id, entry);
    await stored('readwrite', store => store.put(copy(entry)));
  }
  function currentRequests() {
    return [...S.requests.values()].filter(e => e.workspaceId === S.workspaceId)
      .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  }
  function unresolved() {
    return currentRequests().some(e => ['PREPARED', 'UNKNOWN'].includes(e.state));
  }
  function blocked() { return S.sending || !S.workspaceId || !S.storage || unresolved() || Boolean(S.status?.active) || currentRequests().some(e => e.state === 'RUNNING'); }
  function checkWorkspace(workspace) {
    if (!workspace || workspace !== S.workspaceId) throw new Error('This form belongs to another workspace. Reopen its original host; the saved request has not been changed.');
  }
  function selectedRecord() {
    if (!S.record || S.record.id !== S.selected) throw new Error('Open the intended saved delivery first.');
    return S.record;
  }
  function selectedDelivery() {
    const record = selectedRecord();
    if (!record.delivery?.reportSha256) throw new Error('Receive and finalize the complete selected dataset before using the customer workspace.');
    return record;
  }
  async function refreshStatus({offset = S.recordsOffset, initial = false} = {}) {
    const value = await api(url('/status', {offset, limit: S.recordsLimit}));
    if (!plain(value) || typeof value.workspaceId !== 'string' || !Array.isArray(value.records)) throw new Error('The complete local workspace status was not returned.');
    if (S.workspaceId && value.workspaceId !== S.workspaceId) throw new Error('The host now serves a different workspace. Existing forms and saved requests remain bound to the original workspace. Reload only after choosing the intended host.');
    S.workspaceId = value.workspaceId; S.status = value; S.recordsOffset = value.page?.offset ?? offset;
    if (initial) {
      const saved = await stored('readonly', store => store.getAll());
      for (const item of saved || []) if (item.origin === location.origin && item.workspaceId === S.workspaceId) S.requests.set(item.id, item);
    }
    render();
    return value;
  }
  async function readRecord(id, selectIt = false) {
    const sequence = selectIt ? ++S.selection : S.selection;
    if (selectIt) { S.selected = id; S.record = null; S.message = ''; S.reviewLookup = ''; S.sourceEditionId = null; S.selectedExports.clear(); S.warehouseExport = ''; S.activePackage = null; S.openExport = null; S.nativeOperation = null; S.catalogs.clear(); S.catalogPages.clear(); render(); }
    const record = await api(url('/record', {id}));
    if (!plain(record) || record.id !== id) throw new Error('The requested original delivery identity was not returned.');
    if (S.selection === sequence && S.selected === id) { S.record = record; render(); }
    return record;
  }
  function applyReceipt(entry, response) {
    const operation = response.operation || response;
    if (!plain(operation) || operation.id !== entry.id || !['RUNNING','COMPLETE','INTERRUPTED','FAILED'].includes(operation.state))
      throw new Error('The returned status did not match the original request. Recover that exact request ID.');
    entry.operation = copy(operation); entry.state = operation.state; entry.updatedAt = new Date().toISOString();
    entry.response = copy(response);
    S.requests.set(entry.id, entry);
    if (S.status?.active?.id === entry.id && operation.state !== 'RUNNING') S.status.active = null;
  }
  function projectReceipt(entry, response) {
    const operation = entry.operation, result = operation.result;
    if (response.record && (response.record.id === S.selected || entry.path === '/prepare' && S.selection === entry.selection)) {
      S.selected = response.record.id; S.record = response.record;
    }
    if (operation.state !== 'COMPLETE' || result === undefined) return;
    if (entry.path === '/customer') {
      const name = entry.body.operation, sameDelivery = entry.body.deliveryId === S.selected;
      if (name === 'query' && sameDelivery) S.queryResult = result;
      if (name === 'compare' && sameDelivery) S.comparison.result = result;
      if (name === 'review' && sameDelivery) {
        const mapping = S.mapping.get(entry.body.deliveryId);
        if (mapping && mapping.inspection.source.sha256 === entry.body.arguments.source_sha256) {
          mapping.review = result; mapping.reviewColumns = copy(entry.body.arguments.columns); mapping.reviewKeys = copy(entry.body.arguments.keys);
        }
      }
      if (name === 'import' && sameDelivery) { S.edition = result; S.sourceEditionId = result.edition_id; }
      if (name === 'save-query' && S.selection === entry.selection &&
          S.query.name === entry.body.arguments.name && S.query.sql === entry.body.arguments.sql &&
          S.query.parametersText === entry.body.arguments.parameters_text) useRecipe(result);
      if (['export','source-handoff','handoff','resume'].includes(name) && result.export_id) {
        S.exportRecords.set(result.export_id, result);
        if (sameDelivery) S.openExport = result.export_id;
      }
    }
    if (entry.path === '/package') { S.packageRecords.set(entry.id, result); if (entry.body.deliveryId === S.selected) S.activePackage = entry.id; }
  }
  async function publishEntry(entry, path = entry.path, body = entry.body) {
    checkWorkspace(entry.workspaceId); S.sending = true; S.focusRequest = entry.id; render();
    let response, succeeded = false;
    try {
      response = await api(path, body, entry.workspaceId);
      applyReceipt(entry, response);
      succeeded = true;
      let localError = null;
      try { await retain(entry); } catch (error) { S.storageError = error.message; localError = error; }
      try { projectReceipt(entry, response); } catch (error) { localError = localError || error; }
      if (entry.state === 'RUNNING') beginReads(entry.id);
      if (localError) notice('The original server result is retained. The screen or local checkpoint could not be updated: ' + localError.message + ' Use Open saved result or Read original status.', 'error');
      else if (entry.state === 'COMPLETE') notice('Original result saved. Open it below or refresh the selected delivery.', 'success');
      else if (entry.state === 'INTERRUPTED') notice('The original request is interrupted. Review its retained status before using Resume original request.', 'error');
      return response;
    } catch (error) {
      if (!succeeded) {
        entry.error = {message: error.message, status: error.status ?? null, code: error.code ?? null};
        entry.state = [400,401,403,404,409,422].includes(error.status) && !error.uncertain ? 'REJECTED' : 'UNKNOWN';
        entry.updatedAt = new Date().toISOString();
        try { await retain(entry); } catch { S.requests.set(entry.id, entry); }
      }
      throw error;
    } finally { S.sending = false; render(); }
  }
  async function mutate(path, fields, {requestId, allowActive = false} = {}) {
    if (S.sending || !allowActive && blocked()) throw new Error('Read or resolve the existing request before starting another change.');
    const id = requestId || crypto.randomUUID(), body = {workspaceId: S.workspaceId, requestId: id, ...copy(fields)};
    const entry = {key: S.workspaceId + ':' + id, id, workspaceId: S.workspaceId, origin: location.origin,
      path, body, kind: path === '/customer' ? fields.operation : path.slice(1),
      state: 'PREPARED', selection: S.selection, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()};
    await retain(entry); // No provider or application mutation before durable original input.
    return publishEntry(entry);
  }
  async function readRequest(id, {watch = false} = {}) {
    const entry = S.requests.get(id);
    if (entry) checkWorkspace(entry.workspaceId);
    const value = await api(url('/request', {id}));
    if (!plain(value) || value.id !== id) throw new Error('The original request status did not match the requested ID.');
    const retained = entry || {key: S.workspaceId + ':' + id, id, workspaceId: S.workspaceId, origin: location.origin,
      path: null, body: null, kind: value.kind, createdAt: value.createdAt || new Date().toISOString()};
    applyReceipt(retained, {operation: value});
    try { await retain(retained); } catch (error) { S.storageError = error.message; }
    try { projectReceipt(retained, {operation: value}); } catch (error) { S.message = 'Original result retained; display needs attention: ' + error.message; S.messageKind = 'error'; }
    S.focusRequest = id;
    if (watch && value.state === 'RUNNING') beginReads(id);
    if (S.autoRequest === id && value.state !== 'RUNNING') stopReads();
    render();
    return value;
  }
  function stopReads() { clearTimeout(S.timer); S.timer = null; S.autoRequest = null; }
  function beginReads(id) {
    clearTimeout(S.timer); S.autoRequest = id;
    if (document.hidden) return;
    S.timer = setTimeout(async () => {
      if (S.autoRequest !== id || S.pollBusy) return;
      S.pollBusy = true;
      try {
        const value = await readRequest(id);
        if (value.state === 'RUNNING') beginReads(id);
        else { stopReads(); await refreshStatus(); if (S.selected) await readRecord(S.selected); }
      } catch (error) { stopReads(); notice('Progress could not be refreshed: ' + error.message + ' The original operation has not been repeated.', 'error'); }
      finally { S.pollBusy = false; }
    }, 2000);
  }
  async function resumeOriginal(entry) {
    checkWorkspace(entry.workspaceId);
    if (entry.state !== 'INTERRUPTED') throw new Error('Read the original request and confirm its interrupted state before resuming.');
    return publishEntry(entry, '/resume', {workspaceId: entry.workspaceId, requestId: entry.id});
  }
  async function retryUnrecorded(entry) {
    checkWorkspace(entry.workspaceId);
    try { await readRequest(entry.id); throw new Error('The server retains this request. Use its saved result or explicit original resume.'); }
    catch (error) { if (error.status !== 404) throw error; }
    if (!entry.path || !entry.body) throw new Error('This tab does not hold the exact original input for that request.');
    entry.state = 'PREPARED'; entry.updatedAt = new Date().toISOString();
    await retain(entry);
    return publishEntry(entry);
  }
  async function customerRead(operation, args = {}, deliveryId = selectedDelivery().id) {
    const response = await api(url('/customer', {deliveryId, operation, arguments: args}));
    if (!plain(response) || !Object.hasOwn(response, 'result')) throw new Error('The complete original customer result was not returned.');
    return response.result;
  }
  async function customerChange(operation, args, options = {}) {
    const deliveryId = selectedDelivery().id;
    const requestId = crypto.randomUUID(), parameters = copy(args);
    if (['export', 'source-handoff', 'handoff'].includes(operation)) parameters.request_id = requestId.replaceAll('-', '');
    return mutate('/customer', {deliveryId, operation, arguments: parameters}, {...options, requestId});
  }
  async function catalog(name, {offset = 0, before, limit = 25} = {}) {
    const delivery = selectedDelivery().id, selection = S.selection;
    const args = name === 'editions' ? {limit, ...(before === undefined || before === null ? {} : {before})} : {offset, limit};
    const result = await customerRead(name, args, delivery);
    if (!plain(result) || !Array.isArray(result[name])) throw new Error('The original ' + name + ' catalog page was incomplete.');
    if (selection === S.selection && delivery === S.selected) {
      S.catalogs.set(name, result); S.catalogPages.set(name, args); render();
    }
    return result;
  }
  async function allViews() {
    const delivery = selectedDelivery().id, selection = S.selection, result = [], seen = new Set();
    let offset = 0, expectedTotal;
    for (;;) {
      const page = await customerRead('views', {offset, limit: 100}, delivery);
      if (!plain(page) || !Array.isArray(page.views) || !Number.isSafeInteger(page.total) || page.total < 0 ||
          expectedTotal !== undefined && page.total !== expectedTotal) throw new Error('The view list changed while paging. Read the complete current list again.');
      expectedTotal = page.total;
      for (const view of page.views) {
        if (!plain(view) || typeof view.name !== 'string' || seen.has(view.name) ||
            typeof view.edition_id !== 'string' || !Number.isSafeInteger(view.revision)) throw new Error('The current view list was incomplete or repeated.');
        seen.add(view.name); result.push({name: view.name, edition_id: view.edition_id, revision: view.revision});
      }
      if (result.length > 4096) throw new Error('The complete view list exceeds the original query contract.');
      if (page.next_offset === null) {
        if (result.length !== expectedTotal) throw new Error('The complete view count did not match the original catalog.');
        break;
      }
      if (!Number.isSafeInteger(page.next_offset) || page.next_offset <= offset) throw new Error('The original view cursor did not advance.');
      offset = page.next_offset;
    }
    if (selection !== S.selection || delivery !== S.selected) throw new Error('The selected delivery changed while reading views. Its original results were not assigned to another selection.');
    S.views = result; S.viewWorkspace = S.workspaceId; render(); return result;
  }
  function expectedViews() {
    if (!Array.isArray(S.views) || S.viewWorkspace !== S.workspaceId) throw new Error('Read the complete current view list before running a query or full export.');
    return copy(S.views);
  }
  function validateParameters(value) {
    let parsed;
    try { parsed = JSON.parse(value); } catch { throw new Error('Parameters must be a complete JSON array or object.'); }
    if (!Array.isArray(parsed) && !plain(parsed)) throw new Error('Parameters must be a JSON array or object.');
    return value; // Preserve original numeric tokens; never stringify the parsed value.
  }
  async function openCustomerBrowser() {
    const opened = window.open('', '_blank');
    if (!opened) throw new Error('Allow a popup for this local publisher to open its original customer browser.');
    opened.opener = null;
    try {
      const value = await api('/customer-browser');
      if (value.workspaceId !== S.status?.customer?.workspaceId) throw new Error('The original customer workspace identity changed.');
      const target = new URL(value.url);
      if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port || target.username || target.password)
        throw new Error('The original host did not return its local customer browser.');
      opened.location.replace(target.href);
      // The capability is used only for this explicit navigation, never retained in a request or receipt.
    } catch (error) { opened.close(); throw error; }
  }

  function heading(title, description, actions = []) {
    return node('div', {class: 'ldr-panel-heading'}, node('div', {}, node('h3', {}, title), node('p', {}, description)),
      actions.length ? node('div', {class: 'ldr-actions'}, actions) : null);
  }
  function requireText(value, label, maximum) {
    if (typeof value !== 'string' || !value.trim() || maximum && value.length > maximum) throw new Error(label + ' is required' + (maximum ? ' and must fit ' + maximum + ' characters.' : '.'));
    return value;
  }
  function hashId(value, label = 'Original identity') {
    if (!/^[a-f0-9]{64}$/.test(value || '')) throw new Error(label + ' must be the complete original 64-character identity.');
    return value;
  }
  function mutable() { if (blocked()) throw new Error('Resolve the saved request or current operation before starting another change.'); }
  function link(label, href, attrs = {}) {
    return node('a', {href, class: 'ldr-button', ...attrs}, label);
  }
  function panelNeedsDelivery() {
    if (S.record?.delivery?.reportSha256) return null;
    return empty('Receive the complete source first', 'Open a saved delivery, review its exact scope, and continue receiving every page before using the customer warehouse.',
      button('Open source and deliveries', () => { S.tab = 'source'; render(); }));
  }
  function followPublisher({force = false} = {}) {
    const parent = publisherHost.context(), runValue = parent?.detail?.run;
    const candidate = runValue?.data?.candidate, review = runValue?.data?.review;
    const runId = runValue?.id || parent?.selected || '';
    const key = JSON.stringify([runId, candidate?.candidateDigest || '', review?.id || '']);
    if (!force && key === S.sourceKey) return;
    S.sourceKey = key;
    S.source = runValue && candidate && review ? {runId, candidate: copy(candidate), review: copy(review), plan: copy(parent.detail.plan || {})} : null;
    if (S.source && !S.prepared.has(key)) S.prepared.set(key, {
      query: document.getElementById('preview-query')?.value || '',
      reviewer: review.reviewer || '', note: review.note || ''
    });
    render();
  }
  function sourcePanel() {
    const section = node('div', {}, heading('Source and deliveries', 'Follow the reviewed run selected in the publisher above. A delivery retains the complete agreed query and every source page.',
      [button('Refresh deliveries', () => refreshStatus()), button('Read selected publisher run', () => followPublisher({force: true}))]));
    const source = S.source;
    if (!source) section.append(empty('Select a reviewed publisher run', 'Use the original publisher to select a run with a saved candidate review. Its source, digest and review will appear here.'));
    else {
      const draft = S.prepared.get(S.sourceKey);
      const sourceKey = S.sourceKey;
      const form = node('div', {class: 'ldr-box'},
        node('h4', {}, 'Selected original source'),
        metadata([['Run', source.runId], ['Candidate', source.candidate.candidateDigest], ['Review', source.review.id],
          ['Dataset', source.candidate.dataset?.name || source.candidate.dataset?.id || source.plan?.name],
          ['Published source rows', number(source.candidate.dataset?.rowCount ?? source.candidate.dataset?.rows)],
          ['Source snapshot', source.candidate.dataset?.snapshot || source.candidate.snapshot]]),
        node('div', {class: 'ldr-form-grid'},
          field('Reviewer', input('ldr-prepare-reviewer', draft.reviewer, v => draft.reviewer = v, {disabled: S.sending, autocomplete: 'name'})),
          field('Receiving note', input('ldr-prepare-note', draft.note, v => draft.note = v, {disabled: S.sending})),
          field('Original dataset query', textarea('ldr-prepare-query', draft.query, v => draft.query = v,
            {class: 'ldr-json', rows: 3, disabled: S.sending, spellcheck: false}),
            'Use the original preview query string. Leave cursor out; the native delivery retains and follows its own complete cursor chain.', true)),
        node('div', {class: 'ldr-actions ldr-separated'}, button('Prepare complete receiving scope', async () => {
          mutable();
          if (S.sourceKey !== sourceKey) throw new Error('The publisher selection changed. Review the current source before preparing.');
          requireText(draft.reviewer, 'Reviewer', 160);
          if (new URLSearchParams(draft.query.replace(/^\?/, '')).has('cursor')) throw new Error('Remove cursor from the query. This operation receives the complete selected dataset.');
          await mutate('/prepare', {runId: source.runId, reviewId: source.review.id, candidateDigest: source.candidate.candidateDigest,
            query: draft.query, reviewer: draft.reviewer, note: draft.note});
        }, {primary: true, disabled: blocked()})),
        detail('Original review and source identity', {review: source.review, candidate: source.candidate}));
      section.append(form);
    }
    const saved = node('section', {class: 'ldr-section'}, node('h4', {}, 'Saved deliveries'));
    const rows = S.status?.records || [];
    if (!rows.length) saved.append(node('p', {class: 'ldr-muted'}, 'No saved delivery is listed on this page.'));
    else saved.append(table(['Delivery', 'Source / created', 'State', 'Rows / pages', ''], rows.map(r => [
      node('code', {}, short(r.id)), node('div', {}, node('div', {}, text(r.dataset?.name || r.dataset || r.runId)), node('small', {class: 'ldr-muted'}, time(r.createdAt))),
      badge(r.state), number(r.rows) + ' / ' + number(r.total) + ' · ' + number(r.pages) + ' pages',
      button(r.id === S.selected ? 'Refresh open delivery' : 'Open delivery', () => readRecord(r.id, r.id !== S.selected), {quiet: true})
    ])));
    const page = S.status?.page;
    if (page) saved.append(node('div', {class: 'ldr-pager'},
      button('Previous', () => refreshStatus({offset: Math.max(0, S.recordsOffset - S.recordsLimit)}), {disabled: S.recordsOffset === 0}),
      node('span', {}, 'Showing ' + (rows.length ? S.recordsOffset + 1 : 0) + '–' + (S.recordsOffset + rows.length) + ' of ' + number(page.total)),
      button('Next', () => refreshStatus({offset: page.next}), {disabled: !Number.isSafeInteger(page.next)})));
    section.append(saved);
    if (S.selected && !S.record) section.append(node('p', {class: 'ldr-loading'}, 'Reading the selected saved delivery…'));
    if (S.record) {
      const r = S.record, progress = r.progress || {};
      const current = node('section', {class: 'ldr-section'}, heading('Open delivery', 'This scope and source identity belong to the saved delivery below.',
        [badge(r.state), button('Refresh', () => readRecord(r.id))]),
        metadata([['Delivery', r.id], ['Source run', r.input?.runId], ['Reviewed by', r.input?.reviewer],
          ['Dataset snapshot', r.binding?.snapshot], ['Selected rows', number(r.scope?.total)],
          ['Received rows', number(progress.rows)], ['Complete pages', number(progress.pages)],
          ['Source report SHA-256', r.delivery?.reportSha256]]));
      if (Number.isFinite(progress.total) && progress.total > 0) current.append(node('progress', {
        class: 'ldr-progress', value: progress.rows || 0, max: progress.total, 'aria-label': 'Received rows'}));
      if (r.scope) current.append(
        field('Retained query', textarea('ldr-retained-query', r.scope.query ?? r.input?.query ?? '', () => {}, {readOnly: true, rows: 2})),
        detail('Complete selected fields and scope', r.scope));
      if (!r.delivery?.reportSha256) current.append(node('div', {class: 'ldr-actions ldr-separated'},
        button(r.state === 'PAUSED' ? 'Continue saved delivery' : 'Receive every selected page', () => mutate('/continue', {deliveryId: r.id}),
          {primary: true, disabled: blocked() || r.state === 'DELIVERING'}),
        node('span', {class: 'ldr-small ldr-muted'}, 'All pages and original source files are retained before customer import.')));
      else current.append(node('div', {class: 'ldr-actions ldr-separated'},
        button('Review field mapping', () => { S.tab = 'mapping'; render(); }, {primary: true}),
        button('Open original customer', openCustomerBrowser)));
      current.append(detail('Complete saved delivery and history', r));
      section.append(current);
    }
    return section;
  }
  async function inspectMapping() {
    const r = selectedDelivery(), id = r.id, selection = S.selection;
    const inspected = await customerRead('inspect-source', {source: 'delivery'}, id);
    if (!plain(inspected) || !Array.isArray(inspected.fields) || !Array.isArray(inspected.default_columns) ||
        inspected.source?.sha256 !== r.delivery.reportSha256) throw new Error('The inspected source does not match the selected complete delivery.');
    if (selection !== S.selection || id !== S.selected) throw new Error('The delivery changed during source inspection. The returned mapping was not assigned to another delivery.');
    const prior = S.mapping.get(id);
    if (prior && prior.inspection.source.sha256 === inspected.source.sha256) prior.inspection = inspected;
    else S.mapping.set(id, {inspection: inspected, columns: copy(inspected.default_columns), keySources: [], review: null, reviewColumns: null, reviewKeys: null});
    render();
  }
  function mappingInput(mapping) {
    const columns = mapping.columns.map(c => ({source: c.source, name: c.name, type: c.type, nullable: c.nullable}));
    if (columns.length !== mapping.inspection.fields.length ||
        new Set(columns.map(c => c.source)).size !== columns.length ||
        mapping.inspection.fields.some(f => !columns.some(c => c.source === f))) throw new Error('Map every original source field exactly once.');
    const names = new Set();
    for (const c of columns) {
      if (!c.name || c.name.includes('\0') || new TextEncoder().encode(c.name).length > 240 ||
          names.has(c.name.toLocaleLowerCase()) || c.name.toLocaleLowerCase() === 'sf_row') throw new Error('Mapped names must be nonempty, unique, and leave sf_row for original row order.');
      if (!/^(?:VARCHAR|BOOLEAN|BIGINT|HUGEINT|DOUBLE|DATE|TIMESTAMP|TIMESTAMPTZ|JSON|DECIMAL\(\d+,\d+\))$/.test(c.type)) throw new Error('Choose an original supported type or explicit DECIMAL(precision,scale).');
      names.add(c.name.toLocaleLowerCase());
    }
    return {columns, keys: columns.filter(c => mapping.keySources.includes(c.source)).map(c => c.name)};
  }
  function mappingIsReviewed(mapping) {
    if (!mapping.review?.review_id) return false;
    try { const input = mappingInput(mapping); return JSON.stringify(input.columns) === JSON.stringify(mapping.reviewColumns) && JSON.stringify(input.keys) === JSON.stringify(mapping.reviewKeys); }
    catch { return false; }
  }
  async function readMappingReview(reviewId) {
    hashId(reviewId, 'Review');
    const r = selectedDelivery(), selection = S.selection;
    if (!S.mapping.has(r.id)) await inspectMapping();
    const result = await customerRead('review-read', {review_id: reviewId}, r.id);
    if (selection !== S.selection || r.id !== S.selected) throw new Error('The selected delivery changed while reading the original review.');
    const mapping = S.mapping.get(r.id);
    if (result.review_id !== reviewId || result.manifest_sha256 !== mapping.inspection.manifest_sha256 ||
        result.source_binding_sha256 !== mapping.inspection.source_binding_sha256) throw new Error('This saved review belongs to a different source edition.');
    mapping.columns = copy(result.columns); mapping.keySources = result.columns.filter(c => (result.keys || []).includes(c.name)).map(c => c.source);
    mapping.review = result; mapping.reviewColumns = copy(result.columns); mapping.reviewKeys = copy(result.keys || []);
    render();
  }
  function mappingPanel() {
    const missing = panelNeedsDelivery(); if (missing) return missing;
    const r = S.record, mapping = S.mapping.get(r.id);
    const section = node('div', {}, heading('Map and import', 'Inspect every source row, review every column, and import the exact saved mapping into one immutable customer edition.',
      [button(mapping ? 'Refresh full source inspection' : 'Inspect complete source', inspectMapping), button('Open original customer', openCustomerBrowser)]));
    section.append(metadata([['Source report', r.delivery.reportSha256], ['Delivery', r.id], ['Customer workspace', S.status.customer.workspaceId]]));
    if (!mapping) {
      section.append(empty('The field mapping has not been reviewed here', 'Inspect the complete received source to open all original fields and the native suggested types. Inspection does not import an edition.'));
    } else {
      const inspected = mapping.inspection;
      section.append(node('div', {class: 'ldr-box ldr-soft'},
        metadata([['Complete source rows', number(inspected.row_count)], ['Original fields', number(inspected.fields.length)], ['Saved review', mapping.review?.review_id || 'No saved review selected']]),
        node('p', {}, 'Review names, types and nullability for every field. Mark keys only when the selected values must be unique and non-null. Leaving every key unchecked preserves duplicate observations.')));
      const supported = ['VARCHAR', 'BOOLEAN', 'BIGINT', 'HUGEINT', 'DOUBLE', 'DATE', 'TIMESTAMP', 'TIMESTAMPTZ', 'JSON'];
      const grid = table(['Original field', 'Customer column', 'Type', 'Nullable', 'Key'], mapping.columns.map((c, index) => [
        node('div', {}, node('code', {}, c.source), node('div', {class: 'ldr-small ldr-muted'}, (inspected.observed_types?.[c.source] || []).join(', '))),
        input('ldr-map-name-' + index, c.name, v => c.name = v, {disabled: S.sending, 'aria-label': 'Customer name for ' + c.source, spellcheck: false}),
        input('ldr-map-type-' + index, c.type, v => c.type = v.toUpperCase(), {list: 'ldr-types', disabled: S.sending, 'aria-label': 'Type for ' + c.source, spellcheck: false}),
        node('input', {id: 'ldr-map-null-' + index, type: 'checkbox', checked: c.nullable, disabled: S.sending,
          'aria-label': 'Allow null for ' + c.source, onchange: e => { c.nullable = e.target.checked; render(); }}),
        node('input', {id: 'ldr-map-key-' + index, type: 'checkbox', checked: mapping.keySources.includes(c.source), disabled: S.sending,
          'aria-label': 'Use ' + c.source + ' as a key', onchange: e => { mapping.keySources = e.target.checked ? [...mapping.keySources, c.source] : mapping.keySources.filter(x => x !== c.source); render(); }})
      ]), {className: 'ldr-mapping'});
      section.append(grid, node('datalist', {id: 'ldr-types'}, supported.map(value => node('option', {value}))),
        node('p', {class: 'ldr-table-note'}, 'All ' + number(mapping.columns.length) + ' original columns are shown. DECIMAL(precision,scale) is accepted by the original importer.'),
        node('div', {class: 'ldr-actions'},
          button('Save reviewed mapping', async () => {
            const current = selectedDelivery(), input = mappingInput(mapping);
            if (current.id !== r.id) throw new Error('The selected delivery changed.');
            await customerChange('review', {source: 'delivery', source_sha256: current.delivery.reportSha256, ...input});
          }, {primary: true, disabled: blocked()}),
          button('Import exact saved review', async () => {
            if (!mappingIsReviewed(mapping)) throw new Error('The mapping changed after its saved review. Save that complete mapping before importing.');
            await customerChange('import', {review_id: hashId(mapping.review.review_id, 'Review')});
          }, {disabled: blocked() || !mappingIsReviewed(mapping)}),
          button('Editions and views', () => { S.tab = 'views'; render(); })),
        node('p', {class: 'ldr-small ldr-muted'}, mappingIsReviewed(mapping) ? 'The form matches its complete saved native review.' : 'Import uses a saved review; changed fields need a new review.'),
        node('section', {class: 'ldr-section'}, node('h4', {}, 'Original source preview'),
          resultTable({...inspected, columns: inspected.fields}, 'Preview of the original inspected source. The native inspection checks all ' + number(inspected.row_count) + ' rows.')),
        detail('Complete inspection and source declarations', inspected),
        mapping.review ? detail('Complete saved mapping review', mapping.review) : null);
    }
    const reviewValue = typeof r.customer?.review === 'string' ? r.customer.review : r.customer?.review?.review_id;
    const reviewId = S.reviewLookup ?? reviewValue ?? '';
    section.append(node('section', {class: 'ldr-section'}, node('h4', {}, 'Reopen an existing source review'),
      node('div', {class: 'ldr-form-grid'}, field('Original review ID', input('ldr-review-lookup', reviewId, v => S.reviewLookup = v, {spellcheck: false}),
        'The original manifest and source binding must match this selected delivery.', true)),
      node('div', {class: 'ldr-actions ldr-separated'}, button('Open exact review', () => readMappingReview(S.reviewLookup ?? reviewValue ?? '')))));
    return section;
  }
  function catalogPager(name, result) {
    const args = S.catalogPages.get(name) || {};
    if (name === 'editions') return node('div', {class: 'ldr-pager'},
      button('Newest editions', () => catalog(name)), node('span', {}, number(result.editions.length) + ' editions on this page'),
      button('Older editions', () => catalog(name, {before: result.next_before}), {disabled: !Number.isSafeInteger(result.next_before)}));
    return node('div', {class: 'ldr-pager'},
      button('Previous', () => catalog(name, {offset: Math.max(0, (args.offset || 0) - (args.limit || 25))}), {disabled: !(args.offset > 0)}),
      node('span', {}, number(result.offset || 0) + ' + ' + number(result[name]?.length) + ' of ' + number(result.total)),
      button('Next', () => catalog(name, {offset: result.next_offset}), {disabled: !Number.isSafeInteger(result.next_offset)}));
  }
  async function openEdition(id) {
    hashId(id, 'Edition');
    const selection = S.selection, deliveryId = selectedDelivery().id;
    const value = await customerRead('edition', {edition_id: id}, deliveryId);
    if (value.edition_id !== id) throw new Error('The native edition identity changed.');
    if (selection === S.selection && deliveryId === S.selected) { S.edition = value; render(); }
    return value;
  }
  function chooseView(view) {
    S.viewDraft = {name: view.name, editionId: view.edition_id, revision: view.revision, boundName: view.name}; render();
  }
  async function bindView() {
    const name = requireText(S.viewDraft.name, 'View name', 120);
    if (!/^[A-Za-z][A-Za-z0-9_]{0,119}$/.test(name)) throw new Error('View names use letters, numbers and underscores, starting with a letter.');
    const views = await allViews();
    if (S.viewDraft.name !== name) throw new Error('The view name changed while its current revision was read.');
    const current = views.find(v => v.name.toLowerCase() === name.toLowerCase());
    S.viewDraft.boundName = current?.name || name;
    S.viewDraft.name = current?.name || name;
    S.viewDraft.revision = current?.revision || 0;
    render();
  }
  function viewsPanel() {
    const missing = panelNeedsDelivery(); if (missing) return missing;
    const section = node('div', {}, heading('Editions and views', 'Keep imported editions unchanged. Select the exact edition behind each named view using its original saved revision.',
      [button('Read editions', () => catalog('editions')), button('Read complete view list', allViews)]));
    const editions = S.catalogs.get('editions');
    if (editions) {
      section.append(table(['Edition / created', 'Rows', 'Keys', ''], editions.editions.map(e => [
        node('div', {}, node('code', {}, short(e.edition_id)), node('div', {class: 'ldr-small ldr-muted'}, 'Edition ' + number(e.sequence) + ' · ' + time(e.created_at))),
        number(e.row_count), (e.keys || []).join(', ') || 'Duplicates retained',
        node('div', {class: 'ldr-actions'}, button('Open', () => openEdition(e.edition_id), {quiet: true}),
          button('Select for view', () => { S.viewDraft.editionId = e.edition_id; render(); }, {quiet: true}),
          button('Before', () => { S.comparison.before = e.edition_id; render(); }, {quiet: true}),
          button('After', () => { S.comparison.after = e.edition_id; render(); }, {quiet: true}))
      ]), {numeric: [1]}), catalogPager('editions', editions));
    } else section.append(empty('Read the original edition history', 'Each edition retains its exact source, mapping and received bytes. Reading history does not change the current views.'));
    if (S.edition) section.append(node('div', {class: 'ldr-box'},
      node('h4', {}, 'Open immutable edition'),
      metadata([['Edition', S.edition.edition_id], ['Row count', number(S.edition.row_count)], ['Original review', S.edition.review_id], ['Row order', S.edition.row_order_column]]),
      table(['Original field', 'Customer column', 'Type', 'Nullable'], (S.edition.columns || []).map(c => [c.source, c.name, c.type, c.nullable ? 'Yes' : 'No'])),
      detail('Complete edition, source and semantic declarations', S.edition)));
    const views = S.views, draft = S.viewDraft;
    const current = node('section', {class: 'ldr-section'}, node('h4', {}, 'Current view selections'));
    if (views) current.append(table(['View', 'Edition', 'Revision', ''], views.map(v => [v.name, node('code', {}, v.edition_id), number(v.revision),
      button('Use current revision', () => chooseView(v), {quiet: true})])),
      node('p', {class: 'ldr-small ldr-muted'}, 'All ' + number(views.length) + ' current view selections were retained, including every native catalog page.'));
    else current.append(node('p', {class: 'ldr-muted'}, 'Read the complete current view list to bind a change or run a query.'));
    current.append(node('div', {class: 'ldr-form-grid'},
      field('View name', input('ldr-view-name', draft.name, v => { draft.name = v; draft.boundName = ''; }, {disabled: S.sending, spellcheck: false})),
      field('Exact imported edition ID', input('ldr-view-edition', draft.editionId, v => draft.editionId = v, {disabled: S.sending, spellcheck: false}))),
      node('div', {class: 'ldr-actions ldr-separated'},
        button('Read and bind current revision', bindView),
        button('Save view selection', async () => {
          if (!draft.boundName || draft.boundName !== draft.name) throw new Error('Bind the current revision for this exact view name first.');
          await customerChange('activate', {name: draft.name, edition_id: hashId(draft.editionId, 'Edition'), expected_revision: draft.revision});
        }, {primary: true, disabled: blocked() || !draft.boundName}),
        node('span', {class: 'ldr-small'}, draft.boundName ? 'Expected original revision: ' + draft.revision + (draft.revision === 0 ? ' (new view)' : '') : 'Current revision not bound')));
    section.append(current);
    const comparison = S.comparison;
    section.append(node('section', {class: 'ldr-section'}, node('h4', {}, 'Compare complete editions'),
      node('p', {class: 'ldr-muted'}, 'Native totals cover both complete editions. Changed rows are a labeled preview; keys must be compatible, unique and non-null.'),
      node('div', {class: 'ldr-form-grid'},
        field('Before edition ID', input('ldr-compare-before', comparison.before, v => comparison.before = v, {disabled: S.sending, spellcheck: false})),
        field('After edition ID', input('ldr-compare-after', comparison.after, v => comparison.after = v, {disabled: S.sending, spellcheck: false})),
        field('Comparison keys (JSON array)', textarea('ldr-compare-keys', comparison.keys, v => comparison.keys = v, {rows: 2, disabled: S.sending, placeholder: 'Leave empty to use original edition keys'}),
          'Use exact mapped column names. No key or missing observation is invented.', true)),
      node('div', {class: 'ldr-actions ldr-separated'}, button('Compare editions', async () => {
        let keys;
        if (comparison.keys.trim()) {
          try { keys = JSON.parse(comparison.keys); } catch { throw new Error('Comparison keys must be a JSON array of exact column names.'); }
          if (!Array.isArray(keys) || keys.some(k => typeof k !== 'string') || new Set(keys).size !== keys.length) throw new Error('Comparison keys must be distinct column names.');
        }
        await customerChange('compare', {before_id: hashId(comparison.before, 'Before edition'), after_id: hashId(comparison.after, 'After edition'),
          ...(keys === undefined ? {} : {keys}), max_rows: 100});
      }, {disabled: blocked()})),
      comparison.result ? node('div', {class: 'ldr-box'}, node('h4', {}, 'Saved comparison result'), comparisonResult(comparison.result)) : null));
    return section;
  }
  function comparisonResult(result) {
    const items = node('div', {}, result.summary ? metadata(Object.entries(result.summary).map(([k,v]) => [k, number(v)])) : null);
    if (Array.isArray(result.changes)) items.append(table(['Change', 'Exact key', 'Before', 'After'], result.changes.map(row =>
      [row.kind, cell(row.key), cell(row.before), cell(row.after)])),
      node('p', {class: 'ldr-table-note'}, result.truncated ? 'Changed-row preview is truncated. The summary above covers both complete editions.' : 'All changed rows returned within this native preview; summary counts cover the complete editions.'));
    if (result.comparison_basis) items.append(node('p', {class: 'ldr-muted'}, result.comparison_basis));
    if (result.columns) items.append(detail('Structural field changes', result.columns));
    items.append(detail('Complete original comparison result and source meanings', result)); return items;
  }

  function queryFingerprint(query) { return JSON.stringify([query.name, query.sql, query.parametersText]); }
  function useRecipe(result) {
    if (!plain(result) || !/^[a-f0-9]{64}$/.test(result.query_id || '') || !Number.isSafeInteger(result.revision) ||
        typeof result.sql !== 'string' || typeof result.parameters_text !== 'string') throw new Error('The original saved recipe did not include its exact parameters_text. Its result remains retained; reopen it through the current customer service.');
    validateParameters(result.parameters_text);
    S.query = {...S.query, name: result.name, sql: result.sql, parametersText: result.parameters_text,
      queryId: result.query_id, revision: result.revision, boundName: result.name};
    S.query.saved = copy(result);
    S.query.savedFingerprint = queryFingerprint(S.query);
  }
  async function openRecipe(id) {
    hashId(id, 'Recipe');
    const deliveryId = selectedDelivery().id, selection = S.selection, draft = queryFingerprint(S.query);
    const result = await customerRead('saved-query', {query_id: id}, deliveryId);
    if (result.query_id !== id) throw new Error('The native recipe identity changed.');
    if (selection !== S.selection || deliveryId !== S.selected || queryFingerprint(S.query) !== draft) throw new Error('The recipe form changed during this read. Its existing draft was preserved; reopen the intended saved recipe explicitly.');
    useRecipe(result); render();
  }
  function queryArgs() {
    const q = S.query;
    requireText(q.sql, 'Read-only SQL', 262144);
    return {sql: q.sql, parameters_text: validateParameters(q.parametersText)};
  }
  function queryPanel() {
    const missing = panelNeedsDelivery(); if (missing) return missing;
    const section = node('div', {}, heading('Queries and reports', 'Save read-only SQL and exact parameters in the original customer warehouse. A preview and a complete export are separate actions.',
      [button('Read saved recipes', () => catalog('queries')), button('Read complete view list', allViews), button('Open original customer', openCustomerBrowser)]));
    const q = S.query, catalogResult = S.catalogs.get('queries');
    if (catalogResult) section.append(table(['Saved recipe', 'Revision', 'Saved', ''], catalogResult.queries.map(item => [
      node('div', {}, item.name, node('div', {class: 'ldr-small ldr-mono'}, short(item.query_id))), number(item.revision), time(item.saved_at),
      button('Open original recipe', () => openRecipe(item.query_id), {quiet: true})
    ])), catalogPager('queries', catalogResult));
    section.append(node('div', {class: 'ldr-box'},
      node('div', {class: 'ldr-form-grid'},
        field('Recipe name', input('ldr-query-name', q.name, v => {
          q.name = v;
          if (q.boundName !== v) { q.queryId = null; q.revision = 0; q.boundName = ''; q.saved = null; q.savedFingerprint = ''; }
        }, {disabled: S.sending, maxlength: 120, spellcheck: false}), 'Open an existing recipe to edit its current revision. A new name starts at revision 0.'),
        field('Preview row limit', input('ldr-query-limit', q.maxRows, v => q.maxRows = Number(v), {type: 'number', min: 1, max: 100, disabled: S.sending}),
          '1–100 preview rows. Complete exports are not limited by this preview setting.'),
        field('Read-only SQL', textarea('ldr-query-sql', q.sql, v => q.sql = v, {class: 'ldr-sql', rows: 9, disabled: S.sending, spellcheck: false}),
          'Use the selected original view names. The native engine accepts one SELECT statement.', true),
        field('Exact parameters JSON', textarea('ldr-query-parameters', q.parametersText, v => q.parametersText = v, {class: 'ldr-json', rows: 4, disabled: S.sending, spellcheck: false}),
          'Send the original array or object text unchanged. Use quoted strings and explicit SQL casts for precision-sensitive decimal values.', true)),
      metadata([['Original recipe', q.queryId || 'New recipe'], ['Expected saved revision', q.revision],
        ['Reviewed view selections', S.views ? number(S.views.length) + ' (complete catalog)' : 'Read the complete current list']]),
      node('div', {class: 'ldr-actions ldr-separated'},
        button('Save recipe', async () => {
          const args = queryArgs();
          requireText(q.name, 'Recipe name', 120);
          if (!/^[A-Za-z][A-Za-z0-9_]{0,119}$/.test(q.name)) throw new Error('Recipe names use letters, numbers and underscores, starting with a letter.');
          await customerChange('save-query', {name: q.name, ...args, expected_revision: q.boundName === q.name ? q.revision : 0});
        }, {primary: true, disabled: blocked()}),
        button('Run preview', async () => {
          if (!Number.isInteger(q.maxRows) || q.maxRows < 1 || q.maxRows > 100) throw new Error('Preview row limit must be 1–100.');
          await customerChange('query', {...queryArgs(), expected_views: expectedViews(), max_rows: q.maxRows});
        }, {disabled: blocked() || !S.views}),
        button('Export complete saved result', async () => {
          if (!q.queryId || q.savedFingerprint !== queryFingerprint(q)) throw new Error('Save or reopen the exact recipe before exporting its complete result.');
          await customerChange('export', {query_id: q.queryId, expected_revision: q.revision, expected_views: expectedViews()});
        }, {disabled: blocked() || !q.queryId || !S.views}),
        button('Start a new recipe draft', () => {
          S.query = {name: '', sql: '', parametersText: '[]', queryId: null, revision: 0, maxRows: 50, boundName: '', saved: null, savedFingerprint: ''}; render();
        }, {quiet: true, disabled: S.sending}))));
    if (S.views) section.append(detail('Complete ordered view selection used by query and export', S.views));
    if (q.saved) section.append(detail('Complete original saved recipe', q.saved));
    if (S.queryResult) section.append(node('section', {class: 'ldr-section'},
      node('h4', {}, 'Retained query preview'), badge(S.queryResult.truncated ? 'PREVIEW_TRUNCATED' : 'PREVIEW'),
      resultTable(S.queryResult, S.queryResult.truncated ? 'This preview is truncated. Export the saved recipe for every result row.' : 'The native preview returned all matching rows within its requested limit. Complete Parquet and CSV exports remain available separately.'),
      detail('Complete original preview response and source meanings', S.queryResult)));
    section.append(node('section', {class: 'ldr-section'}, node('h4', {}, 'Complete report files'),
      node('p', {}, 'A full export retains the saved recipe revision, all selected view revisions, the complete Parquet and CSV files, and their manifest. Open the saved result even if a later screen refresh fails.'),
      button('Open files and receiving', () => { S.tab = 'files'; render(); })));
    return section;
  }
  function declaredFiles(items, buildUrl, {selection} = {}) {
    if (!Array.isArray(items) || !items.length) return node('p', {class: 'ldr-muted'}, 'No complete declared files are present in this result.');
    return node('ul', {class: 'ldr-file-list'}, items.map(item => {
      const valid = plain(item) && typeof item.name === 'string' && /^[a-f0-9]{64}$/.test(item.sha256 || '') &&
        Number.isSafeInteger(item.bytes ?? item.size) && (item.bytes ?? item.size) >= 0;
      return node('li', {class: 'ldr-file'}, node('div', {},
        node('div', {class: 'ldr-file-name'}, item.name || 'Undeclared file'),
        node('div', {class: 'ldr-file-meta'}, bytes(item.bytes ?? item.size), ' · ', node('code', {}, item.sha256 || 'SHA-256 missing'))),
        valid ? link('Download exact file', buildUrl(item), {download: item.name}) :
          node('span', {class: 'ldr-muted'}, 'Incomplete declaration'));
    }));
  }
  function exportId(record) { return record?.export_id || record?.exportId || ''; }
  function completedExport(record) {
    return plain(record) && Boolean(exportId(record)) && Array.isArray(record.files) && record.files.length > 0 &&
      (record.state === 'COMPLETE' || ['source-handoff', 'edition-source'].includes(record.kind));
  }
  function warehouseHandoff(record) { return completedExport(record) && record.kind === 'source-handoff'; }
  async function openExport(id) {
    if (!/^(?:[a-f0-9]{64}|handoff-[a-f0-9]{32})$/.test(id || '')) throw new Error('Use the exact completed export or handoff ID.');
    const deliveryId = selectedDelivery().id, selection = S.selection;
    const value = await customerRead('export-read', {export_id: id}, deliveryId);
    if (value.export_id !== id) throw new Error('The original export ID changed.');
    S.exportRecords.set(id, value); // Complete result is retained before rendering or another read.
    if (selection === S.selection && deliveryId === S.selected) { S.openExport = id; render(); }
    return value;
  }
  function exportSummary(record) {
    return node('div', {}, node('strong', {}, record.query?.name || record.kind || 'Query export'),
      node('div', {class: 'ldr-small ldr-mono'}, short(exportId(record))),
      node('div', {class: 'ldr-small ldr-muted'}, time(record.completed_at || record.created_at) +
        (Number.isFinite(record.row_count) ? ' · ' + number(record.row_count) + ' rows' : '')));
  }
  function exportCatalog(name, title) {
    const result = S.catalogs.get(name);
    const section = node('section', {class: 'ldr-section'}, heading(title, 'Read and select exact completed original records.',
      [button('Read ' + title.toLowerCase(), () => catalog(name))]));
    if (!result) { section.append(node('p', {class: 'ldr-muted'}, 'The original catalog has not been read in this selection.')); return section; }
    section.append(table(['Original record', 'State', 'Files', ''], result[name].map(r => [
      exportSummary(r), badge(r.state || (Array.isArray(r.files) ? 'RETAINED' : 'UNKNOWN')), number(r.files?.length),
      button('Open complete manifest', () => openExport(exportId(r)), {quiet: true})
    ])), catalogPager(name, result));
    return section;
  }
  async function readNativeOperation(id) {
    if (!/^[a-f0-9]{32}$/.test(id || '')) throw new Error('Use the original native 32-character request ID.');
    const deliveryId = selectedDelivery().id, selection = S.selection;
    const value = await customerRead('operation', {request_id: id}, deliveryId);
    if (selection === S.selection && deliveryId === S.selected) { S.nativeOperation = value; S.nativeOperationId = id; render(); }
  }
  function filesPanel() {
    const missing = panelNeedsDelivery(); if (missing) return missing;
    const r = S.record;
    const section = node('div', {}, heading('Files and receiving', 'Download the complete retained source, original SF100 delivery, reports and portable customer warehouse.',
      [button('Open original customer', openCustomerBrowser)]));
    section.append(node('h4', {}, 'Original local source and delivery files'),
      declaredFiles(r.delivery.files, item => url('/file', {deliveryId: r.id, id: item.name})),
      detail('Original delivery manifest and chain', r.delivery));
    section.append(exportCatalog('exports', 'Query exports'), exportCatalog('handoffs', 'Source and warehouse handoffs'));
    const opened = S.openExport && S.exportRecords.get(S.openExport);
    if (opened) {
      const id = exportId(opened);
      section.append(node('section', {class: 'ldr-section'}, node('h4', {}, 'Open complete manifest'),
        metadata([['Export', id], ['Kind', opened.kind || 'Query export'], ['Original state', opened.state || 'Retained handoff']]),
        declaredFiles(opened.files, item => url('/customer-file', {deliveryId: r.id, exportId: id, filename: item.name, sha256: item.sha256})),
        node('div', {class: 'ldr-actions ldr-separated'},
          warehouseHandoff(opened) ? button('Use this complete warehouse handoff', () => { S.warehouseExport = id; render(); }) :
            button(S.selectedExports.has(id) ? 'Remove from receiving package' : 'Include this complete export', () => {
              if (!completedExport(opened)) throw new Error('Only an original complete export can be selected.');
              if (S.selectedExports.has(id)) S.selectedExports.delete(id); else S.selectedExports.add(id); render();
            }, {disabled: !completedExport(opened)})),
        detail('Complete original export record', opened)));
    }
    const edition = S.sourceEditionId ?? (typeof r.customer?.edition === 'string' ? r.customer.edition : r.customer?.edition?.edition_id) ?? S.edition?.edition_id ?? '';
    section.append(node('section', {class: 'ldr-section'}, node('h4', {}, 'Prepare complete receiving files'),
      node('p', {class: 'ldr-muted'}, 'Source export retains every original file embedded in one edition. Whole warehouse handoff also retains the existing editions, selected views, saved recipes and native history.'),
      field('Edition for original source export', input('ldr-source-edition', edition, v => S.sourceEditionId = v, {disabled: S.sending, spellcheck: false})),
      node('div', {class: 'ldr-actions ldr-separated'},
        button('Export exact edition source', () => customerChange('source-handoff', {edition_id: hashId(S.sourceEditionId ?? edition, 'Edition')}), {disabled: blocked()}),
        button('Create complete warehouse handoff', () => customerChange('handoff', {}), {disabled: blocked(), primary: true}))));
    const packaging = node('section', {class: 'ldr-section'}, node('h4', {}, 'Assemble the receiving package'),
      node('p', {}, 'Choose a completed whole warehouse handoff and the specific complete reports or source exports to include. Packaging retains these existing results with this source and SF100 delivery.'),
      metadata([['Selected source delivery', r.id], ['Complete warehouse handoff', S.warehouseExport || 'Choose a completed whole handoff above']]));
    if (S.warehouseExport) packaging.append(button('Clear warehouse selection', () => { S.warehouseExport = ''; render(); }, {quiet: true}));
    if (S.selectedExports.size) packaging.append(node('ul', {class: 'ldr-list'}, [...S.selectedExports].map(id => node('li', {},
      node('code', {}, id), ' ', button('Remove', () => { S.selectedExports.delete(id); render(); }, {quiet: true})))));
    else packaging.append(node('p', {class: 'ldr-small ldr-muted'}, 'No optional report or edition-source export selected. Each can be added from its complete manifest.'));
    packaging.append(node('div', {class: 'ldr-actions ldr-separated'}, button('Create complete receiving package', async () => {
      const warehouse = S.exportRecords.get(S.warehouseExport);
      if (!warehouseHandoff(warehouse)) throw new Error('Open and choose a completed whole warehouse handoff first.');
      const selected = [...S.selectedExports];
      for (const id of selected) {
        const item = S.exportRecords.get(id);
        if (!completedExport(item) || warehouseHandoff(item)) throw new Error('Each optional selection must be a complete query or edition-source export.');
      }
      await mutate('/package', {deliveryId: selectedDelivery().id, warehouseExportId: S.warehouseExport, exports: selected});
    }, {primary: true, disabled: blocked() || !S.warehouseExport})));
    const completedPackages = currentRequests().filter(e => e.path === '/package' && e.state === 'COMPLETE' && e.body?.deliveryId === r.id);
    if (completedPackages.length) packaging.append(node('div', {class: 'ldr-actions ldr-separated'},
      ...completedPackages.map(e => button('Open package ' + short(e.id), () => { S.activePackage = e.id; S.packageRecords.set(e.id, e.operation.result); render(); }))));
    const packageResult = S.activePackage && S.packageRecords.get(S.activePackage);
    if (packageResult) packaging.append(node('div', {class: 'ldr-box'},
      node('h4', {}, 'Complete saved receiving package'),
      metadata([['Original request', S.activePackage], ['Delivery', packageResult.deliveryId], ['Manifest SHA-256', packageResult.manifestSha256]]),
      declaredFiles(packageResult.files, item => url('/package-file', {requestId: S.activePackage, name: item.name})),
      detail('Complete saved package result', packageResult)));
    section.append(packaging, node('section', {class: 'ldr-section'}, node('h4', {}, 'Reopen on the receiving host'),
      node('ol', {class: 'ldr-list'},
        node('li', {}, 'Download the complete package and keep its manifest with the ZIP. Verify the declared sizes and SHA-256 values before extracting.'),
        node('li', {}, 'Follow the included receiving guide to open the portable warehouse with the original customer service. Keep its warehouse identity and the complete retained original source files.'),
        node('li', {}, 'Open the original customer browser and read the saved views, edition mappings and SQL recipe revisions. The original local source and receiving result remain separate, retained records.'),
        node('li', {}, 'Use the saved Parquet, CSV and original source files directly. Reopening a completed handoff does not require another source capture or query export.')),
      node('p', {class: 'ldr-small ldr-muted'}, 'This publisher extension does not replace the original portable warehouse importer. The complete package includes its native receiving instructions.')));
    section.append(nativeOperationsPanel());
    return section;
  }
  function nativeOperationsPanel() {
    const section = node('section', {class: 'ldr-section'}, heading('Original customer request recovery', 'Read an existing export or handoff request before an explicit same-request resume.',
      [button('Read original request catalog', () => catalog('operations'))]));
    const page = S.catalogs.get('operations');
    if (page) section.append(table(['Original request', 'Kind / route', 'State', ''], page.operations.map(item => [
      node('code', {}, item.request_id || item.id), item.route || item.kind || '', badge(item.state),
      button('Read original status', () => readNativeOperation(item.request_id || item.id), {quiet: true})
    ])), catalogPager('operations', page));
    section.append(field('Original customer request ID', input('ldr-native-request', S.nativeLookup || '', v => S.nativeLookup = v, {spellcheck: false})),
      node('div', {class: 'ldr-actions ldr-separated'}, button('Read exact customer request', () => readNativeOperation(S.nativeLookup || ''))));
    if (S.nativeOperation) {
      const original = S.nativeOperation;
      section.append(detail('Complete retained original customer request', original));
      if (original.state === 'INTERRUPTED') section.append(button('Resume original customer request', () => customerChange('resume', {
        request_id: S.nativeOperationId
      }), {disabled: blocked()}));
    }
    return section;
  }

  async function openSavedResult(entry) {
    checkWorkspace(entry.workspaceId);
    if (entry.state !== 'COMPLETE' || !entry.operation || !Object.hasOwn(entry.operation, 'result')) {
      throw new Error('Read the original request until a complete saved result is returned.');
    }
    S.focusRequest = entry.id; S.savedResult = copy(entry.operation.result); render();
    const body = entry.body, result = entry.operation.result;
    const deliveryId = body?.deliveryId || (entry.path === '/prepare' ? entry.id : null);
    if (deliveryId && deliveryId !== S.selected) await readRecord(deliveryId, true);
    else if (deliveryId) await readRecord(deliveryId);
    if (entry.path === '/prepare' || entry.path === '/continue') S.tab = 'source';
    if (entry.path === '/package') { S.packageRecords.set(entry.id, result); S.activePackage = entry.id; S.tab = 'files'; }
    if (entry.path === '/customer') {
      if (body.operation === 'review') { S.tab = 'mapping'; await readMappingReview(result.review_id); }
      if (body.operation === 'import') { S.edition = result; S.sourceEditionId = result.edition_id; S.tab = 'views'; }
      if (body.operation === 'activate') { S.tab = 'views'; await allViews(); }
      if (body.operation === 'save-query') { useRecipe(result); S.tab = 'query'; }
      if (body.operation === 'query') { S.queryResult = result; S.tab = 'query'; }
      if (body.operation === 'compare') { S.comparison.result = result; S.tab = 'views'; }
      if (['export', 'source-handoff', 'handoff', 'resume'].includes(body.operation) && result.export_id) {
        S.exportRecords.set(result.export_id, result); S.openExport = result.export_id; S.tab = 'files';
      }
    }
    render();
  }
  function requestPanel() {
    const entries = currentRequests(), active = S.status?.active || entries.find(e => e.state === 'RUNNING');
    const important = entries.find(e => ['UNKNOWN', 'PREPARED', 'INTERRUPTED', 'RUNNING'].includes(e.state));
    const focus = S.requests.get(S.focusRequest) || important;
    const section = node('section', {class: 'ldr-section', 'aria-label': 'Original request recovery'},
      heading('Saved actions and recovery', 'Every action retains its exact input before dispatch. Reading status and opening a saved result never repeat the action.',
        [button('Refresh workspace status', () => refreshStatus())]));
    if (active) section.append(node('div', {class: 'ldr-pending'},
      node('h4', {}, 'An original operation is active'), metadata([['Request', active.id], ['Kind', active.kind]]),
      node('div', {class: 'ldr-actions'},
        button('Read active operation', () => readRequest(active.id, {watch: true})),
        ['continue', 'delivery', 'deliver'].includes(active.kind) ? button('Cancel current page operation', () => mutate('/cancel', {operationId: active.id}, {allowActive: true}),
          {disabled: S.sending || !S.storage}) : null)));
    if (unresolved()) section.append(node('div', {class: 'ldr-pending'},
      node('h4', {}, 'An original action needs reconciliation'),
      node('p', {}, 'Read its exact request ID. If the server returns a saved result, open that result. If it confirms the ID is absent, the exact retained body can be sent using the same request ID.')));
    const lookup = node('div', {class: 'ldr-form-grid'}, field('Read an original request ID', input('ldr-request-lookup', S.requestLookup || '', v => S.requestLookup = v,
      {spellcheck: false, placeholder: 'Original UUID'}), 'Useful after reopening the host or moving to a new browser session.', true));
    section.append(lookup, node('div', {class: 'ldr-actions ldr-separated'},
      button('Read original status', () => {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(S.requestLookup || '')) throw new Error('Enter the complete original request UUID.');
        return readRequest(S.requestLookup, {watch: true});
      })));
    if (entries.length) section.append(table(['Saved action', 'State', 'Updated', ''], entries.slice(0, S.requestLimit || 10).map(entry => [
      node('div', {}, node('strong', {}, entry.kind || 'Original action'), node('div', {class: 'ldr-mono ldr-small'}, short(entry.id))),
      badge(entry.state), time(entry.updatedAt || entry.createdAt),
      button('Open status', () => { S.focusRequest = entry.id; render(); }, {quiet: true})
    ])),
    entries.length > (S.requestLimit || 10) ? button('Show more saved actions', () => { S.requestLimit = (S.requestLimit || 10) + 25; render(); }, {quiet: true}) : null);
    if (focus) {
      const box = node('div', {class: 'ldr-box'},
        node('h4', {}, 'Original action ' + short(focus.id)),
        metadata([['Request', focus.id], ['Workspace', focus.workspaceId], ['Action', focus.kind], ['State', badge(focus.state)]]));
      if (focus.error) box.append(node('p', {class: 'ldr-muted'}, focus.error.message || text(focus.error)));
      if (focus.operation?.error) box.append(detail('Original operation error', focus.operation.error));
      box.append(node('div', {class: 'ldr-actions'},
        button('Read original status', () => readRequest(focus.id, {watch: true})),
        focus.state === 'COMPLETE' ? button('Open saved result', () => openSavedResult(focus), {primary: true}) : null,
        focus.state === 'INTERRUPTED' ? button('Resume original request', () => resumeOriginal(focus), {disabled: S.sending || !S.storage, primary: true}) : null,
        ['UNKNOWN', 'PREPARED', 'REJECTED'].includes(focus.state) && focus.path && focus.body ?
          button('Retry exact input only if absent', () => retryUnrecorded(focus), {disabled: S.sending || !S.storage}) : null,
        S.autoRequest === focus.id ? button('Pause status refresh', () => { stopReads(); render(); }, {quiet: true}) :
          focus.state === 'RUNNING' ? button('Follow current status', () => readRequest(focus.id, {watch: true}), {quiet: true}) : null));
      if (focus.operation) box.append(detail('Complete retained server result', focus.operation));
      if (focus.body) box.append(detail('Exact original input', focus.body));
      section.append(box);
    }
    if (!entries.length && !active) section.append(node('p', {class: 'ldr-muted'}, 'No actions are saved in this browser for the current workspace. Original delivery history and request lookup remain available.'));
    return section;
  }
  function render() {
    const active = document.activeElement;
    const focus = root.contains(active) && active.id ? {id: active.id, start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection} : null;
    const opened = [...root.querySelectorAll('details[open]')].map(d => d.dataset.key || d.querySelector('summary')?.textContent);
    const scrolls = [...root.querySelectorAll('.ldr-table-wrap,pre')].map((el, index) => ({index, left: el.scrollLeft, top: el.scrollTop}));
    const top = node('header', {class: 'ldr-header'},
      node('div', {}, node('p', {class: 'ldr-kicker'}, 'Original publisher / customer warehouse'),
        node('h2', {}, 'Local dataset receiving'), node('p', {class: 'ldr-subtitle'}, 'Reviewed source, complete receiving, saved analysis and engineer handover.')),
      node('div', {}, badge(S.status ? 'WORKSPACE_OPEN' : 'CONNECTING'), S.status ? node('p', {class: 'ldr-small ldr-muted'}, short(S.workspaceId)) : null));
    const content = node('div', {class: 'ldr-content', id: 'ldr-active-panel', role: 'tabpanel', 'aria-labelledby': 'ldr-tab-' + S.tab});
    if (!S.status) content.append(empty('Open the original local workspace', S.message || 'Reading the existing source and customer workspace identity…',
      button('Read workspace', () => refreshStatus({initial: true}))));
    else {
      if (S.storageError) content.append(node('div', {class: 'ldr-pending'},
        node('h4', {}, 'Local request storage needs attention'),
        node('p', {}, S.storageError),
        node('p', {}, 'Existing server results remain readable. Keep the original request ID and recover its server status before a new action.')));
      if (S.selected) content.append(node('div', {class: 'ldr-box ldr-soft'},
        node('div', {class: 'ldr-actions'}, node('strong', {}, 'Selected delivery'), node('code', {}, S.selected), S.record ? badge(S.record.state) : 'Reading…',
          button('Refresh saved delivery', () => readRecord(S.selected), {quiet: true}))));
      const panels = {source: sourcePanel, mapping: mappingPanel, views: viewsPanel, query: queryPanel, files: filesPanel};
      content.append(panels[S.tab](), requestPanel());
    }
    const sidebar = node('aside', {class: 'ldr-sidebar'}, node('nav', {class: 'ldr-tabs', role: 'tablist', 'aria-label': 'Receiving steps'},
      tabs.map(([id, title], index) => node('button', {type: 'button', class: 'ldr-tab', id: 'ldr-tab-' + id,
        role: 'tab', 'aria-controls': 'ldr-active-panel', 'aria-selected': S.tab === id, tabindex: S.tab === id ? 0 : -1,
        onclick: () => { S.tab = id; render(); },
        onkeydown: event => {
          if (!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
            (index + (['ArrowDown','ArrowRight'].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
          S.tab = tabs[next][0]; render(); document.getElementById('ldr-tab-' + S.tab)?.focus();
        }}, node('span', {class: 'ldr-tab-number'}, index + 1), title))),
      node('div', {class: 'ldr-side-note'}, node('strong', {}, 'One original customer workspace'),
        node('p', {}, S.status?.customer?.name || 'Customer identity is read from this host.'),
        S.status?.customer?.workspaceId ? node('code', {}, S.status.customer.workspaceId) : null),
      node('div', {class: 'ldr-side-note'}, node('strong', {}, 'Complete data stays retained'),
        node('p', {}, 'Previews are labeled. Full exports and the portable handoff keep the original source and saved history.')));
    root.replaceChildren(top,
      node('div', {class: 'ldr-notice', role: S.messageKind === 'error' ? 'alert' : 'status', 'aria-live': 'polite', 'data-kind': S.messageKind}, S.message),
      node('div', {class: 'ldr-body'}, sidebar, content));
    for (const d of root.querySelectorAll('details')) if (opened.includes(d.dataset.key || d.querySelector('summary')?.textContent)) d.open = true;
    const nowScrolls = [...root.querySelectorAll('.ldr-table-wrap,pre')];
    for (const prior of scrolls) if (nowScrolls[prior.index]) { nowScrolls[prior.index].scrollLeft = prior.left; nowScrolls[prior.index].scrollTop = prior.top; }
    if (focus) {
      const current = document.getElementById(focus.id);
      if (current && !current.disabled) {
        current.focus({preventScroll: true});
        if (typeof current.setSelectionRange === 'function' && typeof focus.start === 'number') {
          try { current.setSelectionRange(focus.start, focus.end, focus.direction); } catch { /* Number/checkbox inputs have no selection range. */ }
        }
      }
    }
  }
  window.addEventListener('publisher:change', () => { try { followPublisher(); } catch (error) { notice(error.message, 'error'); } });
  window.addEventListener('pagehide', () => { stopReads(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(S.timer); S.timer = null; }
    else if (S.autoRequest) beginReads(S.autoRequest);
  });
  render();
  try { S.storage = await openStorage(); S.storage.onversionchange = () => { S.storage.close(); S.storage = null; notice('Request storage changed in another tab. Reopen this tab before starting another action.', 'error'); }; }
  catch (error) { S.storageError = error.message; }
  try { await refreshStatus({initial: Boolean(S.storage)}); }
  catch (error) { notice(error.message, 'error'); }
  followPublisher();
})().catch(error => {
  const parent = document.getElementById('local-dataset-customer');
  if (parent) {
    const message = document.createElement('p');
    message.setAttribute('role', 'alert');
    message.textContent = 'The local receiving interface could not open: ' + (error.message || String(error)) + '. The original publisher and saved requests remain unchanged.';
    parent.append(message);
  }
});
