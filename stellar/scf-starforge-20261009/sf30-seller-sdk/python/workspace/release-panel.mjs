// MIT. Operator controls over the original merchant release and customer client APIs.
export function createReleasePanel(ctx) {
  const {
    getState, el, text, row, card, empty, badge, small, mono, fmt, short, when,
    bytes, json, field, input, select, action, button, section, table,
    details, definitions, api, mutate, download, showNotice, refreshState, renderCurrent,
  } = ctx;
  let workspaceId = null;
  let selected = '', inspected = null, inspectionAt = null, inspectionError = '';
  let from = '', to = '', comparison = null, comparisonAt = null, comparePage = 0;
  let selectedExport = '', customerResult = null, releasePage = 0, stagePage = 0, historyPage = 0, customerPage = 0;
  let stage = null, selectionReason = '', rollbackTo = '', customerId = '';
  let reading = false;
  const pageSize = 12;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const printable = value => value === undefined ? 'Not supplied' : typeof value === 'string' ? value : json(value);
  const message = error => typeof error === 'string' ? error : error?.message || error?.code || json(error);
  const query = values => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== null && value !== undefined && value !== '')).toString();

  function initialize(state) {
    if (workspaceId === state.workspace.id) return;
    workspaceId = state.workspace.id;
    selected = state.release?.state?.active || state.release?.releases?.[0]?.id || '';
    inspected = null; inspectionAt = null; inspectionError = '';
    from = state.release?.state?.active || ''; to = selected; comparison = null; comparisonAt = null; comparePage = 0;
    selectedExport = state.customerExports?.[0]?.id || ''; customerResult = null;
    releasePage = 0; stagePage = 0; historyPage = 0; customerPage = 0;
    stage = { revisionId: state.workspace.head, id: '', label: state.workspace.label || '', port: '8423', facilitator: '', allowLocalFacilitator: false };
    selectionReason = ''; rollbackTo = ''; customerId = ''; reading = false;
  }
  function control(name, value, update, attrs = {}) {
    return input(value, { id: 'release-' + name, 'data-release-field': name, 'data-editor': 'true',
      oninput: event => update(event.target.value), ...attrs });
  }
  function choice(name, options, value, update, attrs = {}) {
    return select(options, value, { id: 'release-' + name, 'data-release-field': name, 'data-editor': 'true',
      onchange: event => update(event.target.value), ...attrs });
  }
  function act(name, label, fn, options = {}) {
    const node = action(label, fn, options); node.dataset.releaseAction = name; return node;
  }
  function readButton(name, label, fn, attrs = {}) {
    return button(label, fn, { 'data-release-action': name, disabled: reading, ...attrs });
  }
  function pageControls(total, page, update) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const current = Math.max(0, Math.min(page, pages - 1));
    return el('div', { class: 'pagination' },
      small(total ? `${current * pageSize + 1}–${Math.min((current + 1) * pageSize, total)} of ${total}` : '0 items'),
      row(button('Previous', () => { update(Math.max(0, current - 1)); renderCurrent(); }, { disabled: current === 0 }),
        button('Next', () => { update(Math.min(pages - 1, current + 1)); renderCurrent(); }, { disabled: current + 1 >= pages })));
  }
  function pageRows(items, page) {
    const current = Math.max(0, Math.min(page, Math.ceil(items.length / pageSize) - 1));
    return items.slice(current * pageSize, (current + 1) * pageSize);
  }
  function metric(label, value, description) {
    return el('div', { class: 'metric' }, text('span', label, { class: 'label' }),
      text('span', value, { class: 'value' }), text('span', description, { class: 'detail' }));
  }
  function info(label, value) { return el('div', { class: 'stack tight' }, small(label), mono(value)); }
  function unavailable(label, error) {
    return el('div', { class: 'inline-note' }, text('strong', label), text('p', message(error)));
  }
  function releaseOptions(releases, blank = 'Choose a release') {
    return [['', blank], ...releases.map(record => [record.id, `${record.id}${record.label ? ' · ' + record.label : ''}`])];
  }
  function downloadJSON(value, filename) {
    const blob = new Blob([json(value) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = el('a', { href: url, download: filename, hidden: true });
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function inspect(id) {
    if (!id || reading) return;
    const requestedWorkspace = workspaceId;
    selected = id; inspected = null; inspectionAt = null; inspectionError = ''; reading = true; renderCurrent();
    try {
      const record = await api('/api/release?' + query({ id }));
      if (workspaceId !== requestedWorkspace) return;
      if (record.id !== id) throw new Error('The original release response has a different release ID. Refresh the catalog.');
      inspected = record; inspectionAt = new Date().toISOString();
    } catch (error) {
      if (workspaceId === requestedWorkspace) inspectionError = message(error);
      throw error;
    } finally { reading = false; renderCurrent(); }
  }
  function loadStage(record) {
    stage = { revisionId: record.revisionId, id: record.releaseId, label: record.label || '',
      port: String(record.runtime?.port ?? 8423), facilitator: record.runtime?.facilitator || '',
      allowLocalFacilitator: record.runtime?.allowLocalFacilitator === true };
    showNotice('The exact retained stage request is loaded. Its saved application revision and runtime values remain selected.');
    renderCurrent();
  }
  async function stageSaved() {
    const state = getState();
    if (!state.revisions.some(revision => revision.id === stage.revisionId)) throw new Error('Choose an existing saved application revision.');
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(stage.id)) throw new Error('Use a release ID of 1–64 lowercase letters, numbers, underscores or hyphens.');
    if (!/^\d+$/.test(stage.port) || !Number.isInteger(Number(stage.port)) || Number(stage.port) > 65535)
      throw new Error('Runtime port must be an integer from 0 to 65535.');
    const runtime = { port: Number(stage.port) };
    if (stage.facilitator.trim()) runtime.facilitator = stage.facilitator.trim();
    if (stage.allowLocalFacilitator) runtime.allowLocalFacilitator = true;
    const submitted = { revisionId: stage.revisionId, id: stage.id, label: stage.label, runtime };
    const result = await mutate('/api/stage', submitted);
    if (!result) return;
    selected = result.releaseId; to = result.releaseId;
    inspected = result.release || null; inspectionAt = inspected ? new Date().toISOString() : null; inspectionError = '';
    showNotice(result.status === 'STAGED' ? 'Original release ' + result.releaseId + ' staged from saved revision ' + short(result.revisionId) + '.' : 'Stage returned ' + result.status + '. Its retained outcome is shown below.');
    renderCurrent();
  }
  async function compare() {
    if (!to) throw new Error('Choose the destination release to compare.');
    if (reading) return;
    const request = { from: from || null, to }, requestedWorkspace = workspaceId;
    reading = true; renderCurrent();
    try {
      const result = await api('/api/diff?' + query(request));
      if (workspaceId !== requestedWorkspace) return;
      if (result.after?.id !== request.to || (result.before?.id ?? null) !== request.from)
        throw new Error('The original comparison returned different release identities.');
      comparison = result; comparisonAt = new Date().toISOString(); comparePage = 0;
      showNotice('Original comparison loaded for ' + (result.before?.id || 'no previous release') + ' → ' + result.after.id + '.');
    } finally { reading = false; renderCurrent(); }
  }
  async function changeSelection(operation, id, generation, reason) {
    if (!Number.isSafeInteger(generation)) throw new Error('Refresh the native release selection generation.');
    if (operation === 'activate' && !id) throw new Error('Choose the original release to activate.');
    const payload = { expectedGeneration: generation };
    if (reason.trim()) payload.reason = reason.trim();
    if (operation === 'activate') payload.id = id; else if (id) payload.to = id;
    const result = await mutate('/api/' + operation, payload);
    if (!result) return;
    const saved = getState().release.state;
    showNotice('Selected release ' + (saved.active || 'none') + ' at generation ' + saved.generation + '. The running instance is shown separately.');
    renderCurrent();
  }
  async function operateRuntime(path, body) {
    const result = await mutate(path, body);
    if (!result) return;
    const live = getState().release;
    showNotice('Original runtime reports ' + live.runtime.state + (live.runtime.observed?.releaseId ? ' for ' + live.runtime.observed.releaseId : '') + '.');
    renderCurrent();
  }
  async function exportCustomer(instanceId) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(customerId)) throw new Error('Use an export ID of 1–64 lowercase letters, numbers, underscores or hyphens.');
    const result = await mutate('/api/customer-export', { id: customerId, instanceId });
    if (!result) return;
    customerResult = result; selectedExport = result.id;
    showNotice(result.status === 'COMPLETED' ? 'Customer client ' + result.id + ' retained from the original running seller OpenAPI.' : 'Customer export returned ' + result.status + '. Inspect the retained result below.');
    renderCurrent();
  }

  function runtimePanel(state) {
    const native = state.release, selection = native.state, runtime = native.runtime, observed = runtime.observed;
    const managedId = native.managed?.instanceId;
    const generationKnown = Number.isSafeInteger(selection.generation);
    return card(
      el('div', { class: 'card-head' }, text('h3', 'Selected release and actual runtime'),
        row(badge(runtime.state, runtime.state === 'RUNNING'), badge('Generation ' + fmt(selection.generation)))),
      el('div', { class: 'grid two' },
        definitions([['Selected release', mono(selection.active)], ['Previous selection', mono(selection.previous)],
          ['Recorded instance', mono(observed?.instanceId)], ['Instance release', mono(observed?.releaseId)],
          ['Listener', mono(observed?.listener)], ['Recorded mode', badge(observed?.mode || 'Not running')]]),
        el('div', { class: 'stack tight' },
          definitions([['Started', when(observed?.startedAt)], ['Ready', when(observed?.readyAt)], ['Ended', when(observed?.endedAt)],
            ['Instance selection generation', fmt(observed?.selectionGeneration)], ['Console-managed instance', mono(managedId)]]),
          runtime.message ? text('p', runtime.message, { class: 'inline-note' }) : null)),
      runtime.state === 'RESTART_REQUIRED' ? text('p', 'The selected release differs from the running instance. Restart the managed instance when ready to run the selection.', { class: 'inline-note' }) : null,
      native.lastError ? unavailable('Last runtime outcome', native.lastError) : null,
      el('hr', { class: 'rule' }),
      row(act('run', 'Run selected release', () => operateRuntime('/api/run', { expectedGeneration: selection.generation }),
        { primary: true, disabled: !selection.active || !!managedId || !generationKnown }),
      act('stop', 'Stop managed instance', () => operateRuntime('/api/stop', { instanceId: managedId }), { disabled: !managedId }),
      act('restart', 'Restart with selected release', () => operateRuntime('/api/restart', { instanceId: managedId, expectedGeneration: selection.generation }),
        { disabled: !managedId || !selection.active || !generationKnown })),
      small('Runtime controls use the recorded native instance and selection generation. Customer requests use that running release’s original payment mode.'));
  }
  function stagingPanel(state) {
    const revisions = state.revisions.map(revision => [revision.id, short(revision.id) + ' · ' + when(revision.createdAt) + (revision.note ? ' · ' + revision.note : '')]);
    const selectedRevision = state.revisions.find(revision => revision.id === stage.revisionId);
    return card(text('h3', 'Stage a saved application'),
      text('p', 'Choose the exact saved source revision and explicit runtime settings. Each release ID retains one immutable application.'),
      el('div', { class: 'form-grid' },
        field('Saved application revision', choice('stage-revision', revisions, stage.revisionId, value => { stage.revisionId = value; renderCurrent(); }),
          'Unsaved application edits remain in the authoring draft.', true),
        field('Release ID', control('stage-id', stage.id, value => { stage.id = value; }, { maxLength: 64, placeholder: 'pricing-service-v1', autocomplete: 'off' }),
          'Lowercase letters, numbers, underscores or hyphens; choose a new ID for another version.'),
        field('Release label', control('stage-label', stage.label, value => { stage.label = value; }, { maxLength: 240 })),
        field('Runtime port', control('stage-port', stage.port, value => { stage.port = value; }, { type: 'number', min: 0, max: 65535, step: 1 }),
          '0 selects an available port when the seller starts.'),
        field('Facilitator URL', control('stage-facilitator', stage.facilitator, value => { stage.facilitator = value; }, { placeholder: 'https://…', autocomplete: 'off' }),
          'Optional. An empty value retains the native CHALLENGE_ONLY mode.'),
        el('label', { class: 'checkbox' }, input('', { type: 'checkbox', checked: stage.allowLocalFacilitator,
          id: 'release-stage-local-facilitator', 'data-release-field': 'stage-local-facilitator', 'data-editor': 'true',
          onchange: event => { stage.allowLocalFacilitator = event.target.checked; } }),
        'Use the explicitly supplied local HTTP facilitator')),
      selectedRevision ? el('p', { class: 'inline-note' }, 'Saved source: ', mono(selectedRevision.id), ' · ', fmt(selectedRevision.files), ' files · ', bytes(selectedRevision.bytes),
        ' · ', mono(selectedRevision.digest)) : empty('Choose a retained application revision.'),
      row(act('stage', 'Stage saved revision', stageSaved, { primary: true, disabled: !selectedRevision })),
      small('The original staging operation supplies the release source, route terms, Python execution settings and digest.'));
  }
  function selectionPanel(state) {
    const native = state.release, selection = native.state;
    const activeRecord = native.releases.find(record => record.id === selection.active);
    const chosen = native.releases.find(record => record.id === selected);
    return card(text('h3', 'Activate or roll back'),
      field('Original release', choice('selected', releaseOptions(native.releases), selected, value => {
        selected = value; inspected = null; inspectionAt = null; inspectionError = ''; renderCurrent();
      })),
      chosen ? definitions([['Release digest', mono(chosen.digest)], ['Mode', badge(chosen.mode)], ['Public origin', mono(chosen.publicOrigin)]]) : empty('Stage a saved revision or choose an existing release.'),
      el('hr', { class: 'rule' }),
      field('Selection change reason', control('reason', selectionReason, value => { selectionReason = value; }, { maxLength: 240 }),
        'Optional. Leave empty to retain the original operation’s default reason.'),
      row(readButton('inspect-selected', 'Inspect original release', () => inspect(selected), { disabled: reading || !chosen }),
        act('activate', 'Activate selected release', () => changeSelection('activate', selected, selection.generation, selectionReason),
          { primary: true, disabled: !chosen || !Number.isSafeInteger(selection.generation) })),
      el('hr', { class: 'rule' }),
      field('Rollback destination', choice('rollback-to', releaseOptions(native.releases,
        selection.previous ? 'Previous selection · ' + selection.previous : 'No previous selection'), rollbackTo, value => { rollbackTo = value; renderCurrent(); }),
        'Leave the previous-selection option selected to use the native previous release.'),
      row(act('rollback', 'Roll back selection', () => changeSelection('rollback', rollbackTo, selection.generation, selectionReason),
        { disabled: !Number.isSafeInteger(selection.generation) || (!rollbackTo && !selection.previous) })),
      small('Current selection: ' + (activeRecord?.id || selection.active || 'none') + '. Activation and rollback select a version; runtime controls operate the recorded instance.'));
  }
  function catalogPanel(state) {
    const native = state.release, releases = native.releases, staged = state.staged;
    return card(text('h3', 'Original release catalog'),
      releases.length ? table(['Release / label', 'Saved application', 'Created / digest', 'Mode / routes', 'Actions'], pageRows(releases, releasePage).map(record => {
        const source = staged.find(item => item.releaseId === record.id && item.status === 'STAGED');
        return [el('div', { class: 'stack tight' }, mono(record.id), text('span', record.label),
          row(record.id === native.state.active ? badge('Selected', true) : null, record.id === native.runtime.observed?.releaseId ? badge('Recorded instance') : null)),
          source ? info('Saved revision', source.revisionId) : small('Original release-store entry'),
          el('div', { class: 'stack tight' }, small(when(record.createdAt)), mono(record.digest)),
          el('div', { class: 'stack tight' }, badge(record.mode), small((record.routes?.length ?? 0) + ' declared routes')),
          row(readButton('inspect-' + record.id, 'Inspect', () => inspect(record.id)),
            button('Use for selection', () => { selected = record.id; renderCurrent(); }, { 'data-release-action': 'select-' + record.id }),
            button('Compare to active', () => { from = native.state.active || ''; to = record.id; comparison = null; comparePage = 0; return compare(); },
              { disabled: reading, 'data-release-action': 'compare-' + record.id }))];
      })) : empty('No immutable merchant release has been staged yet.'),
      pageControls(releases.length, releasePage, value => { releasePage = value; }),
      native.errors?.length ? el('div', { class: 'stack' }, ...native.errors.map(error => unavailable('Original release ' + error.id, error))) : null,
      el('hr', { class: 'rule' }), text('h3', 'Retained stage operations'),
      staged.length ? table(['Release / saved revision', 'State', 'Runtime', 'Recorded outcome', 'Action'], pageRows(staged, stagePage).map(record => [
        el('div', { class: 'stack tight' }, mono(record.releaseId), mono(record.revisionId)), badge(record.status, record.status === 'STAGED'),
        el('div', { class: 'stack tight' }, small('Port ' + fmt(record.runtime?.port)), mono(record.runtime?.facilitator || 'No facilitator')),
        el('div', { class: 'stack tight' }, small(when(record.completedAt || record.createdAt)), record.digest ? mono(record.digest) : null,
          record.error ? text('span', message(record.error)) : null),
        button('Load exact request', () => loadStage(record), { 'data-release-action': 'load-stage-' + record.id }),
      ])) : small('Stage operations appear here when an original saved revision is prepared.'),
      pageControls(staged.length, stagePage, value => { stagePage = value; }));
  }
  function inspectPanel(state) {
    if (!selected) return null;
    if (inspectionError) return card(text('h3', 'Original release inspection'), unavailable(selected, inspectionError),
      row(readButton('retry-inspect', 'Read original release again', () => inspect(selected))));
    if (!inspected || inspected.id !== selected) return card(text('h3', 'Inspect ' + selected),
      text('p', 'Open the original release to read its retained route terms, source digests and runtime configuration.'),
      row(readButton('open-inspector', reading ? 'Reading original release…' : 'Inspect original release', () => inspect(selected))));
    const record = inspected, matching = state.release.releases.find(item => item.id === record.id);
    return card(el('div', { class: 'card-head' }, text('h3', record.id + ' · original release'),
      row(readButton('refresh-inspect', 'Read original again', () => inspect(record.id)),
        button('Download inspected release', () => downloadJSON(record, 'release-' + record.id + '.json'), { 'data-release-action': 'download-inspected' }))),
      matching && matching.digest !== record.digest ? text('p', 'The latest catalog digest differs from this retained inspection. Read the original again before comparing its contents.', { class: 'inline-note' }) : null,
      definitions([['Label', record.label], ['Original digest', mono(record.digest)], ['Created', when(record.createdAt)],
        ['Inspected', when(inspectionAt)], ['Public origin', mono(record.publicOrigin)], ['Payment mode', badge(record.mode)],
        ['Runtime port', fmt(record.runtime.port)], ['Facilitator', mono(record.runtime.facilitator)],
        ['Local facilitator option', record.runtime.allowLocalFacilitator === true ? 'Enabled in original release' : 'Not enabled']]),
      el('hr', { class: 'rule' }),
      record.routes.length ? table(['Function / route', 'Original payment terms', 'Request / execution'], record.routes.map(route => [
        el('div', { class: 'stack tight' }, mono(route.id), text('span', route.method + ' ' + route.path), mono(route.url)),
        el('div', { class: 'stack tight' }, ...(route.payment || []).map(term => el('div', { class: 'stack tight' },
          mono((own(term, 'amount') ? term.amount : term.maxAmountRequired) ?? 'Amount not supplied'),
          small([term.scheme, term.network].filter(Boolean).join(' · ')), mono(term.asset),
          details('Complete original payment option', term)))),
        el('div', { class: 'stack tight' }, info('Request contract', route.requestContractSha256),
          details('Original route execution', route.application || {})),
      ])) : empty('This original release contains no public routes.'),
      text('p', 'Payment amounts above are the original atomic strings; no currency conversion or rounding is applied.', { class: 'inline-note' }),
      el('div', { class: 'stack' }, details('Original source snapshot', record.source),
        record.python ? details('Original Python execution and source', record.python) : null,
        details('Complete inspected public release', record)));
  }
  function comparisonPanel(state) {
    const options = releaseOptions(state.release.releases);
    const result = comparison;
    const requestChanged = result && ((result.before?.id || '') !== from || result.after.id !== to);
    return card(text('h3', 'Compare original releases'),
      el('div', { class: 'form-grid' },
        field('Before release', choice('compare-from', releaseOptions(state.release.releases, 'No previous release'), from,
          value => { from = value; renderCurrent(); }), 'An empty baseline shows the first release’s additions.'),
        field('After release', choice('compare-to', options, to, value => { to = value; renderCurrent(); }))),
      row(readButton('compare', reading ? 'Reading originals…' : 'Compare original releases', compare, { disabled: reading || !to })),
      result ? el('div', {}, el('hr', { class: 'rule' }),
        text('p', (result.before?.id || 'No previous release') + ' → ' + result.after.id + ' · read ' + when(comparisonAt)),
        requestChanged ? text('p', 'The selectors changed. The retained comparison below still belongs to the release IDs shown above.', { class: 'inline-note' }) : null,
        el('div', { class: 'metrics' }, metric('Added routes', fmt(result.summary.added), 'Original comparison'),
          metric('Changed routes', fmt(result.summary.changed), 'Original comparison'),
          metric('Removed routes', fmt(result.summary.removed), 'Original comparison'),
          metric('Payment changes', fmt(result.summary.paymentChanged), 'Original atomic terms')),
        small(fmt(result.summary.unchanged) + ' routes unchanged.'),
        result.changes.length ? table(['Route / change', 'Changed original fields', 'Before / after'], pageRows(result.changes, comparePage).map(change => [
          el('div', { class: 'stack tight' }, mono(change.route), badge(change.state)),
          change.fields.length ? text('span', change.fields.map(field => field.field).join(', ')) : text('span', change.state === 'ADDED' ? 'Whole route added' : 'Whole route removed'),
          el('div', { class: 'stack tight' }, ...change.fields.map(field => details(field.field, { before: field.before, after: field.after })),
            !change.fields.length ? details('Complete original route change', { before: change.before, after: change.after }) : null),
        ])) : empty('The original comparator reports no route change.'),
        pageControls(result.changes.length, comparePage, value => { comparePage = value; }),
        text('h3', 'Runtime and Python source changes'),
        result.runtimeChanges.length ? table(['Field', 'Before', 'After'], result.runtimeChanges.map(change => [
          mono(change.field), text('pre', printable(change.before)), text('pre', printable(change.after)),
        ])) : small('No original runtime or Python source change was reported.'),
        el('hr', { class: 'rule' }), row(button('Download original comparison', () => downloadJSON(result, 'release-comparison-' + (result.before?.id || 'empty') + '-to-' + result.after.id + '.json'),
          { 'data-release-action': 'download-comparison' }))) : small('Choose saved releases to inspect added, removed or changed routes, payment terms and execution settings.'));
  }
  function customerPanel(state) {
    const native = state.release, observed = native.runtime.observed, managedId = native.managed?.instanceId;
    const canExport = !!managedId && observed?.instanceId === managedId && ['RUNNING', 'RESTART_REQUIRED'].includes(native.runtime.state);
    const exports = state.customerExports || [];
    const saved = exports.find(record => record.id === selectedExport) || (customerResult?.id === selectedExport ? customerResult : null);
    return card(text('h3', 'Customer SDK handoff'),
      text('p', 'Generate the existing customer client from the actual managed seller’s OpenAPI, then download its retained original files.'),
      definitions([['Running instance', mono(managedId)], ['Running release', mono(observed?.releaseId)],
        ['Running payment mode', badge(observed?.mode || 'Not running')]]),
      native.runtime.state === 'RESTART_REQUIRED' ? text('p', 'This export will describe the currently running release ' + observed.releaseId + '. Restart first if the customer should receive the newly selected release.', { class: 'inline-note' }) : null,
      el('hr', { class: 'rule' }),
      field('Customer export ID', control('customer-id', customerId, value => { customerId = value; }, { maxLength: 64, placeholder: 'customer-sdk-v1', autocomplete: 'off' }),
        'Use an explicit name for this create-only client delivery.'),
      row(act('customer-export', 'Prepare customer SDK', () => exportCustomer(managedId), { primary: true, disabled: !canExport })),
      !canExport ? small('Run a selected release in this console to prepare a client from that seller’s original OpenAPI. Retained handoffs below remain downloadable.') : null,
      el('hr', { class: 'rule' }),
      exports.length ? table(['Customer export', 'Original release / instance', 'State / created', 'Files', 'Action'], pageRows(exports, customerPage).map(record => [
        mono(record.id), el('div', { class: 'stack tight' }, mono(record.releaseId), mono(record.instanceId)),
        el('div', { class: 'stack tight' }, badge(record.status, record.status === 'COMPLETED'), small(when(record.completedAt || record.createdAt))),
        text('span', fmt(record.fileRecords?.length ?? record.files?.length ?? 0)),
        button('Open handoff', () => { selectedExport = record.id; customerResult = record; renderCurrent(); }, { 'data-release-action': 'open-customer-' + record.id }),
      ])) : empty('No customer client has been generated from this workspace yet.'),
      pageControls(exports.length, customerPage, value => { customerPage = value; }),
      saved ? el('div', {}, el('hr', { class: 'rule' }), text('h3', saved.id + ' · retained customer client'),
        definitions([['Recorded outcome', badge(saved.status, saved.status === 'COMPLETED')], ['Original release', mono(saved.releaseId)],
          ['Release digest', mono(saved.releaseDigest)], ['Source instance', mono(saved.instanceId)], ['Public origin', mono(saved.origin)],
          ['Original payment mode', badge(saved.mode || 'Not completed')], ['OpenAPI source digest', mono(saved.sourceSha256)],
          ['Completed', when(saved.completedAt)]]),
        saved.error ? unavailable('Original export outcome', saved.error) : null,
        saved.fileRecords?.length ? table(['Original file', 'Size / digest', 'Download'], saved.fileRecords.map(file => [
          mono(file.path), el('div', { class: 'stack tight' }, small(bytes(file.bytes)), mono(file.sha256)),
          button('Download ' + file.path, () => download('/api/customer-file?' + query({ id: saved.id, file: file.path }), file.path),
            { 'data-release-action': 'download-customer-file', 'data-export-id': saved.id, 'data-file': file.path }),
        ])) : small('This retained export has no completed original files.'),
        saved.operations?.length ? el('div', {}, text('h3', 'Exported public operations'), table(['Operation', 'Method', 'Path'],
          saved.operations.map(operation => [mono(operation.id), text('span', operation.method), mono(operation.path)]))) : null,
        details('Original customer export record', saved)) : null);
  }
  function historyPanel(state) {
    const events = [...(state.release.state.history || [])].reverse();
    return card(text('h3', 'Original selection history'),
      events.length ? table(['Generation / operation', 'Previous → selected', 'Recorded', 'Reason'], pageRows(events, historyPage).map(event => [
        el('div', { class: 'stack tight' }, badge('Generation ' + event.generation), text('span', event.operation)),
        el('div', { class: 'stack tight' }, mono(event.from), mono(event.to)), small(when(event.at)), text('span', event.reason),
      ])) : empty('No activation or rollback has been recorded in the original release store.'),
      pageControls(events.length, historyPage, value => { historyPage = value; }));
  }
  function render() {
    const state = getState();
    if (!state?.workspace || !state?.release) return empty('Opening the original release workspace…');
    initialize(state);
    if (!selectedExport && state.customerExports?.length) selectedExport = state.customerExports[0].id;
    return el('div', { 'data-component': 'python-release-panel' },
      section('Releases and customer handoff', 'Stage saved applications and operate their original merchant lifecycle. Keep the selected version, running instance and customer export visible together.',
        readButton('refresh', 'Refresh original state', () => refreshState())),
      runtimePanel(state),
      el('div', { class: 'grid two' }, stagingPanel(state), selectionPanel(state)),
      catalogPanel(state), inspectPanel(state), comparisonPanel(state), customerPanel(state), historyPanel(state));
  }
  return { render };
}
