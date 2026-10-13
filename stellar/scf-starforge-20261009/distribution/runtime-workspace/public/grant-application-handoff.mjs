// MIT. Complete Grant case receiving in the original Applications workspace.
import { renderApplicationReview } from './application-review.mjs';
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const button = (text, action) => {
  const node = el('button', text); node.type = 'button';
  node.addEventListener('click', action); return node;
};
const field = (text, node) => { const label = el('label', text); label.append(node); return label; };
const input = (type = 'text', value = '') => { const node = el('input'); node.type = type; node.value = value; return node; };
const rows = values => {
  const list = el('dl', undefined, 'paths');
  for (const [label, value] of values) { const row = el('div'); row.append(el('dt', label), el('dd', value ?? '—')); list.append(row); }
  return list;
};
const size = value => value < 1024 * 1024 ? (value / 1024).toFixed(1) + ' KiB' : (value / 1024 / 1024).toFixed(2) + ' MiB';
const phaseLabel = phase => ({
  PREPARED: 'Prepared', EXPORTED: 'Ready to download', CASE_RECEIVED: 'Case received',
  APPLICATION_REVIEWED: 'Application ready for review', APPLICATION_SAVED: 'Application saved',
  UNAVAILABLE: 'Open to inspect',
}[phase] ?? phase);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const localDate = value => {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ?
    date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
};

