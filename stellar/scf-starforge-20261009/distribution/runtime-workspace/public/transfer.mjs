// MIT. Complete operator handoff over the original retained runtime transfer.
const MAX_MANIFEST = 16 * 1024 * 1024, MAX_PART = 8 * 1024 * 1024;
const node = (tag, text, className) => {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
};
const humanBytes = value => Number.isSafeInteger(value) ? value.toLocaleString() + ' bytes' : '—';
const query = (path, values) => path + '?' + new URLSearchParams(Object.entries(values).filter(([, value]) => value !== null && value !== undefined && value !== ''));
function options(select, values, placeholder, preferred) {
  const selected = preferred ?? select.value, signature = JSON.stringify(values);
  if (select.dataset.items !== signature) {
    select.replaceChildren(new Option(placeholder, ''), ...values.map(item => new Option(item.label, item.id)));
    select.dataset.items = signature;
  }
  if (values.some(item => item.id === selected)) select.value = selected;
}
function facts(target, values, className = 'paths') {
  const list = node('dl', undefined, className);
  for (const [label, value] of values) {
    const row = node('div'); row.append(node('dt', label), node('dd', value ?? '—')); list.append(row);
  }
  target.replaceChildren(list);
}
function table(headers, rows) {
  const wrap = node('div', undefined, 'table-wrap'), result = node('table'), head = node('thead'), tr = node('tr'), body = node('tbody');
  for (const header of headers) tr.append(node('th', header));
  head.append(tr);
  for (const values of rows) {
    const row = node('tr');
    for (const value of values) { const cell = node('td'); cell.append(value instanceof Node ? value : document.createTextNode(String(value ?? '—'))); row.append(cell); }
    body.append(row);
  }
  result.append(head, body); wrap.append(result); return wrap;
}
function button(label, action, disabled = false) {
  const item = node('button', label); item.type = 'button'; item.disabled = disabled;
  item.addEventListener('click', action); return item;
}

