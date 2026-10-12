// MIT. Industrial operator interface; all recovery actions use the original engine.
const $ = id => document.getElementById(id);
const SESSION_KEY = 'starforge-recovery-session';
const fragment = new URLSearchParams(location.hash.slice(1));
let token = fragment.get('token') || sessionStorage.getItem(SESSION_KEY) || '';
if (/^[a-f0-9]{64}$/.test(token)) sessionStorage.setItem(SESSION_KEY, token);
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
let current = null, profileId = '', review = null, local = [], reviewEpoch = 0;
let inventoryRows = [], inventoryCursor = null, journalCursor = null, requestCursor = null;
const journal = new Map(), requests = new Map();
let polling = false, lastRequests = '', requestsExpanded = false, starting = false, detailEpoch = 0, profileEpoch = 0;
let lastDeclaredRestores = '', lastFleetRestores = '';
const busyButtons = new Set(), publisherSelections = new Map(), fleetSelections = new Map();
const localResultStamps = new Map();
const actionNames = {
  push: 'Upload encrypted snapshot', pull: 'Download encrypted snapshot', restore: 'Cold restore',
  snapshot: 'Create encrypted snapshot', verify: 'Verify local encrypted bundle', 'local-verify': 'Verify local encrypted bundle',
  'publisher-prepare': 'Prepare restored dataset publisher',
  'fleet-prepare': 'Prepare restored merchant fleet',
};
const localCommand = command => ['snapshot', 'local-verify', 'publisher-prepare', 'fleet-prepare'].includes(command);
const captureKindNames = {
  generic: 'Original snapshot plan',
  'paid-jobs': 'Paid-job merchant with original writer leases',
  'dataset-publisher': 'Dataset publisher with original writer leases',
  'merchant-fleet': 'Merchant fleet with original release and gateway leases',
};
const capturePlans = () => profile()?.capturePlans ?? [];
const publisherRestores = () => profile()?.publisherRestores ?? [];
const fleetRestores = () => profile()?.fleetRestores ?? [];
const fleetTargets = () => profile()?.fleetTargets ?? [];
const remoteConfigured = (selected = profile()) => selected?.remoteConfigured === true;
const remoteAction = action => ['push', 'pull', 'restore', 'resume'].includes(action);
const defaultAction = () => remoteConfigured() ? 'push' : capturePlans().length ? 'snapshot' :
  publisherRestores().length ? 'publisher-prepare' : fleetTargets().length ? 'fleet-prepare' : 'verify';
const supportedAction = action => (!remoteAction(action) || remoteConfigured()) &&
  (action !== 'snapshot' || capturePlans().length > 0) &&
  (action !== 'fleet-prepare' || fleetTargets().length > 0);
