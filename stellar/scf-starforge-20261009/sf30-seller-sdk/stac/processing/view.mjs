// MIT. This component mounts inside the original authenticated STAC analyst UI.
const el = (tag, text, attrs = {}) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'checked') node.checked = Boolean(value);
    else node.setAttribute(key, String(value));
  }
  return node;
};
const field = (label, input) => { const wrap = el('label'); wrap.append(el('span', label), input); return wrap; };
const input = (type = 'text', value = '', attrs = {}) => { const node = el('input', null, { type, ...attrs }); node.value = value; return node; };
const button = text => el('button', text, { type: 'button' });
const optionList = (select, values, label, empty = 'Choose a saved record') => {
  const previous = new Set([...select.selectedOptions].map(v => v.value));
  select.replaceChildren();
  if (!select.multiple) select.append(el('option', empty, { value: '' }));
  for (const value of values) {
    const option = el('option', label(value), { value: value.id ?? value.key });
    option.selected = previous.has(option.value); select.append(option);
  }
};
const bytesBase64 = bytes => {
  let value = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) value += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(value);
};
const fileBytes = async node => {
  if (!node.files?.length) throw new Error('Choose the original source file.');
  return new Uint8Array(await node.files[0].arrayBuffer());
};
const jsonDownload = (value, filename) => download(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }), filename);
function download(blob, filename) {
  const href = URL.createObjectURL(blob), anchor = el('a', 'Download', { href, download: filename });
  anchor.click(); setTimeout(() => URL.revokeObjectURL(href), 30000);
}
function table(headings, rows) {
  const wrap = el('div', null, { class: 'table-wrap' }), t = el('table'), head = el('thead'), tr = el('tr');
  for (const h of headings) tr.append(el('th', h, { scope: 'col' }));
  head.append(tr); t.append(head);
  const body = el('tbody');
  for (const row of rows) {
    const item = el('tr');
    for (const value of row) { const cell = el('td'); cell.append(value instanceof Node ? value : document.createTextNode(String(value ?? '—'))); item.append(cell); }
    body.append(item);
  }
  t.append(body); wrap.append(t); return wrap;
}
const short = value => String(value ?? '').slice(0, 12);
const dialectOf = entry => entry?.dialect ?? entry?.deployment?.dialect ?? 'filmdrop';
const nativeWorkflow = run => run.workflowId ?? run.latest?.workflow_id ??
  [run.latest?.collections ?? run.latest?.source_id, run.latest?.workflow ?? run.latest?.workflow_definition_id].filter(v => v != null && v !== '').join('/');
const nativeIdentity = value => {
  const item = value?.latest ?? value?.identity ?? value ?? {};
  return [item.run_id, item.payload_id].filter(v => v != null && v !== '').join(' / ') || 'Unspecified native identity';
};
const textValue = value => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const nativeLink = (label, href) => {
  try { const url = new URL(href); if (['http:', 'https:'].includes(url.protocol))
    return el('a', label, { href: url.href, target: '_blank', rel: 'noopener noreferrer' }); } catch {}
  return el('span', label + (href ? ': ' + String(href) : ''));
};
const sourceCaption = capture => capture ? 'HTTP ' + String(capture.status ?? 'unknown') +
  ' · captured ' + (capture.capturedAt ?? 'time unavailable') + ' · SHA-256 ' + (capture.sha256 ?? 'unavailable') +
  (capture.imported ? ' · imported original response' : '') : 'Source metadata unavailable';
const rawDetails = (title, document) => {
  const box = el('details'), raw = JSON.stringify(document, null, 2) ?? 'null';
  box.append(el('summary', title), el('pre', raw.length > 200000 ? raw.slice(0, 200000) +
    '\nDisplay excerpt; the complete retained JSON is available in the download.' : raw));
  return box;
};
const taskCounts = edition => edition.tasks.reduce((s, t) => ({ ...s, pages: s.pages + t.pages,
  failed: s.failed + Number(t.state === 'FAILED'), complete: s.complete + Number(t.state === 'COMPLETE') }), { pages: 0, failed: 0, complete: 0 });

