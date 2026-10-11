// MIT. Existing runtime workspace presentation for the original image workflow.
const el = (tag, text, className) => {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
};
const size = bytes => Number.isFinite(bytes) ? (bytes / 1048576).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' MiB' : '—';
const detail = (label, value) => {
  const result = el('details'); result.append(el('summary', label), el('pre', JSON.stringify(value, null, 2))); return result;
};
function facts(root, pairs) {
  root.replaceChildren(...pairs.map(([name, value]) => {
    const row = el('div'); row.append(el('dt', name), el('dd', value ?? '—')); return row;
  }));
}
function options(select, values, empty, preferred) {
  const previous = preferred ?? select.value, signature = JSON.stringify(values);
  if (select.dataset.items !== signature) {
    select.replaceChildren(new Option(empty, ''), ...values.map(x => new Option(x.label, x.id)));
    select.dataset.items = signature;
  }
  if (values.some(x => x.id === previous)) select.value = previous;
}
function selectedFile(input, maximum) {
  const file = input.files[0];
  if (!file || file.size > maximum) throw new Error('Select the original file within the stated size limit.');
  return file;
}
const fingerprint = value => [value.image?.imageId, value.image?.contextSha256, value.archive?.sha256, value.archive?.bytes].join(':');
export function initImageWorkspace({ root, api, operation, refresh, openLog, message, error, switchView, getState, getToken, getView }) {
  root.innerHTML = '<div class="section-title"><div><p class="eyebrow">ORIGINAL RUNTIME IMAGE</p><h2>Prepare, build and move a merchant image</h2></div><button id="iw-refresh" type="button">Refresh images</button></div>' +
    '<p class="muted">Keep the selected source, dependency lock and immutable image together. Native build and transfer results remain with the existing operation worker.</p>' +
    '<div class="columns"><div class="panel"><h3>Image contexts</h3><div id="iw-list" class="runtime-list"></div>' +
    '<details><summary>Open an existing context</summary><form id="iw-attach"><label>Original context directory<input id="iw-directory" required autocomplete="off" placeholder="/srv/starforge/image-context"></label><label>Display name<input id="iw-label" maxlength="120"></label><button type="submit">Open context</button></form></details></div>' +
    '<div class="panel"><div class="section-title"><h3 id="iw-selected">Select an image context</h3><span id="iw-phase" class="status">EMPTY</span></div><dl id="iw-facts" class="paths"></dl>' +
    '<label>Docker executable<input id="iw-engine" value="docker" autocomplete="off"></label><div class="actions"><button id="iw-check" type="button" disabled>Check context</button><button id="iw-build" type="button" disabled>Build / reconcile image</button><button id="iw-status" type="button" disabled>Inspect local image</button><button id="iw-export" type="button" disabled>Export image</button></div>' +
    '<label class="check"><input id="iw-check-lock" type="checkbox" checked>Require the retained dependency lock when checking</label>' +
    '<details><summary>Lock the selected dependencies</summary><label>Existing package-lock.json (optional)<input id="iw-lock-file" autocomplete="off" placeholder="/srv/starforge/package-lock.json"></label><label>npm executable<input id="iw-npm" value="npm" autocomplete="off"></label><button id="iw-lock" type="button" disabled>Retain dependency lock</button><p class="note">An existing lock keeps its exact package bytes. Without a file, the original engine resolves the selected profile once and retains its lock.</p></details><div id="iw-context-detail"></div></div></div>' +
    '<div class="panel" id="iw-progress" hidden><div class="section-title"><h3 id="iw-progress-title">Native image operation</h3><button id="iw-open-log" type="button">Open original worker log</button></div><p id="iw-progress-detail" class="note"></p><pre id="iw-log" tabindex="0"></pre><div id="iw-operation-result"></div></div>' +
    '<details id="iw-create"><summary>Prepare an image from a selected runtime</summary><form id="iw-review-form"><label>Original runtime profile<select id="iw-runtime" required></select></label>' +
    '<div class="columns"><label>Stable image name<input id="iw-name" required pattern="[a-z][a-z0-9-]{0,39}" maxlength="40" placeholder="merchant-api"></label><label>Platform<select id="iw-platform"><option>linux/amd64</option><option>linux/arm64</option><option>linux/arm64/v8</option></select></label></div>' +
    '<label>Existing base image by immutable digest<input id="iw-base" required spellcheck="false" autocomplete="off" placeholder="registry/repository@sha256:…"></label>' +
    '<label>Source root inside the image<input id="iw-source-root" required value="/opt/starforge/source" autocomplete="off"></label>' +
    '<div class="columns"><label>Node path inside base image<input id="iw-node" required value="/usr/local/bin/node" autocomplete="off"></label><label>Python path inside base image<input id="iw-python" required value="/usr/bin/python3" autocomplete="off"></label><label>npm path inside base image<input id="iw-image-npm" required value="/usr/local/bin/npm" autocomplete="off"></label><label>Node headers inside base image (optional)<input id="iw-node-headers" autocomplete="off" placeholder="/usr/local"></label></div>' +
    '<div class="columns"><label>Runtime UID<input id="iw-uid" type="number" min="1" max="2147483647" value="65532" required></label><label>Runtime GID<input id="iw-gid" type="number" min="1" max="2147483647" value="65532" required></label></div>' +
    '<label>Required Python modules, separated by commas<input id="iw-python-modules" autocomplete="off" placeholder="sqlite3"></label><button type="submit">Review exact image plan</button></form>' +
    '<p class="note">The base image must already be available to the selected Docker daemon and supply these executable paths. Native profiles use the original installer’s returned source and dependency layout.</p></details>' +
    '<div class="panel"><h3>Retained image reviews</h3><label>Saved source and profile review<select id="iw-review-select"></select></label><div id="iw-review"></div><button id="iw-prepare" type="button" disabled>Prepare reviewed context</button></div>' +
    '<div class="panel"><h3>Portable images</h3><label>Original export or receiving transfer<select id="iw-transfer-select"></select></label><dl id="iw-transfer-facts" class="paths"></dl><div class="actions"><button id="iw-download-manifest" type="button" disabled>Download image-bundle.json</button><button id="iw-download-image" type="button" disabled>Download image.tar</button><button id="iw-import" type="button" disabled>Import exact image</button></div><div id="iw-transfer-result"></div>' +
    '<details><summary>Open an existing image transfer</summary><form id="iw-transfer-attach"><label>Original transfer directory<input id="iw-transfer-directory" required autocomplete="off" placeholder="/srv/starforge/image-transfer"></label><button type="submit">Open transfer</button></form></details>' +
    '<details id="iw-receive"><summary>Receive or resume an image from another operator</summary><form id="iw-upload"><label>Original image-bundle.json<input id="iw-manifest-file" type="file" accept=".json,application/json" required></label><label>Original image.tar<input id="iw-tar-file" type="file" accept=".tar,application/x-tar" required></label><div class="actions"><button id="iw-upload-start" type="submit">Receive / resume upload</button><button id="iw-upload-pause" type="button" disabled>Pause upload</button></div><p id="iw-upload-progress" role="status" aria-live="polite" class="note">Uploads use retained 4 MiB chunks and support images up to 16 GiB. Select the same original files to resume after reopening.</p></form></details></div>' +
    '<div class="panel"><h3>Use the image in an existing merchant container plan</h3><form id="iw-container-review"><label>Built or imported image<select id="iw-container-image" required></select></label><label>Original runtime used by this merchant<select id="iw-container-runtime" required></select></label><label>Original plan type<select id="iw-plan-kind"><option value="host">Existing merchant host plan</option><option value="container">Existing merchant container plan</option></select></label><label>Existing merchant plan<input id="iw-container-plan" required autocomplete="off" placeholder="/srv/starforge/host-plan.json"></label><label>Source mode for a host plan<select id="iw-source-mode"><option value="bind">Bind the selected original source</option><option value="image">Use the source retained in the image</option></select></label><label class="check"><input id="iw-adapt-runtime" type="checkbox" checked>Use this image’s Node/Python paths in a retained host-plan copy</label><label>Selected source root (optional)<input id="iw-container-source" autocomplete="off" placeholder="Use the selected runtime’s source root"></label><button type="submit">Review merchant image selection</button></form><p class="note">The new plan keeps the original merchant configuration and uses this exact image ID and runtime UID/GID. Bind mode includes the selected runtime’s dependency root. The original container generator supplies the operating bundle.</p><label>Retained container review<select id="iw-container-review-select"></select></label><div id="iw-container-result"></div><button id="iw-container-prepare" type="button" disabled>Prepare original container bundle</button></div>';
  const $ = id => root.querySelector('#' + id);
  let data = null, imageId = null, transferId = null, reviewId = null, deploymentReviewId = null;
  let workspaceId = null, loading = false, again = false, epoch = 0, currentJob = null, upload = null;
  let busy = false;
  const selectedImage = () => data?.images.find(x => x.id === imageId);
  const selectedTransfer = () => data?.transfers.find(x => x.id === transferId);
  const scope = () => [getToken(), getState()?.workspaceId, epoch].join('|');
  const originalApi = api;
  api = async (...args) => {
    const before = scope(), result = await originalApi(...args);
    if (scope() !== before) throw new Error('The workspace connection changed. Reopen the retained operation.');
    return result;
  };
  const preferenceKey = () => 'starforge-runtime-images-' + workspaceId;
  const save = () => { if (workspaceId) try { localStorage.setItem(preferenceKey(), JSON.stringify({ imageId, transferId, reviewId, deploymentReviewId })); } catch {} };
  const engine = () => $('iw-engine').value.trim() || 'docker';
  function action(button, fn) {
    button.addEventListener('click', async () => {
      button.disabled = true; const activeScope = scope();
      try { message(''); await fn(); } catch (value) { if (scope() === activeScope) error(value); }
      finally { if (scope() === activeScope) { button.disabled = false; await render(); } }
    });
  }
  function form(form, fn) {
    form.addEventListener('submit', async event => {
      event.preventDefault(); const button = event.submitter, activeScope = scope(); button.disabled = true;
      try { message(''); await fn(); } catch (value) { if (scope() === activeScope) error(value); }
      finally { if (scope() === activeScope) { button.disabled = false; await render(); } }
    });
  }
  async function run(value) {
    const activeScope = scope(); busy = true;
    try {
      const result = await operation(value);
      if (scope() !== activeScope) return;
      if (result.imageId) imageId = result.imageId;
      if (result.transferId) transferId = result.transferId;
      switchView('images'); save(); await refreshImages(true);
    } finally { busy = false; }
  }
  function dependencyTable(review) {
    const rows = Object.entries(review.dependencies ?? {}), wrap = el('div', undefined, 'table-wrap');
    const table = el('table'), head = el('thead'), body = el('tbody'), hr = el('tr');
    hr.append(el('th', 'Selected dependency'), el('th', 'Exact version')); head.append(hr);
    for (const [name, version] of rows) { const tr = el('tr'); tr.append(el('td', name), el('td', version)); body.append(tr); }
    table.append(head, body); wrap.append(table); return wrap;
  }
  async function render() {
    if (!data) return;
    const original = getState(), runtimes = original?.runtimes ?? [];
    const runtimeOptions = runtimes.filter(x => x.profileId).map(x => ({ id: x.id, label: x.label + ' · ' + x.phase }));
    options($('iw-runtime'), runtimeOptions, 'Choose an original runtime', $('iw-runtime').value || original?.selected?.id);
    options($('iw-container-runtime'), runtimeOptions, 'Choose an original runtime', $('iw-container-runtime').value || original?.selected?.id);
    const list = $('iw-list'), signature = JSON.stringify([data.images, imageId]);
    if (list.dataset.signature !== signature) {
      list.dataset.signature = signature;
      list.replaceChildren(...data.images.map(value => {
        const button = el('button', undefined, 'runtime-entry' + (value.id === imageId ? ' selected' : ''));
        button.type = 'button'; button.dataset.imageId = value.id;
        button.append(el('strong', value.label), el('small', value.phase + ' · ' + (value.release?.packageVersion ?? 'retained preparation')));
        button.addEventListener('click', () => choose({ imageId: value.id }).catch(error)); return button;
      }));
      if (!data.images.length) list.append(el('p', 'Prepare an image or open its existing original context.', 'empty'));
    }
    const image = selectedImage(), related = (original?.operations ?? []).filter(x =>
      imageId && x.imageId === imageId || transferId && x.transferId === transferId);
    const active = related.find(x => x.workerActive || x.phase === 'QUEUED');
    currentJob = active ?? related[0] ?? null;
    $('iw-selected').textContent = image?.label ?? 'Select an image context';
    $('iw-phase').textContent = image?.phase ?? 'EMPTY';
    facts($('iw-facts'), image ? [['Context directory', image.directory], ['Source release', image.release?.sourceCommit],
      ['Base image', image.baseImage], ['Platform', image.platform], ['Source root in image', image.sourceRoot],
      ['Profile identity', image.profileId], ['Dependency lock', image.lockSha256], ['Immutable image ID', image.imageId]] : []);
    const contextDetail = $('iw-context-detail'), contextSignature = JSON.stringify([image?.error, image?.receipt, image?.observation]);
    if (contextDetail.dataset.signature !== contextSignature) {
      contextDetail.dataset.signature = contextSignature; contextDetail.replaceChildren();
      if (image?.error) contextDetail.append(el('p', image.error.code + ': ' + image.error.message));
      if (image?.receipt) contextDetail.append(detail('Original image receipt', image.receipt));
      if (image?.observation) contextDetail.append(detail('Last original image result', image.observation));
    }
    for (const id of ['iw-check', 'iw-lock']) $(id).disabled = !image || !!active || busy;
    $('iw-build').disabled = !image?.lockSha256 || !!active || busy;
    for (const id of ['iw-status', 'iw-export']) $(id).disabled = !image?.imageId || !!active || busy;
    options($('iw-review-select'), data.reviews.map(x => ({ id: x.reviewId, label: x.id + ' · ' + x.release.packageVersion })), 'Choose a retained image review', reviewId);
    reviewId = $('iw-review-select').value || null;
    const review = data.reviews.find(x => x.reviewId === reviewId), reviewRoot = $('iw-review');
    if (reviewRoot.dataset.review !== (reviewId ?? '')) {
      reviewRoot.dataset.review = reviewId ?? ''; reviewRoot.replaceChildren();
      if (review) {
        const dl = el('dl', undefined, 'paths');
        facts(dl, [['Source archive SHA-256', review.archiveSha256], ['Source commit', review.release.sourceCommit],
          ['Runtime profile', review.profileId], ['Base image', review.baseImage], ['Platform', review.platform],
          ['Source root', review.sourceRoot], ['Dependency root', review.dependencyRoot],
          ['Runtime user', review.uid + ':' + review.gid], ['Supported source modes', review.sourceModes.join(', ')]]);
        reviewRoot.append(dl, dependencyTable(review), detail('Complete retained review', review));
      }
    }
    $('iw-prepare').disabled = !review || busy;
    options($('iw-transfer-select'), data.transfers.map(x => ({ id: x.id, label: x.label + ' · ' + x.phase })), 'Choose an original image transfer', transferId);
    transferId = $('iw-transfer-select').value || null;
    const transfer = selectedTransfer();
    facts($('iw-transfer-facts'), transfer ? [['Original transfer directory', transfer.directory], ['State', transfer.phase],
      ['Received / original bytes', size(transfer.receivedBytes) + ' / ' + size(transfer.bytes)],
      ['Archive SHA-256', transfer.sha256], ['Immutable image ID', transfer.imageId],
      ['Source release', transfer.release?.sourceCommit]] : []);
    $('iw-download-manifest').disabled = !transfer?.manifest;
    $('iw-download-image').disabled = !transfer?.complete;
    $('iw-import').disabled = !transfer?.complete || !!active || busy;
    const result = $('iw-transfer-result'), resultSignature = JSON.stringify([transfer?.error, transfer?.observation]);
    if (result.dataset.signature !== resultSignature) {
      result.dataset.signature = resultSignature; result.replaceChildren();
      if (transfer?.error) result.append(el('p', transfer.error.code + ': ' + transfer.error.message));
      if (transfer?.observation) result.append(detail('Original import result', transfer.observation));
    }
    const imageChoices = [...data.images.filter(x => x.imageId).map(x => ({ id: 'image:' + x.id, label: x.label + ' · built image' })),
      ...data.transfers.filter(x => x.complete).map(x => ({ id: 'transfer:' + x.id, label: x.label + ' · portable image' }))];
    options($('iw-container-image'), imageChoices, 'Choose the original immutable image');
    options($('iw-container-review-select'), data.deploymentReviews.map(x => ({ id: x.deploymentReviewId,
      label: x.merchant + ' · ' + x.receipt.imageId.slice(0, 24) })), 'Choose a retained merchant image review', deploymentReviewId);
    deploymentReviewId = $('iw-container-review-select').value || null;
    const deployment = data.deploymentReviews.find(x => x.deploymentReviewId === deploymentReviewId);
    const output = $('iw-container-result');
    if (output.dataset.review !== (deploymentReviewId ?? '')) {
      output.dataset.review = deploymentReviewId ?? ''; output.replaceChildren();
      if (deployment) {
        const dl = el('dl', undefined, 'paths');
        facts(dl, [['Merchant', deployment.merchant], ['Original merchant plan', deployment.originalPlan],
          ['Original host runtime', JSON.stringify(deployment.originalHostRuntime)],
          ['Selected Node / Python', deployment.receipt.runtime.node + ' / ' + deployment.receipt.runtime.python],
          ['Previous image', deployment.originalImage], ['Selected image', deployment.receipt.imageId],
          ['Retained new plan', deployment.planFile], ['Source mode', deployment.spec.sourceMode],
          ['Source root', deployment.sourceRoot], ['Private state', deployment.privateStateRoot]]);
        output.append(dl, detail('Exact original container selection', deployment));
      }
    }
    $('iw-container-prepare').disabled = !deployment || busy || !!active;
    $('iw-progress').hidden = !currentJob;
    if (currentJob) {
      $('iw-progress-title').textContent = currentJob.operation.replaceAll('_', ' ') + ' · ' + currentJob.displayPhase;
      $('iw-progress-detail').textContent = currentJob.id + (currentJob.error ? ' · ' + currentJob.error.code + ': ' + currentJob.error.message : '');
      const resultRoot = $('iw-operation-result'), value = JSON.stringify(currentJob.result ?? null);
      if (resultRoot.dataset.result !== value) {
        resultRoot.dataset.result = value; resultRoot.replaceChildren();
        if (currentJob.result) resultRoot.append(detail('Original retained operation result', currentJob.result));
        if (currentJob.displayPhase === 'INTERRUPTED')
          resultRoot.append(el('p', 'The worker ended. The context and native build journal remain. Inspect the original image or choose Build / reconcile to continue that context.', 'note'));
      }
      if (getView() === 'images') {
        const activeScope = scope(), selectedJob = currentJob.id;
        try {
          const log = await api('/api/log?' + new URLSearchParams({ operationId: selectedJob }));
          if (scope() === activeScope && currentJob?.id === selectedJob) $('iw-log').textContent = log.text || '(Waiting for the original worker log.)';
        } catch (value) { if (scope() === activeScope && currentJob?.id === selectedJob) $('iw-log').textContent = value.message; }
      }
    }
    save();
  }
  async function refreshImages(force = false) {
    if (!getState() || !force && getView() !== 'images') return;
    if (loading) { again = true; return; }
    loading = true; const activeScope = scope();
    try {
      const state = getState();
      if (workspaceId !== state.workspaceId) {
        workspaceId = state.workspaceId; imageId = transferId = reviewId = deploymentReviewId = null;
        try { const saved = JSON.parse(localStorage.getItem(preferenceKey()) ?? 'null');
          if (saved) ({ imageId, transferId, reviewId, deploymentReviewId } = saved); } catch {}
      }
      const value = await api('/api/images/state');
      if (scope() !== activeScope) return;
      data = value;
      if (!data.images.some(x => x.id === imageId)) imageId = data.images[0]?.id ?? null;
      if (!data.transfers.some(x => x.id === transferId)) transferId = data.transfers[0]?.id ?? null;
      if (!data.reviews.some(x => x.reviewId === reviewId)) reviewId = data.reviews.at(-1)?.reviewId ?? null;
      if (!data.deploymentReviews.some(x => x.deploymentReviewId === deploymentReviewId)) deploymentReviewId = data.deploymentReviews.at(-1)?.deploymentReviewId ?? null;
      $('iw-create').open ||= !data.images.length; await render();
    } finally {
      loading = false;
      if (again) { again = false; await refreshImages(force); }
    }
  }
  async function choose(value) {
    if (value.imageId) imageId = value.imageId;
    if (value.transferId) transferId = value.transferId;
    switchView('images'); save(); await refreshImages(true);
  }
  action($('iw-refresh'), () => refreshImages(true));
  form($('iw-attach'), async () => {
    const value = await api('/api/images/attach', { directory: $('iw-directory').value.trim(), label: $('iw-label').value.trim() || undefined });
    await choose(value); message('Original context opened at its retained path.');
  });
  form($('iw-review-form'), async () => {
    const value = await api('/api/images/review', { runtimeId: $('iw-runtime').value,
      id: $('iw-name').value.trim(), baseImage: $('iw-base').value.trim(), platform: $('iw-platform').value,
      sourceRoot: $('iw-source-root').value.trim(), runtime: { node: $('iw-node').value.trim(),
        python: $('iw-python').value.trim(), npm: $('iw-image-npm').value.trim() },
      uid: Number($('iw-uid').value), gid: Number($('iw-gid').value),
      pythonModules: $('iw-python-modules').value.split(',').map(x => x.trim()).filter(Boolean),
      ...($('iw-node-headers').value.trim() ? { nodeHeaders: $('iw-node-headers').value.trim() } : {}) });
    reviewId = value.reviewId; await refreshImages(true); message('Exact original source and image profile reviewed.');
  });
  $('iw-review-select').addEventListener('change', () => { reviewId = $('iw-review-select').value; render().catch(error); });
  action($('iw-prepare'), () => run({ operation: 'image_prepare', reviewId }));
  action($('iw-check'), () => run({ operation: 'image_check', imageId, requireLock: $('iw-check-lock').checked }));
  action($('iw-lock'), () => run({ operation: 'image_lock', imageId, npm: $('iw-npm').value.trim() || 'npm',
    ...($('iw-lock-file').value.trim() ? { lockFile: $('iw-lock-file').value.trim() } : {}) }));
  action($('iw-build'), () => run({ operation: 'image_build', imageId, engine: engine() }));
  action($('iw-status'), () => run({ operation: 'image_status', imageId, engine: engine() }));
  action($('iw-export'), () => run({ operation: 'image_export', imageId, engine: engine() }));
  action($('iw-open-log'), () => currentJob && openLog({ operationId: currentJob.id }));
  $('iw-transfer-select').addEventListener('change', () => { transferId = $('iw-transfer-select').value; render().catch(error); });
  form($('iw-transfer-attach'), async () => {
    await choose(await api('/api/images/transfer-attach', { directory: $('iw-transfer-directory').value.trim() }));
  });
  action($('iw-import'), () => run({ operation: 'image_import', transferId, engine: engine() }));
  for (const [id, file] of [['iw-download-manifest', 'image-bundle.json'], ['iw-download-image', 'image.tar']]) action($(id), async () => {
    const result = await api('/api/images/download', { transferId, file });
    const link = el('a'); link.href = result.url; link.download = file; root.append(link); link.click(); link.remove();
  });
  form($('iw-upload'), async () => {
    if (upload) return;
    const activeScope = scope(), manifestFile = selectedFile($('iw-manifest-file'), 32768);
    const manifest = JSON.parse(await manifestFile.text()), file = selectedFile($('iw-tar-file'), 16 * 1024 * 1024 * 1024);
    if (file.size !== manifest.archive?.bytes) throw new Error('The selected image.tar size differs from the original manifest.');
    upload = new AbortController(); $('iw-upload-pause').disabled = false; $('iw-upload-start').disabled = true;
    const current = selectedTransfer(), mark = fingerprint(manifest);
    const key = 'starforge-runtime-image-upload-' + workspaceId;
    try {
      let selected;
      if (current?.receiving && fingerprint(current.manifest) === mark) selected = { transferId: current.id, transfer: current };
      else {
        let pending; try { pending = JSON.parse(sessionStorage.getItem(key) ?? 'null'); } catch {}
        if (!pending || pending.fingerprint !== mark) pending = { requestId: crypto.randomUUID(), fingerprint: mark };
        sessionStorage.setItem(key, JSON.stringify(pending));
        selected = await api('/api/images/transfer', { requestId: pending.requestId, manifest, label: manifest.image?.localTag });
        sessionStorage.removeItem(key);
      }
      if (scope() !== activeScope) return;
      transferId = selected.transferId; save();
      let offset = selected.transfer.receivedBytes ?? 0;
      if (selected.transfer.complete) { message('This exact original image is already received. Its native import remains available.'); return; }
      while (offset < file.size || offset === file.size && !selected.transfer.complete) {
        if (scope() !== activeScope) throw new DOMException('Workspace changed', 'AbortError');
        const stop = Math.min(offset + 4 * 1024 * 1024, file.size);
        $('iw-upload-progress').textContent = 'Receiving ' + size(offset) + ' of ' + size(file.size) + ' · retained transfer ' + transferId;
        const response = await fetch('/api/images/upload?' + new URLSearchParams({ transferId, offset: String(offset) }), {
          method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-runtime-workspace-token': getToken() },
          body: file.slice(offset, stop), signal: upload.signal });
        const result = await response.json();
        if (scope() !== activeScope) throw new DOMException('Workspace changed', 'AbortError');
        if (!response.ok) throw Object.assign(new Error(result.message ?? result.error), { code: result.error });
        offset = result.receivedBytes;
        if (result.complete) break;
      }
      $('iw-upload-progress').textContent = 'Complete · ' + size(file.size) + ' received and exact original archive SHA-256 matched.';
      message('Original portable image received. Import it through the native image engine.');
    } catch (value) {
      if (value.name === 'AbortError') {
        if (scope() === activeScope) $('iw-upload-progress').textContent = 'Upload paused. Select the same original files to resume at the retained byte offset.';
      } else throw value;
    } finally {
      upload = null; $('iw-upload-pause').disabled = true; $('iw-upload-start').disabled = false;
      if (scope() === activeScope) await refreshImages(true);
    }
  });
  $('iw-upload-pause').addEventListener('click', () => upload?.abort());
  form($('iw-container-review'), async () => {
    const selected = $('iw-container-image').value.split(':');
    if (!['image', 'transfer'].includes(selected[0])) throw new Error('Choose a built or portable image.');
    const result = await api('/api/images/container-review', { [selected[0] === 'image' ? 'imageId' : 'transferId']: selected[1],
      runtimeId: $('iw-container-runtime').value,
      [$('iw-plan-kind').value === 'host' ? 'hostPlan' : 'containerPlan']: $('iw-container-plan').value.trim(),
      sourceMode: $('iw-source-mode').value, useImageRuntime: $('iw-adapt-runtime').checked,
      ...($('iw-container-source').value.trim() ? { selectedSourceRoot: $('iw-container-source').value.trim() } : {}) });
    deploymentReviewId = result.deploymentReviewId; await refreshImages(true);
  });
  $('iw-container-review-select').addEventListener('change', () => { deploymentReviewId = $('iw-container-review-select').value; render().catch(error); });
  action($('iw-container-prepare'), () => run({ operation: 'image_container', deploymentReviewId, engine: engine() }));
  return {
    choose,
    async render() { await refreshImages(); },
    reset() {
      epoch++; upload?.abort(); data = null; workspaceId = null; imageId = transferId = reviewId = deploymentReviewId = currentJob = null;
      $('iw-manifest-file').value = ''; $('iw-tar-file').value = ''; $('iw-progress').hidden = true;
      $('iw-facts').replaceChildren(); $('iw-transfer-facts').replaceChildren(); $('iw-context-detail').replaceChildren();
    },
  };
}
