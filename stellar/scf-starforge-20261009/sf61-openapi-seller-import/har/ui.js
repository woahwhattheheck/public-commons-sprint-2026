// MIT. One native operation editor shared by the offline review and private console.
import { buildDocument, HAR_SCHEMA } from './model.mjs';

export function mountHarReview({root=document,initial,onSave,readDraft,writeDraft,onChange}={}) {
const doc=root.ownerDocument??document;
if(!initial?.inventory||!initial?.review)throw new TypeError('Open the original capture review.');
const originalReview=structuredClone(initial.review);
const inventory = initial.inventory, byId = new Map(inventory.groups.map(g => [g.id, g]));
let review = structuredClone(initial.review), selected = 0, page = 0;
const $ = id => root.querySelector('#'+id);
const storageKey = 'stellar.har.draft.' + inventory.sourceSha256;
const jsonText = value => JSON.stringify(value, null, 2);
function notify(message, error = false) { $('status').textContent = message; $('status').setAttribute('role', error ? 'alert' : 'status'); }
function saveDraft() {
  try { if(writeDraft)writeDraft(structuredClone(review));else localStorage.setItem(storageKey,JSON.stringify(review)); } catch {}
  onChange?.(structuredClone(review));
}
function matchingReview(value) {
  if(value?.schema!==HAR_SCHEMA||value.sourceSha256!==inventory.sourceSha256||!Array.isArray(value.operations))
    throw new Error('Review belongs to another source.');
  const expected=originalReview['x-har-refresh'],actual=value['x-har-refresh'];
  if(expected&&['schema','previousSourceSha256','previousReviewSha256','candidateSourceSha256'].some(key=>actual?.[key]!==expected[key]))
    throw new Error('Review belongs to another capture-edition comparison. Open its original refresh packet.');
  return structuredClone(value);
}
function replaceReview(value) {
  const before=review,beforeSelected=selected;
  review=matchingReview(value);selected=0;
  try {render();}catch(error){review=before;selected=beforeSelected;render();throw error;}
}
function field(label, control, help = '') {
  const wrap = doc.createElement('label'); wrap.className = 'field';
  const title = doc.createElement('span'); title.textContent = label; wrap.append(title, control);
  if (help) { const small = doc.createElement('small'); small.textContent = help; wrap.append(small); } return wrap;
}
function input(value, change, type = 'text') {
  const e = doc.createElement('input'); e.type = type;
  if (type === 'checkbox') e.checked = Boolean(value); else e.value = value ?? '';
  e.addEventListener('change', () => { change(type === 'checkbox' ? e.checked : e.value); saveDraft(); refreshSummary(); }); return e;
}
function select(value, values, change) {
  const e = doc.createElement('select');
  for (const v of values) { const o = doc.createElement('option'); o.value = v; o.textContent = v; e.append(o); }
  e.value = value;
  e.addEventListener('change', () => { change(e.value); saveDraft(); renderDetail(); refreshSummary(); }); return e;
}
function jsonEditor(value, change, label) {
  const e = doc.createElement('textarea'); e.value = jsonText(value); e.rows = Math.max(2, Math.min(12, e.value.split('\n').length)); e.spellcheck = false;
  e.setAttribute('aria-label', label);
  e.addEventListener('change', () => {
    try { const parsed = JSON.parse(e.value); change(parsed); e.setCustomValidity(''); saveDraft(); refreshSummary(); }
    catch (err) { e.setCustomValidity(err.message); notify(`${label}: invalid JSON — ${err.message}`, true); }
  }); return e;
}
function detailGroup(title, help) {
  const s = doc.createElement('section'), h = doc.createElement('h3'); h.textContent = title; s.append(h);
  if (help) { const p = doc.createElement('p'); p.className = 'muted'; p.textContent = help; s.append(p); }
  $('detail').append(s); return s;
}
function unionGroups(op) {
  const groups = op.groups.map(id => byId.get(id)).filter(Boolean);
  const q = new Map(), c = new Map(), hs = new Set();
  for (const g of groups) { g.query.forEach(x => q.set(x.name, x)); g.credentials.forEach(x => c.set(x.in + ':' + x.name, x)); g.headers.forEach(h => hs.add(h)); }
  return { groups, query: [...q.values()], credentials: [...c.values()], headers: [...hs] };
}
function renderList() {
  const search = $('search').value.toLowerCase(), rows = review.operations.map((op, i) => ({ op, i, group: byId.get(op.groups[0]) }))
    .filter(({ op, group }) => `${op.id} ${group?.method} ${group?.origin} ${group?.path}`.toLowerCase().includes(search));
  page = Math.min(page, Math.max(0, Math.ceil(rows.length / 25) - 1));
  $('operations').replaceChildren();
  for (const { op, i, group } of rows.slice(page * 25, (page + 1) * 25)) {
    const b = doc.createElement('button'); b.className = 'operation' + (i === selected ? ' current' : '');
    b.type = 'button'; b.setAttribute('aria-pressed', String(i === selected));
    const head = doc.createElement('strong'); head.textContent = `${op.enabled ? 'Selected · ' : ''}${group?.method || '?'} ${group?.path || op.id}`;
    const meta = doc.createElement('small'); meta.textContent = `${op.id} · ${op.groups.join(', ')} · ${group?.entryIds.length || 0} captures`;
    b.append(head, meta); b.addEventListener('click', () => { selected = i; renderList(); renderDetail(); }); $('operations').append(b);
  }
  $('page').textContent = `${rows.length} operations · page ${rows.length ? page + 1 : 0} / ${Math.ceil(rows.length / 25)}`;
  $('previous').disabled = page === 0; $('next').disabled = (page + 1) * 25 >= rows.length;
}
function renderDetail() {
  $('detail').replaceChildren(); const op = review.operations[selected]; if (!op) return;
  const u = unionGroups(op), group = u.groups[0];
  let s = detailGroup('Operation selection', 'Choose only operations you intend to expose. A capture is an observation, not a complete provider contract.');
  s.append(field('Include in the reviewed API', input(op.enabled, v => { op.enabled = v; renderList(); }, 'checkbox')));
  const source = doc.createElement('pre'); source.textContent = u.groups.map(g => `${g.id} · ${g.method} ${g.origin}${g.path}\n${g.entryIds.length} captured requests`).join('\n'); s.append(source);
  s.append(field('Operation ID', input(op.id, v => { op.id = v; op.reviewed = false; renderList(); })));
  s.append(field('Source groups (comma-separated IDs)', input(op.groups.join(', '), v => {
    op.groups = v.split(',').map(x => x.trim()).filter(Boolean); op.reviewed = false;
    const joined = unionGroups(op);
    for (const q of joined.query) op.query[q.name] ??= { mode: 'unresolved', example: 'example' };
    for (const c of joined.credentials) op.credentials[c.in + ':' + c.name] ??= { mode: 'unresolved' };
    for (const h of joined.headers) op.headers[h] ??= { mode: 'unresolved' };
    renderList(); renderDetail();
  }), 'Combine variable paths here, then leave the other operation rows unselected. Every selected group can belong to only one operation.'));
  s.append(field('Merchant path template', input(op.path, v => { op.path = v; op.reviewed = false; }), 'Author the path explicitly, for example /items/{sku}. It must match all selected captured paths.'));
  s.append(field('Safe path examples', jsonEditor(op.pathExamples, v => { op.pathExamples = v; op.reviewed = false; }, 'Path examples'), 'Use placeholders, not captured identifiers: {"sku":"example"}.'));
  s.append(field('Summary', input(op.description, v => { op.description = v; })));
  const cq = new Set(u.credentials.filter(c => c.in === 'query').map(c => c.name));
  s = detailGroup('Query parameters', 'All query values start as strings. No captured values are copied. Repeated keys need explicit omission or another native integration; this intake never collapses them.');
  for (const q of u.query.filter(q => !cq.has(q.name))) {
    const d = op.query[q.name]; const row = doc.createElement('div'); row.className = 'decision';
    const h = doc.createElement('strong'); h.textContent = q.name + (q.repeated ? ' · repeated in capture' : ''); row.append(h);
    row.append(field('Resolution', select(d.mode, ['unresolved', 'parameter', 'omit'], v => { d.mode = v; op.reviewed = false; })));
    if (d.mode === 'parameter') {
      row.append(field('Required', input(d.required, v => { d.required = v; op.reviewed = false; }, 'checkbox')));
      row.append(field('Scalar schema', jsonEditor(d.schema || { type: 'string' }, v => { d.schema = v; op.reviewed = false; }, `${q.name} schema`)));
      row.append(field('Safe JSON example', jsonEditor(d.example, v => { d.example = v; op.reviewed = false; }, `${q.name} example`)));
    } else if (d.mode === 'backend') row.append(field('Host configuration reference', input(d.reference, v => { d.reference = v; op.reviewed = false; })));
    else if (d.mode === 'omit') row.append(field('Omission rationale', input(d.reason, v => { d.reason = v; op.reviewed = false; })));
    s.append(row);
  }
  if (!u.query.filter(q => !cq.has(q.name)).length) s.append(doc.createTextNode('No noncredential query parameters were observed.'));
  s = detailGroup('Credential and header decisions', 'References name server-held configuration only. Never paste keys or tokens here. “Preserve” retains API authentication and the original merchant compiler will require a manual integration. Backend choices still require configuration in the existing merchant workspace.');
  for (const c of u.credentials) {
    const key = `${c.in}:${c.name}`, d = op.credentials[key], row = doc.createElement('div'); row.className = 'decision';
    const h = doc.createElement('strong'); h.textContent = key; row.append(h);
    row.append(field('Resolution', select(d.mode, c.in === 'header' ? ['unresolved', 'preserve', 'backend', 'omit'] : (c.in === 'query' ? ['unresolved', 'preserve', 'parameter', 'omit'] : ['unresolved', 'preserve', 'omit']), v => { d.mode = v; op.reviewed = false; })));
    if (d.mode === 'backend') row.append(field('Credential reference', input(d.reference, v => { d.reference = v; op.reviewed = false; })));
    if (d.mode === 'parameter') {
      row.append(field('Why this is an ordinary public query parameter', input(d.reason, v => { d.reason = v; op.reviewed = false; })));
      row.append(field('Required', input(d.required, v => { d.required = v; op.reviewed = false; }, 'checkbox')));
      row.append(field('Scalar schema', jsonEditor(d.schema || {type:'string'}, v => {d.schema=v;op.reviewed=false;}, key+' schema')));
      row.append(field('Safe JSON example', jsonEditor(d.example ?? 'example', v => {d.example=v;op.reviewed=false;}, key+' example')));
    }
    if (d.mode === 'omit') row.append(field('Why this credential is unnecessary for the new route', input(d.reason, v => { d.reason = v; op.reviewed = false; })));
    s.append(row);
  }
  for (const h of u.headers) {
    const d = op.headers[h], row = doc.createElement('div'); row.className = 'decision';
    const title = doc.createElement('strong'); title.textContent = `header:${h}`; row.append(title);
    row.append(field('Resolution', select(d.mode, ['unresolved', 'backend', 'omit'], v => { d.mode = v; op.reviewed = false; })));
    if (d.mode === 'backend') row.append(field('Configuration reference', input(d.reference, v => { d.reference = v; op.reviewed = false; })));
    if (d.mode === 'omit') row.append(field('Omission rationale', input(d.reason, v => { d.reason = v; op.reviewed = false; })));
    s.append(row);
  }
  if (['POST', 'PUT', 'PATCH'].includes(group?.method)) {
    s = detailGroup('Request body', 'Observed schemas retain types without inventing required fields. The source body is never embedded as an example.');
    const observed = doc.createElement('pre'); observed.textContent = jsonText(u.groups.map(g => ({ group: g.id, ...g.requestBody }))); s.append(observed);
    s.append(field('Schema source', select(op.body.mode, ['unresolved', 'observed', 'author'], v => { op.body.mode = v; op.reviewed = false; })));
    s.append(field('Body is required', input(op.body.required, v => { op.body.required = v; op.reviewed = false; }, 'checkbox')));
    if (op.body.mode === 'author') s.append(field('Authored JSON schema', jsonEditor(op.body.schema || { type: 'object', properties: {} }, v => { op.body.schema = v; op.reviewed = false; }, 'Body schema')));
    s.append(field('Safe example (optional)', jsonEditor(op.body.example ?? {}, v => { op.body.example = v; op.reviewed = false; }, 'Body example')));
  }
  s = detailGroup('Response observations', 'Only recorded JSON bodies contribute shapes. Counts expose missing content; observed fields do not become required.');
  const response = doc.createElement('pre'); response.textContent = jsonText(u.groups.map(g => ({ group: g.id, responses: g.responses }))); s.append(response);
  s.append(field('Contract source', select(op.responses.mode, ['observed', 'author'], v => { op.responses.mode = v; op.reviewed = false; })));
  if (op.responses.mode === 'author') s.append(field('Authored OpenAPI Responses Object', jsonEditor(op.responses.value || { '200': { description: 'Reviewed response' } }, v => { op.responses.value = v; op.reviewed = false; }, 'Responses')));
  s = detailGroup('Review acknowledgment');
  const ack = input(op.reviewed, v => { op.reviewed = v; }, 'checkbox'); ack.id = 'reviewed-operation';
  s.append(field('I reviewed the source operation, route, public examples and header/credential decisions.', ack));
}
function readHeader() { review.sourceUrl = $('merchant').value; review.title = $('title').value; review.version = $('version').value; saveDraft(); }
function refreshSummary() {
  const ack = $('reviewed-operation'); if (ack) ack.checked = review.operations[selected]?.reviewed === true;
  const n = review.operations.filter(o => o.enabled).length;
  $('selection-summary').textContent = `${n} selected · ${review.operations.filter(o => o.enabled && o.reviewed).length} acknowledged`;
  $('preview').textContent = 'Validate the current review to refresh this preview.';
}
function download(name, value) {
  const bytes = new Blob([typeof value === 'string' ? value : jsonText(value) + '\n'], { type: 'application/json' });
  const a = doc.createElement('a'), url = URL.createObjectURL(bytes); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function validate() {
  if (![...root.querySelectorAll('textarea')].every(e => e.reportValidity())) throw new Error('Correct invalid JSON fields first');
  readHeader(); const spec = buildDocument(inventory, review); $('preview').textContent = jsonText(spec);
  notify(`Valid review: ${review.operations.filter(o => o.enabled).length} operations. ${onSave?'Save this immutable revision or use it in the merchant.':'Download decisions, then save/export through the native HAR command.'}`); return spec;
}
function render() {
  $('merchant').value = review.sourceUrl; $('title').value = review.title; $('version').value = review.version;
  renderList(); renderDetail(); refreshSummary();
}
for (const origin of [...new Set(inventory.groups.map(g => g.origin + '/'))]) { const o = doc.createElement('option'); o.value = origin; $('source-origins').append(o); }
$('source-hash').textContent = inventory.sourceSha256;
$('capture-summary').textContent = `${inventory.totalEntries} captured entries · ${inventory.groups.length} operation groups · ${inventory.rejected.length} rejected entries`;
$('rejected').textContent = inventory.rejected.length ? jsonText(inventory.rejected) : 'No rejected entries.';
$('search').addEventListener('input', () => { page = 0; renderList(); });
$('previous').onclick = () => { page--; renderList(); }; $('next').onclick = () => { page++; renderList(); };
for (const id of ['merchant', 'title', 'version']) $(id).addEventListener('change', () => { readHeader(); refreshSummary(); });
$('validate').onclick = () => { try { validate(); } catch (e) { notify(e.message, true); } };
$('download').onclick = () => { try { validate(); download('har-decisions.json', review); } catch (e) { notify(e.message, true); } };
$('export-draft').onclick = () => { readHeader(); download('har-review-draft.json', review); notify('Draft downloaded. Unresolved decisions must be completed before native publication.'); };
$('restore-draft').onclick = () => {
  try {
    const saved=readDraft?readDraft():JSON.parse(localStorage.getItem(storageKey));
    if(!saved)throw new Error('No draft is retained for this source review.');
    replaceReview(saved);notify('Restored the draft for this original source and capture edition.');
  }catch(e){notify(e.message,true);}
};
$('import-review').addEventListener('change', async e => {
  try { const file = e.target.files[0]; if (!file || file.size > 4 * 1024 * 1024) throw new Error('Choose a review JSON file up to 4 MiB');
    const loaded = JSON.parse(await file.text());
    replaceReview(loaded);saveDraft();notify('Imported the saved source-bound review.');
  } catch (err) { notify(err.message, true); }
});
if(onSave) {
  const toolbar=$('validate').parentElement;
  for(const [label,useSource] of [['Save reviewed revision',false],['Save and use in merchant',true]]) {
    const control=doc.createElement('button');control.type='button';control.textContent=label;
    control.dataset.harAction=useSource?'save-use':'save';
    control.addEventListener('click',async()=>{
      try {validate();await onSave(structuredClone(review),{useSource});}
      catch(error){notify(error.message,true);}
    });
    toolbar.append(control);
  }
}
render();
return Object.freeze({
  review:()=>{readHeader();return structuredClone(review);},
  validate:()=>validate(),
  restore:value=>{replaceReview(value);saveDraft();},
  message:notify,
});
}
