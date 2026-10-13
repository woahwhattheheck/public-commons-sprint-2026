// MIT. Catalogue correction editor within the original loopback application.
import { parseCorrectionDocument, correctionTokens } from './dcat-correction-json.mjs';
import { parseDcatJson, stringifyDcatJson } from './dcat-json.mjs';
const memories = new Map(), PAGE = 30;
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (['disabled', 'checked', 'selected', 'readOnly'].includes(key)) node[key] = Boolean(value);
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== undefined && child !== null)
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
const row = (...items) => el('div', { class: 'row' }, ...items);
const card = (...items) => el('section', { class: 'card correction-card' }, ...items);
const note = value => el('p', { class: 'muted' }, value);
const field = (label, control) => el('label', { class: 'grow' }, label, control);
const code = value => el('code', { class: 'break' }, value);
const details = (label, value, open = false) => el('details', { open: open ? '' : null },
  el('summary', {}, label), el('pre', { class: 'migration-value' }, typeof value === 'string' ? value : stringifyDcatJson(value, null, 2)));
function control(memory, key, label, { area = false, ...attrs } = {}) {
  const node = area ? el('textarea', { rows: 4, ...attrs }, memory[key] ?? '') : el('input', { value: memory[key] ?? '', ...attrs });
  node.addEventListener('input', () => { memory[key] = node.value; }); return field(label, node);
}
function choose(entries, value, change) {
  const node = el('select', {}, entries.map(([id, label]) => el('option', { value: id, selected: id === value }, label)));
  node.addEventListener('change', () => change(node.value)); return node;
}
function button(ctx, label, run, disabled = false, primary = false) {
  const node = el('button', { type: 'button', disabled, class: primary ? 'primary' : '' }, label);
  node.addEventListener('click', () => ctx.protect(async () => {
    if (node.disabled || !ctx.current()) return;
    node.disabled = true; try { await run(); } finally { if (node.isConnected) node.disabled = disabled; }
  })); return node;
}
function table(headers, rows) {
  return el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, headers.map(x => el('th', {}, x)))),
    el('tbody', {}, rows.map(values => el('tr', {}, values.map(x => el('td', {}, x)))))));
}
async function api(ctx, path, body, exact = false) {
  const response = await fetch('/api/' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + ctx.token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = exact ? parseDcatJson(new Uint8Array(await response.arrayBuffer())) : await response.json();
  if (!response.ok) throw Object.assign(new Error((result.error ?? response.status) + ': ' + (result.message ?? 'The catalogue correction operation failed.')),
    { responseReceived: true, status: response.status, code: result.error });
  return result;
}
const query = value => new URLSearchParams(Object.entries(value).filter(([, x]) => x !== undefined && x !== null).map(([k, v]) => [k, String(v)])).toString();
function downloadLocal(value, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const a = el('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function memoryFor(state) {
  const key = JSON.stringify([state.directory, state.createdAt, state.catalogOrigin]);
  if (!memories.has(key)) memories.set(key, { selected: '', revisionId: '', pointer: '', offset: 0, query: '',
    sourceChoice: '', label: '', author: '', note: '', op: 'replace', editPath: '', from: '', valueText: '',
    operations: [], queueBase: null, preview: null, attempt: null, failedRequests: [], busy: false, candidateLabel: '', profile: '3.0',
    lastInspectorKey: '', candidateMode: 'candidate' });
  return memories.get(key);
}
function clearPreview(memory) { memory.preview = null; }
function jump(memory, pointer) { correctionTokens(pointer); memory.pointer = pointer; memory.offset = 0; memory.query = ''; memory.lastInspectorKey = ''; }
function editOperation(memory) {
  correctionTokens(memory.editPath);
  const operation = { op: memory.op, path: memory.editPath };
  if (memory.op === 'add' || memory.op === 'replace') {
    parseCorrectionDocument(memory.valueText); operation.valueText = memory.valueText;
  } else if (memory.op === 'move') { correctionTokens(memory.from); operation.from = memory.from; }
  return operation;
}
async function submit(ctx, memory, action, payload, allocated = {}) {
  if (memory.busy || ctx.state.active || memory.attempt) throw new Error('Follow or reconcile the current workspace request before saving another change.');
  const body = { requestId: crypto.randomUUID(), ...payload };
  memory.attempt = { action, body, allocated, previousSelection: memory.selected, previousRevisionId: memory.revisionId }; memory.busy = true;
  try {
    const result = await api(ctx, 'dcat/corrections/' + action, body);
    memory.attempt.response = result; ctx.acceptOperation(result);
    if (result.correctionId) memory.selected = result.correctionId;
    if (result.revisionId && action !== 'materialize') memory.revisionId = result.revisionId;
    memory.busy = false; await ctx.refresh();
  } catch (error) {
    if (memory.attempt?.body.requestId === body.requestId && !memory.attempt.response &&
        error.responseReceived && error.status >= 400 && error.status < 500) {
      memory.attempt.rejected = true; memory.attempt.failure = error.message;
    }
    memory.busy = false;
    if (ctx.current()) { try { await ctx.render(); } catch {} }
    throw error;
  } finally { memory.busy = false; }
}
async function retry(ctx, memory) {
  if (memory.busy || ctx.state.active || !memory.attempt) return;
  memory.busy = true;
  try {
    const result = await api(ctx, 'dcat/corrections/' + memory.attempt.action, memory.attempt.body);
    memory.attempt.response = result; ctx.acceptOperation(result); memory.busy = false; await ctx.refresh();
  } catch (error) {
    const attempt = memory.attempt;
    if (attempt && !attempt.response && error.responseReceived && error.status >= 400 && error.status < 500) {
      attempt.rejected = true; attempt.failure = error.message; memory.busy = false;
      // Reconcile current saved/active state before offering a new edited request.
      try { await ctx.refresh(); }
      catch { if (memory.attempt === attempt) attempt.rejected = false; }
    }
    throw error;
  } finally { memory.busy = false; }
}
function terminalFailure(memory, state) {
  const attempt = memory.attempt;
  if (!attempt) return false;
  if (attempt.rejected) return true;
  const operation = state.operation;
  const operationId = attempt.response?.operationId ?? attempt.response?.id;
  if (operationId && operation?.id === operationId &&
      ['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(operation.state)) {
    attempt.terminal = operation.state; attempt.failure = operation.error?.message ?? operation.error?.code ?? operation.error ?? operation.state;
    return true;
  }
  return false;
}
function returnToEditing(memory, drafts) {
  const attempt = memory.attempt;
  if (!attempt || !(attempt.rejected || attempt.terminal)) throw new Error('Refresh or retry the original request until its outcome is known.');
  memory.failedRequests.push(structuredClone(attempt));
  memory.selected = attempt.previousSelection;
  const selected = drafts.find(row => row.id === memory.selected);
  memory.revisionId = selected?.revisions.some(row => row.id === attempt.previousRevisionId) ? attempt.previousRevisionId : selected?.headRevisionId ?? '';
  memory.preview = null; memory.lastInspectorKey = ''; memory.attempt = null;
}
function completedAttempt(memory, drafts, onMaterialized) {
  const attempt = memory.attempt; if (!attempt) return;
  const id = attempt.body.requestId;
  const draft = drafts.find(item => item.id === (attempt.action === 'create' ? id : attempt.body.correctionId));
  const revision = draft?.revisions.find(item => item.id === id);
  const materialization = draft?.materializations.find(item => item.requestId === id);
  if (attempt.action === 'create' && draft) {
    memory.selected = draft.id; memory.revisionId = draft.headRevisionId; memory.pointer = ''; memory.offset = 0;
    memory.candidateLabel = draft.label + ' · corrected'; memory.profile = draft.source.profile;
  } else if (['save', 'restore'].includes(attempt.action) && revision) {
    memory.revisionId = revision.id; memory.operations = []; memory.queueBase = null; memory.preview = null; memory.lastInspectorKey = '';
  } else if (attempt.action === 'materialize' && materialization) {
    onMaterialized?.(materialization, attempt.allocated.useAs ?? 'candidate'); memory.lastMaterialized = materialization;
  } else return;
  memory.attempt = null;
}
export async function renderDcatCorrections(ctx, { onMaterialized } = {}) {
  const memory = memoryFor(ctx.state), dcat = ctx.state.dcat ?? {}, drafts = dcat.corrections?.drafts ?? [];
  completedAttempt(memory, drafts, onMaterialized);
  const failedAttempt = terminalFailure(memory, ctx.state);
  const busy = Boolean(ctx.state.active || memory.busy || memory.attempt);
  const area = el('div', { class: 'dcat-corrections' });
  area.append(card(el('h3', {}, 'Catalogue corrections'),
    note('Edit a retained source or converted candidate here. Saved revisions keep their original bytes, attributed changes and complete history. Retain a separate candidate when it is ready for the existing migration review.'),
    button(ctx, 'Download correction operating guide', () => ctx.download('dcat/corrections/guide', 'CORRECTION_WORKBENCH.md'))));
  if (memory.attempt) area.append(card(el('h4', {}, 'Follow the saved operation'),
    note('This request keeps its original UUID and payload until the saved result is visible. Refresh the workspace or retry the same request after an interruption.'),
    code(memory.attempt.body.requestId),
    row(button(ctx, 'Refresh operation result', () => ctx.refresh()),
      button(ctx, 'Retry original request', () => retry(ctx, memory), Boolean(ctx.state.active || memory.busy)),
      button(ctx, 'Download original request', () => downloadLocal(memory.attempt.body, 'dcat-correction-request-' + memory.attempt.body.requestId + '.json')),
      failedAttempt ? button(ctx, 'Keep failed request and return to editing', async () => {
        returnToEditing(memory, drafts); await ctx.render();
      }, Boolean(ctx.state.active || memory.busy)) : null),
    failedAttempt ? note('Observed request outcome: ' + String(memory.attempt.failure)) : null));
  if (memory.failedRequests.length) area.append(card(el('h4', {}, 'Retained failed request inputs'),
    note('These original inputs remain available while you correct the draft and save with a new request UUID.'),
    ...memory.failedRequests.map(item => row(code(item.body.requestId), note(String(item.failure ?? item.terminal ?? 'Rejected')),
      button(ctx, 'Download request', () => downloadLocal(item.body, 'dcat-correction-request-' + item.body.requestId + '.json'))))));
  const choices = [
    ...(dcat.catalogs ?? []).map(item => ({ key: 'catalog:' + item.id, kind: 'catalog', id: item.id, sha256: item.sha256,
      label: 'Original · ' + (item.label || item.id), profile: item.profile })),
    ...(dcat.reviews ?? []).filter(item => ['READY', 'NEEDS_CORRECTION'].includes(item.status) && item.candidateSha256)
      .map(item => ({ key: 'candidate:' + item.id, kind: 'candidate', id: item.id, sha256: item.candidateSha256,
        label: 'Review candidate · ' + (item.label || item.id), profile: '3.0' }))
  ];
  if (!choices.some(item => item.key === memory.sourceChoice)) memory.sourceChoice = choices.at(-1)?.key ?? '';
  const selectedSource = choices.find(item => item.key === memory.sourceChoice);
  area.append(card(el('h4', {}, 'Start a saved correction draft'),
    field('Exact retained source', choose(choices.map(item => [item.key, item.label]), memory.sourceChoice, value =>
      ctx.protect(async () => { memory.sourceChoice = value; await ctx.render(); }))),
    selectedSource ? code(selectedSource.sha256) : note('Receive a catalogue or prepare a migration candidate first.'),
    control(memory, 'label', 'Draft label', { maxlength: 512 }),
    row(control(memory, 'author', 'Editor', { maxlength: 160 }), control(memory, 'note', 'Reason for this saved revision', { area: true, maxlength: 8192 })),
    button(ctx, 'Create correction draft', async () => {
      if (!selectedSource) throw new Error('Choose an exact source or candidate.');
      await submit(ctx, memory, 'create', { kind: selectedSource.kind,
        [selectedSource.kind === 'catalog' ? 'catalogId' : 'reviewId']: selectedSource.id,
        expectedSha256: selectedSource.sha256, label: memory.label, author: memory.author, note: memory.note });
    }, busy || !choices.length, true)));
  if (!drafts.length) return area;
  if (!drafts.some(item => item.id === memory.selected) && !memory.attempt) {
    memory.selected = drafts.at(-1).id; memory.revisionId = ''; jump(memory, '');
  }
  const selected = drafts.find(item => item.id === memory.selected);
  area.append(card(field('Saved correction draft', choose(drafts.map(item => [item.id, item.label + ' · ' + item.revisions.length + ' revisions']), memory.selected, value =>
    ctx.protect(async () => {
      if (memory.operations.length || memory.attempt) throw new Error('Save or clear this pending change set before changing drafts.');
      memory.selected = value; memory.revisionId = ''; jump(memory, ''); await ctx.render();
    })))));
  if (!selected) return area;
  let revision = selected.revisions.find(item => item.id === memory.revisionId);
  if (!revision && !memory.attempt) { memory.revisionId = selected.headRevisionId; revision = selected.revisions.at(-1); }
  if (!revision) { area.append(note('The allocated saved revision is being retained by the current workspace operation.')); return area; }
  const head = selected.revisions.at(-1), historical = revision.id !== head.id;
  const guard = { correctionId: selected.id, expectedRevisionId: head.id, expectedDocumentSha256: head.documentSha256 };
  const parameter = { correctionId: selected.id, revisionId: revision.id, pointer: memory.pointer,
    offset: memory.offset, limit: PAGE, query: memory.query };
  let inspected;
  try { inspected = await api(ctx, 'dcat/corrections/' + selected.id + '/inspect?' + query(parameter)); }
  catch (error) {
    if (!ctx.current()) return area;
    area.append(card(note(error.message), button(ctx, 'Open complete document root', async () => { jump(memory, ''); await ctx.render(); })));
    return area;
  }
  if (!ctx.current()) return area;
  const view = inspected.selection, inspectorKey = JSON.stringify([selected.id, revision.id, memory.pointer]);
  if (memory.lastInspectorKey !== inspectorKey) {
    memory.lastInspectorKey = inspectorKey; memory.editPath = view.pointer;
    memory.valueText = view.literalText ?? ''; memory.from = view.pointer; memory.op = 'replace';
  }
  const jumpPath = el('input', { value: memory.pointer, class: 'mono', 'aria-label': 'JSON pointer' });
  const search = el('input', { value: memory.query, placeholder: 'Field, record title or complete JSON value', 'aria-label': 'Find within selected children' });
  area.append(card(el('h4', {}, 'Browse the complete saved revision'),
    field('Revision', choose(selected.revisions.map(item => [item.id, item.createdAt + ' · ' + item.author + ' · ' + item.kind]), revision.id, value =>
      ctx.protect(async () => {
        if (memory.operations.length || memory.attempt) throw new Error('Save or clear this pending change set before selecting another revision.');
        memory.revisionId = value; jump(memory, ''); await ctx.render();
      }))),
    row(code(revision.documentSha256), note(revision.documentBytes.toLocaleString() + ' original bytes')),
    historical ? note('You are viewing an earlier saved revision. Restore it as a new attributed revision to continue from these values.') : null,
    row(field('JSON pointer', jumpPath), button(ctx, 'Open pointer', async () => { jump(memory, jumpPath.value); await ctx.render(); }),
      button(ctx, 'Parent', async () => { jump(memory, view.parentPointer ?? ''); await ctx.render(); }, view.parentPointer === null)),
    row(field('Find children', search), button(ctx, 'Find', async () => { memory.query = search.value; memory.offset = 0; await ctx.render(); })),
    note('Selected type: ' + view.type + ' · ' + view.childCount + ' immediate children · ' + view.total + ' matching rows'),
    table(['Field or record', 'Type', 'Value preview', 'Open'], view.rows.map(item => [
      item.label, item.type, el('pre', { class: 'migration-value' }, item.preview + (item.previewComplete ? '' : ' …')),
      button(ctx, item.pointer || '/', async () => { jump(memory, item.pointer); await ctx.render(); })
    ])),
    row(button(ctx, 'Previous rows', async () => { memory.offset = Math.max(0, memory.offset - PAGE); await ctx.render(); }, !memory.offset),
      button(ctx, 'Next rows', async () => { memory.offset = view.nextOffset; await ctx.render(); }, view.nextOffset === null)),
    view.literalComplete ? details('Complete selected JSON value', view.literalText) :
      note('This selected value exceeds the 4 MiB editor display. Open its children or download the complete saved document.'),
    row(button(ctx, 'Download complete document', () => ctx.download('dcat/corrections/' + selected.id + '/download?' +
      query({ revisionId: revision.id, kind: 'document' }), 'dcat-correction-' + revision.id + '.json')),
      button(ctx, 'Download complete revision and changes', () => ctx.download('dcat/corrections/' + selected.id + '/download?' +
      query({ revisionId: revision.id, kind: 'revision' }), 'dcat-correction-revision-' + revision.id + '.json')))));
  if (selected.source.kind === 'candidate') {
    const retainedFindings = memory.findings?.reviewId === selected.source.id ? memory.findings : null;
    const findingPanel = card(el('h4', {}, 'Findings in the original reviewed candidate'),
      note('These original validator paths refer to the first immutable draft revision. Opening a finding selects that baseline so later array edits cannot silently change the record being inspected.'),
      row(button(ctx, 'Read original candidate findings', async () => {
        const report = await api(ctx, 'dcat/reviews/' + selected.source.id, undefined, true);
        const validation = report.validation?.candidate ?? {};
        const findings = [], seen = new Set();
        for (const group of [validation, ...(validation.records ?? []), ...(validation.catalogs ?? [])]) {
          for (const error of group.errors ?? []) {
            const pointer = typeof error.path === 'string' && (error.path === '' || error.path.startsWith('/')) ? error.path : null;
            const key = JSON.stringify([pointer, error.validator, error.message]);
            if (!seen.has(key)) { seen.add(key); findings.push({ pointer, error, occurrence: group.path ?? null }); }
          }
        }
        memory.findings = { reviewId: selected.source.id, rows: findings, offset: 0 }; await ctx.render();
      }),
      button(ctx, 'Download complete original review', () => ctx.download('dcat/reviews/' + selected.source.id + '/download',
        'dcat-source-review-' + selected.source.id + '.json'))));
    if (retainedFindings) {
      const start = retainedFindings.offset;
      findingPanel.append(note(retainedFindings.rows.length + ' original candidate findings'),
        ...retainedFindings.rows.slice(start, start + PAGE).map(item => el('details', {},
          el('summary', {}, (item.pointer ?? item.error.path ?? 'Original validator finding') + ' · ' + (item.error.message ?? item.error.validator ?? '')),
          details('Complete original finding', item.error),
          item.pointer !== null ? button(ctx, 'Open original source position', async () => {
            if (memory.operations.length || memory.attempt) throw new Error('Save or clear the pending change set before opening the original source position.');
            memory.revisionId = selected.revisions[0].id; jump(memory, item.pointer); await ctx.render();
          }, busy) : null)),
        row(button(ctx, 'Previous findings', async () => { retainedFindings.offset = Math.max(0, start - PAGE); await ctx.render(); }, !start),
          button(ctx, 'Next findings', async () => { retainedFindings.offset = start + PAGE; await ctx.render(); }, start + PAGE >= retainedFindings.rows.length)));
    }
    area.append(findingPanel);
  }
  const editable = !historical && !busy;
  area.append(card(el('h4', {}, 'Compose a typed change set'),
    note('JSON strings use quotes. Numbers, true, false and null keep their own types. Arrays and objects use complete JSON. Unchanged values and numeric spellings retain their original text. Pointer positions are applied in the order below.'),
    field('Edit', choose([['replace', 'Replace value'], ['add', 'Add field or array item'], ['remove', 'Remove value'], ['move', 'Move value or reorder array']], memory.op, value => { memory.op = value; })),
    control(memory, 'editPath', 'Destination JSON pointer', { class: 'mono' }),
    control(memory, 'from', 'Source JSON pointer for move', { class: 'mono' }),
    control(memory, 'valueText', 'Complete JSON literal for add or replace', { area: true, rows: 9, spellcheck: 'false', class: 'mono' }),
    row(button(ctx, 'Add to change set', async () => {
      if (!editable) throw new Error('Use the latest saved revision after its operation completes.');
      if (memory.queueBase && (memory.queueBase.revisionId !== head.id || memory.queueBase.sha256 !== head.documentSha256))
        throw new Error('The saved revision changed. Inspect it and clear or rebuild this draft change set.');
      memory.queueBase = { revisionId: head.id, sha256: head.documentSha256 };
      memory.operations.push(editOperation(memory)); clearPreview(memory); await ctx.render();
    }, !editable),
    button(ctx, 'Download change set', () => downloadLocal({ ...guard, author: memory.author, note: memory.note,
      operations: memory.operations }, 'dcat-correction-changes-' + selected.id + '.json'), !memory.operations.length)),
    table(['Order', 'Operation', 'Destination', 'Source', 'Arrange'], memory.operations.map((item, index) => [
      index + 1, item.op, code(item.path || '(root)'), code(item.from ?? ''),
      row(button(ctx, 'Up', async () => { [memory.operations[index - 1], memory.operations[index]] = [item, memory.operations[index - 1]]; clearPreview(memory); await ctx.render(); }, busy || index === 0),
        button(ctx, 'Down', async () => { [memory.operations[index], memory.operations[index + 1]] = [memory.operations[index + 1], item]; clearPreview(memory); await ctx.render(); }, busy || index === memory.operations.length - 1),
        button(ctx, 'Remove edit', async () => { memory.operations.splice(index, 1); if (!memory.operations.length) memory.queueBase = null; clearPreview(memory); await ctx.render(); }, busy))
    ])),
    row(button(ctx, 'Preview all changes', async () => {
      if (!memory.queueBase || memory.queueBase.revisionId !== head.id) throw new Error('Rebuild the change set against the current saved revision.');
      memory.preview = await api(ctx, 'dcat/corrections/preview', { ...guard, operations: memory.operations }); await ctx.render();
    }, !editable || !memory.operations.length),
      button(ctx, 'Clear change set', async () => { memory.operations = []; memory.queueBase = null; clearPreview(memory); await ctx.render(); }, busy || !memory.operations.length))));
  if (memory.preview) area.append(card(el('h4', {}, 'Complete change preview'),
    note(memory.preview.documentBytes.toLocaleString() + ' resulting bytes'), code(memory.preview.documentSha256),
    ...memory.preview.changes.map((change, index) => details((index + 1) + '. ' + change.op + ' ' + (change.path || '(root)'),
      { ...change, beforeText: change.beforeText, afterText: change.afterText })),
    row(control(memory, 'author', 'Editor for this saved revision', { maxlength: 160 }),
      control(memory, 'note', 'Reason for this saved revision', { area: true, maxlength: 8192 })),
    button(ctx, 'Save attributed revision', () => submit(ctx, memory, 'save', { ...guard,
      expectedResultSha256: memory.preview.documentSha256, author: memory.author, note: memory.note, operations: memory.operations }), !editable, true)));
  area.append(card(el('h4', {}, 'Revision history and restoration'),
    table(['Created', 'Editor', 'Kind', 'Reason', 'Complete document'], selected.revisions.map(item => [
      item.createdAt, item.author, item.kind, item.note, button(ctx, item.documentSha256.slice(0, 16),
        () => ctx.download('dcat/corrections/' + selected.id + '/download?' + query({ revisionId: item.id, kind: 'document' }),
          'dcat-correction-' + item.id + '.json'))
    ])),
    historical ? row(control(memory, 'author', 'Restoring editor', { maxlength: 160 }), control(memory, 'note', 'Restoration reason', { area: true, maxlength: 8192 }),
      button(ctx, 'Restore this earlier version as a new revision', () => submit(ctx, memory, 'restore',
        { ...guard, targetRevisionId: revision.id, author: memory.author, note: memory.note }), busy || Boolean(memory.operations.length))) : null));
  if (!memory.candidateLabel) memory.candidateLabel = selected.label + ' · corrected';
  area.append(card(el('h4', {}, 'Retain a candidate for the existing review'),
    note('This creates a separate complete catalogue document from the selected saved revision. The original migration and optional semantic review determine its findings; release selection stays in the existing review controls.'),
    control(memory, 'candidateLabel', 'Retained document label', { maxlength: 512 }),
    row(field('Document profile', choose([['auto', 'Detect original profile'], ['1.1', 'DCAT-US 1.1'], ['3.0', 'DCAT-US 3.0']], memory.profile, value => { memory.profile = value; })),
      field('Use in migration review', choose([['candidate', 'Corrected candidate beside original source'], ['source', 'Source for a new conversion review']], memory.candidateMode, value => { memory.candidateMode = value; }))),
    row(control(memory, 'author', 'Preparing editor', { maxlength: 160 }), control(memory, 'note', 'Candidate preparation reason', { area: true, maxlength: 8192 })),
    button(ctx, 'Retain selected revision for review', () => submit(ctx, memory, 'materialize', {
      correctionId: selected.id, revisionId: revision.id, expectedDocumentSha256: revision.documentSha256,
      label: memory.candidateLabel, profile: memory.profile, author: memory.author, note: memory.note
    }, { useAs: memory.candidateMode }), busy || Boolean(memory.operations.length), true),
    selected.materializations.length ? table(['Created', 'Editor', 'Retained catalogue', 'Revision', 'Use'], selected.materializations.map(item => [
      item.createdAt, item.author, code(item.catalogId), code(item.revisionId),
      button(ctx, 'Use in migration review', async () => { onMaterialized?.(item, memory.candidateMode); await ctx.render(); }, busy)
    ])) : null));
  return area;
}
