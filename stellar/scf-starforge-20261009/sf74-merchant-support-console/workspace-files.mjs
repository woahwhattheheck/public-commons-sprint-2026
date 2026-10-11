// MIT. Explicit local case save/open controls for the existing merchant console.
import {parseWorkspace, serializeWorkspace, workspaceFilename, MAX_WORKSPACE_BYTES} from './workspace-file.mjs';

let instance = 0;
const add = (parent, tag, text) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  parent.append(element);
  return element;
};

/**
 * readState(): {inputs, sources, termsText, baselineOnly}; may be async.
 * applyState(state): atomically replace current case; cancel/invalidate old jobs,
 * reset transient probe checkboxes and clear derived comparison/workorder views.
 * Neither callback should initiate a probe or interpret imported terms as a send.
 * Returns destroy() for embedding in an operator workspace with its own lifecycle.
 */
export function mountWorkspaceFiles({root, readState, applyState, onNameChange = ()=>{}}) {
  if (!root || typeof root.replaceChildren !== 'function' ||
      typeof readState !== 'function' || typeof applyState !== 'function')
    throw new TypeError('Workspace files require a root, readState and applyState');
  root.replaceChildren();
  const section = add(root, 'section');
  section.className = 'card workspace-files';
  const heading = add(section, 'h2', 'Portable workspace files');
  const id = 'workspace-' + (++instance);
  heading.id = id + '-heading';
  section.setAttribute('aria-labelledby', heading.id);
  add(section, 'p', 'Transfer intake fields, original captures and unfinished terms as a workspace file. Case-desk ownership, follow-up dates, notes and version history are retained separately in the private case directory.');
  const grid = add(section, 'div'); grid.className = 'form-grid';
  const nameLabel = add(grid, 'label', 'Case name');
  const name = add(nameLabel, 'input');
  name.type = 'text'; name.maxLength = 120; name.value = 'Merchant case';
  name.autocomplete = 'off'; name.spellcheck = false;
  const openLabel = add(grid, 'label', 'Open a saved case file');
  const open = add(openLabel, 'input');
  open.type = 'file'; open.accept = '.json,application/json';
  const preview = add(section, 'p'); preview.hidden = true;
  const actions = add(section, 'div'); actions.className = 'capture-actions';
  const save = add(actions, 'button', 'Save case file'); save.type = 'button';
  const restore = add(actions, 'button', 'Replace current case with this file');
  restore.className = 'secondary';
  restore.type = 'button'; restore.disabled = true;
  const message = add(section, 'p', 'Opening a file does not run a diagnosis, preflight, payment or outreach. Save current work before replacing it.');
  message.className = 'status'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  let candidate = null, selection = 0, busy = false, destroyed = false;
  const controller = new AbortController();
  const options = {signal: controller.signal};
  name.addEventListener('input',()=>onNameChange(name.value),options);
  function controls() {
    save.disabled = busy; open.disabled = busy; name.disabled = busy;
    restore.disabled = busy || candidate === null;
  }
  function status(text, error = false) {
    message.textContent = text;
    message.className = error ? 'status error' : 'status';
  }
  save.addEventListener('click', async () => {
    if (busy) return;
    busy = true; controls();
    status('Preparing the local case file…');
    try {
      const state = await readState();
      const text = await serializeWorkspace({...state, name: name.value});
      if (destroyed) return;
      const url = URL.createObjectURL(new Blob([text], {type: 'application/json;charset=utf-8'}));
      try {
        const link = add(document.body, 'a');
        link.href = url; link.download = workspaceFilename(name.value); link.hidden = true;
        link.click(); link.remove();
      } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
      status('Case file prepared for browser download. It contains private captures and draft terms, not a new approval or completion result.');
    } catch (error) {
      if (!destroyed) status('Case could not be saved: ' + String(error.message).slice(0, 220), true);
    } finally { busy = false; if (!destroyed) controls(); }
  }, options);
  open.addEventListener('change', async () => {
    const revision = ++selection;
    candidate = null; preview.hidden = true; controls();
    const file = open.files?.[0];
    if (!file) { status('No case file selected. Current work is unchanged.'); return; }
    status('Reading the local case and checking its original source bytes…');
    try {
      if (!file.size || file.size > MAX_WORKSPACE_BYTES) throw new Error('File must contain 1..16,100,000 bytes');
      const text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(await file.arrayBuffer());
      const parsed = await parseWorkspace(text);
      if (destroyed || revision !== selection) return;
      candidate = parsed;
      preview.textContent = `${parsed.name} · saved ${parsed.savedAt} · ${parsed.summary.sourceCount} selected capture(s), ${parsed.summary.uniqueSourceCount} unique source(s) · ${parsed.summary.termsPresent ? 'draft terms included' : 'no draft terms'}`;
      preview.hidden = false;
      status('File checked. Current work is unchanged until you choose Replace current case.');
    } catch (error) {
      if (!destroyed && revision === selection) status('Case could not be opened: ' + String(error.message).slice(0, 220), true);
    } finally { if (!destroyed && revision === selection) controls(); }
  }, options);
  restore.addEventListener('click', async () => {
    if (busy || !candidate) return;
    const state = candidate;
    busy = true; controls();
    try {
      // The consumer owns a single transactional restore of its actual native state.
      const applied = await applyState(state);
      if (applied === false) { status('Import was not applied. The current case is retained.'); return; }
      if (destroyed) return;
      name.value = state.name;
      candidate = null; open.value = ''; preview.hidden = true;
      status('Case restored. Original captures and draft terms are available; no fresh result, probe authorization, payment or outbound action was created.');
    } catch (error) {
      if (!destroyed) status('Case could not be restored: ' + String(error.message).slice(0, 220), true);
    } finally { busy = false; if (!destroyed) controls(); }
  }, options);
  return {
    setName(value) { name.value = value; },
    getName() { return name.value; },
    destroy() { destroyed = true; selection++; controller.abort(); root.replaceChildren(); },
  };
}
