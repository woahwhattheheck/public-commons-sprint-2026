// MIT. Local operator controls; all business/source values render as text.
const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
history.replaceState(null, '', location.pathname);
let state, eventAfter = 0, preview = null;
const notice = (message, error = false) => { $('notice').textContent = message; $('notice').classList.toggle('error', error); };
const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const button = (text, action) => { const node = element('button', text); node.type = 'button'; node.addEventListener('click', () => run(action)); return node; };
async function api(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error + (result.field ? ': ' + result.field : ''));
  return result;
}
async function run(action) {
  try { await action(); }
  catch (error) { notice(error.message + (error.message.includes('CHANGED') ? ' — Refresh to load the saved revision before editing again.' : ''), true); }
}
function download(name, body, type = 'application/json') {
  const url = URL.createObjectURL(body instanceof Blob ? body : new Blob([body], { type }));
  const anchor = element('a'); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
}
function fillSelect(node, entries, { all = false } = {}) {
  const selected = new Set([...node.selectedOptions].map(option => option.value)); node.replaceChildren();
  if (all) { const option = element('option', 'All sources'); option.value = ''; node.append(option); }
  for (const entry of entries) {
    const option = element('option', entry.label + (entry.enabled ? '' : ' (paused)')); option.value = entry.id; option.selected = selected.has(entry.id); node.append(option);
  }
}
function clean(value) { const { revision, updatedAt, ...definition } = value; return definition; }
function formValue(form, name) { return form.elements.namedItem(name).value; }
function itemRow(value, info, actions) {
  const row = element('div', undefined, 'item'), left = element('div'), title = element('strong', value.label ?? value.name);
  if (value.enabled !== undefined) title.append(element('span', value.enabled ? 'Active' : 'Paused', 'badge'));
  left.append(title, element('span', info)); row.append(left, actions); return row;
}
async function refresh() {
  state = await api('/api/status');
  $('accepted').textContent = state.acceptedEvents.toLocaleString(); $('retained').textContent = state.retainedEvents.toLocaleString();
  $('retries').textContent = state.duplicateDeliveries.toLocaleString(); $('watermark').textContent = state.highWatermark.toLocaleString();
  $('store-id').textContent = state.storeId;
  $('retention-summary').textContent = 'Bodies currently removed through sequence ' + state.purgedThroughSequence + '.';
  $('source-list').replaceChildren(...state.sources.map(source => itemRow(source, '/webhooks/' + source.id,
    button('Edit', () => loadSource(source)))));
  if (!state.sources.length) $('source-list').append(element('p', 'Add an event source to begin.'));
  $('feed-list').replaceChildren(...state.feeds.map(feed => itemRow(feed, '/feeds/' + feed.id + ' · ' + feed.projection.length + ' selected fields',
    button('Edit', () => loadFeed(feed)))));
  if (!state.feeds.length) $('feed-list').append(element('p', 'Create a feed after adding a source.'));
  fillSelect($('feed-sources'), state.sources); fillSelect($('events-source'), state.sources, { all: true });
  fillSelect($('preview-feed'), state.feeds); fillSelect($('plan-feeds'), state.feeds);
  $('snapshot-list').replaceChildren(...state.snapshots.map(snapshot => {
    const actions = element('div', undefined, 'item-actions');
    for (const file of ['snapshot.json', 'events.sqlite']) actions.append(button(file === 'snapshot.json' ? 'Manifest' : 'Database', async () => {
      const response = await fetch('/api/snapshot-file?' + new URLSearchParams({ name: snapshot.name, file }), { headers: { authorization: 'Bearer ' + token } });
      if (!response.ok) throw new Error('SNAPSHOT_DOWNLOAD_FAILED');
      download(file, await response.blob());
    }));
    return itemRow(snapshot, snapshot.retainedEvents + ' events · sequence ' + snapshot.highWatermark, actions);
  }));
  $('plan-summary').textContent = state.merchant.plan ? 'Saved ' + state.merchant.plan.feeds.length + ' feeds. Revision ' + state.merchant.revision.slice(0, 12) + '.' : 'Save payment terms for the feeds you want to publish.';
  $('plan-output').textContent = JSON.stringify(state.merchant.plan ?? {}, null, 2);
  notice('Store reopened. ' + state.retainedEvents + ' event bodies available.');
}
function loadSource(source = null) {
  const form = $('source-form'); form.reset(); form.dataset.revision = source?.revision ?? '';
  form.elements.id.readOnly = Boolean(source);
  if (source) for (const [key, value] of Object.entries(clean(source))) {
    const field = form.elements.namedItem(key); if (!field) continue; if (field.type === 'checkbox') field.checked = value; else field.value = value ?? '';
  }
  $('source-title').textContent = source ? 'Edit ' + source.label : 'Configure source';
  $('source-revision').textContent = source ? 'Revision ' + source.revision.slice(0, 16) : '';
}
function projectionRow(field = { name: '', pointer: '' }) {
  const row = element('tr'), name = element('input'), pointer = element('input');
  name.value = field.name; name.required = true; name.placeholder = 'sku'; name.setAttribute('aria-label', 'Output field name');
  pointer.value = field.pointer; pointer.required = true; pointer.placeholder = '/data/sku'; pointer.setAttribute('aria-label', 'Source JSON pointer');
  const a = element('td'), b = element('td'), c = element('td'); a.append(name); b.append(pointer); c.append(button('Remove', () => row.remove()));
  row.append(a, b, c); $('projection-fields').append(row);
}
function loadFeed(feed = null) {
  const form = $('feed-form'); form.reset(); form.dataset.revision = feed?.revision ?? '';
  form.elements.id.readOnly = Boolean(feed);
  if (feed) {
    for (const name of ['id', 'label', 'description', 'defaultPageSize', 'maxPageSize']) form.elements.namedItem(name).value = feed[name];
    form.elements.enabled.checked = feed.enabled; form.elements.types.value = feed.types.join(', ');
    for (const option of $('feed-sources').options) option.selected = feed.sourceIds.includes(option.value);
  }
  $('projection-fields').replaceChildren();
  for (const field of feed?.projection ?? [{ name: 'objectId', pointer: '/data/id' }]) projectionRow(field);
  form.dataset.maxPageBytes = String(feed?.maxPageBytes ?? 1048576);
  $('feed-revision').textContent = feed ? 'Revision ' + feed.revision.slice(0, 16) : '';
}
async function readEvents(reset = false) {
  if (reset) eventAfter = 0;
  const rows = await api('/api/events?' + new URLSearchParams({ after: String(eventAfter), limit: '50', ...($('events-source').value ? { sourceId: $('events-source').value } : {}) }));
  $('events-rows').replaceChildren(...rows.map(event => {
    const row = element('tr');
    for (const text of [event.sequence, event.sourceId + ' / ' + event.eventId, event.type ?? 'Body removed', event.acceptedAt, event.attempts]) row.append(element('td', String(text)));
    const action = element('td'); const inspect = button('Inspect', async () => {
      const result = await api('/api/event?sequence=' + event.sequence);
      $('event-output').textContent = JSON.stringify(result, null, 2);
    }); inspect.disabled = !event.retained; action.append(inspect); row.append(action); return row;
  }));
  if (rows.length) eventAfter = rows.at(-1).sequence;
  $('event-summary').textContent = rows.length ? rows.length + ' events shown; last sequence ' + eventAfter + '.' : 'No further events in this view.';
}
async function readPreview(first) {
  const feedId = $('preview-feed').value; if (!feedId) throw new Error('SELECT_A_FEED');
  const cursor = first || preview?.feedId !== feedId ? null : preview.page.nextCursor ?? preview.page.resumeCursor;
  preview = await api('/api/preview?' + new URLSearchParams({ feedId, ...(cursor ? { cursor } : {}) }));
  $('preview-summary').textContent = preview.items.length + ' events · snapshot through ' + preview.page.throughSequence + ' · revision ' + preview.feedRevision.slice(0, 12) + '.';
  $('preview-output').textContent = JSON.stringify(preview.items, null, 2);
  $('preview-next').disabled = false; $('preview-next').textContent = preview.page.hasMore ? 'Next page' : 'Read new events'; $('preview-export').disabled = false;
}
for (const tab of document.querySelectorAll('[data-tab]')) tab.addEventListener('click', () => {
  for (const panel of document.querySelectorAll('.tab')) panel.hidden = panel.id !== tab.dataset.tab;
  for (const other of document.querySelectorAll('[data-tab]')) other.classList.toggle('active', other === tab);
  if (tab.dataset.tab === 'events') run(() => readEvents(true));
});
$('refresh').addEventListener('click', () => run(refresh));
$('new-source').addEventListener('click', () => loadSource()); $('new-feed').addEventListener('click', () => loadFeed());
$('add-field').addEventListener('click', () => projectionRow());
$('source-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  const form = event.currentTarget, definition = {};
  for (const field of ['id', 'label', 'secretEnv', 'typePointer']) definition[field] = formValue(form, field);
  definition.occurredAtPointer = formValue(form, 'occurredAtPointer') || null;
  for (const field of ['maxEventBytes', 'toleranceSeconds']) definition[field] = Number(formValue(form, field));
  definition.enabled = form.elements.enabled.checked;
  const result = await api('/api/source', { definition, expectedRevision: form.dataset.revision || null });
  await refresh(); loadSource(result); notice('Source saved: ' + result.id + '.');
}); });
$('feed-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  const form = event.currentTarget, definition = { id: formValue(form, 'id'), label: formValue(form, 'label'), description: formValue(form, 'description'),
    sourceIds: [...$('feed-sources').selectedOptions].map(option => option.value),
    types: formValue(form, 'types').split(',').map(value => value.trim()).filter(Boolean),
    projection: [...$('projection-fields').children].map(row => ({ name: row.children[0].firstElementChild.value, pointer: row.children[1].firstElementChild.value })),
    enabled: form.elements.enabled.checked, defaultPageSize: Number(formValue(form, 'defaultPageSize')),
    maxPageSize: Number(formValue(form, 'maxPageSize')), maxPageBytes: Number(form.dataset.maxPageBytes),
  };
  const result = await api('/api/feed', { definition, expectedRevision: form.dataset.revision || null });
  await refresh(); loadFeed(result); notice('Feed saved. Prepare a new merchant release to publish this revision.');
}); });
$('events-first').addEventListener('click', () => run(() => readEvents(true))); $('events-next').addEventListener('click', () => run(() => readEvents()));
$('events-source').addEventListener('change', () => run(() => readEvents(true)));
$('preview-start').addEventListener('click', () => run(() => readPreview(true))); $('preview-next').addEventListener('click', () => run(() => readPreview(false)));
$('preview-export').addEventListener('click', () => { if (preview) download(preview.feedId + '-page.json', JSON.stringify(preview, null, 2) + '\n'); });
$('plan-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  const form = event.currentTarget, payment = { scheme: 'exact', network: formValue(form, 'network'), amount: formValue(form, 'amount'),
    asset: formValue(form, 'asset'), payTo: formValue(form, 'payTo'), maxTimeoutSeconds: Number(formValue(form, 'maxTimeoutSeconds')) };
  const plan = { schema: 'stellar-forge.webhook-feed-merchant.v1', publicOrigin: formValue(form, 'publicOrigin').replace(/\/$/, ''),
    feeds: [...$('plan-feeds').selectedOptions].map(option => ({ feedId: option.value, payment })) };
  await api('/api/plan', { plan, expectedRevision: state.merchant.revision }); await refresh(); notice('Merchant payment plan saved.');
}); });
$('release-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  const result = await api('/api/release', { name: formValue(event.currentTarget, 'name') });
  const output = $('release-output'); output.replaceChildren(element('p', 'Prepared: ' + result.directory, 'mono'));
  const actions = element('div', undefined, 'item-actions');
  for (const [name, content] of Object.entries(result.downloads)) actions.append(button('Download ' + name, () => download(name, content, name.endsWith('.mjs') ? 'text/javascript' : 'application/json')));
  output.append(actions); notice('Deployment files prepared with the selected feed revisions.');
}); });
$('snapshot-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  const result = await api('/api/snapshot', { name: formValue(event.currentTarget, 'name') }); await refresh();
  notice('Snapshot saved through sequence ' + result.highWatermark + '. Download both files to keep a portable copy.');
}); });
$('retention-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  const form = event.currentTarget;
  if (!form.elements.confirmed.checked) throw new Error('RETENTION_REVIEW_REQUIRED');
  const result = await api('/api/retention', { throughSequence: Number(formValue(form, 'throughSequence')), expectedHighWatermark: state.highWatermark });
  await refresh(); form.reset(); notice('Removed ' + result.deleted + ' event bodies. Delivery identities are retained.');
}); });
if (!token) notice('Open the complete private workspace URL printed by the merchant command.', true);
else run(async () => {
  await refresh(); loadSource(); loadFeed();
  const plan = state.merchant.plan, form = $('plan-form'), entry = plan?.feeds[0], payment = entry?.payment ?? entry?.paymentOptions?.[0];
  if (plan) {
    form.elements.publicOrigin.value = plan.publicOrigin;
    for (const option of $('plan-feeds').options) option.selected = plan.feeds.some(feed => feed.feedId === option.value);
  }
  if (payment) for (const name of ['network', 'amount', 'asset', 'payTo', 'maxTimeoutSeconds']) form.elements.namedItem(name).value = payment[name];
});
