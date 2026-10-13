// MIT. DOM-only rendering keeps source values as text; one native operation API.
function uuid() { if (typeof crypto.randomUUID === 'function')
    return crypto.randomUUID(); const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128; const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; }
const $ = q => document.querySelector(q), content = $('#content'), dialog = $('#dialog'), modal = $('#dialog-content');
let token = location.hash.slice(1) || sessionStorage.getItem('record-mastering-session') || '';
if (token) {
    sessionStorage.setItem('record-mastering-session', token);
    history.replaceState(null, '', location.pathname);
}
let pendingMutation = null;
let state, tab = 'records', offset = 0, query = '', filter = '', selected = new Set(), busy = false;
const title = s => String(s).replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
const formatDate = s => s ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(s)) : 'Not activated';
const n = v => new Intl.NumberFormat().format(v), clear = e => { e.replaceChildren(); return e; };
function el(tag, text = '', className) { const e = document.createElement(tag); if (text !== undefined && text !== '')
    e.textContent = String(text); if (className)
    e.className = className; return e; }
function append(parent, ...children) { parent.append(...children.filter(Boolean)); return parent; }
function button(text, fn, secondary = false) { const b = el('button', text, secondary ? 'secondary' : ''); b.type = 'button'; b.onclick = () => act(fn); return b; }
function input(label, value = '', type = 'text') { const wrap = el('div'), l = el('label', label), i = el('input'); i.type = type; i.value = value; i.id = 'f-' + uuid(); l.htmlFor = i.id; wrap.append(l, i); return { wrap, input: i }; }
function select(label, options, value) { const f = input(label), s = el('select'); s.id = f.input.id; for (const o of options) {
    const option = el('option', o.label ?? o);
    option.value = o.value ?? o;
    s.append(option);
} if (value !== undefined)
    s.value = value; f.input.replaceWith(s); return { wrap: f.wrap, input: s }; }
function check(label, checked = false) { const l = el('label'), i = el('input'); i.type = 'checkbox'; i.checked = checked; l.append(i, document.createTextNode(label)); return { wrap: l, input: i }; }
function notice(message, error = false) { const e = $('#notice'); e.textContent = message; e.className = error ? 'error' : ''; e.hidden = !message; }
async function act(fn) { if (busy)
    return; busy = true; document.body.setAttribute('aria-busy', 'true'); try {
    return await fn();
}
catch (e) {
    notice(e.message, true);
    if (e.code === 'REVISION_CHANGED') {
        await loadStatus();
    }
}
finally {
    busy = false;
    document.body.removeAttribute('aria-busy');
} }
async function api(action, input = {}) { const r = await fetch('/api/invoke', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ action, input }) }); const v = await r.json(); if (!r.ok)
    throw Object.assign(Error(v.message || 'Operation failed'), { code: v.error }); return v; }
const pendingKey = () => 'mastering-pending-' + state.id;
function clearPending() { pendingMutation = null; sessionStorage.setItem(pendingKey(), ''); }
async function recoverPending() { const raw = sessionStorage.getItem(pendingKey()); if (!raw)
    return; const pending = JSON.parse(raw), saved = await api('operation', { requestId: pending.requestId }); clearPending(); if (saved.found) {
    await loadStatus();
    notice('Recovered saved ' + title(saved.kind.replaceAll('.', ' ')).toLowerCase() + '.');
} }
async function mutate(action, input = {}) {
    const identity = JSON.stringify({ action, input });
    if (pendingMutation && pendingMutation.identity !== identity) {
        await recoverPending();
        pendingMutation = null;
    }
    if (!pendingMutation) {
        await recoverPending();
        pendingMutation = { identity, action, input: { ...input, expectedRevision: state.revision, requestId: uuid() } };
        sessionStorage.setItem(pendingKey(), JSON.stringify({ requestId: pendingMutation.input.requestId, action }));
    }
    try {
        const v = await api(pendingMutation.action, pendingMutation.input);
        clearPending();
        await loadStatus();
        notice('Saved.');
        return v;
    }
    catch (error) {
        if (error.code)
            clearPending();
        throw error;
    }
}
async function download(path, name) { const r = await fetch(path, { headers: { Authorization: 'Bearer ' + token } }); if (!r.ok) {
    const v = await r.json();
    throw Error(v.message);
} const href = URL.createObjectURL(await r.blob()), a = el('a'); a.href = href; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(href), 10000); }
async function loadStatus() { state = await api('status'); $('#workspace-name').textContent = state.title; $('#revision').textContent = 'Workspace revision ' + n(state.revision); clear($('#metrics')); for (const [key, label] of [['masterRecords', 'Master records'], ['ready', 'Ready to deliver'], ['review', 'Records to review'], ['sources', 'Source lists']])
    append($('#metrics'), append(el('div', '', 'metric'), el('strong', n(state.counts[key])), el('span', label))); }
