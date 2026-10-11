/* MIT. Same retained operator API on desktop and mobile. All source values render as text. */
(async () => {
'use strict';
const $ = id => document.getElementById(id);
const initialToken = location.hash.slice(1);
let token = initialToken;
try { token ||= sessionStorage.getItem('sf30.xml.token'); if (token) sessionStorage.setItem('sf30.xml.token', token); } catch {}
try { if (location.hash) history.replaceState(null, '', location.pathname + location.search); } catch {}
let state = {sources: [], plans: [], builds: [], comparisons: []}, source, savedPlan, dirty = false;
let queryBase = {}, cursor = null, historyPages = [], currentParams = {}, comparison, changeOffset = 0, nextChange;
const status = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };
const short = value => (value || '').slice(0, 12);
const integer = id => Number($(id).value);
const sidebar = collapsed => { document.querySelector('.layout').classList.toggle('sidebar-collapsed',collapsed); $('sidebar-toggle').setAttribute('aria-expanded',String(!collapsed)); $('sidebar-toggle').textContent = (collapsed ? 'Show' : 'Hide') + ' source and saved-work controls'; };
$('sidebar-toggle').addEventListener('click',()=>sidebar($('sidebar-toggle').getAttribute('aria-expanded')==='true'));
const show = name => { if(matchMedia('(max-width:680px)').matches && name!=='source') sidebar(true); document.querySelectorAll('.panel').forEach(p => p.hidden = p.id !== 'panel-' + name); document.querySelectorAll('.tab').forEach(b => { b.classList.toggle('active', b.dataset.panel === name); b.setAttribute('aria-selected', String(b.dataset.panel === name)); }); };
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => show(b.dataset.panel)));
async function request(path, options = {}) {
  const response = await fetch(path, {...options, headers: {'Authorization': 'Bearer ' + (token || ''), ...options.headers}});
  if (!response.ok) {
    let body; try { body = await response.json(); } catch {}
    throw new Error(body?.error || `Local operation returned ${response.status}`);
  }
  return response;
}
const get = async path => (await request(path)).json();
const post = async (path, body) => (await request(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})).json();
let busy = 0;
async function action(label, fn) {
  busy++; document.body.setAttribute('aria-busy', 'true'); document.querySelectorAll('.operation,input,select,textarea').forEach(b => b.disabled = true); status(label);
  try { return await fn(); } catch (e) { status(e.message, true); }
  finally {
    busy--; document.body.setAttribute('aria-busy', String(Boolean(busy)));
    if (!busy) document.querySelectorAll('.operation,input,select,textarea').forEach(b => b.disabled = false);
    $('previous-page').disabled = !historyPages.length || Boolean(busy);
    $('next-page').disabled = !cursor || Boolean(busy);
    $('changes-next').disabled = nextChange == null || Boolean(busy);
    $('download-changes').disabled = !comparison || Boolean(busy);
  }
}
function selectOptions(select, entries, label, preferred) {
  const current = preferred ?? select.value;
  select.replaceChildren();
  if (!entries.length) select.add(new Option('No retained selections', ''));
  for (const entry of entries) select.add(new Option(label(entry), entry.id));
  if (entries.some(v => v.id === current)) select.value = current;
}
function buildLabel(build) { return `${build.native.name} · ${build.rowCount.toLocaleString()} rows · ${short(build.id)}`; }
async function refresh(preferences = {}) {
  state = await get('/api/state');
  selectOptions($('source-select'), state.sources, s => `${s.label} · ${short(s.id)}`, preferences.source);
  selectOptions($('plan-select'), state.plans, p => `${p.name} · ${short(p.id)}`, preferences.plan);
  for (const id of ['build-select', 'before-select', 'after-select']) selectOptions($(id), state.builds, buildLabel, preferences[id]);
  if (!preferences['before-select'] && !comparison && state.builds.length > 1) $('before-select').value = state.builds[1].id;
  if (!preferences['after-select'] && !comparison && state.builds.length) $('after-select').value = state.builds[0].id;
  buildStats();
}
function metrics(id, values) {
  $(id).replaceChildren();
  for (const [label, value, isDigest] of values) {
    const box = document.createElement('div'); box.className = 'metric' + (isDigest ? ' digest' : '');
    const strong = document.createElement('strong'); strong.textContent = String(value);
    const text = document.createElement('span'); text.textContent = label;
    box.append(strong, text); $(id).append(box);
  }
}
function table(holder, headers, rows) {
  holder.classList.remove('empty'); holder.replaceChildren();
  const table = document.createElement('table'), head = document.createElement('thead'), hr = document.createElement('tr'), body = document.createElement('tbody');
  for (const h of headers) { const cell = document.createElement('th'); cell.textContent = h; hr.append(cell); }
  head.append(hr); table.append(head, body);
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const value of row) { const td = document.createElement('td'); td.textContent = value === null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : String(value); if (value === null) td.className = 'null'; tr.append(td); }
    body.append(tr);
  }
  if (!rows.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = headers.length; td.textContent = 'No matching records.'; tr.append(td); body.append(tr); }
  holder.append(table);
}
async function loadSource(id = $('source-select').value) {
  if (!id) return;
  source = await get('/api/source?id=' + encodeURIComponent(id));
  $('source-meta').textContent = `${source.bytes.toLocaleString()} bytes · SHA-256 ${source.id}`;
  metrics('source-stats', [['Source bytes', source.bytes.toLocaleString()], ['Distinct paths', source.inventory.paths.length], ['Namespace bindings', source.inventory.namespaces.length]]);
  $('namespace-list').replaceChildren();
  for (const ns of source.inventory.namespaces) { const span = document.createElement('span'); span.className = 'namespace'; span.textContent = `${ns.prefix || '(default)'} → ${ns.uri || '(no namespace)'}`; $('namespace-list').append(span); }
  const body = $('inventory').querySelector('tbody'); body.replaceChildren();
  for (const entry of source.inventory.paths) {
    const tr = document.createElement('tr');
    const path = document.createElement('td'), code = document.createElement('code'); code.textContent = JSON.stringify(entry.path); path.append(code);
    const count = document.createElement('td'); count.textContent = entry.count.toLocaleString();
    const shape = document.createElement('td'); shape.textContent = `${entry.leafCount} leaf / ${entry.mixedCount} mixed`;
    const samples = document.createElement('td'); samples.className = 'sample'; samples.textContent = [...entry.samples.map(v => JSON.stringify(v)), ...Object.entries(entry.attributes).map(([k,v]) => `@${k} (${v.count}): ${v.samples.map(s => JSON.stringify(s)).join(', ')}`)].join('\n');
    const pick = document.createElement('td'), button = document.createElement('button'); button.textContent = 'Use record'; button.addEventListener('click', () => { $('record-path').value = JSON.stringify(entry.path); markDirty(); show('mapping'); status('Record path selected. Suggest columns or review the existing explicit mapping.'); }); pick.append(button);
    tr.append(path,count,shape,samples,pick); body.append(tr);
  }
}
const markDirty = () => { dirty = true; $('mapping-state').textContent = 'Edited mapping — build will save these exact choices'; $('mapping-state').className = 'fine mapping-dirty'; };
function property(label, key, value, type = 'text', choices) {
  const field = document.createElement('label'); field.textContent = label;
  const input = choices ? document.createElement('select') : document.createElement(type === 'textarea' ? 'textarea' : 'input');
  input.dataset.key = key;
  if (choices) choices.forEach(v => input.add(new Option(v[1] || v[0], v[0])));
  else if (type !== 'textarea') input.type = type;
  else input.rows = 2;
  input.value = value ?? ''; input.addEventListener('change', markDirty); input.addEventListener('input', markDirty);
  field.append(input); return field;
}
function checkbox(label, key, checked = false) {
  const field = document.createElement('label'); field.className = 'check';
  const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.key = key; input.checked = checked; input.addEventListener('change', markDirty);
  field.append(input, document.createTextNode(label)); return field;
}
function addColumn(c = {}, capabilities = {}) {
  const card = document.createElement('div'); card.className = 'column-card';
  const head = document.createElement('div'); head.className = 'column-head';
  const title = document.createElement('h3'); title.textContent = 'EXPOSED COLUMN';
  const remove = document.createElement('button'); remove.textContent = 'Remove'; remove.addEventListener('click', () => { card.remove(); markDirty(); }); head.append(title,remove);
  const grid = document.createElement('div'); grid.className = 'column-grid';
  grid.append(property('Output name','name',c.name || ''), property('Relative element path (JSON array)','path',JSON.stringify(c.path || []),'textarea'),
    property('Native type','type',c.type || 'string','text',[['string','string — exact text'],['integer','integer — safe integer'],['number','number — IEEE-754'],['boolean','boolean — true / false']]));
  const checks = document.createElement('div');
  for (const [label,key] of [['Equality filter','filters'],['Range filter','ranges'],['Sort','sorts'],['Edition key','keys']]) checks.append(checkbox(label,key,(capabilities[key] || []).includes(c.name)));
  const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Attribute, repeated fields, missing values and text policy';
  const policies = document.createElement('div'); policies.className = 'policy-grid';
  policies.append(property('Attribute (empty = element text)','attribute',c.attribute || ''),
    property('Repeated matches','mode',c.mode || 'single','text',[['single','Exactly one'],['first','First only'],['last','Last only'],['join','Join with separator'],['json','JSON array']]),
    property('Missing selector','missing',c.missing || 'error','text',[['error','Reject record'],['empty','Empty cell'],['default','Explicit default']]),
    property('Mixed / nested text','text',c.text || 'leaf','text',[['leaf','Leaf text only'],['direct','Direct text only'],['descendant','All descendant text']]),
    property('xsi:nil interpretation','nil',c.nil || 'literal','text',[['literal','No special interpretation'],['xsi','Interpret xsi:nil']]),
    property('Join separator','separator',c.separator ?? ', '), property('Default cell string','default',c.default ?? ''));
  details.append(summary,policies,checkbox('Nullable (empty CSV → null)','nullable',Boolean(c.nullable)),checkbox('Trim parsed text','trim',Boolean(c.trim)));
  card.append(head,grid,checks,details); $('columns').append(card);
}
function readPlan() {
  let recordPath; try { recordPath = JSON.parse($('record-path').value); } catch { throw new Error('Record path must be a JSON array of exact XML names.'); }
  const plan = {schema:'stellar-forge.xml-mapping.v1', name:$('dataset-name').value, recordPath, columns:[], filters:[], ranges:[], sorts:[], keys:[], defaultLimit:integer('default-limit'), maxLimit:integer('max-limit'), maxBytes:integer('max-bytes'), maxRows:integer('max-rows'), maxCellChars:integer('max-cell'),allowEmpty:$('allow-empty').checked};
  for (const card of $('columns').children) {
    const values = {}; card.querySelectorAll('[data-key]').forEach(input => values[input.dataset.key] = input.type === 'checkbox' ? input.checked : input.value);
    let path; try { path = JSON.parse(values.path); } catch { throw new Error(`Column ${values.name || '(unnamed)'} needs a JSON-array selector.`); }
    const c = {name:values.name,path,type:values.type,nullable:values.nullable,trim:values.trim,mode:values.mode,missing:values.missing,text:values.text,nil:values.nil};
    if (values.attribute) c.attribute = values.attribute;
    if (values.mode === 'join') c.separator = values.separator;
    if (values.missing === 'default') c.default = values.default;
    plan.columns.push(c);
    for (const key of ['filters','ranges','sorts','keys']) if (values[key]) plan[key].push(c.name);
  }
  return plan;
}
function applyPlan(plan, ident = null) {
  $('dataset-name').value = plan.name; $('record-path').value = JSON.stringify(plan.recordPath);
  for (const [id,key,fallback] of [['default-limit','defaultLimit',50],['max-limit','maxLimit',250],['max-bytes','maxBytes',67108864],['max-rows','maxRows',250000],['max-cell','maxCellChars',65536]]) $(id).value = plan[key] ?? fallback;
  $('allow-empty').checked = Boolean(plan.allowEmpty);
  $('columns').replaceChildren(); plan.columns.forEach(c => addColumn(c,plan)); savedPlan = ident; dirty = !ident;
  $('mapping-state').textContent = ident ? `Saved mapping ${short(ident)}` : 'Edited mapping'; $('mapping-state').className = 'fine';
}
async function savePlan() { const result = await post('/api/plan', readPlan()); savedPlan = result.id; dirty = false; $('mapping-state').textContent = `Saved mapping ${short(savedPlan)}`; await refresh({plan:savedPlan}); return result; }
function suggest() {
  if (!source) throw new Error('Import and select a source edition first.');
  const record = JSON.parse($('record-path').value), candidates = [], names = new Set();
  const add = (path, attribute) => {
    let stem = (attribute || path.at(-1) || 'value').split('}').at(-1).replace(/[^A-Za-z0-9_]/g,'_').slice(0,40);
    if (!/^[A-Za-z]/.test(stem)) stem = 'field_' + stem;
    let name = stem, n = 2; while (names.has(name) || ['constructor','prototype','__proto__'].includes(name)) name = stem + '_' + n++;
    names.add(name); const c = {name,path,type:'string'}; if (attribute) c.attribute = attribute; candidates.push(c);
  };
  for (const entry of source.inventory.paths) {
    if (entry.path.length < record.length || !record.every((v,i) => v === entry.path[i])) continue;
    const relative = entry.path.slice(record.length);
    if (entry.leafCount === entry.count) add(relative);
    for (const attribute of Object.keys(entry.attributes)) add(relative,attribute);
  }
  if (!candidates.length) throw new Error('That record path has no scalar or attribute fields. Inspect its exact expanded names.');
  if (candidates.length > 64) throw new Error('More than 64 fields are available. Add and choose only the columns needed for this dataset.');
  $('columns').replaceChildren(); candidates.forEach(c => addColumn(c)); markDirty(); status(`${candidates.length} string columns suggested. Review multiplicity, missing values, and query capabilities before building.`);
}
function buildStats() {
  const b = state.builds.find(b => b.id === $('build-select').value);
  if (!b) { $('build-stats').replaceChildren(); return; }
  metrics('build-stats', [['Complete rows',b.rowCount.toLocaleString()],['Exposed columns',b.native.columns.length],['Native snapshot',b.native.snapshot,true]]);
  const c = b.native.columns;
  $('query-help').textContent = `Equality: ${c.filter(x=>x.filterable).map(x=>'where_'+x.name).join(', ') || 'none'}. Ranges: ${c.filter(x=>x.rangeFilterable).map(x=>'gt_/gte_/lt_/lte_'+x.name).join(', ') || 'none'}. Sort: ${c.filter(x=>x.sortable).map(x=>x.name).join(', ') || 'none'}. Nulls last; native cursors remain unchanged.`;
}
function parseQuery() { const params = new URLSearchParams($('query-text').value.replace(/^\?/,'')), result = {}; for (const [k,v] of params) { if (Object.hasOwn(result,k)) throw new Error('A native query parameter may occur only once.'); result[k] = v; } delete result.cursor; return result; }
async function runQuery(params, next = false) {
  const id = $('build-select').value; if (!id) throw new Error('Build a retained source edition first.');
  const r = await post('/api/query',{build:id,query:params});
  if (r.response.status !== 200) throw new Error(r.response.body.message || r.response.body.error);
  if (next) historyPages.push(currentParams);
  currentParams = {...params}; cursor = r.response.body.page.nextCursor;
  const body = r.response.body;
  table($('query-result'),body.fields,body.rows.map(row=>body.fields.map(f=>row[f])));
  $('page-meta').textContent = `${body.page.returned.toLocaleString()} returned / ${body.page.total.toLocaleString()} matching rows`;
  status(`Original SF30 query completed · snapshot ${short(body.dataset.snapshot)}`);
}
async function download(path, name) { const r = await request(path), blob = await r.blob(), url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href=url; link.download=name; link.click(); setTimeout(()=>URL.revokeObjectURL(url),3000); status(`Export prepared: ${name}`); }
async function changes(offset = 0) { const page = await get('/api/changes?id='+comparison.id+'&offset='+offset); changeOffset=offset;nextChange=page.nextOffset;table($('changes-result'),['Change','Key','Fields','Before','After'],page.rows.map(r=>[r.kind,r.key,r.fields,r.before,r.after]));$('changes-meta').textContent=`Showing ${page.rows.length} changes from offset ${offset.toLocaleString()}`; }
$('upload').addEventListener('click',()=>action('Retaining exact XML bytes and reading the complete document…',async()=>{
 const file=$('source-file').files[0];if(!file)throw new Error('Choose an XML source file.');
 const r=await (await request('/api/source',{method:'POST',headers:{'Content-Type':'application/xml','X-XML-Name':encodeURIComponent(file.name),'X-XML-Label':encodeURIComponent($('source-label').value || file.name)},body:file})).json();
 await refresh({source:r.id});await loadSource(r.id);show('source');status(`Source retained · ${r.bytes.toLocaleString()} bytes · ${r.inventory.paths.length} paths`);
}));
$('source-select').addEventListener('change',()=>action('Opening retained source edition…',async()=>{await loadSource();status('Retained source edition opened. The saved mapping is unchanged.');}));
$('load-plan').addEventListener('click',()=>action('Opening saved mapping…',async()=>{const id=$('plan-select').value;if(!id)throw new Error('Save a mapping first.');const p=await get('/api/plan?id='+id);applyPlan(p.plan,p.id);show('mapping');status('Saved mapping opened.');}));
$('refresh').addEventListener('click',()=>action('Refreshing retained state…',async()=>{await refresh();if($('source-select').value)await loadSource();status('Retained state refreshed.');}));
$('suggest').addEventListener('click',()=>action('Reading scalar-field suggestions…',async()=>suggest()));
$('add-column').addEventListener('click',()=>{addColumn();markDirty();});
$('show-json').addEventListener('click',()=>action('Reading current mapping…',async()=>{$('mapping-json').value=JSON.stringify(readPlan(),null,2);status('Current mapping JSON is ready for inspection.');}));
$('apply-json').addEventListener('click',()=>action('Applying mapping JSON…',async()=>{const plan=JSON.parse($('mapping-json').value);if(!Array.isArray(plan.columns))throw new Error('Mapping needs a columns array.');applyPlan(plan);markDirty();status('Edited mapping applied to the form. Save or build to validate it.');}));
$('save-plan').addEventListener('click',()=>action('Validating and saving the exact mapping…',async()=>{await savePlan();status('Immutable mapping saved.');}));
$('build').addEventListener('click',()=>action('Projecting every selected record and loading the original SF30 engine…',async()=>{
 const sourceId=$('source-select').value;if(!sourceId)throw new Error('Select a retained source edition.');const mapped=await savePlan();const b=await post('/api/build',{source:sourceId,plan:mapped.id});
 await refresh({'build-select':b.id,'after-select':b.id});historyPages=[];cursor=null;$('query-text').value='limit='+Math.min(25,b.native.maxLimit);show('query');queryBase=parseQuery();await runQuery(queryBase);
}));
$('build-select').addEventListener('change',()=>{historyPages=[];cursor=null;buildStats();$('previous-page').disabled=true;$('next-page').disabled=true;$('page-meta').textContent='Run a query against the selected build.';$('query-result').replaceChildren();$('query-result').classList.add('empty');$('query-result').textContent='Run a query against this selected build.';});
$('run-query').addEventListener('click',()=>action('Running original native query…',async()=>{queryBase=parseQuery();historyPages=[];await runQuery(queryBase);}));
$('next-page').addEventListener('click',()=>action('Reading the next native page…',async()=>{if(cursor)await runQuery({...queryBase,cursor},true);}));
$('previous-page').addEventListener('click',()=>action('Reopening the previous native page…',async()=>{if(historyPages.length)await runQuery(historyPages.pop());}));
$('export-dataset').addEventListener('click',()=>action('Preparing the complete native dataset…',()=>download('/api/dataset-export?build='+$('build-select').value,'sf30-xml-dataset.zip')));
$('export-project').addEventListener('click',()=>action('Preparing the project, including original XML and mapping…',()=>download('/api/export?build='+$('build-select').value,'sf30-xml-project.zip')));
$('import-packet').addEventListener('click',()=>action('Verifying project files and reconstructing the native dataset…',async()=>{
 const file=$('packet-file').files[0];if(!file)throw new Error('Choose a portable project ZIP.');const r=await(await request('/api/import',{method:'POST',headers:{'Content-Type':'application/zip'},body:file})).json();await refresh({source:r.source,plan:r.plan,'build-select':r.build.id});await loadSource(r.source);const p=await get('/api/plan?id='+r.plan);applyPlan(p.plan,p.id);show('query');$('query-text').value='limit='+Math.min(25,r.build.native.maxLimit);queryBase=parseQuery();historyPages=[];await runQuery(queryBase);
}));
$('compare').addEventListener('click',()=>action('Comparing complete keyed editions…',async()=>{comparison=await post('/api/compare',{before:$('before-select').value,after:$('after-select').value});metrics('comparison-stats',Object.entries(comparison.counts).map(([k,v])=>[k,v.toLocaleString()]));await changes();status('Complete edition comparison retained.');}));
$('changes-next').addEventListener('click',()=>action('Reading retained changes…',async()=>{if(nextChange!=null)await changes(nextChange);status('Retained changes opened.');}));
$('download-changes').addEventListener('click',()=>action('Preparing every retained row change…',()=>download('/api/changes/download?id='+comparison.id,'xml-edition-changes.jsonl')));
for(const id of ['before-select','after-select'])$(id).addEventListener('change',()=>{comparison=null;nextChange=null;$('comparison-stats').replaceChildren();$('changes-result').replaceChildren();$('changes-result').classList.add('empty');$('changes-result').textContent='Compare the selected pair to open its retained changes.';$('download-changes').disabled=true;$('changes-next').disabled=true;$('changes-meta').textContent='';});
for(const id of ['allow-empty','dataset-name','record-path','default-limit','max-limit','max-bytes','max-rows','max-cell'])$(id).addEventListener('input',markDirty);
await action('Opening retained workspace…',async()=>{
 if(!token)throw new Error('Open the private console URL printed by this process.');await refresh();
 if($('source-select').value)await loadSource();if($('plan-select').value){const p=await get('/api/plan?id='+$('plan-select').value);applyPlan(p.plan,p.id);}
 status(`${state.sources.length} source editions · ${state.plans.length} mappings · ${state.builds.length} completed native builds`);
});
})();
