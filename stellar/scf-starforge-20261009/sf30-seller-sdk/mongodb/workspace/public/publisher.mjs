// MIT. MongoDB authoring composes the original dataset publisher and schedule UI.
import { createSchedulePanel } from './publisher-schedules.mjs';

export function createMongoPublicationPanel({ api, action, notice, current, requireSaved, download, isBusy }) {
  const $ = id => document.getElementById(id), pretty = value => JSON.stringify(value, null, 2);
  const node = (tag, text, className) => {
    const element = document.createElement(tag); if (text !== undefined) element.textContent = String(text);
    if (className) element.className = className; return element;
  };
  const button = (label, call) => {
    const element = node('button', label, 'small'); element.type = 'button';
    element.addEventListener('click', () => action(call)); return element;
  };
  const state = { id: null, publication: null, plan: null, detail: null, runId: null, dirty: false,
    offer: null, buyer: null, visible: false, polling: false, timer: null, request: null,
    plansOffset: 0, runsOffset: 0 };
  const scheduleTemplate = $('pub-schedule').cloneNode(true);
  let schedule = null;
  const fieldIds = ['pub-title', 'pub-name', 'pub-input', 'pub-order', 'pub-max-rows', 'pub-max-bytes',
    'pub-row-bytes', 'pub-timeout', 'pub-cell-chars', 'pub-default-limit', 'pub-page-limit', 'pub-page-bytes'];
  const words = value => String(value ?? '').replaceAll('_', ' ').toLowerCase();
  const short = value => value ? String(value).slice(0, 12) + '…' : '—';
  const stamp = value => value ? new Date(value).toLocaleString() : '—';
  const parse = (value, label, array = false) => {
    let result; try { result = JSON.parse(value); } catch { throw new Error(label + ' must contain valid JSON'); }
    if (array ? !Array.isArray(result) : !result || typeof result !== 'object' || Array.isArray(result))
      throw new Error(label + ' must be a JSON ' + (array ? 'array' : 'object'));
    return result;
  };
  const base = () => 'publications/' + state.id;
  const call = (path = '', body) => {
    if (!state.id) throw new Error('Open or create a publication first');
    return api(base() + path, body);
  };
  const on = (id, fn) => $(id).addEventListener('click', () => action(fn));
  function options(select, values, selected) {
    select.replaceChildren(...values.map(([value, label]) => {
      const option = node('option', label); option.value = value; return option;
    }));
    if ([...select.options].some(item => item.value === String(selected))) select.value = selected;
  }
  function table(headers, rows) {
    const wrap = node('div', undefined, 'table-wrap'), table = node('table'), head = node('thead'), tr = node('tr'), body = node('tbody');
    headers.forEach(label => tr.append(node('th', label))); head.append(tr);
    for (const values of rows) {
      const row = node('tr');
      values.forEach(value => { const cell = node('td'); cell.append(value instanceof Node ? value : document.createTextNode(String(value ?? ''))); row.append(cell); });
      body.append(row);
    }
    table.append(head, body); wrap.append(table); return wrap;
  }
  function facts(target, pairs) {
    target.replaceChildren(...pairs.map(([label, value]) => {
      const cell = node('div', undefined, 'fact'); cell.append(node('strong', value), node('span', label)); return cell;
    }));
  }
  function draftKey() { return 'mongodb-publication-draft:' + current().directory + ':' + state.id; }
  function cache() {
    if (!state.id) return;
    if (!state.dirty) { sessionStorage.removeItem(draftKey()); return; }
    sessionStorage.setItem(draftKey(), pretty({ planId: state.plan?.id ?? null,
      sourceHash: state.publication.source.hash,
      fields: Object.fromEntries(fieldIds.map(id => [id, $(id).value])), columns: columnValues() }));
  }
  function dirty() { state.dirty = true; state.request = null; cache(); update(); }
  function checkbox(label, checked, disabled = false) {
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked;
    input.disabled = disabled; input.setAttribute('aria-label', label); return input;
  }
  function renderColumns(dataset) {
    const query = state.publication.source.queries[state.publication.query];
    const rows = query.columns.map(name => {
      const valid = /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(name) && !['constructor', 'prototype', '__proto__'].includes(name);
      const spec = dataset?.columns?.[name], row = node('div', undefined, 'publication-column');
      row.dataset.column = name;
      const enabled = checkbox('Publish ' + name, Boolean(spec) || !dataset && valid, !valid); enabled.dataset.role = 'exposed';
      const type = document.createElement('select'); type.setAttribute('aria-label', name + ' dataset type'); type.dataset.role = 'type';
      options(type, ['string', 'integer', 'number', 'boolean'].map(value => [value, value]), spec?.type ?? 'string');
      row.append(enabled, node('code', name), type);
      for (const [role, title] of [['nullable', 'Nullable'], ['filters', 'Equality filter'], ['ranges', 'Range filter'], ['sorts', 'Sort']]) {
        const input = checkbox(title + ' ' + name, role === 'nullable' ? Boolean(spec?.nullable) : Boolean(dataset?.[role]?.includes(name)));
        input.dataset.role = role; row.append(input);
      }
      row.addEventListener('change', dirty);
      if (!valid) row.title = 'Give this field an explicit dataset-compatible alias in the named MongoDB report';
      return row;
    });
    const heading = node('div', undefined, 'publication-column publication-column-heading');
    ['Use', 'Column', 'Type', 'Null', 'Equal', 'Range', 'Sort'].forEach(label => heading.append(node('span', label)));
    $('pub-columns').replaceChildren(heading, ...rows);
  }
  function columnValues() {
    return [...$('pub-columns').querySelectorAll('[data-column]')].map(row => ({
      name: row.dataset.column, exposed: row.querySelector('[data-role=exposed]').checked,
      type: row.querySelector('[data-role=type]').value,
      ...Object.fromEntries(['nullable', 'filters', 'ranges', 'sorts'].map(role => [role, row.querySelector('[data-role=' + role + ']').checked])) }));
  }
  function fillPlan(saved = null) {
    state.plan = saved; state.dirty = false; state.request = null;
    const p = state.publication, query = p.source.queries[p.query], value = saved?.data;
    const values = { 'pub-title': value?.title ?? p.query + ' dataset', 'pub-name': value?.dataset.name ?? p.query,
      'pub-input': pretty(value?.input ?? p.example),
      'pub-order': pretty(value?.extraction.order ?? [{ column: query.columns.includes('_id') ? '_id' : query.columns[0], direction: 'asc' }]),
      'pub-max-rows': value?.extraction.maxRows ?? 250000, 'pub-max-bytes': value?.extraction.maxBytes ?? 67108864,
      'pub-row-bytes': value?.extraction.maxRowBytes ?? 1048576, 'pub-timeout': value?.extraction.timeoutMs ?? 30000,
      'pub-cell-chars': value?.dataset.maxCellChars ?? 65536, 'pub-default-limit': value?.dataset.defaultLimit ?? 50,
      'pub-page-limit': value?.dataset.maxLimit ?? 250, 'pub-page-bytes': value?.dataset.maxPageBytes ?? 921600 };
    for (const [id, value] of Object.entries(values)) $(id).value = value;
    renderColumns(value?.dataset); renderPlans(); update();
  }
  function planInput() {
    const fields = columnValues().filter(item => item.exposed);
    return { title: $('pub-title').value, query: state.publication.query,
      input: parse($('pub-input').value, 'Report inputs'), sourceHash: state.publication.source.hash,
      dataset: { name: $('pub-name').value,
        columns: Object.fromEntries(fields.map(item => [item.name, { type: item.type, nullable: item.nullable }])),
        ...Object.fromEntries(['filters', 'ranges', 'sorts'].map(key => [key, fields.filter(item => item[key]).map(item => item.name)])),
        maxCellChars: Number($('pub-cell-chars').value), defaultLimit: Number($('pub-default-limit').value),
        maxLimit: Number($('pub-page-limit').value), maxPageBytes: Number($('pub-page-bytes').value) },
      extraction: { maxRows: Number($('pub-max-rows').value), maxBytes: Number($('pub-max-bytes').value),
        maxRowBytes: Number($('pub-row-bytes').value), timeoutMs: Number($('pub-timeout').value),
        order: parse($('pub-order').value, 'Source ordering', true) } };
  }
  function pages(target, page, name) {
    target.replaceChildren();
    if (!page) return;
    target.append(node('span', page.total + ' retained records', 'help'));
    for (const [key, label] of [['previous', 'Newer'], ['next', 'Older']]) {
      const item = button(label, async () => { state[name + 'Offset'] = page[key]; await refresh(); });
      item.disabled = page[key] === null; target.append(item);
    }
  }
  function renderPlans() {
    const values = state.publication?.snapshot.plans ?? [];
    const selected = state.plan;
    const list = selected && !values.some(item => item.id === selected.id) ? [selected, ...values] : values;
    options($('pub-plan-select'), [['', 'New unsaved plan'], ...list.map(item => [item.id, 'Plan ' + item.id + ' · ' + item.data.title])], selected?.id ?? '');
    pages($('pub-plan-pages'), state.publication?.snapshot.pages.plans, 'plans');
  }
  function renderRuns() {
    const p = state.publication;
    $('pub-runs').replaceChildren(table(['Started', 'Plan', 'Status', 'Rows', 'Open'], p.snapshot.runs.map(item => [
      stamp(item.created), item.plan, words(item.state), item.data.candidate?.dataset.rowCount ?? '—',
      button(item.id === state.runId ? 'Selected' : 'Open', () => openRun(item.id)) ])));
    pages($('pub-run-pages'), p.snapshot.pages.runs, 'runs');
    const active = p.snapshot.active;
    $('pub-active').textContent = active ? words(active.kind) + ' · ' + short(active.id) +
      (active.progress ? ' · ' + active.progress.rows.toLocaleString() + ' rows · ' + active.progress.bytes.toLocaleString() + ' CSV bytes' : '') :
      'Every completed extraction remains available with its saved plan and source read.';
  }
  function invalidateBuyer() {
    state.offer = null; state.buyer = null; $('pub-offer').replaceChildren(); $('pub-buyer-result').replaceChildren();
    $('pub-download-buyer').hidden = true; options($('pub-buyer-choice'), [], '');
  }
  function renderRun() {
    const detail = state.detail; $('pub-run-detail').hidden = !detail;
    if (!detail) return;
    const { run, preview } = detail, candidate = run.data.candidate;
    facts($('pub-run-facts'), [['Extraction', short(run.id)], ['Status', words(run.state)],
      ['Rows', candidate?.dataset.rowCount ?? '—'], ['Snapshot', short(candidate?.dataset.snapshot)]]);
    $('pub-run-record').textContent = pretty(run);
    const result = $('pub-preview-result'); result.replaceChildren();
    if (preview) {
      result.append(node('p', preview.page.returned + ' of ' + preview.page.total + ' matching rows', 'help'));
      result.append(table(preview.fields, preview.rows.map(row => preview.fields.map(field =>
        node('span', row[field] === null ? 'null' : String(row[field]), 'row-value')))));
      if (preview.page.nextCursor) result.append(button('Next candidate page', async () => {
        const query = new URLSearchParams($('pub-preview-query').value || 'limit=20');
        query.set('cursor', preview.page.nextCursor); $('pub-preview-query').value = query.toString();
        await inspectRun();
      }));
    } else result.append(node('p', run.data.error ? words(run.data.error) : 'The complete candidate will appear when the native extraction finishes.', 'help'));
    const target = state.publication.target;
    $('pub-review-target').textContent = target.initializable ?
      'This review initializes the publication’s new dataset store.' : target.connected ?
        'This review binds to target revision ' + target.versions.revision + ' · snapshot ' + short(target.versions.current) :
        'Start the dataset seller to inspect the existing target before a refresh.';
  }
  function renderSeller() {
    const p = state.publication, seller = p.seller, target = p.target;
    $('pub-seller-status').textContent = seller ? seller.origin + ' · ' + seller.mode :
      p.startError ?? (target.initializable ? 'Publish the first reviewed candidate, then start its seller.' :
        'Start the seller to inspect retained versions and run refreshes.');
    $('pub-docs').hidden = !seller; if (seller) $('pub-docs').href = seller.docs;
    $('pub-terms').textContent = pretty({ savedSourceRevision: p.revision, resource: p.publicOrigin + p.path, ...p.terms });
    $('pub-versions').replaceChildren(target.versions ? table(['Snapshot', 'Rows', 'Status', 'Retained until', 'Select current'], target.versions.versions.map(version => [
      node('code', short(version.snapshot)), version.rowCount, words(version.status),
      version.expiresAt === null ? 'Current' : stamp(version.expiresAt),
      version.status === 'CURRENT' ? 'Current version' : button('Activate', async () => {
        await call('/activate', { snapshot: version.snapshot, expectedSnapshot: target.versions.current,
          expectedRevision: target.versions.revision }); await refresh(); notice('Activated the selected retained version through the original dataset store.');
      }) ])) : node('p', 'The target version store appears here after the dataset seller starts.', 'help'));
  }
  function update() {
    const p = state.publication, detail = state.detail, busy = isBusy();
    const working = Boolean(p?.snapshot.active || p?.schedule.active);
    const candidate = Boolean(detail?.run.data.candidate), reviewed = detail?.run.state === 'REVIEWED';
    $('pub-plan-status').textContent = state.dirty ? 'Unsaved extraction plan' : state.plan ? 'Saved plan ' + state.plan.id : 'New plan';
    for (const id of ['pub-save-plan', 'pub-new-plan', 'pub-plan-select']) $(id).disabled = busy || !p || working;
    $('pub-extract').disabled = busy || working || !state.plan || state.dirty;
    $('pub-cancel').hidden = p?.snapshot.active?.kind !== 'extraction'; $('pub-cancel').disabled = busy;
    for (const id of ['pub-preview', 'pub-csv', 'pub-config', 'pub-manifest']) $(id).disabled = busy || !candidate;
    $('pub-review').disabled = busy || working || !candidate || !['READY', 'REVIEWED'].includes(detail?.run.state) ||
      !(p?.target.initializable || p?.target.connected);
    $('pub-publish').disabled = busy || working || !reviewed;
    $('pub-recover').hidden = !['PUBLICATION_UNKNOWN', 'INTERRUPTED', 'FAILED', 'CANCELLED'].includes(detail?.run.state);
    $('pub-recover').disabled = busy || working;
    $('pub-start').hidden = Boolean(p?.seller); $('pub-start').disabled = busy || working || !p || p.target.initializable;
    $('pub-stop').hidden = !p?.seller; $('pub-stop').disabled = busy || working;
    $('pub-load-offer').disabled = busy || working || !candidate || !p?.seller;
    $('pub-prepare-buyer').disabled = busy || working || !state.offer || !p?.seller;
    schedule?.update();
  }
  function resetSchedule() {
    $('pub-schedule').replaceWith(scheduleTemplate.cloneNode(true));
    const selected = state.id;
    schedule = createSchedulePanel({
      api: (path, body) => api('publications/' + selected + path.replace(/^\/api/, ''), body),
      action: fn => action(async () => { await fn(); await refresh(); }), notice,
      context: () => ({ busy: isBusy(), detail: state.detail, target: state.publication?.target,
        snapshot: state.publication?.snapshot, pageSize: 20 }),
      openRun,
    });
  }
  async function inspectRun() {
    if (!state.runId) { state.detail = null; renderRun(); return; }
    state.detail = await call('/run?id=' + encodeURIComponent(state.runId) +
      '&query=' + encodeURIComponent($('pub-preview-query').value || 'limit=20'));
    renderRun(); update();
  }
  async function openRun(id) {
    if (state.runId !== id) { invalidateBuyer(); $('pub-preview-query').value = ''; }
    state.runId = id; await inspectRun(); renderRuns(); update();
  }
  function polling() {
    clearTimeout(state.timer);
    if (!state.visible || !state.id) return;
    const working = state.publication?.snapshot.active || state.publication?.schedule.active;
    state.timer = setTimeout(async () => {
      if (!isBusy() && !state.polling) {
        state.polling = true;
        try { await refresh(); } catch (error) { notice(error.message, true); }
        finally { state.polling = false; }
      }
      polling();
    }, working ? 1500 : 15000);
  }
  async function refresh() {
    if (!state.id) { await list(); return; }
    const id = state.id, priorSeller = state.publication?.seller?.origin;
    const p = await call('?limit=20&plansOffset=' + state.plansOffset + '&runsOffset=' + state.runsOffset);
    if (state.id !== id) return;
    state.publication = p;
    if (priorSeller && p.seller?.origin !== priorSeller) invalidateBuyer();
    facts($('pub-binding'), [['Source revision', p.revision], ['Report', p.query],
      ['Read concern', p.source.queries[p.query].readConcern], ['Resource', p.path]]);
    $('pub-source').textContent = pretty({ sourceSha256: p.source.hash, ...p.source.queries[p.query] });
    renderPlans(); renderRuns(); renderSeller();
    if (!state.runId) state.runId = p.snapshot.active?.id ?? p.snapshot.runs[0]?.id ?? null;
    const listed = p.snapshot.runs.find(item => item.id === state.runId);
    if (!state.detail || state.detail.run.id !== state.runId || !listed ||
        listed.updated !== state.detail.run.updated || listed.state !== state.detail.run.state)
      await inspectRun();
    else renderRun();
    await schedule.refresh(); update(); polling();
  }
  async function select(id) {
    if ((state.dirty || schedule?.dirty) && !confirm('Open this publication and replace its unsaved plan or policy form?')) {
      $('pub-select').value = state.id ?? ''; return;
    }
    cache(); clearTimeout(state.timer); state.id = id; state.plan = null; state.runId = null; state.detail = null;
    state.dirty = false; state.plansOffset = 0; state.runsOffset = 0; state.request = null; invalidateBuyer();
    state.publication = await call(); resetSchedule();
    $('pub-content').hidden = false; $('pub-create-details').open = false;
    fillPlan(state.publication.snapshot.plans[0] ?? null);
    let draft; try { draft = JSON.parse(sessionStorage.getItem(draftKey()) ?? 'null'); } catch {}
    if (draft?.sourceHash === state.publication.source.hash) {
      state.plan = draft.planId ? await call('/plans/' + draft.planId) : null;
      for (const [id, value] of Object.entries(draft.fields ?? {})) if (fieldIds.includes(id)) $(id).value = value;
      for (const value of draft.columns ?? []) {
        const row = [...$('pub-columns').querySelectorAll('[data-column]')].find(item => item.dataset.column === value.name);
        if (!row) continue;
        for (const key of ['exposed', 'nullable', 'filters', 'ranges', 'sorts']) {
          const input = row.querySelector('[data-role=' + key + ']'); if (!input.disabled) input.checked = Boolean(value[key]);
        }
        row.querySelector('[data-role=type]').value = value.type;
      }
      state.dirty = true; notice('Restored this publication’s unsaved extraction plan.');
    }
    $('pub-select').value = id; $('pub-buyer-intent').value = 'mongodb-dataset-' + Date.now();
    await refresh();
  }
  async function list() {
    const result = await api('publications');
    options($('pub-select'), [['', 'Choose a publication'], ...result.items.map(item =>
      [item.id, item.query + ' · revision ' + item.revision + ' · ' + item.resource])], state.id ?? '');
    const selected = $('pub-route').value;
    options($('pub-route'), (current().plan?.routes ?? []).map(item => [item.id, item.id + ' · ' + item.query]), selected);
    if (!$('pub-path').dataset.edited) $('pub-path').value = '/datasets/' + ($('pub-route').value || 'report');
    return result;
  }
  for (const id of fieldIds) $(id).addEventListener('input', dirty);
  $('pub-path').addEventListener('input', () => { $('pub-path').dataset.edited = 'true'; });
  $('pub-route').addEventListener('change', () => {
    if (!$('pub-path').dataset.edited) $('pub-path').value = '/datasets/' + $('pub-route').value;
  });
  $('pub-select').addEventListener('change', () => { if ($('pub-select').value) action(() => select($('pub-select').value)); });
  $('pub-plan-select').addEventListener('change', () => action(async () => {
    const selected = $('pub-plan-select').value;
    if (state.dirty && !confirm('Replace the unsaved extraction plan with this saved plan?')) { renderPlans(); return; }
    fillPlan(selected ? await call('/plans/' + selected) : null); cache();
  }));
  on('pub-create', async () => {
    if ((state.dirty || schedule?.dirty) && !confirm('Create a publication and replace the unsaved publication form?')) return;
    cache();
    const created = await api('publications', { expectedRevision: requireSaved(), routeId: $('pub-route').value, path: $('pub-path').value });
    state.dirty = false; schedule = null;
    await list(); await select(created.id); notice('Created a publication bound to the saved MongoDB source and complete merchant terms.');
  });
  on('pub-refresh', async () => { await list(); if (state.id) await refresh(); });
  on('pub-new-plan', () => {
    if (state.dirty && !confirm('Replace the unsaved extraction plan with the retained source defaults?')) return;
    fillPlan(); cache();
  });
  on('pub-save-plan', async () => {
    const saved = await call('/plans', planInput()); state.plansOffset = 0; fillPlan(saved); cache();
    await refresh(); notice('Saved the exact inputs, typed dataset schema, stable source order and extraction limits.');
  });
  on('pub-extract', async () => {
    if (state.dirty || !state.plan) throw new Error('Save this extraction plan before running it');
    state.request ??= { plan: state.plan.id, id: crypto.randomUUID() };
    const result = await call('/extract', state.request); state.request = null; state.runsOffset = 0;
    await openRun(result.id); await refresh(); notice('The native MongoDB cursor is extracting the complete saved report.');
  });
  on('pub-cancel', async () => { await call('/cancel', { id: state.publication.snapshot.active.id }); await refresh(); });
  on('pub-preview', inspectRun);
  for (const [id, file] of [['pub-csv', 'data.csv'], ['pub-config', 'dataset.json'], ['pub-manifest', 'candidate.json']])
    on(id, () => download(base() + '/files/' + state.runId + '/' + file, file));
  on('pub-review', async () => {
    if (!$('pub-reviewer').value.trim() || !$('pub-review-note').value.trim()) throw new Error('Enter the reviewer and a note describing this candidate review');
    const target = state.publication.target;
    await call('/review', { id: state.runId, reviewer: $('pub-reviewer').value, note: $('pub-review-note').value,
      ...(target.initializable ? { initialize: true } : { expectedSnapshot: target.versions.current, expectedRevision: target.versions.revision }) });
    await refresh(); notice('Saved this candidate’s review against the displayed target.');
  });
  on('pub-publish', async () => {
    const result = await call('/publish', { id: state.runId, reviewId: state.detail.run.data.review.id });
    await refresh(); notice(result.state === 'PUBLISHED' ? 'Published the reviewed snapshot through the original version store.' : words(result.data.error ?? result.state), result.state !== 'PUBLISHED');
  });
  on('pub-recover', async () => { await call('/recover', { id: state.runId }); await refresh(); notice('Reconciled the retained run with its original candidate and target.'); });
  on('pub-start', async () => { await call('/seller/start', {}); await refresh(); notice('Started the original dataset seller with every bound merchant payment choice.'); });
  on('pub-stop', async () => { await call('/seller/stop', {}); invalidateBuyer(); await refresh(); notice('Paused recurring refreshes and closed the dataset seller.'); });
  $('pub-buyer-query').addEventListener('input', () => { invalidateBuyer(); update(); });
  on('pub-load-offer', async () => {
    state.offer = await call('/buyer?id=' + encodeURIComponent(state.runId) + '&query=' + encodeURIComponent($('pub-buyer-query').value));
    const offer = state.offer;
    options($('pub-buyer-choice'), offer.accepts.map((choice, index) => [index, index + ' · ' + choice.network + ' · ' + choice.amount]), 0);
    $('pub-offer').replaceChildren(table(['Choice', 'Network', 'Amount', 'Asset', 'Recipient'], offer.accepts.map((choice, index) =>
      [index, choice.network, node('code', choice.amount), node('code', choice.asset), node('code', choice.payTo)])),
      node('pre', pretty({ snapshot: offer.snapshot, url: offer.url, mode: offer.mode, accepts: offer.accepts })));
    update(); notice('Loaded the actual running seller’s offer for the selected retained snapshot.');
  });
  on('pub-prepare-buyer', async () => {
    state.buyer = await call('/buyer', { id: state.runId, query: $('pub-buyer-query').value,
      intentId: $('pub-buyer-intent').value, acceptIndex: Number($('pub-buyer-choice').value), offerSha256: state.offer.offerSha256 });
    $('pub-buyer-result').replaceChildren(node('pre', pretty(state.buyer.config)));
    $('pub-download-buyer').hidden = false;
    notice('Prepared the original SF88 buyer configuration with the selected snapshot and exact payment terms.');
  });
  on('pub-download-buyer', () => download('files/dataset-buyers/' + state.buyer.id + '/buyer.tar.gz', 'MongoDB-Dataset-Buyer.tar.gz'));
  window.addEventListener('beforeunload', event => {
    cache(); if (state.dirty || schedule?.dirty) { event.preventDefault(); event.returnValue = ''; }
  });
  return {
    refresh, update, list,
    show(visible) {
      state.visible = visible; polling();
      if (visible) action(async () => { const found = await list(); if (!state.id && found.items.length) await select(found.items[0].id); });
    },
    get dirty() { return state.dirty || Boolean(schedule?.dirty); },
  };
}
