// MIT. Private operator UI for the original ClickHouse merchant APIs.
const $ = id => document.getElementById(id);
const clone = value => structuredClone(value);
const pretty = value => JSON.stringify(value, null, 2);
const short = value => value?.slice(0, 12) ?? 'unsaved';
const when = value => value ? new Date(value).toLocaleString() : '—';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const token = location.hash.slice(1);
let inventory, selected, draft, editorBase = null, queryName, routeIndex = 0, review, release, busy = false, dirty = false, rawDirty = false;
function el(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined && text !== null) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}
function button(text, action, className) {
  const element = el('button', text, className); element.type = 'button';
  element.addEventListener('click', () => act(action)); return element;
}
function notice(message, kind = 'info') {
  $('notice').textContent = message; $('notice').dataset.kind = kind; $('notice').hidden = !message;
}
function value(id, supplied) { if (arguments.length === 2) $(id).value = supplied ?? ''; return $(id).value; }
function parse(text, label) {
  try { return JSON.parse(text); } catch { throw Error(label + ' must be valid JSON.'); }
}
function integer(text, label) {
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw Error(label + ' must be a whole number.');
  const result = Number(text);
  if (!Number.isSafeInteger(result)) throw Error(label + ' is too large.');
  return result;
}
function optionalNumber(target, key, raw, fallback, label) {
  const number = integer(raw, label);
  if (own(target, key) || number !== fallback) target[key] = number;
}
function list(text) { return text.split(',').map(part => part.trim()).filter(Boolean); }
function payments(target) { return target?.paymentOptions ?? (target?.payment ? [target.payment] : []); }
function setPayments(target, options) {
  if (own(target, 'payment') && !own(target, 'paymentOptions') && options.length === 1) target.payment = options[0];
  else { delete target.payment; target.paymentOptions = options; }
}
async function api(path, input, download = false) {
  const response = await fetch('/api/' + path, { method: input === undefined ? 'GET' : 'POST',
    headers: { 'x-workspace-token': token, ...(input === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }), cache: 'no-store' });
  if (!response.ok) {
    let issue; try { issue = await response.json(); } catch {}
    const messages = {
      WORKSPACE_REVISION_CONFLICT: 'Saved work changed in another window. Refresh and reopen the current revision before saving this draft.',
      WORKSPACE_SCHEMA_CHANGED_REVIEW_AGAIN: 'The native result schema changed. Review the selected revision again and prepare a new merchant from that review.',
      CLICKHOUSE_ENV_UNAVAILABLE: 'A required ClickHouse environment value is unavailable. Set the source endpoint, user and password in the launching terminal, then reopen this state folder.',
      WORKSPACE_BUSY: 'Another operator action is still finishing. Its status is visible under Prepared merchants.',
      WORKSPACE_CAPABILITY_REQUIRED: 'Open the complete private workspace URL printed by the launching terminal, including its fragment.',
      WORKSPACE_PREPARED_FILES_CHANGED: 'This retained merchant has changed on disk. Open its saved revision, review it and prepare a fresh merchant.',
    };
    const message = messages[issue?.error] ?? issue?.detail ?? issue?.error ?? ('Request failed: ' + response.status);
    throw Error(message + (issue?.field ? ' Field: ' + issue.field + '.' : ''));
  }
  if (!download) return response.json();
  const blob = await response.blob(), digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== response.headers.get('x-content-sha256')) throw Error('The customer download did not match the returned bytes. Request the same retained client again.');
  const filename = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'clickhouse-customer.tar.gz';
  const url = URL.createObjectURL(blob), anchor = el('a'); anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { filename, bytes: blob.size };
}
async function act(action, message) {
  if (busy) return;
  busy = true; controls(); if (message) notice(message);
  try { await action(); }
  catch (error) { notice(error.message, 'error'); }
  finally { busy = false; controls(); }
}
function controls() {
  for (const element of document.querySelectorAll('button,input,select,textarea')) element.disabled = busy;
  $('review-native').disabled = busy || dirty || !selected;
  $('prepare').disabled = busy || dirty || !review || !$('acknowledge').checked;
  $('preview-run').disabled = busy || dirty || !review;
  $('draft-state').textContent = dirty ? 'Unsaved changes' : selected ? 'Saved · ' + short(selected.id) : 'Unsaved draft';
  for (const element of document.querySelectorAll('[data-start-release]'))
    element.disabled = busy || Boolean(inventory?.runtime);
  for (const element of document.querySelectorAll('[data-stop-run]'))
    element.disabled = busy || inventory?.runtime?.state !== 'RUNNING';
}
function changed() { dirty = true; controls(); }
function show(view) {
  for (const element of document.querySelectorAll('.view')) element.hidden = element.id !== view;
  for (const element of document.querySelectorAll('nav button'))
    if (element.dataset.view === view) element.setAttribute('aria-current', 'page'); else element.removeAttribute('aria-current');
}
function metadata(entries) {
  const dl = el('dl', null, 'metadata');
  for (const [key, supplied] of entries) {
    dl.append(el('dt', key), el('dd', supplied === undefined || supplied === null ? '—' : supplied));
  }
  return dl;
}
function table(headers, rows, className) {
  const wrapper = el('div', null, 'table-wrap'), table = el('table', null, className);
  const head = el('thead'), tr = el('tr'); for (const label of headers) tr.append(el('th', label)); head.append(tr);
  const body = el('tbody');
  for (const cells of rows) {
    const row = el('tr');
    for (const cell of cells) {
      const td = el('td');
      if (cell instanceof Node) td.append(cell);
      else if (cell === null) { td.textContent = 'null'; td.className = 'null'; }
      else td.textContent = String(cell);
      row.append(td);
    }
    body.append(row);
  }
  table.append(head, body); wrapper.append(table); return wrapper;
}
function selectOptions(id, entries, chosen) {
  const element = $(id); element.replaceChildren();
  for (const [key, label] of entries) { const option = el('option', label); option.value = key; element.append(option); }
  if (chosen !== undefined && chosen !== null) element.value = String(chosen);
}
function field(parent, label, id, supplied, area = false) {
  const wrapper = el('label', label), input = el(area ? 'textarea' : 'input');
  input.id = id; input.value = supplied ?? '';
  if (area) { input.rows = 3; input.className = 'code'; input.spellcheck = false; }
  wrapper.append(input); parent.append(wrapper); return input;
}
function renderPayments() {
  $('payments').replaceChildren();
  payments(draft.plan).forEach((option, index) => {
    const box = el('div', null, 'payment'), heading = el('div', null, 'payment-heading'), actions = el('div', null, 'row');
    heading.append(el('h4', 'Option ' + (index + 1)));
    const reorder = direction => {
      collect(); const all = payments(draft.plan), next = index + direction;
      if (next < 0 || next >= all.length) return;
      [all[index], all[next]] = [all[next], all[index]]; setPayments(draft.plan, all); changed(); renderEditor();
    };
    actions.append(button('↑', () => reorder(-1), 'small'), button('↓', () => reorder(1), 'small'),
      button('Remove', () => { collect(); const all = payments(draft.plan); all.splice(index, 1); setPayments(draft.plan, all); changed(); renderEditor(); }, 'small'));
    actions.children[0].setAttribute('aria-label', 'Move option ' + (index + 1) + ' earlier');
    actions.children[1].setAttribute('aria-label', 'Move option ' + (index + 1) + ' later');
    heading.append(actions); box.append(heading);
    const grid = el('div', null, 'grid three');
    for (const [key, label] of [['scheme', 'Scheme'], ['network', 'Network'], ['asset', 'Asset'],
      ['payTo', 'Recipient / payTo'], ['amount', 'Exact amount · base units'], ['maxTimeoutSeconds', 'Payment timeout · seconds']])
      field(grid, label, 'payment-' + index + '-' + key, option[key] ?? (key === 'maxTimeoutSeconds' ? 60 : ''));
    box.append(grid); field(box, 'Extra payment terms · JSON object, optional', 'payment-' + index + '-extra', option.extra === undefined ? '' : pretty(option.extra), true);
    $('payments').append(box);
  });
  if (!payments(draft.plan).length) $('payments').append(el('p', 'Add complete inherited options, or provide complete options on every route.', 'hint'));
}
function renderEditor() {
  const source = draft.source, plan = draft.plan;
  for (const [id, key, fallback] of [
    ['database', 'database', ''], ['endpoint-env', 'endpointEnv', ''], ['user-env', 'userEnv', ''], ['password-env', 'passwordEnv', ''],
    ['source-concurrency', 'maxInFlight', 8], ['threads', 'maxThreads', 2], ['memory', 'maxMemoryBytes', 268435456],
    ['scan-rows', 'maxRowsToRead', 1000000], ['scan-bytes', 'maxBytesToRead', 67108864]]) value(id, source[key] ?? fallback);
  $('allow-local').checked = source.allowLocal === true;
  const names = Object.keys(source.queries ?? {});
  if (!names.includes(queryName)) queryName = names[0];
  selectOptions('query-select', names.map(name => [name, name]), queryName);
  $('query-editor').hidden = !queryName;
  if (queryName) {
    const query = source.queries[queryName];
    value('query-name', queryName); value('query-sql', query.sql);
    value('query-parameters', pretty(query.parameters ?? {})); value('query-order', (query.parameterOrder ?? Object.keys(query.parameters ?? {})).join(', '));
    value('query-columns', (query.columns ?? []).join(', ')); value('query-probe', pretty(query.probe ?? {}));
    value('query-rows', query.maxRows ?? 100); value('query-bytes', query.maxBytes ?? 524288); value('query-timeout', query.timeoutMs ?? 1500);
  }
  value('public-origin', plan.publicOrigin);
  const routes = plan.routes ?? [];
  routeIndex = Math.min(Math.max(0, routeIndex), Math.max(0, routes.length - 1));
  selectOptions('route-select', routes.map((route, index) => [String(index), route.id || ('Route ' + (index + 1))]), routeIndex);
  selectOptions('route-query', names.map(name => [name, name]), routes[routeIndex]?.query);
  $('route-editor').hidden = !routes.length;
  if (routes.length) {
    const route = routes[routeIndex];
    for (const [id, key] of [['route-id', 'id'], ['route-path', 'path'], ['route-method', 'method'],
      ['route-service', 'serviceName'], ['route-description', 'description']]) value(id, route[key]);
    value('route-tags', (route.tags ?? []).join(', ')); value('route-example', pretty(route.example ?? {}));
    value('route-descriptions', pretty(route.parameterDescriptions ?? {}));
    value('route-payments', payments(route).length ? pretty(payments(route)) : '');
  }
  renderPayments(); fillRaw(); controls();
}
function collect() {
  if (!draft) throw Error('Load a source and merchant plan first.');
  if (rawDirty) throw Error('Apply the edited complete native documents before saving or switching revisions.');
  const source = clone(draft.source), plan = clone(draft.plan);
  for (const [id, key] of [['database', 'database'], ['endpoint-env', 'endpointEnv'], ['user-env', 'userEnv'], ['password-env', 'passwordEnv']])
    source[key] = value(id).trim();
  for (const [id, key, fallback] of [['source-concurrency', 'maxInFlight', 8], ['threads', 'maxThreads', 2],
    ['memory', 'maxMemoryBytes', 268435456], ['scan-rows', 'maxRowsToRead', 1000000], ['scan-bytes', 'maxBytesToRead', 67108864]])
    optionalNumber(source, key, value(id), fallback, id);
  if (own(source, 'allowLocal') || $('allow-local').checked) source.allowLocal = $('allow-local').checked;
  let nextQuery = queryName;
  if (queryName) {
    nextQuery = value('query-name').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(nextQuery)) throw Error('Use a query name with letters, digits and underscores, beginning with a letter or underscore.');
    if (nextQuery !== queryName && own(source.queries, nextQuery)) throw Error('That query name already exists.');
    const query = clone(source.queries[queryName]);
    query.sql = value('query-sql'); query.parameters = parse(value('query-parameters'), 'Typed parameter declarations');
    const order = list(value('query-order'));
    if (own(query, 'parameterOrder') || pretty(order) !== pretty(Object.keys(query.parameters))) query.parameterOrder = order;
    query.columns = list(value('query-columns')); query.probe = parse(value('query-probe'), 'Private preflight probe');
    optionalNumber(query, 'maxRows', value('query-rows'), 100, 'Returned rows');
    optionalNumber(query, 'maxBytes', value('query-bytes'), 524288, 'Result bytes');
    optionalNumber(query, 'timeoutMs', value('query-timeout'), 1500, 'Query deadline');
    source.queries = Object.fromEntries(Object.entries(source.queries).map(([name, old]) => [name === queryName ? nextQuery : name, name === queryName ? query : old]));
  }
  plan.publicOrigin = value('public-origin').trim();
  if (plan.routes?.[routeIndex]) {
    const route = plan.routes[routeIndex];
    for (const [id, key] of [['route-id', 'id'], ['route-path', 'path'], ['route-method', 'method'], ['route-query', 'query'],
      ['route-service', 'serviceName'], ['route-description', 'description']]) route[key] = value(id);
    const tags = list(value('route-tags')); if (own(route, 'tags') || tags.length) route.tags = tags;
    route.example = parse(value('route-example'), 'Public request example');
    route.parameterDescriptions = parse(value('route-descriptions'), 'Public parameter descriptions');
    const override = value('route-payments').trim();
    if (override) {
      const options = parse(override, 'Route payment options');
      if (!Array.isArray(options)) throw Error('Route payment options must be a JSON array.');
      setPayments(route, options);
    } else { delete route.payment; delete route.paymentOptions; }
  }
  if (queryName && queryName !== nextQuery) for (const route of plan.routes ?? []) if (route.query === queryName) route.query = nextQuery;
  const inherited = payments(plan).map((existing, index) => {
    const option = clone(existing);
    for (const key of ['scheme', 'network', 'asset', 'payTo', 'amount']) option[key] = value('payment-' + index + '-' + key);
    optionalNumber(option, 'maxTimeoutSeconds', value('payment-' + index + '-maxTimeoutSeconds'), 60, 'Payment timeout');
    const extra = value('payment-' + index + '-extra').trim();
    if (extra) option.extra = parse(extra, 'Extra payment terms'); else delete option.extra;
    return option;
  });
  if (inherited.length || own(plan, 'paymentOptions') || own(plan, 'payment')) setPayments(plan, inherited);
  if (pretty(source) !== pretty(draft.source) || pretty(plan) !== pretty(draft.plan)) dirty = true;
  draft = { source, plan }; queryName = nextQuery; return draft;
}
function fillRaw() { value('raw-source', pretty(draft.source)); value('raw-plan', pretty(draft.plan)); rawDirty = false; }
function validDocuments(source, plan) {
  if (!object(source) || !object(source.queries) || !object(plan) || !Array.isArray(plan.routes))
    throw Error('Choose a native ClickHouse source object with named queries and a merchant plan object with routes.');
}
function renderHistory() {
  $('state-path').textContent = inventory.stateDirectory;
  $('revisions').replaceChildren();
  for (const revision of inventory.revisions) {
    const row = button('', async () => {
      if (dirty && !confirm('Discard unsaved editor changes and open this saved revision?')) return;
      const result = await api('checkout', { revision: revision.id, baseRevision: editorBase });
      await adopt(result.revision); notice('Opened retained revision ' + short(revision.id) + '.'); show('editor');
    }, 'revision' + (selected?.id === revision.id ? ' selected' : ''));
    row.append(el('strong', revision.label), el('span', revision.queryCount + ' queries · ' + revision.routeCount + ' routes · ' + short(revision.id)),
      el('time', when(revision.createdAt))); $('revisions').append(row);
  }
  if (!inventory.revisions.length) $('revisions').append(el('p', 'No saved revision yet.', 'muted'));
}
function offerPanels(routes) {
  return routes.map(route => {
    const panel = el('div', null, 'panel'), title = el('div', null, 'offer-title');
    title.append(el('span', route.method, 'badge'), el('strong', route.id), el('span', 'Query: ' + route.query, 'muted'));
    panel.append(title, el('p', route.url, 'offer-url'));
    if (route.description) panel.append(el('p', route.description, 'hint'));
    for (const [index, option] of route.paymentOptions.entries()) {
      const term = el('div', null, 'term'); term.append(el('strong', 'Payment option ' + (index + 1)));
      term.append(metadata([['Scheme', option.scheme], ['Network', option.network], ['Asset', option.asset],
        ['Recipient / payTo', option.payTo], ['Exact base-unit amount', option.amount], ['Timeout · seconds', option.maxTimeoutSeconds]]));
      const remaining = Object.fromEntries(Object.entries(option).filter(([key]) => !['scheme', 'network', 'asset', 'payTo', 'amount', 'maxTimeoutSeconds'].includes(key)));
      if (Object.keys(remaining).length) term.append(el('h4', 'Additional native terms'), el('pre', pretty(remaining)));
      panel.append(term);
    }
    const details = el('details'); details.append(el('summary', 'Public typed input and example'));
    details.append(el('pre', pretty({ input: route.publicInput, schema: route.inputSchema }), 'code'));
    panel.append(details); return panel;
  });
}
function renderReview() {
  $('schema').replaceChildren(); $('review-offers').replaceChildren();
  const hasReview = Boolean(selected && review);
  $('preview-panel').hidden = !hasReview; $('prepare-panel').hidden = !hasReview;
  $('review-status').replaceChildren();
  if (!selected) { $('review-status').textContent = 'Save a revision to review it.'; controls(); return; }
  $('review-status').append(metadata([['Saved revision', selected.label + ' · ' + short(selected.id)],
    ['Native preflight', review ? when(review.checkedAt) : 'Not yet run'], ['ClickHouse version', review?.inspection.serverVersion],
    ['Connection references', [selected.source.endpointEnv, selected.source.userEnv, selected.source.passwordEnv].join(' / ')],
    ['Database', selected.source.database]]));
  if (dirty) $('review-status').append(el('p', 'The editor contains unsaved changes. These details describe the saved revision above.', 'runtime-note'));
  if (!review) { controls(); return; }
  $('review-status').append(el('p', 'Live preflight checks named query shapes. Each later request uses its own ClickHouse snapshot.', 'runtime-note'));
  for (const [name, query] of Object.entries(review.inspection.queries)) {
    const panel = el('div', null, 'panel'), heading = el('div', null, 'query-title');
    heading.append(el('h3', name), el('span', query.maxRows + ' rows · ' + query.maxBytes + ' B · ' + query.timeoutMs + ' ms', 'badge'));
    panel.append(heading, el('h4', 'Typed parameter contract'));
    panel.append(table(['Parameter', 'Native type', 'Original scalar contract'], query.parameterOrder.map(name =>
      [name, query.nativeTypes[name], el('code', pretty(query.parameters[name]))])));
    panel.append(el('h4', 'Actual result columns'), table(['Column', 'Native result type'],
      (review.inspection.columnTypes[name] ?? []).map(column => [column.name, column.type])));
    panel.append(el('p', 'Non-null values are exact ClickHouse text; SQL NULL remains JSON null.', 'contract-meta'));
    $('schema').append(panel);
  }
  const limits = review.inspection.limits;
  $('schema').append(el('p', 'Native source budget: ' + limits.maxThreads + ' threads · ' + limits.maxMemoryBytes +
    ' memory bytes · ' + limits.maxRowsToRead + ' scanned rows · ' + limits.maxBytesToRead + ' scanned bytes per query.', 'hint'));
  const prior = value('preview-query'), names = Object.keys(review.inspection.queries);
  selectOptions('preview-query', names.map(name => [name, name]), names.includes(prior) ? prior : names[0]);
  previewInput(); $('review-offers').append(...offerPanels(selected.routes)); controls();
}
function previewInput() { value('preview-input', pretty(selected?.source.queries[value('preview-query')]?.probe ?? {})); }
function renderRuntime() {
  const runtime = inventory?.runtime; $('runtime').replaceChildren();
  const heading = el('div', null, 'runtime-heading');
  heading.append(el('h3', runtime ? 'Original merchant · ' + runtime.state : 'No merchant active in this workspace'));
  if (runtime) {
    const stop = button('Stop merchant', async () => {
      notice('Draining the original merchant and closing its source…');
      const result = await api('stop', { runId: runtime.runId }); inventory.runtime = result.runtime;
      inventory.previousRun = result.previousRun; renderRuntime(); controls(); notice('The original merchant has stopped. Its source and prepared folder remain available.');
    });
    stop.dataset.stopRun = runtime.runId; heading.append(stop);
  }
  $('runtime').append(heading);
  $('mode').textContent = runtime?.state === 'RUNNING' ? runtime.mode : inventory?.configuredMode ?? 'Connecting';
  if (runtime) {
    $('runtime').append(metadata([['Saved revision', short(runtime.revision)], ['Started', when(runtime.startedAt)], ['Run', runtime.runId], ['Mode', runtime.mode]]));
    const links = el('div', null, 'runtime-links');
    for (const [key, label] of [['docs', 'Customer API'], ['openapi', 'OpenAPI'], ['operations', 'Operations'],
      ['availability', 'Availability'], ['availabilityControl', 'Availability controls']]) if (runtime[key]) {
      const link = el('a', label); link.href = runtime[key]; link.target = '_blank';
      if (['operations', 'availability', 'availabilityControl'].includes(key)) {
        link.rel = 'noopener'; link.referrerPolicy = 'origin';
      } else link.rel = 'noopener noreferrer';
      links.append(link);
    }
    $('runtime').append(links);
    if (runtime.mode === 'CHALLENGE_ONLY') $('runtime').append(el('p', 'The original seller returns HTTP 402. Configure the original facilitator in the launching terminal to enable its paid execution path.', 'runtime-note'));
  } else {
    $('runtime').append(el('p', 'Select a retained merchant below. Starting opens the original local seller and operations interfaces. Stopping waits for the original drain lifecycle.', 'runtime-note'));
    const previous = inventory?.previousRun;
    if (previous) $('runtime').append(el('p', previous.state === 'STOPPED'
      ? 'Last retained run stopped at ' + when(previous.stoppedAt) + '.'
      : 'A previous workspace session recorded run ' + short(previous.runId) + '. Reopening this folder does not start a merchant automatically.', 'runtime-note'));
  }
}
function renderPrepared() {
  $('prepared').replaceChildren();
  for (const prepared of inventory.prepared) {
    const row = button('', async () => {
      release = await api('release', { releaseId: prepared.id }); renderPrepared(); renderRelease(); notice('Opened the retained merchant and its complete payment options.');
    }, 'merchant-card' + (release?.id === prepared.id ? ' selected' : ''));
    row.append(el('strong', prepared.label ?? 'Prepared record needs attention'),
      el('span', prepared.error ?? (prepared.routeCount + ' routes · ' + short(prepared.revision))),
      el('time', when(prepared.createdAt))); $('prepared').append(row);
  }
  if (!inventory.prepared.length) $('prepared').append(el('p', 'No prepared merchants yet. Save a revision, review its native source and prepare it.', 'panel empty'));
  $('unfinished').hidden = !inventory.unfinished.length;
  $('unfinished').replaceChildren(el('h3', 'Interrupted preparation'));
  if (inventory.unfinished.length) {
    $('unfinished').append(el('p', 'The original preparation is offline and create-only. Continue from the same retained revision and review; the unfinished private copy will be rebuilt before publication.', 'hint'));
    for (const id of inventory.unfinished) {
      const revision = id.slice(0, 64), reviewId = id.slice(65);
      $('unfinished').append(button('Resume preparation · ' + short(revision), async () => {
        if (!confirm('Rebuild the unpublished merchant copy from its retained revision and native review?')) return;
        release = await api('prepare', { revision, reviewId, acknowledged: true });
        inventory = await api('state'); renderPrepared(); renderRelease(); notice('Prepared the retained merchant.');
      }));
    }
  }
}
function renderRelease() {
  if (!release) return;
  $('merchant-detail').replaceChildren();
  const panel = el('div', null, 'panel'); panel.append(el('h3', release.label),
    metadata([['Prepared', when(release.createdAt)], ['Saved revision', short(release.revision)],
      ['Native review', when(release.review.checkedAt)], ['ClickHouse version', release.review.inspection.serverVersion]]));
  panel.append(el('code', release.directory, 'folder'));
  const actions = el('div', null, 'toolbar');
  const start = button('Start merchant', async () => {
    notice('Opening the original native source, seller and operations…');
    const result = await api('run', { releaseId: release.id, acknowledged: true }); inventory.runtime = result.runtime;
    renderRuntime(); controls(); notice('The original merchant is running. Open its customer API and operations above.');
  }, 'primary'); start.dataset.startRelease = release.id;
  actions.append(start);
  for (const [kind, label] of [['client', 'Download customer client'], ['openapi', 'Download OpenAPI']])
    actions.append(button(label, async () => {
      const result = await api('export', { releaseId: release.id, kind }, true);
      notice('Downloaded ' + result.filename + ' · ' + result.bytes.toLocaleString() + ' bytes. This customer package contains the generated client and public API description.');
    }));
  panel.append(actions, el('p', 'The private source, SQL, probe values and environment references stay in the merchant folder. Customer downloads contain only the original generated client and public OpenAPI.', 'hint'));
  const reopen = button('Open its saved revision', async () => {
    if (dirty && !confirm('Discard unsaved changes and open this merchant’s saved revision?')) return;
    const result = await api('checkout', { revision: release.revision, baseRevision: editorBase });
    await adopt(result.revision); show('editor'); notice('Opened the merchant’s retained source and plan.');
  });
  panel.append(reopen); $('merchant-detail').append(panel, ...offerPanels(release.routes)); controls();
}
async function adopt(revision) {
  selected = revision; editorBase = revision.id;
  draft = { source: clone(revision.source), plan: clone(revision.plan) }; review = revision.review;
  dirty = false; rawDirty = false; queryName = Object.keys(draft.source.queries)[0]; routeIndex = 0;
  value('revision-label', revision.label); $('acknowledge').checked = false; $('preview-output').replaceChildren();
  inventory = await api('state'); renderEditor(); renderHistory(); renderReview(); renderPrepared(); renderRuntime();
}
async function loadExample() {
  if (dirty && !confirm('Replace the unsaved editor draft with the original example documents?')) return;
  draft = await api('example'); validDocuments(draft.source, draft.plan); rawDirty = false; queryName = null; routeIndex = 0; dirty = true;
  value('revision-label', 'ClickHouse merchant'); renderEditor(); renderReview();
  notice('Loaded the original example draft. Set your real source references, public examples and complete payment terms before saving.'); show('editor');
}
async function refresh() {
  inventory = await api('state');
  if (inventory.currentRevision) await adopt(await api('open', { revision: inventory.currentRevision }));
  else {
    selected = null; editorBase = null; review = null; draft = await api('example'); dirty = true; rawDirty = false;
    value('revision-label', 'ClickHouse merchant'); renderEditor(); renderHistory(); renderReview(); renderPrepared(); renderRuntime();
  }
  notice(selected ? 'Opened saved revision ' + short(selected.id) + '.' : 'Load your native source and plan, or edit the original example draft below.');
}

