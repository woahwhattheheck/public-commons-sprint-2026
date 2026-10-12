// MIT. Complete private geographic handoff operator: original sources, GIS returns, review, dispatch and receiving.
(async function geographicHandoffApp() {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const count = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString() : '—';
  const short = value => String(value ?? '').slice(0, 12);
  const stamp = value => { const date = new Date(value); return value && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date) : '—'; };
  const bytes = value => value < 1024 ? count(value) + ' B' : value < 1048576 ? (value / 1024).toFixed(1) + ' KiB' : (value / 1048576).toFixed(1) + ' MiB';
  const list = value => Array.isArray(value) ? value : [];
  const unique = values => [...new Set(values)];
  const splitList = value => unique(String(value ?? '').split(',').map(x => x.trim()).filter(Boolean));
  const state = {
    workspace: null, launch: null, view: 'overview', busy: false, pending: null,
    sourceId: '', handoffId: '', returnId: '', dispatchId: '', handoff: null, returned: null, dispatch: null,
    source: null, query: '', offset: 0, limit: 100, selected: new Set(), reviewChoices: new Map(),
    draft: { source: {}, handoff: {}, returned: {}, decision: {}, dispatch: {}, receiving: {} }, epoch: 0
  };
  const operatorFields = ['assignedTeam', 'assetId', 'workOrderId', 'priority', 'action', 'dueDate', 'note'];
  const labels = { geometry: 'Location', assignedTeam: 'Assigned team', assetId: 'Asset ID', workOrderId: 'Work order ID', priority: 'Priority', action: 'Action', dueDate: 'Due date', note: 'Analyst note' };
  const views = new Set(['overview', 'sources', 'cases', 'packages', 'review', 'dispatch', 'receiving']);
  let databasePromise, searchTimer, noticeTimer, inspectionSequence = 0;
  const fileSequence = { source: 0, returned: 0, receiving: 0 };
  const apiUrl = (path, params = {}) => {
    const url = new URL(path, location.origin);
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    return url.pathname + url.search;
  };
  async function api(path, input) {
    const mutating = input !== undefined && path !== '/api/inspect-source';
    let response;
    try {
      response = await fetch(path, {
        method: input === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: input === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(input === undefined ? {} : { body: JSON.stringify(input) })
      });
    } catch (cause) {
      const error = new Error(mutating ? 'The local workspace connection was interrupted. Recover the saved action before repeating it.' : 'The local workspace connection was interrupted. Refresh or repeat the source inspection.');
      error.uncertain = mutating; error.cause = cause; throw error;
    }
    let result;
    try { result = await response.json(); }
    catch {
      const error = new Error('The local workspace returned an unreadable response. Refresh or recover the saved action.');
      error.uncertain = mutating; throw error;
    }
    if (!response.ok || result.ok === false) {
      const error = new Error(result.error?.message || 'The workspace could not complete this action.');
      error.code = result.error?.code; error.details = result.error?.details; error.status = response.status; throw error;
    }
    return Object.hasOwn(result, 'value') ? result.value : result;
  }
  function database() {
    return databasePromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('open311-geographic-handoff', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('saved');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  async function savedGet(key) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const request = db.transaction('saved').objectStore('saved').get(key);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  async function savedPut(key, value) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('saved', 'readwrite'), store = transaction.objectStore('saved');
      value === undefined ? store.delete(key) : store.put(value, key);
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
    });
  }
  const storageKey = kind => kind + ':directory:' + (state.launch?.directory || state.workspace?.directory || location.origin);
  async function retainDrafts() {
    try { await savedPut(storageKey('drafts'), state.draft); }
    catch { /* Current tab retains drafts when browser storage is unavailable. */ }
  }
  function notice(message, persistent = false) {
    clearTimeout(noticeTimer); $('#notice').textContent = message; $('#notice').hidden = false;
    if (!persistent) noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 9000);
  }
  function showError(error) {
    $('#error-title').textContent = error.code === 'REVISION_CONFLICT' ? 'The workspace has a newer edition' : 'The action needs attention';
    $('#error-message').textContent = error.message + (error.details ? '\n' + JSON.stringify(error.details, null, 2) : '');
    $('#error').hidden = false; $('#error').scrollIntoView({ block: 'nearest' });
  }
  function clearError() { $('#error').hidden = true; }
  function selectedHandoff() { return list(state.workspace?.handoffs).find(x => x.id === state.handoffId) || null; }
  function heads() { return list(state.workspace?.handoffs).filter(x => x.head !== false).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); }
  function chooseDefaults() {
    const workspace = state.workspace;
    if (!list(workspace.sources).some(x => x.id === state.sourceId)) state.sourceId = workspace.sources?.[0]?.id || '';
    if (!list(workspace.handoffs).some(x => x.id === state.handoffId)) {
      state.handoffId = heads()[0]?.id || workspace.handoffs?.[0]?.id || ''; state.offset = 0; state.selected.clear();
    }
    if (!list(workspace.returns).some(x => x.id === state.returnId)) state.returnId = list(workspace.returns).sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))[0]?.id || '';
    if (!list(workspace.dispatches).some(x => x.id === state.dispatchId)) state.dispatchId = list(workspace.dispatches).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]?.id || '';
  }
  async function refreshWorkspace() {
    state.workspace = await api('/api/state');
    if (state.launch && state.launch.workspaceId !== state.workspace.workspaceId) state.launch = await api('/api/launch');
    chooseDefaults();
    $('#workspace-name').textContent = state.workspace.name || 'Geographic workspace ' + short(state.workspace.workspaceId);
    $('#workspace-revision').textContent = 'Edition ' + count(state.workspace.revision) + ' · Updated ' + stamp(state.workspace.updatedAt || state.workspace.createdAt);
    $('#main').setAttribute('aria-busy', 'false');
  }
  async function refreshDetail() {
    const epoch = ++state.epoch, view = state.view, handoffId = state.handoffId, returnId = state.returnId, dispatchId = state.dispatchId, sourceId = state.sourceId;
    if ((view === 'cases' || view === 'packages') && handoffId) {
      const value = await api(apiUrl('/api/handoff', { id: handoffId, q: state.query, offset: state.offset, limit: state.limit }));
      if (epoch === state.epoch && handoffId === state.handoffId) state.handoff = value;
    } else if (view === 'review' && returnId) {
      const value = await api(apiUrl('/api/return', { id: returnId }));
      if (epoch === state.epoch && returnId === state.returnId) {
        state.returned = value;
        const retained = state.draft.decision.reviewChoices;
        if (!state.reviewChoices.size && retained?.returnId === returnId) state.reviewChoices = new Map(Object.entries(retained.values || {}));
        const available = new Set(reviewableChanges(value).map(change => change.id));
        for (const [id, choice] of state.reviewChoices) if (!available.has(id) || !['pending', 'accept', 'reject'].includes(choice)) state.reviewChoices.delete(id);
      }
    } else if (view === 'dispatch' && dispatchId) {
      const value = await api(apiUrl('/api/dispatch', { id: dispatchId }));
      if (epoch === state.epoch && dispatchId === state.dispatchId) state.dispatch = value;
    } else if (view === 'sources' && sourceId) {
      const value = await api(apiUrl('/api/source', { id: sourceId }));
      if (epoch === state.epoch && sourceId === state.sourceId) state.source = value;
    }
  }
  async function navigate(view, focus = true) {
    state.view = views.has(view) ? view : 'overview'; clearError();
    $$('.sidebar [data-view]').forEach(a => a.getAttribute('data-view') === state.view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
    await refreshDetail(); render();
    if (focus) $('#main').focus({ preventScroll: true });
  }
  async function clearPending() {
    state.pending = null;
    try { await savedPut(storageKey('pending'), undefined); } catch { /* A saved server operation remains recoverable. */ }
  }
  async function acceptResult(result, label) {
    if (result.handoff) { state.handoffId = result.handoff.id; state.offset = 0; state.selected.clear(); }
    if (result.source) state.sourceId = result.source.id;
    if (result.return) { state.returnId = result.return.id; state.reviewChoices.clear(); }
    if (result.returned) { state.returnId = result.returned.id; state.reviewChoices.clear(); }
    if (result.dispatch) state.dispatchId = result.dispatch.id;
    await clearPending(); await refreshWorkspace(); await refreshDetail(); render(); notice(label || 'The workspace edition is saved.');
  }
  async function mutate(path, input, label) {
    if (state.busy) return;
    if (state.pending) throw new Error('Recover the earlier action shown above before starting another workspace action.');
    state.busy = true;
    const operation = { path, input: { ...input, requestId: crypto.randomUUID(), expectedRevision: state.workspace.revision }, label, createdAt: new Date().toISOString() };
    state.pending = operation;
    try {
      await savedPut(storageKey('pending'), operation);
    } catch {
      notice('Browser storage is unavailable. Keep this tab open until the action returns; its request identity is retained here.', true);
    }
    render();
    try { const result = await api(path, operation.input); await acceptResult(result, label); return result; }
    catch (error) {
      if (!error.uncertain) { await clearPending(); await refreshWorkspace().catch(() => {}); }
      showError(error); render(); throw error;
    } finally { state.busy = false; render(); }
  }
  async function recoverPending(replay = false) {
    if (!state.pending || state.busy) return;
    state.busy = true; clearError(); render();
    try {
      const original = state.pending, operation = await api(apiUrl('/api/operation', { requestId: original.input.requestId }));
      if (operation?.state === 'SUCCEEDED') {
        await acceptResult(operation.result, original.label || 'The saved action has been recovered.');
      } else if (operation) {
        notice('The selected operation has state ' + operation.state + '. Its original request remains selected.', true);
      } else if (replay) {
        const result = await api(original.path, original.input);
        await acceptResult(result, original.label || 'The original action is saved.');
      } else {
        notice('The workspace has no saved result for this request. “Resume original action” will send its exact original input and identity.', true);
      }
    } catch (error) {
      if (!error.uncertain && error.status && error.status < 500) {
        await clearPending(); await refreshWorkspace().catch(() => {});
      }
      showError(error);
    } finally { state.busy = false; render(); }
  }
  const options = (items, selected, title = x => x.name || x.id, blank = '') =>
    (blank ? '<option value="">' + esc(blank) + '</option>' : '') + list(items).map(x => '<option value="' + esc(x.id) + '"' + (x.id === selected ? ' selected' : '') + '>' + esc(title(x)) + '</option>').join('');
  const badge = (label, kind = '') => '<span class="badge ' + esc(kind) + '">' + esc(label) + '</span>';
  const empty = (title, text, action = '') => '<div class="empty"><h2>' + esc(title) + '</h2><p>' + esc(text) + '</p>' + action + '</div>';
  const button = (action, text, data = '', primary = false) => '<button type="button" data-action="' + esc(action) + '" ' + data + ' class="' + (primary ? 'primary' : '') + '">' + esc(text) + '</button>';
  const viewLink = (view, text) => '<a href="#' + esc(view) + '">' + esc(text) + '</a>';
  const header = (title, text, actions = '') => '<div class="page-heading"><div><h1>' + esc(title) + '</h1><p>' + esc(text) + '</p></div>' + (actions ? '<div class="actions">' + actions + '</div>' : '') + '</div>';
  const metric = (number, text) => '<div class="metric"><strong>' + count(number) + '</strong><span>' + esc(text) + '</span></div>';
  function exportButtons(selection, compact = false) {
    const selector = Object.entries(selection).map(([k, v]) => 'data-' + k.replace(/[A-Z]/g, c => '-' + c.toLowerCase()) + '="' + esc(v) + '"').join(' ');
    return ['gpkg', 'geojson', 'csv', 'json', 'html'].map(kind => '<button type="button" class="' + (compact ? 'small' : '') + '" data-action="export" data-kind="' + kind + '" ' + selector + '>' + ({ gpkg: 'GeoPackage', geojson: 'GeoJSON', csv: 'CSV', json: 'Editable JSON', html: 'Report' }[kind]) + '</button>').join('');
  }
  function pendingBanner() {
    if (!state.pending) return '';
    return '<div class="pending-status" role="status"><strong>' + (state.busy ? 'Saving the workspace action…' : 'An original action is awaiting its saved result') + '</strong><p>Request ' + esc(state.pending.input.requestId) + ' · ' + esc(stamp(state.pending.createdAt)) + '</p><div class="actions">' + button('recover', 'Find saved result') + button('replay', 'Resume original action') + '</div></div>';
  }
  function renderOverview() {
    const handoff = selectedHandoff(), ws = state.workspace;
    return header('Geographic handoff', 'Prepare complete municipal cases for GIS work, review returned edits and deliver the accepted dispatch.') +
      '<div class="metrics">' + metric(list(ws.sources).length, 'Original source editions') + metric(handoff?.counts?.rows || 0, 'Rows in the selected handoff') +
      metric(list(ws.returns).length, 'Analyst returns retained') + metric(list(ws.dispatches).length, 'Reviewed dispatch packages') + '</div>' +
      '<div class="steps"><article class="step"><h3>Bring the source</h3><p>Import an original municipal collection or a complete reporting workspace. Source versions, geography and coverage travel together.</p>' + viewLink('sources', 'Open original sources') + '</article>' +
      '<article class="step"><h3>Work in GIS</h3><p>Create a handoff and download GeoPackage, GeoJSON, CSV or editable JSON. Receive the analyst’s returned file into the same work.</p>' + viewLink('packages', 'Open analyst packages') + '</article>' +
      '<article class="step"><h3>Review and dispatch</h3><p>Compare proposals with their source and accept the intended changes. Build the destination’s package from reviewed dispatch rows.</p>' + viewLink('review', 'Open returned edits') + '</article></div>' +
      '<div class="panel"><h2>Current handoff</h2>' + (handoff ? '<p><strong>' + esc(handoff.name) + '</strong> ' + badge(handoff.head ? 'Current edition' : 'Earlier edition') + '</p>' +
      '<div class="review-summary"><span>' + count(handoff.counts.rows) + ' rows</span><span>' + count(handoff.counts.located) + ' located cases</span><span>' + count(handoff.counts.unlocated) + ' without a valid point</span><span>' + count(handoff.counts.dispatchReady) + ' ready for dispatch</span></div><div class="actions">' + viewLink('cases', 'Inspect map and cases') + exportButtons({ handoffId: handoff.id }, true) + '</div>' : '<p>Create the first analyst handoff after importing a source.</p>' + viewLink('sources', 'Import an original source')) + '</div>' +
      '<div class="panel"><h2>Recent saved actions</h2>' + renderOperations() + '</div>';
  }
  function renderOperations() {
    const operations = list(state.workspace.operations).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.requestId).localeCompare(String(a.requestId))).slice(0, 8);
    if (!operations.length) return '<p class="muted">Saved source, review and dispatch actions will appear here.</p>';
    return '<div class="table-scroll"><table><thead><tr><th>Action</th><th>Saved</th><th>Request</th><th></th></tr></thead><tbody>' + operations.map(op =>
      '<tr><td>' + esc(op.kind || op.action || 'Workspace action') + '</td><td class="nowrap">' + esc(stamp(op.createdAt)) + '</td><td><code>' + esc(short(op.requestId)) + '</code></td><td>' + button('operation-detail', 'Open', 'data-request-id="' + esc(op.requestId) + '"') + '</td></tr>').join('') + '</tbody></table></div>';
  }
  function renderSources() {
    const draft = state.draft.source, inspection = draft.inspection;
    const source = state.source?.summary?.id === state.sourceId ? state.source : null;
    return header('Original sources', 'Import the complete collection or reporting workspace that contains the cases and their original source closure.') +
      '<div class="split"><section class="panel"><h2>Import a source edition</h2><form id="source-form" class="form-stack"><label>Original JSON file<input id="source-file" type="file" accept=".json,application/json"></label>' +
      (draft.filename ? '<p class="file-selected">' + esc(draft.filename) + ' · ' + bytes(new Blob([draft.originalText || '']).size) + '</p>' : '') +
      '<label>Source name<input name="name" data-draft="source" value="' + esc(draft.name || '') + '" placeholder="Boston October service collection"></label>' +
      (list(inspection?.reports).length ? '<label>Report selection<select id="source-report" name="reportId">' + options(inspection.reports, draft.reportId || inspection.selectedReportId, x => x.name + ' · ' + count(x.rows) + ' rows', 'Choose the report to import') + '</select><small>The complete original reporting workspace remains attached to this source.</small></label>' : '') +
      (inspection ? '<div class="callout"><strong>' + esc(inspection.kind) + '</strong><p>' + esc(inspection.name || draft.filename) + '</p>' +
        '<p>' + count(inspection.summary?.counts?.rows ?? inspection.summary?.rows ?? 0) + ' rows in the inspected selection · ' + bytes(inspection.bytes) + '</p><code>' + esc(inspection.sha256) + '</code></div>' : '<p class="section-note">Choose a file to inspect its original selection before importing it.</p>') +
      '<div class="actions"><button class="primary" type="submit" data-mutate' + (!draft.originalText || !inspection ? ' disabled' : '') + '>Import source edition</button></div></form></section>' +
      '<section class="panel"><h2>Saved sources</h2>' + (state.workspace.sources.length ? '<label>Select a source<select id="source-selection">' + options(state.workspace.sources, state.sourceId) + '</select></label>' +
        (source ? '<div class="form-actions"><div class="review-summary"><span>' + count(source.summary.counts.rows) + ' rows</span><span>' + count(source.summary.counts.located) + ' locations</span><span>' + count(source.summary.counts.invalidGeometry) + ' invalid coordinates</span></div></div>' +
          '<dl class="detail-grid"><dt>Imported</dt><dd>' + esc(stamp(source.summary.importedAt)) + '</dd><dt>Original size</dt><dd>' + bytes(source.summary.bytes) + '</dd><dt>Source type</dt><dd>' + esc(source.summary.kind) + '</dd></dl>' +
          '<div class="actions">' + button('export', 'Download original source', 'data-kind="source" data-source-id="' + esc(source.summary.id) + '"') + viewLink('packages', 'Create an analyst handoff') + '</div>' +
          '<details><summary>Original selection and attribution</summary><pre>' + esc(JSON.stringify({ connections: source.summary.connections, coverage: source.summary.coverage }, null, 2)) + '</pre></details>' : '<p class="section-note">Loading the selected source.</p>') :
        '<p class="muted">The workspace will retain every imported edition and its original file.</p>') + '</section></div>';
  }
  function handoffSelector(id = 'case-handoff') {
    return '<label>Handoff edition<select id="' + id + '">' + options(state.workspace.handoffs, state.handoffId, x => x.name + (x.head ? ' · current' : ' · ' + stamp(x.createdAt))) + '</select></label>';
  }
  function rowGeometry(row) {
    const point = row.geometry;
    return point?.type === 'Point' && Array.isArray(point.coordinates) && point.coordinates.length >= 2 && point.coordinates.every(Number.isFinite) &&
      Math.abs(point.coordinates[0]) <= 180 && Math.abs(point.coordinates[1]) <= 90 ? point.coordinates : null;
  }
  function renderMap(rows) {
    const points = rows.map(row => ({ row, point: rowGeometry(row) })).filter(x => x.point);
    if (!points.length) return '<div class="map-shell">' + empty('No point locations on this page', 'Cases with missing or invalid coordinates remain in the table and all complete exports.') + '</div>';
    const xs = points.map(x => x.point[0]), ys = points.map(x => x.point[1]);
    let west = Math.min(...xs), east = Math.max(...xs), south = Math.min(...ys), north = Math.max(...ys);
    const dx = Math.max(east - west, 0.002), dy = Math.max(north - south, 0.002);
    west -= dx * .06; east += dx * .06; south -= dy * .06; north += dy * .06;
    const x = lon => 60 + (lon - west) / (east - west) * 740, y = lat => 285 - (lat - south) / (north - south) * 255;
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const gx = 60 + i * 185, gy = 30 + i * 63.75, lon = west + (east - west) * i / 4, lat = north - (north - south) * i / 4;
      grid += '<line class="grid" x1="' + gx + '" y1="30" x2="' + gx + '" y2="285"/><text class="axis" x="' + gx + '" y="305" text-anchor="middle">' + lon.toFixed(4) + '</text>' +
        '<line class="grid" x1="60" y1="' + gy + '" x2="800" y2="' + gy + '"/><text class="axis" x="52" y="' + (gy + 4) + '" text-anchor="end">' + lat.toFixed(4) + '</text>';
    }
    return '<div class="map-shell"><div class="map-toolbar"><p>' + count(points.length) + ' locations on the current page</p><span class="badge">Longitude / latitude</span></div>' +
      '<svg class="geographic-map" viewBox="0 0 840 330" role="group" aria-label="Geographic overview of the current page, plotted by longitude and latitude">' + grid +
      points.map(({ row, point }) => '<circle class="point' + (state.selected.has(row.key) ? ' selected' : '') + '" cx="' + x(point[0]).toFixed(2) + '" cy="' + y(point[1]).toFixed(2) + '" r="4.5" role="button" tabindex="0" data-action="case-detail" data-key="' + esc(row.key) + '" aria-label="' + esc(row.serviceRequestId + ', ' + (row.serviceName || row.serviceCode) + ', ' + (row.address || 'source location')) + '"><title>' + esc(row.serviceRequestId + ' · ' + (row.address || row.serviceName || '')) + '</title></circle>').join('') +
      '</svg><div class="map-footnote">Coordinate overview of this page. Axes use the retained WGS84 longitude and latitude. Select a point to open its case.</div></div>';
  }
  function caseTable(rows, total, offset, selectable = true, handoffId = state.handoffId) {
    return '<div class="table-scroll"><table><thead><tr>' + (selectable ? '<th><input type="checkbox" id="select-page" aria-label="Select cases on this page"' + (rows.length && rows.every(x => state.selected.has(x.key)) ? ' checked' : '') + '></th>' : '') +
      '<th>Case / source service</th><th>Source status</th><th>Location</th><th>Analyst assignment</th><th>Action</th><th>Due</th></tr></thead><tbody>' +
      rows.map(row => '<tr class="' + (state.selected.has(row.key) ? 'selected' : '') + '">' +
        (selectable ? '<td><input type="checkbox" data-select-key="' + esc(row.key) + '" aria-label="Select case ' + esc(row.serviceRequestId) + '"' + (state.selected.has(row.key) ? ' checked' : '') + '></td>' : '') +
        '<td class="wide"><button type="button" class="link-button cell-title" data-action="case-detail" data-key="' + esc(row.key) + '" data-handoff-id="' + esc(handoffId) + '">' + esc(row.serviceRequestId) + '</button><span class="sub">' + esc(row.serviceName || row.serviceCode || 'Source service not supplied') + '</span>' + (row.sourceChanged ? badge('Source changed', 'outline') : '') + '</td>' +
        '<td>' + esc(row.sourceStatus || '—') + '<span class="sub">' + esc(stamp(row.updatedAt)) + '</span></td><td class="wide">' + esc(row.address || 'Address not supplied') + '<span class="sub">' + (rowGeometry(row) ? rowGeometry(row).map(n => n.toFixed(6)).join(', ') : esc(row.geometryStatus)) + '</span></td>' +
        '<td>' + esc(row.operator?.assignedTeam || '—') + '<span class="sub">' + esc(row.operator?.workOrderId || row.operator?.assetId || '') + '</span></td><td>' + badge(row.operator?.action || 'review', row.operator?.action === 'dispatch' && row.lastDecisionId ? 'strong' : '') +
        (row.lastDecisionId ? '<span class="sub">Reviewed</span>' : '') + '</td><td class="nowrap">' + esc(row.operator?.dueDate || '—') + '</td></tr>').join('') +
      '</tbody></table></div><div class="table-footer"><span>' + (total ? count(offset + 1) + '–' + count(Math.min(offset + rows.length, total)) + ' of ' + count(total) : 'No matching cases') + '</span>' +
      (selectable ? '<div class="actions"><button type="button" class="small" data-action="page-previous"' + (offset <= 0 ? ' disabled' : '') + '>Previous</button><button type="button" class="small" data-action="page-next"' + (offset + rows.length >= total ? ' disabled' : '') + '>Next</button></div>' : '') + '</div>';
  }
  function renderCases() {
    if (!state.workspace.handoffs.length) return header('Map and cases', 'Inspect the original geography and current analyst decisions.') + empty('Create an analyst handoff', 'A handoff selects the source editions and keeps each later source change linked.', viewLink('packages', 'Create a handoff'));
    const selected = state.handoff?.handoff?.id === state.handoffId ? state.handoff : null, rows = list(selected?.items);
    return header('Map and cases', 'Inspect source locations, assignment and review in the selected immutable handoff edition.') +
      '<div class="filters">' + handoffSelector() + '<label class="grow">Find a case<input id="case-query" type="search" value="' + esc(state.query) + '" placeholder="Case ID, service, address or description"></label><button type="button" data-action="clear-selection">Clear selection (' + count(state.selected.size) + ')</button></div>' +
      (selected ? '<div class="panel flat">' + renderMap(rows) + '</div><div class="panel flat"><div class="table-toolbar"><span>' + count(state.selected.size) + ' selected across pages</span><div class="actions">' + exportButtons({ handoffId: state.handoffId }, true) + '</div></div>' + caseTable(rows, selected.total, selected.offset) + '</div>' +
        '<p class="section-note">Downloads contain the complete saved handoff. Search and pagination control the working view.</p><details class="panel"><summary>Source selection and coverage</summary><pre>' + esc(JSON.stringify(selected.coverage, null, 2)) + '</pre></details>' : '<p class="muted">Loading the selected handoff.</p>');
  }
  function draftInput(group, name, title, value, extra = '') {
    return '<label>' + esc(title) + '<input name="' + esc(name) + '" data-draft="' + group + '" value="' + esc(value || '') + '" ' + extra + '></label>';
  }
  function renderPackages() {
    const draft = state.draft.handoff, sourceIds = list(draft.sourceIds).length ? draft.sourceIds : state.workspace.sources.map(x => x.id);
    const packages = [...state.workspace.handoffs].reverse();
    return header('Analyst packages', 'Create a complete working edition for an analyst and retain its earlier source and decision lineage.') +
      '<div class="split"><section class="panel"><h2>Create a handoff edition</h2>' + (state.workspace.sources.length ?
      '<form id="handoff-form" class="form-stack">' + draftInput('handoff', 'name', 'Handoff name', draft.name, 'required placeholder="Boston operations review"') +
      '<fieldset><legend>Original source editions</legend><div class="check-list">' + state.workspace.sources.map(s => '<label class="check-label"><input type="checkbox" name="sourceIds" value="' + esc(s.id) + '"' + (sourceIds.includes(s.id) ? ' checked' : '') + '><span>' + esc(s.name) + ' <small>' + count(s.counts.rows) + ' rows · ' + esc(stamp(s.importedAt)) + '</small></span></label>').join('') + '</div></fieldset>' +
      '<label>Continue an earlier handoff<select name="predecessorId" data-draft="handoff">' + options(state.workspace.handoffs, draft.predecessorId, x => x.name + ' · ' + stamp(x.createdAt), 'New independent handoff') + '</select><small>A source refresh stays in the same series. Changed original source versions are flagged for a fresh analyst review.</small></label>' +
      '<details><summary>Selection and initial assignment</summary><div class="form-grid">' +
      draftInput('handoff', 'q', 'Match source text', draft.q) + '<label>Geography<select name="geometry" data-draft="handoff"><option value="any">All source cases</option><option value="located"' + (draft.geometry === 'located' ? ' selected' : '') + '>Valid point locations</option><option value="unlocated"' + (draft.geometry === 'unlocated' ? ' selected' : '') + '>Missing or invalid locations</option></select></label>' +
      draftInput('handoff', 'statuses', 'Source statuses, separated by commas', draft.statuses) + draftInput('handoff', 'serviceCodes', 'Service codes, separated by commas', draft.serviceCodes) +
      draftInput('handoff', 'assignedTeam', 'Initial assigned team', draft.assignedTeam) + draftInput('handoff', 'assetId', 'Initial asset ID', draft.assetId) +
      draftInput('handoff', 'workOrderId', 'Initial work order ID', draft.workOrderId) + draftInput('handoff', 'priority', 'Initial priority', draft.priority) +
      draftInput('handoff', 'dueDate', 'Initial due date', draft.dueDate, 'type="date"') + '<label>Initial action<select name="action" data-draft="handoff">' +
      ['review', 'defer', 'dismiss', 'dispatch'].map(a => '<option value="' + a + '"' + ((draft.action || 'review') === a ? ' selected' : '') + '>' + esc(a) + '</option>').join('') + '</select></label><label class="full">Initial analyst note<textarea name="note" data-draft="handoff">' + esc(draft.note || '') + '</textarea></label></div></details>' +
      '<div class="form-actions"><button class="primary" type="submit" data-mutate>Create saved handoff</button></div></form>' :
      '<p>Import an original collection or reporting workspace to begin.</p>' + viewLink('sources', 'Open original sources')) + '</section>' +
      '<section class="panel"><h2>Saved working editions</h2><div class="package-list">' + (packages.length ? packages.map(h =>
        '<article class="package-card"><header><div><h3>' + esc(h.name) + '</h3><p>' + esc(stamp(h.createdAt)) + '</p></div>' + badge(h.head ? 'Current' : 'Earlier edition', h.head ? 'strong' : '') + '</header><p>' + count(h.counts.rows) + ' rows · ' + count(h.counts.located) + ' locations · ' + count(h.counts.changedSources) + ' changed source versions</p><div class="actions">' + exportButtons({ handoffId: h.id }, true) +
        '</div><div class="actions">' + button('open-handoff', 'Inspect cases', 'data-id="' + esc(h.id) + '"') + button('prepare-return', 'Receive analyst edits', 'data-id="' + esc(h.id) + '"') + button('continue-handoff', 'Continue with new sources', 'data-id="' + esc(h.id) + '"') + '</div></article>').join('') :
        '<p class="muted">Each exported edition and its reviewed successor will remain available here.</p>') + '</div></section></div>';
  }
  function renderReturnImport() {
    const draft = state.draft.returned, selectedId = draft.handoffId || state.handoffId;
    return '<section class="panel"><h2>Receive an analyst file</h2><form id="return-form" class="form-grid"><label class="full">Original handoff edition<select name="handoffId" data-draft="returned" required>' +
      options(state.workspace.handoffs, selectedId, x => x.name + ' · ' + stamp(x.createdAt), 'Select the edition the analyst received') + '</select></label>' +
      draftInput('returned', 'analyst', 'Analyst name', draft.analyst, 'required') + draftInput('returned', 'name', 'Return name', draft.name, 'placeholder="Field team review"') +
      '<label class="full">Returned file<input id="return-file" type="file" accept=".gpkg,.geojson,.json,.csv"></label>' +
      (draft.filename ? '<p class="full file-selected">' + esc(draft.filename) + ' · ' + bytes(draft.bytes || 0) + '</p>' : '') +
      '<label>Format<select name="format" data-draft="returned">' + ['gpkg', 'geojson', 'csv', 'json'].map(f => '<option value="' + f + '"' + ((draft.format || 'gpkg') === f ? ' selected' : '') + '>' + ({ gpkg: 'GeoPackage', geojson: 'GeoJSON', csv: 'CSV', json: 'Editable JSON' }[f]) + '</option>').join('') + '</select></label>' +
      '<p class="full section-note">The complete returned file is retained. Location and assignment changes become proposals; removed rows remain in the original handoff.</p><div class="full actions"><button class="primary" type="submit" data-mutate' + (!draft.originalText && !draft.contentBase64 ? ' disabled' : '') + '>Receive proposed edits</button></div></form></section>';
  }
  function fieldValue(object, field) {
    const name = String(field).replace(/^operator\./, '');
    if (name === 'geometry') return object?.geometry;
    return object?.operator?.[name] ?? object?.[name] ?? null;
  }
  function humanValue(value) {
    if (value == null || value === '') return 'Empty';
    if (value?.type === 'Point') return value.coordinates.join(', ');
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  function reviewedProposals(detail = state.returned) {
    const decisions = new Map();
    for (const decision of list(detail?.decisions)) {
      for (const id of list(decision.accept)) decisions.set(id, { choice: 'accepted', decision });
      for (const id of list(decision.reject)) decisions.set(id, { choice: 'rejected', decision });
    }
    return decisions;
  }
  function reviewableChanges(detail = state.returned) {
    const decisions = reviewedProposals(detail);
    return list(detail?.changes).filter(change => !decisions.has(change.id));
  }
  async function retainReviewChoices() {
    state.draft.decision.reviewChoices = { returnId: state.returnId, values: Object.fromEntries(state.reviewChoices) };
    await retainDrafts();
  }
  function renderReview() {
    const detail = state.returned?.summary?.id === state.returnId ? state.returned : null, draft = state.draft.decision;
    let review = '';
    if (detail) {
      const original = state.workspace.handoffs.find(x => x.id === detail.summary.handoffId), targets = state.workspace.handoffs.filter(x => x.head && (!original || x.seriesId === original.seriesId));
      const reviewed = reviewedProposals(detail), available = reviewableChanges(detail);
      const targetId = draft.handoffId && targets.some(x => x.id === draft.handoffId) ? draft.handoffId : targets.find(x => x.head)?.id || original?.id || '';
      const accepted = available.filter(x => state.reviewChoices.get(x.id) === 'accept').length, rejected = available.filter(x => state.reviewChoices.get(x.id) === 'reject').length;
      review = '<div class="review-summary"><span>' + count(available.length) + ' proposals awaiting review</span><span>' + count(reviewed.size) + ' already reviewed</span><span>' + count(detail.summary.counts.conflicts) + ' file conflicts</span><span>' + count(detail.summary.counts.missing) + ' original rows absent from return</span><span>' + count(detail.summary.counts.unchanged) + ' unchanged rows</span></div>' +
        '<div class="actions">' + button('export', 'Download original returned file', 'data-kind="returned" data-return-id="' + esc(detail.summary.id) + '"') +
        button('review-select-all', 'Accept remaining proposals') + button('review-clear', 'Clear proposal choices') + '</div>' +
        '<p class="section-note">Source columns and original versions remain fixed. Review compares each changed field with its saved baseline and the selected target edition.</p>' +
        list(detail.changes).map(change => {
          const saved = reviewed.get(change.id);
          const control = saved ? '<div><strong>' + (saved.choice === 'accepted' ? 'Accepted' : 'Rejected') + '</strong><p class="caption">' + esc(saved.decision.reviewer) + ' · ' + esc(stamp(saved.decision.createdAt)) + '</p></div>' :
            '<label>Decision<select data-review-choice="' + esc(change.id) + '">' + ['pending', 'accept', 'reject'].map(value => '<option value="' + value + '"' + ((state.reviewChoices.get(change.id) || 'pending') === value ? ' selected' : '') + '>' + ({ pending: 'Leave pending', accept: 'Accept proposal', reject: 'Reject proposal' }[value]) + '</option>').join('') + '</select></label>';
          return '<article class="review-card"><header><div><h3>Case ' + esc(change.serviceRequestId) + '</h3><p class="caption">' + count(list(change.fields).length) + ' changed fields · source ' + esc(short(change.sourceSha256)) + '</p></div>' + control + '</header><div class="review-body"><div class="table-scroll"><table><thead><tr><th>Field</th><th>Original baseline</th><th>Analyst proposal</th></tr></thead><tbody>' +
          list(change.fields).map(field => '<tr><td>' + esc(labels[String(field).replace(/^operator\./, '')] || field) + '</td><td class="change-value change-before">' + esc(humanValue(fieldValue(change.before, field))) + '</td><td class="change-value change-after">' + esc(humanValue(fieldValue(change.after, field))) + '</td></tr>').join('') +
          '</tbody></table></div><div class="actions">' + button('return-case-detail', 'Open original case', 'data-key="' + esc(change.key) + '" data-handoff-id="' + esc(detail.summary.handoffId) + '"') + '</div></div></article>'; }).join('') +
        (list(detail.conflicts).length ? '<section class="panel"><h3>Returned file conflicts</h3><p class="muted">These entries are retained for correction in the analyst file.</p><div class="table-scroll"><table><thead><tr><th>Returned row</th><th>Case key</th><th>Issue</th></tr></thead><tbody>' +
          detail.conflicts.map(conflict => '<tr><td>' + esc(conflict.rowNumber ?? '—') + '</td><td><code>' + esc(conflict.key || '—') + '</code></td><td>' + esc(conflict.message || conflict.code) + '<span class="sub">' + esc(conflict.code) + '</span></td></tr>').join('') + '</tbody></table></div></section>' : '') +
        (list(detail.missingKeys).length ? '<details class="panel"><summary>Original rows absent from this return (' + count(detail.missingKeys.length) + ')</summary><p>These original cases remain in the saved handoff.</p><pre>' + esc(detail.missingKeys.join('\n')) + '</pre></details>' : '') +
        '<section class="panel"><h3>Save the reviewed edition</h3><form id="decision-form" class="form-grid"><label>Target handoff edition<select name="handoffId" data-draft="decision" required>' + options(targets, targetId, x => x.name + (x.head ? ' · current' : ' · earlier')) + '</select></label>' +
        draftInput('decision', 'reviewer', 'Reviewer', draft.reviewer, 'required') + '<label class="full">Review note<textarea name="note" data-draft="decision">' + esc(draft.note || '') + '</textarea></label>' +
        '<p class="full caption">' + count(accepted) + ' accepted · ' + count(rejected) + ' rejected in this decision. Unselected proposals remain available.</p><div class="full actions"><button class="primary" type="submit" data-mutate' + (!accepted && !rejected ? ' disabled' : '') + '>Save reviewed edition</button></div></form></section>' +
        (list(detail.decisions).length ? '<details class="panel"><summary>Saved review history</summary><pre>' + esc(JSON.stringify(detail.decisions, null, 2)) + '</pre></details>' : '');
    }
    return header('Returned edits', 'Receive an analyst’s complete file, inspect proposals and save a reviewed successor to the handoff.') + renderReturnImport() +
      '<section class="panel"><h2>Review a saved return</h2>' + (state.workspace.returns.length ? '<label>Returned file<select id="return-selection">' + options(state.workspace.returns, state.returnId, x => (x.name || x.analyst) + ' · ' + stamp(x.receivedAt)) + '</select></label>' : '<p class="muted">Receive the first edited package to inspect its changes here.</p>') + '</section>' + review;
  }
  function renderDispatch() {
    const draft = state.draft.dispatch, handoffId = draft.handoffId || state.handoffId, detail = state.dispatch?.summary?.id === state.dispatchId ? state.dispatch : null;
    return header('Reviewed dispatch', 'Prepare the destination’s operational package from cases whose accepted review sets the dispatch action.') +
      '<div class="split"><section class="panel"><h2>Prepare a dispatch package</h2><form id="dispatch-form" class="form-stack">' +
      draftInput('dispatch', 'name', 'Dispatch name', draft.name, 'required placeholder="Boston field operations handoff"') + '<label>Reviewed handoff edition<select name="handoffId" data-draft="dispatch" required>' + options(state.workspace.handoffs, handoffId, x => x.name + ' · ' + count(x.counts.dispatchReady) + ' ready', 'Select a reviewed handoff') + '</select></label>' +
      draftInput('dispatch', 'destination', 'Receiving team or system', draft.destination, 'required placeholder="Public works dispatch"') +
      '<label>Row selection<select name="scope" data-draft="dispatch"><option value="all">All reviewed dispatch rows</option><option value="selected"' + (draft.scope === 'selected' ? ' selected' : '') + '>Selected map/table cases (' + count(state.selected.size) + ')</option></select><small>Selected cases must belong to the chosen handoff and have an accepted dispatch decision.</small></label>' +
      '<label>Dispatch note<textarea name="note" data-draft="dispatch">' + esc(draft.note || '') + '</textarea></label><details><summary>Destination column mapping</summary><p class="section-note">Optional array of {"name":"destination_column","field":"knownField"} entries. Original identity and source hashes remain in every mapped export.</p><label>Column mapping JSON<textarea class="mono" name="columns" data-draft="dispatch" placeholder=\'[{"name":"work_order","field":"workOrderId"}]\'>' + esc(draft.columns || '') + '</textarea></label></details>' +
      '<div class="form-actions"><button class="primary" type="submit" data-mutate>Prepare saved dispatch</button></div></form></section>' +
      '<section class="panel"><h2>Saved dispatch packages</h2>' + (state.workspace.dispatches.length ? '<label>Select a dispatch<select id="dispatch-selection">' + options(state.workspace.dispatches, state.dispatchId, x => x.name + ' · ' + x.destination) + '</select></label>' +
        (detail ? '<div class="form-actions"><div class="dispatch-summary"><div><strong>' + count(detail.summary.counts.rows) + '</strong><span>Reviewed rows</span></div><div><strong>' + count(detail.summary.counts.located) + '</strong><span>Point locations</span></div><div><strong>' + count(detail.summary.counts.unlocated) + '</strong><span>Without a point</span></div></div></div><p><strong>' + esc(detail.summary.destination) + '</strong><br><span class="muted">' + esc(stamp(detail.summary.createdAt)) + '</span></p><div class="actions">' +
          exportButtons({ dispatchId: detail.summary.id }) + '</div><p class="section-note">Download the complete editable workspace to transfer the original sources, analyst uploads and decisions with this dispatch.</p><div class="actions">' + button('save-workspace', 'Download complete workspace') + '</div><details><summary>Receiving instructions and source coverage</summary><pre>' + esc(JSON.stringify({ definition: detail.definition, coverage: detail.coverage, decisionIds: detail.decisionIds }, null, 2)) + '</pre></details>' : '') :
        '<p class="muted">Accepted analyst changes with the dispatch action become available for these packages.</p>') + '</section></div>' +
      (detail ? '<section class="panel flat"><div class="panel-header"><h2>Dispatch cases</h2><span>' + count(detail.rows.length) + ' rows</span></div>' + caseTable(list(detail.rows).slice(0, 100), detail.rows.length, 0, false, detail.summary.handoffId) + (detail.rows.length > 100 ? '<p class="section-note">The table previews the first 100 cases. Each downloaded dispatch contains all ' + count(detail.rows.length) + ' rows.</p>' : '') + '</section>' : '');
  }
  function renderReceiving() {
    const populated = ['sources', 'handoffs', 'returns', 'decisions', 'dispatches'].some(key => list(state.workspace[key]).length > 0), draft = state.draft.receiving;
    return header('Open a handover', 'Receive a complete geographic workspace into an empty initialized destination and continue its original source and review history.') +
      '<div class="split"><section class="panel"><h2>Receive the complete workspace</h2>' +
      (populated ? '<div class="callout"><p>This saved directory already contains source or review work. Open a new empty GIS workspace through Applications or the installed command line to receive a different handover.</p></div>' : '') +
      '<form id="receiving-form" class="form-stack"><label>Complete geographic workspace JSON<input id="receiving-file" type="file" accept=".json,application/json"' + (populated ? ' disabled' : '') + '></label>' +
      (draft.filename ? '<p class="file-selected">' + esc(draft.filename) + ' · ' + bytes(new Blob([draft.originalText || '']).size) + '</p>' : '') +
      '<p class="section-note">Receiving retains the original workspace identity, all source files, handoff editions, analyst uploads, decisions, dispatches and saved actions.</p><button class="primary" type="submit" data-mutate' + (populated || !draft.originalText ? ' disabled' : '') + '>Receive and open original workspace</button></form></section>' +
      '<section class="panel"><h2>Save the current handover</h2><p>Give the receiving operator the complete workspace JSON and the destination’s dispatch exports. They can reopen every original file and continue the same handoff series.</p><div class="actions">' +
      button('save-workspace', 'Download complete workspace', '', true) + '</div><dl class="detail-grid"><dt>Workspace</dt><dd><code>' + esc(state.workspace.workspaceId) + '</code></dd><dt>Current edition</dt><dd>' + count(state.workspace.revision) + '</dd><dt>Original sources</dt><dd>' + count(state.workspace.sources.length) + '</dd><dt>Saved handoffs</dt><dd>' + count(state.workspace.handoffs.length) + '</dd></dl></section></div>';
  }
  function render() {
    if (!state.workspace) return;
    const content = { overview: renderOverview, sources: renderSources, cases: renderCases, packages: renderPackages, review: renderReview, dispatch: renderDispatch, receiving: renderReceiving }[state.view]();
    const active = document.activeElement, focusId = active?.id, selectionStart = active && 'selectionStart' in active ? active.selectionStart : null, selectionEnd = active && 'selectionEnd' in active ? active.selectionEnd : null;
    $('#main').innerHTML = pendingBanner() + content; $('#main').setAttribute('aria-busy', String(state.busy));
    $('#download-workspace').disabled = state.busy;
    $$('[data-mutate]').forEach(el => { if (state.busy || state.pending) el.disabled = true; });
    $$('[data-action="recover"],[data-action="replay"]').forEach(el => { el.disabled = state.busy; });
    if (focusId && /^[A-Za-z][A-Za-z0-9_-]*$/.test(focusId)) {
      const replacement = document.getElementById(focusId);
      if (replacement && $('#main').contains(replacement)) {
        replacement.focus({ preventScroll: true });
        if (selectionStart !== null && typeof replacement.setSelectionRange === 'function') try { replacement.setSelectionRange(selectionStart, selectionEnd); } catch {}
      }
    }
  }
  async function download(kind, selection = {}) {
    clearError();
    const response = await fetch(apiUrl('/api/export', { kind, ...selection, expectedRevision: state.workspace.revision }), { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})); const error = new Error(result.error?.message || 'The selected export could not be read.');
      error.code = result.error?.code; error.details = result.error?.details; throw error;
    }
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const filename = (disposition.match(/filename="([^"]+)"/)?.[1] || ('open311-gis-' + kind + '.' + ({ gpkg: 'gpkg', csv: 'csv', html: 'html', geojson: 'geojson' }[kind] || 'json'))).replace(/[\\/\u0000-\u001f]/g, '_');
    const objectUrl = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = objectUrl; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000); notice('Downloaded ' + filename + ' · ' + bytes(blob.size));
  }
  async function showCase(key, handoffId = state.handoffId) {
    const result = await api(apiUrl('/api/row', { handoffId, key })), row = result.row;
    $('#detail-title').textContent = 'Case ' + row.serviceRequestId;
    $('#detail-content').innerHTML = '<dl class="detail-grid"><dt>Handoff</dt><dd>' + esc(result.handoff.name) + '</dd><dt>Service</dt><dd>' + esc(row.serviceName || row.serviceCode || 'Not supplied') + '</dd><dt>Source status</dt><dd>' + esc(row.sourceStatus || 'Not supplied') + '</dd><dt>Address</dt><dd>' + esc(row.address || 'Not supplied') + '</dd><dt>Current location</dt><dd>' + esc(humanValue(row.geometry)) + '</dd><dt>Original location</dt><dd>' + esc(humanValue(row.originalGeometry)) + '</dd><dt>Created at source</dt><dd>' + esc(row.requestedAt || 'Not supplied') + '</dd><dt>Updated at source</dt><dd>' + esc(row.updatedAt || 'Not supplied') + '</dd><dt>Source closed at</dt><dd>' + esc(row.sourceClosedAt || 'Not supplied') + '</dd></dl>' +
      '<h3>Original description</h3><p class="detail-description">' + esc(row.description || 'Not supplied') + '</p><h3>Original source status notes</h3><p class="detail-description">' + esc(row.sourceStatusNotes || 'Not supplied') + '</p>' +
      '<h3>Current analyst assignment</h3><dl class="detail-grid">' + operatorFields.map(field => '<dt>' + esc(labels[field]) + '</dt><dd>' + esc(row.operator?.[field] || '—') + '</dd>').join('') + '</dl>' +
      (row.sourceChanged ? '<div class="callout">The original source changed in this handoff edition. Current source and earlier observations remain linked below.</div>' : '') +
      '<details><summary>Original source record</summary><pre>' + esc(JSON.stringify(row.source, null, 2)) + '</pre></details><details><summary>Source observation history (' + count(list(result.versions).length) + ')</summary><pre>' + esc(JSON.stringify(result.versions, null, 2)) + '</pre></details><details><summary>Source review and report context</summary><pre>' + esc(JSON.stringify({ sourceReview: row.sourceReview, reportContext: row.reportContext }, null, 2)) + '</pre></details>';
    $('#detail-dialog').showModal();
  }
  async function inspectSource(reportId) {
    const draft = state.draft.source, sequence = ++inspectionSequence;
    if (!draft.originalText) return;
    const result = await api('/api/inspect-source', { originalText: draft.originalText, ...(reportId ? { reportId } : {}) });
    if (sequence !== inspectionSequence || state.draft.source !== draft) return;
    draft.inspection = result; draft.reportId = result.selectedReportId || reportId || '';
    if (!draft.name) draft.name = result.name || draft.filename.replace(/\.json$/i, '');
    await retainDrafts(); render();
  }
  async function readOriginalUtf8(file) {
    const data = await file.arrayBuffer();
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data); }
    catch { throw new Error('Choose a UTF-8 source or analyst file. The selected file could not be decoded without changing its original bytes.'); }
  }
  async function fileSelection(input, kind) {
    const file = input.files?.[0]; if (!file) return;
    const sequence = ++fileSequence[kind];
    if (file.size > 64 * 1024 * 1024) throw new Error('This browser intake accepts files up to 64 MiB. Use the installed command line for a larger original package.');
    if (kind === 'source') {
      const originalText = await readOriginalUtf8(file); if (sequence !== fileSequence[kind]) return;
      state.draft.source = { ...state.draft.source, originalText, filename: file.name, inspection: null, reportId: '' };
      await retainDrafts(); await inspectSource();
    } else if (kind === 'returned') {
      const format = /\.gpkg$/i.test(file.name) ? 'gpkg' : /\.geojson$/i.test(file.name) ? 'geojson' : /\.csv$/i.test(file.name) ? 'csv' : 'json';
      const draft = { ...state.draft.returned, filename: file.name, bytes: file.size, format, originalText: undefined, contentBase64: undefined };
      if (format === 'gpkg') {
        const data = new Uint8Array(await file.arrayBuffer()); let binary = '';
        for (let offset = 0; offset < data.length; offset += 16384) binary += String.fromCharCode(...data.subarray(offset, offset + 16384));
        draft.contentBase64 = btoa(binary);
      } else draft.originalText = await readOriginalUtf8(file);
      if (sequence !== fileSequence[kind]) return;
      state.draft.returned = draft; await retainDrafts(); render();
    } else {
      const originalText = await readOriginalUtf8(file); if (sequence !== fileSequence[kind]) return;
      state.draft.receiving = { filename: file.name, originalText }; await retainDrafts(); render();
    }
  }
  const formObject = form => Object.fromEntries(new FormData(form).entries());
  async function submitForm(form) {
    if (state.busy) return;
    if (state.pending) throw new Error('Recover the earlier action shown above before starting another workspace action.');
    clearError();
    const input = formObject(form);
    if (form.id === 'source-form') {
      const draft = state.draft.source; if (!draft.originalText || !draft.inspection) throw new Error('Inspect a complete original source file first.');
      const reports = list(draft.inspection.reports), reportId = input.reportId || draft.reportId;
      if (reports.length > 1 && !reportId) throw new Error('Choose the report to import from this complete workspace.');
      const result = await mutate('/api/import', { originalText: draft.originalText, ...(reportId ? { reportId } : {}), name: input.name || undefined }, 'The original source edition is saved.');
      if (result) { state.draft.source = {}; await retainDrafts(); render(); }
    } else if (form.id === 'handoff-form') {
      const sourceIds = new FormData(form).getAll('sourceIds');
      if (!sourceIds.length) throw new Error('Choose at least one original source edition.');
      const defaults = Object.fromEntries(operatorFields.map(field => [field, input[field] || (field === 'action' ? 'review' : '')]));
      const definition = { name: input.name, sourceIds, ...(input.predecessorId ? { predecessorId: input.predecessorId } : {}),
        filters: { q: input.q || '', statuses: splitList(input.statuses), serviceCodes: splitList(input.serviceCodes), geometry: input.geometry || 'any' }, defaults };
      await mutate('/api/handoff', { definition }, 'The complete analyst handoff edition is saved.');
    } else if (form.id === 'return-form') {
      const draft = state.draft.returned;
      if (!draft.originalText && !draft.contentBase64) throw new Error('Choose the complete returned file.');
      if ((input.format === 'gpkg') !== Boolean(draft.contentBase64)) throw new Error('The selected format must match the returned file. Choose the correct original file.');
      const result = await mutate('/api/return', { handoffId: input.handoffId, analyst: input.analyst, name: input.name || undefined, format: input.format,
        ...(input.format === 'gpkg' ? { contentBase64: draft.contentBase64 } : { originalText: draft.originalText }) }, 'The original analyst file and its proposals are saved.');
      if (result) {
        const returned = result.return || result.returned;
        if (returned) state.returnId = returned.id;
        state.draft.returned = { analyst: input.analyst, handoffId: input.handoffId }; await retainDrafts(); await refreshDetail(); render();
      }
    } else if (form.id === 'decision-form') {
      const changes = reviewableChanges(), accept = changes.filter(x => state.reviewChoices.get(x.id) === 'accept').map(x => x.id), reject = changes.filter(x => state.reviewChoices.get(x.id) === 'reject').map(x => x.id);
      if (!accept.length && !reject.length) throw new Error('Choose at least one proposal to accept or reject.');
      const result = await mutate('/api/decision', { selection: { returnId: state.returnId, handoffId: input.handoffId, reviewer: input.reviewer, note: input.note || '', accept, reject } }, 'The review and its new handoff edition are saved.');
      if (result) { state.reviewChoices.clear(); state.draft.decision.handoffId = state.handoffId; await retainReviewChoices(); await refreshDetail(); render(); }
    } else if (form.id === 'dispatch-form') {
      let columns;
      if (String(input.columns || '').trim()) { try { columns = JSON.parse(input.columns); } catch { throw new Error('Destination column mapping must be a complete JSON array.'); } if (!Array.isArray(columns)) throw new Error('Destination column mapping must be an array.'); }
      if (input.scope === 'selected' && (!state.selected.size || input.handoffId !== state.handoffId)) throw new Error('Select cases in Map and cases for this exact handoff before choosing a selected dispatch.');
      const definition = { name: input.name, handoffId: input.handoffId, destination: input.destination, note: input.note || '',
        ...(input.scope === 'selected' ? { keys: [...state.selected] } : {}), ...(columns ? { columns } : {}) };
      await mutate('/api/dispatch', { definition }, 'The complete reviewed dispatch is saved.');
    } else if (form.id === 'receiving-form') {
      if (!state.draft.receiving.originalText) throw new Error('Choose the complete geographic workspace JSON.');
      const result = await mutate('/api/receive', { originalText: state.draft.receiving.originalText }, 'The original geographic workspace is received and open.');
      if (result) { state.draft.receiving = {}; await retainDrafts(); location.hash = '#overview'; }
    }
  }
  async function action(element) {
    const kind = element.dataset.action; clearError();
    if (kind === 'export') return download(element.dataset.kind, {
      handoffId: element.dataset.handoffId, dispatchId: element.dataset.dispatchId, sourceId: element.dataset.sourceId, returnId: element.dataset.returnId
    });
    if (kind === 'save-workspace') return download('workspace');
    if (kind === 'recover' || kind === 'replay') return recoverPending(kind === 'replay');
    if (kind === 'case-detail' || kind === 'return-case-detail') return showCase(element.dataset.key, element.dataset.handoffId || state.handoffId);
    if (kind === 'open-handoff') { state.handoffId = element.dataset.id; state.offset = 0; state.query = ''; state.selected.clear(); location.hash = '#cases'; if (state.view === 'cases') await navigate('cases'); }
    else if (kind === 'prepare-return') { state.draft.returned.handoffId = element.dataset.id; await retainDrafts(); location.hash = '#review'; }
    else if (kind === 'continue-handoff') { state.draft.handoff.predecessorId = element.dataset.id; state.draft.handoff.sourceIds = state.workspace.sources.map(x => x.id); await retainDrafts(); render(); $('#handoff-form input[name="name"]')?.focus(); }
    else if (kind === 'page-previous' || kind === 'page-next') { state.offset = Math.max(0, state.offset + (kind === 'page-next' ? state.limit : -state.limit)); await refreshDetail(); render(); }
    else if (kind === 'clear-selection') { state.selected.clear(); render(); }
    else if (kind === 'review-select-all') { reviewableChanges().forEach(change => state.reviewChoices.set(change.id, 'accept')); await retainReviewChoices(); render(); }
    else if (kind === 'review-clear') { state.reviewChoices.clear(); await retainReviewChoices(); render(); }
    else if (kind === 'operation-detail') {
      const original = await api(apiUrl('/api/operation', { requestId: element.dataset.requestId }));
      $('#detail-title').textContent = 'Saved workspace action';
      $('#detail-content').innerHTML = '<dl class="detail-grid"><dt>Action</dt><dd>' + esc(original?.kind || '') + '</dd><dt>State</dt><dd>' + esc(original?.state || 'No saved result') + '</dd><dt>Request</dt><dd><code>' + esc(original?.requestId || element.dataset.requestId) + '</code></dd></dl><pre>' + esc(JSON.stringify(original?.result || original, null, 2)) + '</pre>';
      $('#detail-dialog').showModal();
    }
  }
  document.addEventListener('submit', event => {
    if (!event.target.matches('#source-form,#handoff-form,#return-form,#decision-form,#dispatch-form,#receiving-form')) return;
    event.preventDefault(); void submitForm(event.target).catch(showError);
  });
  document.addEventListener('click', event => {
    const element = event.target.closest('[data-action]'); if (!element || element.disabled) return;
    event.preventDefault(); void action(element).catch(showError);
  });
  document.addEventListener('keydown', event => {
    const point = event.target.closest('svg [data-action]');
    if (point && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); void action(point).catch(showError); }
  });
  document.addEventListener('input', event => {
    const element = event.target;
    if (element.dataset.draft && element.name) { state.draft[element.dataset.draft][element.name] = element.value; void retainDrafts(); }
    if (element.id === 'case-query') {
      state.query = element.value; state.offset = 0; clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { void refreshDetail().then(render).catch(showError); }, 280);
    }
  });
  document.addEventListener('change', event => {
    const element = event.target;
    if (element.dataset.draft && element.name) { state.draft[element.dataset.draft][element.name] = element.value; void retainDrafts(); }
    if (element.id === 'source-file') void fileSelection(element, 'source').catch(showError);
    else if (element.id === 'source-report') void inspectSource(element.value).catch(showError);
    else if (element.id === 'return-file') void fileSelection(element, 'returned').catch(showError);
    else if (element.id === 'receiving-file') void fileSelection(element, 'receiving').catch(showError);
    else if (element.id === 'source-selection') { state.sourceId = element.value; void refreshDetail().then(render).catch(showError); }
    else if (element.id === 'case-handoff') { state.handoffId = element.value; state.offset = 0; state.query = ''; state.selected.clear(); void refreshDetail().then(render).catch(showError); }
    else if (element.id === 'return-selection') { state.returnId = element.value; state.reviewChoices.clear(); state.draft.decision.handoffId = ''; void refreshDetail().then(render).catch(showError); }
    else if (element.id === 'dispatch-selection') { state.dispatchId = element.value; void refreshDetail().then(render).catch(showError); }
    else if (element.dataset.selectKey) { element.checked ? state.selected.add(element.dataset.selectKey) : state.selected.delete(element.dataset.selectKey); render(); }
    else if (element.id === 'select-page') { list(state.handoff?.items).forEach(row => element.checked ? state.selected.add(row.key) : state.selected.delete(row.key)); render(); }
    else if (element.dataset.reviewChoice) { if (reviewableChanges().some(change => change.id === element.dataset.reviewChoice)) { state.reviewChoices.set(element.dataset.reviewChoice, element.value); void retainReviewChoices(); } render(); }
    else if (element.name === 'sourceIds') { state.draft.handoff.sourceIds = $$('input[name="sourceIds"]:checked').map(x => x.value); void retainDrafts(); }
  });
  $('#refresh-workspace').addEventListener('click', () => { if (state.busy) return; void refreshWorkspace().then(refreshDetail).then(() => { render(); notice('The current saved workspace is loaded.'); }).catch(showError); });
  $('#download-workspace').addEventListener('click', () => { void download('workspace').catch(showError); });
  $('#dismiss-error').addEventListener('click', clearError);
  $('#close-detail').addEventListener('click', () => $('#detail-dialog').close());
  $('#close-download').addEventListener('click', () => $('#download-dialog').close());
  window.addEventListener('hashchange', () => { void navigate(location.hash.slice(1)).catch(showError); });
  try {
    state.launch = await api('/api/launch'); await refreshWorkspace();
    try {
      const [drafts, pending] = await Promise.all([savedGet(storageKey('drafts')), savedGet(storageKey('pending'))]);
      if (drafts) for (const key of Object.keys(state.draft)) if (drafts[key] && typeof drafts[key] === 'object') state.draft[key] = drafts[key];
      if (pending?.input?.requestId && pending?.path) state.pending = pending;
    } catch { /* Native saved work remains available without browser storage. */ }
    await navigate(location.hash.slice(1) || 'overview', false);
    if (state.pending) await recoverPending(false);
  } catch (error) { $('#main').setAttribute('aria-busy', 'false'); showError(error); }
})();
