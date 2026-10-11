// MIT. Browser operator; native comparison and custody stay in the retained service.
import { newDraft, inspectCsvHeader, compileDraft, WORKSPACE_SCHEMA } from './mapping.mjs';

const $ = id => document.getElementById(id);
const scopeKeys = ['conversionOwner', 'period', 'sourceSystem', 'targetSystem', 'coverage', 'excludedHistory', 'resources', 'timeline'];
const activeStates = new Set(['QUEUED', 'RUNNING']);
const state = { profile: null, configuration: null, draft: null, files: {}, headers: {}, inputErrors: {}, fileSequence: {},
  baseBundleId: null, baseSpec: null, previousJobId: null, staged: null, stagedJobId: null,
  crosswalkOffset: 0, jobs: [], jobCursor: null, bundles: [], bundleCursor: null,
  selectedJob: null, detail: null, page: { kind: 'records', filter: '', offset: 0 }, busy: false, poll: null, jobSequence: 0, epoch: 0 };
let profileModule = null, profilePanel = null;
let token = '';
try {
  const fragment = location.hash.slice(1);
  if (/^[a-f0-9]{64}$/.test(fragment)) { token = fragment; sessionStorage.setItem('erp-workspace-token', token); }
  else token = sessionStorage.getItem('erp-workspace-token') ?? '';
} catch { token = location.hash.slice(1); }
if (location.hash) history.replaceState(null, '', location.pathname + location.search);

function element(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'text') node.textContent = value;
    else if (key in node && !key.startsWith('aria')) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
const button = (text, action, props = {}) => element('button', { type: 'button', text, onClick: () => perform(action), ...props });
const text = (tag, value, className = '') => element(tag, { text: value ?? '', className });
const muted = value => text('p', value, 'muted');
const pretty = value => JSON.stringify(value, null, 2);
const size = bytes => `${Number(bytes).toLocaleString()} bytes`;
const when = value => value ? new Date(value).toLocaleString() : '—';
const statusName = value => String(value ?? 'Unreviewed').replaceAll('_', ' ');
const describeError = error => `${error.message || 'The operation could not complete.'}${error.code ? ` (${error.code})` : ''}`;

function notice(message, isError = false) { $('notice').textContent = message; $('notice').classList.toggle('error', isError); }

