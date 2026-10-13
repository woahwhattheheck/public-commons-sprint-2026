/* Transfer the original saved Monitoring study through the existing study desk. */
const nativeId = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const clone = value => JSON.parse(JSON.stringify(value));

export function attachMonitoringStudyTransfer(node, host, workspaceKey) {
  const container = node.shadowRoot.querySelector('[data-export="bundle"]')?.closest('details');
  if (!container) throw Error('The original Monitoring export controls are missing.');
  const section = document.createElement('section');
  section.className = 'monitoring-study-transfer';
  section.innerHTML = `
    <h4>Transfer an editable monitoring study</h4>
    <p class="small">Choose the saved campaign, design or source network shown here. Study transfer retains its original sources and field history in an editable workspace.</p>
    <p data-monitoring-study-selection class="small"></p>
    <label><input type="checkbox" data-monitoring-study-context checked> Include the open saved observational context</label>
    <p data-monitoring-study-context-summary class="small"></p>
    <button type="button" data-monitoring-study-open>Transfer editable study</button>
    <p data-monitoring-study-status class="small" role="status" aria-live="polite"></p>`;
  container.append(section);
  const find = name => section.querySelector('[data-monitoring-study-' + name + ']');
  let detached = false, opening = false, generation = 0;
  const current = () => !detached && node.isConnected && host.getState()?.workspace_key === workspaceKey;
  function selection() {
    const plan = node.plan, network = node.network, campaign = node.campaign;
    let root = null;
    if (nativeId(campaign?.revision?.campaign_id) && nativeId(plan?.id)
        && campaign.plan?.id === plan.id && plan.network_id === network?.id) {
      root = {kind:'monitoring_heads', id:campaign.revision.campaign_id,
        title:campaign.revision.title || 'Monitoring campaign', state:'Saved'};
    } else if (nativeId(plan?.id) && plan.network_id === network?.id) {
      root = {kind:'monitoring_plans', id:plan.id, title:plan.title || 'Monitoring design', state:plan.status || 'Saved'};
    } else if (nativeId(network?.id)) {
      root = {kind:'monitoring_networks', id:network.id, title:network.title || 'Monitoring network', state:'Saved'};
    }
    const context = node.observedContextForStudy?.();
    const matchedContext = nativeId(context?.id) && context.network_id === network?.id
      && (!context.plan_id || context.plan_id === plan?.id) ? context : null;
    return {root, context:matchedContext};
  }
  function render() {
    if (!current()) return;
    const value = selection();
    find('selection').textContent = value.root
      ? value.root.title + ' · ' + value.root.kind.replaceAll('_', ' ') + ' · ' + value.root.id.slice(0,12)
      : 'Open a saved network, design or campaign first.';
    find('context').disabled = opening || !value.context;
    find('context-summary').textContent = value.context
      ? (value.context.title || 'Saved observational context') + ' · ' + value.context.id.slice(0,12)
      : 'No matching saved observational context is open. Saved contexts can also be chosen in Study transfer.';
    find('open').disabled = opening || node.busy || !value.root;
  }
  async function open() {
    if (!current() || opening || node.busy) return;
    const selected = selection();
    if (!selected.root) throw Error('Open an original saved Monitoring study first.');
    if (typeof host.openDesk !== 'function') throw Error('Use the current operator study-transfer desk.');
    const roots = [selected.root];
    if (find('context').checked && selected.context) roots.push({
      kind:'monitoring_observed_contexts', id:selected.context.id,
      title:selected.context.title || 'Monitoring observational context', state:'Saved'
    });
    const ticket = ++generation;
    opening = true; render();
    try {
      await host.openDesk('study-transfer','openForStudies',{workspace_key:workspaceKey,roots:clone(roots)});
      if (current() && generation === ticket) {
        find('status').textContent = 'Saved study selected. Review its dependency preview and create the original receiving archive in Study transfer.';
        find('status').dataset.error = 'false';
      }
    } finally {
      if (generation === ticket) opening = false;
      if (current()) render();
    }
  }
  find('open').onclick = () => open().catch(error => {
    if (current()) {find('status').textContent=error.message;find('status').dataset.error='true';}
  });
  const originalRender = node.render;
  node.render = function(...args) {
    const value = originalRender.apply(this,args);
    render();
    return value;
  };
  function update() {detached=false;render();}
  function detach() {detached=true;generation++;opening=false;}
  update();
  return {update,detach,open};
}
