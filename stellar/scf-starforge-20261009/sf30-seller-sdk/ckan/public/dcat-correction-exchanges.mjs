// MIT. Recipient issue, full returned proposal and explicit author reconciliation.
const memories = new Map();
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (['disabled', 'selected'].includes(key)) node[key] = Boolean(value);
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined)
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
const row = (...items) => el('div', { class: 'row' }, ...items);
const card = (name, ...items) => el('section', { class: 'card' }, el('h4', {}, name), ...items);
const note = text => el('p', { class: 'muted' }, text);
const code = value => el('code', { class: 'break' }, value);
const field = (name, control) => el('label', { class: 'grow' }, name, control);
const detail = (name, value) => el('details', {}, el('summary', {}, name),
  el('pre', { class: 'migration-value' }, typeof value === 'string' ? value : JSON.stringify(value, null, 2)));
function input(memory, key, name, area = false, max = 512) {
  const node = area ? el('textarea', { rows: 4, maxlength: max }, memory[key] ?? '') :
    el('input', { value: memory[key] ?? '', maxlength: max });
  node.addEventListener('input', () => { memory[key] = node.value; }); return field(name, node);
}
function select(name, items, value, change) {
  const node = el('select', {}, items.map(([id, label]) => el('option', { value: id, selected: id === value }, label)));
  node.addEventListener('change', () => change(node.value)); return field(name, node);
}
function button(ctx, name, action, disabled = false, primary = false) {
  const node = el('button', { type: 'button', disabled, class: primary ? 'primary' : '' }, name);
  node.addEventListener('click', () => ctx.protect(async () => {
    if (node.disabled || !ctx.current()) return;
    node.disabled = true; try { await action(); } finally { if (node.isConnected) node.disabled = disabled; }
  })); return node;
}
function table(headers, rows) {
  return el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, headers.map(x => el('th', {}, x)))),
    el('tbody', {}, rows.map(values => el('tr', {}, values.map(x => el('td', {}, x)))))));
}
function localDownload(value, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const a = el('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const parameters = values => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined && value !== null)).toString();
const path = selection => 'dcat/exchanges/download?' + parameters(selection);
async function api(ctx, route, value) {
  const response = await fetch('/api/dcat/exchanges/' + route, { method: value === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + ctx.token, ...(value === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.message ?? result.error ?? 'The catalogue proposal request failed.'),
    { status: response.status, responseReceived: true, code: result.error });
  return result;
}
function memory(ctx, correction) {
  const key = JSON.stringify([ctx.state.directory, ctx.state.createdAt, correction.id]);
  if (!memories.has(key)) memories.set(key, { label: correction.label + ' · recipient corrections', issuer: '', recipient: '',
    note: '', author: '', decisionNote: '', issueId: '', proposalId: '', editionId: '', offset: 0, choices: new Map(),
    preview: null, selection: '', file: null, fileIdentity: null, attempt: null, failed: [], busy: false });
  return memories.get(key);
}
function selectedRequest(memory, correction) {
  return { proposalId: memory.proposalId, editionId: memory.editionId,
    expectedRevisionId: correction.headRevisionId, expectedDocumentSha256: correction.revisions.at(-1).documentSha256,
    choices: [...memory.choices].map(([path, choice]) => ({ path, choice })) };
}
async function refreshPreview(ctx, memory, correction, offset = memory.offset) {
  const request = selectedRequest(memory, correction), sequence = (memory.previewSequence ?? 0) + 1;
  const selection = JSON.stringify([request.proposalId, request.editionId, request.expectedRevisionId, request.expectedDocumentSha256]);
  memory.previewSequence = sequence; memory.previewBusy = true; memory.preview = null;
  try {
    const result = await api(ctx, 'preview', { ...request, offset, limit: 30 });
    const currentChoices = [...memory.choices].map(([path, choice]) => ({ path, choice }));
    if (sequence !== memory.previewSequence || selection !== memory.selection ||
        JSON.stringify(request.choices) !== JSON.stringify(currentChoices)) return;
    memory.preview = result; memory.previewRequest = request; memory.offset = offset;
  } finally { if (sequence === memory.previewSequence) memory.previewBusy = false; }
}
function completeAttempt(memory, state) {
  const current = state.dcat.corrections.exchanges, attempt = memory.attempt;
  if (!attempt) return;
  const collection = attempt.action === 'issue' ? current.issues : attempt.action === 'receive' ? current.proposals : current.decisions;
  const found = collection.find(row => row.id === attempt.body.requestId);
  if (!found) return;
  if (attempt.action === 'issue') memory.issueId = found.id;
  else if (attempt.action === 'receive') { memory.proposalId = found.id; memory.editionId = ''; memory.choices.clear(); memory.preview = null; }
  else { memory.lastDecision = found; memory.preview = null; memory.choices.clear(); }
  memory.attempt = null;
}
async function dispatch(ctx, memory) {
  const attempt = memory.attempt;
  if (!attempt || memory.busy || ctx.state.active) return;
  memory.busy = true;
  try {
    let response;
    if (attempt.action === 'receive') {
      if (!memory.file || memory.fileIdentity?.sha256 !== attempt.body.expectedSha256 ||
          memory.fileIdentity.bytes !== memory.file.size)
        throw new Error('Select the same complete returned file before retrying its original request.');
      const request = await fetch('/api/dcat/exchanges/receive?' + parameters({ requestId: attempt.body.requestId }), {
        method: 'POST', headers: { authorization: 'Bearer ' + ctx.token, 'content-type': 'application/octet-stream',
          'x-dcat-sha256': attempt.body.expectedSha256 }, body: memory.file });
      response = await request.json();
      if (!request.ok) throw Object.assign(new Error(response.message ?? response.error), { responseReceived: true, status: request.status });
    } else response = await api(ctx, attempt.action, attempt.body);
    attempt.response = response; ctx.acceptOperation(response); memory.busy = false; await ctx.refresh();
  } catch (error) {
    if (!attempt.response && error.responseReceived && error.status >= 400 && error.status < 500) {
      attempt.rejected = true; attempt.failure = error.message; memory.busy = false;
      try { await ctx.refresh(); } catch { if (memory.attempt === attempt) attempt.rejected = false; }
    }
    throw error;
  } finally { memory.busy = false; }
}
async function start(ctx, memory, action, body) {
  if (ctx.state.active || memory.busy || memory.attempt) throw new Error('Finish or reconcile the original workspace request first.');
  memory.attempt = { action, body: { requestId: crypto.randomUUID(), ...body } };
  await dispatch(ctx, memory);
}
export async function renderDcatCorrectionExchanges(ctx, { correction, revision, onOpenRevision } = {}) {
  const m = memory(ctx, correction), exchanges = ctx.state.dcat.corrections.exchanges ??
    { issues: [], proposals: [], decisions: [], pending: [] };
  if (!m.attempt) {
    const pending = exchanges.pending.find(item => item.request && item.correctionId === correction.id &&
      !m.failed.some(failed => failed.body.requestId === item.id) &&
      ![...exchanges.issues, ...exchanges.proposals, ...exchanges.decisions].some(saved => saved.id === item.id));
    if (pending) m.attempt = { action: pending.kind, body: structuredClone(pending.request),
      failure: pending.kind === 'receive' ?
        'This saved receiving request was recovered. Select the same complete file by its recorded SHA-256, then retry the original request.' :
        'This complete unfinished request was recovered from the workspace. Retry its original UUID and input to continue.' };
  }
  completeAttempt(m, { ...ctx.state, dcat: { ...ctx.state.dcat, corrections: { ...ctx.state.dcat.corrections, exchanges } } });
  const operationId = m.attempt?.response?.operationId;
  if (operationId && ctx.state.operation?.id === operationId && ['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(ctx.state.operation.state)) {
    m.attempt.rejected = true; m.attempt.failure = ctx.state.operation.error?.message ?? ctx.state.operation.state;
  }
  if (m.attempt?.action === 'apply' && correction.revisions.some(item => item.id === m.attempt.body.requestId)) {
    m.attempt.rejected = false;
    m.attempt.failure = 'The author revision is saved. Retry this same request to finish its complete adoption decision.';
  }
  const busy = Boolean(ctx.state.active || m.busy || m.attempt), area = el('div', { class: 'dcat-correction-exchanges' });
  area.append(card('Recipient catalogue corrections',
    note('Issue the exact selected saved revision, receive complete attributed recipient edits, and compare them with the current author catalogue. Apply explicit choices through this same correction history.'),
    button(ctx, 'Download recipient and author operating guide', () => ctx.download('dcat/exchanges/guide', 'CORRECTION_EXCHANGES.md'))));
  if (m.attempt) area.append(card('Follow the original proposal operation',
    code(m.attempt.body.requestId), note(m.attempt.failure ?? 'The original request and UUID remain selected until its saved outcome is visible.'),
    row(button(ctx, 'Refresh proposal operation', () => ctx.refresh()),
      button(ctx, 'Retry original proposal request', () => dispatch(ctx, m), Boolean(ctx.state.active || m.busy)),
      button(ctx, 'Download original proposal request', () => localDownload(m.attempt, 'dcat-proposal-request-' + m.attempt.body.requestId + '.json')),
      m.attempt.rejected ? button(ctx, 'Keep failed proposal request and return to editing', async () => {
        m.failed.push(structuredClone(m.attempt)); m.attempt = null; m.preview = null; await ctx.render();
      }, Boolean(ctx.state.active || m.busy)) : null)));
  if (m.failed.length) area.append(card('Retained proposal request inputs', ...m.failed.map(item => row(
    code(item.body.requestId), note(item.failure),
    button(ctx, 'Download retained request', () => localDownload(item, 'dcat-proposal-request-' + item.body.requestId + '.json'))))));
  area.append(card('Issue the selected catalogue revision',
    row(code(revision.id), code(revision.documentSha256)),
    input(m, 'label', 'Issue label'),
    row(input(m, 'issuer', 'Issuing editor', false, 160), input(m, 'recipient', 'Intended recipient', false, 160)),
    input(m, 'note', 'Purpose of the recipient correction request', true, 8192),
    button(ctx, 'Save complete recipient issue', () => start(ctx, m, 'issue', {
      correctionId: correction.id, revisionId: revision.id, expectedDocumentSha256: revision.documentSha256,
      label: m.label, issuer: m.issuer, recipient: m.recipient, note: m.note
    }), busy, true)));
  const issues = exchanges.issues.filter(item => item.correctionId === correction.id);
  if (!issues.some(item => item.id === m.issueId)) m.issueId = issues.at(-1)?.id ?? '';
  if (issues.length) {
    let issued;
    try { issued = await api(ctx, 'issues/' + m.issueId); }
    catch (error) { area.append(card('Selected issued catalogue', note(error.message))); }
    if (!ctx.current()) return area;
    if (issued) area.append(card('Complete issued catalogue and files',
      select('Saved recipient issue', issues.map(item => [item.id, item.label + ' · ' + item.recipient]), m.issueId,
        value => ctx.protect(async () => { m.issueId = value; await ctx.render(); })),
      note(issued.issuer + ' → ' + issued.recipient + ' · ' + issued.createdAt), el('p', {}, issued.note),
      row(code(issued.packageSha256), code(issued.documentSha256)),
      row(button(ctx, 'Download complete recipient working HTML', () => ctx.download(path({ kind: 'recipient', id: issued.id }), 'catalogue-recipient-' + issued.id + '.html')),
        button(ctx, 'Download complete initial proposal JSON', () => ctx.download(path({ kind: 'initial-proposal', id: issued.id }), 'catalogue-recipient-' + issued.id + '.json')),
        button(ctx, 'Download complete issued source package', () => ctx.download(path({ kind: 'issue', id: issued.id }), 'catalogue-issue-' + issued.id + '.json'))),
      detail('Full original revision history and baseline', { baseline: issued.baseline, history: issued.history }),
      table(['Original file', 'Role', 'Bytes', 'SHA-256', 'Download'], issued.files.map(file => [
        file.name, file.role, file.bytes.toLocaleString(), code(file.sha256),
        button(ctx, 'Download original file', () => ctx.download(path({ kind: 'file', id: issued.id, key: file.key }), file.name))
      ]))));
  }
  const upload = el('input', { type: 'file', accept: '.json,.html', disabled: Boolean(ctx.state.active || m.busy) });
  upload.addEventListener('change', () => ctx.protect(async () => {
    const file = upload.files[0]; if (!file) return;
    if (file.size > 268435456) throw new Error('Choose a complete proposal file no larger than 256 MiB.');
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
    m.file = file; m.fileIdentity = { name: file.name, bytes: file.size, sha256 }; await ctx.render();
  }));
  area.append(card('Receive a complete returned proposal',
    field('Returned working HTML or JSON', upload), m.fileIdentity ? detail('Selected complete file', m.fileIdentity) : null,
    note('The entire returned file, saved recipient editions and unfinished work are retained together. Select a saved edition explicitly for reconciliation.'),
    button(ctx, 'Receive complete proposal', () => start(ctx, m, 'receive', { expectedSha256: m.fileIdentity.sha256 }),
      busy || !m.fileIdentity || !m.file, true)));

  const proposals = exchanges.proposals.filter(item => item.correctionId === correction.id);
  if (!proposals.some(item => item.id === m.proposalId)) m.proposalId = proposals.at(-1)?.id ?? '';
  if (proposals.length) {
    let received;
    try { received = await api(ctx, 'proposals/' + m.proposalId); }
    catch (error) { area.append(card('Selected returned proposal', note(error.message))); }
    if (!ctx.current()) return area;
    if (received) {
      if (!received.editions.some(item => item.id === m.editionId)) m.editionId = received.editions.at(-1)?.id ?? '';
      const selection = JSON.stringify([received.id, m.editionId, correction.headRevisionId, correction.revisions.at(-1).documentSha256]);
      if (selection !== m.selection) { m.selection = selection; m.choices.clear(); m.preview = null; m.offset = 0; }
      area.append(card('Retained recipient editions and unfinished work',
        select('Received proposal', proposals.map(item => [item.id, item.receivedAt + ' · ' + item.senderProposalId]), m.proposalId,
          value => ctx.protect(async () => { m.proposalId = value; m.editionId = ''; await ctx.render(); })),
        row(code(received.sha256), note(received.bytes.toLocaleString() + ' complete original bytes')),
        button(ctx, 'Download complete original returned file', () => ctx.download(path({ kind: 'proposal', id: received.id }),
          'catalogue-return-' + received.id + '.' + received.format)),
        received.editions.length ? select('Saved recipient edition for reconciliation',
          received.editions.map(item => [item.id, item.createdAt + ' · ' + item.author + ' · ' + item.note]), m.editionId,
          value => ctx.protect(async () => { m.editionId = value; await ctx.render(); })) : note('This proposal contains unfinished work and no saved recipient edition yet.'),
        detail('Complete recipient edition history', received.editions),
        detail('Retained unfinished recipient work', received.draft),
        note('Only the selected saved edition enters reconciliation. The full unfinished input remains in the returned file.'),
        button(ctx, 'Compare issued, current and returned catalogue', async () => {
          await refreshPreview(ctx, m, correction, 0); await ctx.render();
        }, busy || !m.editionId, true)));
      if (m.preview) {
        const preview = m.preview;
        area.append(card('Explicit author reconciliation',
          note(preview.arrayPolicy),
          row(code('Issued ' + preview.issuedDocumentSha256), code('Current ' + preview.currentDocumentSha256),
            code('Returned ' + preview.returnedDocumentSha256)),
          note(preview.page.total.toLocaleString() + ' changed paths · ' + preview.conflictCount + ' conflicts · ' +
            preview.unresolvedCount + ' choices remaining'),
          ...preview.rows.map(change => card('Catalogue value ' + (change.path || '(root)'),
            note(change.reason + (change.conflict ? ' · both author and recipient changed this value' : ' · recipient change')),
            detail('Issued original value', change.issued.exists ? change.issued.valueText : '(field absent)'),
            detail('Current author value', change.current.exists ? change.current.valueText : '(field absent)'),
            detail('Returned recipient value', change.returned.exists ? change.returned.valueText : '(field absent)'),
            select('Choice for ' + (change.path || '(root)'),
              [['', change.conflict ? 'Choose a complete value' : 'Use recipient change'],
                ['current', 'Keep current author value'], ['returned', 'Use returned recipient value'], ['issued', 'Restore issued original value']],
              m.choices.get(change.path) ?? '', value => ctx.protect(async () => {
                if (value) m.choices.set(change.path, value); else m.choices.delete(change.path);
                await refreshPreview(ctx, m, correction); await ctx.render();
              })))),
          row(button(ctx, 'Previous comparison paths', async () => {
            await refreshPreview(ctx, m, correction, Math.max(0, m.offset - 30)); await ctx.render();
          }, !m.offset),
          button(ctx, 'Next comparison paths', async () => {
            await refreshPreview(ctx, m, correction, preview.page.nextOffset); await ctx.render();
          }, preview.page.nextOffset === null)),
          row(button(ctx, 'Keep current values for shown conflicts', async () => {
            for (const item of preview.rows) if (item.conflict) m.choices.set(item.path, 'current');
            await refreshPreview(ctx, m, correction); await ctx.render();
          }, busy || !preview.rows.some(item => item.conflict)),
          button(ctx, 'Use returned values for shown conflicts', async () => {
            for (const item of preview.rows) if (item.conflict) m.choices.set(item.path, 'returned');
            await refreshPreview(ctx, m, correction); await ctx.render();
          }, busy || !preview.rows.some(item => item.conflict))),
          preview.complete ? row(code(preview.documentSha256), note(preview.documentBytes.toLocaleString() +
            ' resulting bytes · ' + preview.operationsCount + ' ordered edits')) : note('Choose every conflicting value before saving the author revision.'),
          preview.complete && !preview.saveable ? note('This complete selection exceeds the original 1,000-edit revision limit. Retain the comparison and choose a smaller saved recipient edition.') : null,
          button(ctx, 'Download complete reconciliation and choices', async () => {
            const rows = []; let offset = 0;
            for (;;) {
              const next = await api(ctx, 'preview', { ...m.previewRequest, offset, limit: 200 });
              if (next.previewSha256 !== preview.previewSha256) throw new Error('The author or selected proposal changed. Refresh this complete comparison.');
              rows.push(...next.rows);
              if (next.page.nextOffset === null) break;
              offset = next.page.nextOffset;
            }
            localDownload({ ...preview, rows, page: { offset: 0, total: rows.length, nextOffset: null },
              request: m.previewRequest }, 'catalogue-reconciliation-' + received.id + '.json');
          }),
          row(input(m, 'author', 'Accepting author', false, 160), input(m, 'decisionNote', 'Reason for the author decision', true, 8192)),
          button(ctx, 'Save reconciled author revision', () => {
            if (m.previewBusy || m.preview !== preview ||
                JSON.stringify(m.previewRequest.choices) !== JSON.stringify([...m.choices].map(([path, choice]) => ({ path, choice }))))
              throw new Error('Wait for the complete current choices to be previewed before saving.');
            return start(ctx, m, 'apply', {
              ...m.previewRequest, expectedPreviewSha256: preview.previewSha256,
              author: m.author.trim(), note: m.decisionNote.trim()
            });
          }, busy || !preview.complete || !preview.saveable, true)));
      }
      const decisions = exchanges.decisions.filter(item => item.proposalId === received.id);
      if (decisions.length) area.append(card('Saved author adoption history',
        table(['Created', 'Author', 'Reason', 'Saved revision', 'Complete decision'], decisions.map(item => [
          item.createdAt, item.author, item.note,
          button(ctx, item.revisionId, async () => {
            onOpenRevision?.({ correctionId: item.correctionId, revisionId: item.revisionId }); await ctx.render();
          }, busy),
          button(ctx, 'Download full adoption decision', () => ctx.download(path({ kind: 'decision', id: item.id }),
            'catalogue-adoption-' + item.id + '.json'))
        ]))));
    }
  }
  return area;
}
