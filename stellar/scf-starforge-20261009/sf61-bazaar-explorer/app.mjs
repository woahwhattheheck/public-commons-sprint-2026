// MIT. SF61 browser: display original provider rows safely; never initiate paid-origin calls.
const $ = id => document.getElementById(id);
const form = $('query-form');
const status = $('status');
const results = $('results');
const count = $('count');
const prev = $('prev');
const next = $('next');
const exportButton = $('export');
const pageInfo = $('page-info');
const PAGE_SIZE = 25;
const state = {
  offset: 0,
  cursor: null,
  cursorHistory: [],
  query: '',
  page: 1,
  report: null,
  loading: false,
  requestId: 0,
};

const el = (tag, className = '', value = null) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== null && value !== undefined) node.textContent = String(value);
  return node;
};
const show = value => typeof value === 'string' && value.trim() ? value.trim() : 'Not declared';
const shortened = (value, max = 240) => show(value).slice(0, max);
const info = row => row?.extensions?.bazaar?.info?.input ?? {};
const optionsOf = row => Array.isArray(row?.accepts) ? row.accepts : [];
const resourceOf = row => typeof row?.resource === 'object' && row.resource !== null ? row.resource : {};
const resourceUrl = row => typeof row?.resource === 'string' ? row.resource :
  (resourceOf(row).url ?? row?.url ?? null);
const sourceLabel = row => {
  const resource = resourceOf(row);
  if (typeof resource.serviceName === 'string' && resource.serviceName.trim())
    return shortened(resource.serviceName, 130);
  if (typeof resource.name === 'string' && resource.name.trim())
    return shortened(resource.name, 130);
  const address = resourceUrl(row);
  try { return new URL(address).hostname; } catch { return 'Unnamed catalog resource'; }
};

function humanError(message) {
  status.classList.add('error');
  status.textContent = message;
}

function addDetail(parent, name, value) {
  const line = el('p');
  line.append(el('b', '', name + ': '), document.createTextNode(shortened(value, 260)));
  parent.append(line);
}

function optionMatchesFilters(option) {
  return ['network', 'scheme'].every(key => !$(key).value || option?.[key] === $(key).value) &&
    (!$('payto').value.trim() || option?.payTo === $('payto').value.trim());
}

function renderOption(option, index) {
  const matches = optionMatchesFilters(option);
  const outer = el('div', 'payment-option' + (matches ? '' : ' out-of-filter'));
  outer.append(el('div', 'terms-top', 'OPTION ' + String(index + 1) +
    (matches ? ' · FILTER MATCH' : ' · OTHER DECLARED OPTION')));
  addDetail(outer, 'Network', option?.network);
  addDetail(outer, 'Scheme', option?.scheme);
  addDetail(outer, 'Amount (atomic units)', option?.amount);
  addDetail(outer, 'Asset ID', option?.asset);
  addDetail(outer, 'Pay to', option?.payTo);
  return outer;
}

function renderResource(row, index) {
  const item = el('article', 'resource');
  const top = el('div', 'resource-top');
  const headline = el('div');
  headline.append(el('h3', '', sourceLabel(row)));
  const declaredType = info(row).type;
  const description = resourceOf(row).description ??
    row?.description ?? info(row).description;
  headline.append(el('p', 'muted', 'CATALOG ENTRY ' + String(index + 1)));
  top.append(headline, el('span', 'type' + (declaredType === 'mcp' ? ' mcp' : ''),
    declaredType === 'mcp' ? 'MCP TOOL' : declaredType === 'http' ? 'HTTP API' : 'RESOURCE'));
  item.append(top);
  item.append(el('p', 'resource-description',
    description ? shortened(description, 450) : 'The provider did not include a resource description.'));
  const address = resourceUrl(row);
  item.append(el('div', 'source-url', address ?
    shortened(address, 600) : 'No canonical resource URL declared'));
  const toolName = info(row).toolName;
  const method = info(row).method;
  if (toolName || method)
    item.append(el('div', 'muted', (toolName ? 'MCP tool: ' + shortened(toolName, 150) : '') +
      (method ? '  HTTP method: ' + shortened(method, 24) : '')));
  const tags = resourceOf(row).tags;
  if (Array.isArray(tags) && tags.length) {
    const tagRow = el('div', 'tag-row');
    for (const tag of tags.slice(0, 8))
      if (typeof tag === 'string') tagRow.append(el('span', 'tag', shortened(tag, 40)));
    item.append(tagRow);
  }
  const options = el('div', 'payment-options');
  options.append(el('h4', '', 'Individually declared payment options'));
  const accepts = optionsOf(row);
  if (!accepts.length) {
    options.append(el('p', 'muted', 'No individual payment options declared in this row. Do not infer price or payment eligibility.'));
  } else {
    for (const [i, option] of accepts.entries()) {
      if (i >= 12) {
        options.append(el('p', 'muted', String(accepts.length - i) + ' additional offers not displayed'));
        break;
      }
      options.append(renderOption(option, i));
    }
  }
  item.append(options);
  return item;
}

function readFilters() {
  const params = new URLSearchParams({ view: state.query ? 'search' : 'list',
    limit: String(PAGE_SIZE) });
  for (const key of ['network', 'type', 'scheme']) {
    const value = $(key).value;
    if (value) params.set(key, value);
  }
  const payTo = $('payto').value.trim();
  if (payTo) params.set('payTo', payTo);
  if (state.query) {
    params.set('query', state.query);
    if (state.cursor) params.set('cursor', state.cursor);
  } else {
    params.set('offset', String(state.offset));
  }
  return params;
}

