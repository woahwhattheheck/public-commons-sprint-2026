// MIT. Original operation and installer-attempt selection around the shared output reader.
import { createApplicationOutputReader } from './application-output.mjs';
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const query = values => '/api/runtime-output/sources?' + new URLSearchParams(
  Object.entries(values).filter(([, value]) => value !== undefined));
const sourceKey = value => JSON.stringify([value?.operationId ?? null, value?.runtimeId ?? null]);
export function createRuntimeOutputView({ root, api, getWorkspaceId, error, onSelection }) {
  let selected = null, inventory = null, rows = [], generation = 0, pending = false, workspaceId = null;
  const title = el('h3', 'Original Runtime output'), info = el('p', '', 'note');
  const actions = el('div', undefined, 'actions');
  const refresh = el('button', 'Refresh source list'), related = el('button', 'Open installation attempts');
  refresh.type = related.type = 'button'; related.hidden = true;
  actions.append(refresh, related);
  const attemptLabel = el('label', 'Retained npm attempt'), attempts = el('select');
  attemptLabel.append(attempts); attemptLabel.hidden = true;
  const more = el('button', 'Load earlier retained attempts'); more.type = 'button'; more.hidden = true;
  const detail = el('p', '', 'note'), readerRoot = el('div');
  root.replaceChildren(title, info, actions, attemptLabel, more, detail, readerRoot);
  const reader = createApplicationOutputReader({
    root: readerRoot, api, getWorkspaceId, error,
    pageRoute: '/api/runtime-output/page', downloadRoute: '/api/runtime-output/download',
    sourceFields: ['operationId', 'runtimeId', 'logFile'], storagePrefix: 'starforge-runtime-output-',
    describe: value => value.operationId ? 'operation ' + value.operationId : 'runtime ' + value.runtimeId + ' · ' + value.logFile,
  });
  const current = (ticket, ownWorkspace) => generation === ticket && getWorkspaceId() === ownWorkspace;
  function controls() {
    refresh.disabled = pending || !selected;
    attempts.disabled = pending || !rows.length;
    more.disabled = pending; more.hidden = !inventory?.nextCursor;
    related.disabled = pending; related.hidden = !inventory?.relatedRuntimeId;
  }
  function render() {
    const operation = Boolean(selected?.operationId);
    title.textContent = operation ? 'Operation ' + selected.operationId : 'Installation attempts · ' + (inventory?.label ?? selected?.runtimeId ?? '');
    attemptLabel.hidden = operation;
    if (operation) info.textContent = (inventory?.operation ?? 'Original operation') + ' · worker.log' +
      (inventory?.createdAt ? ' · created ' + inventory.createdAt : '');
    else {
      info.textContent = (inventory?.retainedAttempts ?? 0) + ' retained npm attempt files · ' +
        (inventory?.currentPhase ? 'latest saved installer phase ' + inventory.currentPhase : 'no saved installer phase') +
        '. Earlier file names do not establish an installation result.';
      const options = rows.map(row => {
        const option = el('option', 'Attempt ' + row.attempt + (row.current ? ' · latest saved attempt' : '') +
          ' · ' + row.logFile + (row.available ? ' · ' + row.bytes + ' bytes' : ' · ' + row.state));
        option.value = row.logFile; return option;
      });
      if (selected?.logFile && !rows.some(row => row.logFile === selected.logFile)) {
        const option = el('option', 'Selected original file · ' + selected.logFile); option.value = selected.logFile; options.unshift(option);
      }
      attempts.replaceChildren(...options);
      attempts.value = selected?.logFile ?? '';
    }
    const row = operation ? rows[0] : rows.find(item => item.logFile === selected?.logFile);
    detail.textContent = row ? row.available
      ? row.bytes + ' bytes observed' + (row.modifiedAt ? ' · file modified ' + row.modifiedAt : '') +
        (row.current && row.phase ? ' · current saved phase ' + row.phase : '')
      : row.state + ': ' + row.error.message
      : !operation && !selected?.logFile ? 'This registered runtime has no retained npm attempt yet.' : '';
    controls();
  }
  async function loadInventory({ append = false, refreshOutput = false } = {}) {
    if (!selected || pending) return;
    const ownWorkspace = getWorkspaceId(), ticket = ++generation, scope = { ...selected };
    pending = true; controls();
    try {
      const value = await api(query({ ...(scope.operationId ? { operationId: scope.operationId } : { runtimeId: scope.runtimeId }),
        ...(append ? { cursor: inventory.nextCursor } : {}) }));
      if (!current(ticket, ownWorkspace)) return;
      inventory = value;
      rows = append ? [...new Map([...rows, ...value.sources].map(row => [row.logFile, row])).values()] : value.sources;
      if (!scope.operationId) rows = rows.map(row => ({ ...row,
        current: row.logFile === value.currentLogFile,
        phase: row.logFile === value.currentLogFile ? value.currentPhase : null }));
      if (!scope.operationId && !selected.logFile)
        selected = { runtimeId: scope.runtimeId, ...(value.currentLogFile || rows[0]?.logFile ? { logFile: value.currentLogFile || rows[0].logFile } : {}) };
      onSelection({ ...selected }); render();
      if (selected.operationId || selected.logFile) {
        await reader.update(selected, { force: refreshOutput });
      } else reader.reset();
    } finally {
      if (current(ticket, ownWorkspace)) { pending = false; controls(); }
    }
  }
  refresh.addEventListener('click', () => loadInventory({ refreshOutput: true }).catch(error));
  more.addEventListener('click', () => loadInventory({ append: true }).catch(error));
  attempts.addEventListener('change', async () => {
    if (!selected?.runtimeId || !attempts.value) return;
    selected = { runtimeId: selected.runtimeId, logFile: attempts.value };
    onSelection({ ...selected }); render(); await reader.update(selected);
  });
  related.addEventListener('click', () => {
    if (inventory?.relatedRuntimeId) open({ runtimeId: inventory.relatedRuntimeId }).catch(error);
  });
  async function open(value) {
    const next = value.operationId ? { operationId: value.operationId }
      : { runtimeId: value.runtimeId, ...(value.logFile ? { logFile: value.logFile } : {}) };
    const changed = workspaceId !== getWorkspaceId() || sourceKey(next) !== sourceKey(selected);
    if (changed) {
      generation++; pending = false; inventory = null; rows = []; reader.reset();
    }
    workspaceId = getWorkspaceId(); selected = next;
    onSelection({ ...selected }); render(); await loadInventory();
  }
  return {
    open,
    async update() { if (selected && workspaceId === getWorkspaceId() && (selected.operationId || selected.logFile)) await reader.update(selected); },
    reset() {
      generation++; pending = false; selected = inventory = workspaceId = null; rows = [];
      reader.reset(); title.textContent = 'Original Runtime output'; info.textContent = detail.textContent = '';
      attemptLabel.hidden = true; controls();
    },
  };
}