$('editor').addEventListener('input', event => {
  if (['query-select', 'route-select', 'source-file', 'plan-file'].includes(event.target.id)) return;
  if (['raw-source', 'raw-plan'].includes(event.target.id)) rawDirty = true;
  changed();
});
for (const element of document.querySelectorAll('nav button')) element.addEventListener('click', () => act(() => {
  if (element.dataset.view !== 'editor') { collect(); renderReview(); }
  show(element.dataset.view);
}));
$('refresh').addEventListener('click', () => act(async () => {
  if (dirty && !confirm('Discard unsaved changes and refresh the retained workspace?')) return;
  await refresh(); notice('Reopened the current saved work.');
}));
$('save').addEventListener('click', () => act(async () => {
  collect(); const result = await api('save', { baseRevision: editorBase, ...draft, label: value('revision-label') });
  await adopt(result.revision); notice(result.reused ? 'The unchanged source and plan reused their existing retained revision.' : 'Saved revision ' + short(result.revision.id) + '. Continue to Native review.');
}, 'Saving and validating the source and complete merchant plan…'));
$('example').addEventListener('click', () => act(loadExample));
for (const key of ['source', 'plan']) $(key + '-file').addEventListener('change', () => act(async () => {
  const input = $(key + '-file'), file = input.files?.[0]; if (!file) return;
  if (file.size > 262144) throw Error('Choose a native document no larger than 256 KiB.');
  collect(); const candidate = { ...draft, [key]: parse(await file.text(), key + ' file') };
  validDocuments(candidate.source, candidate.plan); draft = candidate; queryName = null; routeIndex = 0; rawDirty = false; dirty = true;
  renderEditor(); renderReview(); input.value = ''; notice('Loaded ' + file.name + ' into the private draft. Save both documents as one revision.');
}));
$('query-select').addEventListener('change', () => act(() => {
  const chosen = value('query-select');
  try { collect(); queryName = chosen; renderEditor(); } catch (error) { value('query-select', queryName); throw error; }
}));
$('route-select').addEventListener('change', () => act(() => {
  const chosen = Number(value('route-select'));
  try { collect(); routeIndex = chosen; renderEditor(); } catch (error) { value('route-select', routeIndex); throw error; }
}));
$('add-query').addEventListener('click', () => act(() => {
  collect(); let name = 'query_1', count = 1; while (own(draft.source.queries, name)) name = 'query_' + ++count;
  draft.source.queries = { ...draft.source.queries, [name]: { sql: 'SELECT $value AS value',
    parameters: { value: { type: 'string' } }, columns: ['value'], probe: { value: '' } } };
  queryName = name; changed(); renderEditor(); $('query-name').focus();
}));
$('remove-query').addEventListener('click', () => act(() => {
  collect(); if (!queryName) return;
  if (draft.plan.routes.some(route => route.query === queryName)) throw Error('Remove or change the public routes using this query first.');
  draft.source.queries = Object.fromEntries(Object.entries(draft.source.queries).filter(([name]) => name !== queryName));
  queryName = null; changed(); renderEditor();
}));
$('add-route').addEventListener('click', () => act(() => {
  collect(); if (!queryName) throw Error('Add an approved query before adding its public route.');
  let id = 'route_1', count = 1; while (draft.plan.routes.some(route => route.id === id)) id = 'route_' + ++count;
  draft.plan.routes.push({ id, path: '/' + id, method: 'POST', query: queryName,
    serviceName: 'ClickHouse data', description: 'Approved native query results', example: {},
    parameterDescriptions: Object.fromEntries(Object.keys(draft.source.queries[queryName].parameters).map(name => [name, 'Value for ' + name])) });
  routeIndex = draft.plan.routes.length - 1; changed(); renderEditor();
  notice('Added the route. Supply its explicit public example; private probe values are not copied into customer offers.');
}));
$('remove-route').addEventListener('click', () => act(() => {
  collect(); draft.plan.routes.splice(routeIndex, 1); routeIndex = 0; changed(); renderEditor();
}));
$('add-payment').addEventListener('click', () => act(() => {
  collect(); const all = payments(draft.plan);
  all.push({ scheme: 'exact', network: 'stellar:testnet', asset: '', payTo: '', amount: '10000', maxTimeoutSeconds: 60 });
  setPayments(draft.plan, all); changed(); renderEditor();
}));
$('refresh-json').addEventListener('click', () => act(() => {
  if (rawDirty && !confirm('Replace unapplied JSON edits with the current form values?')) return;
  rawDirty = false; collect(); fillRaw(); notice('Filled both native documents from the editor.');
}));
$('apply-json').addEventListener('click', () => act(() => {
  const source = parse(value('raw-source'), 'Private source JSON'), plan = parse(value('raw-plan'), 'Merchant plan JSON');
  validDocuments(source, plan); draft = { source, plan }; queryName = null; routeIndex = 0; rawDirty = false; dirty = true;
  renderEditor(); notice('Applied both native documents to the editor. Save them as one retained revision.');
}));
$('review-native').addEventListener('click', () => act(async () => {
  const result = await api('review', { revision: selected.id }); review = result.review; selected.review = review; selected.routes = result.routes;
  $('acknowledge').checked = false; renderReview(); notice('Live ClickHouse preflight completed. Review the native types, private preview and complete ordered terms below.');
}, 'Reviewing the actual selected ClickHouse source and native query schemas…'));
$('preview-query').addEventListener('change', previewInput);
$('preview-run').addEventListener('click', () => act(async () => {
  const result = await api('preview', { revision: selected.id, reviewId: review.id, query: value('preview-query'),
    parameters: parse(value('preview-input'), 'Private preview input') });
  $('preview-output').replaceChildren(el('p', result.rowCount + ' rows · ' + (result.truncated ? 'More rows exist beyond this page.' : 'Complete bounded response.') + ' Single-request snapshot.', 'result-summary'),
    table(result.columns, result.rows.map(row => result.columns.map(name => row[name])), 'result-table'));
  notice('Private native preview completed for ' + result.query + '.');
}, 'Executing the selected approved query privately…'));
$('acknowledge').addEventListener('change', controls);
$('prepare').addEventListener('click', () => act(async () => {
  release = await api('prepare', { revision: selected.id, reviewId: review.id, acknowledged: $('acknowledge').checked });
  inventory = await api('state'); renderPrepared(); renderRelease(); renderRuntime(); show('merchants');
  notice('Prepared the retained merchant. Its original customer client is ready to download, and the merchant can be started below.');
}, 'Preparing the original seller service and generated customer client…'));

async function poll() {
  try {
    if (inventory && !document.hidden) {
      const result = await api('runtime'); inventory.runtime = result.runtime; inventory.previousRun = result.previousRun;
      renderRuntime(); controls();
    }
  } catch {}
  setTimeout(poll, 3000);
}
if (!/^[a-f0-9]{64}$/.test(token)) {
  notice('Open the complete private workspace URL from the launching terminal, including its fragment.', 'error');
  busy = true; controls();
} else {
  await act(refresh, 'Opening retained merchant work…'); poll();
}
