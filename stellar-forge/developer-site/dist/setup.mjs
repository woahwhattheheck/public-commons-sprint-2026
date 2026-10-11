import {
  DEFAULT_STARTER, DEFAULT_RESOURCE, SOURCE_CONTRACT, createDatasetWorkspace,
  validateWorkspaceInput, importDatasetConfig, importWorkspaceDraft, zipWorkspace,
  usesSharedPayment, paymentChoicesForResource,
} from './onboarding.mjs';
import { createPaymentEditor } from './payment-editor.mjs';
import { listDrafts, loadDraft, saveDraft, deleteDraft } from './drafts.mjs';

const host = document.getElementById('merchant-setup');
const encoder = new TextEncoder();
const $ = id => document.getElementById(id);
const clone = value => structuredClone(value);
const sharedFields = ['folder', 'network', 'asset', 'payTo', 'amount', 'maxTimeoutSeconds'];
const resourceFields = ['id', 'path', 'serviceName', 'description', 'tags', 'amount', 'dataText'];
let input = clone(DEFAULT_STARTER);
let selectedResource = 0;
let activeStep = 0;
let draftRef = { id: null, revision: 0 };
let dirty = false;
let editVersion = 0;
let saving = false;
let generated = null;
let generatedVersion = -1;
let errorsShown = false;
let previewTimer;
let paymentEditor;
const labels = ['Resources', 'Payment terms', 'Review files', 'Run locally'];
const resourceLabel = name => `resource-${name}`;

