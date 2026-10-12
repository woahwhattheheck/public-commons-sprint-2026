// MIT. Browser controls for the original retained gRPC workspace.
const $ = id => document.getElementById(id);
const storageKey = 'stellar-forge.grpc-workspace:' + location.origin;
let token = location.hash.slice(1);
try {
  if (token) { sessionStorage.setItem(storageKey + ':token', token); history.replaceState(null, '', location.pathname); }
  else token = sessionStorage.getItem(storageKey + ':token') ?? '';
} catch {}
let inventory = null, adopted = null, editorBase = null, source = null, protoSource = null;
let plan = { schema: 'stellar-forge.grpc-merchant-plan.v1', publicOrigin: '', routes: [] };
let methodPath = null, selectedRoute = null, methodSchema = null, dirty = false, routeDirty = false, planDirty = false, requestDirty = false, busy = false;
let latestAttempt = null, methodTicket = 0;
const customerFiles = ['methods.json', 'openapi.json', 'client/seller-client.mjs', 'client/seller-client.d.mts',
  'client/seller-openapi.json', 'client/package.json', 'client/README.md'];
const pretty = value => JSON.stringify(value, null, 2);
const short = value => value ? value.slice(0, 12) : 'none';
function notice(message, kind = '') { $('notice').textContent = message; $('notice').dataset.kind = kind; }
function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(name + ' must be a JSON object.');
  return value;
}
function parse(id, name = id) {
  try { return JSON.parse($(id).value); } catch { throw new Error(name + ' contains invalid JSON.'); }
}
function node(tag, value, className) {
  const item = document.createElement(tag); if (value !== undefined) item.textContent = value;
  if (className) item.className = className; return item;
}
function button(label, action, secondary = false) {
  const item = node('button', label, secondary ? 'secondary' : ''); item.type = 'button';
  item.addEventListener('click', action); return item;
}
function link(label, url) {
  const item = node('a', label); item.href = url; item.target = '_blank'; item.rel = 'noopener noreferrer'; return item;
}
function card(title, detail) {
  const item = node('div', undefined, 'item'); item.append(node('strong', title));
  if (detail) item.append(node('p', detail)); return item;
}
function view(name) {
  for (const item of document.querySelectorAll('.view')) item.hidden = item.id !== 'view-' + name;
  for (const item of document.querySelectorAll('nav button'))
    item.setAttribute('aria-current', item.dataset.view === name ? 'page' : 'false');
}
async function api(action, value, options = {}) {
  const response = await fetch('/api/' + action, { method: value === undefined ? 'GET' : 'POST',
    cache: 'no-store', headers: { 'x-workspace-token': token, ...(value === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }), ...options });
  if (!response.ok) {
    const result = await response.json().catch(() => ({ error: 'HTTP_' + response.status }));
    const message = (result.field ? result.field + ': ' : '') + (result.detail ?? result.error ?? 'Request failed');
    throw Object.assign(new Error(message), { code: result.error, status: response.status });
  }
  return response;
}
async function json(action, value, options) { return (await api(action, value, options)).json(); }
async function work(action, message) {
  if (busy) return;
  const focus = document.activeElement;
  busy = true; document.body.dataset.busy = 'true'; $('workspace').inert = true; $('refresh').disabled = true;
  if (message) notice(message);
  try { return await action(); }
  catch (issue) { notice(issue.message, 'error'); }
  finally {
    busy = false; document.body.dataset.busy = 'false'; $('workspace').inert = false; $('refresh').disabled = false;
    if (focus?.isConnected) focus.focus({ preventScroll: true });
    buttons();
  }
}
function buttons() {
  $('save').disabled = !protoSource || planDirty || routeDirty;
  $('checkout').disabled = !adopted || adopted.id === inventory?.currentRevision || dirty || routeDirty || planDirty;
  for (const name of ['review', 'prepare']) $(name).disabled = !adopted || dirty || routeDirty || planDirty ||
    adopted.id !== inventory?.currentRevision || !plan.routes.length;
  $('call').disabled = !adopted || !methodPath || dirty || routeDirty || planDirty ||
    adopted.id !== inventory?.currentRevision || !plan.routes.some(route => route.grpcMethod === methodPath);
  $('apply-route').disabled = !methodPath;
  $('remove-route').disabled = !selectedRoute;
  $('workspace-title').textContent = $('title').value || 'gRPC merchant';
  $('revision-label').textContent = adopted ? 'Editor ' + short(adopted.id) + ' · current ' +
    short(inventory?.currentRevision) + (dirty ? ' · unsaved source or plan' : '') +
    (routeDirty ? ' · route edits need Apply' : '') + (planDirty ? ' · plan JSON needs Apply or Discard' : '') +
    (requestDirty ? ' · working request changed' : '') : 'Capture a private protobuf source to begin.';
}
function changed() { dirty = true; buttons(); }
function confirmReplacement(action, { whole = false, route = false, completePlan = false, request = false } = {}) {
  const pending = [];
  if (whole && dirty) pending.push('unsaved source or applied plan');
  if ((whole || route) && routeDirty) pending.push('unapplied route terms');
  if ((whole || completePlan) && planDirty) pending.push('unapplied complete plan JSON');
  if ((whole || request) && requestDirty) pending.push('working request input');
  return !pending.length || window.confirm(action + ' will discard ' + pending.join(', ') + '. Continue?');
}
function requestValue() {
  const invalid = [$('request'), ...$('field-form').querySelectorAll('.field-value')]
    .find(control => !control.disabled && !control.checkValidity());
  if (invalid) {
    invalid.reportValidity();
    throw new Error(invalid.validationMessage || 'Correct the visible request input first.');
  }
  return object(parse('request', 'Request'), 'Request');
}
function clearMethod() {
  methodPath = null; selectedRoute = null; methodSchema = null; ++methodTicket;
  $('method-heading').textContent = 'Select a method'; $('method-types').textContent = '';
  $('field-form').replaceChildren(); $('field-form').inert = false;
  $('method-schema').textContent = ''; $('request').value = '{}'; $('request').setCustomValidity('');
  requestDirty = false; fillRoute(null);
}
function readSource() {
  const transport = { mode: $('transport').value };
  if (transport.mode === 'tls') {
    for (const [id, key] of [['server-name', 'serverName'], ['ca-env', 'caEnv'],
      ['certificate-env', 'certificateEnv'], ['private-key-env', 'privateKeyEnv']])
      if ($(id).value.trim()) transport[key] = $(id).value.trim();
  }
  const metadata = parse('metadata', 'Metadata references');
  if (!Array.isArray(metadata)) throw new Error('Metadata references must be a JSON array.');
  return { schema: 'stellar-forge.grpc-source.v1', target: $('target').value.trim(), transport,
    metadata, limits: object(parse('limits', 'Call limits'), 'Call limits') };
}
function fillSource(value) {
  source = structuredClone(value); $('target').value = value.target ?? '';
  $('transport').value = value.transport?.mode ?? 'tls';
  for (const [id, key] of [['server-name', 'serverName'], ['ca-env', 'caEnv'],
    ['certificate-env', 'certificateEnv'], ['private-key-env', 'privateKeyEnv']])
    $(id).value = value.transport?.[key] ?? '';
  $('metadata').value = pretty(value.metadata ?? []); $('limits').value = pretty(value.limits ?? {});
  $('tls-fields').hidden = $('transport').value !== 'tls';
}
function renderSource() {
  const files = protoSource?.files ?? [], builtins = protoSource?.builtins ?? [];
  $('source-summary').textContent = protoSource ? files.length + ' local files · ' + builtins.length +
    ' standard descriptor files · SHA256 ' + protoSource.sha256 : 'No source captured.';
  $('source-file').replaceChildren();
  if (!files.length) { const option = node('option', 'No captured files'); option.value = ''; $('source-file').append(option); }
  for (const file of files) { const option = node('option', file.path); option.value = file.path; $('source-file').append(option); }
  showSourceFile();
}
function showSourceFile() {
  const file = protoSource?.files?.find(file => file.path === $('source-file').value);
  const content = file?.content ?? 'No captured source.';
  $('source-text').textContent = content.length > 131072 ? content.slice(0, 131072) +
    '\n… Display limited to 128 KiB. The complete source remains in this saved revision.' : content;
}
function renderMethods() {
  $('method-list').replaceChildren();
  for (const method of adopted?.methods ?? []) {
    const item = card(method.path, method.requestType + ' → ' + method.responseType +
      (method.selectable ? '' : ' · streaming; visible only'));
    item.classList.toggle('selected', method.path === methodPath);
    const choose = button('Open method', () => work(() => chooseMethod(method.path), 'Opening captured method…'), true);
    choose.disabled = !method.selectable; item.append(choose); $('method-list').append(item);
  }
  if (!adopted?.methods?.length) $('method-list').append(node('p', 'Capture and save a protobuf contract first.'));
  renderRoutes();
}
function renderRoutes() {
  $('route-list').replaceChildren();
  for (const route of plan.routes) {
    const item = card(route.id, 'POST ' + route.path + ' · ' + route.grpcMethod);
    item.classList.toggle('selected', selectedRoute === route.id);
    item.append(button('Edit route', () => work(async () => { await chooseMethod(route.grpcMethod, route.id); view('methods'); }), true));
    $('route-list').append(item);
  }
  if (!planDirty) $('plan').value = pretty(plan);
}
function resolved(schema, root) {
  if (!schema || typeof schema !== 'object') return {};
  const seen = new Set(); let value = schema;
  while (typeof value.$ref === 'string' && value.$ref.startsWith('#/') && !seen.has(value.$ref)) {
    seen.add(value.$ref); let target = root;
    for (const part of value.$ref.slice(2).split('/')) target = target?.[part.replaceAll('~1', '/').replaceAll('~0', '~')];
    if (!target || typeof target !== 'object') break;
    value = { ...target, ...Object.fromEntries(Object.entries(value).filter(([name]) => name !== '$ref')) };
  }
  return value;
}
function renderFields(value) {
  object(value, 'Request'); $('field-form').replaceChildren();
  const root = methodSchema?.request, schema = resolved(root, root);
  const properties = schema.properties ?? {}, required = new Set(schema.required ?? []);
  for (const [name, original] of Object.entries(properties)) {
    const field = resolved(original, root), row = node('div', undefined, 'field-row'), label = node('label');
    const included = document.createElement('input'); included.type = 'checkbox';
    included.checked = Object.hasOwn(value, name); included.disabled = required.has(name);
    if (required.has(name)) included.checked = true;
    const title = node('span', name + (required.has(name) ? ' · required' : ''));
    label.append(included, title); row.append(label);
    const hints = [field.description, field.type, field.format, field.pattern ? 'pattern: ' + field.pattern : ''].filter(Boolean);
    row.append(node('small', hints.join(' · ')));
    let control, mode;
    if (field.type === 'boolean') {
      control = document.createElement('select'); mode = 'boolean';
      for (const boolean of [false, true]) { const option = node('option', String(boolean)); option.value = String(boolean); control.append(option); }
    } else if (field.type === 'object' || field.type === 'array' || field.properties || field.additionalProperties ||
        field.anyOf || field.oneOf || field.allOf || !['string', 'integer', 'number'].includes(field.type)) {
      control = document.createElement('textarea'); mode = 'json'; control.rows = 3; control.spellcheck = false;
    } else {
      control = document.createElement('input'); mode = field.type;
      control.type = 'text'; control.autocomplete = 'off';
      if (mode === 'number' || mode === 'integer') control.inputMode = 'decimal';
    }
    control.className = 'field-value'; control.setAttribute('aria-label', name);
    const present = Object.hasOwn(value, name);
    control.value = present ? mode === 'json' ? pretty(value[name]) : String(value[name]) : '';
    control.disabled = !included.checked; row.dataset.included = String(included.checked);
    const update = () => {
      requestDirty = true;
      try {
        const request = object(parse('request', 'Request'), 'Request');
        if (!included.checked) delete request[name];
        else {
          let next = control.value;
          if (mode === 'json') next = JSON.parse(next);
          else if (mode === 'boolean') next = next === 'true';
          else if (mode === 'integer' || mode === 'number') {
            if (!next.trim() || !Number.isFinite(Number(next))) throw new Error(name + ' needs a finite JSON number.');
            next = Number(next);
            if (mode === 'integer' && !Number.isSafeInteger(next)) throw new Error(name + ' needs an exact safe JSON integer.');
          }
          Object.defineProperty(request, name, { value: next, enumerable: true, writable: true, configurable: true });
        }
        $('request').value = pretty(request); $('request').setCustomValidity(''); control.setCustomValidity('');
      } catch (issue) { control.setCustomValidity(issue.message); notice(issue.message, 'error'); }
      buttons();
    };
    included.addEventListener('change', () => {
      control.disabled = !included.checked; row.dataset.included = String(included.checked);
      if (included.checked && !control.value && mode === 'boolean') control.value = 'false'; update();
    });
    control.addEventListener('input', update); control.addEventListener('change', update); row.append(control); $('field-form').append(row);
  }
  if (!Object.keys(properties).length) $('field-form').append(node('p', 'Use the exact JSON editor for this message.'));
}
function fillRoute(route) {
  selectedRoute = route?.id ?? null;
  $('route-id').value = route?.id ?? '';
  $('route-path').value = route?.path ?? '';
  $('service-name').value = route?.serviceName ?? '';
  $('public-origin').value = plan.publicOrigin ?? '';
  $('description').value = route?.description ?? '';
  const terms = route?.paymentOptions ?? (route?.payment ? [route.payment] : plan.paymentOptions ?? (plan.payment ? [plan.payment] : []));
  $('payments').value = pretty(terms); routeDirty = false;
}
async function chooseMethod(path, routeId = null) {
  if (!confirmReplacement('Opening another method or route', { route: true, completePlan: true, request: true })) return;
  if (!adopted) throw new Error('Capture and save a protobuf contract first.');
  const ticket = ++methodTicket, revision = adopted.id;
  const result = await json('method', { revision, method: path });
  if (ticket !== methodTicket || adopted.id !== revision) return;
  methodPath = path; methodSchema = result;
  const route = routeId ? plan.routes.find(row => row.id === routeId) : plan.routes.find(row => row.grpcMethod === path);
  $('method-heading').textContent = path; $('method-types').textContent =
    result.method?.requestType && result.method?.responseType ? result.method.requestType + ' → ' + result.method.responseType :
      adopted.methods.find(row => row.path === path)?.requestType + ' → ' + adopted.methods.find(row => row.path === path)?.responseType;
  $('method-schema').textContent = pretty(result);
  $('request').value = pretty(route?.example ?? {}); $('request').setCustomValidity('');
  $('field-form').inert = false; planDirty = false; requestDirty = false;
  fillRoute(route); renderFields(route?.example ?? {}); renderMethods(); buttons();
}
function applyRoute() {
  if (!methodPath) throw new Error('Select a unary method.');
  if (planDirty) throw new Error('Apply or discard the complete plan JSON before changing one route.');
  const input = requestValue();
  const id = $('route-id').value.trim(), terms = parse('payments', 'Payment options');
  if (!Array.isArray(terms) || !terms.length) throw new Error('Enter at least one complete ordered payment option.');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('Use a route ID of 1–64 letters, numbers, underscores or hyphens.');
  if (id !== selectedRoute && plan.routes.some(route => route.id === id)) throw new Error('That route ID already exists.');
  const old = plan.routes.find(route => route.id === selectedRoute);
  const route = { id, path: $('route-path').value.trim(), grpcMethod: methodPath,
    serviceName: $('service-name').value.trim(), description: $('description').value.trim(),
    ...(old?.tags ? { tags: structuredClone(old.tags) } : {}), example: input,
    paymentOptions: structuredClone(terms) };
  const index = plan.routes.findIndex(row => row.id === selectedRoute);
  if (index < 0) plan.routes.push(route); else plan.routes[index] = route;
  plan.publicOrigin = $('public-origin').value.trim();
  selectedRoute = route.id; routeDirty = false; requestDirty = false; dirty = true; renderRoutes(); buttons();
  notice('Route applied to the draft. Save the revision to compile its exact fields and complete payment terms.');
}
function savedCurrent() {
  if (!adopted || !protoSource) throw new Error('Capture a source first.');
  if (dirty || routeDirty || planDirty) throw new Error('Apply your route or complete plan edits and save this draft first.');
  if (adopted.id !== inventory?.currentRevision) throw new Error('Make this saved revision current before operating it.');
  return adopted.id;
}
async function refresh() {
  inventory = await json('state'); renderInventory(); buttons();
}
async function adopt(revision) {
  // The editor base belongs to this exact response, never to a later inventory refresh.
  adopted = revision; editorBase = revision.id; source = structuredClone(revision.source);
  protoSource = structuredClone(revision.protoSource); plan = structuredClone(revision.plan);
  $('title').value = revision.title; fillSource(source); renderSource();
  clearMethod(); dirty = false; routeDirty = false; planDirty = false; renderMethods();
  await refresh();
}
function renderRuntime(value) {
  $('runtime-badge').textContent = value.closing ? 'Closing' : value.active?.phase ?? (value.releaseConsole ? 'Release control open' : 'Ready');
  const area = $('active-run'); area.replaceChildren();
  if (value.active) {
    const active = value.active;
    area.append(node('strong', active.phase + ' · ' + short(active.revision)),
      node('p', active.url ?? 'Starting…'), node('p', 'Mode: ' + (active.mode ?? 'pending')));
    for (const [label, url] of [['Merchant docs', active.docs], ['OpenAPI', active.openapi],
      ['Operations', active.operations], ['Availability', active.availability]]) if (url) area.append(link(label, url));
  } else {
    area.append(node('p', 'No workspace merchant is running.'));
    if (value.previous) area.append(node('p', value.previous.phase + ' · ' + (value.previous.note ?? value.previous.endedAt ?? '')));
  }
  if (value.releaseConsole?.url) area.append(link('Original release control', value.releaseConsole.url));
  $('stop').disabled = !value.active; $('release-close').disabled = !value.releaseConsole;
}
async function selectForRecovery(revision) {
  if (dirty || routeDirty || planDirty || requestDirty) throw new Error('Apply, save or explicitly reopen your draft before resuming another revision.');
  if (inventory.currentRevision !== revision) {
    const selected = await json('checkout', { revision, baseRevision: inventory.currentRevision });
    await adopt(selected);
  } else if (adopted?.id !== revision) await adopt(await json('open', { revision }));
}
function renderInventory() {
  if (!inventory) return;
  $('state-directory').textContent = inventory.stateDirectory;
  $('history').replaceChildren();
  for (const revision of inventory.revisions) {
    const item = card(revision.title + ' · ' + short(revision.id),
      revision.createdAt + ' · ' + revision.routes + ' routes' + (revision.id === inventory.currentRevision ? ' · current' : ''));
    item.append(button('Open revision', () => work(async () => {
      if (!confirmReplacement('Opening a saved revision', { whole: true })) return;
      await adopt(await json('open', { revision: revision.id })); notice('Saved revision opened. Its exact ID is the editor’s save base.'); view('source');
    }), true)); $('history').append(item);
  }
  $('intents').replaceChildren();
  for (const intent of inventory.intents) {
    const item = card(short(intent.id), 'Revision ' + short(intent.revision) + ' · preparation not yet fully published');
    item.append(button('Resume preparation', () => work(async () => {
      await selectForRecovery(intent.revision); await json('prepare', { id: intent.id, revision: intent.revision });
      await refresh(); notice('Original preparation completed using its retained operation ID.');
    }, 'Resuming original preparation…'))); $('intents').append(item);
  }
  if (!inventory.intents.length) $('intents').append(node('p', 'No unfinished preparations.'));
  $('prepared').replaceChildren();
  for (const retained of inventory.prepared) {
    const item = card(short(retained.id), 'Revision ' + short(retained.revision) + ' · ' + retained.createdAt);
    const actions = node('div', undefined, 'actions');
    actions.append(button('Run merchant', () => work(async () => {
      await json('run', { id: retained.id }); await refresh(); notice('Original merchant started from the retained folder.');
    }, 'Starting the retained merchant…')));
    actions.append(button('Customer client archive', () => work(() => download('archive', { id: retained.id }), 'Preparing customer download…'), true));
    item.append(actions);
    const file = document.createElement('select'); file.setAttribute('aria-label', 'Customer file');
    for (const name of customerFiles) { const option = node('option', name); option.value = name; file.append(option); }
    const single = node('div', undefined, 'actions'); single.append(file, button('Download file', () =>
      work(() => download('download', { id: retained.id, file: file.value })), true)); item.append(single);
    const releaseId = document.createElement('input'); releaseId.placeholder = 'Release name, e.g. analytics-v1';
    releaseId.setAttribute('aria-label', 'Release name'); releaseId.maxLength = 64;
    const stage = node('div', undefined, 'actions'); stage.append(releaseId, button('Stage in release control', () => work(async () => {
      if (!releaseId.value.trim()) throw new Error('Enter a release name.');
      const result = await json('stage', { id: retained.id, releaseId: releaseId.value.trim() });
      notice('Retained gRPC release staged. Open release control to review, activate and run it.');
      $('review-output').textContent = pretty(result); await refresh();
    }, 'Retaining the complete source in original release control…'), true)); item.append(stage);
    $('prepared').append(item);
  }
  if (!inventory.prepared.length) $('prepared').append(node('p', 'No merchant folders prepared yet.'));
  $('attempts').replaceChildren();
  for (const attempt of inventory.attempts) {
    const item = card(attempt.phase + ' · ' + short(attempt.id), attempt.method + ' · ' + attempt.startedAt);
    item.append(button('Open retained outcome', () => work(async () => {
      showAttempt(await json('attempt', { id: attempt.id })); await refresh(); view('operate');
    }), true)); $('attempts').append(item);
  }
  $('attempt-count').textContent = inventory.attemptCount + ' retained operations; showing up to 50 most recent.';
  renderRuntime(inventory.runtime);
}
function showAttempt(value) {
  latestAttempt = value; $('call-status').replaceChildren();
  if (!value) { $('call-status').textContent = 'No operation with that ID is retained.'; return; }
  $('call-status').append(node('strong', value.phase + ' · ' + value.id));
  if (value.nextAction) $('call-status').append(node('p', value.nextAction));
  const output = pretty({ method: value.method, input: value.input, ...(value.outputRetained ? { output: value.output } : {}),
    ...(value.error ? { error: value.error } : {}) });
  $('call-output').textContent = output.length > 131072 ? output.slice(0, 131072) + '\n… Use Download exact outcome for the complete retained JSON.' : output;
  $('call-status').append(button('Download exact outcome', () => saveBlob(new Blob([pretty(latestAttempt) + '\n'],
    { type: 'application/json' }), 'grpc-operation-' + value.id + '.json'), true));
}
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function download(action, value) {
  const response = await api(action, value);
  const filename = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'grpc-customer-download';
  const blob = await response.blob(); saveBlob(blob, filename);
  notice('Downloaded ' + filename + ' · SHA256 ' + response.headers.get('x-content-sha256'));
}
for (const item of document.querySelectorAll('nav button')) item.addEventListener('click', () => view(item.dataset.view));
$('source-file').addEventListener('change', showSourceFile);
for (const id of ['title', 'target', 'transport', 'server-name', 'ca-env', 'certificate-env', 'private-key-env', 'metadata', 'limits'])
  $(id).addEventListener('input', () => { if (id === 'transport') $('tls-fields').hidden = $('transport').value !== 'tls'; changed(); });
