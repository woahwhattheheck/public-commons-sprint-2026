// MIT. Managed release controls in the original runtime operator workspace.
const $ = id => document.getElementById(id);
const node = (tag, text, className) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value; };
const query = (path, values) => path + '?' + new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined && value !== null));
function facts(element, values) {
  element.replaceChildren(...values.map(([key, value]) => { const row = node('div'); row.append(node('dt', key), node('dd', value ?? '—')); return row; }));
}
function choices(element, values, empty, preferred = element.value) {
  const signature = JSON.stringify(values);
  if (signature !== element.dataset.choices) {
    element.replaceChildren(new Option(empty, ''), ...values.map(value => new Option(value.label, value.id)));
    element.dataset.choices = signature;
  }
  element.value = values.some(value => value.id === preferred) ? preferred : '';
}
function detail(label, value) {
  const item = node('details'); item.append(node('summary', label), node('pre', JSON.stringify(value, null, 2))); return item;
}
export function createManagedWorkspaceView({ api, getState, operation, refreshWorkspace, openLog, switchView, message, error }) {
  let current = null, homeId = null, workspaceId = null, review = null, config = null, loading = false, generation = 0, reviewRequest = null;
  const container = $('managed-workspace');
  container.innerHTML = '<div class="section-title"><div><p class="eyebrow">ORIGINAL SF46 INSTALLATION</p><h2>Managed releases</h2></div><span id="managed-phase" class="status">EMPTY</span></div>' +
    '<p class="muted">Adopt a READY runtime into its managed home, select the release for new launches, and keep configuration and merchant state in their original directories.</p>' +
    '<label>Managed home<select id="managed-home"><option value="">Open a managed home</option></select></label>' +
    '<details id="managed-open-details"><summary>Open or register a managed home</summary><form id="managed-open-form"><label>Original home or new directory<input id="managed-directory" required autocomplete="off" placeholder="/srv/starforge/merchant-home"></label><label>Display name<input id="managed-label" maxlength="120" placeholder="Merchant operations"></label><button type="submit">Open managed home</button></form></details>' +
    '<div id="managed-body" hidden><dl id="managed-facts" class="paths"></dl>' +
    '<div class="panel"><h3>Adopt a ready runtime</h3><label>Original READY runtime<select id="managed-runtime"></select></label><button id="managed-review" type="button">Review runtime and home</button><label>Retained source and home review<select id="managed-review-select"></select></label><div id="managed-adoption-review" class="result" hidden></div><button id="managed-adopt" type="button" disabled>Adopt reviewed runtime</button></div>' +
    '<div class="panel"><h3>Installed releases</h3><div id="managed-releases"></div><label>Release for inspection and native commands<select id="managed-release"></select></label><div class="actions"><button id="managed-activate" type="button">Activate selected release</button><button id="managed-rollback" type="button">Roll back to previous release</button></div><p class="note">Activation selects code for new launches. Existing native processes retain their original release and are controlled in the operation history.</p></div>' +
    '<div class="columns"><div class="panel"><h3>Inspect source and runtime</h3><label class="check"><input id="managed-load" type="checkbox">Import selected dependencies</label><button id="managed-inspect" type="button">Inspect selected release</button></div>' +
    '<div class="panel"><h3>Original dependency doctor</h3><label class="check"><input id="managed-native" type="checkbox">Require native payment runtime</label><label>Required optional features (one per line)<textarea id="managed-features" rows="2" spellcheck="false" placeholder="postgres"></textarea></label><button id="managed-doctor" type="button">Run original doctor</button></div></div>' +
    '<div class="panel"><h3>Managed configuration</h3><p class="note">Open a retained file or a new filename inside the existing config directory. Saves compare the current digest and keep the exact UTF-8 contents. JSON files are parsed before saving.</p><div class="actions"><button id="managed-config-list" type="button">Refresh configuration files</button></div><label>Existing file<select id="managed-config-files"></select></label><form id="managed-config-open-form"><label>Relative filename<input id="managed-config-path" required autocomplete="off" placeholder="merchant/merchant.json"></label><button type="submit">Open configuration file</button></form><form id="managed-config-save-form" hidden><p id="managed-config-identity" class="note"></p><label>File contents<textarea id="managed-config-content" rows="12" spellcheck="false"></textarea></label><button type="submit">Save reviewed configuration</button></form>' +
    '<details><summary>Create an original merchant workspace</summary><p class="note">This launches the selected release’s original Starforge initializer inside the managed config directory.</p><form id="managed-init-form"><label>New workspace name<input id="managed-init-name" required pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,79}" maxlength="80" placeholder="merchant-01"></label><label>Original template<select id="managed-init-template"><option value="dataset">Dataset</option><option value="application">Application</option><option value="upstream">Upstream</option></select></label><button type="submit">Run original initializer</button></form></details></div>' +
    '<div class="panel"><h3>Run an original command</h3><label>Command in the selected release<select id="managed-command-select"></select></label><p id="managed-command-description" class="note"></p><form id="managed-run-form"><label>Exact argument array (JSON)<textarea id="managed-args" rows="4" spellcheck="false">["--help"]</textarea></label><p class="note">Each array item is one unchanged argument. Commands run in this managed home, using the selected release’s original launcher. Use absolute configuration paths for a host.</p><button type="submit">Run original command</button></form></div>' +
    '<div class="panel"><h3>Latest managed operation</h3><div id="managed-observation"></div></div><div class="panel"><h3>Retained processes and recovery</h3><div id="managed-jobs"></div></div></div>';
  const selected = () => current?.selected;
  const prefKey = () => 'starforge-managed-' + workspaceId;
  const draftKey = () => 'starforge-managed-config-' + workspaceId + '-' + homeId;
  function savePrefs() {
    if (workspaceId) try { localStorage.setItem(prefKey(), JSON.stringify({ homeId, releaseId: $('managed-release').value, reviewId: review?.id ?? null })); } catch {}
  }
  function saveDraft() {
    if (config) try { sessionStorage.setItem(draftKey(), JSON.stringify({ ...config, draftContent: $('managed-config-content').value })); } catch {}
  }
  async function choose(id) {
    generation++; homeId = id || null; review = null; config = null; current = null;
    $('managed-adoption-review').hidden = true; $('managed-config-save-form').hidden = true;
    savePrefs(); switchView('managed'); await refresh();
  }
  const release = () => selected()?.releases.find(value => value.id === $('managed-release').value) ?? null;
  function inputFor(action) {
    const home = selected();
    if (!home) throw new Error('Open a managed home first.');
    return { operation: action, homeId: home.id };
  }
  function releaseInput(action) {
    const chosen = release();
    if (!chosen) throw new Error('Choose an installed release first.');
    return { ...inputFor(action), releaseId: chosen.id };
  }
  async function submit(value) {
    const result = await operation(value);
    review = null; $('managed-adoption-review').hidden = true; $('managed-adopt').disabled = true;
    await refresh(); return result;
  }
  function on(id, event, handler) {
    $(id).addEventListener(event, async value => {
      if (event === 'submit') value.preventDefault();
      try { message(''); await handler(value); } catch (value) { error(value); }
    });
  }
  function commandDetails() {
    const selectedCommand = release()?.commands[$('managed-command-select').value];
    $('managed-command-description').textContent = selectedCommand?.summary ?? 'Choose an original command from this release.';
    if (selectedCommand) $('managed-command-description').textContent += ' · ' + selectedCommand.path;
  }
  function renderCommands() {
    const commands = release()?.commands ?? {};
    choices($('managed-command-select'), Object.entries(commands).map(([id, command]) => ({ id, label: id + ' — ' + command.summary })), 'Choose an original command');
    if (!$('managed-command-select').value && commands.starforge) $('managed-command-select').value = 'starforge';
    commandDetails();
  }
  function renderJobs() {
    const jobs = (getState()?.operations ?? []).filter(item => item.homeId === homeId);
    const signature = JSON.stringify(jobs), element = $('managed-jobs');
    if (element.dataset.signature === signature) return;
    element.dataset.signature = signature; element.replaceChildren();
    if (!jobs.length) { element.append(node('p', 'Managed operations will appear here.', 'note')); return; }
    for (const job of jobs) {
      const article = node('article', undefined, 'operation'), top = node('div', undefined, 'section-title');
      article.dataset.operationId = job.id;
      top.append(node('h3', job.operation.replace('managed-', '')), node('span', job.displayPhase, 'status'));
      article.append(top, node('p', job.id + ' · ' + job.createdAt, 'note'));
      if (job.commandProcess) article.append(node('p', 'Original process ' + job.commandProcess.pid +
        (job.commandActive ? ' · running' : ' · ended') + ' · ' + job.commandProcess.cwd, 'note'));
      if (job.error) article.append(node('p', job.error.code + ': ' + job.error.message));
      const actions = node('div', undefined, 'actions');
      const log = node('button', 'Open retained output'); log.type = 'button';
      log.addEventListener('click', () => openLog({ operationId: job.id }).catch(error)); actions.append(log);
      if (job.operation === 'managed-run' && job.phase === 'RUNNING') {
        const stop = node('button', 'Stop original command'); stop.type = 'button';
        stop.addEventListener('click', () => api('/api/managed/stop', { operationId: job.id })
          .then(() => refreshWorkspace()).catch(error)); actions.append(stop);
      }
      if (job.displayPhase === 'INTERRUPTED' || job.phase === 'QUEUED' || job.phase === 'FAILED') {
        const recover = node('button', job.operation === 'managed-run' && job.commandProcess ? 'Reopen recorded command' : 'Recover retained operation');
        recover.type = 'button'; recover.addEventListener('click', () => api('/api/managed/recover', { operationId: job.id })
          .then(() => refreshWorkspace()).catch(error)); actions.append(recover);
      }
      article.append(actions);
      if (job.result) article.append(detail('Original result', job.result));
      element.append(article);
    }
  }
  function render() {
    const home = selected(), open = Boolean(home);
    choices($('managed-home'), current.homes.map(value => ({ id: value.id, label: value.label + ' · ' + value.phase })), 'Open a managed home', homeId);
    $('managed-body').hidden = !open; $('managed-open-details').open = !current.homes.length;
    $('managed-phase').textContent = home?.phase ?? 'EMPTY';
    if (!home) return;
    if (home.error) { error(home.error); return; }
    const active = home.selected, runtime = active?.runtime;
    facts($('managed-facts'), [['Managed home', home.directory], ['Active release', home.active?.releaseId],
      ['Previous release', home.active?.previousReleaseId], ['Source commit', active?.sourceCommit],
      ['Source manifest SHA-256', runtime?.sourceManifestSha256 ?? active?.origin?.manifestSha256],
      ['Runtime directory', runtime?.directory], ['Profile identity', runtime?.profileId],
      ['Dependency lock SHA-256', runtime?.lockSha256], ['Configuration', home.configDirectory], ['Merchant state', home.stateDirectory]]);
    const runtimeItems = (getState()?.runtimes ?? []).filter(value => value.phase === 'READY');
    choices($('managed-runtime'), runtimeItems.map(value => ({ id: value.id, label: value.label + ' · ' + value.packageVersion })), 'Choose a READY runtime');
    if (!$('managed-runtime').value && runtimeItems.length) $('managed-runtime').value = getState()?.selected?.phase === 'READY' ? getState().selected.id : runtimeItems[0].id;
    const releases = $('managed-releases'), signature = JSON.stringify(home.releases);
    if (releases.dataset.signature !== signature) {
      releases.dataset.signature = signature; releases.replaceChildren();
      for (const value of home.releases) {
        const item = node('div', undefined, 'operation');
        item.append(node('strong', value.active ? 'Active · ' + value.id : 'Staged · ' + value.id),
          node('p', 'Source ' + value.sourceCommit + (value.runtime ? ' · runtime ' + value.runtime.directory : ' · source release'), 'note'));
        item.append(detail('Release, source and runtime identity', value)); releases.append(item);
      }
      if (!home.releases.length) releases.append(node('p', 'The first original adoption will initialize this managed home.', 'note'));
    }
    let saved;
    try { saved = JSON.parse(localStorage.getItem(prefKey()) ?? 'null'); } catch {}
    const preferred = $('managed-release').value || (saved?.homeId === home.id ? saved.releaseId : null) || home.active?.releaseId;
    choices($('managed-release'), home.releases.map(value => ({ id: value.id, label: (value.active ? 'Active · ' : '') + value.id })), 'Choose a release', preferred);
    renderCommands();
    const available = Boolean(release());
    for (const id of ['managed-activate', 'managed-inspect', 'managed-doctor']) $(id).disabled = !available;
    $('managed-rollback').disabled = !home.active?.previousReleaseId;
    $('managed-review').disabled = !$('managed-runtime').value || reviewRequest?.generation === generation;
    if (review && review.homeRevision !== home.revision) { review = null; $('managed-adoption-review').hidden = true; }
    const retainedReviews = current.reviews ?? [];
    if (!review && saved?.homeId === home.id && saved.reviewId)
      review = retainedReviews.find(value => value.id === saved.reviewId && value.current) ?? null;
    choices($('managed-review-select'), retainedReviews.map(value => ({ id: value.id,
      label: (value.current ? 'Current home · ' : 'Earlier home · ') + value.runtimeDirectory + ' · ' + value.reviewedAt })),
    'Open a retained review', review?.id ?? '');
    if (review) showReview(review);
    $('managed-adopt').disabled = !review || review.homeRevision !== home.revision;
    const observation = $('managed-observation'), observed = JSON.stringify(current.observation);
    if (observation.dataset.signature !== observed) {
      observation.dataset.signature = observed; observation.replaceChildren();
      if (current.observation) {
        observation.append(node('p', current.observation.operation + ' · ' + current.observation.observedAt, 'note'),
          detail('Original operation result', current.observation.result));
      } else observation.append(node('p', 'Inspect, adopt or run an original command to retain its result.', 'note'));
    }
    if (!config) try {
      const draft = JSON.parse(sessionStorage.getItem(draftKey()) ?? 'null');
      if (draft?.homeId === home.id && typeof draft.draftContent === 'string') {
        config = draft; $('managed-config-path').value = draft.path; $('managed-config-content').value = draft.draftContent;
        $('managed-config-identity').textContent = draft.path + ' · reviewed SHA-256 ' + (draft.sha256 ?? 'new file') + ' · retained draft';
        $('managed-config-save-form').hidden = false;
      }
    } catch {}
    renderJobs(); savePrefs();
  }
  async function refresh() {
    if (loading || !getState()) return;
    if (workspaceId !== getState().workspaceId) {
      generation++; workspaceId = getState().workspaceId; homeId = null; config = null; review = null; current = null;
      try { homeId = JSON.parse(localStorage.getItem(prefKey()) ?? 'null')?.homeId ?? null; } catch {}
    }
    const requestedGeneration = generation, requestedWorkspace = workspaceId;
    loading = true;
    try {
      const result = await api(query('/api/managed/state', { homeId }));
      if (generation !== requestedGeneration || getState()?.workspaceId !== requestedWorkspace) return;
      current = result; homeId = result.selected?.id ?? null; render();
    } finally { loading = false; }
  }
  on('managed-open-form', 'submit', async () => {
    const result = await api('/api/managed/open', { directory: $('managed-directory').value.trim(),
      ...($('managed-label').value.trim() ? { label: $('managed-label').value.trim() } : {}) });
    await choose(result.homeId); $('managed-open-details').open = false; message('Managed home opened with its original installation and release records.');
  });
  on('managed-home', 'change', () => choose($('managed-home').value));
  on('managed-runtime', 'change', () => { review = null; $('managed-review-select').value = ''; $('managed-adoption-review').hidden = true; $('managed-adopt').disabled = true; savePrefs(); });
  function showReview(value) {
    const result = $('managed-adoption-review'), signature = JSON.stringify([value.id, value.homeRevision === selected()?.revision]);
    if (result.dataset.signature !== signature) {
      result.dataset.signature = signature; result.replaceChildren();
      result.append(node('h3', value.behavior === 'FIRST_ACTIVE' ? 'First release will become active' : 'Runtime will be staged as a new release'));
      const identity = node('dl', undefined, 'paths');
      facts(identity, [['Home', value.homeDirectory], ['Runtime', value.runtimeDirectory], ['Source commit', value.runtime.sourceCommit],
        ['Source manifest SHA-256', value.runtime.sourceManifestSha256], ['Profile', value.runtime.profileId],
        ['Lock SHA-256', value.runtime.lockSha256], ['Selected dependencies', value.summary.dependencyCount],
        ['Original review', value.reviewedAt]]);
      result.append(identity, detail('Exact original runtime review', value));
      if (value.homeRevision !== selected()?.revision)
        result.append(node('p', 'This review records an earlier home selection. Review the runtime against the current home before adoption.', 'note'));
    }
    result.hidden = false;
    $('managed-adopt').disabled = value.homeRevision !== selected()?.revision;
    $('managed-adopt').textContent = value.behavior === 'FIRST_ACTIVE' ? 'Adopt first active release' : 'Stage reviewed runtime';
  }
  on('managed-review-select', 'change', () => {
    review = (current?.reviews ?? []).find(value => value.id === $('managed-review-select').value) ?? null;
    if (review) { $('managed-runtime').value = review.runtimeId; showReview(review); }
    else { $('managed-adoption-review').hidden = true; $('managed-adopt').disabled = true; }
    savePrefs();
  });
  on('managed-review', 'click', async () => {
    const requestedGeneration = generation, requestedHome = homeId, runtimeId = $('managed-runtime').value;
    if (reviewRequest?.generation === generation) return;
    const request = { generation: requestedGeneration }; reviewRequest = request;
    $('managed-review').disabled = true;
    try {
      const value = await api('/api/managed/review', { homeId: requestedHome, runtimeId });
      if (generation !== requestedGeneration || homeId !== requestedHome || $('managed-runtime').value !== runtimeId) return;
      review = value; showReview(review); savePrefs(); await refresh();
    } finally {
      if (reviewRequest === request) reviewRequest = null;
      if (generation === requestedGeneration) $('managed-review').disabled = !$('managed-runtime').value;
    }
  });
  on('managed-adopt', 'click', () => { if (!review) throw new Error('Review the ready runtime first.'); return submit({ ...inputFor('managed-adopt'), reviewId: review.id }); });
  on('managed-release', 'change', () => { renderCommands(); savePrefs(); });
  on('managed-activate', 'click', () => submit({ ...releaseInput('managed-activate'), expectedRevision: selected().revision }));
  on('managed-rollback', 'click', () => submit({ ...inputFor('managed-rollback'), expectedRevision: selected().revision }));
  on('managed-inspect', 'click', () => submit({ ...releaseInput('managed-inspect'), load: $('managed-load').checked }));
  on('managed-doctor', 'click', () => submit({ ...releaseInput('managed-doctor'), requireNative: $('managed-native').checked,
    requiredFeatures: $('managed-features').value.split(/\s+/).filter(Boolean) }));
  on('managed-config-list', 'click', async () => {
    const result = await api(query('/api/managed/config', { homeId }));
    choices($('managed-config-files'), result.files.map(value => ({ id: value.path, label: value.path + ' · ' + value.bytes + ' B' + (value.editable ? '' : ' · native editor') })), 'Choose a retained file');
    message(result.files.length + ' retained configuration files in ' + result.directory + '.');
  });
  on('managed-config-files', 'change', () => { if ($('managed-config-files').value) $('managed-config-path').value = $('managed-config-files').value; });
  on('managed-config-open-form', 'submit', async () => {
    config = await api(query('/api/managed/config', { homeId, path: $('managed-config-path').value.trim() }));
    $('managed-config-content').value = config.content;
    $('managed-config-identity').textContent = config.path + ' · reviewed SHA-256 ' + (config.sha256 ?? 'new file');
    $('managed-config-save-form').hidden = false; saveDraft();
  });
  on('managed-config-content', 'input', saveDraft);
  on('managed-config-save-form', 'submit', async () => {
    if (!config || config.homeId !== homeId) throw new Error('Open the configuration file first.');
    await submit({ ...inputFor('managed-config-save'), path: config.path, expectedSha256: config.sha256, content: $('managed-config-content').value });
    sessionStorage.removeItem(draftKey()); config = null; $('managed-config-save-form').hidden = true;
  });
  on('managed-init-form', 'submit', () => {
    const chosen = release();
    if (!chosen?.commands.starforge) throw new Error('Choose a maintained release with its original Starforge command.');
    const name = $('managed-init-name').value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(name)) throw new Error('Use a new workspace name with letters, digits, dots, underscores or dashes.');
    return submit({ ...releaseInput('managed-run'), command: 'starforge', expectedRevision: selected().revision,
      args: ['init', '--dir', selected().configDirectory + '/' + name, '--template', $('managed-init-template').value] });
  });
  on('managed-command-select', 'change', commandDetails);
  on('managed-run-form', 'submit', () => {
    let args; try { args = JSON.parse($('managed-args').value); } catch { throw new Error('Arguments must be a JSON array of strings.'); }
    return submit({ ...releaseInput('managed-run'), command: $('managed-command-select').value, args, expectedRevision: selected().revision });
  });
  return { refresh, choose, reset() { generation++; current = null; workspaceId = null; homeId = null; review = null; config = null; } };
}
