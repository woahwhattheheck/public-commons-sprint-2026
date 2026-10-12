// MIT. Retained Coin Metrics editions in the original DuckDB merchant workspace.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = value => JSON.stringify(value, null, 2);
const list = value => Array.isArray(value) ? value : [];
const stamp = value => value ? new Date(value).toLocaleString() : '—';
const integer = value => { if (value === undefined || value === null || value === '') return '—'; try { return BigInt(value).toLocaleString(); } catch { return String(value); } };
const byteLabel = value => integer(value) + ' bytes';
const short = value => value ? String(value).slice(0, 16) : '—';
const attr = (name, value) => ' ' + name + '="' + esc(value) + '"';
const cellText = cell => {
  if (cell === null || cell === undefined) return 'NULL';
  if (typeof cell !== 'object') return String(cell);
  const value = Object.hasOwn(cell, 'value') ? cell.value : cell;
  if (value === null) return 'NULL';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};
const typedCell = cell => '<span class="cloud-cell-value">' + esc(cellText(cell)) + '</span>' +
  (cell && typeof cell === 'object' && cell.type ? '<small class="cloud-cell-type">' + esc(cell.type) + (cell.hex ? ' · ' + esc(cell.hex) : '') + '</small>' : '');
const options = (values, selected, placeholder) => (placeholder === undefined ? '' : '<option value="">' + esc(placeholder) + '</option>') +
  values.map(item => { const value = typeof item === 'string' ? item : item.value, label = typeof item === 'string' ? item : item.label;
    return '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(label) + '</option>'; }).join('');
const empty = text => '<p class="cloud-empty">' + esc(text) + '</p>';
const detail = (title, value, open = false) => '<details' + (open ? ' open' : '') + '><summary>' + esc(title) + '</summary><pre>' + esc(json(value)) + '</pre></details>';
const action = (name, label, data = {}, disabled = false, primary = false) => '<button type="button" data-cloud-action="' + esc(name) + '"' +
  Object.entries(data).map(([key, value]) => attr('data-cloud-' + key, value)).join('') +
  (disabled ? ' disabled data-disabled="true"' : '') + (primary ? ' class="primary"' : '') + '>' + esc(label) + '</button>';
const textField = (name, label, value, extra = '') => '<label>' + esc(label) + '<input data-cloud-bind="' + esc(name) + '" value="' + esc(value) + '" autocomplete="off"' + extra + '></label>';
const textArea = (name, label, value, rows = 3) => '<label>' + esc(label) + '<textarea data-cloud-bind="' + esc(name) + '" rows="' + rows + '" spellcheck="false">' + esc(value) + '</textarea></label>';
const selection = (name, label, values, selected, placeholder) => '<label>' + esc(label) + '<select data-cloud-bind="' + esc(name) + '">' + options(values, selected, placeholder) + '</select></label>';
const table = (headers, rows, caption = '') => '<div class="cloud-table-wrap"><table>' + (caption ? '<caption>' + esc(caption) + '</caption>' : '') +
  '<thead><tr>' + headers.map(h => '<th scope="col">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
  rows.map(row => '<tr>' + row.map(value => '<td>' + value + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
const safeCloudPath = path => {
  const url = new URL(path, location.origin);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/cloud/')) throw new Error('This file is not in the current source workspace.');
  return url.pathname + url.search;
};
const mappingKinds = ['text', 'integer', 'decimal', 'timestamp-ns', 'boolean', 'json'];
const timeUnits = ['iso', 'ns', 'us', 'ms', 's'];

export function mountCloudDelivery(host, { api, download, onSelected, perform, getWorkspace = () => ({}), beforeSelect = async () => {} }) {
  if (!host || typeof api !== 'function') throw new TypeError('A workspace host and its authenticated API are required.');
  let state = null, busy = false, message = '', messageError = false, disposed = false, storageName = '';
  let pending = {}, mutationContext = null;
  const editions = new Map();
  const ui = {
    tab: 'editions', editionId: '', relationId: '', edition: null,
    manifest: null, manifestName: '', sourceFiles: [], fileMatches: [], intake: null, progress: new Map(),
    importPath: '', intakeNote: '', dirtyChoice: 'save', selectedRelations: new Set(), selectedComparison: '', selectNote: '',
    leftEditionId: '', rightEditionId: '', leftRelationId: '', rightRelationId: '', family: '',
    mappings: [], omissions: [], compareNote: '', comparisonId: '', comparison: null, findingsOffset: 0,
    reviewNote: '', reviewDecision: 'accepted', exportEditions: new Set(), exportComparisons: new Set(),
    exportPackage: '', exportNote: '', receivePath: '', archiveFile: null, receiveIntake: null, lastDelivery: null
  };
  const getEdition = id => editions.get(id) ?? state?.editions?.find(item => item.id === id);
  const relations = id => list(getEdition(id)?.inspection?.relations);
  const relation = (id, relationId) => relations(id).find(item => item.id === relationId);
  const fileUrl = (editionId, fileId) => '/api/cloud/file?edition=' + encodeURIComponent(editionId) + '&file=' + encodeURIComponent(fileId);
  const stateRevision = () => {
    if (!state || !Number.isSafeInteger(state.revision)) throw new Error('Refresh the source workspace before changing it.');
    return state.revision;
  };
  const newId = () => 'cloud-' + crypto.randomUUID();
  function rememberPending() {
    if (!storageName) return;
    try { sessionStorage.setItem(storageName, JSON.stringify(pending)); }
    catch { throw new Error('This browser could not retain the exact operation request. Free browser storage before starting this operation.'); }
  }
  function initializeStorage() {
    const workspaceId = getWorkspace()?.workspaceId;
    if (!workspaceId) return;
    const name = 'duckdb-cloud-pending:' + workspaceId;
    if (storageName === name) return;
    storageName = name;
    try {
      const saved = JSON.parse(sessionStorage.getItem(name) ?? '{}');
      pending = Object.fromEntries(Object.entries(saved).filter(([, entry]) =>
        entry && typeof entry.path === 'string' && entry.path.startsWith('/api/cloud/') && entry.payload && typeof entry.kind === 'string'));
    } catch { pending = {}; }
  }
  function acceptState(next) {
    const incoming = next?.cloud ?? next;
    if (!incoming || incoming.schema !== 'stellar-forge.coinmetrics-cloud-workspace.v1') return;
    if (!state || incoming.revision >= state.revision) state = incoming;
    initializeStorage();
    if (ui.editionId && !list(state.editions).some(item => item.id === ui.editionId)) { ui.editionId = ''; ui.edition = null; }
  }
  function notice(text, error = false) { message = text; messageError = error; }
  async function loadEdition(id, force = false) {
    if (!id) return null;
    if (!force && editions.has(id)) return editions.get(id);
    const result = await api('/api/cloud/edition?id=' + encodeURIComponent(id));
    const value = result.edition ? { ...result.edition, uploads: result.uploads ?? result.edition.uploads } : result;
    editions.set(id, value);
    if (ui.editionId === id) ui.edition = value;
    return value;
  }
  async function loadComparison(id, offset = 0) {
    const result = await api('/api/cloud/comparison?id=' + encodeURIComponent(id) + '&offset=' + offset + '&limit=50');
    ui.comparisonId = id;
    ui.comparison = result.comparison ? { ...result.comparison, findings: result.findings ?? result.comparison.findings,
      offset: result.offset ?? result.comparison.offset, nextOffset: result.nextOffset ?? result.comparison.nextOffset,
      total: result.total ?? result.comparison.total } : result;
    ui.findingsOffset = ui.comparison.offset ?? offset;
    ui.reviewNote = ui.comparison.review?.note ?? '';
  }
  async function refreshCloud({ selected = true } = {}) {
    acceptState(await api('/api/cloud/state'));
    if (selected && ui.editionId) await loadEdition(ui.editionId, true);
    if (selected && ui.comparisonId) await loadComparison(ui.comparisonId, ui.findingsOffset);
    paint();
  }
  function operationPayload(extra) { return { operationId: newId(), expectedRevision: stateRevision(), ...extra }; }
  async function submit(kind, path, payload, context = null) {
    if (pending[kind]) throw new Error('The ' + kind + ' request already has an unfinished response. Use its retained Retry control before starting another.');
    const entry = { kind, path: safeCloudPath(path), payload, context, createdAt: new Date().toISOString() };
    pending[kind] = entry;
    try { rememberPending(); }
    catch (error) { delete pending[kind]; throw error; }
    return dispatch(entry);
  }
  async function dispatch(entry) {
    try {
      const result = await api(entry.path, entry.payload);
      delete pending[entry.kind]; rememberPending();
      await applyResult(entry, result);
      return result;
    } catch (error) {
      if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
        delete pending[entry.kind]; rememberPending();
      }
      try { await refreshCloud({ selected: false }); } catch {}
      throw error;
    }
  }
  async function applyResult(entry, result) {
    if (['intake', 'import', 'commit'].includes(entry.kind)) {
      const edition = result.edition ?? result;
      const id = edition.id ?? result.editionId;
      if (id) {
        ui.editionId = id; ui.edition = await loadEdition(id, true);
        ui.intake = { ...ui.edition, uploads: result.uploads ?? ui.edition.uploads };
        ui.selectedRelations = new Set(relations(id).map(item => item.id)); ui.tab = 'editions';
      }
    } else if (['compare', 'review'].includes(entry.kind)) {
      const comparison = result.comparison ?? result;
      const id = comparison.id ?? entry.payload.comparisonId;
      if (id) await loadComparison(id, 0);
      ui.tab = 'compare';
    } else if (entry.kind === 'select') {
      mutationContext = entry.context;
      await onSelected?.(result, entry.context ?? {});
      mutationContext = null;
    } else if (entry.kind === 'export') {
      ui.lastDelivery = result.delivery ?? result; ui.tab = 'handover';
    } else if (entry.kind === 'receive-intake') {
      ui.receiveIntake = result.intake ?? result;
    } else if (entry.kind === 'receive') {
      ui.lastDelivery = result.delivery ?? result;
      ui.receiveIntake = null; ui.tab = 'handover';
    }
    await refreshCloud();
  }
  async function run(label, task) {
    if (busy || disposed) return;
    const work = async () => {
      busy = true; notice(label); paint();
      try { await task(); }
      catch (error) {
        notice(error.message ?? String(error), true);
        throw error;
      } finally { busy = false; paint(); }
    };
    if (perform) return perform(label, work);
    try { await work(); } catch {}
  }
  function coverageView(coverage) {
    if (coverage?.left || coverage?.right) return '<div class="cloud-coverage-pair"><section><h4>Baseline capture</h4>' + coverageView(coverage.left) + '</section><section><h4>Candidate capture</h4>' + coverageView(coverage.right) + '</section></div>';
    if (!coverage) return empty('No capture coverage has been recorded for this edition.');
    const summary = coverage.status ?? coverage.state ?? (coverage.complete === true ? 'Complete captured scope' : coverage.complete === false ? 'Incomplete captured scope' : 'Scope recorded');
    const groups = list(coverage.groups);
    return '<div class="cloud-coverage"><strong>' + esc(summary) + '</strong>' +
      (coverage.kind ? '<span class="cloud-subtle">' + esc(coverage.kind) + '</span>' : '') +
      (coverage.message ? '<p>' + esc(coverage.message) + '</p>' : '') +
      (list(coverage.notes).length ? '<p class="cloud-subtle">' + list(coverage.notes).map(esc).join(' ') + '</p>' : '') +
      (groups.length ? table(['Family / scope', 'Completion', 'Retained listing or query'], groups.map(group => [
        '<span class="cloud-mono">' + esc(group.family ?? group.prefix ?? group.id) + '</span>' + (group.prefix ? '<small>' + esc(group.prefix) + '</small>' : ''),
        esc(group.status ?? group.state ?? (group.complete === true ? 'Complete' : group.complete === false ? 'Incomplete' : 'Recorded')),
        esc(list(group.pages).length ? list(group.pages).join(', ') : group.rows ?? group.reason ?? 'See capture details')
      ])) : '') + detail('Capture details', coverage) + '</div>';
  }
  function pendingView() {
    const entries = Object.values(pending);
    if (!entries.length) return '';
    return '<section class="cloud-pending" aria-label="Unfinished operation responses"><h3>Retained requests</h3><p>These exact requests remain available after interruption. Retry uses the same operation ID and payload.</p>' +
      entries.map(entry => '<div class="cloud-pending-row"><div><strong>' + esc(entry.kind) + '</strong><small>' + esc(stamp(entry.createdAt)) + ' · <span class="cloud-mono">' +
        esc(entry.payload.operationId ?? entry.payload.editionId) + '</span></small></div>' +
        action('retry', 'Retry exact request', { kind: entry.kind }) + detail('Request', entry.payload) + '</div>').join('') + '</section>';
  }
  function inventoryView() {
    const items = list(state?.editions);
    return '<aside class="cloud-panel cloud-inventory"><div class="cloud-heading"><h3>Source editions</h3><span>' + items.length + '</span></div>' +
      items.map(item => '<button type="button" data-cloud-action="open-edition" data-cloud-id="' + esc(item.id) + '"' +
        (item.id === ui.editionId ? ' class="selected" aria-current="true"' : '') + '><strong>' + esc(item.label || item.id) + '</strong>' +
        '<span>' + esc(item.transport) + ' · ' + esc(item.state) + '</span><small>' + esc(stamp(item.capturedAt)) + '</small>' +
        '<small>' + esc(byteLabel(item.bytes)) + ' · ' + esc(Array.isArray(item.files) ? item.files.length : item.files ?? 0) + ' files</small></button>').join('') +
      (!items.length ? empty('Import a captured edition to inspect its actual files and columns.') : '') + '</aside>';
  }
  function sourceFilesView(edition) {
    const manifest = edition.manifest ?? edition;
    const files = list(manifest.files?.length ? manifest.files : edition.files);
    return files.length ? table(['Source file', 'Family / role', 'Size / digest', 'Original object', 'Download'], files.map(file => [
      '<strong class="cloud-mono">' + esc(file.path ?? file.name ?? file.id) + '</strong><small>' + esc(file.format) + ' · ' + esc(file.id) + '</small>',
      esc(file.family ?? '—') + '<small>' + esc(file.role) + '</small>',
      esc(byteLabel(file.bytes)) + '<small class="cloud-mono" title="' + esc(file.sha256) + '">' + esc(short(file.sha256)) + '</small>',
      '<span class="cloud-mono">' + esc(file.origin?.key ?? file.origin?.statementHandle ?? '—') + '</span>' +
        (file.origin?.versionId ? '<small>Version ' + esc(file.origin.versionId) + '</small>' : ''),
      action('download-source', 'File', { edition: edition.id, file: file.id, name: (file.path ?? file.name ?? file.id).split('/').pop() })
    ])) : empty('Source files will appear when intake has been retained.');
  }
  function relationsView(edition) {
    const items = list(edition.inspection?.relations);
    if (!items.length) return empty(edition.state === 'READY' ? 'This edition has no queryable relations.' : 'Native columns will appear after the retained files have been inspected.');
    if (!items.some(item => item.id === ui.relationId)) ui.relationId = items[0].id;
    const current = items.find(item => item.id === ui.relationId);
    return '<div class="cloud-fields">' + selection('relationId', 'Native relation', items.map(item => ({ value: item.id, label: item.name + ' · ' + item.family })), ui.relationId) +
      '<div class="cloud-fact"><span>Actual rows</span><strong>' + esc(integer(current.rows)) + '</strong><small>' + esc(current.format) + ' · ' + list(current.files).length + ' source files</small></div></div>' +
      table(['Column', 'Native type', 'Nullable'], list(current.columns).map(column => [
        '<span class="cloud-mono">' + esc(column.name) + '</span>', '<span class="cloud-mono">' + esc(column.type) + '</span>', column.nullable === true ? 'Yes' : column.nullable === false ? 'No' : 'Unspecified'
      ]), 'Native relation schema') +
      '<h4>Retained sample</h4>' + (list(current.sample).length ? table(['Source row', ...list(current.columns).map(column => column.name)],
        list(current.sample).map(row => [row.fileId ? action('download-source', 'Row ' + row.row + ' · ' + row.fileId, { edition: edition.id, file: row.fileId, name: row.fileId }) : '—',
          ...list(current.columns).map((column, index) => typedCell(Array.isArray(row) ? row[index] : (row.values ?? row)[column.name]))]),
        'At most five actual rows; full files remain downloadable') : empty('This relation contains no sample rows.')) +
      '<p class="cloud-subtle">Integer, decimal and timestamp values are shown as retained text. No browser numeric conversion is applied.</p>';
  }
  function sourceSelectionView(edition) {
    const items = list(edition.inspection?.relations), context = getWorkspace();
    if (edition.state !== 'READY' || !items.length) return '';
    const comparisons = list(state.comparisons).filter(item =>
      item.request?.leftEditionId === edition.id || item.request?.rightEditionId === edition.id);
    return '<details class="cloud-select-source"><summary>Use this edition in the merchant</summary><p>Choose the complete relations to carry into the existing query builder and merchant plan.</p>' +
      '<fieldset><legend>Relations</legend><div class="cloud-checks">' + items.map(item => '<label><input type="checkbox" data-cloud-set="selectedRelations" value="' + esc(item.id) + '"' +
        (ui.selectedRelations.has(item.id) ? ' checked' : '') + '> <span>' + esc(item.name) + '<small>' + esc(integer(item.rows)) + ' rows · ' + esc(item.family) + '</small></span></label>').join('') + '</div></fieldset>' +
      '<div class="cloud-fields">' + selection('selectedComparison', 'Link a comparison review', comparisons.map(item => ({ value: item.id, label: item.id + ' · ' + (item.review?.decision ?? 'unreviewed') })), ui.selectedComparison, 'No linked comparison') +
      (context.merchantDirty ? selection('dirtyChoice', 'Current unsaved merchant edits', [
        { value: 'save', label: 'Save a merchant revision before changing source' },
        { value: 'keep', label: 'Keep browser edits for review against the new source' },
        { value: 'discard', label: 'Reopen the saved merchant draft after changing source' }
      ], ui.dirtyChoice) : '<div class="cloud-fact"><span>Merchant draft</span><strong>Saved edits retained</strong><small>Earlier plans and packages remain in their original history.</small></div>') + '</div>' +
      textArea('selectNote', 'Source selection note', ui.selectNote, 2) +
      '<div class="cloud-toolbar">' + action('select-source', 'Use selected relations', {}, !ui.selectedRelations.size, true) + '</div></details>';
  }
  function editionDetailView() {
    const edition = ui.edition;
    if (!edition) return '<section class="cloud-panel cloud-edition-detail">' + empty('Open an edition to review capture scope, source files, native columns and merchant selection.') + '</section>';
    const status = edition.state;
    return '<section class="cloud-panel cloud-edition-detail"><div class="cloud-heading"><div><h3>' + esc(edition.label ?? edition.id) + '</h3><p class="cloud-mono">' + esc(edition.id) + '</p></div><span class="cloud-badge">' + esc(status) + '</span></div>' +
      '<dl class="cloud-facts"><div><dt>Transport</dt><dd>' + esc(edition.transport) + '</dd></div><div><dt>Captured</dt><dd>' + esc(stamp(edition.capturedAt)) + '</dd></div>' +
      '<div><dt>Source bytes</dt><dd>' + esc(byteLabel(edition.bytes)) + '</dd></div><div><dt>Manifest SHA-256</dt><dd class="cloud-mono">' + esc(edition.manifestSha256 ?? '—') + '</dd></div></dl>' +
      (edition.error ? '<div class="cloud-error"><strong>Inspection needs attention</strong><p>' + esc(typeof edition.error === 'object' ? edition.error.message ?? json(edition.error) : edition.error) + '</p></div>' : '') +
      (['UPLOADING', 'INTERRUPTED', 'FAILED', 'INSPECTING'].includes(status) ? '<div class="cloud-toolbar">' +
        action('resume-edition', 'Resume this edition', { id: edition.id }) +
        action('commit-edition', 'Inspect retained files', { id: edition.id }, status === 'INSPECTING') + '</div>' : '') +
      '<h4>Capture coverage</h4>' + coverageView(edition.coverage) +
      '<details open><summary>Native relations</summary>' + relationsView(edition) + '</details>' +
      '<details><summary>Retained source files</summary>' + sourceFilesView(edition) + '</details>' +
      detail('Original manifest and provenance', edition.manifest ?? edition) + sourceSelectionView(edition) + '</section>';
  }
  function fileMatches(manifest = ui.manifest, files = ui.sourceFiles) {
    return list(manifest?.files).map(declared => {
      const wanted = String(declared.path ?? declared.name ?? '').replaceAll('\\', '/').replace(/^\.\//, '');
      const exact = files.filter(file => {
        const relative = (file.webkitRelativePath || file.name).replaceAll('\\', '/');
        return relative === wanted || relative.slice(relative.indexOf('/') + 1) === wanted;
      });
      let matches = exact;
      if (!matches.length) {
        const name = wanted.split('/').pop();
        const sameDeclared = list(manifest.files).filter(item => String(item.path ?? item.name ?? '').split('/').pop() === name);
        if (sameDeclared.length === 1) matches = files.filter(file => file.name === name);
      }
      const file = matches.length === 1 ? matches[0] : null;
      const upload = list(ui.intake?.uploads).find(item => item.id === declared.id);
      const validSize = file && String(file.size) === String(declared.bytes);
      return { declared, file, upload, state: upload?.present ? 'Retained' : matches.length > 1 ? 'Ambiguous path' : !file ? 'Choose source file' :
        !validSize ? 'Size differs' : 'Ready to upload', valid: Boolean(upload?.present || validSize) };
    });
  }
  function intakeView() {
    const matches = fileMatches(), pendingUploads = matches.filter(item => !item.upload?.present);
    const intake = ui.intake;
    const ready = matches.length > 0 && matches.every(item => item.valid);
    return '<section class="cloud-panel"><div class="cloud-heading"><div><h3>Import a captured edition</h3><p>Open a source manifest with its retained Parquet, catalog, API or Snowflake result files.</p></div>' +
      action('manifest-template', 'Manifest format') + '</div>' +
      '<details><summary>Import an existing local packet</summary><div class="cloud-inline">' + textField('importPath', 'Manifest path on this workspace host', ui.importPath, ' placeholder="/path/to/capture/manifest.json"') +
        action('import-local', 'Import local packet', {}, !ui.importPath.trim()) + '</div></details>' +
      '<details open><summary>Upload a packet from this browser</summary><div class="cloud-fields">' +
      '<label>Source manifest<input type="file" data-cloud-file="manifest" accept=".json,application/json"></label>' +
      '<div><label>Source files<input type="file" data-cloud-file="sources" multiple></label><label class="cloud-folder">Or select their folder<input type="file" data-cloud-file="folder" webkitdirectory multiple></label></div></div>' +
      (ui.manifest ? '<div class="cloud-intake-summary"><strong>' + esc(ui.manifest.label || ui.manifestName) + '</strong><span>' + esc(ui.manifest.transport) +
        ' · ' + matches.length + ' declared files' + (intake ? ' · intake ' + esc(intake.id ?? intake.editionId) : '') + '</span></div>' +
        table(['Declared source', 'Expected size', 'Selected browser file', 'Status'], matches.map(item => [
          '<span class="cloud-mono">' + esc(item.declared.path ?? item.declared.id) + '</span><small>' + esc(item.declared.family ?? item.declared.role) + '</small>',
          esc(byteLabel(item.declared.bytes)),
          '<span class="cloud-mono">' + esc(item.file?.webkitRelativePath || item.file?.name || '—') + '</span>',
          esc(ui.progress.get(item.declared.id) ?? item.state)
        ])) : empty('Choose the manifest first, then select all declared source files. Relative paths and byte sizes are checked before upload.')) +
      '<div class="cloud-toolbar">' + action('upload-edition', intake ? 'Continue uploads and inspect' : 'Retain files and inspect', {}, !ready || !ui.manifest, true) +
      (intake ? action('clear-intake', 'Close this intake view') : '') + '</div>' +
      (matches.length ? '<p class="cloud-subtle">' + pendingUploads.length + ' files still require transfer. Successful files remain in the same intake; source digests are verified by the server.</p>' : '') +
      '</details></section>';
  }
  function editionView() {
    return intakeView() + '<div class="cloud-editions">' + inventoryView() + editionDetailView() + '</div>';
  }
  function relationPicker(side) {
    const editionId = ui[side + 'EditionId'];
    return '<div class="cloud-source-picker"><h4>' + (side === 'left' ? 'Baseline source' : 'Candidate source') + '</h4>' +
      selection(side + 'EditionId', 'Edition', list(state.editions).filter(item => item.state === 'READY').map(item =>
        ({ value: item.id, label: (item.label ?? item.id) + ' · ' + stamp(item.capturedAt) })), editionId, 'Choose an inspected edition') +
      selection(side + 'RelationId', 'Relation', relations(editionId).map(item => ({ value: item.id, label: item.name + ' · ' + item.family })), ui[side + 'RelationId'], 'Choose a native relation') + '</div>';
  }
  function mappingSelect(index, key, label, values, value, placeholder) {
    return '<label class="cloud-visually-compact">' + esc(label) + '<select data-cloud-map="' + index + '" data-cloud-map-field="' + key + '">' + options(values, value, placeholder) + '</select></label>';
  }
  function mappingInput(index, key, label, value) {
    return '<label class="cloud-visually-compact">' + esc(label) + '<input data-cloud-map="' + index + '" data-cloud-map-field="' + key + '" value="' + esc(value ?? '') + '" autocomplete="off"></label>';
  }
  function mappingView() {
    const left = relation(ui.leftEditionId, ui.leftRelationId), right = relation(ui.rightEditionId, ui.rightRelationId);
    const leftNames = list(left?.columns).map(c => ({ value: c.name, label: c.name + ' · ' + c.type }));
    const rightNames = list(right?.columns).map(c => ({ value: c.name, label: c.name + ' · ' + c.type }));
    return '<div class="cloud-heading"><h4>Row keys and compared fields</h4><div class="cloud-toolbar">' +
      action('match-fields', 'Match same-name fields', {}, !left || !right) +
      action('add-mapping', 'Add mapping', {}, !left || !right) + '</div></div>' +
      '<p class="cloud-subtle">Choose at least one stable, unique row key. Matching column names creates field suggestions; key selection stays explicit.</p>' +
      (ui.mappings.length ? '<div class="cloud-mappings">' + ui.mappings.map((mapping, index) =>
        '<fieldset class="cloud-mapping"><legend>Mapping ' + (index + 1) + '</legend><div class="cloud-mapping-main">' +
        mappingSelect(index, 'role', 'Role', [{ value: 'field', label: 'Compared value' }, { value: 'key', label: 'Row key' }], mapping.role) +
        mappingSelect(index, 'left', 'Baseline column', leftNames, mapping.left, 'Choose column') +
        mappingSelect(index, 'right', 'Candidate column', rightNames, mapping.right, 'Choose column') +
        mappingSelect(index, 'kind', 'Comparison type', mappingKinds, mapping.kind) + action('remove-mapping', 'Remove', { index }) + '</div>' +
        (mapping.kind === 'timestamp-ns' ? '<div class="cloud-fields">' + mappingSelect(index, 'leftTimeUnit', 'Baseline time encoding', timeUnits, mapping.leftTimeUnit ?? 'iso') +
          mappingSelect(index, 'rightTimeUnit', 'Candidate time encoding', timeUnits, mapping.rightTimeUnit ?? 'iso') + '</div>' : '') +
        (mapping.role === 'field' && mapping.kind === 'decimal' ? '<div class="cloud-fields">' +
          mappingInput(index, 'absoluteTolerance', 'Absolute tolerance', mapping.absoluteTolerance ?? '0') +
          mappingInput(index, 'relativeTolerance', 'Relative tolerance', mapping.relativeTolerance ?? '0') + '</div>' : '') +
        '</fieldset>').join('') + '</div>' : empty('Select both source relations, then add the columns to compare.')) +
      '<details><summary>Document intentionally absent columns</summary><p>Record the source side and the actual contract reason for each omission.</p>' +
      ui.omissions.map((item, index) => '<div class="cloud-omission"><label>Side<select data-cloud-omission="' + index + '" data-cloud-omission-field="side">' +
        options([{ value: 'left', label: 'Absent from baseline' }, { value: 'right', label: 'Absent from candidate' }], item.side) + '</select></label>' +
        '<label>Column<input data-cloud-omission="' + index + '" data-cloud-omission-field="field" value="' + esc(item.field) + '"></label>' +
        '<label>Contract reason<input data-cloud-omission="' + index + '" data-cloud-omission-field="reason" value="' + esc(item.reason) + '"></label>' +
        action('remove-omission', 'Remove', { index }) + '</div>').join('') +
      action('add-omission', 'Add omission') + '</details>';
  }
  function comparisonRequestView() {
    return '<section class="cloud-panel"><div class="cloud-heading"><div><h3>Compare complete source editions</h3><p>Reconcile retained rows with explicit keys, exact value types and source-linked differences.</p></div></div>' +
      '<div class="cloud-fields">' + relationPicker('left') + relationPicker('right') + '</div>' +
      textField('family', 'Dataset family', ui.family, ' placeholder="market_candles"') + mappingView() +
      textArea('compareNote', 'Comparison purpose and scope', ui.compareNote) +
      '<div class="cloud-toolbar">' + action('compare', 'Run complete comparison', {}, !ui.leftRelationId || !ui.rightRelationId || !ui.mappings.some(item => item.role === 'key'), true) +
      '<span class="cloud-subtle">Tolerances remain exact decimal strings. Duplicate and invalid keys become findings.</span></div></section>';
  }
  function rowsView(rows, editionId, label) {
    return list(rows).map(row => '<details class="cloud-source-row"><summary>' + esc(label) + ' · row ' + esc(row.row) + ' · ' + esc(row.fileId) + '</summary>' +
      '<div class="cloud-toolbar">' + action('download-source', 'Download source file', { edition: editionId, file: row.fileId, name: row.fileId }) + '</div>' +
      table(['Column', 'Retained value'], Object.entries(row.values ?? {}).map(([column, value]) => ['<span class="cloud-mono">' + esc(column) + '</span>', typedCell(value)])) + '</details>').join('');
  }
  function findingView(finding, request) {
    return '<article class="cloud-finding"><header><strong>' + esc(finding.kind) + '</strong><span class="cloud-mono">' + esc(finding.id) + '</span></header>' +
      (finding.error ? '<p class="cloud-error">' + esc(finding.error) + '</p>' : '') +
      (finding.groupSize ? '<p class="cloud-subtle">' + esc(integer(finding.groupSize)) + ' rows share this key.</p>' : '') +
      '<div class="cloud-key"><span>Key</span>' + list(finding.key).map(cell => '<div>' + typedCell(cell) + '</div>').join('') + '</div>' +
      (list(finding.differences).length ? table(['Baseline field', 'Baseline value', 'Candidate field', 'Candidate value', 'Comparison'], finding.differences.map(item => [
        '<span class="cloud-mono">' + esc(item.leftField) + '</span>', typedCell(item.left), '<span class="cloud-mono">' + esc(item.rightField) + '</span>', typedCell(item.right),
        esc(item.kind) + (item.absoluteTolerance != null ? '<small>Absolute ' + esc(item.absoluteTolerance) + ' · relative ' + esc(item.relativeTolerance) + '</small>' : '') + (item.error ? '<small>' + esc(item.error) + '</small>' : '')
      ])) : '') + rowsView(finding.left, request.leftEditionId, 'Baseline source') + rowsView(finding.right, request.rightEditionId, 'Candidate source') + '</article>';
  }
  function schemaChangesView(changes) {
    if (Array.isArray(changes)) return changes.length ? detail('Open schema changes', changes, true) : empty('No schema change was recorded by this comparison.');
    const rows = [
      ...list(changes?.leftOnly).map(column => ['Baseline only', column.name, column.type, '—']),
      ...list(changes?.rightOnly).map(column => ['Candidate only', column.name, '—', column.type]),
      ...list(changes?.changed).map(item => ['Changed definition', item.name, json(item.left), json(item.right)])
    ];
    return rows.length ? table(['Change', 'Column', 'Baseline', 'Candidate'], rows.map(row => row.map(value => '<span class="cloud-mono">' + esc(value) + '</span>'))) :
      empty('No schema change was recorded by this comparison.');
  }
  function comparisonDetailView() {
    const comparison = ui.comparison;
    if (!comparison) return '<section class="cloud-panel">' + empty('Open a retained comparison to inspect its full findings and review history.') + '</section>';
    const counts = comparison.counts ?? {}, request = comparison.request ?? {}, review = comparison.review ?? {};
    return '<section class="cloud-panel"><div class="cloud-heading"><div><h3>Comparison review</h3><p class="cloud-mono">' + esc(comparison.id) + '</p></div>' +
      action('download-report', 'Complete report', { id: comparison.id }) + '</div>' +
      '<div class="cloud-counts">' + [
        ['Baseline rows', counts.leftRows], ['Candidate rows', counts.rightRows], ['Equal unique rows', counts.matched], ['Changed', counts.different],
        ['Baseline only', counts.leftOnly], ['Candidate only', counts.rightOnly], ['Duplicate baseline', counts.duplicateLeft], ['Duplicate candidate', counts.duplicateRight], ['Invalid keys', counts.invalidKeys]
      ].map(([label, value]) => '<div><span>' + esc(label) + '</span><strong>' + esc(integer(value)) + '</strong></div>').join('') + '</div>' +
      '<div class="cloud-fields"><div><h4>Source coverage</h4>' + coverageView(comparison.coverage) + '</div><div><h4>Schema changes</h4>' +
      schemaChangesView(comparison.schemaChanges) + '</div></div>' +
      detail('Reviewed comparison request', request) +
      '<div class="cloud-heading"><h4>Source-linked findings</h4><span>' + esc(integer(comparison.total ?? comparison.findingsCount)) + ' total</span></div>' +
      (list(comparison.findings).length ? list(comparison.findings).map(item => findingView(item, request)).join('') : empty('No findings on this page.')) +
      '<div class="cloud-pagination">' + action('findings-page', 'Previous 50', { offset: Math.max(0, ui.findingsOffset - 50) }, ui.findingsOffset === 0) +
        '<span>' + (list(comparison.findings).length ? esc(integer(ui.findingsOffset + 1)) + '–' + esc(integer(ui.findingsOffset + list(comparison.findings).length)) : '0') +
        ' of ' + esc(integer(comparison.total ?? comparison.findingsCount)) + '</span>' +
        action('findings-page', 'Next 50', { offset: comparison.nextOffset ?? 0 }, comparison.nextOffset === null || comparison.nextOffset === undefined) + '</div>' +
      '<section class="cloud-review"><h4>Review decision</h4><p>Current decision: <strong>' + esc(review.decision ?? 'unreviewed') + '</strong> · revision ' + esc(review.revision ?? 0) +
        (review.reviewedAt ? ' · ' + esc(stamp(review.reviewedAt)) : '') + '</p>' +
      selection('reviewDecision', 'Decision to record', [{ value: 'accepted', label: 'Accept this comparison' }, { value: 'changes-requested', label: 'Request changes' }, { value: 'reopened', label: 'Reopen review' }], ui.reviewDecision) +
      textArea('reviewNote', 'Review findings, exceptions and decision', ui.reviewNote) +
      '<div class="cloud-toolbar">' + action('review', 'Record review decision', {}, !ui.reviewNote.trim()) + '</div>' +
      (list(review.history).length ? table(['Decision', 'Revision', 'Recorded', 'Note'], review.history.map(item =>
        [esc(item.decision), esc(item.revision), esc(stamp(item.reviewedAt ?? item.createdAt)), esc(item.note)])) : '') + '</section></section>';
  }
  function comparisonView() {
    return comparisonRequestView() + '<div class="cloud-editions"><aside class="cloud-panel cloud-inventory"><h3>Retained comparisons</h3>' +
      list(state.comparisons).map(item => '<button type="button" data-cloud-action="open-comparison" data-cloud-id="' + esc(item.id) + '"' +
        (ui.comparisonId === item.id ? ' class="selected"' : '') + '><strong>' + esc(item.request?.family ?? item.family ?? item.id) + '</strong><span>' +
        esc(item.review?.decision ?? 'unreviewed') + ' · ' + esc(integer(item.findingsCount)) + ' findings</span><small class="cloud-mono">' + esc(item.id) + '</small></button>').join('') +
        (!list(state.comparisons).length ? empty('Completed comparisons and their review history appear here.') : '') + '</aside>' + comparisonDetailView() + '</div>';
  }
  function checklist(items, setName, label) {
    return '<fieldset><legend>' + esc(label) + '</legend><div class="cloud-checks">' + items.map(item =>
      '<label><input type="checkbox" data-cloud-set="' + setName + '" value="' + esc(item.id) + '"' + (ui[setName].has(item.id) ? ' checked' : '') + '> <span>' +
      esc(item.label ?? item.request?.family ?? item.id) + '<small class="cloud-mono">' + esc(item.id) + '</small></span></label>').join('') +
      (!items.length ? empty('No retained items available.') : '') + '</div></fieldset>';
  }
  function deliveryView(delivery) {
    if (!delivery) return '';
    return '<div class="cloud-delivery"><div class="cloud-heading"><h4>' + esc(delivery.filename ?? delivery.id ?? 'Received handover') + '</h4>' +
      (delivery.url ? action('download-delivery', 'Download handover', { url: delivery.url, name: delivery.filename ?? 'cloud-handover.zip' }) : '') + '</div>' +
      '<p>' + esc(byteLabel(delivery.bytes)) + '</p><p class="cloud-mono">' + esc(delivery.sha256 ?? '') + '</p>' +
      detail('Handover contents and lineage', delivery.manifest ?? delivery) + '</div>';
  }
  function handoverView() {
    const packages = list(getWorkspace().packages).filter(item => item.state === 'READY');
    return '<div class="cloud-fields cloud-top-align"><section class="cloud-panel"><h3>Prepare a complete private handover</h3>' +
      '<p>Include retained source files, comparison findings, review history and the selected native source. An existing merchant package can travel with the same handover.</p>' +
      checklist(list(state.editions).filter(item => item.state === 'READY'), 'exportEditions', 'Source editions') +
      checklist(list(state.comparisons), 'exportComparisons', 'Comparisons and reviews') +
      selection('exportPackage', 'Existing merchant package', packages.map(item => ({ value: item.id, label: 'Revision ' + item.revision + ' · ' + item.id })), ui.exportPackage, 'Source workspace only') +
      textArea('exportNote', 'Handover scope and receiving notes', ui.exportNote) +
      '<div class="cloud-toolbar">' + action('export', 'Create complete handover', {}, !ui.exportEditions.size, true) + '</div>' +
      '</section><section class="cloud-panel"><h3>Receive a handover</h3><p>Reopen the original source identities, comparisons and review history in this workspace. Choose the merchant source after inspecting the received edition.</p>' +
      '<details open><summary>Upload a complete handover</summary><label>Private handover archive<input type="file" data-cloud-file="archive" accept=".zip,.tar,.gz,.tgz,application/zip,application/gzip"></label>' +
      (ui.archiveFile ? '<p class="cloud-mono">' + esc(ui.archiveFile.name) + '<br>' + esc(byteLabel(ui.archiveFile.size)) + '</p>' : '') +
      (ui.receiveIntake ? detail('Retained archive intake', ui.receiveIntake) : '') +
      '<div class="cloud-toolbar">' + action('receive-upload', ui.receiveIntake ? 'Resume receiving' : 'Upload and receive', {}, !ui.archiveFile, true) + '</div></details>' +
      '<details><summary>Receive an archive on this host</summary>' + textField('receivePath', 'Archive path', ui.receivePath, ' placeholder="/path/to/cloud-handover.zip"') +
      '<div class="cloud-toolbar">' + action('receive-local', 'Receive local archive', {}, !ui.receivePath.trim()) + '</div></details></section></div>' +
      (ui.lastDelivery ? '<section class="cloud-panel"><h3>Latest handover operation</h3>' + deliveryView(ui.lastDelivery) + '</section>' : '') +
      '<section class="cloud-panel"><h3>Retained handovers</h3>' +
      (list(state.deliveries).length ? list(state.deliveries).map(item => '<div class="cloud-delivery-row"><div><strong>' + esc(item.filename ?? item.id) +
        '</strong><small>' + esc(stamp(item.createdAt)) + ' · ' + esc(byteLabel(item.bytes)) + '</small></div>' +
        action('open-delivery', 'Open handover', { id: item.id }) + '</div>').join('') : empty('Completed exports and received handovers appear here.')) + '</section>';
  }
  function contractView() {
    const contracts = state.contracts ?? {};
    return '<section class="cloud-panel"><h3>Coin Metrics cloud source contract</h3><p>Keep capture scope and source semantics alongside each edition.</p>' +
      '<div class="cloud-contract-grid"><section><h4>Daily capture</h4><p>Cloud datasets cover the prior UTC day. Partition dates describe the data date. Keep all objects and continuation receipts for the selected scope.</p></section>' +
      '<section><h4>Catalog versions</h4><p>Reference catalogs overwrite in place and have no daily partition. Each captured catalog remains an immutable edition here.</p></section>' +
      '<section><h4>Native values</h4><p>Parquet can store numbers as native numeric types while API JSON uses strings. Timestamp values can represent UTC epoch nanoseconds. Select units explicitly when mapping epoch columns.</p></section>' +
      '<section><h4>Source access</h4><p>This workspace imports retained, permitted exports. S3 Requester Pays access and Snowflake query compute belong to the source account operator.</p></section></div>' +
      '<h4>Dataset families</h4>' + (list(contracts.families).length ? table(['Family', 'Source contract'], contracts.families.map(item =>
        typeof item === 'string' ? ['<span class="cloud-mono">' + esc(item) + '</span>', list(contracts.catalogFamilies).includes(item) ? 'Catalog overwritten in place' : 'Daily captured scope'] :
          ['<span class="cloud-mono">' + esc(item.id ?? item.family ?? item.name) + '</span>', esc(item.description ?? item.partition ?? '')])) : empty('The installed source adapter supplies the dataset contract.')) +
      detail('Cloud column omissions', contracts.cloudOmissions ?? {}, true) +
      (list(contracts.notes).length ? '<h4>Capture notes</h4><ul>' + contracts.notes.map(note => '<li>' + esc(typeof note === 'string' ? note : json(note)) + '</li>').join('') + '</ul>' : '') +
      '<p class="cloud-links"><a href="https://docs.coinmetrics.io/access-our-data/cloud-delivery" target="_blank" rel="noreferrer">Cloud delivery documentation</a>' +
      '<a href="https://docs.coinmetrics.io/access-our-data/cloud-delivery/amazon-s3" target="_blank" rel="noreferrer">Amazon S3 source contract</a>' +
      '<a href="https://docs.coinmetrics.io/access-our-data/cloud-delivery/snowflake" target="_blank" rel="noreferrer">Snowflake source contract</a></p></section>';
  }
  function paint() {
    if (disposed) return;
    if (!state) { host.innerHTML = '<div class="cloud-panel">' + empty('Source editions will open with the merchant workspace.') + '</div>'; return; }
    const views = { editions: editionView, compare: comparisonView, handover: handoverView, contract: contractView };
    host.innerHTML = '<div class="cloud-heading cloud-title"><div><h2>Cloud source editions</h2><p>Retain, reconcile and hand over complete source data in the original merchant workspace.</p></div>' +
      action('refresh', 'Refresh sources') + '</div><div class="cloud-status-strip"><span>Revision <strong>' + esc(state.revision) + '</strong></span>' +
      '<span>Source editions <strong>' + list(state.editions).length + '</strong></span><span>Comparisons <strong>' + list(state.comparisons).length + '</strong></span>' +
      '<span>Selected source <strong class="cloud-mono">' + esc(state.selection?.editionId ?? 'Original declaration') + '</strong></span></div>' +
      '<div class="cloud-message' + (messageError ? ' cloud-error' : '') + '" role="status" aria-live="polite"' + (!message ? ' hidden' : '') + '>' + esc(message) + '</div>' +
      pendingView() + '<nav class="cloud-tabs" aria-label="Cloud source workflow">' +
      [['editions', 'Editions & source'], ['compare', 'Comparison & review'], ['handover', 'Handover & receiving'], ['contract', 'Source contract']].map(([name, label]) =>
        '<button type="button" data-cloud-action="tab" data-cloud-name="' + name + '"' + (ui.tab === name ? ' aria-current="page"' : '') + '>' + label + '</button>').join('') +
      '</nav><div class="cloud-view">' + (views[ui.tab] ?? editionView)() + '</div>';
    for (const node of host.querySelectorAll('button,input,textarea,select')) node.disabled = busy || node.dataset.disabled === 'true';
  }
  async function uploadSources() {
    if (!ui.manifest) throw new Error('Choose the actual source manifest first.');
    if (!fileMatches().every(item => item.valid)) throw new Error('Select each missing source file with its exact declared path and byte size.');
    if (!ui.intake) await submit('intake', '/api/cloud/intake', operationPayload({ manifest: ui.manifest }));
    const editionId = ui.intake?.id ?? ui.intake?.editionId;
    if (!editionId) throw new Error('The retained intake did not return an edition identity.');
    const full = await loadEdition(editionId, true);
    ui.intake = { ...full, uploads: full.uploads ?? ui.intake.uploads };
    const matches = fileMatches();
    for (const item of matches) {
      if (item.upload?.present) continue;
      if (!item.upload?.url) throw new Error('The workspace did not return an upload URL for ' + item.declared.id + '. Reopen this intake.');
      ui.progress.set(item.declared.id, 'Uploading'); paint();
      try {
        await api(safeCloudPath(item.upload.url), item.file, { method: 'PUT', binary: true });
        item.upload.present = true; ui.progress.set(item.declared.id, 'Retained');
      } catch (error) {
        ui.progress.set(item.declared.id, 'Transfer interrupted; reopen intake to resume');
        try { ui.intake = await loadEdition(editionId, true); } catch {}
        throw error;
      }
      paint();
    }
    await submit('commit', '/api/cloud/commit', { editionId });
    notice('The complete edition is retained and native inspection has finished. Review its coverage and relations below.');
  }
  function comparisonPayload() {
    if (!ui.leftEditionId || !ui.rightEditionId || !ui.leftRelationId || !ui.rightRelationId) throw new Error('Choose both inspected source relations.');
    const keys = [], fields = [], leftNames = new Set(list(relation(ui.leftEditionId, ui.leftRelationId)?.columns).map(c => c.name));
    const rightNames = new Set(list(relation(ui.rightEditionId, ui.rightRelationId)?.columns).map(c => c.name));
    const used = new Set();
    for (const mapping of ui.mappings) {
      if (!leftNames.has(mapping.left) || !rightNames.has(mapping.right)) throw new Error('Every mapping must select an actual column from both relations.');
      const pair = JSON.stringify([mapping.left, mapping.right]);
      if (used.has(pair)) throw new Error('A column pair appears more than once. Keep one explicit role for that pair.');
      used.add(pair);
      const value = { left: mapping.left, right: mapping.right, kind: mapping.kind };
      if (mapping.kind === 'timestamp-ns') {
        value.leftTimeUnit = mapping.leftTimeUnit ?? 'iso'; value.rightTimeUnit = mapping.rightTimeUnit ?? 'iso';
      }
      if (mapping.role === 'key') keys.push(value);
      else {
        if (mapping.kind === 'decimal') {
          value.absoluteTolerance = String(mapping.absoluteTolerance ?? '0').trim();
          value.relativeTolerance = String(mapping.relativeTolerance ?? '0').trim();
          for (const text of [value.absoluteTolerance, value.relativeTolerance]) {
            if (!/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) throw new Error('Comparison tolerances must be nonnegative decimal strings.');
          }
        }
        fields.push(value);
      }
    }
    if (!keys.length) throw new Error('Select the explicit row key before running a comparison.');
    const omissions = ui.omissions.map(item => ({ side: item.side, field: item.field.trim(), reason: item.reason.trim() }));
    if (omissions.some(item => !item.field || !item.reason)) throw new Error('Each intentional omission needs its column and source contract reason.');
    return operationPayload({ leftEditionId: ui.leftEditionId, rightEditionId: ui.rightEditionId,
      leftRelationId: ui.leftRelationId, rightRelationId: ui.rightRelationId, family: ui.family.trim(),
      keys, fields, omissions, note: ui.compareNote.trim() });
  }
  async function receiveUpload() {
    const file = ui.archiveFile;
    if (!file) throw new Error('Select the actual complete handover archive.');
    if (!ui.receiveIntake) {
      notice('Reading the selected archive digest…'); paint();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map(value => value.toString(16).padStart(2, '0')).join('');
      await submit('receive-intake', '/api/cloud/intake', operationPayload({ archive: { name: file.name, bytes: String(file.size), sha256: hash } }));
    }
    const intake = ui.receiveIntake;
    const upload = list(intake.uploads)[0] ?? intake.upload;
    if (!upload?.url) throw new Error('The archive intake did not return its original upload URL.');
    if (upload.name && upload.name !== file.name || upload.bytes && String(upload.bytes) !== String(file.size))
      throw new Error('Choose the same archive retained by this receiving intake.');
    if (!upload.present) await api(safeCloudPath(upload.url), file, { method: 'PUT', binary: true });
    await submit('receive', '/api/cloud/receive', operationPayload({ intakeId: intake.id ?? intake.intakeId }));
    notice('The handover is received. Open its source editions and deliberately select the source for the merchant.');
  }
  const handlers = {
    refresh: async () => { await refreshCloud(); notice('Source editions, review history and handovers refreshed.'); },
    tab: async node => { ui.tab = node.dataset.cloudName; paint(); },
    'open-edition': async node => {
      ui.editionId = node.dataset.cloudId; await loadEdition(ui.editionId, true);
      ui.selectedRelations = new Set(relations(ui.editionId).map(item => item.id)); ui.selectedComparison = '';
      notice('Opened the retained edition and its native source metadata.');
    },
    'resume-edition': async node => {
      const edition = await loadEdition(node.dataset.cloudId, true);
      ui.intake = edition; ui.manifest = edition.manifest; ui.manifestName = edition.label ?? edition.id;
      ui.sourceFiles = []; ui.progress.clear(); ui.tab = 'editions';
      notice('The same intake is open. Choose any source files that have not yet been retained.');
    },
    'commit-edition': async node => { await submit('commit', '/api/cloud/commit', { editionId: node.dataset.cloudId }); notice('Native inspection completed for this retained edition.'); },
    'import-local': async () => { await submit('import', '/api/cloud/import', operationPayload({ manifestPath: ui.importPath.trim() })); notice('Local source packet retained and inspected.'); },
    'upload-edition': uploadSources,
    'clear-intake': async () => { ui.intake = null; ui.manifest = null; ui.manifestName = ''; ui.sourceFiles = []; ui.progress.clear(); notice('Intake view closed. Its retained edition remains in the source inventory.'); },
    'manifest-template': async () => {
      const example = { schema: 'stellar-forge.coinmetrics-cloud-input.v1', label: 'Describe this actual captured scope', transport: 'retained-s3',
        capturedAt: 'REPLACE_WITH_ACTUAL_UTC_CAPTURE_TIME', provenance: { description: '', entitlement: '' },
        scope: { market: '', frequency: '', start: '', end: '' },
        files: [{ id: 'source-file-0001', path: 'REPLACE_WITH_RELATIVE_SOURCE_PATH.parquet', bytes: 'REPLACE_WITH_ACTUAL_BYTE_COUNT',
          sha256: 'REPLACE_WITH_ACTUAL_SHA256', format: 'parquet', role: 'data', family: 'market_candles', origin: { key: '', etag: '', versionId: '' } }],
        coverage: { kind: 'selected-files', groups: [] } };
      await download('coinmetrics-source-manifest-template.json', json(example) + '\n', 'application/json');
      notice('Downloaded the editable manifest format. Fill it from the actual retained capture before importing.');
    },
    'download-source': async node => download(node.dataset.cloudName || node.dataset.cloudFile, null, 'application/octet-stream',
      fileUrl(node.dataset.cloudEdition, node.dataset.cloudFile)),
    'download-report': async node => download('cloud-comparison-' + node.dataset.cloudId + '.jsonl', null, 'application/x-ndjson',
      '/api/cloud/report?id=' + encodeURIComponent(node.dataset.cloudId)),
    'download-delivery': async node => download(node.dataset.cloudName, null, 'application/octet-stream', safeCloudPath(node.dataset.cloudUrl)),
    'select-source': async () => {
      const context = { dirtyChoice: getWorkspace().merchantDirty ? ui.dirtyChoice : 'saved' };
      await beforeSelect(context);
      await submit('select', '/api/cloud/select', operationPayload({ editionId: ui.editionId, relationIds: [...ui.selectedRelations],
        ...(ui.selectedComparison ? { comparisonId: ui.selectedComparison } : {}), note: ui.selectNote.trim() }), context);
      notice('Selected complete native relations in the original merchant. Continue in Build a query.');
    },
    'match-fields': async () => {
      const left = relation(ui.leftEditionId, ui.leftRelationId), right = relation(ui.rightEditionId, ui.rightRelationId);
      const rightNames = new Set(list(right?.columns).map(item => item.name));
      ui.mappings = list(left?.columns).filter(item => rightNames.has(item.name)).map(item => ({
        role: 'field', left: item.name, right: item.name, kind: 'text', absoluteTolerance: '0', relativeTolerance: '0', leftTimeUnit: 'iso', rightTimeUnit: 'iso'
      }));
      notice('Matched same-name columns as editable value mappings. Choose the row keys and actual comparison types before running.');
    },
    'add-mapping': async () => { ui.mappings.push({ role: 'field', left: '', right: '', kind: 'text', absoluteTolerance: '0', relativeTolerance: '0', leftTimeUnit: 'iso', rightTimeUnit: 'iso' }); },
    'remove-mapping': async node => { ui.mappings.splice(Number(node.dataset.cloudIndex), 1); },
    'add-omission': async () => { ui.omissions.push({ side: 'right', field: '', reason: '' }); },
    'remove-omission': async node => { ui.omissions.splice(Number(node.dataset.cloudIndex), 1); },
    compare: async () => { await submit('compare', '/api/cloud/compare', comparisonPayload()); notice('Complete comparison retained. Review the source-linked findings and capture coverage.'); },
    'open-comparison': async node => { await loadComparison(node.dataset.cloudId, 0); notice('Opened the retained comparison and its review history.'); },
    'findings-page': async node => { await loadComparison(ui.comparisonId, Number(node.dataset.cloudOffset)); },
    review: async () => {
      if (!ui.reviewNote.trim()) throw new Error('Record the reason for this review decision.');
      await submit('review', '/api/cloud/review', operationPayload({ comparisonId: ui.comparisonId, expectedReviewRevision: ui.comparison.review?.revision ?? 0,
        decision: ui.reviewDecision, note: ui.reviewNote.trim() }));
      notice('Review decision saved in the original comparison history.');
    },
    export: async () => {
      await submit('export', '/api/cloud/export', operationPayload({ editionIds: [...ui.exportEditions], comparisonIds: [...ui.exportComparisons],
        ...(ui.exportPackage ? { packageId: ui.exportPackage } : {}), note: ui.exportNote.trim() }));
      notice('Complete private handover created. Its retained download and contents are available below.');
    },
    'receive-local': async () => { await submit('receive', '/api/cloud/receive', operationPayload({ archivePath: ui.receivePath.trim() })); notice('Received source editions and review lineage. Inspect them before choosing the merchant source.'); },
    'receive-upload': receiveUpload,
    'open-delivery': async node => { const result = await api('/api/cloud/delivery?id=' + encodeURIComponent(node.dataset.cloudId) + '&kind=summary'); ui.lastDelivery = result.delivery ?? result; },
    retry: async node => {
      const entry = pending[node.dataset.cloudKind];
      if (!entry) return;
      await dispatch(entry); notice('The retained request completed using its original operation ID and payload.');
    }
  };
  const click = event => {
    const node = event.target.closest('[data-cloud-action]');
    if (!node || !host.contains(node)) return;
    const fn = handlers[node.dataset.cloudAction];
    if (!fn) return;
    event.preventDefault();
    void run(node.textContent.trim() + '…', () => fn(node));
  };
  const input = event => {
    const node = event.target;
    if (node.dataset.cloudBind) ui[node.dataset.cloudBind] = node.value;
    if (node.dataset.cloudMap !== undefined && ui.mappings[Number(node.dataset.cloudMap)]) ui.mappings[Number(node.dataset.cloudMap)][node.dataset.cloudMapField] = node.value;
    if (node.dataset.cloudOmission !== undefined && ui.omissions[Number(node.dataset.cloudOmission)]) ui.omissions[Number(node.dataset.cloudOmission)][node.dataset.cloudOmissionField] = node.value;
    updateActionAvailability();
  };
  function updateActionAvailability() {
    const set = (name, disabled) => {
      for (const node of host.querySelectorAll('[data-cloud-action="' + name + '"]')) {
        node.dataset.disabled = String(disabled); node.disabled = busy || disabled;
      }
    };
    set('import-local', !ui.importPath.trim()); set('receive-local', !ui.receivePath.trim());
    set('review', !ui.reviewNote.trim()); set('export', !ui.exportEditions.size);
    set('select-source', !ui.selectedRelations.size);
    set('compare', !ui.leftRelationId || !ui.rightRelationId || !ui.mappings.some(item => item.role === 'key'));
  }
  const change = event => {
    const node = event.target;
    if (node.dataset.cloudSet) {
      const set = ui[node.dataset.cloudSet];
      if (set instanceof Set) { if (node.checked) set.add(node.value); else set.delete(node.value); updateActionAvailability(); }
      return;
    }
    const bind = node.dataset.cloudBind;
    if (bind) {
      ui[bind] = node.value;
      if (['leftEditionId', 'rightEditionId'].includes(bind)) {
        const side = bind.startsWith('left') ? 'left' : 'right';
        void run('Opening native source columns…', async () => {
          ui[side + 'RelationId'] = ''; ui.mappings = [];
          if (ui[bind]) await loadEdition(ui[bind], true);
        });
      } else if (['leftRelationId', 'rightRelationId'].includes(bind)) {
        ui.mappings = [];
        const current = relation(ui.leftEditionId, ui.leftRelationId) ?? relation(ui.rightEditionId, ui.rightRelationId);
        ui.family = current?.family ?? ''; paint();
      } else if (bind === 'relationId') paint();
    }
    if (node.dataset.cloudMap !== undefined && ['kind', 'role'].includes(node.dataset.cloudMapField)) paint();
    const kind = node.dataset.cloudFile;
    if (!kind) return;
    const files = Array.from(node.files ?? []);
    if (kind === 'sources' || kind === 'folder') { ui.sourceFiles = files; ui.progress.clear(); paint(); return; }
    if (kind === 'archive') { ui.archiveFile = files[0] ?? null; paint(); return; }
    if (kind === 'manifest') void run('Opening the captured source manifest…', async () => {
      const file = files[0]; if (!file) return;
      if (file.size > 16 * 1024 * 1024) throw new Error('The source manifest exceeds the 16 MiB browser manifest limit. Use the local packet import.');
      let manifest;
      try { manifest = JSON.parse(await file.text()); } catch { throw new Error('The selected source manifest must be valid JSON.'); }
      if (manifest.schema !== 'stellar-forge.coinmetrics-cloud-input.v1' || !Array.isArray(manifest.files) || !manifest.files.length)
        throw new Error('Choose a Coin Metrics cloud-input manifest containing its actual source files.');
      ui.manifest = manifest; ui.manifestName = file.name; ui.intake = null; ui.sourceFiles = []; ui.progress.clear();
      notice('Manifest opened. Select its declared source files to review path and size matches.');
    });
  };
  host.addEventListener('click', click); host.addEventListener('input', input); host.addEventListener('change', change);
  paint();
  return {
    render(next) { acceptState(next); paint(); },
    refresh: () => run('Refreshing cloud source workspace…', refreshCloud),
    dispose() { disposed = true; host.removeEventListener('click', click); host.removeEventListener('input', input); host.removeEventListener('change', change); },
    getPendingSelection() { return mutationContext; }
  };
}
