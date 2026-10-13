/** Connect the retained scientific desks to the existing operator lifecycle. */

const key = state => state?.workspace_key ?? null;

function taskRows(state) {
  const source = state?.tasks;
  if (Array.isArray(source)) return source;
  if (Array.isArray(source?.tasks)) return source.tasks;
  if (Array.isArray(source?.items)) return source.items;
  return source && typeof source === 'object' ? Object.values(source)
    .filter(task => task && typeof task === 'object' && task.action) : [];
}

function retainFocus(root) {
  const document = root.ownerDocument || globalThis.document;
  const node = document?.activeElement;
  if (!node || !root.contains(node)) return null;
  return {
    id: node.id || null, name: node.getAttribute('name'),
    start: node.selectionStart, end: node.selectionEnd,
    scrollTop: root.scrollTop, scrollLeft: root.scrollLeft
  };
}

function restoreFocus(root, saved) {
  if (!saved) return;
  const node = [...root.querySelectorAll('input,select,textarea,button,[tabindex]')]
    .find(candidate => saved.id ? candidate.id === saved.id :
      saved.name && candidate.getAttribute('name') === saved.name);
  if (node) {
    node.focus({preventScroll:true});
    if (Number.isInteger(saved.start) && typeof node.setSelectionRange === 'function') {
      try { node.setSelectionRange(saved.start, saved.end); } catch (_) {}
    }
  }
  root.scrollTop = saved.scrollTop;
  root.scrollLeft = saved.scrollLeft;
}

function adapt(host, createDesk, {view, collections, prefixes, render = false, openActions = []}) {
  let root = null, workspace = null, rendered = null;
  const stamp = state => JSON.stringify({
    workspace: key(state),
    data: Object.fromEntries(collections.map(name => [name, state?.data?.[name] ?? []])),
    tasks: taskRows(state).filter(task => prefixes.some(prefix => task.action?.startsWith(prefix)))
      .map(task => [task.id,task.action,task.state ?? task.status,task.updated_at,
        task.progress,task.ended_at,task.error])
  });

  function mount(node, state = host.getState()) {
    const current = key(state), next = stamp(state);
    if (root === node && workspace === current && rendered === next) return;
    const focus = render && root === node && workspace === current ? retainFocus(root) : null;
    root = node; workspace = current; rendered = next;
    if (render) {
      // The original render keeps each desk's selections before its old DOM is replaced.
      const markup = desk.render(state);
      desk.detach?.();
      node.innerHTML = markup;
    }
    const result = desk.mount(node, state);
    if (focus) restoreFocus(node, focus);
    return result;
  }

  function update(state = host.getState()) {
    if (root) return mount(root, state);
  }

  function detach() {
    desk.detach?.();
    root = null; workspace = null; rendered = null;
  }

  async function dispatch(button) {
    // A forced host refresh must also reflect local view changes such as "All analyses".
    rendered = null;
    if (openActions.includes(button?.dataset?.action)) {
      host.closeDetail?.();
      await host.navigate(view);
    }
    return desk.dispatch(button);
  }

  const desk = createDesk({
    ...host,
    async navigate(next) {
      const selectedWorkspace = key(host.getState());
      if (next === view) rendered = null;
      const result = await host.navigate(next);
      // Original controllers also navigate within their own desk. Repaint their
      // local selection when the host keeps the same state object and DOM root.
      if (next === view && root && workspace === selectedWorkspace &&
          key(host.getState()) === selectedWorkspace && rendered === null) {
        await mount(root, host.getState());
      }
      return result;
    }
  });

  return {...desk, mount, update, detach, dispatch};
}

export async function attachExperimentsDesk(host) {
  const {attachExperiments} = await import('./experiments.mjs');
  return adapt(host, attachExperiments, {
    view:'experiments',
    collections:['experiments','sources','profiles','scenarios','grids','runs'],
    prefixes:['experiment.']
  });
}

export async function attachConservationDesk(host) {
  const {attachConservationWithOptimization} = await import('./conservation_optimization_bridge.mjs');
  const catalogue=await host.api('/api/extensions');
  const transfer=(catalogue.extensions??[]).some(entry=>entry.id==='study-transfer'&&entry.client?.view);
  const joined={
    ...host,
    openStudyTransfer:typeof host.openExtension==='function'&&transfer?
      selection=>host.openExtension('study-transfer','openForStudies',selection):host.openStudyTransfer
  };
  return adapt(joined, attachConservationWithOptimization, {
    view:'conservation', render:true,
    collections:['sources','profiles','scenarios','grids','runs','experiments'],
    prefixes:['conservation.','experiment.'],
    openActions:['conservation-open-study','conservation-open-plan',
      'conservation-use-criteria','conservation-new-parcel-study',
      'conservation-new-source-capture','conservation-open-source-capture',
      'conservation-criteria-from-sources','conservation-resume-sources',
      'conservation-resume-criteria','conservation-optimization-open-preview',
      'conservation-optimization-open-analysis','conservation-new-experiment']
  });
}

export async function attachDiagnosticsDesk(host) {
  const {attachExperimentDiagnostics} = await import('./experiment_diagnostics.mjs');
  const catalogue=await host.api('/api/extensions');
  const desks=new Set((catalogue.extensions??[]).filter(entry=>entry.client?.view).map(entry=>entry.id));
  const joined={
    ...host,
    openInvestigation:typeof host.openExtension==='function'&&desks.has('investigations')?
      selection=>host.openExtension('investigations','openForDiagnostic',selection):host.openInvestigation,
    openStudy:typeof host.openExtension==='function'&&desks.has('study-transfer')?
      roots=>host.openExtension('study-transfer','openForStudies',roots):host.openStudy,
    openDecision:typeof host.openExtension==='function'&&desks.has('robust-workbench')?
      selection=>host.openExtension('robust-workbench','openForDiagnostic',selection):host.openDecision
  };
  return adapt(joined, attachExperimentDiagnostics, {
    view:'experiment-diagnostics', render:true,
    collections:['experiment_diagnostics','sources','profiles','scenarios','grids','runs','observations'],
    prefixes:['diagnostics.']
  });
}
