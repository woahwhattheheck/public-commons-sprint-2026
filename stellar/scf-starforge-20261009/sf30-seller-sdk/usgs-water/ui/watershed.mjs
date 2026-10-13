// MIT. Whole watershed receiving in the existing Water workspace.
export function mountWatershed({ api, notice, make, getState, refresh }) {
  const host = document.getElementById('watershed-desk');
  const els = {}, PAGE = 40;
  let opened = null, choices = {}, dirty = false, page = 0, query = '', filePage = 0, fileQuery = '';
  let lastJobSignature = '', busy = false, pendingOpen = null, pendingSave = null;
  const block = (tag, text, attrs = {}) => make(tag, text, attrs);
  function append(parent, ...children) { parent.append(...children); return parent; }
  function field(parent, id, title, kind = 'input', attrs = {}) {
    const label = block('label', title), input = block(kind, null, { id: 'watershed-' + id, ...attrs });
    els[id] = input; label.append(input); parent.append(label); return input;
  }
  async function exclusive(work) {
    if (busy) throw new Error('Wait for the current watershed operation to finish.');
    busy = true;
    const controls = Array.from(host.querySelectorAll('input, textarea, select, button')).map(el => [el, el.disabled]);
    for (const [el] of controls) el.disabled = true;
    try { return await work(); }
    finally {
      for (const [el, disabled] of controls) if (el.isConnected) el.disabled = disabled;
      busy = false;
      if (opened) { renderFiles(); renderReferences(); renderPlan(); renderDownloads(); }
      const id = pendingOpen; pendingOpen = null;
      if (id && !dirty && (!opened || opened.id === id)) {
        exclusive(() => open(id)).catch(error => notice(error.message, true));
      }
    }
  }
  function button(parent, text, work) {
    const b = block('button', text, { type: 'button' });
    b.addEventListener('click', async () => {
      if (busy) return;
      try { await exclusive(work); } catch (error) { notice(error.message, true); }
    });
    parent.append(b); return b;
  }
  function draftKey() { return 'water-watershed-draft:' + getState()?.project?.createdAt + ':' + opened.id + ':' + opened.sourceManifestSha256; }
  function retainDraft() {
    if (!opened) return;
    try { localStorage.setItem(draftKey(), JSON.stringify({ id: opened.id, sourceSha256: opened.sourceSha256, review: reviewInput(), pendingSave })); }
    catch { notice('Browser draft storage is unavailable. Download the complete unfinished working file before leaving.', true); }
  }
  function readDraft() {
    try { const value = JSON.parse(localStorage.getItem(draftKey()) || 'null'); return value?.id === opened.id && value.sourceSha256 === opened.sourceSha256 ? value : null; }
    catch { return null; }
  }
  function clearDraft() { try { localStorage.removeItem(draftKey()); } catch {} }
  function changed() { dirty = true; retainDraft(); els.status.textContent = 'Unsaved receiving choices'; }
  window.addEventListener('beforeunload', event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
  const intro = block('p', 'Keep the complete original watershed, review its data files and model references, then convert and reopen the same model in the receiving HEC application.', { class: 'caption' });
  host.append(intro);
  const source = block('section');
  source.append(block('h3', 'Retain the original watershed'));
  field(source, 'new-id', 'Migration name', 'input', { placeholder: 'russian-river-upgrade', maxlength: '96' });
  field(source, 'source', 'Watershed folder on this machine', 'input', { placeholder: '/projects/RussianRiver' });
  const encoding = field(source, 'encoding', 'Legacy model text encoding', 'select');
  for (const [value, title] of [['','Automatic Unicode'],['cp1252','Windows-1252 fallback'],['iso-8859-1','ISO-8859-1 fallback']]) encoding.append(block('option', title, { value }));
  button(source, 'Capture complete original', async () => {
    const id = els['new-id'].value.trim();
    await job('capture', { id, source: els.source.value.trim(), textEncoding: els.encoding.value || null });
  });
  host.append(source);
  const selector = block('div', null, { class: 'two' });
  field(selector, 'saved', 'Saved watersheds', 'select');
  button(selector, 'Open saved watershed', async () => open(els.saved.value));
  host.append(selector);
  els.status = block('p', 'Capture a watershed or reopen a saved migration.', { role: 'status', 'aria-live': 'polite' }); host.append(els.status);
  const area = block('div'); area.hidden = true; host.append(area);
  els.summary = block('p', null, { class: 'caption' }); area.append(els.summary);
  const operations = block('div', null, { class: 'actions' }); area.append(operations);
  button(operations, 'Inspect native DSS files', () => requireOpen().then(() => job('inspect', { id: opened.id })));
  button(operations, 'Refresh saved result', async () => {
    if (dirty) throw new Error('Save or download the current receiving choices before refreshing.');
    await open(opened.id);
  });
  field(area, 'title', 'Handover title'); field(area, 'receiver', 'Receiving HEC application and version');
  field(area, 'note', 'Analyst receiving note', 'textarea', { rows: '4' });
  for (const key of ['title','receiver','note']) els[key].addEventListener('input', changed);
  area.append(block('h3', 'Original and migrated files'));
  field(area, 'file-search', 'Find a file', 'input', { type: 'search' }).addEventListener('input', () => {
    fileQuery = els['file-search'].value.toLowerCase(); filePage = 0; renderFiles();
  });
  els.files = block('div', null, { class: 'table-wrap' }); area.append(els.files);
  const filePages = block('div', null, { class: 'pagination' });
  els.filePrevious = button(filePages, 'Previous files', async () => { filePage--; renderFiles(); });
  els.fileLabel = block('span'); filePages.append(els.fileLabel);
  els.fileNext = button(filePages, 'Next files', async () => { filePage++; renderFiles(); });
  area.append(filePages);
  area.append(block('h3', 'Model and extract-list references'));
  area.append(block('p', 'Review each original reference. Relative filenames must resolve to one retained file. Keep the original value or enter its complete replacement; saved choices stay attached to the original file and location.', { class: 'caption' }));
  field(area, 'search', 'Find a reference', 'input', { type: 'search' }).addEventListener('input', () => {
    query = els.search.value.toLowerCase(); page = 0; renderReferences();
  });
  els.refs = block('div', null, { class: 'record-list' }); area.append(els.refs);
  const pages = block('div', null, { class: 'pagination' });
  els.previous = button(pages, 'Previous references', async () => { page--; renderReferences(); });
  els.pageLabel = block('span'); pages.append(els.pageLabel);
  els.next = button(pages, 'Next references', async () => { page++; renderReferences(); });
  area.append(pages);
  const reviewActions = block('div', null, { class: 'actions' }); area.append(reviewActions);
  button(reviewActions, 'Save receiving choices', saveReview);
  button(reviewActions, 'Download unfinished working file', async () => {
    await requireOpen();
    const working = { schema: 'starforge.water-watershed.v1.working', id: opened.id,
      sourceSha256: opened.sourceSha256, source: opened.source, review: structuredClone(reviewInput()) };
    downloadJson(working, opened.id + '-watershed-working.json');
  });
  button(reviewActions, 'Reconcile with saved review', async () => {
    await requireOpen(); if (dirty || pendingSave) retainDraft();
    const wasDirty = dirty, previousPending = pendingSave; dirty = false; pendingSave = null;
    try { await open(opened.id); notice('The saved review is open. Restore the retained browser draft to apply it against this revision.'); }
    catch (error) { dirty = wasDirty; pendingSave = previousPending; throw error; }
  });
  button(reviewActions, 'Restore retained browser draft', async () => {
    await requireOpen(); const draft = readDraft();
    if (!draft) throw new Error('There is no retained browser draft for this original watershed.');
    choices = structuredClone(draft.review.choices || {});
    els.title.value = draft.review.title || ''; els.receiver.value = draft.review.receivingApplication || '';
    els.note.value = draft.review.note || ''; pendingSave = null;
    changed(); renderReferences(); renderPlan();
  });
  const working = field(area, 'working-file', 'Reopen an unfinished working file', 'input', { type: 'file', accept: '.json,application/json' });
  working.addEventListener('change', async () => {
    if (busy) { working.value = ''; return; }
    try { await exclusive(async () => {
      if (!working.files[0]) return;
      if (dirty) throw new Error('Save the current receiving choices before reopening a working file.');
      const value = JSON.parse(await working.files[0].text());
      await api('/api/watersheds/reopen-working', { id: opened.id, working: value, expectedRevision: opened.review?.revision || 0 });
      await open(opened.id); notice('The complete unfinished receiving review is reopened.');
    }); } catch (error) { notice(error.message, true); }
    finally { working.value = ''; }
  });
  const previewActions = block('div', null, { class: 'actions' }); area.append(previewActions);
  button(previewActions, 'Review complete migration plan', async () => {
    await saveReview(); opened.plan = await api('/api/watersheds/preview', { id: opened.id }); renderPlan();
  });
  els.run = button(previewActions, 'Convert and verify whole watershed', async () => {
    await requireOpen();
    if (dirty || !opened.plan?.ready) throw new Error('Save and review the current complete migration plan first.');
    await job('execute', { id: opened.id, planSha256: opened.plan.planSha256 });
  });
  els.plan = block('div'); area.append(els.plan);
  area.append(block('h3', 'Complete handover'));
  const downloads = block('div', null, { class: 'actions' }); area.append(downloads); els.downloads = downloads;
  const received = block('section'); received.append(block('h3', 'Receive an existing handover'));
  field(received, 'receive-path', 'Complete handover ZIP on this machine');
  button(received, 'Receive and reopen whole watershed', () => job('receive', { file: els['receive-path'].value.trim() }));
  host.append(received);

  async function requireOpen() { if (!opened) throw new Error('Open a saved watershed first.'); return opened; }
  async function job(command, input) {
    await api('/api/watersheds/' + command, input);
    notice('Running ' + command + ' with the retained original watershed.'); await refresh();
  }
  function downloadJson(value, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
    const a = block('a', filename, { href: url, download: filename }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function downloadLink(kind, label, file) {
    const url = '/api/watersheds/' + encodeURIComponent(opened.id) + '/download/' + kind + (file ? '?file=' + encodeURIComponent(file) : '');
    return block('a', label, { href: url, download: '' });
  }
  function reviewInput() {
    return { id: opened.id, sourceSha256: opened.sourceSha256, expectedRevision: opened.review?.revision || 0,
      title: els.title.value, receivingApplication: els.receiver.value, note: els.note.value, choices };
  }
  async function saveReview() {
    await requireOpen();
    if (pendingSave) {
      // Retry the exact submitted body; the server adopts its accepted revision.
      const submitted = pendingSave, current = reviewInput();
      const fields = value => JSON.stringify([value.title, value.receivingApplication, value.note, value.choices]);
      const unchanged = fields(submitted) === fields(current);
      opened.review = await api('/api/watersheds/review', submitted);
      pendingSave = null;
      if (unchanged) {
        dirty = false; clearDraft(); opened.plan = null;
        els.status.textContent = 'Original receiving save recovered · revision ' + opened.review.revision;
        renderPlan(); return opened.review;
      }
    }
    if (!dirty && opened.review) return opened.review;
    pendingSave = structuredClone(reviewInput()); retainDraft();
    opened.review = await api('/api/watersheds/review', pendingSave);
    pendingSave = null; dirty = false; clearDraft(); opened.plan = null;
    els.status.textContent = 'Receiving choices saved · revision ' + opened.review.revision;
    renderPlan(); return opened.review;
  }
  async function open(id) {
    if (!id) throw new Error('Choose a saved watershed.');
    if (dirty) throw new Error('Save or download the unfinished receiving choices before opening another watershed.');
    opened = await api('/api/watersheds/' + encodeURIComponent(id));
    choices = structuredClone(opened.review?.choices || {}); dirty = false; pendingSave = null; page = 0; filePage = 0;
    els.title.value = opened.review?.title || id; els.receiver.value = opened.review?.receivingApplication || '';
    els.note.value = opened.review?.note || ''; area.hidden = false;
    els.status.textContent = opened.status + ' · ' + id + (readDraft() ? ' · a browser draft is available to restore' : '');
    const files = opened.source.files;
    els.summary.textContent = files.length + ' complete original files · ' + files.reduce((n, f) => n + f.bytes, 0).toLocaleString() +
      ' bytes · ' + opened.source.references.length + ' model references' +
      (opened.catalog ? ' · ' + opened.catalog.files.length + ' native DSS files' : '');
    els.saved.value = id; renderFiles(); renderReferences(); renderPlan(); renderDownloads();
  }
  function paginate(values, selectedPage) {
    const max = Math.max(0, Math.ceil(values.length / PAGE) - 1), p = Math.min(max, Math.max(0, selectedPage));
    return { max, page: p, rows: values.slice(p * PAGE, (p + 1) * PAGE), total: values.length };
  }
  function renderFiles() {
    if (!opened) return;
    const p = paginate(opened.source.files.filter(f => f.path.toLowerCase().includes(fileQuery)), filePage); filePage = p.page;
    const table = block('table'), head = block('tr');
    for (const label of ['File','Original bytes','Reference coverage','Native records','Downloads']) head.append(block('th', label));
    table.append(append(block('thead'), head));
    const body = block('tbody'), native = new Map((opened.catalog?.files || []).map(f => [f.path, f]));
    for (const file of p.rows) {
      const tr = block('tr'); tr.append(block('td', file.path), block('td', file.bytes.toLocaleString()));
      const coverage = (opened.source.referenceCoverage || []).find(row => row.path === file.path);
      tr.append(block('td', coverage ? ({ SCANNED_MODEL_TEXT: 'Model text scanned', NATIVE_DSS: 'Native data catalog', RETAINED_OTHER_FORMAT: 'Retained complete; other format', UNREAD_MODEL_TEXT: 'Encoding needs correction' }[coverage.status] || coverage.status) : ''));
      const item = native.get(file.path);
      tr.append(block('td', item ? 'DSS' + item.version + ' · ' + item.records.length : ''));
      const links = block('td'); links.append(downloadLink('original', 'Original', file.path));
      if (opened.result) { links.append(document.createTextNode(' · '), downloadLink('migrated', 'Migrated', file.path)); }
      tr.append(links); body.append(tr);
    }
    table.append(body); els.files.replaceChildren(table);
    els.fileLabel.textContent = p.total ? (p.page * PAGE + 1) + '–' + Math.min((p.page + 1) * PAGE, p.total) + ' of ' + p.total : 'No matching files';
    els.filePrevious.disabled = !p.page; els.fileNext.disabled = p.page >= p.max;
  }
  function renderReferences() {
    if (!opened) return;
    const matched = opened.source.references.filter(ref => (ref.file + ' ' + ref.value + ' ' + ref.context).toLowerCase().includes(query));
    const p = paginate(matched, page); page = p.page; els.refs.replaceChildren();
    const fileOptions = block('datalist', null, { id: 'watershed-dss-files' });
    for (const file of opened.source.files.filter(f => f.path.toLowerCase().endsWith('.dss'))) fileOptions.append(block('option', file.path, { value: file.path }));
    els.refs.append(fileOptions);
    for (const ref of p.rows) {
      const card = block('div', null, { class: 'record' });
      card.append(block('strong', ref.file + ' · line ' + ref.line), block('pre', ref.context));
      const old = block('p', 'Original: ' + ref.value, { class: 'caption' }); card.append(old);
      if (ref.kind === 'file') card.append(block('p', 'Retained matches: ' + (ref.candidates.join(', ') || 'Choose the relative file reference'), { class: 'caption' }));
      if (ref.suggested && ref.suggested !== ref.value) card.append(block('p', 'Time-series interval spelling, if applicable: ' + ref.suggested, { class: 'caption' }));
      const label = block('label', 'Receiving choice'), select = block('select', null, { 'data-reference': ref.id });
      for (const [value, title] of [['','Choose a receiving action'],['retain','Retain exact original'],['replace','Replace this reference'],['output','Declare future model output']]) select.append(block('option', title, { value }));
      select.value = choices[ref.id]?.action || ''; label.append(select); card.append(label);
      const valueLabel = block('label', 'Complete replacement'), value = block('input', null, { type: 'text', 'data-reference-value': ref.id });
      value.value = choices[ref.id]?.value || ''; value.disabled = !['replace','output'].includes(select.value); valueLabel.append(value); card.append(valueLabel);
      select.addEventListener('change', () => {
        if (!select.value) delete choices[ref.id]; else choices[ref.id] = { ...choices[ref.id], action: select.value, ...(['replace','output'].includes(select.value) ? { value: value.value } : {}) };
        value.disabled = !['replace','output'].includes(select.value); changed(); renderPlan();
      });
      value.addEventListener('input', () => { choices[ref.id] = { ...choices[ref.id], action: select.value || 'replace', value: value.value }; changed(); renderPlan(); });
      if (ref.suggested && ref.suggested !== ref.value) button(card, 'Use shown DSS7 interval spelling', async () => {
        choices[ref.id] = { ...choices[ref.id], action: 'replace', value: ref.suggested }; changed(); renderReferences(); renderPlan();
      });
      if (ref.kind === 'pathname') {
        const fileLabel = block('label', 'DSS file for this complete pathname (relative to watershed root)');
        const file = block('input', null, { type: 'text', 'data-reference-file': ref.id, list: 'watershed-dss-files' });
        file.value = choices[ref.id]?.file || '';
        file.addEventListener('input', () => {
          choices[ref.id] = { ...choices[ref.id], file: file.value }; changed(); renderPlan();
        });
        fileLabel.append(file); card.append(fileLabel);
      }
      els.refs.append(card);
    }
    if (!p.total) els.refs.append(block('p', 'No matching model references.', { class: 'empty' }));
    els.pageLabel.textContent = p.total ? (p.page * PAGE + 1) + '–' + Math.min((p.page + 1) * PAGE, p.total) + ' of ' + p.total : '0 references';
    els.previous.disabled = !p.page; els.next.disabled = p.page >= p.max;
  }
  function renderPlan() {
    els.plan.replaceChildren(); const plan = opened?.plan;
    els.run.disabled = dirty || !plan?.ready || opened?.status === 'COMPLETE';
    if (dirty) { els.plan.append(block('p', 'Save the changed review and prepare its current migration plan.')); return; }
    if (!plan) return;
    els.plan.append(block('p', plan.ready ? 'All receiving choices resolve. The complete native migration is ready.' : 'Resolve the listed receiving choices and review again.'));
    els.plan.append(block('p', plan.files.filter(f => f.action === 'convert').length + ' DSS6 files to convert · ' +
      plan.files.filter(f => f.action === 'retain').length + ' DSS7 files retained · ' + plan.edits.length + ' reviewed reference replacements'));
    const details = block('details'); details.append(block('summary', 'Complete plan and findings'), block('pre', JSON.stringify(plan, null, 2))); els.plan.append(details);
  }
  function renderDownloads() {
    els.downloads.replaceChildren();
    for (const [kind, title, exists] of [['source','Original inventory',true],['catalog','Full native catalog',opened.catalog],['review','Saved review',opened.review],['plan','Receiving plan',opened.plan],['result','Complete native result',opened.result]]) {
      if (exists) els.downloads.append(downloadLink(kind, title));
    }
    if (opened.result) els.downloads.append(downloadLink('handover', 'Complete watershed handover ZIP'));
  }
  function render(state) {
    const rows = state.watersheds || [], selected = opened?.id || els.saved.value;
    els.saved.replaceChildren(block('option', 'Choose a saved watershed', { value: '' }));
    for (const row of rows) els.saved.append(block('option', row.id + ' · ' + row.status, { value: row.id }));
    els.saved.value = selected;
    const jobs = (state.jobs || []).filter(row => row.id.startsWith('watershed-'));
    const signature = JSON.stringify(jobs.map(row => [row.id, row.status, row.completedAt]));
    if (signature !== lastJobSignature) {
      lastJobSignature = signature;
      const finished = jobs.filter(row => row.status !== 'RUNNING').sort((a, b) => (a.completedAt || '').localeCompare(b.completedAt || '')).at(-1);
      const id = finished?.result?.id || finished?.result?.migration?.id;
      if (id && !dirty && (!opened || opened.id === id)) {
        if (busy) pendingOpen = id;
        else exclusive(() => open(id)).catch(error => notice(error.message, true));
      }
    }
  }
  return { refresh: render };
}
