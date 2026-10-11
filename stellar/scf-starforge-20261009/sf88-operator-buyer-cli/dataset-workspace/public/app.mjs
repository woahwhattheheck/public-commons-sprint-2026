// MIT. Browser presentation; acquisition, payment and SQL remain original services.
const $ = selector => document.querySelector(selector);
let token = location.hash.slice(1) || sessionStorage.getItem('dataset-capability') || '';
if (/^[a-f0-9]{64}$/.test(token)) { sessionStorage.setItem('dataset-capability', token); history.replaceState(null, '', '/'); }
let saved = null, selected = null, selectedId = sessionStorage.getItem('dataset-selected') || null;
let receiving = !selectedId, source = null, review = null, busy = false, tab = 'progress', epoch = 0;
let page = 0, preview = null, purchases = null, handoff = null, alias = '', fileGeneration = 0;
const draft = { name: '', choice: 0, query: 'limit=100', maxPages: 8, maxRows: 1000000, maxPageBytes: 1048576, maxTotalAtomic: '', dailyAtomic: '' };
const display = value => value === null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—');
const count = value => value === null || value === undefined ? '—' : Number(value).toLocaleString();
const size = value => value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1048576).toFixed(2)} MiB`;
const statusText = value => String(value ?? 'UNKNOWN').replaceAll('_', ' ');
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (['value', 'disabled', 'checked', 'hidden', 'selected'].includes(key)) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : String(child));
  return node;
}
const text = (tag, value, className = '') => el(tag, { class: className, text: value });
function button(label, action, { primary = false, disabled = false, ...attrs } = {}) {
  return el('button', { type: 'button', class: primary ? 'primary' : '', disabled: busy || disabled,
    onClick: () => execute(action), ...attrs }, label);
}
const badge = value => text('span', statusText(value), 'status');
const card = (...children) => el('section', { class: 'card' }, ...children);
function definition(entries) {
  return el('dl', { class: 'definition' }, entries.flatMap(([name, value]) => [text('dt', name), text('dd', display(value))]));
}
function table(headers, rows) {
  return el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, headers.map(header => text('th', header)))),
    el('tbody', {}, rows.map(row => el('tr', {}, row.map(cell => el('td', {}, cell)))))));
}
function notice(message = '', error = false) {
  const node = $('#notice'); node.textContent = message; node.hidden = !message; node.dataset.error = String(error);
}
async function api(path, value) {
  const response = await fetch(path, { method: value === undefined ? 'GET' : 'POST',
    headers: { 'x-dataset-workspace-token': token, ...(value === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }), cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.message || result.error || `HTTP ${response.status}`); error.status = response.status; error.code = result.error; throw error; }
  return result;
}
async function execute(action) {
  if (busy) return;
  busy = true; notice();
  for (const node of document.querySelectorAll('button,input,select,textarea')) node.disabled = true;
  try { await action(); }
  catch (error) { notice(`${error.message}${error.code && error.code !== error.message ? '\n' + error.code : ''}`, true); }
  finally { busy = false; render(); }
}
async function refresh({ inspect = false } = {}) {
  saved = await api('/api/state');
  $('#connection').textContent = saved.active ? 'Customer operation running' : 'Local workspace open';
  if (selectedId && saved.sessions.some(item => item.id === selectedId) && (inspect || !receiving))
    selected = await api('/api/session?id=' + encodeURIComponent(selectedId));
  if (saved.persistenceError) notice(saved.persistenceError.message, true);
}
async function chooseSession(id) {
  selectedId = id; receiving = false; selected = null; preview = purchases = handoff = null; page = 0;
  sessionStorage.setItem('dataset-selected', id); alias = id.replaceAll('-', '_').slice(0, 48);
  const current = ++epoch, result = await api('/api/session?id=' + encodeURIComponent(id));
  if (current === epoch && selectedId === id) selected = result;
}
function field(label, key, { type = 'text', help = '', span = false, min, max, step } = {}) {
  const input = el(type === 'textarea' ? 'textarea' : 'input', { ...(type === 'textarea' ? { rows: 3 } : { type }),
    value: draft[key], name: key, disabled: busy,
    ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }), ...(step === undefined ? {} : { step }),
    onInput: event => { draft[key] = type === 'number' ? Number(event.target.value) : event.target.value; review = null; $('#reviewed-plan')?.remove(); },
  });
  return el('label', { class: 'field' + (span ? ' span-all' : '') }, text('span', label), input, help ? text('small', help, 'help') : null);
}
function chooseSource(value) {
  source = value; draft.choice = 0; review = null;
  if (!draft.name) draft.name = 'dataset_' + value.name.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 45);
  const terms = value.choices[0]?.terms;
  if (!draft.maxTotalAtomic) draft.maxTotalAtomic = saved.operator.operator?.maxTotalAtomic ?? terms?.maxAtomic ?? '';
  if (!draft.dailyAtomic) draft.dailyAtomic = saved.operator.operator?.maxDailyAtomic ?? terms?.maxAtomic ?? '';
}
function renderReceiving() {
  const heading = el('div', { class: 'heading' }, el('div', {}, text('h2', 'Receive a dataset'),
    text('p', 'Choose the merchant’s original offer, select the query and review the acquisition.', 'muted')));
  const picker = el('input', { type: 'file', accept: '.json,application/json', disabled: busy, 'aria-label': 'Original merchant offers JSON',
    onChange: event => {
      const file = event.target.files?.[0], generation = ++fileGeneration;
      if (!file) return;
      execute(async () => {
        if (file.size > 1048576 || file.size === 0) throw new Error('Choose an original JSON offer file of up to 1 MiB.');
        const raw = new Uint8Array(await file.arrayBuffer()); if (generation !== fileGeneration) return;
        let binary = ''; for (let offset = 0; offset < raw.length; offset += 32768) binary += String.fromCharCode(...raw.subarray(offset, offset + 32768));
        const result = await api('/api/receive', { name: file.name, base64: btoa(binary) });
        if (generation !== fileGeneration) return;
        chooseSource(result); await refresh(); notice('Original offer saved. Choose the dataset terms and query below.');
      });
    } });
  const imports = card(text('h3', '1. Merchant offers'), text('p', 'Open the saved offers or discovery JSON supplied by the merchant.', 'help'), picker);
  if (saved.sources.length) {
    const options = el('select', { disabled: busy, 'aria-label': 'Saved offer files', onChange: event => {
      const value = saved.sources.find(item => item.id === event.target.value); if (value) { chooseSource(value); render(); }
    } }, el('option', { value: '', selected: !source }, 'Choose a saved offer file…'), saved.sources.map(item => el('option', { value: item.id, selected: item.id === source?.id }, `${item.name} · ${size(item.bytes)}`)));
    imports.append(el('label', { class: 'field spaced' }, text('span', 'Saved offers'), options));
  }
  if (source) imports.append(definition([['Original file', source.name], ['SHA-256', source.id]]));
  const contents = [heading, imports];
  const operator = saved.operator.operator;
  if (!operator) contents.push(card(text('h3', 'Operator setup'), text('p', 'Offer files can be received now. Creating an acquisition requires the operator’s existing settings on this host.'),
    text('p', 'Reopen this customer workspace with --operator-settings pointing to the original private preset. Existing completed datasets remain available.', 'help')));
  if (source) {
    const select = el('select', { name: 'offer', disabled: busy, 'aria-label': 'Original dataset offer', onChange: event => { draft.choice = Number(event.target.value); review = null; render(); } },
      source.choices.map((item, index) => el('option', { value: index, selected: index === draft.choice }, `${item.resource} · ${item.terms.maxAtomic} atomic / page · ${item.terms.network}`)));
    const choice = source.choices[draft.choice];
    const selection = card(text('h3', '2. Query and acquisition limits'), el('label', { class: 'field' }, text('span', 'Original offer and payment option'), select),
      definition([['Merchant payee', choice.terms.payTo], ['Asset', choice.terms.asset], ['Page cap', choice.terms.maxAtomic + ' atomic units']]),
      el('div', { class: 'grid spaced' },
        field('Session name', 'name', { help: 'A stable name for this acquisition.', span: true }),
        field('First-page query', 'query', { type: 'textarea', span: true, help: 'Use the merchant’s actual query fields. For example: fields=sku,units&limit=100&sort=sku. Add snapshot=… to select a published edition.' }),
        field('Maximum pages', 'maxPages', { type: 'number', min: 1, max: 4096, step: 1 }),
        field('Maximum rows', 'maxRows', { type: 'number', min: 1, max: 1000000, step: 1 }),
        field('Maximum bytes per page', 'maxPageBytes', { type: 'number', min: 1024, max: 2097152, step: 1 }),
        field('Total cap · atomic units', 'maxTotalAtomic', { help: operator ? `Host limit: ${operator.maxTotalAtomic}` : '' }),
        field('Daily cap · atomic units', 'dailyAtomic', { help: operator ? `Host limit: ${operator.maxDailyAtomic}` : '' })),
      el('div', { class: 'toolbar spaced' }, button('Review acquisition', async () => {
        const { choice: index, ...values } = draft, option = source.choices[index];
        review = await api('/api/review', { ...values, sourceId: source.id, rowIndex: option.rowIndex, acceptIndex: option.acceptIndex });
      }, { primary: true, disabled: !operator || Boolean(saved.active) })));
    if (choice.querySchema) selection.append(el('details', { class: 'spaced' }, text('summary', 'Merchant query schema'), text('pre', JSON.stringify(choice.querySchema, null, 2))));
    contents.push(selection);
  }
  if (review) contents.push(el('section', { class: 'card', id: 'reviewed-plan' }, text('h3', '3. Reviewed acquisition'),
    definition([['Source', review.sourceUrl], ['Session', review.name], ['Expected snapshot', review.expectedSnapshot ?? 'First native page fixes the edition'],
      ['Network / asset', review.terms.network + ' / ' + review.terms.asset], ['Payee', review.terms.payTo],
      ['Per-page cap', review.terms.maxAtomic + ' atomic units'], ['Total / daily caps', review.maxTotalAtomic + ' / ' + review.dailyAtomic + ' atomic units'],
      ['Page budget', `${review.pagesWithinTotalCap} of at most ${review.maxPages} pages fit the total cap`], ['Payer', review.operator.payer]]),
    el('div', { class: 'callout' }, text('p', 'Creating the acquisition retains these terms and limits. Each native page purchase is approved in the launching terminal.'),
      text('p', 'Page caps are allocations. Actual purchase outcomes remain in the original purchase records.', 'help')),
    button('Create acquisition', async () => { const result = await api('/api/prepare', { reviewId: review.reviewId }); await refresh(); await chooseSession(result.id); notice('Acquisition created. Review its first-page request, then continue when ready.'); }, { primary: true, disabled: Boolean(saved.active) })));
  $('#main').replaceChildren(...contents);
}
const pendingKey = () => 'dataset-pending-' + selectedId;
async function start(kind) {
  const request = { actionId: crypto.randomUUID(), session: selectedId, kind, expectedRevision: selected.revision,
    ...(kind === 'analysis' ? { alias } : {}) };
  sessionStorage.setItem(pendingKey(), JSON.stringify(request));
  await submit(request);
}
async function submit(request) {
  try { const result = await api('/api/start', request); sessionStorage.removeItem('dataset-pending-' + request.session); await refresh(); return result; }
  catch (error) { if (error.status) sessionStorage.removeItem('dataset-pending-' + request.session); throw error; }
}
function progress() {
  const report = selected.report ?? {}, next = report.nextPage;
  const content = card(text('h3', 'Acquisition progress'));
  if (report.totalRows !== null && report.totalRows !== undefined) content.append(el('progress', { max: Math.max(1, report.totalRows), value: report.acquiredRows ?? 0, 'aria-label': 'Rows acquired' }));
  content.append(definition([['Source query', selected.selection?.url], ['Original session', selected.sessionId], ['Snapshot', report.snapshot ?? report.expectedSnapshot ?? 'Fixed by the first native response'],
    ['Configuration SHA-256', report.configurationSha256 ?? 'Original session is in use'],
    ['Page limit', report.limits?.maxPages], ['Row limit', report.limits?.maxRows], ['Total cap', report.limits?.maxTotalAtomic === undefined ? '—' : report.limits.maxTotalAtomic + ' atomic units']]));
  if (next) content.append(text('h4', 'Next original page'), text('pre', JSON.stringify(next, null, 2)));
  if (report.stopReason || report.code) content.append(text('p', display(report.stopReason ?? report.code), 'callout'));
  content.append(text('p', report.paymentAccounting ?? 'Use purchase records for actual payment outcomes.', 'help'));
  const working = Boolean(saved.active), controls = el('div', { class: 'toolbar spaced' },
    button('Continue acquisition', () => start('run'), { primary: true, disabled: working || selected.status !== 'READY' || !selected.revision }),
    button('Recover interrupted session', () => start('recover'), { disabled: working || !selected.revision }),
    button(selected.delivery ? 'Reopen delivered data' : 'Finalize data room', () => start('deliver'), { disabled: working || selected.status !== 'COMPLETE' || !selected.revision }));
  if (saved.active?.session === selectedId && ['run', 'finalize'].includes(saved.active.kind)) controls.append(button('Stop after retained work', async () => { await api('/api/cancel', { id: saved.active.id }); await refresh(); }));
  content.append(controls);
  if (selected.status === 'READY') content.append(text('p', 'The original buyer requests per-page purchase approval in the terminal where this workspace was launched.', 'help'));
  if (selected.status === 'RUNNING') content.append(text('p', 'The original session has a lock. Native recovery removes it only when its same-host owner has exited.', 'help'));
  const rows = report.pages ?? [], slice = rows.slice(page * 25, (page + 1) * 25);
  const pages = card(text('h3', 'Retained native pages'), rows.length ? table(['Page', 'Rows', 'Original outcome', 'Response SHA-256'], slice.map(row => [
    row.index, count(row.returned), statusText(row.originalOutcome?.status ?? row.nativeBuyerStatus), text('code', row.sha256 ?? '—', 'break'),
  ])) : text('p', 'No completed native page is present yet.', 'muted'));
  if (rows.length) pages.append(el('div', { class: 'pager' }, button('Previous', () => { page--; }, { disabled: page === 0 }),
    text('span', `${page * 25 + 1}–${Math.min((page + 1) * 25, rows.length)} of ${rows.length}`), button('Next', () => { page++; }, { disabled: (page + 1) * 25 >= rows.length })));
  pages.append(el('details', { class: 'spaced' }, text('summary', 'Original acquisition report'), text('pre', JSON.stringify(report, null, 2))));
  return [content, pages];
}
async function download(name) {
  const value = await api('/api/download-ticket', { session: selectedId, name });
  const anchor = el('a', { href: value.url, download: name }); document.body.append(anchor); anchor.click(); anchor.remove();
}
async function loadPreview(offset = 0) { preview = await api(`/api/preview?session=${encodeURIComponent(selectedId)}&offset=${offset}&limit=50`); }
function delivered() {
  if (!selected.delivery) return [card(text('h3', 'Delivered data'), text('p', 'Complete the acquisition, then finalize its original data room to open the retained rows, files and analysis handoff.'))];
  const files = Object.entries(selected.delivery.files);
  const output = card(text('h3', 'Original delivered files'), text('p', 'Downloads use the retained SF100 file bytes. The purchase outcome is preserved separately.', 'help'),
    el('div', { class: 'file-list' }, files.map(([name, value]) => el('div', { class: 'file' }, text('strong', name), text('p', size(value.bytes)),
      text('code', value.sha256), button('Download', () => download(name))))));
  output.append(el('div', { class: 'toolbar spaced' }, button('Download acquisition manifest', async () => {
    const value = await api('/api/manifest?session=' + encodeURIComponent(selectedId));
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
    const anchor = el('a', { href: url, download: 'acquisition-manifest.json' }); document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, { disabled: Boolean(saved.active) })));
  const data = card(el('div', { class: 'heading' }, text('h3', 'Dataset rows'), button(preview ? 'Refresh rows' : 'Open rows', () => loadPreview(preview?.offset ?? 0))));
  if (preview) {
    const columns = [...new Set(preview.rows.flatMap(row => Object.keys(row)))];
    data.append(preview.rows.length ? table(columns, preview.rows.map(row => columns.map(key => display(row[key])))) : text('p', 'No more rows.', 'muted'));
    data.append(el('div', { class: 'pager' }, button('Previous', () => loadPreview(Math.max(0, preview.offset - 50)), { disabled: preview.offset === 0 }),
      text('span', `${count(preview.offset + (preview.rows.length ? 1 : 0))}–${count(preview.offset + preview.rows.length)}`),
      button('Next', () => loadPreview(preview.nextOffset), { disabled: preview.nextOffset === null })));
    data.append(text('p', 'JSON nulls, booleans and numeric types are retained in this view.', 'help'));
  } else data.append(text('p', 'Open a page of the actual retained dataset.', 'muted'));
  const analysis = card(text('h3', 'Use in analysis'), text('p', 'Open the original analysis workspace to import this completed data room, review editions and run saved SQL.'),
    el('div', { class: 'inline-control' }, el('label', { class: 'field' }, text('span', 'Analysis source name'), el('input', { value: alias, name: 'analysis-alias', disabled: busy, onInput: event => { alias = event.target.value; handoff = null; } })),
      button('Open analysis workspace', () => start('analysis'), { primary: true, disabled: !saved.analysis.configured || Boolean(saved.active) || !selected.revision }),
      button('Show source handoff', async () => { handoff = await api(`/api/handoff?session=${encodeURIComponent(selectedId)}&alias=${encodeURIComponent(alias)}`); }, { disabled: !saved.analysis.configured })));
  if (!saved.analysis.configured) analysis.append(text('p', 'Configure the original Python launcher on this host to enable the direct handoff. Your delivered files can be used immediately.', 'help'));
  if (saved.analysis.running && saved.analysis.sessionId === selected.sessionId && saved.analysis.url)
    analysis.append(el('p', {}, el('a', { href: saved.analysis.url, target: '_blank', rel: 'noopener noreferrer', class: 'link-button' }, 'Go to analysis workspace')));
  if (handoff) analysis.append(el('details', { open: '' }, text('summary', 'Original source registration'), text('pre', JSON.stringify(handoff, null, 2))));
  return [output, data, analysis];
}
async function loadPurchases(offset = 0) { purchases = await api(`/api/accounting?session=${encodeURIComponent(selectedId)}&offset=${offset}`); }
function accounting() {
  const result = card(el('div', { class: 'heading' }, el('div', {}, text('h3', 'Original purchase records'), text('p', 'Review retained attempts and continue their original accounting work.', 'help')),
    button('Read purchase records', () => loadPurchases(purchases?.range.offset ?? 0), { disabled: Boolean(saved.active) })),
    text('p', 'Reserved page caps do not establish a payment. These outcomes come from the original checkout and ledger.', 'callout'));
  if (purchases) {
    result.append(table(['Page', 'Outcome', 'Original intent', 'Detail'], purchases.entries.map(row => [row.index, statusText(row.outcome),
      text('code', row.intentId ?? '—', 'break'), row.code ?? row.viewStatus ?? '—'])));
    result.append(el('div', { class: 'pager' }, button('Previous', () => loadPurchases(Math.max(0, purchases.range.offset - 50)), { disabled: purchases.range.offset === 0 || Boolean(saved.active) }),
      text('span', `${purchases.range.offset + 1}–${purchases.range.offset + purchases.entries.length} of ${purchases.range.total}`),
      button('Next', () => loadPurchases(purchases.range.nextOffset), { disabled: purchases.range.nextOffset === null || Boolean(saved.active) })));
    result.append(el('details', { class: 'spaced' }, text('summary', 'Original purchase detail'), text('pre', JSON.stringify(purchases, null, 2))));
  }
  result.append(el('div', { class: 'toolbar spaced' }, button('Continue purchase finalization', () => start('finalize'), {
    disabled: Boolean(saved.active) || !selected.canFinalizePurchases || !selected.revision || selected.status === 'RUNNING' })),
    text('p', selected.canFinalizePurchases ? 'This continues existing native attempts. It does not create another page purchase.' : 'This attached session has no original operator workspace for purchase continuation.', 'help'));
  return [result];
}
function history() {
  const jobs = saved.jobs.filter(item => item.session === selectedId);
  const result = card(text('h3', 'Customer operation history'));
  let pending; try { pending = JSON.parse(sessionStorage.getItem(pendingKey()) || 'null'); } catch {}
  if (pending) result.append(el('div', { class: 'callout' }, text('p', 'The browser did not receive a reply for its last request. Reuse the same saved action ID to retrieve or continue that exact request.'),
    button('Retry saved request', () => submit(pending))));
  if (!jobs.length) result.append(text('p', 'No browser operation has been started for this acquisition.', 'muted'));
  for (const job of jobs) result.append(el('div', { class: 'operation' },
    el('div', { class: 'toolbar' }, text('strong', statusText(job.kind)), badge(job.status)),
    text('p', new Date(job.createdAt).toLocaleString(), 'muted'),
    job.error ? text('p', job.error.message, 'failure') : null,
    el('details', {}, text('summary', 'Operation detail'), text('pre', JSON.stringify(job, null, 2)))));
  return [result];
}
function renderSession() {
  if (!selected) { $('#main').replaceChildren(text('p', 'Reading the selected original acquisition…', 'empty')); return; }
  const heading = el('div', { class: 'heading' }, el('div', {}, text('h2', selected.label), text('p', selected.sessionId, 'muted break')),
    el('div', { class: 'toolbar' }, badge(saved.active?.session === selectedId ? 'RUNNING' : selected.status), button('Refresh', async () => { await refresh({ inspect: true }); })));
  const metrics = el('div', { class: 'metrics' }, [['Retained pages', count(selected.completedPages)], ['Acquired rows', count(selected.acquiredRows)],
    ['Data room', selected.delivery ? 'Available' : 'Not finalized'], ['Purchase status', selected.delivery?.paymentStatus ?? 'See records']]
    .map(([label, value]) => el('div', { class: 'metric' }, text('strong', statusText(value)), text('span', label))));
  const tabs = el('nav', { class: 'tabs', 'aria-label': 'Acquisition sections' }, [['progress', 'Progress'], ['data', 'Data & analysis'], ['purchases', 'Purchases'], ['history', 'History']]
    .map(([key, label]) => button(label, async () => { tab = key; if (key === 'data' && selected.delivery && !preview) await loadPreview(); if (key === 'purchases' && !purchases && !saved.active) await loadPurchases(); }, { class: key === tab ? 'selected' : '', 'aria-pressed': String(key === tab) })));
  const content = tab === 'progress' ? progress() : tab === 'data' ? delivered() : tab === 'purchases' ? accounting() : history();
  $('#main').replaceChildren(heading, metrics, tabs, ...content);
}
function render() {
  if (!saved) return;
  $('#receive-nav').disabled = busy;
  $('#sessions').replaceChildren(...saved.sessions.map(item => button('', () => chooseSession(item.id), {
    class: 'session-button' + (!receiving && item.id === selectedId ? ' selected' : ''),
    'aria-current': !receiving && item.id === selectedId ? 'page' : 'false',
  })).map((node, index) => { const item = saved.sessions[index]; node.append(text('strong', item.label), text('small', statusText(saved.active?.session === item.id ? 'RUNNING' : item.status))); return node; }));
  if (!saved.sessions.length) $('#sessions').append(text('p', 'No acquisitions yet.', 'muted'));
  if (receiving) renderReceiving(); else renderSession();
}
$('#receive-nav').addEventListener('click', () => execute(async () => { receiving = true; epoch++; }));
try { await refresh(); if (selectedId && saved.sessions.some(item => item.id === selectedId)) await chooseSession(selectedId); else receiving = true; render(); }
catch (error) { $('#connection').textContent = 'Workspace unavailable'; notice(error.message, true); }
let polling = false;
setInterval(async () => {
  if (busy || polling || !saved || !(saved.active || saved.analysis.working)) return;
  polling = true;
  try { await refresh(); render(); } catch (error) { notice(error.message, true); }
  finally { polling = false; }
}, 2000);
