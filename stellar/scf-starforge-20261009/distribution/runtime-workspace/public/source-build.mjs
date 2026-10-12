// MIT. Complete source-product workflow over the original workspace operations.
const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const query = (path, values) => path + '?' + new URLSearchParams(values);
function facts(rows, className = 'paths') {
  const list = make('dl', undefined, className);
  for (const [label, value] of rows) {
    const row = make('div'); row.append(make('dt', label), make('dd', String(value ?? '—'))); list.append(row);
  }
  return list;
}
function table(headers, rows) {
  const wrap = make('div', undefined, 'table-wrap'), node = make('table'), head = make('thead');
  const header = make('tr'), body = make('tbody');
  for (const title of headers) header.append(make('th', title)); head.append(header);
  for (const values of rows) { const row = make('tr'); for (const value of values) row.append(make('td', String(value ?? '—'))); body.append(row); }
  node.append(head, body); wrap.append(node); return wrap;
}
function detail(title, value) {
  const node = make('details'); node.append(make('summary', title), value); return node;
}
export function createSourceBuildWorkspaceView({ root, api, getState, operation,
  refreshWorkspace, openLog, switchView, chooseArchive, message, error }) {
  let workspaceId = null, epoch = 0, pending = false, reading = false, readAgain = false;
  let catalog = null, review = null, selectedReviewId = null, builds = [], savedSelection = '';
  let sourceSignature = '', listSignature = '', reviewSignature = '', lastRead = 0, nodes = null;
  const key = () => 'starforge-source-builds-' + workspaceId;
  const snapshot = () => ({ repository: nodes.repository.value.trim(), ref: nodes.ref.value.trim() || 'HEAD',
    offline: nodes.offline.checked, python: nodes.python.value.trim() || 'python3',
    selection: nodes.product.value || savedSelection, selectedReviewId });
  const operationFor = id => getState()?.operations.find(item => item.id === id);
  function persist() {
    if (!nodes || !workspaceId) return;
    try { localStorage.setItem(key(), JSON.stringify(snapshot())); } catch {}
  }
  function availability() {
    if (!nodes) return;
    nodes.fields.disabled = pending;
    nodes.product.disabled = pending || !catalog;
    nodes.reviewButton.disabled = pending || !catalog || !nodes.product.value;
    for (const button of root.querySelectorAll('button[data-action]'))
      button.disabled = pending || button.dataset.unavailable === 'true';
    root.setAttribute('aria-busy', String(pending || reading));
  }
  async function perform(action) {
    ensure();
    if (pending) return;
    const ticket = epoch, alive = () => epoch === ticket && workspaceId === getState()?.workspaceId;
    pending = true; message(''); availability();
    try { await action(alive); }
    catch (value) { if (alive()) error(value); }
    finally {
      if (alive()) { pending = false; renderReview(); renderBuilds(true); availability(); }
    }
  }
  function button(label, action, unavailable = false) {
    const node = make('button', label); node.type = 'button'; node.dataset.action = 'true';
    node.dataset.unavailable = String(unavailable); node.disabled = unavailable || pending;
    node.addEventListener('click', () => perform(action)); return node;
  }
  function reset() {
    epoch++; workspaceId = null; pending = false; reading = false; readAgain = false;
    catalog = null; review = null; selectedReviewId = null; builds = []; savedSelection = '';
    sourceSignature = ''; listSignature = ''; reviewSignature = ''; lastRead = 0; nodes = null; root.replaceChildren();
  }
  function ensure() {
    const id = getState()?.workspaceId;
    if (!id) throw new Error('Open the runtime workspace before choosing source.');
    if (workspaceId === id) return;
    reset(); workspaceId = id;
    root.innerHTML = '<div class="section-title"><div><p class="eyebrow">PRODUCT SOURCE</p><h2>Build a product from source</h2></div></div>' +
      '<p class="muted">Choose a committed product from a Git repository on this machine. Review its contents, build its package, then select adapters for installation.</p>' +
      '<div class="panel"><h3>1. Choose committed source</h3><form data-source-form><fieldset data-source-fields>' +
      '<label>Existing Git repository<input data-repository required placeholder="/srv/starforge/source" autocomplete="off" spellcheck="false"></label>' +
      '<div class="columns"><label>Branch, tag or commit<input data-ref value="HEAD" required autocomplete="off" spellcheck="false"></label>' +
      '<label>Python interpreter<input data-python value="python3" autocomplete="off" spellcheck="false"></label></div>' +
      '<label class="check"><input data-offline type="checkbox" checked>Use local Git objects only</label>' +
      '<p class="note">Clear this option to let the existing Git reader retrieve missing objects from this repository’s configured remote.</p>' +
      '<button type="submit">Load committed products</button>' +
      '<p data-commit class="note"></p><label>Product<select data-product disabled><option value="">Load products from the chosen commit</option></select></label>' +
      '<p data-product-description class="note"></p><button data-review type="button" disabled>Review product</button>' +
      '</fieldset></form></div><section data-review-panel class="panel" hidden></section>' +
      '<div class="section-title"><div><p class="eyebrow">SAVED BUILDS</p><h2>Continue or install a product</h2></div><span data-build-count class="count">0</span></div>' +
      '<p class="muted">Builds keep their source commit, package and original operation when this browser closes. Adapter installation continues in Source &amp; profile.</p>' +
      '<div data-build-list></div>';
    const find = name => root.querySelector('[data-' + name + ']');
    nodes = { fields: find('source-fields'), form: find('source-form'), repository: find('repository'),
      ref: find('ref'), python: find('python'), offline: find('offline'), commit: find('commit'),
      product: find('product'), description: find('product-description'), reviewButton: find('review'),
      reviewPanel: find('review-panel'), buildList: find('build-list'), count: find('build-count') };
    let saved; try { saved = JSON.parse(localStorage.getItem(key()) ?? 'null'); } catch {}
    if (saved && typeof saved === 'object') {
      for (const name of ['repository', 'ref', 'python']) if (typeof saved[name] === 'string') nodes[name].value = saved[name];
      if (typeof saved.offline === 'boolean') nodes.offline.checked = saved.offline;
      if (typeof saved.selection === 'string') savedSelection = saved.selection;
      if (/^[a-f0-9]{24}$/.test(saved.selectedReviewId ?? '')) selectedReviewId = saved.selectedReviewId;
    }
    const invalidate = source => {
      review = null; selectedReviewId = null;
      if (source) {
        catalog = null; nodes.commit.textContent = ''; nodes.description.textContent = '';
        nodes.product.replaceChildren(new Option('Load products from the chosen commit', ''));
      }
      renderReview(); availability(); persist();
    };
    for (const field of [nodes.repository, nodes.ref]) field.addEventListener('input', () => invalidate(true));
    nodes.offline.addEventListener('change', () => invalidate(true));
    nodes.python.addEventListener('input', () => invalidate(false));
    nodes.product.addEventListener('change', () => {
      savedSelection = nodes.product.value;
      nodes.description.textContent = catalog?.products.find(item => item.id === savedSelection)?.description ?? '';
      invalidate(false);
    });
    nodes.form.addEventListener('submit', event => {
      event.preventDefault();
      perform(async alive => {
        const input = snapshot();
        const value = await api('/api/source-builds/catalog', { repository: input.repository, ref: input.ref, offline: input.offline });
        if (!alive()) return;
        catalog = value; review = null; selectedReviewId = null;
        nodes.commit.textContent = 'Resolved commit: ' + value.sourceCommit;
        nodes.product.replaceChildren(new Option('Choose a product', ''), ...value.products.map(item => {
          const option = new Option(item.title + (item.available ? '' : ' — unavailable'), item.id ?? '');
          option.disabled = !item.available; return option;
        }));
        if (value.products.some(item => item.available && item.id === savedSelection)) nodes.product.value = savedSelection;
        nodes.description.textContent = value.products.find(item => item.id === nodes.product.value)?.description ?? '';
        const unavailable = value.products.filter(item => !item.available);
        if (unavailable.length) message(unavailable.map(item => item.title + ': ' + item.error.message).join('\n'));
        persist();
      });
    });
    nodes.reviewButton.addEventListener('click', () => perform(async alive => {
      if (!catalog || !nodes.product.value) throw new Error('Choose a committed product first.');
      const value = await api('/api/source-builds/review', { repository: catalog.repository,
        ref: catalog.sourceCommit, selection: nodes.product.value, offline: catalog.offline,
        python: nodes.python.value.trim() || 'python3' });
      if (!alive()) return;
      review = value; selectedReviewId = value.reviewId; savedSelection = value.selection; persist();
      lastRead = 0; await refresh({ force: true });
    }));
    renderBuilds(true); availability();
  }
  async function loadReview(id, alive) {
    const value = await api(query('/api/source-builds/review', { reviewId: id }));
    if (!alive()) return;
    review = value; selectedReviewId = value.reviewId; persist(); renderReview();
  }
  async function continueBuild(build, alive) {
    await api('/api/source-builds/recover', { operationId: build.requestId });
    if (!alive()) return;
    await refreshWorkspace();
    if (!alive()) return;
    lastRead = 0; await refresh({ force: true });
    if (alive()) message('The original product build is continuing. Its operation and output directory are unchanged.');
  }
  async function download(build, alive) {
    const value = await api('/api/source-builds/download', { reviewId: build.reviewId });
    if (!alive()) return;
    const link = make('a'); link.href = value.url; link.download = value.file;
    root.append(link); link.click(); link.remove();
    message('Package download started: ' + value.file + ' · SHA-256 ' + value.sha256);
  }
  function buildActions(build, original) {
    const actions = make('div', undefined, 'actions');
    if (original?.displayPhase === 'INITIALIZING')
      actions.append(button('Continue saving build', async alive => {
        if (!alive()) return;
        await operation({ requestId: build.requestId, operation: 'source-build',
          reviewId: build.reviewId, selectionSha256: build.selectionSha256 });
        if (alive()) { lastRead = 0; await refresh({ force: true }); }
      }));
    if (original) {
      if (['FAILED', 'QUEUED'].includes(original.phase) || original.displayPhase === 'INTERRUPTED')
        actions.append(button('Continue original build', alive => continueBuild(build, alive), original.workerActive));
      actions.append(button('Open worker log', async alive => { if (alive()) await openLog({ operationId: build.requestId }); }));
    }
    if (build.archive) actions.append(button('Download package', alive => download(build, alive)));
    if (build.archiveId) actions.append(button('Choose adapters and install', async alive => {
      if (alive()) await chooseArchive(build.archiveId);
    }));
    return actions;
  }
  function renderReview() {
    if (!nodes) return;
    const panel = nodes.reviewPanel;
    panel.hidden = !review;
    if (!review) { panel.replaceChildren(); reviewSignature = ''; return; }
    const value = review, original = operationFor(value.requestId), retained = builds.find(item => item.reviewId === value.reviewId);
    const signature = JSON.stringify([value.reviewId, original?.displayPhase, original?.sourceBuildStage,
      original?.error, retained?.archiveId, retained?.archive?.sha256]);
    if (reviewSignature === signature) { availability(); return; }
    reviewSignature = signature;
    const expanded = new Set([...panel.querySelectorAll('details')].filter(node => node.open).map(node => node.querySelector('summary').textContent));
    const title = make('div', undefined, 'section-title');
    title.append(make('h3', '2. Review ' + value.title), make('span', original?.displayPhase ?? 'REVIEWED', 'status'));
    panel.replaceChildren(title, make('p', value.description, 'muted'));
    panel.append(facts([['Package', value.packageName], ['Version', value.packageVersion],
      ['Source commit', value.sourceCommit], ['Repository', value.repository],
      ['Applications', value.applications.join(', ') || 'None'], ['Optional adapters', value.features.join(', ') || 'None']]));
    const actions = make('div', undefined, 'actions');
    if (!original) actions.append(button('Build reviewed product', async alive => {
      if (!alive() || review?.selectionSha256 !== value.selectionSha256) return;
      await operation({ requestId: value.requestId, operation: 'source-build',
        reviewId: value.reviewId, selectionSha256: value.selectionSha256 });
      if (alive()) { lastRead = 0; await refresh({ force: true }); }
    }));
    if (retained) actions.append(...buildActions(retained, original).children);
    panel.append(actions);
    panel.append(detail('Commands and package launchers', table(['Command', 'Original source'], [
      ...Object.entries(value.commands), ...Object.entries(value.product.bin).map(([name, path]) => [name + ' (launcher)', path]),
    ])));
    panel.append(detail('Exports and components', table(['Export or component', 'Original source'], [
      ...Object.entries(value.exports), ...value.components.map(path => ['Component', path]),
    ])));
    panel.append(detail('Committed inputs', table(['Source', 'Git blob', 'Bytes', 'SHA-256'],
      [...value.distributionInputs, ...value.supportingInputs].map(item => [item.path, item.gitBlob, item.bytes, item.sha256]))));
    panel.append(detail('Complete saved review', make('pre', JSON.stringify(value, null, 2))));
    for (const node of panel.querySelectorAll('details')) node.open = expanded.has(node.querySelector('summary').textContent);
    availability();
  }
  function renderBuilds(force = false) {
    if (!nodes) return;
    const signature = JSON.stringify([builds, getState()?.operations.filter(item => item.sourceBuildId), selectedReviewId, pending]);
    if (!force && listSignature === signature) return;
    listSignature = signature; nodes.count.textContent = String(builds.length);
    nodes.buildList.replaceChildren();
    if (!builds.length) { nodes.buildList.append(make('p', 'Review a product to create its saved build.', 'empty')); return; }
    for (const build of builds) {
      const original = operationFor(build.requestId), card = make('article', undefined, 'operation');
      card.dataset.reviewId = build.reviewId;
      const title = make('div', undefined, 'section-title');
      title.append(make('h3', build.title), make('span', original?.displayPhase ?? build.phase, 'status'));
      card.append(title, facts([['Package', build.packageVersion], ['Source commit', build.sourceCommit],
        ['Build output', build.output], ['Stage', original?.sourceBuildStage ?? build.stage ?? 'Awaiting build']]));
      const failure = original?.error ?? build.error;
      if (failure) card.append(make('p', failure.code + ': ' + failure.message));
      if (build.archive) card.append(make('p', build.archive.file + ' · ' + build.archive.bytes + ' bytes · SHA-256 ' + build.archive.sha256, 'note'));
      const actions = buildActions(build, original);
      actions.prepend(button(selectedReviewId === build.reviewId ? 'Reopen saved review' : 'Open product', async alive => {
        await loadReview(build.reviewId, alive);
        if (alive()) nodes.reviewPanel.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }));
      card.append(actions); nodes.buildList.append(card);
    }
    availability();
  }
  async function refresh({ force = false } = {}) {
    ensure();
    if (reading) { readAgain ||= force; return; }
    const signature = JSON.stringify(getState()?.operations.filter(item => item.sourceBuildId));
    if (!force && signature === sourceSignature && Date.now() - lastRead < 10000) {
      renderReview(); renderBuilds(); return;
    }
    const ticket = epoch, selectedAtStart = selectedReviewId;
    const alive = () => epoch === ticket && workspaceId === getState()?.workspaceId;
    reading = true; availability();
    try {
      const value = await api('/api/source-builds/state');
      if (!alive()) return;
      builds = value.builds; sourceSignature = signature; lastRead = Date.now();
      if (selectedAtStart && selectedReviewId === selectedAtStart && !review) {
        const value = await api(query('/api/source-builds/review', { reviewId: selectedAtStart }));
        if (!alive()) return;
        if (selectedReviewId === selectedAtStart && !review) review = value;
      }
      renderReview(); renderBuilds();
    } finally {
      if (alive()) {
        reading = false; availability();
        if (readAgain) { readAgain = false; await refresh({ force: true }); }
      }
    }
  }
  async function choose(id) {
    ensure();
    if (pending) return;
    await perform(async alive => {
      await loadReview(id, alive);
      if (!alive()) return;
      switchView('source-builds'); await refresh({ force: true });
    });
  }
  return { refresh, reset, choose };
}
