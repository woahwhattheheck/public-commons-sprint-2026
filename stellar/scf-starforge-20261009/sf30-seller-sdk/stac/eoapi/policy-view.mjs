// MIT. Mount inside the existing authenticated eoAPI operator application.
// Browser-only module. The original server compiler owns policy interpretation.
const SCHEMA = 'scf-eoapi-deployment-policy/v1';
const clone = value => JSON.parse(JSON.stringify(value));
const pretty = value => JSON.stringify(value, null, 2);
const groups = [
  ['Deployment', [
    ['title', 'Policy title'], ['deployment.id', 'Deployment ID'],
    ['deployment.publicUrl', 'Public catalog URL'], ['deployment.rootPath', 'Proxy root path'],
    ['deployment.eoapiVersion', 'eoAPI version'], ['deployment.authProxyVersion', 'Auth Proxy version'],
    ['deployment.sourceRef', 'Source revision'], ['deployment.rootPathSkipPrefixes', 'Root-path skip prefixes', 'lines']
  ]],
  ['Upstream and identity', [
    ['upstream.url', 'Upstream STAC URL'], ['upstream.networkBoundary', 'Upstream network boundary'],
    ['upstream.conformsTo', 'Declared conformance URLs', 'lines'],
    ['identity.mode', 'Identity mode', 'identity-mode', 'Public source requires empty identity fields, public default access, no private rules or record filters, and browser credentials disabled. Its native factory is included in the package.'],
    ['identity.discoveryUrl', 'OIDC discovery URL'],
    ['identity.internalDiscoveryUrl', 'Internal discovery URL (optional)'],
    ['identity.audiences', 'JWT audiences', 'json', 'JSON array; each complete string is one audience, including any commas.'],
    ['identity.policyOwner', 'Policy owner']
  ]],
  ['CORS and operations', [
    ['cors.origins', 'Allowed browser origins', 'lines'], ['cors.methods', 'CORS methods', 'json'],
    ['cors.headers', 'Allowed headers', 'lines'], ['cors.exposeHeaders', 'Exposed response headers', 'lines'],
    ['cors.credentials', 'Allow browser credentials', 'boolean'], ['cors.maxAge', 'CORS maximum age (seconds)', 'number'],
    ['operator.name', 'Operating team'], ['operator.retentionDays', 'Receiving retention (days)', 'number'],
    ['operator.sourceVersionNotes', 'Source version notes']
  ]]
];
const filterFields = [['factory', 'Factory', 'factory'], ['classPath', 'Custom class (module:Class)'],
  ['args', 'Constructor arguments', 'json'], ['kwargs', 'Constructor keywords', 'json']];
const get = (value, path) => path.split('.').reduce((item, key) => item?.[key], value);
function put(value, path, next) {
  const parts = path.split('.'); let parent = value;
  for (const part of parts.slice(0, -1)) {
    if (!parent[part] || typeof parent[part] !== 'object' || Array.isArray(parent[part])) parent[part] = {};
    parent = parent[part];
  }
  parent[parts.at(-1)] = next;
}
function blankPolicy() {
  return { schema: SCHEMA, title: '', deployment: { id: '', publicUrl: '', rootPath: '', eoapiVersion: '',
    authProxyVersion: '', sourceRef: '', rootPathSkipPrefixes: [] },
  upstream: { url: '', networkBoundary: '', conformsTo: [] },
  identity: { mode: 'oidc', discoveryUrl: '', audiences: [], policyOwner: '' },
  routing: { defaultPublic: false, publicEndpoints: {}, privateEndpoints: {} }, filtering: { items: null, collections: null },
  cors: { origins: [], methods: ['GET', 'POST', 'OPTIONS'], headers: ['Authorization', 'Content-Type'],
    exposeHeaders: [], credentials: true, maxAge: 600 }, collectionRights: [],
  operator: { name: '', retentionDays: 30, sourceVersionNotes: '' } };
}
const errorText = error => {
  const code = typeof error?.code === 'string' ? error.code : 'EOAPI_POLICY_REQUEST_FAILED';
  const messages = {
    EOAPI_POLICY_REVISION_CHANGED: 'Another edit changed the saved workspace. Your local form is retained. Reload the saved draft or compare it before saving again.',
    EOAPI_POLICY_REVIEW_STALE: 'This review belongs to an earlier draft. Save a review of the current draft before approval.',
    EOAPI_POLICY_FINDINGS_REQUIRE_CORRECTION: 'Resolve the review findings, then save and review the corrected draft.',
    EOAPI_POLICY_REVIEWER_REQUIRED: 'A reviewer name is required.',
    EOAPI_PUBLIC_ROUTES_REQUIRED: 'Public source mode requires Public default access and no private route rules.',
    EOAPI_PUBLIC_IDENTITY_MUST_BE_UNSET: 'Clear discovery URLs and JWT audiences for public source mode.',
    EOAPI_PUBLIC_RECORD_FILTERS_MUST_BE_UNSET: 'Select none for both record filters in public source mode.',
    EOAPI_PUBLIC_CORS_CREDENTIALS_MUST_BE_FALSE: 'Disable browser credentials for public source mode.',
    EOAPI_PRIVATE_BINDING_REQUIRED: 'Keep credentials in the existing private connection. This policy contains portable configuration.',
    EOAPI_POLICY_REQUEST_FAILED: 'The operation did not return a completed result. Refresh saved state before retrying.'
  };
  return (messages[code] ?? code.replaceAll('_', ' ')) + (error?.field ? ' — ' + error.field : '');
};

