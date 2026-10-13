/** Additive browser desks for the existing Upper Savannah operator. */
export const EXTENSION_SCHEMA = 'upstate.operator-extensions/v1';

const identifier = /^[a-z][a-z0-9-]*$/;
const member = /^[A-Za-z_]\w*$/;
const webAsset = /^\/web\/(?:[A-Za-z0-9][A-Za-z0-9_.-]*\/)*[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const workspaceKey = state => state?.workspace_key ?? null;

/**
 * host: {getState,api,endpoint,toast,navigationRoot,refreshState,
 * openItem,showTask,showRunLog,openDelivery,navigate,...desk capabilities}.
 * The original app owns navigation and task dispatch; this host owns only the
 * desks explicitly returned by the authenticated /api/extensions catalogue.
 */
export function createExtensionHost(host) {
  if (!host || typeof host.api !== 'function' || typeof host.getState !== 'function') {
    throw new TypeError('Extension host requires the existing api and getState functions.');
  }
  const document = host.document || globalThis.document;
  if (!document) throw new TypeError('Extension host requires a browser document.');
  const entries = new Map();
  const views = new Map();
  const issues = new Map();
  const ownedNavigation = new Set();
  const ownedStyles = new Set();
  let active = null;
  let epoch = 0;
  let lastState = host.getState();
  let lastWorkspace = workspaceKey(lastState);
  let loadPromise = null;
  let destroyed = false;
  let catalogue = null;
  const loadModule = host.importModule || (path => import(path));

  function report(entry, stage, error) {
    const issue = {
      extension_id: entry?.id || 'host', stage,
      message: error?.message || String(error)
    };
    issues.set(issue.extension_id + ':' + stage, issue);
    if (typeof host.onExtensionError === 'function') {
      try { host.onExtensionError({...issue}); } catch (_) { /* other desks remain usable */ }
    }
    return issue;
  }

  function clearIssue(entry, stage) {
    issues.delete((entry?.id || 'host') + ':' + stage);
  }

  function status(node, title, message, retry) {
    const section = document.createElement('section');
    section.className = 'extension-status';
    section.setAttribute('aria-live', 'polite');
    const heading = document.createElement('h2');
    heading.textContent = title;
    const description = document.createElement('p');
    description.textContent = message;
    section.append(heading, description);
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Retry opening this desk';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        retry();
      }, {once:true});
      section.append(button);
    }
    node.replaceChildren(section);
  }

  function navigationRoot() {
    if (typeof host.navigationRoot === 'string') return document.querySelector(host.navigationRoot);
    return host.navigationRoot || document.querySelector('nav');
  }

  function addNavigation(entry) {
    const nav = navigationRoot();
    if (!nav) return;
    const id = entry.client.view.id;
    let button = [...nav.querySelectorAll('[data-view]')].find(node => node.dataset.view === id);
    if (button) return; // Keep an existing authored button and its original navigation handler.
    button = document.createElement('button');
    button.type = 'button';
    button.dataset.view = id;
    button.dataset.extensionId = entry.id;
    button.textContent = entry.client.view.title || entry.title;
    const after = entry.client.view.after;
    const anchor = after && [...nav.querySelectorAll('[data-view]')].find(node => node.dataset.view === after);
    if (anchor?.parentNode) anchor.parentNode.insertBefore(button, anchor.nextSibling);
    else nav.append(button);
    ownedNavigation.add(button);
  }

  function addStyles(entry) {
    for (const href of entry.client.styles || []) {
      if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.getAttribute('href') === href)) continue;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.extensionStyle = entry.id;
      link.addEventListener('error', () => report(entry, 'stylesheet', new Error('Unable to load ' + href)), {once:true});
      document.head.append(link);
      ownedStyles.add(link);
    }
  }

  function normalHost() {
    const refresh = host.refresh || host.refreshState;
    const capabilities = {
      ...host,
      getState: () => host.getState(),
      openScientificReport: host.openScientificReport,
      getWorkspace: host.getWorkspace || (() => workspaceKey(host.getState())),
      refresh, refreshState: host.refreshState || refresh,
      getExtension: id => entries.get(id)?.controller || null,
      getProgramme: () => {
        const instance = typeof host.getProgramme === 'function' ? host.getProgramme() : null;
        if (typeof instance?.create === 'function') return instance;
        const entry = entries.get('programmes');
        if (!entry) return null;
        return entry.controller || {create: value => openExtension('programmes', 'create', value)};
      },
      openExtension: (id, method, ...args) => openExtension(id, method, ...args),
      openDesk: (id, method, ...args) => openDesk(id, method, ...args)
    };
    return capabilities;
  }

  function validate(raw) {
    if (!raw || !identifier.test(raw.id || '')) throw new Error('A desk needs a stable extension id.');
    const client = raw.client;
    if (!client || !identifier.test(client.view?.id || '')) throw new Error('A desk needs a stable view id.');
    if (!webAsset.test(client.module || '') || !client.module.endsWith('.mjs') ||
        client.module.split('/').some(part => part === '.' || part === '..')) {
      throw new Error('A desk must import an installed /web/ module.');
    }
    if (!member.test(client.factory || '')) throw new Error('A desk needs an explicit factory export.');
    for (const style of client.styles || []) {
      if (!webAsset.test(style) || !style.endsWith('.css') ||
          style.split('/').some(part => part === '.' || part === '..')) {
        throw new Error('A desk stylesheet must be an installed /web/ CSS asset.');
      }
    }
    for (const method of Object.values(client.lifecycle || {})) {
      if (typeof method !== 'string' || !member.test(method)) throw new Error('Lifecycle entries must name controller methods.');
    }
    if (client.dispatch && !member.test(client.dispatch)) throw new Error('Action dispatch must name a controller method.');
    if (client.task_actions && !member.test(client.task_actions)) throw new Error('Task actions must name a controller method.');
    for (const prefix of client.action_prefixes || []) {
      if (typeof prefix !== 'string' || !/^[a-z][a-z0-9-]*-$/.test(prefix)) {
        throw new Error('Global action prefixes must be explicit names ending with a hyphen.');
      }
      for (const entry of entries.values()) {
        if ((entry.client.action_prefixes || []).some(owned => prefix.startsWith(owned) || owned.startsWith(prefix))) {
          throw new Error('Global action prefix already belongs to ' + entry.id + '.');
        }
      }
    }
    if (entries.has(raw.id) || views.has(client.view.id)) throw new Error('An extension or browser view is already registered.');
    const capabilities = normalHost();
    const missing = (client.requires || []).filter(name => capabilities[name] === undefined || capabilities[name] === null);
    if (missing.length) throw new Error('The existing operator must supply: ' + missing.join(', ') + '.');
    return {
      id: raw.id, title: raw.title || raw.id, version: raw.version,
      actions: new Set((Array.isArray(raw.actions) ? raw.actions : []).filter(action => typeof action === 'string')),
      client, controller:null, promise:null, mounted:false, updatedState:null
    };
  }

  async function controller(entry) {
    if (entry.controller) return entry.controller;
    if (entry.promise) return entry.promise;
    entry.promise = (async () => {
      const module = await loadModule(entry.client.module);
      const factory = module[entry.client.factory];
      if (typeof factory !== 'function') throw new Error('Factory export ' + entry.client.factory + ' is missing.');
      const instance = await factory(normalHost());
      if (!instance || typeof instance !== 'object') throw new Error('The desk factory must return a controller.');
      const mount = entry.client.lifecycle?.mount || 'mount';
      if (typeof instance[mount] !== 'function') throw new Error('The desk does not expose its registered mount method.');
      entry.controller = instance;
      clearIssue(entry, 'load');
      return instance;
    })();
    try { return await entry.promise; }
    catch (error) {
      entry.promise = null;
      report(entry, 'load', error);
      throw error;
    }
  }

  function call(entry, stage, method, args) {
    if (!method || typeof entry.controller?.[method] !== 'function') return;
    const selected = active, selectedEpoch = epoch;
    const obsolete = () => destroyed || active !== selected || epoch !== selectedEpoch;
    try {
      const result = entry.controller[method](...args);
      clearIssue(entry, stage);
      if (result?.then) result.catch(error => {
        if (stage === 'mount' && obsolete()) return;
        report(entry, stage, error);
        if (stage === 'mount' && selected?.entry === entry) showFailure(entry, selected, error);
      });
      return result;
    } catch (error) {
      if (stage === 'mount' && obsolete()) return;
      report(entry, stage, error);
      if (stage === 'mount' && selected?.entry === entry) {
        showFailure(entry, selected, error);
      }
    }
  }

  function deactivate() {
    epoch += 1;
    const previous = active;
    active = null;
    if (previous) {
      previous.entry.mounted = false;
      call(previous.entry, 'detach', previous.entry.client.lifecycle?.detach || 'detach', []);
    }
    return previous?.entry || null;
  }

  function showFailure(entry, selection, error) {
    if (active !== selection || destroyed) return;
    entry.mounted = false;
    status(selection.node, entry.client.view.title || entry.title,
      error?.message || String(error), () => {
        if (active !== selection || destroyed) return;
        entry.promise = null;
        begin(entry, selection);
      });
  }

  function mountEntry(entry, selection) {
    if (active !== selection || destroyed || selection.epoch !== epoch ||
        selection.workspace !== workspaceKey(lastState)) return;
    entry.mounted = true;
    entry.updatedState = lastState;
    selection.ready = Promise.resolve(call(entry, 'mount', entry.client.lifecycle?.mount || 'mount', [selection.node, lastState]));
    return selection.ready;
  }

  function begin(entry, selection) {
    if (entry.controller) {
      mountEntry(entry, selection);
      return;
    }
    status(selection.node, entry.client.view.title || entry.title, 'Opening workspace tools…');
    selection.ready = controller(entry).then(
      () => mountEntry(entry, selection),
      error => showFailure(entry, selection, error)
    );
    selection.ready.catch(() => {});
  }

  async function load() {
    if (destroyed) throw new Error('This extension host was destroyed.');
    if (catalogue) return catalogue;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const value = await host.api('/api/extensions');
      if (value?.schema !== EXTENSION_SCHEMA || !Array.isArray(value.extensions)) {
        throw new Error('The operator returned an unsupported extension catalogue.');
      }
      for (const issue of value.issues || []) {
        issues.set((issue.extension_id || 'host') + ':' + (issue.stage || 'server'), {...issue});
      }
      const definitions = [...value.extensions].sort((a,b) => (Number.isFinite(Number(a.order))?Number(a.order):100)-(Number.isFinite(Number(b.order))?Number(b.order):100) || String(a.id).localeCompare(String(b.id)));
      for (const definition of definitions) {
        if (!definition.client || !Object.keys(definition.client).length) continue;
        try {
          const entry = validate(definition);
          entries.set(entry.id, entry);
          views.set(entry.client.view.id, entry);
          addStyles(entry);
          addNavigation(entry);
        } catch (error) {
          report(definition, 'registration', error);
        }
      }
      catalogue = value;
      clearIssue(null, 'catalogue');
      return value;
    })();
    try { return await loadPromise; }
    catch (error) {
      loadPromise = null;
      report(null, 'catalogue', error);
      throw error;
    }
  }

  /**
   * Called at the original render dispatch before built-in views.
   * Return true means this host owns the supplied node for the selected view.
   */
  function render(view, node, state = host.getState()) {
    if (destroyed) return false;
    lastState = state;
    const entry = views.get(view);
    if (!entry) {
      if (active) deactivate();
      return false;
    }
    if (!node || typeof node.replaceChildren !== 'function') throw new TypeError('A desk needs an existing content element.');
    const key = workspaceKey(state);
    if (active?.entry === entry && active.node === node && active.workspace === key) {
      if (entry.mounted && entry.updatedState !== state) updateEntry(entry, state);
      return true;
    }
    deactivate();
    const selection = {entry, node, workspace:key, epoch};
    active = selection;
    begin(entry, selection);
    return true;
  }

  function updateEntry(entry, state) {
    if (!entry.controller) return;
    const method = entry.client.lifecycle?.update || 'update';
    entry.updatedState = state;
    if (method === (entry.client.lifecycle?.mount || 'mount')) {
      if (entry.mounted && active?.entry === entry) call(entry, 'update', method, [active.node, state]);
    } else {
      call(entry, 'update', method, [state]);
    }
  }

  /** Run on every accepted state refresh, including task-only refreshes. */
  function update(state = host.getState()) {
    if (destroyed) return;
    const key = workspaceKey(state);
    if (lastWorkspace !== null && key !== lastWorkspace) {
      const previous = deactivate();
      for (const entry of entries.values()) {
        if (entry.controller && entry !== previous) call(entry, 'detach', entry.client.lifecycle?.detach || 'detach', []);
        entry.mounted = false;
      }
    }
    lastWorkspace = key;
    lastState = state;
    for (const entry of entries.values()) updateEntry(entry, state);
  }

  /**
   * Call before the original data-action switch. Only a declared prefix is
   * consumed. The original queue and global handler still own all other actions.
   */
  async function dispatch(button) {
    const action = button?.dataset?.action;
    if (!action || destroyed) return false;
    const entry = [...entries.values()].find(candidate =>
      (candidate.client.action_prefixes || []).some(prefix => action.startsWith(prefix)));
    if (!entry) return false;
    const selectedWorkspace = workspaceKey(host.getState());
    try {
      const instance = await controller(entry);
      if (workspaceKey(host.getState()) !== selectedWorkspace) throw new Error('The workspace changed. Open the selected workspace and retry this action.');
      const method = entry.client.dispatch || 'dispatch';
      if (typeof instance[method] !== 'function') throw new Error('This desk has no registered action dispatcher.');
      await instance[method](button);
      clearIssue(entry, 'dispatch');
    } catch (error) {
      report(entry, 'dispatch', error);
      if (typeof host.toast === 'function') host.toast(error?.message || String(error));
    }
    return true;
  }

  /** Open retained results from an original queued operation, loading only its owning desk. */
  async function taskActions(task) {
    if (!task || destroyed) return '';
    const selectedWorkspace = workspaceKey(host.getState());
    if (task.workspace && task.workspace !== selectedWorkspace) return '';
    let entry = [...entries.values()].find(candidate => candidate.actions.has(task.action));
    // A registered backend provider can retain result controls on its existing desk.
    // Task payloads never choose a module: only this decorated public task hint and
    // an already registered client with an explicit task_actions method are used.
    const taskDesk = task._extension_task_actions?.extension_id;
    if (!entry?.client.task_actions && typeof taskDesk === 'string' && identifier.test(taskDesk)) {
      const requested = entries.get(taskDesk);
      if (requested?.client.task_actions) entry = requested;
    }
    // Backend-only optimization tasks retain the original Conservation links.
    // Reuse that authored controller without claiming another provider's actions.
    if (!entry?.client.task_actions && task._conservation &&
        String(task.action || '').startsWith('conservation.')) {
      entry = entries.get('conservation');
    }
    const method = entry?.client.task_actions;
    if (!method) return '';
    try {
      const instance = await controller(entry);
      if (destroyed || workspaceKey(host.getState()) !== selectedWorkspace) return '';
      if (typeof instance[method] !== 'function') throw new Error('The desk cannot open its retained task results.');
      const markup = await instance[method](task);
      if (destroyed || workspaceKey(host.getState()) !== selectedWorkspace) return '';
      if (markup !== undefined && markup !== null && typeof markup !== 'string') {
        throw new Error('Task result controls must return authored markup.');
      }
      clearIssue(entry, 'task-actions');
      return markup || '';
    } catch (error) {
      report(entry, 'task-actions', error);
      return '';
    }
  }

  /** Optional cross-desk capability, for example openExtension('programmes','create',{selection}). */
  async function openExtension(id, method, ...args) {
    const entry = entries.get(id);
    if (!entry || !member.test(method || '')) throw new Error('Choose a registered desk and controller method.');
    const selectedWorkspace = workspaceKey(host.getState());
    const instance = await controller(entry);
    if (destroyed || workspaceKey(host.getState()) !== selectedWorkspace) throw new Error('The selected workspace changed while opening this desk.');
    if (typeof instance[method] !== 'function') throw new Error('The requested desk method is unavailable.');
    return instance[method](...args);
  }

  /** Open a visible desk only after its original asynchronous mount has finished. */
  async function openDesk(id, method, ...args) {
    const entry = entries.get(id);
    if (!entry || !member.test(method || '')) throw new Error('Choose a registered scientific desk and opening method.');
    const selectedWorkspace = workspaceKey(host.getState());
    await host.navigate(entry.client.view.id);
    const selectedView = active;
    const instance = await controller(entry);
    if (destroyed || !selectedView || active !== selectedView || selectedView.entry !== entry ||
        selectedView.workspace !== selectedWorkspace || workspaceKey(host.getState()) !== selectedWorkspace) {
      throw new Error('The selected workspace or desk changed while opening this scientific record.');
    }
    await selectedView.ready;
    if (destroyed || active !== selectedView || !entry.mounted || workspaceKey(host.getState()) !== selectedWorkspace) {
      throw new Error('Reopen the selected scientific desk in its original workspace.');
    }
    if (typeof instance[method] !== 'function') throw new Error('The selected desk cannot open this retained record.');
    return instance[method](...args);
  }

  function detach() {
    const previous = deactivate();
    for (const entry of entries.values()) {
      if (entry.controller && entry !== previous) call(entry, 'detach', entry.client.lifecycle?.detach || 'detach', []);
      entry.mounted = false;
    }
  }

  function destroy() {
    if (destroyed) return;
    detach();
    destroyed = true;
    for (const node of ownedNavigation) node.remove();
    for (const node of ownedStyles) node.remove();
    ownedNavigation.clear();
    ownedStyles.clear();
    entries.clear();
    views.clear();
  }

  return {
    load, render, update, dispatch, detach, destroy, openExtension, openDesk, taskActions,
    title: view => {
      const entry = views.get(view);
      return entry ? entry.client.view.title || entry.title : null;
    },
    hasView: view => views.has(view),
    diagnostics: () => [...issues.values()].map(issue => ({...issue}))
  };
}
