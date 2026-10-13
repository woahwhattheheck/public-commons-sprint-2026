// MIT. Offline recipient interface. Exact and Exchange are the maintained embedded modules.
const { parseCorrectionDocument, inspectCorrectionDocument, applyCorrectionOperations, correctionTokens } = Exact;
const { validateCorrectionProposal, saveCorrectionProposalEdition, correctionExchangeDecode,
  correctionExchangeText, correctionExchangeBytes, correctionExchangeHash, correctionProposalPayload } = Exchange;
const app = document.querySelector('#recipient-app'), notice = document.querySelector('#recipient-notice');
let proposal, checked, database = null, backupAvailable = false, backupProblem = '', pendingBackup = null;
let preview = null, busy = false, dirty = false, backupTimer = null, backupWrites = Promise.resolve();
const pageSize = 30, format = value => JSON.stringify(value, null, 2);
const need = (ok, message) => { if (!ok) throw new Error(message); };
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (['disabled', 'checked', 'selected'].includes(key)) node[key] = Boolean(value);
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined)
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
const row = (...children) => el('div', { class: 'row' }, ...children);
const card = (name, ...children) => el('section', {}, el('h2', {}, name), ...children);
const note = text => el('p', { class: 'muted' }, text);
const code = value => el('code', {}, value);
const label = (text, field) => el('label', { class: 'grow' }, text, field);
const detail = (text, value) => el('details', {}, el('summary', {}, text),
  el('pre', {}, typeof value === 'string' ? value : format(value)));
function table(headers, rows) {
  return el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, headers.map(text => el('th', {}, text)))),
    el('tbody', {}, rows.map(values => el('tr', {}, values.map(value => el('td', {}, value)))))));
}
function message(error) { notice.replaceChildren(el('div', { class: 'error' }, error.message ?? String(error))); }
let actionRunning = false;
async function protect(action) {
  if (actionRunning) return;
  actionRunning = true; app.inert = true; notice.replaceChildren();
  try { await action(); } catch (error) { message(error); }
  finally { actionRunning = false; app.inert = false; }
}
function button(text, action, disabled = false, primary = false) {
  const node = el('button', { type: 'button', disabled, class: primary ? 'primary' : '',
    onclick: () => protect(async () => {
      if (node.disabled) return;
      node.disabled = true; try { await action(); } finally { if (node.isConnected) node.disabled = disabled; }
    }) }, text);
  return node;
}
function input(text, value, change, { area = false, ...attrs } = {}) {
  const field = area ? el('textarea', { rows: 4, ...attrs }, value ?? '') : el('input', { value: value ?? '', ...attrs });
  field.addEventListener('input', () => { change(field.value); changed(); });
  return label(text, field);
}
function select(text, choices, selected, change) {
  const field = el('select', {}, choices.map(([key, title]) => el('option', { value: key, selected: key === selected }, title)));
  field.addEventListener('change', () => protect(() => change(field.value)));
  return label(text, field);
}
const filename = value => String(value).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180) || 'catalogue-file';
function download(raw, name, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([raw], { type }));
  const link = el('a', { href: url, download: filename(name) });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const identity = async raw => ({ bytes: raw.length, sha256: await correctionExchangeHash(raw) });
