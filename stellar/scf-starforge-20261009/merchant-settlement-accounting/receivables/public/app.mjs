import {createReceivablesClient} from './client.mjs';

const $ = selector => document.querySelector(selector);
const e = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const today = () => new Date().toISOString().slice(0,10);
const id = () => crypto.randomUUID();
const config = await fetch(new URL('./config.json', import.meta.url), {cache:'no-store'}).then(response => {
  if (!response.ok) throw new Error('The local workspace configuration could not be read.');
  return response.json();
});
const api = createReceivablesClient({baseUrl:config.apiPath});
const storageKey = 'merchant-receivables:' + location.origin + config.apiPath + ':';
function readSession(key, fallback = null) { try { const text = sessionStorage.getItem(storageKey + key); return text ? JSON.parse(text) : fallback; } catch { return fallback; } }
function saveSession(key, value) { try { value === null ? sessionStorage.removeItem(storageKey + key) : sessionStorage.setItem(storageKey + key, JSON.stringify(value)); } catch { /* The open form remains in memory when browser storage is unavailable. */ } }
const ui = {state:null, view:'invoices', selected:'', detail:null, editor:readSession('draft'), pending:readSession('pending'), busy:false, customer:'', search:'', status:'', asOf:today(), selectionVersion:0, preview:null, native:null, customerReport:null};
$('#operator').value = readSession('actor','merchant-operator');
$('#as-of').value = ui.asOf;
function customerName(customerId) {
  const customer = ui.state?.customers?.find(row => row.id === customerId);
  return customer?.name || customer?.displayName || customer?.company || customerId;
}
function customerOptions(selected = '', blank = 'Choose a customer') {
  return '<option value="">' + e(blank) + '</option>' + (ui.state?.customers || []).map(row =>
    '<option value="' + e(row.id) + '"' + (row.id === selected ? ' selected' : '') + '>' + e(row.name || row.displayName || row.id) + (row.reference ? ' · ' + e(row.reference) : '') + '</option>').join('');
}
function currencyOf(value) { return value?.currency || value || {code:'USD',scale:2}; }
function units(value, currency) {
  const scale = Number(currency.scale);
  if (!Number.isInteger(scale) || scale < 0 || scale > 6 || !/^-?\d+(?:\.\d+)?$/.test(String(value))) throw new Error('Enter an exact decimal amount.');
  const negative = String(value).startsWith('-');
  const [whole,fraction=''] = String(value).replace(/^-/,'').split('.');
  if (fraction.length > scale) throw new Error('The amount has too many decimal places.');
  const result = BigInt(whole + fraction.padEnd(scale,'0'));
  return negative ? -result : result;
}
function amount(value, currency) {
  const scale = Number(currency.scale), negative = value < 0n, digits = (negative ? -value : value).toString().padStart(scale+1,'0');
  return (negative ? '-' : '') + (scale ? digits.slice(0,-scale) + '.' + digits.slice(-scale) : digits);
}
function zero(currency) { return amount(0n,currency); }
function positive(value,currency) { try { return units(value,currency) > 0n; } catch { return false; } }
function money(value,currency) { return e(currency?.code || '') + ' ' + e(value ?? '—'); }
function statusName(row) {
  const label = row.paymentStatus || row.status || 'OPEN';
  return label.replaceAll('_',' ').toLowerCase().replace(/^\w/, char => char.toUpperCase());
}
function badge(row) { return '<span class="status' + (Number(row.overdueDays)>0 ? ' overdue' : '') + '">' + e(Number(row.overdueDays)>0 ? 'Overdue · ' + row.overdueDays + 'd' : statusName(row)) + '</span>'; }
function btn(label,action,extra='',primary=false) { return '<button type="button" data-action="' + e(action) + '"' + extra + (primary ? ' class="primary"' : '') + '>' + e(label) + '</button>'; }
function setMessage(message,error=false) {
  $('#message').innerHTML = message ? '<div class="notice' + (error?' error':'') + '"><p>' + e(message) + '</p>' + btn('Dismiss','dismiss-message') + '</div>' : '';
}
function dialogMessage(message,error=false) { $('#dialog-message').innerHTML = message ? '<div class="notice' + (error?' error':'') + '"><p>' + e(message) + '</p></div>' : ''; }
function errorMessage(error) { return String(error?.message || error || 'The request could not finish.'); }
function showError(error) { setMessage(errorMessage(error),true); if ($('#dialog').open) dialogMessage(errorMessage(error),true); }
function persistEditor() { saveSession('draft',ui.editor||ui.parkedEditor||null); }
function renderPending() {
  const pending = ui.pending;
  if (!pending) { $('#pending').innerHTML=''; return; }
  const copy = ui.busy ? pending.label + '…' : pending.rejected ? pending.label + ' was rejected. Your form is retained.' : pending.label + ' has a retained request. Retry retrieves its saved result or completes this same operation.';
  $('#pending').innerHTML='<div class="notice' + (pending.error?' error':'') + '"><div><p><strong>' + e(copy) + '</strong></p>' +
    (pending.error?'<p class="small-text">' + e(pending.error) + '</p>':'') +
    '<details class="small-text"><summary>Operation reference</summary><p class="mono">' + e(pending.requestId) + '</p></details></div><div class="row">' +
    btn('Retry same operation','retry-operation',ui.busy?' disabled':'') + btn('Check saved state','check-operation',ui.busy?' disabled':'') +
    (pending.rejected?btn('Return to form','return-to-form',ui.busy?' disabled':''):'') + '</div></div>';
}
function setBusy(value) {
  ui.busy=value; document.body.classList.toggle('busy',value);
  const locked=value||Boolean(ui.pending);
  document.querySelectorAll('[data-write],button[type=submit],#draft-form input,#draft-form select,#draft-form textarea,#dialog-content input,#dialog-content select,#dialog-content textarea,[data-action=new-invoice],[data-action=add-line],[data-action=remove-line],[data-action=settings],[data-action=import-quote]').forEach(control=>{
    if(locked){if(!Object.hasOwn(control.dataset,'operationDisabled'))control.dataset.operationDisabled=control.disabled?'1':'0';control.disabled=true;}
    else if(Object.hasOwn(control.dataset,'operationDisabled')){control.disabled=control.dataset.operationDisabled==='1';delete control.dataset.operationDisabled;}
  });
  renderPending();
}
function context() {
  const actor=$('#operator').value.trim();
  if (!actor) throw new Error('Enter an operator name before saving.');
  if (!ui.state) throw new Error('Open the current workspace before saving.');
  saveSession('actor',actor);
  return {revision:ui.state.revision,actor,requestId:id()};
}
async function mutate(method,args,label) {
  if (ui.busy) return;
  if (ui.pending) { setMessage('Finish the retained operation with Retry, or return to its form after a rejected request.',true); return; }
  const current=context(), values=structuredClone(args);
  values[values.length-1]={...values[values.length-1],...current};
  if(new Blob([JSON.stringify(values[values.length-1])]).size>Number(config.requestBytes||2000000))throw new Error('The operation exceeds the workspace request limit. Reduce the source file size before saving.');
  ui.pending={method,args:values,label,requestId:current.requestId,revision:current.revision,createdAt:new Date().toISOString()};
  saveSession('pending',ui.pending);
  await runPending();
}
function definitelyRejected(error) {
  const status=Number(error?.status);
  const outcome=String(error?.details?.outcome||error?.response?.error?.outcome||error?.response?.outcome||'').toLowerCase();
  const uncertain=/COMMIT_(?:UNKNOWN|UNCERTAIN)|TRANSPORT_FAILED|INVALID_RESPONSE/.test(String(error?.code||''))||['unknown','uncertain','indeterminate'].includes(outcome);
  return status>=400&&status<500&&!uncertain;
}
async function runPending() {
  if (!ui.pending || ui.busy) return;
  const current=ui.pending; setBusy(true); dialogMessage('');
  try {
    if (typeof api[current.method] !== 'function' || !['settings','saveDraft','importQuote','issue','voidInvoice','credit','receipt','importSettlement','allocate','release','voidReceipt'].includes(current.method)) throw new Error('This retained operation is not supported by the client.');
    const result=await api[current.method](...current.args);
    if (current.method === 'saveDraft' || current.method === 'importQuote') {
      ui.selected=result.invoice?.id || current.args.at(-1).id || ui.selected;
      if(current.method === 'importQuote' && ui.editor?.dirty){ui.parkedEditor=ui.editor;ui.editor=null;persistEditor();}
      else {ui.editor=null;persistEditor();}
    }
    if (['issue','voidInvoice','credit'].includes(current.method)) ui.selected=current.args[0];
    ui.pending=null; saveSession('pending',null); closeDialog();
    setMessage(current.label + ' completed.');
    await refresh({quiet:true});
  } catch(error) {
    if (ui.pending?.requestId === current.requestId) {
      ui.pending.error=errorMessage(error);
      ui.pending.rejected=definitelyRejected(error);
      saveSession('pending',ui.pending);
    }
    showError(error);
  } finally { setBusy(false); }
}
async function refresh({quiet=false}={}) {
  const version=(ui.refreshVersion||0)+1;ui.refreshVersion=version;
  const asOf=ui.asOf;
  try {
    const state=await api.state({asOf});
    if(ui.refreshVersion!==version||ui.asOf!==asOf)return;
    ui.state=state; ui.customerReport=null;
    if(ui.selected&&!ui.editor){ui.detail=null;ui.preview=null;}
    $('#revision').textContent='Revision ' + state.revision + ' · As of ' + ui.asOf;
    $('#customer-filter').innerHTML=customerOptions(ui.customer,'All customers');
    $('#customer-filter').value=ui.customer;
    render();
    if (ui.selected && !ui.editor) await selectInvoice(ui.selected);
    if (ui.view==='aging' && ui.customer) await loadCustomerReport();
    if (!quiet) setMessage('Current receivables loaded. Unsaved invoice edits are retained.');
  } catch(error) { showError(error); }
}
function filteredInvoices() {
  return (ui.state?.invoices||[]).filter(row=> {
    if (ui.customer && row.customerId!==ui.customer) return false;
    if (ui.status === 'OVERDUE' && !(Number(row.overdueDays)>0)) return false;
    if (ui.status && ui.status!=='OVERDUE' && (row.paymentStatus||row.status)!==ui.status) return false;
    const text=[row.number,row.id,row.customerName,customerName(row.customerId),row.purchaseOrder].join(' ').toLowerCase();
    return !ui.search || text.includes(ui.search.toLowerCase());
  });
}
function render() {
  document.querySelectorAll('[data-action=view]').forEach(button=>{
    if(button.dataset.view===ui.view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
  $('#status-filter').disabled=ui.view!=='invoices';
  if(!ui.state)return;
  $('#content').innerHTML=ui.view==='invoices'?renderInvoices():ui.view==='receipts'?renderReceipts():ui.view==='aging'?renderAging():renderActivity();
  renderPending(); setBusy(ui.busy);
}
function renderInvoices() {
  const invoices=filteredInvoices();
  const table=invoices.length?'<div class="table-wrap"><table><thead><tr><th>Invoice / customer</th><th>Due</th><th class="num">Amount due</th><th>Status</th></tr></thead><tbody>' +
    invoices.map(row=>'<tr' + (ui.selected===row.id?' class="selected"':'') + '><td><button type="button" class="link" data-action="select-invoice" data-id="' + e(row.id) + '">' + e(row.number||'Draft invoice') +
      '</button><span class="subline">' + e(row.customerName||customerName(row.customerId)) + '</span></td><td>' + e(row.dueDate) +
      '</td><td class="num">' + money(row.amountDue,row.currency) + '<span class="subline">Total ' + e(row.total) + '</span></td><td>' + badge(row) + '</td></tr>').join('') +
    '</tbody></table></div>':'<div class="panel-body"><p class="muted">No invoices match these filters.</p>' + btn('Create an invoice','new-invoice',' data-write',true) + '</div>';
  return '<div class="grid' + (ui.editor?' editing':'') + '"><section class="panel"><div class="panel-head"><h2>Invoices <span class="muted small-text">(' + invoices.length + ')</span></h2>' +
    (ui.customer?btn('Account statement','customer-export'):'') + '</div>' + table + '</section><section class="panel" id="invoice-panel">' +
    (ui.editor?renderEditor():ui.detail?renderInvoiceDetail():'<div class="panel-body"><h2>Invoice detail</h2><p class="muted">' + (ui.detailLoading?'Loading the selected invoice…':'Choose an invoice to review its document, credits and payment allocations.') + '</p></div>') + '</section></div>';
}
function detailInvoice() {
  const detail=ui.detail||{}, invoice=detail.invoice||detail, summary=ui.state?.invoices.find(row=>row.id===ui.selected)||{};
  return {...invoice,...summary,draft:detail.draft||invoice.draft,document:detail.document||invoice.document,
    credits:detail.credits||invoice.credits||[],allocations:detail.allocations||invoice.allocations||[],history:detail.history||invoice.history||[],sourceQuote:detail.sourceQuote||invoice.sourceQuote,quoteDraftChanged:detail.quoteDraftChanged||invoice.quoteDraftChanged};
}
async function selectInvoice(invoiceId) {
  ui.selected=invoiceId;ui.detail=null;ui.preview=null;ui.detailLoading=true;
  const selectedVersion=++ui.selectionVersion, asOf=ui.asOf;
  if(ui.view==='invoices'&&!ui.editor)render();
  try {
    const detail=await api.detail(invoiceId,{asOf});
    if(selectedVersion!==ui.selectionVersion||ui.asOf!==asOf)return;
    ui.detail=detail;ui.detailLoading=false;
    if(ui.view==='invoices')render();
  } catch(error) { if(selectedVersion===ui.selectionVersion){ui.detailLoading=false;if(ui.view==='invoices')render();showError(error);} }
}
function renderInvoiceDetail() {
  const row=detailInvoice(),doc=row.document||row.draft||{},credits=row.credits||[],allocations=row.allocations||[];
  const active=allocations.filter(item=>!item.releasedDate);
  const actions=row.status==='DRAFT'?btn('Edit draft','edit-invoice',' data-write') + btn('Review and issue','preview-invoice',' data-write',true):
    row.status==='ISSUED'?btn('Allocate receipt','allocate-invoice',' data-write',true)+btn('Credit note','credit-invoice',' data-write'):'';
  return '<div class="panel-head"><div><h2>' + e(row.number||'Draft invoice') + '</h2><p class="small-text muted">' + e(row.customerName||customerName(row.customerId)) + '</p></div>' + badge(row) +
    '</div><div class="panel-body"><div class="row">' + actions + '</div><div class="stats"><div class="stat"><span>Total · ' + e(row.currency?.code) + '</span><strong>' + e(row.total) +
    '</strong></div><div class="stat"><span>Paid / allocated</span><strong>' + e(row.paid) + '</strong></div><div class="stat"><span>Amount due</span><strong>' + e(row.amountDue) +
    '</strong></div></div><dl class="definition"><dt>Invoice date</dt><dd>' + e(row.issueDate) + '</dd><dt>Due date</dt><dd>' + e(row.dueDate) +
    '</dd><dt>Purchase order</dt><dd>' + e(doc.purchaseOrder||'—') + '</dd><dt>Credits</dt><dd>' + money(row.credited,row.currency) +
    '</dd><dt>Credit balance</dt><dd>' + money(row.creditBalance,row.currency) + '</dd><dt>Version</dt><dd>' + e(row.version) + '</dd></dl>' +
    '<section class="section"><h3>Invoice lines</h3><div class="table-wrap"><table><thead><tr><th>Description</th><th class="num">Quantity</th><th class="num">Total</th></tr></thead><tbody>' +
    (doc.lines||[]).map(line=>'<tr><td>' + e(line.description) + '</td><td class="num">' + e(line.quantity) + '</td><td class="num">' + e(line.total) + '</td></tr>').join('') +
    '</tbody></table></div>' + (doc.note?'<p class="preline small-text section">' + e(doc.note) + '</p>':'') + '</section>' +
    (row.status!=='DRAFT'?'<section class="section"><h3>Documents</h3><div class="row">' + ['invoice.html','invoice.json','invoice.csv','manifest.json','status.json'].map(name=>
      btn(name.endsWith('.html')?'Printable invoice':name.replace('invoice.','').replace('manifest.json','Manifest').replace('status.json','Current status'),'download',' data-id="' + e(row.id) + '" data-name="' + e(name) + '"')).join('') + '</div></section>':'') +
    '<section class="section"><div class="row between"><h3>Allocations</h3><span class="small-text muted">' + active.length + ' active</span></div>' +
    (allocations.length?'<div class="table-wrap"><table><thead><tr><th>Receipt / date</th><th class="num">Amount</th><th></th></tr></thead><tbody>' + allocations.map(item=>{
      const receipt=ui.state.receipts.find(receipt=>receipt.id===item.receiptId);
      return '<tr><td>' + e(receipt?.reference||item.receiptId) + '<span class="subline">' + e(item.allocatedDate) + (item.releasedDate?' · Released ' + e(item.releasedDate):'') +
        '</span></td><td class="num">' + e(item.amount) + '</td><td>' + (!item.releasedDate?btn('Release','release-allocation',' class="small" data-id="' + e(item.id) + '" data-write'):'') + '</td></tr>';
    }).join('') + '</tbody></table></div>':'<p class="muted small-text">No receipts are allocated to this invoice.</p>') + '</section>' +
    '<section class="section"><h3>Credit notes</h3>' + (credits.length?credits.map(item=>{
      const credit=item.document||item;return '<div class="row between section"><div><strong>' + e(item.number||credit.number||item.id) + '</strong><span class="subline">' + e(credit.creditDate) + ' · ' +
        money(credit.totals?.total||item.total,row.currency) + '</span><span class="subline">' + e(credit.reason) + '</span></div><div class="row">' +
        btn('Print','download',' data-id="' + e(item.id) + '" data-name="credit.html"') + btn('JSON','download',' data-id="' + e(item.id) + '" data-name="credit.json"') + '</div></div>';
    }).join(''):'<p class="muted small-text">No credit notes have been issued.</p>') + '</section>' +
    (row.sourceQuote?'<section class="section"><h3>Source quote</h3><p class="small-text">' + e(row.quoteDraftChanged?'The invoice draft has been edited since quote import. Review these changes before issuing.':'This invoice was prepared from a retained merchant quote.') + '</p><div class="row">' + ['quote.json','response.json','source.json','review.json'].filter(name=>Object.hasOwn(row.sourceQuote.files||{},name)).map(name=>btn(name.replace('.json',''),'quote-download',' data-id="' + e(row.id) + '" data-name="' + name + '"')).join('') + '</div></section>':'') + '<section class="section"><h3>Activity</h3>' + historyTable(row.history) + '</section>' +
    (row.status!=='VOID'?'<section class="section"><div class="row">' + btn('Void invoice','void-invoice',' data-write') + '</div></section>':'') + '</div>';
}
function newDraft() {
  if(!ui.editor&&ui.parkedEditor){ui.editor=ui.parkedEditor;ui.parkedEditor=null;ui.view='invoices';persistEditor();render();setMessage('Your retained invoice edits are open.');return;}
  if(ui.editor?.dirty) { ui.view='invoices';render();setMessage('Your unsaved invoice draft is open. Save it before starting another.');return; }
  ui.editor={id:null,expectedVersion:null,customerId:ui.customer,currency:{code:'USD',scale:2},issueDate:today(),dueDate:today(),purchaseOrder:'',note:'',
    lines:[{id:'line-'+id(),description:'',quantity:'1',unitAmount:'0.00',discountAmount:'0.00',taxAmount:'0.00'}],dirty:false};
  ui.view='invoices';persistEditor();render();
}
function editDraft() {
  const row=detailInvoice(),draft=row.draft;
  if(!draft)return;
  const retained=ui.editor||ui.parkedEditor;
  if(retained?.dirty){ui.editor=retained;ui.parkedEditor=null;persistEditor();render();setMessage('Your retained invoice edits are open. Save this draft before editing another invoice.',true);return;}
  ui.editor={...structuredClone(draft),id:row.id,expectedVersion:row.version,dirty:false};
  persistEditor();render();
}
function draftTotal() {
  const draft=ui.editor,currency=draft.currency;let total=0n;
  for(const line of draft.lines){
    if(!/^\d+(?:\.\d{1,6})?$/.test(line.quantity))throw new Error('Check quantity precision.');
    const [whole,fraction='']=line.quantity.split('.'),quantity=BigInt(whole+fraction.padEnd(6,'0'));
    const unit=units(line.unitAmount,currency),discount=units(line.discountAmount||'0',currency),tax=units(line.taxAmount||'0',currency);
    const gross=(unit*quantity+500000n)/1000000n;
    if(quantity<=0n || unit<0n || discount<0n || discount>gross || tax<0n)throw new Error('Check line amounts.');
    total+=gross-discount+tax;
  }
  return amount(total,currency);
}
function renderEditor() {
  const draft=ui.editor;let total;
  try{total=money(draftTotal(),draft.currency);}catch{total='Check line amounts';}
  return '<div class="panel-head"><div><h2>' + e(draft.id?'Edit invoice draft':'New invoice') + '</h2><span class="draft-state">' + (draft.dirty?'Unsaved edits retained in this browser':'Draft editor') +
    '</span></div><div class="row">' + (draft.id?btn('Compare saved version','compare-draft'):'') + btn('Close editor','close-editor') + '</div></div><form id="draft-form" class="panel-body"><div class="form-grid three">' +
    '<label class="full">Customer<select name="customerId" required>' + customerOptions(draft.customerId) + '</select></label>' +
    '<label>Currency<input name="currencyCode" maxlength="3" pattern="[A-Za-z]{3}" value="' + e(draft.currency.code) + '" required></label>' +
    '<label>Decimal places<select name="currencyScale">' + [0,1,2,3,4,5,6].map(scale=>'<option' + (Number(draft.currency.scale)===scale?' selected':'') + ' value="' + scale + '">' + scale + '</option>').join('') +
    '</select></label><label>Purchase order<input name="purchaseOrder" maxlength="300" value="' + e(draft.purchaseOrder) + '"></label>' +
    '<label>Invoice date<input name="issueDate" type="date" value="' + e(draft.issueDate) + '" required></label><label>Due date<input name="dueDate" type="date" value="' + e(draft.dueDate) + '" required></label></div>' +
    '<section class="section"><h3>Line items</h3><div class="table-wrap"><table class="line-editor"><thead><tr><th>Description</th><th>Quantity</th><th>Unit amount</th><th>Discount</th><th>Tax amount</th><th></th></tr></thead><tbody>' +
    draft.lines.map((line,index)=>'<tr data-line="' + index + '"><td><textarea name="description" data-field="description" maxlength="3000" required aria-label="Line ' + (index+1) + ' description">' + e(line.description) +
      '</textarea></td><td class="quantity-cell"><input data-field="quantity" inputmode="decimal" value="' + e(line.quantity) + '" required aria-label="Line ' + (index+1) +
      ' quantity"></td>' + ['unitAmount','discountAmount','taxAmount'].map(field=>'<td class="money-cell"><input data-field="' + field + '" inputmode="decimal" value="' + e(line[field]||'0') +
      '" required aria-label="Line ' + (index+1) + ' ' + e(field.replace('Amount',' amount')) + '"></td>').join('') +
      '<td class="remove-cell">' + btn('×','remove-line',' data-index="' + index + '" aria-label="Remove line ' + (index+1) + '"' + (draft.lines.length===1?' disabled':'')) + '</td></tr>').join('') +
    '</tbody></table></div><div class="row between">' + btn('Add line','add-line') + '<div class="total-row"><span>Draft total</span><strong id="draft-total">' + total + '</strong></div></div>' +
    '<p class="hint">Line discount and tax amounts are entered explicitly. Quantities support up to six decimal places; each line rounds half up in the selected currency.</p></section>' +
    '<label class="section">Customer note<textarea name="note" maxlength="6000">' + e(draft.note) + '</textarea></label>' +
    '<div class="dialog-actions"><span class="hint">Save the draft, then review the complete document before issuing.</span><button type="submit" class="primary" data-write>Save draft</button></div></form>';
}
function updateDraft(target) {
  const draft=ui.editor;if(!draft)return;
  const row=target.closest('[data-line]');
  if(row && target.dataset.field)draft.lines[Number(row.dataset.line)][target.dataset.field]=target.value;
  else if(target.name==='currencyCode')draft.currency.code=target.value.toUpperCase();
  else if(target.name==='currencyScale')draft.currency.scale=Number(target.value);
  else if(['customerId','purchaseOrder','issueDate','dueDate','note'].includes(target.name))draft[target.name]=target.value;
  else return;
  draft.dirty=true;persistEditor();
  const state=$('.draft-state');if(state)state.textContent='Unsaved edits retained in this browser';
  try{$('#draft-total').innerHTML=money(draftTotal(),draft.currency);}catch{$('#draft-total').textContent='Check line amounts';}
}

function renderReceipts() {
  const receipts=(ui.state.receipts||[]).filter(row=>(!ui.customer||row.customerId===ui.customer)&&(!ui.search||[row.reference,row.id,customerName(row.customerId),row.method].join(' ').toLowerCase().includes(ui.search.toLowerCase())));
  return '<section class="panel"><div class="panel-head"><h2>Receipts <span class="muted small-text">(' + receipts.length + ')</span></h2><div class="row">' +
    btn('Import native payment','native-receipt',' data-write') + btn('Record receipt','manual-receipt',' data-write',true) + '</div></div>' +
    (receipts.length?'<div class="table-wrap"><table><thead><tr><th>Reference / customer</th><th>Date / method</th><th class="num">Received</th><th class="num">Allocated</th><th class="num">Available</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
      receipts.map(row=>{
        const isVoid=row.voidDate&&row.voidDate<=ui.asOf;
        return '<tr><td>' + e(row.reference||row.id) + '<span class="subline">' + e(customerName(row.customerId)) +
          '</span>' + (row.source?.kind==='ORIGINAL_STELLAR_SETTLEMENT'?'<span class="subline">Native payment · ' + e(row.source.eventId||'') + '</span>':'') + '</td><td>' + e(row.receivedDate) +
          '<span class="subline">' + e(row.method) + '</span></td><td class="num">' + money(row.amount,row.currency) + '</td><td class="num">' + e(row.allocated??'—') +
          '</td><td class="num">' + e(row.available) + '</td><td><span class="status">' + e(isVoid?'Void':row.receivedDate>ui.asOf?'Future':'Recorded') + '</span></td><td><div class="row">' +
          (!isVoid&&positive(row.available,row.currency)?btn('Allocate','allocate-receipt',' class="small" data-id="' + e(row.id) + '" data-write'):'') +
          (!isVoid?btn('Void','void-receipt',' class="small" data-id="' + e(row.id) + '" data-write'):'') + '</div></td></tr>';
      }).join('') + '</tbody></table></div>':'<div class="panel-body"><p class="muted">Record a customer payment or import a verified native payment from a completed accounting report.</p></div>') +
    '<div class="panel-foot small-text muted">Available receipt amounts remain unapplied until you allocate them to an invoice in the same customer account and currency.</div></section>';
}
async function loadCustomerReport() {
  const customerId=ui.customer,asOf=ui.asOf;if(!customerId){ui.customerReport=null;return;}
  try {
    const report=await api.exportCustomer(customerId,{asOf});
    if(ui.customer!==customerId||ui.asOf!==asOf)return;
    ui.customerReport=report;
    if(ui.view==='aging')render();
  } catch(error) {showError(error);}
}
function agingTable(currencies) {
  if(!currencies?.length)return '<div class="panel-body"><p class="muted">No issued balances or available receipts fall in this reporting period.</p></div>';
  return '<div class="table-wrap"><table><thead><tr><th>Currency</th><th class="num">Current</th><th class="num">1–30 days</th><th class="num">31–60 days</th><th class="num">61–90 days</th><th class="num">91+ days</th><th class="num">Amount due</th><th class="num">Credit balance</th><th class="num">Unapplied receipts</th></tr></thead><tbody>' +
    currencies.map(row=>'<tr><td>' + e(row.currency.code) + '<span class="subline">' + e(row.currency.scale) + ' decimal places</span></td>' +
      ['current','days1to30','days31to60','days61to90','days91plus','amountDue','creditBalance','unappliedPayments'].map(key=>'<td class="num">' + e(row[key]??'—') + '</td>').join('') +
      '</tr>').join('') + '</tbody></table></div>';
}
function renderAging() {
  const report=ui.customer?ui.customerReport:ui.state.aging;
  const invoices=(report?.invoices||[]).filter(row=>positive(row.amountDue,row.currency));
  return '<section class="panel aging-summary"><div class="panel-head"><div><h2>Accounts receivable aging</h2><p class="small-text muted">' +
    e(ui.customer?customerName(ui.customer):'All customers') + ' · ' + e(ui.asOf) + '</p></div>' + (ui.customer?btn('Account statement','customer-export'):'') +
    '</div>' + (report?agingTable(report.currencies):'<div class="panel-body"><p>Loading the selected customer account…</p></div>') +
    '<div class="panel-foot small-text muted">Each currency and precision has its own balance. Unapplied receipts and customer credit balances remain visible separately.</div></section>' +
    '<section class="panel"><div class="panel-head"><h2>Outstanding invoices</h2></div>' +
    (invoices.length?'<div class="table-wrap"><table><thead><tr><th>Invoice / customer</th><th>Due date</th><th class="num">Days overdue</th><th class="num">Amount due</th><th>Status</th></tr></thead><tbody>' +
    invoices.map(row=>'<tr><td><button type="button" class="link" data-action="open-invoice" data-id="' + e(row.id) + '">' + e(row.number||row.id) + '</button><span class="subline">' +
      e(row.customerName||customerName(row.customerId)) + '</span></td><td>' + e(row.dueDate) + '</td><td class="num">' + e(row.overdueDays||0) + '</td><td class="num">' +
      money(row.amountDue,row.currency) + '</td><td>' + badge(row) + '</td></tr>').join('') + '</tbody></table></div>':'<div class="panel-body"><p class="muted">No outstanding invoices in this view.</p></div>') + '</section>';
}
function historyTable(history,limit=40) {
  const rows=[...(history||[])].reverse().slice(0,limit);
  return rows.length?'<div class="table-wrap"><table><thead><tr><th>Recorded</th><th>Operation</th><th>Operator</th></tr></thead><tbody>' +
    rows.map(row=>'<tr><td>' + e(row.at||row.recordedAt||row.createdAt||row.timestamp||'—') + '</td><td>' + e(row.action||row.type||row.kind||'Saved change') +
      ((row.requestId||row.details?.requestId)?'<span class="subline mono">' + e(row.requestId||row.details?.requestId) + '</span>':'') + '</td><td>' + e(row.actor||'—') + '</td></tr>').join('') +
    '</tbody></table></div>':'<p class="muted small-text">No activity recorded for this selection.</p>';
}
function renderActivity() {
  const limit=ui.historyLimit||100,history=ui.state.history||[];
  return '<section class="panel"><div class="panel-head"><h2>Receivables activity</h2>' + btn('Export activity','export-activity') + '</div>' +
    historyTable(history,limit) + '<div class="panel-foot row between"><span class="small-text muted">Showing ' + Math.min(limit,history.length) + ' of ' + history.length + ' changes.</span>' +
    (limit<history.length?btn('Show more','more-activity'):'') + '</div></section>';
}
function openDialog(title,content) {
  $('#dialog-title').textContent=title;$('#dialog-content').innerHTML=content;dialogMessage('');
  if(!$('#dialog').open)$('#dialog').showModal();
  setBusy(ui.busy);
}
function closeDialog() { if($('#dialog').open)$('#dialog').close();dialogMessage(''); }
function currencyFields(currency={code:'USD',scale:2}) {
  return '<label>Currency<input name="currencyCode" maxlength="3" pattern="[A-Za-z]{3}" value="' + e(currency.code) + '" required></label><label>Decimal places<select name="currencyScale">' +
    [0,1,2,3,4,5,6].map(scale=>'<option value="' + scale + '"' + (Number(currency.scale)===scale?' selected':'') + '>' + scale + '</option>').join('') + '</select></label>';
}
function formActions(label) { return '<div class="dialog-actions">' + btn('Cancel','close-dialog') + '<button type="submit" class="primary" data-write>' + e(label) + '</button></div>'; }
function renderDocument(doc) {
  const totals=doc.totals||{},credit=doc.kind==='CREDIT_NOTE';
  return '<article class="document"><div class="document-header"><div><h3>' + e(credit?'Credit note':'Invoice') + '</h3><p>' + e(doc.number||'Draft for review') +
    '</p></div><div><strong>' + e(doc.issuer?.name) + '</strong><p class="preline small-text">' + e(doc.issuer?.address) + '</p><p class="small-text">' + e(doc.issuer?.email) +
    '</p>' + (doc.issuer?.taxReference?'<p class="small-text">' + e(doc.issuer.taxReference) + '</p>':'') + '</div></div>' +
    '<div class="document-parties"><div><p class="eyebrow">Bill to</p><strong>' + e(doc.customer?.name||doc.customerName||customerName(doc.customerId)) +
    '</strong><p class="preline small-text">' + e(doc.customer?.address) + '</p><p class="small-text">' + e(doc.customer?.email) + '</p></div><div><dl class="definition">' +
    '<dt>Invoice date</dt><dd>' + e(doc.issueDate||doc.creditDate) + '</dd><dt>Due date</dt><dd>' + e(doc.dueDate||'—') + '</dd>' +
    (doc.purchaseOrder?'<dt>Purchase order</dt><dd>' + e(doc.purchaseOrder) + '</dd>':'') + '</dl></div></div><div class="table-wrap"><table><thead><tr><th>Description</th>' +
    (credit?'':'<th class="num">Quantity</th><th class="num">Unit amount</th><th class="num">Discount</th>') +
    '<th class="num">Net</th><th class="num">Tax</th><th class="num">Total</th></tr></thead><tbody>' +
    (doc.lines||[]).map(line=>'<tr><td>' + e(line.description) + '</td>' + (credit?'':'<td class="num">' + e(line.quantity) + '</td><td class="num">' + e(line.unitAmount) +
      '</td><td class="num">' + e(line.discountAmount||zero(doc.currency)) + '</td>') + '<td class="num">' + e(line.netAmount) + '</td><td class="num">' + e(line.taxAmount) +
      '</td><td class="num">' + e(line.total) + '</td></tr>').join('') + '</tbody></table></div><div class="document-total">' +
    (!credit?'<p><span>Subtotal</span><span>' + e(totals.subtotal) + '</span></p><p><span>Discount</span><span>' + e(totals.discount) + '</span></p>':'') +
    '<p><span>Net</span><span>' + e(totals.net) + '</span></p><p><span>Tax</span><span>' + e(totals.tax) + '</span></p><p><span>' + e(doc.currency?.code) + ' total</span><span>' +
    e(totals.total) + '</span></p></div>' + (doc.note?'<p class="section preline">' + e(doc.note) + '</p>':'') +
    (doc.issuer?.paymentInstructions?'<section class="section"><h4>Payment instructions</h4><p class="preline small-text">' + e(doc.issuer.paymentInstructions) + '</p></section>':'') + '</article>';
}
async function previewInvoice() {
  const invoice=detailInvoice();
  const preview=await api.preview(invoice.id);
  ui.preview={...preview,invoiceId:invoice.id,expectedVersion:preview.expectedVersion};
  openDialog('Review invoice before issue',renderDocument(preview.document) + '<p class="hint">Issuing assigns the next invoice number and retains this document with its current customer and merchant details.</p>' +
    '<div class="dialog-actions">' + btn('Back','close-dialog') + btn('Issue invoice','issue-invoice',' data-write',true) + '</div>');
}
function settingsDialog() {
  const issuer=ui.state.issuer||{};
  openDialog('Document settings','<form id="settings-form"><div class="form-grid">' +
    '<label class="full">Merchant name<input name="name" maxlength="300" value="' + e(issuer.name) + '" required></label>' +
    '<label class="full">Address<textarea name="address" maxlength="2000">' + e(issuer.address) + '</textarea></label>' +
    '<label>Email<input name="email" type="email" maxlength="300" value="' + e(issuer.email) + '"></label>' +
    '<label>Registration or tax reference<input name="taxReference" maxlength="300" value="' + e(issuer.taxReference) + '"></label>' +
    '<label>Invoice prefix<input name="invoicePrefix" pattern="[A-Z0-9][A-Z0-9-]*" maxlength="20" value="' + e(issuer.invoicePrefix||'INV') + '" required></label>' +
    '<label>Credit note prefix<input name="creditPrefix" pattern="[A-Z0-9][A-Z0-9-]*" maxlength="20" value="' + e(issuer.creditPrefix||'CN') + '" required></label>' +
    '<label class="full">Payment instructions<textarea name="paymentInstructions" maxlength="4000">' + e(issuer.paymentInstructions) + '</textarea></label></div>' +
    '<p class="hint section">These details apply when a draft is issued. Issued documents keep the details captured at issuance.</p>' + formActions('Save settings') + '</form>');
}
function manualReceiptDialog() {
  const currency={code:'USD',scale:2};
  openDialog('Record customer receipt','<form id="receipt-form"><div class="form-grid">' +
    '<label class="full">Customer<select name="customerId" required>' + customerOptions(ui.customer) + '</select></label>' +
    currencyFields(currency) + '<label>Received amount<input name="amount" inputmode="decimal" placeholder="0.00" required></label>' +
    '<label>Received date<input name="receivedDate" type="date" value="' + today() + '" required></label>' +
    '<label>Payment method<select name="method"><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cash">Cash</option><option value="other">Other</option></select></label>' +
    '<label>Payment reference<input name="reference" maxlength="300" required></label>' +
    '<label class="full">Internal note<textarea name="note" maxlength="3000"></textarea></label></div>' +
    '<p class="hint section">Record the amount actually received. Allocation to an invoice is a separate account operation.</p>' + formActions('Record receipt') + '</form>');
}
function creditDialog() {
  const invoice=detailInvoice(),doc=invoice.document;if(!doc)throw new Error('Issue the invoice before creating a credit note.');
  const prior=invoice.credits||[];
  const rows=doc.lines.map(line=>{
    let net=units(line.netAmount,doc.currency),tax=units(line.taxAmount,doc.currency);
    for(const note of prior)for(const credited of (note.document||note).lines||[]){
      if(credited.invoiceLineId===line.id){net-=units(credited.netAmount,doc.currency);tax-=units(credited.taxAmount,doc.currency);}
    }
    return {line,net:amount(net,doc.currency),tax:amount(tax,doc.currency),available:net+tax>0n};
  });
  openDialog('Credit note · ' + (invoice.number||invoice.id),'<form id="credit-form" data-id="' + e(invoice.id) + '"><div class="form-grid">' +
    '<label>Credit date<input name="creditDate" type="date" min="' + e(invoice.issueDate) + '" value="' + today() + '" required></label>' +
    '<label>Currency<input value="' + e(doc.currency.code) + '" readonly></label><label class="full">Reason<textarea name="reason" maxlength="3000" required></textarea></label></div>' +
    '<section class="section"><h3>Credit original invoice lines</h3><p class="hint">Choose each line to credit, then enter its net and tax amounts. The available amounts reflect previous credit notes.</p>' +
    '<div class="table-wrap"><table><thead><tr><th>Select</th><th>Description</th><th class="num">Available net</th><th class="num">Available tax</th><th>Credit net</th><th>Credit tax</th></tr></thead><tbody>' +
    rows.map(row=>'<tr data-credit-line="' + e(row.line.id) + '"><td><input type="checkbox" name="include" aria-label="Credit ' + e(row.line.description) + '"' + (!row.available?' disabled':'') +
      '></td><td>' + e(row.line.description) + '</td><td class="num">' + e(row.net) + '</td><td class="num">' + e(row.tax) +
      '</td><td><input name="netAmount" inputmode="decimal" value="' + e(row.net) + '" aria-label="Credited net amount for ' + e(row.line.description) +
      '"' + (!row.available?' disabled':'') + '></td><td><input name="taxAmount" inputmode="decimal" value="' + e(row.tax) + '" aria-label="Credited tax amount for ' + e(row.line.description) +
      '"' + (!row.available?' disabled':'') + '></td></tr>').join('') + '</tbody></table></div></section>' + formActions('Issue credit note') + '</form>');
}
function sameCurrency(a,b) { return a?.code===b?.code&&Number(a?.scale)===Number(b?.scale); }
function allocationDialog({invoiceId='',receiptId=''}={}) {
  const invoices=(ui.state.invoices||[]).filter(row=>row.status==='ISSUED'&&positive(row.amountDue,row.currency));
  const receipt=ui.state.receipts.find(row=>row.id===receiptId);
  const options=invoices.filter(row=>!receipt||(row.customerId===receipt.customerId&&sameCurrency(row.currency,receipt.currency)));
  if(!options.length)throw new Error('There is no issued invoice with an amount due for this selection.');
  invoiceId=options.some(row=>row.id===invoiceId)?invoiceId:options[0].id;
  openDialog('Allocate a receipt','<form id="allocation-form"><div class="form-grid">' +
    '<label class="full">Invoice<select name="invoiceId" id="allocation-invoice" required>' + options.map(row=>'<option value="' + e(row.id) + '"' + (row.id===invoiceId?' selected':'') + '>' +
      e(row.number||row.id) + ' · ' + e(row.customerName||customerName(row.customerId)) + ' · Due ' + money(row.amountDue,row.currency) + '</option>').join('') + '</select></label>' +
    '<label class="full">Available receipt<select name="receiptId" id="allocation-receipt" required></select></label>' +
    '<label>Allocation amount<input name="amount" id="allocation-amount" inputmode="decimal" required></label>' +
    '<label>Allocation date<input name="allocatedDate" type="date" value="' + today() + '" required></label></div>' +
    '<p id="allocation-hint" class="hint section"></p>' + formActions('Allocate receipt') + '</form>');
  updateAllocationReceipts(receiptId);
}
function updateAllocationReceipts(preferred='') {
  const invoice=ui.state.invoices.find(row=>row.id===$('#allocation-invoice').value);
  const receipts=ui.state.receipts.filter(row=>row.customerId===invoice.customerId&&sameCurrency(row.currency,invoice.currency)&&!row.voidDate&&positive(row.available,row.currency));
  $('#allocation-receipt').innerHTML=receipts.length?receipts.map(row=>'<option value="' + e(row.id) + '"' + (row.id===preferred?' selected':'') + '>' +
    e(row.reference||row.id) + ' · ' + e(row.receivedDate) + ' · Available ' + money(row.available,row.currency) + '</option>').join(''):'<option value="">No matching available receipts</option>';
  updateAllocationAmount();
}
function updateAllocationAmount() {
  const invoice=ui.state.invoices.find(row=>row.id===$('#allocation-invoice').value),receipt=ui.state.receipts.find(row=>row.id===$('#allocation-receipt').value);
  if(!receipt){$('#allocation-amount').value='';$('#allocation-hint').textContent='Record a receipt for this customer and currency before allocating.';return;}
  const available=units(receipt.available,invoice.currency),due=units(invoice.amountDue,invoice.currency);
  $('#allocation-amount').value=amount(available<due?available:due,invoice.currency);
  $('#allocation-hint').textContent=invoice.currency.code + ' · Invoice due ' + invoice.amountDue + ' · Receipt available ' + receipt.available;
}
function datedReasonDialog(kind,recordId) {
  const settings={release:{title:'Release payment allocation',date:'releasedDate',label:'Release date',submit:'Release allocation'},
    voidReceipt:{title:'Void customer receipt',date:'voidDate',label:'Void date',submit:'Void receipt'},
    voidInvoice:{title:'Void invoice',date:'voidDate',label:'Void date',submit:'Void invoice'}}[kind];
  openDialog(settings.title,'<form id="dated-reason-form" data-kind="' + e(kind) + '" data-id="' + e(recordId) + '"><div class="form-grid">' +
    '<label>' + e(settings.label) + '<input type="date" name="' + e(settings.date) + '" value="' + today() + '" required></label>' +
    '<label class="full">Reason<textarea name="reason" maxlength="3000" required></textarea></label></div>' +
    '<p class="hint section">This records a dated account correction and retains the original operation history.</p>' + formActions(settings.submit) + '</form>');
}


function quoteImportDialog() {
  openDialog('Create invoice from an existing quote','<form id="quote-import-form"><div class="form-grid">' +
    '<label class="full">Exported quote JSON<input name="quoteFile" type="file" accept=".json,application/json" required><span class="hint">Choose the original merchant quote export.</span></label>' +
    '<label class="full">Quote response JSON (optional)<input name="responseFile" type="file" accept=".json,application/json"><span class="hint">Attach the original response export when one exists.</span></label>' +
    '<label class="full">Accounting customer<select name="customerId" required>' + customerOptions(ui.customer) + '</select><span class="hint">Select the existing customer account for this invoice.</span></label>' +
    '<label>Billable scope<select name="scope" id="quote-scope"><option value="IMPLEMENTATION">One-time implementation</option><option value="RECURRING">Recurring monthly periods</option></select></label>' +
    '<label>USD decimal places<select name="currencyScale">' + [0,1,2,3,4,5,6].map(scale=>'<option value="' + scale + '"' + (scale===2?' selected':'') + '>' + scale + '</option>').join('') + '</select></label>' +
    '<label>Invoice date<input type="date" name="issueDate" value="' + today() + '" required></label><label>Due date<input type="date" name="dueDate" value="' + today() + '" required></label>' +
    '<label>Monthly period count<input name="periodCount" id="quote-period-count" type="number" min="1" max="9007199254740991" step="1" value="1" disabled></label>' +
    '<label>Billing period label<input name="periodLabel" id="quote-period-label" maxlength="300" placeholder="For example: October 2026" disabled></label></div>' +
    '<p class="hint section">The imported quote supplies the agreed amounts. This creates a retained invoice draft for review; issuance is a separate operator action.</p>' + formActions('Create invoice draft') + '</form>');
}
async function originalJsonFile(input,required=false) {
  const selected=input.files?.[0];
  if(!selected){if(required)throw new Error('Choose the original quote JSON file.');return undefined;}
  if(selected.size>Number(config.requestBytes||2000000))throw new Error('This quote source exceeds the supported JSON file size.');
  const text=await selected.text();let value;
  try{value=JSON.parse(text);}catch{throw new Error(selected.name + ' is not valid JSON.');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(selected.name + ' must contain a JSON object.');
  return text;
}

function nativeReceiptDialog() {
  ui.native={page:null,selected:null,customerId:'',runId:'',loading:false};
  const runs=(ui.state.runs||[]).filter(run=>!run.status||String(run.status).toLowerCase()==='complete'||String(run.status).toLowerCase()==='completed');
  openDialog('Import a native customer payment','<form id="native-receipt-form"><div class="form-grid">' +
    '<label>Customer<select name="customerId" required>' + customerOptions(ui.customer) + '</select></label>' +
    '<label>Completed accounting report<select name="runId" required><option value="">Choose a report</option>' +
    runs.map(run=>{const runId=run.runId||run.id;return '<option value="' + e(runId) + '">' + e(run.name||run.label||run.title||runId) + (run.createdAt?' · ' + e(run.createdAt):'') + '</option>';}).join('') +
    '</select></label></div><div class="row section">' + btn('Load customer payments','load-ledger') + '</div><div id="native-ledger"></div>' +
    '<section class="section"><h3>Record receipt value</h3><div class="form-grid">' + currencyFields() +
    '<label>Currency amount received<input name="amount" inputmode="decimal" placeholder="0.00" required></label>' +
    '<label>Received date<input name="receivedDate" type="date" value="' + today() + '" required></label>' +
    '<label class="full">Currency valuation or receipt basis<textarea name="valuationNote" maxlength="3000" required></textarea><span class="hint">Describe how the selected native payment maps to this recorded currency amount.</span></label></div></section>' +
    formActions('Import payment receipt') + '</form>');
}
async function loadLedger(offset=0) {
  const form=$('#native-receipt-form');if(!form)return;
  const values=Object.fromEntries(new FormData(form)),customerId=values.customerId,runId=values.runId;
  if(!customerId||!runId)throw new Error('Choose the accounting customer and completed report.');
  if(ui.native.loading)return;
  if(ui.native.customerId!==customerId||ui.native.runId!==runId)ui.native.selected=null;
  Object.assign(ui.native,{customerId,runId,loading:true});
  $('#native-ledger').innerHTML='<p class="section">Reading customer payments…</p>';dialogMessage('');
  try {
    const page=await api.ledger({customerId,runId,offset,limit:100});
    if(!$('#native-receipt-form')||ui.native.customerId!==customerId||ui.native.runId!==runId)return;
    ui.native.page=page;renderNativeLedger();
  } catch(error) {showError(error);}
  finally{if(ui.native)ui.native.loading=false;}
}
function renderNativeLedger() {
  const native=ui.native,page=native.page,container=$('#native-ledger');if(!container||!page)return;
  const rows=page.items||[];
  const updated=rows.find(row=>row.eventId===native.selected?.eventId);
  if(updated)native.selected=updated.eligible===true&&!updated.importedReceiptId?updated:null;
  const selected=native.selected;
  container.innerHTML='<section class="section"><h3>Customer payment events</h3>' +
    (rows.length?'<div class="table-wrap"><table><thead><tr><th>Select / payment event</th><th>Network</th><th class="num">Native amount</th><th>Recorded</th></tr></thead><tbody>' +
    rows.map(row=>{
      const available=row.eligible===true&&!row.importedReceiptId;
      const reason=row.importedReceiptId?'Already recorded · Receipt '+row.importedReceiptId:
        row.eligible===true?'Available to record':'Report status · '+[row.network,row.transfer,row.verificationScope].filter(Boolean).join(' · ');
      return '<tr class="ledger-row"><td><label><input type="radio" name="nativeEvent" value="' + e(row.eventId) + '"' + (selected?.eventId===row.eventId?' checked':'') + (available?'':' disabled') + '><span class="mono">' +
        e(row.eventId) + '</span></label><span class="subline mono">' + e(row.orderReferenceDigest||'') + '</span><span class="subline">' + e(reason) + '</span></td><td>' + e(row.network) + '</td><td class="num">' + e(row.amountAtomic) +
        '<span class="subline">Atomic units</span></td><td>' + e(row.recordedAt||'—') + '</td></tr>';
    }).join('') +
    '</tbody></table></div>':'<p class="muted">No matching payment events in this report. Check the customer’s existing account binding and selected report.</p>') +
    '<div class="ledger-pagination"><span class="small-text muted">' + (rows.length?Number(page.offset)+1:0) + '–' + (Number(page.offset)+rows.length) + ' of ' + e(page.total) + '</span><div class="row">' +
    btn('Previous','ledger-page',' data-offset="' + Math.max(0,Number(page.offset)-Number(page.limit)) + '"' + (Number(page.offset)===0?' disabled':'')) +
    btn('Next','ledger-page',' data-offset="' + (Number(page.offset)+Number(page.limit)) + '"' + (Number(page.offset)+rows.length>=Number(page.total)?' disabled':'')) + '</div></div>' +
    (selected?'<div class="ledger-selection"><strong>Selected payment</strong><p class="mono">' + e(selected.eventId) + '</p><p class="small-text">' + e(selected.network) + ' · ' +
      e(selected.amountAtomic) + ' atomic units</p><p class="mono">Asset ' + e(selected.assetDigest||'—') + '</p><p class="mono">Transaction ' + e(selected.transactionFingerprint||'—') + '</p></div>':'') + '</section>';
}
async function customerExportDialog() {
  const customerId=ui.customer||(ui.detail?detailInvoice().customerId:'');
  if(!customerId)throw new Error('Choose a customer to create an account statement.');
  const report=await api.exportCustomer(customerId,{asOf:ui.asOf});
  openDialog('Account statement · ' + customerName(customerId),'<p>As of ' + e(ui.asOf) + '</p>' + agingTable(report.currencies) +
    '<p class="section">' + e(report.invoices?.length||0) + ' invoices · ' + e(report.credits?.length||0) + ' credit notes · ' + e(report.receipts?.length||0) + ' receipts</p>' +
    '<div class="dialog-actions">' + ['account.tar','account.html','account.json','invoices.csv'].map(name=>btn(name==='account.tar'?'Complete account packet':name==='account.html'?'Printable statement':name==='account.json'?'Account JSON':'Invoice CSV','customer-download',' data-id="' + e(customerId) + '" data-name="' + name + '"')).join('') + '</div>');
}
function saveBlob(blob,name) {
  const url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function downloadDocument(recordId,name) {
  const response=await api.file(recordId,name);
  saveBlob(await response.blob(),name);
}
async function compareDraft() {
  if(!ui.editor?.id)return;
  await refresh({quiet:true});
  const fresh=await api.detail(ui.editor.id),invoice=fresh.invoice||fresh;
  const saved=fresh.document||invoice.document||fresh.draft||invoice.draft;
  if(invoice.status==='ISSUED'||invoice.status==='VOID')throw new Error('The saved invoice is already issued or void. Your local draft remains retained.');
  const summary=ui.state.invoices.find(row=>row.id===ui.editor.id)||invoice;
  ui.reviewedVersion=summary.version;
  openDialog('Review the current saved draft',renderDocument({...saved,issuer:ui.state.issuer,customer:ui.state.customers.find(row=>row.id===saved.customerId)}) +
    '<p>Your local edits are retained in the editor. After reviewing the saved version, you can explicitly use this version as the base for your next save.</p>' +
    '<div class="dialog-actions">' + btn('Keep reviewing','close-dialog') + btn('Use this saved version','adopt-draft-version',' data-write',true) + '</div>');
}
function draftPayload() {
  const draft=ui.editor;
  return { ...(draft.id?{id:draft.id,expectedVersion:draft.expectedVersion}:{}), customerId:draft.customerId,currency:draft.currency,
    issueDate:draft.issueDate,dueDate:draft.dueDate,purchaseOrder:draft.purchaseOrder,note:draft.note,lines:draft.lines,
    ...(draft.replacesId?{replacesId:draft.replacesId}:{}),...(draft.sourceReference?{sourceReference:draft.sourceReference}:{}) };
}
document.addEventListener('input',event=>{
  if(event.target.closest('#draft-form'))updateDraft(event.target);
  else if(event.target.id==='operator')saveSession('actor',event.target.value);
  else if(event.target.id==='search'){ui.search=event.target.value;render();}
});
document.addEventListener('change',event=>{
  const target=event.target;
  if(target.closest('#draft-form'))updateDraft(target);
  else if(target.id==='customer-filter'){ui.customer=target.value;ui.customerReport=null;render();if(ui.view==='aging'&&ui.customer)loadCustomerReport();}
  else if(target.id==='status-filter'){ui.status=target.value;render();}
  else if(target.id==='as-of'){ui.asOf=target.value||today();refresh({quiet:true});}
  else if(target.id==='quote-scope'){const recurring=target.value==='RECURRING';$('#quote-period-count').disabled=!recurring;$('#quote-period-label').disabled=!recurring;$('#quote-period-label').required=recurring;}
  else if(target.id==='allocation-invoice')updateAllocationReceipts();
  else if(target.id==='allocation-receipt')updateAllocationAmount();
  else if(target.name==='nativeEvent'&&ui.native){
    const selected=ui.native.page?.items?.find(row=>row.eventId===target.value);
    if(selected?.eligible===true&&!selected.importedReceiptId){ui.native.selected=selected;renderNativeLedger();}
  } else if(target.closest('#native-receipt-form')&&['customerId','runId'].includes(target.name)){
    ui.native.selected=null;ui.native.page=null;ui.native.customerId='';ui.native.runId='';
    const container=$('#native-ledger');if(container)container.innerHTML='';
  }
});
document.addEventListener('submit',async event=>{
  const form=event.target;if(!form.matches('form'))return;event.preventDefault();if(ui.busy)return;
  try {
    const values=Object.fromEntries(new FormData(form));
    if(form.id==='draft-form'){
      if(!ui.editor.lines.length)throw new Error('Add an invoice line.');
      await mutate('saveDraft',[draftPayload()],'Save invoice draft');
    } else if(form.id==='quote-import-form'){
      const quoteContent=await originalJsonFile(form.elements.quoteFile,true),responseContent=await originalJsonFile(form.elements.responseFile);
      const payload={quoteContent,...(responseContent?{responseContent}:{}),customerId:values.customerId,issueDate:values.issueDate,dueDate:values.dueDate,currencyScale:Number(values.currencyScale),scope:values.scope};
      if(values.scope==='RECURRING'){payload.periodCount=Number(values.periodCount);payload.periodLabel=values.periodLabel;if(!Number.isSafeInteger(payload.periodCount)||payload.periodCount<1)throw new Error('Enter a positive whole count of monthly billing periods.');}
      await mutate('importQuote',[payload],'Create invoice draft from quote');
    } else if(form.id==='settings-form')await mutate('settings',[values],'Save document settings');
    else if(form.id==='receipt-form'){
      const {currencyCode,currencyScale,...value}=values;
      await mutate('receipt',[{...value,currency:{code:currencyCode.toUpperCase(),scale:Number(currencyScale)}}],'Record customer receipt');
    } else if(form.id==='native-receipt-form'){
      if(ui.native?.selected?.eligible!==true||ui.native.selected.importedReceiptId)throw new Error('Select an available verified payment event from the completed accounting report.');
      if(values.customerId!==ui.native.customerId||values.runId!==ui.native.runId)throw new Error('Load payment events for the currently selected customer and report.');
      await mutate('importSettlement',[{customerId:values.customerId,runId:values.runId,eventId:ui.native.selected.eventId,
        currency:{code:values.currencyCode.toUpperCase(),scale:Number(values.currencyScale)},amount:values.amount,
        receivedDate:values.receivedDate,valuationNote:values.valuationNote}],'Import native payment receipt');
    } else if(form.id==='credit-form'){
      const lines=[...form.querySelectorAll('[data-credit-line]')].filter(row=>row.querySelector('[name=include]').checked).map(row=>({
        invoiceLineId:row.dataset.creditLine,netAmount:row.querySelector('[name=netAmount]').value,taxAmount:row.querySelector('[name=taxAmount]').value,
      }));
      if(!lines.length)throw new Error('Choose at least one invoice line for the credit.');
      await mutate('credit',[form.dataset.id,{creditDate:values.creditDate,reason:values.reason,lines}],'Issue credit note');
    } else if(form.id==='allocation-form')await mutate('allocate',[values],'Allocate receipt');
    else if(form.id==='dated-reason-form')await mutate(form.dataset.kind,[form.dataset.id,values],form.dataset.kind==='release'?'Release payment allocation':form.dataset.kind==='voidReceipt'?'Void customer receipt':'Void invoice');
  }catch(error){showError(error);}
});
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
  const action=button.dataset.action;
  if(ui.pending&&['new-invoice','settings','import-quote','edit-invoice','add-line','remove-line','preview-invoice','issue-invoice','manual-receipt','native-receipt','credit-invoice','allocate-invoice','allocate-receipt','release-allocation','void-receipt','void-invoice','adopt-draft-version'].includes(action)){setMessage('Finish the retained operation before starting another change.',true);return;}
  try{
    if(action==='view'){ui.view=button.dataset.view;render();if(ui.view==='aging'&&ui.customer)await loadCustomerReport();}
    else if(action==='refresh')await refresh();
    else if(action==='dismiss-message')setMessage('');
    else if(action==='new-invoice'){
      if(!ui.editor&&ui.parkedEditor){ui.editor=ui.parkedEditor;ui.parkedEditor=null;ui.view='invoices';render();return;}
      newDraft();
    } else if(action==='select-invoice'||action==='open-invoice'){if(action==='open-invoice')ui.view='invoices';await selectInvoice(button.dataset.id);}
    else if(action==='settings')settingsDialog();
    else if(action==='import-quote')quoteImportDialog();
    else if(action==='edit-invoice')editDraft();
    else if(action==='close-editor'){
      ui.parkedEditor=ui.editor;persistEditor();ui.editor=null;render();
      setMessage('Invoice edits remain retained. Use New invoice to resume the editor.');
    } else if(action==='add-line'){
      if(ui.editor.lines.length>=250)throw new Error('An invoice supports up to 250 lines.');
      ui.editor.lines.push({id:'line-'+id(),description:'',quantity:'1',unitAmount:zero(ui.editor.currency),discountAmount:zero(ui.editor.currency),taxAmount:zero(ui.editor.currency)});
      ui.editor.dirty=true;persistEditor();render();
    } else if(action==='remove-line'){
      if(ui.editor.lines.length>1){ui.editor.lines.splice(Number(button.dataset.index),1);ui.editor.dirty=true;persistEditor();render();}
    } else if(action==='preview-invoice')await previewInvoice();
    else if(action==='issue-invoice'){
      if(!ui.preview)throw new Error('Review the invoice before issuing.');
      await mutate('issue',[ui.preview.invoiceId,{expectedVersion:ui.preview.expectedVersion,previewSha256:ui.preview.previewSha256}],'Issue invoice');
    } else if(action==='close-dialog')closeDialog();
    else if(action==='manual-receipt')manualReceiptDialog();
    else if(action==='native-receipt')nativeReceiptDialog();
    else if(action==='load-ledger')await loadLedger(0);
    else if(action==='ledger-page')await loadLedger(Number(button.dataset.offset));
    else if(action==='credit-invoice')creditDialog();
    else if(action==='allocate-invoice')allocationDialog({invoiceId:ui.selected});
    else if(action==='allocate-receipt')allocationDialog({receiptId:button.dataset.id});
    else if(action==='release-allocation')datedReasonDialog('release',button.dataset.id);
    else if(action==='void-receipt')datedReasonDialog('voidReceipt',button.dataset.id);
    else if(action==='void-invoice')datedReasonDialog('voidInvoice',ui.selected);
    else if(action==='download')await downloadDocument(button.dataset.id,button.dataset.name);
    else if(action==='quote-download'){const response=await api.quoteFile(button.dataset.id,button.dataset.name);saveBlob(await response.blob(),button.dataset.name);}
    else if(action==='customer-export')await customerExportDialog();
    else if(action==='customer-download'){
      const response=await api.customerFile(button.dataset.id,button.dataset.name,{asOf:ui.asOf});saveBlob(await response.blob(),button.dataset.name);
    } else if(action==='retry-operation')await runPending();
    else if(action==='return-to-form'){
      if(ui.pending?.rejected){ui.pending=null;saveSession('pending',null);await refresh({quiet:true});renderPending();dialogMessage('Review the retained form, then save against the refreshed workspace.');}
    } else if(action==='check-operation'){
      await refresh({quiet:true});
      const requestId=ui.pending?.requestId;
      const saved=requestId&&(ui.state.history||[]).find(row=>row.requestId===requestId||row.details?.requestId===requestId);
      setMessage(saved?'The operation is in the saved workspace history. Retry the same operation to retrieve its original result.':'The current workspace is loaded. Use Retry same operation to reconcile the retained request.');
    } else if(action==='more-activity'){ui.historyLimit=(ui.historyLimit||100)+100;render();}
    else if(action==='export-activity')saveBlob(new Blob([JSON.stringify({asOf:ui.asOf,revision:ui.state.revision,history:ui.state.history},null,2)+'\n'],{type:'application/json'}),'receivables-activity.json');
    else if(action==='compare-draft')await compareDraft();
    else if(action==='adopt-draft-version'){
      ui.editor.expectedVersion=ui.reviewedVersion;ui.editor.dirty=true;persistEditor();closeDialog();render();setMessage('Your edits now use the reviewed saved invoice version. Save draft to apply them.');
    }
  }catch(error){showError(error);}
});
window.addEventListener('pagehide',()=>{if(ui.editor)persistEditor();if(ui.pending)saveSession('pending',ui.pending);});
renderPending();
await refresh({quiet:true});
