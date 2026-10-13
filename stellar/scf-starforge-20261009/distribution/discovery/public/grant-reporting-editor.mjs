// MIT. Preparation inputs feed the existing Operating plans model and receiver.
import { inspectOperatingPlan, operatingPlanRevision, operatingStepCommand,
  renderOperatingPlanHTML, renderOperatingPlanMarkdown } from '/operating-plan-core.mjs';

const PREPARATION_SCHEMA = 'stellar-forge.grant-reporting-preparation.v1';
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_PREPARATION_BYTES = 96 * 1024 * 1024;
const fields = ['title', 'customer', 'period', 'owner', 'receiving', 'startDate', 'asOfDate'];
const pathFields = ['workspace', 'sourceProject', 'outputDirectory', 'receivingWorkspace', 'commandFinderUrl'];
const copy = value => JSON.parse(JSON.stringify(value));
const timestamp = () => new Date().toISOString();
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const encode = value => new TextEncoder().encode(value);
const json = value => JSON.stringify(value, null, 2) + '\n';
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const parse = text => JSON.parse(text.replace(/^\uFEFF/, ''));
const element = (tag, value, className) => {
  const result = document.createElement(tag);
  if (value !== undefined) result.textContent = value;
  if (className) result.className = className;
  return result;
};

function openStorage() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('starforge-grant-reporting-preparations-v1', 1);
    let abandoned = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore('preparations', { keyPath: 'id' });
      request.result.createObjectStore('sources', { keyPath: 'sha256' });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      abandoned = true;
      reject(new Error('Close an older reporting preparation tab, then reopen this preparation.'));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (abandoned) { database.close(); return; }
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

function readStorage(database, store, key) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, 'readonly');
    const request = key === undefined ? transaction.objectStore(store).getAll() : transaction.objectStore(store).get(key);
    let result;
    request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error || new Error('The saved preparation could not be opened.'));
    transaction.onerror = () => {};
  });
}

async function sourceRecord(name, text, kind) {
  const bytes = encode(text);
  if (bytes.length > MAX_SOURCE_BYTES) throw new RangeError(name + ' exceeds the 32 MiB source-file limit.');
  const value = parse(text);
  if (!isObject(value)) throw new TypeError(name + ' must contain a complete JSON object.');
  if (!crypto.subtle) throw new Error('Open Command finder on HTTPS or a localhost address to retain source identities.');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return { name, text, kind, bytes: bytes.length, sha256 };
}

function download(content, name, type = 'application/json') {
  const value = typeof content === 'string' ? content : json(content);
  const url = URL.createObjectURL(new Blob([value], { type }));
  const link = element('a');
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

let reportingBuilder;
async function createGrantReportingPlan(input) {
  reportingBuilder ??= await import('/reporting/grant-reporting-core.mjs');
  return reportingBuilder.createGrantReportingPlan(input);
}
function planIdentity(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value))
    throw new TypeError('Retain the original 1–128 character Operating plan identifier.');
  return value;
}
function planCreationTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19))
    throw new TypeError('Retain the original UTC Operating plan creation time.');
  return value;
}
function retainedPreparation(value) {
  const selected = copy(value);
  selected.planId = planIdentity(selected.planId);
  selected.planCreatedAt = planCreationTime(selected.planCreatedAt ?? selected.preview?.savedAt ?? selected.createdAt);
  return selected;
}
function nativeProcedureFile(directory) {
  const windows = /^[A-Za-z]:[\\/]|^\\\\/.test(directory);
  return directory.replace(/[\\/]+$/, '') + (windows && !directory.includes('/') ? '\\' : '/') +
    'grant-reporting-plan.json';
}

