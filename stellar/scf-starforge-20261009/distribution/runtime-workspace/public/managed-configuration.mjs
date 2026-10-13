// MIT. Original managed configuration editor with complete per-file recovery.
import { configurationDrafts, configurationDifference } from './managed-configuration-drafts.mjs';
const el = (tag, value, className) => { const node = document.createElement(tag); if (value !== undefined) node.textContent = value; if (className) node.className = className; return node; };
const query = (path, values) => path + '?' + new URLSearchParams(Object.entries(values).filter(([, value]) => value !== null && value !== undefined));
function download(name, parts, type = 'application/json') {
  const url = URL.createObjectURL(new Blob(parts, { type })), a = el('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function createManagedConfigurationDesk({ element, api, message, error }) {
  if (!document.querySelector('link[data-managed-configuration-style]')) {
    const sheet = el('link'); sheet.rel = 'stylesheet'; sheet.href = new URL('./managed-configuration.css', import.meta.url).href;
    sheet.dataset.managedConfigurationStyle = 'true'; document.head.append(sheet);
  }
  element.classList.add('managed-config-desk');
  element.innerHTML = '<h3>Configuration files and editions</h3><p>Each file keeps its own entered draft. Saving retains complete original and changed bytes in this Runtime workspace before updating the managed home.</p>' +
    '<div class="actions"><button data-act="files" type="button">Refresh files</button><button data-act="draft-export" type="button">Download entered drafts</button></div>' +
    '<label>Current configuration files<select data-field="files"><option value="">Choose a file</option></select></label>' +
    '<label>Entered files in this window<select data-field="drafts"><option value="">Choose a retained draft</option></select></label>' +
    '<form data-form="open"><label>Relative file path<input data-field="path" required autocomplete="off" placeholder="merchant-01/seller.json"></label><button type="submit">Open file or retained draft</button></form>' +
    '<section data-field="editor" hidden><p data-field="identity" class="note"></p><p data-field="pending" role="status"></p>' +
    '<label>Complete UTF-8 contents<textarea data-field="content" rows="14" spellcheck="false"></textarea></label>' +
    '<div class="actions"><button data-act="save" type="button">Save reviewed configuration</button><button data-act="recover" type="button">Continue original request</button><button data-act="compare" type="button">Compare with current file</button><button data-act="recover-native" type="button">Recover original worker</button><button data-act="rebase-failed" type="button">Keep failed request and review current file</button><button data-act="discard" type="button">Discard entered draft and open current file</button></div>' +
    '<div data-field="comparison"></div><div class="actions"><button data-act="history" type="button">Read saved editions</button><button data-act="export" type="button">Download complete file history</button></div>' +
    '<div data-field="history"></div><button data-act="more" type="button" hidden>Read more editions</button><div data-field="edition"></div></section>';
  const q = name => element.querySelector('[data-field="' + name + '"]');
  const button = name => element.querySelector('[data-act="' + name + '"]');
  let workspaceId = null, homeId = null, drafts = null, selected = null, epoch = 0, fileEpoch = 0;
  let historyEpoch = 0, cursor = null, restoring = null, busy = false;
  const capture = () => ({ epoch, fileEpoch, workspaceId, homeId, path: selected?.path, drafts });
  const current = value => value.epoch === epoch && value.fileEpoch === fileEpoch &&
    value.workspaceId === workspaceId && value.homeId === homeId && value.path === selected?.path;
  function write(value) { drafts.write(value); selected = value; renderDrafts(); return value; }
  function renderDrafts() {
    const values = drafts?.list() ?? [], prior = q('drafts').value;
    q('drafts').replaceChildren(new Option('Choose a retained draft', ''),
      ...values.map(value => new Option(value.path + (value.pending ? ' · retained request' : ' · entered draft'), value.path)));
    if (values.some(value => value.path === prior)) q('drafts').value = prior;
  }
  function state() {
    q('editor').hidden = !selected;
    q('content').disabled = busy || Boolean(selected?.pending);
    button('save').disabled = busy || !selected || Boolean(selected.pending);
    button('recover').disabled = busy || !selected?.pending;
    button('recover-native').disabled = busy || !selected?.pending;
    button('rebase-failed').disabled = busy || !selected?.pending;
    button('discard').disabled = busy || Boolean(selected?.pending);
    if (!selected) return;
    q('path').value = selected.path; q('content').value = selected.content;
    q('identity').textContent = selected.path + ' · reviewed ' + (selected.base.sha256 ?? 'file absent');
    q('pending').textContent = selected.pending ? 'Original request ' + selected.pending.request.requestId +
      ' is retained. Continue it to read its actual native outcome.' : '';
  }
  function changedScope() {
    epoch++; fileEpoch++; historyEpoch++; selected = null; restoring = null; cursor = null; busy = false;
    q('content').disabled = false; q('comparison').replaceChildren(); q('history').replaceChildren(); q('edition').replaceChildren();
    button('more').hidden = true; state();
  }
  function initial(value) {
    return { schema: 'stellar-forge.managed-configuration-draft.v1', workspaceId, homeId, path: value.path,
      base: value, content: value.content, pending: null };
  }
  async function openFile(path, fresh = false) {
    const scope = { epoch, workspaceId, homeId }, sequence = ++fileEpoch;
    busy = false; selected = null; state();
    historyEpoch++; restoring = null; cursor = null;
    q('comparison').replaceChildren(); q('history').replaceChildren(); q('edition').replaceChildren(); button('more').hidden = true;
    const held = !fresh && drafts.read(path);
    if (held) { selected = held; state(); return; }
    let value;
    try { value = await api(query('/api/managed/config', { homeId: scope.homeId, path })); }
    catch (error) {
      if (scope.epoch !== epoch || sequence !== fileEpoch || scope.workspaceId !== workspaceId || scope.homeId !== homeId) return;
      throw error;
    }
    if (scope.epoch !== epoch || sequence !== fileEpoch || scope.workspaceId !== workspaceId || scope.homeId !== homeId) return;
    selected = initial(value); state(); renderDrafts();
  }
  function compare(a, b, leftLabel, rightLabel) {
    const container = el('section'), diff = configurationDifference(a.content ?? '', b.content ?? '');
    container.append(el('h4', leftLabel + ' / ' + rightLabel),
      el('p', a.exists === b.exists && diff.equal ? 'The complete bytes shown agree.' :
        'First changed line ' + diff.firstChangedLine + '; ' + diff.removedLines + ' prior and ' + diff.addedLines + ' changed lines in the differing span.'),
      el('p', leftLabel + ': ' + (a.exists ? (a.sha256 ?? 'entered text') : 'file absent') +
        ' · ' + rightLabel + ': ' + (b.exists ? (b.sha256 ?? 'entered text') : 'file absent'), 'note'));
    const grid = el('div', undefined, 'managed-config-comparison');
    for (const [label, value] of [[leftLabel, a], [rightLabel, b]]) {
      const side = el('div'); side.append(el('strong', label), el('pre', value.exists ? value.content ?? 'Original non-UTF-8 bytes are in the full history download.' : 'File absent')); grid.append(side);
    }
    container.append(grid); return container;
  }
  async function currentComparison() {
    const scope = capture(); if (!scope.path) throw new Error('Open a file first.');
    const value = await api(query('/api/managed/config', { homeId: scope.homeId, path: scope.path }));
    if (!current(scope)) return;
    q('comparison').replaceChildren(compare(value, { exists: true, content: selected.content }, 'Current native file', 'Entered draft'));
  }
  async function readHistory(more = false) {
    const scope = capture(), sequence = ++historyEpoch;
    if (!scope.path) throw new Error('Open a file first.');
    const result = await api(query('/api/managed/config-history',
      { homeId: scope.homeId, path: scope.path, cursor: more ? cursor : null, limit: 30 }));
    if (!current(scope) || sequence !== historyEpoch) return;
    if (!more) q('history').replaceChildren();
    if (!result.entries.length && !more) q('history').append(el('p', 'No retained configuration editions for this file yet.'));
    for (const item of result.entries) {
      const row = el('article', undefined, 'operation');
      row.append(el('strong', item.phase + ' · ' + item.capturedAt),
        el('p', item.operationId, 'note'),
        el('p', (item.before.sha256 ?? 'absent') + ' → ' + (item.after.sha256 ?? 'absent'), 'note'));
      const view = el('button', 'Open complete edition'); view.type = 'button';
      view.addEventListener('click', () => run(() => openEdition(item.operationId)));
      row.append(view); q('history').append(row);
    }
    cursor = result.nextCursor; button('more').hidden = !cursor;
  }
  async function openEdition(operationId) {
    const scope = capture(), sequence = ++historyEpoch;
    const [edition, native] = await Promise.all([
      api(query('/api/managed/config-history', { homeId: scope.homeId, path: scope.path, operationId })),
      api(query('/api/managed/config', { homeId: scope.homeId, path: scope.path }))]);
    if (!current(scope) || sequence !== historyEpoch) return;
    restoring = { edition, native };
    const target = q('edition'); target.replaceChildren(el('h4', 'Complete original edition ' + operationId),
      compare(edition.intent.before, edition.intent.after, 'Before this operation', 'After this operation'));
    if (!edition.intent.priorContentKnown) target.append(el('p', 'The earlier requested bytes were unavailable when this legacy operation was recovered. The captured current bytes remain retained.'));
    for (const version of ['before', 'after']) {
      const value = edition.intent[version], enabled = (version !== 'before' || edition.intent.priorContentKnown) && (!value.exists || value.content !== null);
      const action = el('button', 'Restore ' + version + (value.exists ? ' bytes' : ' file absence'));
      action.type = 'button'; action.disabled = !enabled;
      action.addEventListener('click', () => run(() => restoreVersion(version)));
      target.append(action);
    }
    target.append(el('p', 'Restoration compares against the native file observed when this edition was opened. It creates a new ordinary managed operation and another complete before/after edition.', 'note'));
  }
  async function applyPending() {
    if (!selected?.pending) throw new Error('No retained request for this file.');
    const scope = capture(), held = selected, pending = held.pending;
    busy = true; state();
    try {
      let accepted;
      try { accepted = await api('/api/operation', pending.request); }
      catch (value) {
        if (current(scope)) {
          const saved = scope.drafts.read(scope.path);
          if (saved?.pending?.request.requestId === pending.request.requestId)
            write({ ...saved, pending: { ...saved.pending, dispatchError: {
              status: value.status ?? null, code: value.code ?? null, message: value.message } } });
        }
        throw value;
      }
      // Keep the original request until its actual worker outcome is known.
      const status = await api(query('/api/operation-status', { operationId: accepted.operationId }));
      if (!current(scope)) return;
      if (status.phase === 'SUCCEEDED') {
        const native = await api(query('/api/managed/config', { homeId: scope.homeId, path: scope.path }));
        if (!current(scope)) return;
        const saved = scope.drafts.read(scope.path);
        if (saved?.pending?.request.requestId !== pending.request.requestId) throw new Error('This file has a different retained request.');
        // Accepted request and every later entered byte remain distinct.
        if (saved.content === pending.submittedContent) {
          scope.drafts.remove(scope.path, saved); selected = initial(native);
        } else selected = write({ ...saved, pending: null });
        renderDrafts(); message('Original configuration operation completed; full before/after bytes are retained.');
        await readHistory();
      } else {
        q('pending').textContent = 'Original request ' + pending.request.requestId + ' · ' + (status.displayPhase ?? status.phase) +
          (status.error ? ' · ' + status.error.message : '') + '. Reopen its operation outcome or continue the same request.';
      }
    } finally { if (current(scope)) { busy = false; state(); } }
  }
  async function submit(operation) {
    if (!selected) throw new Error('Open a file first.');
    if (selected.pending) throw new Error('Continue the original retained request for this file first.');
    const request = { requestId: crypto.randomUUID(), homeId, path: selected.path, ...operation };
    write({ ...selected, pending: { request, submittedContent: selected.content } });
    await applyPending();
  }
  async function restoreVersion(version) {
    if (!restoring || !selected) throw new Error('Open a retained edition first.');
    if (selected.content !== selected.base.content || selected.pending)
      throw new Error('Save or explicitly discard this file’s entered draft before restoring a retained edition.');
    await submit({ operation: 'managed-config-restore', expectedSha256: restoring.native.sha256,
      historyOperationId: restoring.edition.intent.operationId, version });
  }
  async function exportHistory() {
    const scope = capture(); if (!scope.path) throw new Error('Open a file first.');
    const selection = await api(query('/api/managed/config-history',
      { homeId: scope.homeId, path: scope.path, selection: 'all' }));
    const parts = [JSON.stringify({ schema: 'stellar-forge.managed-configuration-export.v1',
      homeId: scope.homeId, path: scope.path, selection }) + '\n'];
    let count = 0;
    for (const row of selection.entries) {
      const value = await api(query('/api/managed/config-history',
        { homeId: scope.homeId, path: scope.path, operationId: row.operationId }));
      if (value.intentSha256 !== row.intentSha256) throw new Error('A selected original configuration edition changed.');
      parts.push(JSON.stringify(value) + '\n'); count++;
    }
    parts.push(JSON.stringify({ schema: 'stellar-forge.managed-configuration-export-complete.v1',
      homeId: scope.homeId, path: scope.path, editions: count }) + '\n');
    download('configuration-' + scope.homeId + '-' + scope.path.replace(/[^A-Za-z0-9._-]/g, '_') + '.jsonl', parts, 'application/x-ndjson');
    if (current(scope)) message('Downloaded all ' + count + ' retained editions with complete original bytes.');
  }
  async function run(work, changesSelection = false) {
    const scope = { epoch, fileEpoch, workspaceId, homeId };
    try { await work(); }
    catch (value) {
      if (scope.epoch === epoch && (changesSelection || scope.fileEpoch === fileEpoch) && scope.workspaceId === workspaceId && scope.homeId === homeId) error(value);
    }
  }
  element.querySelector('[data-form="open"]').addEventListener('submit', event => {
    event.preventDefault(); run(() => openFile(q('path').value.trim()), true);
  });
  q('files').addEventListener('change', () => { if (q('files').value) run(() => openFile(q('files').value), true); });
  q('drafts').addEventListener('change', () => { if (q('drafts').value) run(() => openFile(q('drafts').value), true); });
  q('content').addEventListener('input', () => {
    try { if (selected && !selected.pending) write({ ...selected, content: q('content').value }); }
    catch (value) { error(value); }
  });
  button('files').addEventListener('click', () => run(async () => {
    const scope = { epoch, workspaceId, homeId }, value = await api(query('/api/managed/config', { homeId }));
    if (scope.epoch !== epoch || scope.workspaceId !== workspaceId || scope.homeId !== homeId) return;
    q('files').replaceChildren(new Option('Choose a file', ''),
      ...value.files.map(file => new Option(file.path + ' · ' + file.bytes + ' B' + (file.editable ? '' : ' · native editor'), file.path)));
  }));
  button('save').addEventListener('click', () => run(() => submit({ operation: 'managed-config-save',
    expectedSha256: selected.base.sha256, content: selected.content })));
  button('recover').addEventListener('click', () => run(applyPending));
  button('recover-native').addEventListener('click', () => run(async () => {
    const scope = capture(), pending = selected?.pending;
    if (!pending) throw new Error('No retained request for this file.');
    await api('/api/managed/recover', { operationId: pending.request.requestId });
    if (current(scope)) await applyPending();
  }));
  button('rebase-failed').addEventListener('click', () => run(async () => {
    const scope = capture(), held = selected, pending = held?.pending;
    if (!pending) throw new Error('No retained request for this file.');
    let status;
    if (pending.dispatchError?.status >= 400 && pending.dispatchError.status < 500) {
      const currentWorkspace = await api('/api/state');
      if (!current(scope)) return;
      if (currentWorkspace.workspaceId === scope.workspaceId &&
          !currentWorkspace.operations.some(value => value.id === pending.request.requestId))
        status = { phase: 'NOT_ADMITTED', error: pending.dispatchError };
    }
    status ??= await api(query('/api/operation-status', { operationId: pending.request.requestId }));
    if (!current(scope)) return;
    if (status.phase !== 'NOT_ADMITTED' && (status.phase !== 'FAILED' || status.workerActive !== false ||
        status.commandActive === true || status.observation?.status === 'UNAVAILABLE'))
      throw new Error('Read the original failed, inactive operation or confirm its rejected admission before reviewing a replacement.');
    const native = await api(query('/api/managed/config', { homeId: scope.homeId, path: scope.path }));
    if (!current(scope)) return;
    write({ ...held, base: native, pending: null,
      previousRequests: [...(held.previousRequests ?? []), { ...pending, outcome: status }] });
    restoring = null; state();
    q('comparison').replaceChildren(compare(native, { exists: true, content: selected.content },
      'Current native file', 'Retained entered draft'));
  }));
  button('compare').addEventListener('click', () => run(currentComparison));
  button('history').addEventListener('click', () => run(() => readHistory()));
  button('more').addEventListener('click', () => run(() => readHistory(true)));
  button('export').addEventListener('click', () => run(exportHistory));
  button('discard').addEventListener('click', () => run(async () => {
    if (!selected || selected.pending) throw new Error('Continue this file’s retained request first.');
    const held = drafts.read(selected.path); if (held) drafts.remove(selected.path, held);
    await openFile(selected.path, true);
  }));
  button('draft-export').addEventListener('click', () => run(() => {
    download('configuration-entered-files-' + homeId + '.json', [JSON.stringify({
      schema: 'stellar-forge.managed-configuration-entered-files.v1', workspaceId, homeId, files: drafts.list() }, null, 2) + '\n']);
  }));
  return {
    select(value) {
      if (workspaceId === value.workspaceId && homeId === value.homeId) return;
      changedScope(); workspaceId = value.workspaceId; homeId = value.homeId;
      drafts = workspaceId && homeId ? configurationDrafts(sessionStorage, workspaceId, homeId) : null;
      if (drafts) { drafts.migrate(); renderDrafts(); }
      q('files').replaceChildren(new Option('Choose a file', '')); q('path').value = '';
    },
    reset() { changedScope(); workspaceId = homeId = null; drafts = null; }
  };
}
