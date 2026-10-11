// MIT. The browser presents the original SF101 controller's plans and observations.
const $ = id => document.getElementById(id);
const baseUrl = new URL('./', location.href);
const resourceUrl = path => new URL(path.replace(/^\//, ''), baseUrl);
const state = { token: null, profile: null, profiles: [], profilesCursor: null, reviews: [], reviewsCursor: null,
  recent: [], selectedReview: null, detail: null, optionId: null, comparison: null, compareIds: new Set(), generation: 0,
  refreshing: false, polling: null, stopping: false };
const names = { SAC_RECIPIENT_READY: 'Ready to receive', ACTION_REQUIRED: 'Account action', CONFIGURATION_REQUIRED: 'Configuration',
  READ_FAILED: 'Read failed', REVIEW_REQUIRED: 'Source / policy review', ALL_RECIPIENTS_READY: 'All recipients ready',
  MERCHANT_REVIEW_REQUIRED: 'Receiving review required', QUEUED: 'Queued', RUNNING: 'Reading native state',
  COMPLETED: 'Completed', FAILED: 'Failed', CANCELLED: 'Cancelled', INTERRUPTED: 'Interrupted' };
const errors = {
  CONFIGURATION_FILE_REQUIRED: 'Choose a seller JSON file of up to 1 MiB.',
  SELLER_CONFIG_REQUIRED: 'Use the original stellar-forge.seller-service.v1 configuration with at least one route.',
  SELLER_CONFIG_INVALID: 'The original seller compiler rejected this configuration. Check its route, response and payment definitions.',
  DUPLICATE_PAYMENT_OPTION: 'Each route must use distinct network, token and recipient payment choices. Put a different price for the same payment identity on its own route.',
  INVALID_INPUT_JSON: 'The selected file must contain valid UTF-8 JSON.',
  INVALID_PUBLIC_ORIGIN: 'Enter the seller’s HTTPS public origin, with no path or query.',
  SELLER_ORIGIN_MISMATCH: 'The entered public origin must match the origin in the seller configuration.',
  CAPTURE_SELLER_PLAN_MISMATCH: 'Select a capture from this exact saved seller configuration and compiled payment plan.',
  CAPTURE_ASSET_MAP_MISMATCH: 'The capture uses a different original asset map. Open its original saved configuration.',
  MANIFEST_DIGEST_MISMATCH: 'A saved bundle member differs from its original manifest.',
  EXPORT_DIGEST_MISMATCH: 'The imported review differs from its recorded file hashes.',
  COMPLETED_REVIEW_REQUIRED: 'Choose a completed receiving review.',
  WORKSPACE_NOT_ACCEPTING: 'The receiving process is finishing its current work. Reopen the same workspace after it exits.',
  REVIEW_REQUEST_CONFLICT: 'This review ID already belongs to a different saved request. Refresh the history.',
  PROFILE_REQUEST_CONFLICT: 'This profile ID already belongs to different original seller inputs.',
  IMPORT_REQUEST_CONFLICT: 'This import ID already belongs to a different retained review.',
  ENOENT: 'That saved item is unavailable. Refresh the workspace to load its current history.',
};
const text = value => value === undefined || value === null ? '—' : String(value);
const label = value => names[value] ?? text(value).replaceAll('_', ' ').toLowerCase();
const timestamp = value => {
  if (!value) return '—'; const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
};
const shortTime = value => timestamp(value).replace(' UTC', '').slice(0, 16);
const node = (tag, value, className) => { const element = document.createElement(tag); if (value !== undefined) element.textContent = text(value); if (className) element.className = className; return element; };
const append = (parent, ...children) => { parent.append(...children.filter(Boolean)); return parent; };
const code = value => node('code', value);
const badge = value => { const element = node('span', label(value), 'tag'); element.dataset.attention = String(['ACTION_REQUIRED','CONFIGURATION_REQUIRED','READ_FAILED','REVIEW_REQUIRED','FAILED','INTERRUPTED'].includes(value)); element.title = value; return element; };
const button = (value, handler, className) => { const element = node('button', value, className); element.type = 'button'; element.addEventListener('click', handler); return element; };
const row = cells => append(node('tr'), ...cells.map(value => value instanceof Node ? append(node('td'), value) : node('td', value)));
const reportMode = record => record.mode === 'imported' ? 'Imported observation' : record.mode === 'replay' ? 'Captured replay' : 'Live network reads';
const query = params => { const value = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')); return value.size ? '?' + value : ''; };
function remember(key, value) { try { if (value) localStorage.setItem('receiving-desk:' + key, value); else localStorage.removeItem('receiving-desk:' + key); } catch {} }
function recalled(key) { try { return localStorage.getItem('receiving-desk:' + key); } catch { return null; } }
function notice(message, kind = 'info') { $('message').textContent = message; $('message').dataset.kind = kind; $('message').hidden = !message; }
function failure(error) { const value = error?.code ?? error?.message ?? 'RECEIVING_WORKSPACE_FAILED'; notice((errors[value] ?? label(value)) + ' [' + value + ']', 'error'); }
async function request(path, { method = 'GET', body, binary = false } = {}) {
  const headers = { 'x-receiving-session': state.token ?? '' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(resourceUrl(path), { method, headers, credentials: 'same-origin', cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) });
  if (binary && response.ok) return response.blob();
  let payload; try { payload = await response.json(); } catch { throw Object.assign(new Error('INVALID_WORKSPACE_RESPONSE'), { code: 'INVALID_WORKSPACE_RESPONSE' }); }
  if (!response.ok || payload?.ok === false) {
    const value = payload?.error?.code ?? payload?.errorCode ?? (typeof payload?.error === 'string' ? payload.error : payload?.code) ?? 'RECEIVING_WORKSPACE_FAILED';
    throw Object.assign(new Error(value), { code: value, status: response.status });
  }
  return payload?.result ?? payload;
}
async function bootstrap() {
  const response = await fetch(resourceUrl('/api/session'), { credentials: 'same-origin', cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.code ?? payload?.error ?? 'WORKSPACE_SESSION_FAILED');
  state.token = payload.token ?? payload.sessionToken ?? payload.result?.token;
  if (typeof state.token !== 'string' || !state.token) throw new Error('WORKSPACE_SESSION_FAILED');
}
async function busy(element, task) { element.disabled = true; try { return await task(); } catch (error) { failure(error); } finally { element.disabled = false; renderControls(); } }
function mergeRows(first, second) { return [...new Map([...first, ...second].map(item => [item.id, item])).values()].sort((a, b) => b.id.localeCompare(a.id)); }
function profileFact(title, value, mono = false) { return append(node('div'), node('span', title, 'fact-label'), node(mono ? 'code' : 'span', value, 'fact-value')); }
function renderProfiles() {
  $('profile-count').textContent = String(state.profiles.length) + (state.profilesCursor ? '+' : '');
  $('profiles').replaceChildren(...state.profiles.map(profile => {
    const choices = profile.plan.routes.reduce((sum, route) => sum + route.accepts.length, 0);
    const element = button('', () => guarded(() => selectProfile(profile.id)), 'profile-entry');
    element.setAttribute('aria-current', String(profile.id === state.profile?.id));
    append(element, node('strong', profile.label), node('span', `${profile.plan.routes.length} routes · ${choices} payment choices`));
    return element;
  }));
  if (!state.profiles.length) $('profiles').append(node('p', 'Saved seller configurations will appear here.', 'empty'));
  $('more-profiles').hidden = !state.profilesCursor;
}
function renderPlan() {
  const profile = state.profile; if (!profile) return;
  $('page-title').textContent = 'Receiving desk'; $('profile-title').textContent = profile.label;
  $('profile-created').textContent = 'Saved ' + shortTime(profile.createdAt) + ' UTC';
  const files = profile.files.map(file => file.originalName).join(' · ');
  $('profile-facts').replaceChildren(profileFact('Seller origin', profile.plan.publicOrigin ?? 'Relative routes'),
    profileFact('Original files', files), profileFact('Seller SHA-256', profile.configurationSha256, true), profileFact('Plan SHA-256', profile.planDigest, true));
  const choices = profile.plan.routes.flatMap(route => route.accepts.map((terms, index) => ({ route, terms, index })));
  $('plan-summary').textContent = `${profile.plan.routes.length} configured routes · ${choices.length} exact payment choices`;
  $('plan-rows').replaceChildren(...choices.map(({route, terms, index}) => {
    const resource = append(node('div'), node('strong', `${route.method} ${route.path}`), node('small', `Option ${index + 1} · ${route.id}`));
    const identity = append(node('div'), node('code', terms.asset, 'address'), node('small', 'Receives at'), node('code', terms.payTo, 'address'));
    const element = row([resource, code(terms.network), identity, code(terms.amount)]); element.lastChild.className = 'numeric'; return element;
  }));
  renderControls();
}
function selectOptions(element, placeholder, items, selected) {
  element.replaceChildren(new Option(placeholder, ''), ...items.map(item => new Option(item.label, item.value)));
  if (items.some(item => item.value === selected)) element.value = selected;
}
function renderControls() {
  const previous = $('previous-review').value, capture = $('capture-review').value;
  const completed = mergeRows(state.recent, state.reviews).filter(record => record.state === 'COMPLETED');
  selectOptions($('previous-review'), 'No comparison', completed.map(record => ({ value: record.id,
    label: `${shortTime(record.completedAt)} · ${record.profileLabel} · ${reportMode(record)}` })), previous);
  const captures = completed.filter(record => record.profileId === state.profile?.id && record.planDigest === state.profile?.planDigest);
  selectOptions($('capture-review'), 'Select a completed review', captures.map(record => ({ value: record.id,
    label: `${shortTime(record.completedAt)} · ${reportMode(record)}` })), capture);
  $('run-replay').disabled = !state.profile || !$('capture-review').value || state.stopping;
  $('run-live').disabled = !state.profile || state.stopping;
  $('compare-selected').disabled = state.compareIds.size !== 2;
}
function summaryText(record) {
  if (!record.summary) return record.errorCode ? label(record.errorCode) : 'Native review pending';
  const s = record.summary;
  return `${s.ready}/${s.options} ready · ${s.actionRequired} account · ${s.configurationRequired} configuration · ${s.readFailed} failed · ${s.reviewRequired ?? 0} review`;
}
function renderHistory() {
  $('history-empty').hidden = state.reviews.length > 0;
  $('more-reviews').hidden = !state.reviewsCursor;
  $('history-rows').replaceChildren(...state.reviews.map(record => {
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = state.compareIds.has(record.id);
    checkbox.disabled = record.state !== 'COMPLETED'; checkbox.setAttribute('aria-label', 'Compare ' + timestamp(record.completedAt ?? record.createdAt));
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) { if (state.compareIds.size === 2) { checkbox.checked = false; notice('Choose two saved reviews at a time.'); return; } state.compareIds.add(record.id); }
      else state.compareIds.delete(record.id);
      renderControls();
    });
    const moment = append(node('div'), node('span', shortTime(record.completedAt ?? record.startedAt ?? record.createdAt)), node('small', record.id));
    const element = row([checkbox, moment, reportMode(record), badge(record.state), summaryText(record), button('Open', () => guarded(() => selectReview(record.id)))]);
    if (state.selectedReview === record.id) element.setAttribute('aria-current', 'true'); return element;
  }));
  renderControls();
}
function metric(value, title) { return append(node('div', undefined, 'metric'), node('strong', value), node('span', title)); }
function detailGroup(title, fields) {
  const definition = node('dl'); for (const [key, value, mono] of fields.filter(([, value]) => value !== undefined && value !== null)) append(definition, node('dt', key), append(node('dd'), mono ? code(value) : node('span', value)));
  return append(node('section'), node('h4', title), definition);
}
function renderOption(optionId) {
  const detail = state.detail, option = detail?.report?.options.find(item => item.optionId === optionId);
  if (!option) return; state.optionId = option.optionId;
  for (const element of $('option-rows').children) element.setAttribute('aria-selected', String(element.dataset.optionId === optionId));
  const r = option.readiness, native = r?.native, classic = r?.classic, token = native?.token, recipient = native?.recipient;
  const heading = append(node('div', undefined, 'detail-heading'), append(node('div'), node('h3', `${option.method} ${option.path} · option ${option.optionIndex + 1}`), node('p', option.url)), badge(option.status));
  heading.querySelector('h3').id = 'option-title';
  const grid = append(node('div', undefined, 'detail-grid'),
    detailGroup('Exact payment terms', [['Network',option.terms.network,true],['Token contract',option.terms.asset,true],['Recipient',option.terms.payTo,true],
      ['Atomic amount',option.terms.amount,true],['Token amount',native?.amountDecimal ? native.amountDecimal + ' ' + (token?.symbol ?? '') : undefined],
      ['Payment scheme',option.terms.scheme],['Payment timeout',option.terms.maxTimeoutSeconds + ' seconds']]),
    detailGroup('Native token and recipient', [['Token kind',token?.kind],['Token symbol',token?.symbol],['Decimals',token?.decimals],['Contract state',r?.contract?.state ?? token?.instance?.state],
      ['Balance (atomic)',recipient?.balanceAtomic,true],['Native authorized',recipient?.authorized],['Balance ledger',recipient?.balanceLedger],['Authorization ledger',recipient?.authorizationLedger]]));
  if (classic) append(grid,
    detailGroup('Classic receiving account', [['Asset',classic.recipient.asset?.code ?? 'XLM'],['Issuer',classic.recipient.asset?.issuer,true],['Trustline authorization',classic.recipient.authorization],
      ['Existing balance',classic.recipient.existingBalance],['Trustline limit',classic.recipient.trustlineLimit],['Incoming amount',classic.recipient.amountRequested],['Inbound capacity',classic.recipient.inboundCapacity]]),
    detailGroup('Account and observations', [['Minimum reserve XLM',classic.account.minimumReserveXlm],['Available XLM',classic.account.availableXlm],['Fee operation count',classic.account.expectedOperations],
      ['Horizon ledger',classic.ledger.sequence],['Contract ledger',r?.contract?.latestLedger ?? token?.instanceLedger],['Contract live until',r?.contract?.liveUntilLedger ?? token?.liveUntilLedger],
      ['Observed at',classic.observedAt ? timestamp(classic.observedAt) : undefined],['Account actions',r?.accountAdvisories?.join(', ') || 'No additional account action observed']]));
  const actions = node('section', undefined, 'actions'); append(actions, node('h4', 'Receiving actions'));
  const exactActions = detail.actions?.find(item => item.optionId === optionId)?.actions ?? [];
  if (exactActions.length) append(actions, append(node('ul'), ...exactActions.map(action => append(node('li', action.text), node('small', action.code)))));
  else append(actions, node('p', option.status === 'SAC_RECIPIENT_READY' ? 'All observed receiving checks passed for these exact payment terms.' : 'Review the original result codes below for this payment choice.'));
  const reasons = [...(r?.reasons ?? [option.errorCode]), ...(native?.errors ?? [])].filter(Boolean);
  if (reasons.length) append(actions, node('p', reasons.map(item => typeof item === 'string' ? item : item.code ?? JSON.stringify(item)).join(' · '), 'source-details'));
  const original = node('details', undefined, 'source-details'); append(original, node('summary', 'Original option result'), node('pre', JSON.stringify(option, null, 2)));
  $('option-detail').replaceChildren(heading, grid, actions, original);
}
function renderComparison(comparison) {
  $('comparison-panel').hidden = !comparison; if (!comparison) return;
  const changes = comparison.options.filter(item => item.change !== 'UNCHANGED');
  $('comparison-summary').textContent = `${changes.length} changed · ${comparison.options.length - changes.length} unchanged`;
  $('comparison-time').textContent = `${timestamp(comparison.previousCompletedAt)} → ${timestamp(state.detail?.report?.completedAt)}`;
  $('comparison-rows').replaceChildren(...comparison.options.map(item => {
    const actions = node('div');
    if (item.resolved?.length) append(actions, node('span', 'Resolved: ' + item.resolved.join(', '), 'change-action'));
    if (item.introduced?.length) append(actions, node('span', 'Added: ' + item.introduced.join(', '), 'change-action'));
    if (!actions.childNodes.length) actions.textContent = 'No action-code change';
    return row([append(node('div'), node('strong', item.routeId + ' · option ' + (item.optionIndex + 1)), node('small', item.method && item.path ? item.method + ' ' + item.path : 'Exact original payment terms')), badge(item.change),
      `${item.before ? label(item.before) : '—'} → ${item.after ? label(item.after) : '—'}`, actions]);
  }));
}
function renderReview() {
  const detail = state.detail; $('review-panel').hidden = !detail; if (!detail) return;
  const { record, report } = detail, complete = record.state === 'COMPLETED' && !!report;
  $('review-mode').textContent = reportMode(record);
  $('review-title').textContent = complete ? label(report.status) : label(record.state);
  $('review-time').textContent = `${timestamp(record.completedAt ?? record.startedAt ?? record.createdAt)} · ${record.id}`;
  $('export-review').hidden = !complete;
  $('cancel-review').hidden = !['RUNNING','QUEUED'].includes(record.state); $('cancel-review').disabled = !!record.cancellationRequested;
  $('report-summary').hidden = $('report-observation').hidden = $('report-options').hidden = !complete;
  $('review-progress').hidden = complete;
  if (!complete) {
    const messages = { QUEUED: 'Saved in the queue. Native reads begin after the current receiving review finishes.',
      RUNNING: record.cancellationRequested ? 'Cancellation requested. The current native read is returning before the review closes.' : 'Reading the configured token, receiving account and current ledger through the original native evaluator.',
      CANCELLED: 'The review was cancelled. Its saved request remains in the history.',
      INTERRUPTED: 'The process ended before a complete review was retained. Run a new live review from this saved configuration.',
      FAILED: 'The receiving review could not complete. ' + (errors[record.errorCode] ?? label(record.errorCode)) + '.' };
    $('review-progress').textContent = messages[record.state] ?? label(record.state);
    renderComparison(null); return;
  }
  const s = report.summary;
  $('report-summary').replaceChildren(metric(s.options,'Payment choices'),metric(s.ready,'Ready'),metric(s.actionRequired,'Account action'),
    metric(s.configurationRequired,'Configuration'),metric(s.readFailed,'Read failure'),metric(s.reviewRequired ?? 0,'Source / policy'));
  const observation = [append(node('span'), node('strong', report.mode === 'LIVE_NETWORK_READS' ? 'Live observations' : 'Captured observations'), document.createTextNode(' · ' + timestamp(report.completedAt))),
    node('span', `${report.readCount ?? 0} retained source reads · ${s.routes} seller routes`)];
  if (record.mode === 'imported') observation.push(node('span', 'Imported ' + timestamp(record.importedAt)));
  if (report.sourceReasons?.length) observation.push(node('span', report.sourceReasons.map(label).join(' · ')));
  $('report-observation').replaceChildren(...observation);
  $('option-count').textContent = `${s.options} exact payment choices`;
  $('option-rows').replaceChildren(...report.options.map(option => {
    const token = option.readiness?.native?.token, nativeAmount = option.readiness?.native?.amountDecimal;
    const resource = append(node('div'), node('strong', `${option.method} ${option.path}`), node('small', `Option ${option.optionIndex + 1} · ${option.routeId}`));
    const amount = append(node('div'), node('strong', nativeAmount ? nativeAmount + ' ' + (token?.symbol ?? '') : (token?.symbol ?? 'Token')),
      node('small', option.terms.amount + ' atomic'), node('small', option.terms.network));
    const element = row([resource, badge(option.status), amount, node('code',option.terms.payTo,'address'), button('Inspect', () => renderOption(option.optionId))]);
    element.dataset.optionId = option.optionId; return element;
  }));
  const selected = report.options.find(option => option.optionId === state.optionId) ?? report.options.find(option => option.status !== 'SAC_RECIPIENT_READY') ?? report.options[0];
  if (selected) renderOption(selected.optionId);
  renderComparison(state.comparison?.currentId === record.id ? state.comparison.value : report.comparison);
}
function renderStatus(value) {
  state.stopping = value.stopping || !!value.storageError;
  $('workspace-status').textContent = value.storageError ? 'Storage needs attention · ' + value.storageError : value.stopping ? 'Finishing saved work' : value.activeReview ? `Native review active · ${value.queued} queued` : value.queued ? `${value.queued} reviews queued` : 'Workspace ready';
  renderControls();
}
async function loadProfiles(after) {
  const result = await request('/api/profiles' + query({ after }));
  state.profiles = after ? mergeRows(state.profiles, result.rows) : result.rows; state.profilesCursor = result.nextCursor; renderProfiles();
}
async function selectProfile(id, { reviewId } = {}) {
  const generation = ++state.generation;
  const [profile, reviews, recent] = await Promise.all([request('/api/profiles/' + id), request('/api/reviews' + query({ profileId: id })), request('/api/reviews')]);
  if (generation !== state.generation) return;
  state.profile = profile; state.profiles = mergeRows(state.profiles, [profile]); state.reviews = reviews.rows; state.reviewsCursor = reviews.nextCursor;
  state.recent = recent.rows; state.compareIds.clear(); state.selectedReview = null; state.detail = null; state.optionId = null; state.comparison = null;
  $('setup').hidden = true; $('close-setup').hidden = false; $('profile-workspace').hidden = false;
  remember('profile', id); renderProfiles(); renderPlan(); renderHistory(); renderReview();
  const remembered = recalled('review'), wanted = reviewId ?? (reviews.rows.some(record => record.id === remembered) ? remembered : reviews.rows[0]?.id);
  if (wanted) await selectReview(wanted, { generation });
}
async function selectReview(id, { generation = state.generation } = {}) {
  const detail = await request('/api/reviews/' + id); if (generation !== state.generation) return;
  if (detail.record.profileId !== state.profile?.id) return selectProfile(detail.record.profileId, { reviewId: id });
  state.selectedReview = id; state.detail = detail; state.optionId = null;
  if (state.comparison?.currentId !== id) state.comparison = null;
  remember('review', id); state.reviews = mergeRows(state.reviews, [detail.record]); renderReview(); renderHistory();
}
async function refresh({ full = false } = {}) {
  if (state.refreshing) return; state.refreshing = true;
  const generation = state.generation, profileId = state.profile?.id;
  try {
    const tasks = [request('/api/state'), request('/api/reviews' + query({profileId})), request('/api/reviews')];
    const [status, reviews, recent] = await Promise.all(tasks); renderStatus(status);
    if (generation !== state.generation) return;
    state.recent = recent.rows;
    if (profileId) {
      state.reviews = mergeRows(state.reviews, reviews.rows);
      if (!state.reviewsCursor) state.reviewsCursor = reviews.nextCursor;
      renderHistory();
      if (state.selectedReview) {
        const current = reviews.rows.find(record => record.id === state.selectedReview);
        if (full || state.detail?.record.state !== current?.state || ['RUNNING','QUEUED'].includes(current?.state)) {
          const detail = await request('/api/reviews/' + state.selectedReview);
          if (generation === state.generation && detail.record.id === state.selectedReview) { state.detail = detail; renderReview(); }
        }
      }
    }
    if (full) await loadProfiles();
  } finally { state.refreshing = false; }
}
async function fileInput(element, required = false) {
  const file = element.files[0]; if (!file) { if (required) throw new Error('CONFIGURATION_FILE_REQUIRED'); return undefined; }
  if (!file.size || file.size > 1024 * 1024) throw new Error('CONFIGURATION_FILE_REQUIRED');
  const bytes = new Uint8Array(await file.arrayBuffer()); let value = '';
  for (let index = 0; index < bytes.length; index += 32768) value += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return { name: file.name, base64: btoa(value) };
}
function reviewId() { return Date.now().toString(36) + '-' + [...crypto.getRandomValues(new Uint8Array(8))].map(value => value.toString(16).padStart(2,'0')).join(''); }
async function startReview(mode) {
  const profile = state.profile; if (!profile) return;
  const input = { id: reviewId(), profileId: profile.id, mode };
  if (mode === 'replay') input.captureReviewId = $('capture-review').value;
  if ($('previous-review').value) input.previousReviewId = $('previous-review').value;
  let record;
  try { record = await request('/api/reviews', { method: 'POST', body: input }); }
  catch (error) {
    // A response can be lost after durable admission. Resolve that exact ID before
    // offering another request, so the operator sees the already accepted work.
    try { record = (await request('/api/reviews/' + input.id)).record; } catch { throw error; }
  }
  notice(`${mode === 'live' ? 'Live review' : 'Capture replay'} saved in the receiving queue.`);
  if (state.profile?.id === profile.id) { state.reviews = mergeRows(state.reviews,[record]); await selectReview(record.id); }
  await refresh();
}
async function guarded(task) { try { return await task(); } catch (error) { failure(error); } }
$('new-profile').addEventListener('click', () => { $('setup').hidden = false; $('close-setup').hidden = !state.profile; $('profile-label').focus(); });
$('close-setup').addEventListener('click', () => { $('setup').hidden = true; });
$('seller-file').addEventListener('change', () => guarded(async () => {
  const file = $('seller-file').files[0]; $('file-preview').hidden = !file;
  if (!file) return; if (file.size > 1024 * 1024) throw new Error('CONFIGURATION_FILE_REQUIRED');
  $('file-preview-name').textContent = `${file.name} · ${file.size.toLocaleString()} original bytes`;
  $('file-preview-content').textContent = new TextDecoder('utf-8', { fatal: true }).decode(await file.slice(0,12000).arrayBuffer()) + (file.size > 12000 ? '\n…' : '');
  if (!$('profile-label').value) $('profile-label').value = file.name.replace(/\.json$/i,'').replaceAll(/[_-]/g,' ');
}));
$('profile-form').addEventListener('submit', event => { event.preventDefault(); busy($('save-profile'), async () => {
  notice(''); const [seller, assets, rpc] = await Promise.all([fileInput($('seller-file'),true),fileInput($('assets-file')),fileInput($('rpc-file'))]);
  const options = { timeoutMs: Number($('timeout-ms').value), feeOperations: Number($('fee-operations').value) };
  if ($('origin').value.trim()) options.origin = $('origin').value.trim(); if ($('proxy-env').value.trim()) options.proxyEnv = $('proxy-env').value.trim();
  const profile = await request('/api/profiles', { method:'POST',body:{label:$('profile-label').value,seller,assets,rpc,options} });
  state.profiles = mergeRows(state.profiles,[profile]); await selectProfile(profile.id);
  $('profile-form').reset(); $('file-preview').hidden = true; notice('Configuration saved with its exact seller bytes and compiled payment choices.');
}); });
$('capture-review').addEventListener('change', renderControls);
$('run-live').addEventListener('click', () => busy($('run-live'), () => startReview('live')));
$('run-replay').addEventListener('click', () => busy($('run-replay'), () => startReview('replay')));
$('cancel-review').addEventListener('click', () => busy($('cancel-review'), async () => {
  const id = state.selectedReview, record = await request('/api/reviews/' + id + '/cancel', {method:'POST',body:{}});
  if (id === state.selectedReview) { state.detail.record = record; renderReview(); } await refresh();
}));
$('compare-selected').addEventListener('click', () => busy($('compare-selected'), async () => {
  const records = [...state.compareIds].map(id => state.reviews.find(record => record.id === id)).sort((a,b) => (a.completedAt ?? a.createdAt).localeCompare(b.completedAt ?? b.createdAt) || a.id.localeCompare(b.id));
  if (records.length !== 2) return;
  const previousId = records[0].id, currentId = records[1].id, value = await request('/api/compare',{method:'POST',body:{previousId,currentId}});
  state.comparison = {currentId,value}; await selectReview(currentId); renderComparison(value); $('comparison-panel').scrollIntoView({block:'nearest'});
}));
$('refresh').addEventListener('click', () => busy($('refresh'), () => refresh({full:true})));
$('more-profiles').addEventListener('click', () => busy($('more-profiles'), () => loadProfiles(state.profilesCursor)));
$('more-reviews').addEventListener('click', () => busy($('more-reviews'), async () => {
  const profileId = state.profile.id, result = await request('/api/reviews' + query({profileId,after:state.reviewsCursor}));
  if (state.profile.id !== profileId) return; state.reviews = mergeRows(state.reviews,result.rows); state.reviewsCursor = result.nextCursor; renderHistory();
}));
$('export-review').addEventListener('click', () => busy($('export-review'), async () => {
  const id = state.selectedReview, blob = await request('/api/reviews/' + id + '/export',{binary:true}), url = URL.createObjectURL(blob), link = node('a');
  link.href = url; link.download = 'merchant-receiving-' + id + '.json'; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url),30000); notice('The complete review export contains the original seller inputs and seven native review files.');
}));
$('import-review').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', () => busy($('import-review'), async () => {
  const file = $('import-file').files[0]; if (!file) return;
  try {
    if (file.size > 136 * 1024 * 1024) throw new Error('BUNDLE_TOO_LARGE');
    const input = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()));
    const result = await request('/api/import',{method:'POST',body:input});
    state.profiles = mergeRows(state.profiles,[result.profile]); await selectProfile(result.profile.id,{reviewId:result.review.id});
    notice('Review imported with its original observation time, seller bytes and native capture.');
  } finally { $('import-file').value = ''; }
}));
async function poll() {
  try { await refresh(); } catch (error) { $('workspace-status').textContent = 'Connection interrupted · refresh to reconnect'; }
  state.polling = setTimeout(poll, ['QUEUED','RUNNING'].includes(state.detail?.record.state) || state.stopping ? 1500 : 8000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) guarded(() => refresh({full:true})); });
await guarded(async () => {
  await bootstrap(); await loadProfiles();
  const chosen = recalled('profile');
  if (chosen) { try { await selectProfile(chosen); } catch { if (state.profiles[0]) await selectProfile(state.profiles[0].id); } }
  else if (state.profiles[0]) await selectProfile(state.profiles[0].id);
  await refresh(); poll();
});