function requireRemote() {
  if (!remoteConfigured()) throw new Error('This profile uses local recovery. Choose capture, verification, publisher preparation, or fleet preparation, or select a profile with a configured remote store.');
}
const capturePlan = () => capturePlans().find(item => item.id === $('capture-plan').value);
const bytes = value => {
  if (!Number.isFinite(value)) return '—';
  if (value < 1024) return value.toLocaleString() + ' B';
  const unit = value < 1024 ** 2 ? 'KiB' : value < 1024 ** 3 ? 'MiB' : 'GiB';
  const divisor = unit === 'KiB' ? 1024 : unit === 'MiB' ? 1024 ** 2 : 1024 ** 3;
  return (value / divisor).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' ' + unit;
};
const date = value => value ? new Date(value).toLocaleString() : '—';
const profile = () => current?.profiles.find(item => item.id === profileId);
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
}
function errorText(error) {
  return (error.code ? error.code + ': ' : '') + error.message +
    (error.requestId ? ' · Provider request ' + error.requestId : '');
}
async function api(path, options = {}) {
  const headers = { 'X-Recovery-Token': token, ...(options.body ? { 'Content-Type': 'application/json' } : {}) };
  const response = await fetch(path, { ...options, headers, credentials: 'omit', cache: 'no-store' });
  let value;
  try { value = await response.json(); } catch { throw new Error('The workspace returned an unreadable response'); }
  if (!response.ok || value.error) {
    if (response.status === 401) { token = ''; sessionStorage.removeItem(SESSION_KEY); }
    const error = new Error(value.error?.message ?? 'Recovery workspace request failed');
    Object.assign(error, value.error ?? {}); throw error;
  }
  return value;
}
function url(path, values) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  return path + (search.size ? '?' + search : '');
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
async function task(button, action) {
  if (button && busyButtons.has(button)) return null;
  const previous = button?.disabled;
  if (button) { busyButtons.add(button); button.disabled = true; }
  try { return await action(); }
  catch (error) { notice(errorText(error), true); return null; }
  finally {
    if (button) { busyButtons.delete(button); button.disabled = previous; }
    syncCapabilities(); updateStart();
  }
}
function button(text, action) {
  const node = element('button', text); node.type = 'button';
  node.addEventListener('click', () => task(node, action)); return node;
}
function emptyRow(tbody, message, span = 4) {
  const row = element('tr'), cell = element('td', message, 'empty');
  cell.colSpan = span; row.append(cell); tbody.replaceChildren(row);
}
function nextId() {
  return 'recovery-' + Date.now().toString(36) + '-' + crypto.randomUUID().slice(0, 8);
}
function invalidateReview() {
  reviewEpoch++;
  review = null; $('review-panel').hidden = true; updateStart();
}
function updateStart() {
  const allowed = review && review.profileId === profileId &&
    (localCommand(review.command) || remoteConfigured());
  $('start-button').disabled = starting || !allowed || Boolean(current?.readOnly) || Boolean(current?.active);
}
function syncCapabilities() {
  const remote = remoteConfigured();
  for (const option of $('action').options)
    option.disabled = !supportedAction(option.value);
  for (const id of ['refresh-inventory', 'inventory-more'])
    $(id).disabled = !remote || busyButtons.has($(id));
  $('review-button').disabled = !supportedAction($('action').value) || busyButtons.has($('review-button'));
  $('inventory-panel').classList.toggle('local-only', !remote);
  $('inventory-mode-note').hidden = remote;
}
function rememberPublisherSelection() {
  if (!profileId) return;
  publisherSelections.set(profileId, {
    mode: $('publisher-source').value,
    restoreId: $('restore-operation').value,
    publisherRestoreId: $('publisher-restore').value,
  });
}
function restorePublisherSelection() {
  const saved = publisherSelections.get(profileId);
  $('publisher-source').value = saved?.mode ?? (publisherRestores().length ? 'host' : 'remote');
  $('restore-operation').value = saved?.restoreId ?? '';
  $('publisher-restore').replaceChildren();
  const chosen = saved?.publisherRestoreId;
  if (chosen) {
    const option = element('option', chosen); option.value = chosen; $('publisher-restore').append(option);
  }
}
function syncPublisherFields(publisher) {
  const host = $('publisher-source').value === 'host';
  const selected = $('publisher-restore').value;
  $('publisher-restore').replaceChildren();
  for (const item of publisherRestores()) {
    const option = element('option', item.label + ' · ' + item.id);
    option.value = item.id; $('publisher-restore').append(option);
  }
  if (selected && !publisherRestores().some(item => item.id === selected)) {
    const option = element('option', 'Saved declared restore is unavailable: ' + selected);
    option.value = selected; option.disabled = true; $('publisher-restore').append(option);
  }
  if (selected) $('publisher-restore').value = selected;
  if (!publisherRestores().length && !selected) {
    const option = element('option', 'No restored publishers declared for this profile'); option.value = '';
    $('publisher-restore').append(option);
  }
  $('restored-field').hidden = !publisher;
  $('publisher-source').disabled = !publisher;
  $('remote-restored-field').hidden = !publisher || host;
  $('host-restored-field').hidden = !publisher || !host;
  $('restore-operation').disabled = !publisher || host; $('restore-operation').required = publisher && !host;
  $('publisher-restore').disabled = !publisher || !host; $('publisher-restore').required = publisher && host;
  const selectedRestore = publisherRestores().find(item => item.id === $('publisher-restore').value);
  $('publisher-restore-help').textContent = selectedRestore ?
    'Original encrypted bundle: ' + selectedRestore.bundleDirectory + '. Existing cold restore: ' + selectedRestore.restoreDirectory + '.' :
    'The host administrator declares the original encrypted bundle and its existing plaintext restore within this profile’s roots.';
  refreshRestoreChoices();
}
function fleetDraftKey() {
  return 'starforge-fleet-selection/v1/' + JSON.stringify([current?.id, current?.directory, profileId]);
}
function readFleetSelection() {
  const key = fleetDraftKey();
  if (fleetSelections.has(key)) return fleetSelections.get(key);
  let saved = null;
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (value?.schema === 'starforge-fleet-selection/v1' &&
        ['host', 'remote'].includes(value.source) &&
        ['restoreId', 'fleetRestoreId', 'fleetTargetId', 'operationId'].every(name => typeof value[name] === 'string'))
      saved = value;
  } catch {}
  fleetSelections.set(key, saved); return saved;
}
function rememberFleetSelection(active = $('action').value === 'fleet-prepare') {
  if (!profileId) return;
  const key = fleetDraftKey();
  const previous = readFleetSelection();
  const value = active ? {
    schema: 'starforge-fleet-selection/v1', active: true,
    source: $('fleet-source').value, restoreId: $('fleet-restore-operation').value,
    fleetRestoreId: $('fleet-restore').value, fleetTargetId: $('fleet-target').value,
    operationId: $('operation-id').value,
  } : previous ? { ...previous, active: false } : null;
  fleetSelections.set(key, value);
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch {}
}
function setSavedOption(id, value) {
  const node = $(id); node.replaceChildren();
  if (value) {
    const option = element('option', value); option.value = value; node.append(option);
  }
}
function restoreFleetSelection(saved = readFleetSelection(), { reopen = false } = {}) {
  $('fleet-source').value = saved?.source ?? (fleetRestores().length ? 'host' : 'remote');
  $('fleet-restore-operation').value = saved?.restoreId ?? '';
  setSavedOption('fleet-restore', saved?.fleetRestoreId);
  setSavedOption('fleet-target', saved?.fleetTargetId);
  $('fleet-quiesced').checked = false;
  if (reopen && saved?.active) {
    $('action').value = 'fleet-prepare';
    $('operation-id').value = saved.operationId;
  }
}
function declaredOptions(id, rows, emptyLabel) {
  const node = $(id), selected = node.value; node.replaceChildren();
  for (const item of rows) {
    const option = element('option', item.label + ' · ' + item.id);
    option.value = item.id; node.append(option);
  }
  if (selected && !rows.some(item => item.id === selected)) {
    const option = element('option', 'Saved declaration is unavailable: ' + selected);
    option.value = selected; option.disabled = true; node.append(option);
  }
  if (selected) node.value = selected;
  if (!rows.length && !selected) {
    const option = element('option', emptyLabel); option.value = ''; node.append(option);
  }
}
function syncFleetFields(fleet) {
  const host = $('fleet-source').value === 'host';
  declaredOptions('fleet-restore', fleetRestores(), 'No existing fleet restores declared for this profile');
  declaredOptions('fleet-target', fleetTargets(), 'No fleet receiving targets declared for this profile');
  $('fleet-field').hidden = !fleet;
  $('fleet-source').disabled = !fleet;
  $('fleet-remote-field').hidden = !fleet || host;
  $('fleet-host-field').hidden = !fleet || !host;
  $('fleet-restore-operation').disabled = !fleet || host;
  $('fleet-restore-operation').required = fleet && !host;
  $('fleet-restore').disabled = !fleet || !host;
  $('fleet-restore').required = fleet && host;
  $('fleet-target').disabled = !fleet; $('fleet-target').required = fleet;
  $('fleet-quiesced').disabled = !fleet; $('fleet-quiesced').required = fleet;
  const original = fleetRestores().find(item => item.id === $('fleet-restore').value);
  $('fleet-restore-help').textContent = original ?
    'Original encrypted bundle: ' + original.bundleDirectory + '. Existing cold restore: ' + original.restoreDirectory + '.' :
    'The host declares the original encrypted fleet bundle and its existing plaintext restore.';
  const target = fleetTargets().find(item => item.id === $('fleet-target').value);
  $('fleet-target-help').textContent = target ?
    'Receiving declaration: ' + target.targetFile + '. Original native operation: ' + target.operationDirectory + '.' :
    'The host supplies the receiving parents and new deployment directory for the original captured fleet.';
}
function useRestoredFleet(id, source = 'remote') {
  if (!fleetTargets().length) throw new Error('The host must declare the original fleet receiving target for this profile.');
  invalidateReview(); detailEpoch++;
  $('action').value = 'fleet-prepare'; $('operation-id').value = nextId();
  $('fleet-source').value = source;
  if (source === 'host') setSavedOption('fleet-restore', id);
  else $('fleet-restore-operation').value = id;
  $('sources-quiesced').checked = false; $('fleet-quiesced').checked = false;
  syncFields(); rememberFleetSelection();
  $('transfer-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
  notice('Select the declared fleet target, keep the original fleet writers stopped, and review the complete receiving paths and retained releases.');
}
function renderFleetRestores() {
  const declared = fleetRestores(), targets = fleetTargets();
  const signature = JSON.stringify([profileId, declared, targets]);
  if (signature === lastFleetRestores) return;
  lastFleetRestores = signature;
  $('fleet-restores-panel').hidden = !declared.length && !targets.length;
  $('fleet-restores-count').textContent = declared.length;
  const children = [];
  for (const item of declared) {
    const row = element('article');
    row.append(element('h3', item.label + ' · ' + item.id),
      element('p', 'Encrypted bundle: ' + item.bundleDirectory, 'mono'),
      element('p', 'Existing cold restore: ' + item.restoreDirectory, 'mono'));
    const actions = element('div', undefined, 'actions');
    const use = button('Review fleet recovery', () => useRestoredFleet(item.id, 'host'));
    use.disabled = !targets.length; actions.append(use); row.append(actions); children.push(row);
  }
  for (const target of targets) {
    const row = element('article');
    row.append(element('h3', 'Receiving target · ' + target.label + ' · ' + target.id),
      element('p', target.targetFile, 'mono'),
      element('p', 'Native receiving journal: ' + target.operationDirectory, 'mono'));
    children.push(row);
  }
  $('fleet-restores-list').replaceChildren(...children);
}
function syncFields() {
  if (!supportedAction($('action').value)) {
    invalidateReview();
    if ($('action').value !== 'fleet-prepare') $('action').value = defaultAction();
  }
  const action = $('action').value, capture = action === 'snapshot', verify = action === 'verify';
  const publisher = action === 'publisher-prepare', fleet = action === 'fleet-prepare';
  syncPublisherFields(publisher); syncFleetFields(fleet);
  syncCapabilities();
  const usesBundle = action === 'push' || action === 'restore' || verify;
  const usesRemote = action === 'pull' || action === 'restore';
  $('bundle-field').hidden = !usesBundle; $('bundle').disabled = !usesBundle;
  $('bundle').required = action === 'push' || verify;
  $('snapshot-field').hidden = !usesRemote; $('snapshot').disabled = !usesRemote;
  $('snapshot').required = usesRemote; $('snapshot').pattern = '[a-f0-9]{64}';
  $('destination-field').hidden = !(usesRemote || capture); $('destination').disabled = !(usesRemote || capture);
  $('capture-field').hidden = !capture; $('capture-plan').disabled = !capture; $('capture-plan').required = capture;
  $('sources-quiesced').disabled = !capture; $('sources-quiesced').required = capture;
  const selectedPlan = $('capture-plan').value;
  $('capture-plan').replaceChildren();
  for (const plan of capturePlans()) {
    const option = element('option', plan.label + ' · ' + plan.id); option.value = plan.id; $('capture-plan').append(option);
  }
  if (selectedPlan && !capturePlans().some(plan => plan.id === selectedPlan)) {
    const option = element('option', 'Saved capture plan is unavailable: ' + selectedPlan);
    option.value = selectedPlan; option.disabled = true; $('capture-plan').append(option);
  }
  if (selectedPlan) $('capture-plan').value = selectedPlan;
  if (!capturePlans().length) {
    const option = element('option', 'No capture plans configured for this profile'); option.value = ''; $('capture-plan').append(option);
  }
  const plan = capturePlan(), root = profile()?.bundleRoots.find(item => item.id === plan?.bundleRootId);
  $('capture-plan-help').textContent = plan ? 'Original plan: ' + plan.planFile +
    '. New encrypted bundles are placed in ' + (root?.directory ?? plan.bundleRootId) + '.' :
    'The host administrator can add an original recovery plan and its existing encrypted-bundle parent to this profile.';
  $('bundle-help').textContent = action === 'restore' ?
    'An existing matching encrypted bundle can be used. Otherwise the original engine downloads the selected snapshot.' :
    verify ? 'Authenticate every encrypted object with the original recovery engine and the host passphrase.' :
    'Select an original encrypted snapshot from the host’s backup roots.';
  $('destination-help').textContent = capture ?
    'One new directory under ' + (root?.directory ?? 'the selected capture plan’s bundle root') +
      '. Leave the name empty to use the operation ID.' :
    (action === 'restore' ? 'Plaintext destination under ' : 'Encrypted download under ') +
      (action === 'restore' ? profile()?.restoreRoot : profile()?.downloadRoot) + '.';
  $('review-button').textContent = capture ? 'Review capture' : verify ? 'Review verification' :
    publisher ? 'Review restored publisher' : fleet ? 'Review restored fleet' : 'Review transfer';
  const selected = $('bundle').value;
  $('bundle').replaceChildren();
  if (action === 'restore') {
    const option = element('option', 'Download the selected snapshot when needed'); option.value = ''; $('bundle').append(option);
  }
  for (const item of local) {
    const option = element('option', item.rootLabel + ' / ' + item.name + ' · ' + item.files + ' files');
    option.value = item.bundleId; $('bundle').append(option);
  }
  if (selected && !local.some(item => item.bundleId === selected)) {
    const option = element('option', 'Saved bundle is unavailable: ' + selected);
    option.value = selected; option.disabled = true; $('bundle').append(option);
  }
  if (selected) $('bundle').value = selected;
  if (!local.length && (action === 'push' || verify)) {
    const option = element('option', 'No original encrypted bundles in the selected roots'); option.value = ''; $('bundle').append(option);
  }
}

function refreshRestoreChoices() {
  const rows = new Map(journal);
  for (const row of requests.values())
    if (row.profileId === profileId && row.operation?.command === 'restore')
      rows.set(row.operationId, row.operation);
  $('restored-options').replaceChildren();
  for (const item of rows.values()) if (item.command === 'restore' && item.status === 'COMPLETE') {
    const option = element('option'); option.value = item.operationId;
    option.label = item.operationId + ' · ' + (item.destination ?? item.snapshotId);
    $('restored-options').append(option);
  }
}
function useRestoredPublisher(id, source = 'remote') {
  if (source === 'host' && !publisherRestores().some(item => item.id === id))
    throw new Error('Refresh this profile and select a host-declared restored publisher.');
  invalidateReview(); $('action').value = 'publisher-prepare';
  $('operation-id').value = nextId(); $('publisher-source').value = source;
  if (source === 'host') {
    syncPublisherFields(true); $('publisher-restore').value = id;
  } else $('restore-operation').value = id;
  rememberPublisherSelection();
  $('sources-quiesced').checked = false; syncFields();
  $('transfer-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
  notice('Review this ' + (source === 'host' ? 'host-declared local restore' : 'completed original restore journal') +
    ' and its original-to-restored publisher binding before preparing it.');
}
function renderDeclaredRestores() {
  const declared = publisherRestores(), signature = JSON.stringify([profileId, declared]);
  if (signature === lastDeclaredRestores) return;
  lastDeclaredRestores = signature;
  $('publisher-restores-panel').hidden = !declared.length;
  $('publisher-restores-count').textContent = declared.length;
  const children = [];
  for (const item of declared) {
    const row = element('article');
    row.append(element('h3', item.label + ' · ' + item.id),
      element('p', 'Encrypted bundle: ' + item.bundleDirectory, 'mono'),
      element('p', 'Existing cold restore: ' + item.restoreDirectory, 'mono'));
    const actions = element('div', undefined, 'actions');
    actions.append(button('Review publisher recovery', () => useRestoredPublisher(item.id, 'host')));
    row.append(actions); children.push(row);
  }
  $('publisher-restores-list').replaceChildren(...children);
}
function newSelection() {
  invalidateReview(); $('operation-id').value = nextId(); $('destination').value = '';
  $('snapshot').value = ''; $('sources-quiesced').checked = false; $('fleet-quiesced').checked = false;
  $('action').value = defaultAction(); syncFields(); rememberFleetSelection();
}

function intent() {
  const action = $('action').value;
  if (remoteAction(action)) requireRemote();
  const input = { profileId, action, id: $('operation-id').value.trim() };
  if (action === 'push' || action === 'verify') input.bundleId = $('bundle').value;
  else if (action === 'publisher-prepare') {
    rememberPublisherSelection();
    if ($('publisher-source').value === 'host') {
      input.publisherRestoreId = $('publisher-restore').value;
      if (!publisherRestores().some(item => item.id === input.publisherRestoreId))
        throw new Error('Select a host-declared restored publisher for this profile.');
    } else {
      input.restoreId = $('restore-operation').value.trim();
      if (!input.restoreId) throw new Error('Select the completed original remote restore operation ID.');
    }
  }
  else if (action === 'fleet-prepare') {
    if (!$('fleet-quiesced').checked)
      throw new Error('Stop the receiving fleet and the original selected writers, then confirm they will stay stopped through preparation.');
    input.fleetTargetId = $('fleet-target').value;
    if (!fleetTargets().some(item => item.id === input.fleetTargetId))
      throw new Error('Select a host-declared receiving target for this original fleet.');
    if ($('fleet-source').value === 'host') {
      input.fleetRestoreId = $('fleet-restore').value;
      if (!fleetRestores().some(item => item.id === input.fleetRestoreId))
        throw new Error('Select the host-declared original fleet restore.');
    } else {
      input.restoreId = $('fleet-restore-operation').value.trim();
      if (!input.restoreId) throw new Error('Select the completed original cold-restore operation ID.');
    }
    input.quiesced = true;
  }
  else if (action === 'snapshot') {
    if (!$('sources-quiesced').checked) throw new Error('Stop the declared source writers, then explicitly confirm they are quiesced before reviewing a capture.');
    if (!capturePlan()) throw new Error('Select a capture plan declared by the host administrator.');
    input.capturePlanId = $('capture-plan').value;
    input.destinationName = $('destination').value.trim() || input.id;
    input.quiesced = true;
  } else {
    input.snapshotId = $('snapshot').value.trim();
    if ($('destination').value.trim()) input.destinationName = $('destination').value.trim();
    if (action === 'restore' && $('bundle').value) input.bundleId = $('bundle').value;
  }
  if (action === 'fleet-prepare') rememberFleetSelection();
  return input;
}

function showReview(value) {
  review = value;
  const isLocal = localCommand(value.command), capture = value.command === 'snapshot';
  const publisher = value.command === 'publisher-prepare', receiving = value.restoredPublisher;
  const fleet = value.command === 'fleet-prepare';
  const files = value.files ?? value.plan?.files, size = value.plainBytes ?? value.plan?.bytes;
  const details = [
    ['Profile', current?.profiles.find(item => item.id === value.profileId)?.label ?? value.profileId],
    ['Action', actionNames[value.command] ?? value.command],
    ['Operation ID', value.operationId],
  ];
  if (value.store) details.push(
    ['Store', (value.store.endpoint ?? 'AWS S3') + ' · ' + value.store.region],
    ['Bucket / prefix', value.store.bucket + '/' + (value.store.prefix ?? '')]);
  if (capture) details.push(
    ['Capture plan', value.capturePlan?.label ?? value.capturePlan?.id ?? value.intent.capturePlanId],
    ['Capture kind', captureKindNames[value.plan?.captureKind] ?? value.plan?.captureKind ?? captureKindNames.generic],
    ['Plan SHA-256', value.plan?.planSha256 ?? '—'],
    ['Original plan', value.source],
    ['New encrypted bundle', value.destination],
    ['Declared directories', value.plan?.directories ?? '—']);
  else details.push(
    ['Encrypted source', value.source ?? 'Selected remote snapshot'],
    ['Destination', value.destination ?? (isLocal ? 'Verification of the existing encrypted bundle' : 'Immutable remote bundle and completion descriptor')]);
  if (publisher) {
    const declared = value.publisherRestore, sourceId = value.options.sourcePublisherRestoreId;
    if (value.sourceType === 'host-publisher-restore' || sourceId) details.push(
      ['Recovery source', 'Host-declared restored publisher'],
      ['Declared restore', declared ? declared.label + ' · ' + declared.id : sourceId],
      ['Declared encrypted bundle', declared?.bundleDirectory ?? value.source],
      ['Declared cold restore', declared?.restoreDirectory ?? value.destination]);
    else details.push(['Recovery source', 'Original remote restore journal'],
      ['Completed cold restore', value.options.sourceRestoreId]);
    details.push(
    ['Original dataset', receiving.originalPaths.datasetDirectory],
    ['Original publisher', receiving.originalPaths.publisherDirectory],
    ['Restored dataset', receiving.paths.datasetDirectory],
    ['Restored publisher', receiving.paths.publisherDirectory],
    ['Retained seller configuration', receiving.paths.sellerConfigFile ?? 'Use the host’s existing seller configuration'],
    ['Native preparation ID', receiving.operationId],
    ['Native review SHA-256', receiving.reviewSha256]);
  }
  details.push(
    ['Snapshot', value.snapshotId ?? (capture ? 'Assigned by the original capture after creation' : '—')],
    ['Files / bytes', Number.isInteger(files) ? files + ' files · ' + bytes(size) : 'Read and verified by the original engine']);
  $('review-details').replaceChildren();
  for (const [key, item] of details) $('review-details').append(element('dt', key), element('dd', item ?? '—'));
  const roots = value.plan?.roots ?? [];
  $('review-roots-panel').hidden = !roots.length; $('review-roots').replaceChildren();
  for (const root of roots) {
    const row = element('tr');
    row.append(element('td', root.name), element('td', root.kind), element('td', root.path, 'mono'));
    $('review-roots').append(row);
  }
  renderPublisherReview(publisher ? receiving : null);
  renderFleetReview(fleet ? value.restoredFleet : null, value.fleetTarget);
  if (fleet) {
    const sourceId = value.options.sourceFleetRestoreId ?? value.options.sourceRestoreId;
    for (const [name, item] of [
      ['Fleet recovery source', value.options.sourceFleetRestoreId ? 'Host-declared restored fleet' : 'Original completed remote restore'],
      ['Original source ID', sourceId], ['Receiving target', value.fleetTarget.label + ' · ' + value.fleetTarget.id],
      ['Native receiving operation', value.options.fleetOperationId],
    ]) $('review-details').append(element('dt', name), element('dd', item));
  }
  $('review-heading').textContent = capture ? 'Selected capture' : publisher ? 'Restored publisher binding' : fleet ? 'Original fleet receiving' :
    isLocal ? 'Selected verification' : 'Selected transfer';
  $('start-button').textContent = capture ? 'Start capture' : publisher ? 'Prepare restored publisher' : fleet ? 'Prepare restored fleet' :
    isLocal ? 'Start verification' : 'Start transfer';
  $('review-state').textContent = value.originalStatus ?? 'REVIEWED';
  $('review-note').textContent = value.originalStatus === 'COMPLETE' ?
    'This original operation is complete. Opening it retains its completed result.' :
    capture ? 'Keep every declared source writer stopped until this capture finishes. Start rereads the exact original plan and binds its roots, output and native capture identity.' :
    publisher ? 'Preparation reopens the captured work through its original stores and adopts this reviewed dataset path. Keep this operation ID for continuation; the returned paths are used by the normal dataset seller and publisher.' :
    fleet ? 'Keep the fleet and selected writers stopped. Preparation receives each original captured path and generates the declared deployment bundle under the original service account. Keep this workspace operation and its native receiving ID for continuation.' :
    isLocal ? 'The original recovery engine authenticates this exact manifest and every encrypted object. Its result remains attached to this workspace operation.' :
    value.command === 'restore' ? 'The original engine verifies the encrypted bundle and restores into this new destination. Keep the same operation ID to continue.' :
    'Starting repeats the exact selection check and uses the original transfer journal.';
  $('review-panel').hidden = false; updateStart();
  $('review-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderFleetReview(receiving, target) {
  $('fleet-review-panel').hidden = !receiving;
  for (const id of ['fleet-review-summary', 'fleet-review-roots', 'fleet-review-merchants'])
    $(id).replaceChildren();
  $('fleet-review-original').textContent = '';
  if (!receiving) return;
  const native = receiving.review, summary = receiving.summary;
  const fields = [
    ['Fleet', summary.fleet], ['Fleet plan digest', summary.planDigest],
    ['Snapshot', native.snapshotId], ['Original recovery plan SHA-256', native.sourcePlanSha256],
    ['Captured fleet profile SHA-256', native.profileSha256],
    ['Original service UID / GID', native.serviceUid + ' / ' + native.serviceGid],
    ['Receiving declaration', target?.targetFile ?? native.targetFile],
    ['Receiving declaration SHA-256', native.targetSha256],
    ['Receiving parents', native.destinationParents.join('\n')],
    ['New deployment bundle', native.deploymentBundle],
    ['Native receiving journal', native.operationDirectory],
    ['Native review SHA-256', receiving.reviewSha256],
    ['Native receiving operation', receiving.operationId],
    ['Native phase', receiving.operation?.phase ?? 'Awaiting explicit preparation'],
    ['Workspace port', summary.workspacePort],
    ['Retained release links SHA-256', summary.linksSha256 ?? 'No retained release links'],
  ];
  for (const [name, value] of fields)
    $('fleet-review-summary').append(element('dt', name), element('dd', value ?? '—'));
  const availability = new Map(receiving.availability.map(item => [item.name, item.state]));
  for (const root of native.roots) {
    const row = element('tr');
    row.append(element('td', root.name + ' · ' + root.kind),
      element('td', root.restored, 'mono'), element('td', root.destination, 'mono'),
      element('td', root.source.files + ' / ' + bytes(root.source.bytes)),
      element('td', availability.get(root.name) ?? 'Read original operation'));
    $('fleet-review-roots').append(row);
  }
  const retained = value => value === null || value === undefined ? '—' :
    typeof value === 'string' ? value : JSON.stringify(value);
  for (const merchant of summary.merchants) for (const slot of merchant.slots) {
    const row = element('tr'), identity = element('td');
    identity.append(element('div', merchant.id + ' · ' + merchant.host),
      element('small', 'Startup slot: ' + merchant.startupSlot, 'hint'));
    row.append(identity, element('td', slot.slot + ' / ' + slot.port),
      element('td', slot.generation + ' / ' + slot.retainedChanges),
      element('td', retained(slot.active), 'mono'), element('td', retained(slot.previous), 'mono'));
    $('fleet-review-merchants').append(row);
  }
  if (!$('fleet-review-merchants').children.length)
    emptyRow($('fleet-review-merchants'), 'The captured fleet contains no retained release slots.', 5);
  $('fleet-review-original').textContent = JSON.stringify(receiving, null, 2);
}
function appendFleetResult(item, prepared) {
  const paths = element('dl', undefined, 'key-values');
  for (const [name, value] of [
    ['Fleet', prepared.fleet], ['Native receiving operation', prepared.operationId],
    ['Prepared deployment bundle', prepared.deploymentBundle],
    ['Original deployment bundle', prepared.originalDeploymentBundle],
    ['Original service UID / GID', prepared.serviceUid + ' / ' + prepared.serviceGid],
    ['Native receiving journal', prepared.operationDirectory],
    ['Systemd unit', prepared.runtime?.unit], ['Workspace port', prepared.runtime?.workspacePort],
    ['Selected Node runtime', prepared.runtime?.node], ['Installed source', prepared.runtime?.sourceRoot],
    ['Completed', date(prepared.completedAt)],
  ]) if (value !== undefined && value !== null) paths.append(element('dt', name), element('dd', value));
  const complete = element('details');
  complete.append(element('summary', 'All received roots, retained merchants and original result'),
    element('pre', JSON.stringify(prepared, null, 2)));
  item.append(paths, complete, element('p',
    'Use this deployment bundle and the existing fleet launch procedure under the original service account. The saved result retains every receiving root, merchant release and native operation identity.', 'hint'));
}

function renderPublisherReview(receiving) {
  $('publisher-review-panel').hidden = !receiving;
  $('publisher-review-summary').replaceChildren(); $('publisher-versions').replaceChildren();
  $('publisher-pending').replaceChildren();
  if (!receiving) return;
  const dataset = receiving.summary.dataset, publisher = receiving.summary.publisher;
  const fields = [
    ['Current dataset snapshot', dataset.current], ['Dataset revision', dataset.revision],
    ['Publisher revision', publisher.revision], ['Retained candidates', publisher.candidates],
    ['Original workbooks', publisher.workbooks], ['Saved mappings / editions', publisher.mappings + ' / ' + publisher.mappingEditions],
    ['Buyer configurations', publisher.buyerConfigurations],
    ['Preparation phase', receiving.preparation?.phase ?? 'Awaiting explicit preparation'],
  ];
  for (const [name, value] of fields)
    $('publisher-review-summary').append(element('dt', name), element('dd', value ?? '—'));
  for (const item of dataset.versions ?? []) {
    const row = element('tr');
    row.append(element('td', item.snapshot, 'mono'), element('td', bytes(item.sourceBytes)),
      element('td', date(item.expiresAt)));
    $('publisher-versions').append(row);
  }
  if (!dataset.versions?.length) emptyRow($('publisher-versions'), 'No retained dataset generations.', 3);
  for (const item of publisher.pendingPublications ?? []) {
    const row = element('tr');
    row.append(element('td', item.candidateId, 'mono'), element('td', item.state), element('td', item.publicationId, 'mono'));
    $('publisher-pending').append(row);
  }
  if (!publisher.pendingPublications?.length) emptyRow($('publisher-pending'), 'No pending publication decisions in this capture.', 3);
}
function applyState(value, initialize = false) {
  current = value; if (!requestsExpanded) requestCursor = value.nextRequestsCursor;
  for (const row of value.requests) requests.set(row.profileId + '/' + row.operationId, row);
  if (initialize) {
    $('title').textContent = value.title; document.title = value.title + ' · Starforge';
    $('profile').replaceChildren();
    for (const item of value.profiles) { const option = element('option', item.label); option.value = item.id; $('profile').append(option); }
    profileId = value.profiles[0].id; $('profile').value = profileId; $('profile').disabled = false;
    $('workspace-reference').textContent = value.id + ' · ' + value.directory;
  }
  const selected = profile();
  $('store-label').textContent = remoteConfigured(selected) ? 'Remote store' : 'Recovery mode';
  $('store-summary').textContent = remoteConfigured(selected) ?
    selected.store.bucket + '/' + selected.store.prefix + ' · ' + selected.store.region : 'Local recovery';
  renderDeclaredRestores(); renderFleetRestores(); syncCapabilities();
  if (review && !localCommand(review.command) && !remoteConfigured(selected)) invalidateReview();
  $('passphrase-summary').textContent = selected.passphraseAvailable ? 'Available from host environment' :
    'Set ' + selected.passEnv + ' in the host environment, then restart';
  $('operations-path').textContent = selected.operations;
  $('active-summary').textContent = value.active ?
    value.active.operationId + (value.active.cancelRequested ? ' · Stop requested; reading the original completion state.' : ' · Original engine is running.') :
    'Original recovery results and transfer journals supply operation status.';
  $('requests-more').hidden = !requestCursor;
  renderRequests(); refreshRestoreChoices(); updateStart();
}
async function refreshState() {
  const initialized = Boolean(current);
  const value = await api('/api/state'); applyState(value, !current);
  const selected = profileId;
  const stamp = JSON.stringify(value.requests.filter(row => row.profileId === selected && localCommand(row.review.command))
    .map(row => [row.operationId, row.operation?.snapshotId, row.operation?.bundle, row.operation?.verified]));
  if (initialized && localResultStamps.get(selected) !== stamp) {
    localResultStamps.set(selected, stamp);
    await refreshBundles();
  } else if (!initialized) localResultStamps.set(selected, stamp);
  return value;
}

async function refreshBundles() {
  const selected = profileId, generation = profileEpoch;
  const value = await api(url('/api/bundles', { profile: selected }));
  if (selected !== profileId || generation !== profileEpoch) return;
  const previousBundle = $('bundle').value;
  const previousSnapshot = local.find(item => item.bundleId === previousBundle)?.snapshotId;
  local = value.bundles; $('bundle-count').textContent = local.length;
  const children = [];
  for (const item of local) {
    const row = element('article');
    row.append(element('h3', item.rootLabel + ' / ' + item.name),
      element('p', item.snapshotId, 'mono'),
      element('p', item.files + ' files · ' + bytes(item.plainBytes) + ' · ' + date(item.createdAt)),
      element('p', item.directory, 'mono'));
    const actions = element('div', undefined, 'actions');
    actions.append(button('Verify', () => useBundle(item, 'verify')));
    if (remoteConfigured()) actions.append(button('Upload', () => useBundle(item, 'push')));
    row.append(actions); children.push(row);
  }
  if (!children.length) children.push(element('p', 'No original encrypted bundle manifests were found in the selected host roots.', 'empty'));
  for (const error of value.errors) children.push(element('p', error.bundleId + ' · ' + error.code + ': ' + error.message, 'hint'));
  $('bundle-list').replaceChildren(...children); syncFields(); lastRequests = ''; renderRequests();
  if (['push', 'verify', 'restore'].includes($('action').value) &&
      (previousBundle !== $('bundle').value || previousSnapshot !== local.find(item => item.bundleId === $('bundle').value)?.snapshotId))
    invalidateReview();
}
function useBundle(item, action) {
  if (remoteAction(action)) requireRemote();
  if (!local.some(bundle => bundle.bundleId === item.bundleId && bundle.snapshotId === item.snapshotId))
    throw new Error('Refresh bundles and choose the current original encrypted snapshot.');
  invalidateReview(); $('action').value = action; $('operation-id').value = nextId();
  $('destination').value = ''; $('snapshot').value = ''; $('sources-quiesced').checked = false;
  syncFields(); $('bundle').value = item.bundleId;
  $('transfer-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
  notice('Selected ' + item.snapshotId + '. Review the exact ' + (action === 'verify' ? 'local verification.' : 'upload and remote store.'));
}
function useSnapshot(row, action) {
  requireRemote();
  invalidateReview(); $('action').value = action; $('snapshot').value = row.snapshotId;
  $('operation-id').value = nextId(); $('destination').value = ''; $('sources-quiesced').checked = false; syncFields();
  if (action === 'restore') {
    const match = local.find(item => item.snapshotId === row.snapshotId);
    $('bundle').value = match?.bundleId ?? '';
  }
  $('transfer-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
  notice('Selected ' + row.snapshotId + '. Review the exact transfer and destination.');
}
function renderInventory() {
  const tbody = $('inventory-rows'); tbody.replaceChildren();
  if (!remoteConfigured()) {
    inventoryRows = []; inventoryCursor = null; $('snapshot-options').replaceChildren();
    $('inventory-more').hidden = true;
    $('inventory-observed').textContent = 'Local recovery profile. The host has not selected a remote store.';
    emptyRow(tbody, 'Capture, verify, and prepare existing restored publishers or fleets through the local controls.');
    return;
  }
  for (const item of inventoryRows) {
    const row = element('tr'), id = element('td'), created = element('td', date(item.createdAt));
    id.append(element('code', item.snapshotId, 'snapshot-id'));
    const size = element('td', item.files + ' / ' + bytes(item.plainBytes), 'number');
    const actions = element('div', undefined, 'actions');
    actions.append(button('Download', () => useSnapshot(item, 'pull')), button('Restore', () => useSnapshot(item, 'restore')));
    const use = element('td'); use.append(actions); row.append(id, created, size, use); tbody.append(row);
  }
  if (!inventoryRows.length) emptyRow(tbody, 'No completed snapshots were returned by this remote inventory page.');
  $('inventory-more').hidden = !inventoryCursor;
  $('snapshot-options').replaceChildren();
  for (const item of inventoryRows) { const option = element('option'); option.value = item.snapshotId; option.label = date(item.createdAt) + ' · ' + item.files + ' files'; $('snapshot-options').append(option); }
}
async function refreshInventory(more = false) {
  if (!remoteConfigured()) { renderInventory(); syncCapabilities(); return; }
  const selected = profileId, generation = profileEpoch;
  const value = await api(url('/api/inventory', { profile: selected, limit: 20, cursor: more ? inventoryCursor : undefined }));
  if (selected !== profileId || generation !== profileEpoch || !remoteConfigured()) return;
  const values = more ? new Map(inventoryRows.map(item => [item.snapshotId, item])) : new Map();
  for (const row of value.snapshots) values.set(row.snapshotId, row);
  inventoryRows = [...values.values()]; inventoryCursor = value.nextCursor; renderInventory();
  $('inventory-observed').textContent = 'Read from ' + value.store.bucket + ' at ' + date(value.observedAt) +
    (value.ignoredObjects ? ' · ' + value.ignoredObjects + ' non-snapshot objects skipped' : '') + '.';
  notice('Remote inventory refreshed from the selected store.');
}
function showDetails(value) {
  $('detail-body').textContent = JSON.stringify(value, null, 2); $('detail-panel').hidden = false;
  $('detail-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
async function details(id) {
  const selected = profileId, generation = ++detailEpoch;
  const value = await api(url('/api/operation', { profile: selected, id }));
  if (selected === profileId && generation === detailEpoch) showDetails(value);
}
function restoreSavedSelection(row) {
  if (row.profileId !== profileId) throw new Error('Select the original operation’s profile before reopening its selection.');
  const saved = row.review.intent;
  invalidateReview(); detailEpoch++;
  $('action').value = saved.action === 'local-verify' ? 'verify' : saved.action;
  $('operation-id').value = saved.id ?? row.operationId;
  $('destination').value = saved.destinationName ?? '';
  $('snapshot').value = saved.snapshotId ?? '';
  $('restore-operation').value = saved.restoreId ?? '';
  $('publisher-source').value = saved.publisherRestoreId ? 'host' : 'remote';
  $('publisher-restore').replaceChildren();
  if (saved.publisherRestoreId) {
    const option = element('option', saved.publisherRestoreId); option.value = saved.publisherRestoreId;
    $('publisher-restore').append(option);
  }
  rememberPublisherSelection();
  if (saved.action === 'fleet-prepare') restoreFleetSelection({
    schema: 'starforge-fleet-selection/v1', active: true,
    source: saved.fleetRestoreId ? 'host' : 'remote',
    restoreId: saved.restoreId ?? '', fleetRestoreId: saved.fleetRestoreId ?? '',
    fleetTargetId: saved.fleetTargetId ?? '', operationId: saved.id ?? row.operationId,
  }, { reopen: true });
  $('sources-quiesced').checked = false; $('fleet-quiesced').checked = false;
  syncFields();
  if (saved.action === 'fleet-prepare') rememberFleetSelection();
  for (const [id, value] of [['capture-plan', saved.capturePlanId], ['bundle', saved.bundleId]]) {
    if (!value) continue;
    if (![...$(id).options].some(option => option.value === value)) {
      const option = element('option', 'Saved selection is unavailable: ' + value); option.value = value; option.disabled = true;
      $(id).append(option);
    }
    $(id).value = value;
  }
  syncFields();
  $('transfer-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
  notice(saved.action === 'snapshot' ?
    'The saved capture selection is open. Stop the declared source writers, confirm their current quiescence, and review again before starting.' :
    saved.action === 'fleet-prepare' ?
      'The saved fleet selection is open with its original source, receiving target, and operation ID. Confirm current writer shutdown, then review the complete native binding.' :
    saved.action === 'publisher-prepare' ?
      'The saved restored-publisher selection is open. Review the original restore and native binding before continuing.' :
      'The saved local verification selection is open. Review the exact original bundle before continuing.');
}
function newCaptureSelection(row) {
  restoreSavedSelection(row);
  $('operation-id').value = nextId(); $('destination').value = '';
  $('sources-quiesced').checked = false; invalidateReview(); syncFields();
  notice('The existing capture directory is preserved. Review this new operation and destination after confirming that the original source writers are stopped.');
}
async function continueRequest(row) {
  if (!localCommand(row.review.command)) requireRemote();
  try {
    await post('/api/resume', { profileId: row.profileId, id: row.operationId });
    notice('Continuing the original selection for ' + row.operationId + '.');
    await refreshState();
  } catch (error) {
    if (error.code === 'WORKSPACE_CAPTURE_REVIEW_REQUIRED' && row.profileId === profileId) {
      restoreSavedSelection(row); return;
    }
    throw error;
  }
}

async function reviewSelection(input) {
  invalidateReview();
  const generation = reviewEpoch, selected = input.profileId;
  try {
    const value = await post('/api/review', input);
    if (generation !== reviewEpoch || selected !== profileId) return null;
    showReview(value); return value;
  } catch (error) {
    if (generation !== reviewEpoch || selected !== profileId) return null;
    throw error;
  }
}
async function adopt(id) {
  requireRemote();
  const value = await reviewSelection({ profileId, action: 'resume', id });
  if (value) notice('Reviewed the original selection for ' + id + '.');
}
function renderJournal() {
  const tbody = $('operation-rows'); tbody.replaceChildren();
  for (const item of journal.values()) {
    const row = element('tr'), id = element('td'); id.append(element('code', item.operationId));
    const controls = element('div', undefined, 'actions');
    controls.append(button('Details', () => details(item.operationId)));
    const continuation = button('Review continuation', () => adopt(item.operationId));
    continuation.disabled = !remoteConfigured();
    if (!remoteConfigured()) continuation.title = 'Remote continuation requires a configured remote store.';
    controls.append(continuation);
    if (item.command === 'restore' && item.status === 'COMPLETE')
      controls.append(button('Review publisher recovery', () => useRestoredPublisher(item.operationId)));
    if (item.command === 'restore' && item.status === 'COMPLETE' && fleetTargets().length)
      controls.append(button('Review fleet recovery', () => useRestoredFleet(item.operationId)));
    const use = element('td'); use.append(controls);
    row.append(id, element('td', item.command), element('td', item.status), use); tbody.append(row);
  }
  if (!journal.size) emptyRow(tbody, 'No original recovery operations in this profile’s journal.');
  $('operations-more').hidden = !journalCursor; refreshRestoreChoices();
}
async function refreshJournal(more = false) {
  const selected = profileId, generation = profileEpoch;
  const value = await api(url('/api/operations', { profile: selected, limit: 25, cursor: more ? journalCursor : undefined }));
  if (selected !== profileId || generation !== profileEpoch) return;
  if (!more) journal.clear();
  for (const row of value.operations) journal.set(row.operationId, row);
  journalCursor = value.nextCursor; renderJournal();
  if (value.errors.length) notice(value.errors.map(error => error.operationId + ' · ' + error.code + ': ' + error.message).join(' | '), true);
}
function progressText(row) {
  const op = row.operation, progress = op?.progress;
  if (localCommand(row.review.command)) {
    const parts = [];
    const phase = typeof row.local?.progress === 'string' ? row.local.progress : row.local?.progress?.phase ?? row.local?.progress?.status;
    if (phase) parts.push('Original phase: ' + phase);
    if (Number.isInteger(op?.files)) parts.push(op.files + ' files');
    if (Number.isFinite(op?.plainBytes)) parts.push(bytes(op.plainBytes));
    if (op?.verified) parts.push('Original bundle verified');
    if (op?.prepared?.status === 'RESTORED_PUBLISHER_PREPARED') parts.push('Original dataset and publisher prepared');
    if (op?.prepared?.status === 'FLEET_RECEIVING_COMPLETE') parts.push('Original merchant fleet received');
    if (op?.status) parts.push(op.status);
    return parts.join(' · ') || 'Following the retained original local recovery operation.';
  }
  if (!op) return 'Waiting for the original operation journal.';
  const parts = [];
  if (Number.isInteger(progress?.nextObject)) parts.push(progress.nextObject + '/' + (op.files ?? '?') + ' encrypted objects');
  if (Number.isFinite(progress?.bytesWritten)) parts.push(bytes(progress.bytesWritten) + ' written');
  if (Number.isFinite(progress?.reused)) parts.push(progress.reused + ' reused');
  if (op.verified) parts.push('Original bundle verified');
  if (op.originalRestore) parts.push('Original cold restore complete');
  return parts.join(' · ') || 'Original status: ' + op.status;
}

function renderRequests() {
  const rows = [...requests.values()].filter(row => row.profileId === profileId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const signature = JSON.stringify([profileId, remoteConfigured(), rows]);
  if (signature === lastRequests) return;
  lastRequests = signature;
  const children = [];
  for (const row of rows) {
    const isLocal = localCommand(row.review.command);
    const item = element('article', undefined, 'request'), heading = element('div', undefined, 'request-head');
    heading.append(element('h3', row.operationId, 'mono'), element('span', row.phase, 'badge'));
    item.append(heading, element('p', (actionNames[row.review.command] ?? row.review.command) + ' · ' + date(row.updatedAt), 'hint'),
      element('p', progressText(row), 'hint'));
    if (isLocal && row.operation?.bundle) item.append(element('p', row.operation.bundle, 'mono'));
    if (isLocal && row.operation?.snapshotId) item.append(element('p', 'Snapshot ' + row.operation.snapshotId, 'mono'));
    if (row.review.command === 'publisher-prepare') {
      const selectedId = row.operation?.sourcePublisherRestoreId ?? row.review.options?.sourcePublisherRestoreId;
      const restoreId = row.operation?.sourceRestoreId ?? row.review.options?.sourceRestoreId;
      if (selectedId) item.append(element('p', 'Host-declared restored publisher: ' + selectedId, 'hint'));
      else if (restoreId) item.append(element('p', 'Original restore journal: ' + restoreId, 'hint'));
    }
    if (row.review.command === 'fleet-prepare') {
      const source = row.operation?.sourceFleetRestoreId ?? row.review.options?.sourceFleetRestoreId ??
        row.operation?.sourceRestoreId ?? row.review.options?.sourceRestoreId;
      item.append(element('p', 'Original fleet restore: ' + source, 'hint'),
        element('p', 'Receiving target: ' + row.review.options.fleetTargetId, 'hint'));
      const phase = row.local?.fleetPreparation?.nativeOperation?.phase ??
        row.local?.fleetPreparation?.phase ?? row.operation?.prepared?.status;
      if (phase) item.append(element('p', 'Native receiving phase: ' + phase, 'hint'));
    }
    const count = row.operation?.progress?.nextObject, total = row.operation?.files;
    if (Number.isInteger(count) && total > 0) {
      const progress = document.createElement('progress'); progress.max = total; progress.value = count;
      progress.setAttribute('aria-label', 'Encrypted objects completed'); item.append(progress);
    }
    if (row.error) item.append(element('p', row.error.code + ': ' + row.error.message, 'request-error'));
    if (row.cancelRequested) item.append(element('p', 'Stop requested. The current original capture, verification, restore, publisher preparation or fleet preparation may finish before the final readback.', 'hint'));
    const retained = row.local?.retainedCaptures ?? row.operation?.retainedCaptures;
    if (Array.isArray(retained) && retained.length) {
      const list = element('details', undefined, 'retained-captures');
      list.append(element('summary', retained.length + ' retained capture attempt' + (retained.length === 1 ? '' : 's')),
        element('pre', JSON.stringify(retained, null, 2)));
      item.append(list);
    }
    const controls = element('div', undefined, 'actions');
    if (row.operation) controls.append(button('Details', () => isLocal ? showDetails(row) : details(row.operationId)));
    if (row.running) controls.append(button('Stop execution', async () => {
      await post('/api/cancel', { profileId: row.profileId, id: row.operationId });
      notice('Stop requested for ' + row.operationId + '. Reading its retained original result.');
      await refreshState();
    }));
    else if (row.phase !== 'COMPLETE') {
      const freshCapture = row.review.command === 'snapshot' &&
        ['WORKSPACE_CAPTURE_OWNER_MISSING', 'WORKSPACE_CAPTURE_OWNER_DIFFERENT',
          'WORKSPACE_CAPTURE_DESTINATION_DIFFERENT', 'WORKSPACE_CAPTURE_DESTINATION_EXISTS'].includes(row.error?.code);
      if (freshCapture) controls.append(button('New capture selection', () => newCaptureSelection(row)));
      else {
        const continuation = button('Continue operation', () => continueRequest(row));
        continuation.disabled = !isLocal && !remoteConfigured();
        if (continuation.disabled) continuation.title = 'Remote continuation requires a configured remote store.';
        controls.append(continuation);
        if (isLocal) controls.append(button('Reopen saved selection', () => restoreSavedSelection(row)));
      }
    }
    controls.append(button('View selection', () => showDetails(row)));
    if (row.review.command === 'restore' && row.operation?.status === 'COMPLETE')
      controls.append(button('Review publisher recovery', () => useRestoredPublisher(row.operationId)));
    if (row.review.command === 'restore' && row.operation?.status === 'COMPLETE' && fleetTargets().length)
      controls.append(button('Review fleet recovery', () => useRestoredFleet(row.operationId)));
    if (row.operation?.prepared?.status === 'FLEET_RECEIVING_COMPLETE')
      appendFleetResult(item, row.operation.prepared);
    if (row.operation?.prepared?.status === 'RESTORED_PUBLISHER_PREPARED') {
      const prepared = row.operation.prepared, paths = element('dl', undefined, 'key-values');
      for (const [name, path] of [
        ['Dataset state', prepared.datasetDirectory], ['Publisher workspace', prepared.publisherDirectory],
        ['Seller configuration', prepared.sellerConfigFile], ['Prepared', date(prepared.preparedAt)],
      ]) if (path) paths.append(element('dt', name), element('dd', path));
      item.append(paths, element('p',
        'Open the normal dataset seller and publisher with these paths and the captured capacity settings. Retained publication decisions remain in the publisher.', 'hint'));
    }
    if (isLocal && row.operation?.bundle && row.operation?.snapshotId) {
      const bundle = local.find(item => item.directory === row.operation.bundle && item.snapshotId === row.operation.snapshotId);
      if (bundle) {
        controls.append(button('Verify bundle', () => useBundle(bundle, 'verify')));
        if (remoteConfigured()) controls.append(button('Upload bundle', () => useBundle(bundle, 'push')));
      }
    }
    item.append(controls); children.push(item);
  }
  if (!children.length) children.push(element('p', 'Reviewed recovery operations will remain here after the browser closes.', 'empty'));
  $('request-list').replaceChildren(...children);
}

async function loadProfile() {
  invalidateReview(); detailEpoch++; profileEpoch++; $('detail-panel').hidden = true; local = []; $('bundle').replaceChildren(); $('capture-plan').replaceChildren(); journal.clear(); inventoryRows = []; inventoryCursor = journalCursor = null;
  lastRequests = ''; renderRequests(); renderJournal();
  $('inventory-observed').textContent = 'Refresh to read the selected remote store.';
  emptyRow($('inventory-rows'), 'Remote inventory has not been read for this profile in this session.');
  $('inventory-more').hidden = true; $('snapshot-options').replaceChildren();
  const savedFleet = readFleetSelection();
  applyState(current); restorePublisherSelection(); restoreFleetSelection(savedFleet); newSelection();
  if (savedFleet?.active) {
    restoreFleetSelection(savedFleet, { reopen: true }); syncFields(); rememberFleetSelection();
  }
  if (!remoteConfigured()) renderInventory();
  const selected = profileId, generation = profileEpoch;
  const results = await Promise.allSettled([refreshBundles(), refreshJournal()]);
  if (selected !== profileId || generation !== profileEpoch) return;
  for (const result of results) if (result.status === 'rejected') notice(errorText(result.reason), true);
}
$('profile').addEventListener('change', () => task($('profile'), async () => {
  rememberPublisherSelection(); rememberFleetSelection(); profileId = $('profile').value; await loadProfile();
}));
$('action').addEventListener('change', () => {
  invalidateReview(); $('sources-quiesced').checked = false; $('fleet-quiesced').checked = false;
  if ($('action').value === 'fleet-prepare') {
    const saved = readFleetSelection();
    restoreFleetSelection(saved ? { ...saved, active: true } : null, { reopen: true });
  }
  syncFields(); rememberFleetSelection();
});
$('capture-plan').addEventListener('change', () => { invalidateReview(); $('sources-quiesced').checked = false; syncFields(); });
$('sources-quiesced').addEventListener('change', invalidateReview);
for (const id of ['bundle', 'snapshot', 'operation-id', 'destination']) $(id).addEventListener('input', () => {
  invalidateReview(); if (id === 'operation-id' && $('action').value === 'fleet-prepare') rememberFleetSelection();
});
$('fleet-quiesced').addEventListener('change', invalidateReview);
$('fleet-restore-operation').addEventListener('input', () => {
  $('fleet-quiesced').checked = false; invalidateReview(); rememberFleetSelection();
});
for (const id of ['fleet-source', 'fleet-restore', 'fleet-target']) $(id).addEventListener('change', () => {
  $('fleet-quiesced').checked = false; invalidateReview(); syncFields(); rememberFleetSelection();
});
$('restore-operation').addEventListener('input', () => { rememberPublisherSelection(); invalidateReview(); });
$('publisher-source').addEventListener('change', () => {
  rememberPublisherSelection(); invalidateReview(); syncFields();
});
$('publisher-restore').addEventListener('change', () => {
  rememberPublisherSelection(); invalidateReview(); syncFields();
});
$('new-selection').addEventListener('click', newSelection);
$('transfer-form').addEventListener('submit', event => {
  event.preventDefault();
  task($('review-button'), async () => {
    const value = await reviewSelection(intent());
    if (value) notice(value.command === 'snapshot' ? 'Review the exact source roots, plan and encrypted output below.' :
      value.command === 'local-verify' ? 'Review the exact original encrypted bundle below.' :
      value.command === 'publisher-prepare' ? 'Review the old and restored bindings, saved work, expiry and publication decisions below.' :
      value.command === 'fleet-prepare' ? 'Review all original receiving roots, merchant slots, retained releases, service identity and the native operation below.' :
      'Review the exact snapshot, store and destination below.');
  });
});
$('discard-review').addEventListener('click', invalidateReview);
$('start-button').addEventListener('click', () => task($('start-button'), async () => {
  const chosen = review;
  if (!chosen || starting || chosen.profileId !== profileId) return;
  if (!localCommand(chosen.command)) requireRemote();
  starting = true; updateStart();
  try {
    const result = await post('/api/start', { selection: chosen.intent, expectedReviewHash: chosen.reviewHash });
    if (review?.reviewHash === chosen.reviewHash) invalidateReview();
    requests.set(result.profileId + '/' + result.operationId, result);
    notice('Original recovery operation ' + result.operationId + ' opened. Its selection and progress are retained.');
    await refreshState();
    if (!localCommand(chosen.command)) await refreshJournal();
  } catch (error) {
    if (error.code === 'WORKSPACE_CAPTURE_REVIEW_REQUIRED' && chosen.profileId === profileId) {
      restoreSavedSelection({ profileId: chosen.profileId, operationId: chosen.operationId, review: chosen });
    } else throw error;
  } finally { starting = false; updateStart(); }
}));

$('refresh-bundles').addEventListener('click', () => task($('refresh-bundles'), refreshBundles));
$('refresh-inventory').addEventListener('click', () => task($('refresh-inventory'), () => refreshInventory()));
$('inventory-more').addEventListener('click', () => task($('inventory-more'), () => refreshInventory(true)));
$('refresh-progress').addEventListener('click', () => task($('refresh-progress'), async () => {
  await refreshState(); notice('Original operation progress refreshed.');
}));
$('refresh-operations').addEventListener('click', () => task($('refresh-operations'), () => refreshJournal()));
$('operations-more').addEventListener('click', () => task($('operations-more'), () => refreshJournal(true)));
$('requests-more').addEventListener('click', () => task($('requests-more'), async () => {
  const value = await api(url('/api/requests', { cursor: requestCursor, limit: 50 }));
  requestsExpanded = true;
  for (const row of value.requests) requests.set(row.profileId + '/' + row.operationId, row);
  requestCursor = value.nextCursor; $('requests-more').hidden = !requestCursor; renderRequests();
}));
$('close-details').addEventListener('click', () => { detailEpoch++; $('detail-panel').hidden = true; });
async function poll() {
  if (polling || !token) return;
  polling = true;
  try { if (!document.hidden) await refreshState(); }
  catch (error) { notice(errorText(error), true); }
  finally {
    polling = false;
    if (token) setTimeout(poll, current?.active ? 2500 : 15000);
  }
}
async function boot() {
  if (!/^[a-f0-9]{64}$/.test(token)) {
    notice('Open the current browser URL printed by workspace serve to access this recovery workspace.', true); return;
  }
  try {
    await refreshState(); await loadProfile();
    notice(remoteConfigured() ?
      'Recovery workspace ready. Choose a declared source capture, an original encrypted bundle, or the remote inventory.' :
      'Local recovery workspace ready. Choose a declared source capture, verify an encrypted bundle, or review an existing restored publisher or fleet.');
    setTimeout(poll, 5000);
  } catch (error) { notice(errorText(error), true); }
}
boot();