export function createGrantApplicationHandoffView({
  root, api, getState, getApplications, onApplicationSaved, message, error,
}) {
  let scope = 0, busy = false, loaded = false, workspaceId = null, selectedOperation = null;
  let cases = [], caseApplicationId = null, sourceOperationId = null, receivingOperationId = null;
  let packageText = null, caseBase64 = null, caseFilename = null, inspected = null, fileGeneration = 0, cursor = null, trail = [], nextCursor = null;
  const section = el('details', undefined, 'panel');
  section.append(el('summary', 'Grant case handoff'));
  section.append(el('p', 'Receive a complete native grant case or a case with its saved Application. Choose the receiving host, receive the original case, then review and save its Application.', 'note'));
  const sourceForm = el('form'), sourceFields = el('fieldset');
  sourceFields.append(el('legend', 'Export a saved grant case'));
  const sourceApp = el('select'); sourceApp.required = true;
  const sourceCase = el('select'); sourceCase.required = true;
  const sourceName = input(); sourceName.maxLength = 300; sourceName.required = true;
  const sourceStart = input('checkbox'); sourceStart.checked = false;
  const caseNotice = el('p', 'Choose an Application and load its current native cases.', 'note');
  const loadCases = button('Load current cases', () => act(async context => {
    const applicationId = sourceApp.value;
    if (!applicationId) throw new Error('Choose a saved Grant Application.');
    const result = await post(context, 'cases', { applicationId, allowStart: sourceStart.checked });
    if (!current(context)) return;
    cases = result.cases; caseApplicationId = applicationId;
    sourceCase.replaceChildren(new Option('Choose a case', ''), ...cases.map(item =>
      new Option(item.name + ' · version ' + item.version + ' · ' + item.mode.toLowerCase(), item.id)));
    caseNotice.textContent = cases.length ? cases.length + ' current cases in this Application.' : 'This Application has no saved grant cases.';
  }));
  const sourceGrid = el('div', undefined, 'columns');
  sourceGrid.append(field('Saved Grant Application', sourceApp), field('Current case', sourceCase), field('Handoff name', sourceName));
  sourceFields.append(sourceGrid, field('Start the original grant service if it is closed', sourceStart), loadCases, caseNotice);
  const exportButton = el('button', 'Export complete handoff'); exportButton.type = 'submit';
  sourceFields.append(exportButton); sourceForm.append(sourceFields);
  const newExport = button('New export', () => {
    sourceOperationId = null; syncDisabled();
    caseNotice.textContent = 'Load current cases to choose the current version for this export.';
  });
  sourceForm.append(newExport);

  const receiveForm = el('form'), receiveFields = el('fieldset');
  receiveFields.append(el('legend', 'Receive a complete case'));
  const receiveFormat = el('select');
  receiveFormat.append(new Option('Case and saved Application — grant-handoff.json', 'paired'),
    new Option('Original native case — complete ZIP', 'native'));
  const file = input('file'); file.accept = 'application/json,.json';
  const fileLabel = field('Complete grant-handoff.json', file);
  const inspection = el('div', undefined, 'result'); inspection.hidden = true;
  const destinationRuntime = el('select'); destinationRuntime.required = true;
  const label = input(), caseName = input(), directory = input(), python = input('text', '/usr/bin/python3');
  const scenario = input(), port = input('number', '0'), actor = input(), allowStart = input('checkbox');
  for (const node of [label, caseName, directory, python, actor]) node.required = true;
  label.maxLength = 120; caseName.maxLength = actor.maxLength = 300;
  port.min = '0'; port.max = '65535'; port.step = '1'; port.required = true;
  const advanced = el('details'), extra = el('textarea'); extra.rows = 5; extra.value = '{}'; extra.spellcheck = false;
  advanced.append(el('summary', 'Additional Application settings'), field('Additional settings JSON', extra),
    el('p', 'Keep any other settings required by your receiving Application. The host fields above take precedence.', 'note'));
  const destination = el('div', undefined, 'columns');
  destination.append(field('Receiving READY runtime', destinationRuntime), field('Application name', label),
    field('Received case name', caseName), field('Private grant workspace', directory),
    field('Python executable', python), field('Original scenario, if needed', scenario),
    field('Application port; 0 chooses an available port', port), field('Recording operator', actor));
  const prepareButton = el('button', 'Prepare receiving'); prepareButton.type = 'submit';
  receiveFields.append(field('Incoming format', receiveFormat), fileLabel, inspection, destination,
    field('Start the original receiving service if it is closed', allowStart), advanced, prepareButton);
  receiveForm.append(receiveFields);
  const newReceive = button('New receiving operation', () => { receivingOperationId = null; syncDisabled(); });
  receiveForm.append(newReceive);

  const resultPanel = el('section', undefined, 'panel'); resultPanel.hidden = true;
  const retained = el('section', undefined, 'panel'), entries = el('div'), paging = el('p', '', 'note');
  const reload = button('Refresh handoffs', () => act(async context => { cursor = null; trail = []; await readList(context); }));
  const previous = button('Previous', () => act(async context => { cursor = trail.pop() ?? null; await readList(context); }));
  const next = button('More handoffs', () => act(async context => {
    if (!nextCursor) return; trail.push(cursor); cursor = nextCursor; await readList(context);
  }));
  const recover = button('Open last handoff', () => act(async context => {
    const id = remembered(); if (!id) return;
    await openOperation(context, id);
  }));
  const navigation = el('div', undefined, 'actions'); navigation.append(reload, previous, next, recover);
  retained.append(el('h3', 'Retained handoffs'), el('p', 'Reopen the original operation to continue export, receiving or Application save.', 'note'), navigation, entries, paging);
  section.append(sourceForm, receiveForm, resultPanel, retained); root.replaceChildren(section);
  const controls = [sourceFields, receiveFields, newExport, newReceive, reload, previous, next, recover];
  function current(context) { return context.scope === scope && context.workspaceId === getState()?.workspaceId; }
  function storageKey() { return 'starforge-grant-handoff-' + getState()?.workspaceId; }
  function remember(id) { try { sessionStorage.setItem(storageKey(), id); } catch {} recover.hidden = false; }
  function remembered() { try { return sessionStorage.getItem(storageKey()); } catch { return null; } }
  async function post(context, action, value) {
    if (!current(context)) throw new Error('The workspace changed. Reopen its retained handoff.');
    const result = await api('/api/applications/grant-handoff/' + action, value);
    if (!current(context)) throw new Error('The workspace changed. The original operation remains with its source workspace.');
    return result;
  }
  function syncDisabled() {
    for (const control of controls) control.disabled = busy;
    sourceFields.disabled = busy || Boolean(sourceOperationId);
    receiveFields.disabled = busy || Boolean(receivingOperationId);
    previous.disabled = busy || !trail.length; next.disabled = busy || !nextCursor;
    recover.hidden = !remembered(); newExport.hidden = !sourceOperationId; newReceive.hidden = !receivingOperationId;
    prepareButton.disabled = (!packageText && !caseBase64) || busy; exportButton.disabled = busy || !cases.length;
    for (const control of resultPanel.querySelectorAll('button')) control.disabled = busy;
  }
  async function act(action) {
    if (busy) return;
    const context = { scope, workspaceId: getState()?.workspaceId };
    busy = true; syncDisabled();
    try { await action(context); }
    catch (cause) { if (current(context)) error(cause); }
    finally { if (current(context)) { busy = false; syncDisabled(); } }
  }
  function download(value) {
    const url = URL.createObjectURL(new Blob([value.text], { type: 'application/json' }));
    const link = el('a'); link.href = url; link.download = value.filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function openOperation(context, id) {
    remember(id);
    const value = await post(context, 'status', { id });
    if (current(context)) showOperation(value);
  }
  async function runOperation(context, action, id) {
    remember(id);
    const value = await post(context, action, { id });
    if (!current(context)) return;
    showOperation(value); await readList(context);
    if (action === 'save') message('The receiving Application is saved. Open it below to continue the received case.');
  }
  function showOperation(value) {
    selectedOperation = value; remember(value.operationId); resultPanel.hidden = false;
    const id = value.operationId, isExport = value.direction === 'EXPORT';
    const bindings = value.selection?.bindings;
    const title = value.package?.name ?? value.selection?.application?.label ?? 'Grant handoff';
    resultPanel.replaceChildren(el('h3', title + ' · ' + phaseLabel(value.phase)), rows([
      ['Operation', isExport ? 'Export complete case and Application' : 'Receive complete case and Application'],
      ['Source handoff', value.package?.name ?? value.selection?.application?.label],
      ['Original case version', value.originalCase?.version],
      ['Receiving grant workspace', bindings?.settings?.workspaceDirectory],
      ['Case name', bindings?.caseName],
      ['Application name', bindings?.label ?? value.selection?.application?.label],
    ]));
    if (value.lastError) resultPanel.append(el('p', value.lastError.message, 'note'));
    const review = value.application?.review ?? value.preflight;
    if (review?.command) {
      resultPanel.append(el('h4', value.application ? 'Receiving Application review' : 'Receiving host review'),
        rows([['Application name', bindings?.label], ['Runtime',
          (getState()?.runtimes ?? []).find(item => item.id === bindings?.runtimeId)?.label ??
            value.selection?.native?.runtime?.directory ?? 'Original selected runtime'],
          ['Recording operator', bindings?.actor], ['Received case name', bindings?.caseName]]),
        renderApplicationReview(review.command));
      if (review.command.createDirectories?.length) resultPanel.append(el('p',
        'Creates private folder: ' + review.command.createDirectories.join(', '), 'note'));
    }
    const actions = el('div', undefined, 'actions');
    actions.append(button('Refresh operation', () => act(context => openOperation(context, id))));
    if (isExport && value.phase !== 'EXPORTED') actions.append(button('Continue export', () => act(context => runOperation(context, 'resume', id))));
    if (isExport && value.phase === 'EXPORTED') actions.append(button('Download complete handoff', () => act(async context => {
      const received = await post(context, 'download', { id }); if (current(context)) download(received);
    })));
    if (!isExport && ['PREPARED', 'CASE_RECEIVED'].includes(value.phase)) actions.append(button(
      value.phase === 'PREPARED' ? 'Receive case and review Application' : 'Continue Application review',
      () => act(context => runOperation(context, 'receive', id))));
    if (value.phase === 'APPLICATION_REVIEWED') actions.append(button('Save reviewed Application',
      () => act(context => runOperation(context, 'save', id))));
    if (value.application?.result?.applicationId) actions.append(button('Open saved Application', () => act(async context => {
      if (current(context)) await onApplicationSaved(value.application.result.applicationId);
    })));
    resultPanel.append(actions);
    if (value.imported?.result?.id) resultPanel.append(el('p',
      'Open ' + (bindings?.label ?? 'the receiving Application') + ' and select ' +
        (bindings?.caseName ?? 'the received case') + ' in Delivery operations.', 'note'));
    const details = el('details'); details.append(el('summary', 'Complete operation details'), el('pre', JSON.stringify(value, null, 2)));
    resultPanel.append(details); syncDisabled();
  }
  async function readList(context) {
    const page = await post(context, 'list', { cursor });
    if (!current(context)) return;
    if (page.workspaceId !== context.workspaceId) throw new Error('Reopen the handoffs for the current workspace.');
    loaded = true; nextCursor = page.nextCursor;
    const table = el('table'), head = el('thead'), headings = el('tr');
    for (const name of ['Handoff', 'Purpose', 'State', 'Updated (local)', '']) headings.append(el('th', name));
    head.append(headings); const body = el('tbody');
    for (const item of page.entries) {
      const row = el('tr'), action = el('td');
      action.append(button('Open', () => act(context => openOperation(context, item.id))));
      row.append(el('td', item.name ?? 'Retained handoff'), el('td', item.direction === 'EXPORT' ? 'Export' : 'Receiving'),
        el('td', phaseLabel(item.phase)), el('td', localDate(item.updatedAt)), action);
      body.append(row);
    }
    table.append(head, body);
    entries.replaceChildren(page.entries.length ? table : el('p', 'No retained handoffs on this page.', 'note'));
    paging.textContent = page.entries.length + ' handoffs shown'; syncDisabled();
  }
  sourceApp.addEventListener('change', () => {
    cases = []; caseApplicationId = null; sourceOperationId = null; sourceCase.replaceChildren(new Option('Load current cases', ''));
    const app = getApplications().find(item => item.id === sourceApp.value);
    sourceName.value = app ? app.label + ' handoff' : ''; caseNotice.textContent = 'Load the current native cases for this Application.'; syncDisabled();
  });
  sourceStart.addEventListener('change', () => { sourceOperationId = null; });
  sourceForm.addEventListener('submit', event => {
    event.preventDefault();
    act(async context => {
      const chosen = cases.find(item => item.id === sourceCase.value);
      if (!chosen || caseApplicationId !== sourceApp.value) throw new Error('Load and select a current case from this saved Application.');
      const id = sourceOperationId ?? crypto.randomUUID(); sourceOperationId = id; remember(id); syncDisabled();
      const result = await post(context, 'export', { id, applicationId: sourceApp.value, caseId: chosen.id,
        expectedVersion: chosen.version, name: sourceName.value, allowStart: sourceStart.checked });
      if (!current(context)) return;
      showOperation(result); await readList(context); message('The complete grant case and Application handoff is ready to download.');
    });
  });
  receiveFormat.addEventListener('change', () => {
    fileGeneration++; file.value = '';
    packageText = caseBase64 = caseFilename = inspected = null; receivingOperationId = null; inspection.hidden = true;
    const native = receiveFormat.value === 'native';
    file.accept = native ? 'application/zip,.zip' : 'application/json,.json';
    fileLabel.firstChild.textContent = native ? 'Complete original native case ZIP' : 'Complete grant-handoff.json';
    syncDisabled();
  });
  file.addEventListener('change', () => {
    const selected = file.files?.[0], generation = ++fileGeneration, native = receiveFormat.value === 'native';
    packageText = caseBase64 = caseFilename = inspected = null; receivingOperationId = null; inspection.hidden = true; syncDisabled();
    if (!selected) return;
    act(async context => {
      const maximum = (native ? 32 : 48) * 1024 * 1024;
      if (selected.size < 1 || selected.size > maximum)
        throw new Error(native ? 'Choose the complete native case ZIP, up to 32 MiB.' : 'Choose the complete handoff file, up to 48 MiB.');
      const bytes = new Uint8Array(await selected.arrayBuffer());
      if (!current(context) || generation !== fileGeneration) return;
      if (native) {
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 32768)
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
        caseBase64 = btoa(binary); caseFilename = selected.name;
        const name = selected.name.replace(/\.zip$/i, '').replace(/_/g, ' ').slice(0, 300);
        inspected = { native: true, name, bytes: bytes.length };
        if (!label.value) label.value = name.slice(0, 120);
        if (!caseName.value) caseName.value = name;
        inspection.replaceChildren(el('h4', name), rows([
          ['Original native archive', selected.name], ['Complete case archive', size(bytes.length)],
          ['Application', 'Create from the selected receiving host and settings'],
        ]), el('p', 'The original native importer reads the complete plan, case, history and selected delivery document before this Application is saved.', 'note'));
      } else {
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        const value = await post(context, 'inspect', { packageText: text });
        if (!current(context) || generation !== fileGeneration) return;
        packageText = text; inspected = value;
        if (!label.value) label.value = value.name.slice(0, 120);
        if (!caseName.value) caseName.value = value.name;
        inspection.replaceChildren(el('h4', value.name), rows([
          ['Case purpose', value.source.case?.mode ?? 'Read from the original native archive'],
          ['Case version', value.source.case?.version ?? 'Read during native receiving'],
          ['Complete case archive', size(value.files.case.bytes)], ['Complete Application setup', size(value.files.setup.bytes)],
        ]));
      }
      inspection.hidden = false; syncDisabled();
    });
  });
  receiveForm.addEventListener('submit', event => {
    event.preventDefault();
    act(async context => {
      if ((!packageText && !caseBase64) || !inspected) throw new Error('Choose the complete handoff or original native case file.');
      const extras = JSON.parse(extra.value || '{}');
      if (!object(extras)) throw new Error('Additional settings must be one JSON object.');
      const bindingsValue = { runtimeId: destinationRuntime.value, label: label.value, caseName: caseName.value,
        actor: actor.value, allowStart: allowStart.checked, settings: { ...extras, workspaceDirectory: directory.value,
          pythonExecutable: python.value, scenarioFile: scenario.value, port: Number(port.value) } };
      const id = receivingOperationId ?? crypto.randomUUID(); receivingOperationId = id; remember(id); syncDisabled();
      const incoming = caseBase64 ? { caseBase64, caseFilename } : { packageText };
      const value = await post(context, 'prepare', { id, ...incoming, bindingsValue });
      if (!current(context)) return;
      showOperation(value); await readList(context); message('The complete handoff and destination settings are retained. Review the host, then receive the case.');
    });
  });
  section.addEventListener('toggle', () => {
    if (section.open && !loaded && !busy) act(context => readList(context));
  });
  function options(select, items, placeholder) {
    const selected = select.value, signature = JSON.stringify(items);
    if (select.dataset.signature === signature) return;
    select.dataset.signature = signature;
    select.replaceChildren(new Option(placeholder, ''), ...items.map(item => new Option(item.label, item.id)));
    if (items.some(item => item.id === selected)) select.value = selected;
  }
  return {
    update() {
      workspaceId = getState()?.workspaceId ?? null;
      options(sourceApp, getApplications().filter(item => item.kind === 'grant-workspace' && !item.error)
        .map(item => ({ id: item.id, label: item.label })), 'Choose a saved Grant Application');
      options(destinationRuntime, (getState()?.runtimes ?? []).filter(item => item.phase === 'READY')
        .map(item => ({ id: item.id, label: item.label ?? item.directory })), 'Choose the receiving READY runtime');
      syncDisabled();
    },
    reset() {
      scope++; fileGeneration++; busy = false; loaded = false; workspaceId = null; selectedOperation = null;
      cases = []; caseApplicationId = sourceOperationId = receivingOperationId = null;
      packageText = caseBase64 = caseFilename = inspected = null; cursor = nextCursor = null; trail = [];
      sourceForm.reset(); receiveForm.reset(); file.accept = 'application/json,.json';
      fileLabel.firstChild.textContent = 'Complete grant-handoff.json'; extra.value = '{}'; python.value = '/usr/bin/python3'; port.value = '0';
      sourceApp.replaceChildren(); sourceCase.replaceChildren(); destinationRuntime.replaceChildren();
      delete sourceApp.dataset.signature; delete destinationRuntime.dataset.signature;
      inspection.hidden = resultPanel.hidden = true; resultPanel.replaceChildren(); entries.replaceChildren(); paging.textContent = '';
      section.open = false; syncDisabled();
    },
  };
}