function table(headers, rows) { const wrap = el('div', '', 'table-wrap'), t = el('table'), head = el('tr'); for (const h of headers)
    head.append(el('th', h)); append(t, append(el('thead'), head)); const body = el('tbody'); for (const row of rows) {
    const tr = el('tr');
    for (const c of row)
        append(tr, append(el('td'), c instanceof Node ? c : document.createTextNode(String(c ?? '—'))));
    body.append(tr);
} if (!rows.length) {
    const td = el('td', 'No records in this view.', 'empty');
    td.colSpan = headers.length;
    body.append(append(el('tr'), td));
} append(t, body); return append(wrap, t); }
function pagination(page, fn) { const root = el('div', '', 'pagination'), text = el('span', page.total ? `${n(page.offset + 1)}–${n(Math.min(page.offset + page.limit, page.total))} of ${n(page.total)}` : 'No items'); const buttons = el('div', '', 'buttons'), prev = button('Previous', () => fn(Math.max(0, page.offset - page.limit)), true), next = button('Next', () => fn(page.nextOffset), true); prev.disabled = !page.offset; next.disabled = page.nextOffset === null; buttons.append(prev, next); return append(root, text, buttons); }
function badge(status) { return el('span', ({ ready: 'Ready', review: 'Needs review', inactive: 'Inactive', agreed: 'Agreed', chosen: 'Selected', empty: 'Empty', conflict: 'Conflicting values', changed: 'Source changed' })[status] ?? title(status), 'status ' + status); }
function panel(heading, description) { const e = el('section', '', 'panel'); append(e, el('h2', heading), description ? el('p', description) : null); return e; }
function openModal() { if (!dialog.open)
    dialog.showModal(); modal.scrollTop = 0; }
async function show() { for (const b of document.querySelectorAll('nav button'))
    b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'); clear(content); if (tab === 'records')
    await records();
else if (tab === 'matches')
    await matches();
else if (tab === 'sources')
    await sources();
else if (tab === 'deliveries')
    await deliveries();
else
    await historyView(); }
