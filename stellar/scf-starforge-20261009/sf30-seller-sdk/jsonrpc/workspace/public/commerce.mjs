// MIT. One retained buyer selection opens the original commerce console.
export function createCommercePanel({ request, operation, run, node, table, download, message,
  selection, current, openVersion, refreshWorkspace }) {
  const $ = id => document.getElementById(id), selected = new Set();
  let buyers = [], buyerCursor = null, preparations = [], preparationCursor = null, filter = '', generation = 0, reviewed = null;
  const json = value => JSON.stringify(value, null, 2);
  const selectedIds = () => [...selected].sort();
  function complete(result) {
    if (result.state !== 'COMPLETE') throw new Error('Retained operation is ' + result.state.toLowerCase() +
      (result.error ? ': ' + result.error : '') + '. Reopen its saved operation before continuing.');
    return result;
  }
  function invalidate() {
    reviewed = null;
    let changed = false;
    for (const row of buyers) if (row.preparationId && selected.delete(row.id)) changed = true;
    if (changed) renderBuyers();
    renderReview(); controls();
  }
  function controls(actionable = Boolean(current().review?.valid && !current().dirty)) {
    const { state, active, busy } = current(); if (!state) return;
    if (busy) {
      for (const button of $('commerce-heading').closest('section').querySelectorAll('button')) button.disabled = true;
      return;
    }
    const profile = state.commerceProfile, existing = $('commerce-existing').value;
    $('commerce-review').disabled = !actionable || !profile.enabled || !selected.size ||
      !existing && !profile.canPrepare;
    $('commerce-prepare').disabled = !actionable || !profile.enabled || !reviewed || reviewed.revision !== active.revision;
    $('commerce-older-buyers').hidden = !buyerCursor;
    $('commerce-older-preparations').hidden = !preparationCursor;
    for (const button of $('commerce-preparations').querySelectorAll('[data-open]'))
      button.disabled = !profile.enabled || ['STARTING', 'RUNNING', 'STOPPING'].includes(state.runtime.state);
  }
  function renderBuyers() {
    const target = $('commerce-buyers'); target.replaceChildren();
    if (!buyers.length) target.append(node('p', 'Prepare buyer reviews for this package above.', { class: 'empty' }));
    else target.append(table(['Select', 'Saved request', 'Request bytes', 'Retained preparation'], buyers.map(row => {
      const checkbox = node('input', null, { type: 'checkbox', 'aria-label': 'Select ' + row.intentId });
      checkbox.checked = selected.has(row.id); checkbox.disabled = Boolean(row.preparationId);
      checkbox.addEventListener('change', () => { checkbox.checked ? selected.add(row.id) : selected.delete(row.id); invalidate(); });
      const request = node('div'); request.append(node('strong', row.intentId), node('p', row.method, { class: 'muted' }));
      request.append(download('buyer', row.id, 'request.json', 'Request'), download('buyer', row.id, 'buyer-review.json', 'Buyer review'));
      const body = node('div'); body.append(node('span', row.bodyBytes + ' bytes'), node('code', row.bodySha256));
      return [checkbox, request, body, row.preparationId ?? 'Available for preparation'];
    })));
  }
  function renderReview() {
    const target = $('commerce-review-result'); target.replaceChildren();
    $('commerce-prepare').textContent = reviewed?.result.kind === 'attach' ? 'Retain existing session' : 'Prepare native workspace';
    if (!reviewed) return;
    const value = reviewed.result, original = value.original;
    target.append(node('h3', value.kind === 'attach' ? 'Reviewed existing preparation' : 'Reviewed native preparation'));
    target.append(node('p', 'Saved version ' + reviewed.revision + ' · ' + value.binding.buyers.length + ' exact requests', { class: 'review-status' }));
    const summary = node('div', null, { class: 'metric-grid' });
    for (const [label, detail] of [['Payer', original.payer], ['Shared total / daily budget',
      original.sharedBudget.totalAtomic + ' / ' + original.sharedBudget.dailyAtomic + ' atomic'],
    ['Selected request total', original.sharedBudget.selectedTotalAtomic + ' atomic']]) {
      const metric = node('div', null, { class: 'metric' }); metric.append(node('small', label), node('strong', detail)); summary.append(metric);
    }
    target.append(summary);
    if (value.binding.buyers.some(row => row.buyerHeaders.accept === undefined)) target.append(node('p',
      'The original commerce request adds Accept: application/json. Both the saved buyer headers and the resulting commerce headers are retained in this handoff.', { class: 'muted' }));
    if (!original.sharedBudget.allSelectionsFitTotal) target.append(node('p',
      'The selected request total exceeds the shared budget. The original operator enforces that retained budget across executions.', { class: 'muted' }));
    const rows = node('div', null, { class: 'table-wrap' });
    rows.append(table(['Intent / method', 'Exact payment', 'Parameters / request deadline'], original.selections.map(row => [
      row.intentId + '\n' + row.routeId, row.originalTerms.amount + ' atomic · ' + row.originalTerms.network + '\n' +
        row.originalTerms.asset + ' → ' + row.originalTerms.payTo,
      row.bodyBytes + ' bytes · ' + row.bodySha256 + '\n' +
        (row.requestTimeoutMs === undefined ? 'Original request default' : row.requestTimeoutMs + ' ms') ])));
    target.append(rows, node('p', 'Review digest: ' + value.reviewSha256, { class: 'muted' }),
      download('commerce', reviewed.id, undefined, 'Download retained handoff'));
  }
  async function choosePreparation(row) {
    if (current().active.revision !== row.revision) await openVersion(row.revision);
    if (current().active.revision !== row.revision) return null;
    return { ...selection(), preparationId: row.id };
  }
  async function useReview(row) {
    if (current().active.revision !== row.revision) await openVersion(row.revision);
    if (current().active.revision !== row.revision) return;
    selection();
    $('commerce-package').value = row.request.packageId;
    await loadBuyers(true);
    selected.clear(); for (const id of row.request.buyerActionIds) selected.add(id);
    $('commerce-existing').value = row.request.existingId ?? '';
    reviewed = row; renderBuyers(); renderReview(); controls();
    $('commerce-review-result').scrollIntoView({ block: 'start', behavior: 'smooth' });
    message('Reopened the retained commerce review. Its original request identities and budgets remain selected.');
  }
  function reviewButton(row) {
    const button = node('button', 'Reopen commerce review', { type: 'button' });
    button.addEventListener('click', () => run(() => useReview(row))); return button;
  }
  function renderPreparations() {
    const target = $('commerce-preparations'); target.replaceChildren();
    if (!preparations.length) target.append(node('p', 'Reviewed preparations and attached sessions remain here across restarts.', { class: 'empty' }));
    for (const row of preparations) {
      const card = node('details', null, { class: 'package' });
      card.append(node('summary', 'Version ' + row.revision + ' · ' + row.state + ' · ' + row.id));
      card.append(node('p', row.binding.buyers.map(buyer => buyer.intentId + ' / ' + buyer.method).join('\n'), { class: 'muted' }), node('code', row.directory));
      if (row.error) card.append(node('p', row.error));
      const buttons = node('div', null, { class: 'buttons' });
      buttons.append(download('commerce', row.id, undefined, 'Download handoff'));
      const review = node('button', 'Reopen preparation review', { type: 'button' });
      review.addEventListener('click', () => run(async () => useReview(await request('/api/action?id=' + encodeURIComponent(row.id)))));
      buttons.append(review);
      if (row.state === 'READY') {
        const inspect = node('button', 'Inspect retained session', { type: 'button' });
        inspect.addEventListener('click', () => run(async () => {
          const input = await choosePreparation(row); if (!input) return;
          const result = complete(await operation('/api/commerce/inspect', input));
          $('commerce-inspection').textContent = json(result.result);
          await refreshWorkspace(); message('Read the original retained setup and buyer inbox.');
        }));
        const launch = node('button', 'Open original commerce', { type: 'button', 'data-open': row.id, class: 'primary' });
        launch.addEventListener('click', () => run(async () => {
          const input = await choosePreparation(row); if (!input) return;
          if (!confirm('Open this retained merchant and its original commerce console? Purchase execution remains an explicit action in that console.')) return;
          const result = complete(await operation('/api/commerce/open', input)); await refreshWorkspace();
          message('Commerce open ' + result.state.toLowerCase() + '. Use the original commerce console link under Merchant operation.');
        })); buttons.append(inspect, launch);
      }
      card.append(buttons); target.append(card);
    }
  }
  async function loadBuyers(reset = true) {
    const { active } = current(), packageId = $('commerce-package').value;
    const nextFilter = active.revision + '/' + packageId, requestGeneration = ++generation;
    if (nextFilter !== filter) { filter = nextFilter; selected.clear(); reviewed = null; }
    if (!packageId) { buyers = []; buyerCursor = null; renderBuyers(); renderReview(); return; }
    const query = new URLSearchParams({ revision: active.revision, packageId,
      ...(!reset && buyerCursor ? { before: buyerCursor } : {}) });
    const page = await request('/api/commerce/buyers?' + query);
    if (requestGeneration !== generation || filter !== nextFilter) return;
    buyers = reset ? page.items : [...buyers, ...page.items]; buyerCursor = page.next;
    renderBuyers(); renderReview();
  }
  async function refresh() {
    const { state, active } = current(), profile = state.commerceProfile;
    $('commerce-profile').textContent = profile.enabled ?
      (profile.canPrepare ? 'Operator ' + profile.operator.actor + ' · payer ' + profile.operator.payer +
        ' · request deadline ' + profile.requestTimeoutMs + ' ms. ' : '') +
      'Host-selected profile ' + profile.sha256 + '.' : 'Reopen with --commerce-profile to prepare or attach a native session.';
    const previous = $('commerce-package').value, available = state.packages.filter(row => row.state === 'READY' && row.revision === active.revision);
    $('commerce-package').replaceChildren(...available.map(row => node('option', 'Version ' + row.revision + ' / ' + row.id, { value: row.id })));
    if (available.some(row => row.id === previous)) $('commerce-package').value = previous;
    const existing = $('commerce-existing').value;
    $('commerce-existing').replaceChildren(...(profile.canPrepare ? [node('option', 'Create a new retained preparation', { value: '' })] : []),
      ...profile.existing.map(row => node('option', 'Attach: ' + row.label, { value: row.id })));
    if ([...$('commerce-existing').options].some(option => option.value === existing)) $('commerce-existing').value = existing;
    preparations = state.commercePreparations.items; preparationCursor = state.commercePreparations.next;
    await loadBuyers(true); renderPreparations(); controls();
  }
  $('commerce-package').addEventListener('change', () => run(async () => { await loadBuyers(true); controls(); }));
  $('commerce-existing').addEventListener('change', invalidate);
  $('commerce-review').addEventListener('click', () => run(async () => {
    const result = complete(await operation('/api/commerce/review', { ...selection(), packageId: $('commerce-package').value,
      buyerActionIds: selectedIds(), existingId: $('commerce-existing').value || null }));
    await refreshWorkspace(); reviewed = result; renderReview();
    message('Commerce review retained. Check every request, payer and shared budget before preparing the session.');
  }));
  $('commerce-prepare').addEventListener('click', () => run(async () => {
    if (!reviewed) throw new Error('Reopen a retained commerce review first.');
    const attaching = reviewed.result.kind === 'attach';
    if (!confirm(attaching ? 'Attach this exact existing preparation and its original ledger to the workspace?' :
      'Prepare the reviewed native buyer workspace with this shared budget and these exact request identities?')) return;
    const result = complete(await operation('/api/commerce/prepare', { ...selection(), commerceReviewId: reviewed.id,
      reviewSha256: reviewed.result.reviewSha256 }));
    selected.clear(); reviewed = null; await refreshWorkspace();
    message('Retained preparation ' + result.result.state.toLowerCase() + '. Open its original commerce session below.');
  }));
  $('commerce-older-buyers').addEventListener('click', () => run(() => loadBuyers(false)));
  $('commerce-older-preparations').addEventListener('click', () => run(async () => {
    const page = await request('/api/commerce/preparations?before=' + encodeURIComponent(preparationCursor));
    preparations.push(...page.items); preparationCursor = page.next; renderPreparations();
  }));
  return { refresh, controls, reviewButton };
}