function freshPreparation(previous) {
  const now = timestamp();
  const values = Object.fromEntries(fields.map(key => [key, '']));
  values.asOfDate = now.slice(0, 10);
  values.paths = Object.fromEntries(pathFields.map(key => [key, '']));
  values.paths.commandFinderUrl = location.protocol === 'http:' && !location.port
    ? location.origin + ':80' : location.origin;
  return {
    schema: PREPARATION_SCHEMA, id: crypto.randomUUID(), planId: crypto.randomUUID(),
    planCreatedAt: now, revision: 0, createdAt: now, updatedAt: now,
    values: previous ? copy(previous.values) : values,
    files: previous ? copy(previous.files) : {},
    preview: null, received: false,
    origin: previous ? { id: previous.id, revision: previous.revision } : null,
  };
}

function validateValues(value) {
  if (!isObject(value) || !isObject(value.paths)) throw new TypeError('The preparation needs its complete entered fields and operating paths.');
  const result = {};
  for (const key of fields) {
    if (typeof value[key] !== 'string') throw new TypeError('The preparation field ' + key + ' must be text.');
    if (value[key].length > (key === 'receiving' ? 32000 : ['title', 'owner'].includes(key) ? 300 : 1000)) throw new RangeError('The preparation field ' + key + ' is too long.');
    result[key] = value[key];
  }
  result.paths = {};
  for (const key of pathFields) {
    if (typeof value.paths[key] !== 'string' || value.paths[key].length > 4096)
      throw new TypeError('The preparation needs a complete text path for ' + key + '.');
    result.paths[key] = value.paths[key];
  }
  for (const key of ['sourceRoot', 'sourceSelection']) {
    if (value[key] === undefined) continue;
    if (value[key] !== null && (typeof value[key] !== 'string' || value[key].includes('\u0000') ||
        value[key].length > (key === 'sourceRoot' ? 4096 : 128)))
      throw new TypeError('Retain the original source context for ' + key + '.');
    result[key] = value[key];
  }
  return result;
}

