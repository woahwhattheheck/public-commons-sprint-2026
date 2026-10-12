// Print publication panel for the original migration operator.
const SPEC_SCHEMA = 'starforge.migration-publication-spec.v1';
const LOCAL_SCHEMA = 'starforge.migration-cartography-browser.v1';
const FORMATS = [['pdf','PDF map'],['png','PNG map'],['qgz','Editable QGIS project'],['qpt','QGIS layout template'],['plan','Publication plan'],['receipt','Operating record']];
const TERMINAL_REFUSALS = new Set(['REVISION_CHANGED','REQUEST_REUSED','CARTOGRAPHY_COMPARISON_REVIEW','CARTOGRAPHY_REVIEW_NOTE','CARTOGRAPHY_REVIEW_REQUIRED','CARTOGRAPHY_SPEC','CARTOGRAPHY_SPEC_FIELDS','CARTOGRAPHY_OPTIONS','CARTOGRAPHY_PAGE','CARTOGRAPHY_EXTENT','CARTOGRAPHY_PADDING','CARTOGRAPHY_LAYER_SELECTION','CARTOGRAPHY_TEXT','CARTOGRAPHY_PROJECT_CHANGED','CARTOGRAPHY_WORKSPACE_CHANGED']);
const REVIEW_ACTIONS = new Set(['CARTOGRAPHY_COMPARISON_REVIEW','CARTOGRAPHY_REVIEW_NOTE']);

const copy = value => JSON.parse(JSON.stringify(value));
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const resultValue = value => {
  if (value?.ok === false) throw Object.assign(new Error(value.error?.message || value.error?.code || 'The original operation failed.'), value.error || {});
  return value?.ok === true && Object.hasOwn(value,'result') ? value.result : value;
};
const readable = error => error?.message || error?.detail || error?.code || String(error);
const label = value => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = label(text);
  if (className) element.className = className;
  return element;
}
function option(value, text) {
  const element = node('option', text); element.value = value; return element;
}
function details(title, value) {
  const element = node('details');
  element.append(node('summary', title), node('pre', label(value), 'cartography-data'));
  return element;
}
function table(headers, rows) {
  const frame = node('div', undefined, 'cartography-table');
  const element = node('table'), head = node('thead'), header = node('tr'), body = node('tbody');
  for (const title of headers) header.append(node('th', title));
  head.append(header);
  for (const values of rows) {
    const row = node('tr');
    for (const value of values) {
      const cell = node('td');
      if (value instanceof Node) cell.append(value); else cell.textContent = label(value);
      row.append(cell);
    }
    body.append(row);
  }
  element.append(head, body); frame.append(element); return frame;
}
function date(value) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) ? parsed.toLocaleString() : String(value);
}
function bytes(value) {
  if (!Number.isFinite(value)) return '';
  return value < 1024 ? value + ' B' : value < 1048576 ? (value / 1024).toFixed(1) + ' KB' : (value / 1048576).toFixed(1) + ' MB';
}
function projectName(project) {
  return project.title || project.name || project.file?.path?.split('/').at(-1) || project.id;
}
function publicationName(publication) {
  return publication.title || publication.spec?.title || publication.plan?.spec?.title || publication.id;
}
function layerId(layer) { return layer.id || layer.layerId; }
function layerName(layer) { return layer.label || layer.name || layer.title || layer.layerName || layerId(layer); }
function initialDraft() {
  return { schema:SPEC_SCHEMA,projectId:'',title:'',subtitle:'',attribution:'',
    page:{size:'A4',orientation:'landscape',dpi:150},
    map:{extent:'project',layerIds:[],paddingPercent:5},
    legend:{show:true,title:'Legend'},scaleBar:{show:true},
    predecessorPublicationId:null,review:{comparisonSha256:null,note:''} };
}

/**
 * Mount inside the original migration shell.
 * mutate owns the original durable command and preserves explicitly supplied
 * revision/requestId when continuing that same command.
 */
