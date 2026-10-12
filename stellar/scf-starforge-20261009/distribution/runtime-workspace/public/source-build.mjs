import { matchProductRequirements, normalizeProductRequirements, productReviewRequest } from '/product-requirements.mjs';
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
  refreshWorkspace, openLog, switchView, chooseArchive, message, error }) {
  let workspaceId = null, epoch = 0, pending = false, reading = false, readAgain = false;
  let catalog = null, review = null, selectedReviewId = null, builds = [], savedSelection = '';
  let sourceSignature = '', listSignature = '', reviewSignature = '', lastRead = 0, nodes = null;
  let productPreview = null, comparison = null, comparedSelections = [];
  let queryText = '', showUnavailable = false, visibleProducts = 25;
  let requiredCapabilities = [], requirementMatch = 'all', requirementSort = 'source';
  const productDetails = new Map();
  const key = () => 'starforge-source-builds-' + workspaceId;
  const snapshot = () => ({ repository: nodes.repository.value.trim(), ref: nodes.ref.value.trim() || 'HEAD',
    offline: nodes.offline.checked, python: nodes.python.value.trim() || 'python3',
    selection: nodes.product.value || savedSelection, selectedReviewId,
    query: queryText, showUnavailable, comparedSelections, requiredCapabilities, requirementMatch, requirementSort });
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
      if (alive()) { pending = false; renderReview(); renderBuilds(true); availability(); }
    }
  }
  function button(label, action, unavailable = false) {
    const node = make('button', label); node.type = 'button'; node.dataset.action = 'true';
    node.dataset.unavailable = String(unavailable); node.disabled = unavailable || pending;
    node.addEventListener('click', () => perform(action)); return node;
  }
  function reset() {
    epoch++; workspaceId = null; pending = false; reading = false; readAgain = false;
    catalog = null; review = null; selectedReviewId = null; builds = []; savedSelection = '';
    productPreview = null; comparison = null; comparedSelections = [];
    queryText = ''; showUnavailable = false; visibleProducts = 25; productDetails.clear();
    requiredCapabilities = []; requirementMatch = 'all'; requirementSort = 'source';
    sourceSignature = ''; listSignature = ''; reviewSignature = ''; lastRead = 0; nodes = null; root.replaceChildren();
  }
  function ensure() {
    const id = getState()?.workspaceId;
    if (!id) throw new Error('Open the runtime workspace before choosing source.');
    if (workspaceId === id) return;
    reset(); workspaceId = id;
    root.innerHTML = '<link rel="stylesheet" href="/source-catalog.css">' + '<div class="section-title"><div><p class="eyebrow">PRODUCT SOURCE</p><h2>Build a product from source</h2></div></div>' +
      '<p class="muted">Choose a committed product from a Git repository on this machine. Review its contents, build its package, then select adapters for installation.</p>' +
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
      '<p data-product-description class="note"></p><button data-review type="button" disabled>Review selected product</button></div>' +
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
      reviewPanel: find('review-panel'), buildList: find('build-list'), count: find('build-count') };
    let saved; try { saved = JSON.parse(localStorage.getItem(key()) ?? 'null'); } catch {}
    if (saved && typeof saved === 'object') {
      for (const name of ['repository', 'ref', 'python']) if (typeof saved[name] === 'string') nodes[name].value = saved[name];
      if (typeof saved.offline === 'boolean') nodes.offline.checked = saved.offline;
      if (typeof saved.selection === 'string') savedSelection = saved.selection;
      if (typeof saved.query === 'string') queryText = saved.query;
      if (typeof saved.showUnavailable === 'boolean') showUnavailable = saved.showUnavailable;
      if (Array.isArray(saved.comparedSelections)) comparedSelections = [...new Set(saved.comparedSelections.filter(value => typeof value === 'string'))].slice(0, 4);
      if (/^[a-f0-9]{24}$/.test(saved.selectedReviewId ?? '')) selectedReviewId = saved.selectedReviewId;
    }
    try { requiredCapabilities = normalizeProductRequirements(saved?.requiredCapabilities ?? []); } catch {}
    if (['all', 'any'].includes(saved?.requirementMatch)) requirementMatch = saved.requirementMatch;
    if (['source', 'coverage', 'runtime-groups', 'commands'].includes(saved?.requirementSort)) requirementSort = saved.requirementSort;
    nodes.requirementMatch.value = requirementMatch; nodes.requirementSort.value = requirementSort;
    const addCapability = () => {
      try {
        requiredCapabilities = normalizeProductRequirements([...requiredCapabilities, nodes.requiredCapability.value.trim()]);
        nodes.requiredCapability.value = ''; visibleProducts = 25; persist(); renderCatalog(); renderProductPreview();
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
      review = null; selectedReviewId = null;
      if (source) {
        catalog = null; nodes.commit.textContent = ''; nodes.description.textContent = '';
        nodes.product.value = ''; nodes.productTitle.textContent = 'No product selected';
        nodes.catalogPanel.hidden = true; productPreview = null; comparison = null;
        productDetails.clear(); renderProductPreview(); renderComparison();
      }
      renderReview(); availability(); persist();
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
        catalog = value; review = null; selectedReviewId = null;
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
    renderBuilds(true); availability();
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
    nodes.product.value = id; savedSelection = id;
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
      if (alive()) { requiredCapabilities = requiredCapabilities.filter(value => value !== id); visibleProducts = 25; persist(); renderCatalog(); renderProductPreview(); }
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
      renderReview(); renderBuilds(); return;
    }
    const ticket = epoch, selectedAtStart = selectedReviewId;
    const alive = () => epoch === ticket && workspaceId === getState()?.workspaceId;
    reading = true; availability();
    try {
      const value = await api('/api/source-builds/state');
      if (!alive()) return;
      builds = value.builds; sourceSignature = signature; lastRead = Date.now();
      if (selectedAtStart && selectedReviewId === selectedAtStart && !review) {
        const value = await api(query('/api/source-builds/review', { reviewId: selectedAtStart }));
        if (!alive()) return;
        if (selectedReviewId === selectedAtStart && !review) review = value;
      }
      renderReview(); renderBuilds();
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