export function installGrantReportingEditor({ trigger, getCatalog, receive, onStatus = () => {} }) {
  const $ = id => document.getElementById('reporting-' + id);
  const dialog = $('dialog');
  if (!trigger || !dialog || typeof getCatalog !== 'function' || typeof receive !== 'function')
    throw new TypeError('The reporting editor needs its dialog, source catalog and existing plan receiver.');

  let database, preparation = freshPreparation(), busy = false, dirty = false, change = 0;
  let opening, saveTimer, writeQueue = Promise.resolve(), writes = 0, opened = false;
  const cache = new Map(), pendingSources = new Set();

  const error = value => {
    $('error').hidden = !value;
    $('error').textContent = value ? (value.code ? value.code + ': ' : '') + value.message : '';
  };
  const status = value => { $('status').textContent = value; };
  const remember = () => {
    try { sessionStorage.setItem('starforge-grant-reporting-preparation', preparation.id); } catch {}
  };
  const updateControls = () => {
    const ready = !!preparation.preview;
    $('fields').disabled = busy || preparation.received;
    for (const control of dialog.querySelectorAll('[data-reporting-busy]')) control.disabled = busy;
    for (const control of dialog.querySelectorAll('[data-reporting-edit]')) control.disabled = busy || preparation.received;
    for (const control of dialog.querySelectorAll('[data-reporting-preview]')) control.disabled = busy || !ready;
    $('receive').textContent = preparation.received ? 'Open saved operating plan' : 'Create plan and open';
    $('preview-button').textContent = ready ? 'Rebuild preview' : 'Preview procedure';
    $('received-note').hidden = !preparation.received;
  };

  async function getFile(reference) {
    if (!reference) return null;
    const sha256 = typeof reference === 'string' ? reference : reference.sha256;
    if (!cache.has(sha256)) {
      const file = await readStorage(database, 'sources', sha256);
      if (!file) throw new Error('A retained preparation input is unavailable. Open the complete preparation JSON to recover it.');
      cache.set(sha256, file);
    }
    const file = cache.get(sha256);
    return typeof reference === 'string' ? file : { ...file, name: reference.name, kind: reference.kind };
  }

  function rememberFile(file) {
    if (!cache.has(file.sha256)) pendingSources.add(file.sha256);
    cache.set(file.sha256, file);
    return { sha256: file.sha256, name: file.name, kind: file.kind };
  }

  async function refreshList() {
    const list = await readStorage(database, 'preparations');
    const selected = preparation.id;
    $('saved').replaceChildren();
    list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!list.some(item => item.id === selected)) {
      const option = element('option', preparation.values.title || 'Current preparation');
      option.value = selected; $('saved').append(option);
    }
    for (const item of list) {
      const label = (item.values.title || 'Untitled reporting preparation') +
        (item.values.period ? ' · ' + item.values.period : '') +
        (item.received ? ' · plan saved' : ' · preparation');
      const option = element('option', label);
      option.value = item.id; $('saved').append(option);
    }
    $('saved').value = selected;
  }

  function persist({ candidate } = {}) {
    const adopting = candidate !== undefined;
    clearTimeout(saveTimer); saveTimer = undefined;
    const pending = writeQueue.catch(() => {}).then(async () => {
      if (!adopting && !dirty) return;
      if (!database) throw new Error('Preparation storage is unavailable. Download the complete preparation before leaving this page.');
      const selected = adopting ? candidate : preparation;
      const snapshot = copy(selected), expectedRevision = selected.revision;
      const capturedChange = change, sourceIds = [...pendingSources];
      snapshot.revision = expectedRevision + 1; snapshot.updatedAt = timestamp();
      writes++;
      try {
        await new Promise((resolve, reject) => {
          const transaction = database.transaction(['preparations', 'sources'], 'readwrite');
          const records = transaction.objectStore('preparations');
          let failure;
          const request = records.get(snapshot.id);
          request.onsuccess = () => {
            try {
              const retained = request.result;
              if ((retained?.revision || 0) !== expectedRevision) {
                const conflict = new Error('Another tab saved a newer preparation. Copy this preparation to retain your entered work under a new name.');
                conflict.code = 'REPORTING_PREPARATION_CHANGED';
                throw conflict;
              }
              for (const id of sourceIds) transaction.objectStore('sources').put(cache.get(id));
              records.put(snapshot);
            } catch (cause) { failure = cause; transaction.abort(); }
          };
          transaction.oncomplete = resolve;
          transaction.onabort = () => reject(failure || transaction.error || new Error('The complete preparation could not be saved.'));
          transaction.onerror = () => {};
        });
        for (const id of sourceIds) pendingSources.delete(id);
        if (adopting) {
          preparation = snapshot; dirty = false; change++;
          remember();
          // Publish the accepted identity and entered fields together, before a
          // following source/list refresh can fail. The prior desk stays live
          // until this candidate's original readwrite transaction commits.
          renderEnteredFields();
        } else if (preparation.id === snapshot.id) {
          preparation.revision = snapshot.revision; preparation.updatedAt = snapshot.updatedAt;
          if (change === capturedChange) dirty = false;
          remember();
          $('storage').textContent = dirty ? 'Saving entered work…' : 'Preparation saved · ' + new Date(snapshot.updatedAt).toLocaleString();
        }
        await refreshList();
      } finally { writes--; }
    });
    writeQueue = pending;
    return pending;
  }

  function changed({ invalidate = true } = {}) {
    dirty = true; change++;
    if (invalidate) {
      if (preparation.preview) {
        preparation.planId = crypto.randomUUID();
        preparation.planCreatedAt = timestamp();
      }
      preparation.preview = null;
      $('preview').hidden = true; $('preview-content').replaceChildren();
    }
    $('storage').textContent = 'Saving entered work…';
    updateControls();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist().catch(cause => {
      error(cause); $('storage').textContent = 'Entered work remains in this tab. Download the preparation to keep a portable copy.';
    }), 250);
  }

  async function showSources() {
    for (const kind of ['case', 'sourceProject', 'catalog']) {
      const file = await getFile(preparation.files[kind]);
      const target = $(kind + '-summary');
      if (!file) {
        target.textContent = kind === 'catalog' ? 'The current selected toolkit will be captured when you preview.' : 'Choose the complete original JSON.';
        continue;
      }
      const value = parse(file.text);
      target.textContent = file.name + ' · ' + file.bytes.toLocaleString() + ' bytes' +
        (typeof value.schema === 'string' ? ' · ' + value.schema : '');
    }
  }

  async function preparedPlan() {
    if (!preparation.preview) return null;
    const file = await getFile(preparation.preview);
    return inspectOperatingPlan(parse(file.text));
  }

  function appendDetail(parent, label, value, code = false) {
    if (!value) return;
    parent.append(element('h4', label));
    parent.append(element(code ? 'pre' : 'p', value));
  }

  function renderPreview(plan) {
    const body = operatingPlanRevision(plan, plan.revisions.length);
    const root = $('preview-content');
    root.replaceChildren();
    root.append(element('p', body.title, 'reporting-preview-title'));
    root.append(element('p', [
      body.customer, body.period, body.owner ? 'Owner: ' + body.owner : '',
      body.steps.length + ' ordered steps',
    ].filter(Boolean).join(' · '), 'hint'));
    if (body.purpose) root.append(element('p', body.purpose));
    root.append(element('p', 'Save complete plan JSON at ' + nativeProcedureFile(preparation.values.paths.outputDirectory) + ' before running its native commands.', 'hint'));
    const steps = element('ol', undefined, 'reporting-preview-steps');
    for (const [index, step] of body.steps.entries()) {
      const item = element('li'), detail = element('details');
      detail.append(element('summary', (index + 1) + '. ' + step.title));
      appendDetail(detail, 'Work', step.instruction);
      appendDetail(detail, 'Owner and due date', [step.owner, step.due].filter(Boolean).join(' · '));
      appendDetail(detail, 'Inputs', step.inputs, true);
      const command = operatingStepCommand(step);
      appendDetail(detail, 'Command', command, true);
      appendDetail(detail, 'Expected result', step.expectedResult);
      if (step.selection) appendDetail(detail, 'Selected toolkit entry', step.selection.item.name + ' · ' + step.selection.item.id);
      item.append(detail); steps.append(item);
    }
    root.append(steps);
    appendDetail(root, 'Receiving and continuation', body.receiving);
    $('preview').hidden = false;
  }

  function renderEnteredFields() {
    for (const field of fields) $(field).value = preparation.values[field];
    for (const field of pathFields) $('path-' + field).value = preparation.values.paths[field];
    $('identity').textContent = 'Preparation ' + preparation.id;
    $('storage').textContent = preparation.revision
      ? 'Preparation saved · ' + new Date(preparation.updatedAt).toLocaleString() : 'Enter the report and retain its original inputs.';
    for (const kind of ['case', 'sourceProject', 'catalog'])
      $(kind + '-summary').textContent = preparation.files[kind] ? 'Opening retained source…' : 'No source selected.';
    $('preview').hidden = true; $('preview-content').replaceChildren();
    updateControls();
  }

  async function render() {
    renderEnteredFields();
    await showSources();
    const plan = await preparedPlan();
    if (plan) renderPreview(plan);
    else { $('preview').hidden = true; $('preview-content').replaceChildren(); }
    updateControls();
    await refreshList();
  }

  async function perform(action) {
    if (busy) return;
    busy = true; updateControls(); error(null);
    try { return await action(); }
    catch (cause) { error(cause); }
    finally { busy = false; updateControls(); }
  }

  async function initialize() {
    if (opened) return;
    if (!opening) opening = (async () => {
      database = await openStorage();
      let selected;
      try { selected = sessionStorage.getItem('starforge-grant-reporting-preparation'); } catch {}
      if (selected) {
        const retained = await readStorage(database, 'preparations', selected);
        if (retained) preparation = retainedPreparation(retained);
      }
      opened = true;
      await render();
    })().catch(cause => { opening = null; throw cause; });
    await opening;
  }

  async function captureCatalog() {
    const catalog = getCatalog();
    if (!isObject(catalog)) throw new Error('Refresh the selected toolkit source in Command finder before preparing a reporting procedure.');
    const file = await sourceRecord('command-catalog.json', json(catalog), 'catalog');
    const previous = preparation.files.catalog?.sha256;
    const retainedSourceContext = preparation.values.sourceRoot != null || preparation.values.sourceSelection != null;
    preparation.files.catalog = rememberFile(file);
    delete preparation.values.sourceRoot; delete preparation.values.sourceSelection;
    if (previous !== file.sha256 || retainedSourceContext) changed();
    await showSources();
    return catalog;
  }

  async function builderInput(savedAt) {
    const originalCase = await getFile(preparation.files.case);
    const originalProject = await getFile(preparation.files.sourceProject);
    if (!originalCase || !originalProject) throw new Error('Choose both the complete Grant case JSON and its complete Source Tables project JSON.');
    let catalogFile = await getFile(preparation.files.catalog);
    if (!catalogFile) { await captureCatalog(); catalogFile = await getFile(preparation.files.catalog); }
    return {
      catalog: parse(catalogFile.text), case: parse(originalCase.text), sourceProject: parse(originalProject.text),
      paths: copy(preparation.values.paths), id: preparation.planId,
      title: preparation.values.title, customer: preparation.values.customer,
      period: preparation.values.period, owner: preparation.values.owner,
      receiving: preparation.values.receiving, startDate: preparation.values.startDate || undefined,
      asOfDate: preparation.values.asOfDate,
      ...(preparation.values.sourceRoot !== undefined ? {sourceRoot: preparation.values.sourceRoot} : {}),
      ...(preparation.values.sourceSelection !== undefined ? {sourceSelection: preparation.values.sourceSelection} : {}),
      savedAt,
    };
  }

  async function buildPreview() {
    if (preparation.received) throw new Error('Copy this preparation to prepare another report, or open its saved operating plan to record the work.');
    if (preparation.preview) {
      const retained = await preparedPlan(); await persist(); renderPreview(retained);
      status('Opened the retained complete preview with its original plan identity.');
      return retained;
    }
    const savedAt = preparation.planCreatedAt;
    const plan = inspectOperatingPlan(await createGrantReportingPlan(await builderInput(savedAt)));
    const file = await sourceRecord('operating-plan-' + plan.id + '.json', json(plan), 'plan');
    preparation.preview = { ...rememberFile(file), savedAt };
    changed({ invalidate: false });
    await persist();
    renderPreview(plan);
    status('Complete reporting procedure prepared. Review its ordered work, then create the operating plan.');
    return plan;
  }

  async function exportPreparation() {
    const files = {};
    for (const [kind, reference] of Object.entries(preparation.files)) files[kind] = await getFile(reference);
    const value = {
      schema: PREPARATION_SCHEMA, id: preparation.id, planId: preparation.planId,
      planCreatedAt: preparation.planCreatedAt, createdAt: preparation.createdAt, updatedAt: timestamp(),
      values: copy(preparation.values), files, plan: await preparedPlan(),
    };
    const text = json(value);
    if (encode(text).length > MAX_PREPARATION_BYTES) throw new RangeError('The complete preparation exceeds 96 MiB. Download its original inputs and complete plan separately.');
    download(text, 'grant-reporting-' + preparation.id + '-preparation.json');
    status('Downloaded the complete preparation with its original JSON inputs and current preview.');
  }

  async function importPreparation(file) {
    if (!file) return;
    if (file.size > MAX_PREPARATION_BYTES) throw new RangeError('Choose a complete preparation JSON up to 96 MiB.');
    const value = parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()));
    if (!isObject(value) || value.schema !== PREPARATION_SCHEMA || !isObject(value.files))
      throw new TypeError('Choose a complete Grant reporting preparation JSON.');
    const values = validateValues(value.values);
    const receivedFiles = {};
    for (const kind of ['case', 'sourceProject', 'catalog']) {
      if (!value.files[kind]) continue;
      const incoming = value.files[kind];
      if (!isObject(incoming) || incoming.kind !== kind || typeof incoming.name !== 'string' || typeof incoming.text !== 'string')
        throw new TypeError('The preparation input ' + kind + ' is incomplete.');
      const retained = await sourceRecord(incoming.name, incoming.text, kind);
      if (retained.sha256 !== incoming.sha256 || retained.bytes !== incoming.bytes)
        throw new Error('The complete original input for ' + kind + ' differs from its saved identity.');
      receivedFiles[kind] = retained;
    }
    const incomingPlan = value.plan === null || value.plan === undefined ? null : inspectOperatingPlan(value.plan);
    const originalPlanId = planIdentity(value.planId);
    const originalPlanCreatedAt = planCreationTime(value.planCreatedAt ?? incomingPlan?.createdAt ?? value.createdAt);
    if (incomingPlan && (incomingPlan.id !== originalPlanId || incomingPlan.createdAt !== originalPlanCreatedAt))
      throw new TypeError('The saved preview must keep the preparation’s original plan identity and creation time.');
    const next = freshPreparation();
    next.planId = originalPlanId; next.planCreatedAt = originalPlanCreatedAt;
    next.values = values;
    next.origin = { id: typeof value.id === 'string' ? value.id : '', importedAt: timestamp() };
    if (incomingPlan) {
      if (!receivedFiles.case || !receivedFiles.sourceProject || !receivedFiles.catalog)
        throw new TypeError('A saved preview needs its complete case, source project and selected toolkit catalog.');
      const generated = await createGrantReportingPlan({
        catalog: parse(receivedFiles.catalog.text), case: parse(receivedFiles.case.text),
        sourceProject: parse(receivedFiles.sourceProject.text), paths: copy(values.paths),
        id: incomingPlan.id, title: values.title, customer: values.customer, period: values.period,
        owner: values.owner, receiving: values.receiving, startDate: values.startDate || undefined, asOfDate: values.asOfDate,
        savedAt: incomingPlan.createdAt,
        ...(values.sourceRoot !== undefined ? {sourceRoot: values.sourceRoot} : {}),
        ...(values.sourceSelection !== undefined ? {sourceSelection: values.sourceSelection} : {}),
      });
      if (canonical(generated) !== canonical(incomingPlan))
        throw new Error('The preview differs from these saved preparation inputs. Import an edited complete plan through Operating plans, or open a preparation with its original preview.');
      next.planId = incomingPlan.id;
      const planFile = await sourceRecord('operating-plan-' + incomingPlan.id + '.json', json(incomingPlan), 'plan');
      next.preview = { ...rememberFile(planFile), savedAt: incomingPlan.createdAt };
    }
    for (const [kind, retained] of Object.entries(receivedFiles)) next.files[kind] = rememberFile(retained);
    await persist();
    await persist({ candidate: next });
    await render(); remember();
    status('Opened all original preparation inputs under a new preparation name. The complete preview keeps its original operating plan identity.');
  }

  trigger.addEventListener('click', () => {
    dialog.showModal();
    perform(async () => { await initialize(); $('title').focus(); });
  });
  $('close').addEventListener('click', () => {
    dialog.close();
    persist().catch(cause => { error(cause); onStatus(cause.message); });
  });
  dialog.addEventListener('cancel', () => {
    persist().catch(cause => { error(cause); onStatus(cause.message); });
  });
  $('new').addEventListener('click', () => perform(async () => {
    await persist();
    await persist({ candidate: freshPreparation() });
    await render(); remember(); $('title').focus();
    status('New reporting preparation. Choose the original case and source project.');
  }));
  $('copy').addEventListener('click', () => perform(async () => {
    const next = freshPreparation(preparation);
    await persist({ candidate: next });
    await render(); remember(); $('period').focus();
    status('Copied the complete entered preparation. Set the next reporting period and preview its procedure.');
  }));
  $('saved').addEventListener('change', () => perform(async () => {
    const selected = $('saved').value;
    await persist();
    const retained = await readStorage(database, 'preparations', selected);
    if (!retained) throw new Error('The selected preparation is unavailable.');
    preparation = retainedPreparation(retained); dirty = false; change++;
    await render(); remember();
    status('Opened the complete saved preparation and its retained original inputs.');
  }));
  for (const field of fields) $(field).addEventListener('input', () => {
    if (busy || preparation.received) return;
    preparation.values[field] = $(field).value; changed();
  });
  for (const field of pathFields) $('path-' + field).addEventListener('input', () => {
    if (busy || preparation.received) return;
    preparation.values.paths[field] = $('path-' + field).value; changed();
  });
  for (const kind of ['case', 'sourceProject']) {
    $(kind + '-file').addEventListener('change', () => perform(async () => {
      const file = $(kind + '-file').files[0];
      if (!file) return;
      if (file.size > MAX_SOURCE_BYTES) throw new RangeError('Choose a complete JSON source up to 32 MiB.');
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
      const retained = await sourceRecord(file.name, text, kind);
      preparation.files[kind] = rememberFile(retained);
      changed(); await persist(); await showSources();
      $(kind + '-file').value = '';
      status('Retained ' + file.name + ' with its complete original JSON.');
    }));
  }
  $('capture-catalog').addEventListener('click', () => perform(async () => {
    await captureCatalog(); await persist();
    status('Retained the current toolkit catalog. Preview again to use its selected registrations.');
  }));
  $('form').addEventListener('submit', event => {
    event.preventDefault();
    perform(buildPreview);
  });
  $('export-preparation').addEventListener('click', () => perform(exportPreparation));
  $('import-preparation').addEventListener('click', () => {
    $('preparation-file').value = ''; $('preparation-file').click();
  });
  $('preparation-file').addEventListener('change', () => perform(() => importPreparation($('preparation-file').files[0])));
  for (const format of ['json', 'html', 'markdown']) {
    $('download-' + format).addEventListener('click', () => perform(async () => {
      const plan = await preparedPlan();
      if (!plan) throw new Error('Preview the complete procedure before downloading the plan.');
      const stem = 'grant-reporting-' + plan.id;
      if (format === 'json') download(plan, 'grant-reporting-plan.json');
      else if (format === 'html') download(renderOperatingPlanHTML(plan), stem + '.html', 'text/html');
      else download(renderOperatingPlanMarkdown(plan), stem + '.md', 'text/markdown');
      status(format === 'json'
        ? 'Downloaded the complete plan. Save it at ' + nativeProcedureFile(preparation.values.paths.outputDirectory) + ' before running its commands.'
        : 'Downloaded the complete reporting plan in ' + format.toUpperCase() + ' format.');
    }));
  }
  $('receive').addEventListener('click', () => perform(async () => {
    const plan = await preparedPlan();
    if (!plan) throw new Error('Preview the reporting procedure before creating its operating plan.');
    await persist();
    await receive(copy(plan));
    preparation.received = true;
    changed({ invalidate: false });
    await persist();
    dialog.close();
    onStatus('Opened the complete Grant reporting operating plan. Record work in its existing steps and save revisions as the report progresses.');
    document.getElementById('plan-heading')?.scrollIntoView({ block: 'start' });
    document.getElementById('plan-editor')?.focus();
  }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && dirty) persist().catch(error);
  });
  window.addEventListener('beforeunload', event => {
    if (dirty || writes || busy) { event.preventDefault(); event.returnValue = ''; }
  });
  updateControls();
  return { open: () => trigger.click(), flush: persist };
}