export function mount({root,api,mutate,download,onChange=()=>{},storageKey,getWorkspace}) {
  if (!root || typeof api !== 'function' || typeof mutate !== 'function' ||
      typeof download !== 'function' || typeof getWorkspace !== 'function')
    throw new TypeError('Mount cartography in the original migration operator.');
  let identity = getWorkspace();
  if (!identity?.id || !Number.isSafeInteger(identity.revision))
    throw new TypeError('Open the original migration workspace first.');
  const key = String(storageKey || 'starforge-migration:' + location.origin) + ':cartography:' + identity.id;
  let local = {schema:LOCAL_SCHEMA,workspaceId:identity.id,draft:initialDraft(),selectedPlanId:'',selectedPublicationId:'',pending:null};
  let storageError = null;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.schema === LOCAL_SCHEMA && saved.workspaceId === identity.id && saved.draft?.schema === SPEC_SCHEMA)
        local = {...local,...saved};
    }
  } catch(error) { storageError = error; }
  if (typeof local.useOriginalLayers !== 'boolean') local.useOriginalLayers = !(local.draft.map.layerIds || []).length;
  let inventory = {workspaceId:identity.id,revision:identity.revision,projects:[],plans:[],publications:[],operations:[]};
  let review = null, selectedDocument = null, busy = false, disposed = false;
  let refreshGeneration = 0, documentGeneration = 0, previewGeneration = 0;
  let previewUrl = null, pendingLookup = null;
  const retainedUrls = new Set();
  const listeners = [];
  root.classList.add('cartography');
  root.innerHTML = [
    '<header class="cartography-header"><div><h2>Print publication</h2>',
    '<p>Prepare maps from a saved QGIS project, review source changes, and keep editable layouts with the published files.</p></div>',
    '<button type="button" data-action="refresh">Refresh workspace</button></header>',
    '<p class="cartography-context" data-role="context"></p>',
    '<div class="cartography-notice" data-role="notice" role="status" aria-live="polite"></div>',
    '<section class="cartography-pending" data-role="pending" hidden aria-labelledby="cartography-pending-title">',
    '<h3 id="cartography-pending-title">Original request</h3><div data-role="pending-summary"></div>',
    '<div class="cartography-actions"><button type="button" data-action="check-pending">Check saved result</button>',
    '<button type="button" data-action="resume-pending" hidden>Continue original request</button>',
    '<button type="button" data-action="review-refusal" hidden>Review current state</button></div></section>',
    '<div class="cartography-columns"><aside class="cartography-library">',
    '<section class="cartography-card"><div class="cartography-section-heading"><h3>Saved publications</h3>',
    '<button type="button" data-action="new">New publication</button></div>',
    '<div data-role="publications"></div></section>',
    '<section class="cartography-card"><h3>Prepared plans</h3><div data-role="plans"></div></section>',
    '<section class="cartography-card"><h3>Native operations</h3><div data-role="operations"></div></section></aside>',
    '<div class="cartography-work"><section class="cartography-card" data-role="editor">',
    '<div class="cartography-section-heading"><h3>Layout and source</h3><span data-role="draft-state"></span></div>',
    '<form data-role="form"><div class="cartography-fields">',
    '<label class="cartography-wide">Saved project<select data-field="projectId" required></select></label>',
    '<label class="cartography-wide">Map title<input data-field="title" autocomplete="off" required></label>',
    '<label class="cartography-wide">Subtitle<input data-field="subtitle" autocomplete="off"></label>',
    '<label class="cartography-wide">Attribution<textarea data-field="attribution" rows="2" maxlength="2000" required></textarea></label>',
    '<label>Paper size<select data-field="page.size"><option value="A4">A4</option><option value="A3">A3</option></select></label>',
    '<label>Orientation<select data-field="page.orientation"><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></label>',
    '<label>Resolution<select data-field="page.dpi"><option value="150">150 dpi</option><option value="300">300 dpi</option></select></label>',
    '<label>Map padding (%)<input data-field="map.paddingPercent" type="number" min="0" max="50" step="any"></label>',
    '</div><fieldset><legend>Map extent</legend>',
    '<label class="cartography-check"><input type="radio" name="cartography-extent" value="project" data-role="extent-project">Use the saved project extent</label>',
    '<label class="cartography-check"><input type="radio" name="cartography-extent" value="custom" data-role="extent-custom">Set coordinates in the project CRS</label>',
    '<p data-role="crs" class="cartography-help"></p>',
    '<div class="cartography-fields cartography-coordinates" data-role="coordinates" hidden>',
    '<label>Minimum X<input type="number" step="any" data-coordinate="0"></label>',
    '<label>Minimum Y<input type="number" step="any" data-coordinate="1"></label>',
    '<label>Maximum X<input type="number" step="any" data-coordinate="2"></label>',
    '<label>Maximum Y<input type="number" step="any" data-coordinate="3"></label></div></fieldset>',
    '<fieldset><legend>Project layers</legend>',
    '<label class="cartography-check"><input type="checkbox" data-role="visible-layers">Use the original visible layers and their saved order</label>',
    '<div data-role="layers"></div><p class="cartography-help">Saved symbology, labels and their resources stay with the selected project.</p></fieldset>',
    '<fieldset><legend>Map furniture</legend><div class="cartography-fields">',
    '<label class="cartography-check"><input type="checkbox" data-field="legend.show">Show legend</label>',
    '<label>Legend title<input data-field="legend.title"></label>',
    '<label class="cartography-check cartography-wide"><input type="checkbox" data-field="scaleBar.show">Show scale bar</label></div></fieldset>',
    '<label>Correct an earlier publication<select data-field="predecessorPublicationId"></select></label>',
    '<p class="cartography-help">A correction keeps the earlier files and records the reviewed source and layout changes.</p>',
    '<div class="cartography-actions"><button type="submit" data-action="preview">Review layout and sources</button></div>',
    '</form></section>',
    '<section class="cartography-card" data-role="review-card" hidden><h3>Review publication</h3>',
    '<div data-role="review-content"></div>',
    '<label>Review note<textarea data-role="review-note" rows="3"></textarea></label>',
    '<label class="cartography-check"><input type="checkbox" data-role="review-accepted">I reviewed this layout and its source changes.</label>',
    '<div class="cartography-actions"><button type="button" data-action="save-plan">Save reviewed plan</button></div></section>',
    '<section class="cartography-card" data-role="selected-plan" hidden><h3>Prepared publication</h3>',
    '<div data-role="selected-plan-content"></div><div class="cartography-actions">',
    '<button type="button" data-action="render">Render saved plan</button>',
    '<button type="button" data-action="edit-plan">Use plan as a new draft</button></div></section>',
    '<section class="cartography-card" data-role="publication" hidden><div class="cartography-section-heading">',
    '<h3>Published files</h3><button type="button" data-action="correct">Prepare a correction</button></div>',
    '<div data-role="publication-content"></div><div class="cartography-actions" data-role="downloads"></div>',
    '<div class="cartography-preview" data-role="map-preview"></div>',
    '<div class="cartography-actions"><button type="button" data-action="show-preview">Open rendered preview</button>',
    '<button type="button" data-action="reopen">Reopen editable publication</button></div>',
    '<div data-role="reopened"></div></section></div></div>'
  ].join('');
  const $ = selector => root.querySelector(selector);
  const $$ = selector => [...root.querySelectorAll(selector)];
  const role = name => $('[data-role="' + name + '"]');
  function listen(element,event,fn) { element.addEventListener(event,fn); listeners.push(()=>element.removeEventListener(event,fn)); }
  function note(message, kind='') {
    if (disposed) return;
    role('notice').textContent = label(message);
    role('notice').dataset.kind = kind;
  }
  function save(required=false) {
    try { localStorage.setItem(key, JSON.stringify(local)); storageError = null; return true; }
    catch(error) {
      storageError = error;
      if (required) throw new Error('This browser cannot retain the original request. Restore browser storage before starting the operation.');
      note('The browser could not save this draft. Keep the page open while restoring browser storage.','error');
      return false;
    }
  }
  function ensureWorkspace() {
    const current = getWorkspace();
    if (current?.id !== identity.id) throw new Error('The operator opened another workspace. Reopen its print-publication panel.');
    return current;
  }
  function button(text,action,className) {
    const element = node('button',text,className); element.type = 'button';
    element.addEventListener('click',()=>guard(action)); return element;
  }
  async function guard(fn) { try { await fn(); } catch(error) { note(readable(error),'error'); } }
  function setBusy(value) {
    busy = value;
    root.setAttribute('aria-busy', String(value));
    updateControls();
  }
  function canReviewSave() {
    return !!review && (review.ready === true || (review.issues?.length > 0 && review.issues.every(issue=>REVIEW_ACTIONS.has(issue.code))));
  }
  function acceptsRequest(pending,value,record) {
    return !!record && (record.requestId===pending.requestId ||
      (pending.command==='cartography.save-plan' && value.event?.requestId===pending.requestId && value.event?.action==='cartography.plan-saved'));
  }
  function updateControls() {
    if (disposed) return;
    const pending = !!local.pending;
    $$('button').forEach(element => { element.disabled = busy; });
    $('[data-action="save-plan"]').disabled = busy || pending || !canReviewSave() || !role('review-accepted').checked || !role('review-note').value.trim();
    $('[data-action="render"]').disabled = busy || pending || !inventory.plans.some(p=>p.id===local.selectedPlanId) ||
      inventory.publications.some(p=>p.planId===local.selectedPlanId);
    $('[data-action="preview"]').disabled = busy || !inventory.projects.length;
    $('[data-action="resume-pending"]').disabled = busy || !pendingLookup?.resumable;
    $('[data-action="review-refusal"]').disabled = busy || !pendingLookup?.canReview;
    if (selectedDocument) {
      $('[data-action="show-preview"]').disabled = busy || !outputOf(selectedDocument).png;
    }
  }
  function invalidateReview() {
    ++previewGeneration;
    review = null; role('review-card').hidden = true; role('review-accepted').checked = false;
    role('draft-state').textContent = 'Draft';
    updateControls();
  }
  function fieldValue(path) { return path.split('.').reduce((value,key)=>value?.[key],local.draft); }
  function setField(path,value) {
    const parts = path.split('.'); let target = local.draft;
    for (const name of parts.slice(0,-1)) target = target[name] ||= {};
    target[parts.at(-1)] = value;
  }
  function currentProject() { return inventory.projects.find(project=>project.id===local.draft.projectId); }
  function fillOptions(select,rows,selected,empty) {
    select.replaceChildren(option('',empty));
    for (const [value,title] of rows) select.append(option(value,title));
    if (selected && !rows.some(row=>row[0]===selected))
      select.append(option(selected,selected+' — unavailable in this workspace view'));
    select.value = selected || '';
  }
  function renderLayers() {
    const project = currentProject(), layers = project?.layers || [];
    const inherited = local.useOriginalLayers;
    role('visible-layers').checked = inherited;
    const target = role('layers'); target.replaceChildren();
    if (!project) { target.append(node('p','Choose a saved project to inspect its layers.','cartography-empty')); return; }
    if (!layers.length) { target.append(node('p','The selected project has no listed layers. Review its native source before preparing a map.','cartography-empty')); return; }
    for (const layer of layers) {
      const id = layerId(layer);
      const item = node('label',undefined,'cartography-check');
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = id;
      input.checked = inherited ? layer.visible !== false : local.draft.map.layerIds.includes(id);
      input.disabled = inherited; input.dataset.layer = id;
      input.addEventListener('change',()=>{
        local.draft.map.layerIds = $$('[data-layer]:checked').map(item=>item.value);
        invalidateReview(); save();
      });
      item.append(input,node('span',layerName(layer))); target.append(item);
    }
  }
  function renderForm() {
    fillOptions($('[data-field="projectId"]'),inventory.projects.map(p=>[p.id,projectName(p)]),local.draft.projectId,'Select a saved QGIS project');
    fillOptions($('[data-field="predecessorPublicationId"]'),inventory.publications.map(p=>[p.id,publicationName(p)]),local.draft.predecessorPublicationId,'First publication');
    $$('[data-field]').forEach(element=>{
      const value = fieldValue(element.dataset.field);
      if (element.type==='checkbox') element.checked = value===true; else element.value = value ?? '';
    });
    const custom = Array.isArray(local.draft.map.extent);
    role('extent-project').checked = !custom; role('extent-custom').checked = custom; role('coordinates').hidden = !custom;
    $$('[data-coordinate]').forEach(element=>{element.value=custom ? local.draft.map.extent[Number(element.dataset.coordinate)] ?? '' : '';});
    const project=currentProject();
    role('crs').textContent=project ? 'Coordinates use the saved project CRS: '+label(project.crs?.authid || project.crs?.authId || project.crs || project.projectCrs || 'shown in the source review') : '';
    renderLayers(); updateControls();
  }
  function spec() {
    const value=copy(local.draft);
    value.schema=SPEC_SCHEMA;
    value.projectId=String(value.projectId || '');
    value.title=String(value.title || '').trim();
    value.page.dpi=Number(value.page.dpi);
    value.map.paddingPercent=Number(value.map.paddingPercent);
    if (!value.projectId || !value.title) throw new Error('Select a saved project and enter the map title.');
    if (!Number.isFinite(value.map.paddingPercent) || value.map.paddingPercent<0 || value.map.paddingPercent>50) throw new Error('Map padding must be between zero and fifty percent.');
    if (!String(value.attribution || '').trim()) throw new Error('Enter the source attribution for this map.');
    if (Array.isArray(value.map.extent)) {
      if(value.map.extent.some(x=>String(x).trim()==='')) throw new Error('Enter all four extent coordinates.');
      value.map.extent=value.map.extent.map(Number);
      if(value.map.extent.some(x=>!Number.isFinite(x)) || value.map.extent[0]>=value.map.extent[2] || value.map.extent[1]>=value.map.extent[3])
        throw new Error('Extent coordinates must be finite, with each minimum below its maximum.');
    }
    if (!local.useOriginalLayers && !value.map.layerIds.length)
      throw new Error('Select at least one layer, or use the original visible layers.');
    if (local.useOriginalLayers) delete value.map.layerIds;
    value.predecessorPublicationId=value.predecessorPublicationId || null;
    value.review={comparisonSha256:null,note:''};
    return value;
  }
  function renderLibrary() {
    role('context').textContent=(identity.title || 'Migration workspace')+' · revision '+inventory.revision;
    const publications=role('publications'); publications.replaceChildren();
    if(!inventory.publications.length) publications.append(node('p','Rendered publications will appear here with their editable project and layout.','cartography-empty'));
    for(const publication of inventory.publications) {
      const item=button(publicationName(publication),()=>openPublication(publication.id),'cartography-list-item');
      item.setAttribute('aria-current',publication.id===local.selectedPublicationId?'true':'false');
      item.append(node('small',date(publication.createdAt || publication.at) || publication.id));
      publications.append(item);
    }
    const plans=role('plans'); plans.replaceChildren();
    if(!inventory.plans.length) plans.append(node('p','Save a reviewed plan before rendering.','cartography-empty'));
    for(const plan of inventory.plans) {
      const item=button(plan.title || plan.spec?.title || plan.id,()=>selectPlan(plan.id),'cartography-list-item');
      item.setAttribute('aria-current',plan.id===local.selectedPlanId?'true':'false');
      item.append(node('small',inventory.publications.some(p=>p.planId===plan.id)?'Rendered':'Prepared'));
      plans.append(item);
    }
    const operations=role('operations'); operations.replaceChildren();
    if(!inventory.operations.length) operations.append(node('p','Native rendering and reopening results appear here.','cartography-empty'));
    for(const operation of inventory.operations) {
      const item=node('div',undefined,'cartography-operation');
      item.append(node('strong',operation.state || operation.status || 'Retained'),node('p',operation.phase || operation.message || operation.requestId || operation.id));
      const publicationId=operation.publicationId || operation.result?.publication?.id;
      if(publicationId) item.append(button('Open publication',()=>openPublication(publicationId)));
      item.append(details('Operation details',operation)); operations.append(item);
    }
    renderSelectedPlan(); renderPending(); updateControls();
  }
  function renderSelectedPlan() {
    const plan=inventory.plans.find(p=>p.id===local.selectedPlanId);
    role('selected-plan').hidden=!plan;
    if(!plan) return;
    const target=role('selected-plan-content'); target.replaceChildren();
    target.append(node('h4',plan.title || plan.spec?.title || plan.id));
    const selected=plan.spec || plan.publicationSpec;
    if(selected) target.append(node('p',[selected.page?.size,selected.page?.orientation,selected.page?.dpi ? selected.page.dpi+' dpi':''].filter(Boolean).join(' · ')));
    target.append(node('p','Prepared from '+(plan.project?.title || plan.projectId || selected?.projectId || 'the saved project')+'.'));
    const published=inventory.publications.find(p=>p.planId===plan.id);
    if(published) target.append(button('Open rendered publication',()=>openPublication(published.id)));
    target.append(details('Saved plan',plan));
  }
  function renderPending() {
    const pending=local.pending;
    role('pending').hidden=!pending;
    if(!pending) return;
    const target=role('pending-summary'); target.replaceChildren();
    target.append(node('p',(pending.command==='cartography.publish'?'Native publication':'Reviewed plan')+' · '+pending.requestId));
    target.append(node('p',pending.message || 'The original command is retained. Check its saved result before continuing.'));
    if(pending.error) target.append(node('p',pending.error,'cartography-error'));
    $('[data-action="resume-pending"]').hidden=!pendingLookup?.resumable;
    $('[data-action="review-refusal"]').hidden=!pendingLookup?.canReview;
    updateControls();
  }
  async function refresh() {
    ensureWorkspace();
    const generation=++refreshGeneration;
    const value=resultValue(await api('cartography.inventory',{}));
      if(disposed || generation!==refreshGeneration) return;
      if(value?.workspaceId!==identity.id || !Number.isSafeInteger(value.revision) ||
        !['projects','plans','publications','operations'].every(name=>Array.isArray(value[name])))
        throw new Error('The publication inventory is incomplete or belongs to another workspace.');
      inventory=value;
      identity={...identity,...getWorkspace()};
      renderLibrary(); renderForm();
    return inventory;
  }
  async function preparePreview(event) {
    event?.preventDefault();
    if(busy) return;
    const selected=spec(),generation=++previewGeneration;
    setBusy(true); note('Reading the saved project and its publication bindings…');
    try {
      const value=resultValue(await api('cartography.preview',{spec:selected}));
      if(disposed || generation!==previewGeneration) return;
      ensureWorkspace();
      if(value?.workspaceId!==identity.id || !Number.isSafeInteger(value.revision) || !value.spec)
        throw new Error('The source review did not return the selected original workspace and specification.');
      if(!same(spec(),selected)) return;
      review={...value,requestedSpec:selected};
      role('review-card').hidden=false; role('review-accepted').checked=false; role('review-note').value=local.draft.review?.note || '';
      renderReview();
      role('draft-state').textContent='Source review';
      note(canReviewSave()?'Review the source and layout, add your note, then save the plan.':'Resolve the listed source or layout issues before saving.');
    } finally { setBusy(false); }
  }
  function renderReview() {
    const target=role('review-content'); target.replaceChildren();
    if(!review) return;
    target.append(node('p',(review.project?.title || projectName(review.project || {}) || review.spec.projectId)+' · reviewed workspace revision '+review.revision));
    const selected=review.spec;
    target.append(table(['Setting','Reviewed value'],[
      ['Paper',selected.page.size+' · '+selected.page.orientation+' · '+selected.page.dpi+' dpi'],
      ['Extent',selected.map.extent==='project'?'Saved project extent':selected.map.extent.join(', ')],
      ['Legend',selected.legend.show?selected.legend.title:'Hidden'],
      ['Scale bar',selected.scaleBar.show?'Shown':'Hidden'],
      ['Attribution',selected.attribution || '']
    ]));
    const bindings=review.layerBindings || [];
    if(bindings.length) target.append(table(['Layer','Source','Style and labels'],bindings.map(binding=>[
      binding.label || binding.name || binding.title || binding.layerId || binding.id,
      binding.sourceTitle || binding.sourceId || binding.source?.id || binding.source,
      details('Retained binding',binding)
    ])));
    if(review.comparison) {
      target.append(node('h4','Changes from the earlier publication'));
      const changes=review.comparison.changes || [];
      if(changes.length) target.append(table(['Change','Details'],changes.map(change=>[
        change.label || change.kind || change.path || change.type || 'Source or layout',
        typeof change==='string'?change:details(change.summary || change.message || 'Read change',change)
      ])));
      else target.append(node('p','No source or layout binding changed from the selected publication.'));
    }
    const issues=review.issues || [];
    if(issues.length) {
      const list=node('ul',undefined,'cartography-issues');
      for(const issue of issues) list.append(node('li',typeof issue==='string'?issue:issue.message || issue.detail || issue.code || issue));
      target.append(list);
    }
    target.append(details('Complete reviewed source', {project:review.project,layerBindings:review.layerBindings,comparison:review.comparison,spec:review.spec}));
  }
  async function commit(command,args) {
    ensureWorkspace();
    if(local.pending) throw new Error('Finish the retained original request before starting another publication command.');
    const requestId=crypto.randomUUID();
    const request={...copy(args),requestId};
    local.pending={command,args:request,requestId,workspaceId:identity.id,startedAt:new Date().toISOString(),state:'prepared'};
    pendingLookup=null;
    try { save(true); } finally { renderPending(); }
    return dispatchPending();
  }
  async function dispatchPending() {
    const pending=local.pending;
    if(!pending) return;
    ensureWorkspace();
    setBusy(true);
    try {
      pending.state='awaiting-result'; pending.error=null; pendingLookup=null; save(true); renderPending();
      const value=resultValue(await mutate(pending.command,copy(pending.args)));
      if(disposed) return value;
      const record=pending.command==='cartography.save-plan'?value?.plan:value?.publication;
      if(!acceptsRequest(pending,value,record))
        throw new Error('The returned result does not yet identify this original request. Check the saved operation.');
      await acceptResult(pending,value);
      return value;
    } catch(error) {
      if(local.pending?.requestId===pending.requestId) {
        local.pending.state=TERMINAL_REFUSALS.has(error?.code)?'refused':'awaiting-result';
        local.pending.error=readable(error);local.pending.errorCode=error?.code || null;
        local.pending.message='The command keeps its original request, arguments and reviewed revision.';
        save();renderPending();
      }
      throw error;
    } finally { setBusy(false); }
  }
  async function acceptResult(pending,value) {
    if(local.pending?.requestId!==pending.requestId) throw new Error('The selected original request changed.');
    if(value.plan) local.selectedPlanId=value.plan.id;
    if(value.publication) local.selectedPublicationId=value.publication.id;
    local.pending=null;pendingLookup=null;save();renderPending();
    note(value.publication?'Publication saved. Its editable project, template and rendered maps are available.':'Reviewed plan saved. It is ready for native rendering.');
    try {
      await refresh();
      if(value.publication) await openPublication(value.publication.id);
      await onChange({workspaceId:identity.id,revision:Math.max(value.revision || 0,inventory.revision)});
    } catch(error) {
      note('The original result was saved. Refresh its view when the connection returns. '+readable(error),'error');
    }
  }
  async function savePlan() {
    if(!canReviewSave() || !role('review-accepted').checked) throw new Error('Review the complete layout and source before saving.');
    if(!same(spec(),review.requestedSpec)) { invalidateReview();throw new Error('The draft changed. Review its current source and layout again.'); }
    const selected=copy(review.spec),reviewNote=role('review-note').value.trim();
    if(!reviewNote) throw new Error('Add a review note for this publication.');
    selected.review={comparisonSha256:review.comparison?.sha256 || null,note:reviewNote};
    local.draft.review={...selected.review};save();
    await commit('cartography.save-plan',{spec:selected,revision:review.revision});
  }
  function selectPlan(id) {
    if(!inventory.plans.some(plan=>plan.id===id)) throw new Error('The selected saved plan is no longer in this workspace view.');
    local.selectedPlanId=id;save();renderLibrary();role('selected-plan').scrollIntoView({block:'nearest'});
  }
  async function publishPlan() {
    const plan=inventory.plans.find(item=>item.id===local.selectedPlanId);
    if(!plan) throw new Error('Select a prepared publication plan.');
    const existing=inventory.publications.find(item=>item.planId===plan.id);
    if(existing) return openPublication(existing.id);
    await commit('cartography.publish',{planId:plan.id,revision:inventory.revision});
  }
  async function checkPending() {
    const pending=local.pending;if(!pending) return;
    ensureWorkspace();setBusy(true);note('Reading the original saved request…');
    try {
      const value=resultValue(await api('cartography.operation',{requestId:pending.requestId}));
      if(disposed || local.pending?.requestId!==pending.requestId) return;
      if(value?.workspaceId!==identity.id || typeof value.found!=='boolean')
        throw new Error('The original operation lookup is incomplete.');
      await refresh();
      const plan=value.plan || value.result?.plan || inventory.plans.find(item=>item.requestId===pending.requestId);
      const publication=value.publication || inventory.publications.find(item=>item.requestId===pending.requestId);
      if(pending.command==='cartography.save-plan' && acceptsRequest(pending,value.result || value,plan))
        return await acceptResult(pending,{...(value.result || {}),revision:inventory.revision,plan});
      if(pending.command==='cartography.publish' && publication && publication.requestId===pending.requestId)
        return await acceptResult(pending,{revision:inventory.revision,publication,operation:value.operation});
      const operation=value.operation;
      const state=String(operation?.state || operation?.status || '').toUpperCase();
      const active=operation?.active===true || ['RUNNING','STARTING','DISPATCHING','RENDERING'].includes(state);
      pendingLookup={at:new Date().toISOString(),found:value.found,resumable:!active,
        canReview:!value.found && pending.state==='refused'};
      pending.message=active?'The native operation is still '+state.toLowerCase()+'. Check this same request for its result.':
        value.found?'The original operation is retained. Continue it with the same request and arguments.':
        'No saved result is currently recorded for this request. Its original command can be continued.';
      if(operation) pending.operation=operation;
      save();renderPending();note(pending.message);
    } finally {setBusy(false);}
  }
  async function resumePending() {
    await checkPending();
    if(local.pending && pendingLookup?.resumable) await dispatchPending();
  }
  async function reviewRefusal() {
    await checkPending();
    if(!local.pending || !pendingLookup?.canReview) return;
    const pending=local.pending;
    if(pending.command==='cartography.save-plan') {
      local.draft=copy(pending.args.spec);
      local.useOriginalLayers=!(local.draft.map.layerIds || []).length;
    }
    local.previousRefusal={requestId:pending.requestId,command:pending.command,error:pending.error,revision:pending.args.revision,at:new Date().toISOString()};
    local.pending=null;pendingLookup=null;invalidateReview();save();renderPending();renderForm();
    note('The refused request remains in the original operator history. Review the current draft before saving a new plan.');
  }
  function outputOf(publication) { return publication.output || publication.outputs || {}; }
  async function openPublication(id) {
    const generation=++documentGeneration;
    const value=resultValue(await api('cartography.publication',{publicationId:id}));
    if(disposed || generation!==documentGeneration) return;
    const publication=value.publication || value;
    if(publication.id!==id) throw new Error('The returned publication differs from the selected original.');
    selectedDocument=publication;local.selectedPublicationId=id;save();
    if(previewUrl) {URL.revokeObjectURL(previewUrl);retainedUrls.delete(previewUrl);previewUrl=null;}
    role('map-preview').replaceChildren();role('reopened').replaceChildren();
    role('publication').hidden=false;
    const target=role('publication-content');target.replaceChildren();
    target.append(node('h4',publicationName(publication)));
    target.append(node('p',date(publication.createdAt || publication.at)));
    if(publication.predecessorPublicationId || publication.spec?.predecessorPublicationId)
      target.append(node('p','This edition keeps its reviewed relationship to '+(publication.predecessorPublicationId || publication.spec.predecessorPublicationId)+'.'));
    const outputs=outputOf(publication);
    target.append(table(['File','Size'],Object.entries(outputs).map(([kind,file])=>[
      FORMATS.find(row=>row[0]===kind)?.[1] || kind,bytes(file.bytes)
    ])));
    target.append(details('Layout and native source', {layout:publication.layout,native:publication.native,sourceBindings:publication.sourceBindings}));
    const downloads=role('downloads');downloads.replaceChildren();
    for(const [kind,title] of FORMATS) downloads.append(button(title,()=>downloadFile(id,kind)));
    renderLibrary();updateControls();
  }
  async function fileRecord(id,kind) {
    const value=resultValue(await api('cartography.download',{publicationId:id,kind}));
    const record=value.descriptor;
    if(!record || typeof record.path!=='string' || !Number.isSafeInteger(record.bytes) || record.bytes<0 ||
      typeof record.sha256!=='string' || !/^[a-f0-9]{64}$/.test(record.sha256))
      throw new Error('The original publication did not return a complete file descriptor.');
    if(record.path.startsWith('/') || record.path.includes('\\') || record.path.split('/').some(part=>part==='..' || part==='.' || !part))
      throw new Error('The publication descriptor must use the original workspace-relative file path.');
    return value;
  }
  async function downloadFile(id,kind) {
    const file=await fileRecord(id,kind);
    await download(file.descriptor.path);
    note((FORMATS.find(row=>row[0]===kind)?.[1] || kind)+' opened from the saved publication.');
  }
  async function showPreview() {
    const publication=selectedDocument;if(!publication) return;
    const id=publication.id,generation=documentGeneration;
    const file=await fileRecord(id,'png');
    // The original shell may return a Blob when asked to open a declared file.
    // It still owns its authenticated streaming and exact-path checks.
    const response=await download(file.descriptor.path,{returnBlob:true,descriptor:file.descriptor});
    if(disposed || generation!==documentGeneration || selectedDocument?.id!==id) return;
    const blob=response instanceof Blob?response:response?.blob;
    if(!(blob instanceof Blob)) {
      note('The rendered PNG was opened through the original file download.');return;
    }
    if(blob.size!==file.descriptor.bytes) throw new Error('The complete rendered preview differs from its saved size.');
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(digest!==file.descriptor.sha256) throw new Error('The rendered preview differs from its saved publication.');
    if(disposed || generation!==documentGeneration || selectedDocument?.id!==id) return;
    if(previewUrl) {URL.revokeObjectURL(previewUrl);retainedUrls.delete(previewUrl);}
    previewUrl=URL.createObjectURL(blob);retainedUrls.add(previewUrl);
    const image=node('img');image.src=previewUrl;image.alt=publicationName(publication);
    role('map-preview').replaceChildren(image,node('p','Rendered from the saved QGIS layout.','cartography-help'));
    note('Rendered preview opened.');
  }
  async function reopen() {
    const id=selectedDocument?.id;if(!id) return;
    setBusy(true);note('Opening the saved editable project and layout in native QGIS…');
    try {
      const result=resultValue(await api('cartography.reopen',{publicationId:id}));
      if(selectedDocument?.id===id) role('reopened').replaceChildren(details('Native reopen result',result));
      note('The saved publication reopened through native QGIS.');
      await refresh();
    } finally {setBusy(false);}
  }
  function newDraft(value=initialDraft()) {
    local.draft=copy(value);local.draft.schema=SPEC_SCHEMA;
    local.useOriginalLayers=!(local.draft.map.layerIds || []).length;
    local.draft.review={comparisonSha256:null,note:''};
    invalidateReview();save();renderForm();role('editor').scrollIntoView({block:'nearest'});
  }
  function correctPublication() {
    const publication=selectedDocument;if(!publication) return;
    const plan=inventory.plans.find(item=>item.id===publication.planId);
    const value=publication.spec || publication.plan?.spec || plan?.spec;
    if(!value) throw new Error('Open the saved original plan before preparing this correction.');
    newDraft({...copy(value),predecessorPublicationId:publication.id});
    note('The earlier publication is selected. Choose the corrected saved project and review the complete change comparison.');
  }
  $$('[data-field]').forEach(element=>listen(element,'input',()=>{
    const path=element.dataset.field;
    setField(path,element.type==='checkbox'?element.checked:element.value);
    if(path==='projectId') {local.draft.map.layerIds=[];local.useOriginalLayers=true;renderForm();}
    invalidateReview();save();
  }));
  listen(role('extent-project'),'change',()=>{if(role('extent-project').checked){local.draft.map.extent='project';invalidateReview();save();renderForm();}});
  listen(role('extent-custom'),'change',()=>{if(role('extent-custom').checked){local.draft.map.extent=['','','',''];invalidateReview();save();renderForm();}});
  $$('[data-coordinate]').forEach(element=>listen(element,'input',()=>{
    if(!Array.isArray(local.draft.map.extent)) local.draft.map.extent=['','','',''];
    local.draft.map.extent[Number(element.dataset.coordinate)]=element.value;invalidateReview();save();
  }));
  listen(role('visible-layers'),'change',()=>{
    const useOriginal=role('visible-layers').checked;
    local.useOriginalLayers=useOriginal;
    local.draft.map.layerIds=useOriginal?[]:(currentProject()?.layers || []).filter(layer=>layer.visible!==false).map(layerId);
    invalidateReview();save();renderLayers();
  });
  listen(role('review-note'),'input',()=>{local.draft.review.note=role('review-note').value;save();updateControls();});
  listen(role('review-accepted'),'change',updateControls);
  listen(role('form'),'submit',event=>{event.preventDefault();guard(()=>preparePreview());});
  const actions={
    refresh:async()=>{await refresh();note('Publication workspace refreshed.');},
    new:()=>newDraft(),
    'check-pending':checkPending,'resume-pending':resumePending,'review-refusal':reviewRefusal,
    'save-plan':savePlan,render:publishPlan,
    'edit-plan':()=>{
      const plan=inventory.plans.find(p=>p.id===local.selectedPlanId);
      if(!plan?.spec) throw new Error('Select the complete saved plan first.');
      newDraft(plan.spec);
    },
    correct:correctPublication,'show-preview':showPreview,reopen
  };
  $$('[data-action]').forEach(element=>{
    if(actions[element.dataset.action]) listen(element,'click',()=>guard(actions[element.dataset.action]));
  });
  renderForm();renderLibrary();
  if(storageError) note('The previous browser draft could not be read. Saved plans and publications remain in the original workspace.','error');
  const ready=guard(async()=>{
    await refresh();
    if(local.selectedPublicationId && inventory.publications.some(p=>p.id===local.selectedPublicationId))
      await openPublication(local.selectedPublicationId);
    if(local.pending) await checkPending();
  });
  return {
    ready,refresh,
    destroy() {
      disposed=true;++refreshGeneration;++documentGeneration;++previewGeneration;
      for(const remove of listeners) remove();
      for(const url of retainedUrls) URL.revokeObjectURL(url);
      retainedUrls.clear();root.replaceChildren();root.classList.remove('cartography');
    }
  };
}