export function mountDeploymentPolicy(element, { dispatch, reviewer = '', onApproval, onReceived } = {}) {
  if (!element || typeof element.replaceChildren !== 'function' || typeof dispatch !== 'function') throw new TypeError('Policy mount and dispatch are required.');
  const document = element.ownerDocument, window = document.defaultView;
  const abort = new AbortController();
  let state = null, editor = blankPolicy(), editorRevision = null, dirty = false, busy = false, destroyed = false;
  let currentReview = null, selectedApproval = null, packageToReceive = null, packageInspection = null, exported = null;
  let historyKind = 'reviews', nextHistory = null, historyRows = [];
  const links = new Set();
  function node(tag, text, attributes = {}) {
    const result = document.createElement(tag);
    if (text !== undefined && text !== null) result.textContent = text;
    for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, String(value));
    return result;
  }
  const root = node('section', null, { class: 'eoapi-policy', 'aria-label': 'Deployment policy' });
  root.innerHTML = `<header class="ep-header"><div><p class="ep-eyebrow">eoAPI / Access configuration</p><h2>Deployment policy</h2><p data-summary>Opening saved workspace…</p></div><button type="button" data-action="refresh">Refresh saved state</button></header>
    <p class="ep-status" data-status role="status" aria-live="polite"></p><p class="ep-error" data-error role="alert" hidden></p>
    <nav class="ep-nav" aria-label="Policy sections"><button type="button" data-tab="edit" aria-pressed="true">Edit</button><button type="button" data-tab="review" aria-pressed="false">Review</button><button type="button" data-tab="approved" aria-pressed="false">Approved edition</button><button type="button" data-tab="history" aria-pressed="false">History</button><button type="button" data-tab="receive" aria-pressed="false">Receive</button></nav>
    <section data-panel="edit"><div class="ep-toolbar"><button type="button" data-action="save">Save draft</button><button type="button" data-action="preview">Preview changes</button><button type="button" data-action="review">Save review</button><button type="button" data-action="reload">Reload saved draft</button><label class="ep-file">Open policy JSON<input type="file" accept="application/json,.json" data-policy-file></label><span data-draft-status></span></div>
      <fieldset class="ep-editor" data-editor><legend class="ep-sr-only">Deployment policy fields</legend><div data-fields></div>
      <section class="ep-card"><h3>Ordered route rules</h3><label>Default access<select data-default-public><option value="false">Authenticated</option><option value="true">Public</option></select></label><p>Private rules use the first matching pattern in the recorded order. With authenticated default access, public rules are checked first. Enter native Python patterns and retain scope text exactly.</p><div data-route-groups></div></section>
      <section class="ep-card"><h3>Record filters</h3><p>Template arguments: [template_str]. OPA arguments: [host, decision]. Constructor keywords use the original native names. The original Auth Proxy evaluates filters.</p><div data-filters></div></section>
      <section class="ep-card"><h3>Collection rights and files</h3><p>Keep the original collection license and file-access terms with this configuration.</p><div data-rights></div><button type="button" data-action="add-right">Add collection</button></section></fieldset></section>
    <section data-panel="review" hidden><div data-review></div><div class="ep-toolbar"><label>Reviewer<input data-reviewer maxlength="300"></label><button type="button" data-action="approve">Approve saved review</button><button type="button" data-action="review-to-editor">Copy review into draft editor</button></div></section>
    <section data-panel="approved" hidden><div data-approved></div><div class="ep-toolbar"><button type="button" data-action="current-approval">Open current approval</button><button type="button" data-action="export">Download complete policy package</button></div><div data-export></div></section>
    <section data-panel="history" hidden><div class="ep-toolbar"><label>Saved records<select data-history-kind><option value="reviews">Reviews</option><option value="approvals">Approvals</option><option value="imports">Receiving history</option></select></label><button type="button" data-action="history-refresh">Refresh history</button></div><div data-history></div><button type="button" data-action="history-more">Load earlier records</button></section>
    <section data-panel="receive" hidden><h3>Receive an approved policy edition</h3><p>Open the complete policy package JSON. Inspect its approved edition and retained files, then receive it into this workspace. Receiving keeps the original review and approval identity and makes that policy the saved draft.</p><label class="ep-file">Open policy package<input type="file" accept="application/json,.json" data-package-file></label><div data-receive></div><button type="button" data-action="receive">Receive approved edition</button></section>`;
  element.replaceChildren(root);
  const one = selector => root.querySelector(selector), all = selector => [...root.querySelectorAll(selector)];
  one('[data-reviewer]').value = reviewer;
  function tab(name) {
    all('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
    all('[data-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tab === name)));
  }
  function status(message) { one('[data-status]').textContent = message; }
  function markDirty() { dirty = true; renderHeader(); }
  function buttons() {
    one('[data-editor]').disabled = busy;
    all('button[data-action]').forEach(button => {
      let disabled = busy || !state;
      if (button.dataset.action === 'approve') disabled ||= !currentReview?.id || !currentReview.compilation.ready || dirty || currentReview.policyDigest !== state?.draft?.digest;
      if (button.dataset.action === 'review-to-editor') disabled ||= !currentReview;
      if (button.dataset.action === 'current-approval') disabled ||= !state?.currentApprovalId;
      if (button.dataset.action === 'export') disabled ||= !selectedApproval;
      if (button.dataset.action === 'history-more') disabled ||= nextHistory === null;
      if (button.dataset.action === 'receive') disabled ||= !packageInspection || !packageToReceive;
      if (button.dataset.action === 'refresh') disabled = busy;
      button.disabled = disabled;
    });
    all('input[type=file], [data-history-kind]').forEach(input => { input.disabled = busy; });
  }
  function renderHeader() {
    one('[data-summary]').textContent = state ? `${state.title} · saved revision ${state.revision} · ${state.counts.approvals} approved editions` : 'Opening saved workspace…';
    one('[data-draft-status]').textContent = dirty ? `Local edits from revision ${editorRevision ?? 'new'}` : state?.draft ? `Draft saved at revision ${editorRevision}` : 'Enter the deployment and source configuration.';
    if (state?.reviewerFromHost) { one('[data-reviewer]').value = state.reviewer; one('[data-reviewer]').readOnly = true; }
    buttons();
  }
  function field(path, label, type = 'text', hint = '') {
    const wrapper = node('label', null, { class: type === 'lines' || type === 'json' ? 'ep-wide' : '' });
    wrapper.append(node('span', label));
    const input = node(type === 'lines' || type === 'json' ? 'textarea' : ['factory', 'identity-mode'].includes(type) ? 'select' : 'input', null, { 'data-field': path, 'data-type': type });
    if (type === 'factory') for (const option of ['none', 'template', 'opa', 'custom']) input.append(node('option', option, { value: option }));
    else if (type === 'identity-mode') for (const [value, label] of [['oidc', 'OIDC authentication'], ['public', 'Public source']]) input.append(node('option', label, { value }));
    else if (type === 'boolean') input.type = 'checkbox';
    else if (type === 'number') { input.type = 'number'; input.step = '1'; input.min = '0'; }
    else if (input.tagName === 'TEXTAREA') { input.rows = type === 'json' ? 4 : 3; input.spellcheck = false; }
    else { input.type = 'text'; input.autocomplete = 'off'; }
    wrapper.append(input); if (hint) wrapper.append(node('small', hint));
    return wrapper;
  }
  for (const [title, fields] of groups) {
    const section = node('section', null, { class: 'ep-card' }); section.append(node('h3', title));
    const grid = node('div', null, { class: 'ep-grid' });
    fields.forEach(args => grid.append(field(...args))); section.append(grid); one('[data-fields]').append(section);
  }
  for (const kind of ['items', 'collections']) {
    const section = node('section', null, { class: 'ep-filter' }); section.append(node('h4', kind === 'items' ? 'Item filter' : 'Collection filter'));
    const grid = node('div', null, { class: 'ep-grid' });
    filterFields.forEach(([key, label, type]) => grid.append(field(`filtering.${kind}.${key}`, label, type)));
    section.append(grid); one('[data-filters]').append(section);
  }
  for (const kind of ['publicEndpoints', 'privateEndpoints']) {
    const section = node('section', null, { class: 'ep-routes', 'data-route-kind': kind });
    section.append(node('h4', kind === 'publicEndpoints' ? 'Public rules' : 'Private rules'));
    section.append(node('p', kind === 'publicEndpoints' ? 'Methods example: ["GET","POST"].' : 'Methods/scopes example: [["GET","catalog:read"],"POST"]. Empty scope text retains native authenticated access.'));
    section.append(node('div', null, { 'data-route-rows': '' }));
    section.append(node('button', 'Add rule', { type: 'button', 'data-action': 'add-route', 'data-kind': kind }));
    one('[data-route-groups]').append(section);
  }
  function routeRow(kind, pattern = '', methods = ['GET']) {
    const row = node('div', null, { class: 'ep-route-row' });
    const patternLabel = node('label', 'Python pattern'), patternInput = node('input', null, { 'data-pattern': '', 'aria-label': 'Python pattern' }); patternInput.value = pattern; patternInput.spellcheck = false; patternLabel.append(patternInput);
    const methodsLabel = node('label', 'Native methods / scopes'), methodsInput = node('textarea', null, { 'data-methods': '', 'aria-label': 'Native methods and scopes', rows: '2' }); methodsInput.value = JSON.stringify(methods); methodsInput.spellcheck = false; methodsLabel.append(methodsInput);
    const controls = node('div', null, { class: 'ep-row-controls' });
    for (const [action, text, label] of [['route-up', '↑', 'Move rule earlier'], ['route-down', '↓', 'Move rule later'], ['remove-route', 'Remove', 'Remove this rule']]) controls.append(node('button', text, { type: 'button', 'data-action': action, 'aria-label': label }));
    row.append(patternLabel, methodsLabel, controls); one(`[data-route-kind="${kind}"] [data-route-rows]`).append(row);
  }
  function rightsRow(value = {}) {
    const row = node('section', null, { class: 'ep-right', 'data-right': '' });
    const grid = node('div', null, { class: 'ep-grid' });
    for (const [key, label, multiline] of [['id', 'Collection ID'], ['license', 'License / original access terms'], ['attribution', 'Attribution'], ['licenseUrls', 'License URLs, one per line', true]]) {
      const wrapper = node('label', label), input = node(multiline ? 'textarea' : 'input', null, { 'data-right-field': key });
      input.value = multiline ? (value[key] ?? []).join('\n') : value[key] ?? ''; if (multiline) input.rows = 2;
      wrapper.append(input); grid.append(wrapper);
    }
    const access = node('label', 'File access'), select = node('select', null, { 'data-right-field': 'assetAccess' });
    for (const option of ['public-https', 'authenticated-source', 'requester-pays', 'retained-files']) select.append(node('option', option, { value: option }));
    select.value = value.assetAccess ?? 'public-https'; access.append(select); grid.append(access);
    row.append(grid, node('button', 'Remove collection', { type: 'button', 'data-action': 'remove-right' })); one('[data-rights]').append(row);
  }
  function fillEditor(value, revision, edited = false) {
    editor = clone(value ?? blankPolicy()); editorRevision = revision;
    all('[data-field]').forEach(input => {
      let value = get(editor, input.dataset.field); const type = input.dataset.type;
      if (type === 'factory') value ??= 'none';
      if (type === 'identity-mode') value ??= 'oidc';
      if (type === 'boolean') input.checked = value === true;
      else input.value = type === 'json' ? pretty(value ?? (input.dataset.field.endsWith('kwargs') ? {} : [])) : type === 'lines' ? (Array.isArray(value) ? value.join('\n') : '') : value ?? '';
    });
    one('[data-default-public]').value = String(editor.routing?.defaultPublic ?? false);
    for (const kind of ['publicEndpoints', 'privateEndpoints']) {
      one(`[data-route-kind="${kind}"] [data-route-rows]`).replaceChildren();
      Object.entries(editor.routing?.[kind] ?? {}).forEach(([pattern, methods]) => routeRow(kind, pattern, methods));
    }
    one('[data-rights]').replaceChildren(); (editor.collectionRights ?? []).forEach(rightsRow);
    dirty = edited; renderHeader();
  }
  function jsonInput(text, label) {
    try { return JSON.parse(text); } catch { const error = new Error(); error.code = 'EOAPI_POLICY_JSON_INVALID'; error.field = label; throw error; }
  }
  function readEditor() {
    const value = clone(editor); value.schema ??= SCHEMA;
    all('[data-field]').forEach(input => {
      const path = input.dataset.field, type = input.dataset.type;
      const next = type === 'boolean' ? input.checked : type === 'number' ? (input.value.trim() ? Number(input.value) : null) : type === 'json' ? jsonInput(input.value, path) : type === 'lines' ? input.value.split(/\r?\n/).map(row => row.trim()).filter(Boolean) : input.value;
      put(value, path, next);
    });
    value.routing ??= {}; value.routing.defaultPublic = one('[data-default-public]').value === 'true';
    for (const kind of ['publicEndpoints', 'privateEndpoints']) {
      const entries = all(`[data-route-kind="${kind}"] .ep-route-row`).map(row => [row.querySelector('[data-pattern]').value, jsonInput(row.querySelector('[data-methods]').value, kind)]);
      if (new Set(entries.map(entry => entry[0])).size !== entries.length) { const error = new Error(); error.code = 'EOAPI_ROUTE_PATTERN_DUPLICATE'; error.field = kind; throw error; }
      value.routing[kind] = Object.fromEntries(entries);
    }
    for (const kind of ['items', 'collections']) {
      if (value.filtering[kind].factory === 'none') value.filtering[kind] = null;
      else if (value.filtering[kind].factory !== 'custom') delete value.filtering[kind].classPath;
    }
    value.collectionRights = all('[data-right]').map(row => Object.fromEntries([...row.querySelectorAll('[data-right-field]')].map(input => [input.dataset.rightField, input.dataset.rightField === 'licenseUrls' ? input.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean) : input.value])));
    if (!value.identity.internalDiscoveryUrl) delete value.identity.internalDiscoveryUrl;
    if (value.identity.mode === 'public') {
      if (!value.identity.discoveryUrl) delete value.identity.discoveryUrl;
      if (Array.isArray(value.identity.audiences) && value.identity.audiences.length === 0) delete value.identity.audiences;
    } else if (editor.identity?.mode === undefined && !dirty) delete value.identity.mode;
    return value;
  }
  async function request(method, path, body) {
    const result = await dispatch({ method, path, ...(body === undefined ? {} : { body }), signal: abort.signal });
    if (!result || result.status < 200 || result.status >= 300) { const error = new Error(); error.code = result?.body?.error ?? 'EOAPI_POLICY_REQUEST_FAILED'; error.field = result?.body?.field; throw error; }
    return result.body;
  }
  async function refresh({ preserveEditor = true } = {}) {
    const fresh = await request('GET', '/state'); if (destroyed) return;
    state = fresh;
    if (!preserveEditor || !dirty) fillEditor(state.draft?.policy ?? blankPolicy(), state.revision);
    renderHeader(); renderReview(); return state;
  }
  async function action(work) {
    if (busy || destroyed) return;
    busy = true; one('[data-error]').hidden = true; buttons();
    try { await work(); }
    catch (error) {
      if (destroyed) return;
      one('[data-error]').textContent = errorText(error); one('[data-error]').hidden = false;
      if (error?.code === 'EOAPI_POLICY_REVISION_CHANGED') await refresh().catch(() => {});
    } finally { if (!destroyed) { busy = false; buttons(); } }
  }
  const table = (headers, rows) => {
    const wrap = node('div', null, { class: 'ep-table-wrap' }), result = node('table'), head = node('tr');
    headers.forEach(value => head.append(node('th', value, { scope: 'col' }))); const thead = node('thead'); thead.append(head); result.append(thead);
    const body = node('tbody'); rows.forEach(values => { const row = node('tr'); values.forEach(value => { const cell = node('td'); cell.append(value && typeof value === 'object' && value.nodeType ? value : node('span', value ?? '')); row.append(cell); }); body.append(row); });
    result.append(body); wrap.append(result); return wrap;
  };
  function compilationView(compilation, changes) {
    const content = node('div'); content.append(node('p', `Policy ${compilation.digest}`, { class: 'ep-identity' }));
    content.append(node('p', compilation.ready ? 'Configuration review is ready for a saved approval.' : `${compilation.review.findings.length} configuration findings require correction.`));
    if (compilation.review.runtime) {
      const runtime = compilation.review.runtime;
      content.append(node('h4', 'Included public runtime'), table(['Setting', 'Reviewed value'], [['Factory', runtime.factory], ['Native dependency', runtime.dependency.package + ' ' + runtime.dependency.version], ['Selected source', runtime.dependency.sourceRef], ['Included file', runtime.filename], ['File SHA-256', runtime.sourceSha256]]));
    }
    if (compilation.review.findings.length) content.append(table(['Finding', 'Field', 'Detail'], compilation.review.findings.map(row => [row.code, row.field, row.detail])));
    content.append(node('h4', 'Route precedence'), node('p', compilation.review.routePrecedence.public), node('p', compilation.review.routePrecedence.private));
    content.append(table(['Order', 'Pattern', 'Method', 'Access', 'Required scopes', 'Active'], compilation.review.routes.map(row => [row.order, row.pattern, row.method, row.access, JSON.stringify(row.scopes), row.active ? 'Yes' : 'No'])));
    if (changes) { content.append(node('h4', 'Changes from the approved edition')); content.append(changes.changes.length ? table(['Field', 'Before', 'After'], changes.changes.map(row => [row.field, pretty(row.before), pretty(row.after)])) : node('p', 'The policy matches the comparison edition.')); }
    if (compilation.review.requirements.length) content.append(node('h4', 'Declared native conformance'), table(['Requirement', 'Declared', 'Matched source value'], compilation.review.requirements.map(row => [row.conformance, row.declared ? 'Yes' : 'No', row.matched])));
    content.append(node('h4', 'Collection rights'), table(['Collection', 'License', 'File access', 'Attribution'], compilation.policy.collectionRights.map(row => [row.id, row.license, row.assetAccess, row.attribution])));
    const configuration = node('details'); configuration.append(node('summary', 'Exact environment and replacement settings'), node('pre', pretty({ environment: compilation.environment, unset: compilation.unset }))); content.append(configuration);
    const policy = node('details'); policy.append(node('summary', 'Complete normalized policy'), node('pre', pretty(compilation.policy))); content.append(policy);
    return content;
  }
  function renderReview() {
    const panel = one('[data-review]'); panel.replaceChildren();
    if (!currentReview) { panel.append(node('h3', 'Review a policy edition'), node('p', 'Preview local edits or save a review from the draft editor.')); return; }
    panel.append(node('h3', currentReview.id ? 'Saved policy review' : 'Draft preview'));
    if (currentReview.id) panel.append(node('p', `${currentReview.id} · ${currentReview.at}`, { class: 'ep-identity' }));
    if (currentReview.id && currentReview.policyDigest !== state?.draft?.digest) panel.append(node('p', 'This saved review belongs to an earlier draft. Its complete edition remains available below.'));
    panel.append(compilationView(currentReview.compilation, currentReview.changes)); buttons();
  }
  function renderApproved() {
    const panel = one('[data-approved]'); panel.replaceChildren();
    if (!selectedApproval) { panel.append(node('h3', 'Approved policy edition'), node('p', 'Approve a saved review, or open an earlier approval from History.')); return; }
    const { approval, compilation } = selectedApproval;
    panel.append(node('h3', compilation.policy.title), node('p', `${approval.reviewer} · ${approval.at}`), node('p', approval.id, { class: 'ep-identity' }), compilationView(compilation)); buttons();
  }
  async function openApproval(id) { selectedApproval = await request('GET', '/approvals/' + encodeURIComponent(id)); exported = null; one('[data-export]').replaceChildren(); renderApproved(); tab('approved'); }
  function download(text, filename, mime = 'application/json') {
    const url = window.URL.createObjectURL(new window.Blob([text], { type: mime })); links.add(url);
    const anchor = node('a', null, { href: url, download: filename }); root.append(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => { window.URL.revokeObjectURL(url); links.delete(url); }, 1000);
  }
  function renderExport() {
    const panel = one('[data-export]'); panel.replaceChildren(); if (!exported) return;
    panel.append(node('p', `Complete package ${exported.digest}`, { class: 'ep-identity' }));
    panel.append(table(['File', 'Bytes', 'SHA-256', 'Download'], exported.files.map((file, index) => [file.path, file.bytes, file.sha256, node('button', 'Save file', { type: 'button', 'data-action': 'download-file', 'data-file-index': index })])));
  }
  async function historyPage(reset = false) {
    if (reset) { historyRows = []; nextHistory = null; }
    const response = await request('GET', '/history?kind=' + historyKind + '&limit=30' + (!reset && nextHistory !== null ? '&before=' + nextHistory : ''));
    historyRows.push(...response.rows); nextHistory = response.nextBefore;
    const panel = one('[data-history]'); panel.replaceChildren();
    if (!historyRows.length) panel.append(node('p', 'No saved records in this category.'));
    else panel.append(table(historyKind === 'reviews' ? ['Saved', 'Policy', 'State', 'Open'] : historyKind === 'approvals' ? ['Approved', 'Reviewer', 'Policy', 'Open'] : ['Received', 'Source workspace', 'Policy', 'Files'], historyRows.map(row => historyKind === 'reviews' ? [row.at, row.title, `${row.ready ? 'Ready' : row.findings + ' findings'}${row.currentDraft ? ' · current draft' : ''}`, node('button', 'Open review', { type: 'button', 'data-action': 'open-review', 'data-id': row.id })] : historyKind === 'approvals' ? [row.at, row.reviewer, row.policyDigest, node('button', 'Open approval', { type: 'button', 'data-action': 'open-approval', 'data-id': row.id })] : [row.at, row.sourceWorkspaceId, row.policyDigest, `${row.files} files · ${row.bytes} bytes`])));
    buttons();
  }
  function renderReceive() {
    const panel = one('[data-receive]'); panel.replaceChildren(); if (!packageInspection) { buttons(); return; }
    const p = packageInspection;
    panel.append(node('h4', p.policy.title), node('p', `${p.approval.reviewer} · ${p.approval.at}`), node('p', `Source workspace ${p.sourceWorkspaceId}`, { class: 'ep-identity' }), node('p', `Approval ${p.approval.id}`, { class: 'ep-identity' }), node('p', `Package ${p.digest}`, { class: 'ep-identity' }), table(['File', 'Bytes', 'SHA-256'], p.files.map(file => [file.path, file.bytes, file.sha256])), compilationView(p.compilation)); buttons();
  }
  async function save() {
    const result = await request('POST', '/draft', { policy: readEditor(), expectedRevision: editorRevision });
    fillEditor(result.policy, result.revision); await refresh(); status(`Draft saved at revision ${result.revision}.`); return result.revision;
  }
  async function callHost(callback, value, message) {
    if (typeof callback !== 'function') return;
    try { await callback(value); } catch { status(message + ' The saved edition is available; refresh the surrounding onboarding view to finish its display.'); }
  }
  root.addEventListener('input', event => { if (event.target.closest('[data-editor]')) markDirty(); }, { signal: abort.signal });
  root.addEventListener('change', event => {
    const target = event.target;
    if (target.matches('[data-history-kind]')) { historyKind = target.value; action(() => historyPage(true)); }
    if (target.matches('[data-policy-file], [data-package-file]')) action(async () => {
      if (target.matches('[data-package-file]')) {
        packageToReceive = null; packageInspection = null; renderReceive();
      }
      const file = target.files?.[0]; if (!file) return;
      if (file.size > 20 * 1024 ** 2) { const error = new Error(); error.code = 'EOAPI_POLICY_REQUEST_SIZE_EXCEEDED'; throw error; }
      const value = jsonInput(await file.text(), 'Selected JSON file');
      if (target.matches('[data-policy-file]')) {
        const preview = await request('POST', '/preview', { policy: value });
        fillEditor(preview.compilation.policy, state.revision, true); status('Policy opened in the draft editor. Save it to retain a new draft.');
      } else {
        const inspected = await request('POST', '/inspect', { package: value });
        packageToReceive = value; packageInspection = inspected; renderReceive(); status('Package inspected. Receive this approved edition when its contents are the intended input.');
      }
      target.value = '';
    });
  }, { signal: abort.signal });
  root.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || !root.contains(button) || button.disabled) return;
    if (button.dataset.tab) { tab(button.dataset.tab); if (button.dataset.tab === 'history') action(() => historyPage(true)); if (button.dataset.tab === 'approved' && !selectedApproval && state?.currentApprovalId) action(() => openApproval(state.currentApprovalId)); return; }
    const name = button.dataset.action;
    if (['add-route', 'route-up', 'route-down', 'remove-route', 'add-right', 'remove-right'].includes(name)) {
      if (busy) return;
      if (name === 'add-route') routeRow(button.dataset.kind);
      if (name === 'route-up') { const row = button.closest('.ep-route-row'); if (row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling); }
      if (name === 'route-down') { const row = button.closest('.ep-route-row'); if (row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row); }
      if (name === 'remove-route') button.closest('.ep-route-row').remove();
      if (name === 'add-right') rightsRow(); if (name === 'remove-right') button.closest('[data-right]').remove();
      markDirty(); return;
    }
    action(async () => {
      if (name === 'refresh') { await refresh(); status(dirty ? 'Saved state refreshed. Local edits and their original revision are retained.' : 'Saved state refreshed.'); }
      else if (name === 'reload') { await refresh({ preserveEditor: false }); status('Saved draft opened.'); }
      else if (name === 'save') await save();
      else if (name === 'preview') { const result = await request('POST', '/preview', { policy: readEditor() }); currentReview = { compilation: result.compilation, changes: result.changes, policyDigest: result.compilation.digest }; renderReview(); tab('review'); status('Preview prepared from the local editor.'); }
      else if (name === 'review') {
        let revision = editorRevision; if (dirty || !state.draft) revision = await save();
        currentReview = await request('POST', '/review', { expectedRevision: revision }); await refresh(); renderReview(); tab('review'); status('Review saved with its complete policy and changes.');
      } else if (name === 'approve') {
        const approval = await request('POST', '/approve', { reviewId: currentReview.id, reviewer: one('[data-reviewer]').value, expectedRevision: editorRevision });
        await refresh(); await openApproval(approval.id); status('Policy approval saved.'); await callHost(onApproval, selectedApproval, 'Policy approval saved.');
      } else if (name === 'review-to-editor') { await refresh(); fillEditor(currentReview.compilation.policy, state.revision, true); tab('edit'); status('Historical policy copied into the editor for a new draft.'); }
      else if (name === 'current-approval') await openApproval(state.currentApprovalId);
      else if (name === 'open-approval') await openApproval(button.dataset.id);
      else if (name === 'open-review') { currentReview = (await request('GET', '/reviews/' + encodeURIComponent(button.dataset.id))).review; renderReview(); tab('review'); }
      else if (name === 'export') {
        exported = (await request('POST', '/export', { approvalId: selectedApproval.approval.id })).package;
        renderExport(); download(pretty(exported) + '\n', exported.approvalId + '.json'); status(`Complete package downloaded: ${exported.files.length} retained files.`);
      } else if (name === 'download-file') { const file = exported?.files[Number(button.dataset.fileIndex)]; if (file) download(file.text, file.path, file.mime); }
      else if (name === 'history-refresh' || name === 'history-more') await historyPage(name === 'history-refresh');
      else if (name === 'receive') {
        const receipt = await request('POST', '/receive', { package: packageToReceive, expectedRevision: state.revision });
        await refresh(); await openApproval(receipt.approvalId);
        status(`Approved edition received: ${receipt.files} files, original approval ${receipt.approvalId}.` + (dirty ? ' Local edits and their original revision remain in the draft editor.' : ''));
        await callHost(onReceived, { receipt, ...selectedApproval, packageDigest: receipt.digest }, 'Approved edition received.');
      }
    });
  }, { signal: abort.signal });
  fillEditor(editor, null); renderReview(); renderApproved(); renderReceive();
  const ready = action(async () => { await refresh({ preserveEditor: false }); status('Saved policy workspace opened.'); });
  return Object.freeze({ ready, refresh: () => action(() => refresh()),
    destroy() { if (destroyed) return; destroyed = true; abort.abort(); links.forEach(url => window.URL.revokeObjectURL(url)); links.clear(); root.remove(); } });
}