function backupKey() { return proposal.issue.packageSha256 + '/' + proposal.proposalId; }
function backupRecord(value = proposal) {
  return { schema: 'stellar-forge.dcat-correction-recipient-backup.v1', packageSha256: value.issue.packageSha256,
    proposalId: value.proposalId, createdAt: value.createdAt, editions: value.editions, draft: value.draft,
    savedAt: new Date().toISOString() };
}
function fromBackup(value) {
  need(value?.schema === 'stellar-forge.dcat-correction-recipient-backup.v1' &&
    value.packageSha256 === proposal.issue.packageSha256 && value.proposalId === proposal.proposalId,
    'This local backup belongs to another issued catalogue.');
  return { ...proposal, createdAt: value.createdAt, editions: value.editions, draft: value.draft };
}
async function dbRequest(mode, action) {
  if (!database) return null;
  return await new Promise((resolve, reject) => {
    const transaction = database.transaction('backups', mode), store = transaction.objectStore('backups');
    let request;
    try { request = action(store); } catch (error) { reject(error); return; }
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error ?? new Error('The local backup could not be saved.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('The local backup was interrupted.'));
  });
}
async function backupNow() {
  if (backupTimer) { clearTimeout(backupTimer); backupTimer = null; }
  if (!database || pendingBackup) return;
  const value = structuredClone(backupRecord()), key = backupKey();
  backupWrites = backupWrites.then(() => dbRequest('readwrite', store => store.put(value, key)))
    .then(() => { backupAvailable = true; backupProblem = ''; })
    .catch(error => { backupProblem = error.message; backupAvailable = false; });
  await backupWrites;
}
function changed() {
  dirty = true; preview = null;
  clearTimeout(backupTimer); backupTimer = setTimeout(() => { backupNow(); }, 400);
}
async function openBackup() {
  if (!globalThis.indexedDB) { backupProblem = 'This browser does not offer local backup storage.'; return; }
  try {
    database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('stellar-forge-dcat-correction-recipient', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('backups');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close the other catalogue backup window and reopen this file.'));
    });
    const saved = await dbRequest('readonly', store => store.get(backupKey()));
    if (saved) {
      const candidate = fromBackup(saved);
      await validateCorrectionProposal(candidate);
      if (format({ editions: candidate.editions, draft: candidate.draft }) !==
          format({ editions: proposal.editions, draft: proposal.draft })) pendingBackup = saved;
      else backupAvailable = true;
    }
  } catch (error) { backupProblem = error.message; }
}
function writable() { need(!pendingBackup, 'Choose the file or the retained local backup before changing this proposal.'); need(!busy, 'Finish the current saved edition first.'); }
function view() {
  return proposal.draft.view ??= { pointer: '', offset: 0, query: '', editionId: '' };
}
function selectedDocument() {
  const selected = view().editionId;
  if (selected === 'issued') return { text: checked.text, label: 'Issued original revision', historical: Boolean(proposal.editions.length) };
  if (selected) {
    const item = checked.editions.get(selected);
    need(item, 'Choose an existing saved edition.');
    return { text: item.text, label: item.edition.createdAt + ' · ' + item.edition.author,
      historical: selected !== proposal.editions.at(-1)?.id };
  }
  return { text: checked.currentText, label: 'Latest saved recipient edition', historical: false };
}
async function refresh() { checked = await validateCorrectionProposal(proposal); render(); }
async function jump(pointer) {
  correctionTokens(pointer); const selection = view(); selection.pointer = pointer; selection.offset = 0; selection.query = '';
  const inspected = inspectCorrectionDocument(selectedDocument().text, { pointer });
  proposal.draft.editor = { op: 'replace', path: pointer, from: pointer, valueText: inspected.literalText ?? '' };
  changed(); await backupNow(); render();
}
async function exportJson() {
  await backupNow(); await validateCorrectionProposal(proposal);
  download(format(proposal) + '\n', 'catalogue-correction-return-' + proposal.proposalId + '.json', 'application/json');
  dirty = false;
}
async function exportHtml() {
  await backupNow(); await validateCorrectionProposal(proposal);
  document.querySelector('#dcat-correction-return').textContent = correctionProposalPayload(proposal);
  const clone = document.documentElement.cloneNode(true);
  const portableApp = clone.querySelector('#recipient-app');
  portableApp.replaceChildren();
  // Export runs inside protect(), which temporarily makes the live app inert.
  // The saved document must reopen with its complete editor available.
  portableApp.removeAttribute('inert');
  clone.querySelector('#recipient-notice').replaceChildren();
  download('<!doctype html>\n' + clone.outerHTML + '\n', 'catalogue-correction-return-' + proposal.proposalId + '.html', 'text/html');
  dirty = false;
}
async function readIncoming(file) {
  need(file && file.size <= Exchange.EXCHANGE_LIMITS.packageBytes, 'Choose a complete issued or returned correction JSON/HTML file within the supported size.');
  const value = Exchange.readCorrectionProposalFile(new Uint8Array(await file.arrayBuffer()));
  const result = await validateCorrectionProposal(value);
  need(value.issue.packageSha256 === proposal.issue.packageSha256 && value.proposalId === proposal.proposalId,
    'The selected file belongs to another issued proposal. Open it independently.');
  // Export current work before replacing this tab; the complete local backup is retained.
  await backupNow();
  download(format(proposal) + '\n', 'catalogue-before-open-' + proposal.proposalId + '.json', 'application/json');
  proposal = value; checked = result; pendingBackup = null; preview = null; changed(); await backupNow(); render();
}
function render() {
  const selection = view(), documentValue = selectedDocument(), draft = proposal.draft;
  const blocked = busy || Boolean(pendingBackup), editor = draft.editor ??= { op: 'replace', path: '', from: '', valueText: '' };
  app.replaceChildren();
  app.append(card('Issued catalogue and return',
    el('h3', {}, proposal.issue.label),
    note('Issued by ' + proposal.issue.issuer + ' to ' + proposal.issue.recipient + ' · ' + proposal.issue.createdAt),
    el('p', {}, proposal.issue.note),
    row(code('Issue ' + proposal.issue.id), code('Proposal ' + proposal.proposalId)),
    row(code(proposal.issue.baseline.documentSha256), code(proposal.issue.baseline.revisionSha256)),
    note('Each saved recipient edition retains its exact ordered edits and attribution. The author receives the entire proposal and explicitly reconciles it with the current catalogue.'),
    row(button('Download complete return JSON', exportJson), button('Download complete working HTML', exportHtml, false, true)),
    label('Open another saved edition of this same proposal', el('input', { type: 'file', accept: '.json,.html',
      onchange: event => protect(() => readIncoming(event.target.files[0])) }))));
  if (pendingBackup) app.append(card('Retained local changes',
    note('This browser has a different saved working copy for this exact proposal from ' + pendingBackup.savedAt + '. Both versions remain available.'),
    row(button('Restore saved local changes', async () => {
      const candidate = fromBackup(pendingBackup); checked = await validateCorrectionProposal(candidate);
      proposal = candidate; pendingBackup = null; changed(); await backupNow(); render();
    }, false, true),
    button('Download saved local backup', async () => {
      const candidate = fromBackup(pendingBackup); await validateCorrectionProposal(candidate);
      download(format(candidate) + '\n', 'catalogue-local-backup-' + proposal.proposalId + '.json', 'application/json');
    }),
    button('Continue from this file', async () => {
      const candidate = fromBackup(pendingBackup);
      download(format(candidate) + '\n', 'catalogue-prior-local-backup-' + proposal.proposalId + '.json', 'application/json');
      pendingBackup = null; await backupNow(); render();
    }))));
  app.append(card('Working copy',
    note(backupProblem ? 'Automatic local backup: ' + backupProblem + ' Download the complete working HTML to retain your changes.' :
      backupAvailable ? 'A complete working state is retained in this browser. Download the HTML or JSON to transfer or keep a separate copy.' :
        'The complete source is embedded in this file. Download the working HTML or JSON after editing.'),
    row(input('Recipient editor', draft.author, value => { draft.author = value; }, { maxlength: 160 }),
      input('Reason for the next saved edition', draft.note, value => { draft.note = value; }, { area: true, maxlength: 8192 }))));

  const editions = [['', 'Latest saved recipient edition'], ['issued', 'Issued original revision'],
    ...proposal.editions.map(item => [item.id, item.createdAt + ' · ' + item.author + ' · ' + item.note])];
  const pointerField = el('input', { value: selection.pointer, class: 'mono', 'aria-label': 'JSON pointer' });
  const queryField = el('input', { value: selection.query, 'aria-label': 'Find children', placeholder: 'Field, title or complete JSON value' });
  let inspected;
  try { inspected = inspectCorrectionDocument(documentValue.text, {
    pointer: selection.pointer, offset: selection.offset, limit: pageSize, query: selection.query }); }
  catch (error) {
    app.append(card('Selected value', note(error.message), button('Open complete document root', () => jump(''))));
  }
  if (inspected) app.append(card('Browse the complete catalogue',
    select('Saved edition', editions, selection.editionId, async value => {
      selection.editionId = value; selection.pointer = ''; selection.offset = 0; selection.query = '';
      changed(); await backupNow(); render();
    }),
    note(documentValue.label + (documentValue.historical ? ' · Historical edition; select the latest saved edition to compose changes.' : '')),
    row(label('JSON pointer', pointerField), button('Open pointer', () => jump(pointerField.value)),
      button('Parent', () => jump(inspected.parentPointer ?? ''), inspected.parentPointer === null)),
    row(label('Find children', queryField), button('Find', async () => {
      selection.query = queryField.value; selection.offset = 0; changed(); await backupNow(); render();
    })),
    note('Type: ' + inspected.type + ' · ' + inspected.childCount + ' immediate children · ' + inspected.total + ' matching rows'),
    table(['Field or record', 'Type', 'Value preview', 'Open'], inspected.rows.map(item => [
      item.label, item.type, el('pre', {}, item.preview + (item.previewComplete ? '' : ' …')),
      button(item.pointer || '/', () => jump(item.pointer))
    ])),
    row(button('Previous rows', async () => { selection.offset = Math.max(0, selection.offset - pageSize); changed(); await backupNow(); render(); }, selection.offset === 0),
      button('Next rows', async () => { selection.offset = inspected.nextOffset; changed(); await backupNow(); render(); }, inspected.nextOffset === null)),
    inspected.literalComplete ? detail('Complete selected JSON value', inspected.literalText) :
      note('The selected value exceeds the editor display. Open its children or download the complete document.'),
    button('Download this complete catalogue', () => {
      download(correctionExchangeBytes(documentValue.text), 'catalogue-' + (selection.editionId || proposal.editions.at(-1)?.id || proposal.issue.baseline.revisionId) + '.json', 'application/json');
    })));
  const editable = !blocked && !documentValue.historical;
  app.append(card('Compose exact typed changes',
    note('Enter strings with quotes, numbers with their full original spelling, booleans, null, arrays or objects as complete JSON. Add each operation to the ordered change set. The issued source and saved editions remain intact.'),
    select('Operation', [['replace', 'Replace value'], ['add', 'Add field or array item'],
      ['remove', 'Remove value'], ['move', 'Move value or reorder array']], editor.op, async value => {
        editor.op = value; changed(); await backupNow();
      }),
    input('Destination JSON pointer', editor.path, value => { editor.path = value; }, { class: 'mono' }),
    input('Source JSON pointer for move', editor.from, value => { editor.from = value; }, { class: 'mono' }),
    input('Complete JSON literal for add or replace', editor.valueText, value => { editor.valueText = value; },
      { area: true, rows: 9, spellcheck: 'false', class: 'mono' }),
    button('Add to change set', async () => {
      writable(); need(!documentValue.historical, 'Select the latest saved edition before editing.');
      const operation = { op: editor.op, path: editor.path }; correctionTokens(operation.path);
      if (operation.op === 'move') { correctionTokens(editor.from); operation.from = editor.from; }
      if (['add', 'replace'].includes(operation.op)) {
        parseCorrectionDocument(editor.valueText); operation.valueText = editor.valueText;
      }
      const operations = [...draft.operations, operation];
      applyCorrectionOperations(checked.currentText, operations);
      draft.operations = operations; changed(); await backupNow(); render();
    }, !editable),
    table(['Order', 'Operation', 'Destination', 'Source', 'Arrange'], draft.operations.map((operation, index) => [
      index + 1, operation.op, code(operation.path || '(root)'), code(operation.from ?? ''),
      row(button('Up', async () => { writable(); [draft.operations[index - 1], draft.operations[index]] = [operation, draft.operations[index - 1]];
        changed(); await backupNow(); render(); }, !editable || index === 0),
        button('Down', async () => { writable(); [draft.operations[index], draft.operations[index + 1]] = [draft.operations[index + 1], operation];
          changed(); await backupNow(); render(); }, !editable || index + 1 === draft.operations.length),
        button('Remove edit', async () => { writable(); draft.operations.splice(index, 1); changed(); await backupNow(); render(); }, !editable))
    ])),
    row(button('Preview complete change set', async () => {
      writable();
      const applied = applyCorrectionOperations(checked.currentText, draft.operations), raw = correctionExchangeBytes(applied.text);
      preview = { changes: applied.changes, document: await identity(raw),
        operations: structuredClone(draft.operations), beforeSha256: await correctionExchangeHash(correctionExchangeBytes(checked.currentText)),
        text: applied.text };
      render();
    }, !editable || !draft.operations.length, true),
    button('Download ordered change set', () => download(format({
      issueId: proposal.issue.id, packageSha256: proposal.issue.packageSha256, proposalId: proposal.proposalId,
      precedingEditionId: proposal.editions.at(-1)?.id ?? null, author: draft.author, note: draft.note,
      operations: draft.operations, editor: draft.editor
    }) + '\n', 'catalogue-change-set-' + proposal.proposalId + '.json', 'application/json'), !draft.operations.length),
    button('Clear queued changes', async () => { writable(); draft.operations = []; changed(); await backupNow(); render(); }, !editable || !draft.operations.length))));
  if (preview) app.append(card('Complete change preview',
    note(preview.document.bytes.toLocaleString() + ' resulting bytes'), code(preview.document.sha256),
    ...preview.changes.map((change, index) => detail((index + 1) + '. ' + change.op + ' ' + (change.path || '(root)'), change)),
    row(button('Download full preview and resulting document', () => download(format(preview) + '\n',
      'catalogue-preview-' + proposal.proposalId + '.json', 'application/json')),
    button('Save attributed recipient edition', async () => {
      writable(); need(preview && format(preview.operations) === format(draft.operations),
        'Preview the current ordered changes before saving.');
      need(draft.author.trim() && draft.note.trim(), 'Enter the recipient editor and reason for this saved edition.');
      busy = true;
      try {
        const updated = await saveCorrectionProposalEdition(proposal, {
          id: crypto.randomUUID(), createdAt: new Date().toISOString(), author: draft.author,
          note: draft.note, operations: draft.operations });
        proposal = updated; preview = null; dirty = true; await backupNow(); await refresh();
      } finally { busy = false; render(); }
    }, !editable, true))));
  app.append(card('Saved recipient history',
    note(proposal.editions.length + ' attributed saved editions. Unfinished work is retained separately in the complete return file.'),
    table(['Created', 'Editor', 'Reason', 'Document', 'Complete edition'], proposal.editions.map(item => [
      item.createdAt, item.author, item.note, code(item.documentSha256),
      row(button('Open saved edition', async () => { selection.editionId = item.id; selection.pointer = ''; selection.offset = 0; selection.query = ''; changed(); await backupNow(); render(); }),
        button('Download saved document', () => download(correctionExchangeBytes(checked.editions.get(item.id).text),
          'catalogue-' + item.id + '.json', 'application/json')),
        button('Download full attributed edition', () => download(format(item) + '\n', 'catalogue-edition-' + item.id + '.json', 'application/json')))
    ])),
    detail('Complete original correction history', proposal.issue.history),
    detail('Original issue and document binding', { id: proposal.issue.id, packageSha256: proposal.issue.packageSha256,
      baseline: proposal.issue.baseline, issuer: proposal.issue.issuer, recipient: proposal.issue.recipient,
      createdAt: proposal.issue.createdAt, note: proposal.issue.note })));
  app.append(card('Every original file',
    note(proposal.issue.files.length + ' complete retained files are embedded in this working document. Identical bodies share one stored copy while every name and identity remains available.'),
    table(['Original file', 'Role', 'Bytes', 'SHA-256', 'Download'], proposal.issue.files.map(file => [
      file.name, file.role, file.bytes.toLocaleString(), code(file.sha256),
      button('Download complete file', () => download(checked.files.get(file.key).raw, file.name,
        file.name.endsWith('.json') ? 'application/json' : 'application/octet-stream'))
    ]))));
}
window.addEventListener('beforeunload', event => {
  if (dirty) { event.preventDefault(); event.returnValue = ''; }
});
async function start() {
  const payload = document.querySelector('#dcat-correction-return').textContent.trim();
  proposal = JSON.parse(correctionExchangeText(correctionExchangeDecode(payload)));
  checked = await validateCorrectionProposal(proposal);
  need(globalThis.crypto?.randomUUID, 'Open this complete file in a current browser with local cryptography support.');
  await openBackup(); render();
}
start().catch(error => { app.replaceChildren(card('Open the complete original file', note(
  'The saved catalogue could not be opened. Its complete original payload remains in this file.'))); message(error); });
