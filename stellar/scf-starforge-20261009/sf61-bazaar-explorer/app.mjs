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
  nav:null, request:null, report:null, loading:false,
  requestId:0, controller:null, pending:null,
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
  const filters = state.nav.filters;
  return ['network', 'scheme'].every(key => !filters[key] || option?.[key] === filters[key]) &&
    (!filters.payTo || option?.payTo === filters.payTo);
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

function draftFilters() {
  return {query:$('query').value.trim(),network:$('network').value,
    type:$('type').value,scheme:$('scheme').value,payTo:$('payto').value.trim()};
}
function sameFilters(a,b) {
  return a && b && ['query','network','type','scheme','payTo'].every(key => a[key] === b[key]);
}
function firstPage(filters) {
  return Object.freeze({filters:Object.freeze({...filters}),offset:0,cursor:null,
    cursorHistory:Object.freeze([]),page:1});
}
function requestFor(nav) {
  const {filters} = nav;
  const params = new URLSearchParams({view:filters.query ? 'search' : 'list',limit:String(PAGE_SIZE)});
  for (const key of ['network','type','scheme','payTo']) if (filters[key]) params.set(key,filters[key]);
  if (filters.query) {
    params.set('query',filters.query);
    if (nav.cursor) params.set('cursor',nav.cursor);
  } else params.set('offset',String(nav.offset));
  return params;
}
function nextCursor() {
  const cursor = state.report?.pagination?.cursor;
  return typeof cursor === 'string' && cursor.length > 0 && cursor.length <= 512 &&
    !/[\u0000-\u001f\u007f]/.test(cursor) ? cursor : null;
}
function syncControls() {
  const draft = draftFilters();
  const nav = state.nav;
  const dirty = !nav || !sameFilters(draft,nav.filters);
  const target = state.pending?.filters ?? nav?.filters;
  $('restore-filters').disabled = !nav || (!dirty && !state.loading);
  $('filter-status').textContent = state.loading
    ? (sameFilters(draft,target)
      ? 'Loading the submitted filters. Explore catalog can replace this request.'
      : 'Edits are not submitted. The in-flight request still uses its original filters.')
    : !nav ? 'No source page loaded. Explore catalog to submit these filters.'
      : dirty ? 'Unapplied filters. Explore catalog to apply them, or restore the displayed page filters.'
      : 'Form matches the displayed page filters.';
  const rows = state.report?.resources ?? [];
  const total = Number.isSafeInteger(state.report?.pagination?.total) ? state.report.pagination.total : null;
  const hasMore = nav && (nav.filters.query ? Boolean(nextCursor()) :
    (total !== null ? nav.offset + rows.length < total : rows.length === PAGE_SIZE));
  prev.disabled = state.loading || dirty || !nav ||
    (nav.filters.query ? nav.cursorHistory.length === 0 : nav.offset === 0);
  next.disabled = state.loading || dirty || !hasMore;
  exportButton.disabled = state.loading || !rows.length;
  form.setAttribute('aria-busy',String(state.loading));
}

function render(data) {
  const nav = state.nav;
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
  $('applied-filters').textContent = 'Displayed page filters — ' +
    ['query','network','type','scheme','payTo'].map(key => key + ': ' +
      (nav.filters[key] || (key === 'query' ? 'browse all' : 'all'))).join(' · ');
  results.replaceChildren();
  if (!rows.length) {
    const empty = el('div', 'empty');
    empty.append(el('strong', '', 'No matching catalog entries'));
    empty.append(document.createTextNode('Try another network or query. An empty page is not evidence that a seller or network does not exist.'));
    results.append(empty);
  } else {
    rows.forEach((row, i) => results.append(renderResource(row, i +
      (nav.filters.query ? (nav.page - 1) * PAGE_SIZE : nav.offset))));
  }
  pageInfo.textContent = 'Page ' + nav.page + (nav.filters.query ? ' · cursor-paged' : ' · offset ' + nav.offset);
  syncControls();
}