export function createRuntimeTransferView({ root, api, getState, getToken, getView,
  operation, refreshWorkspace, openLog, switchView, message, error }) {
  root.innerHTML = '<div class="section-title"><div><h2>Offline runtime transfers</h2><p class="muted">Retain the original source, selected profile and exact dependency lock across machines.</p></div><button type="button" id="transfer-refresh">Refresh</button></div>' +
    '<p class="note">A completed source carrier contains the original source archive and lock-bound public package archives. The receiving machine rebuilds its private cache and uses the original runtime installer for preparation, native hooks and readiness.</p>' +
    '<div class="columns"><section class="panel"><h3>Export a READY runtime</h3><form id="transfer-export-form">' +
    '<label>Original saved runtime<select id="transfer-runtime"><option value="">Choose a READY runtime</option></select></label>' +
    '<button type="button" id="transfer-review">Review original source and lock</button><div id="transfer-review-result" hidden></div>' +
    '<label>Existing npm cache directory<input id="transfer-cache" autocomplete="off" placeholder="/absolute/private/npm-cache" required></label>' +
    '<label>Transfer label<input id="transfer-label" maxlength="120" value="Offline runtime handoff" required></label>' +
    '<label class="check"><input id="transfer-offline" type="checkbox" checked>Use the existing cache offline</label>' +
    '<p class="note">Clearing this option permits the public registry to supply missing lock-bound tarballs. Credentials and installed node_modules are outside this transfer.</p>' +
    '<button id="transfer-export" disabled>Create or continue the source carrier</button></form></section>' +
    '<section class="panel"><h3>Receive a source carrier</h3><form id="transfer-receive-form">' +
    '<label>Exact transfer manifest<input type="file" id="transfer-manifest-file" accept=".json,application/json" required></label>' +
    '<label>Manifest SHA-256 supplied with the carrier<input id="transfer-manifest-sha" autocomplete="off" pattern="[a-f0-9]{64}" required></label>' +
    '<label>Receiving label<input id="transfer-receive-label" maxlength="120" value="Received runtime handoff" required></label>' +
    '<button id="transfer-receive">Retain this manifest</button><p class="note" id="transfer-receive-pending" hidden></p>' +
    '<button type="button" id="transfer-receive-another" hidden>Start another receive request</button></form>' +
    '<details><summary>Open an existing transfer directory</summary><form id="transfer-attach-form">' +
    '<label>Private transfer directory<input id="transfer-attach-directory" autocomplete="off" placeholder="/absolute/private/transfer" required></label>' +
    '<label>Label<input id="transfer-attach-label" maxlength="120"></label><button>Open retained transfer</button></form></details></section></div>' +
    '<section class="panel"><h3>Retained carriers and receivers</h3><label>Selected transfer<select id="transfer-select"><option value="">Choose a transfer</option></select></label>' +
    '<div id="transfer-empty" class="empty">Create, receive or open a transfer to inspect its retained progress.</div>' +
    '<div id="transfer-selected" hidden><div class="section-title"><h3 id="transfer-selected-title"></h3><span class="status" id="transfer-phase"></span></div>' +
    '<div id="transfer-facts"></div><p class="note" id="transfer-current-error" hidden></p>' +
    '<div class="actions"><button type="button" id="transfer-manifest-download">Download original manifest</button>' +
    '<button type="button" id="transfer-complete">Verify files and populate the cache</button><button type="button" id="transfer-files-only">Verify and retain files only</button></div>' +
    '<section id="transfer-intake" hidden><h3>Upload missing parts</h3><form id="transfer-parts-form"><label>Declared part files<input type="file" id="transfer-parts" multiple required></label>' +
    '<button id="transfer-parts-submit">Receive selected parts</button></form><p class="note" id="transfer-upload-progress"></p></section>' +
    '<div class="section-title"><h3>Complete part inventory</h3><label>Filter<select id="transfer-parts-filter"><option value="all">All parts</option><option value="missing">Missing or invalid</option><option value="present">Present</option></select></label></div>' +
    '<div id="transfer-parts-table"></div><div class="actions"><button type="button" id="transfer-parts-prev">Previous</button><span id="transfer-parts-page" class="note"></span><button type="button" id="transfer-parts-next">Next</button></div>' +
    '<details id="transfer-manifest-details"><summary>Original profile, file identities and public package inventory</summary><div id="transfer-manifest-body"></div></details>' +
    '</div></section>' +
    '<section class="panel" id="transfer-install-panel" hidden><h3>Prepare and install on this machine</h3><p class="note">The exact retained lock is supplied to the original installer. It uses this receiver’s cache offline. Native modules still require the original matching Node headers, toolchain or supported native preparation on this machine.</p>' +
    '<form id="transfer-install-form"><div class="columns"><label>New runtime name<input id="transfer-install-name" pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,79}" maxlength="80" required></label>' +
    '<label>Matching Node header prefix, when needed<input id="transfer-node-headers" autocomplete="off" placeholder="Original installer default"></label></div>' +
    '<label class="check"><input id="transfer-install-now" type="checkbox" checked>Install and inspect readiness after preparation</label>' +
    '<button id="transfer-install">Prepare the original runtime</button></form>' +
    '<details><summary>Recover a retained installation into a new runtime</summary><form id="transfer-recover-form">' +
    '<label>Retained runtime from this original source and profile<select id="transfer-recover-runtime" required><option value="">Choose a retained runtime</option></select></label>' +
    '<label>New recovery name<input id="transfer-recover-name" pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,79}" maxlength="80" required></label>' +
    '<p class="note">Recovery preserves the interrupted runtime and uses the original recover operation. The selected source, profile and lock must match this receiver.</p>' +
    '<button id="transfer-recover">Recover using this exact cohort</button></form></details></section>' +
    '<section class="panel"><h3>Transfer operations and continuation</h3><div id="transfer-jobs"></div></section>';
  const $ = id => root.querySelector('#' + id);
  let state = null, selection = null, review = null, busy = false, loading = false, again = false, epoch = 0;
  let partPage = 0, artifactPage = 0, detailSignature = null;
  const pendingKey = () => 'starforge-runtime-transfer-receive-' + getState()?.workspaceId;
  const selected = () => state?.selected?.id === selection ? state.selected : null;
  const pending = () => { try { return JSON.parse(sessionStorage.getItem(pendingKey()) ?? 'null'); } catch { return null; } };
  function receiver() { return selected()?.state?.mode === 'RECEIVE'; }
  function operationActive() {
    return getState()?.operations.some(job => job.cacheTransferId === selection && (job.workerActive || job.phase === 'QUEUED'));
  }
  function controls() {
    const current = selected(), active = busy || operationActive(), hasManifest = !!current?.manifest;
    $('transfer-export').disabled = busy || !review?.ready || review.runtimeId !== $('transfer-runtime').value;
    $('transfer-review').disabled = busy || !$('transfer-runtime').value;
    $('transfer-receive').disabled = busy;
    $('transfer-manifest-download').disabled = busy || !hasManifest;
    $('transfer-complete').disabled = active || !receiver() || !current?.complete;
    $('transfer-files-only').disabled = active || !receiver() || !current?.complete;
    $('transfer-parts-submit').disabled = active || !receiver();
    $('transfer-install').disabled = active || !receiver() || !current?.complete;
    $('transfer-recover').disabled = active || !receiver() || !current?.complete;
    const saved = pending();
    $('transfer-receive-pending').hidden = !saved; $('transfer-receive-another').hidden = !saved;
    $('transfer-receive-another').disabled = busy;
    if (saved) $('transfer-receive-pending').textContent = 'Retained receive request ' + saved.requestId + '. Select the same manifest, label and supplied hash to resume it. Starting another request keeps any existing receiver intact.';
  }
  async function action(fn) {
    if (busy) return;
    busy = true; controls();
    try { await fn(); }
    catch (value) { error(value); }
    finally { busy = false; controls(); }
  }
  function runtimeOptions() {
    const source = getState();
    options($('transfer-runtime'), (source?.runtimes ?? []).filter(item => item.phase === 'READY').map(item => ({
      id: item.id, label: item.label + ' · ' + item.packageVersion,
    })), 'Choose a READY runtime');
    if (!$('transfer-runtime').value && source?.selected?.phase === 'READY') $('transfer-runtime').value = source.selected.id;
    const current = selected();
    options($('transfer-recover-runtime'), (source?.runtimes ?? []).filter(item =>
      !current?.manifest || !item.profileId || item.profileId === current.manifest.runtime.profileId).map(item => ({
      id: item.id, label: item.label + ' · ' + item.phase,
    })), 'Choose a retained runtime');
    if (review && review.runtimeId !== $('transfer-runtime').value) { review = null; $('transfer-review-result').hidden = true; }
  }
  function renderReview() {
    const target = $('transfer-review-result');
    target.hidden = !review;
    if (!review) return;
    facts(target, [['Original source commit', review.runtime.sourceCommit], ['Profile identity', review.runtime.profileId],
      ['Lock SHA-256', review.runtime.lockSha256], ['Source archive SHA-256', review.runtime.archiveSha256],
      ['Public package archives', review.inventory.publicArtifacts], ['Original lock locations', review.inventory.packageLocations],
      ['Bundled locations', review.inventory.bundledLocations]]);
    target.append(node('p', review.ready ? 'The retained source and selected dependency lock are ready for a carrier.' :
      'The original lock contains source kinds that this public-package carrier cannot represent.', 'note'));
    if (review.inventory.problems.length) target.append(table(['Original location', 'Reason'],
      review.inventory.problems.map(item => [item.path, item.code])));
    const detail = node('details'), summary = node('summary', 'Exact selected dependencies and host contract'), pinned = review;
    detail.append(summary); detail.addEventListener('toggle', () => {
      if (detail.open && !detail.querySelector('pre')) detail.append(node('pre', JSON.stringify({
        selection: pinned.selection, host: pinned.host, dependencies: pinned.dependencies,
      }, null, 2)));
    });
    target.append(detail);
  }
  async function download(kind, index) {
    const input = { cacheTransferId: selection, kind, ...(index === undefined ? {} : { index }) };
    const value = await api('/api/transfers/download', input), url = new URL(value.url, location.href);
    if (url.origin !== location.origin || !/^\/transfer-download\/[a-f0-9]{64}$/.test(url.pathname))
      throw new Error('The workspace returned an unexpected download address.');
    const anchor = node('a'); anchor.href = url.href; anchor.download = value.file; anchor.rel = 'noreferrer'; anchor.click();
    message('Downloading ' + value.file + ' · ' + humanBytes(value.bytes) + ' · SHA-256 ' + value.sha256);
  }
  function filteredParts() {
    const parts = selected()?.parts ?? [], filter = $('transfer-parts-filter').value;
    return parts.filter(part => filter === 'all' || (filter === 'missing' ?
      ['MISSING', 'INVALID'].includes(part.status) : ['PRESENT', 'VERIFIED'].includes(part.status)));
  }
  function renderParts() {
    const parts = filteredParts(), pages = Math.max(1, Math.ceil(parts.length / 40));
    partPage = Math.min(partPage, pages - 1);
    const target = $('transfer-parts-table'), current = selected();
    const signature = JSON.stringify([selection, partPage, $('transfer-parts-filter').value, current?.parts, busy]);
    if (target.dataset.rendered !== signature) {
      target.replaceChildren(parts.length ? table(['Part', 'Bytes', 'State', 'SHA-256', 'Download'],
        parts.slice(partPage * 40, (partPage + 1) * 40).map(part => [
          part.name, humanBytes(part.bytes), part.status, part.sha256,
          button('Download', () => action(() => download('part', part.index)),
            busy || !['PRESENT', 'VERIFIED'].includes(part.status)),
        ])) : node('p', 'No parts match this filter.', 'empty'));
      target.dataset.rendered = signature;
    }
    $('transfer-parts-page').textContent = 'Page ' + (partPage + 1) + ' of ' + pages + ' · ' + parts.length + ' parts';
    $('transfer-parts-prev').disabled = partPage === 0; $('transfer-parts-next').disabled = partPage >= pages - 1;
  }
  function renderManifest() {
    const detail = $('transfer-manifest-details'), target = $('transfer-manifest-body'), current = selected();
    if (!detail.open || !current?.manifest) return;
    const signature = current.manifestSha256 + ':' + artifactPage;
    if (detailSignature === signature) return;
    detailSignature = signature;
    const manifest = current.manifest;
    target.replaceChildren(table(['Retained original file', 'Bytes', 'SHA-256'],
      manifest.files.filter(file => !file.path.startsWith('artifacts/')).map(file => [file.path, humanBytes(file.bytes), file.sha256])));
    target.append(node('h3', 'Lock-bound public package archives'));
    const pages = Math.max(1, Math.ceil(manifest.artifacts.length / 40));
    artifactPage = Math.min(artifactPage, pages - 1);
    target.append(table(['Name / version', 'Original lock locations', 'Artifact bytes', 'SHA-256'],
      manifest.artifacts.slice(artifactPage * 40, (artifactPage + 1) * 40).map(item => [
        item.name + '@' + item.version, item.locations.join('\n'), humanBytes(item.bytes), item.sha256,
      ])));
    const navigation = node('div', undefined, 'actions');
    navigation.append(button('Previous packages', () => { artifactPage--; renderManifest(); }, artifactPage === 0),
      node('span', 'Page ' + (artifactPage + 1) + ' of ' + pages + ' · ' + manifest.artifacts.length + ' packages', 'note'),
      button('Next packages', () => { artifactPage++; renderManifest(); }, artifactPage >= pages - 1));
    target.append(navigation);
  }
  function renderJobs() {
    const target = $('transfer-jobs'), jobs = (getState()?.operations ?? []).filter(job =>
      job.operation?.startsWith('transfer-') && (!selection || job.cacheTransferId === selection));
    const signature = JSON.stringify([jobs, selection, busy]);
    if (target.dataset.rendered === signature) return;
    target.dataset.rendered = signature; target.replaceChildren();
    if (!jobs.length) { target.append(node('p', 'No retained transfer operation for this selection.', 'empty')); return; }
    for (const job of jobs) {
      const item = node('article', undefined, 'operation'), heading = node('div', undefined, 'section-title');
      heading.append(node('h3', job.operation), node('span', job.displayPhase ?? job.phase, 'status')); item.append(heading);
      item.append(node('p', job.id + ' · ' + (job.createdAt ?? '')));
      if (job.transferProgress) item.append(node('p', JSON.stringify(job.transferProgress), 'note'));
      if (job.targetDirectory) item.append(node('p', 'Retained target: ' + job.targetDirectory, 'note'));
      if (job.result) item.append(node('p', 'Original result: ' + (job.result.status ?? job.result.phase ?? job.phase), 'note'));
      if (job.error) item.append(node('p', job.error.code + ': ' + job.error.message, 'note'));
      const actions = node('div', undefined, 'actions');
      actions.append(button('Open original log', () => openLog({ operationId: job.id }).catch(error)));
      if (job.cacheTransferId && job.cacheTransferId !== selection)
        actions.append(button('Open transfer', () => choose(job.cacheTransferId).catch(error)));
      if (job.phase !== 'SUCCEEDED')
        actions.append(button(job.workerActive ? 'Operation is running' : 'Continue this retained operation', () => action(async () => {
          const value = await api('/api/transfers/recover-operation', { operationId: job.id });
          await refreshWorkspace(); await refresh();
          message(value.active ? 'The original operation is still active.' :
            value.completed ? 'The original operation is already complete.' : 'The same retained operation has been continued.');
        }), busy || job.workerActive));
      item.append(actions); target.append(item);
    }
  }
  function render() {
    runtimeOptions();
    options($('transfer-select'), (state?.transfers ?? []).map(item => ({ id: item.id,
      label: item.label + ' · ' + item.mode + ' · ' + item.phase })), 'Choose a transfer', selection);
    const current = selected();
    $('transfer-selected').hidden = !current; $('transfer-empty').hidden = !!current;
    $('transfer-install-panel').hidden = !current || !receiver();
    if (current) {
      $('transfer-selected-title').textContent = current.label;
      $('transfer-phase').textContent = current.state.phase;
      const manifest = current.manifest, runtime = manifest?.runtime ?? current.state.runtime;
      facts($('transfer-facts'), [['Transfer directory', current.directory], ['Transfer identity', manifest?.transferId],
        ['Manifest SHA-256', current.manifestSha256], ['Original source commit', runtime?.sourceCommit],
        ['Profile identity', runtime?.profileId], ['Original lock SHA-256', runtime?.lockSha256],
        ['Payload', manifest ? humanBytes(manifest.payload.bytes) : 'Being retained'],
        ['Parts', (current.parts?.length ?? 0) + ' · ' + (current.missingParts?.length ?? 0) + ' missing · ' + (current.invalidParts?.length ?? 0) + ' invalid'],
        ['Received originals', current.filesDirectory], ['Private npm cache', current.cacheDirectory]]);
      const issue = current.error ?? current.state.error;
      $('transfer-current-error').hidden = !issue;
      $('transfer-current-error').textContent = issue ? issue.code + (issue.message ? ': ' + issue.message : '') : '';
      $('transfer-intake').hidden = !receiver(); renderParts(); renderManifest();
    }
    const pendingReceive = pending();
    if (pendingReceive) {
      const found = state?.transfers.find(item => item.requestId === pendingReceive.requestId &&
        item.manifestSha256 === pendingReceive.manifestSha256);
      if (found) { sessionStorage.removeItem(pendingKey()); message('The original receive request is retained as ' + found.label + '.'); }
    }
    renderJobs(); controls();
  }
  async function refresh() {
    if (!getState()) return;
    if (loading) { again = true; return; }
    loading = true;
    const generation = epoch, requested = selection;
    try {
      const value = await api(query('/api/transfers/state', { cacheTransferId: selection }));
      if (generation !== epoch || requested !== selection) { again = true; return; }
      state = value; render();
    } finally {
      loading = false;
      if (again) { again = false; if (getView() === 'transfers') await refresh(); }
    }
  }
  async function choose(id) {
    selection = id || null; partPage = 0; artifactPage = 0; detailSignature = null;
    $('transfer-select').value = selection ?? ''; await refresh();
  }
  function reset() {
    epoch++; selection = null; state = null; review = null;
    detailSignature = null; partPage = 0; artifactPage = 0; $('transfer-review-result').hidden = true;
    $('transfer-selected').hidden = true; $('transfer-install-panel').hidden = true;
    $('transfer-empty').hidden = false; $('transfer-jobs').replaceChildren(); controls();
  }
  $('transfer-refresh').addEventListener('click', () => refresh().catch(error));
  $('transfer-select').addEventListener('change', () => choose($('transfer-select').value).catch(error));
  $('transfer-runtime').addEventListener('change', () => { review = null; renderReview(); controls(); });
  $('transfer-review').addEventListener('click', () => action(async () => {
    const id = $('transfer-runtime').value; review = await api('/api/transfers/review', { runtimeId: id });
    if ($('transfer-runtime').value !== id) { review = null; return; }
    renderReview();
  }));
  $('transfer-export-form').addEventListener('submit', event => {
    event.preventDefault(); action(async () => {
      if (!review?.ready || review.runtimeId !== $('transfer-runtime').value) throw new Error('Review the selected READY runtime first.');
      const result = await operation({ operation: 'transfer-export', runtimeId: review.runtimeId,
        cache: $('transfer-cache').value.trim(), label: $('transfer-label').value.trim(),
        offline: $('transfer-offline').checked, lockSha256: review.runtime.lockSha256 });
      await choose(result.cacheTransferId); switchView('transfers');
    });
  });
  $('transfer-receive-form').addEventListener('submit', event => {
    event.preventDefault(); action(async () => {
      const file = $('transfer-manifest-file').files[0], sha256 = $('transfer-manifest-sha').value.trim(),
        label = $('transfer-receive-label').value.trim(), saved = pending();
      if (!file || file.size > MAX_MANIFEST) throw new Error('Choose the original transfer manifest, at most 16 MiB.');
      if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Enter the manifest SHA-256 supplied with this carrier.');
      if (saved && (saved.manifestSha256 !== sha256 || saved.label !== label))
        throw new Error('The retained receive request has different input. Reopen its exact manifest and label first.');
      const request = saved ?? { requestId: crypto.randomUUID(), manifestSha256: sha256, label };
      sessionStorage.setItem(pendingKey(), JSON.stringify(request));
      const manifest = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
      const result = await api('/api/transfers/receive', { ...request, manifest });
      sessionStorage.removeItem(pendingKey());
      await choose(result.cacheTransferId); message('Original manifest retained. Upload its missing declared parts below.');
    });
  });
  $('transfer-receive-another').addEventListener('click', () => {
    sessionStorage.removeItem(pendingKey()); controls();
    message('A new receive request will get a new identity. Any original receiver remains retained.');
  });
  $('transfer-attach-form').addEventListener('submit', event => {
    event.preventDefault(); action(async () => {
      const input = { directory: $('transfer-attach-directory').value.trim() };
      if ($('transfer-attach-label').value.trim()) input.label = $('transfer-attach-label').value.trim();
      const result = await api('/api/transfers/attach', input); await choose(result.cacheTransferId);
      message('The existing transfer directory was opened and its parts were checked.');
    });
  });
  $('transfer-parts-form').addEventListener('submit', event => {
    event.preventDefault(); action(async () => {
      const files = [...$('transfer-parts').files], current = selected(), id = selection;
      if (!receiver() || !current?.manifest) throw new Error('Choose a retained receiver first.');
      if (new Set(files.map(file => file.name)).size !== files.length) throw new Error('Select each declared part name only once.');
      const expected = new Map(current.manifest.parts.map(part => [part.name, part]));
      for (const file of files) {
        const part = expected.get(file.name);
        if (!part || file.size !== part.bytes || file.size > MAX_PART) throw new Error('Selected file does not match a declared part: ' + file.name);
      }
      for (const [position, file] of files.entries()) {
        const part = expected.get(file.name);
        $('transfer-upload-progress').textContent = 'Receiving ' + file.name + ' · ' + (position + 1) + ' of ' + files.length;
        const response = await fetch(query('/api/transfers/upload', { cacheTransferId: id, index: part.index }), {
          method: 'POST', headers: { 'x-runtime-workspace-token': getToken(), 'content-type': 'application/octet-stream' }, body: file,
        });
        const value = await response.json();
        if (!response.ok) throw Object.assign(new Error(value.message ?? value.error), { code: value.error, status: response.status });
        $('transfer-upload-progress').textContent = (value.reused ? 'Reopened ' : 'Retained ') + file.name + ' with its declared SHA-256.';
      }
      await refresh(); message('Selected parts are retained. Complete the receiver to verify original files and populate its cache.');
    });
  });
  $('transfer-manifest-download').addEventListener('click', () => action(() => download('manifest')));
  for (const [id, populateCache] of [['transfer-complete', true], ['transfer-files-only', false]])
    $(id).addEventListener('click', () => action(async () => {
      const result = await operation({ operation: 'transfer-complete', cacheTransferId: selection, populateCache });
      await choose(result.cacheTransferId); switchView('transfers');
    }));
  function installOptions() {
    const options = { cacheTransferId: selection, install: $('transfer-install-now').checked };
    if ($('transfer-node-headers').value.trim()) options.nodeHeaders = $('transfer-node-headers').value.trim();
    return options;
  }
  $('transfer-install-form').addEventListener('submit', event => {
    event.preventDefault(); action(async () => {
      const result = await operation({ operation: 'transfer-install', name: $('transfer-install-name').value.trim(), ...installOptions() });
      await choose(result.cacheTransferId); switchView('transfers');
    });
  });
  $('transfer-recover-form').addEventListener('submit', event => {
    event.preventDefault(); action(async () => {
      const result = await operation({ operation: 'transfer-recover', runtimeId: $('transfer-recover-runtime').value,
        name: $('transfer-recover-name').value.trim(), ...installOptions() });
      await choose(result.cacheTransferId); switchView('transfers');
    });
  });
  $('transfer-parts-filter').addEventListener('change', () => { partPage = 0; renderParts(); });
  $('transfer-parts-prev').addEventListener('click', () => { partPage--; renderParts(); });
  $('transfer-parts-next').addEventListener('click', () => { partPage++; renderParts(); });
  $('transfer-manifest-details').addEventListener('toggle', renderManifest);
  return { refresh, choose, reset, render() { if (getView() === 'transfers') return refresh(); runtimeOptions(); controls(); } };
}
