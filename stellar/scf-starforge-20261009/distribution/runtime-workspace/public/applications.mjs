// MIT. Applications presentation over the original runtime and managed-command APIs.
import { renderOpenApiApplicationReview } from './openapi-application.mjs';
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const button = (text, action) => {
  const node = element('button', text); node.type = 'button';
  node.addEventListener('click', action); return node;
};
const query = (path, value) => path + '?' + new URLSearchParams(value);
const readable = text => String(text ?? '').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
function facts(rows) {
  const node = element('dl', undefined, 'paths');
  for (const [label, value] of rows) {
    const row = element('div'); row.append(element('dt', label), element('dd', value ?? '—')); node.append(row);
  }
  return node;
}
function mppReviewRows(command) {
  const workspace = command?.mppBinding;
  if (!workspace) return [];
  const roles = Object.entries(workspace.profiles).filter(([, profile]) => profile).map(([role]) => role);
  return [
    ['MPP workspace', workspace.workspace],
    ['Workspace created', workspace.createdAt],
    ['Saved profile revision', workspace.revision],
    ['Configured roles', roles.join(', ') || 'Ready for merchant or customer configuration'],
  ];
}
async function textHash(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function createApplicationsWorkspaceView({ root, api, getState, refreshWorkspace, switchView, message, error }) {
  let data = null, selectedId = null, selectedRun = null, editingId = null, configurationReview = null, startReview = null;
  let loading = false, sending = false, scope = 0, settingsScope = 0, initial = true;
  const key = name => 'starforge-applications-' + getState()?.workspaceId + '-' + name;
  const readSaved = name => { try { return JSON.parse(sessionStorage.getItem(key(name)) ?? 'null'); } catch { return null; } };
  const saveSaved = (name, value) => { try { if (value === null) sessionStorage.removeItem(key(name)); else sessionStorage.setItem(key(name), JSON.stringify(value)); } catch {} };
  const selected = () => data?.applications.find(item => item.id === selectedId) ?? null;
  const currentType = () => data?.catalog.find(item => item.id === kind.value);
  const header = element('div', undefined, 'section-title');
  header.append(element('h2', 'Applications'), button('New application', () => edit(null)));
  const intro = element('p', 'Open the original merchant and buyer tools using an installed runtime. Application data, private URLs and process history stay with this workspace.', 'note');
  const list = element('div', undefined, 'runtime-list');
  const empty = element('p', 'No applications have been saved. Select a ready runtime and review an application below.', 'empty');
  const configuration = element('details'); configuration.open = true;
  configuration.append(element('summary', 'Configure application'));
  const form = element('form'), grid = element('div', undefined, 'columns');
  const field = (labelText, node) => { const label = element('label', labelText); label.append(node); return label; };
  const label = element('input'); label.required = true; label.maxLength = 120; label.id = 'application-label';
  const runtime = element('select'); runtime.required = true; runtime.id = 'application-runtime';
  const kind = element('select'); kind.required = true; kind.id = 'application-kind';
  grid.append(field('Display name', label), field('Ready runtime', runtime));
  const description = element('p', '', 'note'), settings = element('div', undefined, 'columns');
  const reviewButton = element('button', 'Review application'); reviewButton.type = 'submit';
  const reviewResult = element('div', undefined, 'result'); reviewResult.hidden = true;
  form.append(grid, field('Original application', kind), description, settings, reviewButton, reviewResult);
  configuration.append(form);
  const selectedPanel = element('section', undefined, 'panel'); selectedPanel.hidden = true;
  const selectedTitle = element('div', undefined, 'section-title'), title = element('h3'), phase = element('span', '', 'status');
  selectedTitle.append(title, phase);
  const details = element('div'), actions = element('div', undefined, 'actions'), operationReview = element('div', undefined, 'result');
  operationReview.hidden = true;
  const open = element('a', 'Open application'); open.target = '_blank'; open.rel = 'noopener noreferrer'; open.referrerPolicy = 'no-referrer'; open.hidden = true;
  const urlNote = element('p', '', 'note');
  const relatedApplications = element('div', undefined, 'actions');
  relatedApplications.hidden = true;
  const reviewStart = button('Review start', () => act(async () => {
    const app = selected(); if (!app) return;
    startReview = await api('/api/applications/start-review', { applicationId: app.id });
    renderStartReview();
  }));
  const stop = button('Stop application', () => act(async () => {
    const app = selected(); if (!app?.current) return;
    await api('/api/applications/stop', { applicationId: app.id, operationId: app.current.id });
    startReview = null; await refresh(); await refreshWorkspace();
    message('Stop requested for the original application. Its own shutdown retains accepted work and closes its resources.');
  }));
  const reconnect = button('Continue runtime connection', () => act(async () => {
    const app = selected(); await api('/api/applications/connect', { applicationId: app.id }); await refresh(); await refreshWorkspace();
  }));
  const continueRun = button('Continue original start', () => act(async () => {
    const app = selected();
    await api('/api/applications/recover', { applicationId: app.id, operationId: app.current.id });
    await refresh(); await refreshWorkspace();
  }));
  const editButton = button('Edit settings', () => edit(selected()));
  actions.append(open, reviewStart, stop, reconnect, continueRun, editButton);
  selectedPanel.append(selectedTitle, details, actions, relatedApplications, urlNote, operationReview);
  const history = element('section', undefined, 'panel'); history.hidden = true;
  history.append(element('h3', 'Original operations'));
  const historyRows = element('div'); history.append(historyRows);
  const outputPanel = element('section', undefined, 'panel'); outputPanel.hidden = true;
  outputPanel.append(element('h3', 'Application output'));
  const outputDescription = element('p', '', 'note'), output = element('pre'), inputStatus = element('div');
  output.id = 'application-output'; output.setAttribute('aria-label', 'Original application output');
  const inputForm = element('form'), input = element('input'); input.autocomplete = 'off'; input.spellcheck = false;
  input.id = 'application-terminal-input'; input.maxLength = 4095; input.required = true;
  const send = element('button', 'Send line to original terminal'); send.type = 'submit';
  const terminalActions = element('div', undefined, 'actions');
  const interrupt = button('Send Ctrl-C', () => terminalSend('\u0003').catch(error));
  const eof = button('Send Ctrl-D', () => terminalSend('\u0004').catch(error));
  terminalActions.append(send, interrupt, eof);
  inputForm.append(element('p', 'This is the original application terminal. Review its current prompt, then enter the response yourself. Opening or refreshing this page sends no input.', 'note'),
    field('Terminal response', input), terminalActions, inputStatus);
  outputPanel.append(outputDescription, output, inputForm);
  root.replaceChildren(header, intro, list, empty, configuration, selectedPanel, history, outputPanel);

  async function retainedRequest(route, body) {
    const existing = readSaved('pending');
    const same = existing?.route === route && existing.body.reviewId === body.reviewId &&
      existing.body.applicationId === body.applicationId;
    if (existing && !same) throw new Error('Recover the retained application request before starting a different request.');
    const pending = same ? existing : { route, body: { ...body, requestId: crypto.randomUUID() } };
    saveSaved('pending', pending);
    const result = await api(pending.route, pending.body);
    saveSaved('pending', null);
    return result;
  }
  async function act(action) {
    const own = scope;
    try { await action(); } catch (issue) { if (own === scope) error(issue); }
  }
  function renderSettings(values = {}) {
    const type = currentType(), generation = ++settingsScope; settings.replaceChildren();
    description.textContent = type?.description ?? '';
    for (const item of type?.fields ?? []) {
      const isInstallation = item.name === 'installationId' && type.python;
      const node = element(isInstallation ? 'select' : item.type === 'json' ? 'textarea' : 'input');
      node.name = item.name; node.id = 'application-setting-' + item.name;
      if (!isInstallation && item.type !== 'json')
        node.type = item.type === 'boolean' ? 'checkbox' : item.type === 'port' ? 'number' : 'text';
      if (item.type === 'json') { node.rows = 5; node.spellcheck = false; }
      node.required = item.required; node.autocomplete = 'off';
      if (item.type === 'boolean') node.checked = values[item.name] === true;
      else if (!isInstallation) node.value = values[item.name] ?? (item.type === 'port' ? '0' : '');
      if (item.type === 'port') { node.min = '0'; node.max = '65535'; }
      const row = field(item.label, node);
      if (item.description) row.append(element('p', item.description, 'note'));
      settings.append(row);
      if (isInstallation) {
        node.replaceChildren(new Option('Loading installed environments', ''));
        const selectedRuntime = runtime.value;
        api(query('/api/python/state', { runtimeId: selectedRuntime })).then(value => {
          if (generation !== settingsScope || selectedRuntime !== runtime.value || !node.isConnected) return;
          const entries = value.installations ?? [];
          node.replaceChildren(new Option(entries.length ? 'Choose an installed environment' : 'Install or inspect an environment in Python first', ''),
            ...entries.map(entry => new Option(entry.source.name + ' ' + entry.source.version + ' · ' +
              (entry.extras.join(', ') || 'base') + ' · ' + entry.id.slice(0, 12), entry.id)));
          node.value = entries.some(entry => entry.id === values[item.name]) ? values[item.name] :
            entries.some(entry => entry.id === value.active?.installation) ? value.active.installation : '';
        }).catch(issue => { if (generation === settingsScope) { node.replaceChildren(new Option('Python inventory unavailable', '')); error(issue); } });
      }
    }
    configurationReview = null; reviewResult.hidden = true;
  }
  function configurationValue() {
    const values = {};
    for (const item of currentType()?.fields ?? []) {
      const node = settings.querySelector('[name="' + item.name + '"]');
      if (item.type === 'boolean') { if (node.checked) values[item.name] = true; }
      else if (node.value !== '') values[item.name] = item.type === 'port' ? Number(node.value) : node.value.trim();
    }
    const previous = data?.applications.find(item => item.id === editingId);
    return { runtimeId: runtime.value, kind: kind.value, label: label.value.trim(), settings: values,
      applicationId: editingId, expectedRevision: previous?.revision ?? null };
  }
  function edit(app) {
    editingId = app?.id ?? null;
    if (app) { selectedId = app.id; label.value = app.label; runtime.value = app.runtimeId; kind.value = app.kind; }
    else { label.value = ''; runtime.value = getState()?.selected?.phase === 'READY' ? getState().selected.id : runtime.options[1]?.value ?? ''; }
    renderSettings(app?.settings ?? {}); configuration.open = true; configuration.scrollIntoView({ block: 'nearest' });
    label.focus(); renderSelected();
  }
  kind.addEventListener('change', () => renderSettings());
  form.addEventListener('input', () => { configurationReview = null; reviewResult.hidden = true; });
  runtime.addEventListener('change', () => {
    const values = configurationValue().settings;
    configurationReview = null; reviewResult.hidden = true;
    if (currentType()?.python) renderSettings({ ...values, installationId: undefined });
  });
  form.addEventListener('submit', event => {
    event.preventDefault(); act(async () => {
      configurationReview = await api('/api/applications/review', configurationValue());
      const reviewed = configurationReview;
      const rows = facts([
        ['Original command', reviewed.command.pythonCommand ? reviewed.command.pythonCommand.executable + ' ' +
          reviewed.command.pythonCommand.argv.map(value => JSON.stringify(value)).join(' ') :
          'starforge ' + reviewed.command.command + ' ' + reviewed.command.args.map(value => JSON.stringify(value)).join(' ')],
        ['Runtime', reviewed.runtime.directory], ['Source commit', reviewed.runtime.sourceCommit],
        ['Managed home', reviewed.homeDirectory], ['Connection', reviewed.releaseId ? 'Existing original release ' + reviewed.releaseId : 'Adopt this original ready runtime'],
        ['Input', reviewed.command.terminal ? 'Connected original terminal, explicit operator responses' : 'Original application output'],
        ['Environment file', reviewed.settings.environmentFile ?? 'Inherited operator environment'],
        ...mppReviewRows(reviewed.command),
      ]);
      const save = button(editingId ? 'Save reviewed settings' : 'Save application', () => act(async () => {
        if (configurationReview !== reviewed) return;
        save.disabled = true;
        let result;
        try { result = await retainedRequest('/api/applications/save', { reviewId: reviewed.id, applicationId: editingId }); }
        finally { save.disabled = false; }
        selectedId = result.applicationId; editingId = null;
        configuration.open = false; configurationReview = null; reviewResult.hidden = true;
        await refresh(); await refreshWorkspace(); message(result.connectionError?.message ?? 'Application saved with its original runtime and data locations.');
      }));
      reviewResult.replaceChildren(element('h3', 'Reviewed application'), rows,
        renderOpenApiApplicationReview(reviewed.command), save);
      if (reviewed.command.createDirectories.length) reviewResult.append(element('p', 'Creates private folder: ' + reviewed.command.createDirectories.join(', '), 'note'));
      reviewResult.hidden = false;
    });
  });
  function renderStartReview() {
    if (!startReview || selected()?.id !== startReview.applicationId) { operationReview.hidden = true; return; }
    const reviewed = startReview;
    const start = button('Start reviewed application', () => act(async () => {
      if (startReview !== reviewed) return;
      start.disabled = true;
      let result;
      try { result = await retainedRequest('/api/applications/start', { applicationId: reviewed.applicationId, reviewId: reviewed.id }); }
      finally { start.disabled = false; }
      selectedRun = result.operationId; startReview = null;
      await refresh(); await refreshWorkspace(); message(reviewed.command.pythonCommand && !reviewed.command.pythonCommand.ready ?
        'The original workbook command is starting. Its operating result and output appear below.' :
        'The original application is starting. Its private URL will appear when its CLI prints it.');
    }));
    operationReview.replaceChildren(element('h3', 'Start review'), facts([
      ['Original command', reviewed.command.pythonCommand ? reviewed.command.pythonCommand.executable + ' ' +
        reviewed.command.pythonCommand.argv.map(value => JSON.stringify(value)).join(' ') :
        reviewed.command.command + ' ' + reviewed.command.args.map(value => JSON.stringify(value)).join(' ')],
      ['Release', reviewed.releaseId], ['Source', reviewed.runtime.sourceCommit],
      ['Inputs', reviewed.command.inputs.map(item => item.path).join('\n')],
      ['Terminal', reviewed.command.terminal ? 'Explicit operator input through the original controlling terminal' : 'Retained original output'],
      ...mppReviewRows(reviewed.command),
    ]), renderOpenApiApplicationReview(reviewed.command), start); operationReview.hidden = false;
  }
  function renderSelected() {
    const app = selected(); selectedPanel.hidden = !app; history.hidden = !app;
    if (!app) { outputPanel.hidden = true; return; }
    title.textContent = app.label; phase.textContent = app.phase;
    actions.hidden = Boolean(app.error);
    if (app.error) { details.replaceChildren(element('p', app.error.message)); outputPanel.hidden = true; historyRows.replaceChildren(); return; }
    details.replaceChildren(facts([
      ['Application', data.catalog.find(item => item.id === app.kind)?.title ?? app.kind],
      ['Runtime', app.runtime.directory], ['Source commit', app.runtime.sourceCommit],
      ['Release', app.release?.id ?? 'Original runtime connection pending'], ['Managed home', app.homeDirectory],
      ['Application revision', app.revision], ['Current operation', app.current?.id ?? 'No launch yet'],
    ]));
    const current = app.current, active = Boolean(current?.active), unsettled = ['PENDING', 'QUEUED', 'RUNNING', 'INTERRUPTED'].includes(current?.phase);
    reviewStart.disabled = !app.release || active || unsettled;
    stop.disabled = !current || !active && !unsettled;
    stop.textContent = current?.phase === 'PENDING' || current?.phase === 'QUEUED' ? 'Cancel pending start' : 'Stop application';
    reconnect.hidden = Boolean(app.release);
    continueRun.hidden = !current || active || !unsettled;
    continueRun.textContent = current?.phase === 'INTERRUPTED' ? 'Reconcile original operation' : 'Continue original start';
    editButton.disabled = active || unsettled;
    open.hidden = !current?.privateUrl;
    if (current?.privateUrl) open.href = current.privateUrl; else open.removeAttribute('href');
    open.textContent = app.kind === 'mercury-feed' ? 'Open event feed' : 'Open application';
    relatedApplications.replaceChildren(...(current?.privateLinks ?? []).flatMap(link => {
      let url;
      try { url = new URL(link.url); } catch { return []; }
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
          Number(url.port || 80) < 1 || Number(url.port || 80) > 65535 ||
          url.username || url.password || typeof link.label !== 'string') return [];
      const anchor = element('a', link.label); anchor.href = url.href; anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer'; anchor.referrerPolicy = 'no-referrer'; return [anchor];
    }));
    relatedApplications.hidden = !relatedApplications.childElementCount;
    const workbookCommand = ['python-workbooks', 'python-workbook-delivery'].includes(app.kind);
    urlNote.textContent = workbookCommand ? (active ? 'The original workbook command is running. Its output is retained below.' :
      current ? 'The original workbook command has ended. Open its retained outcome and complete output below.' :
      'Review a start to run this original workbook command.') : current?.privateUrl ? 'The link above is the original private application URL. It remains attached to this operation across runtime-console restarts.' :
      active ? current.stop ? 'The original application is draining its work and stopping.' : 'Waiting for the original application to print its local session URL.' :
        current?.url ? 'This operation has ended. Its retained URL is historical; review a new start to open the same saved application data.' :
          'Save and review a start to receive the original application URL.';
    const signature = JSON.stringify(app.runs);
    if (historyRows.dataset.signature !== signature) {
      historyRows.dataset.signature = signature;
      historyRows.replaceChildren(...app.runs.map(run => {
        const row = element('article', undefined, 'operation');
        const actions = element('div', undefined, 'actions');
        actions.append(button('Open output', () => { selectedRun = run.id; saveSaved('selected', { selectedId, selectedRun }); refreshOutput().catch(error); }));
        row.append(element('h3', run.command + ' · ' + run.phase),
          element('p', run.id + ' · ' + run.createdAt),
          element('p', run.result?.state ? 'Original outcome: ' + run.result.state + (run.result.exitCode !== null && run.result.exitCode !== undefined ? ', exit ' + run.result.exitCode : '') :
            run.active ? 'The original worker lease is held.' : 'Original operation retained.'),
          actions); return row;
      }));
    }
    if (!selectedRun || !app.runs.some(run => run.id === selectedRun)) selectedRun = current?.id ?? null;
    renderStartReview();
  }
  async function refreshOutput() {
    const app = selected(), id = selectedRun, own = scope;
    if (!app || !id) { outputPanel.hidden = true; return; }
    const run = app.runs.find(item => item.id === id);
    const response = await api(query(run.terminal ? '/api/applications/terminal' : '/api/applications/output', { applicationId: app.id, operationId: id }));
    if (scope !== own || app.id !== selectedId || id !== selectedRun) return;
    outputPanel.hidden = false;
    const bottom = output.scrollTop + output.clientHeight >= output.scrollHeight - 40;
    output.textContent = readable(response.output.text);
    if (bottom) output.scrollTop = output.scrollHeight;
    outputDescription.textContent = id + ' · ' + response.output.totalBytes + ' retained output bytes' +
      (response.output.offset ? ' · showing the last ' + (response.output.totalBytes - response.output.offset) + ' bytes' : '');
    inputForm.hidden = !run.terminal;
    input.disabled = send.disabled = interrupt.disabled = eof.disabled = !response.ready || sending;
    if (run.terminal) {
      inputStatus.replaceChildren(...response.inputs.slice(0, 8).map(receipt =>
        element('p', 'Input ' + receipt.sequence + ' · ' + receipt.state + ' · ' + receipt.bytes + ' bytes · ' + receipt.inputId, 'note')));
      const pending = readSaved('terminal-input');
      const receipt = pending && response.inputs.find(item => item.inputId === pending.inputId);
      if (receipt && receipt.state !== 'QUEUED') saveSaved('terminal-input', null);
      if (response.result) inputStatus.prepend(element('p', 'This terminal has ended. Its input and output belong to this original operation.', 'note'));
    }
  }
  async function terminalSend(text) {
    if (sending) return;
    const app = selected(), id = selectedRun, own = scope;
    if (!app || !id || app.current?.id !== id || !app.current.active) throw new Error('Open the running original terminal');
    sending = true; send.disabled = true;
    try {
      const sha256 = await textHash(text), previous = readSaved('terminal-input');
      const pending = previous?.operationId === id && previous.sha256 === sha256 ? previous :
        { applicationId: app.id, operationId: id, inputId: crypto.randomUUID(), sha256 };
      saveSaved('terminal-input', pending);
      const result = await api('/api/applications/input', { applicationId: app.id, operationId: id, inputId: pending.inputId, text });
      if (scope !== own) return;
      saveSaved('terminal-input', null);
      input.value = '';
      message('Terminal input ' + result.inputId + ' is ' + result.state.toLowerCase() + '. This records delivery to the original terminal; application decisions remain in its own output.');
      await refreshOutput();
    } finally { sending = false; if (scope === own) await refreshOutput(); }
  }
  inputForm.addEventListener('submit', event => { event.preventDefault(); terminalSend(input.value + '\n').catch(error); });
  const recoverRequest = button('Recover last application request', () => act(async () => {
    const pending = readSaved('pending'); if (!pending) return;
    const result = await api(pending.route, pending.body);
    selectedId = result.applicationId ?? selectedId; selectedRun = result.operationId ?? selectedRun;
    saveSaved('pending', null); await refresh(); await refreshWorkspace();
  }));
  header.append(recoverRequest);
  async function refresh() {
    if (loading) return;
    loading = true; const own = scope;
    try {
      const value = await api('/api/applications/state');
      if (own !== scope) return;
      data = value;
      if (initial) {
        initial = false; const saved = readSaved('selected');
        if (saved) { selectedId = saved.selectedId; selectedRun = saved.selectedRun; }
      }
      const currentRuntime = runtime.value;
      const options = (getState()?.runtimes ?? []).filter(item => item.phase === 'READY');
      const signature = JSON.stringify(options.map(item => [item.id, item.label, item.packageVersion]));
      if (runtime.dataset.signature !== signature) {
        runtime.dataset.signature = signature;
        runtime.replaceChildren(new Option('Choose a ready runtime', ''), ...options.map(item => new Option(item.label + ' · ' + (item.packageVersion ?? item.sourceCommit), item.id)));
        runtime.value = options.some(item => item.id === currentRuntime) ? currentRuntime :
          options.some(item => item.id === getState()?.selected?.id) ? getState().selected.id : options[0]?.id ?? '';
      }
      if (!kind.options.length) {
        kind.replaceChildren(...data.catalog.map(item => new Option(item.title, item.id)));
        renderSettings();
      }
      if (!data.applications.some(item => item.id === selectedId)) selectedId = data.applications[0]?.id ?? null;
      const listSignature = JSON.stringify(data.applications.map(app => [app.id, app.label, app.phase]));
      if (list.dataset.signature !== listSignature) {
        list.dataset.signature = listSignature;
        list.replaceChildren(...data.applications.map(app => {
          const node = button(app.label + ' · ' + app.phase, () => { selectedId = app.id; selectedRun = null; startReview = null; saveSaved('selected', { selectedId, selectedRun }); renderSelected(); refreshOutput().catch(error); });
          node.className = 'runtime-entry'; node.dataset.applicationId = app.id; return node;
        }));
      }
      empty.hidden = data.applications.length > 0;
      recoverRequest.hidden = !readSaved('pending');
      if (data.applications.length && editingId === null && !configurationReview && !label.value) configuration.open = false;
      renderSelected(); await refreshOutput();
      saveSaved('selected', { selectedId, selectedRun });
    } finally { loading = false; }
  }
  return {
    refresh,
    async beginPython(descriptor) {
      data = await api('/api/applications/state');
      const type = data.catalog.find(item => item.python && item.command === descriptor.command);
      if (!type) throw new Error('This Applications revision does not include the selected original Python command.');
      const value = name => descriptor.args[descriptor.args.indexOf(name) + 1];
      kind.replaceChildren(...data.catalog.map(item => new Option(item.title, item.id)));
      const savedRuntime = getState()?.runtimes.find(item => item.id === descriptor.runtime.runtimeId);
      if (![...runtime.options].some(item => item.value === descriptor.runtime.runtimeId))
        runtime.append(new Option(savedRuntime?.label ?? descriptor.runtime.directory, descriptor.runtime.runtimeId));
      editingId = null; configurationReview = startReview = null;
      label.value = type.title; runtime.value = descriptor.runtime.runtimeId; kind.value = type.id;
      const values = { installationId: descriptor.installationId };
      if (descriptor.command === 'duckdb') {
        values.workspaceDirectory = value('--workspace');
        values.port = descriptor.args.includes('--port') ? Number(value('--port')) : 0;
        if (descriptor.args.includes('--export-root')) values.exportRoot = value('--export-root');
        if (descriptor.args.includes('--handoff-root')) values.handoffRoot = value('--handoff-root');
      } else if (descriptor.command === 'analysis') {
        values.databaseDirectory = value('--database');
        if (descriptor.args.includes('--node')) values.nodeExecutable = value('--node');
        values.port = descriptor.args.includes('--port') ? Number(value('--port')) : 0;
      } else values.argumentsJSON = JSON.stringify(descriptor.args, null, 2);
      renderSettings(values); configuration.open = true;
      switchView('applications'); configuration.scrollIntoView({ block: 'nearest' });
      label.focus();
    },
    async choose(id) { selectedId = id; selectedRun = null; switchView('applications'); await refresh(); },
    reset() {
      scope++; data = null; selectedId = selectedRun = editingId = null; configurationReview = startReview = null;
      initial = true; label.value = ''; kind.replaceChildren(); runtime.replaceChildren(); list.replaceChildren();
      selectedPanel.hidden = history.hidden = outputPanel.hidden = reviewResult.hidden = true; configuration.open = true;
    },
  };
}
