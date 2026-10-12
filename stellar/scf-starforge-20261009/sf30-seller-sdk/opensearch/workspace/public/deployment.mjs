// MIT. Deployment controls in the original OpenSearch workspace.
export function createDeploymentController({ host, api, perform, recover, notice, view, element, attempt }) {
  let snapshot = null, clients = [], nextAfter = null, timer = null;
  const $ = id => document.getElementById(id);
  const nav = element('button', 'Deployment', { 'data-view': 'deployment', type: 'button' });
  document.querySelector('nav[aria-label="Workspace views"]').append(nav);
  const section = element('section', undefined, { id: 'view-deployment', hidden: '' });
  section.innerHTML = [
    '<div class="section-heading"><div><h2>Merchant deployment</h2><p class="muted">Run a saved merchant, compare an upgrade and return to a previous release.</p></div><button id="deployment-refresh" type="button">Refresh deployment</button></div>',
    '<p id="deployment-status" class="summary">Stage a prepared merchant to begin.</p>',
    '<div class="actions"><button id="deployment-open" type="button">Open deployment controls</button><a id="deployment-console" target="_blank" rel="noreferrer" hidden>Full operations console</a><a id="deployment-seller" target="_blank" rel="noreferrer" hidden>Seller documentation</a></div>',
    '<h3>Stage a merchant package</h3><div class="two-column"><label>Saved package<select id="deployment-package"></select></label><label>New release ID<input id="deployment-id" maxlength="64" placeholder="search-v1"></label></div>',
    '<div class="two-column"><label>Release label<input id="deployment-label" maxlength="240" placeholder="Search service"></label><label>Seller port<input id="deployment-port" type="number" min="0" max="65535" value="0"><span class="help">Use 0 to choose an available port.</span></label></div>',
    '<details><summary>Payment facilitator</summary><label>Facilitator URL<input id="deployment-facilitator" type="url" placeholder="https://"></label><label><input id="deployment-local" type="checkbox"> This is an explicitly configured local facilitator.</label><p class="help">The default service advertises its payment terms. Add the existing facilitator to accept paid requests.</p></details>',
    '<div class="actions"><button id="deployment-stage" type="button" class="primary">Stage saved package</button></div>',
    '<h3>Compare and select</h3><label>Retained release<select id="deployment-release"></select></label><label>Change reason<input id="deployment-reason" maxlength="240" placeholder="Promote reviewed search query"></label>',
    '<div class="actions"><button id="deployment-compare" type="button">Compare with selected</button><button id="deployment-activate" type="button">Select release</button><button id="deployment-rollback" type="button">Select previous release</button><a id="deployment-handover" hidden>Deployment handover</a></div>',
    '<div id="deployment-comparison" hidden><p id="deployment-comparison-summary"></p><details open><summary>Release differences</summary><pre id="deployment-comparison-json"></pre></details></div>',
    '<h3>Run the selected release</h3><div class="actions"><button id="deployment-run" type="button">Start selected</button><button id="deployment-restart" type="button">Restart selected</button><button id="deployment-stop" type="button">Drain and stop</button></div>',
    '<p class="help">Selecting an upgrade keeps the current seller serving. Restart drains that instance before launching the selected release.</p>',
    '<h3>Customer handover</h3><p class="help">Generate the customer client from the running seller. Keep its complete archive and deployment handover together.</p>',
    '<div class="two-column"><label>Customer export ID<input id="deployment-client-id" maxlength="64" placeholder="search-client-v1"></label><div class="actions"><button id="deployment-client-generate" type="button">Generate customer client</button><button id="deployment-clients-refresh" type="button">Refresh customer files</button></div></div>',
    '<div id="deployment-clients"></div><button id="deployment-clients-more" type="button" hidden>More customer exports</button>',
    '<details><summary>Saved deployment details</summary><pre id="deployment-json"></pre></details>',
  ].join('');
  document.querySelector('main').append(section);
  const encode = encodeURIComponent;
  function options(select, values, label) {
    const chosen = select.value;
    select.replaceChildren(...values.map(value => element('option', label(value), { value: value.id })));
    if (values.some(value => value.id === chosen)) select.value = chosen;
  }
  function sync() {
    options($('deployment-package'), host.data?.packages ?? [], value => value.title + ' · revision ' + value.draftRevision);
    buttons();
  }
  function buttons() {
    const pending = host.busy || Boolean(host.pending) || snapshot?.deployment.busy || snapshot?.console.busy;
    for (const button of section.querySelectorAll('button')) button.disabled = Boolean(pending);
    $('deployment-refresh').disabled = false;
    if (pending) return;
    const owns = Boolean(snapshot?.console.managesRunningSeller);
    $('deployment-stage').disabled = !host.data?.packages.length;
    $('deployment-compare').disabled = !snapshot?.releases.length;
    $('deployment-activate').disabled = !snapshot?.releases.length || $('deployment-release').value === snapshot?.state.active;
    $('deployment-rollback').disabled = !snapshot?.state.previous;
    $('deployment-run').disabled = !snapshot?.state.active || owns || snapshot?.runtime.state !== 'STOPPED';
    $('deployment-restart').disabled = !owns || !snapshot?.state.active;
    $('deployment-stop').disabled = !owns;
    $('deployment-client-generate').disabled = !owns;
  }
  function render(value) {
    snapshot = value;
    $('deployment-status').textContent = [
      'Selected: ' + (value.state.active ?? 'none'), 'Previous: ' + (value.state.previous ?? 'none'),
      'Generation ' + value.state.generation, value.runtime.state.replaceAll('_', ' '),
      ...(value.runtime.message ? [value.runtime.message] : []),
    ].join(' · ');
    options($('deployment-release'), value.releases ?? [], release => release.label + ' · ' + release.id);
    const console = $('deployment-console');
    console.hidden = !value.console.operatorUrl;
    if (value.console.operatorUrl) console.href = value.console.operatorUrl;
    const seller = $('deployment-seller');
    seller.hidden = !value.console.managesRunningSeller || !value.runtime.observed?.listener;
    if (!seller.hidden) seller.href = value.runtime.observed.listener + '/_seller/docs';
    const { console: control, ...publicStatus } = value;
    $('deployment-json').textContent = JSON.stringify({ ...publicStatus, console: {
      managesRunningSeller: control.managesRunningSeller, instanceId: control.instanceId,
    } }, null, 2);
    selection(); buttons();
  }
  function selection() {
    const id = $('deployment-release').value;
    $('deployment-handover').hidden = !id;
    if (id) $('deployment-handover').href = '/api/deployment/handover?releaseId=' + encode(id);
    $('deployment-comparison').hidden = true;
    buttons();
  }
  async function refresh() { render(await api('/api/deployment/status')); }
  function scheduleRecovery() {
    clearTimeout(timer);
    if (host.pending?.kind !== 'deployment') return;
    timer = setTimeout(() => attempt(async () => {
      await recover();
      if (host.pending?.kind === 'deployment') scheduleRecovery();
    }), 1000);
  }
  async function action(name, values = {}) {
    await perform('deployment', { action: name, ...values });
    await refresh(); scheduleRecovery();
  }
  async function clientList(append = false) {
    const query = append && nextAfter ? '?after=' + encode(nextAfter) : '';
    const result = await api('/api/deployment/clients' + query);
    clients = append ? [...clients, ...result.entries] : result.entries;
    nextAfter = result.nextAfter;
    const target = $('deployment-clients'); target.replaceChildren();
    for (const client of clients) {
      const record = element('div', undefined, { class: 'record' }), detail = element('div');
      detail.append(element('strong', client.exportId), element('span',
        client.state.replaceAll('_', ' ') + ' · ' + (client.bytes ?? 0) + ' bytes' +
        (client.provenance?.releaseId ? ' · ' + client.provenance.releaseId : '')));
      record.append(detail);
      if (client.manifestFile?.sha256) {
        record.append(element('a', 'Download complete client', { href: '/api/deployment/client-download?' +
          new URLSearchParams({ exportId: client.exportId, expectedManifestSha256: client.manifestFile.sha256 }) }));
      }
      target.append(record);
    }
    if (!clients.length) target.append(element('p', 'Generated customer files will appear here.', { class: 'muted' }));
    $('deployment-clients-more').hidden = !nextAfter;
  }
  $('deployment-refresh').addEventListener('click', () => attempt(refresh));
  $('deployment-open').addEventListener('click', () => attempt(() => action('open')));
  $('deployment-stage').addEventListener('click', () => attempt(async () => {
    const runtime = { port: Number($('deployment-port').value) };
    if ($('deployment-facilitator').value.trim()) runtime.facilitator = $('deployment-facilitator').value.trim();
    if ($('deployment-local').checked) runtime.allowLocalFacilitator = true;
    await action('stage', { packageId: $('deployment-package').value, id: $('deployment-id').value.trim(),
      ...($('deployment-label').value.trim() ? { label: $('deployment-label').value.trim() } : {}), runtime });
  }));
  $('deployment-release').addEventListener('change', selection);
  $('deployment-compare').addEventListener('click', () => attempt(async () => {
    const result = await api('/api/deployment/compare?to=' + encode($('deployment-release').value));
    $('deployment-comparison').hidden = false;
    $('deployment-comparison-summary').textContent = 'Compared against generation ' + result.generation + '.';
    $('deployment-comparison-json').textContent = JSON.stringify(result, null, 2);
    notice('Saved source, query, public terms and runtime differences are shown.');
  }));
  $('deployment-activate').addEventListener('click', () => attempt(() => action('activate', {
    id: $('deployment-release').value, expectedGeneration: snapshot.state.generation,
    reason: $('deployment-reason').value.trim() || 'Select reviewed OpenSearch release',
  })));
  $('deployment-rollback').addEventListener('click', () => attempt(() => action('rollback', {
    expectedGeneration: snapshot.state.generation, reason: $('deployment-reason').value.trim() || 'Return to previous OpenSearch release',
  })));
  $('deployment-run').addEventListener('click', () => attempt(() => action('run', { expectedGeneration: snapshot.state.generation })));
  $('deployment-restart').addEventListener('click', () => attempt(() => action('restart', {
    expectedGeneration: snapshot.state.generation, instanceId: snapshot.console.instanceId,
  })));
  $('deployment-stop').addEventListener('click', () => attempt(() => action('stop', { instanceId: snapshot.console.instanceId })));
  $('deployment-client-generate').addEventListener('click', () => attempt(() => action('generate-client', {
    id: $('deployment-client-id').value.trim(), instanceId: snapshot.console.instanceId,
  })));
  $('deployment-clients-refresh').addEventListener('click', () => attempt(() => clientList()));
  $('deployment-clients-more').addEventListener('click', () => attempt(() => clientList(true)));
  return { sync, buttons, refresh, restorePending: scheduleRecovery, async acceptOperation(operation) {
    if (!operation.kind.startsWith('deployment-')) return false;
    clearTimeout(timer);
    await refresh();
    if (operation.result?.client) await clientList();
    view('deployment');
    notice(operation.kind.replaceAll('-', ' ') + ' completed and retained with request ' + operation.id + '.');
    return true;
  } };
}
