// MIT. The editor authors the original merchant-plan format; all compilation stays on the original server path.
import { attachSchemaRefresh } from './schema-refresh.mjs';
const $ = id => document.getElementById(id);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const clone = value => structuredClone(value);
const stringify = value => JSON.stringify(value, null, 2);
const state = { plan: null, selected: null, dirty: false, saved: null, exported: null,
  reviewed: null, members: [], memberNext: null, versions: [], versionNext: null, advancedChanged: false, metadataId: 'original' };
let schemaRefresh, running = false;
const tokenKey = 'cube-workspace-token:' + location.origin;
let token = location.hash.slice(1) || sessionStorage.getItem(tokenKey);
if (token) { sessionStorage.setItem(tokenKey, token); history.replaceState(null, '', location.pathname); }
function notice(message, error = false) {
  $('notice').textContent = message; $('notice').dataset.error = String(error); $('notice').hidden = !message;
}
async function api(path, body) {
  const response = await fetch('/api/' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Workspace returned HTTP ${response.status}`);
  return result;
}
async function run(operation) {
  if (running) return;
  running = true;
  const regions = [...document.querySelectorAll('main,header')];
  regions.forEach(region => { region.inert = true; }); document.body.setAttribute('aria-busy', 'true');
  try { await operation(); }
  catch (error) { notice(error.message, true); }
  finally { regions.forEach(region => { region.inert = false; }); document.body.removeAttribute('aria-busy'); running = false; }
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function button(text, action, className) {
  const node = element('button', text, className); node.type = 'button'; node.addEventListener('click', action); return node;
}
function field(labelText, value, update, { type = 'text', area = false, className = '', list } = {}) {
  const label = element('label', labelText, className), input = document.createElement(area ? 'textarea' : 'input');
  if (!area) input.type = type; else input.rows = 3;
  input.value = value ?? ''; if (list) input.setAttribute('list', list);
  input.addEventListener('change', () => { try { update(type === 'number' ? input.value === '' ? null : Number(input.value) : input.value); dirty(); } catch (error) { notice(error.message, true); } });
  label.append(input); return label;
}
function cache() {
  if (!state.bootstrap) return;
  sessionStorage.setItem('cube-plan:' + state.bootstrap.id, JSON.stringify({ plan: state.plan,
    metadataId: state.metadataId,
    selected: state.selected, dirty: state.dirty, version: state.saved?.id ?? null, exported: state.exported?.id ?? null,
    reportDraft: state.advancedChanged ? { id: state.selected, json: $('report-json').value } : null }));
}
function badge() {
  $('draft-status').textContent = state.advancedChanged ? 'Report JSON has unapplied edits' :
    state.dirty ? 'Unsaved local edits' : state.saved ? 'Saved version selected' : 'Working plan';
}
function dirty() {
  state.dirty = true; state.reviewed = null; badge(); cache();
  if (!state.advancedChanged && current()) $('report-json').value = stringify(current());
}
function current() { return state.plan?.reports?.[state.selected]; }
function showTab(name) {
  for (const id of ['compose', 'review', 'handoff', 'schema']) $(id + '-panel').hidden = id !== name;
  for (const tab of document.querySelectorAll('[data-tab]')) tab.classList.toggle('active', tab.dataset.tab === name);
  if (name === 'handoff') renderHandoff();
}
async function selectMetadata(metadataId) {
  const source = await api('metadata/' + metadataId); state.metadataId = source.id;
  $('source-counts').textContent = `${source.source.cubeCount} cubes / views · ${source.source.memberCount} public members`;
  $('source-edition').textContent = source.label + ' · ' + source.id;
  $('source-digest').textContent = 'Metadata SHA-256 ' + source.metadataSha256;
  $('member-cube').replaceChildren(element('option', 'All cubes and views')); $('member-cube').firstChild.value = '';
  for (const cube of source.cubes) { const option = element('option', cube.title + ' · ' + cube.name); option.value = cube.name; $('member-cube').append(option); }
  state.members = []; state.memberNext = null;
}
function requireSaved() {
  if (!state.saved) throw new Error('Save or open a version first');
  if (state.dirty || state.advancedChanged) throw new Error('Save the current changes or reopen the selected version before using its handoff');
  return state.saved;
}
const paymentChoices = value => own(value ?? {}, 'paymentOptions') ? value.paymentOptions : value?.payment ? [value.payment] : [];
function setChoices(target, choices) {
  delete target.payment; delete target.paymentOptions;
  if (choices.length === 1) target.payment = choices[0]; else target.paymentOptions = choices;
}
const newChoice = () => ({ scheme: 'exact', network: 'stellar:testnet', asset: '', payTo: '', amount: '', maxTimeoutSeconds: 60 });
function renderPayments(container, target) {
  container.replaceChildren();
  paymentChoices(target).forEach((choice, index) => {
    const row = element('div', null, 'payment-row'), heading = element('div', null, 'payment-index');
    heading.append(element('span', 'Choice ' + index + ' · exact'), button('Remove', () => {
      const choices = paymentChoices(target); choices.splice(index, 1); setChoices(target, choices); dirty(); renderPayments(container, target);
    }));
    const grid = element('div', null, 'form-grid');
    grid.append(field('Network', choice.network, value => { choice.network = value; }),
      field('Amount, atomic units', choice.amount, value => { choice.amount = value; }),
      field('Timeout, seconds', choice.maxTimeoutSeconds, value => { choice.maxTimeoutSeconds = value; }, { type: 'number' }),
      field('Token contract / asset', choice.asset, value => { choice.asset = value; }, { className: 'long-field' }),
      field('Merchant recipient', choice.payTo, value => { choice.payTo = value; }, { className: 'long-field' }));
    const details = element('details'), summary = element('summary', 'Original option extensions'); details.append(summary);
    details.append(field('extra, JSON object (leave empty to omit)', choice.extra === undefined ? '' : stringify(choice.extra), value => {
      if (!value.trim()) delete choice.extra; else choice.extra = JSON.parse(value);
    }, { area: true }));
    row.append(heading, grid, details); container.append(row);
  });
  if (!paymentChoices(target).length) container.append(element('p', 'Add a complete payment choice.', 'help'));
}
function renderBasics() {
  const plan = state.plan, upstream = plan.upstream ?? {};
  const values = { 'service-name': plan.serviceName, 'public-origin': plan.publicOrigin, 'cube-origin': upstream.origin,
    'auth-env': upstream.authEnv, 'cube-path': upstream.path, tags: (plan.tags ?? []).join(', '),
    timeout: upstream.timeoutMs ?? 10000, 'response-limit': upstream.maxResponseBytes ?? 262144,
    concurrency: upstream.maxInFlight ?? 8, 'max-rows': upstream.maxRows ?? 1000 };
  for (const [key, value] of Object.entries(values)) $(key).value = value ?? '';
  $('allow-loopback').checked = upstream.allowLoopback === true;
  renderPayments($('default-payments'), plan);
}
function renderReports() {
  const list = $('report-list'); list.replaceChildren();
  const entries = Object.entries(state.plan.reports);
  if (!entries.length) list.append(element('div', 'No reports yet', 'empty'));
  for (const [id, report] of entries) {
    const item = button(id, () => { try { applyPendingJson(); state.selected = id; renderEditor(); renderReports(); cache(); } catch (error) { notice(error.message, true); } }, id === state.selected ? 'active' : '');
    item.append(element('small', `${report.query?.measures?.length ?? 0} measures · ${Object.keys(report.inputs ?? {}).length} inputs`)); list.append(item);
  }
}
function renderSelected() {
  const container = $('selected-members'); container.replaceChildren();
  for (const kind of ['measures', 'dimensions', 'segments']) for (const name of current()?.query?.[kind] ?? []) {
    const row = element('div', null, 'selected-row');
    row.append(element('span', name + ' · ' + kind), button('Remove', () => {
      current().query[kind] = current().query[kind].filter(item => item !== name);
      if (!current().query[kind].length && kind !== 'measures') delete current().query[kind];
      dirty(); renderSelected(); renderMembers(); renderReports();
    })); container.append(row);
  }
  if (!container.children.length) container.append(element('p', 'Choose at least one measure from the actual catalog.', 'help'));
}
function renderInputs() {
  const report = current(), container = $('input-list'); container.replaceChildren();
  for (const [name, input] of Object.entries(report.inputs ?? {})) {
    const row = element('div', null, 'input-card'), title = element('div', name, 'input-title');
    title.append(element('span', input.type, 'input-kind')); row.append(title);
    const grid = element('div', null, 'form-grid');
    grid.append(field('Public description', input.description, value => { input.description = value; }),
      field('Exact example', input.example, value => { input.example = value; }, { type: input.type === 'integer' ? 'number' : input.type === 'date' ? 'date' : 'text' }));
    if (input.type === 'enum') grid.append(field('Allowed values, one per line', (input.values ?? []).join('\n'), value => {
      input.values = value.split('\n').filter(item => item.length);
    }, { area: true }));
    if (input.type === 'integer') grid.append(field('Inclusive minimum', input.min, value => { input.min = value; }, { type: 'number' }),
      field('Inclusive maximum', input.max, value => { input.max = value; }, { type: 'number' }));
    row.append(grid); container.append(row);
  }
  if (!container.children.length) container.append(element('p', 'This fixed report has no public query inputs.', 'help'));
  $('range-fields').hidden = !report.range;
  if (report.range) { $('range-start').value = report.range.start; $('range-end').value = report.range.end; $('range-days').value = report.range.maxDays; }
}
function renderEditor() {
  const report = current(); $('empty-report').hidden = !!report; $('report-editor').hidden = !report;
  if (!report) return;
  const pendingJson = state.advancedChanged ? $('report-json').value : null;
  $('report-heading').textContent = state.selected; $('report-path').textContent = 'GET /reports/' + state.selected;
  $('report-id').value = state.selected; $('report-description').value = report.description ?? '';
  $('report-limit').value = report.query?.limit ?? 100;
  const time = report.query?.timeDimensions?.[0];
  $('time-member').value = time?.dimension ?? ''; $('granularity').value = typeof time?.granularity === 'string' ? time.granularity : '';
  $('timezone').value = typeof report.query?.timezone === 'string' ? report.query.timezone : '';
  $('override-payment').checked = own(report, 'payment') || own(report, 'paymentOptions');
  $('report-payment-section').hidden = !$('override-payment').checked;
  renderPayments($('report-payments'), report); renderSelected(); renderInputs(); renderMembers();
  $('report-json').value = pendingJson ?? stringify(report); state.advancedChanged = pendingJson !== null; badge();
}
function renderMembers() {
  const container = $('member-list'); container.replaceChildren();
  const query = current()?.query;
  for (const member of state.members) {
    const row = element('div', null, 'member-row'), checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', 'Select ' + member.name);
    checkbox.checked = query?.[member.kind]?.includes(member.name) ?? false; checkbox.disabled = !query;
    checkbox.addEventListener('change', () => {
      const values = current().query[member.kind] ?? [];
      current().query[member.kind] = checkbox.checked ? [...new Set([...values, member.name])] : values.filter(value => value !== member.name);
      if (!current().query[member.kind].length && member.kind !== 'measures') delete current().query[member.kind];
      dirty(); renderSelected(); renderReports();
    });
    const label = element('div', null, 'member-label');
    label.append(element('strong', member.name), element('span', `${member.title} · ${member.kind} · ${member.type ?? 'type unspecified'}`)); row.append(checkbox, label);
    if (member.type === 'time') row.append(button('Use for time', () => {
      $('time-member').value = member.name;
      $('granularities').replaceChildren(...member.granularities.map(value => { const option = document.createElement('option'); option.value = value; return option; }));
      $('granularity').focus();
    }));
    container.append(row);
  }
  $('member-count').textContent = `${state.members.length} displayed / ${state.memberTotal ?? 0} matches`;
  $('more-members').hidden = state.memberNext === null;
  for (const [target, values] of [['time-members', state.members.filter(member => member.type === 'time')],
    ['filter-members', state.members.filter(member => member.kind === 'dimensions' || member.kind === 'measures')]]) {
    $(target).replaceChildren(...values.map(member => { const option = document.createElement('option'); option.value = member.name; return option; }));
  }
}
let searchSequence = 0;
async function searchMembers(append = false) {
  const sequence = ++searchSequence, params = new URLSearchParams({ query: $('member-search').value,
    metadataId: state.metadataId,
    kind: $('member-kind').value, cube: $('member-cube').value, offset: String(append ? state.memberNext ?? 0 : 0) });
  const page = await api('members?' + params);
  if (sequence !== searchSequence) return;
  state.members = append ? [...state.members, ...page.items] : page.items;
  state.memberTotal = page.total; state.memberNext = page.next; renderMembers();
}
function applyPendingJson() {
  if (!state.advancedChanged) return;
  const value = JSON.parse($('report-json').value);
  if (!value || typeof value !== 'object' || Array.isArray(value) || !value.query || !value.inputs)
    throw new Error('Report JSON needs its original query and inputs objects');
  state.plan.reports[state.selected] = value; state.advancedChanged = false; dirty();
}
function table(headers, rows) {
  const wrap = element('div', null, 'table-wrap'), result = element('table'), head = element('thead'), tr = element('tr');
  for (const header of headers) tr.append(element('th', header)); head.append(tr); result.append(head);
  const body = element('tbody');
  for (const values of rows) { const row = element('tr'); for (const value of values) { const cell = element('td'); cell.append(value instanceof Node ? value : document.createTextNode(String(value ?? ''))); row.append(cell); } body.append(row); }
  result.append(body); wrap.append(result); return wrap;
}
function renderReview() {
  const container = $('review-content'); container.className = ''; container.replaceChildren();
  const review = state.reviewed;
  if (!review) { container.className = 'empty card'; container.textContent = 'Review the current plan to see its compiled requests.'; return; }
  const summary = element('div', null, 'card review-facts');
  for (const [title, value] of [['Reports', review.reportCount], ['Actual source members', review.metadata.memberCount],
    ['Public origin', review.publicOrigin], ['Cube backend', review.upstream.origin]]) {
    const fact = element('div'); fact.append(element('strong', value), element('span', title)); summary.append(fact);
  }
  container.append(summary);
  for (const report of review.reports) {
    const card = element('article', null, 'review-report'); card.append(element('h2', report.id), element('p', report.description));
    card.append(element('p', 'GET ' + report.exampleUrl, 'mono break'));
    card.append(table(['Selected member', 'Kind', 'Type'], report.members.map(member => [member.name, member.kind, member.type])));
    if (report.inputs.length) card.append(table(['Input', 'Type', 'Example', 'Contract'], report.inputs.map(input =>
      [input.name, input.type, stringify(input.example), input.type === 'enum' ? input.values.join(', ') : input.type === 'integer' ? `${input.min} through ${input.max}` : 'YYYY-MM-DD'])));
    card.append(table(['Choice', 'Network', 'Asset', 'Amount', 'Recipient', 'Timeout'], report.paymentOptions.map((option, index) =>
      [index, option.network, element('code', option.asset), element('code', option.amount), element('code', option.payTo), `${option.maxTimeoutSeconds}s`])));
    const detail = element('details'); detail.append(element('summary', 'Rendered Cube request and complete original payment choices'),
      element('pre', stringify({ query: report.renderedExample, paymentOptions: report.paymentOptions })));
    card.append(detail); container.append(card);
  }
}
async function review() {
  applyPendingJson(); state.reviewed = await api('review', { plan: state.plan, metadataId: state.metadataId }); renderReview(); showTab('review');
  notice(`Compiled ${state.reviewed.reportCount} report${state.reviewed.reportCount === 1 ? '' : 's'} through the original Cube and seller functions.`);
}
async function refreshVersions(append = false) {
  const page = await api('versions' + (append && state.versionNext ? '?before=' + encodeURIComponent(state.versionNext) : ''));
  state.versions = append ? [...state.versions, ...page.items] : page.items; state.versionNext = page.next;
  const list = $('version-list'); list.replaceChildren();
  for (const version of state.versions) {
    const item = button(version.serviceName ?? version.id, () => run(() => loadVersion(version.id)), version.id === state.saved?.id ? 'active' : '');
    item.append(element('small', version.status === 'SAVED' ? `${version.reportCount} reports · ${new Date(version.createdAt).toLocaleString()}` : version.error)); list.append(item);
  }
  if (!state.versions.length) list.append(element('div', 'Your first saved plan will appear here.', 'empty'));
  $('more-versions').hidden = !page.next;
}
async function loadVersion(id, restoring = false) {
  if (!restoring && (state.dirty || state.advancedChanged) && !confirm('Open the saved version and replace this tab’s current edits?')) return;
  const saved = await api('versions/' + id); state.saved = saved; state.plan = clone(saved.plan);
  await selectMetadata(saved.metadataId);
  state.selected = Object.keys(state.plan.reports)[0] ?? null; state.dirty = false; state.advancedChanged = false;
  state.reviewed = null; state.exported = null;
  const latest = [...saved.view.exports].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1), exportId = latest?.destination?.split('/').at(-1);
  if (exportId && /^package-[a-z0-9-]+$/.test(exportId)) {
    try { state.exported = await api('exports/' + exportId); } catch (error) { notice(error.message, true); }
  }
  renderBasics(); renderReports(); renderEditor(); renderReview(); renderHandoff(); badge(); cache(); await Promise.all([refreshVersions(), searchMembers()]);
  if (!restoring) notice('Opened the saved native merchant plan.');
}
async function saveVersion() {
  applyPendingJson(); const saved = await api('versions', { plan: state.plan, metadataId: state.metadataId });
  state.saved = saved; state.dirty = false; state.exported = null; badge(); cache(); await refreshVersions(); renderHandoff();
  notice(`Saved ${saved.view.reportCount} reports as a new immutable merchant version.`); showTab('handoff');
}
function downloadButton(kind, item, file, title = file) {
  return button(title, () => run(() => download(kind, item, file)));
}
async function download(kind, item, file) {
  const response = await fetch(`/api/files/${kind}/${item}/${file}`, { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' });
  if (!response.ok) throw new Error((await response.json()).error);
  saveBlob(await response.blob(), file);
}
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const shell = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
function reportOptions(select, reports) {
  select.replaceChildren(...reports.map(report => { const option = element('option', report.id); option.value = report.id; return option; }));
}
function renderBuyerInputs() {
  const report = state.exported?.package.reports.find(item => item.id === $('buyer-report').value);
  $('buyer-option').replaceChildren();
  if (!report) { $('buyer-inputs').value = ''; return; }
  for (const [index, option] of report.paymentOptions.entries()) {
    const row = element('option', `${index}: ${option.amount} atomic · ${option.network} · ${option.asset}`); row.value = String(index); $('buyer-option').append(row);
  }
  $('buyer-inputs').value = stringify(Object.fromEntries(report.inputs.map(input => [input.name, String(input.example)])));
}
function renderHandoff() {
  const chosen = $('selected-version'); chosen.replaceChildren();
  if (!state.saved) { chosen.textContent = 'Save or open a version first.'; reportOptions($('probe-report-id'), []); }
  else {
    chosen.append(element('strong', state.saved.view.serviceName), element('p', state.saved.id, 'mono break'),
      element('p', `${state.saved.view.reportCount} reports · ${state.saved.view.publicOrigin}`, 'help'),
      downloadButton('versions', state.saved.id, 'merchant-plan.json'));
    if (state.dirty) chosen.append(element('p', 'The editor has changes beyond this saved version. Save them before continuing.', 'help'));
    reportOptions($('probe-report-id'), state.saved.view.reports);
  }
  const output = $('export-result'); output.replaceChildren();
  if (!state.exported) { output.textContent = 'Export a saved version to create its package.'; reportOptions($('buyer-report'), []); renderBuyerInputs(); return; }
  const exported = state.exported, pkg = exported.package;
  output.append(element('p', pkg.directory, 'mono file-path'), element('p', `${pkg.reportCount} saved reports · ${pkg.publicOrigin}`, 'help'));
  output.append(element('h3', 'Customer files'));
  const publicFiles = element('div', null, 'download-list');
  for (const file of exported.publicFiles) publicFiles.append(downloadButton('exports', exported.id, file)); output.append(publicFiles);
  const privateDetails = element('details'); privateDetails.append(element('summary', 'Private merchant files'));
  const privateFiles = element('div', null, 'download-list');
  for (const file of exported.privateFiles) privateFiles.append(downloadButton('exports', exported.id, file)); privateDetails.append(privateFiles); output.append(privateDetails);
  output.append(element('h3', 'Launch the package on this host'));
  output.append(element('pre', `node ${shell(pkg.directory + '/launch.mjs')} \\\n  --runtime ${shell(state.bootstrap.runtimeRoot)} \\\n  --port 8423 --operations-port 8424 \\\n  --history-dir ${shell(state.bootstrap.directory + '/merchant-usage')}`));
  output.append(element('p', `Supply the configured Cube authorization through ${pkg.authEnv}. Add the merchant’s existing --facilitator URL for its native payment runtime. The launch prints original seller, developer and private operations URLs.`, 'help'));
  reportOptions($('buyer-report'), pkg.reports); renderBuyerInputs();
}
async function exportPackage() {
  const saved = requireSaved(); state.exported = await api('export', { version: saved.id }); renderHandoff(); cache();
  state.saved = await api('versions/' + saved.id); notice('Exported the original merchant package with its catalog, native seller configuration and customer instructions.');
}
async function probeReport() {
  const saved = requireSaved(), result = await api('probe', { version: saved.id, reportId: $('probe-report-id').value });
  const box = $('probe-result'); box.replaceChildren();
  box.append(element('p', `HTTP ${result.receipt.httpStatus} · ${result.receipt.rowCount ?? '—'} rows · ${result.receipt.durationMs} ms`, 'status-line'));
  box.append(element('pre', result.preview), element('p', result.previewTruncated ? 'Preview ends at 32 KiB. Download the complete response below.' : 'Complete retained response shown.', 'help'));
  const downloads = element('div', null, 'download-list'); downloads.append(downloadButton('probes', result.id, 'response.json'), downloadButton('probes', result.id, 'probe.json')); box.append(downloads);
  notice('Completed the selected original merchant backend read.');
}
async function prepareBuyer() {
  requireSaved(); if (!state.exported) throw new Error('Export the selected version first');
  const result = await api('buyer', { package: state.exported.id, reportId: $('buyer-report').value,
    acceptIndex: Number($('buyer-option').value), intentId: $('buyer-intent').value,
    inputs: JSON.parse($('buyer-inputs').value) });
  const box = $('buyer-result'); box.replaceChildren(element('p', 'Original buyer review prepared', 'status-line'),
    element('pre', stringify(result.receipt.acceptedTerms)), downloadButton('buyers', result.id, 'review.json'));
  box.append(element('pre', `node ${shell(state.bootstrap.runtimeRoot + '/sf88-operator-buyer-cli/cli.mjs')} \\\n  --review --config ${shell(result.receipt.destination)}`)); notice('Prepared the customer’s original request and selected payment option.');
}

for (const node of document.querySelectorAll('[data-tab]')) node.addEventListener('click', () => {
  if (node.dataset.tab === 'review') run(review);
  else if (node.dataset.tab === 'schema') run(async () => { showTab('schema'); await schemaRefresh.refresh(); });
  else showTab(node.dataset.tab);
});
for (const id of ['review-top', 'review-again']) $(id).addEventListener('click', () => run(review));
$('save-version').addEventListener('click', () => run(saveVersion));
$('refresh-versions').addEventListener('click', () => run(() => refreshVersions()));
$('more-versions').addEventListener('click', () => run(() => refreshVersions(true)));
$('more-members').addEventListener('click', () => run(() => searchMembers(true)));
let searchTimer;
$('member-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => searchMembers().catch(error => notice(error.message, true)), 200); });
for (const id of ['member-kind', 'member-cube']) $(id).addEventListener('change', () => run(() => searchMembers()));
for (const [id, fieldName, upstream, numeric] of [
  ['service-name', 'serviceName'], ['public-origin', 'publicOrigin'], ['cube-origin', 'origin', true],
  ['auth-env', 'authEnv', true], ['cube-path', 'path', true], ['timeout', 'timeoutMs', true, true],
  ['response-limit', 'maxResponseBytes', true, true], ['concurrency', 'maxInFlight', true, true], ['max-rows', 'maxRows', true, true],
]) $(id).addEventListener('change', () => {
  const target = upstream ? state.plan.upstream ??= {} : state.plan;
  target[fieldName] = numeric ? $(id).value === '' ? null : Number($(id).value) : $(id).value; dirty();
});
$('tags').addEventListener('change', () => { state.plan.tags = $('tags').value.split(',').map(value => value.trim()).filter(Boolean); dirty(); });
$('allow-loopback').addEventListener('change', () => { state.plan.upstream.allowLoopback = $('allow-loopback').checked; dirty(); });
$('add-default-payment').addEventListener('click', () => { const choices = paymentChoices(state.plan); setChoices(state.plan, [...choices, clone(choices.at(-1) ?? newChoice())]); dirty(); renderPayments($('default-payments'), state.plan); });
$('add-report-payment').addEventListener('click', () => { const target = current(), choices = paymentChoices(target); setChoices(target, [...choices, clone(choices.at(-1) ?? newChoice())]); dirty(); renderPayments($('report-payments'), target); });
$('override-payment').addEventListener('change', () => {
  if ($('override-payment').checked) setChoices(current(), clone(paymentChoices(state.plan))); else { delete current().payment; delete current().paymentOptions; }
  dirty(); renderEditor();
});
$('add-report').addEventListener('click', () => {
  try {
    applyPendingJson(); let index = 1; while (own(state.plan.reports, 'report-' + index)) index++;
    state.selected = 'report-' + index; state.plan.reports[state.selected] = { description: '', query: { measures: [], limit: 100 }, inputs: {} };
    dirty(); renderReports(); renderEditor(); $('report-id').focus();
  } catch (error) { notice(error.message, true); }
});
$('duplicate-report').addEventListener('click', () => {
  try { applyPendingJson(); let index = 2, name; do { name = state.selected.slice(0, 31) + '-copy-' + index++; } while (own(state.plan.reports, name));
    state.plan.reports[name] = clone(current()); state.selected = name; dirty(); renderReports(); renderEditor();
  } catch (error) { notice(error.message, true); }
});
$('remove-report').addEventListener('click', () => { delete state.plan.reports[state.selected]; state.selected = Object.keys(state.plan.reports)[0] ?? null;
  state.advancedChanged = false; dirty(); renderReports(); renderEditor(); });
$('report-id').addEventListener('change', () => {
  const value = $('report-id').value;
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(value) || value !== state.selected && own(state.plan.reports, value)) {
    notice('Report IDs use a lowercase letter followed by up to 39 lowercase letters, numbers or hyphens, and must be unique.', true); $('report-id').value = state.selected; return;
  }
  state.plan.reports = Object.fromEntries(Object.entries(state.plan.reports).map(([key, report]) => [key === state.selected ? value : key, report]));
  state.selected = value; dirty(); renderReports(); renderEditor();
});
$('report-description').addEventListener('change', () => { current().description = $('report-description').value; dirty(); });
$('report-limit').addEventListener('change', () => { current().query.limit = Number($('report-limit').value); dirty(); });
$('apply-time').addEventListener('click', () => {
  const report = current(), original = report.query.timeDimensions?.[0] ?? {};
  if (!$('time-member').value) { notice('Choose an actual time dimension from the source catalog.', true); return; }
  const time = { ...original, dimension: $('time-member').value };
  if ($('granularity').value) time.granularity = $('granularity').value; else delete time.granularity;
  report.query.timeDimensions = [time, ...(report.query.timeDimensions?.slice(1) ?? [])];
  if ($('timezone').value) report.query.timezone = $('timezone').value; else delete report.query.timezone;
  dirty(); notice('Set the fixed time member and granularity.');
});
$('add-date-window').addEventListener('click', () => {
  const report = current();
  if (!report.query.timeDimensions?.length) { notice('Set the time grouping first.', true); return; }
  if (['start', 'end'].some(name => report.inputs[name] && report.inputs[name].type !== 'date')) {
    notice('The existing start/end input names are used by another type.', true); return;
  }
  for (const [name, description] of [['start', 'First included date'], ['end', 'Last included date']]) {
    report.inputs[name] ??= { type: 'date', description, example: '' };
  }
  report.query.timeDimensions[0].dateRange = [{ $param: 'start' }, { $param: 'end' }];
  report.range = { start: 'start', end: 'end', maxDays: 31 }; dirty(); renderInputs();
});
$('add-offset').addEventListener('click', () => {
  const report = current(); if (report.inputs.offset && report.inputs.offset.type !== 'integer') { notice('The existing offset input uses another type.', true); return; }
  report.query.offset = { $param: 'offset' }; report.inputs.offset ??= { type: 'integer', min: 0, max: 10000, description: 'Rows to skip', example: 0 };
  dirty(); renderInputs(); renderReports();
});
$('open-filter').addEventListener('click', () => { $('filter-form').hidden = !$('filter-form').hidden; });
$('apply-filter').addEventListener('click', () => {
  const report = current(), name = $('filter-name').value, member = $('filter-member').value;
  const values = $('filter-values').value.split('\n').filter(value => value.length);
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(name) || own(report.inputs, name) || !member || !values.length) {
    notice('Choose a fixed member, a new input name and at least one allowed value.', true); return;
  }
  report.inputs[name] = { type: 'enum', values, description: $('filter-description').value, example: values[0] };
  report.query.filters ??= []; report.query.filters.push({ member, operator: 'equals', values: [{ $param: name }] });
  $('filter-form').hidden = true; dirty(); renderInputs(); renderReports();
});
for (const [id, name] of [['range-start', 'start'], ['range-end', 'end'], ['range-days', 'maxDays']]) $(id).addEventListener('change', () => {
  current().range[name] = name === 'maxDays' ? Number($(id).value) : $(id).value; dirty();
});
$('report-json').addEventListener('input', () => { state.advancedChanged = true; badge(); cache(); });
$('apply-report-json').addEventListener('click', () => { try { state.advancedChanged = true; applyPendingJson(); renderEditor(); renderReports(); notice('Applied the original report document.'); } catch (error) { notice(error.message, true); } });
$('import-plan').addEventListener('click', () => $('plan-file').click());
$('plan-file').addEventListener('change', () => run(async () => {
  const file = $('plan-file').files[0]; if (!file) return;
  if (file.size > 1024 * 1024) throw new Error('Merchant plan exceeds 1 MiB');
  const value = JSON.parse(await file.text());
  if (value.schema !== 'stellar-forge.cube-merchant-plan.v1' || !value.reports || typeof value.reports !== 'object' || Array.isArray(value.reports)) throw new Error('Select an original Cube merchant-plan.v1 JSON file');
  await api('review', { plan: value, metadataId: state.metadataId });
  state.plan = value; state.selected = Object.keys(value.reports)[0] ?? null; state.saved = null; state.exported = null;
  state.advancedChanged = false; dirty(); renderBasics(); renderReports(); renderEditor(); renderHandoff(); showTab('compose');
  $('plan-file').value = ''; notice('Imported the original plan. Review it against this workspace’s saved metadata.');
}));
$('download-plan').addEventListener('click', () => { try { applyPendingJson(); saveBlob(new Blob([stringify(state.plan) + '\n'], { type: 'application/json' }), 'merchant-plan.json'); } catch (error) { notice(error.message, true); } });
$('export-package').addEventListener('click', () => run(exportPackage));
$('probe-report').addEventListener('click', () => run(probeReport));
$('buyer-report').addEventListener('change', renderBuyerInputs);
$('prepare-buyer').addEventListener('click', () => run(prepareBuyer));
addEventListener('beforeunload', event => {
  if (state.dirty || state.advancedChanged || schemaRefresh?.hasPending()) { event.preventDefault(); event.returnValue = ''; }
});

await run(async () => {
  if (!token) throw new Error('Open the complete browser URL printed by the workspace command.');
  state.bootstrap = await api('bootstrap'); state.plan = state.bootstrap.plan;
  $('source-path').textContent = state.bootstrap.directory;
  if (state.bootstrap.version) state.saved = await api('versions/' + state.bootstrap.version);
  let cached;
  try { cached = JSON.parse(sessionStorage.getItem('cube-plan:' + state.bootstrap.id) ?? 'null'); } catch {}
  if (cached?.plan?.schema === 'stellar-forge.cube-merchant-plan.v1') {
    state.plan = cached.plan; state.selected = cached.selected; state.dirty = cached.dirty;
    if (cached.version) {
      try { state.saved = await api('versions/' + cached.version); }
      catch (error) { notice(error.message, true); }
    }
    if (cached.exported) { try { state.exported = await api('exports/' + cached.exported); } catch {} }
  }
  await selectMetadata(cached?.metadataId ?? state.saved?.metadataId ?? state.bootstrap.metadataId ?? 'original');
  if (!own(state.plan.reports, state.selected)) state.selected = Object.keys(state.plan.reports)[0] ?? null;
  renderBasics(); renderReports(); renderEditor(); renderReview(); renderHandoff(); badge();
  if (cached?.reportDraft?.id === state.selected && typeof cached.reportDraft.json === 'string') {
    $('report-json').value = cached.reportDraft.json; state.advancedChanged = true; badge();
  }
  await Promise.all([searchMembers(), refreshVersions()]);
  schemaRefresh = attachSchemaRefresh({ api, run, notice, element, button, downloadButton,
    selectedVersion: () => state.saved, openVersion: loadVersion,
    canReplacePlan: () => !(state.dirty || state.advancedChanged) || confirm('Select the applied schema version and replace this tab’s unsaved report edits?'),
    cacheId: state.bootstrap.id });
  await schemaRefresh.restore();
});