for (const id of ['route-id', 'route-path', 'service-name', 'public-origin', 'description', 'payments'])
  $(id).addEventListener('input', () => { routeDirty = true; buttons(); });
$('plan').addEventListener('input', () => { planDirty = true; buttons(); });
$('discard-plan').addEventListener('click', () => work(async () => {
  if (!confirmReplacement('Discarding the edited plan JSON', { completePlan: true })) return;
  planDirty = false; renderRoutes(); buttons(); notice('The plan editor now shows the current applied draft.');
}));
$('request').addEventListener('input', () => {
  requestDirty = true;
  try {
    const value = object(parse('request', 'Request'), 'Request');
    $('request').setCustomValidity(''); $('field-form').inert = false; renderFields(value);
  } catch (issue) {
    $('request').setCustomValidity(issue.message); $('field-form').inert = true;
  }
  buttons();
});
$('apply-route').addEventListener('click', () => work(async () => applyRoute()));
$('remove-route').addEventListener('click', () => work(async () => {
  if (!confirmReplacement('Removing this route', { route: true, completePlan: true, request: true })) return;
  planDirty = false;
  plan.routes = plan.routes.filter(route => route.id !== selectedRoute); selectedRoute = null;
  dirty = true; routeDirty = false; requestDirty = false; clearMethod(); renderMethods(); buttons(); notice('Route removed from the draft. Save to retain this change.');
}));
$('apply-plan').addEventListener('click', () => work(async () => {
  const value = object(parse('plan', 'Merchant plan'), 'Merchant plan');
  if (!Array.isArray(value.routes)) throw new Error('Merchant plan needs a routes array.');
  if (!confirmReplacement('Applying the complete plan', { route: true, request: true })) return;
  plan = structuredClone(value); dirty = true; routeDirty = false; planDirty = false; clearMethod(); renderMethods(); buttons();
  notice('Complete plan applied to the draft. Save to compile its exact terms and request examples.');
}));
$('read-json').addEventListener('click', () => work(async () => {
  if (!confirmReplacement('Replacing the typed fields with this JSON', { request: true })) return;
  const value = object(parse('request', 'Request'), 'Request');
  $('request').setCustomValidity(''); $('field-form').inert = false; renderFields(value); buttons();
}));
$('save').addEventListener('click', () => work(async () => {
  if (routeDirty || planDirty) throw new Error('Apply or discard the pending route or complete plan edits first.');
  if (!confirmReplacement('Saving the source and plan and reopening the saved request example', { request: true })) return;
  const saved = await json('save', { source: readSource(), protoSource, plan, baseRevision: editorBase, title: $('title').value.trim() });
  await adopt(saved); notice('Source and complete merchant plan saved as ' + short(saved.id) + '.');
}, 'Saving and compiling the exact source and terms…'));
$('capture').addEventListener('click', () => work(async () => {
  if (routeDirty || planDirty) throw new Error('Apply or discard the pending route or complete plan edits first.');
  if (!confirmReplacement('Capturing the source and reopening the saved request example', { request: true })) return;
  const directory = $('proto-directory').value.trim(), entrypoints = $('entrypoints').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (!directory || !entrypoints.length) throw new Error('Choose the merchant-host protobuf directory and at least one entry file.');
  const saved = await json('capture', { directory, entrypoints, source: readSource(), plan,
    baseRevision: editorBase, title: $('title').value.trim() });
  await adopt(saved); notice('Captured ' + saved.protoSource.files.length + ' source files and saved their exact contract.');
}, 'Capturing the private source closure and compiling methods…'));
$('example').addEventListener('click', () => work(async () => {
  if (!confirmReplacement('Loading the included example', { whole: true })) return;
  const example = await json('example'); fillSource(example.source); plan = example.plan;
  adopted = null; protoSource = null; planDirty = false; clearMethod();
  renderSource(); renderMethods();
  $('proto-directory').value = example.protoDirectory; $('entrypoints').value = example.entrypoints.join('\n');
  $('title').value = 'Included analytics example'; dirty = true; routeDirty = false; fillRoute(null); renderRoutes(); buttons();
  notice('Example connection and plan loaded into the draft. Start its documented local server, then Capture and save source.');
}, 'Loading the included example…'));
$('checkout').addEventListener('click', () => work(async () => {
  if (dirty || routeDirty || planDirty) throw new Error('Apply and save, or explicitly reopen the draft before selecting it.');
  if (!confirmReplacement('Selecting this revision and reopening its saved example', { request: true })) return;
  const selected = await json('checkout', { revision: adopted.id, baseRevision: inventory.currentRevision });
  await adopt(selected); notice('This retained revision is now current.');
}, 'Selecting the retained revision…'));
$('review').addEventListener('click', () => work(async () => {
  const result = await json('review', { revision: savedCurrent() }); $('review-output').textContent = pretty(result);
  notice('The captured contract compiled and the native channel became ready. No application RPC was called.');
}, 'Checking the selected native channel and saved terms…'));
$('prepare').addEventListener('click', () => work(async () => {
  const revision = savedCurrent(), id = crypto.randomUUID();
  try {
    await json('prepare', { id, revision }); await refresh(); notice('Merchant prepared. Its source, terms and customer files are retained.');
  } catch (issue) {
    await refresh().catch(() => {}); throw issue;
  }
}, 'Preparing the saved merchant folder…'));
$('call').addEventListener('click', () => work(async () => {
  const revision = savedCurrent(), input = requestValue(), id = crypto.randomUUID();
  try { sessionStorage.setItem(storageKey + ':last-call', id); } catch {}
  try {
    const result = await json('call', { id, revision, method: methodPath, input });
    showAttempt(result); await refresh(); view('operate');
    notice('Upstream operation ' + short(id) + ' is ' + result.phase + '.');
  } catch (issue) {
    const retained = await json('attempt', { id }).catch(() => null);
    if (retained) { showAttempt(retained); await refresh(); view('operate');
      notice('Recovered the retained upstream outcome for ' + short(id) + ': ' + retained.phase + '.', retained.phase === 'COMPLETED' ? '' : 'error'); }
    else throw new Error(issue.message + ' Operation ID ' + id + ' remains selected for readback; it was not automatically retried.');
  }
}, 'Running one intentional upstream request and retaining its outcome…'));
$('stop').addEventListener('click', () => work(async () => {
  await json('stop', {}); await refresh(); notice('Merchant drained and stopped.');
}, 'Draining the original seller and closing its upstream channel…'));
$('release-console').addEventListener('click', () => {
  if (busy) return;
  const windowRef = window.open('about:blank', '_blank');
  if (windowRef) windowRef.opener = null;
  work(async () => {
    try {
      const result = await json('release-console', {}); if (windowRef) windowRef.location.replace(result.url);
      await refresh(); notice('Original release control opened for this workspace’s retained release store.');
    } catch (issue) { windowRef?.close(); throw issue; }
  }, 'Opening original release control…');
});
$('release-close').addEventListener('click', () => work(async () => {
  await json('release-close', {}); await refresh(); notice('Original release control closed.');
}, 'Closing original release control and its owned merchant…'));
$('refresh').addEventListener('click', () => work(async () => {
  await refresh(); notice('Inventory refreshed. The editor still uses its exact opened revision as the save base.');
}));
window.addEventListener('beforeunload', event => { if (dirty || routeDirty || planDirty || requestDirty) { event.preventDefault(); event.returnValue = ''; } });
await work(async () => {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Open the complete private workspace URL printed by its original server.');
  await refresh();
  if (inventory.currentRevision) await adopt(await json('open', { revision: inventory.currentRevision }));
  else { editorBase = null; fillSource({ transport: { mode: 'tls' }, metadata: [], limits: {} }); renderSource(); renderMethods(); }
  let last;
  try { last = sessionStorage.getItem(storageKey + ':last-call'); } catch {}
  if (last) showAttempt(await json('attempt', { id: last }).catch(() => null));
  notice('Private workspace ready. Source and credential values stay on this merchant host.');
}, 'Opening saved merchant work…');
setInterval(() => {
  if (busy || document.hidden || !token) return;
  json('runtime').then(renderRuntime).catch(() => { $('runtime-badge').textContent = 'Connection unavailable'; });
}, 5000);
