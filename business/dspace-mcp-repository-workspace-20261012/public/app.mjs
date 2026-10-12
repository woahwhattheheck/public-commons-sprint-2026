// Industrial local operator interface. All native mutations go through retained core actions.
const $ = selector => document.querySelector(selector);
const clone = value => structuredClone(value);
const pretty = value => JSON.stringify(value, null, 2);
const token = $('meta[name="workspace-token"]').content;
const objectId = value => String(value.uuid ?? value.id ?? '');
const objectType = value => value.type || (value.sections ? 'workspaceitem' : 'item');
const objectTitle = value => value.name || value.metadata?.['dc.title']?.[0]?.value ||
  value.sections?.traditionalpageone?.['dc.title']?.[0]?.value ||
  [value.metadata?.['person.givenName']?.[0]?.value,value.metadata?.['person.familyName']?.[0]?.value].filter(Boolean).join(' ') || objectId(value) || 'Untitled record';
const pointer = value => String(value).replace(/~/g, '~0').replace(/\//g, '~1');
const shortDate = value => value ? new Date(value).toLocaleString(undefined, {timeZoneName:'short'}) : '—';
const sizeLabel = n => Number(n) < 1024 ? n + ' B' : Number(n) < 1048576 ? (Number(n)/1024).toFixed(1) + ' KiB' : (Number(n)/1048576).toFixed(2) + ' MiB';
const keyOf = ref => ref.profile_id + ':' + objectType(ref.object) + ':' + objectId(ref.object);
let state, activeView = 'discover', selectedRecord, selectedPlan, selectedSubmission;
let recordGeneration = 0, planGeneration = 0, busy = false, refreshSequence = 0;
let references = [], captures = new Map(), searchCapture = null, searchPage = 0, searchPages = 0, searchArgs = {};
let chosenSearch = new Set(), successorPlan = null, dialogDownload = null, pendingImport = null;
let pendingReceiveEntry = null;
let browserRequests = [], requestDb;

function element(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key,value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'value') node.value = value;
    else if (key === 'checked') node.checked = !!value;
    else if (key === 'disabled') node.disabled = !!value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
function replace(target, ...children) { const node = typeof target === 'string' ? $(target) : target; node.replaceChildren(...children.flat().filter(Boolean)); return node; }
function button(text, action, attrs = {}) { return element('button', {type:'button', ...attrs, onclick:() => run(action)}, text); }
function label(text, control) { return element('label', {}, text, control); }
function empty(text) { return element('p', {class:'empty'}, text); }
function badge(text) { return element('span', {class:'badge'}, text); }
function details(title, ...children) { return element('details', {}, element('summary', {}, title), ...children); }
function facts(pairs) { return element('dl', {class:'details-grid'}, pairs.flatMap(([name,value]) => [element('dt', {}, name), element('dd', {}, value ?? '—')])); }
function notice(text, error = false) { const n = $('#notice'); n.hidden = !text; n.classList.toggle('error', error); n.textContent = text; }
function profile(id = state?.selected_profile_id) { return state?.profiles.find(p => p.id === id); }
function requireProfile() { const p = profile(); if (!p) throw new Error('Add or select a repository first.'); return p; }
function workProfile(ref) {
  const source = profile(ref.profile_id), selected = profile();
  return selected && selected.base_url === source?.base_url ? selected : source;
}
function operator() {
  const value = $('#operator-name').value.trim();
  if (!value) { $('#operator-name').focus(); throw new Error('Enter an operator attribution before saving an action.'); }
  if (value.length > 160) throw new Error('Operator attribution may be at most 160 characters.');
  localStorage.setItem('repository-workspace-operator', value);
  return value;
}
async function run(action) {
  try { await action(); }
  catch (error) { notice(error.message || String(error), true); }
}
function setBusy(value) {
  busy = value;
  document.body.setAttribute('aria-busy', String(value));
  renderHeader();
}
async function api(path, options = {}) {
  const response = await fetch(path, {...options, headers:{'X-Workspace-Token':token, ...(options.body ? {'Content-Type':'application/json'} : {}), ...options.headers}});
  if (!response.ok) {
    let detail;
    try { detail = await response.json(); } catch { detail = {}; }
    throw Object.assign(new Error(detail.message || 'The workspace returned HTTP ' + response.status + '.'), {status:response.status, code:detail.error, current_revision:detail.current_revision});
  }
  return response;
}
async function read(kind, id, page = {}) {
  const params = new URLSearchParams({offset:page.offset ?? 0, limit:page.limit ?? 100});
  return (await api('/api/records/' + encodeURIComponent(kind) + '/' + encodeURIComponent(id) + '?' + params)).json();
}
async function readCapture(id) {
  if (captures.has(id)) return captures.get(id);
  const first = await read('captures', id);
  // Full objects are part of the complete capture; rows are the paged display convenience.
  if (!Array.isArray(first.objects)) {
    const rows = [...(first.rows || [])];
    while (rows.length < first.total) {
      const next = await read('captures', id, {offset:rows.length});
      if (!next.rows?.length) throw new Error('The saved capture ended before its declared object count.');
      rows.push(...next.rows);
    }
    first.objects = rows;
  }
  captures.set(id, first);
  return first;
}
async function loadCaptures() {
  const missing = state.captures.filter(c => !captures.has(c.id));
  let cursor = 0;
  await Promise.all(Array.from({length:Math.min(4, missing.length)}, async () => {
    while (cursor < missing.length) await readCapture(missing[cursor++].id);
  }));
  references = [];
  const seen = new Set();
  for (const summary of state.captures) {
    const capture = captures.get(summary.id);
    for (const object of capture?.objects || []) {
      const ref = {capture_id:summary.id, profile_id:summary.profile_id, captured_at:summary.created_at, source_mode:summary.source_mode, object};
      const key = keyOf(ref);
      if (!objectId(object) || seen.has(key)) continue;
      seen.add(key);
      references.push(ref);
    }
  }
}
function openRequestDb() {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open('dspace-repository-workspace-requests', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('requests', {keyPath:'id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('The browser could not open its retained request journal: ' + request.error.message));
  });
}
function journal(method, value) {
  return new Promise((resolve,reject) => {
    const tx = requestDb.transaction('requests', method === 'getAll' ? 'readonly' : 'readwrite');
    const store = tx.objectStore('requests');
    const req = value === undefined ? store[method]() : store[method](value);
    let result;
    req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(new Error('The browser request journal could not be saved: ' + tx.error.message));
    tx.onabort = tx.onerror;
  });
}
async function refreshRequests() {
  browserRequests = (await journal('getAll')).sort((a,b) => b.created_at.localeCompare(a.created_at));
  renderPending();
}
async function postSaved(entry) {
  if (busy) throw new Error('A workspace action is still running. Wait for its returned result.');
  setBusy(true);
  entry.status = 'SENDING';
  delete entry.error;
  try {
    await journal('put', entry);
    const result = await (await api('/api/actions/' + entry.action, {method:'POST', body:JSON.stringify(entry.input)})).json();
    entry.status = 'COMPLETE';
    entry.result = result;
    entry.finished_at = new Date().toISOString();
    await journal('put', entry);
    await refresh();
    if (result.is_error) {
      const capture = result.capture_id ? await readCapture(result.capture_id) : null;
      const text = capture?.result?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n');
      notice(text || 'The original repository returned an error. Its source response is retained in Activity.', true);
    } else notice('Saved ' + entry.action.replaceAll('-', ' ') + (result.replayed ? ' using the original request.' : '.'));
    return result;
  } catch (error) {
    entry.status = !error.status || error.status >= 500 || error.status === 403 || error.status === 503 ? 'AWAITING_RESULT' : 'REJECTED';
    entry.error = {message:error.message, code:error.code, status:error.status};
    await journal('put', entry);
    await refresh().catch(() => {});
    throw new Error(error.message + (entry.status === 'AWAITING_RESULT' ? ' Open Activity to retry the saved request with its original identifier.' : ''));
  } finally {
    setBusy(false);
    await refreshRequests();
  }
}
async function act(action, payload) {
  if (busy) throw new Error('A workspace action is still running. Wait for its returned result.');
  const entry = {id:crypto.randomUUID(),action,created_at:new Date().toISOString(),status:'PREPARED',
    input:{...payload,actor:operator(),operationId:null,revision:state.revision}};
  entry.input.operationId = entry.id;
  // Saving the exact request precedes every native or local action.
  await journal('put', entry);
  return postSaved(entry);
}
async function refresh() {
  const sequence = ++refreshSequence;
  const value = await (await api('/api/state')).json();
  if (sequence !== refreshSequence) return;
  state = value;
  await loadCaptures();
  if (sequence !== refreshSequence) return;
  renderHeader(); renderProfiles(); renderBrowseOptions(); renderIndex(); renderPlans(); renderSubmissions(); renderActivity(); renderHandover();
}
function renderHeader() {
  const p = profile(), connection = p?.connection;
  $('#repository-name').textContent = p?.name || 'Choose a repository';
  $('#principal-name').textContent = connection?.principal?.name || connection?.principal?.email ||
    (connection?.authenticated ? 'Authenticated account' : connection ? 'Anonymous' : 'Connection not read');
  $('#workspace-id').textContent = state ? 'Revision ' + state.revision : '—';
  $('#connection-status').textContent = busy ? 'Saving original operation' : connection?.error ? 'Connection needs attention' :
    connection?.authenticated ? 'Account connected' : connection ? 'Public connection' : state ? 'Workspace ready' : 'Opening workspace';
  $('#records-count').textContent = references.filter(r => objectType(r.object) === 'item').length;
  $('#changes-count').textContent = state?.plans.length || 0;
  if (state) replace('#work-summary', ...summaryBoxes());
}
function summaryBoxes() {
  return [['Captures',state.captures.length],['Selections',state.selections.length],['Plans',state.plans.length],['Files',state.assets.length]]
    .map(([name,count]) => element('div', {class:'summary-box'}, element('strong', {}, count), element('span', {}, name)));
}
function options(select, rows, placeholder, previous = select.value) {
  replace(select, element('option', {value:''}, placeholder),
    ...rows.map(row => element('option', {value:row.id}, row.name)));
  if (rows.some(row => row.id === previous)) select.value = previous;
}
function renderProfiles() {
  options($('#profile-select'), state.profiles, 'Add a repository', state.selected_profile_id || '');
  const p = profile();
  $('#profile-description').textContent = p?.base_url || 'Configure the repository you want to operate.';
  $('#connect-profile').disabled = !p;
  $('#edit-profile').disabled = !p;
  if (!state.profiles.length) $('#profile-form').hidden = false;
}
function showProfile(edit = false) {
  const p = edit ? requireProfile() : null;
  $('#previous-profile-id').value = p?.id || '';
  $('#profile-name').value = p?.name || '';
  $('#profile-url').value = p?.base_url || '';
  $('#profile-mode').value = p && Object.values(p.auth_env || {}).some(Boolean) ? 'environment' : 'anonymous';
  $('#profile-token-env').value = p?.auth_env?.token ?? 'DSPACE_TOKEN';
  $('#profile-user-env').value = p?.auth_env?.user ?? 'DSPACE_USER';
  $('#profile-password-env').value = p?.auth_env?.password ?? 'DSPACE_PASSWORD';
  $('#environment-fields').hidden = $('#profile-mode').value !== 'environment';
  $('#profile-form').hidden = false;
  $('#profile-name').focus();
}
function showView(name) {
  activeView = name;
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + name; });
  document.querySelectorAll('[data-view]').forEach(b => {
    if (b.dataset.view === name) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
  });
  history.replaceState(null, '', '#' + name);
}
function sameRepository(ref, p = profile()) { return p && profile(ref.profile_id)?.base_url === p.base_url; }
function browseRows(type) {
  const rows = references.filter(r => sameRepository(r) && objectType(r.object) === type);
  const map = new Map();
  rows.forEach(r => { if (!map.has(objectId(r.object))) map.set(objectId(r.object), {id:objectId(r.object),name:objectTitle(r.object)}); });
  return [...map.values()].sort((a,b) => a.name.localeCompare(b.name));
}
function renderBrowseOptions() {
  options($('#search-community'), browseRows('community'), 'All communities');
  let collections = browseRows('collection');
  const community = $('#search-community').value;
  if (community) {
    const collectionIds = new Set();
    for (const cap of captures.values()) if (cap.profile_id === state.selected_profile_id && cap.tool === 'dspace_list_collections' && cap.args.communityUuid === community) {
      cap.objects.filter(o => objectType(o) === 'collection').forEach(o => collectionIds.add(objectId(o)));
    }
    if (collectionIds.size) collections = collections.filter(c => collectionIds.has(c.id));
  }
  options($('#search-collection'), collections, 'All collections');
  for (const id of ['submission-collection','archive-item-collection']) options($('#'+id), browseRows('collection'), 'Choose a collection');
  options($('#record-scope'), browseRows('collection'), 'All retained material');
  $('#browse-summary').textContent = browseRows('community').length + ' communities · ' + browseRows('collection').length + ' collections retained';
}
function nativePage(capture) {
  for (const request of [...(capture.requests || [])].reverse()) {
    const body = request.body;
    const page = body?._embedded?.searchResult?.page || body?.page;
    if (page && Number.isInteger(page.number)) return page;
  }
  return null;
}
async function capture(tool, args, labelText, profileId = requireProfile().id) {
  const result = await act('capture', {profile_id:profileId,tool,args,label:labelText});
  return readCapture(result.capture_id);
}
async function browseAll(tool, args, labelText) {
  let page = 0, pages = 1;
  do {
    const saved = await capture(tool, {...args,page,size:100}, labelText + ' · page ' + (page+1));
    if (saved.is_error) return;
    const native = nativePage(saved);
    pages = native?.totalPages ?? 1;
    page++;
    $('#browse-summary').textContent = labelText + ': retained page ' + page + ' of ' + pages;
  } while (page < pages);
}
async function search(page = 0, existingArgs) {
  searchArgs = existingArgs || {
    ...($('#search-query').value.trim() ? {query:$('#search-query').value.trim()} : {}),
    ...($('#search-type').value ? {dsoType:$('#search-type').value} : {}),
    ...(($('#search-collection').value || $('#search-community').value) ? {scope:$('#search-collection').value || $('#search-community').value} : {}),
    size:Number($('#search-size').value),
  };
  searchCapture = await capture('dspace_search', {...searchArgs,page}, 'Repository search · page ' + (page+1));
  const native = nativePage(searchCapture);
  searchPage = native?.number ?? page;
  searchPages = native?.totalPages ?? (searchCapture.objects.length ? page+1 : 0);
  chosenSearch = new Set();
  renderSearch(native);
}
function renderSearch(page = nativePage(searchCapture)) {
  if (!searchCapture) return;
  const relevant = searchCapture.objects.filter(o => ['item','community','collection'].includes(objectType(o)) &&
    (!searchArgs.dsoType || objectType(o) === searchArgs.dsoType));
  $('#search-summary').textContent = (page?.totalElements ?? relevant.length) + ' repository results · source captured ' + shortDate(searchCapture.created_at);
  $('#search-page').textContent = searchPages ? 'Page ' + (searchPage+1) + ' of ' + searchPages : 'No pages';
  $('#search-prev').disabled = searchPage <= 0;
  $('#search-next').disabled = searchPage+1 >= searchPages;
  $('#capture-search').disabled = !relevant.length;
  replace('#search-results', ...(relevant.length ? relevant.map(object => {
    const ref = {capture_id:searchCapture.id,profile_id:searchCapture.profile_id,object,captured_at:searchCapture.created_at};
    const key = objectType(object) + ':' + objectId(object);
    const box = element('input', {type:'checkbox',checked:chosenSearch.has(key),'aria-label':'Select ' + objectTitle(object),onchange:e => {
      if (e.target.checked) chosenSearch.add(key); else chosenSearch.delete(key);
    }});
    return element('article', {class:'record-card'},
      element('label', {class:'check-row'}, box, objectTitle(object)),
      element('p', {}, objectType(object) + ' · ' + objectId(object)),
      element('p', {}, (object.metadata?.['dc.contributor.author'] || []).map(v => v.value).join('; ')),
      element('div', {class:'action-row'}, button('Open retained record', () => openRecord(ref)),
        objectType(object) === 'item' && button('Read current item', () => openCurrentItem(objectId(object),searchCapture.profile_id))));
  }) : [empty(searchCapture.is_error ? 'The source response contains an error. Open it in Activity.' : 'This page contains no matching records.')]));
}
async function openCurrentItem(uuid, profileId = requireProfile().id) {
  const cap = await capture('dspace_get_item', {uuid}, 'Item ' + uuid, profileId);
  const object = cap.objects.find(o => o.uuid === uuid && o.type === 'item');
  if (!object) throw new Error('The original item response did not contain this UUID. Open its retained source in Activity.');
  return openRecord({capture_id:cap.id,profile_id:cap.profile_id,object,captured_at:cap.created_at,source_mode:cap.source_mode});
}
function filteredRecords() {
  const term = $('#record-filter').value.trim().toLowerCase();
  const scope = $('#record-scope').value;
  const scopedIds = new Set();
  if (scope) for (const cap of captures.values()) if (profile(cap.profile_id)?.base_url === profile()?.base_url) {
    for (const request of cap.requests || []) {
      let url; try { url = new URL(request.url); } catch { continue; }
      if (url.searchParams.get('scope') !== scope) continue;
      for (const row of request.body?._embedded?.searchResult?._embedded?.objects || []) {
        const object = row._embedded?.indexableObject;
        if (object?.uuid) scopedIds.add(object.uuid);
      }
    }
  }
  return references.filter(r => objectType(r.object) !== 'workspaceitem' && (!scope || sameRepository(r) && scopedIds.has(objectId(r.object))) &&
    (!term || (objectTitle(r.object)+' '+objectId(r.object)+' '+objectType(r.object)+' '+profile(r.profile_id)?.name).toLowerCase().includes(term)));
}
function renderIndex() {
  const rows = filteredRecords();
  replace('#record-index', ...(rows.length ? rows.map(ref => button('', () => openRecord(ref), {class:'record-select','aria-pressed':selectedRecord && keyOf(selectedRecord) === keyOf(ref) ? 'true':'false'}))
    .map((node,index) => { const r=rows[index]; node.append(element('strong', {}, objectTitle(r.object)),element('small', {}, objectType(r.object)+' · '+objectId(r.object)),element('small', {}, profile(r.profile_id)?.name || r.profile_id)); return node; })
    : [empty('No retained records match this filter.')]));
}
async function openRecord(ref) {
  selectedRecord = ref;
  const generation = ++recordGeneration;
  showView('records');
  renderIndex();
  const captureDoc = await readCapture(ref.capture_id);
  if (generation !== recordGeneration) return;
  const object = ref.object;
  const head = element('div', {class:'panel-heading'}, element('div', {}, element('h3', {}, objectTitle(object)),element('p', {class:'mono'}, objectId(object))),badge(objectType(object)));
  const target = workProfile(ref);
  const info = facts([
    ['Repository',profile(ref.profile_id)?.name + ' · ' + profile(ref.profile_id)?.base_url],
    ['Source capture',ref.capture_id],
    ['Captured',shortDate(captureDoc.created_at)],
    ['Native account',captureDoc.principal?.name || captureDoc.principal?.email || 'Anonymous or imported source'],
    ['Source',captureDoc.source_mode || 'native-mcp'],
    ...(object.handle ? [['Handle',object.handle]] : []),
    ...(object.lastModified ? [['Modified',shortDate(object.lastModified)]] : []),
  ]);
  const actions = element('div', {class:'action-row'},
    button('Read complete source', () => showSource('Original item and capture',captureDoc,()=>download('captures',ref.capture_id))),
    button('Download record', () => downloadJson(object,'DSpace_Record_'+objectId(object)+'.json')),
    objectType(object) === 'item' && button('Read current item', () => openCurrentItem(objectId(object),target.id)));
  replace('#record-detail', head,info,actions);
  if (successorPlan) $('#record-detail').append(element('p',{class:'operation-banner'},'Preparing a successor to '+successorPlan+'.'));
  if (object.metadata && objectType(object) === 'item') {
    $('#record-detail').append(metadataEditor(ref), fileControls(ref), moveControls(ref));
  } else $('#record-detail').append(details('Complete native record',element('pre',{},pretty(object))));
}
function metadataEditor(ref) {
  const before = clone(ref.object.metadata || {}), draft = clone(before);
  const form = element('form', {'data-form':'metadata'});
  const fields = element('div');
  const planName = element('input', {value:'Metadata · '+objectTitle(ref.object),required:true,maxlength:160,'aria-label':'Metadata plan name'});
  let serial = 0;
  function renderFields() {
    replace(fields,...Object.entries(draft).map(([field,values]) => {
      const box = element('section', {class:'metadata-field'},element('h4', {}, field));
      if (!Array.isArray(values)) {
        box.append(element('p',{class:'small'},'This native field has a non-array representation.'),element('pre',{},pretty(values)));
        return box;
      }
      values.forEach((value,index) => {
        const source = typeof value === 'object' && value !== null ? value : {value};
        const generated = field.startsWith('relation.') || typeof source.authority === 'string' && source.authority.startsWith('virtual::');
        const rowId = 'metadata-' + (++serial);
        const text = element('textarea', {id:rowId,rows:2,value:String(source.value ?? ''),'data-field':field,'data-value-index':index,readonly:generated,
          oninput:e => { draft[field][index] = {...draft[field][index],value:e.target.value}; }});
        const language = element('input', {value:source.language ?? '',maxlength:60,readonly:generated,'aria-label':field+' language '+(index+1),
          oninput:e => { draft[field][index] = {...draft[field][index],language:e.target.value || null}; }});
        const extra = Object.fromEntries(Object.entries(source).filter(([key]) => !['value','language'].includes(key)));
        const links = generated && source.authority ? [...new Set(Object.entries(before).filter(([key])=>key.startsWith('relation.')).flatMap(([,values])=>Array.isArray(values)?values.filter(v=>v.authority===source.authority&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v.value)).map(v=>v.value):[]))] : [];
        const provenance = element('div',{class:'metadata-provenance'},generated ? 'Linked value · '+(source.authority||field)+'. Edit its related entity.' : Object.keys(extra).length ? 'Retained native properties: '+JSON.stringify(extra) : 'No additional native properties.');
        for(const uuid of links)provenance.append(button('Open linked item',async()=>{
          const retained=references.find(r=>objectType(r.object)==='item'&&objectId(r.object)===uuid&&sameRepository(r,profile(ref.profile_id)));
          if(retained)await openRecord(retained);else await openCurrentItem(uuid,workProfile(ref).id);
        },{title:uuid}));
        box.append(element('div', {class:'metadata-value'},
          label('Value '+(index+1),text),label('Language',language),
          button('Remove',()=>{ draft[field].splice(index,1); renderFields(); },{disabled:generated}),provenance));
      });
      box.append(button('Add value',()=>{draft[field].push({value:'',language:null,authority:null,confidence:-1,place:draft[field].length});renderFields();},{disabled:field.startsWith('relation.')}),
        button('Remove field',()=>{delete draft[field];renderFields();},{class:'remove-field',disabled:field.startsWith('relation.')||values.some(v=>typeof v?.authority==='string'&&v.authority.startsWith('virtual::'))}));
      return values.length>12?details(field+' · '+values.length+' values',box):box;
    }));
  }
  renderFields();
  const newField = element('input', {placeholder:'dc.subject','aria-label':'New metadata field',spellcheck:false});
  const newFieldRow = element('div',{class:'meta-tools'},label('Add metadata field',newField),
    button('Add field',()=>{
      const field=newField.value.trim();
      if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+$/.test(field)) throw new Error('Use a metadata key such as dc.subject or dc.title.alternative.');
      if(field.startsWith('relation.')) throw new Error('The repository controls relation.* fields. Open the related entity to edit its source metadata.');
      if(Object.hasOwn(draft,field)) throw new Error('That field is already present.');
      draft[field]=[{value:'',language:null,authority:null,confidence:-1,place:0}];newField.value='';renderFields();
    }));
  form.append(element('hr'),element('h3',{},'Edit metadata'),
    element('p',{class:'small muted'},'Each value keeps its original language, authority, confidence, ordering and additional properties. Prepare the change to inspect the exact before and after arrays.'),
    label('Operation name',planName),fields,newFieldRow,
    element('div',{class:'action-row'},element('button',{type:'submit',class:'primary'},'Prepare metadata change')),
    details('Original metadata arrays',element('pre',{},pretty(before))));
  form.addEventListener('submit',e=>{e.preventDefault();run(async()=>{
    const operations=[];
    for(const field of new Set([...Object.keys(before),...Object.keys(draft)])){
      if(!Object.hasOwn(draft,field))operations.push({op:'remove',path:'/metadata/'+pointer(field)});
      else if(!Object.hasOwn(before,field))operations.push({op:'add',path:'/metadata/'+pointer(field),value:draft[field]});
      else if(JSON.stringify(before[field])!==JSON.stringify(draft[field]))operations.push({op:'replace',path:'/metadata/'+pointer(field),value:draft[field]});
    }
    if(!operations.length)throw new Error('Change a metadata value before preparing the operation.');
    const result=await act('prepare-plan',{name:planName.value.trim(),profile_id:workProfile(ref).id,
      steps:[{tool:'dspace_update_item_metadata',args:{uuid:objectId(ref.object),operations},source_capture_id:ref.capture_id,subject_id:objectId(ref.object)}],
      ...(successorPlan?{previous_plan_id:successorPlan}:{})});
    successorPlan=null;await openPlan(result.plan_id);
  });});
  return form;
}
function fileControls(ref) {
  const root=element('section',{},element('hr'),element('h3',{},'Files and document text'));
  const output=element('div',{class:'file-results'});
  root.append(element('div',{class:'action-row'},
    button('Read original files',async()=>{const cap=await capture('dspace_get_item_fulltext',{itemUuid:objectId(ref.object)},'Files · '+objectTitle(ref.object),workProfile(ref).id);renderFiles(cap);}),
    button('Read all available text',async()=>{const cap=await capture('dspace_get_item_fulltext',{itemUuid:objectId(ref.object),all:true},'Document text · '+objectTitle(ref.object),workProfile(ref).id);renderFiles(cap);})
  ),output);
  function renderFiles(cap) {
    replace(output,...(cap.result?.content||[]).filter(c=>c.type==='text').map(c=>element('pre',{},c.text)),
      ...cap.objects.filter(o=>o.type==='bitstream').map(o=>element('div',{class:'file-row'},element('strong',{},o.name||o.uuid),
        element('p',{},o.uuid+' · '+sizeLabel(o.sizeBytes||0)),
        button('Receive original file',async()=>{
          const received=await capture('dspace_get_bitstream_content',{bitstreamUuid:o.uuid},'File · '+(o.name||o.uuid),workProfile(ref).id);
          for(const assetId of received.assets||[])await download('assets',assetId);
        }))),
      button('Inspect complete file source',()=>showSource('Original file discovery',cap,()=>download('captures',cap.id))));
  }
  const file=element('input',{type:'file',required:true});
  const bundle=element('input',{value:'ORIGINAL',required:true});
  const description=element('input',{maxlength:1000,placeholder:'Optional file description'});
  const form=element('form',{'data-form':'upload'},label('File to attach',file),
    element('div',{class:'form-grid'},label('Bundle name',bundle),label('Description',description)),
    element('button',{type:'submit'},'Receive file and prepare upload'));
  form.addEventListener('submit',e=>{e.preventDefault();run(async()=>{
    const original=file.files[0];if(!original)throw new Error('Select the original file first.');
    if(original.size>state.limits.asset_bytes)throw new Error('The file exceeds the '+sizeLabel(state.limits.asset_bytes)+' receiving limit.');
    const asset=await act('upload-asset',{name:original.name,media_type:original.type||'application/octet-stream',content_b64:await fileBase64(original)});
    const result=await act('prepare-plan',{name:'Attach '+original.name+' · '+objectTitle(ref.object),profile_id:workProfile(ref).id,
      steps:[{tool:'dspace_upload_bitstream',args:{itemUuid:objectId(ref.object),bundleName:bundle.value.trim(),name:original.name,description:description.value,mimeType:original.type||'application/octet-stream'},source_capture_id:ref.capture_id,subject_id:objectId(ref.object),asset_id:asset.asset_id}]});
    await openPlan(result.plan_id);
  });});
  root.append(details('Attach an original file',form));
  return root;
}
function moveControls(ref) {
  const select=element('select',{required:true});
  const targetProfile=workProfile(ref);
  const collections=references.filter(r=>objectType(r.object)==='collection'&&sameRepository(r,targetProfile));
  const seen=new Set();
  options(select,collections.filter(r=>{const id=objectId(r.object);if(seen.has(id))return false;seen.add(id);return true;}).map(r=>({id:objectId(r.object),name:objectTitle(r.object)})),'Choose destination collection');
  const form=element('form',{},label('New owning collection',select),element('button',{type:'submit'},'Prepare collection move'));
  form.addEventListener('submit',e=>{e.preventDefault();run(async()=>{
    const result=await act('prepare-plan',{name:'Move · '+objectTitle(ref.object),profile_id:targetProfile.id,
      steps:[{tool:'dspace_move_item',args:{itemUuid:objectId(ref.object),targetCollectionUuid:select.value},source_capture_id:ref.capture_id,subject_id:objectId(ref.object)}]});
    await openPlan(result.plan_id);
  });});
  return details('Move this item to another collection',element('p',{class:'small'},'The original tool checks that the destination entity type matches. The plan records the current owning collection before review.'),form);
}
function renderPlans() {
  const filter=$('#plan-filter').value;
  const rows=state.plans.filter(p=>!filter||(filter==='complete'?p.status==='APPLIED':p.status!=='APPLIED'));
  replace('#plan-index',...(rows.length?rows.map(plan=>{
    const node=button('',()=>openPlan(plan.id),{class:'record-select','aria-pressed':selectedPlan===plan.id?'true':'false'});
    node.append(element('strong',{},plan.name),element('small',{},plan.status+' · '+plan.step_count+' steps'),element('small',{},shortDate(plan.created_at)));
    return node;
  }):[empty('No operations match this filter.')]));
}
function shownChange(value) {
  if(value&&typeof value==='object'&&Object.hasOwn(value,'present')) return value.present?pretty(value.value):'(field absent)';
  return pretty(value) ?? '(absent)';
}
async function openPlan(id) {
  selectedPlan=id;const generation=++planGeneration;showView('changes');renderPlans();
  const plan=await read('plans',id);if(generation!==planGeneration)return;
  const p=profile(plan.profile_id);
  const content=[
    element('div',{class:'panel-heading'},element('h3',{},plan.name),badge(plan.status)),
    facts([['Plan',plan.id],['Repository',p?.name+' · '+p?.base_url],['Prepared account',plan.expected_principal?.name||plan.expected_principal?.email||'Account checked again when applied'],
      ['Created',shortDate(plan.created_at)],['Previous plan',plan.previous_plan_id||'—']]),
    element('div',{class:'action-row'},button('Download complete plan',()=>download('plans',id)),
      button('Inspect original plan',()=>showSource('Complete saved plan',plan,()=>download('plans',id)))),
  ];
  for(const step of plan.steps){
    const part=element('section',{class:'operation-step'},element('hr'),element('h3',{},step.id+' · '+step.tool.replace('dspace_','').replaceAll('_',' ')),
      facts([['Subject',step.subject_id||'New repository object'],['Source capture',step.source_capture_id||'Explicit destination collection'],['Retained file',step.asset_id||'—']]));
    if(step.changes?.length)for(const change of step.changes)part.append(element('div',{class:'change-block'},
      element('h4',{},change.path),element('div',{class:'change-columns'},
        element('div',{},element('h5',{},'Before'),element('pre',{},shownChange(change.before))),
        element('div',{},element('h5',{},'After'),element('pre',{},shownChange(change.after))))));
    else part.append(element('div',{class:'change-block'},element('h4',{},'Proposed native operation'),element('pre',{},pretty(step.after))));
    part.append(details('Exact original arguments and preconditions',element('pre',{},pretty({tool:step.tool,args:step.args,preconditions:step.preconditions}))));
    content.push(part);
  }
  if(plan.review)content.push(element('p',{class:'operation-banner'},plan.review.decision+' by '+plan.review.actor+' · '+shortDate(plan.review.at)+'\n'+plan.review.note));
  if(['PREPARED','CHANGES_REQUESTED','APPROVED'].includes(plan.status)){
    const note=element('textarea',{rows:3,required:true,value:plan.review?.note||'',placeholder:'Review the exact fields, destination and account; record your decision.','aria-label':'Review note'});
    const form=element('form',{'data-form':'review'},label('Review note',note),element('div',{class:'action-row'},
      element('button',{type:'submit',class:'primary'},'Approve this plan'),
      button('Request changes',async()=>{if(!note.value.trim())throw new Error('Enter the changes needed in the review note.');await act('review-plan',{plan_id:id,decision:'CHANGES_REQUESTED',note:note.value.trim()});await openPlan(id);})));
    form.addEventListener('submit',e=>{e.preventDefault();run(async()=>{await act('review-plan',{plan_id:id,decision:'APPROVED',note:note.value.trim()});await openPlan(id);});});
    content.push(element('hr'),element('h3',{},'Review decision'),form);
  }
  if(plan.status==='APPROVED'){
    const confirm=element('input',{type:'checkbox',required:true,'aria-label':'Apply this exact reviewed plan'});
    const form=element('form',{'data-form':'execute'},element('label',{class:'check-row'},confirm,'Apply this exact reviewed plan to '+p.name+'.'),
      element('button',{type:'submit',class:'primary'},'Apply reviewed operation'));
    form.addEventListener('submit',e=>{e.preventDefault();run(async()=>{await act('execute-plan',{plan_id:id});await openPlan(id);});});
    content.push(element('hr'),form);
  }
  if(plan.latest_execution_id){
    const execution=await read('executions',plan.latest_execution_id);if(generation!==planGeneration)return;
    content.push(executionPanel(execution,()=>openPlan(id)));
  }
  content.push(successorControls(plan));
  replace('#plan-detail',...content);
}
function executionPanel(execution, after) {
  const root=element('section',{},element('hr'),element('h3',{},'Native execution'),
    facts([['Original request',execution.id],['Account',execution.principal?.name||execution.principal?.email||execution.principal?.uuid],['Status',execution.status],['Updated',shortDate(execution.updated_at)]]));
  for(const step of execution.steps){
    const box=element('div',{class:'record-card'},element('h4',{},step.id+' · '+step.status),
      element('p',{},step.tool+' · '+(step.observed_subject_id||step.subject_id||'No returned subject yet')),
      step.error&&element('p',{class:'operation-banner'},step.error.code+': '+step.error.message),
      element('div',{class:'action-row'},button('Inspect native step',()=>showSource('Native execution '+step.id,step,()=>downloadJson(step,'DSpace_Execution_'+execution.id+'_'+step.id+'.json')))));
    root.append(box);
  }
  root.append(element('div',{class:'action-row'},button('Download complete execution',()=>download('executions',execution.id))));
  if(execution.steps.some(s=>['RUNNING','UNCERTAIN'].includes(s.status))){
    const controls=execution.steps.filter(s=>['RUNNING','UNCERTAIN'].includes(s.status)).map(s=>({step:s,field:element('input',{placeholder:'Optional exact returned UUID or workspace ID','aria-label':'Observed subject for '+s.id})}));
    const form=element('form',{'data-form':'recovery'},
      element('p',{class:'small'},'Recovery reads the original repository and account. For an uncertain creation, you may supply the exact subject returned by that original request.'),
      ...controls.map(c=>label(c.step.id+' observed subject',c.field)),
      element('button',{type:'submit',class:'primary'},'Recover original execution'));
    form.addEventListener('submit',e=>{e.preventDefault();run(async()=>{
      const resolutions=controls.filter(c=>c.field.value.trim()).map(c=>({step_id:c.step.id,subject_id:c.field.value.trim()}));
      await act('recover-execution',{execution_id:execution.id,...(resolutions.length?{resolutions}:{})});await after();
    });});
    root.append(form);
  }
  if(execution.steps.some(s=>['APPLIED','RECOVERED'].includes(s.status)&&['dspace_update_item_metadata','dspace_update_workspace_item','dspace_move_item'].includes(s.tool))){
    root.append(button('Prepare a reversal for review',async()=>{
      const result=await act('prepare-reversal',{execution_id:execution.id,name:'Reverse · '+(state.plans.find(p=>p.id===execution.plan_id)?.name||execution.id)});
      await openPlan(result.plan_id);
    }));
  }
  return root;
}
function successorControls(plan) {
  const steps=plan.steps.map(s=>({tool:s.tool,args:s.args,...(s.source_capture_id?{source_capture_id:s.source_capture_id}:{}),...(s.subject_id?{subject_id:s.subject_id}:{}),...(s.asset_id?{asset_id:s.asset_id}:{})}));
  const name=element('input',{value:('Revision · '+plan.name).slice(0,160),required:true,maxlength:160});
  const input=element('textarea',{rows:12,value:pretty(steps),required:true,spellcheck:false,'aria-label':'Successor native steps'});
  const form=element('form',{},label('Successor name',name),label('Exact original tool steps',input),element('button',{type:'submit'},'Prepare corrected successor'));
  form.addEventListener('submit',e=>{e.preventDefault();run(async()=>{
    const values=JSON.parse(input.value);if(!Array.isArray(values))throw new Error('Supply an array of original native action steps.');
    const result=await act('prepare-plan',{name:name.value.trim(),profile_id:plan.profile_id,steps:values,previous_plan_id:plan.id});await openPlan(result.plan_id);
  });});
  const first=plan.steps.find(s=>s.tool==='dspace_update_item_metadata');
  return details('Prepare a corrected successor',element('p',{class:'small'},'Use a newly captured source when staff changed a planned field. Existing plan and execution records remain available.'),
    first&&button('Read latest item and revise metadata',async()=>{
      const cap=await capture('dspace_get_item',{uuid:first.subject_id},'Successor source · '+first.subject_id,plan.profile_id);
      const object=cap.objects.find(o=>o.type==='item'&&objectId(o)===first.subject_id);
      if(!object)throw new Error('The current item was not returned. Inspect the saved source.');
      successorPlan=plan.id;await openRecord({capture_id:cap.id,profile_id:cap.profile_id,object,captured_at:cap.created_at});
    }),form);
}
function renderSubmissions() {
  const rows=references.filter(r=>objectType(r.object)==='workspaceitem'&&sameRepository(r));
  $('#submission-summary').textContent=rows.length+' retained workspace items';
  replace('#submission-index',...(rows.length?rows.map(ref=>{
    const node=button('',()=>openSubmission(ref),{class:'record-select','aria-pressed':selectedSubmission===keyOf(ref)?'true':'false'});
    node.append(element('strong',{},objectTitle(ref.object)),element('small',{},'Workspace item '+objectId(ref.object)));
    return node;
  }):[empty('Read the submissions available to the selected original account.')]));
}
async function openSubmission(ref) {
  selectedSubmission=keyOf(ref);showView('submissions');renderSubmissions();
  const object=ref.object, sections=object.sections||{};
  const known=[];
  for(const [section,value]of Object.entries(sections))if(value&&typeof value==='object'&&!Array.isArray(value))for(const field of Object.keys(value))known.push('/sections/'+pointer(section)+'/'+pointer(field));
  const paths=element('datalist',{id:'submission-native-paths'},...known.map(p=>element('option',{value:p})));
  const path=element('input',{value:known[0]||'/sections/traditionalpageone/dc.title',list:'submission-native-paths',required:true,spellcheck:false});
  const operation=element('select',{},...['replace','add','remove','move'].map(v=>element('option',{value:v},v)));
  const from=element('input',{placeholder:'Original path for a move operation',spellcheck:false});
  const value=element('textarea',{rows:7,spellcheck:false,'aria-label':'Native submission field value'});
  function fill(){
    const keys=path.value.split('/').slice(1).map(v=>v.replace(/~1/g,'/').replace(/~0/g,'~'));
    let current=object;for(const key of keys)current=current?.[key];
    value.value=current===undefined?'[{"value":"","language":null,"authority":null,"confidence":-1}]':pretty(current);
    operation.value=current===undefined?'add':'replace';
  }
  fill();path.addEventListener('change',fill);
  const form=element('form',{'data-form':'submission-patch',class:'submission-patch'},
    element('h3',{},'Prepare a section update'),label('Original section field path',path),paths,
    element('div',{class:'form-grid'},label('Patch operation',operation),label('Move from path',from)),label('Complete native value, JSON',value),
    element('button',{type:'submit',class:'primary'},'Prepare submission update'));
  form.addEventListener('submit',e=>{e.preventDefault();run(async()=>{
    if(!path.value.startsWith('/sections/'))throw new Error('Choose a field under the original /sections path.');
    const patch={op:operation.value,path:path.value.trim()};
    if(['add','replace'].includes(patch.op))patch.value=JSON.parse(value.value);
    if(patch.op==='move')patch.from=from.value.trim();
    const result=await act('prepare-plan',{name:'Submission '+objectId(object)+' · '+patch.path,profile_id:workProfile(ref).id,
      steps:[{tool:'dspace_update_workspace_item',args:{id:Number(object.id),operations:[patch]},source_capture_id:ref.capture_id,subject_id:objectId(object)}]});await openPlan(result.plan_id);
  });});
  replace('#submission-detail',element('hr'),element('h3',{},objectTitle(object)),
    facts([['Workspace item',objectId(object)],['Original source',ref.capture_id],['Repository',profile(ref.profile_id)?.name]]),
    details('Original submission sections',element('pre',{},pretty(sections))),form,
    button('Inspect complete submission',()=>showSource('Original workspace item',object,()=>downloadJson(object,'DSpace_Submission_'+objectId(object)+'.json'))));
}
function renderPending() {
  const pending=browserRequests.filter(r=>['PREPARED','SENDING','AWAITING_RESULT'].includes(r.status));
  $('#pending-requests').hidden=!pending.length;
  replace('#pending-request-list',...pending.map(entry=>element('article',{class:'record-card'},
    element('h4',{},entry.action.replaceAll('-',' ')),element('p',{class:'mono'},entry.id),
    element('p',{},shortDate(entry.created_at)+' · '+entry.status),entry.error&&element('p',{},entry.error.message),
    element('div',{class:'action-row'},
      button(entry.action==='receive-archive'?'Recover received archive':'Retry saved request',async()=>{
        if(entry.action==='receive-archive')return recoverReceived(entry);
        const result=await postSaved(entry);if(result.plan_id)await openPlan(result.plan_id);
      }),
      button('Inspect saved request',()=>showSource('Original browser request',entry,()=>downloadJson(entry,'DSpace_Request_'+entry.id+'.json')))))));
}
function renderActivity() {
  const filter=$('#activity-filter').value.trim().toLowerCase();
  const rows=[
    ...state.captures.map(c=>({kind:'captures',id:c.id,title:c.label,tool:c.tool,status:c.is_error?'SOURCE ERROR':c.source_mode||'CAPTURED',at:c.created_at})),
    ...state.plans.map(p=>({kind:'plans',id:p.id,title:p.name,tool:p.step_count+' steps',status:p.status,at:p.created_at})),
    ...state.executions.map(e=>({kind:'executions',id:e.id,title:e.id,tool:'Native execution',status:e.status,at:e.updated_at||e.created_at})),
  ].filter(r=>!filter||(r.title+' '+r.id+' '+r.tool+' '+r.status).toLowerCase().includes(filter)).sort((a,b)=>(b.at||'').localeCompare(a.at||''));
  const table=element('table',{},element('thead',{},element('tr',{},...['Time','Operation or source','State','Open'].map(v=>element('th',{},v)))),
    element('tbody',{},...rows.map(row=>element('tr',{},element('td',{},shortDate(row.at)),
      element('td',{},element('strong',{},row.title),element('p',{class:'small'},row.tool),element('code',{},row.id)),
      element('td',{},row.status),element('td',{},button(row.kind==='plans'?'Open plan':'Inspect',()=>row.kind==='plans'?openPlan(row.id):openActivity(row.kind,row.id)))))));
  replace('#activity-table',rows.length?table:empty('No activity matches this filter.'));
}
async function openActivity(kind,id) {
  const doc=kind==='captures'?await readCapture(id):await read(kind,id);
  const requests=kind==='executions'?doc.steps.flatMap(s=>s.requests||[]):doc.requests||[];
  const unique=[...new Map(requests.map(r=>[r.id,r])).values()];
  const children=[element('div',{class:'panel-heading'},element('h3',{},doc.label||doc.name||id),
    button('Download complete record',()=>download(kind,id))),facts([['Identifier',id],['Repository',profile(doc.profile_id)?.name],['Native account',doc.principal?.name||doc.principal?.email||'Anonymous or source import']]),
    kind==='executions'?executionPanel(doc,()=>openActivity(kind,id)):details('Original MCP result',element('pre',{},pretty(doc.result)))];
  for(const request of unique)children.push(element('article',{class:'record-card'},
    element('h4',{},request.method+' · '+(request.status??'Awaiting response')),element('p',{class:'mono'},request.url),
    facts([['Received',shortDate(request.received_at||request.completed_at||request.started_at)],['Original response',sizeLabel(request.body_bytes||0)],['SHA-256',request.body_sha256||'No retained response body']]),
    element('div',{class:'action-row'},
      button('Inspect response',()=>showSource('Original repository response',request,()=>download('responses',request.id))),
      request.body_sha256&&button('Download exact response bytes',()=>download('responses',request.id)))));
  children.push(button('Inspect complete record',()=>showSource('Complete '+kind+' record',doc,()=>download(kind,id))));
  const panel=replace('#activity-detail',...children);panel.hidden=false;showView('activity');panel.scrollIntoView({block:'start'});
}
function renderHandover() {
  replace('#handover-summary',...summaryBoxes());
  replace('#selection-list',...(state.selections.length?state.selections.map(selection=>element('article',{class:'record-card'},element('h4',{},selection.name),
    element('p',{},selection.members.length+' exact source records · '+shortDate(selection.created_at)),
    element('div',{class:'action-row'},button('Open selection',()=>openSelection(selection.id)),button('Download selection',()=>download('selections',selection.id))))):[empty('Saved selections will appear here.')]));
  replace('#asset-list',...(state.assets.length?state.assets.map(asset=>element('article',{class:'file-row'},element('strong',{},asset.name),
    element('p',{},sizeLabel(asset.bytes)+' · '+asset.media_type),element('p',{class:'mono'},asset.sha256),
    button('Download exact file',()=>download('assets',asset.id)))):[empty('No files have been retained yet.')]));
  const p=profile();
  const values=p?[['Repository',p.name],['REST base URL',p.base_url],['Profile',p.id],['Original account',p.connection?.principal?.name||p.connection?.principal?.email||'Anonymous or not read'],
    ['Connected',shortDate(p.connection?.checked_at)],['Configured variable names',Object.entries(p.auth_env||{}).filter(([,v])=>v).map(([k,v])=>k+': '+v).join('\n')||'Anonymous'],
    ['Original source',state.upstream.repository+' · '+state.upstream.commit],['Discovered tools',String(state.tools.length)]]:[['Repository','Add a repository in Discover.']];
  replace('#connection-details',...values.flatMap(([k,v])=>[element('dt',{},k),element('dd',{},v)]));
}
async function openSelection(id) {
  const selection=await read('selections',id);
  const rows=[...(selection.rows||[])];
  while(rows.length<selection.total){const next=await read('selections',id,{offset:rows.length});if(!next.rows.length)throw new Error('The selection ended before its declared count.');rows.push(...next.rows);}
  const items=rows.filter(r=>r.type==='item');
  const field=element('input',{value:'dc.subject',required:true,spellcheck:false});
  const value=element('textarea',{rows:5,value:'[{"value":"","language":null,"authority":null,"confidence":-1,"place":0}]',required:true,spellcheck:false});
  const batch=element('form',{},element('h3',{},'Prepare one field across this selection'),
    element('p',{class:'small'},'Sets the complete named metadata array on each of the '+items.length+' selected items. Review every before and after array in the resulting plan.'),
    label('Metadata field',field),label('Complete replacement value array',value),element('button',{type:'submit'},'Prepare selection metadata plan'));
  batch.addEventListener('submit',e=>{e.preventDefault();run(async()=>{
    if(!items.length||items.length>state.limits.plan_steps)throw new Error('A plan accepts 1–'+state.limits.plan_steps+' selected items.');
    const key=field.value.trim();if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+$/.test(key))throw new Error('Use a repository metadata key such as dc.subject.');
    const values=JSON.parse(value.value);if(!Array.isArray(values)||!values.every(v=>v&&typeof v==='object'&&typeof v.value==='string'))throw new Error('Supply native value objects in a JSON array.');
    const selectedProfile=profile(),sourceProfile=profile(selection.profile_id);
    const result=await act('prepare-plan',{name:(selection.name+' · '+key).slice(0,160),profile_id:selectedProfile?.base_url===sourceProfile?.base_url?selectedProfile.id:sourceProfile.id,
      steps:items.map(r=>({tool:'dspace_update_item_metadata',args:{uuid:String(r.uuid),operations:[{op:Object.hasOwn(r.object.metadata||{},key)?'replace':'add',path:'/metadata/'+pointer(key),value:values}]},source_capture_id:r.capture_id,subject_id:String(r.uuid)}))});
    await openPlan(result.plan_id);
  });});
  showView('records');selectedRecord=null;
  replace('#record-detail',element('h3',{},selection.name),facts([['Selection',selection.id],['Records',String(rows.length)],['Repository',profile(selection.profile_id)?.name]]),
    ...rows.map(r=>element('article',{class:'record-card'},element('h4',{},objectTitle(r.object)),element('p',{},r.type+' · '+r.uuid),
      button('Open original record',()=>r.type==='workspaceitem'?openSubmission({profile_id:selection.profile_id,capture_id:r.capture_id,object:r.object}):openRecord({profile_id:selection.profile_id,capture_id:r.capture_id,object:r.object})))),
    items.length&&details('Batch metadata operation',batch));
}
function showSource(title,value,downloadAction) {
  $('#source-title').textContent=title;
  $('#source-description').textContent='Complete retained source. Download preserves the full original record or response bytes.';
  $('#source-body').textContent=typeof value==='string'?value:pretty(value);
  dialogDownload=downloadAction;
  if(!$('#source-dialog').open)$('#source-dialog').showModal();
}
function blobDownload(blob,filename) {
  const url=URL.createObjectURL(blob),link=element('a',{href:url,download:filename});
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function downloadJson(value,filename) { blobDownload(new Blob([pretty(value)+'\n'],{type:'application/json'}),filename); }
async function download(kind,id) {
  const ticket=await (await api('/api/downloads',{method:'POST',body:JSON.stringify({kind,id})})).json();
  const link=element('a',{href:ticket.url,download:ticket.filename});
  document.body.append(link);link.click();link.remove();
}
async function fileBase64(file) {
  const bytes=new Uint8Array(await file.arrayBuffer());
  let binary='';
  for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
  return btoa(binary);
}
async function inspectArchive(file) {
  if(!file)throw new Error('Select the complete original handover archive.');
  if(busy)throw new Error('A workspace action is still running. Wait for its returned result.');
  const signature=new Uint8Array(await file.slice(0,16).arrayBuffer());
  if(new TextDecoder().decode(signature)!=='SQLite format 3\0'&&!(signature[0]===0x1f&&signature[1]===0x8b))throw new Error('Choose the complete .sqlite handover or a compatible .json.gz archive.');
  if(pendingReceiveEntry&&(pendingReceiveEntry.input.filename!==file.name||pendingReceiveEntry.file_hint.size!==file.size))throw new Error('Select the original '+pendingReceiveEntry.input.filename+' to continue its saved receiving request.');
  const id=pendingReceiveEntry?.id||crypto.randomUUID();
  const entry=pendingReceiveEntry||{id,action:'receive-archive',created_at:new Date().toISOString(),status:'PREPARED',
    input:{receiving_id:id,filename:file.name,actor:operator()},file_hint:{size:file.size,last_modified:file.lastModified}};
  await journal('put',entry);
  pendingReceiveEntry=entry;
  setBusy(true);
  try{
    entry.status='SENDING';delete entry.error;await journal('put',entry);
    const receipt=await (await api('/api/receiving/archive',{method:'POST',body:file,headers:{
      'Content-Type':'application/octet-stream','X-Workspace-Metadata':encodeURIComponent(JSON.stringify(entry.input))
    }})).json();
    entry.status='COMPLETE';entry.result=receipt;entry.finished_at=new Date().toISOString();
    await journal('put',entry);pendingReceiveEntry=null;
    showImportReview(receipt);
    notice('Received and verified the complete archive. Review its original contents before restoring.');
  }catch(error){
    entry.status=!error.status||error.status>=500||error.status===403||error.code==='RECEIVING_RUNNING'?'AWAITING_RESULT':'REJECTED';
    entry.error={message:error.message,code:error.code,status:error.status};await journal('put',entry);
    if(entry.status==='REJECTED')pendingReceiveEntry=null;
    throw error;
  }finally{setBusy(false);await refreshRequests();}
}
function showImportReview(receipt) {
  const preview=receipt.preview;
  pendingImport=receipt;showView('handover');
  const content=[element('h4',{},receipt.filename),facts([
    ['Archive format',preview.format],['Archive size',sizeLabel(receipt.bytes)],['SHA-256',receipt.source_sha256],
    ['Complete records',String(preview.records)],['Retained files',String(preview.files)],
    ['Repository bindings',(preview.profiles||[]).map(p=>p.name+' · '+p.base_url).join('\n')],
    ...Object.entries(preview.counts||{})
  ]),element('p',{class:'small'},'The complete archive, record structure and every original retained file digest have been verified.'),
    button('Restore into this empty workspace',async()=>{
      const result=await act('restore-file',{filename:receipt.filename,receiving_id:receipt.receiving_id,source_sha256:receipt.source_sha256});
      pendingImport=null;$('#import-review').hidden=true;
      notice('Restored '+result.records+' complete records and '+result.files+' retained files.');
    },{class:'primary',disabled:!!(state.profiles.length||state.captures.length||state.plans.length||state.assets.length)})];
  replace('#import-review',...content);$('#import-review').hidden=false;
}
async function recoverReceived(entry) {
  if(busy)throw new Error('A workspace action is still running. Wait for its returned result.');
  try{
    const receipt=await (await api('/api/receiving/archive/'+encodeURIComponent(entry.id))).json();
    entry.status='COMPLETE';entry.result=receipt;entry.finished_at=new Date().toISOString();delete entry.error;
    await journal('put',entry);pendingReceiveEntry=null;await refreshRequests();showImportReview(receipt);
  }catch(error){
    if(error.status===404){
      pendingReceiveEntry=entry;showView('handover');$('#import-file').focus();
      throw new Error('Select the original '+entry.input.filename+' and choose Inspect archive to resume the same receiving request.');
    }
    throw error;
  }
}
function wire() {
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
  $('#refresh-all').addEventListener('click',()=>run(async()=>{await refresh();notice('Read the current saved workspace.');}));
  $('#profile-mode').addEventListener('change',()=>{$('#environment-fields').hidden=$('#profile-mode').value!=='environment';});
  $('#new-profile').addEventListener('click',()=>showProfile());
  $('#edit-profile').addEventListener('click',()=>run(()=>showProfile(true)));
  $('#cancel-profile').addEventListener('click',()=>{$('#profile-form').hidden=true;});
  $('#profile-select').addEventListener('change',()=>run(async()=>{
    const id=$('#profile-select').value;if(!id){showProfile();return;}await act('select-profile',{profile_id:id});
    searchCapture=null;searchPage=0;searchPages=0;chosenSearch=new Set();replace('#search-results',empty('Run a search in the selected repository.'));$('#search-summary').textContent='No search opened for this repository.';
    $('#search-prev').disabled=true;$('#search-next').disabled=true;$('#capture-search').disabled=true;$('#search-page').textContent='—';
  }));
  $('#profile-form').addEventListener('submit',e=>{e.preventDefault();run(async()=>{
    const mode=$('#profile-mode').value;
    const auth_env=mode==='anonymous'?{token:'',user:'',password:''}:{token:$('#profile-token-env').value.trim(),user:$('#profile-user-env').value.trim(),password:$('#profile-password-env').value.trim()};
    for(const name of Object.values(auth_env))if(name&&!/^DSPACE_[A-Z0-9_]+$/.test(name))throw new Error('Use DSPACE_ environment variable names containing uppercase letters, numbers and underscores.');
    await act('save-profile',{name:$('#profile-name').value.trim(),base_url:$('#profile-url').value.trim(),auth_env,
      ...($('#previous-profile-id').value?{previous_profile_id:$('#previous-profile-id').value}:{})});$('#profile-form').hidden=true;
  });});
  $('#operator-name').addEventListener('change',()=>localStorage.setItem('repository-workspace-operator',$('#operator-name').value.trim()));
  $('#connect-profile').addEventListener('click',()=>run(()=>act('connect',{profile_id:requireProfile().id})));
  $('#browse-refresh').addEventListener('click',()=>run(async()=>{await browseAll('dspace_list_communities',{},'Communities');await browseAll('dspace_list_collections',{},'Collections');renderBrowseOptions();}));
  $('#search-community').addEventListener('change',()=>run(async()=>{
    $('#search-collection').value='';if($('#search-community').value)await browseAll('dspace_list_collections',{communityUuid:$('#search-community').value},'Community collections');renderBrowseOptions();
  }));
  $('#search-form').addEventListener('submit',e=>{e.preventDefault();run(()=>search(0));});
  $('#search-prev').addEventListener('click',()=>run(()=>search(searchPage-1,searchArgs)));
  $('#search-next').addEventListener('click',()=>run(()=>search(searchPage+1,searchArgs)));
  $('#capture-search').addEventListener('click',()=>run(async()=>{
    if(!searchCapture)throw new Error('Open a search page first.');
    const all=searchCapture.objects.filter(o=>['item','collection','community'].includes(o.type)&&(!searchArgs.dsoType||o.type===searchArgs.dsoType));
    const picked=chosenSearch.size?all.filter(o=>chosenSearch.has(o.type+':'+objectId(o))):all;
    const name=element('input',{value:('Search selection · '+(searchArgs.query||'page '+(searchPage+1))).slice(0,160),required:true,maxlength:160});
    const form=element('form',{},label('Selection name',name),element('p',{},picked.length+' exact records from this original page.'),element('button',{type:'submit',class:'primary'},'Save original selection'));
    form.addEventListener('submit',e=>{e.preventDefault();run(async()=>{
      const result=await act('save-selection',{name:name.value.trim(),profile_id:searchCapture.profile_id,members:picked.map(o=>({capture_id:searchCapture.id,uuid:objectId(o),type:o.type}))});await openSelection(result.selection_id);
    });});
    replace('#search-results',form);notice('Name the selected source records to retain the selection.');
  }));
  $('#open-item-form').addEventListener('submit',e=>{e.preventDefault();run(()=>openCurrentItem($('#open-item-id').value.trim()));});
  $('#record-filter').addEventListener('input',renderIndex);
  $('#record-scope').addEventListener('change',renderIndex);
  $('#select-filtered-records').addEventListener('click',()=>run(async()=>{
    const rows=filteredRecords().filter(r=>r.object.type==='item');
    if(!rows.length)throw new Error('Filter retained items before creating a selection.');
    if(rows.length>state.limits.selection_items)throw new Error('Narrow the selection to at most '+state.limits.selection_items+' exact items.');
    const urls=new Set(rows.map(r=>profile(r.profile_id)?.base_url));
    if(urls.size!==1)throw new Error('Select a captured collection scope so the selection belongs to one repository.');
    const field=element('input',{required:true,maxlength:160,value:($('#record-scope').selectedOptions[0]?.textContent||'Retained items')+' · selection'});
    const form=element('form',{},element('h3',{},'Save original item selection'),label('Selection name',field),element('p',{},rows.length+' original items retain their exact source capture and UUID.'),element('button',{type:'submit',class:'primary'},'Save selected items'));
    form.addEventListener('submit',e=>{e.preventDefault();run(async()=>{
      const result=await act('save-selection',{name:field.value.trim(),profile_id:workProfile(rows[0]).id,members:rows.map(r=>({capture_id:r.capture_id,uuid:objectId(r.object),type:'item'}))});await openSelection(result.selection_id);
    });});
    replace('#record-detail',form);
  }));
  $('#plan-filter').addEventListener('change',renderPlans);
  $('#refresh-changes').addEventListener('click',()=>run(async()=>{await refresh();if(selectedPlan)await openPlan(selectedPlan);}));
  $('#read-submissions').addEventListener('click',()=>run(async()=>{await browseAll('dspace_list_workspace_items',{},'My submissions');renderSubmissions();}));
  $('#submission-form').addEventListener('submit',e=>{e.preventDefault();run(async()=>{
    const title=$('#submission-title').value.trim();
    const result=await act('prepare-plan',{name:('Start submission · '+title).slice(0,160),profile_id:requireProfile().id,
      steps:[{tool:'dspace_create_workspace_item',args:{owningCollectionUuid:$('#submission-collection').value,metadata:{'dc.title':title}}}]});await openPlan(result.plan_id);
  });});
  $('#archive-item-form').addEventListener('submit',e=>{e.preventDefault();run(async()=>{
    const metadata=JSON.parse($('#archive-item-metadata').value);
    if(!metadata||Array.isArray(metadata)||typeof metadata!=='object'||!Object.values(metadata).every(v=>typeof v==='string'||Array.isArray(v)&&v.every(s=>typeof s==='string')))throw new Error('Use metadata keys with a string or array of strings for each value.');
    const result=await act('prepare-plan',{name:('Create archived item · '+(Array.isArray(metadata['dc.title'])?metadata['dc.title'][0]:metadata['dc.title']||'New item')).slice(0,160),profile_id:requireProfile().id,
      steps:[{tool:'dspace_create_item',args:{owningCollectionUuid:$('#archive-item-collection').value,metadata,discoverable:$('#archive-item-discoverable').checked}}]});await openPlan(result.plan_id);
  });});
  $('#activity-filter').addEventListener('input',renderActivity);
  $('#refresh-activity').addEventListener('click',()=>run(async()=>{await refresh();await refreshRequests();}));
  $('#export-workspace').addEventListener('click',()=>run(()=>download('handoff','current')));
  $('#export-backup').addEventListener('click',()=>run(()=>download('backup','current')));
  $('#import-form').addEventListener('submit',e=>{e.preventDefault();run(()=>inspectArchive($('#import-file').files[0]));});
  $('#source-import-form').addEventListener('submit',e=>{e.preventDefault();run(async()=>{
    const file=$('#source-import-file').files[0];if(!file)throw new Error('Select an original source-capture JSON bundle.');
    if(file.size>24*1024*1024)throw new Error('The source bundle exceeds this 24 MiB browser receiving limit.');
    await act('import-capture',{filename:file.name,content_b64:await fileBase64(file)});$('#source-import-form').reset();notice('Imported the complete original repository capture. Open Records to work with its metadata.');
  });});
  $('#supporting-file-form').addEventListener('submit',e=>{e.preventDefault();run(async()=>{
    const file=$('#supporting-file').files[0];if(!file)throw new Error('Select the original supporting file.');
    if(file.size>state.limits.asset_bytes)throw new Error('The file exceeds the '+sizeLabel(state.limits.asset_bytes)+' receiving limit.');
    await act('upload-asset',{name:file.name,media_type:file.type||'application/octet-stream',content_b64:await fileBase64(file)});$('#supporting-file-form').reset();
  });});
  $('#source-close').addEventListener('click',()=>$('#source-dialog').close());
  $('#source-download').addEventListener('click',()=>run(()=>dialogDownload?.()));
}
async function boot() {
  $('#operator-name').value=localStorage.getItem('repository-workspace-operator')||'';
  requestDb=await openRequestDb();
  wire();
  await refresh();await refreshRequests();
  const view=location.hash.slice(1);if(['discover','records','changes','submissions','activity','handover'].includes(view))showView(view);
}
run(boot);