async function load(nav) {
  const requestId = ++state.requestId;
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  state.pending = nav;
  state.loading = true;
  // This immutable request is also the eventual export provenance. Draft form
  // edits can neither change it nor combine their filters with this cursor.
  const params = requestFor(nav);
  const request = Object.freeze(Object.fromEntries(params));
  syncControls();
  status.classList.remove('error');
  status.textContent = state.report ? 'Loading a new source page; the previous observed page remains below…' : 'Requesting the native discovery page…';
  try {
    const response = await fetch('/api/discovery?' + params, {
      method:'GET',cache:'no-store',credentials:'omit',signal:controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error +
      (data.reason ? ': ' + data.reason : data.sourceStatus ? ' (HTTP ' + data.sourceStatus + ')' : ''));
    if (!Array.isArray(data.resources)) throw new TypeError('Malformed source page');
    if (requestId !== state.requestId) return;
    state.nav = nav; state.request = request; state.report = data;
    state.loading = false; state.pending = null; state.controller = null;
    render(data);
  } catch (error) {
    if (requestId !== state.requestId) return;
    state.loading = false; state.pending = null; state.controller = null;
    if (state.report) render(state.report);
    else {
      results.replaceChildren();count.textContent='';pageInfo.textContent='Page not loaded';
      $('applied-filters').textContent='No source page loaded.';
    }
    humanError('Discovery not available: ' + String(error.message).slice(0,240) +
      (state.report ? ' Showing the previous observed page and its original filters.' : ''));
    syncControls();
  }
}

form.addEventListener('input',syncControls);
form.addEventListener('change',syncControls);
form.addEventListener('submit',event => {
  event.preventDefault();
  return load(firstPage(draftFilters()));
});
$('clear').addEventListener('click',() => {
  $('query').value='';$('network').value='stellar:testnet';
  $('type').value='';$('scheme').value='';$('payto').value='';
  return load(firstPage(draftFilters()));
});
$('restore-filters').addEventListener('click',() => {
  if (!state.nav) return;
  ++state.requestId;state.controller?.abort();
  state.loading=false;state.pending=null;state.controller=null;
  for (const [key,id] of [['query','query'],['network','network'],['type','type'],['scheme','scheme'],['payTo','payto']])
    $(id).value=state.nav.filters[key];
  render(state.report);
  $('query').focus();
});
next.addEventListener('click',() => {
  if (next.disabled || !state.nav || !state.report) return;
  const nav=state.nav;
  if (nav.filters.query) {
    const cursor=nextCursor();if (!cursor) return;
    return load(Object.freeze({...nav,cursor,cursorHistory:Object.freeze([...nav.cursorHistory,nav.cursor]),page:nav.page+1}));
  }
  return load(Object.freeze({...nav,offset:nav.offset+PAGE_SIZE,page:nav.page+1}));
});
prev.addEventListener('click',() => {
  if (prev.disabled || !state.nav) return;
  const nav=state.nav;
  if (nav.filters.query) {
    const cursor=nav.cursorHistory.at(-1);
    return load(Object.freeze({...nav,cursor,cursorHistory:Object.freeze(nav.cursorHistory.slice(0,-1)),page:Math.max(1,nav.page-1)}));
  }
  return load(Object.freeze({...nav,offset:Math.max(0,nav.offset-PAGE_SIZE),page:Math.max(1,nav.page-1)}));
});
exportButton.addEventListener('click',() => {
  if (exportButton.disabled || !state.report?.resources?.length || !state.request) return;
  const text=JSON.stringify({
    schema:'scf61-observed-native-page-v1',observedAt:state.report.observedAt,
    sourceMode:state.report.mode,view:state.report.view,filterRequest:state.request,
    readOnly:true,nativeProviderRows:state.report.resources,
    pagination:state.report.pagination,paidOrSettled:false,
  },null,2)+'\n';
  const blob=new Blob([text],{type:'application/json'});
  const target=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=target;a.download='bazaar-atlas-observed-page.json';
  document.body.append(a);a.click();a.remove();URL.revokeObjectURL(target);
});
async function source() {
  try {
    const response = await fetch('/api/source', { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error('Local source unavailable');
    const origin = await response.json();
    $('source-kind').textContent = origin.mode === 'LOCAL_NONPAYABLE_SF44_FIXTURE' ?
      'Original SF44 nonpayable development catalog' :
      origin.mode === 'ORIGINAL_SF60_DURABLE_CATALOG' ?
      'Original SF60 persistent catalog · local source' : 'Operator-selected public facilitator';
    $('source-origin').textContent = origin.origin;
  } catch {
    $('source-kind').textContent = 'Discovery source unavailable';
    $('source-origin').textContent = 'Check the local explorer server';
  }
}
await source();
await load(firstPage(draftFilters()));