export async function mountProcessingView({ root, context: initialContext, api } = {}) {
  if (!(root instanceof Element) || !api?.getState || !api?.read || !api?.run) throw new TypeError('Use the original STAC processing mount contract.');
  const events = new AbortController(); let context = initialContext ?? {}, state = null, disposed = false;
  let refreshing = null, again = false, nativeRuns = [], runPage = 0, associationModel = null, loadedInventoryId = null;
  const jobs = new Map();
  const section = el('section', null, { class: 'panel processing-panel', 'aria-label': 'Processing history' });
  const status = el('p', 'Reading saved processing state…', { role: 'status', 'aria-live': 'polite' });
  const error = el('p', '', { role: 'alert' }); error.hidden = true;
  const selectedContext = el('p', '', { class: 'muted' }), saved = el('p', '', { class: 'muted' });
  section.append(el('h2', 'Processing history'), selectedContext, saved, status, error);
  root.replaceChildren(section);
  const on = (node, event, fn) => node.addEventListener(event, fn, { signal: events.signal });
  const report = problem => { error.hidden = false; error.textContent = String(problem?.message ?? problem); status.textContent = 'The original saved state is retained.'; };
  async function action(name, value) {
    error.hidden = true;
    const job = await api.run(name, value);
    if (job?.id) jobs.set(job.id, job);
    status.textContent = job?.status === 'COMPLETE' ? 'Saved ' + name + '.' : 'Started ' + name + '. Saved progress will appear below.';
    await refresh(); return job;
  }
  const click = (node, fn) => on(node, 'click', async () => {
    node.disabled = true; error.hidden = true;
    try { await fn(); } catch (e) { report(e); } finally { node.disabled = false; }
  });
  const group = title => { const box = el('fieldset'); box.append(el('legend', title)); section.append(box); return box; };

  const configuration = el('details'), configSummary = el('summary', 'Configure an existing processing deployment');
  const configFields = el('fieldset'); configuration.append(configSummary, configFields); section.append(configuration);
  const deploymentId = input('text', '', { required: true, placeholder: 'deployment-id' });
  const deploymentTitle = input('text', ''), baseUrl = input('url', '', { required: true, placeholder: 'https://your-existing-deployment.example' });
  const pageSize = input('number', '100', { min: 1, max: 1000 });
  const deploymentDialect = el('select');
  deploymentDialect.append(el('option', 'FilmDrop API', { value: 'filmdrop' }), el('option', 'Cirrus state API', { value: 'cirrus-state' }));
  const metricsUrl = input('url', '', { placeholder: 'Exact public statistics URL, if configured' });
  const openapiFile = input('file', '', { accept: '.json,application/json' });
  const sourceUrl = input('url', ''), sourceStatus = input('number', '', { min: 100, max: 599 });
  const sourceTime = input('text', '', { placeholder: 'Original ISO timestamp, if available' });
  const sourceFileField = field('Exact deployed OpenAPI JSON', openapiFile), sourceHelp = el('p', '', { class: 'muted' });
  const useCredential = input('checkbox'), envRef = input('text', '', { placeholder: 'Existing environment variable name' });
  const authHeader = input('text', 'Authorization'), authPrefix = input('text', 'Bearer ');
  configFields.append(field('Deployment ID', deploymentId), field('Title', deploymentTitle), field('API dialect', deploymentDialect),
    field('Existing API base URL', baseUrl), field('Native statistics URL (optional)', metricsUrl),
    field('Page size', pageSize), sourceFileField, sourceHelp, field('Original source URL', sourceUrl),
    field('Actual source HTTP status (blank means unknown)', sourceStatus), field('Source captured at', sourceTime),
    field('Use an existing credential reference', useCredential), field('Credential environment reference', envRef),
    field('Header name', authHeader), field('Header prefix', authPrefix),
    el('p', 'The operator process reads the named credential from its existing environment. Enter no credential value here.', { class: 'muted' }));
  let retainedConfiguration = null;
  function configureDialect() {
    const cirrus = deploymentDialect.value === 'cirrus-state';
    sourceFileField.querySelector('span').textContent = cirrus ? 'Original Cirrus root JSON or public source package' : 'Exact deployed OpenAPI JSON';
    sourceHelp.textContent = cirrus ? 'Use the actual root response or its complete public source package. The configured base URL and native child workflow links define this deployment.' :
      'Use the OpenAPI document served by this deployment so that its original routes and filters are preserved.';
    metricsUrl.disabled = !cirrus;
  }
  on(deploymentDialect, 'change', configureDialect); configureDialect();
  const sourceChoice = el('p', 'Choose the deployed source file, or open a retained source below.', { class: 'muted' });
  const configure = button('Save deployment and exact source'); configFields.append(sourceChoice, configure);
  on(openapiFile, 'change', () => { retainedConfiguration = null; sourceUrl.readOnly = sourceStatus.readOnly = sourceTime.readOnly = false; sourceChoice.textContent = 'Using the selected source file.'; });
  click(configure, async () => action(retainedConfiguration ? 'configure-retained' : 'configure', {
    ...(retainedConfiguration ? { deploymentKey: retainedConfiguration } : {}),
    deployment: { ...(retainedConfiguration ? state.deployments.find(v => v.key === retainedConfiguration).deployment : {}),
      id: deploymentId.value.trim(), title: deploymentTitle.value.trim(), baseUrl: baseUrl.value.trim(),
      pageSize: Number(pageSize.value), dialect: deploymentDialect.value,
      metricsUrl: deploymentDialect.value === 'cirrus-state' ? metricsUrl.value.trim() || null : null,
      credential: useCredential.checked ? {
        envRef: envRef.value.trim(), header: authHeader.value.trim(), prefix: authPrefix.value } : null },
    ...(!retainedConfiguration ? { sourceBase64: bytesBase64(await fileBytes(openapiFile)) } : {}), sourceMetadata: {
      url: sourceUrl.value.trim() || null, status: sourceStatus.value === '' ? null : Number(sourceStatus.value),
      capturedAt: sourceTime.value.trim() || null
    }
  }));

  const inventoryBox = group('1. Read the configured workflow inventory');
  const deployments = el('select'), deploymentInfo = el('p', '', { class: 'muted' });
  const useRetained = button('Open retained source configuration'), downloadSource = button('Download exact source');
  const discover = button('Read workflow inventory'), prepareInventory = button('Prepare for an externally captured inventory');
  const inventories = el('select'), loadInventory = button('Open saved workflow inventory'), inventorySummary = el('p', '', { class: 'muted' });
  const workflows = el('div');
  inventoryBox.append(field('Saved deployment and source edition', deployments), deploymentInfo, useRetained, downloadSource, discover, prepareInventory,
    field('Saved inventory', inventories), loadInventory, inventorySummary, workflows);
  function describeDeployment() {
    const d = state?.deployments.find(v => v.key === deployments.value);
    deploymentInfo.textContent = d ? d.deployment.baseUrl + ' · ' + (dialectOf(d) === 'cirrus-state' ? 'Cirrus state API' : 'FilmDrop API') +
      ' · source ' + short(d.source.sha256) + ' · HTTP ' + String(d.source.status ?? 'unknown') +
      (d.nativeRootId ? ' · root ' + d.nativeRootId : '') +
      (d.workflowCount != null ? ' · ' + d.workflowCount + ' native workflows' : '') +
      (d.workflowFilter ? ' · filter ' + d.workflowFilter : '') +
      (d.deployment.credential ? d.credentialsConfiguredHere ? ' · credential reference configured here' : ' · received credential reference' : ' · public reads') : '';
  }
  on(deployments, 'change', () => { describeDeployment(); syncReviewDialect(); });
  click(useRetained, async () => {
    const d = state?.deployments.find(value => value.key === deployments.value);
    if (!d) throw new Error('Choose a saved deployment and source edition.');
    retainedConfiguration = d.key;
    deploymentId.value = d.deployment.id; deploymentTitle.value = d.deployment.title;
    baseUrl.value = d.deployment.baseUrl; pageSize.value = d.deployment.pageSize;
    deploymentDialect.value = dialectOf(d); metricsUrl.value = d.deployment.metricsUrl ?? ''; configureDialect();
    sourceUrl.value = d.source.url ?? ''; sourceStatus.value = d.source.status ?? '';
    sourceTime.value = d.source.capturedAt ?? ''; openapiFile.value = '';
    sourceUrl.readOnly = sourceStatus.readOnly = sourceTime.readOnly = true;
    useCredential.checked = Boolean(d.deployment.credential);
    envRef.value = d.deployment.credential?.envRef ?? '';
    authHeader.value = d.deployment.credential?.header ?? 'Authorization';
    authPrefix.value = d.deployment.credential?.prefix ?? 'Bearer ';
    sourceChoice.textContent = 'Retained source ' + d.source.sha256 + '. Review this origin and environment reference, then save the configuration here.';
    configuration.open = true; configure.focus();
  });
  click(downloadSource, async () => {
    const value = await api.read('source', { deploymentKey: deployments.value });
    const raw = atob(value.contentBase64), bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
    if (bytes.length !== value.bytes || hash !== value.sha256) throw new Error('The retained source bytes changed.');
    download(new Blob([bytes], { type: 'application/json' }), 'processing-source-' + hash + '.json');
  });
  click(discover, () => action('discover', { deploymentKey: deployments.value }));
  click(prepareInventory, () => action('prepare-inventory', { deploymentKey: deployments.value }));
  click(loadInventory, async () => {
    const result = await api.read('inventory', { editionId: inventories.value });
    const chain = result.chains.find(v => v.kind === 'instances');
    inventorySummary.textContent = (chain?.records.length ?? 0) + ' original workflows · ' + (chain?.pages ?? 0) + ' pages · ' + (chain?.state ?? result.state);
    const checked = loadedInventoryId === inventories.value ? new Set([...workflows.querySelectorAll('input:checked')].map(v => v.value)) : new Set();
    workflows.replaceChildren(); loadedInventoryId = inventories.value;
    for (const record of chain?.records ?? []) {
      const w = record.value, choice = input('checkbox', w.id); choice.checked = checked.has(w.id);
      const row = el('div'), title = w.title && w.title !== w.id ? w.title + ' · ' + w.id : w.id;
      row.append(field(title + (w.state ? ' · ' + w.state : ''), choice));
      if (w.collections != null || w.workflow != null) row.append(el('p', [w.collections, w.workflow].filter(v => v != null).map(textValue).join(' / '), { class: 'muted' }));
      if (w.nativeLink) row.append(nativeLink('Original workflow endpoint', w.nativeLink.href ?? w.nativeLink));
      workflows.append(row);
    }
    if (chain?.state !== 'COMPLETE') workflows.append(el('p', 'Finish this original inventory chain before reviewing a run capture.'));
    syncReviewDialect();
  });
  on(inventories, 'change', () => {
    if (loadedInventoryId !== inventories.value) { workflows.replaceChildren(); inventorySummary.textContent = 'Open this saved inventory to select its original workflows.'; loadedInventoryId = null; }
    syncReviewDialect();
  });

  const reviewBox = group('2. Review the run-history request');
  const since = input('text', 'P1D', { required: true }), bindScenes = input('checkbox'); bindScenes.checked = true;
  let reviewDialect = 'filmdrop';
  const sinceValues = new Map([['filmdrop', 'P1D'], ['cirrus-state', '1h']]), sinceHelp = el('p', '', { class: 'muted' });
  const nativeState = el('select');
  nativeState.append(el('option', 'All native states', { value: '' }));
  for (const name of ['PROCESSING', 'COMPLETED', 'FAILED', 'INVALID', 'ABORTED']) nativeState.append(el('option', name, { value: name }));
  const nativeStateField = field('Native state filter', nativeState); nativeStateField.hidden = true;
  const summaryDetail = input('checkbox'); summaryDetail.checked = true;
  const summaryDetailField = field('Read native workflow counts', summaryDetail); summaryDetailField.hidden = true;
  const actor = input('text', '', { required: true }), reviewNote = el('textarea', '', { rows: 3 });
  const detailNames = ['events', 'input_payload', 'output_payload', 'definition'], detailInputs = new Map();
  const detailGroup = el('div');
  for (const name of detailNames) { const check = input('checkbox'); check.checked = name !== 'definition'; detailInputs.set(name, check); detailGroup.append(field(name.replaceAll('_', ' '), check)); }
  const logs = input('checkbox'); logs.checked = true;
  let filmDropDetailSelection = new Map([...detailInputs].map(([name, node]) => [name, node.checked])), filmDropLogsSelected = true;
  const review = button('Save reviewed workflow selection'), reviews = el('select'), capture = button('Capture the reviewed run history');
  const prepareCapture = button('Prepare for externally captured run pages');
  function syncReviewDialect() {
    const inventory = state?.editions.find(v => v.id === inventories.value);
    const entry = state?.deployments.find(v => v.key === (inventory?.deploymentKey ?? inventory?.selection?.deploymentKey ?? deployments.value));
    const dialect = dialectOf(entry), changed = dialect !== reviewDialect;
    if (changed && reviewDialect === 'filmdrop') { filmDropDetailSelection = new Map([...detailInputs].map(([name, node]) => [name, node.checked])); filmDropLogsSelected = logs.checked; }
    if (changed) { sinceValues.set(reviewDialect, since.value); reviewDialect = dialect; since.value = sinceValues.get(dialect) ?? (dialect === 'cirrus-state' ? '1h' : 'P1D'); }
    const cirrus = dialect === 'cirrus-state';
    since.placeholder = cirrus ? '1h, 1d, 7d or 30d' : 'P1D';
    sinceHelp.textContent = cirrus ?
      'Cirrus evaluates this native duration separately at each page request. Common values are 1h, 1d, 7d and 30d. An explicit continuation retains the same duration and selected native state.' :
      'FilmDrop evaluates this native duration at each request. Each selected workflow keeps its own unchanged page chain.';
    nativeStateField.hidden = !cirrus; nativeState.disabled = !cirrus; summaryDetailField.hidden = !cirrus;
    for (const [name, node] of detailInputs) { node.disabled = cirrus; if (cirrus) node.checked = false; else if (changed) node.checked = filmDropDetailSelection.get(name) ?? false; }
    logs.disabled = cirrus; if (cirrus) logs.checked = false; else if (changed) logs.checked = filmDropLogsSelected;
    detailGroup.title = cirrus ? 'These FilmDrop detail routes are not part of this Cirrus deployment. Native payloads, outputs and executions remain in the saved run JSON.' : '';
  }
  reviewBox.append(field('Native since duration', since), sinceHelp, nativeStateField,
    field('Bind to the current saved STAC scene edition', bindScenes), summaryDetailField, detailGroup, field('Read native log links supplied by selected events', logs),
    field('Reviewer', actor), field('Review note', reviewNote), review, field('Saved review', reviews), capture, prepareCapture);
  click(review, () => {
    if (loadedInventoryId !== inventories.value) throw new Error('Open the selected saved inventory before reviewing its workflows.');
    return action('review', {
    inventoryId: inventories.value, workflowIds: [...workflows.querySelectorAll('input:checked')].map(v => v.value),
    since: /^\d+(?:\.\d+)?$/.test(since.value.trim()) ? Number(since.value) : since.value.trim(),
    stacEditionId: bindScenes.checked ? context.editionId ?? null : null,
    ...(reviewDialect === 'cirrus-state' ? { state: nativeState.value || null } : {}),
    details: reviewDialect === 'cirrus-state' ? summaryDetail.checked ? ['summary'] : [] : [...detailInputs].filter(([, node]) => node.checked).map(([name]) => name),
    logs: reviewDialect === 'cirrus-state' ? false : logs.checked,
    actor: actor.value.trim(), note: reviewNote.value
  }); });
  click(capture, () => action('capture', { reviewId: reviews.value }));
  click(prepareCapture, () => action('prepare-capture', { reviewId: reviews.value }));

  const historyBox = group('3. Open saved history or continue its remaining pages');
  const editions = el('select'), loadRuns = button('Read saved runs'), resume = button('Resume remaining pages'), retryFailed = input('checkbox');
  const cancel = button('Cancel this capture'), historySummary = el('p', '', { class: 'muted' }), taskView = el('div'), runView = el('div');
  const previousRuns = button('Previous runs'), nextRuns = button('Next runs'), runSummary = el('p', '', { class: 'muted' });
  const runSelect = el('select'), inspectRun = button('Open native run details'), detailView = el('div');
  historyBox.append(field('Saved processing edition', editions), historySummary, resume, field('Also retry definitively failed tasks', retryFailed),
    cancel, taskView, loadRuns, runSummary, previousRuns, nextRuns, runView, field('Native run', runSelect), inspectRun, detailView);
  function renderTasks() {
    const e = state?.editions.find(v => v.id === editions.value); taskView.replaceChildren(); historySummary.textContent = '';
    if (!e) return;
    const counts = taskCounts(e); historySummary.textContent = e.state + ' · ' + counts.pages + ' saved pages · ' +
      counts.complete + '/' + e.tasks.length + ' complete tasks · ' + counts.failed + ' failed' + (e.retryAt ? ' · Retry after ' + e.retryAt : '');
    taskView.append(table(['Task / workflow', 'State', 'Pages', 'Coverage', 'Outcome / continuation'], e.tasks.map(t => {
      const outcome = el('div'), coverage = t.coverage;
      outcome.append(el('span', textValue(t.error ?? t.terminal ?? '')));
      if (t.next) outcome.append(rawDetails('Next original request', t.next));
      if (t.continuationAvailable && t.latestCaptureSha256) {
        const next = button('Continue from last native payload'), prepareNext = button('Prepare continuation for an external capture');
        const choice = el('details'); choice.append(el('summary', 'Review native page continuation'));
        choice.append(el('p', 'The saved page has records and no provider continuation token. This action selects its last original payload_id as the documented nextkey, preserving the native since and state values.'),
          el('p', 'Retained page SHA-256: ' + t.latestCaptureSha256, { class: 'muted' }), next, prepareNext);
        click(next, () => action('continue-page', { editionId: e.id, taskId: t.id, expectedCaptureSha256: t.latestCaptureSha256 }));
        click(prepareNext, () => action('prepare-continuation', { editionId: e.id, taskId: t.id, expectedCaptureSha256: t.latestCaptureSha256 }));
        outcome.append(choice);
      }
      const scope = coverage ? (coverage.complete ? 'Observed empty terminal page' : String(coverage.status ?? 'Native coverage unresolved')) +
        (coverage.returned != null ? ' · returned ' + coverage.returned : '') +
        (coverage.requestedLimit != null ? ' / requested ' + coverage.requestedLimit : '') +
        (coverage.pageFilled ? ' · filled page' : '') +
        (coverage.continuationSource ? ' · ' + coverage.continuationSource : '') : '—';
      return [t.kind + (t.scope?.workflowId ? ' / ' + t.scope.workflowId : ''), t.state, t.pages, scope, outcome];
    })));
  }
  on(editions, 'change', () => {
    nativeRuns = []; runPage = 0; detailView.replaceChildren(); associationModel = null;
    associationSummary.replaceChildren(); associatedRun.replaceChildren(); associatedItem.replaceChildren(); associatedAsset.replaceChildren();
    statisticsModel = null; statisticsContent.replaceChildren();
    renderTasks(); renderRuns(); refreshImportTasks();
  });
  click(resume, () => action('resume', { editionId: editions.value, retryFailed: retryFailed.checked }));
  click(cancel, () => action('cancel', { editionId: editions.value }));
  function renderRuns() {
    runView.replaceChildren(); const start = runPage * 50, rows = nativeRuns.slice(start, start + 50);
    runView.append(table(['Workflow', 'Native run / payload', 'State', 'Updated', 'Latest native error'], rows.map(v => [
      nativeWorkflow(v), nativeIdentity(v), v.latest.state, v.latest.updated ?? v.latest.updated_at ?? '',
      textValue(v.latest.last_error ?? '')
    ])));
    runSummary.textContent = nativeRuns.length ? 'Showing ' + (start + 1) + '–' + (start + rows.length) + ' of ' + nativeRuns.length + ' retained runs.' : 'No saved run selected.';
    previousRuns.disabled = runPage === 0; nextRuns.disabled = start + 50 >= nativeRuns.length;
    optionList(runSelect, nativeRuns.map(v => ({ id: v.key, value: v })), v => nativeWorkflow(v.value) + ' · ' + nativeIdentity(v.value));
  }
  click(loadRuns, async () => { const result = await api.read('runs', { editionId: editions.value }); nativeRuns = result.runs; runPage = 0; renderRuns(); });
  on(previousRuns, 'click', () => { if (runPage > 0) { runPage--; renderRuns(); } });
  on(nextRuns, 'click', () => { if ((runPage + 1) * 50 < nativeRuns.length) { runPage++; renderRuns(); } });
  click(inspectRun, async () => {
    const value = await api.read('run', { editionId: editions.value, runKey: runSelect.value });
    detailView.replaceChildren(el('h3', 'Native run and execution history'));
    const saveRun = button('Download complete retained run details'); detailView.append(saveRun);
    click(saveRun, () => jsonDownload(value, 'processing-run-' + short(value.key) + '.json'));
    const latest = value.latest ?? {};
    detailView.append(table(['Native field', 'Retained value'], [
      ['Workflow', nativeWorkflow(value)], ['payload_id', latest.payload_id], ['state', latest.state],
      ['collections', textValue(latest.collections)], ['workflow', latest.workflow], ['items', textValue(latest.items)],
      ['created', latest.created ?? latest.created_at], ['updated', latest.updated ?? latest.updated_at]
    ]));
    if (value.dialect === 'cirrus-state' || latest.collections != null && latest.workflow != null) {
      if (Array.isArray(latest.executions) && latest.executions.length) {
        const links = el('ul');
        for (const [index, href] of latest.executions.entries()) if (typeof href === 'string') { const row = el('li'); row.append(nativeLink('Native execution ' + (index + 1), href)); links.append(row); }
        detailView.append(links);
      }
      for (const name of ['payload', 'executions', 'outputs', 'catid', 'catalog']) if (Object.hasOwn(latest, name))
        detailView.append(rawDetails('Native ' + name, latest[name]));
    }
    detailView.append(rawDetails('Complete native run and observations', { latest: value.latest, observations: value.observations }));
    for (const detail of value.details ?? []) {
      const box = el('details'); box.append(el('summary', detail.kind + ' · HTTP ' + String(detail.metadata.status) + ' · ' + short(detail.metadata.sha256)));
      box.append(el('p', 'Execution scope: ' + JSON.stringify(detail.scope) + ' · ' + detail.terminal));
      const raw = JSON.stringify(detail.document, null, 2);
      box.append(el('pre', raw.length > 200000 ? raw.slice(0, 200000) + '\nDisplay excerpt; the download above contains every retained field.' : raw));
      detailView.append(box);
    }
  });

  const statisticsBox = el('details'), loadStatistics = button('Read saved workflow counts and metrics');
  const statisticsContent = el('div'); let statisticsModel = null;
  statisticsBox.append(el('summary', 'Native workflow counts and state transitions'), loadStatistics, statisticsContent);
  historyBox.append(statisticsBox);
  click(loadStatistics, async () => {
    statisticsModel = await api.read('statistics', { editionId: editions.value });
    statisticsContent.replaceChildren();
    const saveStatistics = button('Download complete native statistics and source metadata');
    click(saveStatistics, () => jsonDownload(statisticsModel, 'processing-statistics-' + statisticsModel.editionId + '.json'));
    statisticsContent.append(saveStatistics);
    const summaries = statisticsModel.summaries ?? [], countRows = [];
    for (const record of summaries) for (const [stateName, count] of Object.entries(record.document?.counts ?? {})) {
      const exact = typeof count === 'number' && Number.isFinite(count) || typeof count === 'string' && /^\d+$/.test(count);
      const capped = typeof count === 'string' && /^\d+\+$/.test(count);
      countRows.push([record.workflowId ?? [record.document.collections, record.document.workflow].filter(v => v != null).join('/'),
        stateName, exact ? count : '—', capped ? count : '—', !exact && !capped ? textValue(count) : '',
        record.capture?.capturedAt ?? 'unknown']);
    }
    if (countRows.length) {
      statisticsContent.append(el('h3', 'Retained workflow counts'),
        el('p', 'A value such as 100000+ is a literal source cap. Exact counts and capped values are shown separately.', { class: 'muted' }),
        table(['Workflow', 'Native state', 'Exact count', 'Capped native count', 'Other native value', 'Captured at'], countRows));
      for (const record of summaries) statisticsContent.append(rawDetails('Original workflow summary · ' +
        (record.workflowId ?? record.document?.workflow ?? '') + ' · ' + short(record.capture?.sha256), record));
    }
    const metrics = statisticsModel.statistics ?? [];
    if (!metrics.length) { statisticsContent.append(el('p', 'This edition and its inventory dependency contain no retained state-transition statistics.')); return; }
    const sourceSelect = el('select'), seriesSelect = el('select'), periodSelect = el('select');
    const metricCaption = el('p', '', { class: 'muted' }), periodCaption = el('p', '', { class: 'muted' }), metricView = el('div');
    const rawMetricView = el('div');
    statisticsContent.append(el('h3', 'Native state transitions'),
      el('p', 'count is the provider’s transition count. unique_count is its unique count for the displayed state and period. Each native period remains separate.', { class: 'muted' }),
      field('Retained statistics response', sourceSelect), metricCaption,
      field('Native interval series', seriesSelect), field('Native period', periodSelect), periodCaption, metricView, rawMetricView);
    optionList(sourceSelect, metrics.map((record, index) => ({ id: String(index), record })),
      entry => (entry.record.capture?.capturedAt ?? 'Time unavailable') + ' · HTTP ' +
        String(entry.record.capture?.status ?? 'unknown') + ' · ' + short(entry.record.capture?.sha256), 'Choose a retained response');
    sourceSelect.value = String(metrics.length - 1);
    const selectedMetric = () => sourceSelect.value === '' ? null : metrics[Number(sourceSelect.value)];
    function renderPeriod() {
      const record = selectedMetric(), periods = record?.document?.state_transitions?.[seriesSelect.value];
      const period = Array.isArray(periods) && periodSelect.value !== '' ? periods[Number(periodSelect.value)] : null;
      metricView.replaceChildren(); periodCaption.textContent = '';
      if (!period) return;
      periodCaption.textContent = textValue(period.period) + ' · native interval ' + textValue(period.interval) +
        ' · ' + periods.length + ' retained periods in this series.';
      metricView.append(table(['Native state', 'count', 'unique_count'], (period.states ?? []).map(value => [
        value.state, textValue(value.count), textValue(value.unique_count)
      ])));
    }
    function selectSeries() {
      const record = selectedMetric(), values = record?.document?.state_transitions?.[seriesSelect.value];
      const periods = Array.isArray(values) ? values : [];
      optionList(periodSelect, periods.map((period, index) => ({ id: String(index), period })), value =>
        textValue(value.period.period) + ' · ' + textValue(value.period.interval), 'Choose a native period');
      if (periods.length) {
        let latest = 0;
        for (let i = 1; i < periods.length; i++) if (String(periods[i].period) > String(periods[latest].period)) latest = i;
        periodSelect.value = String(latest);
      }
      renderPeriod();
    }
    function selectMetric() {
      const record = selectedMetric(); metricCaption.textContent = sourceCaption(record?.capture);
      rawMetricView.replaceChildren();
      const series = Object.entries(record?.document?.state_transitions ?? {}).filter(([, values]) => Array.isArray(values));
      optionList(seriesSelect, series.map(([name, values]) => ({ id: name, count: values.length })), value =>
        value.id + ' · ' + value.count + ' native periods', 'Choose a native series');
      if (series.length) seriesSelect.value = series.some(([name]) => name === 'hourly') ? 'hourly' : series[0][0];
      if (record) rawMetricView.append(rawDetails('Original state-transition response and capture metadata', record));
      selectSeries();
    }
    on(sourceSelect, 'change', selectMetric); on(seriesSelect, 'change', selectSeries); on(periodSelect, 'change', renderPeriod);
    selectMetric();
  });

  const associationBox = group('4. Review scene and asset associations');
  const loadAssociations = button('Compare native payloads with the bound scene edition'), associationSummary = el('div');
  const associatedRun = el('select'), associatedItem = el('select'), associatedAsset = el('select'), associationNote = el('textarea', '', { rows: 3 });
  const saveAssociation = button('Save reviewed association');
  associationBox.append(loadAssociations, associationSummary, field('Processing run', associatedRun), field('Original STAC item', associatedItem),
    field('Original asset (optional)', associatedAsset), field('Association reason / note', associationNote),
    el('p', 'Use the Reviewer field above. An association outside exact native payload matches requires a reason. Earlier decisions remain in history.', { class: 'muted' }), saveAssociation);
  on(associatedItem, 'change', () => {
    const item = associationModel?.proposals.items.find(v => v.itemId === associatedItem.value);
    optionList(associatedAsset, (item?.assets ?? []).map(v => ({ ...v, id: v.key })), v => v.key, 'Item only');
  });
  click(loadAssociations, async () => {
    associationModel = await api.read('associations', { editionId: editions.value });
    associationSummary.replaceChildren(table(['Run / payload', 'Match state', 'Native candidates', 'Earlier decisions'],
      associationModel.proposals.runs.map(v => [nativeIdentity(v), v.status,
        [...new Set(v.candidates.map(c => c.itemId))].join(', '), associationModel.accepted.filter(a => a.runKey === v.runKey).length])));
    optionList(associatedRun, associationModel.proposals.runs.map(v => ({ ...v, id: v.runKey })), v => nativeIdentity(v));
    optionList(associatedItem, associationModel.proposals.items.map(v => ({ ...v, id: v.itemId })), v => v.collection + ' / ' + v.nativeItemId);
  });
  click(saveAssociation, () => action('associate', { editionId: editions.value, runKey: associatedRun.value,
    itemId: associatedItem.value, assetKey: associatedAsset.value || null, actor: actor.value.trim(), note: associationNote.value }));

  const importedPage = el('details'); importedPage.append(el('summary', 'Import an actual externally captured page'));
  const pageTask = el('select'), pageFile = input('file'), pageStatus = input('number', '', { min: 100, max: 599 });
  const pageTime = input('text'), pageUrl = input('url'), pageHeaders = el('textarea', '{}', { rows: 3 });
  const importPage = button('Retain this exact page and advance its original chain');
  importedPage.append(field('Pending task from the selected processing edition', pageTask), field('Original response body', pageFile),
    field('Actual HTTP status (blank means unknown)', pageStatus), field('Actual capture timestamp', pageTime), field('Actual request URL', pageUrl),
    field('Original response headers JSON', pageHeaders), importPage); section.append(importedPage);
  function refreshImportTasks() {
    const e = state?.editions.find(v => v.id === editions.value);
    optionList(pageTask, (e?.tasks ?? []).filter(v => !['COMPLETE', 'FAILED'].includes(v.state)), v => v.kind + ' / ' + v.id);
  }
  on(pageTask, 'change', () => {
    const task = state?.editions.find(v => v.id === editions.value)?.tasks.find(v => v.id === pageTask.value);
    pageUrl.value = task?.next?.url ?? '';
  });
  click(importPage, async () => action('import-page', { editionId: editions.value, taskId: pageTask.value,
    bodyBase64: bytesBase64(await fileBytes(pageFile)), metadata: { method: 'GET',
      ...(pageUrl.value.trim() ? { url: pageUrl.value.trim() } : {}),
      status: pageStatus.value === '' ? null : Number(pageStatus.value),
      capturedAt: pageTime.value.trim() || null, headers: JSON.parse(pageHeaders.value || '{}') } }));

  const portable = group('5. Export, receive and reopen');
  const includeAssets = input('checkbox'), exportButton = button('Export the selected processing edition');
  const exports = el('select'), downloadExport = button('Download complete portable handover');
  const handoverFile = input('file', '', { accept: '.gz,application/gzip' }), importHandover = button('Receive this handover into the current workspaces');
  const receipts = el('div');
  portable.append(field('Include already captured original STAC asset bytes', includeAssets), exportButton,
    field('Completed local handover', exports), downloadExport, el('p', 'The complete export directory is retained locally. Larger transfers can use that directory without omitting members.', { class: 'muted' }),
    field('Original processing handover file', handoverFile), importHandover, receipts);
  click(exportButton, () => action('export-handover', { editionIds: [editions.value], includeStacAssets: includeAssets.checked }));
  click(downloadExport, async () => {
    const value = await api.read('handover', { exportId: exports.value });
    const raw = atob(value.contentBase64), bytes = Uint8Array.from(raw, v => v.charCodeAt(0));
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
    if (bytes.length !== value.bytes || hash !== value.sha256) throw new Error('The downloaded handover bytes do not match the retained export.');
    download(new Blob([bytes], { type: value.mime }), value.filename);
    status.textContent = 'Downloaded the exact retained handover: ' + value.bytes + ' bytes, SHA-256 ' + hash + '.';
  });
  click(importHandover, async () => action('import-handover', { bodyBase64: bytesBase64(await fileBytes(handoverFile)) }));

  async function refresh() {
    if (disposed) return;
    if (refreshing) { again = true; return refreshing; }
    refreshing = (async () => {
      do {
        again = false; const result = await api.getState(); if (disposed) return;
        state = result.processing ?? result;
        saved.textContent = 'Saved revision ' + state.revision + ' · ' + state.deployments.length + ' source editions · ' + state.editions.length + ' processing captures.';
        selectedContext.textContent = context.editionId ? 'Current scene edition: ' + context.editionId : 'Select an original STAC scene edition to associate its items with processing history.';
        optionList(deployments, state.deployments, v => v.deployment.title + ' · ' + short(v.source.sha256));
        optionList(inventories, state.editions.filter(v => v.selection.kind === 'INVENTORY'), v => v.id + ' · ' + v.state);
        optionList(reviews, state.reviews, v => v.id + ' · ' + v.selection.workflowIds.length + ' workflows · ' + v.reviewedAt);
        optionList(editions, state.editions, v => v.id + ' · ' + v.selection.kind + ' · ' + v.state);
        optionList(exports, state.exports ?? [], v => v.id + ' · ' + v.bytes + ' bytes');
        describeDeployment(); syncReviewDialect(); renderTasks(); refreshImportTasks();
        receipts.replaceChildren(table(['Received handover', 'Source workspace', 'Editions', 'Completed'],
          state.imports.map(v => [short(v.digest), v.sourceWorkspaceId, v.editionIds.length, v.completedAt])));
        const currentJobs = context.processingJobs ?? context.jobs ?? [];
        for (const job of currentJobs) if (jobs.has(job.id)) {
          jobs.set(job.id, job);
          if (job.status === 'FAILED') report(job.error ?? new Error('The processing action failed; open its saved history.'));
          if (job.status === 'COMPLETE' && job.result?.id && job.kind?.includes('review')) reviews.value = job.result.id;
        }
        if (![...jobs.values()].some(v => v.status === 'RUNNING')) status.textContent = 'Saved processing state is ready.';
      } while (again && !disposed);
    })().catch(report).finally(() => { refreshing = null; });
    return refreshing;
  }
  await refresh();
  return {
    update: async next => { context = next ?? {}; await refresh(); },
    dispose: () => { disposed = true; events.abort(); section.remove(); }
  };
}
