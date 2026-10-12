import { matchProductRequirements, normalizeProductRequirements, productReviewRequest } from '/product-requirements.mjs';
import { productPlanRuntimes } from '/product-plan-runtime.mjs';
// MIT. Complete source-product workflow over the original workspace operations.
import { searchProductCatalog, productSourceSummary, compareProductSources,
  formatProductCatalogMarkdown } from '../../product-catalog/catalog.mjs';
const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const query = (path, values) => path + '?' + new URLSearchParams(values);
function facts(rows, className = 'paths') {
  const list = make('dl', undefined, className);
  for (const [label, value] of rows) {
    const row = make('div'); row.append(make('dt', label), make('dd', String(value ?? '—'))); list.append(row);
  }
  return list;
}
function table(headers, rows) {
  const wrap = make('div', undefined, 'table-wrap'), node = make('table'), head = make('thead');
  const header = make('tr'), body = make('tbody');
  for (const title of headers) header.append(make('th', title)); head.append(header);
  for (const values of rows) { const row = make('tr'); for (const value of values) row.append(make('td', String(value ?? '—'))); body.append(row); }
  node.append(head, body); wrap.append(node); return wrap;
}
function detail(title, value) {
  const node = make('details'); node.append(make('summary', title), value); return node;
}
export function createSourceBuildWorkspaceView({ root, api, getState, operation,
  refreshWorkspace, openLog, switchView, chooseArchive, chooseRuntime, message, error }) {
  let workspaceId = null, epoch = 0, pending = false, reading = false, readAgain = false;
  let catalog = null, review = null, selectedReviewId = null, builds = [], savedSelection = '';
  let sourceSignature = '', listSignature = '', reviewSignature = '', lastRead = 0, nodes = null;
  let productPreview = null, comparison = null, comparedSelections = [];
  let queryText = '', showUnavailable = false, visibleProducts = 25;
  let requiredCapabilities = [], requirementMatch = 'all', requirementSort = 'source';
  let plans = [], planTotal = 0, planCursor = null, planNextCursor = null, planPages = [], planQuery = '';
  let receiving = [], activePlan = null, selectedPlanId = null, selectedBindingId = null, pendingPlanSaves = [];
  let importedPlan = null, importedFilename = '', plansLoaded = false;
  let receivingQuery = '', receivingStatus = 'all', receivingTotal = 0, receivingCursor = null, receivingNextCursor = null, receivingPages = [];
  let briefingDialog = null, planRuntimesSignature = '';
  const productDetails = new Map();
  const key = () => 'starforge-source-builds-' + workspaceId;
  const snapshot = () => ({ repository: nodes.repository.value.trim(), ref: nodes.ref.value.trim() || 'HEAD',
    offline: nodes.offline.checked, python: nodes.python.value.trim() || 'python3',
    selection: nodes.product.value || savedSelection, selectedReviewId,
    query: queryText, showUnavailable, comparedSelections, requiredCapabilities, requirementMatch, requirementSort,
    selectedPlanId, selectedBindingId, planLabel: nodes.planLabel.value, planPurpose: nodes.planPurpose.value,
    planQuery, pendingPlanSaves, receivingQuery, receivingStatus });
  const operationFor = id => getState()?.operations.find(item => item.id === id);
  function persist() {
    if (!nodes || !workspaceId) return;
    try { localStorage.setItem(key(), JSON.stringify(snapshot())); } catch {}
  }
  function availability() {
    if (!nodes) return;
    nodes.fields.disabled = pending;
    nodes.product.disabled = pending || !catalog;
    const selected = catalog?.products.find(item => item.id === nodes.product.value);
    const requirementsCovered = !requiredCapabilities.length || !selected?.capabilityError &&
      requiredCapabilities.every(id => selected?.requirements?.includes(id));
    nodes.reviewButton.disabled = pending || !catalog || !nodes.product.value || !requirementsCovered;
    nodes.savePlan.disabled = pending || !catalog || !selected?.available || !requirementsCovered || !nodes.planLabel.value.trim();
    nodes.receivePlan.disabled = pending || !importedPlan || !nodes.repository.value.trim();
    nodes.planFile.disabled = pending; nodes.planSearch.disabled = pending;
    nodes.planSearchForm.querySelector('button').disabled = pending;
    nodes.receivingSearch.disabled = pending; nodes.receivingStatus.disabled = pending;
    nodes.receivingForm.querySelector('button').disabled = pending;
    nodes.compareButton.disabled = pending || !catalog || comparedSelections.length < 2;
    nodes.search.disabled = pending || !catalog;
    nodes.showUnavailable.disabled = pending || !catalog;
    for (const checkbox of root.querySelectorAll('input[data-compare-id]'))
      checkbox.disabled = pending || (!checkbox.checked && comparedSelections.length >= 4);
    for (const button of root.querySelectorAll('button[data-action]'))
      button.disabled = pending || button.dataset.unavailable === 'true';
    root.setAttribute('aria-busy', String(pending || reading));
  }
  async function perform(action) {
    ensure();
    if (pending) return;
    const ticket = epoch, alive = () => epoch === ticket && workspaceId === getState()?.workspaceId;
    pending = true; message(''); availability();
    try { await action(alive); }
    catch (value) { if (alive()) error(value); }
    finally {
      if (alive()) { pending = false; renderPlanDetails(); renderReview(); renderBuilds(true); availability(); }
    }
  }
  function button(label, action, unavailable = false) {
    const node = make('button', label); node.type = 'button'; node.dataset.action = 'true';
    node.dataset.unavailable = String(unavailable); node.disabled = unavailable || pending;
    node.addEventListener('click', () => perform(action)); return node;
  }
  function reset() {
    briefingDialog?.close(); briefingDialog?.remove(); briefingDialog = null;
    epoch++; workspaceId = null; pending = false; reading = false; readAgain = false;
    catalog = null; review = null; selectedReviewId = null; builds = []; savedSelection = '';
    productPreview = null; comparison = null; comparedSelections = [];
    queryText = ''; showUnavailable = false; visibleProducts = 25; productDetails.clear();
    requiredCapabilities = []; requirementMatch = 'all'; requirementSort = 'source';
    plans = []; planTotal = 0; planCursor = null; planNextCursor = null; planPages = []; planQuery = '';
    receiving = []; activePlan = null; selectedPlanId = null; selectedBindingId = null; pendingPlanSaves = [];
    importedPlan = null; importedFilename = ''; plansLoaded = false;
    receivingQuery = ''; receivingStatus = 'all'; receivingTotal = 0; receivingCursor = null; receivingNextCursor = null; receivingPages = [];
    sourceSignature = ''; listSignature = ''; reviewSignature = ''; lastRead = 0; nodes = null; root.replaceChildren();
  }
  function ensure() {
    const id = getState()?.workspaceId;
    if (!id) throw new Error('Open the runtime workspace before choosing source.');
    if (workspaceId === id) return;
    reset(); workspaceId = id;
    root.innerHTML = '<link rel="stylesheet" href="/source-catalog.css"><link rel="stylesheet" href="/product-plan-briefing.css">' + '<div class="section-title"><div><p class="eyebrow">PRODUCT SOURCE</p><h2>Build a product from source</h2></div></div>' +
      '<p class="muted">Choose a committed product from a Git repository on this machine. Review its contents, build its package, then select adapters for installation.</p>' +
      '<section class="panel"><div class="section-title"><div><p class="eyebrow">PRODUCT PLANS</p><h3>Save and continue a product</h3></div><span data-plan-count class="count">0</span></div>' +
      '<p class="muted">Keep the requested capabilities, exact source, dependency inspection and original build together. Reopen a plan here or receive its complete document in another workspace.</p>' +
      '<form data-plan-search-form class="actions"><label>Find a saved plan<input data-plan-search type="search" placeholder="Name, purpose or capability" autocomplete="off"></label><button type="submit">Find plans</button></form>' +
      '<div data-plan-list></div><div data-plan-pages class="actions"></div><div data-plan-pending></div>' +
      '<details><summary>Receive a product plan</summary><label>Complete plan document<input data-plan-file type="file" accept="application/json,.json"></label>' +
      '<p data-plan-import-summary class="note">Choose an exported plan document. The source settings below select this workspace’s existing Git repository and offline mode.</p>' +
      '<button data-plan-receive type="button" disabled>Receive using current source settings</button>' +
      '<form data-plan-receiving-form class="actions"><label>Find received plans<input data-plan-receiving-search type="search" autocomplete="off"></label>' +
      '<label>Receiving status<select data-plan-receiving-status><option value="all">All receiving</option><option value="RECEIVED">Awaiting continuation</option><option value="FAILED">Needs continuation</option><option value="COMPLETE">Complete</option></select></label><button type="submit">Find received plans</button></form>' +
      '<div data-plan-receiving></div><div data-plan-receiving-pages class="actions"></div></details></section>' +
      '<section data-plan-details class="panel" hidden></section>' +
      '<div class="panel"><h3>1. Choose committed source</h3><form data-source-form><fieldset data-source-fields>' +
      '<label>Existing Git repository<input data-repository required placeholder="/srv/starforge/source" autocomplete="off" spellcheck="false"></label>' +
      '<div class="columns"><label>Branch, tag or commit<input data-ref value="HEAD" required autocomplete="off" spellcheck="false"></label>' +
      '<label>Python interpreter<input data-python value="python3" autocomplete="off" spellcheck="false"></label></div>' +
      '<label class="check"><input data-offline type="checkbox" checked>Use local Git objects only</label>' +
      '<p class="note">Clear this option to let the existing Git reader retrieve missing objects from this repository’s configured remote.</p>' +
      '<button type="submit">Load committed products</button>' +
      '<p data-commit class="note"></p><div data-catalog hidden>' +
      '<div class="source-catalog-controls"><label>Find a product<input data-product-search type="search" placeholder="Search products, such as weather or accounting" autocomplete="off"></label>' +
      '<label class="check"><input data-show-unavailable type="checkbox">Show unavailable recipes</label></div>' +
      '<div class="source-catalog-controls"><label>Required capability<input data-required-capability list="source-product-capabilities" placeholder="command:buyer-runbook" autocomplete="off"></label>' +
      '<datalist id="source-product-capabilities" data-capability-options></datalist><button data-add-requirement type="button">Add requirement</button>' +
      '<label>Coverage<select data-requirement-match><option value="all">Cover every requirement</option><option value="any">Show partial matches</option></select></label>' +
      '<label>Order<select data-requirement-sort><option value="source">Original product order</option><option value="coverage">Most requirements covered</option><option value="runtime-groups">Fewest optional runtime groups</option><option value="commands">Fewest commands</option></select></label></div>' +
      '<div data-requirement-basket class="actions" aria-label="Selected capabilities"></div><p data-capability-errors class="note"></p>' +
      '<p data-product-count class="note" role="status" aria-live="polite"></p><div data-products class="source-catalog-list"></div>' +
      '<div data-products-more class="actions"></div>' +
      '<div class="source-catalog-selection"><input data-product type="hidden"><p><strong data-product-title>No product selected</strong></p>' +
      '<p data-product-description class="note"></p><label>Plan name<input data-plan-label maxlength="200" autocomplete="off" placeholder="Name this product plan"></label>' +
      '<label>Purpose<textarea data-plan-purpose maxlength="8000" rows="3" placeholder="What this product will help the team deliver"></textarea></label>' +
      '<div class="actions"><button data-plan-save type="button" disabled>Save product plan</button><button data-review type="button" disabled>Review selected product</button></div></div>' +
      '<div class="actions"><button data-compare type="button" disabled>Compare selected products</button><span data-comparison-count class="note"></span></div>' +
      '</div></fieldset></form></div><section data-product-preview class="panel" hidden></section>' +
      '<section data-comparison class="panel" hidden></section><section data-review-panel class="panel" hidden></section>' +
      '<div class="section-title"><div><p class="eyebrow">SAVED BUILDS</p><h2>Continue or install a product</h2></div><span data-build-count class="count">0</span></div>' +
      '<p class="muted">Builds keep their source commit, package and original operation when this browser closes. Adapter installation continues in Source &amp; profile.</p>' +
      '<div data-build-list></div>';
    const find = name => root.querySelector('[data-' + name + ']');
    nodes = { fields: find('source-fields'), form: find('source-form'), repository: find('repository'),
      ref: find('ref'), python: find('python'), offline: find('offline'), commit: find('commit'),
      product: find('product'), productTitle: find('product-title'), description: find('product-description'), reviewButton: find('review'),
      catalogPanel: find('catalog'), search: find('product-search'), showUnavailable: find('show-unavailable'),
      productCount: find('product-count'), products: find('products'), productsMore: find('products-more'),
      requiredCapability: find('required-capability'), capabilityOptions: find('capability-options'), addRequirement: find('add-requirement'),
      requirementMatch: find('requirement-match'), requirementSort: find('requirement-sort'), requirementBasket: find('requirement-basket'),
      capabilityErrors: find('capability-errors'),
      productPreview: find('product-preview'), comparison: find('comparison'), compareButton: find('compare'),
      comparisonCount: find('comparison-count'),
      reviewPanel: find('review-panel'), buildList: find('build-list'), count: find('build-count'),
      planLabel: find('plan-label'), planPurpose: find('plan-purpose'), savePlan: find('plan-save'),
      planSearchForm: find('plan-search-form'), planSearch: find('plan-search'), planList: find('plan-list'),
      planCount: find('plan-count'), planPages: find('plan-pages'), planDetails: find('plan-details'),
      planPending: find('plan-pending'), planFile: find('plan-file'), receivePlan: find('plan-receive'),
      planImportSummary: find('plan-import-summary'), planReceiving: find('plan-receiving'),
      receivingForm: find('plan-receiving-form'), receivingSearch: find('plan-receiving-search'),
      receivingStatus: find('plan-receiving-status'), receivingPages: find('plan-receiving-pages') };
    let saved; try { saved = JSON.parse(localStorage.getItem(key()) ?? 'null'); } catch {}
    if (saved && typeof saved === 'object') {
      for (const name of ['repository', 'ref', 'python']) if (typeof saved[name] === 'string') nodes[name].value = saved[name];
      if (typeof saved.offline === 'boolean') nodes.offline.checked = saved.offline;
      if (typeof saved.selection === 'string') savedSelection = saved.selection;
      if (typeof saved.query === 'string') queryText = saved.query;
      if (typeof saved.showUnavailable === 'boolean') showUnavailable = saved.showUnavailable;
      if (Array.isArray(saved.comparedSelections)) comparedSelections = [...new Set(saved.comparedSelections.filter(value => typeof value === 'string'))].slice(0, 4);
      if (/^[a-f0-9]{24}$/.test(saved.selectedReviewId ?? '')) selectedReviewId = saved.selectedReviewId;
      if (/^[a-f0-9]{24}$/.test(saved.selectedPlanId ?? '')) selectedPlanId = saved.selectedPlanId;
      if (/^[a-f0-9]{24}$/.test(saved.selectedBindingId ?? '')) selectedBindingId = saved.selectedBindingId;
      if (typeof saved.planLabel === 'string') nodes.planLabel.value = saved.planLabel;
      if (typeof saved.planPurpose === 'string') nodes.planPurpose.value = saved.planPurpose;
      if (typeof saved.planQuery === 'string') planQuery = saved.planQuery;
      if (typeof saved.receivingQuery === 'string') receivingQuery = saved.receivingQuery;
      if (['all', 'RECEIVED', 'FAILED', 'COMPLETE'].includes(saved.receivingStatus)) receivingStatus = saved.receivingStatus;
      if (Array.isArray(saved.pendingPlanSaves)) pendingPlanSaves = saved.pendingPlanSaves.filter(value =>
        value && typeof value === 'object' && typeof value.label === 'string' && typeof value.repository === 'string');

    }
    try { requiredCapabilities = normalizeProductRequirements(saved?.requiredCapabilities ?? []); } catch {}
    if (['all', 'any'].includes(saved?.requirementMatch)) requirementMatch = saved.requirementMatch;
    if (['source', 'coverage', 'runtime-groups', 'commands'].includes(saved?.requirementSort)) requirementSort = saved.requirementSort;
    nodes.requirementMatch.value = requirementMatch; nodes.requirementSort.value = requirementSort;
    const addCapability = () => {
      try {
        requiredCapabilities = normalizeProductRequirements([...requiredCapabilities, nodes.requiredCapability.value.trim()]);
        detachPlan(true); nodes.requiredCapability.value = ''; visibleProducts = 25; persist(); renderCatalog(); renderProductPreview();
      } catch (value) { error(value); }
    };
    nodes.addRequirement.addEventListener('click', addCapability);
    nodes.requiredCapability.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); addCapability(); }
    });
    nodes.requirementMatch.addEventListener('change', () => {
      requirementMatch = nodes.requirementMatch.value; visibleProducts = 25; persist(); renderCatalog();
    });
    nodes.requirementSort.addEventListener('change', () => {
      requirementSort = nodes.requirementSort.value; visibleProducts = 25; persist(); renderCatalog();
    });
    nodes.search.value = queryText; nodes.showUnavailable.checked = showUnavailable;
    const invalidate = source => {
      detachPlan(true); review = null; selectedReviewId = null;
      if (source) {
        catalog = null; nodes.commit.textContent = ''; nodes.description.textContent = '';
        nodes.product.value = ''; nodes.productTitle.textContent = 'No product selected';
        nodes.catalogPanel.hidden = true; productPreview = null; comparison = null;
        productDetails.clear(); renderProductPreview(); renderComparison();
      }
      renderReview(); renderPlans(); availability(); persist();
    };
    for (const field of [nodes.repository, nodes.ref]) field.addEventListener('input', () => invalidate(true));
    nodes.offline.addEventListener('change', () => invalidate(true));
    nodes.python.addEventListener('input', () => {
      productPreview = null; comparison = null; productDetails.clear();
      renderProductPreview(); renderComparison(); invalidate(false);
    });
    nodes.search.addEventListener('input', () => {
      queryText = nodes.search.value; visibleProducts = 25; persist(); renderCatalog();
    });
    nodes.showUnavailable.addEventListener('change', () => {
      showUnavailable = nodes.showUnavailable.checked; visibleProducts = 25; persist(); renderCatalog();
    });
    nodes.compareButton.addEventListener('click', () => perform(async alive => {
      if (!catalog || comparedSelections.length < 2) throw new Error('Choose at least two products to compare.');
      const selected = [...comparedSelections], values = [];
      for (const id of selected) { values.push(await describeProduct(id, alive)); if (!alive()) return; }
      comparison = compareProductSources(values); renderComparison();
      nodes.comparison.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }));
    nodes.form.addEventListener('submit', event => {
      event.preventDefault();
      perform(async alive => {
        const input = snapshot();
        const value = await api('/api/source-builds/catalog', { repository: input.repository, ref: input.ref, offline: input.offline });
        if (!alive()) return;
        detachPlan(true); catalog = value; review = null; selectedReviewId = null;
        productPreview = null; comparison = null; productDetails.clear(); visibleProducts = 25;
        nodes.commit.textContent = 'Source version: ' + value.sourceCommit;
        nodes.capabilityOptions.replaceChildren(...(value.capabilities ?? []).map(item => {
          const option = make('option'); option.value = item.id;
          option.label = item.kind + ' · ' + item.products + ' products'; return option;
        }));
        comparedSelections = comparedSelections.filter(id => value.products.some(item => item.available && item.id === id));
        nodes.product.value = ''; nodes.productTitle.textContent = 'No product selected'; nodes.description.textContent = '';
        renderCatalog(); renderProductPreview(); renderComparison();
        if (value.products.some(item => item.available && item.id === savedSelection)) await selectProduct(savedSelection, alive);
        if (alive()) persist();
      });
    });
    nodes.reviewButton.addEventListener('click', () => perform(async alive => {
      if (!catalog || !nodes.product.value) throw new Error('Choose a committed product first.');
      const value = await api('/api/source-builds/review', productReviewRequest(catalog, nodes.product.value, {
        python: nodes.python.value.trim() || 'python3', requirements: requiredCapabilities,
      }));
      if (!alive()) return;
      review = value; selectedReviewId = value.reviewId; savedSelection = value.selection; persist();
      lastRead = 0; await refresh({ force: true });
    }));
    nodes.planSearch.value = planQuery;
    nodes.receivingSearch.value = receivingQuery; nodes.receivingStatus.value = receivingStatus;
    nodes.receivingForm.addEventListener('submit', event => {
      event.preventDefault(); perform(async alive => {
        receivingQuery = nodes.receivingSearch.value.trim(); receivingStatus = nodes.receivingStatus.value;
        receivingCursor = null; receivingPages = []; persist(); await readPlans(alive);
      });
    });
    for (const field of [nodes.planLabel, nodes.planPurpose]) field.addEventListener('input', () => {
      detachPlan(false); persist(); availability();
    });
    nodes.planSearchForm.addEventListener('submit', event => {
      event.preventDefault();
      perform(async alive => { planQuery = nodes.planSearch.value.trim(); planCursor = null; planPages = [];
        persist(); await readPlans(alive); });
    });
    nodes.savePlan.addEventListener('click', () => perform(async alive => {
      if (!catalog || !nodes.product.value) throw new Error('Choose a committed product first.');
      const request = { ...productReviewRequest(catalog, nodes.product.value, {
        python: nodes.python.value.trim() || 'python3', requirements: requiredCapabilities,
      }), requirements: [...requiredCapabilities], label: nodes.planLabel.value.trim(), purpose: nodes.planPurpose.value.trim() };
      await savePlan(request, alive);
    }));
    nodes.planFile.addEventListener('change', () => perform(async alive => {
      const file = nodes.planFile.files?.[0]; importedPlan = null; importedFilename = '';
      nodes.planImportSummary.textContent = 'Reading the selected plan document…';
      if (!file) { nodes.planImportSummary.textContent = 'Choose a complete exported plan document.'; return; }
      if (file.size > 16 * 1024 * 1024) throw new Error('Choose a complete product plan of at most 16 MiB.');
      const value = JSON.parse(await file.text());
      if (!alive()) return;
      if (value?.schema !== 'stellar-forge.runtime-product-plan-bundle.v1' || typeof value.plan?.intent?.label !== 'string')
        throw new Error('Choose a complete product plan export.');
      importedPlan = value; importedFilename = file.name;
      nodes.planImportSummary.textContent = value.plan.intent.label + ' · ' + value.plan.intent.selection + ' · ' +
        value.plan.intent.sourceCommit + ' · ' + (value.plan.intent.requirements?.length ?? 0) +
        ' capabilities · ' + file.name + '. Receive using this workspace’s source settings below.';
      availability();
    }));
    nodes.receivePlan.addEventListener('click', () => perform(alive => receivePlan(importedPlan, alive)));
    renderPlans(); renderBuilds(true); availability();
  }
  function detachPlan(clearReview = false) {
    activePlan = null; selectedPlanId = null; selectedBindingId = null;
    if (clearReview) { review = null; selectedReviewId = null; reviewSignature = ''; renderReview(); }
    renderPlanDetails();
  }
  function acceptPlan(value, alive) {
    if (!alive()) return;
    if (value.workspaceId !== workspaceId || value.plan?.intent?.sourceCommit !== value.catalog?.sourceCommit ||
        value.review?.requestId !== value.buildRequest?.requestId)
      throw new Error('Reopen this product plan in the current workspace.');
    activePlan = value; selectedPlanId = value.plan.planId; selectedBindingId = value.bindingId;
    catalog = value.catalog; review = value.review; selectedReviewId = value.review.reviewId;
    savedSelection = value.plan.intent.selection; requiredCapabilities = [...value.plan.intent.requirements];
    nodes.repository.value = value.review.repository; nodes.ref.value = value.plan.intent.sourceCommit;
    nodes.offline.checked = value.review.offline; nodes.python.value = value.review.python;
    nodes.planLabel.value = value.plan.intent.label; nodes.planPurpose.value = value.plan.intent.purpose;
    nodes.product.value = savedSelection; nodes.productTitle.textContent = value.plan.catalogProduct.title;
    nodes.description.textContent = value.plan.catalogProduct.description ?? '';
    nodes.commit.textContent = 'Saved source version: ' + value.plan.intent.sourceCommit +
      '. Load committed products to browse all recipes at this source.';
    queryText = ''; nodes.search.value = ''; comparedSelections = []; comparison = null;
    requirementMatch = 'all'; nodes.requirementMatch.value = 'all'; visibleProducts = 25;
    nodes.capabilityOptions.replaceChildren(...(catalog.capabilities ?? []).map(item => {
      const option = make('option'); option.value = item.id; option.label = item.kind; return option;
    }));
    productDetails.clear();
    productDetails.set(JSON.stringify({ repository: value.review.repository, ref: value.plan.intent.sourceCommit,
      selection: savedSelection, offline: value.review.offline, python: value.review.python }), value.product);
    productPreview = { source: value.product, summary: productSourceSummary(value.product) };
    reviewSignature = ''; renderCatalog(); renderProductPreview(); renderComparison();
    renderPlanDetails(); renderReview(); persist(); availability();
  }
  async function openPlan(planId, alive, bindingId = undefined) {
    const value = await api(query('/api/source-builds/plan', { planId, ...(bindingId ? { bindingId } : {}) }));
    if (!alive()) return;
    acceptPlan(value, alive);
  }
  async function readPlans(alive) {
    const requested = { query: planQuery, cursor: planCursor, receivingQuery, receivingStatus, receivingCursor };
    const value = await api(query('/api/source-builds/plans', {
      query: requested.query, limit: 30, ...(requested.cursor ? { cursor: requested.cursor } : {}),
      receivingQuery: requested.receivingQuery, receivingStatus: requested.receivingStatus, receivingLimit: 30,
      ...(requested.receivingCursor ? { receivingCursor: requested.receivingCursor } : {}),
    }));
    if (!alive() || value.workspaceId !== workspaceId || requested.query !== planQuery || requested.cursor !== planCursor ||
      requested.receivingQuery !== receivingQuery || requested.receivingStatus !== receivingStatus || requested.receivingCursor !== receivingCursor) return;
    plans = value.plans; planTotal = value.total; planNextCursor = value.nextCursor; receiving = value.receiving;
    receivingTotal = value.receivingTotal; receivingNextCursor = value.receivingNextCursor;
    plansLoaded = true; renderPlans(); renderPlanDetails();
  }
  async function refreshPlansAfter(action, alive) {
    let value, failure;
    try { value = await action(); } catch (error) { failure = error; }
    if (alive()) {
      try { await readPlans(alive); } catch (error) { failure ??= error; }
      lastRead = 0;
    }
    if (failure) throw failure;
    return value;
  }
  async function savePlan(request, alive) {
    const key = JSON.stringify(request);
    if (!pendingPlanSaves.some(item => JSON.stringify(item) === key)) pendingPlanSaves.push(request);
    persist(); renderPlans();
    return refreshPlansAfter(async () => {
      const value = await api('/api/source-builds/plan-save', request);
      if (!alive()) return;
      pendingPlanSaves = pendingPlanSaves.filter(item => JSON.stringify(item) !== key);
      acceptPlan(value, alive); planCursor = null; planPages = []; persist();
      message('Saved ' + value.plan.intent.label + '. Its exact source, capability requirements and original build are ready to reopen.');
    }, alive);
  }
  async function receivePlan(bundle, alive) {
    if (!bundle || !nodes.repository.value.trim()) throw new Error('Choose a plan and this workspace’s existing Git repository.');
    const input = snapshot();
    return refreshPlansAfter(async () => {
      const value = await api('/api/source-builds/plan-receive', { bundle,
        repository: input.repository, offline: input.offline, python: input.python });
      if (!alive()) return;
      acceptPlan(value, alive); planCursor = null; planPages = []; receivingCursor = null; receivingPages = [];
      importedPlan = null; importedFilename = ''; nodes.planFile.value = '';
      nodes.planImportSummary.textContent = 'Received ' + value.plan.intent.label + '. The complete original document is retained with its receiving record.';
      message('Received ' + value.plan.intent.label + ' into this workspace. Continue through its original saved review and build below.');
    }, alive);
  }
  async function continueReceiving(receiptId, alive) {
    return refreshPlansAfter(async () => {
      const value = await api('/api/source-builds/plan-receive-continue', { receiptId });
      if (!alive()) return;
      acceptPlan(value, alive); message('Reopened the retained product plan and its original local build.');
    }, alive);
  }
  function renderPlans() {
    if (!nodes) return;
    nodes.planCount.textContent = String(planTotal);
    nodes.planList.replaceChildren(); nodes.planPages.replaceChildren(); nodes.planPending.replaceChildren();
    if (!plans.length) nodes.planList.append(make('p', plansLoaded ?
      (planQuery ? 'No saved plans match this search.' : 'Choose a product below and save its purpose and capability requirements.') :
      'Reading saved product plans…', 'empty'));
    for (const plan of plans) {
      const card = make('article', undefined, 'operation'); card.dataset.planId = plan.planId;
      const heading = make('div', undefined, 'section-title');
      heading.append(make('h4', plan.label), make('span', plan.bindings.length ? 'Saved' : 'Receiving', 'status'));
      card.append(heading, make('p', plan.purpose || plan.title, 'muted'));
      card.append(facts([['Product', plan.selection], ['Source commit', plan.sourceCommit],
        ['Requirements', plan.requirements.join(', ') || 'Selected product contents']]));
      const actions = make('div', undefined, 'actions');
      if (plan.bindings.length) actions.append(button('Open saved plan', async alive => {
        await openPlan(plan.planId, alive);
        if (alive()) nodes.planDetails.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }));
      else actions.append(button('Finish with current source settings', async alive => {
        const bundle = await api(query('/api/source-builds/plan-export', { planId: plan.planId }));
        if (alive()) await receivePlan(bundle, alive);
      }, !nodes.repository.value.trim()));
      if (plan.bindings.length) actions.append(button('View briefing', alive => showBriefing(plan.planId, null, alive)));
      actions.append(button('Export complete plan', async alive => {
        const bundle = await api(query('/api/source-builds/plan-export', { planId: plan.planId }));
        if (alive()) exportValue('product-plan-' + plan.planId, bundle);
      }));
      card.append(actions); nodes.planList.append(card);
    }
    if (planPages.length) nodes.planPages.append(button('Previous plans', async alive => {
      planCursor = planPages.pop(); await readPlans(alive);
    }));
    if (planNextCursor) nodes.planPages.append(button('Next plans', async alive => {
      planPages.push(planCursor); planCursor = planNextCursor; await readPlans(alive);
    }));
    if (plans.length) nodes.planPages.append(make('span', plans.length + ' on this page · ' + planTotal + ' matching plans', 'note'));
    nodes.planPages.append(button('Refresh plans', async alive => {
      planCursor = null; planPages = []; await readPlans(alive);
    }));
    for (const request of pendingPlanSaves) {
      const row = make('div', undefined, 'actions');
      row.append(make('span', 'Retained save request: ' + request.label, 'note'),
        button('Continue saving ' + request.label, alive => savePlan(request, alive)),
        button('Download save request', async alive => { if (alive()) exportValue('product-plan-save-request', request); }));
      nodes.planPending.append(row);
    }
    nodes.planReceiving.replaceChildren(); nodes.receivingPages.replaceChildren();
    nodes.planReceiving.append(make('h4', 'Retained receiving · ' + receivingTotal));
    if (!receiving.length) nodes.planReceiving.append(make('p', 'No received plans match this search and status.', 'empty'));
    for (const receipt of receiving) {
      const card = make('article', undefined, 'operation'); card.dataset.planReceiptId = receipt.receiptId;
      card.append(make('strong', receipt.label), make('p', receipt.status + ' · ' + (receipt.repository ?? 'Original source settings retained'), 'note'));
      if (receipt.summaryPending) card.append(make('p', 'Continue receiving to recover this retained document’s full description.', 'note'));
      if (receipt.error) card.append(make('p', receipt.error.message));
      const actions = make('div', undefined, 'actions');
      actions.append(button(receipt.status === 'COMPLETE' ? 'Open received plan' : 'Continue receiving',
        alive => continueReceiving(receipt.receiptId, alive)));
      actions.append(button('Download original plan', async alive => {
        const value = await api(query('/api/source-builds/plan-receiving', { receiptId: receipt.receiptId }));
        if (alive()) exportValue('product-plan-' + value.input.bundle.plan.planId, value.input.bundle);
      }));
      if (receipt.status !== 'COMPLETE') actions.append(button('Use current source settings', async alive => {
        const value = await api(query('/api/source-builds/plan-receiving', { receiptId: receipt.receiptId }));
        if (alive()) await receivePlan(value.input.bundle, alive);
      }, !nodes.repository.value.trim()));
      card.append(actions); nodes.planReceiving.append(card);
    }
    if (receivingPages.length) nodes.receivingPages.append(button('Previous received plans', async alive => {
      receivingCursor = receivingPages.pop(); await readPlans(alive);
    }));
    if (receivingNextCursor) nodes.receivingPages.append(button('Next received plans', async alive => {
      receivingPages.push(receivingCursor); receivingCursor = receivingNextCursor; await readPlans(alive);
    }));
    if (receiving.length) nodes.receivingPages.append(make('span', receiving.length + ' on this page · ' + receivingTotal + ' matching received plans', 'note'));
    nodes.receivingPages.append(button('Refresh receiving', async alive => {
      receivingCursor = null; receivingPages = []; await readPlans(alive);
    }));
    availability();
  }
  function downloadBriefing(value) {
    const url = URL.createObjectURL(new Blob([value.content], { type: value.mimeType })), link = make('a');
    link.href = url; link.download = value.filename; root.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function readBriefing(planId, bindingId, format, alive, runtimeId) {
    const value = await api(query('/api/source-builds/plan-briefing', { planId, format,
      ...(bindingId ? { bindingId } : {}), ...(runtimeId ? { runtimeId } : {}) }));
    if (!alive()) return null;
    if (value.planId !== planId || (bindingId && value.bindingId !== bindingId) ||
      (runtimeId && value.runtimeId !== runtimeId) || value.format !== format || typeof value.content !== 'string')
      throw new Error('Reopen this saved plan before exporting its briefing.');
    return value;
  }
  async function showBriefing(planId, bindingId, alive, runtimeId) {
    const value = await readBriefing(planId, bindingId, 'html', alive, runtimeId);
    if (!value) return;
    const source = new DOMParser().parseFromString(value.content, 'text/html').body;
    const main = source.firstElementChild;
    if (source.children.length !== 1 || main?.tagName !== 'MAIN' || !main.classList.contains('product-briefing') ||
      main.querySelector('script,iframe,object,embed,form,img,link,style'))
      throw new Error('Reopen this saved plan to prepare its complete briefing.');
    briefingDialog?.close(); briefingDialog?.remove();
    const dialog = make('dialog'), header = make('div', undefined, 'briefing-toolbar'), actions = make('div', undefined, 'actions');
    briefingDialog = dialog; dialog.dataset.productBriefing = 'true';
    dialog.setAttribute('aria-label', 'Product briefing');
    const print = make('button', 'Print / save PDF'), download = make('button', 'Download HTML'), close = make('button', 'Close briefing');
    for (const node of [print, download, close]) node.type = 'button';
    const sheet = root.querySelector('link[href="/product-plan-briefing.css"]');
    if (!sheet?.sheet) { print.disabled = true; sheet?.addEventListener('load', () => { print.disabled = false; }, { once: true }); }
    print.addEventListener('click', () => window.print());
    download.addEventListener('click', () => downloadBriefing(value));
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { dialog.remove(); if (briefingDialog === dialog) briefingDialog = null; }, { once: true });
    actions.append(print, download, close); header.append(make('h3', 'Product briefing'), actions);
    dialog.append(header, document.importNode(main, true)); document.body.append(dialog); dialog.showModal(); close.focus();
  }
  function renderPlanRuntimes() {
    const panel = nodes?.planDetails.querySelector('[data-plan-runtimes]');
    if (!panel || !activePlan) return;
    const value = activePlan;
    let installed;
    try { installed = productPlanRuntimes(value, getState(), { builds }); }
    catch (failure) {
      panel.replaceChildren(make('h4', 'Installed runtimes'), make('p', String(failure.message ?? failure), 'note'));
      planRuntimesSignature = ''; return;
    }
    const signature = JSON.stringify([installed, pending]);
    if (planRuntimesSignature === signature) return;
    planRuntimesSignature = signature;
    panel.replaceChildren(make('h4', 'Installed runtimes'));
    if (!installed.build?.archive) {
      panel.append(make('p', 'Build this saved product through its original review below. Its package will connect to the runtimes prepared from that exact archive.', 'muted'));
      return;
    }
    panel.append(make('p', 'These runtimes use the original package archive. Open a runtime to continue its existing preparation, installation or recovery. Select a ready runtime to inspect its source and export the operating handoff.', 'muted'));
    if (!installed.runtimes.length) {
      panel.append(make('p', 'Choose adapters and install from the original build below. A retained preparation appears here as soon as it selects this archive.', 'note'));
      return;
    }
    for (const runtime of installed.runtimes) {
      const row = make('div', undefined, 'operation'), heading = make('div', undefined, 'section-title');
      heading.append(make('strong', runtime.label), make('span', runtime.phase, 'status'));
      row.append(heading, facts([['Runtime', runtime.runtimeId], ['Directory', runtime.directory],
        ['Adapter profile', runtime.profileId], ['Installation', runtime.installationId],
        ['Package SHA-256', runtime.archiveSha256]]));
      if (runtime.errorCode || runtime.preparationErrorCode)
        row.append(make('p', runtime.errorCode ?? runtime.preparationErrorCode, 'note'));
      const actions = make('div', undefined, 'actions');
      if (getState()?.runtimes.some(item => item.id === runtime.runtimeId))
        actions.append(button('Open original Runtime', async alive => { if (alive()) await chooseRuntime(runtime.runtimeId); }));
      for (const original of runtime.operations) actions.append(button(
        original.operation + ' · ' + (original.displayPhase ?? original.phase) + ' · open operation',
        async alive => { if (alive()) await openLog({ operationId: original.id }); }));
      if (runtime.phase === 'READY') {
        actions.append(button('Inspect and export installed handoff', async alive => {
          const handoff = await api(query('/api/source-builds/plan-handoff', {
            planId: value.plan.planId, bindingId: value.bindingId, runtimeId: runtime.runtimeId,
          }));
          if (!alive()) return;
          if (handoff.planId !== value.plan.planId || handoff.bindingId !== value.bindingId ||
            handoff.sourceCommit !== value.plan.intent.sourceCommit || handoff.runtime?.runtimeId !== runtime.runtimeId ||
            handoff.archive?.sha256 !== installed.build.archive.sha256)
            throw new Error('Reopen this saved plan and its selected original runtime.');
          exportValue('product-plan-' + value.plan.planId + '-runtime-' + runtime.runtimeId + '-handoff', handoff);
          message('Exported the original installed Runtime handoff and its current source and dependency inspection.');
        }), button('View installed briefing', alive =>
          showBriefing(value.plan.planId, value.bindingId, alive, runtime.runtimeId)),
        button('Export installed Markdown', async alive => {
          const briefing = await readBriefing(value.plan.planId, value.bindingId, 'markdown', alive, runtime.runtimeId);
          if (briefing) downloadBriefing(briefing);
        }));
      }
      row.append(actions); panel.append(row);
    }
  }
  function renderPlanDetails() {
    if (!nodes) return;
    const panel = nodes.planDetails; panel.hidden = !activePlan; panel.replaceChildren();
    if (!activePlan) return;
    const value = activePlan, intent = value.plan.intent, heading = make('div', undefined, 'section-title');
    heading.append(make('h3', intent.label), make('span', 'Saved product plan', 'status'));
    panel.append(heading, make('p', intent.purpose || value.plan.catalogProduct.description, 'muted'));
    panel.append(facts([['Plan', value.plan.planId], ['Source commit', intent.sourceCommit],
      ['Selected product', intent.selection], ['Required capabilities', intent.requirements.join(', ') || 'Selected product contents'],
      ['Original review', value.review.reviewId], ['Original build operation', value.review.requestId],
      ['Source mode', value.review.offline ? 'Local Git objects only' : 'Existing Git reader may retrieve missing objects']]));
    const actions = make('div', undefined, 'actions');
    actions.append(button('View / print briefing', alive => showBriefing(value.plan.planId, value.bindingId, alive)),
      button('Export Markdown briefing', async alive => {
        const briefing = await readBriefing(value.plan.planId, value.bindingId, 'markdown', alive);
        if (briefing) downloadBriefing(briefing);
      }));
    actions.append(button('Export complete plan', async alive => {
      const bundle = await api(query('/api/source-builds/plan-export', { planId: value.plan.planId }));
      if (alive()) exportValue('product-plan-' + value.plan.planId, bundle);
    }), button('Save original build request', async alive => {
      if (alive()) exportValue('product-plan-' + value.plan.planId + '-build-request', value.buildRequest);
    }), button('Refresh source inspection', async alive => {
      const updated = await api('/api/source-builds/plan-refresh', { planId: value.plan.planId, bindingId: value.bindingId });
      if (!alive()) return; acceptPlan(updated, alive); await readPlans(alive);
      if (alive()) message('Refreshed the exact committed source and dependency manifests using this plan’s saved source settings.');
    }));
    panel.append(actions, make('p', 'The product details below use the retained inspection for this exact source. The saved review continues through the existing build and adapter installation controls.', 'note'));
    const runtimes = make('section'); runtimes.dataset.planRuntimes = 'true';
    planRuntimesSignature = ''; panel.append(runtimes); renderPlanRuntimes();
    const origins = make('div');
    for (const origin of value.origins) {
      const build = origin.local ? builds.find(item => item.reviewId === origin.review.reviewId && item.requestId === origin.review.requestId) : null;
      const row = make('div', undefined, 'operation');
      row.append(make('strong', origin.local ? 'This workspace' : 'Origin workspace'),
        facts([['Workspace', origin.workspaceId], ['Repository', origin.review.repository],
          ['Review', origin.review.reviewId], ['Build operation', origin.review.requestId],
          ['Recorded', origin.createdAt], ['Current build', origin.local ? build?.phase ?? 'Reviewed' : 'See received history']]));
      if (origin.local && origin.originId !== value.bindingId) row.append(button('Open this local review',
        alive => openPlan(value.plan.planId, alive, origin.originId)));
      origins.append(row);
    }
    panel.append(detail('Workspace and review history (' + value.origins.length + ')', origins));
    if (value.observations.length) panel.append(detail('Build history received with this plan',
      table(['Workspace', 'Operation', 'Observed', 'Phase', 'Package SHA-256'],
        value.observations.map(item => [item.workspaceId, item.build.requestId, item.observedAt, item.build.phase, item.build.archive?.sha256]))));
  }
  async function describeProduct(id, alive) {
    if (!catalog || !catalog.products.some(item => item.available && item.id === id))
      throw new Error('Reload the source catalog and choose an available product.');
    const input = { repository: catalog.repository, ref: catalog.sourceCommit, selection: id,
      offline: catalog.offline, python: nodes.python.value.trim() || 'python3' };
    const cacheKey = JSON.stringify(input);
    if (productDetails.has(cacheKey)) return productDetails.get(cacheKey);
    const value = await api('/api/source-builds/product', input);
    if (!alive()) return null;
    if (value.repository !== input.repository || value.sourceCommit !== input.ref || value.selection !== id)
      throw new Error('The product source changed. Reload the committed products.');
    productDetails.set(cacheKey, value);
    return value;
  }
  async function selectProduct(id, alive) {
    const item = catalog?.products.find(value => value.available && value.id === id);
    if (!item || !alive()) return;
    if (activePlan && activePlan.plan.intent.selection === id && activePlan.plan.intent.sourceCommit === catalog.sourceCommit) return;
    detachPlan(true); nodes.product.value = id; savedSelection = id;
    if (!nodes.planLabel.value.trim()) nodes.planLabel.value = item.title;
    nodes.productTitle.textContent = item.title; nodes.description.textContent = item.description;
    review = null; selectedReviewId = null; productPreview = null;
    renderReview(); renderProductPreview(); renderCatalog(); persist();
    try {
      const value = await describeProduct(id, alive);
      if (!alive()) return;
      productPreview = { source: value, summary: productSourceSummary(value) };
    } catch (failure) {
      if (!alive()) return;
      productPreview = { failure: String(failure.message ?? failure), title: item.title, id };
    }
    renderProductPreview();
  }
  function renderCatalog() {
    if (!nodes) return;
    nodes.catalogPanel.hidden = !catalog;
    if (!catalog) return;
    const searched = searchProductCatalog(catalog, { query: queryText, availableOnly: !showUnavailable });
    const result = matchProductRequirements(searched.products, {
      requirements: requiredCapabilities, match: requirementMatch, sort: requirementSort,
    });
    nodes.requirementBasket.replaceChildren(...requiredCapabilities.map(id => button('Remove ' + id, async alive => {
      if (alive()) { requiredCapabilities = requiredCapabilities.filter(value => value !== id); detachPlan(true); visibleProducts = 25; persist(); renderCatalog(); renderProductPreview(); }
    })));
    nodes.capabilityErrors.textContent = result.unread.map(item => item.title + ': ' + item.error.message).join('\n');
    nodes.productCount.textContent = result.products.length + ' of ' + catalog.products.length + ' products' +
      (queryText.trim() || requiredCapabilities.length ? ' match your search and capability requirements.' : '.');
    nodes.comparisonCount.textContent = comparedSelections.length + ' selected for comparison · choose up to 4';
    nodes.products.replaceChildren(); nodes.productsMore.replaceChildren();
    if (!result.products.length)
      nodes.products.append(make('p', 'No products match. Change the search, capability requirements or coverage option.', 'empty'));
    for (const item of result.products.slice(0, visibleProducts)) {
      const row = make('article', undefined, 'source-catalog-row');
      if (!item.available) {
        const unavailable = make('div', undefined, 'source-catalog-unavailable');
        unavailable.append(make('strong', item.title), make('p', item.error?.message ?? 'This recipe could not be read.', 'note'));
        row.append(unavailable, make('span', 'Unavailable', 'status'));
      } else {
        const select = button(item.title, async alive => {
        await selectProduct(item.id, alive);
        if (alive() && productPreview) nodes.productPreview.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
        select.className = 'runtime-entry';
        select.setAttribute('aria-pressed', String(nodes.product.value === item.id));
        if (nodes.product.value === item.id) select.classList.add('selected');
        select.replaceChildren(make('strong', item.title), make('small', item.description || item.id));
        const label = make('label', undefined, 'check');
        const checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.dataset.compareId = item.id;
        checkbox.checked = comparedSelections.includes(item.id);
        checkbox.disabled = pending || (!checkbox.checked && comparedSelections.length >= 4);
        checkbox.setAttribute('aria-label', 'Compare ' + item.title);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked && !comparedSelections.includes(item.id) && comparedSelections.length < 4)
            comparedSelections.push(item.id);
          else if (!checkbox.checked) comparedSelections = comparedSelections.filter(id => id !== item.id);
          comparison = null; persist(); renderComparison(); renderCatalog(); availability();
          [...nodes.products.querySelectorAll('input[data-compare-id]')]
            .find(value => value.dataset.compareId === item.id)?.focus();
        });
        label.append(checkbox, make('span', 'Compare')); row.append(select, label);
        if (requiredCapabilities.length) row.append(make('p', 'Covers ' + item.requirementMatch.covered.length + '/' +
          requiredCapabilities.length + (item.requirementMatch.missing.length ? ' · missing: ' + item.requirementMatch.missing.join(', ') : ''), 'note'));
      }
      nodes.products.append(row);
    }
    if (result.products.length > visibleProducts) nodes.productsMore.append(button(
      'Show more products (' + (result.products.length - visibleProducts) + ' remaining)', async alive => {
        if (alive()) { visibleProducts += 25; renderCatalog(); }
      }));
    availability();
  }
  function valueText(value) {
    if (value === null || value === undefined) return 'Not included';
    if (value === true) return 'Included';
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && ('manifestPath' in value || 'dependencies' in value)) {
      const entries = (value.dependencies ?? []).map(item => item.name + ' ' + item.version);
      if (value.manifestPath) entries.push('Package declaration: ' + value.manifestPath);
      return entries.join('\n') || 'Included';
    }
    return JSON.stringify(value, null, 2);
  }
  function exportValue(name, value, markdown = false) {
    const bytes = markdown ? formatProductCatalogMarkdown(value) : JSON.stringify(value, null, 2) + '\n';
    const blob = new Blob([bytes], { type: markdown ? 'text/markdown;charset=utf-8' : 'application/json' });
    const url = URL.createObjectURL(blob), link = make('a');
    link.href = url; link.download = name + (markdown ? '.md' : '.json');
    root.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function renderProductPreview() {
    if (!nodes) return;
    const panel = nodes.productPreview;
    panel.hidden = !productPreview; panel.replaceChildren();
    if (!productPreview) return;
    if (productPreview.failure) {
      panel.append(make('h3', productPreview.title), make('p', productPreview.failure),
        button('Reload product details', alive => selectProduct(productPreview.id, alive)));
      return;
    }
    const { summary: value } = productPreview;
    const selected = catalog?.products.find(item => item.id === value.id);
    const missingCapabilities = requiredCapabilities.filter(id => !selected?.requirements?.includes(id));
    const heading = make('div', undefined, 'section-title');
    heading.append(make('h3', value.title), make('span', 'Product contents', 'status'));
    panel.append(heading, make('p', value.description, 'muted'));
    panel.append(facts([['Commands', value.counts.commands], ['Applications', value.counts.applications],
      ['Merchant connections', value.counts.merchantProviders], ['Adapter groups', value.counts.features]], 'facts'));
    const exports = make('div', undefined, 'actions');
    exports.append(button('Save product details', async alive => { if (alive()) exportValue('product-' + value.id, value); }),
      button('Save readable product guide', async alive => { if (alive()) exportValue('product-' + value.id, value, true); }),
      button('Save build review request', async alive => {
        if (alive()) exportValue('product-' + value.id + '-build-review',
          productReviewRequest(catalog, value.id, { python: nodes.python.value.trim() || 'python3', requirements: requiredCapabilities }));
      }, missingCapabilities.length > 0 || Boolean(selected?.capabilityError)));
    panel.append(exports);
    if (requiredCapabilities.length) {
      panel.append(make('p', missingCapabilities.length ?
        'Choose a product covering the remaining capabilities to prepare a build: ' + missingCapabilities.join(', ') :
        'This product covers every requested capability.', 'note'));
      panel.append(detail('Requested capability sources', table(['Capability', 'Registration sources'],
        requiredCapabilities.map(id => [id, selected?.capabilityDeclarations?.find(item => item.id === id)?.sources
          .map(source => source.id + ' · ' + source.path).join('\n') || 'Not included']))));
    }
    if (value.applications.length)
      panel.append(detail('Included applications', table(['Application'], value.applications.map(name => [name]))));
    if (value.merchantProviders.length)
      panel.append(detail('Merchant connections', table(['Connection'], value.merchantProviders.map(name => [name]))));
    const requirements = make('div');
    if (value.runtime.native.length)
      requirements.append(make('h3', 'Native payment dependencies'), table(['Package', 'Declared version'],
        value.runtime.native.map(item => [item.name, item.version])));
    if (value.runtime.features.length) {
      requirements.append(make('h3', 'Optional adapters'), table(['Adapter', 'Package declaration', 'Direct dependencies'],
        value.runtime.features.map(item => [item.name, item.manifestPath ?? 'Declared directly',
          item.dependencies.map(dep => dep.name + ' ' + dep.version).join('\n') || 'Read from the built package'])));
      requirements.append(make('p', 'Choose adapter versions from the completed package in Source & profile.', 'note'));
    }
    if (value.runtime.native.length || value.runtime.features.length)
      panel.append(detail('Installation requirements', requirements));
    const dependencyLocks = productPreview.source.runtimeRequirements?.dependencyLocks ?? {};
    const resolvedGroups = Object.entries(dependencyLocks).filter(([, group]) => group.instances?.length);
    if (resolvedGroups.length) {
      const closure = make('div');
      closure.append(make('p', 'Exact production dependencies recorded by the committed lockfiles, including transitive packages. Runtime installation selects packages for the target platform.', 'note'));
      for (const [name, group] of resolvedGroups) {
        closure.append(make('h3', name + ' · ' + group.counts.directInstances + ' direct / ' + group.counts.transitiveInstances + ' transitive instances'),
          make('p', group.source.path + ' · ' + group.status, 'note'),
          table(['Package', 'Locked version', 'Locations'], group.packages.map(item => [item.name, item.version, item.locations.join('\n')])));
        for (const issue of group.unresolved ?? [])
          closure.append(make('p', issue.name + ' from ' + issue.from + ': ' + (issue.reason ?? 'Not found in committed lock'), 'note'));
      }
      panel.append(detail('Committed dependency closure', closure));
    }
    for (const [name, group] of Object.entries(dependencyLocks).filter(([, group]) => ['mismatched', 'unsupported', 'unavailable'].includes(group.status)))
      panel.append(make('p', name + ' dependency lock: ' + (group.reason ?? group.error?.message), 'note'));
    for (const issue of productPreview.source.runtimeRequirements?.errors ?? [])
      panel.append(make('p', issue.feature + ': ' + issue.message, 'note'));
    panel.append(detail('Commands', table(['Command', 'Original source'],
      value.commands.map(item => [item.name, item.entry]))));
    panel.append(detail('Package exports', table(['Export', 'Original source'],
      value.exports.map(item => [item.name, valueText(item.entry)]))));
    panel.append(detail('Source and guides', facts([['Source version', value.sourceCommit],
      ['Repository', value.repository], ['Product guide', value.readme], ['Selected recipe', value.id]])));
    panel.append(detail('Complete product source', make('pre', JSON.stringify(productPreview.source, null, 2))));
    availability();
  }
  function renderComparison() {
    if (!nodes) return;
    const panel = nodes.comparison;
    panel.hidden = !comparison; panel.replaceChildren();
    if (!comparison) return;
    const value = comparison;
    panel.append(make('h3', 'Compare product contents'),
      make('p', 'All products below come from the same committed source.', 'muted'));
    const actions = make('div', undefined, 'actions');
    actions.append(button('Save comparison', async alive => { if (alive()) exportValue('product-comparison', value); }),
      button('Save readable comparison', async alive => { if (alive()) exportValue('product-comparison', value, true); }),
      button('Clear comparison', async alive => {
        if (!alive()) return;
        comparedSelections = []; comparison = null; persist(); renderComparison(); renderCatalog();
      }));
    panel.append(actions);
    const labels = value.products.map(item => item.title);
    panel.append(table(['Contents', ...labels], [
      ['Commands', ...value.products.map(item => item.counts.commands)],
      ['Applications', ...value.products.map(item => item.counts.applications)],
      ['Merchant connections', ...value.products.map(item => item.counts.merchantProviders)],
      ['Adapter groups', ...value.products.map(item => item.counts.features)],
    ]));
    for (const section of value.sections) {
      const differences = section.rows.filter(row => !row.shared), shared = section.rows.filter(row => row.shared);
      const group = make('div');
      if (differences.length) group.append(table(['Different ' + section.title.toLowerCase(), ...labels],
        differences.map(row => [row.name, ...row.values.map(valueText)])));
      else group.append(make('p', 'These products include the same ' + section.title.toLowerCase() + '.', 'note'));
      if (shared.length) group.append(detail('Included in every selected product (' + shared.length + ')',
        table([section.title, ...labels], shared.map(row => [row.name, ...row.values.map(valueText)]))));
      const sectionDetail = detail(section.title + ' · ' + differences.length + ' differences', group);
      sectionDetail.open = differences.length > 0 && ['applications', 'features'].includes(section.id);
      panel.append(sectionDetail);
    }
    panel.append(detail('Source version', facts([['Commit', value.sourceCommit], ['Repository', value.repository]])));
    availability();
  }
  async function loadReview(id, alive) {
    const value = await api(query('/api/source-builds/review', { reviewId: id }));
    if (!alive()) return;
    if (activePlan?.review.reviewId !== value.reviewId) detachPlan(false);
    review = value; selectedReviewId = value.reviewId; persist(); renderReview();
  }
  async function continueBuild(build, alive) {
    await api('/api/source-builds/recover', { operationId: build.requestId });
    if (!alive()) return;
    await refreshWorkspace();
    if (!alive()) return;
    lastRead = 0; await refresh({ force: true });
    if (alive()) message('The original product build is continuing. Its operation and output directory are unchanged.');
  }
  async function download(build, alive) {
    const value = await api('/api/source-builds/download', { reviewId: build.reviewId });
    if (!alive()) return;
    const link = make('a'); link.href = value.url; link.download = value.file;
    root.append(link); link.click(); link.remove();
    message('Package download started: ' + value.file + ' · SHA-256 ' + value.sha256);
  }
  function buildActions(build, original) {
    const actions = make('div', undefined, 'actions');
    if (original?.displayPhase === 'INITIALIZING')
      actions.append(button('Continue saving build', async alive => {
        if (!alive()) return;
        await operation({ requestId: build.requestId, operation: 'source-build',
          reviewId: build.reviewId, selectionSha256: build.selectionSha256 });
        if (alive()) { lastRead = 0; await refresh({ force: true }); }
      }));
    if (original) {
      if (['FAILED', 'QUEUED'].includes(original.phase) || original.displayPhase === 'INTERRUPTED')
        actions.append(button('Continue original build', alive => continueBuild(build, alive), original.workerActive));
      actions.append(button('Open worker log', async alive => { if (alive()) await openLog({ operationId: build.requestId }); }));
    }
    if (build.archive) actions.append(button('Download package', alive => download(build, alive)));
    if (build.archiveId) actions.append(button('Choose adapters and install', async alive => {
      if (alive()) await chooseArchive(build.archiveId);
    }));
    return actions;
  }
  function renderReview() {
    if (!nodes) return;
    const panel = nodes.reviewPanel;
    panel.hidden = !review;
    if (!review) { panel.replaceChildren(); reviewSignature = ''; return; }
    const value = review, original = operationFor(value.requestId), retained = builds.find(item => item.reviewId === value.reviewId);
    const signature = JSON.stringify([value.reviewId, original?.displayPhase, original?.sourceBuildStage,
      original?.error, retained?.archiveId, retained?.archive?.sha256]);
    if (reviewSignature === signature) { availability(); return; }
    reviewSignature = signature;
    const expanded = new Set([...panel.querySelectorAll('details')].filter(node => node.open).map(node => node.querySelector('summary').textContent));
    const title = make('div', undefined, 'section-title');
    title.append(make('h3', '2. Review ' + value.title), make('span', original?.displayPhase ?? 'REVIEWED', 'status'));
    panel.replaceChildren(title, make('p', value.description, 'muted'));
    panel.append(facts([['Package', value.packageName], ['Version', value.packageVersion],
      ['Source commit', value.sourceCommit], ['Repository', value.repository],
      ['Applications', value.applications.join(', ') || 'None'], ['Optional adapters', value.features.join(', ') || 'None']]));
    const actions = make('div', undefined, 'actions');
    if (!original) actions.append(button('Build reviewed product', async alive => {
      if (!alive() || review?.selectionSha256 !== value.selectionSha256) return;
      await operation({ requestId: value.requestId, operation: 'source-build',
        reviewId: value.reviewId, selectionSha256: value.selectionSha256 });
      if (alive()) { lastRead = 0; await refresh({ force: true }); }
    }));
    if (retained) actions.append(...buildActions(retained, original).children);
    panel.append(actions);
    panel.append(detail('Commands and package launchers', table(['Command', 'Original source'], [
      ...Object.entries(value.commands), ...Object.entries(value.product.bin).map(([name, path]) => [name + ' (launcher)', path]),
    ])));
    panel.append(detail('Exports and components', table(['Export or component', 'Original source'], [
      ...Object.entries(value.exports), ...value.components.map(path => ['Component', path]),
    ])));
    panel.append(detail('Committed inputs', table(['Source', 'Git blob', 'Bytes', 'SHA-256'],
      [...value.distributionInputs, ...value.supportingInputs].map(item => [item.path, item.gitBlob, item.bytes, item.sha256]))));
    panel.append(detail('Complete saved review', make('pre', JSON.stringify(value, null, 2))));
    for (const node of panel.querySelectorAll('details')) node.open = expanded.has(node.querySelector('summary').textContent);
    availability();
  }
  function renderBuilds(force = false) {
    if (!nodes) return;
    const signature = JSON.stringify([builds, getState()?.operations.filter(item => item.sourceBuildId), selectedReviewId, pending]);
    if (!force && listSignature === signature) return;
    listSignature = signature; nodes.count.textContent = String(builds.length);
    nodes.buildList.replaceChildren();
    if (!builds.length) { nodes.buildList.append(make('p', 'Review a product to create its saved build.', 'empty')); return; }
    for (const build of builds) {
      const original = operationFor(build.requestId), card = make('article', undefined, 'operation');
      card.dataset.reviewId = build.reviewId;
      const title = make('div', undefined, 'section-title');
      title.append(make('h3', build.title), make('span', original?.displayPhase ?? build.phase, 'status'));
      card.append(title, facts([['Package', build.packageVersion], ['Source commit', build.sourceCommit],
        ['Build output', build.output], ['Stage', original?.sourceBuildStage ?? build.stage ?? 'Awaiting build']]));
      const failure = original?.error ?? build.error;
      if (failure) card.append(make('p', failure.code + ': ' + failure.message));
      if (build.archive) card.append(make('p', build.archive.file + ' · ' + build.archive.bytes + ' bytes · SHA-256 ' + build.archive.sha256, 'note'));
      const actions = buildActions(build, original);
      actions.prepend(button(selectedReviewId === build.reviewId ? 'Reopen saved review' : 'Open product', async alive => {
        await loadReview(build.reviewId, alive);
        if (alive()) nodes.reviewPanel.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }));
      card.append(actions); nodes.buildList.append(card);
    }
    availability();
  }
  async function refresh({ force = false } = {}) {
    ensure();
    if (reading) { readAgain ||= force; return; }
    const signature = JSON.stringify(getState()?.operations.filter(item => item.sourceBuildId));
    if (!force && signature === sourceSignature && Date.now() - lastRead < 10000) {
      renderReview(); renderBuilds(); renderPlanRuntimes(); return;
    }
    const ticket = epoch, selectedAtStart = selectedReviewId, planAtStart = selectedPlanId;
    const alive = () => epoch === ticket && workspaceId === getState()?.workspaceId;
    reading = true; availability();
    try {
      const value = await api('/api/source-builds/state');
      if (!alive()) return;
      builds = value.builds; sourceSignature = signature; lastRead = Date.now();
      await readPlans(alive);
      if (!alive()) return;
      if (planAtStart && selectedPlanId === planAtStart && !activePlan) {
        await openPlan(planAtStart, alive, selectedBindingId);
        if (!alive()) return;
      }
      if (selectedAtStart && selectedReviewId === selectedAtStart && !review) {
        const value = await api(query('/api/source-builds/review', { reviewId: selectedAtStart }));
        if (!alive()) return;
        if (selectedReviewId === selectedAtStart && !review) review = value;
      }
      renderReview(); renderBuilds(); renderPlanRuntimes();
    } finally {
      if (alive()) {
        reading = false; availability();
        if (readAgain) { readAgain = false; await refresh({ force: true }); }
      }
    }
  }
  async function choose(id) {
    ensure();
    if (pending) return;
    await perform(async alive => {
      await loadReview(id, alive);
      if (!alive()) return;
      switchView('source-builds'); await refresh({ force: true });
    });
  }
  return { refresh, reset, choose };
}
