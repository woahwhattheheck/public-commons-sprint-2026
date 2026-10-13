// MIT. Complete setup snapshots and receiving for the original Applications editor.
import {
  SETUP_SCHEMA, receiveSetupDraft,
  parseSetupDocument, serializeSetupDocument, openApplicationSetupStore,
  reviewSetupReconciliation, applySetupReconciliation,
} from './application-setup.mjs';
import { FAMILY_SCHEMA, createSetupDocument, setupDocumentFamily as documentFamily } from './application-setup-codec.mjs';
const clone = value => JSON.parse(JSON.stringify(value));
const node = (tag, text, className) => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
};
const ensure = (condition, text) => { if (!condition) throw new Error(text); };
const field = (text, control) => { const result = node('label', text); result.append(control); return result; };
export function createApplicationSetupLibrary({
  root, getWorkspaceId, getCatalog, getRuntimes, readApplications,
  getFamily, receiveFamily, matches, applyReconciled, onNotice,
}) {
  let store = null, workspaceId = null, records = [], loaded = null, comparison = null, busy = false, generation = 0;
  const panel = node('details', undefined, 'application-setup-library');
  panel.append(node('summary', 'Complete setup snapshots and receiving'));
  panel.append(node('p', 'Keep named setups after this tab closes, receive a complete setup file, or compare edits against the current saved application.', 'note'));
  const notice = node('p', '', 'note'); notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  const name = node('input'); name.maxLength = 160; name.placeholder = 'For example: Merchant staging setup';
  const picker = node('select'); picker.append(new Option('No saved setup selected', ''));
  const buttons = node('div', undefined, 'actions');
  const receiveButtons = node('div', undefined, 'actions');
  const file = node('input'); file.type = 'file'; file.accept = '.json,application/json';
  const description = node('p', '', 'note');
  const compareRoot = node('section', undefined, 'application-setup-comparison'); compareRoot.hidden = true;
  const compareButton = action('Compare saved changes', prepareComparison);
  const save = action('Save complete setup in this browser', saveSnapshot);
  const exportCurrent = action('Download complete current setup', () => download(makeDocument(getFamily(), name.value)));
  const refresh = action('Refresh saved setups', () => listSnapshots(true));
  const reopen = action('Reopen selected setup', () => receive(false));
  const receiveCopy = action('Receive as new application', () => receive(true));
  const exportSelected = action('Download selected setup', () => { ensure(loaded, 'Choose a saved or imported setup.'); download(loaded); });
  const remove = action('Remove selected browser snapshot', removeSnapshot);
  buttons.append(save, exportCurrent, compareButton);
  receiveButtons.append(reopen, receiveCopy, exportSelected, remove, refresh);
  panel.append(field('Snapshot name', name), buttons, field('Saved setups in this workspace', picker),
    field('Import a complete setup or retained draft JSON file', file), description, receiveButtons, compareRoot, notice);
  root.replaceChildren(panel);
  function action(text, work) {
    const result = node('button', text); result.type = 'button';
    result.addEventListener('click', () => run(work)); return result;
  }
  async function run(work) {
    if (busy) return;
    const own = generation;
    busy = true; panel.setAttribute('aria-busy', 'true'); file.disabled = picker.disabled = true;
    try { await work(); } catch (error) {
      if (generation === own) { notice.textContent = error.message; onNotice(error.message); }
    } finally { busy = false; file.disabled = picker.disabled = false; panel.removeAttribute('aria-busy'); describe(); }
  }
  function database() { return store ??= openApplicationSetupStore(); }
  function makeDocument(family, title = '') {
    return createSetupDocument(family, title, { catalog: getCatalog(), runtimes: getRuntimes() });
  }
  async function listSnapshots(force = false) {
    const owner = getWorkspaceId();
    if (!owner || (!force && workspaceId === owner)) return;
    const own = generation;
    workspaceId = owner;
    const selected = picker.value;
    try {
      const next = await database().list(owner);
      if (generation !== own || getWorkspaceId() !== owner) return;
      workspaceId = owner; records = next;
      picker.replaceChildren(new Option(next.length ? 'Choose a complete setup' : 'No saved complete setups', ''),
        ...next.map(record => new Option((record.document.title || record.document.configuration.label || 'Application setup') +
          ' · ' + record.document.updatedAt.replace('T', ' ').slice(0, 19), record.document.id)));
      picker.value = next.some(record => record.document.id === selected) ? selected : '';
      if (picker.value) loaded = clone(next.find(record => record.document.id === picker.value).document);
      describe();
    } catch (error) {
      if (generation === own && getWorkspaceId() === owner) { workspaceId = owner; notice.textContent = error.message; }
    }
  }
  async function saveSnapshot() {
    const document = makeDocument(getFamily(), name.value), owner = document.workspaceId, own = generation;
    await database().put(document);
    if (generation !== own || getWorkspaceId() !== owner) return;
    await listSnapshots(true);
    picker.value = document.id; loaded = document;
    notice.textContent = 'Complete setup saved in this browser with all retained tool variants. Download its file to move it to another browser or host.';
  }
  function describe() {
    const sameWorkspace = loaded?.workspaceId === getWorkspaceId();
    reopen.disabled = !loaded || !sameWorkspace; receiveCopy.disabled = exportSelected.disabled = !loaded;
    remove.disabled = !loaded || !picker.value || !records.some(record => record.document.id === picker.value);
    description.textContent = loaded ? (loaded.title || loaded.configuration.label || 'Application setup') + ' · ' +
      loaded.originalDrafts.entries.length + ' retained tool variant(s) · source workspace ' + loaded.workspaceId +
      (sameWorkspace ? ' · Reopen preserves each opening saved revision.' : ' · Receive a copy and choose a ready runtime on this host.') : '';
  }
  async function receive(asNew) {
    ensure(loaded, 'Choose a saved or imported setup.');
    const family = documentFamily(loaded);
    let document = clone(loaded);
    if (asNew) {
      document = receiveSetupDraft(document, { workspaceId: getWorkspaceId() });
      const originalDrafts = clone(family);
      // Existing provenance is already retained alongside this source event.
      for (const entry of originalDrafts.entries) delete entry.portableHistory;
      document.receivedFrom.at(-1).originalDrafts = originalDrafts;
      document = parseSetupDocument(JSON.stringify(document));
    }
    receiveFamily(family, document, asNew);
    comparison = null; compareRoot.hidden = true;
    notice.textContent = asNew ? 'The complete setup is open as a new application. Choose a ready runtime, then use Review application.' :
      'The selected setup is open with its original saved revision and all retained variants. Review it after resolving any newer saved changes.';
  }
  async function removeSnapshot() {
    const record = records.find(value => value.document.id === picker.value);
    ensure(record, 'Choose a saved browser snapshot.');
    const owner = getWorkspaceId(), own = generation;
    await database().remove(owner, record.document.id, record.version);
    if (generation !== own || getWorkspaceId() !== owner) return;
    loaded = null; picker.value = ''; await listSnapshots(true);
    notice.textContent = 'The selected browser snapshot was removed.';
  }
  function download(document) {
    const url = URL.createObjectURL(new Blob([serializeSetupDocument(document)], { type: 'application/json' }));
    const link = node('a'); link.href = url; link.download = 'starforge-application-setup-' + document.id + '.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function latestApplication(ticket) {
    ensure(typeof readApplications === 'function', 'Refresh Applications to read its current saved revision.');
    const state = await readApplications();
    ensure(ticket.workspaceId === getWorkspaceId() && matches(ticket), 'The active setup changed. Compare its current fields again.');
    const application = state.applications.find(value => value.id === ticket.applicationId);
    ensure(application && !application.error, 'The original application is unavailable. Receive this setup as a new application to continue on this host.');
    return application;
  }
  async function prepareComparison() {
    const family = getFamily(), document = makeDocument(family, name.value);
    const ticket = clone(family.entries.find(entry => entry.id === family.active));
    ensure(ticket.applicationId, 'Choose a draft for a saved application to compare changes.');
    const application = await latestApplication(ticket);
    comparison = { ticket, document, plan: reviewSetupReconciliation(document, application, getCatalog()), choices: {} };
    showComparison();
  }
  function display(value) {
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (value === '') return '(empty)';
    return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  }
  function showComparison() {
    const { plan, choices } = comparison;
    const title = node('h4', 'Compare current saved settings');
    const summary = node('p', plan.conflicts ? 'Choose the retained value for ' + plan.conflicts + ' conflicting field(s). Independent edits are combined.' :
      'The edits are independent. Apply the combined fields, then review the application.', 'note');
    const table = node('table'), head = node('thead'), body = node('tbody');
    const headings = node('tr');
    for (const text of ['Field', 'When this draft opened', 'Current saved value', 'This draft', 'Retain']) {
      const cell = node('th', text); cell.scope = 'col'; headings.append(cell);
    }
    head.append(headings);
    for (const row of plan.rows) {
      const line = node('tr'), label = node('th', row.label); label.scope = 'row'; line.append(label);
      for (const value of [row.originalUnavailable ? 'Opening tool settings were not included in this older draft.' : row.original, row.current, row.draft]) { const cell = node('td'); cell.append(node('pre', display(value))); line.append(cell); }
      const cell = node('td');
      if (row.conflict) {
        const choice = node('select'); choice.setAttribute('aria-label', 'Retain value for ' + row.label);
        choice.append(new Option('Choose a value', ''), new Option('Current saved value', 'current'), new Option('This draft', 'draft'));
        choice.addEventListener('change', () => { choices[row.key] = choice.value; });
        cell.append(choice);
      } else cell.textContent = row.selection === 'current' ? 'Current saved value' : 'This draft';
      line.append(cell); body.append(line);
    }
    table.append(head, body); const scroll = node('div', undefined, 'application-setup-table'); scroll.append(table);
    const apply = action('Apply reconciled fields to this draft', applyComparison);
    const cancel = action('Close comparison', () => { comparison = null; compareRoot.hidden = true; });
    const actions = node('div', undefined, 'actions'); actions.append(apply, cancel);
    compareRoot.replaceChildren(title, summary, scroll, actions); compareRoot.hidden = false; panel.open = true;
  }
  async function applyComparison() {
    ensure(comparison, 'Compare the current saved settings first.');
    const selected = comparison;
    const application = await latestApplication(selected.ticket);
    ensure(comparison === selected, 'The comparison changed. Compare the current settings again.');
    if (application.revision !== selected.plan.application.revision) {
      comparison = { ...selected, plan: reviewSetupReconciliation(selected.document, application, getCatalog()), choices: {} };
      showComparison(); notice.textContent = 'The saved application changed again. The comparison now shows its newest revision.'; return;
    }
    const document = applySetupReconciliation(selected.document, selected.plan, selected.choices, {
      catalog: getCatalog(), runtime: getRuntimes().find(value => value.id === selected.document.configuration.runtimeId) ?? null,
    });
    applyReconciled(selected.ticket, document, application);
    comparison = null; compareRoot.hidden = true;
    notice.textContent = 'Reconciled fields are open against the current saved revision. Use Review application to inspect and save the configuration.';
  }
  picker.addEventListener('change', () => {
    loaded = clone(records.find(record => record.document.id === picker.value)?.document ?? null);
    file.value = ''; describe();
  });
  file.addEventListener('change', () => run(async () => {
    const selected = file.files?.[0], own = generation, owner = getWorkspaceId();
    if (!selected) return;
    ensure(selected.size <= 2 * 1024 * 1024, 'Choose a setup file no larger than 2 MiB.');
    const source = await selected.text();
    if (generation !== own || getWorkspaceId() !== owner) return;
    const parsed = JSON.parse(source);
    let document;
    if (parsed.schema === SETUP_SCHEMA) document = parseSetupDocument(source);
    else {
      ensure(parsed.schema === 'stellar-forge.application-setup-draft.v1', 'Choose a Starforge setup or retained draft JSON file.');
      document = makeDocument({ schema: FAMILY_SCHEMA, workspaceId: parsed.workspaceId, active: parsed.id, entries: [parsed] });
    }
    documentFamily(document); loaded = document; picker.value = '';
    notice.textContent = 'The complete source setup is loaded. Choose Reopen or Receive as new application to place it in the editor.';
  }));
  return {
    setAvailable(available, changed) { save.disabled = exportCurrent.disabled = !available; compareButton.disabled = !available || !changed; },
    refresh() { void listSnapshots(); },
    reset() {
      generation++; workspaceId = null; records = []; loaded = comparison = null;
      picker.replaceChildren(new Option('No saved setup selected', '')); name.value = file.value = '';
      notice.textContent = description.textContent = ''; compareRoot.hidden = true; describe();
    },
  };
}
