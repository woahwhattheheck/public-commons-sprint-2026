// MIT. Plain local operator interface; all content is inserted as text.
const $ = selector => document.querySelector(selector);
let token = location.hash.slice(1);
if (token) { sessionStorage.setItem('ckan-project-token', token); history.replaceState(null, '', '/'); }
else token = sessionStorage.getItem('ckan-project-token') ?? '';
const view = $('#view'), notice = $('#notice');
let state, tab = 'catalog', selectedEdition, selectedPublication, selectedExport, selectedRefresh, refreshSource, refreshOffset = 0, refreshOffsets = [], catalogue, searchQuery = '', lastOperation, polling = false, renderGeneration = 0, searchGeneration = 0;
function element(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (key === 'checked' || key === 'disabled') node[key] = Boolean(value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
const heading = text => element('h2', {}, text);
const card = (...children) => element('div', { class: 'card' }, ...children);
const row = (...children) => element('div', { class: 'row' }, ...children);
const pre = value => element('pre', {}, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
const detail = (title, value) => element('details', {}, element('summary', {}, title), pre(value));
const muted = text => element('p', { class: 'muted' }, text);
const pill = text => element('span', { class: 'pill' }, text);
const input = (name, value = '', type = 'text', attrs = {}) => element('input', { name, value, type, ...attrs });
const label = (name, field, grow = false) => element('label', { class: grow ? 'grow' : '' }, name, field);
const button = (text, action, primary = false) => element('button', { type: 'button', class: primary ? 'primary' : '', onclick: () => protect(action) }, text);
function choose(name, values, current) {
  return element('select', { name }, values.map(item => {
    const [value, title] = Array.isArray(item) ? item : [item, item];
    const opt = element('option', { value }, title); opt.selected = value === current; return opt;
  }));
}
function table(records, columns) {
  if (!records?.length) return muted('No rows in this selection.');
  const keys = columns ?? Object.keys(records[0]);
  return element('div', { class: 'table-wrap' }, element('table', {},
    element('thead', {}, element('tr', {}, keys.map(key => element('th', {}, key)))),
    element('tbody', {}, records.map(record => element('tr', {}, keys.map(key => element('td', {},
      record[key] === null ? 'null' : typeof record[key] === 'object' ? JSON.stringify(record[key]) : record[key] ?? '')))))));
}
function fieldProjectionEditor(edition, projection = null) {
  const suggestions = new Map(edition.suggestions.map(item => [item.field, item]));
  const used = new Set(Object.values(projection ?? {}).map(item => item.field));
  const selected = projection ? Object.entries(projection).map(([alias, spec]) => ({
    ...(suggestions.get(spec.field) ?? { field: spec.field, providerType: 'Missing in this edition', sample: [], nulls: 0, empty: 0 }),
    ...spec, alias, selected: true,
  })) : edition.suggestions.map(spec => ({ ...spec, selected: true }));
  if (projection) for (const spec of edition.suggestions)
    if (!used.has(spec.field)) selected.push({ ...spec, selected: false });
  const rows = selected.map(spec => {
    const tr = element('tr', {},
      element('td', {}, input('selected', '', 'checkbox', { checked: spec.selected })),
      element('td', {}, spec.field, element('div', { class: 'muted' }, spec.providerType ?? ''),
        spec.sourceDefinition ? detail('Provider definition', spec.sourceDefinition) :
          spec.providerInfo ? detail('Provider dictionary', spec.providerInfo) : null),
      element('td', {}, input('alias', spec.alias)),
      element('td', {}, choose('type', ['string', 'integer', 'number', 'boolean'], spec.type)),
      element('td', {}, choose('encoding', [['native', 'Native'], ['text', 'Text'], ['json', 'JSON text']], spec.encoding ?? 'native')),
      element('td', {}, input('nullable', '', 'checkbox', { checked: spec.nullable })),
      element('td', {}, spec.nulls + ' null · ' + spec.empty + ' empty',
        element('div', { class: 'muted' }, JSON.stringify(spec.sample))));
    tr._field = spec.field; return tr;
  });
  return {
    node: element('div', { class: 'table-wrap field-list' }, element('table', {},
      element('thead', {}, element('tr', {}, ['Use', 'Source field', 'Alias', 'Type', 'Encoding', 'Nullable', 'Values'].map(value => element('th', {}, value)))),
      element('tbody', {}, rows))),
    value() {
      const value = Object.create(null);
      for (const tr of rows) {
        if (!tr.querySelector('[name=selected]').checked) continue;
        const alias = tr.querySelector('[name=alias]').value.trim();
        if (Object.hasOwn(value, alias)) throw new Error('Each field needs a unique alias.');
        value[alias] = { field: tr._field, type: tr.querySelector('[name=type]').value,
          encoding: tr.querySelector('[name=encoding]').value, nullable: tr.querySelector('[name=nullable]').checked };
      }
      return value;
    },
  };
}
function message(error) { notice.replaceChildren(element('div', { class: 'error' }, error.message ?? String(error))); }
async function protect(action) {
  notice.replaceChildren();
  try { return await action(); } catch (error) { message(error); }
}
async function api(path, data) {
  const response = await fetch('/api/' + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + token, ...(data === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const value = await response.json();
  if (!response.ok) throw new Error((value.error ?? response.status) + ': ' + (value.message ?? 'Request failed.'));
  return value;
}
function operation() {
  const current = state.operation, slot = $('#operation'); slot.replaceChildren();
  if (!current) return;
  const text = current.kind + ' · ' + current.state;
  if (current.state === 'RUNNING') slot.append(element('div', { class: 'operation' },
    element('div', {}, element('strong', {}, text), current.progress ? element('div', { class: 'mono' }, JSON.stringify(current.progress)) : null),
    button('Stop operation', async () => { await api('cancel', {}); await refresh(false); })));
  else if (current.state === 'FAILED' || current.state === 'CANCELLED' || current.state === 'INTERRUPTED')
    slot.append(element('div', { class: 'operation' }, element('div', {}, element('strong', {}, text),
      element('div', { class: 'muted' }, current.error?.message ?? current.error ?? 'Read the retained project item to continue.'))));
}
async function refresh(render = true) {
  state = await api('status');
  $('#project').replaceChildren(element('div', {}, state.catalogOrigin), element('div', {}, state.directory));
  operation();
  if (render) await renderView();
  if (state.active && !polling) poll();
}
async function poll() {
  polling = true;
  try {
    while (state?.active) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      await refresh(false);
    }
    if (lastOperation && state.operation?.id === lastOperation) {
      const result = state.operation.result;
      if (state.operation.state === 'COMPLETE') {
        if (state.editions.some(item => item.id === result?.id)) { selectedEdition = result.id; tab = 'editions'; }
        if (state.publications.some(item => item.id === result?.id)) { selectedPublication = result.id; tab = 'products'; }
        if ((state.refreshes ?? []).some(item => item.id === result?.id)) { selectedRefresh = result.id; refreshSource = result.sourceId; refreshOffset = 0; refreshOffsets = []; tab = 'refreshes'; }
        if (state.exports.some(item => item.id === result?.id)) { selectedExport = result.id; tab = 'merchant'; }
      }
      lastOperation = null;
    }
    await renderView();
  } catch (error) { message(error); }
  finally { polling = false; }
}
async function act(path, data) {
  const result = await api(path, data); lastOperation = result.operationId;
  await refresh(false);
  if (!state.active) {
    const value = state.operation?.result;
    if (state.editions.some(item => item.id === value?.id)) { selectedEdition = value.id; tab = 'editions'; }
    if (state.publications.some(item => item.id === value?.id)) { selectedPublication = value.id; tab = 'products'; }
    if ((state.refreshes ?? []).some(item => item.id === value?.id)) { selectedRefresh = value.id; refreshSource = value.sourceId; refreshOffset = 0; refreshOffsets = []; tab = 'refreshes'; }
    if (state.exports.some(item => item.id === value?.id)) { selectedExport = value.id; tab = 'merchant'; }
    await renderView();
  }
}
function form(handler, ...children) {
  const node = element('form', { onsubmit: event => { event.preventDefault(); protect(() => handler(new FormData(node), node)); } }, ...children);
  return node;
}
const submit = text => element('button', { type: 'submit', class: 'primary' }, text);
const parse = (data, name, fallback) => data.get(name)?.trim() ? JSON.parse(data.get(name)) : fallback;
const list = value => String(value ?? '').split(',').map(value => value.trim()).filter(Boolean);
function download(path, filename) {
  return protect(async () => {
    const response = await fetch('/api/' + path, { headers: { authorization: 'Bearer ' + token } });
    if (!response.ok) { const error = await response.json(); throw new Error(error.message); }
    const url = URL.createObjectURL(await response.blob()), link = element('a', { href: url, download: filename });
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
}
async function renderView() {
  const generation = ++renderGeneration;
  for (const item of document.querySelectorAll('nav button')) item.classList.toggle('selected', item.dataset.tab === tab);
  view.replaceChildren();
  if (tab === 'catalog') renderCatalogue();
  if (tab === 'editions') await renderEditions(generation);
  if (tab === 'products') await renderProducts(generation);
  if (tab === 'refreshes') await renderRefreshes(generation);
  if (tab === 'merchant') renderMerchant();
  if (tab === 'workspace') await renderWorkspace(generation);
}
function renderCatalogue() {
  const search = async (query, start = 0) => {
    const generation = ++searchGeneration;
    const result = await api('search?' + new URLSearchParams({ q: query, start, rows: 20 }));
    if (generation !== searchGeneration) return;
    catalogue = result;
    searchQuery = query; await renderView();
  };
  view.append(heading('Find a catalogue resource'), card(form(data => search(data.get('q')),
    row(label('Dataset search', input('q', searchQuery, 'search', { placeholder: 'Title, organization, topic…' }), true), submit('Search catalogue'))),
    muted('Open a dataset to choose its active DataStore resource. Each capture retains the original responses and resource metadata.')));
  if (!catalogue) return;
  view.append(element('div', { class: 'meta' }, catalogue.page.total + ' datasets · showing ' + (catalogue.page.start + 1) + '–' + (catalogue.page.start + catalogue.page.returned)));
  for (const dataset of catalogue.datasets) {
    const resources = element('div');
    for (const resource of dataset.resources.filter(item => item.datastoreActive)) {
      resources.append(element('div', { class: 'resource' },
        row(element('div', { class: 'grow' }, element('h3', {}, resource.name), element('div', { class: 'muted mono' }, resource.id)), pill(resource.format ?? 'DataStore')),
        captureForm(dataset, resource)));
    }
    view.append(card(element('h3', {}, dataset.title), element('div', { class: 'meta' }, dataset.organization ?? '', 'Modified ' + (dataset.modified ?? 'unspecified')),
      muted(dataset.notes.slice(0, 420)), muted('License: ' + (dataset.license.title ?? dataset.license.id ?? 'unspecified')),
      dataset.resources.some(item => item.datastoreActive) ? resources : muted('This dataset does not advertise an active DataStore resource.'),
      detail('All catalogue resources', dataset.resources)));
  }
  view.append(element('div', { class: 'actions' },
    catalogue.page.start > 0 ? button('Previous datasets', () => search(searchQuery, Math.max(0, catalogue.page.start - catalogue.page.rows))) : null,
    catalogue.page.next !== null ? button('More datasets', () => search(searchQuery, catalogue.page.next)) : null));
}
function captureForm(dataset, resource) {
  return element('details', {}, element('summary', {}, 'Capture this resource'),
    form(data => act('capture', { packageId: dataset.id, resourceId: resource.id,
      pageSize: Number(data.get('pageSize')), maxRows: Number(data.get('maxRows')),
      pagination: data.get('pagination'), filters: parse(data, 'filters', {}), q: data.get('q') ?? '',
      ...(data.get('schemaUrl')?.trim() ? { schemaUrl: data.get('schemaUrl').trim() } : {}) }),
      row(label('Rows per request', input('pageSize', '1000', 'number', { min: '1', max: '32000' })),
        label('Edition row capacity', input('maxRows', '250000', 'number', { min: '1', max: '5000000' })),
        label('Pagination', choose('pagination', [['offset', 'Offset'], ['keyset', 'Keyset (CKAN 2.12)']], 'offset')),
        label('Source query', input('q', ''), true)),
      label('Source filters (JSON)', element('textarea', { name: 'filters', rows: '2' }, '{}')),
      label('CSVW schema URL (optional)', input('schemaUrl', '', 'url', { placeholder: state.catalogOrigin + '/dataset/…/resource/…/schema' }), true),
      element('div', { class: 'actions' }, submit('Capture edition'))));
}
async function renderEditions(generation) {
  view.append(heading('Retained editions'));
  if (!state.editions.length) { view.append(element('div', { class: 'empty' }, 'Capture a catalogue resource, or import an existing capture with the CLI.')); return; }
  const selection = choose('edition', state.editions.map(item => [item.id, (item.packageTitle ?? item.selection?.packageId ?? 'Edition') + ' · ' + item.state + ' · ' + item.createdAt.slice(0, 19)]), selectedEdition ?? state.editions.at(-1).id);
  selectedEdition = selection.value;
  selection.addEventListener('change', () => protect(async () => { selectedEdition = selection.value; await renderView(); }));
  view.append(card(label('Edition', selection)));
  const current = await api('editions/' + selectedEdition);
  if (generation !== renderGeneration) return;
  if (current.state !== 'COMPLETE') {
    view.append(card(pill(current.state), muted(current.error ?? 'Capture pages are retained as they arrive.'),
      detail('Retained progress', current.progress), button('Resume capture', () => act('editions/' + current.id + '/resume', {}), true)));
    return;
  }
  view.append(card(row(element('h3', { class: 'grow' }, current.packageTitle), pill('Complete')),
    element('div', { class: 'meta' }, current.rowCount + ' rows', current.pageCount + ' provider pages', current.consistency),
    muted('Resource: ' + current.resourceId), muted('License: ' + (current.license?.title ?? current.license?.id ?? 'unspecified')),
    detail('Source identity and original response receipts', current.source), table(current.sample)));
  if (current.semantics?.hasDefinitions) view.append(card(element('h3', {}, 'Source field meanings'),
    muted('Definitions and code lists come from this retained provider edition. The selected aliases carry these meanings into the merchant data dictionary.'),
    muted('Source key: ' + (current.semantics.primaryKey.join(', ') || 'not declared')),
    current.semanticConsistency ? pill(current.semanticConsistency) : null,
    detail('Original schema, units and observation identity', current.semantics)));
  const editor = fieldProjectionEditor(current), selectedProjection = () => editor.value();
  const semanticPreview = element('div');
  view.append(card(element('h3', {}, 'Choose the product fields'),
    muted('Aliases define the customer query contract. Field types and nullability come from the retained rows; review the selections before saving.'),
    form(async data => {
      const projection = selectedProjection();
      tab = 'products';
      await act('editions/' + current.id + '/sources', { expectedCaptureSha256: current.manifestSha256, title: data.get('title'), projection });
    }, label('Product title', input('title', current.packageTitle, 'text', { maxlength: '128', required: '' })),
    editor.node,
    element('div', { class: 'actions' }, submit('Save field selection'),
      current.semantics?.hasDefinitions ? button('Preview field meanings', async () => {
        const semantics = await api('editions/' + current.id + '/semantics', { projection: selectedProjection() });
        semanticPreview.replaceChildren(element('h4', {}, 'Meaning of the selected fields'),
          table(semantics.columns.map(column => ({ alias: column.name, source: column.sourceField,
            property: column.projectedDefinition.propertyUrl ?? '', value: column.projectedDefinition.valueUrl ?? '' }))),
          muted('Retained observation key: ' + (semantics.primaryKey.complete ? semantics.primaryKey.projected.join(', ') : 'incomplete selection')),
          semantics.issues.length ? detail('Source-only definitions to review', semantics.issues) : muted('All selected source references carry into this schema.'),
          detail('Projected data dictionary', semantics.csvw));
      }) : null), semanticPreview)));
  const peers = state.editions.filter(item => item.state === 'COMPLETE' && item.id !== current.id && item.resourceId === current.resourceId);
  if (peers.length) {
    const output = element('div');
    view.append(card(element('h3', {}, 'Quick edition comparison'),
      muted('Use Reviewed refresh to retain and inspect the complete change file and select the next publication.'), form(async data => {
      const result = await api('compare?' + new URLSearchParams({ before: data.get('before'), after: current.id, key: data.get('key') }));
      output.replaceChildren(element('div', { class: 'stats' }, ['added', 'removed', 'changed', 'unchanged'].map(key =>
        element('div', {}, element('div', { class: 'stat' }, result[key]), element('div', { class: 'muted' }, key)))),
        detail('Changed rows (up to 100)', result.changes),
        muted(result.semanticChanges?.changed ? 'Source definitions changed in this edition.' : 'Source definitions are unchanged.'),
        detail('Field, unit, key and attribution changes', result.semanticChanges));
    }, row(label('Earlier edition', choose('before', peers.map(item => [item.id, item.completedAt])), true),
      label('Unique source key', input('key', '_id')), submit('Compare'))), output));
  }
}
async function renderProducts(generation) {
  view.append(heading('Data products'));
  if (!state.sources.length) { view.append(element('div', { class: 'empty' }, 'Select fields from a retained edition to prepare a data product.')); return; }
  for (const source of state.sources) {
    const columns = Object.keys(source.projection);
    view.append(card(element('h3', {}, source.title), element('div', { class: 'meta' }, columns.length + ' selected fields', 'Saved ' + source.createdAt.slice(0, 19)),
      detail('Reviewed field mapping', source.projection),
      source.semanticReview ? detail('Reviewed source meaning', { ...source.semanticReview, issues: source.semanticIssues }) : null,
      source.semanticReview ? button('Download data dictionary', () => download('sources/' + source.id + '/semantics', 'ckan-semantics.json')) : null,
      button('Review a following edition', async () => { refreshSource = source.id; tab = 'refreshes'; await renderView(); }),
      source.refreshId ? button('Read accepted refresh', async () => { selectedRefresh = source.refreshId; refreshSource = source.previousSourceId; refreshOffset = 0; refreshOffsets = []; tab = 'refreshes'; await renderView(); }) : null,
      source.withdrawal ? element('div', {}, muted('This source was withdrawn from future publication.'), detail('Operator withdrawal', source.withdrawal),
        button('Download source selection', () => download('sources/' + source.id + '/download', 'ckan-source.json'))) :
      form(data => act('sources/' + source.id + '/publications', { filters: list(data.get('filters')), sorts: list(data.get('sorts')),
        ranges: list(data.get('ranges')), order: [{ column: data.get('order'), direction: 'asc' }],
        defaultLimit: Number(data.get('defaultLimit')), maxLimit: Number(data.get('maxLimit')) }),
        row(label('Equality filters (aliases)', input('filters', ''), true), label('Sortable fields', input('sorts', ''), true)),
        row(label('Range fields', input('ranges', ''), true), label('Edition order', choose('order', columns)),
          label('Default page', input('defaultLimit', '50', 'number', { min: '1' })), label('Maximum page', input('maxLimit', '250', 'number', { min: '1' }))),
        element('div', { class: 'actions' }, submit('Prepare dataset'), button('Download source selection', () => download('sources/' + source.id + '/download', 'ckan-source.json'))))));
  }
  if (!state.publications.length) return;
  const selection = choose('publication', state.publications.map(item => [item.id, item.title + ' · ' + item.state]), selectedPublication ?? state.publications.at(-1).id);
  selectedPublication = selection.value;
  selection.addEventListener('change', () => protect(async () => { selectedPublication = selection.value; await renderView(); }));
  view.append(card(label('Prepared edition', selection)));
  const publication = await api('publications/' + selectedPublication), run = publication.run;
  if (generation !== renderGeneration) return;
  const candidate = run.data?.candidate, preview = publication.detail?.preview, previewSlot = element('div');
  const showPreview = result => {
    previewSlot.replaceChildren(element('div', { class: 'meta' }, 'Matched ' + (result.page?.total ?? result.total ?? result.rowCount ?? result.count ?? '—'),
      'Snapshot ' + (result.snapshot ?? candidate?.dataset?.snapshot ?? '')), table(result.rows ?? result.data ?? []), detail('Page response', result));
  };
  if (preview) showPreview(preview);
  view.append(card(row(element('h3', { class: 'grow' }, publication.title), pill(run.state)),
    form(async data => { const current = await api('publications/' + publication.id + '?' + new URLSearchParams({ query: data.get('query') })); showPreview(current.detail.preview); },
      row(label('Customer query', input('query', '', 'text', { placeholder: 'where_physical_branch=1&sort=branch&limit=50' }), true), submit('Preview query'))),
    previewSlot, publication.refreshId ? detail('Reviewed refresh and previous version', {
      refreshId: publication.refreshId, decisionSha256: publication.refreshDecisionSha256,
      previousSourceId: publication.previousSourceId, previousPublicationId: publication.previousPublicationId }) : null,
    detail('Candidate and publication history', run)));
  if (candidate && ['READY', 'REVIEWED'].includes(run.state)) {
    view.append(card(element('h3', {}, 'Review this edition'), form(data => act('publications/' + publication.id + '/review',
      { expectedCandidateDigest: candidate.candidateDigest, reviewer: data.get('reviewer'), note: data.get('note') }),
      row(label('Reviewer', input('reviewer', '', 'text', { required: '', maxlength: '128' }), true)),
      label('Review note', element('textarea', { name: 'note', required: '', rows: '2', placeholder: 'Describe the selected source, field mapping, query policy and intended use.' })),
      element('div', { class: 'actions' }, submit('Record edition review')))));
  }
  if (run.state === 'REVIEWED') view.append(card(element('h3', {}, 'Publish the reviewed dataset'),
    muted('Review ' + run.data.review.id + ' · ' + run.data.review.reviewer),
    button('Publish dataset version', () => act('publications/' + publication.id + '/publish', { reviewId: run.data.review.id }), true)));
  if (['PUBLICATION_UNKNOWN', 'INTERRUPTED'].includes(run.state))
    view.append(card(button('Recover retained publication', () => act('publications/' + publication.id + '/recover', {}), true)));
  if (candidate && ['REVIEWED', 'PUBLISHED'].includes(run.state)) {
    view.append(card(element('h3', {}, 'Create the merchant package'),
      muted('Enter the public payment terms and public resource address for this merchant. The package includes the complete retained edition and its original runtime.'),
      form(data => act('publications/' + publication.id + '/exports', {
        expectedCandidateDigest: candidate.candidateDigest, origin: data.get('origin'), path: data.get('path'),
        payment: { scheme: data.get('scheme'), network: data.get('network'), asset: data.get('asset'),
          amount: data.get('amount'), payTo: data.get('payTo'), maxTimeoutSeconds: Number(data.get('timeout')) } }),
        row(label('Public merchant origin', input('origin', '', 'url', { required: '', placeholder: 'https://data.yourcompany.com' }), true),
          label('Resource path', input('path', '/data', 'text', { required: '' }))),
        row(label('Scheme', input('scheme', 'exact', 'text', { required: '' })), label('Network', input('network', '', 'text', { required: '' }), true),
          label('Asset', input('asset', '', 'text', { required: '' }), true)),
        row(label('Amount (base units)', input('amount', '', 'text', { required: '' })), label('Merchant pay-to address', input('payTo', '', 'text', { required: '' }), true),
          label('Timeout seconds', input('timeout', '300', 'number', { min: '1', required: '' }))),
        element('div', { class: 'actions' }, submit('Export merchant package')))));
  }
}
function renderMerchant() {
  view.append(heading('Merchant releases & buyer requests'));
  if (!state.exports.length) { view.append(element('div', { class: 'empty' }, 'Export a reviewed data product to create its merchant package.')); return; }
  const selection = choose('export', state.exports.map(item => [item.id, item.resource + ' · ' + item.createdAt.slice(0, 19)]), selectedExport ?? state.exports.at(-1).id);
  selectedExport = selection.value;
  selection.addEventListener('change', () => protect(async () => { selectedExport = selection.value; await renderView(); }));
  const current = state.exports.find(item => item.id === selectedExport);
  view.append(card(label('Merchant edition', selection), muted(current.directory), detail('Package details', current),
    button('Download complete package', () => download('exports/' + current.id + '/download', 'ckan-merchant.tar.gz'))));
  view.append(card(element('h3', {}, 'Stage in the seller release store'), form(data => act('exports/' + current.id + '/stage', {
    expectedManifestSha256: current.manifestSha256, releaseId: data.get('releaseId'), label: data.get('label'), runtime: { port: Number(data.get('port')) } }),
    row(label('Release ID', input('releaseId', 'ckan-' + new Date().toISOString().slice(0, 10).replaceAll('-', ''), 'text', { required: '' }), true),
      label('Label', input('label', 'CKAN dataset edition'), true), label('Seller port', input('port', '8423', 'number', { min: '0', max: '65535' }))),
    element('div', { class: 'actions' }, submit('Stage retained package'))),
    current.staged ? element('div', { class: 'spacer' }, muted('Staged in ' + current.staged.root),
      muted('Open the original seller console to compare, activate and run this edition.'),
      pre('node sf82-seller-pilot/release-cli.mjs console --store ' + current.staged.root + ' --port 8425')) : null));
  const offered = element('div');
  view.append(card(element('h3', {}, 'Read the running seller offer'), form(async data => {
    const request = { seller: data.get('seller'), query: data.get('query') }, offer = await api('exports/' + current.id + '/offer', request);
    offered.replaceChildren(detail('Current offer and dataset selection', offer),
      form(buyer => act('exports/' + current.id + '/buyer', { ...request, offerSha256: offer.offerSha256,
        intentId: buyer.get('intentId'), acceptIndex: Number(buyer.get('acceptIndex')) }),
        row(label('Buyer intent ID', input('intentId', 'ckan-' + Date.now(), 'text', { required: '' }), true),
          label('Payment alternative index', input('acceptIndex', '0', 'number', { min: '0', required: '' })), submit('Prepare buyer request'))));
  }, row(label('Running seller address', input('seller', 'http://127.0.0.1:8423', 'url', { required: '' }), true),
    label('Dataset query', input('query', '', 'text', { placeholder: 'where_physical_branch=1&sort=branch&limit=50' }), true), submit('Read live offer'))), offered));
  for (const request of state.buyerRequests.filter(item => item.exportId === current.id))
    view.append(card(element('h3', {}, 'Prepared buyer request'), muted(request.out), detail('Buyer preparation', request),
      button('Download buyer configuration', () => download('buyer-requests/' + request.id + '/download', 'ckan-buyer.json'))));
}
for (const item of document.querySelectorAll('nav button'))
  item.addEventListener('click', () => protect(async () => { tab = item.dataset.tab; await renderView(); }));
protect(() => refresh());


async function renderWorkspace(generation) {
  const records = await api('workspace/archives');
  if (generation !== renderGeneration) return;
  view.append(heading('Workspace transfer'),
    muted('Save the retained editions, complete refresh comparisons, operator decisions, reviewed selections, publisher history, dataset versions, merchant packages, seller releases and buyer requests as one project.'),
    card(heading('Export this workspace'),
      table([{ editions: state.editions.length, selections: state.sources.length,
        publications: state.publications.length, reviewed_refreshes: (state.refreshes ?? []).length, merchant_packages: state.exports.length,
        buyer_requests: state.buyerRequests.length }]),
      muted('Stop the seller and finish the current project operation before exporting. Each export records the project state immediately before its own operation.'),
      button('Create complete workspace archive', () => act('workspace/archives', {}), true)));
  for (const item of records) view.append(card(
    element('h3', {}, 'Workspace saved ' + item.createdAt),
    row(pill(item.files + ' files'), pill(item.bytes.toLocaleString() + ' archive bytes')),
    label('Archive SHA-256', input('archive-sha256', item.sha256, 'text', { readonly: true, class: 'mono' })),
    button('Download workspace archive', () => download('workspace/archives/' + item.id, 'ckan-workspace-' + item.id + '.ckanw')),
    detail('Retained project', item.source)));
  view.append(card(heading('Receive a workspace'),
    muted('Choose the archive, paste its SHA-256, and name a new project directory beside this one. A repeated receive resumes the same archive and destination.'),
    form(async (data, node) => {
      const file = node.elements.archive.files[0];
      if (!file) throw new Error('Choose a .ckanw workspace archive.');
      const sha = String(data.get('sha256') ?? '').trim(), name = String(data.get('name') ?? '').trim();
      if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error('Paste the complete archive SHA-256.');
      const response = await fetch('/api/workspace/receive?' + new URLSearchParams({ name }), {
        method: 'POST', headers: { authorization: 'Bearer ' + token,
          'content-type': 'application/octet-stream', 'x-archive-sha256': sha }, body: file });
      const result = await response.json();
      if (!response.ok) throw new Error((result.error ?? response.status) + ': ' + result.message);
      lastOperation = result.operationId; await refresh();
    },
    label('Workspace archive', input('archive', '', 'file', { accept: '.ckanw', required: true })),
    label('Archive SHA-256', input('sha256', '', 'text', { required: true, pattern: '[a-f0-9]{64}', class: 'mono' })),
    label('New project directory name', input('name', 'received-ckan-project', 'text', { required: true, pattern: '[A-Za-z0-9][A-Za-z0-9._-]{0,79}' })),
    submit('Receive complete workspace'))));
  const operation = state.operation;
  if (operation?.kind === 'receive complete workspace' && operation.state === 'COMPLETE') {
    const result = operation.result;
    view.append(card(heading('Received project'),
      element('p', { class: 'mono' }, result.directory),
      muted('Open this directory in the existing CKAN Applications provider or the CKAN serve command. Its original seller selection is retained and can be started from its release store.'),
      detail('Original project and receive result', result)));
  }
}

async function renderRefreshes(generation) {
  view.append(heading('Reviewed refresh'));
  if (!state.sources.length) {
    view.append(muted('Save a field selection from a retained edition to begin its refresh.')); return;
  }
  const sources = choose('source', state.sources.map(item => [item.id, item.title + ' · ' +
    item.createdAt.slice(0, 19) + (item.withdrawal ? ' · withdrawn' : '')]), refreshSource ?? state.sources.at(-1).id);
  refreshSource = sources.value;
  sources.addEventListener('change', () => protect(async () => { refreshSource = sources.value; await renderView(); }));
  const source = state.sources.find(item => item.id === refreshSource), before = state.editions.find(item => item.id === source.editionId);
  view.append(card(label('Original source selection', sources), muted('Each accepted refresh retains its comparison, operator decision and link to the previous published version.')));
  if (before?.selection) {
    const selection = before.selection;
    view.append(card(element('h3', {}, 'Capture the following edition'),
      form(data => act('capture', { packageId: selection.packageId, resourceId: selection.resourceId,
        ...(selection.schemaUrl ? { schemaUrl: selection.schemaUrl } : {}), pagination: selection.pagination,
        pageSize: selection.pageSize, filters: parse(data, 'filters', {}), q: data.get('q'),
        maxRows: before.limits?.maxRows ?? 250000, maxBytes: before.limits?.maxBytes ?? 268435456 }),
      muted('The selected catalogue, resource and source definitions stay attached to the new complete capture.'),
      label('Provider filters', element('textarea', { name: 'filters', rows: '2' }, JSON.stringify(selection.filters ?? {}, null, 2))),
      label('Provider query or time window', input('q', selection.q ?? '', 'text', { maxlength: '2048' }), true),
      element('div', { class: 'actions' }, submit('Capture edition')))));
  }
  const editions = state.editions.filter(item => item.state === 'COMPLETE' && (item.id !== source.editionId || source.withdrawal) &&
    item.resourceId === before?.resourceId);
  if (editions.length) {
    const publications = state.publications.filter(item => item.sourceId === source.id && item.state === 'PUBLISHED');
    view.append(card(element('h3', {}, 'Retain the complete comparison'),
      form(data => {
        const after = editions.find(item => item.id === data.get('after'));
        return act('sources/' + source.id + '/refreshes', { afterEditionId: after.id,
          expectedSourceSha256: source.sha256, expectedAfterCaptureSha256: after.manifestSha256,
          keys: list(data.get('keys')), ...(data.get('previous') ? { previousPublicationId: data.get('previous') } : {}) });
      }, row(label('Edition to review', choose('after', editions.map(item => [item.id,
        item.rowCount + ' rows · ' + item.completedAt]), editions.at(-1).id), true),
      label('Unique source key fields', input('keys', '_id'))),
      label('Previous published version', choose('previous', [['', 'No previous published version'], ...publications.map(item =>
        [item.id, item.title + ' · ' + item.createdAt])], publications.at(-1)?.id ?? ''), true),
      muted('Use comma-separated original source fields for a compound key. Each key must be unique and non-null in both editions.'),
      element('div', { class: 'actions' }, submit('Prepare full refresh')))));
  } else view.append(muted('Capture or import the next complete edition of this resource, then choose it for comparison.'));
  const retained = state.refreshes ?? [];
  if (!retained.length) return;
  const choices = choose('refresh', retained.map(item => [item.id,
    (state.sources.find(source => source.id === item.sourceId)?.title ?? 'Refresh') + ' · ' + item.state + ' · ' + item.createdAt]),
    selectedRefresh ?? retained.at(-1).id);
  selectedRefresh = choices.value;
  choices.addEventListener('change', () => protect(async () => {
    selectedRefresh = choices.value; refreshOffset = 0; refreshOffsets = [];
    refreshSource = retained.find(item => item.id === selectedRefresh).sourceId; await renderView();
  }));
  view.append(card(label('Retained refresh', choices)));
  const current = await api('refreshes/' + selectedRefresh);
  if (generation !== renderGeneration) return;
  if (!current.comparisonSha256) {
    view.append(card(pill(current.state), muted(current.error ?? 'The complete comparison is retained as it progresses.'),
      button('Resume this comparison', () => act('refreshes/' + current.id + '/resume', {}), true))); return;
  }
  const comparison = current.comparison;
  const changePath = 'refreshes/' + current.id + '/changes', selectionQuery = new URLSearchParams({ sha256: current.comparisonSha256 });
  view.append(card(row(element('h3', { class: 'grow' }, 'Complete selected-edition comparison'), pill(current.state)),
    element('div', { class: 'stats' }, ['added', 'removed', 'changed', 'unchanged'].map(kind =>
      element('div', {}, element('div', { class: 'stat' }, comparison[kind]), element('div', { class: 'muted' }, kind)))),
    muted(comparison.selectionChanged
      ? 'The selected filters or query window changed. Added and removed rows describe these two selected editions.'
      : 'Both editions use the same catalogue selection. Each row is matched by the retained source key.'),
    detail('Source selections and terms', { before: comparison.before, after: comparison.after,
      sourceTermsChanged: comparison.sourceTermsChanged, sourceTerms: comparison.sourceTerms,
      sourceChanges: comparison.sourceChanges }),
    detail('Field definitions, units and attribution changes', comparison.semanticChanges),
    element('div', { class: 'actions' },
      button('Download all changes', () => download(changePath + '/download?' + selectionQuery, 'ckan-refresh-' + current.id + '-changes.jsonl')),
      button('Download comparison and decision', () => download('refreshes/' + current.id, 'ckan-reviewed-refresh-' + current.id + '.json')))));
  const changes = element('div');
  view.append(card(element('h3', {}, 'Inspect every change'), changes));
  const loadChanges = async offset => {
    const page = await api(changePath + '?' + new URLSearchParams({ sha256: current.comparisonSha256, offset, limit: 50 }));
    if (generation !== renderGeneration || selectedRefresh !== current.id) return;
    refreshOffset = page.offset;
    const rows = page.changes.map(change => {
      const fields = [...new Set([...Object.keys(change.before ?? {}), ...Object.keys(change.after ?? {})])];
      return element('details', {}, element('summary', {}, change.kind + ' · ' + JSON.stringify(change.key ?? change.keys)),
        table(fields.map(field => ({ field,
          before: Object.hasOwn(change.before ?? {}, field) ? change.before[field] : '(absent)',
          after: Object.hasOwn(change.after ?? {}, field) ? change.after[field] : '(absent)' }))));
    });
    changes.replaceChildren(muted('Changes ' + (page.total ? page.offset + 1 : 0) + '–' +
      (page.offset + page.changes.length) + ' of ' + page.total), ...rows,
      element('div', { class: 'actions' },
        refreshOffsets.length ? button('Previous changes', () => loadChanges(refreshOffsets.pop())) : null,
        page.nextOffset !== null ? button('Next changes', () => { refreshOffsets.push(page.offset); return loadChanges(page.nextOffset); }) : null));
  };
  try { await loadChanges(refreshOffset); }
  catch (error) { changes.replaceChildren(muted(error.message), muted('The complete change file remains available through Download all changes.')); }
  if (generation !== renderGeneration) return;
  if (current.decisionPending) {
    view.append(card(detail('Saved operator decision', current.review),
      button('Finish the saved decision', () => act('refreshes/' + current.id + '/resume', {}), true))); return;
  }
  if (current.review) {
    view.append(card(element('h3', {}, 'Recorded operator decision'), detail('Decision and selected field contract', current.review),
      current.acceptedSourceId ? button('Prepare the accepted data product', async () => { tab = 'products'; await renderView(); }, true) : null,
      current.previousPublicationId ? button('Open the previous published version', async () => {
        selectedPublication = current.previousPublicationId; tab = 'products'; await renderView();
      }) : null,
      button('Start a new review of these editions', () => act('sources/' + current.sourceId + '/refreshes', {
        afterEditionId: current.afterEditionId, expectedSourceSha256: current.sourceSha256,
        expectedAfterCaptureSha256: current.afterCaptureSha256, keys: current.keys, supersedesRefreshId: current.id,
        ...(current.previousPublicationId ? { previousPublicationId: current.previousPublicationId } : {}),
      }))));
    return;
  }
  const after = await api('editions/' + current.afterEditionId);
  if (generation !== renderGeneration) return;
  const original = state.sources.find(item => item.id === current.sourceId);
  const editor = fieldProjectionEditor(after, current.selection?.projection ?? original.projection);
  const title = input('title', current.selection?.title ?? original.title, 'text', { maxlength: '128' });
  const query = input('query', current.selection?.query ?? original.query, 'text', { maxlength: '48' });
  const selection = () => ({ title: title.value, query: query.value, projection: editor.value() });
  let preview = current.selection, previewKey = preview ? JSON.stringify(selection()) : null;
  const semanticPreview = element('div');
  const showPreview = value => {
    semanticPreview.replaceChildren(muted(value.validatedRows + ' retained rows fit the selected field contract.'),
      value.semantics ? table(value.semantics.columns.map(column => ({ alias: column.name, source: column.sourceField,
        type: column.type, property: column.projectedDefinition.propertyUrl ?? '', value: column.projectedDefinition.valueUrl ?? '' }))) :
        muted('This source has no declared field dictionary.'),
      value.semantics ? detail('Full projected data dictionary and source definitions', value.semantics) : null);
  };
  if (preview) showPreview(preview);
  else semanticPreview.append(muted(current.selectionError?.message ?? 'Preview the selected field contract before acceptance.'));
  const invalidate = () => { preview = null; previewKey = null; semanticPreview.replaceChildren(muted('Preview the changed selection before acceptance.')); };
  editor.node.addEventListener('input', invalidate); editor.node.addEventListener('change', invalidate);
  title.addEventListener('input', invalidate); query.addEventListener('input', invalidate);
  view.append(card(element('h3', {}, 'Review the source, terms and successor fields'),
    form(async data => {
      const decision = data.get('decision');
      const input = { expectedComparisonSha256: current.comparisonSha256, decision,
        reviewer: data.get('reviewer'), note: data.get('note') };
      if (decision === 'accept') {
        const choice = selection();
        if (!preview || previewKey !== JSON.stringify(choice)) throw new Error('Preview the selected fields and their complete meanings before accepting.');
        Object.assign(input, choice, { expectedProjectionSha256: preview.projectionSha256,
          expectedSemanticsSha256: preview.semanticReview?.sha256 ?? null,
          expectedDefinitionSha256: preview.semanticReview?.definitionSha256 ?? null });
      }
      await act('refreshes/' + current.id + '/review', input);
    }, row(label('Successor product title', title, true), label('Query name', query)),
    editor.node,
    element('div', { class: 'actions' }, button('Preview selected refresh', async () => {
      const choice = selection(), key = JSON.stringify(choice);
      const result = await api('refreshes/' + current.id + '/preview', { expectedComparisonSha256: current.comparisonSha256, ...choice });
      if (key !== JSON.stringify(selection())) throw new Error('The field selection changed during preview. Preview it again.');
      preview = result; previewKey = key; showPreview(result);
    })), semanticPreview,
    row(label('Decision', choose('decision', [['accept', 'Accept this refresh'], ['keep-current', 'Keep the current source'],
      ['withdraw-source', 'Withdraw this source from future publication']], 'accept'), true),
    label('Operator', input('reviewer', '', 'text', { maxlength: '128', required: '' }), true)),
    label('Source, terms and change review', element('textarea', { name: 'note', rows: '3', maxlength: '2048', required: '' })),
    muted('Acceptance creates the reviewed successor selection. Prepare, inspect and publish it through the existing data-product workflow.'),
    element('div', { class: 'actions' }, submit('Record refresh decision')))));
}