async function api(path, body, { raw = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 70000);
  try {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', redirect: 'error',
      headers: { 'x-erp-workspace-token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
    if (!response.ok) {
      const value = await response.json().catch(() => ({}));
      const error = new Error(value.message ?? `The workspace returned HTTP ${response.status}.`); error.code = value.error; throw error;
    }
    return raw ? { blob: await response.blob(), headers: response.headers } : await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The request timed out. Refresh the retained job before deciding whether to submit the operation again.');
    throw error;
  } finally { clearTimeout(timer); }
}

async function perform(action) {
  if (state.busy) return;
  state.busy = true; document.body.setAttribute('aria-busy', 'true'); document.querySelector('main').inert = true;
  const controls = [...document.querySelectorAll('button,input,textarea,select')].map(node => [node, node.disabled]);
  for (const [node] of controls) node.disabled = true;
  try { return await action(); }
  catch (error) { notice(describeError(error), true); }
  finally {
    for (const [node, disabled] of controls) if (node.isConnected) node.disabled = disabled;
    state.busy = false; document.body.removeAttribute('aria-busy'); document.querySelector('main').inert = false;
    if (state.draft) renderCrosswalk(); renderExecution();
  }
}

function view(name) {
  for (const key of ['intake', 'runs', 'bundles', 'profile']) {
    const section = $(`${key}View`); if (section) section.hidden = key !== name;
  }
  for (const item of document.querySelectorAll('[data-view]')) {
    if (item.dataset.view === name) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  }
  if (name !== 'runs') { clearTimeout(state.poll); state.poll = null; }
  else schedulePoll();
}

function touch() {
  if (state.staged) {
    state.baseBundleId = state.staged.bundle.bundleId; state.baseSpec = state.staged.spec;
    state.previousJobId = state.stagedJobId; state.staged = null; state.stagedJobId = null;
    $('correctionWrap').hidden = false; $('correctionReason').required = true;
    $('mappingMode').textContent = 'Linked correction';
    $('mappingRevision').textContent = `Next revision ${(state.baseSpec.workspace?.revision ?? 0) + 1}`;
  }
  $('mappingPreview').hidden = true; renderExecution();
}

function resetDraft(cohortId) {
  state.epoch++; state.draft = newDraft(state.profile, cohortId); state.files = { source: null, target: null };
  state.headers = { source: [], target: [] }; state.inputErrors = {}; state.baseBundleId = null; state.baseSpec = null;
  state.previousJobId = null; state.staged = null; state.stagedJobId = null; state.crosswalkOffset = 0;
  renderEditor(); view('intake');
}

function renderEditor() {
  const draft = state.draft, profile = draft.profile;
  $('cohort').replaceChildren(...profile.cohorts.map(cohort => element('option', { value: cohort.id, text: cohort.title })));
  $('cohort').value = draft.cohortId; $('dataset').value = draft.dataset ?? '';
  $('cohortPurpose').textContent = profile.cohorts.find(c => c.id === draft.cohortId)?.purpose ?? '';
  for (const key of scopeKeys) $(key).value = draft.scope[key] ?? '';
  $('correctionReason').value = draft.correctionReason ?? '';
  $('correctionWrap').hidden = !state.baseBundleId;
  $('correctionReason').required = !!state.baseBundleId;
  $('mappingMode').textContent = state.baseBundleId ? 'Linked correction' : state.staged ? 'Retained mapping' : 'New conversion';
  $('mappingRevision').textContent = state.staged ? `Revision ${state.staged.spec.workspace?.revision ?? 'original'}` : state.baseBundleId ? `Next revision ${(state.baseSpec.workspace?.revision ?? 0) + 1}` : 'Revision 1';
  for (const side of ['source', 'target']) { $(`${side}File`).value = ''; renderInput(side); }
  $('crosswalkEnabled').checked = !!draft.crosswalk; $('mappingPreview').hidden = true;
  renderFields(); renderCrosswalk(); renderExecution();
  renderProfilePanel();
}

function renderProfilePanel() {
  if (!profileModule) return;
  if (profilePanel) { profilePanel.updateDraft(state.draft); return; }
  const section = element('section', { id: 'profileView', hidden: true, 'aria-label': profileModule.panelTitle ?? 'Project' });
  document.querySelector('main').append(section);
  const nav = element('button', { type: 'button', text: profileModule.panelTitle ?? 'Project', 'data-view': 'profile',
    onClick: () => { if (!state.busy) view('profile'); } });
  document.querySelector('.tabs').append(nav);
  profilePanel = profileModule.mountProfilePanel({ element: section, api, draft: state.draft,
    onDraftChange: plan => { state.draft = profileModule.applyPlan(state.draft, plan); touch(); },
    onOpenJob: jobId => perform(() => selectJob(jobId)),
    onOpenBundle: (bundleId, jobId) => perform(() => openBundle(bundleId, jobId)),
    download: async path => {
      const artifact = await api(path, undefined, { raw: true });
      const name = /^attachment; filename="([A-Za-z0-9._-]+)"$/.exec(artifact.headers.get('content-disposition') ?? '')?.[1];
      if (!name) throw new Error('The original handoff returned an invalid download name.');
      download(artifact.blob, name);
    } });
}

function retainedSpec() { return state.staged?.spec ?? state.baseSpec; }
function renderInput(side) {
  const selected = state.files[side], retained = retainedSpec();
  const name = selected?.name ?? retained?.workspace?.inputs?.[side]?.name ?? (retained ? state.draft.inputs?.[side]?.name : null);
  const rows = state.headers[side] ?? [];
  $(`${side}Meta`).textContent = state.inputErrors[side] ?? (name
    ? `${name} · ${selected ? size(selected.size) : 'retained original'} · ${rows.length} columns`
    : `No ${side} selected.`);
  $(`retained${side === 'source' ? 'Source' : 'Target'}`).hidden = !retained;
}

async function chooseFile(side, file) {
  const sequence = state.fileSequence[side] = (state.fileSequence[side] ?? 0) + 1, epoch = state.epoch;
  touch(); state.files[side] = file ?? null;
  if (!file) return useRetained(side);
  state.inputErrors[side] = 'Reading the CSV header…'; renderInput(side);
  try {
    if (file.size < 1 || file.size > state.configuration.maxInputBytes) throw new Error(`Select a non-empty CSV within ${size(state.configuration.maxInputBytes)}.`);
    const bytes = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
    const columns = inspectCsvHeader(bytes, { complete: file.size <= 65536 });
    if (sequence !== state.fileSequence[side] || epoch !== state.epoch) return;
    state.headers[side] = columns; delete state.inputErrors[side];
    for (const field of state.draft.fields) if (!columns.includes(field[side])) field[side] = '';
    renderFields(); renderInput(side); notice(`Selected ${side} export ${file.name}. Review its column mapping before staging.`);
  } catch (error) {
    if (sequence !== state.fileSequence[side] || epoch !== state.epoch) return;
    state.inputErrors[side] = error.message; state.headers[side] = []; renderInput(side); renderFields(); notice(describeError(error), true);
  }
}

function useRetained(side) {
  touch(); state.fileSequence[side] = (state.fileSequence[side] ?? 0) + 1;
  state.files[side] = null; delete state.inputErrors[side]; $(`${side}File`).value = '';
  state.headers[side] = retainedSpec()?.workspace?.headers?.[side] ?? (retainedSpec() ? state.draft.headers?.[side] ?? [] : []);
  renderInput(side); renderFields();
}

function select(values, value, label, change) {
  const node = element('select', { 'aria-label': label, onChange: event => change(event.target.value) },
    values.map(item => element('option', { value: typeof item === 'string' ? item : item.value, text: typeof item === 'string' ? item : item.text })));
  node.value = value; return node;
}

function renderFields() {
  $('mappingRows').replaceChildren(...state.draft.fields.map((field, index) => {
    const set = (key, value) => { touch(); field[key] = value; };
    const column = side => select([{ value: '', text: 'Choose column…' }, ...(state.headers[side] ?? [])], field[side], `${side} column for ${field.name || `field ${index + 1}`}`, value => set(side, value));
    const name = element('input', { value: field.name, maxLength: 80, 'aria-label': `Logical field ${index + 1}`, onInput: event => set('name', event.target.value), onChange: () => renderCrosswalk() });
    const type = select([{ value: 'key', text: 'Key' }, { value: 'attribute', text: 'Text' }, { value: 'amount', text: 'Amount' }], field.type, `Comparison type for ${field.name}`, value => {
      set('type', value); if (value === 'amount') { field.scale ??= 2; field.tolerance ??= '0.00'; } renderFields(); renderCrosswalk();
    });
    const scale = field.type === 'amount' ? element('input', { type: 'number', min: 0, max: 8, step: 1, value: field.scale ?? 2, 'aria-label': `Scale for ${field.name}`, onInput: event => set('scale', event.target.value === '' ? null : Number(event.target.value)) }) : '—';
    const tolerance = field.type === 'amount' ? element('input', { value: field.tolerance ?? '0.00', inputMode: 'decimal', maxLength: 100, 'aria-label': `Tolerance for ${field.name}`, onInput: event => set('tolerance', event.target.value) }) : '—';
    const group = field.type === 'key' ? element('input', { type: 'checkbox', checked: field.grouped === true, 'aria-label': `Group by ${field.name}`, onChange: event => set('grouped', event.target.checked) }) : '—';
    return element('tr', {}, ...[name, type, column('source'), column('target'), scale, tolerance, group,
      button('Remove', () => { touch(); state.draft.fields.splice(index, 1); renderFields(); renderCrosswalk(); }, { 'aria-label': `Remove field ${field.name || index + 1}` })].map(item => element('td', {}, item)));
  }));
}

function addField(type) {
  touch(); state.draft.fields.push({ name: '', type, source: '', target: '', ...(type === 'amount' ? { scale: 2, tolerance: '0.00' } : {}) });
  renderFields(); renderCrosswalk(); $('mappingRows').lastElementChild?.querySelector('input')?.focus();
}

function updateCrosswalkKeys(keys) {
  touch(); const current = state.draft.crosswalk;
  current.rows = current.rows.map(row => Object.fromEntries(['source', 'target'].map(side => [side, keys.map(key => row[side][current.keys.indexOf(key)] ?? '')])));
  current.keys = keys; state.crosswalkOffset = 0; renderCrosswalk();
}

function renderCrosswalk() {
  const crosswalk = state.draft.crosswalk; $('crosswalkEditor').hidden = !crosswalk; $('crosswalkEnabled').checked = !!crosswalk;
  if (!crosswalk) return;
  const keys = state.draft.fields.filter(field => field.type === 'key').map(field => field.name).filter(Boolean);
  $('crosswalkKeys').replaceChildren(...keys.map(key => element('label', { className: 'check' },
    element('input', { type: 'checkbox', checked: crosswalk.keys.includes(key), onChange: event => {
      const selected = event.target.checked ? [...crosswalk.keys, key] : crosswalk.keys.filter(value => value !== key); updateCrosswalkKeys(selected);
    } }), key)));
  const unknown = crosswalk.keys.filter(key => !keys.includes(key));
  if (unknown.length) $('crosswalkKeys').append(muted(`Removed or renamed keys need attention: ${unknown.join(', ')}. Import an updated crosswalk or switch this crosswalk off and select the current keys.`));
  $('crosswalkHead').replaceChildren(element('tr', {}, text('th', 'Row'),
    ...['source', 'target'].flatMap(side => crosswalk.keys.map(key => text('th', `${side === 'source' ? 'Source' : 'Target'} ${key}`))), text('th', '')));
  if (state.crosswalkOffset >= crosswalk.rows.length) state.crosswalkOffset = Math.max(0, Math.floor((crosswalk.rows.length - 1) / 25) * 25);
  $('crosswalkRows').replaceChildren(...crosswalk.rows.slice(state.crosswalkOffset, state.crosswalkOffset + 25).map((row, index) => {
    const position = state.crosswalkOffset + index;
    return element('tr', {}, text('td', position + 1), ...['source', 'target'].flatMap(side => crosswalk.keys.map((key, i) => element('td', {}, element('input', {
      value: row[side][i] ?? '', maxLength: 1000, 'aria-label': `${side} ${key}, crosswalk row ${position + 1}`,
      onInput: event => { touch(); row[side][i] = event.target.value; },
    })))), element('td', {}, button('Remove', () => { touch(); crosswalk.rows.splice(position, 1); renderCrosswalk(); }, { 'aria-label': `Remove crosswalk row ${position + 1}` })));
  }));
  $('crosswalkPage').textContent = `${crosswalk.rows.length ? state.crosswalkOffset + 1 : 0}–${Math.min(state.crosswalkOffset + 25, crosswalk.rows.length)} of ${crosswalk.rows.length} approved rows`;
  $('previousCrosswalk').disabled = state.crosswalkOffset === 0; $('nextCrosswalk').disabled = state.crosswalkOffset + 25 >= crosswalk.rows.length;
}

function compiledMapping() {
  if (profilePanel) state.draft = profileModule.applyPlan(state.draft, profilePanel.currentPlan());
  if (state.staged) return state.staged.spec;
  if (Object.keys(state.inputErrors).length) throw new Error('Resolve the selected CSV errors before staging.');
  const compiled = compileDraft(state.draft, { profile: state.draft.profile, headers: state.headers,
    inputs: Object.fromEntries(['source', 'target'].map(side => [side, { name: state.files[side]?.name ?? state.baseSpec?.workspace?.inputs?.[side]?.name ?? (state.baseSpec ? state.draft.inputs?.[side]?.name : '') }])),
    previous: state.baseBundleId ? { bundleId: state.baseBundleId, ...(state.previousJobId ? { jobId: state.previousJobId } : {}), revision: state.baseSpec?.workspace?.revision ?? 0 } : null });
  return profileModule?.decorateSpec ? profileModule.decorateSpec(compiled, state.draft) : compiled;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob), anchor = element('a', { href: url, download: filename });
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const downloadJson = (value, name) => download(new Blob([pretty(value) + '\n'], { type: 'application/json' }), name);

function identity(bundle) {
  const rows = [['Bundle', bundle.bundleId], ...['source', 'target', 'spec', 'engine'].map(key =>
    [key === 'spec' ? 'Mapping' : key[0].toUpperCase() + key.slice(1), bundle[key] ? `${bundle[key].sha256} · ${size(bundle[key].bytes)}` : 'Unavailable'])];
  return element('dl', { className: 'identity' }, rows.flatMap(([key, value]) => [text('dt', key), text('dd', value, 'mono')]));
}

function renderExecution() {
  $('stagedPanel').hidden = !state.staged;
  $('executeJob').disabled = !state.staged || state.busy;
  if (state.staged) $('stagedIdentity').replaceChildren(identity(state.staged.bundle));
}

async function encodedUpload(file) {
  if (!file) return undefined;
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
  for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return { name: file.name, encoding: 'base64', data: btoa(binary) };
}

async function stageMapping() {
  const spec = compiledMapping();
  if (state.staged) { notice(`Bundle ${state.staged.bundle.bundleId} is already staged. Choose its job ID to run it.`); return; }
  notice('Retaining the selected exports, mapping and current engine…');
  const [source, target] = await Promise.all(['source', 'target'].map(side => encodedUpload(state.files[side])));
  const result = await api('/api/stage', { draft: state.draft, baseBundleId: state.baseBundleId, previousJobId: state.previousJobId, source, target });
  state.staged = result; state.stagedJobId = null; state.baseBundleId = null; state.baseSpec = null; state.previousJobId = null;
  state.draft = result.draft; state.headers = result.draft.headers; state.files = { source: null, target: null }; state.inputErrors = {};
  $('jobId').value = `${state.profile.id}-${spec.workspace.cohortId}-r${spec.workspace.revision}-${result.bundle.bundleId.slice(0, 10)}`.slice(0, 96);
  renderEditor(); await loadBundles(false);
  notice(`Revision ${spec.workspace.revision} is retained. Review the staged identity and run the explicit job ID.`);
  $('stagedPanel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function executeJob() {
  if (!state.staged) throw new Error('Stage the reviewed mapping before running it.');
  const jobId = $('jobId').value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(jobId)) throw new Error('Choose a job ID of up to 96 letters, digits, dots, underscores or hyphens.');
  const job = await api('/api/execute', { jobId, bundleId: state.staged.bundle.bundleId });
  state.stagedJobId = job.jobId; await loadJobs(false); await selectJob(job.jobId);
  notice(`Job ${job.jobId} is ${statusName(job.state).toLowerCase()}${job.reused ? ' (retained request reused)' : ''}.`);
}

async function loadJobs(append = false) {
  const result = await api(`/api/jobs?limit=25&after=${encodeURIComponent(append ? state.jobCursor ?? '' : '')}`);
  state.jobs = append ? [...state.jobs, ...result.jobs] : result.jobs; state.jobCursor = result.nextCursor; renderJobs();
}
function renderJobs() {
  const jobs = [...state.jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $('jobsList').replaceChildren(...(jobs.length ? jobs.map(job => button('', () => selectJob(job.jobId), {
    className: `run-item${job.jobId === state.selectedJob ? ' selected' : ''}`,
    'aria-label': `Open run ${job.jobId}`,
  })).map((node, index) => { const job = jobs[index]; node.append(text('strong', job.jobId), text('small', `${job.workspace?.cohort ?? job.workspace?.dataset ?? 'Original mapping'} · revision ${job.workspace?.revision ?? 'original'}`), text('small', `${job.state}${job.result?.status ? ` · comparison ${job.result.status}` : ''}`), text('small', when(job.createdAt))); return node; }) : [muted('No runs retained yet. Stage the exports and mapping to create a run.')]));
  $('moreJobs').hidden = !state.jobCursor;
}

async function loadBundles(append = false) {
  const result = await api(`/api/bundles?limit=25&after=${encodeURIComponent(append ? state.bundleCursor ?? '' : '')}`);
  state.bundles = append ? [...state.bundles, ...result.bundles] : result.bundles; state.bundleCursor = result.nextCursor;
  $('bundlesList').replaceChildren(...(state.bundles.length ? state.bundles.map(bundle => element('div', { className: 'bundle-item' },
    element('div', {}, text('strong', bundle.workspace?.cohort ?? 'Original input bundle'), text('p', bundle.bundleId, 'mono'),
      muted(`${when(bundle.createdAt)} · source ${size(bundle.source.bytes)} · target ${size(bundle.target.bytes)}`)), button('Open mapping', () => openBundle(bundle.bundleId)))) : [muted('Staged exports and mappings appear here, including revisions awaiting their first run.')]));
  $('moreBundles').hidden = !state.bundleCursor;
}

async function openBundle(bundleId, previousJobId = null) {
  const result = await api(`/api/bundles/${bundleId}`);
  state.epoch++; state.draft = result.draft; state.headers = result.draft.headers;
  state.files = { source: null, target: null }; state.inputErrors = {}; state.crosswalkOffset = 0;
  state.baseBundleId = previousJobId ? bundleId : null; state.baseSpec = previousJobId ? result.spec : null;
  state.previousJobId = previousJobId; state.staged = previousJobId ? null : result; state.stagedJobId = null;
  $('jobId').value = `${result.spec.workspace?.profile?.id ?? 'conversion'}-${result.spec.workspace?.cohortId ?? 'retained'}-r${result.spec.workspace?.revision ?? 1}-${bundleId.slice(0, 10)}`.slice(0, 96);
  renderEditor(); view('intake');
  notice(previousJobId ? `Correction opened from ${previousJobId}. Retained inputs will be reused unless you select replacements. Add the correction reason before staging.` : 'Original mapping opened. Run this exact bundle or edit it to prepare a linked correction.');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function selectJob(jobId) {
  state.selectedJob = jobId; state.page = { kind: 'records', filter: '', offset: 0 }; renderJobs(); view('runs');
  await loadDetail();
}
async function loadDetail() {
  if (!state.selectedJob) return;
  const sequence = ++state.jobSequence, jobId = state.selectedJob;
  const query = new URLSearchParams({ ...state.page, limit: '50' });
  const detail = await api(`/api/jobs/${encodeURIComponent(jobId)}?${query}`);
  if (sequence !== state.jobSequence || jobId !== state.selectedJob) return;
  state.detail = detail; renderDetail(); schedulePoll();
}
function schedulePoll() {
  clearTimeout(state.poll); state.poll = null;
  if ($('runsView').hidden || !activeStates.has(state.detail?.job?.state) || state.detail?.job?.jobId !== state.selectedJob) return;
  state.poll = setTimeout(async () => {
    if (state.busy) { schedulePoll(); return; }
    try { await loadDetail(); if (!activeStates.has(state.detail?.job?.state)) { await loadJobs(false); notice(`Job ${state.selectedJob} ${state.detail.job.state.toLowerCase()}${state.detail.comparison ? ` with comparison ${state.detail.comparison.status}` : ''}.`); } }
    catch (error) { notice(describeError(error), true); }
  }, 1500);
}

function reportTable(headers, rows, className = '') {
  return element('div', { className: 'table-scroll' }, element('table', { className },
    element('thead', {}, element('tr', {}, headers.map(value => element('th', { scope: 'col', text: value })))),
    element('tbody', {}, rows.map(row => element('tr', {}, row.map(value => element('td', {}, value ?? '—')))))));
}

function renderDetail() {
  const { job, bundle, spec, reviews, comparison } = state.detail;
  const profile = spec.workspace?.profile ?? state.profile, cohortId = spec.workspace?.cohortId;
  const latestReview = reviews.at(-1);
  const detail = $('jobDetail'); detail.replaceChildren();
  detail.append(element('div', { className: 'section-heading' }, element('div', {}, text('p', spec.dataset, 'eyebrow'), text('h2', job.jobId, 'run-title')), button('Refresh run', loadDetail)),
    element('div', { className: 'state-grid' }, ...[['Original job', job.state], ['Comparison', comparison?.status ?? 'Pending'], ['Business review', statusName(latestReview?.decision)]].map(([label, value]) => element('div', { className: 'state-cell' }, text('small', label), text('strong', value)))),
    muted(`${when(job.createdAt)} · mapping revision ${spec.workspace?.revision ?? 'original'} · ${spec.workspace?.scope?.conversionOwner ?? 'Original operator'}`));
  const actions = element('div', { className: 'actions' }, button('Create linked correction', () => openBundle(bundle.bundleId, job.jobId)));
  if (spec.workspace?.previous?.jobId) actions.append(button('Open preceding run', () => selectJob(spec.workspace.previous.jobId)));
  if (activeStates.has(job.state)) actions.append(button('Cancel run', async () => { await api(`/api/jobs/${encodeURIComponent(job.jobId)}/cancel`, {}); await loadDetail(); await loadJobs(false); notice(`Cancellation recorded for ${job.jobId}.`); }));
  if (['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(job.state)) actions.append(button('Recover original run', async () => { await api(`/api/jobs/${encodeURIComponent(job.jobId)}/recover`, {}); await loadDetail(); notice(`Recovery requested for the original job ${job.jobId}.`); }));
  if (comparison) actions.append(button('Download private replay bundle', async () => {
    notice('Exporting the original inputs, mapping, engine, report and versioned reviews…');
    const artifact = await api(`/api/jobs/${encodeURIComponent(job.jobId)}/handoff`, undefined, { raw: true });
    if (artifact.headers.get('x-reconciliation-report-sha256') !== job.result.report.sha256) throw new Error('The downloaded handoff returned a different report identity. Refresh the selected run.');
    download(artifact.blob, `reconciliation-${job.jobId}.tar.gz`); notice(`Private replay bundle downloaded for ${job.jobId}.`);
  }));
  detail.append(actions);
  if (job.error) detail.append(element('div', { className: 'subpanel' }, text('h3', 'Original worker result'), text('pre', pretty(job.error))));
  const custody = element('details', {}, text('summary', 'Input identity and conversion scope'), identity(bundle), text('pre', pretty(spec.workspace?.scope ?? {})));
  if (spec.workspace?.correctionReason) custody.append(text('h3', 'Correction reason'), text('p', spec.workspace.correctionReason));
  detail.append(custody);
  if (!comparison) { detail.append(muted(activeStates.has(job.state) ? 'The original worker is processing this retained bundle. This view refreshes while the selected job is active.' : 'This job has no completed comparison report. Use the original result above to correct the inputs or recover an interrupted run.')); return; }
  detail.append(element('div', { className: 'subpanel' }, text('h3', 'Comparison summary'),
    element('div', { className: 'summary-line' }, ...Object.entries(comparison.counts).map(([key, value]) => text('span', `${statusName(key)}: ${value}`)))));
  if (comparison.totals?.length) detail.append(reportTable(['Amount', 'Source total', 'Target total', 'Target − source', 'Tolerance'], comparison.totals.map(row => [row.amount, row.source, row.target, row.delta, row.tolerance])));
  if (comparison.key_mapping) detail.append(muted(`Approved crosswalk: ${comparison.key_mapping.configured_rows} tuples; ${comparison.key_mapping.source_rows_mapped} source records mapped, ${comparison.key_mapping.source_rows_changed} changed.`));
  renderDiscrepancies(detail, comparison);
  detail.append(element('div', { className: 'subpanel' }, text('h3', 'Record a business review'),
    muted('Record the reviewer’s decision and observed ERP scenarios against this exact report. The original comparison outcome remains visible.'), reviewForm(job, profile, cohortId)));
  detail.append(element('div', { className: 'subpanel' }, text('h3', `Review history (${reviews.length})`),
    ...(reviews.length ? [...reviews].reverse().map(review => element('article', { className: 'review-entry' },
      text('strong', `${review.reviewer} · ${statusName(review.decision)}`), muted(`Review ${review.version ?? review.reviewId ?? ''} · ${when(review.createdAt)}`), text('p', review.workspace.comment),
      ...review.workspace.observations.map(item => element('p', {}, text('strong', `${profile.scenarios.find(v => v.id === item.id)?.title ?? item.id}: ${statusName(item.status)}`), item.note ? ` — ${item.note}` : '')))) : [muted('No business review has been recorded for this report.')])));
  detail.append(muted('The private replay download contains the original CSV exports, comparison key, mapping, engine, report and review history for an authorized handoff.'));
}

function renderDiscrepancies(container, comparison) {
  const page = comparison.page;
  const section = element('section', { className: 'subpanel' }, text('h3', 'Discrepancies'));
  const changePage = async values => { state.page = { ...state.page, ...values }; await loadDetail(); };
  const kind = select([{ value: 'records', text: 'Record findings' }, { value: 'groups', text: 'Group findings' }], page.kind, 'Finding view', value => perform(() => changePage({ kind: value, filter: '', offset: 0 })));
  const filter = select([{ value: '', text: 'All findings' }, ...comparison.kinds], page.filter, 'Finding type', value => perform(() => changePage({ filter: value, offset: 0 })));
  filter.disabled = page.kind === 'groups';
  section.append(element('div', { className: 'filter-bar' }, element('label', {}, 'View', kind), element('label', {}, 'Filter', filter)));
  if (page.rows.length) {
    if (page.kind === 'records') section.append(reportTable(['Finding', 'Source record', 'Target record', 'Field', 'Exact delta', 'Tolerance', 'Record identity'], page.rows.map(row => [
      row.kind ?? row.reason,
      row.source_record ?? (row.side === 'source' ? row.record : '—'), row.target_record ?? (row.side === 'target' ? row.record : '—'),
      row.amount ?? row.attribute ?? '—', row.delta_target_minus_source ?? '—', row.tolerance ?? '—', text('span', row.key_hmac_sha256 ?? '—', 'mono'),
    ]), 'record-table'));
    else section.append(reportTable(['Group identity', 'Source rows', 'Target rows', 'Original group result'], page.rows.map(row => [
      text('span', row.group_hmac_sha256 ?? row.key_hmac_sha256 ?? '—', 'mono'), row.source_rows ?? '—', row.target_rows ?? '—', text('pre', pretty(row), 'row-detail'),
    ])));
  } else section.append(muted(page.filter ? 'No findings match this filter.' : `No ${page.kind === 'groups' ? 'group' : 'record'} discrepancies in the completed comparison.`));
  section.append(muted('Record numbers count logical CSV data records after the header, excluding skipped blank records. Quoted multiline cells remain one record. Open the retained exports to inspect the original values.'));
  section.append(element('div', { className: 'pager' }, muted(`${page.total ? page.offset + 1 : 0}–${Math.min(page.offset + page.limit, page.total)} of ${page.total} findings`),
    element('div', { className: 'actions' }, button('Previous findings', () => changePage({ offset: Math.max(0, page.offset - page.limit) }), { disabled: page.offset === 0 }),
      button('Next findings', () => changePage({ offset: page.nextOffset }), { disabled: page.nextOffset === null }))));
  container.append(section);
}

function reviewForm(job, profile, cohortId) {
  const reviewer = element('input', { id: 'reviewer', maxLength: 200, required: true, autocomplete: 'name' });
  const decision = select([{ value: 'changes_requested', text: 'Changes requested' }, { value: 'accepted', text: 'Accepted' }], 'changes_requested', 'Review decision', () => {}); decision.id = 'reviewDecision';
  const comment = element('textarea', { id: 'reviewComment', rows: 3, maxLength: 3000 });
  const scenarios = profile.scenarios.filter(item => !item.cohorts.length || item.cohorts.includes(cohortId));
  const observations = scenarios.map(scenario => {
    const outcome = select([{ value: '', text: 'Unrecorded' }, { value: 'passed', text: 'Passed' }, { value: 'failed', text: 'Failed' }, { value: 'not_applicable', text: 'Not applicable' }], '', `UAT outcome: ${scenario.title}`, () => {});
    outcome.dataset.scenario = scenario.id;
    const note = element('textarea', { rows: 2, maxLength: 1000, 'aria-label': `UAT observation: ${scenario.title}` });
    return { scenario, outcome, note, node: element('div', { className: 'observation' }, text('strong', scenario.title), element('div', { className: 'grid' }, element('label', {}, 'Observed outcome', outcome), element('label', {}, 'Observation and reference', note))) };
  });
  const form = element('form', { id: 'reviewForm', onSubmit: event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    perform(async () => {
      await api('/api/review', { jobId: job.jobId, reportSha256: job.result.report.sha256, reviewer: reviewer.value, decision: decision.value, comment: comment.value,
        observations: observations.filter(item => item.outcome.value).map(item => ({ id: item.scenario.id, status: item.outcome.value, note: item.note.value })) });
      await loadDetail(); notice(`Versioned review recorded for ${job.jobId}.`);
    });
  } }, element('div', { className: 'grid two' }, element('label', {}, 'Reviewer', reviewer), element('label', {}, 'Decision', decision), element('label', { className: 'span-two' }, 'Review notes and corrective actions', comment)),
    element('div', { className: 'observations' }, observations.map(item => item.node)), element('button', { type: 'submit', className: 'primary', text: 'Record review' }));
  return form;
}

for (const item of document.querySelectorAll('[data-view]')) item.addEventListener('click', () => { if (!state.busy) view(item.dataset.view); });
$('newMapping').addEventListener('click', () => { if (!state.busy && state.profile) { resetDraft(); notice('New browser draft opened. Choose its cohort and original exports.'); } });
$('refreshAll').addEventListener('click', () => perform(async () => { await Promise.all([loadJobs(false), loadBundles(false)]); if (state.selectedJob) await loadDetail(); notice('Retained inputs and runs refreshed.'); }));
$('cohort').addEventListener('change', event => {
  touch(); const fresh = newDraft(state.draft.profile, event.target.value);
  state.draft = profileModule?.changeCohort ? profileModule.changeCohort(fresh, state.draft)
    : { ...fresh, scope: state.draft.scope, correctionReason: state.draft.correctionReason };
  state.crosswalkOffset = 0; renderEditor();
});
$('dataset').addEventListener('input', event => { touch(); state.draft.dataset = event.target.value; });
for (const key of scopeKeys) $(key).addEventListener('input', event => { touch(); state.draft.scope[key] = event.target.value; });
$('correctionReason').addEventListener('input', event => { touch(); state.draft.correctionReason = event.target.value; });
for (const side of ['source', 'target']) $(`${side}File`).addEventListener('change', event => { chooseFile(side, event.target.files[0]); });
$('retainedSource').addEventListener('click', () => { if (!state.busy) useRetained('source'); });
$('retainedTarget').addEventListener('click', () => { if (!state.busy) useRetained('target'); });
$('addKey').addEventListener('click', () => { if (!state.busy) addField('key'); });
$('addText').addEventListener('click', () => { if (!state.busy) addField('attribute'); });
$('addAmount').addEventListener('click', () => { if (!state.busy) addField('amount'); });
$('matchingColumns').addEventListener('click', () => { if (state.busy) return; touch(); let count = 0;
  for (const field of state.draft.fields) for (const side of ['source', 'target']) if (state.headers[side].includes(field.name)) { field[side] = field.name; count++; }
  renderFields(); notice(`${count} column selections matched exact logical names. Review all remaining mappings.`);
});
$('crosswalkEnabled').addEventListener('change', event => { touch(); state.draft.crosswalk = event.target.checked ? { keys: [], rows: [] } : null; state.crosswalkOffset = 0; renderCrosswalk(); });
$('addCrosswalk').addEventListener('click', () => { if (state.busy) return; touch(); const crosswalk = state.draft.crosswalk; if (crosswalk.rows.length >= 10000) return notice('A crosswalk supports at most 10,000 approved tuples.', true);
  crosswalk.rows.push({ source: crosswalk.keys.map(() => ''), target: crosswalk.keys.map(() => '') }); state.crosswalkOffset = Math.floor((crosswalk.rows.length - 1) / 25) * 25; renderCrosswalk();
});
$('previousCrosswalk').addEventListener('click', () => { state.crosswalkOffset = Math.max(0, state.crosswalkOffset - 25); renderCrosswalk(); });
$('nextCrosswalk').addEventListener('click', () => { state.crosswalkOffset += 25; renderCrosswalk(); });
$('crosswalkFile').addEventListener('change', event => perform(async () => {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 262144) throw new Error('The crosswalk JSON must fit within 256 KiB with the complete mapping.');
  const value = JSON.parse(await file.text());
  if (!value || !Array.isArray(value.keys) || value.keys.length > 100 || !value.keys.every(key => typeof key === 'string') || !Array.isArray(value.rows) || value.rows.length > 10000 || !value.rows.every(row => row && ['source', 'target'].every(side => Array.isArray(row[side]) && row[side].length === value.keys.length && row[side].every(part => typeof part === 'string')))) throw new Error('Crosswalk JSON needs keys and matching source/target string tuples in rows.');
  touch(); state.draft.crosswalk = value; state.crosswalkOffset = 0; renderCrosswalk(); notice(`Imported ${value.rows.length} crosswalk rows. Review the key order and tuples before staging.`);
}));
$('downloadCrosswalk').addEventListener('click', () => { if (state.draft.crosswalk) downloadJson(state.draft.crosswalk, 'approved-crosswalk.json'); });
$('mappingForm').addEventListener('submit', event => { event.preventDefault(); if ($('mappingForm').reportValidity()) perform(stageMapping); });
$('previewMapping').addEventListener('click', () => perform(() => { $('mappingJson').textContent = pretty(compiledMapping()); $('mappingPreview').hidden = false; $('mappingPreview').open = true; notice('Mapping preview is ready for review.'); }));
$('downloadMapping').addEventListener('click', () => perform(() => downloadJson(compiledMapping(), 'reconciliation-spec.json')));
$('executeJob').addEventListener('click', () => perform(executeJob));
$('refreshJobs').addEventListener('click', () => perform(() => loadJobs(false)));
$('moreJobs').addEventListener('click', () => perform(() => loadJobs(true)));
$('refreshBundles').addEventListener('click', () => perform(() => loadBundles(false)));
$('moreBundles').addEventListener('click', () => perform(() => loadBundles(true)));

await perform(async () => {
  const bootstrap = await api('/api/bootstrap'); state.profile = bootstrap.profile; state.configuration = bootstrap.configuration;
  if (bootstrap.extension) {
    const path = bootstrap.extension.browserModule;
    if (typeof path !== 'string' || !/^\/[A-Za-z0-9_.\/-]+$/.test(path) || path.startsWith('//') || path.includes('..'))
      throw new Error('The local profile extension returned an invalid module path.');
    profileModule = await import(path);
    if (typeof profileModule.mountProfilePanel !== 'function' || typeof profileModule.applyPlan !== 'function')
      throw new Error('The local profile extension needs its panel mount and draft adapter.');
  }
  $('profileTitle').textContent = state.profile.title; document.title = state.profile.title;
  $('sourceLink').textContent = state.profile.source.label; $('sourceLink').href = state.profile.source.url;
  $('inputLimit').textContent = `UTF-8 CSV with a header row. Input limit ${size(state.configuration.maxInputBytes)} per export; original worker deadline ${state.configuration.timeoutMs / 1000} seconds.`;
  resetDraft(); await Promise.all([loadJobs(false), loadBundles(false)]);
  notice('Retained service opened. Select a cohort to map exports, or reopen a previous run.');
});
