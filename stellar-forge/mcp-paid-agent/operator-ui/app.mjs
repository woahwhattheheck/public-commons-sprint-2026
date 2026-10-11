/** MIT. Original quote workflow and complete native result consumption. */
import {BuyerConsoleClient} from './client.mjs';

const client = new BuyerConsoleClient();
const $ = id => document.getElementById(id);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stringify = value => JSON.stringify(value, null, 2);
const short = value => String(value ?? '').slice(0, 8);
const time = value => Number.isFinite(value) ? new Date(value).toLocaleString() : String(value ?? '—');
const size = bytes => Number.isFinite(bytes) ? bytes.toLocaleString() + ' bytes' : '—';
const state = {connected:false, serial:0, view:'discover', resources:[], searchArgs:null, searchCursor:null,
  description:null, quote:null, history:[], historyCursor:null, results:[], resultCursor:null,
  result:null, reading:null, selection:0, describing:0, executing:new Set(), uncertain:new Set(), urls:new Set()};

function node(tag, {text, className, ...attrs} = {}, children = []) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    element.setAttribute(name, value === true ? '' : String(value));
  }
  element.append(...children.filter(value => value !== null && value !== undefined));
  return element;
}
function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); }
function button(label, action, {primary = false, disabled = false, ...attrs} = {}) {
  const element = node('button', {text:label, type:'button', className:primary ? 'primary' : '', ...attrs});
  element.disabled = disabled;
  element.addEventListener('click', () => attempt(action, element)); return element;
}
async function attempt(action, element) {
  const serial = state.serial;
  if (element) element.disabled = true;
  try { await action(); }
  catch (error) { if (serial === state.serial) notice((error.code ? error.code + ' · ' : '') + error.message, true); }
  finally { if (element?.isConnected && serial === state.serial) element.disabled = false; }
}
function pre(value) { return node('pre', {text:typeof value === 'string' ? value : stringify(value)}); }
function detail(label, value) { return node('details', {}, [node('summary', {text:label}), pre(value)]); }
function badge(value) { return node('span', {className:'badge', text:value ?? '—'}); }
function facts(values) {
  return node('dl', {className:'key-values'}, values.flatMap(([label, value]) => [
    node('dt', {text:label}), node('dd', {text:typeof value === 'object' ? stringify(value) : value ?? '—'}),
  ]));
}
function empty(message) { return node('div', {className:'empty', text:message}); }
function table(headers, rows, classes = '') {
  return node('div', {className:'table-wrap ' + classes}, [node('table', {}, [
    node('thead', {}, [node('tr', {}, headers.map(text => node('th', {scope:'col', text})))]),
    node('tbody', {}, rows.map(cells => node('tr', {}, cells.map(value => node('td', {}, [
      value instanceof Node ? value : node('span', {text:value ?? '—'}),
    ]))))),
  ])]);
}
function url(value, label) {
  try {
    const parsed = new URL(value);
    if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password)
      return node('a', {href:parsed.href, target:'_blank', rel:'noopener noreferrer', text:label ?? value});
  } catch { /* Other native resource identifiers remain readable text. */ }
  return node('span', {className:'mono', text:label ? label + ' · ' + value : value});
}
function revokeDownloads() { for (const value of state.urls) URL.revokeObjectURL(value); state.urls.clear(); }
function download(bytes, filename, type = 'application/json') {
  const href = URL.createObjectURL(new Blob([bytes], {type}));
  const anchor = node('a', {href, download:filename}); document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
function setView(view) {
  state.view = view;
  for (const name of ['discover','history','results']) $('view-' + name).hidden = name !== view;
  for (const tab of document.querySelectorAll('[data-view]')) {
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
  }
}
function reset() {
  state.serial++; client.disconnect(); revokeDownloads();
  state.selection++; state.describing++;
  Object.assign(state, {connected:false, resources:[], description:null, quote:null, result:null, reading:null,
    searchArgs:null, searchCursor:null, history:[], historyCursor:null, results:[], resultCursor:null});
  state.executing.clear(); state.uncertain.clear();
  $('workspace').hidden = true; $('connection').hidden = false; $('disconnect').hidden = true;
  $('connection-label').textContent = 'Disconnected'; $('access-token').value = '';
  for (const id of ['resource-detail','quote-detail','result-detail']) { $(id).replaceChildren(); $(id).hidden = true; }
  for (const id of ['search-results','history-list','results-list']) $(id).replaceChildren();
  $('durability').textContent = '';
}

async function connect(event) {
  event.preventDefault();
  const token = $('access-token').value, submit = event.submitter; $('access-token').value = '';
  reset();
  await attempt(async () => {
    const init = await client.connect(token);
    state.connected = true; $('workspace').hidden = false; $('connection').hidden = true; $('disconnect').hidden = false;
    $('connection-label').textContent = 'Connected · ' + (init.serverInfo?.name ?? 'Workspace');
    setView('discover'); notice('Connected. Select a resource or reopen an original quote.');
    await loadHistory(false);
  }, submit);
}

async function search(event, more = false) {
  event?.preventDefault();
  if (!more) {
    state.searchArgs = {query:$('search-query').value, limit:25};
    for (const [key, id] of [['network','search-network'], ['asset','search-asset'], ['maxAmount','search-amount']])
      if ($(id).value) state.searchArgs[key] = $(id).value;
  }
  const serial = state.serial;
  const result = await client.call('bazaar_search', {...state.searchArgs, ...(more ? {cursor:state.searchCursor} : {})});
  if (serial !== state.serial) return;
  state.resources = more ? [...state.resources, ...result.resources] : result.resources;
  state.searchCursor = result.pagination?.nextCursor ?? result.pagination?.next_cursor ?? null;
  const rows = state.resources.map(resource => [
    node('div', {}, [button(resource.resource?.description || resource.toolName || resource.resource?.url || 'Inspect resource',
      () => describe(resource.handle), {class:'linklike'}), node('div', {className:'mono muted', text:resource.resource?.url})]),
    (resource.resourceType ?? '') + ' · ' + (resource.toolName ?? resource.method ?? ''),
    resource.accepts.map(option => option.amount + ' ' + option.asset + ' · ' + option.network).join('\n'),
    badge(resource.allowedOrigin ? 'CONFIGURED ORIGIN' : 'HOST SETUP REQUIRED'),
    button('Inspect', () => describe(resource.handle)),
  ]);
  $('search-results').replaceChildren(rows.length ? table(['Resource','Invocation','Payment choices','Access',''], rows) : empty('No resources matched this search.'));
  const paging = node('div', {className:'pager'}, [node('span', {text:state.resources.length + ' resources loaded' + (result.partialResults ? ' · Catalog reports partial results' : '')})]);
  if (state.searchCursor) paging.append(button('Load more resources', () => search(null, true)));
  $('search-results').append(paging);
  notice('Catalog response received. Inspect a resource to see its complete declaration.');
}

async function describe(handle) {
  const serial = state.serial, request = ++state.describing, value = await client.call('bazaar_describe', {handle});
  if (serial !== state.serial || request !== state.describing) return;
  state.description = value;
  const preview = value.preview, container = preview.input.container;
  const options = node('select', {id:'payment-option', 'aria-label':'Payment option'}, value.accepts.map((option, index) =>
    node('option', {value:index, text:(index + 1) + ' · ' + option.amount + ' ' + option.asset + ' · ' + option.network})));
  const choice = node('div');
  const showChoice = () => choice.replaceChildren(facts(Object.entries(value.accepts[Number(options.value)])));
  options.addEventListener('change', showChoice); showChoice();
  const input = node('textarea', {id:'invocation-input', spellcheck:'false', 'aria-label':container === 'arguments' ? 'Tool arguments JSON' : 'Query values JSON'});
  input.value = '{}';
  const form = node('form', {}, [node('label', {text:container === 'arguments' ? 'Tool arguments (JSON object)' : 'Query values (JSON object)'}, [input]),
    node('p', {className:'field-note', text:container === 'query'
      ? 'Use the advertised query keys and string values. Required keys: ' + (preview.input.requiredKeys?.join(', ') || 'none declared') + '.'
      : 'Enter the actual arguments for this tool. The live server validates the advertised input schema.'})]);
  const create = node('button', {type:'submit', className:'primary', text:'Review exact quote'});
  create.disabled = !preview.allowedOrigin || !preview.methodSupported;
  form.append(create);
  form.addEventListener('submit', event => {
    event.preventDefault(); attempt(async () => {
      let parsed;
      try {
        parsed = JSON.parse(input.value, (_key, value) => {
          if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))))
            throw new RangeError('This JSON number cannot be retained exactly. Use the tool’s declared string form for large IDs or exact amounts.');
          return value;
        });
      } catch (error) { throw error instanceof RangeError ? error : new Error('Enter valid JSON for the invocation.'); }
      if (!plain(parsed)) throw new Error('The invocation input must be a JSON object.');
      const quote = await client.call('bazaar_preview', {handle:value.handle, acceptIndex:Number(options.value), input:{[container]:parsed}});
      if (serial !== state.serial) return;
      state.selection++; selectQuote(quote); renderQuote(); $('quote-detail').scrollIntoView({behavior:'smooth', block:'start'});
      notice('Quote created. Review the exact invocation and terms before requesting host approval.');
    }, create);
  });
  const target = $('resource-detail'); target.hidden = false;
  target.replaceChildren(node('div', {className:'detail-heading'}, [node('div', {}, [
    node('h3', {text:value.resource.description || value.resource.url}), node('p', {className:'mono', text:value.resource.url}),
  ]), badge(preview.resourceType.toUpperCase())]),
  node('div', {className:'detail-grid'}, [
    node('div', {}, [node('h4', {text:'Invocation'}), facts([
      ['Method', preview.method], ['Tool', preview.remoteMcp?.toolName], ['Endpoint', preview.remoteMcp?.endpoint ?? value.resource.url],
    ]), form, ...(preview.remoteMcpError ? [pre(preview.remoteMcpError)] : []),
    detail('Declared input and schema', {input:value.bazaar.info?.input, schema:value.bazaar.schema})]),
    node('div', {}, [node('h4', {text:'Payment choice'}), node('label', {text:'Original option'}, [options]), choice,
      node('p', {className:'field-note', text:'Amounts use the asset’s original base units. A quote does not make a payment.'}),
      detail('Full original declaration', value.bazaar), detail('Discovery source', value.source)]),
  ]));
  target.scrollIntoView({behavior:'smooth', block:'start'});
}

