const $ = selector => document.querySelector(selector);
const fragment = location.hash.slice(1);
if (fragment) { sessionStorage.setItem('seller-release-token', fragment); history.replaceState(null, '', location.pathname); }
const token = sessionStorage.getItem('seller-release-token') ?? '';
let snapshot = null, selected = null, comparison = null, busy = false;
const node = (tag, text, className) => { const result = document.createElement(tag); if (text !== undefined) result.textContent = text; if (className) result.className = className; return result; };
const date = value => value ? new Date(value).toLocaleString() : '—';
const literal = value => value === null || value === undefined ? '—' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const quoted = value => "'" + value.replaceAll("'", "'\\''") + "'";
function notice(message = '', error = false) { $('#notice').textContent = message; $('#notice').classList.toggle('error', error); }
async function request(path, payload) {
  const options = { headers: { 'x-release-token': token }, cache: 'no-store' };
  if (payload !== undefined) { options.method = 'POST'; options.headers['content-type'] = 'application/json'; options.body = JSON.stringify(payload); }
  const response = await fetch(path, options), value = await response.json();
  if (!response.ok) throw new Error(value.message ?? 'Operator action failed.');
  return value;
}
function buttons() {
  const blocked = busy || !snapshot || snapshot.console.busy;
  for (const button of document.querySelectorAll('button')) button.disabled = blocked;
  if (!snapshot || blocked) return;
  $('#activate').disabled = !comparison || selected === snapshot.state.active;
  $('#rollback').disabled = !snapshot.state.previous;
  const owns = snapshot.console.managesRunningSeller;
  $('#start').disabled = !snapshot.state.active || owns || !['STOPPED'].includes(snapshot.runtime.state);
  $('#restart').disabled = !owns || !snapshot.state.active;
  $('#stop').disabled = !owns;
}
function renderStatus(value) {
  snapshot = value;
  $('#selected').textContent = value.state.active ?? 'None selected';
  $('#generation').textContent = 'Selection generation ' + value.state.generation;
  $('#running').textContent = ['STOPPED'].includes(value.runtime.state) ? 'Stopped' : value.runtime.observed?.releaseId ?? 'Starting';
  $('#runtime').textContent = value.runtime.state.replaceAll('_', ' ');
  $('#listener').textContent = value.runtime.state === 'STOPPED' ? '—' : value.runtime.observed?.listener ?? '—';
  $('#mode').textContent = value.runtime.state === 'STOPPED' ? 'Ready to start a selected release' : value.runtime.observed?.mode ?? '—';
  $('#store').textContent = value.root;
  $('#stage-command').textContent = 'node release-cli.mjs stage --store ' + quoted(value.root) + ' --id release-name --spec openapi.json --config selections.json --bindings bindings.json';
  const list = $('#release-list'); list.replaceChildren();
  for (const release of value.releases) {
    const button = node('button', undefined, 'release-card'); button.dataset.id = release.id;
    button.setAttribute('aria-pressed', String(release.id === selected));
    button.append(node('strong', release.label), node('span', release.id + ' · ' + release.routes.length + ' routes'),
      node('span', date(release.createdAt)), node('span', release.id === value.state.active ? 'Selected for next start' : 'Prepared'));
    button.addEventListener('click', () => choose(release.id)); list.append(button);
  }
  if (!value.releases.length) list.append(node('p', 'No releases staged. Use the stage command below.'));
  for (const error of value.errors) list.append(node('p', error.id + ': ' + error.message));
  const historyRows = $('#history'); historyRows.replaceChildren();
  for (const event of [...value.state.history].reverse().slice(0, 40)) {
    const row = node('tr'); row.append(node('td', date(event.at)), node('td', String(event.generation)),
      node('td', (event.from ?? 'None') + ' → ' + event.to + ' (' + event.operation + ')'), node('td', event.reason)); historyRows.append(row);
  }
  if (!value.state.history.length) { const row = node('tr'), cell = node('td', 'No selection changes yet.'); cell.colSpan = 4; row.append(cell); historyRows.append(row); }
  $('#process-description').textContent = value.runtime.state === 'RESTART_REQUIRED'
    ? 'The selected release differs from the running seller. Restart selected stops this console’s seller and launches the selected configuration.'
    : value.console.managesRunningSeller ? 'This console owns the running seller. Closing the console command stops that seller.'
    : value.runtime.state !== 'STOPPED' ? 'Another manager owns this seller. Stop it from its original terminal or console before starting here.'
    : 'Start the selected seller release. Its prepared configuration, responses and application entry are checked first.';
  buttons();
}
function fieldPair(field, before, after) {
  const section = node('div', undefined, 'change'); section.append(node('h3', field));
  const columns = node('div', undefined, 'fields');
  for (const [label, value] of [['Before', before], ['After', after]]) {
    const column = node('div'); column.append(node('label', label), node('pre', literal(value))); columns.append(column);
  }
  section.append(columns); return section;
}
function renderDiff(value) {
  comparison = value;
  $('#comparison-caption').textContent = (value.before?.id ?? 'No selected release') + ' → ' + value.after.id;
  $('#review-title').textContent = value.after.label;
  $('#review-mode').textContent = value.after.mode;
  $('#review-description').textContent = value.after.publicOrigin + ' · ' + value.after.routes.length + ' routes. Selection applies on the next start; the running seller is unchanged until restart.';
  const summary = $('#review-summary'); summary.replaceChildren();
  for (const [label, count] of [['Added', value.summary.added], ['Changed', value.summary.changed], ['Removed', value.summary.removed], ['Unchanged', value.summary.unchanged]]) {
    const item = node('div'); item.append(node('strong', String(count)), node('span', label)); summary.append(item);
  }
  const changes = $('#route-changes'); changes.replaceChildren();
  for (const change of value.changes) {
    const section = node('section', undefined, 'change'); section.append(node('h3', change.state + ' · ' + change.route));
    if (change.state !== 'CHANGED') {
      const route = change.after ?? change.before;
      section.append(node('small', 'Exact payment alternatives · amounts in atomic units'), node('pre', literal(route.payment)));
      if (route.upstream) section.append(node('small', 'Original upstream configuration'), node('pre', literal(route.upstream)));
    }
    for (const field of change.fields) section.append(fieldPair(field.field, field.before, field.after));
    changes.append(section);
  }
  if (!value.changes.length) changes.append(node('p', 'Route offers, input contracts and application bindings match.', 'section-note'));
  const runtime = $('#runtime-changes'); runtime.replaceChildren();
  for (const change of value.runtimeChanges) runtime.append(fieldPair('Runtime · ' + change.field, change.before, change.after));
  if (value.after.handlerEntry) runtime.append(node('p', 'Handler entry module is pinned. Its imported files and installed package dependencies are managed separately by the operator.', 'section-note'));
  $('#selection-actions').hidden = false;
  for (const button of document.querySelectorAll('.release-card')) button.setAttribute('aria-pressed', String(button.dataset.id === selected));
  buttons();
}
async function choose(releaseId) {
  selected = releaseId; comparison = null; busy = true; buttons();
  try { renderDiff(await request('/api/diff?to=' + encodeURIComponent(releaseId))); notice(); }
  catch (error) { notice(error.message, true); }
  finally { busy = false; buttons(); }
}
async function refresh() {
  busy = true; buttons();
  try {
    const value = await request('/api/status'); renderStatus(value);
    if (selected && !value.releases.some(r => r.id === selected)) selected = null;
    selected ??= value.state.active ?? value.releases[0]?.id ?? null;
    if (selected) renderDiff(await request('/api/diff?to=' + encodeURIComponent(selected)));
    if (value.console.lastError) notice(value.console.lastError, true);
  } catch (error) { notice(error.message, true); }
  finally { busy = false; buttons(); }
}
async function act(action) {
  if (!snapshot || busy) return;
  const payload = { expectedGeneration: comparison?.generation ?? snapshot.state.generation,
    instanceId: snapshot.console.instanceId, reason: $('#reason').value.trim() || 'Operator ' + action };
  if (action === 'activate') payload.id = selected;
  if (['run', 'restart'].includes(action)) payload.expectedGeneration = snapshot.state.generation;
  busy = true; buttons(); notice(action === 'run' || action === 'restart' ? 'Starting the selected seller release…' : 'Saving operator action…');
  try {
    const value = await request('/api/' + action, payload); renderStatus(value);
    if (action === 'rollback') selected = value.state.active;
    if (selected) renderDiff(await request('/api/diff?to=' + encodeURIComponent(selected)));
    notice(action === 'activate' || action === 'rollback' ? 'Selection saved. Use Start or Restart selected to run it.' : 'Operator action completed.');
  } catch (error) { notice(error.message, true); }
  finally { busy = false; buttons(); }
}
$('#refresh').addEventListener('click', () => { notice(); refresh(); });
$('#activate').addEventListener('click', () => act('activate'));
$('#rollback').addEventListener('click', () => act('rollback'));
$('#start').addEventListener('click', () => act('run'));
$('#restart').addEventListener('click', () => act('restart'));
$('#stop').addEventListener('click', () => act('stop'));
refresh();
