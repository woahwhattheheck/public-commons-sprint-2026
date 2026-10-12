// MIT. Customer receiving uses the maintained browser's authenticated API.
export const panelTitle = 'Customer';
export const applyPlan = draft => draft;
const node = (tag, attributes = {}, ...children) => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('on')) element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'text') element.textContent = value;
    else if (key in element && !key.startsWith('aria')) element[key] = value;
    else element.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) if (child !== undefined && child !== null)
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return element;
};
const paragraph = (value, className = 'muted') => node('p', { text: value, className });
const date = value => value ? new Date(value).toLocaleString() : '—';
const number = value => Number(value).toLocaleString();
const stateName = value => ({
  PREPARING: 'Preparing backup', AWAITING_UPLOAD: 'Ready for archive',
  UPLOADING: 'Receiving archive', RECEIVING: 'Restoring workspace',
  READY: 'Ready', FAILED: 'Needs attention', INTERRUPTED: 'Interrupted',
}[value] ?? value);
function save(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = node('a', { href: url, download: filename });
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const saveJson = (value, filename) => save(new Blob([JSON.stringify(value, null, 2) + '\n'],
  { type: 'application/json' }), filename);

export function mountProfilePanel({ element, api, onOpenJob }) {
  if (!document.querySelector('link[data-customer-style]')) {
    document.head.append(node('link', { rel: 'stylesheet', href: '/customer-style.css', 'data-customer-style': '' }));
  }
  let info = null, jobs = [], jobCursor = '', transfers = [], busy = false, poll = null, currentDraft = null;
  let restoreSelection = null;
  const opened = new Map();
  const notice = node('p', { className: 'customer-notice', role: 'status', 'aria-live': 'polite',
    text: 'Opening customer history…' });
  const report = (message, error = false) => {
    notice.textContent = message; notice.classList.toggle('error', error);
  };
  const action = async operation => {
    if (busy) return;
    busy = true; element.setAttribute('aria-busy', 'true');
    const controls = [...element.querySelectorAll('button,input,select')].map(control => [control, control.disabled]);
    controls.forEach(([control]) => { control.disabled = true; });
    try { return await operation(); }
    catch (error) { report(error.message ?? 'The customer operation could not finish.', true); }
    finally {
      controls.forEach(([control, disabled]) => { if (control.isConnected) control.disabled = disabled; });
      busy = false; element.removeAttribute('aria-busy');
    }
  };
  const button = (label, operation, attributes = {}) => node('button', {
    type: 'button', text: label, onClick: () => action(operation), ...attributes,
  });
  const counts = node('div', { className: 'customer-counts' });
  const identity = node('div');
  const heading = node('h2', { text: 'Customer workspace' });
  const overview = node('section', { className: 'panel' },
    node('div', { className: 'section-heading' },
      node('div', {}, heading, paragraph('The complete working history, approved agent requests and customer receiving.')),
      button('Refresh customer', () => refresh(), { id: 'customerRefresh' })),
    counts, identity, notice);
  const rows = node('tbody', { id: 'customerRunRows' });
  const moreJobs = button('Load more retained runs', async () => { await loadJobs(true); },
    { id: 'customerMoreRuns', hidden: true });
  const history = node('section', { className: 'panel' },
    node('h2', { text: 'Retained runs and agent requests' }),
    paragraph('Open any original run for its comparison and business review. An agent request authorizes that exact retained job for the approved caller.'),
    node('div', { className: 'table-scroll' }, node('table', { className: 'customer-runs' },
      node('thead', {}, node('tr', {}, ['Run', 'Original result', 'Created', 'Actions']
        .map(label => node('th', { scope: 'col', text: label })))), rows)),
    moreJobs);
  const createBackup = button('Create complete backup', async () => {
    const id = crypto.randomUUID();
    const value = await api('/api/customer/backups', { id });
    report('Capturing the complete customer workspace. The saved transfer below will show when it is ready.');
    await loadTransfers(); schedulePoll();
    return value;
  }, { id: 'customerCreateBackup', className: 'primary' });
  const backup = node('section', { className: 'panel' },
    node('h2', { text: 'Complete customer backup' }),
    paragraph('Capture every retained export, mapping, engine snapshot, run, review and approved agent binding, together with the saved AGX identity and configuration.'),
    paragraph('Let active comparisons finish before capture. The backup and its original receipt remain available in transfer history.'),
    node('div', { className: 'actions' }, createBackup));

  const receivingName = node('input', { id: 'customerReceivingName', required: true, maxLength: 80,
    pattern: '[A-Za-z0-9][A-Za-z0-9._-]{0,79}', placeholder: 'finance-received', autocomplete: 'off' });
  const receivingFile = node('input', { id: 'customerReceivingFile', type: 'file', required: true,
    accept: '.zip,application/zip' });
  const receivingSha = node('input', { id: 'customerReceivingSha', maxLength: 64,
    pattern: '[a-f0-9]{64}', spellcheck: false, placeholder: 'Optional original backup SHA-256' });
  const fileNote = paragraph('Choose the complete customer ZIP saved in transfer history.');
  receivingFile.addEventListener('change', () => {
    const file = receivingFile.files[0];
    fileNote.textContent = file ? file.name + ' · ' + number(file.size) + ' bytes' : 'Choose the complete customer ZIP saved in transfer history.';
    restoreSelection = null;
  });
  receivingName.addEventListener('input', () => { restoreSelection = null; });
  receivingSha.addEventListener('input', () => { restoreSelection = null; });
  const receivingForm = node('form', { id: 'customerReceivingForm', onSubmit: event => {
    event.preventDefault();
    if (!receivingForm.reportValidity()) return;
    action(async () => {
      const file = receivingFile.files[0], destinationName = receivingName.value.trim(), sha256 = receivingSha.value.trim();
      if (!file?.size) throw new Error('Choose a complete customer backup ZIP.');
      if (!restoreSelection) {
        const planned = transfers.find(value => value.type === 'restore' &&
          value.state === 'AWAITING_UPLOAD' && value.destinationName === destinationName &&
          value.expectedBytes === file.size && (value.sha256 ?? '') === sha256);
        restoreSelection = { id: planned?.id ?? crypto.randomUUID(), destinationName, bytes: file.size, sha256 };
      }
      let transfer = await api('/api/customer/restores', restoreSelection);
      if (transfer.state === 'AWAITING_UPLOAD') {
        report('Receiving the complete archive into the new installation. Its original files are checked before the workspace opens.');
        transfer = await api('/api/customer/transfers/' + transfer.id + '/upload', file,
          { binary: true, timeoutMs: 600000 });
      }
      await loadTransfers(); schedulePoll();
      if (['FAILED', 'INTERRUPTED'].includes(transfer.state)) {
        report(transfer.error?.message ?? 'This receiving operation needs attention. Refresh its saved transfer to continue.', true);
        return;
      }
      report(transfer.state === 'READY' ? 'The original customer has been received. Open it from transfer history.'
        : 'The archive is saved. Full receiving is continuing in transfer history.');
    });
  } },
    node('div', { className: 'grid two' },
      node('label', {}, 'New installation name', receivingName),
      node('label', {}, 'Complete backup ZIP', receivingFile),
      node('label', { className: 'span-two' }, 'Original backup digest', receivingSha)),
    fileNote,
    node('button', { type: 'submit', id: 'customerReceive', className: 'primary', text: 'Receive customer workspace' }));
  const receiving = node('section', { className: 'panel' },
    node('h2', { text: 'Receive and reopen this customer' }),
    paragraph('Receive the complete backup into a new installation on this machine. Use the original digest from its receipt when available. The reopened workspace keeps the same customer, jobs, reports, reviews and agent requests.'),
    receivingForm);
  const transferList = node('div', { id: 'customerTransfers', className: 'customer-transfers' });
  const transferPanel = node('section', { className: 'panel' },
    node('div', { className: 'section-heading' }, node('h2', { text: 'Transfer history' }),
      button('Refresh transfers', async () => { await loadTransfers(); schedulePoll(); })),
    transferList);
  element.replaceChildren(overview, history, backup, receiving, transferPanel);

  async function loadInfo() {
    info = await api('/api/customer/info');
    heading.textContent = info.customer.name;
    counts.replaceChildren(...[
      ['Retained runs', info.counts.jobs], ['Input bundles', info.counts.bundles],
      ['Business reviews', info.counts.reviews], ['Agent requests', info.counts.agentRequests],
    ].map(([label, value]) => node('div', { className: 'customer-count' },
      node('small', { text: label }), node('strong', { text: number(value) }))));
    identity.replaceChildren(paragraph(info.profile.title),
      node('details', {}, node('summary', { text: 'Installation and agent connection' }),
        node('dl', { className: 'identity' },
          node('dt', { text: 'Customer identity' }), node('dd', { className: 'mono', text: info.customer.customerId }),
          node('dt', { text: 'Approved caller' }), node('dd', { className: 'mono', text: info.customer.peer }),
          node('dt', { text: 'Provider profile' }), node('dd', { text: info.customer.providerProfile }),
          node('dt', { text: 'Installed' }), node('dd', { text: date(info.customer.createdAt) }),
          node('dt', { text: 'Original service' }), node('dd', { className: 'mono', text: info.serviceDirectory })),
        paragraph('The customer operating guide explains the saved AGX identity, agreed relay and provider launch. Preparing a request below reuses the original job and comparison engine.')));
    if (!receivingName.value) {
      const slug = info.customer.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'finance';
      receivingName.value = slug + '-received-' + new Date().toISOString().slice(0, 10).replaceAll('-', '');
    }
  }
  async function loadJobs(append = false) {
    const value = await api('/api/jobs?limit=25&after=' + encodeURIComponent(append ? jobCursor : ''));
    jobs = append ? [...jobs, ...value.jobs] : value.jobs;
    jobCursor = value.nextCursor ?? '';
    rows.replaceChildren(...jobs.map(job => node('tr', {},
      node('td', {}, node('strong', { text: job.jobId }),
        paragraph(job.workspace?.cohort ?? job.workspace?.dataset ?? 'Original mapping')),
      node('td', { text: job.state + (job.result?.status ? ' · ' + job.result.status : '') }),
      node('td', { text: date(job.createdAt) }),
      node('td', {}, node('div', { className: 'actions' },
        button('Open run', () => onOpenJob(job.jobId), { 'aria-label': 'Open original run ' + job.jobId }),
        button('Prepare agent request', async () => {
          const result = await api('/api/customer/request', { jobId: job.jobId });
          saveJson(result.request, job.jobId + '.request.json');
          await loadInfo();
          report('The request for ' + job.jobId + ' is saved for the approved caller. Its original bundle and engine are retained.');
        }, { 'aria-label': 'Prepare agent request for ' + job.jobId }))))));
    if (!jobs.length) rows.append(node('tr', {}, node('td', { colSpan: 4 },
      paragraph('Staged inputs and completed runs appear here as work is saved.'))));
    moreJobs.hidden = !jobCursor;
  }
  function renderTransfers() {
    transferList.replaceChildren(...transfers.map(value => {
      const label = value.type === 'backup' ? 'Complete backup' : 'Customer receiving';
      const item = node('article', { className: 'customer-transfer', 'data-transfer-id': value.id },
        node('div', { className: 'section-heading' },
          node('div', {}, node('h3', { text: label + (value.destinationName ? ' · ' + value.destinationName : '') }),
            paragraph(date(value.createdAt))), node('span', { className: 'badge', text: value.recovering && ['FAILED', 'INTERRUPTED'].includes(value.state) ? 'Resuming transfer' : stateName(value.state) })));
      if (value.error) item.append(paragraph(value.error.message, 'customer-error'));
      if (value.type === 'restore' && value.state === 'AWAITING_UPLOAD')
        item.append(paragraph('Select the complete original ZIP, this installation name and its recorded digest in the receiving form. The saved upload plan will be reused.'));
      if (value.receipt) {
        const receipt = value.receipt;
        item.append(paragraph(number(receipt.files) + ' original files' +
          (receipt.sourceBytes !== undefined ? ' · ' + number(receipt.sourceBytes) + ' source bytes' : '') +
          (receipt.counts ? ' · ' + number(receipt.counts.jobs) + ' retained runs · ' + number(receipt.counts.reviews) + ' business reviews' : '')));
      }
      const actions = node('div', { className: 'actions' });
      if (value.type === 'backup' && value.state === 'READY') {
        actions.append(button('Download backup', async () => {
          const result = await api(value.download, undefined, { raw: true, timeoutMs: 600000 });
          if (result.headers.get('x-customer-archive-sha256') !== value.receipt.sha256)
            throw new Error('The download differs from the original backup receipt.');
          save(result.blob, value.filename);
          report('The complete customer backup is downloaded. Save its receipt with the archive for receiving.');
        }, { 'aria-label': 'Download backup ' + value.id }),
        button('Download receipt', () => saveJson(value.receipt, 'customer-' + value.id + '-receipt.json')));
        const digest = node('details', {}, node('summary', { text: 'Original backup identity' }),
          node('p', { className: 'mono', text: value.receipt.sha256 }));
        item.append(digest);
      }
      if (value.type === 'restore' && value.state === 'READY') {
        actions.append(button('Open restored workspace', async () => {
          const received = await api('/api/customer/transfers/' + value.id + '/open', {});
          const parsed = new URL(received.url);
          if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname))
            throw new Error('The received workspace returned an invalid local address.');
          opened.set(value.id, received.url); renderTransfers();
          report('The restored workspace is open on this machine. Use its private link below to review the original customer history.');
        }, { 'aria-label': 'Open restored workspace ' + value.destinationName }),
        button('Download receiving record', () => saveJson(value.receipt, 'receiving-' + value.id + '.json')));
        if (opened.has(value.id)) actions.append(node('a', { href: opened.get(value.id), target: '_blank',
          rel: 'noreferrer', text: 'Review restored customer', 'data-received-link': value.id }));
      }
      if (['FAILED', 'INTERRUPTED'].includes(value.state) && !value.recovering)
        actions.append(button('Continue saved transfer', async () => {
          await api('/api/customer/transfers/' + value.id + '/continue', {});
          await loadTransfers(); schedulePoll();
          report('Continuing the original saved transfer. Its result will appear here.');
        }));
      if (actions.childNodes.length) item.append(actions);
      item.append(node('details', {}, node('summary', { text: 'Transfer reference' }),
        node('p', { className: 'mono', text: value.id })));
      return item;
    }));
    if (!transfers.length) transferList.append(paragraph('Complete backups and customer receiving appear here. Refreshing this page reopens the saved transfers.'));
  }
  async function loadTransfers() {
    const result = await api('/api/customer/transfers');
    transfers = result.transfers; renderTransfers();
  }
  function schedulePoll() {
    clearTimeout(poll); poll = null;
    if (!transfers.some(value => (value.recovering || ['PREPARING', 'UPLOADING', 'RECEIVING'].includes(value.state)))) return;
    poll = setTimeout(async () => {
      if (busy) { schedulePoll(); return; }
      try {
        await loadTransfers();
        if (!transfers.some(value => (value.recovering || ['PREPARING', 'UPLOADING', 'RECEIVING'].includes(value.state))))
          report('The customer transfer has finished. Open its saved result in transfer history.');
      } catch (error) { report(error.message ?? 'Transfer status could not be refreshed.', true); }
      schedulePoll();
    }, 1500);
  }
  async function refresh() {
    await loadInfo(); await loadJobs(false); await loadTransfers(); schedulePoll();
    report('Customer history and saved transfers are current.');
  }
  void refresh().catch(error => report(error.message ?? 'The customer workspace could not open.', true));
  return { updateDraft(draft) { currentDraft = draft; }, currentPlan() { return null; } };
}
