// MIT. Source refresh is an operating step in the existing merchant workspace.
export function attachSchemaRefresh({ api, run, notice, element, button, downloadButton,
  selectedVersion, openVersion, canReplacePlan, cacheId }) {
  const $ = id => document.getElementById(id), clone = value => structuredClone(value);
  const state = { baseVersion: '', metadataId: '', impact: null, decisions: {}, review: null,
    dirty: false, metadata: [], metadataNext: null, versions: [], versionNext: null, historyNext: null };
  const cacheKey = 'cube-refresh:' + cacheId;
  function cache() {
    sessionStorage.setItem(cacheKey, JSON.stringify({ baseVersion: state.baseVersion, metadataId: state.metadataId,
      decisions: state.decisions, reviewId: state.review?.id ?? null, dirty: state.dirty, operator: $('refresh-operator').value }));
  }
  function changed() { state.dirty = true; $('apply-refresh').disabled = true; cache(); }
  function discard() { return !state.dirty || confirm('Discard the unsaved schema review decisions?'); }
  function emptyReview() {
    state.impact = null; state.decisions = {}; state.review = null; state.dirty = false;
    $('refresh-impact').replaceChildren(); $('refresh-decisions').replaceChildren(); $('refresh-result').replaceChildren();
    $('review-refresh').disabled = true; $('apply-refresh').disabled = true; cache();
  }
  function option(value, label) { const node = element('option', label); node.value = value; return node; }
  function selectOptions(node, values, chosen, placeholder) {
    node.replaceChildren(option('', placeholder), ...values.map(row => option(row.id, row.label)));
    node.value = chosen;
  }
  async function versions(more = false) {
    const next = more ? state.versionNext : null;
    const result = await api('versions?limit=20' + (next ? '&before=' + encodeURIComponent(next) : ''));
    state.versions = (more ? state.versions : []).concat(result.items.filter(row => row.status === 'SAVED'));
    state.versionNext = result.next; $('refresh-more-versions').hidden = !result.next;
    let chosen = state.baseVersion || selectedVersion()?.id || '';
    if (chosen && !state.versions.some(row => row.id === chosen)) {
      const saved = await api('versions/' + chosen);
      state.versions.push({ id: saved.id, createdAt: saved.view.createdAt, reportCount: saved.view.reportCount });
    }
    selectOptions($('refresh-base'), state.versions.map(row => ({ id: row.id,
      label: `${row.createdAt} · ${row.reportCount} reports · ${row.id}` })), chosen, 'Choose a saved version');
    state.baseVersion = chosen;
  }
  async function metadata(more = false) {
    const result = await api('metadata?limit=20&offset=' + (more ? state.metadataNext ?? 0 : 0));
    state.metadata = (more ? state.metadata : []).concat(result.items.filter(row => row.status === 'RETAINED'));
    state.metadataNext = result.next; $('refresh-more-metadata').hidden = result.next === null;
    if (state.metadataId && !state.metadata.some(row => row.id === state.metadataId)) {
      const saved = await api('metadata/' + state.metadataId); state.metadata.push({ ...saved, memberCount: saved.source.memberCount });
    }
    selectOptions($('refresh-candidate'), state.metadata.map(row => ({ id: row.id,
      label: `${row.label} · ${row.memberCount} members · ${row.id}` })), state.metadataId, 'Choose a retained metadata edition');
    const holder = $('metadata-history'); holder.replaceChildren();
    for (const row of state.metadata) {
      const card = element('div', null, 'metadata-row');
      card.append(element('strong', row.label), element('span', `${row.memberCount} public members · ${row.provenance?.kind ?? ''}`, 'help'),
        element('span', row.metadataSha256, 'mono break'), downloadButton('metadata', row.id, 'cube-meta.json', 'Download original metadata'));
      holder.append(card);
    }
  }
  async function history(more = false) {
    const result = await api('refreshes?limit=20&offset=' + (more ? state.historyNext ?? 0 : 0));
    state.historyNext = result.next; $('refresh-more-history').hidden = result.next === null;
    const holder = $('refresh-history'); if (!more) holder.replaceChildren();
    if (!result.total) holder.append(element('p', 'Saved schema reviews will appear here.', 'help'));
    for (const row of result.items) {
      const item = element('div', null, 'history-row');
      item.append(element('div', `${row.createdAt ?? row.id} · ${row.status}`),
        element('p', row.error ?? `${row.operator} · ${row.reportCount} retained reports`, 'help'));
      if (row.status !== 'UNAVAILABLE') item.append(button('Open review', () => run(() => reopen(row.id))));
      holder.append(item);
    }
  }
  function table(headers) {
    const wrap = element('div', null, 'table-wrap'), table = element('table'), head = element('thead'), tr = element('tr'), body = element('tbody');
    wrap.tabIndex = 0; wrap.setAttribute('aria-label', headers[0] + ' table');
    for (const title of headers) { const th = element('th', title); th.scope = 'col'; tr.append(th); }
    head.append(tr); table.append(head, body); wrap.append(table); return { wrap, body };
  }
  function descriptor(rows) {
    if (!rows.length) return 'Not present in this metadata';
    return rows.map(row => `${row.cubeType} ${row.cube} / ${row.kind} / ${row.type ?? 'type unspecified'} / ${row.public ? 'public' : 'hidden'}` +
      (row.granularities.length ? ' / ' + row.granularities.join(', ') : '')).join('\n');
  }
  function renderChanges(result, more = false) {
    const holder = $('refresh-impact');
    if (!more) {
      holder.replaceChildren(element('h2', 'Member changes and report impact'));
      holder.append(element('p', `${result.counts.added} added · ${result.counts.unavailable} unavailable · ${result.counts.changed} changed`),
        element('p', `${result.before.label} → ${result.after.label}`, 'help'),
        element('p', 'Unavailable means absent from this response; Cube may omit private members.', 'help'));
      const source = element('details'); source.append(element('summary', 'Exact source bindings'),
        element('p', 'Before ' + result.before.metadataSha256, 'mono break'), element('p', 'Candidate ' + result.after.metadataSha256, 'mono break'));
      holder.append(source);
      const search = element('div', null, 'button-row'), label = element('label', 'Find changed member'), input = element('input');
      input.type = 'search'; input.id = 'refresh-change-query'; label.append(input);
      search.append(label, button('Search changes', () => run(() => changePage(0)))); holder.append(search);
      const { wrap, body } = table(['Member', 'Change', 'Previous definition', 'Candidate definition']); body.id = 'refresh-change-rows'; holder.append(wrap);
      holder.append(button('Load more changes', () => run(() => changePage(state.changeNext)), 'more-changes'));
    }
    const body = $('refresh-change-rows'); if (!more) body.replaceChildren();
    for (const row of result.changes.items) {
      const tr = element('tr'), name = element('th', row.name, 'mono break'); name.scope = 'row';
      tr.append(name, element('td', row.change + (row.fields.length ? ' · ' + row.fields.join(', ') : '')),
        element('td', descriptor(row.before)), element('td', descriptor(row.after))); body.append(tr);
    }
    state.changeNext = result.changes.next;
    holder.querySelector('.more-changes').hidden = result.changes.next === null;
  }
  async function changePage(offset) {
    const query = $('refresh-change-query').value;
    const result = await api('refresh/impact', { baseVersion: state.baseVersion, metadataId: state.metadataId, query, offset, limit: 50 });
    if (!offset) $('refresh-change-rows').replaceChildren();
    renderChanges(result, true);
  }
  async function targetMembers() {
    if (!state.metadataId) return;
    const result = await api('members?' + new URLSearchParams({ metadataId: state.metadataId, query: $('refresh-target-search').value, limit: '100' }));
    $('refresh-target-members').replaceChildren(...result.items.map(row => option(row.name, `${row.kind} · ${row.type ?? ''}`)));
    $('refresh-target-count').textContent = `${result.items.length} of ${result.total} matching public members. Refine the search for another replacement.`;
  }
  function renderDecisions() {
    const holder = $('refresh-decisions'); holder.replaceChildren();
    for (const report of state.impact.reports) {
      const decision = Object.hasOwn(state.decisions, report.id) ? state.decisions[report.id] :
        (state.decisions[report.id] = { action: '', reason: '', members: {}, granularities: {} });
      const card = element('section', null, 'card refresh-report'); card.dataset.report = report.id;
      card.append(element('h3', report.id), element('p', report.path, 'mono'),
        element('p', report.compatible ? 'Current query compiles against the candidate.' : report.error, report.compatible ? 'help' : 'compiler-finding'));
      if (report.changes.length) card.append(element('p', report.changes.map(row => `${row.name}: ${row.fields.join(', ')}`).join('; '), 'help'));
      const controls = element('div', null, 'form-grid'), actionLabel = element('label', 'Report decision'), select = element('select');
      select.setAttribute('aria-label', report.id + ' decision');
      select.append(option('', 'Choose a decision'), option('keep', 'Keep the current query'), option('remap', 'Remap named members'), option('retire', 'Retire from the new version'));
      select.value = decision.action; actionLabel.append(select);
      const reasonLabel = element('label', 'Reason for this decision'), reason = element('input'); reason.maxLength = 4000; reason.value = decision.reason;
      reason.setAttribute('aria-label', report.id + ' reason'); reason.addEventListener('input', () => { decision.reason = reason.value; changed(); }); reasonLabel.append(reason);
      controls.append(actionLabel, reasonLabel); card.append(controls);
      const mappings = element('div', null, 'remap-fields'); mappings.hidden = decision.action !== 'remap';
      mappings.append(element('p', 'Enter an exact candidate member name for each replacement. Empty fields preserve the original reference.', 'help'));
      for (const name of report.members) {
        const label = element('label', name), input = element('input'); input.setAttribute('list', 'refresh-target-members');
        input.setAttribute('aria-label', report.id + ' replacement ' + name); input.placeholder = 'Keep ' + name;
        input.value = Object.hasOwn(decision.members ?? {}, name) ? decision.members[name] : '';
        input.addEventListener('input', () => { decision.members ??= {}; if (input.value) decision.members = { ...decision.members, [name]: input.value }; else delete decision.members[name]; changed(); });
        label.append(input); mappings.append(label);
      }
      for (const name of report.fixedGranularities) {
        const label = element('label', 'Fixed granularity ' + name), input = element('input'); input.value = decision.granularities?.[name] ?? '';
        input.setAttribute('aria-label', report.id + ' granularity ' + name); input.placeholder = 'Keep original granularity';
        input.addEventListener('input', () => { decision.granularities ??= {}; if (input.value) decision.granularities[name] = input.value; else delete decision.granularities[name]; changed(); });
        label.append(input); mappings.append(label);
      }
      select.addEventListener('change', () => {
        decision.action = select.value;
        if (select.value !== 'remap') { decision.members = {}; decision.granularities = {}; for (const input of mappings.querySelectorAll('input')) input.value = ''; }
        mappings.hidden = select.value !== 'remap'; changed();
      });
      const terms = element('details'); terms.append(element('summary', 'Retained public input and price contract'),
        element('pre', JSON.stringify({ inputs: report.inputs, paymentOptions: report.paymentOptions }, null, 2)));
      card.append(mappings, terms); holder.append(card);
    }
    $('review-refresh').disabled = false;
  }
  async function inspect({ preserve = false } = {}) {
    if (!state.baseVersion || !state.metadataId) throw new Error('Choose a saved version and a candidate metadata edition.');
    const impact = await api('refresh/impact', { baseVersion: state.baseVersion, metadataId: state.metadataId });
    state.impact = impact;
    if (!preserve) { state.decisions = {}; state.review = null; state.dirty = false; $('refresh-result').replaceChildren(); }
    renderChanges(impact); renderDecisions(); await targetMembers(); cache();
  }
  function renderReview() {
    const saved = state.review, holder = $('refresh-result'); holder.replaceChildren(); if (!saved) return;
    holder.append(element('h2', saved.status === 'APPLIED' ? 'Schema refresh applied' : 'Saved schema review'),
      element('p', `${saved.status} · ${saved.review.reportCount} reports · ${saved.operator}`), element('p', saved.id, 'mono break'));
    for (const error of saved.review.errors) holder.append(element('p', error, 'compiler-finding'));
    if (saved.review.reports.length) {
      const { wrap, body } = table(['Retained report', 'Route', 'Exact payment options']);
      for (const report of saved.review.reports) {
        const tr = element('tr'), name = element('th', report.id); name.scope = 'row';
        tr.append(name, element('td', report.path, 'mono break'),
          element('td', report.paymentOptions.map(term => `${term.amount} atomic · ${term.network} · ${term.asset}`).join('\n'))); body.append(tr);
      }
      holder.append(wrap);
    }
    const retired = saved.review.reviewed.filter(row => row.action === 'retire').map(row => row.id);
    if (retired.length) holder.append(element('p', 'Retired from the successor: ' + retired.join(', ') + '. Their earlier versions and packages remain available.'));
    const links = element('div', null, 'button-row');
    for (const file of ['review.json', 'merchant-plan.json', 'refresh.json']) links.append(downloadButton('refreshes', saved.id, file));
    if (saved.application) links.append(button('Open applied version', () => run(() => openVersion(saved.application.version, false))));
    holder.append(links);
    $('apply-refresh').disabled = saved.status !== 'READY' || state.dirty;
  }
  async function reopen(id) {
    if (!discard()) return;
    const saved = await api('refreshes/' + id);
    state.baseVersion = saved.baseVersion; state.metadataId = saved.metadataId; state.decisions = clone(saved.review.decisions);
    state.review = saved; state.dirty = false; $('refresh-operator').value = saved.operator;
    await Promise.all([versions(), metadata()]); await inspect({ preserve: true }); renderReview(); cache();
    notice('Opened the retained review and its exact source editions. Changes create a successor review.');
  }
  for (const [name, field] of [['refresh-base', 'baseVersion'], ['refresh-candidate', 'metadataId']]) $(name).addEventListener('change', () => {
    if (!discard()) { $(name).value = state[field]; return; }
    state[field] = $(name).value; emptyReview();
  });
  $('inspect-refresh').addEventListener('click', () => run(async () => { if (discard()) await inspect(); }));
  $('refresh-operator').addEventListener('input', changed);
  $('refresh-target-search-button').addEventListener('click', () => run(targetMembers));
  $('refresh-more-versions').addEventListener('click', () => run(() => versions(true)));
  $('refresh-more-metadata').addEventListener('click', () => run(() => metadata(true)));
  $('refresh-more-history').addEventListener('click', () => run(() => history(true)));
  $('reload-schema-history').addEventListener('click', () => run(() => Promise.all([versions(), metadata(), history()])));
  $('capture-metadata').addEventListener('click', () => run(async () => {
    if (!discard()) return;
    if (!state.baseVersion) throw new Error('Select the saved version whose configured Cube backend should supply metadata.');
    const result = await api('metadata/capture', { baseVersion: state.baseVersion,
      label: $('metadata-label').value, metaPath: $('metadata-path').value });
    state.metadataId = result.id; emptyReview(); await metadata(); await inspect();
    notice(result.alreadyRetained ? 'This exact metadata is already retained; its original bytes were verified.' : 'Captured and retained the original Cube metadata response.');
  }));
  $('metadata-file').addEventListener('change', () => {
    const file = $('metadata-file').files[0]; if (file && !$('metadata-label').value) $('metadata-label').value = file.name;
  });
  $('import-metadata').addEventListener('click', () => run(async () => {
    if (!discard()) return;
    const file = $('metadata-file').files[0]; if (!file || file.size > 16 * 1024 * 1024) throw new Error('Choose a complete metadata JSON file, at most 16 MiB.');
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
    });
    const result = await api('metadata/import', { name: file.name, label: $('metadata-label').value, base64 });
    state.metadataId = result.id; emptyReview(); await metadata(); if (state.baseVersion) await inspect();
    $('metadata-file').value = ''; notice('Retained the original metadata file; existing merchant versions are unchanged.');
  }));
  $('review-refresh').addEventListener('click', () => run(async () => {
    if (!state.impact) throw new Error('Compare the selected sources first.');
    const saved = await api('refresh/review', { baseVersion: state.baseVersion, metadataId: state.metadataId,
      operator: $('refresh-operator').value, decisions: state.decisions, previousReview: state.review?.id ?? null });
    state.review = saved; state.dirty = false; renderReview(); await history(); cache();
    notice(saved.status === 'READY' ? 'Saved the exact reviewed transition. Apply it to create its native merchant version.' : 'Saved the decisions and compiler findings. Revise the affected reports and save a successor review.');
  }));
  $('apply-refresh').addEventListener('click', () => run(async () => {
    if (state.dirty || !state.review || state.review.status !== 'READY') throw new Error('Save and inspect the current decisions before applying.');
    if (!canReplacePlan()) return;
    const result = await api('refresh/apply', { reviewId: state.review.id, reviewSha256: state.review.reviewSha256 });
    state.review = result.review; state.dirty = false; renderReview(); await openVersion(result.version.id, true);
    await Promise.all([versions(), metadata(), history()]); cache();
    notice('Applied the schema refresh and selected its native merchant version. Continue with the original backend read, package export and buyer preparation.');
  }));
  return {
    hasPending: () => state.dirty,
    refresh: () => Promise.all([versions(), metadata(), history()]),
    restore: async () => {
      let saved; try { saved = JSON.parse(sessionStorage.getItem(cacheKey) ?? 'null'); } catch {}
      if (saved) { state.baseVersion = saved.baseVersion ?? ''; state.metadataId = saved.metadataId ?? ''; $('refresh-operator').value = saved.operator ?? ''; }
      await Promise.all([versions(), metadata(), history()]);
      if (saved?.baseVersion && saved?.metadataId) {
        if (saved.reviewId) state.review = await api('refreshes/' + saved.reviewId);
        state.decisions = saved.decisions ?? {}; state.dirty = Boolean(saved.dirty);
        await inspect({ preserve: true }); renderReview();
      }
    },
  };
}