async function loadHistory(more = false) {
  const serial = state.serial, status = $('history-status').value;
  const result = await client.call('bazaar_history', {limit:25, ...(status ? {status} : {}), ...(more ? {cursor:state.historyCursor} : {})});
  if (serial !== state.serial) return;
  state.history = more ? [...state.history, ...result.quotes] : result.quotes; state.historyCursor = result.nextCursor;
  $('durability').textContent = result.durable ? 'Durable quote workspace' : 'In-memory quotes · Configure MCP_STATE_DIR for restart retention';
  const rows = state.history.map(quote => [
    button(short(quote.quoteId), () => openQuote(quote.quoteId), {class:'linklike', title:quote.quoteId}),
    quote.invocation?.toolName ?? quote.method, node('span', {className:'mono', text:quote.resource}),
    badge(quote.status), quote.selected?.amount + ' ' + quote.selected?.asset, time(quote.createdAt),
    button('Open quote', () => openQuote(quote.quoteId)),
  ]);
  $('history-list').replaceChildren(rows.length ? table(['Quote','Invocation','Resource','Status','Amount','Created',''], rows) : empty('No quotes match this view.'));
  const paging = node('div', {className:'pager'}, [node('span', {text:state.history.length + ' of ' + result.total + ' quotes loaded'})]);
  if (state.historyCursor) paging.append(button('Load more quotes', () => loadHistory(true)));
  $('history-list').append(paging);
}
async function loadResults(more = false) {
  const serial = state.serial;
  const result = await client.call('bazaar_results', {limit:25, ...(more ? {cursor:state.resultCursor} : {})});
  if (serial !== state.serial) return;
  state.results = more ? [...state.results, ...result.results] : result.results; state.resultCursor = result.nextCursor;
  const rows = state.results.map(quote => [
    button(quote.toolName || short(quote.quoteId), () => openResult(quote.quoteId), {class:'linklike'}),
    node('span', {className:'mono', text:short(quote.quoteId)}), badge(quote.status), size(quote.responseFile.bytes),
    time(quote.createdAt), button('Open saved result', () => openResult(quote.quoteId)),
  ]);
  $('results-list').replaceChildren(rows.length ? table(['Tool','Quote','Original status','Complete file','Created',''], rows) : empty('No complete native MCP result has been saved in this workspace yet. Quote history includes failed or interrupted captures.'));
  const paging = node('div', {className:'pager'}, [node('span', {text:state.results.length + ' of ' + result.total + ' saved results loaded'})]);
  if (state.resultCursor) paging.append(button('Load more results', () => loadResults(true)));
  $('results-list').append(paging);
}
async function openQuote(quoteId, scroll = true) {
  const serial = state.serial, selection = ++state.selection, quote = await client.call('bazaar_status', {quoteId});
  if (serial !== state.serial || selection !== state.selection) return false;
  selectQuote(quote); state.uncertain.delete(quoteId); renderQuote();
  if (scroll) $('quote-detail').scrollIntoView({behavior:'smooth', block:'start'});
  return true;
}
function selectQuote(quote) {
  if (state.quote?.quoteId !== quote.quoteId) {
    revokeDownloads(); state.result = null; $('result-detail').replaceChildren(); $('result-detail').hidden = true;
  }
  state.quote = quote;
}
async function executeQuote(quoteId) {
  const serial = state.serial; state.executing.add(quoteId); renderQuote();
  notice('Host approval requested for ' + quoteId + '. Refresh status or cancel this original quote while the host responds.');
  try {
    const quote = await client.call('bazaar_execute_approved', {quoteId});
    if (serial !== state.serial) return;
    if (state.quote?.quoteId === quoteId) state.quote = quote;
    state.uncertain.delete(quoteId);
    notice('Original quote ' + quoteId + ' returned ' + quote.status + '.');
  } catch (error) {
    if (serial === state.serial) {
      state.uncertain.add(quoteId);
      notice((error.code ? error.code + ' · ' : '') + error.message + ' Refresh this original quote before any further action.', true);
    }
  } finally {
    state.executing.delete(quoteId);
    if (serial === state.serial) renderQuote();
  }
}
async function quoteAction(name, quoteId) {
  const serial = state.serial, quote = await client.call(name, {quoteId});
  if (serial !== state.serial) return;
  if (state.quote?.quoteId === quoteId) { state.quote = quote; renderQuote(); }
  notice('Original quote ' + quoteId + ' is ' + quote.status + '.');
}
function renderQuote() {
  const q = state.quote, target = $('quote-detail'); if (!q) { target.hidden = true; return; }
  target.hidden = false;
  const active = ['PREVIEWED','APPROVAL_PENDING','EXECUTING','CANCEL_REQUESTED'].includes(q.status);
  const actions = node('div', {className:'actions'}, [
    button('Refresh quote status', () => openQuote(q.quoteId, false)),
    button(state.executing.has(q.quoteId) ? 'Host request in progress' : 'Request host approval', () => executeQuote(q.quoteId),
      {primary:true, disabled:q.status !== 'PREVIEWED' || state.executing.has(q.quoteId) || state.uncertain.has(q.quoteId)}),
    button('Cancel original quote', () => quoteAction('bazaar_cancel', q.quoteId), {disabled:!active}),
  ]);
  if (q.result?.responseFile?.status === 'SAVED') actions.append(button('Read complete saved result', () => openResult(q.quoteId)));
  if (q.invocation && q.attempts > 0 && !active)
    actions.append(button('Recover saved files', () => quoteAction('bazaar_recover_result', q.quoteId), {disabled:!client.tools.has('bazaar_recover_result')}));
  target.replaceChildren(node('div', {className:'detail-heading'}, [
    node('div', {}, [node('h2', {text:'Original quote'}), node('p', {className:'mono', text:q.quoteId})]), badge(q.status),
  ]), node('div', {className:'detail-grid'}, [
    node('div', {}, [node('h4', {text:'Exact invocation'}), facts([
      ['Resource', q.resource], ['Endpoint', q.requestUrl], ['Method', q.method],
      ['Tool', q.invocation?.toolName], ['Created', time(q.createdAt)], ['Updated', time(q.updatedAt)],
      ['Expires', time(q.expiresAt)], ['Attempts', q.attempts], ['Phase', q.phase],
    ]), ...(q.invocation ? [detail('Complete invocation and arguments', q.invocation)] : [])]),
    node('div', {}, [node('h4', {text:'Selected payment terms'}), facts(Object.entries(q.acceptedTerms ?? q.selected ?? {})),
      ...(q.result?.paymentResponse ? [detail('Original server payment receipt', q.result.paymentResponse)] : []),
      ...(q.failure ? [node('p', {text:q.failure})] : []),
      ...(q.result?.responseFile ? [detail('Saved file', q.result.responseFile)] : []),
      ...(q.result?.content ? [detail(q.result.content.truncated ? 'Truncated status preview' : 'Status preview', q.result.content)] : []),
    ]),
  ]), actions, node('p', {className:'caption', text:state.uncertain.has(q.quoteId)
    ? 'The last request did not return a confirmed response to this tab. Refresh the same quote; no new quote or purchase is created.'
    : 'Execution uses the host’s existing approval and signer. The displayed payment state comes from the original quote.'}));
}

