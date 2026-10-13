import {mountCommercialChanges} from './operations_commercial_changes.mjs';
import {currentStaffContext,staffDeskStorageKey,assertStaffRequestActor} from './staff-session.mjs';
import {mountEarlierStaffDesk} from './staff-desk-recovery.mjs';
const DESK_SCHEMA='sf47.commercial-desk.v1';
const copy=value=>structuredClone(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const label = value => typeof value === 'string' ? value : value?.name || value?.displayName || value?.legalName || '';
const title = value => String(value || '').toLowerCase().replaceAll('_', ' ').replace(/^./, char => char.toUpperCase());
const text = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
const today = () => { const date = new Date(); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const date = value => value ? new Intl.DateTimeFormat(undefined, {dateStyle:'medium'}).format(new Date(String(value).slice(0, 10) + 'T12:00:00')) : 'Not recorded';
const timestamp = value => value ? new Intl.DateTimeFormat(undefined, {dateStyle:'medium', timeStyle:'short'}).format(new Date(value)) : '';
const amount = (value, currency) => value === undefined || value === null ? '—' : String(value) + (currency?.code ? ' ' + currency.code : '');
const enc = encodeURIComponent;

function download(blob, name) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function style() {
  if (document.querySelector('link[data-commercial-style]')) return;
  const link = document.createElement('link'); link.rel = 'stylesheet';
  link.href = '/operations_commercial.css'; link.dataset.commercialStyle = 'true';
  document.head.append(link);
}
export function mountCommercialReceivables({container,current,api,saveApi=api,session={},mutationId,recordingActor,onInstallations,onSources,staffContext=currentStaffContext()}) {
  const pinnedContext=staffContext?{...staffContext}:null;
  style();
  const root = document.createElement('section'); root.className = 'commercial-desk';
  root.setAttribute('aria-label', 'Customer milestone billing'); container.replaceChildren(root);
  const earlierKey='sf47.commercial.'+current.program.id;
  const key=staffDeskStorageKey(earlierKey,pinnedContext);
  if (!session.loaded) {
    try { Object.assign(session, JSON.parse(sessionStorage.getItem(key) || '{}')); } catch {}
    session.loaded = true;
  }
  session.inputs ||= {}; session.previews ||= {};session.pending??=null;session.lastRequest??=null;
  const state = {current, installations: [], endpoints: [], customers: [], billings: [], billing: null, schedule: session.schedule || null, busy: false, message: '', error: false};
  let active = true, hostBusy = false, changesDesk = null;
  const changesHost=document.createElement("div");container.append(changesHost);
  const path = '/api/operations/' + enc(current.program.id) + '/commercial';
  const visible = () => active && root.isConnected;
  const input = (name, fallback = '') => session.inputs[name] ?? fallback;
  const field = (name, caption, fallback = '', {type = 'text', required = false, options, multiple = false, area = false, help = ''} = {}) => {
    const value = input(name, fallback), attrs = ' name="' + esc(name) + '"' + (required ? ' required' : '');
    const selected = Array.isArray(value) ? value : [String(value)];
    let control;
    if (options) control = '<select' + attrs + (multiple ? ' multiple size="4"' : '') + '>' +
      (multiple ? '' : '<option value="">Choose…</option>') +
      options.map(([id, name]) => '<option value="' + esc(id) + '"' + (selected.includes(String(id)) ? ' selected' : '') + '>' + esc(name) + '</option>').join('') + '</select>';
    else if (area) control = '<textarea' + attrs + ' rows="3">' + esc(value) + '</textarea>';
    else control = '<input' + attrs + ' type="' + esc(type) + '" value="' + esc(value) + '">';
    return '<label class="commercial-field"><span>' + esc(caption) + '</span>' + control + (help ? '<small>' + esc(help) + '</small>' : '') + '</label>';
  };
  const button = (caption, action, extra = '', fixed = false) => '<button type="button" data-commercial-action="' + action + '" ' + extra + (fixed ? ' data-fixed="true" disabled' : '') + '>' + esc(caption) + '</button>';
  const empty = message => '<p class="commercial-empty">' + esc(message) + '</p>';
  function persist(critical=false) {
    try {const raw=JSON.stringify(session);sessionStorage.setItem(key,raw);if(sessionStorage.getItem(key)!==raw)throw new Error('The complete desk was not retained.');}
    catch(error){if(critical)throw new Error('Download the complete billing desk before closing it. Browser storage could not retain the original action: '+error.message);}
  }
  function capture() {
    root.querySelectorAll('[name]').forEach(element => {
      session.inputs[element.name] = element.multiple ? [...element.selectedOptions].map(option => option.value) :
        element.type === 'checkbox' ? element.checked : element.value;
    });
    persist();
  }
  function busy() {
    root.setAttribute('aria-busy', String(state.busy || hostBusy));
    root.querySelectorAll('button,input,select,textarea').forEach(element => {
      const recovery=['resume-original','download-desk','download-original'].includes(element.dataset.commercialAction);
      element.disabled = state.busy || hostBusy || element.dataset.fixed === 'true' || Boolean(session.pending&&!recovery);
    });
  }
  async function run(work) {
    if (!visible() || state.busy || hostBusy) return;
    capture(); state.busy = true; state.message = ''; state.error = false; busy();
    try { await work(); }
    catch (error) { state.message = error.message || 'The operation could not finish. Reopen the saved billing item and retry.'; state.error = true; }
    finally { state.busy = false; persist(); if (visible()) render(); }
  }
  function deskSnapshot(){return {schema:DESK_SCHEMA,caseId:current.program.id,session:copy(session)};}
  function downloadDesk(){capture();download(new Blob([JSON.stringify(deskSnapshot(),null,2)+'\n'],{type:'application/json'}),current.program.id+'-customer-billing-desk.json');}
  function validOperation(value){
    if(!value||typeof value!=='object'||!value.body||typeof value.body!=='object'||typeof value.body.actor!=='string')
      throw new Error('Retain the complete original customer billing action.');
    const expected=value.kind==='connect'?'/api/operations/commercial-connections':
      value.kind==='prepare'?path+'/prepare':value.kind==='milestone'&&typeof value.billingId==='string'
      &&typeof value.milestoneId==='string'&&['draft','issue'].includes(value.action)?
      path+'/'+enc(value.billingId)+'/milestones/'+enc(value.milestoneId)+'/'+value.action:null;
    if(!expected||value.endpoint!==expected)throw new Error('The retained action must use this case’s original customer billing path.');
    assertStaffRequestActor(value.body,pinnedContext);return value;
  }
  async function sendOriginal(operation=null){
    if(operation){
      if(session.pending)throw new Error('Resume the retained original action before preparing another.');
      validOperation(operation);
      session.pending={...copy(operation),preparedAt:new Date().toISOString(),error:null};
    }
    const original=session.pending;if(!original)throw new Error('There is no retained customer billing action to resume.');
    validOperation(original);persist(true);
    try{
      const result=await saveApi(original.endpoint,copy(original.body));
      session.lastRequest={...copy(original),result:copy(result),receivedAt:new Date().toISOString()};
      session.pending=null;persist();return result;
    }catch(error){
      original.error={message:error.message||String(error),status:error.status||null,code:error.code||null};
      if([400,409,413,415,422].includes(error.status)&&error.code!=='REQUEST_CONFLICT'){
        session.lastRequest=copy(original);session.pending=null;
      }
      persist();throw error;
    }
  }
  async function resumeOriginal(){
    const original=copy(session.pending);const result=await sendOriginal();
    if(original.kind==='connect'){
      session.inputs['prepare.endpointId']=result.id;session.inputs['prepare.customerId']='';
      await refreshLists();await readCustomers(result.id);
    }else{
      const id=original.kind==='prepare'?result.id:original.billingId;
      session.billingId=id;session.inputs['billing.selected']=id;session.previews={};
      await refreshLists();await loadBilling(id);
    }
    state.message='Received the retained original customer billing action and reopened its saved records.';
  }
  async function openDesk(value){
    if(!visible())return;
    const object=item=>item!==null&&typeof item==='object'&&!Array.isArray(item);
    if(!object(value)||value.schema!==DESK_SCHEMA||value.caseId!==current.program.id
      ||!object(value.session)||!object(value.session.inputs)||!object(value.session.previews))
      throw new Error('Open this original case’s complete customer billing desk.');
    const received=copy(value.session);
    if(received.pending)validOperation(received.pending);
    if(session.pending)throw new Error('Resume the current original action before opening another billing desk. Its complete download remains available.');
    downloadDesk();
    for(const name of Object.keys(session))delete session[name];Object.assign(session,received);
    session.loaded=true;session.pending??=null;session.lastRequest??=null;
    state.schedule=session.schedule||null;state.billing=null;render();persist(true);
    await refreshLists();if(session.billingId)await loadBilling(session.billingId);
    state.message='Opened the complete original customer billing editor and its retained action.';render();
  }
  async function openDeskFile(file){
    if(!file)return;if(file.size>32*1024*1024)throw new Error('Open a complete customer billing desk within 32 MiB.');
    const raw=await file.text();if(!visible())return;await openDesk(JSON.parse(raw));
  }
  function recoveryPanel(){
    return '<section class="commercial-card"><h3>Complete billing desk</h3><p>Keep the original selections, entered milestone fields and prepared customer action together.</p>'+
      '<div class="commercial-actions">'+button('Download complete billing desk','download-desk')+button('Open complete billing desk','open-desk')+
      (session.pending||session.lastRequest?button('Download original action','download-original'):'')+'</div><input type="file" data-commercial-desk-file accept=".json,application/json" hidden>'+
      (session.pending?'<h4>Original action retained</h4><p>'+esc(session.pending.error?.message||'Resume the same original customer action to receive its saved result.')+'</p>'+
      button('Resume original action','resume-original'):'')+'</section>';
  }
  async function retainedRequest(scope, body) {
    body.requestId = await mutationId('commercial:' + current.program.id + ':' + scope, body);
    return body;
  }
  async function readCustomers(endpointId) {
    state.customers = endpointId ? (await api('/api/operations/commercial-connections/' + enc(endpointId) + '/customers')).customers : [];
  }
  async function loadBilling(id) {
    session.billingId = id; session.inputs['billing.selected'] = id || '';
    state.billing = id ? await api(path + '/' + enc(id)) : null;
    persist();
  }
  async function refreshLists() {
    const results = await Promise.all([
      api('/api/operations/' + enc(current.program.id)),
      api('/api/operations/' + enc(current.program.id) + '/installations'),
      api('/api/operations/commercial-connections'),
      api(path),
    ]);
    state.current = results[0]; state.installations = results[1].installations || [];
    state.endpoints = results[2].endpoints || []; state.billings = results[3].items || [];
    const wanted = state.billings.find(row => row.id === session.billingId)?.id || state.billings[0]?.id;
    await loadBilling(wanted);
    const endpointId = input('prepare.endpointId') || state.endpoints[0]?.id;
    if (endpointId) { session.inputs['prepare.endpointId'] = endpointId; await readCustomers(endpointId); }
  }
  function connectionForm() {
    return '<details class="commercial-connection"' + (!state.endpoints.length ? ' open' : '') + '><summary>Accounting connection</summary>' +
      '<p>Start the original customer receivables server, then connect its local API address.</p>' +
      '<form data-commercial-form="connect"><div class="commercial-grid">' +
      field('connect.id', 'Connection name', 'customer-accounting', {required: true}) +
      field('connect.label', 'Display label', 'Customer accounting', {required: true}) +
      field('connect.baseUrl', 'Local receivables API address', 'http://127.0.0.1:8448/api/receivables', {type: 'url', required: true}) +
      '</div><button type="submit">Connect accounting</button></form></details>';
  }
  function sourceForm() {
    return '<section class="commercial-card"><h3>Prepare milestone billing</h3>' +
      '<p>Select the saved customer installation whose original Workshare contains the commercial agreement.</p>' +
      (state.installations.length ? '<form data-commercial-form="schedule"><div class="commercial-grid">' +
        field('schedule.installationId', 'Saved customer installation', state.installations[0]?.id, {required: true,
          options: state.installations.map(row => [row.id, row.name + ' · edition ' + row.revision])}) +
        field('schedule.scale', 'Currency decimal places', '2', {required: true,
          options: Array.from({length: 7}, (_, index) => [String(index), String(index)]),
          help: 'Use the precision of the original commercial currency. Amounts must fit exactly.'}) +
        '</div><button type="submit">Load commercial terms</button></form>' : empty('Save a Workshare customer installation before preparing its billing.')) +
      '<div class="commercial-actions">' + button('Customer installations', 'installations') + button('Original sources', 'sources') + '</div></section>';
  }
  function milestoneSelection(row, schedule) {
    const prefix = 'milestone.' + row.milestoneId + '.';
    const basis = input(prefix + 'billingBasis', 'PHASE_ACCEPTANCE');
    const checks = schedule.phaseChecks || [];
    return '<fieldset class="commercial-milestone"><legend>' + esc(row.label) + ' · ' + esc(amount(row.amount, schedule.currency)) + '</legend>' +
      '<p class="commercial-terms">' + esc(text(row.trigger)) + '</p><div class="commercial-grid">' +
      field(prefix + 'issueDate', 'Invoice date', today(), {type: 'date', required: true}) +
      field(prefix + 'dueDate', 'Payment due date', '', {type: 'date', required: true}) +
      field(prefix + 'billingBasis', 'Billing basis', 'PHASE_ACCEPTANCE', {required: true, options: [
        ['PHASE_ACCEPTANCE', 'Accepted delivery checks'], ['COMMERCIAL_AUTHORIZATION', 'Commercial authorization'],
      ]}) + '</div>' +
      (basis === 'PHASE_ACCEPTANCE' ?
        field(prefix + 'requiredCheckIds', 'Delivery checks required for this milestone', [], {multiple: true,
          options: checks.map(check => [check.checkId, (check.title || check.checkId) + ' · ' + title(check.state)]),
          help: 'Select the checks that satisfy the original milestone trigger. Their recorded acceptance is reviewed before issue.'}) :
        '<div class="commercial-grid">' +
        field(prefix + 'authorizationSourceIds', 'Commercial authorization sources', [], {multiple: true,
          options: (state.current.sources || []).map(source => [source.id, source.filename])}) +
        field(prefix + 'authorizationNote', 'Authorization and relation to the original terms', '', {required: true, area: true}) + '</div>') +
      '</fieldset>';
  }
  function prepareForm() {
    const schedule = state.schedule;
    if (!schedule) return '';
    return '<section class="commercial-card"><h3>Review the commercial schedule</h3>' +
      '<dl class="commercial-summary"><div><dt>Original customer</dt><dd>' + esc(label(schedule.customer)) + '</dd></div>' +
      '<div><dt>Agreement amount</dt><dd>' + esc(amount(schedule.amount, schedule.currency)) + '</dd></div>' +
      '<div><dt>Milestones</dt><dd>' + schedule.milestones.length + '</dd></div></dl>' +
      '<form data-commercial-form="prepare"><div class="commercial-grid">' +
      field('prepare.endpointId', 'Accounting connection', state.endpoints[0]?.id || '', {required: true, options: state.endpoints.map(row => [row.id, row.label])}) +
      field('prepare.customerId', 'Invoice customer', '', {required: true, options: state.customers.map(row => [row.id, row.name]),
        help: 'Choose the customer already retained in the original accounting workspace.'}) +
      field('prepare.purchaseOrder', 'Purchase order', '') + '</div>' +
      schedule.milestones.map(row => milestoneSelection(row, schedule)).join('') +
      field('prepare.note', 'Invoice note', '', {area: true}) +
      '<button type="submit"' + (!state.endpoints.length ? ' data-fixed="true" disabled' : '') + '>Save reviewed billing schedule</button></form></section>';
  }
  function invoicePreview(preview, milestoneId) {
    const document = preview?.nativePreview?.document;
    if (!document) return '';
    const lines = document.lines || [], eligibility = preview.eligibility || {};
    return '<section class="commercial-preview"><h4>Invoice preview</h4>' +
      '<dl class="commercial-summary"><div><dt>From</dt><dd>' + esc(label(document.issuer)) + '</dd></div>' +
      '<div><dt>Bill to</dt><dd>' + esc(label(document.customer)) + '</dd></div>' +
      '<div><dt>Invoice date</dt><dd>' + esc(date(document.issueDate)) + '</dd></div>' +
      '<div><dt>Due</dt><dd>' + esc(date(document.dueDate)) + '</dd></div></dl>' +
      '<div class="commercial-table-scroll"><table><thead><tr><th>Description</th><th>Quantity</th><th>Unit amount</th><th>Total</th></tr></thead><tbody>' +
      lines.map(line => '<tr><td>' + esc(line.description) + '</td><td>' + esc(line.quantity) + '</td><td>' + esc(amount(line.unitAmount, document.currency)) +
        '</td><td>' + esc(amount(line.total, document.currency)) + '</td></tr>').join('') +
      '</tbody></table></div><p class="commercial-total">Invoice total ' + esc(amount(document.totals?.total, document.currency)) + '</p>' +
      (document.purchaseOrder ? '<p>Purchase order ' + esc(document.purchaseOrder) + '</p>' : '') +
      (document.note ? '<p class="commercial-terms">' + esc(document.note) + '</p>' : '') +
      '<section class="commercial-authorization"><h4>Billing authorization</h4><p>' + esc(title(eligibility.billingBasis)) + '</p>' +
      ((eligibility.checks || []).length ? '<ul>' + eligibility.checks.map(check => '<li>' + esc(check.title || check.id) + ' · ' + esc(title(check.state)) + '</li>').join('') + '</ul>' : '') +
      (eligibility.authorizationNote ? '<p class="commercial-terms">' + esc(eligibility.authorizationNote) + '</p>' : '') +
      (eligibility.message ? '<p>' + esc(eligibility.message) + '</p>' : '') +
      (!eligibility.ready ? '<p>Complete the selected delivery checks before issuing this milestone.</p>' : '') + '</section>' +
      '<div class="commercial-actions">' + button(preview.retainedIntent ? 'Resume original issue' : 'Confirm and issue invoice', 'issue', 'data-milestone="' + esc(milestoneId) + '"', !eligibility.ready && !preview.retainedIntent) +
      button('Close preview', 'close-preview', 'data-milestone="' + esc(milestoneId) + '"') + '</div></section>';
  }
  function retainedBilling() {
    const billing = state.billing;
    return '<section class="commercial-card"><div class="commercial-heading"><h3>Saved customer billing</h3>' +
      '<div class="commercial-actions">' + button('Refresh invoices and payments', 'refresh', '', !billing) +
      button('Export customer billing', 'export', '', !billing) + button('Review preparation', 'revise', '', !billing) + '</div></div>' +
      (state.billings.length ? field('billing.selected', 'Saved billing schedule', session.billingId, {options: state.billings.map(row =>
        [row.id, row.name || row.customerName || label(row.schedule?.customer) || 'Commercial billing · ' + (row.createdAt ? date(row.createdAt) : row.id.slice(-8))])}) :
        empty('Reviewed billing schedules appear here after saving.')) +
      (!billing ? '' : '<div class="commercial-saved">' +
        '<p>' + esc(label(billing.schedule?.customer || billing.customer)) + ' · ' + esc(amount(billing.schedule?.amount, billing.schedule?.currency)) + '</p>' +
        (billing.milestones || []).map(milestone => {
          const source = billing.schedule?.milestones?.find(row => row.milestoneId === milestone.milestoneId) || milestone;
          const detail = milestone.nativeDetail || milestone.detail || milestone.native || {};
          const invoice = detail.invoice || milestone.invoice || {};
          const issued = invoice.status === 'ISSUED' || invoice.status === 'VOID';
          const preview = session.previews[milestone.milestoneId];
          return '<article class="commercial-saved-milestone"><div class="commercial-heading"><div><h4>' + esc(source.label) + '</h4>' +
            '<p>' + esc(amount(source.amount, billing.schedule?.currency)) + ' · ' + esc(title(invoice.paymentStatus || invoice.status || milestone.state || 'Prepared')) +
            (invoice.number ? ' · ' + esc(invoice.number) : '') + '</p></div>' +
            '<div class="commercial-actions">' + button('Review milestone changes', 'changes', 'data-milestone="' + esc(milestone.milestoneId) + '"', !milestone.invoiceId) + (milestone.issueIntent?.state === 'PENDING' ? button('Recover invoice issue', 'recover-issue', 'data-milestone="' + esc(milestone.milestoneId) + '"') : '') + (!issued ? button(milestone.draftIntent?.state === 'PENDING' ? 'Recover original draft' : 'Create or reopen draft', 'draft', 'data-milestone="' + esc(milestone.milestoneId) + '"', Boolean(milestone.superseded)) +
              button('Review invoice', 'preview', 'data-milestone="' + esc(milestone.milestoneId) + '"', !milestone.invoiceId || milestone.superseded) : '') + '</div></div>' +
            (invoice.amountDue !== undefined ? '<dl class="commercial-summary"><div><dt>Amount due</dt><dd>' + esc(amount(invoice.amountDue, invoice.currency || billing.schedule?.currency)) +
              '</dd></div><div><dt>Paid</dt><dd>' + esc(amount(invoice.paid, invoice.currency || billing.schedule?.currency)) +
              '</dd></div><div><dt>Credited</dt><dd>' + esc(amount(invoice.credited, invoice.currency || billing.schedule?.currency)) + '</dd></div></dl>' : '') +
            (milestone.lastRefreshAt ? '<p class="commercial-refreshed">Status refreshed ' + esc(timestamp(milestone.lastRefreshAt)) + '</p>' : '') +
            (milestone.eligibility?.message ? '<p>' + esc(milestone.eligibility.message) + '</p>' : '') +
            (milestone.superseded ? '<p>This preparation has been replaced for this milestone. Open its current saved billing schedule.</p>' : '') +
            (!issued && !milestone.superseded ? invoicePreview(preview, milestone.milestoneId) : '') + '</article>';
        }).join('') + '</div>') + '</section>';
  }
  function render() {
    if (!visible()) return;
    root.innerHTML = '<header class="commercial-heading"><div><h2>Customer milestone billing</h2>' +
      '<p>Carry the original commercial milestones into customer invoices and follow their payment status.</p></div>' +
      button('Reload saved records', 'reload') + '</header><p class="commercial-message" role="' + (state.error ? 'alert' : 'status') +
      '" aria-live="polite">' + esc(state.message) + '</p>' + recoveryPanel() + retainedBilling() + sourceForm() + prepareForm() + connectionForm();
    busy();
  }
  root.addEventListener('input', capture);
  root.addEventListener('change', event => {
    if(event.target.matches('[data-commercial-desk-file]')){const file=event.target.files?.[0];event.target.value='';run(()=>openDeskFile(file));return;}
    capture();
    if (event.target.name === 'prepare.endpointId') run(async () => {
      session.inputs['prepare.customerId'] = ''; await readCustomers(input('prepare.endpointId'));
    });
    else if (event.target.name === 'billing.selected') run(async () => {
      await loadBilling(event.target.value);
    });
    else if (event.target.name?.endsWith('.billingBasis')) render();
  });
  root.addEventListener('submit', event => {
    const form = event.target.closest('[data-commercial-form]');
    if (!form) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    run(async () => {
      const kind = form.dataset.commercialForm;
      if (kind === 'connect') {
        const body = await retainedRequest('connect', {id: input('connect.id'), label: input('connect.label'),
          baseUrl: input('connect.baseUrl'), actor: recordingActor()});
        const result = await sendOriginal({endpoint:'/api/operations/commercial-connections',body,kind:'connect'});
        session.inputs['prepare.endpointId'] = result.id; session.inputs['prepare.customerId'] = '';
        state.endpoints = (await api('/api/operations/commercial-connections')).endpoints;
        await readCustomers(result.id); state.message = 'Connected to the original customer accounting workspace.';
      } else if (kind === 'schedule') {
        state.current = await api('/api/operations/' + enc(current.program.id));
        const installation = state.installations.find(row => row.id === input('schedule.installationId'));
        if (!installation) throw new Error('Choose a saved customer installation.');
        state.schedule = await saveApi(path + '/schedule', {
          expectedVersion: state.current.program.version, installationId: installation.id,
          installationRevision: installation.revision, expectedInstallationSha256: installation.sha256,
          currencyScale: Number(input('schedule.scale', '2')),
        });
        session.schedule = state.schedule; state.message = 'Loaded the original commercial schedule. Review the invoice customer, dates and milestone triggers.';
      } else if (kind === 'prepare') {
        const schedule = state.schedule;
        const milestones = schedule.milestones.map(row => {
          const prefix = 'milestone.' + row.milestoneId + '.', billingBasis = input(prefix + 'billingBasis', 'PHASE_ACCEPTANCE');
          return {milestoneId: row.milestoneId, issueDate: input(prefix + 'issueDate', today()),
            dueDate: input(prefix + 'dueDate'), billingBasis,
            requiredCheckIds: billingBasis === 'PHASE_ACCEPTANCE' ? input(prefix + 'requiredCheckIds', []) : [],
            authorizationSourceIds: billingBasis === 'COMMERCIAL_AUTHORIZATION' ? input(prefix + 'authorizationSourceIds', []) : [],
            authorizationNote: billingBasis === 'COMMERCIAL_AUTHORIZATION' ? input(prefix + 'authorizationNote') : ''};
        });
        const body = await retainedRequest('prepare', {
          expectedVersion: schedule.expectedVersion, installationId: schedule.installation.id,
          installationRevision: schedule.installation.revision, expectedInstallationSha256: schedule.installation.sha256,
          currencyScale: schedule.currency.scale, expectedScheduleSha256: schedule.scheduleSha256,
          endpointId: input('prepare.endpointId'), customerId: input('prepare.customerId'),
          milestones, purchaseOrder: input('prepare.purchaseOrder'), note: input('prepare.note'), actor: recordingActor(),
        });
        const result = await sendOriginal({endpoint:path+'/prepare',body,kind:'prepare'});
        session.billingId = result.id; session.inputs['billing.selected'] = result.id; session.previews = {};
        state.billings = (await api(path)).items; await loadBilling(result.id);
        state.message = 'Saved the reviewed commercial schedule. Its milestones are ready for invoice preparation.';
      }
    });
  });
  root.addEventListener('click', event => {
    const target = event.target.closest('[data-commercial-action]');
    if (!target||target.disabled) return;
    const action = target.dataset.commercialAction;
    if(action==='download-desk'){downloadDesk();return;}
    if(action==='download-original'){download(new Blob([JSON.stringify(session.pending||session.lastRequest,null,2)+'\n'],{type:'application/json'}),'customer-billing-original-action.json');return;}
    if(action==='open-desk'){if(!state.busy&&!hostBusy&&!session.pending)root.querySelector('[data-commercial-desk-file]').click();return;}
    if (action === 'installations') { capture(); onInstallations?.(); return; }
    if (action === 'sources') { capture(); onSources?.(); return; }
    if (action === 'changes') {
      capture();
      const milestone=state.billing?.milestones.find(row=>row.milestoneId===target.dataset.milestone);
      if(!milestone||session.pending)return;
      changesDesk?.dispose();root.hidden=true;
      const closeChanges=()=>{changesDesk?.dispose();changesDesk=null;root.hidden=false;run(()=>refreshLists());};
      changesDesk=mountCommercialChanges({container:changesHost,current:state.current,billing:state.billing,milestone,
        api,saveApi,mutationId,recordingActor,staffContext:pinnedContext,onClose:closeChanges,
        onSources:()=>{changesDesk?.dispose();changesDesk=null;root.hidden=false;onSources?.();}});
      changesDesk.ready.catch(error=>{state.message=error.message;state.error=true;});
      return;
    }
    run(async () => {
      if(action==='resume-original'){await resumeOriginal();return;}
      if (action === 'reload') { await refreshLists(); state.message = 'Loaded the saved commercial records.'; return; }
      if (!state.billing) throw new Error('Open a saved billing schedule.');
      const selected = path + '/' + enc(state.billing.id), milestoneId = target.dataset.milestone;
      if (action === 'revise') {
        const billing = state.billing, original = billing.schedule;
        state.current = await api('/api/operations/' + enc(current.program.id));
        state.schedule = await saveApi(path + '/schedule', {
          expectedVersion: state.current.program.version, installationId: original.installation.id,
          installationRevision: original.installation.revision, expectedInstallationSha256: original.installation.sha256,
          currencyScale: original.currency.scale,
        });
        session.schedule = state.schedule;
        Object.assign(session.inputs, {
          'schedule.installationId': original.installation.id, 'schedule.scale': String(original.currency.scale),
          'prepare.endpointId': billing.endpointId, 'prepare.customerId': billing.customerId,
          'prepare.purchaseOrder': billing.purchaseOrder || '', 'prepare.note': billing.note || '',
        });
        for (const milestone of billing.milestones) {
          const prefix = 'milestone.' + milestone.milestoneId + '.';
          for (const name of ['issueDate','dueDate','billingBasis','requiredCheckIds','authorizationSourceIds','authorizationNote'])
            session.inputs[prefix + name] = milestone[name];
        }
        await readCustomers(billing.endpointId);
        state.message = 'Loaded the original preparation. Correct milestones that have no retained invoice operation, then save the revised schedule.';
        return;
      }
      if (action === 'refresh') {
        await saveApi(selected + '/refresh', {}); await loadBilling(state.billing.id);
        state.message = 'Updated the original invoice and payment status.'; return;
      }
      if (action === 'export') {
        const response = await api(selected + '/export.zip', undefined, {download: true});
        download(await response.blob(), 'customer-billing-' + state.billing.id + '.zip');
        state.message = 'Exported the commercial sources, retained billing selections and original customer account.'; return;
      }
      if (action === 'close-preview') { delete session.previews[milestoneId]; return; }
      const body = {actor: recordingActor()};
      if (action === 'issue') {
        const preview = session.previews[milestoneId];
        if (!preview?.issuePreviewSha256) throw new Error('Review the current invoice before issuing it.');
        body.expectedIssuePreviewSha256 = preview.issuePreviewSha256;
      }
      const nativeAction = action === 'recover-issue' ? 'issue' : action;
      const endpoint=selected+'/milestones/'+enc(milestoneId)+'/'+nativeAction;
      const result = nativeAction==='preview'?await saveApi(endpoint,body):await sendOriginal({endpoint,body,kind:'milestone',billingId:state.billing.id,milestoneId,action:nativeAction});
      if (action === 'preview') {
        session.previews[milestoneId] = result; state.message = 'Review the customer, dates, line amount and original authorization, then confirm issue.';
      } else {
        delete session.previews[milestoneId]; await loadBilling(state.billing.id);
        state.message = nativeAction === 'issue' ? 'Saved the original customer invoice issue result.' : 'Opened the retained milestone invoice draft.';
      }
    });
  });
  const earlier=mountEarlierStaffDesk({root,staffContext:pinnedContext,title:'Customer billing',
    readCopy:()=>{const raw=sessionStorage.getItem(earlierKey);return raw?{schema:DESK_SCHEMA,caseId:current.program.id,session:JSON.parse(raw)}:null;},
    isBusy:()=>state.busy||hostBusy,setDeskBusy:value=>{state.busy=value;if(value)busy();else render();},
    describeCopy:value=>Object.keys(value.session.inputs||{}).length+' retained billing fields'+(value.session.pending?' · original customer action pending':''),
    filename:current.program.id+'-earlier-customer-billing-desk.json',openCopy:openDesk
  });
  render();
  const ready = (async () => { state.busy = true; busy(); try { await refreshLists(); } finally { state.busy = false; if (visible()) render(); } })();
  return {ready, setHostBusy(value) { hostBusy = Boolean(value);changesDesk?.setHostBusy(value); if (visible()) busy(); },
    dispose() { changesDesk?.dispose();changesHost.remove();earlier.dispose();capture(); active = false; }};
}
