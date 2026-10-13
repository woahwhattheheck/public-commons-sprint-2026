/** Connect the retained scientific desks to the existing operator lifecycle. */

const key = state => state?.workspace_key ?? null;

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

function adapt(host, desk, {view, collections, prefixes, render = false, openActions = []}) {
  let root = null, workspace = null, rendered = null;
  const stamp = state => JSON.stringify({
    workspace: key(state),
    data: Object.fromEntries(collections.map(name => [name, state?.data?.[name] ?? []])),
    tasks: (state?.tasks || []).filter(task => prefixes.some(prefix => task.action?.startsWith(prefix)))
      .map(task => [task.id,task.state,task.ended_at,task.error,task.updated_at,task.progress])
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

  return {...desk, mount, update, detach, dispatch};
}

export async function attachExperimentsDesk(host) {
  const {attachExperiments} = await import('./experiments.mjs');
  return adapt(host, attachExperiments(host), {
    view:'experiments',
    collections:['experiments','sources','profiles','scenarios','grids','runs'],
    prefixes:['experiment.']
  });
}

export async function attachConservationDesk(host) {
  const {attachConservation} = await import('./conservation.mjs');
  return adapt(host, attachConservation(host), {
    view:'conservation', render:true,
    collections:['sources','profiles','scenarios','grids','runs'],
    prefixes:['conservation.','experiment.'],
    openActions:['conservation-open-study','conservation-open-plan',
      'conservation-use-criteria','conservation-new-parcel-study']
  });
}

export async function attachDiagnosticsDesk(host) {
  const {attachExperimentDiagnostics} = await import('./experiment_diagnostics.mjs');
  return adapt(host, attachExperimentDiagnostics(host), {
    view:'experiment-diagnostics', render:true,
    collections:['experiment_diagnostics','sources','profiles','scenarios','grids','runs','observations'],
    prefixes:['diagnostics.']
  });
}