async function openResult(quoteId) {
  const serial = state.serial;
  if (state.reading) throw new Error('A complete result is already being read.');
  state.reading = quoteId;
  try {
    if (!await openQuote(quoteId, false)) return;
    const selection = state.selection;
    if (serial !== state.serial) return;
    const result = await client.completeResult(quoteId, (read, total) => {
      if (serial === state.serial) notice('Reading saved result · ' + read.toLocaleString() + ' / ' + total.toLocaleString() + ' bytes');
    });
    if (serial !== state.serial || selection !== state.selection) return;
    revokeDownloads(); state.result = {...result, quoteId}; renderResult();
    $('result-detail').scrollIntoView({behavior:'smooth', block:'start'});
    notice('Complete saved result opened · ' + size(result.bytes.length) + '.');
  } finally { if (state.reading === quoteId) state.reading = null; }
}
function arrays(value, path = [], found = [], depth = 0) {
  if (Array.isArray(value)) { found.push({path, rows:value}); return found; }
  if (plain(value) && depth < 8) for (const [key, child] of Object.entries(value)) {
    if (found.length >= 64) break;
    arrays(child, [...path, key], found, depth + 1);
  }
  return found;
}
function renderRecords(value) {
  const root = node('div'), candidates = arrays(value);
  if (!candidates.length) { root.append(pre(value)); return root; }
  const selector = node('select', {id:'record-source', 'aria-label':'Record collection'}, candidates.map((entry, index) =>
    node('option', {value:index, text:(entry.path.length ? entry.path.join('.') : 'Root') + ' · ' + entry.rows.length + ' records'})));
  const filter = node('input', {type:'search', id:'record-filter', placeholder:'Find values in this collection', 'aria-label':'Filter records'});
  const grid = node('div'), paging = node('div', {className:'pager'}), selected = node('div'); let page = 0;
  function render() {
    const rows = candidates[Number(selector.value)].rows;
    const term = filter.value.toLocaleLowerCase();
    const matches = rows.map((value, index) => ({value, index})).filter(row => !term || JSON.stringify(row.value).toLocaleLowerCase().includes(term));
    const allColumns = [...new Set(matches.flatMap(row => plain(row.value) ? Object.keys(row.value) : ['Value']))];
    const columns = allColumns.slice(0, 32), count = Math.max(1, Math.ceil(matches.length / 40)); page = Math.min(page, count - 1);
    const visible = matches.slice(page * 40, page * 40 + 40);
    const cells = visible.map(row => [String(row.index + 1), ...columns.map(column => {
      const value = plain(row.value) ? row.value[column] : column === 'Value' ? row.value : undefined;
      const text = value === undefined ? '—' : typeof value === 'string' ? value : JSON.stringify(value);
      return node('span', {className:'record-cell', text:text.length > 240 ? text.slice(0, 240) + '…' : text});
    }), button('Open record', () => { selected.replaceChildren(node('h4', {text:'Complete record ' + (row.index + 1)}), pre(row.value)); })]);
    grid.replaceChildren(cells.length ? table(['#', ...columns, ''], cells, 'data-grid') : empty('No records match this filter.'));
    paging.replaceChildren(node('span', {text:matches.length + ' of ' + rows.length + ' records · Page ' + (page + 1) + ' of ' + count}),
      button('Previous records', () => { page--; render(); }, {disabled:page === 0}),
      button('Next records', () => { page++; render(); }, {disabled:page + 1 >= count}));
    if (allColumns.length > columns.length) paging.append(node('span', {text:columns.length + ' of ' + allColumns.length + ' fields shown. Open a record for every field.'}));
  }
  selector.addEventListener('change', () => { page = 0; selected.replaceChildren(); render(); });
  filter.addEventListener('input', () => { page = 0; render(); });
  root.append(node('div', {className:'record-controls'}, [node('label', {text:'Collection'}, [selector]), node('label', {text:'Filter records'}, [filter])]),
    grid, paging, selected, detail('Complete structured content', value)); render(); return root;
}
function embeddedBytes(value) {
  try { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
  catch { return null; }
}
function renderContent(items) {
  if (!Array.isArray(items) || !items.length) return empty('This result has no native content items.');
  return node('div', {}, items.map((item, index) => {
    const panel = node('section', {className:'content-block'}, [node('h4', {text:(index + 1) + ' · ' + (item.type ?? 'Content')})]);
    if (item.type === 'text') panel.append(pre(item.text ?? ''));
    else if (item.type === 'resource_link') panel.append(facts([['Name',item.name], ['Type',item.mimeType], ['Description',item.description]]), url(item.uri, item.title ?? item.uri));
    else if (item.type === 'resource' && item.resource) {
      const resource = item.resource;
      panel.append(facts([['Resource',resource.uri], ['Type',resource.mimeType]]));
      if (typeof resource.text === 'string') panel.append(pre(resource.text));
      if (typeof resource.blob === 'string') {
        const bytes = embeddedBytes(resource.blob);
        if (bytes) panel.append(node('p', {text:size(bytes.length)}), button('Download embedded resource', () => download(bytes, 'resource-' + (index + 1), resource.mimeType ?? 'application/octet-stream')));
      }
    } else if (['image','audio'].includes(item.type) && typeof item.data === 'string') {
      const bytes = embeddedBytes(item.data);
      if (bytes) {
        const mime = item.mimeType ?? 'application/octet-stream';
        const safeImage = /^image\/(png|jpeg|gif|webp)$/.test(mime), safeAudio = /^audio\/(mpeg|wav|ogg|mp4|webm)$/.test(mime);
        panel.append(node('p', {text:mime + ' · ' + size(bytes.length)}));
        if (safeImage || safeAudio) {
          const source = URL.createObjectURL(new Blob([bytes], {type:mime})); state.urls.add(source);
          panel.append(safeImage ? node('img', {src:source, alt:'Embedded image ' + (index + 1)}) : node('audio', {src:source, controls:true, preload:'none'}));
        }
        panel.append(button('Download embedded ' + item.type, () => download(bytes, item.type + '-' + (index + 1), mime)));
      }
    }
    panel.append(detail('Complete native item', item)); return panel;
  }));
}
function renderResult() {
  const result = state.result, target = $('result-detail'); if (!result) return;
  target.hidden = false;
  const body = node('div', {id:'result-body'}), tabs = node('div', {className:'subtabs', role:'tablist', 'aria-label':'Native result views'});
  const views = [['structured','Structured data'], ['content','Content'], ['raw','Complete JSON']];
  function show(name) {
    revokeDownloads();
    for (const tab of tabs.children) tab.setAttribute('aria-selected', String(tab.dataset.kind === name));
    if (name === 'structured') body.replaceChildren(result.native.structuredContent === undefined
      ? empty('No structuredContent field was returned. Content and Complete JSON retain the full native result.') : renderRecords(result.native.structuredContent));
    if (name === 'content') body.replaceChildren(renderContent(result.native.content));
    if (name === 'raw') body.replaceChildren(pre(new TextDecoder('utf-8', {fatal:true}).decode(result.bytes)));
  }
  for (const [name, label] of views) tabs.append(button(label, () => show(name), {role:'tab', 'data-kind':name, 'aria-selected':'false'}));
  target.replaceChildren(node('div', {className:'detail-heading'}, [
    node('div', {}, [node('h2', {text:'Complete saved result'}), node('p', {className:'mono', text:result.quoteId}),
      node('p', {text:size(result.bytes.length) + ' · Native CallToolResult JSON'}),
      ...(result.native.isError === true ? [node('p', {text:'The original tool reported an error.'})] : [])]),
    button('Download complete JSON', () => download(result.bytes, result.quoteId + '.json'), {primary:true}),
  ]), detail('Original file identity', {bytes:result.metadata.bytes, sha256:result.metadata.sha256, representation:result.metadata.representation}), tabs, body);
  show(result.native.structuredContent === undefined ? 'content' : 'structured');
}

$('connect-form').addEventListener('submit', connect);
$('disconnect').addEventListener('click', () => { reset(); notice('Disconnected. Original operations and saved results remain in the workspace.'); });
$('search-form').addEventListener('submit', event => { event.preventDefault(); attempt(() => search(event), event.submitter); });
$('refresh-history').addEventListener('click', event => attempt(() => loadHistory(false), event.currentTarget));
$('history-filter').addEventListener('submit', event => { event.preventDefault(); attempt(() => loadHistory(false), event.submitter); });
$('refresh-results').addEventListener('click', event => attempt(() => loadResults(false), event.currentTarget));
for (const tab of document.querySelectorAll('[data-view]')) tab.addEventListener('click', () => attempt(async () => {
  setView(tab.dataset.view);
  if (state.view === 'history') await loadHistory(false);
  if (state.view === 'results') await loadResults(false);
}));
window.addEventListener('pagehide', () => { client.disconnect(); revokeDownloads(); });
