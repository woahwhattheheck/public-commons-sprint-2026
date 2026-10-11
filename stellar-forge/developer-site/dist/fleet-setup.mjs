// MIT. The workbench exports declarations consumed by the original native tools.
import { SOURCE_LABELS, LIMIT_RANGES, SQLITE_SNAPSHOT_OPTIONS, createFleetDraft, newFleetTenant, newFleetSource,
  importFleetDraft, importFleetSource, validPostgresInputManifest, validateFleetDraft, createFleetPacket, fleetCommands, commandText } from './fleet-onboarding.mjs';
import { zipWorkspace } from './onboarding.mjs';

const $ = id => document.getElementById(id);
let draft = createFleetDraft(), step = 0, selected = 0;
const hostFields = { folder: 'fleet-folder', directory: 'fleet-directory', mcpDirectory: 'fleet-mcp-directory',
  workspacePort: 'fleet-workspace-port', gatewayPort: 'fleet-gateway-port', adminPort: 'fleet-admin-port',
  merchantPortStart: 'fleet-merchant-port-start', slots: 'fleet-slots' };
const panes = ['fleet-host-pane', 'fleet-merchants-pane', 'fleet-review-pane'];
const headings = ['fleet-host-heading', 'fleet-merchants-heading', 'fleet-review-heading'];
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function button(label, action, { disabled = false, className = 'button small', id } = {}) {
  const node = el('button', label, className); node.type = 'button'; node.disabled = disabled;
  if (id) node.id = id;
  node.addEventListener('click', action); return node;
}
function status(message) { $('fleet-status').textContent = message; $('fleet-status').hidden = !message; }
function clearErrors() {
  $('fleet-errors').hidden = true; $('fleet-error-list').replaceChildren();
  document.querySelectorAll('[aria-invalid="true"]').forEach(node => node.removeAttribute('aria-invalid'));
}
function focusField(field) {
  let target;
  if (hostFields[field] || field === 'ports' || field === 'setup') {
    showStep(0);
    target = $(hostFields[field] ?? (field === 'ports' ? 'fleet-merchant-port-start' : 'fleet-import-draft'));
  } else {
    const match = /^tenants\.(\d+)(?:\.|$)/.exec(field);
    if (match) selected = Number(match[1]);
    showStep(1);
    target = [...document.querySelectorAll('[data-field]')].find(node => node.dataset.field === field);
    if (!target && match) target = /\.sources(?:\.|$)/.test(field) ? $('fleet-add-source') :
      document.querySelector('[data-field="tenants.' + selected + '.id"]');
    target ??= $('fleet-add-merchant');
  }
  for (let ancestor = target?.parentElement; ancestor; ancestor = ancestor.parentElement)
    if (ancestor.tagName === 'DETAILS') ancestor.open = true;
  if (target?.matches('input, select, textarea')) target.setAttribute('aria-invalid', 'true');
  if (target && !target.disabled) target.focus();
}
function showErrors(errors) {
  clearErrors();
  for (const error of errors.slice(0, 80)) {
    const item = el('li');
    item.append(button(error.message, () => focusField(error.field), { className: 'fleet-error-link' }));
    $('fleet-error-list').append(item);
    const target = hostFields[error.field] ? $(hostFields[error.field]) :
      [...document.querySelectorAll('[data-field]')].find(node => node.dataset.field === error.field);
    target?.setAttribute('aria-invalid', 'true');
  }
  $('fleet-errors').hidden = false;
}
function field(label, value, key, update, { hint = '', type = 'text', options, min, max, placeholder = '', maxLength } = {}) {
  const wrap = el('div', undefined, 'field'), id = 'fleet-value-' + key.replaceAll('.', '-');
  const caption = el('label', label); caption.htmlFor = id;
  const input = el(options ? 'select' : 'input'); input.id = id; input.dataset.field = key;
  if (options) {
    for (const [optionValue, optionLabel] of options) {
      const option = el('option', optionLabel); option.value = optionValue; input.append(option);
    }
  } else {
    input.type = type; input.autocomplete = 'off'; input.spellcheck = false; input.placeholder = placeholder;
    if (type === 'number') { input.step = '1'; input.inputMode = 'numeric'; }
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    if (maxLength !== undefined) input.maxLength = maxLength;
  }
  input.value = value ?? '';
  input.addEventListener(options ? 'change' : 'input', () => { update(input.value); clearErrors(); });
  wrap.append(caption, input);
  if (hint) { const p = el('p', hint, 'hint'); p.id = id + '-hint'; input.setAttribute('aria-describedby', p.id); wrap.append(p); }
  return wrap;
}
function check(label, checked, key, update) {
  const wrap = el('label', undefined, 'fleet-check'), input = el('input');
  input.type = 'checkbox'; input.checked = checked === true; input.dataset.field = key;
  input.id = 'fleet-value-' + key.replaceAll('.', '-');
  input.addEventListener('change', () => { update(input.checked); clearErrors(); });
  wrap.append(input, el('span', label)); return wrap;
}
function uniqueName(base, existing) {
  const safe = typeof base === 'string' && /^[a-z][a-z0-9-]*$/.test(base) ? base.slice(0, 33) : 'merchant';
  let name = safe, suffix = 2;
  while (existing.includes(name)) name = safe + '-' + suffix++;
  return name;
}
function renderHost() {
  for (const [key, id] of Object.entries(hostFields))
    $(id).value = key === 'slots' && Array.isArray(draft.slots) ? draft.slots.join(', ') : draft[key] ?? '';
}
function renderMerchantList() {
  $('fleet-merchants').replaceChildren();
  draft.tenants.forEach((tenant, index) => {
    const node = button('', () => { selected = index; renderMerchants(); }, { className: 'fleet-merchant-item' });
    node.dataset.merchantIndex = String(index); node.setAttribute('aria-pressed', String(index === selected));
    node.append(el('strong', tenant.id || `Merchant ${index + 1}`), el('code', tenant.host || 'Public host required'));
    $('fleet-merchants').append(node);
  });
  $('fleet-add-merchant').disabled = draft.tenants.length >= 32;
}
function renderMerchants() {
  selected = Math.max(0, Math.min(selected, draft.tenants.length - 1));
  renderMerchantList();
  const editor = $('fleet-editor'); editor.replaceChildren();
  const tenant = draft.tenants[selected];
  if (!tenant) { editor.append(el('p', 'Add a merchant to register its source packages.')); return; }
  const prefix = 'tenants.' + selected;
  editor.append(el('h3', 'Merchant configuration'));
  const fields = el('div', undefined, 'fleet-editor-grid');
  fields.append(
    field('Merchant ID', tenant.id, prefix + '.id', value => { tenant.id = value; renderMerchantList(); },
      { hint: 'A distinct lowercase ID, 2–40 characters.', maxLength: 40 }),
    field('Public host', tenant.host, prefix + '.host', value => { tenant.host = value; renderMerchantList(); },
      { hint: 'Match the prepared source’s HTTPS origin. Enter only the DNS host.', placeholder: 'data.example.com', maxLength: 253 }),
    field('Initial release ID', tenant.releaseId, prefix + '.releaseId', value => { tenant.releaseId = value; },
      { hint: 'An original release ID for the first slot.', maxLength: 64 }),
    field('Release label', tenant.label, prefix + '.label', value => { tenant.label = value; },
      { hint: 'Optional description retained with the initial release.', maxLength: 240 }),
  );
  editor.append(fields);
  const actions = el('div', undefined, 'setup-actions');
  const move = direction => {
    const target = selected + direction;
    [draft.tenants[selected], draft.tenants[target]] = [draft.tenants[target], draft.tenants[selected]];
    selected = target; renderMerchants(); clearErrors();
  };
  actions.append(button('Move up', () => move(-1), { disabled: selected === 0 }),
    button('Move down', () => move(1), { disabled: selected === draft.tenants.length - 1 }),
    button('Duplicate merchant', () => {
      const copy = structuredClone(tenant); copy.id = uniqueName(tenant.id + '-copy', draft.tenants.map(row => row.id));
      copy.host = ''; draft.tenants.splice(selected + 1, 0, copy); selected++; renderMerchants(); clearErrors();
      status('Merchant duplicated. Set its public host and corresponding prepared source paths.');
    }, { disabled: draft.tenants.length >= 32 }),
    button('Remove merchant', () => { draft.tenants.splice(selected, 1); renderMerchants(); clearErrors(); },
      { disabled: draft.tenants.length <= 2 }));
  editor.append(actions);
  const sourceSection = el('section'); sourceSection.append(el('h3', 'Registered source packages'),
    el('p', 'Aliases let the original operator select current and later packages without accepting new filesystem paths from its clients.', 'hint'));
  const sourceList = el('div', undefined, 'fleet-source-list');
  tenant.sources.forEach((source, index) => sourceList.append(sourceCard(tenant, source, index, prefix)));
  sourceSection.append(sourceList, button('Add source package', () => {
    const name = uniqueName('next', tenant.sources.map(row => row.name));
    tenant.sources.push(newFleetSource(name, tenant.sources[0]?.kind ?? 'workspace')); renderMerchants(); clearErrors();
  }, { id: 'fleet-add-source', disabled: tenant.sources.length >= 32 }));
  sourceSection.append(field('Package for the initial release', tenant.initialPackage, prefix + '.initialPackage',
    value => { tenant.initialPackage = value; }, { options: tenant.sources.map(row => [row.name, row.name || '(unnamed source)']),
      hint: 'Setup stages and selects this package in the first declared slot.' }));
  editor.append(sourceSection);
  const limits = el('details'); limits.className = 'fleet-fields'; limits.append(el('summary', 'Gateway limits'));
  const limitFields = el('div', undefined, 'fleet-editor-grid');
  const labels = { maxInFlight: 'Concurrent requests', maxRequestBytes: 'Maximum request bytes',
    maxResponseBytes: 'Maximum response bytes', timeoutMs: 'Request timeout (milliseconds)' };
  const defaults = { maxInFlight: 12, maxRequestBytes: 1048576, maxResponseBytes: 8388608, timeoutMs: 15000 };
  for (const [key, [min, max]] of Object.entries(LIMIT_RANGES)) {
    limitFields.append(field(labels[key], tenant.limits?.[key], prefix + '.limits.' + key,
      value => { (tenant.limits ??= {})[key] = value; }, { type: 'number', min, max,
        placeholder: String(defaults[key]), hint: `Leave blank for the native default of ${defaults[key]}.` }));
  }
  limits.append(limitFields); editor.append(limits);
}
function sourceCard(tenant, source, index, prefix) {
  const card = el('section', undefined, 'fleet-source-card'), key = prefix + '.sources.' + index;
  const heading = el('div', undefined, 'fleet-source-heading');
  heading.append(el('h4', 'Source ' + (index + 1)), button('Remove source', () => {
    tenant.sources.splice(index, 1);
    if (tenant.initialPackage === source.name) tenant.initialPackage = tenant.sources[0]?.name ?? '';
    renderMerchants(); clearErrors();
  }, { disabled: tenant.sources.length <= 1 }));
  card.append(heading);
  const sourceFile = el('input'); sourceFile.type = 'file'; sourceFile.accept = '.json,application/json'; sourceFile.hidden = true;
  const importButton = button('Import source JSON', () => sourceFile.click());
  if (source.kind === 'postgresPackage') importButton.dataset.field = key + '.postgresInputManifestSha256';
  sourceFile.addEventListener('change', async () => {
    const file = sourceFile.files?.[0]; if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw Error('Choose an original source JSON file of at most 1 MiB.');
      const imported = importFleetSource(await file.text(), source.name);
      const position = tenant.sources.indexOf(source);
      if (position < 0) throw Error('This source was removed. Import into the intended source card.');
      tenant.sources[position] = imported; renderMerchants(); clearErrors();
      status(`Imported ${SOURCE_LABELS[imported.kind]} source into ${tenant.id} / ${imported.name}. Review its host path and runtime before exporting the fleet.`);
    } catch (error) { status(error.message); }
    finally { sourceFile.value = ''; }
  });
  const importActions = el('div', undefined, 'setup-actions'); importActions.append(importButton, sourceFile);
  card.append(importActions);
  const fields = el('div', undefined, 'fleet-editor-grid');
  fields.append(field('Package alias', source.name, key + '.name', value => {
    const old = source.name; source.name = value;
    if (tenant.initialPackage === old) tenant.initialPackage = value;
    const select = document.querySelector('[data-field="' + prefix + '.initialPackage"]');
    if (select) {
      select.replaceChildren(...tenant.sources.map(row => { const option = el('option', row.name || '(unnamed source)'); option.value = row.name; return option; }));
      select.value = tenant.initialPackage;
    }
  }, { maxLength: 40, hint: 'A lowercase alias such as current or next.' }),
  field('Source type', source.kind, key + '.kind', value => {
    source.kind = value;
    if (value !== 'python') source.pythonRoot = '';
    if (value !== 'duckdbPackage') source.duckdbPython = '';
    if (value !== 'sqlitePackage') for (const key of Object.keys(SQLITE_SNAPSHOT_OPTIONS)) delete source[key];
    if (value !== 'postgresPackage') delete source.postgresInputManifestSha256;
    if (!['workspace', 'jsonrpcPackage'].includes(value)) delete source.allowLoopbackUpstream;
    renderMerchants();
  }, { options: Object.entries(SOURCE_LABELS) }));
  const labels = { workspace: 'API workspace directory', python: 'Python application description',
    duckdbPackage: 'Prepared DuckDB package directory', s3Package: 'Configured S3 package directory',
    jsonrpcPackage: 'Prepared Stellar RPC package directory',
    sqlitePackage: 'SQLite workbench export directory', mysqlPackage: 'Prepared MySQL package directory',
    postgresPackage: 'Prepared PostgreSQL package directory' };
  fields.append(field(labels[source.kind] ?? 'Source path', source.path, key + '.path', value => { source.path = value; },
    { hint: 'A host path. Relative paths resolve from fleet-setup.json.', maxLength: 4096, placeholder: '../packages/merchant-current' }));
  if (source.kind === 'python') fields.append(field('Python source root', source.pythonRoot, key + '.pythonRoot',
    value => { source.pythonRoot = value; }, { hint: 'Optional. Otherwise the original application description directory is used.', maxLength: 4096 }));
  if (source.kind === 'duckdbPackage') fields.append(field('DuckDB Python interpreter', source.duckdbPython, key + '.duckdbPython',
    value => { source.duckdbPython = value; }, { hint: 'Optional interpreter path for the original DuckDB runtime.', maxLength: 4096 }));
  if (source.kind === 'sqlitePackage') {
    const labels = { sqliteSnapshotMaxBytes: 'Maximum snapshot bytes',
      sqliteSnapshotTimeoutMs: 'Snapshot timeout (milliseconds)' };
    for (const [name, limits] of Object.entries(SQLITE_SNAPSHOT_OPTIONS))
      fields.append(field(labels[name], source[name], key + '.' + name, value => { source[name] = value; },
        { type: 'number', min: limits.min, max: limits.max, placeholder: String(limits.default),
          hint: `Leave blank for the native default of ${limits.default}. Applies when staging this source.` }));
  }
  fields.append(field('Facilitator URL', source.facilitator, key + '.facilitator', value => { source.facilitator = value; },
    { hint: 'Optional explicit runtime endpoint. Use the merchant’s configured facilitator.', placeholder: 'https://facilitator.example.com', maxLength: 4096 }));
  card.append(fields);
  if (source.kind === 'sqlitePackage') card.append(el('p',
    'Staging captures the committed SQLite data, including committed WAL changes, into the retained release. Later database changes appear in the next staged release.', 'hint'));
  if (source.kind === 'mysqlPackage') card.append(el('p',
    'The prepared package retains named queries, payment terms and connection environment references. Running releases read the live MySQL or MariaDB database using credentials on the merchant host.', 'hint'));
  if (source.kind === 'postgresPackage') {
    card.append(el('p', 'Staging retains the original PostgreSQL named queries, payment terms, connection policy and selected database CA. Running releases read the live database using the configured environment references on the merchant host.', 'hint'));
    if (validPostgresInputManifest(source.postgresInputManifestSha256)) {
      const review = el('details', undefined, 'fleet-fields');
      review.append(el('summary', 'Reviewed PostgreSQL package'),
        el('p', 'The original stage compares this manifest with the selected package before retaining it. A changed package needs a fresh native review and source download.', 'hint'),
        el('pre', source.postgresInputManifestSha256, 'fleet-command'));
      card.append(review);
    } else card.append(el('p', 'Review the prepared package in the original PostgreSQL workspace or Seller releases, download its fleet source, then import it here to keep that review attached.', 'hint'));
  }
  const runtime = el('div', undefined, 'fleet-runtime-options');
  runtime.append(check('Allow a local facilitator on this host', source.allowLocalFacilitator, key + '.allowLocalFacilitator',
    value => { source.allowLocalFacilitator = value; }));
  if (['workspace', 'jsonrpcPackage'].includes(source.kind)) runtime.append(check('Allow declared loopback upstreams', source.allowLoopbackUpstream,
    key + '.allowLoopbackUpstream', value => { source.allowLoopbackUpstream = value; }));
  card.append(runtime); return card;
}
function renderReview() {
  const review = $('fleet-review-content'), result = validateFleetDraft(draft); review.replaceChildren();
  $('fleet-download-packet').disabled = !result.valid;
  if (!result.valid) { review.append(el('p', 'Complete the listed setup fields to review the native launch packet.')); showErrors(result.errors); return; }
  clearErrors();
  review.append(el('h3', `${draft.tenants.length} merchants · ${result.assignments.length} retained stores`),
    el('p', `Ingress ${result.declaration.gateway.port} · Control ${result.declaration.gateway.adminPort} · Workspace ${result.workspacePort || 'automatic port'}`, 'mono'),
    el('p', 'Fleet directory: ' + draft.directory, 'fleet-path'), el('p', 'Published plan: ' + result.planFile, 'fleet-path'));
  const wrap = el('div', undefined, 'fleet-table-wrap'), table = el('table'), head = el('thead'), header = el('tr');
  for (const label of ['Merchant', 'Public host', 'Slot', 'Port', 'Initial release']) { const th = el('th', label); th.scope = 'col'; header.append(th); }
  head.append(header); table.append(head); const body = el('tbody');
  for (const row of result.assignments) {
    const tr = el('tr'), tenant = result.declaration.tenants.find(value => value.id === row.tenant);
    for (const value of [row.tenant, row.host, row.slot, row.port, row.startup ? `${tenant.initial.releaseId} ← ${tenant.initial.package}` : 'Available slot']) tr.append(el('td', value));
    body.append(tr);
  }
  table.append(body); wrap.append(table); review.append(wrap);
  for (const tenant of result.declaration.tenants) {
    const details = el('details');
    details.append(el('summary', tenant.id + ': registered sources and limits'));
    for (const [name, native] of Object.entries(tenant.packages)) {
      const kind = Object.keys(SOURCE_LABELS).find(key => Object.hasOwn(native, key));
      details.append(el('h4', `${name} · ${SOURCE_LABELS[kind]}`), el('pre', JSON.stringify(native, null, 2), 'fleet-command'));
    }
    details.append(el('p', Object.keys(tenant.limits ?? {}).length ? 'Gateway limits: ' + JSON.stringify(tenant.limits) : 'Uses the original gateway limits.'));
    review.append(details);
  }
  review.append(el('h3', 'Launch commands'), el('p', 'Run setup from the extracted packet folder on your merchant host. Then choose a foreground interface; close it before opening another interface with the same fleet directory.'));
  for (const command of fleetCommands(draft, result)) {
    const section = el('section', undefined, 'run-step'); section.dataset.command = command.id;
    section.append(el('h4', command.title), el('pre', commandText(command), 'fleet-command'),
      button('Copy command', async () => {
        try { await navigator.clipboard.writeText(commandText(command)); status(command.title + ' copied.'); }
        catch { status('Select and copy the displayed command, or use commands.json in the downloaded packet.'); }
      }));
    review.append(section);
  }
  const declaration = el('details'); declaration.append(el('summary', 'Original native setup declaration'),
    el('pre', JSON.stringify(result.declaration, null, 2), 'fleet-command')); review.append(declaration);
}
function showStep(next, { focus = true } = {}) {
  step = next;
  for (const [index, id] of panes.entries()) $(id).hidden = index !== step;
  document.querySelectorAll('[data-fleet-step]').forEach(node => {
    if (Number(node.dataset.fleetStep) === step) node.setAttribute('aria-current', 'step');
    else node.removeAttribute('aria-current');
  });
  $('fleet-back').hidden = step === 0; $('fleet-next').hidden = step === 2;
  $('fleet-next').textContent = step === 0 ? 'Merchants →' : 'Review and launch →';
  if (step === 1) renderMerchants();
  if (step === 2) renderReview();
  if (focus) $(headings[step]).focus();
}
function download(name, data, mime) {
  const url = URL.createObjectURL(new Blob([data], { type: mime })), link = el('a');
  link.href = url; link.download = name; link.hidden = true; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
for (const [key, id] of Object.entries(hostFields)) {
  $(id).dataset.field = key;
  $(id).addEventListener('input', () => { draft[key] = $(id).value; clearErrors(); });
}
$('fleet-add-merchant').addEventListener('click', () => {
  draft.tenants.push(newFleetTenant(uniqueName('merchant', draft.tenants.map(row => row.id))));
  selected = draft.tenants.length - 1; renderMerchants(); clearErrors();
});
$('fleet-back').addEventListener('click', () => showStep(Math.max(0, step - 1)));
$('fleet-next').addEventListener('click', () => showStep(Math.min(2, step + 1)));
document.querySelectorAll('[data-fleet-step]').forEach(node => node.addEventListener('click', () => showStep(Number(node.dataset.fleetStep))));
$('fleet-import-draft').addEventListener('click', () => $('fleet-file-input').click());
$('fleet-file-input').addEventListener('change', async event => {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('Choose a JSON setup file of at most 2 MiB.');
    draft = importFleetDraft(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
    selected = 0; renderHost(); renderMerchants(); clearErrors(); showStep(0);
    status('Setup opened. Review the host paths, merchant sources and initial releases.');
  } catch (error) { showErrors(error.errors ?? [{ field: 'setup', message: error.message }]); status(''); }
});
$('fleet-download-draft').addEventListener('click', () => {
  download('fleet-setup-draft.json', JSON.stringify(draft, null, 2) + '\n', 'application/json');
  status('Editable fleet draft downloaded.');
});
$('fleet-download-packet').addEventListener('click', () => {
  try {
    const packet = createFleetPacket(draft);
    download(packet.folder + '.zip', zipWorkspace(packet.files), 'application/zip');
    status('Launch packet downloaded. Its README includes the native setup, recovery and interface handoff commands.');
  } catch (error) { showErrors(error.errors ?? [{ field: 'setup', message: error.message }]); }
});
renderHost(); renderMerchants(); showStep(0, { focus: false });
