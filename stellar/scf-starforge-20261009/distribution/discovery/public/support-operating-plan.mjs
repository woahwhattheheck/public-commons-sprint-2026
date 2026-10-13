// MIT. Support procedures use the existing OperatingPlan editor and retained source adapter.
import {
  SUPPORT_OPERATING_PHASES, createSupportOperatingPlan, inspectSupportOperatingSource, recordSupportOperatingResult,
} from '/support-operating-core/support-operating-plan.mjs';
import { inspectOperatingPlan, shellArgument } from '/operating-plan-core.mjs';

const LIMIT = 32 * 1024 * 1024;
const PHASE_LABELS = new Map([
  ['sources', 'Retain original sources'],
  ['authority', 'Review authority and scope'],
  ['observation', 'Review original observations'],
  ['response', 'Perform the selected response'],
  ['recovery', 'Verify recovery and continuation'],
  ['case', 'Retain the customer case'],
  ['handover', 'Receive the complete handover'],
]);
const PHASES = SUPPORT_OPERATING_PHASES.map(code => [code, PHASE_LABELS.get(code) ?? code]);
const copy = value => JSON.parse(JSON.stringify(value));
const serial = value => JSON.stringify(value);
const text = (tag, value, className) => {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = value;
  if (className) element.className = className;
  return element;
};
const requireValue = (condition, message) => { if (!condition) throw new TypeError(message); };
function parseJSON(value, name) {
  requireValue(new Blob([value]).size <= LIMIT, name + ' exceeds the 32 MiB limit.');
  let result;
  try { result = JSON.parse(value); } catch { throw new TypeError(name + ' must be complete JSON.'); }
  requireValue(result && typeof result === 'object' && !Array.isArray(result), name + ' must be a JSON object.');
  return result;
}
function argumentsFor(value, name) {
  let result;
  try { result = JSON.parse(value); } catch { throw new TypeError(name + ' needs a JSON argument array.'); }
  requireValue(Array.isArray(result) && result.length <= 256 &&
    result.every(part => typeof part === 'string' && part.length <= 32000 && !part.includes('\u0000')),
  name + ' needs at most 256 string arguments without NUL.');
  return result;
}
function button(label, action) {
  const element = text('button', label); element.type = 'button';
  element.addEventListener('click', action); return element;
}
function field(parent, id, label, {type = 'text', value = '', rows, maximum = 1000, required = false} = {}) {
  const group = text('div', undefined, rows ? 'support-wide' : undefined);
  const caption = text('label', label); caption.htmlFor = id;
  const input = text(rows ? 'textarea' : 'input'); input.id = id;
  if (rows) { input.rows = rows; input.spellcheck = false; }
  else input.type = type;
  input.value = value; input.maxLength = maximum; input.required = required;
  group.append(caption, input); parent.append(group); return input;
}
function select(parent, id, label, options) {
  const group = text('div'), caption = text('label', label), input = text('select');
  caption.htmlFor = id; input.id = id;
  for (const [value, title] of options) { const option = text('option', title); option.value = value; input.append(option); }
  group.append(caption, input); parent.append(group); return input;
}
function details(parent, label) {
  const area = text('details'), pre = text('pre');
  area.append(text('summary', label), pre); parent.append(area); return pre;
}
function download(value, filename, type = 'application/json') {
  const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  const url = URL.createObjectURL(new Blob([body], {type}));
  const link = text('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function renderPlanPreview(parent, plan) {
  const selected = inspectOperatingPlan(plan), revision = selected.revisions.at(-1);
  parent.replaceChildren(text('h3', revision.title),
    text('p', selected.id + ' · revision ' + revision.revision + ' · ' + revision.savedAt, 'hint'),
    text('p', [revision.customer, revision.owner, revision.period].filter(Boolean).join(' · ')),
    text('p', revision.purpose));
  const list = text('ol', undefined, 'support-preview-steps');
  for (const step of revision.steps) {
    const item = text('li');
    item.append(text('h4', step.title), text('p', step.instruction),
      text('p', 'Owner: ' + (step.owner || 'Not entered') + ' · recorded status: ' + step.status),
      text('p', 'Expected result: ' + step.expectedResult));
    if (step.inputs) item.append(text('p', 'Inputs: ' + step.inputs));
    item.append(text('p', step.selection ? 'Retained registration: ' + step.selection.item.id : 'Manual operating step'));
    if (step.argv.length) item.append(text('pre', step.argv.map(shellArgument).join(' ')));
    if (step.recordedResult) item.append(text('pre', step.recordedResult));
    list.append(item);
  }
  parent.append(list);
  details(parent, 'Complete original plan and saved history').textContent = JSON.stringify(selected, null, 2);
}

/**
 * Mounts in the original editor. All saved-plan writes remain with its supplied
 * addPlan/receivePlan transactions; this controller has no store or executor.
 */
export function mountSupportOperatingPlan({
  host, getCatalog, getPlan, run, addPlan, receivePlan, retainWorkingDraft,
}) {
  requireValue(host && typeof host.append === 'function', 'The Support procedure host is required.');
  for (const [name, method] of Object.entries({getCatalog, getPlan, run, addPlan, receivePlan, retainWorkingDraft}))
    requireValue(typeof method === 'function', 'Missing original editor callback: ' + name);

  host.classList.add('support-procedure');
  const disclosure = text('details'), heading = text('summary', 'Prepare a Support operating procedure');
  disclosure.append(heading);
  const intro = text('p', 'Review the retained case and source descriptor, select the original toolkit registrations, and save an ordered customer procedure. Perform its work in the original Support workspace.');
  const notice = text('p', '', 'support-notice'); notice.role = 'status'; notice.setAttribute('aria-live', 'polite');
  const error = text('p', '', 'support-error'); error.role = 'alert'; error.hidden = true;
  disclosure.append(intro, notice, error); host.append(disclosure);
  let createPreview = null, resultPreview = null, catalogKey = '', activePlanKey = '';
  const registrations = new Map(), argumentsInputs = new Map();

  const invoke = action => run(async () => {
    error.hidden = true; error.textContent = '';
    try { return await action(); }
    catch (failure) { error.textContent = (failure.code ? failure.code + ': ' : '') + failure.message; error.hidden = false; throw failure; }
  });
  const invalidateCreate = () => {
    createPreview = null; createApply.disabled = true;
    createOutput.replaceChildren();
  };
  const invalidateResult = () => {
    resultPreview = null; resultApply.disabled = true;
    resultOutput.replaceChildren();
  };
  const invalidateAll = () => { invalidateCreate(); invalidateResult(); };
  const sourceSection = text('section', undefined, 'support-section');
  sourceSection.append(text('h3', '1. Review the original source'));
  const sourceInput = field(sourceSection, 'support-source-json', 'Compact Support source descriptor · JSON',
    {rows: 7, maximum: LIMIT, required: true});
  const sourceActions = text('div', undefined, 'actions');
  const sourceFile = text('input'); sourceFile.type = 'file'; sourceFile.accept = '.json,application/json'; sourceFile.hidden = true;
  const sourceIdentity = text('p', 'Choose a compact descriptor produced by the original Support source exporter.', 'hint');
  const validatedSource = details(sourceSection, 'Validated source descriptor');
  const loadSource = button('Choose source JSON', () => { sourceFile.value = ''; sourceFile.click(); });
  const inspectSource = button('Review source', () => invoke(() => {
    const descriptor = inspectSupportOperatingSource(parseJSON(sourceInput.value, 'Source descriptor'));
    validatedSource.textContent = JSON.stringify(descriptor, null, 2);
    refreshEvidence();
    notice.textContent = 'The compact source is valid. Review its original identities and retained references before preparing the procedure.';
  }));
  const saveSource = button('Download entered source', () => invoke(() => {
    inspectSupportOperatingSource(parseJSON(sourceInput.value, 'Source descriptor'));
    download(sourceInput.value, 'support-operating-source.json');
  }));
  sourceActions.append(loadSource, inspectSource, saveSource, sourceFile);
  sourceSection.append(sourceActions, sourceIdentity);
  disclosure.append(sourceSection);
  sourceInput.addEventListener('input', () => {
    sourceIdentity.textContent = 'Source text edited. Review this exact descriptor before use.';
    validatedSource.textContent = ''; invalidateAll(); refreshEvidence();
  });
  sourceFile.addEventListener('change', () => invoke(async () => {
    const file = sourceFile.files[0]; if (!file) return;
    requireValue(file.size <= LIMIT, 'Choose a source descriptor up to 32 MiB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const raw = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    const descriptor = inspectSupportOperatingSource(parseJSON(raw, 'Source descriptor'));
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
    sourceInput.value = raw;
    sourceIdentity.textContent = file.name + ' · ' + bytes.length + ' bytes · SHA-256 ' + digest;
    validatedSource.textContent = JSON.stringify(descriptor, null, 2);
    invalidateAll(); refreshEvidence(); notice.textContent = 'Loaded the selected source descriptor. Its complete source artifacts remain with the original Support operation.';
  }));

  const form = text('section', undefined, 'support-section');
  form.append(text('h3', '2. Prepare the customer procedure'));
  const fields = text('div', undefined, 'support-field-grid');
  const idInput = field(fields, 'support-plan-id', 'Stable plan ID', {value: crypto.randomUUID(), maximum: 128, required: true});
  const titleInput = field(fields, 'support-plan-title', 'Plan title', {value: 'Customer Support procedure', maximum: 300, required: true});
  const customerInput = field(fields, 'support-plan-customer', 'Customer');
  const ownerInput = field(fields, 'support-plan-owner', 'Operating owner', {maximum: 300});
  const periodInput = field(fields, 'support-plan-period', 'Period or recurrence');
  form.append(fields);
  form.append(text('p', 'Each phase may select an actual catalog registration or remain a manual step. Entered arguments stay separate from the retained registration. Creating the plan records every step as planned.', 'hint'));
  const phases = text('div', undefined, 'support-phase-list');
  const highlightedRegistration = new URL(location.href).searchParams.get('supportRegistration');
  for (const [phase, label] of PHASES) {
    const row = text('fieldset', undefined, 'support-phase');
    row.append(text('legend', label));
    const choice = select(row, 'support-registration-' + phase, 'Original toolkit registration',
      [['', 'Manual step · no registration selected']]);
    const argv = field(row, 'support-argv-' + phase, 'Exact command arguments · JSON array', {rows: 2, value: '[]', maximum: LIMIT});
    const command = text('pre', '', 'support-command'); row.append(command);
    const redraw = () => {
      try { command.textContent = argumentsFor(argv.value, label).map(shellArgument).join(' ') || 'No command selected.'; }
      catch (failure) { command.textContent = failure.message; }
    };
    argv.addEventListener('input', () => { redraw(); invalidateCreate(); });
    choice.addEventListener('change', () => { invalidateCreate(); });
    const help = button('Use selected command help', () => invoke(() => {
      const item = getCatalog()?.items?.find(value => value.id === choice.value);
      requireValue(item && Array.isArray(item.helpArgv), 'Select an original registration that declares command help.');
      argv.value = JSON.stringify(item.helpArgv, null, 2); redraw(); invalidateCreate();
      notice.textContent = 'Copied the registration’s maintained help arguments. Review and enter the actual operation before recording work.';
    }));
    row.append(help); registrations.set(phase, choice); argumentsInputs.set(phase, argv); phases.append(row); redraw();
  }
  form.append(phases);
  const createOutput = text('section', undefined, 'support-preview');
  const createApply = button('Create reviewed procedure', () => invoke(async () => {
    requireValue(createPreview, 'Preview the procedure before creating it.');
    requireValue(createPreview.fingerprint === createFingerprint(), 'The inputs or catalog changed. Preview the current selection again.');
    const selected = createPreview;
    await retainWorkingDraft();
    requireValue(selected === createPreview && selected.fingerprint === createFingerprint(), 'The selected preview changed before it could be saved.');
    await addPlan(selected.plan);
    notice.textContent = 'Saved the reviewed Support procedure. Continue its steps and saved history in the original plan editor.';
    createApply.disabled = true;
  }));
  createApply.disabled = true;
  const previewCreate = button('Preview procedure', () => invoke(() => {
    const catalog = getCatalog();
    requireValue(catalog, 'Refresh the original toolkit catalog before preparing a procedure.');
    const source = inspectSupportOperatingSource(parseJSON(sourceInput.value, 'Source descriptor'));
    const registrationMap = {}, argvByPhase = {};
    for (const [phase, label] of PHASES) {
      if (registrations.get(phase).value) registrationMap[phase] = registrations.get(phase).value;
      argvByPhase[phase] = argumentsFor(argumentsInputs.get(phase).value, label);
    }
    const plan = createSupportOperatingPlan({source, catalog: copy(catalog), id: idInput.value,
      title: titleInput.value, customer: customerInput.value, owner: ownerInput.value,
      period: periodInput.value, savedAt: new Date().toISOString(), registrations: registrationMap, argvByPhase});
    createPreview = {plan: inspectOperatingPlan(plan), source, fingerprint: createFingerprint()};
    renderPlanPreview(createOutput, plan); createApply.disabled = false;
    notice.textContent = 'Review all seven phases, original registrations and arguments. This preview has not been saved or executed.';
  }));
  const createActions = text('div', undefined, 'actions');
  createActions.append(previewCreate, createApply,
    button('Download reviewed plan', () => invoke(() => {
      requireValue(createPreview && createPreview.fingerprint === createFingerprint(), 'Preview the current procedure first.');
      download(createPreview.plan, 'support-operating-plan-' + createPreview.plan.id + '.json');
    })));
  form.append(createActions, createOutput); disclosure.append(form);
  for (const element of [idInput, titleInput, customerInput, ownerInput, periodInput]) element.addEventListener('input', invalidateCreate);
  function createFingerprint() {
    return serial({source: sourceInput.value, catalog: getCatalog(), id: idInput.value,
      title: titleInput.value, customer: customerInput.value, owner: ownerInput.value, period: periodInput.value,
      registrations: [...registrations].map(([key, control]) => [key, control.value]),
      argv: [...argumentsInputs].map(([key, control]) => [key, control.value])});
  }

  const resultSection = text('section', undefined, 'support-section');
  resultSection.append(text('h3', '3. Record a reviewed original result'),
    text('p', 'Open the saved Support plan, choose its exact step, and review the compact returned result with the same original source descriptor. A recorded plan status describes the operator’s work; it does not launch or authorize a Support action.', 'hint'));
  const selectedPlan = text('p', 'Open a saved Support procedure to record a result.', 'hint');
  resultSection.append(selectedPlan);
  const resultFields = text('div', undefined, 'support-field-grid');
  const stepInput = select(resultFields, 'support-result-step', 'Step receiving the result', []);
  const statusInput = select(resultFields, 'support-result-status', 'Recorded work status',
    [['in-progress', 'In progress'], ['completed', 'Completed'], ['skipped', 'Skipped'], ['planned', 'Planned']]);
  const resultOwner = field(resultFields, 'support-result-owner', 'Reviewing operator · leave blank to retain step owner', {maximum: 300});
  const resultInput = field(resultFields, 'support-result-json', 'Returned result descriptor · JSON', {rows: 5, maximum: LIMIT, required: true,
    value: JSON.stringify({summary: '', evidenceIds: []}, null, 2)});
  resultFields.append(text('p', 'Enter a reviewed summary and the exact original evidence IDs: {"summary":"…","evidenceIds":["…"]}. Completed work requires at least one retained returned reference.', 'hint'));
  const evidencePanel = text('div', undefined, 'support-evidence');
  const evidenceTitle = text('h4', 'Original references available in the selected source');
  const evidenceList = text('div'); evidencePanel.append(evidenceTitle, evidenceList);
  resultFields.append(evidencePanel);
  let evidenceKey = '';
  function refreshEvidence() {
    let source;
    try { source = inspectSupportOperatingSource(parseJSON(sourceInput.value, 'Source descriptor')); }
    catch { source = null; }
    const key = serial(source?.evidence ?? null);
    if (key === evidenceKey) return;
    evidenceKey = key; evidenceList.replaceChildren();
    if (!source) { evidenceList.append(text('p', 'Review a valid source descriptor to select its returned references.', 'hint')); return; }
    for (const evidence of source.evidence) {
      const row = text('article', undefined, 'support-evidence-row');
      row.append(text('strong', evidence.id), text('p', evidence.role));
      details(row, 'Original artifact identity').textContent = JSON.stringify(evidence.artifact, null, 2);
      row.append(button('Include this reference', () => invoke(() => {
        const result = parseJSON(resultInput.value, 'Returned result');
        requireValue(typeof result.summary === 'string' && Array.isArray(result.evidenceIds) &&
          result.evidenceIds.every(id => typeof id === 'string'), 'Use a result with summary text and an evidenceIds array.');
        if (!result.evidenceIds.includes(evidence.id)) result.evidenceIds.push(evidence.id);
        resultInput.value = JSON.stringify(result, null, 2); invalidateResult();
        notice.textContent = 'Included original reference ' + evidence.id + '. Review the result before saving.';
      })));
      evidenceList.append(row);
    }
    if (!source.evidence.length) evidenceList.append(text('p', 'This source has no returned evidence references. Completed work cannot be recorded from it.', 'hint'));
  }
  resultSection.append(resultFields);
  const resultOutput = text('section', undefined, 'support-preview');
  const resultApply = button('Save reviewed result revision', () => invoke(async () => {
    requireValue(resultPreview, 'Preview the original result before saving it.');
    requireValue(resultPreview.fingerprint === resultFingerprint(), 'The saved plan, source or result selection changed. Review it again.');
    const selected = resultPreview;
    await retainWorkingDraft();
    requireValue(selected === resultPreview && selected.fingerprint === resultFingerprint(), 'The result selection changed before receiving.');
    await receivePlan(selected.plan);
    notice.textContent = 'Received the result revision through the original complete-history check. Earlier revisions and retained working drafts remain available.';
    resultApply.disabled = true;
  }));
  resultApply.disabled = true;
  const previewResult = button('Review result revision', () => invoke(() => {
    const plan = getPlan(); requireValue(plan, 'Open the original saved Support plan first.');
    const source = inspectSupportOperatingSource(parseJSON(sourceInput.value, 'Source descriptor'));
    const result = parseJSON(resultInput.value, 'Returned result');
    const next = recordSupportOperatingResult(plan, {source, stepId: stepInput.value,
      status: statusInput.value, result, ...(resultOwner.value !== '' ? {owner: resultOwner.value} : {}), savedAt: new Date().toISOString()});
    resultPreview = {plan: inspectOperatingPlan(next), fingerprint: resultFingerprint()};
    renderPlanPreview(resultOutput, next); resultApply.disabled = false;
    notice.textContent = 'Review the returned source references and the proposed saved revision. No plan or native result has been changed.';
  }));
  const resultFile = text('input'); resultFile.type = 'file'; resultFile.accept = '.json,application/json'; resultFile.hidden = true;
  resultFile.addEventListener('change', () => invoke(async () => {
    const file = resultFile.files[0]; if (!file) return;
    requireValue(file.size <= LIMIT, 'Choose a returned result descriptor up to 32 MiB.');
    const raw = new TextDecoder('utf-8', {fatal: true}).decode(await file.arrayBuffer());
    parseJSON(raw, 'Returned result'); resultInput.value = raw; invalidateResult();
    notice.textContent = 'Loaded ' + file.name + '. Review it against the selected original source and saved plan.';
  }));
  const resultActions = text('div', undefined, 'actions');
  resultActions.append(button('Choose returned result JSON', () => { resultFile.value = ''; resultFile.click(); }),
    previewResult, resultApply, button('Download reviewed result plan', () => invoke(() => {
      requireValue(resultPreview && resultPreview.fingerprint === resultFingerprint(), 'Review the current result revision first.');
      download(resultPreview.plan, 'support-operating-plan-' + resultPreview.plan.id + '-result.json');
    })), resultFile);
  resultSection.append(resultActions, resultOutput); disclosure.append(resultSection);
  for (const element of [stepInput, statusInput, resultOwner, resultInput]) element.addEventListener('input', invalidateResult);
  function resultFingerprint() {
    return serial({plan: getPlan(), source: sourceInput.value, step: stepInput.value,
      status: statusInput.value, owner: resultOwner.value, result: resultInput.value});
  }

  const transfer = text('section', undefined, 'support-section');
  transfer.append(text('h3', '4. Reopen and hand over'),
    text('p', 'Use Complete editable JSON in the plan editor to retain every saved revision. Import a returned complete plan with the existing Import complete plan control. Divergent histories stay separate; the original source package and returned native artifacts travel with their own identities.'));
  transfer.append(button('Download current saved plan', () => invoke(() => {
    const plan = getPlan(); requireValue(plan, 'Open a saved plan first.');
    download(inspectOperatingPlan(plan), 'operating-plan-' + plan.id + '.json');
  })));
  disclosure.append(transfer);

  function update() {
    refreshEvidence();
    const catalog = getCatalog(), nextCatalogKey = serial(catalog ?? null);
    if (nextCatalogKey !== catalogKey) {
      catalogKey = nextCatalogKey; invalidateCreate();
      const items = [...(catalog?.items ?? [])].sort((left, right) => left.name.localeCompare(right.name));
      for (const choice of registrations.values()) {
        const retained = choice.value; choice.replaceChildren();
        const manual = text('option', 'Manual step · no registration selected'); manual.value = ''; choice.append(manual);
        for (const item of items) {
          const option = text('option', (item.id === highlightedRegistration ? 'Selected in Command finder · ' : '') + item.id);
          option.value = item.id; choice.append(option);
        }
        if (retained && !items.some(item => item.id === retained)) {
          const absent = text('option', 'Absent from current catalog · ' + retained); absent.value = retained; choice.append(absent);
        }
        choice.value = retained;
      }
    }
    const plan = getPlan(), nextPlanKey = serial(plan ?? null);
    if (nextPlanKey !== activePlanKey) {
      activePlanKey = nextPlanKey; invalidateResult();
      const retained = stepInput.value; stepInput.replaceChildren();
      if (plan) {
        const revision = plan.revisions.at(-1);
        selectedPlan.textContent = revision.title + ' · ' + plan.id + ' · saved revision ' + revision.revision;
        for (const step of revision.steps.filter(value => SUPPORT_OPERATING_PHASES.some(phase => value.id === 'support-' + phase))) { const option = text('option', step.title + ' · ' + step.id); option.value = step.id; stepInput.append(option); }
        if (revision.steps.some(step => step.id === retained)) stepInput.value = retained;
      } else selectedPlan.textContent = 'Open a saved Support procedure to record a result.';
    }
  }
  if (new URL(location.href).searchParams.get('prepare') === 'support') disclosure.open = true;
  update();
  return Object.freeze({update, open() { disclosure.open = true; heading.focus(); }});
}