// UI structure is fixed. Imported names, paths, data and errors enter through textContent/value only.
host.innerHTML = `
<div class="setup-shell">
  <div class="setup-top">
    <div class="setup-title"><strong id="workspace-title">merchant</strong><span id="draft-state" class="mono">NEW DRAFT</span></div>
    <div class="setup-actions">
      <button id="new-draft" class="text-button" type="button">New</button>
      <button id="import-draft" class="text-button" type="button">Import</button>
      <button id="open-drafts" class="button small" type="button" aria-expanded="false" aria-controls="saved-drafts">Saved drafts</button>
      <button id="save-draft" class="button small" type="button">Save draft</button>
    </div>
  </div>
  <div id="saved-drafts" class="drafts-panel" hidden>
    <div class="drafts-heading"><h3>Saved in this browser</h3><button id="close-drafts" class="text-button" type="button">Close</button></div>
    <p class="pane-intro">Save revisions here, or download a draft JSON to move it to another browser.</p>
    <div id="draft-list"></div>
  </div>
  <div id="import-panel" class="drafts-panel" hidden>
    <div class="drafts-heading"><h3>Open existing configuration</h3><button id="close-import" class="text-button" type="button">Close</button></div>
    <p class="pane-intro">Choose an exported starter-input.json, or an original seller.json with its JSON data files. A supported seller import retains the original route metadata. Resources with missing data remain editable.</p>
    <div class="setup-actions"><button id="choose-draft-json" class="button small" type="button">Import draft JSON</button><button id="choose-seller-json" class="button small" type="button">Import seller + data files</button><button id="choose-seller-folder" class="text-button" type="button">Choose workspace folder</button></div>
  </div>
  <p id="workspace-status" class="setup-status" role="status" hidden></p>
  <div id="workspace-errors" class="setup-errors" role="alert" hidden><h3>Review these fields</h3><ul id="workspace-error-list"></ul></div>
  <nav class="setup-tabs" aria-label="Workspace setup steps">
    <button type="button" data-setup-step="0" aria-controls="setup-resources" aria-current="step"><span>01</span>Resources</button>
    <button type="button" data-setup-step="1" aria-controls="setup-terms"><span>02</span>Payment terms</button>
    <button type="button" data-setup-step="2" aria-controls="setup-review"><span>03</span>Review files</button>
    <button type="button" data-setup-step="3" aria-controls="setup-run"><span>04</span>Run locally</button>
  </nav>
  <section id="setup-resources" class="setup-pane" aria-labelledby="resources-heading">
    <h3 id="resources-heading">Choose the resources this merchant will serve.</h3>
    <p class="pane-intro">Each resource has a static GET route, a JSON file and complete exact payment terms. The original seller loads these files when it starts.</p>
    <div class="resource-grid">
      <aside class="resource-sidebar"><span class="small-label" id="resource-count">RESOURCES / 1</span><div class="resource-list" id="resource-list"></div><button id="add-resource" class="button small" type="button">Add resource +</button><p>Up to 64 resources. Each data file can contain up to 1 MiB of JSON.</p></aside>
      <div class="resource-editor">
        <div class="field-grid">
          <div class="field"><label for="resource-id">Resource ID</label><input id="resource-id" maxlength="64" autocomplete="off" spellcheck="false" aria-describedby="resource-id-error"><p id="resource-id-error" class="field-error" hidden></p></div>
          <div class="field"><label for="resource-path">Request path</label><input id="resource-path" autocomplete="off" spellcheck="false" aria-describedby="resource-path-error"><p id="resource-path-error" class="field-error" hidden></p></div>
          <div class="field"><label for="resource-serviceName">Service name</label><input id="resource-serviceName" maxlength="32" autocomplete="off" aria-describedby="resource-serviceName-error"><p id="resource-serviceName-error" class="field-error" hidden></p></div>
          <div class="field"><label for="resource-amount">Price in atomic units</label><input id="resource-amount" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="Use shared default" aria-describedby="resource-amount-hint resource-amount-error"><p id="resource-amount-hint" class="hint">Leave blank to use the shared default.</p><button id="resource-payment-terms" class="text-button" type="button">Edit payment choices →</button><p id="resource-amount-error" class="field-error" hidden></p></div>
          <div class="field full"><label for="resource-description">Description</label><input id="resource-description" maxlength="2048" autocomplete="off" aria-describedby="resource-description-error"><p id="resource-description-error" class="field-error" hidden></p></div>
          <div class="field full"><label for="resource-tags">Tags</label><input id="resource-tags" autocomplete="off" placeholder="dataset, weather" aria-describedby="resource-tags-hint resource-tags-error"><p id="resource-tags-hint" class="hint">Up to five comma-separated tags.</p><p id="resource-tags-error" class="field-error" hidden></p></div>
          <div class="field full"><div class="field-row"><label for="resource-dataText">JSON data</label><div class="data-tools"><button id="load-data" class="text-button" type="button">Choose JSON file</button><button id="example-data" class="text-button" type="button">Load example</button></div></div><textarea id="resource-dataText" class="code-input" spellcheck="false" aria-describedby="resource-dataText-error"></textarea><p id="resource-dataText-error" class="field-error" hidden></p></div>
        </div>
        <div class="preview-bar"><span id="data-summary" class="mono"></span><span>Original JSON text retained</span></div>
        <div class="editor-foot"><span id="resource-binding" class="small-label"></span><button id="remove-resource" class="text-button" type="button">Remove resource</button></div>
      </div>
    </div>
  </section>
  <section id="setup-terms" class="setup-pane" aria-labelledby="terms-heading" hidden>
    <h3 id="terms-heading">Keep each resource's complete payment choices.</h3><p class="pane-intro">Add and order 1–16 native choices per route. Each choice keeps its own network, asset, public recipient, exact atomic amount, timeout and optional JSON metadata.</p>
    <div id="route-payment-editor"></div>
    <details id="workspace-defaults" class="workspace-defaults"><summary>Workspace directory and payment defaults</summary>
    <p class="pane-intro">Defaults apply to resources marked “Use workspace defaults.” New resources start with them. Imported route choices remain independent.</p>
    <div class="field-grid terms-grid">
      <div class="field"><label for="shared-folder">Workspace directory</label><input id="shared-folder" maxlength="64" autocomplete="off" spellcheck="false" aria-describedby="shared-folder-error"><p id="shared-folder-error" class="field-error" hidden></p></div>
      <div class="field"><label for="shared-network">Network</label><select id="shared-network" aria-describedby="shared-network-error"><option value="stellar:testnet">Stellar testnet</option><option value="stellar:pubnet">Stellar public network</option></select><p id="shared-network-error" class="field-error" hidden></p></div>
      <div class="field full"><label for="shared-asset">Asset contract</label><input id="shared-asset" maxlength="128" autocomplete="off" spellcheck="false" aria-describedby="shared-asset-error"><p id="shared-asset-error" class="field-error" hidden></p></div>
      <div class="field full"><label for="shared-payTo">Public recipient</label><input id="shared-payTo" maxlength="128" autocomplete="off" spellcheck="false" aria-describedby="shared-payTo-error"><p id="shared-payTo-error" class="field-error" hidden></p></div>
      <div class="field"><label for="shared-amount">Default price in atomic units</label><input id="shared-amount" inputmode="numeric" autocomplete="off" spellcheck="false" aria-describedby="shared-amount-hint shared-amount-error"><p id="shared-amount-hint" class="hint">A whole-number decimal string. No currency conversion is applied.</p><p id="shared-amount-error" class="field-error" hidden></p></div>
      <div class="field"><label for="shared-maxTimeoutSeconds">Payment timeout in seconds</label><input id="shared-maxTimeoutSeconds" inputmode="numeric" autocomplete="off" aria-describedby="shared-maxTimeoutSeconds-error"><p id="shared-maxTimeoutSeconds-error" class="field-error" hidden></p></div>
    </div>
    <div id="example-terms-note" class="setup-notice">The starting asset and recipient are example values for local setup. Replace them with the merchant's public identifiers when configuring native payments.</div>
    </details>
    <p class="setup-notice">The generated launch command starts the original seller in <strong>challenge-only mode</strong>. Native payment setup is described in the run instructions and remains part of the original toolkit.</p>
  </section>
  <section id="setup-review" class="setup-pane" aria-labelledby="review-heading" hidden>
    <h3 id="review-heading">Review the complete workspace.</h3><p class="pane-intro">The ZIP contains ordinary editable files. Its seller configuration and workspace descriptor are consumed by the original Starforge runtime.</p>
    <div id="review-content"></div>
  </section>
  <section id="setup-run" class="setup-pane" aria-labelledby="run-heading" hidden>
    <h3 id="run-heading">Take this workspace into the original runtime.</h3><p class="pane-intro">Run from the application directory containing the extracted workspace. The workspace is already initialized.</p>
    <div id="run-content"></div>
  </section>
  <div class="setup-footer"><span class="small-label" id="setup-footnote">DRAFTS SAVE ONLY WHEN YOU CHOOSE SAVE. EXPORTS INCLUDE YOUR DATA.</span><button id="setup-next" class="button primary" type="button">Payment terms →</button></div>
</div>
<input id="data-file-input" type="file" accept=".json,application/json" hidden>
<input id="draft-file-input" type="file" accept=".json,application/json" hidden>
<input id="seller-file-input" type="file" accept=".json,application/json" multiple hidden>
<input id="seller-folder-input" type="file" webkitdirectory multiple hidden>
`;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function button(text, action, className = 'button small') {
  const node = el('button', text, className); node.type = 'button'; node.addEventListener('click', action); return node;
}
function link(text, url) {
  const node = el('a', text); node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node;
}
function setStatus(text) { $('workspace-status').textContent = text; $('workspace-status').hidden = !text; }
function reportError(error) {
  if (error?.errors) { errorsShown = true; showErrors(error.errors); }
  else setStatus(error?.message || 'The action could not finish. Your current draft is still open.');
}
function updateTitle() {
  $('workspace-title').textContent = input.folder || 'Untitled merchant';
  $('draft-state').textContent = dirty ? 'UNSAVED CHANGES' : draftRef.id ? `SAVED / REVISION ${draftRef.revision}` : 'NEW DRAFT';
  $('save-draft').textContent = saving ? 'Saving…' : 'Save draft';
  $('save-draft').disabled = saving;
  ['new-draft', 'import-draft', 'open-drafts'].forEach(id => { $(id).disabled = saving; });
}
function changed() {
  dirty = true; editVersion++; generated = null; updateTitle();
  if (errorsShown) showErrors(validateWorkspaceInput(input).errors);
}
function renderResourceList() {
  $('resource-count').textContent = `RESOURCES / ${input.resources.length}`;
  $('add-resource').disabled = input.resources.length >= 64;
  $('resource-list').replaceChildren(...input.resources.map((resource, index) => {
    const node = button('', () => selectResource(index), 'resource-button');
    node.setAttribute('aria-pressed', String(index === selectedResource));
    node.append(el('strong', resource.serviceName || resource.id || `Resource ${index + 1}`), el('code', `GET ${resource.path || '/…'}`));
    return node;
  }));
}
function selectResource(index) {
  selectedResource = Math.min(Math.max(0, index), input.resources.length - 1);
  const resource = input.resources[selectedResource];
  for (const name of resourceFields) {
    const value = resource[name];
    $(resourceLabel(name)).value = name === 'tags' && Array.isArray(value) ? value.join(', ') : typeof value === 'string' || typeof value === 'number' ? value : '';
  }
  $('remove-resource').disabled = input.resources.length === 1;
  renderResourceList(); renderDataSummary(); renderResourcePayment(); paymentEditor?.render();
  if (errorsShown) showErrors(validateWorkspaceInput(input).errors);
}
function renderResourcePayment() {
  const resource = input.resources[selectedResource], shared = usesSharedPayment(resource);
  const choices = paymentChoicesForResource(input, resource);
  $('resource-amount').disabled = !shared;
  $('resource-amount').value = shared ? resource.amount ?? '' : choices[0]?.amount ?? '';
  $('resource-amount-hint').textContent = shared ? 'Leave blank to use the shared default.' : choices.length + ' independent payment choice' + (choices.length === 1 ? '' : 's') + '. Edit the complete terms in Payment terms.';
}
function renderDataSummary() {
  const resource = input.resources[selectedResource];
  const text = typeof resource.dataText === 'string' ? resource.dataText : '';
  let shape = 'JSON needs attention';
  try {
    const value = JSON.parse(text.replace(/^\uFEFF/, ''));
    shape = Array.isArray(value) ? `${value.length.toLocaleString()} array items` : value && typeof value === 'object' ? `${Object.keys(value).length} object fields` : `JSON ${value === null ? 'null' : typeof value}`;
  } catch { /* Keep editable input and its exact original text. */ }
  $('data-summary').textContent = `${encoder.encode(text).length.toLocaleString()} bytes · ${shape}`;
  $('resource-binding').textContent = `GET ${resource.path || '/…'} → data/${resource.id || 'resource'}.json`;
}
function renderSharedFields() {
  for (const name of sharedFields) $('shared-' + name).value = typeof input[name] === 'string' || typeof input[name] === 'number' ? input[name] : '';
  updateExampleNote();
}
function updateExampleNote() {
  $('example-terms-note').hidden = input.asset !== 'UNVERIFIED_DEMO_ASSET' && input.payTo !== 'UNVERIFIED_DEMO_RECIPIENT';
}
function focusField(field) {
  if (/^resources\.\d+\.paymentOptions/.test(field)) { activateStep(1, false); paymentEditor.focus(field); return; }
  const match = /^resources\.(\d+)\.(\w+)$/.exec(field);
  if (match) {
    activateStep(0, false); selectResource(Number(match[1]));
    $(resourceLabel(match[2]))?.focus();
  } else if (sharedFields.includes(field)) {
    activateStep(1, false); $('workspace-defaults').open = true; $('shared-' + field)?.focus();
  } else { activateStep(0, false); $('resources-heading').scrollIntoView({ block: 'center' }); }
}
function showErrors(errors) {
  paymentEditor?.showErrors(errors);
  $('workspace-errors').hidden = errors.length === 0;
  $('workspace-error-list').replaceChildren(...errors.map(error => {
    const row = el('li'); row.append(button(error.message, () => focusField(error.field), '')); return row;
  }));
  for (const name of resourceFields) {
    const found = errors.find(error => error.field === `resources.${selectedResource}.${name}`);
    const control = $(resourceLabel(name)), message = $(resourceLabel(name) + '-error');
    control.setAttribute('aria-invalid', String(Boolean(found))); message.hidden = !found; message.textContent = found?.message || '';
  }
  for (const name of sharedFields) {
    const found = errors.find(error => error.field === name);
    $('shared-' + name).setAttribute('aria-invalid', String(Boolean(found)));
    $('shared-' + name + '-error').hidden = !found;
    $('shared-' + name + '-error').textContent = found?.message || '';
  }
}
function getGenerated() {
  if (generated && generatedVersion === editVersion) return generated;
  generated = createDatasetWorkspace(input); generatedVersion = editVersion; return generated;
}
function download(content, name, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
function exportDraft() {
  const draft = { ...clone(input), schema: SOURCE_CONTRACT.draftSchema };
  download(JSON.stringify(draft, null, 2) + '\n', `${safeName(input.folder)}-starter-input.json`, 'application/json');
  setStatus('Editable draft JSON downloaded. Import it here to reopen the same resources and terms.');
}
function safeName(value) { return String(value || 'merchant').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'merchant'; }
function exportWorkspace() {
  try {
    const result = getGenerated();
    download(zipWorkspace(result.files), `${safeName(result.summary.folder)}-workspace.zip`, 'application/zip');
    setStatus(`Downloaded ${result.summary.resourceCount} resources, seller.json, workspace.json, the editable draft and launch instructions.`);
  } catch (error) { reportError(error); }
}
function renderReview() {
  const container = $('review-content'); container.replaceChildren();
  let result;
  try { result = getGenerated(); showErrors([]); }
  catch (error) {
    errorsShown = true; reportError(error);
    container.append(el('p', 'Complete the fields listed above to create a runnable workspace. You can still save or download the editable draft.', 'setup-notice'), button('Download editable draft', exportDraft));
    return;
  }
  const summary = el('div', undefined, 'review-summary');
  for (const [label, value] of [['RESOURCES / CHOICES', result.summary.resourceCount + ' / ' + result.summary.paymentChoiceCount], ['SOURCE DATA', `${result.summary.totalDataBytes.toLocaleString()} bytes`], ['NETWORKS', result.summary.networks.join(' · ')]]) {
    const box = el('div'); box.append(el('span', label, 'small-label'), el('strong', value)); summary.append(box);
  }
  const table = el('table'), head = el('thead'), headRow = el('tr');
  table.className = 'payment-review-table';
  for (const label of ['Resource / request', 'Choice', 'Network', 'Asset / recipient', 'Exact atomic amount', 'Timeout / extra']) headRow.append(el('th', label)); head.append(headRow);
  const body = el('tbody');
  for (const resource of result.summary.resources) for (const [index, choice] of resource.effectivePayments.entries()) {
    const row = el('tr'), route = el('td'), order = el('td'), network = el('td'), identifiers = el('td'), amount = el('td'), metadata = el('td');
    route.append(el('strong', resource.serviceName), el('code', 'GET ' + resource.path), el('small', resource.dataBytes.toLocaleString() + ' data bytes'));
    order.append(el('code', String(index + 1) + ' / ' + resource.effectivePayments.length));
    network.append(el('code', choice.network));
    identifiers.append(el('code', choice.asset), el('code', choice.payTo));
    amount.append(el('code', choice.amount));
    metadata.append(el('code', String(choice.maxTimeoutSeconds) + ' seconds'));
    if (Object.prototype.hasOwnProperty.call(choice, 'extra')) {
      const details = el('details'); details.append(el('summary', 'Extra JSON'), el('pre', JSON.stringify(choice.extra, null, 2))); metadata.append(details);
    }
    row.append(route, order, network, identifiers, amount, metadata); body.append(row);
  }
  table.append(head, body); const scroll = el('div', undefined, 'table-scroll'); scroll.append(table);
  const fileView = el('div', undefined, 'review-bottom'), fileList = el('div', undefined, 'file-list'), code = el('pre', undefined, 'file-code');
  code.tabIndex = 0; code.setAttribute('aria-label', 'Selected generated file');
  const selectFile = index => {
    const file = result.files[index]; code.textContent = file.content.length > 100000 ? file.content.slice(0, 100000) + '\n\n[Preview clipped. ZIP contains the complete original file.]' : file.content;
    Array.from(fileList.children).forEach((node, i) => node.setAttribute('aria-pressed', String(index === i)));
  };
  result.files.forEach((file, index) => fileList.append(button(file.path.replace(result.summary.folder + '/', ''), () => selectFile(index), '')));
  fileView.append(fileList, code); selectFile(0);
  const downloads = el('div', undefined, 'review-downloads');
  downloads.append(button('Download workspace ZIP ↓', exportWorkspace, 'button primary'), button('Download editable draft', exportDraft, 'text-button'));
  container.append(summary, scroll, fileView, downloads);
  if (result.summary.nonpayableExample) container.append(el('p', 'This workspace still uses example payment identifiers. Its launch command starts the original challenge-only seller.', 'setup-notice'));
}
function runStep(number, title, description, command) {
  const row = el('div', undefined, 'run-step'); row.append(el('span', String(number).padStart(2, '0'), 'run-number'));
  const content = el('div'); content.append(el('h4', title), el('p', description));
  if (command) {
    const pre = el('pre', command, 'command-block'); pre.tabIndex = 0;
    content.append(pre, button('Copy command', () => copyText(command, pre), 'text-button'));
  }
  row.append(content); return { row, content };
}
async function copyText(text, fallback) {
  try { await navigator.clipboard.writeText(text); setStatus('Command copied.'); }
  catch {
    const range = document.createRange(); range.selectNodeContents(fallback);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    setStatus('Command selected. Use your device copy action.');
  }
}
function renderRun() {
  const container = $('run-content'); container.replaceChildren();
  let result;
  try { result = getGenerated(); showErrors([]); }
  catch (error) { errorsShown = true; reportError(error); container.append(el('p', 'Finish the listed configuration fields, then return for the exact launch commands.', 'setup-notice')); return; }
  const getFiles = runStep(1, 'Download and extract the workspace', `Extract ${result.summary.folder}-workspace.zip into your application directory. Keep seller.json, workspace.json and the data directory together.`);
  getFiles.content.append(button('Download workspace ZIP ↓', exportWorkspace));
  const install = runStep(2, 'Install the original toolkit archive', 'Use Node.js 22.16 or later. Obtain the maintained local source archive, replace the archive path below, and run from the parent of your workspace.', result.commands.install);
  const installLinks = el('div', undefined, 'run-links'); installLinks.append(link('Distribution and archive instructions ↗', SOURCE_CONTRACT.distributionGuide)); install.content.append(installLinks);
  const start = runStep(3, 'Start this workspace', 'The original launcher prints a seller URL and an operations URL. Open the seller URL followed by /_seller/docs to inspect the live resources; open the operations URL for the running service.', result.commands.run);
  const inspect = runStep(4, 'Inspect the running seller', 'Use the actual seller URL printed at startup. An unpaid resource request receives HTTP 402 with all ordered choices for that route. Inspect its complete accepts array; the original buyer selects a compatible network/asset/payee. Stop with Ctrl-C and restart after changing a data file.', result.commands.inspect);
  const advanced = el('details', undefined, 'raw-details'); advanced.append(el('summary', 'Configure native payments and continue development'));
  advanced.append(el('p', 'Use the merchant’s actual public payment identifiers and facilitator endpoint. Install the documented native packages in the same application directory.'));
  const native = el('pre', result.commands.nativeDependencies + '\n\n' + result.commands.nativeRun, 'command-block'); native.tabIndex = 0; advanced.append(native);
  const links = el('div', undefined, 'run-links'); links.append(link('Native merchant guide ↗', SOURCE_CONTRACT.sellerGuide), link('Developer workspace ↗', SOURCE_CONTRACT.developerGuide), link('Portable release guide ↗', SOURCE_CONTRACT.releaseGuide)); advanced.append(links);
  container.append(getFiles.row, install.row, start.row, inspect.row, advanced);
}
function activateStep(step, focus = true) {
  activeStep = step;
  const panels = ['setup-resources', 'setup-terms', 'setup-review', 'setup-run'];
  panels.forEach((id, i) => { $(id).hidden = step !== i; });
  host.querySelectorAll('[data-setup-step]').forEach(node => {
    if (Number(node.dataset.setupStep) === step) node.setAttribute('aria-current', 'step'); else node.removeAttribute('aria-current');
  });
  if (step === 1) paymentEditor.render();
  if (step === 2) renderReview(); if (step === 3) renderRun();
  $('setup-next').textContent = step === 3 ? 'Review files ←' : labels[step + 1] + ' →';
  $('setup-footnote').textContent = step === 2 ? 'REVIEW THE GENERATED CONFIGURATION AND DATA BEFORE EXPORT.' : step === 3 ? 'RUN FROM THE PARENT OF THE EXTRACTED WORKSPACE.' : 'DRAFTS SAVE ONLY WHEN YOU CHOOSE SAVE. EXPORTS INCLUDE YOUR DATA.';
  if (focus) { const heading = $(panels[step]).querySelector('h3'); heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
}
function canReplace() { return !saving && (!dirty || confirm('Replace the unsaved draft currently open? Choose Cancel to save or download it first.')); }
function adoptInput(next, reference = { id: null, revision: 0 }, edited = true) {
  if (!next || typeof next !== 'object' || !Array.isArray(next.resources) || next.resources.length < 1 || next.resources.length > 64 || next.resources.some(resource => !resource || typeof resource !== 'object' || Array.isArray(resource))) throw new Error('The draft must contain 1–64 editable resource objects.');
  input = clone(next); selectedResource = 0; draftRef = reference; dirty = edited; editVersion++; generated = null; errorsShown = false;
  showErrors([]); selectResource(0); renderSharedFields(); updateTitle(); activateStep(0, false);
}
async function refreshDrafts() {
  const drafts = await listDrafts();
  $('draft-list').replaceChildren();
  if (!drafts.length) { $('draft-list').append(el('p', 'No saved drafts in this browser yet.', 'pane-intro')); return; }
  for (const draft of drafts) {
    const row = el('div', undefined, 'draft-row'), description = el('div'), actions = el('div', undefined, 'draft-row-actions');
    description.append(el('strong', draft.name), el('small', `${draft.resources} resources · revision ${draft.revision} · ${new Date(draft.updatedAt).toLocaleString()}`));
    actions.append(button('Open', async () => {
      if (!canReplace()) return;
      const openedVersion = editVersion;
      try { const record = await loadDraft(draft.id); if (editVersion !== openedVersion) throw new Error('The open draft changed while loading. Choose the saved draft again.'); if (!record) throw new Error('This draft was removed in another tab. Refresh saved drafts.'); adoptInput(record.input, { id: record.id, revision: record.revision }, false); setStatus(`Opened ${record.name}, revision ${record.revision}.`); toggleDrafts(false); } catch (error) { reportError(error); }
    }));
    actions.append(button('Delete', async () => {
      if (saving || !confirm(`Delete the saved draft “${draft.name}”? Any open copy remains editable.`)) return;
      try { await deleteDraft(draft.id, draft.revision); if (draftRef.id === draft.id) { draftRef = { id: null, revision: 0 }; dirty = true; updateTitle(); } await refreshDrafts(); setStatus('Saved draft deleted.'); } catch (error) { reportError(error); }
    }, 'text-button'));
    row.append(description, actions); $('draft-list').append(row);
  }
}
function toggleDrafts(open) { $('saved-drafts').hidden = !open; $('open-drafts').setAttribute('aria-expanded', String(open)); }
async function saveCurrentDraft(asNew = false) {
  if (saving) return;
  const before = editVersion, snapshot = clone(input), reference = asNew ? { id: null, revision: 0 } : { ...draftRef };
  saving = true; updateTitle();
  try {
    const record = await saveDraft({ ...reference, input: snapshot });
    draftRef = { id: record.id, revision: record.revision }; if (editVersion === before) dirty = false;
    setStatus(`Saved ${record.name}, revision ${record.revision}, in this browser.${dirty ? ' Newer edits are still unsaved.' : ''}`);
  } catch (error) {
    if (error.name === 'DraftConflictError') {
      setStatus(error.message);
      const saveCopy = button('Save current work as a new draft', () => saveCurrentDraft(true), 'text-button');
      $('workspace-status').append(document.createTextNode(' '), saveCopy);
    } else reportError(error);
  } finally { saving = false; updateTitle(); }
}
async function readJsonFile(file, maxBytes = 1024 * 1024) {
  if (file.size > maxBytes) throw new Error(`${file.name} is too large for this import (${maxBytes.toLocaleString()} bytes maximum).`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error(`${file.name} must be a UTF-8 JSON file.`); }
}
async function importSellerFiles(files) {
  if (!files.length || !canReplace()) return;
  if (files.length > 200) throw new Error('Select the seller configuration and its data files; this import accepts up to 200 files.');
  const sellerFile = files.find(file => file.name === 'seller.json') || files.find(file => file.name === 'service.json');
  if (!sellerFile) throw new Error('Include the original seller.json (or service.json) along with its data files.');
  const importVersion = editVersion;
  const sellerText = await readJsonFile(sellerFile), dataFiles = new Map(), names = new Map();
  const rootPrefix = sellerFile.webkitRelativePath ? sellerFile.webkitRelativePath.slice(0, -sellerFile.name.length) : '';
  for (const file of files) {
    if (file === sellerFile || !/\.json$/i.test(file.name)) continue;
    const text = await readJsonFile(file);
    const relative = file.webkitRelativePath && file.webkitRelativePath.startsWith(rootPrefix) ? file.webkitRelativePath.slice(rootPrefix.length) : '';
    if (relative) { dataFiles.set(relative, text); dataFiles.set('./' + relative, text); }
    if (!names.has(file.name)) names.set(file.name, text); else names.set(file.name, null);
  }
  let seller;
  try { seller = JSON.parse(sellerText.replace(/^\uFEFF/, '')); } catch { throw new Error('The seller configuration must be valid JSON.'); }
  for (const route of seller.routes || []) {
    if (typeof route?.responseFile !== 'string') continue;
    const filename = route.responseFile.replace(/\\/g, '/').split('/').pop();
    if (!dataFiles.has(route.responseFile) && names.get(filename) != null) dataFiles.set(route.responseFile, names.get(filename));
  }
  const imported = importDatasetConfig(seller, { dataFiles, folder: input.folder || 'merchant' });
  if (editVersion !== importVersion) throw new Error('The draft changed while files were loading. Import them again.');
  adoptInput(imported.input);
  $('import-panel').hidden = true;
  setStatus(imported.missingDataFiles.length ? `Imported ${imported.input.resources.length} resources. Choose data files for: ${imported.missingDataFiles.map(file => file.originalPath).join(', ')}.` : `Imported ${imported.input.resources.length} resources with their original metadata and source data.`);
}

for (const name of resourceFields) $(resourceLabel(name)).addEventListener('input', event => {
  input.resources[selectedResource][name] = event.target.value; changed();
  if (name === 'serviceName' || name === 'path') renderResourceList();
  clearTimeout(previewTimer); previewTimer = setTimeout(renderDataSummary, 120);
});
for (const name of sharedFields) $('shared-' + name).addEventListener('input', event => {
  input[name] = event.target.value; changed(); updateExampleNote(); renderResourcePayment(); paymentEditor.render();
});
host.querySelectorAll('[data-setup-step]').forEach(node => node.addEventListener('click', () => activateStep(Number(node.dataset.setupStep))));
$('resource-payment-terms').addEventListener('click', () => activateStep(1));
$('setup-next').addEventListener('click', () => activateStep(activeStep === 3 ? 2 : activeStep + 1));
$('add-resource').addEventListener('click', () => {
  if (input.resources.length >= 64) return;
  let count = input.resources.length + 1;
  while (input.resources.some(resource => resource.id === `resource-${count}` || resource.path === `/resource-${count}`)) count++;
  input.resources.push({ ...clone(DEFAULT_RESOURCE), id: `resource-${count}`, path: `/resource-${count}`, serviceName: `Resource ${count}`, amount: '', dataText: '{\n  "rows": []\n}\n' });
  changed(); selectResource(input.resources.length - 1); $('resource-serviceName').focus();
});
$('remove-resource').addEventListener('click', () => {
  if (input.resources.length <= 1) return;
  const resource = input.resources[selectedResource];
  if (!confirm(`Remove “${resource.serviceName || resource.id}” and its data from this draft?`)) return;
  input.resources.splice(selectedResource, 1); selectedResource = Math.min(selectedResource, input.resources.length - 1); changed(); selectResource(selectedResource);
});
$('example-data').addEventListener('click', () => {
  if (input.resources[selectedResource].dataText && !confirm('Replace this resource’s data with the example JSON?')) return;
  input.resources[selectedResource].dataText = DEFAULT_RESOURCE.dataText; changed(); selectResource(selectedResource);
});
$('load-data').addEventListener('click', () => $('data-file-input').click());
$('data-file-input').addEventListener('change', async event => {
  const file = event.target.files[0], index = selectedResource, resource = input.resources[index], loadVersion = editVersion; event.target.value = '';
  if (!file) return;
  try {
    const text = await readJsonFile(file);
    if (input.resources[index] !== resource || editVersion !== loadVersion) throw new Error('The selected resource changed while the file loaded. Choose the file again.');
    input.resources[index].dataText = text; changed(); if (selectedResource === index) selectResource(index); setStatus(`Loaded ${file.name} into ${resource.id}.`);
  } catch (error) { reportError(error); }
});
$('save-draft').addEventListener('click', () => saveCurrentDraft());
$('open-drafts').addEventListener('click', async () => { toggleDrafts(true); try { await refreshDrafts(); } catch (error) { reportError(error); } });
$('close-drafts').addEventListener('click', () => toggleDrafts(false));
$('new-draft').addEventListener('click', () => { if (canReplace()) { adoptInput(clone(DEFAULT_STARTER), { id: null, revision: 0 }, false); setStatus('Opened a new example workspace.'); } });
$('import-draft').addEventListener('click', () => { $('import-panel').hidden = !$('import-panel').hidden; });
$('close-import').addEventListener('click', () => { $('import-panel').hidden = true; });
$('choose-draft-json').addEventListener('click', () => $('draft-file-input').click());
$('choose-seller-json').addEventListener('click', () => $('seller-file-input').click());
$('choose-seller-folder').addEventListener('click', () => $('seller-folder-input').click());
$('draft-file-input').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file || !canReplace()) return;
  const importVersion = editVersion;
  try {
    const text = await readJsonFile(file, 70 * 1024 * 1024);
    if (editVersion !== importVersion) throw new Error('The draft changed while loading. Choose the file again.');
    adoptInput(importWorkspaceDraft(text)); $('import-panel').hidden = true; setStatus(`Opened ${file.name}. Save it here or review and download its workspace.`);
  } catch (error) { reportError(error); }
});
for (const id of ['seller-file-input', 'seller-folder-input']) $(id).addEventListener('change', async event => {
  const files = Array.from(event.target.files); event.target.value = '';
  try { await importSellerFiles(files); } catch (error) { reportError(error); }
});
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
paymentEditor = createPaymentEditor({
  root: $('route-payment-editor'), getInput: () => input, getResourceIndex: () => selectedResource,
  selectResource, onChange: () => { renderResourcePayment(); changed(); },
});
selectResource(0); renderSharedFields(); updateTitle();
