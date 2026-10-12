// MIT. Collections casework in the original receivables browser and pending-request queue.
const e = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label = value => String(value ?? '').replaceAll('_',' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
const button = (text, action, id = '', extra = '') => '<button type="button" data-action="collection-' +
  e(action) + '" data-id="' + e(id) + '" ' + extra + '>' + e(text) + '</button>';
const input = (title, name, value = '', extra = '') => '<label>' + e(title) + '<input name="' + e(name) +
  '" value="' + e(value) + '" ' + extra + '></label>';
const select = (title, name, values, selected) => '<label>' + e(title) + '<select name="' + e(name) + '">' +
  values.map(value => '<option value="' + e(value) + '"' + (value === selected ? ' selected' : '') + '>' +
    e(label(value)) + '</option>').join('') + '</select></label>';
const methods = new Set(['saveCollectionCase','recordCollectionActivity','closeCollectionCase','reopenCollectionCase']);

export function createCollectionsUi(host) {
  const {api, openDialog, mutate, getState, saveBlob, setBusy, showError} = host;
  let list = {cases:[],unassigned:[],totals:[]}, selected = null, readVersion = 0, listError = '';
  let draft = host.readSession('collectionsDraft'), status = 'ALL', owner = '';
  const asOf = () => host.getAsOf();
  const query = () => ({asOf:asOf(), customerId:host.getCustomer() || undefined});
  const exportQuery = () => ({...query(), owner:owner || undefined, status, search:host.getSearch() || undefined});
  const format = row => e(row.currency.code) + ' ' + e(row.invoice?.amountDue ?? row.amountDue);
  const actions = title => '<div class="dialog-actions"><button type="button" data-action="close-dialog">Close</button>' +
    '<button type="submit" class="primary" data-write>' + e(title) + '</button></div>';
  function remember(form) {
    if (!form?.matches('#collection-case-form,#collection-activity-form,#collection-transition-form')) return;
    draft = {formId:form.id, caseId:form.dataset.id, kind:form.dataset.kind, workspaceId:form.dataset.workspace,
      expectedVersion:Number(form.dataset.version || 0), values:Object.fromEntries(new FormData(form))};
    host.saveSession('collectionsDraft',draft);
  }
  async function loadList() {
    const version = ++readVersion;
    try {
      const result = await api.collectionCases(query());
      if (version !== readVersion) return;
      list = result; listError = '';
    } catch(error) {
      if (version === readVersion) { listError = error.message; list = {cases:[],unassigned:[],totals:[]}; }
    }
  }
  function filtered() {
    const search = String(host.getSearch() || '').trim().toLowerCase();
    return list.cases.filter(row => (status === 'ALL' || row.status === status) && (!owner || row.owner === owner) &&
      (!search || [row.id,row.title,row.owner,row.invoice.number,row.invoice.customerName].some(value => String(value || '').toLowerCase().includes(search))));
  }
  function render() {
    const rows = filtered(), owners = [...new Set(list.cases.map(row => row.owner))].sort();
    const totals = new Map();
    for (const row of rows) if (row.status === 'OPEN') {
      const key = row.currency.code + ':' + row.currency.scale;
      if (!totals.has(key)) totals.set(key,{currency:row.currency,cases:0,followUpsDue:0,units:0n});
      const group = totals.get(key); group.cases++; group.followUpsDue += Number(row.followUpDue);
      group.units += host.units(row.invoice.amountDue,row.currency);
    }
    const search = String(host.getSearch() || '').trim().toLowerCase();
    const unassigned = owner ? [] : list.unassigned.filter(row => !search || [row.number,row.customerName].some(value => String(value || '').toLowerCase().includes(search)));
    return '<section class="panel"><div class="panel-head"><div><h2>Collections workbench</h2><p class="small-text muted">Assign follow-ups, retain conversations, and resolve invoice questions against the original account balance.</p></div><div class="row">' +
      button('New case','new','','data-write') + button('Download CSV','export','','data-name="collections.csv"') +
      button('Download JSON','export','','data-name="collections.json"') + '</div></div>' +
      '<div class="panel-body"><div class="form-grid"><label>Case status<select data-collections-filter="status">' +
      ['ALL','OPEN','CLOSED','FUTURE'].map(value => '<option value="' + value + '"' + (status === value ? ' selected' : '') + '>' + label(value) + '</option>').join('') +
      '</select></label><label>Assigned owner<select data-collections-filter="owner"><option value="">All owners</option>' +
      owners.map(value => '<option value="' + e(value) + '"' + (owner === value ? ' selected' : '') + '>' + e(value) + '</option>').join('') +
      '</select></label></div>' + (listError ? '<p class="notice error">' + e(listError) + '</p>' : '') +
      [...totals.values()].map(row => '<p class="small-text">' + e(row.currency.code + ' ' + host.amount(row.units,row.currency)) + ' in ' + row.cases +
        ' open cases · ' + row.followUpsDue + ' follow-ups due</p>').join('') + '</div>' +
      (rows.length ? '<div class="table-wrap"><table><thead><tr><th>Invoice / customer</th><th>Owner / priority</th><th>Next action</th><th class="num">Outstanding</th><th>Case position</th><th>Promise / dispute</th></tr></thead><tbody>' +
        rows.map(row => '<tr><td>' + button(row.invoice.number,'open',row.id,'class="link"') + '<span class="subline">' +
          e(row.invoice.customerName) + '</span></td><td>' + e(row.owner) + '<span class="subline">' + e(label(row.priority)) +
          '</span></td><td>' + e(row.actionDate) + '</td><td class="num">' + format(row) + '</td><td>' +
          e(label(row.queueStatus)) + '</td><td>' +
          (row.promise ? 'Promise ' + e(row.currency.code + ' ' + row.promise.amount) + '<span class="subline">' +
            e(row.promise.dueDate + ' · ' + label(row.promise.dueStatus || row.promise.status)) + '</span>' : '') +
          (row.dispute ? '<span class="subline">Dispute ' + e(row.currency.code + ' ' + row.dispute.amount + ' · ' + label(row.dispute.status)) + '</span>' : '') +
          '</td></tr>').join('') + '</tbody></table></div>' : '<div class="panel-body"><p>No collection cases match this view.</p></div>') +
      '</section><section class="panel"><div class="panel-head"><h2>Overdue invoices without an open case</h2></div>' +
      (unassigned.length ? '<div class="table-wrap"><table><thead><tr><th>Invoice / customer</th><th>Days overdue</th><th class="num">Outstanding</th><th></th></tr></thead><tbody>' +
        unassigned.map(row => '<tr><td>' + e(row.number) + '<span class="subline">' + e(row.customerName) +
          '</span></td><td>' + row.overdueDays + '</td><td class="num">' + format(row) + '</td><td>' +
          (row.existingCaseId ? button('Open retained case','open',row.existingCaseId) : button('Assign follow-up','new',row.id,'data-write')) +
          '</td></tr>').join('') + '</tbody></table></div>' : '<div class="panel-body"><p>' + (listError ? 'Refresh the collection data to see unassigned invoices.' : owner ? 'Choose All owners to see overdue invoices without an open case.' : 'No overdue invoices without an open case match this account view.') + '</p></div>') +
      '</section>';
  }
  function invoiceAction(invoice) {
    if (!invoice.issued) return '';
    const row = list.cases.find(item => item.invoiceId === invoice.id);
    return '<section class="section"><div class="row between"><h3>Customer follow-up</h3>' +
      (row ? button('Open collection case','open',row.id) : button('Open collection case','new',invoice.id,'data-write')) +
      '</div></section>';
  }
  function history(record) {
    return '<div class="table-wrap"><table><thead><tr><th>Effective / occurred</th><th>Activity / operator</th><th>Details</th></tr></thead><tbody>' +
      [...record.events].reverse().map(event => '<tr><td>' + e(event.effectiveDate) +
        (event.occurredDate && event.occurredDate !== event.effectiveDate ? '<span class="subline">Occurred ' + e(event.occurredDate) + '</span>' : '') +
        (event.effectiveDate > asOf() ? '<span class="subline">Future in this view</span>' : '') + '</td><td>' +
        e(label(event.kind)) + '<span class="subline">' + e(event.actor) + '</span></td><td><p class="preline">' +
        e(event.note) + '</p>' + (event.amount ? '<p>' + e(record.currency.code + ' ' + event.amount) + (event.dueDate ? ' · Due ' + e(event.dueDate) : '') + '</p>' : '') +
        (event.terms ? '<p>' + e(event.terms.owner + ' · ' + event.terms.priority + ' · Follow-up ' + event.terms.nextActionDate) + '</p>' : '') +
        (event.channel ? '<p>' + e(label(event.channel) + ' · ' + label(event.direction) + ' · ' + event.contact) + '</p>' : '') +
        (event.outcome ? '<p>' + e(label(event.outcome)) + '</p>' : '') +
        (event.reference ? '<p class="small-text preline">' + e(event.reference) + '</p>' : '') + '</td></tr>').join('') + '</tbody></table></div>';
  }
  async function openCase(id) {
    const detail = await api.collectionCase(id,{asOf:asOf()});
    selected = detail;
    const row = detail.collectionCase, record = detail.record, open = row.status === 'OPEN';
    openDialog(row.title, '<p><strong>' + e(row.invoice.number) + '</strong> · ' + e(row.invoice.customerName) +
      '</p><p>' + format(row) + ' outstanding as of ' + e(row.asOf) + ' · ' + e(label(row.queueStatus)) +
      '</p><p>Owner: ' + e(row.owner) + ' · ' + e(label(row.priority)) + ' · Next follow-up: ' + e(row.actionDate) +
      '</p><div class="row wrap">' + button('Assignment','edit',id,'data-write' + (open?'':' disabled')) +
      button('Record contact','activity',id,'data-kind="CONTACT" data-write') +
      button('Add note','activity',id,'data-kind="NOTE" data-write') +
      (open ? (row.promise?.status === 'OPEN' ? button('Record promise outcome','activity',id,'data-kind="PROMISE_OUTCOME" data-write') :
        button('Record payment promise','activity',id,'data-kind="PROMISE" data-write')) +
        (row.dispute?.status === 'OPEN' ? button('Resolve dispute','activity',id,'data-kind="DISPUTE_RESOLUTION" data-write') :
        button('Record dispute','activity',id,'data-kind="DISPUTE" data-write')) +
        button('Close case','transition',id,'data-kind="CLOSE" data-write') :
        row.status === 'CLOSED' ? button('Reopen case','transition',id,'data-kind="REOPEN" data-write') : '') +
      '</div><section class="section"><h3>Current promise and dispute</h3><p>' +
      (row.promise ? e(row.currency.code + ' ' + row.promise.amount + ' promised by ' + row.promise.dueDate + ' · ' + label(row.promise.dueStatus || row.promise.status)) : 'No promise recorded.') +
      '</p><p>' + (row.dispute ? e(row.currency.code + ' ' + row.dispute.amount + ' · ' + label(row.dispute.category) + ' · ' + label(row.dispute.status)) : 'No dispute recorded.') +
      '</p></section><section class="section"><h3>Customer preparation and case files</h3><div class="row wrap">' +
      (row.status === 'FUTURE' ? '<p class="small-text muted">Customer reminders are available from ' + e(record.openedDate) + '.</p>' :
        button('Prepare customer reminder','reminder',id)) +
      ['case.json','case.csv','case.html','manifest.json'].map(name => button(name,'download',id,'data-name="' + name + '"')).join('') +
      '</div></section><section class="section"><h3>Retained history</h3>' + history(record) + '</section>');
  }
  function baseForm(formId, kind, row, values) {
    const caseId = row?.id || '';
    const retained = draft?.formId === formId && draft.caseId === caseId && draft.kind === kind &&
      draft.workspaceId === (selected?.workspaceId || list.workspaceId) &&
      (row || !values.invoiceId || draft.values?.invoiceId === values.invoiceId) ? draft : null;
    const version = retained?.expectedVersion ?? row?.version ?? 0;
    const data = {...values,...retained?.values};
    const stale = row && version !== row.version;
    return {data, version, start:'<form id="' + formId + '" data-id="' + e(caseId) + '" data-kind="' + e(kind) +
      '" data-version="' + version + '" data-workspace="' + e(selected?.workspaceId || list.workspaceId) + '">' +
      (retained ? '<p class="notice">Your retained form is open.</p>' +
        button('Reset to current values','reset-form',caseId,'data-form="' + formId + '" data-kind="' + e(kind) +
          '" data-invoice="' + e(data.invoiceId || '') + '"') : '') +
      (stale ? '<p class="notice">This form uses case version ' + version + '; the current history is version ' + row.version +
        '. Review that current history before applying these edits.</p>' + button('Use reviewed current version','adopt',caseId) : '')};
  }
  async function edit(id = '') {
    let row = null;
    if (id && list.cases.some(item => item.id === id)) {
      selected = await api.collectionCase(id,{asOf:asOf()}); row = selected.collectionCase;
    } else if (selected?.collectionCase?.id === id) {
      selected = await api.collectionCase(id,{asOf:asOf()}); row = selected.collectionCase;
    } else selected = null;
    if (!list.workspaceId) await loadList();
    if (!row && !list.workspaceId) throw new Error(listError || 'Refresh the accounting workspace before opening a case.');
    const defaults = row ? {title:row.title,owner:row.owner,priority:row.priority,nextActionDate:row.nextActionDate,
      effectiveDate:asOf(),invoiceId:row.invoiceId,note:''} : {title:'Invoice follow-up',owner:'Accounts receivable',
      priority:'NORMAL',nextActionDate:asOf(),effectiveDate:asOf(),invoiceId:id,note:''};
    const form = baseForm('collection-case-form','case',row,defaults), value = form.data;
    const invoices = (getState()?.invoices || []).filter(item => item.issued && item.status === 'ISSUED');
    openDialog(row ? 'Update collection assignment' : 'Open collection case', form.start +
      (row ? '<p>' + e(row.invoice.number) + ' · ' + e(row.invoice.customerName) + '</p>' :
      '<label>Issued invoice<select name="invoiceId" required><option value="">Choose an invoice</option>' +
      invoices.map(item => '<option value="' + e(item.id) + '"' + (item.id === value.invoiceId?' selected':'') + '>' +
        e(item.number + ' · ' + item.customerName + ' · ' + item.currency.code + ' ' + item.amountDue) + '</option>').join('') + '</select></label>') +
      '<div class="form-grid">' + input('Case title','title',value.title,'required maxlength="300"') +
      input('Owner','owner',value.owner,'required maxlength="160"') + select('Priority','priority',['NORMAL','HIGH','URGENT'],value.priority) +
      input('Effective date','effectiveDate',value.effectiveDate,'type="date" required') +
      input('Next follow-up','nextActionDate',value.nextActionDate,'type="date" required') +
      '</div><label>Internal note<textarea name="note" rows="3" maxlength="6000">' + e(value.note) + '</textarea></label>' +
      actions(row?'Save assignment':'Open case') + '</form>');
  }
  async function activity(id, kind) {
    selected = await api.collectionCase(id,{asOf:asOf()});
    const row = selected.collectionCase;
    const form = baseForm('collection-activity-form',kind,row,{effectiveDate:asOf(),occurredDate:asOf(),note:'',
      reference:'',nextActionDate:'',channel:'EMAIL',direction:'INBOUND',contact:'',amount:row.invoice.amountDue,
      dueDate:asOf(),category:'OTHER',outcome:'KEPT',promiseId:row.promise?.id || '',disputeId:row.dispute?.id || ''});
    const value = form.data;
    let extra = '';
    if (kind === 'CONTACT') extra = select('Channel','channel',['EMAIL','PHONE','MEETING','OTHER'],value.channel) +
      select('Direction','direction',['INBOUND','OUTBOUND'],value.direction) + input('Contact','contact',value.contact,'maxlength="300"');
    if (kind === 'PROMISE' || kind === 'DISPUTE') extra += input('Amount (' + row.currency.code + ', ' + row.currency.scale + ' decimal places)',
      'amount',value.amount,'required inputmode="decimal"');
    if (kind === 'PROMISE') extra += input('Promised payment date','dueDate',value.dueDate,'type="date" required');
    if (kind === 'PROMISE_OUTCOME') extra += select('Recorded outcome','outcome',['KEPT','BROKEN','WITHDRAWN'],value.outcome) +
      '<input type="hidden" name="promiseId" value="' + e(value.promiseId) + '">';
    if (kind === 'DISPUTE') extra += select('Category','category',['PRICING','DELIVERY','DUPLICATE','OTHER'],value.category);
    if (kind === 'DISPUTE_RESOLUTION') extra += '<input type="hidden" name="disputeId" value="' + e(value.disputeId) + '">';
    openDialog(label(kind), form.start + '<p>' + e(row.invoice.number) + ' · ' + format(row) + ' outstanding.</p>' +
      (kind === 'PROMISE_OUTCOME' ? '<p>Record the observed outcome and identify the relevant receipt or correspondence in the source reference.</p>' : '') +
      '<div class="form-grid">' + input('Effective date','effectiveDate',value.effectiveDate,'type="date" required') +
      input('Occurred date','occurredDate',value.occurredDate,'type="date" required') + extra +
      input('Next follow-up (optional)','nextActionDate',value.nextActionDate,'type="date"') + '</div>' +
      '<label>Internal activity note<textarea name="note" rows="4" maxlength="6000" required>' + e(value.note) + '</textarea></label>' +
      input('Source reference','reference',value.reference,'maxlength="1500"') + actions('Retain activity') + '</form>');
  }
  async function transition(id, kind) {
    selected = await api.collectionCase(id,{asOf:asOf()});
    const row = selected.collectionCase, form = baseForm('collection-transition-form',kind,row,
      {effectiveDate:asOf(),nextActionDate:asOf(),note:''}), value = form.data;
    openDialog(kind === 'CLOSE' ? 'Close collection case' : 'Reopen collection case', form.start +
      '<p>' + e(row.invoice.number) + ' · ' + format(row) + ' outstanding. The invoice and payment history continue in the original account.</p>' +
      input('Effective date','effectiveDate',value.effectiveDate,'type="date" required') +
      (kind === 'REOPEN' ? input('Next follow-up','nextActionDate',value.nextActionDate,'type="date" required') : '') +
      '<label>Reason<textarea name="note" rows="4" maxlength="6000" required>' + e(value.note) + '</textarea></label>' +
      actions(kind === 'CLOSE'?'Close case':'Reopen case') + '</form>');
  }
  async function submit(form, values) {
    if (!form.id.startsWith('collection-')) return false;
    remember(form);
    const payload = {...values,workspaceId:form.dataset.workspace};
    if (form.dataset.id) payload.expectedVersion = Number(form.dataset.version);
    if (form.id === 'collection-case-form') {
      if (form.dataset.id) payload.id = form.dataset.id;
      await mutate('saveCollectionCase',[payload],form.dataset.id?'Save collection assignment':'Open collection case');
    } else if (form.id === 'collection-activity-form') {
      payload.kind = form.dataset.kind;
      await mutate('recordCollectionActivity',[form.dataset.id,payload],'Retain collection activity');
    } else if (form.id === 'collection-transition-form') {
      const close = form.dataset.kind === 'CLOSE';
      await mutate(close?'closeCollectionCase':'reopenCollectionCase',[form.dataset.id,payload],close?'Close collection case':'Reopen collection case');
    } else return false;
    return true;
  }
  async function click(control) {
    const action = control.dataset.action;
    if (!action?.startsWith('collection-')) return false;
    if (host.isLocked() && ['collection-new','collection-edit','collection-activity','collection-transition','collection-adopt','collection-reset-form'].includes(action))
      throw new Error('Complete the retained account operation before starting another case change.');
    const id = control.dataset.id;
    if (action === 'collection-new') await edit(id);
    else if (action === 'collection-open') await openCase(id);
    else if (action === 'collection-edit') await edit(id);
    else if (action === 'collection-activity') await activity(id,control.dataset.kind);
    else if (action === 'collection-transition') await transition(id,control.dataset.kind);
    else if (action === 'collection-reset-form') {
      const invoiceId = control.closest('form')?.querySelector('[name="invoiceId"]')?.value || control.dataset.invoice;
      draft = null; host.saveSession('collectionsDraft',null);
      if (control.dataset.form === 'collection-case-form') await edit(id || invoiceId);
      else if (control.dataset.form === 'collection-activity-form') await activity(id,control.dataset.kind);
      else if (control.dataset.form === 'collection-transition-form') await transition(id,control.dataset.kind);
    } else if (action === 'collection-adopt') {
      const form = document.querySelector('#dialog-content form');
      if (!form || selected?.collectionCase.id !== id) throw new Error('Open the current case history first.');
      form.dataset.version = String(selected.collectionCase.version); remember(form);
      host.setMessage('Your retained values now use the reviewed current case version.');
    } else if (action === 'collection-download') {
      const response = await api.collectionFile(id,control.dataset.name,{asOf:asOf()});
      saveBlob(await response.blob(),control.dataset.name);
    } else if (action === 'collection-export') {
      const response = await api.collectionsFile(control.dataset.name,exportQuery());
      saveBlob(await response.blob(),control.dataset.name);
    } else if (action === 'collection-reminder') {
      const reminder = await api.collectionReminder(id,{asOf:asOf()});
      openDialog('Prepared customer reminder','<p class="small-text">Invoice balance as of ' + e(reminder.asOf) +
        '. Review the customer text before using it in the existing relationship.</p>' +
        '<label>Subject<input readonly value="' + e(reminder.subject) + '"></label><label>Message<textarea readonly rows="14">' +
        e(reminder.text) + '</textarea></label>' + button('Download message','download',id,'data-name="reminder.txt"'));
    }
    return true;
  }
  return {methods,render,invoiceAction,loadList,submit,click,
    input(target) { remember(target.closest('#collection-case-form,#collection-activity-form,#collection-transition-form')); },
    change(target) {
      const filter = target.dataset.collectionsFilter;
      if (filter === 'status') status = target.value;
      if (filter === 'owner') owner = target.value;
      if (filter) host.render();
      remember(target.closest('#collection-case-form,#collection-activity-form,#collection-transition-form'));
    },
    async afterMutation(result,operation) {
      if (!methods.has(operation.method)) return;
      draft = null; host.saveSession('collectionsDraft',null);
      if (result.collectionCase?.id) await openCase(result.collectionCase.id).catch(showError);
    }};
}
