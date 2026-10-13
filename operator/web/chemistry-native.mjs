/** Original Chemistry desk and saved-report controls in the maintained host. */
import {attachChemistry} from './chemistry.mjs';

const workspaceKey = value => value?.workspace_key ?? value?.workspace ?? value?.data?.workspace_key;
export function attachNativeChemistry(host) {
  const desks = new Map();
  let active = null;
  function currentKey() {
    const key = workspaceKey(host.getState());
    if (!key) throw Error('Open an original scientific workspace.');
    return key;
  }
  function desk(key) {
    if (desks.has(key)) return desks.get(key);
    const panel = document.createElement('div');
    let snapshot = host.getState(), busy = false, completed = null, updating = false, ready;
    const state = () => {
      const live = host.getState();
      if (workspaceKey(live) === key) snapshot = live;
      return snapshot;
    };
    const controller = attachChemistry({
      ...host, getState: state,
      endpoint: (path, values = {}) => path + '?' + new URLSearchParams({...values, workspace: key}),
      showTask: async id => {
        if (workspaceKey(host.getState()) === key) return host.showTask(id);
      }
    });
    async function dispatchButton(button) {
      await ready;
      if (workspaceKey(host.getState()) !== key) throw Error('Reopen the original workspace for this Chemistry action.');
      if (button.dataset.workspace && button.dataset.workspace !== key) throw Error('This Chemistry action belongs to another workspace.');
      if (busy) return;
      busy = true;
      const controls = [...panel.querySelectorAll('button,input,select,textarea')].map(node => [node,node.disabled]);
      for (const [node] of controls) node.disabled = true;
      try { await controller.dispatch(button); }
      finally {
        for (const [node, disabled] of controls) node.disabled = disabled;
        busy = false;
      }
    }
    panel.addEventListener('click', async event => {
      const button = event.target.closest('[data-action^="chemistry-"]');
      if (!button || !panel.contains(button)) return;
      event.preventDefault();
      event.stopPropagation();
      try { await dispatchButton(button); }
      catch (error) { host.toast(error.message || String(error)); }
    });
    const entry = {panel, controller, dispatch:dispatchButton, ready:()=>ready,
      async update() {
        await ready;
        if (busy || updating || !panel.isConnected) return;
        const value = state();
        const tasks = value?.tasks ?? value?.data?.tasks ?? [];
        const signature = JSON.stringify(tasks.filter(task =>
          task.state === 'complete' && (task.action?.startsWith('chemistry.') || task.action?.startsWith('source.'))
        ).map(task => task.id).sort());
        if (signature === completed) return;
        updating = true;
        try {
          await controller.update();
          if (panel.isConnected && workspaceKey(host.getState()) === key) completed = signature;
        } finally { updating = false; }
      }
    };
    desks.set(key, entry);
    ready = controller.mount(panel);
    return entry;
  }
  function mount(root) {
    const entry = desk(currentKey());
    active = entry;
    if (entry.panel.parentNode !== root) root.replaceChildren(entry.panel);
    return entry.update();
  }
  function update() {
    if (active && active === desks.get(currentKey())) return active.update();
  }
  function detach() {
    active?.panel.remove();
    active = null;
  }
  function taskActions(task) {
    const key = currentKey();
    if (task.workspace && task.workspace !== key) return '';
    return desk(key).controller.taskActions(task);
  }
  async function dispatch(button) {
    const key = currentKey();
    if (button.dataset.workspace && button.dataset.workspace !== key) {
      throw Error('This Chemistry result belongs to another workspace.');
    }
    const entry = desk(key);
    await host.navigate('chemistry');
    await entry.ready();
    if (currentKey() !== key || active !== entry || !entry.panel.isConnected) {
      throw Error('Reopen Chemistry in the selected workspace before opening this result.');
    }
    return entry.dispatch(button);
  }
  return {mount,update,detach,dispatch,taskActions};
}
