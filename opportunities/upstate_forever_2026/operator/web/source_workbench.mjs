/**
 * Source preparation desk for the original Upper Savannah operator.
 * TokenJunkieLabs. Uses the existing native helpers and retained task queue.
 */
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const short = value => String(value || '').slice(0, 12) || '—';
const list = value => Array.isArray(value) ? value : [];
const size = value => {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const units = ['B','KiB','MiB','GiB','TiB'];
  let number = Number(value), unit = 0;
  while (number >= 1024 && unit < units.length - 1) { number /= 1024; unit++; }
  return number.toLocaleString(undefined, {maximumFractionDigits:unit ? 1 : 0}) + ' ' + units[unit];
};
const stamp = value => value ? new Date(value).toLocaleString() : '—';
const canonical = value => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
};
const textButton = (action, label, extra = '', style = '') =>
  '<button type="button" class="' + escapeHTML(style) + '" data-sp-action="' + action + '" ' + extra + '>' + escapeHTML(label) + '</button>';
const selectorValue = selector => selector ? JSON.stringify(selector) : '';
const displayLabel = row => row.title || row.label || row.name || short(row.id);
const taskName = task => task.payload?.title || (task.action === 'source.compose' ? 'Combine source editions' : (task.payload?.method || 'Prepare original source'));
const terminal = state => ['complete','failed','interrupted','cancelled'].includes(state);