function render(data) {
  state.report = data;
  status.classList.remove('error');
  const rows = data.resources;
  const total = Number.isSafeInteger(data?.pagination?.total) ? data.pagination.total : null;
  const label = total === null ? String(rows.length) + ' on this page' :
    String(rows.length) + ' on this page · ' + String(total) + ' declared by provider';
  count.textContent = '(' + label + ')';
  status.textContent = 'GET-only source page · observed ' +
    (data.observedAt ? new Date(data.observedAt).toLocaleString() : 'now') +
    ' · ' + (data.x402Version ? 'x402 v' + data.x402Version + ' · ' : '') +
    'no payment requests';
  results.replaceChildren();
  if (!rows.length) {
    const empty = el('div', 'empty');
    empty.append(el('strong', '', 'No matching catalog entries'));
    empty.append(document.createTextNode('Try another network or query. An empty page is not evidence that a seller or network does not exist.'));
    results.append(empty);
  } else {
    rows.forEach((row, i) => results.append(renderResource(row, i +
      (state.query ? (state.page - 1) * PAGE_SIZE : state.offset))));
  }
  const nextCursor = data?.pagination?.cursor ?? null;
  const hasMore = state.query ? Boolean(nextCursor) :
    (total !== null ? state.offset + rows.length < total : rows.length === PAGE_SIZE);
  prev.disabled = state.loading || (state.query ? state.cursorHistory.length === 0 : state.offset === 0);
  next.disabled = state.loading || !hasMore;
  pageInfo.textContent = 'Page ' + state.page + (state.query ? ' · cursor-paged' :
    ' · offset ' + state.offset);
  exportButton.disabled = !rows.length;
}

async function load() {
  if (state.loading) return;
  state.loading = true;
  state.requestId++;
  const requestId = state.requestId;
  prev.disabled = true; next.disabled = true; exportButton.disabled = true;
  status.classList.remove('error');
  status.textContent = 'Requesting the native discovery page…';
  try {
    const response = await fetch('/api/discovery?' + readFilters(), {
      method: 'GET', cache: 'no-store', credentials: 'omit',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error +
      (data.reason ? ': ' + data.reason : data.sourceStatus ? ' (HTTP ' + data.sourceStatus + ')' : ''));
    if (!Array.isArray(data.resources)) throw new TypeError('Malformed source page');
    if (requestId !== state.requestId) return;
    state.loading = false;
    render(data);
  } catch (error) {
    state.report = null;
    state.loading = false;
    results.replaceChildren();
    count.textContent = '';
    pageInfo.textContent = 'Page not loaded';
    humanError('Discovery not available: ' + String(error.message).slice(0, 240));
  }
}

function resetPage() {
  state.offset = 0;
  state.cursor = null;
  state.cursorHistory = [];
  state.page = 1;
  state.query = $('query').value.trim();
}

form.addEventListener('submit', event => {
  event.preventDefault();
  if (state.loading) return;
  resetPage();
  load();
});
$('clear').addEventListener('click', () => {
  if (state.loading) return;
  $('query').value = '';
  $('network').value = 'stellar:testnet';
  $('type').value = '';
  $('scheme').value = '';
  $('payto').value = '';
  resetPage();
  load();
});
next.addEventListener('click', () => {
  if (state.loading || !state.report) return;
  if (state.query) {
    const cursor = state.report?.pagination?.cursor;
    if (typeof cursor !== 'string' || !cursor || cursor.length > 512) return;
    state.cursorHistory.push(state.cursor);
    state.cursor = cursor;
  } else {
    state.offset += PAGE_SIZE;
  }
  state.page++;
  load();
});
prev.addEventListener('click', () => {
  if (state.loading) return;
  if (state.query) {
    if (!state.cursorHistory.length) return;
    state.cursor = state.cursorHistory.pop();
  } else {
    if (!state.offset) return;
    state.offset = Math.max(0, state.offset - PAGE_SIZE);
  }
  state.page = Math.max(1, state.page - 1);
  load();
});
exportButton.addEventListener('click', () => {
  if (!state.report?.resources?.length) return;
  const text = JSON.stringify({
    schema: 'scf61-observed-native-page-v1', observedAt: state.report.observedAt,
    sourceMode: state.report.mode, view: state.report.view, filterRequest: Object.fromEntries(readFilters()),
    readOnly: true, nativeProviderRows: state.report.resources,
    pagination: state.report.pagination,
    paidOrSettled: false,
  }, null, 2) + '\n';
  const blob = new Blob([text], { type: 'application/json' });
  const target = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = target; a.download = 'bazaar-atlas-observed-page.json';
  document.body.append(a); a.click(); a.remove();
  URL.revokeObjectURL(target);
});
async function source() {
  try {
    const response = await fetch('/api/source', { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error('Local source unavailable');
    const origin = await response.json();
    $('source-kind').textContent = origin.mode === 'LOCAL_NONPAYABLE_SF44_FIXTURE' ?
      'Original SF44 nonpayable development catalog' : 'Operator-selected public facilitator';
    $('source-origin').textContent = origin.origin;
  } catch {
    $('source-kind').textContent = 'Discovery source unavailable';
    $('source-origin').textContent = 'Check the local explorer server';
  }
}
await source();
await load();
