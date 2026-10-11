'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  const numberFormat = new Intl.NumberFormat();
  const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/;
  const terminalStates = new Set(['COMPLETED', 'CONSUMED', 'RELEASED']);
  const state = {
    capability: '', actor: '', routes: new Map(), passes: new Map(),
    passAfter: null, inventoryLoading: false, inventoryVersion: 0,
    selectedRef: null, selectedPass: null, detailVersion: 0,
    calls: new Map(), callAfter: null, callsLoading: false, callsVersion: 0,
    selectedRequest: null, refreshing: false, operations: new Map(),
    controllers: new Set()
  };

  class APIError extends Error {
    constructor(code, status, uncertain) {
      super(code);
      this.code = code;
      this.status = status;
      this.uncertain = uncertain;
    }
  }

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined && text !== null) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }

  function display(value, fallback) {
    return value === null || value === undefined || value === '' ? (fallback || '—') : String(value);
  }

  function units(value) {
    return typeof value === 'number' && Number.isFinite(value) ? numberFormat.format(value) : display(value);
  }

  function date(value) {
    if (!value) return 'None';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
  }

  function label(value) {
    const labels = {
      AVAILABLE: 'Available', SUSPENDED: 'Suspended', EXPIRED: 'Expired',
      AWAITING_ENTITLEMENT: 'Awaiting payment', ENTITLED: 'Entitled', PENDING: 'Pending',
      IN_FLIGHT: 'In progress', RECOVERY_REQUIRED: 'Needs resolution', COMPLETED: 'Completed',
      CONSUMED: 'Consumed; result pending', RELEASED: 'Released',
      CURRENT: 'Current', REPAIR_REQUIRED: 'Needs repair'
    };
    return labels[value] || display(value);
  }

  function announce(message, error) {
    $('workspace-message').textContent = message;
    $('workspace-message').dataset.tone = error ? 'error' : 'info';
    $('workspace-message').hidden = !message;
  }

  function errorMessage(error) {
    if (error instanceof APIError) {
      if (error.status === 409) return error.code + '. Refresh the affected pass or request, then review its current revision.';
      if (error.status === 401 || error.status === 403) return error.code + '. Check the active console link and request details.';
      if (error.uncertain) return error.code + '. The outcome is unavailable; the saved request can be retried.';
      return error.code;
    }
    return error && error.message ? error.message : 'The request could not be completed.';
  }

  async function api(path, options) {
    if (!state.capability) throw new APIError('Connect to the merchant console first', 401, false);
    const controller = new AbortController();
    state.controllers.add(controller);
    const headers = {Accept: 'application/json', Authorization: 'Bearer ' + state.capability};
    const settings = {method: 'GET', mode: 'same-origin', credentials: 'omit',
      cache: 'no-store', redirect: 'error', headers: headers, signal: controller.signal};
    if (options && options.body !== undefined) {
      settings.method = 'POST';
      headers['Content-Type'] = 'application/json';
      settings.body = options.body;
    }
    try {
      let response;
      try {
        response = await fetch(path, settings);
      } catch (_) {
        throw new APIError('Connection interrupted', null, true);
      }
      let value;
      try {
        value = JSON.parse(await response.text());
      } catch (_) {
        throw new APIError('The console returned an unreadable response', response.status, true);
      }
      if (!response.ok || (value && value.ok === false)) {
        const code = value && typeof value.error === 'string' ? value.error : 'HTTP ' + response.status;
        throw new APIError(code, response.status, response.status >= 500);
      }
      return value;
    } finally {
      state.controllers.delete(controller);
    }
  }

  function requireList(value, key) {
    if (!value || !Array.isArray(value[key])) throw new APIError('Unexpected ' + key + ' response', null, true);
    return value[key];
  }

  function controlState() {
    const connected = Boolean(state.capability);
    $('refresh-all').disabled = !connected || state.refreshing;
    $('disconnect').hidden = !connected;
    $('passes-more').disabled = !connected || state.inventoryLoading;
    $('calls-more').disabled = !connected || state.callsLoading;
    $('refresh-calls').disabled = !connected || !state.selectedRef || state.callsLoading;
    $('access-submit').disabled = !connected || !state.selectedPass;
    const selected = state.calls.get(state.selectedRequest);
    $('resolve-submit').disabled = !connected || !selected || selected.status !== 'RECOVERY_REQUIRED';
  }

  function renderInventory() {
    const items = [];
    state.passes.forEach(function (pass, ref) {
      const button = node('button', null, 'pass-row');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(ref === state.selectedRef));
      button.append(node('span', pass.plan && pass.plan.title || ref, 'pass-name'));
      button.append(node('span', ref, 'pass-ref mono'));
      button.append(node('span', units(pass.usage && pass.usage.availableUnits) + ' available / ' +
        units(pass.usage && pass.usage.allowanceUnits) + ' units', 'pass-usage'));
      button.append(node('span', label(pass.native && pass.native.access && pass.native.access.state), 'pass-state'));
      button.addEventListener('click', function () { run(function () { return choosePass(ref, true); }); });
      const item = node('li');
      item.append(button);
      items.push(item);
    });
    $('pass-list').replaceChildren.apply($('pass-list'), items);
    $('inventory-summary').textContent = state.inventoryLoading ? 'Loading passes…' :
      units(state.passes.size) + (state.passes.size === 1 ? ' pass loaded' : ' passes loaded');
    $('inventory-empty').hidden = state.inventoryLoading || state.passes.size > 0;
    $('passes-more').hidden = !state.passAfter;
    $('pass-list').setAttribute('aria-busy', String(state.inventoryLoading));
    controlState();
  }

  async function loadPasses(reset) {
    if (state.inventoryLoading && !reset) return;
    const generation = ++state.inventoryVersion;
    state.inventoryLoading = true;
    renderInventory();
    const query = new URLSearchParams({limit: '100'});
    if (!reset && state.passAfter) query.set('after', state.passAfter);
    try {
      const value = await api('/api/passes?' + query.toString());
      const passes = requireList(value, 'passes');
      if (generation !== state.inventoryVersion || !state.capability) return;
      if (reset) state.passes.clear();
      passes.forEach(function (pass) {
        if (pass && typeof pass.orderRef === 'string') state.passes.set(pass.orderRef, pass);
      });
      state.passAfter = value.nextAfter || null;
    } finally {
      if (generation === state.inventoryVersion) {
        state.inventoryLoading = false;
        renderInventory();
      }
    }
  }

  async function loadRoutes() {
    const value = await api('/api/routes');
    const routes = requireList(value, 'routes');
    state.routes = new Map(routes.map(function (route) { return [route.id, route]; }));
    state.actor = display(value.actor, 'Merchant operator');
    $('operator-name').textContent = state.actor;
    if (state.selectedPass) renderDetail(false);
  }

  function renderDetail(resetForms) {
    const pass = state.selectedPass;
    if (!pass) return;
    const native = pass.native || {};
    const access = native.access || {};
    const usage = pass.usage || {};
    $('pass-reference').textContent = pass.orderRef;
    $('pass-title').textContent = pass.plan && pass.plan.title || pass.orderRef;
    $('pass-access-state').textContent = label(access.state);
    $('metric-allowance').textContent = units(usage.allowanceUnits);
    $('metric-consumed').textContent = units(usage.consumedUnits);
    $('metric-reserved').textContent = units(usage.reservedUnits);
    $('metric-available').textContent = units(usage.availableUnits);
    $('native-state').textContent = label(native.nativeState);
    $('access-expiry').textContent = date(access.expiresAt);
    $('manifest-state').textContent = pass.manifest ? label(pass.manifest.status) +
      (pass.manifest.code ? ' · ' + pass.manifest.code : '') : 'Attached';
    $('access-revision').textContent = 'Current access revision: ' + display(access.revision);
    const rows = ((pass.plan && pass.plan.routes) || []).map(function (route) {
      const row = node('tr');
      row.append(node('td', route.id, 'mono'));
      const target = node('td');
      target.append(node('span', route.method));
      target.append(node('span', route.path, 'secondary mono'));
      row.append(target, node('td', units(route.units), 'numeric'));
      const configured = state.routes.get(route.id);
      row.append(node('td', configured && configured.method === route.method &&
        configured.path === route.path ? 'Configured' : 'Unavailable'));
      return row;
    });
    $('route-rows').replaceChildren.apply($('route-rows'), rows);
    if (resetForms) {
      $('access-form').reset();
      $('access-action').value = access.enabled === false ? 'resume' : 'suspend';
      $('resolve-form').reset();
    }
    updateExpiry();
    $('selection-empty').hidden = true;
    $('pass-workspace').hidden = false;
    $('pass-detail').setAttribute('aria-busy', 'false');
    controlState();
  }

  async function choosePass(ref, focus) {
    const changed = state.selectedRef !== ref;
    state.selectedRef = ref;
    state.selectedPass = null;
    const generation = ++state.detailVersion;
    if (changed) {
      state.calls.clear();
      state.callAfter = null;
      state.selectedRequest = null;
      ++state.callsVersion;
      state.callsLoading = false;
      $('request-detail').hidden = true;
      $('pass-workspace').hidden = true;
      $('selection-empty').hidden = false;
      $('selection-empty').querySelector('h2').textContent = 'Loading selected pass…';
      $('selection-empty').querySelector('p').textContent = ref;
    }
    renderInventory();
    controlState();
    const pass = await api('/api/passes/' + encodeURIComponent(ref));
    if (generation !== state.detailVersion || ref !== state.selectedRef || !state.capability) return;
    if (!pass || pass.orderRef !== ref) throw new APIError('Unexpected pass response', null, true);
    state.selectedPass = pass;
    state.passes.set(ref, pass);
    renderInventory();
    renderDetail(changed);
    await loadCalls(true);
    if (focus && generation === state.detailVersion) $('pass-title').focus({preventScroll: true});
  }

  function resultSummary(result) {
    if (!result) return '—';
    return 'HTTP ' + display(result.status) + ' · ' + units(result.bytes) + ' bytes';
  }

  function renderCalls() {
    const rows = [];
    state.calls.forEach(function (call, requestId) {
      const row = node('tr');
      if (requestId === state.selectedRequest) row.className = 'selected';
      const requestCell = node('td');
      const button = node('button', requestId, 'link-button mono');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(requestId === state.selectedRequest));
      button.addEventListener('click', function () {
        state.selectedRequest = requestId;
        $('resolve-form').reset();
        renderCalls();
        renderRequest();
        $('request-title').focus({preventScroll: true});
      });
      requestCell.append(button);
      requestCell.append(node('span', date(call.startedAt), 'secondary'));
      row.append(requestCell, node('td', call.routeId, 'mono'), node('td', label(call.status)),
        node('td', units(call.units), 'numeric'), node('td', resultSummary(call.result)));
      rows.push(row);
    });
    $('call-rows').replaceChildren.apply($('call-rows'), rows);
    $('calls-summary').textContent = state.callsLoading ? 'Loading request history…' :
      units(state.calls.size) + (state.calls.size === 1 ? ' request loaded' : ' requests loaded');
    $('calls-empty').hidden = state.callsLoading || state.calls.size > 0;
    $('calls-more').hidden = !state.callAfter;
    $('calls-panel').setAttribute('aria-busy', String(state.callsLoading));
    controlState();
  }

  async function loadCalls(reset) {
    const ref = state.selectedRef;
    if (!ref || (state.callsLoading && !reset)) return;
    const generation = ++state.callsVersion;
    state.callsLoading = true;
    renderCalls();
    const query = new URLSearchParams({limit: '100'});
    if (!reset && state.callAfter) query.set('after', state.callAfter);
    try {
      const value = await api('/api/passes/' + encodeURIComponent(ref) + '/calls?' + query.toString());
      const calls = requireList(value, 'calls');
      if (generation !== state.callsVersion || ref !== state.selectedRef || !state.capability) return;
      if (reset) state.calls.clear();
      calls.forEach(function (call) {
        if (call && typeof call.requestId === 'string') state.calls.set(call.requestId, call);
      });
      state.callAfter = value.nextAfter || null;
      if (state.selectedPass && value.usage) {
        state.selectedPass.usage = value.usage;
        state.passes.set(ref, state.selectedPass);
        renderDetail(false);
        renderInventory();
      }
      if (state.selectedRequest && !state.calls.has(state.selectedRequest)) state.selectedRequest = null;
      renderRequest();
    } finally {
      if (generation === state.callsVersion && ref === state.selectedRef) {
        state.callsLoading = false;
        renderCalls();
      }
    }
  }

  function renderRequest() {
    const call = state.calls.get(state.selectedRequest);
    $('request-detail').hidden = !call;
    if (!call) return;
    $('request-title').textContent = call.requestId;
    $('request-state').textContent = label(call.status);
    $('request-route').textContent = call.routeId + ' · ' + call.method + ' ' + call.path;
    $('request-started').textContent = date(call.startedAt);
    $('request-deadline').textContent = date(call.deadlineAt);
    $('request-revision').textContent = display(call.revision);
    $('request-outcome').textContent = call.errorCode || label(call.status);
    $('request-result').textContent = resultSummary(call.result);
    const available = call.status === 'RECOVERY_REQUIRED';
    $('resolve-form').hidden = !available;
    $('resolve-revision').textContent = 'Records a decision against request revision ' + display(call.revision) + '.';
    $('resolution-note').textContent = available ?
      'Record the observed outcome of this original upstream request. Its request ID stays reserved against a second execution.' :
      terminalStates.has(call.status) ?
        'This request has a recorded outcome.' :
        'The request is still in progress. Refresh request history to see its latest state.';
    controlState();
  }

  function updateExpiry() {
    const active = $('access-action').value === 'expire';
    $('expiry-field').hidden = !active;
    $('access-expires').required = active;
    let zone = 'this browser’s local time';
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || zone; } catch (_) {}
    $('expiry-zone').textContent = 'Time zone: ' + zone + '.';
  }

  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(function (key) {
        return JSON.stringify(key) + ':' + canonical(value[key]);
      }).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  function operationId() {
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    return 'console-' + Array.from(bytes, function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
  }

  function operation(path, payload, title, ref, needsId) {
    const key = path + '\n' + canonical(payload);
    if (state.operations.has(key)) return state.operations.get(key);
    const exact = Object.assign({}, payload);
    if (needsId) exact.operationId = operationId();
    const item = {key: key, path: path, body: canonical(exact), payload: exact,
      title: title, ref: ref, status: 'prepared', busy: false, error: ''};
    state.operations.set(key, item);
    return item;
  }

  function renderPending() {
    const items = [];
    state.operations.forEach(function (item) {
      if (!['sending', 'uncertain', 'conflict'].includes(item.status)) return;
      const entry = node('li');
      entry.append(node('p', item.title, 'pending-title'));
      entry.append(node('p', item.status === 'sending' ? 'Sending saved request…' :
        item.status === 'conflict' ? 'State changed. Refresh and review the current revision.' :
          'The response was unavailable. Retry this same saved request to recover its outcome.', 'pending-detail'));
      entry.append(node('p', 'Order ' + item.ref +
        (item.payload.operationId ? ' · Operation ' + item.payload.operationId : ''), 'pending-detail mono'));
      if (item.error) entry.append(node('p', item.error, 'pending-detail'));
      const details = node('details');
      details.append(node('summary', 'Review saved request'), node('pre', item.body));
      entry.append(details);
      const actions = node('div', null, 'button-row');
      const retry = node('button', item.busy ? 'Sending…' : 'Retry saved request');
      retry.type = 'button';
      retry.disabled = item.busy || !state.capability || item.status === 'conflict';
      retry.addEventListener('click', function () { run(function () { return sendOperation(item); }); });
      const refresh = node('button', 'Refresh affected pass');
      refresh.type = 'button';
      refresh.disabled = !state.capability || item.busy;
      refresh.addEventListener('click', function () {
        run(async function () {
          await choosePass(item.ref, true);
          if (item.status === 'conflict') item.status = 'reviewed';
          renderPending();
        });
      });
      actions.append(retry, refresh);
      entry.append(actions);
      items.push(entry);
    });
    $('pending-list').replaceChildren.apply($('pending-list'), items);
    $('pending-panel').hidden = items.length === 0;
  }

  async function sendOperation(item) {
    if (item.busy) return;
    item.busy = true;
    item.status = 'sending';
    item.error = '';
    renderPending();
    try {
      const result = await api(item.path, {body: item.body});
      item.status = 'completed';
      item.result = result;
      announce(item.title + ' recorded' + (result && result.replayed ? ' from its existing operation.' : '.'));
    } catch (error) {
      item.error = errorMessage(error);
      item.status = error instanceof APIError && error.status === 409 ? 'conflict' :
        error instanceof APIError && error.uncertain ? 'uncertain' : 'rejected';
      announce(item.error, true);
      return;
    } finally {
      item.busy = false;
      renderPending();
      controlState();
    }
    try {
      await loadPasses(true);
      if (state.selectedRef === item.ref || item.path === '/api/attach') await choosePass(item.ref, false);
    } catch (error) {
      announce(item.title + ' was recorded. Workspace refresh: ' + errorMessage(error), true);
    }
  }

  async function refreshAll() {
    if (state.refreshing || !state.capability) return;
    state.refreshing = true;
    controlState();
    try {
      await Promise.all([loadRoutes(), loadPasses(true)]);
      if (state.selectedRef) await choosePass(state.selectedRef, false);
      $('connection-status').textContent = 'Connected · local console';
      announce('Workspace refreshed.');
    } finally {
      state.refreshing = false;
      controlState();
    }
  }

  async function connect(raw) {
    let value = raw.trim();
    if (value.includes('://')) {
      let url;
      try { url = new URL(value); } catch (_) { throw new Error('Enter the console link or access key.'); }
      if (url.origin !== window.location.origin) throw new Error('Open the console link at its original address and port.');
      value = url.hash.slice(1);
    }
    if (!tokenPattern.test(value)) throw new Error('Enter a valid console link or access key.');
    state.capability = value;
    $('console-link').value = '';
    $('connect-panel').hidden = true;
    $('merchant-workspace').hidden = false;
    $('connection-status').textContent = 'Connecting…';
    controlState();
    renderPending();
    try {
      await refreshAll();
    } catch (error) {
      $('connection-status').textContent = 'Connection needs attention';
      $('connect-panel').hidden = false;
      throw error;
    }
  }

  function disconnect() {
    state.capability = '';
    state.controllers.forEach(function (controller) { controller.abort(); });
    ++state.inventoryVersion;
    ++state.detailVersion;
    ++state.callsVersion;
    state.inventoryLoading = false;
    state.callsLoading = false;
    state.refreshing = false;
    $('operator-name').textContent = '';
    $('connection-status').textContent = 'Disconnected';
    $('connect-panel').hidden = false;
    $('merchant-workspace').hidden = true;
    $('console-link').value = '';
    controlState();
    renderPending();
    announce('Disconnected. Pending operation requests remain in this tab for reconnecting.');
  }

  async function run(action) {
    try { await action(); } catch (error) { announce(errorMessage(error), true); }
  }

  $('connect-form').addEventListener('submit', function (event) {
    event.preventDefault();
    run(function () { return connect($('console-link').value); });
  });
  $('disconnect').addEventListener('click', disconnect);
  $('refresh-all').addEventListener('click', function () { run(refreshAll); });
  $('passes-more').addEventListener('click', function () { run(function () { return loadPasses(false); }); });
  $('calls-more').addEventListener('click', function () { run(function () { return loadCalls(false); }); });
  $('refresh-calls').addEventListener('click', function () { run(function () { return loadCalls(true); }); });
  $('access-action').addEventListener('change', updateExpiry);

  $('attach-form').addEventListener('submit', function (event) {
    event.preventDefault();
    const ref = $('attach-reference').value.trim();
    if (!/^[A-Za-z0-9._:-]{1,80}$/.test(ref)) {
      announce('Use the existing order reference: 1–80 letters, digits, periods, underscores, colons, or hyphens.', true);
      return;
    }
    run(function () { return sendOperation(operation('/api/attach', {orderRef: ref}, 'Attach pass ' + ref, ref, false)); });
  });

  $('access-form').addEventListener('submit', function (event) {
    event.preventDefault();
    const pass = state.selectedPass;
    if (!pass) return;
    const revision = pass.native && pass.native.access && pass.native.access.revision;
    if (!Number.isSafeInteger(revision) || revision < 0) {
      announce('Refresh this pass to obtain its current access revision.', true);
      return;
    }
    const action = $('access-action').value;
    const payload = {orderRef: pass.orderRef, expectedRevision: revision,
      reason: $('access-reason').value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim(), action: action};
    if (!payload.reason) { announce('Enter a reason for this access change.', true); return; }
    if (action === 'expire') {
      const expiry = new Date($('access-expires').value);
      if (Number.isNaN(expiry.getTime())) { announce('Enter the expiry date and time.', true); return; }
      payload.expiresAt = expiry.toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
    const titles = {suspend: 'Suspend access', resume: 'Resume access', expire: 'Set access expiry', 'clear-expiry': 'Remove access expiry'};
    run(function () { return sendOperation(operation('/api/access', payload,
      titles[action] + ' · ' + pass.orderRef, pass.orderRef, true)); });
  });

  $('resolve-form').addEventListener('submit', function (event) {
    event.preventDefault();
    const call = state.calls.get(state.selectedRequest);
    if (!call || call.status !== 'RECOVERY_REQUIRED' || !state.selectedRef) return;
    if (!Number.isSafeInteger(call.revision) || call.revision < 1) {
      announce('Refresh request history to obtain the current request revision.', true);
      return;
    }
    const reason = $('resolve-reason').value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    if (!reason) { announce('Describe the observed upstream outcome used for this resolution.', true); return; }
    const payload = {orderRef: state.selectedRef, requestId: call.requestId, expectedRevision: call.revision,
      reason: reason, decision: $('resolve-decision').value};
    run(function () { return sendOperation(operation('/api/resolve', payload,
      'Resolve request ' + call.requestId, payload.orderRef, true)); });
  });

  const initial = window.location.hash.slice(1);
  if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
  updateExpiry();
  controlState();
  if (initial) run(function () { return connect(initial); });
})();
