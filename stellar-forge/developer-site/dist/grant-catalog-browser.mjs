// SPDX-License-Identifier: MIT
import { GRANT_CATALOG_SOURCE } from './grant-catalog.mjs';
import { openCatalogReviewPage } from './stellar/scf-starforge-20261009/sf61-bazaar-explorer/catalog-review.mjs';

const root = document.getElementById('review-catalog');
if (root) startCatalogReader(root);

function startCatalogReader(root) {
  const find = id => { const node = root.querySelector('#' + id); if (!node) throw new Error('Missing catalog control: ' + id); return node; };
  const controls = Object.fromEntries(['load', 'load-cancel', 'source-status', 'source-facts', 'desk', 'search', 'search-fields',
    'search-status', 'results', 'previous', 'page', 'next', 'selection', 'reset'].map(name => [name, find('grant-catalog-' + name)]));
  const state = { page: null, result: null, applied: null, load: null, loadSerial: 0, view: 0, selection: 0, closed: false };
  const urls = new Set();
  const text = (tag, value, className) => {
    const node = document.createElement(tag); node.textContent = String(value ?? '');
    if (className) node.className = className; return node;
  };
  const button = (label, listener) => {
    const node = text('button', label, 'button'); node.type = 'button'; node.addEventListener('click', listener); return node;
  };
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const display = value => value === null || value === undefined ? 'Not reported' :
    typeof value === 'string' ? value : JSON.stringify(value);
  const errorText = error => [error?.code, error?.message].filter(Boolean).join(': ') || 'The operation could not be completed.';
  const jsonBlock = value => text('pre', JSON.stringify(value, null, 2), 'grant-catalog-json');
  function facts(pairs) {
    const list = document.createElement('dl'); list.className = 'grant-entry-facts';
    for (const [label, value] of pairs) {
      const row = document.createElement('div'); row.append(text('dt', label), text('dd', display(value))); list.append(row);
    }
    return list;
  }
  function download(value, filename, type) {
    if (state.closed) return;
    const url = URL.createObjectURL(new Blob([value], { type })); urls.add(url);
    const link = document.createElement('a'); link.href = url; link.download = filename; link.hidden = true;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 60000);
  }
  function originalUrl(listing) {
    return typeof listing?.resource === 'string' ? listing.resource :
      typeof listing?.resource?.url === 'string' ? listing.resource.url : 'Resource URL not reported';
  }
  function operation(listing) {
    const input = listing?.extensions?.bazaar?.info?.input;
    return input?.type === 'mcp' ? 'MCP ' + (input.toolName ?? 'tool') :
      'HTTP ' + (input?.method ?? 'method not reported');
  }
  function title(listing) {
    const name = listing?.resource?.serviceName ?? listing?.serviceName;
    return typeof name === 'string' && name.trim() ? name : operation(listing);
  }
  function appliedDescription(request) {
    const values = Object.entries(request.filters).map(([key, value]) => key + '=' + value);
    return (request.query ? 'Query “' + request.query + '”' : 'Original source order') +
      (values.length ? '; ' + values.join('; ') : '; all payment alternatives');
  }
  function resetSelection() {
    state.selection++;
    controls.selection.replaceChildren(text('h4', 'Inspect and save a resource'),
      text('p', 'Choose Inspect on a result to read its full original declaration and payment alternatives.'));
  }
  function populateFilters() {
    const values = Object.fromEntries(['type', 'network', 'asset', 'payTo', 'scheme', 'extensions'].map(key => [key, new Set()]));
    const all = state.page.search({ query: '', filters: {}, pageSize: 200 });
    for (const row of all.offers) {
      const listing = row.listing, type = listing.extensions?.bazaar?.info?.input?.type;
      if (['http', 'mcp'].includes(type)) values.type.add(type);
      for (const key of Object.keys(listing.extensions ?? {})) values.extensions.add(key);
      for (const option of listing.accepts ?? []) if (plain(option)) for (const key of ['network', 'asset', 'payTo', 'scheme'])
        if (typeof option[key] === 'string' && option[key]) values[key].add(option[key]);
    }
    for (const [key, items] of Object.entries(values)) {
      const select = controls.search.elements.namedItem(key);
      select.replaceChildren(new Option('All ' + ({ type: 'types', network: 'networks', asset: 'assets',
        payTo: 'recipients', scheme: 'schemes', extensions: 'extensions' })[key], ''));
      for (const value of [...items].sort()) select.add(new Option(value, value));
    }
  }
  function searchInput() {
    const data = new FormData(controls.search), filters = {};
    for (const key of ['type', 'payTo', 'network', 'scheme', 'asset', 'extensions']) {
      const value = String(data.get(key) ?? ''); if (value) filters[key] = value;
    }
    return { query: String(data.get('query') ?? ''), filters, page: 0, pageSize: Number(data.get('pageSize')) };
  }
  function renderSearch(input) {
    if (!state.page || state.closed) return;
    let result;
    try { result = state.page.search(input); }
    catch (error) { controls['search-status'].textContent = errorText(error) + ' The last applied results remain below.'; return; }
    state.view++; state.result = result;
    state.applied = { query: result.request.query, filters: structuredClone(result.request.filters),
      page: result.request.page, pageSize: result.request.pageSize };
    resetSelection();
    const view = state.view, fragment = document.createDocumentFragment();
    for (const offer of result.offers) {
      const item = document.createElement('li');
      item.append(text('h4', title(offer.listing)), text('p', originalUrl(offer.listing), 'grant-catalog-url'));
      const description = offer.listing?.resource?.description ?? offer.listing?.description;
      if (typeof description === 'string' && description) item.append(text('p', description));
      item.append(text('p', operation(offer.listing) + ' · source row ' + offer.row +
        (offer.rank === null ? '' : ' · rank ' + offer.rank) + ' · ' +
        offer.matchingAcceptIndexes.length + ' matching payment alternative(s)', 'grant-entry-help'));
      if (!offer.searchable) item.append(text('p', 'This source row has no searchable catalog identity. Its original declaration remains available.', 'grant-entry-help'));
      item.append(button('Inspect', () => { if (view === state.view) inspectOffer(offer, state.applied, view); }));
      fragment.append(item);
    }
    controls.results.replaceChildren(fragment);
    controls.results.start = result.request.page * result.request.pageSize + 1;
    if (!result.offers.length) controls.results.append(text('li', 'No retained resources match the applied query and filters.'));
    const first = result.offers.length ? result.request.page * result.request.pageSize + 1 : 0;
    const last = result.request.page * result.request.pageSize + result.offers.length;
    controls['search-status'].textContent = appliedDescription(result.request) + '. ' +
      result.total + ' result(s) from ' + result.coverage.receivedRows + ' retained rows.';
    controls.page.textContent = first + '–' + (result.offers.length ? last : 0) + ' of ' + result.total;
    controls.previous.disabled = result.request.page === 0;
    controls.next.disabled = result.nextPage === null;
  }
  function inspectOffer(offer, applied, view) {
    const serial = ++state.selection, search = structuredClone(applied), listing = structuredClone(offer.listing);
    const panel = controls.selection; panel.replaceChildren(text('h4', title(listing)));
    panel.append(text('p', originalUrl(listing), 'grant-catalog-url'), facts([
      ['Source row', offer.row], ['Rank', offer.rank], ['Search', appliedDescription(search)],
      ['Page SHA-256', offer.pageSha256], ['Original catalog key', offer.catalogKey]
    ]));
    const declaration = document.createElement('details');
    declaration.append(text('summary', 'Read the complete original declaration'), jsonBlock(listing)); panel.append(declaration);
    const form = document.createElement('form'); form.autocomplete = 'off';
    const optionLabel = text('label', 'Original payment alternative'), options = document.createElement('select');
    options.name = 'acceptIndex'; optionLabel.append(options);
    for (const index of offer.matchingAcceptIndexes) {
      const value = listing.accepts[index];
      options.add(new Option('#' + index + ' · ' + display(value.network) + ' · ' +
        display(value.amount ?? value.maxAmountRequired) + ' atomic · ' + display(value.asset), String(index)));
    }
    const terms = document.createElement('div');
    const nameLabel = text('label', 'Saved request name'), name = document.createElement('input');
    name.type = 'text'; name.required = true; name.maxLength = 240; name.name = 'label';
    name.value = (operation(listing) + ' ' + originalUrl(listing)).slice(0, 240);
    nameLabel.append(name);
    const actions = document.createElement('div'); actions.className = 'grant-entry-actions';
    const prepare = text('button', 'Prepare complete review file', 'button'); prepare.type = 'submit';
    const save = button('Download selection', () => {
      if (prepared && current() && preparedRevision === revision) {
        download(prepared.text, 'atlas-catalog-review-' + prepared.packet.packetId.slice(0, 16) + '.json', 'application/json; charset=utf-8');
        status.textContent = 'Complete review downloaded: ' + prepared.bytes + ' bytes; SHA-256 ' + prepared.sha256 +
          '. Receive this file in Atlas to open the original request.';
      }
    });
    save.disabled = true; actions.append(prepare, save);
    const status = text('p', '', 'grant-entry-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const detail = document.createElement('div');
    let revision = 0, preparedRevision = -1, prepared = null, busy = false;
    const current = () => !state.closed && serial === state.selection && view === state.view;
    function changed() {
      revision++; prepared = null; save.disabled = true; detail.replaceChildren();
      if (current()) status.textContent = busy ? 'The selection changed while its file was being prepared. Prepare the current selection again.' :
        'Prepare this original row and payment alternative before downloading.';
    }
    function showTerms() {
      terms.replaceChildren();
      const index = Number(options.value), value = listing.accepts?.[index];
      if (!offer.matchingAcceptIndexes.includes(index) || !plain(value)) {
        prepare.disabled = true; status.textContent = 'This original row has no payment alternative matching the applied filters.'; return;
      }
      terms.append(facts([['Network', value.network], ['Asset', value.asset], ['Atomic amount', value.amount ?? value.maxAmountRequired],
        ['Recipient', value.payTo], ['Scheme', value.scheme]]));
      const full = document.createElement('details'); full.append(text('summary', 'Read all selected payment terms'), jsonBlock(value)); terms.append(full);
      prepare.disabled = busy;
    }
    form.append(optionLabel, terms, nameLabel, actions, status, detail); panel.append(form);
    options.addEventListener('change', () => { changed(); showTerms(); }); name.addEventListener('input', changed);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (!current() || busy || !form.reportValidity()) return;
      const selected = { row: offer.row, acceptIndex: Number(options.value), query: search.query,
        filters: structuredClone(search.filters), label: name.value }, selectedRevision = revision;
      busy = true; prepare.disabled = true; save.disabled = true;
      status.textContent = 'Retaining and checking the complete original page and exact selection…';
      try {
        const value = await state.page.createSelection(selected);
        if (!current() || selectedRevision !== revision) return;
        prepared = value; preparedRevision = selectedRevision; save.disabled = false;
        detail.replaceChildren(facts([['Complete review bytes', value.bytes], ['Review SHA-256', value.sha256],
          ['Original source SHA-256', value.packet.source.pageSha256], ['Original row / alternative', selected.row + ' / ' + selected.acceptIndex]]));
        status.textContent = 'The complete review file is ready. Its original page and selected terms will reopen in Atlas.';
      } catch (error) { if (current() && selectedRevision === revision) status.textContent = errorText(error); }
      finally { busy = false; if (current()) showTerms(); }
    });
    changed(); showTerms(); panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function readRetainedPage(signal) {
    const url = new URL(GRANT_CATALOG_SOURCE.page, import.meta.url);
    if (url.origin !== location.origin) throw new Error('Keep the retained catalog on this application origin.');
    const response = await fetch(url, { signal, credentials: 'omit', cache: 'no-store', redirect: 'error' });
    if (!response.ok || !response.body) throw new Error('The retained catalog could not be read: HTTP ' + response.status);
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > GRANT_CATALOG_SOURCE.bytes) throw new Error('The retained source has changed size.');
        chunks.push(value);
      }
      if (size !== GRANT_CATALOG_SOURCE.bytes) throw new Error('The complete retained source is required.');
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
  }
  controls.load.addEventListener('click', async () => {
    if (state.load || state.page || state.closed) return;
    const controller = new AbortController(), serial = ++state.loadSerial; state.load = controller;
    controls.load.disabled = true; controls['load-cancel'].hidden = false;
    controls['source-status'].textContent = 'Reading and checking all original catalog bytes…';
    try {
      const pageText = await readRetainedPage(controller.signal);
      const page = await openCatalogReviewPage({ pageText, sourceUrl: GRANT_CATALOG_SOURCE.sourceUrl,
        capturedAt: GRANT_CATALOG_SOURCE.capturedAt, expectedSha256: GRANT_CATALOG_SOURCE.pageSha256 });
      if (state.closed || controller.signal.aborted || serial !== state.loadSerial) return;
      if (page.source.bytes !== GRANT_CATALOG_SOURCE.bytes || page.source.rows !== GRANT_CATALOG_SOURCE.rows ||
        page.coverage.allReportedRowsPresent !== true) throw new Error('The complete original 27-row source is required.');
      state.page = page; populateFilters(); controls.desk.hidden = false; controls['search-fields'].disabled = false;
      controls.load.textContent = 'Retained catalog loaded';
      controls['source-status'].textContent = page.source.rows + ' of ' + page.coverage.reportedTotal +
        ' reported resources received. Original source SHA-256 checked; acquisition ' + page.source.capturedAt + '.';
      controls['source-facts'].replaceChildren(...facts([['Captured', page.source.capturedAt], ['Source URL', page.source.sourceUrl],
        ['Original rows', page.source.rows], ['Reported total', page.coverage.reportedTotal], ['Complete page bytes', page.source.bytes],
        ['SHA-256', page.source.pageSha256]]).children);
      renderSearch(searchInput());
    } catch (error) {
      if (!state.closed && serial === state.loadSerial) controls['source-status'].textContent =
        controller.signal.aborted ? 'Catalog loading was cancelled. Load the complete source when ready.' : errorText(error);
    } finally {
      if (serial === state.loadSerial) { state.load = null; controls.load.disabled = !!state.page; controls['load-cancel'].hidden = true; }
    }
  });
  controls['load-cancel'].addEventListener('click', () => {
    if (state.load) { state.load.abort(); controls['source-status'].textContent = 'Catalog loading was cancelled. Load the complete source when ready.'; }
  });
  controls.search.addEventListener('submit', event => { event.preventDefault(); renderSearch(searchInput()); });
  controls.search.addEventListener('input', () => {
    if (state.applied) controls['search-status'].textContent = 'The controls have changed. Apply search to update the results. Displayed selection: ' + appliedDescription(state.applied) + '.';
  });
  controls.reset.addEventListener('click', () => { controls.search.reset(); renderSearch(searchInput()); });
  controls.previous.addEventListener('click', () => {
    if (state.applied && state.applied.page > 0) renderSearch({ ...state.applied, page: state.applied.page - 1 });
  });
  controls.next.addEventListener('click', () => {
    if (state.applied && state.result.nextPage !== null) renderSearch({ ...state.applied, page: state.result.nextPage });
  });
  addEventListener('pagehide', event => {
    if (event.persisted) return;
    state.closed = true; state.load?.abort(); state.view++; state.selection++;
    for (const url of urls) URL.revokeObjectURL(url); urls.clear();
  });
}
