/* MIT. Plain operator UI; source text is always rendered as text. */
'use strict';
const $ = id => document.getElementById(id);
const selection = { feed: '', capture: '', reviewRevision: null, edition: '', comparison: '',
  capturesOffset: 0, reviewOffset: 0, recordsOffset: 0, changesOffset: 0,
  capturesNext: null, reviewNext: null, recordsNext: null, changesNext: null, decisions: {}, conflicts: new Set() };
let state = { feeds: [], editions: [] }, currentReview = null, currentRecord = null, queryBase = {}, queryNext = null;
let running = false, selectedTab = 'sources', reviewSerial = 0, captureSerial = 0, recordSerial = 0;
const tokenKey = 'sf30-feed-token', pendingKey = 'sf30-feed-pending';
if (location.hash.length > 1) {
  sessionStorage.setItem(tokenKey, location.hash.slice(1));
  history.replaceState(null, '', location.pathname);
}
const token = sessionStorage.getItem(tokenKey) || '';
const el = (tag, value, cls) => { const n = document.createElement(tag); if (value !== undefined) n.textContent = value; if (cls) n.className = cls; return n; };
const info = (message, bad = false) => { $('notice').textContent = message; $('notice').classList.toggle('error', bad); };
const short = value => value ? value.slice(0, 12) : '';
const op = () => 'feed-' + crypto.randomUUID();
const selectedFeed = () => {
  const f = state.feeds.find(f => f.id === selection.feed);
  if (!f) throw new Error('Register and select a feed first.');
  return f;
};
function safe(fn) {
  return async event => {
    if (event?.type === 'submit') event.preventDefault();
    try { await fn(event); } catch (error) { info(error.message, true); }
  };
}
function button(label, callback) {
  const n = el('button', label); n.type = 'button'; n.addEventListener('click', safe(callback)); return n;
}
function empty(node, message) {
  node.replaceChildren(el('p', message, 'muted'));
}
function detail(value, title = 'Retained data') {
  const n = el('details'); n.append(el('summary', title), el('pre', JSON.stringify(value, null, 2))); return n;
}
function table(headers, rows) {
  const wrap = el('div', undefined, 'table-scroll'), t = el('table'), thead = el('thead'), tr = el('tr'), body = el('tbody');
  for (const name of headers) tr.append(el('th', name));
  thead.append(tr);
  for (const row of rows) {
    const r = el('tr');
    for (const value of row) { const c = el('td'); if (value instanceof Node) c.append(value); else c.textContent = value ?? ''; r.append(c); }
    body.append(r);
  }
  t.append(thead, body); wrap.append(t); return wrap;
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { Authorization: 'Bearer ' + token, ...options.headers }, cache: 'no-store' });
  const type = response.headers.get('content-type') || '';
  if (!type.startsWith('application/json')) throw new Error('The local console returned an unexpected response.');
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Workspace request failed.');
  return value;
}
function url(path, params) {
  return path + '?' + new URLSearchParams(Object.entries(params).filter(([,v]) => v !== null && v !== undefined)).toString();
}
async function download(path, filename) {
  if (running) throw new Error('Let the current workspace action finish before downloading.');
  const response = await fetch(path, { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' });
  if (!response.ok) {
    const value = await response.json(); throw new Error(value.error || 'Download failed.');
  }
  const blob = await response.blob(), target = URL.createObjectURL(blob), a = el('a');
  a.href = target; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(target), 10000);
  info('Downloaded ' + filename + '.');
}
function pending(value) {
  if (value) sessionStorage.setItem(pendingKey, JSON.stringify(value));
  else sessionStorage.removeItem(pendingKey);
  $('pending').hidden = !sessionStorage.getItem(pendingKey);
}
function pendingValue() {
  try { return JSON.parse(sessionStorage.getItem(pendingKey)); } catch { return null; }
}
async function watch(first) {
  let job = first;
  $('activity').hidden = false;
  try {
    for (;;) {
      $('activity-title').textContent = job.action + ' · ' + job.state.toLowerCase();
      const p = job.capture;
      $('activity-detail').textContent = p ? p.pages + ' saved pages · ' + p.requests + ' HTTP requests' +
        (p.nextUrl ? ' · ' + p.nextUrl : '') : 'Operation ' + (job.operationId || short(job.id));
      $('cancel').hidden = !['capture', 'resume'].includes(job.action) || job.state !== 'RUNNING';
      if (job.state === 'DONE') return job.result;
      if (job.state === 'FAILED') throw new Error(job.error);
      if (job.state !== 'RUNNING') throw new Error('This process has no running operation. Resume the saved action.');
      await new Promise(resolve => setTimeout(resolve, 650));
      const next = await api('/api/activity');
      if (next.id !== first.id) throw new Error('Another operator selected a new action. Resume your saved operation to read its retained result.');
      job = next;
    }
  } finally { $('activity').hidden = true; }
}
async function submit(body, after) {
  if (running) throw new Error('The workspace is completing its current action.');
  running = true; pending({ kind: 'action', body });
  let result;
  try {
    result = await watch(await api('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    pending(null); info('Completed ' + body.action + '.');
  } finally {
    running = false;
    await loadState().catch(() => {});
  }
  if (after) await after(result);
  return result;
}
async function upload(kind, file, feedId = '') {
  if (running) throw new Error('The workspace is completing its current action.');
  if (!file) throw new Error('Choose the original file.');
  const key = [kind, feedId, file.name, file.size, file.lastModified].join('|'), prior = pendingValue();
  const operation = prior?.kind === 'upload' && prior.key === key ? prior.operation : op();
  pending({ kind: 'upload', key, operation, action: kind, feedId, name: file.name });
  running = true;
  let result;
  try {
    result = await watch(await api(url('/api/' + kind, { feed: feedId || undefined, operation }), {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file }));
    pending(null); info('Completed ' + kind + '.');
  } finally {
    running = false;
    await loadState().catch(() => {});
  }
  return result;
}
function switchTab(name) {
  selectedTab = name;
  for (const n of document.querySelectorAll('.tab')) n.hidden = n.id !== name;
  for (const n of document.querySelectorAll('nav button')) {
    if (n.dataset.tab === name) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
  }
  if (name === 'records' && selection.feed) void loadRecords().catch(e => info(e.message, true));
}
function options(node, values, selected) {
  node.replaceChildren();
  for (const [value, label] of values) { const o = el('option', label); o.value = value; node.append(o); }
  if (values.some(([v]) => v === selected)) node.value = selected;
}
async function loadState() {
  const next = await api('/api/state');
  state = next;
  const previous = selection.feed;
  if (!state.feeds.some(f => f.id === selection.feed)) selection.feed = state.feeds[0]?.id || '';
  if (previous !== selection.feed) clearReview();
  options($('feed-select'), state.feeds.map(f => [f.id, f.config.label + ' · r' + f.revision]), selection.feed);
  const feed = state.feeds.find(f => f.id === selection.feed);
  $('feed-description').textContent = feed ? feed.records + ' retained records · ' + feed.config.url : 'Register a feed to begin.';
  $('feed-identity').textContent = feed?.atomId ? 'Atom identity: ' + feed.atomId : '';
  $('record-feed').textContent = selection.feed;
  const checkedFeeds = new Set([...$('edition-feeds').querySelectorAll('input:checked')].map(n => n.value));
  $('edition-feeds').replaceChildren();
  for (const f of state.feeds) {
    const label = el('label', undefined, 'check'), input = el('input');
    input.type = 'checkbox'; input.value = f.id; input.checked = checkedFeeds.has(f.id) || !checkedFeeds.size && f.id === selection.feed;
    label.append(input, document.createTextNode(f.config.label + ' · r' + f.revision)); $('edition-feeds').append(label);
  }
  if (!$('edition-fields').children.length) for (const field of state.fields) {
    const label = el('label', undefined, 'check'), input = el('input');
    input.type = 'checkbox'; input.value = field; input.checked = state.defaultFields.includes(field); input.disabled = field === 'key';
    label.append(input, document.createTextNode(field)); $('edition-fields').append(label);
  }
  renderEditions();
  if (selection.feed) await loadCaptures();
  else empty($('capture-list'), 'Source captures will appear here.');
}
function clearReview() {
  selection.capture = ''; selection.reviewOffset = 0; selection.decisions = {}; selection.conflicts = new Set();
  selection.reviewRevision = null; currentReview = null; reviewSerial++;
  $('review-panel').hidden = true; $('http-panel').hidden = true; $('accept-identity').checked = false;
}
async function loadCaptures() {
  if (!selection.feed) return;
  const serial = ++captureSerial, feed = selection.feed;
  const result = await api(url('/api/captures', { feed, offset: selection.capturesOffset }));
  if (serial !== captureSerial || feed !== selection.feed) return;
  selection.capturesNext = result.nextOffset;
  $('captures-back').disabled = selection.capturesOffset === 0;
  $('captures-next').disabled = result.nextOffset === null;
  $('capture-page').textContent = result.items.length ? 'Showing ' + (selection.capturesOffset + 1) + '–' + (selection.capturesOffset + result.items.length) : '';
  if (!result.items.length) return empty($('capture-list'), 'Capture the feed URL or import its original RSS or Atom file.');
  $('capture-list').replaceChildren(table(['Source capture', 'Acquired', 'State', 'Action'], result.items.map(c => {
    const title = el('div'); title.append(el('p', new Date(c.created * 1000).toLocaleString()), el('span', short(c.id), 'mono'));
    if (c.error) title.append(el('p', c.error, 'muted'));
    const actions = el('div', undefined, 'buttons');
    if (c.state === 'CAPTURED') actions.append(button('Review', () => selectCapture(c.id)));
    else actions.append(button('Resume capture', () => submit({ action: 'resume', captureId: c.id }, r => selectCapture(r.id))));
    if (c.nextUrl && c.state === 'CAPTURED') actions.append(button('Continue next pages', () => capture(c.id)));
    return [title, c.pages.length + ' pages · ' + c.pages.reduce((n,p) => n + p.entryCount, 0) + ' observations', el('span', c.state, 'badge'), actions];
  })));
}
async function selectCapture(id) {
  clearReview(); selection.capture = id;
  await loadReview();
}
async function loadReview() {
  const capture = selection.capture, serial = ++reviewSerial;
  const review = await api(url('/api/review', { capture, offset: selection.reviewOffset, limit: 25 }));
  if (serial !== reviewSerial || capture !== selection.capture) return;
  if (selection.reviewRevision !== null && selection.reviewRevision !== review.feed.revision) {
    selection.decisions = {}; selection.conflicts = new Set();
    info('The feed revision changed. Review choices have been reset to the current retained state.');
  }
  selection.reviewRevision = review.feed.revision; currentReview = review; selection.reviewNext = review.nextOffset;
  $('review-panel').hidden = false; $('review-meta').replaceChildren(el('p', 'Capture ' + short(capture) + ' · feed revision ' + review.feed.revision, 'mono'));
  const pages = el('div', undefined, 'buttons');
  for (const p of review.capture.pages) pages.append(button('XML ' + short(p.sourceSha256), () =>
    download(url('/api/source', { sha256: p.sourceSha256 }), p.sourceSha256 + '.xml')));
  $('review-meta').append(pages);
  if (review.feedIdentityChanged) $('review-meta').append(el('p', 'Incoming Atom identity: ' + review.atomIdentities.join(', '), 'mono'));
  $('accept-identity-label').hidden = !review.feedIdentityChanged;
  $('review-counts').replaceChildren(...Object.entries(review.counts).map(([k,v]) => el('span', k + ' ' + v, 'metric')));
  $('review-list').replaceChildren();
  for (const item of review.items) {
    if (item.kind === 'CONFLICT') selection.conflicts.add(item.identity);
    const card = el('article', undefined, 'record-card');
    const title = item.candidate?.title || item.candidates[0]?.title || item.current?.title || item.candidates[0]?.id || 'Deleted entry';
    const h = el('h4'); h.append(el('span', item.kind, 'badge'), document.createTextNode(title)); card.append(h);
    card.append(el('div', item.candidates[0]?.id || item.identity, 'mono'));
    if (item.kind === 'CONFLICT') {
      const choices = [{ value: 'keep', label: item.current ? 'Keep retained version' : 'Leave this identity unselected', entry: item.current },
        ...item.candidates.map(c => ({ value: c.contentHash, label: (c.deleted ? 'Apply deletion' : 'Use captured version') + ' · ' +
          (c.updated || 'no update time') + ' · ' + short(c.contentHash), entry: c }))];
      for (const choice of choices) {
        const label = el('label'), input = el('input'); input.type = 'radio'; input.name = 'choice-' + item.identity;
        input.value = choice.value; input.checked = selection.decisions[item.identity] === choice.value;
        input.addEventListener('change', () => { selection.decisions[item.identity] = choice.value; renderReviewProgress(); });
        label.append(input, document.createTextNode(choice.label)); card.append(label);
        if (choice.entry) card.append(detail(choice.entry, 'Inspect exact selected data'));
      }
    } else {
      if (item.candidate?.summary?.text) card.append(el('p', item.candidate.summary.text.slice(0, 700)));
      card.append(detail({ current: item.current, captured: item.candidates }, 'Retained and captured versions'));
    }
    $('review-list').append(card);
  }
  if (!review.items.length) empty($('review-list'), 'This capture has no item observations. Existing records remain retained.');
  $('review-back').disabled = selection.reviewOffset === 0;
  $('review-next').disabled = review.nextOffset === null;
  renderReviewProgress();
}
function renderReviewProgress() {
  if (!currentReview) return;
  const total = currentReview.counts.CONFLICT || 0;
  const chosen = [...selection.conflicts].filter(id => Object.hasOwn(selection.decisions, id)).length;
  const applied = Boolean(currentReview.application);
  $('review-progress').textContent = applied ? 'This capture was applied at revision ' + currentReview.application.revision + '.' :
    chosen + ' of ' + total + ' conflicts selected · ' + currentReview.total + ' total identities. Missing older entries remain retained.';
  $('apply-capture').disabled = applied || chosen < total || currentReview.feedIdentityChanged && !$('accept-identity').checked;
}
async function capture(fromCapture) {
  const f = selectedFeed();
  return submit({ action: 'capture', feedId: f.id, operationId: op(), pageLimit: Number($('page-limit').value),
    followPages: $('follow-pages').checked, force: $('force-feed').checked, fromCapture: fromCapture || null }, r => selectCapture(r.id));
}
async function loadRequests() {
  const capture = selection.capture, receipts = await api(url('/api/requests', { capture }));
  if (capture !== selection.capture) return;
  $('http-panel').hidden = false; $('http-list').replaceChildren();
  if (!receipts.length) return empty($('http-list'), 'This capture came from an original file import.');
  for (const r of receipts) {
    const card = el('div', undefined, 'record-card');
    card.append(el('h4', 'Request ' + r.requestId + ' · ' + (r.status ? 'HTTP ' + r.status : 'transport failure')));
    card.append(el('div', r.url, 'mono'), detail(r, 'Request, response and validators'));
    if (r.sourceSha256) card.append(button('Download exact XML', () => download(url('/api/source', { sha256:r.sourceSha256 }), r.sourceSha256 + '.xml')));
    if (r.raw) card.append(button('Download response body', () => download(url('/api/http-body', { sha256:r.raw.sha256 }), r.raw.sha256 + '.body')));
    $('http-list').append(card);
  }
}
async function loadRecords() {
  const feed = selectedFeed(), serial = ++recordSerial;
  const result = await api(url('/api/records', { feed: feed.id, query: $('record-query').value, state: $('record-state').value, offset: selection.recordsOffset }));
  if (serial !== recordSerial || feed.id !== selection.feed) return;
  selection.recordsNext = result.nextOffset; $('record-count').textContent = result.total + ' matching retained records';
  $('records-back').disabled = selection.recordsOffset === 0; $('records-next').disabled = result.nextOffset === null;
  if (!result.items.length) return empty($('record-list'), 'No matching records. Apply a captured source or change the search.');
  $('record-list').replaceChildren(table(['Record', 'Published / updated', 'Review', 'Action'], result.items.map(r => {
    const title = el('div'); title.append(el('p', r.title || 'Deleted entry'), el('span', r.id, 'mono'));
    const annotation = (r.review.starred ? '★ ' : '') + r.review.tags.join(', ');
    return [title, (r.published || '—') + '\n' + (r.updated || '—'), annotation,
      button('Open record', () => openRecord(r))];
  })));
}
function openRecord(record) {
  currentRecord = { feedId: selection.feed, ...record };
  $('record-detail').replaceChildren(el('h3', record.title || 'Deleted entry'), el('p', record.id, 'mono'));
  if (record.link) {
    const target = new URL(record.link);
    if (['http:', 'https:'].includes(target.protocol)) {
      const a = el('a', 'Open publisher page'); a.href = target.href; a.rel = 'noreferrer noopener'; a.target = '_blank'; $('record-detail').append(a);
    }
  }
  $('record-detail').append(detail(record, 'Original normalized record'),
    button('Download original source', () => download(url('/api/source', { sha256: record.sourceSha256 }), record.sourceSha256 + '.xml')));
  $('record-note').value = record.review.note; $('record-tags').value = record.review.tags.join(', '); $('record-star').checked = record.review.starred;
  $('record-dialog').showModal();
}
function renderEditions() {
  if (!state.editions.length) empty($('edition-list'), 'Build an edition after reviewing and applying source captures.');
  else $('edition-list').replaceChildren(table(['Edition', 'Records', 'Feed revisions', 'Action'], state.editions.map(e => {
    const name = el('div'); name.append(el('p', e.name), el('span', short(e.id), 'mono'));
    return [name, e.rowCount, Object.entries(e.revisions).map(([k,v])=> k + ' r' + v).join(', '), button('Query', () => chooseEdition(e.id))];
  })));
  const choices = state.editions.map(e => [e.id, e.name + ' · ' + e.rowCount + ' rows · ' + short(e.id)]);
  for (const id of ['compare-before', 'compare-after', 'delivery-edition']) {
    const existing = $(id).value;
    options($(id), choices, existing || selection.edition);
  }
  if (selection.edition && !state.editions.some(e => e.id === selection.edition)) {
    selection.edition = ''; $('query-panel').hidden = true;
  }
}
async function chooseEdition(id) {
  selection.edition = id; queryNext = null; queryBase = {}; $('query-next').disabled = true;
  $('query-panel').hidden = false;
  $('query-title').textContent = 'Query · ' + state.editions.find(e => e.id === id).name;
  $('query-result').replaceChildren(); $('delivery-edition').value = id;
  switchTab('editions');
}
function renderQuery(result) {
  const response = result.response, body = response.body;
  if (response.status !== 200) throw new Error(body?.message || body?.error || 'Native query returned HTTP ' + response.status);
  const rows = body.rows || [], names = rows.length ? Object.keys(rows[0]) : [];
  $('query-result').replaceChildren(el('p', 'Snapshot ' + result.dataset.snapshot + ' · ' + (body.page?.total ?? rows.length) + ' matching rows', 'mono'));
  if (rows.length) $('query-result').append(table(names, rows.map(r => names.map(n => typeof r[n] === 'object' && r[n] !== null ? JSON.stringify(r[n]) : r[n]))));
  else $('query-result').append(el('p', 'The selected native query returned no rows.', 'muted'));
  queryNext = body.page?.nextCursor || null; $('query-next').disabled = !queryNext;
}
async function query(next = false) {
  if (!selection.edition) throw new Error('Choose a saved edition.');
  if (!next) {
    const params = JSON.parse($('query-params').value || '{}');
    if (!params || Array.isArray(params) || typeof params !== 'object' || Object.values(params).some(v => typeof v !== 'string'))
      throw new Error('Use a JSON object of native parameter names and string values.');
    if (Object.hasOwn(params, 'cursor')) throw new Error('Run the first page without a cursor, then use Next dataset page.');
    queryBase = { ...params, limit: $('query-limit').value };
  }
  const result = await submit({ action: 'query', editionId: selection.edition, params: { ...queryBase, ...(next ? { cursor:queryNext } : {}) } });
  renderQuery(result);
}
async function loadChanges() {
  const result = await api(url('/api/changes', { id: selection.comparison, offset: selection.changesOffset }));
  selection.changesNext = result.nextOffset;
  $('changes-next').hidden = result.nextOffset === null;
  const rows = el('div');
  for (const row of result.rows) rows.append(detail(row, row.kind + ' · ' + JSON.stringify(row.key)));
  const previous = $('comparison').querySelector('.change-rows');
  rows.className = 'change-rows';
  if (previous) previous.replaceWith(rows); else $('comparison').append(rows);
}
for (const n of document.querySelectorAll('nav button')) n.addEventListener('click', () => switchTab(n.dataset.tab));
$('refresh').onclick = safe(async () => { await loadState(); info('Workspace refreshed.'); });
$('feed-select').onchange = safe(async () => {
  selection.feed = $('feed-select').value; selection.capturesOffset = 0; selection.recordsOffset = 0; clearReview();
  await loadState(); if (selectedTab === 'records') await loadRecords();
});
$('feed-form').onsubmit = safe(async () => {
  const source = new URL($('feed-url').value);
  const extras = $('feed-origins').value.split('\n').map(x => x.trim()).filter(Boolean);
  const id = $('feed-id').value;
  await submit({ action:'register', feedId:id, config:{ url:source.href, label:$('feed-label').value, rssIdentity:$('rss-identity').value,
    allowedOrigins:[source.origin, ...extras] }, expectedRevision:Number($('feed-revision').value), operationId:op() });
  selection.feed = id; clearReview(); await loadState(); $('feed-revision').value = selectedFeed().revision;
});
$('edit-feed').onclick = safe(() => {
  const f = selectedFeed(); $('feed-id').value=f.id; $('feed-label').value=f.config.label; $('feed-url').value=f.config.url;
  $('rss-identity').value=f.config.rssIdentity; $('feed-origins').value=f.config.allowedOrigins.join('\n'); $('feed-revision').value=f.revision;
});
$('capture-form').onsubmit = safe(() => capture());
$('import-form').onsubmit = safe(async () => {
  const r = await upload('import', $('source-file').files[0], selectedFeed().id); await selectCapture(r.id);
});
$('captures-back').onclick = safe(async () => { selection.capturesOffset=Math.max(0, selection.capturesOffset-50); await loadCaptures(); });
$('captures-next').onclick = safe(async () => { selection.capturesOffset=selection.capturesNext; await loadCaptures(); });
$('review-back').onclick = safe(async () => { selection.reviewOffset=Math.max(0,selection.reviewOffset-25); await loadReview(); });
$('review-next').onclick = safe(async () => { selection.reviewOffset=selection.reviewNext; await loadReview(); });
$('accept-identity').onchange = renderReviewProgress;
$('show-requests').onclick = safe(loadRequests);
$('apply-capture').onclick = safe(async () => {
  const id=selection.capture;
  await submit({ action:'apply', captureId:id, expectedRevision:selection.reviewRevision, decisions:selection.decisions,
    acceptIdentity:$('accept-identity').checked, operationId:op() });
  await selectCapture(id);
});
$('search-form').onsubmit = safe(async () => { selection.recordsOffset=0; await loadRecords(); });
$('records-back').onclick = safe(async () => { selection.recordsOffset=Math.max(0,selection.recordsOffset-50); await loadRecords(); });
$('records-next').onclick = safe(async () => { selection.recordsOffset=selection.recordsNext; await loadRecords(); });
$('annotation-form').onsubmit = safe(async () => {
  if (!currentRecord) throw new Error('Choose a retained record.');
  await submit({ action:'annotate', feedId:currentRecord.feedId, identity:currentRecord.identity, expectedRevision:currentRecord.review.revision,
    note:$('record-note').value, tags:$('record-tags').value.split(',').map(x=>x.trim()).filter(Boolean),
    starred:$('record-star').checked, operationId:op() });
  $('record-dialog').close(); await loadRecords();
});
$('edition-form').onsubmit = safe(async () => {
  const ids=[...$('edition-feeds').querySelectorAll('input:checked')].map(n=>n.value);
  const fields=[...$('edition-fields').querySelectorAll('input:checked')].map(n=>n.value);
  const revisions=Object.fromEntries(ids.map(id=>[id,state.feeds.find(f=>f.id===id).revision]));
  await submit({ action:'edition', feedIds:ids, name:$('edition-name').value, fields, expectedRevisions:revisions, operationId:op() }, r=>chooseEdition(r.id));
});
$('query-form').onsubmit = safe(()=>query());
$('query-next').onclick = safe(()=>query(true));
$('compare-form').onsubmit = safe(async () => {
  const r=await submit({ action:'compare', beforeId:$('compare-before').value, afterId:$('compare-after').value });
  selection.comparison=r.id; selection.changesOffset=0;
  $('comparison').replaceChildren(el('p',Object.entries(r.counts).map(([k,v])=>k+': '+v).join(' · ')),el('p',r.semantics,'muted'));
  $('changes-download').hidden=false; await loadChanges();
});
$('changes-next').onclick = safe(async()=>{selection.changesOffset=selection.changesNext;await loadChanges();});
$('changes-download').onclick = safe(()=>download(url('/api/changes/download',{id:selection.comparison}),'feed-edition-changes.jsonl'));
$('export-dataset').onclick = safe(()=>download(url('/api/export',{edition:$('delivery-edition').value}),'feed-dataset.zip'));
$('export-project').onclick = safe(()=>download(url('/api/project',{edition:$('delivery-edition').value}),'feed-project.zip'));
$('receive-form').onsubmit = safe(async()=>{await upload('receive',$('project-file').files[0]);});
$('cancel').onclick = safe(async()=>{await api('/api/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});info('Capture cancellation requested; its saved pages can be resumed.');});
$('retry').onclick = safe(async()=>{
  const value=pendingValue();
  if(value?.kind==='action') await submit(value.body);
  else if(value?.kind==='upload') {switchTab(value.action==='receive'?'delivery':'sources');info('Choose '+value.name+' again. The same retained operation ID will be used.');}
});
$('clear-pending').onclick = ()=>{pending(null);info('Browser selection cleared. Retained workspace operations remain available.');};
async function boot() {
  pending(pendingValue());
  const current=await api('/api/activity');
  if(current.state==='RUNNING') {
    running=true;
    try {await watch(current);} finally {running=false;}
  }
  const route=new URLSearchParams(location.search);
  if(route.has('feed')) selection.feed=route.get('feed');
  await loadState();
  if(route.has('collection')) $('subscriptions-link').href='/subscriptions?'+new URLSearchParams({collection:route.get('collection'),run:route.get('run')||''});
  if(route.has('capture')) await selectCapture(route.get('capture'));
  if(route.has('edition') && state.editions.some(e=>e.id===route.get('edition'))) await chooseEdition(route.get('edition'));
  info(state.feeds.length+' registered feeds · '+state.editions.length+' saved editions');
}
void boot().catch(error=>info(error.message,true));