async function records() {
    const p = panel('Master records', 'Consolidate source records into one customer view. Field decisions retain the original values and follow-up changes.');
    const search = input('Search all mapped values', query), status = select('Record status', [{ value: '', label: 'All records' }, { value: 'ready', label: 'Ready to deliver' }, { value: 'review', label: 'Needs review' }, { value: 'inactive', label: 'Inactive' }], filter);
    search.wrap.classList.add('grow');
    const bar = el('div', '', 'toolbar');
    append(bar, search.wrap, status.wrap, button('Search', async () => { query = search.input.value; filter = status.input.value; offset = 0; await show(); }), button('Merge selected', async () => { if (selected.size < 2)
        throw Error('Select at least two master records.'); await mutate('entity.merge', { entityIds: [...selected] }); selected.clear(); await show(); }, true));
    search.input.onkeydown = e => { if (e.key === 'Enter')
        act(async () => { query = search.input.value; filter = status.input.value; offset = 0; await show(); }); };
    p.append(bar);
    const page = await api('entities', { offset, limit: 30, query, status: filter || undefined });
    p.append(table(['Select', 'Record', 'Company / email', 'Source records', 'Status'], page.items.map(e => { const c = check('', selected.has(e.id)); c.input.setAttribute('aria-label', 'Select ' + e.title); c.input.onchange = () => c.input.checked ? selected.add(e.id) : selected.delete(e.id); const name = button(e.title, () => entityView(e.id), true); name.className = 'subtle'; const detail = append(el('div'), el('div', e.values.company || '—'), el('small', e.values.email || '')); return [c.wrap, name, detail, n(e.activeRecords), append(el('div'), badge(e.status), e.conflicts.length ? el('p', e.conflicts.map(title).join(', ')) : null)]; })));
    p.append(pagination(page, async (next) => { offset = next; await show(); }));
    content.append(p);
    if (!state.counts.sources)
        content.append(append(panel('Start with your first list', 'Import a CSV, choose stable source keys, and map its columns to your master fields.'), button('Add source list', async () => { tab = 'sources'; await show(); })));
}
async function entityView(entityId) {
    const e = await api('entity', { entityId });
    clear(modal);
    append(modal, el('h2', e.title), el('p', `${n(e.activeRecords)} active source records · ${n(e.conflicts.length)} fields need review`));
    const label = input('Display label', e.label), note = input('Working note', e.note);
    append(modal, append(el('div', '', 'form-grid'), label.wrap, note.wrap), append(el('div', '', 'toolbar'), button('Save record details', async () => { await mutate('entity.annotate', { entityId, label: label.input.value, note: note.input.value }); await entityView(entityId); }, true)));
    const fields = el('div', '', 'field-list');
    for (const [field, f] of Object.entries(e.fields)) {
        const card = el('div', '', 'field-card');
        append(card, append(el('div', '', 'field-head'), el('h3', title(field)), badge(f.status)), el('div', f.value !== '' ? f.value : f.status === 'chosen' ? 'Empty text selected' : f.status === 'empty' ? 'No source value' : 'Value needs review', 'field-value'));
        if (f.retainedValue !== undefined)
            card.append(el('p', 'Previously selected: ' + (f.retainedValue || '(empty)')));
        for (const c of f.candidates)
            card.append(append(el('div', '', 'candidate'), append(el('div'), el('div', c.value), el('small', c.sourceName + ' · record ' + n(c.rowNumber))), button('Use value', async () => { await mutate('field.choose', { entityId, field, mode: 'source', recordId: c.recordId }); await entityView(entityId); }, true)));
        const details = el('details'), custom = input('Custom ' + title(field), f.choice?.mode === 'custom' ? f.choice.value : '');
        append(details, el('summary', 'Set a custom value or return to automatic agreement'), custom.wrap, append(el('div', '', 'toolbar'), button('Save custom value', async () => { await mutate('field.choose', { entityId, field, mode: 'custom', value: custom.input.value }); await entityView(entityId); }, true), button('Use agreement', async () => { await mutate('field.choose', { entityId, field, mode: 'auto' }); await entityView(entityId); }, true)));
        card.append(details);
        fields.append(card);
    }
    modal.append(fields);
    const selectedRows = new Set(), original = panel('Original source records', 'Select records to split into a separate master, or exclude one while retaining its original data.');
    original.append(table(['Split', 'Source', 'Original values', 'Availability'], e.records.map(r => { const c = check(''); c.input.onchange = () => c.input.checked ? selectedRows.add(r.id) : selectedRows.delete(r.id); const raw = el('details'); append(raw, el('summary', r.sourceName + ' · ' + (r.rowNumber ? 'record ' + n(r.rowNumber) : 'not in active edition')), table(['Column', 'Original text'], Object.entries(r.raw))); const availability = el('div'); append(availability, el('div', r.missing ? 'Absent from active source' : r.excluded ? 'Excluded' : 'Included'), r.reason ? el('small', r.reason) : null, button(r.excluded ? 'Include record' : 'Exclude record', async () => { const reason = r.excluded ? '' : prompt('Why exclude this source record?'); if (reason === null)
        return; await mutate('record.exclude', { recordId: r.id, excluded: !r.excluded, reason }); await entityView(entityId); }, true)); return [c.wrap, r.sourceName, raw, availability]; })));
    original.append(append(el('div', '', 'toolbar'), button('Split selected records', async () => { const result = await mutate('entity.split', { entityId, recordIds: [...selectedRows] }); await entityView(result.entityId); }, true)));
    modal.append(original);
    openModal();
}
async function sources() {
    const p = panel('Source editions', 'Retain exact source files. A new edition uses the same source key and mapping, so matching decisions remain attached to the right records.');
    for (const f of state.feeds) {
        const card = el('div', '', 'edition-card');
        append(card, append(el('div', '', 'source-title'), el('h3', f.name), el('span', n(f.editions.length) + ' editions', 'pill')), el('p', 'Stable key: ' + f.keyColumns.join(' + ')));
        card.append(table(['Edition', 'Captured', 'Records', 'Active', 'Actions'], f.editions.map(e => [e.label, formatDate(e.created), n(e.row_count), e.id === f.active_edition ? 'Current' : 'Retained', append(el('div', '', 'toolbar'), button('Review refresh', () => refreshView(e.id), true), button('Original CSV', () => download('/api/source/' + e.id, 'original-source.csv'), true))])));
        p.append(card);
    }
    content.append(p);
    const upload = panel('Import a source file', 'Choose an existing source for a refresh, or create a new source with explicit stable keys and field mapping.');
    const feed = select('Source', [{ value: 'new', label: 'New source list' }, ...state.feeds.map(f => ({ value: f.id, label: f.name }))]);
    const file = input('CSV file', '', 'file');
    file.input.accept = '.csv,text/csv';
    const edition = input('Edition label', 'Latest customer export');
    append(upload, append(el('div', '', 'form-grid'), feed.wrap, edition.wrap), file.wrap);
    const mapping = el('div');
    upload.append(mapping);
    content.append(upload);
    let bytes, inspection, sourceName, keys = [], maps = [], createdFeedId = null;
    async function inspect() {
        if (!file.input.files.length)
            return;
        bytes = new Uint8Array(await file.input.files[0].arrayBuffer());
        const base64 = await toBase64(bytes);
        inspection = await api('source.inspect', { base64 });
        clear(mapping);
        append(mapping, el('p', `${n(inspection.rowCount)} source records · ${n(inspection.headers.length)} columns`));
        keys = [];
        maps = [];
        if (feed.input.value === 'new') {
            sourceName = input('Source name', file.input.files[0].name.replace(/\.csv$/i, ''));
            mapping.append(sourceName.wrap);
            const help = el('p', 'Select one or more stable key columns. Keys must be present and unique in every edition; use a source system identifier rather than a row number.');
            mapping.append(help);
            const checks = el('div', '', 'checklist');
            for (const h of inspection.headers) {
                const c = check(h, keys.length === 0 && /^(id|contact_?id|customer_?id)$/i.test(h));
                keys.push({ header: h, input: c.input });
                checks.append(c.wrap);
            }
            mapping.append(checks);
            mapping.append(table(['Source column', 'Master field (blank to omit)'], inspection.headers.map(h => { const clean = h.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, '').slice(0, 48), f = input('', clean); maps.push({ header: h, input: f.input }); return [h, f.wrap]; })));
        }
        else {
            const f = state.feeds.find(f => f.id === feed.input.value);
            mapping.append(el('p', 'Existing mapping: ' + Object.entries(f.mapping).map(([k, v]) => v + ' → ' + title(k)).join('; ')));
        }
        const details = el('details');
        append(details, el('summary', 'Preview original rows'), table(inspection.headers, inspection.preview));
        mapping.append(details);
        mapping.append(append(el('div', '', 'toolbar'), button('Retain source edition', async () => { let feedId = createdFeedId ?? feed.input.value; if (feedId === 'new') {
            const pairs = maps.filter(m => m.input.value).map(m => [m.input.value, m.header]);
            if (new Set(pairs.map(p => p[0])).size !== pairs.length)
                throw Error('Each master field needs a unique name.');
            feedId = (await mutate('feed.create', { name: sourceName.input.value, mapping: Object.fromEntries(pairs), keyColumns: keys.filter(k => k.input.checked).map(k => k.header) })).feedId;
            createdFeedId = feedId;
        } const result = await mutate('source.import', { feedId, label: edition.input.value, base64, sha256: inspection.sha256 }); await show(); await refreshView(result.editionId); })));
    }
    file.input.onchange = () => act(inspect);
    feed.input.onchange = () => act(async () => { createdFeedId = null; await inspect(); });
}
async function toBase64(bytes) { return await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(new Blob([bytes])); }); }
async function refreshView(editionId, offset = 0) {
    const p = await api('refresh', { editionId, offset, limit: 25 });
    clear(modal);
    append(modal, el('h2', p.feedName + ' / ' + p.label), el('p', 'Review this edition before making it the current source. Missing records remain retained; changed selected values return to field review.'));
    const counts = el('div', '', 'checklist');
    for (const [k, v] of Object.entries(p.counts))
        counts.append(el('span', n(v) + ' ' + title(k), 'pill'));
    modal.append(counts);
    const changeRows = p.items.map(c => {
        const names = [...new Set([...Object.keys(c.before ?? {}), ...Object.keys(c.after ?? {})])].filter(k => c.kind !== 'changed' || c.fields.includes(k));
        const values = names.map(k => [title(k), c.before?.[k] ?? '—', c.after?.[k] ?? '—']);
        return [title(c.kind), n(c.rowNumber), append(el('div'), c.fields ? el('p', c.fields.map(title).join(', ')) : null, table(['Field', 'Before', 'After'], values))];
    });
    modal.append(table(['Change', 'Source record', 'Values'], changeRows));
    modal.append(pagination(p, next => refreshView(editionId, next)), append(el('div', '', 'toolbar'), button('Make this edition current', async () => { if (p.revision !== state.revision)
        throw Object.assign(Error('The workspace changed. Reopen this refresh plan.'), { code: 'REVISION_CHANGED' }); await mutate('source.activate', { editionId, planSha256: p.planSha256 }); dialog.close(); await show(); })));
    openModal();
}
async function matches() {
    const p = panel('Matching desk', 'Matching creates review groups, not automatic merges. Normalize only the fields you trust for matching; original delivered values remain unchanged.');
    const fields = [...new Set(state.feeds.flatMap(f => Object.keys(f.mapping)))];
    const rules = [];
    const rows = fields.map(field => { const existing = state.rules.find(r => r.field === field), s = select('', [{ value: '', label: 'Not used' }, { value: 'exact', label: 'Exact text' }, { value: 'fold', label: 'Case and spacing' }, { value: 'email', label: 'Email: trim and lowercase' }, { value: 'digits', label: 'Digits only' }, { value: 'domain', label: 'Email / website domain' }], existing?.normalize ?? ''); rules.push({ field, input: s.input }); return [title(field), s.wrap]; });
    const d = el('details');
    d.open = !state.rules.length;
    append(d, el('summary', 'Matching fields and normalization'), table(['Master field', 'Matching rule'], rows), append(el('div', '', 'toolbar'), button('Save matching rules', async () => { await mutate('rules.save', { rules: rules.filter(r => r.input.value).map(r => ({ field: r.field, normalize: r.input.value })) }); await show(); }, true)));
    p.append(d);
    const page = await api('groups', { offset, limit: 30 });
    p.append(el('h3', n(page.total) + ' candidate groups'));
    p.append(table(['Shared value', 'Matching field', 'Master records', 'Action'], page.items.map(g => [g.value, title(g.field), n(g.entityCount), button('Review group', () => groupView(g.id), true)])), pagination(page, async (next) => { offset = next; await show(); }));
    content.append(p);
}
async function groupView(groupId, offset = 0, selection = new Set()) {
    const g = await api('group', { groupId, offset, limit: 100 });
    clear(modal);
    append(modal, el('h2', 'Shared ' + title(g.field).toLowerCase()), el('p', g.value), el('p', 'Select only records belonging to the same customer. Different field values remain available for review after merging.'));
    const all = check('Select this page', g.items.every(e => selection.has(e.id)));
    const boxes = [];
    all.input.onchange = () => { for (const [e, c] of boxes) {
        c.input.checked = all.input.checked;
        if (all.input.checked)
            selection.add(e.id);
        else
            selection.delete(e.id);
    } };
    modal.append(all.wrap);
    modal.append(table(['Merge', 'Master record', 'Status', 'Action'], g.items.map(e => { const c = check('', selection.has(e.id)); c.input.onchange = () => c.input.checked ? selection.add(e.id) : selection.delete(e.id); boxes.push([e, c]); return [c.wrap, e.title, badge(e.status), button('Open record', () => entityView(e.id), true)]; })), pagination(g, next => groupView(groupId, next, selection)), append(el('div', '', 'toolbar'), button('Merge selected records', async () => { const result = await mutate('entity.merge', { groupId, entityIds: [...selection] }); await entityView(result.entityId); }), button('Keep these records separate', async () => { const reason = prompt('Reason for keeping this group separate:'); if (reason === null)
        return; await mutate('match.dismiss', { groupId, reason }); dialog.close(); await show(); }, true)));
    openModal();
}
async function deliveries() {
    const p = panel('Create a master dataset', 'Save an immutable customer delivery with the selected master fields, field provenance, and unresolved-field report. A private editable workspace is a separate download.');
    const name = input('Delivery title', 'Customer master dataset'), mode = select('Records to include', [{ value: 'ready', label: 'Only records ready to deliver' }, { value: 'all', label: 'All active records; unresolved fields stay blank' }]);
    append(p, append(el('div', '', 'form-grid'), name.wrap, mode.wrap));
    const columns = [...new Set(state.feeds.flatMap(f => Object.keys(f.mapping)))], checks = [], list = el('div', '', 'checklist');
    for (const field of columns) {
        const c = check(title(field), true);
        checks.push({ field, input: c.input });
        list.append(c.wrap);
    }
    append(p, el('label', 'Delivered fields'), list, el('p', 'Files contain selected values and their original field provenance. Review the recipient and column selection before sharing.'), append(el('div', '', 'toolbar'), button('Save delivery edition', async () => { await mutate('delivery.create', { title: name.input.value, mode: mode.input.value, columns: checks.filter(c => c.input.checked).map(c => c.field) }); await show(); })));
    content.append(p);
    const retained = panel('Retained delivery editions', 'Every saved edition keeps its exact original CSV and supporting files. Download the complete package, or one file.');
    const rows = await api('deliveries');
    for (const d of rows) {
        const card = el('div', '', 'edition-card');
        append(card, el('h3', d.title), el('p', `${formatDate(d.created)} · ${n(d.row_count)} records · ${n(d.conflict_count)} unresolved fields`), append(el('div', '', 'toolbar'), button('Complete delivery', () => download('/api/delivery/' + d.id, 'master-delivery.gz')), button('Master CSV', () => download('/api/file/' + d.id + '/master.csv', 'master.csv'), true), button('Dataset configuration', () => download('/api/file/' + d.id + '/dataset.json', 'dataset.json'), true), button('Field provenance', () => download('/api/file/' + d.id + '/field-provenance.jsonl', 'field-provenance.jsonl'), true), button('Unresolved fields', () => download('/api/file/' + d.id + '/conflicts.csv', 'conflicts.csv'), true)));
        retained.append(card);
    }
    if (!rows.length)
        retained.append(el('p', 'No delivery editions yet.'));
    content.append(retained);
}
async function historyView() { const p = panel('Activity', 'Saved operations and source decisions, in the order they were committed.'); const page = await api('history', { offset, limit: 30 }); p.append(table(['Revision', 'Operation', 'Saved'], page.items.map(h => [n(h.revision), title(h.kind.replaceAll('.', ' ')), formatDate(h.created)])), pagination(page, async (next) => { offset = next; await show(); })); content.append(p); }
for (const b of document.querySelectorAll('nav button'))
    b.onclick = () => act(async () => { tab = b.dataset.tab; offset = 0; selected.clear(); await show(); });
$('#backup').onclick = () => act(() => download('/api/backup', 'workspace.mastering.gz'));
dialog.addEventListener('close', () => act(show));
act(async () => { await loadStatus(); await recoverPending(); await show(); });
