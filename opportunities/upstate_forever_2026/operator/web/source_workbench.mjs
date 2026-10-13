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

export function createSourceWorkbench(host) {
  let container = null, workspace = null, catalog = null, loading = false, generation = 0;
  let busy = false, error = '', message = '', currentTask = null, progress = null;
  let tasksFingerprint = '', sourcesFingerprint = '', progressBusy = false, state = null;
  let selectedMethod = '', drafts = {}, mergeDraft = {title:'', prepared:[], collections:[], registered:[], import_sources:true};
  let requests = [], browser = null, browserGeneration = 0, controls = null;
  const local = () => 'upstate-source-workbench-v1:' + workspace;
  const storageRead = () => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(local()) || '{}');
      selectedMethod = saved.method || '';
      drafts = saved.drafts || {};
      mergeDraft = {...mergeDraft, ...(saved.merge || {})};
      requests = list(saved.requests);
      currentTask = saved.task_id || null;
    } catch { selectedMethod = ''; drafts = {}; requests = []; currentTask = null; }
  };
  const save = () => {
    try {
      sessionStorage.setItem(local(), JSON.stringify({method:selectedMethod, drafts, merge:mergeDraft,
        requests:requests.slice(-24), task_id:currentTask}));
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
    return host.api('/api/source-preparation/' + operation, {
      method:'POST', body:{workspace:expectedWorkspace, ...payload}
    });
  }
  function ownedTasks() {
    return list(state?.tasks).filter(task => ['source.prepare','source.compose'].includes(task.action));
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
    const preparedById = new Map(list(catalog?.prepared).filter(row => row.action === 'source.prepare' && row.state === 'complete')
      .map(row => [row.task_id, {id:row.task_id, title:row.title, ended_at:row.updated_at, restored:true}]));
    for (const task of ownedTasks().filter(row => row.action === 'source.prepare' && row.state === 'complete'))
      preparedById.set(task.id, {...task, title:taskName(task)});
    const prepared = [...preparedById.values()];
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
    const tasks = ownedTasks();
    target.innerHTML = tasks.length ? '<div class="table-scroll"><table><thead><tr><th>Source operation</th><th>Status</th><th>Started / completed</th><th>Result</th><th>Actions</th></tr></thead><tbody>' +
      tasks.map(task => {
        const result = task.result || {}, collectionId = result.source_collection_id || result.collection_id || result.source_collection?.id;
        return '<tr' + (task.id === currentTask ? ' class="sp-current"' : '') + '><td><strong>' + escapeHTML(taskName(task)) +
          '</strong><small class="mono">' + escapeHTML(short(task.id)) + '</small></td><td><span class="sp-status">' + escapeHTML(task.state) +
          '</span>' + (task.error ? '<small>' + escapeHTML(task.error.message) + '</small>' : '') + '</td><td>' + escapeHTML(stamp(task.started_at || task.created_at)) +
          '<small>' + escapeHTML(task.ended_at ? stamp(task.ended_at) : (task.state === 'queued' ? 'Waiting in the native queue' : '')) + '</small></td><td>' +
          (collectionId ? textButton('open-source','Open imported edition','data-sp-id="' + escapeHTML(collectionId) + '"') :
            (task.state === 'complete' ? 'Prepared originals available for composition' : 'Preserved in this operation')) + '</td><td><div class="sp-row-actions">' +
          textButton('progress','Progress','data-sp-id="' + escapeHTML(task.id) + '"') +
          textButton('open-task','Details / files','data-sp-id="' + escapeHTML(task.id) + '"') +
          (['failed','interrupted','cancelled'].includes(task.state) ? textButton('resume','Resume','data-sp-id="' + escapeHTML(task.id) + '"') : '') +
          (task.state === 'queued' ? textButton('cancel','Cancel queued','data-sp-id="' + escapeHTML(task.id) + '"') : '') + '</div></td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="sp-empty">Source preparation operations will appear here as soon as they are queued. Closing the browser keeps them in the native queue.</p>';
  }
  function renderProgress() {
    const target = container?.querySelector('[data-sp-progress]');
    if (!target) return;
    if (!currentTask) { target.hidden = true; return; }
    target.hidden = false;
    const task = ownedTasks().find(row => row.id === currentTask);
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
    const nativeProgress = hasTiles ? '<div class="sp-native-progress"><label for="sp-native-tiles">' +
      escapeHTML(completed.toLocaleString()) + ' of ' + escapeHTML(total.toLocaleString()) + ' original tiles ' +
      (native.assembled_tiles != null ? 'assembled' : 'complete') + '</label><progress id="sp-native-tiles" max="' + total + '" value="' +
      Math.max(0,Math.min(total,completed)) + '"></progress><dl class="sp-native-stats">' + details +
      (Number.isFinite(native.received_bytes) ? '<div><dt>Original bytes received</dt><dd>' + escapeHTML(size(native.received_bytes)) + '</dd></div>' : '') + '</dl></div>' : '';
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
    if (node.matches('[data-sp-method]')) {selectedMethod=node.value;error='';message='';renderForm();notice();}
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
      node.checked?values.add(node.value):values.delete(node.value);mergeDraft[kind]=[...values];save();
    } else if (node.matches('[data-sp-upload]')) upload(node.dataset.spUpload,node.files?.[0]).catch(setError);
    else if (node.matches('[data-sp-root]') && browser) {browser.root_id=node.value;browser.path='';browse('').catch(setError);}
  }
  function input(event) {
    const node=event.target;
    if(node.matches('[data-sp-title]')){draft().title=node.value;save();}
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
      if(action==='open-source')return host.openItem('sources',id);
      if(action==='open-task')return host.showTask(id);
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
      if(form.matches('[data-sp-form]')){const payload=preparePayload(form);if(payload)await submit('source.prepare',payload);}
      else {
        if(!form.reportValidity())return;
        if(!mergeDraft.prepared.length&&!mergeDraft.collections.length&&!mergeDraft.registered.length)
          throw new Error('Choose at least one prepared input or source edition to combine.');
        await submit('source.compose',{title:mergeDraft.title.trim()||'Upper Savannah selected model inputs',
          prepared_task_ids:mergeDraft.prepared,source_collection_ids:mergeDraft.collections,registered_ids:mergeDraft.registered,
          import_sources:mergeDraft.import_sources!==false});
      }
    }catch(problem){setError(problem);}
  }
  function mount(target,currentState=host.getState()) {
    const key=host.getWorkspace();
    if(container===target&&workspace===key&&target.querySelector('[data-sp-desk]')){update(currentState);return;}
    suspend();container=target;state=currentState;workspace=key;generation++;catalog=null;progress=null;loading=false;tasksFingerprint='';sourcesFingerprint='';busy=false;error='';message='';
    mergeDraft={title:'',prepared:[],collections:[],registered:[],import_sources:true};storageRead();
    container.innerHTML='<div data-sp-desk class="sp-desk"><header class="page-header"><div><p class="eyebrow">UPPER SAVANNAH SCIENTIFIC WORKBENCH</p>' +
      '<h1>Prepare study inputs</h1><p>Prepare original elevation, land cover, rainfall and soil data, then import a complete source edition for modeling.</p></div><div class="page-actions">' +
      textButton('go-sources','Original sources')+textButton('reload','Refresh catalogue')+'</div></header>' +
      '<div class="sp-notice sp-error" role="alert" data-sp-error hidden></div><div class="sp-notice" role="status" aria-live="polite" data-sp-message hidden></div>' +
      '<section class="section sp-preparation"><div class="sp-method-row"><label for="sp-method">Source to prepare</label><select id="sp-method" data-sp-method></select>' +
      '<span data-sp-loading>Reading available original sources…</span></div><div data-sp-form-area></div></section>' +
      '<section class="section"><header class="section-header"><div><h2>Source operations</h2><p>Inspect progress, resume an interrupted operation, and open its original files.</p></div></header>' +
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
    }
    if(currentTask)fetchProgress();
  }
  function suspend() {
    controls?.abort();controls=null;
    container?.querySelector('[data-sp-browser]')?.close();
    container=null;browser=null;generation++;browserGeneration++;loading=false;progressBusy=false;
  }
  return {mount,update,suspend};
}
