/** MIT. Reviewer controls using the unchanged native BuyerConsoleClient for saved results. */
import {BuyerConsoleClient} from '/native-client.mjs';
const $ = id => document.getElementById(id);
const client = new BuyerConsoleClient();
const state = {token:null, data:null, view:'overview', selectionId:null, busy:false,
  nativeInstance:null, quoteId:null, nativeQuote:null, result:null, history:null, savedResults:null};
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stringify = value => JSON.stringify(value, null, 2);
const bytesText = value => Number(value).toLocaleString() + ' bytes';
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))]
  .map(value => value.toString(16).padStart(2, '0')).join('');
function node(tag, properties = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(properties)) {
    if (key === 'text') element.textContent = value ?? '';
    else if (key === 'className') element.className = value;
    else if (value !== false && value !== null && value !== undefined) element.setAttribute(key, value === true ? '' : String(value));
  }
  element.append(...children.filter(value => value !== undefined && value !== null)); return element;
}
function text(value, className = '') { return node('p', {text:value, className}); }
function pre(value) { return node('pre', {text:typeof value === 'string' ? value : stringify(value)}); }
function detail(label, value) { return node('details', {}, [node('summary', {text:label}), pre(value)]); }
function card(title, children) { return node('section', {className:'card'}, [node('h2', {text:title}), ...children]); }
function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); }
function button(label, fn, options = {}) {
  const result = node('button', {type:'button', text:label, className:options.primary ? 'primary' : '',
    disabled:options.disabled, ...options.attrs});
  result.addEventListener('click', () => run(fn, result)); return result;
}
function table(headers, rows, className = '') {
  return node('div', {className:'table-wrap'}, [node('table', {className}, [
    node('thead', {}, [node('tr', {}, headers.map(label => node('th', {text:label, scope:'col'})))]),
    node('tbody', {}, rows.map(row => node('tr', {}, row.map(value =>
      node('td', {}, [value instanceof Node ? value : document.createTextNode(value === undefined || value === null ? '—' : String(value)))])))),
  ])]);
}
function field(label, control) {
  const id = control.id || 'field-' + crypto.randomUUID(); control.id = id;
  control.setAttribute('aria-label', label);
  return node('div', {className:'field'}, [node('label', {for:id, text:label}), control]);
}
function selected() { return state.data?.selections.find(item => item.id === state.selectionId); }
function endpoint(path) { return fetch(path, {headers:{authorization:'Bearer ' + state.token}, cache:'no-store', redirect:'error'}); }
async function api(path, payload) {
  const response = await fetch('/api/' + path, {method:payload === undefined ? 'GET' : 'POST', cache:'no-store',
    redirect:'error', headers:{authorization:'Bearer ' + state.token,
      ...(payload === undefined ? {} : {'content-type':'application/json'})},
    ...(payload === undefined ? {} : {body:JSON.stringify(payload)})});
  const value = await response.json();
  if (!response.ok || value.error) throw Object.assign(new Error(value.error?.message ?? 'Request failed.'), {code:value.error?.code});
  return value;
}
async function action(name, values = {}) {
  const fingerprint = await digest(new TextEncoder().encode(JSON.stringify({name, values})));
  const key = 'grant-reviewer-action:' + location.origin + ':' + fingerprint;
  let id; try { id = sessionStorage.getItem(key); } catch {}
  id ||= crypto.randomUUID(); try { sessionStorage.setItem(key, id); } catch {}
  // Only the original request ID and input digest are stored in the tab. Credentials stay in memory.
  const result = await api(name, {...values, requestId:id});
  try { sessionStorage.removeItem(key); } catch {}
  await refresh(false); return result;
}
async function run(fn, source) {
  if (state.busy) return;
  state.busy = true; if (source) source.disabled = true;
  try { await fn(); }
  catch (error) { notice((error.code ? error.code + ': ' : '') + error.message, true); }
  finally { state.busy = false; if (source?.isConnected) source.disabled = false; }
}
function resetNative() {
  client.disconnect(); state.nativeInstance = null; state.nativeQuote = null;
  state.result = null; state.history = null; state.savedResults = null;
}
async function refresh(renderPage = true) {
  state.data = await api('state');
  if (!state.data.selections.some(item => item.id === state.selectionId))
    state.selectionId = state.data.selected?.selectionId ?? state.data.selections.at(-1)?.id ?? null;
  if (state.nativeInstance !== state.data.buyer.instanceId) resetNative();
  const selection = $('selection'); selection.replaceChildren();
  if (!state.data.selections.length) selection.append(node('option', {value:'', text:'Review a packet to begin'}));
  for (const item of state.data.selections) selection.append(node('option', {value:item.id,
    text:item.title + ' · ' + item.state + ' · r' + item.revision}));
  selection.value = state.selectionId ?? '';
  $('connection-state').textContent = 'Workbench ' + state.data.id.slice(0, 8) + ' · ' +
    (state.data.buyer.active ? 'Original Buyer open' : 'Buyer closed');
  if (renderPage) await render();
}
function chosenRevision() {
  const value = selected(); if (!value) throw new Error('Review a packet first.');
  return {selectionId:value.id, expectedRevision:value.revision};
}
async function openBuyer() {
  const result = await action('open', chosenRevision()); resetNative();
  state.view = 'buyer'; await render(); notice('The original Buyer is open for this received packet.'); return result;
}
async function closeBuyer() {
  await action('close'); resetNative(); await render(); notice('The original Buyer closed and released its native stores.');
}
async function receiveSelected() {
  const result = await action('receive', chosenRevision());
  state.selectionId = result.selection.id; await render();
  notice('Received the original quote IDs, payment observations and exact result bytes.');
}
function selectionActions(value) {
  return node('div', {className:'actions'}, [
    button('Receive this packet', receiveSelected, {primary:true, disabled:value.state === 'RECEIVED'}),
    button('Open original Buyer', openBuyer, {disabled:value.state !== 'RECEIVED'}),
    ...(state.data.buyer.active ? [button('Close original Buyer', closeBuyer)] : []),
  ]);
}
function noSelection() {
  return card('Review a receiving packet', [text('Start with the original public purchase or choose an exported receiving packet.'),
    button('Go to packet intake', async () => { state.view = 'intake'; await render(); }, {primary:true})]);
}
async function overview() {
  const value = selected();
  const intro = card('Inspect a completed purchase', [
    text('Review the source and query, open the native Buyer history, read the complete results, then hand the retained purchase to another operator.'),
    node('ol', {className:'step-list'}, ['Review the exact packet and its original source.',
      'Receive its saved quotes and complete MCP results.',
      'Open the original Buyer and inspect both outcomes.',
      'Close the Buyer, export the receiving history, and open the received copy.'].map(item => node('li', {text:item}))),
  ]);
  if (!value) return [intro, noSelection()];
  return [intro, card(value.title, [
    node('div', {className:'stats'}, [
      node('div', {className:'stat'}, [node('strong', {text:value.packet.quotes.length}), node('span', {text:'Original quotes retained'})]),
      node('div', {className:'stat'}, [node('strong', {text:'0'}), node('span', {text:'New payments in this receiving workflow'})]),
      node('div', {className:'stat'}, [node('strong', {text:value.state === 'RECEIVED' ? 'Ready' : 'Reviewed'}), node('span', {text:'Receiving state · revision ' + value.revision})]),
    ]),
    text(value.packet.operationId, 'mono'), text(value.packet.source.description),
    selectionActions(value), detail('Packet identity', {packetId:value.packet.packetId,
      sha256:value.packet.sha256, bytes:value.packet.bytes, origin:value.origin}),
    ...(value.receipt ? [detail('Original receiving record', value.receipt)] : []),
  ])];
}
async function intake() {
  const form = node('form'), title = node('input', {name:'packet-title', value:'Received purchase', maxlength:180, required:true}),
    file = node('input', {type:'file', name:'packet-file', accept:'.json,application/json', required:true}),
    upload = node('button', {type:'submit', text:'Review selected packet'});
  form.append(field('Packet title', title), field('Receiving packet JSON', file),
    text('The original packet limit is 8 MiB. The browser computes its SHA-256 before the native inspector reads it.', 'muted'), upload);
  form.addEventListener('submit', event => { event.preventDefault(); run(async () => {
    const selectedFile = file.files[0]; if (!selectedFile || selectedFile.size > 8 * 1024 * 1024) throw new Error('Choose a receiving packet of at most 8 MiB.');
    const bytes = new Uint8Array(await selectedFile.arrayBuffer()); let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    const result = await action('review', {source:'upload', title:title.value, expectedSha256:await digest(bytes), base64:btoa(binary)});
    state.selectionId = result.selection.id; state.view = 'source'; await refresh();
    notice('Selected packet inspected. Review its source, query and original outcomes before receiving.');
  }, upload); });
  return [card('Original public purchase', [
    text('The installed packet contains the original NYC HPD MySQL demonstration, its two saved quote outcomes and complete result files.'),
    button('Review bundled purchase', async () => {
      const result = await action('review', {source:'bundled', title:'Original NYC HPD purchase'});
      state.selectionId = result.selection.id; state.view = 'source'; await refresh();
      notice('Original public packet inspected.');
    }, {primary:true}),
  ]), card('Receive an exported packet', [form]),
    ...(state.data.selections.length ? [card('Retained selections', [table(['Packet', 'State', 'Revision', 'Action'],
      state.data.selections.map(item => [item.title, item.state, item.revision,
        button('Review ' + item.title, async () => { state.selectionId = item.id; state.view = 'source'; await refresh(); })]))])] : [])];
}
async function downloadResponse(path, filename, expected) {
  const response = await endpoint(path);
  if (!response.ok) { const error = await response.json(); throw new Error(error.error?.message ?? 'Download failed.'); }
  const bytes = new Uint8Array(await response.arrayBuffer()), hash = await digest(bytes);
  if (expected && hash !== expected || response.headers.get('x-content-sha256') && hash !== response.headers.get('x-content-sha256'))
    throw new Error('The downloaded file differs from its retained SHA-256.');
  download(bytes, filename); notice('Downloaded ' + bytesText(bytes.length) + ' · SHA-256 ' + hash);
}
function download(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], {type:'application/json'}));
  const anchor = node('a', {href:url, download:filename}); document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function sourceView() {
  const value = selected(); if (!value) return [noSelection()];
  return [card('Source and query', [
    text(value.title), text(value.packet.source.description), text('Original operation: ' + value.packet.operationId, 'mono'),
    text('Source vintage: ' + (value.packet.source.dataAsOf ?? 'Recorded in the original source')),
    ...(value.packet.source.publicSourceUrl ? [node('a', {href:value.packet.source.publicSourceUrl, target:'_blank',
      rel:'noopener noreferrer', text:'Original public source'})] : []),
    detail('Exact saved query configuration', value.packet.query),
    detail('Complete original source identity', value.packet.source),
    selectionActions(value),
    button('Inspect retained workspace', async () => {
      const result = await api('selection?id=' + encodeURIComponent(value.id));
      $('source-inspection').replaceChildren(pre(result));
      notice(result.workspace ? 'Original native stores and retained files inspected.' : 'Packet and original file identities inspected.');
    }),
    node('div', {id:'source-inspection'}),
  ]), card('Original quotes and files', [
    table(['Quote', 'Seller status', 'Attempts', 'Retained observation', 'Result'],
      value.packet.quotes.map(quote => [quote.quoteId, quote.status, quote.attempts,
        quote.observation?.outcome, bytesText(quote.result.bytes)])),
    table(['Original document', 'Bytes', 'SHA-256', 'Download'], value.packet.documents.map((item, index) =>
      [item.path, item.bytes, node('span', {className:'mono', text:item.sha256}),
        button('Download ' + item.path.split('/').at(-1), () => downloadResponse('/api/document?id=' + value.id +
          '&index=' + index, item.path.split('/').at(-1), item.sha256))])),
    ...(value.packet.source.filmUrl ? [node('a', {href:value.packet.source.filmUrl, target:'_blank',
      rel:'noopener noreferrer', text:'Watch the original presentation'})] : []),
  ])];
}
async function ensureNative() {
  const buyer = state.data.buyer;
  if (!buyer.active || buyer.selectionId !== state.selectionId) return false;
  if (state.nativeInstance !== buyer.instanceId) {
    resetNative(); await client.connect(state.token);
    state.nativeInstance = buyer.instanceId;
  }
  return true;
}
function arraysIn(value, path = '$', depth = 0, result = []) {
  if (depth > 8 || result.length > 80) return result;
  if (Array.isArray(value)) {
    if (value.length && value.every(item => plain(item) || typeof item !== 'object')) result.push({path, rows:value});
    else value.forEach((item, index) => arraysIn(item, path + '[' + index + ']', depth + 1, result));
  } else if (plain(value)) for (const [key, child] of Object.entries(value)) arraysIn(child, path + '.' + key, depth + 1, result);
  return result;
}
function renderData(value) {
  const collections = arraysIn(value);
  if (!collections.length) return pre(value);
  collections.sort((a, b) => Number(b.path.endsWith('.rows')) - Number(a.path.endsWith('.rows')) || b.rows.length - a.rows.length);
  const root = node('div'), selector = node('select', {'aria-label':'Result collection'}),
    filter = node('input', {type:'search', placeholder:'Filter complete retained rows', 'aria-label':'Filter result rows'}),
    grid = node('div'), paging = node('div', {className:'actions'}), selectedRecord = node('div');
  for (const [index, collection] of collections.entries()) selector.append(node('option', {value:index,
    text:collection.path + ' · ' + collection.rows.length + ' rows'}));
  let page = 0;
  function paint() {
    const rows = collections[Number(selector.value)].rows;
    const matches = rows.map((row, index) => ({row, index})).filter(item =>
      !filter.value || JSON.stringify(item.row).toLocaleLowerCase().includes(filter.value.toLocaleLowerCase()));
    const columns = [...new Set(rows.flatMap(row => plain(row) ? Object.keys(row) : ['Value']))];
    const count = Math.max(1, Math.ceil(matches.length / 25)); page = Math.min(Math.max(0, page), count - 1);
    grid.replaceChildren(table(['#', ...columns, 'Record'], matches.slice(page * 25, page * 25 + 25).map(item =>
      [item.index + 1, ...columns.map(column => {
        const cell = plain(item.row) ? item.row[column] : item.row;
        const text = typeof cell === 'string' ? cell : JSON.stringify(cell);
        return text === undefined ? '—' : text.length > 200 ? text.slice(0, 200) + '…' : text;
      }), button('Open row ' + (item.index + 1), async () => selectedRecord.replaceChildren(
        node('h3', {text:'Complete row ' + (item.index + 1)}), pre(item.row)))]), 'data-grid'));
    paging.replaceChildren(text(matches.length + ' of ' + rows.length + ' rows · ' + columns.length +
      ' fields · Page ' + (page + 1) + ' of ' + count),
      button('Previous rows', async () => { page--; paint(); }, {disabled:page === 0}),
      button('Next rows', async () => { page++; paint(); }, {disabled:page + 1 >= count}));
  }
  selector.addEventListener('change', () => { page = 0; selectedRecord.replaceChildren(); paint(); });
  filter.addEventListener('input', () => { page = 0; paint(); });
  root.append(field('Result collection', selector), field('Filter result rows', filter), grid, paging, selectedRecord);
  paint(); return root;
}
function resultView(result) {
  const target = node('div'), tabs = node('div', {className:'tabs', role:'tablist'}),
    content = node('div'), parts = [['data', 'Structured data'], ['content', 'Native content'], ['json', 'Complete JSON']];
  function show(id) {
    for (const tab of tabs.children) tab.setAttribute('aria-selected', String(tab.dataset.id === id));
    content.replaceChildren(id === 'data' ? renderData(result.native.structuredContent ?? result.native) :
      id === 'content' ? pre(result.native.content) : pre(new TextDecoder('utf-8', {fatal:true}).decode(result.bytes)));
  }
  for (const [id, label] of parts) tabs.append(button(label, async () => show(id), {attrs:{role:'tab', 'data-id':id}}));
  target.append(node('div', {className:'result-bar'}, [
    node('div', {}, [node('h3', {text:'Complete saved result'}), text(bytesText(result.bytes.length) +
      ' · ' + result.metadata.representation), text(result.metadata.sha256, 'mono')]),
    button('Download complete JSON', async () => { download(result.bytes, state.quoteId + '.json'); notice('Downloaded the exact retained native result.'); }, {primary:true}),
  ]), ...(result.native.isError === true ? [text('The original tool returned an error. Its complete result and earlier seller status are retained.')] : []),
  tabs, content); show('data'); return target;
}
async function buyerView() {
  const value = selected(); if (!value) return [noSelection()];
  if (!await ensureNative()) return [card('Open the received packet', [
    text('The native Buyer owns this packet’s original quote store and complete saved results.'),
    selectionActions(value),
  ])];
  state.history = await client.call('bazaar_history', {limit:100});
  state.savedResults = await client.call('bazaar_results', {limit:100});
  const quoteIds = value.packet.quotes.map(item => item.quoteId);
  if (!quoteIds.includes(state.quoteId)) state.quoteId = value.packet.primaryQuoteId;
  const select = node('select', {'aria-label':'Original quote'});
  for (const quote of value.packet.quotes) select.append(node('option', {value:quote.quoteId,
    text:quote.quoteId + ' · ' + quote.status}));
  select.value = state.quoteId;
  select.addEventListener('change', () => run(async () => {
    state.quoteId = select.value; state.result = null; state.nativeQuote = null; await render();
  }));
  state.nativeQuote = await client.call('bazaar_status', {quoteId:state.quoteId});
  const original = value.packet.quotes.find(item => item.quoteId === state.quoteId);
  const resultTarget = node('div', {id:'complete-result'});
  if (state.result) resultTarget.append(resultView(state.result));
  return [card('Original Buyer results', [
    text('These reads use the maintained Buyer MCP client and the original saved-result range API.'),
    node('div', {className:'actions'}, [button('Refresh native history', async () => { await render(); notice('Native history refreshed.'); }),
      button('Close original Buyer', closeBuyer),
      button('Open original console', async () => {
        const connection = await api('buyer-connection');
        const holder = $('original-console'); holder.replaceChildren(
          text('The original console uses its own access form. Copy this instance’s code, open the console, and enter it there.'),
          button('Copy original console code', async () => {
            await navigator.clipboard.writeText(connection.accessToken); notice('Original console code copied to the clipboard.');
          }),
          node('a', {href:connection.consoleUrl, target:'_blank', rel:'noopener noreferrer', text:'Open Buyer console'}));
      }),
    ]), node('div', {id:'original-console'}), field('Original quote', select),
    detail('Exact reviewed invocation and terms', {invocation:original.invocation, accepted:original.accepted}),
    detail('Original transaction observation', original.observation),
    detail('Native quote status', state.nativeQuote),
    button('Read complete saved result', async () => {
      state.result = await client.completeResult(state.quoteId, (current, total) =>
        notice('Reading original result: ' + bytesText(current) + ' of ' + bytesText(total)));
      resultTarget.replaceChildren(resultView(state.result));
      notice('Complete result received and SHA-256 verified: ' + bytesText(state.result.bytes.length) + '.');
    }, {primary:true}), resultTarget,
    detail('Complete native quote history', state.history), detail('Native saved-result catalog', state.savedResults),
  ])];
}
async function handover() {
  const value = selected(); if (!value) return [noSelection()];
  const exports = state.data.operations.filter(item => item.kind === 'export' && item.state === 'COMPLETED' &&
    item.input.selectionId === value.id);
  return [card('Export the same purchase', [
    text('Export first closes the complete original Buyer, drains its current reads and takes the native store’s closed view. The packet keeps the original quote IDs, attempts, observations and result bytes, and adds this receiving stage’s history.'),
    button('Close Buyer and export packet', async () => {
      const result = await action('export', chosenRevision()); resetNative(); await render();
      notice('Export retained: ' + bytesText(result.export.bytes) + ' · SHA-256 ' + result.export.sha256);
    }, {primary:true, disabled:value.state !== 'RECEIVED'}),
    node('div', {className:'actions'}, [button('Reopen this received packet', openBuyer, {disabled:value.state !== 'RECEIVED'})]),
    text('A receiving operator can select the downloaded packet in another private reviewer workbench or in Applications. The selected packet SHA-256 is part of that launch review.'),
  ]), ...exports.map(item => {
    const result = item.result.export;
    return card('Receiving packet · ' + new Date(item.completedAt).toLocaleString(), [
      text(result.packetId, 'mono'), text(bytesText(result.bytes)), text(result.sha256, 'mono'),
      detail('Original and receiving identities', {sourcePacketId:result.sourcePacketId, packetId:result.packetId,
        exportActionId:item.id, exportedAt:result.exportedAt, originalQuotes:result.quotes}),
      node('div', {className:'actions'}, [
        button('Download receiving packet', () => downloadResponse('/api/export?id=' + item.id,
          'grant-reviewer-' + item.id + '.json', result.sha256), {primary:true}),
        button('Review receiving copy', async () => {
          const reviewed = await action('review', {source:'export', exportId:item.id,
            title:value.title + ' · receiving copy'});
          state.selectionId = reviewed.selection.id; state.view = 'source'; await refresh();
          notice('Receiving copy reviewed. Receive it to create a separate native directory with the same original quotes.');
        }),
      ]),
    ]);
  })];
}
async function history() {
  return [card('Retained activity', [text('Every action retains its original request ID and selected input identity. A continuation uses that same request; completed actions return their saved result.'),
    table(['Action', 'State', 'Original request', 'Attempts', 'Time'], state.data.operations.map(item =>
      [item.kind, item.state, node('span', {className:'mono', text:item.id}), item.attempts,
        new Date(item.completedAt ?? item.createdAt).toLocaleString()])),
    ...state.data.operations.map(item => detail(item.kind + ' · ' + item.id.slice(0, 8) + ' · ' + item.state, item)),
  ])];
}
async function render() {
  if (!state.data) return;
  for (const item of document.querySelectorAll('nav button')) item.setAttribute('aria-current',
    item.dataset.view === state.view ? 'page' : 'false');
  const views = {overview, intake, source:sourceView, buyer:buyerView, handover, history};
  $('main').replaceChildren(...await views[state.view]());
  $('selection').value = state.selectionId ?? '';
}
async function connect(token) {
  state.token = token; await refresh(false);
  $('connect-panel').hidden = true; $('workspace').hidden = false; await render();
  notice('Connected to this private reviewer.');
}
$('connect-form').addEventListener('submit', event => {
  event.preventDefault(); const token = $('access-token').value; $('access-token').value = '';
  run(() => connect(token), event.submitter);
});
$('refresh').addEventListener('click', () => run(() => refresh()));
$('selection').addEventListener('change', () => run(async () => {
  state.selectionId = $('selection').value; state.quoteId = null; state.result = null; await render();
}));
for (const item of document.querySelectorAll('nav button')) item.addEventListener('click', () => run(async () => {
  state.view = item.dataset.view; await render();
}));
$('disconnect').addEventListener('click', () => {
  resetNative(); state.token = null; state.data = null; $('workspace').hidden = true; $('connect-panel').hidden = false;
  $('main').replaceChildren(); $('connection-state').textContent = 'Disconnected';
  notice('Disconnected. The running workbench and original native records remain available.');
});
window.addEventListener('pagehide', () => { resetNative(); state.token = null; });
const fragment = location.hash.slice(1);
if (fragment) {
  window.history.replaceState(null, '', location.pathname);
  run(() => connect(decodeURIComponent(fragment)));
}