export function createSourceWorkbench(host, configuration = {}) {
  const settings = {
    namespace:'source-preparation', storageKey:'upstate-source-workbench-v1',
    prepareAction:'source.prepare', composeAction:'source.compose',
    title:'Prepare study inputs',
    description:'Prepare original elevation, land cover, rainfall and soil data, then import a complete source edition for modeling.',
    ...configuration
  };
  const taskName = task => task.payload?.title || (task.action === settings.composeAction ? 'Combine source editions' : (task.payload?.method || 'Prepare original source'));
  let container = null, workspace = null, catalog = null, loading = false, generation = 0;
  let busy = false, error = '', message = '', currentTask = null, progress = null;
  let tasksFingerprint = '', sourcesFingerprint = '', progressBusy = false, state = null;
  let selectedMethod = '', drafts = {}, mergeDraft = {title:'', prepared:[], collections:[], registered:[], import_sources:true};
  let requests = [], browser = null, browserGeneration = 0, controls = null;
  let operationView = {query:'', status:'all', offset:0}, operationCache = null;
  let resultTask = null, resultDocument = null, resultBusy = false, resultGeneration = 0;
  const local = () => settings.storageKey + ':' + workspace;
  const storageRead = () => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(local()) || '{}');
      selectedMethod = saved.method || '';
      drafts = saved.drafts || {};
      mergeDraft = {...mergeDraft, ...(saved.merge || {})};
      requests = list(saved.requests);
      currentTask = saved.task_id || null;
      operationView = {...operationView, ...(saved.operation_view || {})};
      operationView.offset = Math.max(0, Number(operationView.offset) || 0);
      operationView.query = String(operationView.query || '');
      if (!['all','active','attention','complete'].includes(operationView.status)) operationView.status = 'all';
    } catch { selectedMethod = ''; drafts = {}; requests = []; currentTask = null; }
  };
  const save = () => {
    try {
      sessionStorage.setItem(local(), JSON.stringify({method:selectedMethod, drafts, merge:mergeDraft,
        requests, task_id:currentTask, operation_view:operationView}));
    } catch { /* Native tasks remain retained even when browser storage is unavailable. */ }
  };
  const selected = () => list(catalog?.methods).find(method => method.id === selectedMethod);
  const draft = () => {
    if (!drafts[selectedMethod]) drafts[selectedMethod] = {inputs:{}, options:{}, title:'', import_sources:true};
    const value = drafts[selectedMethod];
    value.inputs ||= {}; value.options ||= {};
    const method = selected();
    for (const field of list(method?.options)) {
      if (!(field.name in value.options) && field.default !== undefined) value.options[field.name] = field.default;
    }
    for (const field of list(method?.inputs)) {
      const proposed = value.inputs[field.name] || field.default;
      const absentBuiltin = proposed?.builtin_id && !list(catalog?.bundled).some(row => row.id === proposed.builtin_id && row.available !== false);
      if (absentBuiltin && value.inputs[field.name]?.builtin_id) value.inputs[field.name] = null;
      if (!(field.name in value.inputs) && field.default && typeof field.default === 'object' && !absentBuiltin) value.inputs[field.name] = field.default;
    }
    return value;
  };
  const activeFor = field => {
    const condition = field.when;
    if (!condition) return true;
    const options = draft().options;
    if (typeof condition === 'string') return Boolean(options[condition]);
    if (typeof condition === 'object' && condition.field)
      return list(condition.in).length ? condition.in.includes(options[condition.field]) : options[condition.field] === condition.equals;
    if (typeof condition === 'object')
      return Object.entries(condition).every(([key, wanted]) => Array.isArray(wanted) ? wanted.includes(options[key]) : options[key] === wanted);
    return true;
  };
  async function read(operation, payload = {}, expectedWorkspace = workspace) {
    return host.api('/api/' + settings.namespace + '/' + operation, {
      method:'POST', body:{workspace:expectedWorkspace, ...payload}
    });
  }
  function ownedTasks() {
    return list(state?.tasks).filter(task => [settings.prepareAction,settings.composeAction].includes(task.action));
  }
  function sourceOperations() {
    const queue = state?.tasks, retained = catalog?.prepared;
    if (operationCache?.queue === queue && operationCache?.retained === retained) return operationCache.rows;
    const indexed = new Map();
    for (const row of list(retained)) {
      if (!row.task_id || ![settings.prepareAction,settings.composeAction].includes(row.action)) continue;
      indexed.set(row.task_id, {id:row.task_id, action:row.action, state:row.state, stage:row.stage,
        payload:{title:row.title, method:row.method}, updated_at:row.updated_at,
        ended_at:row.state === 'complete' ? row.updated_at : null, error:row.error, restored:true,
        result:{source_collection_id:row.source_collection_id, source_count:row.source_count,
          source_id:row.source_id, role:row.role}});
    }
    for (const task of ownedTasks()) {
      const previous = indexed.get(task.id);
      indexed.set(task.id, {...previous, ...task, restored:false, error:task.error || null,
        payload:{...previous?.payload, ...task.payload},
        result:{...previous?.result, ...task.result}});
    }
    const priority = row => ['queued','running'].includes(row.state) ? 0 :
      ['failed','interrupted','cancelled'].includes(row.state) ? 1 : 2;
    const activity = row => row.ended_at || row.updated_at || row.started_at || row.created_at || '';
    const rows = [...indexed.values()].sort((a,b) => priority(a)-priority(b) ||
      activity(b).localeCompare(activity(a)) || String(a.id).localeCompare(String(b.id)));
    operationCache = {queue, retained, rows, byId:indexed};
    return rows;
  }
  function sourceOperation(id) {
    sourceOperations();
    return operationCache.byId.get(id);
  }
  function selectPreparedOperation(id) {
    const task = sourceOperation(id);
    if (!task || task.state !== 'complete') throw new Error('Choose a completed source operation.');
    const collectionId = task.result?.source_collection_id;
    if (collectionId && list(state?.data?.sources).some(row => row.id === collectionId)) {
      mergeDraft.collections = [...new Set([...mergeDraft.collections, collectionId])];
      mergeDraft.prepared = mergeDraft.prepared.filter(value => value !== id);
    } else {
      mergeDraft.prepared = [...new Set([...mergeDraft.prepared, id])];
      if (collectionId) mergeDraft.collections = mergeDraft.collections.filter(value => value !== collectionId);
    }
    mergeDraft.open = true;
    save(); renderForm(); closeResult();
    const target = container?.querySelector('[data-sp-merge-area]');
    target?.scrollIntoView({block:'start', behavior:'smooth'});
    target?.querySelector('[data-sp-compose-title]')?.focus({preventScroll:true});
    message = taskName(task) + ' added to the combined source selection.';
    notice();
  }
  function choices(field) {
    const kinds = list(field.kinds);
    const rows = [];
    const add = (selector, title, group, kind) => {
      if (kinds.length && kind && !kinds.includes(kind)) return;
      if (selector) rows.push({selector, title, group});
    };
    for (const row of list(catalog?.sources)) {
      add(row.selector || {collection_id:row.collection_id, source_id:row.source_id}, displayLabel(row), 'Retained original sources', row.kind);
      for (const companion of list(row.companions))
        add(companion.selector || {collection_id:row.collection_id, source_id:row.source_id, companion_path:companion.path},
          displayLabel(row) + ' / ' + (companion.title || companion.path), 'Original companion files', companion.kind);
    }
    for (const row of list(catalog?.bundled).filter(row => row.available !== false)) add(row.selector || {builtin_id:row.id}, displayLabel(row), 'Application source metadata', row.kind);
    for (const row of list(catalog?.uploads)) add(row.selector || {upload_id:row.id}, displayLabel(row) + ' (' + size(row.bytes) + ')', 'Uploaded originals', row.kind);
    const value = draft().inputs[field.name];
    if (value && !rows.some(row => canonical(row.selector) === canonical(value)))
      rows.unshift({selector:value, title:selectorLabel(value), group:'Current selection'});
    return rows;
  }
  function selectorLabel(value) {
    if (!value) return 'Choose an original file';
    if (value.root_id) return value.path || 'Selected host source';
    if (value.upload_id) return displayLabel(list(catalog?.uploads).find(row => row.id === value.upload_id) || {title:'Uploaded original ' + short(value.upload_id)});
    if (value.builtin_id) return displayLabel(list(catalog?.bundled).find(row => row.id === value.builtin_id) || {title:value.builtin_id});
    const original = list(catalog?.sources).find(row => row.collection_id === value.collection_id && row.source_id === value.source_id);
    return (original ? displayLabel(original) : short(value.source_id)) + (value.companion_path ? ' / ' + value.companion_path : '');
  }
  function inputControl(field) {
    if (!activeFor(field)) return '';
    const value = draft().inputs[field.name], encoded = canonical(value);
    const groups = new Map();
    for (const row of choices(field)) {
      if (!groups.has(row.group)) groups.set(row.group, []);
      groups.get(row.group).push(row);
    }
    const options = [...groups].map(([group, rows]) => '<optgroup label="' + escapeHTML(group) + '">' +
      rows.map(row => '<option value="' + escapeHTML(selectorValue(row.selector)) + '"' +
      (encoded === canonical(row.selector) ? ' selected' : '') + '>' + escapeHTML(row.title) + '</option>').join('') + '</optgroup>').join('');
    return '<div class="sp-field"><label for="sp-input-' + escapeHTML(field.name) + '">' + escapeHTML(field.label || field.name) +
      (field.required ? ' <span aria-hidden="true">*</span>' : '') + '</label><select id="sp-input-' + escapeHTML(field.name) +
      '" data-sp-input="' + escapeHTML(field.name) + '"' + (field.required ? ' required' : '') + '><option value="">Select original input…</option>' +
      options + '</select><div class="sp-field-actions">' +
      (list(catalog?.roots).length ? textButton('browse', 'Choose host file', 'data-sp-field="' + escapeHTML(field.name) + '"') : '') +
      '<label class="sp-upload">Upload original<input type="file" data-sp-upload="' + escapeHTML(field.name) + '"' +
      (field.accept ? ' accept="' + escapeHTML(field.accept) + '"' : '') + '></label>' +
      (value ? textButton('clear-input','Clear','data-sp-field="' + escapeHTML(field.name) + '"') : '') + '</div>' +
      (field.help ? '<p class="sp-help">' + escapeHTML(field.help) + '</p>' : '') + '</div>';
  }
  function optionControl(field) {
    if (!activeFor(field)) return '';
    const value = draft().options[field.name];
    const id = 'sp-option-' + field.name, attr = ' id="' + escapeHTML(id) + '" data-sp-option="' + escapeHTML(field.name) + '"';
    let control = '';
    if (field.type === 'boolean' || field.type === 'checkbox') {
      control = '<label class="sp-checkbox"><input type="checkbox"' + attr + (value ? ' checked' : '') + '> ' + escapeHTML(field.label || field.name) + '</label>';
    } else {
      const choices = list(field.choices || field.options);
      if (choices.length) {
        control = '<select' + attr + (field.required ? ' required' : '') + '>' + choices.map(choice => {
          const optionValue = typeof choice === 'object' ? (choice.value ?? choice.id) : choice;
          const label = typeof choice === 'object' ? (choice.label || choice.title || optionValue) : choice;
          return '<option value="' + escapeHTML(optionValue) + '"' + (String(optionValue) === String(value ?? '') ? ' selected' : '') + '>' + escapeHTML(label) + '</option>';
        }).join('') + '</select>';
      } else if (field.type === 'textarea') {
        control = '<textarea' + attr + (field.required ? ' required' : '') + ' rows="3">' + escapeHTML(value ?? '') + '</textarea>';
      } else {
        const numeric = ['number','integer','float'].includes(field.type);
        control = '<input' + attr + ' type="' + (numeric ? 'number' : 'text') + '" value="' + escapeHTML(value ?? '') + '"' +
          (numeric ? ' step="' + escapeHTML(field.step ?? (field.type === 'integer' ? 1 : 'any')) + '"' : '') +
          (field.min != null ? ' min="' + escapeHTML(field.min) + '"' : '') + (field.max != null ? ' max="' + escapeHTML(field.max) + '"' : '') +
          (field.required ? ' required' : '') + (field.placeholder ? ' placeholder="' + escapeHTML(field.placeholder) + '"' : '') + '>';
      }
      control = '<label for="' + escapeHTML(id) + '">' + escapeHTML(field.label || field.name) +
        (field.required ? ' <span aria-hidden="true">*</span>' : '') + '</label>' + control;
    }
    return '<div class="sp-field">' + control + (field.help ? '<p class="sp-help">' + escapeHTML(field.help) + '</p>' : '') + '</div>';
  }
  function notice() {
    if (!container) return;
    const failure = container.querySelector('[data-sp-error]'), status = container.querySelector('[data-sp-message]');
    if (failure) { failure.hidden = !error; failure.textContent = error; }
    if (status) { status.hidden = !message; status.textContent = message; }
  }
  function setError(value) {
    error = value?.message || String(value || '');
    notice();
  }
  function methodForm() {
    const method = selected(), value = draft();
    if (!method) return '<p class="sp-empty">No source preparation methods were returned by this operator.</p>';
    return '<form data-sp-form><fieldset' + (busy ? ' disabled' : '') + '><legend>' + escapeHTML(method.title) + '</legend>' +
      '<p class="sp-description">' + escapeHTML(method.description || '') + '</p>' +
      '<div class="sp-form-grid"><div class="sp-field sp-wide"><label for="sp-title">Prepared source title</label>' +
      '<input id="sp-title" data-sp-title value="' + escapeHTML(value.title) + '" placeholder="' + escapeHTML(method.title) + '"></div>' +
      list(method.options).map(optionControl).join('') + '</div><h3>Original inputs</h3><div class="sp-form-grid">' +
      list(method.inputs).map(inputControl).join('') + '</div>' +
      '<label class="sp-checkbox sp-import"><input type="checkbox" data-sp-import' + (value.import_sources !== false ? ' checked' : '') +
      '> Import the prepared source into this study when preparation completes</label>' +
      '<p class="sp-help">The original files, native resolution, units and preparation choices stay with the saved source edition.</p>' +
      '<div class="sp-actions"><button type="submit" class="primary">' + (busy ? 'Saving operation…' : 'Prepare selected source') + '</button>' +
      textButton('new-request','Use a new operation for changed input') + '</div></fieldset></form>';
  }
  function selectionBox(kind, id, title, detail, selectedValues) {
    return '<label class="sp-pick"><input type="checkbox" data-sp-merge-kind="' + kind + '" value="' + escapeHTML(id) + '"' +
      (selectedValues.includes(id) ? ' checked' : '') + '><span><strong>' + escapeHTML(title) + '</strong>' +
      (detail ? '<small>' + escapeHTML(detail) + '</small>' : '') + '</span></label>';
  }
  function mergeForm() {
    const prepared = sourceOperations().filter(row => row.state === 'complete')
      .map(row => ({...row, title:taskName(row)}));
    const collections = list(state?.data?.sources);
    const registered = list(state?.registered_sources);
    const items = prepared.map(task => selectionBox('prepared', task.id, task.title, 'Prepared ' + stamp(task.ended_at) + (task.restored ? ' · retained with this study' : ''), mergeDraft.prepared)).join('') +
      collections.map(row => selectionBox('collections', row.id, displayLabel(row), list(row.entries).length + ' original sources', mergeDraft.collections)).join('') +
      registered.map(row => selectionBox('registered', row.id, displayLabel(row), row.entries + ' registered original sources', mergeDraft.registered)).join('');
    return '<details class="sp-merge" data-sp-merge' + (mergeDraft.open ? ' open' : '') + '><summary>Combine prepared inputs and existing source editions</summary>' +
      '<p>Choose the inputs for one source edition. Include the original study geography and parameter sources alongside the prepared rasters.</p>' +
      '<form data-sp-compose-form><fieldset' + (busy ? ' disabled' : '') + '><legend>Combined source edition</legend>' +
      '<div class="sp-field"><label for="sp-compose-title">Source edition title</label><input id="sp-compose-title" data-sp-compose-title value="' +
      escapeHTML(mergeDraft.title) + '" placeholder="Upper Savannah selected model inputs"></div>' +
      '<div class="sp-picks">' + (items || '<p class="sp-empty">Prepare or import a source to make it available here.</p>') + '</div>' +
      '<label class="sp-checkbox"><input type="checkbox" data-sp-compose-import' + (mergeDraft.import_sources !== false ? ' checked' : '') +
      '> Import the combined edition into this study</label><div class="sp-actions"><button class="primary" type="submit"' +
      (!items ? ' disabled' : '') + '>Combine selected sources</button>' + textButton('go-grids','Open model grids') + '</div></fieldset></form></details>';
  }
  function renderForm() {
    if (!container) return;
    const area = container.querySelector('[data-sp-form-area]');
    if (area) area.innerHTML = methodForm();
    const merge = container.querySelector('[data-sp-merge-area]');
    if (merge) merge.innerHTML = mergeForm();
    save();
  }
  function renderTasks() {
    if (!container) return;
    const target = container.querySelector('[data-sp-tasks]');
    if (!target) return;
    const all = sourceOperations(), query = String(operationView.query || '').trim().toLocaleLowerCase();
    const filtered = all.filter(task => {
      const matches = operationView.status === 'all' ||
        (operationView.status === 'active' && ['queued','running'].includes(task.state)) ||
        (operationView.status === 'attention' && ['failed','interrupted','cancelled'].includes(task.state)) ||
        (operationView.status === 'complete' && task.state === 'complete');
      return matches && (!query || [taskName(task),task.id,task.payload?.method,task.action,
        task.result?.source_collection_id,task.result?.source_id].join(' ').toLocaleLowerCase().includes(query));
    });
    const pageSize = 50;
    operationView.offset = Math.min(Math.max(0,operationView.offset), Math.max(0,Math.floor((filtered.length-1)/pageSize)*pageSize));
    const rows = filtered.slice(operationView.offset,operationView.offset+pageSize);
    const statusSelect = container.querySelector('[data-sp-operation-status]');
    if (statusSelect) statusSelect.value = operationView.status;
    const search = container.querySelector('[data-sp-operation-search]');
    if (search && search.value !== operationView.query) search.value = operationView.query;
    const summary = container.querySelector('[data-sp-operation-count]');
    if (summary) summary.textContent = filtered.length ? (operationView.offset+1).toLocaleString() + '–' +
      (operationView.offset+rows.length).toLocaleString() + ' of ' + filtered.length.toLocaleString() +
      (filtered.length !== all.length ? ' matching / '+all.length.toLocaleString()+' total' : ' source operations') :
      (all.length ? 'No matching source operations' : 'No source operations yet');
    target.innerHTML = rows.length ? '<div class="table-scroll"><table><thead><tr><th>Source operation</th><th>Status</th><th>Last activity</th><th>Result</th><th>Actions</th></tr></thead><tbody>' +
      rows.map(task => {
        const result = task.result || {}, collectionId = result.source_collection_id || result.collection_id || result.source_collection?.id;
        const updated = task.ended_at || task.updated_at || task.started_at || task.created_at;
        return '<tr' + (task.id === currentTask ? ' class="sp-current"' : '') + '><td><strong>' + escapeHTML(taskName(task)) +
          '</strong><small class="mono">' + escapeHTML(short(task.id)) + '</small>' +
          (task.restored ? '<small>Retained with this study</small>' : '') + '</td><td><span class="sp-status">' + escapeHTML(task.state) +
          '</span>' + (task.error ? '<small>' + escapeHTML(task.error.message || task.error) + '</small>' : '') + '</td><td>' +
          escapeHTML(stamp(updated)) + (task.stage && task.stage !== task.state ? '<small>' + escapeHTML(task.stage) + '</small>' : '') +
          '</td><td>' + (collectionId ? textButton('open-source','Open imported edition','data-sp-id="' + escapeHTML(collectionId) + '"') :
            (task.state === 'complete' ? 'Prepared originals available for composition' : 'Original selection retained')) +
          (result.source_count ? '<small>'+Number(result.source_count).toLocaleString()+' original sources</small>' : '') +
          '</td><td><div class="sp-row-actions">' +
          textButton('progress','Progress','data-sp-id="' + escapeHTML(task.id) + '"') +
          textButton('open-result','Details / files','data-sp-id="' + escapeHTML(task.id) + '"') +
          (task.state === 'complete' ? textButton('select-prepared','Use in combined edition','data-sp-id="' + escapeHTML(task.id) + '"') : '') +
          (!task.restored && ['failed','interrupted','cancelled'].includes(task.state) ? textButton('resume','Resume','data-sp-id="' + escapeHTML(task.id) + '"') : '') +
          (!task.restored && task.state === 'queued' ? textButton('cancel','Cancel queued','data-sp-id="' + escapeHTML(task.id) + '"') : '') +
          '</div></td></tr>';
      }).join('') + '</tbody></table></div>' :
      '<p class="sp-empty">' + (all.length ? 'Change the search or status to see other retained operations.' :
        'Source operations and their original files appear here after preparation begins. Completed sources remain available when this study is reopened.') + '</p>';
    if (filtered.length > pageSize) target.innerHTML += '<div class="sp-operation-pages">' +
      textButton('operations-previous','Previous 50',operationView.offset ? '' : 'disabled') +
      textButton('operations-next','Next 50',operationView.offset+pageSize < filtered.length ? '' : 'disabled') + '</div>';
  }
  function closeResult() {
    resultGeneration++;
    resultTask = null; resultDocument = null; resultBusy = false;
    container?.querySelector('[data-sp-result]')?.close();
  }
  function resultSummary(values) {
    return '<dl class="sp-result-summary">' + values.filter(([,value]) => value !== undefined && value !== null && value !== '')
      .map(([label,value]) => '<div><dt>'+escapeHTML(label)+'</dt><dd>'+escapeHTML(
        typeof value === 'object' ? JSON.stringify(value) : value)+'</dd></div>').join('')+'</dl>';
  }
  function renderResult() {
    const dialog = container?.querySelector('[data-sp-result]');
    if (!dialog || !resultTask) return;
    const task = sourceOperation(resultTask), document = resultDocument || {};
    const result = document.result || task?.result || {}, observed = document.progress || {};
    const entry = result.source_entry || {}, files = list(document._downloads);
    const title = result.title || (task ? taskName(task) : 'Original source operation');
    const collectionId = result.source_collection_id;
    const status = observed.state || task?.state;
    const details = resultSummary([
      ['State',status], ['Last activity',observed.updated_at ? stamp(observed.updated_at) : null],
      ['Method',result.method || task?.payload?.method], ['Original sources',result.source_count],
      ['Physical sources',result.physical_source_count], ['Source',entry.title || result.source_id],
      ['Role',entry.role || result.role], ['Units',entry.units], ['Edition',entry.vintage],
      ['Native resolution',entry.source_resolution], ['Resampling',entry.resampling],
      ['Null values',entry.null_policy]
    ]);
    const fileRows = files.map((file,index) => {
      const url = String(file.url || ''), download = url + (url.includes('?') ? '&' : '?') + 'download=1';
      return '<div class="sp-result-file"><div><strong>' + escapeHTML(file.label || file.filename || 'Original file') +
        '</strong><small>'+escapeHTML(file.filename || '')+' · '+escapeHTML(size(file.bytes))+'</small>' +
        (file.sha256 ? '<details><summary>File identity</summary><code>'+escapeHTML(file.sha256)+'</code></details>' : '') +
        '</div><div class="sp-row-actions">' +
        (typeof host.openFilePreview === 'function' ? textButton('preview-result-file','Preview','data-sp-file="'+index+'"') : '') +
        (url.startsWith('/api/file/') ? '<a href="'+escapeHTML(download)+'" download>Download</a>' : '') + '</div></div>';
    }).join('');
    const stages = list(document.stages);
    const summary = result.summary && typeof result.summary === 'object' ? result.summary : {};
    const summaryRows = list(summary.rows).filter(row => Array.isArray(row) && row.length === 2);
    const summaryDetails = Object.entries(summary.details || {}).filter(([,value]) => value != null);
    const sourceSummary = summaryRows.length || summaryDetails.length ? '<section><h3>' +
      escapeHTML(summary.title || 'Source summary') + '</h3>' + resultSummary(summaryRows) +
      summaryDetails.map(([label,value]) => '<details><summary>' + escapeHTML(label) +
        '</summary><pre class="sp-log">' + escapeHTML(JSON.stringify(value,null,2)) + '</pre></details>').join('') + '</section>' : '';
    dialog.innerHTML = '<header><div><h2 id="sp-result-title">'+escapeHTML(title)+'</h2><p>' +
      (task?.restored ? 'Saved source preparation in this study' : 'Original source operation') +
      '</p></div>'+textButton('result-close','Close')+'</header>' +
      (resultBusy ? '<p role="status">Reading the saved source result and original files…</p>' : '') +
      (document.error ? '<p class="sp-inline-error" role="alert">'+escapeHTML(document.error)+'</p>' : '') + details + sourceSummary +
      (observed.error ? '<p class="sp-inline-error">'+escapeHTML(observed.error.message || observed.error)+'</p>' : '') +
      '<div class="sp-actions">'+textButton('result-refresh','Refresh result',resultBusy ? 'disabled' : '')+
      (collectionId ? textButton('open-source','Open imported edition','data-sp-id="'+escapeHTML(collectionId)+'"') : '')+
      (collectionId && (result.method || task?.payload?.method) === 'classified-waters'
        ? textButton('open-water-review','Open water source review','data-sp-id="'+escapeHTML(collectionId)+'"','primary') : '')+
      (status === 'complete' ? textButton('select-prepared','Use in combined edition','data-sp-id="'+escapeHTML(resultTask)+'"','primary') : '')+
      (!task?.restored && task ? textButton('open-task','Task history','data-sp-id="'+escapeHTML(resultTask)+'"') : '')+'</div>'+
      '<section><h3>Original files</h3>'+(fileRows || '<p class="sp-help">'+
        (resultBusy ? 'The saved file list is loading.' : 'Original documents appear as the source operation records its result.')+'</p>')+'</section>'+
      (stages.length ? '<details class="sp-result-stages"><summary>Preparation stages</summary><ol class="sp-steps">'+
        stages.map(stage=>'<li><strong>'+escapeHTML(stage.name || stage.label || stage.id)+'</strong> · '+escapeHTML(stage.state || stage.status || '')+
          (stage.started_at ? '<small>'+escapeHTML(stamp(stage.started_at))+(stage.ended_at ? ' — '+escapeHTML(stamp(stage.ended_at)) : '')+'</small>' : '')+'</li>').join('')+
        '</ol></details>' : '')+
      (Object.keys(entry).length ? '<details class="sp-result-native"><summary>Native source description</summary><pre class="sp-log">'+
        escapeHTML(JSON.stringify(entry,null,2))+'</pre></details>' : '');
  }
  async function openResult(id, focus = true) {
    if (!container || !id) return;
    const expected = workspace, version = generation, request = ++resultGeneration;
    resultTask = id; resultBusy = true;
    if (focus) resultDocument = null;
    let dialog = container.querySelector('[data-sp-result]');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'sp-browser sp-result';
      dialog.dataset.spResult = '';
      dialog.setAttribute('aria-labelledby','sp-result-title');
      container.append(dialog);
      dialog.addEventListener('cancel',() => {resultGeneration++;resultTask=null;resultDocument=null;resultBusy=false;},
        {signal:controls.signal});
    }
    renderResult();
    if (focus && !dialog.open) dialog.showModal();
    try {
      const value = await read('result',{task_id:id},expected);
      if (container && workspace === expected && version === generation && request === resultGeneration && resultTask === id)
        resultDocument = value;
    } catch (problem) {
      if (container && workspace === expected && version === generation && request === resultGeneration)
        resultDocument = {...resultDocument,error:problem.message};
    } finally {
      if (container && workspace === expected && version === generation && request === resultGeneration) {
        resultBusy = false; renderResult();
      }
    }
  }
  function renderProgress() {
    const target = container?.querySelector('[data-sp-progress]');
    if (!target) return;
    if (!currentTask) { target.hidden = true; return; }
    target.hidden = false;
    const task = sourceOperation(currentTask);
    const value = progress || {};
    const elapsed = value.elapsed_seconds ?? value.elapsed_s;
    const steps = list(value.stages || value.steps);
    const tail = value.log_tail ?? value.log ?? value.output_tail ?? '';
    const readable = typeof tail === 'string' ? tail : (Array.isArray(tail) ? tail.map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\n') : JSON.stringify(tail, null, 2));
    const native = value.native_progress || {}, completed = native.assembled_tiles ?? native.complete_tiles;
    const total = native.tile_count;
    const hasTiles = Number.isFinite(total) && total > 0 && Number.isFinite(completed);
    const details = [['Workers',native.workers],['Reused tiles',native.reused_tiles],['Failed tiles',native.failed_tiles],
      ['Valid cells',native.valid_cells],['NoData cells',native.nodata_cells]]
      .filter(([,number]) => Number.isFinite(number))
      .map(([label,number]) => '<div><dt>' + escapeHTML(label) + '</dt><dd>' + escapeHTML(number.toLocaleString()) + '</dd></div>').join('');
    const tileProgress = hasTiles ? '<div class="sp-native-progress"><label for="sp-native-tiles">' +
      escapeHTML(completed.toLocaleString()) + ' of ' + escapeHTML(total.toLocaleString()) + ' original tiles ' +
      (native.assembled_tiles != null ? 'assembled' : 'complete') + '</label><progress id="sp-native-tiles" max="' + total + '" value="' +
      Math.max(0,Math.min(total,completed)) + '"></progress><dl class="sp-native-stats">' + details +
      (Number.isFinite(native.received_bytes) ? '<div><dt>Original bytes received</dt><dd>' + escapeHTML(size(native.received_bytes)) + '</dd></div>' : '') + '</dl></div>' : '';
    const ranges = native.schema === 'upstate.original-range-progress/v1';
    const retained = native.retained_bytes, allowance = native.maximum_source_bytes;
    const rangeBytes = [['New original bytes',native.received_bytes_this_invocation],
      ['Reused reads',native.reused_bytes_this_invocation],['Original prefix reads',native.prefix_bytes_this_invocation]]
      .filter(([,number]) => Number.isFinite(number))
      .map(([label,number]) => '<div><dt>' + escapeHTML(label) + '</dt><dd>' + escapeHTML(size(number)) + '</dd></div>').join('');
    const rangeCounts = [['Completed ranges',native.completed_ranges],['Provider requests',native.requests_this_invocation]]
      .filter(([,number]) => Number.isFinite(number))
      .map(([label,number]) => '<div><dt>' + escapeHTML(label) + '</dt><dd>' + escapeHTML(number.toLocaleString()) + '</dd></div>').join('');
    const rangeProgress = ranges && Number.isFinite(retained) && Number.isFinite(allowance) && allowance > 0 ?
      '<div class="sp-native-progress"><label for="sp-native-ranges">Original bytes retained: ' + escapeHTML(size(retained)) +
      ' of ' + escapeHTML(size(allowance)) + ' receiving allowance</label><progress id="sp-native-ranges" max="' + allowance +
      '" value="' + Math.max(0,Math.min(allowance,retained)) + '"></progress><p class="sp-help">This meter shows source storage use. Native preparation stages show completion.</p>' +
      '<dl class="sp-native-stats">' + rangeBytes + rangeCounts + '</dl></div>' : '';
    const nativeProgress = tileProgress + rangeProgress;
    target.innerHTML = '<header class="sp-progress-header"><div><h3>' + escapeHTML(task ? taskName(task) : 'Original source operation') + '</h3>' +
      '<p>' + escapeHTML(value.stage || value.phase || task?.state || 'Reading native progress…') +
      (elapsed != null ? ' · ' + escapeHTML(Number(elapsed).toLocaleString(undefined,{maximumFractionDigits:1})) + ' s elapsed' : '') + '</p></div>' +
      textButton('refresh-progress','Refresh progress') + '</header>' + nativeProgress +
      (steps.length ? '<ol class="sp-steps">' + steps.map(step => '<li><strong>' + escapeHTML(step.label || step.name || step.stage || step.id) + '</strong> ' +
        escapeHTML(step.state || step.status || '') + '</li>').join('') + '</ol>' : '') +
      (value.error ? '<p class="sp-inline-error">' + escapeHTML(value.error.message || value.error) + '</p>' : '') +
      (readable ? '<pre class="sp-log" tabindex="0">' + escapeHTML(readable) + '</pre>' : '<p class="sp-help">Progress is read from the same native operation and its retained helper output.</p>');
  }
  async function fetchProgress() {
    if (!container || !currentTask || progressBusy) return;
    const key = currentTask, expected = workspace, version = generation;
    progressBusy = true;
    try {
      const result = await read('progress', {task_id:key}, expected);
      if (container && expected === workspace && version === generation && key === currentTask) { progress = result; renderProgress(); }
    } catch (problem) {
      if (container && expected === workspace && key === currentTask) {
        progress = {error:problem.message}; renderProgress();
      }
    } finally { if (version === generation) progressBusy = false; }
  }
  async function loadCatalog(force = false) {
    if (!container || loading) return;
    loading = true;
    const expected = workspace, version = generation;
    try {
      const result = await read('catalog', {}, expected);
      if (expected !== workspace || version !== generation || !container) return;
      catalog = result;
      if (!list(catalog.methods).some(method => method.id === selectedMethod)) selectedMethod = list(catalog.methods)[0]?.id || '';
      const select = container.querySelector('[data-sp-method]');
      if (select) select.innerHTML = list(catalog.methods).map(method => '<option value="' + escapeHTML(method.id) + '"' +
        (method.id === selectedMethod ? ' selected' : '') + '>' + escapeHTML(method.title || method.id) + '</option>').join('');
      renderForm(); renderTasks(); renderProgress();
      container.querySelector('[data-sp-loading]').hidden = true;
      if (force) message = 'Source catalogue refreshed from the current study and host.';
      notice();
    } catch (problem) {
      if (expected === workspace && version === generation) setError(problem);
    } finally { if (version === generation) loading = false; }
  }
  async function submit(action, payload) {
    if (busy) return;
    const expected = workspace, version = generation, requestKey = canonical({action, payload, workspace:expected});
    let request = requests.find(row => row.key === requestKey);
    if (!request) { request = {key:requestKey, id:'sourceprep-' + crypto.randomUUID(), at:new Date().toISOString()}; requests.push(request); }
    busy = true; error = ''; message = 'Saving this source operation in the native queue…'; save(); renderForm(); notice();
    try {
      const task = await host.api('/api/actions', {method:'POST', body:{workspace:expected, action, payload, operation_id:request.id}});
      if (workspace !== expected || version !== generation) return;
      currentTask = task.id; progress = null; save();
      message = 'Source operation ' + task.state + '. Its original inputs and task identity are retained.';
      await host.refresh({force:true});
      state = host.getState();
      await loadCatalog();
      await fetchProgress();
      host.toast('Source operation retained.');
    } catch (problem) {
      if (workspace === expected && version === generation) setError(new Error(problem.message + ' The same saved request will be reused when you submit this selection again.'));
    } finally { if (workspace === expected && version === generation) {busy=false;renderForm();renderTasks();notice();} }
  }
  function preparePayload(form) {
    if (!form.reportValidity()) return null;
    const method = selected(), value = draft(), inputs = {}, options = {};
    for (const field of list(method?.inputs)) {
      if (!activeFor(field)) continue;
      const chosen = value.inputs[field.name];
      if (chosen) inputs[field.name] = chosen;
      else if (field.required) throw new Error('Choose ' + (field.label || field.name) + '.');
    }
    for (const field of list(method?.options)) {
      if (!activeFor(field)) continue;
      const chosen = value.options[field.name];
      if (chosen !== '' && chosen != null) options[field.name] = chosen;
      else if (field.required) throw new Error('Enter ' + (field.label || field.name) + '.');
    }
    return {method:selectedMethod, inputs, options, ...(value.title.trim() ? {title:value.title.trim()} : {}), import_sources:value.import_sources !== false};
  }
  async function openBrowser(field) {
    const root = list(catalog?.roots)[0];
    if (!root) throw new Error('Register a source directory on the host or upload the original file.');
    const existing = draft().inputs[field];
    browser = {field, root_id:existing?.root_id || root.id, path:'', offset:0, entries:[], next_offset:null};
    if (existing?.root_id && existing.path.includes('/')) browser.path = existing.path.slice(0, existing.path.lastIndexOf('/'));
    renderBrowser();
    container.querySelector('[data-sp-browser]')?.showModal();
    await browse('');
  }
  function renderBrowser() {
    const old = container?.querySelector('[data-sp-browser]');
    if (old) old.remove();
    if (!browser || !container) return;
    container.insertAdjacentHTML('beforeend','<dialog class="sp-browser" data-sp-browser aria-labelledby="sp-browser-title">' +
      '<header><div><h2 id="sp-browser-title">Choose an original host file</h2><p>Use retained files in the host’s selected source directories.</p></div>' +
      textButton('browser-close','Close') + '</header><label class="sp-field">Source directory<select data-sp-root>' +
      list(catalog.roots).map(root => '<option value="' + escapeHTML(root.id) + '"' + (root.id === browser.root_id ? ' selected' : '') + '>' +
      escapeHTML(root.label || root.id) + '</option>').join('') + '</select></label><div class="sp-browser-path">' +
      textButton('browser-up','Parent directory') + '<code data-sp-path></code></div><div data-sp-files></div>' +
      '<footer>' + textButton('browser-more','More files') + '</footer></dialog>');
    container.querySelector('[data-sp-browser]').addEventListener('close', () => {browser = null;});
  }
  async function browse(path, append = false) {
    if (!browser) return;
    const expected = workspace, version = ++browserGeneration, current = browser;
    if (path !== undefined && path !== '') current.path = path;
    if (!append) current.offset = 0;
    const area = container.querySelector('[data-sp-files]');
    if (!append) area.textContent = 'Reading source directory…';
    try {
      const result = await read('files', {root_id:current.root_id, path:current.path, offset:current.offset, limit:100}, expected);
      if (!container || workspace !== expected || browser !== current || browserGeneration !== version) return;
      current.entries = append ? [...current.entries,...list(result.entries)] : list(result.entries);
      current.next_offset = result.next_offset;
      container.querySelector('[data-sp-path]').textContent = current.path || '/';
      area.innerHTML = current.entries.length ? '<table><thead><tr><th>Original file</th><th>Size</th><th></th></tr></thead><tbody>' +
        current.entries.map(entry => '<tr><td>' + escapeHTML(entry.name) + '</td><td>' + (entry.is_dir ? 'Directory' : escapeHTML(size(entry.bytes))) + '</td><td>' +
          textButton(entry.is_dir ? 'browser-directory' : 'browser-file', entry.is_dir ? 'Open' : 'Select',
            'data-sp-path="' + escapeHTML(entry.path) + '"') + '</td></tr>').join('') + '</tbody></table>' :
        '<p class="sp-empty">This directory has no visible files.</p>';
      container.querySelector('[data-sp-action="browser-more"]').disabled = result.next_offset == null;
    } catch (problem) {
      if (browser === current && container) area.textContent = problem.message;
    }
  }
  async function upload(field, file) {
    if (!file) return;
    const expected = workspace, method = selectedMethod, version = generation;
    const max = state?.limits?.upload_bytes;
    if (max && file.size > max) throw new Error('This file exceeds the operator upload limit of ' + size(max) + '. Choose an existing host source file.');
    busy = true; message = 'Retaining ' + file.name + ' (' + size(file.size) + ')…'; error = ''; notice();
    try {
      const result = await host.api('/api/upload', {method:'POST', raw:file, filename:file.name});
      if (workspace !== expected || selectedMethod !== method || version !== generation) return;
      draft().inputs[field] = {upload_id:result.id}; save();
      await loadCatalog();
      message = file.name + ' is retained and selected.';
    } finally {
      if (workspace === expected && version === generation) {busy=false;renderForm();notice();}
    }
  }
  function change(event) {
    const node = event.target;
    if (node.matches('[data-sp-operation-status]')) {operationView.status=node.value;operationView.offset=0;save();renderTasks();}
    else if (node.matches('[data-sp-method]')) {selectedMethod=node.value;error='';message='';renderForm();notice();}
    else if (node.matches('[data-sp-input]')) {draft().inputs[node.dataset.spInput]=node.value ? JSON.parse(node.value) : null;save();}
    else if (node.matches('[data-sp-option]')) {
      const field = list(selected()?.options).find(row=>row.name===node.dataset.spOption);
      let value = node.type === 'checkbox' ? node.checked : node.value;
      if (value !== '' && ['number','integer','float'].includes(field?.type)) {
        value = Number(value);
        if (!Number.isFinite(value) || ((field.type === 'integer' || field.integer) && !Number.isInteger(value))) {setError('Enter a valid '+(field.label||field.name)+'.');return;}
      }
      draft().options[node.dataset.spOption]=value;save();renderForm();
    } else if (node.matches('[data-sp-import]')) {draft().import_sources=node.checked;save();}
    else if (node.matches('[data-sp-compose-import]')) {mergeDraft.import_sources=node.checked;save();}
    else if (node.matches('[data-sp-merge-kind]')) {
      const kind=node.dataset.spMergeKind, values=new Set(mergeDraft[kind]);
      node.checked?values.add(node.value):values.delete(node.value);mergeDraft[kind]=[...values];
      if (node.checked && kind === 'prepared') {
        const collectionId = sourceOperation(node.value)?.result?.source_collection_id;
        if (collectionId) mergeDraft.collections = mergeDraft.collections.filter(id => id !== collectionId);
      } else if (node.checked && kind === 'collections') {
        mergeDraft.prepared = mergeDraft.prepared.filter(id => sourceOperation(id)?.result?.source_collection_id !== node.value);
      }
      save();
      for (const checkbox of container.querySelectorAll('[data-sp-merge-kind]'))
        checkbox.checked = mergeDraft[checkbox.dataset.spMergeKind].includes(checkbox.value);
    } else if (node.matches('[data-sp-upload]')) upload(node.dataset.spUpload,node.files?.[0]).catch(setError);
    else if (node.matches('[data-sp-root]') && browser) {browser.root_id=node.value;browser.path='';browse('').catch(setError);}
  }
  function input(event) {
    const node=event.target;
    if(node.matches('[data-sp-operation-search]')){operationView.query=node.value;operationView.offset=0;save();renderTasks();}
    else if(node.matches('[data-sp-title]')){draft().title=node.value;save();}
    else if(node.matches('[data-sp-compose-title]')){mergeDraft.title=node.value;save();}
  }
  async function click(event) {
    const button=event.target.closest('[data-sp-action]');
    if(!button || !container?.contains(button))return;
    event.preventDefault();event.stopPropagation();
    const action=button.dataset.spAction,id=button.dataset.spId;
    try {
      error='';notice();
      if(action==='reload')return await loadCatalog(true);
      if(action==='go-grids')return host.navigate('grids');
      if(action==='go-sources')return host.navigate('sources');
      if(action==='browse')return await openBrowser(button.dataset.spField);
      if(action==='clear-input'){draft().inputs[button.dataset.spField]=null;renderForm();return;}
      if(action==='open-source'){closeResult();return host.openItem('sources',id);}
      if(action==='open-water-review'){
        const selectedWorkspace=workspace, selectedCollection=id;
        if(!selectedCollection || host.getWorkspace()!==selectedWorkspace)return;
        closeResult();
        return await host.openExtension('water-source-review','openSource',{
          workspace_key:selectedWorkspace,collection_id:selectedCollection,
          source_id:'classified-water-crosswalk',load_native:true
        });
      }
      if(action==='open-task'){closeResult();return host.showTask(id);}
      if(action==='open-result'){currentTask=id;progress=null;save();renderTasks();renderProgress();return await openResult(id);}
      if(action==='result-close')return closeResult();
      if(action==='result-refresh' && resultTask)return await openResult(resultTask,false);
      if(action==='select-prepared')return selectPreparedOperation(id);
      if(action==='preview-result-file'){
        const file=list(resultDocument?._downloads)[Number(button.dataset.spFile)];
        if(file && typeof host.openFilePreview==='function'){closeResult();return host.openFilePreview(file);}
        return;
      }
      if(action==='operations-previous'||action==='operations-next'){
        operationView.offset=Math.max(0,operationView.offset+(action==='operations-next'?50:-50));save();renderTasks();return;
      }
      if(action==='progress'){currentTask=id;progress=null;save();renderTasks();renderProgress();return await fetchProgress();}
      if(action==='refresh-progress')return await fetchProgress();
      if(action==='resume'||action==='cancel'){
        await host.api('/api/task/'+action,{method:'POST',body:{id}});currentTask=id;save();await host.refresh({force:true});state=host.getState();renderTasks();return await fetchProgress();
      }
      if(action==='new-request'){
        const method=selectedMethod;
        requests=requests.filter(row=>{try{return JSON.parse(row.key).payload?.method!==method;}catch{return true;}});
        save();message='The next preparation will have a new operation identity. Existing originals and tasks remain available.';notice();return;
      }
      if(action==='browser-close'){container.querySelector('[data-sp-browser]')?.close();return;}
      if(action==='browser-up'&&browser){browser.path=browser.path.split('/').filter(Boolean).slice(0,-1).join('/');return await browse('');}
      if(action==='browser-directory'&&browser){browser.path=button.dataset.spPath;return await browse('');}
      if(action==='browser-more'&&browser&&browser.next_offset!=null){browser.offset=browser.next_offset;return await browse('',true);}
      if(action==='browser-file'&&browser){
        draft().inputs[browser.field]={root_id:browser.root_id,path:button.dataset.spPath};save();
        container.querySelector('[data-sp-browser]').close();renderForm();return;
      }
    } catch(problem){setError(problem);}
  }
  async function onSubmit(event) {
    const form=event.target;
    if(!form.matches('[data-sp-form],[data-sp-compose-form]'))return;
    event.preventDefault();event.stopPropagation();
    try{
      if(form.matches('[data-sp-form]')){const payload=preparePayload(form);if(payload)await submit(settings.prepareAction,payload);}
      else {
        if(!form.reportValidity())return;
        if(!mergeDraft.prepared.length&&!mergeDraft.collections.length&&!mergeDraft.registered.length)
          throw new Error('Choose at least one prepared input or source edition to combine.');
        await submit(settings.composeAction,{title:mergeDraft.title.trim()||'Upper Savannah selected model inputs',
          prepared_task_ids:mergeDraft.prepared,source_collection_ids:mergeDraft.collections,registered_ids:mergeDraft.registered,
          import_sources:mergeDraft.import_sources!==false});
      }
    }catch(problem){setError(problem);}
  }
  function mount(target,currentState=host.getState()) {
    const key=host.getWorkspace();
    if(container===target&&workspace===key&&target.querySelector('[data-sp-desk]')){update(currentState);return;}
    suspend();container=target;state=currentState;workspace=key;generation++;catalog=null;progress=null;loading=false;tasksFingerprint='';sourcesFingerprint='';busy=false;error='';message='';
    operationView={query:'',status:'all',offset:0};operationCache=null;resultTask=null;resultDocument=null;resultBusy=false;
    mergeDraft={title:'',prepared:[],collections:[],registered:[],import_sources:true};storageRead();
    container.innerHTML='<div data-sp-desk class="sp-desk"><header class="page-header"><div><p class="eyebrow">UPPER SAVANNAH SCIENTIFIC WORKBENCH</p>' +
      '<h1>' + escapeHTML(settings.title) + '</h1><p>' + escapeHTML(settings.description) + '</p></div><div class="page-actions">' +
      textButton('go-sources','Original sources')+textButton('reload','Refresh catalogue')+'</div></header>' +
      '<div class="sp-notice sp-error" role="alert" data-sp-error hidden></div><div class="sp-notice" role="status" aria-live="polite" data-sp-message hidden></div>' +
      '<section class="section sp-preparation"><div class="sp-method-row"><label for="sp-method">Source to prepare</label><select id="sp-method" data-sp-method></select>' +
      '<span data-sp-loading>Reading available original sources…</span></div><div data-sp-form-area></div></section>' +
      '<section class="section"><header class="section-header"><div><h2>Source operations</h2><p>Inspect original files and progress, continue native work, and reuse saved preparations.</p></div></header>' +
      '<div class="sp-operation-tools"><label class="sp-field"><span>Find an operation</span><input type="search" data-sp-operation-search placeholder="Source, method, or operation ID"></label>' +
      '<label class="sp-field"><span>Status</span><select data-sp-operation-status><option value="all">All operations</option><option value="active">Queued or running</option>' +
      '<option value="attention">Failed, interrupted or cancelled</option><option value="complete">Complete</option></select></label>' +
      '<p data-sp-operation-count role="status" aria-live="polite"></p></div>' +
      '<div data-sp-tasks></div><section class="sp-progress" data-sp-progress hidden></section></section>' +
      '<section class="section" data-sp-merge-area></section>' +
      '<details class="sp-training"><summary>Explain this step</summary><dl><dt>What you do</dt><dd>Select an original file and the preparation choices, then choose Prepare selected source.</dd>' +
      '<dt>What you see</dt><dd>The real preparation enters the native queue. Its progress, original files, units and imported edition remain available.</dd>' +
      '<dt>What it means</dt><dd>The model receives identified inputs aligned through its original grid workflow. A coarser source keeps its recorded original resolution.</dd>' +
      '<dt>What to say</dt><dd>“We keep the original data and the choices used to prepare it, so another operator can update the study and reproduce the same inputs.”</dd></dl></details></div>';
    controls=new AbortController();
    container.addEventListener('click',click,{signal:controls.signal});
    container.addEventListener('change',change,{signal:controls.signal});
    container.addEventListener('input',input,{signal:controls.signal});
    container.addEventListener('submit',onSubmit,{signal:controls.signal});
    container.addEventListener('toggle',event=>{if(event.target.matches('[data-sp-merge]')){mergeDraft.open=event.target.open;save();}}, {capture:true,signal:controls.signal});
    renderTasks();loadCatalog().then(fetchProgress);
  }
  function update(currentState=host.getState()) {
    if(!container||workspace!==host.getWorkspace())return;
    state=currentState;
    const editions=JSON.stringify(list(state?.data?.sources).map(row => row.id));
    if(editions!==sourcesFingerprint){sourcesFingerprint=editions;if(catalog&&!busy)loadCatalog();}
    const next=JSON.stringify(ownedTasks().map(task=>[task.id,task.state,task.started_at,task.ended_at,task.error?.message,task.result?.source_collection_id]));
    if(next!==tasksFingerprint){
      tasksFingerprint=next;renderTasks();
      if(catalog&&!busy){const target=container.querySelector('[data-sp-merge-area]');if(target)target.innerHTML=mergeForm();}
      const task=ownedTasks().find(row=>row.id===currentTask);
      if(task&&terminal(task.state))loadCatalog();
      if(resultTask && !resultBusy) {
        const opened=sourceOperation(resultTask);
        if(opened && terminal(opened.state) && opened.state!==resultDocument?.progress?.state)
          openResult(resultTask,false);
      }
    }
    if(currentTask)fetchProgress();
  }
  function suspend() {
    closeResult();
    controls?.abort();controls=null;
    container?.querySelector('[data-sp-browser]')?.close();
    container=null;browser=null;operationCache=null;generation++;browserGeneration++;loading=false;progressBusy=false;
  }
  return {mount,update,suspend};
}
